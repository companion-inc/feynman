import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
	createDeterministicTarGz,
	createDeterministicZip,
	deterministicTarMetadataArgs,
} from "../scripts/lib/deterministic-archive.mjs";
import { computeFileSha256 } from "../scripts/lib/runtime-workspace-integrity.mjs";

function fixture() {
	const root = mkdtempSync(join(tmpdir(), "feynman-archive-repro-"));
	const tree = join(root, "bundle");
	mkdirSync(join(tree, "nested"), { recursive: true });
	writeFileSync(join(tree, "README.md"), "same bytes\n");
	writeFileSync(join(tree, "nested", "data.json"), '{"same":true}\n');
	return { root, tree };
}

function perturbTimestamps(tree: string) {
	const now = new Date();
	utimesSync(tree, now, now);
	utimesSync(join(tree, "README.md"), now, now);
	utimesSync(join(tree, "nested"), now, now);
	utimesSync(join(tree, "nested", "data.json"), now, now);
}

test("deterministic tar.gz output ignores source mtimes and repeated builds", async () => {
	const { root, tree } = fixture();
	const first = join(root, "first.tar.gz");
	const second = join(root, "second.tar.gz");
	await createDeterministicTarGz(tree, first);
	perturbTimestamps(tree);
	await createDeterministicTarGz(tree, second);
	assert.equal(computeFileSha256(first), computeFileSha256(second));
});

test("deterministic ZIP output ignores source mtimes and repeated builds", {
	skip: process.platform === "win32",
}, () => {
	const { root, tree } = fixture();
	const first = join(root, "first.zip");
	const second = join(root, "second.zip");
	createDeterministicZip(tree, first);
	perturbTimestamps(tree);
	createDeterministicZip(tree, second);
	assert.equal(computeFileSha256(first), computeFileSha256(second));
});

test("archive inputs remain content-sensitive", async () => {
	const { root, tree } = fixture();
	const first = join(root, "first.tar.gz");
	const second = join(root, "second.tar.gz");
	await createDeterministicTarGz(tree, first);
	appendFileSync(join(tree, "README.md"), "changed\n");
	await createDeterministicTarGz(tree, second);
	assert.notEqual(computeFileSha256(first), computeFileSha256(second));
});

test("BSD tar archives exclude host metadata that changes across clean installs", () => {
	assert.deepEqual(
		deterministicTarMetadataArgs("bsd").slice(-4),
		["--no-acls", "--no-fflags", "--no-mac-metadata", "--no-xattrs"],
	);
	assert.doesNotMatch(deterministicTarMetadataArgs("gnu").join(" "), /xattrs|mac-metadata/);
});
