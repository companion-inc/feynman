import { existsSync, readFileSync } from "node:fs";
import { activityMonitor } from "./activity.ts";
import type { SearchOptions, SearchResponse } from "./perplexity.ts";
import { hasCredentialSource, redactCredential, resolveCredential } from "./credential-source.ts";
import { getWebSearchConfigPath } from "./utils.ts";

const BRIGHTDATA_API_URL = "https://api.brightdata.com/request";
const CONFIG_PATH = getWebSearchConfigPath();
const SEARCH_TIMEOUT_MS = 60_000;

// Bright Data proxies a real Google SERP through a provisioned "zone" and bills
// per successful request against it. A SERP zone (Bright Data zone type `serp`)
// and a Web Unlocker zone (type `unblocker`) are separate products with separate
// prices, so the zone used for search is its own required setting and is never
// guessed: the wrong zone is either an opaque 400 or a charge against the wrong
// line of the invoice. Pricing: https://brightdata.com/pricing
const ZONE_PATTERN = /^[A-Za-z0-9_-]+$/;

// Google's own time filter, passed straight through in the proxied URL. Unlike a
// query-text hint this is an engine-side filter, so results outside the window
// are not returned at all.
const RECENCY_TBS: Record<string, string> = {
	day: "qdr:d",
	week: "qdr:w",
	month: "qdr:m",
	year: "qdr:y",
};

interface WebSearchConfig {
	brightdataApiKey?: unknown;
	brightdataSerpZone?: unknown;
}

interface BrightDataOrganicResult {
	link?: unknown;
	title?: unknown;
	description?: unknown;
}

interface BrightDataSerpResponse {
	organic?: BrightDataOrganicResult[];
}

interface BrightDataSearchOptions extends SearchOptions {
	// Accepted for parity with the other providers and deliberately ignored: a
	// SERP zone returns ranked links, never page bodies, so there is nothing to
	// return inline and `inlineContent` is never set.
	includeContent?: boolean;
}

let cachedConfig: WebSearchConfig | null = null;

// `web-search.json` is a credential store: its own text is the secret. V8 quotes a
// window of the source it choked on back inside the `JSON.parse` message — with a
// short file, the whole file — so `{"brightdataApiKey": bd-real-token}` (quotes
// forgotten around a pasted token) produces
// `Unexpected token 'b', "{"brightdataApiKey": bd-real-token}" is not valid JSON`.
// There is no credential to redact against at this point, because the credential is
// what the file was being read for, so the parser's text is dropped entirely and only
// its position is kept. That position is also the only part that cannot carry a
// status-shaped phrase into `providerErrorStatus`.
//
// This is a deliberate divergence from `serpdive.ts:59-62`, `brave.ts:33-36`,
// `anysearch.ts:48-51` and `firecrawl.ts:50-53`, which all quote the parser message
// verbatim. They have the same leak; fixing it for every provider is a separate
// change, and this module is not going to copy the bug forward to justify symmetry.
function configParseDetail(err: unknown): string {
	const position = errorMessage(err).match(/at position \d+(?: \(line \d+ column \d+\))?/i);
	return position ? `not valid JSON, ${position[0]}` : "not valid JSON";
}

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
		throw new Error(`Failed to parse ${CONFIG_PATH}: ${configParseDetail(err)}`);
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error(`Invalid config in ${CONFIG_PATH}: expected a JSON object`);
	}
	cachedConfig = parsed as WebSearchConfig;
	return cachedConfig;
}

async function getApiKey(signal?: AbortSignal): Promise<string | null> {
	return resolveCredential({
		provider: "Bright Data",
		configuredValue: loadConfig().brightdataApiKey,
		environmentValue: process.env.BRIGHTDATA_API_KEY,
		signal,
	});
}

async function requireApiKey(signal?: AbortSignal): Promise<string> {
	const apiKey = await getApiKey(signal);
	if (!apiKey) {
		throw new Error(
			"Bright Data API key not found. Either:\n" +
			`  1. Create ${CONFIG_PATH} with { "brightdataApiKey": "your-key" }\n` +
			"  2. Set BRIGHTDATA_API_KEY environment variable\n" +
			"Get a key at https://brightdata.com/cp/setting/users",
		);
	}
	return apiKey;
}

// A zone name is an account-scoped identifier, not a URL. Validating the charset
// here keeps a stray value out of the request body, where Bright Data reports it
// as a generic 400 that reads like a credential problem.
//
// Total by construction: an invalid zone is `null`, never a throw.
// `isBrightDataAvailable()` reads this, and availability is evaluated outside its
// callers' error handling — `gemini-search.ts` checks it before entering the
// per-provider try/catch, and `index.ts` awaits `getProviderAvailability()` on the
// `web_search` path with nothing around it. A throw here would therefore take
// `web_search` down for Brave and OpenAI too, over one mistyped Bright Data
// setting. The loud, actionable error belongs on the request path, in
// `requireSerpZone()`, where only this provider is affected.
function normalizeZone(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	if (!trimmed) return null;
	return ZONE_PATTERN.test(trimmed) ? trimmed : null;
}

interface ZoneSetting {
	raw: string;
	label: string;
}

// Resolved by presence, not by validity: a `BRIGHTDATA_SERP_ZONE` that is set but
// malformed must not silently hand the request to the config file's zone. The
// setting the user actually filled in is the setting the error names.
function serpZoneSetting(): ZoneSetting | null {
	const fromEnv = process.env.BRIGHTDATA_SERP_ZONE;
	if (typeof fromEnv === "string" && fromEnv.trim()) {
		return { raw: fromEnv.trim(), label: "BRIGHTDATA_SERP_ZONE" };
	}
	const configured = loadConfig().brightdataSerpZone;
	if (typeof configured === "string" && configured.trim()) {
		return { raw: configured.trim(), label: `brightdataSerpZone in ${CONFIG_PATH}` };
	}
	return null;
}

function getSerpZone(): string | null {
	const setting = serpZoneSetting();
	return setting ? normalizeZone(setting.raw) : null;
}

// There is no safe default, and in particular no fallback to a Web Unlocker zone:
// `serp` and `unblocker` are different Bright Data zone types, priced differently,
// and an Unlocker zone does not return SERP JSON — substituting one buys a
// confusing paid failure instead of a search. A missing or malformed SERP zone
// fails loudly here, before anything billable happens.
function requireSerpZone(): string {
	const setting = serpZoneSetting();
	const zone = setting ? normalizeZone(setting.raw) : null;
	if (zone) return zone;
	if (setting) {
		throw new Error(
			`Bright Data SERP zone is invalid: ${setting.label} must be a zone name of letters, digits, "-", or "_" ` +
			`(got "${untrustedText(setting.raw, 60)}").\n` +
			"The zone must be of Bright Data type `serp`; a Web Unlocker zone (type `unblocker`) is a different product and does not return SERP JSON.\n" +
			"Create or rename one at https://brightdata.com/cp/zones",
		);
	}
	throw new Error(
		"Bright Data SERP zone is invalid or missing. Either:\n" +
		`  1. Create ${CONFIG_PATH} with { "brightdataSerpZone": "your_serp_zone" }\n` +
		"  2. Set BRIGHTDATA_SERP_ZONE environment variable\n" +
		"The zone must be of Bright Data type `serp`; a Web Unlocker zone is a different product and does not return SERP JSON.\n" +
		"Create one at https://brightdata.com/cp/zones",
	);
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

interface DomainFilters {
	include: string[];
	exclude: string[];
}

function parseDomainFilter(domainFilter: string[] | undefined): DomainFilters {
	const filters: DomainFilters = { include: [], exclude: [] };
	if (!domainFilter?.length) return filters;
	for (const raw of domainFilter) {
		const domain = normalizeDomain(raw);
		if (!domain) continue;
		const target = raw.trim().startsWith("-") ? filters.exclude : filters.include;
		if (!target.includes(domain)) target.push(domain);
	}
	return filters;
}

// Bright Data has no domain parameter, but the engine behind it is Google, so the
// filter is expressed the way Google expresses it: as `site:` operators inside
// the query. That asks the engine for the right pages instead of discarding the
// wrong ones locally — the difference SERPdive documents as a limitation.
function buildSearchQuery(query: string, filters: DomainFilters): string {
	const parts = [query];
	if (filters.include.length === 1) {
		parts.push(`site:${filters.include[0]}`);
	} else if (filters.include.length > 1) {
		parts.push(filters.include.map((domain) => `site:${domain}`).join(" OR "));
	}
	for (const domain of filters.exclude) {
		parts.push(`-site:${domain}`);
	}
	return parts.join(" ");
}

function buildSerpUrl(searchQuery: string, numResults: number, recencyFilter: SearchOptions["recencyFilter"]): string {
	const params = new URLSearchParams({ q: searchQuery });
	// One SERP request is billed once whatever `num` says, so asking for a little
	// headroom is free and leaves something to keep after local re-filtering.
	params.set("num", String(Math.min(numResults + 5, 20)));
	const tbs = recencyFilter ? RECENCY_TBS[recencyFilter] : undefined;
	if (tbs) params.set("tbs", tbs);
	// `brd_json=1` is what makes Bright Data return the SERP as JSON instead of
	// Google's HTML. Without it `data_format: "parsed_light"` has nothing to read.
	params.set("brd_json", "1");
	return `https://www.google.com/search?${params.toString()}`;
}

function domainMatches(hostname: string, domain: string): boolean {
	return hostname === domain || hostname.endsWith(`.${domain}`);
}

// `site:` narrows the SERP but does not guarantee it: Google still mixes in
// related hosts, and an OR group is honoured loosely. The same filter is applied
// again here so the contract holds on what is actually returned.
function passesDomainFilters(url: string, filters: DomainFilters): boolean {
	if (filters.include.length === 0 && filters.exclude.length === 0) return true;
	let hostname: string;
	try {
		hostname = new URL(url).hostname.toLowerCase();
	} catch {
		return false;
	}
	if (filters.exclude.some((domain) => domainMatches(hostname, domain))) return false;
	if (filters.include.length === 0) return true;
	return filters.include.some((domain) => domainMatches(hostname, domain));
}

function requestSignal(signal?: AbortSignal): AbortSignal {
	const timeout = AbortSignal.timeout(SEARCH_TIMEOUT_MS);
	return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function errorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

// Text that did not originate here — a proxied response body, a `JSON.parse`
// message quoting that body, a config value — is quoted into Error messages, and
// `gemini-search.ts` classifies routing failures by reading a status back out of
// the message text (`providerErrorStatus`, /\b(?:error|status|http)\s+(\d{3})\b/).
// A proxied Google interstitial that merely mentions "Error 503" would otherwise
// be read as *our* status and retried as a transient failure, when what actually
// happened is that a 200 was billed and is unusable. Status-shaped phrases in
// quoted text are rewritten to `upstream <code>`: the number is still reported,
// but only this module's own wording can name the status we received.
const STATUS_SHAPED_PATTERN = /\b(?:error|status|http)[\s:=-]{1,4}(\d{3})\b/gi;

// `providerErrorStatus` is not the only thing that reads our message.
// `classifyProviderError` also matches bare keyword phrases, and its branch order
// decides which ones can reach us: `searchRouting.fallbackOn` accepts only
// `transient`, `quota` and `network`, and of those three only the `quota` branch
// (/rate limit|quota|too many requests/) runs BEFORE the `invalid-response` branch
// that this module's own wording always triggers. So a billed 200 whose body reads
// "You have exceeded your rate limit" would classify as `quota`, and with
// `fallbackOn: ["quota"]` the user is charged, silently served the next provider's
// answer, and shown no diagnostic — the failure mode this module exists to prevent.
// `transient` and `network` sit after `invalid-response` and are unreachable for the
// same reason; the test suite pins that ordering assumption rather than trusting it.
//
// The phrase is replaced rather than removed: the reader still learns the upstream
// page mentioned a rate limit, but no substring of the replacement matches any
// classifier branch ("rate-limit" is hyphenated, so /rate limit/ cannot match).
const QUOTA_SHAPED_PATTERN = /rate limit|quota|too many requests/gi;

// The complete inventory of places foreign text is quoted into a message or a log
// line, and what each one is required to apply. Adding a fifth means adding it here:
//
// | site                                            | redactCredential | untrustedText |
// | ----------------------------------------------- | ---------------- | ------------- |
// | non-2xx response body                           | yes              | yes (300)     |
// | invalid-JSON raw body                           | yes              | yes (300)     |
// | Bright Data's own 200 error envelope            | yes              | yes (200)     |
// | transport/abort error from `fetch`               | yes              | n/a — see (a) |
// | rejected zone value                             | n/a — see (b)    | yes (60)      |
// | `JSON.parse` message on a response body         | n/a — see (c)    | n/a — see (c) |
// | `JSON.parse` failure on `web-search.json`       | n/a — see (c)    | n/a — see (c) |
//
// (a) That message is generated locally by undici or by `AbortSignal`, never by the
//     proxied page, and the abort branch below matches on it; collapsing and
//     truncating it would buy nothing and could break that match.
// (b) The zone is resolved *before* the credential on purpose, so that a config
//     mistake never spawns a `!command` resolver. There is therefore no key to redact
//     against yet, and the value being echoed is the user's own zone setting.
// (c) Neither parser message is quoted at all, so neither needs a filter or a cap. V8
//     embeds a *prefix* of the offending input in its message, and `redactCredential`
//     substitutes whole values, so a prefix cannot be redacted out of it. Dropping the
//     message removes the leak by construction — see `configParseDetail` and the
//     `JSON.parse` catch on the response path.

// Truncation happens BEFORE the rewrite, and the order is the whole point.
// `STATUS_SHAPED_PATTERN` requires `(\d{3})\b`, so `error 5031` is deliberately left
// alone — it is not a status. Sanitising first and slicing second let the cut land on
// the 4th digit and hand back a freshly forged `error 503`, which
// `gemini-search.ts`'s `providerErrorStatus` then reads as *our* status: a billed 200
// classified `transient` and silently re-run on the next provider. Slicing first means
// the rewrite always sees the exact text that will be quoted.
//
// The rewrite runs last and is therefore allowed to push the result a few characters
// past `limit` ("error 503" → "upstream 503"). `limit` bounds how much upstream text is
// quoted, not the final string length; a second `slice()` after the rewrite would
// re-open exactly the hole this ordering closes.
function untrustedText(text: string, limit = 300): string {
	return text
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, limit)
		.replace(STATUS_SHAPED_PATTERN, "upstream $1")
		.replace(QUOTA_SHAPED_PATTERN, "upstream rate-limit notice");
}

function invalidResponse(zone: string, message: string): Error {
	return new Error(`Bright Data API returned invalid response for zone ${zone}: ${message}`);
}

// Bright Data reports some failures inside a normal HTTP 200 body — e.g.
// `{"error":"zone not found","code":"zone_missing"}` — because `format: "raw"`
// means the HTTP layer describes the proxy hop, not the outcome.
//
// The envelope is upstream text, so it gets the same two-step treatment as every other
// quoted body: `redactCredential` first (an upstream "token <yours> is not valid for
// this zone" must not reprint the token), then `untrustedText`.
function envelopeError(envelope: Record<string, unknown>, apiKey: string | null): string | null {
	const parts: string[] = [];
	const { error, errors } = envelope;
	if (typeof error === "string" && error.trim()) parts.push(error.trim());
	else if (error && typeof error === "object") parts.push(JSON.stringify(error));
	if (Array.isArray(errors) && errors.length > 0) parts.push(JSON.stringify(errors));
	else if (typeof errors === "string" && errors.trim()) parts.push(errors.trim());
	if (parts.length === 0) return null;
	for (const key of ["code", "error_code"]) {
		const code = envelope[key];
		if (typeof code === "string" && code.trim()) parts.push(`${key} ${code.trim()}`);
		else if (typeof code === "number") parts.push(`${key} ${code}`);
	}
	return untrustedText(redactCredential(parts.join(", "), apiKey), 200);
}

// The envelope is validated strictly — every branch below throws — because a
// shape this provider cannot read means the request was billed for something
// unusable, and returning `{ answer: "", results: [] }` would report a paid
// failure as "the web had no answer". That includes the two shapes that are JSON
// but not a SERP: Bright Data's own error envelope, and an envelope with no
// `organic` array at all. anysearch.ts rejects the equivalent shape the same way.
// Individual organic entries are the one deliberate exception: a real SERP mixes
// in entries with no link, and one of those must not throw away a page of results
// that was already paid for.
function parseSerpResponse(value: unknown, zone: string, apiKey: string | null): BrightDataSerpResponse {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw invalidResponse(zone, "expected an object envelope");
	}
	const envelope = value as Record<string, unknown>;
	const upstreamError = envelopeError(envelope, apiKey);
	if (upstreamError) {
		throw invalidResponse(zone, `Bright Data reported an error instead of a SERP: ${upstreamError}`);
	}
	if (envelope.organic === undefined || envelope.organic === null) {
		throw invalidResponse(
			zone,
			"expected an organic array and the envelope carried none. A `serp` zone queried with brd_json=1 " +
			"returns { organic: [...] }; a zone of type `unblocker`, or a missing brd_json=1, is the usual cause",
		);
	}
	if (!Array.isArray(envelope.organic)) throw invalidResponse(zone, "expected organic array");
	const organic: BrightDataOrganicResult[] = [];
	for (const [index, entry] of envelope.organic.entries()) {
		if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
			throw invalidResponse(zone, `expected organic[${index}] object`);
		}
		organic.push(entry as BrightDataOrganicResult);
	}
	return { organic };
}

function mapResults(
	organic: BrightDataOrganicResult[] | undefined,
	numResults: number,
	filters: DomainFilters,
): SearchResponse["results"] {
	if (!Array.isArray(organic)) return [];
	const mapped: SearchResponse["results"] = [];
	for (const item of organic) {
		const url = typeof item.link === "string" ? item.link.trim() : "";
		if (!url || !passesDomainFilters(url, filters)) continue;
		const title = typeof item.title === "string" ? item.title.trim() : "";
		mapped.push({
			title: title || `Source ${mapped.length + 1}`,
			url,
			snippet: typeof item.description === "string" ? item.description.replace(/\s+/g, " ").trim() : "",
		});
		if (mapped.length >= numResults) break;
	}
	return mapped;
}

// A SERP zone returns ranked links, never a synthesized answer, so one is
// assembled from the sources — the same shape brave.ts and searxng.ts produce.
function buildAnswer(results: SearchResponse["results"]): string {
	return results
		.map((result) => result.snippet
			? `${result.snippet}\nSource: ${result.title} (${result.url})`
			: `Source: ${result.title} (${result.url})`)
		.join("\n\n");
}

// Both halves are required: a token with no zone cannot make a request, and a
// zone with no token cannot either. Availability therefore checks the config this
// surface actually needs rather than merely a key, the way firecrawl.ts's
// `isFirecrawlAvailable()` checks its required base URL. Reporting "unavailable"
// for a half-finished setup keeps the incomplete case out of provider selection
// instead of turning it into a failed search.
//
// It is also a pure predicate that cannot throw. Callers evaluate it outside
// their error handling — `gemini-search.ts` before the per-provider try/catch,
// `index.ts` in the uncaught `getProviderAvailability()` await on the `web_search`
// path — so any throw from a malformed Bright Data setting or an unparseable
// config file would break search for every other provider too. Misconfiguration
// makes this provider unavailable here; the request path reports it in detail.
export function isBrightDataAvailable(): boolean {
	try {
		if (getSerpZone() === null) return false;
		return hasCredentialSource({
			provider: "Bright Data",
			configuredValue: loadConfig().brightdataApiKey,
			environmentValue: process.env.BRIGHTDATA_API_KEY,
		});
	} catch {
		return false;
	}
}

export async function searchWithBrightData(query: string, options: BrightDataSearchOptions = {}): Promise<SearchResponse> {
	// Zone before key: a config mistake must not spawn a `!command` credential
	// resolver, and must not reach a billable endpoint.
	const zone = requireSerpZone();
	const apiKey = await requireApiKey(options.signal);
	const numResults = normalizeCount(options.numResults);
	const filters = parseDomainFilter(options.domainFilter);
	const searchQuery = buildSearchQuery(query, filters);
	const body: Record<string, unknown> = {
		url: buildSerpUrl(searchQuery, numResults, options.recencyFilter),
		zone,
		// `format: "raw"` returns the proxied body verbatim; `data_format` selects
		// Bright Data's own parsing of it. `parsed_light` is the SERP shape —
		// { organic: [{ link, title, description }] } — and carries no page bodies.
		format: "raw",
		data_format: "parsed_light",
	};

	const activityId = activityMonitor.logStart({ type: "api", query: searchQuery });
	let response: Response;
	try {
		response = await fetch(BRIGHTDATA_API_URL, {
			method: "POST",
			headers: {
				"Authorization": `Bearer ${apiKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(body),
			signal: requestSignal(options.signal),
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

	// Every thrown message names the zone the request was billed against: with two
	// Bright Data zone types in play, "which zone did I pay on" is the first thing
	// a paid failure has to answer.
	if (!response.ok) {
		activityMonitor.logComplete(activityId, response.status);
		const errorText = untrustedText(redactCredential(await response.text(), apiKey));
		throw new Error(`Bright Data API error ${response.status} for zone ${zone}: ${errorText}`);
	}

	// The body is read as text before parsing on purpose. `format: "raw"` means a
	// 200 can still carry an upstream interstitial instead of SERP JSON, and a
	// bare parser error ("Unexpected token <") hides a request that was billed.
	// Quoting the body is the only way the user learns what they paid for.
	const raw = await response.text();
	if (!raw.trim()) {
		activityMonitor.logComplete(activityId, response.status);
		throw new Error(`Bright Data API returned empty response for zone ${zone}`);
	}

	let rawData: unknown;
	try {
		rawData = JSON.parse(raw);
	} catch (err) {
		activityMonitor.logComplete(activityId, response.status);
		// The parser's own message is deliberately NOT quoted here. V8 embeds a short
		// window of the offending input in it (`Unexpected token 'x', "xxxxxxxx-x"...`),
		// and that window is a *prefix* of the body — so when the body starts with the
		// credential, `redactCredential` cannot match it: it replaces the whole key, and
		// a 10-character prefix is not the whole key. Redacting the detail half therefore
		// still printed 10 cleartext characters of the token. The detail also adds nothing
		// this message does not already carry: the wording names the failure and the body
		// below shows what arrived, filtered. Dropping it removes the leak by construction
		// rather than by pattern-matching.
		const body = untrustedText(redactCredential(raw, apiKey));
		throw new Error(`Bright Data API returned invalid JSON for zone ${zone}: ${body}`);
	}

	let data: BrightDataSerpResponse;
	try {
		data = parseSerpResponse(rawData, zone, apiKey);
	} catch (err) {
		activityMonitor.logComplete(activityId, response.status);
		throw err;
	}

	activityMonitor.logComplete(activityId, response.status);
	const results = mapResults(data.organic, numResults, filters);
	return { answer: buildAnswer(results), results };
}
