import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { getFeynmanHome } from "../config/paths.js";

export type PiWebSearchProvider = "auto" | "perplexity" | "exa" | "gemini";
export type PiWebSearchWorkflow = "none" | "summary-review";

export type PiWebAccessConfig = Record<string, unknown> & {
	route?: PiWebSearchProvider;
	provider?: PiWebSearchProvider;
	searchProvider?: PiWebSearchProvider;
	workflow?: PiWebSearchWorkflow;
	perplexityApiKey?: string;
	exaApiKey?: string;
	geminiApiKey?: string;
	chromeProfile?: string;
	geminiBrowser?: boolean;
	allowBrowserAuth?: boolean;
	browserAuth?: boolean;
};

export type PiWebAccessStatus = {
	configPath: string;
	configExists: boolean;
	searchProvider: PiWebSearchProvider;
	requestProvider: PiWebSearchProvider;
	workflow: PiWebSearchWorkflow;
	perplexityConfigured: boolean;
	exaConfigured: boolean;
	geminiApiConfigured: boolean;
	chromeProfile?: string;
	geminiBrowserEnabled: boolean;
	routeLabel: string;
	note: string;
};

export function getPiWebSearchConfigPath(home?: string): string {
	const feynmanHome = home ? resolve(home, ".feynman") : getFeynmanHome();
	return resolve(feynmanHome, "web-search.json");
}

function normalizeProvider(value: unknown): PiWebSearchProvider | undefined {
	return value === "auto" || value === "perplexity" || value === "exa" || value === "gemini" ? value : undefined;
}

function normalizeWorkflow(value: unknown): PiWebSearchWorkflow | undefined {
	return value === "none" || value === "summary-review" ? value : undefined;
}

function normalizeNonEmptyString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function normalizeBooleanFlag(value: unknown): boolean {
	if (value === true) return true;
	if (typeof value !== "string") return false;
	const normalized = value.trim().toLowerCase();
	return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

export function loadPiWebAccessConfig(configPath = getPiWebSearchConfigPath()): PiWebAccessConfig {
	if (!existsSync(configPath)) {
		return {};
	}

	try {
		const parsed = JSON.parse(readFileSync(configPath, "utf8")) as PiWebAccessConfig;
		return parsed && typeof parsed === "object" ? parsed : {};
	} catch {
		return {};
	}
}

export function savePiWebAccessConfig(
	updates: Partial<Record<keyof PiWebAccessConfig, unknown>>,
	configPath = getPiWebSearchConfigPath(),
): void {
	const merged: Record<string, unknown> = { ...loadPiWebAccessConfig(configPath) };
	for (const [key, value] of Object.entries(updates)) {
		if (value === undefined) {
			delete merged[key];
		} else {
			merged[key] = value;
		}
	}

	mkdirSync(dirname(configPath), { recursive: true });
	writeFileSync(configPath, JSON.stringify(merged, null, 2) + "\n", "utf8");
	// web-search.json can contain provider API keys; default to user-only permissions.
	try {
		chmodSync(configPath, 0o600);
	} catch {
		// ignore permission errors (best-effort)
	}
}

function formatRouteLabel(provider: PiWebSearchProvider): string {
	switch (provider) {
		case "perplexity":
			return "Perplexity";
		case "exa":
			return "Exa";
		case "gemini":
			return "Gemini";
		default:
			return "Auto";
	}
}

function formatRouteNote(provider: PiWebSearchProvider): string {
	switch (provider) {
		case "perplexity":
			return "Pi web-access will use Perplexity for search.";
		case "exa":
			return "Pi web-access will use Exa for search.";
		case "gemini":
			return "Pi web-access will use Gemini API. Browser-cookie fallback is opt-in.";
		default:
			return "Pi web-access will try Exa, then Perplexity, then Gemini API. Browser-cookie fallback is opt-in.";
	}
}

export function getPiWebAccessStatus(
	config: PiWebAccessConfig = loadPiWebAccessConfig(),
	configPath = getPiWebSearchConfigPath(),
): PiWebAccessStatus {
	const searchProvider =
		normalizeProvider(config.searchProvider) ?? normalizeProvider(config.route) ?? normalizeProvider(config.provider) ?? "auto";
	const requestProvider = normalizeProvider(config.provider) ?? normalizeProvider(config.route) ?? searchProvider;
	const workflow = normalizeWorkflow(config.workflow) ?? "none";
	const perplexityConfigured = Boolean(normalizeNonEmptyString(config.perplexityApiKey));
	const exaConfigured = Boolean(normalizeNonEmptyString(config.exaApiKey));
	const geminiApiConfigured = Boolean(normalizeNonEmptyString(config.geminiApiKey));
	const chromeProfile = normalizeNonEmptyString(config.chromeProfile);
	const geminiBrowserEnabled = normalizeBooleanFlag(config.geminiBrowser ?? config.allowBrowserAuth ?? config.browserAuth);
	const effectiveProvider = searchProvider;

	return {
		configPath,
		configExists: existsSync(configPath),
		searchProvider,
		requestProvider,
		workflow,
		perplexityConfigured,
		exaConfigured,
		geminiApiConfigured,
		chromeProfile,
		geminiBrowserEnabled,
		routeLabel: formatRouteLabel(effectiveProvider),
		note: formatRouteNote(effectiveProvider),
	};
}

export function formatPiWebAccessDoctorLines(
	status: PiWebAccessStatus = getPiWebAccessStatus(),
): string[] {
	const configPathSuffix = status.configExists ? "" : " (not created yet)";
	const lines = [
		"web access: pi-web-access",
		`  search route: ${status.routeLabel}`,
		`  request route: ${status.requestProvider}`,
		`  search workflow: ${status.workflow}`,
		`  perplexity api: ${status.perplexityConfigured ? "configured" : "not configured"}`,
		`  exa api: ${status.exaConfigured ? "configured" : "not configured"}`,
		`  gemini api: ${status.geminiApiConfigured ? "configured" : "not configured"}`,
		`  gemini browser fallback: ${status.geminiBrowserEnabled ? "enabled" : "disabled"}`,
		`  config path: ${status.configPath}${configPathSuffix}`,
		`  note: ${status.note}`,
	];
	if (status.geminiBrowserEnabled && status.chromeProfile) {
		lines.splice(8, 0, `  gemini browser profile: ${status.chromeProfile}`);
	}
	if (!status.configExists) {
		lines.push("  hint: run `feynman search set <auto|perplexity|exa|gemini> [api-key]` to configure web search");
	}
	return lines;
}
