import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { ALPHA_HUB_SEARCH_014_SOURCE_CONTRACT, ALPHA_HUB_RESULTS_014_SOURCE_CONTRACT, assertAlphaHubSearchSource, assertAlphaHubSearchResultsSource, patchAlphaHubSearchResultsSource, patchAlphaHubSearchSource } from "../scripts/lib/alpha-hub-search-patch.mjs";

const SOURCE = `
function getErrorMessage(err) {
  return err instanceof Error ? err.message : String(err);
}

async function callTool(name, args) {
  return { name, args };
}

export async function searchByEmbedding(query) {
  return await callTool('embedding_similarity_search', { query });
}

export async function searchByKeyword(query) {
  return await callTool('full_text_papers_search', { query });
}

export async function agenticSearch(query) {
  return await callTool('agentic_paper_retrieval', { query });
}

export async function answerPdfQuery(url, query) {
  try {
    return await callTool('answer_pdf_queries', { urls: [url], queries: [query] });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('Input validation error') || message.includes('Invalid arguments')) {
      return await callTool('answer_pdf_queries', { url, query });
    }
    throw err;
  }
}
`;

test("patchAlphaHubSearchSource falls back to discover_papers for removed alphaXiv search tools", () => {
	const patched = patchAlphaHubSearchSource(SOURCE);

	assert.match(patched, /function shouldFallbackToDiscoverPapers/);
	assert.match(patched, /function shouldFallbackToSearchFallback/);
	assert.match(patched, /callTool\('discover_papers', args\)/);
	assert.match(patched, /const ALPHAXIV_REST_SEARCH_URL = 'https:\/\/api\.alphaxiv\.org\/search\/v2\/paper\/fast'/);
	assert.match(patched, /url\.searchParams\.set\('q', query\)/);
	assert.match(patched, /url\.searchParams\.set\('includePrivate', 'false'\)/);
	assert.match(patched, /return await searchRestFast\(query\)/);
	assert.match(patched, /question: query/);
	assert.match(patched, /keywords: query/);
	assert.match(patched, /difficulty: mode === 'keyword' \? 'easy' : 'graduate'/);
	assert.match(patched, /Tool embedding_similarity_search not found/);
	assert.match(patched, /return await callTool\('embedding_similarity_search', \{ query \}\)/);
	assert.match(patched, /return await fallbackSearch\(query, 'semantic', err\)/);
	assert.match(patched, /return await fallbackSearch\(query, 'keyword', err\)/);
	assert.match(patched, /return await fallbackSearch\(query, 'agentic', err\)/);
	assert.match(
		patched,
		/return await callTool\('answer_pdf_queries', \{ paper: url, queries: \[query\] \}\)/,
	);
	assert.doesNotMatch(patched, /\{ urls: \[url\], queries: \[query\] \}/);
	assert.doesNotMatch(patched, /\{ url, query \}/);
});

test("patchAlphaHubSearchSource is idempotent", () => {
	const once = patchAlphaHubSearchSource(SOURCE);
	const twice = patchAlphaHubSearchSource(once);
	assert.equal(twice, once);
});

test("patchAlphaHubSearchSource upgrades the discover_papers-only fallback", () => {
	const discoverOnly = patchAlphaHubSearchSource(SOURCE).replace(
		/const ALPHAXIV_REST_SEARCH_URL[\s\S]*?\nasync function callTool\(name, args\) \{/,
		"async function callTool(name, args) {",
	).replaceAll("return await fallbackSearch(query, 'semantic', err);", "if (shouldFallbackToDiscoverPapers(err)) return await discoverPapers(query, 'semantic');\n    throw err;")
		.replaceAll("return await fallbackSearch(query, 'keyword', err);", "if (shouldFallbackToDiscoverPapers(err)) return await discoverPapers(query, 'keyword');\n    throw err;")
		.replaceAll("return await fallbackSearch(query, 'agentic', err);", "if (shouldFallbackToDiscoverPapers(err)) return await discoverPapers(query, 'agentic');\n    throw err;");

	const upgraded = patchAlphaHubSearchSource(discoverOnly);

	assert.match(upgraded, /async function searchRestFast/);
	assert.match(upgraded, /return await fallbackSearch\(query, 'semantic', err\)/);
	assert.match(upgraded, /return await fallbackSearch\(query, 'keyword', err\)/);
	assert.match(upgraded, /return await fallbackSearch\(query, 'agentic', err\)/);
});

test("patchAlphaHubSearchSource sends the current alphaXiv paper Q&A schema", async () => {
	const patched = patchAlphaHubSearchSource(SOURCE);
	const moduleUrl = `data:text/javascript;base64,${Buffer.from(patched).toString("base64")}`;
	const { answerPdfQuery } = await import(moduleUrl);

	assert.deepEqual(
		await answerPdfQuery("https://arxiv.org/abs/2401.12345", "What optimizer did they use?"),
		{
			name: "answer_pdf_queries",
			args: {
				paper: "https://arxiv.org/abs/2401.12345",
				queries: ["What optimizer did they use?"],
			},
		},
	);
});

test("patchAlphaHubSearchSource repairs Q&A after the search fallback was already patched", () => {
	const searchPatched = patchAlphaHubSearchSource(SOURCE).replace(
		[
			"export async function answerPdfQuery(url, query) {",
			"  return await callTool('answer_pdf_queries', { paper: url, queries: [query] });",
			"}",
		].join("\n"),
		[
			"export async function answerPdfQuery(url, query) {",
			"  try {",
			"    return await callTool('answer_pdf_queries', { urls: [url], queries: [query] });",
			"  } catch (err) {",
			"    const message = err instanceof Error ? err.message : String(err);",
			"    if (message.includes('Input validation error') || message.includes('Invalid arguments')) {",
			"      return await callTool('answer_pdf_queries', { url, query });",
			"    }",
			"    throw err;",
			"  }",
			"}",
		].join("\n"),
	);

	const repaired = patchAlphaHubSearchSource(searchPatched);
	assert.match(
		repaired,
		/return await callTool\('answer_pdf_queries', \{ paper: url, queries: \[query\] \}\)/,
	);
	assert.equal(repaired.includes("async function searchRestFast("), true);
});

test("patchAlphaHubSearchSource fails closed on unknown Q&A layouts", () => {
	assert.throws(
		() =>
			patchAlphaHubSearchSource(
				SOURCE.replace(
					"return await callTool('answer_pdf_queries', { urls: [url], queries: [query] });",
					"return await callTool('answer_pdf_queries', { document: url, questions: [query] });",
				),
			),
		/Unsupported alpha-hub answerPdfQuery layout/,
	);
});

test("patchAlphaHubSearchResultsSource parses structured JSON search payloads", async () => {
	const input = [
		"function cleanSearchField(value) {",
		"  return typeof value === 'string' && value.trim() ? value.trim() : null;",
		"}",
		"",
		"export function parsePaperSearchResults(text, options = {}) {",
		"  const includeRaw = options.includeRaw === true;",
		"  if (typeof text !== 'string') {",
		"    return { results: [] };",
		"  }",
		"  return includeRaw ? { raw: text, results: [] } : { results: [] };",
		"}",
		"",
	].join("\n");

	const patched = patchAlphaHubSearchResultsSource(input);

	assert.match(patched, /function parseStructuredSearchResults\(/);
	assert.match(patched, /parseStructuredSearchResults\(text, includeRaw\) \?\? \{ results: \[\] \}/);

	const moduleUrl = `data:text/javascript;base64,${Buffer.from(patched).toString("base64")}`;
	const { parsePaperSearchResults } = await import(moduleUrl);

	const structured = parsePaperSearchResults([
		{ link: "/abs/1706.03762", paperId: "1706.03762", title: "Attention Is All You Need", snippet: "We propose the Transformer." },
		{ link: "/abs/2502.19214", title: "A Hybrid Transformer Architecture", snippet: "Quantized self-attention." },
	]);
	assert.equal(structured.results.length, 2);
	assert.equal(structured.results[0].arxivId, "1706.03762");
	assert.equal(structured.results[0].arxivUrl, "https://arxiv.org/abs/1706.03762");
	assert.equal(structured.results[0].alphaXivUrl, "https://www.alphaxiv.org/overview/1706.03762");
	assert.equal(structured.results[0].abstract, "We propose the Transformer.");
	assert.equal(structured.results[1].arxivId, "2502.19214");

	const wrapped = parsePaperSearchResults({ results: [{ paperId: "2401.00001", title: "Wrapped", snippet: "s" }] });
	assert.equal(wrapped.results.length, 1);
	assert.equal(wrapped.results[0].arxivId, "2401.00001");

	assert.deepEqual(parsePaperSearchResults({ unexpected: true }), { results: [] });
	assert.deepEqual(parsePaperSearchResults(null), { results: [] });

	const twice = patchAlphaHubSearchResultsSource(patched);
	assert.equal(twice, patched);
});

test("runtime rebuilds and package verification preserve the structured alphaXiv parser", () => {
	const runtimeWorkspaceSource = readFileSync("scripts/prepare-runtime-workspace.mjs", "utf8");
	const packageVerifierSource = readFileSync("scripts/verify-package-artifact.mjs", "utf8");

	assert.match(
		runtimeWorkspaceSource,
		/import \{\s*patchAlphaHubSearchResultsSource,\s*patchAlphaHubSearchSource,\s*\} from "\.\/lib\/alpha-hub-search-patch\.mjs"/,
	);
	assert.match(
		runtimeWorkspaceSource,
		/\["index\.js", patchAlphaHubSearchResultsSource\]/,
	);
	assert.match(
		packageVerifierSource,
		/\["index\.js", assertAlphaHubSearchResultsSource\]/,
	);
	assert.match(packageVerifierSource, /`npm\/node_modules\/@advaitpaliwal\/alpha-hub\/src\/lib\/\$\{fileName\}`/);
});

// Exact source fixtures from the integrity-verified @advaitpaliwal/alpha-hub@0.1.4 tarball.
// Published gitHead: 9ec42ba0d499284552220315247b3f2a811e6607. Gzip keeps tests self-contained.
const PERSONAL_SEARCH = gunzipSync(Buffer.from(
	"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",
	"base64",
)).toString("utf8");
const PERSONAL_RESULTS = gunzipSync(Buffer.from(
	"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" +
	"noEIhmnzBxftDXTs/BeFl+CmHiQAAA==",
	"base64",
)).toString("utf8");

test("personal source hashes preserve the reviewed discovery/Q&A and exact parser", () => {
	assert.equal(createHash("sha256").update(PERSONAL_SEARCH).digest("hex"), ALPHA_HUB_SEARCH_014_SOURCE_CONTRACT.upstreamSha256);
	assert.equal(createHash("sha256").update(PERSONAL_RESULTS).digest("hex"), ALPHA_HUB_RESULTS_014_SOURCE_CONTRACT.upstreamSha256);
	const patched = patchAlphaHubSearchSource(PERSONAL_SEARCH, { version: "0.1.4" });
	assertAlphaHubSearchSource(patched);
	assert.equal(patchAlphaHubSearchSource(patched, { version: "0.1.4" }), patched);
	assert.equal(patchAlphaHubSearchResultsSource(PERSONAL_RESULTS, { version: "0.1.4" }), PERSONAL_RESULTS);
	assertAlphaHubSearchResultsSource(PERSONAL_RESULTS);
	assert.match(patched, /keywords: text\.split/);
	assert.match(patched, /discoverPapers\(query, 3\)/);
	assert.doesNotMatch(patched, /callTool\('(?:embedding_similarity_search|full_text_papers_search|agentic_paper_retrieval)'/);
	assert.doesNotMatch(patched, /difficulty:.*easy|return await fallbackSearch/);
});

test("personal source guards reject mutation even when old marker strings remain", () => {
	for (const source of [PERSONAL_SEARCH, patchAlphaHubSearchSource(PERSONAL_SEARCH)]) {
		for (const changed of [source + "\n", source.replace("keywords: text.split", "keywords: String"), source.replace("paper: url", "url: url")]) {
			assert.throws(() => patchAlphaHubSearchSource(changed, { version: "0.1.4" }), /Unsupported/);
			assert.throws(() => patchAlphaHubSearchSource(changed), /Unsupported/);
			assert.throws(() => assertAlphaHubSearchSource(changed), /Unsupported/);
		}
	}
	for (const changed of [PERSONAL_RESULTS + "\n", PERSONAL_RESULTS.replace("authors: null", "authors: 'invented'")]) {
		assert.throws(() => patchAlphaHubSearchResultsSource(changed, { version: "0.1.4" }), /Unsupported/);
		assert.throws(() => patchAlphaHubSearchResultsSource(changed), /Unsupported/);
	}
	assert.throws(() => patchAlphaHubSearchSource(PERSONAL_SEARCH, { version: "0.1.5" }), /Unsupported/);
	assert.throws(() => patchAlphaHubSearchResultsSource(PERSONAL_RESULTS, { version: "0.1.5" }), /Unsupported/);
	assert.throws(() => patchAlphaHubSearchSource("", { version: "0.1.4" }), /Unsupported/);
	assert.throws(() => patchAlphaHubSearchResultsSource("", { version: "0.1.4" }), /Unsupported/);
});

function executePersonalSearch(failure?: string, restOk = true) {
	const calls: { name: string; arguments: Record<string, unknown> }[] = [];
	const requests: { url: string; authorization: string }[] = [];
	const source = patchAlphaHubSearchSource(PERSONAL_SEARCH).replace(/^import .*;\n/gm, "").replaceAll("export async function", "async function");
	class MockClient {
		async connect() {}
		async close() {}
		async callTool(call: { name: string; arguments: Record<string, unknown> }) {
			calls.push(call);
			if (failure) throw new Error(failure);
			return { content: [{ text: JSON.stringify({ accepted: true }) }] };
		}
	}
	const lib = new Function("Client", "StreamableHTTPClientTransport", "getValidToken", "refreshAccessToken", "fetch", "process", `${source}\nreturn { searchByEmbedding, searchByKeyword, agenticSearch, searchAll, answerPdfQuery };`)(
		MockClient, class {}, async () => "test-token", async () => null,
		async (url: URL, options: { headers: { Authorization: string } }) => {
			requests.push({ url: String(url), authorization: options.headers.Authorization });
			return { ok: restOk, status: 503, statusText: "Unavailable", text: async () => "Unavailable", json: async () => [{ paperId: "2401.00001", title: "Mock REST" }] };
		}, { stderr: { write() {} } },
	);
	return { lib, calls, requests };
}

test("personal discovery executes numeric/array payloads and keeps Q&A unchanged", async () => {
	const { lib, calls, requests } = executePersonalSearch();
	await lib.searchByEmbedding(" graph networks ");
	await lib.searchByKeyword("graph networks");
	await lib.agenticSearch("graph networks");
	assert.deepEqual(calls.map((c) => c.arguments), [1, 1, 3].map((difficulty) => ({ keywords: ["graph", "networks"], question: "graph networks", difficulty })));
	assert.ok(calls.every((c) => c.name === "discover_papers"));
	await lib.answerPdfQuery("https://arxiv.org/abs/2401.00001", "What evidence?");
	assert.deepEqual(calls.at(-1), { name: "answer_pdf_queries", arguments: { paper: "https://arxiv.org/abs/2401.00001", queries: ["What evidence?"] } });
	const all = await lib.searchAll("graph");
	assert.deepEqual(Object.keys(all), ["semantic", "keyword", "agentic"]);
	assert.equal(calls.length, 6);
	assert.equal(requests.length, 0);
	await assert.rejects(lib.searchByEmbedding(" "), /must not be empty/);
	assert.equal(requests.length, 0);
});

test("personal REST fallback is retained only for an explicitly absent discovery tool", async () => {
	const { lib, calls, requests } = executePersonalSearch("MCP error -32602: Tool discover_papers not found");
	assert.deepEqual(await lib.searchByKeyword(" graph networks "), [{ paperId: "2401.00001", title: "Mock REST" }]);
	assert.equal(calls.length, 1);
	assert.equal(requests.length, 1);
	const url = new URL(requests[0].url);
	assert.equal(url.origin + url.pathname, "https://api.alphaxiv.org/search/v2/paper/fast");
	assert.equal(url.searchParams.get("q"), "graph networks");
	assert.equal(url.searchParams.get("includePrivate"), "false");
	assert.equal(requests[0].authorization, "Bearer test-token");
	const failing = executePersonalSearch("Tool discover_papers not found", false);
	await assert.rejects(failing.lib.searchByKeyword("graph"), /REST search failed \(503\)/);
	for (const message of ["MCP error -32602: Invalid arguments", "403 Forbidden", "401 Unauthorized", "Timeout", "Tool different_tool not found"]) {
		const other = executePersonalSearch(message);
		await assert.rejects(other.lib.searchByKeyword("graph"));
		assert.equal(other.requests.length, 0, message);
	}
});

test("personal parser no-op executes live-format, legacy and structured compatibility", async () => {
	const source = patchAlphaHubSearchResultsSource(PERSONAL_RESULTS);
	const parser = source.slice(source.indexOf("function parseMetricNumber("), source.indexOf("function normalizeSearchPayload("));
	const { parsePaperSearchResults } = await import(`data:text/javascript;base64,${Buffer.from(parser).toString("base64")}`);
	const text = "1. [ID=2401.00001] **Synthetic Paper** (https://www.alphaxiv.org/abs/2401.00001). Published 2024-01-01 by Example Lab · 3 votes · 17 views: Synthetic abstract.\n2. [ID=2401.00002] **No Groups**. Published 2024-01-02 · 0 votes · 2 views: Another abstract.";
	const { results } = parsePaperSearchResults(text);
	assert.equal(results.length, 2);
	assert.deepEqual([results[0].arxivId, results[0].title, results[0].organizations, results[0].likes, results[0].visits], ["2401.00001", "Synthetic Paper", "Example Lab", 3, 17]);
	assert.equal(results[1].organizations, null);
	assert.equal(results[1].authors, null);
	assert.equal(results[1].likes, 0);
	for (const payload of [[{ paperId: "2401.00003", title: "Structured" }], { data: [{ paperId: "2401.00003", title: "Structured" }] }]) {
		assert.equal(parsePaperSearchResults(payload).results[0].arxivId, "2401.00003");
	}
	assert.equal(parsePaperSearchResults("1. **Legacy** (2 Visits, 1 Likes, Published on 2024-01-01)\n- arXiv Id: 2401.00004").results[0].arxivId, "2401.00004");
});
