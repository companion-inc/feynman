import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { ModelRegistry, type PackageSource } from "@mariozechner/pi-coding-agent";

import { CORE_PACKAGE_SOURCES, shouldPruneLegacyDefaultPackages } from "./package-presets.js";
import { createModelRegistry } from "../model/registry.js";

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

export function parseModelSpec(spec: string, modelRegistry: ModelRegistry) {
	const trimmed = spec.trim();
	const separator = trimmed.includes(":") ? ":" : trimmed.includes("/") ? "/" : null;
	if (!separator) {
		return undefined;
	}

	const [provider, ...rest] = trimmed.split(separator);
	const id = rest.join(separator);
	if (!provider || !id) {
		return undefined;
	}

	return modelRegistry.find(provider, id);
}

export function normalizeThinkingLevel(value: string | undefined): ThinkingLevel | undefined {
	if (!value) {
		return undefined;
	}

	const normalized = value.toLowerCase();
	if (
		normalized === "off" ||
		normalized === "minimal" ||
		normalized === "low" ||
		normalized === "medium" ||
		normalized === "high" ||
		normalized === "xhigh"
	) {
		return normalized;
	}

	return undefined;
}

function choosePreferredModel(
	availableModels: Array<{ provider: string; id: string }>,
): { provider: string; id: string } | undefined {
	const preferences = [
		{ provider: "anthropic", id: "claude-opus-4-6" },
		{ provider: "anthropic", id: "claude-opus-4-5" },
		{ provider: "anthropic", id: "claude-sonnet-4-5" },
		{ provider: "openai", id: "gpt-5.4" },
		{ provider: "openai", id: "gpt-5" },
	];

	for (const preferred of preferences) {
		const match = availableModels.find(
			(model) => model.provider === preferred.provider && model.id === preferred.id,
		);
		if (match) {
			return match;
		}
	}

	return availableModels[0];
}

export function readJson(path: string): Record<string, unknown> {
	if (!existsSync(path)) {
		return {};
	}

	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch {
		return {};
	}
}

export function normalizeFeynmanSettings(
	settingsPath: string,
	bundledSettingsPath: string,
	defaultThinkingLevel: ThinkingLevel,
	authPath: string,
): void {
	let settings: Record<string, unknown> = {};

	if (existsSync(settingsPath)) {
		try {
			settings = JSON.parse(readFileSync(settingsPath, "utf8"));
		} catch {
			settings = {};
		}
	} else if (existsSync(bundledSettingsPath)) {
		try {
			settings = JSON.parse(readFileSync(bundledSettingsPath, "utf8"));
		} catch {
			settings = {};
		}
	}

	if (!settings.defaultThinkingLevel) {
		settings.defaultThinkingLevel = defaultThinkingLevel;
	}
	if (settings.editorPaddingX === undefined) {
		settings.editorPaddingX = 1;
	}
	settings.theme = "feynman";
	settings.quietStartup = true;
	settings.collapseChangelog = true;
	if (!Array.isArray(settings.packages) || settings.packages.length === 0) {
		settings.packages = [...CORE_PACKAGE_SOURCES];
	} else if (shouldPruneLegacyDefaultPackages(settings.packages as PackageSource[])) {
		settings.packages = [...CORE_PACKAGE_SOURCES];
	}

	const modelRegistry = createModelRegistry(authPath);
	const availableModels = modelRegistry.getAvailable().map((model) => ({
		provider: model.provider,
		id: model.id,
	}));

	if ((!settings.defaultProvider || !settings.defaultModel) && availableModels.length > 0) {
		const preferredModel = choosePreferredModel(availableModels);
		if (preferredModel) {
			settings.defaultProvider = preferredModel.provider;
			settings.defaultModel = preferredModel.id;
		}
	}

	mkdirSync(dirname(settingsPath), { recursive: true });
	writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n", "utf8");
}
