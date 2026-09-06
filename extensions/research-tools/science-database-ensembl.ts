import { createHash } from "node:crypto";

export type EnsemblScienceDatabaseSource = "ensembl";

type SearchParams = {
	ensemblSpecies?: string;
	limit?: number;
	query: string;
	source: EnsemblScienceDatabaseSource;
};

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;
const REQUEST_TIMEOUT_MS = 25_000;
const ENSEMBL_REST_BASE = "https://rest.ensembl.org";
const ENSEMBL_DOCS = "https://rest.ensembl.org/";
const STABLE_ID_RE = /^(?:ENS[A-Z]*[GTPER]\d{6,}|LRG_\d+)/i;
const IMPACT_RANK: Record<string, number> = { HIGH: 0, MODERATE: 1, LOW: 2, MODIFIER: 3 };

class EnsemblRequestError extends Error {
	status: number;

	constructor(status: number, message: string) {
		super(message);
		this.name = "EnsemblRequestError";
		this.status = status;
	}
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
	if (typeof value === "number") return value !== 0;
	if (typeof value === "string" && value.trim()) return ["1", "true", "yes"].includes(value.toLowerCase());
	return undefined;
}

function cleanQuery(query: string): string {
	const clean = query.trim();
	if (!clean) throw new Error("Ensembl search requires a non-empty query.");
	return clean;
}

function safeLimit(value: number | undefined): number {
	if (!Number.isFinite(value) || value === undefined) return DEFAULT_LIMIT;
	return Math.max(1, Math.min(Math.floor(value), MAX_LIMIT));
}

function safeEnsemblSpecies(value: string | undefined): string {
	const species = value?.trim().toLowerCase() || "homo_sapiens";
	return /^[a-z][a-z0-9_-]{2,60}$/.test(species) ? species : "homo_sapiens";
}

function ensemblSpeciesPath(species: string): string {
	return species.split("_").map((part) => part ? part[0]!.toUpperCase() + part.slice(1) : part).join("_");
}

function addJsonContentType(url: URL): URL {
	url.searchParams.set("content-type", "application/json");
	return url;
}

async function fetchEnsemblJson(url: URL): Promise<unknown> {
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
		if (!response.ok) {
			let detail = response.statusText;
			try {
				detail = stringValue(recordValue(await response.json()).error) ?? detail;
			} catch {
				detail = response.statusText;
			}
			throw new EnsemblRequestError(response.status, `Ensembl REST request failed: ${response.status} ${detail}`);
		}
		return response.json();
	} finally {
		clearTimeout(timeout);
	}
}

function queryOptions(query: string): Record<string, string> {
	const options: Record<string, string> = {};
	for (const match of query.matchAll(/(?:^|\s)([a-zA-Z_][\w-]*)=("[^"]*"|'[^']*'|[^\s]+)/g)) {
		options[match[1]!.toLowerCase()] = match[2]!.replace(/^["']|["']$/g, "");
	}
	return options;
}

function removeOptions(query: string): string {
	return query.replace(/(?:^|\s)[a-zA-Z_][\w-]*=("[^"]*"|'[^']*'|[^\s]+)/g, " ").replace(/\s+/g, " ").trim();
}

function stripPrefix(query: string, prefix: string): string | undefined {
	const match = query.match(new RegExp(`^(?:${prefix})(?::|\\s+)\\s*(.*)$`, "i"));
	return match ? (match[1] ?? "").trim() : undefined;
}

function optionNumber(options: Record<string, string>, name: string, fallback?: number): number | undefined {
	const value = options[name];
	if (value === undefined) return fallback;
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) throw new Error(`Ensembl ${name}= must be numeric.`);
	return Math.floor(parsed);
}

function normalizeEnsemblRecord(record: Record<string, unknown>, species: string): Record<string, unknown> {
	const id = stringValue(record.id) ?? stringValue(record.stable_id);
	return {
		stableId: id,
		displayName: stringValue(record.display_name),
		objectType: stringValue(record.object_type),
		species: stringValue(record.species) ?? species,
		biotype: stringValue(record.biotype),
		description: stringValue(record.description),
		assemblyName: stringValue(record.assembly_name),
		seqRegionName: stringValue(record.seq_region_name),
		start: numberValue(record.start),
		end: numberValue(record.end),
		strand: numberValue(record.strand),
		transcriptCount: arrayValue(record.Transcript).length || undefined,
		url: id ? `https://www.ensembl.org/${ensemblSpeciesPath(species)}/Gene/Summary?g=${encodeURIComponent(id)}` : undefined,
	};
}

function ensemblLookupUrl(id: string): URL {
	return addJsonContentType(new URL(`${ENSEMBL_REST_BASE}/lookup/id/${encodeURIComponent(id)}`));
}

function ensemblSymbolLookupUrl(species: string, symbol: string, expand = false): URL {
	const url = addJsonContentType(new URL(`${ENSEMBL_REST_BASE}/lookup/symbol/${encodeURIComponent(species)}/${encodeURIComponent(symbol)}`));
	if (expand) url.searchParams.set("expand", "1");
	return url;
}

function impactRank(value: unknown): number {
	return IMPACT_RANK[String(value ?? "").toUpperCase()] ?? 9;
}

async function lookupRecord(query: string, species: string, expand = false): Promise<{ found: boolean; record?: Record<string, unknown>; url: URL }> {
	const url = STABLE_ID_RE.test(query)
		? ensemblLookupUrl(query)
		: ensemblSymbolLookupUrl(species, query, expand);
	if (expand && STABLE_ID_RE.test(query)) url.searchParams.set("expand", "1");
	try {
		return { found: true, record: recordValue(await fetchEnsemblJson(url)), url };
	} catch (error) {
		if (error instanceof EnsemblRequestError && [400, 404].includes(error.status)) return { found: false, url };
		throw error;
	}
}

async function searchGeneric(params: SearchParams): Promise<Record<string, unknown>> {
	const query = cleanQuery(params.query);
	const limit = safeLimit(params.limit);
	const species = safeEnsemblSpecies(params.ensemblSpecies);
	const endpoints: string[] = [];
	let seeds: Array<{ id: string; record?: Record<string, unknown>; type?: string }> = [];
	if (STABLE_ID_RE.test(query)) {
		seeds = [{ id: query }];
	} else {
		const symbolUrl = ensemblSymbolLookupUrl(species, query);
		endpoints.push(symbolUrl.toString());
		try {
			const record = recordValue(await fetchEnsemblJson(symbolUrl));
			const id = stringValue(record.id);
			if (id) seeds = [{ id, record, type: stringValue(record.object_type) }];
		} catch {
			const xrefUrl = addJsonContentType(new URL(`${ENSEMBL_REST_BASE}/xrefs/symbol/${encodeURIComponent(species)}/${encodeURIComponent(query)}`));
			endpoints.push(xrefUrl.toString());
			try {
				seeds = arrayValue(await fetchEnsemblJson(xrefUrl)).flatMap((item) => {
					const record = recordValue(item);
					const id = stringValue(record.id);
					return id ? [{ id, type: stringValue(record.type) }] : [];
				}).slice(0, limit);
			} catch (error) {
				return {
					schema: "feynman.scienceDatabaseSearch.v1",
					source: "ensembl",
					species,
					query,
					returned: 0,
					results: [],
					lookupError: error instanceof Error ? error.message : String(error),
					provenance: { docs: ENSEMBL_DOCS, endpoints },
				};
			}
		}
	}
	const lookups = await Promise.all(seeds.slice(0, limit).map(async (seed) => {
		if (seed.record) return { seed, record: seed.record };
		const url = ensemblLookupUrl(seed.id);
		endpoints.push(url.toString());
		try {
			return { seed, record: recordValue(await fetchEnsemblJson(url)) };
		} catch (error) {
			return { seed, lookupError: error instanceof Error ? error.message : String(error) };
		}
	}));
	const results = lookups.map((item) => item.record
		? normalizeEnsemblRecord(item.record, species)
		: {
			stableId: item.seed.id,
			objectType: item.seed.type,
			species,
			lookupError: item.lookupError,
			url: `https://www.ensembl.org/${ensemblSpeciesPath(species)}/Gene/Summary?g=${encodeURIComponent(item.seed.id)}`,
		});
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "ensembl",
		species,
		query,
		returned: results.length,
		results,
		provenance: { docs: ENSEMBL_DOCS, endpoints },
	};
}

async function ensemblLookup(params: SearchParams): Promise<Record<string, unknown>> {
	const query = cleanQuery(params.query);
	const species = safeEnsemblSpecies(params.ensemblSpecies);
	const options = queryOptions(query);
	const body = removeOptions(stripPrefix(query, "ensembl_lookup") ?? query);
	const target = stringValue(options.query) ?? stringValue(body);
	if (!target) throw new Error("ensembl_lookup requires a symbol or stable ID.");
	const lookup = await lookupRecord(target, options.species ?? species, booleanValue(options.expand) ?? false);
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "ensembl",
		searchMode: "ensembl-lookup",
		query: target,
		species: options.species ?? species,
		found: lookup.found,
		record: lookup.record ? normalizeEnsemblRecord(lookup.record, options.species ?? species) : undefined,
		rawRecord: lookup.record,
		results: lookup.record ? [normalizeEnsemblRecord(lookup.record, options.species ?? species)] : [],
		returned: lookup.record ? 1 : 0,
		provenance: { docs: ENSEMBL_DOCS, endpoints: [lookup.url.toString()] },
	};
}

async function ensemblXrefs(params: SearchParams): Promise<Record<string, unknown>> {
	const query = cleanQuery(params.query);
	const limit = safeLimit(params.limit);
	const options = queryOptions(query);
	const stableId = stringValue(options.stable_id) ?? stringValue(options.id) ?? stringValue(removeOptions(stripPrefix(query, "ensembl_xrefs") ?? query));
	if (!stableId) throw new Error("ensembl_xrefs requires stable_id=<id> or ensembl_xrefs:<id>.");
	const url = addJsonContentType(new URL(`${ENSEMBL_REST_BASE}/xrefs/id/${encodeURIComponent(stableId)}`));
	if (options.external_db) url.searchParams.set("external_db", options.external_db);
	const rows = arrayValue(await fetchEnsemblJson(url)).map((item) => recordValue(item))
		.sort((a, b) => String(a.dbname ?? "").localeCompare(String(b.dbname ?? "")) || String(a.primary_id ?? "").localeCompare(String(b.primary_id ?? "")));
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "ensembl",
		searchMode: "ensembl-xrefs",
		stableId,
		externalDb: options.external_db,
		nXrefs: rows.length,
		returned: Math.min(rows.length, limit),
		results: rows.slice(0, limit),
		provenance: { docs: ENSEMBL_DOCS, endpoints: [url.toString()] },
	};
}

function summarizeTranscript(record: Record<string, unknown>): Record<string, unknown> {
	return {
		geneId: stringValue(record.gene_id),
		geneSymbol: stringValue(record.gene_symbol),
		transcriptId: stringValue(record.transcript_id),
		consequenceTerms: arrayValue(record.consequence_terms).map((value) => stringValue(value)).filter(Boolean),
		impact: stringValue(record.impact),
		biotype: stringValue(record.biotype),
		canonical: numberValue(record.canonical),
		hgvsc: stringValue(record.hgvsc),
		hgvsp: stringValue(record.hgvsp),
		proteinStart: numberValue(record.protein_start),
		proteinEnd: numberValue(record.protein_end),
	};
}

function summarizeVepResult(record: Record<string, unknown>, maxConsequences: number): Record<string, unknown> {
	const transcripts = arrayValue(record.transcript_consequences)
		.map((item) => recordValue(item))
		.sort((a, b) => impactRank(a.impact) - impactRank(b.impact) || String(a.gene_id ?? "").localeCompare(String(b.gene_id ?? "")) || String(a.transcript_id ?? "").localeCompare(String(b.transcript_id ?? "")));
	const genes = [...new Set(transcripts.map((item) => stringValue(item.gene_symbol) ?? stringValue(item.gene_id)).filter((value): value is string => Boolean(value)))];
	return {
		input: stringValue(record.input),
		assemblyName: stringValue(record.assembly_name),
		seqRegionName: stringValue(record.seq_region_name),
		start: numberValue(record.start),
		end: numberValue(record.end),
		strand: numberValue(record.strand),
		alleleString: stringValue(record.allele_string),
		mostSevereConsequence: stringValue(record.most_severe_consequence),
		genes,
		nTranscriptConsequences: transcripts.length,
		transcriptConsequencesTruncated: transcripts.length > maxConsequences,
		transcriptConsequences: transcripts.slice(0, maxConsequences).map(summarizeTranscript),
		nRegulatoryFeatureConsequences: arrayValue(record.regulatory_feature_consequences).length,
		nMotifFeatureConsequences: arrayValue(record.motif_feature_consequences).length,
		colocatedVariants: arrayValue(record.colocated_variants).slice(0, maxConsequences).map((item) => {
			const colocated = recordValue(item);
			return {
				id: stringValue(colocated.id),
				start: numberValue(colocated.start),
				end: numberValue(colocated.end),
				alleleString: stringValue(colocated.allele_string),
				strand: numberValue(colocated.strand),
				frequencies: recordValue(colocated.frequencies),
			};
		}),
	};
}

async function ensemblVepVariant(params: SearchParams): Promise<Record<string, unknown>> {
	const query = cleanQuery(params.query);
	const options = queryOptions(query);
	const species = safeEnsemblSpecies(options.species ?? params.ensemblSpecies);
	const body = removeOptions(stripPrefix(query, "ensembl_vep_variant") ?? query);
	const variantId = stringValue(options.variant_id) ?? stringValue(options.id) ?? (body && !options.region && !options.allele ? body : undefined);
	const region = stringValue(options.region);
	const allele = stringValue(options.allele);
	if (variantId && (region || allele)) throw new Error("ensembl_vep_variant accepts either variant_id or region+allele, not both.");
	if (!variantId && (!region || !allele)) throw new Error("ensembl_vep_variant requires variant_id=<rsID> or region=<region> allele=<allele>.");
	const maxConsequences = Math.max(1, Math.min(optionNumber(options, "max_consequences", safeLimit(params.limit)) ?? safeLimit(params.limit), MAX_LIMIT));
	const url = variantId
		? addJsonContentType(new URL(`${ENSEMBL_REST_BASE}/vep/${encodeURIComponent(species)}/id/${encodeURIComponent(variantId)}`))
		: addJsonContentType(new URL(`${ENSEMBL_REST_BASE}/vep/${encodeURIComponent(species)}/region/${encodeURIComponent(region!)}/${encodeURIComponent(allele!)}`));
	const rows = arrayValue(await fetchEnsemblJson(url)).map((item) => summarizeVepResult(recordValue(item), maxConsequences));
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "ensembl",
		searchMode: "ensembl-vep-variant",
		query: variantId ?? `${region}/${allele}`,
		species,
		nResults: rows.length,
		returned: rows.length,
		results: rows,
		provenance: { docs: ENSEMBL_DOCS, endpoints: [url.toString()] },
	};
}

async function ensemblHomology(params: SearchParams): Promise<Record<string, unknown>> {
	const query = cleanQuery(params.query);
	const limit = safeLimit(params.limit);
	const options = queryOptions(query);
	const species = safeEnsemblSpecies(options.species ?? params.ensemblSpecies);
	const body = removeOptions(stripPrefix(query, "ensembl_homology") ?? query);
	const geneSymbol = stringValue(options.gene_symbol) ?? (!STABLE_ID_RE.test(body) ? stringValue(body) : undefined);
	let geneId = stringValue(options.gene_id) ?? (STABLE_ID_RE.test(body) ? body : undefined);
	const endpoints: string[] = [];
	if (!geneId && !geneSymbol) throw new Error("ensembl_homology requires gene_symbol=<symbol> or gene_id=<stable id>.");
	if (geneId && geneSymbol) throw new Error("ensembl_homology accepts either gene_symbol or gene_id, not both.");
	if (geneSymbol) {
		const lookup = await lookupRecord(geneSymbol, species);
		endpoints.push(lookup.url.toString());
		geneId = stringValue(lookup.record?.id);
		if (!geneId) {
			return { schema: "feynman.scienceDatabaseSearch.v1", source: "ensembl", searchMode: "ensembl-homology", found: false, geneSymbol, species, returned: 0, results: [], provenance: { docs: ENSEMBL_DOCS, endpoints } };
		}
	}
	const url = addJsonContentType(new URL(`${ENSEMBL_REST_BASE}/homology/id/${encodeURIComponent(species)}/${encodeURIComponent(geneId!)}`));
	url.searchParams.set("format", "condensed");
	url.searchParams.set("type", options.homology_type ?? "orthologues");
	if (options.target_species) url.searchParams.set("target_species", options.target_species);
	if (options.target_taxon) url.searchParams.set("target_taxon", options.target_taxon);
	endpoints.push(url.toString());
	const data = recordValue(await fetchEnsemblJson(url));
	const homologies = arrayValue(recordValue(arrayValue(data.data)[0]).homologies)
		.map((item) => {
			const row = recordValue(item);
			const target = recordValue(row.target);
			const source = recordValue(row.source);
			return {
				type: stringValue(row.type),
				methodLinkType: stringValue(row.method_link_type),
				taxonomyLevel: stringValue(row.taxonomy_level),
				sourceId: stringValue(source.id),
				targetId: stringValue(target.id),
				targetSpecies: stringValue(target.species),
				targetProteinId: stringValue(target.protein_id),
				percId: numberValue(target.perc_id),
				percPos: numberValue(target.perc_pos),
				dn: numberValue(row.dn),
				ds: numberValue(row.ds),
			};
		})
		.sort((a, b) => String(a.targetSpecies ?? "").localeCompare(String(b.targetSpecies ?? "")) || String(a.targetId ?? "").localeCompare(String(b.targetId ?? "")));
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "ensembl",
		searchMode: "ensembl-homology",
		geneId,
		geneSymbol,
		species,
		homologyType: options.homology_type ?? "orthologues",
		targetSpecies: options.target_species,
		targetTaxon: options.target_taxon,
		nTotal: homologies.length,
		homologiesTruncated: homologies.length > limit,
		returned: Math.min(homologies.length, limit),
		results: homologies.slice(0, limit),
		provenance: { docs: ENSEMBL_DOCS, endpoints },
	};
}

async function ensemblSequence(params: SearchParams): Promise<Record<string, unknown>> {
	const query = cleanQuery(params.query);
	const options = queryOptions(query);
	const species = safeEnsemblSpecies(options.species ?? params.ensemblSpecies);
	const body = removeOptions(stripPrefix(query, "ensembl_sequence") ?? query);
	const stableId = stringValue(options.stable_id) ?? stringValue(options.id) ?? (STABLE_ID_RE.test(body) ? body : undefined);
	const region = stringValue(options.region) ?? (!STABLE_ID_RE.test(body) ? stringValue(body) : undefined);
	if (stableId && region) throw new Error("ensembl_sequence accepts either stable_id or region, not both.");
	if (!stableId && !region) throw new Error("ensembl_sequence requires stable_id=<id> or region=<region>.");
	const seqType = options.seq_type ?? options.type ?? "genomic";
	const maxBytes = optionNumber(options, "max_bytes", 400_000) ?? 400_000;
	const url = stableId
		? addJsonContentType(new URL(`${ENSEMBL_REST_BASE}/sequence/id/${encodeURIComponent(stableId)}`))
		: addJsonContentType(new URL(`${ENSEMBL_REST_BASE}/sequence/region/${encodeURIComponent(species)}/${encodeURIComponent(region!)}`));
	url.searchParams.set("type", seqType);
	try {
		const payload = recordValue(await fetchEnsemblJson(url));
		const sequence = stringValue(payload.seq) ?? "";
		const bytes = Buffer.byteLength(sequence, "utf8");
		return {
			schema: "feynman.scienceDatabaseSearch.v1",
			source: "ensembl",
			searchMode: "ensembl-sequence",
			species,
			stableId,
			region,
			seqType,
			found: true,
			length: sequence.length,
			sha256: createHash("sha256").update(sequence).digest("hex"),
			seq: bytes <= maxBytes ? sequence : undefined,
			seqOmitted: bytes > maxBytes ? { reason: "sequence exceeds max_bytes", bytes, maxBytes } : undefined,
			returned: 1,
			results: [{ stableId, region, length: sequence.length, sha256: createHash("sha256").update(sequence).digest("hex") }],
			provenance: { docs: ENSEMBL_DOCS, endpoints: [url.toString()] },
		};
	} catch (error) {
		if (error instanceof EnsemblRequestError && [400, 404].includes(error.status)) {
			return { schema: "feynman.scienceDatabaseSearch.v1", source: "ensembl", searchMode: "ensembl-sequence", species, stableId, region, found: false, returned: 0, results: [], provenance: { docs: ENSEMBL_DOCS, endpoints: [url.toString()] } };
		}
		throw error;
	}
}

async function ensemblOverlapRegion(params: SearchParams): Promise<Record<string, unknown>> {
	const query = cleanQuery(params.query);
	const limit = safeLimit(params.limit);
	const options = queryOptions(query);
	const species = safeEnsemblSpecies(options.species ?? params.ensemblSpecies);
	const region = stringValue(options.region) ?? stringValue(removeOptions(stripPrefix(query, "ensembl_overlap_region") ?? query));
	if (!region) throw new Error("ensembl_overlap_region requires region=<region> or ensembl_overlap_region:<region>.");
	const feature = options.feature ?? "gene";
	const url = addJsonContentType(new URL(`${ENSEMBL_REST_BASE}/overlap/region/${encodeURIComponent(species)}/${encodeURIComponent(region)}`));
	url.searchParams.set("feature", feature);
	const rows = arrayValue(await fetchEnsemblJson(url)).map((item) => recordValue(item))
		.sort((a, b) => (numberValue(a.start) ?? 0) - (numberValue(b.start) ?? 0) || String(a.id ?? "").localeCompare(String(b.id ?? "")));
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "ensembl",
		searchMode: "ensembl-overlap-region",
		region,
		species,
		feature,
		nTotal: rows.length,
		featuresTruncated: rows.length > limit,
		returned: Math.min(rows.length, limit),
		results: rows.slice(0, limit).map((row) => ({
			id: stringValue(row.id),
			externalName: stringValue(row.external_name),
			objectType: stringValue(row.object_type),
			biotype: stringValue(row.biotype),
			description: stringValue(row.description),
			seqRegionName: stringValue(row.seq_region_name),
			start: numberValue(row.start),
			end: numberValue(row.end),
			strand: numberValue(row.strand),
			source: stringValue(row.source),
		})),
		provenance: { docs: ENSEMBL_DOCS, endpoints: [url.toString()] },
	};
}

export async function searchEnsembl(params: SearchParams): Promise<Record<string, unknown>> {
	const query = cleanQuery(params.query);
	if (/^ensembl_lookup(?::|\s|$)/i.test(query)) return ensemblLookup(params);
	if (/^ensembl_xrefs(?::|\s|$)/i.test(query)) return ensemblXrefs(params);
	if (/^ensembl_vep_variant(?::|\s|$)/i.test(query)) return ensemblVepVariant(params);
	if (/^ensembl_homology(?::|\s|$)/i.test(query)) return ensemblHomology(params);
	if (/^ensembl_sequence(?::|\s|$)/i.test(query)) return ensemblSequence(params);
	if (/^ensembl_overlap_region(?::|\s|$)/i.test(query)) return ensemblOverlapRegion(params);
	return searchGeneric(params);
}
