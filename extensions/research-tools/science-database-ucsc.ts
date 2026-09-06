export type UcscScienceDatabaseSource = "ucsc";

type SearchParams = { limit?: number; query: string; source: UcscScienceDatabaseSource };

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;
const REQUEST_TIMEOUT_MS = 25_000;
const UCSC_API_BASE = "https://api.genome.ucsc.edu";
const UCSC_DOCS = "https://genome.ucsc.edu/goldenpath/help/api.html";
const TFBS_TRACKS: Record<string, string> = {
	hg19: "wgEncodeRegTfbsClusteredV3",
	hg38: "encRegTfbsClustered",
};

export function isUcscScienceDatabaseSource(source: string): source is UcscScienceDatabaseSource {
	return source === "ucsc";
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

function safeLimit(value: number | undefined): number {
	if (!Number.isFinite(value) || value === undefined) return DEFAULT_LIMIT;
	return Math.max(1, Math.min(Math.floor(value), MAX_LIMIT));
}

function cleanQuery(query: string): string {
	const clean = query.trim();
	if (!clean) throw new Error("UCSC search requires a non-empty query.");
	return clean;
}

async function fetchUcscJson(url: URL): Promise<{ partial: boolean; payload: Record<string, unknown> }> {
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
			throw new Error(`UCSC API request failed: ${response.status} ${detail}`);
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
	for (const source of [query, query.replace(/^[^:]+:/, " ")]) {
		for (const match of source.matchAll(/(?:^|\s)([a-zA-Z_][\w-]*)=([^\s]+)/g)) {
			options[match[1]!.toLowerCase()] = match[2]!;
		}
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
	if (!Number.isFinite(parsed)) throw new Error(`UCSC ${name}= must be numeric.`);
	return Math.floor(parsed);
}

function boundedOptionNumber(options: Record<string, string>, names: string[], fallback: number): number {
	for (const name of names) {
		const value = optionNumber(options, name);
		if (value !== undefined) return Math.max(1, Math.min(value, MAX_LIMIT));
	}
	return fallback;
}

function genomeFrom(options: Record<string, string>, fallback = "hg38"): string {
	return (options.genome ?? options.db ?? fallback).trim();
}

function browserUrl(genome: string, chrom?: string, start?: number, end?: number): string {
	const url = new URL("https://genome.ucsc.edu/cgi-bin/hgTracks");
	url.searchParams.set("db", genome);
	if (chrom && start !== undefined && end !== undefined) {
		url.searchParams.set("position", `${chrom}:${Math.max(1, start + 1)}-${end}`);
	}
	return url.toString();
}

function normalizeGenome(id: string, record: Record<string, unknown>): Record<string, unknown> {
	return {
		genome: id,
		organism: stringValue(record.organism),
		scientificName: stringValue(record.scientificName),
		description: stringValue(record.description),
		sourceName: stringValue(record.sourceName),
		taxId: numberValue(record.taxId),
		defaultPosition: stringValue(record.defaultPos),
		active: booleanValue(record.active),
		url: browserUrl(id),
	};
}

async function searchGenomes(params: SearchParams): Promise<Record<string, unknown>> {
	const query = cleanQuery(params.query);
	const limit = safeLimit(params.limit);
	const options = queryOptions(query);
	const filter = stringValue(removeOptions(stripPrefix(query, "genomes|assemblies") ?? "")) ?? stringValue(options.filter);
	const url = new URL(`${UCSC_API_BASE}/list/ucscGenomes`);
	const { payload } = await fetchUcscJson(url);
	const genomes = recordValue(payload.ucscGenomes);
	const needle = filter?.toLowerCase();
	const rows = Object.entries(genomes)
		.map(([id, record]) => normalizeGenome(id, recordValue(record)))
		.filter((record) => {
			if (!needle) return true;
			return [record.genome, record.organism, record.scientificName, record.description, record.sourceName]
				.some((value) => typeof value === "string" && value.toLowerCase().includes(needle));
		})
		.sort((a, b) => String(a.genome).localeCompare(String(b.genome)));
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "ucsc",
		query,
		mode: "genomes",
		filter,
		totalCount: rows.length,
		returned: Math.min(rows.length, limit),
		results: rows.slice(0, limit),
		provenance: { docs: UCSC_DOCS, endpoints: [url.toString()] },
	};
}

function stripMarkupText(value: string | undefined): string | undefined {
	if (!value) return undefined;
	const knownMarkupTags = new Set(["a", "abbr", "b", "br", "div", "em", "i", "li", "ol", "p", "span", "strong", "sub", "sup", "table", "tbody", "td", "th", "thead", "tr", "u", "ul"]);
	let output = "";
	for (let index = 0; index < value.length; index += 1) {
		if (value[index] !== "<") {
			output += value[index];
			continue;
		}
		const candidate = value.slice(index);
		const completeTag = candidate.match(/^<\/?([A-Za-z][A-Za-z0-9:-]*)(?:\s[^<>]*)?\s*\/?>/);
		if (completeTag?.[0] && knownMarkupTags.has(completeTag[1].toLowerCase())) {
			output += " ";
			index += completeTag[0].length - 1;
			continue;
		}
		const incompleteTag = candidate.match(/^<\/?([A-Za-z][A-Za-z0-9:-]*)(?:\s|$)/);
		if (incompleteTag?.[1] && knownMarkupTags.has(incompleteTag[1].toLowerCase())) break;
		output += "<";
	}
	return stringValue(output.replace(/\s+/g, " "));
}

function normalizeTrackSearchMatch(record: Record<string, unknown>): Record<string, unknown> {
	const position = stringValue(record.position) ?? stringValue(record.posName);
	const [track, shortLabel, longLabel] = (position ?? "").split(":");
	return {
		track: stringValue(track) ?? position,
		shortLabel: stringValue(shortLabel),
		longLabel: stringValue(longLabel),
		position,
		description: stripMarkupText(stringValue(record.description)),
		canonical: booleanValue(record.canonical),
	};
}

async function searchTrackDb(params: SearchParams): Promise<Record<string, unknown>> {
	const query = cleanQuery(params.query);
	const limit = safeLimit(params.limit);
	const options = queryOptions(query);
	const genome = genomeFrom(options);
	const rawTerm = removeOptions(stripPrefix(query, "search|track-search") ?? query);
	const term = rawTerm.replace(/^trackdb\s*:\s*/i, "").trim();
	if (!term) throw new Error("UCSC track search requires search:<term> or search <term>.");
	const url = new URL(`${UCSC_API_BASE}/search`);
	url.searchParams.set("search", term);
	url.searchParams.set("genome", genome);
	url.searchParams.set("categories", "trackDb");
	const { payload } = await fetchUcscJson(url);
	const matches = arrayValue(recordValue(arrayValue(payload.positionMatches)[0]).matches)
		.map((item) => normalizeTrackSearchMatch(recordValue(item)));
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "ucsc",
		query,
		mode: "track-search",
		genome,
		search: term,
		totalCount: matches.length,
		returned: Math.min(matches.length, limit),
		results: matches.slice(0, limit),
		provenance: { docs: UCSC_DOCS, endpoints: [url.toString()] },
	};
}

function normalizeTrackRow(name: string, record: Record<string, unknown>): Record<string, unknown> {
	return {
		track: name,
		shortLabel: stringValue(record.shortLabel),
		longLabel: stringValue(record.longLabel),
		type: stringValue(record.type),
		group: stringValue(record.group),
		parent: stringValue(record.parent),
		visibility: stringValue(record.visibility),
	};
}

async function listTracks(params: SearchParams): Promise<Record<string, unknown>> {
	const query = cleanQuery(params.query);
	const options = queryOptions(query);
	const exact = /^ucsc_list_tracks(?::|\s|$)/i.test(query);
	const limit = exact ? boundedOptionNumber(options, ["max_tracks", "max"], safeLimit(params.limit)) : safeLimit(params.limit);
	const raw = removeOptions(stripPrefix(query, "tracks|list-tracks|ucsc_list_tracks") ?? "");
	const [maybeGenome, ...filterParts] = raw.split(/\s+/).filter(Boolean);
	const genome = options.genome ?? (/^[a-z]+\d+/i.test(maybeGenome ?? "") ? maybeGenome : "hg38");
	const filter = stringValue(options.filter_text) ?? stringValue(options.filter) ?? (genome === maybeGenome ? filterParts.join(" ") : raw);
	const url = new URL(`${UCSC_API_BASE}/list/tracks`);
	url.searchParams.set("genome", genome);
	url.searchParams.set("trackLeavesOnly", "1");
	const { payload } = await fetchUcscJson(url);
	const trackMap = recordValue(payload[genome]);
	const needle = filter?.toLowerCase();
	const rows = Object.entries(trackMap)
		.map(([name, record]) => normalizeTrackRow(name, recordValue(record)))
		.filter((record) => {
			if (!needle) return true;
			return [record.track, record.shortLabel, record.longLabel, record.type, record.group, record.parent]
				.some((value) => typeof value === "string" && value.toLowerCase().includes(needle));
		})
		.sort((a, b) => String(a.track).localeCompare(String(b.track)));
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "ucsc",
		query,
		mode: "tracks",
		searchMode: exact ? "ucsc-list-tracks" : undefined,
		genome,
		filter,
		totalCount: rows.length,
		nTotal: rows.length,
		returned: Math.min(rows.length, limit),
		truncated: rows.length > limit,
		tracksTruncated: rows.length > limit,
		tracks: rows.slice(0, limit),
		results: rows.slice(0, limit),
		provenance: { docs: UCSC_DOCS, endpoints: [url.toString()] },
	};
}

async function chromSizes(params: SearchParams): Promise<Record<string, unknown>> {
	const query = cleanQuery(params.query);
	const options = queryOptions(query);
	const exact = /^ucsc_chrom_sizes(?::|\s|$)/i.test(query);
	const limit = exact ? boundedOptionNumber(options, ["max_chroms", "max"], safeLimit(params.limit)) : safeLimit(params.limit);
	const raw = removeOptions(stripPrefix(query, "chroms|chromosomes|ucsc_chrom_sizes") ?? "");
	const [maybeGenome, maybeFilter] = raw.split(/\s+/).filter(Boolean);
	const genome = options.genome ?? (/^[a-z]+\d+/i.test(maybeGenome ?? "") ? maybeGenome : "hg38");
	const filter = stringValue(options.filter_text) ?? stringValue(options.filter) ?? (genome === maybeGenome ? maybeFilter : maybeGenome);
	const url = new URL(`${UCSC_API_BASE}/list/chromosomes`);
	url.searchParams.set("genome", genome);
	const { payload } = await fetchUcscJson(url);
	const chromosomes = recordValue(payload.chromosomes);
	const needle = filter?.toLowerCase();
	const rows = Object.entries(chromosomes)
		.map(([name, size]) => ({ name, sizeBp: numberValue(size) ?? 0 }))
		.filter((record) => !needle || record.name.toLowerCase().includes(needle))
		.sort((a, b) => b.sizeBp - a.sizeBp || a.name.localeCompare(b.name));
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "ucsc",
		query,
		mode: "chromosomes",
		searchMode: exact ? "ucsc-chrom-sizes" : undefined,
		genome,
		filter,
		chromCount: numberValue(payload.chromCount),
		totalCount: rows.length,
		nTotal: rows.length,
		returned: Math.min(rows.length, limit),
		chromsTruncated: rows.length > limit,
		chromosomes: rows.slice(0, limit),
		results: rows.slice(0, limit),
		provenance: { docs: UCSC_DOCS, endpoints: [url.toString()] },
	};
}

function requiredRegion(options: Record<string, string>): { chrom: string; end: number; genome: string; start: number } {
	const chrom = options.chrom ?? options.chr;
	const start = optionNumber(options, "start");
	const end = optionNumber(options, "end");
	if (!chrom || start === undefined || end === undefined) {
		throw new Error("UCSC region queries require chrom=<chr>, start=<0-based>, and end=<exclusive>.");
	}
	if (end <= start) throw new Error("UCSC region query end must be greater than start.");
	return { chrom, start, end, genome: genomeFrom(options) };
}

async function fetchTrackRows(options: Record<string, string>, track: string, defaultMaxRows: number): Promise<{
	chrom: string;
	end: number;
	genome: string;
	partial: boolean;
	payload: Record<string, unknown>;
	rows: unknown[];
	start: number;
	url: URL;
}> {
	const { chrom, start, end, genome } = requiredRegion(options);
	const maxRows = optionNumber(options, "max_rows", optionNumber(options, "max", defaultMaxRows)) ?? defaultMaxRows;
	const url = new URL(`${UCSC_API_BASE}/getData/track`);
	url.searchParams.set("genome", genome);
	url.searchParams.set("track", track);
	url.searchParams.set("chrom", chrom);
	url.searchParams.set("start", String(start));
	url.searchParams.set("end", String(end));
	url.searchParams.set("maxItemsOutput", String(Math.max(1, Math.min(maxRows, 1000))));
	const { partial, payload } = await fetchUcscJson(url);
	const rows = trackRowsFromPayload(payload, track, chrom);
	return { chrom, end, genome, partial, payload, rows, start, url };
}

function trackRowsFromPayload(payload: Record<string, unknown>, track: string, chrom: string): unknown[] {
	let rows: unknown = payload[track];
	if (rows === undefined) {
		const listValues = Object.values(payload).filter((value) => Array.isArray(value));
		if (listValues.length === 1) rows = listValues[0];
	}
	if (rows && typeof rows === "object" && !Array.isArray(rows)) rows = recordValue(rows)[chrom];
	if (rows === undefined) {
		if ((numberValue(payload.itemsReturned) ?? 0) > 0) {
			throw new Error(`UCSC payload for ${track} reported itemsReturned but did not include a recognizable row list.`);
		}
		return [];
	}
	return arrayValue(rows);
}

async function getTrackData(params: SearchParams, mode = "track-data", forcedTrack?: string): Promise<Record<string, unknown>> {
	const query = cleanQuery(params.query);
	const options = queryOptions(query);
	const exact = /^ucsc_track_data(?::|\s|$)/i.test(query) || mode === "tfbs-clusters";
	const limit = exact ? boundedOptionNumber(options, ["max_rows", "max"], safeLimit(params.limit)) : safeLimit(params.limit);
	const rawTrack = forcedTrack ?? removeOptions(stripPrefix(query, "track|data|ucsc_track_data") ?? "").split(/\s+/).find(Boolean);
	const track = options.track ?? rawTrack;
	if (!track) throw new Error("UCSC track data requires track:<name> or track=<name>.");
	const { chrom, end, genome, partial, payload, rows, start, url } = await fetchTrackRows(options, track, limit);
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "ucsc",
		query,
		mode,
		searchMode: mode === "track-data" && exact ? "ucsc-track-data" : undefined,
		genome,
		track,
		chrom,
		start,
		end,
		trackType: stringValue(payload.trackType),
		track_type: stringValue(payload.trackType),
		itemsReturned: numberValue(payload.itemsReturned) ?? rows.length,
		items_returned: numberValue(payload.itemsReturned) ?? rows.length,
		truncated: partial || Boolean(payload.maxItemsLimit),
		dataDownloadUrl: stringValue(payload.dataDownloadUrl),
		data_download_url: stringValue(payload.dataDownloadUrl),
		totalCount: rows.length,
		returned: Math.min(rows.length, limit),
		rows: rows.slice(0, limit),
		results: rows.slice(0, limit),
		url: browserUrl(genome, chrom, start, end),
		provenance: { docs: UCSC_DOCS, endpoints: [url.toString()] },
	};
}

async function conservation(params: SearchParams): Promise<Record<string, unknown>> {
	const query = cleanQuery(params.query);
	const options = queryOptions(query);
	const exact = /^ucsc_conservation(?::|\s|$)/i.test(query);
	const limit = exact ? boundedOptionNumber(options, ["max_values", "max"], safeLimit(params.limit)) : safeLimit(params.limit);
	const track = options.track ?? "phyloP100way";
	const { chrom, end, genome, partial, payload, rows, start, url } = await fetchTrackRows(options, track, 1000);
	if (partial || payload.maxItemsLimit) throw new Error("UCSC conservation query was truncated; query a smaller region.");
	let covered = 0;
	let total = 0;
	let min: number | undefined;
	let max: number | undefined;
	const values = rows.map((item) => recordValue(item)).flatMap((row) => {
		const start = numberValue(row.start);
		const end = numberValue(row.end);
		const value = numberValue(row.value);
		if (start === undefined || end === undefined || value === undefined) return [];
		const span = Math.max(0, end - start);
		covered += span;
		total += value * span;
		min = min === undefined || value < min ? value : min;
		max = max === undefined || value > max ? value : max;
		return [{ start, end, value }];
	});
	const spanBp = end - start;
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "ucsc",
		query,
		mode: "conservation",
		searchMode: exact ? "ucsc-conservation" : undefined,
		genome,
		track,
		chrom,
		start,
		end,
		trackType: stringValue(payload.trackType),
		itemsReturned: numberValue(payload.itemsReturned) ?? rows.length,
		truncated: false,
		spanBp,
		span_bp: spanBp,
		basesCovered: covered,
		n_bases_covered: covered,
		coverageFraction: spanBp > 0 ? Number((covered / spanBp).toFixed(6)) : 0,
		coverage_fraction: spanBp > 0 ? Number((covered / spanBp).toFixed(6)) : 0,
		mean: covered ? Number((total / covered).toFixed(6)) : undefined,
		min,
		max,
		values: exact && (booleanValue(options.include_values) ?? false) ? values.slice(0, limit) : undefined,
		results: values.slice(0, limit),
		returned: Math.min(values.length, limit),
		totalCount: values.length,
		url: browserUrl(genome, chrom, start, end),
		provenance: { docs: UCSC_DOCS, endpoints: [url.toString()] },
	};
}

async function tfbsClusters(params: SearchParams): Promise<Record<string, unknown>> {
	const query = cleanQuery(params.query);
	const options = queryOptions(query);
	const genome = genomeFrom(options);
	const track = TFBS_TRACKS[genome];
	if (!track) throw new Error(`UCSC TFBS clusters support ${Object.keys(TFBS_TRACKS).join(", ")}.`);
	const result = await getTrackData(params, "tfbs-clusters", track);
	const clusters = arrayValue(result.results)
		.map((item) => {
			const row = recordValue(item);
			return {
				name: stringValue(row.name),
				chrom: stringValue(row.chrom),
				chromStart: numberValue(row.chromStart),
				chromEnd: numberValue(row.chromEnd),
				score: numberValue(row.score),
				sourceCount: numberValue(row.sourceCount),
			};
		})
		.sort((a, b) => (a.chromStart ?? 0) - (b.chromStart ?? 0) || String(a.name).localeCompare(String(b.name)));
	return {
		...result,
		searchMode: /^ucsc_tfbs_clusters(?::|\s|$)/i.test(query) ? "ucsc-tfbs-clusters" : result.searchMode,
		track,
		results: clusters,
		clusters,
		returned: clusters.length,
		totalCount: clusters.length,
		items_returned: result.itemsReturned,
		n_factors: [...new Set(clusters.map((item) => item.name).filter((value): value is string => Boolean(value)))].length,
		factors: [...new Set(clusters.map((item) => item.name).filter((value): value is string => Boolean(value)))],
	};
}

export async function searchUcsc(params: SearchParams): Promise<Record<string, unknown>> {
	const query = cleanQuery(params.query);
	if (/^(genomes|assemblies)(?::|\s|$)/i.test(query)) return searchGenomes(params);
	if (/^(search|track-search)(?::|\s)/i.test(query)) return searchTrackDb(params);
	if (/^(tracks|list-tracks|ucsc_list_tracks)(?::|\s|$)/i.test(query)) return listTracks(params);
	if (/^(chroms|chromosomes|ucsc_chrom_sizes)(?::|\s|$)/i.test(query)) return chromSizes(params);
	if (/^(conservation|ucsc_conservation)(?:\s|:|$)/i.test(query)) return conservation(params);
	if (/^(tfbs|ucsc_tfbs_clusters)(?:\s|:|$)/i.test(query)) return tfbsClusters(params);
	if (/^(track|data|ucsc_track_data)(?::|\s)/i.test(query)) return getTrackData(params);
	throw new Error("UCSC search supports genomes, search:<term>, tracks:<genome> <filter>, chroms:<genome>, track:<name> genome=hg38 chrom=chr17 start=... end=..., conservation ..., or tfbs ... queries.");
}
