import { existsSync, readFileSync } from "node:fs";
import { activityMonitor } from "./activity.ts";
import type { SearchOptions, SearchResponse, SearchResult } from "./perplexity.ts";
import { hasCredentialSource, redactCredential, resolveCredential } from "./credential-source.ts";
import { getWebSearchConfigPath } from "./utils.ts";

const MISTRAL_CONVERSATIONS_URL = "https://api.mistral.ai/v1/conversations";
const CONFIG_PATH = getWebSearchConfigPath();
const SEARCH_TIMEOUT_MS = 60_000;
const DEFAULT_SEARCH_MODEL = "mistral-small-latest";
const DEFAULT_SEARCH_TOOL = "web_search";
const MAX_RESULTS = 20;

type MistralSearchTool = "web_search" | "web_search_premium";

interface WebSearchConfig {
	mistralApiKey?: unknown;
	mistralSearchModel?: unknown;
	mistralSearchTool?: unknown;
}

interface DomainFilters {
	include: string[];
	exclude: string[];
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

function resolveSearchModel(value: unknown): string {
	if (value === undefined) return DEFAULT_SEARCH_MODEL;
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`mistralSearchModel in ${CONFIG_PATH} must be a non-empty string`);
	}
	return value.trim();
}

function resolveSearchTool(value: unknown): MistralSearchTool {
	if (value === undefined) return DEFAULT_SEARCH_TOOL;
	if (value !== "web_search" && value !== "web_search_premium") {
		throw new Error(`mistralSearchTool in ${CONFIG_PATH} must be either web_search or web_search_premium`);
	}
	return value;
}

function normalizeCount(value: number | undefined): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return 5;
	return Math.max(1, Math.min(Math.floor(value), MAX_RESULTS));
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

function parseDomainFilters(domainFilter: string[] | undefined): DomainFilters {
	const filters: DomainFilters = { include: [], exclude: [] };
	for (const raw of domainFilter ?? []) {
		const domain = normalizeDomain(raw);
		if (!domain) continue;
		const target = raw.trim().startsWith("-") ? filters.exclude : filters.include;
		if (!target.includes(domain)) target.push(domain);
	}
	return filters;
}

function passesDomainFilters(url: string, filters: DomainFilters): boolean {
	if (filters.include.length === 0 && filters.exclude.length === 0) return true;
	const hostname = new URL(url).hostname.toLowerCase();
	const matches = (domain: string) => hostname === domain || hostname.endsWith(`.${domain}`);
	if (filters.exclude.some(matches)) return false;
	return filters.include.length === 0 || filters.include.some(matches);
}

function normalizeResultUrl(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const url = value.trim();
	if (!url) return null;
	try {
		const parsed = new URL(url);
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
	} catch {
		return null;
	}
	return url;
}

function buildSearchPrompt(query: string, options: SearchOptions, numResults: number): string {
	const lines: string[] = [];
	if (options.recencyFilter) {
		const labels: Record<string, string> = {
			day: "past 24 hours",
			week: "past week",
			month: "past month",
			year: "past year",
		};
		lines.push(`Prefer sources from the ${labels[options.recencyFilter] ?? options.recencyFilter}.`);
	}
	if (typeof options.numResults === "number" && Number.isFinite(options.numResults) && options.numResults > 0) {
		lines.push(`Prefer up to ${numResults} distinct sources.`);
	}

	const filters = parseDomainFilters(options.domainFilter);
	if (filters.include.length > 0) lines.push(`Only use sources from: ${filters.include.slice(0, 100).join(", ")}.`);
	if (filters.exclude.length > 0) lines.push(`Do not use sources from: ${filters.exclude.slice(0, 100).join(", ")}.`);
	return lines.length > 0 ? `${lines.join(" ")}\n\n${query}` : query;
}

function errorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

function invalidResponse(message: string): Error {
	return new Error(`Mistral API returned invalid response: ${message}`);
}

function parseConversationResponse(value: unknown, options: SearchOptions, numResults: number): SearchResponse {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw invalidResponse("expected an object envelope");
	}
	const outputs = (value as Record<string, unknown>).outputs;
	if (!Array.isArray(outputs)) throw invalidResponse("outputs must be an array");

	const answerParts: string[] = [];
	const results: SearchResult[] = [];
	const seenUrls = new Set<string>();
	const domainFilters = parseDomainFilters(options.domainFilter);

	for (const output of outputs) {
		if (!output || typeof output !== "object" || Array.isArray(output)) continue;
		const entry = output as Record<string, unknown>;
		if (entry.type !== "message.output") continue;
		const content = entry.content;
		if (typeof content === "string") {
			if (content.trim()) answerParts.push(content.trim());
			continue;
		}
		if (!Array.isArray(content)) continue;

		for (const chunk of content) {
			if (!chunk || typeof chunk !== "object" || Array.isArray(chunk)) continue;
			const part = chunk as Record<string, unknown>;
			if (part.type === "text") {
				if (typeof part.text === "string" && part.text.trim()) answerParts.push(part.text.trim());
				continue;
			}
			if (part.type !== "tool_reference" || results.length >= numResults) continue;

			const url = normalizeResultUrl(part.url);
			if (!url || !passesDomainFilters(url, domainFilters) || seenUrls.has(url)) continue;
			seenUrls.add(url);
			const title = typeof part.title === "string" && part.title.trim() ? part.title.trim() : url;
			const snippet = typeof part.description === "string" ? part.description : "";
			results.push({ title, url, snippet });
		}
	}

	const answer = answerParts.join("\n").trim();
	if (!answer && results.length === 0) throw invalidResponse("no answer or sources");
	return { answer, results };
}

async function getApiKey(signal?: AbortSignal): Promise<string> {
	const apiKey = await resolveCredential({
		provider: "Mistral",
		configuredValue: loadConfig().mistralApiKey,
		environmentValue: process.env.MISTRAL_API_KEY,
		signal,
	});
	if (!apiKey) {
		throw new Error(
			"Mistral API key not found. Either:\n" +
			`  1. Create ${CONFIG_PATH} with { "mistralApiKey": "your-key" }\n` +
			"  2. Set MISTRAL_API_KEY environment variable\n" +
			"Get a key at https://console.mistral.ai/api-keys",
		);
	}
	return apiKey;
}

export function isMistralAvailable(): boolean {
	try {
		const config = loadConfig();
		resolveSearchModel(config.mistralSearchModel);
		resolveSearchTool(config.mistralSearchTool);
		return hasCredentialSource({
			provider: "Mistral",
			configuredValue: config.mistralApiKey,
			environmentValue: process.env.MISTRAL_API_KEY,
		});
	} catch {
		return false;
	}
}

export async function searchWithMistral(query: string, options: SearchOptions = {}): Promise<SearchResponse> {
	const config = loadConfig();
	const model = resolveSearchModel(config.mistralSearchModel);
	const tool = resolveSearchTool(config.mistralSearchTool);
	const numResults = normalizeCount(options.numResults);
	const apiKey = await getApiKey(options.signal);
	const requestSignal = options.signal
		? AbortSignal.any([AbortSignal.timeout(SEARCH_TIMEOUT_MS), options.signal])
		: AbortSignal.timeout(SEARCH_TIMEOUT_MS);
	const activityId = activityMonitor.logStart({ type: "api", query });

	try {
		const response = await fetch(MISTRAL_CONVERSATIONS_URL, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				inputs: [{ role: "user", content: buildSearchPrompt(query, options, numResults) }],
				stream: false,
				model,
				tools: [{ type: tool }],
			}),
			signal: requestSignal,
		});

		if (!response.ok) {
			const errorText = redactCredential(await response.text(), apiKey);
			throw new Error(`Mistral API error ${response.status}: ${errorText.slice(0, 300)}`);
		}

		let parsed: unknown;
		try {
			parsed = await response.json();
		} catch (err) {
			throw new Error(`Mistral API returned invalid JSON: ${errorMessage(err)}`);
		}
		const result = parseConversationResponse(parsed, options, numResults);
		activityMonitor.logComplete(activityId, response.status);
		return result;
	} catch (err) {
		const message = errorMessage(err);
		const redactedMessage = redactCredential(message, apiKey);
		if (redactedMessage.toLowerCase().includes("abort")) {
			activityMonitor.logComplete(activityId, 0);
		} else {
			activityMonitor.logError(activityId, redactedMessage);
		}
		if (redactedMessage === message) throw err;
		const redactedError = new Error(redactedMessage);
		if (err instanceof Error) redactedError.name = err.name;
		throw redactedError;
	}
}
