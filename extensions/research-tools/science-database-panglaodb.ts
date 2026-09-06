import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

type SearchParams = { limit?: number; query: string };

type PanglaoMarkerRow = {
	canonicalMarker: boolean;
	cellType: string;
	geneSymbol: string;
	geneType?: string;
	germLayer?: string;
	nicknames: string[];
	organ?: string;
	productDescription?: string;
	sensitivityHuman?: number;
	sensitivityMouse?: number;
	species: string[];
	specificityHuman?: number;
	specificityMouse?: number;
	ubiquitousnessIndex?: number;
};

type PanglaoSearchOptions = {
	canonicalOnly: boolean;
	includeSynonyms: boolean;
	mode: "cell" | "gene" | "options";
	organ?: string;
	query: string;
	sensitivityMin?: number;
	species?: "Hs" | "Mm";
	specificityMax?: number;
};

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;
const REQUEST_TIMEOUT_MS = 25_000;
const PANGLAODB_MARKERS_URL = "https://panglaodb.se/markers/PanglaoDB_markers_27_Mar_2020.tsv.gz";
const PANGLAODB_MARKERS_SHA256 = "6779952ad40aa5a124de7bd0e18975c6630bd6006d6b3ef210a916caaa6b53c9";

let panglaoMarkerRowsPromise: Promise<PanglaoMarkerRow[]> | undefined;

function safeLimit(value: number | undefined): number {
	if (!Number.isFinite(value) || value === undefined) return DEFAULT_LIMIT;
	return Math.max(1, Math.min(Math.floor(value), MAX_LIMIT));
}

function cleanQuery(query: string): string {
	const clean = query.trim();
	if (!clean) throw new Error("Science database search requires a non-empty query.");
	return clean;
}

function parseNumber(value: string | undefined): number | undefined {
	if (!value) return undefined;
	const clean = value.trim();
	if (!clean || clean === "NA" || clean === "NaN" || clean === "None") return undefined;
	const parsed = Number(clean);
	return Number.isFinite(parsed) ? parsed : undefined;
}

function cleanPanglaoValue(value: string | undefined): string | undefined {
	const clean = value?.trim();
	return clean && clean !== "NA" && clean !== "None" ? clean : undefined;
}

async function fetchBytes(url: URL): Promise<Buffer> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
	try {
		const response = await fetch(url, {
			headers: {
				accept: "application/gzip,application/octet-stream",
				"user-agent": "feynman-science-database-search/1.0 (https://github.com/advaitpaliwal/feynman)",
			},
			signal: controller.signal,
		});
		if (!response.ok) throw new Error(`Science database request failed: ${response.status} ${response.statusText}`);
		return Buffer.from(await response.arrayBuffer());
	} finally {
		clearTimeout(timeout);
	}
}

function parsePanglaoMarkers(text: string): PanglaoMarkerRow[] {
	const lines = text.split(/\r?\n/).filter((line) => line.trim());
	const header = lines.shift()?.split("\t") ?? [];
	const expected = [
		"species",
		"official gene symbol",
		"cell type",
		"nicknames",
		"ubiquitousness index",
		"product description",
		"gene type",
		"canonical marker",
		"germ layer",
		"organ",
		"sensitivity_human",
		"sensitivity_mouse",
		"specificity_human",
		"specificity_mouse",
	];
	if (header.join("\t") !== expected.join("\t")) {
		throw new Error(`Unexpected PanglaoDB marker header: ${header.join(", ")}`);
	}
	return lines.map((line) => {
		const columns = line.split("\t");
		const value = (name: string) => columns[header.indexOf(name)];
		return {
			canonicalMarker: value("canonical marker") === "1",
			cellType: value("cell type") ?? "",
			geneSymbol: value("official gene symbol") ?? "",
			geneType: cleanPanglaoValue(value("gene type")),
			germLayer: cleanPanglaoValue(value("germ layer")),
			nicknames: (cleanPanglaoValue(value("nicknames")) ?? "").split("|").map((item) => item.trim()).filter(Boolean),
			organ: cleanPanglaoValue(value("organ")),
			productDescription: cleanPanglaoValue(value("product description")),
			sensitivityHuman: parseNumber(value("sensitivity_human")),
			sensitivityMouse: parseNumber(value("sensitivity_mouse")),
			species: (cleanPanglaoValue(value("species")) ?? "").split(/\s+/).filter(Boolean),
			specificityHuman: parseNumber(value("specificity_human")),
			specificityMouse: parseNumber(value("specificity_mouse")),
			ubiquitousnessIndex: parseNumber(value("ubiquitousness index")),
		};
	}).filter((row) => row.cellType && row.geneSymbol);
}

async function loadPanglaoMarkers(): Promise<PanglaoMarkerRow[]> {
	if (!panglaoMarkerRowsPromise) {
		panglaoMarkerRowsPromise = (async () => {
			const localPath = process.env.FEYNMAN_PANGLAODB_MARKERS_PATH?.trim();
			const gz = localPath ? readFileSync(localPath) : await fetchBytes(new URL(PANGLAODB_MARKERS_URL));
			const digest = createHash("sha256").update(gz).digest("hex");
			const expectedDigest = process.env.FEYNMAN_PANGLAODB_MARKERS_SHA256?.trim() || PANGLAODB_MARKERS_SHA256;
			if (digest !== expectedDigest) {
				throw new Error(`PanglaoDB marker file checksum mismatch: expected ${expectedDigest}, got ${digest}.`);
			}
			return parsePanglaoMarkers(gunzipSync(gz).toString("utf8"));
		})();
	}
	return panglaoMarkerRowsPromise;
}

function panglaoDocs(): string[] {
	return [
		"https://panglaodb.se/markers.html",
		PANGLAODB_MARKERS_URL,
	];
}

function panglaoSpeciesColumn(species: string | undefined, kind: "sensitivity" | "specificity"): keyof PanglaoMarkerRow {
	if (species === "Mm") return kind === "sensitivity" ? "sensitivityMouse" : "specificityMouse";
	return kind === "sensitivity" ? "sensitivityHuman" : "specificityHuman";
}

function panglaoSortKey(row: PanglaoMarkerRow): string {
	return `${row.cellType}\t${row.geneSymbol}\t${row.species.join(" ")}`;
}

function parsePanglaoOptions(query: string): PanglaoSearchOptions {
	const clean = cleanQuery(query);
	if (/^(?:options|panglaodb_options):?$/i.test(clean)) return { canonicalOnly: false, includeSynonyms: false, mode: "options", query: clean };
	const namedMarkers = clean.match(/^panglaodb_marker_genes(?::|\s+)(.*)$/i);
	if (namedMarkers?.[1]) return parsePanglaoOptions(`cell:${namedMarkers[1]}`);
	const namedCellTypes = clean.match(/^panglaodb_cell_types_for_gene(?::|\s+)(.*)$/i);
	if (namedCellTypes?.[1]) return parsePanglaoOptions(`gene:${namedCellTypes[1].replace(/\binclude_synonyms=/gi, "synonyms=")}`);
	const mode = /^gene\s*:/i.test(clean) ? "gene" : "cell";
	const body = clean.replace(/^(?:cell|markers?)\s*:/i, "").replace(/^gene\s*:/i, "").trim();
	const tokens = body.split(/\s+/);
	const free: string[] = [];
	const options: PanglaoSearchOptions = { canonicalOnly: false, includeSynonyms: false, mode, query: "" };
	for (const token of tokens) {
		const match = token.match(/^([^=<>]+)(?:=|:)(.+)$/);
		if (!match) {
			if (/^canonical(?:_only)?$/i.test(token)) options.canonicalOnly = true;
			else if (/^synonyms?$/i.test(token)) options.includeSynonyms = true;
			else free.push(token);
			continue;
		}
		const key = match[1]?.toLowerCase();
		const value = match[2] ?? "";
		if (key === "species" && /^(Hs|Mm)$/i.test(value)) options.species = value.toLowerCase() === "mm" ? "Mm" : "Hs";
		else if (key === "organ") options.organ = value.replace(/_/g, " ");
		else if (key === "canonical" || key === "canonical_only") options.canonicalOnly = /^(1|true|yes)$/i.test(value);
		else if (key === "synonyms") options.includeSynonyms = /^(1|true|yes)$/i.test(value);
		else if (key === "sensitivity_min") options.sensitivityMin = Number(value);
		else if (key === "specificity_max") options.specificityMax = Number(value);
		else free.push(token);
	}
	options.query = free.join(" ").trim();
	if (!options.query && options.mode !== "options") throw new Error("PanglaoDB search requires a cell type or gene symbol.");
	if (options.sensitivityMin !== undefined && !Number.isFinite(options.sensitivityMin)) throw new Error("PanglaoDB sensitivity_min must be numeric.");
	if (options.specificityMax !== undefined && !Number.isFinite(options.specificityMax)) throw new Error("PanglaoDB specificity_max must be numeric.");
	return options;
}

function normalizePanglaoMarker(row: PanglaoMarkerRow, matchedVia?: string): Record<string, unknown> {
	return {
		geneSymbol: row.geneSymbol,
		cellType: row.cellType,
		species: row.species,
		organ: row.organ,
		germLayer: row.germLayer,
		canonicalMarker: row.canonicalMarker,
		ubiquitousnessIndex: row.ubiquitousnessIndex,
		sensitivityHuman: row.sensitivityHuman,
		sensitivityMouse: row.sensitivityMouse,
		specificityHuman: row.specificityHuman,
		specificityMouse: row.specificityMouse,
		geneType: row.geneType,
		productDescription: row.productDescription,
		nicknames: row.nicknames,
		matchedVia,
		url: `https://panglaodb.se/markers.html?cell_type=%27${encodeURIComponent(row.cellType)}%27`,
	};
}

export async function searchPanglaoDb(params: SearchParams): Promise<Record<string, unknown>> {
	const parsed = parsePanglaoOptions(params.query);
	const limit = safeLimit(params.limit);
	const rows = await loadPanglaoMarkers();
	if (parsed.mode === "options") {
		const organs = [...new Set(rows.map((row) => row.organ).filter(Boolean))].sort();
		const cellTypes = [...new Set(rows.map((row) => row.cellType).filter(Boolean))].sort();
		const species = [...new Set(rows.flatMap((row) => row.species).filter(Boolean))].sort();
		return {
			schema: "feynman.scienceDatabaseSearch.v1",
			source: "panglaodb",
			mode: "options",
			query: parsed.query,
			totalRows: rows.length,
			returned: 1,
			results: [{
				species,
				organs,
				cellTypes: cellTypes.slice(0, Math.max(limit, DEFAULT_LIMIT) * 20),
				cellTypeCount: cellTypes.length,
				organCount: organs.length,
			}],
			provenance: {
				docs: panglaoDocs(),
				endpoints: [process.env.FEYNMAN_PANGLAODB_MARKERS_PATH?.trim() || PANGLAODB_MARKERS_URL],
			},
		};
	}
	const wanted = parsed.query.toLowerCase();
	const sensitivityColumn = panglaoSpeciesColumn(parsed.species, "sensitivity");
	const specificityColumn = panglaoSpeciesColumn(parsed.species, "specificity");
	const matches = rows.filter((row) => {
		if (parsed.species && !row.species.includes(parsed.species)) return false;
		if (parsed.organ && row.organ?.toLowerCase() !== parsed.organ.toLowerCase()) return false;
		if (parsed.canonicalOnly && !row.canonicalMarker) return false;
		if (parsed.sensitivityMin !== undefined) {
			const value = row[sensitivityColumn];
			if (typeof value !== "number" || value < parsed.sensitivityMin) return false;
		}
		if (parsed.specificityMax !== undefined) {
			const value = row[specificityColumn];
			if (typeof value !== "number" || value > parsed.specificityMax) return false;
		}
		if (parsed.mode === "gene") {
			if (row.geneSymbol.toLowerCase() === wanted) return true;
			return parsed.includeSynonyms && row.nicknames.some((nickname) => nickname.toLowerCase() === wanted);
		}
		return row.cellType.toLowerCase() === wanted;
	});
	const fallbackMatches = parsed.mode === "cell" && !matches.length
		? rows.filter((row) => row.cellType.toLowerCase().includes(wanted))
		: matches;
	const results = fallbackMatches
		.sort((a, b) => panglaoSortKey(a).localeCompare(panglaoSortKey(b)))
		.slice(0, limit)
		.map((row) => normalizePanglaoMarker(row, parsed.mode === "gene" && row.geneSymbol.toLowerCase() !== wanted ? "synonym" : parsed.mode === "gene" ? "official symbol" : "cell type"));
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "panglaodb",
		mode: parsed.mode,
		query: parsed.query,
		filters: {
			canonicalOnly: parsed.canonicalOnly,
			organ: parsed.organ,
			sensitivityMin: parsed.sensitivityMin,
			species: parsed.species,
			specificityMax: parsed.specificityMax,
		},
		totalRows: rows.length,
		totalCount: fallbackMatches.length,
		returned: results.length,
		results,
		provenance: {
			docs: panglaoDocs(),
			endpoints: [process.env.FEYNMAN_PANGLAODB_MARKERS_PATH?.trim() || PANGLAODB_MARKERS_URL],
		},
	};
}
