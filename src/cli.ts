import "dotenv/config";

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

import {
	getUserName as getAlphaUserName,
	isLoggedIn as isAlphaLoggedIn,
	login as loginAlpha,
	logout as logoutAlpha,
} from "@companion-ai/alpha-hub/lib";
import { DefaultPackageManager, SettingsManager } from "@mariozechner/pi-coding-agent";

import { syncBundledAssets } from "./bootstrap/sync.js";
import { ensureFeynmanHome, getDefaultSessionDir, getFeynmanAgentDir, getFeynmanHome } from "./config/paths.js";
import { launchPiChat } from "./pi/launch.js";
import { CORE_PACKAGE_SOURCES, getOptionalPackagePresetSources, listOptionalPackagePresets } from "./pi/package-presets.js";
import { normalizeFeynmanSettings, normalizeThinkingLevel, parseModelSpec } from "./pi/settings.js";
import {
	authenticateModelProvider,
	getCurrentModelSpec,
	loginModelProvider,
	logoutModelProvider,
	printModelList,
	setDefaultModelSpec,
} from "./model/commands.js";
import { printSearchStatus } from "./search/commands.js";
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
			// Specific provider given - use OAuth login directly
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
			throw new Error("Usage: feynman model set <provider/model>");
		}
		setDefaultModelSpec(feynmanSettingsPath, feynmanAuthPath, spec);
		return;
	}

	throw new Error(`Unknown model command: ${subcommand}`);
}

async function handleUpdateCommand(workingDir: string, feynmanAgentDir: string, source?: string): Promise<void> {
	const settingsManager = SettingsManager.create(workingDir, feynmanAgentDir);
	const packageManager = new DefaultPackageManager({
		cwd: workingDir,
		agentDir: feynmanAgentDir,
		settingsManager,
	});

	packageManager.setProgressCallback((event) => {
		if (event.type === "start") {
			console.log(`Updating ${event.source}...`);
		} else if (event.type === "complete") {
			console.log(`Updated ${event.source}`);
		} else if (event.type === "error") {
			console.error(`Failed to update ${event.source}: ${event.message ?? "unknown error"}`);
		}
	});

	await packageManager.update(source);
	await settingsManager.flush();
	console.log("All packages up to date.");
}

async function handlePackagesCommand(subcommand: string | undefined, args: string[], workingDir: string, feynmanAgentDir: string): Promise<void> {
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
		for (const preset of listOptionalPackagePresets()) {
			const installed = preset.sources.every((source) => configuredSources.has(source));
			printInfo(`${preset.name}${installed ? " (installed)" : ""}  ${preset.description}`);
		}
		printInfo("Install with: feynman packages install <preset>");
		return;
	}

	if (subcommand !== "install") {
		throw new Error(`Unknown packages command: ${subcommand}`);
	}

	const target = args[0];
	if (!target) {
		throw new Error("Usage: feynman packages install <generative-ui|memory|session-search|all-extras>");
	}

	const sources = getOptionalPackagePresetSources(target);
	if (!sources) {
		throw new Error(`Unknown package preset: ${target}`);
	}

	const packageManager = new DefaultPackageManager({
		cwd: workingDir,
		agentDir: feynmanAgentDir,
		settingsManager,
	});
	packageManager.setProgressCallback((event) => {
		if (event.type === "start") {
			console.log(`Installing ${event.source}...`);
		} else if (event.type === "complete") {
			console.log(`Installed ${event.source}`);
		} else if (event.type === "error") {
			console.error(`Failed to install ${event.source}: ${event.message ?? "unknown error"}`);
		}
	});

	for (const source of sources) {
		if (configuredSources.has(source)) {
			console.log(`${source} already installed`);
			continue;
		}
		await packageManager.install(source);
	}
	await settingsManager.flush();
	console.log("Optional packages installed.");
}

function handleSearchCommand(subcommand: string | undefined): void {
	if (!subcommand || subcommand === "status") {
		printSearchStatus();
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
			model: { type: "string" },
			"new-session": { type: "boolean" },
			prompt: { type: "string" },
			"session-dir": { type: "string" },
			"setup-preview": { type: "boolean" },
			thinking: { type: "string" },
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
	const thinkingLevel = normalizeThinkingLevel(values.thinking ?? process.env.FEYNMAN_THINKING) ?? "medium";

	normalizeFeynmanSettings(feynmanSettingsPath, bundledSettingsPath, thinkingLevel, feynmanAuthPath);

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
		await runSetup({
			settingsPath: feynmanSettingsPath,
			bundledSettingsPath,
			authPath: feynmanAuthPath,
			workingDir,
			sessionDir,
			appRoot,
			defaultThinkingLevel: thinkingLevel,
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
		handleSearchCommand(rest[0]);
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
	if (explicitModelSpec) {
		const modelRegistry = createModelRegistry(feynmanAuthPath);
		const explicitModel = parseModelSpec(explicitModelSpec, modelRegistry);
		if (!explicitModel) {
			throw new Error(`Unknown model: ${explicitModelSpec}`);
		}
	}

	if (!explicitModelSpec && !getCurrentModelSpec(feynmanSettingsPath) && process.stdin.isTTY && process.stdout.isTTY) {
		await runSetup({
			settingsPath: feynmanSettingsPath,
			bundledSettingsPath,
			authPath: feynmanAuthPath,
			workingDir,
			sessionDir,
			appRoot,
			defaultThinkingLevel: thinkingLevel,
		});
		if (!getCurrentModelSpec(feynmanSettingsPath)) {
			return;
		}
		normalizeFeynmanSettings(feynmanSettingsPath, bundledSettingsPath, thinkingLevel, feynmanAuthPath);
	}

	await launchPiChat({
		appRoot,
		workingDir,
		sessionDir,
		feynmanAgentDir,
		feynmanVersion,
		thinkingLevel,
		explicitModelSpec,
		oneShotPrompt: values.prompt,
		initialPrompt: resolveInitialPrompt(command, rest, values.prompt, new Set(readPromptSpecs(appRoot).filter((s) => s.topLevelCli).map((s) => s.name))),
	});
}
