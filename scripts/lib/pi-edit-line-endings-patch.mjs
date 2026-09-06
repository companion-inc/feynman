/**
 * Temporary Pi 0.84.2 edit-tool patch for:
 * https://github.com/earendil-works/pi/issues/8544
 *
 * Removal condition: delete this patch after a supported Pi release preserves
 * untouched mixed CRLF/LF line endings during exact and fuzzy edits.
 */
export const PI_EDIT_LINE_ENDINGS_REQUIRED_VERSION = "0.85.1";
export const PI_EDIT_LINE_ENDINGS_RUNTIME_TARGETS = Object.freeze([
	"dist/core/tools/edit-diff.js",
	"dist/core/tools/edit.js",
]);
export const PI_EDIT_LINE_ENDINGS_TYPE_TARGETS = Object.freeze([
	"dist/core/tools/edit-diff.d.ts",
]);
export const PI_EDIT_LINE_ENDINGS_PATCH_TARGETS = Object.freeze([
	...PI_EDIT_LINE_ENDINGS_RUNTIME_TARGETS,
	...PI_EDIT_LINE_ENDINGS_TYPE_TARGETS,
]);
export const PI_EDIT_LINE_ENDINGS_PATCH_MARKERS = Object.freeze({
	editDiff: "Feynman Pi 0.84.2 edit patch: preserve original line endings",
	editTypes: "Feynman Pi 0.84.2 edit patch: typed preserved line endings",
	edit: "Feynman Pi 0.84.2 edit patch: write preserved mixed line endings",
});

function countOccurrences(source, value) {
	return source.split(value).length - 1;
}

function replaceRequired(source, original, replacement, label) {
	const count = countOccurrences(source, original);
	if (count !== 1) {
		throw new Error(
			`Unsupported Pi ${PI_EDIT_LINE_ENDINGS_REQUIRED_VERSION} edit ${label} layout: expected 1 occurrence, found ${count}`,
		);
	}
	return source.replace(original, replacement);
}

export function assertPiEditLineEndingsVersion(version, surface) {
	if (version !== PI_EDIT_LINE_ENDINGS_REQUIRED_VERSION) {
		throw new Error(
			`Unsupported Pi edit line-ending patch ${surface}: expected ${PI_EDIT_LINE_ENDINGS_REQUIRED_VERSION}, found ${version ?? "missing"}`,
		);
	}
}

export function assertPiEditLineEndingsPatchSource(relativePath, source, surface = relativePath) {
	const marker = relativePath.endsWith("/edit-diff.d.ts")
		? PI_EDIT_LINE_ENDINGS_PATCH_MARKERS.editTypes
		: relativePath.endsWith("/edit-diff.js")
		? PI_EDIT_LINE_ENDINGS_PATCH_MARKERS.editDiff
		: relativePath.endsWith("/edit.js")
			? PI_EDIT_LINE_ENDINGS_PATCH_MARKERS.edit
			: undefined;
	if (!marker) {
		throw new Error(`Unknown Pi edit line-ending patch target: ${relativePath}`);
	}
	if (!source.includes(marker)) {
		throw new Error(`Incomplete Pi edit line-ending patch ${surface}: missing ${marker}`);
	}
	if (relativePath.endsWith("/edit-diff.d.ts")) {
		for (const fragment of [
			"writeContent: string;",
			"originalContent?: string",
		]) {
			if (!source.includes(fragment)) {
				throw new Error(`Incomplete Pi edit line-ending patch ${surface}: missing ${fragment}`);
			}
		}
	} else if (relativePath.endsWith("/edit-diff.js")) {
		for (const fragment of [
			"originalContent = normalizedContent",
			"function applyReplacementsWithOriginalLineEndings(content, replacements, offset, originalContent, fallbackEnding) {",
			"const fallbackEnding = originalContent.match",
			"function applyExactReplacementsToOriginalContent(originalContent, normalizedContent, replacements) {",
			"const normalizedToOriginal = [0];",
			"const writeContent = originalContent === normalizedContent",
			": usedFuzzyMatch",
			"applyReplacementsPreservingUnchangedLines(originalContent, replacementBaseContent, matchedEdits)",
			"return { baseContent, newContent, writeContent };",
		]) {
			if (!source.includes(fragment)) {
				throw new Error(`Incomplete Pi edit line-ending patch ${surface}: missing ${fragment}`);
			}
		}
	} else {
		for (const fragment of [
			"const { baseContent, newContent, writeContent } = applyEditsToNormalizedContent(normalizedContent, edits, path, content);",
			"const finalContent = bom + writeContent;",
		]) {
			if (!source.includes(fragment)) {
				throw new Error(`Incomplete Pi edit line-ending patch ${surface}: missing ${fragment}`);
			}
		}
	}
}

function patchEditDiffSource(source) {
	if (source.includes(PI_EDIT_LINE_ENDINGS_PATCH_MARKERS.editDiff)) {
		assertPiEditLineEndingsPatchSource("dist/core/tools/edit-diff.js", source);
		return source;
	}

	let patched = replaceRequired(
		source,
		`function splitLinesWithEndings(content) {
    return content.match(/[^\\n]*\\n|[^\\n]+/g) ?? [];
}`,
		`function splitLinesWithEndings(content) {
    return content.match(/[^\\r\\n]*(?:\\r\\n|\\r|\\n)|[^\\r\\n]+/g) ?? [];
}`,
		"line splitter",
	);
	patched = replaceRequired(
		patched,
		`        result += applyReplacements(baseContent.slice(groupStartOffset, groupEndOffset), group.replacements, groupStartOffset);`,
		`        const originalBlock = originalLines.slice(group.startLine, group.endLine).join("");
        result += applyReplacementsWithOriginalLineEndings(
            baseContent.slice(groupStartOffset, groupEndOffset),
            group.replacements,
            groupStartOffset,
            originalBlock,
            fallbackEnding,
        );`,
		"fuzzy replacement endings",
	);
	patched = replaceRequired(
		patched,
		`export function applyReplacementsPreservingUnchangedLines(originalContent, baseContent, replacements) {
    const originalLines = splitLinesWithEndings(originalContent);
    const baseLines = getLineSpans(baseContent);`,
		`export function applyReplacementsPreservingUnchangedLines(originalContent, baseContent, replacements) {
    const originalLines = splitLinesWithEndings(originalContent);
    const baseLines = getLineSpans(baseContent);
    const fallbackEnding = originalContent.match(/\\r\\n|\\r|\\n/)?.[0] ?? "\\n";`,
		"fuzzy fallback ending",
	);
	patched = replaceRequired(
		patched,
		`function applyReplacements(content, replacements, offset = 0) {
    let result = content;
    for (let i = replacements.length - 1; i >= 0; i--) {
        const replacement = replacements[i];
        const matchIndex = replacement.matchIndex - offset;
        result =
            result.substring(0, matchIndex) + replacement.newText + result.substring(matchIndex + replacement.matchLength);
    }
    return result;
}`,
		`function applyReplacements(content, replacements, offset = 0) {
    let result = content;
    for (let i = replacements.length - 1; i >= 0; i--) {
        const replacement = replacements[i];
        const matchIndex = replacement.matchIndex - offset;
        result =
            result.substring(0, matchIndex) + replacement.newText + result.substring(matchIndex + replacement.matchLength);
    }
    return result;
}
// ${PI_EDIT_LINE_ENDINGS_PATCH_MARKERS.editDiff}
function applyReplacementsWithOriginalLineEndings(content, replacements, offset, originalContent, fallbackEnding) {
    const originalEndings = originalContent.match(/\\r\\n|\\r|\\n/g) ?? [];
    const endingByOffset = new Map();
    let endingIndex = 0;
    for (let index = 0; index < content.length; index++) {
        if (content[index] !== "\\n") continue;
        endingByOffset.set(offset + index, originalEndings[endingIndex] ?? originalEndings.at(-1) ?? fallbackEnding);
        endingIndex += 1;
    }
    const restoreBaseSlice = (value, sliceOffset) =>
        value.replace(/\\n/g, (_match, matchOffset) =>
            endingByOffset.get(offset + sliceOffset + matchOffset) ?? fallbackEnding);
    let cursor = 0;
    let result = "";
    for (const replacement of [...replacements].sort((left, right) => left.matchIndex - right.matchIndex)) {
        const replacementStart = replacement.matchIndex - offset;
        const replacementEnd = replacementStart + replacement.matchLength;
        result += restoreBaseSlice(content.slice(cursor, replacementStart), cursor);
        const replacedEndings = [...endingByOffset]
            .filter(([endingOffset]) =>
                endingOffset >= replacement.matchIndex &&
                endingOffset < replacement.matchIndex + replacement.matchLength)
            .map(([, ending]) => ending);
        let replacementEndingIndex = 0;
        result += replacement.newText.replace(/\\n/g, () => {
            const ending = replacedEndings[replacementEndingIndex] ?? replacedEndings.at(-1) ?? fallbackEnding;
            replacementEndingIndex += 1;
            return ending;
        });
        cursor = replacementEnd;
    }
    result += restoreBaseSlice(content.slice(cursor), cursor);
    return result;
}
function applyExactReplacementsToOriginalContent(originalContent, normalizedContent, replacements) {
    let rebuiltNormalized = "";
    const normalizedToOriginal = [0];
    for (let originalOffset = 0; originalOffset < originalContent.length;) {
        if (originalContent.startsWith("\\r\\n", originalOffset)) {
            rebuiltNormalized += "\\n";
            originalOffset += 2;
        }
        else if (originalContent[originalOffset] === "\\r") {
            rebuiltNormalized += "\\n";
            originalOffset += 1;
        }
        else {
            rebuiltNormalized += originalContent[originalOffset];
            originalOffset += 1;
        }
        normalizedToOriginal.push(originalOffset);
    }
    if (rebuiltNormalized !== normalizedContent) {
        throw new Error("Cannot preserve original line endings because normalized content changed unexpectedly.");
    }
    const fallbackEnding = originalContent.match(/\\r\\n|\\r|\\n/)?.[0] ?? "\\n";
    let result = originalContent;
    for (let index = replacements.length - 1; index >= 0; index--) {
        const replacement = replacements[index];
        const originalStart = normalizedToOriginal[replacement.matchIndex];
        const originalEnd = normalizedToOriginal[replacement.matchIndex + replacement.matchLength];
        if (originalStart === undefined || originalEnd === undefined) {
            throw new Error("Replacement range is outside the original content.");
        }
        const replacedEndings = originalContent.slice(originalStart, originalEnd).match(/\\r\\n|\\r|\\n/g) ?? [];
        let endingIndex = 0;
        const replacementText = replacement.newText.replace(/\\n/g, () => {
            const ending = replacedEndings[endingIndex] ?? replacedEndings.at(-1) ?? fallbackEnding;
            endingIndex += 1;
            return ending;
        });
        result = result.slice(0, originalStart) + replacementText + result.slice(originalEnd);
    }
    return result;
}`,
		"exact replacement helper",
	);
	patched = replaceRequired(
		patched,
		"export function applyEditsToNormalizedContent(normalizedContent, edits, path) {",
		"export function applyEditsToNormalizedContent(normalizedContent, edits, path, originalContent = normalizedContent) {",
		"function signature",
	);
	patched = replaceRequired(
		patched,
		`    if (baseContent === newContent) {
        throw getNoChangeError(path, normalizedEdits.length);
    }
    return { baseContent, newContent };`,
		`    if (baseContent === newContent) {
        throw getNoChangeError(path, normalizedEdits.length);
    }
    const writeContent = originalContent === normalizedContent
        ? newContent
        : usedFuzzyMatch
            ? applyReplacementsPreservingUnchangedLines(originalContent, replacementBaseContent, matchedEdits)
            : applyExactReplacementsToOriginalContent(originalContent, normalizedContent, matchedEdits);
    return { baseContent, newContent, writeContent };`,
		"write content result",
	);
	assertPiEditLineEndingsPatchSource("dist/core/tools/edit-diff.js", patched);
	return patched;
}

function patchEditDiffTypesSource(source) {
	if (source.includes(PI_EDIT_LINE_ENDINGS_PATCH_MARKERS.editTypes)) {
		assertPiEditLineEndingsPatchSource("dist/core/tools/edit-diff.d.ts", source);
		return source;
	}

	let patched = replaceRequired(
		source,
		`export interface AppliedEditsResult {
    baseContent: string;
    newContent: string;
}`,
		`/** ${PI_EDIT_LINE_ENDINGS_PATCH_MARKERS.editTypes} */
export interface AppliedEditsResult {
    baseContent: string;
    newContent: string;
    writeContent: string;
}`,
		"result type",
	);
	patched = replaceRequired(
		patched,
		"export declare function applyEditsToNormalizedContent(normalizedContent: string, edits: Edit[], path: string): AppliedEditsResult;",
		"export declare function applyEditsToNormalizedContent(normalizedContent: string, edits: Edit[], path: string, originalContent?: string): AppliedEditsResult;",
		"function declaration",
	);
	assertPiEditLineEndingsPatchSource("dist/core/tools/edit-diff.d.ts", patched);
	return patched;
}

function patchEditSource(source) {
	if (source.includes(PI_EDIT_LINE_ENDINGS_PATCH_MARKERS.edit)) {
		assertPiEditLineEndingsPatchSource("dist/core/tools/edit.js", source);
		return source;
	}

	let patched = replaceRequired(
		source,
		`                const originalEnding = detectLineEnding(content);
                const normalizedContent = normalizeToLF(content);
                const { baseContent, newContent } = applyEditsToNormalizedContent(normalizedContent, edits, path);`,
		`                // ${PI_EDIT_LINE_ENDINGS_PATCH_MARKERS.edit}
                const normalizedContent = normalizeToLF(content);
                const { baseContent, newContent, writeContent } = applyEditsToNormalizedContent(normalizedContent, edits, path, content);`,
		"edit application",
	);
	patched = replaceRequired(
		patched,
		"                const finalContent = bom + restoreLineEndings(newContent, originalEnding);",
		"                const finalContent = bom + writeContent;",
		"final write",
	);
	assertPiEditLineEndingsPatchSource("dist/core/tools/edit.js", patched);
	return patched;
}

export function patchPiEditLineEndingsSource(relativePath, source) {
	if (relativePath.endsWith("/edit-diff.d.ts")) return patchEditDiffTypesSource(source);
	if (relativePath.endsWith("/edit-diff.js")) return patchEditDiffSource(source);
	if (relativePath.endsWith("/edit.js")) return patchEditSource(source);
	return source;
}
