import { createHash } from "node:crypto";

type SearchParams = { limit?: number; query: string; source: string };

const RFAM_BASE = "https://rfam.org";
const RFAM_BATCH_BASE = "https://batch.rfam.org";
const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;
const REQUEST_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_BYTES = 400_000;

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

function stripQueryParams(text: string): string {
	return text.replace(/\b[a-z][a-z0-9_-]*\s*=\s*("[^"]+"|'[^']+'|[^\s;]+)/gi, " ").trim();
}

function parseInteger(value: string | undefined, fallback: number, max = Number.MAX_SAFE_INTEGER): number {
	if (!value || !Number.isFinite(Number(value))) return fallback;
	return Math.max(1, Math.min(Math.floor(Number(value)), max));
}

function rfamDocs(): string[] {
	return [
		"https://docs.rfam.org/en/latest/api.html",
		"https://docs.rfam.org/en/latest/about-rfam.html",
	];
}

function stripCommand(query: string, command: string): string {
	return query.replace(new RegExp(`^${command}(?::|\\s+)?`, "i"), "").trim();
}

function sha256Text(text: string): string {
	return createHash("sha256").update(text, "utf8").digest("hex");
}

function capTextField(result: Record<string, unknown>, field: string, maxBytes: number): Record<string, unknown> {
	const text = result[field];
	if (typeof text !== "string") return result;
	const size = Buffer.byteLength(text, "utf8");
	if (size <= maxBytes) return { ...result, size_bytes: result.size_bytes ?? size };
	const capped = { ...result };
	delete capped[field];
	capped[`${field}_omitted`] = `${field} is ${size} bytes > max_bytes=${maxBytes}; metadata and sha256 are included.`;
	capped.size_bytes = size;
	return capped;
}

async function fetchText(url: URL, init?: RequestInit): Promise<string> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
	try {
		const response = await fetch(url, {
			...init,
			headers: {
				accept: "text/plain,application/json",
				"user-agent": "feynman-science-database-search/1.0 (https://github.com/advaitpaliwal/feynman)",
				...(init?.headers ?? {}),
			},
			signal: controller.signal,
		});
		if (!response.ok) throw new Error(`Rfam request failed: ${response.status} ${response.statusText}`);
		return response.text();
	} finally {
		clearTimeout(timeout);
	}
}

async function fetchJson(url: URL, init?: RequestInit): Promise<unknown> {
	const text = await fetchText(url, {
		...init,
		headers: {
			accept: "application/json",
			...(init?.headers ?? {}),
		},
	});
	return JSON.parse(text) as unknown;
}

function rfamTextUrl(family: string, suffix: string): URL {
	const url = new URL(`${RFAM_BASE}/family/${encodeURIComponent(family)}${suffix}`);
	url.searchParams.set("content-type", "text/plain");
	return url;
}

function rfamJsonUrl(family: string, suffix = ""): URL {
	const url = new URL(`${RFAM_BASE}/family/${encodeURIComponent(family)}${suffix}`);
	url.searchParams.set("content-type", "application/json");
	return url;
}

function flattenFamily(query: string, payload: Record<string, unknown>): Record<string, unknown> {
	const rfam = recordValue(payload.rfam ?? payload);
	const curation = recordValue(rfam.curation);
	const cm = recordValue(rfam.cm);
	const threshold = recordValue(cm.threshold);
	const release = recordValue(rfam.release);
	const clan = recordValue(rfam.clan);
	return {
		rfam_acc: stringValue(rfam.acc) ?? stringValue(rfam.rfam_acc) ?? query,
		rfam_id: stringValue(rfam.id) ?? stringValue(rfam.rfam_id),
		description: stringValue(rfam.description),
		comment: stringValue(rfam.comment),
		clan_acc: stringValue(clan.acc),
		clan_id: stringValue(clan.id),
		rna_type: stringValue(curation.type) ?? stringValue(rfam.type),
		structure_source: stringValue(curation.structure_source),
		num_seed: numberValue(curation.num_seed ?? rfam.num_seed),
		num_full: numberValue(curation.num_full ?? rfam.num_full),
		num_species: numberValue(curation.num_species ?? rfam.num_species),
		gathering_cutoff: numberValue(threshold.gathering ?? curation.ga),
		release_number: stringValue(release.number),
		release_date: stringValue(release.date),
		raw: rfam,
	};
}

function parseStockholmSeqNames(text: string): string[] {
	const names: string[] = [];
	const seen = new Set<string>();
	for (const line of text.split(/\r?\n/)) {
		if (!line || line.startsWith("#") || line.startsWith("//")) continue;
		const name = line.trim().split(/\s+/, 1)[0];
		if (!name || seen.has(name)) continue;
		seen.add(name);
		names.push(name);
	}
	return names;
}

function parseFastaSeqNames(text: string): string[] {
	return text.split(/\r?\n/).filter((line) => line.startsWith(">")).map((line) => line.slice(1).split(/\s+/, 1)[0] ?? "").filter(Boolean);
}

function parseCmHeader(text: string): Record<string, unknown> {
	const fields: Record<string, unknown> = {};
	const wanted = new Set(["NAME", "ACC", "DESC", "STATES", "NODES", "CLEN", "W", "ALPH", "GA", "TC", "NC"]);
	for (const line of text.split(/\r?\n/)) {
		if (line.trim() === "CM") break;
		const match = line.match(/^([A-Z]+)\s+(.+)$/);
		if (!match?.[1] || !match[2] || !wanted.has(match[1]) || fields[match[1]] !== undefined) continue;
		const numeric = ["STATES", "NODES", "CLEN", "W"].includes(match[1]) ? numberValue(match[2]) : undefined;
		fields[match[1]] = numeric ?? match[2].trim();
	}
	return fields;
}

function parseRegions(text: string, limit: number): { declared_count?: number; regions: Array<Record<string, unknown>> } {
	const columns = ["sequence_accession", "bits_score", "region_start", "region_end", "sequence_description", "species", "ncbi_tax_id"];
	let declared: number | undefined;
	const regions: Array<Record<string, unknown>> = [];
	for (const line of text.split(/\r?\n/)) {
		if (!line.trim()) continue;
		if (line.startsWith("#")) {
			const found = line.match(/\bfound\s+(\d+)\s+regions?\b/i);
			if (found?.[1]) declared = Number(found[1]);
			continue;
		}
		const parts = line.split("\t");
		const row: Record<string, unknown> = {};
		columns.forEach((column, index) => {
			row[column] = parts[index];
		});
		regions.push(row);
		if (regions.length >= limit) break;
	}
	return { declared_count: declared, regions };
}

function normalizeStructureMapping(payload: Record<string, unknown>, limit: number): {
	mapping: Array<Record<string, unknown>>;
	pdb_ids: string[];
} {
	const rows = arrayValue(payload.mapping ?? payload.mappings).map(recordValue)
		.sort((a, b) => String(a.pdb_id ?? "").localeCompare(String(b.pdb_id ?? ""))
			|| String(a.chain ?? "").localeCompare(String(b.chain ?? ""))
			|| (numberValue(a.pdb_start) ?? 0) - (numberValue(b.pdb_start) ?? 0)
			|| (numberValue(a.pdb_end) ?? 0) - (numberValue(b.pdb_end) ?? 0)
			|| (numberValue(a.cm_start) ?? 0) - (numberValue(b.cm_start) ?? 0));
	const mapping = rows.slice(0, limit);
	const pdbIds = [...new Set(rows.map((row) => stringValue(row.pdb_id)).filter((value): value is string => Boolean(value)))].sort();
	return { mapping, pdb_ids: pdbIds };
}

function normalizeSearchHits(payload: Record<string, unknown>, limit: number): {
	families: string[];
	hits: Record<string, unknown[]>;
	num_hits: number;
} {
	const hits = recordValue(payload.hits);
	const families = Object.keys(hits).sort();
	const limitedHits: Record<string, unknown[]> = {};
	let numHits = 0;
	for (const family of families) {
		const rows = arrayValue(hits[family]);
		numHits += rows.length;
		limitedHits[family] = rows.slice(0, limit);
	}
	return { families, hits: limitedHits, num_hits: numHits };
}

async function pollSequenceSearch(resultUrl: string, maxWaitS: number, pollIntervalS: number): Promise<Record<string, unknown>> {
	const deadline = Date.now() + maxWaitS * 1000;
	while (true) {
		const response = await fetch(resultUrl, { headers: { accept: "application/json" } });
		if (response.status === 200) return recordValue(await response.json());
		if (![202, 502, 503].includes(response.status)) {
			throw new Error(`Rfam sequence-search result failed: ${response.status} ${response.statusText}`);
		}
		if (Date.now() >= deadline) throw new Error(`Rfam sequence search not finished after ${maxWaitS}s.`);
		await new Promise((resolve) => setTimeout(resolve, pollIntervalS * 1000));
	}
}

export async function searchRfamExact(params: SearchParams): Promise<Record<string, unknown> | undefined> {
	if (params.source !== "rfam") return undefined;
	const query = params.query.trim();
	const limit = safeLimit(params.limit);
	const command = query.match(/^([a-z][a-z0-9_]*)(?::|\s|$)/i)?.[1]?.toLowerCase();
	if (!command || ![
		"accession_to_id",
		"get_covariance_model",
		"get_family",
		"get_seed_alignment",
		"get_sequence_regions",
		"get_structure_mapping",
		"get_tree",
		"id_to_accession",
		"search_sequence",
	].includes(command)) {
		return undefined;
	}
	const body = stripCommand(query, command);
	const flags = queryParamMap(body);
	const family = stripQueryParams(body);
	const endpoints: string[] = [];
	if (command === "get_family") {
		const url = rfamJsonUrl(family);
		endpoints.push(url.toString());
		const result = flattenFamily(family, recordValue(await fetchJson(url)));
		return { schema: "feynman.scienceDatabaseSearch.v1", source: "rfam", query, mode: command, ...result, provenance: { docs: rfamDocs(), endpoints } };
	}
	if (command === "accession_to_id" || command === "id_to_accession") {
		const suffix = command === "accession_to_id" ? "/id" : "/acc";
		const url = rfamTextUrl(family, suffix);
		endpoints.push(url.toString());
		const value = (await fetchText(url)).trim();
		return {
			schema: "feynman.scienceDatabaseSearch.v1",
			source: "rfam",
			query,
			mode: command,
			...(command === "accession_to_id" ? { accession: family, rfam_id: value } : { rfam_id: family, accession: value }),
			provenance: { docs: rfamDocs(), endpoints },
		};
	}
	if (command === "get_seed_alignment") {
		const format = (flags.fmt ?? flags.format ?? "stockholm").toLowerCase();
		if (!["stockholm", "fasta"].includes(format)) throw new Error("get_seed_alignment format must be stockholm or fasta.");
		const url = rfamTextUrl(family, format === "stockholm" ? "/alignment" : "/alignment/fasta");
		endpoints.push(url.toString());
		const alignment = await fetchText(url);
		const sequenceNames = format === "stockholm" ? parseStockholmSeqNames(alignment) : parseFastaSeqNames(alignment);
		const result = capTextField({
			family,
			format,
			num_sequences: sequenceNames.length,
			sequence_names: sequenceNames.slice(0, limit),
			sha256: sha256Text(alignment),
			alignment,
		}, "alignment", parseInteger(flags.max_bytes, DEFAULT_MAX_BYTES));
		return { schema: "feynman.scienceDatabaseSearch.v1", source: "rfam", query, mode: command, ...result, provenance: { docs: rfamDocs(), endpoints } };
	}
	if (command === "get_covariance_model") {
		const url = rfamTextUrl(family, "/cm");
		endpoints.push(url.toString());
		const cm = await fetchText(url);
		const result = capTextField({ family, header: parseCmHeader(cm), size_bytes: Buffer.byteLength(cm, "utf8"), sha256: sha256Text(cm), cm }, "cm", parseInteger(flags.max_bytes, DEFAULT_MAX_BYTES));
		return { schema: "feynman.scienceDatabaseSearch.v1", source: "rfam", query, mode: command, ...result, provenance: { docs: rfamDocs(), endpoints } };
	}
	if (command === "get_tree") {
		const url = rfamTextUrl(family, "/tree");
		endpoints.push(url.toString());
		const tree = await fetchText(url);
		const leafCount = tree ? (tree.match(/[(,]\s*[^(),:]+:/g) ?? []).length : 0;
		return { schema: "feynman.scienceDatabaseSearch.v1", source: "rfam", query, mode: command, family, num_leaf_labels: leafCount, sha256: sha256Text(tree), tree, provenance: { docs: rfamDocs(), endpoints } };
	}
	if (command === "get_sequence_regions") {
		const url = rfamTextUrl(family, "/regions");
		endpoints.push(url.toString());
		const parsed = parseRegions(await fetchText(url), limit);
		return { schema: "feynman.scienceDatabaseSearch.v1", source: "rfam", query, mode: command, family, declared_count: parsed.declared_count, num_regions: parsed.regions.length, regions: parsed.regions, provenance: { docs: rfamDocs(), endpoints } };
	}
	if (command === "get_structure_mapping") {
		const url = rfamJsonUrl(family, "/structures");
		endpoints.push(url.toString());
		const normalized = normalizeStructureMapping(recordValue(await fetchJson(url)), limit);
		return { schema: "feynman.scienceDatabaseSearch.v1", source: "rfam", query, mode: command, family, num_mappings: normalized.mapping.length, num_pdb_ids: normalized.pdb_ids.length, pdb_ids: normalized.pdb_ids, mapping: normalized.mapping, provenance: { docs: rfamDocs(), endpoints } };
	}
	if (command === "search_sequence") {
		const sequence = family.replace(/\s+/g, "");
		if (!/^[ACGTUNacgtun]+$/.test(sequence)) throw new Error("search_sequence requires a plain DNA/RNA sequence.");
		const maxWaitS = parseInteger(flags.max_wait_s ?? flags.max_wait, 300);
		const pollIntervalS = parseInteger(flags.poll_interval_s ?? flags.poll_interval, 5);
		const form = new FormData();
		form.append("sequence_file", new Blob([sequence], { type: "text/plain" }), "sequence.seq");
		const submitUrl = new URL(`${RFAM_BATCH_BASE}/submit-job`);
		endpoints.push(submitUrl.toString());
		const submission = recordValue(await fetchJson(submitUrl, { body: form, method: "POST" }));
		const resultUrl = stringValue(submission.resultURL);
		if (!resultUrl) throw new Error("Rfam sequence-search submission did not return resultURL.");
		endpoints.push(resultUrl);
		const result = await pollSequenceSearch(resultUrl, maxWaitS, pollIntervalS);
		const normalized = normalizeSearchHits(result, limit);
		return {
			schema: "feynman.scienceDatabaseSearch.v1",
			source: "rfam",
			query,
			mode: command,
			job_id: stringValue(submission.jobId ?? result.jobId),
			num_hits: normalized.num_hits,
			families: normalized.families,
			hits: normalized.hits,
			search_sequence: stringValue(result.searchSequence),
			provenance: { docs: rfamDocs(), endpoints },
		};
	}
	return undefined;
}
