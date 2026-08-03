import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

import {
	assertPiCodingAgentUndiciShrinkwrapSource,
	FEYNMAN_UNDICI_VERSION,
} from "./lib/pi-undici-proxy-patch.mjs";
import { assertPiLlamaUsagePatchSource } from "./lib/pi-llama-usage-patch.mjs";
import {
	assertPiRuntimeCorrectnessPatchSource,
	PI_RUNTIME_CORRECTNESS_REQUIRED_VERSION,
} from "./lib/pi-runtime-correctness-patch.mjs";
import {
	computeFileSha256,
	computeRuntimeArchiveTreeHash,
	computeRuntimeInputHash,
	parseExactRuntimePackageSpec,
	readArchiveEntry,
	verifyFileSha256,
} from "./lib/runtime-workspace-integrity.mjs";

const packageRoot = resolve(process.argv[2] ?? resolve(import.meta.dirname, ".."));
const packageRequire = createRequire(resolve(packageRoot, "package.json"));
const FEYNMAN_BRACE_EXPANSION_VERSION = "5.0.9";
const PI_INTERACTIVE_UPDATE_NOTICE_MARKER = "// Feynman: package update notices use the full update command.";
const PI_INTERACTIVE_UPDATE_NOTICE_ACTION = 'const action = theme.fg("accent", `${APP_NAME} update`);';
const PI_INTERACTIVE_UPDATE_NOTICE_OLD_ANCHOR = `showPackageUpdateNotification(packages) {
        const action = theme.fg("accent", \`\${APP_NAME} update --extensions\`);`;

function fail(message) {
	throw new Error(`[feynman artifact] ${message}`);
}

function readJson(path, label) {
	if (!existsSync(path)) fail(`${label} is missing`);
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch {
		fail(`${label} is not valid JSON`);
	}
}

function readText(path, label) {
	if (!existsSync(path)) fail(`${label} is missing`);
	return readFileSync(path, "utf8");
}

function requireMarkers(source, label, markers) {
	for (const marker of markers) {
		if (!source.includes(marker)) {
			fail(`${label} is missing required marker: ${marker}`);
		}
	}
}

function assertPiInteractiveUpdateNoticeSource(source, label) {
	requireMarkers(source, label, [
		PI_INTERACTIVE_UPDATE_NOTICE_MARKER,
		PI_INTERACTIVE_UPDATE_NOTICE_ACTION,
	]);
	if (source.includes(PI_INTERACTIVE_UPDATE_NOTICE_OLD_ANCHOR)) {
		fail(`${label} still routes package notices through update --extensions`);
	}
}

function readArchivedJson(archivePath, entryPath) {
	const source = readArchiveEntry(archivePath, entryPath);
	if (!source) fail(`runtime archive entry is missing: ${entryPath}`);
	try {
		return JSON.parse(source);
	} catch {
		fail(`runtime archive entry is not valid JSON: ${entryPath}`);
	}
}

function readArchivedText(archivePath, entryPath) {
	const source = readArchiveEntry(archivePath, entryPath);
	if (source === undefined) fail(`runtime archive entry is missing: ${entryPath}`);
	return source;
}

const manifest = readJson(resolve(packageRoot, "package.json"), "package.json");
const expectedPiVersion = manifest.dependencies?.["@earendil-works/pi-coding-agent"];
if (typeof expectedPiVersion !== "string") fail("package.json has no exact Pi runtime version");
if (expectedPiVersion !== PI_RUNTIME_CORRECTNESS_REQUIRED_VERSION) {
	fail(
		`Pi runtime correctness patches require ${PI_RUNTIME_CORRECTNESS_REQUIRED_VERSION}, found ${expectedPiVersion}`,
	);
}
if (manifest.dependencies?.["@earendil-works/pi-ai"] !== PI_RUNTIME_CORRECTNESS_REQUIRED_VERSION) {
	fail(`Pi AI correctness patches require ${PI_RUNTIME_CORRECTNESS_REQUIRED_VERSION}`);
}
if (manifest.dependencies?.["brace-expansion"] !== FEYNMAN_BRACE_EXPANSION_VERSION) {
	fail(`package.json does not pin brace-expansion ${FEYNMAN_BRACE_EXPANSION_VERSION}`);
}
if (manifest.overrides?.["brace-expansion"] !== FEYNMAN_BRACE_EXPANSION_VERSION) {
	fail(`package.json does not override brace-expansion ${FEYNMAN_BRACE_EXPANSION_VERSION}`);
}

for (const name of [
	"@earendil-works/pi-agent-core",
	"@earendil-works/pi-ai",
	"@earendil-works/pi-coding-agent",
	"@earendil-works/pi-tui",
]) {
	const expected = manifest.dependencies?.[name];
	if (expected !== PI_RUNTIME_CORRECTNESS_REQUIRED_VERSION) {
		fail(
			`${name} must be pinned to Pi ${PI_RUNTIME_CORRECTNESS_REQUIRED_VERSION}, found ${expected ?? "missing"}`,
		);
	}
	const installed = readJson(
		resolve(packageRoot, "node_modules", ...name.split("/"), "package.json"),
		`${name} package manifest`,
	).version;
	if (installed !== expected) {
		fail(`${name} version mismatch: expected ${expected}, found ${installed}`);
	}
}
for (const name of [
	"@earendil-works/pi-agent-core",
	"@earendil-works/pi-ai",
	"@earendil-works/pi-tui",
]) {
	const installed = readJson(
		resolve(
			packageRoot,
			"node_modules",
			"@earendil-works",
			"pi-coding-agent",
			"node_modules",
			...name.split("/"),
			"package.json",
		),
		`nested ${name} package manifest`,
	).version;
	if (installed !== expectedPiVersion) {
		fail(`nested ${name} version mismatch: expected ${expectedPiVersion}, found ${installed}`);
	}
}
requireMarkers(
	readText(
		resolve(packageRoot, "scripts", "verify-installed-runtime.mjs"),
		"installed runtime verifier",
	),
	"installed runtime verifier",
	[
		"EXPECTED_FEYNMAN_COMMANDS",
		"EXPECTED_FEYNMAN_TOOLS",
		'message: "/tools"',
		"valid-typebox-probe",
		"malformed-typebox-probe",
		"terminateChildProcessTree",
	],
);

for (const [label, path] of [
	[
		"bundled root Pi AgentCore",
		resolve(packageRoot, "node_modules", "@earendil-works", "pi-agent-core", "dist", "agent-loop.js"),
	],
	[
		"bundled nested Pi AgentCore",
		resolve(
			packageRoot,
			"node_modules",
			"@earendil-works",
			"pi-coding-agent",
			"node_modules",
			"@earendil-works",
			"pi-agent-core",
			"dist",
			"agent-loop.js",
		),
	],
]) {
	requireMarkers(readText(path, label), label, [
		"function normalizeFeynmanToolAlias",
		'["search_web", "web_search"]',
		"prepareToolCallArguments(tool, effectiveToolCall)",
	]);
}

assertPiRuntimeCorrectnessPatchSource(
	readText(
		resolve(packageRoot, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "core", "agent-session.js"),
		"bundled Pi AgentSession",
	),
	"agentSession",
	"bundled Pi AgentSession",
);
assertPiRuntimeCorrectnessPatchSource(
	readText(
		resolve(packageRoot, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "core", "session-manager.js"),
		"bundled Pi SessionManager",
	),
	"sessionManager",
	"bundled Pi SessionManager",
);
for (const [label, path] of [
	[
		"bundled root Pi AI",
		resolve(packageRoot, "node_modules", "@earendil-works", "pi-ai", "dist", "api", "transform-messages.js"),
	],
	[
		"bundled nested Pi AI",
		resolve(
			packageRoot,
			"node_modules",
			"@earendil-works",
			"pi-coding-agent",
			"node_modules",
			"@earendil-works",
			"pi-ai",
			"dist",
			"api",
			"transform-messages.js",
		),
	],
]) {
	assertPiRuntimeCorrectnessPatchSource(readText(path, label), "transformMessages", label);
}
if (
	readJson(
		resolve(
			packageRoot,
			"node_modules",
			"@earendil-works",
			"pi-coding-agent",
			"node_modules",
			"@earendil-works",
			"pi-ai",
			"package.json",
		),
		"bundled nested Pi AI manifest",
	).version !== PI_RUNTIME_CORRECTNESS_REQUIRED_VERSION
) {
	fail(`bundled nested Pi AI is not ${PI_RUNTIME_CORRECTNESS_REQUIRED_VERSION}`);
}

requireMarkers(
	readText(
		resolve(packageRoot, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "core", "model-runtime.js"),
		"bundled Pi ModelRuntime",
	),
	"bundled Pi ModelRuntime",
	["function assertHeaderSafeRequestConfig(", "providerOptions.apiKey ?? resolution.auth.apiKey"],
);
assertPiLlamaUsagePatchSource(
	readText(
		resolve(
			packageRoot,
			"node_modules",
			"@earendil-works",
			"pi-coding-agent",
			"dist",
			"extensions",
			"llama",
			"provider.js",
		),
		"bundled Pi llama.cpp provider",
	),
	"bundled Pi llama.cpp provider",
);
requireMarkers(
	readText(
		resolve(packageRoot, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "core", "model-registry.js"),
		"bundled Pi ModelRegistry",
	),
	"bundled Pi ModelRegistry",
	[
		"function assertHeaderSafeRequestConfig(",
		"assertHeaderSafeRequestConfig(model.provider, undefined, headers);",
		"assertHeaderSafeRequestConfig(model.provider, resolution.auth.apiKey, headers);",
	],
);
requireMarkers(
	readText(
		resolve(packageRoot, "node_modules", "@earendil-works", "pi-tui", "dist", "tui.js"),
		"bundled Pi TUI",
	),
	"bundled Pi TUI",
	["line = sliceByColumn(line, 0, width, true);"],
);
requireMarkers(
	readText(
		resolve(packageRoot, "node_modules", "@earendil-works", "pi-tui", "dist", "components", "editor.js"),
		"bundled Pi editor",
	),
	"bundled Pi editor",
	[
		"applyBackgroundToLine",
		"const styleInput = typeof this.theme.input",
		'const cursor = `\\x1b[7m${firstGrapheme}\\x1b[27m`',
		'const cursor = "\\x1b[7m \\x1b[27m"',
	],
);
requireMarkers(
	readText(
		resolve(
			packageRoot,
			"node_modules",
			"@earendil-works",
			"pi-coding-agent",
			"node_modules",
			"@earendil-works",
			"pi-tui",
			"dist",
			"tui.js",
		),
		"bundled nested Pi TUI",
	),
	"bundled nested Pi TUI",
	["line = sliceByColumn(line, 0, width, true);"],
);
requireMarkers(
	readText(
		resolve(
			packageRoot,
			"node_modules",
			"@earendil-works",
			"pi-coding-agent",
			"node_modules",
			"@earendil-works",
			"pi-tui",
			"dist",
			"components",
			"editor.js",
		),
		"bundled nested Pi editor",
	),
	"bundled nested Pi editor",
	[
		"applyBackgroundToLine",
		"const styleInput = typeof this.theme.input",
		'const cursor = `\\x1b[7m${firstGrapheme}\\x1b[27m`',
		'const cursor = "\\x1b[7m \\x1b[27m"',
	],
);
assertPiInteractiveUpdateNoticeSource(
	readText(
		resolve(
			packageRoot,
			"node_modules",
			"@earendil-works",
			"pi-coding-agent",
			"dist",
			"modes",
			"interactive",
			"interactive-mode.js",
		),
		"bundled Pi interactive update notice",
	),
	"bundled Pi interactive update notice",
);

const alphaLib = resolve(packageRoot, "node_modules", "@companion-ai", "alpha-hub", "src", "lib");
requireMarkers(
	readText(resolve(alphaLib, "auth.js"), "bundled alpha-hub auth"),
	"bundled alpha-hub auth",
	[
		"https://api.alphaxiv.org/auth",
		"/oauth2/authorize",
		"waitForCallback(server, state)",
		"OAuth state mismatch",
	],
);
requireMarkers(
	readText(resolve(alphaLib, "alphaxiv.js"), "bundled alpha-hub search"),
	"bundled alpha-hub search",
	["async function searchRestFast(", "return await fallbackSearch("],
);
requireMarkers(
	readText(resolve(alphaLib, "index.js"), "bundled alpha-hub parser"),
	"bundled alpha-hub parser",
	["function parseStructuredSearchResults("],
);

const mcpManifest = readJson(
	resolve(packageRoot, "node_modules", "@modelcontextprotocol", "sdk", "package.json"),
	"bundled MCP SDK manifest",
);
if (mcpManifest.dependencies?.["@hono/node-server"] !== "2.0.12") {
	fail("bundled MCP SDK does not pin @hono/node-server 2.0.12");
}
if (
	readJson(
		resolve(packageRoot, "node_modules", "@hono", "node-server", "package.json"),
		"bundled Hono node server manifest",
	).version !== "2.0.12"
) {
	fail("bundled Hono node server is not 2.0.12");
}
for (const [label, path] of [
	[
		"bundled root brace-expansion",
		packageRequire.resolve("brace-expansion/package.json"),
	],
	[
		"bundled Pi brace-expansion",
		resolve(
			packageRoot,
			"node_modules",
			"@earendil-works",
			"pi-coding-agent",
			"node_modules",
			"brace-expansion",
			"package.json",
		),
	],
]) {
	if (readJson(path, `${label} manifest`).version !== FEYNMAN_BRACE_EXPANSION_VERSION) {
		fail(`${label} is not ${FEYNMAN_BRACE_EXPANSION_VERSION}`);
	}
}
const bundledPiManifest = readJson(
	resolve(packageRoot, "node_modules", "@earendil-works", "pi-coding-agent", "package.json"),
	"bundled Pi package manifest",
);
const bundledPiShrinkwrapSource = readText(
	resolve(packageRoot, "node_modules", "@earendil-works", "pi-coding-agent", "npm-shrinkwrap.json"),
	"bundled Pi shrinkwrap",
);
assertPiCodingAgentUndiciShrinkwrapSource(bundledPiShrinkwrapSource, "bundled Pi shrinkwrap");
if (manifest.dependencies?.undici !== FEYNMAN_UNDICI_VERSION) {
	fail(`package.json does not pin Undici ${FEYNMAN_UNDICI_VERSION}`);
}
if (bundledPiManifest.dependencies?.undici !== FEYNMAN_UNDICI_VERSION) {
	fail(`bundled Pi does not pin Undici ${FEYNMAN_UNDICI_VERSION}`);
}
for (const [label, path] of [
	["Feynman", packageRequire.resolve("undici/package.json")],
	[
		"bundled Pi",
		resolve(packageRoot, "node_modules", "@earendil-works", "pi-coding-agent", "node_modules", "undici", "package.json"),
	],
]) {
	if (readJson(path, `${label} Undici manifest`).version !== FEYNMAN_UNDICI_VERSION) {
		fail(`${label} does not resolve Undici ${FEYNMAN_UNDICI_VERSION}`);
	}
}

const archivePath = resolve(packageRoot, ".feynman", "runtime-workspace.tgz");
const digestPath = resolve(packageRoot, ".feynman", "runtime-workspace.sha256");
const runtimeLockPath = resolve(packageRoot, ".feynman", "runtime-package-lock.json");
if (!verifyFileSha256(archivePath, digestPath)) {
	fail("runtime workspace archive SHA-256 does not match its sidecar");
}
const runtimeLockSource = readText(runtimeLockPath, "committed runtime package lock");
const runtimeLock = JSON.parse(runtimeLockSource);
const expectedPiWebAccessVersion = runtimeLock.packages?.[""]?.dependencies?.["pi-web-access"];
if (typeof expectedPiWebAccessVersion !== "string") {
	fail("committed runtime lock does not pin pi-web-access");
}
if (
	runtimeLock.packages?.["node_modules/@hono/node-server"]?.version !== "2.0.12"
) {
	fail("committed runtime lock does not pin @hono/node-server 2.0.12");
}
if (runtimeLock.packages?.[""]?.dependencies?.undici !== FEYNMAN_UNDICI_VERSION) {
	fail(`committed runtime lock does not pin Undici ${FEYNMAN_UNDICI_VERSION}`);
}
if (runtimeLock.packages?.["node_modules/undici"]?.version !== FEYNMAN_UNDICI_VERSION) {
	fail(`committed runtime lock does not resolve Undici ${FEYNMAN_UNDICI_VERSION}`);
}
if (
	runtimeLock.packages?.[""]?.dependencies?.["brace-expansion"] !== FEYNMAN_BRACE_EXPANSION_VERSION
) {
	fail(`committed runtime lock does not pin brace-expansion ${FEYNMAN_BRACE_EXPANSION_VERSION}`);
}
if (
	runtimeLock.packages?.["node_modules/brace-expansion"]?.version !== FEYNMAN_BRACE_EXPANSION_VERSION
) {
	fail(`committed runtime lock does not resolve brace-expansion ${FEYNMAN_BRACE_EXPANSION_VERSION}`);
}
for (const [packagePath, entry] of Object.entries(runtimeLock.packages ?? {})) {
	if (
		packagePath.endsWith("/pi-coding-agent/node_modules/brace-expansion") &&
		entry?.version !== FEYNMAN_BRACE_EXPANSION_VERSION
	) {
		fail(`committed runtime lock does not pin Pi brace-expansion ${FEYNMAN_BRACE_EXPANSION_VERSION}`);
	}
	if (
		packagePath.endsWith("/pi-coding-agent/node_modules/undici") &&
		entry?.version !== FEYNMAN_UNDICI_VERSION
	) {
		fail(`committed runtime lock does not pin Pi Undici ${FEYNMAN_UNDICI_VERSION}`);
	}
}
if (readArchivedText(archivePath, "npm/package-lock.json") !== runtimeLockSource) {
	fail("runtime archive package lock differs from the committed runtime lock");
}
const runtimeManifest = readArchivedJson(archivePath, "npm/.runtime-manifest.json");
if (!Array.isArray(runtimeManifest.packageSpecs)) {
	fail("runtime archive manifest has no packageSpecs");
}
const currentRuntimeInputHash = computeRuntimeInputHash(packageRoot);
if (runtimeManifest.runtimeInputHash !== currentRuntimeInputHash) {
	fail(
		`runtime archive inputs are stale: expected ${currentRuntimeInputHash}, found ${runtimeManifest.runtimeInputHash ?? "missing"}`,
	);
}
if (
	typeof runtimeManifest.runtimeTreeHash !== "string" ||
	!/^[a-f0-9]{64}$/.test(runtimeManifest.runtimeTreeHash)
) {
	fail("runtime archive manifest has no valid runtimeTreeHash");
}
const archivedRuntimeTreeHash = computeRuntimeArchiveTreeHash(archivePath);
if (archivedRuntimeTreeHash !== runtimeManifest.runtimeTreeHash) {
	fail(
		`runtime archive tree mismatch: expected ${runtimeManifest.runtimeTreeHash}, found ${archivedRuntimeTreeHash}`,
	);
}
for (const spec of runtimeManifest.packageSpecs) {
	const { name, version } = parseExactRuntimePackageSpec(spec);
	const archived = readArchivedJson(
		archivePath,
		`npm/node_modules/${name}/package.json`,
	);
	if (archived.version !== version) {
		fail(`runtime archive ${name} version mismatch: expected ${version}, found ${archived.version}`);
	}
}

assertPiRuntimeCorrectnessPatchSource(
	readArchivedText(
		archivePath,
		"npm/node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js",
	),
	"agentSession",
	"runtime Pi AgentSession",
);
assertPiRuntimeCorrectnessPatchSource(
	readArchivedText(
		archivePath,
		"npm/node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.js",
	),
	"sessionManager",
	"runtime Pi SessionManager",
);
for (const [label, entryPath] of [
	[
		"runtime root Pi AI",
		"npm/node_modules/@earendil-works/pi-ai/dist/api/transform-messages.js",
	],
	[
		"runtime nested Pi AI",
		"npm/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/api/transform-messages.js",
	],
]) {
	assertPiRuntimeCorrectnessPatchSource(
		readArchivedText(archivePath, entryPath),
		"transformMessages",
		label,
	);
}
for (const [label, entryPath] of [
	[
		"runtime root Pi AgentCore",
		"npm/node_modules/@earendil-works/pi-agent-core/dist/agent-loop.js",
	],
	[
		"runtime nested Pi AgentCore",
		"npm/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-agent-core/dist/agent-loop.js",
	],
]) {
	requireMarkers(readArchivedText(archivePath, entryPath), label, [
		"function normalizeFeynmanToolAlias",
		'["search_web", "web_search"]',
		"prepareToolCallArguments(tool, effectiveToolCall)",
	]);
}
if (
	readArchivedJson(
		archivePath,
		"npm/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/package.json",
	).version !== PI_RUNTIME_CORRECTNESS_REQUIRED_VERSION
) {
	fail(`runtime nested Pi AI is not ${PI_RUNTIME_CORRECTNESS_REQUIRED_VERSION}`);
}
for (const name of ["pi-agent-core", "pi-tui"]) {
	if (
		readArchivedJson(
			archivePath,
			`npm/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/${name}/package.json`,
		).version !== PI_RUNTIME_CORRECTNESS_REQUIRED_VERSION
	) {
		fail(`runtime nested ${name} is not ${PI_RUNTIME_CORRECTNESS_REQUIRED_VERSION}`);
	}
}

requireMarkers(
	readArchivedText(
		archivePath,
		"npm/node_modules/@earendil-works/pi-coding-agent/dist/core/model-runtime.js",
	),
	"runtime Pi ModelRuntime",
	["function assertHeaderSafeRequestConfig(", "providerOptions.apiKey ?? resolution.auth.apiKey"],
);
assertPiLlamaUsagePatchSource(
	readArchivedText(
		archivePath,
		"npm/node_modules/@earendil-works/pi-coding-agent/dist/extensions/llama/provider.js",
	),
	"runtime Pi llama.cpp provider",
);
requireMarkers(
	readArchivedText(
		archivePath,
		"npm/node_modules/@earendil-works/pi-coding-agent/dist/core/model-registry.js",
	),
	"runtime Pi ModelRegistry",
	[
		"function assertHeaderSafeRequestConfig(",
		"assertHeaderSafeRequestConfig(model.provider, undefined, headers);",
		"assertHeaderSafeRequestConfig(model.provider, resolution.auth.apiKey, headers);",
	],
);
assertPiInteractiveUpdateNoticeSource(
	readArchivedText(
		archivePath,
		"npm/node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/interactive-mode.js",
	),
	"runtime Pi interactive update notice",
);
requireMarkers(
	readArchivedText(
		archivePath,
		"npm/node_modules/@earendil-works/pi-tui/dist/components/editor.js",
	),
	"runtime Pi editor",
	[
		"applyBackgroundToLine",
		"const styleInput = typeof this.theme.input",
		'const cursor = `\\x1b[7m${firstGrapheme}\\x1b[27m`',
		'const cursor = "\\x1b[7m \\x1b[27m"',
	],
);
requireMarkers(
	readArchivedText(
		archivePath,
		"npm/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-tui/dist/tui.js",
	),
	"runtime nested Pi TUI",
	["line = sliceByColumn(line, 0, width, true);"],
);
requireMarkers(
	readArchivedText(
		archivePath,
		"npm/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-tui/dist/components/editor.js",
	),
	"runtime nested Pi editor",
	[
		"applyBackgroundToLine",
		"const styleInput = typeof this.theme.input",
		'const cursor = `\\x1b[7m${firstGrapheme}\\x1b[27m`',
		'const cursor = "\\x1b[7m \\x1b[27m"',
	],
);
requireMarkers(
	readArchivedText(
		archivePath,
		"npm/node_modules/@companion-ai/alpha-hub/src/lib/auth.js",
	),
	"runtime alpha-hub auth",
	["https://api.alphaxiv.org/auth", "waitForCallback(server, state)", "OAuth state mismatch"],
);
requireMarkers(
	readArchivedText(
		archivePath,
		"npm/node_modules/pi-otel/dist/otel/sdk.js",
	),
	"runtime pi-otel SDK",
	[
		"createFeynmanResource",
		"resourceFromAttributes",
		"FEYNMAN_POSTHOG_KEY",
		'method: "OPTIONS"',
		".then((response) => response.ok",
	],
);
requireMarkers(
	readArchivedText(
		archivePath,
		"npm/node_modules/pi-otel/dist/index.js",
	),
	"runtime pi-otel extension",
	["probeEndpoint(cfg.endpoint, 300, cfg.headers)", "if (!process.env.FEYNMAN_POSTHOG_KEY)"],
);
if (
	readArchivedJson(
		archivePath,
		"npm/node_modules/pi-web-access/package.json",
	).version !== expectedPiWebAccessVersion
) {
	fail(`runtime pi-web-access is not ${expectedPiWebAccessVersion}`);
}
requireMarkers(
	readArchivedText(
		archivePath,
		"npm/node_modules/pi-web-access/index.ts",
	),
	"runtime pi-web-access research tools",
	[
		'StringEnum(["readable", "raw", "answer"]',
		"findText:",
		'StringEnum(["exact", "case-insensitive", "fuzzy"]',
		'pi.registerCommand("web-results"',
		"const pendingCurates = new Map<string, PendingCurate>();",
		"function searchWithDeadline(",
		"Searches return directly by default",
	],
);
requireMarkers(
	readArchivedText(
		archivePath,
		"npm/node_modules/pi-web-access/curator-server.ts",
	),
	"runtime pi-web-access curator lifecycle",
	["const noBrowserTimeoutMs = Math.max(5000, getEffectiveTimeoutMs());"],
);
requireMarkers(
	readArchivedText(
		archivePath,
		"npm/node_modules/pi-web-access/github-extract.ts",
	),
	"runtime pi-web-access Git subprocess handling",
	['GIT_TERMINAL_PROMPT: "0"', "terminateProcessTree("],
);
requireMarkers(
	readArchivedText(
		archivePath,
		"npm/node_modules/pi-web-access/utils.ts",
	),
	"runtime pi-web-access config helper",
	["FEYNMAN_WEB_SEARCH_CONFIG", "PI_WEB_SEARCH_CONFIG", "configuredPath || join(getWebSearchConfigDir()"],
);
requireMarkers(
	readArchivedText(
		archivePath,
		"npm/node_modules/pi-web-access/pdf-extract.ts",
	),
	"runtime pi-web-access PDF scratch path",
	["FEYNMAN_FETCH_CACHE_DIR", 'join(process.cwd(), ".feynman", "cache", "fetch-content")'],
);
if (
	readArchivedJson(
		archivePath,
		"npm/node_modules/@modelcontextprotocol/sdk/package.json",
	).dependencies?.["@hono/node-server"] !== "2.0.12"
) {
	fail("runtime MCP SDK does not pin @hono/node-server 2.0.12");
}
if (
	readArchivedJson(
		archivePath,
		"npm/node_modules/@hono/node-server/package.json",
	).version !== "2.0.12"
) {
	fail("runtime Hono node server is not 2.0.12");
}
for (const [label, entryPath] of [
	["runtime root brace-expansion", "npm/node_modules/brace-expansion/package.json"],
	[
		"runtime Pi brace-expansion",
		"npm/node_modules/@earendil-works/pi-coding-agent/node_modules/brace-expansion/package.json",
	],
]) {
	if (readArchivedJson(archivePath, entryPath).version !== FEYNMAN_BRACE_EXPANSION_VERSION) {
		fail(`${label} is not ${FEYNMAN_BRACE_EXPANSION_VERSION}`);
	}
}
const runtimePiManifest = readArchivedJson(
	archivePath,
	"npm/node_modules/@earendil-works/pi-coding-agent/package.json",
);
const runtimePiShrinkwrapSource = readArchivedText(
	archivePath,
	"npm/node_modules/@earendil-works/pi-coding-agent/npm-shrinkwrap.json",
);
assertPiCodingAgentUndiciShrinkwrapSource(runtimePiShrinkwrapSource, "runtime Pi shrinkwrap");
if (runtimePiManifest.dependencies?.undici !== FEYNMAN_UNDICI_VERSION) {
	fail(`runtime Pi does not pin Undici ${FEYNMAN_UNDICI_VERSION}`);
}
for (const [label, entryPath] of [
	["runtime", "npm/node_modules/undici/package.json"],
	["runtime Pi", "npm/node_modules/@earendil-works/pi-coding-agent/node_modules/undici/package.json"],
]) {
	if (readArchivedJson(archivePath, entryPath).version !== FEYNMAN_UNDICI_VERSION) {
		fail(`${label} does not resolve Undici ${FEYNMAN_UNDICI_VERSION}`);
	}
}

console.log(JSON.stringify({
	ok: true,
	package: `${manifest.name}@${manifest.version}`,
	piVersion: expectedPiVersion,
	piWebAccessVersion: expectedPiWebAccessVersion,
	undiciVersion: FEYNMAN_UNDICI_VERSION,
	runtimePackages: runtimeManifest.packageSpecs.length,
	runtimeArchiveSha256: computeFileSha256(archivePath),
}));
