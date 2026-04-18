const SECTION_ALIASES: Record<string, string[]> = {
	abstract: ["abstract", "summary", "overview"],
	introduction: ["introduction", "background", "motivation"],
	methodology: ["methodology", "methods", "approach", "method"],
	experiments: ["experiments", "experimental setup", "evaluation setup", "setup"],
	results: ["results", "findings", "performance"],
	discussion: ["discussion", "analysis", "interpretation"],
	limitations: ["limitations", "limit", "weaknesses"],
	conclusion: ["conclusion", "conclusions", "closing"],
};

type SectionMap = Record<string, unknown>;

function normalizeToken(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replace(/^[#\s]+/, "")
		.replace(/^[0-9]+(?:\.[0-9]+)*\s+/, "")
		.replace(/[^a-z\s]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function toRecord(value: unknown): Record<string, unknown> | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	return value as Record<string, unknown>;
}

function canonicalizeSection(value: string): string | undefined {
	const token = normalizeToken(value);
	if (!token) return undefined;
	for (const [section, aliases] of Object.entries(SECTION_ALIASES)) {
		if (aliases.includes(token)) return section;
	}
	return undefined;
}

function buildSectionList(section?: string, sections?: string[]): string[] {
	const tokens = [section, ...(sections ?? [])].filter((value): value is string => typeof value === "string");
	const unique = new Set<string>();
	for (const token of tokens) {
		const normalized = canonicalizeSection(token);
		if (normalized) unique.add(normalized);
	}
	return [...unique];
}

function pickObjectSections(content: unknown, requested: string[]): SectionMap {
	const selected: SectionMap = {};
	const record = toRecord(content);
	if (!record) return selected;

	const entries = Object.entries(record);
	for (const section of requested) {
		const aliases = SECTION_ALIASES[section] ?? [section];
		for (const [key, value] of entries) {
			if (aliases.includes(normalizeToken(key))) {
				selected[section] = value;
				break;
			}
		}
	}

	const nestedSections = toRecord(record.sections);
	if (nestedSections) {
		for (const section of requested) {
			if (section in selected) continue;
			const aliases = SECTION_ALIASES[section] ?? [section];
			for (const [key, value] of Object.entries(nestedSections)) {
				if (aliases.includes(normalizeToken(key))) {
					selected[section] = value;
					break;
				}
			}
		}
	}

	return selected;
}

function pickTextSections(content: string, requested: string[]): SectionMap {
	const selected: SectionMap = {};
	if (!requested.length) return selected;

	const lines = content.split(/\r?\n/);
	let activeSection: string | undefined;
	const buffers = new Map<string, string[]>();

	for (const line of lines) {
		const maybeSection = canonicalizeSection(line);
		if (maybeSection && requested.includes(maybeSection)) {
			activeSection = maybeSection;
			if (!buffers.has(maybeSection)) buffers.set(maybeSection, []);
			continue;
		}

		if (activeSection && /^\s*(?:#{1,6}\s*)?(?:[0-9]+(?:\.[0-9]+)*\s+)?[A-Za-z][A-Za-z\s\-/]{2,80}:?\s*$/.test(line)) {
			activeSection = undefined;
		}

		if (activeSection) {
			buffers.get(activeSection)?.push(line);
		}
	}

	for (const section of requested) {
		const body = (buffers.get(section) ?? []).join("\n").trim();
		if (body) selected[section] = body;
	}

	return selected;
}

export type ExtractPaperSectionsResult = {
	requested: string[];
	selected: SectionMap;
	missing: string[];
};

export function extractPaperSections(content: unknown, section?: string, sections?: string[]): ExtractPaperSectionsResult {
	const requested = buildSectionList(section, sections);
	if (!requested.length) {
		return { requested: [], selected: {}, missing: [] };
	}

	const selected = typeof content === "string" ? pickTextSections(content, requested) : pickObjectSections(content, requested);
	const missing = requested.filter((name) => !(name in selected));
	return { requested, selected, missing };
}
