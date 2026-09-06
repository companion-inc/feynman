import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
	PI_WEB_ACCESS_WINDOWS_COOKIES_SHA256,
	patchPiWebAccessWindowsCookiesSource,
} from "./pi-web-access-windows-cookies-patch.mjs";

// Keep the exact upstream sanitizer in the fixture set so restored and
// installed runtimes cannot silently omit the file while the remaining
// Feynman-specific Firecrawl redirect and Windows DPAPI corrections apply.
export const PI_WEB_ACCESS_FORWARD_FILE_TARGETS = [
	"data-uri-sanitize.ts",
];

const PI_WEB_ACCESS_DATA_URI_SANITIZER_SHA256 =
	"2f63c0b0b5009eb9b92ca27d041707c3f7d0d0042ea0ee8a921ad0813f332ec0";

function countOccurrences(source, marker) {
	return source.split(marker).length - 1;
}

function requireMarkerCounts(source, relativePath, expectations, surface, version) {
	for (const [marker, expectedCount] of expectations) {
		const actualCount = countOccurrences(source, marker);
		if (actualCount !== expectedCount) {
			throw new Error(
				`Unsupported pi-web-access ${version} ${surface} ${relativePath}: expected ${expectedCount} occurrences of ${marker}, found ${actualCount}`,
			);
		}
	}
}

function rejectMarkers(source, relativePath, markers, surface, version) {
	for (const marker of markers) {
		if (source.includes(marker)) {
			throw new Error(
				`Unsupported pi-web-access ${version} ${surface} ${relativePath}: stale ${marker}`,
			);
		}
	}
}

export function assertPiWebAccessForwardFixSources(sources, surface, version) {
	for (const relativePath of [
		"index.ts",
		"extract.ts",
		"firecrawl.ts",
		"gemini-search.ts",
		"ssrf-protection.ts",
		...PI_WEB_ACCESS_FORWARD_FILE_TARGETS,
	]) {
		if (!sources.has(relativePath)) {
			throw new Error(`Unsupported pi-web-access ${version} ${surface}: missing ${relativePath}`);
		}
	}

	const indexSource = sources.get("index.ts");
	requireMarkerCounts(indexSource, "index.ts", [
		['import { execFileSync, spawn } from "node:child_process";', 1],
		['const child = spawn("xdg-open", [url], { detached: true, stdio: "ignore" });', 1],
		["const timer = setTimeout(resolve, 100);", 1],
		["child.unref();", 1],
		['export type { ProviderAvailability } from "./gemini-search.ts";', 1],
		['export type CuratorProvider = Exclude<SearchProvider, "auto">;', 1],
		["function shouldUseOpenAICodexDefault(", 1],
		["export function resolveCuratorDefaultProvider(", 1],
		['if (available.openai) return "openai";', 1],
		["preferOpenAICodexDefault = false,", 1],
		["shouldPreferOpenAI(options, preferOpenAICodexDefault)", 1],
	], surface, version);
	rejectMarkers(indexSource, "index.ts", [
		'import { execFileSync } from "node:child_process";',
		'await pi.exec("xdg-open", [url])',
		"\ninterface ProviderAvailability {",
		'\ntype CuratorProvider = Exclude<SearchProvider, "auto">;',
		"defaultProvider: resolveProvider(provider, availableProviders, options),",
		"const preferOpenAI = shouldPreferOpenAI(options);",
	], surface, version);

	const extractSource = sources.get("extract.ts");
	requireMarkerCounts(extractSource, "extract.ts", [
		['import { sanitizeInlineDataUris } from "./data-uri-sanitize.ts";', 1],
		['if (options?.mode === "raw") return results;', 1],
		['const sanitized = sanitizeInlineDataUris(result.content, `urls[${index}].content`);', 1],
	], surface, version);
	rejectMarkers(
		extractSource,
		"extract.ts",
		['return Promise.all(urls.map((url) => fetchLimit(() => extractContent(url, signal, options))));'],
		surface,
		version,
	);

	const geminiSearchSource = sources.get("gemini-search.ts");
	requireMarkerCounts(geminiSearchSource, "gemini-search.ts", [
		["function isOpenAICodexSelected(", 1],
		["async function tryOpenAIInAuto(", 1],
		["let triedOpenAI = false;", 1],
		["if (!options.extensionContext || isOpenAICodexSelected(options.extensionContext)) {", 1],
		["if (!triedOpenAI) {", 1],
	], surface, version);
	rejectMarkers(
		geminiSearchSource,
		"gemini-search.ts",
		["\n\tif (shouldTryOpenAIInAuto(options)) {"],
		surface,
		version,
	);

	const firecrawlSource = sources.get("firecrawl.ts");
	requireMarkerCounts(firecrawlSource, "firecrawl.ts", [
		['import net from "node:net";', 1],
		["function isLoopbackApiUrl(url: URL): boolean {", 1],
		["function firecrawlApiSsrfOptions(", 1],
		["const loopbackApiOrigin = isLoopbackApiUrl(initialUrl) ? initialUrl.origin : null;", 1],
		["firecrawlApiSsrfOptions(options, loopbackApiOrigin !== null)", 1],
		["firecrawlApiSsrfOptions(options, redirectUrl.origin === loopbackApiOrigin)", 1],
	], surface, version);
	rejectMarkers(firecrawlSource, "firecrawl.ts", [
		"const allowLoopback = isLoopbackApiUrl(new URL(url));",
		"firecrawlApiSsrfOptions(options, allowLoopback)",
		"let current = await validateRemoteUrl(url, ssrfOptions(options));",
		"const next = await validateRemoteUrl(new URL(location, current), ssrfOptions(options));",
	], surface, version);

	const ssrfSource = sources.get("ssrf-protection.ts");
	requireMarkerCounts(ssrfSource, "ssrf-protection.ts", [
		['const LOOPBACK_ALLOW_RANGES = ["127.0.0.0/8", "::1", "::ffff:127.0.0.0/104"];', 1],
		["allowLoopback?: boolean;", 1],
		['if (hostname === "localhost") {', 1],
		["if (options.allowLoopback === true) return url;", 1],
		["const addressAllowRanges = options.allowLoopback === true", 1],
	], surface, version);
	rejectMarkers(
		ssrfSource,
		"ssrf-protection.ts",
		['if (hostname === "localhost" || hostname.endsWith(".localhost")) {'],
		surface,
		version,
	);

	const chromeCookiesSource = sources.get("chrome-cookies.ts");
	const chromeCookiesDigest = createHash("sha256")
		.update(chromeCookiesSource.replace(/\r\n/g, "\n"))
		.digest("hex");
	if (chromeCookiesDigest !== PI_WEB_ACCESS_WINDOWS_COOKIES_SHA256) {
		throw new Error(
			`Unsupported pi-web-access ${version} ${surface} chrome-cookies.ts: expected ${PI_WEB_ACCESS_WINDOWS_COOKIES_SHA256}, found ${chromeCookiesDigest}`,
		);
	}
	requireMarkerCounts(chromeCookiesSource, "chrome-cookies.ts", [
		['const WINDOWS_BROWSER_CONFIGS: BrowserConfig[] = [', 1],
		['{ id: "chrome", name: "Chrome", baseDir: "Google/Chrome/User Data", usesLocalAppData: true }', 1],
		['{ id: "edge", name: "Edge", baseDir: "Microsoft/Edge/User Data", usesLocalAppData: true }', 1],
		["const configs = options.browser ? platformConfigs.filter((config) => config.id === options.browser) : platformConfigs;", 1],
		["Configured Chromium profile must resolve inside the browser profile root.", 1],
		["getLastGoogleCookieDiagnosticDetails", 1],
		['const networkCookies = join(profilePath, "Network", "Cookies");', 1],
		["function decryptWindowsCookieValue(", 1],
		['encrypted.subarray(0, 3).toString("utf8") === "v20"', 1],
		["async function readWindowsEncryptionKey(", 1],
		["Add-Type -AssemblyName System.Security", 1],
			["[Console]::In.ReadToEnd()", 1],
			['execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script]', 1],
			['child.stdin.end(protectedData.toString("base64"))', 1],
			["function chromeExpiryMillisExpr(): string", 1],
			["CAST(expires_utc / 1000 AS INTEGER)", 1],
			["function chromeExpiryNowMillis(): number", 1],
		], surface, version);
	rejectMarkers(chromeCookiesSource, "chrome-cookies.ts", [
		'currentPlatform === "darwin" ? MACOS_BROWSER_CONFIGS : currentPlatform === "linux" ? LINUX_BROWSER_CONFIGS : []',
		'columns.columns.has("expires_utc") ? "expires_utc" : "0 AS expires_utc"',
		"function chromeExpiryNowMicros(): number",
		"function chromeExpiryNowSeconds(): number",
		"CAST((expires_utc / 1000000) AS INTEGER)",
	], surface, version);

	const sanitizerSource = sources.get("data-uri-sanitize.ts");
	const sanitizerDigest = createHash("sha256")
		.update(sanitizerSource.replace(/\r\n/g, "\n"))
		.digest("hex");
	if (sanitizerDigest !== PI_WEB_ACCESS_DATA_URI_SANITIZER_SHA256) {
		throw new Error(
			`Unsupported pi-web-access ${version} ${surface} data-uri-sanitize.ts: expected ${PI_WEB_ACCESS_DATA_URI_SANITIZER_SHA256}, found ${sanitizerDigest}`,
		);
	}
	requireMarkerCounts(sanitizerSource, "data-uri-sanitize.ts", [
		["export function sanitizeInlineDataUris(", 1],
		["retrieval: \"not-retained\";", 1],
		["MAX_DATA_URI_HEADER_CHARS = 1024", 1],
	], surface, version);
}

const EXTRACT_DATA_URI_IMPORT =
	'import { sanitizeInlineDataUris } from "./data-uri-sanitize.ts";';
const EXTRACT_DATA_URI_IMPORT_ANCHOR =
	'import { getBrowserCookiesForHosts, getLastBrowserCookieDiagnostic } from "./chrome-cookies.ts";';
const EXTRACT_FETCH_ALL_ORIGINAL = [
	"export async function fetchAllContent(",
	"\turls: string[],",
	"\tsignal?: AbortSignal,",
	"\toptions?: ExtractOptions,",
	"): Promise<ExtractedContent[]> {",
	"\treturn Promise.all(urls.map((url) => fetchLimit(() => extractContent(url, signal, options))));",
	"}",
].join("\n");
const EXTRACT_FETCH_ALL_PATCHED = [
	"export async function fetchAllContent(",
	"\turls: string[],",
	"\tsignal?: AbortSignal,",
	"\toptions?: ExtractOptions,",
	"): Promise<ExtractedContent[]> {",
	"\tconst results = await Promise.all(urls.map((url) => fetchLimit(() => extractContent(url, signal, options))));",
	'\tif (options?.mode === "raw") return results;',
	"\t// Inline data: URIs in extracted markdown would otherwise flow into tool",
	"\t// results and the fetch cache as opaque base64; typed thumbnail/frame image",
	"\t// blocks are deliberate outputs and are left untouched.",
	"\treturn results.map((result, index) => {",
	"\t\tif (!result.content) return result;",
	"\t\tconst sanitized = sanitizeInlineDataUris(result.content, `urls[${index}].content`);",
	"\t\treturn sanitized.omissions.length > 0 ? { ...result, content: sanitized.text } : result;",
	"\t});",
	"}",
].join("\n");

function patchInlineDataUriSource(source) {
	let patched = source;
	if (!patched.includes(EXTRACT_DATA_URI_IMPORT) && patched.includes(EXTRACT_DATA_URI_IMPORT_ANCHOR)) {
		patched = patched.replace(
			EXTRACT_DATA_URI_IMPORT_ANCHOR,
			`${EXTRACT_DATA_URI_IMPORT_ANCHOR}\n${EXTRACT_DATA_URI_IMPORT}`,
		);
	}
	return patched.replace(EXTRACT_FETCH_ALL_ORIGINAL, EXTRACT_FETCH_ALL_PATCHED);
}

const INDEX_CHILD_PROCESS_IMPORT_ORIGINAL =
	'import { execFileSync } from "node:child_process";';
const INDEX_CHILD_PROCESS_IMPORT_PATCHED =
	'import { execFileSync, spawn } from "node:child_process";';
const INDEX_OPEN_BROWSER_ORIGINAL = [
	"async function openInBrowser(pi: ExtensionAPI, url: string): Promise<void> {",
	"\tconst plat = platform();",
	'\tconst result = plat === "darwin"',
	'\t\t? await pi.exec("open", [url])',
	'\t\t: plat === "win32"',
	'\t\t\t? await pi.exec("cmd", ["/c", "start", "", url])',
	'\t\t\t: await pi.exec("xdg-open", [url]);',
	"\tif (result.code !== 0) {",
	"\t\tthrow new Error(result.stderr || `Failed to open browser (exit code ${result.code})`);",
	"\t}",
	"}",
].join("\n");
const INDEX_OPEN_BROWSER_PATCHED = [
	"async function openInBrowser(pi: ExtensionAPI, url: string): Promise<void> {",
	"\tconst plat = platform();",
	'\tif (plat !== "darwin" && plat !== "win32") {',
	"\t\tawait new Promise<void>((resolve, reject) => {",
	'\t\t\tconst child = spawn("xdg-open", [url], { detached: true, stdio: "ignore" });',
	"\t\t\tconst timer = setTimeout(resolve, 100);",
	'\t\t\tchild.once("error", (err) => {',
	"\t\t\t\tclearTimeout(timer);",
	"\t\t\t\treject(err);",
	"\t\t\t});",
	'\t\t\tchild.once("exit", (code) => {',
	"\t\t\t\tclearTimeout(timer);",
	'\t\t\t\tif (code === 0) resolve();',
	'\t\t\t\telse reject(new Error(`Failed to open browser (exit code ${code ?? "unknown"})`));',
	"\t\t\t});",
	"\t\t\tchild.unref();",
	"\t\t});",
	"\t\treturn;",
	"\t}",
	'\tconst result = plat === "darwin"',
	'\t\t? await pi.exec("open", [url])',
	'\t\t: await pi.exec("cmd", ["/c", "start", "", url]);',
	"\tif (result.code !== 0) {",
	"\t\tthrow new Error(result.stderr || `Failed to open browser (exit code ${result.code})`);",
	"\t}",
	"}",
].join("\n");

function patchLinuxBrowserLaunchSource(source) {
	return source
		.replace(INDEX_CHILD_PROCESS_IMPORT_ORIGINAL, INDEX_CHILD_PROCESS_IMPORT_PATCHED)
		.replace(INDEX_OPEN_BROWSER_ORIGINAL, INDEX_OPEN_BROWSER_PATCHED);
}

function replaceModelAwareSearchHunk(source, original, replacement, relativePath, label) {
	if (source.includes(replacement)) return source;
	if (!source.includes(original)) {
		throw new Error(
			`Unsupported pi-web-access 0.28.0 ${relativePath}: model-aware search hunk is missing (${label})`,
		);
	}
	return source.replace(original, replacement);
}

const GEMINI_AUTO_OPENAI_HELPER_ANCHOR = [
	"function shouldTryOpenAIInAuto(options: SearchOptions): boolean {",
	"\tif (options.recencyFilter) return false;",
	'\tif (typeof options.numResults === "number" && Number.isFinite(options.numResults) && Math.floor(options.numResults) !== 5) {',
	"\t\treturn false;",
	"\t}",
	"\treturn true;",
	"}",
].join("\n");
const GEMINI_AUTO_OPENAI_HELPERS = [
	GEMINI_AUTO_OPENAI_HELPER_ANCHOR,
	"",
	"function isOpenAICodexSelected(ctx?: ExtensionContext): boolean {",
	'\treturn ctx?.model?.provider === "openai-codex";',
	"}",
	"",
	"async function tryOpenAIInAuto(query: string, options: FullSearchOptions, fallbackErrors: string[]): Promise<AttributedSearchResponse | null> {",
	"\tif (!shouldTryOpenAIInAuto(options)) return null;",
	"\ttry {",
	"\t\tif (await isOpenAISearchAvailable(options.extensionContext)) {",
		"\t\t\tconst result = isOpenAICodexSelected(options.extensionContext)",
		"\t\t\t\t? await searchWithCurrentModelOpenAI(query, options, options.extensionContext)",
		"\t\t\t\t: await searchWithOpenAI(query, options, options.extensionContext);",
		'\t\t\treturn { ...result, provider: "openai" };',
	"\t\t}",
	"\t} catch (err) {",
	"\t\tif (isAbortError(err)) throw err;",
	"\t\tfallbackErrors.push(`OpenAI: ${errorMessage(err)}`);",
	"\t}",
	"\treturn null;",
	"}",
].join("\n");
const GEMINI_AUTO_OPENAI_CALL_ORIGINAL =
	"\t\t\tconst result = await searchWithOpenAI(query, options, options.extensionContext);";
const GEMINI_AUTO_OPENAI_CALL_PATCHED = [
	"\t\t\tconst result = isOpenAICodexSelected(options.extensionContext)",
	"\t\t\t\t? await searchWithCurrentModelOpenAI(query, options, options.extensionContext)",
	"\t\t\t\t: await searchWithOpenAI(query, options, options.extensionContext);",
].join("\n");
const GEMINI_AUTO_OPENAI_ORIGINAL = [
	"\tif (shouldTryOpenAIInAuto(options)) {",
	"\t\ttry {",
	"\t\t\tif (await isOpenAISearchAvailable(options.extensionContext)) {",
	"\t\t\t\tconst result = await searchWithOpenAI(query, options, options.extensionContext);",
	'\t\t\t\treturn { ...result, provider: "openai" };',
	"\t\t\t}",
	"\t\t} catch (err) {",
	"\t\t\tif (isAbortError(err)) throw err;",
	"\t\t\tfallbackErrors.push(`OpenAI: ${errorMessage(err)}`);",
	"\t\t}",
	"\t}",
].join("\n");
const GEMINI_AUTO_OPENAI_PATCHED = [
	"\tlet triedOpenAI = false;",
	"\tif (!options.extensionContext || isOpenAICodexSelected(options.extensionContext)) {",
	"\t\ttriedOpenAI = true;",
	"\t\tconst result = await tryOpenAIInAuto(query, options, fallbackErrors);",
	"\t\tif (result) return result;",
	"\t}",
].join("\n");
const GEMINI_EXA_FALLBACK_ORIGINAL = [
	"\tif (isExaAvailable()) {",
	"\t\ttry {",
	"\t\t\tconst result = await searchWithExa(query, options);",
	'\t\t\tif (result) return { ...result, provider: "exa" };',
	"\t\t} catch (err) {",
	"\t\t\tif (err instanceof CredentialResolutionError || isAbortError(err)) throw err;",
	"\t\t\tfallbackErrors.push(`Exa: ${errorMessage(err)}`);",
	"\t\t}",
	"\t}",
].join("\n");
const GEMINI_EXA_FALLBACK_PATCHED = [
	GEMINI_EXA_FALLBACK_ORIGINAL,
	"",
	"\tif (!triedOpenAI) {",
	"\t\tconst result = await tryOpenAIInAuto(query, options, fallbackErrors);",
	"\t\tif (result) return result;",
	"\t}",
].join("\n");

function patchModelAwareGeminiSearchSource(source) {
	if (
		!source.includes(GEMINI_AUTO_OPENAI_HELPER_ANCHOR) &&
		!source.includes("function isOpenAICodexSelected(")
	) {
		return source;
	}
	let patched = source;
	if (!source.includes("function isOpenAICodexSelected(")) {
		patched = replaceModelAwareSearchHunk(
			source,
			GEMINI_AUTO_OPENAI_HELPER_ANCHOR,
			GEMINI_AUTO_OPENAI_HELPERS,
			"gemini-search.ts",
			"OpenAI helper",
		);
	}
	if (patched.includes(GEMINI_AUTO_OPENAI_CALL_ORIGINAL)) {
		patched = patched.replace(
			GEMINI_AUTO_OPENAI_CALL_ORIGINAL,
			GEMINI_AUTO_OPENAI_CALL_PATCHED,
		);
	}
	patched = replaceModelAwareSearchHunk(
		patched,
		GEMINI_AUTO_OPENAI_ORIGINAL,
		GEMINI_AUTO_OPENAI_PATCHED,
		"gemini-search.ts",
		"Codex-first branch",
	);
	return replaceModelAwareSearchHunk(
		patched,
		GEMINI_EXA_FALLBACK_ORIGINAL,
		GEMINI_EXA_FALLBACK_PATCHED,
		"gemini-search.ts",
		"Exa-first branch",
	);
}

const INDEX_PROVIDER_AVAILABILITY_ORIGINAL = "interface ProviderAvailability {";
const INDEX_PROVIDER_AVAILABILITY_PATCHED = "export interface ProviderAvailability {";
const INDEX_CURATOR_PROVIDER_ORIGINAL =
	'type CuratorProvider = Exclude<SearchProvider, "auto">;';
const INDEX_CURATOR_PROVIDER_PATCHED =
	'export type CuratorProvider = Exclude<SearchProvider, "auto">;';
const INDEX_PREFERENCE_ORIGINAL = [
	'function shouldPreferOpenAI(options?: Pick<PendingCurate, "numResults" | "recencyFilter">): boolean {',
	"\tif (!options) return true;",
	"\tif (options.recencyFilter) return false;",
	'\tif (typeof options.numResults === "number" && Number.isFinite(options.numResults) && Math.floor(options.numResults) !== 5) {',
	"\t\treturn false;",
	"\t}",
	"\treturn true;",
	"}",
].join("\n");
const INDEX_PREFERENCE_PATCHED = [
	'function shouldUseOpenAICodexDefault(ctx?: Pick<ExtensionContext, "model">): boolean {',
	'\treturn ctx?.model?.provider === "openai-codex";',
	"}",
	"",
	'function shouldPreferOpenAI(options: Pick<PendingCurate, "numResults" | "recencyFilter"> | undefined, preferOpenAICodexDefault: boolean): boolean {',
	"\tif (options?.recencyFilter) return false;",
	'\tif (typeof options?.numResults === "number" && Number.isFinite(options.numResults) && Math.floor(options.numResults) !== 5) {',
	"\t\treturn false;",
	"\t}",
	"\treturn preferOpenAICodexDefault;",
	"}",
].join("\n");
const INDEX_CURATOR_DEFAULT_ORIGINAL =
	"\t\tdefaultProvider: resolveProvider(provider, availableProviders, options),";
const INDEX_CURATOR_DEFAULT_PATCHED =
	"\t\tdefaultProvider: resolveCuratorDefaultProvider(provider, availableProviders, ctx, options),";
const INDEX_FIRST_AVAILABLE_ANCHOR =
	"function firstAvailableProvider(available: ProviderAvailability, preferOpenAI: boolean, fallback: ResolvedSearchProvider): ResolvedSearchProvider {";
const INDEX_CURATOR_RESOLVER_PATCHED = [
	"export function resolveCuratorDefaultProvider(",
	"\tprovider: SearchProviderSelection,",
	"\tavailable: ProviderAvailability,",
	'\tctx?: Pick<ExtensionContext, "model">,',
	'\toptions?: Pick<PendingCurate, "numResults" | "recencyFilter">,',
	"): CuratorProvider {",
	"\treturn resolveProvider(provider, available, options, shouldUseOpenAICodexDefault(ctx));",
	"}",
	"",
	INDEX_FIRST_AVAILABLE_ANCHOR,
].join("\n");
const INDEX_EXA_FALLBACK_ORIGINAL = [
	'\tif (available.exa) return "exa";',
	'\tif (available.brave) return "brave";',
].join("\n");
const INDEX_EXA_FALLBACK_PATCHED = [
	'\tif (available.exa) return "exa";',
	'\tif (available.openai) return "openai";',
	'\tif (available.brave) return "brave";',
].join("\n");
const INDEX_RESOLVE_PROVIDER_SIGNATURE_ORIGINAL = [
	"function resolveProvider(",
	"\tprovider: SearchProviderSelection,",
	"\tavailable: ProviderAvailability,",
	'\toptions?: Pick<PendingCurate, "numResults" | "recencyFilter">,',
	"): CuratorProvider {",
].join("\n");
const INDEX_RESOLVE_PROVIDER_SIGNATURE_PATCHED = [
	"function resolveProvider(",
	"\tprovider: SearchProviderSelection,",
	"\tavailable: ProviderAvailability,",
	'\toptions?: Pick<PendingCurate, "numResults" | "recencyFilter">,',
	"\tpreferOpenAICodexDefault = false,",
	"): CuratorProvider {",
].join("\n");
const INDEX_PREFER_OPENAI_ORIGINAL =
	"\tconst preferOpenAI = shouldPreferOpenAI(options);";
const INDEX_PREFER_OPENAI_PATCHED =
	"\tconst preferOpenAI = shouldPreferOpenAI(options, preferOpenAICodexDefault);";
const INDEX_TOOL_DESCRIPTION_ORIGINAL =
	"Without a configured provider, auto-selects OpenAI when suitable and available, then Exa, Brave, Parallel, TinyFish, Search1API, Searchinfinity, Querit, Tavily, Firecrawl, Jina, SERPdive, Kagi, Bocha, Ollama, Perplexity, Gemini API, or Gemini Web. When SearXNG is configured, it is preferred first for local/private search.";
const INDEX_TOOL_DESCRIPTION_PATCHED =
	"Without a configured provider, SearXNG is preferred first for local/private search. When the active Pi model is openai-codex, Codex-backed OpenAI search is preferred next. Otherwise Exa is preferred before OpenAI, then Brave, Parallel, TinyFish, Search1API, Searchinfinity, Querit, Tavily, Firecrawl, Jina, SERPdive, Kagi, Bocha, Ollama, Perplexity, Gemini API, or Gemini Web.";
const INDEX_TOOL_DESCRIPTION_OPT_IN_ORIGINAL =
	"Without a configured provider, auto-selects OpenAI when suitable and available, then Exa, Brave, Parallel, TinyFish, Search1API, Searchinfinity, Querit, Tavily, Firecrawl, Jina, SERPdive, Kagi, Bocha, Ollama, Perplexity, Gemini API, or opt-in Gemini Web. When SearXNG is configured, it is preferred first for local/private search.";
const INDEX_TOOL_DESCRIPTION_OPT_IN_PATCHED =
	"Without a configured provider, SearXNG is preferred first for local/private search. When the active Pi model is openai-codex, Codex-backed OpenAI search is preferred next. Otherwise Exa is preferred before OpenAI, then Brave, Parallel, TinyFish, Search1API, Searchinfinity, Querit, Tavily, Firecrawl, Jina, SERPdive, Kagi, Bocha, Ollama, Perplexity, Gemini API, or opt-in Gemini Web.";

function patchModelAwareIndexSource(source) {
	if (
		!source.includes(INDEX_PROVIDER_AVAILABILITY_ORIGINAL) &&
		!source.includes(INDEX_PROVIDER_AVAILABILITY_PATCHED)
	) {
		return source;
	}
	if (
		source.includes("preferOpenAICodexDefault = false,") &&
		source.includes('ctx?: Pick<ExtensionContext, "model">,') &&
		source.includes("routing.useCurrentModel === true") &&
		source.includes("isCurrentModelHostedSearchEligible(ctx)")
	) {
		// pi-web-access 0.28.0 owns the model-aware default and extends it with
		// explicit current-model Hosted Search routing.
		return source;
	}
	let patched = source;
	for (const [original, replacement, label] of [
		[
			INDEX_PROVIDER_AVAILABILITY_ORIGINAL,
			INDEX_PROVIDER_AVAILABILITY_PATCHED,
			"provider availability export",
		],
		[
			INDEX_CURATOR_PROVIDER_ORIGINAL,
			INDEX_CURATOR_PROVIDER_PATCHED,
			"curator provider export",
		],
		[INDEX_PREFERENCE_ORIGINAL, INDEX_PREFERENCE_PATCHED, "provider preference"],
		[INDEX_CURATOR_DEFAULT_ORIGINAL, INDEX_CURATOR_DEFAULT_PATCHED, "curator default"],
		[
			INDEX_FIRST_AVAILABLE_ANCHOR,
			INDEX_CURATOR_RESOLVER_PATCHED,
			"curator resolver",
		],
		[INDEX_EXA_FALLBACK_ORIGINAL, INDEX_EXA_FALLBACK_PATCHED, "OpenAI fallback"],
		[
			INDEX_RESOLVE_PROVIDER_SIGNATURE_ORIGINAL,
			INDEX_RESOLVE_PROVIDER_SIGNATURE_PATCHED,
			"provider resolver signature",
		],
		[INDEX_PREFER_OPENAI_ORIGINAL, INDEX_PREFER_OPENAI_PATCHED, "provider resolver preference"],
	]) {
		patched = replaceModelAwareSearchHunk(
			patched,
			original,
			replacement,
			"index.ts",
			label,
		);
	}
	if (
		!patched.includes(INDEX_TOOL_DESCRIPTION_PATCHED) &&
		!patched.includes(INDEX_TOOL_DESCRIPTION_OPT_IN_PATCHED)
	) {
		if (patched.includes(INDEX_TOOL_DESCRIPTION_ORIGINAL)) {
			patched = patched.replace(
				INDEX_TOOL_DESCRIPTION_ORIGINAL,
				INDEX_TOOL_DESCRIPTION_PATCHED,
			);
		} else if (patched.includes(INDEX_TOOL_DESCRIPTION_OPT_IN_ORIGINAL)) {
			patched = patched.replace(
				INDEX_TOOL_DESCRIPTION_OPT_IN_ORIGINAL,
				INDEX_TOOL_DESCRIPTION_OPT_IN_PATCHED,
			);
		} else {
			throw new Error(
				"Unsupported pi-web-access 0.28.0 index.ts: model-aware search hunk is missing (tool description)",
			);
		}
	}
	return patched;
}

const FIRECRAWL_LOOPBACK_HELPERS = [
	"function isLoopbackApiUrl(url: URL): boolean {",
	'\tconst hostname = url.hostname.toLowerCase().replace(/^\\[|\\]$/g, "").replace(/\\.$/, "");',
	'\tif (hostname === "localhost" || hostname === "::1") return true;',
	"\tif (net.isIP(hostname) !== 4) return false;",
	'\treturn hostname.split(".")[0] === "127";',
	"}",
	"",
	"function firecrawlApiSsrfOptions(",
	"\toptions: FirecrawlExtractOptions | FirecrawlSearchOptions | undefined,",
	"\tallowLoopback: boolean,",
	"): ReturnType<typeof ssrfOptions> & { allowLoopback: boolean } {",
	"\treturn { ...ssrfOptions(options), allowLoopback };",
	"}",
	"",
].join("\n");

function patchFirecrawlLoopbackSource(source) {
	let patched = source;
	const fsImport = 'import { existsSync, readFileSync } from "node:fs";';
	if (!patched.includes('import net from "node:net";') && patched.includes(fsImport)) {
		patched = patched.replace(fsImport, `${fsImport}\nimport net from "node:net";`);
	}
	const helperAnchor =
		"function withoutSensitiveHeaders(headers: Record<string, string>): Record<string, string> {";
	if (!patched.includes("function isLoopbackApiUrl(") && patched.includes(helperAnchor)) {
		patched = patched.replace(helperAnchor, `${FIRECRAWL_LOOPBACK_HELPERS}${helperAnchor}`);
	}
	return patched
		.replace(
			[
				"\tconst allowLoopback = isLoopbackApiUrl(new URL(url));",
				"\tlet current = await validateRemoteUrl(url, firecrawlApiSsrfOptions(options, allowLoopback));",
			].join("\n"),
			[
				"\tconst initialUrl = new URL(url);",
				"\tconst loopbackApiOrigin = isLoopbackApiUrl(initialUrl) ? initialUrl.origin : null;",
				"\tlet current = await validateRemoteUrl(initialUrl, firecrawlApiSsrfOptions(options, loopbackApiOrigin !== null));",
			].join("\n"),
		)
		.replace(
			"let current = await validateRemoteUrl(url, ssrfOptions(options));",
			[
				"const initialUrl = new URL(url);",
				"const loopbackApiOrigin = isLoopbackApiUrl(initialUrl) ? initialUrl.origin : null;",
				"let current = await validateRemoteUrl(initialUrl, firecrawlApiSsrfOptions(options, loopbackApiOrigin !== null));",
			].join("\n"),
		)
		.replace(
			"\t\tconst next = await validateRemoteUrl(new URL(location, current), firecrawlApiSsrfOptions(options, allowLoopback));",
			[
				"\t\tconst redirectUrl = new URL(location, current);",
				"\t\tconst next = await validateRemoteUrl(",
				"\t\t\tredirectUrl,",
				"\t\t\tfirecrawlApiSsrfOptions(options, redirectUrl.origin === loopbackApiOrigin),",
				"\t\t);",
			].join("\n"),
		)
		.replace(
			"const next = await validateRemoteUrl(new URL(location, current), ssrfOptions(options));",
			[
				"const redirectUrl = new URL(location, current);",
				"const next = await validateRemoteUrl(",
				"\tredirectUrl,",
				"\tfirecrawlApiSsrfOptions(options, redirectUrl.origin === loopbackApiOrigin),",
				");",
			].join("\n"),
		);
}

const SSRF_LOOPBACK_RANGES =
	'const LOOPBACK_ALLOW_RANGES = ["127.0.0.0/8", "::1", "::ffff:127.0.0.0/104"];';
const SSRF_LOCALHOST_ORIGINAL = [
	'\tif (hostname === "localhost" || hostname.endsWith(".localhost")) {',
	"\t\tthrow new Error(`Blocked internal hostname: ${hostname}`);",
	"\t}",
].join("\n");
const SSRF_LOCALHOST_PATCHED = [
	'\tif (hostname === "localhost") {',
	"\t\tif (options.allowLoopback === true) return url;",
	"\t\tthrow new Error(`Blocked internal hostname: ${hostname}`);",
	"\t}",
	'\tif (hostname.endsWith(".localhost")) {',
	"\t\tthrow new Error(`Blocked internal hostname: ${hostname}`);",
	"\t}",
].join("\n");
const SSRF_LITERAL_IP_ORIGINAL = [
	"\tif (net.isIP(hostname)) {",
	"\t\tassertPublicAddress(hostname, hostname, allowRanges);",
	"\t\treturn url;",
	"\t}",
].join("\n");
const SSRF_LITERAL_IP_PATCHED = [
	"\tif (net.isIP(hostname)) {",
	"\t\tconst addressAllowRanges = options.allowLoopback === true",
	"\t\t\t? [...allowRanges, ...parseAllowRanges(LOOPBACK_ALLOW_RANGES)]",
	"\t\t\t: allowRanges;",
	"\t\tassertPublicAddress(hostname, hostname, addressAllowRanges);",
	"\t\treturn url;",
	"\t}",
].join("\n");

function patchSsrfLoopbackSource(source) {
	let patched = source;
	const redirectStatuses = "const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);";
	if (!patched.includes(SSRF_LOOPBACK_RANGES) && patched.includes(redirectStatuses)) {
		patched = patched.replace(
			redirectStatuses,
			`${redirectStatuses}\n${SSRF_LOOPBACK_RANGES}`,
		);
	}
	const trustOption = "\ttrustEnvProxy?: boolean;";
	if (!patched.includes("\tallowLoopback?: boolean;") && patched.includes(trustOption)) {
		patched = patched.replace(
			trustOption,
			[
				trustOption,
				"\t/** Allow loopback URLs for explicit provider base endpoints, not fetched targets. */",
				"\tallowLoopback?: boolean;",
			].join("\n"),
		);
	}
	return patched
		.replace(SSRF_LOCALHOST_ORIGINAL, SSRF_LOCALHOST_PATCHED)
		.replace(SSRF_LITERAL_IP_ORIGINAL, SSRF_LITERAL_IP_PATCHED);
}

export function patchPiWebAccessForwardFixSource(relativePath, source) {
	if (relativePath === "chrome-cookies.ts") {
		return patchPiWebAccessWindowsCookiesSource(source);
	}
	if (relativePath === "index.ts") {
		return patchLinuxBrowserLaunchSource(patchModelAwareIndexSource(source));
	}
	if (relativePath === "gemini-search.ts") {
		return patchModelAwareGeminiSearchSource(source);
	}
	if (relativePath === "extract.ts") return patchInlineDataUriSource(source);
	if (relativePath === "firecrawl.ts") return patchFirecrawlLoopbackSource(source);
	if (relativePath === "ssrf-protection.ts") return patchSsrfLoopbackSource(source);
	return source;
}

export function syncPiWebAccessForwardFiles(appRoot, packageRoot, version) {
	let changed = false;
	for (const relativePath of PI_WEB_ACCESS_FORWARD_FILE_TARGETS) {
		const fixturePath = resolve(appRoot, "fixtures", `pi-web-access-${version}`, relativePath);
		if (!existsSync(fixturePath)) {
			throw new Error(`pi-web-access forward fixture is missing: ${relativePath}`);
		}
		const entryPath = resolve(packageRoot, relativePath);
		const fixtureSource = readFileSync(fixturePath, "utf8").replace(/\r\n/g, "\n");
		if (!existsSync(entryPath) || readFileSync(entryPath, "utf8") !== fixtureSource) {
			writeFileSync(entryPath, fixtureSource, "utf8");
			changed = true;
		}
	}
	return changed;
}
