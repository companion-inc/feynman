import { isLoggedIn as isAlphaLoggedIn, login as loginAlpha } from "@companion-ai/alpha-hub/lib";

import { getDefaultSessionDir, getFeynmanHome } from "../config/paths.js";
import { getPiWebAccessStatus, getPiWebSearchConfigPath } from "../pi/web-access.js";
import { normalizeFeynmanSettings } from "../pi/settings.js";
import type { ThinkingLevel } from "../pi/settings.js";
import { getCurrentModelSpec, runModelSetup } from "../model/commands.js";
import { buildModelStatusSnapshotFromRecords, getAvailableModelRecords, getSupportedModelRecords } from "../model/catalog.js";
import { PANDOC_FALLBACK_PATHS, resolveExecutable } from "../system/executables.js";
import { setupPreviewDependencies } from "./preview.js";
import { runDoctor } from "./doctor.js";
import { printInfo, printSection, printSuccess } from "../ui/terminal.js";

type SetupOptions = {
	settingsPath: string;
	bundledSettingsPath: string;
	authPath: string;
	workingDir: string;
	sessionDir: string;
	appRoot: string;
	defaultThinkingLevel?: ThinkingLevel;
};

function isInteractiveTerminal(): boolean {
	return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

function printNonInteractiveSetupGuidance(): void {
	printInfo("Non-interactive terminal. Use explicit commands:");
	printInfo("  feynman model login <provider>");
	printInfo("  feynman model set <provider/model>");
	printInfo("  # or configure API keys via env vars/auth.json and rerun `feynman model list`");
	printInfo("  feynman alpha login");
	printInfo("  feynman doctor");
}

export async function runSetup(options: SetupOptions): Promise<void> {
	if (!isInteractiveTerminal()) {
		printNonInteractiveSetupGuidance();
		return;
	}

	await runModelSetup(options.settingsPath, options.authPath);

	if (!isAlphaLoggedIn()) {
		await loginAlpha();
		printSuccess("alphaXiv login complete");
	}

	const result = setupPreviewDependencies();
	printSuccess(result.message);

	normalizeFeynmanSettings(
		options.settingsPath,
		options.bundledSettingsPath,
		options.defaultThinkingLevel ?? "medium",
		options.authPath,
	);

	const modelStatus = buildModelStatusSnapshotFromRecords(
		getSupportedModelRecords(options.authPath),
		getAvailableModelRecords(options.authPath),
		getCurrentModelSpec(options.settingsPath),
	);
	printSection("Ready");
	printInfo(`Model: ${getCurrentModelSpec(options.settingsPath) ?? "not set"}`);
	printInfo(`alphaXiv: ${isAlphaLoggedIn() ? "configured" : "not configured"}`);
	printInfo(`Preview: ${resolveExecutable("pandoc", PANDOC_FALLBACK_PATHS) ? "configured" : "not configured"}`);
	printInfo(`Web: ${getPiWebAccessStatus().routeLabel}`);
}
