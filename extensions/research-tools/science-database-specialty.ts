import { isVariantScienceDatabaseSource, searchVariantScienceDatabase, type VariantScienceDatabaseSource } from "./science-database-variants.js";
import { isBiomartScienceDatabaseSource, searchBiomart, type BiomartScienceDatabaseSource } from "./science-database-biomart.js";
import { searchCbioportal } from "./science-database-cbioportal.js";
import { searchCivic } from "./science-database-civic.js";
import { searchClingen } from "./science-database-clingen.js";
import { searchCosmic } from "./science-database-cosmic.js";
import { searchDepmap } from "./science-database-depmap.js";
import { isEbiStructuralScienceDatabaseSource, searchEbiStructuralScienceDatabase, type EbiStructuralScienceDatabaseSource } from "./science-database-ebi-structural.js";
import { searchGnomad } from "./science-database-gnomad.js";
import { searchGtex } from "./science-database-gtex.js";
import { isLongTailScienceDatabaseSource, searchLongTailScienceDatabase, type LongTailScienceDatabaseSource } from "./science-database-longtail.js";
import { searchOpenTargets } from "./science-database-open-targets.js";
import { isPhewebScienceDatabaseSource, searchPheweb, type PhewebScienceDatabaseSource } from "./science-database-pheweb.js";
import { isPublicAtlasScienceDatabaseSource, searchPublicAtlasScienceDatabase, type PublicAtlasScienceDatabaseSource } from "./science-database-public-atlases.js";
import { isReferenceParityScienceDatabaseSource, searchReferenceParityScienceDatabase, type ReferenceParityScienceDatabaseSource } from "./science-database-reference-parity.js";
import { isResearchResourceScienceDatabaseSource, searchResearchResourceScienceDatabase, type ResearchResourceScienceDatabaseSource } from "./science-database-research-resources.js";
import { isUcscScienceDatabaseSource, searchUcsc, type UcscScienceDatabaseSource } from "./science-database-ucsc.js";
import { isUniBindScienceDatabaseSource, searchUniBind, type UniBindScienceDatabaseSource } from "./science-database-unibind.js";
import { isZincScienceDatabaseSource, searchZinc, type ZincScienceDatabaseSource } from "./science-database-zinc.js";
import { withNcbiRateLimit } from "./ncbi-rate-limit.js";

type SearchParams = { limit?: number; query: string; source: SpecialtyScienceDatabaseSource };

export type SpecialtyScienceDatabaseSource = BiomartScienceDatabaseSource | EbiStructuralScienceDatabaseSource | LongTailScienceDatabaseSource | PhewebScienceDatabaseSource | PublicAtlasScienceDatabaseSource | ReferenceParityScienceDatabaseSource | ResearchResourceScienceDatabaseSource | UcscScienceDatabaseSource | UniBindScienceDatabaseSource | VariantScienceDatabaseSource | ZincScienceDatabaseSource | "cbioportal" | "civic" | "clingen" | "cosmic" | "depmap" | "encode" | "geo" | "gnomad" | "gtex" | "interpro" | "ols" | "opentargets" | "pride" | "quickgo" | "reactome";

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;
const REQUEST_TIMEOUT_MS = 25_000;
const ENCODE_BASE = "https://www.encodeproject.org";
const GEO_EUTILS_BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
const INTERPRO_BASE = "https://www.ebi.ac.uk/interpro/api";
const OLS_BASE = "https://www.ebi.ac.uk/ols4/api";
const PRIDE_BASE = "https://www.ebi.ac.uk/pride/ws/archive/v2";
const QUICKGO_BASE = "https://www.ebi.ac.uk/QuickGO/services";
const REACTOME_ANALYSIS_BASE = "https://reactome.org/AnalysisService";

const SPECIALTY_SOURCES = new Set<SpecialtyScienceDatabaseSource>(["cbioportal", "civic", "clingen", "cosmic", "depmap", "encode", "geo", "gnomad", "gtex", "interpro", "ols", "opentargets", "pride", "quickgo", "reactome"]);

export function isSpecialtyScienceDatabaseSource(source: string): source is SpecialtyScienceDatabaseSource {
	return isBiomartScienceDatabaseSource(source) || isEbiStructuralScienceDatabaseSource(source) || isLongTailScienceDatabaseSource(source) || isPhewebScienceDatabaseSource(source) || isPublicAtlasScienceDatabaseSource(source) || isReferenceParityScienceDatabaseSource(source) || isResearchResourceScienceDatabaseSource(source) || isUcscScienceDatabaseSource(source) || isUniBindScienceDatabaseSource(source) || isVariantScienceDatabaseSource(source) || isZincScienceDatabaseSource(source) || SPECIALTY_SOURCES.has(source as SpecialtyScienceDatabaseSource);
}

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

function safeLimit(value: number | undefined): number {
	if (!Number.isFinite(value) || value === undefined) return DEFAULT_LIMIT;
	return Math.max(1, Math.min(Math.floor(value), MAX_LIMIT));
}

function cleanQuery(query: string): string {
	const clean = query.trim();
	if (!clean) throw new Error("Science database search requires a non-empty query.");
	return clean;
}

function queryParamMap(text: string): Record<string, string> {
	const params: Record<string, string> = {};
	for (const match of text.matchAll(/\b([a-z][a-z0-9_-]*)\s*=\s*("[^"]+"|'[^']+'|[^\s;]+)/gi)) {
		const key = match[1]?.toLowerCase();
		const raw = match[2]?.trim();
		if (!key || !raw) continue;
		params[key] = raw.replace(/^["']|["']$/g, "").replace(/_/g, " ");
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

function parseBool(value: string | undefined, fallback = false): boolean {
	if (!value) return fallback;
	return /^(?:1|true|yes|y)$/i.test(value);
}

function parseInteger(value: string | undefined, fallback: number): number {
	if (!value || !Number.isFinite(Number(value))) return fallback;
	return Math.max(1, Math.floor(Number(value)));
}

function ncbiIdentityParams(): Record<string, string> {
	const email = process.env.NCBI_EMAIL?.trim();
	return {
		tool: "feynman",
		...(email ? { email } : {}),
	};
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
				...(init?.headers ?? {}),
			},
			signal: controller.signal,
		});
		if (!response.ok) {
			throw new Error(`Science database request failed: ${response.status} ${response.statusText}`);
		}
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
				...(init?.headers ?? {}),
			},
			signal: controller.signal,
		});
		if (!response.ok) {
			throw new Error(`Science database request failed: ${response.status} ${response.statusText}`);
		}
		return { headers: response.headers, payload: await response.json() };
	} finally {
		clearTimeout(timeout);
	}
}

function doiUrl(doi: string | undefined): string | undefined {
	return doi ? `https://doi.org/${doi}` : undefined;
}

function encodeObjectUrl(pathOrId: string | undefined): string | undefined {
	if (!pathOrId) return undefined;
	if (pathOrId.startsWith("http")) return pathOrId;
	return `${ENCODE_BASE}${pathOrId.startsWith("/") ? pathOrId : `/${pathOrId}/`}`;
}

function normalizeEncodeExperiment(record: Record<string, unknown>): Record<string, unknown> {
	const accession = stringValue(record.accession) ?? stringValue(record["@id"]);
	const target = recordValue(record.target);
	const biosample = recordValue(record.biosample_ontology);
	const lab = recordValue(record.lab);
	return {
		accession,
		status: stringValue(record.status),
		assayTitle: stringValue(record.assay_title),
		assayTermName: stringValue(record.assay_term_name),
		targetLabel: stringValue(target.label),
		biosampleTermName: stringValue(biosample.term_name),
		biosampleClassification: stringValue(biosample.classification),
		description: stringValue(record.description),
		lab: stringValue(lab.title),
		dateReleased: stringValue(record.date_released),
		url: encodeObjectUrl(stringValue(record["@id"]) ?? accession),
	};
}

async function searchEncode(params: SearchParams): Promise<Record<string, unknown>> {
	const query = cleanQuery(params.query);
	const limit = safeLimit(params.limit);
	const url = new URL(`${ENCODE_BASE}/search/`);
	url.searchParams.set("type", "Experiment");
	url.searchParams.set("status", "released");
	url.searchParams.set("searchTerm", query);
	url.searchParams.set("format", "json");
	url.searchParams.set("limit", String(limit));
	const payload = recordValue(await fetchJson(url));
	const results = arrayValue(payload["@graph"]).map((item) => normalizeEncodeExperiment(recordValue(item)));
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "encode",
		query,
		totalCount: numberValue(payload.total) ?? results.length,
		returned: results.length,
		results,
		provenance: {
			docs: "https://www.encodeproject.org/help/rest-api/",
			endpoints: [url.toString()],
		},
	};
}

function normalizeGeoRecord(record: Record<string, unknown>): Record<string, unknown> {
	const accession = stringValue(record.accession) ?? stringValue(record.gse);
	const samples = arrayValue(record.samples).map((sample) => {
		const item = recordValue(sample);
		return {
			accession: stringValue(item.accession),
			title: stringValue(item.title),
		};
	});
	return {
		uid: stringValue(record.uid),
		accession,
		title: stringValue(record.title),
		summary: stringValue(record.summary),
		seriesType: stringValue(record.gdstype),
		taxon: stringValue(record.taxon),
		sampleCount: numberValue(record.n_samples),
		publicationDate: stringValue(record.pdat),
		bioproject: stringValue(record.bioproject),
		platform: stringValue(record.gpl),
		pubmedIds: arrayValue(record.pubmedids).map(String),
		samples,
		url: accession ? `https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=${encodeURIComponent(accession)}` : undefined,
	};
}

async function searchGeo(params: SearchParams): Promise<Record<string, unknown>> {
	const query = cleanQuery(params.query);
	const limit = safeLimit(params.limit);
	const term = /^GSE\d+$/i.test(query) ? `${query}[ACCN] AND gse[ETYP]` : `${query} AND gse[ETYP]`;
	const searchUrl = new URL(`${GEO_EUTILS_BASE}/esearch.fcgi`);
	for (const [key, value] of Object.entries(ncbiIdentityParams())) searchUrl.searchParams.set(key, value);
	searchUrl.searchParams.set("db", "gds");
	searchUrl.searchParams.set("term", term);
	searchUrl.searchParams.set("retmode", "json");
	searchUrl.searchParams.set("retmax", String(limit));
	const searchPayload = recordValue(await fetchJson(searchUrl));
	const searchResult = recordValue(searchPayload.esearchresult);
	const ids = arrayValue(searchResult.idlist).map(String).filter(Boolean);
	const endpoints = [searchUrl.toString()];
	let results: Record<string, unknown>[] = [];
	if (ids.length) {
		const summaryUrl = new URL(`${GEO_EUTILS_BASE}/esummary.fcgi`);
		for (const [key, value] of Object.entries(ncbiIdentityParams())) summaryUrl.searchParams.set(key, value);
		summaryUrl.searchParams.set("db", "gds");
		summaryUrl.searchParams.set("id", ids.join(","));
		summaryUrl.searchParams.set("retmode", "json");
		summaryUrl.searchParams.set("version", "2.0");
		endpoints.push(summaryUrl.toString());
		const summaryPayload = recordValue(await fetchJson(summaryUrl));
		const summary = recordValue(summaryPayload.result);
		const ordered = arrayValue(summary.uids).map(String).filter(Boolean);
		results = ordered.map((id) => normalizeGeoRecord(recordValue(summary[id])));
	}
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "geo",
		query,
		totalCount: numberValue(searchResult.count) ?? results.length,
		returned: results.length,
		results,
		provenance: {
			docs: ["https://www.ncbi.nlm.nih.gov/books/NBK25500/", "https://www.ncbi.nlm.nih.gov/geo/info/geo_paccess.html"],
			endpoints,
		},
	};
}

function normalizeInterproEntry(record: Record<string, unknown>): Record<string, unknown> {
	const metadata = recordValue(record.metadata);
	const accession = stringValue(metadata.accession);
	const memberDatabases = recordValue(metadata.member_databases);
	return {
		accession,
		name: stringValue(metadata.name),
		type: stringValue(metadata.type),
		sourceDatabase: stringValue(metadata.source_database),
		integrated: stringValue(metadata.integrated),
		goTerms: arrayValue(metadata.go_terms).map((term) => {
			const item = recordValue(term);
			return {
				identifier: stringValue(item.identifier),
				name: stringValue(item.name),
			};
		}),
		memberDatabaseCount: Object.keys(memberDatabases).length || undefined,
		url: accession ? `https://www.ebi.ac.uk/interpro/entry/InterPro/${encodeURIComponent(accession)}/` : undefined,
	};
}

async function searchInterpro(params: SearchParams): Promise<Record<string, unknown>> {
	const query = cleanQuery(params.query);
	const limit = safeLimit(params.limit);
	const url = new URL(`${INTERPRO_BASE}/entry/interpro/`);
	url.searchParams.set("search", query);
	url.searchParams.set("page_size", String(limit));
	const payload = recordValue(await fetchJson(url));
	const results = arrayValue(payload.results).map((item) => normalizeInterproEntry(recordValue(item)));
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "interpro",
		query,
		totalCount: numberValue(payload.count) ?? results.length,
		returned: results.length,
		results,
		provenance: {
			docs: "https://www.ebi.ac.uk/interpro/api/",
			endpoints: [url.toString()],
		},
	};
}

function normalizeOlsTerm(record: Record<string, unknown>): Record<string, unknown> {
	const curie = stringValue(record.obo_id) ?? stringValue(record.short_form);
	const iri = stringValue(record.iri);
	return {
		curie,
		iri,
		label: stringValue(record.label),
		ontology: stringValue(record.ontology_name),
		shortForm: stringValue(record.short_form),
		description: arrayValue(record.description).map(String).slice(0, 3),
		synonyms: arrayValue(record.synonyms).map(String).slice(0, 8),
		isObsolete: Boolean(record.is_obsolete),
		hasChildren: Boolean(record.has_children),
		url: iri ? `${OLS_BASE}/ontologies/${encodeURIComponent(stringValue(record.ontology_name) ?? "")}/terms/${encodeURIComponent(encodeURIComponent(iri))}` : undefined,
	};
}

function normalizeOlsOntology(record: Record<string, unknown>): Record<string, unknown> {
	const ontologyId = stringValue(record.ontologyId) ?? stringValue(record.ontology_id) ?? stringValue(record.ontologyName) ?? stringValue(record.config);
	return {
		ontologyId,
		title: stringValue(record.title),
		description: stringValue(record.description),
		status: stringValue(record.status),
		numberOfTerms: numberValue(record.numberOfTerms),
		loaded: stringValue(record.loaded),
		version: stringValue(record.version),
		url: ontologyId ? `https://www.ebi.ac.uk/ols4/ontologies/${encodeURIComponent(ontologyId)}` : undefined,
	};
}

function olsTermIri(termId: string): string {
	if (/^https?:\/\//i.test(termId)) return termId;
	const clean = termId.replace(/^obo:/i, "").replace(":", "_");
	return `http://purl.obolibrary.org/obo/${clean}`;
}

async function listOlsOntologies(query: string, limit: number): Promise<Record<string, unknown>> {
	const rest = query.replace(/^list_ontologies\s*:?\s*/i, "").trim();
	const ids = rest ? splitTerms(stripQueryParams(rest)).map((item) => item.toLowerCase()) : [];
	const endpoints: string[] = [];
	let results: Record<string, unknown>[] = [];
	if (ids.length) {
		for (const id of ids.slice(0, limit)) {
			const url = new URL(`${OLS_BASE}/ontologies/${encodeURIComponent(id)}`);
			endpoints.push(url.toString());
			results.push(normalizeOlsOntology(recordValue(await fetchJson(url))));
		}
	} else {
		const url = new URL(`${OLS_BASE}/ontologies`);
		url.searchParams.set("size", String(limit));
		url.searchParams.set("page", "0");
		endpoints.push(url.toString());
		const payload = recordValue(await fetchJson(url));
		results = arrayValue(recordValue(payload._embedded).ontologies).map((item) => normalizeOlsOntology(recordValue(item))).slice(0, limit);
	}
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "ols",
		query,
		searchMode: "list-ontologies",
		ontologyIds: ids,
		totalCount: results.length,
		returned: results.length,
		results,
		provenance: {
			docs: ["https://www.ebi.ac.uk/ols4/", "https://github.com/EBISPOT/ols4"],
			endpoints,
		},
	};
}

async function getOlsTerm(query: string, limit: number): Promise<Record<string, unknown>> {
	const rest = query.replace(/^get_ontology_term\s*:?\s*/i, "").trim();
	const params = queryParamMap(rest);
	const tokens = stripQueryParams(rest).split(/[\s,;]+/).filter(Boolean);
	const ontology = (params.ontology ?? tokens[0] ?? "").toLowerCase();
	const termId = params.term_id ?? params.term ?? tokens[1];
	if (!ontology || !termId) throw new Error("get_ontology_term requires ontology and term_id.");
	const iri = olsTermIri(termId);
	const encoded = encodeURIComponent(encodeURIComponent(iri));
	const relation = (params.relation ?? "").trim();
	const url = new URL(`${OLS_BASE}/ontologies/${encodeURIComponent(ontology)}/terms/${encoded}${relation ? `/${encodeURIComponent(relation)}` : ""}`);
	const payload = recordValue(await fetchJson(url));
	const relationTerms = arrayValue(recordValue(payload._embedded).terms).map((item) => normalizeOlsTerm(recordValue(item))).slice(0, limit);
	const result = relation ? { relation, terms: relationTerms } : normalizeOlsTerm(payload);
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "ols",
		query,
		searchMode: "get-ontology-term",
		ontology,
		termId,
		iri,
		relation: relation || undefined,
		returned: relation ? relationTerms.length : 1,
		results: [result],
		provenance: {
			docs: ["https://www.ebi.ac.uk/ols4/", "https://github.com/EBISPOT/ols4"],
			endpoints: [url.toString()],
		},
	};
}

async function searchOls(params: SearchParams): Promise<Record<string, unknown>> {
	const query = cleanQuery(params.query);
	const limit = safeLimit(params.limit);
	if (/^list_ontologies\b/i.test(query)) return listOlsOntologies(query, limit);
	if (/^get_ontology_term\b/i.test(query)) return getOlsTerm(query, limit);
	const namedSearch = /^search_ontology_terms\s*:?\s*/i.test(query);
	const searchRest = namedSearch ? query.replace(/^search_ontology_terms\s*:?\s*/i, "") : query;
	const searchParams = queryParamMap(searchRest);
	const url = new URL(`${OLS_BASE}/search`);
	url.searchParams.set("q", stripQueryParams(searchRest) || query);
	url.searchParams.set("rows", String(limit));
	url.searchParams.set("start", "0");
	if (searchParams.ontologies) url.searchParams.set("ontology", searchParams.ontologies.replace(/\s*,\s*/g, ","));
	if (searchParams.exact) url.searchParams.set("exact", parseBool(searchParams.exact) ? "true" : "false");
	if (searchParams.include_obsolete) url.searchParams.set("includeObsolete", parseBool(searchParams.include_obsolete) ? "true" : "false");
	const payload = recordValue(await fetchJson(url));
	const response = recordValue(payload.response);
	const results = arrayValue(response.docs).map((item) => normalizeOlsTerm(recordValue(item)));
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "ols",
		query,
		...(namedSearch ? { searchMode: "search-ontology-terms" } : {}),
		totalCount: numberValue(response.numFound) ?? results.length,
		returned: results.length,
		results,
		provenance: {
			docs: "https://www.ebi.ac.uk/ols4/api/",
			endpoints: [url.toString()],
		},
	};
}

function normalizePrideProject(record: Record<string, unknown>): Record<string, unknown> {
	const accession = stringValue(record.accession);
	const references = arrayValue(record.references).map((reference) => {
		const item = recordValue(reference);
		const text = typeof reference === "string" ? reference : stringValue(item.referenceLine);
		return {
			pubmedId: numberValue(item.pubmedID),
			doi: stringValue(item.doi),
			referenceLine: text,
		};
	});
	return {
		accession,
		title: stringValue(record.title),
		organisms: arrayValue(record.organisms).map(String).slice(0, 8),
		diseases: arrayValue(record.diseases).map(String).slice(0, 8),
		instruments: arrayValue(record.instruments).map(String).slice(0, 8),
		experimentTypes: arrayValue(record.experimentTypes).map(String).slice(0, 8),
		keywords: arrayValue(record.keywords).map(String).slice(0, 12),
		submissionDate: stringValue(record.submissionDate)?.slice(0, 10),
		publicationDate: stringValue(record.publicationDate)?.slice(0, 10),
		references,
		url: accession ? `https://www.ebi.ac.uk/pride/archive/projects/${encodeURIComponent(accession)}` : undefined,
	};
}

async function searchPride(params: SearchParams): Promise<Record<string, unknown>> {
	const query = cleanQuery(params.query);
	const limit = safeLimit(params.limit);
	const url = new URL(`${PRIDE_BASE}/search/projects`);
	url.searchParams.set("keyword", query);
	url.searchParams.set("pageSize", String(limit));
	url.searchParams.set("sortFields", "accession");
	url.searchParams.set("sortDirection", "ASC");
	url.searchParams.set("page", "0");
	const { headers, payload } = await fetchJsonWithHeaders(url);
	const results = arrayValue(payload).map((item) => normalizePrideProject(recordValue(item)));
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "pride",
		query,
		totalCount: numberValue(headers.get("total_records")) ?? results.length,
		returned: results.length,
		results,
		provenance: {
			docs: "https://www.ebi.ac.uk/pride/ws/archive/v2/swagger-ui/index.html",
			endpoints: [url.toString()],
		},
	};
}

function quickGoAccession(query: string): string {
	return query.replace(/^get_go_annotations\s*:?\s*/i, "").replace(/^UniProtKB:/i, "").trim();
}

function normalizeQuickGoAnnotation(record: Record<string, unknown>): Record<string, unknown> {
	const goId = stringValue(record.goId);
	const geneProductId = stringValue(record.geneProductId);
	return {
		geneProductId,
		symbol: stringValue(record.symbol),
		goId,
		goName: stringValue(record.goName),
		goAspect: stringValue(record.goAspect),
		evidenceCode: stringValue(record.evidenceCode),
		goEvidence: stringValue(record.goEvidence),
		reference: stringValue(record.reference),
		withFrom: arrayValue(record.withFrom).map(String),
		taxonId: numberValue(record.taxonId),
		assignedBy: stringValue(record.assignedBy),
		date: stringValue(record.date),
		url: goId ? `https://www.ebi.ac.uk/QuickGO/term/${encodeURIComponent(goId)}` : undefined,
	};
}

async function searchQuickGo(params: SearchParams): Promise<Record<string, unknown>> {
	const query = cleanQuery(params.query);
	const limit = safeLimit(params.limit);
	const named = /^get_go_annotations\b/i.test(query);
	const rest = named ? query.replace(/^get_go_annotations\s*:?\s*/i, "") : query;
	const queryParams = queryParamMap(rest);
	const accession = quickGoAccession(stripQueryParams(rest));
	if (!accession) throw new Error("QuickGO search requires a UniProt accession.");
	const url = new URL(`${QUICKGO_BASE}/annotation/search`);
	url.searchParams.set("geneProductId", `UniProtKB:${accession}`);
	url.searchParams.set("limit", String(Math.min(parseInteger(queryParams.max_records, limit), MAX_LIMIT)));
	url.searchParams.set("page", "1");
	if (queryParams.aspect) url.searchParams.set("goAspect", queryParams.aspect);
	if (queryParams.evidence) url.searchParams.set("evidenceCode", queryParams.evidence);
	if (queryParams.taxon_id) url.searchParams.set("taxonId", queryParams.taxon_id);
	const payload = recordValue(await fetchJson(url));
	const results = arrayValue(payload.results).map((item) => normalizeQuickGoAnnotation(recordValue(item)));
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "quickgo",
		query,
		...(named ? { searchMode: "get-go-annotations" } : {}),
		accession,
		totalCount: numberValue(payload.numberOfHits) ?? results.length,
		returned: results.length,
		results,
		provenance: {
			docs: "https://www.ebi.ac.uk/QuickGO/api/index.html",
			endpoints: [url.toString()],
		},
	};
}

function reactomeIdentifiers(query: string): string[] {
	return query
		.split(/[\s,;]+/)
		.map((part) => part.trim())
		.filter(Boolean)
		.slice(0, MAX_LIMIT);
}

function parseReactomeQuery(query: string): { compact: boolean; identifiers: string[]; includeDisease: boolean; resource: string; species?: string } {
	const named = /^map_reactome_pathways\b/i.test(query);
	const rest = named ? query.replace(/^map_reactome_pathways\s*:?\s*/i, "") : query;
	const params = queryParamMap(rest);
	return {
		compact: parseBool(params.compact, true),
		identifiers: reactomeIdentifiers(stripQueryParams(rest)),
		includeDisease: parseBool(params.include_disease, true),
		resource: params.resource ?? "TOTAL",
		species: params.species,
	};
}

function normalizeReactomePathway(record: Record<string, unknown>): Record<string, unknown> {
	const species = recordValue(record.species);
	const entities = recordValue(record.entities);
	const reactions = recordValue(record.reactions);
	const stableId = stringValue(record.stId);
	return {
		stableId,
		dbId: numberValue(record.dbId),
		name: stringValue(record.name),
		species: stringValue(species.name),
		taxId: numberValue(species.taxId),
		lowLevelPathway: Boolean(record.llp),
		inDisease: Boolean(record.inDisease),
		entitiesFound: numberValue(entities.found),
		entitiesTotal: numberValue(entities.total),
		entitiesPValue: numberValue(entities.pValue),
		entitiesFdr: numberValue(entities.fdr),
		reactionsFound: numberValue(reactions.found),
		reactionsTotal: numberValue(reactions.total),
		url: stableId ? `https://reactome.org/content/detail/${encodeURIComponent(stableId)}` : undefined,
	};
}

async function searchReactome(params: SearchParams): Promise<Record<string, unknown>> {
	const query = cleanQuery(params.query);
	const limit = safeLimit(params.limit);
	const named = /^map_reactome_pathways\b/i.test(query);
	const parsed = parseReactomeQuery(query);
	const identifiers = parsed.identifiers;
	if (!identifiers.length) throw new Error("Reactome search requires one or more identifiers.");
	const url = new URL(`${REACTOME_ANALYSIS_BASE}/identifiers/`);
	url.searchParams.set("interactors", "false");
	url.searchParams.set("includeDisease", parsed.includeDisease ? "true" : "false");
	url.searchParams.set("pageSize", String(limit));
	url.searchParams.set("page", "1");
	url.searchParams.set("sortBy", "ENTITIES_PVALUE");
	url.searchParams.set("order", "ASC");
	url.searchParams.set("resource", parsed.resource);
	url.searchParams.set("pValue", "1");
	const payload = recordValue(await fetchJson(url, {
		body: `#feynman\n${identifiers.join("\n")}\n`,
		headers: { "content-type": "text/plain" },
		method: "POST",
	}));
	const summary = recordValue(payload.summary);
	const allResults = arrayValue(payload.pathways).map((item) => normalizeReactomePathway(recordValue(item)));
	const speciesFiltered = parsed.species ? allResults.filter((item) => stringValue(item.species)?.toLowerCase() === parsed.species?.toLowerCase()) : allResults;
	const results = speciesFiltered.slice(0, limit).map((item) => parsed.compact ? item : { ...item, rawPathway: arrayValue(payload.pathways)[allResults.indexOf(item)] });
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "reactome",
		query,
		...(named ? { searchMode: "map-reactome-pathways" } : {}),
		identifiers,
		resource: parsed.resource,
		includeDisease: parsed.includeDisease,
		species: parsed.species,
		totalCount: numberValue(payload.pathwaysFound) ?? results.length,
		returned: results.length,
		identifiersNotFound: numberValue(payload.identifiersNotFound),
		token: stringValue(summary.token),
		results,
		provenance: {
			docs: "https://reactome.org/dev/analysis",
			endpoints: [url.toString()],
		},
	};
}

export async function searchSpecialtyScienceDatabase(params: SearchParams): Promise<Record<string, unknown>> {
	if (isBiomartScienceDatabaseSource(params.source)) return searchBiomart({ limit: params.limit, query: params.query, source: params.source });
	if (isEbiStructuralScienceDatabaseSource(params.source)) return searchEbiStructuralScienceDatabase({ limit: params.limit, query: params.query, source: params.source });
	if (isLongTailScienceDatabaseSource(params.source)) return searchLongTailScienceDatabase({ limit: params.limit, query: params.query, source: params.source });
	if (isPhewebScienceDatabaseSource(params.source)) return searchPheweb({ limit: params.limit, query: params.query, source: params.source });
	if (isPublicAtlasScienceDatabaseSource(params.source)) return searchPublicAtlasScienceDatabase({ limit: params.limit, query: params.query, source: params.source });
	if (isReferenceParityScienceDatabaseSource(params.source)) return searchReferenceParityScienceDatabase({ limit: params.limit, query: params.query, source: params.source });
	if (isResearchResourceScienceDatabaseSource(params.source)) return searchResearchResourceScienceDatabase({ limit: params.limit, query: params.query, source: params.source });
	if (isUcscScienceDatabaseSource(params.source)) return searchUcsc({ limit: params.limit, query: params.query, source: params.source });
	if (isUniBindScienceDatabaseSource(params.source)) return searchUniBind({ limit: params.limit, query: params.query, source: params.source });
	if (isVariantScienceDatabaseSource(params.source)) return searchVariantScienceDatabase({ limit: params.limit, query: params.query, source: params.source });
	if (isZincScienceDatabaseSource(params.source)) return searchZinc({ limit: params.limit, query: params.query, source: params.source });
	if (params.source === "cbioportal") return searchCbioportal(params);
	if (params.source === "civic") return searchCivic(params);
	if (params.source === "clingen") return searchClingen(params);
	if (params.source === "cosmic") return searchCosmic(params);
	if (params.source === "depmap") return searchDepmap(params);
	if (params.source === "encode") return searchEncode(params);
	if (params.source === "geo") return searchGeo(params);
	if (params.source === "gnomad") return searchGnomad(params);
	if (params.source === "gtex") return searchGtex(params);
	if (params.source === "interpro") return searchInterpro(params);
	if (params.source === "ols") return searchOls(params);
	if (params.source === "opentargets") return searchOpenTargets(params);
	if (params.source === "pride") return searchPride(params);
	if (params.source === "quickgo") return searchQuickGo(params);
	return searchReactome(params);
}
