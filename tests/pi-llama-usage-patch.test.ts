import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import {
	createModels,
	hasApi,
	InMemoryCredentialStore,
	type Model,
	type ModelsStore,
	type ModelsStoreEntry,
} from "@earendil-works/pi-ai";

import {
	assertPiLlamaUsagePatchSource,
	assertPiLlamaUsageVersion,
	PI_LLAMA_USAGE_PATCH_MARKER,
	PI_LLAMA_USAGE_REQUIRED_FRAGMENTS,
	PI_LLAMA_USAGE_REQUIRED_VERSION,
	patchPiLlamaUsageSource,
} from "../scripts/lib/pi-llama-usage-patch.mjs";
import { patchPiRuntimeNodeModules } from "../src/pi/runtime-patches.js";

const appRoot = process.cwd();
const providerPath = resolve(
	appRoot,
	"node_modules",
	"@earendil-works",
	"pi-coding-agent",
	"dist",
	"extensions",
	"llama",
	"provider.js",
);

test("Pi 0.85.1 llama.cpp patch is exact, idempotent, and version-gated", () => {
	patchPiRuntimeNodeModules(appRoot);
	const source = readFileSync(providerPath, "utf8");
	assert.match(source, new RegExp(PI_LLAMA_USAGE_PATCH_MARKER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
	assertPiLlamaUsagePatchSource(source);
	assert.equal(patchPiLlamaUsageSource(source), source);
	assert.doesNotThrow(() =>
		assertPiLlamaUsageVersion(PI_LLAMA_USAGE_REQUIRED_VERSION, "test"),
	);
	assert.throws(
		() => assertPiLlamaUsageVersion("0.82.1", "test"),
		/expected 0\.85\.1, found 0\.82\.1/,
	);
	assert.throws(
		() => assertPiLlamaUsageVersion("0.84.0", "test"),
		/expected 0\.85\.1, found 0\.84\.0/,
	);
	assert.throws(
		() => assertPiLlamaUsagePatchSource(source.replace("supportsUsageInStreaming: true,", "")),
		/Incomplete Pi llama\.cpp usage patch/,
	);
	assert.throws(
		() =>
			patchPiLlamaUsageSource(
				source
					.replace(PI_LLAMA_USAGE_PATCH_MARKER, "")
					.replace("supportsUsageInStreaming: true,", "supportsUsageInStreaming: false,"),
			),
		/0\.85\.1 llama\.cpp layout: upstream streaming usage capability was not found exactly once/,
	);
	for (const fragment of PI_LLAMA_USAGE_REQUIRED_FRAGMENTS) {
		assert.throws(
			() => assertPiLlamaUsagePatchSource(source.replace(fragment, "")),
			/Incomplete Pi llama\.cpp usage patch/,
		);
	}
	assert.throws(
		() =>
			assertPiLlamaUsagePatchSource(
					source.replace(
						"const restored = repairedStoredModels.filter((model) => model.provider === LLAMA_PROVIDER_ID",
						"const restored = context.stored.models.filter((model) => model.provider === LLAMA_PROVIDER_ID",
					),
			),
		/Incomplete Pi llama\.cpp usage patch/,
	);
	assert.throws(
		() =>
			assertPiLlamaUsagePatchSource(
				source.replace(
					"...(repaired ? { persist: { ...context.stored, models: repairedStoredModels } } : {}),",
					"...(false ? { persist: { ...context.stored, models: repairedStoredModels } } : {}),",
				),
			),
		/Incomplete Pi llama\.cpp usage patch/,
	);
});

const staleModel: Model<"openai-completions"> = {
	id: "local-model",
	name: "Local model",
	api: "openai-completions" as const,
	provider: "llama.cpp",
	baseUrl: "http://127.0.0.1:8080/v1",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 4096,
	maxTokens: 4096,
	compat: {
		supportsStore: false,
		supportsDeveloperRole: false,
		supportsReasoningEffort: false,
		supportsUsageInStreaming: false,
		supportsStrictMode: false,
		maxTokensField: "max_tokens" as const,
	},
};

async function listen(
	handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>,
): Promise<{ close: () => Promise<void>; url: string }> {
	const server = createServer(handler);
	await new Promise<void>((resolveListen, rejectListen) => {
		server.once("error", rejectListen);
		server.listen(0, "127.0.0.1", resolveListen);
	});
	const address = server.address();
	assert.ok(address && typeof address === "object");
	return {
		close: () =>
			new Promise<void>((resolveClose, rejectClose) => {
				server.close((error) => (error ? rejectClose(error) : resolveClose()));
			}),
		url: `http://127.0.0.1:${address.port}`,
	};
}

test("llama.cpp cache migration uses the real file store and preserves other providers", async () => {
	patchPiRuntimeNodeModules(appRoot);
	const { createLlamaProvider } = await import(
		`${pathToFileURL(providerPath).href}?feynman-llama-cache`
	);
	const { provider } = createLlamaProvider();
	const storeModulePath = resolve(
		appRoot,
		"node_modules",
		"@earendil-works",
		"pi-coding-agent",
		"dist",
		"core",
		"models-store.js",
	);
	const { FileModelsStore } = await import(pathToFileURL(storeModulePath).href);
	const root = mkdtempSync(resolve(tmpdir(), "feynman-llama-model-store-"));
	try {
		const storePath = resolve(root, "models-store.json");
		const otherProvider = {
			models: [{ id: "other-model", provider: "other-provider" }],
			checkedAt: 999,
		};
		writeFileSync(
			storePath,
			JSON.stringify(
				{
					"llama.cpp": { models: [staleModel], checkedAt: 123 },
					"other-provider": otherProvider,
				},
				null,
				2,
			),
		);
		const fileStore = new FileModelsStore(storePath);
		const models = createModels({ modelsStore: fileStore });
		models.setProvider(provider);
		const refresh = await models.refresh({
			allowNetwork: false,
			providers: ["llama.cpp"],
		});
		assert.equal(refresh.aborted, false);
		assert.deepEqual([...refresh.errors], []);

		const model = provider.getModels()[0];
		assert.equal(model?.compat?.supportsUsageInStreaming, true);
		const persisted = JSON.parse(readFileSync(storePath, "utf8"));
		assert.equal(
			persisted["llama.cpp"].models[0].compat.supportsUsageInStreaming,
			true,
		);
		assert.equal(persisted["llama.cpp"].checkedAt, 123);
		assert.deepEqual(persisted["other-provider"], otherProvider);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("llama.cpp serializes cache repair with a concurrent network refresh", async () => {
	patchPiRuntimeNodeModules(appRoot);
	let catalogRequests = 0;
	const server = await listen((request, response) => {
		if (request.url === "/models") {
			catalogRequests += 1;
			response.setHeader("Content-Type", "application/json");
			response.end(
				JSON.stringify({
					data: [
						{
							id: "fresh-model",
							status: { value: "loaded" },
							meta: { n_ctx: 8192 },
						},
					],
				}),
			);
			return;
		}
		response.statusCode = 404;
		response.end();
	});
	try {
		const { createLlamaProvider } = await import(
			`${pathToFileURL(providerPath).href}?feynman-llama-race`
		);
		const { provider } = createLlamaProvider();
		let state: ModelsStoreEntry = { models: [staleModel], checkedAt: 123 };
		let enterFirstWrite: (() => void) | undefined;
		const firstWriteEntered = new Promise<void>((resolveEntered) => {
			enterFirstWrite = resolveEntered;
		});
		let releaseFirstWrite: (() => void) | undefined;
		const firstWriteGate = new Promise<void>((resolveGate) => {
			releaseFirstWrite = resolveGate;
		});
		let writeCount = 0;
		const store: ModelsStore = {
			read: async () => structuredClone(state),
			write: async (_providerId: string, entry: ModelsStoreEntry, options) => {
				writeCount += 1;
				if (writeCount === 1) {
					enterFirstWrite?.();
					await firstWriteGate;
				}
				options?.signal?.throwIfAborted();
				state = structuredClone(entry);
			},
			delete: async () => {},
		};
		const credentials = new InMemoryCredentialStore();
		await credentials.modify("llama.cpp", async () => ({
			type: "api_key",
			key: "local",
			env: { LLAMA_BASE_URL: server.url },
		}));
		const models = createModels({ credentials, modelsStore: store });
		models.setProvider(provider);
		const offlineRefresh = models.refresh({
			allowNetwork: false,
			providers: ["llama.cpp"],
		});
		await firstWriteEntered;
		const networkRefresh = models.refresh({
			allowNetwork: true,
			providers: ["llama.cpp"],
		});
		await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
		assert.equal(catalogRequests, 0);
		releaseFirstWrite?.();
		await Promise.all([offlineRefresh, networkRefresh]);

		assert.equal(catalogRequests, 1);
		const freshModel = state.models[0];
		assert.ok(freshModel);
		assert.ok(hasApi(freshModel, "openai-completions"));
		assert.equal(freshModel.id, "fresh-model");
		assert.equal(freshModel.compat?.supportsUsageInStreaming, true);
	} finally {
		await server.close();
	}
});

test("llama.cpp streaming requests usage and restores nonzero token accounting", async () => {
	patchPiRuntimeNodeModules(appRoot);
	let requestBody: Record<string, unknown> | undefined;
	const server = await listen(async (request, response) => {
		if (request.url !== "/v1/chat/completions") {
			response.statusCode = 404;
			response.end();
			return;
		}
		let body = "";
		for await (const chunk of request) body += chunk;
		requestBody = JSON.parse(body);
		response.writeHead(200, {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache",
			Connection: "keep-alive",
		});
		const base = {
			id: "chatcmpl-feynman",
			object: "chat.completion.chunk",
			created: 1,
			model: "local-model",
		};
		response.write(
			`data: ${JSON.stringify({
				...base,
				choices: [
					{
						index: 0,
						delta: { role: "assistant", content: "done" },
						finish_reason: null,
					},
				],
			})}\n\n`,
		);
		response.write(
			`data: ${JSON.stringify({
				...base,
				choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
				usage: {
					prompt_tokens: 10,
					completion_tokens: 2,
					total_tokens: 12,
					prompt_tokens_details: {
						cached_tokens: 3,
						cache_write_tokens: 1,
					},
				},
			})}\n\n`,
		);
		response.end("data: [DONE]\n\n");
	});
	try {
		const { createLlamaProvider } = await import(
			`${pathToFileURL(providerPath).href}?feynman-llama-stream`
		);
		const { provider } = createLlamaProvider();
		const model = {
			...staleModel,
			baseUrl: `${server.url}/v1`,
			compat: {
				...staleModel.compat,
				supportsUsageInStreaming: true,
			},
		};
		const message = await provider
			.streamSimple(
				model,
				{
					messages: [{ role: "user", content: "count tokens", timestamp: 1 }],
				},
				{ apiKey: "local", maxRetries: 0 },
			)
			.result();

		assert.deepEqual(requestBody?.stream_options, { include_usage: true });
		assert.deepEqual(message.usage, {
			input: 6,
			output: 2,
			cacheRead: 3,
			cacheWrite: 1,
			reasoning: 0,
			totalTokens: 12,
			cost: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				total: 0,
			},
		});
	} finally {
		await server.close();
	}
});
