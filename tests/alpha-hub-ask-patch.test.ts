import test from "node:test";
import assert from "node:assert/strict";

import { patchAlphaHubAskSource } from "../scripts/lib/alpha-hub-ask-patch.mjs";

const LEGACY_SOURCE = [
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
].join("\n");

test("patchAlphaHubAskSource sends paper and queries to answer_pdf_queries", () => {
	const patched = patchAlphaHubAskSource(LEGACY_SOURCE);

	assert.match(patched, /callTool\('answer_pdf_queries', \{ paper: url, queries: \[query\] \}\)/);
	assert.doesNotMatch(patched, /callTool\('answer_pdf_queries', \{ urls: \[url\], queries: \[query\] \}\)/);
	assert.match(patched, /callTool\('answer_pdf_queries', \{ url, query \}\)/);
});

test("patchAlphaHubAskSource is idempotent", () => {
	const once = patchAlphaHubAskSource(LEGACY_SOURCE);
	const twice = patchAlphaHubAskSource(once);
	assert.equal(twice, once);
});
