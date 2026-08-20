import { withNcbiRateLimit } from "./ncbi-rate-limit.js";

type SearchParams = {
	limit?: number;
	query: string;
	source: VariantScienceDatabaseSource;
};

export type VariantScienceDatabaseSource = "cadd" | "clinvar" | "dbsnp" | "variation";

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;
const REQUEST_TIMEOUT_MS = 25_000;
const CADD_API_BASE = "https://cadd.gs.washington.edu/api/v1.0";
const CADD_DEFAULT_VERSION = "GRCh38-v1.7";
const CLINVAR_EUTILS_BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
const NCBI_VARIATION_BASE = "https://api.ncbi.nlm.nih.gov/variation/v0";
const MAX_CADD_RANGE_BP = 100;
const MAX_DBSNP_REGION_SPAN = 1_000_000;
const VARIANT_SOURCES = new Set<VariantScienceDatabaseSource>(["cadd", "clinvar", "dbsnp", "variation"]);
const VARIATION_DOCS = [
	"https://api.ncbi.nlm.nih.gov/variation/v0/var_service.yaml",
	"https://ncbiinsights.ncbi.nlm.nih.gov/2017/02/09/new-web-services-for-comparing-and-grouping-sequence-variants/",
];

export function isVariantScienceDatabaseSource(source: string): source is VariantScienceDatabaseSource {
	return VARIANT_SOURCES.has(source as VariantScienceDatabaseSource);
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

function compactRecord(record: Record<string, unknown>): Record<string, unknown> {
	return Object.fromEntries(Object.entries(record).filter(([, value]) => {
		if (value === undefined || value === null) return false;
		if (Array.isArray(value)) return value.length > 0;
		if (typeof value === "object") return Object.keys(recordValue(value)).length > 0;
		return true;
	}));
}

function queryParamMap(text: string): Record<string, string> {
	const params: Record<string, string> = {};
	for (const match of text.matchAll(/\b([a-z][a-z0-9_.-]*)\s*=\s*("[^"]+"|'[^']+'|[^\s;]+)/gi)) {
		const key = match[1]?.toLowerCase();
		const raw = match[2]?.trim();
		if (key && raw) params[key] = raw.replace(/^["']|["']$/g, "");
	}
	return params;
}

function stripQueryParams(text: string): string {
	return text.replace(/\b[a-z][a-z0-9_.-]*\s*=\s*("[^"]+"|'[^']+'|[^\s;]+)/gi, " ").trim();
}

function splitTerms(value: string): string[] {
	return value.split(/[\n\r,;]+|\s+/).map((item) => item.trim()).filter(Boolean);
}

function spdiAllelePart(value: unknown): string | undefined {
	if (typeof value === "string") return value;
	if (typeof value === "number" && Number.isFinite(value)) return String(value);
	return undefined;
}

const CLINVAR_GOLD_STARS = new Map<string, number>([
	["practice guideline", 4],
	["reviewed by expert panel", 3],
	["criteria provided, multiple submitters, no conflicts", 2],
	["criteria provided, multiple submitters", 2],
	["criteria provided, conflicting classifications", 1],
	["criteria provided, conflicting interpretations", 1],
	["criteria provided, single submitter", 1],
	["no assertion criteria provided", 0],
	["no classification provided", 0],
	["no classification for the individual variant", 0],
	["no classifications from unflagged records", 0],
	["no assertion provided", 0],
]);

function dateValue(value: unknown): string | undefined {
	const text = stringValue(value);
	if (!text || text === "1/01/01 00:00") return undefined;
	return text.split(" ")[0]?.replaceAll("/", "-");
}

function xrefsFromTrait(value: unknown): Array<Record<string, unknown>> {
	return arrayValue(value).map((xref) => {
		const record = recordValue(xref);
		return compactRecord({
			db: stringValue(record.db_source) ?? stringValue(record.db),
			id: stringValue(record.db_id) ?? stringValue(record.id),
		});
	}).filter((xref) => Object.keys(xref).length > 0);
}

function normalizeClinvarTrait(record: Record<string, unknown>): Record<string, unknown> {
	return compactRecord({
		name: stringValue(record.trait_name) ?? stringValue(record.name),
		xrefs: xrefsFromTrait(record.trait_xrefs),
	});
}

function normalizeClinvarClassification(value: unknown): Record<string, unknown> | undefined {
	const block = recordValue(value);
	const description = stringValue(block.description);
	const reviewStatus = stringValue(block.review_status);
	if (!description && !reviewStatus) return undefined;
	const goldStars = reviewStatus ? CLINVAR_GOLD_STARS.get(reviewStatus.toLowerCase()) : undefined;
	return compactRecord({
		description,
		reviewStatus,
		goldStars,
		lastEvaluated: dateValue(block.last_evaluated),
		fdaRecognizedDatabase: stringValue(block.fda_recognized_database),
		conditions: arrayValue(block.trait_set).map((trait) => normalizeClinvarTrait(recordValue(trait))),
	});
}

function normalizeClinvarLocation(variationSet: unknown): Array<Record<string, unknown>> {
	return arrayValue(variationSet).flatMap((variation) => {
		const record = recordValue(variation);
		return arrayValue(record.variation_loc).map((location) => {
			const item = recordValue(location);
			return compactRecord({
				status: stringValue(item.status),
				assembly: stringValue(item.assembly_name),
				chrom: stringValue(item.chr),
				band: stringValue(item.band),
				start: numberValue(item.start),
				stop: numberValue(item.stop),
				ref: stringValue(item.ref),
				alt: stringValue(item.alt),
			});
		});
	});
}

function normalizeClinvarGene(record: Record<string, unknown>): Record<string, unknown> {
	return compactRecord({
		symbol: stringValue(record.symbol),
		geneId: stringValue(record.geneid) ?? stringValue(record.gene_id),
		strand: stringValue(record.strand),
		source: stringValue(record.source),
	});
}

function normalizeClinvarRecord(record: Record<string, unknown>): Record<string, unknown> {
	const uid = stringValue(record.uid);
	const variationSet = arrayValue(record.variation_set);
	const primaryVariation = recordValue(variationSet[0]);
	const xrefs = arrayValue(primaryVariation.variation_xrefs).map((xref) => recordValue(xref));
	const rsids = xrefs
		.filter((xref) => stringValue(xref.db_source)?.toLowerCase() === "dbsnp" || stringValue(xref.db)?.toLowerCase() === "dbsnp")
		.map((xref) => stringValue(xref.db_id) ?? stringValue(xref.id))
		.filter((id): id is string => Boolean(id))
		.map((id) => id.toLowerCase().startsWith("rs") ? id : `rs${id}`)
		.sort();
	const otherXrefs = xrefs
		.filter((xref) => (stringValue(xref.db_source)?.toLowerCase() ?? stringValue(xref.db)?.toLowerCase()) !== "dbsnp")
		.map((xref) => compactRecord({
			db: stringValue(xref.db_source) ?? stringValue(xref.db),
			id: stringValue(xref.db_id) ?? stringValue(xref.id),
		}))
		.filter((xref) => Object.keys(xref).length > 0);
	const scv = arrayValue(recordValue(record.supporting_submissions).scv).map(String).sort();
	const rcv = arrayValue(recordValue(record.supporting_submissions).rcv).map(String).sort();
	return compactRecord({
		uid,
		variationId: numberValue(record.uid) ?? numberValue(primaryVariation.variation_id),
		accession: stringValue(record.accession),
		accessionVersion: stringValue(record.accession_version),
		title: stringValue(record.title),
		objectType: stringValue(record.obj_type),
		variantType: stringValue(primaryVariation.variant_type) ?? stringValue(record.variant_type),
		canonicalSpdi: stringValue(primaryVariation.canonical_spdi),
		cdnaChange: stringValue(primaryVariation.cdna_change),
		proteinChange: stringValue(record.protein_change) ?? stringValue(primaryVariation.protein_change),
		rsids,
		otherXrefs,
		genes: arrayValue(record.genes).map((gene) => normalizeClinvarGene(recordValue(gene))),
		molecularConsequences: arrayValue(record.molecular_consequence_list).map(String),
		locations: normalizeClinvarLocation(variationSet),
		germlineClassification: normalizeClinvarClassification(record.germline_classification ?? record.clinical_significance),
		clinicalImpactClassification: normalizeClinvarClassification(record.clinical_impact_classification),
		oncogenicityClassification: normalizeClinvarClassification(record.oncogenicity_classification),
		submissionCount: scv.length || numberValue(record.submitter_count),
		supportingSubmissions: compactRecord({ scv, rcv }),
		url: uid ? `https://www.ncbi.nlm.nih.gov/clinvar/variation/${encodeURIComponent(uid)}/` : undefined,
	});
}

async function searchClinvar(params: SearchParams): Promise<Record<string, unknown>> {
	const query = cleanQuery(params.query);
	const limit = safeLimit(params.limit);
	const searchUrl = new URL(`${CLINVAR_EUTILS_BASE}/esearch.fcgi`);
	for (const [key, value] of Object.entries(ncbiIdentityParams())) searchUrl.searchParams.set(key, value);
	searchUrl.searchParams.set("db", "clinvar");
	searchUrl.searchParams.set("term", query);
	searchUrl.searchParams.set("retmode", "json");
	searchUrl.searchParams.set("retmax", String(limit));
	const searchPayload = recordValue(await fetchJson(searchUrl));
	const searchResult = recordValue(searchPayload.esearchresult);
	const ids = arrayValue(searchResult.idlist).map(String).filter(Boolean);
	const endpoints = [searchUrl.toString()];
	let results: Record<string, unknown>[] = [];
	if (ids.length) {
		const summaryUrl = new URL(`${CLINVAR_EUTILS_BASE}/esummary.fcgi`);
		for (const [key, value] of Object.entries(ncbiIdentityParams())) summaryUrl.searchParams.set(key, value);
		summaryUrl.searchParams.set("db", "clinvar");
		summaryUrl.searchParams.set("id", ids.join(","));
		summaryUrl.searchParams.set("retmode", "json");
		summaryUrl.searchParams.set("version", "2.0");
		endpoints.push(summaryUrl.toString());
		const summaryPayload = recordValue(await fetchJson(summaryUrl));
		const summary = recordValue(summaryPayload.result);
		results = ids
			.map((id) => recordValue(summary[id]))
			.filter((record) => Object.keys(record).length > 0 && !record.error)
			.map((record) => normalizeClinvarRecord(record));
	}
	const totalCount = numberValue(searchResult.count) ?? results.length;
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "clinvar",
		query,
		totalCount,
		returned: results.length,
		truncated: totalCount > ids.length,
		results,
		provenance: {
			docs: ["https://www.ncbi.nlm.nih.gov/clinvar/docs/programmatic_access/", "https://www.ncbi.nlm.nih.gov/books/NBK25499/"],
			endpoints,
		},
	};
}

function clinvarUidFromAccession(accession: string): string | undefined {
	const clean = accession.trim();
	const vcv = /^VCV0*(\d+)(?:\.\d+)?$/i.exec(clean);
	if (vcv?.[1]) return String(Number(vcv[1]));
	if (/^\d+$/.test(clean)) return String(Number(clean));
	return undefined;
}

async function clinvarSearchIds(term: string, limit: number, endpoints: string[]): Promise<{ ids: string[]; total: number }> {
	const url = new URL(`${CLINVAR_EUTILS_BASE}/esearch.fcgi`);
	for (const [key, value] of Object.entries(ncbiIdentityParams())) url.searchParams.set(key, value);
	url.searchParams.set("db", "clinvar");
	url.searchParams.set("term", term);
	url.searchParams.set("retmode", "json");
	url.searchParams.set("retmax", String(limit));
	endpoints.push(url.toString());
	const payload = recordValue(await fetchJson(url));
	const result = recordValue(payload.esearchresult);
	return {
		ids: arrayValue(result.idlist).map(String).filter(Boolean),
		total: numberValue(result.count) ?? 0,
	};
}

async function clinvarSummaries(ids: string[], endpoints: string[]): Promise<Record<string, unknown>[]> {
	if (!ids.length) return [];
	const url = new URL(`${CLINVAR_EUTILS_BASE}/esummary.fcgi`);
	for (const [key, value] of Object.entries(ncbiIdentityParams())) url.searchParams.set(key, value);
	url.searchParams.set("db", "clinvar");
	url.searchParams.set("id", ids.join(","));
	url.searchParams.set("retmode", "json");
	url.searchParams.set("version", "2.0");
	endpoints.push(url.toString());
	const payload = recordValue(await fetchJson(url));
	const result = recordValue(payload.result);
	return ids.map((id) => recordValue(result[id])).filter((record) => Object.keys(record).length > 0 && !record.error).map((record) => normalizeClinvarRecord(record));
}

async function clinvarRecordsByAccessions(query: string, accessions: string[]): Promise<Record<string, unknown>> {
	const endpoints: string[] = [];
	const uidSources: Record<string, string[]> = {};
	const notFound: string[] = [];
	for (const accession of accessions) {
		const uid = clinvarUidFromAccession(accession);
		if (uid) {
			uidSources[uid] = [...(uidSources[uid] ?? []), accession];
			continue;
		}
		if (/^RCV\d+(?:\.\d+)?$/i.test(accession)) {
			const result = await clinvarSearchIds(accession.toUpperCase().split(".")[0]!, 5, endpoints);
			if (!result.ids.length) notFound.push(accession);
			for (const id of result.ids) uidSources[id] = [...(uidSources[id] ?? []), accession];
			continue;
		}
		if (/^rs\d+$/i.test(accession)) throw new Error(`${accession} is an rsID; use clinvar_variant_by_rsid.`);
		throw new Error(`Unrecognized ClinVar accession ${accession}; expected VCV, RCV, or a numeric variation ID.`);
	}
	const ids = Object.keys(uidSources);
	const records = (await clinvarSummaries(ids, endpoints)).map((record) => ({ ...record, requestedAs: uidSources[String(record.variationId) || String(record.uid)] ?? [] }));
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "clinvar",
		query,
		searchMode: "clinvar_get_records",
		n_requested: accessions.length,
		totalCount: records.length,
		returned: records.length,
		notFound,
		results: records,
		provenance: {
			docs: ["https://www.ncbi.nlm.nih.gov/clinvar/docs/programmatic_access/", "https://www.ncbi.nlm.nih.gov/books/NBK25499/"],
			endpoints,
		},
	};
}

async function clinvarRecordsByRsid(query: string, rsid: string, limit: number): Promise<Record<string, unknown>> {
	if (!/^rs\d+$/i.test(rsid)) throw new Error(`clinvar_variant_by_rsid requires an rsID; got ${rsid}.`);
	const endpoints: string[] = [];
	const search = await clinvarSearchIds(rsid.toLowerCase(), limit, endpoints);
	const records = await clinvarSummaries(search.ids, endpoints);
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "clinvar",
		query,
		searchMode: "clinvar_variant_by_rsid",
		rsid: rsid.toLowerCase(),
		totalCount: search.total,
		returned: records.length,
		truncated: search.total > search.ids.length,
		results: records,
		provenance: {
			docs: ["https://www.ncbi.nlm.nih.gov/clinvar/docs/programmatic_access/", "https://www.ncbi.nlm.nih.gov/books/NBK25499/"],
			endpoints,
		},
	};
}

const DBSNP_CHROMOSOME_ACCESSIONS: Record<string, string> = {
	...Object.fromEntries(Array.from({ length: 22 }, (_, index) => [`NC_${String(index + 1).padStart(6, "0")}`, String(index + 1)])),
	NC_000023: "X",
	NC_000024: "Y",
	NC_012920: "MT",
};

function refsnpChromosome(seqId: string | undefined): string | undefined {
	if (!seqId) return undefined;
	return DBSNP_CHROMOSOME_ACCESSIONS[seqId.split(".")[0] ?? ""];
}

function spdiString(spdi: Record<string, unknown>): string | undefined {
	const seqId = stringValue(spdi.seq_id);
	const position = numberValue(spdi.position);
	const deleted = spdiAllelePart(spdi.deleted_sequence);
	const inserted = spdiAllelePart(spdi.inserted_sequence);
	return seqId && position !== undefined && deleted !== undefined && inserted !== undefined ? `${seqId}:${position}:${deleted}:${inserted}` : undefined;
}

function normalizeDbsnpFrequency(record: Record<string, unknown>): Record<string, unknown> {
	const alleleCount = numberValue(record.allele_count);
	const totalCount = numberValue(record.total_count);
	return compactRecord({
		study: stringValue(record.study_name),
		studyVersion: numberValue(record.study_version),
		alleleCount,
		totalCount,
		alleleFrequency: alleleCount !== undefined && totalCount ? Number((alleleCount / totalCount).toFixed(6)) : undefined,
	});
}

function normalizeDbsnpClinical(record: Record<string, unknown>): Record<string, unknown> {
	return compactRecord({
		rcvAccession: stringValue(record.accession_version) ?? stringValue(record.rcv_accession),
		clinicalSignificances: arrayValue(record.clinical_significances).map(String),
		reviewStatus: stringValue(record.review_status),
		lastEvaluatedDate: stringValue(record.last_evaluated_date),
		diseaseNames: arrayValue(record.disease_names).map(String),
	});
}

function normalizeDbsnpGenes(annotation: Record<string, unknown>, maneIds: Set<string>): Array<Record<string, unknown>> {
	return arrayValue(annotation.assembly_annotation).flatMap((assembly) => {
		const assemblyRecord = recordValue(assembly);
		return arrayValue(assemblyRecord.genes).map((gene) => {
			const geneRecord = recordValue(gene);
			const consequences = new Set<string>();
			const maneSelect = arrayValue(geneRecord.rnas).flatMap((rna) => {
				const rnaRecord = recordValue(rna);
				for (const so of arrayValue(rnaRecord.sequence_ontology)) {
					const name = stringValue(recordValue(so).name);
					if (name) consequences.add(name);
				}
				const protein = recordValue(rnaRecord.protein);
				for (const so of arrayValue(protein.sequence_ontology)) {
					const name = stringValue(recordValue(so).name);
					if (name) consequences.add(name);
				}
				if (!maneIds.has(stringValue(rnaRecord.id) ?? "")) return [];
				const proteinSpdi = recordValue(recordValue(protein.variant).spdi);
				return [compactRecord({
					transcriptHgvs: stringValue(rnaRecord.hgvs),
					proteinSpdi: spdiString(proteinSpdi),
				})];
			});
			return compactRecord({
				symbol: stringValue(geneRecord.locus),
				geneId: stringValue(geneRecord.id),
				name: stringValue(geneRecord.name),
				orientation: stringValue(geneRecord.orientation),
				consequences: Array.from(consequences).sort(),
				maneSelect,
			});
		});
	});
}

function normalizeDbsnpPlacement(record: Record<string, unknown>): Record<string, unknown> | undefined {
	const traits = arrayValue(recordValue(record.placement_annot).seq_id_traits_by_assembly);
	const chromosomeTrait = traits.map((trait) => recordValue(trait)).find((trait) => Boolean(trait.is_chromosome)) ?? recordValue(traits[0]);
	const alleleSpdis = arrayValue(record.alleles)
		.map((allele) => recordValue(recordValue(recordValue(allele).allele).spdi))
		.filter((spdi) => Object.keys(spdi).length > 0);
	if (!alleleSpdis.length) return undefined;
	const ref = stringValue(alleleSpdis[0]?.deleted_sequence);
	const alts = Array.from(new Set(alleleSpdis
		.map((spdi) => stringValue(spdi.inserted_sequence))
		.filter((alt): alt is string => Boolean(alt && alt !== ref))))
		.sort();
	const seqId = stringValue(record.seq_id);
	return compactRecord({
		assembly: stringValue(chromosomeTrait.assembly_name)?.split(".")[0],
		assemblyFull: stringValue(chromosomeTrait.assembly_name),
		seqId,
		chrom: refsnpChromosome(seqId),
		position: numberValue(alleleSpdis[0]?.position) === undefined ? undefined : numberValue(alleleSpdis[0]?.position)! + 1,
		ref,
		alts,
		isPrimary: Boolean(record.is_ptlp),
	});
}

function normalizeDbsnpRecord(record: Record<string, unknown>): Record<string, unknown> {
	const refsnpId = numberValue(record.refsnp_id);
	const rsid = refsnpId === undefined ? undefined : `rs${refsnpId}`;
	const citations = arrayValue(record.citations).map(String);
	const base = compactRecord({
		rsid,
		refsnpId,
		createDate: stringValue(record.create_date),
		lastUpdateDate: stringValue(record.last_update_date),
		lastUpdateBuildId: stringValue(record.last_update_build_id),
		citationCount: citations.length,
		citationPmids: citations.slice(0, 20),
		citationsTruncated: citations.length > 20,
		url: rsid ? `https://www.ncbi.nlm.nih.gov/snp/${encodeURIComponent(rsid)}` : undefined,
	});
	const merged = arrayValue(recordValue(record.merged_snapshot_data).merged_into).map((id) => `rs${id}`).sort();
	if (merged.length) return { ...base, status: "merged", mergedInto: merged };
	const primary = recordValue(record.primary_snapshot_data);
	if (!Object.keys(primary).length) return { ...base, status: "no_data" };
	const placements = arrayValue(primary.placements_with_allele)
		.map((placement) => normalizeDbsnpPlacement(recordValue(placement)))
		.filter((placement): placement is Record<string, unknown> => Boolean(placement));
	const maneIds = new Set(arrayValue(record.mane_select_ids).map(String));
	const primaryPlacement = arrayValue(primary.placements_with_allele).map((placement) => recordValue(placement)).find((placement) => Boolean(placement.is_ptlp));
	const annotations = arrayValue(primary.allele_annotations).map((annotation) => recordValue(annotation));
	const alleles = primaryPlacement ? arrayValue(primaryPlacement.alleles).flatMap((allele, index) => {
		const alleleRecord = recordValue(allele);
		const spdi = recordValue(recordValue(alleleRecord.allele).spdi);
		const ref = stringValue(spdi.deleted_sequence);
		const alt = stringValue(spdi.inserted_sequence);
		if (!alt || alt === ref) return [];
		const annotation = annotations[index] ?? {};
		return [compactRecord({
			allele: alt,
			ref,
			spdi: spdiString(spdi),
			hgvs: stringValue(alleleRecord.hgvs),
			frequencies: arrayValue(annotation.frequency).map((frequency) => normalizeDbsnpFrequency(recordValue(frequency))),
			clinvar: arrayValue(annotation.clinical).map((clinical) => normalizeDbsnpClinical(recordValue(clinical))),
			genes: normalizeDbsnpGenes(annotation, maneIds),
		})];
	}) : [];
	return {
		...base,
		status: "live",
		variantType: stringValue(primary.variant_type),
		maneSelectIds: Array.from(maneIds).sort(),
		placements,
		alleles,
	};
}

function parseRsids(query: string, limit: number): string[] {
	const matches = query.match(/(?:^|[\s,;])(?:rs)?\d+(?=$|[\s,;])/gi) ?? [];
	const rsids = matches
		.map((match) => match.replace(/^[\s,;]*/, ""))
		.map((match) => match.toLowerCase().startsWith("rs") ? match.toLowerCase() : `rs${match}`)
		.map((match) => match.replace(/^rs0+(\d)/, "rs$1"));
	if (!rsids.length) throw new Error("dbSNP search requires one or more rsIDs, for example rs7412.");
	return Array.from(new Set(rsids)).slice(0, limit);
}

async function searchDbsnp(params: SearchParams): Promise<Record<string, unknown>> {
	const query = cleanQuery(params.query);
	const limit = safeLimit(params.limit);
	const rsids = parseRsids(query, limit);
	const records: Record<string, unknown>[] = [];
	const notFound: string[] = [];
	const endpoints: string[] = [];
	for (const rsid of rsids) {
		const number = rsid.replace(/^rs/i, "");
		const url = new URL(`${NCBI_VARIATION_BASE}/refsnp/${encodeURIComponent(number)}`);
		endpoints.push(url.toString());
		try {
			records.push(normalizeDbsnpRecord(recordValue(await fetchJson(url))));
		} catch (error) {
			notFound.push(rsid);
			if (error instanceof Error && !/404|not found/i.test(error.message)) throw error;
		}
	}
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "dbsnp",
		query,
		rsids,
		returned: records.length,
		notFound,
		results: records,
		provenance: {
			docs: "https://github.com/PharmGKB/ncbi-var-services",
			endpoints,
		},
	};
}

function normalizeDbsnpChrom(chrom: string): string {
	const clean = chrom.trim().toUpperCase().replace(/^CHR/, "");
	if (!/^([1-9]|1\d|2[0-2]|X|Y|MT)$/.test(clean)) throw new Error(`dbsnp_search_by_region chromosome must be 1-22, X, Y, or MT; got ${chrom}.`);
	return clean;
}

async function dbsnpSearchByRegion(query: string, chrom: string, start: number, stop: number, assembly: string, maxRsids: number): Promise<Record<string, unknown>> {
	const normalizedAssembly = assembly.toUpperCase();
	const field = normalizedAssembly === "GRCH37" ? "CPOS_GRCH37" : normalizedAssembly === "GRCH38" ? "CPOS" : undefined;
	if (!field) throw new Error(`dbsnp_search_by_region assembly must be GRCh38 or GRCh37; got ${assembly}.`);
	if (!Number.isInteger(start) || !Number.isInteger(stop) || start < 1 || stop < start) throw new Error("dbsnp_search_by_region requires 0 < start <= stop.");
	if (stop - start > MAX_DBSNP_REGION_SPAN) throw new Error("dbsnp_search_by_region spans more than 1,000,000 bp; split the query.");
	const url = new URL(`${CLINVAR_EUTILS_BASE}/esearch.fcgi`);
	for (const [key, value] of Object.entries(ncbiIdentityParams())) url.searchParams.set(key, value);
	const normalizedChrom = normalizeDbsnpChrom(chrom);
	const retmax = Math.max(1, Math.min(Math.floor(maxRsids), 1000));
	const term = `${normalizedChrom}[CHR] AND ${start}:${stop}[${field}] AND homo sapiens[ORGN]`;
	url.searchParams.set("db", "snp");
	url.searchParams.set("term", term);
	url.searchParams.set("retmode", "json");
	url.searchParams.set("retmax", String(retmax));
	const payload = recordValue(await fetchJson(url));
	const result = recordValue(payload.esearchresult);
	const ids = arrayValue(result.idlist).map((id) => `rs${id}`).sort();
	const total = numberValue(result.count) ?? ids.length;
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "dbsnp",
		query,
		searchMode: "dbsnp_search_by_region",
		chrom: normalizedChrom,
		start,
		stop,
		assembly: field === "CPOS_GRCH37" ? "GRCh37" : "GRCh38",
		term,
		totalCount: total,
		returned: ids.length,
		truncated: total > ids.length,
		rsids: ids,
		results: ids.map((rsid) => ({ rsid, url: `https://www.ncbi.nlm.nih.gov/snp/${encodeURIComponent(rsid)}` })),
		provenance: {
			docs: ["https://www.ncbi.nlm.nih.gov/books/NBK25499/", "https://api.ncbi.nlm.nih.gov/variation/v0/var_service.yaml"],
			endpoints: [url.toString()],
		},
	};
}

type VariationInput = {
	assembly?: string;
	input: string;
	inputs?: string[];
	inputType: "hgvs" | "hgvs_batch" | "spdi";
};

function isSpdiExpression(input: string): boolean {
	const parts = input.split(":");
	return parts.length === 4 && Boolean(parts[0]) && /^\d+$/.test(parts[1] ?? "");
}

function splitHgvsBatchInput(input: string): string[] {
	return input.replace(/\r/g, "\n").split(/[\n;]+/).map((item) => item.trim()).filter(Boolean);
}

function parseVariationInput(query: string): VariationInput {
	let input = cleanQuery(query);
	let assembly: string | undefined;
	input = input.replace(/\bassembly[:=]([A-Za-z0-9_.-]+)/i, (_match, value: string) => {
		assembly = value;
		return "";
	}).trim();
	const inputs = splitHgvsBatchInput(input);
	if (inputs.length > 1) {
		if (inputs.some(isSpdiExpression)) {
			throw new Error("Batch variation normalization currently accepts HGVS expressions; use one SPDI expression at a time.");
		}
		return { input: inputs.join("\n"), inputs, inputType: "hgvs_batch", assembly };
	}
	const inputType = isSpdiExpression(input) ? "spdi" : "hgvs";
	return { input: cleanQuery(input), inputType, assembly };
}

function spdiRecordFromExpression(input: string): Record<string, unknown> | undefined {
	const parts = input.split(":");
	if (parts.length !== 4 || !parts[0] || !/^\d+$/.test(parts[1] ?? "")) return undefined;
	return { seq_id: parts[0], position: Number(parts[1]), deleted_sequence: parts[2] ?? "", inserted_sequence: parts[3] ?? "" };
}

function variationPathSegment(value: string): string {
	return encodeURIComponent(value).replaceAll("%3A", ":").replaceAll("%3a", ":");
}

function variationEndpoint(kind: "hgvs" | "spdi", value: string, action: string): URL {
	return new URL(`${NCBI_VARIATION_BASE}/${kind}/${variationPathSegment(value)}/${action}`);
}

function normalizeVariationSpdi(value: unknown): Record<string, unknown> | undefined {
	const record = recordValue(value);
	const seqId = stringValue(record.seq_id);
	const position = numberValue(record.position);
	const deletedSequence = spdiAllelePart(record.deleted_sequence);
	const insertedSequence = spdiAllelePart(record.inserted_sequence);
	if (!seqId || position === undefined || deletedSequence === undefined || insertedSequence === undefined) return undefined;
	return compactRecord({
		spdi: spdiString(record),
		seqId,
		position,
		deletedSequence,
		insertedSequence,
	});
}

function normalizeVariationVcfFields(value: unknown): Record<string, unknown> | undefined {
	const record = recordValue(value);
	const fields = compactRecord({
		chrom: stringValue(record.chrom),
		pos: numberValue(record.pos),
		ref: spdiAllelePart(record.ref),
		alt: spdiAllelePart(record.alt),
	});
	return Object.keys(fields).length ? fields : undefined;
}

function normalizeVariationRsids(value: unknown): string[] {
	const data = recordValue(value).data ?? value;
	const raw = Array.isArray(data) ? data : arrayValue(recordValue(data).rsids);
	return raw
		.map((id) => stringValue(id) ?? (numberValue(id) === undefined ? undefined : String(numberValue(id))))
		.filter((id): id is string => Boolean(id))
		.map((id) => id.toLowerCase().startsWith("rs") ? id : `rs${id}`)
		.sort();
}

async function optionalVariationJson(
	url: URL,
	endpoints: string[],
	warnings: Array<Record<string, unknown>>,
): Promise<unknown | undefined> {
	endpoints.push(url.toString());
	try {
		return await fetchJson(url);
	} catch (error) {
		warnings.push(compactRecord({
			endpoint: url.toString(),
			error: error instanceof Error ? error.message : String(error),
		}));
		return undefined;
	}
}

async function enrichVariationContextualSpdi(
	input: string,
	inputType: VariationInput["inputType"],
	contextual: Record<string, unknown>,
	endpoints: string[],
	warnings: Array<Record<string, unknown>>,
): Promise<Record<string, unknown>> {
	const contextualSpdi = spdiString(contextual);
	if (!contextualSpdi) {
		return compactRecord({
			input,
			inputType,
			contextual: normalizeVariationSpdi(contextual),
		});
	}
	const canonicalPayload = await optionalVariationJson(variationEndpoint("spdi", contextualSpdi, "canonical_representative"), endpoints, warnings);
	const hgvsPayload = await optionalVariationJson(variationEndpoint("spdi", contextualSpdi, "hgvs"), endpoints, warnings);
	const rsidPayload = await optionalVariationJson(variationEndpoint("spdi", contextualSpdi, "rsids"), endpoints, warnings);
	const vcfPayload = await optionalVariationJson(variationEndpoint("spdi", contextualSpdi, "vcf_fields"), endpoints, warnings);
	const canonical = normalizeVariationSpdi(recordValue(canonicalPayload).data);
	const hgvs = stringValue(recordValue(recordValue(hgvsPayload).data).hgvs);
	const vcfFields = normalizeVariationVcfFields(recordValue(recordValue(vcfPayload).data));
	return compactRecord({
		input,
		inputType,
		contextual: normalizeVariationSpdi(contextual),
		contextualSpdi,
		canonical,
		canonicalSpdi: canonical?.spdi,
		hgvs,
		rsids: normalizeVariationRsids(rsidPayload),
		vcfFields,
	});
}

function normalizeVariationBatchItem(item: Record<string, unknown>, index: number): Record<string, unknown> {
	const alleles = recordValue(item.alleles);
	const spdis = arrayValue(alleles.spdis)
		.map((spdi) => normalizeVariationSpdi(spdi))
		.filter((spdi): spdi is Record<string, unknown> => Boolean(spdi));
	return compactRecord({
		index,
		input: stringValue(item.hgvs),
		inputType: "hgvs",
		inputHgvsValidity: stringValue(item.input_hgvs_validity),
		contextuals: spdis,
		contextualSpdis: spdis.map((spdi) => stringValue(spdi.spdi)).filter(Boolean),
		warnings: arrayValue(alleles.warnings).map((warning) => compactRecord(recordValue(warning))),
		errors: recordValue(item.errors),
	});
}

async function searchVariationBatch(query: string, input: VariationInput, limit: number): Promise<Record<string, unknown>> {
	const inputs = (input.inputs ?? []).slice(0, limit);
	const url = new URL(`${NCBI_VARIATION_BASE}/hgvs/batch/contextuals`);
	if (input.assembly) url.searchParams.set("assembly", input.assembly);
	const payload = recordValue(await fetchJson(url, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ hgvs: inputs }),
	}));
	const batchItems = arrayValue(payload.data).map((item, index) => normalizeVariationBatchItem(recordValue(item), index));
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "variation",
		query,
		input: input.input,
		inputs,
		inputType: "hgvs_batch",
		searchMode: "hgvs-batch-contextuals",
		...(input.assembly ? { assembly: input.assembly } : {}),
		totalCount: input.inputs?.length ?? inputs.length,
		returned: batchItems.length,
		truncated: (input.inputs?.length ?? inputs.length) > inputs.length,
		results: batchItems,
		provenance: {
			docs: VARIATION_DOCS,
			endpoints: [url.toString()],
		},
	};
}

async function searchVariation(params: SearchParams): Promise<Record<string, unknown>> {
	const query = cleanQuery(params.query);
	const limit = safeLimit(params.limit);
	const input = parseVariationInput(query);
	if (input.inputType === "hgvs_batch") return searchVariationBatch(query, input, limit);
	const endpoints: string[] = [];
	const warnings: Array<Record<string, unknown>> = [];
	let contextuals: Record<string, unknown>[] = [];
	let inputHgvsValidity: string | undefined;
	if (input.inputType === "spdi") {
		const url = variationEndpoint("spdi", input.input, "contextual");
		const payload = await optionalVariationJson(url, endpoints, warnings);
		const contextual = recordValue(recordValue(payload).data);
		const fallback = spdiRecordFromExpression(input.input);
		contextuals = Object.keys(contextual).length ? [contextual] : fallback ? [fallback] : [];
	} else {
		const url = variationEndpoint("hgvs", input.input, "contextuals");
		if (input.assembly) url.searchParams.set("assembly", input.assembly);
		endpoints.push(url.toString());
		const payload = recordValue(await fetchJson(url));
		const data = recordValue(payload.data);
		inputHgvsValidity = stringValue(data.input_hgvs_validity);
		contextuals = arrayValue(data.spdis).map((item) => recordValue(item));
	}
	const selected = contextuals.slice(0, limit);
	const results: Record<string, unknown>[] = [];
	for (const contextual of selected) {
		results.push(await enrichVariationContextualSpdi(input.input, input.inputType, contextual, endpoints, warnings));
	}
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "variation",
		query,
		input: input.input,
		inputType: input.inputType,
		searchMode: input.inputType === "spdi" ? "spdi-contextual" : "hgvs-contextuals",
		...(input.assembly ? { assembly: input.assembly } : {}),
		...(inputHgvsValidity ? { inputHgvsValidity } : {}),
		totalCount: contextuals.length,
		returned: results.length,
		truncated: contextuals.length > results.length,
		results,
		...(warnings.length ? { warnings } : {}),
		provenance: {
			docs: VARIATION_DOCS,
			endpoints,
		},
	};
}

function normalizeCaddChrom(chrom: string): string {
	const clean = chrom.replace(/^chr/i, "").toUpperCase();
	if (!(/^([1-9]|1\d|2[0-2]|X|Y)$/.test(clean))) {
		throw new Error(`CADD SNV lookup requires a nuclear chromosome 1-22, X, or Y; got ${chrom}.`);
	}
	return clean;
}

function normalizeCaddBase(base: string, name: string): string {
	const clean = base.toUpperCase();
	if (!/^[ACGT]$/.test(clean)) throw new Error(`CADD ${name} must be a single A/C/G/T base; got ${base}.`);
	return clean;
}

function parseCaddQuery(query: string): { alt: string; chrom: string; pos: number; ref: string; version: string } {
	let clean = query.trim();
	let version = CADD_DEFAULT_VERSION;
	const versionMatch = clean.match(/\b(?:GRCh3[78]-v\d+\.\d+(?:_inclAnno)?|v1\.[0-3])\b/i);
	if (versionMatch?.[0]) {
		version = versionMatch[0];
		clean = clean.replace(versionMatch[0], " ");
	}
	if (!/^(?:GRCh3[78]-v\d+\.\d+(?:_inclAnno)?|v1\.[0-3])$/.test(version)) {
		throw new Error(`Invalid CADD version ${version}; use a build-qualified version such as GRCh38-v1.7.`);
	}
	const parts = clean
		.replaceAll(",", " ")
		.replaceAll(">", " ")
		.replaceAll("_", " ")
		.replaceAll("-", " ")
		.replaceAll(":", " ")
		.split(/\s+/)
		.filter(Boolean);
	if (parts.length < 4) {
		throw new Error("CADD search requires one SNV as chrom-pos-ref-alt, for example 19-44908822-C-T or GRCh38-v1.7 19:44908822 C T.");
	}
	const [chromRaw, posRaw, refRaw, altRaw] = parts;
	const pos = Number(posRaw);
	if (!Number.isInteger(pos) || pos < 1) throw new Error(`CADD position must be a positive integer; got ${posRaw}.`);
	const ref = normalizeCaddBase(refRaw!, "ref");
	const alt = normalizeCaddBase(altRaw!, "alt");
	if (ref === alt) throw new Error("CADD ref and alt must differ.");
	return {
		version,
		chrom: normalizeCaddChrom(chromRaw!),
		pos,
		ref,
		alt,
	};
}

function normalizeCaddRecord(record: Record<string, unknown>, query: ReturnType<typeof parseCaddQuery>): Record<string, unknown> {
	const chrom = stringValue(record.Chrom) ?? stringValue(record.chrom) ?? query.chrom;
	const pos = numberValue(record.Pos) ?? numberValue(record.pos) ?? query.pos;
	const ref = stringValue(record.Ref) ?? stringValue(record.ref) ?? query.ref;
	const alt = stringValue(record.Alt) ?? stringValue(record.alt) ?? query.alt;
	return compactRecord({
		chrom,
		pos,
		ref,
		alt,
		version: query.version,
		rawScore: stringValue(record.RawScore) ?? stringValue(record.raw_score) ?? stringValue(record.rawScore),
		phred: stringValue(record.PHRED) ?? stringValue(record.phred),
		url: `https://cadd.gs.washington.edu/snv?chrom=${encodeURIComponent(chrom ?? query.chrom)}&pos=${encodeURIComponent(String(pos ?? query.pos))}&ref=${encodeURIComponent(ref ?? query.ref)}&alt=${encodeURIComponent(alt ?? query.alt)}&version=${encodeURIComponent(query.version)}`,
	});
}

function normalizeCaddApiRecord(record: Record<string, unknown>, version: string): Record<string, unknown> {
	const chrom = stringValue(record.Chrom) ?? stringValue(record.chrom);
	const pos = numberValue(record.Pos) ?? numberValue(record.pos);
	const ref = stringValue(record.Ref) ?? stringValue(record.ref);
	const alt = stringValue(record.Alt) ?? stringValue(record.alt);
	return compactRecord({
		chrom,
		pos,
		ref,
		alt,
		version,
		rawScore: stringValue(record.RawScore) ?? stringValue(record.raw_score) ?? stringValue(record.rawScore),
		phred: stringValue(record.PHRED) ?? stringValue(record.phred),
		url: chrom && pos && ref && alt ? `https://cadd.gs.washington.edu/snv?chrom=${encodeURIComponent(chrom)}&pos=${encodeURIComponent(String(pos))}&ref=${encodeURIComponent(ref)}&alt=${encodeURIComponent(alt)}&version=${encodeURIComponent(version)}` : undefined,
	});
}

function parseCaddVersion(options: Record<string, string>): string {
	const version = options.version ?? CADD_DEFAULT_VERSION;
	if (!/^(?:GRCh3[78]-v\d+\.\d+(?:_inclAnno)?|v1\.[0-3])$/.test(version)) throw new Error(`Invalid CADD version ${version}; use a build-qualified version such as GRCh38-v1.7.`);
	return version;
}

function normalizeCaddRangePayload(payload: unknown, version: string): Record<string, unknown>[] {
	if (Array.isArray(payload) && Array.isArray(payload[0])) {
		const header = payload[0].map(String);
		return payload.slice(1).map((row) => {
			const values = arrayValue(row);
			const record: Record<string, unknown> = {};
			header.forEach((key, index) => {
				record[key] = values[index];
			});
			return normalizeCaddApiRecord(record, version);
		}).filter((record) => Object.keys(record).length > 0);
	}
	return arrayValue(payload).map((item) => normalizeCaddApiRecord(recordValue(item), version)).filter((record) => Object.keys(record).length > 0);
}

async function caddPositionScores(query: string, chrom: string, pos: number, version: string): Promise<Record<string, unknown>> {
	const cleanChrom = normalizeCaddChrom(chrom);
	if (!Number.isInteger(pos) || pos < 1) throw new Error("cadd_position_scores pos must be a positive integer.");
	const url = new URL(`${CADD_API_BASE}/${version}/${cleanChrom}:${pos}`);
	const results = normalizeCaddRangePayload(await fetchJson(url), version);
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "cadd",
		query,
		searchMode: "cadd_position_scores",
		version,
		chrom: cleanChrom,
		pos,
		totalCount: results.length,
		returned: results.length,
		results,
		provenance: { docs: "https://cadd.bihealth.org/api", endpoints: [url.toString()] },
	};
}

async function caddRangeScores(query: string, chrom: string, start: number, end: number, version: string): Promise<Record<string, unknown>> {
	const cleanChrom = normalizeCaddChrom(chrom);
	if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) throw new Error("cadd_range_scores requires 0 < start <= end.");
	const span = end - start + 1;
	if (span > MAX_CADD_RANGE_BP) throw new Error(`cadd_range_scores spans ${span} bp; maximum is ${MAX_CADD_RANGE_BP} bp.`);
	const url = new URL(`${CADD_API_BASE}/${version}/${cleanChrom}:${start}-${end}`);
	const results = normalizeCaddRangePayload(await fetchJson(url), version);
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "cadd",
		query,
		searchMode: "cadd_range_scores",
		version,
		chrom: cleanChrom,
		start,
		end,
		spanBp: span,
		totalCount: results.length,
		returned: results.length,
		results,
		provenance: { docs: "https://cadd.bihealth.org/api", endpoints: [url.toString()] },
	};
}

async function searchCadd(params: SearchParams): Promise<Record<string, unknown>> {
	const query = cleanQuery(params.query);
	const parsed = parseCaddQuery(query);
	const url = new URL(`${CADD_API_BASE}/${parsed.version}/${parsed.chrom}:${parsed.pos}_${parsed.ref}_${parsed.alt}`);
	const payload = await fetchJson(url);
	const results = arrayValue(payload)
		.map((item) => normalizeCaddRecord(recordValue(item), parsed))
		.filter((record) => Object.keys(record).length > 0);
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "cadd",
		query,
		searchMode: "single-snv",
		version: parsed.version,
		returned: results.length,
		results,
		provenance: {
			docs: "https://cadd.bihealth.org/api",
			endpoints: [url.toString()],
		},
	};
}

export async function searchVariantExact(params: { limit?: number; query: string; source: string }): Promise<Record<string, unknown> | undefined> {
	const match = /^(cadd_(?:variant_score|position_scores|range_scores)|clinvar_(?:search|get_records|variant_by_rsid)|dbsnp_(?:get_rsids|search_by_region))\s*:?\s*(.*)$/i.exec(params.query.trim());
	if (!match) return undefined;
	const command = match[1]!.toLowerCase();
	const body = match[2]?.trim() ?? "";
	const options = queryParamMap(body);
	const bare = stripQueryParams(body);
	const limit = safeLimit(params.limit);
	if (command === "cadd_variant_score") {
		const chrom = options.chrom ?? options.chr;
		const pos = options.pos ? Number(options.pos) : undefined;
		const ref = options.ref;
		const alt = options.alt;
		if (!chrom || !pos || !ref || !alt) {
			return searchCadd({ limit: params.limit, query: `${parseCaddVersion(options)} ${bare}`, source: "cadd" });
		}
		return searchCadd({ limit: params.limit, query: `${parseCaddVersion(options)} ${chrom}-${pos}-${ref}-${alt}`, source: "cadd" });
	}
	if (command === "cadd_position_scores") {
		const chrom = options.chrom ?? options.chr ?? bare.split(/[\s:,-]+/)[0];
		const pos = Number(options.pos ?? bare.split(/[\s:,-]+/)[1]);
		return caddPositionScores(params.query, chrom ?? "", pos, parseCaddVersion(options));
	}
	if (command === "cadd_range_scores") {
		const chrom = options.chrom ?? options.chr ?? bare.split(/[\s:,-]+/)[0];
		const start = Number(options.start ?? bare.split(/[\s:,-]+/)[1]);
		const end = Number(options.end ?? options.stop ?? bare.split(/[\s:,-]+/)[2]);
		return caddRangeScores(params.query, chrom ?? "", start, end, parseCaddVersion(options));
	}
	if (command === "clinvar_search") {
		const query = options.query ?? bare;
		return searchClinvar({ limit, query, source: "clinvar" });
	}
	if (command === "clinvar_get_records") {
		const accessions = splitTerms(options.accessions ?? options.accession ?? bare).slice(0, 50);
		if (!accessions.length) throw new Error("clinvar_get_records requires one or more VCV/RCV accessions or variation IDs.");
		return clinvarRecordsByAccessions(params.query, accessions);
	}
	if (command === "clinvar_variant_by_rsid") {
		const rsid = options.rsid ?? bare;
		return clinvarRecordsByRsid(params.query, rsid, limit);
	}
	if (command === "dbsnp_get_rsids") {
		const rsids = splitTerms(options.rsids ?? options.rsid ?? bare).slice(0, 20);
		if (!rsids.length) throw new Error("dbsnp_get_rsids requires one or more rsIDs.");
		return searchDbsnp({ limit: rsids.length, query: rsids.join(" "), source: "dbsnp" });
	}
	if (command === "dbsnp_search_by_region") {
		const chrom = options.chrom ?? options.chr ?? bare.split(/[\s:,-]+/)[0] ?? "";
		const start = Number(options.start ?? bare.split(/[\s:,-]+/)[1]);
		const stop = Number(options.stop ?? options.end ?? bare.split(/[\s:,-]+/)[2]);
		const assembly = options.assembly ?? "GRCh38";
		const maxRsids = Number(options.max_rsids ?? options.max ?? params.limit ?? 200);
		return dbsnpSearchByRegion(params.query, chrom, start, stop, assembly, maxRsids);
	}
	return undefined;
}

export async function searchVariantScienceDatabase(params: SearchParams): Promise<Record<string, unknown>> {
	const exact = await searchVariantExact(params);
	if (exact) return exact;
	if (params.source === "cadd") return searchCadd(params);
	if (params.source === "clinvar") return searchClinvar(params);
	if (params.source === "variation") return searchVariation(params);
	return searchDbsnp(params);
}
