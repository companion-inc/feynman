import test from "node:test";
import { gunzipSync } from "node:zlib";
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import {
	PI_WEB_ACCESS_PATCH_TARGETS,
	PI_WEB_ACCESS_FORWARD_FILE_TARGETS,
	patchPiWebAccessSources,
} from "../scripts/lib/pi-web-access-patch.mjs";
import {
	assertPiAgentCorePatchSource,
	patchPiAgentCoreSource,
} from "../scripts/lib/pi-agent-core-patch.mjs";
import { patchPiRuntimeNodeModules } from "../src/pi/runtime-patches.js";
import { writePiOtelFixture } from "./helpers/pi-otel-fixture.js";
import { reviewedPiSource } from "./helpers/pi-runtime-0851-fixture.js";
import { ESBUILD_OPTIONAL_DEPENDENCIES } from "../scripts/lib/pi-esbuild-package-patch.mjs";

const PI_AGENT_LOOP_SOURCE = reviewedPiSource("pi-agent-core/dist/agent-loop.js");
const PI_TUI_SOURCE = reviewedPiSource("pi-tui/dist/tui.js");
const PI_EDITOR_SOURCE = reviewedPiSource("pi-tui/dist/components/editor.js");
const PI_THEME_SOURCE = reviewedPiSource("pi-coding-agent/dist/modes/interactive/theme/theme.js");
const PI_UPDATE_NOTICE_SOURCE = reviewedPiSource("pi-coding-agent/dist/modes/interactive/interactive-mode.js");
const PI_MODEL_REGISTRY_SOURCE = reviewedPiSource("pi-coding-agent/dist/core/model-registry.js");
const PI_MODEL_RUNTIME_SOURCE = reviewedPiSource("pi-coding-agent/dist/core/model-runtime.js");
const PI_LLAMA_SOURCE = reviewedPiSource("pi-coding-agent/dist/extensions/llama/provider.js");
const PI_CLI_ARGS_SOURCE = reviewedPiSource("pi-coding-agent/dist/cli/args.js");

function writePiCliArgsFixture(piCodingAgentRoot: string): void {
	const argsPath = join(piCodingAgentRoot, "dist", "cli", "args.js");
	mkdirSync(dirname(argsPath), { recursive: true });
	writeFileSync(argsPath, PI_CLI_ARGS_SOURCE, "utf8");
}

const SOURCE = `
async function streamAssistantResponse(context, config, signal, emit, streamFunction) {
    const llmContext = { systemPrompt: "", messages: [], tools: [] };
    const resolvedApiKey = config.apiKey;
    const response = await streamFunction(config.model, llmContext, {
        ...config,
        apiKey: resolvedApiKey,
        signal,
    });
    let partialMessage = null;
    let addedPartial = false;
    for await (const event of response) {
        if (event.type === "start") {
            partialMessage = event.partial;
            context.messages.push(partialMessage);
            addedPartial = true;
        }
    }
    const finalMessage = await response.result();
    if (addedPartial) {
        context.messages[context.messages.length - 1] = finalMessage;
    }
    return finalMessage;
}

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

test("AgentCore upgrades known stale markers and rejects reordered or no-op rejection handlers", () => {
	const canonical = patchPiAgentCoreSource(SOURCE);
	const nextSequence = `        const next = iterator.next();
        // A timeout or caller abort cannot cancel every provider iterator. Attach a
        // rejection handler before racing so a late provider failure is not reported
        // as an unhandled rejection after this turn has already settled.
        next.catch(() => {});
        const pending = [next];`;
	const staleMarkerBearing = canonical
		.replace(
			'    const configured = parseFeynmanStreamIdleTimeoutMs(config?.streamIdleTimeoutMs, "streamIdleTimeoutMs");',
			'    const configured = parseFeynmanStreamIdleTimeoutMs(config.streamIdleTimeoutMs, "streamIdleTimeoutMs");',
		)
		.replace(nextSequence, "        const pending = [iterator.next()];");
	assert.notEqual(staleMarkerBearing, canonical);
	assert.throws(
		() => assertPiAgentCorePatchSource(staleMarkerBearing),
		/missing .*streamIdleTimeoutMs|missing exact provider iterator/,
	);
	assert.equal(patchPiAgentCoreSource(staleMarkerBearing), canonical);

	const reorderedCatch = canonical.replace(
		nextSequence,
		`        const next = iterator.next();
        // A timeout or caller abort cannot cancel every provider iterator. Attach a
        // rejection handler before racing so a late provider failure is not reported
        // as an unhandled rejection after this turn has already settled.
        const pending = [next];
        next.catch(() => {});`,
	);
	const noOpCatch = canonical.replace(
		"        next.catch(() => {});",
		"        void next.catch;",
	);
	for (const mutation of [reorderedCatch, noOpCatch]) {
		assert.notEqual(mutation, canonical);
		assert.throws(
			() => assertPiAgentCorePatchSource(mutation),
			/missing exact provider iterator next\/catch\/pending sequence/,
		);
		assert.throws(
			() => patchPiAgentCoreSource(mutation),
			/missing exact provider iterator next\/catch\/pending sequence/,
		);
	}
});

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

const SESSION_SEARCH_INDEXER_SOURCE = `
export async function indexAllSessions() {
    const sessionsDir = path.join(os.homedir(), ".pi", "agent", "sessions");
    const files = findSessionFiles(sessionsDir);
    return files.length;
}
`;

const ALPHA_SEARCH_SOURCE = gunzipSync(Buffer.from(
	"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",
	"base64",
)).toString("utf8");


const PI_WEB_ACCESS_FIXTURE_ROOT = join(import.meta.dirname, "..", "fixtures", "pi-web-access-0.28.0");
const PI_WEB_ACCESS_FORWARD_FIXTURE_ROOT = join(import.meta.dirname, "..", "fixtures", "pi-web-access-0.28.0");
function writePiWebAccessFixture(webRoot: string, version = "0.28.0", patched = false): void {
	mkdirSync(webRoot, { recursive: true });
	const sources = new Map(
		PI_WEB_ACCESS_PATCH_TARGETS.map((relativePath) => [
			relativePath,
			readFileSync(
				PI_WEB_ACCESS_FORWARD_FILE_TARGETS.includes(relativePath)
					? join(PI_WEB_ACCESS_FORWARD_FIXTURE_ROOT, relativePath)
					: join(PI_WEB_ACCESS_FIXTURE_ROOT, relativePath),
				"utf8",
			),
		]),
	);
	const fixtureSources = patched ? patchPiWebAccessSources(sources, "test fixture") : sources;
	for (const relativePath of PI_WEB_ACCESS_PATCH_TARGETS) {
		const path = join(webRoot, relativePath);
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, fixtureSources.get(relativePath) ?? "", "utf8");
	}
	writeFileSync(
		join(webRoot, "package.json"),
		JSON.stringify({ name: "pi-web-access", version }, null, 2) + "\n",
		"utf8",
	);
}

function writePiWebAccessForwardFixtures(appRoot: string): void {
	for (const relativePath of PI_WEB_ACCESS_FORWARD_FILE_TARGETS) {
		const fixturePath = join(appRoot, "fixtures", "pi-web-access-0.28.0", relativePath);
		mkdirSync(dirname(fixturePath), { recursive: true });
		writeFileSync(
			fixturePath,
			readFileSync(join(PI_WEB_ACCESS_FORWARD_FIXTURE_ROOT, relativePath), "utf8"),
			"utf8",
		);
	}
}

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
            if (context.stored) {
                const restored = context.stored.models.filter((model) => model.provider === LLAMA_PROVIDER_ID && model.api === "openai-completions");
                if (!(await context.publish({
                    update: () => {
                        models = restored;
                    },
                }))) {
                    return;
                }
            }
            if (!context.allowNetwork || context.signal.aborted || context.credential?.type !== "api_key")
                return;
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
	const alphaSearchPath = join(appRoot, "node_modules", "@advaitpaliwal", "alpha-hub", "src", "lib", "alphaxiv.js");
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
	writeFileSync(agentLoopPath, PI_AGENT_LOOP_SOURCE, "utf8");
	writeFileSync(tuiPath, PI_TUI_SOURCE, "utf8");
	writeFileSync(editorPath, PI_EDITOR_SOURCE, "utf8");
	writeFileSync(nestedAgentLoopPath, PI_AGENT_LOOP_SOURCE, "utf8");
	writeFileSync(nestedTuiPath, PI_TUI_SOURCE, "utf8");
	writeFileSync(nestedEditorPath, PI_EDITOR_SOURCE, "utf8");
	writeFileSync(themePath, PI_THEME_SOURCE, "utf8");
	writeFileSync(updateNoticePath, PI_UPDATE_NOTICE_SOURCE, "utf8");
	writeFileSync(
		packageJsonPath,
		JSON.stringify({
			name: "@earendil-works/pi-coding-agent",
			version: "0.85.1",
			piConfig: { configDir: ".pi" },
		}, null, 2) + "\n",
		"utf8",
	);
	writePiCliArgsFixture(dirname(packageJsonPath));
	writeFileSync(
		join(dirname(dirname(agentLoopPath)), "package.json"),
		JSON.stringify({ name: "@earendil-works/pi-agent-core", version: "0.85.1" }, null, 2) + "\n",
		"utf8",
	);
	writeFileSync(
		join(dirname(dirname(tuiPath)), "package.json"),
		JSON.stringify({ name: "@earendil-works/pi-tui", version: "0.85.1" }, null, 2) + "\n",
		"utf8",
	);
	writeFileSync(
		join(dirname(dirname(nestedAgentLoopPath)), "package.json"),
		JSON.stringify({ name: "@earendil-works/pi-agent-core", version: "0.85.1" }, null, 2) + "\n",
		"utf8",
	);
	writeFileSync(
		join(dirname(dirname(nestedTuiPath)), "package.json"),
		JSON.stringify({ name: "@earendil-works/pi-tui", version: "0.85.1" }, null, 2) + "\n",
		"utf8",
	);
	writeFileSync(modelRegistryPath, PI_MODEL_REGISTRY_SOURCE, "utf8");
	writeFileSync(modelRuntimePath, PI_MODEL_RUNTIME_SOURCE, "utf8");
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
	assert.ok(
		/line = sliceByColumn\(line, 0, width, true\)/.test(patchedTui) ||
			/export class TuiBase extends Container/.test(patchedTui),
		"Pi 0.85.1 TUI owns overflow in the current split layout or has the reviewed truncation",
	);
	assert.doesNotMatch(patchedTui, /throw new Error\(errorMsg\)/);
	const patchedNestedTui = readFileSync(nestedTuiPath, "utf8");
	assert.ok(
		/line = sliceByColumn\(line, 0, width, true\)/.test(patchedNestedTui) ||
			/export class TuiBase extends Container/.test(patchedNestedTui),
	);
	assert.ok(/displayText = styleInput\(before\) \+ marker \+ styleInput\(after\)/.test(readFileSync(editorPath, "utf8")) || /applyBackgroundToLine/.test(readFileSync(editorPath, "utf8")));
	assert.ok(/displayText = styleInput\(before\) \+ marker \+ styleInput\(after\)/.test(readFileSync(nestedEditorPath, "utf8")) || /applyBackgroundToLine/.test(readFileSync(nestedEditorPath, "utf8")));
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
		/assertHeaderSafeRequestConfig\(model\.provider, undefined, compatibility\.headers\)/,
	);
	assert.match(
		patchedRegistry,
		/assertHeaderSafeRequestConfig\(model\.provider, resolution\.auth\.apiKey, resolution\.auth\.headers\)/,
	);
		assert.equal(
			JSON.parse(readFileSync(mcpManifestPath, "utf8")).dependencies["@hono/node-server"],
			"2.1.1",
		);
	assert.match(readFileSync(alphaSearchPath, "utf8"), /async function searchRestFast/);
	assert.match(
		readFileSync(alphaSearchPath, "utf8"),
		/return await callTool\('answer_pdf_queries', \{ paper: url, queries: \[query\] \}\)/,
	);
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
	await mkdir(dirname(sessionSearchPath), { recursive: true });
	writeFileSync(agentLoopPath, PI_AGENT_LOOP_SOURCE, "utf8");
	writeFileSync(tuiPath, PI_TUI_SOURCE, "utf8");
	writeFileSync(editorPath, PI_EDITOR_SOURCE, "utf8");
	writeFileSync(themePath, PI_THEME_SOURCE, "utf8");
	writeFileSync(updateNoticePath, PI_UPDATE_NOTICE_SOURCE, "utf8");
	writeFileSync(
		packageJsonPath,
		JSON.stringify({
			name: "@mariozechner/pi-coding-agent",
			version: "0.85.1",
			piConfig: { configDir: ".pi" },
		}, null, 2) + "\n",
		"utf8",
	);
	writePiCliArgsFixture(dirname(packageJsonPath));
	writeFileSync(
		join(dirname(dirname(agentLoopPath)), "package.json"),
		JSON.stringify({ name: "@mariozechner/pi-agent-core", version: "0.85.1" }, null, 2) + "\n",
		"utf8",
	);
	writeFileSync(
		join(dirname(dirname(tuiPath)), "package.json"),
		JSON.stringify({ name: "@mariozechner/pi-tui", version: "0.85.1" }, null, 2) + "\n",
		"utf8",
	);
	writePiWebAccessFixture(dirname(webAccessPath));
	writeFileSync(subagentSpawnPath, SUBAGENT_PI_SPAWN_SOURCE, "utf8");
	writePiOtelFixture(dirname(dirname(piOtelConfigPath)));
	writeFileSync(sessionSearchPath, SESSION_SEARCH_INDEXER_SOURCE, "utf8");

	assert.equal(patchPiRuntimeNodeModules(appRoot), true);

	assert.match(readFileSync(agentLoopPath, "utf8"), /function normalizeFeynmanToolAlias/);
	assert.ok(/line = sliceByColumn\(line, 0, width, true\)/.test(readFileSync(tuiPath, "utf8")) || /export class TuiBase extends Container/.test(readFileSync(tuiPath, "utf8")));
	assert.ok(/displayText = styleInput\(before\) \+ marker \+ styleInput\(after\)/.test(readFileSync(editorPath, "utf8")) || /applyBackgroundToLine/.test(readFileSync(editorPath, "utf8")));
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
	assert.match(readFileSync(piOtelConfigPath, "utf8"), /createFeynmanSignalConfig\("traces"\)/);
	assert.match(readFileSync(piOtelConfigPath, "utf8"), /createFeynmanSignalConfig\("metrics"\)/);
	assert.match(readFileSync(piOtelConfigPath, "utf8"), /createFeynmanSignalConfig\("logs"\)/);
	assert.match(readFileSync(sessionSearchPath, "utf8"), /process\.env\.FEYNMAN_SESSION_DIR/);
	assert.equal(patchPiRuntimeNodeModules(appRoot), false);
});

test("patchPiRuntimeNodeModules adds reviewed forward files to a fresh pi-web-access install", () => {
	const appRoot = mkdtempSync(join(tmpdir(), "feynman-web-forward-files-"));
	const webRoot = join(appRoot, ".feynman", "npm", "node_modules", "pi-web-access");
	const sanitizerPath = join(webRoot, "data-uri-sanitize.ts");
	writePiWebAccessFixture(webRoot);
	rmSync(sanitizerPath);
	writePiWebAccessForwardFixtures(appRoot);

	assert.equal(patchPiRuntimeNodeModules(appRoot), true);
	assert.equal(
		readFileSync(sanitizerPath, "utf8"),
		readFileSync(join(PI_WEB_ACCESS_FORWARD_FIXTURE_ROOT, "data-uri-sanitize.ts"), "utf8"),
	);
	assert.equal(patchPiRuntimeNodeModules(appRoot), false);
});

test("patchPiRuntimeNodeModules rejects unsupported pi-web-access versions before launch", async () => {
	const appRoot = mkdtempSync(join(tmpdir(), "feynman-future-web-runtime-patches-"));
	const webRoot = join(appRoot, ".feynman", "npm", "node_modules", "pi-web-access");
	const webAccessPath = join(webRoot, "index.ts");
	writePiWebAccessFixture(webRoot, "0.29.0");
	const originalSource = readFileSync(webAccessPath, "utf8");

	assert.throws(
		() => patchPiRuntimeNodeModules(appRoot),
		/expected 0\.28\.0, found 0\.29\.0/,
	);
	assert.equal(readFileSync(webAccessPath, "utf8"), originalSource);
});

test("patchPiRuntimeNodeModules patches the Windows npm prefix layout", () => {
	const appRoot = mkdtempSync(join(tmpdir(), "feynman-windows-runtime-patches-"));
	const homeRoot = mkdtempSync(join(tmpdir(), "feynman-windows-runtime-home-"));
	const agentDir = join(homeRoot, ".feynman", "agent");
	const bundledPiManifestPath = join(
		appRoot,
		"node_modules",
		"@earendil-works",
		"pi-coding-agent",
		"package.json",
	);
	const webRoot = join(
		homeRoot,
		".feynman",
		"npm-global",
		"node_modules",
		"pi-web-access",
	);
	const webAccessPath = join(webRoot, "index.ts");
	mkdirSync(dirname(bundledPiManifestPath), { recursive: true });
	writeFileSync(
		bundledPiManifestPath,
		JSON.stringify({
			name: "@earendil-works/pi-coding-agent",
			version: "0.85.1",
		}, null, 2) + "\n",
		"utf8",
	);
	writePiCliArgsFixture(dirname(bundledPiManifestPath));
	writePiWebAccessFixture(webRoot, "0.28.0");

	assert.equal(patchPiRuntimeNodeModules(appRoot, agentDir, "win32"), true);
	assert.match(readFileSync(webAccessPath, "utf8"), /pi\.registerCommand\("web-results"/);
	assert.doesNotMatch(readFileSync(webAccessPath, "utf8"), /pi\.registerCommand\("search"/);
});

test("patchPiRuntimeNodeModules rejects unreviewed web source before writing any file", () => {
	const appRoot = mkdtempSync(join(tmpdir(), "feynman-atomic-web-runtime-patches-"));
	const webRoot = join(appRoot, ".feynman", "npm", "node_modules", "pi-web-access");
	writePiWebAccessFixture(webRoot, "0.28.0");
	const indexPath = join(webRoot, "index.ts");
	const pageQueryPath = join(webRoot, "page-query.ts");
	writeFileSync(
			pageQueryPath,
			readFileSync(pageQueryPath, "utf8").replace(
				"modelMatchesEnabledPatterns(model, loadEnabledModelPatterns(ctx))",
				"futureModelScopeCheck(model, ctx)",
		),
		"utf8",
	);

	assert.throws(
		() => patchPiRuntimeNodeModules(appRoot),
		/page-query\.ts: unreviewed digest/,
	);
	assert.match(readFileSync(indexPath, "utf8"), /pi\.registerCommand\("search"/);
	assert.doesNotMatch(readFileSync(indexPath, "utf8"), /pi\.registerCommand\("web-results"/);
	assert.match(readFileSync(pageQueryPath, "utf8"), /futureModelScopeCheck/);
});

test("patchPiRuntimeNodeModules validates non-model web invariants before writing any file", () => {
	const appRoot = mkdtempSync(join(tmpdir(), "feynman-atomic-web-non-model-patches-"));
	const webRoot = join(appRoot, ".feynman", "npm", "node_modules", "pi-web-access");
	writePiWebAccessFixture(webRoot, "0.28.0", true);
	const indexPath = join(webRoot, "index.ts");
	writeFileSync(
		indexPath,
		readFileSync(indexPath, "utf8")
			.replace('pi.registerCommand("web-results",', 'pi.registerCommand("search",')
			.replace("const SEARCH_CALL_TIMEOUT_MS = 90000;", "const FUTURE_SEARCH_CALL_TIMEOUT_MS = 90000;"),
		"utf8",
	);

	assert.throws(
		() => patchPiRuntimeNodeModules(appRoot),
		/index\.ts: unreviewed digest/,
	);
	assert.match(readFileSync(indexPath, "utf8"), /pi\.registerCommand\("search"/);
	assert.doesNotMatch(readFileSync(indexPath, "utf8"), /pi\.registerCommand\("web-results"/);
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
	await mkdir(dirname(globalSessionSearchPath), { recursive: true });
	await mkdir(dirname(agentSessionSearchPath), { recursive: true });
	await mkdir(dirname(bundledPiManifestPath), { recursive: true });
	await mkdir(dirname(agentEditorPath), { recursive: true });
	await mkdir(dirname(agentModelRegistryPath), { recursive: true });
	await mkdir(dirname(agentUpdateNoticePath), { recursive: true });
	writeFileSync(globalSpawnPath, SUBAGENT_PI_SPAWN_SOURCE, "utf8");
	writeFileSync(agentSpawnPath, SUBAGENT_PI_SPAWN_SOURCE, "utf8");
	writePiOtelFixture(dirname(dirname(globalOtelConfigPath)));
	writePiOtelFixture(dirname(dirname(agentOtelConfigPath)));
	writeFileSync(globalSessionSearchPath, SESSION_SEARCH_INDEXER_SOURCE, "utf8");
	writeFileSync(agentSessionSearchPath, SESSION_SEARCH_INDEXER_SOURCE, "utf8");
	writeFileSync(
		bundledPiManifestPath,
		JSON.stringify({ name: "@earendil-works/pi-coding-agent", version: "0.85.1" }, null, 2) + "\n",
		"utf8",
	);
	writePiCliArgsFixture(dirname(bundledPiManifestPath));
	writeFileSync(
		agentTuiManifestPath,
		JSON.stringify({ name: "@earendil-works/pi-tui", version: "0.84.2" }, null, 2) + "\n",
		"utf8",
	);
	writeFileSync(
		agentCodingManifestPath,
		JSON.stringify({
			name: "@earendil-works/pi-coding-agent",
			version: "0.84.2",
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
		assert.match(source, /createFeynmanSignalConfig\("traces"\)/);
		assert.match(source, /createFeynmanSignalConfig\("metrics"\)/);
		assert.match(source, /createFeynmanSignalConfig\("logs"\)/);
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

test("runtime setup preflights BTW and OTEL roots before one patch-plan apply", () => {
	for (const relativePath of [
		"scripts/patch-embedded-pi.mjs",
		"scripts/prepare-runtime-workspace.mjs",
	]) {
		const source = readFileSync(resolve(process.cwd(), relativePath), "utf8");
		const btwPreflight = source.indexOf("preflightPackageRootPatch({");
		const otelPreflight = source.indexOf("preflightPiOtelPackageRoot(");
		const apply = source.indexOf("applyPackageRootPatchPlans(");
		assert.ok(btwPreflight >= 0, `${relativePath} does not preflight pi-btw`);
		assert.ok(otelPreflight >= 0, `${relativePath} does not preflight pi-otel`);
		assert.ok(apply > btwPreflight && apply > otelPreflight, `${relativePath} writes before all package preflights`);
	}
});

test("patchPiRuntimeNodeModules repairs current Pi Undici in global and agent roots but skips stale Pi", (t) => {
	const appRoot = mkdtempSync(join(tmpdir(), "feynman-user-undici-patches-"));
	const homeRoot = mkdtempSync(join(tmpdir(), "feynman-user-undici-home-"));
	t.after(() => { rmSync(appRoot, { recursive: true, force: true }); rmSync(homeRoot, { recursive: true, force: true }); });
	const agentDir = join(homeRoot, ".feynman", "agent");
	const rootNodeModules = join(appRoot, "node_modules");
	const globalNodeModules = join(homeRoot, ".feynman", "npm-global", "lib", "node_modules");
	const agentNodeModules = join(agentDir, "npm", "node_modules");
	const safeUndiciRoot = join(rootNodeModules, "undici");
	const safeBraceRoot = join(rootNodeModules, "brace-expansion");
	mkdirSync(safeUndiciRoot, { recursive: true });
	mkdirSync(safeBraceRoot, { recursive: true });
	// Real 0.28.2 artifacts are copied read-only into this managed-root fixture.
	// The production normalizer verifies their source and native binary hashes.
	writeFileSync(join(appRoot, "package.json"), JSON.stringify({
		name: "feynman-undici-fixture", version: "1.0.0",
		dependencies: { esbuild: "0.28.2" }, bundleDependencies: ["esbuild"],
		optionalDependencies: ESBUILD_OPTIONAL_DEPENDENCIES,
	}));
	for (const name of ["esbuild", `@esbuild/${process.platform}-${process.arch}`]) {
		cpSync(resolve(process.cwd(), "node_modules", name), join(rootNodeModules, name), { recursive: true });
	}
	writeFileSync(
		join(safeUndiciRoot, "package.json"),
		JSON.stringify({ name: "undici", version: "8.10.2" }),
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
				name: `${scope}/pi-coding-agent`, version,
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
			writeFileSync(llamaProviderPath, version === "0.85.1" ? PI_LLAMA_SOURCE : LLAMA_PROVIDER_SOURCE);
			writeFileSync(updateNoticePath, version === "0.85.1" ? PI_UPDATE_NOTICE_SOURCE : INTERACTIVE_UPDATE_NOTICE_SOURCE);
			if (version === "0.85.1") writePiCliArgsFixture(piRoot);
			return { llamaProviderPath, nestedUndiciRoot, updateNoticePath };
		};

	const rootPi = writePiUndiciFixture(rootNodeModules, "@earendil-works", "0.85.1");
	const globalPi = writePiUndiciFixture(
		globalNodeModules,
		"@earendil-works",
		"0.85.1",
	);
	const agentPi = writePiUndiciFixture(
		agentNodeModules,
		"@earendil-works",
		"0.85.1",
	);
	const staleAgentPi = writePiUndiciFixture(
		agentNodeModules,
		"@mariozechner",
		"0.84.2",
	);

	assert.equal(patchPiRuntimeNodeModules(appRoot, agentDir), true);
	assert.equal(
		JSON.parse(readFileSync(join(globalPi.nestedUndiciRoot, "package.json"), "utf8")).version,
		"8.10.2",
	);
	assert.equal(
		JSON.parse(readFileSync(join(agentPi.nestedUndiciRoot, "package.json"), "utf8")).version,
		"8.10.2",
	);
	assert.equal(
		JSON.parse(readFileSync(join(staleAgentPi.nestedUndiciRoot, "package.json"), "utf8")).version,
		"8.5.0",
	);
	for (const providerPath of [globalPi.llamaProviderPath, agentPi.llamaProviderPath]) {
		assert.match(readFileSync(providerPath, "utf8"), /Feynman Pi 0\.84\.2 llama\.cpp cached usage migration/);
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

test("patchPiRuntimeNodeModules accepts newer brace-expansion in Pi's agent-managed root", () => {
	const appRoot = mkdtempSync(join(tmpdir(), "feynman-agent-brace-forward-"));
	const homeRoot = mkdtempSync(join(tmpdir(), "feynman-agent-brace-home-"));
	const agentDir = join(homeRoot, ".feynman", "agent");
	const bundledPiRoot = join(
		appRoot,
		"node_modules",
		"@earendil-works",
		"pi-coding-agent",
	);
	const agentPiRoot = join(
		agentDir,
		"npm",
		"node_modules",
		"@earendil-works",
		"pi-coding-agent",
	);
	const agentBraceRoot = join(agentPiRoot, "node_modules", "brace-expansion");
	const shrinkwrapSource = `${JSON.stringify({
		lockfileVersion: 3,
		packages: {
			"node_modules/brace-expansion": {
				version: "5.0.10",
			},
		},
	}, null, 2)}\n`;
	const manifestSource = `${JSON.stringify({
		name: "brace-expansion",
		version: "5.0.10",
	}, null, 2)}\n`;
	try {
		mkdirSync(bundledPiRoot, { recursive: true });
		mkdirSync(agentBraceRoot, { recursive: true });
			writeFileSync(
				join(bundledPiRoot, "package.json"),
				JSON.stringify({ name: "@earendil-works/pi-coding-agent", version: "0.85.1" }),
			);
			writePiCliArgsFixture(bundledPiRoot);
			writeFileSync(
				join(agentPiRoot, "package.json"),
			JSON.stringify({ name: "@earendil-works/pi-coding-agent", version: "0.84.2" }),
		);
		writeFileSync(join(agentPiRoot, "npm-shrinkwrap.json"), shrinkwrapSource);
		writeFileSync(join(agentBraceRoot, "package.json"), manifestSource);

		patchPiRuntimeNodeModules(appRoot, agentDir);
		assert.equal(readFileSync(join(agentPiRoot, "npm-shrinkwrap.json"), "utf8"), shrinkwrapSource);
		assert.equal(readFileSync(join(agentBraceRoot, "package.json"), "utf8"), manifestSource);
	} finally {
		rmSync(appRoot, { recursive: true, force: true });
		rmSync(homeRoot, { recursive: true, force: true });
	}
});

test("patchPiRuntimeNodeModules fails closed for unreviewed older and newer bundled Pi versions", () => {
	for (const version of ["0.82.1", "0.84.2", "0.85.0", "0.86.0"]) {
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
				new RegExp(`expected 0\\.85\\.1, found ${version.replaceAll(".", "\\.")}`),
			);
		} finally {
			rmSync(appRoot, { recursive: true, force: true });
		}
	}
});

test("patchPiRuntimeNodeModules skips mismatched nested Pi package versions", () => {
	for (const [packageName, version, relativePath, source] of [
		["pi-agent-core", "0.84.2", "dist/agent-loop.js", SOURCE],
		["pi-tui", "0.85.0", "dist/tui.js", TUI_SOURCE],
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
					JSON.stringify({ name: "@earendil-works/pi-coding-agent", version: "0.85.1" }),
				);
				writePiCliArgsFixture(codingRoot);
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
