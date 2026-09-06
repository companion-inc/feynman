import { searchOpenFda } from "./science-database-openfda.js";

export type PublicAtlasScienceDatabaseSource = "eqtlcatalogue" | "gwascatalog" | "openfda" | "proteinatlas";

type SearchParams = { limit?: number; query: string; source: PublicAtlasScienceDatabaseSource };

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;
const REQUEST_TIMEOUT_MS = 25_000;
const EQTL_CATALOGUE_V2_BASE = "https://www.ebi.ac.uk/eqtl/api/v2";
const EQTL_CATALOGUE_BASE = "https://www.ebi.ac.uk/eqtl/api/v3";
const GWAS_CATALOG_BASE = "https://www.ebi.ac.uk/gwas/rest/api/v2";
const PROTEIN_ATLAS_SEARCH_URL = "https://www.proteinatlas.org/api/search_download.php";

const PUBLIC_ATLAS_SOURCES = new Set<PublicAtlasScienceDatabaseSource>(["eqtlcatalogue", "gwascatalog", "openfda", "proteinatlas"]);

export function isPublicAtlasScienceDatabaseSource(source: string): source is PublicAtlasScienceDatabaseSource {
	return PUBLIC_ATLAS_SOURCES.has(source as PublicAtlasScienceDatabaseSource);
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

function booleanValue(value: unknown): boolean | undefined {
	if (typeof value === "boolean") return value;
	if (typeof value === "string" && ["true", "false", "1", "2"].includes(value.toLowerCase())) {
		if (value === "1") return true;
		if (value === "2") return false;
		return value.toLowerCase() === "true";
	}
	return undefined;
}

function safeLimit(value: number | undefined): number {
	if (!Number.isFinite(value) || value === undefined) return DEFAULT_LIMIT;
	return Math.max(1, Math.min(Math.floor(value), MAX_LIMIT));
}

function safeRecordLimit(value: number | undefined, fallback = 1_000): number {
	if (!Number.isFinite(value) || value === undefined) return fallback;
	return Math.max(1, Math.min(Math.floor(value), 1_000));
}

function cleanQuery(query: string): string {
	const clean = query.trim();
	if (!clean) throw new Error("Science database search requires a non-empty query.");
	return clean;
}

async function responseFor(url: URL, init?: RequestInit): Promise<Response> {
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
		return response;
	} finally {
		clearTimeout(timeout);
	}
}

async function fetchJson(url: URL, init?: RequestInit): Promise<unknown> {
	return (await responseFor(url, init)).json();
}

function stringArray(value: unknown, max = 8): string[] {
	return (Array.isArray(value) ? value : value === undefined ? [] : [value])
		.map((item) => String(item).trim())
		.filter(Boolean)
		.slice(0, max);
}

function firstStringArray(value: unknown): string | undefined {
	return stringArray(value, 1)[0];
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

function exactCommand(query: string): { command: string; rest: string } | undefined {
	const match = query.trim().match(/^([a-z][a-z0-9_]*):?\s*(.*)$/i);
	if (!match?.[1] || !match[1].includes("_")) return undefined;
	return { command: match[1].toLowerCase(), rest: match[2]?.trim() ?? "" };
}

function stripNamedParams(text: string): string {
	return text.replace(/\b[a-z][a-z0-9_-]*\s*=\s*("[^"]+"|'[^']+'|[^\s;]+)/gi, " ").trim();
}

function pageTotal(payload: Record<string, unknown>, fallback: number): number {
	return numberValue(recordValue(payload.page).totalElements) ?? fallback;
}

function embeddedRows(payload: Record<string, unknown>, key: string): unknown[] {
	const value = recordValue(payload._embedded)[key];
	if (Array.isArray(value)) return value;
	if (value && typeof value === "object") return Object.values(value as Record<string, unknown>);
	return [];
}

function eqtlModeAndUrl(query: string, limit: number): { mode: string; url: URL } {
	const clean = cleanQuery(query);
	const prefixed = clean.match(/^(gene|variant|study|dataset|rsid)\s*:\s*(.+)$/i);
	const kind = prefixed?.[1]?.toLowerCase();
	const term = (prefixed?.[2] ?? clean).trim();
	if (!term) throw new Error("eQTL Catalogue search requires gene:<Ensembl>, variant:<rsID/variant>, study:<id>, or dataset:<id>.");
	if (kind === "study" || /^QTS\d+$/i.test(term)) {
		return { mode: "study", url: new URL(`${EQTL_CATALOGUE_BASE}/studies/${encodeURIComponent(term.toUpperCase())}`) };
	}
	if (kind === "dataset" || /^QTD\d+$/i.test(term)) {
		return { mode: "dataset", url: new URL(`${EQTL_CATALOGUE_BASE}/datasets/${encodeURIComponent(term.toUpperCase())}`) };
	}
	const url = new URL(`${EQTL_CATALOGUE_BASE}/associations`);
	if (kind === "variant" || kind === "rsid" || /^rs\d+$/i.test(term) || /^chr[\w]+_\d+_/i.test(term)) {
		url.searchParams.set("variant_id", term);
	} else if (kind === "gene" || /^ENSG\d+/i.test(term)) {
		url.searchParams.set("gene_id", term);
	} else {
		throw new Error("eQTL Catalogue free-text search is not supported; use gene:ENSG..., variant:rs..., study:QTS..., or dataset:QTD...");
	}
	url.searchParams.set("size", String(limit));
	return { mode: "associations", url };
}

function normalizeEqtlAssociation(record: Record<string, unknown>): Record<string, unknown> {
	return {
		variant: stringValue(record.variant),
		rsid: stringValue(record.rsid),
		chromosome: stringValue(record.chromosome),
		position: numberValue(record.position),
		ref: stringValue(record.ref),
		alt: stringValue(record.alt),
		geneId: stringValue(record.gene_id),
		molecularTraitId: stringValue(record.molecular_trait_id),
		studyId: stringValue(record.study_id),
		datasetId: stringValue(record.dataset_id),
		pvalue: numberValue(record.pvalue),
		negLog10Pvalue: numberValue(record.neg_log10_pvalue ?? record.neg_log10_p_value),
		beta: numberValue(record.beta),
		standardError: numberValue(record.se),
		maf: numberValue(record.maf),
		tissue: stringValue(record.tissue),
		tissueLabel: stringValue(record.tissue_label),
		qtlGroup: stringValue(record.qtl_group),
		conditionLabel: stringValue(record.condition_label),
	};
}

function normalizeEqtlResource(record: Record<string, unknown>): Record<string, unknown> {
	return {
		studyId: stringValue(record.study_id),
		datasetId: stringValue(record.dataset_id),
		tissueId: stringValue(record.tissue_id ?? record.tissue),
		tissueLabel: stringValue(record.tissue_label),
		qtlGroup: stringValue(record.qtl_group),
		quantMethod: stringValue(record.quant_method),
		sampleSize: numberValue(record.sample_size),
	};
}

function normalizeEqtlDataset(record: Record<string, unknown>): Record<string, unknown> {
	return {
		dataset_id: stringValue(record.dataset_id),
		study_id: stringValue(record.study_id),
		study_label: stringValue(record.study_label ?? record.study_id),
		sample_group: stringValue(record.sample_group),
		tissue_id: stringValue(record.tissue_id ?? record.tissue),
		tissue_label: stringValue(record.tissue_label),
		condition_label: stringValue(record.condition_label ?? record.condition),
		quant_method: stringValue(record.quant_method),
		sample_size: numberValue(record.sample_size),
	};
}

function normalizeEqtlExactAssociation(record: Record<string, unknown>): Record<string, unknown> {
	return {
		molecular_trait_id: stringValue(record.molecular_trait_id),
		gene_id: stringValue(record.gene_id),
		variant: stringValue(record.variant),
		rsid: stringValue(record.rsid),
		chromosome: stringValue(record.chromosome),
		position: numberValue(record.position),
		ref: stringValue(record.ref),
		alt: stringValue(record.alt),
		type: stringValue(record.type),
		beta: numberValue(record.beta),
		se: numberValue(record.se),
		pvalue: numberValue(record.pvalue),
		nlog10p: numberValue(record.nlog10p ?? record.neg_log10_pvalue ?? record.neg_log10_p_value),
		maf: numberValue(record.maf),
		ac: numberValue(record.ac),
		an: numberValue(record.an),
		r2: numberValue(record.r2),
		median_tpm: numberValue(record.median_tpm),
	};
}

async function fetchEqtlV2Rows(path: string, filters: Record<string, string>, maxRecords: number): Promise<{ endpoints: string[]; rows: unknown[]; truncated: boolean }> {
	const rows: unknown[] = [];
	const endpoints: string[] = [];
	let start = 0;
	while (rows.length <= maxRecords) {
		const size = Math.min(1_000, maxRecords - rows.length + 1);
		const url = new URL(`${EQTL_CATALOGUE_V2_BASE}${path}`);
		for (const [key, value] of Object.entries(filters)) url.searchParams.set(key, value);
		url.searchParams.set("start", String(start));
		url.searchParams.set("size", String(size));
		endpoints.push(url.toString());
		const payload = await fetchJson(url);
		const batch = arrayValue(payload);
		rows.push(...batch);
		if (batch.length < size) return { endpoints, rows: rows.slice(0, maxRecords), truncated: rows.length > maxRecords };
		if (rows.length > maxRecords) return { endpoints, rows: rows.slice(0, maxRecords), truncated: true };
		start += size;
	}
	return { endpoints, rows: rows.slice(0, maxRecords), truncated: true };
}

async function exactEqtlCatalogue(params: SearchParams, command: string, rest: string): Promise<Record<string, unknown>> {
	const parsed = queryParamMap(rest);
	const maxRecords = safeRecordLimit(numberValue(parsed.max_records) ?? params.limit);
	if (command === "eqtl_list_datasets") {
		const filters: Record<string, string> = {};
		for (const key of ["study_label", "tissue_label", "quant_method"]) {
			if (parsed[key]) filters[key] = parsed[key];
		}
		const { endpoints, rows, truncated } = await fetchEqtlV2Rows("/datasets", filters, maxRecords);
		const datasets = rows.map((item) => normalizeEqtlDataset(recordValue(item))).sort((a, b) => String(a.dataset_id ?? "").localeCompare(String(b.dataset_id ?? "")));
		return {
			schema: "feynman.scienceDatabaseSearch.v1",
			source: "eqtlcatalogue",
			query: params.query,
			searchMode: "eqtl_list_datasets",
			filters,
			returned: datasets.length,
			truncated,
			datasets,
			provenance: {
				docs: ["https://www.ebi.ac.uk/eqtl/api-docs/", "https://github.com/eQTL-Catalogue/eQTL-SumStats"],
				endpoints,
			},
		};
	}
	if (command !== "eqtl_associations") throw new Error(`Unsupported eQTL Catalogue exact command: ${command}`);
	const positional = stripNamedParams(rest);
	const datasetId = (parsed.dataset_id ?? positional.split(/\s+/)[0] ?? "").trim().toUpperCase();
	if (!/^QTD\d+$/i.test(datasetId)) throw new Error("eqtl_associations requires dataset_id=QTD... or a leading QTD... dataset id.");
	const filters: Record<string, string> = {};
	for (const [inputKey, apiKey] of Object.entries({ gene_id: "gene_id", rsid: "rsid", variant: "variant", pos: "pos", nlog10p_min: "nlog10p" })) {
		if (parsed[inputKey]) filters[apiKey] = parsed[inputKey];
	}
	if (!Object.keys(filters).length) throw new Error("eqtl_associations requires one of gene_id, rsid, variant, or pos.");
	const { endpoints, rows, truncated } = await fetchEqtlV2Rows(`/datasets/${encodeURIComponent(datasetId)}/associations`, filters, maxRecords);
	const associations = rows.map((item) => normalizeEqtlExactAssociation(recordValue(item)));
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "eqtlcatalogue",
		query: params.query,
		searchMode: "eqtl_associations",
		dataset_id: datasetId,
		filters,
		returned: associations.length,
		truncated,
		associations,
		results: associations,
		provenance: {
			docs: ["https://www.ebi.ac.uk/eqtl/api-docs/", "https://github.com/eQTL-Catalogue/eQTL-SumStats"],
			endpoints,
		},
	};
}

async function searchEqtlCatalogue(params: SearchParams): Promise<Record<string, unknown>> {
	const query = cleanQuery(params.query);
	const limit = safeLimit(params.limit);
	const { mode, url } = eqtlModeAndUrl(query, limit);
	const payload = await fetchJson(url);
	const rawResults = Array.isArray(payload) ? payload : [payload];
	const results = rawResults
		.map((item) => mode === "associations" ? normalizeEqtlAssociation(recordValue(item)) : normalizeEqtlResource(recordValue(item)))
		.slice(0, limit);
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "eqtlcatalogue",
		query,
		mode,
		totalCount: rawResults.length,
		returned: results.length,
		results,
		provenance: {
			docs: ["https://www.ebi.ac.uk/eqtl/api-docs/", "https://github.com/eQTL-Catalogue/eQTL-SumStats"],
			endpoints: [url.toString()],
		},
	};
}

type GwasMode = "associations" | "study" | "studies" | "traits";

function gwasRoute(path: string, mode: GwasMode, filter: Record<string, string>): { filter: Record<string, string>; mode: GwasMode; path: string } {
	return { filter, mode, path };
}

function gwasUrlForQuery(query: string, limit: number): { filter: Record<string, string>; mode: GwasMode; url: URL } {
	const clean = cleanQuery(query);
	const prefixed = clean.match(/^(association-trait|efo|efo-id|gene|mapped-gene|pmid|rs|rsid|study|study-pmid|trait)\s*:\s*(.+)$/i);
	const kind = prefixed?.[1]?.toLowerCase();
	const term = (prefixed?.[2] ?? clean).trim();
	if (!term) throw new Error("GWAS Catalog search requires an rsID, gene:<symbol>, trait:<term>, association-trait:<term>, efo:<EFO/MONDO>, study:<GCST...>, or study-pmid:<PMID> query.");
	const pathAndFilter: { filter: Record<string, string>; mode: GwasMode; path: string } = (() => {
		if (kind === "study" || /^GCST\d+$/i.test(term)) return gwasRoute(`/studies/${encodeURIComponent(term.toUpperCase())}`, "study", { accession_id: term.toUpperCase() });
		if (kind === "study-pmid" || kind === "pmid") return gwasRoute("/studies", "studies", { pubmed_id: term });
		if (kind === "trait") return gwasRoute("/efo-traits", "traits", { trait: term });
		if (kind === "association-trait") return gwasRoute("/associations", "associations", { efo_trait: term });
		if (kind === "efo" || kind === "efo-id") return gwasRoute("/associations", "associations", { efo_id: term });
		if (kind === "gene" || kind === "mapped-gene") return gwasRoute("/associations", "associations", { mapped_gene: term });
		if (kind === "rs" || kind === "rsid" || /^rs\d+$/i.test(term)) return gwasRoute("/associations", "associations", { rs_id: term });
		return gwasRoute("/efo-traits", "traits", { trait: term });
	})();
	const url = new URL(`${GWAS_CATALOG_BASE}${pathAndFilter.path}`);
	if (pathAndFilter.mode !== "study") {
		for (const [key, value] of Object.entries(pathAndFilter.filter)) url.searchParams.set(key, value);
		url.searchParams.set("size", String(limit));
		url.searchParams.set("page", "0");
		if (pathAndFilter.mode === "associations") {
			url.searchParams.set("sort", "p_value");
			url.searchParams.set("direction", "asc");
		}
	}
	return { filter: pathAndFilter.filter, mode: pathAndFilter.mode, url };
}

function normalizeGwasTraitList(value: unknown): Array<Record<string, unknown>> {
	return arrayValue(value).map((item) => {
		const record = recordValue(item);
		return {
			efoId: stringValue(record.efo_id),
			efoTrait: stringValue(record.efo_trait),
			uri: stringValue(record.uri),
		};
	});
}

function normalizeGwasTraitListExact(value: unknown): Array<Record<string, unknown>> {
	return arrayValue(value).map((item) => {
		const record = recordValue(item);
		return {
			efo_id: stringValue(record.efo_id),
			efo_trait: stringValue(record.efo_trait),
			uri: stringValue(record.uri),
		};
	});
}

function normalizeGwasAssociation(record: Record<string, unknown>): Record<string, unknown> {
	const associationId = numberValue(record.association_id) ?? stringValue(record.association_id);
	const links = recordValue(record._links);
	return {
		associationId,
		pValue: numberValue(record.p_value),
		pvalueMantissa: numberValue(record.pvalue_mantissa),
		pvalueExponent: numberValue(record.pvalue_exponent),
		pvalueDescription: stringValue(record.pvalue_description),
		oddsRatio: numberValue(record.or_per_copy_num ?? record.or_value),
		beta: numberValue(record.beta),
		ciLower: numberValue(record.ci_lower),
		ciUpper: numberValue(record.ci_upper),
		range: stringValue(record.range),
		riskFrequency: stringValue(record.risk_frequency),
		snpEffectAlleles: stringArray(record.snp_effect_allele, 12),
		rsIds: arrayValue(record.snp_allele).flatMap((item) => {
			const allele = recordValue(item);
			return stringValue(allele.rs_id) ? [stringValue(allele.rs_id)] : [];
		}),
		locations: stringArray(record.locations, 12),
		mappedGenes: stringArray(record.mapped_genes, 12),
		efoTraits: normalizeGwasTraitList(record.efo_traits),
		backgroundEfoTraits: normalizeGwasTraitList(record.bg_efo_traits),
		reportedTraits: stringArray(record.reported_trait, 12),
		multiSnpHaplotype: booleanValue(record.multi_snp_haplotype),
		snpInteraction: booleanValue(record.snp_interaction),
		studyAccession: stringValue(record.accession_id),
		pubmedId: stringValue(record.pubmed_id) ?? (numberValue(record.pubmed_id) !== undefined ? String(numberValue(record.pubmed_id)) : undefined),
		firstAuthor: stringValue(record.first_author),
		url: stringValue(recordValue(links.self).href),
	};
}

function normalizeGwasAssociationExact(record: Record<string, unknown>): Record<string, unknown> {
	const associationId = numberValue(record.association_id) ?? stringValue(record.association_id);
	return {
		association_id: associationId,
		p_value: numberValue(record.p_value),
		pvalue_mantissa: numberValue(record.pvalue_mantissa),
		pvalue_exponent: numberValue(record.pvalue_exponent),
		pvalue_description: stringValue(record.pvalue_description),
		or_value: numberValue(record.or_per_copy_num ?? record.or_value),
		beta: numberValue(record.beta),
		ci_lower: numberValue(record.ci_lower),
		ci_upper: numberValue(record.ci_upper),
		range: stringValue(record.range),
		risk_frequency: stringValue(record.risk_frequency),
		snp_effect_alleles: stringArray(record.snp_effect_allele, 12),
		rs_ids: arrayValue(record.snp_allele).flatMap((item) => {
			const allele = recordValue(item);
			return firstStringArray(allele.rs_id) ? [firstStringArray(allele.rs_id)] : [];
		}),
		locations: stringArray(record.locations, 12),
		mapped_genes: stringArray(record.mapped_genes, 12),
		efo_traits: normalizeGwasTraitListExact(record.efo_traits),
		bg_efo_traits: normalizeGwasTraitListExact(record.bg_efo_traits),
		reported_trait: stringArray(record.reported_trait, 12),
		multi_snp_haplotype: booleanValue(record.multi_snp_haplotype),
		snp_interaction: booleanValue(record.snp_interaction),
		study_accession_id: stringValue(record.accession_id),
		pubmed_id: stringValue(record.pubmed_id) ?? (numberValue(record.pubmed_id) !== undefined ? String(numberValue(record.pubmed_id)) : undefined),
		first_author: stringValue(record.first_author),
	};
}

function normalizeGwasStudy(record: Record<string, unknown>): Record<string, unknown> {
	const accession = stringValue(record.accession_id);
	const links = recordValue(record._links);
	return {
		accessionId: accession,
		diseaseTrait: stringValue(record.disease_trait),
		efoTraits: normalizeGwasTraitList(record.efo_traits),
		backgroundEfoTraits: normalizeGwasTraitList(record.bg_efo_traits),
		pubmedId: stringValue(record.pubmed_id) ?? (numberValue(record.pubmed_id) !== undefined ? String(numberValue(record.pubmed_id)) : undefined),
		initialSampleSize: stringValue(record.initial_sample_size),
		replicationSampleSize: stringValue(record.replication_sample_size),
		discoveryAncestry: stringArray(record.discovery_ancestry, 12),
		replicationAncestry: stringArray(record.replication_ancestry, 12),
		genotypingTechnologies: stringArray(record.genotyping_technologies, 12),
		platforms: stringValue(record.platforms),
		cohorts: stringArray(record.cohort, 12),
		fullSummaryStatsAvailable: booleanValue(record.full_summary_stats_available),
		imputed: booleanValue(record.imputed),
		geneEnvironmentInteraction: booleanValue(record.gxe),
		geneGeneInteraction: booleanValue(record.gxg),
		pooled: booleanValue(record.pooled),
		url: stringValue(recordValue(links.self).href) ?? (accession ? `https://www.ebi.ac.uk/gwas/studies/${encodeURIComponent(accession)}` : undefined),
	};
}

function normalizeGwasStudyExact(record: Record<string, unknown>): Record<string, unknown> {
	return {
		accession_id: stringValue(record.accession_id),
		disease_trait: stringValue(record.disease_trait),
		efo_traits: normalizeGwasTraitListExact(record.efo_traits),
		bg_efo_traits: normalizeGwasTraitListExact(record.bg_efo_traits),
		pubmed_id: stringValue(record.pubmed_id) ?? (numberValue(record.pubmed_id) !== undefined ? String(numberValue(record.pubmed_id)) : undefined),
		initial_sample_size: stringValue(record.initial_sample_size),
		replication_sample_size: stringValue(record.replication_sample_size),
		discovery_ancestry: stringArray(record.discovery_ancestry, 12),
		replication_ancestry: stringArray(record.replication_ancestry, 12),
		genotyping_technologies: stringArray(record.genotyping_technologies, 12),
		platforms: stringValue(record.platforms),
		cohort: stringArray(record.cohort, 12),
		full_summary_stats_available: booleanValue(record.full_summary_stats_available),
		imputed: booleanValue(record.imputed),
		gxe: booleanValue(record.gxe),
	};
}

function normalizeGwasTrait(record: Record<string, unknown>): Record<string, unknown> {
	const efoId = stringValue(record.efo_id);
	const links = recordValue(record._links);
	return {
		efoId,
		efoTrait: stringValue(record.efo_trait),
		uri: stringValue(record.uri),
		url: stringValue(recordValue(links.self).href) ?? (efoId ? `https://www.ebi.ac.uk/gwas/efotraits/${encodeURIComponent(efoId)}` : undefined),
	};
}

function normalizeGwasTraitExact(record: Record<string, unknown>): Record<string, unknown> {
	return {
		efo_id: stringValue(record.efo_id),
		efo_trait: stringValue(record.efo_trait),
		uri: stringValue(record.uri),
	};
}

function normalizeGwasSnpExact(record: Record<string, unknown>): Record<string, unknown> {
	return {
		rs_id: stringValue(record.rs_id),
		merged: booleanValue(record.merged),
		functional_class: stringValue(record.functional_class),
		most_severe_consequence: stringValue(record.most_severe_consequence),
		alleles: stringValue(record.alleles),
		mapped_genes: stringArray(record.mapped_genes, 12),
		locations: arrayValue(record.locations).map((item) => {
			const location = recordValue(item);
			return {
				chromosome: stringValue(location.chromosome),
				position: numberValue(location.position),
				region: stringValue(location.region),
			};
		}),
		last_update_date: stringValue(record.last_update_date),
	};
}

function gwasListUrl(path: string, filters: Record<string, string>, limit: number, sortAssociations = false): URL {
	const url = new URL(`${GWAS_CATALOG_BASE}${path}`);
	for (const [key, value] of Object.entries(filters)) url.searchParams.set(key, value);
	url.searchParams.set("size", String(limit));
	url.searchParams.set("page", "0");
	if (sortAssociations) {
		url.searchParams.set("sort", "p_value");
		url.searchParams.set("direction", "asc");
	}
	return url;
}

async function exactGwasCatalog(params: SearchParams, command: string, rest: string): Promise<Record<string, unknown>> {
	const parsed = queryParamMap(rest);
	const positional = stripNamedParams(rest);
	const maxRecords = safeRecordLimit(numberValue(parsed.max_records) ?? params.limit, DEFAULT_LIMIT);
	const associationSearch = async (filters: Record<string, string>, envelope: Record<string, unknown>) => {
		const url = gwasListUrl("/associations", filters, maxRecords, true);
		const payload = recordValue(await fetchJson(url));
		const raw = embeddedRows(payload, "associations");
		const associations = raw.map((item) => normalizeGwasAssociationExact(recordValue(item)));
		const apiTotal = pageTotal(payload, associations.length);
		return {
			schema: "feynman.scienceDatabaseSearch.v1",
			source: "gwascatalog",
			query: params.query,
			...envelope,
			api_total: apiTotal,
			returned: associations.length,
			truncated: apiTotal > associations.length,
			associations,
			results: associations,
			provenance: {
				docs: ["https://www.ebi.ac.uk/gwas/rest/api/v2/docs", "https://www.ebi.ac.uk/gwas/rest/api/v2/docs/reference"],
				endpoints: [url.toString()],
			},
		};
	};
	if (command === "gwas_associations_for_variant") {
		const rsId = positional || parsed.rs_id || parsed.rsid;
		if (!rsId) throw new Error("gwas_associations_for_variant requires an rsID.");
		return associationSearch({ rs_id: rsId }, { searchMode: command, rs_id: rsId });
	}
	if (command === "gwas_associations_for_gene") {
		const gene = positional || parsed.gene_symbol || parsed.mapped_gene || parsed.gene;
		if (!gene) throw new Error("gwas_associations_for_gene requires a gene symbol.");
		return associationSearch({ mapped_gene: gene }, { searchMode: command, gene_symbol: gene });
	}
	if (command === "gwas_associations_for_trait") {
		const filters: Record<string, string> = {};
		if (parsed.efo_id) filters.efo_id = parsed.efo_id;
		else if (parsed.efo_trait) filters.efo_trait = parsed.efo_trait;
		else if (positional) filters.efo_trait = positional;
		if (Object.keys(filters).length !== 1) throw new Error("gwas_associations_for_trait requires exactly one of efo_id or efo_trait.");
		return associationSearch(filters, { searchMode: command, filters });
	}
	if (command === "gwas_search_traits") {
		const query = positional || parsed.query || parsed.trait;
		if (!query) throw new Error("gwas_search_traits requires a text query.");
		const url = gwasListUrl("/efo-traits", { trait: query }, maxRecords);
		const payload = recordValue(await fetchJson(url));
		const efoTraits = embeddedRows(payload, "efo_traits").map((item) => normalizeGwasTraitExact(recordValue(item)));
		const apiTotal = pageTotal(payload, efoTraits.length);
		return {
			schema: "feynman.scienceDatabaseSearch.v1",
			source: "gwascatalog",
			query: params.query,
			searchMode: command,
			api_total: apiTotal,
			returned: efoTraits.length,
			truncated: apiTotal > efoTraits.length,
			efo_traits: efoTraits,
			results: efoTraits,
			provenance: {
				docs: ["https://www.ebi.ac.uk/gwas/rest/api/v2/docs", "https://www.ebi.ac.uk/gwas/rest/api/v2/docs/reference"],
				endpoints: [url.toString()],
			},
		};
	}
	if (command === "gwas_search_studies") {
		const filters: Record<string, string> = {};
		for (const key of ["efo_id", "efo_trait", "pubmed_id"]) {
			if (parsed[key]) filters[key] = parsed[key];
		}
		if (!Object.keys(filters).length) throw new Error("gwas_search_studies requires efo_id, efo_trait, or pubmed_id.");
		const url = gwasListUrl("/studies", filters, maxRecords);
		const payload = recordValue(await fetchJson(url));
		const studies = embeddedRows(payload, "studies").map((item) => normalizeGwasStudyExact(recordValue(item)));
		const apiTotal = pageTotal(payload, studies.length);
		return {
			schema: "feynman.scienceDatabaseSearch.v1",
			source: "gwascatalog",
			query: params.query,
			searchMode: command,
			filters,
			api_total: apiTotal,
			returned: studies.length,
			truncated: apiTotal > studies.length,
			studies,
			results: studies,
			provenance: {
				docs: ["https://www.ebi.ac.uk/gwas/rest/api/v2/docs", "https://www.ebi.ac.uk/gwas/rest/api/v2/docs/reference"],
				endpoints: [url.toString()],
			},
		};
	}
	if (command === "gwas_get_study") {
		const accessionId = (positional || parsed.accession_id || parsed.study || "").toUpperCase();
		if (!accessionId) throw new Error("gwas_get_study requires a GCST accession.");
		const url = new URL(`${GWAS_CATALOG_BASE}/studies/${encodeURIComponent(accessionId)}`);
		try {
			const study = normalizeGwasStudyExact(recordValue(await fetchJson(url)));
			return { schema: "feynman.scienceDatabaseSearch.v1", source: "gwascatalog", query: params.query, searchMode: command, found: true, accession_id: accessionId, study, provenance: { docs: "https://www.ebi.ac.uk/gwas/rest/api/v2/docs/reference", endpoints: [url.toString()] } };
		} catch (error) {
			if (error instanceof Error && error.message.includes("404")) return { schema: "feynman.scienceDatabaseSearch.v1", source: "gwascatalog", query: params.query, searchMode: command, found: false, accession_id: accessionId, study: null, provenance: { docs: "https://www.ebi.ac.uk/gwas/rest/api/v2/docs/reference", endpoints: [url.toString()] } };
			throw error;
		}
	}
	if (command === "gwas_get_variant") {
		const rsId = positional || parsed.rs_id || parsed.rsid;
		if (!rsId) throw new Error("gwas_get_variant requires an rsID.");
		const url = new URL(`${GWAS_CATALOG_BASE}/single-nucleotide-polymorphisms/${encodeURIComponent(rsId)}`);
		try {
			const variant = normalizeGwasSnpExact(recordValue(await fetchJson(url)));
			return { schema: "feynman.scienceDatabaseSearch.v1", source: "gwascatalog", query: params.query, searchMode: command, found: true, rs_id: rsId, variant, provenance: { docs: "https://www.ebi.ac.uk/gwas/rest/api/v2/docs/reference", endpoints: [url.toString()] } };
		} catch (error) {
			if (error instanceof Error && error.message.includes("404")) return { schema: "feynman.scienceDatabaseSearch.v1", source: "gwascatalog", query: params.query, searchMode: command, found: false, rs_id: rsId, variant: null, provenance: { docs: "https://www.ebi.ac.uk/gwas/rest/api/v2/docs/reference", endpoints: [url.toString()] } };
			throw error;
		}
	}
	throw new Error(`Unsupported GWAS Catalog exact command: ${command}`);
}

async function searchGwasCatalog(params: SearchParams): Promise<Record<string, unknown>> {
	const query = cleanQuery(params.query);
	const limit = safeLimit(params.limit);
	const { filter, mode, url } = gwasUrlForQuery(query, limit);
	const payload = recordValue(await fetchJson(url));
	const embedded = recordValue(payload._embedded);
	const rawResults = mode === "study"
		? [payload]
		: mode === "studies"
			? arrayValue(embedded.studies)
			: mode === "traits"
				? arrayValue(embedded.efo_traits)
				: arrayValue(embedded.associations);
	const results = rawResults.map((item) => {
		const record = recordValue(item);
		if (mode === "study" || mode === "studies") return normalizeGwasStudy(record);
		if (mode === "traits") return normalizeGwasTrait(record);
		return normalizeGwasAssociation(record);
	});
	const apiTotal = mode === "study" ? results.length : numberValue(recordValue(payload.page).totalElements) ?? results.length;
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "gwascatalog",
		query,
		mode,
		filter,
		totalCount: apiTotal,
		returned: results.length,
		truncated: apiTotal > results.length,
		results,
		provenance: {
			docs: ["https://www.ebi.ac.uk/gwas/rest/api/v2/docs", "https://www.ebi.ac.uk/gwas/rest/api/v2/docs/reference"],
			endpoints: [url.toString()],
		},
	};
}

function normalizeProteinAtlasRecord(record: Record<string, unknown>): Record<string, unknown> {
	const ensembl = stringValue(record.Ensembl);
	const gene = stringValue(record.Gene);
	return {
		gene,
		geneSynonyms: stringArray(record["Gene synonym"], 12),
		ensembl,
		uniprotAccessions: stringArray(record.Uniprot, 12),
		rnaTissueSpecificity: stringValue(record["RNA tissue specificity"]),
		rnaTissueDistribution: stringValue(record["RNA tissue distribution"]),
		rnaTissueSpecificNtpm: stringValue(record["RNA tissue specific nTPM"]),
		rnaTissueExpressionCluster: stringValue(record["RNA tissue expression cluster"]),
		url: ensembl && gene ? `https://www.proteinatlas.org/${encodeURIComponent(ensembl)}-${encodeURIComponent(gene)}` : undefined,
	};
}

async function searchProteinAtlas(params: SearchParams): Promise<Record<string, unknown>> {
	const query = cleanQuery(params.query);
	const limit = safeLimit(params.limit);
	const url = new URL(PROTEIN_ATLAS_SEARCH_URL);
	url.searchParams.set("search", query);
	url.searchParams.set("format", "json");
	url.searchParams.set("columns", "g,gs,eg,up,rnatsm,rnatpm,rnatd,rnatec");
	url.searchParams.set("compress", "no");
	const payload = await fetchJson(url);
	const rawResults = arrayValue(payload);
	const results = rawResults.map((item) => normalizeProteinAtlasRecord(recordValue(item))).slice(0, limit);
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "proteinatlas",
		query,
		totalCount: rawResults.length,
		returned: results.length,
		results,
		provenance: {
			docs: "https://www.proteinatlas.org/about/help/dataaccess",
			endpoints: [url.toString()],
		},
	};
}

export async function searchPublicAtlasScienceDatabase(params: SearchParams): Promise<Record<string, unknown>> {
	const exact = exactCommand(params.query);
	if (params.source === "eqtlcatalogue" && exact?.command.startsWith("eqtl_")) return exactEqtlCatalogue(params, exact.command, exact.rest);
	if (params.source === "gwascatalog" && exact?.command.startsWith("gwas_")) return exactGwasCatalog(params, exact.command, exact.rest);
	if (params.source === "eqtlcatalogue") return searchEqtlCatalogue(params);
	if (params.source === "gwascatalog") return searchGwasCatalog(params);
	if (params.source === "openfda") return searchOpenFda({ limit: params.limit, query: params.query, source: "openfda" });
	return searchProteinAtlas(params);
}
