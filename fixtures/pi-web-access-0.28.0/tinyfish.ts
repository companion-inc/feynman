import { existsSync, readFileSync } from "node:fs";
import { activityMonitor } from "./activity.ts";
import type { ExtractedContent, ExtractOptions } from "./extract.ts";
import type { SearchOptions, SearchResponse } from "./perplexity.ts";
import { hasCredentialSource, redactCredential, resolveCredential } from "./credential-source.ts";
import { getWebSearchConfigPath } from "./utils.ts";

const TINYFISH_SEARCH_URL = "https://api.search.tinyfish.ai";
const TINYFISH_FETCH_URL = "https://api.fetch.tinyfish.ai";
const CONFIG_PATH = getWebSearchConfigPath();
const SEARCH_TIMEOUT_MS = 60_000;
const FETCH_TIMEOUT_MS = 150_000;
const MAX_FETCH_URLS = 10;
const MAX_FETCH_PER_URL_TIMEOUT_MS = 110_000;

interface WebSearchConfig {
	tinyfishApiKey?: unknown;
}

interface TinyFishSearchResult {
	position?: number;
	site_name?: string | null;
	title?: string | null;
	snippet?: string | null;
	url?: string | null;
	date?: string | null;
	publisher?: string | null;
}

interface TinyFishSearchResponse {
	query?: string;
	results?: TinyFishSearchResult[];
	total_results?: number;
	page?: number;
}

interface TinyFishFetchResult {
	url?: string;
	final_url?: string;
	title?: string | null;
	text?: string | Record<string, unknown> | null;
	format?: string;
}

interface TinyFishFetchError {
	url?: string;
	error?: string;
	status?: number;
}

interface TinyFishFetchResponse {
	results?: TinyFishFetchResult[];
	errors?: TinyFishFetchError[];
}

interface TinyFishSearchOptions extends SearchOptions {
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
	try {
		cachedConfig = JSON.parse(raw) as WebSearchConfig;
		return cachedConfig;
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		throw new Error(`Failed to parse ${CONFIG_PATH}: ${message}`);
	}
}

export function clearTinyFishConfigCache(): void {
	cachedConfig = null;
}

async function getApiKey(signal?: AbortSignal): Promise<string> {
	const key = await resolveCredential({
		provider: "TinyFish",
		configuredValue: loadConfig().tinyfishApiKey,
		environmentValue: process.env.TINYFISH_API_KEY,
		signal,
	});
	if (!key) {
		throw new Error(
			"TinyFish API key not found. Either:\n" +
			`  1. Create ${CONFIG_PATH} with { "tinyfishApiKey": "your-key" }\n` +
			"  2. Set TINYFISH_API_KEY environment variable\n" +
			"Get a key at https://agent.tinyfish.ai/api-keys",
		);
	}
	return key;
}

export function isTinyFishAvailable(): boolean {
	return hasCredentialSource({
		provider: "TinyFish",
		configuredValue: loadConfig().tinyfishApiKey,
		environmentValue: process.env.TINYFISH_API_KEY,
	});
}

function errorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

function requestSignal(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
	const timeout = AbortSignal.timeout(timeoutMs);
	return signal ? AbortSignal.any([signal, timeout]) : timeout;
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

function mapDomainFilter(domainFilter: string[] | undefined): { includeDomains: string[]; excludeDomains: string[] } {
	const includeDomains: string[] = [];
	const excludeDomains: string[] = [];
	for (const raw of domainFilter ?? []) {
		const domain = normalizeDomain(raw);
		if (!domain) continue;
		const target = raw.trim().startsWith("-") ? excludeDomains : includeDomains;
		if (!target.includes(domain)) target.push(domain);
	}
	return { includeDomains, excludeDomains };
}

function recencyMinutes(filter: SearchOptions["recencyFilter"]): number | undefined {
	if (!filter) return undefined;
	const minutes: Record<NonNullable<SearchOptions["recencyFilter"]>, number> = {
		day: 1_440,
		week: 10_080,
		month: 43_200,
		year: 525_600,
	};
	return minutes[filter];
}

function normalizeNumResults(value: number | undefined): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return 5;
	return Math.max(1, Math.min(Math.floor(value), 20));
}

function buildSearchUrl(query: string, options: SearchOptions, page: number): string {
	const params = new URLSearchParams({ query });
	const { includeDomains, excludeDomains } = mapDomainFilter(options.domainFilter);
	if (includeDomains.length > 0) params.set("include_domains", includeDomains.join(","));
	if (excludeDomains.length > 0) params.set("exclude_domains", excludeDomains.join(","));
	const recency = recencyMinutes(options.recencyFilter);
	if (recency !== undefined) params.set("recency_minutes", String(recency));
	if (page > 0) params.set("page", String(page));
	return `${TINYFISH_SEARCH_URL}?${params.toString()}`;
}

async function tinyFishJsonRequest<T>(
	label: "Search" | "Fetch",
	url: string,
	apiKey: string,
	init: RequestInit,
	timeoutMs: number,
	signal?: AbortSignal,
): Promise<T> {
	let response: Response;
	try {
		response = await fetch(url, {
			...init,
			headers: {
				"X-API-Key": apiKey,
				...(init.body ? { "Content-Type": "application/json" } : {}),
				...init.headers,
			},
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
		throw new Error(`TinyFish ${label} API error ${response.status}: ${redactCredential(raw, apiKey).slice(0, 300)}`);
	}
	try {
		return JSON.parse(raw) as T;
	} catch (err) {
		throw new Error(`TinyFish ${label} API returned invalid JSON: ${errorMessage(err)}`);
	}
}

function mapSearchResults(results: TinyFishSearchResult[] | undefined): SearchResponse["results"] {
	if (!Array.isArray(results)) return [];
	return results.flatMap((item) => {
		if (!item || typeof item.url !== "string" || item.url.trim().length === 0) return [];
		const url = item.url.trim();
		return [{
			title: typeof item.title === "string" && item.title.trim() ? item.title.trim() : url,
			url,
			snippet: typeof item.snippet === "string" ? item.snippet.replace(/\s+/g, " ").trim() : "",
		}];
	});
}

function deduplicateResults(results: SearchResponse["results"], limit: number): SearchResponse["results"] {
	const seen = new Set<string>();
	const unique: SearchResponse["results"] = [];
	for (const result of results) {
		if (seen.has(result.url)) continue;
		seen.add(result.url);
		unique.push(result);
		if (unique.length >= limit) break;
	}
	return unique;
}

function buildAnswer(results: SearchResponse["results"]): string {
	return results.map((result) => {
		if (result.snippet) return `${result.snippet}\nSource: ${result.title} (${result.url})`;
		return `Source: ${result.title} (${result.url})`;
	}).join("\n\n");
}

function fetchPerUrlTimeout(value: number | undefined): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return MAX_FETCH_PER_URL_TIMEOUT_MS;
	return Math.max(1, Math.min(Math.floor(value), MAX_FETCH_PER_URL_TIMEOUT_MS));
}

function fetchBody(urls: string[], options: ExtractOptions = {}): Record<string, unknown> {
	const body: Record<string, unknown> = {
		urls,
		format: "markdown",
		per_url_timeout_ms: fetchPerUrlTimeout(options.timeoutMs),
	};
	const purpose = options.prompt?.trim();
	if (purpose) body.purpose = purpose.slice(0, 2_000);
	return body;
}

function findFetchError(errors: TinyFishFetchError[] | undefined, url: string): TinyFishFetchError | undefined {
	if (!Array.isArray(errors)) return undefined;
	return errors.find(item => item?.url === url) ?? errors[0];
}

function fetchResultContent(result: TinyFishFetchResult): string {
	if (typeof result.text === "string") return result.text.trim();
	if (result.text && typeof result.text === "object") return JSON.stringify(result.text, null, 2);
	return "";
}

function mapFetchResult(result: TinyFishFetchResult | undefined, requestedUrl: string): ExtractedContent | null {
	if (!result) return null;
	const content = fetchResultContent(result);
	if (!content) return null;
	return {
		url: requestedUrl,
		title: typeof result.title === "string" ? result.title.trim() : "",
		content,
		error: null,
	};
}

async function fetchBatch(
	urls: string[],
	apiKey: string,
	signal?: AbortSignal,
	options: ExtractOptions = {},
): Promise<TinyFishFetchResponse> {
	return tinyFishJsonRequest<TinyFishFetchResponse>(
		"Fetch",
		TINYFISH_FETCH_URL,
		apiKey,
		{ method: "POST", body: JSON.stringify(fetchBody(urls, options)) },
		FETCH_TIMEOUT_MS,
		signal,
	);
}

async function fetchInlineContent(
	urls: string[],
	apiKey: string,
	signal?: AbortSignal,
): Promise<ExtractedContent[]> {
	const content: ExtractedContent[] = [];
	for (let offset = 0; offset < urls.length; offset += MAX_FETCH_URLS) {
		const batch = urls.slice(offset, offset + MAX_FETCH_URLS);
		const data = await fetchBatch(batch, apiKey, signal);
		if (!Array.isArray(data.results) || !Array.isArray(data.errors)) {
			throw new Error("TinyFish Fetch API returned an unexpected response shape");
		}
		for (const url of batch) {
			const result = Array.isArray(data.results)
				? data.results.find(item => item?.url === url || item?.final_url === url)
				: undefined;
			const mapped = mapFetchResult(result, url);
			if (mapped) content.push(mapped);
		}
	}
	return content;
}

export async function searchWithTinyFish(query: string, options: TinyFishSearchOptions = {}): Promise<SearchResponse> {
	const apiKey = await getApiKey(options.signal);
	const numResults = normalizeNumResults(options.numResults);
	const activityId = activityMonitor.logStart({ type: "api", query });
	try {
		const combined: SearchResponse["results"] = [];
		const pages = numResults > 10 ? 2 : 1;
		for (let page = 0; page < pages; page++) {
			const data = await tinyFishJsonRequest<TinyFishSearchResponse>(
				"Search",
				buildSearchUrl(query, options, page),
				apiKey,
				{ method: "GET" },
				SEARCH_TIMEOUT_MS,
				options.signal,
			);
			if (!Array.isArray(data.results)) throw new Error("TinyFish Search API returned an unexpected response shape");
			combined.push(...mapSearchResults(data.results));
			if (data.results.length < 10) break;
		}

		const results = deduplicateResults(combined, numResults);
		const response: SearchResponse = { answer: buildAnswer(results), results };
		if (options.includeContent && results.length > 0) {
			const inlineContent = await fetchInlineContent(results.map(result => result.url), apiKey, options.signal);
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

export async function extractWithTinyFish(
	url: string,
	signal?: AbortSignal,
	options: ExtractOptions = {},
): Promise<ExtractedContent | null> {
	const apiKey = await getApiKey(signal);
	const activityId = activityMonitor.logStart({ type: "fetch", url });
	try {
		const data = await fetchBatch([url], apiKey, signal, options);
		if (!Array.isArray(data.results) || !Array.isArray(data.errors)) {
			throw new Error("TinyFish Fetch API returned an unexpected response shape");
		}
		const result = data.results.find(item => item?.url === url || item?.final_url === url) ?? data.results[0];
		const mapped = mapFetchResult(result, url);
		if (mapped) {
			activityMonitor.logComplete(activityId, 200);
			return mapped;
		}
		const fetchError = findFetchError(data.errors, url);
		if (fetchError) {
			const status = typeof fetchError.status === "number" ? ` (HTTP ${fetchError.status})` : "";
			throw new Error(`TinyFish Fetch failed for ${url}: ${fetchError.error || "unknown error"}${status}`);
		}
		activityMonitor.logComplete(activityId, 200);
		return null;
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
