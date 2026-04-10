// Vendor override for pi-web-access — last verified against pi-web-access@0.10.6.
// If this file fails to load after a pi-web-access upgrade, check that all
// imports below still exist in the installed package version.
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Box, Text, truncateToWidth } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import { fetchAllContent, type ExtractedContent } from "./extract.js";
import { clearCloneCache } from "./github-extract.js";
import { isExaAvailable } from "./exa.js";
import { search, type SearchProvider } from "./gemini-search.js";
import type { SearchResult } from "./perplexity.js";
import { formatSeconds } from "./utils.js";
import {
	clearResults,
	deleteResult,
	generateId,
	getAllResults,
	getResult,
	restoreFromSession,
	storeResult,
	type QueryResultData,
	type StoredSearchData,
} from "./storage.js";
import { activityMonitor, type ActivityEntry } from "./activity.js";
import { startCuratorServer, type CuratorServerHandle } from "./curator-server.js";
import { randomUUID } from "node:crypto";
import { platform, homedir } from "node:os";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { isPerplexityAvailable } from "./perplexity.js";
import { isGeminiApiAvailable } from "./gemini-api.js";
import { getActiveGoogleEmail, isGeminiWebAvailable } from "./gemini-web.js";

const WEB_SEARCH_CONFIG_PATH = join(homedir(), ".pi", "web-search.json");
const DEFAULT_CURATE_WINDOW = 10;

interface WebSearchConfig {
	provider?: string;
	curateWindow?: number;
	autoFilter?: boolean | {
		enabled?: boolean;
		model?: string;
		prompt?: string;
	};
	shortcuts?: {
		curate?: string;
		activity?: string;
	};
}

function loadConfig(): WebSearchConfig {
	try {
		if (existsSync(WEB_SEARCH_CONFIG_PATH)) {
			return JSON.parse(readFileSync(WEB_SEARCH_CONFIG_PATH, "utf-8"));
		}
	} catch {}
	return {};
}

function saveConfig(updates: Partial<WebSearchConfig>): void {
	try {
		let config: Record<string, unknown> = {};
		if (existsSync(WEB_SEARCH_CONFIG_PATH)) {
			try { config = JSON.parse(readFileSync(WEB_SEARCH_CONFIG_PATH, "utf-8")); } catch {}
		}
		Object.assign(config, updates);
		const dir = join(homedir(), ".pi");
		if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
		writeFileSync(WEB_SEARCH_CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
	} catch {}
}

const DEFAULT_SHORTCUTS = { curate: "ctrl+shift+s", activity: "ctrl+shift+w" };

function formatShortcut(key: string): string {
	return key.split("+").map(p => p[0].toUpperCase() + p.slice(1)).join("+");
}

function resolveProvider(
	requested: string | undefined,
	available: { perplexity: boolean; exa: boolean; gemini: boolean },
): string {
	const provider = requested || loadConfig().provider || "auto";
	if (provider === "auto" || provider === "") {
		if (available.perplexity) return "perplexity";
		if (available.exa) return "exa";
		if (available.gemini) return "gemini";
		return "perplexity";
	}
	if (provider === "perplexity" && !available.perplexity) {
		if (available.exa) return "exa";
		return available.gemini ? "gemini" : "perplexity";
	}
	if (provider === "exa" && !available.exa) {
		if (available.perplexity) return "perplexity";
		return available.gemini ? "gemini" : "exa";
	}
	if (provider === "gemini" && !available.gemini) {
		if (available.perplexity) return "perplexity";
		return available.exa ? "exa" : "gemini";
	}
	return provider;
}

const pendingFetches = new Map<string, AbortController>();
let sessionActive = false;
let widgetVisible = false;
let widgetUnsubscribe: (() => void) | null = null;
let activeCurator: CuratorServerHandle | null = null;

interface PendingCurate {
	phase: "searching" | "curate-window" | "curating";
	searchResults: Map<number, QueryResultData>;
	allUrls: string[];
	queryList: string[];
	includeContent: boolean;
	numResults?: number;
	recencyFilter?: "day" | "week" | "month" | "year";
	domainFilter?: string[];
	availableProviders: { perplexity: boolean; exa: boolean; gemini: boolean };
	defaultProvider: string;
	onUpdate: ((update: { content: Array<{ type: string; text: string }>; details?: Record<string, unknown> }) => void) | undefined;
	signal: AbortSignal | undefined;
	timer?: ReturnType<typeof setTimeout>;
	countdownInterval?: ReturnType<typeof setInterval>;
	finish: (value: unknown) => void;
	cancel: () => void;
	browserPromise?: Promise<void>;
}

let pendingCurate: PendingCurate | null = null;

function cancelPendingCurate(): void {
	pendingCurate?.cancel();
}

const MAX_INLINE_CONTENT = 30000; // Content returned directly to agent

function stripThumbnails(results: ExtractedContent[]): ExtractedContent[] {
	return results.map(({ thumbnail, frames, ...rest }) => rest);
}

function formatSearchSummary(results: SearchResult[], answer: string): string {
	let output = answer ? `${answer}\n\n---\n\n**Sources:**\n` : "";
	output += results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}`).join("\n\n");
	return output;
}

function formatFullResults(queryData: QueryResultData): string {
	let output = `## Results for: "${queryData.query}"\n\n`;
	if (queryData.answer) {
		output += `${queryData.answer}\n\n---\n\n`;
	}
	for (const r of queryData.results) {
		output += `### ${r.title}\n${r.url}\n\n`;
	}
	return output;
}

function abortPendingFetches(): void {
	for (const controller of pendingFetches.values()) {
		controller.abort();
	}
	pendingFetches.clear();
}

function closeCurator(): void {
	cancelPendingCurate();
	if (activeCurator) {
		activeCurator.close();
		activeCurator = null;
	}
}

async function openInBrowser(pi: ExtensionAPI, url: string): Promise<void> {
	const plat = platform();
	const result = plat === "darwin"
		? await pi.exec("open", [url])
		: plat === "win32"
			? await pi.exec("cmd", ["/c", "start", "", url])
			: await pi.exec("xdg-open", [url]);
	if (result.code !== 0) {
		throw new Error(result.stderr || `Failed to open browser (exit code ${result.code})`);
	}
}

function extractDomain(url: string): string {
	try { return new URL(url).hostname; }
	catch { return url; }
}

function updateWidget(ctx: ExtensionContext): void {
	const theme = ctx.ui.theme;
	const entries = activityMonitor.getEntries();
	const lines: string[] = [];

	lines.push(theme.fg("accent", "─── Web Search Activity " + "─".repeat(36)));

	if (entries.length === 0) {
		lines.push(theme.fg("muted", "  No activity yet"));
	} else {
		for (const e of entries) {
			lines.push("  " + formatEntryLine(e, theme));
		}
	}

	lines.push(theme.fg("accent", "─".repeat(60)));

	const rateInfo = activityMonitor.getRateLimitInfo();
	const resetMs = rateInfo.oldestTimestamp ? Math.max(0, rateInfo.oldestTimestamp + rateInfo.windowMs - Date.now()) : 0;
	const resetSec = Math.ceil(resetMs / 1000);
	lines.push(
		theme.fg("muted", `Rate: ${rateInfo.used}/${rateInfo.max}`) +
			(resetMs > 0 ? theme.fg("dim", ` (resets in ${resetSec}s)`) : ""),
	);

	ctx.ui.setWidget("web-activity", new Text(lines.join("\n"), 0, 0));
}

function formatEntryLine(
	entry: ActivityEntry,
	theme: { fg: (color: string, text: string) => string },
): string {
	const typeStr = entry.type === "api" ? "API" : "GET";
	const target =
		entry.type === "api"
			? `"${truncateToWidth(entry.query || "", 28, "")}"`
			: truncateToWidth(entry.url?.replace(/^https?:\/\//, "") || "", 30, "");

	const duration = entry.endTime
		? `${((entry.endTime - entry.startTime) / 1000).toFixed(1)}s`
		: `${((Date.now() - entry.startTime) / 1000).toFixed(1)}s`;

	let statusStr: string;
	let indicator: string;
	if (entry.error) {
		statusStr = "err";
		indicator = theme.fg("error", "✗");
	} else if (entry.status === null) {
		statusStr = "...";
		indicator = theme.fg("warning", "⋯");
	} else if (entry.status === 0) {
		statusStr = "abort";
		indicator = theme.fg("muted", "○");
	} else {
		statusStr = String(entry.status);
		indicator = entry.status >= 200 && entry.status < 300 ? theme.fg("success", "✓") : theme.fg("error", "✗");
	}

	return `${typeStr.padEnd(4)} ${target.padEnd(32)} ${statusStr.padStart(5)} ${duration.padStart(5)} ${indicator}`;
}

function handleSessionChange(ctx: ExtensionContext): void {
	abortPendingFetches();
	closeCurator();
	clearCloneCache();
	sessionActive = true;
	restoreFromSession(ctx);
	// Unsubscribe before clear() to avoid callback with stale ctx
	widgetUnsubscribe?.();
	widgetUnsubscribe = null;
	activityMonitor.clear();
	if (widgetVisible) {
		// Re-subscribe with new ctx
		widgetUnsubscribe = activityMonitor.onUpdate(() => updateWidget(ctx));
		updateWidget(ctx);
	}
}

export default function (pi: ExtensionAPI) {
	const initConfig = loadConfig();
	const curateKey = initConfig.shortcuts?.curate || DEFAULT_SHORTCUTS.curate;
	const activityKey = initConfig.shortcuts?.activity || DEFAULT_SHORTCUTS.activity;
	const curateLabel = formatShortcut(curateKey);

	function startBackgroundFetch(urls: string[]): string | null {
		if (urls.length === 0) return null;
		const fetchId = generateId();
		const controller = new AbortController();
		pendingFetches.set(fetchId, controller);
		fetchAllContent(urls, controller.signal)
			.then((fetched) => {
				if (!sessionActive || !pendingFetches.has(fetchId)) return;
				const data: StoredSearchData = {
					id: fetchId,
					type: "fetch",
					timestamp: Date.now(),
					urls: stripThumbnails(fetched),
				};
				storeResult(fetchId, data);
				pi.appendEntry("web-search-results", data);
				const ok = fetched.filter(f => !f.error).length;
				pi.sendMessage(
					{
						customType: "web-search-content-ready",
						content: `Content fetched for ${ok}/${fetched.length} URLs [${fetchId}]. Full page content now available.`,
						display: true,
					},
					{ triggerTurn: true },
				);
			})
			.catch((err) => {
				if (!sessionActive || !pendingFetches.has(fetchId)) return;
				const message = err instanceof Error ? err.message : String(err);
				const isAbort = err.name === "AbortError" || message.toLowerCase().includes("abort");
				if (!isAbort) {
					pi.sendMessage(
						{
							customType: "web-search-error",
							content: `Content fetch failed [${fetchId}]: ${message}`,
							display: true,
						},
						{ triggerTurn: false },
					);
				}
			})
			.finally(() => { pendingFetches.delete(fetchId); });
		return fetchId;
	}

	function storeAndPublishSearch(results: QueryResultData[]): string {
		const id = generateId();
		const data: StoredSearchData = {
			id, type: "search", timestamp: Date.now(), queries: results,
		};
		storeResult(id, data);
		pi.appendEntry("web-search-results", data);
		return id;
	}

	interface SearchReturnOptions {
		queryList: string[];
		results: QueryResultData[];
		urls: string[];
		includeContent: boolean;
		curated?: boolean;
		curatedFrom?: number;
	}

	function buildSearchReturn(opts: SearchReturnOptions) {
		const sc = opts.results.filter(r => !r.error).length;
		const tr = opts.results.reduce((sum, r) => sum + r.results.length, 0);

		let output = "";
		if (opts.curated) {
			output += "[These results were manually curated by the user in the browser. Use them as-is — do not re-search or discard.]\n\n";
		}
		for (const { query, answer, results, error } of opts.results) {
			if (opts.queryList.length > 1) output += `## Query: "${query}"\n\n`;
			if (error) output += `Error: ${error}\n\n`;
			else if (results.length === 0) output += "No results found.\n\n";
			else output += formatSearchSummary(results, answer) + "\n\n";
		}

		const fetchId = opts.includeContent ? startBackgroundFetch(opts.urls) : null;
		if (fetchId) output += `---\nContent fetching in background [${fetchId}]. Will notify when ready.`;

		const searchId = storeAndPublishSearch(opts.results);

		return {
			content: [{ type: "text", text: output.trim() }],
			details: {
				queries: opts.queryList,
				queryCount: opts.queryList.length,
				successfulQueries: sc,
				totalResults: tr,
				includeContent: opts.includeContent,
				fetchId,
				fetchUrls: fetchId ? opts.urls : undefined,
				searchId,
				...(opts.curated ? {
					curated: true,
					curatedFrom: opts.curatedFrom,
					curatedQueries: opts.results.map(r => ({
						query: r.query,
						answer: r.answer || null,
						sources: r.results.map(s => ({ title: s.title, url: s.url })),
						error: r.error,
					})),
				} : {}),
			},
		};
	}

	function filterByQueryIndices(selectedQueryIndices: number[], results: Map<number, QueryResultData>) {
		const filteredResults: QueryResultData[] = [];
		const filteredUrls: string[] = [];
		for (const qi of selectedQueryIndices) {
			const r = results.get(qi);
			if (r) {
				filteredResults.push(r);
				for (const res of r.results) {
					if (!filteredUrls.includes(res.url)) filteredUrls.push(res.url);
				}
			}
		}
		return { results: filteredResults, urls: filteredUrls };
	}

	async function openCuratorBrowser(pc: PendingCurate, searchesComplete = true): Promise<void> {
		try {
			if (pc.timer) clearTimeout(pc.timer);
			if (pc.countdownInterval) clearInterval(pc.countdownInterval);
			pc.phase = "curating";

			const searchAbort = new AbortController();
			const addSearchSignal = pc.signal
				? AbortSignal.any([pc.signal, searchAbort.signal])
				: searchAbort.signal;

			const sessionToken = randomUUID();
			const handle = await startCuratorServer(
				{
					queries: pc.queryList,
					sessionToken,
					timeout: 120,
					availableProviders: pc.availableProviders,
					defaultProvider: pc.defaultProvider,
				},
				{
					onSubmit(selectedQueryIndices) {
						searchAbort.abort();
						const filtered = filterByQueryIndices(selectedQueryIndices, pc.searchResults);
						pc.finish(buildSearchReturn({
							queryList: filtered.results.map(r => r.query),
							results: filtered.results,
							urls: filtered.urls,
							includeContent: pc.includeContent,
							curated: true,
							curatedFrom: pc.searchResults.size,
						}));
						closeCurator();
					},
					onCancel() {
						searchAbort.abort();
						pc.cancel();
						closeCurator();
					},
					onProviderChange(provider) {
						saveConfig({ provider });
					},
					async onAddSearch(query, queryIndex) {
						const { answer, results } = await search(query, {
							provider: pc.defaultProvider as SearchProvider | undefined,
							numResults: pc.numResults,
							recencyFilter: pc.recencyFilter,
							domainFilter: pc.domainFilter,
							signal: addSearchSignal,
						});
						pc.searchResults.set(queryIndex, { query, answer, results, error: null });
						for (const r of results) {
							if (!pc.allUrls.includes(r.url)) pc.allUrls.push(r.url);
						}
						return {
							answer,
							results: results.map(r => ({ title: r.title, url: r.url, domain: extractDomain(r.url) })),
						};
					},
				},
			);

			if (pendingCurate !== pc) {
				handle.close();
				return;
			}

			activeCurator = handle;

			for (const [qi, data] of pc.searchResults) {
				if (data.error) {
					handle.pushError(qi, data.error);
				} else {
					handle.pushResult(qi, {
						answer: data.answer,
						results: data.results.map(r => ({ title: r.title, url: r.url, domain: extractDomain(r.url) })),
					});
				}
			}
			if (searchesComplete) handle.searchesDone();

			pc.onUpdate?.({
				content: [{ type: "text", text: searchesComplete ? "Waiting for user to curate search results in browser..." : "Searches streaming to browser..." }],
				details: { phase: "curating", progress: searchesComplete ? 1 : 0.5 },
			});

			await openInBrowser(pi, handle.url);
		} catch {
			closeCurator();
		}
	}

	pi.registerShortcut(curateKey as any, {
		description: "Review search results in browser",
		handler: async (ctx) => {
			if (!pendingCurate) return;

			if (pendingCurate.phase === "searching") {
				pendingCurate.browserPromise = openCuratorBrowser(pendingCurate, false);
				ctx.ui.notify("Opening curator — remaining searches will stream in", "info");
				return;
			}

			if (pendingCurate.phase === "curate-window") {
				await openCuratorBrowser(pendingCurate);
				return;
			}
		},
	});

	pi.registerShortcut(activityKey as any, {
		description: "Toggle web search activity",
		handler: async (ctx) => {
			widgetVisible = !widgetVisible;
			if (widgetVisible) {
				widgetUnsubscribe = activityMonitor.onUpdate(() => updateWidget(ctx));
				updateWidget(ctx);
			} else {
				widgetUnsubscribe?.();
				widgetUnsubscribe = null;
				ctx.ui.setWidget("web-activity", null);
			}
		},
	});

	pi.on("session_start", async (_event, ctx) => handleSessionChange(ctx));
	pi.on("session_switch", async (_event, ctx) => handleSessionChange(ctx));
	pi.on("session_fork", async (_event, ctx) => handleSessionChange(ctx));
	pi.on("session_tree", async (_event, ctx) => handleSessionChange(ctx));

	pi.on("session_shutdown", () => {
		sessionActive = false;
		abortPendingFetches();
		closeCurator();
		clearCloneCache();
		clearResults();
		// Unsubscribe before clear() to avoid callback with stale ctx
		widgetUnsubscribe?.();
		widgetUnsubscribe = null;
		activityMonitor.clear();
		widgetVisible = false;
	});

	pi.registerTool({
		name: "web_search",
		label: "Web Search",
		description:
			`Search the web using Perplexity, Exa, or Gemini. Returns an answer plus cited sources. For comprehensive research, prefer queries (plural) with 2-4 varied angles over a single query — each query gets its own answer, so varying phrasing and scope gives much broader coverage. When includeContent is true, full page content is fetched in the background. Multi-query searches include a brief review window where the user can press ${curateLabel} to curate results in the browser before they're sent. Set curate to false to skip this. Provider auto-selects: Perplexity if configured, else Exa, else Gemini API, else Gemini Web.`,
		parameters: Type.Object({
			query: Type.Optional(Type.String({ description: "Single search query. For research tasks, prefer 'queries' with multiple varied angles instead." })),
			queries: Type.Optional(Type.Array(Type.String(), { description: "Multiple queries searched in sequence, each returning its own synthesized answer. Prefer this for research — vary phrasing, scope, and angle across 2-4 queries to maximize coverage. Good: ['React vs Vue performance benchmarks 2026', 'React vs Vue developer experience comparison', 'React ecosystem size vs Vue ecosystem']. Bad: ['React vs Vue', 'React vs Vue comparison', 'React vs Vue review'] (too similar, redundant results)." })),
			numResults: Type.Optional(Type.Number({ description: "Results per query (default: 5, max: 20)" })),
			includeContent: Type.Optional(Type.Boolean({ description: "Fetch full page content (async)" })),
			recencyFilter: Type.Optional(
				StringEnum(["day", "week", "month", "year"], { description: "Filter by recency" }),
			),
			domainFilter: Type.Optional(Type.Array(Type.String(), { description: "Limit to domains (prefix with - to exclude)" })),
			provider: Type.Optional(
				StringEnum(["auto", "perplexity", "exa", "gemini"], { description: "Search provider (default: auto)" }),
			),
			curate: Type.Optional(Type.Boolean({
				description: `Hold results for review after searching. The user can press ${curateLabel} to open an interactive review page in the browser, or wait for the countdown to auto-send all results. Enabled by default for multi-query searches. Set to false to skip the review window.`,
			})),
			context: Type.Optional(Type.String({
				description: "Brief description of your current task or goal. Improves auto-filter relevance for multi-query searches.",
			})),
		}),

		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const queryList = params.queries ?? (params.query ? [params.query] : []);
			const isMultiQuery = queryList.length > 1;
			const shouldCurate = params.curate !== false && ctx?.hasUI !== false;

			if (queryList.length === 0) {
				return {
					content: [{ type: "text", text: "Error: No query provided. Use 'query' or 'queries' parameter." }],
					details: { error: "No query provided" },
				};
			}

			if (shouldCurate) {
				closeCurator();

				const { promise, resolve: resolvePromise } = Promise.withResolvers<unknown>();
				const includeContent = params.includeContent ?? false;
				const searchResults = new Map<number, QueryResultData>();
				const allUrls: string[] = [];
				let cancelled = false;

				const pplxAvail = isPerplexityAvailable();
				const exaAvail = isExaAvailable();
				const geminiApiAvail = isGeminiApiAvailable();
				const geminiWebAvail = await isGeminiWebAvailable();
				const availableProviders = {
					perplexity: pplxAvail,
					exa: exaAvail,
					gemini: geminiApiAvail || !!geminiWebAvail,
				};
				const defaultProvider = resolveProvider(params.provider, availableProviders);
				const curateConfig = loadConfig();
				const curateWindow = curateConfig.curateWindow ?? DEFAULT_CURATE_WINDOW;

				const pc: PendingCurate = {
					phase: "searching",
					searchResults,
					allUrls,
					queryList,
					includeContent,
					numResults: params.numResults,
					recencyFilter: params.recencyFilter,
					domainFilter: params.domainFilter,
					availableProviders,
					defaultProvider,
					onUpdate: onUpdate as PendingCurate["onUpdate"],
					signal,
					finish: () => {},
					cancel: () => {},
				};

				const finish = (value: unknown) => {
					if (cancelled) return;
					cancelled = true;
					if (pc.timer) clearTimeout(pc.timer);
					if (pc.countdownInterval) clearInterval(pc.countdownInterval);
					signal?.removeEventListener("abort", onAbort);
					pendingCurate = null;
					resolvePromise(value);
				};

				const cancel = () => {
					const results = [...searchResults.values()];
					finish(buildSearchReturn({
						queryList: results.map(r => r.query),
						results,
						urls: allUrls,
						includeContent,
					}));
				};

				pc.finish = finish;
				pc.cancel = cancel;

				const onAbort = () => closeCurator();
				pendingCurate = pc;
				signal?.addEventListener("abort", onAbort, { once: true });

				for (let qi = 0; qi < queryList.length; qi++) {
					if (signal?.aborted || cancelled) break;
					onUpdate?.({
						content: [{ type: "text", text: `Searching ${qi + 1}/${queryList.length}: "${queryList[qi]}"...` }],
						details: { phase: "searching", progress: qi / queryList.length, currentQuery: queryList[qi] },
					});
					try {
						const { answer, results } = await search(queryList[qi], {
							provider: defaultProvider as SearchProvider | undefined,
							numResults: params.numResults,
							recencyFilter: params.recencyFilter,
							domainFilter: params.domainFilter,
							signal,
						});
						searchResults.set(qi, { query: queryList[qi], answer, results, error: null });
						for (const r of results) {
							if (!allUrls.includes(r.url)) allUrls.push(r.url);
						}
						if (activeCurator) {
							activeCurator.pushResult(qi, {
								answer,
								results: results.map(r => ({ title: r.title, url: r.url, domain: extractDomain(r.url) })),
							});
						}
					} catch (err) {
						if (signal?.aborted || cancelled) break;
						const message = err instanceof Error ? err.message : String(err);
						searchResults.set(qi, { query: queryList[qi], answer: "", results: [], error: message });
						if (activeCurator) {
							activeCurator.pushError(qi, message);
						}
					}
				}

				if (signal?.aborted || cancelled) {
					cancel();
					return promise;
				}

				if (pc.browserPromise) {
					await pc.browserPromise;
					if (activeCurator && !cancelled) {
						activeCurator.searchesDone();
						pc.onUpdate?.({
							content: [{ type: "text", text: "All searches complete — waiting for user to curate in browser..." }],
							details: { phase: "curating", progress: 1 },
						});
					}
				} else {
					// No browser curator open and no condensation path — pass results
					// directly to the model. Aligns with pi-web-access@0.10.4+ behaviour
					// where the auto-condense/countdown flow was removed upstream.
					cancel();
				}

				return promise;
			}

			const searchResults: QueryResultData[] = [];
			const allUrls: string[] = [];
			const resolvedProvider = params.provider || loadConfig().provider || undefined;

			for (let i = 0; i < queryList.length; i++) {
				const query = queryList[i];

				onUpdate?.({
					content: [{ type: "text", text: `Searching ${i + 1}/${queryList.length}: "${query}"...` }],
					details: { phase: "search", progress: i / queryList.length, currentQuery: query },
				});

				try {
					const { answer, results } = await search(query, {
						provider: resolvedProvider as SearchProvider | undefined,
						numResults: params.numResults,
						recencyFilter: params.recencyFilter,
						domainFilter: params.domainFilter,
						signal,
					});

					searchResults.push({ query, answer, results, error: null });
					for (const r of results) {
						if (!allUrls.includes(r.url)) {
							allUrls.push(r.url);
						}
					}
				} catch (err) {
					const message = err instanceof Error ? err.message : String(err);
					searchResults.push({ query, answer: "", results: [], error: message });
				}
			}

			return buildSearchReturn({
				queryList,
				results: searchResults,
				urls: allUrls,
				includeContent: params.includeContent ?? false,
			});
		},

		renderCall(args, theme) {
			const { query, queries } = args as { query?: string; queries?: string[] };
			const queryList = queries ?? (query ? [query] : []);
			if (queryList.length === 0) {
				return new Text(theme.fg("toolTitle", theme.bold("search ")) + theme.fg("error", "(no query)"), 0, 0);
			}
			if (queryList.length === 1) {
				const q = queryList[0];
				const display = q.length > 60 ? q.slice(0, 57) + "..." : q;
				return new Text(theme.fg("toolTitle", theme.bold("search ")) + theme.fg("accent", `"${display}"`), 0, 0);
			}
			const lines = [theme.fg("toolTitle", theme.bold("search ")) + theme.fg("accent", `${queryList.length} queries`)];
			for (const q of queryList.slice(0, 5)) {
				const display = q.length > 50 ? q.slice(0, 47) + "..." : q;
				lines.push(theme.fg("muted", `  "${display}"`));
			}
			if (queryList.length > 5) {
				lines.push(theme.fg("muted", `  ... and ${queryList.length - 5} more`));
			}
			return new Text(lines.join("\n"), 0, 0);
		},

		renderResult(result, { expanded, isPartial }, theme) {
			type QueryDetail = {
				query: string;
				answer: string | null;
				sources: Array<{ title: string; url: string }>;
				error: string | null;
			};
			const details = result.details as {
				queryCount?: number;
				successfulQueries?: number;
				totalResults?: number;
				error?: string;
				fetchId?: string;
				fetchUrls?: string[];
				phase?: string;
				progress?: number;
				currentQuery?: string;
				curated?: boolean;
				curatedFrom?: number;
				curatedQueries?: QueryDetail[];
				searchCount?: number;
				sourceCount?: number;
				remaining?: number;
				condensing?: boolean;
				condensed?: boolean;
				condensedFrom?: number;
			};

			if (isPartial) {
				if (details?.phase === "curate-window") {
					const count = details?.searchCount ?? 0;
					const sources = details?.sourceCount ?? 0;
					const remaining = details?.remaining ?? 0;

					if (details?.condensed) {
						return new Text(
							theme.fg("success", `${count} searches condensed`) +
							theme.fg("accent", ` \u00b7 ${curateLabel} for all`) +
							theme.fg("muted", ` \u00b7 sending in ${remaining}s`),
							0, 0,
						);
					}

					let line = theme.fg("success", `${count} searches (${sources} sources)`);
					if (details?.condensing) {
						line += theme.fg("dim", " \u00b7 condensing...");
					}
					line += theme.fg("accent", ` \u00b7 ${curateLabel} to review`) +
						theme.fg("muted", ` \u00b7 sending in ${remaining}s`);
					return new Text(line, 0, 0);
				}
				if (details?.phase === "curating") {
					return new Text(theme.fg("accent", "waiting for user to curate results in browser..."), 0, 0);
				}
				if (details?.phase === "condensing") {
					return new Text(theme.fg("accent", "condensing results..."), 0, 0);
				}
				if (details?.phase === "searching") {
					const progress = details?.progress ?? 0;
					const bar = "\u2588".repeat(Math.floor(progress * 10)) + "\u2591".repeat(10 - Math.floor(progress * 10));
					const query = details?.currentQuery || "";
					const display = query.length > 40 ? query.slice(0, 37) + "..." : query;
					return new Text(theme.fg("accent", `[${bar}] ${display}`), 0, 0);
				}
				const progress = details?.progress ?? 0;
				const bar = "\u2588".repeat(Math.floor(progress * 10)) + "\u2591".repeat(10 - Math.floor(progress * 10));
				return new Text(theme.fg("accent", `[${bar}] ${details?.phase || "searching"}`), 0, 0);
			}

			if (details?.error) {
				return new Text(theme.fg("error", `Error: ${details.error}`), 0, 0);
			}

			let statusLine: string;
			if (details?.condensed && details?.condensedFrom) {
				statusLine = theme.fg("success", `condensed from ${details.condensedFrom} queries, ${details?.totalResults ?? 0} sources`);
			} else {
				const queryInfo = details?.queryCount === 1 ? "" : `${details?.successfulQueries}/${details?.queryCount} queries, `;
				statusLine = theme.fg("success", `${queryInfo}${details?.totalResults ?? 0} sources`);
			}
			if (details?.curated && details?.curatedFrom) {
				statusLine += theme.fg("muted", ` (${details.queryCount}/${details.curatedFrom} queries curated)`);
			}
			if (details?.fetchId && details?.fetchUrls) {
				statusLine += theme.fg("muted", ` (fetching ${details.fetchUrls.length} URLs)`);
			} else if (details?.fetchId) {
				statusLine += theme.fg("muted", " (content fetching)");
			}

			if (!expanded) {
				const textContent = result.content.find((c) => c.type === "text")?.text || "";
				const firstLine = (textContent.split("\n").find(l => l.trim() && !l.startsWith("[") && !l.startsWith("#") && !l.startsWith("---"))?.trim() || "").replace(/\*\*/g, "");
				const preview = firstLine.length > 80 ? firstLine.slice(0, 77) + "..." : firstLine;
				if (preview) {
					const box = new Box(1, 0, (t) => theme.bg("toolSuccessBg", t));
					box.addChild(new Text(statusLine, 0, 0));
					box.addChild(new Text(theme.fg("dim", preview), 0, 0));
					return box;
				}
				return new Text(statusLine, 0, 0);
			}

			const lines = [statusLine];

			const queryDetails = details?.curatedQueries;
			if (queryDetails?.length) {
				const kept = queryDetails.length;
				const from = details?.curatedFrom ?? kept;
				lines.push("");
				lines.push(theme.fg("accent", `\u2500\u2500 Curated Results (${kept} of ${from} queries kept) ` + "\u2500".repeat(24)));

				for (const cq of queryDetails) {
					lines.push("");
					const dq = cq.query.length > 65 ? cq.query.slice(0, 62) + "..." : cq.query;
					lines.push(theme.fg("accent", `  "${dq}"`));

					if (cq.error) {
						lines.push(theme.fg("error", `  ${cq.error}`));
					} else if (cq.answer) {
						lines.push("");
						for (const line of cq.answer.split("\n")) {
							lines.push(`  ${line}`);
						}
					}

					if (cq.sources.length > 0) {
						lines.push("");
						for (const s of cq.sources) {
							const domain = s.url.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
							const title = s.title.length > 50 ? s.title.slice(0, 47) + "..." : s.title;
							lines.push(theme.fg("muted", `  \u25b8 ${title}`) + theme.fg("dim", ` \u00b7 ${domain}`));
						}
					}
				}
				lines.push("");
			} else if (details?.condensed) {
				const textContent = result.content.find((c) => c.type === "text")?.text || "";
				lines.push("");
				lines.push(theme.fg("dim", textContent));
			} else {
				const textContent = result.content.find((c) => c.type === "text")?.text || "";
				const preview = textContent.length > 500 ? textContent.slice(0, 500) + "..." : textContent;
				lines.push(theme.fg("dim", preview));
			}

			if (details?.fetchUrls && details.fetchUrls.length > 0) {
				if (details.curated || details.condensed) {
					lines.push(theme.fg("muted", `Fetching ${details.fetchUrls.length} URLs in background`));
				} else {
					lines.push(theme.fg("muted", "Fetching:"));
					for (const u of details.fetchUrls.slice(0, 5)) {
						const display = u.length > 60 ? u.slice(0, 57) + "..." : u;
						lines.push(theme.fg("dim", "  " + display));
					}
					if (details.fetchUrls.length > 5) {
						lines.push(theme.fg("dim", `  ... and ${details.fetchUrls.length - 5} more`));
					}
				}
			}

			return new Text(lines.join("\n"), 0, 0);
		},
	});

	pi.registerTool({
		name: "fetch_content",
		label: "Fetch Content",
		description: "Fetch URL(s) and extract readable content as markdown. Supports YouTube video transcripts (with thumbnail), GitHub repository contents, and local video files (with frame thumbnail). Video frames can be extracted via timestamp/range or sampled across the entire video with frames alone. Falls back to Gemini for pages that block bots or fail Readability extraction. For YouTube and video files: ALWAYS pass the user's specific question via the prompt parameter — this directs the AI to focus on that aspect of the video, producing much better results than a generic extraction. Content is always stored and can be retrieved with get_search_content.",
		parameters: Type.Object({
			url: Type.Optional(Type.String({ description: "Single URL to fetch" })),
			urls: Type.Optional(Type.Array(Type.String(), { description: "Multiple URLs (parallel)" })),
			forceClone: Type.Optional(Type.Boolean({
				description: "Force cloning large GitHub repositories that exceed the size threshold",
			})),
			prompt: Type.Optional(Type.String({
				description: "Question or instruction for video analysis (YouTube and video files). Pass the user's specific question here — e.g. 'describe the book shown at the advice for beginners section'. Without this, a generic transcript extraction is used which may miss what the user is asking about.",
			})),
			timestamp: Type.Optional(Type.String({
				description: "Extract video frame(s) at a timestamp or time range. Single: '1:23:45', '23:45', or '85' (seconds). Range: '23:41-25:00' extracts evenly-spaced frames across that span (default 6). Use frames with ranges to control density; single+frames uses a fixed 5s interval. YouTube requires yt-dlp + ffmpeg; local videos require ffmpeg. Use a range when you know the approximate area but not the exact moment — you'll get a contact sheet to visually identify the right frame.",
			})),
			frames: Type.Optional(Type.Integer({
				minimum: 1,
				maximum: 12,
				description: "Number of frames to extract. Use with timestamp range for custom density, with single timestamp to get N frames at 5s intervals, or alone to sample across the entire video. Requires yt-dlp + ffmpeg for YouTube, ffmpeg for local video.",
			})),
			model: Type.Optional(Type.String({
				description: "Override the Gemini model for video/YouTube analysis (e.g. 'gemini-2.5-flash', 'gemini-3-flash-preview'). Defaults to config or gemini-3-flash-preview.",
			})),
		}),

		async execute(_toolCallId, params, signal, onUpdate) {
			const urlList = params.urls ?? (params.url ? [params.url] : []);
			if (urlList.length === 0) {
				return {
					content: [{ type: "text", text: "Error: No URL provided." }],
					details: { error: "No URL provided" },
				};
			}

			onUpdate?.({
				content: [{ type: "text", text: `Fetching ${urlList.length} URL(s)...` }],
				details: { phase: "fetch", progress: 0 },
			});

			const fetchResults = await fetchAllContent(urlList, signal, {
				forceClone: params.forceClone,
				prompt: params.prompt,
				timestamp: params.timestamp,
				frames: params.frames,
				model: params.model,
			});
			const successful = fetchResults.filter((r) => !r.error).length;
			const totalChars = fetchResults.reduce((sum, r) => sum + r.content.length, 0);

			// ALWAYS store results (even for single URL)
			const responseId = generateId();
			const data: StoredSearchData = {
				id: responseId,
				type: "fetch",
				timestamp: Date.now(),
				urls: stripThumbnails(fetchResults),
			};
			storeResult(responseId, data);
			pi.appendEntry("web-search-results", data);

			// Single URL: return content directly (possibly truncated) with responseId
			if (urlList.length === 1) {
				const result = fetchResults[0];
				if (result.error) {
					return {
						content: [{ type: "text", text: `Error: ${result.error}` }],
						details: { urls: urlList, urlCount: 1, successful: 0, error: result.error, responseId, prompt: params.prompt, timestamp: params.timestamp, frames: params.frames },
					};
				}

				const fullLength = result.content.length;
				const truncated = fullLength > MAX_INLINE_CONTENT;
				let output = truncated
					? result.content.slice(0, MAX_INLINE_CONTENT) + "\n\n[Content truncated...]"
					: result.content;

				if (truncated) {
					output += `\n\n---\nShowing ${MAX_INLINE_CONTENT} of ${fullLength} chars. ` +
						`Use get_search_content({ responseId: "${responseId}", urlIndex: 0 }) for full content.`;
				}

				const content: Array<{ type: string; text?: string; data?: string; mimeType?: string }> = [];
				if (result.frames?.length) {
					for (const frame of result.frames) {
						content.push({ type: "image", data: frame.data, mimeType: frame.mimeType });
						content.push({ type: "text", text: `Frame at ${frame.timestamp}` });
					}
				} else if (result.thumbnail) {
					content.push({ type: "image", data: result.thumbnail.data, mimeType: result.thumbnail.mimeType });
				}
				content.push({ type: "text", text: output });

				const imageCount = (result.frames?.length ?? 0) + (result.thumbnail ? 1 : 0);
				return {
					content,
					details: {
						urls: urlList,
						urlCount: 1,
						successful: 1,
						totalChars: fullLength,
						title: result.title,
						responseId,
						truncated,
						hasImage: imageCount > 0,
						imageCount,
						prompt: params.prompt,
						timestamp: params.timestamp,
						frames: params.frames,
						duration: result.duration,
					},
				};
			}

			// Multi-URL: existing behavior (summary + responseId)
			let output = "## Fetched URLs\n\n";
			for (const { url, title, content, error } of fetchResults) {
				if (error) {
					output += `- ${url}: Error - ${error}\n`;
				} else {
					output += `- ${title || url} (${content.length} chars)\n`;
				}
			}
			output += `\n---\nUse get_search_content({ responseId: "${responseId}", urlIndex: 0 }) to retrieve full content.`;

			return {
				content: [{ type: "text", text: output }],
				details: { urls: urlList, urlCount: urlList.length, successful, totalChars, responseId },
			};
		},

		renderCall(args, theme) {
			const { url, urls, prompt, timestamp, frames, model } = args as { url?: string; urls?: string[]; prompt?: string; timestamp?: string; frames?: number; model?: string };
			const urlList = urls ?? (url ? [url] : []);
			if (urlList.length === 0) {
				return new Text(theme.fg("toolTitle", theme.bold("fetch ")) + theme.fg("error", "(no URL)"), 0, 0);
			}
			const lines: string[] = [];
			if (urlList.length === 1) {
				const display = urlList[0].length > 60 ? urlList[0].slice(0, 57) + "..." : urlList[0];
				lines.push(theme.fg("toolTitle", theme.bold("fetch ")) + theme.fg("accent", display));
			} else {
				lines.push(theme.fg("toolTitle", theme.bold("fetch ")) + theme.fg("accent", `${urlList.length} URLs`));
				for (const u of urlList.slice(0, 5)) {
					const display = u.length > 60 ? u.slice(0, 57) + "..." : u;
					lines.push(theme.fg("muted", "  " + display));
				}
				if (urlList.length > 5) {
					lines.push(theme.fg("muted", `  ... and ${urlList.length - 5} more`));
				}
			}
			if (timestamp) {
				lines.push(theme.fg("dim", "  timestamp: ") + theme.fg("warning", timestamp));
			}
			if (typeof frames === "number") {
				lines.push(theme.fg("dim", "  frames: ") + theme.fg("warning", String(frames)));
			}
			if (prompt) {
				const display = prompt.length > 250 ? prompt.slice(0, 247) + "..." : prompt;
				lines.push(theme.fg("dim", "  prompt: ") + theme.fg("muted", `"${display}"`));
			}
			if (model) {
				lines.push(theme.fg("dim", "  model: ") + theme.fg("warning", model));
			}
			return new Text(lines.join("\n"), 0, 0);
		},

		renderResult(result, { expanded, isPartial }, theme) {
			const details = result.details as {
				urlCount?: number;
				successful?: number;
				totalChars?: number;
				error?: string;
				title?: string;
				truncated?: boolean;
				responseId?: string;
				phase?: string;
				progress?: number;
				hasImage?: boolean;
				imageCount?: number;
				prompt?: string;
				timestamp?: string;
				frames?: number;
				duration?: number;
			};

			if (isPartial) {
				const progress = details?.progress ?? 0;
				const bar = "\u2588".repeat(Math.floor(progress * 10)) + "\u2591".repeat(10 - Math.floor(progress * 10));
				return new Text(theme.fg("accent", `[${bar}] ${details?.phase || "fetching"}`), 0, 0);
			}

			if (details?.error) {
				return new Text(theme.fg("error", `Error: ${details.error}`), 0, 0);
			}

			if (details?.urlCount === 1) {
				const title = details?.title || "Untitled";
				const imgCount = details?.imageCount ?? (details?.hasImage ? 1 : 0);
				const imageBadge = imgCount > 1
					? theme.fg("accent", ` [${imgCount} images]`)
					: imgCount === 1
						? theme.fg("accent", " [image]")
						: "";
				let statusLine = theme.fg("success", title) + theme.fg("muted", ` (${details?.totalChars ?? 0} chars)`) + imageBadge;
				if (details?.truncated) {
					statusLine += theme.fg("warning", " [truncated]");
				}
				if (typeof details?.duration === "number") {
					statusLine += theme.fg("muted", ` | ${formatSeconds(Math.floor(details.duration))} total`);
				}
				const textContent = result.content.find((c) => c.type === "text")?.text || "";
				if (!expanded) {
					const brief = textContent.length > 200 ? textContent.slice(0, 200) + "..." : textContent;
					return new Text(statusLine + "\n" + theme.fg("dim", brief), 0, 0);
				}
				const lines = [statusLine];
				if (details?.prompt) {
					const display = details.prompt.length > 250 ? details.prompt.slice(0, 247) + "..." : details.prompt;
					lines.push(theme.fg("dim", `  prompt: "${display}"`));
				}
				if (details?.timestamp) {
					lines.push(theme.fg("dim", `  timestamp: ${details.timestamp}`));
				}
				if (typeof details?.frames === "number") {
					lines.push(theme.fg("dim", `  frames: ${details.frames}`));
				}
				const preview = textContent.length > 500 ? textContent.slice(0, 500) + "..." : textContent;
				lines.push(theme.fg("dim", preview));
				return new Text(lines.join("\n"), 0, 0);
			}

			const countColor = (details?.successful ?? 0) > 0 ? "success" : "error";
			const statusLine = theme.fg(countColor, `${details?.successful}/${details?.urlCount} URLs`) + theme.fg("muted", " (content stored)");
			if (!expanded) {
				return new Text(statusLine, 0, 0);
			}
			const textContent = result.content.find((c) => c.type === "text")?.text || "";
			const preview = textContent.length > 500 ? textContent.slice(0, 500) + "..." : textContent;
			return new Text(statusLine + "\n" + theme.fg("dim", preview), 0, 0);
		},
	});

	pi.registerTool({
		name: "get_search_content",
		label: "Get Search Content",
		description: "Retrieve full content from a previous web_search or fetch_content call.",
		parameters: Type.Object({
			responseId: Type.String({ description: "The responseId from web_search or fetch_content" }),
			query: Type.Optional(Type.String({ description: "Get content for this query (web_search)" })),
			queryIndex: Type.Optional(Type.Number({ description: "Get content for query at index" })),
			url: Type.Optional(Type.String({ description: "Get content for this URL" })),
			urlIndex: Type.Optional(Type.Number({ description: "Get content for URL at index" })),
		}),

		async execute(_toolCallId, params) {
			const data = getResult(params.responseId);
			if (!data) {
				return {
					content: [{ type: "text", text: `Error: No stored results for "${params.responseId}"` }],
					details: { error: "Not found", responseId: params.responseId },
				};
			}

			if (data.type === "search" && data.queries) {
				let queryData: QueryResultData | undefined;

				if (params.query !== undefined) {
					queryData = data.queries.find((q) => q.query === params.query);
					if (!queryData) {
						const available = data.queries.map((q) => `"${q.query}"`).join(", ");
						return {
							content: [{ type: "text", text: `Query "${params.query}" not found. Available: ${available}` }],
							details: { error: "Query not found" },
						};
					}
				} else if (params.queryIndex !== undefined) {
					queryData = data.queries[params.queryIndex];
					if (!queryData) {
						return {
							content: [{ type: "text", text: `Index ${params.queryIndex} out of range (0-${data.queries.length - 1})` }],
							details: { error: "Index out of range" },
						};
					}
				} else {
					const available = data.queries.map((q, i) => `${i}: "${q.query}"`).join(", ");
					return {
						content: [{ type: "text", text: `Specify query or queryIndex. Available: ${available}` }],
						details: { error: "No query specified" },
					};
				}

				if (queryData.error) {
					return {
						content: [{ type: "text", text: `Error for "${queryData.query}": ${queryData.error}` }],
						details: { error: queryData.error, query: queryData.query },
					};
				}

				return {
					content: [{ type: "text", text: formatFullResults(queryData) }],
					details: { query: queryData.query, resultCount: queryData.results.length },
				};
			}

			if (data.type === "fetch" && data.urls) {
				let urlData: ExtractedContent | undefined;

				if (params.url !== undefined) {
					urlData = data.urls.find((u) => u.url === params.url);
					if (!urlData) {
						const available = data.urls.map((u) => u.url).join("\n  ");
						return {
							content: [{ type: "text", text: `URL not found. Available:\n  ${available}` }],
							details: { error: "URL not found" },
						};
					}
				} else if (params.urlIndex !== undefined) {
					urlData = data.urls[params.urlIndex];
					if (!urlData) {
						return {
							content: [{ type: "text", text: `Index ${params.urlIndex} out of range (0-${data.urls.length - 1})` }],
							details: { error: "Index out of range" },
						};
					}
				} else {
					const available = data.urls.map((u, i) => `${i}: ${u.url}`).join("\n  ");
					return {
						content: [{ type: "text", text: `Specify url or urlIndex. Available:\n  ${available}` }],
						details: { error: "No URL specified" },
					};
				}

				if (urlData.error) {
					return {
						content: [{ type: "text", text: `Error for ${urlData.url}: ${urlData.error}` }],
						details: { error: urlData.error, url: urlData.url },
					};
				}

				return {
					content: [{ type: "text", text: `# ${urlData.title}\n\n${urlData.content}` }],
					details: { url: urlData.url, title: urlData.title, contentLength: urlData.content.length },
				};
			}

			return {
				content: [{ type: "text", text: "Invalid stored data format" }],
				details: { error: "Invalid data" },
			};
		},

		renderCall(args, theme) {
			const { responseId, query, queryIndex, url, urlIndex } = args as {
				responseId: string;
				query?: string;
				queryIndex?: number;
				url?: string;
				urlIndex?: number;
			};
			let target = "";
			if (query) target = `query="${query}"`;
			else if (queryIndex !== undefined) target = `queryIndex=${queryIndex}`;
			else if (url) target = url.length > 30 ? url.slice(0, 27) + "..." : url;
			else if (urlIndex !== undefined) target = `urlIndex=${urlIndex}`;
			return new Text(theme.fg("toolTitle", theme.bold("get_content ")) + theme.fg("accent", target || responseId.slice(0, 8)), 0, 0);
		},

		renderResult(result, { expanded }, theme) {
			const details = result.details as {
				error?: string;
				query?: string;
				url?: string;
				title?: string;
				resultCount?: number;
				contentLength?: number;
			};

			if (details?.error) {
				return new Text(theme.fg("error", `Error: ${details.error}`), 0, 0);
			}

			let statusLine: string;
			if (details?.query) {
				statusLine = theme.fg("success", `"${details.query}"`) + theme.fg("muted", ` (${details.resultCount} results)`);
			} else {
				statusLine = theme.fg("success", details?.title || "Content") + theme.fg("muted", ` (${details?.contentLength ?? 0} chars)`);
			}

			if (!expanded) {
				return new Text(statusLine, 0, 0);
			}

			const textContent = result.content.find((c) => c.type === "text")?.text || "";
			const preview = textContent.length > 500 ? textContent.slice(0, 500) + "..." : textContent;
			return new Text(statusLine + "\n" + theme.fg("dim", preview), 0, 0);
		},
	});

	pi.registerCommand("websearch", {
		description: "Open web search curator in the browser",
		handler: async (args, ctx) => {
			closeCurator();
			const sessionToken = randomUUID();
			const queries = args.trim() ? args.trim().split(/\s*,\s*/) : [];

			const pplxAvail = isPerplexityAvailable();
			const exaAvail = isExaAvailable();
			const geminiApiAvail = isGeminiApiAvailable();
			const geminiWebAvail = await isGeminiWebAvailable();
			const availableProviders = {
				perplexity: pplxAvail,
				exa: exaAvail,
				gemini: geminiApiAvail || !!geminiWebAvail,
			};
			const defaultProvider = resolveProvider(undefined, availableProviders);

			ctx.ui.notify("Opening web search curator...", "info");

			const collected = new Map<number, QueryResultData>();
			const searchAbort = new AbortController();
			let aborted = false;

			function sendResults(selectedQueryIndices?: number[]) {
				const results = selectedQueryIndices
					? selectedQueryIndices.map(qi => collected.get(qi)).filter((r): r is QueryResultData => !!r)
					: [...collected.values()];
				if (results.length === 0) return;
				const urls: string[] = [];
				let text = "";
				for (const q of results) {
					text += `## Query: "${q.query}"\n\n${q.answer}\n\n`;
					if (q.results.length > 0) {
						text += "**Sources:**\n";
						for (const r of q.results) {
							text += `- ${r.title}: ${r.url}\n`;
							if (!urls.includes(r.url)) urls.push(r.url);
						}
						text += "\n";
					}
				}
				pi.sendMessage({
					customType: "web-search-results",
					content: [{ type: "text", text }],
					display: "tool",
					details: { queryCount: results.length, totalResults: urls.length },
				}, { triggerTurn: true, deliverAs: "followUp" });
			}

			try {
				const handle = await startCuratorServer(
					{ queries, sessionToken, timeout: 120, availableProviders, defaultProvider },
					{
						onSubmit(selectedQueryIndices) {
							aborted = true;
							searchAbort.abort();
							sendResults(selectedQueryIndices);
							closeCurator();
						},
						onCancel(reason) {
							aborted = true;
							searchAbort.abort();
							if (reason === "timeout") sendResults();
							closeCurator();
						},
						onProviderChange(provider) { saveConfig({ provider }); },
						async onAddSearch(query, queryIndex) {
							const { answer, results } = await search(query, {
								provider: defaultProvider as SearchProvider | undefined,
								signal: searchAbort.signal,
							});
							collected.set(queryIndex, { query, answer, results, error: null });
							return {
								answer,
								results: results.map(r => ({ title: r.title, url: r.url, domain: extractDomain(r.url) })),
							};
						},
					},
				);

				activeCurator = handle;
				await openInBrowser(pi, handle.url);

				if (queries.length > 0) {
					(async () => {
						for (let qi = 0; qi < queries.length; qi++) {
							if (aborted) break;
							try {
								const { answer, results } = await search(queries[qi], {
									provider: defaultProvider as SearchProvider | undefined,
									signal: searchAbort.signal,
								});
								if (aborted) break;
								handle.pushResult(qi, {
									answer,
									results: results.map(r => ({ title: r.title, url: r.url, domain: extractDomain(r.url) })),
								});
								collected.set(qi, { query: queries[qi], answer, results, error: null });
							} catch (err) {
								if (aborted) break;
								const message = err instanceof Error ? err.message : String(err);
								handle.pushError(qi, message);
								collected.set(qi, { query: queries[qi], answer: "", results: [], error: message });
							}
						}
						if (!aborted) handle.searchesDone();
					})();
				} else {
					handle.searchesDone();
				}
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				ctx.ui.notify(`Failed to open curator: ${message}`, "error");
			}
		},
	});

	pi.registerCommand("google-account", {
		description: "Show the active Google account for Gemini Web",
		handler: async () => {
			const cookies = await isGeminiWebAvailable();
			if (!cookies) {
				pi.sendMessage({
					customType: "google-account",
					content: [{ type: "text", text: "Gemini Web is unavailable. Sign into gemini.google.com in a supported Chromium-based browser." }],
					display: "tool",
					details: { available: false },
				}, { triggerTurn: true, deliverAs: "followUp" });
				return;
			}

			const email = await getActiveGoogleEmail(cookies);
			const text = email
				? `Active Google account: ${email}`
				: "Gemini Web is available, but the active Google account could not be determined.";

			pi.sendMessage({
				customType: "google-account",
				content: [{ type: "text", text }],
				display: "tool",
				details: { available: true, email: email ?? null },
			}, { triggerTurn: true, deliverAs: "followUp" });
		},
	});

	pi.registerCommand("web-results", {
		description: "Browse stored web search results",
		handler: async (_args, ctx) => {
			const results = getAllResults();

			if (results.length === 0) {
				ctx.ui.notify("No stored search results", "info");
				return;
			}

			const options = results.map((r) => {
				const age = Math.floor((Date.now() - r.timestamp) / 60000);
				const ageStr = age < 60 ? `${age}m ago` : `${Math.floor(age / 60)}h ago`;
				if (r.type === "search" && r.queries) {
					const query = r.queries[0]?.query || "unknown";
					return `[${r.id.slice(0, 6)}] "${query}" (${r.queries.length} queries) - ${ageStr}`;
				}
				if (r.type === "fetch" && r.urls) {
					return `[${r.id.slice(0, 6)}] ${r.urls.length} URLs fetched - ${ageStr}`;
				}
				return `[${r.id.slice(0, 6)}] ${r.type} - ${ageStr}`;
			});

			const choice = await ctx.ui.select("Stored Search Results", options);
			if (!choice) return;

			const match = choice.match(/^\[([a-z0-9]+)\]/);
			if (!match) return;

			const selected = results.find((r) => r.id.startsWith(match[1]));
			if (!selected) return;

			const actions = ["View details", "Delete"];
			const action = await ctx.ui.select(`Result ${selected.id.slice(0, 6)}`, actions);

			if (action === "Delete") {
				deleteResult(selected.id);
				ctx.ui.notify(`Deleted ${selected.id.slice(0, 6)}`, "info");
			} else if (action === "View details") {
				let info = `ID: ${selected.id}\nType: ${selected.type}\nAge: ${Math.floor((Date.now() - selected.timestamp) / 60000)}m\n\n`;
				if (selected.type === "search" && selected.queries) {
					info += "Queries:\n";
					const queries = selected.queries.slice(0, 10);
					for (const q of queries) {
						info += `- "${q.query}" (${q.results.length} results)\n`;
					}
					if (selected.queries.length > 10) {
						info += `... and ${selected.queries.length - 10} more\n`;
					}
				}
				if (selected.type === "fetch" && selected.urls) {
					info += "URLs:\n";
					const urls = selected.urls.slice(0, 10);
					for (const u of urls) {
						const urlDisplay = u.url.length > 50 ? u.url.slice(0, 47) + "..." : u.url;
						info += `- ${urlDisplay} (${u.error || `${u.content.length} chars`})\n`;
					}
					if (selected.urls.length > 10) {
						info += `... and ${selected.urls.length - 10} more\n`;
					}
				}
				ctx.ui.notify(info, "info");
			}
		},
	});
}
