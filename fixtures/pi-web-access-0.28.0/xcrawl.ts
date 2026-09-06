import { existsSync, readFileSync } from "node:fs";
import { activityMonitor } from "./activity.ts";
import type { SearchOptions, SearchResponse } from "./perplexity.ts";
import { hasCredentialSource, redactCredential, resolveCredential } from "./credential-source.ts";
import { getWebSearchConfigPath } from "./utils.ts";

const XCRAWL_API_URL = "https://run.xcrawl.com/v1/serp";
const CONFIG_PATH = getWebSearchConfigPath();
// The SERP API is usually fast (a few seconds, cached responses are quicker),
// but leave generous headroom before treating a slow job as a provider failure.
const SEARCH_TIMEOUT_MS = 60_000;

interface WebSearchConfig {
	xcrawlApiKey?: unknown;
}

interface XCrawlSerpResult {
	title?: unknown;
	link?: unknown;
	snippet?: unknown;
}

interface XCrawlSerpResponse {
	search_metadata?: unknown;
	organic_results?: unknown;
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
		provider: "XCrawl",
		configuredValue: loadConfig().xcrawlApiKey,
		environmentValue: process.env.XCRAWL_API_KEY,
		signal,
	});
}

export function isXcrawlAvailable(): boolean {
	return hasCredentialSource({ provider: "XCrawl", configuredValue: loadConfig().xcrawlApiKey, environmentValue: process.env.XCRAWL_API_KEY });
}

function errorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

function invalidResponse(message: string): Error {
	return new Error(`XCrawl API returned invalid response: ${message}`);
}

function normalizeCount(value: number | undefined): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return 5;
	return Math.max(1, Math.min(Math.floor(value), 20));
}

function hostnameOf(url: string): string {
	try {
		return new URL(url).hostname.toLowerCase();
	} catch {
		return "";
	}
}

// XCrawl's Google SERP results can carry links relative to the API origin
// (e.g. "/goto?url=..." redirect stubs) instead of the documented absolute
// URLs. Resolve those against the API origin so callers always receive a
// well-formed absolute URL; absolute http(s) links pass through unchanged.
function absolutizeLink(link: string): string {
	if (/^https?:\/\//i.test(link)) return link;
	try {
		return new URL(link, XCRAWL_API_URL).href;
	} catch {
		return link;
	}
}

// Normalize a shared domainFilter entry the same way Valyu does before
// matching: trim, lowercase, strip URL/paths/ports, validate the shape.
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

// XCrawl's SERP API has no server-side domain filter, so apply the shared
// include/exclude domainFilter locally instead of returning off-domain results.
function applyDomainFilter(results: SearchResponse["results"], domainFilter: NonNullable<SearchOptions["domainFilter"]>): SearchResponse["results"] {
	const includes: string[] = [];
	const excludes: string[] = [];
	for (const raw of domainFilter) {
		const normalized = normalizeDomain(raw);
		if (!normalized) continue;
		if (raw.trim().startsWith("-")) excludes.push(normalized);
		else includes.push(normalized);
	}
	if (!includes.length && !excludes.length) return results;
	return results.filter((result) => {
		const host = hostnameOf(result.url);
		if (!host) return false;
		const matches = (domain: string) => host === domain || host.endsWith(`.${domain}`);
		if (excludes.some(matches)) return false;
		if (includes.length && !includes.some(matches)) return false;
		return true;
	});
}

function parseResponse(value: unknown): SearchResponse["results"] {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw invalidResponse("expected an object envelope");
	}
	const envelope = value as XCrawlSerpResponse;
	const metadata = envelope.search_metadata;
	if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
		throw invalidResponse("expected search_metadata object");
	}
	const status = (metadata as Record<string, unknown>).status;
	if (status !== undefined && status !== "completed") {
		throw invalidResponse(`expected search_metadata.status \"completed\", got ${JSON.stringify(status)}`);
	}
	if (!Array.isArray(envelope.organic_results)) throw invalidResponse("expected organic_results array");

	const results: SearchResponse["results"] = [];
	for (const [index, value] of (envelope.organic_results as unknown[]).entries()) {
		if (!value || typeof value !== "object" || Array.isArray(value)) {
			throw invalidResponse(`expected organic_results[${index}] object`);
		}
		const result = value as XCrawlSerpResult;
		const { title, link, snippet } = result;
		if (typeof link !== "string" || !link.trim()) throw invalidResponse(`expected organic_results[${index}].link to be a non-empty string`);
		if (title !== null && title !== undefined && typeof title !== "string") {
			throw invalidResponse(`expected organic_results[${index}].title to be a string or null`);
		}
		if (snippet !== undefined && snippet !== null && typeof snippet !== "string") {
			throw invalidResponse(`expected organic_results[${index}].snippet to be a string or null`);
		}
		const resolved = absolutizeLink(link.trim());
		results.push({
			title: typeof title === "string" && title.trim().length > 0 ? title : resolved,
			url: resolved,
			snippet: typeof snippet === "string" ? snippet : "",
		});
	}

	return results;
}

function buildAnswer(results: SearchResponse["results"]): string {
	return results
		.map((result) => result.snippet
			? `${result.snippet}\nSource: ${result.title} (${result.url})`
			: `Source: ${result.title} (${result.url})`)
		.join("\n\n");
}

export async function searchWithXCrawl(query: string, options: SearchOptions = {}): Promise<SearchResponse> {
	const apiKey = await getApiKey(options.signal);
	const numResults = normalizeCount(options.numResults);
	if (!apiKey) {
		throw new Error(
			"XCrawl search requires an API key. Set xcrawlApiKey in " + CONFIG_PATH +
			" or export XCRAWL_API_KEY. Get one at https://dash.xcrawl.com/",
		);
	}
	const body = { engine: "google_search", q: query };
	const activityId = activityMonitor.logStart({ type: "api", query });
	// Distinguishing caller cancellation from a provider-side timeout lets the
	// timeout surface as a retriable failure instead of looking like an abort.
	const timeoutSignal = AbortSignal.timeout(SEARCH_TIMEOUT_MS);
	let response: Response;

	try {
		response = await fetch(XCRAWL_API_URL, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(body),
			signal: options.signal
				? AbortSignal.any([timeoutSignal, options.signal])
				: timeoutSignal,
		});
	} catch (err) {
		const message = errorMessage(err);
		if (options.signal?.aborted) {
			activityMonitor.logComplete(activityId, 0);
			throw new Error("Aborted");
		}
		// AbortSignal.timeout rejects with a TimeoutError; treat either that
		// shape or our own fired timer as a retriable provider-side timeout so
		// routing fallback still applies.
		const providerTimeout = timeoutSignal.aborted || (err instanceof Error && err.name === "TimeoutError");
		let outgoing: Error;
		if (providerTimeout) {
			outgoing = new Error(`XCrawl search request timed out after ${Math.round(SEARCH_TIMEOUT_MS / 1000)}s`);
		} else {
			const redactedMessage = redactCredential(message, apiKey);
			outgoing = redactedMessage === message && err instanceof Error ? err : new Error(redactedMessage);
			if (err instanceof Error && outgoing.name === "Error") outgoing.name = err.name;
		}
		activityMonitor.logError(activityId, redactCredential(errorMessage(outgoing), apiKey));
		throw outgoing;
	}

	if (!response.ok) {
		activityMonitor.logComplete(activityId, response.status);
		const errorText = redactCredential(await response.text(), apiKey);
		let detail = errorText.slice(0, 300);
		try {
			const parsed = JSON.parse(errorText) as { message?: unknown; error?: unknown };
			if (typeof parsed.message === "string") detail = parsed.message.slice(0, 300);
			else if (typeof parsed.error === "string") detail = parsed.error.slice(0, 300);
		} catch {
			// keep raw text slice
		}
		throw new Error(`XCrawl API error (${response.status}): ${detail}`);
	}
	activityMonitor.logComplete(activityId, response.status);

	let payload: unknown;
	try {
		payload = await response.json();
	} catch (err) {
		throw invalidResponse(`response body is not valid JSON: ${errorMessage(err)}`);
	}
	const results = parseResponse(payload);
	const filtered = (options.domainFilter?.length ? applyDomainFilter(results, options.domainFilter) : results).slice(0, numResults);

	return {
		answer: buildAnswer(filtered),
		results: filtered,
	};
}
