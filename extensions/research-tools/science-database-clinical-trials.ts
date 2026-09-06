type SearchParams = {
	limit?: number;
	query: string;
	source: string;
};

type TrialMode = "details" | "eligibility" | "endpoints" | "investigators" | "search" | "sponsor";

const CLINICAL_TRIALS_BASE = "https://clinicaltrials.gov/api/v2";
const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;
const REQUEST_TIMEOUT_MS = 25_000;
const SEARCH_FIELDS = [
	"NCTId",
	"OfficialTitle",
	"BriefTitle",
	"OverallStatus",
	"Phase",
	"StudyType",
	"Condition",
	"InterventionName",
	"LeadSponsorName",
	"EnrollmentCount",
	"StartDate",
	"PrimaryCompletionDate",
	"LocationCity",
].join("|");
const INVESTIGATOR_FIELDS = [
	"NCTId",
	"BriefTitle",
	"Condition",
	"protocolSection.sponsorCollaboratorsModule.responsibleParty",
	"protocolSection.contactsLocationsModule.overallOfficials",
	"protocolSection.contactsLocationsModule.locations",
].join("|");
const ENDPOINT_FIELDS = "NCTId|protocolSection.outcomesModule";
const DETAILS_FIELDS = "protocolSection|hasResults";

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

function docs(): string[] {
	return [
		"https://clinicaltrials.gov/data-api/api",
		"https://clinicaltrials.gov/api/v2/version",
	];
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
			throw new Error(`ClinicalTrials.gov request failed: ${response.status} ${response.statusText}`);
		}
		return response.json();
	} finally {
		clearTimeout(timeout);
	}
}

function optionValue(query: string, key: string): string | undefined {
	const pattern = new RegExp(`(?:^|[\\s;])${key}=("[^"]+"|'[^']+'|[^\\s;]+)`, "i");
	const match = pattern.exec(query);
	const raw = match?.[1]?.trim();
	if (!raw) return undefined;
	return raw.replace(/^["']|["']$/g, "");
}

function splitEnumList(value: string | undefined): string[] {
	if (!value) return [];
	return value.split(/[|,]/).map((item) => item.trim().toUpperCase()).filter(Boolean);
}

function boolOption(query: string, key: string): boolean {
	const raw = optionValue(query, key);
	return /^(true|1|yes)$/i.test(raw ?? "");
}

function stripStructuredOptions(query: string): string {
	return query
		.replace(/\b(?:condition|cond|intervention|intr|status|phase|study_type|location|sponsor|advanced|page_token|count_total|keywords|eligibility_keywords|min_age|max_age|sex|institution|investigator|start_date_after)=("[^"]+"|'[^']+'|[^\s;]+)/gi, "")
		.replace(/^(?:details|trial|study|get|sponsor|eligibility|investigator|investigators|endpoints|analyze-endpoints)\s*:?\s*/i, "")
		.trim();
}

function normalizeNctId(value: string | undefined): string | undefined {
	const raw = value?.trim().toUpperCase().replace(/^(?:NCT)?(\d{8})$/, "NCT$1");
	return raw && /^NCT\d{8}$/.test(raw) ? raw : undefined;
}

function firstNctId(query: string): string | undefined {
	return normalizeNctId(query.match(/\b(?:NCT)?\d{8}\b/i)?.[0]);
}

function detectMode(query: string): TrialMode {
	if (/^(?:details|trial|study|get)\b/i.test(query) || (firstNctId(query) && !/\b(?:condition|cond|intervention|intr|status|phase|location|sponsor)=/i.test(query))) return "details";
	if (/^(?:endpoints|analyze-endpoints)\b/i.test(query)) return "endpoints";
	if (/^(?:eligibility)\b/i.test(query) || /\b(?:eligibility_keywords|min_age|max_age|sex)=/i.test(query)) return "eligibility";
	if (/^(?:investigator|investigators)\b/i.test(query) || /\b(?:investigator|institution)=/i.test(query)) return "investigators";
	if (/^(?:sponsor)\b/i.test(query) || /\bsponsor=/i.test(query)) return "sponsor";
	return "search";
}

function quoteEssie(value: string): string {
	return `"${value.replaceAll("\"", "\\\"")}"`;
}

function areaPhrase(area: string, value: string | undefined): string | undefined {
	return value ? `AREA[${area}]${quoteEssie(value)}` : undefined;
}

function orJoin(parts: Array<string | undefined>): string | undefined {
	const clean = parts.filter((part): part is string => Boolean(part));
	if (!clean.length) return undefined;
	return clean.length === 1 ? clean[0] : `(${clean.join(" OR ")})`;
}

function andJoin(parts: Array<string | undefined>): string | undefined {
	const clean = parts.filter((part): part is string => Boolean(part));
	if (!clean.length) return undefined;
	return clean.join(" AND ");
}

function ageValue(value: string | undefined): string | undefined {
	if (!value) return undefined;
	const clean = value.trim();
	if (!clean) return undefined;
	return /^\d+(?:\.\d+)?$/.test(clean) ? `${clean} years` : clean;
}

function phaseExpr(values: string[]): string | undefined {
	return orJoin(values.map((phase) => `AREA[Phase]${phase}`));
}

function addAdvanced(params: URLSearchParams, expr: string | undefined): void {
	if (!expr) return;
	const existing = params.get("filter.advanced");
	params.set("filter.advanced", existing ? `${existing} AND ${expr}` : expr);
}

function dateStruct(module: Record<string, unknown>, key: string): string | undefined {
	return stringValue(recordValue(module[key]).date);
}

function studyProtocol(study: unknown): Record<string, unknown> {
	return recordValue(recordValue(study).protocolSection);
}

function trialInterventions(protocol: Record<string, unknown>): string[] {
	return arrayValue(recordValue(protocol.armsInterventionsModule).interventions)
		.map((item) => stringValue(recordValue(item).name))
		.filter((name): name is string => Boolean(name))
		.slice(0, 12);
}

function trialLocations(protocol: Record<string, unknown>): string[] {
	return arrayValue(recordValue(protocol.contactsLocationsModule).locations)
		.map((item) => {
			const location = recordValue(item);
			return [stringValue(location.facility), stringValue(location.city), stringValue(location.country)]
				.filter(Boolean)
				.join(", ");
		})
		.filter(Boolean)
		.slice(0, 8);
}

function normalizeOutcome(item: unknown, type: string): Record<string, unknown> {
	const outcome = recordValue(item);
	return {
		measure: stringValue(outcome.measure),
		timeFrame: stringValue(outcome.timeFrame),
		description: stringValue(outcome.description),
		type,
	};
}

function normalizeOutcomes(module: Record<string, unknown>, key: string, type: string): Record<string, unknown>[] {
	return arrayValue(module[key]).map((item) => normalizeOutcome(item, type));
}

function normalizeTrialSummary(study: unknown): Record<string, unknown> | undefined {
	const protocol = studyProtocol(study);
	const identification = recordValue(protocol.identificationModule);
	const status = recordValue(protocol.statusModule);
	const conditions = recordValue(protocol.conditionsModule);
	const design = recordValue(protocol.designModule);
	const sponsor = recordValue(recordValue(protocol.sponsorCollaboratorsModule).leadSponsor);
	const nctId = stringValue(identification.nctId);
	if (!nctId) return undefined;
	return {
		nctId,
		title: stringValue(identification.officialTitle) ?? stringValue(identification.briefTitle),
		briefTitle: stringValue(identification.briefTitle),
		officialTitle: stringValue(identification.officialTitle),
		overallStatus: stringValue(status.overallStatus),
		phases: arrayValue(design.phases).map((item) => stringValue(item)).filter(Boolean),
		studyType: stringValue(design.studyType),
		conditions: arrayValue(conditions.conditions).map((item) => stringValue(item)).filter(Boolean),
		interventions: trialInterventions(protocol),
		sponsor: stringValue(sponsor.name),
		enrollment: numberValue(recordValue(design.enrollmentInfo).count),
		startDate: dateStruct(status, "startDateStruct"),
		primaryCompletionDate: dateStruct(status, "primaryCompletionDateStruct"),
		locations: trialLocations(protocol),
		url: `https://clinicaltrials.gov/study/${nctId}`,
	};
}

function normalizeTrialDetails(study: unknown): Record<string, unknown> | undefined {
	const protocol = studyProtocol(study);
	const summary = normalizeTrialSummary(study);
	if (!summary) return undefined;
	const identification = recordValue(protocol.identificationModule);
	const status = recordValue(protocol.statusModule);
	const design = recordValue(protocol.designModule);
	const description = recordValue(protocol.descriptionModule);
	const eligibility = recordValue(protocol.eligibilityModule);
	const sponsorModule = recordValue(protocol.sponsorCollaboratorsModule);
	const outcomes = recordValue(protocol.outcomesModule);
	const locations = arrayValue(recordValue(protocol.contactsLocationsModule).locations).map((item) => {
		const location = recordValue(item);
		return {
			facility: stringValue(location.facility),
			city: stringValue(location.city),
			state: stringValue(location.state),
			country: stringValue(location.country),
			zip: stringValue(location.zip),
			status: stringValue(location.status),
			contacts: arrayValue(location.contacts).map(recordValue),
		};
	});
	const healthyVolunteers = eligibility.healthyVolunteers;
	return {
		...summary,
		acronym: stringValue(identification.acronym),
		collaborators: arrayValue(sponsorModule.collaborators).map((item) => stringValue(recordValue(item).name)).filter(Boolean),
		completionDate: dateStruct(status, "completionDateStruct"),
		briefSummary: stringValue(description.briefSummary),
		detailedDescription: stringValue(description.detailedDescription),
		eligibilityCriteria: stringValue(eligibility.eligibilityCriteria),
		minimumAge: stringValue(eligibility.minimumAge),
		maximumAge: stringValue(eligibility.maximumAge),
		sex: stringValue(eligibility.sex),
		healthyVolunteers: healthyVolunteers === undefined ? undefined : Boolean(healthyVolunteers),
		primaryOutcomes: normalizeOutcomes(outcomes, "primaryOutcomes", "PRIMARY"),
		secondaryOutcomes: normalizeOutcomes(outcomes, "secondaryOutcomes", "SECONDARY"),
		otherOutcomes: normalizeOutcomes(outcomes, "otherOutcomes", "OTHER"),
		locations,
		hasResults: recordValue(study).hasResults === true,
	};
}

function buildSearchParams(query: string, limit: number, mode: TrialMode): URLSearchParams {
	const params = new URLSearchParams({ format: "json", pageSize: String(limit) });
	const searchText = stripStructuredOptions(query);
	const condition = optionValue(query, "condition") ?? optionValue(query, "cond");
	const intervention = optionValue(query, "intervention") ?? optionValue(query, "intr");
	const status = splitEnumList(optionValue(query, "status"));
	const phases = splitEnumList(optionValue(query, "phase"));
	const studyType = optionValue(query, "study_type")?.toUpperCase();
	const location = optionValue(query, "location");
	const sponsor = optionValue(query, "sponsor") ?? (mode === "sponsor" ? searchText : undefined);
	const advanced = optionValue(query, "advanced");
	const pageToken = optionValue(query, "page_token");
	if (condition) params.set("query.cond", condition);
	if (intervention) params.set("query.intr", intervention);
	if (status.length) params.set("filter.overallStatus", status.join("|"));
	if (location) params.set("query.locn", location);
	if (mode === "sponsor" && sponsor) addAdvanced(params, areaPhrase("LeadSponsorName", sponsor));
	else if (sponsor) params.set("query.spons", sponsor);
	if (phases.length) addAdvanced(params, phaseExpr(phases));
	if (studyType) addAdvanced(params, `AREA[StudyType]${studyType}`);
	if (advanced) addAdvanced(params, advanced);
	if (pageToken) params.set("pageToken", pageToken);
	if (boolOption(query, "count_total")) params.set("countTotal", "true");
	if (!condition && !intervention && !status.length && !location && !sponsor && !phases.length && !studyType && !advanced && searchText && mode === "search") {
		params.set("query.term", searchText);
	}
	params.set("fields", SEARCH_FIELDS);
	return params;
}

function buildEligibilityParams(query: string, limit: number): URLSearchParams {
	const params = new URLSearchParams({ format: "json", pageSize: String(limit), fields: SEARCH_FIELDS });
	const condition = optionValue(query, "condition") ?? optionValue(query, "cond");
	if (condition) params.set("query.cond", condition);
	const status = splitEnumList(optionValue(query, "status"));
	params.set("filter.overallStatus", (status.length ? status : ["RECRUITING"]).join("|"));
	const keywords = optionValue(query, "eligibility_keywords") ?? optionValue(query, "keywords") ?? stripStructuredOptions(query);
	const minAge = ageValue(optionValue(query, "min_age"));
	const maxAge = ageValue(optionValue(query, "max_age"));
	const sex = optionValue(query, "sex")?.toUpperCase();
	const parts = [
		areaPhrase("EligibilityCriteria", keywords || undefined),
		minAge ? `AREA[MinimumAge]RANGE[MIN,${minAge}]` : undefined,
		maxAge ? `AREA[MaximumAge]RANGE[${maxAge},MAX]` : undefined,
		sex === "MALE" || sex === "FEMALE" ? orJoin([`AREA[Sex]${sex}`, "AREA[Sex]ALL"]) : sex === "ALL" ? "AREA[Sex]ALL" : undefined,
	];
	const advanced = andJoin(parts);
	if (!advanced && !condition) throw new Error("clinicaltrials eligibility mode requires condition, eligibility_keywords, min_age, max_age, or sex.");
	addAdvanced(params, advanced);
	return params;
}

function buildInvestigatorParams(query: string, limit: number): URLSearchParams {
	const params = new URLSearchParams({ format: "json", pageSize: String(limit), fields: INVESTIGATOR_FIELDS });
	const name = optionValue(query, "investigator") ?? stripStructuredOptions(query);
	const institution = optionValue(query, "institution");
	const location = optionValue(query, "location");
	const condition = optionValue(query, "condition") ?? optionValue(query, "cond");
	const status = splitEnumList(optionValue(query, "status"));
	if (condition) params.set("query.cond", condition);
	if (status.length) params.set("filter.overallStatus", status.join("|"));
	if (location && !institution) params.set("query.locn", location);
	const nameExpr = name ? orJoin([areaPhrase("OverallOfficialName", name), areaPhrase("ResponsiblePartyInvestigatorFullName", name)]) : undefined;
	addAdvanced(params, andJoin([nameExpr, areaPhrase("LocationFacility", institution)]));
	if (!params.toString().includes("query.") && !params.has("filter.advanced") && !params.has("filter.overallStatus")) {
		throw new Error("clinicaltrials investigator mode requires investigator, institution, location, condition, or status.");
	}
	return params;
}

function buildEndpointParams(query: string, limit: number): URLSearchParams {
	const params = new URLSearchParams({ format: "json", pageSize: String(limit), fields: ENDPOINT_FIELDS });
	const condition = optionValue(query, "condition") ?? optionValue(query, "cond") ?? stripStructuredOptions(query);
	if (!condition) throw new Error("clinicaltrials endpoints mode requires an NCT ID or a condition.");
	params.set("query.cond", condition);
	const phases = splitEnumList(optionValue(query, "phase"));
	const startDateAfter = optionValue(query, "start_date_after");
	addAdvanced(params, andJoin([
		phaseExpr(phases),
		startDateAfter ? `AREA[StartDate]RANGE[${startDateAfter},MAX]` : undefined,
	]));
	return params;
}

async function fetchStudies(params: URLSearchParams): Promise<{ endpoint: string; payload: Record<string, unknown> }> {
	const url = new URL(`${CLINICAL_TRIALS_BASE}/studies`);
	url.search = params.toString();
	return { endpoint: url.toString(), payload: recordValue(await fetchJson(url)) };
}

async function fetchStudy(nctId: string, fields: string): Promise<{ endpoint: string; payload: Record<string, unknown> }> {
	const url = new URL(`${CLINICAL_TRIALS_BASE}/studies/${encodeURIComponent(nctId)}`);
	url.search = new URLSearchParams({ format: "json", fields }).toString();
	return { endpoint: url.toString(), payload: recordValue(await fetchJson(url)) };
}

function collectEndpoints(studies: unknown[]): Record<string, unknown> {
	const primaryEndpoints: Record<string, unknown>[] = [];
	const secondaryEndpoints: Record<string, unknown>[] = [];
	const otherEndpoints: Record<string, unknown>[] = [];
	const counts = new Map<string, number>();
	for (const study of studies) {
		const outcomes = recordValue(studyProtocol(study).outcomesModule);
		for (const [target, key, type] of [
			[primaryEndpoints, "primaryOutcomes", "PRIMARY"],
			[secondaryEndpoints, "secondaryOutcomes", "SECONDARY"],
			[otherEndpoints, "otherOutcomes", "OTHER"],
		] as const) {
			for (const raw of arrayValue(outcomes[key])) {
				const normalized = normalizeOutcome(raw, type);
				target.push(normalized);
				const measure = stringValue(recordValue(raw).measure);
				if (measure) counts.set(measure, (counts.get(measure) ?? 0) + 1);
			}
		}
	}
	return {
		primaryEndpoints,
		secondaryEndpoints,
		otherEndpoints,
		commonMeasures: [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([measure]) => measure),
	};
}

function normalizeInvestigators(studies: unknown[]): Record<string, unknown>[] {
	const results: Record<string, unknown>[] = [];
	const seen = new Set<string>();
	for (const study of studies) {
		const protocol = studyProtocol(study);
		const summary = normalizeTrialSummary(study);
		const condition = arrayValue(recordValue(protocol.conditionsModule).conditions).map((item) => stringValue(item)).find(Boolean);
		for (const officialItem of arrayValue(recordValue(protocol.contactsLocationsModule).overallOfficials)) {
			const official = recordValue(officialItem);
			const key = [official.name, official.role, official.affiliation, summary?.nctId].join("|");
			if (seen.has(key)) continue;
			seen.add(key);
			results.push({
				name: stringValue(official.name),
				role: stringValue(official.role),
				affiliation: stringValue(official.affiliation),
				nctId: summary?.nctId,
				studyTitle: summary?.briefTitle ?? summary?.title,
				condition,
				sourceField: "overallOfficials",
			});
		}
		const responsibleParty = recordValue(recordValue(protocol.sponsorCollaboratorsModule).responsibleParty);
		const responsibleName = stringValue(responsibleParty.investigatorFullName);
		if (responsibleName) {
			const key = [responsibleName, responsibleParty.investigatorTitle, responsibleParty.investigatorAffiliation, summary?.nctId].join("|");
			if (!seen.has(key)) {
				seen.add(key);
				results.push({
					name: responsibleName,
					role: stringValue(responsibleParty.investigatorTitle) ?? stringValue(responsibleParty.type),
					affiliation: stringValue(responsibleParty.investigatorAffiliation),
					nctId: summary?.nctId,
					studyTitle: summary?.briefTitle ?? summary?.title,
					condition,
					sourceField: "responsibleParty",
				});
			}
		}
		for (const locationItem of arrayValue(recordValue(protocol.contactsLocationsModule).locations)) {
			const location = recordValue(locationItem);
			for (const contactItem of arrayValue(location.contacts)) {
				const contact = recordValue(contactItem);
				const key = [contact.name, contact.role, summary?.nctId].join("|");
				if (seen.has(key)) continue;
				seen.add(key);
				results.push({
					name: stringValue(contact.name),
					role: stringValue(contact.role),
					affiliation: stringValue(location.facility),
					facility: stringValue(location.facility),
					location: stringValue(location.city),
						nctId: summary?.nctId,
						studyTitle: summary?.briefTitle ?? summary?.title,
						condition,
						sourceField: "locationContacts",
					});
				}
			}
	}
	return results;
}

async function trialDetails(query: string): Promise<Record<string, unknown>> {
	const nctId = firstNctId(query) ?? normalizeNctId(stripStructuredOptions(query));
	if (!nctId) throw new Error("clinicaltrials details mode requires an NCT ID.");
	const { endpoint, payload } = await fetchStudy(nctId, DETAILS_FIELDS);
	const result = normalizeTrialDetails(payload);
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "clinicaltrials",
		query,
		searchMode: "trial-details",
		returned: result ? 1 : 0,
		results: result ? [result] : [],
		provenance: { docs: docs(), endpoints: [endpoint] },
	};
}

async function endpointAnalysis(query: string, limit: number): Promise<Record<string, unknown>> {
	const nctId = firstNctId(query);
	let endpoint: string;
	let studies: unknown[];
	if (nctId) {
		const fetched = await fetchStudy(nctId, ENDPOINT_FIELDS);
		endpoint = fetched.endpoint;
		studies = [fetched.payload];
	} else {
		const fetched = await fetchStudies(buildEndpointParams(query, limit));
		endpoint = fetched.endpoint;
		studies = arrayValue(fetched.payload.studies);
	}
	const endpoints = collectEndpoints(studies);
	const result = {
		trialsAnalyzed: studies.length,
		nctId,
		condition: nctId ? undefined : optionValue(query, "condition") ?? optionValue(query, "cond") ?? stripStructuredOptions(query),
		...endpoints,
	};
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "clinicaltrials",
		query,
		searchMode: "endpoints",
		returned: 1,
		results: [result],
		provenance: { docs: docs(), endpoints: [endpoint] },
	};
}

export async function searchClinicalTrials(params: SearchParams): Promise<Record<string, unknown>> {
	const query = cleanQuery(params.query);
	const limit = safeLimit(params.limit);
	const mode = detectMode(query);
	if (mode === "details") return trialDetails(query);
	if (mode === "endpoints") return endpointAnalysis(query, limit);
	const searchParams = mode === "eligibility"
		? buildEligibilityParams(query, limit)
		: mode === "investigators"
			? buildInvestigatorParams(query, limit)
			: buildSearchParams(query, limit, mode);
	const { endpoint, payload } = await fetchStudies(searchParams);
	const studies = arrayValue(payload.studies);
	const results = mode === "investigators"
		? normalizeInvestigators(studies).slice(0, limit)
		: studies.flatMap((study) => {
			const result = normalizeTrialSummary(study);
			return result ? [result] : [];
		});
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "clinicaltrials",
		query,
		searchMode: mode === "search" ? "search-trials" : `search-by-${mode}`,
		totalCount: numberValue(payload.totalCount),
		returned: results.length,
		hasMore: Boolean(payload.nextPageToken),
		nextPageToken: stringValue(payload.nextPageToken),
		results,
		provenance: { docs: docs(), endpoints: [endpoint] },
	};
}
