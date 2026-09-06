import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test, { type TestContext } from "node:test";
import { runInNewContext } from "node:vm";
import { validateRuntimePlatformPruning } from "../scripts/lib/runtime-platform-pruning.mjs";
import {
	assertEsbuildPlatformPackage,
	assertEsbuildRootManifest,
	ESBUILD_BINARY_HASHES,
	ESBUILD_OPTIONAL_DEPENDENCIES,
	ESBUILD_PLATFORM_LOCK_ENTRIES,
	ESBUILD_PORTABLE_BIN_SOURCE,
	ESBUILD_SOURCE_HASHES,
	patchPiChordEsbuildManifestSource,
	patchPiEsbuildPackageLockSource,
	patchPiEsbuildPackageTree,
	patchPiEsbuildShrinkwrapSource,
} from "../scripts/lib/pi-esbuild-package-patch.mjs";

const require = createRequire(import.meta.url);
const vendor = dirname(require.resolve("esbuild/package.json"));
const host = `@esbuild/${process.platform}-${process.arch}`;
const hostSource = dirname(require.resolve(`${host}/package.json`));
const digest = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");
const piPrefix = "node_modules/@earendil-works/pi-coding-agent";
const oldOptionals = Object.fromEntries(Object.keys(ESBUILD_OPTIONAL_DEPENDENCIES).map(name => [name, "0.28.1"]));

function write(path: string, value: object | string) {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, typeof value === "string" ? value : JSON.stringify(value, null, 2) + "\n");
}
function shrinkwrap() {
	const packages: Record<string, unknown> = {
		"": { name: "@earendil-works/pi-coding-agent", version: "0.85.1" },
		"node_modules/@earendil-works/chord": { version: "0.85.1", dependencies: { esbuild: "0.28.1" } },
		"node_modules/esbuild": { version: "0.28.1", optionalDependencies: oldOptionals, inBundle: true },
	};
	for (const name of Object.keys(oldOptionals)) packages[`node_modules/${name}`] = { ...ESBUILD_PLATFORM_LOCK_ENTRIES[name], version: "0.28.1" };
	return { name: "@earendil-works/pi-coding-agent", version: "0.85.1", lockfileVersion: 3, packages };
}
function fixture(t: TestContext) {
	const root = mkdtempSync(join(tmpdir(), "feynman-portable-esbuild-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const app = join(root, "app"), modules = join(app, "node_modules"), pi = join(app, piPrefix);
	const top = join(modules, "esbuild"), nested = join(pi, "node_modules/esbuild");
	write(join(app, "package.json"), {
		name: "portable-esbuild-test", version: "1.0.0", private: true,
		dependencies: { esbuild: "0.28.2" }, bundleDependencies: ["esbuild"],
		optionalDependencies: ESBUILD_OPTIONAL_DEPENDENCIES,
	});
	for (const file of Object.keys(ESBUILD_SOURCE_HASHES)) {
		mkdirSync(dirname(join(top, file)), { recursive: true });
		cpSync(join(vendor, file), join(top, file));
	}
	cpSync(hostSource, join(modules, host), { recursive: true });
	write(join(pi, "package.json"), { name: "@earendil-works/pi-coding-agent", version: "0.85.1" });
	write(join(pi, "npm-shrinkwrap.json"), shrinkwrap());
	write(join(pi, "node_modules/@earendil-works/chord/package.json"), {
		name: "@earendil-works/chord", version: "0.85.1", dependencies: { esbuild: "0.28.1" },
	});
	write(join(nested, "package.json"), { name: "esbuild", version: "0.28.1", optionalDependencies: oldOptionals });
	write(join(nested, "lib/main.js"), "// synthetic old API; never executed\n");
	write(join(nested, "lib/downloaded-old-host-esbuild"), "old host cache");
	for (const name of Object.keys(oldOptionals)) {
		const metadata = ESBUILD_PLATFORM_LOCK_ENTRIES[name];
		write(join(pi, "node_modules", name, "package.json"), { name, version: "0.28.1", os: metadata.os, cpu: metadata.cpu });
		write(join(pi, "node_modules", name, "bin/esbuild"), "synthetic old binary, not executable");
	}
	const packages: Record<string, unknown> = {
		"": JSON.parse(readFileSync(join(app, "package.json"), "utf8")),
		[piPrefix]: { version: "0.85.1" },
		"node_modules/esbuild": { version: "0.28.2", optionalDependencies: ESBUILD_OPTIONAL_DEPENDENCIES },
	};
	for (const [path, entry] of Object.entries(shrinkwrap().packages)) if (path) packages[`${piPrefix}/${path}`] = entry;
	for (const [name, entry] of Object.entries(ESBUILD_PLATFORM_LOCK_ENTRIES)) packages[`node_modules/${name}`] = entry;
	write(join(app, "package-lock.json"), { lockfileVersion: 3, packages });
	write(join(modules, ".package-lock.json"), { lockfileVersion: 3, packages });
	return { root, app, modules, pi, top, nested };
}

test("exact vendor wrapper/API hashes and all 26 platform identities remain available", () => {
	assert.equal(Object.keys(ESBUILD_OPTIONAL_DEPENDENCIES).length, 26);
	assert.equal(Object.keys(ESBUILD_BINARY_HASHES).length, 26);
	assert.equal(digest(ESBUILD_PORTABLE_BIN_SOURCE), ESBUILD_SOURCE_HASHES["bin/esbuild"]);
	assert.equal(digest(readFileSync(join(vendor, "lib/main.js"))), ESBUILD_SOURCE_HASHES["lib/main.js"]);
	const vendorHashes = JSON.parse(readFileSync(join(vendor, "package.json"), "utf8"))["esbuild.binaryHashes"];
	for (const [path, hash] of Object.entries(vendorHashes)) assert.equal(ESBUILD_BINARY_HASHES[path], hash);
	assertEsbuildPlatformPackage(hostSource);
	for (const [name, version] of Object.entries(ESBUILD_OPTIONAL_DEPENDENCIES)) {
		assert.equal(version, "0.28.2");
		assert.equal(ESBUILD_PLATFORM_LOCK_ENTRIES[name].version, version);
	}
});

test("metadata removes only current Pi nested binary entries and preserves 26 root options", () => {
	const original = JSON.stringify(shrinkwrap()), patched = patchPiEsbuildShrinkwrapSource(original);
	const lock = JSON.parse(patched);
	assert.equal(lock.packages["node_modules/@earendil-works/chord"].dependencies.esbuild, "0.28.2");
	assert.deepEqual(lock.packages["node_modules/esbuild"].optionalDependencies, ESBUILD_OPTIONAL_DEPENDENCIES);
	assert.equal(Object.keys(lock.packages).filter(p => p.includes("@esbuild/")).length, 0);
	assert.equal(patchPiEsbuildShrinkwrapSource(patched), patched);
	const root = { packages: {
		[piPrefix]: { version: "0.85.1" },
		[`${piPrefix}/node_modules/esbuild`]: { version: "0.28.1" },
		[`${piPrefix}/node_modules/@esbuild/linux-x64`]: { version: "0.28.1" },
		"node_modules/other/node_modules/esbuild": { version: "0.27.0" },
		"node_modules/@mariozechner/pi-coding-agent": { version: "0.84.2" },
		"node_modules/@mariozechner/pi-coding-agent/node_modules/esbuild": { version: "0.27.0" },
		...Object.fromEntries(Object.entries(ESBUILD_PLATFORM_LOCK_ENTRIES).map(([n,e]) => [`node_modules/${n}`, e])),
	} };
	const result = JSON.parse(patchPiEsbuildPackageLockSource(JSON.stringify(root)));
	assert.equal(result.packages["node_modules/other/node_modules/esbuild"].version, "0.27.0");
	assert.equal(result.packages["node_modules/@mariozechner/pi-coding-agent/node_modules/esbuild"].version, "0.27.0");
	assert.equal(Object.keys(result.packages).filter(p => p.startsWith("node_modules/@esbuild/")).length, 26);
	assert.equal(patchPiEsbuildPackageLockSource(JSON.stringify(result)), JSON.stringify(result));
});

test("portable tree removes nested payloads without touching root binaries and is idempotent", (t) => {
	const f = fixture(t), binary = assertEsbuildPlatformPackage(join(f.modules, host)), originalBinary = digest(readFileSync(binary));
	assert.equal(patchPiEsbuildPackageTree(f.modules), true);
	assert.equal(readdirSync(join(f.pi, "node_modules/@esbuild")).length, 0);
	assert.equal(digest(readFileSync(binary)), originalBinary);
	assert.equal(readFileSync(join(f.top, "bin/esbuild"), "utf8"), ESBUILD_PORTABLE_BIN_SOURCE);
	assert.equal(readFileSync(join(f.nested, "bin/esbuild"), "utf8"), ESBUILD_PORTABLE_BIN_SOURCE);
	assert.equal(existsSync(join(f.nested, "lib/downloaded-old-host-esbuild")), false);
	for (const path of [join(f.app, "package-lock.json"), join(f.modules, ".package-lock.json")]) {
		const lock = JSON.parse(readFileSync(path, "utf8"));
		assert.equal(Object.keys(lock.packages).filter(p => p.startsWith(`${piPrefix}/node_modules/@esbuild/`)).length, 0);
	}
	assert.equal(patchPiEsbuildPackageTree(f.modules), false);
});

test("postinstall's hard-linked native CLI is replaced without corrupting the optional binary", (t) => {
	const f = fixture(t), binary = assertEsbuildPlatformPackage(join(f.modules, host)), before = readFileSync(binary);
	rmSync(join(f.top, "bin/esbuild"));
	linkSync(binary, join(f.top, "bin/esbuild"));
	assert.equal(patchPiEsbuildPackageTree(f.modules), true);
	assert.deepEqual(readFileSync(binary), before);
	assert.equal(readFileSync(join(f.top, "bin/esbuild"), "utf8"), ESBUILD_PORTABLE_BIN_SOURCE);
});

for (const runtime of [false, true]) test(`API and CLI compile after relocation in ${runtime ? "runtime" : "universal"} mode`, (t) => {
	const f = fixture(t);
	patchPiEsbuildPackageTree(f.modules, f.top, { runtime });
	const moved = join(f.root, "relocated"); renameSync(f.app, moved);
	const env = { ...process.env }; delete env.ESBUILD_BINARY_PATH;
	const nested = join(moved, piPrefix, "node_modules/esbuild");
	const api = spawnSync(process.execPath, ["-e", `
		const assert = require('node:assert/strict');
		const esbuild = require(${JSON.stringify(nested)});
		assert.equal(esbuild.version, '0.28.2');
		assert.equal(typeof esbuild.build, 'function'); assert.equal(typeof esbuild.context, 'function');
		assert.equal(typeof esbuild.transformSync, 'function');
		const transformed = esbuild.transformSync('const answer: number = 42', {loader:'ts'});
		assert.match(transformed.code, /answer = 42/); assert.doesNotMatch(transformed.code, /: number/);
		esbuild.build({stdin:{contents:'export const built: number = 43', loader:'ts'}, write:false, bundle:true})
			.then(result => {
				assert.match(result.outputFiles[0].text, /built = 43/);
				esbuild.stop();
				console.log(esbuild.version);
			}).catch(error => { console.error(error); process.exitCode = 1; });
	`], { encoding: "utf8", env, timeout: 15000 });
	assert.equal(api.status, 0, api.stderr); assert.equal(api.stdout.trim(), "0.28.2");
	const cli = spawnSync(process.execPath, [join(nested, "bin/esbuild"), "--loader=ts"], {
		input: "const value: number = 7;", encoding: "utf8", env, timeout: 15000,
	});
	assert.equal(cli.status, 0, cli.stderr); assert.match(cli.stdout, /value = 7/);
});

test("vendor CLI chooses all 26 optional packages using normal module resolution", () => {
	for (const [name, metadata] of Object.entries(ESBUILD_PLATFORM_LOCK_ENTRIES)) {
		const platform = (metadata.os as string[])[0], arch = (metadata.cpu as string[])[0];
		let resolved: string | undefined, launched: unknown[] | undefined;
		const expected = Object.keys(ESBUILD_BINARY_HASHES).find(p => p.startsWith(name + "/"))!;
		const mockRequire = Object.assign((specifier: string) => {
			if (specifier === "fs") return { existsSync: () => true };
			if (specifier === "os") return { arch: () => arch, endianness: () => arch === "ppc64" && platform === "aix" || arch === "s390x" ? "BE" : "LE" };
			if (specifier === "path") return require("node:path");
			if (specifier === "child_process") return { execFileSync: (...args: unknown[]) => { launched = args; } };
			throw new Error(specifier);
		}, { resolve: (specifier: string) => { resolved = specifier; return "/consumer/" + specifier; } });
		runInNewContext(ESBUILD_PORTABLE_BIN_SOURCE, {
			require: mockRequire, process: { platform, env: {}, argv: ["node", "esbuild", "--version"], execPath: "/node", exit: () => {} },
			__dirname: "/consumer/node_modules/esbuild/bin", console,
		});
		assert.equal(resolved, expected, name);
		assert.ok(launched, name);
	}
});

test("preflight rejects incomplete platforms, unknown source, wrong native hashes and symlink escapes", (t) => {
	const f = fixture(t), before = readFileSync(join(f.pi, "npm-shrinkwrap.json"));
	const manifest = JSON.parse(readFileSync(join(f.app, "package.json"), "utf8"));
	delete manifest.optionalDependencies["@esbuild/win32-x64"];
	assert.throws(() => assertEsbuildRootManifest(JSON.stringify(manifest)), /optional dependency/);
	writeFileSync(join(f.top, "lib/main.js"), "unreviewed source");
	assert.throws(() => patchPiEsbuildPackageTree(f.modules), /source digest mismatch/);
	assert.deepEqual(readFileSync(join(f.pi, "npm-shrinkwrap.json")), before);
	cpSync(join(vendor, "lib/main.js"), join(f.top, "lib/main.js"));
	const native = assertEsbuildPlatformPackage(join(f.modules, host)); writeFileSync(native, "bad binary");
	assert.throws(() => patchPiEsbuildPackageTree(f.modules), /binary digest mismatch/);
	assert.deepEqual(readFileSync(join(f.pi, "npm-shrinkwrap.json")), before);
	cpSync(hostSource, join(f.modules, host), { recursive: true });
	rmSync(f.nested, { recursive: true }); symlinkSync(vendor, f.nested, "dir");
	assert.throws(() => patchPiEsbuildPackageTree(f.modules), /escapes|real directory/);
	assert.deepEqual(readFileSync(join(f.pi, "npm-shrinkwrap.json")), before);
});

test("unknown versions fail closed and runtime mode needs the same verified top-level host", (t) => {
	assert.throws(() => patchPiChordEsbuildManifestSource(JSON.stringify({
		name: "@earendil-works/chord", version: "0.85.1", dependencies: { esbuild: "0.29.0" },
	})), /Unsupported/);
	const old = shrinkwrap(); old.version = "0.86.0";
	assert.throws(() => patchPiEsbuildShrinkwrapSource(JSON.stringify(old)), /unreviewed Pi/);
	const f = fixture(t);
	write(join(f.app, "package.json"), { name: "feynman-runtime", private: true, dependencies: { esbuild: "0.28.2" } });
	assert.equal(patchPiEsbuildPackageTree(f.modules, f.top, { runtime: true }), true);
	assert.equal(patchPiEsbuildPackageTree(f.modules, f.top, { runtime: true }), false);
});

test("runtime prune then normalize then prune remains valid without declaration rehydration", (t) => {
	const f = fixture(t), lockPath = join(f.app, "package-lock.json");
	const options = { kind: "runtime", platform: process.platform, arch: process.arch };
	// prepare/native pruning runs in its own process. Model that boundary so
	// Node's old successful require.resolve cache cannot outlive normalization.
	const initial = spawnSync(process.execPath, ["--input-type=module", "-e", `
		import { readFileSync } from "node:fs";
		import { validateRuntimePlatformPruning } from ${JSON.stringify(pathToFileURL(resolve("scripts/lib/runtime-platform-pruning.mjs")).href)};
		console.log(JSON.stringify(validateRuntimePlatformPruning(
			${JSON.stringify(f.app)}, JSON.parse(readFileSync(${JSON.stringify(lockPath)}, "utf8")), ${JSON.stringify(options)}
		)));
	`], { encoding: "utf8", timeout: 15000 });
	assert.equal(initial.status, 0, initial.stderr);
	const first = JSON.parse(initial.stdout);
	for (const path of first.remove) rmSync(join(f.app, path), { recursive: true });
	for (const name of ["README.md", "lib/main.d.ts"]) rmSync(join(f.top, name));
	assert.equal(patchPiEsbuildPackageTree(f.modules, f.top, { runtime: true }), true);
	const second = validateRuntimePlatformPruning(f.app, JSON.parse(readFileSync(lockPath, "utf8")), options);
	assert.deepEqual(second.keep, [`node_modules/${host}`]);
	assert.equal(readdirSync(join(f.pi, "node_modules/@esbuild")).length, 0);
	const normalized = JSON.parse(readFileSync(lockPath, "utf8"));
	assert.equal(Object.keys(normalized.packages).filter(p => p.startsWith(`${piPrefix}/node_modules/@esbuild/`)).length, 0);
	assert.equal(Object.keys(normalized.packages).filter(p => p.startsWith("node_modules/@esbuild/")).length, 26);
	assert.equal(second.remove.length, 0);
	for (const path of second.keep) assertEsbuildPlatformPackage(join(f.app, path));
	for (const root of [f.top, f.nested]) {
		assert.equal(existsSync(join(root, "README.md")), false);
		assert.equal(existsSync(join(root, "lib/main.d.ts")), false);
	}
	assert.equal(patchPiEsbuildPackageTree(f.modules, f.top, { runtime: true }), false);
});

test("unmanaged and stale trees are no-ops but current managed Pi requires esbuild", (t) => {
	const root = mkdtempSync(join(tmpdir(), "feynman-esbuild-unmanaged-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const modules = join(root, "node_modules");
	assert.equal(patchPiEsbuildPackageTree(modules), false);
	mkdirSync(modules);
	assert.equal(patchPiEsbuildPackageTree(modules), false);
	const pi = join(modules, "@earendil-works/pi-coding-agent");
	write(join(pi, "package.json"), { name: "@earendil-works/pi-coding-agent", version: "0.84.2" });
	write(join(pi, "npm-shrinkwrap.json"), {});
	assert.equal(patchPiEsbuildPackageTree(modules), false);
	write(join(pi, "package.json"), { name: "@earendil-works/pi-coding-agent", version: "0.85.1" });
	write(join(root, "package.json"), { name: "fixture", dependencies: {} });
	assert.throws(() => patchPiEsbuildPackageTree(modules), /root must depend on exact/);
});

test("a pruned native root remains portable without requiring or rehydrating declarations", (t) => {
	const f = fixture(t);
	for (const name of ["README.md", "lib/main.d.ts"]) rmSync(join(f.top, name));
	assert.equal(patchPiEsbuildPackageTree(f.modules), true);
	for (const root of [f.top, f.nested]) {
		assert.equal(existsSync(join(root, "README.md")), false);
		assert.equal(existsSync(join(root, "lib/main.d.ts")), false);
	}
	assert.equal(patchPiEsbuildPackageTree(f.modules), false);
	rmSync(join(f.top, "lib/main.js"));
	assert.throws(() => patchPiEsbuildPackageTree(f.modules), /missing or linked source file: lib\/main.js/);
});

function hoistedFixture(t: TestContext) {
	const f = fixture(t), consumer = join(f.root, "consumer");
	const app = join(consumer, "node_modules/@advaitpaliwal/feynman");
	mkdirSync(dirname(app), { recursive: true }); renameSync(f.app, app);
	const modules = join(app, "node_modules"), externalHost = join(consumer, "node_modules", host);
	mkdirSync(dirname(externalHost), { recursive: true });
	renameSync(join(modules, host), externalHost);
	write(join(consumer, "package.json"), { name: "consumer", private: true });
	write(join(consumer, "package-lock.json"), { lockfileVersion: 3, packages: {}, untouched: true });
	for (const path of [join(app, "package-lock.json"), join(modules, ".package-lock.json")]) {
		const lock = JSON.parse(readFileSync(path, "utf8"));
		delete lock.packages[`node_modules/${host}`];
		write(path, lock);
	}
	return { ...f, app, modules, consumer, externalHost, top: join(modules, "esbuild"), pi: join(app, piPrefix), nested: join(app, piPrefix, "node_modules/esbuild") };
}

for (const ownLock of [false, true]) test(`consumer-hoisted host compiles read-only with own lock ${ownLock}`, (t) => {
	const f = hoistedFixture(t), binary = assertEsbuildPlatformPackage(f.externalHost);
	if (!ownLock) {
		rmSync(join(f.app, "package-lock.json"));
		rmSync(join(f.modules, ".package-lock.json"));
	}
	const untouched = [binary, join(f.externalHost, "package.json"), join(f.consumer, "package.json"), join(f.consumer, "package-lock.json")];
	const snapshots = untouched.map(p => digest(readFileSync(p)));
	const compiler = createRequire(join(f.top, "lib/main.js"));
	const subpath = process.platform === "win32" ? "esbuild.exe" : "bin/esbuild";
	assert.equal(realpathSync(compiler.resolve(`${host}/${subpath}`)), realpathSync(binary));
	// Also retain a bundled foreign-platform package: it is not the consumer's
	// selected host, and must neither be required nor rewritten by normalization.
	const foreign = host === "@esbuild/darwin-arm64" ? "@esbuild/linux-x64" : "@esbuild/darwin-arm64";
	const foreignManifest = join(f.modules, foreign, "package.json");
	write(foreignManifest, { name: foreign, version: "0.28.2" });
	const foreignBefore = readFileSync(foreignManifest);
	// Simulate postinstall optimization hard-linking the CLI outside Feynman.
	rmSync(join(f.top, "bin/esbuild")); linkSync(binary, join(f.top, "bin/esbuild"));
	assert.equal(patchPiEsbuildPackageTree(f.modules), true);
	assert.equal(patchPiEsbuildPackageTree(f.modules), false);
	assert.equal(existsSync(join(f.modules, host)), false);
	assert.deepEqual(untouched.map(p => digest(readFileSync(p))), snapshots);
	assert.deepEqual(readFileSync(foreignManifest), foreignBefore);
	const env = { ...process.env }; delete env.ESBUILD_BINARY_PATH;
	const run = spawnSync(process.execPath, ["-e", `
		const assert = require("node:assert/strict");
		const e = require(${JSON.stringify(f.nested)});
		assert.equal(e.version, "0.28.2");
		assert.match(e.transformSync("const x: number = 42", {loader:"ts"}).code, /x = 42/);
		e.stop();
	`], { encoding: "utf8", env, timeout: 15000 });
	assert.equal(run.status, 0, run.stderr);
	const cli = spawnSync(process.execPath, [join(f.nested, "bin/esbuild"), "--loader=ts"], {
		input: "let y: number = 7", encoding: "utf8", env, timeout: 15000,
	});
	assert.equal(cli.status, 0, cli.stderr); assert.match(cli.stdout, /y = 7/);
	assert.deepEqual(untouched.map(p => digest(readFileSync(p))), snapshots);
});

test("runtime mode rejects hoisted host and root mode rejects a nearer wrong-version shadow", (t) => {
	const f = hoistedFixture(t), before = readFileSync(join(f.pi, "npm-shrinkwrap.json"));
	assert.throws(() => patchPiEsbuildPackageTree(f.modules, f.top, { runtime: true }), /runtime-local/);
	const nearer = join(f.modules, host);
	cpSync(f.externalHost, nearer, { recursive: true });
	const manifestPath = join(nearer, "package.json"), manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
	manifest.version = "0.28.1"; write(manifestPath, manifest);
	assert.throws(() => patchPiEsbuildPackageTree(f.modules), /unreviewed esbuild platform package/);
	assert.deepEqual(readFileSync(join(f.pi, "npm-shrinkwrap.json")), before);
});

test("hoisted binary corruption and linked host package cannot escape read-only preflight", (t) => {
	const f = hoistedFixture(t), binary = assertEsbuildPlatformPackage(f.externalHost);
	const before = readFileSync(join(f.pi, "npm-shrinkwrap.json"));
	writeFileSync(binary, "corrupted");
	assert.throws(() => patchPiEsbuildPackageTree(f.modules), /binary digest mismatch/);
	assert.deepEqual(readFileSync(join(f.pi, "npm-shrinkwrap.json")), before);
	rmSync(f.externalHost, { recursive: true });
	symlinkSync(hostSource, f.externalHost, "dir");
	assert.throws(() => patchPiEsbuildPackageTree(f.modules), /real directory/);
	assert.deepEqual(readFileSync(join(f.pi, "npm-shrinkwrap.json")), before);
});

test("NODE_PATH-only host is rejected even when Node's unrestricted compiler lookup succeeds", (t) => {
	const f = hoistedFixture(t), globalModules = join(f.root, "not-an-ancestor/node_modules");
	const external = join(globalModules, host);
	mkdirSync(dirname(external), { recursive: true }); renameSync(f.externalHost, external);
	const helper = pathToFileURL(resolve("scripts/lib/pi-esbuild-package-patch.mjs")).href;
	const subpath = process.platform === "win32" ? "esbuild.exe" : "bin/esbuild";
	const child = spawnSync(process.execPath, ["--input-type=module", "-e", `
		import assert from "node:assert/strict";
		import { createRequire } from "node:module";
		import { realpathSync } from "node:fs";
		import { patchPiEsbuildPackageTree } from ${JSON.stringify(helper)};
		const r = createRequire(${JSON.stringify(join(f.top, "lib/main.js"))});
		assert.equal(realpathSync(r.resolve(${JSON.stringify(`${host}/${subpath}`)})), realpathSync(${JSON.stringify(join(external, subpath))}));
		assert.throws(() => patchPiEsbuildPackageTree(${JSON.stringify(f.modules)}), /host optional package unavailable/);
	`], { encoding: "utf8", env: { ...process.env, NODE_PATH: globalModules }, timeout: 15000 });
	assert.equal(child.status, 0, child.stderr);
});
