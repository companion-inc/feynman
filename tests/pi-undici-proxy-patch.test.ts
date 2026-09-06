import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
	assertPiCodingAgentUndiciShrinkwrapSource,
	FEYNMAN_UNDICI_VERSION,
	patchPiCodingAgentUndiciPackageJsonSource,
	patchPiCodingAgentUndiciShrinkwrapSource,
	patchPiUndiciPackageLockSource,
	patchPiUndiciProxyTree,
} from "../scripts/lib/pi-undici-proxy-patch.mjs";

const upstreamVersion = "8.9.0";

function piPackageJson(version = upstreamVersion): string {
	return JSON.stringify({
		name: "@earendil-works/pi-coding-agent",
		version: "0.84.2",
		dependencies: { undici: version, yaml: "2.9.0" },
	});
}

function piShrinkwrap(version = upstreamVersion): string {
	return JSON.stringify({
		lockfileVersion: 3,
		packages: {
			"": { dependencies: { undici: version, yaml: "2.9.0" } },
			"node_modules/undici": { version },
		},
	});
}

test("Pi Undici patch updates the direct dependency and shrinkwrap", () => {
	const manifest = JSON.parse(patchPiCodingAgentUndiciPackageJsonSource(piPackageJson()));
	assert.equal(manifest.dependencies.undici, FEYNMAN_UNDICI_VERSION);

	const shrinkwrap = JSON.parse(patchPiCodingAgentUndiciShrinkwrapSource(piShrinkwrap()));
	assert.equal(shrinkwrap.packages[""].dependencies.undici, FEYNMAN_UNDICI_VERSION);
	assert.equal(shrinkwrap.packages["node_modules/undici"].version, FEYNMAN_UNDICI_VERSION);
	assert.match(shrinkwrap.packages["node_modules/undici"].integrity, /^sha512-/);
	const exactShrinkwrap = JSON.stringify(shrinkwrap);
	assert.doesNotThrow(() =>
		assertPiCodingAgentUndiciShrinkwrapSource(exactShrinkwrap, "test"),
	);
	for (const corrupted of [
		exactShrinkwrap.replace(FEYNMAN_UNDICI_VERSION, upstreamVersion),
		exactShrinkwrap.replace(
			`undici-${FEYNMAN_UNDICI_VERSION}.tgz`,
			"undici-wrong.tgz",
		),
		exactShrinkwrap.replace(/sha512-[^"]+/, "sha512-invalid"),
	]) {
		assert.throws(
			() => assertPiCodingAgentUndiciShrinkwrapSource(corrupted, "test"),
			/Incomplete Pi Undici metadata/,
		);
	}

	assert.throws(
		() => patchPiCodingAgentUndiciPackageJsonSource(piPackageJson("8.6.0")),
		/Unsupported Pi Undici package dependency/,
	);
	assert.throws(
		() => patchPiCodingAgentUndiciShrinkwrapSource(piShrinkwrap("8.6.0")),
		/Unsupported Pi Undici shrinkwrap dependency/,
	);
});

test("reviewed Undici 8.10.2 pin upgrades prior Feynman 8.10.0 metadata without accepting unknown releases", () => {
	assert.equal(FEYNMAN_UNDICI_VERSION, "8.10.2");
	const manifest = JSON.parse(patchPiCodingAgentUndiciPackageJsonSource(piPackageJson("8.10.0")));
	assert.equal(manifest.dependencies.undici, "8.10.2");
	const shrinkwrap = patchPiCodingAgentUndiciShrinkwrapSource(piShrinkwrap("8.10.0"));
	assertPiCodingAgentUndiciShrinkwrapSource(shrinkwrap, "8.10.2 fixture");
	assert.equal(JSON.parse(shrinkwrap).packages["node_modules/undici"].integrity,
		"sha512-/y4/bH9YNU5hi9NIrpOuvGXFcxrj3CMrV+/AYpowAYTpHn8gX/XPFjNy766FPoYY0miQhdW977JFWKGNhBdwyQ==");
	assert.throws(() => patchPiCodingAgentUndiciPackageJsonSource(piPackageJson("99.0.0")), /Unsupported/);
});

test("Pi Undici patch updates the owning package lock", () => {
	const source = JSON.stringify({
		packages: {
			"node_modules/@earendil-works/pi-coding-agent": {
				dependencies: { undici: upstreamVersion },
			},
			"node_modules/@earendil-works/pi-coding-agent/node_modules/undici": {
				version: upstreamVersion,
				inBundle: true,
			},
		},
	});
	const patched = JSON.parse(patchPiUndiciPackageLockSource(source));
	assert.equal(
		patched.packages["node_modules/@earendil-works/pi-coding-agent"].dependencies.undici,
		FEYNMAN_UNDICI_VERSION,
	);
	const entry = patched.packages["node_modules/@earendil-works/pi-coding-agent/node_modules/undici"];
	assert.equal(entry.version, FEYNMAN_UNDICI_VERSION);
	assert.equal(entry.inBundle, true);
});

test("Pi Undici package-lock repair skips stale Pi versions", () => {
	const source = JSON.stringify({
		packages: {
			"node_modules/@earendil-works/pi-coding-agent": {
				version: "0.84.2",
				dependencies: { undici: upstreamVersion },
			},
			"node_modules/@earendil-works/pi-coding-agent/node_modules/undici": {
				version: upstreamVersion,
			},
			"node_modules/@mariozechner/pi-coding-agent": {
				version: "0.80.6",
				dependencies: { undici: upstreamVersion },
			},
			"node_modules/@mariozechner/pi-coding-agent/node_modules/undici": {
				version: upstreamVersion,
			},
		},
	});
	const patched = JSON.parse(patchPiUndiciPackageLockSource(source, "0.84.2"));
	assert.equal(
		patched.packages["node_modules/@earendil-works/pi-coding-agent"].dependencies.undici,
		FEYNMAN_UNDICI_VERSION,
	);
	assert.equal(
		patched.packages["node_modules/@earendil-works/pi-coding-agent/node_modules/undici"].version,
		FEYNMAN_UNDICI_VERSION,
	);
	assert.equal(
		patched.packages["node_modules/@mariozechner/pi-coding-agent"].dependencies.undici,
		upstreamVersion,
	);
	assert.equal(
		patched.packages["node_modules/@mariozechner/pi-coding-agent/node_modules/undici"].version,
		upstreamVersion,
	);
});

test("Pi Undici patch replaces the nested package tree and is idempotent", () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-pi-undici-"));
	const nodeModules = join(root, "node_modules");
	const safePackage = join(nodeModules, "undici");
	const piRoot = join(nodeModules, "@earendil-works", "pi-coding-agent");
	const nestedPackage = join(piRoot, "node_modules", "undici");
	mkdirSync(safePackage, { recursive: true });
	mkdirSync(nestedPackage, { recursive: true });
	writeFileSync(join(safePackage, "package.json"), JSON.stringify({ name: "undici", version: FEYNMAN_UNDICI_VERSION }));
	writeFileSync(join(safePackage, "index.js"), "module.exports = { fixed: true };\n");
	writeFileSync(join(nestedPackage, "package.json"), JSON.stringify({ name: "undici", version: upstreamVersion }));
	writeFileSync(join(piRoot, "package.json"), piPackageJson());
	writeFileSync(join(piRoot, "npm-shrinkwrap.json"), piShrinkwrap());
	writeFileSync(join(root, "package-lock.json"), JSON.stringify({
		packages: {
			"node_modules/@earendil-works/pi-coding-agent": {
				dependencies: { undici: upstreamVersion },
			},
			"node_modules/@earendil-works/pi-coding-agent/node_modules/undici": {
				version: upstreamVersion,
			},
		},
	}));

	assert.equal(patchPiUndiciProxyTree(nodeModules), true);
	assert.equal(JSON.parse(readFileSync(join(nestedPackage, "package.json"), "utf8")).version, FEYNMAN_UNDICI_VERSION);
	assert.equal(JSON.parse(readFileSync(join(piRoot, "package.json"), "utf8")).dependencies.undici, FEYNMAN_UNDICI_VERSION);
	assert.equal(
		JSON.parse(readFileSync(join(piRoot, "npm-shrinkwrap.json"), "utf8")).packages["node_modules/undici"].version,
		FEYNMAN_UNDICI_VERSION,
	);
	assert.equal(
		JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"))
			.packages["node_modules/@earendil-works/pi-coding-agent/node_modules/undici"].version,
		FEYNMAN_UNDICI_VERSION,
	);
	assert.equal(patchPiUndiciProxyTree(nodeModules), false);
});

test("embedded Pi resolves the patched Undici package", () => {
	const piRoot = join(process.cwd(), "node_modules", "@earendil-works", "pi-coding-agent");
	const manifest = JSON.parse(readFileSync(join(piRoot, "package.json"), "utf8"));
	const shrinkwrap = JSON.parse(readFileSync(join(piRoot, "npm-shrinkwrap.json"), "utf8"));
	const nested = JSON.parse(readFileSync(join(piRoot, "node_modules", "undici", "package.json"), "utf8"));
	assert.equal(manifest.dependencies.undici, FEYNMAN_UNDICI_VERSION);
	assert.equal(shrinkwrap.packages[""].dependencies.undici, FEYNMAN_UNDICI_VERSION);
	assert.equal(shrinkwrap.packages["node_modules/undici"].version, FEYNMAN_UNDICI_VERSION);
	assert.equal(nested.version, FEYNMAN_UNDICI_VERSION);
});
