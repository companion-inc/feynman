import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import * as agent from "../scripts/lib/pi-agent-core-patch.mjs";
import * as ai from "../scripts/lib/pi-ai-forward-fixes-patch.mjs";
import * as compaction from "../scripts/lib/pi-compaction-tools-patch.mjs";
import * as correctness from "../scripts/lib/pi-runtime-correctness-patch.mjs";
import * as edit from "../scripts/lib/pi-edit-line-endings-patch.mjs";
import * as timeout from "../scripts/lib/pi-extension-handler-timeout-patch.mjs";
import * as cli from "../scripts/lib/pi-cli-args-patch.mjs";
import * as llama from "../scripts/lib/pi-llama-usage-patch.mjs";
import * as state from "../scripts/lib/pi-state-file-permissions-patch.mjs";
import * as tui from "../scripts/lib/pi-tui-patch.mjs";
import { patchPiExtensionLoaderSource } from "../scripts/lib/pi-extension-loader-patch.mjs";
import { patchPiModelRegistrySource } from "../scripts/lib/pi-model-registry-patch.mjs";

// Set this to the isolated npm-pack extraction directory to test pristine
// official sources. Without it, CI tests the installed exact train. No installed
// file is ever modified; all transforms and imports below are in memory.
const installed = (pkg: string, file: string) =>
	resolve("node_modules", "@earendil-works", pkg, file);
const root = (pkg: string) => process.env.PI_CORE_PRISTINE_DIR
	? resolve(process.env.PI_CORE_PRISTINE_DIR, `earendil-works-${pkg}-0.85.1/package`)
	: installed(pkg, "");
const read = (pkg: string, file: string) => readFileSync(resolve(root(pkg), file), "utf8");
type Case = [string, string, (source: string) => string];
const cases: Case[] = [
	["pi-agent-core", "dist/agent-loop.js", agent.patchPiAgentCoreSource],
	...ai.PI_AI_FORWARD_FIX_TARGETS.map((file): Case =>
		["pi-ai", file, source => ai.patchPiAiForwardFixSource(file, source)]),
	...compaction.PI_COMPACTION_TOOLS_PATCH_TARGETS.map((file): Case =>
		["pi-coding-agent", file, source => compaction.patchPiCompactionToolsSource(file, source)]),
	...edit.PI_EDIT_LINE_ENDINGS_PATCH_TARGETS.map((file): Case =>
		["pi-coding-agent", file, source => edit.patchPiEditLineEndingsSource(file, source)]),
	["pi-coding-agent", "dist/core/extensions/runner.js", source => timeout.patchPiExtensionHandlerTimeoutSource(source, "0.85.1")],
	["pi-coding-agent", "dist/cli/args.js", cli.patchPiCliArgsSource],
	["pi-coding-agent", "dist/core/extensions/loader.js", patchPiExtensionLoaderSource],
	["pi-coding-agent", "dist/core/model-runtime.js", patchPiModelRegistrySource],
	["pi-coding-agent", "dist/core/model-registry.js", patchPiModelRegistrySource],
	["pi-coding-agent", "dist/extensions/llama/provider.js", llama.patchPiLlamaUsageSource],
	["pi-coding-agent", "dist/core/auth-storage.js", state.patchPiStateFilePermissionsSource],
	["pi-coding-agent", "dist/core/agent-session.js", correctness.patchPiAgentSessionSource],
	["pi-coding-agent", "dist/core/session-manager.js", correctness.patchPiSessionManagerSource],
	...correctness.PI_CODING_AGENT_FORWARD_FIX_TARGETS.map((file): Case =>
		["pi-coding-agent", file, source => correctness.patchPiCodingAgentForwardFixSource(file, source)]),
	["pi-ai", "dist/api/transform-messages.js", correctness.patchPiTransformMessagesSource],
	["pi-ai", "dist/auth/oauth/device-code.js", correctness.patchPiGithubCopilotDeviceCodeSource],
	["pi-ai", "dist/auth/oauth/github-copilot.js", correctness.patchPiGithubCopilotOAuthSource],
	["pi-tui", "dist/tui.js", tui.patchPiTuiSource],
	["pi-tui", "dist/tui-main-screen.js", tui.patchPiTuiSource],
	["pi-tui", "dist/components/editor.js", tui.patchPiEditorSource],
];

for (const [pkg, file, patch] of cases) {
	test(`Pi 0.85.1 exact source: ${pkg}/${file}`, () => {
		assert.equal(JSON.parse(read(pkg, "package.json")).version, "0.85.1");
		const source = read(pkg, file);
		const once = patch(source);
		assert.equal(patch(once), once, "patch is idempotent");
		if (file.endsWith(".js")) {
			const syntax = spawnSync(process.execPath, ["--check", "--input-type=module"], {
				input: once, encoding: "utf8",
			});
			assert.equal(syntax.status, 0, syntax.stderr);
		}
	});
}

async function importPatched(pkg: string, file: string, source: string, overrides: Record<string, string> = {}) {
	const url = pathToFileURL(installed(pkg, file));
	const linked = source.replace(/from "([^"]+)";/g, (_match, specifier: string) => {
		const target = overrides[specifier] ??
			(specifier.startsWith(".") ? new URL(specifier, url).href : import.meta.resolve(specifier));
		return `from ${JSON.stringify(target)};`;
	});
	return import(`data:text/javascript;base64,${Buffer.from(linked).toString("base64")}`);
}

test("current catalogue preserves upstream corrected modality and all manifest bytes", () => {
	for (const file of ai.PI_AI_FORWARD_FIX_TARGETS.filter(file => file.includes("/providers/data/"))) {
		const source = read("pi-ai", file);
		assert.equal(ai.patchPiAiForwardFixSource(file, source), source);
		ai.assertPiAiForwardFixSource(file, source);
	}
	const catalog = JSON.parse(read("pi-ai", "dist/providers/data/baseten.json"))["openai-completions"];
	assert.deepEqual(catalog["zai-org/GLM-5.2"].input, ["text"]);
	assert.deepEqual(catalog["zai-org/GLM-5.2-Fast"].input, ["text"]);
	assert.ok(catalog["zai-org/GLM-5.3"]);
});

test("landed CLI delimiter runs literally and its executable semantics remain guarded", async () => {
	const source = cli.patchPiCliArgsSource(read("pi-coding-agent", "dist/cli/args.js"));
	const module = await importPatched("pi-coding-agent", "dist/cli/args.js", source);
	const args = module.parseArgs(["--", "--help", "@paper.pdf", "-a"]);
	assert.deepEqual(args.messages, ["--help", "-a"]);
	assert.deepEqual(args.fileArgs, ["paper.pdf"]);
	assert.equal(args.help, undefined);
	assert.throws(() => cli.assertPiCliArgsPatchSource(source.replace("result.messages.push(positionalArg);", "void positionalArg;")));
});

test("summary budgets, upstream tool/truncation rejection and single helper declarations compose", async () => {
	const file = "dist/core/compaction/compaction.js";
	const source = compaction.patchPiCompactionToolsSource(file, read("pi-coding-agent", file));
	const module = await importPatched("pi-coding-agent", file, source);
	assert.match(module.getSummarizationFailure({ stopReason: "length" }, "Summary"), /token cap/);
	const settings = module.getEffectiveCompactionSettings({ enabled: true, reserveTokens: 16384, keepRecentTokens: 20000 }, 2048);
	assert.ok(settings.reserveTokens <= 512);
	assert.ok(settings.keepRecentTokens <= 2048 - 2 * settings.reserveTokens);
	assert.ok(module.getSummaryUsabilityFailure("## Goal\nNone\n## Progress\nNone\n## Next Steps\nNone", "Summary"));
	const types = compaction.patchPiCompactionToolsSource("dist/core/compaction/compaction.d.ts",
		read("pi-coding-agent", "dist/core/compaction/compaction.d.ts"));
	assert.equal(types.split("export declare function getSummarizationFailure(").length - 1, 1);
	const branch = compaction.patchPiCompactionToolsSource("dist/core/compaction/branch-summarization.js",
		read("pi-coding-agent", "dist/core/compaction/branch-summarization.js"));
	assert.match(branch, /Math.min\(4096, modelMaxTokens, effectiveSettings.reserveTokens, contextWindow - emptyRequest.inputTokens - 1\)/);
	assert.throws(() => compaction.assertPiCompactionToolsPatchedSource(file,
		source.replace('response.stopReason === "length"', "false")));
	const session = correctness.patchPiAgentSessionSource(read("pi-coding-agent", "dist/core/agent-session.js"));
	const composed = compaction.patchPiCompactionToolsSource("dist/core/agent-session.js", session);
	correctness.assertPiRuntimeCorrectnessPatchSource(composed, "agentSession");
	assert.equal(correctness.patchPiAgentSessionSource(composed), composed);
});

test("OpenAI replay preserves Gemini signatures and bounds foreign tool IDs without network calls", async () => {
	const file = "dist/api/openai-completions.js";
	const source = ai.patchPiAiForwardFixSource(file, read("pi-ai", file));
	const retryFile = "dist/utils/provider-retry.js";
	const retrySource = ai.patchPiAiForwardFixSource(retryFile, read("pi-ai", retryFile));
	const retryUrl = pathToFileURL(installed("pi-ai", retryFile));
	const linkedRetry = retrySource.replace(/from "([^"]+)";/g, (_match, specifier: string) =>
		`from ${JSON.stringify(specifier.startsWith(".") ? new URL(specifier, retryUrl).href : import.meta.resolve(specifier))};`);
	const module = await importPatched("pi-ai", file, source, {
		"../utils/provider-retry.js": `data:text/javascript;base64,${Buffer.from(linkedRetry).toString("base64")}`,
	});
	const model = { id: "google/gemini-3-pro", provider: "openrouter", api: "openai-completions",
		baseUrl: "https://unused.invalid", name: "fixture", reasoning: true, input: ["text"],
		contextWindow: 100000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
	let payload: any;
	const id = "long-tool-id".repeat(12);
	await module.stream(model, { messages: [
		{ role: "user", content: "Research", timestamp: 1 },
		{ role: "assistant", api: model.api, provider: model.provider, model: model.id,
			stopReason: "toolUse", timestamp: 2, content: [
				{ type: "thinking", thinking: "", thinkingSignature: JSON.stringify([{ type: "reasoning.encrypted", data: "opaque" }]) },
				{ type: "toolCall", id, name: "read", arguments: {}, thoughtSignature: "gemini-signature" },
			] },
		{ role: "toolResult", toolCallId: id, toolName: "read", content: [{ type: "text", text: "paper" }], timestamp: 3 },
	] }, { apiKey: "fixture", onPayload(value: any) { payload = value; throw new Error("captured"); } }).result();
	assert.ok(payload);
	const assistant = payload.messages.find((message: any) => message.role === "assistant" && message.tool_calls);
	assert.equal(assistant.tool_calls[0].extra_content.google.thought_signature, "gemini-signature");
	assert.equal(assistant.tool_calls[0].id, id, "same-model native IDs remain unchanged");
	assert.deepEqual(assistant.reasoning_details, [{ type: "reasoning.encrypted", data: "opaque" }]);
	assert.equal(payload.messages.find((message: any) => message.role === "tool").tool_call_id, assistant.tool_calls[0].id);
	await module.stream(model, { messages: [
		{ role: "assistant", api: "openai-responses", provider: "openai", model: "foreign",
			stopReason: "toolUse", timestamp: 2, content: [
				{ type: "toolCall", id, name: "read", arguments: {} },
			] },
		{ role: "toolResult", toolCallId: id, toolName: "read", content: [{ type: "text", text: "paper" }], timestamp: 3 },
	] }, { apiKey: "fixture", onPayload(value: any) { payload = value; throw new Error("captured"); } }).result();
	const foreignAssistant = payload.messages.find((message: any) => message.role === "assistant" && message.tool_calls);
	assert.ok(foreignAssistant.tool_calls[0].id.length <= 40);
	assert.equal(payload.messages.find((message: any) => message.role === "tool").tool_call_id, foreignAssistant.tool_calls[0].id);
	assert.throws(() => ai.assertPiAiForwardFixSource(file,
		source.replace("lastDetail.text += detail.text;", "void detail.text;")));
});

test("AgentCore abort guard precedes the current turn snapshot and queue poll", () => {
	const source = agent.patchPiAgentCoreSource(read("pi-agent-core", "dist/agent-loop.js"));
	assert.match(source, /if \(signal\?\.aborted\) \{\s+await emit\(\{ type: "agent_end", messages: newMessages \}\);\s+return;\s+\}\s+lastCompletedTurn =/);
	assert.throws(() => agent.assertPiAgentCorePatchSource(source.replace("if (signal?.aborted) {", "if (false) {")));
});

test("reviewed upstream Copilot retries 429 and enables only requested models sequentially", async (t) => {
	const file = "dist/auth/oauth/github-copilot.js";
	const source = correctness.patchPiGithubCopilotOAuthSource(read("pi-ai", file));
	correctness.assertPiRuntimeCorrectnessPatchSource(source, "githubCopilotOAuth");
	assert.throws(() => correctness.assertPiRuntimeCorrectnessPatchSource(
		source.replace("await sleep(delayMs, requestSignal);", "void delayMs;"), "githubCopilotOAuth"));
	const module = await importPatched("pi-ai", file, source);
	const catalog = JSON.parse(read("pi-ai", "dist/providers/data/github-copilot.json"));
	const ids = Object.values(catalog).flatMap(group => Object.keys(group as object)).slice(0, 2);
	const originalFetch = globalThis.fetch;
	t.after(() => { globalThis.fetch = originalFetch; });
	let models = 0;
	let active = 0;
	let maxActive = 0;
	const policies: string[] = [];
	globalThis.fetch = async input => {
		const url = String(input);
		if (url.endsWith("/login/device/code")) return Response.json({
			device_code: "fixture", user_code: "fixture", verification_uri: "https://unused.invalid",
			interval: 1, expires_in: 30,
		});
		if (url.endsWith("/login/oauth/access_token")) return Response.json({ access_token: "fixture" });
		if (url.includes("/copilot_internal/v2/token")) return Response.json({
			token: "tid=fixture;exp=9999999999;proxy-ep=proxy.individual.githubcopilot.com;", expires_at: 9999999999,
		});
		if (url.endsWith("/models")) {
			models++;
			if (models === 1) return new Response("", { status: 429, headers: { "retry-after": "0.001" } });
			return Response.json({ data: ids.map(id => ({ id, model_picker_enabled: true, policy: { state: "unconfigured" } })) });
		}
		if (url.endsWith("/policy")) {
			policies.push(url);
			active++;
			maxActive = Math.max(maxActive, active);
			await new Promise(resolveDelay => setTimeout(resolveDelay, 1));
			active--;
			return new Response("", { status: 200 });
		}
		throw new Error(`Unexpected fixture request: ${url}`);
	};
	const result = await module.githubCopilotOAuth.login({
		prompt: async () => "", notify: () => {}, signal: new AbortController().signal,
	});
	assert.equal(models, 2);
	assert.equal(policies.length, 2);
	assert.equal(maxActive, 1);
	assert.deepEqual(result.availableModelIds, ids);
});
