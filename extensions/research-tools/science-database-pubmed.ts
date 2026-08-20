import { copyrightFromPubmedXml, parseFullTextXml, parsePubmedArticles } from "./science-database-pubmed-parsers.js";
import { withNcbiRateLimit } from "./ncbi-rate-limit.js";

export type PubMedSearchParams = {
	limit?: number;
	query: string;
	sort?: "pub_date" | "relevance";
};

const NCBI_EUTILS_BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
const PMC_IDCONV_URL = "https://pmc.ncbi.nlm.nih.gov/tools/idconv/api/v1/articles/";
const NCBI_EUTILS_DOCS = "https://www.ncbi.nlm.nih.gov/books/NBK25499/";
const PMC_IDCONV_DOCS = "https://pmc.ncbi.nlm.nih.gov/tools/id-converter-api/";
const EUROPE_PMC_DOCS = "https://europepmc.org/RestfulWebService";
const EUROPE_PMC_REST_BASE = "https://www.ebi.ac.uk/europepmc/webservices/rest";
const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;
const REQUEST_TIMEOUT_MS = 25_000;

type QueryOptions = Record<string, string>;
type CitationInput = {
	author?: string;
	first_page?: string;
	journal?: string;
	key?: string;
	volume?: string;
	year?: string;
};

function recordValue(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function listValue(value: unknown): unknown[] {
	if (value === undefined || value === null) return [];
	return Array.isArray(value) ? value : [value];
}

function stringValue(value: unknown): string | undefined {
	if (typeof value === "string" && value.trim()) return value.trim();
	if (typeof value === "number" && Number.isFinite(value)) return String(value);
	return undefined;
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
	if (!clean) throw new Error("PubMed search requires a non-empty query.");
	return clean;
}

function ncbiIdentityParams(): Record<string, string> {
	const email = process.env.NCBI_EMAIL?.trim();
	const apiKey = process.env.NCBI_API_KEY?.trim();
	return {
		tool: "feynman",
		...(email ? { email } : {}),
		...(apiKey ? { api_key: apiKey } : {}),
	};
}

// The PMC ID Converter is a separate service that documents no api_key support,
// so it gets identity params without the key.
function pmcIdentityParams(): Record<string, string> {
	const email = process.env.NCBI_EMAIL?.trim();
	return {
		tool: "feynman",
		...(email ? { email } : {}),
	};
}

function scrubEndpoint(endpoint: string): string {
	const url = new URL(endpoint);
	if (url.searchParams.has("api_key")) url.searchParams.set("api_key", "[redacted]");
	return url.toString();
}

function prune<T extends Record<string, unknown>>(record: T): Record<string, unknown> {
	return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));
}

// The abort timer stays armed across the body read: fetch resolves on headers,
// so clearing it earlier would leave a stalled body hanging forever.
async function send<T>(url: URL, accept: string, read: (response: Response) => Promise<T>): Promise<T> {
	return withNcbiRateLimit(url, async () => {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
		try {
			const response = await fetch(url, {
				headers: {
					accept,
					"user-agent": "feynman-pubmed-tools/1.0 (https://github.com/companion-ai/feynman)",
				},
				signal: controller.signal,
			});
			return await read(response);
		} finally {
			clearTimeout(timeout);
		}
	});
}

function assertOk(response: Response): void {
	if (!response.ok) throw new Error(`PubMed request failed: ${response.status} ${response.statusText}`);
}

async function fetchJson(url: URL): Promise<Record<string, unknown>> {
	return send(url, "application/json", async (response) => {
		assertOk(response);
		return recordValue(await response.json());
	});
}

async function fetchText(url: URL, accept = "application/xml,text/xml,text/plain,*/*"): Promise<string> {
	return send(url, accept, async (response) => {
		assertOk(response);
		return response.text();
	});
}

async function fetchOptionalText(url: URL, accept = "application/xml,text/xml,*/*"): Promise<{ status: number; text?: string }> {
	return send(url, accept, async (response) => {
		if (response.status === 404) return { status: 404 };
		assertOk(response);
		return { status: response.status, text: await response.text() };
	});
}

function queryOptions(query: string): QueryOptions {
	const options: QueryOptions = {};
	const pattern = /(?:^|\s)([a-zA-Z_][\w-]*)=(?:"([^"]*)"|'([^']*)'|([^\s;]+))/g;
	for (const match of query.matchAll(pattern)) {
		options[match[1]!.toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? "";
	}
	return options;
}

function removeOptions(query: string): string {
	return query.replace(/(?:^|\s)[a-zA-Z_][\w-]*=(?:"[^"]*"|'[^']*'|[^\s;]+)/g, " ").replace(/\s+/g, " ").trim();
}

function stripMode(query: string, modes: string[]): string {
	const clean = query.trim();
	for (const mode of modes) {
		const pattern = new RegExp(`^${mode}(?::|\\s+)\\s*`, "i");
		if (pattern.test(clean)) return clean.replace(pattern, "").trim();
	}
	return clean;
}

function splitIds(value: string | undefined): string[] {
	if (!value) return [];
	return value
		.split(/[\s,;]+/)
		.map((id) => id.trim())
		.filter(Boolean);
}

function parseIdList(query: string, modes: string[], optionKeys: string[] = ["ids", "pmids", "pmcids"]): string[] {
	const body = stripMode(query, modes);
	const options = queryOptions(body);
	const ids = optionKeys.flatMap((key) => splitIds(options[key]));
	const rest = splitIds(removeOptions(body));
	const combined = [...ids, ...rest];
	const seen = new Set<string>();
	return combined.filter((id) => {
		const key = id.toLowerCase();
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

function normalizePmcid(value: string): string {
	const clean = value.trim().replace(/^pmcid\s*:/i, "");
	if (/^\d+$/.test(clean)) return `PMC${clean}`;
	if (/^PMC\d+$/i.test(clean)) return clean.toUpperCase();
	return clean.toUpperCase();
}

function parseMode(query: string): string {
	const clean = query.trim();
	if (/^(?:convert|ids?)(?::|\s+)/i.test(clean)) return "id-conversion";
	if (/^(?:metadata|article|get|pmid)(?::|\s+)/i.test(clean)) return "metadata";
	if (/^\d+(?:[\s,;]+\d+)*$/.test(clean)) return "metadata";
	if (/^(?:related|links?)(?::|\s+)/i.test(clean)) return "related";
	if (/^(?:fulltext|full-text|pmc)(?::|\s+)/i.test(clean) || /^PMC\d+$/i.test(clean)) return "fulltext";
	if (/^(?:copyright|license)(?::|\s+)/i.test(clean)) return "copyright";
	if (/^(?:citation|citmatch)(?::|\s+)/i.test(clean)) return "citation-lookup";
	return "search";
}

function articleId(doc: Record<string, unknown>, idType: string): string | undefined {
	for (const item of listValue(doc.articleids)) {
		const record = recordValue(item);
		if (stringValue(record.idtype)?.toLowerCase() === idType) return stringValue(record.value);
	}
	return undefined;
}

function authorNames(value: unknown): string[] {
	return listValue(value)
		.map((author) => stringValue(recordValue(author).name))
		.filter((name): name is string => Boolean(name))
		.slice(0, 8);
}

async function searchArticles(params: PubMedSearchParams, rawQuery?: string): Promise<Record<string, unknown>> {
	const query = cleanQuery(rawQuery ?? params.query);
	const options = queryOptions(query);
	const searchTerm = removeOptions(stripMode(query, ["search"])) || query;
	const limit = safeLimit(params.limit ?? numberValue(options.max_results) ?? numberValue(options.max));
	const retstart = Math.max(0, Math.floor(numberValue(options.retstart) ?? 0));
	const searchUrl = new URL(`${NCBI_EUTILS_BASE}/esearch.fcgi`);
	searchUrl.search = new URLSearchParams({
		db: "pubmed",
		retmode: "json",
		retmax: String(limit),
		retstart: String(retstart),
		sort: options.sort ?? params.sort ?? "relevance",
		term: searchTerm,
		...(options.date_from || options.date_to ? { datetype: options.datetype ?? "pdat" } : {}),
		...(options.date_from ? { mindate: options.date_from } : {}),
		...(options.date_to ? { maxdate: options.date_to } : {}),
		...ncbiIdentityParams(),
	}).toString();
	const search = await fetchJson(searchUrl);
	const esearch = recordValue(search.esearchresult);
	const ids = listValue(esearch.idlist)
		.map((id) => stringValue(id))
		.filter((id): id is string => Boolean(id));
	const endpoints = [scrubEndpoint(searchUrl.toString())];
	if (!ids.length) {
		return {
			schema: "feynman.scienceDatabaseSearch.v1",
			source: "pubmed",
			mode: "search",
			query: searchTerm,
			totalCount: numberValue(esearch.count) ?? 0,
			returned: 0,
			queryTranslation: stringValue(esearch.querytranslation),
			hasMore: false,
			results: [],
			provenance: { docs: NCBI_EUTILS_DOCS, endpoints },
		};
	}
	const summaryUrl = new URL(`${NCBI_EUTILS_BASE}/esummary.fcgi`);
	summaryUrl.search = new URLSearchParams({
		db: "pubmed",
		id: ids.join(","),
		retmode: "json",
		...ncbiIdentityParams(),
	}).toString();
	endpoints.push(scrubEndpoint(summaryUrl.toString()));
	const summary = await fetchJson(summaryUrl);
	const result = recordValue(summary.result);
	const results = ids.flatMap((id) => {
		const doc = recordValue(result[id]);
		if (!Object.keys(doc).length) return [];
		const doi = articleId(doc, "doi");
		return [prune({
			pmid: id,
			title: stringValue(doc.title),
			journal: stringValue(doc.fulljournalname) ?? stringValue(doc.source),
			publicationDate: stringValue(doc.pubdate) ?? stringValue(doc.epubdate),
			authors: authorNames(doc.authors),
			doi,
			publicationTypes: listValue(doc.pubtype).map((item) => stringValue(item)).filter(Boolean),
			url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
			doiUrl: doi ? `https://doi.org/${doi}` : undefined,
		})];
	});
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "pubmed",
		mode: "search",
		query: searchTerm,
		totalCount: numberValue(esearch.count) ?? results.length,
		returned: results.length,
		retstart,
		queryTranslation: stringValue(esearch.querytranslation),
		hasMore: retstart + results.length < (numberValue(esearch.count) ?? results.length),
		results,
		provenance: { docs: NCBI_EUTILS_DOCS, endpoints },
	};
}

async function fetchArticleMetadata(params: PubMedSearchParams): Promise<Record<string, unknown>> {
	const pmids = parseIdList(params.query, ["metadata", "article", "get", "pmid"], ["pmids", "ids"]);
	if (!pmids.length) throw new Error("PubMed metadata lookup requires at least one PMID.");
	const url = new URL(`${NCBI_EUTILS_BASE}/efetch.fcgi`);
	url.search = new URLSearchParams({
		db: "pubmed",
		id: pmids.slice(0, MAX_LIMIT).join(","),
		retmode: "xml",
		...ncbiIdentityParams(),
	}).toString();
	const xml = await fetchText(url);
	const results = parsePubmedArticles(xml);
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "pubmed",
		mode: "metadata",
		query: params.query,
		requestedPmids: pmids,
		returned: results.length,
		results,
		importantLegalNotice: "Cite PubMed and returned DOI links when using article metadata in answers.",
		provenance: { docs: NCBI_EUTILS_DOCS, endpoints: [scrubEndpoint(url.toString())] },
	};
}

async function convertArticleIds(params: PubMedSearchParams): Promise<Record<string, unknown>> {
	const options = queryOptions(params.query);
	const ids = parseIdList(params.query, ["convert", "id", "ids"], ["ids"]);
	if (!ids.length) throw new Error("PubMed ID conversion requires ids, for example convert:35486828 id_type=pmid.");
	const idType = (options.id_type ?? options.idtype ?? "pmid").toLowerCase();
	const url = new URL(PMC_IDCONV_URL);
	url.search = new URLSearchParams({
		ids: ids.slice(0, MAX_LIMIT).join(","),
		format: "json",
		idtype: idType,
		...pmcIdentityParams(),
	}).toString();
	const payload = await fetchJson(url);
	const records = listValue(payload.records).map((item) => {
		const record = recordValue(item);
		return prune({
			requestedId: stringValue(record["requested-id"]) ?? stringValue(record.requested_id),
			pmid: stringValue(record.pmid),
			pmcid: stringValue(record.pmcid),
			doi: stringValue(record.doi),
			status: stringValue(record.status),
			error: stringValue(record.errmsg),
			pubmedUrl: stringValue(record.pmid) ? `https://pubmed.ncbi.nlm.nih.gov/${stringValue(record.pmid)}/` : undefined,
			pmcUrl: stringValue(record.pmcid) ? `https://pmc.ncbi.nlm.nih.gov/articles/${stringValue(record.pmcid)}/` : undefined,
			doiUrl: stringValue(record.doi) ? `https://doi.org/${stringValue(record.doi)}` : undefined,
		});
	});
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "pubmed",
		mode: "id-conversion",
		query: params.query,
		idType,
		returned: records.length,
		results: records,
		provenance: { docs: PMC_IDCONV_DOCS, endpoints: [scrubEndpoint(url.toString())] },
	};
}

async function relatedArticles(params: PubMedSearchParams): Promise<Record<string, unknown>> {
	const options = queryOptions(params.query);
	const pmids = parseIdList(params.query, ["related", "link", "links"], ["pmids", "ids"]);
	if (!pmids.length) throw new Error("PubMed related-article lookup requires at least one PMID.");
	const linkType = options.link_type ?? options.linkname ?? "pubmed_pubmed";
	const db = linkType.split("_")[1] || "pubmed";
	const maxResults = Math.max(1, Math.min(Math.floor(numberValue(options.max_results) ?? numberValue(options.max) ?? params.limit ?? DEFAULT_LIMIT), MAX_LIMIT));
	const url = new URL(`${NCBI_EUTILS_BASE}/elink.fcgi`);
	url.search = new URLSearchParams({
		dbfrom: "pubmed",
		db,
		id: pmids.slice(0, MAX_LIMIT).join(","),
		retmode: "json",
		linkname: linkType,
		...ncbiIdentityParams(),
	}).toString();
	const payload = await fetchJson(url);
	const linksets = listValue(payload.linksets).map((item) => {
		const linkset = recordValue(item);
		return {
			dbfrom: stringValue(linkset.dbfrom),
			ids: listValue(linkset.ids).map((id) => stringValue(id)).filter(Boolean),
			linksetdbs: listValue(linkset.linksetdbs).map((dbRecord) => {
				const record = recordValue(dbRecord);
				return {
					dbto: stringValue(record.dbto),
					linkname: stringValue(record.linkname),
					links: listValue(record.links).map((id) => stringValue(id)).filter(Boolean).slice(0, maxResults),
				};
			}),
		};
	});
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "pubmed",
		mode: "related",
		query: params.query,
		linkType,
		requestedPmids: pmids,
		linksets,
		returned: linksets.reduce((sum, linkset) => sum + linkset.linksetdbs.reduce((inner, dbRecord) => inner + dbRecord.links.length, 0), 0),
		provenance: { docs: NCBI_EUTILS_DOCS, endpoints: [scrubEndpoint(url.toString())] },
	};
}

async function fullTextArticles(params: PubMedSearchParams): Promise<Record<string, unknown>> {
	const ids = parseIdList(params.query, ["fulltext", "full-text", "pmc"], ["pmcids", "ids"]);
	if (!ids.length) throw new Error("PubMed full-text lookup requires a PMCID, for example fulltext:PMC5815332.");
	const endpoints: string[] = [];
	const results: Record<string, unknown>[] = [];
	for (const raw of ids.slice(0, Math.min(safeLimit(params.limit), 5))) {
		const pmcid = normalizePmcid(raw);
		const availabilityUrl = new URL(`${EUROPE_PMC_REST_BASE}/search`);
		availabilityUrl.searchParams.set("query", `PMCID:${pmcid}`);
		availabilityUrl.searchParams.set("format", "json");
		availabilityUrl.searchParams.set("resultType", "core");
		availabilityUrl.searchParams.set("pageSize", "1");
		endpoints.push(availabilityUrl.toString());
		const availability = await fetchJson(availabilityUrl);
		const hit = recordValue(listValue(recordValue(availability.resultList).result)[0]);
		const resolvedPmcid = stringValue(hit.pmcid)?.toUpperCase();
		if (resolvedPmcid !== pmcid) {
			results.push({
				inputId: raw,
				pmcid,
				found: false,
				fullTextAvailable: false,
				fullTextStatus: "not_found",
				detail: "PMCID did not resolve via Europe PMC.",
			});
			continue;
		}
		if (String(hit.isOpenAccess ?? "").toUpperCase() !== "Y") {
			results.push(prune({
				inputId: raw,
				pmcid,
				pmid: stringValue(hit.pmid) ?? stringValue(hit.id),
				doi: stringValue(hit.doi),
				title: stringValue(hit.title),
				found: true,
				fullTextAvailable: false,
				fullTextStatus: "not_open_access",
				url: `https://pmc.ncbi.nlm.nih.gov/articles/${pmcid}/`,
			}));
			continue;
		}
		const fullTextUrl = new URL(`${EUROPE_PMC_REST_BASE}/${pmcid}/fullTextXML`);
		endpoints.push(fullTextUrl.toString());
		const fetched = await fetchOptionalText(fullTextUrl);
		if (!fetched.text) {
			results.push(prune({
				inputId: raw,
				pmcid,
				pmid: stringValue(hit.pmid) ?? stringValue(hit.id),
				doi: stringValue(hit.doi),
				title: stringValue(hit.title),
				found: true,
				fullTextAvailable: false,
				fullTextStatus: fetched.status === 404 ? "xml_not_available" : "not_retrieved",
				url: `https://pmc.ncbi.nlm.nih.gov/articles/${pmcid}/`,
			}));
			continue;
		}
		results.push(parseFullTextXml(fetched.text, pmcid, hit));
	}
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "pubmed",
		mode: "fulltext",
		query: params.query,
		delegatedSource: "Europe PMC open-access fullTextXML",
		returned: results.length,
		results,
		importantLegalNotice: "Cite PubMed/PMC and DOI links when using returned full-text section snippets.",
		provenance: { docs: [NCBI_EUTILS_DOCS, EUROPE_PMC_DOCS], endpoints },
	};
}

async function copyrightStatus(params: PubMedSearchParams): Promise<Record<string, unknown>> {
	const pmids = parseIdList(params.query, ["copyright", "license"], ["pmids", "ids"]);
	if (!pmids.length) throw new Error("PubMed copyright lookup requires at least one PMID.");
	const endpoints: string[] = [];
	const idconvUrl = new URL(PMC_IDCONV_URL);
	idconvUrl.search = new URLSearchParams({
		ids: pmids.slice(0, MAX_LIMIT).join(","),
		format: "json",
		idtype: "pmid",
		...pmcIdentityParams(),
	}).toString();
	endpoints.push(scrubEndpoint(idconvUrl.toString()));
	const idconv = await fetchJson(idconvUrl);
	const idMap = new Map<string, Record<string, unknown>>();
	for (const item of listValue(idconv.records)) {
		const record = recordValue(item);
		const pmid = stringValue(record.pmid) ?? stringValue(record["requested-id"]);
		if (pmid) idMap.set(pmid, record);
	}
	const efetchUrl = new URL(`${NCBI_EUTILS_BASE}/efetch.fcgi`);
	efetchUrl.search = new URLSearchParams({
		db: "pubmed",
		id: pmids.slice(0, MAX_LIMIT).join(","),
		retmode: "xml",
		...ncbiIdentityParams(),
	}).toString();
	endpoints.push(scrubEndpoint(efetchUrl.toString()));
	const pubmedXml = await fetchText(efetchUrl);
	const pubmedCopyright = copyrightFromPubmedXml(pubmedXml);
	const results: Record<string, unknown>[] = [];
	for (const pmid of pmids.slice(0, MAX_LIMIT)) {
		const mapped = idMap.get(pmid) ?? {};
		const pmcid = stringValue(mapped.pmcid);
		const doi = stringValue(mapped.doi);
		const pubmed = pubmedCopyright.get(pmid) ?? {};
		let pmcLicense: Record<string, unknown> | undefined;
		let pmcCopyright: Record<string, unknown> | undefined;
		if (pmcid) {
			const fullTextUrl = new URL(`${EUROPE_PMC_REST_BASE}/${pmcid.toUpperCase()}/fullTextXML`);
			endpoints.push(fullTextUrl.toString());
			const fetched = await fetchOptionalText(fullTextUrl);
			if (fetched.text) {
				const full = parseFullTextXml(fetched.text, pmcid.toUpperCase(), { pmid, doi });
				pmcLicense = recordValue(full.license);
				pmcCopyright = recordValue(full.copyright);
			}
		}
		const source = Object.keys(pmcLicense ?? {}).length ? "pmc" : stringValue(pubmed.copyright) ? "pubmed" : "not_available";
		const isOpenAccess = Boolean(recordValue(pmcLicense).isOpenAccess);
		results.push(prune({
			pmid,
			pmcid,
			doi,
			copyright: prune({
				statement: stringValue(pmcCopyright?.statement) ?? stringValue(pubmed.copyright),
				year: numberValue(pmcCopyright?.year),
			}),
			license: prune({
				type: stringValue(pmcLicense?.type),
				url: stringValue(pmcLicense?.url),
				isOpenAccess,
			}),
			source,
			checkedSources: ["pubmed", ...(pmcid ? ["pmc"] : [])],
			availableAt: prune({
				pubmedUrl: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
				pmcUrl: pmcid ? `https://pmc.ncbi.nlm.nih.gov/articles/${pmcid}/` : undefined,
				doiUrl: doi ? `https://doi.org/${doi}` : undefined,
			}),
		}));
	}
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "pubmed",
		mode: "copyright",
		query: params.query,
		returned: results.length,
		results,
		summary: {
			totalChecked: results.length,
			foundInPubmed: results.filter((result) => result.source === "pubmed").length,
			foundInPmc: results.filter((result) => result.source === "pmc").length,
			notFound: results.filter((result) => result.source === "not_available").length,
			openAccessCount: results.filter((result) => recordValue(result.license).isOpenAccess === true).length,
		},
		provenance: { docs: [NCBI_EUTILS_DOCS, PMC_IDCONV_DOCS, EUROPE_PMC_DOCS], endpoints },
	};
}

function parseCitationInputs(query: string): CitationInput[] {
	const body = stripMode(query, ["citation", "citmatch"]);
	const chunks = body.split(/\s*;\s*/).map((chunk) => chunk.trim()).filter(Boolean);
	const citations = chunks.map((chunk, index) => {
		const options = queryOptions(chunk);
		return prune({
			journal: options.journal,
			year: options.year,
			volume: options.volume,
			first_page: options.first_page ?? options.page,
			author: options.author,
			key: options.key ?? `citation-${index + 1}`,
		}) as CitationInput;
	});
	return citations.filter((citation) => citation.journal || citation.year || citation.first_page || citation.author);
}

function citationLine(citation: CitationInput): string {
	return [
		citation.journal ?? "",
		citation.year ?? "",
		citation.volume ?? "",
		citation.first_page ?? "",
		citation.author ?? "",
		citation.key ?? "",
		"",
	].join("|");
}

async function citationLookup(params: PubMedSearchParams): Promise<Record<string, unknown>> {
	const citations = parseCitationInputs(params.query);
	if (!citations.length) {
		throw new Error("PubMed citation lookup requires fields like citation journal=Nature year=2020 volume=580 first_page=123 author=Smith.");
	}
	const url = new URL(`${NCBI_EUTILS_BASE}/ecitmatch.cgi`);
	url.search = new URLSearchParams({
		db: "pubmed",
		retmode: "text",
		bdata: citations.slice(0, MAX_LIMIT).map(citationLine).join("\n"),
		...ncbiIdentityParams(),
	}).toString();
	const text = await fetchText(url, "text/plain,*/*");
	const lines = text.trim().split(/\r?\n/).filter(Boolean);
	const results = citations.map((citation, index) => {
		const parts = (lines[index] ?? "").split("|");
		const pmid = parts[6]?.trim() || undefined;
		return prune({
			...citation,
			pmid,
			status: pmid ? "found" : "not_found",
			pubmedUrl: pmid ? `https://pubmed.ncbi.nlm.nih.gov/${pmid}/` : undefined,
		});
	});
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "pubmed",
		mode: "citation-lookup",
		query: params.query,
		returned: results.length,
		results,
		provenance: { docs: NCBI_EUTILS_DOCS, endpoints: [scrubEndpoint(url.toString())] },
	};
}

export async function searchPubMed(params: PubMedSearchParams): Promise<Record<string, unknown>> {
	const mode = parseMode(params.query);
	if (mode === "metadata") return fetchArticleMetadata(params);
	if (mode === "id-conversion") return convertArticleIds(params);
	if (mode === "related") return relatedArticles(params);
	if (mode === "fulltext") return fullTextArticles(params);
	if (mode === "copyright") return copyrightStatus(params);
	if (mode === "citation-lookup") return citationLookup(params);
	return searchArticles(params);
}
