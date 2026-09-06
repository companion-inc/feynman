import { existsSync, readFileSync } from "node:fs";
import { activityMonitor } from "./activity.ts";
import { hasCredentialSource, redactCredential, resolveCredential } from "./credential-source.ts";
import type { ExtractedContent, ExtractOptions } from "./extract.ts";
import type { SearchOptions, SearchResponse } from "./perplexity.ts";
import { getWebSearchConfigPath } from "./utils.ts";

const SEARCH1API_SEARCH_URL = "https://api.search1api.com/search";
const SEARCH1API_CRAWL_URL = "https://api.search1api.com/crawl";
const CONFIG_PATH = getWebSearchConfigPath();
const SEARCH_TIMEOUT_MS = 60_000;
const CRAWL_TIMEOUT_MS = 60_000;

interface WebSearchConfig {
	search1apiApiKey?: unknown;
}

interface Search1APISearchResult {
	title?: string | null;
	link?: string | null;
	snippet?: string | null;
	content?: string | null;
}

interface Search1APISearchResponse {
	searchParameters?: Record<string, unknown>;
	results?: Search1APISearchResult[];
}

interface Search1APICrawlResult {
	title?: string | null;
	link?: string | null;
	content?: string | null;
	metadata?: Record<string, unknown>;
}

interface Search1APICrawlResponse {
	crawlParameters?: { url?: string };
	results?: Search1APICrawlResult;
}

interface Search1APISearchOptions extends SearchOptions {
	includeContent?: boolean;
}

let cachedConfig: WebSearchConfig | null = null;

function loadConfig(): WebSearchConfig {
	if (cachedConfig) return cachedConfig;
	if (!existsSync(CONFIG_PATH)) {
		cachedConfig = {};
		return cachedConfig;
	}

	const raw = readFileSync(CONFIG_PATH, "utf-8");
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		throw new Error(`Failed to parse ${CONFIG_PATH}: ${message}`);
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error(`Invalid config in ${CONFIG_PATH}: expected a JSON object`);
	}
	cachedConfig = parsed as WebSearchConfig;
	return cachedConfig;
}

async function getApiKey(signal?: AbortSignal): Promise<string> {
	const key = await resolveCredential({
		provider: "Search1API",
		configuredValue: loadConfig().search1apiApiKey,
		environmentValue: process.env.SEARCH1API_KEY,
		signal,
	});
	if (!key) {
		throw new Error(
			"Search1API key not found. Either:\n" +
			`  1. Create ${CONFIG_PATH} with { "search1apiApiKey": "your-key" }\n` +
			"  2. Set SEARCH1API_KEY environment variable\n" +
			"Create a key at https://dashboard.search1api.com",
		);
	}
	return key;
}

export function isSearch1APIAvailable(): boolean {
	return hasCredentialSource({
		provider: "Search1API",
		configuredValue: loadConfig().search1apiApiKey,
		environmentValue: process.env.SEARCH1API_KEY,
	});
}

function errorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

function requestSignal(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
	const timeout = AbortSignal.timeout(timeoutMs);
	return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function normalizeNumResults(value: number | undefined): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return 5;
	return Math.max(1, Math.min(Math.floor(value), 20));
}

function normalizeDomain(value: string): string | null {
	let input = value.trim().toLowerCase();
	if (!input) return null;
	if (input.startsWith("-")) input = input.slice(1).trim();
	if (!input) return null;
	try {
		const parsed = input.includes("://") ? new URL(input) : new URL(`https://${input}`);
		input = parsed.hostname;
	} catch {
		input = input.split("/")[0]?.split(":")[0] ?? "";
	}
	input = input.replace(/^\.+|\.+$/g, "");
	return /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i.test(input) ? input : null;
}

function mapDomainFilter(domainFilter: string[] | undefined): { includeSites: string[]; excludeSites: string[] } {
	const includeSites: string[] = [];
	const excludeSites: string[] = [];
	for (const raw of domainFilter ?? []) {
		const domain = normalizeDomain(raw);
		if (!domain) continue;
		const target = raw.trim().startsWith("-") ? excludeSites : includeSites;
		if (!target.includes(domain)) target.push(domain);
	}
	return { includeSites, excludeSites };
}

function buildSearchBody(query: string, options: Search1APISearchOptions): Record<string, unknown> {
	const numResults = normalizeNumResults(options.numResults);
	const { includeSites, excludeSites } = mapDomainFilter(options.domainFilter);
	return {
		query,
		max_results: numResults,
		crawl_results: options.includeContent ? numResults : 0,
		...(includeSites.length > 0 ? { include_sites: includeSites } : {}),
		...(excludeSites.length > 0 ? { exclude_sites: excludeSites } : {}),
		...(options.recencyFilter ? { time_range: options.recencyFilter } : {}),
	};
}

async function search1APIJsonRequest<T>(
	label: "Search" | "Crawl",
	url: string,
	apiKey: string,
	body: Record<string, unknown>,
	timeoutMs: number,
	signal?: AbortSignal,
): Promise<T> {
	let response: Response;
	try {
		response = await fetch(url, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(body),
			signal: requestSignal(signal, timeoutMs),
		});
	} catch (err) {
		const message = errorMessage(err);
		const redactedMessage = redactCredential(message, apiKey);
		if (redactedMessage === message) throw err;
		const redactedError = new Error(redactedMessage);
		if (err instanceof Error) redactedError.name = err.name;
		throw redactedError;
	}

	const raw = await response.text();
	if (!response.ok) {
		throw new Error(`Search1API ${label} API error ${response.status}: ${redactCredential(raw, apiKey).slice(0, 300)}`);
	}
	try {
		return JSON.parse(raw) as T;
	} catch (err) {
		throw new Error(`Search1API ${label} API returned invalid JSON: ${errorMessage(err)}`);
	}
}

function mapSearchResults(results: Search1APISearchResult[] | undefined): SearchResponse["results"] {
	if (!Array.isArray(results)) {
		throw new Error("Search1API Search API returned an unexpected response shape");
	}
	return results.flatMap((item) => {
		if (!item || typeof item.link !== "string" || item.link.trim().length === 0) return [];
		const url = item.link.trim();
		return [{
			title: typeof item.title === "string" && item.title.trim() ? item.title.trim() : url,
			url,
			snippet: typeof item.snippet === "string" ? item.snippet.replace(/\s+/g, " ").trim() : "",
		}];
	});
}

function mapInlineContent(results: Search1APISearchResult[] | undefined): ExtractedContent[] {
	if (!Array.isArray(results)) return [];
	return results.flatMap((item) => {
		if (!item || typeof item.link !== "string" || item.link.trim().length === 0) return [];
		if (typeof item.content !== "string" || item.content.trim().length === 0) return [];
		return [{
			url: item.link.trim(),
			title: typeof item.title === "string" ? item.title.trim() : "",
			content: item.content,
			error: null,
		}];
	});
}

function buildAnswer(results: SearchResponse["results"]): string {
	return results.map((result) => {
		if (result.snippet) return `${result.snippet}\nSource: ${result.title} (${result.url})`;
		return `Source: ${result.title} (${result.url})`;
	}).join("\n\n");
}

export async function searchWithSearch1API(
	query: string,
	options: Search1APISearchOptions = {},
): Promise<SearchResponse> {
	const apiKey = await getApiKey(options.signal);
	const activityId = activityMonitor.logStart({ type: "api", query });
	try {
		const data = await search1APIJsonRequest<Search1APISearchResponse>(
			"Search",
			SEARCH1API_SEARCH_URL,
			apiKey,
			buildSearchBody(query, options),
			SEARCH_TIMEOUT_MS,
			options.signal,
		);
		const results = mapSearchResults(data.results);
		const response: SearchResponse = { answer: buildAnswer(results), results };
		if (options.includeContent) {
			const inlineContent = mapInlineContent(data.results);
			if (inlineContent.length > 0) response.inlineContent = inlineContent;
		}
		activityMonitor.logComplete(activityId, 200);
		return response;
	} catch (err) {
		const message = errorMessage(err);
		const redactedMessage = redactCredential(message, apiKey);
		if (redactedMessage.toLowerCase().includes("abort")) activityMonitor.logComplete(activityId, 0);
		else activityMonitor.logError(activityId, redactedMessage);
		if (redactedMessage === message) throw err;
		const redactedError = new Error(redactedMessage);
		if (err instanceof Error) redactedError.name = err.name;
		throw redactedError;
	}
}

export async function extractWithSearch1API(
	url: string,
	signal?: AbortSignal,
	options: ExtractOptions = {},
): Promise<ExtractedContent | null> {
	const apiKey = await getApiKey(signal);
	const activityId = activityMonitor.logStart({ type: "fetch", url });
	try {
		const data = await search1APIJsonRequest<Search1APICrawlResponse>(
			"Crawl",
			SEARCH1API_CRAWL_URL,
			apiKey,
			{ url },
			typeof options.timeoutMs === "number" && Number.isFinite(options.timeoutMs)
				? Math.max(1, Math.floor(options.timeoutMs))
				: CRAWL_TIMEOUT_MS,
			signal,
		);
		const result = data.results;
		if (!result || typeof result !== "object") {
			throw new Error("Search1API Crawl API returned an unexpected response shape");
		}
		const content = typeof result.content === "string" ? result.content.trim() : "";
		if (!content) {
			activityMonitor.logComplete(activityId, 200);
			return null;
		}
		activityMonitor.logComplete(activityId, 200);
		return {
			url,
			title: typeof result.title === "string" ? result.title.trim() : "",
			content,
			error: null,
		};
	} catch (err) {
		const message = errorMessage(err);
		const redactedMessage = redactCredential(message, apiKey);
		if (redactedMessage.toLowerCase().includes("abort")) activityMonitor.logComplete(activityId, 0);
		else activityMonitor.logError(activityId, redactedMessage);
		if (redactedMessage === message) throw err;
		const redactedError = new Error(redactedMessage);
		if (err instanceof Error) redactedError.name = err.name;
		throw redactedError;
	}
}
