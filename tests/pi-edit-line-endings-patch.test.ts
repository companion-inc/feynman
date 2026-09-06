import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import {
	assertPiEditLineEndingsPatchSource,
	assertPiEditLineEndingsVersion,
	PI_EDIT_LINE_ENDINGS_PATCH_TARGETS,
	PI_EDIT_LINE_ENDINGS_RUNTIME_TARGETS,
	patchPiEditLineEndingsSource,
} from "../scripts/lib/pi-edit-line-endings-patch.mjs";
import {
	isNativeBundlePackageRoot,
	resolvePiEditLineEndingsVerificationTargets,
} from "../scripts/verify-installed-runtime.mjs";

const piPackageRoot = resolve(
	process.cwd(),
	"node_modules",
	"@earendil-works",
	"pi-coding-agent",
);

test("Pi edit line-ending patch is exact, complete, and idempotent", () => {
	assert.doesNotThrow(() => assertPiEditLineEndingsVersion("0.85.1", "test"));
	assert.throws(
		() => assertPiEditLineEndingsVersion("0.84.3", "test"),
		/expected 0\.85\.1/,
	);
	for (const relativePath of PI_EDIT_LINE_ENDINGS_PATCH_TARGETS) {
		const source = readFileSync(resolve(piPackageRoot, relativePath), "utf8");
		const patched = patchPiEditLineEndingsSource(relativePath, source);
		assertPiEditLineEndingsPatchSource(relativePath, patched, relativePath);
		assert.equal(
			patchPiEditLineEndingsSource(relativePath, patched),
			patched,
			`${relativePath} was not idempotent`,
		);
	}
});

test("installed verifier requires declarations except in pruned native bundles", () => {
	const root = mkdtempSync(resolve(tmpdir(), "feynman-native-edit-eol-test-"));
	const appRoot = resolve(root, "app");
	try {
		mkdirSync(appRoot, { recursive: true });
		assert.equal(isNativeBundlePackageRoot(appRoot), false);
		assert.deepEqual(
			resolvePiEditLineEndingsVerificationTargets(appRoot, 0),
			PI_EDIT_LINE_ENDINGS_PATCH_TARGETS,
		);
		assert.deepEqual(
			resolvePiEditLineEndingsVerificationTargets(appRoot, 1),
			PI_EDIT_LINE_ENDINGS_RUNTIME_TARGETS,
		);

		const nativeNodePath =
			process.platform === "win32"
				? resolve(root, "node", "node.exe")
				: resolve(root, "node", "bin", "node");
		mkdirSync(resolve(nativeNodePath, ".."), { recursive: true });
		writeFileSync(nativeNodePath, "");
		assert.equal(isNativeBundlePackageRoot(appRoot), true);
		assert.deepEqual(
			resolvePiEditLineEndingsVerificationTargets(appRoot, 0),
			PI_EDIT_LINE_ENDINGS_RUNTIME_TARGETS,
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("patched Pi edit preserves untouched mixed line endings", async () => {
	const root = mkdtempSync(resolve(tmpdir(), "feynman-pi-edit-eol-test-"));
	const fixturePath = resolve(root, "mixed.txt");
	try {
		mkdirSync(root, { recursive: true });
		writeFileSync(fixturePath, Buffer.from("a\r\nb\nc", "utf8"));
		const { createEditTool } = await import(
			`${pathToFileURL(resolve(piPackageRoot, "dist", "core", "tools", "edit.js")).href}?test=${Date.now()}`
		);
		const tool = createEditTool(root);
		await tool.execute(
			"mixed-line-endings",
			{ path: "mixed.txt", edits: [{ oldText: "c", newText: "C" }] },
		);
		assert.deepEqual(readFileSync(fixturePath), Buffer.from("a\r\nb\nC", "utf8"));

		await tool.execute(
			"lf-line-ending",
			{ path: "mixed.txt", edits: [{ oldText: "b", newText: "B" }] },
		);
		assert.deepEqual(readFileSync(fixturePath), Buffer.from("a\r\nB\nC", "utf8"));

		await tool.execute(
			"crlf-line-ending",
			{ path: "mixed.txt", edits: [{ oldText: "a", newText: "A" }] },
		);
		assert.deepEqual(readFileSync(fixturePath), Buffer.from("A\r\nB\nC", "utf8"));

		await tool.execute(
			"mixed-multiline",
			{ path: "mixed.txt", edits: [{ oldText: "A\nB", newText: "a\nb" }] },
		);
		assert.deepEqual(readFileSync(fixturePath), Buffer.from("a\r\nb\nC", "utf8"));

		writeFileSync(fixturePath, Buffer.from("a\rb\rc", "utf8"));
		await tool.execute(
			"cr-line-ending",
			{ path: "mixed.txt", edits: [{ oldText: "b", newText: "B" }] },
		);
		assert.deepEqual(readFileSync(fixturePath), Buffer.from("a\rB\rc", "utf8"));

		writeFileSync(fixturePath, Buffer.from("a  \r\nb\nc", "utf8"));
		await tool.execute(
			"fuzzy-line-ending",
			{ path: "mixed.txt", edits: [{ oldText: "a\nb", newText: "A\nb" }] },
		);
		assert.deepEqual(readFileSync(fixturePath), Buffer.from("A\r\nb\nc", "utf8"));

		writeFileSync(fixturePath, Buffer.from("a  \r\nb\nc", "utf8"));
		await tool.execute(
			"fuzzy-delete-line-ending",
			{ path: "mixed.txt", edits: [{ oldText: "a\nb", newText: "Ab" }] },
		);
		assert.deepEqual(readFileSync(fixturePath), Buffer.from("Ab\nc", "utf8"));

		writeFileSync(fixturePath, Buffer.from("a  \nb\r\nc", "utf8"));
		await tool.execute(
			"fuzzy-delete-reverse-line-ending",
			{ path: "mixed.txt", edits: [{ oldText: "a\nb", newText: "Ab" }] },
		);
		assert.deepEqual(readFileSync(fixturePath), Buffer.from("Ab\r\nc", "utf8"));

		writeFileSync(fixturePath, Buffer.from("a  \rb\rc", "utf8"));
		await tool.execute(
			"fuzzy-delete-cr-line-ending",
			{ path: "mixed.txt", edits: [{ oldText: "a\nb", newText: "Ab" }] },
		);
		assert.deepEqual(readFileSync(fixturePath), Buffer.from("Ab\rc", "utf8"));

		writeFileSync(fixturePath, Buffer.from("first\r\n“last”", "utf8"));
		await tool.execute(
			"fuzzy-insert-crlf-line-ending",
			{ path: "mixed.txt", edits: [{ oldText: '"last"', newText: "LAST\nNEXT" }] },
		);
		assert.deepEqual(readFileSync(fixturePath), Buffer.from("first\r\nLAST\r\nNEXT", "utf8"));

		writeFileSync(fixturePath, Buffer.from("first\r“last”", "utf8"));
		await tool.execute(
			"fuzzy-insert-cr-line-ending",
			{ path: "mixed.txt", edits: [{ oldText: '"last"', newText: "LAST\nNEXT" }] },
		);
		assert.deepEqual(readFileSync(fixturePath), Buffer.from("first\rLAST\rNEXT", "utf8"));
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
