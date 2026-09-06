import { existsSync, readFileSync } from "node:fs";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { activityMonitor } from "./activity.ts";
import type { SearchOptions, SearchResponse, SearchResult } from "./perplexity.ts";
import { hasCredentialSource, redactCredential, resolveCredential } from "./credential-source.ts";
import { getWebSearchConfigPath } from "./utils.ts";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const CODEX_RESPONSES_URL = "https://chatgpt.com/backend-api/codex/responses";
const CONFIG_PATH = getWebSearchConfigPath();
const SEARCH_TIMEOUT_MS = 60_000;

// The selected model runs the server-side web_search call and writes the cited summary.
// Prefer the newest mid-tier ("terra") model, then the newest bare mainline id; price
// tiers ("pro"/"ultra" id segments) are excluded, and the numeric-aware sort keeps
// e.g. gpt-5.10 ahead of gpt-5.9.
const EXCLUDED_MODEL_SEGMENTS = new Set(["pro", "ultra"]);
const MODEL_PREFERENCE = [
	(id: string) => id.includes("terra"),
	(id: string) => /^gpt-\d+(\.\d+)?$/.test(id),
];
const DEFAULT_SEARCH_PROVIDERS: readonly string[] = ["openai-codex", "openai"];

function pickSearchModel<T extends { id: string }>(models: readonly T[]): T | undefined {
	const candidates = models
		.filter((model) => !model.id.split("-").some((segment) => EXCLUDED_MODEL_SEGMENTS.has(segment)))
		.sort((a, b) => b.id.localeCompare(a.id, undefined, { numeric: true }));
	for (const prefers of MODEL_PREFERENCE) {
		const preferred = candidates.find((model) => prefers(model.id));
		if (preferred) return preferred;
	}
	return candidates[0];
}

interface WebSearchConfig {
	openaiApiKey?: unknown;
	openaiResponsesUrl?: unknown;
	openaiSearchModel?: unknown;
	openaiSearchProviders?: unknown;
}

type ProviderHeaders = Record<string, string | null>;

interface OpenAIAuth {
	provider: string;
	apiKey: string;
	model: string;
	headers: ProviderHeaders;
	responsesUrl: string;
	useCodexEndpoint?: boolean;
}

type CurrentModel = NonNullable<ExtensionContext["model"]>;

interface CurrentModelSearchTarget {
	responsesUrl: string;
	useCodexEndpoint: boolean;
}

function resolveCurrentModelSearchTarget(model: CurrentModel): CurrentModelSearchTarget {
	const url = new URL(model.baseUrl);
	if (url.protocol !== "https:") throw new Error("Current model base URL must use HTTPS");

	if (model.provider === "openai" && model.api === "openai-responses" && url.hostname.toLowerCase() === "api.openai.com") {
		const pathname = url.pathname.replace(/\/+$/u, "");
		url.pathname = `${pathname}/responses`;
		return { responsesUrl: url.toString(), useCodexEndpoint: false };
	}

	if (
		model.provider === "openai-codex" &&
		model.api === "openai-codex-responses" &&
		url.hostname.toLowerCase() === "chatgpt.com" &&
		url.pathname.replace(/\/+$/u, "") === "/backend-api"
	) {
		return { responsesUrl: CODEX_RESPONSES_URL, useCodexEndpoint: true };
	}

	throw new Error("Current model is not backed by an official OpenAI Responses endpoint");
}

export function isCurrentModelHostedSearchEligible(ctx?: Pick<ExtensionContext, "model">): boolean {
	const model = ctx?.model;
	if (!model || !/^gpt-/iu.test(model.id)) return false;
	try {
		resolveCurrentModelSearchTarget(model);
		return true;
	} catch {
		return false;
	}
}

interface NormalizedDomainFilters {
	allowedDomains?: string[];
	blockedDomains?: string[];
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

function normalizeDomainFilters(domainFilter: string[] | undefined): NormalizedDomainFilters | null {
	if (!domainFilter?.length) return null;

	const allowedDomains: string[] = [];
	const blockedDomains: string[] = [];
	for (const raw of domainFilter) {
		const domain = normalizeDomain(raw);
		if (!domain) continue;
		const target = raw.trim().startsWith("-") ? blockedDomains : allowedDomains;
		if (!target.includes(domain)) target.push(domain);
	}

	return allowedDomains.length > 0 || blockedDomains.length > 0
		? {
			...(allowedDomains.length > 0 ? { allowedDomains: allowedDomains.slice(0, 100) } : {}),
			...(blockedDomains.length > 0 ? { blockedDomains: blockedDomains.slice(0, 100) } : {}),
		}
		: null;
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
	const parts = token.split(".");
	if (parts.length !== 3 || !parts[1]) return null;
	try {
		const padded = parts[1].replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(parts[1].length / 4) * 4, "=");
		const parsed = JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
		return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
	} catch {
		return null;
	}
}

function isCodexJwt(token: string): boolean {
	const payload = decodeJwtPayload(token);
	return !!payload?.["https://api.openai.com/auth"];
}

function extractAccountId(token: string): string | undefined {
	const payload = decodeJwtPayload(token);
	const auth = payload?.["https://api.openai.com/auth"];
	if (!auth || typeof auth !== "object") return undefined;
	const id = (auth as Record<string, unknown>).chatgpt_account_id;
	return typeof id === "string" && id.trim().length > 0 ? id.trim() : undefined;
}

function resolveConfiguredResponsesUrl(value: unknown): string {
	if (value === undefined) return OPENAI_RESPONSES_URL;
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`openaiResponsesUrl in ${CONFIG_PATH} must be an absolute http(s) URL`);
	}
	let url: URL;
	try {
		url = new URL(value.trim());
	} catch {
		throw new Error(`openaiResponsesUrl in ${CONFIG_PATH} must be an absolute http(s) URL`);
	}
	if (url.protocol !== "https:" && url.protocol !== "http:") {
		throw new Error(`openaiResponsesUrl in ${CONFIG_PATH} must use http or https`);
	}
	return url.toString();
}

function resolveConfiguredSearchProviders(value: unknown): readonly string[] {
	if (value === undefined) return DEFAULT_SEARCH_PROVIDERS;
	if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || entry.trim().length === 0)) {
		throw new Error(`openaiSearchProviders in ${CONFIG_PATH} must be an array of non-empty Pi provider ids`);
	}
	return value.map((entry) => entry.trim());
}

function resolveConfiguredSearchModel(value: unknown): string | undefined {
	if (value == null) return undefined;
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`openaiSearchModel in ${CONFIG_PATH} must be a non-empty string`);
	}
	return value.trim();
}

function toRequestHeaders(headers: ProviderHeaders): Record<string, string> {
	const requestHeaders: Record<string, string> = {};
	for (const [name, value] of Object.entries(headers)) {
		if (value !== null) requestHeaders[name] = value;
	}
	return requestHeaders;
}

async function resolvePiAuth(ctx: ExtensionContext, responsesUrl: string, providers: readonly string[], modelOverride?: string): Promise<OpenAIAuth | undefined> {
	let models: ReturnType<typeof ctx.modelRegistry.getAll>;
	try {
		models = ctx.modelRegistry.getAll();
	} catch {
		return undefined;
	}
	for (const provider of providers) {
		const preferred = pickSearchModel(models.filter((model) => model.provider === provider));
		if (!preferred) continue;
		try {
			const resolved = await ctx.modelRegistry.getApiKeyAndHeaders(preferred);
			if (resolved.ok && resolved.apiKey) {
				return {
					provider,
					apiKey: resolved.apiKey,
					model: modelOverride ?? preferred.id,
					headers: resolved.headers ?? {},
					responsesUrl,
				};
			}
		} catch {
		}
	}
	return undefined;
}

export async function resolveOpenAIAuth(ctx?: ExtensionContext, signal?: AbortSignal): Promise<OpenAIAuth | undefined> {
	const config = loadConfig();
	const responsesUrl = resolveConfiguredResponsesUrl(config.openaiResponsesUrl);
	const modelOverride = resolveConfiguredSearchModel(config.openaiSearchModel);
	const providers = resolveConfiguredSearchProviders(config.openaiSearchProviders);
	if (ctx) {
		const auth = await resolvePiAuth(ctx, responsesUrl, providers, modelOverride);
		if (auth) return auth;
	}

	const hasSource = hasCredentialSource({
		provider: "OpenAI",
		configuredValue: config.openaiApiKey,
		environmentValue: process.env.OPENAI_API_KEY,
	});
	if (!hasSource) return undefined;
	const apiKey = await resolveCredential({
		provider: "OpenAI",
		configuredValue: config.openaiApiKey,
		environmentValue: process.env.OPENAI_API_KEY,
		signal,
	});
	return apiKey
		? { provider: "openai", apiKey, model: modelOverride ?? "gpt-5.6-terra", headers: {}, responsesUrl }
		: undefined;
}

export async function isOpenAISearchAvailable(ctx?: ExtensionContext): Promise<boolean> {
	const config = loadConfig();
	const responsesUrl = resolveConfiguredResponsesUrl(config.openaiResponsesUrl);
	const providers = resolveConfiguredSearchProviders(config.openaiSearchProviders);
	if (ctx && await resolvePiAuth(ctx, responsesUrl, providers)) return true;
	return hasCredentialSource({
		provider: "OpenAI",
		configuredValue: config.openaiApiKey,
		environmentValue: process.env.OPENAI_API_KEY,
	});
}

async function resolveCurrentModelAuth(ctx: ExtensionContext, signal?: AbortSignal): Promise<OpenAIAuth> {
	const model = ctx.model;
	if (!model || !isCurrentModelHostedSearchEligible(ctx)) {
		throw new Error("Current model is not eligible for official OpenAI Hosted web search");
	}
	const target = resolveCurrentModelSearchTarget(model);
	const resolved = await ctx.modelRegistry.getApiKeyAndHeaders(model);
	if (signal?.aborted) signal.throwIfAborted();
	if (!resolved.ok) throw new Error(`OpenAI current model authentication failed: ${resolved.error}`);
	if (!resolved.apiKey) throw new Error("OpenAI current model authentication failed: API key unavailable");
	return {
		provider: "openai",
		apiKey: resolved.apiKey,
		model: model.id,
		headers: resolved.headers ?? {},
		responsesUrl: target.responsesUrl,
		useCodexEndpoint: target.useCodexEndpoint,
	};
}

function buildInstructions(options: SearchOptions): string {
	const lines = [
		"Search the web and return a concise answer grounded only in the web results.",
		"Include clickable source citations in the response text when possible.",
	];

	if (options.recencyFilter) {
		const labels: Record<string, string> = {
			day: "past 24 hours",
			week: "past week",
			month: "past month",
			year: "past year",
		};
		lines.push(`Prefer sources from the ${labels[options.recencyFilter]}.`);
	}

	if (typeof options.numResults === "number" && Number.isFinite(options.numResults) && options.numResults > 0) {
		lines.push(`Prefer around ${Math.min(Math.floor(options.numResults), 20)} distinct sources.`);
	}

	const filters = normalizeDomainFilters(options.domainFilter);
	if (filters?.allowedDomains?.length) lines.push(`Only use sources from: ${filters.allowedDomains.join(", ")}.`);
	if (filters?.blockedDomains?.length) lines.push(`Do not use sources from: ${filters.blockedDomains.join(", ")}.`);

	return lines.join(" ");
}

function buildWebSearchTool(options: SearchOptions): Record<string, unknown> {
	const tool: Record<string, unknown> = { type: "web_search" };
	const filters = normalizeDomainFilters(options.domainFilter);
	if (filters) {
		tool.filters = {
			...(filters.allowedDomains ? { allowed_domains: filters.allowedDomains } : {}),
			...(filters.blockedDomains ? { blocked_domains: filters.blockedDomains } : {}),
		};
	}
	return tool;
}

interface ParsedOpenAIResponse {
	payload: Record<string, unknown>;
	webSearchCallSeen: boolean;
}

function isWebSearchCall(item: unknown): boolean {
	return !!item && typeof item === "object" && (item as { type?: unknown }).type === "web_search_call";
}

async function parseOpenAIResponse(response: Response): Promise<ParsedOpenAIResponse> {
	const text = await response.text();
	const trimmed = text.trim();
	if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
		try {
			const parsed = JSON.parse(trimmed);
			const payload = Array.isArray(parsed)
				? { output: parsed }
				: parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : { output: [] };
			const output = Array.isArray(payload.output) ? payload.output : [];
			return { payload, webSearchCallSeen: output.some(isWebSearchCall) };
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			throw new Error(`OpenAI API returned invalid JSON: ${message}`);
		}
	}

	const outputItems: unknown[] = [];
	let completedResponse: Record<string, unknown> | null = null;
	let webSearchCallSeen = false;
	for (const line of text.split("\n")) {
		if (!line.startsWith("data: ")) continue;
		const data = line.slice(6).trim();
		if (!data || data === "[DONE]") continue;
		try {
			const parsed = JSON.parse(data) as Record<string, unknown>;
			if (typeof parsed.type === "string" && parsed.type.startsWith("response.web_search_call")) webSearchCallSeen = true;
			if (parsed.type === "response.output_item.done" && parsed.item) {
				outputItems.push(parsed.item);
				webSearchCallSeen ||= isWebSearchCall(parsed.item);
			}
			if ((parsed.type === "response.done" || parsed.type === "response.completed") && parsed.response && typeof parsed.response === "object") {
				completedResponse = parsed.response as Record<string, unknown>;
			}
		} catch {
		}
	}

	if (completedResponse) {
		const output = Array.isArray(completedResponse.output) ? completedResponse.output : [];
		const payload = output.length > 0 ? completedResponse : { ...completedResponse, output: outputItems };
		return { payload, webSearchCallSeen: webSearchCallSeen || output.some(isWebSearchCall) };
	}
	if (outputItems.length > 0) return { payload: { output: outputItems }, webSearchCallSeen: webSearchCallSeen || outputItems.some(isWebSearchCall) };
	throw new Error("OpenAI API returned no parseable response output");
}

function cleanSourceUrl(rawUrl: string): string {
	try {
		const url = new URL(rawUrl);
		if (url.searchParams.get("utm_source") === "openai") url.searchParams.delete("utm_source");
		return url.toString();
	} catch {
		return rawUrl.replace(/[?&]utm_source=openai$/, "");
	}
}

function extractSnippetAround(text: string, start: unknown, end: unknown): string {
	if (typeof start !== "number" || typeof end !== "number" || !text) return "";
	const before = Math.max(0, start - 100);
	const after = Math.min(text.length, end + 100);
	const snippet = text.slice(before, after).replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").trim();
	return snippet.length > 300 ? `${snippet.slice(0, 297)}...` : snippet;
}

function addResult(results: SearchResult[], seen: Set<string>, url: unknown, title: unknown, snippet = ""): void {
	if (typeof url !== "string" || url.trim().length === 0) return;
	const cleanUrl = cleanSourceUrl(url);
	if (seen.has(cleanUrl)) return;
	seen.add(cleanUrl);
	results.push({
		title: typeof title === "string" && title.trim().length > 0 ? title : cleanUrl,
		url: cleanUrl,
		snippet,
	});
}

function extractSearchResults(output: unknown[], numResults: number | undefined): SearchResult[] {
	const results: SearchResult[] = [];
	const seenUrls = new Set<string>();

	for (const item of output) {
		if (!item || typeof item !== "object" || (item as { type?: unknown }).type !== "message") continue;
		const content = (item as { content?: unknown }).content;
		if (!Array.isArray(content)) continue;
		for (const part of content) {
			if (!part || typeof part !== "object") continue;
			const text = typeof (part as { text?: unknown }).text === "string" ? (part as { text: string }).text : "";
			const annotations = (part as { annotations?: unknown }).annotations;
			if (!Array.isArray(annotations)) continue;
			for (const annotation of annotations) {
				if (!annotation || typeof annotation !== "object" || (annotation as { type?: unknown }).type !== "url_citation") continue;
				addResult(
					results,
					seenUrls,
					(annotation as { url?: unknown }).url,
					(annotation as { title?: unknown }).title,
					extractSnippetAround(text, (annotation as { start_index?: unknown }).start_index, (annotation as { end_index?: unknown }).end_index),
				);
			}
		}
	}

	for (const item of output) {
		if (!item || typeof item !== "object" || (item as { type?: unknown }).type !== "web_search_call") continue;
		const value = item as { action?: unknown; sources?: unknown; results?: unknown };
		const actionSources = value.action && typeof value.action === "object"
			? (value.action as { sources?: unknown }).sources
			: undefined;
		const sourceGroups = [actionSources, value.sources, value.results];
		for (const group of sourceGroups) {
			if (!Array.isArray(group)) continue;
			for (const source of group) {
				if (!source || typeof source !== "object") continue;
				const record = source as Record<string, unknown>;
				addResult(results, seenUrls, record.url ?? record.source_website_url, record.title ?? record.caption);
			}
		}
	}

	if (typeof numResults === "number" && Number.isFinite(numResults) && numResults > 0) {
		return results.slice(0, Math.min(Math.floor(numResults), 20));
	}
	return results;
}

function extractAnswer(output: unknown[]): string {
	const parts: string[] = [];
	for (const item of output) {
		if (!item || typeof item !== "object" || (item as { type?: unknown }).type !== "message") continue;
		const content = (item as { content?: unknown }).content;
		if (!Array.isArray(content)) continue;
		for (const part of content) {
			if (!part || typeof part !== "object") continue;
			const text = (part as { text?: unknown }).text;
			if (typeof text === "string" && text.trim().length > 0) parts.push(text);
		}
	}
	return parts.join("\n").trim();
}

async function runOpenAISearch(
	query: string,
	options: SearchOptions,
	auth: OpenAIAuth,
): Promise<SearchResponse> {
	const activityId = activityMonitor.logStart({ type: "api", query });
	const headers: Record<string, string> = {
		...toRequestHeaders(auth.headers),
		Authorization: `Bearer ${auth.apiKey}`,
		"Content-Type": "application/json",
		"OpenAI-Beta": "responses=experimental",
	};
	const useCodexEndpoint = auth.useCodexEndpoint ?? (auth.provider === "openai-codex" || isCodexJwt(auth.apiKey));
	if (useCodexEndpoint) {
		const accountId = extractAccountId(auth.apiKey);
		if (accountId) headers["chatgpt-account-id"] = accountId;
		headers.originator = "pi";
	}

	const body = {
		model: auth.model,
		instructions: buildInstructions(options),
		input: [{ role: "user", content: [{ type: "input_text", text: query }] }],
		tools: [buildWebSearchTool(options)],
		include: ["web_search_call.action.sources"],
		store: false,
		stream: true,
		tool_choice: "required" as const,
		parallel_tool_calls: true,
	};

	try {
		const response = await fetch(useCodexEndpoint ? CODEX_RESPONSES_URL : auth.responsesUrl, {
			method: "POST",
			headers,
			body: JSON.stringify(body),
			signal: options.signal
				? AbortSignal.any([AbortSignal.timeout(SEARCH_TIMEOUT_MS), options.signal])
				: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
		});

		if (!response.ok) {
			activityMonitor.logError(activityId, `HTTP ${response.status}`);
			const errorText = redactCredential(await response.text(), auth.apiKey);
			throw new Error(`OpenAI API error ${response.status}: ${errorText.slice(0, 300)}`);
		}

		const parsed = await parseOpenAIResponse(response);
		const output = Array.isArray(parsed.payload.output) ? parsed.payload.output : [];
		if (!parsed.webSearchCallSeen) throw new Error("OpenAI web_search returned no web_search_call");
		const answer = extractAnswer(output);
		const results = extractSearchResults(output, options.numResults);

		if (!answer && results.length === 0) {
			throw new Error("OpenAI web_search returned no answer or sources");
		}

		activityMonitor.logComplete(activityId, response.status);
		return { answer, results };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		const redactedMessage = redactCredential(message, auth.apiKey);
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

export async function searchWithOpenAI(
	query: string,
	options: SearchOptions = {},
	ctx?: ExtensionContext,
): Promise<SearchResponse> {
	const auth = await resolveOpenAIAuth(ctx, options.signal);
	if (!auth) {
		throw new Error(
			"OpenAI web search unavailable. Either:\n" +
			"  1. Use /login to sign in with a Codex subscription\n" +
			`  2. Create ${CONFIG_PATH} with { "openaiApiKey": "your-key" }\n` +
			"  3. Set OPENAI_API_KEY environment variable",
		);
	}
	return runOpenAISearch(query, options, auth);
}

export async function searchWithCurrentModelOpenAI(
	query: string,
	options: SearchOptions = {},
	ctx?: ExtensionContext,
): Promise<SearchResponse> {
	if (!ctx) throw new Error("OpenAI current-model search requires an extension context");
	const auth = await resolveCurrentModelAuth(ctx, options.signal);
	return runOpenAISearch(query, options, auth);
}
