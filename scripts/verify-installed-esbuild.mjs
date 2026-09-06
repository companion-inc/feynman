import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runInNewContext } from "node:vm";
import {
	assertEsbuildPlatformPackage,
	ESBUILD_PORTABLE_BIN_SOURCE,
	ESBUILD_SOURCE_HASHES,
	FEYNMAN_ESBUILD_VERSION,
} from "./lib/pi-esbuild-package-patch.mjs";
import { isDirectExecution } from "./lib/direct-execution.mjs";
import { removeTemporaryTree } from "./lib/temporary-tree-cleanup.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const defaultRoot = resolve(dirname(scriptPath), "..");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const json = (path) => JSON.parse(readFileSync(path, "utf8"));

export function installedCompilerSurfaces(packageRoot) {
	return [
		["root", resolve(packageRoot, "node_modules")],
		["runtime", resolve(packageRoot, ".feynman/npm/node_modules")],
	].flatMap(([label, modules]) => [
		{ label, modules },
		{ label: `${label}-pi`, modules: join(modules, "@earendil-works/pi-coding-agent/node_modules") },
	]);
}

export function assertCompilerSurface(surface) {
	const esbuildRoot = join(surface.modules, "esbuild");
	const chordRoot = join(surface.modules, "@earendil-works/chord");
	const manifest = json(join(esbuildRoot, "package.json"));
	assert.equal(manifest.name, "esbuild", `${surface.label}: wrong compiler package`);
	assert.equal(manifest.version, FEYNMAN_ESBUILD_VERSION, `${surface.label}: wrong compiler version`);
	assert.equal(manifest.bin?.esbuild, "bin/esbuild");
	const main = join(esbuildRoot, "lib/main.js");
	assert.equal(sha256(readFileSync(main)), ESBUILD_SOURCE_HASHES["lib/main.js"],
		`${surface.label}: compiler API wrapper differs from the reviewed contract`);
	assert.equal(readFileSync(join(esbuildRoot, "bin/esbuild"), "utf8"), ESBUILD_PORTABLE_BIN_SOURCE,
		`${surface.label}: CLI must be the portable JS wrapper, not a copied host binary`);
	const chord = json(join(chordRoot, "package.json"));
	assert.equal(chord.name, "@earendil-works/chord");
	assert.equal(chord.version, "0.85.1", `${surface.label}: unreviewed Chord version`);
	assert.equal(chord.dependencies?.esbuild, FEYNMAN_ESBUILD_VERSION);
	// Validate the compiler Chord actually imports, not merely a nearby package.
	const chordRequire = createRequire(join(chordRoot, "dist/node/bundle.js"));
	assert.equal(realpathSync(chordRequire.resolve("esbuild")), realpathSync(main),
		`${surface.label}: Chord resolves a different compiler copy`);
	const compilerRequire = createRequire(main);
	const platformManifest = compilerRequire.resolve(`@esbuild/${process.platform}-${process.arch}/package.json`);
	const binary = assertEsbuildPlatformPackage(dirname(platformManifest));
	return { ...surface, esbuildRoot, chordRoot, binary };
}

export function compilerEnvironment(home) {
	const systemRoot = process.env.SystemRoot ?? process.env.SYSTEMROOT;
	return {
		...(process.platform === "win32" && systemRoot
			? { SystemRoot: systemRoot, WINDIR: systemRoot } : {}),
		PATH: [dirname(process.execPath),
			...(process.platform === "win32"
				? (systemRoot ? [join(systemRoot, "System32")] : [])
				: ["/usr/bin", "/bin"])].join(delimiter),
		HOME: home, USERPROFILE: home, TMPDIR: home, TMP: home, TEMP: home,
		APPDATA: join(home, "AppData/Roaming"), LOCALAPPDATA: join(home, "AppData/Local"),
		XDG_CONFIG_HOME: join(home, ".config"), XDG_CACHE_HOME: join(home, ".cache"),
	};
}

async function verifySurfaceWorker(modules, temporaryRoot) {
	// No package installation, external imports in the fixture, or network use.
	// Fail loudly if an unexpected dependency attempts outbound I/O.
	const net = (await import("node:net")).default;
	const deny = () => { throw new Error("Installed compiler smoke forbids network access"); };
	net.Socket.prototype.connect = deny;
	globalThis.fetch = async () => deny();
	const surface = assertCompilerSurface({ label: "worker", modules });
	const require = createRequire(join(surface.esbuildRoot, "package.json"));
	const esbuild = require(join(surface.esbuildRoot, "lib/main.js"));
	try {
		assert.equal(esbuild.version, FEYNMAN_ESBUILD_VERSION);
		const transformed = await esbuild.transform("export const answer: number = 6 * 7;", {
			loader: "ts", format: "cjs", target: "es2022",
		});
		assert.deepEqual(transformed.warnings, []);
		const context = { module: { exports: {} } };
		runInNewContext(transformed.code, context, { timeout: 1000 });
		assert.equal(context.module.exports.answer, 42, "API transform produced incorrect executable output");
		const cli = spawnSync(process.execPath, [join(surface.esbuildRoot, "bin/esbuild"), "--version"], {
			cwd: temporaryRoot, env: process.env, encoding: "utf8", timeout: 10000, windowsHide: true,
		});
		assert.ifError(cli.error);
		assert.equal(cli.status, 0, cli.stderr);
		assert.equal(cli.stdout.trim(), FEYNMAN_ESBUILD_VERSION);
		const source = join(temporaryRoot, "facet.ts");
		writeFileSync(source, "export const answer: number = 6 * 7;\n");
		const { bundleFacets } = await import(pathToFileURL(join(surface.chordRoot, "dist/bundler.js")).href);
		const outdir = join(temporaryRoot, "bundle");
		const result = await bundleFacets({
			plugin: { id: "feynman-offline-compiler-smoke", version: "1" },
			entries: { research: source }, outdir, workingDirectory: temporaryRoot, platform: "node",
		});
		assert.equal(result.manifestPath, join(outdir, "chord-facets.json"));
		assert.deepEqual(json(result.manifestPath), result.manifest);
		assert.equal(result.manifest.format, "chord.facet-bundle");
		assert.deepEqual(Object.keys(result.manifest.entries), ["research"]);
		const entry = result.manifest.entries.research;
		assert.equal(basename(entry.file), entry.file, "Chord emitted a nonlocal artifact path");
		assert.ok(entry.file.endsWith(".cjs"));
		assert.deepEqual(entry.externalImports, []);
		const artifact = join(outdir, entry.file);
		const bytes = readFileSync(artifact);
		assert.equal(entry.integrity, `sha256-${createHash("sha256").update(bytes).digest("base64")}`);
		assert.equal(require(artifact).answer, 42, "Chord bundle returned incorrect runtime value");
		return { version: esbuild.version, apiTransform: true, cliVersion: cli.stdout.trim(),
			chordBundle: true, artifactIntegrity: entry.integrity, binary: surface.binary };
	} finally {
		// Runs in this verifier's worker only; cannot stop an application's service.
		esbuild.stop();
	}
}

export function verifyInstalledEsbuild(packageRoot = defaultRoot) {
	const surfaces = installedCompilerSurfaces(resolve(packageRoot));
	// All four are mandatory. A missing/unprepared runtime is not a green skip.
	for (const surface of surfaces) assertCompilerSurface(surface);
	const results = [];
	for (const surface of surfaces) {
		const temporaryRoot = mkdtempSync(join(tmpdir(), "feynman-esbuild-smoke-"));
		let primaryError;
		try {
			const run = spawnSync(process.execPath, [scriptPath, "--surface-worker", surface.modules, temporaryRoot], {
				cwd: temporaryRoot, env: compilerEnvironment(temporaryRoot),
				encoding: "utf8", timeout: 30000, windowsHide: true,
			});
			assert.ifError(run.error);
			assert.equal(run.status, 0, `${surface.label}: ${run.stderr}\n${run.stdout}`);
			const proof = JSON.parse(run.stdout);
			assert.equal(proof.apiTransform, true);
			assert.equal(proof.chordBundle, true);
			results.push({ label: surface.label, ...proof });
		} catch (error) {
			primaryError = error;
		}
		try { removeTemporaryTree(temporaryRoot); }
		catch (error) {
			if (primaryError) throw new AggregateError([primaryError, error], "Compiler verification and cleanup failed");
			throw error;
		}
		if (primaryError) throw primaryError;
		assert.equal(existsSync(temporaryRoot), false);
	}
	return { version: FEYNMAN_ESBUILD_VERSION, surfaces: results };
}

if (isDirectExecution(process.argv[1], scriptPath)) {
	if (process.argv[2] === "--surface-worker") {
		assert.equal(process.argv.length, 5, "Internal compiler worker requires modules and temporary directory");
		console.log(JSON.stringify(await verifySurfaceWorker(resolve(process.argv[3]), resolve(process.argv[4]))));
	} else {
		assert.ok(process.argv.length <= 3, "Usage: node scripts/verify-installed-esbuild.mjs [package-root]");
		console.log(JSON.stringify(verifyInstalledEsbuild(process.argv[2] ?? defaultRoot)));
	}
}
