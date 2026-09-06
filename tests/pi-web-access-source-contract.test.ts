import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
	assertPiWebAccessPatchedSources,
	PI_WEB_ACCESS_PATCH_TARGETS,
	patchPiWebAccessSources,
	syncPiWebAccessForwardFiles,
} from "../scripts/lib/pi-web-access-patch.mjs";

function reviewedSources(): Map<string, string> {
	return new Map(
		PI_WEB_ACCESS_PATCH_TARGETS.map((relativePath) => [
			relativePath,
			readFileSync(
				join(
					import.meta.dirname,
					"..",
					"fixtures",
					"pi-web-access-0.28.0",
					relativePath,
				),
				"utf8",
			),
		]),
	);
}

test("pi-web-access source contract rejects marker-preserving fail-open drift", () => {
	const baseline = reviewedSources();
	const unreviewed = new Map(baseline);
	unreviewed.set(
		"utils.ts",
		(unreviewed.get("utils.ts") ?? "")
			.replace(
				"|| isProxyBypassedUrl(url)) {",
				"|| (false && isProxyBypassedUrl(url))) {",
			),
	);
	assert.throws(
		() => patchPiWebAccessSources(unreviewed, "fail-open baseline"),
		/unreviewed digest/,
	);

	const patched = patchPiWebAccessSources(baseline, "reviewed baseline");
	const disabled = new Map(patched);
	disabled.set(
		"firecrawl.ts",
		(disabled.get("firecrawl.ts") ?? "")
			.replace(
				"redirectUrl.origin === loopbackApiOrigin",
				"true || redirectUrl.origin === loopbackApiOrigin",
			),
	);
	assert.throws(
		() => assertPiWebAccessPatchedSources(disabled, "fail-open patched tree"),
		/expected .* found/,
	);
});

test("pi-web-access source contract covers every production file added or changed by 0.28.0", () => {
	for (const relativePath of [
		"credential-source.ts",
		"curator-page.ts",
		"curator-server.ts",
		"gemini-url-context.ts",
		"github-api.ts",
		"index.ts",
		"extract.ts",
		"gemini-search.ts",
		"github-extract.ts",
		"page-query.ts",
		"perplexity.ts",
		"utils.ts",
		"xai-search.ts",
		"mistral-search.ts",
		"xcrawl.ts",
	]) {
		assert.ok(
			PI_WEB_ACCESS_PATCH_TARGETS.includes(relativePath),
			`${relativePath} is missing from the exact source contract`,
		);
		const mutated = reviewedSources();
		mutated.set(
			relativePath,
			`${mutated.get(relativePath) ?? ""}\n// unreviewed source drift\n`,
		);
		assert.throws(
			() => patchPiWebAccessSources(mutated, `unreviewed ${relativePath}`),
			new RegExp(`${relativePath.replace(".", "\\.")}: unreviewed digest`),
		);
	}
});

test("pi-web-access exact forward fixtures normalize Windows checkout line endings", (t) => {
	const root = mkdtempSync(join(tmpdir(), "feynman-web-fixture-crlf-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const fixtureRoot = join(root, "fixtures", "pi-web-access-0.28.0");
	const packageRoot = join(root, "package");
	mkdirSync(fixtureRoot, { recursive: true });
	mkdirSync(packageRoot, { recursive: true });
	const source = readFileSync(
		join(
			import.meta.dirname,
			"..",
			"fixtures",
			"pi-web-access-0.28.0",
			"data-uri-sanitize.ts",
		),
		"utf8",
	);
	writeFileSync(
		join(fixtureRoot, "data-uri-sanitize.ts"),
		source.replace(/\n/g, "\r\n"),
		"utf8",
	);

	assert.equal(
		syncPiWebAccessForwardFiles(root, packageRoot, "0.28.0"),
		true,
	);
	const synced = readFileSync(
		join(packageRoot, "data-uri-sanitize.ts"),
		"utf8",
	);
	assert.equal(synced.includes("\r"), false);
	assert.equal(synced, source);
});

test("pi-web-access patched contract rejects disabled proxy and Windows ADC guards", () => {
	const patched = patchPiWebAccessSources(reviewedSources(), "reviewed baseline");
	for (const [relativePath, original, replacement] of [
		[
			"utils.ts",
			"for (const name of PROXY_ENV_NAMES) env[name] = proxy;",
			"if (false) for (const name of PROXY_ENV_NAMES) env[name] = proxy;",
		],
		[
			"github-issue-pr.ts",
			'...getProxyProcessEnv("https://github.com")',
			"...process.env",
		],
		[
			"gemini-adc.ts",
			'if (currentPlatform === "win32" && appData) {',
			'if (false && currentPlatform === "win32" && appData) {',
		],
	] as const) {
		const disabled = new Map(patched);
		const source = disabled.get(relativePath) ?? "";
		assert.ok(source.includes(original), `${relativePath} mutation anchor is missing`);
		disabled.set(relativePath, source.replace(original, replacement));
		assert.throws(
			() =>
				assertPiWebAccessPatchedSources(
					disabled,
					`disabled ${relativePath}`,
				),
			/expected .* found/,
		);
	}
});
