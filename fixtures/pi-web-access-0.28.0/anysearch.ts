import { existsSync, readFileSync } from "node:fs";
import { activityMonitor } from "./activity.ts";
import type { ExtractedContent } from "./extract.ts";
import type { SearchOptions, SearchResponse } from "./perplexity.ts";
import { redactCredential, resolveCredential } from "./credential-source.ts";
import { getWebSearchConfigPath } from "./utils.ts";

const ANYSEARCH_API_URL = "https://api.anysearch.com/v1/search";
const CONFIG_PATH = getWebSearchConfigPath();
const SEARCH_TIMEOUT_MS = 30_000;

interface WebSearchConfig {
	anysearchApiKey?: unknown;
}

interface AnySearchResult {
	title: string;
	url: string;
	snippet: string;
	content: string;
}

interface AnySearchSearchOptions extends SearchOptions {
	includeContent?: boolean;
}

interface AnySearchResponse {
	code: 0;
	data: {
		results: AnySearchResult[];
		metadata: Record<string, unknown>;
	};
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
		provider: "AnySearch",
		configuredValue: loadConfig().anysearchApiKey,
		environmentValue: process.env.ANYSEARCH_API_KEY,
		signal,
	});
}

function normalizeCount(value: number | undefined): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return 5;
	return Math.max(1, Math.min(Math.floor(value), 20));
}

function errorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

function invalidResponse(message: string): Error {
	return new Error(`AnySearch API returned invalid response: ${message}`);
}

function parseResponse(value: unknown): AnySearchResponse {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw invalidResponse("expected an object envelope");
	}
	const envelope = value as Record<string, unknown>;
	if (envelope.code !== 0) throw invalidResponse("expected code 0");
	if (!envelope.data || typeof envelope.data !== "object" || Array.isArray(envelope.data)) {
		throw invalidResponse("expected data object");
	}
	const data = envelope.data as Record<string, unknown>;
	if (!Array.isArray(data.results)) throw invalidResponse("expected data.results array");
	if (!data.metadata || typeof data.metadata !== "object" || Array.isArray(data.metadata)) {
		throw invalidResponse("expected data.metadata object");
	}

	const results: AnySearchResult[] = [];
	for (const [index, value] of data.results.entries()) {
		if (!value || typeof value !== "object" || Array.isArray(value)) {
			throw invalidResponse(`expected data.results[${index}] object`);
		}
		const result = value as Record<string, unknown>;
		const { title, url, snippet, content } = result;
		if (typeof title !== "string") throw invalidResponse(`expected data.results[${index}].title string`);
		if (typeof url !== "string") throw invalidResponse(`expected data.results[${index}].url string`);
		if (typeof snippet !== "string") throw invalidResponse(`expected data.results[${index}].snippet string`);
		if (content !== undefined && content !== null && typeof content !== "string") {
			throw invalidResponse(`expected data.results[${index}].content string`);
		}
		if (!url) throw invalidResponse(`expected data.results[${index}].url to be non-empty`);
		results.push({ title, url, snippet, content: typeof content === "string" ? content : "" });
	}

	return { code: 0, data: { results, metadata: data.metadata as Record<string, unknown> } };
}

function buildAnswer(results: SearchResponse["results"]): string {
	return results
		.map((result) => result.snippet
			? `${result.snippet}\nSource: ${result.title} (${result.url})`
			: `Source: ${result.title} (${result.url})`)
		.join("\n\n");
}

export function isAnySearchAvailable(): boolean {
	return true;
}

export async function searchWithAnySearch(query: string, options: AnySearchSearchOptions = {}): Promise<SearchResponse> {
	const apiKey = await getApiKey(options.signal);
	const numResults = normalizeCount(options.numResults);
	const body = { query, max_results: numResults };
	const activityId = activityMonitor.logStart({ type: "api", query });
	let response: Response;

	try {
		response = await fetch(ANYSEARCH_API_URL, {
			method: "POST",
			headers: {
				...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
				"Content-Type": "application/json",
			},
			body: JSON.stringify(body),
			signal: options.signal
				? AbortSignal.any([AbortSignal.timeout(SEARCH_TIMEOUT_MS), options.signal])
				: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
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
		throw new Error(`AnySearch API error ${response.status}: ${errorText.slice(0, 300)}`);
	}

	let rawData: unknown;
	try {
		rawData = await response.json();
	} catch (err) {
		activityMonitor.logComplete(activityId, response.status);
		throw new Error(`AnySearch API returned invalid JSON: ${errorMessage(err)}`);
	}

	let data: AnySearchResponse;
	try {
		data = parseResponse(rawData);
	} catch (err) {
		activityMonitor.logComplete(activityId, response.status);
		throw err;
	}

	activityMonitor.logComplete(activityId, response.status);
	const results = data.data.results.slice(0, numResults).map((result) => ({
		title: result.title,
		url: result.url,
		snippet: result.snippet,
	}));
	const mapped: SearchResponse = { answer: buildAnswer(results), results };
	if (options.includeContent) {
		const inlineContent: ExtractedContent[] = data.data.results.slice(0, numResults)
			.filter(result => result.content.length > 0)
			.map(result => ({ url: result.url, title: result.title, content: result.content, error: null }));
		if (inlineContent.length > 0) mapped.inlineContent = inlineContent;
	}
	return mapped;
}
