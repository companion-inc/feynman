import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
	assertPiAiForwardFixSource,
	PI_AI_FORWARD_FIX_MARKERS,
	PI_AI_FORWARD_FIX_TARGETS,
	PI_AI_FORWARD_FIX_RUNTIME_TARGETS,
	patchPiAiForwardFixSource,
} from "../scripts/lib/pi-ai-forward-fixes-patch.mjs";
import {
	assertPiAiForwardFixPackageTree,
	resolvePiAiForwardFixVerificationTargets,
} from "../scripts/lib/pi-ai-forward-fixes-verifier.mjs";
import { patchPiRuntimeNodeModules } from "../src/pi/runtime-patches.js";

const appRoot = process.cwd();
patchPiRuntimeNodeModules(appRoot);

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

function readPiAiSource(root: string, relativePath: string): string {
	return readFileSync(resolve(root, ...relativePath.split("/")), "utf8");
}

async function importPatchedOpenAiCompletions(label: string) {
	const relativePath = "dist/api/openai-completions.js";
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

function googleModel(
	api: "google-generative-ai" | "google-vertex",
	id: string,
	thinkingLevelMap: Record<string, string>,
) {
	return {
		id,
		name: id,
		api,
		provider: `test-${api}`,
		baseUrl: "https://example.invalid/v1",
		reasoning: true,
		thinkingLevelMap,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 4096,
	};
}

async function captureGooglePayload(
	modulePath: string,
	model: ReturnType<typeof googleModel>,
	reasoning: string,
	thinkingBudgets?: Record<string, number>,
) {
	const provider = await import(`${pathToFileURL(modulePath).href}?forward-fix=${Date.now()}`);
	let payload: unknown;
	const result = await provider.streamSimple(
		model,
		{
			messages: [{ role: "user", content: "Hello", timestamp: 0 }],
			tools: [{
				name: "read",
				description: "Read a file",
				parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
			}],
		},
		{
			apiKey: "test",
			reasoning,
			thinkingBudgets,
			toolChoice: "none",
			onPayload: (request: unknown) => {
				payload = request;
				throw new Error("payload captured");
			},
		},
	).result();
	assert.match(result.errorMessage ?? "", /payload captured/);
	assert.ok(payload, "Google payload was not captured");
	return payload as {
		config?: {
			thinkingConfig?: {
				thinkingLevel?: string;
				thinkingBudget?: number;
			};
			toolConfig?: {
				functionCallingConfig?: { mode?: string };
			};
		};
	};
}

test("Pi AI forward patch covers root and nested 0.84.2 runtime copies", () => {
	const patchSource = readFileSync(
		resolve(appRoot, "scripts", "lib", "pi-ai-forward-fixes-patch.mjs"),
		"utf8",
	);
	for (const commit of [
		"af2c352",
		"10acee6",
		"0e4d495",
		"8720548",
		"ad58801",
		"e5dde9a",
		"fe37e9f",
		"4ca636c5",
		"b7bb00b9",
		"c5ad7c1b",
		"331e187",
	]) {
		assert.match(patchSource, new RegExp(commit));
	}
	assert.match(
		patchSource,
		/Removal condition: delete this patch after Feynman adopts a released Pi/,
	);

	for (const relativePath of PI_AI_FORWARD_FIX_TARGETS) {
		for (const root of [piAiRoot, nestedPiAiRoot]) {
			const source = readPiAiSource(root, relativePath);
			assert.doesNotThrow(() => assertPiAiForwardFixSource(relativePath, source));
			assert.equal(patchPiAiForwardFixSource(relativePath, source), source);
			if (!relativePath.endsWith(".json")) {
				assert.doesNotMatch(source, /sourceMappingURL/);
			}
		}
	}
	const patchedTypes = patchPiAiForwardFixSource(
		"dist/types.d.ts",
		readPiAiSource(piAiRoot, "dist/types.d.ts"),
	);
	assert.doesNotMatch(patchedTypes, /reasoningDetails\?: JsonValue\[\];/);
});

test("structured reasoning assertions reject no-op and mutated semantics", () => {
	const relativePath = "dist/api/openai-completions.js";
	const patched = patchPiAiForwardFixSource(relativePath, readPiAiSource(piAiRoot, relativePath));
	for (const [name, original, mutation] of [
		["text merge", "        lastDetail.text += detail.text;", "        void detail.text;"],
		["summary merge", "        lastDetail.summary += detail.summary;", "        void detail.summary;"],
		["encrypted append", "    details.push({ ...detail });", "    void detail;"],
			[
				"ordered storage",
				"            block.thinkingSignature = JSON.stringify(preservedDetails);",
				"            void preservedDetails;",
			],
		[
			"provider identity gate",
			"            const legacyMessageReasoningDetails = msg.provider === model.provider &&",
			"            const legacyMessageReasoningDetails = true &&",
		],
		[
			"detail validation",
			"                            if (!isOpenAIReasoningDetail(detail))\n                                continue;",
			"                            if (false)\n                                continue;",
		],
	] as const) {
		const mutated = patched.replace(original, mutation);
		assert.notEqual(mutated, patched, name);
		assert.throws(
			() => assertPiAiForwardFixSource(relativePath, mutated),
			/semantic fragment|retained|missing/,
			name,
		);
	}

	const typesPath = "dist/types.d.ts";
	const patchedTypes = patchPiAiForwardFixSource(typesPath, readPiAiSource(piAiRoot, typesPath));
	const mutatedTypes = patchedTypes.replace(
		"    rawStopReason?: string;\n",
		"    rawStopReason?: string;\n    reasoningDetails?: JsonValue[];\n",
	);
	assert.notEqual(mutatedTypes, patchedTypes);
	assert.throws(
		() => assertPiAiForwardFixSource(typesPath, mutatedTypes),
		/retained top-level reasoningDetails/,
	);
});

test("pruned native Pi AI verification does not require declaration files", () => {
	const readText = (path: string, label: string): string => {
		if (path.endsWith(".d.ts")) {
			throw new Error(`${label} is missing`);
		}
		return readFileSync(path, "utf8");
	};

	assert.doesNotThrow(() =>
		assertPiAiForwardFixPackageTree(appRoot, readText, { prunedNative: true }),
	);
	assert.throws(
		() => assertPiAiForwardFixPackageTree(appRoot, readText),
		/bundled root Pi AI dist\/utils\/provider-retry\.d\.ts is missing/,
	);
});

test("installed Pi AI verification selects executable targets only for native bundles", () => {
	assert.deepEqual(
		resolvePiAiForwardFixVerificationTargets(),
		PI_AI_FORWARD_FIX_TARGETS,
	);
	assert.deepEqual(
		resolvePiAiForwardFixVerificationTargets({ prunedNative: true }),
		PI_AI_FORWARD_FIX_RUNTIME_TARGETS,
	);
	const installedVerifierSource = readFileSync(
		resolve(appRoot, "scripts", "verify-installed-runtime.mjs"),
		"utf8",
	);
	assert.match(
		installedVerifierSource,
		/verifyRuntimeForwardFixBehavior\(packageRoot,\s*\{\s*prunedNative:\s*isNativeBundlePackageRoot\(packageRoot\)/,
	);
});

test("Pi AI forward patch applies each unsupported 0.84.2 source layout once", () => {
	const shared = patchPiAiForwardFixSource(
		"dist/api/google-shared.js",
		'import { transformMessages } from "./transform-messages.js";',
	);
	assert.match(shared, new RegExp(PI_AI_FORWARD_FIX_MARKERS.googleShared));
	assert.match(shared, /export function resolveGoogleThinkingLevel/);

	const generative = patchPiAiForwardFixSource(
		"dist/api/google-generative-ai.js",
		[
			'import { convertMessages, convertTools, isThinkingPart, mapStopReason, resolveGoogleFunctionCallingMode, retainThoughtSignature, retryGoogleRequest, supportsGoogleStrictToolSampling, } from "./google-shared.js";',
			'    const effort = (clampedReasoning === "off" ? "high" : clampedReasoning);',
			"level: getThinkingLevel(effort, googleModel)",
			"budgetTokens: getGoogleBudget(googleModel, effort, options.thinkingBudgets)",
			"function getGoogleBudget(model, effort, customBudgets) {",
			"customBudgets?.[effort]",
			"customBudgets[effort]",
			"budgets[effort]",
			"budgets[effort]",
			"budgets[effort]",
			"    const base = buildBaseOptions(model, context, options, apiKey);",
		].join("\n"),
	);
	assert.match(generative, new RegExp(PI_AI_FORWARD_FIX_MARKERS.googleGenerativeAi));
	assert.match(generative, /getThinkingLevel\(resolvedLevel, googleModel\)/);
	assert.doesNotMatch(generative, /budgets\[effort\]/);

	const vertex = patchPiAiForwardFixSource(
		"dist/api/google-vertex.js",
		[
			'import { convertMessages, convertTools, isThinkingPart, mapStopReason, resolveGoogleFunctionCallingMode, retainThoughtSignature, retryGoogleRequest, supportsGoogleStrictToolSampling, } from "./google-shared.js";',
			'    const effort = (clampedReasoning === "off" ? "high" : clampedReasoning);',
			"level: getGemini3ThinkingLevel(effort, geminiModel)",
			"budgetTokens: getGoogleBudget(geminiModel, effort, options.thinkingBudgets)",
			"function getGoogleBudget(model, effort, customBudgets) {",
			"customBudgets?.[effort]",
			"customBudgets[effort]",
			"budgets[effort]",
			"budgets[effort]",
			"    const base = buildBaseOptions(model, context, options, undefined);",
		].join("\n"),
	);
	assert.match(vertex, new RegExp(PI_AI_FORWARD_FIX_MARKERS.googleVertex));
	assert.match(vertex, /getGemini3ThinkingLevel\(resolvedLevel, geminiModel\)/);
	assert.doesNotMatch(vertex, /budgets\[effort\]/);

	const xiaomi = patchPiAiForwardFixSource(
		"dist/providers/data/xiaomi.json",
		JSON.stringify({
			"openai-completions": {
				"mimo-v2-flash": { id: "mimo-v2-flash" },
				"mimo-v2-omni": { id: "mimo-v2-omni" },
				"mimo-v2-pro": { id: "mimo-v2-pro" },
				"mimo-v2.5": { id: "mimo-v2.5" },
				"mimo-v2.5-pro": { id: "mimo-v2.5-pro" },
			},
		}),
	);
	assert.doesNotMatch(xiaomi, /mimo-v2-flash|mimo-v2-omni|mimo-v2-pro"/);
	assert.match(xiaomi, /mimo-v2\.5-pro/);

	const zai = patchPiAiForwardFixSource(
		"dist/providers/data/zai-coding-cn.json",
		JSON.stringify({
			"openai-completions": Object.fromEntries(
				["glm-4.7", "glm-5-turbo", "glm-5.2"].map((id) => [
					id,
					{ id, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
				]),
			),
		}),
	);
	const zaiModels = JSON.parse(zai)["openai-completions"];
	assert.deepEqual(Object.keys(zaiModels), [
		"glm-4.6v",
		"glm-4.7",
		"glm-5-turbo",
		"glm-5.1",
		"glm-5.2",
		"glm-5v-turbo",
	]);
	assert.deepEqual(zaiModels["glm-4.7"].cost, {
		input: 0.6,
		output: 2.2,
		cacheRead: 0.11,
		cacheWrite: 0,
	});
	for (const id of ["glm-4.6v", "glm-5.1", "glm-5v-turbo"]) {
		assert.equal(zaiModels[id].id, id);
	}

	const baseten = patchPiAiForwardFixSource(
		"dist/providers/data/baseten.json",
		JSON.stringify({
			"openai-completions": Object.fromEntries(
				["zai-org/GLM-5.2", "zai-org/GLM-5.2-Fast"].map((id) => [
					id,
					{ id, input: ["text"] },
				]),
			),
		}),
	);
	const basetenModels = JSON.parse(baseten)["openai-completions"];
	for (const id of ["zai-org/GLM-5.2", "zai-org/GLM-5.2-Fast"]) {
		assert.deepEqual(basetenModels[id].input, ["text", "image"]);
	}

	const manifest = JSON.parse(
		patchPiAiForwardFixSource(
			"dist/providers/data/.manifest.json",
			JSON.stringify({
				schemaVersion: 3,
				generatedAt: "2026-08-14T10:02:30.583Z",
				structureHash: "stale",
				files: {
					"baseten.json": "stale",
					"xiaomi.json": "stale",
					"xiaomi-token-plan-cn.json": "stale",
					"xiaomi-token-plan-ams.json": "stale",
					"xiaomi-token-plan-sgp.json": "stale",
					"zai.json": "stale",
					"zai-coding-cn.json": "stale",
				},
			}),
		),
	);
	assert.equal(manifest.structureHash, "a2a167065a0bd00645b34c52292f2f2b468af195d0d58e15382a3e071ebf94dd");
	assert.equal(
		manifest.files["baseten.json"],
		"245c6ef6381f3d8e9d251857e07585db0aeef4156e8d4c31de31aef12444f2e0",
	);
});

test("Google providers honor model thinking maps and mapped token budgets", async () => {
	const shared = await import(
		`${pathToFileURL(resolve(piAiRoot, "dist", "api", "google-shared.js")).href}?forward-fix=${Date.now()}`
	);
	assert.equal(
		shared.resolveGoogleThinkingLevel(
			googleModel("google-generative-ai", "gemini-3.7-flash", { high: "LOW" }),
			"high",
		),
		"low",
	);
	assert.throws(
		() =>
			shared.resolveGoogleThinkingLevel(
				googleModel("google-generative-ai", "gemini-3.7-flash", { xhigh: "extreme" }),
				"xhigh",
			),
		/Unsupported Google thinking level mapping/,
	);

	const generativePayload = await captureGooglePayload(
		resolve(piAiRoot, "dist", "api", "google-generative-ai.js"),
		googleModel("google-generative-ai", "gemini-3.7-flash", { high: "LOW" }),
		"high",
	);
	assert.equal(generativePayload.config?.thinkingConfig?.thinkingLevel, "LOW");
	assert.equal(generativePayload.config?.toolConfig?.functionCallingConfig?.mode, "NONE");

	const vertexPayload = await captureGooglePayload(
		resolve(piAiRoot, "dist", "api", "google-vertex.js"),
		googleModel("google-vertex", "gemini-2.5-flash", { max: "high" }),
		"max",
		{ high: 4321 },
	);
	assert.equal(vertexPayload.config?.thinkingConfig?.thinkingBudget, 4321);
	assert.equal(vertexPayload.config?.toolConfig?.functionCallingConfig?.mode, "NONE");
});

test("Bedrock forwards raw Smithy response headers to onResponse", async (t) => {
	let server: Server | undefined;
	t.after(async () => {
		if (!server) return;
		await new Promise<void>((resolveClose, rejectClose) => {
			server?.close((error) => (error ? rejectClose(error) : resolveClose()));
		});
	});
	const modelId = "us.anthropic.claude-haiku-4-5-20251001-v1:0";
	server = createServer((_request, response) => {
		response.writeHead(200, {
			"content-type": "application/vnd.amazon.eventstream",
			"x-amzn-requestid": "req-123",
			"x-bifrost-provider": "bedrock",
			"x-bifrost-resolved-model": modelId,
		});
		response.end();
	});
	await new Promise<void>((resolveListen) => server?.listen(0, "127.0.0.1", resolveListen));
	const address = server.address();
	assert.ok(address && typeof address !== "string");

	const bedrock = await import(
		`${pathToFileURL(resolve(piAiRoot, "dist", "api", "bedrock-converse-stream.js")).href}?forward-fix=${Date.now()}`
	);
	const compat = await import(
		`${pathToFileURL(resolve(piAiRoot, "dist", "compat.js")).href}?forward-fix=${Date.now()}`
	);
	const responses: Array<{ status: number; headers: Record<string, string> }> = [];
	const model = {
		...compat.getModel("amazon-bedrock", modelId),
		baseUrl: `http://127.0.0.1:${address.port}`,
	};
	const result = await bedrock.stream(
		model,
		{ messages: [{ role: "user", content: "hello", timestamp: Date.now() }] },
		{
			cacheRetention: "none",
			env: { AWS_BEDROCK_FORCE_HTTP1: "1", AWS_BEDROCK_SKIP_AUTH: "1" },
			onResponse: (response: { status: number; headers: Record<string, string> }) => {
				responses.push(response);
			},
		},
	).result();

	assert.equal(result.stopReason, "error");
	assert.equal(responses.length, 1);
	assert.equal(responses[0].status, 200);
	assert.equal(responses[0].headers["x-amzn-requestid"], "req-123");
	assert.equal(responses[0].headers["x-bifrost-provider"], "bedrock");
	assert.equal(responses[0].headers["x-bifrost-resolved-model"], modelId);
});

test("patched Xiaomi and China ZAI catalogs expose only current provider models", async () => {
	const providers = await import(
		`${pathToFileURL(resolve(piAiRoot, "dist", "providers", "all.js")).href}?forward-fix=${Date.now()}`
	);
	for (const provider of [
		"xiaomi",
		"xiaomi-token-plan-cn",
		"xiaomi-token-plan-ams",
		"xiaomi-token-plan-sgp",
	]) {
		const modelIds = providers.getBuiltinModels(provider).map((model: { id: string }) => model.id);
		for (const id of ["mimo-v2-flash", "mimo-v2-omni", "mimo-v2-pro"]) {
			assert.equal(modelIds.includes(id), false, `${provider} retained ${id}`);
		}
		for (const id of ["mimo-v2.5", "mimo-v2.5-pro"]) {
			assert.equal(modelIds.includes(id), true, `${provider} omitted ${id}`);
		}
	}
	assert.deepEqual(providers.getBuiltinModel("zai", "glm-5.2").cost, {
		input: 1.4,
		output: 4.4,
		cacheRead: 0.26,
		cacheWrite: 0,
	});
	for (const id of ["glm-4.6v", "glm-5.1", "glm-5v-turbo"]) {
		assert.equal(providers.getBuiltinModel("zai-coding-cn", id).id, id);
	}
	for (const id of ["zai-org/GLM-5.2", "zai-org/GLM-5.2-Fast"]) {
		assert.deepEqual(providers.getBuiltinModel("baseten", id).input, ["text"]);
	}
});

function openAiCompletionsModel(provider: string, id: string, baseUrl: string) {
	return {
		id,
		name: id,
		api: "openai-completions" as const,
		provider,
		baseUrl,
		reasoning: true,
		input: ["text" as const],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128_000,
		maxTokens: 4096,
	};
}

test("OpenAI-compatible history bounds foreign tool IDs and preserves result pairing", async () => {
	const openAiCompletions = await importPatchedOpenAiCompletions("tool-ids");
	const ids = [
		"a".repeat(40),
		"a".repeat(41),
		`${"same-prefix-".repeat(6)}first`,
		`${"same-prefix-".repeat(6)}second`,
		"short.native:1",
	];
	const assistant = {
		role: "assistant" as const,
		content: ids.map((id, index) => ({
			type: "toolCall" as const,
			id,
			name: "read",
			arguments: { path: `file-${index}` },
		})),
		api: "other",
		provider: "other",
		model: "other",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "toolUse" as const,
		timestamp: 1,
	};
	const results = ids.map((toolCallId, index) => ({
		role: "toolResult" as const,
		toolCallId,
		toolName: "read",
		content: [{ type: "text" as const, text: `result-${index}` }],
		isError: false,
		timestamp: 2 + index,
	}));
	let payload: any;
	const response = await openAiCompletions.streamSimple(
		openAiCompletionsModel("custom-gateway", "proxy-model", "https://gateway.example/v1"),
		{ messages: [{ role: "user", content: "read", timestamp: 0 }, assistant, ...results] },
		{
			apiKey: "test",
			onPayload: (next: unknown) => {
				payload = next;
				throw new Error("captured tool IDs");
			},
		},
	).result();
	assert.match(response.errorMessage ?? "", /captured tool IDs/);
	const callIds = payload.messages.find((message: any) => message.role === "assistant")
		.tool_calls.map((call: any) => call.id);
	const resultIds = payload.messages.filter((message: any) => message.role === "tool")
		.map((message: any) => message.tool_call_id);
	assert.deepEqual(callIds, resultIds);
	assert.equal(callIds[0], ids[0]);
	assert.equal(callIds[4], ids[4]);
	assert.equal(callIds[1].length, 40);
	assert.equal(new Set(callIds).size, ids.length);
	for (const id of callIds.slice(1, 4)) {
		assert.match(id, /^[A-Za-z0-9_-]+$/);
		assert.ok(id.length <= 40);
	}
});

test("OpenAI-compatible compaction omits tool_choice when no tools are available", async () => {
	const openAiCompletions = await importPatchedOpenAiCompletions("tool-choice");
	let payload: any;
	const response = await openAiCompletions.streamSimple(
		openAiCompletionsModel("custom-gateway", "proxy-model", "https://gateway.example/v1"),
		{ messages: [{ role: "user", content: "Summarize the conversation", timestamp: 0 }] },
		{
			apiKey: "test",
			toolChoice: "none",
			onPayload: (next: unknown) => {
				payload = next;
				throw new Error("captured compaction payload");
			},
		},
	).result();
	assert.match(response.errorMessage ?? "", /captured compaction payload/);
	assert.ok(payload);
	assert.equal("tool_choice" in payload, false);
	assert.equal("tools" in payload, false);
});

test("Gemini signatures and encrypted reasoning coexist across JSON replay", async (t) => {
	const firstSignature = "AgGDja8BCEmVrN0first";
	const laterSignature = "AgGDja8BCEmVrN0later";
	const encryptedDetail = {
		type: "reasoning.encrypted",
		id: "call_1",
		data: "encrypted-reasoning",
	};
	const server = createServer((_request, response) => {
		response.writeHead(200, { "content-type": "text/event-stream" });
		response.write(`data: ${JSON.stringify({
			id: "chatcmpl-signature",
			model: "google/gemini-3-test",
			choices: [{
				index: 0,
				delta: { reasoning_details: [encryptedDetail] },
				finish_reason: null,
			}],
		})}\n\n`);
		response.write(`data: ${JSON.stringify({
			id: "chatcmpl-signature",
			model: "google/gemini-3-test",
			choices: [{
				index: 0,
				delta: {
					tool_calls: [{
						index: 0,
						id: "call_1",
						type: "function",
						function: { name: "read", arguments: "{\"path\":\"README.md\"}" },
						extra_content: { google: { thought_signature: firstSignature } },
					}],
				},
				finish_reason: null,
			}],
		})}\n\n`);
		response.write(`data: ${JSON.stringify({
			id: "chatcmpl-signature",
			model: "google/gemini-3-test",
			choices: [{
				index: 0,
				delta: {
					tool_calls: [{
						index: 0,
						id: "call_1",
						type: "function",
						function: { name: "read", arguments: "" },
						extra_content: { google: { thought_signature: laterSignature } },
					}],
				},
				finish_reason: null,
			}],
		})}\n\n`);
		response.write(`data: ${JSON.stringify({
			id: "chatcmpl-signature",
			model: "google/gemini-3-test",
			choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
		})}\n\n`);
		response.end("data: [DONE]\n\n");
	});
	t.after(async () => {
		await new Promise<void>((resolveClose, rejectClose) =>
			server.close((error) => error ? rejectClose(error) : resolveClose())
		);
	});
	await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
	const address = server.address();
	assert.ok(address && typeof address !== "string");

	const openAiCompletions = await importPatchedOpenAiCompletions("signature");
	const model = openAiCompletionsModel(
		"openrouter",
		"google/gemini-3-test",
		`http://127.0.0.1:${address.port}`,
	);
	const first = await openAiCompletions.streamSimple(
		model,
		{
			messages: [{ role: "user", content: "read", timestamp: 0 }],
			tools: [{
				name: "read",
				description: "Read",
				parameters: { type: "object", properties: { path: { type: "string" } } },
			}],
		},
		{ apiKey: "test" },
	).result();
	const thinking = first.content.find((block: any) => block.type === "thinking") as any;
	const toolCall = first.content.find((block: any) => block.type === "toolCall") as any;
	assert.deepEqual(thinking, {
		type: "thinking",
		thinking: "",
		thinkingSignature: JSON.stringify([encryptedDetail]),
	});
	assert.equal(toolCall?.thoughtSignature, firstSignature);
	assert.equal("reasoningDetails" in first, false);

	let replayPayload: any;
	const persisted = JSON.parse(JSON.stringify(first));
	await openAiCompletions.streamSimple(
		model,
		{ messages: [persisted] },
		{
			apiKey: "test",
			onPayload: (next: unknown) => {
				replayPayload = next;
				throw new Error("captured signature replay");
			},
		},
	).result();
	assert.deepEqual(replayPayload.messages[0].tool_calls[0].extra_content, {
		google: { thought_signature: firstSignature },
	});
	assert.deepEqual(replayPayload.messages[0].reasoning_details, [encryptedDetail]);
});

test("structured reasoning merges ordered deltas and replays only to the same model", async (t) => {
	const textDelta = { type: "reasoning.text", text: "The", index: 0 };
	const textDeltaWithSignature = {
		type: "reasoning.text",
		text: " answer",
		id: "reasoning-text-1",
		format: "openai-responses-v1",
		index: 0,
		signature: "sha256:text-signature",
	};
	const summaryDelta = { type: "reasoning.summary", summary: "Checked", index: 1 };
	const summaryDeltaWithFormat = {
		type: "reasoning.summary",
		summary: " sources.",
		id: "reasoning-summary-1",
		format: "openai-responses-v1",
		index: 1,
	};
	const encryptedFirst = {
		type: "reasoning.encrypted",
		id: "encrypted-1",
		data: "ciphertext-1",
		index: 2,
	};
	const encryptedSecond = {
		type: "reasoning.encrypted",
		id: "encrypted-2",
		data: "ciphertext-2",
		index: 3,
	};
	const summaryAfterEncrypted = {
		type: "reasoning.summary",
		summary: "Kept separate after encryption.",
		index: 4,
	};
	const expectedReasoningDetails = [
		{
			type: "reasoning.text",
			text: "The answer",
			index: 0,
			signature: "sha256:text-signature",
			id: "reasoning-text-1",
			format: "openai-responses-v1",
		},
		{
			type: "reasoning.summary",
			summary: "Checked sources.",
			index: 1,
			id: "reasoning-summary-1",
			format: "openai-responses-v1",
		},
		encryptedFirst,
		encryptedSecond,
		summaryAfterEncrypted,
	];
	const server = createServer((_request, response) => {
		response.writeHead(200, { "content-type": "text/event-stream" });
		for (const delta of [
			{ reasoning: "The answer", reasoning_details: [textDelta] },
			{ reasoning_details: [textDeltaWithSignature] },
			{ reasoning_details: [summaryDelta, summaryDeltaWithFormat] },
			{ reasoning_details: [encryptedFirst, encryptedSecond] },
			{
				reasoning_details: [
					summaryAfterEncrypted,
					{ type: "reasoning.text", text: 42 },
					{ type: "reasoning.unknown", text: "ignored" },
				],
			},
			{ content: "Verified answer." },
		]) {
			response.write(`data: ${JSON.stringify({
				id: "chatcmpl-reasoning",
				model: "research-model",
				choices: [{ index: 0, delta, finish_reason: null }],
			})}\n\n`);
		}
		response.write(`data: ${JSON.stringify({
			id: "chatcmpl-reasoning",
			model: "research-model",
			choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
		})}\n\n`);
		response.end("data: [DONE]\n\n");
	});
	t.after(async () => {
		await new Promise<void>((resolveClose, rejectClose) =>
			server.close((error) => error ? rejectClose(error) : resolveClose())
		);
	});
	await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
	const address = server.address();
	assert.ok(address && typeof address !== "string");

	const openAiCompletions = await importPatchedOpenAiCompletions("structured-reasoning");
	const model = openAiCompletionsModel(
		"custom-gateway",
		"research-model",
		`http://127.0.0.1:${address.port}`,
	);
	const first = await openAiCompletions.streamSimple(
		model,
		{ messages: [{ role: "user", content: "research", timestamp: 0 }] },
		{ apiKey: "test" },
	).result();
	const thinking = first.content.find((block: any) => block.type === "thinking") as any;
	assert.deepEqual(thinking, {
		type: "thinking",
		thinking: "The answer",
		thinkingSignature: JSON.stringify(expectedReasoningDetails),
	});
	assert.equal("reasoningDetails" in first, false);

	let replayPayload: any;
	await openAiCompletions.streamSimple(
		model,
		{ messages: [JSON.parse(JSON.stringify(first))] },
		{
			apiKey: "test",
			onPayload: (next: unknown) => {
				replayPayload = next;
				throw new Error("captured structured reasoning replay");
			},
		},
	).result();
	const replayAssistant = replayPayload.messages.find((message: any) => message.role === "assistant");
	assert.deepEqual(replayAssistant.reasoning_details, expectedReasoningDetails);
	assert.equal("reasoning" in replayAssistant, false);
	assert.equal("reasoning_content" in replayAssistant, false);
	assert.equal("reasoning_text" in replayAssistant, false);

	for (const target of [
		openAiCompletionsModel("other-gateway", "research-model", "https://gateway.example/v1"),
		openAiCompletionsModel("custom-gateway", "other-model", "https://gateway.example/v1"),
	]) {
		let payload: any;
		await openAiCompletions.streamSimple(
			target,
			{ messages: [JSON.parse(JSON.stringify(first))] },
			{
				apiKey: "test",
				onPayload: (next: unknown) => {
					payload = next;
					throw new Error("captured cross-model replay");
				},
			},
		).result();
		const assistant = payload.messages.find((message: any) => message.role === "assistant");
		assert.equal("reasoning_details" in assistant, false);
	}
});

test("legacy top-level reasoning details require exact provider api and model identity", async () => {
	const openAiCompletions = await importPatchedOpenAiCompletions("legacy-reasoning-gate");
	const model = openAiCompletionsModel("custom-gateway", "research-model", "https://gateway.example/v1");
	const legacyDetails = [
		{ type: "reasoning.text", text: "legacy text", signature: "signed" },
		{ type: "reasoning.summary", summary: "legacy summary" },
		{ type: "reasoning.encrypted", id: "legacy-1", data: "legacy-ciphertext" },
	];
	const baseMessage = {
		role: "assistant",
		content: [{ type: "text", text: "answer" }],
		api: model.api,
		provider: model.provider,
		model: model.id,
		reasoningDetails: legacyDetails,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: 1,
	};
	for (const [name, message, expected] of [
		["same", baseMessage, legacyDetails],
		["provider", { ...baseMessage, provider: "other-gateway" }, undefined],
		["api", { ...baseMessage, api: "other-api" }, undefined],
		["model", { ...baseMessage, model: "other-model" }, undefined],
	] as const) {
		let payload: any;
		await openAiCompletions.streamSimple(
			model,
			{ messages: [message as any] },
			{
				apiKey: "test",
				onPayload: (next: unknown) => {
					payload = next;
					throw new Error(`captured ${name} legacy replay`);
				},
			},
		).result();
		const assistant = payload.messages.find((candidate: any) => candidate.role === "assistant");
		assert.deepEqual(assistant.reasoning_details, expected, name);
	}
});

test("provider retry handles only Retry-After in-flight budget 402 errors", async () => {
	const { isTransientInFlightBudgetError, retryProviderRequest } = await import(
		`${pathToFileURL(resolve(piAiRoot, "dist", "utils", "provider-retry.js")).href}?budget=${Date.now()}`
	);
	const transient = Object.assign(
		new Error("OpenRouter in_flight_budget_exhausted"),
		{
			status: 402,
			headers: new Headers({ "retry-after": "0" }),
			error: { code: "in_flight_budget_exhausted" },
		},
	);
	let transientAttempts = 0;
	assert.equal(isTransientInFlightBudgetError(transient), true);
	assert.equal(isTransientInFlightBudgetError(undefined), false);
	assert.equal(isTransientInFlightBudgetError({ status: 402 }), false);
	assert.equal(
		await retryProviderRequest(async () => {
			transientAttempts++;
			if (transientAttempts === 1) throw transient;
			return "recovered";
		}, { maxRetries: 1, retryOn: isTransientInFlightBudgetError }),
		"recovered",
	);
	assert.equal(transientAttempts, 2);

	let unscopedAttempts = 0;
	await assert.rejects(
		retryProviderRequest(async () => {
			unscopedAttempts++;
			throw transient;
		}, { maxRetries: 1 }),
		/in_flight_budget_exhausted/,
	);
	assert.equal(unscopedAttempts, 1);

	const ordinary429 = Object.assign(new Error("rate limited"), {
		status: 429,
		headers: new Headers({ "retry-after": "0" }),
	});
	let ordinaryAttempts = 0;
	assert.equal(
		await retryProviderRequest(async () => {
			ordinaryAttempts++;
			if (ordinaryAttempts === 1) throw ordinary429;
			return "standard retry recovered";
		}, { maxRetries: 1, retryOn: isTransientInFlightBudgetError }),
		"standard retry recovered",
	);
	assert.equal(ordinaryAttempts, 2);

	for (const error of [
		Object.assign(new Error("payment required"), {
			status: 402,
			headers: new Headers({ "retry-after": "0" }),
		}),
		Object.assign(new Error("in_flight_budget_exhausted"), {
			status: 402,
			headers: new Headers(),
		}),
		Object.assign(new Error("provider explicitly disabled retry"), {
			status: 402,
			headers: new Headers({ "retry-after": "120", "x-should-retry": "false" }),
			error: { code: "in_flight_budget_exhausted" },
		}),
	]) {
		let attempts = 0;
		await assert.rejects(
			retryProviderRequest(async () => {
				attempts++;
				throw error;
			}, { maxRetries: 1, retryOn: isTransientInFlightBudgetError }),
			new RegExp((error as Error).message.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
		);
		assert.equal(attempts, 1);
	}
});

test("provider retry patch upgrades the pre-review candidate to caller-scoped policy", () => {
	const current = readPiAiSource(piAiRoot, "dist/utils/provider-retry.js");
	const legacyCandidate = current
		.replace(
			`    if (!(error instanceof Error) ||
        error.status !== 402 ||
        !(error.headers instanceof Headers) ||
        error.headers.get("x-should-retry") === "false" ||
        !error.headers.get("retry-after"))
        return false;`,
			`    if (error.status !== 402 || !error.headers?.get("retry-after"))
        return false;`,
		)
		.replace(
			`            if (retriesRemaining <= 0 || !isProviderError(error) ||
                !(isRetryableProviderError(error) || options.retryOn?.(error) === true))
                throw error;`,
			`            if (retriesRemaining <= 0 || !isProviderError(error) ||
                (options.retryOn ? !options.retryOn(error) : !isRetryableProviderError(error)))
                throw error;`,
		)
		.replace(
			`    if (error.status === undefined)
        return true;
`,
			`    if (error.status === undefined)
        return true;
    if (isTransientInFlightBudgetError(error))
        return true;
`,
		);
	assert.notEqual(legacyCandidate, current);
	assert.equal(
		patchPiAiForwardFixSource("dist/utils/provider-retry.js", legacyCandidate),
		current,
	);
});
