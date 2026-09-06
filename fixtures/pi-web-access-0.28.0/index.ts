import type { AgentToolResult, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Box, Text, truncateToWidth, type KeyId } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import pLimit from "p-limit";
import { StringEnum, type ImageContent, type TextContent } from "@earendil-works/pi-ai/compat";
import type { ExtractedContent, ExtractOptions } from "./extract.ts";
import { normalizeFetchContentParams } from "./fetch-params.ts";
import { resolveAuthFetchProfile, type AuthFetchProfile } from "./auth-fetch.ts";
import { findContent, type FindMode } from "./content-find.ts";
import { answerFromPage } from "./page-query.ts";
import { rewriteSearchQuery } from "./query-rewrite.ts";
import { clearCloneCache } from "./github-extract.ts";
import { ALL_SEARCH_PROVIDERS, getConfiguredSearchRouting, normalizeSearchProviderSelection, RESOLVED_SEARCH_PROVIDERS, SEARCH_PROVIDERS, search, type AttributedSearchResponse, type ProviderAvailability, type SearchProvider, type SearchProviderSelection, type ResolvedSearchProvider } from "./gemini-search.ts";
export type { ProviderAvailability } from "./gemini-search.ts";
import type { SearchResult } from "./perplexity.ts";
import { formatSeconds, getWebSearchConfigDir, getWebSearchConfigPath, installGlobalProxyFetch, resolveCuratorNetworkConfig, runWithProxy } from "./utils.ts";
import {
	clearResults,
	deleteResult,
	generateId,
	getAllResults,
	getResult,
	restoreFromSession,
	storeFetchedContentResult,
	storeResult,
	type QueryResultData,
	type StoredSearchData,
} from "./storage.ts";
import { activityMonitor, type ActivityEntry } from "./activity.ts";
import { startCuratorServer, type CuratorSearchEntry, type CuratorServerHandle, type IndexedCuratorSearchEntry } from "./curator-server.ts";
import {
	buildDeterministicSummary,
	generateSummaryDraft,
	SUMMARY_GENERATION_DEADLINE_MS,
	type SummaryGenerationContext,
	type SummaryMeta,
} from "./summary-review.ts";
import { randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { platform } from "node:os";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { isPerplexityAvailable } from "./perplexity.ts";
import { isExaAvailable } from "./exa.ts";
import { isGeminiApiAvailable } from "./gemini-api.ts";
import { getActiveGoogleEmail, getGeminiWebAvailabilityDiagnostic, getGeminiWebAvailabilityDiagnosticDetails, isGeminiWebAvailable } from "./gemini-web.ts";
import { isBrowserCookieAccessAllowed } from "./gemini-web-config.ts";
import { isBraveAvailable } from "./brave.ts";
import { isCurrentModelHostedSearchEligible, isOpenAISearchAvailable } from "./openai-search.ts";
import { isParallelAvailable } from "./parallel.ts";
import { isParallelMcpAvailable } from "./parallel-mcp.ts";
import { isTinyFishAvailable } from "./tinyfish.ts";
import { isSearch1APIAvailable } from "./search1api.ts";
import { isSearchinfinityAvailable } from "./searchinfinity.ts";
import { isQueritAvailable } from "./querit.ts";
import { isTavilyAvailable } from "./tavily.ts";
import { isFirecrawlAvailable } from "./firecrawl.ts";
import { isJinaSearchAvailable } from "./jina-search.ts";
import { isSerpdiveAvailable } from "./serpdive.ts";
import { isKagiAvailable } from "./kagi.ts";
import { isBochaAvailable } from "./bocha.ts";
import { isOllamaAvailable } from "./ollama.ts";
import { isSearXNGAvailable } from "./searxng.ts";
import { isDuckDuckGoAvailable } from "./duckduckgo.ts";
import { isAnySearchAvailable } from "./anysearch.ts";
import { isXaiSearchAvailable } from "./xai-search.ts";
import { isMistralAvailable } from "./mistral-search.ts";
import { isKimiSearchAvailable } from "./kimi-search.ts";
import { isBrightDataAvailable } from "./brightdata.ts";
import { isSerpBaseAvailable } from "./serpbase.ts";
import { isSerperAvailable } from "./serper.ts";
import { isValyuAvailable } from "./valyu.ts";
import { isXcrawlAvailable } from "./xcrawl.ts";
import { buildSearchErrorPlan, type SearchErrorDetails, type SearchErrorPlan } from "./render-search-error.ts";
import { findModelWithProviderRouting, loadEnabledModelPatterns, modelMatchesEnabledPatterns, splitThinkingSuffix } from "./summary-model-scope.ts";
import {
	buildResearchArtifact,
	withClaimAssessment,
	storeResearchArtifact,
	getResearchArtifact,
	type RecencyFilter,
	type ResearchArtifact,
} from "./source-check.ts";

type ExtensionTheme = ExtensionContext["ui"]["theme"];

const WEB_SEARCH_CONFIG_PATH = getWebSearchConfigPath();

let extractModulePromise: Promise<typeof import("./extract.ts")> | undefined;
async function fetchAllContent(
	urls: string[],
	signal?: AbortSignal,
	options?: ExtractOptions,
): Promise<ExtractedContent[]> {
	const extractModule = await (extractModulePromise ??= import("./extract.ts"));
	return extractModule.fetchAllContent(urls, signal, options);
}

function withRegisteredFetchOptions(
	options: ExtractOptions | undefined,
	toolNames: ExtractOptions["toolNames"],
	proxy?: string,
): ExtractOptions {
	return {
		...(options ?? {}),
		toolNames,
		...(proxy !== undefined ? { proxy } : {}),
	};
}

function isAbortError(err: unknown): boolean {
	return (err instanceof Error ? err.message : String(err)).toLowerCase().includes("abort");
}

/** Shared collapsed/expanded renderer for an error/cancel plan produced by
 * buildSearchErrorPlan(). Used by every tool renderResult's error branch so
 * Ctrl+O (app.tools.expand) reveals diagnostics instead of a dead-end single line. */
function renderSearchErrorPlan(plan: SearchErrorPlan, expanded: boolean, theme: ExtensionTheme) {
	if (expanded) {
		return new Text(plan.expanded.map((l, i) => i === 0 ? theme.fg("error", l) : theme.fg("toolOutput", l)).join("\n"), 0, 0);
	}
	const box = new Box(1, 0, (t) => theme.bg("toolErrorBg", t));
	box.addChild(new Text(theme.fg("error", plan.expanded[0]), 0, 0));
	for (const line of plan.collapsed) {
		box.addChild(new Text(theme.fg("dim", line), 0, 0));
	}
	if (plan.expandHint) {
		box.addChild(new Text(theme.fg("muted", plan.expandHint), 0, 0));
	}
	return box;
}

interface WebSearchConfig {
	anysearchApiKey?: unknown;
	xcrawlApiKey?: unknown;
	brightdataApiKey?: unknown;
	brightdataSerpZone?: unknown;
	kagiApiKey?: unknown;
	ollamaApiKey?: unknown;
	serpbaseApiKey?: unknown;
	serperApiKey?: unknown;
	tinyfishApiKey?: unknown;
	valyuApiKey?: unknown;
	xaiApiKey?: unknown;
	provider?: unknown;
	searchProvider?: unknown;
	workflow?: string;
	curatorTimeoutSeconds?: unknown;
	autoOpenBrowser?: unknown;
	curatorRemote?: unknown;
	summaryModel?: string;
	summaryGenerationDeadlineMs?: unknown;
	maxInlineContentChars?: unknown;
	webSearch?: {
		enabled?: boolean;
	};
	tools?: Partial<Record<keyof ToolNames, { enabled?: boolean }>>;
	commands?: Partial<Record<"websearch" | "curator" | "search" | "google-account", { enabled?: boolean }>>;
	toolNames?: Partial<ToolNames>;
	shortcuts?: {
		curate?: KeyId;
		activity?: KeyId;
	};
	ssrf?: {
		/** CIDR ranges exempted from the SSRF guard (e.g. fake-IP proxy ranges). */
		allowRanges?: string[];
		/** Skip local hostname DNS preflight when an HTTP(S)_PROXY env var applies. */
		trustEnvProxy?: boolean;
	};
}

type WebSearchWorkflow = "none" | "summary-review" | "auto-summary";
type CuratorWorkflow = "summary-review";
export type CuratorProvider = Exclude<SearchProvider, "auto">;
type SummaryWorkflow = "summary-review" | "auto-summary";

interface CuratorBootstrap {
	availableProviders: ProviderAvailability;
	defaultProvider: CuratorProvider;
	timeoutSeconds: number;
}

function parseConfigRoot(raw: string): Record<string, unknown> {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		throw new Error(`Failed to parse ${WEB_SEARCH_CONFIG_PATH}: ${message}`);
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error(`Invalid config in ${WEB_SEARCH_CONFIG_PATH}: expected a JSON object`);
	}
	return parsed as Record<string, unknown>;
}

function loadConfig(): WebSearchConfig {
	if (!existsSync(WEB_SEARCH_CONFIG_PATH)) return {};
	return parseConfigRoot(readFileSync(WEB_SEARCH_CONFIG_PATH, "utf-8")) as WebSearchConfig;
}

function saveConfig(updates: Partial<WebSearchConfig>): void {
	let config: Record<string, unknown> = {};
	if (existsSync(WEB_SEARCH_CONFIG_PATH)) {
		config = parseConfigRoot(readFileSync(WEB_SEARCH_CONFIG_PATH, "utf-8"));
	}

	Object.assign(config, updates);
	const dir = getWebSearchConfigDir();
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	writeFileSync(WEB_SEARCH_CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
}

type ToolNames = {
	webSearch: string;
	sourceCheck: string;
	fetchContent: string;
	getSearchContent: string;
};

const DEFAULT_TOOL_NAMES: ToolNames = {
	webSearch: "web_search",
	sourceCheck: "source_check",
	fetchContent: "fetch_content",
	getSearchContent: "get_search_content",
};
const TOOL_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const DEFAULT_SHORTCUTS = { curate: "ctrl+shift+s", activity: "ctrl+shift+w" } satisfies Record<string, KeyId>;
const DEFAULT_CURATOR_TIMEOUT_SECONDS = 20;
const DEFAULT_REMOTE_CURATOR_TIMEOUT_SECONDS = 60;
const MAX_CURATOR_TIMEOUT_SECONDS = 600;
const MAX_SUMMARY_GENERATION_DEADLINE_MS = 600_000;
const SEARCH_QUERY_CONCURRENCY = 3;

// Limit each batch independently so separate Pi tool calls can still run in parallel.
function runSearchQueries<T>(queries: string[], run: (query: string, index: number) => Promise<T>): Promise<T[]> {
	const limit = pLimit(SEARCH_QUERY_CONCURRENCY);
	return Promise.all(queries.map((query, index) => limit(() => run(query, index))));
}

// Keep primary query indexes stable for curator slots, then interleave additional
// provider entries deterministically instead of assigning by completion order.
function curatorResultIndex(queryIndex: number, entryIndex: number, queryCount: number): number {
	return entryIndex * queryCount + queryIndex;
}

function curatorResultIndexCapacity(queryCount: number): number {
	return queryCount * RESOLVED_SEARCH_PROVIDERS.length;
}

function searchProviderSchema(description: string) {
	return Type.Union([
		StringEnum([...SEARCH_PROVIDERS]),
		Type.Array(StringEnum([...RESOLVED_SEARCH_PROVIDERS]), { minItems: 1 }),
	], { description });
}

function isToolEnabled(config: WebSearchConfig, key: keyof ToolNames): boolean {
	const override = config.tools?.[key]?.enabled;
	if (typeof override === "boolean") return override;
	return key !== "webSearch" && key !== "sourceCheck" || config.webSearch?.enabled !== false;
}

function isCommandEnabled(config: WebSearchConfig, name: "websearch" | "curator" | "search" | "google-account"): boolean {
	return config.commands?.[name]?.enabled !== false;
}

function joinToolNames(names: string[]): string {
	if (names.length === 0) return "stored content";
	if (names.length === 1) return names[0];
	if (names.length === 2) return `${names[0]} or ${names[1]}`;
	return `${names.slice(0, -1).join(", ")}, or ${names[names.length - 1]}`;
}

function resolveToolNames(config: WebSearchConfig): ToolNames {
	if (config.toolNames !== undefined && (!config.toolNames || typeof config.toolNames !== "object" || Array.isArray(config.toolNames))) {
		throw new Error(`toolNames in ${WEB_SEARCH_CONFIG_PATH} must be an object`);
	}
	const names = { ...DEFAULT_TOOL_NAMES };
	for (const key of Object.keys(DEFAULT_TOOL_NAMES) as Array<keyof ToolNames>) {
		const value = config.toolNames?.[key];
		if (value === undefined) continue;
		if (typeof value !== "string") throw new Error(`toolNames.${key} in ${WEB_SEARCH_CONFIG_PATH} must be a string`);
		const trimmed = value.trim();
		if (!TOOL_NAME_PATTERN.test(trimmed)) {
			throw new Error(`toolNames.${key} in ${WEB_SEARCH_CONFIG_PATH} must start with a letter and contain only letters, numbers, underscores, or hyphens`);
		}
		names[key] = trimmed;
	}
	const registeredKeys = (Object.keys(DEFAULT_TOOL_NAMES) as Array<keyof ToolNames>)
		.filter(key => isToolEnabled(config, key));
	const seen = new Map<string, keyof ToolNames>();
	for (const key of registeredKeys) {
		const name = names[key];
		const previous = seen.get(name);
		if (previous) throw new Error(`toolNames.${key} duplicates toolNames.${previous} in ${WEB_SEARCH_CONFIG_PATH}`);
		seen.set(name, key);
	}
	return names;
}

function loadConfigForExtensionInit(): WebSearchConfig {
	try {
		return loadConfig();
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error(`[pi-web-access] ${message}`);
		return {};
	}
}

function normalizeProviderInput(value: unknown, label = "provider"): SearchProviderSelection | undefined {
	if (value === undefined) return undefined;
	return normalizeSearchProviderSelection(value, label);
}

function resolveRequestedProvider(requested: unknown): SearchProviderSelection {
	const normalizedRequested = normalizeProviderInput(requested);
	if (normalizedRequested && normalizedRequested !== "auto") return normalizedRequested;
	const config = loadConfig();
	return normalizeProviderInput(config.searchProvider ?? config.provider, `provider in ${WEB_SEARCH_CONFIG_PATH}`) ?? "auto";
}

function toCuratorProvider(provider: SearchProviderSelection): CuratorProvider | undefined {
	if (Array.isArray(provider)) return "all";
	return provider === "auto" ? undefined : provider;
}

function resolveCuratorSearchProvider(requested: unknown, current: SearchProviderSelection): SearchProviderSelection {
	const normalized = normalizeProviderInput(requested);
	if (!normalized || normalized === "auto") return current;
	if (normalized === "all" && Array.isArray(current)) return current;
	return normalized;
}

function normalizeRecencyFilter(value: unknown): RecencyFilter | undefined {
	return value === "day" || value === "week" || value === "month" || value === "year"
		? value
		: undefined;
}

function normalizeCuratorTimeoutSeconds(value: unknown): number | undefined {
	if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
	const normalized = Math.floor(value);
	if (normalized < 1) return undefined;
	return Math.min(normalized, MAX_CURATOR_TIMEOUT_SECONDS);
}

function resolveWorkflow(input: unknown, hasUI: boolean): WebSearchWorkflow {
	const normalized = typeof input === "string" ? input.trim().toLowerCase() : "";
	if (normalized === "auto-summary") return "auto-summary";
	if (!hasUI) return "none";
	if (normalized === "none") return "none";
	return "summary-review";
}

function normalizeQueryList(queryList: unknown[]): string[] {
	const normalized: string[] = [];
	for (const query of queryList) {
		if (typeof query !== "string") continue;
		const trimmed = query.trim();
		if (trimmed.length > 0) normalized.push(trimmed);
	}
	return normalized;
}

// Some local models serialize a multi-query list into the single-string `query`
// field as a JSON array (query: "[\"a\", \"b\"]") instead of using the
// `queries` parameter. Forwarding that raw string verbatim makes every backend
// search for the literal array text and return zero results, with no signal to
// the model that its argument shape was wrong. Expand a string that parses as a
// JSON array of strings so each element is searched independently.
function expandQueryString(query: unknown): string[] {
	if (typeof query !== "string") return [];
	const trimmed = query.trim();
	if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
		try {
			const parsed: unknown = JSON.parse(trimmed);
			// Only expand an unambiguously string-only array. Mixed or non-string
			// arrays are kept as the literal query so we never silently drop
			// members or collapse them into an empty search.
			if (Array.isArray(parsed) && parsed.every((entry): entry is string => typeof entry === "string")) {
				return parsed
					.map((entry) => entry.trim())
					.filter((entry) => entry.length > 0);
			}
		} catch {
			// Not JSON — treat as a literal query string.
		}
	}
	return [query];
}

function getCuratorTimeoutSeconds(): number {
	const source = loadConfig();
	const explicit = normalizeCuratorTimeoutSeconds(source.curatorTimeoutSeconds);
	if (explicit !== undefined) return explicit;
	// Remote users must notice and click a printed link, so allow more idle time.
	return resolveCuratorNetworkConfig().enabled ? DEFAULT_REMOTE_CURATOR_TIMEOUT_SECONDS : DEFAULT_CURATOR_TIMEOUT_SECONDS;
}

export function getSummaryGenerationDeadlineMs(): number {
	const value = loadConfig().summaryGenerationDeadlineMs;
	if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
		return SUMMARY_GENERATION_DEADLINE_MS;
	}
	return Math.min(value, MAX_SUMMARY_GENERATION_DEADLINE_MS);
}

function shouldAutoOpenCuratorBrowser(config: WebSearchConfig): boolean {
	if (config.autoOpenBrowser === false) return false;
	if (resolveCuratorNetworkConfig().enabled && config.autoOpenBrowser !== true) return false;
	return true;
}

async function getProviderAvailability(ctx: ExtensionContext): Promise<ProviderAvailability> {
	const geminiWebAvail = await getOptionalGeminiWebAvailability();
	const geminiApiAvail = isGeminiApiAvailable();
	const providers = {
		openai: await isOpenAISearchAvailable(ctx),
		brave: isBraveAvailable(),
		parallel: isParallelAvailable(),
		"parallel-mcp": isParallelMcpAvailable(),
		tinyfish: isTinyFishAvailable(),
		search1api: isSearch1APIAvailable(),
		searchinfinity: isSearchinfinityAvailable(),
		querit: isQueritAvailable(),
		tavily: isTavilyAvailable(),
		firecrawl: isFirecrawlAvailable(),
		jina: isJinaSearchAvailable(),
		serpdive: isSerpdiveAvailable(),
		kagi: isKagiAvailable(),
		bocha: isBochaAvailable(),
		ollama: isOllamaAvailable(),
		searxng: isSearXNGAvailable(),
		duckduckgo: isDuckDuckGoAvailable(),
		perplexity: isPerplexityAvailable(),
		exa: isExaAvailable(),
		gemini: geminiApiAvail || !!geminiWebAvail,
		kimi: await isKimiSearchAvailable(ctx),
		anysearch: isAnySearchAvailable(),
		xcrawl: isXcrawlAvailable(),
		xai: await isXaiSearchAvailable(ctx),
		mistral: isMistralAvailable(),
		brightdata: isBrightDataAvailable(),
		serpbase: isSerpBaseAvailable(),
		serper: isSerperAvailable(),
		valyu: isValyuAvailable(),
	};
	const allSearchProviders = new Set<ResolvedSearchProvider>(ALL_SEARCH_PROVIDERS);
	return {
		all: Object.entries(providers).some(([provider, available]) => provider !== "gemini" && allSearchProviders.has(provider as ResolvedSearchProvider) && available) || geminiApiAvail,
		...providers,
	};
}

async function getOptionalGeminiWebAvailability() {
	try {
		return await isGeminiWebAvailable();
	} catch {
		return null;
	}
}

function shouldUseOpenAICodexDefault(ctx?: Pick<ExtensionContext, "model">): boolean {
	return ctx?.model?.provider === "openai-codex";
}

function shouldPreferOpenAI(options: Pick<PendingCurate, "numResults" | "recencyFilter"> | undefined, preferOpenAICodexDefault: boolean): boolean {
	if (options?.recencyFilter) return false;
	if (typeof options?.numResults === "number" && Number.isFinite(options.numResults) && Math.floor(options.numResults) !== 5) {
		return false;
	}
	return preferOpenAICodexDefault;
}

async function loadCuratorBootstrap(
	requestedProvider: unknown,
	ctx: ExtensionContext,
	options?: Pick<PendingCurate, "numResults" | "recencyFilter">,
): Promise<CuratorBootstrap> {
	const provider = resolveRequestedProvider(requestedProvider);
	const availableProviders = await getProviderAvailability(ctx);
	if (Array.isArray(provider)) availableProviders.all = true;
	return {
		availableProviders,
		defaultProvider: resolveCuratorDefaultProvider(provider, availableProviders, ctx, options),
		timeoutSeconds: getCuratorTimeoutSeconds(),
	};
}

export function resolveCuratorDefaultProvider(
	provider: SearchProviderSelection,
	available: ProviderAvailability,
	ctx?: Pick<ExtensionContext, "model">,
	options?: Pick<PendingCurate, "numResults" | "recencyFilter">,
): CuratorProvider {
	return resolveProvider(provider, available, options, shouldUseOpenAICodexDefault(ctx), ctx);
}

function firstAvailableProvider(available: ProviderAvailability, preferOpenAI: boolean, fallback: ResolvedSearchProvider): ResolvedSearchProvider {
	if (available.searxng) return "searxng";
	if (preferOpenAI && available.openai) return "openai";
	if (available.exa) return "exa";
	if (available.openai) return "openai";
	if (available.brave) return "brave";
	if (available.parallel) return "parallel";
	if (available.tinyfish) return "tinyfish";
	if (available.search1api) return "search1api";
	if (available.searchinfinity) return "searchinfinity";
	if (available.querit) return "querit";
	if (available.tavily) return "tavily";
	if (available.firecrawl) return "firecrawl";
	if (available.jina) return "jina";
	if (available.serpdive) return "serpdive";
	if (available.kagi) return "kagi";
	if (available.bocha) return "bocha";
	if (available.ollama) return "ollama";
	if (available.perplexity) return "perplexity";
	if (available.gemini) return "gemini";
	return fallback;
}

function resolveProvider(
	provider: SearchProviderSelection,
	available: ProviderAvailability,
	options?: Pick<PendingCurate, "numResults" | "recencyFilter">,
	preferOpenAICodexDefault = false,
	ctx?: Pick<ExtensionContext, "model">,
): CuratorProvider {
	if (Array.isArray(provider)) return "all";
	const preferOpenAI = shouldPreferOpenAI(options, preferOpenAICodexDefault);

	if (provider === "auto") {
		const routing = getConfiguredSearchRouting();
		if (routing) {
			for (const candidate of routing.providers) {
				if (candidate === "openai" && routing.useCurrentModel === true && !isCurrentModelHostedSearchEligible(ctx)) continue;
				if (available[candidate]) return candidate;
			}
			return routing.providers.find(candidate => candidate !== "openai" || routing.useCurrentModel !== true || isCurrentModelHostedSearchEligible(ctx)) ?? routing.providers[0];
		}
		return firstAvailableProvider(available, preferOpenAI, "exa");
	}
	if (provider === "all" && !available.all) {
		return firstAvailableProvider(available, preferOpenAI, "exa");
	}
	if (provider === "openai" && !available.openai) {
		return firstAvailableProvider(available, false, "openai");
	}
	if (provider === "brave" && !available.brave) {
		return firstAvailableProvider(available, preferOpenAI, "brave");
	}
	if (provider === "parallel" && !available.parallel) {
		return firstAvailableProvider(available, preferOpenAI, "parallel");
	}
	if (provider === "tinyfish" && !available.tinyfish) {
		return firstAvailableProvider(available, preferOpenAI, "tinyfish");
	}
	if (provider === "search1api" && !available.search1api) {
		return firstAvailableProvider(available, preferOpenAI, "search1api");
	}
	if (provider === "searchinfinity" && !available.searchinfinity) {
		return firstAvailableProvider(available, preferOpenAI, "searchinfinity");
	}
	if (provider === "querit" && !available.querit) {
		return firstAvailableProvider(available, preferOpenAI, "querit");
	}
	if (provider === "tavily" && !available.tavily) {
		return firstAvailableProvider(available, preferOpenAI, "tavily");
	}
	if (provider === "firecrawl" && !available.firecrawl) {
		return firstAvailableProvider(available, preferOpenAI, "firecrawl");
	}
	if (provider === "jina" && !available.jina) {
		return firstAvailableProvider(available, preferOpenAI, "jina");
	}
	if (provider === "serpdive" && !available.serpdive) {
		return firstAvailableProvider(available, preferOpenAI, "serpdive");
	}
	if (provider === "kagi" && !available.kagi) {
		return firstAvailableProvider(available, preferOpenAI, "kagi");
	}
	if (provider === "bocha" && !available.bocha) {
		return firstAvailableProvider(available, preferOpenAI, "bocha");
	}
	if (provider === "ollama" && !available.ollama) {
		return firstAvailableProvider(available, preferOpenAI, "ollama");
	}
	if (provider === "searxng" && !available.searxng) {
		return firstAvailableProvider(available, preferOpenAI, "searxng");
	}
	if (provider === "exa" && !available.exa) {
		return firstAvailableProvider(available, preferOpenAI, "exa");
	}
	if (provider === "perplexity" && !available.perplexity) {
		return firstAvailableProvider(available, preferOpenAI, "perplexity");
	}
	if (provider === "gemini" && !available.gemini) {
		return firstAvailableProvider(available, preferOpenAI, "gemini");
	}
	return provider;
}

const pendingFetches = new Map<string, AbortController>();
let sessionActive = false;
let widgetVisible = false;
let widgetUnsubscribe: (() => void) | null = null;
const pendingCurates = new Map<string, PendingCurate>();
const activeCurators = new Map<string, CuratorServerHandle>();
const glimpseWins = new Map<string, GlimpseWindow>();

interface PendingCurate {
	phase: "searching" | "curating";
	workflow: CuratorWorkflow;
	summaryContext: SummaryGenerationContext;
	searchResults: Map<number, QueryResultData>;
	resultSlots: Map<number, number>;
	allInlineContent: ExtractedContent[];
	queryList: string[];
	includeContent: boolean;
	numResults?: number;
	recencyFilter?: "day" | "week" | "month" | "year";
	domainFilter?: string[];
	availableProviders: ProviderAvailability;
	defaultProvider: CuratorProvider;
	searchProvider: SearchProviderSelection;
	summaryModels: Array<{ value: string; label: string }>;
	defaultSummaryModel: string | null;
	timeoutSeconds: number;
	proxy?: string;
	curatorUrl?: string;
	onUpdate: ((update: { content: Array<{ type: string; text: string }>; details?: Record<string, unknown> }) => void) | undefined;
	signal: AbortSignal | undefined;
	abortSearches: () => void;
	finish: (value: AgentToolResult<Record<string, unknown>>) => void;
	cancel: (reason?: "user" | "stale") => void;
	browserPromise?: Promise<void>;
	browserOpenError?: string;
}


const DEFAULT_MAX_INLINE_CONTENT_CHARS = 30_000;
const MAX_INLINE_CONTENT_CHARS = 200_000;

function getMaxInlineContentChars(config = loadConfig()): number {
	const value = config.maxInlineContentChars;
	if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
		return DEFAULT_MAX_INLINE_CONTENT_CHARS;
	}
	return Math.min(value, MAX_INLINE_CONTENT_CHARS);
}

function stripThumbnails(results: ExtractedContent[]): ExtractedContent[] {
	return results.map(({ thumbnail, frames, ...rest }) => rest);
}

function storeFetchResult(pi: { appendEntry(type: string, data: unknown): void }, responseId: string, data: StoredSearchData & { type: "fetch"; urls: ExtractedContent[] }, authProfile?: AuthFetchProfile): boolean {
	if (authProfile?.cache === "off") return false;
	pi.appendEntry("web-search-results", storeFetchedContentResult(responseId, data));
	return true;
}

function initialContentSlice(content: string, maxChars: number): {
	text: string;
	endOffset: number;
	totalBytes: number;
	totalLines: number;
	shownBytes: number;
	shownLines: number;
} {
	let endOffset = Math.min(content.length, maxChars);
	if (endOffset < content.length) {
		const lineBreak = content.lastIndexOf("\n", endOffset);
		if (lineBreak >= Math.floor(maxChars * 0.8)) endOffset = lineBreak + 1;
	}
	const text = content.slice(0, endOffset);
	return {
		text,
		endOffset,
		totalBytes: Buffer.byteLength(content),
		totalLines: content.length === 0 ? 0 : content.split("\n").length,
		shownBytes: Buffer.byteLength(text),
		shownLines: text.length === 0 ? 0 : text.split("\n").length,
	};
}

function normalizeFindQueries(value: string | string[]): string[] {
	const queries = (Array.isArray(value) ? value : [value]).map(query => query.trim()).filter(Boolean);
	if (queries.length === 0) throw new Error("findText must contain at least one non-empty string");
	return queries;
}

interface GetSearchContentParams {
	responseId: string;
	query?: string;
	queryIndex?: number;
	url?: string;
	urlIndex?: number;
	offset?: number;
	limit?: number;
	findText?: string | string[];
	findMode?: FindMode;
}

type RawGetSearchContentParams = Omit<GetSearchContentParams, "findMode"> & { findMode?: unknown };

function normalizeFindMode(value: unknown): FindMode | undefined {
	if (value === undefined) return undefined;
	if (value === "exact" || value === "case-insensitive" || value === "fuzzy") return value;
	throw new Error('findMode must be "exact", "case-insensitive", or "fuzzy"');
}

function normalizeGetSearchContentParams(params: RawGetSearchContentParams): GetSearchContentParams {
	const normalized: GetSearchContentParams = { ...params, findMode: normalizeFindMode(params.findMode) };

	if (normalized.query?.trim() === "") delete normalized.query;
	if (normalized.url?.trim() === "") delete normalized.url;

	if (normalized.findText !== undefined) {
		delete normalized.offset;
		delete normalized.limit;
	}

	return normalized;
}

function formatInputValue(value: unknown): string {
	if (typeof value === "string") return JSON.stringify(value);
	if (typeof value === "number") return Number.isNaN(value) ? "NaN" : String(value);
	try {
		const serialized = JSON.stringify(value);
		return serialized === undefined ? String(value) : serialized;
	} catch {
		return String(value);
	}
}

function formatSearchSummary(results: SearchResult[], answer: string): string {
	if (results.length === 0) {
		return answer ? `${answer}\n\n---\n\n**Sources:**\nNo sources returned.` : "No results found.";
	}
	let output = answer ? `${answer}\n\n---\n\n**Sources:**\n` : "";
	output += results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}`).join("\n\n");
	return output;
}

function formatSourceCheckResult(artifact: ResearchArtifact, getSearchContentTool: string | null = DEFAULT_TOOL_NAMES.getSearchContent): string {
	const assessment = artifact.claims?.[0];
	const lines = [`# Source check: ${artifact.query}`, ""];
	if (assessment) {
		lines.push(`**Status:** ${assessment.status} (confidence ${assessment.confidence.toFixed(2)})`);
		lines.push(`**Rationale:** ${assessment.rationale}`);
		if (assessment.supporting_passages.length > 0) lines.push(`**Supporting passages:** ${assessment.supporting_passages.join(", ")}`);
		if (assessment.contradicting_passages.length > 0) lines.push(`**Contradicting passages:** ${assessment.contradicting_passages.join(", ")}`);
		lines.push("");
	}
	if (artifact.sources.length > 0) {
		lines.push("## Sources");
		for (const source of artifact.sources) lines.push(`${source.rank}. [${source.quality}] ${source.title}\n   ${source.url}`);
		lines.push("");
	}
	if (artifact.errors?.length) lines.push(`Search errors: ${artifact.errors.map((entry) => `${entry.query}: ${entry.error}`).join("; ")}`);
	lines.push(getSearchContentTool
		? `Artifact responseId: ${artifact.id} (retrievable via ${getSearchContentTool}).`
		: `Artifact responseId: ${artifact.id}. Content retrieval is not registered.`);
	return lines.join("\n");
}

function duplicateQuerySet(results: QueryResultData[]): Set<string> {
	const counts = new Map<string, number>();
	for (const result of results) {
		counts.set(result.query, (counts.get(result.query) ?? 0) + 1);
	}
	const duplicates = new Set<string>();
	for (const [query, count] of counts) {
		if (count > 1) duplicates.add(query);
	}
	return duplicates;
}

function formatQueryHeader(query: string, provider: string | undefined, duplicateQueries: Set<string>): string {
	const suffix = duplicateQueries.has(query) && provider ? ` (${provider})` : "";
	return `## Query: "${query}"${suffix}\n\n`;
}

function hasFullInlineCoverage(urls: string[], inlineContent: ExtractedContent[] | undefined): boolean {
	if (!inlineContent || inlineContent.length === 0) return false;
	const coveredUrls = new Set(inlineContent.map(c => c.url));
	return urls.every(url => coveredUrls.has(url));
}

function formatFullResults(queryData: QueryResultData): string {
	let output = `## Results for: "${queryData.query}"\n\n`;
	if (queryData.answer) {
		output += `${queryData.answer}\n\n---\n\n`;
	}
	for (const r of queryData.results) {
		output += `### ${r.title}\n${r.url}\n\n`;
	}
	return output;
}

function abortPendingFetches(): void {
	for (const controller of pendingFetches.values()) {
		controller.abort();
	}
	pendingFetches.clear();
}

function closeCurator(callId?: string): void {
	if (callId !== undefined) {
		const win = glimpseWins.get(callId);
		glimpseWins.delete(callId);
		try { win?.close(); } catch {}
		pendingCurates.get(callId)?.cancel("stale");
		pendingCurates.delete(callId);
		const curator = activeCurators.get(callId);
		activeCurators.delete(callId);
		try { curator?.close(); } catch {}
		return;
	}

	for (const win of glimpseWins.values()) {
		try { win.close(); } catch {}
	}
	glimpseWins.clear();
	for (const pc of pendingCurates.values()) {
		try { pc.cancel("stale"); } catch {}
	}
	pendingCurates.clear();
	for (const curator of activeCurators.values()) {
		try { curator.close(); } catch {}
	}
	activeCurators.clear();
}

async function openInBrowser(pi: ExtensionAPI, url: string): Promise<void> {
	const plat = platform();
	if (plat !== "darwin" && plat !== "win32") {
		await new Promise<void>((resolve, reject) => {
			const child = spawn("xdg-open", [url], { detached: true, stdio: "ignore" });
			const timer = setTimeout(resolve, 100);
			child.once("error", (err) => {
				clearTimeout(timer);
				reject(err);
			});
			child.once("exit", (code) => {
				clearTimeout(timer);
				if (code === 0) resolve();
				else reject(new Error(`Failed to open browser (exit code ${code ?? "unknown"})`));
			});
			child.unref();
		});
		return;
	}
	const result = plat === "darwin"
		? await pi.exec("open", [url])
		: await pi.exec("cmd", ["/c", "start", "", url]);
	if (result.code !== 0) {
		throw new Error(result.stderr || `Failed to open browser (exit code ${result.code})`);
	}
}

interface GlimpseWindow {
	on(event: "closed", handler: () => void): void;
	on(event: "message", handler: (data: unknown) => void): void;
	on(event: "ready", handler: (info: { screen?: { visibleHeight?: number } }) => void): void;
	close(): void;
	_write(obj: Record<string, unknown>): void;
}

let glimpseOpen: ((html: string, opts: Record<string, unknown>) => GlimpseWindow) | null | undefined;

function findGlimpseMjs(): string | null {
	try {
		const req = createRequire(import.meta.url);
		return req.resolve("glimpseui");
	} catch {
		// Optional dependency.
	}
	try {
		const globalRoot = execFileSync("npm", ["root", "-g"], { encoding: "utf-8" }).trim();
		const entry = join(globalRoot, "glimpseui", "src", "glimpse.mjs");
		if (existsSync(entry)) return entry;
	} catch {
		// npm may be unavailable.
	}
	return null;
}

async function getGlimpseOpen() {
	if (glimpseOpen !== undefined) return glimpseOpen;
	const resolved = findGlimpseMjs();
	if (resolved) {
		try {
			glimpseOpen = (await import(resolved)).open;
			return glimpseOpen;
		} catch {}
	}
	glimpseOpen = null;
	return glimpseOpen;
}

function openInGlimpse(
	open: (html: string, opts: Record<string, unknown>) => GlimpseWindow,
	url: string,
	title: string,
): GlimpseWindow {
	const shellHTML = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>${title}</title></head>
<body style="margin:0; background:#1a1a2e;">
  <script>window.location.replace(${JSON.stringify(url)});</script>
</body>
</html>`;
	const win = open(shellHTML, {
		width: 800,
		height: 900,
		title,
	});

	let maxHeight = 1200;
	win.on("ready", (info) => {
		const visibleHeight = info?.screen?.visibleHeight;
		if (typeof visibleHeight === "number" && visibleHeight > 0) {
			maxHeight = Math.floor(visibleHeight * 0.85);
		}
	});
	win.on("message", (data) => {
		if (!data || typeof data !== "object") return;
		const msg = data as Record<string, unknown>;
		if (msg.type !== "resize" || typeof msg.height !== "number") return;
		const clamped = Math.max(400, Math.min(Math.round(msg.height), maxHeight));
		win._write({ type: "resize", width: 800, height: clamped });
	});

	return win;
}

function extractDomain(url: string): string {
	try { return new URL(url).hostname; }
	catch { return url; }
}

function toCuratorSearchEntries(response: AttributedSearchResponse): CuratorSearchEntry[] {
	const providerResponses = response.provider === "all" && response.providerResponses?.length
		? response.providerResponses
		: [response];
	const entries: CuratorSearchEntry[] = providerResponses.map(result => ({
		answer: result.answer,
		results: result.results.map(source => ({ ...source, domain: extractDomain(source.url) })),
		provider: result.provider,
	}));
	for (const failure of response.providerErrors ?? []) {
		entries.push({
			answer: "",
			results: [],
			provider: failure.provider,
			error: failure.error,
		});
	}
	return entries;
}

function indexedCuratorEntryToQueryResult(entry: IndexedCuratorSearchEntry): QueryResultData {
	return {
		query: entry.query,
		answer: entry.answer,
		results: entry.results.map(source => ({
			title: source.title,
			url: source.url,
			snippet: source.snippet ?? "",
		})),
		error: entry.error ?? null,
		provider: entry.provider,
	};
}

function updateWidget(ctx: ExtensionContext): void {
	const theme = ctx.ui.theme;
	const entries = activityMonitor.getEntries();
	const lines: string[] = [];

	lines.push(theme.fg("accent", "─── Web Search Activity " + "─".repeat(36)));

	if (entries.length === 0) {
		lines.push(theme.fg("muted", "  No activity yet"));
	} else {
		for (const e of entries) {
			lines.push("  " + formatEntryLine(e, theme));
		}
	}

	lines.push(theme.fg("accent", "─".repeat(60)));

	const rateInfo = activityMonitor.getRateLimitInfo();
	const resetMs = rateInfo.oldestTimestamp ? Math.max(0, rateInfo.oldestTimestamp + rateInfo.windowMs - Date.now()) : 0;
	const resetSec = Math.ceil(resetMs / 1000);
	lines.push(
		theme.fg("muted", `Rate: ${rateInfo.used}/${rateInfo.max}`) +
			(resetMs > 0 ? theme.fg("dim", ` (resets in ${resetSec}s)`) : ""),
	);

	ctx.ui.setWidget("web-activity", lines);
}

function formatEntryLine(
	entry: ActivityEntry,
	theme: ExtensionTheme,
): string {
	const typeStr = entry.type === "api" ? "API" : "GET";
	const target =
		entry.type === "api"
			? `"${truncateToWidth(entry.query || "", 28, "")}"`
			: truncateToWidth(entry.url?.replace(/^https?:\/\//, "") || "", 30, "");

	const duration = entry.endTime
		? `${((entry.endTime - entry.startTime) / 1000).toFixed(1)}s`
		: `${((Date.now() - entry.startTime) / 1000).toFixed(1)}s`;

	let statusStr: string;
	let indicator: string;
	if (entry.error) {
		statusStr = "err";
		indicator = theme.fg("error", "✗");
	} else if (entry.status === null) {
		statusStr = "...";
		indicator = theme.fg("warning", "⋯");
	} else if (entry.status === 0) {
		statusStr = "abort";
		indicator = theme.fg("muted", "○");
	} else {
		statusStr = String(entry.status);
		indicator = entry.status >= 200 && entry.status < 300 ? theme.fg("success", "✓") : theme.fg("error", "✗");
	}

	return `${typeStr.padEnd(4)} ${target.padEnd(32)} ${statusStr.padStart(5)} ${duration.padStart(5)} ${indicator}`;
}

function handleSessionChange(ctx: ExtensionContext): void {
	abortPendingFetches();
	closeCurator();
	clearCloneCache();
	sessionActive = true;
	restoreFromSession(ctx);
	// Unsubscribe before clear() to avoid callback with stale ctx
	widgetUnsubscribe?.();
	widgetUnsubscribe = null;
	activityMonitor.clear();
	if (widgetVisible) {
		// Re-subscribe with new ctx
		widgetUnsubscribe = activityMonitor.onUpdate(() => updateWidget(ctx));
		updateWidget(ctx);
	}
}

export default function (pi: ExtensionAPI) {
	const initConfig = loadConfigForExtensionInit();
	installGlobalProxyFetch();
	const toolNames = resolveToolNames(initConfig);
	const webSearchEnabled = isToolEnabled(initConfig, "webSearch");
	const sourceCheckEnabled = isToolEnabled(initConfig, "sourceCheck");
	const fetchContentEnabled = isToolEnabled(initConfig, "fetchContent");
	const getSearchContentEnabled = isToolEnabled(initConfig, "getSearchContent");
	// Names as registered this session, so fetch failure guidance never points
	// at tools that are disabled or were renamed after init.
	const registeredToolNames = {
		...(webSearchEnabled ? { webSearch: toolNames.webSearch } : {}),
		...(fetchContentEnabled ? { fetchContent: toolNames.fetchContent } : {}),
	};
	const storedContentSources = joinToolNames([
		...(webSearchEnabled ? [toolNames.webSearch] : []),
		...(sourceCheckEnabled ? [toolNames.sourceCheck] : []),
		...(fetchContentEnabled ? [toolNames.fetchContent] : []),
	]);
	const searchQueryDescription = webSearchEnabled
		? `Get content for this query (${toolNames.webSearch})`
		: "Get content for a stored search query";
	const fetchContentStorageNote = getSearchContentEnabled
		? `Full original content is stored for retrieval with ${toolNames.getSearchContent}.`
		: "Full original content is stored internally, but the retrieval tool is not registered.";
	const curateKey = initConfig.shortcuts?.curate || DEFAULT_SHORTCUTS.curate;
	const activityKey = initConfig.shortcuts?.activity || DEFAULT_SHORTCUTS.activity;

	function startBackgroundFetch(urls: string[], proxy?: string): string | null {
		if (urls.length === 0) return null;
		const fetchId = generateId();
		const controller = new AbortController();
		pendingFetches.set(fetchId, controller);
		Promise.resolve()
			.then(() => runWithProxy(proxy, () => fetchAllContent(urls, controller.signal, withRegisteredFetchOptions(undefined, registeredToolNames, proxy))))
			.then((fetched) => {
				if (!sessionActive || !pendingFetches.has(fetchId)) return;
				const data = {
					id: fetchId,
					type: "fetch",
					timestamp: Date.now(),
					urls: stripThumbnails(fetched),
				} satisfies StoredSearchData & { type: "fetch"; urls: ExtractedContent[] };
				pi.appendEntry("web-search-results", storeFetchedContentResult(fetchId, data));
				const ok = fetched.filter(f => !f.error).length;
				const availability = ok === fetched.length
					? "Full page content now available."
					: ok > 0
						? "Partial page content now available."
						: "No page content was fetched. Stored fetch diagnostics are available.";
				pi.sendMessage(
					{
						customType: "web-search-content-ready",
						content: `Content fetched for ${ok}/${fetched.length} URLs [${fetchId}]. ${availability}`,
						display: true,
					},
					{ triggerTurn: true },
				);
			})
			.catch((err) => {
				if (!sessionActive || !pendingFetches.has(fetchId)) return;
				const message = err instanceof Error ? err.message : String(err);
				const isAbort = (err instanceof Error && err.name === "AbortError") || message.toLowerCase().includes("abort");
				if (!isAbort) {
					pi.sendMessage(
						{
							customType: "web-search-error",
							content: `Content fetch failed [${fetchId}]: ${message}`,
							display: true,
						},
						{ triggerTurn: false },
					);
				}
			})
			.finally(() => { pendingFetches.delete(fetchId); });
		return fetchId;
	}

	function storeAndPublishSearch(results: QueryResultData[]): string {
		const id = generateId();
		const data: StoredSearchData = {
			id, type: "search", timestamp: Date.now(), queries: results,
		};
		storeResult(id, data);
		pi.appendEntry("web-search-results", data);
		return id;
	}

	interface SearchReturnOptions {
		queryList: string[];
		results: QueryResultData[];
		urls: string[];
		includeContent: boolean;
		inlineContent?: ExtractedContent[];
		curated?: boolean;
		curatedFrom?: number;
		workflow?: SummaryWorkflow;
		approvedSummary?: string;
		summaryMeta?: SummaryMeta;
		proxy?: string;
	}

	function normalizeSummaryMeta(meta: SummaryMeta | undefined, summaryText: string): SummaryMeta {
		const normalizedText = summaryText.trim();
		if (!meta) {
			return {
				model: null,
				durationMs: 0,
				tokenEstimate: normalizedText.length > 0 ? Math.max(1, Math.ceil(normalizedText.length / 4)) : 0,
				fallbackUsed: false,
				edited: false,
			};
		}

		return {
			model: meta.model,
			durationMs: Number.isFinite(meta.durationMs) && meta.durationMs >= 0 ? meta.durationMs : 0,
			tokenEstimate: Number.isFinite(meta.tokenEstimate) && meta.tokenEstimate >= 0
				? meta.tokenEstimate
				: (normalizedText.length > 0 ? Math.max(1, Math.ceil(normalizedText.length / 4)) : 0),
			fallbackUsed: meta.fallbackUsed === true,
			fallbackReason: meta.fallbackReason,
			phase: meta.phase,
			edited: meta.edited === true,
		};
	}

	function buildCurationCancelledReturn(
		reason: "user" | "stale",
		partial?: {
			queries?: QueryResultData[];
			queryCount?: number;
			browserConnected?: boolean;
			lastHeartbeatAgeMs?: number | null;
			curatorUrl?: string;
			browserOpenError?: string;
		},
	): AgentToolResult<Record<string, unknown>> {
		const message = `Search curation cancelled (${reason}).`;
		const cancelledQueries = partial?.queries?.length
			? partial.queries.map(q => ({
				query: q.query,
				provider: q.provider ?? null,
				error: q.error,
				resultCount: q.results?.length ?? 0,
			}))
			: undefined;
		const extraLines: string[] = [];
		if (partial?.curatorUrl) extraLines.push(`curator: ${partial.curatorUrl}`);
		if (partial?.browserOpenError) extraLines.push(`browser open error: ${partial.browserOpenError}`);
		return {
			content: [{ type: "text", text: message }],
			details: {
				error: message,
				cancelled: true,
				cancelReason: reason,
				browserConnected: partial?.browserConnected,
				lastHeartbeatAgeMs: partial?.lastHeartbeatAgeMs,
				queryCount: partial?.queryCount,
				cancelledQueries,
				extraLines: extraLines.length > 0 ? extraLines : undefined,
			},
		};
	}

	async function generateSummaryForSelectedIndices(
		selectedQueryIndices: number[],
		resultsByIndex: Map<number, QueryResultData>,
		summaryContext: SummaryGenerationContext,
		signal?: AbortSignal,
		modelOverride?: string,
		feedback?: string,
	): Promise<{ summary: string; meta: SummaryMeta }> {
		const selectedResults: QueryResultData[] = [];
		for (const qi of selectedQueryIndices) {
			const result = resultsByIndex.get(qi);
			if (result) selectedResults.push(result);
		}
		if (selectedResults.length === 0) {
			throw new Error("No selected results available for summary generation");
		}
		try {
			return await generateSummaryDraft(
				selectedResults,
				summaryContext,
				signal,
				modelOverride,
				feedback,
				undefined,
				getSummaryGenerationDeadlineMs(),
			);
		} catch (err) {
			const isEmptyResponse = err instanceof Error && err.message.includes("Summary model returned empty response");
			if (!isEmptyResponse) throw err;
			const deterministic = buildDeterministicSummary(selectedResults);
			return {
				summary: deterministic.summary,
				meta: {
					...deterministic.meta,
					fallbackReason: "summary-model-empty-response",
				},
			};
		}
	}

	async function loadSummaryModelChoices(
		summaryContext: SummaryGenerationContext,
	): Promise<{ summaryModels: Array<{ value: string; label: string }>; defaultSummaryModel: string | null }> {
		const summaryModels: Array<{ value: string; label: string }> = [];
		const seen = new Set<string>();
		const availableValues = new Set<string>();

		const addModel = (provider: string, id: string) => {
			const value = `${provider}/${id}`;
			if (seen.has(value)) return;
			seen.add(value);
			summaryModels.push({ value, label: value });
		};

		let enabledModelPatterns: string[] | null = null;
		let scopeLoaded = true;
		try {
			enabledModelPatterns = loadEnabledModelPatterns(summaryContext);
			const availableModels = summaryContext.modelRegistry.getAvailable();
			for (const model of availableModels) {
				if (!modelMatchesEnabledPatterns(model, enabledModelPatterns)) continue;
				const value = `${model.provider}/${model.id}`;
				availableValues.add(value);
				addModel(model.provider, model.id);
			}
		} catch (err) {
			scopeLoaded = false;
			const message = err instanceof Error ? err.message : String(err);
			console.error(`Failed to load summary models: ${message}`);
		}

		const currentModelValue = summaryContext.model
			? `${summaryContext.model.provider}/${summaryContext.model.id}`
			: null;
		if (scopeLoaded && summaryContext.model && currentModelValue && !seen.has(currentModelValue) && modelMatchesEnabledPatterns(summaryContext.model, enabledModelPatterns)) {
			addModel(summaryContext.model.provider, summaryContext.model.id);
		}

		const config = loadConfig();
		const configuredSummaryModel = typeof config.summaryModel === "string" ? config.summaryModel.trim() : "";
		const preferredDefaults = [
			{ provider: "anthropic", id: "claude-haiku-4-5" },
			{ provider: "openai-codex", id: "gpt-5.6-luna" },
			{ provider: "openai-codex", id: "gpt-5.6-terra" },
			{ provider: "google", id: "gemini-3.6-flash" },
			{ provider: "openai", id: "gpt-5-mini" },
			{ provider: "deepseek", id: "deepseek-v4-flash" },
		];

		const resolveAvailableModelValue = (selector: string): string | null => {
			const parsed = splitThinkingSuffix(selector);
			const slashIndex = parsed.value.indexOf("/");
			if (slashIndex <= 0 || slashIndex >= parsed.value.length - 1) return null;
			const model = findModelWithProviderRouting(
				summaryContext.modelRegistry,
				parsed.value.slice(0, slashIndex),
				parsed.value.slice(slashIndex + 1),
			);
			if (!model) return null;
			const value = `${model.provider}/${model.id}`;
			if (!availableValues.has(value)) return null;
			if (selector !== value && !seen.has(selector)) {
				seen.add(selector);
				summaryModels.push({ value: selector, label: selector });
			}
			return selector;
		};

		let defaultSummaryModel: string | null = null;
		if (scopeLoaded && configuredSummaryModel.length > 0) {
			defaultSummaryModel = availableValues.has(configuredSummaryModel)
				? configuredSummaryModel
				: resolveAvailableModelValue(configuredSummaryModel);
		}
		if (scopeLoaded && !defaultSummaryModel) {
			for (const preferred of preferredDefaults) {
				const model = findModelWithProviderRouting(summaryContext.modelRegistry, preferred.provider, preferred.id);
				const value = model ? `${model.provider}/${model.id}` : null;
				if (value && availableValues.has(value)) {
					defaultSummaryModel = value;
					break;
				}
			}
		}
		return { summaryModels, defaultSummaryModel };
	}

	function resolveSummaryForSubmit(
		payload: { selectedQueryIndices: number[]; summary?: string; summaryMeta?: SummaryMeta },
		resultsByIndex: Map<number, QueryResultData>,
	): { approvedSummary: string; summaryMeta: SummaryMeta } {
		const submittedSummary = typeof payload.summary === "string" ? payload.summary.trim() : "";
		if (submittedSummary.length > 0) {
			return {
				approvedSummary: submittedSummary,
				summaryMeta: normalizeSummaryMeta(payload.summaryMeta, submittedSummary),
			};
		}

		const selected = filterByQueryIndices(payload.selectedQueryIndices, resultsByIndex).results;
		const fallbackResults = selected.length > 0 ? selected : orderedSearchResults(resultsByIndex);
		const deterministic = buildDeterministicSummary(fallbackResults);
		return {
			approvedSummary: deterministic.summary,
			summaryMeta: deterministic.meta,
		};
	}

	function buildSearchReturn(opts: SearchReturnOptions): AgentToolResult<Record<string, unknown>> {
		const sc = opts.results.filter(r => !r.error).length;
		const tr = opts.results.reduce((sum, r) => sum + r.results.length, 0);

		const hasApprovedSummary = typeof opts.approvedSummary === "string" && opts.approvedSummary.trim().length > 0;
		let output = "";
		if (hasApprovedSummary) {
			output = opts.approvedSummary!.trim();
		} else {
			if (opts.curated) {
				output += "[These results were manually curated by the user in the browser. Use them as-is — do not re-search or discard.]\n\n";
			}
			const duplicateQueries = opts.curated ? duplicateQuerySet(opts.results) : new Set<string>();
			for (const { query, answer, results, error, provider } of opts.results) {
				if (opts.queryList.length > 1) {
					output += opts.curated
						? formatQueryHeader(query, provider, duplicateQueries)
						: `## Query: "${query}"\n\n`;
				}
				if (error) output += `Error: ${error}\n\n`;
				else output += formatSearchSummary(results, answer) + "\n\n";
			}
		}

		const hasInlineReady = hasFullInlineCoverage(opts.urls, opts.inlineContent);
		let fetchId: string | null = null;
		if (hasInlineReady && opts.inlineContent) {
			fetchId = generateId();
			const data = {
				id: fetchId,
				type: "fetch",
				timestamp: Date.now(),
				urls: opts.inlineContent,
			} satisfies StoredSearchData & { type: "fetch"; urls: ExtractedContent[] };
			pi.appendEntry("web-search-results", storeFetchedContentResult(fetchId, data));
			if (!hasApprovedSummary) {
				output += `---\nFull content for ${opts.inlineContent.length} sources available [${fetchId}].`;
			}
		} else if (opts.includeContent) {
			fetchId = startBackgroundFetch(opts.urls, opts.proxy);
			if (fetchId && !hasApprovedSummary) {
				output += `---\nContent fetching in background [${fetchId}]. Will notify when ready.`;
			}
		}

		const searchId = storeAndPublishSearch(opts.results);
		const isBackgroundFetch = fetchId !== null && !hasInlineReady;
		// The model only sees `content`, not `details`: surface the id it needs to
		// call get_search_content, the same way fetch_content does.
		if (getSearchContentEnabled && !hasApprovedSummary) {
			output += `\n---\nResults stored as responseId "${searchId}". Use ${toolNames.getSearchContent}({ responseId: "${searchId}", queryIndex: 0 }) to retrieve them.`;
		}

		return {
			content: [{ type: "text", text: output.trim() }],
			details: {
				queries: opts.queryList,
				queryCount: opts.queryList.length,
				successfulQueries: sc,
				totalResults: tr,
				includeContent: opts.includeContent,
				fetchId,
				fetchUrls: isBackgroundFetch ? opts.urls : undefined,
				searchId,
				...(opts.curated ? {
					curated: true,
					curatedFrom: opts.curatedFrom,
					curatedQueries: opts.results.map(r => ({
						query: r.query,
						provider: r.provider || null,
						answer: r.answer || null,
						sources: r.results.map(s => ({ title: s.title, url: s.url })),
						error: r.error,
					})),
				} : {}),
				...((opts.workflow && hasApprovedSummary)
					? {
						summary: {
							text: opts.approvedSummary!.trim(),
							workflow: opts.workflow,
							model: opts.summaryMeta?.model ?? null,
							durationMs: opts.summaryMeta?.durationMs ?? 0,
							tokenEstimate: opts.summaryMeta?.tokenEstimate ?? 0,
							fallbackUsed: opts.summaryMeta?.fallbackUsed === true,
							fallbackReason: opts.summaryMeta?.fallbackReason,
							phase: opts.summaryMeta?.phase,
							edited: opts.summaryMeta?.edited === true,
						},
					}
					: {}),
			},
		};
	}

	function filterByQueryIndices(selectedQueryIndices: number[], results: Map<number, QueryResultData>) {
		const filteredResults: QueryResultData[] = [];
		const filteredUrls: string[] = [];
		for (const qi of selectedQueryIndices) {
			const r = results.get(qi);
			if (r) {
				filteredResults.push(r);
				for (const res of r.results) {
					if (!filteredUrls.includes(res.url)) filteredUrls.push(res.url);
				}
			}
		}
		return { results: filteredResults, urls: filteredUrls };
	}

	function orderedSearchResults(resultsByIndex: Map<number, QueryResultData>): QueryResultData[] {
		return [...resultsByIndex.entries()]
			.sort(([leftIndex], [rightIndex]) => leftIndex - rightIndex)
			.map(([, result]) => result);
	}

	function collectAllResultsAndUrls(resultsByIndex: Map<number, QueryResultData>) {
		const results = orderedSearchResults(resultsByIndex);
		const urls: string[] = [];
		for (const result of results) {
			for (const source of result.results) {
				if (!urls.includes(source.url)) urls.push(source.url);
			}
		}
		return { results, urls };
	}

	async function openCuratorBrowser(callId: string, pc: PendingCurate, ctx: ExtensionContext, searchesComplete = true): Promise<void> {
		if (pendingCurates.get(callId) !== pc) return;
		let handle: CuratorServerHandle | null = null;
		const sendCuratorFallbackUpdate = (message: string) => {
			if (!handle) return;
			pc.onUpdate?.({
				content: [{ type: "text", text: `${message}\nOpen manually: ${handle.url}` }],
				details: {
					phase: "curator-fallback",
					progress: searchesComplete ? 1 : 0.5,
					curatorUrl: handle.url,
					timeoutSeconds: pc.timeoutSeconds,
					shortcut: curateKey,
					browserOpenError: pc.browserOpenError,
				},
			});
		};
		try {
			pc.phase = "curating";

			const searchAbort = new AbortController();
			const addSearchSignal = pc.signal
				? AbortSignal.any([pc.signal, searchAbort.signal])
				: searchAbort.signal;

			const sessionToken = randomUUID();
			handle = await startCuratorServer(
				{
					queries: pc.queryList,
					initialResultIndexCapacity: curatorResultIndexCapacity(pc.queryList.length),
					sessionToken,
					timeout: pc.timeoutSeconds,
					availableProviders: pc.availableProviders,
					defaultProvider: pc.defaultProvider,
					searchProvider: toCuratorProvider(pc.searchProvider) ?? "auto",
					summaryModels: pc.summaryModels,
					defaultSummaryModel: pc.defaultSummaryModel,
				},
				{
					async onSummarize(selectedQueryIndices, summarizeSignal, model, feedback) {
						return runWithProxy(pc.proxy, async () => {
							if (pendingCurates.get(callId) !== pc) throw new Error("Curator session is no longer active.");
							pc.onUpdate?.({
								content: [{ type: "text", text: "Generating summary draft..." }],
								details: { phase: "generating-summary", progress: 0.9, curatorUrl: pc.curatorUrl, timeoutSeconds: pc.timeoutSeconds, shortcut: curateKey },
							});
							const draft = await generateSummaryForSelectedIndices(
								selectedQueryIndices,
								pc.searchResults,
								pc.summaryContext,
								summarizeSignal,
								model,
								feedback,
							);
							if (pendingCurates.get(callId) !== pc) throw new Error("Curator session is no longer active.");
							pc.onUpdate?.({
								content: [{ type: "text", text: "Summary draft ready — waiting for approval..." }],
								details: { phase: "waiting-for-approval", progress: 1, curatorUrl: pc.curatorUrl, timeoutSeconds: pc.timeoutSeconds, shortcut: curateKey },
							});
							return draft;
						});
					},
					onSubmit(payload) {
						if (pendingCurates.get(callId) !== pc) return;
						searchAbort.abort();
						const filtered = payload.selectedQueryIndices.length > 0
							? filterByQueryIndices(payload.selectedQueryIndices, pc.searchResults)
							: collectAllResultsAndUrls(pc.searchResults);
						const filteredInline = pc.allInlineContent.filter(c => filtered.urls.includes(c.url));
						const base: SearchReturnOptions = {
							queryList: filtered.results.map(r => r.query),
							results: filtered.results,
							urls: filtered.urls,
							includeContent: pc.includeContent,
							inlineContent: filteredInline.length > 0 ? filteredInline : undefined,
							curated: true,
							curatedFrom: pc.searchResults.size,
							proxy: pc.proxy,
						};
						if (!payload.rawResults) {
							const resolvedSummary = resolveSummaryForSubmit(payload, pc.searchResults);
							base.workflow = pc.workflow;
							base.approvedSummary = resolvedSummary.approvedSummary;
							base.summaryMeta = resolvedSummary.summaryMeta;
						}
						pc.finish(buildSearchReturn(base));
						closeCurator(callId);
					},
					onCancel(reason) {
						if (pendingCurates.get(callId) !== pc) return;
						searchAbort.abort();
						if (reason === "timeout") {
							const resolvedSummary = resolveSummaryForSubmit({ selectedQueryIndices: [], summary: undefined, summaryMeta: undefined }, pc.searchResults);
							const all = collectAllResultsAndUrls(pc.searchResults);
							const filteredInline = pc.allInlineContent.filter(c => all.urls.includes(c.url));
							pc.finish(buildSearchReturn({
								queryList: all.results.map(r => r.query),
								results: all.results,
								urls: all.urls,
								includeContent: pc.includeContent,
								inlineContent: filteredInline.length > 0 ? filteredInline : undefined,
								curated: true,
								curatedFrom: pc.searchResults.size,
								workflow: pc.workflow,
								approvedSummary: resolvedSummary.approvedSummary,
								summaryMeta: resolvedSummary.summaryMeta,
								proxy: pc.proxy,
							}));
						} else {
							const conn = activeCurators.get(callId)?.getConnectionState();
							pc.finish(buildCurationCancelledReturn(reason, {
								queries: orderedSearchResults(pc.searchResults),
								queryCount: pc.queryList.length,
								browserConnected: conn?.browserConnected,
								lastHeartbeatAgeMs: conn?.lastHeartbeatAgeMs,
								curatorUrl: pc.curatorUrl,
								browserOpenError: pc.browserOpenError,
							}));
						}
						closeCurator(callId);
					},
					onProviderChange(provider) {
						if (pendingCurates.get(callId) !== pc) return;
						const normalized = normalizeProviderInput(provider);
						if (!normalized || normalized === "auto" || Array.isArray(normalized)) return;
						pc.defaultProvider = normalized;
						pc.searchProvider = normalized;
						try {
							saveConfig({ provider: normalized });
						} catch (err) {
							const message = err instanceof Error ? err.message : String(err);
							console.error(`Failed to persist default provider: ${message}`);
						}
					},
					async onAddSearch(query, provider) {
						return runWithProxy(pc.proxy, async () => {
							if (pendingCurates.get(callId) !== pc) throw new Error("Curator session is no longer active.");
							const requestedProvider = resolveCuratorSearchProvider(provider, pc.searchProvider);
							const response = await search(query, {
								provider: requestedProvider,
								numResults: pc.numResults,
								recencyFilter: pc.recencyFilter,
								domainFilter: pc.domainFilter,
								includeContent: pc.includeContent,
								signal: addSearchSignal,
								extensionContext: ctx,
							});
							if (pendingCurates.get(callId) !== pc) throw new Error("Curator session is no longer active.");
							if (response.inlineContent) pc.allInlineContent.push(...response.inlineContent);
							return toCuratorSearchEntries(response);
						});
					},
					onAddSearchResults(entries) {
						if (pendingCurates.get(callId) !== pc) return;
						for (const entry of entries) {
							pc.searchResults.set(entry.queryIndex, indexedCuratorEntryToQueryResult(entry));
						}
					},
					async onRewriteQuery(query, rewriteSignal) {
						return runWithProxy(pc.proxy, async () => {
							if (pendingCurates.get(callId) !== pc) throw new Error("Curator session is no longer active.");
							return rewriteSearchQuery(query, pc.summaryContext, rewriteSignal);
						});
					},
				},
			);

			if (pendingCurates.get(callId) !== pc) {
				handle.close();
				return;
			}

			activeCurators.set(callId, handle);
			pc.curatorUrl = handle.url;

			for (const [qi, data] of pc.searchResults) {
				const slotIndex = pc.resultSlots.get(qi);
				if (data.error) {
					handle.pushError(qi, data.error, data.provider, { query: data.query, slotIndex });
				} else {
					handle.pushResult(qi, {
						answer: data.answer,
						results: data.results.map(r => ({ ...r, domain: extractDomain(r.url) })),
						provider: data.provider || pc.defaultProvider,
						query: data.query,
						slotIndex,
					});
				}
			}
			if (searchesComplete) handle.searchesDone();

			pc.onUpdate?.({
				content: [{ type: "text", text: searchesComplete ? "Waiting for summary approval in browser..." : "Searches streaming to browser..." }],
				details: {
					phase: "curating",
					progress: searchesComplete ? 1 : 0.5,
					curatorUrl: handle.url,
					timeoutSeconds: pc.timeoutSeconds,
					shortcut: curateKey,
				},
			});

			if (!shouldAutoOpenCuratorBrowser(loadConfig())) {
				sendCuratorFallbackUpdate("Search curator is running. Open the curator URL manually.");
				return;
			}

			const open = platform() === "darwin" ? await getGlimpseOpen() : null;
			if (open) {
				try {
					const win = openInGlimpse(open, handle.url, "Search Curator");
					glimpseWins.set(callId, win);
					win.on("closed", () => {
						if (glimpseWins.get(callId) === win) {
							glimpseWins.delete(callId);
							closeCurator(callId);
						}
					});
					return;
				} catch (err) {
					const message = err instanceof Error ? err.message : String(err);
					console.error(`Failed to open Glimpse curator window: ${message}`);
					glimpseWins.delete(callId);
				}
			}
			await openInBrowser(pi, handle.url);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			console.error(`Failed to open curator UI: ${message}`);
			if (handle && activeCurators.get(callId) === handle && pendingCurates.get(callId) === pc) {
				pc.browserOpenError = message;
				sendCuratorFallbackUpdate("Search curator is running, but the browser did not open automatically.");
			} else if (pendingCurates.get(callId) === pc || (handle && activeCurators.get(callId) === handle)) {
				closeCurator(callId);
			}
		}
	}

	pi.registerShortcut(curateKey, {
		description: "Review search results",
		handler: async (ctx) => {
			const entries = [...pendingCurates.entries()];
			if (entries.length === 0) return;
			const [callId, pc] = entries[entries.length - 1];

			if (pc.phase === "searching") {
				pc.browserPromise = openCuratorBrowser(callId, pc, ctx, false);
				ctx.ui.notify("Opening curator — remaining searches will stream in", "info");
				return;
			}
		},
	});

	pi.registerShortcut(activityKey, {
		description: "Toggle web search activity",
		handler: async (ctx) => {
			widgetVisible = !widgetVisible;
			if (widgetVisible) {
				widgetUnsubscribe = activityMonitor.onUpdate(() => updateWidget(ctx));
				updateWidget(ctx);
			} else {
				widgetUnsubscribe?.();
				widgetUnsubscribe = null;
				ctx.ui.setWidget("web-activity", undefined);
			}
		},
	});

	pi.on("session_start", async (_event, ctx) => handleSessionChange(ctx));
	pi.on("session_tree", async (_event, ctx) => handleSessionChange(ctx));

	pi.on("session_shutdown", () => {
		sessionActive = false;
		abortPendingFetches();
		closeCurator();
		clearCloneCache();
		clearResults();
		// Unsubscribe before clear() to avoid callback with stale ctx
		widgetUnsubscribe?.();
		widgetUnsubscribe = null;
		activityMonitor.clear();
		widgetVisible = false;
	});

	if (webSearchEnabled) pi.registerTool({
		name: toolNames.webSearch,
		label: "Web Search",
		description:
			`Search the web using OpenAI, Brave, Parallel, Parallel MCP, TinyFish, Search1API, Searchinfinity, Querit, Tavily, Firecrawl, Jina, SERPdive, Kagi, Bocha, Ollama, SearXNG, DuckDuckGo, Exa, Perplexity, Gemini, Kimi, AnySearch, XCrawl, Valyu, xAI, Mistral, Bright Data, SerpBase, or Serper. Pass a provider array to search only those providers simultaneously, or use provider "all" to search every eligible provider except Parallel MCP, DuckDuckGo, Kimi, AnySearch, XCrawl, Valyu, xAI, Mistral, Bright Data, SerpBase, and Serper. Returns an AI-synthesized answer with source citations. OpenAI search uses a Codex subscription or OpenAI API key; Kimi search uses a Kimi Code Plan authenticated through /login kimi-coding; xAI search uses a SuperGrok/X Premium subscription or xAI API key; Mistral search uses a Mistral API key. Parallel MCP, DuckDuckGo, Kimi, AnySearch, XCrawl, Valyu, xAI, Mistral, Bright Data, SerpBase, and Serper are available only when explicitly selected. For comprehensive research, prefer queries (plural) with 2-4 varied angles over a single query — each query gets its own synthesized answer, so varying phrasing and scope gives much broader coverage. When includeContent is true, full page content is fetched in the background. Searches auto-open the interactive browser curator and stream results live; set workflow to "none" to skip curation or "auto-summary" for a model-generated summary without the browser curator. The configured provider is used when provider is omitted or set to auto; omit provider unless explicitly overriding it. Without a configured provider, SearXNG is preferred first for local/private search. When the active Pi model is openai-codex, Codex-backed OpenAI search is preferred next. Otherwise Exa is preferred before OpenAI, then Brave, Parallel, TinyFish, Search1API, Searchinfinity, Querit, Tavily, Firecrawl, Jina, SERPdive, Kagi, Bocha, Ollama, Perplexity, Gemini API, or Gemini Web.`,
		promptSnippet:
			"Use for web research questions. Prefer {queries:[...]} with 2-4 varied angles over a single query for broader coverage. Omit provider unless explicitly overriding the configured default.",
		parameters: Type.Object({
			query: Type.Optional(Type.String({ description: "Single search query. For research tasks, prefer 'queries' with multiple varied angles instead." })),
			queries: Type.Optional(Type.Array(Type.String(), { description: "Multiple queries searched concurrently (up to three at a time), each returning its own synthesized answer. Prefer this for research — vary phrasing, scope, and angle across 2-4 queries to maximize coverage. Good: ['React vs Vue performance benchmarks 2026', 'React vs Vue developer experience comparison', 'React ecosystem size vs Vue ecosystem']. Bad: ['React vs Vue', 'React vs Vue comparison', 'React vs Vue review'] (too similar, redundant results)." })),
			numResults: Type.Optional(Type.Integer({ minimum: 1, maximum: 20, description: "Results per query (default: 5, max: 20)" })),
			includeContent: Type.Optional(Type.Boolean({ description: "Fetch full page content (async)" })),
			recencyFilter: Type.Optional(
				StringEnum(["day", "week", "month", "year"], { description: "Filter by recency" }),
			),
			domainFilter: Type.Optional(Type.Array(Type.String(), { description: "Limit to domains (prefix with - to exclude)" })),
			provider: Type.Optional(searchProviderSchema("Search provider or non-empty list of providers to search simultaneously; use all to search every eligible provider except Parallel MCP, DuckDuckGo, Kimi, AnySearch, XCrawl, Valyu, xAI, Mistral, Bright Data, SerpBase, and Serper, omit this field to use the configured provider, or use auto when none is configured")),
			workflow: Type.Optional(
				StringEnum(["none", "summary-review", "auto-summary"], {
					description: "Search workflow mode: none = no curator, summary-review = open curator with auto summary draft (default), auto-summary = generate summary without opening curator",
				}),
			),
			proxy: Type.Optional(Type.String({
				description: "http(s) proxy URL (e.g. http://host:port) used for every outbound request in this call (search APIs and content fetches). Node fetch ignores HTTP(S)_PROXY env vars, so set this (or `proxy` in web-search.json) when direct access is blocked; empty string forces direct access.",
			})),
		}),

		async execute(callId, params, signal, onUpdate, ctx) {
			return runWithProxy(typeof params.proxy === "string" ? params.proxy : undefined, async () => {
				const rawQueryList: unknown[] = Array.isArray(params.queries)
					? params.queries
					: (params.query !== undefined ? expandQueryString(params.query) : []);
				const queryList = normalizeQueryList(rawQueryList);
				const configWorkflow = loadConfigForExtensionInit().workflow;
				const workflow = resolveWorkflow(params.workflow ?? configWorkflow, ctx?.hasUI !== false);
				const shouldCurate = workflow === "summary-review";
				const recencyFilter = normalizeRecencyFilter(params.recencyFilter);

				if (queryList.length === 0) {
					return {
						content: [{ type: "text", text: "Error: No query provided. Use 'query' or 'queries' parameter." }],
						details: { error: "No query provided" },
					};
				}

				if (shouldCurate && !ctx) {
					return {
						content: [{ type: "text", text: "Error: Curation requires an active extension context." }],
						details: { error: "Missing extension context" },
					};
				}

				if (shouldCurate) {
				closeCurator(callId);

				let resolvePromise: (value: AgentToolResult<Record<string, unknown>>) => void = () => {};
				const promise = new Promise<AgentToolResult<Record<string, unknown>>>((resolve) => {
					resolvePromise = resolve;
				});
				const includeContent = params.includeContent ?? false;
				const searchResults = new Map<number, QueryResultData>();
				const resultSlots = new Map<number, number>();
				const allInlineContent: ExtractedContent[] = [];
				const searchAbort = new AbortController();
				const searchSignal = signal
					? AbortSignal.any([signal, searchAbort.signal])
					: searchAbort.signal;
				let cancelled = false;

				const requestedProvider = resolveRequestedProvider(params.provider);
				const bootstrap = await loadCuratorBootstrap(requestedProvider, ctx, {
					numResults: params.numResults,
					recencyFilter,
				});
				const availableProviders = bootstrap.availableProviders;
				const defaultProvider = bootstrap.defaultProvider;
				const searchProvider = requestedProvider;
				const curatorTimeoutSeconds = bootstrap.timeoutSeconds;
				const curatorWorkflow: CuratorWorkflow = "summary-review";

				const summaryContext: SummaryGenerationContext = {
					model: ctx.model,
					modelRegistry: ctx.modelRegistry,
					cwd: ctx.cwd,
					isProjectTrusted: () => ctx.isProjectTrusted(),
				};
				const summaryModelChoices = await loadSummaryModelChoices(summaryContext);

				const pc: PendingCurate = {
					phase: "searching",
					workflow: curatorWorkflow,
					summaryContext,
					searchResults,
					resultSlots,
					allInlineContent,
					queryList,
					includeContent,
					numResults: params.numResults,
					recencyFilter,
					domainFilter: params.domainFilter,
					availableProviders,
					defaultProvider,
					searchProvider,
					summaryModels: summaryModelChoices.summaryModels,
					defaultSummaryModel: summaryModelChoices.defaultSummaryModel,
					timeoutSeconds: curatorTimeoutSeconds,
					proxy: typeof params.proxy === "string" ? params.proxy : undefined,
					onUpdate: onUpdate as PendingCurate["onUpdate"],
					signal,
					abortSearches: () => {
						if (!searchAbort.signal.aborted) searchAbort.abort();
					},
					finish: () => {},
					cancel: () => {},
				};

				const finish = (value: AgentToolResult<Record<string, unknown>>) => {
					if (cancelled) return;
					cancelled = true;
					pc.abortSearches();
					signal?.removeEventListener("abort", onAbort);
					pendingCurates.delete(callId);
					resolvePromise(value);
				};

				const cancel = (reason: "user" | "stale" = "stale") => {
					if (cancelled) return;
					const conn = activeCurators.get(callId)?.getConnectionState();
					finish(buildCurationCancelledReturn(reason, {
						queries: orderedSearchResults(searchResults),
						queryCount: queryList.length,
						browserConnected: conn?.browserConnected,
						lastHeartbeatAgeMs: conn?.lastHeartbeatAgeMs,
						curatorUrl: pc.curatorUrl,
						browserOpenError: pc.browserOpenError,
					}));
				};

				pc.finish = finish;
				pc.cancel = cancel;

				const onAbort = () => closeCurator(callId);
				pendingCurates.set(callId, pc);
				signal?.addEventListener("abort", onAbort, { once: true });
				pc.browserPromise = openCuratorBrowser(callId, pc, ctx, false);

				let completedSearches = 0;
				await runSearchQueries(queryList, async (query, qi) => {
					if (signal?.aborted || cancelled || searchAbort.signal.aborted) return;
					onUpdate?.({
						content: [{ type: "text", text: `Searching "${query}" (${completedSearches}/${queryList.length} complete)...` }],
						details: { phase: "searching", progress: completedSearches / queryList.length, currentQuery: query },
					});
					const requestedProvider = pc.searchProvider;
					try {
						const response = await search(query, {
							provider: requestedProvider,
							numResults: params.numResults,
							recencyFilter,
							domainFilter: params.domainFilter,
							includeContent: params.includeContent,
							signal: searchSignal,
							extensionContext: ctx,
						});
						if (signal?.aborted || cancelled || searchAbort.signal.aborted) return;
						if (response.inlineContent) allInlineContent.push(...response.inlineContent);
						const entries = toCuratorSearchEntries(response);
						const curator = activeCurators.get(callId);
						for (let entryIndex = 0; entryIndex < entries.length; entryIndex++) {
							const entry = entries[entryIndex];
							const resultIndex = curatorResultIndex(qi, entryIndex, queryList.length);
							const indexedEntry: IndexedCuratorSearchEntry = {
								...entry,
								queryIndex: resultIndex,
								query,
							};
							searchResults.set(resultIndex, indexedCuratorEntryToQueryResult(indexedEntry));
							resultSlots.set(resultIndex, qi);
							if (curator) {
								if (entry.error) {
									curator.pushError(resultIndex, entry.error, entry.provider, { query, slotIndex: qi });
								} else {
									curator.pushResult(resultIndex, { ...entry, query, slotIndex: qi });
								}
							}
						}
					} catch (err) {
						if (signal?.aborted || cancelled || searchAbort.signal.aborted) return;
						const message = err instanceof Error ? err.message : String(err);
						const failedProvider = toCuratorProvider(requestedProvider);
						searchResults.set(qi, { query, answer: "", results: [], error: message, provider: failedProvider });
						resultSlots.set(qi, qi);
						const curator = activeCurators.get(callId);
						if (curator) {
							curator.pushError(qi, message, failedProvider, { query, slotIndex: qi });
						}
					} finally {
						completedSearches++;
						if (!signal?.aborted && !cancelled && !searchAbort.signal.aborted) {
							onUpdate?.({
								content: [{ type: "text", text: `Completed ${completedSearches}/${queryList.length} searches.` }],
								details: { phase: "searching", progress: completedSearches / queryList.length, currentQuery: query },
							});
						}
					}
				});

				if (signal?.aborted || cancelled || searchAbort.signal.aborted) {
					cancel();
					return promise;
				}

				await pc.browserPromise;
				const curator = activeCurators.get(callId);
				if (curator && !cancelled) {
					curator.searchesDone();
					if (pc.browserOpenError) {
						pc.onUpdate?.({
							content: [{ type: "text", text: `All searches complete. Open the curator manually: ${pc.curatorUrl}` }],
							details: {
								phase: "curator-fallback",
								progress: 1,
								curatorUrl: pc.curatorUrl,
								timeoutSeconds: pc.timeoutSeconds,
								shortcut: curateKey,
								browserOpenError: pc.browserOpenError,
							},
						});
					} else {
						pc.onUpdate?.({
							content: [{ type: "text", text: "All searches complete — waiting for summary approval in browser..." }],
							details: {
								phase: "curating",
								progress: 1,
								curatorUrl: pc.curatorUrl,
								timeoutSeconds: pc.timeoutSeconds,
								shortcut: curateKey,
							},
						});
					}
				}

				return promise;
			}

			let completedSearches = 0;
			const allUrls: string[] = [];
			const allInlineContent: ExtractedContent[] = [];
			const resolvedProvider = resolveRequestedProvider(params.provider);

			const queryResponses = await runSearchQueries(queryList, async (query) => {
				signal?.throwIfAborted();
				onUpdate?.({
					content: [{ type: "text", text: `Searching "${query}" (${completedSearches}/${queryList.length} complete)...` }],
					details: { phase: "search", progress: completedSearches / queryList.length, currentQuery: query },
				});

				try {
					const { answer, results, inlineContent, provider } = await search(query, {
						provider: resolvedProvider,
						numResults: params.numResults,
						recencyFilter,
						domainFilter: params.domainFilter,
						includeContent: params.includeContent,
						signal,
						extensionContext: ctx,
					});

					return { result: { query, answer, results, error: null, provider } satisfies QueryResultData, inlineContent };
				} catch (err) {
					if (signal?.aborted || isAbortError(err)) throw err;
					const message = err instanceof Error ? err.message : String(err);
					const requestedProvider = toCuratorProvider(resolvedProvider);
					return {
						result: { query, answer: "", results: [], error: message, provider: requestedProvider } satisfies QueryResultData,
						inlineContent: undefined,
					};
				} finally {
					completedSearches++;
					if (!signal?.aborted) {
						onUpdate?.({
							content: [{ type: "text", text: `Completed ${completedSearches}/${queryList.length} searches.` }],
							details: { phase: "search", progress: completedSearches / queryList.length, currentQuery: query },
						});
					}
				}
			});
			const searchResults = queryResponses.map(response => response.result);
			for (const response of queryResponses) {
				for (const result of response.result.results) {
					if (!allUrls.includes(result.url)) allUrls.push(result.url);
				}
				if (response.inlineContent) allInlineContent.push(...response.inlineContent);
			}

			let approvedSummary: string | undefined;
			let summaryMeta: SummaryMeta | undefined;
			if (workflow === "auto-summary") {
				if (!ctx) {
					return {
						content: [{ type: "text", text: "Error: Auto-summary requires an active extension context." }],
						details: { error: "Missing extension context" },
					};
				}
				onUpdate?.({
					content: [{ type: "text", text: "Generating summary..." }],
					details: { phase: "generating-summary", progress: 1 },
				});
				const summaryContext: SummaryGenerationContext = {
					model: ctx.model,
					modelRegistry: ctx.modelRegistry,
					cwd: ctx.cwd,
					isProjectTrusted: () => ctx.isProjectTrusted(),
				};
				const summaryModelChoices = await loadSummaryModelChoices(summaryContext);
				const generated = await generateSummaryDraft(
					searchResults,
					summaryContext,
					signal,
					summaryModelChoices.defaultSummaryModel ?? undefined,
					undefined,
					undefined,
					getSummaryGenerationDeadlineMs(),
				);
				approvedSummary = generated.summary;
				summaryMeta = generated.meta;
			}

			return buildSearchReturn({
				queryList,
				results: searchResults,
				urls: allUrls,
				includeContent: params.includeContent ?? false,
				inlineContent: allInlineContent.length > 0 ? allInlineContent : undefined,
				workflow: workflow === "auto-summary" ? "auto-summary" : undefined,
				approvedSummary,
				summaryMeta,
				proxy: typeof params.proxy === "string" ? params.proxy : undefined,
			});
			});
		},

		renderCall(args, theme) {
			const input = args as { query?: unknown; queries?: unknown };
			const rawQueryList: unknown[] = Array.isArray(input.queries)
				? input.queries
				: (input.query !== undefined ? expandQueryString(input.query) : []);
			const queryList = normalizeQueryList(rawQueryList);
			if (queryList.length === 0) {
				return new Text(theme.fg("toolTitle", theme.bold("search ")) + theme.fg("error", "(no query)"), 0, 0);
			}
			if (queryList.length === 1) {
				const q = queryList[0];
				const display = q.length > 60 ? q.slice(0, 57) + "..." : q;
				return new Text(theme.fg("toolTitle", theme.bold("search ")) + theme.fg("accent", `"${display}"`), 0, 0);
			}
			const lines = [theme.fg("toolTitle", theme.bold("search ")) + theme.fg("accent", `${queryList.length} queries`)];
			for (const q of queryList.slice(0, 5)) {
				const display = q.length > 50 ? q.slice(0, 47) + "..." : q;
				lines.push(theme.fg("muted", `  "${display}"`));
			}
			if (queryList.length > 5) {
				lines.push(theme.fg("muted", `  ... and ${queryList.length - 5} more`));
			}
			return new Text(lines.join("\n"), 0, 0);
		},

		renderResult(result, { expanded, isPartial }, theme) {
			type QueryDetail = {
				query: string;
				provider: string | null;
				answer: string | null;
				sources: Array<{ title: string; url: string }>;
				error: string | null;
			};
			const details = result.details as {
				queryCount?: number;
				successfulQueries?: number;
				totalResults?: number;
				error?: string;
				fetchId?: string;
				fetchUrls?: string[];
				phase?: string;
				progress?: number;
				currentQuery?: string;
				curated?: boolean;
				curatedFrom?: number;
				curatedQueries?: QueryDetail[];
				cancelled?: boolean;
				cancelReason?: string;
				browserConnected?: boolean;
				lastHeartbeatAgeMs?: number | null;
				cancelledQueries?: import("./render-search-error.ts").CancelledQueryDetail[];
				curatorUrl?: string;
				browserOpenError?: string;
				timeoutSeconds?: number;
				shortcut?: string;
				summary?: {
					text: string;
					workflow: SummaryWorkflow;
					model: string | null;
					durationMs: number;
					tokenEstimate: number;
					fallbackUsed: boolean;
					fallbackReason?: string;
					phase?: "summary-model" | "deterministic-fallback";
					edited?: boolean;
				};
			};

			if (isPartial) {
				if (details?.phase === "curator-fallback") {
					const lines = [theme.fg("warning", "Open the search curator manually:")];
					if (details?.curatorUrl) lines.push(theme.fg("muted", `  ${details.curatorUrl}`));
					if (details?.browserOpenError) lines.push(theme.fg("dim", `  auto-open failed: ${details.browserOpenError}`));
					const timeout = typeof details?.timeoutSeconds === "number" ? details.timeoutSeconds : undefined;
					const shortcut = typeof details?.shortcut === "string" ? details.shortcut : curateKey;
					lines.push(theme.fg("dim", timeout ? `  auto-submits after ${timeout}s idle; ${shortcut} reopens` : `  ${shortcut} reopens`));
					return new Text(lines.join("\n"), 0, 0);
				}
				if (details?.phase === "curating" || details?.phase === "waiting-for-approval" || details?.phase === "generating-summary") {
					const phaseText = details?.phase === "generating-summary"
						? "generating summary draft..."
						: details?.phase === "waiting-for-approval"
							? "summary draft ready; approve in browser..."
							: "waiting for summary approval in browser...";
					const lines = [theme.fg("accent", phaseText)];
					if (details?.curatorUrl) {
						lines.push(theme.fg("muted", `  ${details.curatorUrl}`));
					}
					const timeout = typeof details?.timeoutSeconds === "number" ? details.timeoutSeconds : undefined;
					const shortcut = typeof details?.shortcut === "string" ? details.shortcut : curateKey;
					if (timeout) {
						lines.push(theme.fg("dim", `  auto-submits after ${timeout}s idle; ${shortcut} reopens`));
					} else {
						lines.push(theme.fg("dim", `  ${shortcut} reopens`));
					}
					return new Text(lines.join("\n"), 0, 0);
				}
				if (details?.phase === "searching") {
					const progress = details?.progress ?? 0;
					const bar = "\u2588".repeat(Math.floor(progress * 10)) + "\u2591".repeat(10 - Math.floor(progress * 10));
					const query = details?.currentQuery || "";
					const display = query.length > 40 ? query.slice(0, 37) + "..." : query;
					return new Text(theme.fg("accent", `[${bar}] ${display}`), 0, 0);
				}
				const progress = details?.progress ?? 0;
				const bar = "\u2588".repeat(Math.floor(progress * 10)) + "\u2591".repeat(10 - Math.floor(progress * 10));
				return new Text(theme.fg("accent", `[${bar}] ${details?.phase || "searching"}`), 0, 0);
			}

			if (details?.error) {
				// Expandable Ctrl+O diagnostics: which queries completed, per-query errors,
				// browser connection state, cancel reason. See render-search-error.ts.
				const plan = buildSearchErrorPlan(details as SearchErrorDetails);
				if (plan) return renderSearchErrorPlan(plan, expanded, theme);
				return new Text(theme.fg("error", `Error: ${details.error}`), 0, 0);
			}

			let statusLine: string;
			const queryInfo = details?.queryCount === 1 ? "" : `${details?.successfulQueries}/${details?.queryCount} queries, `;
			statusLine = theme.fg("success", `${queryInfo}${details?.totalResults ?? 0} sources`);
			if (details?.curated && details?.curatedFrom) {
				statusLine += theme.fg("muted", ` (${details.queryCount}/${details.curatedFrom} queries curated)`);
			}
			if (details?.fetchId && details?.fetchUrls) {
				statusLine += theme.fg("muted", ` (fetching ${details.fetchUrls.length} URLs)`);
			} else if (details?.fetchId) {
				statusLine += theme.fg("muted", " (content ready)");
			}

			// Build expanded lines first so collapsed view can reference total count
			const lines = [statusLine];
			if (details?.summary?.text) {
				lines.push("");
				lines.push(theme.fg("accent", `── Summary (${details.summary.workflow}) ` + "─".repeat(32)));
				lines.push("");
				for (const line of details.summary.text.split("\n")) {
					lines.push(`  ${line}`);
				}
				lines.push("");
				const metaParts = [
					details.summary.model ? `model=${details.summary.model}` : "model=deterministic",
					`duration=${details.summary.durationMs}ms`,
					`tokens~${details.summary.tokenEstimate}`,
					details.summary.fallbackUsed ? "fallback=true" : "fallback=false",
					details.summary.phase ? `phase=${details.summary.phase}` : "",
					details.summary.edited ? "edited=true" : "edited=false",
				];
				if (details.summary.fallbackReason) {
					metaParts.push(`reason=${details.summary.fallbackReason}`);
				}
				lines.push(theme.fg("dim", "  " + metaParts.filter(Boolean).join(" · ")));
			}

			const queryDetails = details?.curatedQueries;
			if (queryDetails?.length) {
				const kept = queryDetails.length;
				const from = details?.curatedFrom ?? kept;
				lines.push("");
				lines.push(theme.fg("accent", `\u2500\u2500 Curated Results (${kept} of ${from} queries kept) ` + "\u2500".repeat(24)));

				for (const cq of queryDetails) {
					lines.push("");
					const dq = cq.query.length > 65 ? cq.query.slice(0, 62) + "..." : cq.query;
					const providerLabel = cq.provider ? ` (${cq.provider})` : "";
					lines.push(theme.fg("accent", `  "${dq}"${providerLabel}`));

					if (cq.error) {
						lines.push(theme.fg("error", `  ${cq.error}`));
					} else if (cq.answer) {
						lines.push("");
						for (const line of cq.answer.split("\n")) {
							lines.push(`  ${line}`);
						}
					}

					if (cq.sources.length > 0) {
						lines.push("");
						for (const s of cq.sources) {
							const domain = s.url.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
							const title = s.title.length > 50 ? s.title.slice(0, 47) + "..." : s.title;
							lines.push(theme.fg("muted", `  \u25b8 ${title}`) + theme.fg("dim", ` \u00b7 ${domain}`));
						}
					}
				}
				lines.push("");
			} else {
				const textContent = result.content.find((c) => c.type === "text")?.text || "";
				const preview = textContent.length > 500 ? textContent.slice(0, 500) + "..." : textContent;
				for (const line of preview.split("\n")) {
					lines.push(theme.fg("dim", line));
				}
			}

			if (details?.fetchUrls && details.fetchUrls.length > 0) {
				if (details.curated) {
					lines.push(theme.fg("muted", `Fetching ${details.fetchUrls.length} URLs in background`));
				} else {
					lines.push(theme.fg("muted", "Fetching:"));
					for (const u of details.fetchUrls.slice(0, 5)) {
						const display = u.length > 60 ? u.slice(0, 57) + "..." : u;
						lines.push(theme.fg("dim", "  " + display));
					}
					if (details.fetchUrls.length > 5) {
						lines.push(theme.fg("dim", `  ... and ${details.fetchUrls.length - 5} more`));
					}
				}
			}

			const totalLines = lines.length;

			if (!expanded) {
				const box = new Box(1, 0);
				box.addChild(new Text(statusLine, 0, 0));

				let collapsedLines = 1; // statusLine
				const summaryPreview = details?.summary?.text?.trim() || "";
				if (summaryPreview) {
					const preview = summaryPreview.length > 120 ? summaryPreview.slice(0, 117) + "..." : summaryPreview;
					box.addChild(new Text(theme.fg("dim", preview), 0, 0));
					collapsedLines++;
				} else if (details?.curatedQueries?.length) {
					for (const cq of details.curatedQueries.slice(0, 3)) {
						const dq = cq.query.length > 55 ? cq.query.slice(0, 52) + "..." : cq.query;
						const srcCount = cq.sources?.length ?? 0;
						const suffix = cq.error ? theme.fg("error", " (error)") : theme.fg("dim", ` · ${srcCount} sources`);
						box.addChild(new Text(theme.fg("accent", `  "${dq}"`) + suffix, 0, 0));
						collapsedLines++;
					}
					if (details.curatedQueries.length > 3) {
						box.addChild(new Text(theme.fg("dim", `  ... and ${details.curatedQueries.length - 3} more`), 0, 0));
						collapsedLines++;
					}
				} else {
					const textContent = result.content.find((c) => c.type === "text")?.text || "";
					const firstContentLine = textContent.split("\n").find(l => {
						const t = l.trim();
						return t && !t.startsWith("[") && !t.startsWith("#") && !t.startsWith("---");
					});
					const fallbackLine = (firstContentLine?.trim() || "").replace(/\*\*/g, "");
					if (fallbackLine) {
						const preview = fallbackLine.length > 120 ? fallbackLine.slice(0, 117) + "..." : fallbackLine;
						box.addChild(new Text(theme.fg("dim", preview), 0, 0));
						collapsedLines++;
					}
				}
				const moreLines = Math.max(0, totalLines - collapsedLines);
				if (moreLines > 0) {
					box.addChild(new Text(theme.fg("muted", `\n... (${moreLines} more lines, ${totalLines} total, ctrl+o to expand)`), 0, 0));
				}
				return box;
			}

			return new Text(lines.join("\n"), 0, 0);
		},
	});

	if (sourceCheckEnabled) pi.registerTool({
		name: toolNames.sourceCheck,
		label: "Source Check",
		description: "Check a claim against web sources and return a bounded machine-readable research artifact with exact passage citations.",
		promptSnippet: "Verify a claim with structured source evidence and passage-level citations.",
		parameters: Type.Object({
			claim: Type.String({ description: "The assertion to check against web sources." }),
			queries: Type.Optional(Type.Array(Type.String(), { description: "Search queries (default: the claim)." })),
			numResults: Type.Optional(Type.Integer({ minimum: 1, maximum: 20, description: "Results per query (default: 5, max: 20)." })),
			fetchContent: Type.Optional(Type.Boolean({ description: "Fetch up to 5 result pages for exact passage extraction." })),
			recencyFilter: Type.Optional(StringEnum(["day", "week", "month", "year"], { description: "Filter by recency." })),
			domainFilter: Type.Optional(Type.Array(Type.String(), { description: "Limit to domains; prefix with - to exclude." })),
			provider: Type.Optional(searchProviderSchema("Search provider or non-empty list of providers to search simultaneously; all searches every eligible provider except Parallel MCP, DuckDuckGo, Kimi, AnySearch, XCrawl, Valyu, xAI, Mistral, Bright Data, SerpBase, and Serper")),
			proxy: Type.Optional(Type.String({
				description: "http(s) proxy URL (e.g. http://host:port) used for every outbound request in this call (search APIs and result-page fetches). Empty string forces direct access.",
			})),
		}),
		async execute(_callId, params, signal, _onUpdate, ctx) {
			return runWithProxy(typeof params.proxy === "string" ? params.proxy : undefined, async () => {
				const claim = typeof params.claim === "string" ? params.claim.trim() : "";
				if (!claim) {
					return { content: [{ type: "text", text: "Error: 'claim' is required." }], details: { error: "Missing claim" } };
				}

				const requestedQueries = Array.isArray(params.queries)
					? params.queries.filter((query): query is string => typeof query === "string").map((query) => query.trim()).filter(Boolean)
					: [];
				const queries = (requestedQueries.length > 0 ? requestedQueries : [claim]).slice(0, 8);
				const numResults = typeof params.numResults === "number" && Number.isFinite(params.numResults)
					? Math.min(20, Math.max(1, Math.floor(params.numResults)))
					: 5;
				const domainFilter = Array.isArray(params.domainFilter)
					? params.domainFilter.filter((domain): domain is string => typeof domain === "string")
					: undefined;
				const recencyFilter = normalizeRecencyFilter(params.recencyFilter);
				const resultsByUrl = new Map<string, SearchResult>();
				const summaries: string[] = [];
				const errors: Array<{ query: string; error: string }> = [];
				let provider: string | undefined;

				for (const query of queries) {
					if (signal?.aborted) break;
					try {
						const response = await search(query, {
							provider: resolveRequestedProvider(params.provider),
							numResults,
							recencyFilter,
							domainFilter,
							signal,
							extensionContext: ctx,
						});
						if (signal?.aborted) break;
						provider ??= response.provider;
						if (response.answer) summaries.push(`${query}: ${response.answer}`);
						for (const result of response.results) {
							if (!resultsByUrl.has(result.url)) resultsByUrl.set(result.url, result);
						}
					} catch (err) {
						if (signal?.aborted || isAbortError(err)) break;
						errors.push({ query, error: err instanceof Error ? err.message : String(err) });
					}
				}

				const results = [...resultsByUrl.values()].slice(0, 20).map((result, index) => ({ ...result, rank: index + 1 }));
				let fetched: ExtractedContent[] = [];
				if (params.fetchContent && results.length > 0) {
					const urls = results.slice(0, 5).map((result) => result.url);
					try {
						fetched = await fetchAllContent(urls, signal, withRegisteredFetchOptions(undefined, registeredToolNames, typeof params.proxy === "string" ? params.proxy : undefined));
					} catch (err) {
						if (signal?.aborted || isAbortError(err)) throw err;
						fetched = urls.map((url) => ({ url, title: "", content: "", error: err instanceof Error ? err.message : String(err) }));
					}
				}
				const artifact = withClaimAssessment(buildResearchArtifact({
					query: claim,
					provider,
					summary: summaries.length > 0 ? summaries.join("\n\n") : undefined,
					results,
					fetched,
					recency: recencyFilter,
					domainFilter,
				}), [claim]);
				if (errors.length > 0) artifact.errors = errors;
				storeResearchArtifact(artifact);
				pi.appendEntry("web-search-results", {
					id: artifact.id,
					type: "research",
					timestamp: artifact.timestamp,
					artifact,
				});
				return {
					content: [{ type: "text", text: formatSourceCheckResult(artifact, getSearchContentEnabled ? toolNames.getSearchContent : null) }],
					details: { responseId: artifact.id, artifact, sourceCount: artifact.sources.length, passageCount: artifact.passages.length },
				};
			});
		},
	});

	if (fetchContentEnabled) pi.registerTool({
		name: toolNames.fetchContent,
		label: "Fetch Content",
		description: `Fetch URL(s) and extract readable content as markdown. Use mode "raw" for exact textual HTTP response bodies or mode "answer" with prompt to answer using only fetched content. Direct image URLs return resized image content. Supports YouTube transcripts, GitHub repositories, PDFs, and local videos. ${fetchContentStorageNote}`,
		promptSnippet:
			"Use to fetch readable or raw URL content, direct images, GitHub repos, and videos. Mode answer answers a prompt using only the fetched source.",
		parameters: Type.Object({
			url: Type.Optional(Type.String({ description: "Single URL to fetch" })),
			urls: Type.Optional(Type.Array(Type.String(), { description: "Multiple URLs (parallel)" })),
			forceClone: Type.Optional(Type.Boolean({
				description: "Force cloning large GitHub repositories that exceed the size threshold",
			})),
			prompt: Type.Optional(Type.String({
				description: "Question or instruction for video analysis, or the page-local question required by mode answer.",
			})),
			mode: Type.Optional(StringEnum(["readable", "raw", "answer"], {
				description: "Fetch mode: readable (default extraction), raw (exact textual HTTP body), or answer (answer prompt using only fetched content).",
			})),
			answerModel: Type.Optional(Type.String({
				description: "Optional provider/model-id override for mode answer. Defaults to fetch.answerProvider + fetch.answerModel when configured, otherwise the current Pi model.",
			})),
			timestamp: Type.Optional(Type.String({
				description: "Extract video frame(s) at a timestamp or time range. Single: '1:23:45', '23:45', or '85' (seconds). Range: '23:41-25:00' extracts evenly-spaced frames across that span (default 6). Use frames with ranges to control density; single+frames uses a fixed 5s interval. YouTube requires yt-dlp + ffmpeg; local videos require ffmpeg. Use a range when you know the approximate area but not the exact moment — you'll get a contact sheet to visually identify the right frame.",
			})),
			frames: Type.Optional(Type.Integer({
				minimum: 1,
				maximum: 12,
				description: "Number of frames to extract. Use with timestamp range for custom density, with single timestamp to get N frames at 5s intervals, or alone to sample across the entire video. Requires yt-dlp + ffmpeg for YouTube, ffmpeg for local video.",
			})),
			model: Type.Optional(Type.String({
				description: "Override the Gemini model for video/YouTube analysis (e.g. 'gemini-3.6-flash'). Defaults to config or gemini-3.6-flash.",
			})),
			auth: Type.Optional(Type.Union([Type.String(), Type.Boolean()], {
				description: "Opt into an authFetch profile for local browser-cookie fetching. Use a profile name, or true only when exactly one profile exists.",
			})),
			proxy: Type.Optional(Type.String({
				description: "http(s) proxy URL (e.g. http://host:port) used for this fetch. Needed when the target is unreachable directly; localhost and NO_PROXY hosts always bypass the proxy. Empty string forces direct access.",
			})),
		}),

		async execute(_toolCallId, params, signal, onUpdate, ctx): Promise<AgentToolResult<Record<string, unknown>>> {
			let normalized: ReturnType<typeof normalizeFetchContentParams>;
			try {
				normalized = normalizeFetchContentParams(params);
			} catch (err) {
				const error = err instanceof Error ? err.message : String(err);
				return { content: [{ type: "text", text: `Error: ${error}` }], details: { error } };
			}
			const { urlList, options } = normalized;
			return runWithProxy(options.proxy, async () => {
				const mode = options.mode ?? "readable";
				if (mode === "answer" && !options.prompt) {
					return { content: [{ type: "text", text: "Error: mode answer requires prompt." }], details: { error: "mode answer requires prompt" } };
				}
				if (mode === "raw" && (options.forceClone === true || options.timestamp || options.frames || options.prompt || options.model || options.answerModel)) {
					return { content: [{ type: "text", text: "Error: mode raw cannot be combined with forceClone, prompt, timestamp, frames, model, or answerModel." }], details: { error: "Incompatible raw mode options" } };
				}
				if (mode !== "answer" && options.answerModel) {
					return { content: [{ type: "text", text: "Error: answerModel requires mode answer." }], details: { error: "answerModel requires mode answer" } };
				}
				if (mode === "answer" && options.model) {
					return { content: [{ type: "text", text: "Error: use answerModel, not model, with mode answer." }], details: { error: "model is incompatible with mode answer" } };
				}
				if (mode === "answer" && options.auth !== undefined) {
					return { content: [{ type: "text", text: "Error: auth cannot be combined with mode answer." }], details: { error: "auth cannot be combined with mode answer" } };
				}
				let authFetchProfile: AuthFetchProfile | undefined;
				if (options.auth !== undefined) {
					try {
						authFetchProfile = resolveAuthFetchProfile(options.auth);
					} catch (err) {
						const error = err instanceof Error ? err.message : String(err);
						return { content: [{ type: "text", text: `Error: ${error}` }], details: { error } };
					}
				}
				if (urlList.length === 0) {
					return {
						content: [{ type: "text", text: "Error: No URL provided." }],
						details: { error: "No URL provided" },
					};
				}

				onUpdate?.({
					content: [{ type: "text", text: `Fetching ${urlList.length} URL(s)...` }],
					details: { phase: "fetch", progress: 0 },
				});

				const { answerModel: _answerModel, auth: _auth, ...extractionOptions } = options;
				const fetchOptions = mode === "answer"
					? (() => {
						const { prompt: _prompt, ...rest } = extractionOptions;
						return { ...rest, ...(authFetchProfile ? { authFetchProfile } : {}) };
					})()
					: { ...extractionOptions, ...(authFetchProfile ? { authFetchProfile } : {}) };
				const fetchResults = await fetchAllContent(urlList, signal, withRegisteredFetchOptions(fetchOptions, registeredToolNames, options.proxy));
				const presentedResults = mode === "answer"
					? await Promise.all(fetchResults.map(async result => {
						if (result.error) return result;
						if (result.thumbnail || result.mimeType?.startsWith("image/")) {
							return { ...result, error: "Page answer requires textual fetched content" };
						}
						try {
							const answer = await answerFromPage({
								question: options.prompt!,
								pageText: result.content,
								sourceUrl: result.url,
								...(options.answerModel ? { model: options.answerModel } : {}),
							}, ctx, signal);
							return { ...result, content: answer.text };
						} catch (err) {
							return { ...result, error: `Page answer failed: ${err instanceof Error ? err.message : String(err)}` };
						}
					}))
					: fetchResults;
				const successful = presentedResults.filter((r) => !r.error).length;
				const totalChars = presentedResults.reduce((sum, r) => sum + r.content.length, 0);

				const responseId = generateId();
				const data = {
					id: responseId,
					type: "fetch",
					timestamp: Date.now(),
					urls: stripThumbnails(fetchResults),
				} satisfies StoredSearchData & { type: "fetch"; urls: ExtractedContent[] };
				const storedContent = storeFetchResult(pi, responseId, data, authFetchProfile);

				if (urlList.length === 1) {
					const result = presentedResults[0];
					if (result.error) {
						return {
							content: [{ type: "text", text: `Error: ${result.error}` }],
							details: { urls: urlList, urlCount: 1, successful: 0, error: result.error, ...(storedContent ? { responseId } : {}), prompt: params.prompt, timestamp: params.timestamp, frames: params.frames },
						};
					}

					const fullLength = result.content.length;
					const slice = initialContentSlice(result.content, getMaxInlineContentChars());
					const truncated = slice.endOffset < fullLength;
					let output = slice.text;

					if (truncated) {
						output += `\n\n---\nShowing ${slice.endOffset} of ${fullLength} chars, ${slice.shownBytes} of ${slice.totalBytes} bytes, and ${slice.shownLines} of ${slice.totalLines} lines. `;
						output += storedContent
							? getSearchContentEnabled
								? `Use ${toolNames.getSearchContent}({ responseId: "${responseId}", urlIndex: 0, offset: ${slice.endOffset} }) for the next slice.`
								: "Content retrieval is not registered."
							: "Authenticated fetch cache is off; repeat the fetch to read more.";
					}

					const content: Array<TextContent | ImageContent> = [];
					if (result.frames?.length) {
						for (const frame of result.frames) {
							content.push({ type: "image", data: frame.data, mimeType: frame.mimeType });
							content.push({ type: "text", text: `Frame at ${frame.timestamp}` });
						}
					} else if (result.thumbnail) {
						content.push({ type: "image", data: result.thumbnail.data, mimeType: result.thumbnail.mimeType });
					}
					content.push({ type: "text", text: output });

					const imageCount = (result.frames?.length ?? 0) + (result.thumbnail ? 1 : 0);
					return {
						content,
						details: {
							urls: urlList,
							urlCount: 1,
							successful: 1,
							totalChars: fullLength,
							title: result.title,
							...(storedContent ? { responseId } : {}),
							truncated,
							hasImage: imageCount > 0,
							imageCount,
							prompt: params.prompt,
							timestamp: params.timestamp,
							frames: params.frames,
							duration: result.duration,
							mode,
							mimeType: result.mimeType,
							status: result.status,
							totalBytes: slice.totalBytes,
							totalLines: slice.totalLines,
							shownBytes: slice.shownBytes,
							shownLines: slice.shownLines,
						},
					};
				}

				let output = "## Fetched URLs\n\n";
				for (const { url, title, content, error } of presentedResults) {
					if (error) {
						output += `- ${url}: Error - ${error}\n`;
					} else {
						output += `- ${title || url} (${content.length} chars)\n`;
					}
				}
				output += storedContent
					? getSearchContentEnabled
						? `\n---\nUse ${toolNames.getSearchContent}({ responseId: "${responseId}", urlIndex: 0 }) to retrieve bounded content slices.`
						: "\n---\nContent retrieval is not registered."
					: "\n---\nAuthenticated fetch cache is off; repeat the fetch to read content.";

				return {
					content: [{ type: "text", text: output }],
					details: { urls: urlList, urlCount: urlList.length, successful, totalChars, ...(storedContent ? { responseId } : {}) },
				};
			});
		},

		renderCall(args, theme) {
			const { urlList, options } = normalizeFetchContentParams(args);
			const { prompt, timestamp, frames, model, mode, answerModel, auth } = options;
			if (urlList.length === 0) {
				return new Text(theme.fg("toolTitle", theme.bold("fetch ")) + theme.fg("error", "(no URL)"), 0, 0);
			}
			const lines: string[] = [];
			if (urlList.length === 1) {
				const display = urlList[0].length > 60 ? urlList[0].slice(0, 57) + "..." : urlList[0];
				lines.push(theme.fg("toolTitle", theme.bold("fetch ")) + theme.fg("accent", display));
			} else {
				lines.push(theme.fg("toolTitle", theme.bold("fetch ")) + theme.fg("accent", `${urlList.length} URLs`));
				for (const u of urlList.slice(0, 5)) {
					const display = u.length > 60 ? u.slice(0, 57) + "..." : u;
					lines.push(theme.fg("muted", "  " + display));
				}
				if (urlList.length > 5) {
					lines.push(theme.fg("muted", `  ... and ${urlList.length - 5} more`));
				}
			}
			if (mode && mode !== "readable") {
				lines.push(theme.fg("dim", "  mode: ") + theme.fg("warning", mode));
			}
			if (timestamp) {
				lines.push(theme.fg("dim", "  timestamp: ") + theme.fg("warning", timestamp));
			}
			if (typeof frames === "number") {
				lines.push(theme.fg("dim", "  frames: ") + theme.fg("warning", String(frames)));
			}
			if (prompt) {
				const display = prompt.length > 250 ? prompt.slice(0, 247) + "..." : prompt;
				lines.push(theme.fg("dim", "  prompt: ") + theme.fg("muted", `"${display}"`));
			}
			if (model) {
				lines.push(theme.fg("dim", "  model: ") + theme.fg("warning", model));
			}
			if (answerModel) {
				lines.push(theme.fg("dim", "  answer model: ") + theme.fg("warning", answerModel));
			}
			if (auth !== undefined) {
				lines.push(theme.fg("dim", "  auth: ") + theme.fg("warning", auth === true ? "true" : auth));
			}
			return new Text(lines.join("\n"), 0, 0);
		},

		renderResult(result, { expanded, isPartial }, theme) {
			const details = result.details as {
				urlCount?: number;
				successful?: number;
				totalChars?: number;
				error?: string;
				title?: string;
				truncated?: boolean;
				responseId?: string;
				phase?: string;
				progress?: number;
				hasImage?: boolean;
				imageCount?: number;
				prompt?: string;
				timestamp?: string;
				frames?: number;
				duration?: number;
			};

			if (isPartial) {
				const progress = details?.progress ?? 0;
				const bar = "\u2588".repeat(Math.floor(progress * 10)) + "\u2591".repeat(10 - Math.floor(progress * 10));
				return new Text(theme.fg("accent", `[${bar}] ${details?.phase || "fetching"}`), 0, 0);
			}

			if (details?.error) {
				const fd = details as typeof details & { urls?: string[] };
				const extras: string[] = [];
				if (typeof fd.urlCount === "number" || typeof fd.successful === "number") {
					extras.push(`urls: ${fd.successful ?? 0}/${fd.urlCount ?? 0} succeeded`);
				}
				if (fd.responseId) extras.push(`response id: ${fd.responseId}`);
				if (fd.urls && fd.urls.length > 0) {
					for (const u of fd.urls.slice(0, 8)) extras.push(`  \u25b8 ${u}`);
					if (fd.urls.length > 8) extras.push(`  ... and ${fd.urls.length - 8} more`);
				}
				const plan = buildSearchErrorPlan({ error: details.error, extraLines: extras });
				if (plan) return renderSearchErrorPlan(plan, expanded, theme);
				return new Text(theme.fg("error", `Error: ${details.error}`), 0, 0);
			}

			if (details?.urlCount === 1) {
				const title = details?.title || "Untitled";
				const imgCount = details?.imageCount ?? (details?.hasImage ? 1 : 0);
				const imageBadge = imgCount > 1
					? theme.fg("accent", ` [${imgCount} images]`)
					: imgCount === 1
						? theme.fg("accent", " [image]")
						: "";
				let statusLine = theme.fg("success", title) + theme.fg("muted", ` (${details?.totalChars ?? 0} chars)`) + imageBadge;
				if (details?.truncated) {
					statusLine += theme.fg("warning", " [truncated]");
				}
				if (typeof details?.duration === "number") {
					statusLine += theme.fg("muted", ` | ${formatSeconds(Math.floor(details.duration))} total`);
				}
				const textContent = result.content.find((c) => c.type === "text")?.text || "";
				if (!expanded) {
					const brief = textContent.length > 200 ? textContent.slice(0, 200) + "..." : textContent;
					return new Text(statusLine + "\n" + theme.fg("dim", brief), 0, 0);
				}
				const lines = [statusLine];
				if (details?.prompt) {
					const display = details.prompt.length > 250 ? details.prompt.slice(0, 247) + "..." : details.prompt;
					lines.push(theme.fg("dim", `  prompt: "${display}"`));
				}
				if (details?.timestamp) {
					lines.push(theme.fg("dim", `  timestamp: ${details.timestamp}`));
				}
				if (typeof details?.frames === "number") {
					lines.push(theme.fg("dim", `  frames: ${details.frames}`));
				}
				const preview = textContent.length > 500 ? textContent.slice(0, 500) + "..." : textContent;
				lines.push(theme.fg("dim", preview));
				return new Text(lines.join("\n"), 0, 0);
			}

			const countColor = (details?.successful ?? 0) > 0 ? "success" : "error";
			const statusLine = theme.fg(countColor, `${details?.successful}/${details?.urlCount} URLs`) + theme.fg("muted", getSearchContentEnabled ? " (content stored)" : " (content fetched)");
			if (!expanded) {
				return new Text(statusLine, 0, 0);
			}
			const textContent = result.content.find((c) => c.type === "text")?.text || "";
			const preview = textContent.length > 500 ? textContent.slice(0, 500) + "..." : textContent;
			return new Text(statusLine + "\n" + theme.fg("dim", preview), 0, 0);
		},
	});

	if (getSearchContentEnabled) {
		const maxInlineContentChars = getMaxInlineContentChars(initConfig);
		pi.registerTool({
		name: toolNames.getSearchContent,
		label: "Get Search Content",
		description: `Retrieve bounded content slices or find matching passages in a previous ${storedContentSources} call.`,
		promptSnippet:
			`Use after ${storedContentSources} to retrieve stored content via responseId. Use findText to locate passages without paging through the full content.`,
		parameters: Type.Object({
			responseId: Type.String({ description: `The responseId from ${storedContentSources}` }),
			query: Type.Optional(Type.String({ description: searchQueryDescription })),
			queryIndex: Type.Optional(Type.Integer({ minimum: 0, description: "Get content for query at index" })),
			url: Type.Optional(Type.String({ description: "Get content for this URL" })),
			urlIndex: Type.Optional(Type.Integer({ minimum: 0, description: "Get content for URL at index" })),
			offset: Type.Optional(Type.Integer({ minimum: 0, description: "Character offset for fetched URL content slices (default 0). Ignored when findText is supplied." })),
			limit: Type.Optional(Type.Integer({ minimum: 1, maximum: maxInlineContentChars, description: "Maximum characters to return for fetched URL content slices (default and max are set by maxInlineContentChars). Ignored when findText is supplied." })),
			findText: Type.Optional(Type.Union([
				Type.String({ minLength: 1, maxLength: 500 }),
				Type.Array(Type.String({ minLength: 1, maxLength: 500 }), { minItems: 1, maxItems: 10 }),
			], { description: "Text or texts to find in the selected stored content. When supplied, offset and limit are ignored." })),
			findMode: Type.Optional(StringEnum(["exact", "case-insensitive", "fuzzy"], { description: "Matching mode for findText (default: case-insensitive). Requires findText." })),
		}),

		async execute(_toolCallId, rawParams): Promise<AgentToolResult<Record<string, unknown>>> {
			const params = normalizeGetSearchContentParams(rawParams);
			if (params.findMode !== undefined && params.findText === undefined) {
				return {
					content: [{ type: "text", text: `findMode ${formatInputValue(params.findMode)} requires findText; provide findText or omit findMode.` }],
					details: { error: "findMode requires findText" },
				};
			}
			const data = getResult(params.responseId);
			if (!data) {
				return {
					content: [{ type: "text", text: `Error: No stored results for responseId ${formatInputValue(params.responseId)}. Use a responseId returned by ${storedContentSources}.` }],
					details: { error: "Not found", responseId: params.responseId },
				};
			}

			if (data.type === "research") {
				const artifact = getResearchArtifact(params.responseId);
				if (!artifact) {
					return {
						content: [{ type: "text", text: `Error: stored research artifact for responseId ${formatInputValue(params.responseId)} was not found. Use a responseId returned by ${storedContentSources}.` }],
						details: { error: "Artifact not found", responseId: params.responseId },
					};
				}
				const serialized = JSON.stringify(artifact, null, 2);
				if (params.findText !== undefined) {
					try {
						const found = findContent(serialized, normalizeFindQueries(params.findText), params.findMode ?? "case-insensitive");
						const { text, ...findDetails } = found;
						return {
							content: [{ type: "text", text }],
							details: { responseId: artifact.id, type: "research", contentLength: serialized.length, findMode: params.findMode ?? "case-insensitive", ...findDetails },
						};
					} catch (err) {
						const error = err instanceof Error ? err.message : String(err);
						return {
							content: [{ type: "text", text: `Unable to find ${formatInputValue(params.findText)} in research artifact for responseId ${formatInputValue(params.responseId)}: ${error}. Check findText and use a supported findMode.` }],
							details: { error, responseId: params.responseId, type: "research" },
						};
					}
				}
				const offset = params.offset ?? 0;
				const limit = params.limit ?? maxInlineContentChars;
				if (!Number.isInteger(offset) || offset < 0) {
					return {
						content: [{ type: "text", text: `Invalid offset: received ${formatInputValue(offset)} for responseId ${formatInputValue(params.responseId)}; offset must be a non-negative integer. Use 0 or a larger integer.` }],
						details: { error: "Invalid offset", offset },
					};
				}
				if (!Number.isInteger(limit) || limit <= 0 || limit > maxInlineContentChars) {
					return {
						content: [{ type: "text", text: `Invalid limit: received ${formatInputValue(limit)} for responseId ${formatInputValue(params.responseId)}; limit must be an integer from 1 to ${maxInlineContentChars}. Use a value in that range.` }],
						details: { error: "Invalid limit", limit, maxLimit: maxInlineContentChars },
					};
				}
				if (offset > serialized.length) {
					return {
						content: [{ type: "text", text: `Offset ${offset} is out of range for responseId ${formatInputValue(params.responseId)}. Received offset ${offset}; valid range is 0-${serialized.length}. Use an offset within that range.` }],
						details: { error: "Offset out of range", offset, contentLength: serialized.length },
					};
				}
				const endOffset = Math.min(offset + limit, serialized.length);
				const artifactSlice = serialized.slice(offset, endOffset);
				const hasMore = endOffset < serialized.length;
				return {
					content: [{ type: "text", text: artifactSlice }],
					details: { responseId: artifact.id, type: "research", contentLength: serialized.length, offset, limit, returnedChars: artifactSlice.length, nextOffset: hasMore ? endOffset : null, truncated: hasMore },
				};
			}

			if (data.type === "search" && data.queries) {
				let queryData: QueryResultData | undefined;

				if (params.query !== undefined) {
					queryData = data.queries.find((q) => q.query === params.query);
					if (!queryData) {
						const available = data.queries.map((q) => `"${q.query}"`).join(", ");
						return {
							content: [{ type: "text", text: `Query ${formatInputValue(params.query)} was not found for responseId ${formatInputValue(params.responseId)}. Received query=${formatInputValue(params.query)}. Available queries: ${available || "none"}. Use one of the available queries or queryIndex.` }],
							details: { error: "Query not found" },
						};
					}
				} else if (params.queryIndex !== undefined) {
					queryData = data.queries[params.queryIndex];
					if (!queryData) {
						const available = data.queries.map((q, i) => `${i}: "${q.query}"`).join(", ");
						return {
							content: [{ type: "text", text: `Query index ${formatInputValue(params.queryIndex)} is out of range for responseId ${formatInputValue(params.responseId)}. Received queryIndex=${formatInputValue(params.queryIndex)}; valid indexes are 0-${data.queries.length - 1}. Available queries: ${available || "none"}. Use one of the available indexes.` }],
							details: { error: "Index out of range" },
						};
					}
				} else {
					const available = data.queries.map((q, i) => `${i}: "${q.query}"`).join(", ");
					return {
						content: [{ type: "text", text: `Specify query or queryIndex for responseId ${formatInputValue(params.responseId)}. Available queries: ${available || "none"}.` }],
						details: { error: "No query specified" },
					};
				}

				if (queryData.error) {
					return {
						content: [{ type: "text", text: `Error retrieving query ${formatInputValue(queryData.query)} from responseId ${formatInputValue(params.responseId)}: ${queryData.error}. Check the stored search result and retry with another query or queryIndex if needed.` }],
						details: { error: queryData.error, query: queryData.query },
					};
				}

				const fullResults = formatFullResults(queryData);
				if (params.findText !== undefined) {
					try {
						const found = findContent(fullResults, normalizeFindQueries(params.findText), params.findMode ?? "case-insensitive");
						const { text, ...findDetails } = found;
						return {
							content: [{ type: "text", text }],
							details: { query: queryData.query, resultCount: queryData.results.length, findMode: params.findMode ?? "case-insensitive", ...findDetails },
						};
					} catch (err) {
						const error = err instanceof Error ? err.message : String(err);
						return {
							content: [{ type: "text", text: `Unable to find ${formatInputValue(params.findText)} in query ${formatInputValue(queryData.query)} for responseId ${formatInputValue(params.responseId)}: ${error}. Check findText and use a supported findMode.` }],
							details: { error, query: queryData.query },
						};
					}
				}

				return {
					content: [{ type: "text", text: fullResults }],
					details: { query: queryData.query, resultCount: queryData.results.length },
				};
			}

			if (data.type === "fetch" && data.urls) {
				let urlData: ExtractedContent | undefined;
				let selectedUrlIndex = -1;

				if (params.url !== undefined) {
					selectedUrlIndex = data.urls.findIndex((u) => u.url === params.url);
					urlData = data.urls[selectedUrlIndex];
					if (!urlData) {
						const available = data.urls.map((u) => u.url).join("\n  ");
						return {
							content: [{ type: "text", text: `URL ${formatInputValue(params.url)} was not found for responseId ${formatInputValue(params.responseId)}. Received url=${formatInputValue(params.url)}. Available URLs:\n  ${available || "  none"}\nUse one of the available URLs or urlIndex.` }],
							details: { error: "URL not found" },
						};
					}
				} else if (params.urlIndex !== undefined) {
					selectedUrlIndex = params.urlIndex;
					urlData = data.urls[selectedUrlIndex];
					if (!urlData) {
						const available = data.urls.map((u, i) => `${i}: ${u.url}`).join("\n  ");
						return {
							content: [{ type: "text", text: `URL index ${formatInputValue(params.urlIndex)} is out of range for responseId ${formatInputValue(params.responseId)}. Received urlIndex=${formatInputValue(params.urlIndex)}; valid indexes are 0-${data.urls.length - 1}. Available URLs:\n  ${available || "  none"}\nUse one of the available indexes.` }],
							details: { error: "Index out of range" },
						};
					}
				} else {
					const available = data.urls.map((u, i) => `${i}: ${u.url}`).join("\n  ");
					return {
						content: [{ type: "text", text: `Specify url or urlIndex for responseId ${formatInputValue(params.responseId)}. Available URLs:\n  ${available || "  none"}` }],
						details: { error: "No URL specified" },
					};
				}

				if (urlData.error) {
					return {
						content: [{ type: "text", text: `Error retrieving URL ${formatInputValue(urlData.url)} from responseId ${formatInputValue(params.responseId)}: ${urlData.error}. Check the stored fetch result and retry with another URL or urlIndex if needed.` }],
						details: { error: urlData.error, url: urlData.url },
					};
				}

				if (params.findText !== undefined) {
					try {
						const found = findContent(urlData.content, normalizeFindQueries(params.findText), params.findMode ?? "case-insensitive");
						const { text, ...findDetails } = found;
						return {
							content: [{ type: "text", text: `# ${urlData.title || urlData.url}\n\n${text}` }],
							details: { url: urlData.url, title: urlData.title, contentLength: urlData.content.length, findMode: params.findMode ?? "case-insensitive", ...findDetails },
						};
					} catch (err) {
						const error = err instanceof Error ? err.message : String(err);
						return {
							content: [{ type: "text", text: `Unable to find ${formatInputValue(params.findText)} in URL ${formatInputValue(urlData.url)} for responseId ${formatInputValue(params.responseId)}: ${error}. Check findText and use a supported findMode.` }],
							details: { error, url: urlData.url },
						};
					}
				}

				const offset = params.offset ?? 0;
				const limit = params.limit ?? maxInlineContentChars;
				if (!Number.isInteger(offset) || offset < 0) {
					return {
						content: [{ type: "text", text: `Invalid offset: received ${formatInputValue(offset)} for URL ${formatInputValue(urlData.url)}; offset must be a non-negative integer. Use 0 or a larger integer.` }],
						details: { error: "Invalid offset", offset },
					};
				}
				if (!Number.isInteger(limit) || limit <= 0 || limit > maxInlineContentChars) {
					return {
						content: [{ type: "text", text: `Invalid limit: received ${formatInputValue(limit)} for URL ${formatInputValue(urlData.url)}; limit must be an integer from 1 to ${maxInlineContentChars}. Use a value in that range.` }],
						details: { error: "Invalid limit", limit, maxLimit: maxInlineContentChars },
					};
				}
				if (offset > urlData.content.length) {
					return {
						content: [{ type: "text", text: `Offset ${offset} is out of range for URL ${formatInputValue(urlData.url)} in responseId ${formatInputValue(params.responseId)}. Received offset ${offset}; valid range is 0-${urlData.content.length}. Use an offset within that range.` }],
						details: { error: "Offset out of range", offset, contentLength: urlData.content.length },
					};
				}

				const endOffset = Math.min(offset + limit, urlData.content.length);
				const contentSlice = urlData.content.slice(offset, endOffset);
				const hasMore = endOffset < urlData.content.length;
				let text = `# ${urlData.title || urlData.url}\n\n${contentSlice}`;
				if (hasMore || offset > 0) {
					text += `\n\n---\nShowing chars ${offset}-${endOffset} of ${urlData.content.length}.`;
					if (hasMore) {
						text += ` Use ${toolNames.getSearchContent}({ responseId: "${params.responseId}", urlIndex: ${selectedUrlIndex}, offset: ${endOffset}, limit: ${limit} }) for the next slice.`;
					}
				}

				return {
					content: [{ type: "text", text }],
					details: {
						url: urlData.url,
						title: urlData.title,
						contentLength: urlData.content.length,
						offset,
						limit,
						returnedChars: contentSlice.length,
						nextOffset: hasMore ? endOffset : null,
						truncated: hasMore,
					},
				};
			}

			return {
				content: [{ type: "text", text: `Invalid stored data for responseId ${formatInputValue(params.responseId)}: received type ${formatInputValue(data.type)}. Use a responseId returned by ${storedContentSources}.` }],
				details: { error: "Invalid data" },
			};
		},

		renderCall(args, theme) {
			const { responseId, query, queryIndex, url, urlIndex, offset, findText } = args as {
				responseId: string;
				query?: string;
				queryIndex?: number;
				url?: string;
				urlIndex?: number;
				offset?: number;
				findText?: string | string[];
			};
			let target = "";
			if (query) target = `query="${query}"`;
			else if (queryIndex !== undefined) target = `queryIndex=${queryIndex}`;
			else if (url) target = url.length > 30 ? url.slice(0, 27) + "..." : url;
			else if (urlIndex !== undefined) target = `urlIndex=${urlIndex}`;
			if (offset !== undefined) target += target ? ` @ ${offset}` : `offset=${offset}`;
			if (findText !== undefined) {
				const queries = Array.isArray(findText) ? findText : [findText];
				target += `${target ? " · " : ""}find ${queries.length}`;
			}
			return new Text(theme.fg("toolTitle", theme.bold("get_content ")) + theme.fg("accent", target || responseId.slice(0, 8)), 0, 0);
		},

		renderResult(result, { expanded }, theme) {
			const details = result.details as {
				error?: string;
				query?: string;
				url?: string;
				title?: string;
				resultCount?: number;
				contentLength?: number;
				offset?: number;
				returnedChars?: number;
				nextOffset?: number | null;
				matchCount?: number;
				returnedMatches?: number;
			};

			if (details?.error) {
				const extras: string[] = [];
				if (details.query) extras.push(`query: ${details.query}`);
				if (details.url) extras.push(`url: ${details.url}`);
				else if (details.title) extras.push(`resource: ${details.title}`);
				const plan = buildSearchErrorPlan({ error: details.error, extraLines: extras });
				if (plan) return renderSearchErrorPlan(plan, expanded, theme);
				return new Text(theme.fg("error", `Error: ${details.error}`), 0, 0);
			}

			let statusLine: string;
			if (typeof details?.matchCount === "number") {
				statusLine = theme.fg("success", details?.title || details?.query || "Content") + theme.fg("muted", ` (${details.matchCount} matches, ${details.returnedMatches ?? 0} shown)`);
			} else if (details?.query) {
				statusLine = theme.fg("success", `"${details.query}"`) + theme.fg("muted", ` (${details.resultCount} results)`);
			} else {
				const start = details?.offset ?? 0;
				const returned = details?.returnedChars ?? details?.contentLength ?? 0;
				const end = start + returned;
				const slice = details?.nextOffset !== undefined || start > 0
					? `, showing ${start}-${end}`
					: "";
				statusLine = theme.fg("success", details?.title || "Content") + theme.fg("muted", ` (${details?.contentLength ?? 0} chars${slice})`);
			}

			if (!expanded) {
				return new Text(statusLine, 0, 0);
			}

			const textContent = result.content.find((c) => c.type === "text")?.text || "";
			const preview = textContent.length > 500 ? textContent.slice(0, 500) + "..." : textContent;
			return new Text(statusLine + "\n" + theme.fg("dim", preview), 0, 0);
		},
	});
	}

	if (isCommandEnabled(initConfig, "websearch")) pi.registerCommand("websearch", {
		description: "Open web search curator",
		handler: async (args, ctx) => {
			const sessionToken = randomUUID();
			const commandCallId = `cmd:${sessionToken}`;
			closeCurator(commandCallId);

			const raw = args.trim();
			const queries = raw.length > 0
				? normalizeQueryList(raw.split(","))
				: [];

			let bootstrap: CuratorBootstrap;
			try {
				bootstrap = await loadCuratorBootstrap(undefined, ctx);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				ctx.ui.notify(`Failed to load web search config: ${message}`, "error");
				return;
			}
			const availableProviders = bootstrap.availableProviders;
			const initialProvider = bootstrap.defaultProvider;
			const curatorTimeoutSeconds = bootstrap.timeoutSeconds;
			let currentProvider: CuratorProvider = initialProvider;
			const commandConfig = loadConfig();
			const rawSearchProvider = normalizeProviderInput(
				commandConfig.searchProvider ?? commandConfig.provider ?? "auto",
				`provider in ${WEB_SEARCH_CONFIG_PATH}`,
			) ?? "auto";
			let currentSearchProvider: SearchProviderSelection = Array.isArray(rawSearchProvider)
				? rawSearchProvider
				: rawSearchProvider === "auto" ? "auto" : initialProvider;
			const summaryContext: SummaryGenerationContext = {
				model: ctx.model,
				modelRegistry: ctx.modelRegistry,
				cwd: ctx.cwd,
				isProjectTrusted: () => ctx.isProjectTrusted(),
			};
			const summaryModelChoices = await loadSummaryModelChoices(summaryContext);

			ctx.ui.notify("Opening web search curator...", "info");

			const collected = new Map<number, QueryResultData>();
			const searchAbort = new AbortController();
			let aborted = false;
			let commandHandle: CuratorServerHandle | null = null;
			const isCommandActive = () => commandHandle !== null && activeCurators.get(commandCallId) === commandHandle;

			function sendFollowUpFromReturn(payload: ReturnType<typeof buildSearchReturn>) {
				pi.sendMessage({
					customType: "web-search-results",
					content: payload.content,
					display: true,
					details: payload.details,
				}, { triggerTurn: true, deliverAs: "followUp" });
			}

			try {
				const handle = await startCuratorServer(
					{
						queries,
						initialResultIndexCapacity: curatorResultIndexCapacity(queries.length),
						sessionToken,
						timeout: curatorTimeoutSeconds,
						availableProviders,
						defaultProvider: initialProvider,
						searchProvider: toCuratorProvider(currentSearchProvider) ?? "auto",
						summaryModels: summaryModelChoices.summaryModels,
						defaultSummaryModel: summaryModelChoices.defaultSummaryModel,
					},
					{
						async onSummarize(selectedQueryIndices, summarizeSignal, model, feedback) {
							if (commandHandle && !isCommandActive()) {
								throw new Error("Curator session is no longer active.");
							}
							return generateSummaryForSelectedIndices(
								selectedQueryIndices,
								collected,
								summaryContext,
								summarizeSignal,
								model,
								feedback,
							);
						},
						onSubmit(payload) {
							if (commandHandle && !isCommandActive()) return;
							aborted = true;
							searchAbort.abort();
							const filtered = payload.selectedQueryIndices.length > 0
								? filterByQueryIndices(payload.selectedQueryIndices, collected)
								: collectAllResultsAndUrls(collected);
							const base: SearchReturnOptions = {
								queryList: filtered.results.map(r => r.query),
								results: filtered.results,
								urls: filtered.urls,
								includeContent: false,
								curated: true,
								curatedFrom: collected.size,
							};
							if (!payload.rawResults) {
								const resolvedSummary = resolveSummaryForSubmit(payload, collected);
								base.workflow = "summary-review";
								base.approvedSummary = resolvedSummary.approvedSummary;
								base.summaryMeta = resolvedSummary.summaryMeta;
							}
							sendFollowUpFromReturn(buildSearchReturn(base));
							closeCurator(commandCallId);
						},
						onCancel(reason) {
							if (commandHandle && !isCommandActive()) return;
							aborted = true;
							searchAbort.abort();
							if (reason === "timeout") {
								const all = collectAllResultsAndUrls(collected);
								const resolvedSummary = resolveSummaryForSubmit({ selectedQueryIndices: [], summary: undefined, summaryMeta: undefined }, collected);
								sendFollowUpFromReturn(buildSearchReturn({
									queryList: all.results.map(r => r.query),
									results: all.results,
									urls: all.urls,
									includeContent: false,
									curated: true,
									curatedFrom: collected.size,
									workflow: "summary-review",
									approvedSummary: resolvedSummary.approvedSummary,
									summaryMeta: resolvedSummary.summaryMeta,
								}));
							}
							closeCurator(commandCallId);
						},
						onProviderChange(provider) {
							if (commandHandle && !isCommandActive()) return;
							const normalized = normalizeProviderInput(provider);
							if (!normalized || normalized === "auto" || Array.isArray(normalized)) return;
							currentProvider = normalized;
							currentSearchProvider = normalized;
							try {
								saveConfig({ provider: normalized });
							} catch (err) {
								const message = err instanceof Error ? err.message : String(err);
								console.error(`Failed to persist default provider: ${message}`);
							}
						},
						async onAddSearch(query, provider) {
							return runWithProxy(undefined, async () => {
								if (commandHandle && !isCommandActive()) {
									throw new Error("Curator session is no longer active.");
								}
								const requestedProvider = resolveCuratorSearchProvider(provider, currentSearchProvider);
								const response = await search(query, {
									provider: requestedProvider,
									signal: searchAbort.signal,
									extensionContext: ctx,
								});
								if (commandHandle && !isCommandActive()) {
									throw new Error("Curator session is no longer active.");
								}
								return toCuratorSearchEntries(response);
							});
						},
						onAddSearchResults(entries) {
							if (commandHandle && !isCommandActive()) return;
							for (const entry of entries) {
								collected.set(entry.queryIndex, indexedCuratorEntryToQueryResult(entry));
							}
						},
						async onRewriteQuery(query, rewriteSignal) {
							if (commandHandle && !isCommandActive()) {
								throw new Error("Curator session is no longer active.");
							}
							return rewriteSearchQuery(query, summaryContext, rewriteSignal);
						},
					},
				);

				commandHandle = handle;
				activeCurators.set(commandCallId, handle);
				let browserOpenError: string | null = null;
				if (!shouldAutoOpenCuratorBrowser(loadConfig())) {
					ctx.ui.notify(`Search curator is running. Open manually: ${handle.url}`, "info");
				} else {
					const open = platform() === "darwin" ? await getGlimpseOpen() : null;
					if (open) {
						try {
							const win = openInGlimpse(open, handle.url, "Search Curator");
							glimpseWins.set(commandCallId, win);
							win.on("closed", () => {
								if (glimpseWins.get(commandCallId) === win) {
									glimpseWins.delete(commandCallId);
									closeCurator(commandCallId);
								}
							});
						} catch (err) {
							const message = err instanceof Error ? err.message : String(err);
							console.error(`Failed to open Glimpse curator window: ${message}`);
							glimpseWins.delete(commandCallId);
							try {
								await openInBrowser(pi, handle.url);
							} catch (browserErr) {
								browserOpenError = browserErr instanceof Error ? browserErr.message : String(browserErr);
							}
						}
					} else {
						try {
							await openInBrowser(pi, handle.url);
						} catch (browserErr) {
							browserOpenError = browserErr instanceof Error ? browserErr.message : String(browserErr);
						}
					}
					if (browserOpenError) {
						console.error(`Failed to open curator UI: ${browserOpenError}`);
						ctx.ui.notify(`Search curator is running, but the browser did not open automatically. Open manually: ${handle.url}`, "info");
					}
				}

				if (queries.length > 0) {
					(async () => {
						await runSearchQueries(queries, async (query, qi) => {
							if (aborted || !isCommandActive()) return;
							const requestedProvider = currentSearchProvider;
							try {
								const response = await runWithProxy(undefined, () => search(query, {
									provider: requestedProvider,
									signal: searchAbort.signal,
									extensionContext: ctx,
								}));
								if (aborted || !isCommandActive()) return;
								const entries = toCuratorSearchEntries(response);
								for (let entryIndex = 0; entryIndex < entries.length; entryIndex++) {
									const entry = entries[entryIndex];
									const resultIndex = curatorResultIndex(qi, entryIndex, queries.length);
									const indexedEntry: IndexedCuratorSearchEntry = {
										...entry,
										queryIndex: resultIndex,
										query,
									};
									collected.set(resultIndex, indexedCuratorEntryToQueryResult(indexedEntry));
									if (entry.error) {
										handle.pushError(resultIndex, entry.error, entry.provider, { query, slotIndex: qi });
									} else {
										handle.pushResult(resultIndex, { ...entry, query, slotIndex: qi });
									}
								}
							} catch (err) {
								if (aborted || !isCommandActive()) return;
								const message = err instanceof Error ? err.message : String(err);
								const failedProvider = toCuratorProvider(requestedProvider);
								handle.pushError(qi, message, failedProvider, { query, slotIndex: qi });
								collected.set(qi, { query, answer: "", results: [], error: message, provider: failedProvider });
							}
						});
						if (!aborted && isCommandActive()) handle.searchesDone();
					})();
				} else {
					if (isCommandActive()) handle.searchesDone();
				}
			} catch (err) {
				closeCurator(commandCallId);
				const message = err instanceof Error ? err.message : String(err);
				ctx.ui.notify(`Failed to open curator: ${message}`, "error");
			}
		},
	});

	if (isCommandEnabled(initConfig, "curator")) pi.registerCommand("curator", {
		description: "Toggle or configure the search curator workflow",
		handler: async (args, ctx) => {
			const arg = args.trim().toLowerCase();

			let newWorkflow: WebSearchWorkflow;
			if (arg.length === 0) {
				const current = resolveWorkflow(loadConfigForExtensionInit().workflow, true);
				newWorkflow = current === "none" ? "summary-review" : "none";
			} else if (arg === "on") {
				newWorkflow = "summary-review";
			} else if (arg === "off") {
				newWorkflow = "none";
			} else if (arg === "none" || arg === "summary-review" || arg === "auto-summary") {
				newWorkflow = arg;
			} else {
				ctx.ui.notify(`Unknown option: ${arg}. Use on, off, summary-review, or auto-summary.`, "error");
				return;
			}

			try {
				saveConfig({ workflow: newWorkflow });
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				ctx.ui.notify(`Failed to save config: ${message}`, "error");
				return;
			}

			const label = newWorkflow === "none"
				? `Curator disabled — ${toolNames.webSearch} will return raw results`
				: newWorkflow === "auto-summary"
					? `Auto-summary enabled — ${toolNames.webSearch} will generate a summary without opening the curator`
					: `Curator enabled — ${toolNames.webSearch} will open curator and auto-generate a summary draft`;
			pi.sendMessage({
				customType: "curator-config",
				content: [{ type: "text", text: label }],
				display: true,
				details: { workflow: newWorkflow },
			}, { triggerTurn: false, deliverAs: "followUp" });
		},
	});

	if (isCommandEnabled(initConfig, "google-account")) pi.registerCommand("google-account", {
		description: "Show the active Google account for Gemini Web",
		handler: async () => {
			if (!isBrowserCookieAccessAllowed()) {
				pi.sendMessage({
					customType: "google-account",
					content: [{ type: "text", text: `Gemini Web browser cookie access is disabled. Set allowBrowserCookies: true in ${WEB_SEARCH_CONFIG_PATH} to enable it.` }],
					display: true,
					details: { available: false, cookieAccessAllowed: false },
				}, { triggerTurn: true, deliverAs: "followUp" });
				return;
			}

			const cookies = await isGeminiWebAvailable();
			if (!cookies) {
				const diagnostic = getGeminiWebAvailabilityDiagnostic();
				const diagnosticDetails = getGeminiWebAvailabilityDiagnosticDetails();
				const attempted = formatCookieAttempts(diagnosticDetails?.attempts ?? []);
				const text = diagnostic
					? `Gemini Web is unavailable: ${diagnostic}${attempted ? ` Attempted browser profiles: ${attempted}.` : ""}`
					: "Gemini Web is unavailable. Sign into gemini.google.com in a supported Chromium-based browser.";
				pi.sendMessage({
					customType: "google-account",
					content: [{ type: "text", text }],
					display: true,
					details: { available: false, cookieAccessAllowed: true, diagnostic, cookieDiagnostic: diagnosticDetails },
				}, { triggerTurn: true, deliverAs: "followUp" });
				return;
			}

			const email = await getActiveGoogleEmail(cookies);
			const text = email
				? `Active Google account: ${email}`
				: "Gemini Web is available, but the active Google account could not be determined.";

			pi.sendMessage({
				customType: "google-account",
				content: [{ type: "text", text }],
				display: true,
				details: { available: true, email: email ?? null },
			}, { triggerTurn: true, deliverAs: "followUp" });
		},
	});

	function formatCookieAttempts(attempts: { browser: string; profile: string; status: string }[]): string {
		return attempts.map(({ browser, profile, status }) => `${browser}/${profile} (${status})`).join(", ");
	}

	if (isCommandEnabled(initConfig, "search")) pi.registerCommand("search", {
		description: "Browse stored web search results",
		handler: async (_args, ctx) => {
			const results = getAllResults();

			if (results.length === 0) {
				ctx.ui.notify("No stored search results", "info");
				return;
			}

			const options = results.map((r) => {
				const age = Math.floor((Date.now() - r.timestamp) / 60000);
				const ageStr = age < 60 ? `${age}m ago` : `${Math.floor(age / 60)}h ago`;
				if (r.type === "search" && r.queries) {
					const query = r.queries[0]?.query || "unknown";
					return `[${r.id.slice(0, 6)}] "${query}" (${r.queries.length} queries) - ${ageStr}`;
				}
				if (r.type === "fetch" && (r.urls || r.urlMetadata)) {
					return `[${r.id.slice(0, 6)}] ${(r.urls ?? r.urlMetadata ?? []).length} URLs fetched - ${ageStr}`;
				}
				return `[${r.id.slice(0, 6)}] ${r.type} - ${ageStr}`;
			});

			const choice = await ctx.ui.select("Stored Search Results", options);
			if (!choice) return;

			const match = choice.match(/^\[([a-z0-9]+)\]/);
			if (!match) return;

			const selected = results.find((r) => r.id.startsWith(match[1]));
			if (!selected) return;

			const actions = ["View details", "Delete"];
			const action = await ctx.ui.select(`Result ${selected.id.slice(0, 6)}`, actions);

			if (action === "Delete") {
				deleteResult(selected.id);
				ctx.ui.notify(`Deleted ${selected.id.slice(0, 6)}`, "info");
			} else if (action === "View details") {
				let info = `ID: ${selected.id}\nType: ${selected.type}\nAge: ${Math.floor((Date.now() - selected.timestamp) / 60000)}m\n\n`;
				if (selected.type === "search" && selected.queries) {
					info += "Queries:\n";
					const queries = selected.queries.slice(0, 10);
					for (const q of queries) {
						info += `- "${q.query}" (${q.results.length} results)\n`;
					}
					if (selected.queries.length > 10) {
						info += `... and ${selected.queries.length - 10} more\n`;
					}
				}
				if (selected.type === "fetch" && (selected.urls || selected.urlMetadata)) {
					info += "URLs:\n";
					const urlItems = selected.urls ?? selected.urlMetadata ?? [];
					const urls = urlItems.slice(0, 10);
					for (const u of urls) {
						const urlDisplay = u.url.length > 50 ? u.url.slice(0, 47) + "..." : u.url;
						const contentLength = "content" in u ? u.content.length : u.contentLength;
						info += `- ${urlDisplay} (${u.error || `${contentLength} chars`})\n`;
					}
					if (urlItems.length > 10) {
						info += `... and ${urlItems.length - 10} more\n`;
					}
				}
				ctx.ui.notify(info, "info");
			}
		},
	});
}
