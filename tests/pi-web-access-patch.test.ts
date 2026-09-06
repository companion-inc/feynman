import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import {
	assertPiWebAccessPatchedSources,
	assertPiWebAccessVersion,
	PI_WEB_ACCESS_FORWARD_FILE_TARGETS,
	PI_WEB_ACCESS_PATCH_TARGETS,
	PI_WEB_ACCESS_REQUIRED_VERSION,
	patchPiWebAccessForwardFixSource,
	patchPiWebAccessSource,
	patchPiWebAccessSources,
} from "../scripts/lib/pi-web-access-patch.mjs";

const PI_WEB_ACCESS_FIXTURE_ROOT = join(
	import.meta.dirname,
	"..",
	"fixtures",
	"pi-web-access-0.28.0",
);
const PI_WEB_ACCESS_FORWARD_FIXTURE_ROOT = join(
	import.meta.dirname,
	"..",
	"fixtures",
	"pi-web-access-0.28.0",
);
const PI_WEB_ACCESS_RUNTIME_ROOT = join(
	import.meta.dirname,
	"..",
	".feynman",
	"npm",
	"node_modules",
	"pi-web-access",
);

function readPiWebAccessFixtureSources(): Map<string, string> {
	return new Map(
		PI_WEB_ACCESS_PATCH_TARGETS.map((relativePath) => [
			relativePath,
			readFileSync(
				PI_WEB_ACCESS_FORWARD_FILE_TARGETS.includes(relativePath)
					? join(PI_WEB_ACCESS_FORWARD_FIXTURE_ROOT, relativePath)
					: join(PI_WEB_ACCESS_FIXTURE_ROOT, relativePath),
				"utf8",
			),
		]),
	);
}

test("package artifact verification checks every pi-web-access patch target", () => {
	const source = readFileSync(
		join(import.meta.dirname, "..", "scripts", "verify-package-artifact.mjs"),
		"utf8",
	);

	assert.match(source, /PI_WEB_ACCESS_PATCH_TARGETS\.map\(\(relativePath\) =>/);
	assert.match(source, /`npm\/node_modules\/pi-web-access\/\$\{relativePath\}`/);
	assert.match(source, /assertPiWebAccessPatchedSources/);
	assert.match(
		source,
		/"const WEB_SEARCH_CONFIG_PATH = getWebSearchConfigPath\(\);"/,
	);
	assert.match(
		source,
		/"const dir = dirname\(WEB_SEARCH_CONFIG_PATH\);"/,
	);
	assert.match(source, /npm\/node_modules\/pi-web-access\/duckduckgo\.ts/);
	assert.match(source, /npm\/node_modules\/pi-web-access\/bocha\.ts/);
	assert.match(source, /npm\/node_modules\/pi-web-access\/datalab-pdf-extract\.ts/);
	assert.match(source, /export async function searchWithDuckDuckGo/);
	assert.match(source, /export async function searchWithBocha/);
	assert.match(source, /export async function extractPDFViaDatalab/);
	assert.match(source, /storeFetchedContentResult/);
	assert.match(source, /summaryGenerationDeadlineMs/);
	assert.match(source, /web-search-cache/);
	assert.match(source, /Image fetching is disabled by image\.enabled/);
	assert.match(source, /const enabled = pdf\.enabled !== false/);
	assert.match(
		source,
		/findModelWithProviderRouting, modelMatchesScopedModels, splitThinkingSuffix, type SummaryThinkingLevel/,
	);

	const indexMarkers = source.match(
		/requireMarkers\(\s*webSource,\s*"runtime pi-web-access research tools",\s*\[([\s\S]*?)\]\s*,\s*\);/,
	)?.[1];
	assert.ok(indexMarkers, "package verifier must inspect pi-web-access index.ts");
	assert.doesNotMatch(indexMarkers, /modelMatchesScopedModels\(model, ctx\.scopedModels\)/);
	assert.match(
		indexMarkers,
		/modelMatchesScopedModels\(model, summaryContext\.scopedModels\)/,
	);
	assert.match(indexMarkers, /Ignored when findText is supplied\./);
	assert.doesNotMatch(indexMarkers, /Cannot be combined with findText\./);

	const webDocs = readFileSync(
		join(
			import.meta.dirname,
			"..",
			"website",
			"src",
			"content",
			"docs",
			"tools",
			"web-search.md",
		),
		"utf8",
	);
	assert.match(webDocs, /offset` and `limit` are ignored when `findText` is supplied/);
	assert.match(webDocs, /%APPDATA%\\gcloud\\application_default_credentials\.json/);
	assert.match(webDocs, /IPv4 `127\.0\.0\.0\/8`/);

	const installedVerifier = readFileSync(
		join(import.meta.dirname, "..", "scripts", "verify-installed-runtime.mjs"),
		"utf8",
	);
	assert.match(installedVerifier, /export async function verifyWindowsWebCookies\(\)/);
	assert.match(installedVerifier, /DataProtectionScope\]::CurrentUser/);
	assert.match(installedVerifier, /"\$encoded=\$env:FEYNMAN_DPAPI_FIXTURE_INPUT;"/);
	assert.match(installedVerifier, /FEYNMAN_DPAPI_FIXTURE_INPUT: value\.toString\("base64"\)/);
	assert.match(installedVerifier, /timeout: 60_000/);
	assert.match(installedVerifier, /encryptWindowsChromiumCookie\("installed-one", key, "v10", hostKey\)/);
	assert.match(installedVerifier, /encryptWindowsChromiumCookie\("blocked-one", key, "v20"\)/);
	assert.match(installedVerifier, /const windowsWebCookies = await verifyWindowsWebCookies\(\);/);
});

test("patchPiWebAccessSource rewrites legacy Pi web-search config paths", () => {
	const input = [
		'import { join } from "node:path";',
		'import { homedir } from "node:os";',
		'const CONFIG_PATH = join(homedir(), ".pi", "web-search.json");',
		"",
	].join("\n");

	const patched = patchPiWebAccessSource("perplexity.ts", input);

	assert.match(patched, /FEYNMAN_WEB_SEARCH_CONFIG/);
	assert.match(patched, /PI_WEB_SEARCH_CONFIG/);
});

test("patchPiWebAccessSource keeps current upstream config helpers on Feynman's exact config file", () => {
	const input = [
		'import { join } from "node:path";',
		"export function getWebSearchConfigDir(): string {",
		"\tif (process.env.PI_CODING_AGENT_DIR) return process.env.PI_CODING_AGENT_DIR;",
		'\treturn "/tmp/.pi";',
		"}",
		"export function getWebSearchConfigPath(): string {",
		'\treturn join(getWebSearchConfigDir(), "web-search.json");',
		"}",
		"",
	].join("\n");

	const patched = patchPiWebAccessSource("utils.ts", input);

	assert.match(patched, /process\.env\.FEYNMAN_WEB_SEARCH_CONFIG\?\.trim\(\)/);
	assert.match(patched, /process\.env\.PI_WEB_SEARCH_CONFIG\?\.trim\(\)/);
	assert.match(patched, /configuredPath \|\| join\(getWebSearchConfigDir\(\), "web-search\.json"\)/);
	assert.equal(patchPiWebAccessSource("utils.ts", patched), patched);
});

test("patchPiWebAccessSource repairs partial index.ts config-path handling", () => {
	const input = [
		'import { existsSync, mkdirSync } from "node:fs";',
		'import { join } from "node:path";',
		'import { formatSeconds, getWebSearchConfigDir, getWebSearchConfigPath, installGlobalProxyFetch, resolveCuratorNetworkConfig, runWithProxy } from "./utils.ts";',
		'const WEB_SEARCH_CONFIG_PATH = join(getWebSearchConfigDir(), "web-search.json");',
		"function saveConfig(config: Record<string, unknown>): void {",
		"\tconst dir = getWebSearchConfigDir();",
		"\tif (!existsSync(dir)) mkdirSync(dir, { recursive: true });",
		'\twriteFileSync(WEB_SEARCH_CONFIG_PATH, JSON.stringify(config, null, 2) + "\\n");',
		"}",
		'pi.registerCommand("search", { description: "Browse stored web search results" });',
		"",
	].join("\n");

	const patched = patchPiWebAccessSource("index.ts", input);

	assert.match(patched, /import \{ dirname, join \} from "node:path";/);
	assert.match(
		patched,
			/import \{ formatSeconds, getWebSearchConfigPath, installGlobalProxyFetch, resolveCuratorNetworkConfig, runWithProxy \} from "\.\/utils\.ts";/,
	);
	assert.match(
		patched,
		/const WEB_SEARCH_CONFIG_PATH = getWebSearchConfigPath\(\);/,
	);
	assert.match(patched, /const dir = dirname\(WEB_SEARCH_CONFIG_PATH\);/);
	assert.doesNotMatch(
		patched,
		/const WEB_SEARCH_CONFIG_PATH = join\(getWebSearchConfigDir\(\), "web-search\.json"\);/,
	);
	assert.doesNotMatch(patched, /const dir = getWebSearchConfigDir\(\);/);
	assert.match(patched, /pi\.registerCommand\("web-results",/);
	assert.doesNotMatch(patched, /pi\.registerCommand\("search",/);
});

test("exact pi-web-access fixture binds config reads and writes to Feynman's path", () => {
	const patchedSources = patchPiWebAccessSources(
		readPiWebAccessFixtureSources(),
		"exact fixture",
	);
	const indexSource = patchedSources.get("index.ts") ?? "";

	assert.match(
		indexSource,
		/import \{ formatSeconds, getWebSearchConfigPath, installGlobalProxyFetch, resolveCuratorNetworkConfig, runWithProxy \} from "\.\/utils\.ts";/,
	);
	assert.match(
		indexSource,
		/const WEB_SEARCH_CONFIG_PATH = getWebSearchConfigPath\(\);/,
	);
	assert.match(
		indexSource,
		/const dir = dirname\(WEB_SEARCH_CONFIG_PATH\);\n\tif \(!existsSync\(dir\)\) mkdirSync\(dir, \{ recursive: true \}\);\n\twriteFileSync\(WEB_SEARCH_CONFIG_PATH,/,
	);
	assert.match(
		indexSource,
		/commands\?: Partial<Record<"websearch" \| "curator" \| "web-results" \| "google-account"/,
	);
	assert.match(
		indexSource,
		/if \(isCommandEnabled\(initConfig, "web-results"\)\) pi\.registerCommand\("web-results",/,
	);
	assert.doesNotMatch(
		indexSource,
		/isCommandEnabled\(initConfig, "search"\).*registerCommand\("web-results"/,
	);
	assert.doesNotThrow(() =>
		assertPiWebAccessPatchedSources(patchedSources, "exact fixture"),
	);
	assert.deepEqual(
		patchPiWebAccessSources(patchedSources, "exact fixture second pass"),
		patchedSources,
	);
	const geminiSearchSource = patchedSources.get("gemini-search.ts") ?? "";
	assert.match(indexSource, /maxInlineContentChars\?: unknown;/);
	assert.match(indexSource, /const MAX_INLINE_CONTENT_CHARS = 200_000;/);
	assert.match(indexSource, /bocha: isBochaAvailable\(\),/);
	assert.match(geminiSearchSource, /searchWithBocha\(query, options\)/);
});

test("exact pi-web-access fixture ports the three focused upstream reliability fixes", () => {
	const patchedSources = patchPiWebAccessSources(
		readPiWebAccessFixtureSources(),
		"forward-fix fixture",
	);
	const extractSource = patchedSources.get("extract.ts") ?? "";
	const indexSource = patchedSources.get("index.ts") ?? "";
	const firecrawlSource = patchedSources.get("firecrawl.ts") ?? "";
	const ssrfSource = patchedSources.get("ssrf-protection.ts") ?? "";

	assert.match(extractSource, /sanitizeInlineDataUris/);
	assert.match(extractSource, /options\?\.mode === "raw"/);
	assert.match(indexSource, /spawn\("xdg-open", \[url\], \{ detached: true, stdio: "ignore" \}\)/);
	assert.match(firecrawlSource, /loopbackApiOrigin = isLoopbackApiUrl\(initialUrl\)/);
	assert.match(firecrawlSource, /redirectUrl\.origin === loopbackApiOrigin/);
	assert.match(ssrfSource, /allowLoopback\?: boolean/);
	assert.doesNotMatch(indexSource, /await pi\.exec\("xdg-open"/);
	assert.doesNotMatch(extractSource, /return Promise\.all\(urls\.map/);
});

test("model-aware auto routing matches reviewed pi-web-access 0.28.0 exactly", () => {
	const expected = new Map([
		["gemini-search.ts", "9fd49a6d9aca00dfb9983c658edc9002fc84ad9970726eb8eb91d7bd1396ae08"],
		["index.ts", "afa4d45481b0451ce85fadde6f89a112bc141d714cc164819dd835af320de8a9"],
	]);
	for (const [relativePath, expectedDigest] of expected) {
		const baseline = readFileSync(
			join(PI_WEB_ACCESS_FIXTURE_ROOT, relativePath),
			"utf8",
		);
		const forwarded = patchPiWebAccessForwardFixSource(relativePath, baseline);
		assert.equal(
			createHash("sha256").update(forwarded).digest("hex"),
			expectedDigest,
			relativePath,
		);
		assert.equal(
			patchPiWebAccessForwardFixSource(relativePath, forwarded),
			forwarded,
			`${relativePath} forward port is not idempotent`,
		);
	}
});

test("exact pi-web-access fixture keeps 0.28.0 retrieval and clone protections", () => {
	const patchedSources = patchPiWebAccessSources(
		readPiWebAccessFixtureSources(),
		"0.28.0 fixture",
	);
	const extractSource = patchedSources.get("extract.ts") ?? "";
	const githubSource = patchedSources.get("github-extract.ts") ?? "";
	const openaiSource = patchedSources.get("openai-search.ts") ?? "";
	const pdfSource = patchedSources.get("pdf-extract.ts") ?? "";

	assert.match(extractSource, /OpenAI File Downloader, XaiImageApiFetch\/1\.0/);
	assert.match(githubSource, /function cloneDestination/);
	assert.match(githubSource, /createHash\("sha256"\).*JSON\.stringify/);
	assert.match(
		githubSource,
		/import \{ getProxyProcessEnv, getWebSearchConfigPath \} from "\.\/utils\.ts";/,
	);
	assert.match(
		githubSource,
		/\.\.\.getProxyProcessEnv\("https:\/\/github\.com"\)/,
	);
	assert.match(openaiSource, /openaiSearchProviders/);
	assert.match(openaiSource, /for \(const provider of providers\)/);
	assert.match(pdfSource, /const configuredMaxPages = pdf\.maxPages/);
	assert.match(pdfSource, /\? pdfConfig\.maxPages/);
});

test("runtime readable extraction removes inline data URIs while raw mode preserves the body", () => {
	const extractUrl = pathToFileURL(join(PI_WEB_ACCESS_RUNTIME_ROOT, "extract.ts")).href;
	const child = spawnSync(
		process.execPath,
		["--import", "tsx", "--input-type=module"],
		{
			cwd: join(import.meta.dirname, ".."),
			encoding: "utf8",
			input: `
				const encoded = Buffer.alloc(256 * 1024, 0xa5).toString("base64");
				const body = \`Readable before ![large](data:image/png;base64,\${encoded}) after\`;
				let userAgent = "";
				globalThis.fetch = async (_url, init) => {
					userAgent = init?.headers?.["User-Agent"] ?? "";
					return new Response(body, {
					headers: { "content-type": "text/plain; charset=utf-8" },
					});
				};
				const { fetchAllContent } = await import(${JSON.stringify(extractUrl)});
				const lookup = async () => [{ address: "93.184.216.34", family: 4 }];
				const [readable] = await fetchAllContent(["https://example.com/readable"], undefined, { lookup });
				const [raw] = await fetchAllContent(["https://example.com/raw"], undefined, { mode: "raw", lookup });
				console.log(JSON.stringify({ readable: readable.content, raw: raw.content, body, userAgent }));
			`,
		},
	);
	assert.equal(child.status, 0, child.stderr);
	const output = JSON.parse(child.stdout.trim()) as {
		readable: string;
		raw: string;
		body: string;
		userAgent: string;
	};
	assert.match(output.readable, /Readable before/);
	assert.match(output.readable, /inline data URI omitted/);
	assert.match(output.readable, /retrieval=not-retained/);
	assert.doesNotMatch(output.readable, /data:image\/png;base64/i);
	assert.equal(output.raw, output.body);
	assert.equal(output.userAgent, "OpenAI File Downloader, XaiImageApiFetch/1.0");
});

test("runtime 0.28.0 normalizes PDF limits and honors OpenAI search provider priority", () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-web-0241-config-"));
	const configPath = join(root, "web-search.json");
	writeFileSync(
		configPath,
		JSON.stringify({
			pdf: { maxPages: 7.9 },
			openaiSearchProviders: ["custom-openai", "openai"],
		}),
	);
	const pdfUrl = pathToFileURL(join(PI_WEB_ACCESS_RUNTIME_ROOT, "pdf-extract.ts")).href;
	const openaiUrl = pathToFileURL(join(PI_WEB_ACCESS_RUNTIME_ROOT, "openai-search.ts")).href;
	try {
		const child = spawnSync(
			process.execPath,
			["--import", "tsx", "--input-type=module"],
			{
				cwd: join(import.meta.dirname, ".."),
				encoding: "utf8",
				env: {
					...process.env,
					FEYNMAN_WEB_SEARCH_CONFIG: configPath,
				},
				input: `
					const { loadPDFConfig } = await import(${JSON.stringify(pdfUrl)});
					const { resolveOpenAIAuth } = await import(${JSON.stringify(openaiUrl)});
					const models = [
						{ provider: "openai", id: "gpt-5.9" },
						{ provider: "custom-openai", id: "gpt-5.10" },
					];
					const auth = await resolveOpenAIAuth({
						modelRegistry: {
							getAll: () => models,
							getApiKeyAndHeaders: async (model) => ({
								ok: true,
								apiKey: \`key-\${model.provider}\`,
								headers: {},
							}),
						},
					});
					console.log(JSON.stringify({ pdf: loadPDFConfig(), auth }));
				`,
			},
		);
		assert.equal(child.status, 0, child.stderr);
		const output = JSON.parse(child.stdout.trim()) as {
			pdf: { maxPages: number };
			auth: { provider: string; apiKey: string; model: string };
		};
		assert.equal(output.pdf.maxPages, 7);
		assert.equal(output.auth.provider, "custom-openai");
		assert.equal(output.auth.apiKey, "key-custom-openai");
		assert.equal(output.auth.model, "gpt-5.10");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("runtime 0.28.0 rejects unsafe GitHub clone identities", () => {
	const githubUrl = pathToFileURL(join(PI_WEB_ACCESS_RUNTIME_ROOT, "github-extract.ts")).href;
	const child = spawnSync(
		process.execPath,
		["--import", "tsx", "--input-type=module"],
		{
			cwd: join(import.meta.dirname, ".."),
			encoding: "utf8",
			input: `
				const { parseGitHubUrl } = await import(${JSON.stringify(githubUrl)});
				console.log(JSON.stringify({
					valid: parseGitHubUrl("https://github.com/advaitpaliwal/feynman"),
					doubleDashOwner: parseGitHubUrl("https://github.com/bad--owner/repo"),
					badRepo: parseGitHubUrl("https://github.com/owner/repo%24"),
					badEncoding: parseGitHubUrl("https://github.com/owner/%E0%A4%A"),
				}));
			`,
		},
	);
	assert.equal(child.status, 0, child.stderr);
	const output = JSON.parse(child.stdout.trim()) as {
		valid: { owner: string; repo: string } | null;
		doubleDashOwner: unknown;
		badRepo: unknown;
		badEncoding: unknown;
	};
	assert.deepEqual(output.valid, {
		owner: "advaitpaliwal",
		repo: "feynman",
		refIsFullSha: false,
		type: "root",
	});
	assert.equal(output.doubleDashOwner, null);
	assert.equal(output.badRepo, null);
	assert.equal(output.badEncoding, null);
});

test("runtime Firecrawl loopback exception stays scoped to the configured API", () => {
	const firecrawlUrl = pathToFileURL(join(PI_WEB_ACCESS_RUNTIME_ROOT, "firecrawl.ts")).href;
	const child = spawnSync(
		process.execPath,
		["--import", "tsx", "--input-type=module"],
		{
			cwd: join(import.meta.dirname, ".."),
			encoding: "utf8",
			env: {
				...process.env,
				FIRECRAWL_BASE_URL: "http://127.0.0.1:3002",
				FIRECRAWL_API_KEY: "test-only",
			},
			input: `
				const calls = [];
				globalThis.fetch = async (url) => {
					calls.push(String(url));
					return new Response(JSON.stringify({
						success: true,
						data: { web: [{ title: "Local", url: "https://example.com/local", description: "local" }] },
					}), { status: 200 });
				};
				const { extractWithFirecrawl, searchWithFirecrawl } = await import(${JSON.stringify(firecrawlUrl)});
				const search = await searchWithFirecrawl("local firecrawl");
				let targetError = "";
				try {
					await extractWithFirecrawl("http://127.0.0.1/private");
				} catch (error) {
					targetError = error instanceof Error ? error.message : String(error);
				}
				console.log(JSON.stringify({ calls, search, targetError }));
			`,
		},
	);
	assert.equal(child.status, 0, child.stderr);
	const output = JSON.parse(child.stdout.trim()) as {
		calls: string[];
		search: { results: Array<{ url: string }> };
		targetError: string;
	};
	assert.deepEqual(output.calls, ["http://127.0.0.1:3002/v2/search"]);
	assert.deepEqual(output.search.results.map((result) => result.url), ["https://example.com/local"]);
	assert.match(output.targetError, /Blocked internal address/);
});

test("runtime Firecrawl loopback redirects stay on the configured API origin", () => {
	const firecrawlUrl = pathToFileURL(join(PI_WEB_ACCESS_RUNTIME_ROOT, "firecrawl.ts")).href;
	const child = spawnSync(
		process.execPath,
		["--import", "tsx", "--input-type=module"],
		{
			cwd: join(import.meta.dirname, ".."),
			encoding: "utf8",
			env: {
				...process.env,
				FIRECRAWL_BASE_URL: "http://127.0.0.1:3002",
				FIRECRAWL_API_KEY: "test-only",
			},
			input: `
				const calls = [];
				let scenario = "same-origin";
				globalThis.fetch = async (url) => {
					const value = String(url);
					calls.push(value);
					if (scenario === "same-origin" && value.endsWith("/v2/search")) {
						return new Response(null, {
							status: 302,
							headers: { location: "/v2/search-result" },
						});
					}
					if (scenario === "cross-origin") {
						return new Response(null, {
							status: 302,
							headers: { location: "http://127.0.0.1:3003/private" },
						});
					}
					return new Response(JSON.stringify({
						success: true,
						data: { web: [{ title: "Local", url: "https://example.com/local", description: "local" }] },
					}), { status: 200 });
				};
				const { searchWithFirecrawl } = await import(${JSON.stringify(firecrawlUrl)});
				const search = await searchWithFirecrawl("same origin");
				scenario = "cross-origin";
				let redirectError = "";
				try {
					await searchWithFirecrawl("cross origin");
				} catch (error) {
					redirectError = error instanceof Error ? error.message : String(error);
				}
				console.log(JSON.stringify({ calls, search, redirectError }));
			`,
		},
	);
	assert.equal(child.status, 0, child.stderr);
	const output = JSON.parse(child.stdout.trim()) as {
		calls: string[];
		search: { results: Array<{ url: string }> };
		redirectError: string;
	};
	assert.deepEqual(output.calls, [
		"http://127.0.0.1:3002/v2/search",
		"http://127.0.0.1:3002/v2/search-result",
		"http://127.0.0.1:3002/v2/search",
	]);
	assert.deepEqual(output.search.results.map((result) => result.url), ["https://example.com/local"]);
	assert.match(output.redirectError, /Blocked internal address/);
});

test("patched Linux browser launcher propagates immediate spawn failures", async () => {
	const patchedSources = patchPiWebAccessSources(
		readPiWebAccessFixtureSources(),
		"Linux launcher behavior fixture",
	);
	const indexSource = patchedSources.get("index.ts") ?? "";
	const functionSource = indexSource.match(
		/(async function openInBrowser[\s\S]*?\n})\n\ninterface GlimpseWindow/,
	)?.[1];
	assert.ok(functionSource, "openInBrowser must remain extractable from the reviewed source");

	const tempRoot = mkdtempSync(join(tmpdir(), "feynman-xdg-open-"));
	const modulePath = join(tempRoot, "open-in-browser.ts");
	writeFileSync(
		modulePath,
		[
			'type ExtensionAPI = { exec(name: string, args: string[]): Promise<{ code: number; stderr: string }> };',
			'const platform = () => "linux";',
			"class FakeChild {",
			'\tlisteners = new Map<string, (value: unknown) => void>();',
			'\tonce(event: string, listener: (value: unknown) => void) {',
			"\t\tthis.listeners.set(event, listener);",
			'\t\tif (event === "exit") queueMicrotask(() => this.listeners.get("error")?.(new Error("xdg-open spawn failed")));',
			"\t\treturn this;",
			"\t}",
			"\tunref() {}",
			"}",
			"const spawn = () => new FakeChild();",
			functionSource,
			"export { openInBrowser };",
			"",
		].join("\n"),
		"utf8",
	);

	try {
		const module = await import(`${pathToFileURL(modulePath).href}?test=${Date.now()}`) as {
			openInBrowser: (pi: unknown, url: string) => Promise<void>;
		};
		await assert.rejects(
			module.openInBrowser({}, "https://example.com"),
			/xdg-open spawn failed/,
		);
	} finally {
		rmSync(tempRoot, { recursive: true, force: true });
	}
});

test("patchPiWebAccessSources rejects unreviewed partial config-path patch state", () => {
	const patchedSources = patchPiWebAccessSources(
		readPiWebAccessFixtureSources(),
		"partial patch baseline",
	);
	const patchedIndex = patchedSources.get("index.ts") ?? "";
	for (const partial of [
		{
			label: "current helper directory",
			binding:
				'const WEB_SEARCH_CONFIG_PATH = join(getWebSearchConfigDir(), "web-search.json");',
			directory: "const dir = getWebSearchConfigDir();",
			helperImport:
				'import { formatSeconds, getWebSearchConfigDir, getWebSearchConfigPath, resolveCuratorNetworkConfig } from "./utils.ts";',
		},
		{
			label: "legacy home directory",
			binding:
				'const WEB_SEARCH_CONFIG_PATH = join(homedir(), ".pi", "web-search.json");',
			directory: 'const dir = join(homedir(), ".pi");',
			helperImport:
				'import { formatSeconds, getWebSearchConfigPath, resolveCuratorNetworkConfig } from "./utils.ts";',
		},
		{
			label: "environment expression",
			binding:
				'const WEB_SEARCH_CONFIG_PATH = process.env.FEYNMAN_WEB_SEARCH_CONFIG ?? process.env.PI_WEB_SEARCH_CONFIG ?? join(homedir(), ".pi", "web-search.json");',
			directory: "const dir = getWebSearchConfigDir();",
			helperImport:
				'import { formatSeconds, getWebSearchConfigDir, getWebSearchConfigPath, resolveCuratorNetworkConfig } from "./utils.ts";',
		},
	]) {
		const partialSources = new Map(patchedSources);
		partialSources.set(
			"index.ts",
			patchedIndex
				.replace(
					"const WEB_SEARCH_CONFIG_PATH = getWebSearchConfigPath();",
					partial.binding,
				)
				.replace(
					"const dir = dirname(WEB_SEARCH_CONFIG_PATH);",
					partial.directory,
				)
				.replace(
					'import { formatSeconds, getWebSearchConfigPath, resolveCuratorNetworkConfig } from "./utils.ts";',
					partial.helperImport,
				),
		);

		assert.throws(
			() =>
				patchPiWebAccessSources(
					partialSources,
					`partial patch repair: ${partial.label}`,
				),
			/unreviewed digest/,
			partial.label,
		);
	}
});

test("pi-web-access validator fails closed on config-path drift", () => {
	const patchedSources = patchPiWebAccessSources(
		readPiWebAccessFixtureSources(),
		"validator baseline",
	);
	const stalePathSources = new Map(patchedSources);
	stalePathSources.set(
		"index.ts",
		(stalePathSources.get("index.ts") ?? "").replace(
			"const WEB_SEARCH_CONFIG_PATH = getWebSearchConfigPath();",
			'const WEB_SEARCH_CONFIG_PATH = join(getWebSearchConfigDir(), "web-search.json");',
		),
	);
	assert.throws(
		() =>
			assertPiWebAccessPatchedSources(
				stalePathSources,
				"stale config path",
			),
		/Incomplete pi-web-access 0\.28\.0 stale config path index\.ts/,
	);

	const staleDirectorySources = new Map(patchedSources);
	staleDirectorySources.set(
		"index.ts",
		(staleDirectorySources.get("index.ts") ?? "").replace(
			"const dir = dirname(WEB_SEARCH_CONFIG_PATH);",
			"const dir = getWebSearchConfigDir();",
		),
	);
	assert.throws(
		() =>
			assertPiWebAccessPatchedSources(
				staleDirectorySources,
				"stale config directory",
			),
		/Incomplete pi-web-access 0\.28\.0 stale config directory index\.ts/,
	);
});

test("patchPiWebAccessSource defaults workflow to none for index.ts without disabling explicit summary-review", () => {
	const input = [
		'function resolveWorkflow(input: unknown, hasUI: boolean): WebSearchWorkflow {',
		'\tif (!hasUI) return "none";',
		'\tif (typeof input === "string" && input.trim().toLowerCase() === "none") return "none";',
		'\treturn "summary-review";',
		'}',
		'const configWorkflow = loadConfigForExtensionInit().workflow;',
		'const workflow = resolveWorkflow(params.workflow ?? configWorkflow, ctx?.hasUI !== false);',
		'workflow: Type.Optional(',
		'\tStringEnum(["none", "summary-review"], {',
		'\t\tdescription: "Search workflow mode: none = no curator, summary-review = open curator with auto summary draft (default)",',
		'\t}),',
		'),',
		'Searches auto-open the interactive browser curator and stream results live; set workflow to "none" to skip curation or "auto-summary" for a model-generated summary without the browser curator. Without a configured provider, auto-selects OpenAI, Exa, Gemini API, or Gemini Web. When SearXNG is configured, it is preferred first.',
		"",
	].join("\n");

	const patched = patchPiWebAccessSource("index.ts", input);

	assert.match(patched, /params\.workflow \?\? configWorkflow \?\? "none"/);
	assert.match(patched, /return "summary-review";/);
	assert.match(patched, /summary-review = open curator with auto summary draft \(opt-in\)/);
	assert.match(patched, /or opt-in Gemini Web/);
	assert.match(patched, /Searches return directly by default/);
	assert.match(patched, /set workflow to "summary-review" to open the interactive browser curator/);
});

test("patchPiWebAccessSource disables Gemini Web cookie access by default", () => {
	const input = [
		"interface GeminiWebConfig {",
		"\tchromeProfile?: string;",
		"}",
		"let raw: { chromeProfile?: unknown };",
		"cachedConfig = {",
		"\t\tchromeProfile: normalizeChromeProfile(raw.chromeProfile),",
		"\t};",
		"function normalizeChromeProfile(value: unknown): string | undefined {",
		'\tif (typeof value !== "string") return undefined;',
		"\tconst normalized = value.trim();",
		"\treturn normalized.length > 0 ? normalized : undefined;",
		"}",
		"function getChromeProfileFromConfig(): string | undefined {",
		"\treturn loadConfig().chromeProfile;",
		"}",
		"export async function isGeminiWebAvailable(chromeProfile?: string): Promise<CookieMap | null> {",
		"\tconst result = await getGoogleCookies({",
		"\t\tprofile: normalizeChromeProfile(chromeProfile) ?? getChromeProfileFromConfig(),",
		"\t\trequiredCookies: REQUIRED_COOKIES,",
		"\t});",
		"\tif (!result) return null;",
		"\treturn result.cookies;",
		"}",
		"",
	].join("\n");

	const patched = patchPiWebAccessSource("gemini-web.ts", input);

	assert.match(patched, /geminiBrowser\?: boolean/);
	assert.match(patched, /normalizeBooleanFlag\(raw\.geminiBrowser \?\? raw\.allowBrowserAuth \?\? raw\.browserAuth\)/);
	assert.match(patched, /if \(!config\.geminiBrowser\) return null/);
	assert.doesNotMatch(patched, /getChromeProfileFromConfig\(\)/);
});

test("patchPiWebAccessSource keeps Gemini Web config opt-in across current upstream aliases", () => {
	const input = readFileSync(
		join(PI_WEB_ACCESS_FIXTURE_ROOT, "gemini-web-config.ts"),
		"utf8",
	);

	const patched = patchPiWebAccessSource("gemini-web-config.ts", input);

	assert.match(patched, /geminiBrowser\?: unknown; allowBrowserAuth\?: unknown; browserAuth\?: unknown/);
	assert.match(patched, /function normalizeBooleanFlag/);
	assert.match(patched, /normalizeBooleanFlag\(raw\.allowBrowserCookies\) \|\| normalizeBooleanFlag\(raw\.geminiBrowser\)/);
	assert.match(patched, /return loadConfig\(\)\.allowBrowserCookies === true;/);
});

test("patchPiWebAccessSource changes Gemini search browser fallback messaging to opt-in", () => {
	const input = [
		'throw new Error("Gemini search unavailable. Either:\\n" +',
		'\t"  1. Set GEMINI_API_KEY in ~/.pi/web-search.json\\n" +',
		'\t"  2. Set GOOGLE_GEMINI_BASE_URL + CLOUDFLARE_API_KEY for routing\\n" +',
		'\t"  3. Sign into gemini.google.com in a supported Chromium-based browser"',
		");",
		'throw new Error("No search provider available. Either:\\n" +',
		'\t"  1. Set perplexityApiKey in ~/.pi/web-search.json\\n" +',
		'\t"  5. Sign into gemini.google.com in a supported Chromium-based browser"',
		");",
		"",
	].join("\n");

	const patched = patchPiWebAccessSource("gemini-search.ts", input);

	assert.doesNotMatch(patched, /Sign into gemini\.google\.com/);
	assert.match(patched, /Opt into Gemini Web browser-cookie access/);
	assert.match(patched, /\\"geminiBrowser\\": true/);
});

test("patchPiWebAccessSource is idempotent", () => {
	const input = [
		'import { join } from "node:path";',
		'import { homedir } from "node:os";',
		'const CONFIG_PATH = join(homedir(), ".pi", "web-search.json");',
		"",
	].join("\n");

	const once = patchPiWebAccessSource("perplexity.ts", input);
	const twice = patchPiWebAccessSource("perplexity.ts", once);

	assert.equal(twice, once);
});

test("patchPiWebAccessSource binds nested web model calls to Pi's resolved session scope", async () => {
	const scopeSource = [
		'import { existsSync, readFileSync } from "node:fs";',
		'import { homedir } from "node:os";',
		'import { join } from "node:path";',
		"",
		'const THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh"]);',
		"",
		"interface SummaryModelScopeContext {",
		"\tcwd: string;",
		"\tisProjectTrusted(): boolean;",
		"}",
		"",
		"export interface ModelLike {",
		"\tprovider: string;",
		"\tid: string;",
		"}",
		"",
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
		"",
		"export function summaryModelValue(model: ModelLike): string {",
		"\treturn `${model.provider}/${model.id}`;",
		"}",
	].join("\n");

	const patchedScope = patchPiWebAccessSource("summary-model-scope.ts", scopeSource);
	assert.match(patchedScope, /scopedModels: readonly \{ model: ModelLike \}\[\]/);
	assert.match(patchedScope, /ctx\.scopedModels\.length === 0/);
	assert.match(patchedScope, /ctx\.scopedModels\.map\(\(\{ model \}\) => summaryModelValue\(model\)\)/);
	assert.match(patchedScope, /export function modelMatchesScopedModels/);
	assert.match(patchedScope, /"xhigh", "max"/);
	assert.doesNotMatch(patchedScope, /readSettings|PI_CODING_AGENT_DIR|\.pi.*settings\.json/);
	assert.equal(patchPiWebAccessSource("summary-model-scope.ts", patchedScope), patchedScope);

	const fixtureRoot = mkdtempSync(join(tmpdir(), "feynman-web-model-scope-"));
	const fixturePath = join(fixtureRoot, "summary-model-scope.ts");
	writeFileSync(fixturePath, patchedScope, "utf8");
	try {
		const scopeModule = await import(`${pathToFileURL(fixturePath).href}?v=${Date.now()}`);
		assert.deepEqual(
			scopeModule.loadEnabledModelPatterns({
				scopedModels: [{ model: { provider: "openai", id: "gpt-5.5" } }],
			}),
			["openai/gpt-5.5"],
		);
		assert.equal(scopeModule.loadEnabledModelPatterns({ scopedModels: [] }), null);
		assert.equal(
			scopeModule.modelMatchesScopedModels(
				{ provider: "openai", id: "gpt-5.5" },
				[{ model: { provider: "openai", id: "gpt-5.5" } }],
			),
			true,
		);
		assert.equal(
			scopeModule.modelMatchesScopedModels(
				{ provider: "openai", id: "gpt-5.5" },
				[{ model: { provider: "anthropic", id: "claude-opus-4-7" } }],
			),
			false,
		);
	} finally {
		rmSync(fixtureRoot, { recursive: true, force: true });
	}

	const summaryReviewSource =
		'export type SummaryGenerationContext = Pick<ExtensionContext, "model" | "modelRegistry" | "cwd" | "isProjectTrusted">;';
	const patchedReview = patchPiWebAccessSource("summary-review.ts", summaryReviewSource);
	assert.match(patchedReview, /"modelRegistry" \| "scopedModels" \| "cwd"/);
	assert.equal(patchPiWebAccessSource("summary-review.ts", patchedReview), patchedReview);
});

test("patchPiWebAccessSource uses direct Pi session-scope membership at every nested model call", () => {
	const pageQuerySource = [
		'import { findModelWithProviderRouting, loadEnabledModelPatterns, modelMatchesEnabledPatterns } from "./summary-model-scope.ts";',
		"function resolveModel(ctx, model) {",
		"\tif (!modelMatchesEnabledPatterns(model, loadEnabledModelPatterns(ctx))) throw new Error();",
		"}",
	].join("\n");
	const patchedPageQuery = patchPiWebAccessSource("page-query.ts", pageQuerySource);
	assert.match(patchedPageQuery, /import \{ findModelWithProviderRouting, modelMatchesScopedModels \}/);
	assert.match(patchedPageQuery, /modelMatchesScopedModels\(model, ctx\.scopedModels\)/);
	assert.doesNotMatch(patchedPageQuery, /loadEnabledModelPatterns|modelMatchesEnabledPatterns/);

	const summaryReviewSource = [
		'import { findModelWithProviderRouting, loadEnabledModelPatterns, modelMatchesEnabledPatterns, splitThinkingSuffix, type SummaryThinkingLevel } from "./summary-model-scope.ts";',
		'export type SummaryGenerationContext = Pick<ExtensionContext, "model" | "modelRegistry" | "cwd" | "isProjectTrusted">;',
		"async function resolve(ctx) {",
		"\tconst enabledModelPatterns = loadEnabledModelPatterns(ctx);",
		"\tif (!modelMatchesEnabledPatterns(model, enabledModelPatterns)) throw new Error();",
		"}",
	].join("\n");
	const patchedReview = patchPiWebAccessSource("summary-review.ts", summaryReviewSource);
	assert.match(patchedReview, /modelMatchesScopedModels\(model, ctx\.scopedModels\)/);
	assert.doesNotMatch(patchedReview, /loadEnabledModelPatterns|modelMatchesEnabledPatterns/);
});

test("patchPiWebAccessSource carries Pi scoped models into every nested summary context", () => {
	const input = [
		"const first: SummaryGenerationContext = {",
		"\tmodel: ctx.model,",
		"\tmodelRegistry: ctx.modelRegistry,",
		"\tcwd: ctx.cwd,",
		"\tisProjectTrusted: () => ctx.isProjectTrusted(),",
		"};",
		"const second: SummaryGenerationContext = {",
		"\t\tmodel: ctx.model,",
		"\t\tmodelRegistry: ctx.modelRegistry,",
		"\t\tcwd: ctx.cwd,",
		"\t\tisProjectTrusted: () => ctx.isProjectTrusted(),",
		"};",
	].join("\n");

	const patched = patchPiWebAccessSource("index.ts", input);
	assert.equal(patched.match(/get scopedModels\(\) \{ return ctx\.scopedModels; \}/g)?.length, 2);
	assert.doesNotMatch(patched, /scopedModels: ctx\.scopedModels/);
	assert.equal(patchPiWebAccessSource("index.ts", patched), patched);

	const runnable = patchPiWebAccessSource("index.ts", [
		"const summaryContext = {",
		"\tmodelRegistry: ctx.modelRegistry,",
		"\tcwd: ctx.cwd,",
		"};",
		"return summaryContext;",
	].join("\n"));
	const firstScope = [{ model: { provider: "openai", id: "gpt-5.5" } }];
	const secondScope = [{ model: { provider: "anthropic", id: "claude-haiku-4-5" } }];
	const ctx = { modelRegistry: {}, cwd: "/tmp", scopedModels: firstScope };
	const summaryContext = Function("ctx", runnable)(ctx);
	assert.equal(summaryContext.scopedModels, firstScope);
	ctx.scopedModels = secondScope;
	assert.equal(summaryContext.scopedModels, secondScope);
});

test("pi-web-access patch is exact-version gated and rejects unknown model-scope layouts", () => {
	assert.equal(PI_WEB_ACCESS_REQUIRED_VERSION, "0.28.0");
	assert.doesNotThrow(() => assertPiWebAccessVersion("0.28.0", "test"));
	assert.throws(
		() => assertPiWebAccessVersion("0.29.0", "future"),
		/expected 0\.28\.0, found 0\.29\.0/,
	);

	const futureSource = [
		'import { existsSync, readFileSync } from "node:fs";',
		'import { homedir } from "node:os";',
		'import { join } from "node:path";',
		'const THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh"]);',
		"interface SummaryModelScopeContext {",
		"\tcwd: string;",
		"\tisProjectTrusted(): boolean;",
		"}",
		"function getAgentDir(): string {",
		'\treturn process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");',
		"}",
		"function futureScopeHelper(): string { return \"preserve-me\"; }",
		"export function loadEnabledModelPatterns(): string[] | null { return null; }",
	].join("\n");
	assert.throws(
		() => patchPiWebAccessSource("summary-model-scope.ts", futureSource),
		/Unsupported pi-web-access 0\.28\.0 summary model scope layout/,
	);
	assert.match(futureSource, /futureScopeHelper/);
});

test("patchPiWebAccessSource bounds web_search query calls with a deadline in index.ts", () => {
	const input = [
		"const DEFAULT_MAX_INLINE_CONTENT_CHARS = 30_000;",
		"",
		"async function run() {",
		"\t\t\t\t\tconst response = await search(queryList[qi], {",
		"\t\t\t\t\t\tprovider: requestedProvider,",
		"\t\t\t\t\t});",
		"\t\t\t\tconst { answer, results, inlineContent, provider } = await search(query, {",
		"\t\t\t\t\tprovider: resolvedProvider,",
		"\t\t\t\t});",
		"}",
		"",
	].join("\n");

	const patched = patchPiWebAccessSource("index.ts", input);

	assert.match(patched, /const SEARCH_CALL_TIMEOUT_MS = 90000;/);
	assert.match(patched, /async function searchWithDeadline\(/);
	assert.match(patched, /const response = await searchWithDeadline\(queryList\[qi\], \{/);
	assert.match(patched, /await searchWithDeadline\(query, \{/);
	assert.doesNotMatch(patched, /await search\(/);

	const twice = patchPiWebAccessSource("index.ts", patched);
	assert.equal(twice, patched);
});

test("patchPiWebAccessSource keeps current fetched PDF scratch files inside the project", () => {
	const source = [
		'import { join, basename } from "node:path";',
		'import { tmpdir } from "node:os";',
		'const DEFAULT_OUTPUT_DIR = join(tmpdir(), "pi-web-pdf");',
	].join("\n");

	const patched = patchPiWebAccessSource("pdf-extract.ts", source);

	assert.match(patched, /FEYNMAN_FETCH_CACHE_DIR/);
	assert.match(patched, /process\.cwd\(\).*\.feynman.*cache.*fetch-content/);
	assert.doesNotMatch(patched, /tmpdir|pi-web-pdf/);
	assert.equal(patchPiWebAccessSource("pdf-extract.ts", patched), patched);
});
