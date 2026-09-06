export type EbiStructuralScienceDatabaseSource = "chebi" | "complexportal" | "emdb" | "intact";

type SearchParams = { limit?: number; query: string; source: EbiStructuralScienceDatabaseSource };

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;
const REQUEST_TIMEOUT_MS = 25_000;
const CHEBI_BASE = "https://www.ebi.ac.uk/chebi/backend/api/public";
const COMPLEX_PORTAL_BASE = "https://www.ebi.ac.uk/intact/complex-ws";
const EMDB_BASE = "https://www.ebi.ac.uk/emdb/api";
const INTACT_BASE = "https://www.ebi.ac.uk/intact/ws";

const EBI_STRUCTURAL_SOURCES = new Set<EbiStructuralScienceDatabaseSource>(["chebi", "complexportal", "emdb", "intact"]);

export function isEbiStructuralScienceDatabaseSource(source: string): source is EbiStructuralScienceDatabaseSource {
	return EBI_STRUCTURAL_SOURCES.has(source as EbiStructuralScienceDatabaseSource);
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
	if (typeof value === "string" && ["true", "false"].includes(value.toLowerCase())) return value.toLowerCase() === "true";
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

async function responseFor(url: URL, init?: RequestInit): Promise<Response> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
	try {
		const response = await fetch(url, {
			...init,
			headers: {
				accept: "application/json",
				"user-agent": "feynman-science-database-search/1.0 (https://github.com/advaitpaliwal/feynman)",
				...(init?.headers ?? {}),
			},
			signal: controller.signal,
		});
		if (!response.ok) throw new Error(`Science database request failed: ${response.status} ${response.statusText}`);
		return response;
	} finally {
		clearTimeout(timeout);
	}
}

async function fetchJson(url: URL, init?: RequestInit): Promise<unknown> {
	return (await responseFor(url, init)).json();
}

async function fetchText(url: URL, init?: RequestInit): Promise<string> {
	return (await responseFor(url, init)).text();
}

function normalizeChebiId(query: string): string | undefined {
	const match = cleanQuery(query).match(/^(?:chebi\s*:?\s*)?(\d+)$/i);
	return match ? match[1] : undefined;
}

function prefixedBody(query: string, prefix: string): string | undefined {
	return query.match(new RegExp(`^${prefix}\\s*:\\s*(.+)$`, "i"))?.[1]?.trim();
}

function stringParam(query: string, name: string): string | undefined {
	return query.match(new RegExp(`\\b${name}\\s*[:=]\\s*([^\\s,;]+)`, "i"))?.[1];
}

function removeSimpleParams(query: string): string {
	return query
		.replace(/\b(?:relation_type|page|max_results|size)\s*[:=]\s*("[^"]*"|'[^']*'|[^\s,;]+)/gi, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function chebiUrl(accession: string | undefined): string | undefined {
	if (!accession) return undefined;
	const id = accession.toUpperCase().replace(/^CHEBI:/, "");
	return `https://www.ebi.ac.uk/chebi/searchId.do?chebiId=${encodeURIComponent(`CHEBI:${id}`)}`;
}

function normalizeChebiHit(hit: Record<string, unknown>): Record<string, unknown> {
	const source = recordValue(hit._source ?? hit);
	const accession = stringValue(source.chebi_accession);
	return {
		chebiAccession: accession,
		name: stringValue(source.name),
		definition: stringValue(source.definition),
		stars: numberValue(source.stars),
		formula: stringValue(source.formula),
		charge: numberValue(source.charge),
		mass: numberValue(source.mass),
		monoisotopicMass: numberValue(source.monoisotopicmass ?? source.monoisotopic_mass),
		smiles: stringValue(source.smiles),
		inchi: stringValue(source.inchi),
		inchiKey: stringValue(source.inchikey ?? source.standard_inchi_key),
		score: numberValue(hit._score),
		url: chebiUrl(accession),
	};
}

function normalizeChebiCompound(record: Record<string, unknown>): Record<string, unknown> {
	const chemical = recordValue(record.chemical_data);
	const structure = recordValue(record.default_structure);
	const accession = stringValue(record.chebi_accession);
	const relations = recordValue(record.ontology_relations);
	return {
		chebiAccession: accession,
		name: stringValue(record.name),
		definition: stringValue(record.definition),
		stars: numberValue(record.stars),
		formula: stringValue(chemical.formula),
		charge: numberValue(chemical.charge),
		mass: numberValue(chemical.mass),
		monoisotopicMass: numberValue(chemical.monoisotopic_mass),
		smiles: stringValue(structure.smiles),
		inchi: stringValue(structure.standard_inchi),
		inchiKey: stringValue(structure.standard_inchi_key),
		secondaryIds: arrayValue(record.secondary_ids).map(String).slice(0, 12),
		synonyms: arrayValue(recordValue(record.names).SYNONYM).map((item) => stringValue(recordValue(item).name)).filter(Boolean).slice(0, 12),
		outgoingRelations: arrayValue(relations.outgoing_relations).map((item) => normalizeChebiRelation(recordValue(item))).slice(0, 24),
		incomingRelations: arrayValue(relations.incoming_relations).map((item) => normalizeChebiRelation(recordValue(item))).slice(0, 24),
		isReleased: booleanValue(record.is_released),
		modifiedOn: stringValue(record.modified_on),
		url: chebiUrl(accession),
	};
}

function normalizeChebiRelation(record: Record<string, unknown>): Record<string, unknown> {
	return {
		relationType: stringValue(record.relation_type),
		initChebiId: stringValue(record.init_id),
		initName: stringValue(record.init_name),
		finalChebiId: stringValue(record.final_id),
		finalName: stringValue(record.final_name),
	};
}

function normalizeChebiOntologyRecord(record: Record<string, unknown>, direction: "children" | "parents"): Record<string, unknown> {
	return {
		direction,
		chebiAccession: stringValue(record.chebi_accession ?? record.chebi_id ?? record.chebiId),
		name: stringValue(record.name),
		relationType: stringValue(record.relation_type),
		definition: stringValue(record.definition),
		stars: numberValue(record.stars),
		url: chebiUrl(stringValue(record.chebi_accession ?? record.chebi_id ?? record.chebiId)),
	};
}

async function searchChebi(params: SearchParams): Promise<Record<string, unknown>> {
	const query = cleanQuery(params.query);
	const limit = safeLimit(params.limit);
	const ontologyBody = prefixedBody(query, "chebi_get_ontology");
	const entityBody = prefixedBody(query, "chebi_get_entity");
	const searchBody = prefixedBody(query, "chebi_search");
	const ontologyId = ontologyBody ? normalizeChebiId(removeSimpleParams(ontologyBody)) : undefined;
	if (ontologyBody && ontologyId) {
		const relationType = stringParam(query, "relation_type");
		const endpoints: string[] = [];
		const records: Array<Record<string, unknown>> = [];
		for (const direction of ["parents", "children"] as const) {
			const url = new URL(`${CHEBI_BASE}/ontology/${direction}/${encodeURIComponent(ontologyId)}/`);
			endpoints.push(url.toString());
			const payload = await fetchJson(url);
			const rows = Array.isArray(payload) ? payload : arrayValue(recordValue(payload).results ?? recordValue(payload).items ?? recordValue(payload).relations);
			records.push(...rows.map((item) => normalizeChebiOntologyRecord(recordValue(item), direction)));
		}
		const filtered = relationType ? records.filter((record) => String(record.relationType ?? "").toLowerCase() === relationType.toLowerCase()) : records;
		return {
			schema: "feynman.scienceDatabaseSearch.v1",
			source: "chebi",
			query,
			mode: "chebi-get-ontology",
			totalCount: filtered.length,
			returned: Math.min(filtered.length, limit),
			results: filtered.slice(0, limit),
			provenance: {
				docs: "https://www.ebi.ac.uk/chebi/backend/api/docs/",
				endpoints,
			},
		};
	}
	const effectiveQuery = searchBody ?? entityBody ?? query;
	const chebiId = normalizeChebiId(removeSimpleParams(effectiveQuery));
	if (chebiId) {
		const url = new URL(`${CHEBI_BASE}/compound/${encodeURIComponent(chebiId)}/`);
		const payload = recordValue(await fetchJson(url));
		return {
			schema: "feynman.scienceDatabaseSearch.v1",
			source: "chebi",
			query,
			mode: entityBody ? "chebi-get-entity" : "compound",
			totalCount: 1,
			returned: 1,
			results: [normalizeChebiCompound(payload)],
			provenance: {
				docs: "https://www.ebi.ac.uk/chebi/backend/api/docs/",
				endpoints: [url.toString()],
			},
		};
	}
	const url = new URL(`${CHEBI_BASE}/es_search/`);
	url.searchParams.set("term", removeSimpleParams(effectiveQuery));
	url.searchParams.set("size", String(limit));
	url.searchParams.set("page", stringParam(query, "page") ?? "1");
	const payload = recordValue(await fetchJson(url));
	const results = arrayValue(payload.results).map((item) => normalizeChebiHit(recordValue(item)));
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "chebi",
		query,
		mode: searchBody ? "chebi-search" : "search",
		totalCount: numberValue(payload.total) ?? results.length,
		returned: results.length,
		results,
		provenance: {
			docs: "https://www.ebi.ac.uk/chebi/backend/api/docs/",
			endpoints: [url.toString()],
		},
	};
}

function splitSpecies(raw: unknown): { speciesName?: string; taxId?: number } {
	const text = stringValue(raw);
	if (!text) return {};
	const [name, tax] = text.split(";").map((part) => part.trim());
	return { speciesName: name || text, taxId: numberValue(tax) };
}

function normalizeComplexPortalRecord(record: Record<string, unknown>): Record<string, unknown> {
	const complexAc = stringValue(record.complexAC ?? record.complexAc);
	const species = splitSpecies(record.organismName ?? record.species);
	return {
		complexAc,
		name: stringValue(record.complexName ?? record.name),
		systematicName: stringValue(record.systematicName),
		description: stringValue(record.description),
		speciesName: species.speciesName,
		taxId: species.taxId,
		predictedComplex: booleanValue(record.predictedComplex),
		interactors: arrayValue(record.interactors ?? record.participants).map((item) => {
			const interactor = recordValue(item);
			return {
				accession: stringValue(interactor.identifier),
				name: stringValue(interactor.name),
				description: stringValue(interactor.description),
				type: stringValue(interactor.interactorType),
				organism: stringValue(interactor.organismName),
				stoichiometry: stringValue(interactor.stochiometry),
				url: stringValue(interactor.identifierLink),
			};
		}).slice(0, 12),
		url: complexAc ? `https://www.ebi.ac.uk/complexportal/complex/${encodeURIComponent(complexAc)}` : undefined,
	};
}

async function searchComplexPortal(params: SearchParams): Promise<Record<string, unknown>> {
	const query = cleanQuery(params.query);
	const limit = safeLimit(params.limit);
	const accession = query.match(/^(?:complex|cpx)\s*:?\s*(CPX-\d+)$/i)?.[1] ?? query.match(/^(CPX-\d+)$/i)?.[1];
	if (accession) {
		const url = new URL(`${COMPLEX_PORTAL_BASE}/complex-simplified/${encodeURIComponent(accession.toUpperCase())}`);
		const payload = recordValue(await fetchJson(url));
		return {
			schema: "feynman.scienceDatabaseSearch.v1",
			source: "complexportal",
			query,
			mode: "complex",
			totalCount: 1,
			returned: 1,
			results: [normalizeComplexPortalRecord(payload)],
			provenance: {
				docs: ["https://www.ebi.ac.uk/complexportal", "https://smart-api.info/ui/326eb1e437303bee27d3cef29227125d"],
				endpoints: [url.toString()],
			},
		};
	}
	const participantMatch = query.match(/^(?:participant|pxref|uniprot)\s*:\s*(\S+)$/i);
	const searchTerm = participantMatch ? `pxref:"${participantMatch[1]}"` : query;
	const url = new URL(`${COMPLEX_PORTAL_BASE}/search/${encodeURIComponent(searchTerm)}`);
	url.searchParams.set("format", "json");
	url.searchParams.set("first", "0");
	url.searchParams.set("number", String(limit));
	const payload = recordValue(await fetchJson(url));
	const results = arrayValue(payload.elements).map((item) => normalizeComplexPortalRecord(recordValue(item)));
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "complexportal",
		query,
		mode: participantMatch ? "participant-search" : "search",
		totalCount: numberValue(payload.totalNumberOfResults) ?? results.length,
		returned: results.length,
		results,
		provenance: {
			docs: ["https://www.ebi.ac.uk/complexportal", "https://smart-api.info/ui/326eb1e437303bee27d3cef29227125d"],
			endpoints: [url.toString()],
		},
	};
}

function normalizeIntactRecord(record: Record<string, unknown>): Record<string, unknown> {
	const idA = stringValue(record.idA)?.replace(/\s+\(.+\)$/, "");
	const idB = stringValue(record.idB)?.replace(/\s+\(.+\)$/, "");
	return {
		interactionAc: stringValue(record.ac),
		binaryInteractionId: numberValue(record.binaryInteractionId),
		participantA: idA,
		participantB: idB,
		moleculeA: stringValue(record.moleculeA),
		moleculeB: stringValue(record.moleculeB),
		speciesA: stringValue(record.speciesA),
		speciesB: stringValue(record.speciesB),
		taxIdA: numberValue(record.taxIdA),
		taxIdB: numberValue(record.taxIdB),
		interactionType: stringValue(record.type),
		detectionMethod: stringValue(record.detectionMethod),
		miScore: numberValue(record.intactMiscore),
		negative: booleanValue(record.negative),
		pubmedId: stringValue(record.publicationPubmedIdentifier),
		firstAuthor: stringValue(record.firstAuthor),
		sourceDatabase: stringValue(record.sourceDatabase),
		url: stringValue(record.ac) ? `https://www.ebi.ac.uk/intact/interaction/${encodeURIComponent(String(record.ac))}` : undefined,
	};
}

async function searchIntact(params: SearchParams): Promise<Record<string, unknown>> {
	const query = cleanQuery(params.query);
	const limit = safeLimit(params.limit);
	const clean = query.replace(/^interactor\s*:\s*/i, "");
	const url = new URL(`${INTACT_BASE}/interaction/findInteractions/${encodeURIComponent(clean)}`);
	url.searchParams.set("page", "0");
	url.searchParams.set("pageSize", String(limit));
	const payload = recordValue(await fetchJson(url));
	const content = arrayValue(payload.content ?? recordValue(payload.data).content);
	const results = content.map((item) => normalizeIntactRecord(recordValue(item)));
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "intact",
		query,
		totalCount: numberValue(payload.totalElements ?? recordValue(payload.data).totalElements) ?? results.length,
		returned: results.length,
		results,
		provenance: {
			docs: "https://www.ebi.ac.uk/intact/documentation/technical_corner",
			endpoints: [url.toString()],
		},
	};
}

function normalizeEmdbId(query: string): string | undefined {
	const match = cleanQuery(query).match(/^(?:emdb|emd)\s*:?\s*-?\s*(\d+)$/i);
	return match ? `EMD-${match[1]}` : undefined;
}

function nestedValue(value: unknown): unknown {
	return recordValue(value).valueOf_ ?? value;
}

function normalizeEmdbEntry(record: Record<string, unknown>): Record<string, unknown> {
	const admin = recordValue(record.admin);
	const keyDates = recordValue(admin.key_dates);
	const status = recordValue(admin.current_status);
	const sample = recordValue(record.sample);
	const map = recordValue(record.map);
	const dimensions = recordValue(map.dimensions);
	const determination = recordValue(arrayValue(recordValue(record.structure_determination_list).structure_determination)[0]);
	const processing = recordValue(arrayValue(determination.image_processing)[0]);
	const reconstruction = recordValue(processing.final_reconstruction);
	return {
		emdbId: stringValue(record.emdb_id),
		title: stringValue(admin.title),
		status: stringValue(nestedValue(status.code)),
		method: stringValue(determination.method),
		aggregationState: stringValue(determination.aggregation_state),
		resolutionAngstrom: numberValue(nestedValue(reconstruction.resolution)),
		resolutionMethod: stringValue(reconstruction.resolution_method),
		depositionDate: stringValue(keyDates.deposition)?.slice(0, 10),
		releaseDate: stringValue(keyDates.map_release ?? keyDates.header_release)?.slice(0, 10),
		sampleName: stringValue(nestedValue(sample.name)),
		mapFile: stringValue(map.file),
		mapFormat: stringValue(map.format),
		mapDimensions: {
			col: numberValue(dimensions.col),
			row: numberValue(dimensions.row),
			sec: numberValue(dimensions.sec),
		},
		url: stringValue(record.emdb_id) ? `https://www.ebi.ac.uk/emdb/${encodeURIComponent(String(record.emdb_id))}` : undefined,
	};
}

function parseCsv(text: string): Array<Record<string, string>> {
	const rows: string[][] = [];
	let row: string[] = [];
	let cell = "";
	let quoted = false;
	for (let i = 0; i < text.length; i += 1) {
		const char = text[i];
		const next = text[i + 1];
		if (quoted && char === "\"" && next === "\"") {
			cell += "\"";
			i += 1;
			continue;
		}
		if (char === "\"") {
			quoted = !quoted;
			continue;
		}
		if (!quoted && char === ",") {
			row.push(cell);
			cell = "";
			continue;
		}
		if (!quoted && (char === "\n" || char === "\r")) {
			if (char === "\r" && next === "\n") i += 1;
			row.push(cell);
			if (row.some((part) => part.length > 0)) rows.push(row);
			row = [];
			cell = "";
			continue;
		}
		cell += char;
	}
	if (cell || row.length) {
		row.push(cell);
		rows.push(row);
	}
	const [header = [], ...body] = rows;
	return body.map((values) => Object.fromEntries(header.map((key, index) => [key, values[index] ?? ""])));
}

function normalizeEmdbSearchRow(row: Record<string, string>): Record<string, unknown> {
	const emdbId = stringValue(row.emdb_id);
	return {
		emdbId,
		title: stringValue(row.title),
		resolutionAngstrom: numberValue(row.resolution),
		method: stringValue(row.structure_determination_method),
		fittedPdbIds: stringValue(row.fitted_pdbs)?.split(/[;,]\s*/).filter(Boolean) ?? [],
		status: stringValue(row.current_status),
		releaseDate: stringValue(row.release_date)?.slice(0, 10),
		url: emdbId ? `https://www.ebi.ac.uk/emdb/${encodeURIComponent(emdbId)}` : undefined,
	};
}

async function searchEmdb(params: SearchParams): Promise<Record<string, unknown>> {
	const query = cleanQuery(params.query);
	const limit = safeLimit(params.limit);
	const emdbId = normalizeEmdbId(query);
	if (emdbId) {
		const url = new URL(`${EMDB_BASE}/entry/${encodeURIComponent(emdbId)}`);
		const payload = recordValue(await fetchJson(url));
		return {
			schema: "feynman.scienceDatabaseSearch.v1",
			source: "emdb",
			query,
			mode: "entry",
			totalCount: 1,
			returned: 1,
			results: [normalizeEmdbEntry(payload)],
			provenance: {
				docs: "https://www.ebi.ac.uk/emdb/api/",
				endpoints: [url.toString()],
			},
		};
	}
	const url = new URL(`${EMDB_BASE}/search/${encodeURIComponent(query)}`);
	url.searchParams.set("rows", String(limit));
	url.searchParams.set("page", "1");
	url.searchParams.set("fl", "emdb_id,title,resolution,structure_determination_method,fitted_pdbs,current_status,release_date");
	const text = await fetchText(url, { headers: { accept: "text/csv" } });
	const results = parseCsv(text).map(normalizeEmdbSearchRow);
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "emdb",
		query,
		mode: "search",
		totalCount: results.length,
		returned: results.length,
		results,
		provenance: {
			docs: "https://www.ebi.ac.uk/emdb/api/",
			endpoints: [url.toString()],
		},
	};
}

export async function searchEbiStructuralScienceDatabase(params: SearchParams): Promise<Record<string, unknown>> {
	if (params.source === "chebi") return searchChebi(params);
	if (params.source === "complexportal") return searchComplexPortal(params);
	if (params.source === "emdb") return searchEmdb(params);
	return searchIntact(params);
}
