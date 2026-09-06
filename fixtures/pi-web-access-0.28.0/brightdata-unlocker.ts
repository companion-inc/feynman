import { existsSync, readFileSync } from "node:fs";
import { activityMonitor } from "./activity.ts";
import { hasCredentialSource, redactCredential, resolveCredential } from "./credential-source.ts";
import type { ExtractedContent, ExtractOptions } from "./extract.ts";
import { validateRemoteUrl, type Lookup } from "./ssrf-protection.ts";
import { getWebSearchConfigPath } from "./utils.ts";

const CONFIG_PATH = getWebSearchConfigPath();
const BRIGHTDATA_REQUEST_URL = "https://api.brightdata.com/request";
const EXTRACT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const ZONE_PATTERN = /^[a-z0-9_-]+$/i;

export interface BrightDataSsrfOptions {
	allowRanges: string[];
	trustEnvProxy: boolean;
}

export interface BrightDataExtractOptions extends Pick<ExtractOptions, "timeoutMs" | "lookup"> {
	ssrf?: BrightDataSsrfOptions;
}

interface BrightDataConfig {
	brightdataApiKey?: unknown;
	brightdataUnlockerZone?: unknown;
}

let cachedConfig: BrightDataConfig | null = null;

// V8's JSON.parse message quotes a slice of the source text around the offending
// token — `JSON.parse('{"brightdataApiKey": bd-live-abc123}')` reports
// `Unexpected token 'b', ..."aApiKey": bd-live-ab"... is not valid JSON`. This
// file is where the API key lives, so echoing that message verbatim (which
// firecrawl.ts:50 and ssrf-protection.ts:39 both do) puts a fragment of the
// credential into an error string that extract.ts surfaces to the user. Only the
// position is safe to repeat; the snippet never is. The `Failed to parse ` prefix
// is preserved because extract.ts's isConfigParseError matches on it.
function parseFailureDetail(err: unknown): string {
	const message = err instanceof Error ? err.message : String(err);
	const position = message.match(/at position \d+(?: \(line \d+ column \d+\))?/);
	return position ? `invalid JSON ${position[0]}` : "invalid JSON";
}

function loadConfig(): BrightDataConfig {
	if (cachedConfig) return cachedConfig;
	if (!existsSync(CONFIG_PATH)) {
		cachedConfig = {};
		return cachedConfig;
	}
	const raw = readFileSync(CONFIG_PATH, "utf8");
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (err) {
		throw new Error(`Failed to parse ${CONFIG_PATH}: ${parseFailureDetail(err)}`);
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error(`Invalid config in ${CONFIG_PATH}: expected a JSON object`);
	}
	cachedConfig = parsed as BrightDataConfig;
	return cachedConfig;
}

export function clearBrightDataUnlockerConfigCache(): void {
	cachedConfig = null;
}

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

function zoneSetting(): ZoneSetting | null {
	const fromEnv = process.env.BRIGHTDATA_UNLOCKER_ZONE;
	if (typeof fromEnv === "string" && fromEnv.trim()) return { raw: fromEnv.trim(), label: "BRIGHTDATA_UNLOCKER_ZONE" };
	const configured = loadConfig().brightdataUnlockerZone;
	if (typeof configured === "string" && configured.trim()) return { raw: configured.trim(), label: `brightdataUnlockerZone in ${CONFIG_PATH}` };
	return null;
}

function getZone(): string | null {
	const setting = zoneSetting();
	return setting ? normalizeZone(setting.raw) : null;
}

// A zone is never defaulted. Zones are per-account names bound to a product
// type, they are billed separately, and a guess is either an HTTP 400 or a
// charge against the wrong product. The SERP zone from the search provider is
// a different zone type and cannot serve Web Unlocker requests.
function requireZone(): string {
	const setting = zoneSetting();
	const zone = setting ? normalizeZone(setting.raw) : null;
	if (zone) return zone;
	if (setting) {
		throw new Error(
			`Invalid Bright Data Unlocker zone: ${setting.label} must be a zone name of letters, digits, "-", or "_". ` +
			"The zone must be of type \"unblocker\"; a SERP zone will not serve Web Unlocker requests.",
		);
	}
	throw new Error(
		"Bright Data Web Unlocker zone not configured. Either:\n" +
		`  1. Set brightdataUnlockerZone in ${CONFIG_PATH}\n` +
		"  2. Set BRIGHTDATA_UNLOCKER_ZONE environment variable\n" +
		"The zone must be of type \"unblocker\"; a SERP zone will not serve Web Unlocker requests.",
	);
}

async function getApiKey(signal?: AbortSignal): Promise<string> {
	const apiKey = await resolveCredential({
		provider: "Bright Data",
		configuredValue: loadConfig().brightdataApiKey,
		environmentValue: process.env.BRIGHTDATA_API_KEY,
		signal,
	});
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

function requestSignal(timeoutMs: number, signal?: AbortSignal): AbortSignal {
	const timeout = AbortSignal.timeout(timeoutMs);
	return signal ? AbortSignal.any([timeout, signal]) : timeout;
}

function errorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

function isAbortError(err: unknown): boolean {
	return errorMessage(err).toLowerCase().includes("abort");
}

function ssrfOptions(options?: BrightDataExtractOptions): { lookup?: Lookup; allowRanges: string[]; trustEnvProxy: boolean } {
	return {
		allowRanges: options?.ssrf?.allowRanges ?? [],
		trustEnvProxy: options?.ssrf?.trustEnvProxy ?? false,
		...(options?.lookup ? { lookup: options.lookup } : {}),
	};
}

function withoutSensitiveHeaders(headers: Record<string, string>): Record<string, string> {
	const next = { ...headers };
	delete next.Authorization;
	delete next.authorization;
	delete next.Cookie;
	delete next.cookie;
	delete next["X-API-Key"];
	delete next["x-api-key"];
	return next;
}

async function fetchBrightDataApi(
	url: string,
	init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal },
	options: BrightDataExtractOptions | undefined,
): Promise<Response> {
	let current = await validateRemoteUrl(url, ssrfOptions(options));
	let headers = init.headers;
	// `redirect: "manual"` is what makes this loop exist: with the default "follow"
	// the runtime resolves the chain itself, the final response is a 200, and the
	// per-hop validateRemoteUrl / credential strip / hop cap below all become dead
	// code. Tests assert the option is present on every hop for that reason.
	//
	// The loop is intentionally unbounded (`for (;;)`) with the cap enforced inside:
	// a `redirects <= DEFAULT_MAX_REDIRECTS` header would make the post-loop
	// statement provably unreachable, which is exactly the dead line firecrawl.ts
	// carries at :186. Every exit is a `return` or a `throw` written here.
	for (let redirects = 0; ; redirects++) {
		const response = await fetch(current, { ...init, headers, redirect: "manual" });
		if (!REDIRECT_STATUSES.has(response.status)) return response;

		const location = response.headers.get("location");
		if (!location) return response;
		if (redirects === DEFAULT_MAX_REDIRECTS) throw new Error(`Too many redirects fetching ${current.toString()}`);

		const next = await validateRemoteUrl(new URL(location, current), ssrfOptions(options));
		if (next.origin !== current.origin) headers = withoutSensitiveHeaders(headers);
		current = next;
	}
}

function unlockerBody(url: string, zone: string): Record<string, unknown> {
	return {
		url,
		zone,
		format: "raw",
		data_format: "markdown",
	};
}

async function brightDataRequest(
	url: string,
	zone: string,
	signal: AbortSignal | undefined,
	options: BrightDataExtractOptions | undefined,
): Promise<string> {
	const apiKey = await getApiKey(signal);
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
		Authorization: `Bearer ${apiKey}`,
	};
	const activityId = activityMonitor.logStart({ type: "fetch", url });
	try {
		const response = await fetchBrightDataApi(BRIGHTDATA_REQUEST_URL, {
			method: "POST",
			headers,
			body: JSON.stringify(unlockerBody(url, zone)),
			signal: requestSignal(options?.timeoutMs ?? EXTRACT_TIMEOUT_MS, signal),
		}, options);
		if (!response.ok) {
			const errorText = await response.text().catch(() => "");
			throw new Error(`Bright Data Web Unlocker error ${response.status}: ${redactCredential(errorText, apiKey).slice(0, 300)}`);
		}
		const text = await response.text();
		activityMonitor.logComplete(activityId, response.status);
		return text;
	} catch (err) {
		const message = errorMessage(err);
		const redactedMessage = redactCredential(message, apiKey);
		if (isAbortError(err)) activityMonitor.logComplete(activityId, 0);
		else activityMonitor.logError(activityId, redactedMessage);
		if (redactedMessage === message) throw err;
		const redactedError = new Error(redactedMessage);
		if (err instanceof Error) redactedError.name = err.name;
		throw redactedError;
	}
}

function headingTitle(text: string): string {
	const match = text.match(/^#{1,2}\s+(.+)/m);
	if (!match) return "";
	return match[1].replace(/\*+/g, "").trim();
}

export function isBrightDataUnlockerAvailable(): boolean {
	if (getZone() === null) return false;
	return hasCredentialSource({
		provider: "Bright Data",
		configuredValue: loadConfig().brightdataApiKey,
		environmentValue: process.env.BRIGHTDATA_API_KEY,
	});
}

export async function extractWithBrightDataUnlocker(
	url: string,
	signal?: AbortSignal,
	options?: BrightDataExtractOptions,
): Promise<ExtractedContent | null> {
	const zone = requireZone();
	await validateRemoteUrl(url, ssrfOptions(options));
	const raw = await brightDataRequest(url, zone, signal, options);
	// Bright Data bills a successful request whatever its length, so short
	// content is returned rather than discarded: a paywall stub or consent page
	// is a useful answer, and silently dropping it would hide the spend.
	const content = raw.trim();
	if (!content) return null;
	return { url, title: headingTitle(content), content, error: null };
}
