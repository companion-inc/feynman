import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { join, posix } from "node:path";
import { createRequire } from "node:module";

const REVIEWED_ESBUILD_VERSIONS = new Set(["0.28.1", "0.28.2"]);

function fail(message) {
	throw new Error(`Runtime platform pruning: ${message}`);
}

function assertLockPath(path) {
	if (!path.startsWith("node_modules/") || posix.normalize(path) !== path ||
		path.includes("\\") || path.split("/").some(part => part === "." || part === "..")) {
		fail(`unsupported esbuild package path ${path}`);
	}
}

// Match Node's node_modules ancestor search from the wrapper's lib/main.js.
// Stop at the owned lock root: no global, NODE_PATH, or outside fallback.
function optionalCandidates(wrapperPath, name) {
	const paths = [];
	for (let cursor = `${wrapperPath}/lib`; cursor !== "."; cursor = posix.dirname(cursor)) {
		if (posix.basename(cursor) !== "node_modules") paths.push(`${cursor}/node_modules/${name}`);
	}
	paths.push(`node_modules/${name}`);
	return paths;
}

function analyze(lock, { kind, platform, arch } = {}) {
	if (kind !== "runtime" && kind !== "native") {
		fail("explicit runtime or native kind required; universal npm pruning is forbidden");
	}
	if (![platform, arch].every(value => typeof value === "string" && /^[a-z0-9]+$/.test(value))) {
		fail("explicit target platform and architecture required");
	}
	if (!lock?.packages || typeof lock.packages !== "object" || Array.isArray(lock.packages)) {
		fail("lock packages object required");
	}
	const binaries = new Map(), wrappers = new Map();
	for (const [path, entry] of Object.entries(lock.packages)) {
		if (/(^|\/)node_modules\/esbuild$/.test(path)) {
			assertLockPath(path);
			if (!REVIEWED_ESBUILD_VERSIONS.has(entry?.version) || entry.link) fail(`unreviewed esbuild wrapper at ${path}`);
			wrappers.set(path, entry);
		}
		if (!path.includes("node_modules/@esbuild/")) continue;
		assertLockPath(path);
		const match = /^(.*node_modules\/)(@esbuild\/([a-z0-9]+)-([a-z0-9]+))$/.exec(path);
		if (!match) fail(`unsupported esbuild package path ${path}`);
		const [, , name, os, cpu] = match;
		if (!entry || entry.link || entry.optional !== true ||
			!REVIEWED_ESBUILD_VERSIONS.has(entry.version) ||
			JSON.stringify(entry.os) !== JSON.stringify([os]) ||
			JSON.stringify(entry.cpu) !== JSON.stringify([cpu]) || entry.libc !== undefined) {
			fail(`unreviewed optional platform metadata at ${path}`);
		}
		binaries.set(path, { name, os, cpu, version: entry.version });
	}
	const referenced = new Set(), keep = new Set(), hostBindings = [];
	for (const [wrapperPath, wrapper] of wrappers) {
		const declarations = wrapper.optionalDependencies;
		if (!declarations || typeof declarations !== "object" || Array.isArray(declarations) || Object.keys(declarations).length === 0) {
			fail(`incomplete platform graph at ${wrapperPath}`);
		}
		let hostCount = 0;
		for (const [name, version] of Object.entries(declarations)) {
			if (!/^@esbuild\/[a-z0-9]+-[a-z0-9]+$/.test(name) || version !== wrapper.version) {
				fail(`missing exact esbuild optional declaration at ${wrapperPath}`);
			}
			// The NEAREST existing lock entry wins, even if invalid. Never skip a
			// wrong-version/link entry to find a convenient matching ancestor.
			const candidates = optionalCandidates(wrapperPath, name);
			const path = candidates.find(candidate => Object.hasOwn(lock.packages, candidate));
			const entry = binaries.get(path);
			if (!entry || entry.name !== name || entry.version !== version) {
				fail(`incomplete platform graph or mismatched nearest optional ${name} at ${wrapperPath}`);
			}
			referenced.add(path);
			if (entry.os === platform && entry.cpu === arch) {
				hostCount++;
				keep.add(path);
				hostBindings.push({ wrapperPath, name, packagePath: path, candidates });
			}
		}
		if (hostCount !== 1) fail(`incomplete platform graph or unsupported target at ${wrapperPath}`);
	}
	for (const path of binaries.keys()) {
		if (!referenced.has(path)) fail(`orphan optional platform identity at ${path}`);
	}
	return {
		plan: { kind, platform, arch, keep: [...keep].sort(), remove: [...binaries.keys()].filter(path => !keep.has(path)).sort() },
		wrappers: [...wrappers.keys()], hostBindings,
	};
}

/**
 * Pure exact-identity plan for owned runtime/native trees, never universal npm.
 * Supports sibling AND ancestor-resolved platform packages. Recompute after any
 * topology normalization; missing identities and wrong nearest versions fail.
 */
export function planRuntimePlatformPruning(lock, options) {
	return analyze(lock, options).plan;
}

/**
 * Read-only validation of the complete plan against an owned staging tree.
 * Rejects symlinks at every in-tree component; missing foreign packages are
 * omitted from the returned remove list. It still never deletes anything.
 * Parent must serialize staging access: validation is not a filesystem lock.
 */
export function validateRuntimePlatformPruning(workspacePath, lock, options) {
	const { plan, wrappers, hostBindings } = analyze(lock, options);
	const root = realpathSync(workspacePath);
	if (!lstatSync(root).isDirectory()) fail("workspace must be a directory");
	function inspect(relativePath, missingAllowed = false, file = false) {
		const parts = relativePath.split("/");
		let path = root;
		for (let index = 0; index < parts.length; index++) {
			path = join(path, parts[index]);
			let stats;
			try {
				stats = lstatSync(path);
			} catch (error) {
				if (missingAllowed && error.code === "ENOENT") return undefined;
				throw error;
			}
			if (stats.isSymbolicLink()) fail(`symlink in staging path ${relativePath}`);
			if (index === parts.length - 1 && file) {
				if (!stats.isFile() || stats.size === 0) fail(`missing or empty file ${relativePath}`);
			} else if (!stats.isDirectory()) {
				fail(`non-directory in staging path ${relativePath}`);
			}
		}
		return path;
	}
	function manifest(relativePath) {
		return JSON.parse(readFileSync(inspect(`${relativePath}/package.json`, false, true), "utf8"));
	}
	const remove = [];
	for (const relativePath of [...plan.keep, ...plan.remove]) {
		const host = plan.keep.includes(relativePath);
		if (!inspect(relativePath, !host)) continue;
		const entry = lock.packages[relativePath];
		const installed = manifest(relativePath);
		const name = relativePath.slice(relativePath.lastIndexOf("@esbuild/"));
		if (installed.name !== name || installed.version !== entry.version ||
			JSON.stringify(installed.os) !== JSON.stringify(entry.os) ||
			JSON.stringify(installed.cpu) !== JSON.stringify(entry.cpu) ||
			installed.libc !== undefined) {
			fail(`installed optional manifest differs from lock at ${relativePath}`);
		}
		if (host) {
			inspect(`${relativePath}/${options.platform === "win32" ? "esbuild.exe" : "bin/esbuild"}`, false, true);
		} else {
			remove.push(relativePath);
		}
	}
	for (const relativePath of wrappers) {
		const installed = manifest(relativePath);
		const locked = lock.packages[relativePath];
		const sorted = value => Object.entries(value ?? {}).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
		if (installed.name !== "esbuild" || installed.version !== locked.version ||
			JSON.stringify(sorted(installed.optionalDependencies)) !== JSON.stringify(sorted(locked.optionalDependencies))) {
			fail(`installed wrapper manifest differs from lock at ${relativePath}`);
		}
		inspect(`${relativePath}/lib/main.js`, false, true);
	}
	for (const binding of hostBindings) {
		// Reject unrecorded installed shadows, even if a package manager left
		// their manifests out of the normalized lock.
		for (const candidate of binding.candidates) {
			if (candidate === binding.packagePath) break;
			if (inspect(candidate, true)) fail(`unlocked host shadow at ${candidate}`);
		}
		const subpath = plan.platform === "win32" ? "esbuild.exe" : "bin/esbuild";
		const expected = inspect(`${binding.packagePath}/${subpath}`, false, true);
		const requireFromWrapper = createRequire(join(root, binding.wrapperPath, "lib/main.js"));
		const resolved = requireFromWrapper.resolve(`${binding.name}/${subpath}`);
		if (resolved !== expected || realpathSync(resolved) !== expected) {
			fail(`host binary resolution differs from exact lock at ${binding.wrapperPath}`);
		}
	}
	return { ...plan, workspacePath: root, remove };
}
