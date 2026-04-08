import test from "node:test";
import assert from "node:assert/strict";

import { patchPiWebAccessSource, PI_WEB_ACCESS_PATCH_TARGETS } from "../scripts/lib/pi-web-access-patch.mjs";

test("PI_WEB_ACCESS_PATCH_TARGETS includes index.ts", () => {
	assert.ok(PI_WEB_ACCESS_PATCH_TARGETS.includes("index.ts"));
});

test("patchPiWebAccessSource rewrites WEB_SEARCH_CONFIG_PATH", () => {
	const input = [
		'import { platform, homedir } from "node:os";',
		'import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";',
		'import { join } from "node:path";',
		"",
		'const WEB_SEARCH_CONFIG_PATH = join(homedir(), ".pi", "web-search.json");',
		"",
	].join("\n");

	const patched = patchPiWebAccessSource("index.ts", input);

	// Should inject the helper function
	assert.match(patched, /function resolveWebSearchConfigPath\(\): string \{/);
	assert.match(patched, /process\.env\.FEYNMAN_WEB_SEARCH_CONFIG/);
	assert.match(patched, /PI_CODING_AGENT_DIR/);
	assert.ok(patched.includes('trimmed.lastIndexOf("\\\\")'));

	// Should replace the hardcoded path
	assert.ok(patched.includes("const WEB_SEARCH_CONFIG_PATH = resolveWebSearchConfigPath();"));
	assert.ok(!patched.includes('const WEB_SEARCH_CONFIG_PATH = join(homedir(), ".pi", "web-search.json");'));
});

test("patchPiWebAccessSource rewrites saveConfig directory", () => {
	const input = [
		'import { platform, homedir } from "node:os";',
		'import { join } from "node:path";',
		"",
		'const WEB_SEARCH_CONFIG_PATH = join(homedir(), ".pi", "web-search.json");',
		"",
		"function saveConfig(updates) {",
		'	const dir = join(homedir(), ".pi");',
		"	// rest of function",
		"}",
		"",
	].join("\n");

	const patched = patchPiWebAccessSource("index.ts", input);

	// Should inject the helper functions
	assert.match(patched, /function resolveWebSearchConfigDir\(\): string \{/);

	// Should replace the hardcoded directory
	assert.ok(patched.includes("const dir = resolveWebSearchConfigDir();"));
	assert.ok(!patched.includes('const dir = join(homedir(), ".pi");'));
});

test("patchPiWebAccessSource upgrades legacy helper implementation", () => {
	const input = [
		'import { join } from "node:path";',
		'import { homedir } from "node:os";',
		"",
		"function resolveWebSearchConfigPath(): string {",
		'	const configured = process.env.FEYNMAN_WEB_SEARCH_CONFIG?.trim();',
		"	if (configured) {",
		'		return configured.startsWith("~/") ? join(homedir(), configured.slice(2)) : configured;',
		"	}",
		'	const agentDir = process.env.PI_CODING_AGENT_DIR?.trim();',
		'	if (agentDir && agentDir.includes(".feynman")) {',
		'		return join(homedir(), ".feynman", "web-search.json");',
		"	}",
		'	return join(homedir(), ".pi", "web-search.json");',
		"}",
		"",
		"function resolveWebSearchConfigDir(): string {",
		'	const configPath = resolveWebSearchConfigPath();',
		'	const lastSlash = configPath.lastIndexOf("/");',
		'	return lastSlash > 0 ? configPath.slice(0, lastSlash) : configPath;',
		"}",
		"",
		"const WEB_SEARCH_CONFIG_PATH = resolveWebSearchConfigPath();",
		"",
	].join("\n");

	const patched = patchPiWebAccessSource("index.ts", input);

	assert.ok(patched.includes('const trimmed = normalized.replace(/[\\\\/]+$/, "");'));
	assert.ok(patched.includes('const lastBackSlash = trimmed.lastIndexOf("\\\\");'));
	assert.ok(!patched.includes('agentDir && agentDir.includes(".feynman")'));
});

test("patchPiWebAccessSource is idempotent", () => {
	const input = [
		'import { platform, homedir } from "node:os";',
		'import { join } from "node:path";',
		"",
		'const WEB_SEARCH_CONFIG_PATH = join(homedir(), ".pi", "web-search.json");',
		"",
		"function saveConfig(updates) {",
		'	const dir = join(homedir(), ".pi");',
		"}",
		"",
	].join("\n");

	const once = patchPiWebAccessSource("index.ts", input);
	const twice = patchPiWebAccessSource("index.ts", once);

	assert.equal(twice, once);
});

test("patchPiWebAccessSource ignores non-index.ts files", () => {
	const input = 'const x = join(homedir(), ".pi", "web-search.json");';

	const patched = patchPiWebAccessSource("other-file.ts", input);

	assert.equal(patched, input);
});

test("patchPiWebAccessSource returns unchanged source when no matches", () => {
	const input = [
		'import { join } from "node:path";',
		"",
		'const something = "different";',
		"",
	].join("\n");

	const patched = patchPiWebAccessSource("index.ts", input);

	assert.equal(patched, input);
});

test("injected helper uses FEYNMAN_WEB_SEARCH_CONFIG env var", () => {
	const input = [
		'import { join } from "node:path";',
		'import { homedir } from "node:os";',
		"",
		'const WEB_SEARCH_CONFIG_PATH = join(homedir(), ".pi", "web-search.json");',
		"",
	].join("\n");

	const patched = patchPiWebAccessSource("index.ts", input);

	// Should check for FEYNMAN_WEB_SEARCH_CONFIG first
	assert.match(patched, /process\.env\.FEYNMAN_WEB_SEARCH_CONFIG/);
	// Should fall back to PI_CODING_AGENT_DIR
	assert.match(patched, /process\.env\.PI_CODING_AGENT_DIR/);
	// Should derive config path from PI_CODING_AGENT_DIR and handle both slash styles
	assert.ok(patched.includes('normalized.replace(/[\\\\/]+$/, "")'));
	assert.match(patched, /lastForwardSlash/);
	assert.match(patched, /lastBackSlash/);
});
