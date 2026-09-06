import { existsSync, readFileSync } from "node:fs";
import { activityMonitor } from "./activity.ts";
import { hasCredentialSource, redactCredential, resolveCredential } from "./credential-source.ts";
import type { SearchOptions, SearchResponse } from "./perplexity.ts";
import { getWebSearchConfigPath } from "./utils.ts";

const SEARCHINFINITY_SEARCH_URL = "https://torchlight.byteintlapi.com/search_api/web_search";
const CONFIG_PATH = getWebSearchConfigPath();
// API Key authenticated requests time out server-side after 30 seconds.
const SEARCH_TIMEOUT_MS = 30_000;

interface WebSearchConfig {
	searchinfinityApiKey?: unknown;
}

interface SearchinfinityWebResult {
	Id?: string;
	SortId?: number;
	Title?: string | null;
	SiteName?: string | null;
	Url?: string | null;
	Snippet?: string | null;
	Summary?: string | null;
	PublishTime?: string | null;
	LogoUrl?: string | null;
}

interface SearchinfinitySearchResponse {
	ResponseMetadata?: {
		RequestId?: string;
		Error?: {
			CodeN?: number;
			Code?: string;
			Message?: string;
		} | null;
	};
	Result?: {
		ResultCount?: number;
		WebResults?: SearchinfinityWebResult[];
		SearchContext?: {
			OriginQuery?: string;
			SearchType?: string;
		};
		TimeCost?: number;
		LogId?: string;
	} | null;
}

interface SearchinfinitySearchOptions extends SearchOptions {
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
		provider: "Searchinfinity",
		configuredValue: loadConfig().searchinfinityApiKey,
		environmentValue: process.env.SEARCHINFINITY_API_KEY,
		signal,
	});
	if (!key) {
		throw new Error(
			"Searchinfinity API key not found. Either:\n" +
			`  1. Create ${CONFIG_PATH} with { "searchinfinityApiKey": "your-key" }\n` +
			"  2. Set SEARCHINFINITY_API_KEY environment variable\n" +
			"Create a key at https://console.byteplus.com/search-infinity/api-key",
		);
	}
	return key;
}

export function isSearchinfinityAvailable(): boolean {
	return hasCredentialSource({
		provider: "Searchinfinity",
		configuredValue: loadConfig().searchinfinityApiKey,
		environmentValue: process.env.SEARCHINFINITY_API_KEY,
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

function mapRecencyFilter(recency: SearchOptions["recencyFilter"]): string | undefined {
	if (recency === "day") return "OneDay";
	if (recency === "week") return "OneWeek";
	if (recency === "month") return "OneMonth";
	if (recency === "year") return "OneYear";
	return undefined;
}

function buildSearchBody(query: string, options: SearchinfinitySearchOptions): Record<string, unknown> {
	const includeSites: string[] = [];
	const blockHosts: string[] = [];
	for (const raw of options.domainFilter ?? []) {
		const domain = normalizeDomain(raw);
		if (!domain) continue;
		const target = raw.trim().startsWith("-") ? blockHosts : includeSites;
		if (target.length < 5 && !target.includes(domain)) target.push(domain);
	}
	const filter: Record<string, unknown> = {};
	if (includeSites.length > 0) filter.Sites = includeSites.join("|");
	if (blockHosts.length > 0) filter.BlockHosts = blockHosts.join("|");

	const timeRange = mapRecencyFilter(options.recencyFilter);
	return {
		Query: query,
		Count: normalizeNumResults(options.numResults),
		...(Object.keys(filter).length > 0 ? { Filter: filter } : {}),
		...(timeRange ? { TimeRange: timeRange } : {}),
	};
}

// Map Searchinfinity business error codes to the closest HTTP semantics so
// error classification (auth/quota/invalid-request/transient) keeps working.
// CodeN carries the numeric code (e.g. 700901); Code may be a slug (e.g.
// "invalid_api_key"), so match both.
function businessErrorStatus(codeN: number | undefined, code: string, message: string): number | undefined {
	if (codeN === 700901 || code === "invalid_api_key") return 401;
	if (codeN === 700429 || code === "700429") return 429;
	if (codeN === 10400 || code === "10400") return 400;
	if (codeN === 10500 || code === "10500") return 500;
	if (codeN === 10403 || code === "10403") return /quota|exhaust/i.test(message) ? 429 : 403;
	return undefined;
}

async function searchinfinityJsonRequest(
	apiKey: string,
	body: Record<string, unknown>,
	signal?: AbortSignal,
): Promise<SearchinfinitySearchResponse> {
	let response: Response;
	try {
		response = await fetch(SEARCHINFINITY_SEARCH_URL, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(body),
			signal: requestSignal(signal, SEARCH_TIMEOUT_MS),
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
		throw new Error(`Searchinfinity Search API error ${response.status}: ${redactCredential(raw, apiKey).slice(0, 300)}`);
	}
	let data: SearchinfinitySearchResponse;
	try {
		data = JSON.parse(raw) as SearchinfinitySearchResponse;
	} catch (err) {
		throw new Error(`Searchinfinity Search API returned invalid JSON: ${errorMessage(err)}`);
	}
	const businessError = data.ResponseMetadata?.Error;
	if (businessError && (businessError.Code || businessError.Message)) {
		const code = typeof businessError.Code === "string" && businessError.Code ? businessError.Code : "unknown";
		const message = typeof businessError.Message === "string" && businessError.Message ? businessError.Message : "unknown error";
		const status = businessErrorStatus(businessError.CodeN, code, message);
		const codeLabel = typeof businessError.CodeN === "number" ? `${businessError.CodeN} ${code}` : code;
		throw new Error(
			`Searchinfinity Search API error ${status ?? "unknown"}: ${message} (code ${codeLabel})`,
		);
	}
	return data;
}

function mapSearchResults(results: SearchinfinityWebResult[] | undefined): SearchResponse["results"] {
	if (!Array.isArray(results)) {
		throw new Error("Searchinfinity Search API returned an unexpected response shape");
	}
	return results.flatMap((item) => {
		if (!item || typeof item.Url !== "string" || item.Url.trim().length === 0) return [];
		const url = item.Url.trim();
		const summary = typeof item.Summary === "string" ? item.Summary.replace(/\s+/g, " ").trim() : "";
		const snippet = typeof item.Snippet === "string" ? item.Snippet.replace(/\s+/g, " ").trim() : "";
		return [{
			title: typeof item.Title === "string" && item.Title.trim() ? item.Title.trim() : url,
			url,
			snippet: summary || snippet,
		}];
	});
}

function buildAnswer(results: SearchResponse["results"]): string {
	return results.map((result) => {
		if (result.snippet) return `${result.snippet}\nSource: ${result.title} (${result.url})`;
		return `Source: ${result.title} (${result.url})`;
	}).join("\n\n");
}

export async function searchWithSearchinfinity(
	query: string,
	options: SearchinfinitySearchOptions = {},
): Promise<SearchResponse> {
	const apiKey = await getApiKey(options.signal);
	const activityId = activityMonitor.logStart({ type: "api", query });
	try {
		const data = await searchinfinityJsonRequest(apiKey, buildSearchBody(query, options), options.signal);
		const results = mapSearchResults(data.Result?.WebResults);
		const response: SearchResponse = { answer: buildAnswer(results), results };
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
