import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const verifierPath = resolve("scripts/verify-installed-esbuild.mjs");
const {
	installedCompilerSurfaces, compilerEnvironment, assertCompilerSurface, verifyInstalledEsbuild,
} = await import(pathToFileURL(verifierPath).href);

test("installed compiler smoke requires root/runtime and both nested Pi compiler copies", () => {
	const root = resolve("fixture-consumer");
	const surfaces = installedCompilerSurfaces(root);
	assert.deepEqual(surfaces.map((surface: { label: string }) => surface.label),
		["root", "root-pi", "runtime", "runtime-pi"]);
	assert.deepEqual(surfaces.map((surface: { modules: string }) => surface.modules), [
		join(root, "node_modules"),
		join(root, "node_modules/@earendil-works/pi-coding-agent/node_modules"),
		join(root, ".feynman/npm/node_modules"),
		join(root, ".feynman/npm/node_modules/@earendil-works/pi-coding-agent/node_modules"),
	]);
});

test("compiler subprocess environment excludes binary overrides, preload code and credentials", () => {
	const names = ["ESBUILD_BINARY_PATH", "NODE_OPTIONS", "NODE_PATH", "NPM_TOKEN"];
	const previous = names.map(name => process.env[name]);
	try {
		for (const name of names) process.env[name] = "fixture-must-not-propagate";
		const home = resolve("isolated-compiler-home");
		const environment = compilerEnvironment(home);
		for (const name of names) assert.equal(environment[name], undefined, name);
		assert.equal(environment.HOME, home);
		assert.equal(environment.USERPROFILE, home);
		assert.equal(environment.TEMP, home);
		assert.equal(environment.TMPDIR, home);
	} finally {
		names.forEach((name, index) => {
			if (previous[index] === undefined) delete process.env[name];
			else process.env[name] = previous[index];
		});
	}
});

test("compiler identity preflight rejects missing copies, wrong version and tampered API code", () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-esbuild-negative-"));
	try {
		assert.throws(() => verifyInstalledEsbuild(root), /ENOENT/);
		const modules = join(root, "node_modules");
		const esbuild = join(modules, "esbuild");
		mkdirSync(join(esbuild, "lib"), { recursive: true });
		const manifestPath = join(esbuild, "package.json");
		writeFileSync(manifestPath, JSON.stringify({ name: "esbuild", version: "0.28.1", bin: { esbuild: "bin/esbuild" } }));
		assert.throws(() => assertCompilerSurface({ label: "fixture", modules }), /wrong compiler version/);
		writeFileSync(manifestPath, JSON.stringify({ name: "esbuild", version: "0.28.2", bin: { esbuild: "bin/esbuild" } }));
		writeFileSync(join(esbuild, "lib/main.js"), 'throw new Error("must not execute unverified code");');
		assert.throws(() => assertCompilerSurface({ label: "fixture", modules }), /API wrapper differs/);
	} finally {
		rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
	}
});

test("compiler verification remains read-only apart from its isolated scratch outputs", () => {
	const source = readFileSync(verifierPath, "utf8");
	assert.doesNotMatch(source, /patchPiEsbuildPackageTree|npm install|npm ci|prepare-runtime-workspace/);
	assert.match(source, /assertEsbuildPlatformPackage/);
	assert.match(source, /esbuild\.transform/);
	assert.match(source, /bundleFacets/);
	assert.match(source, /esbuild\.stop\(\)/);
	assert.match(source, /removeTemporaryTree\(temporaryRoot\)/);
});

test("actual installed esbuild API, portable CLI and Chord bundles work on all four surfaces", () => {
	const proof = verifyInstalledEsbuild(process.cwd());
	assert.equal(proof.version, "0.28.2");
	assert.equal(proof.surfaces.length, 4);
	for (const surface of proof.surfaces) {
		assert.equal(surface.apiTransform, true, surface.label);
		assert.equal(surface.cliVersion, "0.28.2", surface.label);
		assert.equal(surface.chordBundle, true, surface.label);
		assert.match(surface.artifactIntegrity, /^sha256-/);
	}
});
