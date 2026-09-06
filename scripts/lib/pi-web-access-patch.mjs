import { createHash } from "node:crypto";
import {
	assertPiWebAccessForwardFixSources,
	PI_WEB_ACCESS_FORWARD_FILE_TARGETS,
	patchPiWebAccessForwardFixSource,
	syncPiWebAccessForwardFiles,
} from "./pi-web-access-forward-fixes-patch.mjs";
import {
	patchGeminiWebConfigSource,
	patchGeminiWebSource,
} from "./pi-web-access-gemini-browser-patch.mjs";
import {
	assertPiWebAccessPatchedDigests,
	assertPiWebAccessReviewedSources,
} from "./pi-web-access-source-contract.mjs";
import {
	GITHUB_PROXY_IMPORT,
	patchGeminiAdcPathSource,
	patchGitHubApiProxySource,
	patchGitHubCloneProxySource,
	patchGitHubIssueProxySource,
	patchProxyUtilitySource,
	patchSsrfNoProxySource,
} from "./pi-web-access-security-patch.mjs";

export const PI_WEB_ACCESS_REQUIRED_VERSION = "0.28.0";
export {
	PI_WEB_ACCESS_FORWARD_FILE_TARGETS,
	patchPiWebAccessForwardFixSource,
	syncPiWebAccessForwardFiles,
};

export const PI_WEB_ACCESS_PATCH_TARGETS = [
	"index.ts",
	"extract.ts",
	"fetch-params.ts",
	"firecrawl.ts",
	"ssrf-protection.ts",
	"chrome-cookies.ts",
	...PI_WEB_ACCESS_FORWARD_FILE_TARGETS,
	"credential-source.ts",
	"curator-page.ts",
	"curator-server.ts",
	"feature-config.ts",
	"page-query.ts",
	"storage.ts",
	"summary-model-scope.ts",
	"summary-review.ts",
	"exa.ts",
	"gemini-api.ts",
	"gemini-adc.ts",
	"gemini-search.ts",
	"gemini-url-context.ts",
	"gemini-web-config.ts",
	"gemini-web.ts",
	"github-api.ts",
	"github-extract.ts",
	"github-issue-pr.ts",
	"kimi-search.ts",
	"openai-search.ts",
	"perplexity.ts",
	"pdf-extract.ts",
	"video-extract.ts",
	"youtube-extract.ts",
	"utils.ts",
	"xai-search.ts",
	"mistral-search.ts",
	"xcrawl.ts",
];

export function assertPiWebAccessVersion(version, surface) {
	if (version !== PI_WEB_ACCESS_REQUIRED_VERSION) {
		throw new Error(
			`Unsupported pi-web-access patch ${surface}: expected ${PI_WEB_ACCESS_REQUIRED_VERSION}, found ${version ?? "missing"}`,
		);
	}
}

function countOccurrences(source, marker) {
	return source.split(marker).length - 1;
}

function requireMarkerCount(source, relativePath, marker, expectedCount, surface) {
	const actualCount = countOccurrences(source, marker);
	if (actualCount !== expectedCount) {
		throw new Error(
			`Unsupported pi-web-access ${PI_WEB_ACCESS_REQUIRED_VERSION} ${surface} ${relativePath}: expected ${expectedCount} occurrences of ${marker}, found ${actualCount}`,
		);
	}
}

function requireMarkerCounts(source, relativePath, expectations, surface) {
	for (const [marker, expectedCount] of expectations) {
		requireMarkerCount(source, relativePath, marker, expectedCount, surface);
	}
}

function rejectMarkers(source, relativePath, markers, surface) {
	for (const marker of markers) {
		if (source.includes(marker)) {
			throw new Error(
				`Unsupported pi-web-access ${PI_WEB_ACCESS_REQUIRED_VERSION} ${surface} ${relativePath}: stale ${marker}`,
			);
		}
	}
}

export function assertPiWebAccessPatchedSources(sources, surface = "patched source tree") {
	const indexSource = sources.get("index.ts");
	if (typeof indexSource === "string") {
		for (const fragment of [
			INDEX_CONFIG_PATH_BINDING_PATCHED,
			INDEX_CONFIG_WRITE_DIRECTORY_PATCHED,
		]) {
			const count = countOccurrences(indexSource, fragment);
			if (count !== 1) {
				throw new Error(
					`Incomplete pi-web-access ${PI_WEB_ACCESS_REQUIRED_VERSION} ${surface} index.ts: expected 1 occurrences of ${fragment}, found ${count}`,
				);
			}
		}
	}
	assertPiWebAccessPatchedDigests(sources, PI_WEB_ACCESS_PATCH_TARGETS, surface);
	assertPiWebAccessForwardFixSources(
		sources,
		surface,
		PI_WEB_ACCESS_REQUIRED_VERSION,
	);
	for (const relativePath of [
		"index.ts",
		"feature-config.ts",
		"page-query.ts",
		"storage.ts",
		"summary-model-scope.ts",
		"summary-review.ts",
	]) {
		if (!sources.has(relativePath)) {
			throw new Error(
				`Unsupported pi-web-access ${PI_WEB_ACCESS_REQUIRED_VERSION} ${surface}: missing ${relativePath}`,
			);
		}
	}

	requireMarkerCounts(indexSource, "index.ts", [
		[INDEX_CONFIG_HELPER_IMPORT_PATCHED, 1],
		[INDEX_CONFIG_PATH_BINDING_PATCHED, 1],
		[INDEX_CONFIG_WRITE_BLOCK_PATCHED, 1],
		['import { dirname, join } from "node:path";', 1],
		['import { findModelWithProviderRouting, modelMatchesScopedModels, splitThinkingSuffix } from "./summary-model-scope.ts";', 1],
		["get scopedModels() { return ctx.scopedModels; }", 3],
		["modelMatchesScopedModels(model, ctx.scopedModels)", 0],
		["modelMatchesScopedModels(model, summaryContext.scopedModels)", 1],
		["modelMatchesScopedModels(summaryContext.model, summaryContext.scopedModels)", 1],
		["const SEARCH_CALL_TIMEOUT_MS = 90000;", 1],
		["function searchWithDeadline(", 1],
		["await searchWithDeadline(", 5],
		["() => searchWithDeadline(query, {", 1],
		['pi.registerCommand("web-results",', 1],
		['params.workflow ?? configWorkflow ?? "none"', 1],
		["summary-review = open curator with auto summary draft (opt-in)", 1],
		["Searches return directly by default;", 1],
		[INDEX_COMMAND_CONFIG_PATCHED, 1],
		[INDEX_COMMAND_GATE_TYPE_PATCHED, 1],
		[INDEX_SEARCH_COMMAND_PATCHED, 1],
		["summaryGenerationDeadlineMs?: unknown;", 1],
		["export function getSummaryGenerationDeadlineMs(): number {", 1],
		["storeFetchedContentResult(fetchId, data)", 2],
		["storeFetchedContentResult(responseId, data)", 1],
		['Stored content responseId: "${responseId}".', 2],
		['if (sourceCheckEnabled) pi.registerTool({', 1],
		['if (fetchContentEnabled) pi.registerTool({', 1],
		['if (getSearchContentEnabled) {', 1],
		["proxy: Type.Optional(Type.String({", 3],
		["runWithProxy(", 9],
		["installGlobalProxyFetch();", 1],
	], surface);
	rejectMarkers(
		indexSource,
		"index.ts",
		[
			INDEX_CONFIG_HELPER_IMPORT_ORIGINAL,
			INDEX_CONFIG_HELPER_IMPORT_LEGACY,
			INDEX_CONFIG_PATH_BINDING_LEGACY,
			INDEX_CONFIG_PATH_BINDING_PARTIAL,
			INDEX_CONFIG_WRITE_DIRECTORY_LEGACY,
			INDEX_CONFIG_WRITE_DIRECTORY_CURRENT,
			"loadEnabledModelPatterns",
			"modelMatchesEnabledPatterns",
			"scopedModels: ctx.scopedModels",
			'pi.registerCommand("search",',
			"const response = await search(queryList[qi], {",
			"const response = await search(query, {",
			"() => search(query, {",
			"const { answer, results, inlineContent, provider } = await search(query, {",
			INDEX_COMMAND_CONFIG_ORIGINAL,
			INDEX_COMMAND_GATE_TYPE_ORIGINAL,
			INDEX_SEARCH_COMMAND_ORIGINAL,
			'if (isCommandEnabled(initConfig, "search")) pi.registerCommand("web-results",',
		],
		surface,
	);

	const featureConfigSource = sources.get("feature-config.ts");
	requireMarkerCounts(featureConfigSource, "feature-config.ts", [
		['import { getWebSearchConfigPath } from "./utils.ts";', 1],
		["export function isImageEnabled(): boolean {", 1],
		["return loadFeatureConfig().image?.enabled !== false;", 1],
		["export function canAttachImages(): boolean {", 1],
	], surface);

	const storageSource = sources.get("storage.ts");
	requireMarkerCounts(storageSource, "storage.ts", [
		[STORAGE_CONFIG_IMPORT_PATCHED, 1],
		[STORAGE_PATH_IMPORT_PATCHED, 1],
		[STORAGE_CACHE_PATH_PATCHED, 1],
		['const FETCH_CACHE_DIR = "web-search-cache";', 1],
		["function writeFetchCache(", 1],
		["function readCachedFetchData(", 1],
		["export function pruneExpiredFetchCache(", 1],
		["export function storeFetchedContentResult(", 1],
		["const DEFAULT_CACHE_LIMITS = { maxEntries: 128, maxBytes: 128 * 1024 * 1024 };", 1],
		['type CacheUnlinkResult = "removed" | "missing" | "changed" | "error";', 1],
		['if (removed !== "removed" && removed !== "missing") return false;', 1],
		['const tmpName = `${key}.${process.pid}.${Date.now()}.${randomBytes(16).toString("hex")}.tmp`;', 1],
		["constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | O_NOFOLLOW", 1],
		["Fetched content cache path is not a safe directory", 1],
		["urlMetadata: metadataForUrls(data.urls)", 2],
	], surface);
	rejectMarkers(
		storageSource,
		"storage.ts",
		[
			STORAGE_CONFIG_IMPORT_ORIGINAL,
			STORAGE_PATH_IMPORT_ORIGINAL,
			STORAGE_CACHE_PATH_ORIGINAL,
		],
		surface,
	);

	const pageQuerySource = sources.get("page-query.ts");
	requireMarkerCounts(pageQuerySource, "page-query.ts", [
		['import { findModelWithProviderRouting, modelMatchesScopedModels } from "./summary-model-scope.ts";', 1],
		["modelMatchesScopedModels(model, ctx.scopedModels)", 1],
	], surface);
	rejectMarkers(
		pageQuerySource,
		"page-query.ts",
		["loadEnabledModelPatterns", "modelMatchesEnabledPatterns"],
		surface,
	);

	const scopeSource = sources.get("summary-model-scope.ts");
	for (const marker of [
		'const THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);',
		"\tscopedModels: readonly { model: ModelLike }[];",
		"export function modelMatchesScopedModels(",
		"\tif (ctx.scopedModels.length === 0) return null;",
		"\treturn ctx.scopedModels.map(({ model }) => summaryModelValue(model));",
	]) {
		requireMarkerCount(scopeSource, "summary-model-scope.ts", marker, 1, surface);
	}
	rejectMarkers(
		scopeSource,
		"summary-model-scope.ts",
		[
			"function getAgentDir(): string {",
			"function readSettings(",
			'join(ctx.cwd, ".pi", "settings.json")',
		'from "node:fs"',
			'from "node:os"',
			'from "node:path"',
		],
		surface,
	);

	const reviewSource = sources.get("summary-review.ts");
	requireMarkerCounts(reviewSource, "summary-review.ts", [
		['import { findModelWithProviderRouting, modelMatchesScopedModels, splitThinkingSuffix, type SummaryThinkingLevel } from "./summary-model-scope.ts";', 1],
		['Pick<ExtensionContext, "model" | "modelRegistry" | "scopedModels" | "cwd" | "isProjectTrusted">', 1],
		["modelMatchesScopedModels(model, ctx.scopedModels)", 1],
	], surface);
	rejectMarkers(
		reviewSource,
		"summary-review.ts",
		["loadEnabledModelPatterns", "modelMatchesEnabledPatterns"],
		surface,
	);

	const geminiSearchSource = sources.get("gemini-search.ts");
	requireMarkerCount(
		geminiSearchSource,
		"gemini-search.ts",
		'Opt into Gemini Web browser-cookie access by setting \\"geminiBrowser\\": true in web-search.json',
		2,
		surface,
	);
	rejectMarkers(
		geminiSearchSource,
		"gemini-search.ts",
		[
			"  2. Sign into gemini.google.com in a supported Chromium-based browser",
			"  3. Sign into gemini.google.com in a supported Chromium-based browser",
			"  4. Sign into gemini.google.com in a supported Chromium-based browser",
			"  5. Sign into gemini.google.com in a supported Chromium-based browser",
		],
		surface,
	);
	requireMarkerCounts(geminiSearchSource, "gemini-search.ts", [
		['import { isBochaAvailable, searchWithBocha } from "./bocha.ts";', 1],
		['if (provider === "bocha") return { ...(await searchWithBocha(query, options)), provider };', 1],
		['if (isBochaAvailable()) {', 1],
	], surface);

	requireMarkerCounts(indexSource, "index.ts", [
		["maxInlineContentChars?: unknown;", 1],
		["const DEFAULT_MAX_INLINE_CONTENT_CHARS = 30_000;", 1],
		["const MAX_INLINE_CONTENT_CHARS = 200_000;", 1],
		["function getMaxInlineContentChars(config = loadConfig()): number {", 1],
		["const maxInlineContentChars = getMaxInlineContentChars(initConfig);", 1],
		["bocha: isBochaAvailable(),", 1],
	], surface);

	const geminiConfigSource = sources.get("gemini-web-config.ts");
	requireMarkerCounts(geminiConfigSource, "gemini-web-config.ts", [
		["\tbrowserCookies?: BrowserCookieSelection;", 1],
		["geminiBrowser?: unknown; allowBrowserAuth?: unknown; browserAuth?: unknown", 2],
		["function normalizeBooleanFlag(", 1],
		[
			"normalizeBooleanFlag(raw.allowBrowserCookies) || normalizeBooleanFlag(raw.geminiBrowser) || normalizeBooleanFlag(raw.allowBrowserAuth) || normalizeBooleanFlag(raw.browserAuth)",
			1,
		],
		["return loadConfig().allowBrowserCookies === true;", 1],
	], surface);

	const pdfSource = sources.get("pdf-extract.ts");
	requireMarkerCounts(pdfSource, "pdf-extract.ts", [
		[PATCHED_PDF_OUTPUT_DIR, 1],
		["\tmaxPages: number;", 1],
		["const configuredMaxPages = pdf.maxPages;", 1],
		["\t\t\t? pdfConfig.maxPages", 1],
		["maxPages: safeMaxPages,", 2],
		["const pagesToExtract = Math.min(pdf.numPages, safeMaxPages);", 1],
		["const truncated = pdf.numPages > safeMaxPages;", 1],
	], surface);
	rejectMarkers(pdfSource, "pdf-extract.ts", LEGACY_PDF_OUTPUT_DIRS, surface);

	const extractSource = sources.get("extract.ts");
	requireMarkerCount(
		extractSource,
		"extract.ts",
		'"User-Agent": "OpenAI File Downloader, XaiImageApiFetch/1.0"',
		1,
		surface,
	);
	rejectMarkers(
		extractSource,
		"extract.ts",
		["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"],
		surface,
	);
	requireMarkerCounts(extractSource, "extract.ts", [
		['import { extractGitHubIssuePr } from "./github-issue-pr.ts";', 1],
		['const { Defuddle } = await import("defuddle/node");', 1],
		["const ghIssuePrResult = await extractGitHubIssuePr(", 1],
		["const defuddleResult = await extractWithDefuddle(", 2],
	], surface);

	const githubSource = sources.get("github-extract.ts");
	requireMarkerCounts(githubSource, "github-extract.ts", [
		['import { createHash } from "node:crypto";', 1],
		['import { getProxyProcessEnv, getWebSearchConfigPath } from "./utils.ts";', 1],
		["function cloneDestination(", 1],
		['createHash("sha256").update(JSON.stringify([owner, repo, ref ?? null])).digest("hex")', 1],
		['if (dirname(localPath) !== rootPath || !/^[0-9a-f]{64}$/.test(basename(localPath))) return false;', 1],
		["if (owner.includes(\"--\")) return null;", 1],
		['...getProxyProcessEnv("https://github.com"),', 1],
	], surface);
	rejectMarkers(
		githubSource,
		"github-extract.ts",
		["function cloneDir(", "rmSync(entry.localPath"],
		surface,
	);

	const openaiSource = sources.get("openai-search.ts");
	requireMarkerCounts(openaiSource, "openai-search.ts", [
		['const DEFAULT_SEARCH_PROVIDERS: readonly string[] = ["openai-codex", "openai"];', 1],
		["\topenaiSearchProviders?: unknown;", 1],
		["function resolveConfiguredSearchProviders(", 1],
		["for (const provider of providers) {", 1],
	], surface);
	rejectMarkers(
		openaiSource,
		"openai-search.ts",
		['const SEARCH_PROVIDERS = ["openai-codex", "openai"] as const;'],
		surface,
	);

	const utilsSource = sources.get("utils.ts");
	requireMarkerCount(utilsSource, "utils.ts", PATCHED_CONFIG_PATH_HELPER, 1, surface);
	requireMarkerCounts(utilsSource, "utils.ts", [
		['import net from "node:net";', 1],
		["export function runWithProxy<T>(", 1],
		["return proxyStorage.getStore() ?? null;", 1],
		["return proxyStorage.run(configured, fn);", 1],
		["export function isProxyBypassedUrl(", 1],
		["function isIpv4MappedLoopback(", 1],
		["function parseNoProxyEntry(", 1],
		["if (parsed.port !== undefined && parsed.port !== port) return false;", 1],
		["return hostname === parsed.hostname || hostname.endsWith(`.${parsed.hostname}`);", 1],
			["export function getProxyProcessEnv(", 1],
			["for (const name of PROXY_ENV_NAMES) delete env[name];", 1],
			["for (const name of PROXY_ENV_NAMES) env[name] = proxy;", 1],
			["function quoteCurlConfigValue(", 1],
			['spawn("curl", args, { stdio: ["pipe", "pipe", "pipe"], windowsHide: true })', 1],
			['child.stdin?.end(`${configLines.join("\\n")}\\n`);', 1],
			["export function installGlobalProxyFetch(): void {", 1],
			["const noProxy = process.env.NO_PROXY || process.env.no_proxy;", 1],
	], surface);
	rejectMarkers(
		utilsSource,
		"utils.ts",
			[
				CONFIG_PATH_HELPER,
				"function noProxyEntryMatches(hostname: string, entry: string)",
				'"-x", proxyUrl',
				'args.push("-H"',
				"args.push(url.toString())",
			],
			surface,
		);

	const ssrfSource = sources.get("ssrf-protection.ts");
	requireMarkerCount(
		ssrfSource,
		"ssrf-protection.ts",
		"return !isProxyBypassedUrl(url);",
		1,
		surface,
	);
	rejectMarkers(
		ssrfSource,
		"ssrf-protection.ts",
		["function hostnameMatchesNoProxy("],
		surface,
	);

	requireMarkerCounts(sources.get("fetch-params.ts"), "fetch-params.ts", [
		["proxy?: unknown;", 1],
		["const proxy = normalizeProxy(params.proxy);", 1],
		["normalizeProxyUrl(value, \"proxy\")", 1],
	], surface);
	requireMarkerCounts(sources.get("github-issue-pr.ts"), "github-issue-pr.ts", [
		['import { getProxyProcessEnv, getWebSearchConfigPath } from "./utils.ts";', 1],
		['env: { ...getProxyProcessEnv("https://github.com"), GH_PROMPT_DISABLED: "1", GIT_TERMINAL_PROMPT: "0" },', 1],
		["export function parseGitHubIssuePrUrl(", 1],
		["export async function extractGitHubIssuePr(", 1],
		["GitHub API rate limit reached", 2],
		["review thread comments shown", 3],
	], surface);
	requireMarkerCounts(sources.get("github-api.ts"), "github-api.ts", [
		[GITHUB_PROXY_IMPORT, 1],
		['env: getProxyProcessEnv("https://github.com")', 6],
	], surface);
	requireMarkerCounts(sources.get("gemini-adc.ts"), "gemini-adc.ts", [
		["export function getDefaultAdcPath(", 1],
		['if (currentPlatform === "win32" && appData) {', 1],
		['return win32.join(appData, "gcloud", "application_default_credentials.json");', 1],
		["process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim() || getDefaultAdcPath()", 1],
		["export function isAdcAuthSelected(): boolean {", 1],
		["const OAUTH_CREDENTIAL_REJECTION_STATUSES = new Set([400, 401, 403]);", 1],
		["Google Application Default Credentials file not found", 1],
		["export async function getAdcAccessToken(", 1],
	], surface);
	requireMarkerCounts(sources.get("kimi-search.ts"), "kimi-search.ts", [
		['const KIMI_SEARCH_URL = "https://api.kimi.com/coding/v1/search";', 1],
		["ctx.modelRegistry.getApiKeyAndHeaders(model)", 1],
		["export async function searchWithKimi(", 1],
		["redactCredential(await response.text(), auth.apiKey)", 1],
	], surface);

	for (const [relativePath, source] of sources) {
		rejectMarkers(source, relativePath, [LEGACY_CONFIG_EXPR], surface);
	}
}

export function patchPiWebAccessSources(sources, surface = "source tree") {
	for (const relativePath of PI_WEB_ACCESS_PATCH_TARGETS) {
		if (!sources.has(relativePath)) {
			throw new Error(
				`Unsupported pi-web-access ${PI_WEB_ACCESS_REQUIRED_VERSION} ${surface}: missing ${relativePath}`,
			);
		}
	}
	assertPiWebAccessReviewedSources(sources, PI_WEB_ACCESS_PATCH_TARGETS, surface);

	const patchedSources = new Map();
	for (const relativePath of PI_WEB_ACCESS_PATCH_TARGETS) {
		patchedSources.set(
			relativePath,
			patchPiWebAccessSource(relativePath, sources.get(relativePath)),
		);
	}
	assertPiWebAccessPatchedSources(patchedSources, surface);
	return patchedSources;
}

const LEGACY_CONFIG_EXPR = 'join(homedir(), ".pi", "web-search.json")';
const PATCHED_CONFIG_EXPR =
	'process.env.FEYNMAN_WEB_SEARCH_CONFIG ?? process.env.PI_WEB_SEARCH_CONFIG ?? join(homedir(), ".pi", "web-search.json")';
const LEGACY_PDF_OUTPUT_DIRS = [
	'const DEFAULT_OUTPUT_DIR = join(homedir(), "Downloads");',
	'const DEFAULT_OUTPUT_DIR = join(tmpdir(), "pi-web-pdf");',
];
const PATCHED_PDF_OUTPUT_DIR = [
	"const DEFAULT_OUTPUT_DIR =",
	'  process.env.FEYNMAN_FETCH_CACHE_DIR?.trim() || join(process.cwd(), ".feynman", "cache", "fetch-content");',
].join("\n");
const CONFIG_PATH_HELPER = [
	"export function getWebSearchConfigPath(): string {",
	'\treturn join(getWebSearchConfigDir(), "web-search.json");',
	"}",
].join("\n");
const PATCHED_CONFIG_PATH_HELPER = [
	"export function getWebSearchConfigPath(): string {",
	"\tconst configuredPath = process.env.FEYNMAN_WEB_SEARCH_CONFIG?.trim() || process.env.PI_WEB_SEARCH_CONFIG?.trim();",
	'\treturn configuredPath || join(getWebSearchConfigDir(), "web-search.json");',
	"}",
].join("\n");
const INDEX_CONFIG_HELPER_IMPORT_ORIGINAL =
	'import { formatSeconds, getWebSearchConfigDir, getWebSearchConfigPath, installGlobalProxyFetch, resolveCuratorNetworkConfig, runWithProxy } from "./utils.ts";';
const INDEX_CONFIG_HELPER_IMPORT_PATCHED =
	'import { formatSeconds, getWebSearchConfigPath, installGlobalProxyFetch, resolveCuratorNetworkConfig, runWithProxy } from "./utils.ts";';
const INDEX_CONFIG_HELPER_IMPORT_LEGACY =
	'import { formatSeconds, getWebSearchConfigDir, getWebSearchConfigPath, resolveCuratorNetworkConfig } from "./utils.ts";';
const INDEX_CONFIG_HELPER_IMPORT_LEGACY_PATCHED =
	'import { formatSeconds, getWebSearchConfigPath, resolveCuratorNetworkConfig } from "./utils.ts";';
const INDEX_CONFIG_PATH_BINDING_PATCHED =
	"const WEB_SEARCH_CONFIG_PATH = getWebSearchConfigPath();";
const INDEX_CONFIG_PATH_BINDING_LEGACY =
	`const WEB_SEARCH_CONFIG_PATH = ${LEGACY_CONFIG_EXPR};`;
const INDEX_CONFIG_PATH_BINDING_PARTIAL =
	'const WEB_SEARCH_CONFIG_PATH = join(getWebSearchConfigDir(), "web-search.json");';
const INDEX_CONFIG_PATH_BINDING_ENV =
	`const WEB_SEARCH_CONFIG_PATH = ${PATCHED_CONFIG_EXPR};`;
const INDEX_CONFIG_WRITE_DIRECTORY_LEGACY =
	'const dir = join(homedir(), ".pi");';
const INDEX_CONFIG_WRITE_DIRECTORY_CURRENT =
	"const dir = getWebSearchConfigDir();";
const INDEX_CONFIG_WRITE_DIRECTORY_PATCHED =
	"const dir = dirname(WEB_SEARCH_CONFIG_PATH);";
const INDEX_CONFIG_WRITE_BLOCK_PATCHED = [
	`\t${INDEX_CONFIG_WRITE_DIRECTORY_PATCHED}`,
	"\tif (!existsSync(dir)) mkdirSync(dir, { recursive: true });",
	'\twriteFileSync(WEB_SEARCH_CONFIG_PATH, JSON.stringify(config, null, 2) + "\\n");',
].join("\n");
const INDEX_COMMAND_CONFIG_ORIGINAL =
	'commands?: Partial<Record<"websearch" | "curator" | "search" | "google-account", { enabled?: boolean }>>;';
const INDEX_COMMAND_CONFIG_PATCHED =
	'commands?: Partial<Record<"websearch" | "curator" | "web-results" | "google-account", { enabled?: boolean }>>;';
const INDEX_COMMAND_GATE_TYPE_ORIGINAL =
	'function isCommandEnabled(config: WebSearchConfig, name: "websearch" | "curator" | "search" | "google-account"): boolean {';
const INDEX_COMMAND_GATE_TYPE_PATCHED =
	'function isCommandEnabled(config: WebSearchConfig, name: "websearch" | "curator" | "web-results" | "google-account"): boolean {';
const INDEX_SEARCH_COMMAND_ORIGINAL =
	'if (isCommandEnabled(initConfig, "search")) pi.registerCommand("search",';
const INDEX_SEARCH_COMMAND_PATCHED =
	'if (isCommandEnabled(initConfig, "web-results")) pi.registerCommand("web-results",';
const STORAGE_CONFIG_IMPORT_ORIGINAL =
	'import { getWebSearchConfigDir } from "./utils.ts";';
const STORAGE_CONFIG_IMPORT_PATCHED =
	'import { getWebSearchConfigPath } from "./utils.ts";';
const STORAGE_PATH_IMPORT_ORIGINAL =
	'import { join } from "node:path";';
const STORAGE_PATH_IMPORT_PATCHED =
	'import { dirname, join } from "node:path";';
const STORAGE_CACHE_PATH_ORIGINAL =
	"return join(getWebSearchConfigDir(), FETCH_CACHE_DIR);";
const STORAGE_CACHE_PATH_PATCHED =
	"return join(dirname(getWebSearchConfigPath()), FETCH_CACHE_DIR);";
const STORAGE_BASELINE_SHA256 = "89ee6ff204ceb108a7d619f4a207819f774bd829a7f80d6ccd1a780009ea012f";
const STORAGE_CONFIG_PATCHED_SHA256 = "471c9bf444b48775e9571c53f447e222f1b19b0185efdacab6058d6be7e77a2b";
const INDEX_SINGLE_FETCH_ERROR_ORIGINAL =
	'content: [{ type: "text", text: `Error: ${result.error}` }],';
const INDEX_SINGLE_FETCH_ERROR_PATCHED =
	'content: [{ type: "text", text: `Error: ${result.error}\\nStored content responseId: "${responseId}".` }],';
const INDEX_SINGLE_FETCH_CONTENT_ANCHOR =
	"\t\t\t\tconst content: Array<TextContent | ImageContent> = [];";
const INDEX_SINGLE_FETCH_CONTENT_ID_LINE =
	'\t\t\t\toutput += `\\n\\n---\\nStored content responseId: "${responseId}".`;';
const INDEX_SINGLE_FETCH_CONTENT_PATCHED = [
	INDEX_SINGLE_FETCH_CONTENT_ID_LINE,
	"",
	INDEX_SINGLE_FETCH_CONTENT_ANCHOR,
].join("\n");

function patchFetchCacheStorageSource(source) {
	const sourceDigest = createHash("sha256")
		.update(source.replace(/\r\n/g, "\n"))
		.digest("hex");
	if (
		sourceDigest !== STORAGE_BASELINE_SHA256 &&
		sourceDigest !== STORAGE_CONFIG_PATCHED_SHA256
	) {
		throw new Error(
			`Unsupported pi-web-access ${PI_WEB_ACCESS_REQUIRED_VERSION} storage layout: expected ${STORAGE_BASELINE_SHA256} or ${STORAGE_CONFIG_PATCHED_SHA256}, found ${sourceDigest}`,
		);
	}
	return { source, changed: false };
}

// Issue #169: bound each primary web_search call so one wedged provider or
// extraction path cannot withhold sibling tool results indefinitely. Upstream
// 0.18.0 owns curator-session isolation and browser-connect timeouts.
const SEARCH_DEADLINE_HELPER = [
	"const SEARCH_CALL_TIMEOUT_MS = 90000;",
	"",
	"async function searchWithDeadline(query: string, options: Parameters<typeof search>[1]): ReturnType<typeof search> {",
	"\tlet deadlineTimer: ReturnType<typeof setTimeout> | undefined;",
	"\tconst deadline = new Promise<never>((_, reject) => {",
	"\t\tdeadlineTimer = setTimeout(",
	"\t\t\t() => reject(new Error(`web_search timed out after ${SEARCH_CALL_TIMEOUT_MS / 1000}s: \"${query}\"`)),",
	"\t\t\tSEARCH_CALL_TIMEOUT_MS,",
	"\t\t);",
	"\t\tdeadlineTimer.unref?.();",
	"\t});",
	"\ttry {",
	"\t\treturn await Promise.race([search(query, options), deadline]);",
	"\t} finally {",
	"\t\tclearTimeout(deadlineTimer);",
	"\t}",
	"}",
].join("\n");

function patchWebSearchHangSource(source) {
	let patched = source;
	let changed = false;

	const helperAnchor = "const DEFAULT_MAX_INLINE_CONTENT_CHARS = 30_000;";
	if (!patched.includes("function searchWithDeadline(") && patched.includes(helperAnchor)) {
		patched = patched.replace(helperAnchor, `${SEARCH_DEADLINE_HELPER}\n\n${helperAnchor}`);
		changed = true;
	}

	for (const callOriginal of [
		"const { answer, results, inlineContent, provider } = await search(queryList[qi], {",
		"const response = await search(queryList[qi], {",
		"const response = await search(query, {",
		"const { answer, results, inlineContent, provider } = await search(query, {",
	]) {
		const callPatched = callOriginal.replace("await search(", "await searchWithDeadline(");
		if (patched.includes(callOriginal)) {
			patched = patched.split(callOriginal).join(callPatched);
			changed = true;
		}
	}

	patched = patched.replace("() => search(query, {", "() => searchWithDeadline(query, {");
	return { source: patched, changed };
}

function patchSummaryModelScopeSource(source) {
	let patched = source;
	let changed = false;

	for (const legacyImport of [
		'import { existsSync, readFileSync } from "node:fs";\n',
		'import { homedir } from "node:os";\n',
		'import { join } from "node:path";\n',
	]) {
		if (patched.includes(legacyImport)) {
			patched = patched.replace(legacyImport, "");
			changed = true;
		}
	}

	const thinkingLevelsOriginal = 'const THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh"]);';
	const thinkingLevelsPatched = 'const THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);';
	if (patched.includes(thinkingLevelsOriginal)) {
		patched = patched.replace(thinkingLevelsOriginal, thinkingLevelsPatched);
		changed = true;
	}

	const contextOriginal = [
		"interface SummaryModelScopeContext {",
		"\tcwd: string;",
		"\tisProjectTrusted(): boolean;",
		"}",
	].join("\n");
	const contextPatched = [
		"interface SummaryModelScopeContext {",
		"\tscopedModels: readonly { model: ModelLike }[];",
		"}",
	].join("\n");
	if (patched.includes(contextOriginal)) {
		patched = patched.replace(contextOriginal, contextPatched);
		changed = true;
	}

	const legacyHelpers = [
		"function getAgentDir(): string {",
		'\treturn process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");',
		"}",
		"",
		"function readSettings(path: string): Record<string, unknown> {",
		"\tif (!existsSync(path)) return {};",
		'\tconst raw = readFileSync(path, "utf8");',
		"\ttry {",
		"\t\treturn JSON.parse(raw) as Record<string, unknown>;",
		"\t} catch (err) {",
		"\t\tconst message = err instanceof Error ? err.message : String(err);",
		"\t\tthrow new Error(`Failed to parse ${path}: ${message}`);",
		"\t}",
		"}",
		"",
	].join("\n");
	if (patched.includes(legacyHelpers)) {
		patched = patched.replace(legacyHelpers, "");
		changed = true;
	}

	const loadOriginal = [
		"export function loadEnabledModelPatterns(ctx: SummaryModelScopeContext): string[] | null {",
		'\tconst globalSettings = readSettings(join(getAgentDir(), "settings.json"));',
		"\tconst projectSettings = ctx.isProjectTrusted()",
		'\t\t? readSettings(join(ctx.cwd, ".pi", "settings.json"))',
		"\t\t: {};",
		'\tconst value = Object.hasOwn(projectSettings, "enabledModels")',
		"\t\t? projectSettings.enabledModels",
		"\t\t: globalSettings.enabledModels;",
		"\tif (value === undefined) return null;",
		'\tif (!Array.isArray(value)) throw new Error("enabledModels must be an array");',
		"\treturn value",
		'\t\t.filter((item): item is string => typeof item === "string")',
		"\t\t.map(item => item.trim())",
		"\t\t.filter(Boolean);",
		"}",
	].join("\n");
	const loadPatched = [
		"export function loadEnabledModelPatterns(ctx: SummaryModelScopeContext): string[] | null {",
		"\tif (ctx.scopedModels.length === 0) return null;",
		"\treturn ctx.scopedModels.map(({ model }) => summaryModelValue(model));",
		"}",
	].join("\n");
	if (patched.includes(loadOriginal)) {
		patched = patched.replace(loadOriginal, loadPatched);
		changed = true;
	}

	if (!patched.includes("export function modelMatchesScopedModels(")) {
		const scopeHelper = [
			"export function modelMatchesScopedModels(",
			"\tmodel: ModelLike,",
			"\tscopedModels: readonly { model: ModelLike }[],",
			"): boolean {",
			"\treturn scopedModels.length === 0 || scopedModels.some(({ model: scopedModel }) =>",
			"\t\tscopedModel.provider === model.provider && scopedModel.id === model.id,",
			"\t);",
			"}",
			"",
		].join("\n");
		const anchor = "export function loadEnabledModelPatterns(";
		if (patched.includes(anchor)) {
			patched = patched.replace(anchor, `${scopeHelper}${anchor}`);
			changed = true;
		}
	}

	for (const requiredMarker of [
		thinkingLevelsPatched,
		contextPatched,
		loadPatched,
		"export function modelMatchesScopedModels(",
	]) {
		if (!patched.includes(requiredMarker)) {
			throw new Error(
				`Unsupported pi-web-access ${PI_WEB_ACCESS_REQUIRED_VERSION} summary model scope layout: missing ${requiredMarker}`,
			);
		}
	}
	for (const staleMarker of [
		"function getAgentDir(): string {",
		"function readSettings(",
		'join(ctx.cwd, ".pi", "settings.json")',
	]) {
		if (patched.includes(staleMarker)) {
			throw new Error(
				`Unsupported pi-web-access ${PI_WEB_ACCESS_REQUIRED_VERSION} summary model scope layout: stale ${staleMarker}`,
			);
		}
	}

	return { source: patched, changed };
}

export function patchPiWebAccessSource(relativePath, source) {
	let patched = source.replace(/\r\n/g, "\n");
	let changed = false;

	if (!patched.includes(PATCHED_CONFIG_EXPR)) {
		patched = patched.split(LEGACY_CONFIG_EXPR).join(PATCHED_CONFIG_EXPR);
		changed = patched !== source;
	}

	const forwardPatched = patchPiWebAccessForwardFixSource(relativePath, patched);
	changed = forwardPatched !== patched || changed;
	patched = forwardPatched;

	if (relativePath === "index.ts") {
		for (const [original, replacement] of [
			[INDEX_COMMAND_CONFIG_ORIGINAL, INDEX_COMMAND_CONFIG_PATCHED],
			[INDEX_COMMAND_GATE_TYPE_ORIGINAL, INDEX_COMMAND_GATE_TYPE_PATCHED],
			[INDEX_SEARCH_COMMAND_ORIGINAL, INDEX_SEARCH_COMMAND_PATCHED],
			[INDEX_SINGLE_FETCH_ERROR_ORIGINAL, INDEX_SINGLE_FETCH_ERROR_PATCHED],
		]) {
			if (patched.includes(original)) {
				patched = patched.replace(original, replacement);
				changed = true;
			}
		}
		if (
			!patched.includes(INDEX_SINGLE_FETCH_CONTENT_ID_LINE) &&
			patched.includes(INDEX_SINGLE_FETCH_CONTENT_ANCHOR)
		) {
			patched = patched.replace(
				INDEX_SINGLE_FETCH_CONTENT_ANCHOR,
				INDEX_SINGLE_FETCH_CONTENT_PATCHED,
			);
			changed = true;
		}

		for (const staleBinding of [
			INDEX_CONFIG_PATH_BINDING_LEGACY,
			INDEX_CONFIG_PATH_BINDING_PARTIAL,
			INDEX_CONFIG_PATH_BINDING_ENV,
		]) {
			if (patched.includes(staleBinding)) {
				patched = patched.replace(staleBinding, INDEX_CONFIG_PATH_BINDING_PATCHED);
				changed = true;
			}
		}
		for (const staleDirectory of [
			INDEX_CONFIG_WRITE_DIRECTORY_LEGACY,
			INDEX_CONFIG_WRITE_DIRECTORY_CURRENT,
		]) {
			if (patched.includes(staleDirectory)) {
				patched = patched.replace(staleDirectory, INDEX_CONFIG_WRITE_DIRECTORY_PATCHED);
				changed = true;
			}
		}
		if (patched.includes(INDEX_CONFIG_HELPER_IMPORT_ORIGINAL)) {
			patched = patched.replace(
				INDEX_CONFIG_HELPER_IMPORT_ORIGINAL,
				INDEX_CONFIG_HELPER_IMPORT_PATCHED,
			);
			changed = true;
		}
		if (patched.includes(INDEX_CONFIG_HELPER_IMPORT_LEGACY)) {
			patched = patched.replace(
				INDEX_CONFIG_HELPER_IMPORT_LEGACY,
				INDEX_CONFIG_HELPER_IMPORT_LEGACY_PATCHED,
			);
			changed = true;
		}
		if (patched.includes('import { join } from "node:path";')) {
			patched = patched.replace(
				'import { join } from "node:path";',
				'import { dirname, join } from "node:path";',
			);
			changed = true;
		}

		const summaryContextsPatched = patched.replace(
			/^([ \t]*)modelRegistry: ctx\.modelRegistry,\n(?:\1scopedModels: ctx\.scopedModels,\n)?\1cwd: ctx\.cwd,/gm,
			(_match, indent) => [
				`${indent}modelRegistry: ctx.modelRegistry,`,
				`${indent}get scopedModels() { return ctx.scopedModels; },`,
				`${indent}cwd: ctx.cwd,`,
			].join("\n"),
		);
		if (summaryContextsPatched !== patched) {
			patched = summaryContextsPatched;
			changed = true;
		}

		const scopeImportOriginal =
			'import { findModelWithProviderRouting, loadEnabledModelPatterns, modelMatchesEnabledPatterns, splitThinkingSuffix } from "./summary-model-scope.ts";';
		const scopeImportPatched =
			'import { findModelWithProviderRouting, modelMatchesScopedModels, splitThinkingSuffix } from "./summary-model-scope.ts";';
		if (patched.includes(scopeImportOriginal)) {
			patched = patched.replace(scopeImportOriginal, scopeImportPatched);
			changed = true;
		}
		for (const staleLine of [
			"\t\tconst enabledModelPatterns = loadEnabledModelPatterns(ctx);\n",
			"\t\tlet enabledModelPatterns: string[] | null = null;\n",
			"\t\t\tenabledModelPatterns = loadEnabledModelPatterns(summaryContext);\n",
		]) {
			if (patched.includes(staleLine)) {
				patched = patched.replace(staleLine, "");
				changed = true;
			}
		}
		for (const [legacyCheck, scopedCheck] of [
			[
				"if (!model || !modelMatchesEnabledPatterns(model, enabledModelPatterns)) continue;",
				"if (!model || !modelMatchesScopedModels(model, ctx.scopedModels)) continue;",
			],
			[
				"if (!modelMatchesEnabledPatterns(model, enabledModelPatterns)) continue;",
				"if (!modelMatchesScopedModels(model, summaryContext.scopedModels)) continue;",
			],
			[
				"modelMatchesEnabledPatterns(summaryContext.model, enabledModelPatterns)",
				"modelMatchesScopedModels(summaryContext.model, summaryContext.scopedModels)",
			],
		]) {
			if (patched.includes(legacyCheck)) {
				patched = patched.replace(legacyCheck, scopedCheck);
				changed = true;
			}
		}

		const workflowDefaultOriginal = 'const workflow = resolveWorkflow(params.workflow ?? configWorkflow, ctx?.hasUI !== false);';
		const workflowDefaultPatched = 'const workflow = resolveWorkflow(params.workflow ?? configWorkflow ?? "none", ctx?.hasUI !== false);';
		if (patched.includes(workflowDefaultOriginal)) {
			patched = patched.replace(workflowDefaultOriginal, workflowDefaultPatched);
			changed = true;
		}
		if (patched.includes('summary-review = open curator with auto summary draft (default)')) {
			patched = patched.replace(
				'summary-review = open curator with auto summary draft (default)',
				'summary-review = open curator with auto summary draft (opt-in)',
			);
			changed = true;
		}
		if (patched.includes("else Gemini API (needs key), else Gemini Web (needs a supported Chromium-based browser login).")) {
			patched = patched.replace(
				"else Gemini API (needs key), else Gemini Web (needs a supported Chromium-based browser login).",
				"else Gemini API (needs key). Gemini Web browser-cookie fallback is disabled unless web-search.json sets geminiBrowser to true.",
			);
			changed = true;
		}
		if (patched.includes("or Gemini Web. When SearXNG is configured")) {
			patched = patched.replace(
				"or Gemini Web. When SearXNG is configured",
				"or opt-in Gemini Web. When SearXNG is configured",
			);
			changed = true;
		}
		if (patched.includes('Searches auto-open the interactive browser curator and stream results live; set workflow to "none" to skip curation or "auto-summary" for a model-generated summary without the browser curator.')) {
			patched = patched.replace(
				'Searches auto-open the interactive browser curator and stream results live; set workflow to "none" to skip curation or "auto-summary" for a model-generated summary without the browser curator.',
				'Searches return directly by default; set workflow to "summary-review" to open the interactive browser curator or "auto-summary" for a model-generated summary without the browser curator.',
			);
			changed = true;
		}
		if (patched.includes('Set "geminiBrowser": true in web-search.json')) {
			patched = patched.replace(
				/Set "geminiBrowser": true in web-search\.json/g,
				'Set \\"geminiBrowser\\": true in web-search.json',
			);
			changed = true;
		}
	}

	if (relativePath === "index.ts" && patched.includes('pi.registerCommand("search",')) {
		patched = patched.replace('pi.registerCommand("search",', 'pi.registerCommand("web-results",');
		changed = true;
	}

	if (relativePath === "storage.ts") {
		const cachePatch = patchFetchCacheStorageSource(patched);
		patched = cachePatch.source;
		changed = changed || cachePatch.changed;
		for (const [original, replacement] of [
			[STORAGE_CONFIG_IMPORT_ORIGINAL, STORAGE_CONFIG_IMPORT_PATCHED],
			[STORAGE_PATH_IMPORT_ORIGINAL, STORAGE_PATH_IMPORT_PATCHED],
			[STORAGE_CACHE_PATH_ORIGINAL, STORAGE_CACHE_PATH_PATCHED],
		]) {
			if (patched.includes(original)) {
				patched = patched.replace(original, replacement);
				changed = true;
			}
		}
	}

	if (relativePath === "index.ts") {
		const searchHangPatch = patchWebSearchHangSource(patched);
		patched = searchHangPatch.source;
		changed = changed || searchHangPatch.changed;
	}

	if (relativePath === "summary-model-scope.ts") {
		const scopePatch = patchSummaryModelScopeSource(patched);
		patched = scopePatch.source;
		changed = changed || scopePatch.changed;
	}

	if (relativePath === "page-query.ts") {
		const scopeImportOriginal =
			'import { findModelWithProviderRouting, loadEnabledModelPatterns, modelMatchesEnabledPatterns } from "./summary-model-scope.ts";';
		const scopeImportPatched =
			'import { findModelWithProviderRouting, modelMatchesScopedModels } from "./summary-model-scope.ts";';
		if (patched.includes(scopeImportOriginal)) {
			patched = patched.replace(scopeImportOriginal, scopeImportPatched);
			changed = true;
		}
		const scopeCheckOriginal = "modelMatchesEnabledPatterns(model, loadEnabledModelPatterns(ctx))";
		const scopeCheckPatched = "modelMatchesScopedModels(model, ctx.scopedModels)";
		if (patched.includes(scopeCheckOriginal)) {
			patched = patched.replace(scopeCheckOriginal, scopeCheckPatched);
			changed = true;
		}
	}

	if (relativePath === "summary-review.ts") {
		const scopeImportOriginal =
			'import { findModelWithProviderRouting, loadEnabledModelPatterns, modelMatchesEnabledPatterns, splitThinkingSuffix, type SummaryThinkingLevel } from "./summary-model-scope.ts";';
		const scopeImportPatched =
			'import { findModelWithProviderRouting, modelMatchesScopedModels, splitThinkingSuffix, type SummaryThinkingLevel } from "./summary-model-scope.ts";';
		if (patched.includes(scopeImportOriginal)) {
			patched = patched.replace(scopeImportOriginal, scopeImportPatched);
			changed = true;
		}
		const contextOriginal =
			'export type SummaryGenerationContext = Pick<ExtensionContext, "model" | "modelRegistry" | "cwd" | "isProjectTrusted">;';
		const contextPatched =
			'export type SummaryGenerationContext = Pick<ExtensionContext, "model" | "modelRegistry" | "scopedModels" | "cwd" | "isProjectTrusted">;';
		if (patched.includes(contextOriginal)) {
			patched = patched.replace(contextOriginal, contextPatched);
			changed = true;
		}
		const enabledPatternsOriginal = "\tconst enabledModelPatterns = loadEnabledModelPatterns(ctx);\n";
		if (patched.includes(enabledPatternsOriginal)) {
			patched = patched.replace(enabledPatternsOriginal, "");
			changed = true;
		}
		const scopeCheckOriginal = "modelMatchesEnabledPatterns(model, enabledModelPatterns)";
		const scopeCheckPatched = "modelMatchesScopedModels(model, ctx.scopedModels)";
		if (patched.includes(scopeCheckOriginal)) {
			patched = patched.replace(scopeCheckOriginal, scopeCheckPatched);
			changed = true;
		}
	}

	if (relativePath === "gemini-web.ts") {
		const geminiPatch = patchGeminiWebSource(patched);
		patched = geminiPatch.source;
		changed = changed || geminiPatch.changed;
	}

	if (relativePath === "gemini-web-config.ts") {
		const geminiPatch = patchGeminiWebConfigSource(patched);
		patched = geminiPatch.source;
		changed = changed || geminiPatch.changed;
	}

	if (relativePath === "gemini-search.ts") {
		if (patched.includes("  2. Sign into gemini.google.com in a supported Chromium-based browser")) {
			patched = patched.replace(
				"  2. Sign into gemini.google.com in a supported Chromium-based browser",
				'  2. Opt into Gemini Web browser-cookie access by setting \\"geminiBrowser\\": true in web-search.json',
			);
			changed = true;
		}
		if (patched.includes("  3. Sign into gemini.google.com in a supported Chromium-based browser")) {
			patched = patched.replace(
				"  3. Sign into gemini.google.com in a supported Chromium-based browser",
				'  3. Opt into Gemini Web browser-cookie access by setting \\"geminiBrowser\\": true in web-search.json, then sign in to gemini.google.com',
			);
			changed = true;
		}
		if (patched.includes("  4. Sign into gemini.google.com in a supported Chromium-based browser")) {
			patched = patched.replace(
				"  4. Sign into gemini.google.com in a supported Chromium-based browser",
				'  4. Opt into Gemini Web browser-cookie access by setting \\"geminiBrowser\\": true in web-search.json',
			);
			changed = true;
		}
		if (patched.includes("  5. Sign into gemini.google.com in a supported Chromium-based browser")) {
			patched = patched.replace(
				"  5. Sign into gemini.google.com in a supported Chromium-based browser",
				'  5. Opt into Gemini Web browser-cookie access by setting \\"geminiBrowser\\": true in web-search.json, then sign in to gemini.google.com',
			);
			changed = true;
		}
		if (patched.includes('setting "geminiBrowser": true in web-search.json')) {
			patched = patched.replace(
				/setting "geminiBrowser": true in web-search\.json/g,
				'setting \\"geminiBrowser\\": true in web-search.json',
			);
			changed = true;
		}
	}

	if (relativePath === "pdf-extract.ts") {
		for (const legacyOutputDir of LEGACY_PDF_OUTPUT_DIRS) {
			if (patched.includes(legacyOutputDir)) {
				patched = patched.replace(legacyOutputDir, PATCHED_PDF_OUTPUT_DIR);
				changed = true;
			}
		}
		if (patched.includes('import { homedir } from "node:os";') && patched.includes(PATCHED_PDF_OUTPUT_DIR)) {
			patched = patched.replace('import { homedir } from "node:os";\n', "");
			changed = true;
		}
		if (patched.includes('import { tmpdir } from "node:os";') && patched.includes(PATCHED_PDF_OUTPUT_DIR)) {
			patched = patched.replace('import { tmpdir } from "node:os";\n', "");
			changed = true;
		}
	}

	if (relativePath === "utils.ts") {
		patched = patchProxyUtilitySource(patched);
	}

	if (relativePath === "ssrf-protection.ts") {
		patched = patchSsrfNoProxySource(patched);
	}

	if (relativePath === "github-api.ts") {
		patched = patchGitHubApiProxySource(patched);
	}

	if (relativePath === "github-issue-pr.ts") {
		patched = patchGitHubIssueProxySource(patched);
	}

	if (relativePath === "github-extract.ts") {
		patched = patchGitHubCloneProxySource(patched);
	}

	if (relativePath === "gemini-adc.ts") {
		patched = patchGeminiAdcPathSource(patched);
	}

	if (relativePath === "utils.ts" && patched.includes(CONFIG_PATH_HELPER)) {
		patched = patched.replace(CONFIG_PATH_HELPER, PATCHED_CONFIG_PATH_HELPER);
	}

	return patched;
}
