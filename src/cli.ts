import "dotenv/config";

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

import {
	getUserName as getAlphaUserName,
	isLoggedIn as isAlphaLoggedIn,
	login as loginAlpha,
	logout as logoutAlpha,
} from "@companion-ai/alpha-hub/lib";
import { SettingsManager } from "@mariozechner/pi-coding-agent";

import { syncBundledAssets } from "./bootstrap/sync.js";
import { ensureFeynmanHome, getDefaultSessionDir, getFeynmanAgentDir, getFeynmanHome } from "./config/paths.js";
import { launchPiChat } from "./pi/launch.js";
import { installPackageSources, updateConfiguredPackages } from "./pi/package-ops.js";
import { MAX_NATIVE_PACKAGE_NODE_MAJOR } from "./pi/package-presets.js";
import {
	CORE_PACKAGE_SOURCES,
	getOptionalPackagePresetSources,
	isOptionalPackagePresetSupported,
	listOptionalPackagePresetInstallTargets,
	listOptionalPackagePresets,
	normalizeOptionalPackagePresetName,
	resolvePackageUpdateSources,
} from "./pi/package-presets.js";
import { normalizeFeynmanSettings, normalizeThinkingLevel, parseModelSpec, type ThinkingLevel } from "./pi/settings.js";
import { applyFeynmanPackageManagerEnv } from "./pi/runtime.js";
import { getConfiguredServiceTier, normalizeServiceTier, setConfiguredServiceTier } from "./model/service-tier.js";
import {
	authenticateModelProvider,
	getCurrentModelSpec,
	isLocalModelProvider,
	loginModelProvider,
	logoutModelProvider,
	printModelList,
	setDefaultModelSpec,
} from "./model/commands.js";
import { buildModelStatusSnapshotFromRecords, getAvailableModelRecords, getSupportedModelRecords } from "./model/catalog.js";
import { clearSearchConfig, printSearchStatus, setSearchProvider } from "./search/commands.js";
import type { PiWebSearchProvider } from "./pi/web-access.js";
import { runDoctor, runStatus } from "./setup/doctor.js";
import { setupPreviewDependencies } from "./setup/preview.js";
import { runSetup } from "./setup/setup.js";
import { ASH, printAsciiHeader, printInfo, printPanel, printSection, RESET, SAGE } from "./ui/terminal.js";
import { createModelRegistry } from "./model/registry.js";
import {
	cliCommandSections,
	formatCliWorkflowUsage,
	legacyFlags,
	readPromptSpecs,
	topLevelCommandNames,
} from "../metadata/commands.mjs";

const TOP_LEVEL_COMMANDS = new Set(topLevelCommandNames);

function printHelpLine(usage: string, description: string): void {
	const width = 30;
	const padding = Math.max(1, width - usage.length);
	console.log(`  ${SAGE}${usage}${RESET}${" ".repeat(padding)}${ASH}${description}${RESET}`);
}

function printHelp(appRoot: string): void {
	const workflowCommands = readPromptSpecs(appRoot).filter(
		(command) => command.section === "Research Workflows" && command.topLevelCli,
	);

	printAsciiHeader([
		"Research-first agent shell built on Pi.",
		"Use `feynman setup` first if this is a new machine.",
	]);

	printSection("Getting Started");
	printInfo("feynman");
	printInfo("feynman setup");
	printInfo("feynman doctor");
	printInfo("feynman model");
	printInfo("feynman search status");

	printSection("Commands");
	for (const section of cliCommandSections) {
		for (const command of section.commands) {
			printHelpLine(command.usage, command.description);
		}
	}

	printSection("Research Workflows");
	for (const command of workflowCommands) {
		printHelpLine(formatCliWorkflowUsage(command), command.description);
	}

	printSection("Legacy Flags");
	for (const flag of legacyFlags) {
		printHelpLine(flag.usage, flag.description);
	}

	printSection("REPL");
	printInfo("Inside the REPL, slash workflows come from the live prompt-template and extension command set.");
}

async function handleAlphaCommand(action: string | undefined): Promise<void> {
	if (action === "login") {
		const result = await loginAlpha();
		const name =
			result.userInfo &&
			typeof result.userInfo === "object" &&
			"name" in result.userInfo &&
			typeof result.userInfo.name === "string"
				? result.userInfo.name
				: getAlphaUserName();
		console.log(name ? `alphaXiv login complete: ${name}` : "alphaXiv login complete");
		return;
	}

	if (action === "logout") {
		logoutAlpha();
		console.log("alphaXiv auth cleared");
		return;
	}

	if (!action || action === "status") {
		if (isAlphaLoggedIn()) {
			const name = getAlphaUserName();
			console.log(name ? `alphaXiv logged in as ${name}` : "alphaXiv logged in");
		} else {
			console.log("alphaXiv not logged in");
		}
		return;
	}

	throw new Error(`Unknown alpha command: ${action}`);
}

async function handleModelCommand(subcommand: string | undefined, args: string[], feynmanSettingsPath: string, feynmanAuthPath: string): Promise<void> {
	if (!subcommand || subcommand === "list") {
		printModelList(feynmanSettingsPath, feynmanAuthPath);
		return;
	}

	if (subcommand === "login") {
		if (args[0]) {
			// Specific provider given - resolve OAuth vs API-key setup automatically
			await loginModelProvider(feynmanAuthPath, args[0], feynmanSettingsPath);
		} else {
			// No provider specified - show auth method choice
			await authenticateModelProvider(feynmanAuthPath, feynmanSettingsPath);
		}
		return;
	}

	if (subcommand === "logout") {
		await logoutModelProvider(feynmanAuthPath, args[0]);
		return;
	}

	if (subcommand === "set") {
		const spec = args[0];
		if (!spec) {
			throw new Error("Usage: feynman model set <provider/model|provider:model>");
		}
		setDefaultModelSpec(feynmanSettingsPath, feynmanAuthPath, spec);
		return;
	}

	if (subcommand === "tier") {
		const requested = args[0];
		if (!requested) {
			console.log(getConfiguredServiceTier(feynmanSettingsPath) ?? "not set");
			return;
		}

		if (requested === "unset" || requested === "clear" || requested === "off") {
			setConfiguredServiceTier(feynmanSettingsPath, undefined);
			console.log("Cleared service tier override");
			return;
		}

		const tier = normalizeServiceTier(requested);
		if (!tier) {
			throw new Error("Usage: feynman model tier <auto|default|flex|priority|standard_only|unset>");
		}

		setConfiguredServiceTier(feynmanSettingsPath, tier);
		console.log(`Service tier set to ${tier}`);
		return;
	}

	throw new Error(`Unknown model command: ${subcommand}`);
}

async function handleUpdateCommand(workingDir: string, feynmanAgentDir: string, source?: string): Promise<void> {
	try {
		const updateSources = source ? resolvePackageUpdateSources(source) : [undefined];
		const results = [];
		for (const updateSource of updateSources) {
			results.push(await updateConfiguredPackages(workingDir, feynmanAgentDir, updateSource));
		}

		const updated = results.flatMap((result) => result.updated);
		const skipped = results.flatMap((result) => result.skipped);

		if (updated.length === 0) {
			console.log("All packages up to date.");
			return;
		}

		for (const updatedSource of updated) {
			console.log(`Updated ${updatedSource}`);
		}
		for (const skippedSource of skipped) {
			console.log(`Skipped ${skippedSource} on Node ${process.versions.node} (native packages are only supported through Node ${MAX_NATIVE_PACKAGE_NODE_MAJOR}.x).`);
		}
		console.log("All packages up to date.");
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (message.includes("No supported package manager found")) {
			console.log("No package manager is available for live package updates.");
			console.log("If you installed the standalone app, rerun the installer to get newer bundled packages.");
			return;
		}
		if (message.includes("Installing pi-generative-ui failed")) {
			console.log(message);
			console.log("Skipped optional generative-ui update.");
			return;
		}

		throw error;
	}
}

async function handlePackagesCommand(subcommand: string | undefined, args: string[], workingDir: string, feynmanAgentDir: string): Promise<void> {
	applyFeynmanPackageManagerEnv(feynmanAgentDir);
	const settingsManager = SettingsManager.create(workingDir, feynmanAgentDir);
	const configuredSources = new Set(
		settingsManager
			.getPackages()
			.map((entry) => (typeof entry === "string" ? entry : entry.source))
			.filter((entry): entry is string => typeof entry === "string"),
	);

	if (!subcommand || subcommand === "list") {
		printPanel("Feynman Packages", [
			"Core packages are installed by default to keep first-run setup fast.",
		]);
		printSection("Core");
		for (const source of CORE_PACKAGE_SOURCES) {
			printInfo(source);
		}
		printSection("Optional");
		const optionalPresets = listOptionalPackagePresets();
		if (optionalPresets.length === 0) {
			printInfo(`No optional package presets are available on ${process.platform}.`);
			printInfo("Core packages already include memory and session search.");
			return;
		}
		for (const preset of optionalPresets) {
			const installed = preset.sources.every((source) => configuredSources.has(source));
			printInfo(`${preset.name}${installed ? " (installed)" : ""}  ${preset.description}`);
		}
		printInfo(`Install with: feynman packages install <${listOptionalPackagePresetInstallTargets().join("|")}>`);
		return;
	}

	if (subcommand !== "install") {
		throw new Error(`Unknown packages command: ${subcommand}`);
	}

	const target = args[0];
	if (!target) {
		const installTargets = listOptionalPackagePresetInstallTargets();
		if (installTargets.length === 0) {
			throw new Error(`No optional package presets are available on ${process.platform}. Core packages already include memory and session search.`);
		}
		throw new Error(`Usage: feynman packages install <${installTargets.join("|")}>`);
	}

	const sources = getOptionalPackagePresetSources(target);
	if (!sources) {
		const normalizedPreset = normalizeOptionalPackagePresetName(target);
		if (normalizedPreset === "all-extras") {
			console.log(`No optional package presets are available on ${process.platform}.`);
			console.log("Core packages already include memory and session search.");
			return;
		}
		if (normalizedPreset && !isOptionalPackagePresetSupported(normalizedPreset)) {
			console.log(`${normalizedPreset} is not available on ${process.platform}.`);
			if (normalizedPreset === "generative-ui") {
				console.log("The upstream pi-generative-ui package currently supports macOS only.");
			}
			return;
		}
		if (target === "memory" || target === "session-search") {
			console.log(`${target} is installed by default as a core package.`);
			return;
		}
		throw new Error(`Unknown package preset: ${target}`);
	}

	const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
	const isStandaloneBundle = !existsSync(resolve(appRoot, ".feynman", "runtime-workspace.tgz")) && existsSync(resolve(appRoot, ".feynman", "npm"));
	if (target === "generative-ui" && process.platform === "darwin" && isStandaloneBundle) {
		console.log("The generative-ui preset is currently unavailable in the standalone macOS bundle.");
		console.log("Its native glimpseui dependency fails to compile reliably in that environment.");
		console.log("If you need generative-ui, install Feynman through npm instead of the standalone bundle.");
		return;
	}

	const pendingSources = sources.filter((source) => !configuredSources.has(source));
	for (const source of sources) {
		if (configuredSources.has(source)) {
			console.log(`${source} already installed`);
		}
	}

	if (pendingSources.length === 0) {
		console.log("Optional packages installed.");
		return;
	}

	try {
		const result = await installPackageSources(workingDir, feynmanAgentDir, pendingSources, { persist: true });
		for (const skippedSource of result.skipped) {
			console.log(`Skipped ${skippedSource} on Node ${process.versions.node} (native packages are only supported through Node ${MAX_NATIVE_PACKAGE_NODE_MAJOR}.x).`);
		}
		await settingsManager.flush();
		console.log("Optional packages installed.");
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (message.includes("No supported package manager found")) {
			console.log("No package manager is available for optional package installs.");
			console.log("Install npm, pnpm, or bun, or rerun the standalone installer for bundled package updates.");
			return;
		}
		if (message.includes("Installing pi-generative-ui failed")) {
			console.log(message);
			console.log("Skipped optional generative-ui install.");
			return;
		}

		throw error;
	}
}

function handleSearchCommand(subcommand: string | undefined, args: string[]): void {
	if (!subcommand || subcommand === "status") {
		printSearchStatus();
		return;
	}

	if (subcommand === "set") {
		const provider = args[0] as PiWebSearchProvider | undefined;
		const validProviders: PiWebSearchProvider[] = ["auto", "perplexity", "exa", "gemini"];
		if (!provider || !validProviders.includes(provider)) {
			throw new Error("Usage: feynman search set <auto|perplexity|exa|gemini> [api-key]");
		}
		setSearchProvider(provider, args[1]);
		return;
	}

	if (subcommand === "clear") {
		clearSearchConfig();
		return;
	}

	throw new Error(`Unknown search command: ${subcommand}`);
}

function loadPackageVersion(appRoot: string): { version?: string } {
	try {
		return JSON.parse(readFileSync(resolve(appRoot, "package.json"), "utf8")) as { version?: string };
	} catch {
		return {};
	}
}

export function resolveInitialPrompt(
	command: string | undefined,
	rest: string[],
	oneShotPrompt: string | undefined,
	workflowCommands: Set<string>,
): string | undefined {
	if (oneShotPrompt) {
		return oneShotPrompt;
	}
	if (!command) {
		return undefined;
	}
	if (command === "chat") {
		return rest.length > 0 ? rest.join(" ") : undefined;
	}
	if (workflowCommands.has(command)) {
		return [`/${command}`, ...rest].join(" ").trim();
	}
	if (!TOP_LEVEL_COMMANDS.has(command)) {
		return [command, ...rest].join(" ");
	}
	return undefined;
}

export function resolvePiPromptOptions(
	command: string | undefined,
	rest: string[],
	oneShotPrompt: string | undefined,
	workflowCommands: Set<string>,
): { oneShotPrompt?: string; initialPrompt?: string } {
	const resolvedPrompt = resolveInitialPrompt(command, rest, oneShotPrompt, workflowCommands);
	if (!resolvedPrompt) {
		return {};
	}
	if (oneShotPrompt) {
		return { oneShotPrompt: resolvedPrompt };
	}
	return { initialPrompt: resolvedPrompt };
}

export function buildLocalModelWorkflowNotice(modelSpec: string, workflowName: string): string {
	const WARN = "\x1b[33m";
	const RESET_CODE = "\x1b[0m";
	return `${WARN}⚠ ${modelSpec} is a local provider. Small local models often ignore /${workflowName}'s multi-step workflow and return a chat-only reply with no artifacts under outputs/. If this run produces no files, switch to a stronger model with \`feynman model set <provider/model>\`.${RESET_CODE}`;
}

export function appendWorkflowFlagPositionals(
	command: string | undefined,
	rest: string[],
	values: Record<string, string | boolean | undefined>,
): string[] {
	if (command !== "summarize") {
		return rest;
	}

	const appended = [...rest];
	for (const flag of ["window-size", "overlap", "tier1-threshold", "tier2-threshold"] as const) {
		const value = values[flag];
		if (typeof value === "string") {
			appended.push(`--${flag}`, value);
		}
	}
	return appended;
}

export function resolveThinkingConfig(rawValue: string | undefined): {
	defaultThinkingLevel: ThinkingLevel;
	launchThinkingLevel?: ThinkingLevel;
} {
	const explicitThinkingLevel = normalizeThinkingLevel(rawValue);
	return {
		defaultThinkingLevel: explicitThinkingLevel ?? "medium",
		launchThinkingLevel: explicitThinkingLevel,
	};
}

export function shouldRunInteractiveSetup(
	explicitModelSpec: string | undefined,
	currentModelSpec: string | undefined,
	isInteractiveTerminal: boolean,
	authPath: string,
): boolean {
	if (explicitModelSpec || !isInteractiveTerminal) {
		return false;
	}

	const status = buildModelStatusSnapshotFromRecords(
		getSupportedModelRecords(authPath),
		getAvailableModelRecords(authPath),
		currentModelSpec,
	);
	return !status.currentValid;
}

export async function main(): Promise<void> {
	const here = dirname(fileURLToPath(import.meta.url));
	const appRoot = resolve(here, "..");
	const feynmanVersion = loadPackageVersion(appRoot).version;
	const bundledSettingsPath = resolve(appRoot, ".feynman", "settings.json");
	const feynmanHome = getFeynmanHome();
	const feynmanAgentDir = getFeynmanAgentDir(feynmanHome);

	ensureFeynmanHome(feynmanHome);
	syncBundledAssets(appRoot, feynmanAgentDir);

	const { values, positionals } = parseArgs({
		args: process.argv.slice(2),
		allowPositionals: true,
		options: {
			cwd: { type: "string" },
			doctor: { type: "boolean" },
			help: { type: "boolean" },
			version: { type: "boolean" },
			"alpha-login": { type: "boolean" },
			"alpha-logout": { type: "boolean" },
			"alpha-status": { type: "boolean" },
			mode: { type: "string" },
			model: { type: "string" },
			"new-session": { type: "boolean" },
			prompt: { type: "string" },
			"service-tier": { type: "string" },
			"session-dir": { type: "string" },
			"setup-preview": { type: "boolean" },
			"tier1-threshold": { type: "string" },
			"tier2-threshold": { type: "string" },
			thinking: { type: "string" },
			overlap: { type: "string" },
			"window-size": { type: "string" },
		},
	});

	if (values.help) {
		printHelp(appRoot);
		return;
	}

	if (values.version) {
		if (feynmanVersion) {
			console.log(feynmanVersion);
			return;
		}
		throw new Error("Unable to determine the installed Feynman version.");
	}

	const workingDir = resolve(values.cwd ?? process.cwd());
	const sessionDir = resolve(values["session-dir"] ?? getDefaultSessionDir(feynmanHome));
	const feynmanSettingsPath = resolve(feynmanAgentDir, "settings.json");
	const feynmanAuthPath = resolve(feynmanAgentDir, "auth.json");
	const { defaultThinkingLevel, launchThinkingLevel } = resolveThinkingConfig(values.thinking ?? process.env.FEYNMAN_THINKING);

	normalizeFeynmanSettings(feynmanSettingsPath, bundledSettingsPath, defaultThinkingLevel, feynmanAuthPath);

	if (values.doctor) {
		runDoctor({
			settingsPath: feynmanSettingsPath,
			authPath: feynmanAuthPath,
			sessionDir,
			workingDir,
			appRoot,
		});
		return;
	}

	if (values["setup-preview"]) {
		const result = setupPreviewDependencies();
		console.log(result.message);
		return;
	}

	if (values["alpha-login"]) {
		await handleAlphaCommand("login");
		return;
	}

	if (values["alpha-logout"]) {
		await handleAlphaCommand("logout");
		return;
	}

	if (values["alpha-status"]) {
		await handleAlphaCommand("status");
		return;
	}

	const [command, ...rest] = positionals;
	if (command === "help") {
		printHelp(appRoot);
		return;
	}

	if (command === "setup") {
		if (rest[0] === "preview") {
			const result = setupPreviewDependencies();
			console.log(result.message);
			return;
		}
		if (rest[0]) {
			throw new Error(`Unknown setup command: ${rest[0]}`);
		}
		await runSetup({
			settingsPath: feynmanSettingsPath,
			bundledSettingsPath,
			authPath: feynmanAuthPath,
			workingDir,
			sessionDir,
			appRoot,
			defaultThinkingLevel,
		});
		return;
	}

	if (command === "doctor") {
		runDoctor({
			settingsPath: feynmanSettingsPath,
			authPath: feynmanAuthPath,
			sessionDir,
			workingDir,
			appRoot,
		});
		return;
	}

	if (command === "status") {
		runStatus({
			settingsPath: feynmanSettingsPath,
			authPath: feynmanAuthPath,
			sessionDir,
			workingDir,
			appRoot,
		});
		return;
	}

	if (command === "model") {
		await handleModelCommand(rest[0], rest.slice(1), feynmanSettingsPath, feynmanAuthPath);
		return;
	}

	if (command === "search") {
		handleSearchCommand(rest[0], rest.slice(1));
		return;
	}

	if (command === "packages") {
		await handlePackagesCommand(rest[0], rest.slice(1), workingDir, feynmanAgentDir);
		return;
	}

	if (command === "update") {
		await handleUpdateCommand(workingDir, feynmanAgentDir, rest[0]);
		return;
	}

	if (command === "alpha") {
		await handleAlphaCommand(rest[0]);
		return;
	}

	const explicitModelSpec = values.model ?? process.env.FEYNMAN_MODEL;
	const explicitServiceTier = normalizeServiceTier(values["service-tier"] ?? process.env.FEYNMAN_SERVICE_TIER);
	const mode = values.mode;
	if (mode !== undefined && mode !== "text" && mode !== "json" && mode !== "rpc") {
		throw new Error("Unknown mode. Use text, json, or rpc.");
	}
	if ((values["service-tier"] ?? process.env.FEYNMAN_SERVICE_TIER) && !explicitServiceTier) {
		throw new Error("Unknown service tier. Use auto, default, flex, priority, or standard_only.");
	}
	if (explicitServiceTier) {
		process.env.FEYNMAN_SERVICE_TIER = explicitServiceTier;
	}
	if (explicitModelSpec) {
		const modelRegistry = createModelRegistry(feynmanAuthPath);
		const explicitModel = parseModelSpec(explicitModelSpec, modelRegistry);
		if (!explicitModel) {
			throw new Error(`Unknown model: ${explicitModelSpec}`);
		}
	}

	const currentModelSpec = getCurrentModelSpec(feynmanSettingsPath);
	if (shouldRunInteractiveSetup(
		explicitModelSpec,
		currentModelSpec,
		Boolean(process.stdin.isTTY && process.stdout.isTTY),
		feynmanAuthPath,
	)) {
		await runSetup({
			settingsPath: feynmanSettingsPath,
			bundledSettingsPath,
			authPath: feynmanAuthPath,
			workingDir,
			sessionDir,
			appRoot,
			defaultThinkingLevel,
		});
		if (!getCurrentModelSpec(feynmanSettingsPath)) {
			return;
		}
		normalizeFeynmanSettings(feynmanSettingsPath, bundledSettingsPath, defaultThinkingLevel, feynmanAuthPath);
	}

	const workflowCommandNames = new Set(readPromptSpecs(appRoot).filter((s) => s.topLevelCli).map((s) => s.name));
	const workflowRest = appendWorkflowFlagPositionals(command, rest, values);
	const promptOptions = resolvePiPromptOptions(command, workflowRest, values.prompt, workflowCommandNames);

	let preLaunchNotice: string | undefined;
	if (command && workflowCommandNames.has(command)) {
		const effectiveSpec = explicitModelSpec ?? getCurrentModelSpec(feynmanSettingsPath);
		if (effectiveSpec) {
			const providerId = effectiveSpec.split("/")[0] ?? "";
			if (isLocalModelProvider(feynmanAuthPath, providerId)) {
				preLaunchNotice = buildLocalModelWorkflowNotice(effectiveSpec, command);
			}
		}
	}

	await launchPiChat({
		appRoot,
		workingDir,
		sessionDir,
		feynmanAgentDir,
		feynmanVersion,
		mode,
		thinkingLevel: launchThinkingLevel,
		explicitModelSpec,
		preLaunchNotice,
		...promptOptions,
	});
}
