import { existsSync, readFileSync } from "node:fs";
import { activityMonitor } from "./activity.ts";
import type { SearchOptions, SearchResponse } from "./perplexity.ts";
import { hasCredentialSource, redactCredential, resolveCredential } from "./credential-source.ts";
import { getWebSearchConfigPath } from "./utils.ts";

const SERPBASE_API_URL = "https://api.serpbase.dev/google/search";
const CONFIG_PATH = getWebSearchConfigPath();
const SEARCH_TIMEOUT_MS = 60_000;
const RECENCY_TBS: Record<string, string> = {
	day: "qdr:d",
	week: "qdr:w",
	month: "qdr:m",
	year: "qdr:y",
};

interface WebSearchConfig {
	serpbaseApiKey?: unknown;
}

interface SerpBaseOrganicResult {
	title?: unknown;
	link?: unknown;
	url?: unknown;
	snippet?: unknown;
	description?: unknown;
}

interface SerpBaseResponse {
	organic_results?: SerpBaseOrganicResult[];
	organic?: SerpBaseOrganicResult[];
	results?: SerpBaseOrganicResult[];
	status?: unknown;
	error?: unknown;
	message?: unknown;
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

async function getApiKey(signal?: AbortSignal): Promise<string | null> {
	return resolveCredential({
		provider: "SerpBase",
		configuredValue: loadConfig().serpbaseApiKey,
		environmentValue: process.env.SERPBASE_API_KEY,
		signal,
	});
}

async function requireApiKey(signal?: AbortSignal): Promise<string> {
	const apiKey = await getApiKey(signal);
	if (!apiKey) {
		throw new Error(
			"SerpBase API key not found. Either:\n" +
			`  1. Create ${CONFIG_PATH} with { "serpbaseApiKey": "your-key" }\n` +
			"  2. Set SERPBASE_API_KEY environment variable\n" +
			"Get a key at https://serpbase.dev",
		);
	}
	return apiKey;
}

function normalizeCount(value: number | undefined): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return 10;
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

interface DomainFilters {
	include: string[];
	exclude: string[];
}

function parseDomainFilter(domainFilter: string[] | undefined): DomainFilters {
	const filters: DomainFilters = { include: [], exclude: [] };
	if (!domainFilter?.length) return filters;
	for (const raw of domainFilter) {
		const domain = normalizeDomain(raw);
		if (!domain) continue;
		const target = raw.trim().startsWith("-") ? filters.exclude : filters.include;
		if (!target.includes(domain)) target.push(domain);
	}
	return filters;
}

function domainMatches(hostname: string, domain: string): boolean {
	return hostname === domain || hostname.endsWith(`.${domain}`);
}

function passesDomainFilters(url: string, filters: DomainFilters): boolean {
	if (filters.include.length === 0 && filters.exclude.length === 0) return true;
	let hostname: string;
	try {
		hostname = new URL(url).hostname.toLowerCase();
	} catch {
		return false;
	}
	if (filters.exclude.some((domain) => domainMatches(hostname, domain))) return false;
	if (filters.include.length === 0) return true;
	return filters.include.some((domain) => domainMatches(hostname, domain));
}

function buildQuery(query: string, filters: DomainFilters): string {
	const parts = [query];
	if (filters.include.length === 1) parts.push(`site:${filters.include[0]}`);
	if (filters.include.length > 1) parts.push(`(${filters.include.map(domain => `site:${domain}`).join(" OR ")})`);
	for (const domain of filters.exclude) parts.push(`-site:${domain}`);
	return parts.join(" ");
}

function errorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

function invalidResponse(message: string): Error {
	return new Error(`SerpBase API returned invalid response: ${message}`);
}

function parseResponse(value: unknown): SerpBaseResponse {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw invalidResponse("expected an object envelope");
	const envelope = value as SerpBaseResponse;
	if (typeof envelope.error === "string" && envelope.error.trim()) {
		const suffix = typeof envelope.status === "number" || typeof envelope.status === "string" ? ` (status ${envelope.status})` : "";
		throw invalidResponse(`${envelope.error}${suffix}`);
	}
	const organic = envelope.organic_results ?? envelope.organic ?? envelope.results;
	if (!Array.isArray(organic)) throw invalidResponse("expected organic_results array");
	return { ...envelope, organic_results: organic };
}

function buildAnswer(results: SearchResponse["results"]): string {
	return results.map((result) => result.snippet
		? `${result.snippet}\nSource: ${result.title} (${result.url})`
		: `Source: ${result.title} (${result.url})`).join("\n\n");
}

export function isSerpBaseAvailable(): boolean {
	return hasCredentialSource({ provider: "SerpBase", configuredValue: loadConfig().serpbaseApiKey, environmentValue: process.env.SERPBASE_API_KEY });
}

export async function searchWithSerpBase(query: string, options: SearchOptions = {}): Promise<SearchResponse> {
	const apiKey = await requireApiKey(options.signal);
	const numResults = normalizeCount(options.numResults);
	const filters = parseDomainFilter(options.domainFilter);
	const url = new URL(SERPBASE_API_URL);
	url.searchParams.set("q", buildQuery(query, filters));
	// SerpBase's Google Search endpoint authenticates with an `api_key` query parameter.
	url.searchParams.set("api_key", apiKey);
	url.searchParams.set("num", String(numResults));
	if (options.recencyFilter && RECENCY_TBS[options.recencyFilter]) url.searchParams.set("tbs", RECENCY_TBS[options.recencyFilter]);
	const activityId = activityMonitor.logStart({ type: "api", query });
	let response: Response;
	try {
		response = await fetch(url, {
			headers: { Accept: "application/json" },
			signal: options.signal ? AbortSignal.any([AbortSignal.timeout(SEARCH_TIMEOUT_MS), options.signal]) : AbortSignal.timeout(SEARCH_TIMEOUT_MS),
		});
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
	if (!response.ok) {
		activityMonitor.logComplete(activityId, response.status);
		const errorText = redactCredential(await response.text(), apiKey);
		throw new Error(`SerpBase API error ${response.status}: ${errorText.slice(0, 300)}`);
	}
	let rawData: unknown;
	try {
		rawData = await response.json();
	} catch (err) {
		activityMonitor.logComplete(activityId, response.status);
		throw new Error(`SerpBase API returned invalid JSON: ${errorMessage(err)}`);
	}
	const data = parseResponse(rawData);
	activityMonitor.logComplete(activityId, response.status);
	const results: SearchResponse["results"] = [];
	for (const item of data.organic_results ?? []) {
		const url = typeof item.link === "string" ? item.link : typeof item.url === "string" ? item.url : "";
		if (!url || !passesDomainFilters(url, filters)) continue;
		results.push({
			title: typeof item.title === "string" && item.title.trim() ? item.title : `Source ${results.length + 1}`,
			url,
			snippet: typeof item.snippet === "string" ? item.snippet : typeof item.description === "string" ? item.description : "",
		});
		if (results.length >= numResults) break;
	}
	return { answer: buildAnswer(results), results };
}
