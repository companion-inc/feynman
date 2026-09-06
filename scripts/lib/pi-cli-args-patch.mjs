import {
	cpSync,
	existsSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	readlinkSync,
	symlinkSync,
	unlinkSync,
} from "node:fs";
import { dirname, relative, resolve } from "node:path";

export const PI_CLI_ARGS_REQUIRED_VERSION = "0.85.1";
export const PI_CLI_ARGS_UPSTREAM_FIX =
	"https://github.com/earendil-works/pi/commit/74786a748f5314cc2127ebbcfa2d732e9b8433f5";
export const PI_CLI_ARGS_UPSTREAM_DOCS =
	"https://github.com/earendil-works/pi/commit/62bcbf6be0206cc4fd2ca0e35dd5eb879ca6c8e7";
// Remove this forward patch after the first supported Pi release containing
// the upstream parser fix above.

const PATCH_MARKER =
	"        // Feynman: support Pi's -- end-of-options delimiter for research prompts.";
const UNPATCHED_ANCHOR =
	'        if (arg === "--help" || arg === "-h") {';
const PATCHED_ANCHOR =
	'        else if (arg === "--help" || arg === "-h") {';
const PARSE_ARGS_DECLARATION = "export function parseArgs(args) {";
const LOOP_PREFIX = `    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
`;
const PATCH_BRANCH = `${PATCH_MARKER}
        if (arg === "--") {
            for (const positionalArg of args.slice(i + 1)) {
                if (positionalArg.startsWith("@")) {
                    result.fileArgs.push(positionalArg.slice(1));
                }
                else {
                    result.messages.push(positionalArg);
                }
            }
            break;
        }
${PATCHED_ANCHOR}`;

export const LEGACY_PI_RUNTIME_PACKAGE_ALIASES = Object.freeze({
	"@mariozechner/pi-agent-core": "@earendil-works/pi-agent-core",
	"@mariozechner/pi-ai": "@earendil-works/pi-ai",
	"@mariozechner/pi-coding-agent": "@earendil-works/pi-coding-agent",
	"@mariozechner/pi-tui": "@earendil-works/pi-tui",
});

function readPackageManifestSource(packageRoot) {
	try {
		return readFileSync(resolve(packageRoot, "package.json"), "utf8");
	} catch {
		return undefined;
	}
}

function lstatIfPresent(path) {
	try {
		return lstatSync(path);
	} catch {
		return undefined;
	}
}

export function ensureLegacyPiRuntimeAliases(nodeModulesRoot) {
	let repaired = 0;
	for (const [legacyName, currentName] of Object.entries(
		LEGACY_PI_RUNTIME_PACKAGE_ALIASES,
	)) {
		const currentPath = resolve(nodeModulesRoot, currentName);
		const currentManifest = readPackageManifestSource(currentPath);
		if (currentManifest === undefined) continue;

		const legacyPath = resolve(nodeModulesRoot, legacyName);
		if (readPackageManifestSource(legacyPath) === currentManifest) continue;

		const existingStat = lstatIfPresent(legacyPath);
		if (existingStat) {
			if (!existingStat.isSymbolicLink()) {
				throw new Error(
					`Refusing to replace an unexpected legacy Pi runtime package at ${legacyPath}`,
				);
			}
			if (
				resolve(dirname(legacyPath), readlinkSync(legacyPath)) !==
				currentPath
			) {
				throw new Error(
					`Refusing to replace a legacy Pi runtime alias with an unexpected target: ${legacyPath}`,
				);
			}
			unlinkSync(legacyPath);
		}
		mkdirSync(dirname(legacyPath), { recursive: true });
		try {
			// A relative directory symlink remains valid when the transactionally
			// staged runtime is renamed into place. In particular, do not create
			// an absolute Windows junction that still targets the staging path.
			symlinkSync(
				relative(dirname(legacyPath), currentPath),
				legacyPath,
				"dir",
			);
		} catch {
			if (lstatIfPresent(legacyPath)?.isSymbolicLink()) {
				unlinkSync(legacyPath);
			}
			cpSync(currentPath, legacyPath, { recursive: true });
		}
		if (readPackageManifestSource(legacyPath) !== currentManifest) {
			throw new Error(
				`Feynman could not create the legacy Pi runtime alias ${legacyName}`,
			);
		}
		repaired += 1;
	}
	return repaired;
}

function countOccurrences(source, value) {
	return source.split(value).length - 1;
}

function requireCount(source, value, expected, label) {
	const actual = countOccurrences(source, value);
	if (actual !== expected) {
		throw new Error(
			`Unsupported Pi ${PI_CLI_ARGS_REQUIRED_VERSION} CLI args ${label}: expected ${expected} occurrences, found ${actual}`,
		);
	}
}

function createExecutableCodeMask(source) {
	const mask = new Uint8Array(source.length);
	let state = "code";
	for (let index = 0; index < source.length; index += 1) {
		const char = source[index];
		const next = source[index + 1];
		if (state === "code") {
			if (char === "/" && next === "/") {
				state = "line-comment";
				index += 1;
			} else if (char === "/" && next === "*") {
				state = "block-comment";
				index += 1;
			} else if (char === "'") {
				state = "single-quote";
			} else if (char === '"') {
				state = "double-quote";
			} else if (char === "`") {
				state = "template";
			} else {
				mask[index] = 1;
			}
		} else if (state === "line-comment") {
			if (char === "\n") {
				state = "code";
				mask[index] = 1;
			}
		} else if (state === "block-comment") {
			if (char === "*" && next === "/") {
				state = "code";
				index += 1;
			}
		} else if (char === "\\") {
			index += 1;
		} else if (
			(state === "single-quote" && char === "'")
			|| (state === "double-quote" && char === '"')
			|| (state === "template" && char === "`")
		) {
			state = "code";
		}
	}
	return mask;
}

function findParseArgsRange(source, executableCodeMask, label) {
	requireCount(
		source,
		PARSE_ARGS_DECLARATION,
		1,
		`${label} parseArgs declaration`,
	);
	const declarationIndex = source.indexOf(PARSE_ARGS_DECLARATION);
	if (executableCodeMask[declarationIndex] !== 1) {
		throw new Error(
			`Unsupported Pi ${PI_CLI_ARGS_REQUIRED_VERSION} CLI args ${label}: parseArgs declaration is not executable`,
		);
	}
	const openBraceIndex =
		declarationIndex + PARSE_ARGS_DECLARATION.length - 1;
	let depth = 0;
	for (let index = openBraceIndex; index < source.length; index += 1) {
		if (executableCodeMask[index] !== 1) continue;
		if (source[index] === "{") {
			depth += 1;
		} else if (source[index] === "}") {
			depth -= 1;
			if (depth === 0) {
				return {
					start: declarationIndex,
					end: index + 1,
				};
			}
		}
	}
	throw new Error(
		`Unsupported Pi ${PI_CLI_ARGS_REQUIRED_VERSION} CLI args ${label}: parseArgs body is incomplete`,
	);
}

export function assertPiCliArgsVersion(
	version,
	label = "pi-coding-agent",
) {
	if (version !== PI_CLI_ARGS_REQUIRED_VERSION) {
		throw new Error(
			`Pi CLI args patch requires ${PI_CLI_ARGS_REQUIRED_VERSION} for ${label}, found ${version ?? "missing"}`,
		);
	}
}

export function assertPiCliArgsPatchSource(source, label = "dist/cli/args.js") {
	const executableCodeMask = createExecutableCodeMask(source);
	const parseArgsRange = findParseArgsRange(
		source,
		executableCodeMask,
		label,
	);
	const parseArgsSource = source.slice(parseArgsRange.start, parseArgsRange.end);
	requireCount(source, PATCH_MARKER, 1, `${label} patch marker`);
	requireCount(source, PATCH_BRANCH, 1, `${label} exact ordered patch block`);
	requireCount(
		parseArgsSource,
		`${LOOP_PREFIX}${PATCH_BRANCH}`,
		1,
		`${label} exact parseArgs loop`,
	);
	requireCount(source, UNPATCHED_ANCHOR, 0, `${label} unpatched branch`);
	requireCount(source, PATCHED_ANCHOR, 1, `${label} patched help branch`);
	requireCount(
		source,
		'        if (arg === "--") {',
		1,
		`${label} delimiter branch`,
	);
	requireCount(
		source,
		"            for (const positionalArg of args.slice(i + 1)) {",
		1,
		`${label} remaining-argument loop`,
	);
	requireCount(
		source,
		'                if (positionalArg.startsWith("@")) {',
		1,
		`${label} file argument branch`,
	);
	requireCount(
		source,
		"                    result.fileArgs.push(positionalArg.slice(1));",
		1,
		`${label} file argument write`,
	);
	requireCount(
		source,
		"                    result.messages.push(positionalArg);",
		1,
		`${label} message write`,
	);
	const patchBranchIndex = source.indexOf(PATCH_BRANCH);
	const delimiterBranchIndex =
		patchBranchIndex + PATCH_BRANCH.indexOf('        if (arg === "--") {');
	if (
		delimiterBranchIndex < parseArgsRange.start
		|| delimiterBranchIndex >= parseArgsRange.end
		|| executableCodeMask[delimiterBranchIndex] !== 1
	) {
		throw new Error(
			`Unsupported Pi ${PI_CLI_ARGS_REQUIRED_VERSION} CLI args ${label}: delimiter branch is not executable inside parseArgs`,
		);
	}
}

export function patchPiCliArgsSource(source) {
	if (source.includes(PATCH_MARKER)) {
		assertPiCliArgsPatchSource(source);
		return source;
	}
	// 0.85.1 ships the identical delimiter branch. Annotate, then apply the
	// same executable-range/count validator instead of inserting it twice.
	const upstreamBranch = PATCH_BRANCH.replace(`${PATCH_MARKER}\n`, "");
	if (source.includes(upstreamBranch)) {
		const patched = source.replace(upstreamBranch, PATCH_BRANCH);
		assertPiCliArgsPatchSource(patched);
		return patched;
	}

	requireCount(source, UNPATCHED_ANCHOR, 1, "unpatched help branch");
	requireCount(source, PATCHED_ANCHOR, 0, "unexpected patched help branch");
	requireCount(source, '        if (arg === "--") {', 0, "unexpected delimiter branch");

	const patched = source.replace(UNPATCHED_ANCHOR, PATCH_BRANCH);
	assertPiCliArgsPatchSource(patched);
	return patched;
}

function readPiCliArgsPackageRoot(packageRoot, label) {
	const manifestPath = resolve(packageRoot, "package.json");
	const argsPath = resolve(packageRoot, "dist", "cli", "args.js");
	if (!existsSync(manifestPath) || !existsSync(argsPath)) {
		throw new Error(`Pi CLI args package is incomplete for ${label}: ${packageRoot}`);
	}
	assertPiCliArgsVersion(
		JSON.parse(readFileSync(manifestPath, "utf8")).version,
		label,
	);
	return { argsPath, source: readFileSync(argsPath, "utf8") };
}

export function preflightPiCliArgsPackageRoot(packageRoot, label) {
	if (!packageRoot || !existsSync(packageRoot)) return;
	const { source } = readPiCliArgsPackageRoot(packageRoot, label);
	patchPiCliArgsSource(source);
}

export function assertPatchedPiCliArgsPackageRoot(packageRoot, label) {
	const { argsPath, source } = readPiCliArgsPackageRoot(packageRoot, label);
	assertPiCliArgsPatchSource(source, `${label} ${argsPath}`);
}
