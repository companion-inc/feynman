import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import {
	assertPiAiForwardFixSource,
	PI_AI_FORWARD_FIX_REQUIRED_VERSION,
	patchPiAiForwardFixSource,
} from "../scripts/lib/pi-ai-forward-fixes-patch.mjs";

const appRoot = process.cwd();
const piAiRoot = resolve(appRoot, "node_modules", "@earendil-works", "pi-ai");
const nestedPiAiRoot = resolve(
	appRoot,
	"node_modules",
	"@earendil-works",
	"pi-coding-agent",
	"node_modules",
	"@earendil-works",
	"pi-ai",
);

function readPiAiSource(relativePath: string): string {
	return readFileSync(resolve(piAiRoot, ...relativePath.split("/")), "utf8");
}

async function importPatchedPiAiApi(relativePath: string, label: string) {
	const modulePath = resolve(piAiRoot, ...relativePath.split("/"));
	const moduleUrl = pathToFileURL(modulePath);
	const patched = patchPiAiForwardFixSource(relativePath, readFileSync(modulePath, "utf8"));
	assert.doesNotThrow(() => assertPiAiForwardFixSource(relativePath, patched));
	const linked = patched.replace(
		/from "([^"]+)";/g,
		(_match, specifier: string) => {
			const resolved = specifier.startsWith(".")
				? new URL(specifier, moduleUrl).href
				: import.meta.resolve(specifier);
			return `from ${JSON.stringify(resolved)};`;
		},
	);
	return import(`data:text/javascript;base64,${Buffer.from(linked).toString("base64")}#${label}-${Date.now()}`);
}

function openAiCompletionsModel(provider: string, id: string, baseUrl: string) {
	return {
		id,
		name: id,
		api: "openai-completions" as const,
		provider,
		baseUrl,
		reasoning: true,
		input: ["text"] as const,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128_000,
		maxTokens: 4096,
	};
}

function openAiResponsesModel() {
	return {
		id: "grok-4.6-test",
		name: "grok-4.6-test",
		api: "openai-responses" as const,
		provider: "xai",
		baseUrl: "https://api.x.ai/v1",
		reasoning: true,
		input: ["text"] as const,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 500_000,
		maxTokens: 4096,
	};
}

function sseBody(deltas: unknown[], model = "research-model"): string {
	const events = deltas.map((delta) => `data: ${JSON.stringify({
		id: "chatcmpl-hotfix",
		model,
		choices: [{ index: 0, delta, finish_reason: null }],
	})}\n\n`);
	events.push(`data: ${JSON.stringify({
		id: "chatcmpl-hotfix",
		model,
		choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
	})}\n\n`);
	events.push("data: [DONE]\n\n");
	return events.join("");
}

async function startSseServer(body: string): Promise<{
	server: Server;
	baseUrl: string;
}> {
	const server = createServer((_request, response) => {
		response.writeHead(200, { "content-type": "text/event-stream" });
		response.end(body);
	});
	await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
	const address = server.address();
	assert.ok(address && typeof address !== "string");
	return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

async function closeServer(server: Server): Promise<void> {
	await new Promise<void>((resolveClose, rejectClose) => {
		server.close((error) => error ? rejectClose(error) : resolveClose());
	});
}

test("Pi 0.85.1 AI stream transforms are exact-version, idempotent, and fail closed", () => {
	for (const root of [piAiRoot, nestedPiAiRoot]) {
		const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
		assert.equal(manifest.version, PI_AI_FORWARD_FIX_REQUIRED_VERSION);
	}
	assert.equal(PI_AI_FORWARD_FIX_REQUIRED_VERSION, "0.85.1");

	for (const relativePath of [
		"dist/api/openai-completions.js",
		"dist/api/openai-responses.js",
	]) {
			const source = readPiAiSource(relativePath);
			const patched = patchPiAiForwardFixSource(relativePath, source);
			assert.equal(patched, source, `${relativePath} should already carry the hotfix`);
			assert.doesNotThrow(() => assertPiAiForwardFixSource(relativePath, patched));
			assert.equal(patchPiAiForwardFixSource(relativePath, patched), patched);
		}

	const completionsPath = "dist/api/openai-completions.js";
	const unsupportedCompletions = readPiAiSource(completionsPath).replace(
		"                finalizeOpenAiReasoningDetails(block);\n                delete block.index;",
		"                delete block.index;",
	);
	assert.throws(
		() => patchPiAiForwardFixSource(completionsPath, unsupportedCompletions),
		/Unsupported Pi 0\.84\.2 OpenAI structured reasoning stream accumulator layout|semantic fragment/,
	);
	const brokenCompletions = patchPiAiForwardFixSource(
		completionsPath,
		readPiAiSource(completionsPath),
	).replace(
		"                finalizeOpenAiReasoningDetails(block);\n                delete block.index;",
		"                delete block.index;",
	);
	assert.throws(
		() => assertPiAiForwardFixSource(completionsPath, brokenCompletions),
		/semantic fragment/,
	);

	const responsesPath = "dist/api/openai-responses.js";
	const unsupportedResponses = readPiAiSource(responsesPath).replace(
		"if (options?.toolChoice !== undefined && toolPlacement.immediate.length > 0)",
		"if (options?.toolChoice !== undefined && true)",
	);
	assert.throws(
		() => patchPiAiForwardFixSource(responsesPath, unsupportedResponses),
		/expected exactly one semantic fragment|retained no-tools tool_choice/,
	);
	const brokenResponses = patchPiAiForwardFixSource(
		responsesPath,
		readPiAiSource(responsesPath),
	).replace(
		"if (options?.toolChoice !== undefined && toolPlacement.immediate.length > 0)",
		"if (options?.toolChoice !== undefined)",
	);
	assert.throws(
		() => assertPiAiForwardFixSource(responsesPath, brokenResponses),
		/missing|retained no-tools tool_choice|expected exactly one semantic fragment/,
	);
});

test("structured reasoning preserves ordered replay and Gemini signatures", async (t) => {
	const textFirst = { type: "reasoning.text", text: "Checked", index: 0 };
	const textSecond = {
		type: "reasoning.text",
		text: " sources.",
		id: "reasoning-text-1",
		format: "openai-responses-v1",
		index: 0,
		signature: "sha256:text-signature",
	};
	const summaryFirst = { type: "reasoning.summary", summary: "Verified", index: 1 };
	const summarySecond = {
		type: "reasoning.summary",
		summary: " evidence.",
		id: "reasoning-summary-1",
		format: "openai-responses-v1",
		index: 1,
	};
	const encrypted = {
		type: "reasoning.encrypted",
		id: "call_1",
		data: "encrypted-reasoning",
		index: 2,
	};
	const expectedDetails = [
		{
			type: "reasoning.text",
			text: "Checked sources.",
			index: 0,
			signature: "sha256:text-signature",
			id: "reasoning-text-1",
			format: "openai-responses-v1",
		},
		{
			type: "reasoning.summary",
			summary: "Verified evidence.",
			index: 1,
			id: "reasoning-summary-1",
			format: "openai-responses-v1",
		},
		encrypted,
	];
	const firstGeminiSignature = "gemini-first-signature";
	const laterGeminiSignature = "gemini-later-signature";
	const body = sseBody([
		{ reasoning: "Checked sources.", reasoning_details: [textFirst] },
		{ reasoning_details: [textSecond, summaryFirst, summarySecond, encrypted] },
		{
			tool_calls: [{
				index: 0,
				id: "call_1",
				type: "function",
				function: { name: "read", arguments: "{\"path\":\"README.md\"}" },
				extra_content: { google: { thought_signature: firstGeminiSignature } },
			}],
		},
		{
			tool_calls: [{
				index: 0,
				id: "call_1",
				type: "function",
				function: { name: "read", arguments: "" },
				extra_content: { google: { thought_signature: laterGeminiSignature } },
			}],
		},
	], "google/gemini-3-test").replace('"finish_reason":"stop"', '"finish_reason":"tool_calls"');
	const { server, baseUrl } = await startSseServer(body);
	t.after(() => closeServer(server));

	const openAiCompletions = await importPatchedPiAiApi(
		"dist/api/openai-completions.js",
		"reasoning-semantics",
	);
	const model = openAiCompletionsModel("openrouter", "google/gemini-3-test", baseUrl);
	const first = await openAiCompletions.streamSimple(
		model,
		{
			messages: [{ role: "user", content: "research", timestamp: 0 }],
			tools: [{
				name: "read",
				description: "Read a source",
				parameters: { type: "object", properties: { path: { type: "string" } } },
			}],
		},
		{ apiKey: "test" },
	).result();
	const thinking = first.content.find((block: { type: string }) => block.type === "thinking");
	const toolCall = first.content.find((block: { type: string }) => block.type === "toolCall");
	assert.deepEqual(thinking, {
		type: "thinking",
		thinking: "Checked sources.",
		thinkingSignature: JSON.stringify(expectedDetails),
	});
	assert.equal(toolCall?.thoughtSignature, firstGeminiSignature);

	let replayPayload: any;
	await openAiCompletions.streamSimple(
		model,
		{ messages: [JSON.parse(JSON.stringify(first))] },
		{
			apiKey: "test",
			onPayload: (payload: unknown) => {
				replayPayload = payload;
				throw new Error("same-model replay captured");
			},
		},
	).result();
	assert.deepEqual(replayPayload.messages[0].reasoning_details, expectedDetails);
	assert.equal("reasoning" in replayPayload.messages[0], false);
	assert.deepEqual(replayPayload.messages[0].tool_calls[0].extra_content, {
		google: { thought_signature: firstGeminiSignature },
	});

	let crossModelPayload: any;
	await openAiCompletions.streamSimple(
		{ ...model, id: "google/gemini-3-other" },
		{ messages: [JSON.parse(JSON.stringify(first))] },
		{
			apiKey: "test",
			onPayload: (payload: unknown) => {
				crossModelPayload = payload;
				throw new Error("cross-model replay captured");
			},
		},
	).result();
	assert.equal("reasoning_details" in crossModelPayload.messages[0], false);
});

test("structured reasoning serializes partial replay data at the error boundary", async (t) => {
	const encrypted = {
		type: "reasoning.encrypted",
		id: "partial-reasoning",
		data: "partial-ciphertext",
	};
	const body = [
		`data: ${JSON.stringify({
			id: "chatcmpl-partial",
			model: "research-model",
			choices: [{
				index: 0,
				delta: { reasoning_details: [encrypted] },
				finish_reason: null,
			}],
		})}\n\n`,
		"data: [DONE]\n\n",
	].join("");
	const { server, baseUrl } = await startSseServer(body);
	t.after(() => closeServer(server));
	const openAiCompletions = await importPatchedPiAiApi(
		"dist/api/openai-completions.js",
		"reasoning-error-boundary",
	);
	const result = await openAiCompletions.streamSimple(
		openAiCompletionsModel("custom-gateway", "research-model", baseUrl),
		{ messages: [{ role: "user", content: "research", timestamp: 0 }] },
		{ apiKey: "test" },
	).result();
	assert.equal(result.stopReason, "error");
	assert.match(result.errorMessage ?? "", /Stream ended without finish_reason/);
	assert.deepEqual(result.content.find((block: { type: string }) => block.type === "thinking"), {
		type: "thinking",
		thinking: "",
		thinkingSignature: JSON.stringify([encrypted]),
	});
});

test("structured reasoning serialization work stays constant as streams scale", async () => {
	const openAiCompletions = await importPatchedPiAiApi(
		"dist/api/openai-completions.js",
		"reasoning-scaling",
	);
	const counts: Array<{ size: number; parses: number; serializations: number }> = [];

	for (const size of [64, 2048]) {
		const details = Array.from({ length: size }, (_value, index) => ({
			type: "reasoning.encrypted",
			id: `reasoning-${index}`,
			data: `ciphertext-${index}`,
			index,
		}));
		const { server, baseUrl } = await startSseServer(sseBody([{ reasoning_details: details }]));
		const originalParse = JSON.parse;
		const originalStringify = JSON.stringify;
		let structuredParses = 0;
		let structuredSerializations = 0;
		JSON.parse = ((text: string, reviver?: (this: any, key: string, value: any) => any) => {
			if (typeof text === "string" && text.startsWith('[{"type":"reasoning.')) {
				structuredParses++;
			}
			return originalParse(text, reviver);
		}) as typeof JSON.parse;
		JSON.stringify = ((value: any, ...args: any[]) => {
			if (
				Array.isArray(value) &&
				value.length > 0 &&
				value.every((detail) => typeof detail?.type === "string" && detail.type.startsWith("reasoning."))
			) {
				structuredSerializations++;
			}
			return originalStringify(value, ...args);
		}) as typeof JSON.stringify;
		try {
			const result = await openAiCompletions.streamSimple(
				openAiCompletionsModel("custom-gateway", "research-model", baseUrl),
				{ messages: [{ role: "user", content: "research", timestamp: 0 }] },
				{ apiKey: "test" },
			).result();
			assert.equal(result.stopReason, "stop");
		} finally {
			JSON.parse = originalParse;
			JSON.stringify = originalStringify;
			await closeServer(server);
		}
		counts.push({
			size,
			parses: structuredParses,
			serializations: structuredSerializations,
		});
	}

	assert.deepEqual(counts, [
		{ size: 64, parses: 0, serializations: 1 },
		{ size: 2048, parses: 0, serializations: 1 },
	]);
});

test("OpenAI Responses omits no-tools tool_choice and preserves tool-enabled choice", async () => {
	const openAiResponses = await importPatchedPiAiApi(
		"dist/api/openai-responses.js",
		"responses-tool-choice",
	);
	const model = openAiResponsesModel();
	let noToolsPayload: any;
	const noToolsResult = await openAiResponses.streamSimple(
		model,
		{ messages: [{ role: "user", content: "Summarize the conversation", timestamp: 0 }] },
		{
			apiKey: "test",
			toolChoice: "none",
			onPayload: (payload: unknown) => {
				noToolsPayload = payload;
				throw new Error("no-tools Responses payload captured");
			},
		},
	).result();
	assert.match(noToolsResult.errorMessage ?? "", /no-tools Responses payload captured/);
	assert.equal("tools" in noToolsPayload, false);
	assert.equal("tool_choice" in noToolsPayload, false);

	let toolsPayload: any;
	const toolsResult = await openAiResponses.streamSimple(
		model,
		{
			messages: [{ role: "user", content: "Read the source", timestamp: 0 }],
			tools: [{
				name: "read",
				description: "Read a source",
				parameters: {
					type: "object",
					properties: { path: { type: "string" } },
					required: ["path"],
				},
			}],
		},
		{
			apiKey: "test",
			toolChoice: "required",
			onPayload: (payload: unknown) => {
				toolsPayload = payload;
				throw new Error("tool-enabled Responses payload captured");
			},
		},
	).result();
	assert.match(toolsResult.errorMessage ?? "", /tool-enabled Responses payload captured/);
	assert.equal(toolsPayload.tool_choice, "required");
	assert.equal(toolsPayload.tools.length, 1);
});
