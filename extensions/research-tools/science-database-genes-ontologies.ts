const REQUEST_TIMEOUT_MS = 25_000;
const MYGENE_QUERY_URL = "https://mygene.info/v3/query";
const UNIPROT_SEARCH_URL = "https://rest.uniprot.org/uniprotkb/search";

function recordValue(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function arrayValue(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
	return undefined;
}

function queryParamMap(text: string): Record<string, string> {
	const params: Record<string, string> = {};
	for (const match of text.matchAll(/\b([a-z][a-z0-9_-]*)\s*=\s*("[^"]+"|'[^']+'|[^\s;]+)/gi)) {
		const key = match[1]?.toLowerCase();
		const raw = match[2]?.trim();
		if (!key || !raw) continue;
		params[key] = raw.replace(/^["']|["']$/g, "");
	}
	return params;
}

function stripQueryParams(text: string): string {
	return text.replace(/\b[a-z][a-z0-9_-]*\s*=\s*("[^"]+"|'[^']+'|[^\s;]+)/gi, " ").trim();
}

function splitTerms(value: string): string[] {
	return value
		.split(/[\n\r,;]+|\s{2,}/)
		.map((item) => item.trim())
		.filter(Boolean);
}

function stringArray(value: unknown): string[] {
	if (typeof value === "string" && value.trim()) return [value.trim()];
	return arrayValue(value).map((item) => String(item)).filter(Boolean);
}

function normalizeMyGeneHit(record: Record<string, unknown>): Record<string, unknown> {
	const id = stringValue(record._id);
	const ensembl = recordValue(record.ensembl);
	const uniprot = recordValue(record.uniprot);
	return {
		id,
		symbol: stringValue(record.symbol),
		name: stringValue(record.name),
		entrezGene: numberValue(record.entrezgene),
		taxId: numberValue(record.taxid),
		ensemblGenes: stringArray(ensembl.gene),
		uniprotSwissProt: stringArray(uniprot["Swiss-Prot"]),
		summary: stringValue(record.summary),
		score: numberValue(record._score),
		url: id ? `https://mygene.info/v3/gene/${encodeURIComponent(id)}` : undefined,
	};
}

async function fetchJson(url: URL, init?: RequestInit): Promise<unknown> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
	try {
		const response = await fetch(url, {
			...init,
			headers: {
				accept: "application/json",
				"user-agent": "feynman-science-database-search/1.0 (https://github.com/advaitpaliwal/feynman)",
				...(init?.headers ?? {}),
			},
			signal: controller.signal,
		});
		if (!response.ok) throw new Error(`Science database request failed: ${response.status} ${response.statusText}`);
		return response.json();
	} finally {
		clearTimeout(timeout);
	}
}

async function fetchText(url: URL, accept: string): Promise<string> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
	try {
		const response = await fetch(url, {
			headers: { accept },
			signal: controller.signal,
		});
		if (!response.ok) throw new Error(`Science database request failed: ${response.status} ${response.statusText}`);
		return response.text();
	} finally {
		clearTimeout(timeout);
	}
}

function parseTsv(text: string): Array<Record<string, string>> {
	const lines = text.split(/\r?\n/).filter((line) => line.trim());
	const header = lines.shift()?.split("\t") ?? [];
	return lines.map((line) => {
		const row: Record<string, string> = {};
		line.split("\t").forEach((value, index) => {
			row[header[index] ?? `field_${index}`] = value.trim();
		});
		return row;
	});
}

function parseUniProtTextRecords(text: string, format: string, accessions: string[]): Array<Record<string, unknown>> {
	if (format === "fasta") {
		return text.split(/\n(?=>)/).flatMap((entry) => {
			const trimmed = entry.trim();
			const accession = trimmed.match(/\|([^|]+)\|/)?.[1] ?? accessions.find((id) => trimmed.includes(id));
			return trimmed ? [{ accession, format, text: trimmed }] : [];
		});
	}
	return text.split(/\n\/\/\s*/).flatMap((entry) => {
		const trimmed = entry.trim();
		const accession = trimmed.match(/^AC\s+([^;\s]+)/m)?.[1] ?? accessions.find((id) => trimmed.includes(id));
		return trimmed ? [{ accession, format, text: trimmed }] : [];
	});
}

export async function searchMyGeneQueryTool(query: string, limit: number): Promise<Record<string, unknown>> {
	const rest = query.replace(/^query_genes\s*:?\s*/i, "");
	const queryParams = queryParamMap(rest);
	const terms = splitTerms(stripQueryParams(rest));
	if (!terms.length) throw new Error("query_genes requires one or more gene terms.");
	const url = new URL(MYGENE_QUERY_URL);
	const body = new URLSearchParams();
	body.set("q", terms.join(","));
	body.set("scopes", queryParams.scopes ?? "symbol");
	body.set("fields", queryParams.fields ?? "symbol,name,taxid,entrezgene,ensembl.gene");
	body.set("species", queryParams.species ?? "human");
	const payload = await fetchJson(url, {
		body,
		headers: { "content-type": "application/x-www-form-urlencoded" },
		method: "POST",
	});
	const records = arrayValue(payload).map((item) => normalizeMyGeneHit(recordValue(item))).slice(0, limit);
	const foundQueries = new Set(arrayValue(payload).map((item) => stringValue(recordValue(item).query)).filter(Boolean));
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "mygene",
		query,
		searchMode: "query-genes",
		terms,
		scopes: queryParams.scopes ?? "symbol",
		fields: queryParams.fields ?? "symbol,name,taxid,entrezgene,ensembl.gene",
		species: queryParams.species ?? "human",
		totalCount: arrayValue(payload).length,
		returned: records.length,
		notFound: terms.filter((term) => !foundQueries.has(term)),
		results: records,
		provenance: {
			docs: "https://docs.mygene.info/en/latest/doc/query_service.html",
			endpoints: [url.toString()],
		},
	};
}

export async function getUniProtEntries(query: string, limit: number): Promise<Record<string, unknown>> {
	const rest = query.replace(/^get_uniprot_entries\s*:?\s*/i, "");
	const params = queryParamMap(rest);
	const accessions = splitTerms(stripQueryParams(rest)).slice(0, limit);
	if (!accessions.length) throw new Error("get_uniprot_entries requires one or more UniProt accessions.");
	const format = (params.format ?? (params.fields ? "tsv" : "fasta")).toLowerCase();
	const fields = params.fields ?? "accession,id,protein_name,gene_names,organism_name,length";
	const url = new URL(UNIPROT_SEARCH_URL);
	url.searchParams.set("query", accessions.map((accession) => `(accession:${accession})`).join(" OR "));
	url.searchParams.set("format", format === "txt" ? "txt" : format === "fasta" ? "fasta" : "tsv");
	url.searchParams.set("size", String(limit));
	if (format !== "txt" && format !== "fasta") url.searchParams.set("fields", fields);
	const text = await fetchText(url, format === "txt" ? "text/plain" : format === "fasta" ? "text/x-fasta,text/plain" : "text/tab-separated-values,text/plain");
	const records = format === "txt" || format === "fasta" ? parseUniProtTextRecords(text, format, accessions) : parseTsv(text);
	const returnedAccessions = new Set(records.map((record) => stringValue(record.accession) ?? stringValue(record.Entry)).filter(Boolean));
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "uniprot",
		query,
		searchMode: "get-uniprot-entries",
		accessions,
		format,
		...(format !== "txt" && format !== "fasta" ? { fields } : {}),
		totalCount: records.length,
		returned: records.length,
		missingAccessions: accessions.filter((accession) => !returnedAccessions.has(accession)),
		results: records,
		provenance: {
			docs: ["https://www.uniprot.org/help/api_queries", "https://www.uniprot.org/help/return_fields"],
			endpoints: [url.toString()],
		},
	};
}
