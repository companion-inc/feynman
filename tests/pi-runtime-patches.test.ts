import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { patchPiRuntimeNodeModules } from "../src/pi/runtime-patches.js";

const SOURCE = `
async function prepareToolCall(currentContext, assistantMessage, toolCall, config, signal) {
    const tool = currentContext.tools?.find((t) => t.name === toolCall.name);
    if (!tool) {
        return {
            kind: "immediate",
            result: createErrorToolResult(\`Tool \${toolCall.name} not found\`),
            isError: true,
        };
    }
    try {
        const preparedToolCall = prepareToolCallArguments(tool, toolCall);
        const validatedArgs = validateToolArguments(tool, preparedToolCall);
        if (config.beforeToolCall) {
            const beforeResult = await config.beforeToolCall({
                assistantMessage,
                toolCall,
                args: validatedArgs,
                context: currentContext,
            }, signal);
        }
        return {
            kind: "prepared",
            toolCall,
            tool,
            args: validatedArgs,
        };
    }
    catch (error) {
        return {
            kind: "immediate",
            result: createErrorToolResult(error instanceof Error ? error.message : String(error)),
            isError: true,
        };
    }
}
`;

const TUI_SOURCE = `
        const renderEnd = Math.min(lastChanged, newLines.length - 1);
        for (let i = firstChanged; i <= renderEnd; i++) {
            if (i > firstChanged)
                buffer += "\\r\\n";
            buffer += "\\x1b[2K"; // Clear current line
            const line = newLines[i];
            const isImage = isImageLine(line);
            if (!isImage && visibleWidth(line) > width) {
                // Log all lines to crash file for debugging
                const crashLogPath = path.join(os.homedir(), ".pi", "agent", "pi-crash.log");
                const crashData = [
                    \`Crash at \${new Date().toISOString()}\`,
                    \`Terminal width: \${width}\`,
                    \`Line \${i} visible width: \${visibleWidth(line)}\`,
                    "",
                    "=== All rendered lines ===",
                    ...newLines.map((l, idx) => \`[\${idx}] (w=\${visibleWidth(l)}) \${l}\`),
                    "",
                ].join("\\n");
                fs.mkdirSync(path.dirname(crashLogPath), { recursive: true });
                fs.writeFileSync(crashLogPath, crashData);
                // Clean up terminal state before throwing
                this.stop();
                const errorMsg = [
                    \`Rendered line \${i} exceeds terminal width (\${visibleWidth(line)} > \${width}).\`,
                    "",
                    "This is likely caused by a custom TUI component not truncating its output.",
                    "Use visibleWidth() to measure and truncateToWidth() to truncate lines.",
                    "",
                    \`Debug log written to: \${crashLogPath}\`,
                ].join("\\n");
                throw new Error(errorMsg);
            }
            buffer += line;
        }
`;

const EDITOR_SOURCE = `
import { getSegmenter, isPunctuationChar, isWhitespaceChar, truncateToWidth, visibleWidth } from "../utils.js";

export class Editor {
    render(width) {
        const layoutLines = this.layoutText(width);
        return layoutLines.map((line) => line.text);
    }
    handleInput(data) {
        return data;
    }
}
`;

const THEME_SOURCE = `
export function getEditorTheme() {
    return {
        borderColor: (text) => theme.fg("borderMuted", text),
        selectList: getSelectListTheme(),
    };
}
export function getSettingsListTheme() {
    return {};
}
`;

const INTERACTIVE_UPDATE_NOTICE_SOURCE = [
	"    showPackageUpdateNotification(packages) {",
	'        const action = theme.fg("accent", `${APP_NAME} update --extensions`);',
	'        const updateInstruction = theme.fg("muted", "Package updates are available. Run ") + action;',
	"    }",
].join("\n");

const PI_OTEL_CONFIG_SOURCE = `    const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ??
        merged?.endpoint ??
        "http://127.0.0.1:4317";
    const protocol = normalizeProtocol(process.env.OTEL_EXPORTER_OTLP_PROTOCOL ?? merged?.protocol);
    const headers = {
        ...(merged?.headers ?? {}),
        ...parseKvList(process.env.OTEL_EXPORTER_OTLP_HEADERS),
    };`;

const SESSION_SEARCH_INDEXER_SOURCE = `
export async function indexAllSessions() {
    const sessionsDir = path.join(os.homedir(), ".pi", "agent", "sessions");
    const files = findSessionFiles(sessionsDir);
    return files.length;
}
`;

const ALPHA_SEARCH_SOURCE = `
function getErrorMessage(err) {
  return err instanceof Error ? err.message : String(err);
}

async function getValidToken() {
  return null;
}

async function callTool(name, args) {
  return { name, args };
}

export async function searchByEmbedding(query) {
  return await callTool('embedding_similarity_search', { query });
}

export async function searchByKeyword(query) {
  return await callTool('full_text_papers_search', { query });
}

export async function agenticSearch(query) {
  return await callTool('agentic_paper_retrieval', { query });
}
`;

const WEB_ACCESS_INDEX_SOURCE = `
import { join } from "node:path";
import { homedir } from "node:os";
const WEB_SEARCH_CONFIG_PATH = join(homedir(), ".pi", "web-search.json");
function saveConfig() {
    const dir = join(homedir(), ".pi");
}
async function execute(params, configWorkflow, ctx) {
    const workflow = resolveWorkflow(params.workflow ?? configWorkflow, ctx?.hasUI !== false);
}
pi.registerCommand("search", { description: "Browse stored web search results" });
`;

const WEB_ACCESS_PDF_SOURCE = `
import { join, basename } from "node:path";
import { tmpdir } from "node:os";
const DEFAULT_OUTPUT_DIR = join(tmpdir(), "pi-web-pdf");
`;

const SUBAGENT_PI_SPAWN_SOURCE = `
export interface PiSpawnDeps {
	execPath?: string;
	argv1?: string;
}

export function resolveWindowsPiCliScript(deps: PiSpawnDeps = {}): string | undefined {
	const existsSync = deps.existsSync ?? fs.existsSync;
	const argv1 = deps.argv1 ?? process.argv[1];

	if (argv1) {
		const argvPath = normalizePath(argv1);
		if (isRunnableNodeScript(argvPath, existsSync)) {
			return argvPath;
		}
	}
}
`;

const MODEL_REGISTRY_SOURCE = `
export { clearApiKeyCache } from "./provider-composer.js";
export class ModelRegistry {
    async getApiKeyAndHeaders(model) {
        try {
            const resolution = await this.runtime.getAuth(model);
            if (!resolution) {
                const compatibility = this.runtime.getCompatibilityRequestConfig(model);
                const headers = compatibility.headers
                    ? Object.fromEntries(Object.entries(compatibility.headers).filter((entry) => entry[1] !== null))
                    : undefined;
                return { ok: true, headers };
            }
            const headers = resolution.auth.headers
                ? Object.fromEntries(Object.entries(resolution.auth.headers).filter((entry) => entry[1] !== null))
                : undefined;
            return { ok: true, apiKey: resolution.auth.apiKey, headers, env: resolution.env };
        }
        catch (error) {
            return { ok: false, error: String(error) };
        }
    }
}
`;

const MODEL_RUNTIME_SOURCE = `
function mergeHeaders(base, override) {
    return { ...base, ...override };
}
export class ModelRuntime {
    async prepareRequest(model, options) {
        const resolution = await this.getAuth(model, { apiKey: options?.apiKey, env: options?.env });
        const { transformHeaders, ...providerOptions } = options ?? {};
        let headers = mergeHeaders(resolution.auth.headers, providerOptions.headers);
        if (transformHeaders)
            headers = await transformHeaders(headers ?? {});
        return {
            options: {
                ...providerOptions,
                apiKey: providerOptions.apiKey ?? resolution.auth.apiKey,
                headers,
            },
        };
    }
}
`;

const LLAMA_PROVIDER_SOURCE = `
const LLAMA_PROVIDER_ID = "llama.cpp";
function toPiModel(model, serverUrl) {
    return {
        ...model,
        baseUrl: serverUrl,
        compat: {
            supportsUsageInStreaming: true,
        },
    };
}
export function createLlamaProvider() {
    let models = [];
	    return {
	        refreshModels: async (context) => {
	            const stored = await context.store.read();
	            if (stored) {
	                models = stored.models.filter((model) => model.provider === LLAMA_PROVIDER_ID && model.api === "openai-completions");
	            }
	            if (!context.allowNetwork || context.signal?.aborted || context.credential?.type !== "api_key")
	                return;
	            const serverUrl = credentialServerUrl(context.credential);
	            if (!serverUrl)
	                return;
	            const catalog = await new LlamaClient(serverUrl, context.credential.key).list({ signal: context.signal });
	            setCatalog(catalog, serverUrl);
	            if (!context.signal?.aborted)
	                await context.store.write({ models, checkedAt: Date.now() });
	        },
	    };
	}
`.replaceAll("\t", "");

test("patchPiRuntimeNodeModules patches installed Pi runtime files", async () => {
	const appRoot = mkdtempSync(join(tmpdir(), "feynman-runtime-patches-"));
	const agentLoopPath = join(appRoot, "node_modules", "@earendil-works", "pi-agent-core", "dist", "agent-loop.js");
	const tuiPath = join(appRoot, "node_modules", "@earendil-works", "pi-tui", "dist", "tui.js");
	const editorPath = join(appRoot, "node_modules", "@earendil-works", "pi-tui", "dist", "components", "editor.js");
	const themePath = join(appRoot, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "modes", "interactive", "theme", "theme.js");
	const updateNoticePath = join(appRoot, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "modes", "interactive", "interactive-mode.js");
	const packageJsonPath = join(appRoot, "node_modules", "@earendil-works", "pi-coding-agent", "package.json");
	const nestedAgentLoopPath = join(
		dirname(packageJsonPath),
		"node_modules",
		"@earendil-works",
		"pi-agent-core",
		"dist",
		"agent-loop.js",
	);
	const nestedTuiPath = join(
		dirname(packageJsonPath),
		"node_modules",
		"@earendil-works",
		"pi-tui",
		"dist",
		"tui.js",
	);
	const nestedEditorPath = join(
		dirname(packageJsonPath),
		"node_modules",
		"@earendil-works",
		"pi-tui",
		"dist",
		"components",
		"editor.js",
	);
	const modelRegistryPath = join(appRoot, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "core", "model-registry.js");
	const modelRuntimePath = join(appRoot, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "core", "model-runtime.js");
	const mcpManifestPath = join(appRoot, "node_modules", "@modelcontextprotocol", "sdk", "package.json");
	const alphaSearchPath = join(appRoot, "node_modules", "@companion-ai", "alpha-hub", "src", "lib", "alphaxiv.js");
	const sessionSearchPath = join(appRoot, "node_modules", "@kaiserlich-dev", "pi-session-search", "extensions", "indexer.ts");
	await mkdir(dirname(agentLoopPath), { recursive: true });
	await mkdir(dirname(tuiPath), { recursive: true });
	await mkdir(dirname(editorPath), { recursive: true });
	await mkdir(dirname(themePath), { recursive: true });
	await mkdir(dirname(updateNoticePath), { recursive: true });
	await mkdir(dirname(packageJsonPath), { recursive: true });
	await mkdir(dirname(nestedAgentLoopPath), { recursive: true });
	await mkdir(dirname(nestedTuiPath), { recursive: true });
	await mkdir(dirname(nestedEditorPath), { recursive: true });
	await mkdir(dirname(modelRegistryPath), { recursive: true });
	await mkdir(dirname(modelRuntimePath), { recursive: true });
	await mkdir(dirname(mcpManifestPath), { recursive: true });
	await mkdir(dirname(alphaSearchPath), { recursive: true });
	await mkdir(dirname(sessionSearchPath), { recursive: true });
	writeFileSync(agentLoopPath, SOURCE, "utf8");
	writeFileSync(tuiPath, TUI_SOURCE, "utf8");
	writeFileSync(editorPath, EDITOR_SOURCE, "utf8");
	writeFileSync(nestedAgentLoopPath, SOURCE, "utf8");
	writeFileSync(nestedTuiPath, TUI_SOURCE, "utf8");
	writeFileSync(nestedEditorPath, EDITOR_SOURCE, "utf8");
	writeFileSync(themePath, THEME_SOURCE, "utf8");
	writeFileSync(updateNoticePath, INTERACTIVE_UPDATE_NOTICE_SOURCE, "utf8");
	writeFileSync(
		packageJsonPath,
		JSON.stringify({
			name: "@earendil-works/pi-coding-agent",
			version: "0.83.0",
			piConfig: { configDir: ".pi" },
		}, null, 2) + "\n",
		"utf8",
	);
	writeFileSync(
		join(dirname(dirname(agentLoopPath)), "package.json"),
		JSON.stringify({ name: "@earendil-works/pi-agent-core", version: "0.83.0" }, null, 2) + "\n",
		"utf8",
	);
	writeFileSync(
		join(dirname(dirname(tuiPath)), "package.json"),
		JSON.stringify({ name: "@earendil-works/pi-tui", version: "0.83.0" }, null, 2) + "\n",
		"utf8",
	);
	writeFileSync(
		join(dirname(dirname(nestedAgentLoopPath)), "package.json"),
		JSON.stringify({ name: "@earendil-works/pi-agent-core", version: "0.83.0" }, null, 2) + "\n",
		"utf8",
	);
	writeFileSync(
		join(dirname(dirname(nestedTuiPath)), "package.json"),
		JSON.stringify({ name: "@earendil-works/pi-tui", version: "0.83.0" }, null, 2) + "\n",
		"utf8",
	);
	writeFileSync(modelRegistryPath, MODEL_REGISTRY_SOURCE, "utf8");
	writeFileSync(modelRuntimePath, MODEL_RUNTIME_SOURCE, "utf8");
	writeFileSync(mcpManifestPath, JSON.stringify({
		name: "@modelcontextprotocol/sdk",
		dependencies: { "@hono/node-server": "^1.19.9" },
	}) + "\n", "utf8");
	writeFileSync(alphaSearchPath, ALPHA_SEARCH_SOURCE, "utf8");
	writeFileSync(sessionSearchPath, SESSION_SEARCH_INDEXER_SOURCE, "utf8");

	assert.equal(patchPiRuntimeNodeModules(appRoot), true);

	const patched = readFileSync(agentLoopPath, "utf8");
	assert.match(patched, /function normalizeFeynmanToolAlias/);
	assert.match(patched, /\["google:search", "web_search"\]/);
	assert.match(patched, /\["search_web", "web_search"\]/);
	assert.match(patched, /\["fetch", "fetch_content"\]/);
	assert.match(patched, /prepareToolCallArguments\(tool, effectiveToolCall\)/);
	assert.match(readFileSync(nestedAgentLoopPath, "utf8"), /function normalizeFeynmanToolAlias/);
	const patchedTui = readFileSync(tuiPath, "utf8");
	assert.match(patchedTui, /line = sliceByColumn\(line, 0, width, true\)/);
	assert.doesNotMatch(patchedTui, /throw new Error\(errorMsg\)/);
	assert.match(readFileSync(nestedTuiPath, "utf8"), /line = sliceByColumn\(line, 0, width, true\)/);
	assert.match(readFileSync(editorPath, "utf8"), /displayText = styleInput\(before\) \+ marker \+ styleInput\(after\)/);
	assert.match(readFileSync(nestedEditorPath, "utf8"), /displayText = styleInput\(before\) \+ marker \+ styleInput\(after\)/);
	assert.match(readFileSync(themePath, "utf8"), /input: \(text\) => theme\.fg\("text", text\)/);
	assert.match(readFileSync(updateNoticePath, "utf8"), /Feynman: package update notices use the full update command\./);
	assert.match(readFileSync(updateNoticePath, "utf8"), /`\$\{APP_NAME\} update`/);
	assert.doesNotMatch(readFileSync(updateNoticePath, "utf8"), /`\$\{APP_NAME\} update --extensions`/);
	const patchedPackageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { piConfig?: Record<string, unknown> };
	assert.equal(patchedPackageJson.piConfig?.name, "feynman");
	assert.equal(patchedPackageJson.piConfig?.configDir, ".feynman");
	assert.match(
		readFileSync(modelRuntimePath, "utf8"),
		/assertHeaderSafeRequestConfig\(model\.provider, providerOptions\.apiKey \?\? resolution\.auth\.apiKey, headers\)/,
	);
	const patchedRegistry = readFileSync(modelRegistryPath, "utf8");
	assert.match(
		patchedRegistry,
		/assertHeaderSafeRequestConfig\(model\.provider, undefined, headers\)/,
	);
	assert.match(
		patchedRegistry,
		/assertHeaderSafeRequestConfig\(model\.provider, resolution\.auth\.apiKey, headers\)/,
	);
		assert.equal(
			JSON.parse(readFileSync(mcpManifestPath, "utf8")).dependencies["@hono/node-server"],
			"2.0.12",
		);
	assert.match(readFileSync(alphaSearchPath, "utf8"), /async function searchRestFast/);
	assert.match(readFileSync(sessionSearchPath, "utf8"), /process\.env\.FEYNMAN_SESSION_DIR/);
	assert.equal(patchPiRuntimeNodeModules(appRoot), false);
});

test("patchPiRuntimeNodeModules patches the vendored runtime workspace", async () => {
	const appRoot = mkdtempSync(join(tmpdir(), "feynman-workspace-runtime-patches-"));
	const agentLoopPath = join(appRoot, ".feynman", "npm", "node_modules", "@mariozechner", "pi-agent-core", "dist", "agent-loop.js");
	const tuiPath = join(appRoot, ".feynman", "npm", "node_modules", "@mariozechner", "pi-tui", "dist", "tui.js");
	const editorPath = join(appRoot, ".feynman", "npm", "node_modules", "@mariozechner", "pi-tui", "dist", "components", "editor.js");
	const themePath = join(appRoot, ".feynman", "npm", "node_modules", "@mariozechner", "pi-coding-agent", "dist", "modes", "interactive", "theme", "theme.js");
	const updateNoticePath = join(appRoot, ".feynman", "npm", "node_modules", "@mariozechner", "pi-coding-agent", "dist", "modes", "interactive", "interactive-mode.js");
	const packageJsonPath = join(appRoot, ".feynman", "npm", "node_modules", "@mariozechner", "pi-coding-agent", "package.json");
	const webAccessPath = join(appRoot, ".feynman", "npm", "node_modules", "pi-web-access", "index.ts");
	const webAccessPdfPath = join(appRoot, ".feynman", "npm", "node_modules", "pi-web-access", "pdf-extract.ts");
	const subagentSpawnPath = join(appRoot, ".feynman", "npm", "node_modules", "pi-subagents", "src", "runs", "shared", "pi-spawn.ts");
	const piOtelConfigPath = join(appRoot, ".feynman", "npm", "node_modules", "pi-otel", "dist", "config.js");
	const sessionSearchPath = join(appRoot, ".feynman", "npm", "node_modules", "@kaiserlich-dev", "pi-session-search", "extensions", "indexer.ts");
	await mkdir(dirname(agentLoopPath), { recursive: true });
	await mkdir(dirname(tuiPath), { recursive: true });
	await mkdir(dirname(editorPath), { recursive: true });
	await mkdir(dirname(themePath), { recursive: true });
	await mkdir(dirname(updateNoticePath), { recursive: true });
	await mkdir(dirname(packageJsonPath), { recursive: true });
	await mkdir(dirname(webAccessPath), { recursive: true });
	await mkdir(dirname(webAccessPdfPath), { recursive: true });
	await mkdir(dirname(subagentSpawnPath), { recursive: true });
	await mkdir(dirname(piOtelConfigPath), { recursive: true });
	await mkdir(dirname(sessionSearchPath), { recursive: true });
	writeFileSync(agentLoopPath, SOURCE, "utf8");
	writeFileSync(tuiPath, TUI_SOURCE, "utf8");
	writeFileSync(editorPath, EDITOR_SOURCE, "utf8");
	writeFileSync(themePath, THEME_SOURCE, "utf8");
	writeFileSync(updateNoticePath, INTERACTIVE_UPDATE_NOTICE_SOURCE, "utf8");
	writeFileSync(
		packageJsonPath,
		JSON.stringify({
			name: "@mariozechner/pi-coding-agent",
			version: "0.83.0",
			piConfig: { configDir: ".pi" },
		}, null, 2) + "\n",
		"utf8",
	);
	writeFileSync(
		join(dirname(dirname(agentLoopPath)), "package.json"),
		JSON.stringify({ name: "@mariozechner/pi-agent-core", version: "0.83.0" }, null, 2) + "\n",
		"utf8",
	);
	writeFileSync(
		join(dirname(dirname(tuiPath)), "package.json"),
		JSON.stringify({ name: "@mariozechner/pi-tui", version: "0.83.0" }, null, 2) + "\n",
		"utf8",
	);
	writeFileSync(webAccessPath, WEB_ACCESS_INDEX_SOURCE, "utf8");
	writeFileSync(webAccessPdfPath, WEB_ACCESS_PDF_SOURCE, "utf8");
	writeFileSync(subagentSpawnPath, SUBAGENT_PI_SPAWN_SOURCE, "utf8");
	writeFileSync(piOtelConfigPath, PI_OTEL_CONFIG_SOURCE, "utf8");
	writeFileSync(sessionSearchPath, SESSION_SEARCH_INDEXER_SOURCE, "utf8");

	assert.equal(patchPiRuntimeNodeModules(appRoot), true);

	assert.match(readFileSync(agentLoopPath, "utf8"), /function normalizeFeynmanToolAlias/);
	assert.match(readFileSync(tuiPath, "utf8"), /line = sliceByColumn\(line, 0, width, true\)/);
	assert.match(readFileSync(editorPath, "utf8"), /displayText = styleInput\(before\) \+ marker \+ styleInput\(after\)/);
	assert.match(readFileSync(themePath, "utf8"), /input: \(text\) => theme\.fg\("text", text\)/);
	assert.match(readFileSync(updateNoticePath, "utf8"), /Feynman: package update notices use the full update command\./);
	assert.match(readFileSync(updateNoticePath, "utf8"), /`\$\{APP_NAME\} update`/);
	const patchedPackageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { piConfig?: Record<string, unknown> };
	assert.equal(patchedPackageJson.piConfig?.name, "feynman");
	assert.equal(patchedPackageJson.piConfig?.configDir, ".feynman");
	assert.match(readFileSync(webAccessPath, "utf8"), /params\.workflow \?\? configWorkflow \?\? "none"/);
	assert.match(readFileSync(webAccessPath, "utf8"), /pi\.registerCommand\("web-results"/);
	assert.match(readFileSync(webAccessPdfPath, "utf8"), /FEYNMAN_FETCH_CACHE_DIR/);
	assert.match(readFileSync(webAccessPdfPath, "utf8"), /\.feynman.*cache.*fetch-content/);
	assert.doesNotMatch(readFileSync(webAccessPdfPath, "utf8"), /pi-web-pdf|tmpdir/);
	assert.match(readFileSync(subagentSpawnPath, "utf8"), /process\.env\.FEYNMAN_PI_CLI_PATH/);
	assert.match(readFileSync(subagentSpawnPath, "utf8"), /\targv2\?: string;/);
	assert.match(readFileSync(subagentSpawnPath, "utf8"), /path\.basename\(argvPath\) !== "pi-cli-wrapper\.js"/);
	assert.match(readFileSync(piOtelConfigPath, "utf8"), /process\.env\.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT \?\?/);
	assert.match(readFileSync(piOtelConfigPath, "utf8"), /process\.env\.OTEL_EXPORTER_OTLP_TRACES_HEADERS/);
	assert.match(readFileSync(sessionSearchPath, "utf8"), /process\.env\.FEYNMAN_SESSION_DIR/);
	assert.equal(patchPiRuntimeNodeModules(appRoot), false);
});

test("patchPiRuntimeNodeModules leaves stale Pi core packages untouched while patching extensions", async () => {
	const appRoot = mkdtempSync(join(tmpdir(), "feynman-user-runtime-patches-"));
	const homeRoot = mkdtempSync(join(tmpdir(), "feynman-user-runtime-home-"));
	const agentDir = join(homeRoot, ".feynman", "agent");
	const bundledPiManifestPath = join(
		appRoot,
		"node_modules",
		"@earendil-works",
		"pi-coding-agent",
		"package.json",
	);
	const globalSpawnPath = join(
		homeRoot,
		".feynman",
		"npm-global",
		"lib",
		"node_modules",
		"pi-subagents",
		"src",
		"runs",
		"shared",
		"pi-spawn.ts",
	);
	const agentSpawnPath = join(
		agentDir,
		"npm",
		"node_modules",
		"pi-subagents",
		"src",
		"runs",
		"shared",
		"pi-spawn.ts",
	);
	const globalOtelConfigPath = join(
		homeRoot,
		".feynman",
		"npm-global",
		"lib",
		"node_modules",
		"pi-otel",
		"dist",
		"config.js",
	);
	const agentOtelConfigPath = join(agentDir, "npm", "node_modules", "pi-otel", "dist", "config.js");
	const globalSessionSearchPath = join(
		homeRoot,
		".feynman",
		"npm-global",
		"lib",
		"node_modules",
		"@kaiserlich-dev",
		"pi-session-search",
		"extensions",
		"indexer.ts",
	);
	const agentSessionSearchPath = join(
		agentDir,
		"npm",
		"node_modules",
		"@kaiserlich-dev",
		"pi-session-search",
		"extensions",
		"indexer.ts",
	);
	const agentEditorPath = join(
		agentDir,
		"npm",
		"node_modules",
		"@earendil-works",
		"pi-tui",
		"dist",
		"components",
		"editor.js",
	);
	const agentTuiManifestPath = join(
		agentDir,
		"npm",
		"node_modules",
		"@earendil-works",
		"pi-tui",
		"package.json",
	);
	const agentCodingManifestPath = join(
		agentDir,
		"npm",
		"node_modules",
		"@earendil-works",
		"pi-coding-agent",
		"package.json",
	);
	const agentModelRegistryPath = join(
		agentDir,
		"npm",
		"node_modules",
		"@earendil-works",
		"pi-coding-agent",
		"dist",
		"core",
		"model-registry.js",
	);
	const agentUpdateNoticePath = join(
		agentDir,
		"npm",
		"node_modules",
		"@earendil-works",
		"pi-coding-agent",
		"dist",
		"modes",
		"interactive",
		"interactive-mode.js",
	);
	await mkdir(dirname(globalSpawnPath), { recursive: true });
	await mkdir(dirname(agentSpawnPath), { recursive: true });
	await mkdir(dirname(globalOtelConfigPath), { recursive: true });
	await mkdir(dirname(agentOtelConfigPath), { recursive: true });
	await mkdir(dirname(globalSessionSearchPath), { recursive: true });
	await mkdir(dirname(agentSessionSearchPath), { recursive: true });
	await mkdir(dirname(bundledPiManifestPath), { recursive: true });
	await mkdir(dirname(agentEditorPath), { recursive: true });
	await mkdir(dirname(agentModelRegistryPath), { recursive: true });
	await mkdir(dirname(agentUpdateNoticePath), { recursive: true });
	writeFileSync(globalSpawnPath, SUBAGENT_PI_SPAWN_SOURCE, "utf8");
	writeFileSync(agentSpawnPath, SUBAGENT_PI_SPAWN_SOURCE, "utf8");
	writeFileSync(globalOtelConfigPath, PI_OTEL_CONFIG_SOURCE, "utf8");
	writeFileSync(agentOtelConfigPath, PI_OTEL_CONFIG_SOURCE, "utf8");
	writeFileSync(globalSessionSearchPath, SESSION_SEARCH_INDEXER_SOURCE, "utf8");
	writeFileSync(agentSessionSearchPath, SESSION_SEARCH_INDEXER_SOURCE, "utf8");
	writeFileSync(
		bundledPiManifestPath,
		JSON.stringify({ name: "@earendil-works/pi-coding-agent", version: "0.83.0" }, null, 2) + "\n",
		"utf8",
	);
	writeFileSync(
		agentTuiManifestPath,
		JSON.stringify({ name: "@earendil-works/pi-tui", version: "0.80.6" }, null, 2) + "\n",
		"utf8",
	);
	writeFileSync(
		agentCodingManifestPath,
		JSON.stringify({
			name: "@earendil-works/pi-coding-agent",
			version: "0.80.6",
			piConfig: { configDir: ".pi" },
		}, null, 2) + "\n",
		"utf8",
	);
	const staleEditorSource = "export class Editor { render() { return []; } }\n";
	const staleModelRegistrySource = "export class ModelRegistry { getModel() { return undefined; } }\n";
	writeFileSync(agentEditorPath, staleEditorSource, "utf8");
	writeFileSync(agentModelRegistryPath, staleModelRegistrySource, "utf8");
	writeFileSync(agentUpdateNoticePath, INTERACTIVE_UPDATE_NOTICE_SOURCE, "utf8");

	assert.equal(patchPiRuntimeNodeModules(appRoot, agentDir), true);

	for (const spawnPath of [globalSpawnPath, agentSpawnPath]) {
		const source = readFileSync(spawnPath, "utf8");
		assert.match(source, /process\.env\.FEYNMAN_PI_CLI_PATH/);
		assert.match(source, /\targv2\?: string;/);
		assert.match(source, /wrapperPiCliPath/);
	}
	for (const configPath of [globalOtelConfigPath, agentOtelConfigPath]) {
		const source = readFileSync(configPath, "utf8");
		assert.match(source, /process\.env\.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT \?\?/);
		assert.match(source, /process\.env\.OTEL_EXPORTER_OTLP_TRACES_HEADERS/);
	}
	for (const indexerPath of [globalSessionSearchPath, agentSessionSearchPath]) {
		const source = readFileSync(indexerPath, "utf8");
		assert.match(source, /process\.env\.FEYNMAN_SESSION_DIR/);
		assert.match(source, /process\.env\.PI_SESSION_DIR/);
	}
	assert.equal(readFileSync(agentEditorPath, "utf8"), staleEditorSource);
	assert.equal(readFileSync(agentModelRegistryPath, "utf8"), staleModelRegistrySource);
	assert.equal(readFileSync(agentUpdateNoticePath, "utf8"), INTERACTIVE_UPDATE_NOTICE_SOURCE);
	const staleCodingManifest = JSON.parse(readFileSync(agentCodingManifestPath, "utf8")) as {
		piConfig?: { configDir?: string };
	};
	assert.equal(staleCodingManifest.piConfig?.configDir, ".pi");
	assert.equal(patchPiRuntimeNodeModules(appRoot, agentDir), false);
});

test("patchPiRuntimeNodeModules repairs current Pi Undici in global and agent roots but skips stale Pi", () => {
	const appRoot = mkdtempSync(join(tmpdir(), "feynman-user-undici-patches-"));
	const homeRoot = mkdtempSync(join(tmpdir(), "feynman-user-undici-home-"));
	const agentDir = join(homeRoot, ".feynman", "agent");
	const rootNodeModules = join(appRoot, "node_modules");
	const globalNodeModules = join(homeRoot, ".feynman", "npm-global", "lib", "node_modules");
	const agentNodeModules = join(agentDir, "npm", "node_modules");
	const safeUndiciRoot = join(rootNodeModules, "undici");
	const safeBraceRoot = join(rootNodeModules, "brace-expansion");
	mkdirSync(safeUndiciRoot, { recursive: true });
	mkdirSync(safeBraceRoot, { recursive: true });
	writeFileSync(
		join(safeUndiciRoot, "package.json"),
		JSON.stringify({ name: "undici", version: "8.9.0" }),
	);
	writeFileSync(join(safeUndiciRoot, "index.js"), "export const proxyFixed = true;\n");
	writeFileSync(
		join(safeBraceRoot, "package.json"),
		JSON.stringify({ name: "brace-expansion", version: "5.0.9" }),
	);
	writeFileSync(join(safeBraceRoot, "index.js"), "export const securityFixed = true;\n");

	const writePiUndiciFixture = (
		nodeModulesRoot: string,
		scope: "@earendil-works" | "@mariozechner",
		version: string,
	) => {
		const piRoot = join(nodeModulesRoot, scope, "pi-coding-agent");
		const nestedUndiciRoot = join(piRoot, "node_modules", "undici");
		const nestedBraceRoot = join(piRoot, "node_modules", "brace-expansion");
		const llamaProviderPath = join(piRoot, "dist", "extensions", "llama", "provider.js");
		const updateNoticePath = join(piRoot, "dist", "modes", "interactive", "interactive-mode.js");
		mkdirSync(nestedUndiciRoot, { recursive: true });
		mkdirSync(nestedBraceRoot, { recursive: true });
		mkdirSync(dirname(llamaProviderPath), { recursive: true });
		mkdirSync(dirname(updateNoticePath), { recursive: true });
		writeFileSync(
			join(piRoot, "package.json"),
			JSON.stringify({
				name: `${scope}/pi-coding-agent`,
				version,
				dependencies: { "brace-expansion": "5.0.6", undici: "8.5.0" },
			}),
		);
		writeFileSync(
			join(piRoot, "npm-shrinkwrap.json"),
			JSON.stringify({
				lockfileVersion: 3,
				packages: {
					"": { dependencies: { "brace-expansion": "5.0.6", undici: "8.5.0" } },
					"node_modules/brace-expansion": { version: "5.0.6" },
					"node_modules/undici": { version: "8.5.0" },
				},
			}),
		);
		writeFileSync(
			join(nestedBraceRoot, "package.json"),
			JSON.stringify({ name: "brace-expansion", version: "5.0.6" }),
		);
		writeFileSync(
			join(nestedUndiciRoot, "package.json"),
			JSON.stringify({ name: "undici", version: "8.5.0" }),
		);
		writeFileSync(llamaProviderPath, LLAMA_PROVIDER_SOURCE);
		writeFileSync(updateNoticePath, INTERACTIVE_UPDATE_NOTICE_SOURCE);
		return { llamaProviderPath, nestedUndiciRoot, updateNoticePath };
	};

	const rootPi = writePiUndiciFixture(rootNodeModules, "@earendil-works", "0.83.0");
	const globalPi = writePiUndiciFixture(
		globalNodeModules,
		"@earendil-works",
		"0.83.0",
	);
	const agentPi = writePiUndiciFixture(
		agentNodeModules,
		"@earendil-works",
		"0.83.0",
	);
	const staleAgentPi = writePiUndiciFixture(
		agentNodeModules,
		"@mariozechner",
		"0.80.6",
	);

	assert.equal(patchPiRuntimeNodeModules(appRoot, agentDir), true);
	assert.equal(
		JSON.parse(readFileSync(join(globalPi.nestedUndiciRoot, "package.json"), "utf8")).version,
		"8.9.0",
	);
	assert.equal(
		JSON.parse(readFileSync(join(agentPi.nestedUndiciRoot, "package.json"), "utf8")).version,
		"8.9.0",
	);
	assert.equal(
		JSON.parse(readFileSync(join(staleAgentPi.nestedUndiciRoot, "package.json"), "utf8")).version,
		"8.5.0",
	);
	for (const providerPath of [globalPi.llamaProviderPath, agentPi.llamaProviderPath]) {
		assert.match(readFileSync(providerPath, "utf8"), /Feynman Pi 0\.83\.0 llama\.cpp cached usage migration/);
	}
	for (const updateNoticePath of [rootPi.updateNoticePath, globalPi.updateNoticePath, agentPi.updateNoticePath]) {
		const source = readFileSync(updateNoticePath, "utf8");
		assert.match(source, /Feynman: package update notices use the full update command\./);
		assert.match(source, /`\$\{APP_NAME\} update`/);
		assert.doesNotMatch(source, /`\$\{APP_NAME\} update --extensions`/);
	}
	assert.equal(readFileSync(staleAgentPi.llamaProviderPath, "utf8"), LLAMA_PROVIDER_SOURCE);
	assert.equal(readFileSync(staleAgentPi.updateNoticePath, "utf8"), INTERACTIVE_UPDATE_NOTICE_SOURCE);
	assert.equal(patchPiRuntimeNodeModules(appRoot, agentDir), false);
});

test("patchPiRuntimeNodeModules fails closed for unreviewed older and newer bundled Pi versions", () => {
	for (const version of ["0.82.1", "0.84.0"]) {
		const appRoot = mkdtempSync(join(tmpdir(), "feynman-unreviewed-pi-patches-"));
		try {
			const manifestPath = join(
				appRoot,
				"node_modules",
				"@earendil-works",
				"pi-coding-agent",
				"package.json",
			);
			mkdirSync(dirname(manifestPath), { recursive: true });
			writeFileSync(
				manifestPath,
				JSON.stringify({ name: "@earendil-works/pi-coding-agent", version }),
			);

			assert.throws(
				() => patchPiRuntimeNodeModules(appRoot),
				new RegExp(`expected 0\\.83\\.0, found ${version.replaceAll(".", "\\.")}`),
			);
		} finally {
			rmSync(appRoot, { recursive: true, force: true });
		}
	}
});

test("patchPiRuntimeNodeModules skips mismatched nested Pi package versions", () => {
	for (const [packageName, version, relativePath, source] of [
		["pi-agent-core", "0.82.1", "dist/agent-loop.js", SOURCE],
		["pi-tui", "0.84.0", "dist/tui.js", TUI_SOURCE],
	] as const) {
		const appRoot = mkdtempSync(join(tmpdir(), "feynman-mismatched-nested-pi-"));
		try {
			const codingRoot = join(
				appRoot,
				"node_modules",
				"@earendil-works",
				"pi-coding-agent",
			);
			const nestedRoot = join(
				codingRoot,
				"node_modules",
				"@earendil-works",
				packageName,
			);
			const targetPath = join(nestedRoot, ...relativePath.split("/"));
			mkdirSync(dirname(targetPath), { recursive: true });
			writeFileSync(
				join(codingRoot, "package.json"),
				JSON.stringify({ name: "@earendil-works/pi-coding-agent", version: "0.83.0" }),
			);
			writeFileSync(
				join(nestedRoot, "package.json"),
				JSON.stringify({ name: `@earendil-works/${packageName}`, version }),
			);
			writeFileSync(targetPath, source);

			patchPiRuntimeNodeModules(appRoot);
			assert.equal(readFileSync(targetPath, "utf8"), source);
		} finally {
			rmSync(appRoot, { recursive: true, force: true });
		}
	}
});

test("patchPiRuntimeNodeModules is a no-op when Pi agent-core is absent", () => {
	const appRoot = mkdtempSync(join(tmpdir(), "feynman-runtime-patches-missing-"));

	assert.equal(patchPiRuntimeNodeModules(appRoot), false);
});
