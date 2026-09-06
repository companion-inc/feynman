type SearchParams = { limit?: number; query: string; source: "openfda" };

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;
const OPENFDA_BASE = "https://api.fda.gov";
const REQUEST_TIMEOUT_MS = 25_000;

type OpenFdaMode =
	| "application-count"
	| "application-details"
	| "application-search"
	| "drug-event"
	| "drug-label"
	| "drug-recall"
	| "generic-equivalents"
	| "pharmacologic-classes"
	| "statistics";

const APPLICATION_NUMBER_RE = /^(?:NDA|ANDA|BLA)\d{6}$/i;
const PHARM_CLASS_TYPES = new Set(["epc", "moa", "cs", "pe"]);
const APPLICATION_COUNT_FIELDS: Record<string, string> = {
	application_number: "application_number",
	dosage_form: "products.dosage_form.exact",
	marketing_status: "products.marketing_status",
	pharm_class_cs: "openfda.pharm_class_cs.exact",
	pharm_class_epc: "openfda.pharm_class_epc.exact",
	pharm_class_moa: "openfda.pharm_class_moa.exact",
	pharm_class_pe: "openfda.pharm_class_pe.exact",
	route: "products.route.exact",
	sponsor_name: "sponsor_name",
	te_code: "products.te_code.exact",
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

function booleanValue(value: unknown): boolean | undefined {
	if (typeof value === "boolean") return value;
	if (typeof value === "string" && ["true", "false", "1", "2"].includes(value.toLowerCase())) {
		if (value === "1") return true;
		if (value === "2") return false;
		return value.toLowerCase() === "true";
	}
	return undefined;
}

function firstString(value: unknown): string | undefined {
	if (Array.isArray(value)) return stringValue(value[0]);
	return stringValue(value);
}

function stringArray(value: unknown, max = 8): string[] {
	return (Array.isArray(value) ? value : value === undefined ? [] : [value])
		.map((item) => String(item).trim())
		.filter(Boolean)
		.slice(0, max);
}

function safeLimit(value: number | undefined): number {
	if (!Number.isFinite(value) || value === undefined) return DEFAULT_LIMIT;
	return Math.max(1, Math.min(Math.floor(value), MAX_LIMIT));
}

function cleanQuery(query: string): string {
	const clean = query.trim();
	if (!clean) throw new Error("openFDA search requires a non-empty query.");
	return clean;
}

function cleanPhrase(value: string): string {
	return value.trim().replace(/"/g, "");
}

function phrase(fieldName: string, value: string): string {
	return `${fieldName}:"${cleanPhrase(value)}"`;
}

function dateForOpenFda(value: string): string {
	const clean = value.trim().replace(/-/g, "");
	if (!/^\d{8}$/.test(clean)) throw new Error(`openFDA date filters must be YYYY-MM-DD or YYYYMMDD: ${value}`);
	return clean;
}

function parseKeyValueQuery(query: string): { bare: string[]; values: Map<string, string> } {
	const values = new Map<string, string>();
	const bare: string[] = [];
	for (const match of query.matchAll(/(?:^|\s)([a-zA-Z_][\w.-]*)=("[^"]*"|'[^']*'|\S+)/g)) {
		const key = match[1]?.toLowerCase().replace(/-/g, "_");
		const raw = match[2];
		if (!key || !raw) continue;
		values.set(key, raw.replace(/^["']|["']$/g, "").trim());
	}
	const withoutPairs = query.replace(/(?:^|\s)([a-zA-Z_][\w.-]*)=("[^"]*"|'[^']*'|\S+)/g, " ").trim();
	if (withoutPairs) bare.push(...withoutPairs.split(/\s+/).filter(Boolean));
	return { bare, values };
}

function pickValue(values: Map<string, string>, ...keys: string[]): string | undefined {
	for (const key of keys) {
		const value = values.get(key);
		if (value?.trim()) return value.trim();
	}
	return undefined;
}

function totalCount(payload: Record<string, unknown>, fallback: number): number {
	return numberValue(recordValue(recordValue(payload.meta).results).total) ?? fallback;
}

async function responseFor(url: URL): Promise<Response | undefined> {
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
		if (response.status === 404) return undefined;
		if (!response.ok) throw new Error(`openFDA request failed: ${response.status} ${response.statusText}`);
		return response;
	} finally {
		clearTimeout(timeout);
	}
}

async function fetchOpenFdaJson(url: URL): Promise<Record<string, unknown> | undefined> {
	const response = await responseFor(url);
	return response ? recordValue(await response.json()) : undefined;
}

function openFdaUrl(endpoint: string, params: Record<string, string | number | undefined>): URL {
	const url = new URL(`${OPENFDA_BASE}/${endpoint}`);
	for (const [key, value] of Object.entries(params)) {
		if (value !== undefined) url.searchParams.set(key, String(value));
	}
	return url;
}

function normalizeOpenFdaLabel(record: Record<string, unknown>): Record<string, unknown> {
	const openfda = recordValue(record.openfda);
	return {
		id: stringValue(record.id),
		setId: stringValue(record.set_id),
		effectiveTime: stringValue(record.effective_time),
		version: stringValue(record.version),
		brandNames: stringArray(openfda.brand_name),
		genericNames: stringArray(openfda.generic_name),
		manufacturerNames: stringArray(openfda.manufacturer_name),
		productNdcs: stringArray(openfda.product_ndc),
		productTypes: stringArray(openfda.product_type),
		routes: stringArray(openfda.route),
		substanceNames: stringArray(openfda.substance_name),
		rxcuis: stringArray(openfda.rxcui),
		applicationNumbers: stringArray(openfda.application_number),
		activeIngredient: firstString(record.active_ingredient),
		purpose: firstString(record.purpose),
		indicationsAndUsage: firstString(record.indications_and_usage),
		boxedWarning: firstString(record.boxed_warning),
		warnings: firstString(record.warnings),
		adverseReactions: firstString(record.adverse_reactions),
		dosageAndAdministration: firstString(record.dosage_and_administration),
	};
}

function normalizeOpenFdaEvent(record: Record<string, unknown>): Record<string, unknown> {
	const patient = recordValue(record.patient);
	return {
		safetyReportId: stringValue(record.safetyreportid),
		receivedDate: stringValue(record.receivedate),
		serious: booleanValue(record.serious),
		seriousness: {
			death: booleanValue(record.seriousnessdeath),
			lifeThreatening: booleanValue(record.seriousnesslifethreatening),
			hospitalization: booleanValue(record.seriousnesshospitalization),
			disabling: booleanValue(record.seriousnessdisabling),
			congenitalAnomaly: booleanValue(record.seriousnesscongenitalanomali),
			other: booleanValue(record.seriousnessother),
		},
		reactions: arrayValue(patient.reaction).map((item) => {
			const reaction = recordValue(item);
			return {
				meddraTerm: stringValue(reaction.reactionmeddrapt),
				outcome: stringValue(reaction.reactionoutcome),
			};
		}).slice(0, 8),
		drugs: arrayValue(patient.drug).map((item) => {
			const drug = recordValue(item);
			return {
				name: stringValue(drug.medicinalproduct),
				indication: stringValue(drug.drugindication),
				characterization: stringValue(drug.drugcharacterization),
			};
		}).slice(0, 8),
	};
}

function normalizeOpenFdaRecall(record: Record<string, unknown>): Record<string, unknown> {
	return {
		recallNumber: stringValue(record.recall_number),
		status: stringValue(record.status),
		classification: stringValue(record.classification),
		productDescription: stringValue(record.product_description),
		reasonForRecall: stringValue(record.reason_for_recall),
		recallingFirm: stringValue(record.recalling_firm),
		reportDate: stringValue(record.report_date),
		recallInitiationDate: stringValue(record.recall_initiation_date),
		distributionPattern: stringValue(record.distribution_pattern),
		city: stringValue(record.city),
		state: stringValue(record.state),
		country: stringValue(record.country),
	};
}

function normalizeActiveIngredient(record: Record<string, unknown>): Record<string, unknown> {
	return {
		name: stringValue(record.name),
		strength: stringValue(record.strength),
	};
}

function normalizeOpenFdaProduct(record: Record<string, unknown>): Record<string, unknown> {
	return {
		productNumber: stringValue(record.product_number),
		brandName: stringValue(record.brand_name),
		dosageForm: stringValue(record.dosage_form),
		route: stringValue(record.route),
		marketingStatus: stringValue(record.marketing_status),
		teCode: stringValue(record.te_code),
		referenceDrug: stringValue(record.reference_drug),
		referenceStandard: stringValue(record.reference_standard),
		activeIngredients: arrayValue(record.active_ingredients).map((item) => normalizeActiveIngredient(recordValue(item))),
	};
}

function normalizeOpenFdaSubmission(record: Record<string, unknown>): Record<string, unknown> {
	return {
		type: stringValue(record.submission_type),
		number: stringValue(record.submission_number),
		status: stringValue(record.submission_status),
		statusDate: stringValue(record.submission_status_date),
		classCode: stringValue(record.submission_class_code),
		classDescription: stringValue(record.submission_class_code_description),
		reviewPriority: stringValue(record.review_priority),
	};
}

function normalizeOpenFdaApplication(record: Record<string, unknown>): Record<string, unknown> {
	const openfda = recordValue(record.openfda);
	return {
		applicationNumber: stringValue(record.application_number),
		sponsorName: stringValue(record.sponsor_name),
		products: arrayValue(record.products).map((item) => normalizeOpenFdaProduct(recordValue(item))),
		submissions: arrayValue(record.submissions).map((item) => normalizeOpenFdaSubmission(recordValue(item))).slice(0, 25),
		openfda: {
			brandNames: stringArray(openfda.brand_name, 12),
			genericNames: stringArray(openfda.generic_name, 12),
			manufacturerNames: stringArray(openfda.manufacturer_name, 12),
			substanceNames: stringArray(openfda.substance_name, 12),
			unii: stringArray(openfda.unii, 12),
			rxcui: stringArray(openfda.rxcui, 12),
			productNdcs: stringArray(openfda.product_ndc, 12),
			pharmClassEpc: stringArray(openfda.pharm_class_epc, 12),
			pharmClassMoa: stringArray(openfda.pharm_class_moa, 12),
			pharmClassCs: stringArray(openfda.pharm_class_cs, 12),
			pharmClassPe: stringArray(openfda.pharm_class_pe, 12),
		},
	};
}

function simpleModeAndTerm(query: string): { endpoint: string; mode: "drug-event" | "drug-label" | "drug-recall"; search: string; term: string } {
	const prefixed = query.match(/^(label|event|adverse|recall|enforcement)\s*:\s*(.+)$/i);
	const mode = prefixed?.[1]?.toLowerCase();
	const term = (prefixed?.[2] ?? query).trim();
	if (!term) throw new Error("openFDA search requires a drug name, label:<drug>, adverse:<drug>, recall:<drug>, or an application/count/stats/classes/generics query.");
	if (mode === "event" || mode === "adverse") {
		return { endpoint: "drug/event.json", mode: "drug-event", search: phrase("patient.drug.medicinalproduct", term), term };
	}
	if (mode === "recall" || mode === "enforcement") {
		return { endpoint: "drug/enforcement.json", mode: "drug-recall", search: phrase("product_description", term), term };
	}
	return { endpoint: "drug/label.json", mode: "drug-label", search: phrase("openfda.generic_name", term), term };
}

function applicationSearchClauses(values: Map<string, string>, bare: string[]): string[] {
	const clauses: string[] = [];
	const fieldMap: Array<[string[], string]> = [
		[["brand", "brand_name"], "products.brand_name"],
		[["generic", "generic_name"], "openfda.generic_name"],
		[["active_ingredient", "ingredient", "substance"], "products.active_ingredients.name"],
		[["sponsor", "sponsor_name"], "sponsor_name"],
		[["marketing_status", "status"], "products.marketing_status"],
		[["dosage_form", "form"], "products.dosage_form"],
		[["route"], "products.route"],
		[["application", "application_number", "app", "app_no"], "application_number"],
	];
	for (const [keys, fieldName] of fieldMap) {
		const value = pickValue(values, ...keys);
		if (value) clauses.push(phrase(fieldName, value));
	}
	const pharmClass = pickValue(values, "pharm_class", "class");
	if (pharmClass) {
		const rawClassType = pickValue(values, "pharm_class_type", "class_type")?.toLowerCase() ?? "epc";
		const classType = PHARM_CLASS_TYPES.has(rawClassType) ? rawClassType : "epc";
		clauses.push(phrase(`openfda.pharm_class_${classType}`, pharmClass));
	}
	const raw = pickValue(values, "raw", "raw_search", "search");
	if (raw) return [raw];
	const from = pickValue(values, "submission_date_from", "date_from", "from");
	const to = pickValue(values, "submission_date_to", "date_to", "to");
	if (from || to) clauses.push(`submissions.submission_status_date:[${from ? dateForOpenFda(from) : "19000101"} TO ${to ? dateForOpenFda(to) : "30000101"}]`);
	if (!clauses.length && bare.length) clauses.push(phrase("products.brand_name", bare.join(" ")));
	if (!clauses.length) throw new Error("Drugs@FDA application search requires brand=, generic=, active_ingredient=, sponsor=, route=, marketing_status=, application=, pharm_class=, raw=, or a bare brand.");
	return clauses;
}

function buildApplicationSearch(query: string): { mode: "application-details" | "application-search"; search: string } {
	const detail = query.match(/^(?:application|app|details)\s*:\s*((?:NDA|ANDA|BLA)\d{6})$/i);
	if (detail?.[1]) return { mode: "application-details", search: phrase("application_number", detail[1].toUpperCase()) };
	if (APPLICATION_NUMBER_RE.test(query)) return { mode: "application-details", search: phrase("application_number", query.toUpperCase()) };
	const normalized = query.replace(/^(?:applications?|drugsfda|sponsor)\s*:?\s*/i, "").trim();
	const { bare, values } = parseKeyValueQuery(normalized || query);
	return { mode: "application-search", search: applicationSearchClauses(values, bare).join(" AND ") };
}

function parseApplicationCountQuery(query: string): { countField: string; apiField: string; search?: string } {
	const normalized = query.replace(/^count\s*:?\s*/i, "").trim();
	const { bare, values } = parseKeyValueQuery(normalized);
	const requested = pickValue(values, "field", "count_field") ?? bare.shift() ?? "sponsor_name";
	const countField = requested.toLowerCase();
	const apiField = APPLICATION_COUNT_FIELDS[countField] ?? requested;
	const filterValues = new Map(values);
	filterValues.delete("field");
	filterValues.delete("count_field");
	const search = filterValues.size || bare.length ? applicationSearchClauses(filterValues, bare).join(" AND ") : undefined;
	return { apiField, countField, ...(search ? { search } : {}) };
}

function parseClassType(query: string): string {
	const normalized = query.replace(/^(?:classes|class|pharm-classes|pharmacologic-classes)\s*:?\s*/i, "").trim();
	const { bare, values } = parseKeyValueQuery(normalized);
	const raw = pickValue(values, "type", "class_type", "pharm_class_type") ?? bare[0] ?? "epc";
	const classType = raw.toLowerCase();
	if (!PHARM_CLASS_TYPES.has(classType)) throw new Error("openFDA pharmacologic classes require type epc, moa, cs, or pe.");
	return classType;
}

function genericEquivalentsBrand(query: string): string {
	const normalized = query.replace(/^(?:generics|generic-equivalents|equivalents)\s*:?\s*/i, "").trim();
	const { bare, values } = parseKeyValueQuery(normalized);
	const brand = pickValue(values, "brand", "brand_name") ?? bare.join(" ");
	if (!brand) throw new Error("openFDA generic equivalents require a brand name, for example generics:Advil.");
	return brand;
}

function labelSearchFromQuery(query: string): { search: string; mode: "drug-label" } {
	const normalized = query.replace(/^(?:labels?|spl)\s*:?\s*/i, "").trim();
	const { bare, values } = parseKeyValueQuery(normalized);
	const raw = pickValue(values, "raw", "raw_search", "search");
	if (raw) return { mode: "drug-label", search: raw };
	const exact = (pickValue(values, "exact") ?? "").toLowerCase();
	const suffix = ["1", "true", "yes"].includes(exact) ? ".exact" : "";
	const clauses: string[] = [];
	const fields: Array<[string[], string]> = [
		[["active_ingredient", "ingredient", "substance"], "openfda.substance_name"],
		[["generic", "generic_name"], "openfda.generic_name"],
		[["brand", "brand_name"], "openfda.brand_name"],
		[["route"], "openfda.route"],
		[["product_type", "type"], "openfda.product_type"],
		[["application", "application_number"], "openfda.application_number"],
	];
	for (const [keys, fieldName] of fields) {
		const value = pickValue(values, ...keys);
		if (value) clauses.push(phrase(`${fieldName}${suffix}`, value));
	}
	if (!clauses.length && bare.length) clauses.push(phrase("openfda.generic_name", bare.join(" ")));
	if (!clauses.length) throw new Error("openFDA label search requires a drug name or label filters.");
	return { mode: "drug-label", search: clauses.join(" AND ") };
}

function looksLikeApplicationQuery(query: string): boolean {
	if (/^(?:applications?|app|details|drugsfda|sponsor)\b/i.test(query)) return true;
	if (APPLICATION_NUMBER_RE.test(query)) return true;
	return /\b(?:brand|generic|active_ingredient|sponsor|marketing_status|dosage_form|route|application|pharm_class|submission_date_from|submission_date_to)=/i.test(query);
}

function modeForQuery(query: string): OpenFdaMode {
	if (/^count\b/i.test(query)) return "application-count";
	if (/^(?:stats|statistics)$/i.test(query)) return "statistics";
	if (/^(?:classes|class|pharm-classes|pharmacologic-classes)\b/i.test(query)) return "pharmacologic-classes";
	if (/^(?:generics|generic-equivalents|equivalents)\b/i.test(query)) return "generic-equivalents";
	if (/^(?:labels?|spl)\b/i.test(query)) return "drug-label";
	if (/^(?:event|adverse)\s*:/i.test(query)) return "drug-event";
	if (/^(?:recall|enforcement)\s*:/i.test(query)) return "drug-recall";
	if (looksLikeApplicationQuery(query)) return buildApplicationSearch(query).mode;
	return "drug-label";
}

async function searchSimpleOpenFda(query: string, limit: number, overrideSearch?: string): Promise<Record<string, unknown>> {
	const simple = overrideSearch
		? { endpoint: "drug/label.json", mode: "drug-label" as const, search: overrideSearch, term: query }
		: simpleModeAndTerm(query);
	const url = openFdaUrl(simple.endpoint, { limit, search: simple.search });
	const payload = await fetchOpenFdaJson(url);
	const rawResults = payload ? arrayValue(payload.results) : [];
	const results = rawResults.map((item) => {
		const record = recordValue(item);
		if (simple.mode === "drug-event") return normalizeOpenFdaEvent(record);
		if (simple.mode === "drug-recall") return normalizeOpenFdaRecall(record);
		return normalizeOpenFdaLabel(record);
	});
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "openfda",
		query,
		mode: simple.mode,
		search: simple.search,
		totalCount: payload ? totalCount(payload, results.length) : 0,
		returned: results.length,
		results,
		provenance: {
			docs: ["https://open.fda.gov/apis/", "https://open.fda.gov/apis/drug/label/"],
			endpoints: [url.toString()],
		},
	};
}

async function searchDrugApplications(query: string, limit: number): Promise<Record<string, unknown>> {
	const spec = buildApplicationSearch(query);
	const url = openFdaUrl("drug/drugsfda.json", {
		limit,
		search: spec.search,
		sort: "application_number:asc",
	});
	const payload = await fetchOpenFdaJson(url);
	const rawResults = payload ? arrayValue(payload.results) : [];
	const results = rawResults.map((item) => normalizeOpenFdaApplication(recordValue(item)));
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "openfda",
		query,
		mode: spec.mode,
		search: spec.search,
		found: spec.mode === "application-details" ? results.length > 0 : undefined,
		totalCount: payload ? totalCount(payload, results.length) : 0,
		returned: results.length,
		results,
		provenance: {
			docs: [
				"https://open.fda.gov/apis/drug/drugsfda/",
				"https://open.fda.gov/apis/drug/drugsfda/searchable-fields/",
				"https://open.fda.gov/apis/drug/drugsfda/understanding-the-api-results/",
			],
			endpoints: [url.toString()],
		},
	};
}

async function countDrugApplications(query: string, limit: number): Promise<Record<string, unknown>> {
	const parsed = parseApplicationCountQuery(query);
	const url = openFdaUrl("drug/drugsfda.json", {
		count: parsed.apiField,
		limit,
		search: parsed.search,
	});
	const payload = await fetchOpenFdaJson(url);
	const buckets = payload ? arrayValue(payload.results).map((item) => {
		const record = recordValue(item);
		return { term: stringValue(record.term), count: numberValue(record.count) ?? 0 };
	}) : [];
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "openfda",
		query,
		mode: "application-count",
		countField: parsed.countField,
		apiField: parsed.apiField,
		search: parsed.search,
		returned: buckets.length,
		bucketSum: buckets.reduce((sum, bucket) => sum + bucket.count, 0),
		results: buckets,
		provenance: {
			docs: ["https://open.fda.gov/apis/drug/drugsfda/understanding-the-api-results/"],
			endpoints: [url.toString()],
		},
	};
}

async function drugStatistics(query: string, limit: number): Promise<Record<string, unknown>> {
	const corpusUrl = openFdaUrl("drug/drugsfda.json", { limit: 1 });
	const statusUrl = openFdaUrl("drug/drugsfda.json", { count: APPLICATION_COUNT_FIELDS.marketing_status, limit });
	const routeUrl = openFdaUrl("drug/drugsfda.json", { count: APPLICATION_COUNT_FIELDS.route, limit });
	const sponsorUrl = openFdaUrl("drug/drugsfda.json", { count: APPLICATION_COUNT_FIELDS.sponsor_name, limit });
	const [corpus, status, route, sponsor] = await Promise.all([
		fetchOpenFdaJson(corpusUrl),
		fetchOpenFdaJson(statusUrl),
		fetchOpenFdaJson(routeUrl),
		fetchOpenFdaJson(sponsorUrl),
	]);
	const buckets = (payload: Record<string, unknown> | undefined) => payload ? arrayValue(payload.results).map((item) => {
		const record = recordValue(item);
		return { term: stringValue(record.term), count: numberValue(record.count) ?? 0 };
	}) : [];
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "openfda",
		query,
		mode: "statistics",
		totalApplications: corpus ? totalCount(corpus, 0) : 0,
		lastUpdated: stringValue(recordValue(corpus?.meta).last_updated),
		marketingStatus: buckets(status),
		routeTop: buckets(route),
		sponsorTop: buckets(sponsor),
		provenance: {
			docs: ["https://open.fda.gov/apis/drug/drugsfda/", "https://open.fda.gov/apis/drug/drugsfda/understanding-the-api-results/"],
			endpoints: [corpusUrl.toString(), statusUrl.toString(), routeUrl.toString(), sponsorUrl.toString()],
		},
	};
}

async function listPharmacologicClasses(query: string, limit: number): Promise<Record<string, unknown>> {
	const classType = parseClassType(query);
	const apiField = APPLICATION_COUNT_FIELDS[`pharm_class_${classType}`];
	const url = openFdaUrl("drug/drugsfda.json", { count: apiField, limit });
	const payload = await fetchOpenFdaJson(url);
	const classes = payload ? arrayValue(payload.results).map((item) => {
		const record = recordValue(item);
		return { term: stringValue(record.term), count: numberValue(record.count) ?? 0 };
	}) : [];
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "openfda",
		query,
		mode: "pharmacologic-classes",
		classType,
		returned: classes.length,
		results: classes,
		provenance: {
			docs: ["https://open.fda.gov/apis/openfda-fields/", "https://open.fda.gov/apis/drug/drugsfda/understanding-the-api-results/"],
			endpoints: [url.toString()],
		},
	};
}

function activeIngredientNames(application: Record<string, unknown>): string[] {
	const names = new Set<string>();
	for (const product of arrayValue(application.products)) {
		for (const ingredient of arrayValue(recordValue(product).activeIngredients)) {
			const name = stringValue(recordValue(ingredient).name);
			if (name) names.add(name);
		}
	}
	return [...names].sort();
}

function activeIngredientSets(application: Record<string, unknown>): string[][] {
	const sets = new Map<string, string[]>();
	for (const product of arrayValue(application.products)) {
		const names = arrayValue(recordValue(product).activeIngredients)
			.map((ingredient) => stringValue(recordValue(ingredient).name))
			.filter((name): name is string => Boolean(name))
			.sort();
		if (names.length) sets.set(names.join("\u0000"), names);
	}
	return [...sets.values()];
}

function hasActiveIngredientSet(application: Record<string, unknown>, names: string[]): boolean {
	const key = names.join("\u0000");
	return activeIngredientSets(application).some((candidate) => candidate.join("\u0000") === key);
}

async function genericEquivalents(query: string, limit: number): Promise<Record<string, unknown>> {
	const brand = genericEquivalentsBrand(query);
	const brandSearch = phrase("products.brand_name", brand);
	const referenceUrl = openFdaUrl("drug/drugsfda.json", { limit, search: brandSearch, sort: "application_number:asc" });
	const referencePayload = await fetchOpenFdaJson(referenceUrl);
	const references = referencePayload ? arrayValue(referencePayload.results).map((item) => normalizeOpenFdaApplication(recordValue(item))) : [];
	const ingredients = [...new Set(references.flatMap(activeIngredientNames))].sort();
	const ingredientSets = new Map<string, string[]>();
	for (const reference of references) {
		for (const names of activeIngredientSets(reference)) ingredientSets.set(names.join("\u0000"), names);
	}
	const endpoints = [referenceUrl.toString()];
	if (!ingredients.length) {
		return {
			schema: "feynman.scienceDatabaseSearch.v1",
			source: "openfda",
			query,
			mode: "generic-equivalents",
			brand,
			referenceApplications: references.map((record) => record.applicationNumber),
			activeIngredients: ingredients,
			activeIngredientSets: [],
			returned: 0,
			results: [],
			provenance: {
				docs: ["https://open.fda.gov/apis/drug/drugsfda/"],
				endpoints,
			},
		};
	}
	const equivalentsByApplication = new Map<string, Record<string, unknown>>();
	let candidateTotalCount = 0;
	for (const names of ingredientSets.values()) {
		const equivalentSearch = names.map((ingredient) => phrase("products.active_ingredients.name", ingredient)).join(" AND ");
		const equivalentUrl = openFdaUrl("drug/drugsfda.json", { limit, search: equivalentSearch, sort: "application_number:asc" });
		endpoints.push(equivalentUrl.toString());
		const equivalentPayload = await fetchOpenFdaJson(equivalentUrl);
		const candidates = equivalentPayload ? arrayValue(equivalentPayload.results).map((item) => normalizeOpenFdaApplication(recordValue(item))) : [];
		candidateTotalCount += equivalentPayload ? totalCount(equivalentPayload, candidates.length) : 0;
		for (const candidate of candidates) {
			if (!hasActiveIngredientSet(candidate, names)) continue;
			const applicationNumber = stringValue(candidate.applicationNumber);
			if (applicationNumber) equivalentsByApplication.set(applicationNumber, candidate);
		}
	}
	const equivalents = [...equivalentsByApplication.values()]
		.sort((left, right) => String(left.applicationNumber ?? "").localeCompare(String(right.applicationNumber ?? "")))
		.slice(0, limit);
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "openfda",
		query,
		mode: "generic-equivalents",
		brand,
		referenceApplications: references.map((record) => record.applicationNumber),
		activeIngredients: ingredients,
		activeIngredientSets: [...ingredientSets.values()],
		totalCount: candidateTotalCount,
		returned: equivalents.length,
		results: equivalents,
		provenance: {
			docs: ["https://open.fda.gov/apis/drug/drugsfda/", "https://open.fda.gov/apis/drug/drugsfda/searchable-fields/"],
			endpoints,
		},
	};
}

export async function searchOpenFda(params: SearchParams): Promise<Record<string, unknown>> {
	const query = cleanQuery(params.query);
	const limit = safeLimit(params.limit);
	const mode = modeForQuery(query);
	if (mode === "application-count") return countDrugApplications(query, limit);
	if (mode === "application-details" || mode === "application-search") return searchDrugApplications(query, limit);
	if (mode === "statistics") return drugStatistics(query, limit);
	if (mode === "pharmacologic-classes") return listPharmacologicClasses(query, limit);
	if (mode === "generic-equivalents") return genericEquivalents(query, limit);
	if (mode === "drug-label" && /^(?:labels?|spl)\b/i.test(query)) {
		const label = labelSearchFromQuery(query);
		return searchSimpleOpenFda(query, limit, label.search);
	}
	return searchSimpleOpenFda(query, limit);
}
