import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
	assertPiEditLineEndingsVersion,
	PI_EDIT_LINE_ENDINGS_PATCH_TARGETS,
	patchPiEditLineEndingsSource,
} from "../scripts/lib/pi-edit-line-endings-patch.mjs";
import { computeFileSha256, computeRuntimeTreeHash } from "../scripts/lib/runtime-workspace-integrity.mjs";
import {
	getRuntimeWorkspaceCompletionPath,
	runtimeWorkspaceCompletionMatches,
	writeRuntimeWorkspaceCompletion,
} from "../scripts/lib/runtime-workspace-restore.mjs";

const preparation = readFileSync("scripts/prepare-runtime-workspace.mjs", "utf8");
function extractFunction(start: string, next: string): string {
	const begin = preparation.indexOf(start);
	const end = preparation.indexOf(next, begin + start.length);
	assert.ok(begin >= 0 && end > begin, `missing preparation boundary ${start}`);
	return preparation.slice(begin, end);
}
// Execute the real preparation functions, not an imitation of their target
// selection. Their filesystem operations are confined to this test's temp tree.
const prepareEdits = new Function(
	"workspaceNodeModulesDir", "resolve", "existsSync", "readFileSync", "writeFileSync",
	"assertPiEditLineEndingsVersion", "PI_EDIT_LINE_ENDINGS_PATCH_TARGETS", "patchPiEditLineEndingsSource",
	`${extractFunction("function patchScopedPiWorkspaceFile(", "function patchNestedPiWorkspaceFile(")}
${extractFunction("function patchBundledPiEditLineEndings()", "function patchBundledPiLlamaUsage()")}
return patchBundledPiEditLineEndings();`,
) as (...args: unknown[]) => boolean;

const declaration = `export interface AppliedEditsResult {
    baseContent: string;
    newContent: string;
}
export declare function applyEditsToNormalizedContent(normalizedContent: string, edits: Edit[], path: string): AppliedEditsResult;
`;
const target = "dist/core/tools/edit-diff.d.ts";

for (const present of [true, false]) {
	test(`staged edit preparation ${present ? "patches retained" : "does not recreate pruned"} declarations before completion`, () => {
		const workspace = mkdtempSync(join(tmpdir(), "feynman-preparation-declarations-"));
		try {
			const modules = join(workspace, "node_modules");
			const piRoot = join(modules, "@earendil-works/pi-coding-agent");
			mkdirSync(join(piRoot, "dist/core/tools"), { recursive: true });
			writeFileSync(join(piRoot, "package.json"), JSON.stringify({
				name: "@earendil-works/pi-coding-agent", version: "0.85.1",
			}));
			const path = join(piRoot, target);
			if (present) writeFileSync(path, declaration);
			const runPrepare = () => prepareEdits(
				modules, resolve, existsSync, readFileSync, writeFileSync,
				assertPiEditLineEndingsVersion, PI_EDIT_LINE_ENDINGS_PATCH_TARGETS, patchPiEditLineEndingsSource,
			);
			assert.equal(runPrepare(), present);
			assert.equal(existsSync(path), present);
			if (present) assert.match(readFileSync(path, "utf8"), /writeContent: string/);
			const dependencies = { "@earendil-works/pi-coding-agent": "0.85.1" };
			writeFileSync(join(workspace, "package.json"), JSON.stringify({ name: "test-runtime", dependencies }));
			writeFileSync(join(workspace, "package-lock.json"), JSON.stringify({ lockfileVersion: 3, packages: {
				"": { dependencies },
				"node_modules/@earendil-works/pi-coding-agent": { version: "0.85.1" },
			} }));
			const report = process.report?.getReport?.() as { header?: { glibcVersionRuntime?: string } };
			writeFileSync(join(workspace, ".runtime-manifest.json"), JSON.stringify({
				packageSpecs: ["@earendil-works/pi-coding-agent@0.85.1"],
				nodeAbi: process.versions.modules, platform: process.platform, arch: process.arch, pruneVersion: 9,
				...(process.platform === "linux" ? { libc: report.header?.glibcVersionRuntime ? "glibc" : "musl" } : {}),
			}));
			const lockHash = computeFileSha256(join(workspace, "package-lock.json"));
			const treeHash = computeRuntimeTreeHash(workspace);
			writeRuntimeWorkspaceCompletion(workspace, {
				source: "package-manager", runtimeTreeHash: treeHash, expectedPackageLockSha256: lockHash,
			});
			const markerPath = getRuntimeWorkspaceCompletionPath(workspace);
			const marker = readFileSync(markerPath, "utf8");
			// Bootstrap uses this same transformer on every present declaration.
			if (existsSync(path)) {
				const source = readFileSync(path, "utf8");
				const result = patchPiEditLineEndingsSource(target, source);
				assert.equal(result, source, "warm bootstrap must not change the sealed declaration");
				if (result !== source) writeFileSync(path, result);
			}
			assert.equal(runPrepare(), false);
			assert.equal(computeRuntimeTreeHash(workspace), treeHash);
			assert.equal(computeFileSha256(join(workspace, "package-lock.json")), lockHash);
			assert.equal(readFileSync(markerPath, "utf8"), marker);
			const options = { archivePath: join(workspace, "unused.tgz"), digestPath: join(workspace, "unused.sha256") };
			assert.equal(runtimeWorkspaceCompletionMatches(workspace, options), true);
			if (present) {
				writeFileSync(path, declaration);
				assert.equal(runtimeWorkspaceCompletionMatches(workspace, options), false,
					"restoring unpatched declaration bytes must invalidate completion");
			}
		} finally {
			rmSync(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
		}
	});
}
