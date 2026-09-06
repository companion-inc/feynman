import { XMLParser } from "fast-xml-parser";

export type BiomartScienceDatabaseSource = "biomart";

type SearchParams = { limit?: number; query: string; source: BiomartScienceDatabaseSource };
type BiomartRoute =
	| { mode: "attributes"; dataset: string; page?: string }
	| { mode: "data"; attributes: string[]; dataset: string; filterName: string; filterValue: string }
	| { mode: "datasets"; mart: string }
	| { mode: "filters"; dataset: string }
	| { mode: "marts" };

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;
const BIOMART_TIMEOUT_MS = 15_000;
const BIOMART_SUCCESS_STAMP = "[success]";
const BIOMART_ENDPOINTS = [
	"https://asia.ensembl.org/biomart/martservice",
	"https://useast.ensembl.org/biomart/martservice",
	"https://www.ensembl.org/biomart/martservice",
];
const DEFAULT_GENE_ATTRIBUTES = [
	"ensembl_gene_id",
	"external_gene_name",
	"description",
	"chromosome_name",
	"start_position",
	"end_position",
	"strand",
	"gene_biotype",
];
const BIOMART_SOURCES = new Set<BiomartScienceDatabaseSource>(["biomart"]);

const xmlParser = new XMLParser({
	ignoreAttributes: false,
	removeNSPrefix: true,
});

export function isBiomartScienceDatabaseSource(source: string): source is BiomartScienceDatabaseSource {
	return BIOMART_SOURCES.has(source as BiomartScienceDatabaseSource);
}

function recordValue(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function arrayValue(value: unknown): unknown[] {
	return Array.isArray(value) ? value : value === undefined ? [] : [value];
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
	if (!clean) throw new Error("BioMart search requires a non-empty query.");
	return clean;
}

function biomartEndpoints(): string[] {
	const configured = process.env.FEYNMAN_BIOMART_ENDPOINTS?.split(",")
		.map((endpoint) => endpoint.trim())
		.filter(Boolean) ?? [];
	return [...new Set([...configured, ...BIOMART_ENDPOINTS])];
}

function validBiomartName(value: string, label: string): string {
	const clean = value.trim();
	if (!/^[A-Za-z0-9_.:-]+$/.test(clean)) {
		throw new Error(`BioMart ${label} must use a stable internal name, not ${JSON.stringify(value)}.`);
	}
	return clean;
}

function looksLikeHtml(text: string): boolean {
	const head = text.trimStart().slice(0, 120).toLowerCase();
	return head.startsWith("<html") || head.startsWith("<!doctype html");
}

async function fetchBiomartText(params: URLSearchParams, init?: RequestInit): Promise<{ endpoint: string; text: string }> {
	const errors: string[] = [];
	for (const endpoint of biomartEndpoints()) {
		const url = new URL(endpoint);
		if (!init?.method || init.method === "GET") {
			for (const [key, value] of params) url.searchParams.set(key, value);
		}
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), BIOMART_TIMEOUT_MS);
		try {
			const response = await fetch(url, {
				...init,
				headers: {
					accept: "text/plain, application/xml, text/xml, */*",
					"user-agent": "feynman-science-database-search/1.0 (https://github.com/advaitpaliwal/feynman)",
					...(init?.headers ?? {}),
				},
				signal: controller.signal,
			});
			const text = await response.text();
			if (response.ok && !looksLikeHtml(text)) return { endpoint: url.toString(), text };
			errors.push(`${endpoint}: ${response.status} ${response.statusText}`);
		} catch (error) {
			errors.push(`${endpoint}: ${error instanceof Error ? error.message : String(error)}`);
		} finally {
			clearTimeout(timeout);
		}
	}
	throw new Error(`BioMart request failed across configured endpoints: ${errors.join("; ")}`);
}

function parseRegistry(xml: string, limit: number): Record<string, unknown>[] {
	const root = recordValue(xmlParser.parse(xml).MartRegistry);
	return arrayValue(root.MartURLLocation)
		.map((item) => recordValue(item))
		.map((mart) => ({
			name: stringValue(mart["@_name"]),
			displayName: stringValue(mart["@_displayName"]),
			database: stringValue(mart["@_database"]),
			virtualSchema: stringValue(mart["@_serverVirtualSchema"]),
			visible: mart["@_visible"] === "1",
			default: mart["@_default"] === "1",
			host: stringValue(mart["@_host"]),
			path: stringValue(mart["@_path"]),
		}))
		.sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? "")))
		.slice(0, limit);
}

function parseDatasets(tsv: string, limit: number): Record<string, unknown>[] {
	return tsv.replace(/\r\n/g, "\n").split("\n")
		.map((line) => line.split("\t"))
		.filter((fields) => fields.length >= 9 && fields[0]?.trim() === "TableSet")
		.map((fields) => ({
			name: stringValue(fields[1]),
			displayName: stringValue(fields[2]),
			visible: fields[3] === "1",
			assembly: stringValue(fields[4]),
			interface: stringValue(fields[7]),
			lastUpdated: stringValue(fields[8]),
		}))
		.sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? "")))
		.slice(0, limit);
}

function parseAttributes(tsv: string, limit: number, page?: string): Record<string, unknown>[] {
	return tsv.replace(/\r\n/g, "\n").split("\n")
		.filter((line) => line.trim())
		.map((line) => line.split("\t"))
		.filter((fields) => fields.length >= 4 && (!page || fields[3] === page))
		.map((fields) => ({
			name: stringValue(fields[0]),
			displayName: stringValue(fields[1]),
			description: stringValue(fields[2]),
			page: stringValue(fields[3]),
			formats: stringValue(fields[4]),
		}))
		.sort((a, b) => `${a.name ?? ""}\t${a.page ?? ""}`.localeCompare(`${b.name ?? ""}\t${b.page ?? ""}`))
		.slice(0, limit);
}

function parseFilters(tsv: string, limit: number): Record<string, unknown>[] {
	return tsv.replace(/\r\n/g, "\n").split("\n")
		.filter((line) => line.trim())
		.map((line) => line.split("\t"))
		.filter((fields) => fields.length >= 7)
		.map((fields) => {
			const options = fields[2]?.trim() ?? "";
			const nOptions = options.startsWith("[") && options.endsWith("]") && options.length > 2
				? options.slice(1, -1).split(",").filter(Boolean).length
				: 0;
			return {
				name: stringValue(fields[0]),
				displayName: stringValue(fields[1]),
				nOptions,
				description: stringValue(fields[3]),
				page: stringValue(fields[4]),
				type: stringValue(fields[5]),
				operator: stringValue(fields[6]),
			};
		})
		.sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? "")))
		.slice(0, limit);
}

function xmlAttribute(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/"/g, "&quot;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

function buildQueryXml(route: Extract<BiomartRoute, { mode: "data" }>): string {
	const filter = `<Filter name="${xmlAttribute(route.filterName)}" value="${xmlAttribute(route.filterValue)}"/>`;
	const attributes = route.attributes.map((attribute) => `<Attribute name="${xmlAttribute(attribute)}"/>`).join("");
	return [
		'<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE Query>',
		'<Query virtualSchemaName="default" formatter="TSV" header="0" uniqueRows="1" datasetConfigVersion="0.6" completionStamp="1">',
		`<Dataset name="${xmlAttribute(route.dataset)}" interface="default">`,
		filter,
		attributes,
		"</Dataset></Query>",
	].join("");
}

function parseDataRows(tsv: string, attributes: string[], limit: number): { rows: Record<string, unknown>[]; totalCount: number } {
	const stripped = tsv.trimEnd();
	if (stripped.startsWith("Query ERROR") || stripped.includes("BioMart::Exception")) {
		throw new Error(`BioMart query failed: ${stripped.slice(0, 500)}`);
	}
	if (!stripped.endsWith(BIOMART_SUCCESS_STAMP)) {
		throw new Error("BioMart response was missing the completion stamp.");
	}
	const body = stripped.slice(0, -BIOMART_SUCCESS_STAMP.length).trimEnd();
	const rows = body ? body.replace(/\r\n/g, "\n").split("\n").filter(Boolean) : [];
	const parsed = rows.map((line) => {
		const fields = line.split("\t");
		return Object.fromEntries(attributes.map((attribute, index) => [attribute, fields[index] ?? ""]));
	});
	return { rows: parsed.slice(0, limit), totalCount: parsed.length };
}

function parseDataQuery(query: string): BiomartRoute {
	const fields: Record<string, string> = Object.fromEntries(query.slice("data:".length).split(";").map((part) => {
		const [key, ...rest] = part.split("=");
		return [key?.trim().toLowerCase() ?? "", rest.join("=").trim()];
	}).filter(([key, value]) => key && value));
	const dataset = validBiomartName(fields.dataset ?? "hsapiens_gene_ensembl", "dataset");
	const filterSpec = fields.filter ?? "";
	const filterMatch = filterSpec.match(/^([A-Za-z0-9_.:-]+)\s*[:=]\s*(.+)$/);
	if (!filterMatch) {
		throw new Error("BioMart data queries require filter=<internal_name>:<value>.");
	}
	const attributes = (fields.attributes ?? fields.attrs ?? DEFAULT_GENE_ATTRIBUTES.join(",")).split(",")
		.map((attribute: string) => validBiomartName(attribute, "attribute"))
		.slice(0, 16);
	if (!attributes.length) throw new Error("BioMart data queries require at least one attribute.");
	return {
		mode: "data",
		dataset,
		filterName: validBiomartName(filterMatch[1]!, "filter"),
		filterValue: filterMatch[2]!.trim(),
		attributes,
	};
}

function biomartRoute(query: string): BiomartRoute {
	const clean = cleanQuery(query);
	const prefixed = clean.match(/^([a-z_-]+)\s*:\s*(.+)$/i);
	const kind = prefixed?.[1]?.toLowerCase();
	const value = prefixed?.[2]?.trim();
	if (/^(marts|list_marts|list:marts)$/i.test(clean)) return { mode: "marts" };
	if (kind === "datasets" || kind === "mart" || kind === "list_datasets") return { mode: "datasets", mart: validBiomartName(value ?? "", "mart") };
	if (kind === "attributes" || kind === "common-attributes") return { mode: "attributes", dataset: validBiomartName(value ?? "", "dataset"), page: "feature_page" };
	if (kind === "all-attributes") return { mode: "attributes", dataset: validBiomartName(value ?? "", "dataset") };
	if (kind === "filters") return { mode: "filters", dataset: validBiomartName(value ?? "", "dataset") };
	if (clean.toLowerCase().startsWith("data:")) return parseDataQuery(clean);
	if (kind === "ensembl" || kind === "gene-id" || /^ENSG\d+(?:\.\d+)?$/i.test(clean)) {
		const geneId = kind ? value ?? "" : clean;
		return { mode: "data", dataset: "hsapiens_gene_ensembl", filterName: "ensembl_gene_id", filterValue: geneId, attributes: DEFAULT_GENE_ATTRIBUTES };
	}
	const symbol = kind === "gene" || kind === "symbol" ? value ?? "" : clean;
	return { mode: "data", dataset: "hsapiens_gene_ensembl", filterName: "external_gene_name", filterValue: symbol, attributes: DEFAULT_GENE_ATTRIBUTES };
}

export async function searchBiomart(params: SearchParams): Promise<Record<string, unknown>> {
	const query = cleanQuery(params.query);
	const limit = safeLimit(params.limit);
	const route = biomartRoute(query);
	const endpoints: string[] = [];
	let results: Record<string, unknown>[] = [];
	let totalCount = 0;
	if (route.mode === "marts") {
		const response = await fetchBiomartText(new URLSearchParams({ type: "registry" }));
		endpoints.push(response.endpoint);
		results = parseRegistry(response.text, limit);
		totalCount = results.length;
	} else if (route.mode === "datasets") {
		const response = await fetchBiomartText(new URLSearchParams({ type: "datasets", mart: route.mart }));
		endpoints.push(response.endpoint);
		results = parseDatasets(response.text, limit);
		totalCount = results.length;
	} else if (route.mode === "attributes") {
		const response = await fetchBiomartText(new URLSearchParams({ type: "attributes", dataset: route.dataset }));
		endpoints.push(response.endpoint);
		results = parseAttributes(response.text, limit, route.page);
		totalCount = results.length;
	} else if (route.mode === "filters") {
		const response = await fetchBiomartText(new URLSearchParams({ type: "filters", dataset: route.dataset }));
		endpoints.push(response.endpoint);
		results = parseFilters(response.text, limit);
		totalCount = results.length;
	} else {
		const xml = buildQueryXml(route);
		const response = await fetchBiomartText(new URLSearchParams(), {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({ query: xml }),
		});
		endpoints.push(response.endpoint);
		const parsed = parseDataRows(response.text, route.attributes, limit);
		results = parsed.rows;
		totalCount = parsed.totalCount;
	}
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "biomart",
		query,
		mode: route.mode,
		route,
		totalCount: numberValue(totalCount) ?? results.length,
		returned: results.length,
		results,
		provenance: {
			docs: ["https://www.ensembl.org/info/data/biomart/index.html", "https://www.ensembl.org/info/data/biomart/biomart_restful.html"],
			endpoints,
		},
	};
}
