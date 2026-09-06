export const PI_SESSION_TAIL_PATCH_MARKER =
	"Feynman Pi 0.84.2 correctness patch: upstream #8345";
const PI_SESSION_TAIL_FUNCTION_START =
	"export function loadEntriesFromFile(filePath) {";
const PI_SESSION_TAIL_FUNCTION_END =
	"\n/**\n * Inspect a physical line while searching for the first parsed session entry.";
const PI_SESSION_TAIL_OWNERSHIP_BLOCK = `    const entries = [];
    let pending = "";
    const fd = openSync(resolvedFilePath, "r");
    try {
        const decoder = new StringDecoder("utf8");
        const buffer = Buffer.allocUnsafe(SESSION_READ_BUFFER_SIZE);`;
const PI_SESSION_TAIL_REPAIR_BLOCK = `    // Validate session header before repairing the file.
    if (entries.length === 0)
        return entries;
    const header = entries[0];
    if (header.type !== "session" || typeof header.id !== "string") {
        return [];
    }
    // ${PI_SESSION_TAIL_PATCH_MARKER}. Remove after the bundled Pi release includes commit 0b5ee5d8.
    if (pending) appendFileSync(resolvedFilePath, "\\n");
    return entries;`;

function countOccurrences(source, fragment) {
	return source.split(fragment).length - 1;
}

function replaceRequired(source, original, replacement, label) {
	if (countOccurrences(source, original) !== 1) {
		throw new Error(`Unsupported Pi 0.84.2 session tail repair layout: ${label}`);
	}
	return source.replace(original, replacement);
}

function extractLoadEntriesFromFile(source, surface) {
	const startIndex = source.indexOf(PI_SESSION_TAIL_FUNCTION_START);
	if (
		startIndex === -1 ||
		source.indexOf(
			PI_SESSION_TAIL_FUNCTION_START,
			startIndex + PI_SESSION_TAIL_FUNCTION_START.length,
		) !== -1
	) {
		throw new Error(
			`Incomplete Pi session tail repair ${surface}: expected one loadEntriesFromFile implementation`,
		);
	}
	const endIndex = source.indexOf(
		PI_SESSION_TAIL_FUNCTION_END,
		startIndex + PI_SESSION_TAIL_FUNCTION_START.length,
	);
	if (endIndex === -1) {
		throw new Error(
			`Incomplete Pi session tail repair ${surface}: missing loadEntriesFromFile boundary`,
		);
	}
	return source.slice(startIndex, endIndex);
}

export function assertPiSessionTailPatchedSource(
	source,
	surface = "Pi SessionManager",
) {
	if (countOccurrences(source, PI_SESSION_TAIL_PATCH_MARKER) !== 1) {
		throw new Error(
			`Incomplete Pi session tail repair ${surface}: expected one patch marker`,
		);
	}
	const functionSource = extractLoadEntriesFromFile(source, surface);
	for (const [fragment, expectedCount, label] of [
		[PI_SESSION_TAIL_OWNERSHIP_BLOCK, 1, "pending tail ownership"],
		['pending = "";', 1, "pending tail reset count"],
		["pending += decoder.end();", 1, "decoder finalization"],
		["const finalEntry = parseSessionEntryLine(pending);", 1, "final entry parse"],
		["finally {\n        closeSync(fd);\n    }", 1, "file close boundary"],
		[PI_SESSION_TAIL_REPAIR_BLOCK, 1, "validated append boundary"],
		["return entries;", 2, "entry return count"],
	]) {
		const actualCount = countOccurrences(functionSource, fragment);
		if (actualCount !== expectedCount) {
			throw new Error(
				`Incomplete Pi session tail repair ${surface}: expected ${expectedCount} ${label}, found ${actualCount}`,
			);
		}
	}
	const ordered = [
		PI_SESSION_TAIL_OWNERSHIP_BLOCK,
		"pending += decoder.end();",
		"const finalEntry = parseSessionEntryLine(pending);",
		"finally {\n        closeSync(fd);\n    }",
		PI_SESSION_TAIL_REPAIR_BLOCK,
	];
	let previousIndex = -1;
	for (const fragment of ordered) {
		const index = functionSource.indexOf(fragment, previousIndex + 1);
		if (index <= previousIndex) {
			throw new Error(
				`Incomplete Pi session tail repair ${surface}: invalid semantic order`,
			);
		}
		previousIndex = index;
	}
}

export function patchPiSessionTailSource(source) {
	if (source.includes(PI_SESSION_TAIL_PATCH_MARKER)) {
		assertPiSessionTailPatchedSource(source);
		return source;
	}
	const upstreamRepair = PI_SESSION_TAIL_REPAIR_BLOCK.replace(
		`    // ${PI_SESSION_TAIL_PATCH_MARKER}. Remove after the bundled Pi release includes commit 0b5ee5d8.\n    if (pending) appendFileSync`,
		"    if (pending)\n        appendFileSync",
	);
	if (source.includes(upstreamRepair)) {
		const annotated = replaceRequired(source, upstreamRepair, PI_SESSION_TAIL_REPAIR_BLOCK, "upstream tail repair");
		assertPiSessionTailPatchedSource(annotated);
		return annotated;
	}

	let patched = replaceRequired(
		source,
		`    const entries = [];
    const fd = openSync(resolvedFilePath, "r");`,
		`    const entries = [];
    let pending = "";
    const fd = openSync(resolvedFilePath, "r");`,
		"pending tail ownership",
	);
	patched = replaceRequired(
		patched,
		`        const decoder = new StringDecoder("utf8");
        const buffer = Buffer.allocUnsafe(SESSION_READ_BUFFER_SIZE);
        let pending = "";`,
		`        const decoder = new StringDecoder("utf8");
        const buffer = Buffer.allocUnsafe(SESSION_READ_BUFFER_SIZE);`,
		"pending tail scope",
	);
	patched = replaceRequired(
		patched,
		`    // Validate session header
    if (entries.length === 0)
        return entries;
    const header = entries[0];
    if (header.type !== "session" || typeof header.id !== "string") {
        return [];
    }
    return entries;`,
		`    // Validate session header before repairing the file.
    if (entries.length === 0)
        return entries;
    const header = entries[0];
    if (header.type !== "session" || typeof header.id !== "string") {
        return [];
    }
    // ${PI_SESSION_TAIL_PATCH_MARKER}. Remove after the bundled Pi release includes commit 0b5ee5d8.
    if (pending) appendFileSync(resolvedFilePath, "\\n");
    return entries;`,
		"unterminated tail repair",
	);
	assertPiSessionTailPatchedSource(patched);
	return patched;
}
