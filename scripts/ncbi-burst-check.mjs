// Reproduces the PubMed 429 burst and measures the fix.
//
//   node --import tsx scripts/ncbi-burst-check.mjs
//   NCBI_API_KEY= node --import tsx scripts/ncbi-burst-check.mjs   # anonymous
//
// Issues 12 concurrent feynman_science_database_search calls, the shape of one
// /lit turn. Each search-mode call makes two E-utilities requests (esearch then
// esummary), so this is 24 HTTP requests against a 3/sec/IP limit.
//
// Run it on main to see the failure, and on the fix to see it go away.
import { registerScienceDatabaseTools } from "../extensions/research-tools/science-databases.js";

const QUERIES = [
	"CRISPR base editing", "prime editing", "AAV delivery", "cytosine base editor",
	"adenine base editor", "epigenome editing", "pegRNA design", "base editing trial",
	"Cas9 specificity", "dCas9 repression", "gene therapy editing", "off-target detection",
];

const tools = new Map();
registerScienceDatabaseTools({ registerTool: (tool) => tools.set(tool.name, tool) });
const tool = tools.get("feynman_science_database_search");

const startedAt = Date.now();
const settled = await Promise.allSettled(
	QUERIES.map((query, i) => tool.execute(`burst-${i}`, { source: "pubmed", query, limit: 3 })),
);

let ok = 0;
let rateLimited = 0;
let other = 0;
let records = 0;
for (const outcome of settled) {
	if (outcome.status === "fulfilled") {
		ok += 1;
		records += outcome.value?.details?.returned ?? 0;
		continue;
	}
	const message = String(outcome.reason?.message ?? outcome.reason);
	if (message.includes("429")) rateLimited += 1;
	else { other += 1; console.log(`  other failure: ${message.slice(0, 100)}`); }
}

console.log(
	`${ok}/${QUERIES.length} calls ok, ${rateLimited} rate-limited, ${other} other, ` +
	`${records} records, ${Date.now() - startedAt}ms, ` +
	`key ${process.env.NCBI_API_KEY?.trim() ? "set" : "unset"}`,
);
