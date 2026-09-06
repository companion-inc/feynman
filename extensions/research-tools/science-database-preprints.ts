type PreprintServer = "biorxiv" | "medrxiv";

type SearchParams = {
	limit?: number;
	query: string;
	source: string;
};

const PREPRINT_API_BASE = "https://api.biorxiv.org";
const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;
const REQUEST_TIMEOUT_MS = 25_000;
const DEFAULT_WINDOW_DAYS = 60;
const RECENT_COUNT_WINDOW_DAYS = 90;

const BIORXIV_CATEGORIES = [
	"animal behavior and cognition",
	"biochemistry",
	"bioengineering",
	"bioinformatics",
	"biophysics",
	"cancer biology",
	"cell biology",
	"clinical trials",
	"developmental biology",
	"ecology",
	"epidemiology",
	"evolutionary biology",
	"genetics",
	"genomics",
	"immunology",
	"microbiology",
	"molecular biology",
	"neuroscience",
	"paleontology",
	"pathology",
	"pharmacology and toxicology",
	"physiology",
	"plant biology",
	"scientific communication and education",
	"synthetic biology",
	"systems biology",
	"zoology",
] as const;

type QueryOptions = {
	category?: string;
	cursor: number;
	dateFrom?: string;
	dateTo?: string;
	funderRorId?: string;
	interval: "m" | "y";
	publisher?: string;
	recentCount?: number;
	recentDays?: number;
	searchText?: string;
	through?: string;
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

function cleanQuery(query: string): string {
	const clean = query.trim();
	if (!clean) throw new Error("Science database search requires a non-empty query.");
	return clean;
}

function safeLimit(value: number | undefined): number {
	if (!Number.isFinite(value) || value === undefined) return DEFAULT_LIMIT;
	return Math.max(1, Math.min(Math.floor(value), MAX_LIMIT));
}

function doiUrl(doi: string | undefined): string | undefined {
	return doi ? `https://doi.org/${doi}` : undefined;
}

function preprintDocs(): string[] {
	return [
		"https://api.biorxiv.org/",
		"https://api.biorxiv.org/pubs/help",
		"https://api.biorxiv.org/funder/help",
	];
}

function preprintEndpoint(path: string): URL {
	return new URL(`${PREPRINT_API_BASE}${path}`);
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
		if (!response.ok) {
			throw new Error(`Preprint database request failed: ${response.status} ${response.statusText}`);
		}
		return response.json();
	} finally {
		clearTimeout(timeout);
	}
}

function normalizePreprintDoi(query: string): string | undefined {
	const clean = query.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").replace(/^doi:\s*/i, "");
	return /^10\.\d{4,9}\/\S+$/i.test(clean) ? clean : undefined;
}

function isDate(value: string | undefined): value is string {
	return value !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function recentDateRange(days: number): { end: string; start: string } {
	const endDate = new Date();
	const startDate = new Date(endDate);
	startDate.setUTCDate(endDate.getUTCDate() - days);
	return {
		end: endDate.toISOString().slice(0, 10),
		start: startDate.toISOString().slice(0, 10),
	};
}

function optionValue(query: string, key: string): string | undefined {
	const pattern = new RegExp(`(?:^|[\\s;])${key}=("[^"]+"|'[^']+'|[^\\s;]+)`, "i");
	const match = pattern.exec(query);
	const raw = match?.[1]?.trim();
	if (!raw) return undefined;
	return raw.replace(/^["']|["']$/g, "");
}

function parseNumberOption(query: string, key: string): number | undefined {
	const raw = optionValue(query, key);
	if (!raw) return undefined;
	const value = Number(raw);
	return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : undefined;
}

function parseDateWindow(query: string): { dateFrom?: string; dateTo?: string } {
	const explicitFrom = optionValue(query, "date_from") ?? optionValue(query, "from");
	const explicitTo = optionValue(query, "date_to") ?? optionValue(query, "to");
	if (isDate(explicitFrom) && isDate(explicitTo)) {
		return { dateFrom: explicitFrom, dateTo: explicitTo };
	}
	const range = /(\d{4}-\d{2}-\d{2})\s*(?:\.\.|\/|:)\s*(\d{4}-\d{2}-\d{2})/.exec(query);
	if (range) return { dateFrom: range[1], dateTo: range[2] };
	return {};
}

function parseQueryOptions(query: string): QueryOptions {
	const { dateFrom, dateTo } = parseDateWindow(query);
	const intervalRaw = (optionValue(query, "interval") ?? "").toLowerCase();
	const category = optionValue(query, "category");
	const searchText = query
		.replace(/\b(?:date_from|date_to|from|to|category|cursor|recent_days|recent_count|interval|through|publisher|funder|ror)=("[^"]+"|'[^']+'|[^\s;]+)/gi, "")
		.replace(/\d{4}-\d{2}-\d{2}\s*(?:\.\.|\/|:)\s*\d{4}-\d{2}-\d{2}/g, "")
		.replace(/^(?:published|pubs|funder|ror|content-stats|content statistics|stats:content|usage-stats|usage statistics|stats:usage|categories)\s*:?\s*/i, "")
		.trim();
	return {
		category,
		cursor: parseNumberOption(query, "cursor") ?? 0,
		dateFrom,
		dateTo,
		funderRorId: optionValue(query, "funder") ?? optionValue(query, "ror"),
		interval: intervalRaw === "yearly" || intervalRaw === "y" ? "y" : "m",
		publisher: optionValue(query, "publisher"),
		recentCount: parseNumberOption(query, "recent_count"),
		recentDays: parseNumberOption(query, "recent_days"),
		searchText,
		through: optionValue(query, "through"),
	};
}

function resolveWindow(options: QueryOptions): { dateFrom: string; dateTo: string; recentCount?: number } {
	if (options.dateFrom && options.dateTo) return { dateFrom: options.dateFrom, dateTo: options.dateTo };
	if (options.recentDays !== undefined) {
		const range = recentDateRange(options.recentDays);
		return { dateFrom: range.start, dateTo: range.end };
	}
	if (options.recentCount !== undefined) {
		const range = recentDateRange(RECENT_COUNT_WINDOW_DAYS);
		return { dateFrom: range.start, dateTo: range.end, recentCount: options.recentCount };
	}
	const range = recentDateRange(DEFAULT_WINDOW_DAYS);
	return { dateFrom: range.start, dateTo: range.end };
}

function messageValue(payload: Record<string, unknown>): Record<string, unknown> {
	const messages = payload.messages;
	if (Array.isArray(messages)) return recordValue(messages[0]);
	return recordValue(messages);
}

function totalFromMessage(message: Record<string, unknown>, fallback: number): number {
	return numberValue(message.total) ?? numberValue(message.count) ?? fallback;
}

function categorySuffix(category: string | undefined): string {
	return category ? `?category=${encodeURIComponent(category.trim().toLowerCase().replace(/\s+/g, "_"))}` : "";
}

function preprintUrl(server: PreprintServer, doi: string | undefined, options: QueryOptions): URL {
	if (doi) return preprintEndpoint(`/details/${server}/${doi}/na/json`);
	const range = resolveWindow(options);
	return preprintEndpoint(`/details/${server}/${range.dateFrom}/${range.dateTo}/${options.cursor}/json${categorySuffix(options.category)}`);
}

function preprintHost(server: PreprintServer): string {
	return server === "medrxiv" ? "www.medrxiv.org" : "www.biorxiv.org";
}

function normalizePreprintRecord(item: unknown, server: PreprintServer): Record<string, unknown> | undefined {
	const record = recordValue(item);
	const doi = stringValue(record.doi);
	const version = stringValue(record.version);
	if (!doi) return undefined;
	return {
		doi,
		title: stringValue(record.title),
		authors: stringValue(record.authors),
		correspondingAuthor: stringValue(record.author_corresponding),
		correspondingInstitution: stringValue(record.author_corresponding_institution),
		date: stringValue(record.date),
		version,
		type: stringValue(record.type),
		license: stringValue(record.license),
		category: stringValue(record.category),
		abstract: stringValue(record.abstract),
		funding: arrayValue(record.funding),
		jatsXmlPath: stringValue(record["jats xml path"]),
		published: stringValue(record.published),
		server: stringValue(record.server) ?? server,
		url: `https://${preprintHost(server)}/content/${doi}${version ? `v${version}` : ""}`,
		doiUrl: doiUrl(doi),
	};
}

function normalizePublishedRecord(item: unknown): Record<string, unknown> {
	const record = recordValue(item);
	const biorxivDoi = stringValue(record.biorxiv_doi);
	const publishedDoi = stringValue(record.published_doi);
	return {
		preprintDoi: biorxivDoi,
		publishedDoi,
		publishedJournal: stringValue(record.published_journal),
		preprintPlatform: stringValue(record.preprint_platform),
		preprintTitle: stringValue(record.preprint_title),
		preprintAuthors: stringValue(record.preprint_authors),
		preprintCategory: stringValue(record.preprint_category),
		preprintDate: stringValue(record.preprint_date),
		publishedDate: stringValue(record.published_date),
		preprintAbstract: stringValue(record.preprint_abstract),
		correspondingAuthor: stringValue(record.preprint_author_corresponding),
		correspondingInstitution: stringValue(record.preprint_author_corresponding_institution),
		preprintDoiUrl: doiUrl(biorxivDoi),
		publishedDoiUrl: doiUrl(publishedDoi),
	};
}

function filterBySearchText(records: Array<Record<string, unknown>>, searchText: string | undefined, doiMode: boolean): Array<Record<string, unknown>> {
	if (doiMode || !searchText) return records;
	const queryLower = searchText.toLowerCase();
	return records.filter((record) => [record.title, record.abstract, record.authors, record.category, record.doi]
		.some((value) => String(value ?? "").toLowerCase().includes(queryLower)));
}

async function fetchPreprintCollection(server: PreprintServer, doi: string | undefined, options: QueryOptions): Promise<{ collection: unknown[]; endpoint: string; total: number }> {
	let url = preprintUrl(server, doi, options);
	if (!doi && options.recentCount !== undefined) {
		const range = resolveWindow(options);
		const firstUrl = preprintEndpoint(`/details/${server}/${range.dateFrom}/${range.dateTo}/0/json${categorySuffix(options.category)}`);
		const firstPayload = recordValue(await fetchJson(firstUrl));
		const firstCollection = arrayValue(firstPayload.collection);
		const total = totalFromMessage(messageValue(firstPayload), firstCollection.length);
		const cursor = Math.max(total - options.recentCount, 0) + options.cursor;
		url = preprintEndpoint(`/details/${server}/${range.dateFrom}/${range.dateTo}/${cursor}/json${categorySuffix(options.category)}`);
	}
	const payload = recordValue(await fetchJson(url));
	const collection = arrayValue(payload.collection);
	return {
		collection,
		endpoint: url.toString(),
		total: totalFromMessage(messageValue(payload), collection.length),
	};
}

function normalizeRorId(query: string, options: QueryOptions): string {
	const source = (options.funderRorId ?? options.searchText ?? query).trim();
	const raw = (source.split("/").pop() ?? source).toLowerCase();
	const clean = raw.replace(/^funder:\s*/i, "").replace(/^ror:\s*/i, "");
	if (!/^[0-9a-z]{9}$/.test(clean)) {
		throw new Error(`Funder lookup requires a 9-character ROR ID, got ${raw || query}.`);
	}
	return clean;
}

async function searchFunderPreprints(params: SearchParams, server: PreprintServer, query: string, options: QueryOptions): Promise<Record<string, unknown>> {
	const limit = safeLimit(params.limit);
	const range = resolveWindow(options);
	const rorId = normalizeRorId(query, options);
	const url = preprintEndpoint(`/funder/${server}/${range.dateFrom}/${range.dateTo}/${rorId}/${options.cursor}/json${categorySuffix(options.category)}`);
	const payload = recordValue(await fetchJson(url));
	const collection = arrayValue(payload.collection);
	const results = collection.flatMap((item) => {
		const normalized = normalizePreprintRecord(item, server);
		return normalized ? [normalized] : [];
	}).slice(0, limit);
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: server,
		query,
		searchMode: "funder-ror",
		rorId,
		cursor: options.cursor,
		totalCount: totalFromMessage(messageValue(payload), collection.length),
		returned: results.length,
		results,
		provenance: {
			docs: preprintDocs(),
			endpoints: [url.toString()],
		},
	};
}

async function searchPublishedPreprints(params: SearchParams, server: PreprintServer, query: string, options: QueryOptions): Promise<Record<string, unknown>> {
	const limit = safeLimit(params.limit);
	const range = resolveWindow(options);
	let url: URL;
	if (options.publisher) {
		if (server !== "biorxiv") throw new Error("Publisher-prefix published-preprint lookup is bioRxiv-only.");
		if (!/^10\.\d{4,9}$/.test(options.publisher)) throw new Error(`Publisher prefix must look like 10.1038, got ${options.publisher}.`);
		url = preprintEndpoint(`/publisher/${options.publisher}/${range.dateFrom}/${range.dateTo}/${options.cursor}`);
	} else {
		url = preprintEndpoint(`/pubs/${server}/${range.dateFrom}/${range.dateTo}/${options.cursor}/json`);
	}
	const payload = recordValue(await fetchJson(url));
	const collection = arrayValue(payload.collection);
	const results = collection.map(normalizePublishedRecord).slice(0, limit);
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: server,
		query,
		searchMode: "published-preprints",
		cursor: options.cursor,
		totalCount: totalFromMessage(messageValue(payload), collection.length),
		returned: results.length,
		results,
		provenance: {
			docs: preprintDocs(),
			endpoints: [url.toString()],
		},
	};
}

function keepStatsRow(row: Record<string, unknown>, through: string | undefined): boolean {
	if (!through) return true;
	const month = stringValue(row.month);
	if (month) return month.slice(0, 7) <= through.slice(0, 7);
	const year = numberValue(row.year);
	const throughYear = Number(through.slice(0, 4));
	return year === undefined || !Number.isFinite(throughYear) || year <= throughYear;
}

async function preprintStats(server: PreprintServer, query: string, options: QueryOptions, mode: "content-statistics" | "usage-statistics"): Promise<Record<string, unknown>> {
	if (mode === "content-statistics" && server !== "biorxiv") {
		throw new Error("bioRxiv content summary statistics are available from source=biorxiv; use usage-stats for server-specific bioRxiv/medRxiv usage statistics.");
	}
	const endpointPath = mode === "content-statistics"
		? `/sum/${options.interval}/json`
		: `/usage/${options.interval}/${server}/json`;
	const url = preprintEndpoint(endpointPath);
	const payload = recordValue(await fetchJson(url));
	const rowsKey = Object.keys(payload).find((key) => key !== "messages");
	const rows = arrayValue(rowsKey ? payload[rowsKey] : []).map(recordValue).filter((row) => keepStatsRow(row, options.through));
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: server,
		query,
		searchMode: mode,
		interval: options.interval === "y" ? "yearly" : "monthly",
		through: options.through,
		returned: rows.length,
		results: rows,
		provenance: {
			docs: preprintDocs(),
			endpoints: [url.toString()],
		},
	};
}

export async function searchPreprints(params: SearchParams, server: PreprintServer): Promise<Record<string, unknown>> {
	const query = cleanQuery(params.query);
	const options = parseQueryOptions(query);
	if (/^categories$/i.test(query)) {
		return {
			schema: "feynman.scienceDatabaseSearch.v1",
			source: server,
			query,
			searchMode: "categories",
			returned: BIORXIV_CATEGORIES.length,
			results: [...BIORXIV_CATEGORIES],
			provenance: {
				docs: preprintDocs(),
				note: "bioRxiv subject category list mirrored as Feynman-owned connector metadata.",
			},
		};
	}
	if (/^(content-stats|content statistics|stats:content)\b/i.test(query)) {
		return preprintStats(server, query, options, "content-statistics");
	}
	if (/^(usage-stats|usage statistics|stats:usage)\b/i.test(query)) {
		return preprintStats(server, query, options, "usage-statistics");
	}
	if (/^(published|pubs)\b/i.test(query) || options.publisher) {
		return searchPublishedPreprints(params, server, query, options);
	}
	if (/^(funder|ror)\b/i.test(query) || options.funderRorId) {
		return searchFunderPreprints(params, server, query, options);
	}

	const limit = safeLimit(params.limit);
	const doi = normalizePreprintDoi(query);
	const fetched = await fetchPreprintCollection(server, doi, options);
	const normalized = fetched.collection.flatMap((item) => {
		const record = normalizePreprintRecord(item, server);
		return record ? [record] : [];
	});
	const results = filterBySearchText(normalized, options.searchText, Boolean(doi)).slice(0, limit);
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: server,
		query,
		searchMode: doi ? "doi" : "recent-60-day-filter",
		cursor: options.cursor,
		totalCount: fetched.total,
		returned: results.length,
		results,
		provenance: {
			docs: preprintDocs(),
			endpoints: [fetched.endpoint],
		},
	};
}
