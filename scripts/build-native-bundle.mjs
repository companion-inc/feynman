import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { patchPiEsbuildPackageTree } from "./lib/pi-esbuild-package-patch.mjs";
import {
	computeRuntimeArchiveTreeHash,
	computeRuntimeTreeHash,
	verifyFileSha256,
} from "./lib/runtime-workspace-integrity.mjs";
import {
	getRuntimeWorkspaceCompletionPath,
	runtimeWorkspaceCompletionMatches,
} from "./lib/runtime-workspace-restore.mjs";
import {
	createDeterministicTarGz,
	createDeterministicZip,
} from "./lib/deterministic-archive.mjs";
import { resolveChildProcessCommand } from "./lib/child-process-command.mjs";

const appRoot = resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(readFileSync(resolve(appRoot, "package.json"), "utf8"));
const packageLockPath = resolve(appRoot, "package-lock.json");
const minBundledNodeVersion = packageJson.engines?.node?.match(/>=\s*([0-9]+\.[0-9]+\.[0-9]+)/)?.[1] || process.version.slice(1);
const releaseNodeVersion = readFileSync(resolve(appRoot, ".nvmrc"), "utf8").trim().replace(/^v/, "");
const PINNED_NODE_ARCHIVE_SHA256 = {
	"node-v24.20.0-darwin-arm64.tar.xz": "b7bf7707070b950ba1ec5f1af3bb6de0f2b1962c5033973d94068ab021ef3014",
	"node-v24.20.0-darwin-x64.tar.xz": "26fc30891004603d094eed11de5efcd03bbd2efbc35c177fc72648d5d7a7701b",
	"node-v24.20.0-linux-arm64.tar.xz": "5f4ddab610c1ab2016b3c227cebdbf6d9495161487e4739c7b90090595f465f7",
	"node-v24.20.0-linux-x64.tar.xz": "2f2c0da162318f0de47665410c7c8c2ed3d36c8f3105de4bbc61176c70a7cbf2",
	"node-v24.20.0-win-arm64.zip": "31c6799744de8a54601643098040c68c3697e56c94e407d61d0e5fa5f34191d7",
	"node-v24.20.0-win-x64.zip": "6cac9ffbca8f6a47091e4b5c772e0606049c3871cb67d900c0cedde630e545ba",
};

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

function logStep(message) {
	console.log(`[feynman] ${message}`);
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

	return compareSemver(parseSemver(releaseNodeVersion), parseSemver(minBundledNodeVersion)) < 0
		? minBundledNodeVersion
		: releaseNodeVersion;
}

const bundledNodeVersion = resolveBundledNodeVersion();

function run(command, args, options = {}) {
	const resolvedCommand = process.platform === "win32" && command === "npm" ? "npm.cmd" : command;
	const invocation = resolveChildProcessCommand(resolvedCommand, args);
	const result = spawnSync(invocation.command, invocation.args, {
		stdio: "inherit",
		shell: invocation.shell,
		windowsVerbatimArguments: invocation.windowsVerbatimArguments,
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
	const resolvedCommand = process.platform === "win32" && command === "npm" ? "npm.cmd" : command;
	const invocation = resolveChildProcessCommand(resolvedCommand, args);
	const result = spawnSync(invocation.command, invocation.args, {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
		shell: invocation.shell,
		windowsVerbatimArguments: invocation.windowsVerbatimArguments,
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

function commandExists(command) {
	const result = spawnSync(process.platform === "win32" ? "where" : "command", process.platform === "win32" ? [command] : ["-v", command], {
		stdio: "ignore",
		shell: process.platform !== "win32",
	});
	return result.status === 0;
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
	logStep("preparing bundled runtime workspace...");
	run(process.execPath, [resolve(appRoot, "scripts", "prepare-runtime-workspace.mjs")], { cwd: appRoot });
}

function copyPackageFiles(appDir) {
	logStep("copying package files...");
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
	logStep("installing production dependencies...");
	const depsDir = resolve(stagingRoot, "prod-deps");
	rmSync(depsDir, { recursive: true, force: true });
	mkdirSync(depsDir, { recursive: true });

	cpSync(resolve(appRoot, "package.json"), resolve(depsDir, "package.json"));
	cpSync(packageLockPath, resolve(depsDir, "package-lock.json"));

	run("npm", ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund", "--loglevel", "error"], {
		cwd: depsDir,
	});
	patchPiEsbuildPackageTree(resolve(depsDir, "node_modules"));
	run(process.execPath, [resolve(appRoot, "scripts", "prune-runtime-deps.mjs"), depsDir, "--platform-native"], {
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
	const expectedSha256 =
		process.env.FEYNMAN_BUNDLED_NODE_SHA256?.trim() ||
		PINNED_NODE_ARCHIVE_SHA256[archiveName];
	if (!expectedSha256) {
		fail(
			`no trusted SHA-256 is configured for ${archiveName}; set FEYNMAN_BUNDLED_NODE_SHA256 for an intentional override`,
		);
	}

	logStep(`downloading Node.js ${bundledNodeVersion} for ${target.id}...`);
	run("curl", ["-fsSL", url, "-o", archivePath]);
	const actualSha256 = createHash("sha256").update(readFileSync(archivePath)).digest("hex");
	if (actualSha256 !== expectedSha256) {
		fail(`Node.js archive SHA-256 mismatch for ${archiveName}: expected ${expectedSha256}, found ${actualSha256}`);
	}

	logStep("extracting bundled Node.js...");
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

function resolveBundledNodeExecutable(bundleRoot, target) {
	return target.launcher === "windows"
		? resolve(bundleRoot, "node", "node.exe")
		: resolve(bundleRoot, "node", "bin", "node");
}

function writeLauncher(bundleRoot, target) {
	logStep("writing launchers...");
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
	logStep("validating bundled native dependencies...");
	const nodeExecutable = resolveBundledNodeExecutable(bundleRoot, target);

	const betterSqlitePackageJson = resolve(bundleRoot, "app", ".feynman", "npm", "node_modules", "better-sqlite3", "package.json");
	if (!existsSync(betterSqlitePackageJson)) {
		logStep("skipping better-sqlite3 validation; sqlite-backed packages are not bundled for this Node runtime");
	} else {
		run(nodeExecutable, ["-e", "require('./app/.feynman/npm/node_modules/better-sqlite3'); console.log('better-sqlite3 ok')"], {
			cwd: bundleRoot,
		});
	}

	const launchers = target.launcher === "windows"
		? [
			{ command: resolve(bundleRoot, "feynman.cmd"), prefix: [] },
			{
				command: "powershell",
				prefix: [
					"-NoProfile",
					"-ExecutionPolicy",
					"Bypass",
					"-File",
					resolve(bundleRoot, "feynman.ps1"),
				],
			},
		]
		: [{ command: resolve(bundleRoot, "feynman"), prefix: [] }];

	for (const launcher of launchers) {
		const versionOutput = runCapture(
			launcher.command,
			[...launcher.prefix, "--version"],
			{ cwd: bundleRoot },
		);
		if (versionOutput.split(/\r?\n/).at(-1)?.trim() !== packageJson.version) {
			fail(`native launcher version mismatch for ${launcher.command}: ${versionOutput}`);
		}
		const helpOutput = runCapture(
			launcher.command,
			[...launcher.prefix, "--help"],
			{ cwd: bundleRoot },
		);
		if (!helpOutput.trim()) {
			fail(`native launcher returned empty help: ${launcher.command}`);
		}
	}
}

async function packBundle(bundleRoot, target, outDir) {
	logStep("packing native bundle...");
	const archiveName = `${basename(bundleRoot)}.${target.bundleExtension}`;
	const archivePath = resolve(outDir, archiveName);
	rmSync(archivePath, { force: true });

	if (target.bundleExtension === "zip") {
		if (process.platform === "win32" && !commandExists("7z")) {
			fail("7z is required to create deterministic Windows release archives");
		}
		return createDeterministicZip(bundleRoot, archivePath);
	}

	return await createDeterministicTarGz(bundleRoot, archivePath);
}

export function finalizeNativeRuntimeWorkspace(appDir) {
	const appFeynmanDir = resolve(appDir, ".feynman");
	const workspaceDir = resolve(appFeynmanDir, "npm");
	const archivePath = resolve(appFeynmanDir, "runtime-workspace.tgz");
	const digestPath = resolve(appFeynmanDir, "runtime-workspace.sha256");
	const completionPath = getRuntimeWorkspaceCompletionPath(workspaceDir);

	if (!verifyFileSha256(archivePath, digestPath)) {
		throw new Error(
			"Native runtime finalization requires an authenticated runtime archive",
		);
	}
	const archiveCompletion = JSON.parse(readFileSync(completionPath, "utf8"));
	if (archiveCompletion.source !== "archive") {
		throw new Error(
			`Native runtime finalization will not bless ${archiveCompletion.source ?? "unknown"} completion state`,
		);
	}
	if (
		!runtimeWorkspaceCompletionMatches(workspaceDir, {
			archivePath,
			digestPath,
		})
	) {
		throw new Error(
			"Native runtime finalization requires a valid archive-backed completion",
		);
	}

	if (
		archiveCompletion.archiveTreeHash !==
		computeRuntimeArchiveTreeHash(archivePath)
	) {
		throw new Error(
			"Native runtime finalization detected an unverified archive tree",
		);
	}
	const runtimeTreeHash = computeRuntimeTreeHash(workspaceDir);
	if (archiveCompletion.runtimeTreeHash !== runtimeTreeHash) {
		throw new Error(
			"Native runtime finalization detected changes after archive verification",
		);
	}

	// Retain the authenticated archive and digest beside the extracted runtime.
	// Native launches normally accept the completed live workspace, while a
	// damaged manifest, lock, or payload can still be repaired offline from the
	// immutable release seed instead of trusting the damaged live tree.
}

async function main() {
	const target = detectTarget();
	const stagingRoot = mkdtempSync(join(tmpdir(), "feynman-native-"));
	const outDir = resolve(appRoot, "dist", "release");
	const bundleRoot = resolve(stagingRoot, `feynman-${packageJson.version}-${target.id}`);
	const appDir = resolve(bundleRoot, "app");

	try {
		mkdirSync(outDir, { recursive: true });
		mkdirSync(appDir, { recursive: true });

		ensureBundledWorkspace();
		copyPackageFiles(appDir);
		installAppDependencies(appDir, stagingRoot);

		const appFeynmanDir = resolve(appDir, ".feynman");
		logStep("extracting runtime workspace...");
		const runtimeArchivePath = resolve(appFeynmanDir, "runtime-workspace.tgz");
		const runtimeArchiveDigestPath = resolve(appFeynmanDir, "runtime-workspace.sha256");
		if (!verifyFileSha256(runtimeArchivePath, runtimeArchiveDigestPath)) {
			fail("runtime workspace archive failed its SHA-256 integrity check");
		}
		extractTarball(runtimeArchivePath, appFeynmanDir, "-xzf");
		logStep("patching embedded Pi runtime...");
		run(process.execPath, [resolve(appDir, "scripts", "patch-embedded-pi.mjs")], { cwd: appDir });
		installBundledNode(bundleRoot, target, stagingRoot);
		const nativeNodeExecutable = resolveBundledNodeExecutable(bundleRoot, target);
		run(
			nativeNodeExecutable,
			[
				resolve(appDir, "scripts", "verify-package-artifact.mjs"),
				appDir,
				"--pruned-native",
			],
			{ cwd: appDir },
		);
		run("npm", ["audit", "--omit=dev", "--no-fund"], { cwd: appDir });
		finalizeNativeRuntimeWorkspace(appDir);

		writeLauncher(bundleRoot, target);
		validateBundle(bundleRoot, target);

		const archivePath = await packBundle(bundleRoot, target, outDir);
		console.log(`[feynman] native bundle ready: ${archivePath}`);
	} finally {
		rmSync(stagingRoot, { recursive: true, force: true });
	}
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
	await main();
}
