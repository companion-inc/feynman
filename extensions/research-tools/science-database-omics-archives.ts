import { withNcbiRateLimit } from "./ncbi-rate-limit.js";

type SearchParams = { limit?: number; query: string; source: string };

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;
const REQUEST_TIMEOUT_MS = 25_000;
const BIOSTUDIES_BASE = "https://www.ebi.ac.uk/biostudies/api/v1";
const GEO_EUTILS_BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
const METABOLIGHTS_BASE = "https://www.ebi.ac.uk/metabolights/ws";
const MGNIFY_BASE = "https://www.ebi.ac.uk/metagenomics/api/v2";
const PRIDE_BASE = "https://www.ebi.ac.uk/pride/ws/archive/v2";

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

function boolValue(value: unknown, fallback = false): boolean {
	if (typeof value === "boolean") return value;
	if (typeof value === "string" && value.trim()) return /^(?:1|true|yes|y)$/i.test(value);
	return fallback;
}

function safeLimit(value: number | undefined): number {
	if (!Number.isFinite(value) || value === undefined) return DEFAULT_LIMIT;
	return Math.max(1, Math.min(Math.floor(value), MAX_LIMIT));
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

// NCBI shares one per-IP E-utilities budget across every module, so these
// requests join the same queue. Non-NCBI hosts return immediately.
async function fetchJson(url: URL, init?: RequestInit): Promise<unknown> {
	return withNcbiRateLimit(url, () => fetchJsonDirect(url, init));
}

async function fetchJsonDirect(url: URL, init?: RequestInit): Promise<unknown> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
	try {
		const response = await fetch(url, {
			...init,
			headers: {
				accept: "application/json",
				"user-agent": "feynman-science-database-search/1.0 (https://github.com/companion-ai/feynman)",
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

// NCBI shares one per-IP E-utilities budget across every module, so these
// requests join the same queue. Non-NCBI hosts return immediately.
async function fetchJsonWithHeaders(url: URL, init?: RequestInit): Promise<{ headers: Headers; payload: unknown }> {
	return withNcbiRateLimit(url, () => fetchJsonWithHeadersDirect(url, init));
}

async function fetchJsonWithHeadersDirect(url: URL, init?: RequestInit): Promise<{ headers: Headers; payload: unknown }> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
	try {
		const response = await fetch(url, {
			...init,
			headers: {
				accept: "application/json",
				"user-agent": "feynman-science-database-search/1.0 (https://github.com/companion-ai/feynman)",
				...(init?.headers ?? {}),
			},
			signal: controller.signal,
		});
		if (!response.ok) throw new Error(`Science database request failed: ${response.status} ${response.statusText}`);
		return { headers: response.headers, payload: await response.json() };
	} finally {
		clearTimeout(timeout);
	}
}

function ncbiIdentityParams(): Record<string, string> {
	const email = process.env.NCBI_EMAIL?.trim();
	return {
		tool: "feynman",
		...(email ? { email } : {}),
	};
}

function attributeMap(section: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const attribute of arrayValue(section.attributes)) {
		const item = recordValue(attribute);
		const name = stringValue(item.name);
		if (!name) continue;
		const key = name.replace(/[^A-Za-z0-9]+(.)/g, (_, char: string) => char.toUpperCase()).replace(/^[A-Z]/, (char) => char.toLowerCase());
		const value = item.value ?? item.values;
		if (out[key] === undefined) out[key] = value;
		else if (Array.isArray(out[key])) (out[key] as unknown[]).push(value);
		else out[key] = [out[key], value];
	}
	return out;
}

function walkSections(section: Record<string, unknown> | undefined, visit: (section: Record<string, unknown>) => void): void {
	if (!section || !Object.keys(section).length) return;
	visit(section);
	for (const child of arrayValue(section.subsections)) walkSections(recordValue(child), visit);
}

function normalizeArrayExpressRecord(record: Record<string, unknown>): Record<string, unknown> {
	const accession = stringValue(record.accession);
	return {
		accession,
		type: stringValue(record.type),
		title: stringValue(record.title),
		fileCount: numberValue(record.files),
		releaseDate: stringValue(record.release_date),
		isPublic: Boolean(record.isPublic),
		url: accession ? `https://www.ebi.ac.uk/biostudies/arrayexpress/studies/${encodeURIComponent(accession)}` : undefined,
	};
}

function normalizeArrayExpressDetail(payload: Record<string, unknown>): Record<string, unknown> {
	const root = recordValue(payload.section);
	const attrs = { ...attributeMap(payload), ...attributeMap(root) };
	const accession = stringValue(payload.accno) ?? stringValue(root.accno);
	const sections: Array<Record<string, unknown>> = [];
	walkSections(root, (section) => {
		const type = stringValue(section.type);
		if (!type || ["Author", "Organization", "Publication"].includes(type)) return;
		sections.push({
			type,
			accession: stringValue(section.accno),
			...attributeMap(section),
		});
	});
	return {
		accession,
		title: stringValue(attrs.title),
		releaseDate: stringValue(attrs.releaseDate),
		studyType: stringValue(attrs.studyType),
		organisms: arrayValue(attrs.organism).length ? arrayValue(attrs.organism).map(String) : stringValue(attrs.organism) ? [stringValue(attrs.organism)] : [],
		description: stringValue(attrs.description),
		sections: sections.slice(0, 40),
		url: accession ? `https://www.ebi.ac.uk/biostudies/arrayexpress/studies/${encodeURIComponent(accession)}` : undefined,
	};
}

function collectArrayExpressFiles(payload: Record<string, unknown>): Record<string, unknown>[] {
	const files: Record<string, unknown>[] = [];
	walkSections(recordValue(payload.section), (section) => {
		const sectionType = stringValue(section.type);
		for (const file of arrayValue(section.files)) {
			const item = recordValue(file);
			files.push({
				name: stringValue(item.name) ?? stringValue(item.path),
				path: stringValue(item.path),
				type: stringValue(item.type),
				size: numberValue(item.size),
				section: sectionType,
				attributes: attributeMap(item),
			});
		}
	});
	return files.sort((a, b) => `${a.section ?? ""}\t${a.name ?? ""}`.localeCompare(`${b.section ?? ""}\t${b.name ?? ""}`));
}

function collectArrayExpressSamples(payload: Record<string, unknown>): Record<string, unknown>[] {
	const samples: Record<string, unknown>[] = [];
	walkSections(recordValue(payload.section), (section) => {
		const type = stringValue(section.type);
		if (type && !/sample/i.test(type)) return;
		const attrs = attributeMap(section);
		const sampleName = stringValue(attrs.sampleName ?? attrs.sourceName ?? attrs.name ?? section.accno);
		if (!sampleName && !Object.keys(attrs).length) return;
		samples.push({
			sample: sampleName,
			section: type,
			...attrs,
		});
	});
	return samples;
}

function accessionSortKey(accession: string): [string, number] {
	const match = accession.match(/^([A-Z]+)(\d+)$/);
	return match ? [match[1]!, Number(match[2])] : [accession, 0];
}

function metabolightsAccession(value: string): string {
	const clean = value.trim().toUpperCase();
	const match = clean.match(/^(?:study\s*:\s*)?(MTBLS\d+)$/i);
	if (!match) throw new Error("MetaboLights exact commands require an MTBLS accession.");
	return match[1]!.toUpperCase();
}

function normalizeMetaboLightsStudy(payload: Record<string, unknown>): Record<string, unknown> {
	const content = recordValue(payload.content);
	const accession = stringValue(content.studyIdentifier);
	const organisms = arrayValue(content.organism).map((item) => {
		const organism = recordValue(item);
		return {
			organism: stringValue(organism.organismName),
			organismPart: stringValue(organism.organismPart),
		};
	}).filter((organism) => organism.organism || organism.organismPart);
	const assays = arrayValue(content.assays).map((item) => {
		const assay = recordValue(item);
		return {
			assayNumber: numberValue(assay.assayNumber),
			measurement: stringValue(assay.measurement),
			technology: stringValue(assay.technology),
			platform: stringValue(assay.platform),
			filename: stringValue(assay.fileName),
		};
	});
	const sampleTable = recordValue(content.sampleTable);
	return {
		accession,
		title: stringValue(content.title),
		description: stringValue(content.studyDescription),
		studyStatus: stringValue(content.studyStatus),
		organisms,
		assays,
		assayCount: assays.length,
		technologies: [...new Set(assays.map((assay) => assay.technology).filter((value): value is string => Boolean(value)))],
		sampleCount: arrayValue(sampleTable.data).length,
		url: accession ? `https://www.ebi.ac.uk/metabolights/${encodeURIComponent(accession)}` : undefined,
	};
}

function normalizeMetaboLightsFile(record: Record<string, unknown>): Record<string, unknown> {
	return {
		file: stringValue(record.file ?? record.name),
		type: stringValue(record.type),
		status: stringValue(record.status),
		directory: Boolean(record.directory),
	};
}

function normalizeMetaboLightsSampleTable(value: unknown, maxRows: number): Record<string, unknown> {
	const sampleTable = recordValue(value);
	const fields = Object.values(recordValue(sampleTable.fields))
		.map((item) => recordValue(item))
		.filter((item) => numberValue(item.index) !== undefined)
		.sort((a, b) => (numberValue(a.index) ?? 0) - (numberValue(b.index) ?? 0));
	const headers = fields.map((item, index) => stringValue(item.header) ?? `column_${index + 1}`);
	const data = arrayValue(sampleTable.data);
	const rows = data.slice(0, maxRows).map((row) => {
		const values = arrayValue(row);
		return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
	});
	return {
		headers,
		rows,
		nRowsTotal: data.length,
		rowsTruncated: rows.length < data.length,
	};
}

function normalizeMgnifyStudy(record: Record<string, unknown>): Record<string, unknown> {
	const accession = stringValue(record.accession);
	const biome = recordValue(record.biome);
	const metadata = recordValue(record.metadata);
	return {
		accession,
		title: stringValue(record.title),
		enaAccessions: arrayValue(record.ena_accessions).map(String).slice(0, 8),
		biomeName: stringValue(biome.biome_name),
		biomeLineage: stringValue(biome.lineage),
		updatedAt: stringValue(record.updated_at),
		studyAccession: stringValue(metadata.study_accession),
		secondaryStudyAccession: stringValue(metadata.secondary_study_accession),
		centerName: stringValue(metadata.center_name),
		description: stringValue(metadata.study_description),
		url: accession ? `https://www.ebi.ac.uk/metagenomics/studies/${encodeURIComponent(accession)}` : undefined,
	};
}

function normalizeMgnifyAnalysis(record: Record<string, unknown>): Record<string, unknown> {
	const run = recordValue(record.run);
	const sample = recordValue(record.sample);
	const assembly = recordValue(record.assembly);
	return {
		accession: stringValue(record.accession),
		studyAccession: stringValue(record.study_accession),
		experimentType: stringValue(record.experiment_type),
		pipelineVersion: stringValue(record.pipeline_version),
		runAccession: stringValue(run.accession),
		sampleAccession: stringValue(sample.accession),
		sampleTitle: stringValue(sample.sample_title),
		assemblyAccession: stringValue(assembly.accession),
	};
}

function normalizeGeoRecord(record: Record<string, unknown>): Record<string, unknown> {
	const accession = stringValue(record.accession) ?? stringValue(record.gse);
	return {
		uid: stringValue(record.uid),
		accession,
		title: stringValue(record.title),
		summary: stringValue(record.summary),
		seriesType: stringValue(record.gdstype),
		taxon: stringValue(record.taxon),
		sampleCount: numberValue(record.n_samples),
		publicationDate: stringValue(record.pdat),
		pubmedIds: arrayValue(record.pubmedids).map(String),
		samples: arrayValue(record.samples).map((sample) => {
			const item = recordValue(sample);
			return {
				accession: stringValue(item.accession),
				title: stringValue(item.title),
			};
		}),
		url: accession ? `https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=${encodeURIComponent(accession)}` : undefined,
	};
}

function normalizePrideProject(record: Record<string, unknown>): Record<string, unknown> {
	const accession = stringValue(record.accession);
	return {
		accession,
		title: stringValue(record.title),
		organisms: arrayValue(record.organisms).map((item) => typeof item === "string" ? item : stringValue(recordValue(item).name)).filter(Boolean),
		diseases: arrayValue(record.diseases).map((item) => typeof item === "string" ? item : stringValue(recordValue(item).name)).filter(Boolean),
		instruments: arrayValue(record.instruments).map((item) => typeof item === "string" ? item : stringValue(recordValue(item).name)).filter(Boolean),
		experimentTypes: arrayValue(record.experimentTypes).map((item) => typeof item === "string" ? item : stringValue(recordValue(item).name)).filter(Boolean),
		keywords: arrayValue(record.keywords).map(String).slice(0, 12),
		submissionDate: stringValue(record.submissionDate)?.slice(0, 10),
		publicationDate: stringValue(record.publicationDate)?.slice(0, 10),
		url: accession ? `https://www.ebi.ac.uk/pride/archive/projects/${encodeURIComponent(accession)}` : undefined,
	};
}

function normalizePrideProtein(record: Record<string, unknown>): Record<string, unknown> {
	return {
		proteinAccession: stringValue(record.proteinAccession),
		proteinName: stringValue(record.proteinName),
		gene: stringValue(record.gene),
		projectCount: numberValue(record.projectCount),
		projects: arrayValue(record.projects).map(String).sort(),
	};
}

async function arrayExpressExact(query: string, limit: number): Promise<Record<string, unknown> | undefined> {
	const match = query.match(/^(arrayexpress_(?:search_experiments|get_experiment_files|get_experiment_samples|get_experiment))\s*:?\s*(.*)$/i);
	if (!match) return undefined;
	const mode = match[1]!.toLowerCase();
	const rest = match[2]!.trim();
	const params = queryParamMap(rest);
	const bare = stripQueryParams(rest);
	const endpoints: string[] = [];
	if (mode === "arrayexpress_search_experiments") {
		const freeText = params.query ?? bare;
		const clauses = [freeText, params.organism && `organism:"${params.organism}"`, params.study_type && `"${params.study_type}"`, params.technology && `"${params.technology}"`, "collection:ArrayExpress"].filter(Boolean);
		const url = new URL(`${BIOSTUDIES_BASE}/search`);
		url.searchParams.set("query", clauses.join(" AND "));
		url.searchParams.set("pageSize", String(Math.min(Number(params.max_records) || limit, MAX_LIMIT)));
		url.searchParams.set("page", "1");
		const payload = recordValue(await fetchJson(url));
		endpoints.push(url.toString());
		const results = arrayValue(payload.hits).map((item) => normalizeArrayExpressRecord(recordValue(item)));
		return output("arrayexpress", query, mode, results, numberValue(payload.totalHits) ?? results.length, endpoints, ["https://www.ebi.ac.uk/biostudies/arrayexpress-in-biostudies", "https://www.ebi.ac.uk/biostudies/api/v1"]);
	}
	const accession = (params.accession ?? bare.split(/[\s,;]+/).find((part) => /^E-[A-Z]+-\d+$/i.test(part)) ?? bare).trim();
	if (!accession) throw new Error(`${mode} requires an ArrayExpress accession such as E-MTAB-5061.`);
	const url = new URL(`${BIOSTUDIES_BASE}/studies/${encodeURIComponent(accession.toUpperCase())}`);
	const payload = recordValue(await fetchJson(url));
	endpoints.push(url.toString());
	if (mode === "arrayexpress_get_experiment") return output("arrayexpress", query, mode, [normalizeArrayExpressDetail(payload)], 1, endpoints, ["https://www.ebi.ac.uk/biostudies/arrayexpress-in-biostudies", "https://www.ebi.ac.uk/biostudies/api/v1"], { accession: accession.toUpperCase() });
	const allRows = mode === "arrayexpress_get_experiment_files" ? collectArrayExpressFiles(payload) : collectArrayExpressSamples(payload);
	const rows = allRows.slice(0, Math.min(Number(params.max_rows_returned) || limit, MAX_LIMIT));
	return output("arrayexpress", query, mode, rows, allRows.length, endpoints, ["https://www.ebi.ac.uk/biostudies/arrayexpress-in-biostudies", "https://www.ebi.ac.uk/biostudies/api/v1"], { accession: accession.toUpperCase(), truncated: rows.length < allRows.length });
}

async function geoSummaryForIds(ids: string[], endpoints: string[]): Promise<Record<string, unknown>[]> {
	if (!ids.length) return [];
	const summaryUrl = new URL(`${GEO_EUTILS_BASE}/esummary.fcgi`);
	for (const [key, value] of Object.entries(ncbiIdentityParams())) summaryUrl.searchParams.set(key, value);
	summaryUrl.searchParams.set("db", "gds");
	summaryUrl.searchParams.set("id", ids.join(","));
	summaryUrl.searchParams.set("retmode", "json");
	summaryUrl.searchParams.set("version", "2.0");
	endpoints.push(summaryUrl.toString());
	const summaryPayload = recordValue(await fetchJson(summaryUrl));
	const summary = recordValue(summaryPayload.result);
	return arrayValue(summary.uids).map(String).filter(Boolean).map((id) => normalizeGeoRecord(recordValue(summary[id])));
}

async function geoExact(query: string, limit: number): Promise<Record<string, unknown> | undefined> {
	const match = query.match(/^(geo_(?:search_series|get_series))\s*:?\s*(.*)$/i);
	if (!match) return undefined;
	const mode = match[1]!.toLowerCase();
	const rest = match[2]!.trim();
	const params = queryParamMap(rest);
	const bare = stripQueryParams(rest);
	const endpoints: string[] = [];
	const searchUrl = new URL(`${GEO_EUTILS_BASE}/esearch.fcgi`);
	for (const [key, value] of Object.entries(ncbiIdentityParams())) searchUrl.searchParams.set(key, value);
	searchUrl.searchParams.set("db", "gds");
	searchUrl.searchParams.set("retmode", "json");
	if (mode === "geo_search_series") {
		const term = params.term ?? bare;
		if (!term) throw new Error("geo_search_series requires an E-utilities term.");
		searchUrl.searchParams.set("term", /\bgse\[ETYP\]/i.test(term) ? term : `${term} AND gse[ETYP]`);
		searchUrl.searchParams.set("retmax", String(Math.min(Number(params.retmax) || limit, MAX_LIMIT)));
	} else {
		const accessions = splitTerms(params.accessions ?? params.accession ?? bare).map((item) => item.toUpperCase()).filter((item) => /^GSE\d+$/i.test(item));
		if (!accessions.length) throw new Error("geo_get_series requires one or more GSE accessions.");
		searchUrl.searchParams.set("term", accessions.map((accession) => `${accession}[ACCN]`).join(" OR "));
		searchUrl.searchParams.set("retmax", String(Math.min(accessions.length, MAX_LIMIT)));
	}
	const searchPayload = recordValue(await fetchJson(searchUrl));
	endpoints.push(searchUrl.toString());
	const searchResult = recordValue(searchPayload.esearchresult);
	const ids = arrayValue(searchResult.idlist).map(String).filter(Boolean);
	const results = await geoSummaryForIds(ids, endpoints);
	return output("geo", query, mode, results, numberValue(searchResult.count) ?? results.length, endpoints, ["https://www.ncbi.nlm.nih.gov/books/NBK25500/", "https://www.ncbi.nlm.nih.gov/geo/info/geo_paccess.html"]);
}

async function metabolightsExact(query: string, limit: number): Promise<Record<string, unknown> | undefined> {
	const match = query.match(/^(metabolights_(?:list_studies|get_studies|get_study_files|search_data_files))\s*:?\s*(.*)$/i);
	if (!match) return undefined;
	const mode = match[1]!.toLowerCase();
	const rest = match[2]!.trim();
	const params = queryParamMap(rest);
	const bare = stripQueryParams(rest);
	const endpoints: string[] = [];
	if (mode === "metabolights_list_studies") {
		const url = new URL(`${METABOLIGHTS_BASE}/studies`);
		const payload = recordValue(await fetchJson(url));
		endpoints.push(url.toString());
		const accessions = arrayValue(payload.content).map(String).filter(Boolean).sort((a, b) => {
			const [aPrefix, aNumber] = accessionSortKey(a);
			const [bPrefix, bNumber] = accessionSortKey(b);
			return aPrefix === bPrefix ? aNumber - bNumber : aPrefix.localeCompare(bPrefix);
		});
		const results = accessions.slice(0, limit).map((accession) => ({ accession, url: `https://www.ebi.ac.uk/metabolights/${encodeURIComponent(accession)}` }));
		return output("metabolights", query, "studies", results, numberValue(payload.studies) ?? accessions.length, endpoints, ["https://www.ebi.ac.uk/metabolights/ws/api/spec.html", "https://www.ebi.ac.uk/metabolights/download"]);
	}
	if (mode === "metabolights_get_study_files") {
		const accession = metabolightsAccession(params.accession ?? bare);
		const url = new URL(`${METABOLIGHTS_BASE}/studies/${encodeURIComponent(accession)}/files`);
		url.searchParams.set("include_raw_data", "true");
		const payload = recordValue(await fetchJson(url));
		endpoints.push(url.toString());
		const results = arrayValue(payload.study).map((item) => normalizeMetaboLightsFile(recordValue(item))).slice(0, limit);
		return output("metabolights", query, "files", results, arrayValue(payload.study).length, endpoints, ["https://www.ebi.ac.uk/metabolights/ws/api/spec.html", "https://www.ebi.ac.uk/metabolights/download"], { accession });
	}
	if (mode === "metabolights_search_data_files") {
		const accession = metabolightsAccession(params.accession ?? bare.split(/\s+/)[0] ?? "");
		const url = new URL(`${METABOLIGHTS_BASE}/studies/${encodeURIComponent(accession)}/public-data-files`);
		url.searchParams.set("file_match", "true");
		url.searchParams.set("folder_match", "false");
		if (params.pattern) url.searchParams.set("search_pattern", params.pattern);
		const payload = recordValue(await fetchJson(url));
		endpoints.push(url.toString());
		const files = arrayValue(payload.files).map((item) => stringValue(recordValue(item).name ?? item)).filter(Boolean).sort();
		return output("metabolights", query, "data-files", files.slice(0, limit).map((file) => ({ file })), files.length, endpoints, ["https://www.ebi.ac.uk/metabolights/ws/api/spec.html", "https://www.ebi.ac.uk/metabolights/download"], { accession, pattern: params.pattern });
	}
	const accessions = splitTerms(params.accessions ?? params.accession ?? bare).map((item) => metabolightsAccession(item));
	const includeSamples = boolValue(params.include_samples, false);
	const maxSampleRows = Math.min(Number(params.max_sample_rows_returned) || limit, MAX_LIMIT);
	const results: Record<string, unknown>[] = [];
	for (const accession of [...new Set(accessions)].sort((a, b) => {
		const [aPrefix, aNumber] = accessionSortKey(a);
		const [bPrefix, bNumber] = accessionSortKey(b);
		return aPrefix === bPrefix ? aNumber - bNumber : aPrefix.localeCompare(bPrefix);
	}).slice(0, limit)) {
		const url = new URL(`${METABOLIGHTS_BASE}/studies/public/study/${encodeURIComponent(accession)}`);
		const payload = recordValue(await fetchJson(url));
		endpoints.push(url.toString());
		const content = recordValue(payload.content);
		results.push({
			...normalizeMetaboLightsStudy(payload),
			protocols: arrayValue(content.protocols).map((item) => {
				const record = recordValue(item);
				return { name: stringValue(record.name), description: stringValue(record.description) };
			}).filter((item) => item.name || item.description),
			...(includeSamples ? { sampleTable: normalizeMetaboLightsSampleTable(content.sampleTable, maxSampleRows) } : {}),
		});
	}
	return output("metabolights", query, mode, results, accessions.length, endpoints, ["https://www.ebi.ac.uk/metabolights/ws/api/spec.html", "https://www.ebi.ac.uk/metabolights/download"]);
}

async function fetchMgnifyAnalyses(accession: string, limit: number, endpoints: string[]): Promise<{ count: number; rows: Record<string, unknown>[] }> {
	const url = new URL(`${MGNIFY_BASE}/studies/${encodeURIComponent(accession)}/analyses`);
	url.searchParams.set("page_size", String(limit));
	url.searchParams.set("page", "1");
	const payload = recordValue(await fetchJson(url));
	endpoints.push(url.toString());
	const rows = arrayValue(payload.items).map((item) => normalizeMgnifyAnalysis(recordValue(item)));
	return { count: numberValue(payload.count) ?? rows.length, rows };
}

async function mgnifyExact(query: string, limit: number): Promise<Record<string, unknown> | undefined> {
	const match = query.match(/^(mgnify_(?:search_studies|get_studies|get_study_analyses))\s*:?\s*(.*)$/i);
	if (!match) return undefined;
	const mode = match[1]!.toLowerCase();
	const rest = match[2]!.trim();
	const params = queryParamMap(rest);
	const bare = stripQueryParams(rest);
	const endpoints: string[] = [];
	if (mode === "mgnify_search_studies") {
		const search = params.query ?? bare;
		const biome = params.biome_lineage;
		if (!search && !biome) throw new Error("mgnify_search_studies requires query=<text> or biome_lineage=<lineage>.");
		const url = new URL(`${MGNIFY_BASE}/studies`);
		if (search) url.searchParams.set("search", search);
		if (biome) url.searchParams.set("biome_lineage", biome);
		url.searchParams.set("page_size", String(limit));
		url.searchParams.set("page", "1");
		const payload = recordValue(await fetchJson(url));
		endpoints.push(url.toString());
		const results = arrayValue(payload.items).map((item) => normalizeMgnifyStudy(recordValue(item)));
		return output("mgnify", query, mode, results, numberValue(payload.count) ?? results.length, endpoints, "https://docs.mgnify.org/src/docs/api.html");
	}
	const accessions = splitTerms(params.accessions ?? params.accession ?? bare).map((item) => item.toUpperCase());
	if (!accessions.length) throw new Error(`${mode} requires one or more MGYS accessions.`);
	if (mode === "mgnify_get_study_analyses") {
		const accession = accessions[0]!;
		const analyses = await fetchMgnifyAnalyses(accession, limit, endpoints);
		return output("mgnify", query, mode, analyses.rows, analyses.count, endpoints, "https://docs.mgnify.org/src/docs/api.html", { accession });
	}
	const includeAnalyses = boolValue(params.include_analyses, false);
	const results: Record<string, unknown>[] = [];
	for (const accession of [...new Set(accessions)].slice(0, limit)) {
		const url = new URL(`${MGNIFY_BASE}/studies/${encodeURIComponent(accession)}`);
		const study = normalizeMgnifyStudy(recordValue(await fetchJson(url)));
		endpoints.push(url.toString());
		if (includeAnalyses) {
			const analyses = await fetchMgnifyAnalyses(accession, limit, endpoints);
			results.push({ ...study, analysesCount: analyses.count, analyses: analyses.rows });
		} else {
			results.push(study);
		}
	}
	return output("mgnify", query, mode, results, accessions.length, endpoints, "https://docs.mgnify.org/src/docs/api.html");
}

async function prideExact(query: string, limit: number): Promise<Record<string, unknown> | undefined> {
	const match = query.match(/^(pride_(?:search_projects|get_projects|search_project_proteins|find_projects_for_protein))\s*:?\s*(.*)$/i);
	if (!match) return undefined;
	const mode = match[1]!.toLowerCase();
	const rest = match[2]!.trim();
	const params = queryParamMap(rest);
	const bare = stripQueryParams(rest);
	const endpoints: string[] = [];
	const docs = ["https://www.ebi.ac.uk/pride/markdownpage/prideapi", "https://www.ebi.ac.uk/pride/ws/archive/v2/swagger-ui/index.html"];
	if (mode === "pride_search_projects") {
		const url = new URL(`${PRIDE_BASE}/search/projects`);
		const keyword = params.keyword ?? bare;
		if (keyword) url.searchParams.set("keyword", keyword);
		const filters = [params.organism && `organisms==${params.organism}`, params.instrument && `instruments==${params.instrument}`, params.disease && `diseases==${params.disease}`].filter(Boolean);
		if (filters.length) url.searchParams.set("filter", filters.join(","));
		url.searchParams.set("pageSize", String(Math.min(Number(params.max_records_returned) || limit, MAX_LIMIT)));
		url.searchParams.set("sortFields", "accession");
		url.searchParams.set("sortDirection", "ASC");
		url.searchParams.set("page", "0");
		const { headers, payload } = await fetchJsonWithHeaders(url);
		endpoints.push(url.toString());
		const results = arrayValue(payload).map((item) => normalizePrideProject(recordValue(item)));
		return output("pride", query, mode, results, numberValue(headers.get("total_records")) ?? results.length, endpoints, docs);
	}
	if (mode === "pride_get_projects") {
		const accessions = splitTerms(params.accessions ?? params.accession ?? bare).map((item) => item.toUpperCase()).filter(Boolean);
		const results: Record<string, unknown>[] = [];
		for (const accession of [...new Set(accessions)].slice(0, limit)) {
			const url = new URL(`${PRIDE_BASE}/projects/${encodeURIComponent(accession)}`);
			results.push(normalizePrideProject(recordValue(await fetchJson(url))));
			endpoints.push(url.toString());
		}
		return output("pride", query, mode, results, accessions.length, endpoints, docs);
	}
	if (mode === "pride_search_project_proteins") {
		const projectAccession = (params.project_accession ?? params.accession ?? bare.split(/\s+/)[0] ?? "").toUpperCase();
		const url = new URL(`${PRIDE_BASE}/pride-ap/search/proteins`);
		url.searchParams.set("projectAccession", projectAccession);
		url.searchParams.set("pageSize", String(limit));
		url.searchParams.set("page", "0");
		if (params.keyword) url.searchParams.set("keyword", params.keyword);
		const payload = await fetchJson(url);
		endpoints.push(url.toString());
		const results = arrayValue(payload).map((item) => normalizePrideProtein(recordValue(item)));
		return output("pride", query, mode, results, results.length, endpoints, docs, { projectAccession });
	}
	const proteinAccession = (params.protein_accession ?? params.accession ?? bare.split(/\s+/)[0] ?? "").toUpperCase();
	const url = new URL(`${PRIDE_BASE}/proteins/search`);
	url.searchParams.set("accession", proteinAccession);
	const payload = await fetchJson(url);
	endpoints.push(url.toString());
	const results = arrayValue(payload).map((item) => normalizePrideProtein(recordValue(item)));
	return output("pride", query, mode, results, results.length, endpoints, docs, { proteinAccession });
}

function output(source: string, query: string, mode: string, results: Record<string, unknown>[], totalCount: number, endpoints: string[], docs: string | string[], extra?: Record<string, unknown>): Record<string, unknown> {
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source,
		query,
		mode,
		...(extra ?? {}),
		totalCount,
		returned: results.length,
		results,
		provenance: {
			docs,
			endpoints,
		},
	};
}

export async function searchOmicsArchiveExact(params: SearchParams): Promise<Record<string, unknown> | undefined> {
	const limit = safeLimit(params.limit);
	if (params.source === "arrayexpress") return arrayExpressExact(params.query, limit);
	if (params.source === "geo") return geoExact(params.query, limit);
	if (params.source === "metabolights") return metabolightsExact(params.query, limit);
	if (params.source === "mgnify") return mgnifyExact(params.query, limit);
	if (params.source === "pride") return prideExact(params.query, limit);
	return undefined;
}
