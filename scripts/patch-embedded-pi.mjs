import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { delimiter, dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FEYNMAN_LOGO_HTML } from "../logo.mjs";
import { patchAlphaHubAskSource } from "./lib/alpha-hub-ask-patch.mjs";
import { patchAlphaHubAuthSource } from "./lib/alpha-hub-auth-patch.mjs";
import { patchAlphaHubSearchResultsSource, patchAlphaHubSearchSource } from "./lib/alpha-hub-search-patch.mjs";
import { patchMcpSdkPackageJsonSource } from "./lib/mcp-sdk-package-patch.mjs";
import { patchPiAgentCoreSource } from "./lib/pi-agent-core-patch.mjs";
import {
	assertPiRuntimeCorrectnessVersion,
	PI_RUNTIME_CORRECTNESS_REQUIRED_VERSION,
	patchPiAgentSessionSource,
	patchPiSessionManagerSource,
	patchPiTransformMessagesSource,
} from "./lib/pi-runtime-correctness-patch.mjs";
import { patchPiLlamaUsageSource } from "./lib/pi-llama-usage-patch.mjs";
import { patchPiExtensionLoaderSource } from "./lib/pi-extension-loader-patch.mjs";
import { resolveAdjacentNpmCommand } from "./lib/npm-command.mjs";
import { patchPiModelRegistrySource } from "./lib/pi-model-registry-patch.mjs";
import { patchPiUndiciProxyTree } from "./lib/pi-undici-proxy-patch.mjs";
import { patchPiBraceExpansionTree } from "./lib/pi-shrinkwrap-security-patch.mjs";
import {
	patchPiEditorSource,
	patchPiInteractiveThemeSource,
	patchPiInteractiveUpdateNoticeSource,
	patchPiTuiSource,
} from "./lib/pi-tui-patch.mjs";
import {
	runtimeManifestPackagesMatch,
	verifyFileSha256,
} from "./lib/runtime-workspace-integrity.mjs";
import { PI_WEB_ACCESS_PATCH_TARGETS, patchPiWebAccessSource } from "./lib/pi-web-access-patch.mjs";
import { PI_SUBAGENTS_PATCH_TARGETS, patchPiSubagentsSource, stripPiSubagentBuiltinModelSource } from "./lib/pi-subagents-patch.mjs";
import { PI_OTEL_PATCH_TARGETS, patchPiOtelSource } from "./lib/pi-otel-patch.mjs";
import { patchPiSessionSearchSource } from "./lib/pi-session-search-patch.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, "..");
const feynmanHome = resolve(process.env.FEYNMAN_HOME ?? homedir(), ".feynman");
const feynmanNpmPrefix = resolve(feynmanHome, "npm-global");
process.env.FEYNMAN_NPM_PREFIX = feynmanNpmPrefix;
process.env.NPM_CONFIG_PREFIX = feynmanNpmPrefix;
process.env.npm_config_prefix = feynmanNpmPrefix;
const appRequire = createRequire(resolve(appRoot, "package.json"));
const isGlobalInstall = process.env.npm_config_global === "true" || process.env.npm_config_location === "global";

function findPackageRoot(packageName) {
	const segments = packageName.split("/");
	let current = appRoot;
	while (current !== dirname(current)) {
		for (const candidate of [resolve(current, "node_modules", ...segments), resolve(current, ...segments)]) {
			if (existsSync(resolve(candidate, "package.json"))) {
				return candidate;
			}
		}
		current = dirname(current);
	}

	for (const spec of [`${packageName}/dist/index.js`, `${packageName}/dist/cli.js`, packageName]) {
		try {
			let current = dirname(appRequire.resolve(spec));
			while (current !== dirname(current)) {
				if (existsSync(resolve(current, "package.json"))) {
					return current;
				}
				current = dirname(current);
			}
		} catch {
			continue;
		}
	}
	return null;
}

function findPiPackageRoot(packageName) {
	return findPackageRoot(`@earendil-works/${packageName}`) ?? findPackageRoot(`@mariozechner/${packageName}`);
}

const piPackageRoot = findPiPackageRoot("pi-coding-agent");
const piAgentCoreRoot = findPiPackageRoot("pi-agent-core");
const piTuiRoot = findPiPackageRoot("pi-tui");
const piAiRoot = findPiPackageRoot("pi-ai");
const PI_SCOPES = ["@earendil-works", "@mariozechner"];

function resolveNestedPiFiles(parentRoot, nestedPackageName, ...segments) {
	if (!parentRoot) return [];
	return PI_SCOPES.map((scope) =>
		resolve(parentRoot, "node_modules", scope, nestedPackageName, ...segments)
	);
}

function resolveWorkspaceNestedPiFiles(workspaceRoot, nestedPackageName, ...segments) {
	return PI_SCOPES.flatMap((codingScope) =>
		resolveNestedPiFiles(
			resolve(workspaceRoot, codingScope, "pi-coding-agent"),
			nestedPackageName,
			...segments,
		)
	);
}

if (!piPackageRoot) {
	console.warn("[feynman] pi-coding-agent not found, skipping Pi patches");
}

const packageJsonPath = piPackageRoot ? resolve(piPackageRoot, "package.json") : null;
const cliPath = piPackageRoot ? resolve(piPackageRoot, "dist", "cli.js") : null;
const bunCliPath = piPackageRoot ? resolve(piPackageRoot, "dist", "bun", "cli.js") : null;
const interactiveModePath = piPackageRoot ? resolve(piPackageRoot, "dist", "modes", "interactive", "interactive-mode.js") : null;
const interactiveThemePath = piPackageRoot ? resolve(piPackageRoot, "dist", "modes", "interactive", "theme", "theme.js") : null;
const extensionLoaderPath = piPackageRoot ? resolve(piPackageRoot, "dist", "core", "extensions", "loader.js") : null;
const modelRegistryPath = piPackageRoot ? resolve(piPackageRoot, "dist", "core", "model-registry.js") : null;
const modelRuntimePath = piPackageRoot ? resolve(piPackageRoot, "dist", "core", "model-runtime.js") : null;
const agentSessionPath = piPackageRoot ? resolve(piPackageRoot, "dist", "core", "agent-session.js") : null;
const sessionManagerPath = piPackageRoot ? resolve(piPackageRoot, "dist", "core", "session-manager.js") : null;
const llamaProviderPath = piPackageRoot
	? resolve(piPackageRoot, "dist", "extensions", "llama", "provider.js")
	: null;
const transformMessagesPath = piAiRoot ? resolve(piAiRoot, "dist", "api", "transform-messages.js") : null;
const nestedTransformMessagesPaths = piPackageRoot
	? resolveNestedPiFiles(piPackageRoot, "pi-ai", "dist", "api", "transform-messages.js")
	: [];
const agentLoopPath = piAgentCoreRoot ? resolve(piAgentCoreRoot, "dist", "agent-loop.js") : null;
const nestedAgentLoopPaths = resolveNestedPiFiles(piPackageRoot, "pi-agent-core", "dist", "agent-loop.js");
const tuiPath = piTuiRoot ? resolve(piTuiRoot, "dist", "tui.js") : null;
const terminalPath = piTuiRoot ? resolve(piTuiRoot, "dist", "terminal.js") : null;
const editorPath = piTuiRoot ? resolve(piTuiRoot, "dist", "components", "editor.js") : null;
const nestedTuiPaths = resolveNestedPiFiles(piPackageRoot, "pi-tui", "dist", "tui.js");
const nestedEditorPaths = resolveNestedPiFiles(piPackageRoot, "pi-tui", "dist", "components", "editor.js");
const workspaceRoot = resolve(appRoot, ".feynman", "npm", "node_modules");
function resolveWorkspacePiFile(packageName, ...segments) {
	const candidates = [
		resolve(workspaceRoot, "@earendil-works", packageName, ...segments),
		resolve(workspaceRoot, "@mariozechner", packageName, ...segments),
	];
	return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}

const workspaceAgentLoopPath = resolveWorkspacePiFile("pi-agent-core", "dist", "agent-loop.js");
const workspaceNestedAgentLoopPaths = resolveWorkspaceNestedPiFiles(
	workspaceRoot,
	"pi-agent-core",
	"dist",
	"agent-loop.js",
);
const workspaceAgentSessionPath = resolveWorkspacePiFile("pi-coding-agent", "dist", "core", "agent-session.js");
const workspaceSessionManagerPath = resolveWorkspacePiFile("pi-coding-agent", "dist", "core", "session-manager.js");
const workspaceLlamaProviderPath = resolveWorkspacePiFile(
	"pi-coding-agent",
	"dist",
	"extensions",
	"llama",
	"provider.js",
);
const workspaceTransformMessagesPath = resolveWorkspacePiFile("pi-ai", "dist", "api", "transform-messages.js");
const workspaceNestedTransformMessagesPaths = resolveWorkspaceNestedPiFiles(
	workspaceRoot,
	"pi-ai",
	"dist",
	"api",
	"transform-messages.js",
);

function assertPiPackageVersion(packageRoot, surface) {
	if (!packageRoot || !existsSync(resolve(packageRoot, "package.json"))) return;
	const version = JSON.parse(readFileSync(resolve(packageRoot, "package.json"), "utf8")).version;
	assertPiRuntimeCorrectnessVersion(version, surface);
}

function shouldPatchPiRuntimeCorrectnessFile(entryPath) {
	let current = dirname(entryPath);
	while (current !== dirname(current)) {
		const manifestPath = resolve(current, "package.json");
		if (existsSync(manifestPath)) {
			const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
			if (
				typeof manifest.name === "string" &&
				(manifest.name.endsWith("/pi-coding-agent") || manifest.name.endsWith("/pi-ai"))
			) {
				return manifest.version === PI_RUNTIME_CORRECTNESS_REQUIRED_VERSION;
			}
		}
		current = dirname(current);
	}
	return false;
}

assertPiPackageVersion(piPackageRoot, "bundled pi-coding-agent");
assertPiPackageVersion(piAgentCoreRoot, "bundled pi-agent-core");
assertPiPackageVersion(piAiRoot, "bundled pi-ai");
assertPiPackageVersion(piTuiRoot, "bundled pi-tui");
for (const entryPath of nestedAgentLoopPaths) {
	assertPiPackageVersion(resolve(entryPath, "..", ".."), "bundled nested pi-agent-core");
}
for (const entryPath of nestedTransformMessagesPaths) {
	assertPiPackageVersion(resolve(entryPath, "..", "..", ".."), "bundled nested pi-ai");
}
for (const entryPath of nestedTuiPaths) {
	assertPiPackageVersion(resolve(entryPath, "..", ".."), "bundled nested pi-tui");
}
const workspaceTuiPath = resolveWorkspacePiFile("pi-tui", "dist", "tui.js");
const workspaceEditorPath = resolveWorkspacePiFile("pi-tui", "dist", "components", "editor.js");
const workspaceNestedTuiPaths = resolveWorkspaceNestedPiFiles(workspaceRoot, "pi-tui", "dist", "tui.js");
const workspaceNestedEditorPaths = workspaceNestedTuiPaths.map((entryPath) =>
	resolve(entryPath, "..", "components", "editor.js")
);
const workspaceInteractiveModePath = resolveWorkspacePiFile(
	"pi-coding-agent",
	"dist",
	"modes",
	"interactive",
	"interactive-mode.js",
);
const workspaceInteractiveThemePath = resolveWorkspacePiFile(
	"pi-coding-agent",
	"dist",
	"modes",
	"interactive",
	"theme",
	"theme.js",
);
const workspaceExtensionLoaderPath = resolveWorkspacePiFile(
	"pi-coding-agent",
	"dist",
	"core",
	"extensions",
	"loader.js",
);
const piSubagentsRoot = resolve(workspaceRoot, "pi-subagents");
const piOtelRoot = resolve(workspaceRoot, "pi-otel");
const sessionSearchIndexerPath = resolve(
	workspaceRoot,
	"@kaiserlich-dev",
	"pi-session-search",
	"extensions",
	"indexer.ts",
);
const piMemoryPath = resolve(workspaceRoot, "@samfp", "pi-memory", "src", "index.ts");
const settingsPath = resolve(appRoot, ".feynman", "settings.json");
const workspaceDir = resolve(appRoot, ".feynman", "npm");
const workspacePackageJsonPath = resolve(workspaceDir, "package.json");
const workspaceManifestPath = resolve(workspaceDir, ".runtime-manifest.json");
const workspaceArchivePath = resolve(appRoot, ".feynman", "runtime-workspace.tgz");
const workspaceArchiveDigestPath = resolve(appRoot, ".feynman", "runtime-workspace.sha256");
const workspaceNpmConfigPath = resolve(workspaceDir, ".npmrc");
const workspaceSetupLockDir = resolve(appRoot, ".feynman", ".workspace-setup.lock");
const globalNodeModulesRoot = resolve(feynmanNpmPrefix, "lib", "node_modules");
const PRUNE_VERSION = 8;
const WORKSPACE_SETUP_LOCK_STALE_MS = 300000;
const NATIVE_PACKAGE_SPECS = new Set([
	"@kaiserlich-dev/pi-session-search",
]);

function patchMcpSdkManifest(nodeModulesRoot) {
	const manifestPath = resolve(
		nodeModulesRoot,
		"@modelcontextprotocol",
		"sdk",
		"package.json",
	);
	if (!existsSync(manifestPath)) return;
	const source = readFileSync(manifestPath, "utf8");
	const patched = patchMcpSdkPackageJsonSource(source);
	if (patched !== source) {
		writeFileSync(manifestPath, patched, "utf8");
	}
}

function patchFilesIfPresent(entryPaths, patchSource) {
	for (const entryPath of entryPaths.filter(Boolean)) {
		if (!existsSync(entryPath)) continue;
		const source = readFileSync(entryPath, "utf8");
		const patched = patchSource(source);
		if (patched !== source) {
			writeFileSync(entryPath, patched, "utf8");
		}
	}
}
const FILTERED_INSTALL_OUTPUT_PATTERNS = [
	/npm warn deprecated node-domexception@1\.0\.0/i,
	/npm notice/i,
	/^(added|removed|changed) \d+ packages?( in .+)?$/i,
	/^\d+ packages are looking for funding$/i,
	/^run `npm fund` for details$/i,
];

function supportsNativePackageSources(version = process.versions.node) {
	const [major = "0"] = version.replace(/^v/, "").split(".");
	return (Number.parseInt(major, 10) || 0) <= 22;
}

function createInstallCommand(packageManager, packageSpecs) {
	switch (packageManager) {
		case "npm":
			return [
				"install",
				"--global=false",
				"--location=project",
				"--prefer-offline",
				"--no-audit",
				"--no-fund",
				"--legacy-peer-deps",
				"--loglevel",
				"error",
				...packageSpecs,
			];
		case "pnpm":
			return ["add", "--prefer-offline", "--reporter", "silent", ...packageSpecs];
		case "bun":
			return ["add", "--silent", ...packageSpecs];
		default:
			throw new Error(`Unsupported package manager: ${packageManager}`);
	}
}

let cachedPackageManager = undefined;

function resolvePackageManager() {
	if (cachedPackageManager !== undefined) return cachedPackageManager;

	const requested = process.env.FEYNMAN_PACKAGE_MANAGER?.trim();
	const candidates = requested ? [requested] : ["npm", "pnpm", "bun"];
	for (const candidate of candidates) {
		if (resolveExecutable(candidate)) {
			cachedPackageManager = candidate;
			return candidate;
		}
	}

	cachedPackageManager = null;
	return null;
}

function resolvePackageManagerInvocation(packageManager) {
	if (packageManager === "npm") {
		const adjacent = resolveAdjacentNpmCommand();
		if (adjacent) return adjacent;
	}
	const resolved = resolveExecutable(packageManager);
	if (!resolved) return null;
	// Windows cannot spawn .cmd/.bat shims without a shell (EINVAL).
	const needsShell = process.platform === "win32" && /\.(cmd|bat)$/i.test(resolved);
	return { command: resolved, args: [], shell: needsShell };
}

function installWorkspacePackages(packageSpecs) {
	const packageManager = resolvePackageManager();
	if (!packageManager) {
		process.stderr.write(
			"[feynman] no supported package manager found; install npm, pnpm, or bun, or set FEYNMAN_PACKAGE_MANAGER.\n",
		);
		return false;
	}

	const invocation = resolvePackageManagerInvocation(packageManager);
	if (!invocation) {
		process.stderr.write(`[feynman] could not resolve ${packageManager} executable for bundled package setup.\n`);
		return false;
	}
	const result = spawnSync(invocation.command, [...invocation.args, ...createInstallCommand(packageManager, packageSpecs)], {
		cwd: workspaceDir,
		shell: invocation.shell,
		stdio: ["ignore", "pipe", "pipe"],
		timeout: 300000,
		env: {
			...process.env,
			PATH: getPathWithCurrentNode(process.env.PATH),
			npm_config_userconfig: workspaceNpmConfigPath,
			NPM_CONFIG_USERCONFIG: workspaceNpmConfigPath,
		},
	});

	for (const stream of [result.stdout, result.stderr]) {
		if (!stream?.length) continue;
		for (const line of stream.toString().split(/\r?\n/)) {
			if (!line.trim()) continue;
			if (FILTERED_INSTALL_OUTPUT_PATTERNS.some((pattern) => pattern.test(line.trim()))) continue;
			process.stderr.write(`${line}\n`);
		}
	}

	if (result.status !== 0) {
		process.stderr.write(`[feynman] ${packageManager} failed while setting up bundled packages.\n`);
		return false;
	}

	return true;
}

function parsePackageName(spec) {
	const match = spec.match(/^(@?[^@]+(?:\/[^@]+)?)(?:@.+)?$/);
	return match?.[1] ?? spec;
}

function filterUnsupportedPackageSpecs(packageSpecs) {
	if (supportsNativePackageSources()) return packageSpecs;
	return packageSpecs.filter((spec) => !NATIVE_PACKAGE_SPECS.has(parsePackageName(spec)));
}

function workspaceMatchesRuntime(packageSpecs) {
	if (!existsSync(workspaceManifestPath)) return false;

	try {
		const manifest = JSON.parse(readFileSync(workspaceManifestPath, "utf8"));
		if (!Array.isArray(manifest.packageSpecs)) {
			return false;
		}
		const manifestPackageSpecs = filterUnsupportedPackageSpecs(manifest.packageSpecs);
		if (!runtimeManifestPackagesMatch(workspaceRoot, manifestPackageSpecs, packageSpecs)) {
			return false;
		}
		if (!supportsNativePackageSources()) {
			return true;
		}
		if (
			manifest.nodeAbi !== process.versions.modules ||
			manifest.platform !== process.platform ||
			manifest.arch !== process.arch ||
			manifest.pruneVersion !== PRUNE_VERSION
		) {
			return false;
		}

		return true;
	} catch {
		return false;
	}
}

function writeWorkspaceManifest(packageSpecs) {
	writeFileSync(
		workspaceManifestPath,
		JSON.stringify(
			{
				packageSpecs,
				generatedAt: new Date().toISOString(),
				nodeAbi: process.versions.modules,
				nodeVersion: process.version,
				platform: process.platform,
				arch: process.arch,
				pruneVersion: PRUNE_VERSION,
			},
			null,
			2,
		) + "\n",
		"utf8",
	);
}

function ensureParentDir(path) {
	mkdirSync(dirname(path), { recursive: true });
}

function packageDependencyExists(packagePath, globalNodeModulesRoot, dependency) {
	return existsSync(resolve(packagePath, "node_modules", dependency)) ||
		existsSync(resolve(globalNodeModulesRoot, dependency));
}

function installedPackageLooksUsable(packagePath, globalNodeModulesRoot) {
	if (!existsSync(resolve(packagePath, "package.json"))) return false;
	try {
		const pkg = JSON.parse(readFileSync(resolve(packagePath, "package.json"), "utf8"));
		return Object.keys(pkg.dependencies ?? {}).every((dependency) =>
			packageDependencyExists(packagePath, globalNodeModulesRoot, dependency)
		);
	} catch {
		return false;
	}
}

function linkPointsTo(linkPath, targetPath) {
	try {
		if (!lstatSync(linkPath).isSymbolicLink()) return false;
		return resolve(dirname(linkPath), readlinkSync(linkPath)) === targetPath;
	} catch {
		return false;
	}
}

function pathInsideRoot(path, root) {
	const relativePath = relative(root, path);
	return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function listWorkspacePackageNames(root) {
	if (!existsSync(root)) return [];
	const names = [];
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
		if (entry.name.startsWith(".")) continue;
		if (entry.name.startsWith("@")) {
			const scopeRoot = resolve(root, entry.name);
			for (const scopedEntry of readdirSync(scopeRoot, { withFileTypes: true })) {
				if (!scopedEntry.isDirectory() && !scopedEntry.isSymbolicLink()) continue;
				names.push(`${entry.name}/${scopedEntry.name}`);
			}
			continue;
		}
		names.push(entry.name);
	}
	return names;
}

function removeEmptyScopeDirectory(packagePath, packageName) {
	if (!packageName.startsWith("@")) return;

	const scopePath = dirname(packagePath);
	if (!pathInsideRoot(scopePath, globalNodeModulesRoot) || !existsSync(scopePath)) return;
	if (readdirSync(scopePath).length > 0) return;

	rmSync(scopePath, { recursive: true, force: true });
}

function pruneStaleBundledPackageLinks(currentPackageNames) {
	if (!existsSync(globalNodeModulesRoot)) return;

	const currentPackages = new Set(currentPackageNames);
	for (const packageName of listWorkspacePackageNames(globalNodeModulesRoot)) {
		const packagePath = resolve(globalNodeModulesRoot, packageName);
		let linkedTarget;
		try {
			if (!lstatSync(packagePath).isSymbolicLink()) continue;
			linkedTarget = resolve(dirname(packagePath), readlinkSync(packagePath));
		} catch {
			continue;
		}
		if (!pathInsideRoot(linkedTarget, workspaceRoot)) continue;
		if (currentPackages.has(packageName) && existsSync(linkedTarget)) continue;

		rmSync(packagePath, { force: true });
		removeEmptyScopeDirectory(packagePath, packageName);
	}
}

function linkBundledPackage(packageName) {
	const sourcePath = resolve(workspaceRoot, packageName);
	const targetPath = resolve(globalNodeModulesRoot, packageName);
	if (!existsSync(sourcePath)) return false;
	if (linkPointsTo(targetPath, sourcePath)) return false;
	try {
		if (lstatSync(targetPath).isSymbolicLink()) {
			rmSync(targetPath, { force: true });
		} else if (!installedPackageLooksUsable(targetPath, globalNodeModulesRoot)) {
			rmSync(targetPath, { recursive: true, force: true });
		}
	} catch {}
	if (existsSync(targetPath)) return false;

	ensureParentDir(targetPath);
	try {
		symlinkSync(sourcePath, targetPath, process.platform === "win32" ? "junction" : "dir");
		return true;
	} catch {
		return false;
	}
}

function ensureBundledPackageLinks(packageSpecs) {
	if (!workspaceMatchesRuntime(packageSpecs)) return;

	const packageNames = listWorkspacePackageNames(workspaceRoot);
	pruneStaleBundledPackageLinks(packageNames);
	for (const packageName of packageNames) {
		linkBundledPackage(packageName);
	}
}

function restorePackagedWorkspace(packageSpecs) {
	if (!existsSync(workspaceArchivePath)) return false;
	if (!verifyFileSha256(workspaceArchivePath, workspaceArchiveDigestPath)) {
		throw new Error("Bundled runtime archive failed its SHA-256 integrity check");
	}

	rmSync(workspaceDir, { recursive: true, force: true });
	mkdirSync(resolve(appRoot, ".feynman"), { recursive: true });

	// Run tar from .feynman with relative paths: GNU tar (Git for Windows)
	// treats absolute paths with a drive-letter colon ("C:\...") as remote
	// host specs and fails with "Cannot connect ... resolve failed".
	const result = spawnSync("tar", ["-xzf", "runtime-workspace.tgz", "-C", "."], {
		cwd: resolve(appRoot, ".feynman"),
		stdio: ["ignore", "ignore", "pipe"],
		timeout: 300000,
	});

	// On Windows, tar may exit non-zero due to symlink creation failures in
	// .bin/ directories. These are non-fatal — check whether the actual
	// package directories were extracted successfully.
	const packagesPresent = packageSpecs.every((spec) => existsSync(resolve(workspaceRoot, parsePackageName(spec))));
	if (packagesPresent) return true;

	if (result.status !== 0) {
		if (result.stderr?.length) process.stderr.write(result.stderr);
		return false;
	}

	return false;
}

function resolveExecutable(name, fallbackPaths = []) {
	for (const candidate of fallbackPaths) {
		if (existsSync(candidate)) return candidate;
	}

	const isWindows = process.platform === "win32";
	const env = {
		...process.env,
		PATH: process.env.PATH ?? "",
	};
	const result = isWindows
		? spawnSync("cmd", ["/c", `where ${name}`], {
				encoding: "utf8",
				stdio: ["ignore", "pipe", "ignore"],
				env,
			})
		: spawnSync("sh", ["-c", `command -v ${name}`], {
				encoding: "utf8",
				stdio: ["ignore", "pipe", "ignore"],
				env,
			});
	if (result.status === 0) {
		const resolved = result.stdout.trim().split(/\r?\n/)[0];
		if (resolved) return resolved;
	}
	return null;
}

function getPathWithCurrentNode(pathValue = process.env.PATH ?? "") {
	const nodeDir = dirname(process.execPath);
	const parts = pathValue.split(delimiter).filter(Boolean);
	return parts.includes(nodeDir) ? pathValue : `${nodeDir}${delimiter}${pathValue}`;
}

function sleepSync(ms) {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function acquireWorkspaceSetupLock() {
	mkdirSync(dirname(workspaceSetupLockDir), { recursive: true });
	const startedAt = Date.now();

	while (true) {
		try {
			mkdirSync(workspaceSetupLockDir);
			writeFileSync(resolve(workspaceSetupLockDir, "owner"), `${process.pid}\n${new Date().toISOString()}\n`, "utf8");
			return;
		} catch (error) {
			if (error?.code !== "EEXIST") throw error;
			try {
				if (Date.now() - statSync(workspaceSetupLockDir).mtimeMs > WORKSPACE_SETUP_LOCK_STALE_MS) {
					rmSync(workspaceSetupLockDir, { recursive: true, force: true });
					continue;
				}
			} catch {}
			if (Date.now() - startedAt > WORKSPACE_SETUP_LOCK_STALE_MS) {
				throw new Error("Timed out waiting for another Feynman process to finish package setup.");
			}
			sleepSync(100);
		}
	}
}

function releaseWorkspaceSetupLock() {
	rmSync(workspaceSetupLockDir, { recursive: true, force: true });
}

function ensurePackageWorkspace() {
	if (!existsSync(settingsPath)) return;
	acquireWorkspaceSetupLock();
	try {
		ensurePackageWorkspaceUnlocked();
	} finally {
		releaseWorkspaceSetupLock();
	}
}

function ensurePackageWorkspaceUnlocked() {
	const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
	const packageSpecs = Array.isArray(settings.packages)
		? settings.packages
				.filter((v) => typeof v === "string" && v.startsWith("npm:"))
				.map((v) => v.slice(4))
		: [];
	const supportedPackageSpecs = filterUnsupportedPackageSpecs(packageSpecs);

	if (supportedPackageSpecs.length === 0) return;
	if (workspaceMatchesRuntime(supportedPackageSpecs)) {
		ensureBundledPackageLinks(supportedPackageSpecs);
		return;
	}
	if (restorePackagedWorkspace(packageSpecs) && workspaceMatchesRuntime(supportedPackageSpecs)) {
		ensureBundledPackageLinks(supportedPackageSpecs);
		return;
	}

	mkdirSync(workspaceDir, { recursive: true });
	writeFileSync(
		workspacePackageJsonPath,
		JSON.stringify({ name: "feynman-packages", private: true }, null, 2) + "\n",
		"utf8",
	);

	const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
	let frame = 0;
	const start = Date.now();
	const spinner = setInterval(() => {
		const elapsed = Math.round((Date.now() - start) / 1000);
		process.stderr.write(`\r${frames[frame++ % frames.length]} setting up feynman... ${elapsed}s`);
	}, 80);

	const result = installWorkspacePackages(supportedPackageSpecs);

	clearInterval(spinner);
	const elapsed = Math.round((Date.now() - start) / 1000);

	if (!result) {
		process.stderr.write(`\r✗ setup failed (${elapsed}s)\n`);
	} else {
		process.stderr.write("\r\x1b[2K");
		writeWorkspaceManifest(supportedPackageSpecs);
		ensureBundledPackageLinks(supportedPackageSpecs);
	}
}

ensurePackageWorkspace();

function ensurePandoc() {
	if (!isGlobalInstall) return;
	if (process.platform !== "darwin") return;
	if (process.env.FEYNMAN_SKIP_PANDOC_INSTALL === "1") return;
	if (resolveExecutable("pandoc", ["/opt/homebrew/bin/pandoc", "/usr/local/bin/pandoc"])) return;

	const brewPath = resolveExecutable("brew", ["/opt/homebrew/bin/brew", "/usr/local/bin/brew"]);
	if (!brewPath) return;

	console.log("[feynman] installing pandoc...");
	const result = spawnSync(brewPath, ["install", "pandoc"], {
		stdio: "inherit",
		timeout: 300000,
	});
	if (result.status !== 0) {
		console.warn("[feynman] warning: pandoc install failed, run `feynman --setup-preview` later");
	}
}

ensurePandoc();

const globalPiSubagentsRoot = resolve(globalNodeModulesRoot, "pi-subagents");
const agentNpmPiSubagentsRoot = resolve(feynmanHome, "agent", "npm", "node_modules", "pi-subagents");
for (const subagentsRoot of new Set(
	[piSubagentsRoot, globalPiSubagentsRoot, agentNpmPiSubagentsRoot]
		.filter((root) => existsSync(root))
		.map((root) => {
			try {
				return realpathSync(root);
			} catch {
				return root;
			}
		}),
)) {
	for (const relativePath of PI_SUBAGENTS_PATCH_TARGETS) {
		const entryPath = resolve(subagentsRoot, relativePath);
		if (!existsSync(entryPath)) continue;

		const source = readFileSync(entryPath, "utf8");
		const patched = patchPiSubagentsSource(relativePath, source);
		if (patched !== source) {
			writeFileSync(entryPath, patched, "utf8");
		}
	}

	const builtinAgentsRoot = resolve(piSubagentsRoot, "agents");
	if (existsSync(builtinAgentsRoot)) {
		for (const entry of readdirSync(builtinAgentsRoot, { withFileTypes: true })) {
			if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
			const entryPath = resolve(builtinAgentsRoot, entry.name);
			const source = readFileSync(entryPath, "utf8");
			const patched = stripPiSubagentBuiltinModelSource(source);
			if (patched !== source) {
				writeFileSync(entryPath, patched, "utf8");
			}
		}
	}
}

const globalPiOtelRoot = resolve(globalNodeModulesRoot, "pi-otel");
const agentNpmPiOtelRoot = resolve(feynmanHome, "agent", "npm", "node_modules", "pi-otel");
for (const otelRoot of new Set(
	[piOtelRoot, globalPiOtelRoot, agentNpmPiOtelRoot]
		.filter((root) => existsSync(root))
		.map((root) => {
			try {
				return realpathSync(root);
			} catch {
				return root;
			}
		}),
)) {
	for (const relativePath of PI_OTEL_PATCH_TARGETS) {
		const entryPath = resolve(otelRoot, relativePath);
		if (!existsSync(entryPath)) continue;
		const source = readFileSync(entryPath, "utf8");
		const patched = patchPiOtelSource(relativePath, source);
		if (patched !== source) {
			writeFileSync(entryPath, patched, "utf8");
		}
	}
}

if (packageJsonPath && existsSync(packageJsonPath)) {
	const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8"));
	if (pkg.piConfig?.name !== "feynman" || pkg.piConfig?.configDir !== ".feynman") {
		pkg.piConfig = {
			...(pkg.piConfig || {}),
			name: "feynman",
			configDir: ".feynman",
		};
		writeFileSync(packageJsonPath, JSON.stringify(pkg, null, "\t") + "\n", "utf8");
	}
}

for (const entryPath of [cliPath, bunCliPath].filter(Boolean)) {
	if (!existsSync(entryPath)) {
		continue;
	}

	let cliSource = readFileSync(entryPath, "utf8");
	if (cliSource.includes('process.title = "pi";')) {
		cliSource = cliSource.replace('process.title = "pi";', 'process.title = "feynman";');
	}
	const stdinErrorGuard = [
		"const feynmanHandleStdinError = (error) => {",
		'    if (error && typeof error === "object") {',
		'        const code = "code" in error ? error.code : undefined;',
		'        const syscall = "syscall" in error ? error.syscall : undefined;',
		'        if ((code === "EIO" || code === "EBADF") && syscall === "read") {',
		"            return;",
		"        }",
		"    }",
		"};",
		'process.stdin?.on?.("error", feynmanHandleStdinError);',
	].join("\n");
	if (!cliSource.includes('process.stdin?.on?.("error", feynmanHandleStdinError);')) {
		cliSource = cliSource.replace(
			'process.emitWarning = (() => { });',
			`process.emitWarning = (() => { });\n${stdinErrorGuard}`,
		);
	}
	writeFileSync(entryPath, cliSource, "utf8");
}

if (terminalPath && existsSync(terminalPath)) {
	let terminalSource = readFileSync(terminalPath, "utf8");
	if (!terminalSource.includes("stdinErrorHandler = (error) =>")) {
		terminalSource = terminalSource.replace(
			"    stdinBuffer;\n    stdinDataHandler;\n",
			[
				"    stdinBuffer;",
				"    stdinDataHandler;",
				"    stdinErrorHandler = (error) => {",
				'        if ((error?.code === "EIO" || error?.code === "EBADF") && error?.syscall === "read") {',
				"            return;",
				"        }",
				"    };",
			].join("\n") + "\n",
		);
	}
	if (!terminalSource.includes('process.stdin.on("error", this.stdinErrorHandler);')) {
		terminalSource = terminalSource.replace(
			'        process.stdin.resume();\n',
			'        process.stdin.resume();\n        process.stdin.on("error", this.stdinErrorHandler);\n',
		);
	}
	if (!terminalSource.includes('            process.stdin.removeListener("error", this.stdinErrorHandler);')) {
		terminalSource = terminalSource.replace(
			'            process.stdin.removeListener("data", onData);\n            this.inputHandler = previousHandler;\n',
			[
				'            process.stdin.removeListener("data", onData);',
				'            process.stdin.removeListener("error", this.stdinErrorHandler);',
				'            this.inputHandler = previousHandler;',
			].join("\n"),
		);
		terminalSource = terminalSource.replace(
			'        process.stdin.pause();\n',
			'        process.stdin.removeListener("error", this.stdinErrorHandler);\n        process.stdin.pause();\n',
		);
	}
	writeFileSync(terminalPath, terminalSource, "utf8");
}

if (interactiveModePath && existsSync(interactiveModePath)) {
	const interactiveModeSource = readFileSync(interactiveModePath, "utf8");
	if (interactiveModeSource.includes("`π - ${sessionName} - ${cwdBasename}`")) {
		writeFileSync(
			interactiveModePath,
			interactiveModeSource
				.replace("`π - ${sessionName} - ${cwdBasename}`", "`feynman - ${sessionName} - ${cwdBasename}`")
				.replace("`π - ${cwdBasename}`", "`feynman - ${cwdBasename}`"),
			"utf8",
		);
	}
}

for (const loaderPath of [extensionLoaderPath, workspaceExtensionLoaderPath].filter(Boolean)) {
	if (!existsSync(loaderPath)) {
		continue;
	}

	const source = readFileSync(loaderPath, "utf8");
	const patched = patchPiExtensionLoaderSource(source);
	if (patched !== source) {
		writeFileSync(loaderPath, patched, "utf8");
	}
}


const workspaceModelRegistryPath = resolveWorkspacePiFile("pi-coding-agent", "dist", "core", "model-registry.js");
const workspaceModelRuntimePath = resolveWorkspacePiFile("pi-coding-agent", "dist", "core", "model-runtime.js");
for (const entryPath of [modelRegistryPath, modelRuntimePath, workspaceModelRegistryPath, workspaceModelRuntimePath].filter(Boolean)) {
	if (!existsSync(entryPath)) continue;
	const source = readFileSync(entryPath, "utf8");
	const patched = patchPiModelRegistrySource(source);
	if (patched !== source) {
		writeFileSync(entryPath, patched, "utf8");
	}
}

const safeBraceExpansionPath = resolve(appRoot, "node_modules", "brace-expansion");
patchPiBraceExpansionTree(resolve(appRoot, "node_modules"), safeBraceExpansionPath);
patchPiBraceExpansionTree(workspaceRoot, safeBraceExpansionPath);
const feynmanUndiciPath = resolve(appRoot, "node_modules", "undici");
patchPiUndiciProxyTree(
	resolve(appRoot, "node_modules"),
	feynmanUndiciPath,
	PI_RUNTIME_CORRECTNESS_REQUIRED_VERSION,
);
patchPiUndiciProxyTree(
	workspaceRoot,
	feynmanUndiciPath,
	PI_RUNTIME_CORRECTNESS_REQUIRED_VERSION,
);
for (const nodeModulesRoot of [
	resolve(appRoot, "node_modules"),
	resolve(appRoot, "node_modules", "@companion-ai", "alpha-hub", "node_modules"),
	workspaceRoot,
	resolve(workspaceRoot, "@companion-ai", "alpha-hub", "node_modules"),
]) {
	patchMcpSdkManifest(nodeModulesRoot);
}

for (const [entryPath, patchSource] of [
	[agentSessionPath, patchPiAgentSessionSource],
	[workspaceAgentSessionPath, patchPiAgentSessionSource],
	[sessionManagerPath, patchPiSessionManagerSource],
	[workspaceSessionManagerPath, patchPiSessionManagerSource],
	[transformMessagesPath, patchPiTransformMessagesSource],
	[workspaceTransformMessagesPath, patchPiTransformMessagesSource],
	...nestedTransformMessagesPaths.map((entryPath) => [entryPath, patchPiTransformMessagesSource]),
	...workspaceNestedTransformMessagesPaths.map((entryPath) => [entryPath, patchPiTransformMessagesSource]),
]) {
	if (
		!entryPath ||
		!existsSync(entryPath) ||
		!shouldPatchPiRuntimeCorrectnessFile(entryPath)
	) continue;
	const source = readFileSync(entryPath, "utf8");
	const patched = patchSource(source);
	if (patched !== source) {
		writeFileSync(entryPath, patched, "utf8");
	}
}

patchFilesIfPresent([
	agentLoopPath,
	...nestedAgentLoopPaths,
	workspaceAgentLoopPath,
	...workspaceNestedAgentLoopPaths,
], patchPiAgentCoreSource);

for (const entryPath of [llamaProviderPath, workspaceLlamaProviderPath].filter(Boolean)) {
	if (!existsSync(entryPath) || !shouldPatchPiRuntimeCorrectnessFile(entryPath)) {
		continue;
	}
	const source = readFileSync(entryPath, "utf8");
	const patched = patchPiLlamaUsageSource(source);
	if (patched !== source) {
		writeFileSync(entryPath, patched, "utf8");
	}
}

patchFilesIfPresent([
	tuiPath,
	...nestedTuiPaths,
	workspaceTuiPath,
	...workspaceNestedTuiPaths,
], patchPiTuiSource);

patchFilesIfPresent(
	[interactiveThemePath, workspaceInteractiveThemePath],
	patchPiInteractiveThemeSource,
);

patchFilesIfPresent(
	[interactiveModePath, workspaceInteractiveModePath],
	patchPiInteractiveUpdateNoticeSource,
);

patchFilesIfPresent([
	editorPath,
	...nestedEditorPaths,
	workspaceEditorPath,
	...workspaceNestedEditorPaths,
], patchPiEditorSource);

const piWebAccessRoot = resolve(workspaceRoot, "pi-web-access");

if (existsSync(piWebAccessRoot)) {
	for (const relativePath of PI_WEB_ACCESS_PATCH_TARGETS) {
		const entryPath = resolve(piWebAccessRoot, relativePath);
		if (!existsSync(entryPath)) continue;

		const source = readFileSync(entryPath, "utf8");
		const patched = patchPiWebAccessSource(relativePath, source);
		if (patched !== source) {
			writeFileSync(entryPath, patched, "utf8");
		}
	}
}

if (existsSync(sessionSearchIndexerPath)) {
	const source = readFileSync(sessionSearchIndexerPath, "utf8");
	const patched = patchPiSessionSearchSource("extensions/indexer.ts", source);
	if (patched !== source) {
		writeFileSync(sessionSearchIndexerPath, patched, "utf8");
	}
}

const oauthPagePath = piAiRoot ? resolve(piAiRoot, "dist", "utils", "oauth", "oauth-page.js") : null;

if (oauthPagePath && existsSync(oauthPagePath)) {
	let source = readFileSync(oauthPagePath, "utf8");
	let changed = false;
	const target = `const LOGO_SVG = \`${FEYNMAN_LOGO_HTML}\`;`;
	if (!source.includes(target)) {
		source = source.replace(/const LOGO_SVG = `[^`]*`;/, target);
		changed = true;
	}
	if (changed) writeFileSync(oauthPagePath, source, "utf8");
}

const alphaHubAuthPath = findPackageRoot("@companion-ai/alpha-hub")
	? resolve(findPackageRoot("@companion-ai/alpha-hub"), "src", "lib", "auth.js")
	: null;
const alphaHubSearchPath = findPackageRoot("@companion-ai/alpha-hub")
	? resolve(findPackageRoot("@companion-ai/alpha-hub"), "src", "lib", "alphaxiv.js")
	: null;
const alphaHubIndexPath = findPackageRoot("@companion-ai/alpha-hub")
	? resolve(findPackageRoot("@companion-ai/alpha-hub"), "src", "lib", "index.js")
	: null;

if (alphaHubAuthPath && existsSync(alphaHubAuthPath)) {
	const source = readFileSync(alphaHubAuthPath, "utf8");
	const patched = patchAlphaHubAuthSource(source);
	if (patched !== source) {
		writeFileSync(alphaHubAuthPath, patched, "utf8");
	}
}
if (alphaHubSearchPath && existsSync(alphaHubSearchPath)) {
	const source = readFileSync(alphaHubSearchPath, "utf8");
	const patched = patchAlphaHubAskSource(patchAlphaHubSearchSource(source));
	if (patched !== source) {
		writeFileSync(alphaHubSearchPath, patched, "utf8");
	}
}
if (alphaHubIndexPath && existsSync(alphaHubIndexPath)) {
	const source = readFileSync(alphaHubIndexPath, "utf8");
	const patched = patchAlphaHubSearchResultsSource(source);
	if (patched !== source) {
		writeFileSync(alphaHubIndexPath, patched, "utf8");
	}
}

// The bundled workspace carries its own alpha-hub copy; patch it the same way
// so search fixes apply regardless of which copy resolves at runtime.
const workspaceAlphaHubLib = resolve(workspaceRoot, "@companion-ai", "alpha-hub", "src", "lib");
for (const [fileName, patchFn] of [
	["auth.js", patchAlphaHubAuthSource],
	["alphaxiv.js", (source) => patchAlphaHubAskSource(patchAlphaHubSearchSource(source))],
	["index.js", patchAlphaHubSearchResultsSource],
]) {
	const filePath = resolve(workspaceAlphaHubLib, fileName);
	if (!existsSync(filePath)) continue;
	const source = readFileSync(filePath, "utf8");
	const patched = patchFn(source);
	if (patched !== source) {
		writeFileSync(filePath, patched, "utf8");
	}
}

if (existsSync(piMemoryPath)) {
	let source = readFileSync(piMemoryPath, "utf8");
	const memoryOriginal = 'const MEMORY_DIR = join(homedir(), ".pi", "memory");';
	const memoryReplacement =
		'const MEMORY_DIR = process.env.FEYNMAN_MEMORY_DIR ?? process.env.PI_MEMORY_DIR ?? join(homedir(), ".pi", "memory");';
	if (source.includes(memoryOriginal)) {
		source = source.replace(memoryOriginal, memoryReplacement);
	}
	const execOriginal = 'const result = await pi.exec("pi", ["-p", prompt, "--print"], {';
	const execReplacement = [
		'const execBinary = process.env.FEYNMAN_NODE_EXECUTABLE || process.env.FEYNMAN_EXECUTABLE || "pi";',
		'      const execArgs = process.env.FEYNMAN_BIN_PATH',
		'        ? [process.env.FEYNMAN_BIN_PATH, "--prompt", prompt]',
		'        : ["-p", prompt, "--print"];',
		'      const result = await pi.exec(execBinary, execArgs, {',
	].join("\n");
	if (source.includes(execOriginal)) {
		source = source.replace(execOriginal, execReplacement);
	}
	writeFileSync(piMemoryPath, source, "utf8");
}
