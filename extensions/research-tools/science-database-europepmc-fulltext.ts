export type EuropePmcFullTextSearchParams = { limit?: number; query: string };

import { XMLParser } from "fast-xml-parser";

const DEFAULT_LIMIT = 2;
const MAX_LIMIT = 5;
const REQUEST_TIMEOUT_MS = 30_000;
const DEADLINE_MS = 40_000;
const EUROPE_PMC_REST_BASE = "https://www.ebi.ac.uk/europepmc/webservices/rest";
const EUROPE_PMC_DOCS = "https://europepmc.org/RestfulWebService";
const SECTION_TEXT_SNIPPET_CHARS = 1_200;
const ABSTRACT_SNIPPET_CHARS = 2_000;
const MAX_SECTIONS_RETURNED = 10;
const MAX_CAPTIONS_RETURNED = 8;
const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);

const xmlParser = new XMLParser({
	ignoreAttributes: false,
	removeNSPrefix: true,
});

type InputId = { inputId: string; type: "pmcid" | "pmid" | "unknown" };

export function isEuropePmcFullTextQuery(query: string): boolean {
	const clean = query.trim();
	if (/^(?:fulltext|full-text|jats|sections)(?::|\s+)/i.test(clean)) return true;
	if (/^PMC\d+$/i.test(clean)) return true;
	if (/^pmcid\s*:\s*(?:PMC)?\d+$/i.test(clean)) return true;
	if (/^pmid\s*:\s*\d+$/i.test(clean)) return true;
	return false;
}

function recordValue(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function arrayValue(value: unknown): unknown[] {
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

function truncateText(value: string | undefined, limit: number): string | undefined {
	if (!value) return undefined;
	const clean = value.replace(/\s+/g, " ").trim();
	return clean.length > limit ? `${clean.slice(0, limit).trimEnd()}...` : clean;
}

function stripPrefix(query: string): string {
	return query.replace(/^(?:fulltext|full-text|jats|sections)(?::|\s+)\s*/i, "").trim();
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

function normalizeInputId(raw: string): InputId | undefined {
	const trimmed = raw.trim();
	if (!trimmed) return undefined;
	try {
		const url = new URL(trimmed);
		const parts = url.pathname.split("/").filter(Boolean);
		if (/^(?:www\.)?ncbi\.nlm\.nih\.gov$/i.test(url.hostname) && parts[0] === "pmc" && parts[1] === "articles" && parts[2]) {
			return normalizeInputId(parts[2]);
		}
		if (/^pmc\.ncbi\.nlm\.nih\.gov$/i.test(url.hostname) && parts[0] === "articles" && parts[1]) {
			return normalizeInputId(parts[1]);
		}
		if (/^(?:www\.)?europepmc\.org$/i.test(url.hostname)) {
			if (parts[0] === "articles" && parts[1]) return normalizeInputId(parts[1]);
			if (parts[0] === "article" && parts[2]) return normalizeInputId(parts[2]);
		}
	} catch {
		// Not a URL; continue with plain ID normalization.
	}
	const clean = raw
		.trim()
		.replace(/^pmcid\s*:\s*/i, "")
		.replace(/^pmid\s*:\s*/i, "")
		.replace(/^https?:\/\/(?:www\.)?ncbi\.nlm\.nih\.gov\/pmc\/articles\//i, "")
		.replace(/^https?:\/\/pmc\.ncbi\.nlm\.nih\.gov\/articles\//i, "")
		.replace(/^https?:\/\/europepmc\.org\/articles\//i, "")
		.replace(/[/?#].*$/, "");
	if (/^PMC\d+$/i.test(clean)) return { inputId: clean.toUpperCase(), type: "pmcid" };
	if (/^\d+$/.test(clean)) return { inputId: clean, type: "pmid" };
	return { inputId: raw.trim(), type: "unknown" };
}

function parseInputIds(query: string, limit: number): InputId[] {
	const raw = stripPrefix(query);
	const options = queryOptions(raw);
	const tokens = [
		options.pmcid,
		options.pmid,
		...removeOptions(raw).split(/[\s,;]+/),
	].filter((value): value is string => Boolean(value));
	const ids: InputId[] = [];
	const seen = new Set<string>();
	for (const token of tokens) {
		const normalized = normalizeInputId(token);
		if (!normalized) continue;
		const key = `${normalized.type}:${normalized.inputId}`;
		if (seen.has(key)) continue;
		seen.add(key);
		ids.push(normalized);
		if (ids.length >= limit) break;
	}
	if (!ids.length) throw new Error("Europe PMC full-text lookup requires PMCID or PMID input, for example fulltext:PMC5815332.");
	return ids;
}

function retryDelayMs(response: Response | undefined, attempt: number): number {
	const retryAfter = response?.headers.get("retry-after");
	const retrySeconds = retryAfter ? Number(retryAfter) : undefined;
	if (retrySeconds && Number.isFinite(retrySeconds)) return Math.min(retrySeconds * 1000, 10_000);
	return Math.min(2 ** attempt * 1000, 10_000);
}

async function fetchWithRetry(url: URL, init: RequestInit): Promise<Response> {
	for (let attempt = 0; attempt <= 1; attempt += 1) {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
		try {
			const response = await fetch(url, { ...init, signal: controller.signal });
			if (attempt < 1 && RETRY_STATUSES.has(response.status)) {
				await new Promise((resolve) => setTimeout(resolve, retryDelayMs(response, attempt + 1)));
				continue;
			}
			return response;
		} catch (error) {
			if (attempt >= 1) throw error;
			await new Promise((resolve) => setTimeout(resolve, retryDelayMs(undefined, attempt + 1)));
		} finally {
			clearTimeout(timeout);
		}
	}
	throw new Error("Europe PMC request failed before a response was available.");
}

async function fetchJson(url: URL): Promise<Record<string, unknown>> {
	const response = await fetchWithRetry(url, {
		headers: {
			accept: "application/json",
			"user-agent": "feynman-science-database-search/1.0 (https://github.com/advaitpaliwal/feynman)",
		},
	});
	if (!response.ok) throw new Error(`Europe PMC request failed: ${response.status} ${response.statusText}`);
	return recordValue(await response.json());
}

async function fetchText(url: URL): Promise<{ status: number; text?: string }> {
	const response = await fetchWithRetry(url, {
		headers: {
			accept: "application/xml,text/xml,*/*",
			"user-agent": "feynman-science-database-search/1.0 (https://github.com/advaitpaliwal/feynman)",
		},
	});
	if (response.status === 404) return { status: 404 };
	if (!response.ok) throw new Error(`Europe PMC fullTextXML request failed: ${response.status} ${response.statusText}`);
	return { status: response.status, text: await response.text() };
}

function flagValue(value: unknown): boolean {
	return String(value ?? "").trim().toUpperCase() === "Y";
}

function articleUrl(source: string | undefined, id: string | undefined, pmcid: string | undefined): string | undefined {
	if (pmcid) return `https://europepmc.org/articles/${encodeURIComponent(pmcid)}`;
	if (source && id) return `https://europepmc.org/article/${encodeURIComponent(source)}/${encodeURIComponent(id)}`;
	return undefined;
}

async function availabilityFor(input: InputId): Promise<{ endpoint: string; record: Record<string, unknown> }> {
	const url = new URL(`${EUROPE_PMC_REST_BASE}/search`);
	url.searchParams.set("query", input.type === "pmid" ? `EXT_ID:${input.inputId} AND SRC:MED` : `PMCID:${input.inputId}`);
	url.searchParams.set("format", "json");
	url.searchParams.set("resultType", "core");
	url.searchParams.set("pageSize", "1");
	const payload = await fetchJson(url);
	const hit = recordValue(arrayValue(recordValue(payload.resultList).result)[0]);
	const pmid = stringValue(hit.pmid) ?? stringValue(hit.id);
	const pmcid = stringValue(hit.pmcid)?.toUpperCase();
	const exact = input.type === "pmid" ? pmid === input.inputId : pmcid === input.inputId;
	if (!exact) {
		return {
			endpoint: url.toString(),
			record: {
				inputId: input.inputId,
				inputIdType: input.type,
				found: false,
				fullTextAvailable: false,
				fullTextStatus: "not_found",
				detail: "ID did not resolve via the Europe PMC search endpoint.",
			},
		};
	}
	const source = stringValue(hit.source);
	const id = stringValue(hit.id);
	return {
		endpoint: url.toString(),
		record: {
			inputId: input.inputId,
			inputIdType: input.type,
			found: true,
			id,
			source,
			pmid,
			pmcid,
			doi: stringValue(hit.doi),
			title: stringValue(hit.title),
			authors: stringValue(hit.authorString),
			journal: stringValue(hit.journalTitle) ?? stringValue(recordValue(recordValue(hit.journalInfo).journal).title),
			publicationYear: numberValue(hit.pubYear),
			isOpenAccess: flagValue(hit.isOpenAccess),
			inEuropePmc: flagValue(hit.inEPMC),
			inPmc: flagValue(hit.inPMC),
			license: stringValue(hit.license),
			citedByCount: numberValue(hit.citedByCount),
			abstract: truncateText(stringValue(hit.abstractText), ABSTRACT_SNIPPET_CHARS),
			url: articleUrl(source, id, pmcid),
		},
	};
}

function nodeText(value: unknown, excludedKeys = new Set<string>()): string {
	if (typeof value === "string" || typeof value === "number") return String(value);
	if (Array.isArray(value)) return value.map((item) => nodeText(item, excludedKeys)).join(" ");
	const record = recordValue(value);
	return Object.entries(record)
		.filter(([key]) => key === "#text" || (!key.startsWith("@_") && key !== "#text"))
		.filter(([key]) => !excludedKeys.has(key))
		.map(([, item]) => nodeText(item, excludedKeys))
		.join(" ")
		.replace(/\s+/g, " ")
		.trim();
}

function findFirst(value: unknown, key: string): unknown {
	const record = recordValue(value);
	if (Object.prototype.hasOwnProperty.call(record, key)) return record[key];
	for (const item of Object.values(record)) {
		if (Array.isArray(item)) {
			for (const child of item) {
				const found = findFirst(child, key);
				if (found !== undefined) return found;
			}
			continue;
		}
		if (item && typeof item === "object") {
			const found = findFirst(item, key);
			if (found !== undefined) return found;
		}
	}
	return undefined;
}

function collectNodes(value: unknown, key: string, out: unknown[] = []): unknown[] {
	const record = recordValue(value);
	for (const [childKey, childValue] of Object.entries(record)) {
		if (childKey === key) out.push(...arrayValue(childValue));
		if (Array.isArray(childValue)) childValue.forEach((item) => collectNodes(item, key, out));
		else if (childValue && typeof childValue === "object") collectNodes(childValue, key, out);
	}
	return out;
}

function countRefs(value: unknown, parentKey?: string): number {
	const record = recordValue(value);
	let total = 0;
	for (const [key, childValue] of Object.entries(record)) {
		if (key === "ref" && parentKey === "ref-list") total += arrayValue(childValue).length;
		for (const child of arrayValue(childValue)) {
			if (child && typeof child === "object") total += countRefs(child, key);
		}
	}
	return total;
}

function classifySection(title: string | undefined, secType: string | undefined): string {
	const byType: Record<string, string> = {
		conclusion: "conclusion",
		conclusions: "conclusion",
		discussion: "discussion",
		intro: "introduction",
		introduction: "introduction",
		methods: "methods",
		results: "results",
	};
	const typeMatch = secType ? byType[secType.trim().toLowerCase()] : undefined;
	if (typeMatch) return typeMatch;
	const normalized = (title ?? "").trim().toLowerCase().replace(/^[0-9ivx]+[.):\s]+/, "");
	if (/^(introduction|background)\b/.test(normalized)) return "introduction";
	if (/^(materials?\s+and\s+methods?|methods?|methodology|experimental procedures?|online methods)\b/.test(normalized)) return "methods";
	if (/^results?\s+and\s+discussion\b/.test(normalized)) return "results_and_discussion";
	if (/^(results?|findings)\b/.test(normalized)) return "results";
	if (/^discussion\b/.test(normalized)) return "discussion";
	if (/^(conclusions?|summary)\b/.test(normalized)) return "conclusion";
	return "other";
}

function parseJats(xml: string): Record<string, unknown> {
	const parsed = recordValue(xmlParser.parse(xml));
	const article = recordValue(parsed.article);
	const body = recordValue(findFirst(article, "body"));
	const sectionNodes = arrayValue(body.sec);
	const sections = sectionNodes.map((section, index) => {
		const record = recordValue(section);
		const title = truncateText(nodeText(record.title), 240);
		const text = nodeText(record, new Set(["fig", "table-wrap", "ref-list"]));
		return {
			index,
			title,
			secType: stringValue(record["@_sec-type"]),
			imrad: classifySection(title, stringValue(record["@_sec-type"])),
			charCount: text.length,
			textSnippet: truncateText(text, SECTION_TEXT_SNIPPET_CHARS),
		};
	});
	const figureCaptions = collectNodes(article, "fig").slice(0, MAX_CAPTIONS_RETURNED).map((node) => {
		const record = recordValue(node);
		return {
			id: stringValue(record["@_id"]),
			label: truncateText(nodeText(record.label), 80),
			caption: truncateText(nodeText(record.caption), 600),
		};
	});
	const tableCaptions = collectNodes(article, "table-wrap").slice(0, MAX_CAPTIONS_RETURNED).map((node) => {
		const record = recordValue(node);
		return {
			id: stringValue(record["@_id"]),
			label: truncateText(nodeText(record.label), 80),
			caption: truncateText(nodeText(record.caption), 600),
		};
	});
	const abstractCandidates = arrayValue(findFirst(article, "abstract"));
	const abstract = truncateText(nodeText(abstractCandidates[0]), ABSTRACT_SNIPPET_CHARS);
	return {
		title: truncateText(nodeText(findFirst(article, "article-title")), 500),
		abstract,
		sectionCount: sections.length,
		sectionInventory: sections.map((section) => ({
			index: section.index,
			title: section.title,
			imrad: section.imrad,
			charCount: section.charCount,
		})),
		sections: sections.slice(0, MAX_SECTIONS_RETURNED),
		figureCaptions,
		tableCaptions,
		nFigures: collectNodes(article, "fig").length,
		nTables: collectNodes(article, "table-wrap").length,
		nReferences: countRefs(article),
	};
}

async function fetchArticle(input: InputId, deadlineMs: number): Promise<{ endpoints: string[]; result: Record<string, unknown> }> {
	if (input.type === "unknown") {
		return {
			endpoints: [],
			result: {
				inputId: input.inputId,
				inputIdType: "unknown",
				found: false,
				fullTextAvailable: false,
				fullTextStatus: "invalid_id",
				detail: "Unrecognized ID format. Expected a PMID, PMCID, or supported PubMed Central/Europe PMC URL.",
			},
		};
	}
	const availability = await availabilityFor(input);
	const result = { ...availability.record };
	const pmcid = stringValue(result.pmcid);
	if (!result.found) return { endpoints: [availability.endpoint], result };
	if (!result.isOpenAccess) {
		return {
			endpoints: [availability.endpoint],
			result: {
				...result,
				fullTextAvailable: false,
				fullTextStatus: "not_open_access",
				detail: "isOpenAccess=N: not in the Europe PMC open-access full-text subset.",
			},
		};
	}
	if (!pmcid) {
		return {
			endpoints: [availability.endpoint],
			result: {
				...result,
				fullTextAvailable: false,
				fullTextStatus: "no_pmcid",
				detail: "No PMCID assigned; fullTextXML requires a PMCID.",
			},
		};
	}
	if (Date.now() >= deadlineMs) {
		return {
			endpoints: [availability.endpoint],
			result: {
				...result,
				fullTextAvailable: false,
				fullTextStatus: "not_processed",
				detail: "Deadline elapsed before fullTextXML fetch; retry with fewer IDs.",
			},
		};
	}
	const xmlUrl = new URL(`${EUROPE_PMC_REST_BASE}/${encodeURIComponent(pmcid)}/fullTextXML`);
	const fetched = await fetchText(xmlUrl);
	if (fetched.status !== 200 || !fetched.text) {
		return {
			endpoints: [availability.endpoint, xmlUrl.toString()],
			result: {
				...result,
				fullTextAvailable: false,
				fullTextStatus: "xml_not_available",
				detail: `fullTextXML returned HTTP ${fetched.status} for ${pmcid}.`,
			},
		};
	}
	const parsed = parseJats(fetched.text);
	return {
		endpoints: [availability.endpoint, xmlUrl.toString()],
		result: {
			...result,
			fullTextAvailable: true,
			fullTextStatus: "retrieved",
			rawXmlBytes: fetched.text.length,
			title: stringValue(parsed.title) ?? result.title,
			abstract: stringValue(parsed.abstract) ?? result.abstract,
			sectionCount: parsed.sectionCount,
			sectionInventory: parsed.sectionInventory,
			sections: parsed.sections,
			figureCaptions: parsed.figureCaptions,
			tableCaptions: parsed.tableCaptions,
			nFigures: parsed.nFigures,
			nTables: parsed.nTables,
			nReferences: parsed.nReferences,
			contentPolicy: "Returned section snippets are bounded; raw fullTextXML is not included in tool output.",
		},
	};
}

export async function searchEuropePmcFullText(params: EuropePmcFullTextSearchParams): Promise<Record<string, unknown>> {
	const query = params.query.trim();
	if (!query) throw new Error("Europe PMC full-text lookup requires a non-empty query.");
	const limit = safeLimit(params.limit);
	const inputs = parseInputIds(query, limit);
	const fetched: Array<{ endpoints: string[]; result: Record<string, unknown> }> = [];
	const deadlineMs = Date.now() + DEADLINE_MS;
	for (const input of inputs) {
		fetched.push(await fetchArticle(input, deadlineMs));
	}
	const results = fetched.map((item) => item.result);
	const endpoints = fetched.flatMap((item) => item.endpoints);
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "europepmc",
		query,
		mode: "fulltext",
		totalCount: results.length,
		returned: results.length,
		results,
		provenance: {
			docs: EUROPE_PMC_DOCS,
			endpoints,
		},
	};
}
