import { assertAlphaHubAuthSource } from "./lib/alpha-hub-auth-patch.mjs";
import { assertAlphaHubSearchSource, assertAlphaHubSearchResultsSource } from "./lib/alpha-hub-search-patch.mjs";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import {
	assertPiCodingAgentUndiciShrinkwrapSource,
	FEYNMAN_UNDICI_VERSION,
} from "./lib/pi-undici-proxy-patch.mjs";
import {
	FEYNMAN_LITEPARSE_GIT_HEAD,
	FEYNMAN_LITEPARSE_VERSION,
	verifyLiteparseManifestContract,
	verifyLiteparseRootManifestContract,
	verifyLiteparseRootLockContract,
	verifyLiteparseRuntimeLockContract,
} from "./lib/liteparse-release-contract.mjs";
import {
	assertPiAiForwardFixArchive,
	assertPiAiForwardFixPackageTree,
} from "./lib/pi-ai-forward-fixes-verifier.mjs";
import {
	assertPiCompactionToolsArchive,
	assertPiCompactionToolsPackageTree,
} from "./lib/pi-compaction-tools-verifier.mjs";
import {
	assertPatchedPiCliArgsPackageRoot,
	assertPiCliArgsPatchSource,
} from "./lib/pi-cli-args-patch.mjs";
import { verifyResearchArtifactIntegrityRuntime } from "./lib/research-artifact-integrity-verifier.mjs";
import { assertPiLlamaUsagePatchSource } from "./lib/pi-llama-usage-patch.mjs";
import {
	assertPiExtensionHandlerTimeoutArchive,
	assertPiExtensionHandlerTimeoutPackageTree,
} from "./lib/pi-extension-handler-timeout-verifier.mjs";
import { verifyPiTelemetryArchiveContract, verifyPiTelemetryRuntimeLockContract } from "./lib/pi-telemetry-release-contract.mjs";
import { assertPiStateFilePermissionsPatchSource } from "./lib/pi-state-file-permissions-patch.mjs";
import {
	assertPiRuntimeCorrectnessPatchSource,
	PI_RUNTIME_CORRECTNESS_REQUIRED_VERSION,
} from "./lib/pi-runtime-correctness-patch.mjs";
import { assertPiCodingAgentForwardFixArchive, assertPiCodingAgentForwardFixPackageTree } from "./lib/pi-coding-agent-forward-fixes-verifier.mjs";
import { assertPiAgentCorePatchSource } from "./lib/pi-agent-core-patch.mjs";
import {
	computeFileSha256,
	computeRuntimeArchiveTreeHash,
	computeRuntimeInputHash,
	parseExactRuntimePackageSpec,
	readArchiveEntry,
	verifyFileSha256,
} from "./lib/runtime-workspace-integrity.mjs";
import { PI_WEB_ACCESS_PATCH_TARGETS, assertPiWebAccessPatchedSources } from "./lib/pi-web-access-patch.mjs";
import { assertPiSubagentPatchedSources } from "./lib/pi-subagents-verification.mjs";
import { assertResearchRuntimeIntakeArchive } from "./lib/research-runtime-intake-release-contract.mjs";
const packageRoot = resolve(process.argv[2] ?? resolve(import.meta.dirname, ".."));
const prunedNative = process.argv.includes("--pruned-native");
const packageRequire = createRequire(resolve(packageRoot, "package.json"));
const FEYNMAN_BRACE_EXPANSION_VERSION = "5.0.9";
const FEYNMAN_IP_ADDRESS_VERSION = "10.7.0";
const FEYNMAN_PI_DOCPARSER_VERSION = "4.0.0";
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

function requireMarkerCount(source, label, marker, expectedCount) {
	const actualCount = source.split(marker).length - 1;
	if (actualCount !== expectedCount) {
		fail(`${label} expected ${expectedCount} occurrences of ${marker}, found ${actualCount}`);
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
if (manifest.overrides?.["ip-address"] !== FEYNMAN_IP_ADDRESS_VERSION) {
	fail(`package.json does not override ip-address ${FEYNMAN_IP_ADDRESS_VERSION}`);
}
if (
	readJson(packageRequire.resolve("ip-address/package.json"), "bundled ip-address manifest").version !==
	FEYNMAN_IP_ADDRESS_VERSION
) {
	fail(`bundled package does not resolve ip-address ${FEYNMAN_IP_ADDRESS_VERSION}`);
}
verifyLiteparseRootManifestContract(manifest, fail);
const rootLockPath = resolve(packageRoot, "package-lock.json");
if (existsSync(rootLockPath)) {
	const rootLock = readJson(rootLockPath, "package-lock.json");
	verifyLiteparseRootLockContract(rootLock, fail);
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
		"null-typebox-probe",
		"invalid-typebox-probe",
		"verifyGithubCopilotRateLimitLogin", "verifyInstalledPiStateFilePermissions",
		'githubCopilotRateLimit: "passed"',
		"terminateChildProcessTree",
	],
);
requireMarkers(
	readText(
		resolve(packageRoot, "scripts", "verify-installed-docparser.mjs"),
		"installed pi-docparser verifier",
	),
	"installed pi-docparser verifier",
	[
		'piRequire.resolve("jiti")',
		"createMinimalPdf",
		'"document_parse"',
		'"document_search"',
		'"document_screenshot"',
		"assertDocumentParseResult",
		"assertDocumentSearchResult",
		"assertDocumentScreenshotResult",
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
	assertPiAgentCorePatchSource(readText(path, label), label);
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
assertPiExtensionHandlerTimeoutPackageTree((relativePath) =>
	readText(
		resolve(packageRoot, "node_modules", "@earendil-works", "pi-coding-agent", ...relativePath.split("/")),
		"bundled Pi extension runner",
	));
assertPiCodingAgentForwardFixPackageTree((relativePath, label) =>
	readText(resolve(packageRoot, "node_modules", "@earendil-works", "pi-coding-agent", ...relativePath.split("/")), label));
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
for (const [target, relativePath] of [
	["githubCopilotDeviceCode", "dist/auth/oauth/device-code.js"],
	["githubCopilotOAuth", "dist/auth/oauth/github-copilot.js"],
]) {
	for (const [label, path] of [
		[
			`bundled root Pi AI ${target}`,
			resolve(packageRoot, "node_modules", "@earendil-works", "pi-ai", ...relativePath.split("/")),
		],
		[
			`bundled nested Pi AI ${target}`,
			resolve(
				packageRoot,
				"node_modules",
				"@earendil-works",
				"pi-coding-agent",
				"node_modules",
				"@earendil-works",
				"pi-ai",
				...relativePath.split("/"),
			),
		],
	]) {
		assertPiRuntimeCorrectnessPatchSource(readText(path, label), target, label);
	}
}
assertPiAiForwardFixPackageTree(packageRoot, readText, { prunedNative });
assertPiCompactionToolsPackageTree(packageRoot, readText, { prunedNative });
assertPiStateFilePermissionsPatchSource(
	readText(
		resolve(packageRoot, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "core", "auth-storage.js"),
		"bundled Pi auth storage",
	),
	"bundled Pi auth storage",
);
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
			"assertHeaderSafeRequestConfig(model.provider, undefined, compatibility.headers);",
			"assertHeaderSafeRequestConfig(model.provider, resolution.auth.apiKey, resolution.auth.headers);",
	],
);
requireMarkers(
	readText(
		resolve(packageRoot, "node_modules", "@earendil-works", "pi-tui", "dist", "tui-main-screen.js"),
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
			"tui-main-screen.js",
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

const alphaLib = resolve(packageRoot, "node_modules", "@advaitpaliwal", "alpha-hub", "src", "lib");
assertAlphaHubAuthSource(readText(resolve(alphaLib, "auth.js"), "bundled alpha-hub auth"));
assertAlphaHubSearchSource(readText(resolve(alphaLib, "alphaxiv.js"), "bundled alpha-hub search"));
assertAlphaHubSearchResultsSource(readText(resolve(alphaLib, "index.js"), "bundled alpha-hub parser"));

const mcpManifest = readJson(
	resolve(packageRoot, "node_modules", "@modelcontextprotocol", "sdk", "package.json"),
	"bundled MCP SDK manifest",
);
if (mcpManifest.dependencies?.["@hono/node-server"] !== "2.1.1") {
	fail("bundled MCP SDK does not pin @hono/node-server 2.1.1");
}
if (
	readJson(
		resolve(packageRoot, "node_modules", "@hono", "node-server", "package.json"),
		"bundled Hono node server manifest",
	).version !== "2.1.1"
) {
	fail("bundled Hono node server is not 2.1.1");
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
assertPatchedPiCliArgsPackageRoot(resolve(packageRoot, "node_modules", "@earendil-works", "pi-coding-agent"), "bundled Pi CLI");
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
verifyPiTelemetryRuntimeLockContract(runtimeLock, expectedPiVersion, fail);
const expectedPiWebAccessVersion = runtimeLock.packages?.[""]?.dependencies?.["pi-web-access"];
if (expectedPiWebAccessVersion !== "0.28.0") {
	fail("committed runtime lock does not pin pi-web-access 0.28.0");
}
const expectedPiDocparserVersion = runtimeLock.packages?.[""]?.dependencies?.["pi-docparser"];
if (expectedPiDocparserVersion !== FEYNMAN_PI_DOCPARSER_VERSION) {
	fail(`committed runtime lock does not pin pi-docparser ${FEYNMAN_PI_DOCPARSER_VERSION}`);
}
if (
	runtimeLock.packages?.["node_modules/@hono/node-server"]?.version !== "2.1.1"
) {
	fail("committed runtime lock does not pin @hono/node-server 2.1.1");
}
if (runtimeLock.packages?.["node_modules/ip-address"]?.version !== FEYNMAN_IP_ADDRESS_VERSION) {
	fail(`committed runtime lock does not resolve ip-address ${FEYNMAN_IP_ADDRESS_VERSION}`);
}
verifyLiteparseRuntimeLockContract(runtimeLock, fail);
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
if (readArchivedText(archivePath, "npm/package-lock.json") !== runtimeLockSource) fail("runtime archive package lock differs from the committed runtime lock");
if (readArchiveEntry(archivePath, "npm/node_modules/.package-lock.json") !== undefined) fail("runtime archive retains stale npm hidden lock metadata");
if (
	readArchivedJson(archivePath, "npm/node_modules/ip-address/package.json").version !==
	FEYNMAN_IP_ADDRESS_VERSION
) {
	fail(`runtime archive does not resolve ip-address ${FEYNMAN_IP_ADDRESS_VERSION}`);
}
verifyPiTelemetryArchiveContract(
	(entryPath) => readArchivedJson(archivePath, entryPath),
	expectedPiVersion,
	fail,
);
const runtimeManifest = readArchivedJson(archivePath, "npm/.runtime-manifest.json");
assertPiCliArgsPatchSource(readArchivedText(archivePath, "npm/node_modules/@earendil-works/pi-coding-agent/dist/cli/args.js"), "runtime Pi CLI args");
verifyResearchArtifactIntegrityRuntime((entryPath) => readArchivedText(archivePath, entryPath));
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
assertPiSubagentPatchedSources((relativePath) => readArchivedText(archivePath, `npm/node_modules/pi-subagents/${relativePath}`), "runtime pi-subagents");
assertResearchRuntimeIntakeArchive((entryPath) => readArchivedText(archivePath, entryPath));
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
assertPiExtensionHandlerTimeoutArchive((entryPath) =>
	readArchivedText(archivePath, entryPath));
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
for (const [target, relativePath] of [
	["githubCopilotDeviceCode", "dist/auth/oauth/device-code.js"],
	["githubCopilotOAuth", "dist/auth/oauth/github-copilot.js"],
]) {
	for (const [label, entryPath] of [
		[
			`runtime root Pi AI ${target}`,
			`npm/node_modules/@earendil-works/pi-ai/${relativePath}`,
		],
		[
			`runtime nested Pi AI ${target}`,
			`npm/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/${relativePath}`,
		],
	]) {
		assertPiRuntimeCorrectnessPatchSource(
			readArchivedText(archivePath, entryPath),
			target,
			label,
		);
	}
}
assertPiAiForwardFixArchive((entryPath) => readArchivedText(archivePath, entryPath));
assertPiCodingAgentForwardFixArchive((relativePath, label) =>
	readArchivedText(archivePath, `npm/node_modules/@earendil-works/pi-coding-agent/${relativePath}`));
assertPiCompactionToolsArchive((entryPath) => readArchivedText(archivePath, entryPath));
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
	assertPiAgentCorePatchSource(readArchivedText(archivePath, entryPath), label);
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
assertPiStateFilePermissionsPatchSource(
	readArchivedText(
		archivePath,
		"npm/node_modules/@earendil-works/pi-coding-agent/dist/core/auth-storage.js",
	),
	"runtime Pi auth storage",
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
			"assertHeaderSafeRequestConfig(model.provider, undefined, compatibility.headers);",
			"assertHeaderSafeRequestConfig(model.provider, resolution.auth.apiKey, resolution.auth.headers);",
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
		"npm/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-tui/dist/tui-main-screen.js",
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
for (const [fileName, assertSource] of [
	["auth.js", assertAlphaHubAuthSource],
	["alphaxiv.js", assertAlphaHubSearchSource],
	["index.js", assertAlphaHubSearchResultsSource],
]) {
	assertSource(readArchivedText(archivePath, `npm/node_modules/@advaitpaliwal/alpha-hub/src/lib/${fileName}`));
}

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
const docparserManifest = readArchivedJson(
	archivePath,
	"npm/node_modules/pi-docparser/package.json",
);
if (docparserManifest.version !== expectedPiDocparserVersion) {
	fail(`runtime pi-docparser is not ${expectedPiDocparserVersion}`);
}
if (docparserManifest.engines?.node !== ">=22.19.0") {
	fail("runtime pi-docparser does not declare the reviewed Node 22.19 floor");
}
const liteparseManifest = readArchivedJson(
	archivePath,
	"npm/node_modules/@llamaindex/liteparse/package.json",
);
verifyLiteparseManifestContract(liteparseManifest, fail, "runtime");
requireMarkers(
	readArchivedText(
		archivePath,
		"npm/node_modules/pi-docparser/extensions/docparser/native-executor.ts",
	),
	"runtime pi-docparser native isolation",
	[
		"private readonly queue: QueueEntry[] = [];",
		"async function terminatePosixTree(",
		"async function terminateWindowsTree(",
		"private poison(): void {",
		"this.poisoned = true;",
	],
);
requireMarkers(
	readArchivedText(
		archivePath,
		"npm/node_modules/pi-docparser/extensions/docparser/native-worker.mjs",
	),
	"runtime pi-docparser worker",
	[
		'const liteparse = await import("@llamaindex/liteparse");',
		'request.operation === "parse"',
		'request.operation === "search"',
		"return runScreenshot(request, liteparse);",
	],
);
requireMarkers(
	readArchivedText(
		archivePath,
		"npm/node_modules/pi-docparser/extensions/docparser/parse-output.mjs",
	),
	"runtime pi-docparser bounded output",
	[
		"export async function streamParseOutput",
		"export async function writeParseOutputFile",
		"maximum = DEFAULT_MAX_BYTES",
		"new BoundedWriter(stream, maximum)",
	],
);
if (
	readArchivedJson(
		archivePath,
		"npm/node_modules/pi-web-access/package.json",
	).version !== expectedPiWebAccessVersion
) {
	fail(`runtime pi-web-access is not ${expectedPiWebAccessVersion}`);
}
const webSource = readArchivedText(
	archivePath,
	"npm/node_modules/pi-web-access/index.ts",
);
requireMarkers(
	webSource,
	"runtime pi-web-access research tools",
	[
		'StringEnum(["readable", "raw", "answer"]',
		"findText:",
		'StringEnum(["exact", "case-insensitive", "fuzzy"]',
		'if (isCommandEnabled(initConfig, "web-results")) pi.registerCommand("web-results"',
		"const pendingCurates = new Map<string, PendingCurate>();",
		"function searchWithDeadline(",
		"maxInlineContentChars?: unknown;",
		"const DEFAULT_MAX_INLINE_CONTENT_CHARS = 30_000;",
		"const MAX_INLINE_CONTENT_CHARS = 200_000;",
		"bocha: isBochaAvailable(),",
		"Searches return directly by default",
		"const WEB_SEARCH_CONFIG_PATH = getWebSearchConfigPath();",
		"const dir = dirname(WEB_SEARCH_CONFIG_PATH);",
		"get scopedModels() { return ctx.scopedModels; }",
		"modelMatchesScopedModels(model, summaryContext.scopedModels)",
		"summaryGenerationDeadlineMs?: unknown;",
		"export function getSummaryGenerationDeadlineMs(): number {",
		"storeFetchedContentResult(fetchId, data)",
		"storeFetchedContentResult(responseId, data)",
		"if (sourceCheckEnabled) pi.registerTool({",
		"if (fetchContentEnabled) pi.registerTool({",
		"if (getSearchContentEnabled) {",
		"Ignored when findText is supplied.",
		"Requires findText.",
	],
);
requireMarkerCount(
	webSource,
	"runtime pi-web-access live nested model scope",
	"get scopedModels() { return ctx.scopedModels; }",
	3,
);
const webModelScopeSource = readArchivedText(
	archivePath,
	"npm/node_modules/pi-web-access/summary-model-scope.ts",
);
requireMarkers(
	webModelScopeSource,
	"runtime pi-web-access model scope",
	[
		"ctx.scopedModels.length === 0",
		"ctx.scopedModels.map(({ model }) => summaryModelValue(model))",
		"export function modelMatchesScopedModels(",
		"scopedModel.provider === model.provider && scopedModel.id === model.id",
		'"xhigh", "max"',
	],
);
for (const staleMarker of ["readSettings(", 'join(ctx.cwd, ".pi", "settings.json")']) {
	if (webModelScopeSource.includes(staleMarker)) {
		fail(`runtime pi-web-access model scope still contains stale marker: ${staleMarker}`);
	}
}
const webPageQuerySource = readArchivedText(
	archivePath,
	"npm/node_modules/pi-web-access/page-query.ts",
);
requireMarkers(
	webPageQuerySource,
	"runtime pi-web-access page-answer model scope",
	[
		'import { findModelWithProviderRouting, modelMatchesScopedModels } from "./summary-model-scope.ts";',
		"modelMatchesScopedModels(model, ctx.scopedModels)",
	],
);
const webSummaryReviewSource = readArchivedText(
	archivePath,
	"npm/node_modules/pi-web-access/summary-review.ts",
);
requireMarkers(
	webSummaryReviewSource,
	"runtime pi-web-access summary review model scope",
	[
		'import { findModelWithProviderRouting, modelMatchesScopedModels, splitThinkingSuffix, type SummaryThinkingLevel } from "./summary-model-scope.ts";',
		'Pick<ExtensionContext, "model" | "modelRegistry" | "scopedModels" | "cwd" | "isProjectTrusted">',
		"modelMatchesScopedModels(model, ctx.scopedModels)",
	],
);
for (const staleMarker of ["loadEnabledModelPatterns", "modelMatchesEnabledPatterns"]) {
	if (webSummaryReviewSource.includes(staleMarker)) {
		fail(`runtime pi-web-access summary review still contains stale marker: ${staleMarker}`);
	}
}
requireMarkers(
	readArchivedText(
		archivePath,
		"npm/node_modules/pi-web-access/feature-config.ts",
	),
	"runtime pi-web-access image gates",
	[
		'import { getWebSearchConfigPath } from "./utils.ts";',
		"export function isImageEnabled(): boolean {",
		"return loadFeatureConfig().image?.enabled !== false;",
		"export function canAttachImages(): boolean {",
	],
);
requireMarkers(
	readArchivedText(
		archivePath,
		"npm/node_modules/pi-web-access/storage.ts",
	),
	"runtime pi-web-access external fetched-content cache",
	[
		'import { getWebSearchConfigPath } from "./utils.ts";',
		'import { dirname, join } from "node:path";',
		'const FETCH_CACHE_DIR = "web-search-cache";',
		"return join(dirname(getWebSearchConfigPath()), FETCH_CACHE_DIR);",
		"function writeFetchCache(",
		"function readCachedFetchData(",
		"export function pruneExpiredFetchCache(",
		"export function storeFetchedContentResult(",
		"urlMetadata: metadataForUrls(data.urls)",
	],
);
try {
	assertPiWebAccessPatchedSources(
		new Map(
			PI_WEB_ACCESS_PATCH_TARGETS.map((relativePath) => [
				relativePath,
				readArchivedText(
					archivePath,
					`npm/node_modules/pi-web-access/${relativePath}`,
				),
			]),
		),
		"runtime archive",
	);
} catch (error) {
	fail(error instanceof Error ? error.message : String(error));
}
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
	"runtime pi-web-access PDF extraction",
	[
		"FEYNMAN_FETCH_CACHE_DIR",
		'join(process.cwd(), ".feynman", "cache", "fetch-content")',
		"const enabled = pdf.enabled !== false;",
		'import {',
		'extractPDFViaDatalab',
		'export type PDFProvider = "auto" | "gemini" | "datalab" | "unpdf";',
	],
);
requireMarkers(
	readArchivedText(
		archivePath,
		"npm/node_modules/pi-web-access/extract.ts",
	),
	"runtime pi-web-access direct image gate",
	[
		'import { isImageEnabled } from "./feature-config.ts";',
		"Image fetching is disabled by image.enabled",
	],
);
requireMarkers(
	readArchivedText(
		archivePath,
		"npm/node_modules/pi-web-access/video-extract.ts",
	),
	"runtime pi-web-access video image gate",
	[
		'import { canAttachImages } from "./feature-config.ts";',
		"if (canAttachImages()) {",
	],
);
requireMarkers(
	readArchivedText(
		archivePath,
		"npm/node_modules/pi-web-access/duckduckgo.ts",
	),
	"runtime pi-web-access DuckDuckGo provider",
	[
		'const SEARCH_URL = "https://html.duckduckgo.com/html/";',
		"export function isDuckDuckGoAvailable",
		"export async function searchWithDuckDuckGo",
	],
);
requireMarkers(
	readArchivedText(
		archivePath,
		"npm/node_modules/pi-web-access/bocha.ts",
	),
	"runtime pi-web-access Bocha provider",
	[
		"export function isBochaAvailable(): boolean",
		"export async function searchWithBocha(",
		"BOCHA_API_KEY",
	],
);
requireMarkers(
	readArchivedText(
		archivePath,
		"npm/node_modules/pi-web-access/datalab-pdf-extract.ts",
	),
	"runtime pi-web-access Datalab extraction",
	[
		"export async function extractPDFViaDatalab",
		"export function isDatalabApiAvailable",
	],
);
if (
	readArchivedJson(
		archivePath,
		"npm/node_modules/@modelcontextprotocol/sdk/package.json",
	).dependencies?.["@hono/node-server"] !== "2.1.1"
) {
	fail("runtime MCP SDK does not pin @hono/node-server 2.1.1");
}
if (
	readArchivedJson(
		archivePath,
		"npm/node_modules/@hono/node-server/package.json",
	).version !== "2.1.1"
) {
	fail("runtime Hono node server is not 2.1.1");
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
	piDocparserVersion: expectedPiDocparserVersion,
	ipAddressVersion: FEYNMAN_IP_ADDRESS_VERSION,
	liteparseGitHead: FEYNMAN_LITEPARSE_GIT_HEAD,
	liteparseVersion: FEYNMAN_LITEPARSE_VERSION,
	piWebAccessVersion: expectedPiWebAccessVersion,
	undiciVersion: FEYNMAN_UNDICI_VERSION,
	runtimePackages: runtimeManifest.packageSpecs.length,
	runtimeArchiveSha256: computeFileSha256(archivePath),
}));
