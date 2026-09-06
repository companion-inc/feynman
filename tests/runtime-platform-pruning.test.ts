import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { planRuntimePlatformPruning, validateRuntimePlatformPruning } from "../scripts/lib/runtime-platform-pruning.mjs";
import { runtimeWorkspacePackageGraphMatches } from "../scripts/lib/runtime-workspace-integrity.mjs";
import {
	ESBUILD_OPTIONAL_DEPENDENCIES,
	ESBUILD_PLATFORM_LOCK_ENTRIES,
	patchPiEsbuildPackageLockSource,
} from "../scripts/lib/pi-esbuild-package-patch.mjs";

type LockEntry = {
	version: string;
	optional?: boolean;
	os?: string[];
	cpu?: string[];
	libc?: string[];
	link?: boolean;
	optionalDependencies?: Record<string, string>;
};

const host = { kind: "runtime", platform: "darwin", arch: "arm64" };
const prefix = "node_modules/@earendil-works/pi-coding-agent/node_modules/";
function fixture() {
	const packages: Record<string, LockEntry> = {};
	for (const base of ["node_modules/", prefix]) {
		const optionalDependencies: Record<string, string> = {};
		for (const [os, cpu] of [["darwin", "arm64"], ["linux", "x64"], ["win32", "arm64"]]) {
			const name = `@esbuild/${os}-${cpu}`;
			optionalDependencies[name] = "0.28.1";
			packages[base + name] = { version: "0.28.1", optional: true, os: [os], cpu: [cpu] };
		}
		packages[base + "esbuild"] = { version: "0.28.1", optionalDependencies };
	}
	packages["node_modules/unrelated"] = { version: "1.0.0", optional: true, os: ["linux"] };
	return { lockfileVersion: 3, packages };
}

test("runtime/native plan keeps each host copy and only removes foreign esbuild optionals", () => {
	const lock = fixture(), before = JSON.stringify(lock);
	for (const kind of ["runtime", "native"]) {
		const plan = planRuntimePlatformPruning(lock, { ...host, kind });
		assert.equal(plan.keep.length, 2);
		assert.equal(plan.remove.length, 4);
		assert.ok(plan.keep.every(path => path.endsWith("/@esbuild/darwin-arm64")));
		assert.ok(plan.remove.every(path => /@esbuild\/(?:linux-x64|win32-arm64)$/.test(path)));
		assert.ok(!plan.remove.includes("node_modules/unrelated"));
	}
	assert.equal(JSON.stringify(lock), before);
});

test("universal package, implicit host, and unsupported target fail closed", () => {
	for (const options of [undefined, { ...host, kind: "universal" }, { ...host, arch: undefined },
		{ ...host, platform: "freebsd" }, { ...host, arch: "../arm64" }]) {
		assert.throws(() => planRuntimePlatformPruning(fixture(), options), /Runtime platform pruning/);
	}
});

test("Windows ARM64 target is retained rather than silently narrowing to five release platforms", () => {
	const plan = planRuntimePlatformPruning(fixture(), { kind: "native", platform: "win32", arch: "arm64" });
	assert.equal(plan.keep.length, 2);
	assert.ok(plan.keep.every(path => path.endsWith("/@esbuild/win32-arm64")));
});

test("nonoptional, mismatched, libc, unknown version, and linked metadata reject the whole plan", () => {
	for (const change of [
		{ optional: false }, { optional: undefined }, { os: ["any"] }, { cpu: ["x64", "arm64"] },
		{ libc: ["glibc"] }, { version: "0.29.0" }, { link: true },
	]) {
		const lock = fixture();
		Object.assign(lock.packages[prefix + "@esbuild/linux-x64"], change);
		assert.throws(() => planRuntimePlatformPruning(lock, host), /unreviewed/);
	}
});

test("missing/altered exact wrapper and incomplete foreign lock metadata reject", () => {
	for (const mutate of [
		(lock: ReturnType<typeof fixture>) => delete lock.packages[prefix + "esbuild"],
		(lock: ReturnType<typeof fixture>) => { lock.packages[prefix + "esbuild"].optionalDependencies!["@esbuild/linux-x64"] = "^0.28.1"; },
		(lock: ReturnType<typeof fixture>) => {
			delete lock.packages[prefix + "@esbuild/linux-x64"];
			delete lock.packages["node_modules/@esbuild/linux-x64"];
		},
		(lock: ReturnType<typeof fixture>) => {
			delete lock.packages[prefix + "@esbuild/darwin-arm64"];
			delete lock.packages["node_modules/@esbuild/darwin-arm64"];
		},
	]) {
		const lock = fixture(); mutate(lock);
		assert.throws(() => planRuntimePlatformPruning(lock, host), /Runtime platform pruning/);
	}
});

test("ambiguous package paths never become recursive deletion candidates", () => {
	for (const path of [
		"node_modules/../node_modules/@esbuild/linux-x64",
		"node_modules/@esbuild/linux-x64/node_modules/other",
		"/tmp/node_modules/@esbuild/linux-x64",
		"node_modules/a\\b/node_modules/@esbuild/linux-x64",
	]) {
		const lock = fixture();
		lock.packages[path] = { version: "0.28.1", optional: true, os: ["linux"], cpu: ["x64"] };
		assert.throws(() => planRuntimePlatformPruning(lock, host), /unsupported esbuild package path/);
	}
});

test("ordinary graph without esbuild yields no changes", () => {
	assert.deepEqual(planRuntimePlatformPruning({ packages: {} }, host), { ...host, keep: [], remove: [] });
});

test("retained nested wrapper can resolve exact ancestor optionals; missing ancestor identity rejects", () => {
	const lock = fixture();
	const before = planRuntimePlatformPruning(lock, host);
	for (const path of Object.keys(lock.packages)) {
		if (path.startsWith(prefix)) delete lock.packages[path];
	}
	const after = planRuntimePlatformPruning(lock, host);
	assert.equal(before.keep.length, 2);
	assert.equal(after.keep.length, 1);
	assert.equal(after.remove.length, 2);
	assert.ok(after.remove.every(path => !path.startsWith(prefix)));
	// Volta keeps the nested wrapper, whose optional dependencies now resolve
	// through the exact ancestor graph rather than nonexistent sibling entries.
	const partial = fixture();
	for (const path of Object.keys(partial.packages)) {
		if (path.startsWith(prefix + "@esbuild/")) delete partial.packages[path];
	}
	assert.deepEqual(planRuntimePlatformPruning(partial, host), after);
	delete partial.packages["node_modules/@esbuild/linux-x64"];
	assert.throws(() => planRuntimePlatformPruning(partial, host), /incomplete platform graph/);
});

test("nearest incompatible optional never falls through to a convenient matching ancestor", () => {
	const lock = fixture();
	lock.packages[prefix + "@esbuild/linux-x64"].version = "0.28.2";
	assert.throws(() => planRuntimePlatformPruning(lock, host), /mismatched nearest optional/);
	const ancestor = fixture();
	for (const path of Object.keys(ancestor.packages)) {
		if (path.startsWith(prefix + "@esbuild/")) delete ancestor.packages[path];
	}
	ancestor.packages[prefix + "esbuild"].version = "0.28.2";
	ancestor.packages[prefix + "esbuild"].optionalDependencies = Object.fromEntries(
		Object.keys(ancestor.packages[prefix + "esbuild"].optionalDependencies!).map(name => [name, "0.28.2"]),
	);
	assert.throws(() => planRuntimePlatformPruning(ancestor, host), /mismatched nearest optional/);
});

test("actual portable normalizer output retains two wrappers and all 26 ancestor identities", () => {
	const pi = prefix.replace(/\/node_modules\/$/, "");
	const packages: Record<string, unknown> = {
		[pi]: { version: "0.85.1" },
		"node_modules/esbuild": { version: "0.28.2", optionalDependencies: ESBUILD_OPTIONAL_DEPENDENCIES },
		[prefix + "esbuild"]: {
			version: "0.28.1",
			optionalDependencies: Object.fromEntries(Object.keys(ESBUILD_OPTIONAL_DEPENDENCIES).map(name => [name, "0.28.1"])),
		},
	};
	for (const [name, metadata] of Object.entries(ESBUILD_PLATFORM_LOCK_ENTRIES)) {
		packages["node_modules/" + name] = metadata;
		packages[prefix + name] = { ...metadata, version: "0.28.1" };
	}
	const normalized = JSON.parse(patchPiEsbuildPackageLockSource(JSON.stringify({ lockfileVersion: 3, packages })));
	assert.ok(normalized.packages[prefix + "esbuild"]);
	assert.equal(Object.keys(normalized.packages).filter(path => path.startsWith(prefix + "@esbuild/")).length, 0);
	const plan = planRuntimePlatformPruning(normalized, host);
	assert.deepEqual(plan.keep, ["node_modules/@esbuild/darwin-arm64"]);
	assert.equal(plan.remove.length, 25);
	assert.ok(plan.remove.every(path => !path.startsWith(prefix)));
});

test("existing graph validator accepts absent foreign optionals, rejects absent host and nonoptional packages", () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-platform-graph-"));
	try {
		const lock = fixture(), plan = planRuntimePlatformPruning(lock, host);
		writeFileSync(join(root, "package-lock.json"), JSON.stringify(lock));
		for (const [path, metadata] of Object.entries(lock.packages)) {
			if (plan.remove.includes(path)) continue;
			mkdirSync(join(root, path), { recursive: true });
			writeFileSync(join(root, path, "package.json"), JSON.stringify({ version: metadata.version }));
		}
		assert.equal(runtimeWorkspacePackageGraphMatches(root, host), true);
		rmSync(join(root, plan.keep[0]), { recursive: true });
		assert.equal(runtimeWorkspacePackageGraphMatches(root, host), false);
		// The missing-host failure cannot be hidden by calling it nonoptional.
		lock.packages[plan.keep[0]].optional = false;
		writeFileSync(join(root, "package-lock.json"), JSON.stringify(lock));
		assert.equal(runtimeWorkspacePackageGraphMatches(root, host), false);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

function installedFixture(run: (root: string, lock: ReturnType<typeof fixture>) => void) {
	const root = mkdtempSync(join(tmpdir(), "feynman-platform-installed-"));
	const lock = fixture();
	try {
		for (const [path, entry] of Object.entries(lock.packages)) {
			const name = path.includes("@esbuild/") ? path.slice(path.lastIndexOf("@esbuild/"))
				: path.endsWith("/esbuild") ? "esbuild" : "unrelated";
			mkdirSync(join(root, path), { recursive: true });
			writeFileSync(join(root, path, "package.json"), JSON.stringify({ name, ...entry }));
			if (name === "esbuild") {
				mkdirSync(join(root, path, "lib"));
				writeFileSync(join(root, path, "lib/main.js"), "// fixture wrapper");
			} else if (name.startsWith("@esbuild/")) {
				mkdirSync(join(root, path, "bin"));
				writeFileSync(join(root, path, "bin/esbuild"), "fixture binary");
				writeFileSync(join(root, path, "esbuild.exe"), "fixture Windows binary");
			}
		}
		run(root, lock);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

test("installed validation is read-only and omits already missing foreign directories", () => {
	installedFixture((root, lock) => {
		const absent = prefix + "@esbuild/linux-x64";
		rmSync(join(root, absent), { recursive: true });
		const kept = join(root, prefix, "@esbuild/darwin-arm64/bin/esbuild");
		const before = readFileSync(kept);
		const result = validateRuntimePlatformPruning(root, lock, host);
		assert.equal(result.keep.length, 2);
		assert.equal(result.remove.length, 3);
		assert.ok(!result.remove.includes(absent));
		assert.deepEqual(readFileSync(kept), before);
		for (const path of result.remove) assert.ok(readFileSync(join(root, path, "package.json")).length);
	});
});

test("installed normalized wrappers resolve the shared host binary and reject unlocked shadows", () => {
	installedFixture((root, lock) => {
		for (const path of Object.keys(lock.packages)) {
			if (path.startsWith(prefix + "@esbuild/")) {
				delete lock.packages[path];
				rmSync(join(root, path), { recursive: true });
			}
		}
		const result = validateRuntimePlatformPruning(root, lock, host);
		assert.deepEqual(result.keep, ["node_modules/@esbuild/darwin-arm64"]);
		assert.equal(result.remove.length, 2);
		const shadow = join(root, prefix, "@esbuild/darwin-arm64");
		mkdirSync(join(shadow, "bin"), { recursive: true });
		writeFileSync(join(shadow, "bin/esbuild"), "unlocked shadow");
		assert.throws(() => validateRuntimePlatformPruning(root, lock, host), /unlocked host shadow/);
		rmSync(shadow, { recursive: true });
		writeFileSync(join(root, prefix, "esbuild/package.json"), '{"name":"esbuild","version":"0.28.2"}');
		assert.throws(() => validateRuntimePlatformPruning(root, lock, host), /wrapper manifest differs/);
	});
});
test("installed validation rejects a missing host, missing or empty host binary, and foreign manifest drift", () => {
	for (const change of [
		(root: string) => rmSync(join(root, prefix, "@esbuild/darwin-arm64"), { recursive: true }),
		(root: string) => rmSync(join(root, prefix, "@esbuild/darwin-arm64/bin/esbuild")),
		(root: string) => writeFileSync(join(root, prefix, "@esbuild/darwin-arm64/bin/esbuild"), ""),
		(root: string) => writeFileSync(join(root, prefix, "@esbuild/linux-x64/package.json"), '{"name":"unrelated"}'),
		(root: string) => writeFileSync(join(root, prefix, "esbuild/package.json"), '{"name":"esbuild","version":"0.28.2"}'),
		(root: string) => rmSync(join(root, prefix, "esbuild/lib/main.js")),
	]) {
		installedFixture((root, lock) => {
			change(root);
			assert.throws(() => validateRuntimePlatformPruning(root, lock, host));
		});
	}
});

test("installed Windows ARM64 validation requires its exe, not an unrelated Unix binary", () => {
	installedFixture((root, lock) => {
		const target = { kind: "native", platform: "win32", arch: "arm64" };
		assert.equal(validateRuntimePlatformPruning(root, lock, target).keep.length, 2);
		rmSync(join(root, prefix, "@esbuild/win32-arm64/esbuild.exe"));
		assert.throws(() => validateRuntimePlatformPruning(root, lock, target));
	});
});

test("installed validation rejects directory links and binary symlinks", {
	skip: process.platform === "win32" ? "Creating symlinks requires Windows privilege; no validator bypass" : false,
}, () => {
	for (const path of [prefix + "@esbuild/linux-x64", prefix + "@esbuild", prefix + "@esbuild/darwin-arm64/bin/esbuild"]) {
		installedFixture((root, lock) => {
			rmSync(join(root, path), { recursive: true, force: true });
			symlinkSync(root, join(root, path));
			assert.throws(() => validateRuntimePlatformPruning(root, lock, host), /symlink/);
		});
	}
});
