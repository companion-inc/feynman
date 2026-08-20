import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { registerScienceDatabaseTools } from "../extensions/research-tools/science-databases.js";
import { withNcbiRateLimit } from "../extensions/research-tools/ncbi-rate-limit.js";

type Tool = {
	execute: (toolCallId: string, params: Record<string, unknown>) => Promise<{ content: Array<{ text: string }>; details: unknown }>;
	name: string;
};

const originalFetch = globalThis.fetch;
const originalNcbiEmail = process.env.NCBI_EMAIL;
const originalNcbiApiKey = process.env.NCBI_API_KEY;

afterEach(() => {
	globalThis.fetch = originalFetch;
	if (originalNcbiEmail === undefined) delete process.env.NCBI_EMAIL;
	else process.env.NCBI_EMAIL = originalNcbiEmail;
	if (originalNcbiApiKey === undefined) delete process.env.NCBI_API_KEY;
	else process.env.NCBI_API_KEY = originalNcbiApiKey;
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
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { "content-type": "application/json" },
	});
}

function esearchResponse(): Response {
	return jsonResponse({
		esearchresult: {
			count: "1",
			idlist: ["35486828"],
			querytranslation: "crispr[All Fields]",
		},
	});
}

function esummaryResponse(): Response {
	return jsonResponse({
		result: {
			"35486828": {
				title: "Programmable gene editing example.",
				fulljournalname: "Nature",
				pubdate: "2022 Apr 14",
				authors: [{ name: "Doudna J" }],
				articleids: [{ idtype: "doi", value: "10.1038/example" }],
				pubtype: ["Journal Article"],
			},
		},
	});
}

test("PubMed search sends NCBI_API_KEY when set and redacts it from reported endpoints", async () => {
	process.env.NCBI_API_KEY = "test-ncbi-key";
	const requests: string[] = [];
	globalThis.fetch = async (input) => {
		const url = String(input instanceof Request ? input.url : input);
		requests.push(url);
		if (url.includes("/esearch.fcgi")) return esearchResponse();
		if (url.includes("/esummary.fcgi")) return esummaryResponse();
		throw new Error(`unexpected URL ${url}`);
	};

	const tool = registerTools().get("feynman_science_database_search");
	assert.ok(tool);
	const result = await tool.execute("pubmed-api-key", {
		source: "pubmed",
		query: "crispr gene editing",
		limit: 1,
	});

	const eutilsRequests = requests.filter((url) => url.includes(".fcgi"));
	assert.equal(eutilsRequests.length, 2);
	for (const url of eutilsRequests) {
		assert.equal(new URL(url).searchParams.get("api_key"), "test-ncbi-key");
	}
	const details = result.details as { provenance: { endpoints: string[] }; returned: number };
	assert.equal(details.returned, 1);
	for (const endpoint of details.provenance.endpoints) {
		assert.ok(!endpoint.includes("test-ncbi-key"), `endpoint leaks api key: ${endpoint}`);
	}
});

test("concurrent NCBI requests are spaced by the shared rate limiter", async () => {
	process.env.NCBI_API_KEY = "test-ncbi-key";
	const startTimes: number[] = [];
	globalThis.fetch = async (input) => {
		const url = String(input instanceof Request ? input.url : input);
		startTimes.push(Date.now());
		if (url.includes("/esearch.fcgi")) return esearchResponse();
		if (url.includes("/esummary.fcgi")) return esummaryResponse();
		throw new Error(`unexpected URL ${url}`);
	};

	const tool = registerTools().get("feynman_science_database_search");
	assert.ok(tool);
	await Promise.all(
		Array.from({ length: 4 }, (_, i) =>
			tool.execute(`burst-${i}`, { source: "pubmed", query: `topic ${i}`, limit: 1 })),
	);

	assert.ok(startTimes.length >= 4, `expected at least 4 requests, saw ${startTimes.length}`);
	const ordered = [...startTimes].sort((a, b) => a - b);
	for (let i = 1; i < ordered.length; i += 1) {
		const gap = ordered[i]! - ordered[i - 1]!;
		assert.ok(gap >= 100, `requests ${i - 1} and ${i} were only ${gap}ms apart`);
	}
});

test("non-NCBI hosts bypass the NCBI rate limiter", async () => {
	const started: number[] = [];
	await Promise.all(
		Array.from({ length: 5 }, () =>
			withNcbiRateLimit(new URL("https://www.ebi.ac.uk/europepmc/webservices/rest/search"), async () => {
				started.push(Date.now());
			})),
	);
	assert.equal(started.length, 5);
	const span = Math.max(...started) - Math.min(...started);
	assert.ok(span < 90, `Europe PMC calls were serialized by the NCBI gate (${span}ms span)`);
});

test("the PMC ID Converter is not sent the NCBI API key", async () => {
	// The ID Converter is a separate service that documents no api_key support,
	// and its URL reaches provenance, so the key must never be attached there.
	process.env.NCBI_API_KEY = "test-ncbi-key";
	const requests: string[] = [];
	globalThis.fetch = async (input) => {
		const url = String(input instanceof Request ? input.url : input);
		requests.push(url);
		if (url.includes("idconv")) {
			return jsonResponse({
				status: "ok",
				records: [{ "requested-id": "35486828", pmid: "35486828", pmcid: "PMC9046468" }],
			});
		}
		throw new Error(`unexpected URL ${url}`);
	};

	const tool = registerTools().get("feynman_science_database_search");
	assert.ok(tool);
	const result = await tool.execute("idconv-key", { source: "pubmed", query: "convert:35486828", limit: 1 });

	const idconv = requests.find((url) => url.includes("idconv"));
	assert.ok(idconv, "expected an ID Converter request");
	assert.equal(new URL(idconv).searchParams.get("api_key"), null);
	for (const endpoint of (result.details as { provenance: { endpoints: string[] } }).provenance.endpoints) {
		assert.ok(!endpoint.includes("test-ncbi-key"), `endpoint leaks api key: ${endpoint}`);
	}
});
