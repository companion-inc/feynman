import { searchExactOpenAlex } from "./science-database-openalex-exact.js";

export type OpenAlexScienceDatabaseSource = "openalex";

type SearchParams = { limit?: number; query: string; source: OpenAlexScienceDatabaseSource };

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;
const REQUEST_TIMEOUT_MS = 25_000;
const OPENALEX_BASE = "https://api.openalex.org";
const OPEN_ABSTRACT_LICENSES = new Set(["cc-by", "cc-by-sa", "cc0", "public-domain"]);

export function isOpenAlexScienceDatabaseSource(source: string): source is OpenAlexScienceDatabaseSource {
	return source === "openalex";
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

function booleanValue(value: string | undefined): boolean | undefined {
	if (value === undefined) return undefined;
	if (/^(true|1|yes)$/i.test(value)) return true;
	if (/^(false|0|no)$/i.test(value)) return false;
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

function stripModePrefix(query: string, pattern: RegExp): string {
	return query.replace(pattern, "").trim();
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

function sortParam(value: string | undefined, hasSearch: boolean): string | undefined {
	if (value === "cited_by_count") return "cited_by_count:desc";
	if (value === "publication_date" || value === "pub_date") return "publication_date:desc";
	if (value === "relevance" && hasSearch) return "relevance_score:desc";
	return undefined;
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

function withMeta(payload: Record<string, unknown>, mode: string, query: string, endpoints: string[], credentialStatus: string): Record<string, unknown> {
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

export async function searchOpenAlex(params: SearchParams): Promise<Record<string, unknown>> {
	const query = cleanQuery(params.query);
	const limit = safeLimit(params.limit);
	const exact = await searchExactOpenAlex(query);
	if (exact) return exact;
	if (/^rate-limit$/i.test(query)) {
		if (!openAlexApiKey()) {
			return withMeta({
				error: "openalex_key_required",
				message: "Set OPENALEX_API_KEY to check OpenAlex rate-limit and usage status.",
				totalCount: 0,
				returned: 0,
				results: [],
				anonymousBudgetWarning: "OpenAlex rate-limit diagnostics require OPENALEX_API_KEY.",
			}, "rate-limit", query, [], "OPENALEX_API_KEY missing; OpenAlex anonymous/demo budget may reject or throttle requests");
		}
		const url = endpointPath("/rate-limit");
		const result = await fetchJson(url);
		return withMeta({
			totalCount: 1,
			returned: 1,
			results: [recordValue(result.payload)],
		}, "rate-limit", query, [result.endpoint], result.credentialStatus);
	}
	if (/^(?:authors|author-search)(?::|\s+)/i.test(query)) {
		const term = stripModePrefix(query, /^(?:authors|author-search)(?::|\s+)/i);
		const url = endpointPath("/authors");
		url.searchParams.set("search", term);
		url.searchParams.set("per-page", String(limit));
		const result = await fetchJson(url);
		const payload = recordValue(result.payload);
		const rows = arrayValue(payload.results).map((item) => normalizeAuthor(recordValue(item)));
		return withMeta({
			totalCount: numberValue(recordValue(payload.meta).count) ?? rows.length,
			returned: rows.length,
			results: rows,
		}, "author-search", query, [result.endpoint], result.credentialStatus);
	}
	if (/^author(?::|\s+)/i.test(query)) {
		const rawId = stripModePrefix(query, /^author(?::|\s+)/i);
		const id = normalizeEntityId(rawId, "A");
		const url = endpointPath(`/authors/${encodeURIComponent(id)}`);
		const result = await fetchJson(url);
		return withMeta({
			authorId: id,
			totalCount: 1,
			returned: 1,
			results: [normalizeAuthor(recordValue(result.payload))],
		}, "author-detail", query, [result.endpoint], result.credentialStatus);
	}
	if (/^(?:sources|venues?)(?::|\s+)/i.test(query)) {
		const term = stripModePrefix(query, /^(?:sources|venues?)(?::|\s+)/i);
		const url = endpointPath("/sources");
		url.searchParams.set("search", term);
		url.searchParams.set("per-page", String(limit));
		const result = await fetchJson(url);
		const payload = recordValue(result.payload);
		const rows = arrayValue(payload.results).map((item) => normalizeSource(recordValue(item)));
		return withMeta({
			totalCount: numberValue(recordValue(payload.meta).count) ?? rows.length,
			returned: rows.length,
			results: rows,
		}, "source-search", query, [result.endpoint], result.credentialStatus);
	}
	if (/^source(?::|\s+)/i.test(query)) {
		const rawId = stripModePrefix(query, /^source(?::|\s+)/i);
		const id = normalizeEntityId(rawId, "S");
		const url = endpointPath(`/sources/${encodeURIComponent(id)}`);
		const result = await fetchJson(url);
		return withMeta({
			sourceId: id,
			totalCount: 1,
			returned: 1,
			results: [normalizeSource(recordValue(result.payload))],
		}, "source-detail", query, [result.endpoint], result.credentialStatus);
	}
	if (/^citations?(?::|\s+)/i.test(query)) {
		const inputWorkId = normalizeWorkId(stripModePrefix(query, /^citations?(?::|\s+)/i));
		const resolved = /^doi:10\./i.test(inputWorkId) ? await resolveDoiWork(inputWorkId) : undefined;
		const workId = resolved?.workId ?? inputWorkId;
		const url = endpointPath("/works");
		url.searchParams.set("filter", `cites:${workId}`);
		url.searchParams.set("sort", "cited_by_count:desc");
		url.searchParams.set("per-page", String(limit));
		const result = await fetchJson(url);
		const payload = recordValue(result.payload);
		const rows = arrayValue(payload.results).map((item) => normalizeOpenAlexWork(recordValue(item), false));
		return withMeta({
			workId,
			doiClaimants: resolved && resolved.claimants.length > 1 ? resolved.claimants : undefined,
			doiResolutionNote: resolved?.resolutionNote,
			totalCount: numberValue(recordValue(payload.meta).count) ?? rows.length,
			returned: rows.length,
			recordsTruncated: (numberValue(recordValue(payload.meta).count) ?? rows.length) > rows.length,
			results: rows,
		}, "citations", query, [...(resolved?.endpoints ?? []), result.endpoint], result.credentialStatus);
	}
	if (/^references?(?::|\s+)/i.test(query)) {
		const inputWorkId = normalizeWorkId(stripModePrefix(query, /^references?(?::|\s+)/i));
		const resolved = /^doi:10\./i.test(inputWorkId) ? await resolveDoiWork(inputWorkId) : undefined;
		const workId = resolved?.workId ?? inputWorkId;
		let detail: { credentialStatus: string; endpoint: string; payload: unknown } | undefined;
		if (!resolved) {
			const detailUrl = endpointPath(`/works/${encodeURIComponent(workId)}`);
			detailUrl.searchParams.set("select", "id,referenced_works");
			detail = await fetchJson(detailUrl);
		}
		const referenceIds = arrayValue(recordValue(resolved?.payload ?? detail?.payload).referenced_works)
			.map(shortOpenAlexId)
			.filter((id): id is string => Boolean(id));
		const selected = referenceIds.slice(0, limit);
		const endpoints = [...(resolved?.endpoints ?? []), ...(detail ? [detail.endpoint] : [])];
		let rows: Record<string, unknown>[] = [];
		let credentialStatus = resolved?.credentialStatus ?? detail?.credentialStatus ?? "";
		if (selected.length) {
			const hydrateUrl = endpointPath("/works");
			hydrateUrl.searchParams.set("filter", `openalex:${selected.join("|")}`);
			hydrateUrl.searchParams.set("per-page", String(selected.length));
			const hydrated = await fetchJson(hydrateUrl);
			endpoints.push(hydrated.endpoint);
			credentialStatus = hydrated.credentialStatus;
			const order = new Map(selected.map((id, index) => [id, index]));
			rows = arrayValue(recordValue(hydrated.payload).results)
				.map((item) => normalizeOpenAlexWork(recordValue(item), false))
				.sort((a, b) => (order.get(String(a.openalexId)) ?? 999) - (order.get(String(b.openalexId)) ?? 999));
		}
		const got = new Set(rows.map((row) => String(row.openalexId)));
		return withMeta({
			workId,
			doiClaimants: resolved && resolved.claimants.length > 1 ? resolved.claimants : undefined,
			doiResolutionNote: resolved?.resolutionNote,
			referenceIds,
			referencesNotHydrated: selected.filter((id) => !got.has(id)),
			totalCount: referenceIds.length,
			returned: rows.length,
			recordsTruncated: referenceIds.length > selected.length,
			results: rows,
		}, "references", query, endpoints, credentialStatus);
	}
	const detailMatch = /^(?:work|detail)(?::|\s+)(.+)$/i.exec(query);
	const detailCandidate = normalizeWorkId(detailMatch?.[1] ?? query);
	if (/^(?:W\d+|doi:10\..+|10\..+\/.+)$/i.test(detailCandidate)) {
		const resolved = /^doi:10\./i.test(detailCandidate) ? await resolveDoiWork(detailCandidate) : undefined;
		const result = resolved ? undefined : await fetchJson(endpointPath(`/works/${encodeURIComponent(detailCandidate)}`));
		const payload = recordValue(resolved?.payload ?? result?.payload);
		return withMeta({
			workId: shortOpenAlexId(payload.id) ?? resolved?.workId ?? detailCandidate,
			doiClaimants: resolved && resolved.claimants.length > 1 ? resolved.claimants : undefined,
			doiResolutionNote: resolved?.resolutionNote,
			totalCount: 1,
			returned: 1,
			results: [{
				...normalizeOpenAlexWork(payload, true),
				referencedWorks: arrayValue(payload.referenced_works).map(shortOpenAlexId).filter(Boolean),
				countsByYear: arrayValue(payload.counts_by_year).slice(0, 12),
			}],
		}, "work-detail", query, resolved?.endpoints ?? (result ? [result.endpoint] : []), resolved?.credentialStatus ?? result?.credentialStatus ?? "");
	}
	const parsed = parseKeyValueQuery(stripModePrefix(query, /^search(?::|\s+)/i));
	const url = endpointPath("/works");
	if (parsed.text) url.searchParams.set("search", parsed.text);
	const filters: string[] = [];
	if (parsed.flags.year_from && parsed.flags.year_to) filters.push(`publication_year:${parsed.flags.year_from}-${parsed.flags.year_to}`);
	else if (parsed.flags.year_from) filters.push(`publication_year:>${Number(parsed.flags.year_from) - 1}`);
	else if (parsed.flags.year_to) filters.push(`publication_year:<${Number(parsed.flags.year_to) + 1}`);
	if (parsed.flags.type) filters.push(`type:${parsed.flags.type}`);
	if (booleanValue(parsed.flags.oa ?? parsed.flags.open_access) === true) filters.push("open_access.is_oa:true");
	if (parsed.flags.source) filters.push(`primary_location.source.id:${normalizeEntityId(parsed.flags.source, "S")}`);
	if (filters.length) url.searchParams.set("filter", filters.join(","));
	const sort = sortParam(parsed.flags.sort ?? "relevance", Boolean(parsed.text));
	if (sort) url.searchParams.set("sort", sort);
	if (!parsed.text && !filters.length) throw new Error("OpenAlex work search requires text or filters.");
	url.searchParams.set("per-page", String(limit));
	const result = await fetchJson(url);
	const payload = recordValue(result.payload);
	const rows = arrayValue(payload.results).map((item) => normalizeOpenAlexWork(recordValue(item), booleanValue(parsed.flags.abstracts) === true));
	return withMeta({
		search: parsed.text,
		filters,
		sort: parsed.flags.sort ?? "relevance",
		totalCount: numberValue(recordValue(payload.meta).count) ?? rows.length,
		returned: rows.length,
		recordsTruncated: (numberValue(recordValue(payload.meta).count) ?? rows.length) > rows.length,
		anonymousBudgetWarning: openAlexApiKey() ? undefined : "Set OPENALEX_API_KEY for real OpenAlex usage; anonymous/demo calls are limited by OpenAlex.",
		results: rows,
	}, "work-search", query, [result.endpoint], result.credentialStatus);
}
