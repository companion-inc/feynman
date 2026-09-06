import { parseHTML } from "linkedom";
import { activityMonitor } from "./activity.ts";
import type { SearchOptions, SearchResult, SearchResponse } from "./perplexity.ts";

const SEARCH_URL = "https://html.duckduckgo.com/html/";
const SEARCH_TIMEOUT_MS = 30_000;

interface NormalizedDomainFilters {
	allowed: string[];
	blocked: string[];
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

function normalizeDomainFilters(domainFilter: string[] | undefined): NormalizedDomainFilters {
	const filters: NormalizedDomainFilters = { allowed: [], blocked: [] };
	for (const raw of domainFilter ?? []) {
		const domain = normalizeDomain(raw);
		if (!domain) continue;
		const target = raw.trim().startsWith("-") ? filters.blocked : filters.allowed;
		if (!target.includes(domain)) target.push(domain);
	}
	return filters;
}

function hostMatchesDomain(hostname: string, domain: string): boolean {
	return hostname === domain || hostname.endsWith(`.${domain}`);
}

function matchesDomainFilters(url: string, filters: NormalizedDomainFilters): boolean {
	if (filters.allowed.length === 0 && filters.blocked.length === 0) return true;
	const hostname = new URL(url).hostname.toLowerCase();
	if (filters.allowed.length > 0 && !filters.allowed.some(domain => hostMatchesDomain(hostname, domain))) return false;
	return !filters.blocked.some(domain => hostMatchesDomain(hostname, domain));
}

function decodeResultUrl(href: string): string | null {
	try {
		const link = new URL(href, SEARCH_URL);
		const destination = link.searchParams.get("uddg") ?? link.href;
		const url = new URL(destination);
		return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
	} catch {
		return null;
	}
}

export function isDuckDuckGoAvailable(): boolean {
	return true;
}

export async function searchWithDuckDuckGo(query: string, options: SearchOptions = {}): Promise<SearchResponse> {
	const url = new URL(SEARCH_URL);
	url.searchParams.set("q", query);
	const activityId = activityMonitor.logStart({ type: "api", query });

	try {
		const response = await fetch(url, {
			method: "GET",
			headers: {
				Accept: "text/html",
				"User-Agent": "Mozilla/5.0 (compatible; pi-web-access/1.0; +https://github.com/nicobailon/pi-web-access)",
			},
			signal: options.signal
				? AbortSignal.any([AbortSignal.timeout(SEARCH_TIMEOUT_MS), options.signal])
				: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
		});
		if (!response.ok) {
			const body = await response.text();
			throw new Error(`DuckDuckGo search error ${response.status}: ${body.slice(0, 300)}`);
		}

		const { document } = parseHTML(await response.text());
		const filters = normalizeDomainFilters(options.domainFilter);
		const results: SearchResult[] = [];
		let parseableResults = 0;
		for (const container of document.querySelectorAll(".result")) {
			if (container.classList.contains("result--ad")) continue;
			const anchor = container.querySelector(".result__a");
			const title = anchor?.textContent?.trim() ?? "";
			const href = anchor?.getAttribute("href")?.trim() ?? "";
			const resultUrl = href ? decodeResultUrl(href) : null;
			if (!title || !resultUrl) continue;
			parseableResults++;
			if (!matchesDomainFilters(resultUrl, filters)) continue;
			const snippet = container.querySelector(".result__snippet")?.textContent?.trim() ?? "";
			results.push({ title, url: resultUrl, snippet });
			if (results.length >= normalizeCount(options.numResults)) break;
		}
		if (parseableResults === 0) {
			throw new Error("DuckDuckGo returned no parseable results (invalid response)");
		}

		activityMonitor.logComplete(activityId, response.status);
		const answer = results.map(result => result.snippet
			? `${result.snippet}\nSource: ${result.title} (${result.url})`
			: `Source: ${result.title} (${result.url})`).join("\n\n");
		return { answer, results };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		if (message.toLowerCase().includes("abort")) activityMonitor.logComplete(activityId, 0);
		else activityMonitor.logError(activityId, message);
		throw err;
	}
}
