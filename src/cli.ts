import { loadEnvFile } from "node:process";

// Native replacement for dotenv/config: load a cwd .env when present.
try {
	loadEnvFile();
} catch {
	// No .env in the working directory - nothing to load.
}

import { spawn } from "node:child_process";
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
import { createAgentSession, SessionManager, SettingsManager, type AgentSessionEvent } from "@earendil-works/pi-coding-agent";

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
import {
	parseCitationExpansion,
	parseCritiqueTop,
	parseFullTextTop,
	parseRankLimit,
	parseSynthesisTop,
	resolvePaperAccess,
	runPaperRank,
	type ModelSynthesisModelSelection,
	type ModelSynthesisOutcome,
	type ModelSynthesizer,
	type PaperAccessResult,
	type PaperRankRunResult,
	type PaperScore,
} from "./rank/paper-rank.js";
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
import {
	buildModelStatusSnapshotFromRecords,
	chooseRecommendedModel,
	getAuthenticatedModelRecords,
	isProClassModelSpec,
	getSupportedModelRecords,
} from "./model/catalog.js";
import { clearSearchConfig, printSearchStatus, setSearchProvider } from "./search/commands.js";
import type { PiWebSearchProvider } from "./pi/web-access.js";
import { fetchLatestFeynmanVersion, getFeynmanUpgradeLines, isNewerVersion } from "./system/self-update.js";
import { runDoctor, runStatus } from "./setup/doctor.js";
import { setupPreviewDependencies } from "./setup/preview.js";
import { runSetup } from "./setup/setup.js";
import {
	captureTelemetryEvent,
	emitTelemetryLog,
	getCliTelemetryMetadata,
	initializePostHogTelemetry,
	shutdownPostHogTelemetry,
	startTelemetrySpan,
	telemetryErrorProperties,
} from "./telemetry/posthog.js";
import { ASH, printAsciiHeader, printInfo, printPanel, printSection, RESET, SAGE } from "./ui/terminal.js";
import { createModelRegistry } from "./model/registry.js";
import { parseWorkbenchPort, serveWorkbench } from "./workbench/server.js";
import {
	cliCommandSections,
	formatCliWorkflowUsage,
	legacyFlags,
	readPromptSpecs,
	topLevelCommandNames,
} from "../metadata/commands.mjs";

const TOP_LEVEL_COMMANDS = new Set(topLevelCommandNames);
const ALPHA_HUB_PACKAGE_PATH = ["@companion-ai", "alpha-hub"] as const;

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

export function resolveBundledAlphaCliPath(appRoot: string): string {
	const candidates = [
		resolve(appRoot, "node_modules", ...ALPHA_HUB_PACKAGE_PATH, "bin", "alpha"),
		resolve(appRoot, ".feynman", "npm", "node_modules", ...ALPHA_HUB_PACKAGE_PATH, "bin", "alpha"),
	];
	const found = candidates.find((candidate) => existsSync(candidate));
	if (!found) {
		throw new Error(`Bundled alphaXiv CLI not found. Checked: ${candidates.join(", ")}`);
	}
	return found;
}

type AlphaPassthroughArgs = {
	args: string[];
	cwd: string;
};

export function resolveAlphaPassthroughArgs(rawArgs: string[], defaultCwd = process.cwd()): AlphaPassthroughArgs | undefined {
	let cwd = defaultCwd;
	for (let index = 0; index < rawArgs.length; index += 1) {
		const arg = rawArgs[index];
		if (arg === "alpha") {
			return { args: rawArgs.slice(index + 1), cwd };
		}
		if (arg === "--cwd") {
			const next = rawArgs[index + 1];
			if (!next) {
				return undefined;
			}
			cwd = resolve(next);
			index += 1;
			continue;
		}
		if (arg?.startsWith("--cwd=")) {
			cwd = resolve(arg.slice("--cwd=".length));
			continue;
		}
		return undefined;
	}
	return undefined;
}

export async function runBundledAlphaCli(appRoot: string, args: string[], options: { cwd?: string } = {}): Promise<void> {
	const alphaCliPath = resolveBundledAlphaCliPath(appRoot);
	const child = spawn(process.execPath, [alphaCliPath, ...args], {
		cwd: options.cwd ?? process.cwd(),
		stdio: "inherit",
		env: process.env,
	});

	await new Promise<void>((resolvePromise, reject) => {
		child.on("error", reject);
		child.on("exit", (code, signal) => {
			if (signal) {
				process.exitCode = 1;
				console.error(`feynman alpha terminated because the alpha child exited with ${signal}.`);
				resolvePromise();
				return;
			}
			process.exitCode = code ?? 0;
			resolvePromise();
		});
	});
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

async function handleUpdateCommand(
	workingDir: string,
	feynmanAgentDir: string,
	appRoot: string,
	feynmanVersion: string | undefined,
	source?: string,
): Promise<void> {
	const latestFeynmanVersionPromise = fetchLatestFeynmanVersion();
	try {
		const updateSources = source ? resolvePackageUpdateSources(source) : [undefined];
		const results = [];
		for (const updateSource of updateSources) {
			results.push(await updateConfiguredPackages(workingDir, feynmanAgentDir, updateSource));
		}

		const updated = results.flatMap((result) => result.updated);
		const skipped = results.flatMap((result) => result.skipped);

		if (updated.length === 0 && skipped.length === 0) {
			console.log("All packages up to date.");
			return;
		}

		for (const updatedSource of updated) {
			console.log(`Updated ${updatedSource}`);
		}
		for (const skippedSource of skipped) {
			console.log(`Skipped ${skippedSource} on Node ${process.versions.node} (native packages are only supported through Node ${MAX_NATIVE_PACKAGE_NODE_MAJOR}.x).`);
		}
		if (updated.length === 0) {
			return;
		}
		console.log("All packages up to date.");
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (message.includes("No supported package manager found")) {
			console.log("No package manager is available for live package updates.");
			console.log("If you installed the standalone app, rerun the installer to get newer bundled packages.");
			return;
		}

		throw error;
	} finally {
		// `feynman update` covers Pi packages only; tell the user when the CLI
		// itself is behind so they are not left assuming everything is current
		// (issue #177).
		const latestVersion = await latestFeynmanVersionPromise;
		if (feynmanVersion && latestVersion && isNewerVersion(latestVersion, feynmanVersion)) {
			const standaloneBundle =
				!existsSync(resolve(appRoot, ".feynman", "runtime-workspace.tgz")) && existsSync(resolve(appRoot, ".feynman", "npm"));
			for (const line of getFeynmanUpgradeLines(latestVersion, feynmanVersion, { standaloneBundle })) {
				console.log(line);
			}
		}
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
			throw new Error(`No optional package presets are available on ${process.platform}.`);
		}
		throw new Error(`Usage: feynman packages install <${installTargets.join("|")}>`);
	}

	const sources = getOptionalPackagePresetSources(target);
	if (!sources) {
		const normalizedPreset = normalizeOptionalPackagePresetName(target);
		if (normalizedPreset && !isOptionalPackagePresetSupported(normalizedPreset)) {
			console.log(`${normalizedPreset} is not available on this runtime.`);
			if (normalizedPreset === "session-search") {
				console.log(`Its sqlite-backed dependency is only supported through Node ${MAX_NATIVE_PACKAGE_NODE_MAJOR}.x.`);
			}
			return;
		}
		throw new Error(`Unknown package preset: ${target}`);
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

function getTelemetryCommandNames(appRoot: string): Set<string> {
	const names = new Set(topLevelCommandNames);
	try {
		for (const spec of readPromptSpecs(appRoot)) {
			if (spec.topLevelCli) names.add(spec.name);
		}
	} catch {
		// Telemetry labels are optional; command execution should keep going if prompt metadata is unavailable.
	}
	return names;
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
	return [
		`Warning: ${modelSpec} is a local provider.`,
		`Small local models often ignore /${workflowName}'s multi-step workflow and return a chat-only reply with no files under outputs/.`,
		"Use a stronger non-Pro model with `feynman model set <provider/model>` if this run produces no artifacts.",
	].join(" ");
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
		getAuthenticatedModelRecords(authPath),
		currentModelSpec,
	);
	return !status.currentValid;
}

export function parsePositiveInteger(value: string | undefined, fallback: number): number {
	if (!value) return fallback;
	const trimmed = value.trim();
	if (!/^\d+$/.test(trimmed)) return fallback;
	const parsed = Number(trimmed);
	return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function resolveWorkspaceInputPath(workingDir: string, value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	return trimmed ? resolve(workingDir, trimmed) : undefined;
}

export function resolveRankSynthesisModelSpec(authPath: string, explicitModelSpec: string | undefined): string | undefined {
	const trimmed = explicitModelSpec?.trim();
	if (trimmed) {
		if (isProClassModelSpec(trimmed)) {
			throw new Error(`Pro-class model disabled: ${trimmed}. Choose a non-Pro model.`);
		}
		return trimmed;
	}
	return chooseRecommendedModel(authPath)?.spec;
}

function createRankModelSynthesizer(options: {
	authPath: string;
	agentDir: string;
	cwd: string;
	modelSpec?: string;
}): ModelSynthesizer {
	return async ({ prompt }) => {
		const modelRegistry = createModelRegistry(options.authPath);
		const requestedModel = options.modelSpec?.trim();
		if (requestedModel && isProClassModelSpec(requestedModel)) {
			throw new Error(`Pro-class synthesis model disabled: ${requestedModel}. Choose a non-Pro model.`);
		}
		const recommendation = requestedModel ? undefined : chooseRecommendedModel(options.authPath);
		const resolvedModelSpec = requestedModel || recommendation?.spec;
		if (!resolvedModelSpec) {
			throw new Error("No non-Pro model is available for PaperRank synthesis. Run `feynman model login` for a non-Pro model or pass `--synthesis-model provider/model` with a non-Pro model.");
		}
		if (isProClassModelSpec(resolvedModelSpec)) {
			throw new Error(`Pro-class synthesis model disabled: ${resolvedModelSpec}. Choose a non-Pro model.`);
		}
		const model = parseModelSpec(resolvedModelSpec, modelRegistry);
		if (!model) {
			throw new Error(`Unknown synthesis model: ${resolvedModelSpec}`);
		}
		const resolvedModel = `${model.provider}/${model.id}`;
		const modelSelection: ModelSynthesisModelSelection = {
			source: requestedModel ? "explicit" : "recommended",
			...(requestedModel ? { requestedModel } : {}),
			resolvedModel,
			reason: requestedModel ? "explicit non-Pro CLI override" : recommendation?.reason,
		};
		const synthesisStartedAt = Date.now();
		const synthesisSpan = startTelemetrySpan("feynman.paperrank.model_synthesis", {
			model: resolvedModel,
			model_selection_source: modelSelection.source,
		});
		captureTelemetryEvent("feynman_paperrank_model_synthesis_started", {
			model: resolvedModel,
			model_selection_source: modelSelection.source,
		});
		const settingsManager = SettingsManager.create(options.cwd, options.agentDir, { projectTrusted: true });
		const { session } = await createAgentSession({
			cwd: options.cwd,
			agentDir: options.agentDir,
			authStorage: modelRegistry.authStorage,
			modelRegistry,
			model,
			sessionManager: SessionManager.inMemory(options.cwd),
			settingsManager,
			noTools: "all",
			tools: [],
		});
		let text = "";
		const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
			if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
				text += event.assistantMessageEvent.delta;
			}
		});
		const timeoutMs = parsePositiveInteger(process.env.FEYNMAN_RANK_SYNTHESIS_TIMEOUT_MS, 180_000);
		let timeout: NodeJS.Timeout | undefined;
		try {
			await Promise.race([
				session.prompt(prompt, { expandPromptTemplates: false }),
				new Promise<never>((_, reject) => {
					timeout = setTimeout(() => {
						void session.abort().catch(() => undefined);
						reject(new Error(`Model synthesis timed out after ${timeoutMs}ms`));
					}, timeoutMs);
				}),
			]);
			const response = {
				text: text.trim(),
				model: session.model ? `${session.model.provider}/${session.model.id}` : undefined,
				modelSelection,
			};
			const durationMs = Date.now() - synthesisStartedAt;
			synthesisSpan.setAttributes({
				duration_ms: durationMs,
				output_char_count: response.text.length,
				resolved_model: response.model,
			});
			synthesisSpan.end("ok");
			captureTelemetryEvent("feynman_paperrank_model_synthesis_completed", {
				duration_ms: durationMs,
				output_char_count: response.text.length,
				model: response.model,
				model_selection_source: modelSelection.source,
			});
			emitTelemetryLog("info", "feynman PaperRank model synthesis completed", {
				duration_ms: durationMs,
				model: response.model,
				model_selection_source: modelSelection.source,
			});
			return response;
		} catch (error) {
			const durationMs = Date.now() - synthesisStartedAt;
			synthesisSpan.recordException(error);
			synthesisSpan.end("error", {
				duration_ms: durationMs,
				...telemetryErrorProperties(error),
			});
			captureTelemetryEvent("feynman_paperrank_model_synthesis_failed", {
				duration_ms: durationMs,
				model: resolvedModel,
				model_selection_source: modelSelection.source,
				...telemetryErrorProperties(error),
			});
			emitTelemetryLog("error", "feynman PaperRank model synthesis failed", {
				duration_ms: durationMs,
				model: resolvedModel,
				model_selection_source: modelSelection.source,
				...telemetryErrorProperties(error),
			});
			throw error;
		} finally {
			if (timeout) clearTimeout(timeout);
			unsubscribe();
			session.dispose();
		}
	};
}

function formatRankModelSelection(selection: ModelSynthesisModelSelection | undefined): string | undefined {
	if (!selection) return undefined;
	const source = selection.source === "recommended"
		? "recommended current research model"
		: selection.source === "explicit"
			? "explicit override"
			: "selection source unknown";
	const resolved = selection.resolvedModel ? `resolved ${selection.resolvedModel}` : undefined;
	const requested = selection.requestedModel && selection.requestedModel !== selection.resolvedModel
		? `requested ${selection.requestedModel}`
		: undefined;
	return [source, requested, resolved].filter(Boolean).join("; ");
}

export function formatRankModelSynthesisLine(
	synthesis: Pick<ModelSynthesisOutcome, "status" | "model" | "modelSelection">,
	modelSynthesisPath?: string,
): string {
	const model = synthesis.model ? ` by ${synthesis.model}` : "";
	const selection = formatRankModelSelection(synthesis.modelSelection);
	const selectionText = selection ? ` (${selection})` : "";
	const path = modelSynthesisPath ? `; ${modelSynthesisPath}` : "";
	return `Model synthesis: ${synthesis.status}${model}${selectionText}${path}`;
}

function formatRankSignalReasons(score: PaperScore): string {
	const signalEntries = Object.values(score.signals)
		.filter((signal) => signal.available)
		.sort((a, b) => b.value - a.value)
		.slice(0, 2)
		.map((signal) => signal.explanation.replace(/\s+/g, " ").trim())
		.filter(Boolean);
	return signalEntries.length > 0
		? signalEntries.join("; ")
		: "available signals were normalized and missing components were excluded from the denominator";
}

export function formatRankCliSummaryLines(result: PaperRankRunResult): string[] {
	const topScore = result.scores[0];
	const fullTextAvailable = result.papers.filter((paper) => paper.fullTextStatus === "available").length;
	const fullTextPart = result.fullTextTop > 0
		? `full text ${fullTextAvailable}/${result.fullTextTop} available`
		: "full text not requested";
	const citationPart = result.citationExpansion.expandedPaperCount > 0
		? `citations +${result.citationExpansion.expandedPaperCount} expanded (${result.graph.edges.length} graph edges)`
		: "citation expansion not requested";
	const lines = [
		`PaperRank: ${result.scores.length} papers ranked. Report: ${result.artifacts.reportPath}`,
		topScore
			? `Read first: #${topScore.rank} ${topScore.title} (${topScore.readFirstScore.toFixed(1)}/100)`
			: "Read first: n/a",
		topScore ? `Why: ${formatRankSignalReasons(topScore)}` : "Why: no scored papers returned",
		`Evidence: ${citationPart}; ${fullTextPart}; reproduction ${result.reproduction.status}; calibration ${result.calibration.status}.`,
		`Inspect: score audit ${result.artifacts.scoreAuditPath}; graph ${result.artifacts.graphExplorerPath}; provenance ${result.artifacts.provenancePath}`,
		`Next: ${result.nextResearchActions.summary.actionCount} research actions summarized in ${result.artifacts.reportPath}`,
	];
	if (result.synthesis.requested || result.synthesis.status !== "not_requested") {
		lines.push(formatRankModelSynthesisLine(result.synthesis, result.artifacts.modelSynthesisPath));
	}
	if (result.critiques.length > 0) {
		lines.push(`Research critique: ${result.critiques.length} deterministic paper critiques in ${result.artifacts.critiquePath}`);
	}
	return lines;
}

export function formatPaperAccessCliSummaryLines(result: PaperAccessResult): string[] {
	const best = result.access.bestCandidate;
	const bestRoute = best
		? `${best.label} (${best.source}${best.canFetch ? ", fetchable" : ""})${best.url ? ` ${best.url}` : ""}`
		: "no legal access candidate found";
	const fullText = result.fullText.status === "available"
		? `available via ${result.fullText.source ?? "source-specific fetch"} (${result.fullText.length ?? 0} chars, ${result.fullText.sectionCount ?? 0} sections)`
		: result.fullText.status === "not_requested"
			? "not requested"
			: result.fullText.status;
	return [
		`Paper access: ${result.paper.title}`,
		`Best route: ${bestRoute}`,
		`Access: ${result.access.status}; ${result.access.candidates.length} candidate(s)`,
		`Full text: ${fullText}`,
		`Artifacts: report ${result.artifacts.reportPath}; json ${result.artifacts.jsonPath}`,
	];
}

export async function main(): Promise<void> {
	const here = dirname(fileURLToPath(import.meta.url));
	const appRoot = resolve(here, "..");
	const feynmanVersion = loadPackageVersion(appRoot).version;
	initializePostHogTelemetry({ appVersion: feynmanVersion, serviceName: "feynman-cli" });
	const commandTelemetry = getCliTelemetryMetadata(process.argv.slice(2), { knownCommands: getTelemetryCommandNames(appRoot) });
	const commandStartedAt = Date.now();
	const commandSpan = startTelemetrySpan("feynman.cli.command", commandTelemetry);
	captureTelemetryEvent("feynman_command_started", commandTelemetry);
	emitTelemetryLog("info", "feynman command started", commandTelemetry);
	try {
		await runMain({ here, appRoot, feynmanVersion });
		const durationMs = Date.now() - commandStartedAt;
		const exitCode = process.exitCode ?? 0;
		const completeProperties = {
			...commandTelemetry,
			duration_ms: durationMs,
			exit_code: exitCode,
		};
		commandSpan.end(exitCode === 0 ? "ok" : "error", completeProperties);
		captureTelemetryEvent(exitCode === 0 ? "feynman_command_completed" : "feynman_command_failed", completeProperties);
		emitTelemetryLog(exitCode === 0 ? "info" : "error", exitCode === 0 ? "feynman command completed" : "feynman command failed", completeProperties);
	} catch (error) {
		const durationMs = Date.now() - commandStartedAt;
		const failureProperties = {
			...commandTelemetry,
			duration_ms: durationMs,
			...telemetryErrorProperties(error),
		};
		commandSpan.recordException(error);
		commandSpan.end("error", failureProperties);
		captureTelemetryEvent("feynman_command_failed", failureProperties);
		emitTelemetryLog("error", "feynman command failed", failureProperties);
		throw error;
	} finally {
		await shutdownPostHogTelemetry();
	}
}

async function runMain(input: { here: string; appRoot: string; feynmanVersion: string | undefined }): Promise<void> {
	const { appRoot, feynmanVersion } = input;
	const bundledSettingsPath = resolve(appRoot, ".feynman", "settings.json");
	const feynmanHome = getFeynmanHome();
	const feynmanAgentDir = getFeynmanAgentDir(feynmanHome);

	ensureFeynmanHome(feynmanHome);
	syncBundledAssets(appRoot, feynmanAgentDir);

	const rawArgs = process.argv.slice(2);
	const alphaPassthrough = resolveAlphaPassthroughArgs(rawArgs);
	if (alphaPassthrough) {
		await runBundledAlphaCli(appRoot, alphaPassthrough.args, { cwd: alphaPassthrough.cwd });
		return;
	}

	const parseCliArgs = () =>
		parseArgs({
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
				json: { type: "boolean" },
				host: { type: "string" },
				limit: { type: "string" },
				"no-auth": { type: "boolean" },
				"no-open": { type: "boolean" },
				"expand-citations": { type: "string" },
				"full-text-top": { type: "string" },
				port: { type: "string" },
				"critique-top": { type: "string" },
				synthesize: { type: "boolean" },
				"synthesis-top": { type: "string" },
				"synthesis-model": { type: "string" },
				"output-dir": { type: "string" },
				"fetch-full-text": { type: "boolean" },
				"preference-file": { type: "string" },
				"reproduction-notes": { type: "string" },
				prompt: { type: "string" },
				"service-tier": { type: "string" },
				"session-dir": { type: "string" },
				"source-fixture": { type: "string" },
				"setup-preview": { type: "boolean" },
				"tier1-threshold": { type: "string" },
				"tier2-threshold": { type: "string" },
				thinking: { type: "string" },
				overlap: { type: "string" },
				"window-size": { type: "string" },
			},
		});

	let parsedArgs: ReturnType<typeof parseCliArgs>;
	try {
		parsedArgs = parseCliArgs();
	} catch (error) {
		if (error && typeof error === "object" && "code" in error && error.code === "ERR_PARSE_ARGS_UNKNOWN_OPTION") {
			const message = error instanceof Error ? error.message : String(error);
			throw new Error(`${message}\nRun \`feynman help\` to see available commands and flags.`);
		}
		throw error;
	}
	const { values, positionals } = parsedArgs;

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

	if (command === "serve") {
		await serveWorkbench({
			appRoot,
			sessionDir,
			feynmanAgentDir,
			settingsPath: feynmanSettingsPath,
			authPath: feynmanAuthPath,
			workingDir,
			version: feynmanVersion,
			host: values.host,
			port: parseWorkbenchPort(values.port),
			requireAuth: values["no-auth"] !== true,
			shouldOpen: values["no-open"] !== true,
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
		await handleUpdateCommand(workingDir, feynmanAgentDir, appRoot, feynmanVersion, rest[0]);
		return;
	}

	if (command === "alpha") {
		await runBundledAlphaCli(appRoot, rest, { cwd: workingDir });
		return;
	}

	if (command === "rank") {
		const topic = rest.join(" ").trim();
		const critiqueTop = parseCritiqueTop(values["critique-top"]);
		const synthesize = values.synthesize === true;
		const synthesisModelSpec = values["synthesis-model"] ?? values.model;
		for (const modelSpec of [values["synthesis-model"], values.model]) {
			if (typeof modelSpec === "string" && isProClassModelSpec(modelSpec)) {
				throw new Error(`Pro-class model disabled: ${modelSpec}. Choose a non-Pro model.`);
			}
		}
		const rankLimit = parseRankLimit(values.limit);
		const fullTextTop = parseFullTextTop(values["full-text-top"]);
		const citationExpansion = parseCitationExpansion(values["expand-citations"]);
		const synthesisTop = parseSynthesisTop(values["synthesis-top"]);
		const preferenceFile = values["preference-file"] ?? process.env.FEYNMAN_RANK_PREFERENCE_FILE;
		const reproductionNotes = values["reproduction-notes"] ?? process.env.FEYNMAN_RANK_REPRODUCTION_NOTES;
		const rankStartedAt = Date.now();
		const rankTelemetryBase = {
			limit: rankLimit,
			full_text_top: fullTextTop,
			citation_expansion: citationExpansion,
			critique_top: critiqueTop,
			synthesis_top: synthesisTop,
			synthesize,
			source_fixture: Boolean(values["source-fixture"] || process.env.FEYNMAN_RANK_FIXTURE),
			preference_file: Boolean(preferenceFile),
			reproduction_notes: Boolean(reproductionNotes),
		};
		const rankSpan = startTelemetrySpan("feynman.paperrank.run", rankTelemetryBase);
		captureTelemetryEvent("feynman_paperrank_started", rankTelemetryBase);
		emitTelemetryLog("info", "feynman PaperRank started", rankTelemetryBase);
		let result: Awaited<ReturnType<typeof runPaperRank>>;
		try {
			result = await runPaperRank({
				topic,
				limit: rankLimit,
				fullTextTop,
				citationExpansion,
				critiqueTop,
				synthesisTop,
				synthesize,
					...(synthesize
						? {
								modelSynthesizer: createRankModelSynthesizer({
									authPath: feynmanAuthPath,
									agentDir: feynmanAgentDir,
									cwd: workingDir,
									...(synthesisModelSpec ? { modelSpec: synthesisModelSpec } : {}),
								}),
							}
						: {}),
					outputDir: resolve(workingDir, values["output-dir"] ?? "outputs"),
					sourceFixture: resolveWorkspaceInputPath(workingDir, values["source-fixture"] ?? process.env.FEYNMAN_RANK_FIXTURE),
					preferenceFilePath: resolveWorkspaceInputPath(workingDir, preferenceFile),
					reproductionNotesPath: resolveWorkspaceInputPath(workingDir, reproductionNotes),
				});
			const fullText = {
				attempted: result.papers.filter((paper) => paper.fullTextStatus).length,
				available: result.papers.filter((paper) => paper.fullTextStatus === "available").length,
				missing: result.papers.filter((paper) => paper.fullTextStatus === "missing").length,
				errors: result.papers.filter((paper) => paper.fullTextStatus === "error").length,
			};
			const completeProperties = {
				...rankTelemetryBase,
				duration_ms: Date.now() - rankStartedAt,
				source: result.source,
				paper_count: result.papers.length,
				graph_paper_count: result.graphPapers.length,
				graph_edge_count: result.graph.edges.length,
				expanded_paper_count: result.citationExpansion.expandedPaperCount,
				full_text_attempted: fullText.attempted,
				full_text_available: fullText.available,
				full_text_missing: fullText.missing,
				full_text_errors: fullText.errors,
				critique_count: result.critiques.length,
				calibration_status: result.calibration.status,
				reproduction_status: result.reproduction.status,
				next_research_action_count: result.nextResearchActions.summary.actionCount,
				synthesis_status: result.synthesis.status,
				synthesis_model: result.synthesis.model,
				artifact_report: Boolean(result.artifacts.reportPath),
				artifact_graph_explorer: Boolean(result.artifacts.graphExplorerPath),
			};
			rankSpan.end("ok", completeProperties);
			captureTelemetryEvent("feynman_paperrank_completed", completeProperties);
			emitTelemetryLog("info", "feynman PaperRank completed", completeProperties);
		} catch (error) {
			const failureProperties = {
				...rankTelemetryBase,
				duration_ms: Date.now() - rankStartedAt,
				...telemetryErrorProperties(error),
			};
			rankSpan.recordException(error);
			rankSpan.end("error", failureProperties);
			captureTelemetryEvent("feynman_paperrank_failed", failureProperties);
			emitTelemetryLog("error", "feynman PaperRank failed", failureProperties);
			throw error;
		}
		if (values.json) {
			const fullText = {
				requestedTop: result.fullTextTop,
				attempted: result.papers.filter((paper) => paper.fullTextStatus).length,
				available: result.papers.filter((paper) => paper.fullTextStatus === "available").length,
				missing: result.papers.filter((paper) => paper.fullTextStatus === "missing").length,
				errors: result.papers.filter((paper) => paper.fullTextStatus === "error").length,
			};
			console.log(JSON.stringify({
				topic: result.topic,
				slug: result.slug,
				source: result.source,
				durationMs: Date.now() - rankStartedAt,
				paperCount: result.papers.length,
				graphPaperCount: result.graphPapers.length,
				citationExpansion: result.citationExpansion,
				fullText,
				critique: {
					requestedTop: critiqueTop,
					generated: result.critiques.length,
				},
				sensitivity: result.sensitivity.summary,
				calibration: result.calibration.summary,
				reproduction: result.reproduction.summary,
				nextResearchActions: result.nextResearchActions.summary,
				synthesis: {
					requested: result.synthesis.requested,
					status: result.synthesis.status,
					synthesisTop: result.synthesis.synthesisTop,
					model: result.synthesis.model,
					modelSelection: result.synthesis.modelSelection,
					error: result.synthesis.error,
				},
				topPaper: result.scores[0],
				artifacts: result.artifacts,
			}, null, 2));
		} else {
			console.log(formatRankCliSummaryLines(result).join("\n"));
		}
		return;
	}

	if (command === "paper") {
		const identifier = rest.join(" ").trim();
		const paperStartedAt = Date.now();
		const paperTelemetryBase = {
			fetch_full_text: values["fetch-full-text"] === true,
			source_fixture: Boolean(values["source-fixture"]),
		};
		const paperSpan = startTelemetrySpan("feynman.paper_access.run", paperTelemetryBase);
		captureTelemetryEvent("feynman_paper_access_started", paperTelemetryBase);
		emitTelemetryLog("info", "feynman paper access started", paperTelemetryBase);
		let result: Awaited<ReturnType<typeof resolvePaperAccess>>;
		try {
			result = await resolvePaperAccess({
				identifier,
				outputDir: resolve(workingDir, values["output-dir"] ?? "outputs"),
				sourceFixture: resolveWorkspaceInputPath(workingDir, values["source-fixture"]),
				fetchFullText: values["fetch-full-text"] === true,
			});
			const completeProperties = {
				...paperTelemetryBase,
				duration_ms: Date.now() - paperStartedAt,
				source: result.source,
				access_status: result.access.status,
				access_candidate_count: result.access.candidates.length,
				full_text_status: result.fullText.status,
				full_text_length: result.fullText.length,
				artifact_report: Boolean(result.artifacts.reportPath),
			};
			paperSpan.end("ok", completeProperties);
			captureTelemetryEvent("feynman_paper_access_completed", completeProperties);
			emitTelemetryLog("info", "feynman paper access completed", completeProperties);
		} catch (error) {
			const failureProperties = {
				...paperTelemetryBase,
				duration_ms: Date.now() - paperStartedAt,
				...telemetryErrorProperties(error),
			};
			paperSpan.recordException(error);
			paperSpan.end("error", failureProperties);
			captureTelemetryEvent("feynman_paper_access_failed", failureProperties);
			emitTelemetryLog("error", "feynman paper access failed", failureProperties);
			throw error;
		}
		if (values.json) {
			console.log(JSON.stringify({
				identifier: result.identifier,
				slug: result.slug,
				source: result.source,
				durationMs: Date.now() - paperStartedAt,
				paper: {
					paperId: result.paper.paperId,
					title: result.paper.title,
					doi: result.paper.doi,
					arxivId: result.paper.arxivId,
					pmid: result.paper.pmid,
					pmcid: result.paper.pmcid,
				},
				access: {
					status: result.access.status,
					candidateCount: result.access.candidates.length,
					bestCandidate: result.access.bestCandidate,
				},
				fullText: result.fullText,
				artifacts: result.artifacts,
			}, null, 2));
		} else {
			console.log(formatPaperAccessCliSummaryLines(result).join("\n"));
		}
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
		if (isProClassModelSpec(explicitModelSpec)) {
			throw new Error(`Pro-class model disabled: ${explicitModelSpec}. Choose a non-Pro model.`);
		}
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
	const resumeRecentSession =
		!values["new-session"] &&
		mode !== "rpc" &&
		mode !== "json" &&
		!promptOptions.oneShotPrompt &&
		!promptOptions.initialPrompt;
	let preLaunchNotice: string | undefined;
	if (command && workflowCommandNames.has(command) && mode !== "rpc" && mode !== "json" && process.stdout.isTTY) {
		const effectiveSpec = explicitModelSpec ?? getCurrentModelSpec(feynmanSettingsPath);
		const providerId = effectiveSpec?.split("/")[0] ?? "";
		if (effectiveSpec && isLocalModelProvider(feynmanAuthPath, providerId)) {
			preLaunchNotice = buildLocalModelWorkflowNotice(effectiveSpec, command);
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
		resumeRecentSession,
		preLaunchNotice,
		...promptOptions,
	});
}
