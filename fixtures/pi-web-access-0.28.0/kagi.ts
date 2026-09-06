import { existsSync, readFileSync } from "node:fs";
import { activityMonitor } from "./activity.ts";
import type { ExtractedContent, ExtractOptions } from "./extract.ts";
import type { SearchOptions, SearchResponse } from "./perplexity.ts";
import { hasCredentialSource, redactCredential, resolveCredential } from "./credential-source.ts";
import { fetchRemoteUrl, loadFetchContentDomainPolicy, loadSsrfConfig, validateRemoteUrl, type SsrfConfig } from "./ssrf-protection.ts";
import { getWebSearchConfigPath } from "./utils.ts";

const KAGI_SEARCH_URL = "https://kagi.com/api/v1/search";
const KAGI_EXTRACT_URL = "https://kagi.com/api/v1/extract";
const CONFIG_PATH = getWebSearchConfigPath();
const SEARCH_TIMEOUT_MS = 60_000;

interface WebSearchConfig {
	kagiApiKey?: unknown;
}

interface KagiSearchOptions extends SearchOptions {
	includeContent?: boolean;
}

export interface KagiExtractOptions extends Pick<ExtractOptions, "timeoutMs" | "lookup"> {
	ssrf?: SsrfConfig;
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
		provider: "Kagi",
		configuredValue: loadConfig().kagiApiKey,
		environmentValue: process.env.KAGI_API_KEY,
		signal,
	});
}

async function requireApiKey(signal?: AbortSignal): Promise<string> {
	const apiKey = await getApiKey(signal);
	if (!apiKey) {
		throw new Error(
			"Kagi API key not found. Either:\n" +
			`  1. Create ${CONFIG_PATH} with { "kagiApiKey": "your-key" }\n` +
			"  2. Set KAGI_API_KEY environment variable\n" +
			"Create a key at https://kagi.com/settings?p=api",
		);
	}
	return apiKey;
}

function normalizeCount(value: number | undefined): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return 5;
	return Math.max(1, Math.min(Math.floor(value), 20));
}

function errorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

function invalidResponse(message: string): Error {
	return new Error(`Kagi API returned invalid response: ${message}`);
}

function firstString(...values: unknown[]): string | null {
	for (const value of values) {
		if (typeof value === "string" && value.trim()) return value.trim();
	}
	return null;
}

function appendSearchItems(value: unknown, results: SearchResponse["results"], inlineContent: ExtractedContent[]): void {
	if (Array.isArray(value)) {
		for (const item of value) appendSearchItems(item, results, inlineContent);
		return;
	}
	if (!value || typeof value !== "object") return;
	const item = value as Record<string, unknown>;
	const url = firstString(item.url, item.href, item.link);
	if (!url) return;
	const title = firstString(item.title, item.name) ?? url;
	const snippet = firstString(item.snippet, item.description, item.summary, item.content, item.markdown, item.text) ?? "";
	results.push({ title, url, snippet });
	const content = firstString(item.markdown, item.content, item.text);
	if (content) inlineContent.push({ url, title, content, error: null });
}

function parseErrors(value: unknown): string | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const envelope = value as Record<string, unknown>;
	const rawErrors = envelope.errors ?? envelope.error;
	if (!Array.isArray(rawErrors)) return null;
	const messages = rawErrors.map((entry) => {
		if (!entry || typeof entry !== "object") return String(entry);
		const raw = entry as Record<string, unknown>;
		return firstString(raw.message, raw.msg, raw.code) ?? JSON.stringify(raw);
	});
	return messages.length > 0 ? messages.join("; ") : null;
}

function parseSearchResponse(value: unknown): { results: SearchResponse["results"]; inlineContent: ExtractedContent[] } {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw invalidResponse("expected an object envelope");
	const message = parseErrors(value);
	if (message) throw invalidResponse(message);
	const envelope = value as Record<string, unknown>;
	const results: SearchResponse["results"] = [];
	const inlineContent: ExtractedContent[] = [];
	const data = envelope.data;
	const items = (typeof data === "object" && data !== null && !Array.isArray(data))
		? (data as Record<string, unknown>).search
		: data;
	appendSearchItems(items, results, inlineContent);
	return { results, inlineContent };
}

function parseExtractResponse(value: unknown, requestedUrl: string): ExtractedContent | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw invalidResponse("expected extract object envelope");
	const message = parseErrors(value);
	if (message) throw invalidResponse(message);
	const envelope = value as Record<string, unknown>;
	const candidates = Array.isArray(envelope.data) ? envelope.data : [envelope.data ?? envelope];
	for (const candidate of candidates) {
		if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
		const item = candidate as Record<string, unknown>;
		const content = firstString(item.markdown, item.content, item.text);
		if (!content) continue;
		return {
			url: firstString(item.url, item.href, item.link) ?? requestedUrl,
			title: firstString(item.title, item.name) ?? requestedUrl,
			content,
			error: null,
		};
	}
	return null;
}

function buildAnswer(results: SearchResponse["results"]): string {
	return results.map((result) => result.snippet
		? `${result.snippet}\nSource: ${result.title} (${result.url})`
		: `Source: ${result.title} (${result.url})`).join("\n\n");
}

export function isKagiAvailable(): boolean {
	return hasCredentialSource({ provider: "Kagi", configuredValue: loadConfig().kagiApiKey, environmentValue: process.env.KAGI_API_KEY });
}

export async function searchWithKagi(query: string, options: KagiSearchOptions = {}): Promise<SearchResponse> {
	const apiKey = await requireApiKey(options.signal);
	const numResults = normalizeCount(options.numResults);
	const activityId = activityMonitor.logStart({ type: "api", query });
	let response: Response;
	try {
		response = await fetch(KAGI_SEARCH_URL, {
			method: "POST",
			headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", Accept: "application/json" },
			body: JSON.stringify({ query, limit: numResults }),
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
		throw new Error(`Kagi API error ${response.status}: ${errorText.slice(0, 300)}`);
	}
	let rawData: unknown;
	try {
		rawData = await response.json();
	} catch (err) {
		activityMonitor.logComplete(activityId, response.status);
		throw new Error(`Kagi API returned invalid JSON: ${errorMessage(err)}`);
	}
	const parsed = parseSearchResponse(rawData);
	activityMonitor.logComplete(activityId, response.status);
	const results = parsed.results.slice(0, numResults);
	const mapped: SearchResponse = { answer: buildAnswer(results), results };
	if (options.includeContent) {
		const urls = new Set(results.map(result => result.url));
		const inlineContent = parsed.inlineContent.filter(content => urls.has(content.url));
		if (inlineContent.length > 0) mapped.inlineContent = inlineContent;
	}
	return mapped;
}

export function isKagiExtractAvailable(): boolean {
	return isKagiAvailable();
}

export async function extractWithKagi(url: string, signal?: AbortSignal, options: KagiExtractOptions = {}): Promise<ExtractedContent | null> {
	const ssrf = options.ssrf ?? loadSsrfConfig();
	const domainPolicy = loadFetchContentDomainPolicy();
	await validateRemoteUrl(url, {
		allowRanges: ssrf.allowRanges,
		trustEnvProxy: ssrf.trustEnvProxy,
		domainPolicy,
		...(options.lookup ? { lookup: options.lookup } : {}),
	});
	const apiKey = await requireApiKey(signal);
	const activityId = activityMonitor.logStart({ type: "api", query: `kagi extract: ${url}` });
	let response: Response;
	try {
		response = await fetchRemoteUrl(KAGI_EXTRACT_URL, {
			method: "POST",
			headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", Accept: "application/json" },
			body: JSON.stringify({ pages: [{ url }] }),
			signal: signal ? AbortSignal.any([AbortSignal.timeout(options.timeoutMs ?? SEARCH_TIMEOUT_MS), signal]) : AbortSignal.timeout(options.timeoutMs ?? SEARCH_TIMEOUT_MS),
		}, {
			allowRanges: ssrf.allowRanges,
			trustEnvProxy: ssrf.trustEnvProxy,
			onRedirect: ({ from, to, init }) => to.origin === from.origin ? init : { ...init, headers: { "Content-Type": "application/json", Accept: "application/json" } },
			...(options.lookup ? { lookup: options.lookup } : {}),
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
		throw new Error(`Kagi Extract API error ${response.status}: ${errorText.slice(0, 300)}`);
	}
	let rawData: unknown;
	try {
		rawData = await response.json();
	} catch (err) {
		activityMonitor.logComplete(activityId, response.status);
		throw new Error(`Kagi Extract API returned invalid JSON: ${errorMessage(err)}`);
	}
	const parsed = parseExtractResponse(rawData, url);
	activityMonitor.logComplete(activityId, response.status);
	return parsed;
}
