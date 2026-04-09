import type { PackageSource } from "@mariozechner/pi-coding-agent";

export const CORE_PACKAGE_SOURCES = [
	"npm:@companion-ai/alpha-hub",
	"npm:pi-subagents",
	"npm:pi-btw",
	"npm:pi-docparser",
	"npm:pi-web-access",
	"npm:pi-markdown-preview",
	"npm:@walterra/pi-charts",
	"npm:pi-mermaid",
	"npm:@aliou/pi-processes",
	"npm:pi-zotero",
	"npm:pi-schedule-prompt",
	"npm:@tmustier/pi-ralph-wiggum",
] as const;

export const OPTIONAL_PACKAGE_PRESETS = {
	"generative-ui": {
		description: "Interactive Glimpse UI widgets.",
		sources: ["npm:pi-generative-ui"],
	},
} as const;

export type OptionalPackagePresetName = keyof typeof OPTIONAL_PACKAGE_PRESETS;

const LEGACY_DEFAULT_PACKAGE_SOURCES = [
	...CORE_PACKAGE_SOURCES,
	"npm:pi-generative-ui",
] as const;

function arraysMatchAsSets(left: readonly string[], right: readonly string[]): boolean {
	if (left.length !== right.length) {
		return false;
	}

	const rightSet = new Set(right);
	return left.every((entry) => rightSet.has(entry));
}

export function shouldPruneLegacyDefaultPackages(packages: PackageSource[] | undefined): boolean {
	if (!Array.isArray(packages)) {
		return false;
	}
	if (packages.some((entry) => typeof entry !== "string")) {
		return false;
	}
	return arraysMatchAsSets(packages as string[], LEGACY_DEFAULT_PACKAGE_SOURCES);
}

export function getOptionalPackagePresetSources(name: string): string[] | undefined {
	const normalized = name.trim().toLowerCase();
	if (normalized === "ui") {
		return [...OPTIONAL_PACKAGE_PRESETS["generative-ui"].sources];
	}

	const preset = OPTIONAL_PACKAGE_PRESETS[normalized as OptionalPackagePresetName];
	return preset ? [...preset.sources] : undefined;
}

export function listOptionalPackagePresets(): Array<{
	name: OptionalPackagePresetName;
	description: string;
	sources: string[];
}> {
	return Object.entries(OPTIONAL_PACKAGE_PRESETS).map(([name, preset]) => ({
		name: name as OptionalPackagePresetName,
		description: preset.description,
		sources: [...preset.sources],
	}));
}
