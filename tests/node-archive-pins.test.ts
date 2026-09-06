import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { isSupportedNodeVersion } from "../src/system/node-version.js";

// Official https://nodejs.org/dist/v24.20.0/SHASUMS256.txt
// Retrieved 2026-09-06; index.json identifies v24.20.0 as latest LTS (Krypton).
const officialHashes = {
	"node-v24.20.0-darwin-arm64.tar.xz": "b7bf7707070b950ba1ec5f1af3bb6de0f2b1962c5033973d94068ab021ef3014",
	"node-v24.20.0-darwin-x64.tar.xz": "26fc30891004603d094eed11de5efcd03bbd2efbc35c177fc72648d5d7a7701b",
	"node-v24.20.0-linux-arm64.tar.xz": "5f4ddab610c1ab2016b3c227cebdbf6d9495161487e4739c7b90090595f465f7",
	"node-v24.20.0-linux-x64.tar.xz": "2f2c0da162318f0de47665410c7c8c2ed3d36c8f3105de4bbc61176c70a7cbf2",
	"node-v24.20.0-win-arm64.zip": "31c6799744de8a54601643098040c68c3697e56c94e407d61d0e5fa5f34191d7",
	"node-v24.20.0-win-x64.zip": "6cac9ffbca8f6a47091e4b5c772e0606049c3871cb67d900c0cedde630e545ba",
};
const root = resolve(import.meta.dirname, "..");

test("native Node release pins all six official LTS archives without importing the builder", () => {
	assert.equal(readFileSync(resolve(root, ".nvmrc"), "utf8").trim(), "24.20.0");
	const source = readFileSync(resolve(root, "scripts/build-native-bundle.mjs"), "utf8");
	const block = source.match(/const PINNED_NODE_ARCHIVE_SHA256 = \{([\s\S]*?)\n\};/)?.[1];
	assert.ok(block);
	const entries = [...block.matchAll(/"([^"]+)": "([0-9a-f]{64})"/g)];
	assert.equal(entries.length, 6);
	assert.deepEqual(Object.fromEntries(entries.map((match) => [match[1], match[2]])), officialHashes);
	assert.equal(isSupportedNodeVersion("24.20.0"), true);
	assert.equal(isSupportedNodeVersion("26.0.0"), false);
	const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
	assert.equal(manifest.engines.node, ">=22.22.0 <26");
});

test("release workflow Node 24 lanes match the native release pin", () => {
	for (const file of [".github/workflows/e2e.yml", ".github/workflows/publish.yml"]) {
		const source = readFileSync(resolve(root, file), "utf8");
		assert.doesNotMatch(source, /24\.18\.0/);
		assert.match(source, /node: "24\.20\.0"/);
		assert.match(source, /node: "22\.22\.0"/);
		assert.match(source, /node: "25"/);
	}
});
