import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import {
	cpSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
	symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { Type } from "typebox";

import {
	assertPiAgentCorePatchSource,
	patchPiAgentCoreSource,
} from "../scripts/lib/pi-agent-core-patch.mjs";
import { RUNTIME_INPUT_FILES } from "../scripts/lib/runtime-workspace-integrity.mjs";

const appRoot = process.cwd();
const agentCoreRoot = resolve(
	appRoot,
	"node_modules",
	"@earendil-works",
	"pi-agent-core",
);
const agentLoopPath = resolve(agentCoreRoot, "dist", "agent-loop.js");
const abortGuardMarker =
	"Feynman Pi 0.84.2 forward patch: preserve queued input on abort #8658";

const emptyUsage = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

test("Pi 0.84.2 abort queue patch is exact, idempotent, drift-closed, and runtime-hashed", () => {
	const packageJson = JSON.parse(
		readFileSync(resolve(agentCoreRoot, "package.json"), "utf8"),
	) as { version?: string };
	assert.equal(packageJson.version, "0.85.1");

	const patchSource = readFileSync(
		resolve(appRoot, "scripts", "lib", "pi-agent-core-patch.mjs"),
		"utf8",
	);
	assert.match(
		patchSource,
		/const PI_AGENT_CORE_PATCH_REQUIRED_VERSION = "0\.84\.2";/,
	);
	const runtimePatchSource = readFileSync(
		resolve(appRoot, "src", "pi", "runtime-patches.ts"),
		"utf8",
	);
	const runtimeCorrectnessSource = readFileSync(
		resolve(appRoot, "scripts", "lib", "pi-runtime-correctness-patch.mjs"),
		"utf8",
	);
	assert.match(
		runtimeCorrectnessSource,
		/export const PI_RUNTIME_CORRECTNESS_REQUIRED_VERSION = "0\.85\.1";/,
	);
	assert.match(
		runtimePatchSource,
		/assertPiRuntimeCorrectnessVersion\(bundledPiVersion, "bundled pi-coding-agent"\)/,
	);
	assert.ok(
		RUNTIME_INPUT_FILES.includes("scripts/lib/pi-agent-core-patch.mjs"),
		"runtime input hash must include the AgentCore patch",
	);

	const once = patchPiAgentCoreSource(readFileSync(agentLoopPath, "utf8"));
	const twice = patchPiAgentCoreSource(once);
	assert.equal(twice, once);
	assert.match(once, new RegExp(abortGuardMarker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
	assert.match(
		once,
		/await emit\(\{ type: "turn_end", message, toolResults \}\);[\s\S]*if \(signal\?\.aborted\) \{[\s\S]*await emit\(\{ type: "agent_end", messages: newMessages \}\);[\s\S]*return;[\s\S]*lastCompletedTurn = \{/,
	);
	assert.doesNotThrow(() =>
		assertPiAgentCorePatchSource(once, "patched Pi 0.84.2 AgentCore")
	);

	const drifted = once.replace(
		"            if (signal?.aborted) {",
		"            if (false && signal?.aborted) {",
	);
	assert.notEqual(drifted, once);
	assert.throws(
		() => patchPiAgentCoreSource(drifted),
		/missing exact post-turn abort queue guard/,
	);
	const renamedLoop = readFileSync(agentLoopPath, "utf8").replace(
		"async function runLoop(",
		"async function bypassedRunLoop(",
	);
	const renamedLoopPatched = patchPiAgentCoreSource(renamedLoop);
	assert.match(
		renamedLoopPatched,
		new RegExp(abortGuardMarker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
	);
});

async function loadPatchedAgentCore(t: TestContext) {
	const tempRoot = mkdtempSync(join(tmpdir(), "feynman-pi-abort-"));
	t.after(() => rmSync(tempRoot, { recursive: true, force: true }));
	symlinkSync(resolve(appRoot, "node_modules"),
		resolve(tempRoot, "node_modules"), "dir");
	const packageRoot = resolve(tempRoot, "pi-agent-core");
	cpSync(agentCoreRoot, packageRoot, { recursive: true });
	const copiedAgentLoopPath = resolve(packageRoot, "dist", "agent-loop.js");
	writeFileSync(
		copiedAgentLoopPath,
		patchPiAgentCoreSource(readFileSync(copiedAgentLoopPath, "utf8")),
		"utf8",
	);
	return import(
		`${pathToFileURL(resolve(packageRoot, "dist", "index.js")).href}?abort-queue=${Date.now()}`
	) as Promise<typeof import("@earendil-works/pi-agent-core")>;
}

for (const queueKind of ["steering", "follow-up"] as const) {
	test(`tool-time abort preserves queued ${queueKind} input without a second LLM call`, async (t) => {
		const { runAgentLoop } = await loadPatchedAgentCore(t);
		const controller = new AbortController();
		let toolIsRunning = false;
		let markToolStarted: (() => void) | undefined;
		const toolStarted = new Promise<void>((resolveStarted) => {
			markToolStarted = resolveStarted;
		});
		let releaseTool: (() => void) | undefined;
		const queuedMessage = {
			role: "user" as const,
			content: `${queueKind} research input`,
			timestamp: Date.now(),
		};
		const queuedMessages = [queuedMessage];
		let queueReads = 0;
		const readQueue = async () => {
			queueReads++;
			if (!toolIsRunning) return [];
			return queuedMessages.splice(0);
		};
		const slowTool = {
			name: "slow",
			label: "Slow",
			description: "Hold a research turn while input is queued",
			parameters: Type.Object({}),
			executionMode: "sequential" as const,
			async execute(
				_id: string,
				_params: unknown,
				signal?: AbortSignal,
			) {
				toolIsRunning = true;
				markToolStarted?.();
				await new Promise<void>((resolveTool) => {
					releaseTool = resolveTool;
					if (signal?.aborted) {
						resolveTool();
						return;
					}
					signal?.addEventListener("abort", () => resolveTool(), { once: true });
				});
				return {
					content: [{ type: "text" as const, text: "tool stopped" }],
					details: {},
					isError: true,
				};
			},
		};
		const model = {
			id: "abort-queue-test",
			name: "abort-queue-test",
			api: "openai-completions" as const,
			provider: "abort-queue-test",
			baseUrl: "https://provider.example/v1",
			reasoning: false,
			input: ["text" as const],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 8192,
			maxTokens: 1024,
		};
		let llmCalls = 0;
		const streamFn = () => {
			llmCalls++;
			const stream = createAssistantMessageEventStream();
			if (llmCalls === 1) {
				queueMicrotask(() => {
					stream.push({
						type: "done",
						reason: "toolUse",
						message: {
							role: "assistant",
							content: [{
								type: "toolCall",
								id: "slow-1",
								name: "slow",
								arguments: {},
							}],
							api: model.api,
							provider: model.provider,
							model: model.id,
							usage: emptyUsage,
							stopReason: "toolUse",
							timestamp: Date.now(),
						},
					});
				});
			}
			return stream;
		};
		const events: Array<{ type: string; messages?: unknown[] }> = [];
		const run = runAgentLoop(
			[{ role: "user", content: "start", timestamp: Date.now() }],
			{ systemPrompt: "", messages: [], tools: [slowTool] },
			{
				model,
				convertToLlm: (messages) => messages as never,
				toolExecution: "sequential",
				...(queueKind === "steering"
					? { getSteeringMessages: readQueue }
					: { getFollowUpMessages: readQueue }),
			},
			(event) => {
				events.push(event as { type: string; messages?: unknown[] });
			},
			controller.signal,
			streamFn,
		);

		await toolStarted;
		controller.abort();
		releaseTool?.();
		const messages = await run;

		assert.equal(llmCalls, 1);
		assert.equal(
			events.filter((event) => event.type === "agent_end").length,
			1,
		);
		assert.equal(
			events.filter((event) => event.type === "turn_end").length,
			1,
		);
		assert.equal(events.at(-1)?.type, "agent_end");
		assert.equal(queueReads, queueKind === "steering" ? 1 : 0);
		assert.deepEqual(queuedMessages, [queuedMessage]);
		assert.equal(
			messages.some(
				(message) =>
					message.role === "user" &&
					message.content === queuedMessage.content,
			),
			false,
		);
		assert.equal(
			messages.filter(
				(message) =>
					message.role === "assistant" &&
					message.stopReason === "aborted",
			).length,
			0,
		);
	});
}
