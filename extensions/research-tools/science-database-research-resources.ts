export type ResearchResourceScienceDatabaseSource = "antibodyregistry" | "grantsgov";

type SearchParams = { limit?: number; query: string; source: ResearchResourceScienceDatabaseSource };

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;
const REQUEST_TIMEOUT_MS = 25_000;
const ANTIBODY_REGISTRY_BASE = "https://www.antibodyregistry.org/api";
const ANTIBODY_REGISTRY_SITE = "https://www.antibodyregistry.org";
const ANTIBODY_REGISTRY_SEARCH_PAGE_SIZE = 100;
const ANTIBODY_REGISTRY_EXACT_MAX_RECORDS = 500;
const GRANTS_GOV_SEARCH_URL = "https://api.grants.gov/v1/api/search2";
const GRANTS_GOV_DEFAULT_STATUSES = "forecasted|posted";
const GRANTS_GOV_MAX_RECORDS = 100;

const RESEARCH_RESOURCE_SOURCES = new Set<ResearchResourceScienceDatabaseSource>(["antibodyregistry", "grantsgov"]);

export function isResearchResourceScienceDatabaseSource(source: string): source is ResearchResourceScienceDatabaseSource {
	return RESEARCH_RESOURCE_SOURCES.has(source as ResearchResourceScienceDatabaseSource);
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

function stripModePrefix(query: string, pattern: RegExp): string {
	return query.replace(pattern, "").trim();
}

async function fetchJson(url: URL): Promise<unknown> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
	try {
		const response = await fetch(url, {
			headers: {
				accept: "application/json",
				"user-agent": "feynman-science-database-search/1.0 (https://github.com/advaitpaliwal/feynman)",
			},
			signal: controller.signal,
		});
		if (!response.ok) throw new Error(`Science database request failed: ${response.status} ${response.statusText}`);
		return response.json();
	} finally {
		clearTimeout(timeout);
	}
}

async function postJson(url: URL, body: Record<string, unknown>): Promise<unknown> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
	try {
		const response = await fetch(url, {
			body: JSON.stringify(body),
			headers: {
				accept: "application/json",
				"content-type": "application/json",
				"user-agent": "feynman-science-database-search/1.0 (https://github.com/advaitpaliwal/feynman)",
			},
			method: "POST",
			signal: controller.signal,
		});
		if (!response.ok) throw new Error(`Science database request failed: ${response.status} ${response.statusText}`);
		return response.json();
	} finally {
		clearTimeout(timeout);
	}
}

function antibodyDocs(): string[] {
	return [
		"https://www.antibodyregistry.org/about",
		"https://www.antibodyregistry.org/api/openapi.json",
		"https://www.rrids.org/new-page-1",
	];
}

function grantsGovDocs(): string[] {
	return [
		"https://grants.gov/api/api-guide",
		"https://grants.gov/api/common/search2",
		"https://www.grants.gov/api",
	];
}

function antibodyUrl(abId: number | undefined): string | undefined {
	return abId ? `${ANTIBODY_REGISTRY_SITE}/AB_${abId}` : undefined;
}

function rrid(abId: number | undefined): string | undefined {
	return abId ? `AB_${abId}` : undefined;
}

function rridCurie(abId: number | undefined): string | undefined {
	return abId ? `RRID:AB_${abId}` : undefined;
}

function parseAntibodyId(value: string): number | undefined {
	const clean = value.trim();
	const rridMatch = clean.match(/^(?:RRID:)?AB_(\d+)$/i);
	if (rridMatch?.[1]) return Number(rridMatch[1]);
	const idMatch = clean.match(/^(?:id|detail|antibody)(?::|\s+)(\d+)$/i);
	if (idMatch?.[1]) return Number(idMatch[1]);
	if (/^\d+$/.test(clean)) return Number(clean);
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

function parseInteger(value: string | undefined, fallback: number, max: number): number {
	if (!value || !Number.isFinite(Number(value))) return fallback;
	return Math.max(1, Math.min(Math.floor(Number(value)), max));
}

function parseBool(value: string | undefined, fallback = false): boolean {
	if (!value) return fallback;
	return /^(?:1|true|yes|y)$/i.test(value);
}

function splitList(value: string | undefined): string | undefined {
	if (!value) return undefined;
	const rows = value.split(/[,\n\r;]+/).map((item) => item.trim()).filter(Boolean);
	return rows.length ? rows.join("|") : undefined;
}

function antibodySearchUrl(query: string, limit: number): URL {
	const url = new URL(`${ANTIBODY_REGISTRY_BASE}/fts-antibodies`);
	url.searchParams.set("q", query);
	url.searchParams.set("page", "1");
	url.searchParams.set("size", String(limit));
	return url;
}

function normalizedAntibodyRecord(record: Record<string, unknown>): Record<string, unknown> {
	const abId = numberValue(record.abId ?? record.accession);
	return {
		abId,
		rrid: rrid(abId),
		rridCurie: rridCurie(abId),
		accession: numberValue(record.accession),
		name: stringValue(record.abName),
		target: stringValue(record.abTarget),
		catalogNumber: stringValue(record.catalogNum),
		catalogAlternatives: stringValue(record.catAlt),
		vendorName: stringValue(record.vendorName),
		vendorId: numberValue(record.vendorId),
		vendorUrls: arrayValue(record.vendorUrl).map(String).filter(Boolean).slice(0, 8),
		cloneId: stringValue(record.cloneId),
		clonality: stringValue(record.clonality),
		sourceOrganism: stringValue(record.sourceOrganism),
		targetSpecies: arrayValue(record.targetSpecies).map(String).filter(Boolean).slice(0, 12),
		applications: arrayValue(record.applications).map(String).filter(Boolean).slice(0, 12),
		productIsotype: stringValue(record.productIsotype),
		productConjugate: stringValue(record.productConjugate),
		commercialType: stringValue(record.commercialType),
		status: stringValue(record.status),
		uniprotId: stringValue(record.uniprotId ?? record.abTargetUniprotId),
		targetEntrezId: stringValue(record.abTargetEntrezId),
		targetModification: stringValue(record.targetModification),
		targetSubregion: stringValue(record.targetSubregion),
		citationCount: numberValue(record.numOfCitation),
		definingCitation: stringValue(record.definingCitation),
		insertTime: stringValue(record.insertTime),
		url: antibodyUrl(abId),
	};
}

function exactCatalogMatches(records: Record<string, unknown>[], catalogNumber: string, vendor: string | undefined): Record<string, unknown>[] {
	const wantedCatalog = catalogNumber.trim().toLowerCase();
	const wantedVendor = vendor?.trim().toLowerCase();
	return records.filter((record) => {
		const tokens = [
			...catalogTokens(record.catalogNumber),
			...catalogTokens(record.catalogAlternatives),
		];
		const vendorName = String(record.vendorName ?? "").trim().toLowerCase();
		const catalogMatches = tokens.includes(wantedCatalog);
		const vendorMatches = !wantedVendor || vendorName === wantedVendor;
		return catalogMatches && vendorMatches;
	});
}

function catalogTokens(value: unknown): string[] {
	const raw = String(value ?? "").trim();
	if (!raw) return [];
	return raw
		.split(/[,;]|\(|\)|\balso\b/iu)
		.map((item) => item.trim().toLowerCase())
		.filter(Boolean);
}

function parseCatalogQuery(query: string): { catalogNumber: string; vendor?: string } {
	const body = stripModePrefix(query, /^(?:catalog|cat)(?::|\s+)/i);
	const vendorMatch = body.match(/\bvendor=(.+)$/i);
	const vendor = vendorMatch?.[1]?.trim();
	const catalogNumber = body.replace(/\bvendor=.+$/i, "").trim();
	if (!catalogNumber) throw new Error("Antibody Registry catalog lookup requires a catalog number.");
	return { catalogNumber, vendor };
}

function normalizeVendor(record: Record<string, unknown>): Record<string, unknown> {
	const id = numberValue(record.id);
	return {
		id,
		name: stringValue(record.name),
		url: stringValue(record.url),
		description: stringValue(record.description),
	};
}

function normalizeGrantHit(record: Record<string, unknown>): Record<string, unknown> {
	const number = stringValue(record.number ?? record.oppNum ?? record.opportunityNumber);
	return {
		id: stringValue(record.id),
		number,
		title: stringValue(record.title),
		agency_code: stringValue(record.agencyCode),
		agency_name: stringValue(record.agencyName),
		open_date: stringValue(record.openDate),
		close_date: stringValue(record.closeDate),
		status: stringValue(record.oppStatus),
		document_type: stringValue(record.docType),
		aln_list: arrayValue(record.alnist ?? record.alnList).map(String).filter(Boolean),
		url: number ? `https://www.grants.gov/search-results-detail/${encodeURIComponent(number)}` : undefined,
	};
}

function normalizeFacetRows(value: unknown): Array<Record<string, unknown>> {
	return arrayValue(value).map((item) => {
		const row = recordValue(item);
		return {
			label: stringValue(row.label),
			value: stringValue(row.value),
			count: numberValue(row.count),
		};
	});
}

function parseGrantSearchQuery(query: string, limit: number): {
	countOnly: boolean;
	endRecord: number;
	payload: Record<string, unknown>;
	rows: number;
	startRecordNum: number;
} {
	const body = stripModePrefix(query, /^search_grants(?::|\s+)?/i);
	const inline = queryParamMap(body);
	const plain = stripQueryParams(body);
	const keyword = stringValue(inline.keyword ?? inline.keywords ?? plain);
	const opportunityNumber = stringValue(inline.opportunity_number ?? inline.oppnum ?? inline.opp_num ?? inline.oppnum);
	const aln = stringValue(inline.aln ?? inline.cfda);
	const agencies = splitList(inline.agencies ?? inline.agency);
	const eligibilities = splitList(inline.eligibilities ?? inline.eligibility);
	const fundingCategories = splitList(inline.funding_categories ?? inline.fundingcategories);
	const fundingInstruments = splitList(inline.funding_instruments ?? inline.fundinginstruments);
	const opportunityStatuses = splitList(inline.opportunity_statuses ?? inline.opp_statuses ?? inline.oppstatuses ?? inline.statuses ?? inline.status) ?? GRANTS_GOV_DEFAULT_STATUSES;
	const countOnly = parseBool(inline.count_only ?? inline.countonly, false);
	const maxRecords = parseInteger(inline.max_records ?? inline.maxrecords, limit, GRANTS_GOV_MAX_RECORDS);
	const rows = countOnly ? 0 : parseInteger(inline.rows ?? inline.page_size ?? inline.pagesize, maxRecords, GRANTS_GOV_MAX_RECORDS);
	const startRecordNum = Math.max(0, parseInteger(inline.start_record_num ?? inline.start ?? inline.offset, 1, Number.MAX_SAFE_INTEGER) - 1);
	if (!keyword && !opportunityNumber && !aln && !agencies && !eligibilities && !fundingCategories && !fundingInstruments) {
		throw new Error("search_grants requires at least one criterion such as keyword, opportunity_number, aln, agencies, eligibilities, funding_categories, or funding_instruments.");
	}
	const payload: Record<string, unknown> = {
		rows,
		startRecordNum,
		oppStatuses: opportunityStatuses,
		sortBy: "oppNum|asc",
	};
	if (keyword) payload.keyword = keyword;
	if (opportunityNumber) payload.oppNum = opportunityNumber;
	if (aln) payload.aln = aln;
	if (agencies) payload.agencies = agencies;
	if (eligibilities) payload.eligibilities = eligibilities;
	if (fundingCategories) payload.fundingCategories = fundingCategories;
	if (fundingInstruments) payload.fundingInstruments = fundingInstruments;
	return {
		countOnly,
		endRecord: startRecordNum + maxRecords,
		payload,
		rows,
		startRecordNum,
	};
}

function vendorSearchScore(row: Record<string, unknown>, term: string): number {
	const name = String(row.name ?? "").trim().toLowerCase();
	if (!term) return 0;
	if (name === term) return 0;
	if (name.startsWith(term)) return 1;
	if (new RegExp(`\\b${escapeRegExp(term)}`, "iu").test(name)) return 2;
	return 3;
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function searchAntibodyRegistry(params: SearchParams): Promise<Record<string, unknown>> {
	const query = cleanQuery(params.query);
	const limit = safeLimit(params.limit);
	const endpoints: string[] = [];
	if (/^get_antibody_registry_stats$/i.test(query)) {
		const url = new URL(`${ANTIBODY_REGISTRY_BASE}/datainfo`);
		endpoints.push(url.toString());
		const payload = recordValue(await fetchJson(url));
		return {
			schema: "feynman.scienceDatabaseSearch.v1",
			source: "antibodyregistry",
			query,
			mode: "get_antibody_registry_stats",
			total_antibodies: numberValue(payload.total),
			last_update: stringValue(payload.lastupdate),
			record_count: 1,
			records: [payload],
			provenance: { docs: antibodyDocs(), endpoints },
		};
	}
	if (/^get_antibody(?::|\s+)/i.test(query)) {
		const abId = parseAntibodyId(stripModePrefix(query, /^get_antibody(?::|\s+)/i));
		if (abId === undefined) throw new Error("get_antibody requires an Antibody Registry id, AB_ id, or RRID.");
		const url = new URL(`${ANTIBODY_REGISTRY_BASE}/antibodies/${encodeURIComponent(String(abId))}`);
		endpoints.push(url.toString());
		const rows = arrayValue(await fetchJson(url)).map((item) => normalizedAntibodyRecord(recordValue(item))).slice(0, limit);
		return {
			schema: "feynman.scienceDatabaseSearch.v1",
			source: "antibodyregistry",
			query,
			mode: "get_antibody",
			ab_id: abId,
			rrid: rrid(abId),
			rrid_curie: rridCurie(abId),
			record_count: rows.length,
			records: rows,
			provenance: { docs: antibodyDocs(), endpoints },
		};
	}
	if (/^find_antibodies_by_catalog(?::|\s+)/i.test(query)) {
		const body = stripModePrefix(query, /^find_antibodies_by_catalog(?::|\s+)/i);
		const inline = queryParamMap(body);
		const catalogNumber = stripQueryParams(body) || inline.catalog_number || inline.catalog;
		if (!catalogNumber) throw new Error("find_antibodies_by_catalog requires a catalog number.");
		const pageSize = parseInteger(inline.page_size ?? inline.pagesize, ANTIBODY_REGISTRY_SEARCH_PAGE_SIZE, ANTIBODY_REGISTRY_SEARCH_PAGE_SIZE);
		const url = antibodySearchUrl(catalogNumber, pageSize);
		endpoints.push(url.toString());
		const payload = recordValue(await fetchJson(url));
		const records = arrayValue(payload.items).map((item) => normalizedAntibodyRecord(recordValue(item)));
		const rows = exactCatalogMatches(records, catalogNumber, stringValue(inline.vendor)).slice(0, limit);
		return {
			schema: "feynman.scienceDatabaseSearch.v1",
			source: "antibodyregistry",
			query,
			mode: "find_antibodies_by_catalog",
			catalog_number: catalogNumber,
			vendor: stringValue(inline.vendor),
			search_total_elements: numberValue(payload.totalElements) ?? records.length,
			record_count: rows.length,
			records: rows,
			provenance: { docs: antibodyDocs(), endpoints },
		};
	}
	if (/^search_antibodies(?::|\s+)/i.test(query)) {
		const body = stripModePrefix(query, /^search_antibodies(?::|\s+)/i);
		const inline = queryParamMap(body);
		const term = stripQueryParams(body) || inline.query || inline.keyword;
		if (!term) throw new Error("search_antibodies requires a search query.");
		const page = parseInteger(inline.page, 1, Number.MAX_SAFE_INTEGER);
		const pageSize = parseInteger(inline.page_size ?? inline.pagesize, ANTIBODY_REGISTRY_SEARCH_PAGE_SIZE, ANTIBODY_REGISTRY_SEARCH_PAGE_SIZE);
		const maxRecords = parseInteger(inline.max_records ?? inline.maxrecords, Math.max(limit, pageSize), ANTIBODY_REGISTRY_EXACT_MAX_RECORDS);
		const url = antibodySearchUrl(term, Math.min(pageSize, maxRecords));
		url.searchParams.set("page", String(page));
		endpoints.push(url.toString());
		const payload = recordValue(await fetchJson(url));
		const rows = arrayValue(payload.items).map((item) => normalizedAntibodyRecord(recordValue(item))).slice(0, maxRecords);
		return {
			schema: "feynman.scienceDatabaseSearch.v1",
			source: "antibodyregistry",
			query,
			mode: "search_antibodies",
			search_query: term,
			page,
			page_size: pageSize,
			total_count: numberValue(payload.totalElements) ?? rows.length,
			record_count: rows.length,
			truncated: rows.length >= maxRecords && (numberValue(payload.totalElements) ?? rows.length) > rows.length,
			records: rows,
			provenance: { docs: antibodyDocs(), endpoints },
		};
	}
	if (/^(?:stats|datainfo)$/i.test(query)) {
		const url = new URL(`${ANTIBODY_REGISTRY_BASE}/datainfo`);
		endpoints.push(url.toString());
		const payload = recordValue(await fetchJson(url));
		return {
			schema: "feynman.scienceDatabaseSearch.v1",
			source: "antibodyregistry",
			query,
			mode: "stats",
			totalAntibodies: numberValue(payload.total),
			lastUpdate: stringValue(payload.lastupdate),
			totalCount: 1,
			returned: 1,
			results: [payload],
			provenance: { docs: antibodyDocs(), endpoints },
		};
	}
	if (/^vendors?(?::|\s|$)/i.test(query)) {
		const term = stripModePrefix(query, /^vendors?(?::|\s+)?/i).toLowerCase();
		const url = new URL(`${ANTIBODY_REGISTRY_BASE}/vendors`);
		endpoints.push(url.toString());
		const allRows = arrayValue(await fetchJson(url)).map((item) => normalizeVendor(recordValue(item)));
		const filteredRows = allRows.filter((row) => !term || String(row.name ?? "").toLowerCase().includes(term))
			.sort((a, b) => vendorSearchScore(a, term) - vendorSearchScore(b, term) || String(a.name ?? "").localeCompare(String(b.name ?? "")));
		const rows = filteredRows.slice(0, limit);
		return {
			schema: "feynman.scienceDatabaseSearch.v1",
			source: "antibodyregistry",
			query,
			mode: "vendors",
			totalCount: filteredRows.length,
			registryVendorCount: allRows.length,
			returned: rows.length,
			results: rows,
			provenance: { docs: antibodyDocs(), endpoints },
		};
	}
	const detailQuery = stripModePrefix(query, /^(?:detail|antibody)(?::|\s+)/i);
	const abId = parseAntibodyId(detailQuery);
	if (abId !== undefined) {
		const url = new URL(`${ANTIBODY_REGISTRY_BASE}/antibodies/${encodeURIComponent(String(abId))}`);
		endpoints.push(url.toString());
		const rows = arrayValue(await fetchJson(url)).map((item) => normalizedAntibodyRecord(recordValue(item))).slice(0, limit);
		return {
			schema: "feynman.scienceDatabaseSearch.v1",
			source: "antibodyregistry",
			query,
			mode: "detail",
			abId,
			rrid: rrid(abId),
			rridCurie: rridCurie(abId),
			totalCount: rows.length,
			returned: rows.length,
			results: rows,
			provenance: { docs: antibodyDocs(), endpoints },
		};
	}
	if (/^(?:catalog|cat)(?::|\s+)/i.test(query)) {
		const { catalogNumber, vendor } = parseCatalogQuery(query);
		const url = antibodySearchUrl(catalogNumber, ANTIBODY_REGISTRY_SEARCH_PAGE_SIZE);
		endpoints.push(url.toString());
		const payload = recordValue(await fetchJson(url));
		const records = arrayValue(payload.items).map((item) => normalizedAntibodyRecord(recordValue(item)));
		const rows = exactCatalogMatches(records, catalogNumber, vendor).slice(0, limit);
		return {
			schema: "feynman.scienceDatabaseSearch.v1",
			source: "antibodyregistry",
			query,
			mode: "catalog",
			catalogNumber,
			vendor,
			searchTotalElements: numberValue(payload.totalElements) ?? records.length,
			totalCount: rows.length,
			returned: rows.length,
			results: rows,
			provenance: { docs: antibodyDocs(), endpoints },
		};
	}
	const term = stripModePrefix(query, /^search(?::|\s+)/i);
	const url = antibodySearchUrl(term, limit);
	endpoints.push(url.toString());
	const payload = recordValue(await fetchJson(url));
	const rows = arrayValue(payload.items).map((item) => normalizedAntibodyRecord(recordValue(item)));
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "antibodyregistry",
		query,
		mode: "search",
		totalCount: numberValue(payload.totalElements) ?? rows.length,
		returned: rows.length,
		complete: rows.length >= (numberValue(payload.totalElements) ?? rows.length),
		anonymousLimitRows: 500,
		results: rows,
		provenance: { docs: antibodyDocs(), endpoints },
	};
}

async function searchGrantsGov(params: SearchParams): Promise<Record<string, unknown>> {
	const query = cleanQuery(params.query);
	const limit = safeLimit(params.limit);
	if (!/^search_grants(?::|\s|$)/i.test(query)) {
		throw new Error("Grants.gov search supports the exact search_grants query mode.");
	}
	const endpoints = [GRANTS_GOV_SEARCH_URL];
	const request = parseGrantSearchQuery(query, limit);
	const url = new URL(GRANTS_GOV_SEARCH_URL);
	const payload = recordValue(await postJson(url, request.payload));
	const data = recordValue(payload.data);
	const errorCode = numberValue(payload.errorcode);
	if (errorCode !== undefined && errorCode !== 0) {
		throw new Error(`Grants.gov search failed: ${stringValue(payload.msg) ?? `error ${errorCode}`}`);
	}
	const records = arrayValue(data.oppHits).map((item) => normalizeGrantHit(recordValue(item)));
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "grantsgov",
		query,
		mode: "search_grants",
		hit_count: numberValue(data.hitCount) ?? records.length,
		n_returned: records.length,
		truncated: !request.countOnly && (numberValue(data.hitCount) ?? records.length) > request.startRecordNum + records.length,
		records,
		facets: {
			statuses: normalizeFacetRows(data.oppStatusOptions),
			date_ranges: normalizeFacetRows(data.dateRangeOptions),
			eligibilities: normalizeFacetRows(data.eligibilities),
			funding_categories: normalizeFacetRows(data.fundingCategories),
			funding_instruments: normalizeFacetRows(data.fundingInstruments),
			agencies: normalizeFacetRows(data.agencies),
		},
		search_params: recordValue(data.searchParams),
		message: stringValue(payload.msg),
		provenance: { docs: grantsGovDocs(), endpoints, request: request.payload },
	};
}

export async function searchResearchResourceScienceDatabase(params: SearchParams): Promise<Record<string, unknown>> {
	if (params.source === "antibodyregistry") return searchAntibodyRegistry(params);
	if (params.source === "grantsgov") return searchGrantsGov(params);
	throw new Error(`Unsupported research resource source: ${params.source}`);
}
