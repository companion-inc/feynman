import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const appRoot = resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(readFileSync(resolve(appRoot, "package.json"), "utf8"));
const packageLockPath = resolve(appRoot, "package-lock.json");
const minBundledNodeVersion = packageJson.engines?.node?.replace(/^>=/, "").trim() || process.version.slice(1);

function parseSemver(version) {
	const [major = "0", minor = "0", patch = "0"] = version.split(".");
	return [Number.parseInt(major, 10) || 0, Number.parseInt(minor, 10) || 0, Number.parseInt(patch, 10) || 0];
}

function compareSemver(left, right) {
	for (let index = 0; index < 3; index += 1) {
		const diff = left[index] - right[index];
		if (diff !== 0) return diff;
	}
	return 0;
}

function fail(message) {
	console.error(`[feynman] ${message}`);
	process.exit(1);
}

function resolveBundledNodeVersion() {
	const requestedNodeVersion = process.env.FEYNMAN_BUNDLED_NODE_VERSION?.trim();
	if (requestedNodeVersion) {
		if (compareSemver(parseSemver(requestedNodeVersion), parseSemver(minBundledNodeVersion)) < 0) {
			fail(
				`FEYNMAN_BUNDLED_NODE_VERSION=${requestedNodeVersion} is below the supported floor ${minBundledNodeVersion}`,
			);
		}
		return requestedNodeVersion;
	}

	const currentNodeVersion = process.version.slice(1);
	return compareSemver(parseSemver(currentNodeVersion), parseSemver(minBundledNodeVersion)) < 0
		? minBundledNodeVersion
		: currentNodeVersion;
}

const bundledNodeVersion = resolveBundledNodeVersion();

function resolveCommand(command) {
	if (process.platform === "win32" && command === "npm") {
		return "npm.cmd";
	}

	return command;
}

function spawnOptions(command, options = {}) {
	if (process.platform === "win32" && command.endsWith(".cmd")) {
		return {
			shell: true,
			...options,
		};
	}

	return options;
}

function run(command, args, options = {}) {
	const resolvedCommand = resolveCommand(command);
	const result = spawnSync(resolvedCommand, args, {
		stdio: "inherit",
		...spawnOptions(resolvedCommand, options),
		...options,
	});
	if (result.error) {
		fail(`${resolvedCommand} ${args.join(" ")} failed: ${result.error.message}`);
	}
	if (result.status !== 0) {
		fail(`${resolvedCommand} ${args.join(" ")} failed with code ${result.status ?? 1}`);
	}
}

function runCapture(command, args, options = {}) {
	const resolvedCommand = resolveCommand(command);
	const result = spawnSync(resolvedCommand, args, {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
		...spawnOptions(resolvedCommand, options),
		...options,
	});
	if (result.error) {
		fail(`${resolvedCommand} ${args.join(" ")} failed: ${result.error.message}`);
	}
	if (result.status !== 0) {
		const errorOutput = result.stderr?.trim() || result.stdout?.trim() || "unknown error";
		fail(`${resolvedCommand} ${args.join(" ")} failed: ${errorOutput}`);
	}
	return result.stdout.trim();
}

function detectTarget() {
	if (process.platform === "darwin" && process.arch === "arm64") {
		return {
			id: "darwin-arm64",
			nodePlatform: "darwin",
			nodeArch: "arm64",
			bundleExtension: "tar.gz",
			launcher: "unix",
		};
	}
	if (process.platform === "darwin" && process.arch === "x64") {
		return {
			id: "darwin-x64",
			nodePlatform: "darwin",
			nodeArch: "x64",
			bundleExtension: "tar.gz",
			launcher: "unix",
		};
	}
	if (process.platform === "linux" && process.arch === "arm64") {
		return {
			id: "linux-arm64",
			nodePlatform: "linux",
			nodeArch: "arm64",
			bundleExtension: "tar.gz",
			launcher: "unix",
		};
	}
	if (process.platform === "linux" && process.arch === "x64") {
		return {
			id: "linux-x64",
			nodePlatform: "linux",
			nodeArch: "x64",
			bundleExtension: "tar.gz",
			launcher: "unix",
		};
	}
	if (process.platform === "win32" && process.arch === "arm64") {
		return {
			id: "win32-arm64",
			nodePlatform: "win",
			nodeArch: "arm64",
			bundleExtension: "zip",
			launcher: "windows",
		};
	}
	if (process.platform === "win32" && process.arch === "x64") {
		return {
			id: "win32-x64",
			nodePlatform: "win",
			nodeArch: "x64",
			bundleExtension: "zip",
			launcher: "windows",
		};
	}

	fail(`unsupported platform ${process.platform}/${process.arch}`);
}

function nodeArchiveName(target) {
	if (target.nodePlatform === "win") {
		return `node-v${bundledNodeVersion}-${target.nodePlatform}-${target.nodeArch}.zip`;
	}
	return `node-v${bundledNodeVersion}-${target.nodePlatform}-${target.nodeArch}.tar.xz`;
}

function ensureBundledWorkspace() {
	run(process.execPath, [resolve(appRoot, "scripts", "prepare-runtime-workspace.mjs")], { cwd: appRoot });
}

function copyPackageFiles(appDir) {
	const releaseDir = resolve(appRoot, "dist", "release");
	cpSync(resolve(appRoot, "package.json"), resolve(appDir, "package.json"));
	for (const entry of packageJson.files) {
		const normalized = entry.endsWith("/") ? entry.slice(0, -1) : entry;
		const source = resolve(appRoot, normalized);
		if (!existsSync(source)) continue;
		const destination = resolve(appDir, normalized);
		mkdirSync(dirname(destination), { recursive: true });
		cpSync(source, destination, {
			recursive: true,
			filter: (path) => path !== releaseDir && !path.startsWith(`${releaseDir}/`),
		});
	}

	cpSync(packageLockPath, resolve(appDir, "package-lock.json"));
}

function installAppDependencies(appDir, stagingRoot) {
	const depsDir = resolve(stagingRoot, "prod-deps");
	rmSync(depsDir, { recursive: true, force: true });
	mkdirSync(depsDir, { recursive: true });

	cpSync(resolve(appRoot, "package.json"), resolve(depsDir, "package.json"));
	cpSync(packageLockPath, resolve(depsDir, "package-lock.json"));

	run("npm", ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund", "--loglevel", "error"], {
		cwd: depsDir,
	});
	run(process.execPath, [resolve(appRoot, "scripts", "prune-runtime-deps.mjs"), depsDir], {
		cwd: appRoot,
	});

	cpSync(resolve(depsDir, "node_modules"), resolve(appDir, "node_modules"), { recursive: true });
}

function extractTarball(archivePath, destination, compressionFlag) {
	run("tar", [compressionFlag, archivePath, "-C", destination]);
}

function extractZip(archivePath, destination) {
	if (process.platform === "win32") {
		run("powershell", [
			"-NoProfile",
			"-Command",
			`Expand-Archive -LiteralPath '${archivePath.replace(/'/g, "''")}' -DestinationPath '${destination.replace(/'/g, "''")}' -Force`,
		]);
		return;
	}

	run("unzip", ["-q", archivePath, "-d", destination]);
}

function findSingleDirectory(path) {
	const entries = readdirSync(path).filter((entry) => !entry.startsWith("."));
	if (entries.length !== 1) {
		fail(`expected exactly one directory in ${path}, found: ${entries.join(", ")}`);
	}
	const child = resolve(path, entries[0]);
	if (!statSync(child).isDirectory()) {
		fail(`expected ${child} to be a directory`);
	}
	return child;
}

function installBundledNode(bundleRoot, target, stagingRoot) {
	const archiveName = nodeArchiveName(target);
	const archivePath = resolve(stagingRoot, archiveName);
	const url = `https://nodejs.org/dist/v${bundledNodeVersion}/${archiveName}`;

	run("curl", ["-fsSL", url, "-o", archivePath]);

	const extractRoot = resolve(stagingRoot, "node-dist");
	mkdirSync(extractRoot, { recursive: true });
	if (archiveName.endsWith(".zip")) {
		extractZip(archivePath, extractRoot);
	} else {
		extractTarball(archivePath, extractRoot, "-xJf");
	}

	const extractedDir = findSingleDirectory(extractRoot);
	renameSync(extractedDir, resolve(bundleRoot, "node"));
}

function writeLauncher(bundleRoot, target) {
	if (target.launcher === "unix") {
		const launcherPath = resolve(bundleRoot, "feynman");
		writeFileSync(
			launcherPath,
			[
				"#!/bin/sh",
				"set -eu",
				'ROOT="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"',
				'exec "$ROOT/node/bin/node" "$ROOT/app/bin/feynman.js" "$@"',
				"",
			].join("\n"),
			"utf8",
		);
		chmodSync(launcherPath, 0o755);
		return;
	}

	writeFileSync(
		resolve(bundleRoot, "feynman.cmd"),
		[
			"@echo off",
			"setlocal",
			'set "ROOT=%~dp0"',
			'if "%ROOT:~-1%"=="\\" set "ROOT=%ROOT:~0,-1%"',
			'"%ROOT%\\node\\node.exe" "%ROOT%\\app\\bin\\feynman.js" %*',
			"",
		].join("\r\n"),
		"utf8",
	);
	writeFileSync(
		resolve(bundleRoot, "feynman.ps1"),
		[
			'$Root = Split-Path -Parent $MyInvocation.MyCommand.Path',
			'& "$Root\\node\\node.exe" "$Root\\app\\bin\\feynman.js" @args',
			"",
		].join("\r\n"),
		"utf8",
	);
}

function validateBundle(bundleRoot, target) {
	const nodeExecutable =
		target.launcher === "windows"
			? resolve(bundleRoot, "node", "node.exe")
			: resolve(bundleRoot, "node", "bin", "node");

	run(nodeExecutable, ["-e", "require('./app/.feynman/npm/node_modules/better-sqlite3'); console.log('better-sqlite3 ok')"], {
		cwd: bundleRoot,
	});
}

function packBundle(bundleRoot, target, outDir) {
	const archiveName = `${basename(bundleRoot)}.${target.bundleExtension}`;
	const archivePath = resolve(outDir, archiveName);
	rmSync(archivePath, { force: true });

	if (target.bundleExtension === "zip") {
		if (process.platform === "win32") {
			const bundleDir = dirname(bundleRoot).replace(/'/g, "''");
			const bundleName = basename(bundleRoot).replace(/'/g, "''");
			run("powershell", [
				"-NoProfile",
				"-Command",
				`Push-Location '${bundleDir}'; Compress-Archive -Path '${bundleName}' -DestinationPath '${archivePath.replace(/'/g, "''")}' -Force; Pop-Location`,
			]);
		} else {
			run("zip", ["-qr", archivePath, basename(bundleRoot)], { cwd: resolve(bundleRoot, "..") });
		}
		return archivePath;
	}

	run("tar", ["-czf", archivePath, basename(bundleRoot)], { cwd: resolve(bundleRoot, "..") });
	return archivePath;
}

function main() {
	const target = detectTarget();
	const stagingRoot = mkdtempSync(join(tmpdir(), "feynman-native-"));
	const outDir = resolve(appRoot, "dist", "release");
	const bundleRoot = resolve(stagingRoot, `feynman-${packageJson.version}-${target.id}`);
	const appDir = resolve(bundleRoot, "app");

	mkdirSync(outDir, { recursive: true });
	mkdirSync(appDir, { recursive: true });

	ensureBundledWorkspace();
	copyPackageFiles(appDir);
	installAppDependencies(appDir, stagingRoot);

	const appFeynmanDir = resolve(appDir, ".feynman");
	extractTarball(resolve(appFeynmanDir, "runtime-workspace.tgz"), appFeynmanDir, "-xzf");
	rmSync(resolve(appFeynmanDir, "runtime-workspace.tgz"), { force: true });
	run(process.execPath, [resolve(appDir, "scripts", "patch-embedded-pi.mjs")], { cwd: appDir });

	installBundledNode(bundleRoot, target, stagingRoot);
	writeLauncher(bundleRoot, target);
	validateBundle(bundleRoot, target);

	const archivePath = packBundle(bundleRoot, target, outDir);
	console.log(`[feynman] native bundle ready: ${archivePath}`);
}

main();
