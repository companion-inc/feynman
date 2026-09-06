import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FEYNMAN_LOGO_HTML } from "../logo.mjs";
import { patchAlphaHubAuthSource } from "./lib/alpha-hub-auth-patch.mjs";
import { patchAlphaHubSearchResultsSource, patchAlphaHubSearchSource } from "./lib/alpha-hub-search-patch.mjs";
import { patchMcpSdkPackageJsonSource } from "./lib/mcp-sdk-package-patch.mjs";
import { applyPackageRootPatchPlans, preflightPackageRootPatch, uniqueExistingPackageRoots } from "./lib/package-root-patch-utils.mjs";
import { patchPiAgentCoreSource } from "./lib/pi-agent-core-patch.mjs";
import {
	ensureLegacyPiRuntimeAliases,
	patchPiCliArgsSource,
	preflightPiCliArgsPackageRoot,
} from "./lib/pi-cli-args-patch.mjs";
import {
	assertPiEditLineEndingsVersion,
	PI_EDIT_LINE_ENDINGS_PATCH_TARGETS,
	patchPiEditLineEndingsSource,
} from "./lib/pi-edit-line-endings-patch.mjs";
import { patchPiDocparserRuntimeRoots } from "./lib/pi-docparser-runtime-patch.mjs";
import { PI_AI_FORWARD_FIX_TARGETS, patchPiAiForwardFixSource } from "./lib/pi-ai-forward-fixes-patch.mjs";
import { PI_COMPACTION_TOOLS_PATCH_TARGETS, patchPiCompactionToolsSource } from "./lib/pi-compaction-tools-patch.mjs";
import {
	assertPiRuntimeCorrectnessVersion,
	PI_CODING_AGENT_FORWARD_FIX_TARGETS,
	PI_RUNTIME_CORRECTNESS_REQUIRED_VERSION,
	patchPiCodingAgentForwardFixSource,
	patchPiAgentSessionSource,
	patchPiGithubCopilotDeviceCodeSource,
	patchPiGithubCopilotOAuthSource,
	patchPiSessionManagerSource,
	patchPiTransformMessagesSource,
} from "./lib/pi-runtime-correctness-patch.mjs";
import { patchPiLlamaUsageSource } from "./lib/pi-llama-usage-patch.mjs";
import { patchPiExtensionHandlerTimeoutPackageRoot } from "./lib/pi-extension-handler-timeout-patch.mjs";
import { patchPiExtensionLoaderSource } from "./lib/pi-extension-loader-patch.mjs";
import { patchPiModelRegistrySource } from "./lib/pi-model-registry-patch.mjs";
import { PI_BTW_MODEL_RUNTIME_PATCH_TARGETS, PI_BTW_MODEL_RUNTIME_REQUIRED_VERSION, patchPiBtwModelRuntimeSource } from "./lib/pi-btw-model-runtime-patch.mjs";
import { patchPiStateFilePermissionsSource } from "./lib/pi-state-file-permissions-patch.mjs";
import { patchPiUndiciProxyTree } from "./lib/pi-undici-proxy-patch.mjs";
import { patchPiEsbuildPackageTree } from "./lib/pi-esbuild-package-patch.mjs";
import { patchPiBraceExpansionTree } from "./lib/pi-shrinkwrap-security-patch.mjs";
import {
	patchPiEditorSource,
	patchPiInteractiveThemeSource,
	patchPiInteractiveUpdateNoticeSource,
	patchPiTuiSource,
} from "./lib/pi-tui-patch.mjs";
import { computeRuntimeTreeHash } from "./lib/runtime-workspace-integrity.mjs";
import {
	buildSourceRuntimeArchive,
	installRuntimeWorkspaceFromPackageLock,
	patchStagedRuntimeWorkspace,
} from "./lib/runtime-workspace-install.mjs";
import {
	acquireRuntimeWorkspaceSetupLock,
	heartbeatRuntimeWorkspaceSetupLock,
	prepareRuntimeWorkspaceFallback,
	reconcileRuntimeWorkspaceRestoreArtifacts,
	replaceRuntimeWorkspaceTransactionally,
	releaseRuntimeWorkspaceSetupLock,
	restoreRuntimeWorkspaceFromArchiveWithSeed,
	runtimeWorkspaceCompletionMatches,
	runtimeWorkspaceMatches,
	writeRuntimeWorkspaceCompletion,
} from "./lib/runtime-workspace-restore.mjs";
import {
	assertPiWebAccessVersion,
	PI_WEB_ACCESS_PATCH_TARGETS,
	patchPiWebAccessSources,
	syncPiWebAccessForwardFiles,
} from "./lib/pi-web-access-patch.mjs";
import { PI_SUBAGENTS_PATCH_TARGETS, patchPiSubagentsSource, stripPiSubagentBuiltinModelSource } from "./lib/pi-subagents-patch.mjs";
import { preflightPiOtelPackageRoot } from "./lib/pi-otel-patch.mjs";
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
const authStoragePath = piPackageRoot ? resolve(piPackageRoot, "dist", "core", "auth-storage.js") : null;
const modelRegistryPath = piPackageRoot ? resolve(piPackageRoot, "dist", "core", "model-registry.js") : null;
const modelRuntimePath = piPackageRoot ? resolve(piPackageRoot, "dist", "core", "model-runtime.js") : null;
const agentSessionPath = piPackageRoot ? resolve(piPackageRoot, "dist", "core", "agent-session.js") : null;
const sessionManagerPath = piPackageRoot ? resolve(piPackageRoot, "dist", "core", "session-manager.js") : null;
const llamaProviderPath = piPackageRoot
	? resolve(piPackageRoot, "dist", "extensions", "llama", "provider.js")
	: null;
const agentLoopPath = piAgentCoreRoot ? resolve(piAgentCoreRoot, "dist", "agent-loop.js") : null;
const nestedAgentLoopPaths = resolveNestedPiFiles(piPackageRoot, "pi-agent-core", "dist", "agent-loop.js");
const tuiPath = piTuiRoot ? resolve(piTuiRoot, "dist", "tui.js") : null;
const tuiMainScreenPath = piTuiRoot ? resolve(piTuiRoot, "dist", "tui-main-screen.js") : null;
const terminalPath = piTuiRoot ? resolve(piTuiRoot, "dist", "terminal.js") : null;
const editorPath = piTuiRoot ? resolve(piTuiRoot, "dist", "components", "editor.js") : null;
const nestedTuiPaths = resolveNestedPiFiles(piPackageRoot, "pi-tui", "dist", "tui.js");
const nestedTuiMainScreenPaths = resolveNestedPiFiles(piPackageRoot, "pi-tui", "dist", "tui-main-screen.js");
const nestedEditorPaths = resolveNestedPiFiles(piPackageRoot, "pi-tui", "dist", "components", "editor.js");
const workspaceRoot = resolve(appRoot, ".feynman", "npm", "node_modules");
function resolveWorkspacePiFile(packageName, ...segments) {
	const candidates = [
		resolve(workspaceRoot, "@earendil-works", packageName, ...segments),
		resolve(workspaceRoot, "@mariozechner", packageName, ...segments),
	];
	return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}
const workspacePiPackageRoot = dirname(
	resolveWorkspacePiFile("pi-coding-agent", "package.json"),
);

function resolvePiAiRuntimeFiles(...segments) {
	return [
		piAiRoot ? resolve(piAiRoot, ...segments) : null,
		...resolveNestedPiFiles(piPackageRoot, "pi-ai", ...segments),
		resolveWorkspacePiFile("pi-ai", ...segments),
		...resolveWorkspaceNestedPiFiles(workspaceRoot, "pi-ai", ...segments),
	].filter(Boolean);
}

const transformMessagesPaths = resolvePiAiRuntimeFiles("dist", "api", "transform-messages.js");
const githubCopilotDeviceCodePaths = resolvePiAiRuntimeFiles(
	"dist",
	"auth",
	"oauth",
	"device-code.js",
);
const githubCopilotOAuthPaths = resolvePiAiRuntimeFiles(
	"dist",
	"auth",
	"oauth",
	"github-copilot.js",
);
const piAiForwardFixPaths = PI_AI_FORWARD_FIX_TARGETS.flatMap((relativePath) =>
	resolvePiAiRuntimeFiles(...relativePath.split("/")).map((entryPath) => ({ entryPath, relativePath }))
);
const piCodingAgentForwardFixPaths = PI_CODING_AGENT_FORWARD_FIX_TARGETS.flatMap((relativePath) =>
	[piPackageRoot ? resolve(piPackageRoot, ...relativePath.split("/")) : null, resolveWorkspacePiFile("pi-coding-agent", ...relativePath.split("/"))]
		.filter(Boolean).map((entryPath) => ({ entryPath, relativePath })));
const compactionToolsPaths = PI_COMPACTION_TOOLS_PATCH_TARGETS.flatMap((relativePath) =>
	[piPackageRoot ? resolve(piPackageRoot, ...relativePath.split("/")) : null, resolveWorkspacePiFile("pi-coding-agent", ...relativePath.split("/"))]
		.filter(Boolean).map((entryPath) => ({ entryPath, relativePath })));
const piEditLineEndingsPaths = PI_EDIT_LINE_ENDINGS_PATCH_TARGETS.flatMap((relativePath) =>
	[piPackageRoot ? resolve(piPackageRoot, ...relativePath.split("/")) : null, resolveWorkspacePiFile("pi-coding-agent", ...relativePath.split("/"))]
		.filter(Boolean).map((entryPath) => ({ entryPath, relativePath })));
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
for (const entryPath of transformMessagesPaths) {
	assertPiPackageVersion(resolve(entryPath, "..", "..", ".."), "Pi AI runtime package");
}
for (const entryPath of nestedTuiPaths) {
	assertPiPackageVersion(resolve(entryPath, "..", ".."), "bundled nested pi-tui");
}
const workspaceTuiPath = resolveWorkspacePiFile("pi-tui", "dist", "tui.js");
const workspaceTuiMainScreenPath = resolveWorkspacePiFile("pi-tui", "dist", "tui-main-screen.js");
const workspaceEditorPath = resolveWorkspacePiFile("pi-tui", "dist", "components", "editor.js");
const workspaceNestedTuiPaths = resolveWorkspaceNestedPiFiles(workspaceRoot, "pi-tui", "dist", "tui.js");
const workspaceNestedTuiMainScreenPaths = resolveWorkspaceNestedPiFiles(
	workspaceRoot,
	"pi-tui",
	"dist",
	"tui-main-screen.js",
);
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
const piBtwRoot = resolve(workspaceRoot, "pi-btw");
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
const workspaceArchivePath = resolve(appRoot, ".feynman", "runtime-workspace.tgz");
const workspaceArchiveDigestPath = resolve(appRoot, ".feynman", "runtime-workspace.sha256");
const workspaceSetupLockDir = resolve(appRoot, ".feynman", ".workspace-setup.lock");
const globalNodeModulesRoot = process.platform === "win32"
	? resolve(feynmanNpmPrefix, "node_modules")
	: resolve(feynmanNpmPrefix, "lib", "node_modules");
const PRUNE_VERSION = 8;
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

function listPiCliArgsPackageRoots(nodeModulesRoot) {
	return ["@earendil-works", "@mariozechner"]
		.map((scope) => resolve(nodeModulesRoot, scope, "pi-coding-agent"))
		.filter((packageRoot) => existsSync(packageRoot));
}

function preflightPiCliArgsPackageRoots(packageRoots) {
	const uniqueRoots = new Map();
	for (const packageRoot of packageRoots.filter(Boolean)) {
		if (!existsSync(packageRoot)) continue;
		let identity = packageRoot;
		try {
			identity = realpathSync(packageRoot);
		} catch {}
		// Prefer the canonical scoped package over a later legacy alias. Windows
		// tar may recreate that alias as a junction whose real path is healthy
		// even when traversing the alias path does not expose every file yet.
		if (!uniqueRoots.has(identity)) {
			uniqueRoots.set(identity, packageRoot);
		}
	}
	const argsPaths = [];
	for (const packageRoot of uniqueRoots.values()) {
		preflightPiCliArgsPackageRoot(packageRoot, packageRoot);
		argsPaths.push(resolve(packageRoot, "dist", "cli", "args.js"));
	}
	return argsPaths;
}

function supportsNativePackageSources(version = process.versions.node) {
	const [major = "0"] = version.replace(/^v/, "").split(".");
	return (Number.parseInt(major, 10) || 0) <= 22;
}

function parsePackageName(spec) {
	const match = spec.match(/^(@?[^@]+(?:\/[^@]+)?)(?:@.+)?$/);
	return match?.[1] ?? spec;
}

function filterUnsupportedPackageSpecs(packageSpecs) {
	if (supportsNativePackageSources()) return packageSpecs;
	return packageSpecs.filter((spec) => !NATIVE_PACKAGE_SPECS.has(parsePackageName(spec)));
}

function workspaceMatchesRuntime(
	packageSpecs,
	nodeModulesRoot = workspaceRoot,
	requireCompletion = true,
) {
	return runtimeWorkspaceMatches(resolve(nodeModulesRoot, ".."), packageSpecs, {
		archivePath: workspaceArchivePath,
		digestPath: workspaceArchiveDigestPath,
		filterPackageSpecs: filterUnsupportedPackageSpecs,
		pruneVersion: PRUNE_VERSION,
		requireCompletion,
		requireCurrentPlatformPackageGraph: true,
		requirePlatformIdentity: supportsNativePackageSources(),
	});
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
function restorePackagedWorkspace(
	configuredPackageSpecs,
	supportedPackageSpecs,
	heartbeat,
) {
	const result = restoreRuntimeWorkspaceFromArchiveWithSeed({
		archivePath: workspaceArchivePath,
		configuredPackageSpecs,
		digestPath: workspaceArchiveDigestPath,
		heartbeat,
		workspaceDir,
		platform: process.platform,
		validateWorkspace: (stagedWorkspaceDir) => {
			// Git for Windows tar can recreate a portable directory symlink as a
			// non-traversable file link. Repair only the known Pi compatibility
			// aliases inside staging before any parser or runtime validation.
			ensureLegacyPiRuntimeAliases(
				resolve(stagedWorkspaceDir, "node_modules"),
			);
			preflightPiCliArgsPackageRoots(
				listPiCliArgsPackageRoots(
					resolve(stagedWorkspaceDir, "node_modules"),
				),
			);
			return workspaceMatchesRuntime(
				supportedPackageSpecs,
				resolve(stagedWorkspaceDir, "node_modules"),
				false,
			);
		},
	});
	if (result.installSeed) {
		result.installSeed.packageSpecs = filterUnsupportedPackageSpecs(
			result.installSeed.packageSpecs,
		);
	}
	return result;
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

function ensurePackageWorkspace() {
	if (!existsSync(settingsPath)) return;
	const lockToken = acquireRuntimeWorkspaceSetupLock(workspaceSetupLockDir);
	const heartbeat = () => {
		if (!heartbeatRuntimeWorkspaceSetupLock(workspaceSetupLockDir, lockToken)) {
			throw new Error(
				"Feynman lost ownership of the runtime workspace setup lock.",
			);
		}
	};
	try {
		heartbeat();
		ensurePackageWorkspaceUnlocked(heartbeat);
	} finally {
		releaseRuntimeWorkspaceSetupLock(workspaceSetupLockDir, lockToken);
	}
}

function ensurePackageWorkspaceUnlocked(heartbeat) {
	const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
	const packageSpecs = Array.isArray(settings.packages)
		? settings.packages
				.filter((v) => typeof v === "string" && v.startsWith("npm:"))
				.map((v) => v.slice(4))
		: [];
	const supportedPackageSpecs = filterUnsupportedPackageSpecs(packageSpecs);

	if (supportedPackageSpecs.length === 0) return;
	reconcileRuntimeWorkspaceRestoreArtifacts(workspaceDir);
	if (workspaceMatchesRuntime(supportedPackageSpecs)) {
		reconcileRuntimeWorkspaceRestoreArtifacts(workspaceDir, {
			workspaceIsHealthy: true,
		});
		ensureBundledPackageLinks(supportedPackageSpecs);
		return;
	}
	let packagedRestore;
	try {
		packagedRestore = restorePackagedWorkspace(
			packageSpecs,
			supportedPackageSpecs,
			heartbeat,
		);
	} catch (error) {
		if (!buildSourceRuntimeArchive(appRoot, { force: true, heartbeat })) {
			throw error;
		}
		packagedRestore = restorePackagedWorkspace(
			packageSpecs,
			supportedPackageSpecs,
			heartbeat,
		);
	}
	if (packagedRestore.restored && workspaceMatchesRuntime(supportedPackageSpecs)) {
		ensureBundledPackageLinks(supportedPackageSpecs);
		return;
	}
	let installSeed = packagedRestore.installSeed;
	if (
		!installSeed &&
		buildSourceRuntimeArchive(appRoot, { force: true, heartbeat })
	) {
		const sourceRestore = restorePackagedWorkspace(
			packageSpecs,
			supportedPackageSpecs,
			heartbeat,
		);
		if (
			sourceRestore.restored &&
			workspaceMatchesRuntime(supportedPackageSpecs)
		) {
			ensureBundledPackageLinks(supportedPackageSpecs);
			return;
		}
		installSeed = sourceRestore.installSeed;
	}
	if (!installSeed) {
		throw new Error(
			"Feynman could not read an authenticated package-lock restore seed.",
		);
	}
	const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
	let frame = 0;
	const start = Date.now();
	const spinner = setInterval(() => {
		const elapsed = Math.round((Date.now() - start) / 1000);
		process.stderr.write(`\r${frames[frame++ % frames.length]} setting up feynman... ${elapsed}s`);
	}, 80);

	let result = false;
	try {
		result = replaceRuntimeWorkspaceTransactionally(
			workspaceDir,
			(stagedWorkspaceDir) => {
				prepareRuntimeWorkspaceFallback(stagedWorkspaceDir, installSeed);
				if (!installRuntimeWorkspaceFromPackageLock(stagedWorkspaceDir, {
					expectedPackageLockSha256: installSeed.packageLockSha256,
					heartbeat,
				})) {
					return false;
				}
				if (!patchStagedRuntimeWorkspace(appRoot, stagedWorkspaceDir, {
					heartbeat,
				})) {
					return false;
				}
				if (
					!workspaceMatchesRuntime(
						supportedPackageSpecs,
						resolve(stagedWorkspaceDir, "node_modules"),
						false,
					)
				) {
					return false;
				}
				writeRuntimeWorkspaceCompletion(stagedWorkspaceDir, {
					source: "package-manager",
					runtimeTreeHash: computeRuntimeTreeHash(stagedWorkspaceDir),
					expectedPackageLockSha256: installSeed.packageLockSha256,
				});
				return runtimeWorkspaceCompletionMatches(stagedWorkspaceDir, {
					archivePath: workspaceArchivePath,
					digestPath: workspaceArchiveDigestPath,
				});
			},
		);
	} finally {
		clearInterval(spinner);
	}
	const elapsed = Math.round((Date.now() - start) / 1000);

	if (!result) {
		process.stderr.write(`\r✗ setup failed (${elapsed}s)\n`);
		throw new Error("Feynman could not restore its bundled research runtime.");
	} else {
		process.stderr.write("\r\x1b[2K");
		if (!workspaceMatchesRuntime(supportedPackageSpecs)) {
			throw new Error(
				"Feynman restored an incomplete bundled research runtime.",
			);
		}
		ensureBundledPackageLinks(supportedPackageSpecs);
	}
}

// Preflight every package-local parser before package setup or any later patch
// write. The generated runtime is preflighted inside staging before atomic
// publication because an invalid previous workspace may be replaced by the
// authenticated archive.
const outerPiCliArgsPaths = preflightPiCliArgsPackageRoots([
	piPackageRoot,
	...listPiCliArgsPackageRoots(resolve(appRoot, "node_modules")),
]);
ensurePackageWorkspace();
const piCliArgsPaths = preflightPiCliArgsPackageRoots([
	...outerPiCliArgsPaths.map((argsPath) => dirname(dirname(dirname(argsPath)))),
	workspacePiPackageRoot,
	...listPiCliArgsPackageRoots(workspaceRoot),
]);

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
const globalPiOtelRoot = resolve(globalNodeModulesRoot, "pi-otel");
const agentNpmPiOtelRoot = resolve(feynmanHome, "agent", "npm", "node_modules", "pi-otel");
const globalPiBtwRoot = resolve(globalNodeModulesRoot, "pi-btw");
const agentNpmPiBtwRoot = resolve(feynmanHome, "agent", "npm", "node_modules", "pi-btw");
const researchPackagePatchPlans = [
	...Array.from(uniqueExistingPackageRoots([
		piBtwRoot,
		globalPiBtwRoot,
		agentNpmPiBtwRoot,
	])).map((packageRoot) =>
		preflightPackageRootPatch({
			packageRoot,
			packageName: "pi-btw",
			requiredVersion: PI_BTW_MODEL_RUNTIME_REQUIRED_VERSION,
			targets: PI_BTW_MODEL_RUNTIME_PATCH_TARGETS,
			patchSource: patchPiBtwModelRuntimeSource,
		})),
	...Array.from(uniqueExistingPackageRoots([
		piOtelRoot,
		globalPiOtelRoot,
		agentNpmPiOtelRoot,
	])).map((packageRoot) => preflightPiOtelPackageRoot(packageRoot)),
];
applyPackageRootPatchPlans(researchPackagePatchPlans);

for (const subagentsRoot of uniqueExistingPackageRoots([
	piSubagentsRoot,
	globalPiSubagentsRoot,
	agentNpmPiSubagentsRoot,
])) {
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

const piDocparserRoot = resolve(workspaceRoot, "pi-docparser");
const globalPiDocparserRoot = resolve(globalNodeModulesRoot, "pi-docparser");
const agentNpmPiDocparserRoot = resolve(feynmanHome, "agent", "npm", "node_modules", "pi-docparser");
patchPiDocparserRuntimeRoots({
	bundledRoot: piDocparserRoot,
	roots: [piDocparserRoot, globalPiDocparserRoot, agentNpmPiDocparserRoot],
});

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
const workspaceAuthStoragePath = resolveWorkspacePiFile("pi-coding-agent", "dist", "core", "auth-storage.js");
assertPiPackageVersion(workspacePiPackageRoot, "vendored pi-coding-agent");
for (const packageRoot of [piPackageRoot, workspacePiPackageRoot].filter(Boolean))
	patchPiExtensionHandlerTimeoutPackageRoot(packageRoot);
for (const packageRoot of [piPackageRoot, workspacePiPackageRoot].filter(Boolean)) {
	if (!existsSync(resolve(packageRoot, "package.json"))) continue;
	const version = JSON.parse(
		readFileSync(resolve(packageRoot, "package.json"), "utf8"),
	).version;
	assertPiEditLineEndingsVersion(version, packageRoot);
}
for (const { entryPath, relativePath } of piEditLineEndingsPaths) {
	if (!existsSync(entryPath) || !shouldPatchPiRuntimeCorrectnessFile(entryPath)) continue;
	const source = readFileSync(entryPath, "utf8");
	const patched = patchPiEditLineEndingsSource(relativePath, source);
	if (patched !== source) {
		writeFileSync(entryPath, patched, "utf8");
	}
}
patchFilesIfPresent(piCliArgsPaths, patchPiCliArgsSource);
patchFilesIfPresent([authStoragePath, workspaceAuthStoragePath], patchPiStateFilePermissionsSource);
for (const entryPath of [modelRegistryPath, modelRuntimePath, workspaceModelRegistryPath, workspaceModelRuntimePath].filter(Boolean)) {
	if (!existsSync(entryPath)) continue;
	const source = readFileSync(entryPath, "utf8");
	const patched = patchPiModelRegistrySource(source);
	if (patched !== source) {
		writeFileSync(entryPath, patched, "utf8");
	}
}

const safeBraceExpansionPath = resolve(appRoot, "node_modules", "brace-expansion");
const feynmanUndiciPath = resolve(appRoot, "node_modules", "undici");
for (const modules of [resolve(appRoot, "node_modules"), workspaceRoot]) {
	patchPiBraceExpansionTree(modules, safeBraceExpansionPath);
	patchPiEsbuildPackageTree(
		modules, resolve(appRoot, "node_modules", "esbuild"), { runtime: modules === workspaceRoot },
	);
	patchPiUndiciProxyTree(modules, feynmanUndiciPath, PI_RUNTIME_CORRECTNESS_REQUIRED_VERSION);
}
for (const nodeModulesRoot of [
	resolve(appRoot, "node_modules"),
	resolve(appRoot, "node_modules", "@advaitpaliwal", "alpha-hub", "node_modules"),
	workspaceRoot,
	resolve(workspaceRoot, "@advaitpaliwal", "alpha-hub", "node_modules"),
]) {
	patchMcpSdkManifest(nodeModulesRoot);
}

for (const [entryPath, patchSource] of [
	[agentSessionPath, patchPiAgentSessionSource],
	[workspaceAgentSessionPath, patchPiAgentSessionSource],
	[sessionManagerPath, patchPiSessionManagerSource],
	[workspaceSessionManagerPath, patchPiSessionManagerSource],
	...transformMessagesPaths.map((entryPath) => [entryPath, patchPiTransformMessagesSource]),
	...githubCopilotDeviceCodePaths.map((entryPath) => [
		entryPath,
		patchPiGithubCopilotDeviceCodeSource,
	]),
	...githubCopilotOAuthPaths.map((entryPath) => [
		entryPath,
		patchPiGithubCopilotOAuthSource,
	]),
	...piAiForwardFixPaths.map(({ entryPath, relativePath }) => [
		entryPath,
		(source) => patchPiAiForwardFixSource(relativePath, source),
	]),
	...piCodingAgentForwardFixPaths.map(({ entryPath, relativePath }) => [
		entryPath,
		(source) => patchPiCodingAgentForwardFixSource(relativePath, source),
	]),
	...compactionToolsPaths.map(({ entryPath, relativePath }) => [entryPath, (source) => patchPiCompactionToolsSource(relativePath, source)]),
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
	tuiMainScreenPath,
	...nestedTuiPaths,
	...nestedTuiMainScreenPaths,
	workspaceTuiPath,
	workspaceTuiMainScreenPath,
	...workspaceNestedTuiPaths,
	...workspaceNestedTuiMainScreenPaths,
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
	const manifestPath = resolve(piWebAccessRoot, "package.json");
	const version = existsSync(manifestPath)
		? JSON.parse(readFileSync(manifestPath, "utf8")).version
		: undefined;
	assertPiWebAccessVersion(version, "embedded runtime workspace");
	syncPiWebAccessForwardFiles(appRoot, piWebAccessRoot, version);
	const sources = new Map();
	for (const relativePath of PI_WEB_ACCESS_PATCH_TARGETS) {
		const entryPath = resolve(piWebAccessRoot, relativePath);
		if (!existsSync(entryPath)) {
			throw new Error(`pi-web-access patch target is missing: ${relativePath}`);
		}
		sources.set(relativePath, readFileSync(entryPath, "utf8"));
	}
	const patchedSources = patchPiWebAccessSources(sources, "embedded runtime workspace");
	for (const [relativePath, patched] of patchedSources) {
		const entryPath = resolve(piWebAccessRoot, relativePath);
		const source = sources.get(relativePath);
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

const alphaHubAuthPath = findPackageRoot("@advaitpaliwal/alpha-hub")
	? resolve(findPackageRoot("@advaitpaliwal/alpha-hub"), "src", "lib", "auth.js")
	: null;
const alphaHubSearchPath = findPackageRoot("@advaitpaliwal/alpha-hub")
	? resolve(findPackageRoot("@advaitpaliwal/alpha-hub"), "src", "lib", "alphaxiv.js")
	: null;
const alphaHubIndexPath = findPackageRoot("@advaitpaliwal/alpha-hub")
	? resolve(findPackageRoot("@advaitpaliwal/alpha-hub"), "src", "lib", "index.js")
	: null;

if (alphaHubAuthPath && existsSync(alphaHubAuthPath)) {
	const source = readFileSync(alphaHubAuthPath, "utf8");
	const patched = patchAlphaHubAuthSource(source, { version: "0.1.4" });
	if (patched !== source) {
		writeFileSync(alphaHubAuthPath, patched, "utf8");
	}
}
if (alphaHubSearchPath && existsSync(alphaHubSearchPath)) {
	const source = readFileSync(alphaHubSearchPath, "utf8");
	const patched = patchAlphaHubSearchSource(source, { version: "0.1.4" });
	if (patched !== source) {
		writeFileSync(alphaHubSearchPath, patched, "utf8");
	}
}
if (alphaHubIndexPath && existsSync(alphaHubIndexPath)) {
	const source = readFileSync(alphaHubIndexPath, "utf8");
	const patched = patchAlphaHubSearchResultsSource(source, { version: "0.1.4" });
	if (patched !== source) {
		writeFileSync(alphaHubIndexPath, patched, "utf8");
	}
}

// The bundled workspace carries its own alpha-hub copy; patch it the same way
// so search fixes apply regardless of which copy resolves at runtime.
const workspaceAlphaHubLib = resolve(workspaceRoot, "@advaitpaliwal", "alpha-hub", "src", "lib");
for (const [fileName, patchFn] of [
	["auth.js", patchAlphaHubAuthSource],
	["alphaxiv.js", patchAlphaHubSearchSource],
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
