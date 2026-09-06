export const PI_STATE_FILE_PERMISSIONS_REQUIRED_VERSION = "0.85.1";
export const PI_STATE_FILE_PERMISSIONS_UPSTREAM_FIX =
	"https://github.com/earendil-works/pi/commit/c49906ec7778";
// Remove this forward patch after the first supported Pi release containing
// the upstream fix above.

const PATCH_MARKER =
	"// Feynman: preserve administrator-managed modes and ACLs on existing state files.";
const IMPORT_ANCHOR =
	'import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";';
const PATCHED_IMPORT =
	'import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";';
const WRITE_OPTIONS_ANCHOR =
	'const AUTH_FILE_WRITE_OPTIONS = { encoding: "utf-8", mode: 0o600 };';
const FORCED_MODE_ANCHOR = "chmodSync(this.authPath, 0o600);";
const FRESH_WRITE_ANCHOR =
	'writeFileSync(this.authPath, "{}", AUTH_FILE_WRITE_OPTIONS);';
const UPDATE_WRITE_ANCHOR =
	"writeFileSync(this.authPath, next, AUTH_FILE_WRITE_OPTIONS);";

function countOccurrences(source, marker) {
	return source.split(marker).length - 1;
}

function requireCount(source, marker, expected, label) {
	const actual = countOccurrences(source, marker);
	if (actual !== expected) {
		throw new Error(
			`Unsupported Pi ${PI_STATE_FILE_PERMISSIONS_REQUIRED_VERSION} auth storage ${label}: expected ${expected} occurrences of ${marker}, found ${actual}`,
		);
	}
}

export function assertPiStateFilePermissionsPatchSource(
	source,
	label = "auth-storage.js",
) {
	requireCount(source, PATCH_MARKER, 1, label);
	requireCount(source, PATCHED_IMPORT, 1, label);
	requireCount(source, WRITE_OPTIONS_ANCHOR, 1, label);
	requireCount(source, FORCED_MODE_ANCHOR, 0, label);
	requireCount(source, FRESH_WRITE_ANCHOR, 1, `${label} fresh private write`);
	requireCount(source, UPDATE_WRITE_ANCHOR, 2, `${label} managed updates`);
	if (source.includes("chmodSync")) {
		throw new Error(
			`Unsupported Pi ${PI_STATE_FILE_PERMISSIONS_REQUIRED_VERSION} auth storage ${label}: stale chmodSync remains`,
		);
	}
}

export function patchPiStateFilePermissionsSource(source) {
	if (source.includes(PATCH_MARKER)) {
		assertPiStateFilePermissionsPatchSource(source);
		return source;
	}
	// Upstream 0.85.1 now preserves modes on updates. Validate every original
	// write/import invariant after annotation; never reintroduce chmod.
	const upstream = "// The mode applies only on creation so administrator-managed modes and ACLs remain intact.";
	if (source.includes(upstream)) {
		requireCount(source, upstream, 1, "upstream mode policy");
		const patched = source.replace(upstream, PATCH_MARKER);
		assertPiStateFilePermissionsPatchSource(patched);
		return patched;
	}

	requireCount(source, IMPORT_ANCHOR, 1, "import layout");
	requireCount(source, WRITE_OPTIONS_ANCHOR, 1, "write options");
	requireCount(source, FORCED_MODE_ANCHOR, 3, "forced mode writes");

	const patched = source
		.replace(IMPORT_ANCHOR, PATCHED_IMPORT)
		.replace(WRITE_OPTIONS_ANCHOR, `${PATCH_MARKER}\n${WRITE_OPTIONS_ANCHOR}`)
		.replace(/^[ \t]*chmodSync\(this\.authPath, 0o600\);\r?\n/gm, "");

	assertPiStateFilePermissionsPatchSource(patched);
	return patched;
}
