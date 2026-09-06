const MAX_EXACT_RECORDS = 500;
const REQUEST_TIMEOUT_MS = 25_000;
const OPENALEX_BASE = "https://api.openalex.org";
const OPEN_ABSTRACT_LICENSES = new Set(["cc-by", "cc-by-sa", "cc0", "public-domain"]);

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

function booleanValue(value: string | undefined): boolean | undefined {
	if (value === undefined) return undefined;
	if (/^(true|1|yes)$/i.test(value)) return true;
	if (/^(false|0|no)$/i.test(value)) return false;
	return undefined;
}

function safeExactLimit(value: number | undefined, fallback = 50): number {
	if (!Number.isFinite(value) || value === undefined) return fallback;
	return Math.max(1, Math.min(Math.floor(value), MAX_EXACT_RECORDS));
}

function openAlexDocs(): string[] {
	return [
		"https://developers.openalex.org/api-reference/introduction",
		"https://developers.openalex.org/api-reference/authentication",
		"https://developers.openalex.org/api-reference/works",
		"https://developers.openalex.org/api-entities/works/work-object",
	];
}

function endpointPath(path: string): URL {
	return new URL(`${OPENALEX_BASE}${path.startsWith("/") ? path : `/${path}`}`);
}

function openAlexApiKey(): string | undefined {
	return process.env.OPENALEX_API_KEY?.trim() || undefined;
}

function addAuth(url: URL): { credentialStatus: string; usingApiKey: boolean } {
	const key = openAlexApiKey();
	if (key) {
		url.searchParams.set("api_key", key);
		return { credentialStatus: "OPENALEX_API_KEY present", usingApiKey: true };
	}
	return { credentialStatus: "OPENALEX_API_KEY missing; OpenAlex anonymous/demo budget may reject or throttle requests", usingApiKey: false };
}

function scrubOpenAlexEndpoint(url: URL): string {
	const clean = new URL(url.toString());
	if (clean.searchParams.has("api_key")) clean.searchParams.set("api_key", "[redacted]");
	return clean.toString();
}

function scrubOpenAlexText(text: string, url: URL): string {
	const key = url.searchParams.get("api_key");
	if (!key || key.length < 6) return text;
	let scrubbed = text;
	for (const form of [key, encodeURIComponent(key), encodeURIComponent(encodeURIComponent(key))]) {
		scrubbed = scrubbed.split(form).join("[redacted]");
	}
	return scrubbed;
}

async function fetchJson(url: URL): Promise<{ credentialStatus: string; endpoint: string; payload: unknown; usingApiKey: boolean }> {
	const auth = addAuth(url);
	const endpoint = scrubOpenAlexEndpoint(url);
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
			const snippet = scrubOpenAlexText((await response.text()).slice(0, 4096), url).slice(0, 240);
			throw new Error(`OpenAlex request failed: ${response.status} ${response.statusText}. ${snippet}`);
		}
		return { ...auth, endpoint, payload: await response.json() };
	} finally {
		clearTimeout(timeout);
	}
}

function shortOpenAlexId(value: unknown): string | undefined {
	const raw = stringValue(value);
	if (!raw) return undefined;
	return raw.split("/").pop() || raw;
}

function doiValue(value: unknown): string | undefined {
	const raw = stringValue(value);
	if (!raw) return undefined;
	return raw.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "");
}

function externalId(value: unknown): string | undefined {
	const raw = stringValue(value);
	if (!raw) return undefined;
	return raw.split("/").pop() || raw;
}

function reconstructAbstract(index: unknown): string | undefined {
	const inverted = recordValue(index);
	const positions: Array<{ position: number; word: string }> = [];
	for (const [word, rawPositions] of Object.entries(inverted)) {
		for (const position of arrayValue(rawPositions)) {
			const numeric = numberValue(position);
			if (numeric !== undefined) positions.push({ position: numeric, word });
		}
	}
	if (!positions.length) return undefined;
	return positions.sort((a, b) => a.position - b.position).map((item) => item.word).join(" ");
}

function workLicense(work: Record<string, unknown>): string | undefined {
	for (const locationKey of ["primary_location", "best_oa_location"]) {
		const raw = stringValue(recordValue(work[locationKey]).license);
		if (raw) return raw.split("/").pop()?.toLowerCase() || raw.toLowerCase();
	}
	return undefined;
}

function normalizeAuthorship(value: unknown): Record<string, unknown> {
	const authorship = recordValue(value);
	const author = recordValue(authorship.author);
	return {
		authorId: shortOpenAlexId(author.id),
		name: stringValue(author.display_name),
		orcid: stringValue(author.orcid),
		position: stringValue(authorship.author_position),
		isCorresponding: authorship.is_corresponding === true,
		institutions: arrayValue(authorship.institutions).map((item) => stringValue(recordValue(item).display_name)).filter(Boolean).slice(0, 6),
	};
}

function normalizeOpenAlexWork(work: Record<string, unknown>, includeAbstract: boolean): Record<string, unknown> {
	const id = shortOpenAlexId(work.id);
	const ids = recordValue(work.ids);
	const primary = recordValue(work.primary_location);
	const bestOa = recordValue(work.best_oa_location);
	const source = recordValue(primary.source);
	const openAccess = recordValue(work.open_access);
	const topic = recordValue(work.primary_topic);
	const license = workLicense(work);
	const abstract = includeAbstract && license && OPEN_ABSTRACT_LICENSES.has(license)
		? reconstructAbstract(work.abstract_inverted_index)
		: undefined;
	return {
		openalexId: id,
		url: id ? `https://openalex.org/${id}` : stringValue(work.id),
		doi: doiValue(work.doi ?? ids.doi),
		pmid: externalId(ids.pmid),
		pmcid: externalId(ids.pmcid),
		title: stringValue(work.title) ?? stringValue(work.display_name),
		publicationYear: numberValue(work.publication_year),
		publicationDate: stringValue(work.publication_date),
		type: stringValue(work.type),
		language: stringValue(work.language),
		isRetracted: work.is_retracted === true,
		authors: arrayValue(work.authorships).map(normalizeAuthorship).slice(0, 12),
		source: source.id || source.display_name ? {
			sourceId: shortOpenAlexId(source.id),
			displayName: stringValue(source.display_name),
			issnL: stringValue(source.issn_l),
			type: stringValue(source.type),
		} : undefined,
		biblio: recordValue(work.biblio),
		citedByCount: numberValue(work.cited_by_count),
		fwci: numberValue(work.fwci),
		referencedWorksCount: numberValue(work.referenced_works_count),
		openAccess: {
			isOpenAccess: openAccess.is_oa === true,
			status: stringValue(openAccess.oa_status),
			url: stringValue(openAccess.oa_url),
		},
		bestOaPdfUrl: stringValue(bestOa.pdf_url),
		primaryTopic: stringValue(topic.display_name),
		keywords: arrayValue(work.keywords).map((item) => stringValue(recordValue(item).display_name)).filter(Boolean).slice(0, 8),
		abstract,
		abstractLicense: license,
		abstractPolicy: includeAbstract && !abstract ? "Abstract omitted unless OpenAlex exposes a declared open license and an inverted index." : undefined,
	};
}

function exactAuthorship(value: unknown): Record<string, unknown> {
	const normalized = normalizeAuthorship(value);
	return {
		author_id: normalized.authorId,
		name: normalized.name,
		orcid: normalized.orcid,
		position: normalized.position,
		is_corresponding: normalized.isCorresponding,
		institutions: normalized.institutions,
	};
}

function exactOpenAlexWork(work: Record<string, unknown>, includeAbstract: boolean): Record<string, unknown> {
	const normalized = normalizeOpenAlexWork(work, includeAbstract);
	const source = recordValue(normalized.source);
	const openAccess = recordValue(normalized.openAccess);
	return {
		openalex_id: normalized.openalexId,
		url: normalized.url,
		doi: normalized.doi,
		pmid: normalized.pmid,
		pmcid: normalized.pmcid,
		title: normalized.title,
		publication_year: normalized.publicationYear,
		publication_date: normalized.publicationDate,
		type: normalized.type,
		language: normalized.language,
		is_retracted: normalized.isRetracted,
		authors: arrayValue(work.authorships).map(exactAuthorship).slice(0, 12),
		source: source.sourceId || source.displayName ? {
			source_id: source.sourceId,
			display_name: source.displayName,
			issn_l: source.issnL,
			type: source.type,
		} : undefined,
		biblio: normalized.biblio,
		cited_by_count: normalized.citedByCount,
		fwci: normalized.fwci,
		referenced_works_count: normalized.referencedWorksCount,
		open_access: {
			is_oa: openAccess.isOpenAccess,
			oa_status: openAccess.status,
			oa_url: openAccess.url,
		},
		best_oa_pdf_url: normalized.bestOaPdfUrl,
		primary_topic: normalized.primaryTopic,
		keywords: normalized.keywords,
		abstract: normalized.abstract,
		abstract_license: normalized.abstractLicense,
		abstract_policy: normalized.abstractPolicy,
	};
}

function normalizeAuthor(author: Record<string, unknown>): Record<string, unknown> {
	const id = shortOpenAlexId(author.id);
	const summaryStats = recordValue(author.summary_stats);
	return {
		authorId: id,
		url: id ? `https://openalex.org/${id}` : stringValue(author.id),
		name: stringValue(author.display_name),
		orcid: stringValue(author.orcid),
		worksCount: numberValue(author.works_count),
		citedByCount: numberValue(author.cited_by_count),
		hIndex: numberValue(summaryStats.h_index),
		i10Index: numberValue(summaryStats.i10_index),
		lastKnownInstitutions: arrayValue(author.last_known_institutions).map((item) => stringValue(recordValue(item).display_name)).filter(Boolean).slice(0, 6),
		topics: arrayValue(author.topics).map((item) => stringValue(recordValue(item).display_name)).filter(Boolean).slice(0, 8),
	};
}

function exactAuthor(author: Record<string, unknown>): Record<string, unknown> {
	const normalized = normalizeAuthor(author);
	return {
		author_id: normalized.authorId,
		url: normalized.url,
		name: normalized.name,
		orcid: normalized.orcid,
		works_count: normalized.worksCount,
		cited_by_count: normalized.citedByCount,
		h_index: normalized.hIndex,
		i10_index: normalized.i10Index,
		last_known_institutions: normalized.lastKnownInstitutions,
		top_topics: normalized.topics,
	};
}

function normalizeSource(source: Record<string, unknown>): Record<string, unknown> {
	const id = shortOpenAlexId(source.id);
	const summaryStats = recordValue(source.summary_stats);
	return {
		sourceId: id,
		url: id ? `https://openalex.org/${id}` : stringValue(source.id),
		displayName: stringValue(source.display_name),
		issnL: stringValue(source.issn_l),
		issn: arrayValue(source.issn).map(String).filter(Boolean),
		type: stringValue(source.type),
		worksCount: numberValue(source.works_count),
		citedByCount: numberValue(source.cited_by_count),
		hIndex: numberValue(summaryStats.h_index),
		i10Index: numberValue(summaryStats.i10_index),
		isOa: source.is_oa === true,
		homepageUrl: stringValue(source.homepage_url),
	};
}

function exactSource(source: Record<string, unknown>): Record<string, unknown> {
	const normalized = normalizeSource(source);
	return {
		source_id: normalized.sourceId,
		url: normalized.url,
		display_name: normalized.displayName,
		issn_l: normalized.issnL,
		issn: normalized.issn,
		type: normalized.type,
		works_count: normalized.worksCount,
		cited_by_count: normalized.citedByCount,
		h_index: normalized.hIndex,
		i10_index: normalized.i10Index,
		is_oa: normalized.isOa,
		homepage_url: normalized.homepageUrl,
		counts_by_year: arrayValue(source.counts_by_year).slice(0, 12),
	};
}

function parseKeyValueQuery(query: string): { flags: Record<string, string>; text: string } {
	const flags: Record<string, string> = {};
	const textParts: string[] = [];
	for (const part of query.match(/(?:[^\s"]+|"[^"]*")+/g) ?? []) {
		const match = part.match(/^([a-z_]+)=(.+)$/i);
		if (match?.[1] && match[2] !== undefined) flags[match[1].toLowerCase()] = match[2].replace(/^"|"$/g, "");
		else textParts.push(part);
	}
	return { flags, text: textParts.join(" ").replace(/^"|"$/g, "").trim() };
}

function normalizeWorkId(value: string): string {
	const clean = value.trim();
	const openAlexUrl = clean.match(/^https?:\/\/openalex\.org\/(W\d+)$/i);
	if (openAlexUrl?.[1]) return openAlexUrl[1].toUpperCase();
	const doiUrl = clean.match(/^https?:\/\/(?:dx\.)?doi\.org\/(10\..+)$/i);
	if (doiUrl?.[1]) return `doi:${doiUrl[1]}`;
	if (/^doi:\s*10\./i.test(clean)) return `doi:${clean.replace(/^doi:\s*/i, "")}`;
	if (/^10\..+\/.+/.test(clean)) return `doi:${clean}`;
	if (/^W\d+$/i.test(clean)) return clean.toUpperCase();
	return clean;
}

function normalizeEntityId(value: string, prefix: "A" | "S"): string {
	const clean = value.trim();
	const openAlexUrl = clean.match(new RegExp(`^https?://openalex\\.org/(${prefix}\\d+)$`, "i"));
	if (openAlexUrl?.[1]) return openAlexUrl[1].toUpperCase();
	if (new RegExp(`^${prefix}\\d+$`, "i").test(clean)) return clean.toUpperCase();
	if (prefix === "S" && /^(?:issn:)?\d{4}-\d{3}[\dXx]$/.test(clean)) return clean.replace(/^issn:/i, "").toUpperCase();
	return clean;
}

function exactCommand(query: string): { name: string; rest: string } | undefined {
	const match = query.trim().match(/^(openalex_(?:search_works|get_work|citations|references|search_authors|get_author|venue_info))(?::|\s+)?(.*)$/i);
	if (!match?.[1]) return undefined;
	return { name: match[1].toLowerCase(), rest: (match[2] ?? "").trim() };
}

function exactSearchSort(value: string | undefined, hasSearch: boolean): string | undefined {
	if (value === "cited_by_count") return "cited_by_count:desc";
	if (value === "publication_date" || value === "pub_date") return "publication_date:desc";
	if (value === "relevance" && hasSearch) return "relevance_score:desc";
	return undefined;
}

function exactOpenAlexOutput(payload: Record<string, unknown>, mode: string, query: string, endpoints: string[], credentialStatus: string): Record<string, unknown> {
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "openalex",
		query,
		mode,
		credentialStatus,
		provenance: { docs: openAlexDocs(), endpoints },
		...payload,
	};
}

function doiClaimants(results: unknown[]): Array<Record<string, unknown>> {
	return results.map((item) => {
		const work = recordValue(item);
		return {
			openalexId: shortOpenAlexId(work.id),
			title: stringValue(work.title) ?? stringValue(work.display_name),
			publicationYear: numberValue(work.publication_year),
			citedByCount: numberValue(work.cited_by_count),
		};
	});
}

async function resolveDoiWork(doiWorkId: string): Promise<{
	claimants: Array<Record<string, unknown>>;
	credentialStatus: string;
	endpoints: string[];
	payload: Record<string, unknown>;
	resolutionNote?: string;
	workId: string;
}> {
	const doi = doiWorkId.replace(/^doi:/i, "");
	const url = endpointPath("/works");
	url.searchParams.set("filter", `doi:${doi}`);
	url.searchParams.set("sort", "cited_by_count:desc");
	url.searchParams.set("per-page", "20");
	const result = await fetchJson(url);
	const rows = arrayValue(recordValue(result.payload).results)
		.map(recordValue)
		.sort((a, b) => (numberValue(b.cited_by_count) ?? 0) - (numberValue(a.cited_by_count) ?? 0));
	if (!rows.length) throw new Error(`OpenAlex has no work for doi:${doi}`);
	const claimants = doiClaimants(rows);
	const workId = shortOpenAlexId(rows[0]?.id) ?? doiWorkId;
	return {
		claimants,
		credentialStatus: result.credentialStatus,
		endpoints: [result.endpoint],
		payload: rows[0] ?? {},
		resolutionNote: claimants.length > 1
			? `${claimants.length} OpenAlex works claim doi:${doi}; selected the most-cited claimant ${workId}.`
			: undefined,
		workId,
	};
}

async function fetchWorkById(workId: string): Promise<{
	credentialStatus: string;
	endpoints: string[];
	payload: Record<string, unknown>;
	resolutionNote?: string;
	claimants?: Array<Record<string, unknown>>;
	workId: string;
}> {
	const id = normalizeWorkId(workId);
	if (/^doi:10\./i.test(id)) {
		const resolved = await resolveDoiWork(id);
		return {
			credentialStatus: resolved.credentialStatus,
			endpoints: resolved.endpoints,
			payload: resolved.payload,
			resolutionNote: resolved.resolutionNote,
			claimants: resolved.claimants,
			workId: resolved.workId,
		};
	}
	const result = await fetchJson(endpointPath(`/works/${encodeURIComponent(id)}`));
	const payload = recordValue(result.payload);
	return {
		credentialStatus: result.credentialStatus,
		endpoints: [result.endpoint],
		payload,
		workId: shortOpenAlexId(payload.id) ?? id,
	};
}

async function exactWorkSearch(query: string, commandQuery: string): Promise<Record<string, unknown>> {
	const parsed = parseKeyValueQuery(commandQuery);
	const maxRecords = safeExactLimit(numberValue(parsed.flags.max_records), 50);
	const url = endpointPath("/works");
	if (parsed.text) url.searchParams.set("search", parsed.text);
	const filters: string[] = [];
	if (parsed.flags.year_from && parsed.flags.year_to) filters.push(`publication_year:${parsed.flags.year_from}-${parsed.flags.year_to}`);
	else if (parsed.flags.year_from) filters.push(`publication_year:>${Number(parsed.flags.year_from) - 1}`);
	else if (parsed.flags.year_to) filters.push(`publication_year:<${Number(parsed.flags.year_to) + 1}`);
	if (parsed.flags.work_type) filters.push(`type:${parsed.flags.work_type}`);
	if (booleanValue(parsed.flags.open_access_only) === true) filters.push("open_access.is_oa:true");
	if (parsed.flags.venue) filters.push(`primary_location.source.id:${normalizeEntityId(parsed.flags.venue, "S")}`);
	if (!parsed.text && !filters.length) throw new Error("openalex_search_works requires a query, venue, year, type, or open-access filter.");
	if (filters.length) url.searchParams.set("filter", filters.join(","));
	const sort = exactSearchSort(parsed.flags.sort ?? "relevance", Boolean(parsed.text));
	if (sort) url.searchParams.set("sort", sort);
	url.searchParams.set("per-page", String(Math.min(maxRecords, 200)));
	const result = await fetchJson(url);
	const payload = recordValue(result.payload);
	const rows = arrayValue(payload.results)
		.slice(0, maxRecords)
		.map((item) => exactOpenAlexWork(recordValue(item), booleanValue(parsed.flags.include_abstracts) === true));
	const total = numberValue(recordValue(payload.meta).count) ?? rows.length;
	return exactOpenAlexOutput({
		search: parsed.text,
		filters: {
			year_from: parsed.flags.year_from,
			year_to: parsed.flags.year_to,
			work_type: parsed.flags.work_type,
			open_access_only: booleanValue(parsed.flags.open_access_only) === true,
			venue: parsed.flags.venue,
		},
		sort: parsed.flags.sort ?? "relevance",
		api_total: total,
		n_records_returned: rows.length,
		records_truncated: total > rows.length,
		records: rows,
		results: rows,
	}, "openalex_search_works", query, [result.endpoint], result.credentialStatus);
}

async function exactGetWork(query: string, workId: string): Promise<Record<string, unknown>> {
	const resolved = await fetchWorkById(workId);
	const record = {
		...exactOpenAlexWork(resolved.payload, true),
		abstract: reconstructAbstract(resolved.payload.abstract_inverted_index),
		referenced_works: arrayValue(resolved.payload.referenced_works).map(shortOpenAlexId).filter(Boolean),
		counts_by_year: arrayValue(resolved.payload.counts_by_year).slice(0, 12),
	};
	return exactOpenAlexOutput({
		work_id: resolved.workId,
		doi_claimants: resolved.claimants && resolved.claimants.length > 1 ? resolved.claimants : undefined,
		doi_resolution_note: resolved.resolutionNote,
		...record,
		results: [record],
	}, "openalex_get_work", query, resolved.endpoints, resolved.credentialStatus);
}

async function exactCitations(query: string, commandQuery: string): Promise<Record<string, unknown>> {
	const parsed = parseKeyValueQuery(commandQuery);
	const workInput = parsed.text;
	if (!workInput) throw new Error("openalex_citations requires an OpenAlex work id or DOI.");
	const resolved = await fetchWorkById(workInput);
	const maxRecords = safeExactLimit(numberValue(parsed.flags.max_records), 50);
	const url = endpointPath("/works");
	url.searchParams.set("filter", `cites:${resolved.workId}`);
	const sort = exactSearchSort(parsed.flags.sort ?? "cited_by_count", false);
	if (sort) url.searchParams.set("sort", sort);
	url.searchParams.set("per-page", String(Math.min(maxRecords, 200)));
	const result = await fetchJson(url);
	const payload = recordValue(result.payload);
	const rows = arrayValue(payload.results).slice(0, maxRecords)
		.map((item) => exactOpenAlexWork(recordValue(item), booleanValue(parsed.flags.include_abstracts) === true));
	const total = numberValue(recordValue(payload.meta).count) ?? rows.length;
	return exactOpenAlexOutput({
		work_id: resolved.workId,
		doi_claimants: resolved.claimants && resolved.claimants.length > 1 ? resolved.claimants : undefined,
		doi_resolution_note: resolved.resolutionNote,
		api_total: total,
		n_records_returned: rows.length,
		records_truncated: total > rows.length,
		records: rows,
		results: rows,
	}, "openalex_citations", query, [...resolved.endpoints, result.endpoint], result.credentialStatus);
}

async function exactReferences(query: string, commandQuery: string): Promise<Record<string, unknown>> {
	const parsed = parseKeyValueQuery(commandQuery);
	if (!parsed.text) throw new Error("openalex_references requires an OpenAlex work id or DOI.");
	const resolved = await fetchWorkById(parsed.text);
	const maxRecords = safeExactLimit(numberValue(parsed.flags.max_records), 100);
	const referenceIds = arrayValue(resolved.payload.referenced_works).map(shortOpenAlexId).filter((id): id is string => Boolean(id));
	const selected = referenceIds.slice(0, maxRecords);
	const endpoints = [...resolved.endpoints];
	let credentialStatus = resolved.credentialStatus;
	let rows: Record<string, unknown>[] = [];
	if (selected.length) {
		const hydrateUrl = endpointPath("/works");
		hydrateUrl.searchParams.set("filter", `openalex:${selected.join("|")}`);
		hydrateUrl.searchParams.set("per-page", String(Math.min(selected.length, 200)));
		const hydrated = await fetchJson(hydrateUrl);
		endpoints.push(hydrated.endpoint);
		credentialStatus = hydrated.credentialStatus;
		const order = new Map(selected.map((id, index) => [id, index]));
		rows = arrayValue(recordValue(hydrated.payload).results)
			.map((item) => exactOpenAlexWork(recordValue(item), false))
			.sort((a, b) => (order.get(String(a.openalex_id)) ?? 999) - (order.get(String(b.openalex_id)) ?? 999));
	}
	const got = new Set(rows.map((row) => String(row.openalex_id)));
	return exactOpenAlexOutput({
		work_id: resolved.workId,
		doi_claimants: resolved.claimants && resolved.claimants.length > 1 ? resolved.claimants : undefined,
		doi_resolution_note: resolved.resolutionNote,
		n_references: referenceIds.length,
		n_records_returned: rows.length,
		records_truncated: referenceIds.length > selected.length,
		references_not_hydrated: selected.filter((id) => !got.has(id)),
		reference_ids: referenceIds,
		records: rows,
		results: rows,
	}, "openalex_references", query, endpoints, credentialStatus);
}

async function exactSearchAuthors(query: string, commandQuery: string): Promise<Record<string, unknown>> {
	const parsed = parseKeyValueQuery(commandQuery);
	if (!parsed.text) throw new Error("openalex_search_authors requires a name query.");
	const maxRecords = safeExactLimit(numberValue(parsed.flags.max_records), 25);
	const url = endpointPath("/authors");
	url.searchParams.set("search", parsed.text);
	url.searchParams.set("per-page", String(Math.min(maxRecords, 200)));
	const result = await fetchJson(url);
	const payload = recordValue(result.payload);
	const rows = arrayValue(payload.results).slice(0, maxRecords).map((item) => exactAuthor(recordValue(item)));
	const total = numberValue(recordValue(payload.meta).count) ?? rows.length;
	return exactOpenAlexOutput({
		search: parsed.text,
		api_total: total,
		n_records_returned: rows.length,
		records_truncated: total > rows.length,
		records: rows,
		results: rows,
	}, "openalex_search_authors", query, [result.endpoint], result.credentialStatus);
}

async function exactGetAuthor(query: string, commandQuery: string): Promise<Record<string, unknown>> {
	const parsed = parseKeyValueQuery(commandQuery);
	const id = normalizeEntityId(parsed.text, "A");
	if (!id) throw new Error("openalex_get_author requires an author id or ORCID.");
	const worksSample = safeExactLimit(numberValue(parsed.flags.works_sample), 10);
	const authorUrl = endpointPath(`/authors/${encodeURIComponent(id)}`);
	const result = await fetchJson(authorUrl);
	const rawAuthor = recordValue(result.payload);
	const authorId = shortOpenAlexId(rawAuthor.id) ?? id;
	const worksUrl = endpointPath("/works");
	worksUrl.searchParams.set("filter", `author.id:${authorId}`);
	worksUrl.searchParams.set("sort", "cited_by_count:desc");
	worksUrl.searchParams.set("per-page", String(Math.min(worksSample, 200)));
	const works = await fetchJson(worksUrl);
	const workRows = arrayValue(recordValue(works.payload).results).map((item) => exactOpenAlexWork(recordValue(item), false));
	return exactOpenAlexOutput({
		...exactAuthor(rawAuthor),
		counts_by_year: arrayValue(rawAuthor.counts_by_year).slice(0, 12),
		top_works_total: numberValue(recordValue(recordValue(works.payload).meta).count) ?? workRows.length,
		top_works: workRows,
		results: [{ ...exactAuthor(rawAuthor), top_works: workRows }],
	}, "openalex_get_author", query, [result.endpoint, works.endpoint], works.credentialStatus);
}

async function exactVenueInfo(query: string, commandQuery: string): Promise<Record<string, unknown>> {
	const parsed = parseKeyValueQuery(commandQuery);
	const venue = parsed.text;
	if (!venue) throw new Error("openalex_venue_info requires a source id, ISSN, or venue name.");
	if (/^S\d+$/i.test(venue) || /^https?:\/\/openalex\.org\/S\d+$/i.test(venue) || /^(?:issn:)?\d{4}-\d{3}[\dXx]$/.test(venue)) {
		const id = normalizeEntityId(venue, "S");
		const url = endpointPath(`/sources/${encodeURIComponent(id)}`);
		const result = await fetchJson(url);
		const row = exactSource(recordValue(result.payload));
		return exactOpenAlexOutput({
			...row,
			n_records_returned: 1,
			records: [row],
			results: [row],
		}, "openalex_venue_info", query, [result.endpoint], result.credentialStatus);
	}
	const maxRecords = safeExactLimit(numberValue(parsed.flags.max_records), 10);
	const url = endpointPath("/sources");
	url.searchParams.set("search", venue);
	url.searchParams.set("per-page", String(Math.min(maxRecords, 200)));
	const result = await fetchJson(url);
	const payload = recordValue(result.payload);
	const rows = arrayValue(payload.results).slice(0, maxRecords).map((item) => exactSource(recordValue(item)));
	const total = numberValue(recordValue(payload.meta).count) ?? rows.length;
	return exactOpenAlexOutput({
		search: venue,
		api_total: total,
		n_records_returned: rows.length,
		records_truncated: total > rows.length,
		records: rows,
		results: rows,
	}, "openalex_venue_info", query, [result.endpoint], result.credentialStatus);
}

export async function searchExactOpenAlex(query: string): Promise<Record<string, unknown> | undefined> {
	const command = exactCommand(query);
	if (!command) return undefined;
	if (command.name === "openalex_search_works") return exactWorkSearch(query, command.rest);
	if (command.name === "openalex_get_work") return exactGetWork(query, command.rest);
	if (command.name === "openalex_citations") return exactCitations(query, command.rest);
	if (command.name === "openalex_references") return exactReferences(query, command.rest);
	if (command.name === "openalex_search_authors") return exactSearchAuthors(query, command.rest);
	if (command.name === "openalex_get_author") return exactGetAuthor(query, command.rest);
	if (command.name === "openalex_venue_info") return exactVenueInfo(query, command.rest);
	return undefined;
}
