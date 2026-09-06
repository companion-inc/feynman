import { existsSync, readFileSync } from "node:fs";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { activityMonitor } from "./activity.ts";
import type { SearchOptions, SearchResponse, SearchResult } from "./perplexity.ts";
import { hasCredentialSource, redactCredential, resolveCredential } from "./credential-source.ts";
import { getWebSearchConfigPath } from "./utils.ts";

// xAI's Agent Tools API: hosted `web_search` and opt-in `x_search` tools on an
// OpenAI-compatible Responses endpoint. The search runs inside xAI's own inference, so — unlike
// every keyed backend here — it is paid for by whatever credential answers for
// the model, including a SuperGrok / X Premium subscription resolved through
// pi's model registry.
//
// Note for anyone extending this: xAI's older Live Search (`search_parameters`
// on /v1/chat/completions) is GONE. It now answers 410 with "Live search is
// deprecated. Please switch to the Agent Tools API". Do not add it back.
//
// The request body is deliberately minimal — model, input, tools — because that
// is the shape verified against a live subscription account. `stream`,
// `include`, `tool_choice` and `parallel_tool_calls` are all sent by the OpenAI
// backend but were NOT verified here, and a 400 from an unsupported field would
// cost the user their search. Responses API inline citations are enabled by
// default; sources may also come back in a search call's `action.sources`.

const XAI_RESPONSES_URL = "https://api.x.ai/v1/responses";
const CONFIG_PATH = getWebSearchConfigPath();
const SEARCH_TIMEOUT_MS = 60_000;

// Ordered best-first. pi's builtin xai catalog is small and xAI retires models
// briskly, so this is a preference list, not an assumption: the first one the
// registry actually knows wins, and an unknown id is skipped rather than sent.
// xAI's current X Search docs use grok-4.6. Keep the existing web-only default
// unchanged, while preferring the documented model when X Search is opted in.
const WEB_SEARCH_AUTH_MODEL_CANDIDATES = ["grok-4.5", "grok-4.3", "grok-build-0.1"] as const;
const X_SEARCH_AUTH_MODEL_CANDIDATES = ["grok-4.6", ...WEB_SEARCH_AUTH_MODEL_CANDIDATES] as const;

type XaiSearchTool = "web_search" | "x_search";
const DEFAULT_XAI_SEARCH_TOOLS = ["web_search"] as const satisfies readonly XaiSearchTool[];

interface WebSearchConfig {
	xaiApiKey?: unknown;
	xaiSearchModel?: unknown;
	xaiSearchTools?: unknown;
}

type ProviderHeaders = Record<string, string | null>;

interface XaiAuth {
	apiKey: string;
	model: string;
	headers: ProviderHeaders;
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

function resolveConfiguredSearchModel(value: unknown): string | undefined {
	if (value == null) return undefined;
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`xaiSearchModel in ${CONFIG_PATH} must be a non-empty string`);
	}
	return value.trim();
}

function resolveConfiguredSearchTools(value: unknown): XaiSearchTool[] {
	if (value === undefined) return [...DEFAULT_XAI_SEARCH_TOOLS];
	if (!Array.isArray(value) || value.length === 0) {
		throw new Error(`xaiSearchTools in ${CONFIG_PATH} must be a non-empty array containing only web_search or x_search`);
	}

	const tools: XaiSearchTool[] = [];
	for (const tool of value) {
		if (tool !== "web_search" && tool !== "x_search") {
			throw new Error(`xaiSearchTools in ${CONFIG_PATH} may only contain web_search or x_search`);
		}
		if (tools.includes(tool)) {
			throw new Error(`xaiSearchTools in ${CONFIG_PATH} must not contain duplicates: ${tool}`);
		}
		tools.push(tool);
	}
	return tools;
}

function modelCandidatesForTools(tools: readonly XaiSearchTool[]): readonly string[] {
	return tools.includes("x_search") ? X_SEARCH_AUTH_MODEL_CANDIDATES : WEB_SEARCH_AUTH_MODEL_CANDIDATES;
}

function toRequestHeaders(headers: ProviderHeaders): Record<string, string> {
	const requestHeaders: Record<string, string> = {};
	for (const [name, value] of Object.entries(headers)) {
		if (value !== null) requestHeaders[name] = value;
	}
	return requestHeaders;
}

/**
 * Resolve auth from pi's model registry first, so a Grok subscription pays for
 * its own searches and no api key has to be configured at all. Mirrors how the
 * OpenAI backend picks up a Codex sign-in.
 */
async function resolvePiAuth(
	ctx: ExtensionContext,
	modelOverride: string | undefined,
	tools: readonly XaiSearchTool[],
): Promise<XaiAuth | undefined> {
	for (const modelId of modelCandidatesForTools(tools)) {
		try {
			const model = ctx.modelRegistry.find("xai", modelId);
			if (!model) continue;
			const resolved = await ctx.modelRegistry.getApiKeyAndHeaders(model);
			if (resolved.ok && resolved.apiKey) {
				return { apiKey: resolved.apiKey, model: modelOverride ?? modelId, headers: resolved.headers ?? {} };
			}
		} catch {
		}
	}
	return undefined;
}

export async function resolveXaiAuth(ctx?: ExtensionContext, signal?: AbortSignal): Promise<XaiAuth | undefined> {
	const config = loadConfig();
	const modelOverride = resolveConfiguredSearchModel(config.xaiSearchModel);
	const tools = resolveConfiguredSearchTools(config.xaiSearchTools);
	if (ctx) {
		const auth = await resolvePiAuth(ctx, modelOverride, tools);
		if (auth) return auth;
	}

	const hasSource = hasCredentialSource({
		provider: "xAI",
		configuredValue: config.xaiApiKey,
		environmentValue: process.env.XAI_API_KEY,
	});
	if (!hasSource) return undefined;
	const apiKey = await resolveCredential({
		provider: "xAI",
		configuredValue: config.xaiApiKey,
		environmentValue: process.env.XAI_API_KEY,
		signal,
	});
	return apiKey ? { apiKey, model: modelOverride ?? modelCandidatesForTools(tools)[0], headers: {} } : undefined;
}

export async function isXaiSearchAvailable(ctx?: ExtensionContext): Promise<boolean> {
	let config: WebSearchConfig;
	let tools: XaiSearchTool[];
	try {
		config = loadConfig();
		tools = resolveConfiguredSearchTools(config.xaiSearchTools);
	} catch {
		return false;
	}
	if (ctx && await resolvePiAuth(ctx, undefined, tools)) return true;
	return hasCredentialSource({
		provider: "xAI",
		configuredValue: config.xaiApiKey,
		environmentValue: process.env.XAI_API_KEY,
	});
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

/**
 * Recency, result count and domain filters are folded into the prompt rather
 * than sent as tool parameters. xAI's filter field names are not verified, and
 * an unknown field risks a 400 that costs the whole search; steering through
 * the instruction text degrades to "the model ignored it" instead.
 */
function buildInput(query: string, options: SearchOptions, tools: readonly XaiSearchTool[]): string {
	let searchInstruction: string;
	if (tools.includes("x_search") && tools.includes("web_search")) {
		searchInstruction = "Search the web and X and answer using only what the search results say.";
	} else if (tools.includes("x_search")) {
		searchInstruction = "Search X and answer using only what the X results say.";
	} else {
		searchInstruction = "Search the web and answer using only what the web results say.";
	}
	const lines = [
		searchInstruction,
		"Cite your sources inline.",
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

	const allowed: string[] = [];
	const blocked: string[] = [];
	for (const raw of options.domainFilter ?? []) {
		const domain = normalizeDomain(raw);
		if (!domain) continue;
		const target = raw.trim().startsWith("-") ? blocked : allowed;
		if (!target.includes(domain)) target.push(domain);
	}
	if (allowed.length > 0) lines.push(`Only use sources from: ${allowed.slice(0, 100).join(", ")}.`);
	if (blocked.length > 0) lines.push(`Do not use sources from: ${blocked.slice(0, 100).join(", ")}.`);

	return `${lines.join(" ")}\n\n${query}`;
}

function addResult(results: SearchResult[], seen: Set<string>, url: unknown, title: unknown, snippet = ""): void {
	if (typeof url !== "string" || url.trim().length === 0) return;
	if (seen.has(url)) return;
	seen.add(url);
	results.push({
		title: typeof title === "string" && title.trim().length > 0 ? title : url,
		url,
		snippet,
	});
}

function addSource(results: SearchResult[], seen: Set<string>, source: unknown): void {
	if (typeof source === "string") {
		addResult(results, seen, source, undefined);
		return;
	}
	if (!source || typeof source !== "object") return;
	const record = source as Record<string, unknown>;
	addResult(results, seen, record.url ?? record.source_website_url, record.title ?? record.caption);
}

function addSources(results: SearchResult[], seen: Set<string>, sources: unknown): void {
	if (!Array.isArray(sources)) return;
	for (const source of sources) addSource(results, seen, source);
}

function extractSnippetAround(text: string, start: unknown, end: unknown): string {
	if (typeof start !== "number" || typeof end !== "number" || !text) return "";
	const before = Math.max(0, start - 100);
	const after = Math.min(text.length, end + 100);
	const snippet = text.slice(before, after).replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").trim();
	return snippet.length > 300 ? `${snippet.slice(0, 297)}...` : snippet;
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

/**
 * Keep annotation sources first because they carry titles and offsets and must
 * win URL deduplication. Raw source lists from web/X search calls are next,
 * followed by xAI's response-level `citations` URL list. The latter is usually
 * strings, but object entries are tolerated when a compatible gateway adds
 * metadata.
 */
function extractSearchResults(output: unknown[], citations: unknown, numResults: number | undefined): SearchResult[] {
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
				if (!annotation || typeof annotation !== "object") continue;
				if ((annotation as { type?: unknown }).type !== "url_citation") continue;
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
		if (!item || typeof item !== "object") continue;
		const type = (item as { type?: unknown }).type;
		if (type !== "web_search_call" && type !== "x_search_call") continue;
		const value = item as { action?: unknown; sources?: unknown; results?: unknown };
		const actionSources = value.action && typeof value.action === "object"
			? (value.action as { sources?: unknown }).sources
			: undefined;
		for (const group of [actionSources, value.sources, value.results]) addSources(results, seenUrls, group);
	}

	addSources(results, seenUrls, citations);

	if (typeof numResults === "number" && Number.isFinite(numResults) && numResults > 0) {
		return results.slice(0, Math.min(Math.floor(numResults), 20));
	}
	return results;
}

export async function searchWithXai(
	query: string,
	options: SearchOptions = {},
	ctx?: ExtensionContext,
): Promise<SearchResponse> {
	const tools = resolveConfiguredSearchTools(loadConfig().xaiSearchTools);
	const auth = await resolveXaiAuth(ctx, options.signal);
	if (!auth) {
		throw new Error(
			"xAI search unavailable. Either:\n" +
			"  1. Use /login to sign in with a SuperGrok or X Premium subscription\n" +
			`  2. Create ${CONFIG_PATH} with { "xaiApiKey": "your-key" }\n` +
			"  3. Set XAI_API_KEY environment variable",
		);
	}

	const activityId = activityMonitor.logStart({ type: "api", query });
	try {
		const response = await fetch(XAI_RESPONSES_URL, {
			method: "POST",
			headers: {
				...toRequestHeaders(auth.headers),
				Authorization: `Bearer ${auth.apiKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				model: auth.model,
				input: buildInput(query, options, tools),
				tools: tools.map((type) => ({ type })),
			}),
			signal: options.signal
				? AbortSignal.any([AbortSignal.timeout(SEARCH_TIMEOUT_MS), options.signal])
				: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
		});

		if (!response.ok) {
			activityMonitor.logError(activityId, `HTTP ${response.status}`);
			const errorText = redactCredential(await response.text(), auth.apiKey);
			throw new Error(`xAI API error ${response.status}: ${errorText.slice(0, 300)}`);
		}

		let parsed: Record<string, unknown>;
		try {
			parsed = await response.json() as Record<string, unknown>;
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			throw new Error(`xAI API returned invalid JSON: ${message}`);
		}
		const output = Array.isArray(parsed.output) ? parsed.output : [];
		const answer = extractAnswer(output);
		const results = extractSearchResults(output, parsed.citations, options.numResults);

		if (!answer && results.length === 0) {
			throw new Error(`xAI ${tools.join("+")} returned no answer or sources`);
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
