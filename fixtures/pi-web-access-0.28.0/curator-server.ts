import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { generateCuratorPage } from "./curator-page.ts";
import type { ProviderAvailability } from "./gemini-search.ts";
import type { SummaryMeta } from "./summary-review.ts";
import { resolveCuratorNetworkConfig } from "./utils.ts";

const STALE_THRESHOLD_MS = 30000;
const WATCHDOG_INTERVAL_MS = 1000;
const MAX_BODY_SIZE = 64 * 1024;

type ServerState = "SEARCHING" | "RESULT_SELECTION" | "COMPLETED";
type CuratorResultEventData = IndexedCuratorSearchEntry & { slotIndex?: number };
type CuratorSearchErrorEventData = { queryIndex: number; query: string; error: string; provider?: string; slotIndex?: number };
type CuratorStoredEvent =
	| { event: "result"; data: CuratorResultEventData }
	| { event: "search-error"; data: CuratorSearchErrorEventData };

export interface CuratorServerOptions {
	queries: string[];
	/** First index available to searches added while initial results are still streaming. */
	initialResultIndexCapacity?: number;
	sessionToken: string;
	timeout: number;
	availableProviders: ProviderAvailability;
	defaultProvider: string;
	searchProvider: string;
	summaryModels: Array<{ value: string; label: string }>;
	defaultSummaryModel: string | null;
}

export interface CuratorSearchEntry {
	answer: string;
	results: Array<{ title: string; url: string; domain: string; snippet?: string }>;
	provider: string;
	error?: string;
}

export interface IndexedCuratorSearchEntry extends CuratorSearchEntry {
	queryIndex: number;
	query: string;
}

export interface CuratorServerCallbacks {
	onSubmit: (payload: { selectedQueryIndices: number[]; summary?: string; summaryMeta?: SummaryMeta; rawResults?: boolean }) => void;
	onCancel: (reason: "user" | "timeout" | "stale") => void;
	onProviderChange: (provider: string) => void;
	onAddSearch: (query: string, provider?: string) => Promise<CuratorSearchEntry[]>;
	onAddSearchResults: (entries: IndexedCuratorSearchEntry[]) => void;
	onSummarize: (
		selectedQueryIndices: number[],
		signal: AbortSignal,
		model?: string,
		feedback?: string,
	) => Promise<{ summary: string; meta: SummaryMeta }>;
	onRewriteQuery: (query: string, signal: AbortSignal) => Promise<string>;
}

export interface CuratorServerHandle {
	server: http.Server;
	url: string;
	close: () => void;
	pushResult: (queryIndex: number, data: CuratorSearchEntry & { query?: string; slotIndex?: number }) => void;
	pushError: (queryIndex: number, error: string, provider?: string, meta?: { query?: string; slotIndex?: number }) => void;
	searchesDone: () => void;
	/** Reports browser connection state so a cancelled search can surface WHY it
	 * went stale (e.g. the browser never connected). */
	getConnectionState: () => { browserConnected: boolean; lastHeartbeatAgeMs: number };
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
	res.writeHead(status, {
		"Content-Type": "application/json",
		"Cache-Control": "no-store",
	});
	res.end(JSON.stringify(payload));
}

function parseJSONBody(req: IncomingMessage): Promise<unknown> {
	return new Promise((resolve, reject) => {
		let body = "";
		let size = 0;
		req.on("data", (chunk: Buffer) => {
			size += chunk.length;
			if (size > MAX_BODY_SIZE) {
				req.destroy();
				reject(new Error("Request body too large"));
				return;
			}
			body += chunk.toString();
		});
		req.on("end", () => {
			try {
				resolve(JSON.parse(body));
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				reject(new Error(`Invalid JSON: ${message}`));
			}
		});
		req.on("error", reject);
	});
}

async function parseBodyOrSend(req: IncomingMessage, res: ServerResponse): Promise<unknown | null> {
	try {
		return await parseJSONBody(req);
	} catch (err) {
		const message = err instanceof Error ? err.message : "Invalid body";
		const status = message === "Request body too large" ? 413 : 400;
		sendJson(res, status, { ok: false, error: message });
		return null;
	}
}

function normalizeSelectedIndices(
	value: unknown,
	options: { allowEmpty: boolean; maxExclusive: number },
): { ok: true; indices: number[] } | { ok: false; error: string } {
	if (!Array.isArray(value)) {
		return { ok: false, error: "Invalid selection" };
	}

	if (!options.allowEmpty && value.length === 0) {
		return { ok: false, error: "Invalid selection" };
	}

	const normalized: number[] = [];
	const seen = new Set<number>();
	for (const item of value) {
		if (typeof item !== "number" || !Number.isInteger(item) || item < 0) {
			return { ok: false, error: "Invalid selection" };
		}
		if (item >= options.maxExclusive) {
			return { ok: false, error: "Invalid selection" };
		}
		if (seen.has(item)) {
			continue;
		}
		seen.add(item);
		normalized.push(item);
	}

	if (!options.allowEmpty && normalized.length === 0) {
		return { ok: false, error: "Invalid selection" };
	}

	return { ok: true, indices: normalized };
}

function normalizeSummaryMeta(value: unknown): SummaryMeta | null {
	if (!value || typeof value !== "object") return null;
	const meta = value as Record<string, unknown>;

	const model = meta.model === null
		? null
		: typeof meta.model === "string"
			? meta.model
			: undefined;
	if (model === undefined) return null;

	const durationMs = meta.durationMs;
	if (typeof durationMs !== "number" || !Number.isFinite(durationMs) || durationMs < 0) return null;

	const tokenEstimate = meta.tokenEstimate;
	if (typeof tokenEstimate !== "number" || !Number.isFinite(tokenEstimate) || tokenEstimate < 0) return null;

	const fallbackUsed = meta.fallbackUsed;
	if (typeof fallbackUsed !== "boolean") return null;

	const fallbackReason = typeof meta.fallbackReason === "string" ? meta.fallbackReason : undefined;
	if (meta.fallbackReason !== undefined && fallbackReason === undefined) return null;

	const phase = meta.phase === "summary-model" || meta.phase === "deterministic-fallback"
		? meta.phase
		: undefined;
	if (meta.phase !== undefined && phase === undefined) return null;
	if (phase === "deterministic-fallback" && fallbackUsed !== true) return null;
	if (phase === "summary-model" && fallbackUsed !== false) return null;

	const edited = typeof meta.edited === "boolean" ? meta.edited : undefined;
	if (meta.edited !== undefined && edited === undefined) return null;

	return {
		model,
		durationMs,
		tokenEstimate,
		fallbackUsed,
		...(fallbackReason !== undefined ? { fallbackReason } : {}),
		...(phase !== undefined ? { phase } : {}),
		...(edited !== undefined ? { edited } : {}),
	};
}

export function startCuratorServer(
	options: CuratorServerOptions,
	callbacks: CuratorServerCallbacks,
): Promise<CuratorServerHandle> {
	const {
		queries,
		initialResultIndexCapacity,
		sessionToken,
		timeout,
		availableProviders,
		defaultProvider,
		searchProvider,
		summaryModels,
		defaultSummaryModel,
	} = options;
	let browserConnected = false;
	let lastHeartbeatAt = Date.now();
	let stateChangedAt = Date.now();
	let clientIdleMs: number | null = null;
	let clientTimeoutSeconds = timeout;
	let completed = false;
	let watchdog: NodeJS.Timeout | null = null;
	let state: ServerState = "SEARCHING";
	let sseResponse: ServerResponse | null = null;
	const streamedEventsByResultIndex = new Map<number, CuratorStoredEvent>();
	let searchStreamDone = queries.length === 0;
	let nextQueryIndex = Math.max(queries.length, initialResultIndexCapacity ?? queries.length);
	let summarizeAbortController: AbortController | null = null;
	let summarizeRequestSeq = 0;

	let sseKeepalive: NodeJS.Timeout | null = null;

	const abortInFlightSummarize = (): void => {
		if (!summarizeAbortController) return;
		summarizeAbortController.abort();
		summarizeAbortController = null;
	};

	const markCompleted = (): boolean => {
		if (completed) return false;
		completed = true;
		state = "COMPLETED";
		stateChangedAt = Date.now();
		if (watchdog) {
			clearInterval(watchdog);
			watchdog = null;
		}
		if (sseKeepalive) {
			clearInterval(sseKeepalive);
			sseKeepalive = null;
		}
		abortInFlightSummarize();
		if (sseResponse) {
			try { sseResponse.end(); } catch {}
			sseResponse = null;
		}
		return true;
	};

	const touchHeartbeat = (): void => {
		lastHeartbeatAt = Date.now();
		browserConnected = true;
	};

	const getEffectiveTimeoutMs = (): number => Math.max(1000, Math.floor(clientTimeoutSeconds) * 1000);

	const shouldTimeoutFromClientIdle = (): boolean => (
		state === "RESULT_SELECTION" &&
		clientIdleMs !== null &&
		clientIdleMs >= getEffectiveTimeoutMs()
	);

	function validateToken(body: unknown, res: ServerResponse): boolean {
		if (!body || typeof body !== "object") {
			sendJson(res, 400, { ok: false, error: "Invalid body" });
			return false;
		}
		if ((body as { token?: string }).token !== sessionToken) {
			sendJson(res, 403, { ok: false, error: "Invalid session" });
			return false;
		}
		return true;
	}

	function isAvailableProvider(provider: string): boolean {
		if (provider === "all") return availableProviders.all;
		if (provider === "openai") return availableProviders.openai;
		if (provider === "brave") return availableProviders.brave;
		if (provider === "parallel") return availableProviders.parallel;
		if (provider === "parallel-mcp") return availableProviders["parallel-mcp"];
		if (provider === "tinyfish") return availableProviders.tinyfish;
		if (provider === "search1api") return availableProviders.search1api;
		if (provider === "searchinfinity") return availableProviders.searchinfinity;
		if (provider === "querit") return availableProviders.querit;
		if (provider === "tavily") return availableProviders.tavily;
		if (provider === "firecrawl") return availableProviders.firecrawl;
		if (provider === "jina") return availableProviders.jina;
		if (provider === "serpdive") return availableProviders.serpdive;
		if (provider === "kagi") return availableProviders.kagi;
		if (provider === "bocha") return availableProviders.bocha;
		if (provider === "ollama") return availableProviders.ollama;
		if (provider === "searxng") return availableProviders.searxng;
		if (provider === "duckduckgo") return availableProviders.duckduckgo;
		if (provider === "perplexity") return availableProviders.perplexity;
		if (provider === "exa") return availableProviders.exa;
		if (provider === "gemini") return availableProviders.gemini;
		if (provider === "kimi") return availableProviders.kimi;
		if (provider === "anysearch") return availableProviders.anysearch;
		if (provider === "xcrawl") return availableProviders.xcrawl;
		if (provider === "xai") return availableProviders.xai;
		if (provider === "mistral") return availableProviders.mistral;
		if (provider === "brightdata") return availableProviders.brightdata;
		if (provider === "serpbase") return availableProviders.serpbase;
		if (provider === "serper") return availableProviders.serper;
		if (provider === "valyu") return availableProviders.valyu;
		return false;
	}

	function writeSSE(res: ServerResponse, event: string, data: unknown): boolean {
		const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
		try {
			res.write(payload);
			return true;
		} catch {
			return false;
		}
	}

	function sendSSE(event: string, data: unknown): void {
		const res = sseResponse;
		if (res && !res.writableEnded && res.socket && !res.socket.destroyed && writeSSE(res, event, data)) return;
		if (sseResponse === res) sseResponse = null;
	}

	function retainStreamedEvent(event: CuratorStoredEvent): void {
		streamedEventsByResultIndex.set(event.data.queryIndex, event);
	}

	function getStreamedEvents(): CuratorStoredEvent[] {
		return [...streamedEventsByResultIndex.values()];
	}

	function replaySSE(res: ServerResponse): void {
		for (const item of getStreamedEvents()) {
			if (!writeSSE(res, item.event, item.data)) return;
		}
		if (searchStreamDone) writeSSE(res, "done", {});
	}

	const pageHtml = generateCuratorPage(
		queries,
		sessionToken,
		timeout,
		availableProviders,
		defaultProvider,
		searchProvider,
		summaryModels,
		defaultSummaryModel,
	);

	const server = http.createServer(async (req, res) => {
		try {
			const method = req.method || "GET";
			const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);

			if (method === "GET" && url.pathname === "/") {
				const token = url.searchParams.get("session");
				if (token !== sessionToken) {
					res.writeHead(403, { "Content-Type": "text/plain" });
					res.end("Invalid session");
					return;
				}
				touchHeartbeat();
				res.writeHead(200, {
					"Content-Type": "text/html; charset=utf-8",
					"Cache-Control": "no-store",
				});
				res.end(pageHtml);
				return;
			}

			if (method === "GET" && url.pathname === "/events") {
				const token = url.searchParams.get("session");
				if (token !== sessionToken) {
					res.writeHead(403, { "Content-Type": "text/plain" });
					res.end("Invalid session");
					return;
				}
				if (state === "COMPLETED") {
					sendJson(res, 409, { ok: false, error: "No events available" });
					return;
				}
				if (sseResponse) {
					try { sseResponse.end(); } catch {}
				}
				res.writeHead(200, {
					"Content-Type": "text/event-stream",
					"Cache-Control": "no-cache",
					Connection: "keep-alive",
					"X-Accel-Buffering": "no",
				});
				res.flushHeaders();
				if (res.socket) res.socket.setNoDelay(true);
				sseResponse = res;
				replaySSE(res);
				if (sseKeepalive) clearInterval(sseKeepalive);
				sseKeepalive = setInterval(() => {
					if (sseResponse) {
						try { sseResponse.write(":keepalive\n\n"); } catch {}
					}
				}, 15000);
				req.on("close", () => {
					if (sseResponse === res) sseResponse = null;
				});
				return;
			}

			if (method === "GET" && url.pathname === "/state") {
				const token = url.searchParams.get("session");
				if (token !== sessionToken) {
					sendJson(res, 403, { ok: false, error: "Invalid session" });
					return;
				}
				touchHeartbeat();
				sendJson(res, 200, { ok: true, events: getStreamedEvents(), done: searchStreamDone });
				return;
			}

			if (method === "POST" && url.pathname === "/heartbeat") {
				const body = await parseBodyOrSend(req, res);
				if (!body) return;
				if (!validateToken(body, res)) return;
				touchHeartbeat();
				const heartbeat = body as { idleMs?: unknown; timeoutSec?: unknown };
				if (typeof heartbeat.timeoutSec === "number" && Number.isFinite(heartbeat.timeoutSec) && heartbeat.timeoutSec > 0) {
					clientTimeoutSeconds = Math.min(600, Math.floor(heartbeat.timeoutSec));
				}
				if (typeof heartbeat.idleMs === "number" && Number.isFinite(heartbeat.idleMs) && heartbeat.idleMs >= 0) {
					clientIdleMs = Math.floor(heartbeat.idleMs);
				}
				const timedOut = shouldTimeoutFromClientIdle();
				sendJson(res, 200, { ok: true });
				if (timedOut && markCompleted()) {
					setImmediate(() => callbacks.onCancel("timeout"));
				}
				return;
			}

			if (method === "POST" && url.pathname === "/provider") {
				const body = await parseBodyOrSend(req, res);
				if (!body) return;
				if (!validateToken(body, res)) return;
				const { provider } = body as { provider?: string };
				if (typeof provider !== "string" || provider.length === 0) {
					sendJson(res, 400, { ok: false, error: "Invalid provider" });
					return;
				}
				if (!isAvailableProvider(provider)) {
					sendJson(res, 400, { ok: false, error: `Provider unavailable: ${provider}` });
					return;
				}
				setImmediate(() => callbacks.onProviderChange(provider));
				sendJson(res, 200, { ok: true });
				return;
			}

			if (method === "POST" && url.pathname === "/search") {
				const body = await parseBodyOrSend(req, res);
				if (!body) return;
				if (!validateToken(body, res)) return;
				if (state === "COMPLETED") {
					sendJson(res, 409, { ok: false, error: "Session closed" });
					return;
				}
				const { query, provider } = body as { query?: string; provider?: string };
				if (typeof query !== "string" || query.trim().length === 0) {
					sendJson(res, 400, { ok: false, error: "Invalid query" });
					return;
				}
				if (provider !== undefined) {
					if (typeof provider !== "string" || provider.length === 0) {
						sendJson(res, 400, { ok: false, error: "Invalid provider" });
						return;
					}
					if (!isAvailableProvider(provider)) {
						sendJson(res, 400, { ok: false, error: `Provider unavailable: ${provider}` });
						return;
					}
				}
				const qi = nextQueryIndex++;
				const trimmedQuery = query.trim();
				touchHeartbeat();
				try {
					const results = await callbacks.onAddSearch(trimmedQuery, provider);
					if (results.length === 0) throw new Error("Search returned no provider results");
					const entries = results.map((result, index): IndexedCuratorSearchEntry => ({
						...result,
						queryIndex: index === 0 ? qi : nextQueryIndex++,
						query: trimmedQuery,
					}));
					callbacks.onAddSearchResults(entries);
					sendJson(res, 200, { ok: true, ...entries[0], entries });
				} catch (err) {
					const message = err instanceof Error ? err.message : "Search failed";
					const entry: IndexedCuratorSearchEntry = {
						queryIndex: qi,
						query: trimmedQuery,
						answer: "",
						results: [],
						error: message,
						provider: typeof provider === "string" && provider.length > 0 ? provider : defaultProvider,
					};
					callbacks.onAddSearchResults([entry]);
					sendJson(res, 200, { ok: true, ...entry, entries: [entry] });
				}
				return;
			}

			if (method === "POST" && url.pathname === "/summarize") {
				const body = await parseBodyOrSend(req, res);
				if (!body) return;
				if (!validateToken(body, res)) return;
				if (state === "COMPLETED") {
					sendJson(res, 409, { ok: false, error: "Session closed" });
					return;
				}

				const parsed = normalizeSelectedIndices((body as { selected?: unknown }).selected, {
					allowEmpty: false,
					maxExclusive: nextQueryIndex,
				});
				if ("error" in parsed) {
					sendJson(res, 400, { ok: false, error: parsed.error });
					return;
				}

				let model: string | undefined;
				const bodyModel = (body as { model?: unknown }).model;
				if (bodyModel !== undefined) {
					if (typeof bodyModel !== "string") {
						sendJson(res, 400, { ok: false, error: "Invalid model" });
						return;
					}
					const trimmedModel = bodyModel.trim();
					model = trimmedModel.length > 0 ? trimmedModel : undefined;
				}

				const bodyFeedback = (body as { feedback?: unknown }).feedback;
				const feedback = typeof bodyFeedback === "string" && bodyFeedback.trim().length > 0
					? bodyFeedback.trim()
					: undefined;

				abortInFlightSummarize();
				const controller = new AbortController();
				summarizeAbortController = controller;
				const requestId = ++summarizeRequestSeq;

				try {
					const result = await callbacks.onSummarize(parsed.indices, controller.signal, model, feedback);
					if (requestId !== summarizeRequestSeq || completed) {
						sendJson(res, 409, { ok: false, error: "Summarize request superseded" });
						return;
					}
					sendJson(res, 200, {
						ok: true,
						summary: result.summary,
						meta: result.meta,
					});
				} catch (err) {
					const message = err instanceof Error ? err.message : "Summary generation failed";
					const status = controller.signal.aborted ? 409 : 500;
					sendJson(res, status, { ok: false, error: message });
				} finally {
					if (summarizeAbortController === controller) {
						summarizeAbortController = null;
					}
				}
				return;
			}

			if (method === "POST" && url.pathname === "/rewrite") {
				const body = await parseBodyOrSend(req, res);
				if (!body) return;
				if (!validateToken(body, res)) return;
				if (state === "COMPLETED") {
					sendJson(res, 409, { ok: false, error: "Session closed" });
					return;
				}
				const { query } = body as { query?: unknown };
				if (typeof query !== "string" || query.trim().length === 0) {
					sendJson(res, 400, { ok: false, error: "Invalid query" });
					return;
				}
				const controller = new AbortController();
				req.on("close", () => controller.abort());
				touchHeartbeat();
				try {
					const rewritten = await callbacks.onRewriteQuery(query.trim(), controller.signal);
					sendJson(res, 200, { ok: true, query: rewritten });
				} catch (err) {
					const message = err instanceof Error ? err.message : "Rewrite failed";
					const status = controller.signal.aborted ? 409 : 500;
					sendJson(res, status, { ok: false, error: message });
				}
				return;
			}

			if (method === "POST" && url.pathname === "/submit") {
				const body = await parseBodyOrSend(req, res);
				if (!body) return;
				if (!validateToken(body, res)) return;

				const parsed = normalizeSelectedIndices((body as { selected?: unknown }).selected, {
					allowEmpty: true,
					maxExclusive: nextQueryIndex,
				});
				if ("error" in parsed) {
					sendJson(res, 400, { ok: false, error: parsed.error });
					return;
				}

				let summary: string | undefined;
				const bodySummary = (body as { summary?: unknown }).summary;
				if (bodySummary !== undefined) {
					if (typeof bodySummary !== "string") {
						sendJson(res, 400, { ok: false, error: "Invalid summary" });
						return;
					}
					const trimmedSummary = bodySummary.trim();
					summary = trimmedSummary.length > 0 ? trimmedSummary : undefined;
				}

				let summaryMeta: SummaryMeta | undefined;
				const bodySummaryMeta = (body as { summaryMeta?: unknown }).summaryMeta;
				if (bodySummaryMeta !== undefined) {
					const parsedSummaryMeta = normalizeSummaryMeta(bodySummaryMeta);
					if (!parsedSummaryMeta) {
						sendJson(res, 400, { ok: false, error: "Invalid summaryMeta" });
						return;
					}
					summaryMeta = parsedSummaryMeta;
				}

				if (state !== "SEARCHING" && state !== "RESULT_SELECTION") {
					sendJson(res, 409, { ok: false, error: "Cannot submit in current state" });
					return;
				}
				if (!markCompleted()) {
					sendJson(res, 409, { ok: false, error: "Session closed" });
					return;
				}
				const rawResults = (body as { rawResults?: unknown }).rawResults === true;
				sendJson(res, 200, { ok: true });
				setImmediate(() => callbacks.onSubmit({
					selectedQueryIndices: parsed.indices,
					...(summary !== undefined ? { summary } : {}),
					...(summaryMeta !== undefined ? { summaryMeta } : {}),
					rawResults,
				}));
				return;
			}

			if (method === "POST" && url.pathname === "/cancel") {
				const body = await parseBodyOrSend(req, res);
				if (!body) return;
				if (!validateToken(body, res)) return;
				if (!markCompleted()) {
					sendJson(res, 200, { ok: true });
					return;
				}
				const { reason } = body as { reason?: string };
				sendJson(res, 200, { ok: true });
				const cancelReason = reason === "timeout" ? "timeout" : "user";
				setImmediate(() => callbacks.onCancel(cancelReason));
				return;
			}

			res.writeHead(404, { "Content-Type": "text/plain" });
			res.end("Not found");
		} catch (err) {
			const message = err instanceof Error ? err.message : "Server error";
			sendJson(res, 500, { ok: false, error: message });
		}
	});

	return new Promise((resolve, reject) => {
		const onError = (err: Error) => {
			reject(new Error(`Curator server failed to start: ${err.message}`));
		};

		const networkConfig = resolveCuratorNetworkConfig();

		server.once("error", onError);
		server.listen(0, networkConfig.bind, () => {
			server.off("error", onError);
			const addr = server.address();
			if (!addr || typeof addr === "string") {
				reject(new Error("Curator server: invalid address"));
				return;
			}
			const url = `http://${networkConfig.host}:${addr.port}/?session=${sessionToken}`;

			watchdog = setInterval(() => {
				if (completed) return;
				if (!browserConnected) {
					const noBrowserTimeoutMs = Math.max(5000, getEffectiveTimeoutMs());
					if (state !== "RESULT_SELECTION") return;
					if (Date.now() - stateChangedAt <= noBrowserTimeoutMs) return;
					if (!markCompleted()) return;
					setImmediate(() => callbacks.onCancel("timeout"));
					return;
				}
				if (shouldTimeoutFromClientIdle()) {
					if (!markCompleted()) return;
					setImmediate(() => callbacks.onCancel("timeout"));
					return;
				}
				if (Date.now() - lastHeartbeatAt <= STALE_THRESHOLD_MS) return;
				const staleReason = state === "RESULT_SELECTION" ? "timeout" : "stale";
				if (!markCompleted()) return;
				setImmediate(() => callbacks.onCancel(staleReason));
			}, WATCHDOG_INTERVAL_MS);

			resolve({
				server,
				url,
				close: () => {
					const wasOpen = markCompleted();
					try { server.close(); } catch {}
					if (wasOpen) {
						setImmediate(() => callbacks.onCancel("stale"));
					}
				},
				pushResult: (queryIndex, data) => {
					if (completed) return;
					nextQueryIndex = Math.max(nextQueryIndex, queryIndex + 1);
					const eventData: CuratorResultEventData = { ...data, queryIndex, query: data.query ?? queries[queryIndex] ?? "" };
					retainStreamedEvent({ event: "result", data: eventData });
					sendSSE("result", eventData);
				},
				pushError: (queryIndex, error, provider, meta) => {
					if (completed) return;
					nextQueryIndex = Math.max(nextQueryIndex, queryIndex + 1);
					const eventData: CuratorSearchErrorEventData = { queryIndex, query: meta?.query ?? queries[queryIndex] ?? "", error, provider, slotIndex: meta?.slotIndex };
					retainStreamedEvent({ event: "search-error", data: eventData });
					sendSSE("search-error", eventData);
				},
				searchesDone: () => {
					if (completed) return;
					searchStreamDone = true;
					sendSSE("done", {});
					state = "RESULT_SELECTION";
					stateChangedAt = Date.now();
				},
				getConnectionState: () => ({
					browserConnected,
					lastHeartbeatAgeMs: Date.now() - lastHeartbeatAt,
				}),
			});
		});
	});
}
