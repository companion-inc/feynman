export const PI_WEB_ACCESS_PATCH_TARGETS = [
	"index.ts",
	"exa.ts",
	"gemini-api.ts",
	"gemini-search.ts",
	"gemini-web-config.ts",
	"gemini-web.ts",
	"github-extract.ts",
	"perplexity.ts",
	"pdf-extract.ts",
	"video-extract.ts",
	"youtube-extract.ts",
	"utils.ts",
];

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

function patchGeminiWebSource(source) {
	let patched = source;
	let changed = false;

	if (!patched.includes("geminiBrowser?: boolean;")) {
		const original = ["interface GeminiWebConfig {", "\tchromeProfile?: string;", "}"].join("\n");
		const replacement = [
			"interface GeminiWebConfig {",
			"\tchromeProfile?: string;",
			"\tgeminiBrowser?: boolean;",
			"}",
		].join("\n");
		if (patched.includes(original)) {
			patched = patched.replace(original, replacement);
			changed = true;
		}
	}

	const rawTypeOriginal = "let raw: { chromeProfile?: unknown };";
	const rawTypePatched =
		"let raw: { chromeProfile?: unknown; geminiBrowser?: unknown; allowBrowserAuth?: unknown; browserAuth?: unknown };";
	if (patched.includes(rawTypeOriginal)) {
		patched = patched.replace(rawTypeOriginal, rawTypePatched);
		changed = true;
	}

	const configOriginal = ["cachedConfig = {", "\t\tchromeProfile: normalizeChromeProfile(raw.chromeProfile),", "\t};"].join("\n");
	const configPatched = [
		"cachedConfig = {",
		"\t\tchromeProfile: normalizeChromeProfile(raw.chromeProfile),",
		"\t\tgeminiBrowser: normalizeBooleanFlag(raw.geminiBrowser ?? raw.allowBrowserAuth ?? raw.browserAuth),",
		"\t};",
	].join("\n");
	if (patched.includes(configOriginal)) {
		patched = patched.replace(configOriginal, configPatched);
		changed = true;
	}

	if (!patched.includes("function normalizeBooleanFlag(")) {
		const anchor = [
			"function getChromeProfileFromConfig(): string | undefined {",
			"\treturn loadConfig().chromeProfile;",
			"}",
		].join("\n");
		const replacement = [
			"function normalizeBooleanFlag(value: unknown): boolean {",
			"\tif (value === true) return true;",
			'\tif (typeof value !== "string") return false;',
			"\tconst normalized = value.trim().toLowerCase();",
			'\treturn normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";',
			"}",
			"",
			anchor,
		].join("\n");
		if (patched.includes(anchor)) {
			patched = patched.replace(anchor, replacement);
			changed = true;
		}
	}

	const availabilityOriginal = [
		"export async function isGeminiWebAvailable(chromeProfile?: string): Promise<CookieMap | null> {",
		"\tconst result = await getGoogleCookies({",
		"\t\tprofile: normalizeChromeProfile(chromeProfile) ?? getChromeProfileFromConfig(),",
		"\t\trequiredCookies: REQUIRED_COOKIES,",
		"\t});",
		"\tif (!result) return null;",
		"\treturn result.cookies;",
		"}",
	].join("\n");
	const availabilityPatched = [
		"export async function isGeminiWebAvailable(chromeProfile?: string): Promise<CookieMap | null> {",
		"\tconst config = loadConfig();",
		"\tif (!config.geminiBrowser) return null;",
		"\tconst result = await getGoogleCookies({",
		"\t\tprofile: normalizeChromeProfile(chromeProfile) ?? config.chromeProfile,",
		"\t\trequiredCookies: REQUIRED_COOKIES,",
		"\t});",
		"\tif (!result) return null;",
		"\treturn result.cookies;",
		"}",
	].join("\n");
	if (patched.includes(availabilityOriginal)) {
		patched = patched.replace(availabilityOriginal, availabilityPatched);
		changed = true;
	}

	const profileHelper = [
		"function getChromeProfileFromConfig(): string | undefined {",
		"\treturn loadConfig().chromeProfile;",
		"}",
	].join("\n");
	if (patched.includes(profileHelper) && patched.includes("config.chromeProfile")) {
		patched = patched.replace(`${profileHelper}\n\n`, "").replace(`${profileHelper}\n`, "");
		changed = true;
	}

	return { source: patched, changed };
}

function patchGeminiWebConfigSource(source) {
	let patched = source;
	let changed = false;

	if (!patched.includes("geminiBrowser?: boolean;")) {
		const original = [
			"interface GeminiWebConfig {",
			"\tchromeProfile?: string;",
			"\tallowBrowserCookies?: boolean;",
			"}",
		].join("\n");
		const replacement = [
			"interface GeminiWebConfig {",
			"\tchromeProfile?: string;",
			"\tallowBrowserCookies?: boolean;",
			"\tgeminiBrowser?: boolean;",
			"\tallowBrowserAuth?: boolean;",
			"\tbrowserAuth?: boolean;",
			"}",
		].join("\n");
		if (patched.includes(original)) {
			patched = patched.replace(original, replacement);
			changed = true;
		}
	}

	const rawTypeOriginal = "let raw: { chromeProfile?: unknown; allowBrowserCookies?: unknown };";
	const rawTypePatched =
		"let raw: { chromeProfile?: unknown; allowBrowserCookies?: unknown; geminiBrowser?: unknown; allowBrowserAuth?: unknown; browserAuth?: unknown };";
	if (patched.includes(rawTypeOriginal)) {
		patched = patched.split(rawTypeOriginal).join(rawTypePatched);
		changed = true;
	}

	if (!patched.includes("function normalizeBooleanFlag(")) {
		const anchor = [
			"function loadConfig(): GeminiWebConfig {",
		].join("\n");
		const replacement = [
			"function normalizeBooleanFlag(value: unknown): boolean {",
			"\tif (value === true) return true;",
			'\tif (typeof value !== "string") return false;',
			"\tconst normalized = value.trim().toLowerCase();",
			'\treturn normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";',
			"}",
			"",
			anchor,
		].join("\n");
		if (patched.includes(anchor)) {
			patched = patched.replace(anchor, replacement);
			changed = true;
		}
	}

	const configOriginal = "\t\tallowBrowserCookies: raw.allowBrowserCookies === true,";
	const configPatched =
		"\t\tallowBrowserCookies: normalizeBooleanFlag(raw.allowBrowserCookies) || normalizeBooleanFlag(raw.geminiBrowser) || normalizeBooleanFlag(raw.allowBrowserAuth) || normalizeBooleanFlag(raw.browserAuth),";
	if (patched.includes(configOriginal)) {
		patched = patched.replace(configOriginal, configPatched);
		changed = true;
	}

	return { source: patched, changed };
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

	const helperAnchor = "const MAX_INLINE_CONTENT = 30000; // Content returned directly to agent";
	if (!patched.includes("function searchWithDeadline(") && patched.includes(helperAnchor)) {
		patched = patched.replace(helperAnchor, `${SEARCH_DEADLINE_HELPER}\n\n${helperAnchor}`);
		changed = true;
	}

	for (const callOriginal of [
		"const { answer, results, inlineContent, provider } = await search(queryList[qi], {",
		"const response = await search(queryList[qi], {",
		"const { answer, results, inlineContent, provider } = await search(query, {",
	]) {
		const callPatched = callOriginal.replace("await search(", "await searchWithDeadline(");
		if (patched.includes(callOriginal)) {
			patched = patched.split(callOriginal).join(callPatched);
			changed = true;
		}
	}

	return { source: patched, changed };
}

export function patchPiWebAccessSource(relativePath, source) {
	let patched = source;
	let changed = false;

	if (!patched.includes(PATCHED_CONFIG_EXPR)) {
		patched = patched.split(LEGACY_CONFIG_EXPR).join(PATCHED_CONFIG_EXPR);
		changed = patched !== source;
	}

	if (relativePath === "index.ts") {
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

	if (relativePath === "index.ts" && changed) {
		patched = patched.replace('import { join } from "node:path";', 'import { dirname, join } from "node:path";');
		patched = patched.replace('const dir = join(homedir(), ".pi");', "const dir = dirname(WEB_SEARCH_CONFIG_PATH);");
	}

	if (relativePath === "index.ts" && patched.includes('pi.registerCommand("search",')) {
		patched = patched.replace('pi.registerCommand("search",', 'pi.registerCommand("web-results",');
		changed = true;
	}

	if (relativePath === "index.ts") {
		const searchHangPatch = patchWebSearchHangSource(patched);
		patched = searchHangPatch.source;
		changed = changed || searchHangPatch.changed;
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

	if (relativePath === "utils.ts" && patched.includes(CONFIG_PATH_HELPER)) {
		patched = patched.replace(CONFIG_PATH_HELPER, PATCHED_CONFIG_PATH_HELPER);
	}

	return patched;
}
