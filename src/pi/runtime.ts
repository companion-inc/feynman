import { existsSync, readFileSync } from "node:fs";
import { delimiter, dirname, isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
	BROWSER_FALLBACK_PATHS,
	MERMAID_FALLBACK_PATHS,
	PANDOC_FALLBACK_PATHS,
	resolveExecutable,
} from "../system/executables.js";

export type PiRuntimeOptions = {
	appRoot: string;
	workingDir: string;
	sessionDir: string;
	feynmanAgentDir: string;
	feynmanVersion?: string;
	mode?: "text" | "json" | "rpc";
	thinkingLevel?: string;
	explicitModelSpec?: string;
	oneShotPrompt?: string;
	initialPrompt?: string;
	bedrockConfig?: { profile?: string; region?: string };
};

export function getFeynmanNpmPrefixPath(feynmanAgentDir: string): string {
	return resolve(dirname(feynmanAgentDir), "npm-global");
}

export function applyFeynmanPackageManagerEnv(feynmanAgentDir: string): string {
	const feynmanNpmPrefixPath = getFeynmanNpmPrefixPath(feynmanAgentDir);
	process.env.FEYNMAN_NPM_PREFIX = feynmanNpmPrefixPath;
	process.env.NPM_CONFIG_PREFIX = feynmanNpmPrefixPath;
	process.env.npm_config_prefix = feynmanNpmPrefixPath;
	return feynmanNpmPrefixPath;
}

export function resolvePiPaths(appRoot: string) {
	return {
		piPackageRoot: resolve(appRoot, "node_modules", "@mariozechner", "pi-coding-agent"),
		piCliPath: resolve(appRoot, "node_modules", "@mariozechner", "pi-coding-agent", "dist", "cli.js"),
		promisePolyfillPath: resolve(appRoot, "dist", "system", "promise-polyfill.js"),
		promisePolyfillSourcePath: resolve(appRoot, "src", "system", "promise-polyfill.ts"),
		tsxLoaderPath: resolve(appRoot, "node_modules", "tsx", "dist", "loader.mjs"),
		researchToolsPath: resolve(appRoot, "extensions", "research-tools.ts"),
		promptTemplatePath: resolve(appRoot, "prompts"),
		systemPromptPath: resolve(appRoot, ".feynman", "SYSTEM.md"),
		piWorkspaceNodeModulesPath: resolve(appRoot, ".feynman", "npm", "node_modules"),
		nodeModulesBinPath: resolve(appRoot, "node_modules", ".bin"),
	};
}

export function toNodeImportSpecifier(modulePath: string): string {
	return isAbsolute(modulePath) ? pathToFileURL(modulePath).href : modulePath;
}

export function validatePiInstallation(appRoot: string): string[] {
	const paths = resolvePiPaths(appRoot);
	const missing: string[] = [];

	if (!existsSync(paths.piCliPath)) missing.push(paths.piCliPath);
	if (!existsSync(paths.promisePolyfillPath)) {
		// Dev fallback: allow running from source without `dist/` build artifacts.
		const hasDevPolyfill = existsSync(paths.promisePolyfillSourcePath) && existsSync(paths.tsxLoaderPath);
		if (!hasDevPolyfill) missing.push(paths.promisePolyfillPath);
	}
	if (!existsSync(paths.researchToolsPath)) missing.push(paths.researchToolsPath);
	if (!existsSync(paths.promptTemplatePath)) missing.push(paths.promptTemplatePath);

	return missing;
}

export function buildPiArgs(options: PiRuntimeOptions): string[] {
	const paths = resolvePiPaths(options.appRoot);
	const args = [
		"--session-dir",
		options.sessionDir,
		"--extension",
		paths.researchToolsPath,
		"--prompt-template",
		paths.promptTemplatePath,
	];

	if (existsSync(paths.systemPromptPath)) {
		args.push("--system-prompt", readFileSync(paths.systemPromptPath, "utf8"));
	}

	if (options.mode) {
		args.push("--mode", options.mode);
	}
	if (options.explicitModelSpec) {
		args.push("--model", options.explicitModelSpec);
	}
	if (options.thinkingLevel) {
		args.push("--thinking", options.thinkingLevel);
	}
	if (options.oneShotPrompt) {
		args.push("-p", options.oneShotPrompt);
	} else if (options.initialPrompt) {
		args.push(options.initialPrompt);
	}

	return args;
}

export function buildPiEnv(options: PiRuntimeOptions): NodeJS.ProcessEnv {
	const paths = resolvePiPaths(options.appRoot);
	const feynmanNpmPrefixPath = getFeynmanNpmPrefixPath(options.feynmanAgentDir);
	const feynmanNpmBinPath = resolve(feynmanNpmPrefixPath, "bin");
	const feynmanWebSearchConfigPath = resolve(dirname(options.feynmanAgentDir), "web-search.json");

	const currentPath = process.env.PATH ?? "";
	const binEntries = [paths.nodeModulesBinPath, resolve(paths.piWorkspaceNodeModulesPath, ".bin"), feynmanNpmBinPath];
	const binPath = binEntries.join(delimiter);

	const env: NodeJS.ProcessEnv = {
		...process.env,
		PATH: `${binPath}${delimiter}${currentPath}`,
		FEYNMAN_VERSION: options.feynmanVersion,
		FEYNMAN_SESSION_DIR: options.sessionDir,
		FEYNMAN_MEMORY_DIR: resolve(dirname(options.feynmanAgentDir), "memory"),
		FEYNMAN_WEB_SEARCH_CONFIG: feynmanWebSearchConfigPath,
		FEYNMAN_NODE_EXECUTABLE: process.execPath,
		FEYNMAN_BIN_PATH: resolve(options.appRoot, "bin", "feynman.js"),
		FEYNMAN_NPM_PREFIX: feynmanNpmPrefixPath,
		// Ensure the Pi child process uses Feynman's agent dir for auth/models/settings.
		PI_CODING_AGENT_DIR: options.feynmanAgentDir,
		PANDOC_PATH: process.env.PANDOC_PATH ?? resolveExecutable("pandoc", PANDOC_FALLBACK_PATHS),
		PI_HARDWARE_CURSOR: process.env.PI_HARDWARE_CURSOR ?? "1",
		PI_SKIP_VERSION_CHECK: process.env.PI_SKIP_VERSION_CHECK ?? "1",
		MERMAID_CLI_PATH: process.env.MERMAID_CLI_PATH ?? resolveExecutable("mmdc", MERMAID_FALLBACK_PATHS),
		PUPPETEER_EXECUTABLE_PATH:
			process.env.PUPPETEER_EXECUTABLE_PATH ?? resolveExecutable("google-chrome", BROWSER_FALLBACK_PATHS),
		// Always pin npm's global prefix to the Feynman workspace. npm injects
		// lowercase config vars into child processes, which would otherwise leak
		// the caller's global prefix into Pi.
		NPM_CONFIG_PREFIX: feynmanNpmPrefixPath,
		npm_config_prefix: feynmanNpmPrefixPath,
	};

	// Inject Bedrock profile/region only when not already set in the shell environment.
	if (options.bedrockConfig?.profile && !process.env.AWS_PROFILE) {
		env.AWS_PROFILE = options.bedrockConfig.profile;
	}
	if (options.bedrockConfig?.region && !process.env.AWS_REGION) {
		env.AWS_REGION = options.bedrockConfig.region;
	}

	return env;
}
