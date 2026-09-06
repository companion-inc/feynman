import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { parse } = createRequire(import.meta.url)("yaml") as typeof import("yaml");
const workflow = parse(readFileSync(".github/workflows/publish.yml", "utf8"));
const versionJob = workflow.jobs["version-check"];
const versionRun = versionJob.steps.find((step: { id?: string }) => step.id === "version").run as string;
const finalJob = workflow.jobs["verify-published-state"];
const finalStep = finalJob.steps.find((step: { run?: string }) => step.run);
const source = "2288a6bcc89bca2a6278d19caba9f13e9a3c66bb";
const successor = "14e48c408da6a8a02e56e8bb89d8e5cd3818383c";
const foreign = "a".repeat(40);
// Production reconciliation runs in an Ubuntu Bash job, not the Windows consumer.
const reconciliationShell = {
	skip: process.platform === "win32" ? "Release reconciliation shell targets Ubuntu/POSIX" : false,
};
const integrity = `sha512-${Buffer.alloc(64, 7).toString("base64")}`;
const reconciliationStart = versionRun.indexOf('if [ "$RELEASE_COMPLETE" = "true" ] && [ "$PUBLISHED" = "$LOCAL" ]; then');
assert.ok(reconciliationStart >= 0);
// Execute the real policy after the independently tested npm certificate verifier.
const reconcile = versionRun.slice(reconciliationStart);
const finalIdentity = (finalStep.run as string).match(
	/# Reconciliation verifies the published source[\s\S]*?(?=npm audit --omit=dev --prefix "\$consumer")/,
)?.[0];
assert.ok(finalIdentity);
const finalIntegrity = (finalStep.run as string).match(
	/test -n "\$EXPECTED_INTEGRITY"\n\s*test "\$published_integrity" = "\$EXPECTED_INTEGRITY"/,
)?.[0];
assert.ok(finalIntegrity);

function runPolicy(script: string, overrides: Record<string, string | undefined> = {}) {
	const root = mkdtempSync(join(tmpdir(), "feynman-release-source-"));
	try {
		const bin = join(root, "bin");
		mkdirSync(bin);
		writeFileSync(join(bin, "gh"), `#!/bin/bash
set -euo pipefail
printf '%s\\n' "$*" >> "$MOCK_CALLS"
case "$*" in
  "release view v0.3.48 --json targetCommitish --jq .targetCommitish")
    printf '%s' "$MOCK_TARGET" ;;
  "api repos/advaitpaliwal/feynman/commits/refs/tags/v0.3.48 --jq .sha")
    test "\${MOCK_TAG_ERROR:-false}" = false
    printf '%s' "$MOCK_TAG" ;;
  "api repos/advaitpaliwal/feynman/compare/$MOCK_SOURCE...$GITHUB_SHA --jq .status")
    test "\${MOCK_COMPARE_ERROR:-false}" = false
    printf '%s' "$MOCK_RELATION" ;;
  *) exit 99 ;;
esac
`, { mode: 0o755 });
		const output = join(root, "output");
		const calls = join(root, "calls");
		writeFileSync(output, "");
		writeFileSync(calls, "");
		const result = spawnSync("bash", ["-c", `set -euo pipefail\n${script}`], {
			encoding: "utf8",
			cwd: root,
			env: {
				PATH: `${bin}:/usr/bin:/bin`,
				GITHUB_OUTPUT: output,
				GITHUB_REPOSITORY: "advaitpaliwal/feynman",
				GITHUB_SHA: successor,
				LOCAL: "0.3.48", VERSION: "0.3.48", PUBLISHED: "0.3.48",
				RELEASE_COMPLETE: "true", RELEASE_EXISTS: "true", RELEASE_TARGET: source,
				PUBLISHED_SOURCE_SHA: source, published_source_sha: source,
				published_integrity: integrity, EXPECTED_INTEGRITY: integrity,
				SHOULD_PUBLISH_NPM: "false",
				MOCK_SOURCE: source, MOCK_TARGET: source, MOCK_TAG: source, MOCK_RELATION: "ahead",
				MOCK_CALLS: calls,
				...overrides,
			},
		});
		assert.ifError(result.error);
		return { ...result, output: readFileSync(output, "utf8"), calls: readFileSync(calls, "utf8") };
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

function finalJobAllowed(overrides: Record<string, unknown> = {}) {
	const needs = {
		"version-check": {
			result: "success",
			outputs: { should_run_verify: "false", should_verify_published: "true",
				should_publish_npm: "false", should_release_github: "false" },
		},
		verify: { result: "skipped" },
		"publish-npm": { result: "skipped" },
		"release-github": { result: "skipped" },
		...overrides,
	};
	// Restricted local model of boolean/equality conditions, not GitHub's engine.
	const expression = finalJob.if.replace(/needs\.([a-z-]+)/g, 'needs["$1"]');
	return new Function("needs", "always", `return (${expression});`)(needs, () => true) === true;
}

test("successor reconciliation skips rebuilding but exports verified source/integrity and recertifies", reconciliationShell, () => {
	assert.equal(versionJob.outputs.published_source_sha, "${{ steps.version.outputs.published_source_sha }}");
	assert.equal(versionJob.outputs.published_integrity, "${{ steps.version.outputs.published_integrity }}");
	assert.equal(versionJob.outputs.should_verify_published, "${{ steps.version.outputs.should_verify_published }}");
	assert.equal(workflow.jobs.verify.if, "needs.version-check.outputs.should_run_verify == 'true'");
	const result = runPolicy(reconcile);
	assert.equal(result.status, 0, result.stderr);
	assert.equal(result.output, [
		"should_release_github=false", "should_run_verify=false",
		`published_source_sha=${source}`, `published_integrity=${integrity}`,
		"should_verify_published=true", "",
	].join("\n"));
	assert.match(result.calls, /commits\/refs\/tags\/v0\.3\.48/);
	assert.match(result.calls, new RegExp(`compare/${source}\\.\\.\\.${successor}`));
	assert.equal(finalJobAllowed(), true, "complete releases must run the final job despite skipped build/publish jobs");
	assert.equal(finalStep.env.PUBLISHED_SOURCE_SHA, "${{ needs.version-check.outputs.published_source_sha }}");
	assert.equal(finalStep.env.SHOULD_PUBLISH_NPM, "${{ needs.version-check.outputs.should_publish_npm }}");
	assert.equal(finalStep.env.EXPECTED_INTEGRITY,
		"${{ needs.version-check.outputs.should_run_verify == 'false' && needs.version-check.outputs.published_integrity || needs.verify.outputs.package_integrity }}");
	const final = runPolicy(`${finalIntegrity}\n${finalIdentity}`);
	assert.equal(final.status, 0, final.stderr);
	assert.doesNotMatch(finalStep.run, /test "\$(?:published_source_sha|release_target)" = "\$GITHUB_SHA"/);
	for (const command of ["verify-installed-runtime.mjs", "verify-installed-docparser.mjs", "sha256sum -c SHA256SUMS"]) {
		assert.ok(finalStep.run.includes(command), command);
	}
});

test("version-check rejects foreign source, moved tag, failed ancestry lookup, and incomplete successor repair", reconciliationShell, () => {
	for (const overrides of [
		{ RELEASE_TARGET: foreign },
		{ MOCK_TAG: foreign }, { MOCK_TAG: "" }, { MOCK_TAG_ERROR: "true" },
		{ MOCK_RELATION: "behind" }, { MOCK_RELATION: "diverged" }, { MOCK_RELATION: "" },
		{ MOCK_COMPARE_ERROR: "true" },
		{ RELEASE_COMPLETE: "false" },
	]) {
		const result = runPolicy(reconcile, overrides);
		assert.notEqual(result.status, 0, JSON.stringify(overrides));
		assert.doesNotMatch(result.output, /should_verify_published=true|published_source_sha=/);
	}
	const identical = runPolicy(reconcile, { GITHUB_SHA: source, MOCK_RELATION: "identical" });
	assert.equal(identical.status, 0, identical.stderr);
});

test("final published identity accepts only exact/ancestor sources with an exactly matching release and tag", reconciliationShell, () => {
	for (const overrides of [
		{ published_source_sha: foreign },
		{ PUBLISHED_SOURCE_SHA: "" }, { PUBLISHED_SOURCE_SHA: "main" },
		{ PUBLISHED_SOURCE_SHA: foreign },
		{ MOCK_TARGET: foreign }, { MOCK_TARGET: "" },
		{ MOCK_TAG: foreign }, { MOCK_TAG: "" }, { MOCK_TAG_ERROR: "true" },
		{ MOCK_RELATION: "behind" }, { MOCK_RELATION: "diverged" }, { MOCK_RELATION: "" },
		{ MOCK_COMPARE_ERROR: "true" }, { SHOULD_PUBLISH_NPM: "" },
	]) {
		const result = runPolicy(finalIdentity!, overrides);
		assert.notEqual(result.status, 0, JSON.stringify(overrides));
	}
	const identical = runPolicy(finalIdentity!, { GITHUB_SHA: source, MOCK_RELATION: "identical" });
	assert.equal(identical.status, 0, identical.stderr);
	const fresh = runPolicy(finalIdentity!, {
		SHOULD_PUBLISH_NPM: "true", GITHUB_SHA: source, PUBLISHED_SOURCE_SHA: "", MOCK_RELATION: "identical",
	});
	assert.equal(fresh.status, 0, fresh.stderr);
	assert.notEqual(runPolicy(finalIdentity!, { SHOULD_PUBLISH_NPM: "true" }).status, 0,
		"a new publication cannot reuse a different ancestor's provenance");
});

test("final integrity cannot silently compare against missing skipped-build outputs", reconciliationShell, () => {
	assert.equal(runPolicy(finalIntegrity!).status, 0);
	for (const overrides of [
		{ EXPECTED_INTEGRITY: "" }, { EXPECTED_INTEGRITY: "", published_integrity: "" },
		{ published_integrity: "" }, { EXPECTED_INTEGRITY: `${integrity}wrong` },
	]) {
		assert.notEqual(runPolicy(finalIntegrity!, overrides).status, 0, JSON.stringify(overrides));
	}
});

test("final verification is admitted only after the explicit successful version gate and required jobs", () => {
	for (const result of ["failure", "cancelled", "skipped"]) {
		assert.equal(finalJobAllowed({ "version-check": {
			result, outputs: { should_verify_published: "true", should_run_verify: "false",
				should_publish_npm: "false", should_release_github: "false" },
		} }), false);
	}
	assert.equal(finalJobAllowed({ "version-check": { result: "success", outputs: {} } }), false);
	const freshVersion = {
		result: "success", outputs: { should_verify_published: "true", should_run_verify: "true",
			should_publish_npm: "true", should_release_github: "true" },
	};
	const fresh = { "version-check": freshVersion, verify: { result: "success" },
		"publish-npm": { result: "success" }, "release-github": { result: "success" } };
	assert.equal(finalJobAllowed(fresh), true);
	for (const job of ["verify", "publish-npm", "release-github"]) {
		for (const result of ["failure", "cancelled", "skipped"]) {
			assert.equal(finalJobAllowed({ ...fresh, [job]: { result } }), false);
		}
	}
});
