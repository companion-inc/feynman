import { existsSync, readFileSync } from "node:fs";
import { activityMonitor } from "./activity.ts";
import { hasCredentialSource, redactCredential, resolveCredential } from "./credential-source.ts";
import type { ExtractedContent } from "./extract.ts";
import type { SearchOptions, SearchResponse } from "./perplexity.ts";
import { getWebSearchConfigPath } from "./utils.ts";

const JINA_SEARCH_BASE_URL = "https://s.jina.ai/";
const CONFIG_PATH = getWebSearchConfigPath();
const SEARCH_TIMEOUT_MS = 60_000;

interface WebSearchConfig {
	jinaApiKey?: unknown;
}

interface JinaSearchItem {
	title?: unknown;
	url?: unknown;
	description?: unknown;
	content?: unknown;
}

interface JinaSearchEnvelope {
	code?: unknown;
	data?: unknown;
}

interface JinaSearchOptions extends SearchOptions {
	includeContent?: boolean;
}

let cachedConfig: WebSearchConfig | null = null;

function loadConfig(): WebSearchConfig {
	if (cachedConfig) return cachedConfig;
	if (!existsSync(CONFIG_PATH)) {
		cachedConfig = {};
		return cachedConfig;
	}

	const raw = readFileSync(CONFIG_PATH, "utf8");
	try {
		const parsed: unknown = JSON.parse(raw);
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			throw new Error("expected a JSON object");
		}
		cachedConfig = parsed as WebSearchConfig;
		return cachedConfig;
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		throw new Error(`Failed to parse ${CONFIG_PATH}: ${message}`);
	}
}

async function getApiKey(signal?: AbortSignal): Promise<string | null> {
	return resolveCredential({
		provider: "Jina Search",
		configuredValue: loadConfig().jinaApiKey,
		environmentValue: process.env.JINA_API_KEY,
		signal,
	});
}

async function requireApiKey(signal?: AbortSignal): Promise<string> {
	const apiKey = await getApiKey(signal);
	if (!apiKey) {
		throw new Error(
			"Jina Search API key not found. Either:\n" +
			`  1. Create ${CONFIG_PATH} with { "jinaApiKey": "your-key" }\n` +
			"  2. Set JINA_API_KEY environment variable\n" +
			"Get a key at https://jina.ai/api-dashboard",
		);
	}
	return apiKey;
}

function normalizeCount(value: number | undefined): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return 5;
	return Math.max(1, Math.min(Math.floor(value), 20));
}

function normalizeDomain(value: string): string | null {
	let input = value.trim().toLowerCase();
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

function mapDomainFilter(domainFilter: string[] | undefined): { includes: string[]; excludes: string[] } {
	const includes: string[] = [];
	const excludes: string[] = [];
	for (const raw of domainFilter ?? []) {
		const domain = normalizeDomain(raw);
		if (!domain) continue;
		const target = raw.trim().startsWith("-") ? excludes : includes;
		if (!target.includes(domain)) target.push(domain);
	}
	return { includes, excludes };
}

function buildSearchRequest(query: string, options: JinaSearchOptions, numResults: number): { url: string; filters: ReturnType<typeof mapDomainFilter> } {
	const filters = mapDomainFilter(options.domainFilter);
	const recency = options.recencyFilter ? ` published in the past ${options.recencyFilter}` : "";
	const exclusions = filters.excludes.map((domain) => ` -site:${domain}`).join("");
	const constrainedQuery = `${query.trim()}${exclusions}${recency}`.trim();
	const url = new URL(encodeURIComponent(constrainedQuery), JINA_SEARCH_BASE_URL);
	url.searchParams.set("count", String(numResults));
	for (const domain of filters.includes) url.searchParams.append("site", domain);
	return { url: url.toString(), filters };
}

function requestSignal(signal?: AbortSignal): { signal: AbortSignal; timeout: AbortSignal } {
	const timeout = AbortSignal.timeout(SEARCH_TIMEOUT_MS);
	return {
		timeout,
		signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
	};
}

function errorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

function parseItems(value: unknown): JinaSearchItem[] {
	if (Array.isArray(value)) return value as JinaSearchItem[];
	if (!value || typeof value !== "object") {
		throw new Error("Jina Search API returned invalid response: expected an object or array");
	}
	const envelope = value as JinaSearchEnvelope;
	if (typeof envelope.code === "number" && envelope.code !== 200) {
		throw new Error(`Jina Search API error ${envelope.code}: response envelope reported failure`);
	}
	if (!Array.isArray(envelope.data)) {
		throw new Error("Jina Search API returned invalid response: expected data array");
	}
	return envelope.data as JinaSearchItem[];
}

function passesDomainFilter(url: string, filters: ReturnType<typeof mapDomainFilter>): boolean {
	let hostname: string;
	try {
		hostname = new URL(url).hostname.toLowerCase();
	} catch {
		return false;
	}
	const matches = (domain: string): boolean => hostname === domain || hostname.endsWith(`.${domain}`);
	if (filters.includes.length > 0 && !filters.includes.some(matches)) return false;
	return !filters.excludes.some(matches);
}

function mapItems(items: JinaSearchItem[], numResults: number, filters: ReturnType<typeof mapDomainFilter>): {
	results: SearchResponse["results"];
	content: ExtractedContent[];
} {
	const results: SearchResponse["results"] = [];
	const content: ExtractedContent[] = [];
	const seen = new Set<string>();
	for (const item of items) {
		const url = typeof item?.url === "string" ? item.url.trim() : "";
		if (!url || seen.has(url) || !passesDomainFilter(url, filters)) continue;
		seen.add(url);
		const title = typeof item.title === "string" && item.title.trim()
			? item.title.trim()
			: `Source ${results.length + 1}`;
		const snippet = typeof item.description === "string"
			? item.description.replace(/\s+/g, " ").trim()
			: "";
		results.push({ title, url, snippet });
		if (typeof item.content === "string" && item.content.trim()) {
			content.push({ url, title, content: item.content.trim(), error: null });
		}
		if (results.length >= numResults) break;
	}
	return { results, content };
}

function buildAnswer(results: SearchResponse["results"]): string {
	return results
		.map((result) => result.snippet
			? `${result.snippet}\nSource: ${result.title} (${result.url})`
			: `Source: ${result.title} (${result.url})`)
		.join("\n\n");
}

function rethrowRequestError(
	err: unknown,
	apiKey: string,
	activityId: string,
	request: ReturnType<typeof requestSignal>,
	callerSignal?: AbortSignal,
): never {
	if (request.timeout.aborted && !callerSignal?.aborted) {
		activityMonitor.logComplete(activityId, 408);
		throw new Error("Jina Search API error 408: request timed out");
	}
	const message = errorMessage(err);
	const redactedMessage = redactCredential(message, apiKey);
	if (redactedMessage.toLowerCase().includes("abort")) activityMonitor.logComplete(activityId, 0);
	else activityMonitor.logError(activityId, redactedMessage);
	if (redactedMessage === message) throw err;
	const redactedError = new Error(redactedMessage);
	if (err instanceof Error) redactedError.name = err.name;
	throw redactedError;
}

export function isJinaSearchAvailable(): boolean {
	return hasCredentialSource({
		provider: "Jina Search",
		configuredValue: loadConfig().jinaApiKey,
		environmentValue: process.env.JINA_API_KEY,
	});
}

export async function searchWithJina(query: string, options: JinaSearchOptions = {}): Promise<SearchResponse> {
	const apiKey = await requireApiKey(options.signal);
	const numResults = normalizeCount(options.numResults);
	const { url, filters } = buildSearchRequest(query, options, numResults);
	const activityId = activityMonitor.logStart({ type: "api", query });
	const request = requestSignal(options.signal);
	let response: Response;
	try {
		response = await fetch(url, {
			headers: {
				"Accept": "application/json",
				"Authorization": `Bearer ${apiKey}`,
				"User-Agent": "pi-web-access",
				"X-Respond-With": options.includeContent ? "content" : "no-content",
				"X-Retain-Images": "none",
			},
			signal: request.signal,
		});
	} catch (err) {
		rethrowRequestError(err, apiKey, activityId, request, options.signal);
	}

	if (!response.ok) {
		let body: string;
		try {
			body = redactCredential(await response.text(), apiKey);
		} catch (err) {
			rethrowRequestError(err, apiKey, activityId, request, options.signal);
		}
		activityMonitor.logComplete(activityId, response.status);
		throw new Error(`Jina Search API error ${response.status}: ${body.slice(0, 300)}`);
	}

	let raw: unknown;
	try {
		raw = await response.json();
	} catch (err) {
		if (!(err instanceof SyntaxError)) {
			rethrowRequestError(err, apiKey, activityId, request, options.signal);
		}
		activityMonitor.logComplete(activityId, response.status);
		throw new Error("Jina Search API returned invalid JSON");
	}

	let mapped: ReturnType<typeof mapItems>;
	try {
		mapped = mapItems(parseItems(raw), numResults, filters);
	} catch (err) {
		const message = errorMessage(err);
		const redactedMessage = redactCredential(message, apiKey);
		activityMonitor.logError(activityId, redactedMessage);
		if (redactedMessage === message) throw err;
		const redactedError = new Error(redactedMessage);
		if (err instanceof Error) redactedError.name = err.name;
		throw redactedError;
	}
	activityMonitor.logComplete(activityId, response.status);
	const result: SearchResponse = {
		answer: buildAnswer(mapped.results),
		results: mapped.results,
	};
	if (options.includeContent && mapped.content.length > 0) result.inlineContent = mapped.content;
	return result;
}
