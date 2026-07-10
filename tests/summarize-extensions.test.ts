import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { summarizeExtensions } from "../src/workbench/package-resources.js";

function writePackage(root: string, name: string, manifest: Record<string, unknown>): void {
	const packageRoot = join(root, ".feynman", "npm", "node_modules", ...name.split("/"));
	mkdirSync(packageRoot, { recursive: true });
	writeFileSync(join(packageRoot, "package.json"), JSON.stringify({ name, ...manifest }, null, 2));
}

test("summarizeExtensions lists project and package-provided extensions", () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-extensions-"));
	try {
		mkdirSync(join(root, ".feynman"), { recursive: true });
		writeFileSync(join(root, ".feynman", "settings.json"), JSON.stringify({
			packages: ["npm:pi-web-access"],
		}, null, 2));
		writePackage(root, "pi-web-access", {
			version: "0.13.0",
			description: "Web search, URL fetching, and PDF extraction for Pi.",
			pi: { extensions: ["./index.ts", "./fetch.ts"] },
		});

		mkdirSync(join(root, "extensions"), { recursive: true });
		writeFileSync(join(root, "extensions", "my-tool.ts"), "export default {};\n");
		// Nested files should not be counted as top-level project extensions.
		mkdirSync(join(root, "extensions", "nested"), { recursive: true });
		writeFileSync(join(root, "extensions", "nested", "ignored.ts"), "export default {};\n");

		const summary = summarizeExtensions(root);

		assert.deepEqual(
			summary.projectExtensions.map((extension) => extension.name),
			["my-tool"],
		);
		assert.equal(summary.projectExtensions[0].path, "extensions/my-tool.ts");

		const webAccess = summary.packageExtensions.find((entry) => entry.source === "npm:pi-web-access");
		assert.ok(webAccess, "expected pi-web-access to be reported as providing extensions");
		assert.equal(webAccess.count, 2);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("summarizeExtensions reports empty state when nothing is configured", () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-extensions-empty-"));
	try {
		const summary = summarizeExtensions(root);
		assert.deepEqual(summary.projectExtensions, []);
		assert.deepEqual(summary.packageExtensions, []);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
