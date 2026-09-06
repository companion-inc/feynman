import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const { parse } = createRequire(import.meta.url)("yaml") as typeof import("yaml");
const read = (path: string) => readFileSync(path, "utf8");
const workflowText = read(".github/workflows/deploy-website.yml");
const workflow = parse(workflowText);
const job = workflow.jobs.deploy;
const steps = job.steps;
const step = (name: string) => steps.find((entry: { name?: string }) => entry.name === name);
const repository = "advaitpaliwal/feynman";
const publisherPath = ".github/workflows/publish.yml";
const sha = "a".repeat(40);
const newerSha = "b".repeat(40);

function trustedEvent() {
	return {
		repository,
		event_name: "workflow_run",
		ref: "refs/heads/main",
		event: {
			workflow_run: {
				name: "Publish and Release",
				path: publisherPath,
				conclusion: "success",
				event: "push",
				head_branch: "main",
				repository: { full_name: repository },
				head_repository: { full_name: repository, fork: false },
			},
		},
	};
}

// Local model, not GitHub's expression engine: covers the enumerated admission
// cases. API qualification below executes the real strict JavaScript checks.
function allowed(github: unknown) {
	try {
		return new Function("github", `return (${job.if});`)(github) === true;
	} catch {
		return false;
	}
}

function publisher(headSha = sha) {
	return {
		...trustedEvent().event.workflow_run,
		id: 123,
		workflow_id: 42,
		status: "completed",
		head_sha: headSha,
	};
}

function runStep(name: string, env: Record<string, string | undefined> = {}) {
	const root = mkdtempSync(join(tmpdir(), "feynman-pages-guard-"));
	try {
		const bin = join(root, "bin");
		mkdirSync(bin);
		writeFileSync(join(root, "package.json"), JSON.stringify({
			name: env.PACKAGE_NAME ?? "@advaitpaliwal/feynman",
			version: "0.3.48",
		}));
		writeFileSync(join(bin, "npm"), `#!/bin/bash
printf '%s\\n' "$@" > "$MOCK_ARGS"
printf '%s' "$MOCK_PUBLISHED"
exit "\${MOCK_EXIT:-0}"
`, { mode: 0o755 });
		writeFileSync(join(bin, "git"), `#!/bin/bash
case "$*" in
  "rev-parse HEAD") printf '%s\\n' "$MOCK_HEAD" ;;
  "ls-remote https://github.com/advaitpaliwal/feynman.git refs/heads/main")
    printf '%s\\trefs/heads/main\\n' "$MOCK_MAIN"
    exit "\${MOCK_EXIT:-0}" ;;
  *) exit 99 ;;
esac
`, { mode: 0o755 });
		writeFileSync(join(bin, "gh"), `#!${process.execPath}
const { appendFileSync } = require("node:fs");
const args = process.argv.slice(2);
appendFileSync(process.env.MOCK_API_ARGS, JSON.stringify(args) + "\\n");
if (args[0] !== "api" || args[1] !== "--hostname" || args[2] !== "github.com") process.exit(99);
const endpoint = args[3].replace(/^repos\\/advaitpaliwal\\/feynman\\//, "");
if (endpoint === args[3]) process.exit(99);
if (endpoint === process.env.MOCK_API_FAIL_ENDPOINT) process.exit(1);
let result;
if (endpoint === "git/ref/heads/main") result = process.env.MOCK_API_REF;
else if (endpoint === "actions/workflows/publish.yml") result = process.env.MOCK_API_WORKFLOW;
else if (/^actions\\/workflows\\/\\d+\\/runs\\?/.test(endpoint) &&
         args[4] === "--paginate" && args[5] === "--slurp") result = process.env.MOCK_API_PAGES;
else process.exit(99);
process.stdout.write(result);
`, { mode: 0o755 });
		const wranglerBin = join(root, "feynman-wrangler", "node_modules", ".bin");
		mkdirSync(wranglerBin, { recursive: true });
		writeFileSync(join(wranglerBin, "wrangler"), `#!/bin/bash
printf '%s\\n' "$@" > "$MOCK_ARGS"
`, { mode: 0o755 });
		const output = join(root, "output");
		const args = join(root, "args");
		const apiArgs = join(root, "api-args");
		writeFileSync(output, "");
		writeFileSync(args, "");
		writeFileSync(apiArgs, "");
		const result = spawnSync("bash", ["-c", step(name).run], {
			cwd: root,
			encoding: "utf8",
			env: {
				PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`,
				GITHUB_OUTPUT: output,
				RUNNER_TEMP: root,
				MOCK_ARGS: args,
				MOCK_API_ARGS: apiArgs,
				MOCK_API_REF: JSON.stringify({ ref: "refs/heads/main", object: { type: "commit", sha } }),
				MOCK_API_WORKFLOW: JSON.stringify({ id: 42, name: "Publish and Release", path: publisherPath }),
				MOCK_API_PAGES: JSON.stringify([{ workflow_runs: [publisher()] }]),
				MOCK_PUBLISHED: "0.3.48",
				MOCK_HEAD: sha,
				MOCK_MAIN: sha,
				...env,
			},
		});
		assert.ifError(result.error);
		return {
			status: result.status, output: read(output), args: read(args),
			apiCalls: read(apiArgs).trim().split("\n").filter(Boolean).map(line => JSON.parse(line)),
			stdout: result.stdout, stderr: result.stderr,
		};
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

test("Pages config is minimal and generated Wrangler state is ignored at either level", () => {
	assert.deepEqual(JSON.parse(read("website/wrangler.jsonc")), {
		name: "feynman",
		pages_build_output_dir: "./dist",
		compatibility_date: "2026-09-06",
	});
	for (const path of [".wrangler/state", "website/.wrangler/state"]) {
		assert.equal(spawnSync("git", ["check-ignore", "--no-index", path]).status, 0);
	}
});

test("only successful same-repository main pushes or main manual dispatches qualify", () => {
	assert.deepEqual(workflow.on, {
		workflow_run: { workflows: ["Publish and Release"], types: ["completed"], branches: ["main"] },
		workflow_dispatch: null,
	});
	assert.equal(allowed(trustedEvent()), true);
	assert.equal(allowed({ ...trustedEvent(), event_name: "workflow_dispatch", event: {} }), true);
	for (const change of [
		{ conclusion: "failure" }, { conclusion: "cancelled" }, { conclusion: null },
		{ event: "pull_request" }, { event: "pull_request_target" }, { event: "workflow_dispatch" },
		{ head_branch: "feature" }, { head_branch: null }, { name: "Other workflow" },
		{ path: ".github/workflows/other.yml" }, { path: null },
		{ repository: { full_name: "attacker/feynman" } },
		{ head_repository: { full_name: "attacker/feynman", fork: true } },
		{ head_repository: { full_name: repository, fork: true } },
		{ head_repository: null },
	]) {
		const event = trustedEvent();
		Object.assign(event.event.workflow_run, change);
		assert.equal(allowed(event), false, JSON.stringify(change));
	}
	for (const change of [
		{ repository: "attacker/feynman" }, { event_name: "push" },
		{ event_name: "pull_request_target" }, { event: {} },
		{ event_name: "workflow_dispatch", ref: "refs/heads/feature" },
		{ event_name: "workflow_dispatch", ref: "refs/tags/main" },
	]) {
		assert.equal(allowed({ ...trustedEvent(), ...change }), false, JSON.stringify(change));
	}
});

test("initiating SHA is validated before API access without falling back to the default branch", () => {
	const name = "Validate initiating event SHA";
	assert.equal(runStep(name, { GITHUB_EVENT_NAME: "workflow_run", RELEASE_SHA: sha, MANUAL_SHA: newerSha }).output, `sha=${sha}\n`);
	assert.equal(runStep(name, { GITHUB_EVENT_NAME: "workflow_dispatch", MANUAL_SHA: newerSha }).output, `sha=${newerSha}\n`);
	for (const RELEASE_SHA of ["", "main", "a".repeat(39), `${sha}\nevil`]) {
		assert.notEqual(runStep(name, { GITHUB_EVENT_NAME: "workflow_run", RELEASE_SHA, MANUAL_SHA: newerSha }).status, 0);
	}
	assert.notEqual(runStep(name, { GITHUB_EVENT_NAME: "pull_request", RELEASE_SHA: sha }).status, 0);
	assert.equal(steps[0].name, name);
	assert.equal(steps[1].name, "Resolve current qualified main");
	assert.equal(steps[1].env.INITIATING_SHA, "${{ steps.initiating.outputs.sha }}");
	const checkout = steps.find((entry: { uses?: string }) => entry.uses?.startsWith("actions/checkout@"));
	const setup = steps.find((entry: { uses?: string }) => entry.uses?.startsWith("actions/setup-node@"));
	const publishSteps = parse(read(".github/workflows/publish.yml")).jobs["version-check"].steps;
	assert.equal(checkout.uses, publishSteps[0].uses);
	assert.equal(setup.uses, publishSteps[1].uses);
	assert.deepEqual(checkout.with, {
		repository,
		ref: "${{ steps.source.outputs.sha }}",
		"persist-credentials": false,
	});
	assert.equal(setup.with["node-version-file"], ".nvmrc");
});

test("current main is qualified by exact publisher identity and paginated API evidence", () => {
	const result = runStep("Resolve current qualified main", {
		INITIATING_SHA: newerSha,
		MOCK_API_PAGES: JSON.stringify([{ workflow_runs: [] }, { workflow_runs: [publisher()] }]),
	});
	assert.equal(result.status, 0, result.stderr);
	assert.equal(result.output, `sha=${sha}\npublisher_run_id=123\neligible=true\n`);
	assert.deepEqual(result.apiCalls, [
		["api", "--hostname", "github.com", `repos/${repository}/git/ref/heads/main`],
		["api", "--hostname", "github.com", `repos/${repository}/actions/workflows/publish.yml`],
		["api", "--hostname", "github.com",
			`repos/${repository}/actions/workflows/42/runs?branch=main&event=push&status=success&head_sha=${sha}&per_page=100`,
			"--paginate", "--slurp"],
	]);
});

test("absent, failed, fork, wrong-SHA or other-workflow publishers never qualify main", () => {
	for (const change of [
		{ status: "in_progress" }, { status: null }, { conclusion: "failure" },
		{ conclusion: "cancelled" }, { conclusion: null }, { event: "pull_request" },
		{ event: "pull_request_target" }, { event: "workflow_dispatch" },
		{ head_branch: "feature" }, { head_sha: newerSha }, { head_sha: null },
		{ workflow_id: 99 }, { workflow_id: null }, { id: null },
		{ name: "Other workflow" }, { path: ".github/workflows/other.yml" }, { path: null },
		{ repository: { full_name: "attacker/feynman" } }, { repository: null },
		{ head_repository: { full_name: "attacker/feynman", fork: false } },
		{ head_repository: { full_name: repository, fork: true } },
		{ head_repository: { full_name: repository } },
		{ head_repository: { full_name: repository, fork: "false" } },
		{ head_repository: null },
	]) {
		const result = runStep("Resolve current qualified main", {
			MOCK_API_PAGES: JSON.stringify([{ workflow_runs: [{ ...publisher(), ...change }] }]),
		});
		assert.equal(result.status, 0, result.stderr);
		assert.equal(result.output, "", JSON.stringify(change));
	}
	for (const runs of [[], [null], [{}]]) {
		const result = runStep("Resolve current qualified main", {
			MOCK_API_PAGES: JSON.stringify([{ workflow_runs: runs }]),
		});
		assert.equal(result.status, 0, result.stderr);
		assert.equal(result.output, "");
		assert.match(result.stdout, /no successful completed same-repository/);
	}
});

test("API errors, malformed main refs and unresolved publisher identities fail closed before checkout", () => {
	for (const env of [
		{ MOCK_API_FAIL_ENDPOINT: "git/ref/heads/main" },
		{ MOCK_API_FAIL_ENDPOINT: "actions/workflows/publish.yml" },
		{ MOCK_API_FAIL_ENDPOINT: `actions/workflows/42/runs?branch=main&event=push&status=success&head_sha=${sha}&per_page=100` },
		{ MOCK_API_REF: "invalid-json" },
		{ MOCK_API_REF: "{}" },
		{ MOCK_API_REF: JSON.stringify({ ref: "refs/heads/main", object: { type: "commit", sha: "main" } }) },
		{ MOCK_API_REF: JSON.stringify({ ref: "refs/heads/main", object: { type: "commit", sha: `${sha}\nevil` } }) },
		{ MOCK_API_REF: JSON.stringify({ ref: "refs/heads/other", object: { type: "commit", sha } }) },
		{ MOCK_API_REF: JSON.stringify({ ref: "refs/heads/main", object: { type: "tag", sha } }) },
		{ MOCK_API_WORKFLOW: "{}" },
		{ MOCK_API_WORKFLOW: JSON.stringify({ id: 42, path: ".github/workflows/other.yml", name: "Publish and Release" }) },
		{ MOCK_API_WORKFLOW: JSON.stringify({ id: 42, path: publisherPath, name: "Other workflow" }) },
		{ MOCK_API_PAGES: "invalid-json" }, { MOCK_API_PAGES: "{}" },
		{ MOCK_API_PAGES: "[null]" }, { MOCK_API_PAGES: '[{"workflow_runs":null}]' },
	]) {
		const result = runStep("Resolve current qualified main", env);
		assert.notEqual(result.status, 0, JSON.stringify(env));
		assert.equal(result.output, "");
	}
	for (const entry of steps.slice(2, -1)) {
		assert.equal(entry.if, "steps.source.outputs.eligible == 'true'", entry.name ?? entry.uses);
	}
});

test("delayed A replaces pending B but the surviving serialized invocation deploys qualified B", () => {
	assert.equal(workflow.concurrency["cancel-in-progress"], false);
	// Model GitHub's default single-pending-slot replacement, not a live scheduler.
	const active = { name: "A active", event: "workflow_run", initiatingSha: sha };
	let pending = { name: "B pending", event: "workflow_run", initiatingSha: newerSha };
	const canceled: string[] = [];
	const enqueue = (run: typeof pending) => {
		canceled.push(pending.name);
		pending = run;
	};
	enqueue({ name: "A delayed", event: "workflow_run", initiatingSha: sha });
	assert.deepEqual(canceled, ["B pending"]);
	assert.equal(active.name, "A active");
	assert.equal(pending.name, "A delayed");
	const activeGuard = runStep("Skip superseded source before upload", { SOURCE_SHA: sha, MOCK_MAIN: newerSha });
	assert.equal(activeGuard.status, 0);
	assert.equal(activeGuard.output, "");

	// Both the surviving automatic invocation and a manual recovery reconcile B.
	for (const event of [pending.event, "workflow_dispatch"]) {
		assert.equal(allowed({ ...trustedEvent(), event_name: event }), true);
		const initiating = runStep("Validate initiating event SHA", {
			GITHUB_EVENT_NAME: event, RELEASE_SHA: pending.initiatingSha, MANUAL_SHA: sha,
		});
		assert.equal(initiating.status, 0);
		assert.equal(initiating.output, `sha=${sha}\n`);
		const unqualified = runStep("Resolve current qualified main", {
			INITIATING_SHA: sha,
			MOCK_API_REF: JSON.stringify({ ref: "refs/heads/main", object: { type: "commit", sha: newerSha } }),
			MOCK_API_PAGES: JSON.stringify([{ workflow_runs: [publisher(sha)] }]),
		});
		assert.equal(unqualified.status, 0, unqualified.stderr);
		assert.equal(unqualified.output, "", "neither trigger may fall back to successful older A");
		const selected = runStep("Resolve current qualified main", {
			INITIATING_SHA: sha,
			MOCK_API_REF: JSON.stringify({ ref: "refs/heads/main", object: { type: "commit", sha: newerSha } }),
			MOCK_API_PAGES: JSON.stringify([{ workflow_runs: [publisher(sha), publisher(newerSha)] }]),
		});
		assert.equal(selected.status, 0, selected.stderr);
		assert.equal(selected.output, `sha=${newerSha}\npublisher_run_id=123\neligible=true\n`);
		const selectedSha = selected.output.split("\n")[0].slice("sha=".length);
		const guard = runStep("Skip superseded source before upload", {
			SOURCE_SHA: selectedSha, MOCK_HEAD: selectedSha, MOCK_MAIN: newerSha,
		});
		assert.equal(guard.status, 0);
		assert.equal(guard.output, "deploy=true\n");
		// Run the actual upload shell against a local Wrangler stub. No real
		// credential, Cloudflare operation, or network is used.
		const uploads: string[] = [];
		if (selected.output.includes("eligible=true\n") && guard.output === "deploy=true\n") {
			const upload = runStep("Deploy exact website output", {
				SOURCE_SHA: selectedSha, CLOUDFLARE_API_TOKEN: "fixture-not-a-credential",
			});
			assert.equal(upload.status, 0, upload.stderr);
			uploads.push(upload.args);
		}
		assert.deepEqual(uploads, [
			`pages\ndeploy\n./dist\n--project-name=feynman\n--branch=main\n--commit-hash=${newerSha}\n`,
		]);
	}
});

test("npm gate requires the exact personal manifest version and fails closed", () => {
	const name = "Require the personal npm release";
	const result = runStep(name);
	assert.equal(result.status, 0);
	assert.equal(result.args, "view\n@advaitpaliwal/feynman@0.3.48\nversion\n--registry=https://registry.npmjs.org\n");
	for (const env of [
		{ MOCK_PUBLISHED: "" }, { MOCK_PUBLISHED: "0.3.47" },
		{ MOCK_PUBLISHED: "0.3.48", MOCK_EXIT: "1" },
		{ PACKAGE_NAME: "@companion-ai/feynman" },
	]) {
		assert.notEqual(runStep(name, env).status, 0, JSON.stringify(env));
	}
});

test("freshness gate skips outdated sources and rejects missing refs or network errors", () => {
	const name = "Skip superseded source before upload";
	assert.equal(runStep(name, { SOURCE_SHA: sha }).output, "deploy=true\n");
	const stale = runStep(name, { SOURCE_SHA: sha, MOCK_MAIN: newerSha });
	assert.equal(stale.status, 0);
	assert.equal(stale.output, "");
	assert.match(stale.stdout, /Skipping superseded source/);
	for (const env of [
		{ MOCK_MAIN: "" }, { MOCK_MAIN: "not-a-sha" }, { MOCK_MAIN: `${sha}\n${newerSha}` },
		{ MOCK_EXIT: "1" }, { MOCK_HEAD: newerSha },
	]) {
		const result = runStep(name, { SOURCE_SHA: sha, ...env });
		assert.notEqual(result.status, 0, JSON.stringify(env));
		assert.equal(result.output, "");
	}
	assert.deepEqual(workflow.concurrency, {
		group: "website-production-${{ github.repository }}",
		"cancel-in-progress": false,
	});
});

test("only the final guarded upload gets the token, after build and pinned tool installation", () => {
	assert.deepEqual(workflow.permissions, { contents: "read", actions: "read" });
	assert.deepEqual(workflow.env, { FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: "true" });
	assert.equal(job.env, undefined);
	assert.equal(job.permissions, undefined);
	const deploy = steps.at(-1);
	assert.equal(deploy.name, "Deploy exact website output");
	assert.equal(deploy.if, "steps.source.outputs.eligible == 'true' && steps.current.outputs.deploy == 'true'");
	assert.equal(steps.at(-2).id, "current");
	assert.equal(deploy.env.CLOUDFLARE_API_TOKEN, "${{ secrets.CLOUDFLARE_API_TOKEN }}");
	assert.equal(deploy.env.CLOUDFLARE_ACCOUNT_ID, "2164ee7d134223511b4621d9b163a5ac");
	assert.equal(deploy.env.SOURCE_SHA, "${{ steps.source.outputs.sha }}");
	assert.equal((workflowText.match(/secrets\./g) ?? []).length, 2);
	const resolver = step("Resolve current qualified main");
	assert.equal(resolver.env.GH_TOKEN, "${{ secrets.GITHUB_TOKEN }}");
	for (const entry of steps.slice(0, -1)) {
		assert.doesNotMatch(JSON.stringify(entry), /CLOUDFLARE_API_TOKEN/);
		if (entry !== resolver) assert.doesNotMatch(JSON.stringify(entry), /GH_TOKEN|secrets\./);
		assert.equal(entry["continue-on-error"], undefined);
	}
	assert.doesNotMatch(JSON.stringify(deploy), /GH_TOKEN|GITHUB_TOKEN/);
	const build = step("Validate and build website");
	assert.equal(build["working-directory"], "website");
	assert.match(build.run, /npm ci\nnpm run lint\nnpm run typecheck\nnpm run build/);
	const tooling = step("Install pinned deployment tooling without credentials");
	assert.match(tooling.run, /--prefix "\$RUNNER_TEMP\/feynman-wrangler"/);
	assert.match(tooling.run, /wrangler@4\.107\.0/);
	assert.ok(steps.indexOf(build) < steps.indexOf(tooling));
	assert.ok(steps.indexOf(tooling) < steps.length - 2);
	assert.equal(deploy["working-directory"], "website");
	assert.match(deploy.run, /"\$RUNNER_TEMP\/feynman-wrangler\/node_modules\/\.bin\/wrangler" pages deploy \.\/dist/);
	assert.match(deploy.run, /--project-name=feynman --branch=main --commit-hash="\$SOURCE_SHA"/);
	assert.doesNotMatch(deploy.run, /npx|npm install|npm exec/);
	assert.doesNotMatch(workflowText, /download-artifact|pull_request_target:/);
});
