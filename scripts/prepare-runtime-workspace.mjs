import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";

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
import { patchPiModelRegistrySource } from "./lib/pi-model-registry-patch.mjs";
import { patchPiUndiciProxyTree } from "./lib/pi-undici-proxy-patch.mjs";
import { patchPiBraceExpansionTree } from "./lib/pi-shrinkwrap-security-patch.mjs";
import {
	patchPiEditorSource,
	patchPiInteractiveThemeSource,
	patchPiInteractiveUpdateNoticeSource,
	patchPiTuiSource,
} from "./lib/pi-tui-patch.mjs";
import { PI_WEB_ACCESS_PATCH_TARGETS, patchPiWebAccessSource } from "./lib/pi-web-access-patch.mjs";
import { PI_SUBAGENTS_PATCH_TARGETS, patchPiSubagentsSource, stripPiSubagentBuiltinModelSource } from "./lib/pi-subagents-patch.mjs";
import { PI_OTEL_PATCH_TARGETS, patchPiOtelSource } from "./lib/pi-otel-patch.mjs";
import { PI_SESSION_SEARCH_PATCH_TARGETS, patchPiSessionSearchSource } from "./lib/pi-session-search-patch.mjs";
import { patchAlphaHubAskSource } from "./lib/alpha-hub-ask-patch.mjs";
import { patchAlphaHubAuthSource } from "./lib/alpha-hub-auth-patch.mjs";
import { patchAlphaHubSearchSource } from "./lib/alpha-hub-search-patch.mjs";
import { patchMcpSdkPackageJsonSource } from "./lib/mcp-sdk-package-patch.mjs";
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
const workspaceDir = resolve(appRoot, ".feynman", "npm");
const workspaceNodeModulesDir = resolve(workspaceDir, "node_modules");
const manifestPath = resolve(workspaceDir, ".runtime-manifest.json");
const workspacePackageJsonPath = resolve(workspaceDir, "package.json");
const workspaceNpmConfigPath = resolve(workspaceDir, ".npmrc");
const workspaceArchivePath = resolve(feynmanDir, "runtime-workspace.tgz");
const workspaceArchiveDigestPath = resolve(feynmanDir, "runtime-workspace.sha256");
const PRUNE_VERSION = 8;
const PI_RUNTIME_FALLBACK_VERSION = "0.83.0";
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
	"brace-expansion": "5.0.9",
	undici: "8.9.0",
};
const PINNED_RUNTIME_PACKAGES = [
	"@earendil-works/pi-agent-core",
	"@earendil-works/pi-ai",
	"@earendil-works/pi-coding-agent",
	"@earendil-works/pi-tui",
	"brace-expansion",
	"typebox",
	"undici",
];
const LEGACY_PI_RUNTIME_PACKAGE_ALIASES = {
	"@mariozechner/pi-agent-core": "@earendil-works/pi-agent-core",
	"@mariozechner/pi-ai": "@earendil-works/pi-ai",
	"@mariozechner/pi-coding-agent": "@earendil-works/pi-coding-agent",
	"@mariozechner/pi-tui": "@earendil-works/pi-tui",
};
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
		const version = readLockedPackageVersion(packageName);
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

function linkDirectory(linkPath, targetPath) {
	try {
		if (existsSync(linkPath) && lstatSync(linkPath).isSymbolicLink()) {
			if (resolve(dirname(linkPath), readlinkSync(linkPath)) === targetPath) {
				return;
			}
			rmSync(linkPath, { force: true });
		}
	} catch {}

	if (existsSync(linkPath)) {
		return;
	}

	mkdirSync(dirname(linkPath), { recursive: true });
	try {
		symlinkSync(relative(dirname(linkPath), targetPath), linkPath, process.platform === "win32" ? "junction" : "dir");
	} catch {
		if (!existsSync(linkPath)) {
			cpSync(targetPath, linkPath, { recursive: true });
		}
	}
}

function linkLegacyPiRuntimeAliases() {
	for (const [legacyName, currentName] of Object.entries(LEGACY_PI_RUNTIME_PACKAGE_ALIASES)) {
		const currentPath = resolve(workspaceNodeModulesDir, currentName);
		if (!existsSync(currentPath)) {
			continue;
		}
		linkDirectory(resolve(workspaceNodeModulesDir, legacyName), currentPath);
	}
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

function patchBundledNestedPiAiTransformMessages() {
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
				"dist",
				"api",
				"transform-messages.js",
			);
			if (!existsSync(filePath)) continue;
			const source = readFileSync(filePath, "utf8");
			const patched = patchPiTransformMessagesSource(source);
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
	changed = patchBundledNestedPiAiTransformMessages() || changed;
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
	changed = patchNestedPiWorkspaceFile(
		"pi-coding-agent",
		"pi-tui",
		"dist/tui.js",
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

	let changed = false;
	for (const relativePath of PI_WEB_ACCESS_PATCH_TARGETS) {
		const entryPath = resolve(piWebAccessRoot, relativePath);
		if (!existsSync(entryPath)) continue;

		const source = readFileSync(entryPath, "utf8");
		const patched = patchPiWebAccessSource(relativePath, source);
		if (patched === source) continue;
		writeFileSync(entryPath, patched, "utf8");
		changed = true;
	}
	return changed;
}

function patchBundledPiOtel() {
	const piOtelRoot = resolve(workspaceNodeModulesDir, "pi-otel");
	if (!existsSync(piOtelRoot)) {
		return false;
	}

	let changed = false;
	for (const relativePath of PI_OTEL_PATCH_TARGETS) {
		const entryPath = resolve(piOtelRoot, relativePath);
		if (!existsSync(entryPath)) continue;

		const source = readFileSync(entryPath, "utf8");
		const patched = patchPiOtelSource(relativePath, source);
		if (patched === source) continue;
		writeFileSync(entryPath, patched, "utf8");
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

function patchBundledAlphaHub() {
	const authPath = resolve(workspaceNodeModulesDir, "@companion-ai", "alpha-hub", "src", "lib", "auth.js");
	const alphaxivPath = resolve(workspaceNodeModulesDir, "@companion-ai", "alpha-hub", "src", "lib", "alphaxiv.js");
	if (!existsSync(authPath) && !existsSync(alphaxivPath)) {
		return false;
	}

	let changed = false;
	if (existsSync(authPath)) {
		const source = readFileSync(authPath, "utf8");
		const patched = patchAlphaHubAuthSource(source);
		if (patched !== source) {
			writeFileSync(authPath, patched, "utf8");
			changed = true;
		}
	}
	if (existsSync(alphaxivPath)) {
		const source = readFileSync(alphaxivPath, "utf8");
		const patched = patchAlphaHubAskSource(patchAlphaHubSearchSource(source));
		if (patched !== source) {
			writeFileSync(alphaxivPath, patched, "utf8");
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

function patchBundledRuntime() {
	let changed = false;
	changed = patchBundledPiCodingAgentPackageJson() || changed;
	changed = patchBundledPiAgentCore() || changed;
	changed = patchBundledPiRuntimeCorrectness() || changed;
	changed = patchBundledPiLlamaUsage() || changed;
	changed = patchBundledPiExtensionLoader() || changed;
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
	changed = patchBundledPiOtel() || changed;
	changed = patchBundledPiSessionSearch() || changed;
	changed = patchBundledAlphaHub() || changed;
	changed = patchMcpSdkManifest(workspaceNodeModulesDir) || changed;
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
const packageSpecs = readPackageSpecs();
const refreshRuntimeLock = process.argv.includes("--refresh-lock");
const rebuildWorkspace = process.argv.includes("--rebuild");

if (!refreshRuntimeLock && !rebuildWorkspace && workspaceIsCurrent(packageSpecs)) {
	console.log("[feynman] vendored runtime workspace already up to date");
	linkLegacyPiRuntimeAliases();
	if (patchBundledRuntime()) {
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
pruneWorkspace();
linkLegacyPiRuntimeAliases();
patchBundledRuntime();
if (refreshRuntimeLock) {
	cpSync(resolve(workspaceDir, "package-lock.json"), runtimePackageLockPath);
	console.log("[feynman] refreshed committed runtime lock");
}
writeManifest(packageSpecs);
await createWorkspaceArchive(packageSpecs);
console.log("[feynman] vendored runtime workspace ready");
