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
	"npm:@kaiserlich-dev/pi-session-search",
	"npm:pi-schedule-prompt",
	"npm:@samfp/pi-memory",
	"npm:@tmustier/pi-ralph-wiggum",
] as const;

export const NATIVE_PACKAGE_SOURCES = [
	"npm:@kaiserlich-dev/pi-session-search",
	"npm:@samfp/pi-memory",
] as const;

export const MIN_NATIVE_PACKAGE_NODE_MAJOR = 22;
export const MAX_NATIVE_PACKAGE_NODE_MAJOR = 24;

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

function parseNodeMajor(version: string): number {
	const [major = "0"] = version.replace(/^v/, "").split(".");
	return Number.parseInt(major, 10) || 0;
}

export function supportsNativePackageSources(version = process.versions.node): boolean {
	const major = parseNodeMajor(version);
	return major >= MIN_NATIVE_PACKAGE_NODE_MAJOR && major <= MAX_NATIVE_PACKAGE_NODE_MAJOR;
}

export function filterPackageSourcesForCurrentNode<T extends string>(sources: readonly T[], version = process.versions.node): T[] {
	if (supportsNativePackageSources(version)) {
		return [...sources];
	}

	const blocked = new Set<string>(NATIVE_PACKAGE_SOURCES);
	return sources.filter((source) => !blocked.has(source));
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
