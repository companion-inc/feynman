import { searchPanglaoDb } from "./science-database-panglaodb.js";
import { searchMyGeneQueryTool } from "./science-database-genes-ontologies.js";

export type LongTailScienceDatabaseSource = "alphafold" | "arrayexpress" | "cellguide" | "jaspar" | "metabolights" | "mgnify" | "mygene" | "panglaodb";

type SearchParams = { limit?: number; query: string; source: LongTailScienceDatabaseSource };

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;
const REQUEST_TIMEOUT_MS = 25_000;
const ALPHAFOLD_BASE = "https://alphafold.ebi.ac.uk/api";
const BIOSTUDIES_BASE = "https://www.ebi.ac.uk/biostudies/api/v1";
const CELLGUIDE_BASE = "https://cellguide.cellxgene.cziscience.com";
const JASPAR_BASE = "https://jaspar.elixir.no/api/v1";
const METABOLIGHTS_BASE = "https://www.ebi.ac.uk/metabolights/ws";
const MGNIFY_BASE = "https://www.ebi.ac.uk/metagenomics/api/v2";
const MYGENE_QUERY_URL = "https://mygene.info/v3/query";
const LONGTAIL_SOURCES = new Set<LongTailScienceDatabaseSource>(["alphafold", "arrayexpress", "cellguide", "jaspar", "metabolights", "mgnify", "mygene", "panglaodb"]);

export function isLongTailScienceDatabaseSource(source: string): source is LongTailScienceDatabaseSource {
	return LONGTAIL_SOURCES.has(source as LongTailScienceDatabaseSource);
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

async function fetchText(url: URL): Promise<string> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
	try {
		const response = await fetch(url, {
			headers: {
				accept: "text/plain,application/json",
				"user-agent": "feynman-science-database-search/1.0 (https://github.com/advaitpaliwal/feynman)",
			},
			signal: controller.signal,
		});
		if (!response.ok) throw new Error(`Science database request failed: ${response.status} ${response.statusText}`);
		return response.text();
	} finally {
		clearTimeout(timeout);
	}
}

async function fetchOptionalJson(url: URL): Promise<unknown | undefined> {
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
		if (response.status === 404) return undefined;
		if (!response.ok) throw new Error(`Science database request failed: ${response.status} ${response.statusText}`);
		return response.json();
	} finally {
		clearTimeout(timeout);
	}
}

function alphaFoldAccession(query: string): string {
	const clean = cleanQuery(query).replace(/^uniprot\s*:\s*/i, "");
	const token = clean.split(/[\s,;]+/).find(Boolean) ?? clean;
	if (!/^[A-Z0-9]+(?:-\d+)?$/i.test(token)) {
		throw new Error("AlphaFold DB search requires a UniProt accession, for example P05067 or uniprot:P05067.");
	}
	return token.toUpperCase();
}

function normalizeAlphaFoldRecord(record: Record<string, unknown>): Record<string, unknown> {
	const accession = stringValue(record.uniprotAccession);
	const entryId = stringValue(record.entryId) ?? stringValue(record.modelEntityId);
	return {
		entryId,
		modelEntityId: stringValue(record.modelEntityId),
		uniprotAccession: accession,
		uniprotId: stringValue(record.uniprotId),
		gene: stringValue(record.gene),
		description: stringValue(record.uniprotDescription),
		organism: stringValue(record.organismScientificName),
		taxId: numberValue(record.taxId),
		isReviewed: Boolean(record.isReviewed ?? record.isUniProtReviewed),
		isReferenceProteome: Boolean(record.isReferenceProteome ?? record.isUniProtReferenceProteome),
		sequenceStart: numberValue(record.sequenceStart ?? record.uniprotStart),
		sequenceEnd: numberValue(record.sequenceEnd ?? record.uniprotEnd),
		sequenceLength: stringValue(record.sequence)?.length ?? numberValue(record.sequenceEnd),
		globalPlddt: numberValue(record.globalMetricValue),
		plddtFractions: {
			veryLow: numberValue(record.fractionPlddtVeryLow),
			low: numberValue(record.fractionPlddtLow),
			confident: numberValue(record.fractionPlddtConfident),
			veryHigh: numberValue(record.fractionPlddtVeryHigh),
		},
		latestVersion: numberValue(record.latestVersion),
		pdbUrl: stringValue(record.pdbUrl),
		cifUrl: stringValue(record.cifUrl),
		bcifUrl: stringValue(record.bcifUrl),
		paeImageUrl: stringValue(record.paeImageUrl),
		plddtDocUrl: stringValue(record.plddtDocUrl),
		paeDocUrl: stringValue(record.paeDocUrl),
		url: accession ? `https://alphafold.ebi.ac.uk/entry/${encodeURIComponent(accession)}` : undefined,
	};
}

async function searchAlphaFold(params: SearchParams): Promise<Record<string, unknown>> {
	const query = cleanQuery(params.query);
	const limit = safeLimit(params.limit);
	const accession = alphaFoldAccession(query);
	const url = new URL(`${ALPHAFOLD_BASE}/prediction/${encodeURIComponent(accession)}`);
	const payload = await fetchJson(url);
	const records = arrayValue(payload).map((item) => normalizeAlphaFoldRecord(recordValue(item))).slice(0, limit);
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "alphafold",
		query,
		accession,
		totalCount: arrayValue(payload).length,
		returned: records.length,
		results: records,
		provenance: {
			docs: ["https://alphafold.ebi.ac.uk/api-docs", "https://www.ebi.ac.uk/training/online/courses/alphafold/accessing-and-predicting-protein-structures-with-alphafold/accessing-predicted-protein-structures-in-the-alphafold-database/whats-the-best-way-to-access-the-database/"],
			endpoints: [url.toString()],
		},
	};
}

function normalizeArrayExpressRecord(record: Record<string, unknown>): Record<string, unknown> {
	const accession = stringValue(record.accession);
	return {
		accession,
		type: stringValue(record.type),
		title: stringValue(record.title),
		authors: stringValue(record.author),
		fileCount: numberValue(record.files),
		linkCount: numberValue(record.links),
		releaseDate: stringValue(record.release_date),
		views: numberValue(record.views),
		isPublic: Boolean(record.isPublic),
		content: stringValue(record.content),
		url: accession ? `https://www.ebi.ac.uk/biostudies/arrayexpress/studies/${encodeURIComponent(accession)}` : undefined,
	};
}

async function searchArrayExpress(params: SearchParams): Promise<Record<string, unknown>> {
	const query = cleanQuery(params.query);
	const limit = safeLimit(params.limit);
	const url = new URL(`${BIOSTUDIES_BASE}/search`);
	url.searchParams.set("query", `${query} AND collection:ArrayExpress`);
	url.searchParams.set("pageSize", String(limit));
	url.searchParams.set("page", "1");
	const payload = recordValue(await fetchJson(url));
	const results = arrayValue(payload.hits).map((item) => normalizeArrayExpressRecord(recordValue(item)));
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "arrayexpress",
		query,
		totalCount: numberValue(payload.totalHits) ?? results.length,
		returned: results.length,
		results,
		provenance: {
			docs: ["https://www.ebi.ac.uk/biostudies/help", "https://www.ebi.ac.uk/biostudies/arrayexpress-in-biostudies"],
			endpoints: [url.toString()],
		},
	};
}

function cellGuideDocs(): string[] {
	return [
		"https://cellxgene.cziscience.com/cellguide",
		"https://cellxgene.cziscience.com/docs/04__Analyze%20Public%20Data/4_2__Gene%20Expression%20Documentation/4_2_5__Find%20Marker%20Genes",
	];
}

function cellGuideUrlId(cellId: string): string {
	if (/^CL_\d{7}$/i.test(cellId)) return cellId.toUpperCase();
	if (/^CL:\d{7}$/i.test(cellId)) return cellId.replace(":", "_").toUpperCase();
	if (/^\d{7}$/.test(cellId)) return `CL_${cellId}`;
	return cellId.replace(":", "_");
}

function cellGuideJsonId(cellId: string): string {
	if (/^CL:\d{7}$/i.test(cellId)) return cellId.toUpperCase();
	if (/^CL_\d{7}$/i.test(cellId)) return cellId.replace("_", ":").toUpperCase();
	if (/^\d{7}$/.test(cellId)) return `CL:${cellId}`;
	return cellId.replace("_", ":");
}

function stripModePrefix(query: string, pattern: RegExp): string {
	return query.replace(pattern, "").trim();
}

async function cellGuideSnapshot(endpoints: string[]): Promise<string> {
	const url = new URL(`${CELLGUIDE_BASE}/latest_snapshot_identifier`);
	endpoints.push(url.toString());
	return (await fetchText(url)).trim();
}

async function cellGuideMetadata(snapshot: string, endpoints: string[]): Promise<Record<string, unknown>> {
	const url = new URL(`${CELLGUIDE_BASE}/${encodeURIComponent(snapshot)}/celltype_metadata.json`);
	endpoints.push(url.toString());
	return recordValue(await fetchJson(url));
}

function normalizeCellGuideCell(record: Record<string, unknown>): Record<string, unknown> {
	const id = stringValue(record.id);
	return {
		id,
		name: stringValue(record.name),
		synonyms: arrayValue(record.synonyms).map(String).filter(Boolean).slice(0, 12),
		ontologyDescription: stringValue(record.clDescription),
		url: id ? `https://cellxgene.cziscience.com/cellguide/${cellGuideUrlId(id)}` : undefined,
	};
}

function cellGuideSearchRows(metadata: Record<string, unknown>, term: string): Record<string, unknown>[] {
	const needle = term.toLowerCase();
	return Object.values(metadata).map((item) => recordValue(item))
		.filter((record) => {
			const haystack = [
				stringValue(record.id),
				stringValue(record.name),
				stringValue(record.clDescription),
				...arrayValue(record.synonyms).map(String),
			].filter(Boolean).join("\n").toLowerCase();
			return haystack.includes(needle);
		})
		.sort((a, b) => {
			const aName = stringValue(a.name)?.toLowerCase() ?? "";
			const bName = stringValue(b.name)?.toLowerCase() ?? "";
			const aRank = aName === needle ? 0 : aName.startsWith(needle) ? 1 : 2;
			const bRank = bName === needle ? 0 : bName.startsWith(needle) ? 1 : 2;
			return aRank - bRank || aName.localeCompare(bName);
		})
		.map(normalizeCellGuideCell);
}

async function resolveCellGuideCell(query: string, metadata: Record<string, unknown>): Promise<{ id: string; record: Record<string, unknown> }> {
	const requestedId = /^((?:CL[:_])?\d{7}|CL[:_]\d{7})$/i.test(query) ? cellGuideJsonId(query) : undefined;
	if (requestedId) {
		const record = recordValue(metadata[requestedId]);
		if (Object.keys(record).length) return { id: requestedId, record };
		throw new Error(`CellGuide cell type ${requestedId} was not found.`);
	}
	const match = cellGuideSearchRows(metadata, query)[0];
	const id = stringValue(match?.id);
	if (!id) throw new Error(`CellGuide cell type '${query}' was not found.`);
	return { id, record: recordValue(metadata[id]) };
}

function normalizeCellGuideMarker(record: Record<string, unknown>): Record<string, unknown> {
	const dims = recordValue(record.groupby_dims);
	return {
		symbol: stringValue(record.symbol),
		name: stringValue(record.name),
		markerScore: numberValue(record.marker_score),
		specificity: numberValue(record.specificity),
		meanExpression: numberValue(record.me),
		percentCells: numberValue(record.pc) === undefined ? undefined : Number(((numberValue(record.pc) ?? 0) * 100).toFixed(1)),
		organism: stringValue(dims.organism_ontology_term_label),
		tissueContext: stringValue(dims.tissue_ontology_term_label ?? record.tissue),
		publication: stringValue(record.publication),
		publicationTitles: stringValue(record.publication_titles),
	};
}

function doiOrUrl(value: string | undefined): string | undefined {
	if (!value) return undefined;
	if (/^https?:\/\//i.test(value)) return value;
	if (/^10\.\S+\/\S+$/i.test(value)) return `https://doi.org/${value}`;
	return value;
}

function labels(value: unknown): string[] {
	return arrayValue(value).map((item) => stringValue(recordValue(item).label)).filter((label): label is string => Boolean(label));
}

function normalizeCellGuideSource(record: Record<string, unknown>): Record<string, unknown> {
	return {
		collectionName: stringValue(record.collection_name),
		collectionUrl: stringValue(record.collection_url),
		publicationTitle: stringValue(record.publication_title),
		publicationUrl: doiOrUrl(stringValue(record.publication_url)),
		tissues: labels(record.tissue).slice(0, 12),
		diseases: labels(record.disease).slice(0, 12),
		organisms: labels(record.organism).slice(0, 12),
	};
}

async function cellGuideMarkers(snapshot: string, cellId: string, markerType: string, limit: number, endpoints: string[]): Promise<Record<string, unknown>[]> {
	const type = markerType === "canonical" ? "canonical" : "computational";
	const folder = type === "canonical" ? "canonical_marker_genes" : "computational_marker_genes";
	const url = new URL(`${CELLGUIDE_BASE}/${encodeURIComponent(snapshot)}/${folder}/${encodeURIComponent(cellGuideUrlId(cellId))}.json`);
	endpoints.push(url.toString());
	const payload = await fetchOptionalJson(url);
	return arrayValue(payload).map((item) => normalizeCellGuideMarker(recordValue(item)))
		.sort((a, b) => (numberValue(b.markerScore) ?? 0) - (numberValue(a.markerScore) ?? 0) || String(a.symbol).localeCompare(String(b.symbol)))
		.slice(0, limit);
}

async function searchCellGuide(params: SearchParams): Promise<Record<string, unknown>> {
	const query = cleanQuery(params.query);
	const limit = safeLimit(params.limit);
	const endpoints: string[] = [];
	const snapshot = await cellGuideSnapshot(endpoints);
	const metadata = await cellGuideMetadata(snapshot, endpoints);
	if (/^search(?::|\s)/i.test(query)) {
		const term = stripModePrefix(query, /^search(?::|\s+)/i);
		const rows = cellGuideSearchRows(metadata, term);
		return {
			schema: "feynman.scienceDatabaseSearch.v1",
			source: "cellguide",
			query,
			mode: "search",
			snapshot,
			totalCount: rows.length,
			returned: Math.min(rows.length, limit),
			results: rows.slice(0, limit),
			provenance: { docs: cellGuideDocs(), endpoints },
		};
	}
	const markerMatch = query.match(/^(markers|canonical|computational)(?::|\s+)(.+)$/i);
	const sourceMatch = query.match(/^sources(?::|\s+)(.+)$/i);
	const tissueMatch = query.match(/^tissues(?::|\s+)(.+)$/i);
	const infoTerm = stripModePrefix(query, /^info(?::|\s+)/i);
	const cellTerm = markerMatch?.[2]?.trim() || sourceMatch?.[1]?.trim() || tissueMatch?.[1]?.trim() || infoTerm;
	const { id, record } = await resolveCellGuideCell(cellTerm, metadata);
	if (markerMatch) {
		const markerType = markerMatch[1]!.toLowerCase() === "canonical" ? "canonical" : markerMatch[1]!.toLowerCase() === "computational" ? "computational" : "computational";
		const markers = await cellGuideMarkers(snapshot, id, markerType, limit, endpoints);
		return {
			schema: "feynman.scienceDatabaseSearch.v1",
			source: "cellguide",
			query,
			mode: "markers",
			snapshot,
			cellTypeId: id,
			cellTypeName: stringValue(record.name),
			markerType,
			totalCount: markers.length,
			returned: markers.length,
			results: markers,
			provenance: { docs: cellGuideDocs(), endpoints },
		};
	}
	if (sourceMatch) {
		const url = new URL(`${CELLGUIDE_BASE}/${encodeURIComponent(snapshot)}/source_collections/${encodeURIComponent(cellGuideUrlId(id))}.json`);
		endpoints.push(url.toString());
		const rows = arrayValue(await fetchOptionalJson(url)).map((item) => normalizeCellGuideSource(recordValue(item)));
		return {
			schema: "feynman.scienceDatabaseSearch.v1",
			source: "cellguide",
			query,
			mode: "source-collections",
			snapshot,
			cellTypeId: id,
			cellTypeName: stringValue(record.name),
			totalCount: rows.length,
			returned: Math.min(rows.length, limit),
			results: rows.slice(0, limit),
			provenance: { docs: cellGuideDocs(), endpoints },
		};
	}
	if (tissueMatch) {
		const mappingUrl = new URL(`${CELLGUIDE_BASE}/${encodeURIComponent(snapshot)}/ontology_tree/NCBITaxon_9606/celltype_to_tissue_mapping.json`);
		const tissueUrl = new URL(`${CELLGUIDE_BASE}/${encodeURIComponent(snapshot)}/tissue_metadata.json`);
		endpoints.push(mappingUrl.toString(), tissueUrl.toString());
		const mapping = recordValue(await fetchJson(mappingUrl));
		const tissues = recordValue(await fetchJson(tissueUrl));
		const rows = arrayValue(mapping[id]).map(String).flatMap((tissueId) => {
			const tissue = recordValue(tissues[tissueId]);
			return Object.keys(tissue).length ? [{
				id: tissueId,
				name: stringValue(tissue.name),
				description: stringValue(tissue.uberonDescription),
			}] : [];
		});
		return {
			schema: "feynman.scienceDatabaseSearch.v1",
			source: "cellguide",
			query,
			mode: "tissues",
			snapshot,
			cellTypeId: id,
			cellTypeName: stringValue(record.name),
			totalCount: rows.length,
			returned: Math.min(rows.length, limit),
			results: rows.slice(0, limit),
			provenance: { docs: cellGuideDocs(), endpoints },
		};
	}
	const validatedUrl = new URL(`${CELLGUIDE_BASE}/validated_descriptions/${encodeURIComponent(cellGuideUrlId(id))}.json`);
	endpoints.push(validatedUrl.toString());
	const validated = recordValue(await fetchOptionalJson(validatedUrl));
	const topMarkers = await cellGuideMarkers(snapshot, id, "computational", Math.min(5, limit), endpoints);
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "cellguide",
		query,
		mode: "info",
		snapshot,
		totalCount: 1,
		returned: 1,
		results: [{
			...normalizeCellGuideCell(record),
			validatedDescription: stringValue(validated.description),
			references: arrayValue(validated.references).slice(0, 8),
			topMarkerGenes: topMarkers.map((marker) => ({
				symbol: marker.symbol,
				name: marker.name,
				markerScore: marker.markerScore,
			})),
		}],
		provenance: { docs: cellGuideDocs(), endpoints },
	};
}

function normalizeJasparMatrix(record: Record<string, unknown>): Record<string, unknown> {
	const matrixId = stringValue(record.matrix_id);
	return {
		matrixId,
		name: stringValue(record.name),
		collection: stringValue(record.collection),
		baseId: stringValue(record.base_id),
		version: stringValue(record.version),
		sequenceLogo: stringValue(record.sequence_logo),
		apiUrl: stringValue(record.url),
		url: matrixId ? `https://jaspar.elixir.no/matrix/${encodeURIComponent(matrixId)}/` : undefined,
	};
}

async function searchJaspar(params: SearchParams): Promise<Record<string, unknown>> {
	const query = cleanQuery(params.query);
	const limit = safeLimit(params.limit);
	const url = new URL(`${JASPAR_BASE}/matrix/`);
	url.searchParams.set("search", query);
	url.searchParams.set("page_size", String(limit));
	url.searchParams.set("format", "json");
	const payload = recordValue(await fetchJson(url));
	const results = arrayValue(payload.results).map((item) => normalizeJasparMatrix(recordValue(item)));
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "jaspar",
		query,
		totalCount: numberValue(payload.count) ?? results.length,
		returned: results.length,
		results,
		provenance: {
			docs: "https://jaspar.elixir.no/api/v1/docs/",
			endpoints: [url.toString()],
		},
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

function accessionSortKey(accession: string): [string, number] {
	const match = accession.match(/^([A-Z]+)(\d+)$/);
	return match ? [match[1]!, Number(match[2])] : [accession, 0];
}

function metabolightsAccession(value: string): string {
	const clean = value.trim().toUpperCase();
	const match = clean.match(/^(?:study\s*:\s*)?(MTBLS\d+)$/i);
	if (!match) throw new Error("MetaboLights search requires studies, an MTBLS accession, files:MTBLS1, or data-files:MTBLS1 pattern=*.mzML.");
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
	const derivedData = recordValue(content.derivedData);
	return {
		accession,
		title: stringValue(content.title),
		description: stringValue(content.studyDescription),
		studyStatus: stringValue(content.studyStatus),
		releaseYear: numberValue(derivedData.releaseYear),
		submissionYear: numberValue(derivedData.submissionYear),
		organisms,
		organismNames: organisms.map((organism) => organism.organism).filter((value): value is string => Boolean(value)),
		factors: arrayValue(content.factors).map((item) => stringValue(recordValue(item).name)).filter((value): value is string => Boolean(value)),
		descriptors: arrayValue(content.descriptors).map((item) => stringValue(recordValue(item).description)).filter((value): value is string => Boolean(value)),
		assays,
		assayCount: assays.length,
		technologies: [...new Set(assays.map((assay) => assay.technology).filter((value): value is string => Boolean(value)))],
		sampleCount: arrayValue(sampleTable.data).length,
		studySize: numberValue(content.studySize),
		studyHumanReadable: stringValue(content.studyHumanReadable),
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

async function searchMetaboLights(params: SearchParams): Promise<Record<string, unknown>> {
	const query = cleanQuery(params.query);
	const limit = safeLimit(params.limit);
	const fileMatch = query.match(/^files\s*:\s*(MTBLS\d+)$/i);
	const dataFilesMatch = query.match(/^data-files\s*:\s*(MTBLS\d+)(?:\s+pattern=(\S+))?$/i);
	const endpoints: string[] = [];
	if (/^(studies|list|public|all)$/i.test(query)) {
		const url = new URL(`${METABOLIGHTS_BASE}/studies`);
		const payload = recordValue(await fetchJson(url));
		endpoints.push(url.toString());
		const accessions = arrayValue(payload.content).map(String).filter(Boolean).sort((a, b) => {
			const [aPrefix, aNumber] = accessionSortKey(a);
			const [bPrefix, bNumber] = accessionSortKey(b);
			return aPrefix === bPrefix ? aNumber - bNumber : aPrefix.localeCompare(bPrefix);
		});
		return {
			schema: "feynman.scienceDatabaseSearch.v1",
			source: "metabolights",
			query,
			mode: "studies",
			totalCount: numberValue(payload.studies) ?? accessions.length,
			returned: Math.min(accessions.length, limit),
			results: accessions.slice(0, limit).map((accession) => ({
				accession,
				url: `https://www.ebi.ac.uk/metabolights/${encodeURIComponent(accession)}`,
			})),
			provenance: {
				docs: ["https://www.ebi.ac.uk/metabolights/", "https://www.ebi.ac.uk/metabolights/download"],
				endpoints,
			},
		};
	}
	if (fileMatch) {
		const accession = fileMatch[1]!.toUpperCase();
		const url = new URL(`${METABOLIGHTS_BASE}/studies/${encodeURIComponent(accession)}/files`);
		url.searchParams.set("include_raw_data", "true");
		const payload = recordValue(await fetchJson(url));
		endpoints.push(url.toString());
		const folder = arrayValue(payload.study).map((item) => normalizeMetaboLightsFile(recordValue(item)))
			.sort((a, b) => `${a.directory ? "0" : "1"}\t${a.file ?? ""}`.localeCompare(`${b.directory ? "0" : "1"}\t${b.file ?? ""}`));
		return {
			schema: "feynman.scienceDatabaseSearch.v1",
			source: "metabolights",
			query,
			mode: "files",
			accession,
			totalCount: folder.length,
			returned: Math.min(folder.length, limit),
			results: folder.slice(0, limit),
			provenance: {
				docs: ["https://www.ebi.ac.uk/metabolights/", "https://www.ebi.ac.uk/metabolights/download"],
				endpoints,
			},
		};
	}
	if (dataFilesMatch) {
		const accession = dataFilesMatch[1]!.toUpperCase();
		const pattern = dataFilesMatch[2];
		const url = new URL(`${METABOLIGHTS_BASE}/studies/${encodeURIComponent(accession)}/public-data-files`);
		url.searchParams.set("file_match", "true");
		url.searchParams.set("folder_match", "false");
		if (pattern) url.searchParams.set("search_pattern", pattern);
		const payload = recordValue(await fetchJson(url));
		endpoints.push(url.toString());
		const files = arrayValue(payload.files).map((item) => stringValue(recordValue(item).name ?? item)).filter(Boolean).sort();
		return {
			schema: "feynman.scienceDatabaseSearch.v1",
			source: "metabolights",
			query,
			mode: "data-files",
			accession,
			pattern,
			totalCount: files.length,
			returned: Math.min(files.length, limit),
			results: files.slice(0, limit).map((file) => ({ file })),
			provenance: {
				docs: ["https://www.ebi.ac.uk/metabolights/", "https://www.ebi.ac.uk/metabolights/download"],
				endpoints,
			},
		};
	}
	const accession = metabolightsAccession(query);
	const url = new URL(`${METABOLIGHTS_BASE}/studies/public/study/${encodeURIComponent(accession)}`);
	const payload = recordValue(await fetchJson(url));
	endpoints.push(url.toString());
	const study = normalizeMetaboLightsStudy(payload);
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "metabolights",
		query,
		mode: "study",
		accession,
		totalCount: 1,
		returned: 1,
		results: [study],
		provenance: {
			docs: ["https://www.ebi.ac.uk/metabolights/", "https://www.ebi.ac.uk/metabolights/download"],
			endpoints,
		},
	};
}

async function searchMgnify(params: SearchParams): Promise<Record<string, unknown>> {
	const query = cleanQuery(params.query);
	const limit = safeLimit(params.limit);
	const url = new URL(`${MGNIFY_BASE}/studies`);
	url.searchParams.set("search", query);
	url.searchParams.set("page_size", String(limit));
	url.searchParams.set("page", "1");
	const payload = recordValue(await fetchJson(url));
	const results = arrayValue(payload.items).map((item) => normalizeMgnifyStudy(recordValue(item)));
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "mgnify",
		query,
		totalCount: numberValue(payload.count) ?? results.length,
		returned: results.length,
		results,
		provenance: {
			docs: "https://docs.mgnify.org/src/docs/api.html",
			endpoints: [url.toString()],
		},
	};
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

async function searchMyGene(params: SearchParams): Promise<Record<string, unknown>> {
	const query = cleanQuery(params.query);
	const limit = safeLimit(params.limit);
	if (/^query_genes\b/i.test(query)) return searchMyGeneQueryTool(query, limit);
	const url = new URL(MYGENE_QUERY_URL);
	url.searchParams.set("q", query);
	url.searchParams.set("species", "human");
	url.searchParams.set("size", String(limit));
	url.searchParams.set("fields", "symbol,name,entrezgene,ensembl.gene,uniprot.Swiss-Prot,summary,taxid");
	const payload = recordValue(await fetchJson(url));
	const results = arrayValue(payload.hits).map((item) => normalizeMyGeneHit(recordValue(item)));
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "mygene",
		query,
		totalCount: numberValue(payload.total) ?? results.length,
		returned: results.length,
		results,
		provenance: {
			docs: "https://docs.mygene.info/en/latest/doc/query_service.html",
			endpoints: [url.toString()],
		},
	};
}

export async function searchLongTailScienceDatabase(params: SearchParams): Promise<Record<string, unknown>> {
	if (params.source === "alphafold") return searchAlphaFold(params);
	if (params.source === "arrayexpress") return searchArrayExpress(params);
	if (params.source === "cellguide") return searchCellGuide(params);
	if (params.source === "jaspar") return searchJaspar(params);
	if (params.source === "metabolights") return searchMetaboLights(params);
	if (params.source === "mgnify") return searchMgnify(params);
	if (params.source === "panglaodb") return searchPanglaoDb(params);
	return searchMyGene(params);
}
