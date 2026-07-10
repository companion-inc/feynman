import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, extname, relative, resolve, sep } from "node:path";

import { CORE_PACKAGE_SOURCES, filterPackageSourcesForCurrentNode, listOptionalPackagePresets } from "../pi/package-presets.js";
import type { WorkbenchResource } from "./types.js";

const MAX_RESOURCE_FILES = 240;

type PackageSettingsEntry = {
	source: string;
	filters: string[];
};

type PackageManifestSummary = {
	description?: string;
	version?: string;
	pi?: {
		extensions?: unknown[];
		skills?: unknown[];
		prompts?: unknown[];
		themes?: unknown[];
		image?: string;
		video?: string;
	};
};

function toPosixPath(path: string): string {
	return path.split(sep).join("/");
}

function normalizeResourceId(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 90) || "resource";
}

function listFiles(root: string, predicate: (name: string, absPath: string) => boolean, maxFiles = MAX_RESOURCE_FILES): string[] {
	const results: string[] = [];
	function walk(dir: string): void {
		if (results.length >= maxFiles || !existsSync(dir)) return;
		for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
			const absPath = resolve(dir, entry.name);
			if (entry.isDirectory()) {
				if (entry.name === "node_modules" || entry.name === ".git") continue;
				walk(absPath);
				continue;
			}
			if (entry.isFile() && predicate(entry.name, absPath)) results.push(absPath);
			if (results.length >= maxFiles) return;
		}
	}
	walk(root);
	return results;
}

function readJsonObject(path: string): Record<string, unknown> | undefined {
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
		return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
	} catch {
		return undefined;
	}
}

function stringList(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function packageSettingsEntry(value: unknown): PackageSettingsEntry | undefined {
	if (typeof value === "string" && value.trim()) {
		return { source: value.trim(), filters: [] };
	}
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const record = value as Record<string, unknown>;
	const source = typeof record.source === "string" ? record.source.trim() : "";
	if (!source) return undefined;
	const filters = ["extensions", "skills", "prompts", "themes"].flatMap((key) => {
		if (!Array.isArray(record[key])) return [];
		const entries = stringList(record[key]);
		return entries.length ? entries.map((entry) => `${key}:${entry}`) : [`${key}:[]`];
	});
	return { source, filters };
}

function packageNameFromSource(source: string): string {
	const normalized = source
		.replace(/^npm:/, "")
		.replace(/^git:/, "")
		.replace(/^https?:\/\//, "")
		.replace(/^file:/, "");
	const withoutRef = normalized.includes("@") && !normalized.startsWith("@")
		? normalized.split("@")[0] ?? normalized
		: normalized.replace(/(@[^/]+\/[^@]+)@.+$/, "$1");
	const scoped = withoutRef.match(/^(@[^/]+\/[^@/]+)/);
	if (scoped) return scoped[1];
	return withoutRef.split("/")[0] ?? withoutRef;
}

function packageLabel(source: string): string {
	return packageNameFromSource(source)
		.replace(/^@[^/]+\//, "")
		.replace(/@latest$/, "");
}

function installedPackageRoot(workingDir: string, source: string): string | undefined {
	if (!source.startsWith("npm:")) return undefined;
	const packageName = packageNameFromSource(source);
	for (const root of [
		resolve(workingDir, ".feynman", "npm", "node_modules", packageName),
		resolve(workingDir, "node_modules", packageName),
	]) {
		if (existsSync(resolve(root, "package.json"))) return root;
	}
	return undefined;
}

function installedPackageRelPath(workingDir: string, source: string): string | undefined {
	const root = installedPackageRoot(workingDir, source);
	return root ? toPosixPath(relative(workingDir, root)) : undefined;
}

function readPackageManifest(workingDir: string, source: string): PackageManifestSummary | undefined {
	const root = installedPackageRoot(workingDir, source);
	if (!root) return undefined;
	const manifest = readJsonObject(resolve(root, "package.json"));
	if (!manifest) return undefined;
	const pi = manifest.pi && typeof manifest.pi === "object" && !Array.isArray(manifest.pi)
		? manifest.pi as Record<string, unknown>
		: undefined;
	return {
		...(typeof manifest.description === "string" ? { description: manifest.description } : {}),
		...(typeof manifest.version === "string" ? { version: manifest.version } : {}),
		...(pi ? {
			pi: {
				...(Array.isArray(pi.extensions) ? { extensions: pi.extensions } : {}),
				...(Array.isArray(pi.skills) ? { skills: pi.skills } : {}),
				...(Array.isArray(pi.prompts) ? { prompts: pi.prompts } : {}),
				...(Array.isArray(pi.themes) ? { themes: pi.themes } : {}),
				...(typeof pi.image === "string" ? { image: pi.image } : {}),
				...(typeof pi.video === "string" ? { video: pi.video } : {}),
			},
		} : {}),
	};
}

function packageResourceCounts(summary: PackageManifestSummary | undefined): string[] {
	const pi = summary?.pi;
	if (!pi) return [];
	return [
		...(pi.extensions?.length ? [`${pi.extensions.length} extensions`] : []),
		...(pi.skills?.length ? [`${pi.skills.length} skills`] : []),
		...(pi.prompts?.length ? [`${pi.prompts.length} prompts`] : []),
		...(pi.themes?.length ? [`${pi.themes.length} themes`] : []),
	];
}

function packageKindTags(source: string, optionalPresetName: string | undefined): string[] {
	const tags = ["package"];
	if ((CORE_PACKAGE_SOURCES as readonly string[]).includes(source)) tags.push("core");
	if (optionalPresetName) tags.push("optional", optionalPresetName);
	if (source.includes("web")) tags.push("web");
	if (source.includes("doc")) tags.push("documents");
	if (source.includes("otel")) tags.push("observability");
	if (source.includes("subagent")) tags.push("agents");
	return tags;
}

function packageDiagnostics(
	workingDir: string,
	entry: PackageSettingsEntry,
	options: {
		configured: boolean;
		core: boolean;
		installed: boolean;
		optionalPreset?: string;
		resourceCounts: string[];
	},
): string[] {
	const installPath = installedPackageRelPath(workingDir, entry.source);
	return [
		options.configured
			? "Project config: enabled in .feynman/settings.json."
			: options.core
				? "Project config: core package is known but not enabled in this workspace."
				: "Project config: available preset, not enabled in this workspace.",
		options.installed && installPath
			? `Install state: package manifest found at ${installPath}.`
			: "Install state: package manifest not found locally; Pi installs missing trusted project packages on startup.",
		options.resourceCounts.length
			? `Declared resources: ${options.resourceCounts.join(", ")}.`
			: "Declared resources: no Pi manifest resources were found in package.json.",
		entry.filters.length
			? `Active filters: ${entry.filters.join(", ")}.`
			: "Active filters: all manifest resources are eligible.",
		options.optionalPreset ? `Preset: ${options.optionalPreset}.` : "Preset: core/project connector.",
		"Grant boundary: Pi packages and extensions run with the local Pi process; project trust gates loading, not runtime sandboxing.",
	];
}

export function buildConnectorResources(workingDir: string): WorkbenchResource[] {
	const settings = readJsonObject(resolve(workingDir, ".feynman", "settings.json"));
	const configuredEntries = Array.isArray(settings?.packages)
		? settings.packages.map(packageSettingsEntry).filter((entry): entry is PackageSettingsEntry => Boolean(entry))
		: [];
	const configuredSources = new Set(configuredEntries.map((entry) => entry.source));
	const optionalPresets = listOptionalPackagePresets();
	const optionalBySource = new Map(optionalPresets.flatMap((preset) => preset.sources.map((source) => [source, preset.name] as const)));
	const packageEntries = [
		...configuredEntries,
		...filterPackageSourcesForCurrentNode(CORE_PACKAGE_SOURCES).filter((source) => !configuredSources.has(source)).map((source) => ({
			source,
			filters: [],
		})),
		...optionalPresets.flatMap((preset) => preset.sources
			.filter((source) => !configuredSources.has(source))
			.map((source) => ({ source, filters: [] }))),
	];
	const seenPackageSources = new Set<string>();
	const packages = packageEntries.flatMap((entry) => {
		if (seenPackageSources.has(entry.source)) return [];
		seenPackageSources.add(entry.source);
		const manifest = readPackageManifest(workingDir, entry.source);
		const resourceCounts = packageResourceCounts(manifest);
		const optionalPreset = optionalBySource.get(entry.source);
		const configured = configuredSources.has(entry.source);
		const core = (CORE_PACKAGE_SOURCES as readonly string[]).includes(entry.source);
		const installed = Boolean(manifest);
		const details = [
			entry.source,
			...(manifest?.version ? [`v${manifest.version}`] : []),
			...(resourceCounts.length ? [resourceCounts.join(", ")] : []),
			...(entry.filters.length ? [`filters: ${entry.filters.join(", ")}`] : []),
		];
		return [{
			id: normalizeResourceId(`package-${entry.source}`),
			name: packageLabel(entry.source),
			description: manifest?.description
				?? (configured ? `Pi package configured from ${entry.source}.` : `Pi package available from ${entry.source}.`),
			status: configured ? "configured" as const : core ? "disabled" as const : "available" as const,
			source: core ? "Pi core package" : optionalPreset ? "Pi optional package" : "Pi package",
			connectorKind: "package",
			section: configured ? "Configured packages" : core ? "Core packages" : "Optional packages",
			detail: details.join(" | "),
			diagnostics: packageDiagnostics(workingDir, entry, {
				configured,
				core,
				installed,
				...(optionalPreset ? { optionalPreset } : {}),
				resourceCounts,
			}),
			packageSources: [entry.source],
			packageAction: configured ? "disable" as const : "enable" as const,
			tags: [
				...packageKindTags(entry.source, optionalPreset),
				...(installed ? ["installed"] : ["not installed"]),
				...resourceCounts,
			],
		} satisfies WorkbenchResource];
	});
	const extensionRoot = resolve(workingDir, "extensions");
	const extensionFiles = listFiles(
		extensionRoot,
		(name, absPath) => (name.endsWith(".ts") || name.endsWith(".js")) && relative(extensionRoot, absPath).split(sep).length === 1,
	).map((path) => ({
		id: normalizeResourceId(`extension-${relative(workingDir, path)}`),
		name: basename(path, extname(path)),
		description: "Project Pi extension loaded into workbench chat sessions.",
		status: "configured" as const,
		source: "Pi extension",
		section: "Project extensions",
		path: toPosixPath(relative(workingDir, path)),
		tags: ["extension", "tools"],
	}));
	return [...packages, ...extensionFiles];
}

export interface ExtensionSummary {
	projectExtensions: { name: string; path: string }[];
	packageExtensions: { name: string; source: string; count: number }[];
}

const EXTENSION_COUNT_TAG = /^(\d+) extensions?$/;

// Derives the extensions view from the shared connector enumeration so the CLI
// `feynman extensions` command and the workbench stay in sync. Project
// extensions are the loose .ts/.js files under ./extensions; package extensions
// are surfaced by installed Pi packages that declare `pi.extensions`.
export function summarizeExtensions(workingDir: string): ExtensionSummary {
	const resources = buildConnectorResources(workingDir);
	const projectExtensions = resources
		.filter((resource) => resource.section === "Project extensions")
		.map((resource) => ({ name: resource.name, path: resource.path ?? resource.name }));
	const packageExtensions = resources.flatMap((resource) => {
		if (resource.connectorKind !== "package") return [];
		const countTag = resource.tags?.find((tag) => EXTENSION_COUNT_TAG.test(tag));
		const count = countTag ? Number.parseInt(countTag, 10) : 0;
		if (!Number.isInteger(count) || count <= 0) return [];
		return [{ name: resource.name, source: resource.packageSources?.[0] ?? resource.name, count }];
	});
	return { projectExtensions, packageExtensions };
}
