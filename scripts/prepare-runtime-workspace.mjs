import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { patchPiAgentCoreSource } from "./lib/pi-agent-core-patch.mjs";
import {
	assertPiCliArgsVersion,
	ensureLegacyPiRuntimeAliases,
	patchPiCliArgsSource,
} from "./lib/pi-cli-args-patch.mjs";
import {
	assertPiEditLineEndingsVersion,
	PI_EDIT_LINE_ENDINGS_RUNTIME_TARGETS,
	patchPiEditLineEndingsSource,
} from "./lib/pi-edit-line-endings-patch.mjs";
import {
	assertPiDocparserInvisibleTextVersion,
	PI_DOCPARSER_INVISIBLE_TEXT_PATCH_TARGETS,
	patchPiDocparserInvisibleTextSource,
} from "./lib/pi-docparser-invisible-text-patch.mjs";
import {
	PI_AI_FORWARD_FIX_TARGETS,
	patchPiAiForwardFixSource,
} from "./lib/pi-ai-forward-fixes-patch.mjs";
import {
	PI_COMPACTION_TOOLS_PATCH_TARGETS,
	patchPiCompactionToolsSource,
} from "./lib/pi-compaction-tools-patch.mjs";
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
import {
	assertPiExtensionHandlerTimeoutVersion,
	PI_EXTENSION_HANDLER_TIMEOUT_TARGET,
	patchPiExtensionHandlerTimeoutSource,
} from "./lib/pi-extension-handler-timeout-patch.mjs";
import { patchPiExtensionLoaderSource } from "./lib/pi-extension-loader-patch.mjs";
import { patchPiModelRegistrySource } from "./lib/pi-model-registry-patch.mjs";
import {
	PI_BTW_MODEL_RUNTIME_PATCH_TARGETS,
	PI_BTW_MODEL_RUNTIME_REQUIRED_VERSION,
	patchPiBtwModelRuntimeSource,
} from "./lib/pi-btw-model-runtime-patch.mjs";
import {
	applyPackageRootPatchPlans,
	preflightPackageRootPatch,
} from "./lib/package-root-patch-utils.mjs";
import { patchPiStateFilePermissionsSource } from "./lib/pi-state-file-permissions-patch.mjs";
import { patchPiUndiciProxyTree } from "./lib/pi-undici-proxy-patch.mjs";
import { patchPiBraceExpansionTree } from "./lib/pi-shrinkwrap-security-patch.mjs";
import {
	patchPiEditorSource,
	patchPiInteractiveThemeSource,
	patchPiInteractiveUpdateNoticeSource,
	patchPiTuiSource,
} from "./lib/pi-tui-patch.mjs";
import {
	assertPiWebAccessVersion,
	PI_WEB_ACCESS_PATCH_TARGETS,
	patchPiWebAccessSources,
	syncPiWebAccessForwardFiles,
} from "./lib/pi-web-access-patch.mjs";
import { PI_SUBAGENTS_PATCH_TARGETS, patchPiSubagentsSource, stripPiSubagentBuiltinModelSource } from "./lib/pi-subagents-patch.mjs";
import { preflightPiOtelPackageRoot } from "./lib/pi-otel-patch.mjs";
import { PI_SESSION_SEARCH_PATCH_TARGETS, patchPiSessionSearchSource } from "./lib/pi-session-search-patch.mjs";
import { patchAlphaHubAuthSource } from "./lib/alpha-hub-auth-patch.mjs";
import {
	patchAlphaHubSearchResultsSource,
	patchAlphaHubSearchSource,
} from "./lib/alpha-hub-search-patch.mjs";
import { patchMcpSdkPackageJsonSource } from "./lib/mcp-sdk-package-patch.mjs";
import {
	FEYNMAN_PI_TELEMETRY_PACKAGE,
	resolvePiTelemetryRuntimeVersion,
} from "./lib/pi-telemetry-release-contract.mjs";
import { createDeterministicTarGz } from "./lib/deterministic-archive.mjs";
import {
	computeRuntimeArchiveTreeHash,
	computeRuntimeInputHash,
	computeRuntimeTreeHash,
	filesMatch,
	runtimeArchiveMatches,
	workspacePackagesMatch,
	writeFileSha256,
} from "./lib/runtime-workspace-integrity.mjs";

const appRoot = resolve(import.meta.dirname, "..");
const settingsPath = resolve(appRoot, ".feynman", "settings.json");
const packageJsonPath = resolve(appRoot, "package.json");
const packageLockPath = resolve(appRoot, "package-lock.json");
const feynmanDir = resolve(appRoot, ".feynman");
const runtimePackageLockPath = resolve(feynmanDir, "runtime-package-lock.json");
const explicitWorkspaceDir =
	process.env.FEYNMAN_RUNTIME_WORKSPACE_TARGET?.trim();
const workspaceDir = explicitWorkspaceDir
	? resolve(explicitWorkspaceDir)
	: resolve(appRoot, ".feynman", "npm");
const workspaceNodeModulesDir = resolve(workspaceDir, "node_modules");
const manifestPath = resolve(workspaceDir, ".runtime-manifest.json");
const workspacePackageJsonPath = resolve(workspaceDir, "package.json");
const workspaceNpmConfigPath = resolve(workspaceDir, ".npmrc");
const workspaceArchivePath = resolve(feynmanDir, "runtime-workspace.tgz");
const workspaceArchiveDigestPath = resolve(feynmanDir, "runtime-workspace.sha256");
const PRUNE_VERSION = 8;
const PI_RUNTIME_FALLBACK_VERSION = "0.84.2";
const RUNTIME_PACKAGE_OVERRIDES = {
	"@mozilla/readability": "0.6.0",
	"@modelcontextprotocol/sdk": {
		"@hono/node-server": "2.0.12",
	},
	"@opentelemetry/core": "2.10.0",
	"@opentelemetry/exporter-logs-otlp-grpc": "0.221.0",
	"@opentelemetry/exporter-logs-otlp-http": "0.221.0",
	"@opentelemetry/exporter-logs-otlp-proto": "0.221.0",
	"@opentelemetry/exporter-metrics-otlp-grpc": "0.221.0",
	"@opentelemetry/exporter-metrics-otlp-http": "0.221.0",
	"@opentelemetry/exporter-metrics-otlp-proto": "0.221.0",
	"@opentelemetry/exporter-prometheus": "0.221.0",
	"@opentelemetry/exporter-trace-otlp-grpc": "0.221.0",
	"@opentelemetry/exporter-trace-otlp-http": "0.221.0",
	"@opentelemetry/exporter-trace-otlp-proto": "0.221.0",
	"@opentelemetry/exporter-zipkin": "2.10.0",
	"@opentelemetry/instrumentation": "0.221.0",
	"@opentelemetry/otlp-exporter-base": "0.221.0",
	"@opentelemetry/otlp-grpc-exporter-base": "0.221.0",
	"@opentelemetry/otlp-transformer": "0.221.0",
	"@opentelemetry/propagator-b3": "2.10.0",
	"@opentelemetry/propagator-jaeger": "2.10.0",
	"@opentelemetry/resources": "2.10.0",
	"@opentelemetry/sdk-logs": "0.221.0",
	"@opentelemetry/sdk-metrics": "2.10.0",
	"@opentelemetry/sdk-node": "0.221.0",
	"@opentelemetry/sdk-trace-base": "2.10.0",
	"@opentelemetry/sdk-trace-node": "2.10.0",
	"@llamaindex/liteparse": "2.14.0",
	"brace-expansion": "5.0.9",
	"ip-address": "10.5.0",
	"fast-uri": "3.1.6",
	qs: "6.16.0",
	undici: "8.10.0",
};
const PINNED_RUNTIME_PACKAGES = [
	"@earendil-works/pi-agent-core",
	"@earendil-works/pi-ai",
	"@earendil-works/pi-coding-agent",
	FEYNMAN_PI_TELEMETRY_PACKAGE,
	"@earendil-works/pi-tui",
	"brace-expansion",
	"typebox",
	"undici",
];
const NATIVE_PACKAGE_SPECS = new Set([
	"@kaiserlich-dev/pi-session-search",
]);

function supportsNativePackageSources(version = process.versions.node) {
	const [major = "0"] = version.replace(/^v/, "").split(".");
	return (Number.parseInt(major, 10) || 0) <= 22;
}

function parsePackageName(spec) {
	const match = spec.match(/^(@?[^@]+(?:\/[^@]+)?)(?:@.+)?$/);
	return match?.[1] ?? spec;
}

function runtimeDependencies(packageSpecs) {
	return Object.fromEntries(packageSpecs.map((spec) => {
		const name = parsePackageName(spec);
		const version = spec.startsWith(`${name}@`) ? spec.slice(name.length + 1) : "";
		if (!version) {
			throw new Error(`Runtime package must use an exact spec: ${spec}`);
		}
		return [name, version];
	}));
}

function filterUnsupportedPackageSpecs(packageSpecs) {
	if (supportsNativePackageSources()) return packageSpecs;
	return packageSpecs.filter((spec) => !NATIVE_PACKAGE_SPECS.has(parsePackageName(spec)));
}

function readPackageSpecs() {
	const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
	const packageSpecs = Array.isArray(settings.packages)
		? settings.packages
			.filter((value) => typeof value === "string" && value.startsWith("npm:"))
			.map((value) => value.slice(4))
		: [];

	for (const packageName of PINNED_RUNTIME_PACKAGES) {
		let version = readLockedPackageVersion(packageName);
		if (packageName === FEYNMAN_PI_TELEMETRY_PACKAGE) {
			version = resolvePiTelemetryRuntimeVersion(
				version,
				existsSync(packageLockPath),
			);
		}
		if (version) {
			packageSpecs.push(`${packageName}@${version}`);
		}
	}
	return filterUnsupportedPackageSpecs(Array.from(new Set(packageSpecs)));
}

function readLockedPackageVersion(packageName) {
	if (!existsSync(packageLockPath)) {
		return undefined;
	}
	try {
		const lockfile = JSON.parse(readFileSync(packageLockPath, "utf8"));
		const entry = lockfile.packages?.[`node_modules/${packageName}`];
		return typeof entry?.version === "string" ? entry.version : undefined;
	} catch {
		return undefined;
	}
}

function arraysMatch(left, right) {
	return left.length === right.length && left.every((value, index) => value === right[index]);
}

function getRuntimeInputHash() {
	return computeRuntimeInputHash(appRoot);
}

function workspaceIsCurrent(packageSpecs) {
	if (!existsSync(manifestPath) || !existsSync(workspaceNodeModulesDir)) {
		return false;
	}
	if (!filesMatch(resolve(workspaceDir, "package-lock.json"), runtimePackageLockPath)) {
		return false;
	}

	try {
		const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
		if (!Array.isArray(manifest.packageSpecs) || !arraysMatch(manifest.packageSpecs, packageSpecs)) {
			return false;
		}
		if (manifest.runtimeInputHash !== getRuntimeInputHash()) {
			return false;
		}
		if (
			typeof manifest.runtimeTreeHash !== "string" ||
			typeof (manifest.workspaceTreeHash ?? manifest.runtimeTreeHash) !== "string" ||
			computeRuntimeTreeHash(workspaceDir) !==
				(manifest.workspaceTreeHash ?? manifest.runtimeTreeHash)
		) {
			return false;
		}
		if (
			manifest.nodeAbi !== process.versions.modules ||
			manifest.platform !== process.platform ||
			manifest.arch !== process.arch ||
			manifest.pruneVersion !== PRUNE_VERSION
		) {
			return false;
		}

		return workspacePackagesMatch(workspaceNodeModulesDir, packageSpecs);
	} catch {
		return false;
	}
}

function writeWorkspacePackageJson(packageSpecs) {
	writeFileSync(
		workspacePackageJsonPath,
		JSON.stringify(
			{
				name: "feynman-runtime",
				private: true,
				overrides: RUNTIME_PACKAGE_OVERRIDES,
				dependencies: runtimeDependencies(packageSpecs),
			},
			null,
			2,
		) + "\n",
		"utf8",
	);
	writeFileSync(workspaceNpmConfigPath, "", "utf8");
}

function childNpmInstallEnv() {
	return {
		...process.env,
		// `npm pack --dry-run` exports dry-run config to lifecycle scripts. The
		// vendored runtime workspace must still install real node_modules so the
		// publish artifact can be validated without poisoning the archive.
		npm_config_dry_run: "false",
		NPM_CONFIG_DRY_RUN: "false",
		npm_config_global: "false",
		NPM_CONFIG_GLOBAL: "false",
		npm_config_location: "project",
		NPM_CONFIG_LOCATION: "project",
		npm_config_userconfig: workspaceNpmConfigPath,
		NPM_CONFIG_USERCONFIG: workspaceNpmConfigPath,
	};
}

function runWorkspaceNpm(args) {
	const result = spawnSync(
		process.env.npm_execpath ? process.execPath : "npm",
		process.env.npm_execpath
			? [process.env.npm_execpath, ...args]
			: args,
		{ stdio: "inherit", env: childNpmInstallEnv() },
	);
	if (result.status !== 0) {
		process.exit(result.status ?? 1);
	}
}

function prepareWorkspace(packageSpecs, refreshRuntimeLock) {
	rmSync(workspaceDir, { recursive: true, force: true });
	mkdirSync(workspaceDir, { recursive: true });
	writeWorkspacePackageJson(packageSpecs);

	if (packageSpecs.length === 0) {
		return;
	}

	if (refreshRuntimeLock) {
		runWorkspaceNpm([
			"install",
			"--save-exact",
			"--prefer-online",
			"--no-audit",
			"--no-fund",
			"--no-dry-run",
			"--legacy-peer-deps",
			"--loglevel",
			"error",
			"--prefix",
			workspaceDir,
			...packageSpecs,
		]);
		return;
	}

	if (!existsSync(runtimePackageLockPath)) {
		throw new Error(
			"Missing .feynman/runtime-package-lock.json. Run npm run runtime:lock to create it.",
		);
	}
	cpSync(runtimePackageLockPath, resolve(workspaceDir, "package-lock.json"));
	runWorkspaceNpm([
		"ci",
		"--no-audit",
		"--no-fund",
		"--no-dry-run",
		"--legacy-peer-deps",
		"--loglevel",
		"error",
		"--prefix",
		workspaceDir,
	]);
}

function writeManifest(packageSpecs, runtimeTreeHash = computeRuntimeTreeHash(workspaceDir)) {
	const workspaceTreeHash = computeRuntimeTreeHash(workspaceDir);
	const libc = process.platform === "linux"
		? (process.report?.getReport?.().header?.glibcVersionRuntime
			? "glibc"
			: "musl")
		: undefined;
	writeFileSync(
		manifestPath,
		JSON.stringify(
			{
				packageSpecs,
				runtimeInputHash: getRuntimeInputHash(),
				runtimeTreeHash,
				workspaceTreeHash,
				nodeAbi: process.versions.modules,
					nodeVersion: process.version,
					platform: process.platform,
					arch: process.arch,
					...(libc ? { libc } : {}),
					pruneVersion: PRUNE_VERSION,
			},
			null,
			2,
		) + "\n",
		"utf8",
	);
}

function pruneWorkspace() {
	const result = spawnSync(process.execPath, [resolve(appRoot, "scripts", "prune-runtime-deps.mjs"), workspaceDir], {
		stdio: "inherit",
	});
	if (result.status !== 0) {
		process.exit(result.status ?? 1);
	}
}

function linkLegacyPiRuntimeAliases() {
	return ensureLegacyPiRuntimeAliases(workspaceNodeModulesDir);
}

function patchBundledPiSubagents() {
	const piSubagentsRoot = resolve(workspaceNodeModulesDir, "pi-subagents");
	if (!existsSync(piSubagentsRoot)) {
		return false;
	}

	let changed = false;
	for (const relativePath of PI_SUBAGENTS_PATCH_TARGETS) {
		const entryPath = resolve(piSubagentsRoot, relativePath);
		if (!existsSync(entryPath)) continue;

		const source = readFileSync(entryPath, "utf8");
		const patched = patchPiSubagentsSource(relativePath, source);
		if (patched === source) continue;
		writeFileSync(entryPath, patched, "utf8");
		changed = true;
	}

	const agentsRoot = resolve(piSubagentsRoot, "agents");
	if (!existsSync(agentsRoot)) {
		return changed;
	}

	for (const entry of readdirSync(agentsRoot, { withFileTypes: true })) {
		if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
		const entryPath = resolve(agentsRoot, entry.name);
		const source = readFileSync(entryPath, "utf8");
		const patched = stripPiSubagentBuiltinModelSource(source);
		if (patched === source) continue;
		writeFileSync(entryPath, patched, "utf8");
		changed = true;
	}
	return changed;
}

function patchScopedPiWorkspaceFile(packageName, relativePath, patchSource) {
	let changed = false;
	for (const scope of ["@earendil-works", "@mariozechner"]) {
		const filePath = resolve(workspaceNodeModulesDir, scope, packageName, ...relativePath.split("/"));
		if (!existsSync(filePath)) continue;
		const source = readFileSync(filePath, "utf8");
		const patched = patchSource(source);
		if (patched === source) continue;
		writeFileSync(filePath, patched, "utf8");
		changed = true;
	}
	return changed;
}

function patchNestedPiWorkspaceFile(parentPackageName, nestedPackageName, relativePath, patchSource) {
	let changed = false;
	for (const parentScope of ["@earendil-works", "@mariozechner"]) {
		for (const nestedScope of ["@earendil-works", "@mariozechner"]) {
			const filePath = resolve(
				workspaceNodeModulesDir,
				parentScope,
				parentPackageName,
				"node_modules",
				nestedScope,
				nestedPackageName,
				...relativePath.split("/"),
			);
			if (!existsSync(filePath)) continue;
			const source = readFileSync(filePath, "utf8");
			const patched = patchSource(source);
			if (patched === source) continue;
			writeFileSync(filePath, patched, "utf8");
			changed = true;
		}
	}
	return changed;
}

function assertPiPackageVersion(packageRoot, surface) {
	if (!existsSync(resolve(packageRoot, "package.json"))) return;
	const version = JSON.parse(readFileSync(resolve(packageRoot, "package.json"), "utf8")).version;
	assertPiRuntimeCorrectnessVersion(version, surface);
}

function patchPiCodingAgentPackageJsonSource(source) {
	const pkg = JSON.parse(source);
	const piConfig = typeof pkg.piConfig === "object" && pkg.piConfig !== null ? pkg.piConfig : {};
	if (piConfig.name === "feynman" && piConfig.configDir === ".feynman") {
		return source;
	}
	pkg.piConfig = {
		...piConfig,
		name: "feynman",
		configDir: ".feynman",
	};
	return JSON.stringify(pkg, null, 2) + "\n";
}

function patchBundledPiCodingAgentPackageJson() {
	return patchScopedPiWorkspaceFile("pi-coding-agent", "package.json", patchPiCodingAgentPackageJsonSource);
}

function collectBundledPiCliArgsCandidates() {
	const candidates = [];
	for (const scope of ["@earendil-works", "@mariozechner"]) {
		const packageRoot = resolve(
			workspaceNodeModulesDir,
			scope,
			"pi-coding-agent",
		);
		if (!existsSync(packageRoot)) continue;
		const version = JSON.parse(
			readFileSync(resolve(packageRoot, "package.json"), "utf8"),
		).version;
		assertPiCliArgsVersion(version, `runtime workspace ${scope}/pi-coding-agent`);
		if (!existsSync(resolve(packageRoot, "dist", "cli", "args.js"))) {
			throw new Error(
				`Pi CLI args patch target is missing: ${resolve(packageRoot, "dist", "cli", "args.js")}`,
			);
		}
		const path = resolve(packageRoot, "dist", "cli", "args.js");
		const source = readFileSync(path, "utf8");
		candidates.push({
			path,
			source,
			patched: patchPiCliArgsSource(source),
		});
	}
	return candidates;
}

function patchBundledPiCliArgs(
	candidates = collectBundledPiCliArgsCandidates(),
) {
	let changed = false;
	for (const candidate of candidates) {
		if (candidate.patched === candidate.source) continue;
		writeFileSync(candidate.path, candidate.patched, "utf8");
		changed = true;
	}
	return changed;
}

function patchBundledPiAgentCore() {
	let changed = false;
	changed = patchScopedPiWorkspaceFile("pi-agent-core", "dist/agent-loop.js", patchPiAgentCoreSource) || changed;
	changed = patchNestedPiWorkspaceFile(
		"pi-coding-agent",
		"pi-agent-core",
		"dist/agent-loop.js",
		patchPiAgentCoreSource,
	) || changed;
	return changed;
}

function patchBundledNestedPiAiFile(relativePath, patchSource) {
	let changed = false;
	for (const codingScope of ["@earendil-works", "@mariozechner"]) {
		for (const aiScope of ["@earendil-works", "@mariozechner"]) {
			const filePath = resolve(
				workspaceNodeModulesDir,
				codingScope,
				"pi-coding-agent",
				"node_modules",
				aiScope,
				"pi-ai",
				...relativePath.split("/"),
			);
			if (!existsSync(filePath)) continue;
			const source = readFileSync(filePath, "utf8");
			const patched = patchSource(source);
			if (patched === source) continue;
			writeFileSync(filePath, patched, "utf8");
			changed = true;
		}
	}
	return changed;
}

function patchBundledPiRuntimeCorrectness() {
	for (const scope of ["@earendil-works", "@mariozechner"]) {
		for (const packageName of ["pi-agent-core", "pi-ai", "pi-coding-agent", "pi-tui"]) {
			assertPiPackageVersion(
				resolve(workspaceNodeModulesDir, scope, packageName),
				`runtime workspace ${scope}/${packageName}`,
			);
		}
		for (const nestedScope of ["@earendil-works", "@mariozechner"]) {
			for (const packageName of ["pi-agent-core", "pi-ai", "pi-tui"]) {
				assertPiPackageVersion(
					resolve(
						workspaceNodeModulesDir,
						scope,
						"pi-coding-agent",
						"node_modules",
						nestedScope,
						packageName,
					),
					`runtime workspace nested ${scope}/pi-coding-agent ${nestedScope}/${packageName}`,
				);
			}
		}
	}
	let changed = false;
	changed = patchScopedPiWorkspaceFile(
		"pi-coding-agent",
		"dist/core/agent-session.js",
		patchPiAgentSessionSource,
	) || changed;
	changed = patchScopedPiWorkspaceFile(
		"pi-coding-agent",
		"dist/core/session-manager.js",
		patchPiSessionManagerSource,
	) || changed;
	changed = patchScopedPiWorkspaceFile(
		"pi-ai",
		"dist/api/transform-messages.js",
		patchPiTransformMessagesSource,
	) || changed;
	changed = patchBundledNestedPiAiFile(
		"dist/api/transform-messages.js",
		patchPiTransformMessagesSource,
	) || changed;
	changed = patchScopedPiWorkspaceFile(
		"pi-ai",
		"dist/auth/oauth/device-code.js",
		patchPiGithubCopilotDeviceCodeSource,
	) || changed;
	changed = patchBundledNestedPiAiFile(
		"dist/auth/oauth/device-code.js",
		patchPiGithubCopilotDeviceCodeSource,
	) || changed;
	changed = patchScopedPiWorkspaceFile(
		"pi-ai",
		"dist/auth/oauth/github-copilot.js",
		patchPiGithubCopilotOAuthSource,
	) || changed;
	changed = patchBundledNestedPiAiFile(
		"dist/auth/oauth/github-copilot.js",
		patchPiGithubCopilotOAuthSource,
	) || changed;
	for (const relativePath of PI_AI_FORWARD_FIX_TARGETS) {
		changed = patchScopedPiWorkspaceFile(
			"pi-ai",
			relativePath,
			(source) => patchPiAiForwardFixSource(relativePath, source),
		) || changed;
		changed = patchBundledNestedPiAiFile(
			relativePath,
			(source) => patchPiAiForwardFixSource(relativePath, source),
		) || changed;
	}
	for (const relativePath of PI_CODING_AGENT_FORWARD_FIX_TARGETS) {
		changed = patchScopedPiWorkspaceFile(
			"pi-coding-agent",
			relativePath,
			(source) => patchPiCodingAgentForwardFixSource(relativePath, source),
		) || changed;
	}
	for (const relativePath of PI_COMPACTION_TOOLS_PATCH_TARGETS) {
		changed = patchScopedPiWorkspaceFile(
			"pi-coding-agent",
			relativePath,
			(source) => patchPiCompactionToolsSource(relativePath, source),
		) || changed;
	}
	return changed;
}

function patchBundledPiExtensionHandlerTimeout() {
	const candidates = [];
	for (const scope of ["@earendil-works", "@mariozechner"]) {
		const packageRoot = resolve(
			workspaceNodeModulesDir,
			scope,
			"pi-coding-agent",
		);
		if (!existsSync(packageRoot)) continue;
		const version = JSON.parse(
			readFileSync(resolve(packageRoot, "package.json"), "utf8"),
		).version;
		assertPiExtensionHandlerTimeoutVersion(
			version,
			`runtime workspace ${scope}/pi-coding-agent`,
		);
		const path = resolve(
			packageRoot,
			...PI_EXTENSION_HANDLER_TIMEOUT_TARGET.split("/"),
		);
		if (!existsSync(path)) {
			throw new Error(`Pi extension handler timeout target is missing: ${path}`);
		}
		const source = readFileSync(path, "utf8");
		candidates.push({
			path,
			source,
			patched: patchPiExtensionHandlerTimeoutSource(source, version),
		});
	}

	let changed = false;
	for (const candidate of candidates) {
		if (candidate.patched === candidate.source) continue;
		writeFileSync(candidate.path, candidate.patched, "utf8");
		changed = true;
	}
	return changed;
}

function patchBundledPiEditLineEndings() {
	let changed = false;
	for (const scope of ["@earendil-works", "@mariozechner"]) {
		const packageRoot = resolve(workspaceNodeModulesDir, scope, "pi-coding-agent");
		if (!existsSync(packageRoot)) continue;
		const version = JSON.parse(
			readFileSync(resolve(packageRoot, "package.json"), "utf8"),
		).version;
		assertPiEditLineEndingsVersion(version, `runtime workspace ${scope}/pi-coding-agent`);
		for (const relativePath of PI_EDIT_LINE_ENDINGS_RUNTIME_TARGETS) {
			changed = patchScopedPiWorkspaceFile(
				"pi-coding-agent",
				relativePath,
				(source) => patchPiEditLineEndingsSource(relativePath, source),
			) || changed;
		}
		break;
	}
	return changed;
}

function patchBundledPiLlamaUsage() {
	return patchScopedPiWorkspaceFile(
		"pi-coding-agent",
		"dist/extensions/llama/provider.js",
		patchPiLlamaUsageSource,
	);
}

function patchBundledPiTui() {
	let changed = false;
	changed = patchScopedPiWorkspaceFile("pi-tui", "dist/tui.js", patchPiTuiSource) || changed;
	changed = patchScopedPiWorkspaceFile("pi-tui", "dist/tui-main-screen.js", patchPiTuiSource) || changed;
	changed = patchNestedPiWorkspaceFile(
		"pi-coding-agent",
		"pi-tui",
		"dist/tui.js",
		patchPiTuiSource,
	) || changed;
	changed = patchNestedPiWorkspaceFile(
		"pi-coding-agent",
		"pi-tui",
		"dist/tui-main-screen.js",
		patchPiTuiSource,
	) || changed;
	changed = patchScopedPiWorkspaceFile("pi-tui", "dist/components/editor.js", patchPiEditorSource) || changed;
	changed = patchNestedPiWorkspaceFile(
		"pi-coding-agent",
		"pi-tui",
		"dist/components/editor.js",
		patchPiEditorSource,
	) || changed;
	return changed;
}

function patchBundledPiExtensionLoader() {
	return patchScopedPiWorkspaceFile("pi-coding-agent", "dist/core/extensions/loader.js", patchPiExtensionLoaderSource);
}

function patchBundledPiModelRuntime() {
	let changed = false;
	changed = patchScopedPiWorkspaceFile("pi-coding-agent", "dist/core/model-registry.js", patchPiModelRegistrySource) || changed;
	changed = patchScopedPiWorkspaceFile("pi-coding-agent", "dist/core/model-runtime.js", patchPiModelRegistrySource) || changed;
	return changed;
}

function patchBundledPiStateFilePermissions() {
	return patchScopedPiWorkspaceFile(
		"pi-coding-agent",
		"dist/core/auth-storage.js",
		patchPiStateFilePermissionsSource,
	);
}

function patchBundledPiInteractiveTheme() {
	return patchScopedPiWorkspaceFile("pi-coding-agent", "dist/modes/interactive/theme/theme.js", patchPiInteractiveThemeSource);
}

function patchBundledPiInteractiveUpdateNotice() {
	return patchScopedPiWorkspaceFile(
		"pi-coding-agent",
		"dist/modes/interactive/interactive-mode.js",
		patchPiInteractiveUpdateNoticeSource,
	);
}

function patchBundledPiWebAccess() {
	const piWebAccessRoot = resolve(workspaceNodeModulesDir, "pi-web-access");
	if (!existsSync(piWebAccessRoot)) {
		return false;
	}
	const manifestPath = resolve(piWebAccessRoot, "package.json");
	const version = existsSync(manifestPath)
		? JSON.parse(readFileSync(manifestPath, "utf8")).version
		: undefined;
	assertPiWebAccessVersion(version, "bundled runtime workspace");
	let changed = syncPiWebAccessForwardFiles(appRoot, piWebAccessRoot, version);

	const sources = new Map();
	for (const relativePath of PI_WEB_ACCESS_PATCH_TARGETS) {
		const entryPath = resolve(piWebAccessRoot, relativePath);
		if (!existsSync(entryPath)) {
			throw new Error(`pi-web-access patch target is missing: ${relativePath}`);
		}
		sources.set(relativePath, readFileSync(entryPath, "utf8"));
	}
	const patchedSources = patchPiWebAccessSources(sources, "bundled runtime workspace");
	for (const [relativePath, patched] of patchedSources) {
		const source = sources.get(relativePath);
		if (patched === source) continue;
		writeFileSync(resolve(piWebAccessRoot, relativePath), patched, "utf8");
		changed = true;
	}
	return changed;
}

function patchBundledPiSessionSearch() {
	const sessionSearchRoot = resolve(workspaceNodeModulesDir, "@kaiserlich-dev", "pi-session-search");
	if (!existsSync(sessionSearchRoot)) {
		return false;
	}

	let changed = false;
	for (const relativePath of PI_SESSION_SEARCH_PATCH_TARGETS) {
		const entryPath = resolve(sessionSearchRoot, relativePath);
		if (!existsSync(entryPath)) continue;

		const source = readFileSync(entryPath, "utf8");
		const patched = patchPiSessionSearchSource(relativePath, source);
		if (patched === source) continue;
		writeFileSync(entryPath, patched, "utf8");
		changed = true;
	}
	return changed;
}

function patchBundledPiDocparser() {
	const packageRoot = resolve(workspaceNodeModulesDir, "pi-docparser");
	if (!existsSync(packageRoot)) return false;
	const version = JSON.parse(
		readFileSync(resolve(packageRoot, "package.json"), "utf8"),
	).version;
	assertPiDocparserInvisibleTextVersion(version, "bundled runtime workspace");
	let changed = false;
	for (const relativePath of PI_DOCPARSER_INVISIBLE_TEXT_PATCH_TARGETS) {
		const entryPath = resolve(packageRoot, ...relativePath.split("/"));
		if (!existsSync(entryPath)) {
			throw new Error(`pi-docparser invisible-text patch target is missing: ${entryPath}`);
		}
		const source = readFileSync(entryPath, "utf8");
		const patched = patchPiDocparserInvisibleTextSource(relativePath, source);
		if (patched === source) continue;
		writeFileSync(entryPath, patched, "utf8");
		changed = true;
	}
	return changed;
}

function patchBundledAlphaHub() {
	const alphaHubLib = resolve(
		workspaceNodeModulesDir,
		"@companion-ai",
		"alpha-hub",
		"src",
		"lib",
	);
	const patchTargets = [
		["auth.js", patchAlphaHubAuthSource],
		["alphaxiv.js", patchAlphaHubSearchSource],
		["index.js", patchAlphaHubSearchResultsSource],
	];
	if (!patchTargets.some(([fileName]) => existsSync(resolve(alphaHubLib, fileName)))) {
		return false;
	}

	let changed = false;
	for (const [fileName, patchSource] of patchTargets) {
		const filePath = resolve(alphaHubLib, fileName);
		if (!existsSync(filePath)) continue;
		const source = readFileSync(filePath, "utf8");
		const patched = patchSource(source);
		if (patched !== source) {
			writeFileSync(filePath, patched, "utf8");
			changed = true;
		}
	}
	return changed;
}

function patchMcpSdkManifest(nodeModulesDir) {
	const manifestPath = resolve(nodeModulesDir, "@modelcontextprotocol", "sdk", "package.json");
	if (!existsSync(manifestPath)) {
		throw new Error(`Required @modelcontextprotocol/sdk manifest not found: ${manifestPath}`);
	}
	const source = readFileSync(manifestPath, "utf8");
	const patched = patchMcpSdkPackageJsonSource(source);
	if (patched === source) {
		return false;
	}
	writeFileSync(manifestPath, patched, "utf8");
	return true;
}

function removeGeneratedHiddenRuntimeLock() {
	const hiddenLockPath = resolve(workspaceNodeModulesDir, ".package-lock.json");
	if (!existsSync(hiddenLockPath)) return false;
	// npm's hidden lock describes the bytes produced by npm ci. Feynman then
	// applies reviewed package-tree repairs (including nested Undici upgrades),
	// so retaining that pre-patch metadata makes npm ls report a false graph.
	rmSync(hiddenLockPath, { force: true });
	return true;
}

function patchBundledRuntime(
	piCliArgsCandidates = collectBundledPiCliArgsCandidates(),
) {
	const piBtwRoot = resolve(workspaceNodeModulesDir, "pi-btw");
	const researchPackagePatchPlans = [
		preflightPackageRootPatch({
			packageRoot: piBtwRoot,
			packageName: "pi-btw",
			requiredVersion: PI_BTW_MODEL_RUNTIME_REQUIRED_VERSION,
			targets: PI_BTW_MODEL_RUNTIME_PATCH_TARGETS,
			patchSource: patchPiBtwModelRuntimeSource,
		}),
		preflightPiOtelPackageRoot(
			resolve(workspaceNodeModulesDir, "pi-otel"),
		),
	];
	let changed = applyPackageRootPatchPlans(researchPackagePatchPlans);
	// Fail closed on every matching Pi parser before any runtime patch writes.
	// This keeps a malformed secondary package from leaving a partially patched
	// fallback candidate.
	changed = patchBundledPiCliArgs(piCliArgsCandidates) || changed;
	changed = patchBundledPiCodingAgentPackageJson() || changed;
	changed = patchBundledPiAgentCore() || changed;
	changed = patchBundledPiRuntimeCorrectness() || changed;
	changed = patchBundledPiExtensionHandlerTimeout() || changed;
	changed = patchBundledPiEditLineEndings() || changed;
	changed = patchBundledPiLlamaUsage() || changed;
	changed = patchBundledPiExtensionLoader() || changed;
	changed = patchBundledPiStateFilePermissions() || changed;
	changed = patchBundledPiModelRuntime() || changed;
	changed = patchPiBraceExpansionTree(
		workspaceNodeModulesDir,
		resolve(appRoot, "node_modules", "brace-expansion"),
	) || changed;
	changed = patchPiUndiciProxyTree(
		workspaceNodeModulesDir,
		resolve(appRoot, "node_modules", "undici"),
		PI_RUNTIME_CORRECTNESS_REQUIRED_VERSION,
	) || changed;
	changed = patchBundledPiInteractiveTheme() || changed;
	changed = patchBundledPiInteractiveUpdateNotice() || changed;
	changed = patchBundledPiTui() || changed;
	changed = patchBundledPiWebAccess() || changed;
	changed = patchBundledPiSubagents() || changed;
	changed = patchBundledPiSessionSearch() || changed;
	changed = patchBundledPiDocparser() || changed;
	changed = patchBundledAlphaHub() || changed;
	changed = patchMcpSdkManifest(workspaceNodeModulesDir) || changed;
	changed = removeGeneratedHiddenRuntimeLock() || changed;
	return changed;
}

function archiveIsCurrent(packageSpecs) {
	return runtimeArchiveMatches({
		archivePath: workspaceArchivePath,
		digestPath: workspaceArchiveDigestPath,
		lockPath: runtimePackageLockPath,
		manifestPath,
		packageSpecs,
		runtimeInputHash: getRuntimeInputHash(),
	});
}

async function createWorkspaceArchive(packageSpecs) {
	rmSync(workspaceArchivePath, { force: true });
	const workspaceTreeHash = computeRuntimeTreeHash(workspaceDir);
	writeManifest(packageSpecs, workspaceTreeHash);
	await createDeterministicTarGz(workspaceDir, workspaceArchivePath);
	const archiveTreeHash = computeRuntimeArchiveTreeHash(workspaceArchivePath);
	if (archiveTreeHash !== workspaceTreeHash) {
		// Windows tar can encode NTFS links differently from lstat(). Keep both
		// logical hashes so source freshness and the shipped archive are each
		// verified against the representation that users actually consume.
		writeManifest(packageSpecs, archiveTreeHash);
		rmSync(workspaceArchivePath, { force: true });
		await createDeterministicTarGz(workspaceDir, workspaceArchivePath);
		const rebuiltArchiveTreeHash = computeRuntimeArchiveTreeHash(workspaceArchivePath);
		if (rebuiltArchiveTreeHash !== archiveTreeHash) {
			throw new Error(
				`Runtime archive tree changed while recording its manifest: ${archiveTreeHash} -> ${rebuiltArchiveTreeHash}`,
			);
		}
	}
	writeFileSha256(workspaceArchivePath, workspaceArchiveDigestPath);
}

const packageSpecs = readPackageSpecs();
const refreshRuntimeLock = process.argv.includes("--refresh-lock");
const rebuildWorkspace = process.argv.includes("--rebuild");
const patchExistingWorkspace = process.argv.includes("--patch-existing");

function patchRootRuntimeDependencies() {
	patchMcpSdkManifest(resolve(appRoot, "node_modules"));
	patchPiBraceExpansionTree(
		resolve(appRoot, "node_modules"),
		resolve(appRoot, "node_modules", "brace-expansion"),
	);
	patchPiUndiciProxyTree(
		resolve(appRoot, "node_modules"),
		resolve(appRoot, "node_modules", "undici"),
		PI_RUNTIME_CORRECTNESS_REQUIRED_VERSION,
	);
}

if (patchExistingWorkspace) {
	if (!explicitWorkspaceDir || !existsSync(workspaceNodeModulesDir)) {
		throw new Error(
			"--patch-existing requires FEYNMAN_RUNTIME_WORKSPACE_TARGET with an installed node_modules tree",
		);
	}
	if (!workspacePackagesMatch(workspaceNodeModulesDir, packageSpecs)) {
		throw new Error(
			"Existing runtime workspace does not match Feynman's exact package contract",
		);
	}
	const piCliArgsCandidates = collectBundledPiCliArgsCandidates();
	linkLegacyPiRuntimeAliases();
	patchBundledRuntime(piCliArgsCandidates);
	writeManifest(packageSpecs);
	process.exit(0);
}

if (!refreshRuntimeLock && !rebuildWorkspace && workspaceIsCurrent(packageSpecs)) {
	const piCliArgsCandidates = collectBundledPiCliArgsCandidates();
	patchRootRuntimeDependencies();
	console.log("[feynman] vendored runtime workspace already up to date");
	linkLegacyPiRuntimeAliases();
	if (patchBundledRuntime(piCliArgsCandidates)) {
		writeManifest(packageSpecs);
		console.log("[feynman] patched bundled Pi runtime");
	}
	if (archiveIsCurrent(packageSpecs)) {
		process.exit(0);
	}
	console.log("[feynman] refreshing runtime workspace archive...");
	await createWorkspaceArchive(packageSpecs);
	console.log("[feynman] runtime workspace archive ready");
	process.exit(0);
}

console.log("[feynman] preparing vendored runtime workspace...");
prepareWorkspace(packageSpecs, refreshRuntimeLock);
const piCliArgsCandidates = collectBundledPiCliArgsCandidates();
patchRootRuntimeDependencies();
pruneWorkspace();
linkLegacyPiRuntimeAliases();
patchBundledRuntime(piCliArgsCandidates);
if (refreshRuntimeLock) {
	cpSync(resolve(workspaceDir, "package-lock.json"), runtimePackageLockPath);
	console.log("[feynman] refreshed committed runtime lock");
}
writeManifest(packageSpecs);
await createWorkspaceArchive(packageSpecs);
console.log("[feynman] vendored runtime workspace ready");
