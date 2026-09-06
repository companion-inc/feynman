import { isLoggedIn as isAlphaLoggedIn, login as loginAlpha } from "@advaitpaliwal/alpha-hub/lib";
import { dirname } from "node:path";

import { getPiWebAccessStatus } from "../pi/web-access.js";
import { normalizeFeynmanSettings } from "../pi/settings.js";
import type { ThinkingLevel } from "../pi/settings.js";
import { getMissingConfiguredPackages, installPackageSources } from "../pi/package-ops.js";
import { listOptionalPackagePresets } from "../pi/package-presets.js";
import { getCurrentModelSpec, runModelSetup } from "../model/commands.js";
import { buildModelStatusSnapshotFromRecords, getAvailableModelRecords, getSupportedModelRecords } from "../model/catalog.js";
import { PANDOC_FALLBACK_PATHS, resolveExecutable } from "../system/executables.js";
import { setupPreviewDependencies } from "./preview.js";
import { printInfo, printSection, printSuccess } from "../ui/terminal.js";
import {
	isInteractiveTerminal,
	promptConfirm,
	promptIntro,
	promptMultiSelect,
	promptOutro,
	SetupCancelledError,
} from "./prompts.js";

type SetupOptions = {
	settingsPath: string;
	bundledSettingsPath: string;
	authPath: string;
	workingDir: string;
	sessionDir: string;
	appRoot: string;
	defaultThinkingLevel?: ThinkingLevel;
	researchToolsExtensionPath?: string;
};

function printNonInteractiveSetupGuidance(): void {
	printInfo("Non-interactive terminal. Use explicit commands:");
	printInfo("  feynman model login <provider>");
	printInfo("  feynman model set <provider/model>");
	printInfo("  # or configure API keys via env vars/auth.json and rerun `feynman model list`");
	printInfo("  feynman alpha login");
	printInfo("  feynman doctor");
}

function summarizePackageSources(sources: string[]): string {
	if (sources.length <= 3) {
		return sources.join(", ");
	}

	return `${sources.slice(0, 3).join(", ")} +${sources.length - 3} more`;
}

async function maybeInstallBundledPackages(options: SetupOptions): Promise<void> {
	const agentDir = dirname(options.authPath);
	const { missing, bundled } = getMissingConfiguredPackages(options.workingDir, agentDir, options.appRoot);
	const userMissing = missing.filter((entry) => entry.scope === "user").map((entry) => entry.source);
	const projectMissing = missing.filter((entry) => entry.scope === "project").map((entry) => entry.source);

	printSection("Packages");
	if (bundled.length > 0) {
		printInfo(`Bundled research packages ready: ${summarizePackageSources(bundled.map((entry) => entry.source))}`);
	}

	if (missing.length === 0) {
		printInfo("No additional package install required.");
		return;
	}

	printInfo(`Missing packages: ${summarizePackageSources(missing.map((entry) => entry.source))}`);
	const shouldInstall = await promptConfirm("Install missing Feynman packages now?", true);
	if (!shouldInstall) {
		printInfo("Skipping package install. Feynman may install missing packages later if needed.");
		return;
	}

	if (userMissing.length > 0) {
		try {
			await installPackageSources(options.workingDir, agentDir, userMissing);
			printSuccess(`Installed bundled packages: ${summarizePackageSources(userMissing)}`);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			printInfo(message.includes("No supported package manager found")
				? "No package manager available for additional installs. The standalone bundle can still run with its shipped packages."
				: `Package install skipped: ${message}`);
		}
	}

	if (projectMissing.length > 0) {
		try {
			await installPackageSources(options.workingDir, agentDir, projectMissing, { local: true });
			printSuccess(`Installed project packages: ${summarizePackageSources(projectMissing)}`);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			printInfo(`Project package install skipped: ${message}`);
		}
	}
}

async function maybeInstallOptionalPackages(options: SetupOptions): Promise<void> {
	const agentDir = dirname(options.authPath);
	const presets = listOptionalPackagePresets();
	if (presets.length === 0) {
		return;
	}

	const selectedPresets = await promptMultiSelect(
		"Optional packages",
		presets.map((preset) => ({
			value: preset.name,
			label: preset.name,
			hint: preset.description,
		})),
		[],
	);

	if (selectedPresets.length === 0) {
		printInfo("No optional packages selected.");
		return;
	}

	for (const presetName of selectedPresets) {
		const preset = presets.find((entry) => entry.name === presetName);
		if (!preset) continue;
		try {
			await installPackageSources(options.workingDir, agentDir, preset.sources, {
				persist: true,
			});
			printSuccess(`Installed optional preset: ${preset.name}`);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			printInfo(message.includes("No supported package manager found")
				? `Skipped optional preset ${preset.name}: no package manager available.`
				: `Skipped optional preset ${preset.name}: ${message}`);
		}
	}
}

async function maybeLoginAlpha(): Promise<void> {
	if (isAlphaLoggedIn()) {
		printInfo("alphaXiv already configured.");
		return;
	}

	const shouldLogin = await promptConfirm("Connect alphaXiv now?", true);
	if (!shouldLogin) {
		printInfo("Skipping alphaXiv login for now.");
		return;
	}

	try {
		await loginAlpha();
		printSuccess("alphaXiv login complete");
	} catch (error) {
		printInfo(`alphaXiv login skipped: ${error instanceof Error ? error.message : String(error)}`);
	}
}

async function maybeInstallPreviewDependencies(): Promise<void> {
	if (resolveExecutable("pandoc", PANDOC_FALLBACK_PATHS)) {
		printInfo("Preview support already configured.");
		return;
	}

	const shouldInstall = await promptConfirm("Install pandoc for preview/export support?", false);
	if (!shouldInstall) {
		printInfo("Skipping preview dependency install.");
		return;
	}

	try {
		const result = setupPreviewDependencies();
		printSuccess(result.message);
	} catch (error) {
		printInfo(`Preview setup skipped: ${error instanceof Error ? error.message : String(error)}`);
	}
}

export async function runSetup(options: SetupOptions): Promise<void> {
	if (!isInteractiveTerminal()) {
		printNonInteractiveSetupGuidance();
		return;
	}

	try {
		await promptIntro("Feynman setup");
		await runModelSetup(options.settingsPath, options.authPath);
		await maybeInstallBundledPackages(options);
		await maybeInstallOptionalPackages(options);
		await maybeLoginAlpha();
		await maybeInstallPreviewDependencies();

		await normalizeFeynmanSettings(
			options.settingsPath,
			options.bundledSettingsPath,
			options.defaultThinkingLevel ?? "medium",
			options.authPath,
			{ researchToolsExtensionPath: options.researchToolsExtensionPath },
		);

		const modelStatus = buildModelStatusSnapshotFromRecords(
			await getSupportedModelRecords(options.authPath),
			await getAvailableModelRecords(options.authPath),
			getCurrentModelSpec(options.settingsPath),
		);
		printSection("Ready");
		printInfo(`Model: ${getCurrentModelSpec(options.settingsPath) ?? "not set"}`);
		printInfo(`alphaXiv: ${isAlphaLoggedIn() ? "configured" : "not configured"}`);
		printInfo(`Preview: ${resolveExecutable("pandoc", PANDOC_FALLBACK_PATHS) ? "configured" : "not configured"}`);
		printInfo(`Web: ${getPiWebAccessStatus().routeLabel}`);
		if (modelStatus.recommended && !modelStatus.currentValid) {
			printInfo(`Recommended model: ${modelStatus.recommended}`);
		}

		await promptOutro("Feynman is ready");
	} catch (error) {
		if (error instanceof SetupCancelledError) {
			printInfo("Setup cancelled.");
			return;
		}

		throw error;
	}
}
