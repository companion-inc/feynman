import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { patchAlphaHubAskSource } from "../../scripts/lib/alpha-hub-ask-patch.mjs";
import { patchAlphaHubAuthSource } from "../../scripts/lib/alpha-hub-auth-patch.mjs";
import { patchAlphaHubSearchResultsSource, patchAlphaHubSearchSource } from "../../scripts/lib/alpha-hub-search-patch.mjs";
import { patchMcpSdkPackageJsonSource } from "../../scripts/lib/mcp-sdk-package-patch.mjs";
import { patchPiAgentCoreSource } from "../../scripts/lib/pi-agent-core-patch.mjs";
import {
	assertPiRuntimeCorrectnessVersion,
	patchPiAgentSessionSource,
	patchPiSessionManagerSource,
	patchPiTransformMessagesSource,
} from "../../scripts/lib/pi-runtime-correctness-patch.mjs";
import { patchPiLlamaUsageSource } from "../../scripts/lib/pi-llama-usage-patch.mjs";
import { patchPiModelRegistrySource } from "../../scripts/lib/pi-model-registry-patch.mjs";
import { patchPiBraceExpansionTree } from "../../scripts/lib/pi-shrinkwrap-security-patch.mjs";
import { patchPiUndiciProxyTree } from "../../scripts/lib/pi-undici-proxy-patch.mjs";
import { PI_OTEL_PATCH_TARGETS, patchPiOtelSource } from "../../scripts/lib/pi-otel-patch.mjs";
import { PI_SESSION_SEARCH_PATCH_TARGETS, patchPiSessionSearchSource } from "../../scripts/lib/pi-session-search-patch.mjs";
import { PI_SUBAGENTS_PATCH_TARGETS, patchPiSubagentsSource } from "../../scripts/lib/pi-subagents-patch.mjs";
import {
	patchPiEditorSource,
	patchPiInteractiveThemeSource,
	patchPiInteractiveUpdateNoticeSource,
	patchPiTuiSource,
} from "../../scripts/lib/pi-tui-patch.mjs";
import { PI_WEB_ACCESS_PATCH_TARGETS, patchPiWebAccessSource } from "../../scripts/lib/pi-web-access-patch.mjs";

function patchFileIfPresent(path: string, patchSource: (source: string) => string): boolean {
	if (!existsSync(path)) {
		return false;
	}
	const source = readFileSync(path, "utf8");
	const patched = patchSource(source);
	if (patched === source) {
		return false;
	}
	writeFileSync(path, patched, "utf8");
	return true;
}

function patchPackageFiles(
	nodeModulesPath: string,
	packageName: string,
	relativePaths: string[],
	patchSource: (relativePath: string, source: string) => string,
): boolean {
	let changed = false;
	for (const relativePath of relativePaths) {
		changed = patchFileIfPresent(
			resolve(nodeModulesPath, ...packageName.split("/"), ...relativePath.split("/")),
			(source) => patchSource(relativePath, source),
		) || changed;
	}
	return changed;
}

function readPackageVersion(packageRoot: string): string | undefined {
	const packageJsonPath = resolve(packageRoot, "package.json");
	if (!existsSync(packageJsonPath)) {
		return undefined;
	}
	try {
		const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { version?: unknown };
		return typeof pkg.version === "string" && pkg.version.length > 0 ? pkg.version : undefined;
	} catch {
		return undefined;
	}
}

function resolveBundledPiVersion(appRoot: string): string | undefined {
	let fallbackVersion: string | undefined;
	for (const nodeModulesPath of [
		resolve(appRoot, "node_modules"),
		resolve(appRoot, ".feynman", "npm", "node_modules"),
	]) {
		for (const scope of ["@earendil-works", "@mariozechner"]) {
			const packageRoot = resolve(nodeModulesPath, scope, "pi-coding-agent");
			const version = readPackageVersion(packageRoot);
			if (version) {
				fallbackVersion ??= version;
				if (existsSync(resolve(packageRoot, "dist", "cli.js"))) {
					return version;
				}
			}
		}
	}
	return fallbackVersion;
}

function shouldPatchPiPackage(packageRoot: string, bundledPiVersion: string | undefined): boolean {
	if (!existsSync(packageRoot) || !bundledPiVersion) {
		return false;
	}
	const installedVersion = readPackageVersion(packageRoot);
	return installedVersion === bundledPiVersion;
}

function patchScopedPiPackageFileIfPresent(
	nodeModulesPath: string,
	packageName: string,
	relativePath: string,
	patchSource: (source: string) => string,
	bundledPiVersion: string | undefined,
): boolean {
	let changed = false;
	for (const scope of ["@earendil-works", "@mariozechner"]) {
		const packageRoot = resolve(nodeModulesPath, scope, packageName);
		if (!shouldPatchPiPackage(packageRoot, bundledPiVersion)) {
			continue;
		}
		changed = patchFileIfPresent(
			resolve(packageRoot, ...relativePath.split("/")),
			patchSource,
		) || changed;
	}
	return changed;
}

function patchNestedPiPackageFileIfPresent(
	nodeModulesPath: string,
	parentPackageName: string,
	nestedPackageName: string,
	relativePath: string,
	patchSource: (source: string) => string,
	bundledPiVersion: string | undefined,
): boolean {
	let changed = false;
	for (const parentScope of ["@earendil-works", "@mariozechner"]) {
		const parentRoot = resolve(nodeModulesPath, parentScope, parentPackageName);
		if (!shouldPatchPiPackage(parentRoot, bundledPiVersion)) continue;
		for (const nestedScope of ["@earendil-works", "@mariozechner"]) {
			const nestedRoot = resolve(parentRoot, "node_modules", nestedScope, nestedPackageName);
			if (!shouldPatchPiPackage(nestedRoot, bundledPiVersion)) continue;
			changed = patchFileIfPresent(
				resolve(nestedRoot, ...relativePath.split("/")),
				patchSource,
			) || changed;
		}
	}
	return changed;
}

function patchPiCodingAgentPackageJsonSource(source: string): string {
	const pkg = JSON.parse(source) as {
		piConfig?: Record<string, unknown>;
		[key: string]: unknown;
	};
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

export function patchPiRuntimeNodeModules(appRoot: string, feynmanAgentDir?: string): boolean {
	const bundledPiVersion = resolveBundledPiVersion(appRoot);
	if (bundledPiVersion) {
		assertPiRuntimeCorrectnessVersion(bundledPiVersion, "bundled pi-coding-agent");
	}
	const nodeModuleRoots = [
		resolve(appRoot, "node_modules"),
		resolve(appRoot, ".feynman", "npm", "node_modules"),
	];
	if (feynmanAgentDir) {
		// Pi resolves user-scope packages from Feynman's pinned npm prefix. When
		// that copy is a real directory (junction-creation fallback or a
		// `feynman update` reinstall) instead of a link into the bundled
		// workspace, it must be patched too or unpatched sources execute.
		nodeModuleRoots.push(resolve(dirname(feynmanAgentDir), "npm-global", "lib", "node_modules"));
		// Pi's own package manager installs into <agentDir>/npm since Pi 0.75;
		// a startup self-install lands fresh unpatched sources there.
		nodeModuleRoots.push(resolve(feynmanAgentDir, "npm", "node_modules"));
	}
	let changed = false;
	const safeBraceExpansionPath = resolve(appRoot, "node_modules", "brace-expansion");
	for (const nodeModulesPath of nodeModuleRoots) {
		changed = patchPiBraceExpansionTree(nodeModulesPath, safeBraceExpansionPath) || changed;
		changed = patchPiUndiciProxyTree(
			nodeModulesPath,
			resolve(appRoot, "node_modules", "undici"),
			bundledPiVersion,
		) || changed;
		changed = patchScopedPiPackageFileIfPresent(
			nodeModulesPath,
			"pi-coding-agent",
			"package.json",
			patchPiCodingAgentPackageJsonSource,
			bundledPiVersion,
		) || changed;
		changed = patchScopedPiPackageFileIfPresent(
			nodeModulesPath,
			"pi-agent-core",
			"dist/agent-loop.js",
			patchPiAgentCoreSource,
			bundledPiVersion,
		) || changed;
		changed = patchNestedPiPackageFileIfPresent(
			nodeModulesPath,
			"pi-coding-agent",
			"pi-agent-core",
			"dist/agent-loop.js",
			patchPiAgentCoreSource,
			bundledPiVersion,
		) || changed;
		changed = patchScopedPiPackageFileIfPresent(
			nodeModulesPath,
			"pi-coding-agent",
			"dist/core/agent-session.js",
			patchPiAgentSessionSource,
			bundledPiVersion,
		) || changed;
		changed = patchScopedPiPackageFileIfPresent(
			nodeModulesPath,
			"pi-coding-agent",
			"dist/core/session-manager.js",
			patchPiSessionManagerSource,
			bundledPiVersion,
		) || changed;
		changed = patchScopedPiPackageFileIfPresent(
			nodeModulesPath,
			"pi-coding-agent",
			"dist/extensions/llama/provider.js",
			patchPiLlamaUsageSource,
			bundledPiVersion,
		) || changed;
		changed = patchScopedPiPackageFileIfPresent(
			nodeModulesPath,
			"pi-ai",
			"dist/api/transform-messages.js",
			patchPiTransformMessagesSource,
			bundledPiVersion,
		) || changed;
		changed = patchNestedPiPackageFileIfPresent(
			nodeModulesPath,
			"pi-coding-agent",
			"pi-ai",
			"dist/api/transform-messages.js",
			patchPiTransformMessagesSource,
			bundledPiVersion,
		) || changed;
		changed = patchScopedPiPackageFileIfPresent(
			nodeModulesPath,
			"pi-tui",
			"dist/tui.js",
			patchPiTuiSource,
			bundledPiVersion,
		) || changed;
		changed = patchNestedPiPackageFileIfPresent(
			nodeModulesPath,
			"pi-coding-agent",
			"pi-tui",
			"dist/tui.js",
			patchPiTuiSource,
			bundledPiVersion,
		) || changed;
		changed = patchScopedPiPackageFileIfPresent(
			nodeModulesPath,
			"pi-tui",
			"dist/components/editor.js",
			patchPiEditorSource,
			bundledPiVersion,
		) || changed;
		changed = patchNestedPiPackageFileIfPresent(
			nodeModulesPath,
			"pi-coding-agent",
			"pi-tui",
			"dist/components/editor.js",
			patchPiEditorSource,
			bundledPiVersion,
		) || changed;
		changed = patchScopedPiPackageFileIfPresent(
			nodeModulesPath,
			"pi-coding-agent",
			"dist/modes/interactive/theme/theme.js",
			patchPiInteractiveThemeSource,
			bundledPiVersion,
		) || changed;
		changed = patchScopedPiPackageFileIfPresent(
			nodeModulesPath,
			"pi-coding-agent",
			"dist/modes/interactive/interactive-mode.js",
			patchPiInteractiveUpdateNoticeSource,
			bundledPiVersion,
		) || changed;
		changed = patchScopedPiPackageFileIfPresent(
			nodeModulesPath,
			"pi-coding-agent",
			"dist/core/model-registry.js",
			patchPiModelRegistrySource,
			bundledPiVersion,
		) || changed;
		changed = patchScopedPiPackageFileIfPresent(
			nodeModulesPath,
			"pi-coding-agent",
			"dist/core/model-runtime.js",
			patchPiModelRegistrySource,
			bundledPiVersion,
		) || changed;
		changed = patchFileIfPresent(
			resolve(nodeModulesPath, "@modelcontextprotocol", "sdk", "package.json"),
			patchMcpSdkPackageJsonSource,
		) || changed;
		changed = patchFileIfPresent(
			resolve(nodeModulesPath, "@companion-ai", "alpha-hub", "node_modules", "@modelcontextprotocol", "sdk", "package.json"),
			patchMcpSdkPackageJsonSource,
		) || changed;
		changed = patchFileIfPresent(
			resolve(nodeModulesPath, "@companion-ai", "alpha-hub", "src", "lib", "auth.js"),
			patchAlphaHubAuthSource,
		) || changed;
		changed = patchFileIfPresent(
			resolve(nodeModulesPath, "@companion-ai", "alpha-hub", "src", "lib", "alphaxiv.js"),
			(source) => patchAlphaHubAskSource(patchAlphaHubSearchSource(source)),
		) || changed;
		changed = patchFileIfPresent(
			resolve(nodeModulesPath, "@companion-ai", "alpha-hub", "src", "lib", "index.js"),
			patchAlphaHubSearchResultsSource,
		) || changed;
		changed = patchPackageFiles(
			nodeModulesPath,
			"pi-web-access",
			PI_WEB_ACCESS_PATCH_TARGETS,
			patchPiWebAccessSource,
		) || changed;
		changed = patchPackageFiles(
			nodeModulesPath,
			"pi-subagents",
			PI_SUBAGENTS_PATCH_TARGETS,
			patchPiSubagentsSource,
		) || changed;
		changed = patchPackageFiles(
			nodeModulesPath,
			"pi-otel",
			PI_OTEL_PATCH_TARGETS,
			patchPiOtelSource,
		) || changed;
		changed = patchPackageFiles(
			nodeModulesPath,
			"@kaiserlich-dev/pi-session-search",
			PI_SESSION_SEARCH_PATCH_TARGETS,
			patchPiSessionSearchSource,
		) || changed;
	}
	return changed;
}
