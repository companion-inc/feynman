import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { registerScienceDatabaseTools } from "../extensions/research-tools/science-databases.js";
import { resetNcbiRateLimitForTests, withNcbiRateLimit } from "../extensions/research-tools/ncbi-rate-limit.js";
import { setRequestTimeoutForTests } from "../extensions/research-tools/science-database-pubmed.js";

type Tool = {
	execute: (toolCallId: string, params: Record<string, unknown>) => Promise<{ content: Array<{ text: string }>; details: unknown }>;
	name: string;
};

const originalFetch = globalThis.fetch;
const originalApiKey = process.env.NCBI_API_KEY;

afterEach(() => {
	globalThis.fetch = originalFetch;
	if (originalApiKey === undefined) delete process.env.NCBI_API_KEY;
	else process.env.NCBI_API_KEY = originalApiKey;
	resetNcbiRateLimitForTests();
	setRequestTimeoutForTests(0);
});

function registerTools(): Map<string, Tool> {
	const tools = new Map<string, Tool>();
	registerScienceDatabaseTools({
		registerTool(tool: Tool) {
			tools.set(tool.name, tool);
		},
	} as never);
	return tools;
}

function jsonResponse(body: unknown): Response {
	return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

const esearch = () => jsonResponse({ esearchresult: { count: "1", idlist: ["35486828"] } });
const esummary = () => jsonResponse({
	result: { "35486828": { title: "Example.", fulljournalname: "Nature", pubdate: "2022", authors: [{ name: "Doudna J" }], articleids: [] } },
});

/** Start `count` gated requests at once and return the gap between consecutive starts. */
async function measureGaps(url: URL, count: number, blockMs = 0): Promise<number[]> {
	resetNcbiRateLimitForTests();
	const starts: number[] = [];
	const all = Array.from({ length: count }, () =>
		withNcbiRateLimit(url, async () => { starts.push(performance.now()); }));
	if (blockMs > 0) {
		const until = Date.now() + blockMs;
		while (Date.now() < until) { /* wedge the event loop */ }
	}
	await Promise.all(all);
	return starts.slice(1).map((value, i) => value - starts[i]!);
}

const KEYED = new URL("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&api_key=k");
const ANON = new URL("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed");
const IDCONV = new URL("https://pmc.ncbi.nlm.nih.gov/tools/idconv/api/v1/articles/?ids=1");
const EUROPE_PMC = new URL("https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=x");

test("keyed NCBI requests are spaced at the keyed rate", async () => {
	const gaps = await measureGaps(KEYED, 4);
	for (const gap of gaps) assert.ok(gap >= 120, `expected >=120ms spacing, saw ${gap.toFixed(0)}ms`);
});

test("unkeyed NCBI requests are spaced at the wider anonymous rate", async () => {
	const gaps = await measureGaps(ANON, 3);
	for (const gap of gaps) assert.ok(gap >= 480, `expected >=480ms spacing, saw ${gap.toFixed(0)}ms`);
});

test("the PMC ID Converter host is rate limited too", async () => {
	const gaps = await measureGaps(IDCONV, 3);
	for (const gap of gaps) assert.ok(gap >= 480, `ID Converter was not gated, saw ${gap.toFixed(0)}ms`);
});

test("spacing survives a blocked event loop", async () => {
	// Reserving absolute wake times upfront passes every other test here and
	// still collapses into a single burst once one tick runs long.
	const gaps = await measureGaps(KEYED, 5, 600);
	for (const gap of gaps) assert.ok(gap >= 120, `burst collapsed after a stall, saw ${gap.toFixed(0)}ms`);
});

test("non-NCBI hosts are not delayed by the NCBI budget", async () => {
	resetNcbiRateLimitForTests();
	const started: number[] = [];
	await Promise.all(Array.from({ length: 5 }, () =>
		withNcbiRateLimit(EUROPE_PMC, async () => { started.push(performance.now()); })));
	assert.equal(started.length, 5);
	const span = Math.max(...started) - Math.min(...started);
	assert.ok(span < 80, `Europe PMC was serialized by the NCBI gate (${span.toFixed(0)}ms span)`);
});

test("a failed request does not stall the queue", async () => {
	resetNcbiRateLimitForTests();
	await assert.rejects(withNcbiRateLimit(KEYED, async () => { throw new Error("boom"); }), /boom/);
	assert.equal(await withNcbiRateLimit(KEYED, async () => "recovered"), "recovered");
});

test("PubMed search sends NCBI_API_KEY and keeps it out of reported endpoints", async () => {
	process.env.NCBI_API_KEY = "test-ncbi-key";
	const requests: string[] = [];
	globalThis.fetch = async (input) => {
		const url = String(input instanceof Request ? input.url : input);
		requests.push(url);
		if (url.includes("/esearch.fcgi")) return esearch();
		if (url.includes("/esummary.fcgi")) return esummary();
		throw new Error(`unexpected URL ${url}`);
	};

	const tool = registerTools().get("feynman_science_database_search");
	assert.ok(tool);
	const result = await tool.execute("k", { source: "pubmed", query: "crispr", limit: 1 });

	assert.equal(requests.length, 2, "expected esearch then esummary");
	for (const url of requests) assert.equal(new URL(url).searchParams.get("api_key"), "test-ncbi-key");
	const endpoints = (result.details as { provenance: { endpoints: string[] } }).provenance.endpoints;
	assert.ok(endpoints.length > 0, "expected reported endpoints");
	for (const endpoint of endpoints) {
		assert.ok(!endpoint.includes("test-ncbi-key"), `endpoint leaks the key: ${endpoint}`);
		assert.match(endpoint, /api_key=%5Bredacted%5D/);
	}
});

test("the PMC ID Converter is never sent the NCBI API key", async () => {
	process.env.NCBI_API_KEY = "test-ncbi-key";
	const requests: string[] = [];
	globalThis.fetch = async (input) => {
		const url = String(input instanceof Request ? input.url : input);
		requests.push(url);
		if (url.includes("idconv")) {
			return jsonResponse({ status: "ok", records: [{ "requested-id": "35486828", pmid: "35486828", pmcid: "PMC9046468" }] });
		}
		throw new Error(`unexpected URL ${url}`);
	};

	const tool = registerTools().get("feynman_science_database_search");
	assert.ok(tool);
	await tool.execute("c", { source: "pubmed", query: "convert:35486828", limit: 1 });

	const idconv = requests.find((url) => url.includes("idconv"));
	assert.ok(idconv, "expected an ID Converter request");
	assert.equal(new URL(idconv).searchParams.get("api_key"), null);
});

test("the request timeout covers the response body, not just the headers", async () => {
	// fetch resolves once headers arrive. Clearing the abort timer at that point
	// leaves a stalled body hanging forever, which is the regression this covers.
	setRequestTimeoutForTests(300);
	globalThis.fetch = async (_input, init) => {
		const signal = (init as RequestInit | undefined)?.signal;
		assert.ok(signal, "expected an abort signal on the request");
		const stalled = new ReadableStream({
			start(controller) {
				signal.addEventListener("abort", () => controller.error(new Error("aborted")));
			},
		});
		return new Response(stalled, { status: 200, headers: { "content-type": "application/json" } });
	};

	const tool = registerTools().get("feynman_science_database_search");
	assert.ok(tool);
	// Race a deadline so a regression fails the case instead of wedging the run.
	const outcome = await Promise.race([
		tool.execute("t", { source: "pubmed", query: "crispr", limit: 1 }).then(() => "resolved", () => "aborted"),
		new Promise((resolve) => setTimeout(() => resolve("hung"), 3_000)),
	]);
	assert.equal(outcome, "aborted", "the stalled body was never aborted within the request budget");
});

test("every NCBI module shares one queue, not just PubMed", async () => {
	// The budget is per-IP, so gating PubMed alone leaves a mixed turn over the
	// ceiling: ClinVar and GEO hit the same host from their own modules.
	process.env.NCBI_API_KEY = "test-ncbi-key";
	resetNcbiRateLimitForTests();
	const eutilsStarts: number[] = [];
	globalThis.fetch = async (input) => {
		const url = String(input instanceof Request ? input.url : input);
		if (url.includes("eutils.ncbi.nlm.nih.gov")) eutilsStarts.push(performance.now());
		if (url.includes("/esearch.fcgi")) return esearch();
		if (url.includes("/esummary.fcgi")) return esummary();
		return jsonResponse({ esearchresult: { count: "0", idlist: [] }, result: {}, header: {} });
	};

	const tool = registerTools().get("feynman_science_database_search");
	assert.ok(tool);
	await Promise.allSettled([
		tool.execute("p1", { source: "pubmed", query: "crispr", limit: 1 }),
		tool.execute("c1", { source: "clinvar", query: "APOE rs7412", limit: 1 }),
		tool.execute("c2", { source: "clinvar", query: "TP53 variant", limit: 1 }),
	]);

	assert.ok(eutilsStarts.length >= 3, `expected several E-utilities requests, saw ${eutilsStarts.length}`);
	const ordered = [...eutilsStarts].sort((a, b) => a - b);
	for (let i = 1; i < ordered.length; i += 1) {
		const gap = ordered[i]! - ordered[i - 1]!;
		assert.ok(gap >= 100, `an ungated module bypassed the queue (${gap.toFixed(0)}ms gap)`);
	}
});
