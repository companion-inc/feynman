type ProteinAnnotationParams = { limit?: number; query: string; source: string };

const REQUEST_TIMEOUT_MS = 25_000;
const MAX_RECORDS = 200;
const INTERPRO_BASE = "https://www.ebi.ac.uk/interpro/api";
const PROTEIN_ATLAS_SEARCH_URL = "https://www.proteinatlas.org/api/search_download.php";
const STRING_BASE = "https://version-12-0.string-db.org/api";

const COMMANDS = new Set([
	"get_domain_architecture",
	"get_interpro_entry",
	"get_pfam_clan",
	"get_pfam_family_proteins",
	"get_pfam_family_proteomes",
	"get_protein_atlas_gene",
	"get_string_best_similarity_hits",
	"get_string_network",
	"get_string_similarity_scores",
	"map_string_ids",
	"search_interpro_entries",
	"search_pfam_clans",
	"search_protein_atlas",
]);

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

function booleanValue(value: string | undefined, fallback = false): boolean {
	if (value === undefined) return fallback;
	return /^(?:1|true|yes|y)$/i.test(value);
}

function safeLimit(value: number | undefined, fallback = 50): number {
	if (!Number.isFinite(value) || value === undefined) return fallback;
	return Math.max(1, Math.min(Math.floor(value), MAX_RECORDS));
}

function exactCommand(query: string): { name: string; rest: string } | undefined {
	const match = query.trim().match(/^([a-z][a-z0-9_]*):?\s*(.*)$/i);
	const name = match?.[1]?.toLowerCase();
	if (!name || !COMMANDS.has(name)) return undefined;
	return { name, rest: match?.[2]?.trim() ?? "" };
}

function parseKeyValueQuery(query: string): { flags: Record<string, string>; text: string } {
	const flags: Record<string, string> = {};
	const textParts: string[] = [];
	for (const part of query.match(/(?:[^\s"]+|"[^"]*")+/g) ?? []) {
		const match = part.match(/^([a-z_]+)=(.+)$/i);
		if (match?.[1] && match[2] !== undefined) flags[match[1].toLowerCase()] = match[2].replace(/^"|"$/g, "");
		else textParts.push(part);
	}
	return { flags, text: textParts.join(" ").replace(/^"|"$/g, "").trim() };
}

function splitTerms(value: string | undefined): string[] {
	return (value ?? "").split(/[\s,;\r\n]+/).map((item) => item.trim()).filter(Boolean);
}

function docs(): Record<string, string> {
	return {
		hpa: "https://www.proteinatlas.org/about/help/dataaccess",
		interpro: "https://www.ebi.ac.uk/interpro/api/",
		string: "https://string-db.org/help/api/",
	};
}

async function responseFor(url: URL, init?: RequestInit): Promise<Response> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
	try {
		const response = await fetch(url, {
			...init,
			headers: {
				accept: "application/json,text/tab-separated-values,text/plain,*/*",
				"user-agent": "feynman-science-database-search/1.0 (https://github.com/advaitpaliwal/feynman)",
				...(init?.headers ?? {}),
			},
			signal: controller.signal,
		});
		if (response.status === 204) return response;
		if (!response.ok) throw new Error(`Protein annotation request failed: ${response.status} ${response.statusText}`);
		return response;
	} finally {
		clearTimeout(timeout);
	}
}

async function fetchJson(url: URL, init?: RequestInit): Promise<unknown | undefined> {
	const response = await responseFor(url, init);
	if (response.status === 204) return undefined;
	return response.json();
}

async function fetchText(url: URL, init?: RequestInit): Promise<string> {
	const response = await responseFor(url, init);
	if (response.status === 204) return "";
	return response.text();
}

function formBody(values: Record<string, string>): URLSearchParams {
	const body = new URLSearchParams();
	for (const [key, value] of Object.entries(values)) body.set(key, value);
	return body;
}

async function postFormJson(url: URL, values: Record<string, string>): Promise<unknown> {
	return fetchJson(url, {
		body: formBody(values),
		headers: { "content-type": "application/x-www-form-urlencoded" },
		method: "POST",
	});
}

async function postFormText(url: URL, values: Record<string, string>): Promise<string> {
	return fetchText(url, {
		body: formBody(values),
		headers: { "content-type": "application/x-www-form-urlencoded" },
		method: "POST",
	});
}

function output(command: string, query: string, payload: Record<string, unknown>, endpoints: string[]): Record<string, unknown> {
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "protein-annotation",
		command,
		query,
		provenance: { docs: docs(), endpoints },
		...payload,
	};
}

function normalizeEntry(record: Record<string, unknown>): Record<string, unknown> {
	const nestedMetadata = recordValue(record.metadata);
	const metadata = Object.keys(nestedMetadata).length ? nestedMetadata : record;
	const accession = stringValue(metadata.accession);
	const memberDatabases = recordValue(metadata.member_databases);
	return {
		accession,
		name: stringValue(metadata.name),
		type: stringValue(metadata.type),
		source_database: stringValue(metadata.source_database),
		integrated: stringValue(metadata.integrated),
		description: stringValue(metadata.description),
		go_terms: arrayValue(metadata.go_terms).map((term) => {
			const item = recordValue(term);
			return { identifier: stringValue(item.identifier), name: stringValue(item.name) };
		}),
		member_databases: memberDatabases,
		member_database_count: Object.keys(memberDatabases).length || undefined,
		url: accession ? `https://www.ebi.ac.uk/interpro/entry/${accession.startsWith("PF") ? "Pfam" : "InterPro"}/${encodeURIComponent(accession)}/` : undefined,
	};
}

function normalizeProteinMatch(record: Record<string, unknown>): Record<string, unknown> {
	const metadata = recordValue(record.metadata);
	const protein = recordValue(record.protein ?? record.metadata);
	return {
		accession: stringValue(metadata.accession ?? protein.accession),
		name: stringValue(metadata.name ?? protein.name),
		source_database: stringValue(metadata.source_database),
		organism: stringValue(recordValue(metadata.source_organism).scientificName ?? metadata.organism),
		entry_count: numberValue(record.entry_count),
		entries: arrayValue(record.entries ?? record.results).map((item) => normalizeEntry(recordValue(item))).slice(0, 50),
		raw_locations: arrayValue(record.entry_protein_locations).slice(0, 20),
	};
}

async function walkInterpro(url: URL, maxRecords: number): Promise<{ endpoints: string[]; records: unknown[]; total: number; truncated: boolean }> {
	const endpoints: string[] = [];
	const records: unknown[] = [];
	let total = 0;
	let next: string | undefined = url.toString();
	while (next && records.length <= maxRecords) {
		endpoints.push(next);
		const payload = recordValue(await fetchJson(new URL(next)));
		total = numberValue(payload.count) ?? records.length;
		records.push(...arrayValue(payload.results));
		next = stringValue(payload.next);
		if (!next) break;
	}
	return { endpoints, records: records.slice(0, maxRecords), total, truncated: total > maxRecords || Boolean(next) };
}

async function domainArchitecture(query: string, rest: string, limit: number): Promise<Record<string, unknown>> {
	const accessions = splitTerms(rest);
	if (!accessions.length) throw new Error("get_domain_architecture requires one or more UniProt accessions.");
	const summaries: Record<string, unknown> = {};
	const endpoints: string[] = [];
	for (const accession of accessions.slice(0, limit)) {
		const url = new URL(`${INTERPRO_BASE}/entry/interpro/protein/uniprot/${encodeURIComponent(accession)}/`);
		url.searchParams.set("page_size", "200");
		const walked = await walkInterpro(url, MAX_RECORDS);
		endpoints.push(...walked.endpoints);
		summaries[accession] = {
			protein: accession,
			entry_count: walked.total,
			records_truncated: walked.truncated,
			entries: walked.records.map((item) => normalizeEntry(recordValue(item))),
		};
	}
	return output("get_domain_architecture", query, {
		summaries,
		stats: { http_requests: endpoints.length },
		results: Object.values(summaries),
	}, endpoints);
}

async function searchEntries(command: string, query: string, rest: string, limit: number): Promise<Record<string, unknown>> {
	const parsed = parseKeyValueQuery(rest);
	const sourceDb = parsed.flags.source_db ?? "interpro";
	const url = new URL(`${INTERPRO_BASE}/entry/${encodeURIComponent(sourceDb)}/`);
	if (parsed.text) url.searchParams.set("search", parsed.text);
	if (parsed.flags.entry_type) url.searchParams.set("type", parsed.flags.entry_type);
	if (parsed.flags.go_term) url.searchParams.set("go_term", parsed.flags.go_term);
	url.searchParams.set("page_size", String(limit));
	const walked = await walkInterpro(url, limit);
	const rows = walked.records.map((item) => normalizeEntry(recordValue(item)));
	return output(command, query, {
		count: walked.total,
		n_records_returned: rows.length,
		records_truncated: walked.truncated,
		records: rows,
		results: rows,
	}, walked.endpoints);
}

async function entryDetail(query: string, rest: string): Promise<Record<string, unknown>> {
	const accession = splitTerms(rest)[0]?.toUpperCase();
	if (!accession) throw new Error("get_interpro_entry requires an IPR or PF accession.");
	const db = accession.startsWith("PF") ? "pfam" : "interpro";
	const url = new URL(`${INTERPRO_BASE}/entry/${db}/${encodeURIComponent(accession)}/`);
	const row = normalizeEntry(recordValue(await fetchJson(url)));
	return output("get_interpro_entry", query, { ...row, records: [row], results: [row] }, [url.toString()]);
}

async function searchPfamClans(query: string, rest: string, limit: number): Promise<Record<string, unknown>> {
	const parsed = parseKeyValueQuery(rest);
	const url = new URL(`${INTERPRO_BASE}/set/pfam/`);
	if (parsed.text) url.searchParams.set("search", parsed.text);
	url.searchParams.set("page_size", String(limit));
	const walked = await walkInterpro(url, limit);
	const rows = walked.records.map((item) => normalizeEntry(recordValue(item)));
	return output("search_pfam_clans", query, {
		count: walked.total,
		n_records_returned: rows.length,
		records_truncated: walked.truncated,
		records: rows,
		results: rows,
	}, walked.endpoints);
}

async function pfamClan(query: string, rest: string): Promise<Record<string, unknown>> {
	const accession = splitTerms(rest)[0]?.toUpperCase();
	if (!accession) throw new Error("get_pfam_clan requires a clan accession.");
	const url = new URL(`${INTERPRO_BASE}/set/pfam/${encodeURIComponent(accession)}/`);
	const detail = recordValue(await fetchJson(url));
	const metadata = recordValue(detail.metadata);
	const relationships = recordValue(metadata.relationships);
	const members = arrayValue(relationships.nodes).map((item) => normalizeEntry(recordValue(item)));
	return output("get_pfam_clan", query, {
		accession: stringValue(metadata.accession) ?? accession,
		name: stringValue(metadata.name),
		description: stringValue(metadata.description),
		member_count: members.length,
		members,
		records: members,
		results: [{ accession, members }],
	}, [url.toString()]);
}

async function pfamMembers(command: string, query: string, rest: string, limit: number): Promise<Record<string, unknown>> {
	const parsed = parseKeyValueQuery(rest);
	const accession = splitTerms(parsed.text)[0]?.toUpperCase();
	if (!accession) throw new Error(`${command} requires a Pfam accession.`);
	const countOnly = booleanValue(parsed.flags.count_only, command === "get_pfam_family_proteomes");
	const endpoints: string[] = [];
	const path = command === "get_pfam_family_proteins"
		? `/protein/${booleanValue(parsed.flags.reviewed_only) ? "reviewed" : "uniprot"}/entry/pfam/${encodeURIComponent(accession)}/`
		: `/proteome/uniprot/entry/pfam/${encodeURIComponent(accession)}/`;
	const url = new URL(`${INTERPRO_BASE}${path}`);
	if (parsed.flags.tax_id) url.searchParams.set("tax_id", parsed.flags.tax_id);
	url.searchParams.set("page_size", countOnly ? "1" : String(limit));
	endpoints.push(url.toString());
	const payload = recordValue(await fetchJson(url));
	const total = numberValue(payload.count) ?? 0;
	const rows = countOnly ? [] : arrayValue(payload.results).slice(0, limit).map((item) => normalizeProteinMatch(recordValue(item)));
	return output(command, query, {
		pfam_accession: accession,
		count: total,
		count_only: countOnly,
		n_records_returned: rows.length,
		records_truncated: total > rows.length,
		records: rows,
		results: rows,
	}, endpoints);
}

function normalizeHpaRecord(record: Record<string, unknown>): Record<string, unknown> {
	const gene = stringValue(record.Gene ?? record.gene);
	const ensembl = stringValue(record.Ensembl ?? record.ensembl);
	return {
		gene,
		gene_synonyms: arrayValue(record["Gene synonym"] ?? record.gene_synonyms).map(String),
		ensembl,
		gene_description: stringValue(record["Gene description"] ?? record.gene_description),
		uniprot: arrayValue(record.Uniprot ?? record.uniprot).map(String),
		chromosome: stringValue(record.Chromosome ?? record.chromosome),
		position: stringValue(record.Position ?? record.position),
		subcellular_location: stringValue(record["Subcellular location"] ?? record.subcellular_location),
		url: ensembl && gene ? `https://www.proteinatlas.org/${encodeURIComponent(ensembl)}-${encodeURIComponent(gene)}` : undefined,
		raw: record,
	};
}

async function hpaSearch(command: string, query: string, rest: string, limit: number): Promise<Record<string, unknown>> {
	const parsed = parseKeyValueQuery(rest);
	const term = parsed.text;
	if (!term) throw new Error(`${command} requires a gene or search query.`);
	const url = new URL(PROTEIN_ATLAS_SEARCH_URL);
	url.searchParams.set("search", term);
	url.searchParams.set("format", "json");
	url.searchParams.set("compress", "no");
	url.searchParams.set("columns", parsed.flags.columns ?? (command === "search_protein_atlas" ? "g,gs,eg,gd,up,chr,chrp,scl" : "g,gs,eg,gd,up,chr,chrp,scl,rnatsm,rnatpm,rnatd,rnatec"));
	const rawRows = arrayValue(await fetchJson(url));
	const rows = rawRows.slice(0, command === "search_protein_atlas" ? limit : 1).map((item) => normalizeHpaRecord(recordValue(item)));
	return output(command, query, {
		search: term,
		full: booleanValue(parsed.flags.full),
		count: rawRows.length,
		n_records_returned: rows.length,
		records_truncated: rawRows.length > rows.length,
		records: booleanValue(parsed.flags.full) ? rows.map((row) => recordValue(row.raw)) : rows,
		results: rows,
	}, [url.toString()]);
}

function parseTsv(text: string): Array<Record<string, string>> {
	const lines = text.split(/\r?\n/).filter((line) => line.trim());
	const header = lines.shift()?.split("\t") ?? [];
	return lines.map((line) => {
		const cells = line.split("\t");
		const row: Record<string, string> = {};
		header.forEach((key, index) => {
			row[key] = cells[index]?.trim() ?? "";
		});
		return row;
	});
}

function mappedRows(rows: unknown[], inputs: string[]): { mapped: Array<Record<string, unknown>>; unmapped: string[] } {
	const byIndex = new Map<number, Record<string, unknown>>();
	for (const item of rows.map(recordValue)) {
		const index = numberValue(item.queryIndex);
		if (index !== undefined && !byIndex.has(index)) byIndex.set(index, item);
	}
	const mapped: Array<Record<string, unknown>> = [];
	const unmapped: string[] = [];
	inputs.forEach((input, index) => {
		const row = byIndex.get(index);
		if (!row) {
			unmapped.push(input);
			return;
		}
		mapped.push({
			query: input,
			string_id: stringValue(row.stringId),
			preferred_name: stringValue(row.preferredName),
			ncbi_taxon_id: numberValue(row.ncbiTaxonId),
			annotation: stringValue(row.annotation),
		});
	});
	return { mapped, unmapped };
}

async function stringMapping(rest: string): Promise<{ endpoints: string[]; mapped: Array<Record<string, unknown>>; species: string; stringIds: string[]; unmapped: string[] }> {
	const parsed = parseKeyValueQuery(rest);
	const species = parsed.flags.species ?? "9606";
	const symbols = splitTerms(parsed.text || parsed.flags.symbols || parsed.flags.identifiers);
	if (!symbols.length) throw new Error("STRING protein annotation commands require one or more symbols.");
	const url = new URL(`${STRING_BASE}/json/get_string_ids`);
	const rows = arrayValue(await postFormJson(url, {
		caller_identity: "feynman",
		echo_query: "1",
		identifiers: symbols.join("\r"),
		limit: "1",
		species,
	}));
	const mapped = mappedRows(rows, symbols);
	const stringIds = mapped.mapped.map((item) => stringValue(item.string_id)).filter((id): id is string => Boolean(id));
	return { endpoints: [url.toString()], mapped: mapped.mapped, species, stringIds, unmapped: mapped.unmapped };
}

async function stringCommand(command: string, query: string, rest: string, limit: number): Promise<Record<string, unknown>> {
	const parsed = parseKeyValueQuery(rest);
	const mapped = await stringMapping(rest);
	if (command === "map_string_ids") {
		return output(command, query, { species: Number(mapped.species), mapped: mapped.mapped, unmapped: mapped.unmapped, results: mapped.mapped }, mapped.endpoints);
	}
	if (command === "get_string_network") {
		const url = new URL(`${STRING_BASE}/tsv/network`);
		const rows = mapped.stringIds.length ? parseTsv(await postFormText(url, {
			caller_identity: "feynman",
			identifiers: mapped.stringIds.join("\r"),
			required_score: parsed.flags.required_score ?? parsed.flags.score ?? "700",
			species: mapped.species,
		})) : [];
		const edges = rows.slice(0, limit).map((row) => ({
			a: row.preferredName_A,
			b: row.preferredName_B,
			score: numberValue(row.score),
			evidence: {
				nscore: numberValue(row.nscore),
				fscore: numberValue(row.fscore),
				pscore: numberValue(row.pscore),
				ascore: numberValue(row.ascore),
				escore: numberValue(row.escore),
				dscore: numberValue(row.dscore),
				tscore: numberValue(row.tscore),
			},
		}));
		return output(command, query, {
			species: Number(mapped.species),
			mapped: mapped.mapped,
			unmapped: mapped.unmapped,
			edges,
			summary: { n_nodes: mapped.mapped.length, n_edges: rows.length },
			results: edges,
		}, [...mapped.endpoints, url.toString()]);
	}
	const endpoint = command === "get_string_best_similarity_hits" ? "homology_best" : "homology";
	const url = new URL(`${STRING_BASE}/json/${endpoint}`);
	const body: Record<string, string> = {
		caller_identity: "feynman",
		identifiers: mapped.stringIds.join("\r"),
		species: mapped.species,
	};
	if (command === "get_string_best_similarity_hits" && parsed.flags.target_species) body.species_b = parsed.flags.target_species;
	const rows = mapped.stringIds.length ? arrayValue(await postFormJson(url, body)) : [];
	const records = rows.slice(0, limit).map((item) => {
		const row = recordValue(item);
		return command === "get_string_best_similarity_hits"
			? {
				query_id: stringValue(row.stringId_A),
				hit_id: stringValue(row.stringId_B),
				query_taxon: numberValue(row.ncbiTaxonId_A),
				hit_taxon: numberValue(row.ncbiTaxonId_B),
				bitscore: numberValue(row.bitscore),
			}
			: {
				id_a: stringValue(row.stringId_A),
				id_b: stringValue(row.stringId_B),
				taxon_a: numberValue(row.ncbiTaxonId_A),
				taxon_b: numberValue(row.ncbiTaxonId_B),
				bitscore: numberValue(row.bitscore),
				self: row.stringId_A === row.stringId_B,
			};
	});
	return output(command, query, {
		species: Number(mapped.species),
		species_b: numberValue(parsed.flags.target_species),
		mapped: mapped.mapped,
		unmapped: mapped.unmapped,
		n_records_returned: records.length,
		records,
		results: records,
	}, [...mapped.endpoints, url.toString()]);
}

export async function searchProteinAnnotationExact(params: ProteinAnnotationParams): Promise<Record<string, unknown> | undefined> {
	const command = exactCommand(params.query);
	if (!command) return undefined;
	const limit = safeLimit(params.limit);
	if (command.name === "get_domain_architecture") return domainArchitecture(params.query, command.rest, limit);
	if (command.name === "search_interpro_entries") return searchEntries(command.name, params.query, command.rest, limit);
	if (command.name === "get_interpro_entry") return entryDetail(params.query, command.rest);
	if (command.name === "search_pfam_clans") return searchPfamClans(params.query, command.rest, limit);
	if (command.name === "get_pfam_clan") return pfamClan(params.query, command.rest);
	if (command.name === "get_pfam_family_proteins" || command.name === "get_pfam_family_proteomes") return pfamMembers(command.name, params.query, command.rest, limit);
	if (command.name === "get_protein_atlas_gene" || command.name === "search_protein_atlas") return hpaSearch(command.name, params.query, command.rest, limit);
	return stringCommand(command.name, params.query, command.rest, limit);
}
