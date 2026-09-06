import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { gunzipSync } from "node:zlib";

// Exact registry esbuild 0.28.2 wrapper/manifest; 23 vendor binary hashes plus
// three WASM-platform binary hashes from integrity-verified platform tarballs.
export const FEYNMAN_ESBUILD_VERSION = "0.28.2";
export const ESBUILD_REGISTRY_INTEGRITY = "sha512-HKVLS8dvII+xoKW9kmqxbRKrnWEXfJJr/FZhhJmiqIB0e053QNYFqOBouTMO/k5sID4MvCiUCvv8b9M4h32wIA==";
export const ESBUILD_TARBALL_SHA256 = "e045f94c235c7adc50e77ba2a579c7bec41b496b6b47c3a7845f7c1e19959a88";
const contractBytes = gunzipSync(Buffer.from(
	"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",
	"base64",
));
if (createHash("sha256").update(contractBytes).digest("hex") !== "708d09d849a270ca502c81c0d5663c183fb83b75af352b9c10a65d1d57ecb396") throw new Error("Corrupt esbuild source contract");
const contract = JSON.parse(contractBytes.toString("utf8"));
export const ESBUILD_OPTIONAL_DEPENDENCIES = Object.freeze(contract.manifest.optionalDependencies);
export const ESBUILD_BINARY_HASHES = Object.freeze(contract.binaryHashes);
export const ESBUILD_SOURCE_HASHES = Object.freeze(contract.sourceHashes);
export const ESBUILD_PORTABLE_BIN_SOURCE = contract.bin;
export const ESBUILD_PLATFORM_LOCK_ENTRIES = Object.freeze(contract.platformLocks);
const PLATFORM_LOCKS = ESBUILD_PLATFORM_LOCK_ENTRIES;

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fail = (message) => { throw new Error(`[Feynman portable esbuild] ${message}`); };
const json = (path) => JSON.parse(readFileSync(path, "utf8"));
const supported = (version, label) => {
	if (!["0.28.1", FEYNMAN_ESBUILD_VERSION].includes(version)) fail(`Unsupported ${label}: ${version ?? "missing"}`);
};
const flags = (entry) => Object.fromEntries(["inBundle", "dev", "devOptional", "optional"]
	.filter((key) => entry?.[key] !== undefined).map((key) => [key, entry[key]]));
const esbuildLockEntry = (old) => ({
	version: FEYNMAN_ESBUILD_VERSION,
	resolved: "https://registry.npmjs.org/esbuild/-/esbuild-0.28.2.tgz",
	integrity: ESBUILD_REGISTRY_INTEGRITY,
	hasInstallScript: true, license: "MIT", bin: { esbuild: "bin/esbuild" },
	engines: { node: ">=18" }, optionalDependencies: { ...ESBUILD_OPTIONAL_DEPENDENCIES }, ...flags(old),
});

export function assertEsbuildRootManifest(source) {
	const manifest = JSON.parse(source);
	if (manifest.dependencies?.esbuild !== FEYNMAN_ESBUILD_VERSION) fail("root must depend on exact production esbuild 0.28.2");
	if (!manifest.bundleDependencies?.includes("esbuild")) fail("root must bundle portable esbuild JS");
	for (const [name, version] of Object.entries(ESBUILD_OPTIONAL_DEPENDENCIES)) {
		if (manifest.optionalDependencies?.[name] !== version) fail(`root optional dependency missing or wrong: ${name}@${version}`);
	}
}

export function patchPiChordEsbuildManifestSource(source) {
	const manifest = JSON.parse(source);
	if (manifest.name !== "@earendil-works/chord" || manifest.version !== "0.85.1") fail("unreviewed Chord manifest");
	supported(manifest.dependencies?.esbuild, "Chord esbuild dependency");
	if (manifest.dependencies.esbuild === FEYNMAN_ESBUILD_VERSION) return source;
	manifest.dependencies.esbuild = FEYNMAN_ESBUILD_VERSION;
	return JSON.stringify(manifest, null, 2) + "\n";
}

function patchEntries(packages, prefix) {
	let changed = false;
	const normalized = prefix ? prefix + "/" : "";
	for (const [path, entry] of Object.entries(packages)) {
		if (!path.startsWith(normalized + "node_modules/")) continue;
		const local = path.slice(normalized.length);
		if (local.endsWith("/@earendil-works/chord") && entry.version === "0.85.1") {
			supported(entry.dependencies?.esbuild, "locked Chord esbuild dependency");
			if (entry.dependencies.esbuild !== FEYNMAN_ESBUILD_VERSION) {
				entry.dependencies.esbuild = FEYNMAN_ESBUILD_VERSION; changed = true;
			}
		} else if (local.endsWith("/esbuild")) {
			supported(entry.version, "locked esbuild");
			const replacement = esbuildLockEntry(entry);
			if (JSON.stringify(entry) !== JSON.stringify(replacement)) { packages[path] = replacement; changed = true; }
		} else {
			const name = local.match(/(?:^|\/)node_modules\/(@esbuild\/[^/]+)$/)?.[1];
			if (!name) continue;
			if (!PLATFORM_LOCKS[name]) fail(`unreviewed optional platform: ${name}`);
			supported(entry.version, "locked platform");
			// The consumer supplies its applicable binary as a root optional package.
			// Keeping a nested lock entry would falsely require a removed host binary.
			delete packages[path]; changed = true;
		}
	}
	return changed;
}

export function patchPiEsbuildShrinkwrapSource(source, options = {}) {
	const lock = JSON.parse(source);
	if (lock.name !== "@earendil-works/pi-coding-agent" || lock.version !== "0.85.1" || !lock.packages) fail("unreviewed Pi shrinkwrap");
	return patchEntries(lock.packages, "") ? JSON.stringify(lock, null, 2) + "\n" : source;
}

export function patchPiEsbuildPackageLockSource(source, options = {}) {
	const lock = JSON.parse(source);
	if (!lock.packages) fail("package lock has no package entries");
	let changed = false;
	for (const [path, entry] of Object.entries(lock.packages)) {
		if (/node_modules\/(?:@earendil-works|@mariozechner)\/pi-coding-agent$/.test(path) && entry.version === "0.85.1") {
			changed = patchEntries(lock.packages, path) || changed;
		}
	}
	const chord = lock.packages["node_modules/@earendil-works/chord"];
	if (chord?.version === "0.85.1") {
		supported(chord.dependencies?.esbuild, "root locked Chord dependency");
		if (chord.dependencies.esbuild !== FEYNMAN_ESBUILD_VERSION) { chord.dependencies.esbuild = FEYNMAN_ESBUILD_VERSION; changed = true; }
	}
	return changed ? JSON.stringify(lock, null, 2) + "\n" : source;
}

export function assertEsbuildPlatformPackage(packageRoot) {
	const manifest = json(resolve(packageRoot, "package.json"));
	const relative = Object.keys(ESBUILD_BINARY_HASHES).find((key) => key.startsWith(manifest.name + "/"));
	if (!relative || manifest.version !== FEYNMAN_ESBUILD_VERSION) fail("unreviewed esbuild platform package");
	const binary = resolve(packageRoot, relative.slice(manifest.name.length + 1));
	if (!regularFile(binary) || hash(readFileSync(binary)) !== ESBUILD_BINARY_HASHES[relative]) fail(`platform binary digest mismatch: ${manifest.name}`);
	return binary;
}

function regularFile(path) {
	try { const s = lstatSync(path); return s.isFile() && !s.isSymbolicLink(); } catch { return false; }
}
function assertContained(path, boundary) {
	let cursor = resolve(path), root = realpathSync(boundary);
	while (!existsSync(cursor)) cursor = dirname(cursor);
	const rel = relative(root, realpathSync(cursor));
	if (rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel)) fail(`path escapes managed tree: ${path}`);
}
function assertPlainDirectory(path) {
	const s = lstatSync(path);
	if (!s.isDirectory() || s.isSymbolicLink()) fail(`expected real directory: ${path}`);
}

function planRootHostRecovery(nodeModulesPath, hostName) {
	const destination = resolve(nodeModulesPath, hostName);
	try {
		const stat = lstatSync(destination);
		// npm 11 global cross-platform bundle extraction can leave this exact
		// empty slot. Never replace a link, bad manifest or nonempty partial.
		if (!stat.isDirectory() || stat.isSymbolicLink() || readdirSync(destination).length !== 0) return;
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
	}
	for (const modules of [
		resolve(nodeModulesPath, "esbuild", "lib", "node_modules"),
		resolve(nodeModulesPath, "esbuild", "node_modules"),
	]) {
		try { lstatSync(resolve(modules, hostName)); fail("compiler-local host shadow prevents root recovery"); }
		catch (error) { if (error.code !== "ENOENT") throw error; }
	}
	const subpathKey = Object.keys(ESBUILD_BINARY_HASHES).find(key => key.startsWith(hostName + "/"));
	if (!subpathKey) fail("unknown recovery platform");
	const subpath = subpathKey.slice(hostName.length + 1);
	const compilerRequire = createRequire(resolve(nodeModulesPath, "esbuild", "lib", "main.js"));
	try {
		// Existing hoisting must follow the ordinary read-only resolver path.
		compilerRequire.resolve(`${hostName}/${subpath}`);
		return;
	} catch (error) {
		if (error.code !== "MODULE_NOT_FOUND") throw error;
	}
	const appRoot = dirname(nodeModulesPath), runtime = resolve(appRoot, ".feynman", "npm");
	const source = resolve(runtime, "node_modules", hostName);
	if (!existsSync(source)) return;
	// Only this installation's owned runtime can supply recovery bytes. No
	// ancestor package, NODE_PATH, cache search or download is a repair source.
	for (const path of [
		resolve(appRoot, ".feynman"), runtime, resolve(runtime, "node_modules"),
		resolve(runtime, "node_modules", "@esbuild"), source,
	]) { assertContained(path, appRoot); assertPlainDirectory(path); }
	const runtimeManifest = resolve(runtime, "package.json");
	if (!regularFile(runtimeManifest)) fail("missing or linked recovery runtime manifest");
	const configured = json(runtimeManifest);
	if (configured.name !== "feynman-runtime" || configured.private !== true ||
		configured.dependencies?.esbuild !== FEYNMAN_ESBUILD_VERSION) fail("unreviewed recovery runtime identity");
	const manifestPath = resolve(source, "package.json");
	if (!regularFile(manifestPath)) fail("missing or linked recovery platform manifest");
	const manifest = json(manifestPath), expected = PLATFORM_LOCKS[hostName];
	if (!expected || manifest.name !== hostName || manifest.version !== FEYNMAN_ESBUILD_VERSION ||
		JSON.stringify(manifest.os) !== JSON.stringify(expected.os) ||
		JSON.stringify(manifest.cpu) !== JSON.stringify(expected.cpu)) fail("recovery platform identity mismatch");
	const binary = resolve(source, subpath);
	assertContained(binary, source);
	if (dirname(binary) !== source) assertPlainDirectory(dirname(binary));
	if (!regularFile(binary)) fail("missing or linked recovery platform binary");
	// Hash and copy the same captured buffer. A donor changed after this read
	// cannot substitute different bytes between verification and installation.
	const binaryBytes = readFileSync(binary);
	if (hash(binaryBytes) !== ESBUILD_BINARY_HASHES[subpathKey]) fail("recovery platform binary digest mismatch");
	const runtimeRequire = createRequire(resolve(runtime, "node_modules", "esbuild", "lib", "main.js"));
	if (realpathSync(runtimeRequire.resolve(`${hostName}/${subpath}`)) !== realpathSync(binary)) fail("recovery source resolves outside its verified package");
	assertContained(destination, nodeModulesPath);
	if (existsSync(dirname(destination))) assertPlainDirectory(dirname(destination));
	// Donor package.json can contain unreviewed lifecycle/export metadata.
	// Only immutable reviewed platform identity fields belong in the repair.
	const canonicalManifest = Buffer.from(JSON.stringify({
		name: hostName, version: FEYNMAN_ESBUILD_VERSION,
		license: expected.license, engines: expected.engines,
		os: expected.os, cpu: expected.cpu,
	}, null, 2) + "\n");
	return { destination, files: new Map([
		["package.json", canonicalManifest], [subpath, binaryBytes],
	]) };
}

function resolvePortableHost(nodeModulesPath, hostName, runtime) {
	const localModules = realpathSync(nodeModulesPath);
	const candidates = [];
	for (let cursor = localModules; ; cursor = dirname(cursor)) {
		const modules = basename(cursor) === "node_modules" ? cursor : resolve(cursor, "node_modules");
		if (!candidates.includes(modules)) candidates.push(modules);
		if (runtime || dirname(cursor) === cursor) break;
	}
	// Match the first physical package in the compiler's permitted ancestor
	// chain. Never fall through an invalid nearer package to a valid outer one.
	const modules = candidates.find(candidate => {
		try { lstatSync(resolve(candidate, hostName)); return true; }
		catch (error) { if (error.code === "ENOENT") return false; throw error; }
	});
	if (!modules) fail(`host optional package unavailable in ${runtime ? "runtime-local" : "ancestor node_modules"} scope: ${hostName}`);
	assertPlainDirectory(modules);
	assertPlainDirectory(resolve(modules, "@esbuild"));
	const packageRoot = resolve(modules, hostName);
	assertPlainDirectory(packageRoot);
	const manifestPath = resolve(packageRoot, "package.json");
	if (!regularFile(manifestPath)) fail("linked or missing host platform manifest");
	const manifest = json(manifestPath), expected = PLATFORM_LOCKS[hostName];
	if (!expected || manifest.name !== hostName ||
		JSON.stringify(manifest.os) !== JSON.stringify(expected.os) ||
		JSON.stringify(manifest.cpu) !== JSON.stringify(expected.cpu)) fail("host platform identity mismatch");
	const binaryKey = Object.keys(ESBUILD_BINARY_HASHES).find(key => key.startsWith(hostName + "/"));
	const subpath = binaryKey.slice(hostName.length + 1);
	const binaryPath = resolve(packageRoot, subpath);
	assertContained(binaryPath, packageRoot);
	if (dirname(binaryPath) !== packageRoot) assertPlainDirectory(dirname(binaryPath));
	const binary = assertEsbuildPlatformPackage(packageRoot);
	// Actual Node resolution is authoritative, but NODE_PATH/global directories,
	// symlink escapes and wrapper-local shadows are outside the allowed chain.
	const compilerRequire = createRequire(resolve(localModules, "esbuild", "lib", "main.js"));
	const actual = compilerRequire.resolve(`${hostName}/${subpath}`);
	if (realpathSync(actual) !== realpathSync(binary)) fail("compiler host resolution escapes exact ancestor optional package");
	return { packageRoot, local: modules === localModules };
}

function portableFiles(sourcePackagePath, runtime) {
	assertPlainDirectory(sourcePackagePath);
	const output = new Map();
	for (const [file, digest] of Object.entries(ESBUILD_SOURCE_HASHES)) {
		const nonExecutable = file === "lib/main.d.ts" || file === "README.md";
		// Native packaging deliberately removes declarations/docs before this
		// module runs. They are not execution inputs. Preserve/hash-check them
		// when present for universal npm packaging, never rehydrate pruned ones.
		if (nonExecutable && (runtime || !existsSync(resolve(sourcePackagePath, file)))) continue;
		const path = resolve(sourcePackagePath, file);
		assertContained(path, sourcePackagePath);
		if (!regularFile(path)) fail(`missing or linked source file: ${file}`);
		const data = readFileSync(path);
		if (file === "bin/esbuild") {
			// npm's postinstall can hard-link this to the build host's native binary.
			// Validate it but always restore the exact vendor JS wrapper, never copy it.
			if (hash(data) !== digest && !Object.values(ESBUILD_BINARY_HASHES).includes(hash(data))) fail("unreviewed optimized esbuild CLI");
			output.set(file, Buffer.from(ESBUILD_PORTABLE_BIN_SOURCE));
		} else {
			if (hash(data) !== digest) fail(`source digest mismatch: ${file}`);
			output.set(file, data);
		}
	}
	return output;
}

function treeMatches(root, files) {
	if (!existsSync(root)) return false;
	const found = [];
	function walk(dir, prefix = "") {
		for (const name of readdirSync(dir)) {
			const path = resolve(dir, name), rel = prefix + name, stat = lstatSync(path);
			if (stat.isSymbolicLink()) return false;
			if (stat.isDirectory()) { if (!walk(path, rel + "/")) return false; }
			else { if (!stat.isFile()) return false; found.push(rel); }
		}
		return true;
	}
	if (!walk(root) || found.length !== files.size) return false;
	return found.every((name) => files.has(name) && readFileSync(resolve(root, name)).equals(files.get(name)));
}

function replacePortableTree(destination, files, validateInstalled) {
	mkdirSync(dirname(destination), { recursive: true });
	const stage = mkdtempSync(resolve(dirname(destination), ".feynman-esbuild-stage-"));
	const backup = stage + ".backup";
	let moved = false;
	try {
		for (const [file, data] of files) {
			const path = resolve(stage, file); mkdirSync(dirname(path), { recursive: true });
			writeFileSync(path, data, { mode: (file === "bin/esbuild" || file === "esbuild.exe") ? 0o755 : 0o644 });
		}
		if (existsSync(destination)) { renameSync(destination, backup); moved = true; }
		let installed = false;
		try {
			renameSync(stage, destination); installed = true;
			validateInstalled?.();
		} catch (error) {
			if (installed) rmSync(destination, { recursive: true, force: true });
			if (moved) renameSync(backup, destination);
			throw error;
		}
		if (moved) rmSync(backup, { recursive: true, force: true });
	} finally { rmSync(stage, { recursive: true, force: true }); }
}

/** Normalize portable JS/ancestor binary resolution; never prune root platform options. */
export function patchPiEsbuildPackageTree(nodeModulesPath, sourcePackagePath = resolve(nodeModulesPath, "esbuild"), options = {}) {
	if (!existsSync(nodeModulesPath)) return false;
	assertPlainDirectory(nodeModulesPath);
	// Follow the other package-tree repairs: only manage current shrinkwrapped Pi.
	const managed = ["@earendil-works", "@mariozechner"].some(scope => {
		const pi = resolve(nodeModulesPath, scope, "pi-coding-agent");
		return existsSync(resolve(pi, "npm-shrinkwrap.json")) && json(resolve(pi, "package.json")).version === "0.85.1";
	});
	if (!managed) return false;
	const appRoot = dirname(nodeModulesPath);
	const manifestSource = readFileSync(resolve(appRoot, "package.json"), "utf8");
	if (options.runtime === true) {
		if (JSON.parse(manifestSource).dependencies?.esbuild !== FEYNMAN_ESBUILD_VERSION) fail("runtime must directly pin esbuild 0.28.2");
	} else assertEsbuildRootManifest(manifestSource);
	const hostName = `@esbuild/${options.platform ?? process.platform}-${options.arch ?? process.arch}`;
	const files = portableFiles(sourcePackagePath, options.runtime === true);
	const recovery = options.runtime === true ? undefined : planRootHostRecovery(nodeModulesPath, hostName);
	const host = recovery ? { packageRoot: recovery.destination, local: true }
		: resolvePortableHost(nodeModulesPath, hostName, options.runtime === true);
	const targets = new Set([resolve(nodeModulesPath, "esbuild")]);
	const metadata = new Map(), removals = new Set(), seenPi = new Set();
	const chordRoots = new Set([resolve(nodeModulesPath, "@earendil-works", "chord")]);
	for (const scope of ["@earendil-works", "@mariozechner"]) {
		const aliasRoot = resolve(nodeModulesPath, scope, "pi-coding-agent");
		if (!existsSync(aliasRoot)) continue;
		assertContained(aliasRoot, nodeModulesPath);
		const piRoot = realpathSync(aliasRoot);
		if (seenPi.has(piRoot)) continue;
		seenPi.add(piRoot);
		const manifest = json(resolve(piRoot, "package.json"));
		if (manifest.version !== "0.85.1") continue;
		if (manifest.name !== "@earendil-works/pi-coding-agent") fail("unreviewed Pi package identity");
		const shrinkPath = resolve(piRoot, "npm-shrinkwrap.json");
		assertContained(shrinkPath, nodeModulesPath);
		const source = readFileSync(shrinkPath, "utf8"), lock = JSON.parse(source);
		metadata.set(shrinkPath, patchPiEsbuildShrinkwrapSource(source, options));
		for (const key of Object.keys(lock.packages)) {
			if (!key.startsWith("node_modules/")) continue;
			if (key.endsWith("/esbuild")) {
				targets.add(resolve(piRoot, key));
			}
			else if (key.endsWith("/@earendil-works/chord")) chordRoots.add(resolve(piRoot, key));
			else if (/(?:^|\/)node_modules\/@esbuild\/[^/]+$/.test(key)) {
				const dir = resolve(piRoot, key);
				assertContained(dir, nodeModulesPath);
				if (existsSync(dir)) {
					assertPlainDirectory(dir); const p = json(resolve(dir, "package.json"));
					if (!ESBUILD_OPTIONAL_DEPENDENCIES[p.name]) fail(`unknown nested platform package: ${p.name}`);
					supported(p.version, "nested platform version");
					removals.add(dir);
				}
			}
		}
	}
	for (const chordRoot of chordRoots) {
		if (!existsSync(chordRoot)) continue;
		assertContained(chordRoot, nodeModulesPath); assertPlainDirectory(chordRoot);
		const path = resolve(chordRoot, "package.json"), source = readFileSync(path, "utf8");
		metadata.set(path, patchPiChordEsbuildManifestSource(source));
	}
	for (const target of targets) {
		assertContained(target, nodeModulesPath);
		if (existsSync(target)) { assertPlainDirectory(target); const p = json(resolve(target, "package.json"));
			if (p.name !== "esbuild") fail("unexpected esbuild target name"); supported(p.version, "installed esbuild"); }
	}
	for (const path of [resolve(appRoot, "package-lock.json"), resolve(nodeModulesPath, ".package-lock.json")]) {
		if (existsSync(path)) { assertContained(path, appRoot); const source = readFileSync(path, "utf8"), lock = JSON.parse(source);
			const hostEntry = lock.packages?.[`node_modules/${hostName}`];
			// Consumer-hoisted optionals need not appear in Feynman's own lock.
			// Do not inspect or mutate the ancestor consumer lock to manufacture one.
			if ((host.local || hostEntry !== undefined) &&
				(hostEntry?.version !== FEYNMAN_ESBUILD_VERSION || hostEntry.integrity !== PLATFORM_LOCKS[hostName]?.integrity)) fail("root host platform lock identity missing or wrong");
			metadata.set(path, patchPiEsbuildPackageLockSource(source, options)); }
	}
	for (const path of metadata.keys()) {
		assertContained(path, appRoot);
		if (!regularFile(path)) fail(`linked metadata file: ${path}`);
	}
	// Complete preflight above before changing any package or metadata.
	let changed = false;
	if (recovery) {
		// Recovery is not acceptance of an empty directory: the same strict
		// guards must pass on installed bytes before the empty-slot backup is
		// discarded. A final resolver failure restores the original slot.
		replacePortableTree(recovery.destination, recovery.files,
			() => resolvePortableHost(nodeModulesPath, hostName, false));
		changed = true;
	}
	for (const target of targets) if (!treeMatches(target, files)) { replacePortableTree(target, files); changed = true; }
	for (const dir of removals) { rmSync(dir, { recursive: true }); changed = true; }
	for (const [path, source] of metadata) if (readFileSync(path, "utf8") !== source) { writeFileSync(path, source); changed = true; }
	return changed;
}
