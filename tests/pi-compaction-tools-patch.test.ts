import assert from "node:assert/strict";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import {
	assertPiCompactionToolsPatchedSource,
	PI_COMPACTION_TOOLS_PATCH_MARKERS,
	PI_COMPACTION_TOOLS_PATCH_TARGETS,
	PI_COMPACTION_TOOLS_RUNTIME_TARGETS,
	patchPiCompactionToolsSource,
} from "../scripts/lib/pi-compaction-tools-patch.mjs";
import {
	assertPiCompactionToolsPackageTree,
	assertPiCompactionToolsPrunedDependencyTree,
	isPiCompactionToolsNativePackageRoot,
	resolvePiCompactionToolsPackageTargets,
	verifyPiCompactionToolsBehavior,
} from "../scripts/lib/pi-compaction-tools-verifier.mjs";

const appRoot = process.cwd();

test("Pi compaction patch covers every bundled 0.84.2 summary path", () => {
	const patchSource = readFileSync(
		resolve(appRoot, "scripts", "lib", "pi-compaction-tools-patch.mjs"),
		"utf8",
	);
	assert.match(patchSource, /90305d90a049d3f7784f15821d117fc6932248e7/);
	assert.match(patchSource, /97fa14e39cfce78c273a36b2d9e8509cd5bc6b72/);
	assert.match(
		patchSource,
		/Removal condition: delete this patch after Feynman adopts a released Pi/,
	);

	const codingAgentRoot = resolve(
		appRoot,
		"node_modules",
		"@earendil-works",
		"pi-coding-agent",
	);
	for (const relativePath of PI_COMPACTION_TOOLS_PATCH_TARGETS) {
		const source = readFileSync(
			resolve(codingAgentRoot, ...relativePath.split("/")),
			"utf8",
		);
		assert.doesNotThrow(() => assertPiCompactionToolsPatchedSource(relativePath, source));
		assert.equal(patchPiCompactionToolsSource(relativePath, source), source);
	}
});

test("Pi compaction patch applies exact request and response guards", () => {
	const compaction = patchPiCompactionToolsSource(
		"dist/core/compaction/compaction.js",
		[
			"function createSummarizationOptions(",
			"        cacheRetention: \"none\",",
			"        sessionId: uuidv7(),",
			'    if (response.stopReason === "error") {',
			'        throw new Error(`Summarization failed: ${response.errorMessage || "Unknown error"}`);',
			"    }",
			"    const textContent = contentText(response.content);",
			'    if (response.stopReason === "error") {',
			'        throw new Error(`Turn prefix summarization failed: ${response.errorMessage || "Unknown error"}`);',
			"    }",
			"    return {",
			"//# sourceMappingURL=compaction.js.map",
		].join("\n"),
	);
	for (const marker of [
		PI_COMPACTION_TOOLS_PATCH_MARKERS.request,
		PI_COMPACTION_TOOLS_PATCH_MARKERS.historyResponse,
		PI_COMPACTION_TOOLS_PATCH_MARKERS.prefixResponse,
	]) {
		assert.match(compaction, new RegExp(marker));
	}
	assert.match(compaction, /toolChoice: "none"/);
	assert.match(compaction, /Summarization attempted to call a tool/);
	assert.match(compaction, /Turn prefix summarization attempted to call a tool/);
	assert.match(compaction, /generation hit the token cap and the summary is incomplete/);
	assert.doesNotMatch(compaction, /sourceMappingURL/);

	const branch = patchPiCompactionToolsSource(
		"dist/core/compaction/branch-summarization.js",
		[
			'import { completeSummarization, estimateTokens } from "./compaction.js";',
			'    if (response.stopReason === "error") {',
			'        return { error: response.errorMessage || "Summarization failed" };',
			"    }",
			"    let summary = contentText(response.content);",
			"//# sourceMappingURL=branch-summarization.js.map",
		].join("\n"),
	);
	assert.match(branch, new RegExp(PI_COMPACTION_TOOLS_PATCH_MARKERS.branchResponse));
	assert.match(branch, /Branch summarization attempted to call a tool/);
	assert.match(branch, /getSummarizationFailure/);
	assert.doesNotMatch(branch, /sourceMappingURL/);

	const declarations = patchPiCompactionToolsSource(
		"dist/core/compaction/compaction.d.ts",
		[
			"export declare function completeSummarization(",
			"//# sourceMappingURL=compaction.d.ts.map",
		].join("\n"),
	);
	assert.match(declarations, /getSummarizationFailure/);
	assert.match(declarations, /response: AssistantMessage/);
	assert.doesNotMatch(declarations, /sourceMappingURL/);
});

test("Pi package verification requires declarations except in pruned native bundles", () => {
	assert.deepEqual(
		resolvePiCompactionToolsPackageTargets(),
		PI_COMPACTION_TOOLS_PATCH_TARGETS,
	);
	assert.deepEqual(
		resolvePiCompactionToolsPackageTargets({ prunedNative: true }),
		PI_COMPACTION_TOOLS_RUNTIME_TARGETS,
	);
	const readWithoutDeclarations = (path: string) => {
		if (path.endsWith("compaction.d.ts")) {
			throw new Error("declaration intentionally absent");
		}
		return readFileSync(path, "utf8");
	};
	assert.equal(isPiCompactionToolsNativePackageRoot(appRoot), false);
	assert.throws(
		() => assertPiCompactionToolsPackageTree(
			appRoot,
			readWithoutDeclarations,
			{ prunedNative: true },
		),
		/requires a native bundle package root/,
	);
	assert.throws(
		() => assertPiCompactionToolsPackageTree(appRoot, readWithoutDeclarations),
		/declaration intentionally absent/,
	);

	const nativeRoot = mkdtempSync(resolve(tmpdir(), "feynman-native-compaction-test-"));
	const nativeAppRoot = resolve(nativeRoot, "app");
	const nativeNodeModulesRoot = resolve(nativeAppRoot, "node_modules");
	const nativeNodePath =
		process.platform === "win32"
			? resolve(nativeRoot, "node", "node.exe")
			: resolve(nativeRoot, "node", "bin", "node");
	try {
		mkdirSync(nativeNodeModulesRoot, { recursive: true });
		mkdirSync(resolve(nativeNodePath, ".."), { recursive: true });
		writeFileSync(nativeNodePath, "");
		assert.equal(isPiCompactionToolsNativePackageRoot(nativeAppRoot), false);
		const forbiddenDeclaration = resolve(
			nativeNodeModulesRoot,
			"unrelated-package",
			"index.d.ts",
		);
		mkdirSync(resolve(forbiddenDeclaration, ".."), { recursive: true });
		writeFileSync(forbiddenDeclaration, "export {};\n");
		assert.throws(
			() => assertPiCompactionToolsPrunedDependencyTree(nativeAppRoot),
			/retained .*index\.d\.ts/,
		);
		rmSync(forbiddenDeclaration);
		assert.doesNotThrow(() =>
			assertPiCompactionToolsPrunedDependencyTree(nativeAppRoot));
	} finally {
		rmSync(nativeRoot, { recursive: true, force: true });
	}

	const nativeBuilderSource = readFileSync(
		resolve(appRoot, "scripts", "build-native-bundle.mjs"),
		"utf8",
	);
	assert.match(
		nativeBuilderSource,
		/verify-package-artifact\.mjs"[\s\S]*appDir,[\s\S]*"--pruned-native"/,
	);
	assert.ok(
		nativeBuilderSource.indexOf("installBundledNode(bundleRoot, target, stagingRoot);") <
			nativeBuilderSource.indexOf("const nativeNodeExecutable = resolveBundledNodeExecutable"),
		"native identity must exist before pruned artifact verification",
	);
	assert.match(
		nativeBuilderSource,
		/run\(\s*nativeNodeExecutable,[\s\S]*verify-package-artifact\.mjs/,
	);
	const packageVerifierSource = readFileSync(
		resolve(appRoot, "scripts", "verify-package-artifact.mjs"),
		"utf8",
	);
	assert.match(
		packageVerifierSource,
		/assertPiCompactionToolsPackageTree\(packageRoot, readText, \{ prunedNative \}\)/,
	);
});

test("Pi summary calls disable tools and reject tool-call responses", async () => {
	await verifyPiCompactionToolsBehavior(appRoot);
});
