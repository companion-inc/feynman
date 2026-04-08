/**
 * Patch pi-web-access to use Feynman's config paths instead of hardcoded ~/.pi/ paths.
 *
 * Fix for GitHub Issue #32: pi-web-access reads from ~/.pi/web-search.json but
 * Feynman expects config at ~/.feynman/web-search.json.
 *
 * This follows the same pattern as pi-subagents-patch.mjs.
 */

export const PI_WEB_ACCESS_PATCH_TARGETS = ["index.ts"];

/**
 * Helper function that resolves the web search config path.
 * Uses FEYNMAN_WEB_SEARCH_CONFIG when set.
 * Otherwise derives the config location from PI_CODING_AGENT_DIR
 * so custom agent directories map to sibling web-search.json files.
 * Falls back to ~/.pi/web-search.json when no agent dir is available.
 */
const RESOLVE_WEB_CONFIG_HELPER = [
	"function resolveWebSearchConfigPath(): string {",
	'	const configured = process.env.FEYNMAN_WEB_SEARCH_CONFIG?.trim();',
	'	if (configured) {',
	'		return configured.startsWith("~/") ? join(homedir(), configured.slice(2)) : configured;',
	"	}",
	'	const agentDir = process.env.PI_CODING_AGENT_DIR?.trim();',
	'	if (agentDir) {',
	'		const normalized = agentDir.startsWith("~/") ? join(homedir(), agentDir.slice(2)) : agentDir;',
	'		const trimmed = normalized.replace(/[\\\\/]+$/, "");',
	'		const lastForwardSlash = trimmed.lastIndexOf("/");',
	'		const lastBackSlash = trimmed.lastIndexOf("\\\\");',
	'		const lastSlash = Math.max(lastForwardSlash, lastBackSlash);',
	'		if (lastSlash > 0) {',
	'			return `${trimmed.slice(0, lastSlash + 1)}web-search.json`;',
	"		}",
	"	}",
	'	return join(homedir(), ".pi", "web-search.json");',
	"}",
	"",
	"function resolveWebSearchConfigDir(): string {",
	'	const configPath = resolveWebSearchConfigPath();',
	'	const lastForwardSlash = configPath.lastIndexOf("/");',
	'	const lastBackSlash = configPath.lastIndexOf("\\\\");',
	'	const lastSlash = Math.max(lastForwardSlash, lastBackSlash);',
	'	return lastSlash > 0 ? configPath.slice(0, lastSlash) : configPath;',
	"}",
].join("\n");

function injectResolveWebConfigHelper(source) {
	if (source.includes("function resolveWebSearchConfigPath(): string {")) {
		return source.replace(
			/function resolveWebSearchConfigPath\(\): string \{[\s\S]*?\n\}\n\nfunction resolveWebSearchConfigDir\(\): string \{[\s\S]*?\n\}/m,
			RESOLVE_WEB_CONFIG_HELPER,
		);
	}

	const lines = source.split("\n");
	let insertAt = 0;
	let importSeen = false;
	let importOpen = false;

	for (let index = 0; index < lines.length; index += 1) {
		const trimmed = lines[index].trim();
		if (!importSeen) {
			if (trimmed === "" || trimmed.startsWith("/**") || trimmed.startsWith("*") || trimmed.startsWith("*/")) {
				insertAt = index + 1;
				continue;
			}
			if (trimmed.startsWith("import ")) {
				importSeen = true;
				importOpen = !trimmed.endsWith(";");
				insertAt = index + 1;
				continue;
			}
			break;
		}

		if (trimmed.startsWith("import ")) {
			importOpen = !trimmed.endsWith(";");
			insertAt = index + 1;
			continue;
		}
		if (importOpen) {
			if (trimmed.endsWith(";")) importOpen = false;
			insertAt = index + 1;
			continue;
		}
		if (trimmed === "") {
			insertAt = index + 1;
			continue;
		}
		insertAt = index;
		break;
	}

	return [...lines.slice(0, insertAt), "", RESOLVE_WEB_CONFIG_HELPER, "", ...lines.slice(insertAt)].join("\n");
}

function replaceAll(source, from, to) {
	return source.split(from).join(to);
}

/**
 * Patch pi-web-access source code to use Feynman's config paths.
 *
 * @param {string} relativePath - The file path relative to pi-web-access root
 * @param {string} source - The source code content
 * @returns {string} The patched source code
 */
export function patchPiWebAccessSource(relativePath, source) {
	if (relativePath !== "index.ts") {
		return source;
	}

	let patched = source;

	// Replace the hardcoded config path constant
	patched = replaceAll(
		patched,
		'const WEB_SEARCH_CONFIG_PATH = join(homedir(), ".pi", "web-search.json");',
		"const WEB_SEARCH_CONFIG_PATH = resolveWebSearchConfigPath();",
	);

	// Replace the hardcoded directory in saveConfig
	patched = replaceAll(
		patched,
		'const dir = join(homedir(), ".pi");',
		"const dir = resolveWebSearchConfigDir();",
	);

	const shouldEnsureHelper =
		patched !== source || source.includes("function resolveWebSearchConfigPath(): string {");

	if (!shouldEnsureHelper) {
		return source;
	}

	return injectResolveWebConfigHelper(patched);
}
