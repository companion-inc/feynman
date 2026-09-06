import { existsSync, readFileSync } from "node:fs";
import { activityMonitor } from "./activity.ts";
import { hasCredentialSource, redactCredential, resolveCredential } from "./credential-source.ts";
import type { ExtractedContent, ExtractOptions } from "./extract.ts";
import type { SearchOptions, SearchResponse } from "./perplexity.ts";
import { getWebSearchConfigPath } from "./utils.ts";

const QUERIT_SEARCH_URL = "https://api.querit.ai/v1/search";
const QUERIT_CONTENTS_URL = "https://api.querit.ai/v1/contents";
const CONFIG_PATH = getWebSearchConfigPath();
const SEARCH_TIMEOUT_MS = 60_000;
const CONTENTS_TIMEOUT_MS = 60_000;
const MAX_CONTENT_URLS = 10;

interface WebSearchConfig {
	queritApiKey?: unknown;
}

interface QueritSearchResult {
	url?: string | null;
	title?: string | null;
	snippet?: string | null;
	page_age?: string | null;
	site_name?: string | null;
}

interface QueritSearchResponse {
	error_code?: number | string;
	error_msg?: string;
	search_id?: number | string;
	results?: { result?: QueritSearchResult[] };
}

interface QueritContentMetadata {
	title?: string | null;
	url?: string | null;
	publishTime?: string | null;
	siteName?: string | null;
	siteIcon?: string | null;
}

interface QueritContentResult {
	id?: string | null;
	url?: string | null;
	content?: string | null;
	extrasMeta?: QueritContentMetadata | null;
}

interface QueritContentStatus {
	id?: string | null;
	status?: string | null;
}

interface QueritContentsResponse {
	error_code?: number | string;
	error_msg?: string;
	search_id?: number | string;
	results?: QueritContentResult[];
	statuses?: QueritContentStatus[];
	searchTime?: number;
}

interface QueritSearchOptions extends SearchOptions {
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
		provider: "Querit",
		configuredValue: loadConfig().queritApiKey,
		environmentValue: process.env.QUERIT_API_KEY,
		signal,
	});
	if (!key) {
		throw new Error(
			"Querit API key not found. Either:\n" +
			`  1. Create ${CONFIG_PATH} with { "queritApiKey": "your-key" }\n` +
			"  2. Set QUERIT_API_KEY environment variable\n" +
			"Create a key at https://www.querit.ai/en/dashboard/api-keys",
		);
	}
	return key;
}

export function isQueritAvailable(): boolean {
	return hasCredentialSource({
		provider: "Querit",
		configuredValue: loadConfig().queritApiKey,
		environmentValue: process.env.QUERIT_API_KEY,
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

function mapDomainFilter(domainFilter: string[] | undefined): { include: string[]; exclude: string[] } {
	const include: string[] = [];
	const exclude: string[] = [];
	for (const raw of domainFilter ?? []) {
		const domain = normalizeDomain(raw);
		if (!domain) continue;
		const target = raw.trim().startsWith("-") ? exclude : include;
		if (!target.includes(domain)) target.push(domain);
	}
	return { include, exclude };
}

function mapRecencyFilter(value: SearchOptions["recencyFilter"]): string | undefined {
	if (value === "day") return "d1";
	if (value === "week") return "w1";
	if (value === "month") return "m1";
	if (value === "year") return "y1";
	return undefined;
}

function buildSearchBody(query: string, options: QueritSearchOptions): Record<string, unknown> {
	const { include, exclude } = mapDomainFilter(options.domainFilter);
	const date = mapRecencyFilter(options.recencyFilter);
	const filters: Record<string, unknown> = {};
	if (include.length > 0 || exclude.length > 0) {
		filters.sites = {
			...(include.length > 0 ? { include } : {}),
			...(exclude.length > 0 ? { exclude } : {}),
		};
	}
	if (date) filters.timeRange = { date };
	return {
		query,
		count: normalizeNumResults(options.numResults),
		...(Object.keys(filters).length > 0 ? { filters } : {}),
	};
}

function normalizeTimeoutMs(value: number | undefined): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return CONTENTS_TIMEOUT_MS;
	return Math.max(1, Math.floor(value));
}

function crawlTimeoutSeconds(value: number | undefined): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return 10;
	return Math.max(1, Math.min(Math.ceil(value / 1_000), 60));
}

function buildContentsBody(urls: string[], options: ExtractOptions = {}): Record<string, unknown> {
	return {
		urls,
		format: "markdown",
		crawlTimeout: crawlTimeoutSeconds(options.timeoutMs),
		extrasMeta: true,
	};
}

async function queritJsonRequest<T>(
	label: "Search" | "Contents",
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
				Accept: "application/json",
				"Content-Type": "application/json",
			},
			body: JSON.stringify(body),
			signal: requestSignal(signal, timeoutMs),
		});
	} catch (err) {
		const message = errorMessage(err);
		const isRequestAbort = err instanceof Error
			? err.name === "AbortError" || err.name === "TimeoutError" || /abort|timeout/i.test(message)
			: /abort|timeout/i.test(message);
		if (!signal?.aborted && isRequestAbort) {
			const timeoutError = new Error(`Querit ${label} API request timed out after ${Math.ceil(timeoutMs / 1_000)} seconds`);
			timeoutError.name = "TimeoutError";
			throw timeoutError;
		}
		const redactedMessage = redactCredential(message, apiKey);
		if (redactedMessage === message) throw err;
		const redactedError = new Error(redactedMessage);
		if (err instanceof Error) redactedError.name = err.name;
		throw redactedError;
	}

	const raw = await response.text();
	if (!response.ok) {
		throw new Error(`Querit ${label} API error ${response.status}: ${redactCredential(raw, apiKey).slice(0, 300)}`);
	}
	try {
		return JSON.parse(raw) as T;
	} catch (err) {
		throw new Error(`Querit ${label} API returned invalid JSON: ${errorMessage(err)}`);
	}
}

function assertApiSuccess(label: "Search" | "Contents", data: QueritSearchResponse | QueritContentsResponse): void {
	const code = Number(data.error_code);
	if (!Number.isFinite(code) || code !== 200) {
		const renderedCode = data.error_code === undefined ? "unknown" : String(data.error_code);
		const message = typeof data.error_msg === "string" && data.error_msg.trim() ? `: ${data.error_msg.trim()}` : "";
		throw new Error(`Querit ${label} API returned error ${renderedCode}${message}`);
	}
}

function mapSearchResults(data: QueritSearchResponse): SearchResponse["results"] {
	const items = data.results?.result;
	if (!Array.isArray(items)) {
		throw new Error("Querit Search API returned an unexpected response shape");
	}
	return items.flatMap((item) => {
		if (!item || typeof item.url !== "string" || item.url.trim().length === 0) return [];
		const url = item.url.trim();
		return [{
			title: typeof item.title === "string" && item.title.trim() ? item.title.trim() : url,
			url,
			snippet: typeof item.snippet === "string" ? item.snippet.replace(/\s+/g, " ").trim() : "",
		}];
	});
}

function buildAnswer(results: SearchResponse["results"]): string {
	return results.map((result) => {
		if (result.snippet) return `${result.snippet}\nSource: ${result.title} (${result.url})`;
		return `Source: ${result.title} (${result.url})`;
	}).join("\n\n");
}

function mapContentResult(result: QueritContentResult | undefined, requestedUrl: string): ExtractedContent | null {
	if (!result || typeof result.content !== "string" || result.content.trim().length === 0) return null;
	const metadata = result.extrasMeta;
	return {
		url: requestedUrl,
		title: metadata && typeof metadata.title === "string" ? metadata.title.trim() : "",
		content: result.content.trim(),
		error: null,
	};
}

function findContentResult(
	data: QueritContentsResponse,
	requestedUrl: string,
	index: number,
	requestedCount: number,
): QueritContentResult | undefined {
	if (!Array.isArray(data.results)) return undefined;
	const exact = data.results.find((item) => item?.url === requestedUrl || item?.extrasMeta?.url === requestedUrl);
	if (exact) return exact;
	if (requestedCount === 1) return data.results[0];
	return data.results.length === requestedCount ? data.results[index] : undefined;
}

function failedContentStatus(data: QueritContentsResponse, result: QueritContentResult | undefined, index: number): boolean {
	if (!Array.isArray(data.statuses)) return false;
	const status = result?.id
		? data.statuses.find((item) => item?.id === result.id)
		: data.statuses[index];
	return status?.status === "failed";
}

async function fetchContentsBatch(
	urls: string[],
	apiKey: string,
	signal?: AbortSignal,
	options: ExtractOptions = {},
): Promise<QueritContentsResponse> {
	const data = await queritJsonRequest<QueritContentsResponse>(
		"Contents",
		QUERIT_CONTENTS_URL,
		apiKey,
		buildContentsBody(urls, options),
		normalizeTimeoutMs(options.timeoutMs),
		signal,
	);
	assertApiSuccess("Contents", data);
	if (!Array.isArray(data.results) || !Array.isArray(data.statuses)) {
		throw new Error("Querit Contents API returned an unexpected response shape");
	}
	return data;
}

async function fetchInlineContent(urls: string[], apiKey: string, signal?: AbortSignal): Promise<ExtractedContent[]> {
	const content: ExtractedContent[] = [];
	for (let offset = 0; offset < urls.length; offset += MAX_CONTENT_URLS) {
		const batch = urls.slice(offset, offset + MAX_CONTENT_URLS);
		const data = await fetchContentsBatch(batch, apiKey, signal);
		for (let index = 0; index < batch.length; index++) {
			const requestedUrl = batch[index];
			const result = findContentResult(data, requestedUrl, index, batch.length);
			const mapped = mapContentResult(result, requestedUrl);
			if (mapped) content.push(mapped);
		}
	}
	return content;
}

export async function searchWithQuerit(
	query: string,
	options: QueritSearchOptions = {},
): Promise<SearchResponse> {
	const apiKey = await getApiKey(options.signal);
	const activityId = activityMonitor.logStart({ type: "api", query });
	try {
		const data = await queritJsonRequest<QueritSearchResponse>(
			"Search",
			QUERIT_SEARCH_URL,
			apiKey,
			buildSearchBody(query, options),
			SEARCH_TIMEOUT_MS,
			options.signal,
		);
		assertApiSuccess("Search", data);
		const results = mapSearchResults(data);
		const response: SearchResponse = { answer: buildAnswer(results), results };
		if (options.includeContent && results.length > 0) {
			const inlineContent = await fetchInlineContent(results.map((result) => result.url), apiKey, options.signal);
			if (inlineContent.length > 0) response.inlineContent = inlineContent;
		}
		activityMonitor.logComplete(activityId, 200);
		return response;
	} catch (err) {
		const message = errorMessage(err);
		const redactedMessage = redactCredential(message, apiKey);
		if (options.signal?.aborted) activityMonitor.logComplete(activityId, 0);
		else activityMonitor.logError(activityId, redactedMessage);
		if (redactedMessage === message) throw err;
		const redactedError = new Error(redactedMessage);
		if (err instanceof Error) redactedError.name = err.name;
		throw redactedError;
	}
}

export async function extractWithQuerit(
	url: string,
	signal?: AbortSignal,
	options: ExtractOptions = {},
): Promise<ExtractedContent | null> {
	const apiKey = await getApiKey(signal);
	const activityId = activityMonitor.logStart({ type: "fetch", url });
	try {
		const data = await fetchContentsBatch([url], apiKey, signal, options);
		const result = findContentResult(data, url, 0, 1);
		const mapped = mapContentResult(result, url);
		if (mapped) {
			activityMonitor.logComplete(activityId, 200);
			return mapped;
		}
		if (failedContentStatus(data, result, 0)) {
			throw new Error(`Querit Contents API failed to crawl ${url}`);
		}
		activityMonitor.logComplete(activityId, 200);
		return null;
	} catch (err) {
		const message = errorMessage(err);
		const redactedMessage = redactCredential(message, apiKey);
		if (signal?.aborted) activityMonitor.logComplete(activityId, 0);
		else activityMonitor.logError(activityId, redactedMessage);
		if (redactedMessage === message) throw err;
		const redactedError = new Error(redactedMessage);
		if (err instanceof Error) redactedError.name = err.name;
		throw redactedError;
	}
}
