import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolve } from "node:path";

test("embedded Pi patch covers nested release-bundle copies before artifact verification", () => {
	const source = readFileSync(resolve("scripts", "patch-embedded-pi.mjs"), "utf8");

	assert.match(source, /patchPiInteractiveUpdateNoticeSource/);
	assert.match(
		source,
		/const nestedAgentLoopPaths = resolveNestedPiFiles\(piPackageRoot, "pi-agent-core"/,
	);
	assert.match(
		source,
		/const workspaceNestedAgentLoopPaths = resolveWorkspaceNestedPiFiles\(/,
	);
	assert.match(source, /const nestedTuiPaths = resolveNestedPiFiles\(piPackageRoot, "pi-tui"/);
	assert.match(
		source,
		/const nestedTuiMainScreenPaths = resolveNestedPiFiles\(piPackageRoot, "pi-tui"/,
	);
	assert.match(
		source,
		/const workspaceNestedTuiPaths = resolveWorkspaceNestedPiFiles\(workspaceRoot, "pi-tui"/,
	);
	assert.match(source, /const workspaceNestedTuiMainScreenPaths = resolveWorkspaceNestedPiFiles\(/);
	assert.match(source, /const nestedEditorPaths = resolveNestedPiFiles\(piPackageRoot, "pi-tui"/);
	assert.match(source, /const workspaceNestedEditorPaths = workspaceNestedTuiPaths\.map/);
	assert.match(
		source,
		/\[\s*agentLoopPath,\s*\.\.\.nestedAgentLoopPaths,\s*workspaceAgentLoopPath,\s*\.\.\.workspaceNestedAgentLoopPaths,/,
	);
	assert.match(
		source,
		/\[\s*tuiPath,\s*tuiMainScreenPath,\s*\.\.\.nestedTuiPaths,\s*\.\.\.nestedTuiMainScreenPaths,\s*workspaceTuiPath,\s*workspaceTuiMainScreenPath,\s*\.\.\.workspaceNestedTuiPaths,\s*\.\.\.workspaceNestedTuiMainScreenPaths,/,
	);
	assert.match(
		source,
		/patchFilesIfPresent\(\s*\[interactiveModePath, workspaceInteractiveModePath\],\s*patchPiInteractiveUpdateNoticeSource,/,
	);
	assert.match(
		source,
		/\[\s*editorPath,\s*\.\.\.nestedEditorPaths,\s*workspaceEditorPath,\s*\.\.\.workspaceNestedEditorPaths,/,
	);
});

function extractFunctionBody(source: string, signature: string): string {
	const signatureStart = source.indexOf(signature);
	assert.ok(signatureStart !== -1, `expected to find ${JSON.stringify(signature)}`);
	const braceStart = source.indexOf("{", signatureStart);
	assert.ok(braceStart !== -1, `expected a "{" after ${JSON.stringify(signature)}`);
	let depth = 0;
	for (let i = braceStart; i < source.length; i++) {
		if (source[i] === "{") depth++;
		else if (source[i] === "}") {
			depth--;
			if (depth === 0) return source.slice(braceStart, i + 1);
		}
	}
	throw new Error(`unbalanced braces while scanning ${JSON.stringify(signature)}`);
}

test("ensureBundledPackageLinks does not repeat the runtime workspace integrity check", () => {
	const source = readFileSync(resolve("scripts", "patch-embedded-pi.mjs"), "utf8");

	const functionBody = extractFunctionBody(source, "function ensureBundledPackageLinks() {");
	assert.doesNotMatch(functionBody, /workspaceMatchesRuntime/);

	const allOccurrences = source.match(/ensureBundledPackageLinks\(/g) ?? [];
	assert.equal(
		allOccurrences.length,
		5,
		"expected exactly 1 definition + 4 call sites of ensureBundledPackageLinks; " +
			"if you added or removed one, confirm it only runs after a successful " +
			"workspaceMatchesRuntime() check and update this test",
	);

	const callSites = source.match(/(?<!function )ensureBundledPackageLinks\([^)]*\)/g) ?? [];
	assert.equal(callSites.length, 4);
	for (const callSite of callSites) {
		assert.match(callSite, /^ensureBundledPackageLinks\(\)$/);
	}

	const workspaceUnlockedBody = extractFunctionBody(
		source,
		"function ensurePackageWorkspaceUnlocked(heartbeat) {",
	);

	assert.match(
		workspaceUnlockedBody,
		/if \(workspaceMatchesRuntime\(supportedPackageSpecs\)\) \{\s*reconcileRuntimeWorkspaceRestoreArtifacts\(workspaceDir, \{\s*workspaceIsHealthy: true,\s*\}\);\s*ensureBundledPackageLinks\(\);\s*return;\s*\}/,
	);

	assert.match(
		workspaceUnlockedBody,
		/if \(packagedRestore\.restored && workspaceMatchesRuntime\(supportedPackageSpecs\)\) \{\s*ensureBundledPackageLinks\(\);\s*return;\s*\}/,
	);

	assert.match(
		workspaceUnlockedBody,
		/if \(\s*sourceRestore\.restored &&\s*workspaceMatchesRuntime\(supportedPackageSpecs\)\s*\) \{\s*ensureBundledPackageLinks\(\);\s*return;\s*\}/,
	);

	assert.match(
		workspaceUnlockedBody,
		/if \(!workspaceMatchesRuntime\(supportedPackageSpecs\)\) \{\s*throw new Error\(\s*"Feynman restored an incomplete bundled research runtime\.",\s*\);\s*\}\s*ensureBundledPackageLinks\(\);/,
	);
});
