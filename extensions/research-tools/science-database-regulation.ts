type SearchParams = { limit?: number; query: string; source: string };

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;
const REQUEST_TIMEOUT_MS = 25_000;
const ENCODE_BASE = "https://www.encodeproject.org";
const JASPAR_BASE = "https://jaspar.elixir.no/api/v1";
const UNIBIND_API_BASE = "https://unibind.uio.no/api/v1";
const UCSC_API_BASE = "https://api.genome.ucsc.edu";
const REGION_FETCH_CAP = 20_000;
const MAX_REGION_SPAN = 1_000_000;

const REGULATION_COMMANDS = /^(encode_(?:search_experiments|search_biosamples|list_files|get_experiment|get_file|get_biosample)|jaspar_(?:get_matrix|matrix_versions|list_matrices|list_species|list_taxa|list_collections|list_releases)|unibind_(?:search_tfbs|get_dataset|tfbs_in_region))\s*:?\s*(.*)$/i;
const ENCODE_ORGANISM_FIELD = "replicates.library.biosample.donor.organism.scientific_name";
const ENCODE_EXPERIMENT_FIELDS = ["accession", "assay_title", "assay_term_name", "target.label", "biosample_ontology.term_name", "biosample_ontology.classification", "status", "date_released", "lab.title"];
const ENCODE_BIOSAMPLE_FIELDS = ["accession", "biosample_ontology.term_name", "biosample_ontology.classification", "organism.scientific_name", "status", "lab.title", "summary", "date_created"];
const ENCODE_FILE_FIELDS = ["accession", "file_format", "output_type", "output_category", "assay_term_name", "assembly", "dataset", "status", "file_size", "date_created"];

const HUB_GENOMES: Record<"Robust" | "Permissive", Set<string>> = {
	Permissive: new Set(["hg38", "mm10", "ce11", "dm6", "danRer11", "sacCer3", "rn6", "araTha1", "spo2"]),
	Robust: new Set(["hg38", "mm10", "ce11", "dm6", "danRer11", "sacCer3", "rn6", "araTha1"]),
};

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

function queryParamMap(text: string): Record<string, string> {
	const params: Record<string, string> = {};
	for (const match of text.matchAll(/\b([a-z][a-z0-9_.-]*)\s*=\s*("[^"]+"|'[^']+'|[^\s;]+)/gi)) {
		const key = match[1]?.toLowerCase();
		const raw = match[2]?.trim();
		if (!key || !raw) continue;
		params[key] = raw.replace(/^["']|["']$/g, "");
	}
	return params;
}

function stripQueryParams(text: string): string {
	return text.replace(/\b[a-z][a-z0-9_.-]*\s*=\s*("[^"]+"|'[^']+'|[^\s;]+)/gi, " ").trim();
}

function splitTerms(value: string): string[] {
	return value
		.split(/[\n\r,;]+|\s{2,}/)
		.map((item) => item.trim())
		.filter(Boolean);
}

function parseInteger(value: string | undefined, fallback: number): number {
	if (!value || !Number.isFinite(Number(value))) return fallback;
	return Math.max(1, Math.floor(Number(value)));
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

function output(source: string, query: string, mode: string, results: unknown[], totalCount: number, endpoints: string[], docs: string[] | string, extra: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source,
		query,
		mode,
		totalCount,
		returned: results.length,
		results,
		...extra,
		provenance: { docs, endpoints },
	};
}

function encodeObjectUrl(pathOrId: string | undefined): string | undefined {
	if (!pathOrId) return undefined;
	if (pathOrId.startsWith("http")) return pathOrId;
	return `${ENCODE_BASE}${pathOrId.startsWith("/") ? pathOrId : `/${pathOrId}/`}`;
}

function encodeDisplayName(value: unknown): string | undefined {
	if (typeof value === "string") return value;
	const record = recordValue(value);
	return stringValue(record.title) ?? stringValue(record.term_name) ?? stringValue(record.label) ?? stringValue(record.name) ?? stringValue(record["@id"]);
}

function normalizeEncodeExperiment(record: Record<string, unknown>): Record<string, unknown> {
	const accession = stringValue(record.accession) ?? stringValue(record["@id"]);
	const target = recordValue(record.target);
	const biosample = recordValue(record.biosample_ontology);
	const lab = recordValue(record.lab);
	const award = recordValue(record.award);
	return {
		recordType: "experiment",
		accession,
		status: stringValue(record.status),
		assayTermName: stringValue(record.assay_term_name),
		assayTitle: stringValue(record.assay_title),
		targetLabel: stringValue(target.label),
		biosampleTermName: stringValue(biosample.term_name),
		biosampleClassification: stringValue(biosample.classification),
		biosampleSummary: stringValue(record.biosample_summary),
		description: stringValue(record.description),
		lab: encodeDisplayName(lab),
		awardProject: stringValue(award.project),
		dateReleased: stringValue(record.date_released),
		dateSubmitted: stringValue(record.date_submitted),
		assembly: arrayValue(record.assembly).map(String).sort(),
		bioReplicateCount: numberValue(record.bio_replicate_count),
		techReplicateCount: numberValue(record.tech_replicate_count),
		replicationType: stringValue(record.replication_type),
		dbxrefs: arrayValue(record.dbxrefs).map(String).sort(),
		doi: stringValue(record.doi),
		uuid: stringValue(record.uuid),
		url: encodeObjectUrl(stringValue(record["@id"]) ?? accession),
	};
}

function normalizeEncodeFile(record: Record<string, unknown>): Record<string, unknown> {
	const accession = stringValue(record.accession) ?? stringValue(record["@id"]);
	return {
		recordType: "file",
		accession,
		status: stringValue(record.status),
		fileFormat: stringValue(record.file_format),
		fileFormatType: stringValue(record.file_format_type),
		outputType: stringValue(record.output_type),
		outputCategory: stringValue(record.output_category),
		assayTermName: stringValue(record.assay_term_name),
		assembly: stringValue(record.assembly),
		dataset: stringValue(record.dataset),
		biologicalReplicates: arrayValue(record.biological_replicates).map(String).sort(),
		fileSize: numberValue(record.file_size),
		md5sum: stringValue(record.md5sum),
		contentMd5sum: stringValue(record.content_md5sum),
		runType: stringValue(record.run_type),
		readLength: numberValue(record.read_length),
		lab: encodeDisplayName(record.lab),
		dateCreated: stringValue(record.date_created),
		href: stringValue(record.href),
		uuid: stringValue(record.uuid),
		url: encodeObjectUrl(stringValue(record["@id"]) ?? accession),
	};
}

function normalizeEncodeBiosample(record: Record<string, unknown>): Record<string, unknown> {
	const accession = stringValue(record.accession) ?? stringValue(record["@id"]);
	const biosample = recordValue(record.biosample_ontology);
	const organism = recordValue(record.organism);
	const donor = recordValue(record.donor);
	return {
		recordType: "biosample",
		accession,
		status: stringValue(record.status),
		termName: stringValue(biosample.term_name),
		classification: stringValue(biosample.classification),
		organism: stringValue(organism.scientific_name),
		donor: stringValue(donor.accession) ?? stringValue(record.donor),
		source: encodeDisplayName(record.source),
		lab: encodeDisplayName(record.lab),
		summary: stringValue(record.summary),
		lifeStage: stringValue(record.life_stage),
		ageDisplay: stringValue(record.age_display),
		sex: stringValue(record.sex),
		treatments: arrayValue(record.treatments).map((item) => stringValue(recordValue(item).treatment_term_name)).filter(Boolean).sort(),
		geneticModifications: arrayValue(record.genetic_modifications).map((item) => stringValue(recordValue(item)["@id"]) ?? String(item)).filter(Boolean).sort(),
		dateCreated: stringValue(record.date_created),
		uuid: stringValue(record.uuid),
		url: encodeObjectUrl(stringValue(record["@id"]) ?? accession),
	};
}

function encodeFiltersForMode(mode: string, params: Record<string, string>): Record<string, string> {
	const status = params.status ?? "released";
	if (mode === "encode_search_experiments") {
		return {
			status,
			...(params.assay_title ? { assay_title: params.assay_title } : {}),
			...(params.target ? { "target.label": params.target } : {}),
			...(params.organism ? { [ENCODE_ORGANISM_FIELD]: params.organism } : {}),
		};
	}
	if (mode === "encode_search_biosamples") {
		return {
			status,
			...(params.term_name ? { "biosample_ontology.term_name": params.term_name } : {}),
			...(params.classification ? { "biosample_ontology.classification": params.classification } : {}),
			...(params.organism ? { "organism.scientific_name": params.organism } : {}),
		};
	}
	return {
		status,
		...(params.file_format ? { file_format: params.file_format } : {}),
		...(params.assay_term_name ? { assay_term_name: params.assay_term_name } : {}),
		...(params.biosample_term_name ? { "biosample_ontology.term_name": params.biosample_term_name } : {}),
		...(params.output_type ? { output_type: params.output_type } : {}),
		...(params.assembly ? { assembly: params.assembly } : {}),
	};
}

async function encodeSearch(mode: string, query: string, rest: string, limit: number): Promise<Record<string, unknown>> {
	const params = queryParamMap(rest);
	const maxRows = Math.min(parseInteger(params.max_rows, limit), MAX_LIMIT);
	const url = new URL(`${ENCODE_BASE}/report/`);
	url.searchParams.set("format", "json");
	url.searchParams.set("sort", "accession");
	url.searchParams.set("limit", String(maxRows));
	if (mode === "encode_search_experiments") {
		url.searchParams.set("type", "Experiment");
		for (const field of ENCODE_EXPERIMENT_FIELDS) url.searchParams.append("field", field);
		if (params.date_released_before) url.searchParams.set("advancedQuery", `date_released:[* TO ${params.date_released_before}]`);
	} else if (mode === "encode_search_biosamples") {
		url.searchParams.set("type", "Biosample");
		for (const field of ENCODE_BIOSAMPLE_FIELDS) url.searchParams.append("field", field);
		if (params.date_created_before) url.searchParams.set("advancedQuery", `date_created:[* TO ${params.date_created_before}]`);
	} else {
		url.searchParams.set("type", "File");
		for (const field of ENCODE_FILE_FIELDS) url.searchParams.append("field", field);
		if (params.date_created_before) url.searchParams.set("advancedQuery", `date_created:[* TO ${params.date_created_before}]`);
	}
	for (const [key, value] of Object.entries(encodeFiltersForMode(mode, params))) url.searchParams.set(key, value);
	const payload = recordValue(await fetchJson(url));
	const rows = arrayValue(payload["@graph"]).map((item) => recordValue(item));
	const normalizer = mode === "encode_search_experiments" ? normalizeEncodeExperiment : mode === "encode_search_biosamples" ? normalizeEncodeBiosample : normalizeEncodeFile;
	const results = rows.map(normalizer);
	return output("encode", query, mode, results, numberValue(payload.total) ?? results.length, [url.toString()], "https://www.encodeproject.org/help/rest-api/", {
		accessions: results.map((item) => stringValue(recordValue(item).accession)).filter(Boolean).sort(),
		truncated: results.length < (numberValue(payload.total) ?? results.length),
	});
}

async function encodeDetail(mode: string, query: string, rest: string): Promise<Record<string, unknown>> {
	const params = queryParamMap(rest);
	const bare = stripQueryParams(rest);
	const accession = (params.accession ?? bare).trim();
	if (!accession) throw new Error(`${mode} requires an ENCODE accession.`);
	const url = new URL(`${ENCODE_BASE}/${encodeURIComponent(accession)}/`);
	url.searchParams.set("format", "json");
	const payload = recordValue(await fetchJson(url));
	const result = mode === "encode_get_experiment" ? normalizeEncodeExperiment(payload) : mode === "encode_get_file" ? normalizeEncodeFile(payload) : normalizeEncodeBiosample(payload);
	return output("encode", query, mode, [result], 1, [url.toString()], "https://www.encodeproject.org/help/rest-api/", { accession });
}

async function encodeExact(mode: string, query: string, rest: string, limit: number): Promise<Record<string, unknown>> {
	if (mode === "encode_get_experiment" || mode === "encode_get_file" || mode === "encode_get_biosample") return encodeDetail(mode, query, rest);
	return encodeSearch(mode, query, rest, limit);
}

function normalizeJasparMatrix(record: Record<string, unknown>): Record<string, unknown> {
	const matrixId = stringValue(record.matrix_id);
	return {
		matrixId,
		name: stringValue(record.name),
		baseId: stringValue(record.base_id),
		version: stringValue(record.version),
		collection: stringValue(record.collection),
		taxGroup: stringValue(record.tax_group),
		species: arrayValue(record.species).map((item) => typeof item === "string" ? item : stringValue(recordValue(item).name) ?? stringValue(recordValue(item).tax_id)).filter(Boolean),
		class: arrayValue(record.class).map(String),
		family: arrayValue(record.family).map(String),
		type: stringValue(record.type),
		pfm: recordValue(record.pfm),
		sequenceLogo: stringValue(record.sequence_logo),
		apiUrl: stringValue(record.url),
		url: matrixId ? `https://jaspar.elixir.no/matrix/${encodeURIComponent(matrixId)}/` : undefined,
	};
}

function normalizeJasparListRow(record: Record<string, unknown>): Record<string, unknown> {
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

function normalizeJasparCatalogRow(record: Record<string, unknown>): Record<string, unknown> {
	return {
		id: record.id ?? record.tax_id ?? record.release_number ?? stringValue(record.name),
		name: stringValue(record.name) ?? stringValue(record.title),
		taxId: numberValue(record.tax_id),
		releaseNumber: numberValue(record.release_number),
		year: numberValue(record.year),
		active: record.active,
		...record,
	};
}

async function jasparExact(mode: string, query: string, rest: string, limit: number): Promise<Record<string, unknown>> {
	const params = queryParamMap(rest);
	const bare = stripQueryParams(rest);
	const endpoints: string[] = [];
	if (mode === "jaspar_get_matrix") {
		const matrixId = params.matrix_id ?? bare;
		if (!matrixId || !matrixId.includes(".")) throw new Error("jaspar_get_matrix requires a versioned matrix id such as MA0106.1.");
		const url = new URL(`${JASPAR_BASE}/matrix/${encodeURIComponent(matrixId)}/`);
		url.searchParams.set("format", "json");
		const payload = recordValue(await fetchJson(url));
		endpoints.push(url.toString());
		return output("jaspar", query, mode, [normalizeJasparMatrix(payload)], 1, endpoints, "https://jaspar.elixir.no/api/v1/docs/", { matrixId });
	}
	if (mode === "jaspar_matrix_versions") {
		const baseId = (params.base_id ?? params.matrix_id ?? bare).split(".")[0];
		if (!baseId) throw new Error("jaspar_matrix_versions requires a base matrix id such as MA0106.");
		const url = new URL(`${JASPAR_BASE}/matrix/${encodeURIComponent(baseId)}/versions/`);
		url.searchParams.set("page_size", String(Math.min(parseInteger(params.max_rows, limit), MAX_LIMIT)));
		url.searchParams.set("format", "json");
		const payload = recordValue(await fetchJson(url));
		const results = arrayValue(payload.results).map((item) => normalizeJasparListRow(recordValue(item)));
		endpoints.push(url.toString());
		return output("jaspar", query, mode, results, numberValue(payload.count) ?? results.length, endpoints, "https://jaspar.elixir.no/api/v1/docs/", { baseId, truncated: results.length < (numberValue(payload.count) ?? results.length) });
	}
	if (mode === "jaspar_list_matrices") {
		const url = new URL(`${JASPAR_BASE}/matrix/`);
		url.searchParams.set("page_size", String(Math.min(parseInteger(params.max_rows, limit), MAX_LIMIT)));
		url.searchParams.set("format", "json");
		for (const key of ["collection", "tax_group", "tax_id", "name", "search", "version"]) {
			if (params[key]) url.searchParams.set(key, params[key]!);
		}
		if (!params.search && bare) url.searchParams.set("search", bare);
		const payload = recordValue(await fetchJson(url));
		const results = arrayValue(payload.results).map((item) => normalizeJasparListRow(recordValue(item)));
		endpoints.push(url.toString());
		return output("jaspar", query, mode, results, numberValue(payload.count) ?? results.length, endpoints, "https://jaspar.elixir.no/api/v1/docs/", { truncated: results.length < (numberValue(payload.count) ?? results.length) });
	}
	const pathByMode: Record<string, string> = {
		jaspar_list_collections: "/collections/",
		jaspar_list_releases: "/releases/",
		jaspar_list_species: "/species/",
		jaspar_list_taxa: "/taxon/",
	};
	const url = new URL(`${JASPAR_BASE}${pathByMode[mode]}`);
	url.searchParams.set("page_size", String(Math.min(parseInteger(params.max_rows, limit), MAX_LIMIT)));
	url.searchParams.set("format", "json");
	const payload = recordValue(await fetchJson(url));
	const results = arrayValue(payload.results).map((item) => normalizeJasparCatalogRow(recordValue(item)));
	endpoints.push(url.toString());
	return output("jaspar", query, mode, results, numberValue(payload.count) ?? results.length, endpoints, "https://jaspar.elixir.no/api/v1/docs/", { truncated: results.length < (numberValue(payload.count) ?? results.length) });
}

function normalizeCollection(value: string | undefined): "Robust" | "Permissive" {
	const clean = (value ?? "Robust").trim().toLowerCase();
	if (clean === "robust") return "Robust";
	if (clean === "permissive") return "Permissive";
	throw new Error("UniBind collection must be Robust or Permissive.");
}

function hubUrl(collection: "Robust" | "Permissive"): string {
	return `https://unibind.uio.no/static/data/latest/UniBind_hubs_${collection}/UCSC/hub.txt`;
}

function parseTfId(tfId: string | undefined): Record<string, unknown> {
	if (!tfId) return {};
	const parts = tfId.split(".");
	if (parts.length < 3) return { tfId };
	const [identifier, ...rest] = parts;
	const tfName = rest.pop();
	return {
		tfId,
		identifier,
		cellLine: rest.join("."),
		tfName,
	};
}

function normalizeUniBindDataset(record: Record<string, unknown>): Record<string, unknown> {
	const url = stringValue(record.url);
	const tfId = stringValue(record.tf_id) ?? (url ? decodeURIComponent(url.replace(/\/$/, "").split("/").pop() ?? "") : undefined);
	const parsed = parseTfId(tfId);
	return {
		...parsed,
		tfName: stringValue(record.tf_name) ?? stringValue(parsed.tfName),
		totalPeaks: numberValue(record.total_peaks),
		url,
	};
}

function normalizeUniBindModel(modelRecord: Record<string, unknown>, predictionModel: string | undefined): Record<string, unknown> {
	return {
		predictionModel,
		jasparId: stringValue(modelRecord.jaspar_id),
		jasparVersion: stringValue(modelRecord.jaspar_version),
		totalTfbs: numberValue(modelRecord.total_tfbs),
		scoreThreshold: numberValue(modelRecord.score_threshold),
		distanceThreshold: numberValue(modelRecord.distance_threshold),
		adjustedCentrimoPValue: numberValue(modelRecord.adj_centrimo_pvalue),
		bedUrl: stringValue(modelRecord.bed_url),
		fastaUrl: stringValue(modelRecord.fasta_url),
	};
}

function normalizeUniBindDatasetDetail(record: Record<string, unknown>): Record<string, unknown> {
	const tfId = stringValue(record.tf_id);
	const models = arrayValue(record.tfbs).flatMap((group) => {
		const modelGroup = recordValue(group);
		return Object.entries(modelGroup).flatMap(([predictionModel, entries]) => arrayValue(entries).map((entry) => normalizeUniBindModel(recordValue(entry), predictionModel)));
	});
	return {
		...parseTfId(tfId),
		tfName: stringValue(record.tf_name),
		identifiers: arrayValue(record.identifier).map(String),
		cellLines: arrayValue(record.cell_line).map(String),
		biologicalConditions: arrayValue(record.biological_condition).map(String),
		jasparIds: arrayValue(record.jaspar_id).map(String),
		predictionModels: arrayValue(record.prediction_models).map(String),
		totalPeaks: numberValue(record.total_peaks),
		modelCount: models.length,
		models,
		url: tfId ? `${UNIBIND_API_BASE}/datasets/${encodeURIComponent(tfId)}/` : undefined,
	};
}

function parseSiteName(name: string | undefined): Record<string, unknown> {
	if (!name) return {};
	const parts = name.split("_");
	if (parts.length < 4) return { name };
	return {
		dataset: parts[0],
		cellLine: parts.slice(1, -2).join("_"),
		tfName: parts.at(-2),
		jasparMatrix: parts.at(-1),
	};
}

function siteItems(value: unknown): unknown[] {
	if (Array.isArray(value)) return value;
	const record = recordValue(value);
	return Object.values(record).flatMap((item) => Array.isArray(item) ? item : []);
}

async function unibindExact(mode: string, query: string, rest: string, limit: number): Promise<Record<string, unknown>> {
	const params = queryParamMap(rest);
	const bare = stripQueryParams(rest);
	const endpoints: string[] = [];
	if (mode === "unibind_search_tfbs") {
		const url = new URL(`${UNIBIND_API_BASE}/datasets/`);
		url.searchParams.set("page_size", String(Math.min(parseInteger(params.max_rows, limit), MAX_LIMIT)));
		for (const key of ["tf_name", "cell_line", "species", "jaspar_id", "search"]) {
			if (params[key]) url.searchParams.set(key, params[key]!);
		}
		if (params.collection) url.searchParams.set("collection", normalizeCollection(params.collection));
		if (!params.search && bare) url.searchParams.set("search", bare);
		const payload = recordValue(await fetchJson(url));
		const results = arrayValue(payload.results).map((item) => normalizeUniBindDataset(recordValue(item)));
		endpoints.push(url.toString());
		return output("unibind", query, mode, results, numberValue(payload.count) ?? results.length, endpoints, ["https://unibind.uio.no/genome-tracks/", "https://genome.ucsc.edu/goldenpath/help/api.html"], { truncated: results.length < (numberValue(payload.count) ?? results.length) });
	}
	if (mode === "unibind_get_dataset") {
		const tfId = params.tf_id ?? bare;
		if (!tfId) throw new Error("unibind_get_dataset requires a tf_id.");
		const url = new URL(`${UNIBIND_API_BASE}/datasets/${encodeURIComponent(tfId)}/`);
		const payload = recordValue(await fetchJson(url));
		endpoints.push(url.toString());
		return output("unibind", query, mode, [normalizeUniBindDatasetDetail(payload)], 1, endpoints, "https://unibind.uio.no/genome-tracks/", { tfId });
	}
	const collection = normalizeCollection(params.collection);
	const genome = params.genome ?? params.db;
	const chrom = params.chrom ?? params.chr;
	const start = Number(params.start);
	const end = Number(params.end);
	if (!genome || !chrom || !Number.isFinite(start) || !Number.isFinite(end)) throw new Error("unibind_tfbs_in_region requires genome, chrom, start, and end.");
	if (end <= start) throw new Error("unibind_tfbs_in_region end must be greater than start.");
	if (end - start > MAX_REGION_SPAN) throw new Error("unibind_tfbs_in_region span must be <= 1000000 bp.");
	if (!HUB_GENOMES[collection].has(genome)) throw new Error(`UniBind ${collection} hub does not advertise genome ${genome}.`);
	const url = new URL(`${UCSC_API_BASE}/getData/track`);
	url.searchParams.set("hubUrl", hubUrl(collection));
	url.searchParams.set("genome", genome);
	url.searchParams.set("track", "UniBind");
	url.searchParams.set("chrom", chrom);
	url.searchParams.set("start", String(Math.floor(start)));
	url.searchParams.set("end", String(Math.floor(end)));
	url.searchParams.set("maxItemsOutput", String(REGION_FETCH_CAP));
	const payload = recordValue(await fetchJson(url));
	const tfFilter = (params.tf_name ?? params.tf)?.toLowerCase();
	const sites: Record<string, unknown>[] = siteItems(payload.UniBind).map((item) => {
		const row = recordValue(item);
		const name = stringValue(row.name);
		return {
			name,
			chrom: stringValue(row.chrom),
			start: numberValue(row.chromStart),
			end: numberValue(row.chromEnd),
			strand: stringValue(row.strand),
			...parseSiteName(name),
		};
	});
	const filtered = tfFilter ? sites.filter((site) => String(site.tfName ?? "").toLowerCase() === tfFilter) : sites;
	const results = filtered.slice(0, limit);
	endpoints.push(url.toString());
	return output("unibind", query, mode, results, filtered.length, endpoints, ["https://unibind.uio.no/genome-tracks/", "https://genome.ucsc.edu/goldenpath/help/api.html"], {
		collection,
		genome,
		chrom,
		start,
		end,
		tfNameFilter: params.tf_name ?? params.tf,
		itemsScanned: sites.length,
		regionScanComplete: !payload.maxItemsLimit,
		truncated: results.length < filtered.length || Boolean(payload.maxItemsLimit),
	});
}

export async function searchRegulationExact(params: SearchParams): Promise<Record<string, unknown> | undefined> {
	const match = params.query.match(REGULATION_COMMANDS);
	if (!match) return undefined;
	const mode = match[1]!.toLowerCase();
	const rest = match[2]!.trim();
	const limit = safeLimit(params.limit);
	if (mode.startsWith("encode_")) return encodeExact(mode, params.query, rest, limit);
	if (mode.startsWith("jaspar_")) return jasparExact(mode, params.query, rest, limit);
	return unibindExact(mode, params.query, rest, limit);
}

export const regulationExactCommands = [
	"encode_get_biosample",
	"encode_get_experiment",
	"encode_get_file",
	"encode_list_files",
	"encode_search_biosamples",
	"encode_search_experiments",
	"jaspar_get_matrix",
	"jaspar_list_collections",
	"jaspar_list_matrices",
	"jaspar_list_releases",
	"jaspar_list_species",
	"jaspar_list_taxa",
	"jaspar_matrix_versions",
	"unibind_get_dataset",
	"unibind_search_tfbs",
	"unibind_tfbs_in_region",
] as const;
