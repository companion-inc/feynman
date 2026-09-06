import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { assertPiSubagentsNativeSources } from "./pi-subagents-native-patch.mjs";

export function assertPiSubagentUsageLimitFallbackSource(readSource, label) {
	const required = [
		"const RETRYABLE_MODEL_FAILURE_PATTERNS = [",
		"\t/rate\\s*limit/i,",
		"\t/usage\\s*limit/i,",
		"\t/too many requests/i,",
	].join("\n");
	if (!readSource("src/runs/shared/model-fallback.ts").includes(required)) {
		throw new Error(`${label} model fallback does not retry provider usage-limit errors`);
	}
}

function assistant(type, provider = "research", model = "model", extra = {}) {
	return {
		type,
		message: {
			role: "assistant", provider, model,
			content: [{ type: "text", text: "RESEARCH_RESULT" }],
			stopReason: "stop",
			usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, cost: { total: 0 } },
			...extra,
		},
	};
}

/** Injectable native session, with no provider, credentials, shell, or Pi spawn. */
function scriptedFactory(scenarios) {
	const receipt = { launches: [], aborted: 0, disposed: 0, effects: 0 };
	const factory = {
		async create(launch) {
			const scenario = scenarios[receipt.launches.length];
			assert.ok(scenario, "Unexpected fallback child launch");
			receipt.launches.push(launch);
			let listener;
			let aborted = false;
			return {
				subscribe(fn) { listener = fn; return () => { listener = undefined; }; },
				async prompt() {
					for (const event of scenario) {
						if (aborted) return;
						listener?.(event);
						if (event.type === "tool_execution_start") receipt.effects++;
					}
				},
				async abort() { aborted = true; receipt.aborted++; },
				async dispose() { receipt.disposed++; },
				async steer() {},
				async followUp() {},
				messages: [],
				sessionId: `native-test-${receipt.launches.length}`,
				modelId: launch.model,
			};
		},
		async dispose() {},
	};
	return { factory, receipt };
}

export async function verifyPiSubagentsNativeBehavior(subagentsRoot, jiti) {
	const root = mkdtempSync(resolve(tmpdir(), "feynman-native-subagent-"));
	const isolated = {
		HOME: root, PI_CODING_AGENT_DIR: root, FEYNMAN_CODING_AGENT_DIR: root,
		PI_SUBAGENTS_TEMP_ROOT: resolve(root, "temp"), PI_MODEL_EXCLUSIONS_PATH: resolve(root, "exclusions.json"),
	};
	const previous = Object.fromEntries(Object.keys(isolated).map((key) => [key, process.env[key]]));
	Object.assign(process.env, isolated);
	try {
		return await verifyNativeBehaviorInHome(subagentsRoot, jiti, root);
	} finally {
		for (const [key, value] of Object.entries(previous)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		rmSync(root, { recursive: true, force: true });
	}
}

async function verifyNativeBehaviorInHome(subagentsRoot, jiti, root) {
	assertPiSubagentsNativeSources((relativePath) => readFileSync(resolve(subagentsRoot, relativePath), "utf8"));
	const fallback = await jiti.import(resolve(subagentsRoot, "src/runs/shared/model-fallback.ts"));
	const execution = await jiti.import(resolve(subagentsRoot, "src/runs/foreground/execution.ts"));
	const background = await jiti.import(resolve(subagentsRoot, "src/runs/background/run-child-session.ts"));
	const metadata = await jiti.import(resolve(subagentsRoot, "src/extension/tool-description.ts"));
	const boundary = await jiti.import(resolve(subagentsRoot, "src/extension/tool-result.ts"));
	const availableModels = [
		{ provider: "research", id: "model", fullId: "research/model" },
		{ provider: "research", id: "fallback", fullId: "research/fallback" },
	];
	assert.match(metadata.buildSubagentToolDescription(), /runs\.all/);
	assert.doesNotMatch(metadata.buildSubagentToolDescription(), /\{ tasks \}|\{ chain \}/);
	for (const mode of [undefined, "compact", "full"]) {
		assert.match(metadata.buildSubagentToolDescription({ toolDescriptionMode: mode }), /exact approved provider\/model/);
	}
	assert.match(metadata.buildSubagentToolPromptMetadata().promptSnippet, /research/);
	assert.throws(() => boundary.finalizeToolResult({ isError: true, content: [{ type: "text", text: "invalid agent" }] }), /invalid agent/);
	const success = { content: [{ type: "text", text: "done" }] };
	assert.equal(boundary.finalizeToolResult(success), success);

	assert.equal(fallback.formatSubagentModelVerificationError("research/model:max", "research", "model", availableModels), undefined);
	for (const [provider, model] of [["foreign", "model"], ["research", "fallback"], ["research", "leaf"], [undefined, "model"]]) {
		assert.match(fallback.formatSubagentModelVerificationError("research/model", provider, model, []), /model_verification_failed/);
	}
	assert.equal(fallback.isContextOverflow("context_length_exceeded: maximum context length"), true);
	for (const error of ["429 rate limit maximum 100000 tokens per minute", "HTTP 411 length_required", "output max_tokens must be <= 8192", "research-tools failed with exit code 1 maximum context length"]) {
		assert.equal(fallback.isContextOverflow(error), false, error);
	}
	assert.equal(fallback.isRetryableModelFailure("The usage limit has been reached"), true);

	let cases = 0;
	{
		for (const host of ["foreground", "background"]) {
			for (const scenario of [
				{ name: "matching", events: [assistant("message_start"), assistant("message_end")], success: true },
				{ name: "wrong-provider-before-tool", events: [assistant("message_start", "foreign"), { type: "tool_execution_start", toolName: "write", args: {} }], success: false },
				{ name: "missing-start-wrong-model", events: [assistant("message_end", "research", "fallback")], success: false },
				{ name: "tool-bearing-wrong-model", events: [assistant("message_end", "foreign", "model", { content: [{ type: "toolCall", id: "bad", name: "write", arguments: {} }], stopReason: "toolUse" }), { type: "tool_execution_start", toolName: "write", args: {} }], success: false },
				{ name: "missing-provider", events: [assistant("message_end", "research", "model", { provider: undefined })], success: false },
				{ name: "identity-changes-after-start", events: [assistant("message_start"), assistant("message_end", "foreign")], success: false },
				{ name: "backfilled-tool-result", events: [
					assistant("message_start"),
					assistant("message_end", "research", "model", { content: [{ type: "toolCall", id: "read-1", name: "read", arguments: {} }], stopReason: "toolUse" }),
					{ type: "tool_execution_start", toolCallId: "read-1", toolName: "read", args: {} },
					{ type: "tool_result_end", message: { role: "toolResult", toolCallId: "read-1", toolName: "read", content: [{ type: "text", text: "evidence" }] } },
					assistant("message_end"),
				], success: true, tools: 1 },
			]) {
				const { factory, receipt } = scriptedFactory([scenario.events]);
				let result;
				if (host === "foreground") {
					result = await execution.runSync(root, [{
						name: "researcher", description: "read-only researcher", systemPrompt: "",
						systemPromptMode: "replace", inheritProjectContext: false, inheritSkills: false,
						model: "research/model", fallbackModels: ["research/fallback"],
					}], "researcher", "Read the evidence", {
						runId: `${host}-${scenario.name}`, acceptance: false, availableModels,
						childSessionFactory: factory,
					});
				} else {
					result = await background.runChildSession({
						factory, launch: { session: { cwd: root, model: "research/model", storage: { kind: "memory" } } },
						prompt: "Read the evidence", expectedModelForVerification: "research/model",
						modelVerificationRegistry: availableModels,
						appendChildEvent() {}, writeOutputLine() {},
					});
				}
				assert.equal(result.exitCode === 0, scenario.success, `${host}/${scenario.name}: ${result.error}`);
				if (!scenario.success) {
					assert.match(result.error, /^model_verification_failed:/);
					assert.equal(receipt.aborted, 1);
					assert.equal(receipt.effects, 0);
				}
				assert.equal(receipt.launches.length, 1, "Model mismatch must not trigger fallback");
				assert.equal(receipt.disposed, 1);
				if (scenario.tools) {
					assert.equal(host === "foreground" ? result.progressSummary.toolCount : result.toolCount, scenario.tools);
					assert.equal(result.currentTool, undefined);
				}
				cases++;
			}
		}
		// A context overflow must stop instead of retrying the identical input.
		const overflow = scriptedFactory([[assistant("message_end", "research", "model", {
			stopReason: "error", errorMessage: "context_length_exceeded: maximum context length", content: [],
		})]]);
		const result = await execution.runSync(root, [{
			name: "researcher", description: "researcher", systemPrompt: "", systemPromptMode: "replace",
			inheritProjectContext: false, inheritSkills: false, model: "research/model", fallbackModels: ["research/fallback"],
		}], "researcher", "Read evidence", {
			runId: "context-overflow", acceptance: false, availableModels, childSessionFactory: overflow.factory,
		});
		assert.equal(result.contextOverflow, true);
		assert.equal(overflow.receipt.launches.length, 1);
		cases++;
		const inherited = scriptedFactory([[assistant("message_start", "parent-gateway"), assistant("message_end", "parent-gateway")]]);
		const inheritedResult = await execution.runSync(root, [{
			name: "researcher", description: "researcher", systemPrompt: "", systemPromptMode: "replace",
			inheritProjectContext: false, inheritSkills: false, model: "research/model",
		}], "researcher", "Read evidence", {
			runId: "inherited-parent-model", acceptance: false, availableModels,
			modelOverrideFromParent: true, childSessionFactory: inherited.factory,
		});
		assert.equal(inheritedResult.exitCode, 0, inheritedResult.error);
		assert.equal(inherited.receipt.aborted, 0);
		cases++;
	}
	await verifyNativeToolRegistration(subagentsRoot, jiti, root);
	return { nativeLifecycleCases: cases, providerRequests: 0 };
}

async function verifyNativeToolRegistration(subagentsRoot, jiti, root) {
	mkdirSync(resolve(root, "extensions/subagent"), { recursive: true });
	writeFileSync(resolve(root, "extensions/subagent/config.json"), JSON.stringify({
		missions: { enabled: false }, fleetView: false, asyncWidget: false, asyncByDefault: true,
	}));
	mkdirSync(resolve(root, "agents"), { recursive: true });
	for (const name of ["researcher", "reviewer", "writer", "verifier"]) {
		writeFileSync(resolve(root, "agents", `${name}.md`), `---\nname: ${name}\ndescription: Research ${name}\ntools: read\n---\nRead evidence.\n`);
	}
	writeFileSync(resolve(root, "agents/broken.md"), "---\nname: broken\ndescription: Invalid test profile\nasync: not-a-boolean\n---\nInvalid profile.\n");
	const extension = await jiti.import(resolve(subagentsRoot, "src/extension/index.ts"));
	const tools = [];
	const handlers = new Map();
	const pi = {
		events: { on: () => () => {}, emit() {} },
		on(name, fn) {
			const list = handlers.get(name) ?? [];
			list.push(fn);
			handlers.set(name, list);
		},
		registerTool(tool) { tools.push(tool); },
		registerCommand() {}, registerShortcut() {}, registerMessageRenderer() {}, registerFlag() {},
		getAllTools: () => [], getActiveTools: () => [], getCommands: () => [], getFlag: () => undefined,
	};
	try {
		extension.default(pi);
		assert.deepEqual(tools.map((tool) => tool.name).sort(), ["bg_wait", "subagent"]);
		const tool = tools.find((candidate) => candidate.name === "subagent");
		assert.ok(tool.parameters.properties.workflowScript);
		assert.equal(tool.parameters.properties.tasks, undefined);
		assert.equal(tool.parameters.properties.chain, undefined);
		const ctx = {
			cwd: root, hasUI: false, isIdle: () => true, model: { provider: "research", id: "model" },
			modelRegistry: { getAvailable: () => [{ provider: "research", id: "model" }] },
			sessionManager: { getSessionId: () => "probe", getSessionFile: () => undefined, getEntries: () => [], getBranch: () => [] },
			ui: { notify() {}, setStatus() {}, setWidget() {} },
		};
		const invoke = (params) => tool.execute("native-probe", params, new AbortController().signal, () => {}, ctx);
		const list = await invoke({ action: "list" });
		assert.notEqual(list.isError, true);
		for (const name of ["researcher", "reviewer", "writer", "verifier"]) assert.ok(JSON.stringify(list).includes(name));
		assert.match(JSON.stringify(list), /Invalid agent definitions/);
		await assert.rejects(() => invoke({ agent: "broken", task: "Must not launch", async: false }), /invalid configuration/);
		for (const workflowScript of [
			"return await runs.all([{key:'evidence',agent:'researcher',task:'Gather evidence'},{key:'review',agent:'reviewer',task:'Review claims'}])",
			"const evidence = await runs.run('evidence',{agent:'researcher',task:'Gather evidence'}); return await runs.run('verify',{agent:'verifier',task:evidence.output})",
		]) {
			const result = await invoke({ action: "validate", workflowScript });
			assert.notEqual(result.isError, true);
			const validation = JSON.parse(result.content.filter((item) => item.type === "text").map((item) => item.text).join("\n"));
			assert.equal(validation.ok, true);
			assert.deepEqual(validation.errors, []);
		}
		await assert.rejects(() => invoke({ action: "not-a-real-action" }), /Unknown action/);
	} finally {
		for (const handler of handlers.get("session_shutdown") ?? []) await handler({ type: "session_shutdown" }, {});
	}
}
