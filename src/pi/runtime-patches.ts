import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { patchAlphaHubAuthSource } from "../../scripts/lib/alpha-hub-auth-patch.mjs";
import { patchAlphaHubSearchResultsSource, patchAlphaHubSearchSource } from "../../scripts/lib/alpha-hub-search-patch.mjs";
import { patchMcpSdkPackageJsonSource } from "../../scripts/lib/mcp-sdk-package-patch.mjs";
import { patchPiAgentCoreSource } from "../../scripts/lib/pi-agent-core-patch.mjs";
import {
	assertPiCliArgsVersion,
	patchPiCliArgsSource,
} from "../../scripts/lib/pi-cli-args-patch.mjs";
import {
	PI_EDIT_LINE_ENDINGS_PATCH_TARGETS,
	patchPiEditLineEndingsSource,
} from "../../scripts/lib/pi-edit-line-endings-patch.mjs";
import {
	assertPiDocparserInvisibleTextVersion,
	PI_DOCPARSER_INVISIBLE_TEXT_PATCH_TARGETS,
	PI_DOCPARSER_INVISIBLE_TEXT_REQUIRED_VERSION,
	patchPiDocparserInvisibleTextSource,
} from "../../scripts/lib/pi-docparser-invisible-text-patch.mjs";
import {
	PI_AI_FORWARD_FIX_TARGETS,
	patchPiAiForwardFixSource,
} from "../../scripts/lib/pi-ai-forward-fixes-patch.mjs";
import {
	PI_COMPACTION_TOOLS_PATCH_TARGETS,
	patchPiCompactionToolsSource,
} from "../../scripts/lib/pi-compaction-tools-patch.mjs";
import {
	assertPiExtensionHandlerTimeoutVersion,
	PI_EXTENSION_HANDLER_TIMEOUT_TARGET,
	patchPiExtensionHandlerTimeoutSource,
} from "../../scripts/lib/pi-extension-handler-timeout-patch.mjs";
import {
	assertPiRuntimeCorrectnessVersion,
	PI_CODING_AGENT_FORWARD_FIX_TARGETS,
	patchPiCodingAgentForwardFixSource,
	patchPiAgentSessionSource,
	patchPiGithubCopilotDeviceCodeSource,
	patchPiGithubCopilotOAuthSource,
	patchPiSessionManagerSource,
	patchPiTransformMessagesSource,
} from "../../scripts/lib/pi-runtime-correctness-patch.mjs";
import { patchPiLlamaUsageSource } from "../../scripts/lib/pi-llama-usage-patch.mjs";
import { patchPiBtwModelRuntimePackageRoot } from "../../scripts/lib/pi-btw-model-runtime-patch.mjs";
import { patchPiModelRegistrySource } from "../../scripts/lib/pi-model-registry-patch.mjs";
import { patchPiStateFilePermissionsSource } from "../../scripts/lib/pi-state-file-permissions-patch.mjs";
import { patchPiBraceExpansionTree } from "../../scripts/lib/pi-shrinkwrap-security-patch.mjs";
import { patchPiUndiciProxyTree } from "../../scripts/lib/pi-undici-proxy-patch.mjs";
import { patchPiEsbuildPackageTree } from "../../scripts/lib/pi-esbuild-package-patch.mjs";
import { patchPiOtelPackageRoot } from "../../scripts/lib/pi-otel-patch.mjs";
import { PI_SESSION_SEARCH_PATCH_TARGETS, patchPiSessionSearchSource } from "../../scripts/lib/pi-session-search-patch.mjs";
import { PI_SUBAGENTS_PATCH_TARGETS, patchPiSubagentsSource } from "../../scripts/lib/pi-subagents-patch.mjs";
import {
	patchPiEditorSource,
	patchPiInteractiveThemeSource,
	patchPiInteractiveUpdateNoticeSource,
	patchPiTuiSource,
} from "../../scripts/lib/pi-tui-patch.mjs";
import {
	assertPiWebAccessVersion,
	PI_WEB_ACCESS_FORWARD_FILE_TARGETS,
	PI_WEB_ACCESS_PATCH_TARGETS,
	PI_WEB_ACCESS_REQUIRED_VERSION,
	patchPiWebAccessSources,
} from "../../scripts/lib/pi-web-access-patch.mjs";
import { getFeynmanNpmGlobalNodeModulesPath } from "./runtime.js";

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

function patchPiWebAccessPackageFiles(nodeModulesPath: string, appRoot: string): boolean {
	const packageRoot = resolve(nodeModulesPath, "pi-web-access");
	if (!existsSync(packageRoot)) {
		return false;
	}
	assertPiWebAccessVersion(readPackageVersion(packageRoot), packageRoot);

	const sources = new Map<string, string>();
	for (const relativePath of PI_WEB_ACCESS_PATCH_TARGETS) {
		const path = resolve(packageRoot, ...relativePath.split("/"));
		if (existsSync(path)) {
			sources.set(relativePath, readFileSync(path, "utf8"));
			continue;
		}
		if (PI_WEB_ACCESS_FORWARD_FILE_TARGETS.includes(relativePath)) {
			const fixturePath = resolve(
				appRoot,
				"fixtures",
				`pi-web-access-${PI_WEB_ACCESS_REQUIRED_VERSION}`,
				...relativePath.split("/"),
			);
			if (existsSync(fixturePath)) {
				sources.set(relativePath, readFileSync(fixturePath, "utf8"));
				continue;
			}
			throw new Error(`pi-web-access forward fixture is missing: ${fixturePath}`);
		} else {
			throw new Error(`pi-web-access patch target is missing: ${path}`);
		}
	}

	const patchedSources = patchPiWebAccessSources(sources, packageRoot);
	let changed = false;
	for (const [relativePath, patched] of patchedSources) {
		const source = sources.get(relativePath);
		const path = resolve(packageRoot, ...relativePath.split("/"));
		if (patched === source && existsSync(path)) continue;
		writeFileSync(path, patched, "utf8");
		changed = true;
	}
	return changed;
}

function patchPiDocparserPackageFiles(nodeModulesPath: string): boolean {
	const packageRoot = resolve(nodeModulesPath, "pi-docparser");
	if (!existsSync(packageRoot)) return false;
	const version = readPackageVersion(packageRoot);
	if (version !== PI_DOCPARSER_INVISIBLE_TEXT_REQUIRED_VERSION) return false;
	assertPiDocparserInvisibleTextVersion(version, packageRoot);
	return patchPackageFiles(
		nodeModulesPath,
		"pi-docparser",
		[...PI_DOCPARSER_INVISIBLE_TEXT_PATCH_TARGETS],
		patchPiDocparserInvisibleTextSource,
	);
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

export function patchPiRuntimeNodeModules(
	appRoot: string,
	feynmanAgentDir?: string,
	platform = process.platform,
): boolean {
	const bundledPiVersion = resolveBundledPiVersion(appRoot);
	if (bundledPiVersion) {
		assertPiRuntimeCorrectnessVersion(bundledPiVersion, "bundled pi-coding-agent");
		assertPiExtensionHandlerTimeoutVersion(
			bundledPiVersion,
			"bundled pi-coding-agent",
		);
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
		nodeModuleRoots.push(getFeynmanNpmGlobalNodeModulesPath(feynmanAgentDir, platform));
		// Pi's own package manager installs into <agentDir>/npm since Pi 0.75;
		// a startup self-install lands fresh unpatched sources there.
		nodeModuleRoots.push(resolve(feynmanAgentDir, "npm", "node_modules"));
	}
	const piCliArgsCandidates: Array<{
		path: string;
		source: string;
		patched: string;
	}> = [];
	for (const nodeModulesPath of nodeModuleRoots) {
		for (const scope of ["@earendil-works", "@mariozechner"]) {
			const packageRoot = resolve(
				nodeModulesPath,
				scope,
				"pi-coding-agent",
			);
			if (!shouldPatchPiPackage(packageRoot, bundledPiVersion)) continue;
			assertPiCliArgsVersion(
				readPackageVersion(packageRoot),
				packageRoot,
			);
			const path = resolve(packageRoot, "dist", "cli", "args.js");
			if (!existsSync(path)) {
				throw new Error(`Pi CLI args patch target is missing: ${path}`);
			}
			const source = readFileSync(path, "utf8");
			piCliArgsCandidates.push({
				path,
				source,
				patched: patchPiCliArgsSource(source),
			});
		}
	}
	let changed = false;
	for (const candidate of piCliArgsCandidates) {
		if (candidate.patched === candidate.source) continue;
		writeFileSync(candidate.path, candidate.patched, "utf8");
		changed = true;
	}
	const safeBraceExpansionPath = resolve(appRoot, "node_modules", "brace-expansion");
	for (const nodeModulesPath of nodeModuleRoots) {
		changed = patchPiBraceExpansionTree(nodeModulesPath, safeBraceExpansionPath) || changed;
		// Portable compiler packaging belongs only to Feynman's owned trees.
		// User/global Pi installs retain upstream's working platform layout.
		if (nodeModuleRoots.indexOf(nodeModulesPath) < 2) {
			changed = patchPiEsbuildPackageTree(
				nodeModulesPath, resolve(appRoot, "node_modules", "esbuild"),
				{ runtime: nodeModulesPath !== resolve(appRoot, "node_modules") },
			) || changed;
		}
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
			PI_EXTENSION_HANDLER_TIMEOUT_TARGET,
			(source) =>
				patchPiExtensionHandlerTimeoutSource(
					source,
					bundledPiVersion,
				),
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
			"pi-ai",
			"dist/auth/oauth/device-code.js",
			patchPiGithubCopilotDeviceCodeSource,
			bundledPiVersion,
		) || changed;
		changed = patchNestedPiPackageFileIfPresent(
			nodeModulesPath,
			"pi-coding-agent",
			"pi-ai",
			"dist/auth/oauth/device-code.js",
			patchPiGithubCopilotDeviceCodeSource,
			bundledPiVersion,
		) || changed;
		changed = patchScopedPiPackageFileIfPresent(
			nodeModulesPath,
			"pi-ai",
			"dist/auth/oauth/github-copilot.js",
			patchPiGithubCopilotOAuthSource,
			bundledPiVersion,
		) || changed;
		changed = patchNestedPiPackageFileIfPresent(
			nodeModulesPath,
			"pi-coding-agent",
			"pi-ai",
			"dist/auth/oauth/github-copilot.js",
			patchPiGithubCopilotOAuthSource,
			bundledPiVersion,
		) || changed;
		for (const relativePath of PI_AI_FORWARD_FIX_TARGETS) {
			changed = patchScopedPiPackageFileIfPresent(
				nodeModulesPath,
				"pi-ai",
				relativePath,
				(source) => patchPiAiForwardFixSource(relativePath, source),
				bundledPiVersion,
			) || changed;
			changed = patchNestedPiPackageFileIfPresent(
				nodeModulesPath,
				"pi-coding-agent",
				"pi-ai",
				relativePath,
				(source) => patchPiAiForwardFixSource(relativePath, source),
				bundledPiVersion,
			) || changed;
		}
		for (const relativePath of PI_CODING_AGENT_FORWARD_FIX_TARGETS) {
			changed = patchScopedPiPackageFileIfPresent(
				nodeModulesPath,
				"pi-coding-agent",
				relativePath,
				(source) => patchPiCodingAgentForwardFixSource(relativePath, source),
				bundledPiVersion,
			) || changed;
		}
		for (const relativePath of PI_COMPACTION_TOOLS_PATCH_TARGETS) {
			changed = patchScopedPiPackageFileIfPresent(
				nodeModulesPath,
				"pi-coding-agent",
				relativePath,
				(source) => patchPiCompactionToolsSource(relativePath, source),
				bundledPiVersion,
			) || changed;
		}
		for (const relativePath of PI_EDIT_LINE_ENDINGS_PATCH_TARGETS) {
			changed = patchScopedPiPackageFileIfPresent(
				nodeModulesPath,
				"pi-coding-agent",
				relativePath,
				(source) => patchPiEditLineEndingsSource(relativePath, source),
				bundledPiVersion,
			) || changed;
		}
		changed = patchScopedPiPackageFileIfPresent(
			nodeModulesPath,
			"pi-tui",
			"dist/tui.js",
			patchPiTuiSource,
			bundledPiVersion,
		) || changed;
		changed = patchScopedPiPackageFileIfPresent(
			nodeModulesPath,
			"pi-tui",
			"dist/tui-main-screen.js",
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
		changed = patchNestedPiPackageFileIfPresent(
			nodeModulesPath,
			"pi-coding-agent",
			"pi-tui",
			"dist/tui-main-screen.js",
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
			"dist/core/auth-storage.js",
			patchPiStateFilePermissionsSource,
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
			resolve(nodeModulesPath, "@advaitpaliwal", "alpha-hub", "node_modules", "@modelcontextprotocol", "sdk", "package.json"),
			patchMcpSdkPackageJsonSource,
		) || changed;
		changed = patchFileIfPresent(
			resolve(nodeModulesPath, "@advaitpaliwal", "alpha-hub", "src", "lib", "auth.js"),
			(source) => patchAlphaHubAuthSource(source, { version: "0.1.4" }),
		) || changed;
		changed = patchFileIfPresent(
			resolve(nodeModulesPath, "@advaitpaliwal", "alpha-hub", "src", "lib", "alphaxiv.js"),
			(source) => patchAlphaHubSearchSource(source, { version: "0.1.4" }),
		) || changed;
		changed = patchFileIfPresent(
			resolve(nodeModulesPath, "@advaitpaliwal", "alpha-hub", "src", "lib", "index.js"),
			(source) => patchAlphaHubSearchResultsSource(source, { version: "0.1.4" }),
		) || changed;
		changed = patchPiWebAccessPackageFiles(nodeModulesPath, appRoot) || changed;
		changed = patchPiDocparserPackageFiles(nodeModulesPath) || changed;
		changed =
			patchPiBtwModelRuntimePackageRoot(resolve(nodeModulesPath, "pi-btw")) ||
			changed;
		changed = patchPackageFiles(
			nodeModulesPath,
			"pi-subagents",
			PI_SUBAGENTS_PATCH_TARGETS,
			patchPiSubagentsSource,
		) || changed;
		changed = patchPiOtelPackageRoot(resolve(nodeModulesPath, "pi-otel")) || changed;
		changed = patchPackageFiles(
			nodeModulesPath,
			"@kaiserlich-dev/pi-session-search",
			PI_SESSION_SEARCH_PATCH_TARGETS,
			patchPiSessionSearchSource,
		) || changed;
	}
	return changed;
}
