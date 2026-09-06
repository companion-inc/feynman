import { existsSync, readFileSync } from "node:fs";
import { activityMonitor } from "./activity.ts";
import type { ExtractedContent } from "./extract.ts";
import type { SearchOptions, SearchResponse } from "./perplexity.ts";
import { hasCredentialSource, redactCredential, resolveCredential } from "./credential-source.ts";
import { getWebSearchConfigPath } from "./utils.ts";

const VALYU_SEARCH_URL = "https://api.valyu.ai/v1/search";
const CONFIG_PATH = getWebSearchConfigPath();
const SEARCH_TIMEOUT_MS = 60_000;
const MAX_SNIPPET_CHARS = 2_500;
const MAX_CONTENT_CHARS = 4_000;

interface WebSearchConfig {
	valyuApiKey?: unknown;
}

interface ValyuResult {
	title?: unknown;
	url?: unknown;
	description?: unknown;
	content?: unknown;
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
		provider: "Valyu",
		configuredValue: loadConfig().valyuApiKey,
		environmentValue: process.env.VALYU_API_KEY,
		signal,
	});
}

async function requireApiKey(signal?: AbortSignal): Promise<string> {
	const apiKey = await getApiKey(signal);
	if (!apiKey) {
		throw new Error(
			"Valyu API key not found. Either:\n" +
			`  1. Create ${CONFIG_PATH} with { "valyuApiKey": "your-key" }\n` +
			"  2. Set VALYU_API_KEY environment variable\n" +
			"Get a key at https://platform.valyu.ai",
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

function mapDomainFilter(domainFilter: string[] | undefined): { included_sources?: string[]; excluded_sources?: string[] } {
	if (!domainFilter?.length) return {};
	const included_sources: string[] = [];
	const excluded_sources: string[] = [];
	for (const raw of domainFilter) {
		const domain = normalizeDomain(raw);
		if (!domain) continue;
		const target = raw.trim().startsWith("-") ? excluded_sources : included_sources;
		if (!target.includes(domain)) target.push(domain);
	}
	return {
		...(included_sources.length > 0 ? { included_sources } : {}),
		...(excluded_sources.length > 0 ? { excluded_sources } : {}),
	};
}

function recencyToStartDate(filter: SearchOptions["recencyFilter"]): string | undefined {
	if (!filter) return undefined;
	const days = { day: 1, week: 7, month: 30, year: 365 }[filter];
	return days ? new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10) : undefined;
}

function text(value: unknown, limit: number): string {
	return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, limit) : "";
}

function errorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

function invalidResponse(message: string): Error {
	return new Error(`Valyu API returned invalid response: ${message}`);
}

function parseResponse(value: unknown): ValyuResult[] {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw invalidResponse("expected an object envelope");
	const envelope = value as Record<string, unknown>;
	if (envelope.success !== true) throw invalidResponse("expected success true");
	if (!Array.isArray(envelope.results)) throw invalidResponse("expected results array");
	return envelope.results as ValyuResult[];
}

function buildAnswer(results: SearchResponse["results"]): string {
	return results.map((result) => result.snippet
		? `${result.snippet}\nSource: ${result.title} (${result.url})`
		: `Source: ${result.title} (${result.url})`).join("\n\n");
}

export function isValyuAvailable(): boolean {
	return hasCredentialSource({ provider: "Valyu", configuredValue: loadConfig().valyuApiKey, environmentValue: process.env.VALYU_API_KEY });
}

export async function searchWithValyu(query: string, options: SearchOptions & { includeContent?: boolean } = {}): Promise<SearchResponse> {
	const apiKey = await requireApiKey(options.signal);
	const numResults = normalizeCount(options.numResults);
	const startDate = recencyToStartDate(options.recencyFilter);
	const activityId = activityMonitor.logStart({ type: "api", query });
	let response: Response;
	try {
		response = await fetch(VALYU_SEARCH_URL, {
			method: "POST",
			headers: { "x-api-key": apiKey, "Content-Type": "application/json", Accept: "application/json" },
			body: JSON.stringify({ query, max_num_results: numResults, ...mapDomainFilter(options.domainFilter), ...(startDate ? { start_date: startDate } : {}) }),
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
		throw new Error(`Valyu API error ${response.status}: ${errorText.slice(0, 300)}`);
	}
	let rawData: unknown;
	try {
		rawData = await response.json();
	} catch (err) {
		activityMonitor.logComplete(activityId, response.status);
		throw new Error(`Valyu API returned invalid JSON: ${errorMessage(err)}`);
	}
	let entries: ValyuResult[];
	try {
		entries = parseResponse(rawData);
	} catch (err) {
		activityMonitor.logComplete(activityId, response.status);
		throw err;
	}
	activityMonitor.logComplete(activityId, response.status);
	const results: SearchResponse["results"] = [];
	const inlineContent: ExtractedContent[] = [];
	for (const entry of entries) {
		if (!entry || typeof entry !== "object") continue;
		const url = text(entry.url, Number.MAX_SAFE_INTEGER);
		if (!url) continue;
		const title = text(entry.title, Number.MAX_SAFE_INTEGER) || `Source ${results.length + 1}`;
		const content = text(entry.content, MAX_CONTENT_CHARS);
		const description = text(entry.description, MAX_SNIPPET_CHARS);
		results.push({ title, url, snippet: (content || description).slice(0, MAX_SNIPPET_CHARS) });
		if (options.includeContent && content) inlineContent.push({ url, title, content, error: null });
		if (results.length >= numResults) break;
	}
	return { answer: buildAnswer(results), results, ...(inlineContent.length > 0 ? { inlineContent } : {}) };
}
