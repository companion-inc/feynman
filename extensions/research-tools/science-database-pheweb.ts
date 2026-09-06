export type PhewebScienceDatabaseSource = "pheweb";

type SearchParams = { limit?: number; query: string; source: PhewebScienceDatabaseSource };

type PhewebInstanceKey = "bbj" | "finngen";

const REQUEST_TIMEOUT_MS = 25_000;
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 3_000;

const PHEWEB_INSTANCES: Record<PhewebInstanceKey, Record<string, unknown>> = {
	finngen: {
		label: "FinnGen R12",
		base_url: "https://r12.finngen.fi",
		genome_build: "GRCh38",
		capabilities: ["variant", "gene", "phenotypes", "autocomplete"],
		notes: "Variant coordinates are GRCh38; gene PheWAS reports the best-associated variant per endpoint in the FinnGen gene region.",
	},
	bbj: {
		label: "BioBank Japan",
		base_url: "https://pheweb.jp",
		genome_build: "GRCh37",
		capabilities: ["variant", "autocomplete"],
		notes: "Variant coordinates are GRCh37/hg19; lift over before comparing with FinnGen GRCh38 variant IDs.",
	},
};

const PHEWEB_SOURCE_SET = new Set<PhewebScienceDatabaseSource>(["pheweb"]);

export function isPhewebScienceDatabaseSource(source: string): source is PhewebScienceDatabaseSource {
	return PHEWEB_SOURCE_SET.has(source as PhewebScienceDatabaseSource);
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

function safeLimit(value: number | undefined, fallback = DEFAULT_LIMIT): number {
	if (!Number.isFinite(value) || value === undefined) return fallback;
	return Math.max(1, Math.min(Math.floor(value), MAX_LIMIT));
}

function exactCommand(query: string): { command: string; rest: string } | undefined {
	const match = query.trim().match(/^([a-z][a-z0-9_]*):?\s*(.*)$/i);
	if (!match?.[1]?.startsWith("phewas_")) return undefined;
	return { command: match[1].toLowerCase(), rest: match[2]?.trim() ?? "" };
}

function queryParamMap(text: string): Record<string, string> {
	const params: Record<string, string> = {};
	for (const match of text.matchAll(/\b([a-z][a-z0-9_-]*)\s*=\s*("[^"]+"|'[^']+'|[^\s;]+)/gi)) {
		const key = match[1]?.toLowerCase();
		const raw = match[2]?.trim();
		if (!key || !raw) continue;
		params[key] = raw.replace(/^["']|["']$/g, "");
	}
	return params;
}

function stripNamedParams(text: string): string {
	return text.replace(/\b[a-z][a-z0-9_-]*\s*=\s*("[^"]+"|'[^']+'|[^\s;]+)/gi, " ").trim();
}

function instanceKey(value: string | undefined): PhewebInstanceKey {
	const clean = (value ?? "finngen").trim().toLowerCase();
	if (clean === "finngen" || clean === "bbj") return clean;
	throw new Error("PheWeb instance must be finngen or bbj.");
}

function requireCapability(instance: PhewebInstanceKey, capability: string): void {
	const capabilities = arrayValue(PHEWEB_INSTANCES[instance].capabilities).map(String);
	if (!capabilities.includes(capability)) throw new Error(`PheWeb instance ${instance} does not expose ${capability}.`);
}

function normalizedVariantId(value: string): string {
	const clean = value.trim().replace(/^chr/i, "").replace(/[/:_]/g, "-");
	if (!/^[A-Za-z0-9]+-\d+-[A-Za-z]+-[A-Za-z]+$/.test(clean)) {
		throw new Error("phewas_variant requires chrom-pos-ref-alt, for example 19-44908822-C-T.");
	}
	return clean;
}

async function fetchJson(url: URL): Promise<unknown> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
	try {
		const response = await fetch(url, {
			headers: {
				accept: "application/json",
				"user-agent": "feynman-pheweb/1.0 (https://github.com/advaitpaliwal/feynman)",
			},
			signal: controller.signal,
		});
		if (!response.ok) throw new Error(`PheWeb request failed: ${response.status} ${response.statusText}`);
		return response.json();
	} finally {
		clearTimeout(timeout);
	}
}

function baseUrl(instance: PhewebInstanceKey): string {
	return String(PHEWEB_INSTANCES[instance].base_url).replace(/\/$/, "");
}

function pvalSortValue(row: Record<string, unknown>): number {
	const pval = numberValue(row.pval);
	if (pval !== undefined) return pval;
	const mlogp = numberValue(row.mlogp);
	if (mlogp !== undefined) return 10 ** -mlogp;
	return Number.POSITIVE_INFINITY;
}

function capRows(rows: Record<string, unknown>[], maxRecords: number): { rows: Record<string, unknown>[]; total: number; returned: number; truncated: boolean } {
	const total = rows.length;
	const capped = rows.slice(0, maxRecords);
	return { rows: capped, total, returned: capped.length, truncated: total > capped.length };
}

function leanGnomad(value: unknown): Record<string, unknown> | undefined {
	const record = recordValue(value);
	const keep = ["AF", "AF_fin", "AF_nfe", "AF_popmax", "filters", "rsid"];
	const out: Record<string, unknown> = {};
	for (const key of keep) {
		if (record[key] !== undefined) out[key] = record[key];
	}
	return Object.keys(out).length ? out : undefined;
}

function leanAssocRow(value: unknown): Record<string, unknown> {
	const row = recordValue(value);
	return {
		phenocode: stringValue(row.phenocode),
		phenostring: stringValue(row.phenostring),
		category: stringValue(row.category),
		pval: numberValue(row.pval),
		mlogp: numberValue(row.mlogp),
		beta: numberValue(row.beta),
		sebeta: numberValue(row.sebeta),
		af: numberValue(row.af),
		maf: numberValue(row.maf),
		maf_case: numberValue(row.maf_case),
		maf_control: numberValue(row.maf_control),
		n_cases: numberValue(row.n_case ?? row.num_cases),
		n_controls: numberValue(row.n_control ?? row.num_controls),
		n_samples: numberValue(row.n_sample ?? row.num_samples),
	};
}

function phenotypeRow(value: unknown): Record<string, unknown> {
	const row = recordValue(value);
	return {
		phenocode: stringValue(row.phenocode),
		phenostring: stringValue(row.phenostring),
		category: stringValue(row.category),
		num_cases: numberValue(row.num_cases),
		num_controls: numberValue(row.num_controls),
		num_gw_significant: numberValue(row.num_gw_significant),
	};
}

function autocompleteRow(value: unknown): Record<string, unknown> {
	const row = recordValue(value);
	return {
		display: stringValue(row.display),
		phenocode: stringValue(row.pheno ?? row.value),
		url: stringValue(row.url),
	};
}

function variantMeta(instance: PhewebInstanceKey, payload: Record<string, unknown>): Record<string, unknown> {
	const variant = recordValue(payload.variant);
	if (instance === "finngen") {
		return {
			chrom: stringValue(payload.chrom ?? variant.chrom ?? variant.chr),
			pos: numberValue(payload.pos ?? variant.pos),
			ref: stringValue(payload.ref ?? variant.ref),
			alt: stringValue(payload.alt ?? variant.alt),
			rsids: payload.rsids ?? variant.rsids,
			nearest_genes: payload.nearest_genes ?? variant.nearest_genes,
			gnomad: leanGnomad(payload.gnomad ?? variant.gnomad),
		};
	}
	return {
		chrom: stringValue(payload.chr ?? payload.chrom ?? variant.chr ?? variant.chrom),
		pos: numberValue(payload.pos ?? variant.pos),
		ref: stringValue(payload.ref ?? variant.ref),
		alt: stringValue(payload.alt ?? variant.alt),
		rsids: payload.rsids ?? variant.rsids,
		nearest_genes: payload.nearest_genes ?? variant.nearest_genes,
		gnomad: undefined,
	};
}

async function phewasVariant(query: string, parsed: Record<string, string>, limit: number): Promise<Record<string, unknown>> {
	const instance = instanceKey(parsed.instance);
	requireCapability(instance, "variant");
	const variant = normalizedVariantId(stripNamedParams(query) || parsed.variant || "");
	const url = new URL(`${baseUrl(instance)}/api/variant/${encodeURIComponent(variant)}`);
	const payload = recordValue(await fetchJson(url));
	const rawRows = arrayValue(payload.results).length ? arrayValue(payload.results) : arrayValue(payload.phenos);
	const rows = rawRows.map(leanAssocRow).sort((a, b) => pvalSortValue(a) - pvalSortValue(b));
	const capped = capRows(rows, limit);
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "pheweb",
		query,
		searchMode: "phewas_variant",
		instance,
		genome_build: PHEWEB_INSTANCES[instance].genome_build,
		variant,
		variant_meta: variantMeta(instance, payload),
		total: capped.total,
		returned: capped.returned,
		truncated: capped.truncated,
		phenotypes: capped.rows,
		results: capped.rows,
		provenance: { docs: ["https://github.com/statgen/pheweb", "https://finngen.gitbook.io/documentation/r8/methods/pheweb"], endpoints: [url.toString()] },
	};
}

async function phewasFinngenGene(query: string, parsed: Record<string, string>, limit: number): Promise<Record<string, unknown>> {
	const gene = (stripNamedParams(query) || parsed.gene_symbol || parsed.gene || "").trim();
	if (!gene) throw new Error("phewas_finngen_gene requires a gene symbol.");
	const url = new URL(`${baseUrl("finngen")}/api/gene_phenos/${encodeURIComponent(gene)}`);
	const payload = await fetchJson(url);
	const rawRows = arrayValue(recordValue(payload).phenotypes).length ? arrayValue(recordValue(payload).phenotypes) : arrayValue(payload);
	const rows = rawRows.map((item) => {
		const row = recordValue(item);
		const assoc = leanAssocRow(row.assoc ?? row);
		const variant = recordValue(row.variant);
		return {
			...assoc,
			variant: {
				chrom: stringValue(variant.chr ?? variant.chrom),
				pos: numberValue(variant.pos),
				ref: stringValue(variant.ref),
				alt: stringValue(variant.alt),
				varid: stringValue(variant.varid),
				rsids: recordValue(variant.annotation).rsids ?? variant.rsids,
			},
		};
	}).sort((a, b) => pvalSortValue(a) - pvalSortValue(b));
	const capped = capRows(rows, limit);
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "pheweb",
		query,
		searchMode: "phewas_finngen_gene",
		instance: "finngen",
		genome_build: "GRCh38",
		gene_symbol: gene,
		total: capped.total,
		returned: capped.returned,
		truncated: capped.truncated,
		phenotypes: capped.rows,
		results: capped.rows,
		provenance: { docs: ["https://github.com/statgen/pheweb", "https://finngen.gitbook.io/documentation/r8/methods/pheweb"], endpoints: [url.toString()] },
	};
}

async function phewasListPhenotypes(query: string, parsed: Record<string, string>, limit: number): Promise<Record<string, unknown>> {
	const instance = instanceKey(parsed.instance);
	requireCapability(instance, "phenotypes");
	const url = new URL(`${baseUrl(instance)}/api/phenos`);
	const rows = arrayValue(await fetchJson(url)).map(phenotypeRow).sort((a, b) => String(a.phenocode ?? "").localeCompare(String(b.phenocode ?? "")));
	const capped = capRows(rows, limit);
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "pheweb",
		query,
		searchMode: "phewas_list_phenotypes",
		instance,
		total: capped.total,
		returned: capped.returned,
		truncated: capped.truncated,
		phenotypes: capped.rows,
		results: capped.rows,
		provenance: { docs: ["https://github.com/statgen/pheweb", "https://finngen.gitbook.io/documentation/r8/methods/pheweb"], endpoints: [url.toString()] },
	};
}

async function phewasSearchPhenotypes(query: string, parsed: Record<string, string>, limit: number): Promise<Record<string, unknown>> {
	const instance = instanceKey(parsed.instance);
	requireCapability(instance, "autocomplete");
	const term = (stripNamedParams(query) || parsed.query || "").trim();
	if (!term) throw new Error("phewas_search_phenotypes requires a text query.");
	const url = new URL(`${baseUrl(instance)}/api/autocomplete`);
	url.searchParams.set("query", term);
	const rows = arrayValue(await fetchJson(url)).map(autocompleteRow);
	const capped = capRows(rows, limit);
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "pheweb",
		query,
		searchMode: "phewas_search_phenotypes",
		instance,
		search_query: term,
		total: capped.total,
		returned: capped.returned,
		truncated: capped.truncated,
		matches: capped.rows,
		results: capped.rows,
		provenance: { docs: ["https://github.com/statgen/pheweb", "https://finngen.gitbook.io/documentation/r8/methods/pheweb"], endpoints: [url.toString()] },
	};
}

export async function searchPheweb(params: SearchParams): Promise<Record<string, unknown>> {
	const exact = exactCommand(params.query);
	const parsed = queryParamMap(exact?.rest ?? params.query);
	const limit = safeLimit(numberValue(parsed.max_phenos ?? parsed.max_records) ?? params.limit, exact?.command === "phewas_list_phenotypes" ? 3_000 : DEFAULT_LIMIT);
	if (!exact || exact.command === "phewas_instances") {
		return {
			schema: "feynman.scienceDatabaseSearch.v1",
			source: "pheweb",
			query: params.query,
			searchMode: "phewas_instances",
			instances: PHEWEB_INSTANCES,
			provenance: { docs: ["https://github.com/statgen/pheweb", "https://finngen.gitbook.io/documentation/r8/methods/pheweb"], endpoints: [] },
		};
	}
	if (exact.command === "phewas_variant") return phewasVariant(exact.rest, parsed, limit);
	if (exact.command === "phewas_finngen_gene") return phewasFinngenGene(exact.rest, parsed, limit);
	if (exact.command === "phewas_list_phenotypes") return phewasListPhenotypes(exact.rest, parsed, limit);
	if (exact.command === "phewas_search_phenotypes") return phewasSearchPhenotypes(exact.rest, parsed, limit);
	throw new Error(`Unsupported PheWeb exact command: ${exact.command}`);
}
