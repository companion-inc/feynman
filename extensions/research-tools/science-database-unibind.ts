export type UniBindScienceDatabaseSource = "unibind";

type SearchParams = { limit?: number; query: string; source: UniBindScienceDatabaseSource };

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;
const REQUEST_TIMEOUT_MS = 25_000;
const UNIBIND_API_BASE = "https://unibind.uio.no/api/v1";
const UCSC_API_BASE = "https://api.genome.ucsc.edu";
const UNIBIND_DOCS = "https://unibind.uio.no/genome-tracks/";
const UCSC_API_DOCS = "https://genome.ucsc.edu/goldenpath/help/api.html";
const REGION_FETCH_CAP = 20_000;
const MAX_REGION_SPAN = 1_000_000;

const HUB_GENOMES: Record<"Robust" | "Permissive", Set<string>> = {
	Permissive: new Set(["dm6", "danRer11", "ce11", "mm10", "hg19", "hg38", "rn6", "rn7"]),
	Robust: new Set(["dm6", "danRer11", "ce11", "mm10", "hg38", "rn6"]),
};

export function isUniBindScienceDatabaseSource(source: string): source is UniBindScienceDatabaseSource {
	return source === "unibind";
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
	if (!clean) throw new Error("UniBind search requires a non-empty query.");
	return clean;
}

async function fetchJson(url: URL): Promise<{ partial: boolean; payload: Record<string, unknown> }> {
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
		if (![200, 206].includes(response.status)) {
			let detail = response.statusText;
			try {
				detail = stringValue(recordValue(await response.json()).error) ?? detail;
			} catch {
				detail = response.statusText;
			}
			throw new Error(`UniBind request failed: ${response.status} ${detail}`);
		}
		return { partial: response.status === 206, payload: recordValue(await response.json()) };
	} finally {
		clearTimeout(timeout);
	}
}

function stripPrefix(query: string, prefix: string): string | undefined {
	const match = query.match(new RegExp(`^(?:${prefix})(?::|\\s+)\\s*(.*)$`, "i"));
	return match ? (match[1] ?? "").trim() : undefined;
}

function queryOptions(query: string): Record<string, string> {
	const options: Record<string, string> = {};
	for (const match of query.matchAll(/(?:^|\s)([a-zA-Z_][\w-]*)=([^\s]+)/g)) {
		options[match[1]!.toLowerCase()] = match[2]!;
	}
	return options;
}

function removeOptions(query: string): string {
	return query.replace(/(?:^|\s)[a-zA-Z_][\w-]*=[^\s]+/g, " ").replace(/\s+/g, " ").trim();
}

function optionNumber(options: Record<string, string>, name: string, fallback?: number): number | undefined {
	const value = options[name];
	if (value === undefined) return fallback;
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) throw new Error(`UniBind ${name}= must be numeric.`);
	return Math.floor(parsed);
}

function normalizeCollection(value: string | undefined): "Robust" | "Permissive" {
	const clean = (value ?? "Robust").trim().toLowerCase();
	if (clean === "robust") return "Robust";
	if (clean === "permissive") return "Permissive";
	throw new Error("UniBind collection= must be Robust or Permissive.");
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
		cellLineSlug: rest.join("."),
		tfName,
	};
}

function normalizeDatasetSearchRecord(record: Record<string, unknown>): Record<string, unknown> {
	const url = stringValue(record.url);
	const tfId = stringValue(record.tf_id) ?? (url ? decodeURIComponent(url.replace(/\/$/, "").split("/").pop() ?? "") : undefined);
	const parsed = parseTfId(tfId);
	return {
		...parsed,
		tfName: stringValue(record.tf_name) ?? parsed.tfName,
		totalPeaks: numberValue(record.total_peaks),
		url,
	};
}

function modelFileUrl(value: unknown): string | undefined {
	const url = stringValue(value);
	return url?.startsWith("http") ? url : undefined;
}

function normalizeDatasetDetail(record: Record<string, unknown>): Record<string, unknown> {
	const tfId = stringValue(record.tf_id) ?? stringValue(record.id);
	const modelGroups = arrayValue(record.tfbs).flatMap((group) => {
		const groupRecord = recordValue(group);
		const legacyModels = arrayValue(groupRecord.tfbs);
		if (legacyModels.length) {
			const common = {
				predictionModel: stringValue(groupRecord.prediction_model),
				jasparId: stringValue(groupRecord.jaspar_id),
				jasparVersion: stringValue(groupRecord.jaspar_version),
			};
			return legacyModels.map((model) => normalizeDatasetModel(recordValue(model), common));
		}
		return Object.entries(groupRecord).flatMap(([predictionModel, models]) => {
			return arrayValue(models).map((model) => normalizeDatasetModel(recordValue(model), { predictionModel }));
		});
	});
	const biologicalCondition = recordValue(record.biological_condition);
	const biologicalConditionList = arrayValue(record.biological_condition).map(String).filter(Boolean);
	const identifierList = [
		...arrayValue(record.identifiers).map(String),
		stringValue(record.identifier),
	].filter((value): value is string => Boolean(value));
	const jasparIds = [
		...arrayValue(record.jaspar_ids).map(String),
		stringValue(record.jaspar_id),
	].filter((value): value is string => Boolean(value));
	return {
		...parseTfId(tfId),
		tfName: stringValue(record.tf_name),
		identifiers: [...new Set(identifierList)],
		cellLines: [...new Set([...arrayValue(biologicalCondition.cell_lines).map(String), stringValue(record.cell_line)].filter((value): value is string => Boolean(value)))],
		biologicalConditions: [...new Set([...arrayValue(biologicalCondition.biological_conditions).map(String), ...biologicalConditionList].filter(Boolean))],
		jasparIds: [...new Set(jasparIds)],
		predictionModels: arrayValue(record.prediction_models).map(String).filter(Boolean),
		totalPeaks: numberValue(record.total_peaks),
		modelCount: modelGroups.length,
		models: modelGroups,
		url: tfId ? `${UNIBIND_API_BASE}/datasets/${encodeURIComponent(tfId)}/` : undefined,
	};
}

function normalizeDatasetModel(modelRecord: Record<string, unknown>, common: Record<string, unknown>): Record<string, unknown> {
	return {
		predictionModel: stringValue(modelRecord.prediction_model) ?? stringValue(common.predictionModel),
		jasparId: stringValue(modelRecord.jaspar_id) ?? stringValue(common.jasparId),
		jasparVersion: stringValue(modelRecord.jaspar_version) ?? stringValue(common.jasparVersion),
		totalTfbs: numberValue(modelRecord.total_tfbs),
		scoreThreshold: numberValue(modelRecord.score_threshold),
		distanceThreshold: numberValue(modelRecord.distance_threshold),
		adjustedCentrimoPValue: numberValue(modelRecord.adj_centrimo_pvalue),
		bedUrl: modelFileUrl(modelRecord.bed_url) ?? modelFileUrl(modelRecord.bed),
		fastaUrl: modelFileUrl(modelRecord.fasta_url) ?? modelFileUrl(modelRecord.fasta),
		summaryPlotUrl: modelFileUrl(modelRecord.summary_plot_url) ?? modelFileUrl(modelRecord.summary_plot),
	};
}

function parseSiteName(name: string | undefined): Record<string, unknown> {
	if (!name) return {};
	const parts = name.split("_");
	if (parts.length < 4) return { name };
	const dataset = parts[0];
	const jasparMatrix = parts.at(-1);
	const tfName = parts.at(-2);
	const cellLineSlug = parts.slice(1, -2).join("_");
	return {
		dataset,
		cellLineSlug,
		tfName,
		jasparMatrix,
	};
}

function normalizeSite(record: Record<string, unknown>): Record<string, unknown> {
	const name = stringValue(record.name);
	return {
		name,
		chrom: stringValue(record.chrom),
		start: numberValue(record.chromStart) ?? numberValue(record.start),
		end: numberValue(record.chromEnd) ?? numberValue(record.end),
		strand: stringValue(record.strand),
		score: numberValue(record.score),
		color: stringValue(record.color) ?? stringValue(record.itemRgb),
		...parseSiteName(name),
	};
}

function siteItems(value: unknown): unknown[] {
	if (Array.isArray(value)) return value;
	const record = recordValue(value);
	return Object.values(record).flatMap((item) => Array.isArray(item) ? item : []);
}

async function searchDatasets(params: SearchParams): Promise<Record<string, unknown>> {
	const query = cleanQuery(params.query);
	const limit = safeLimit(params.limit);
	const options = queryOptions(query);
	const rawTerm = removeOptions(stripPrefix(query, "datasets|search") ?? query);
	const term = rawTerm.trim();
	const url = new URL(`${UNIBIND_API_BASE}/datasets/`);
	url.searchParams.set("page_size", String(limit));
	const tfName = stringValue(options.tf) ?? stringValue(options.tf_name);
	if (tfName) url.searchParams.set("tf_name", tfName);
	else if (term) url.searchParams.set("search", term);
	const cellLine = stringValue(options.cell_line) ?? stringValue(options.cell);
	if (cellLine) url.searchParams.set("cell_line", cellLine);
	if (options.species) url.searchParams.set("species", options.species);
	if (options.collection) url.searchParams.set("collection", normalizeCollection(options.collection));
	const jasparId = stringValue(options.jaspar) ?? stringValue(options.jaspar_id);
	if (jasparId) url.searchParams.set("jaspar_id", jasparId);
	if (!tfName && !term && !cellLine && !options.species && !jasparId) throw new Error("UniBind dataset search requires text, tf=, cell_line=, species=, or jaspar=.");
	const { payload } = await fetchJson(url);
	const results = arrayValue(payload.results).map((item) => normalizeDatasetSearchRecord(recordValue(item)));
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "unibind",
		query,
		mode: "datasets",
		totalCount: numberValue(payload.count) ?? results.length,
		returned: results.length,
		results,
		provenance: { docs: UNIBIND_DOCS, endpoints: [url.toString()] },
	};
}

async function getDataset(params: SearchParams): Promise<Record<string, unknown>> {
	const query = cleanQuery(params.query);
	const rawId = removeOptions(stripPrefix(query, "dataset|detail") ?? query).trim();
	if (!rawId) throw new Error("UniBind dataset detail requires dataset:<tf_id>.");
	const url = new URL(`${UNIBIND_API_BASE}/datasets/${encodeURIComponent(rawId)}/`);
	const { payload } = await fetchJson(url);
	const detail = normalizeDatasetDetail(payload);
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "unibind",
		query,
		mode: "dataset-detail",
		tfId: rawId,
		totalCount: 1,
		returned: 1,
		results: [detail],
		provenance: { docs: UNIBIND_DOCS, endpoints: [url.toString()] },
	};
}

function browserUrl(genome: string, chrom: string, start: number, end: number, collection: "Robust" | "Permissive"): string {
	const url = new URL("https://genome.ucsc.edu/cgi-bin/hgTracks");
	url.searchParams.set("db", genome);
	url.searchParams.set("position", `${chrom}:${Math.max(1, start + 1)}-${end}`);
	url.searchParams.set("hubUrl", hubUrl(collection));
	return url.toString();
}

async function searchRegion(params: SearchParams): Promise<Record<string, unknown>> {
	const query = cleanQuery(params.query);
	const limit = safeLimit(params.limit);
	const options = queryOptions(query);
	const collection = normalizeCollection(options.collection);
	const genome = (options.genome ?? options.db ?? "").trim();
	const chrom = (options.chrom ?? options.chr ?? "").trim();
	const start = optionNumber(options, "start");
	const end = optionNumber(options, "end");
	if (!genome || !chrom || start === undefined || end === undefined) throw new Error("UniBind region search requires genome=, chrom=, start=, and end=.");
	if (end <= start) throw new Error("UniBind region end must be greater than start.");
	if (end - start > MAX_REGION_SPAN) throw new Error("UniBind region span must be <= 1000000 bp.");
	if (!HUB_GENOMES[collection].has(genome)) throw new Error(`UniBind ${collection} UCSC hub does not advertise genome ${genome}.`);
	const tfFilter = (stringValue(options.tf) ?? stringValue(options.tf_name))?.toLowerCase();
	const url = new URL(`${UCSC_API_BASE}/getData/track`);
	url.searchParams.set("hubUrl", hubUrl(collection));
	url.searchParams.set("genome", genome);
	url.searchParams.set("track", "UniBind");
	url.searchParams.set("chrom", chrom);
	url.searchParams.set("start", String(start));
	url.searchParams.set("end", String(end));
	url.searchParams.set("maxItemsOutput", String(REGION_FETCH_CAP));
	const { partial, payload } = await fetchJson(url);
	const sites = siteItems(payload.UniBind).map((item) => normalizeSite(recordValue(item)));
	const filtered = tfFilter
		? sites.filter((site) => String(site.tfName ?? site.name ?? "").toLowerCase().includes(tfFilter))
		: sites;
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "unibind",
		query,
		mode: "region-tfbs",
		collection,
		genome,
		chrom,
		start,
		end,
		tfFilter: tfFilter ?? undefined,
		itemsScanned: sites.length,
		totalCount: filtered.length,
		returned: Math.min(filtered.length, limit),
		truncated: Boolean(payload.maxItemsLimit) || partial || filtered.length > limit,
		results: filtered.slice(0, limit),
		url: browserUrl(genome, chrom, start, end, collection),
		provenance: {
			docs: [UNIBIND_DOCS, UCSC_API_DOCS],
			endpoints: [url.toString()],
			hubUrl: hubUrl(collection),
		},
	};
}

export async function searchUniBind(params: SearchParams): Promise<Record<string, unknown>> {
	const query = cleanQuery(params.query);
	if (stripPrefix(query, "region|tfbs")) return searchRegion(params);
	if (stripPrefix(query, "dataset|detail")) return getDataset(params);
	const queryWithoutOptions = removeOptions(query);
	if (/^[A-Z0-9]+[.][^.]+[.][A-Za-z0-9-]+$/.test(queryWithoutOptions)) return getDataset({ ...params, query: queryWithoutOptions });
	return searchDatasets(params);
}
