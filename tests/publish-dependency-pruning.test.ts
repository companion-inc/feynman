import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { planPublishDependencyPruning, prunePublishDependencySourceMaps } from "../scripts/lib/publish-dependency-pruning.mjs";

const map = JSON.stringify({ version: 3, sources: ["source.ts"], names: [], mappings: "AAAA" });
function fixture(run: (root: string) => void) {
	const root = mkdtempSync(join(tmpdir(), "feynman-publish-maps-"));
	const write = (path: string, bytes: string) => {
		mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), bytes);
	};
	const manifest = { name: "fixture", version: "1.0.0", bundleDependencies: ["bundled"] };
	const packages: Record<string, unknown> = { "": manifest };
	for (const [owner, inBundle, dev] of [
		["node_modules/bundled", true, false],
		["node_modules/hoisted", true, false],
		["node_modules/bundled/node_modules/nested", true, false],
		["node_modules/dev-only", false, true],
		["node_modules/bundled/node_modules/not-in-bundle", false, true],
	] as const) {
		packages[owner] = { version: "1.0.0", inBundle, dev };
		write(`${owner}/package.json`, '{"name":"fixture-dep","version":"1.0.0"}');
		write(`${owner}/dist/index.js.map`, map);
		write(`${owner}/dist/index.d.ts.map`, map);
		for (const path of ["dist/index.js", "dist/index.d.ts", "dist/native.node", "LICENSE", "docs/help.md", "examples/demo.js"]) {
			write(`${owner}/${path}`, `retained ${path}`);
		}
	}
	write("package.json", JSON.stringify(manifest));
	write("package-lock.json", JSON.stringify({ lockfileVersion: 3, packages }));
	write("dist/app.js.map", map);
	write(".feynman/npm/node_modules/runtime/file.js.map", map);
	try { run(root); } finally { rmSync(root, { recursive: true, force: true }); }
}

test("dry plan covers bundled hoisted/nested packages only and never mutates", () => {
	fixture(root => {
		const plan = prunePublishDependencySourceMaps(root);
		assert.equal(plan.applied, false);
		assert.equal(plan.files.length, 6);
		assert.equal(plan.totalBytes, Buffer.byteLength(map) * 6);
		assert.ok(plan.files.every(file => existsSync(join(root, file.path))));
		assert.ok(plan.files.some(file => file.owner === "node_modules/hoisted"));
		assert.ok(plan.files.every(file => !file.path.includes("dev-only") && !file.path.includes("not-in-bundle")));
	});
});

test("explicit scratch application preserves JS/types/licenses/native/docs/examples/app/runtime bytes and is idempotent", () => {
	fixture(root => {
		const before = readFileSync(join(root, "package-lock.json"));
		const plan = planPublishDependencyPruning(root);
		assert.equal(prunePublishDependencySourceMaps(root, { apply: true, expectedPlan: plan }).removedFiles, 6);
		assert.ok(plan.files.every(file => !existsSync(join(root, file.path))));
		for (const path of ["dist/index.js", "dist/index.d.ts", "dist/native.node", "LICENSE", "docs/help.md", "examples/demo.js"]) {
			assert.equal(readFileSync(join(root, "node_modules/bundled", path), "utf8"), `retained ${path}`);
		}
		for (const path of ["dist/app.js.map", ".feynman/npm/node_modules/runtime/file.js.map", "node_modules/dev-only/dist/index.js.map"]) {
			assert.equal(readFileSync(join(root, path), "utf8"), map);
		}
		assert.deepEqual(readFileSync(join(root, "package-lock.json")), before);
		assert.equal(prunePublishDependencySourceMaps(root, { apply: true }).removedFiles, 0);
	});
});

test("unknown .map content, license names and explicitly exported map entrypoints are preserved", () => {
	fixture(root => {
		const base = join(root, "node_modules/bundled");
		writeFileSync(join(base, "unknown.map"), "runtime data");
		writeFileSync(join(base, "LICENSE.map"), map);
		writeFileSync(join(base, "entry.map"), map);
		writeFileSync(join(base, "package.json"), JSON.stringify({ version: "1.0.0", exports: { ".": "./entry.map" } }));
		const plan = planPublishDependencyPruning(root);
		assert.equal(plan.files.length, 6);
		assert.equal(plan.skipped.filter(file => file.path.startsWith("node_modules/bundled/")).length, 3);
	});
});

test("stale plan, version drift and bundle-list drift fail before any map deletion", () => {
	for (const change of [
		(root: string) => writeFileSync(join(root, "node_modules/bundled/dist/index.js.map"), map + " "),
		(root: string) => writeFileSync(join(root, "node_modules/bundled/package.json"), '{"version":"2.0.0"}'),
		(root: string) => writeFileSync(join(root, "package.json"), '{"name":"fixture","version":"1.0.0","bundleDependencies":[]}'),
	]) {
		fixture(root => {
			const plan = planPublishDependencyPruning(root); change(root);
			assert.throws(() => prunePublishDependencySourceMaps(root, { apply: true, expectedPlan: plan }));
			assert.ok(plan.files.every(file => existsSync(join(root, file.path))));
		});
	}
});

test("bundle metadata cannot authorize traversal or dev-only deletion", () => {
	for (const owner of ["node_modules/../outside", "node_modules/bundled/dist", "node_modules/bundled"]) {
		fixture(root => {
			const path = join(root, "package-lock.json");
			const lock = JSON.parse(readFileSync(path, "utf8"));
			lock.packages[owner] = { version: "1.0.0", inBundle: true, dev: owner.endsWith("bundled") };
			writeFileSync(path, JSON.stringify(lock));
			assert.throws(() => planPublishDependencyPruning(root));
		});
	}
});

test("only well-formed source maps qualify, including indexed maps", () => {
	fixture(root => {
		const base = join(root, "node_modules/bundled");
		for (const [name, content] of [
			["indexed.map", JSON.stringify({ version: 3, sections: [{ offset: { line: 0, column: 0 }, map: JSON.parse(map) }] })],
			["wrong-version.map", JSON.stringify({ version: 2, sources: [], mappings: "" })],
			["unrelated.map", JSON.stringify({ version: 3, binaryData: "not a source map" })],
		]) writeFileSync(join(base, name), content);
		const plan = planPublishDependencyPruning(root);
		assert.equal(plan.files.length, 7);
		assert.ok(plan.files.some(file => file.path.endsWith("/indexed.map")));
		assert.ok(!plan.files.some(file => file.path.endsWith("/wrong-version.map") || file.path.endsWith("/unrelated.map")));
	});
});

test("executable maps are preserved", { skip: process.platform === "win32" }, () => {
	fixture(root => {
		chmodSync(join(root, "node_modules/bundled/dist/index.js.map"), 0o755);
		assert.equal(planPublishDependencyPruning(root).files.length, 5);
	});
});

test("directory/file symlinks are not followed and owner symlinks fail closed", { skip: process.platform === "win32" }, () => {
	fixture(root => {
		const base = join(root, "node_modules/bundled");
		symlinkSync(join(root, "dist"), join(base, "linked"));
		symlinkSync(join(root, "dist/app.js.map"), join(base, "linked.js.map"));
		assert.equal(planPublishDependencyPruning(root).files.length, 6);
		rmSync(join(root, "node_modules/hoisted"), { recursive: true });
		symlinkSync(base, join(root, "node_modules/hoisted"));
		assert.throws(() => planPublishDependencyPruning(root), /symlink path/);
		assert.ok(existsSync(join(root, "dist/app.js.map")));
	});
});
