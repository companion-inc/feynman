export type FindMode = "exact" | "case-insensitive" | "fuzzy";

const CONTEXT_CHARS = 400;
const MAX_OUTPUT_CHARS = 20_000;

interface Match {
	query: string;
	start: number;
	end: number;
}

interface Range {
	start: number;
	end: number;
	matches: Match[];
}

function normalize(value: string): string {
	return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase();
}

function editDistanceWithin(left: string, right: string, maximum: number): boolean {
	if (Math.abs(left.length - right.length) > maximum) return false;
	let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
	for (let i = 1; i <= left.length; i++) {
		const current = [i];
		let rowMinimum = i;
		for (let j = 1; j <= right.length; j++) {
			const value = Math.min(
				(previous[j] ?? 0) + 1,
				(current[j - 1] ?? 0) + 1,
				(previous[j - 1] ?? 0) + (left[i - 1] === right[j - 1] ? 0 : 1),
			);
			current[j] = value;
			rowMinimum = Math.min(rowMinimum, value);
		}
		if (rowMinimum > maximum) return false;
		previous = current;
	}
	return (previous[right.length] ?? maximum + 1) <= maximum;
}

function literalMatches(text: string, query: string, caseInsensitive: boolean): Match[] {
	const haystack = caseInsensitive ? text.toLocaleLowerCase() : text;
	const needle = caseInsensitive ? query.toLocaleLowerCase() : query;
	const matches: Match[] = [];
	for (let start = haystack.indexOf(needle); start >= 0; start = haystack.indexOf(needle, start + Math.max(needle.length, 1))) {
		matches.push({ query, start, end: start + query.length });
	}
	return matches;
}

function fuzzyMatches(text: string, query: string): Match[] {
	const queryTokens = normalize(query).match(/[\p{L}\p{N}]+/gu) ?? [];
	if (queryTokens.length === 0) return [];
	const matches: Match[] = [];
	const paragraphs = /[^\n]+(?:\n(?!\n)[^\n]+)*/g;
	for (const paragraph of text.matchAll(paragraphs)) {
		const paragraphText = paragraph[0];
		if (paragraphText.trim().length === 0 || paragraph.index === undefined) continue;
		const tokens = [...paragraphText.matchAll(/[\p{L}\p{N}]+/gu)];
		const matched = queryTokens.filter(queryToken => tokens.some(token => {
			const candidate = normalize(token[0]);
			const maximum = queryToken.length >= 9 ? 2 : queryToken.length >= 5 ? 1 : 0;
			return editDistanceWithin(queryToken, candidate, maximum);
		}));
		const required = queryTokens.length === 1 ? 1 : Math.ceil(queryTokens.length * 0.6);
		if (matched.length < required) continue;
		const first = tokens.find(token => matched.some(queryToken => {
			const maximum = queryToken.length >= 9 ? 2 : queryToken.length >= 5 ? 1 : 0;
			return editDistanceWithin(queryToken, normalize(token[0]), maximum);
		}));
		const start = paragraph.index + (first?.index ?? 0);
		matches.push({ query, start, end: start + (first?.[0].length ?? query.length) });
	}
	return matches;
}

function mergeRanges(textLength: number, matches: Match[]): Range[] {
	const ranges: Range[] = [];
	for (const match of [...matches].sort((left, right) => left.start - right.start)) {
		const start = Math.max(0, match.start - CONTEXT_CHARS);
		const end = Math.min(textLength, match.end + CONTEXT_CHARS);
		const previous = ranges.at(-1);
		if (previous && start <= previous.end) {
			previous.end = Math.max(previous.end, end);
			previous.matches.push(match);
		} else {
			ranges.push({ start, end, matches: [match] });
		}
	}
	return ranges;
}

export function findContent(
	text: string,
	queries: string[],
	mode: FindMode,
): { text: string; matchCount: number; returnedMatches: number; queryResults: Array<{ query: string; matchCount: number }> } {
	const normalizedQueries = [...new Set(queries.map(query => query.trim()).filter(Boolean))];
	const matches = normalizedQueries.flatMap(query => mode === "fuzzy"
		? fuzzyMatches(text, query)
		: literalMatches(text, query, mode === "case-insensitive"));
	const queryResults = normalizedQueries.map(query => ({
		query,
		matchCount: matches.filter(match => match.query === query).length,
	}));

	const heading = matches.length > 0 ? `Text matches (${mode})` : `Text matches (${mode}): no matches`;
	const sections = [heading];
	let formattedLength = heading.length;
	let returnedMatches = 0;
	for (const range of mergeRanges(text.length, matches)) {
		const prefix = range.start > 0 ? "…" : "";
		const suffix = range.end < text.length ? "…" : "";
		const snippet = `${prefix}${text.slice(range.start, range.end).replace(/\s+/g, " ").trim()}${suffix}`;
		const counts = [...new Set(range.matches.map(match => match.query))]
			.map(query => `\"${query}\" ×${range.matches.filter(match => match.query === query).length}`)
			.join(", ");
		const section = `${sections.length}. ${counts}\n${snippet}`;
		if (formattedLength + 2 + section.length > MAX_OUTPUT_CHARS) break;
		sections.push(section);
		formattedLength += 2 + section.length;
		returnedMatches += range.matches.length;
	}

	const missing = queryResults.filter(result => result.matchCount === 0).map(result => `\"${result.query}\"`);
	const footer = [
		...(missing.length > 0 ? [`No matches: ${missing.join(", ")}`] : []),
		...(returnedMatches < matches.length ? [`Showing ${returnedMatches} of ${matches.length} matches.`] : []),
	];
	for (const section of footer) {
		if (formattedLength + 2 + section.length > MAX_OUTPUT_CHARS) break;
		sections.push(section);
		formattedLength += 2 + section.length;
	}

	return { text: sections.join("\n\n"), matchCount: matches.length, returnedMatches, queryResults };
}
