import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { assertPiSubagentAgentDiagnosticsSources } from "./pi-subagents-agent-diagnostics-patch.mjs";
import { assertPiSubagentPromptMetadataSources } from "./pi-subagents-prompt-metadata-patch.mjs";
import { assertPiSubagentsNativeSources, isPiSubagentsNativeSource } from "./pi-subagents-native-patch.mjs";
import { assertPiSubagentUsageLimitFallbackSource, verifyPiSubagentsNativeBehavior } from "./pi-subagents-native-verification.mjs";
export { assertPiSubagentUsageLimitFallbackSource };

function requireMarker(readSource, relativePath, marker, label) {
	if (!readSource(relativePath).includes(marker)) {
		throw new Error(`${label} ${relativePath} is missing ${marker}`);
	}
}

export function assertPiSubagentCorrectnessSources(readSource, label) {
	if (isPiSubagentsNativeSource(readSource)) {
		assertPiSubagentsNativeSources(readSource, label);
		return;
	}
	for (const marker of [
		'const SUBAGENT_MODEL_THINKING_SUFFIXES = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);',
		"entry.fullId === requested",
		"entry.fullId === expectedBase",
		"function parseExpectedSubagentModelIdentity(",
		"export function formatSubagentModelVerificationError(",
		"expected.provider === provider",
		"expected.model === model",
		"requested '${expectedModel}' resolved to '${expected.fullId}'",
		"export function inheritsParentModel(",
		"export function isContextOverflow(",
		"/context_length_exceeded/i",
		"if (TOOL_FAILURE_PREFIX.test(error.trim())) return false;",
	]) {
		requireMarker(readSource, "src/runs/shared/model-fallback.ts", marker, label);
	}
	for (const marker of [
		"const expectedModelForVerification = shared.verifyModel ? model : undefined;",
		"const verifyModel = Boolean(candidate) && !(options.modelOverrideFromParent && modelIndex === 0);",
		"identity.provider,",
		"identity.model,",
		"options.availableModels,",
		'evt.type === "message_start" && !firstAssistantMessageStartSeen',
		'evt.type === "message_end" && !verifyAssistantModelIdentity(evt.message)',
		'trySignalChild(proc, "SIGTERM");',
		"if (isSubagentModelVerificationFailure(result.error)) break modelAttemptsLoop;",
		"if (isContextOverflow(result.error)) {",
		"result.contextOverflow = true;",
		"break modelAttemptsLoop;",
		"Some Pi event streams omit tool_execution_end.",
	]) {
		requireMarker(readSource, "src/runs/foreground/execution.ts", marker, label);
	}
	for (const marker of [
		"const expectedModelForVerification = candidate && !(step.skipPrimaryModelVerification && modelIndex === 0) ? candidate : undefined;",
		"message.provider,",
		"message.model,",
		"modelVerificationRegistry,",
		'event.type === "message_start" && !firstAssistantMessageStartSeen',
		'event.type === "message_end" && !verifyAssistantModelIdentity(event.message)',
		'trySignalChild(child, "SIGTERM");',
		"if (isSubagentModelVerificationFailure(error)) break modelAttemptsLoop;",
		"if (isContextOverflow(error)) {",
		"contextOverflow: contextOverflow || undefined,",
		".contextOverflow = singleResult.contextOverflow;",
		"contextOverflow: r.contextOverflow,",
	]) {
		requireMarker(readSource, "src/runs/background/subagent-runner.ts", marker, label);
	}
	for (const marker of [
		"const primaryModelFromParent = inheritsParentModel(s.model, a.model, ctx.currentModel);",
		"...(primaryModelFromParent ? { skipPrimaryModelVerification: true } : {}),",
		"...(params.modelOverrideFromParent ? { skipPrimaryModelVerification: true } : {}),",
		"...(availableModels && availableModels.length > 0 ? { modelVerificationRegistry: availableModels } : {}),",
		"...(params.modelOverrideFromParent ? { modelOverrideFromParent: true } : {}),",
	]) {
		requireMarker(readSource, "src/runs/background/async-execution.ts", marker, label);
	}
	requireMarker(
		readSource,
		"src/runs/shared/parallel-utils.ts",
		"skipPrimaryModelVerification?: boolean;",
		label,
	);
	requireMarker(
		readSource,
		"src/runs/shared/parallel-utils.ts",
		"modelVerificationRegistry?: Array<{ provider: string; id: string; fullId: string }>;",
		label,
	);
	for (const marker of [
		"const modelOverrideFromParent = inheritsParentModel(params.model as string | undefined, a.model, parentModel);",
		"let modelOverrideFromParent = inheritsParentModel(params.model as string | undefined, agentConfig.model, parentModel);",
		"modelOverridesFromParent: boolean[];",
		"modelOverrideFromParent: input.modelOverridesFromParent[index],",
		"modelOverrideFromParent: recoveryDescriptor?.modelOverrideFromParent,",
	]) {
		requireMarker(readSource, "src/runs/foreground/subagent-executor.ts", marker, label);
	}
	const subagentExecutorSource = readSource(
		"src/runs/foreground/subagent-executor.ts",
	);
	if (
		/resolveEffectiveSubagentModel\(\s*\n\s*modelOverride,\s*\n\s*modelOverrideFromParent,/.test(
			subagentExecutorSource,
		)
	) {
		throw new Error(
			`${label} src/runs/foreground/subagent-executor.ts passes modelOverrideFromParent into the model resolver`,
		);
	}
	for (const marker of [
		"const effectiveModelsFromParent = input.step.parallel.map((task) =>",
		"modelOverrideFromParent: effectiveModelsFromParent[taskIndex],",
		"const effectiveModelFromParent = inheritsParentModel(explicitStepModel, agentConfig.model, ctx.model);",
		"modelOverrideFromParent: effectiveModelFromParent,",
	]) {
		requireMarker(readSource, "src/runs/foreground/chain-execution.ts", marker, label);
	}
	requireMarker(readSource, "src/shared/types.ts", "modelOverrideFromParent?: boolean;", label);
	requireMarker(readSource, "src/runs/background/async-resume.ts", '"modelOverrideFromParent"', label);
	requireMarker(readSource, "src/shared/types.ts", "contextOverflow?: boolean;", label);
	requireMarker(
		readSource,
		"src/runs/background/chain-root-attachment.ts",
		"child?.contextOverflow || step?.contextOverflow",
		label,
	);
	requireMarker(
		readSource,
		"src/runs/background/stale-run-reconciler.ts",
		"contextOverflow: child?.contextOverflow ?? step.contextOverflow",
		label,
	);
	requireMarker(
		readSource,
		"src/runs/background/async-status.ts",
		"...(step.contextOverflow ? { contextOverflow: true } : {}),",
		label,
	);
	for (const [relativePath, call] of [
		["src/extension/index.ts", "finalizeToolResult(await executeSubagentCollapsed("],
		["src/extension/fanout-child.ts", "finalizeToolResult(await executor.execute("],
		["src/runs/background/wait-tool.ts", "finalizeToolResult(await waitForSubagents("],
	]) {
		requireMarker(readSource, relativePath, "function finalizeToolResult<", label);
		requireMarker(readSource, relativePath, call, label);
	}
	requireMarker(
		readSource,
		"src/runs/foreground/subagent-executor.ts",
		"...(ok === 0 ? { isError: true } : {}),",
		label,
	);
}

export function assertPiSubagentPatchedSources(readSource, label = "pi-subagents") {
	if (isPiSubagentsNativeSource(readSource)) {
		assertPiSubagentsNativeSources(readSource, label);
		return;
	}
	assertPiSubagentAgentDiagnosticsSources(readSource, label);
	assertPiSubagentPromptMetadataSources(readSource, label);
	assertPiSubagentUsageLimitFallbackSource(readSource, label);
	assertPiSubagentCorrectnessSources(readSource, label);
}

function restoreEnv(name, value) {
	if (value === undefined) delete process.env[name];
	else process.env[name] = value;
}

function installMockPiCli(root, source) {
	const mockPath = join(root, "mock-pi.mjs");
	writeFileSync(mockPath, source);
	const previousBinary = process.env.PI_SUBAGENT_PI_BINARY;
	const previousCli = process.env.FEYNMAN_PI_CLI_PATH;
	delete process.env.PI_SUBAGENT_PI_BINARY;
	process.env.FEYNMAN_PI_CLI_PATH = mockPath;
	return () => {
		restoreEnv("PI_SUBAGENT_PI_BINARY", previousBinary);
		restoreEnv("FEYNMAN_PI_CLI_PATH", previousCli);
	};
}

async function verifyContextOverflowBehavior(runtimeRoot, jiti) {
	const root = mkdtempSync(join(tmpdir(), "feynman-subagent-overflow-"));
	const queue = join(root, "queue");
	mkdirSync(queue);
	const restoreMockPiCli = installMockPiCli(
		root,
		[
			'import fs from "node:fs";',
			'import path from "node:path";',
			"const queue = process.env.FEYNMAN_MOCK_PI_QUEUE;",
			'const file = fs.readdirSync(queue).filter((name) => name.startsWith("pending-")).sort()[0];',
			"if (!file) process.exit(2);",
			"const source = path.join(queue, file);",
			'const response = JSON.parse(fs.readFileSync(source, "utf8"));',
			'fs.renameSync(source, path.join(queue, file.replace("pending-", "used-")));',
			'fs.writeFileSync(path.join(queue, `call-${Date.now()}-${process.pid}`), JSON.stringify(process.argv.slice(2)));',
			'const modelArg = process.argv[process.argv.indexOf("--model") + 1] ?? "";',
			'const modelBase = modelArg.replace(/:(?:off|minimal|low|medium|high|xhigh|max)$/i, "");',
			'const slash = modelBase.indexOf("/");',
			'const provider = slash > 0 ? modelBase.slice(0, slash) : undefined;',
			'const model = slash > 0 ? modelBase.slice(slash + 1) : modelBase;',
			'for (const entry of response.jsonl ?? []) process.stdout.write(`${JSON.stringify(entry)}\\n`);',
			"if (response.output) process.stdout.write(`${JSON.stringify({ type: \"message_end\", message: { role: \"assistant\", content: [{ type: \"text\", text: response.output }], provider, model, stopReason: \"stop\", usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, cost: { total: 0 } } } })}\\n`);",
			"if (response.stderr) process.stderr.write(response.stderr);",
			"process.exit(response.exitCode ?? 0);",
			"",
		].join("\n"),
	);
	const error =
		"model error: context_length_exceeded: maximum context length is 8192 tokens";
	const errorMessage = {
		type: "message_end",
		message: {
			role: "assistant",
			content: [],
			provider: "openai",
			model: "gpt-5-mini",
			stopReason: "error",
			errorMessage: error,
			usage: {
				input: 1,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				cost: { total: 0 },
			},
		},
	};
	writeFileSync(
		join(queue, "pending-000001.json"),
		JSON.stringify({ jsonl: [errorMessage], exitCode: 1 }),
	);
	writeFileSync(
		join(queue, "pending-000002.json"),
		JSON.stringify({ output: "MUST_NOT_RUN_FALLBACK" }),
	);
	const previousQueue = process.env.FEYNMAN_MOCK_PI_QUEUE;
	process.env.FEYNMAN_MOCK_PI_QUEUE = queue;
	try {
		const execution = await jiti.import(
			resolve(
				runtimeRoot,
				"node_modules",
				"pi-subagents",
				"src",
				"runs",
				"foreground",
				"execution.ts",
			),
		);
		const result = await execution.runSync(
			root,
			[{
				name: "worker",
				description: "worker",
				systemPrompt: "",
				systemPromptMode: "replace",
				inheritProjectContext: false,
				inheritSkills: false,
				model: "openai/gpt-5-mini",
				fallbackModels: ["anthropic/claude-sonnet-4"],
			}],
			"worker",
			"Summarize a huge file",
			{ runId: "context-overflow-stops-fallback", acceptance: false },
		);
		assert.equal(result.exitCode, 1);
		assert.equal(result.contextOverflow, true);
		assert.deepEqual(result.attemptedModels, ["openai/gpt-5-mini"]);
		assert.equal(result.modelAttempts?.length, 1);
		assert.equal(
			readdirSync(queue).filter((entry) => entry.startsWith("call-")).length,
			1,
		);
		assert.notEqual(result.finalOutput, "MUST_NOT_RUN_FALLBACK");
		assert.match(result.error ?? "", /context/i);

		rmSync(join(queue, "pending-000002.json"));
		writeFileSync(
			join(queue, "pending-000003.json"),
			JSON.stringify({
				jsonl: [{
					...errorMessage,
					message: {
						...errorMessage.message,
						errorMessage:
							"429 rate limit exceeded: maximum 100000 tokens per minute",
					},
				}],
				exitCode: 1,
			}),
		);
		writeFileSync(
			join(queue, "pending-000004.json"),
			JSON.stringify({ output: "FALLBACK_RECOVERED" }),
		);
		const recovered = await execution.runSync(
			root,
			[{
				name: "worker",
				description: "worker",
				systemPrompt: "",
				systemPromptMode: "replace",
				inheritProjectContext: false,
				inheritSkills: false,
				model: "openai/gpt-5-mini",
				fallbackModels: ["anthropic/claude-sonnet-4"],
			}],
			"worker",
			"Retry a rate-limited request",
			{ runId: "token-rate-limit-still-falls-back", acceptance: false },
		);
		assert.equal(recovered.exitCode, 0);
		assert.equal(recovered.contextOverflow, undefined);
		assert.equal(recovered.finalOutput, "FALLBACK_RECOVERED");
		assert.deepEqual(recovered.attemptedModels, [
			"openai/gpt-5-mini",
			"anthropic/claude-sonnet-4",
		]);
		assert.equal(recovered.modelAttempts?.length, 2);
		assert.equal(
			readdirSync(queue).filter((entry) => entry.startsWith("call-")).length,
			3,
		);
	} finally {
		restoreEnv("FEYNMAN_MOCK_PI_QUEUE", previousQueue);
		restoreMockPiCli();
		rmSync(root, { recursive: true, force: true });
	}
}

function assistantEvent(type, provider, model, text, extraMessage = {}) {
	return {
		type,
		message: {
			role: "assistant",
			content: [{ type: "text", text }],
			...(provider === undefined ? {} : { provider }),
			...(model === undefined ? {} : { model }),
			...extraMessage,
			...(type === "message_end"
				? {
					stopReason: "stop",
					usage: {
						input: 1,
						output: 1,
						cacheRead: 0,
						cacheWrite: 0,
						cost: { total: 0 },
					},
				}
				: {}),
		},
	};
}

function countMockPiCalls(callsPath) {
	if (!existsSync(callsPath)) return 0;
	return readFileSync(callsPath, "utf8").split("\n").filter(Boolean).length;
}

function installModelIdentityMockPi(root) {
	return installMockPiCli(
		root,
		[
			'import fs from "node:fs";',
			'const scenario = JSON.parse(fs.readFileSync(process.env.FEYNMAN_MOCK_PI_SCENARIO_PATH, "utf8"));',
			'fs.appendFileSync(process.env.FEYNMAN_MOCK_PI_CALLS_PATH, `${JSON.stringify(process.argv.slice(2))}\\n`);',
			'for (const event of scenario.events ?? []) process.stdout.write(`${JSON.stringify(event)}\\n`);',
			"if (scenario.delayedMarkerPath) {",
			"\tawait new Promise((resolve) => setTimeout(resolve, scenario.delayedMarkerMs ?? 500));",
			'\tfs.writeFileSync(scenario.delayedMarkerPath, "child continued after model mismatch");',
			"}",
			"",
		].join("\n"),
	);
}

function assertRequestedModelFailure(result, expectedModel) {
	assert.equal(result.exitCode, 1);
	assert.equal(result.model, expectedModel);
	assert.deepEqual(result.attemptedModels, [expectedModel]);
	assert.equal(result.modelAttempts?.length, 1);
	assert.equal(result.modelAttempts?.[0]?.model, expectedModel);
	assert.equal(result.modelAttempts?.[0]?.success, false);
	assert.match(result.error ?? "", /model_verification_failed/);
	assert.match(result.modelAttempts?.[0]?.error ?? "", /model_verification_failed/);
}

function verifyModelIdentityComparisonBehavior(fallback) {
	const verify = fallback.formatSubagentModelVerificationError;
	const availableModels = [
		{ provider: "opencode-go", id: "ox-alpha-free", fullId: "opencode-go/ox-alpha-free" },
		{ provider: "openai-codex", id: "gpt-5.6-sol", fullId: "openai-codex/gpt-5.6-sol" },
	];
	assert.equal(typeof verify, "function");
	assert.equal(verify("opencode-go/ox-alpha-free", "opencode-go", "ox-alpha-free"), undefined);
	assert.match(
		verify("OpenCode-Go/OX-Alpha-Free", "opencode-go", "ox-alpha-free") ?? "",
		/model_verification_failed/,
		"Uncanonicalized expected identities must not be compared case-insensitively",
	);
	assert.match(
		verify("OpenCode-Go/OX-Alpha-Free", "opencode-go", "ox-alpha-free", availableModels) ?? "",
		/model_verification_failed/,
		"The active registry must not case-fold an uncanonicalized expected selector",
	);
	for (const suffix of ["off", "minimal", "low", "medium", "high", "xhigh", "max"]) {
		assert.equal(
			verify(`opencode-go/ox-alpha-free:${suffix}`, "opencode-go", "ox-alpha-free", availableModels),
			undefined,
			`Recognized Pi thinking suffix '${suffix}' was not stripped`,
		);
	}
	assert.match(
		verify("opencode-go/ox-alpha-free:MAX", "opencode-go", "ox-alpha-free", availableModels) ?? "",
		/model_verification_failed/,
		"Thinking-level recognition must preserve Pi's case-sensitive semantics",
	);
	assert.match(
		verify("opencode-go/ox-alpha-free:preview", "opencode-go", "ox-alpha-free") ?? "",
		/model_verification_failed/,
		"An unknown colon suffix must remain part of the exact model id",
	);
	assert.match(verify("opencode-go/ox-alpha-free", "other", "ox-alpha-free") ?? "", /model_verification_failed/);
	assert.match(verify("opencode-go/ox-alpha-free", "opencode-go", "other") ?? "", /model_verification_failed/);
	assert.match(verify("opencode-go/ox-alpha-free", " opencode-go", "ox-alpha-free") ?? "", /model_verification_failed/);
	assert.match(verify("opencode-go/ox-alpha-free", "opencode-go", "ox-alpha-free ") ?? "", /model_verification_failed/);
	assert.match(verify("opencode-go/shared-id", "other", "shared-id") ?? "", /model_verification_failed/);
	assert.match(verify("opencode-go/ox-alpha-free", undefined, "ox-alpha-free") ?? "", /<missing-provider>/);
	assert.match(verify("opencode-go/ox-alpha-free", "opencode-go", undefined) ?? "", /<missing-model>/);
	assert.match(verify("opencode-go/ox-alpha-free", "open_code_go", "ox-alpha-free") ?? "", /model_verification_failed/);
	assert.match(verify("opencode-go/ox-alpha-free-2026-08-22", "opencode-go", "ox-alpha-free") ?? "", /model_verification_failed/);
	assert.equal(
		verify(
			"opencode-go/ox-alpha-free:max",
			"opencode-go",
			"ox-alpha-free:max",
			[{ provider: "opencode-go", id: "ox-alpha-free:max", fullId: "opencode-go/ox-alpha-free:max" }],
		),
		undefined,
		"A registered model id ending in a thinking-token word must remain an exact model id",
	);
	assert.equal(verify("bare-model", undefined, undefined), undefined);
}

async function verifyForegroundModelIdentityBehavior(runtimeRoot, jiti) {
	const root = mkdtempSync(join(tmpdir(), "feynman-subagent-model-foreground-"));
	const scenarioPath = join(root, "scenario.json");
	const callsPath = join(root, "calls.jsonl");
	const delayedMarkerPath = join(root, "continued-after-mismatch");
	const previousScenarioPath = process.env.FEYNMAN_MOCK_PI_SCENARIO_PATH;
	const previousCallsPath = process.env.FEYNMAN_MOCK_PI_CALLS_PATH;
	process.env.FEYNMAN_MOCK_PI_SCENARIO_PATH = scenarioPath;
	process.env.FEYNMAN_MOCK_PI_CALLS_PATH = callsPath;
	const restoreMockPiCli = installModelIdentityMockPi(root);
	try {
		const execution = await jiti.import(
			resolve(runtimeRoot, "node_modules", "pi-subagents", "src", "runs", "foreground", "execution.ts"),
		);
		const availableModels = [
			{ provider: "opencode-go", id: "ox-alpha-free", fullId: "opencode-go/ox-alpha-free" },
			{ provider: "openai-codex", id: "gpt-5.6-sol", fullId: "openai-codex/gpt-5.6-sol" },
			{ provider: "anthropic", id: "claude-sonnet-4", fullId: "anthropic/claude-sonnet-4" },
		];
		const run = (runId, model, fallbackModels, runOptions = {}) =>
			execution.runSync(
				root,
				[{
					name: "worker",
					description: "worker",
					systemPrompt: "",
					systemPromptMode: "replace",
					inheritProjectContext: false,
					inheritSkills: false,
					model,
					...(fallbackModels ? { fallbackModels } : {}),
				}],
				"worker",
				"Use the configured model",
				{ runId, acceptance: false, availableModels, ...runOptions },
			);

		const caseModel = "OpenCode-Go/OX-Alpha-Free";
		writeFileSync(
			scenarioPath,
			JSON.stringify({
				events: [
					assistantEvent("message_start", "opencode-go", "ox-alpha-free", ""),
					assistantEvent(
						"message_end",
						"opencode-go",
						"ox-alpha-free",
						"MATCHED",
						{ responseModel: "openai-codex/gpt-5.6-sol" },
					),
				],
			}),
		);
		const matched = await run("configured-model-match", caseModel);
		assert.equal(matched.exitCode, 0);
		assert.equal(matched.error, undefined);
		assert.equal(matched.model, "opencode-go/ox-alpha-free");
		assert.deepEqual(matched.attemptedModels, ["opencode-go/ox-alpha-free"]);

		const expectedModel = "opencode-go/ox-alpha-free:max";
		writeFileSync(
			scenarioPath,
			JSON.stringify({
				events: [assistantEvent("message_start", "openai-codex", "gpt-5.6-sol", "")],
				delayedMarkerPath,
				delayedMarkerMs: 750,
			}),
		);
		const callsBeforeMismatch = countMockPiCalls(callsPath);
		const mismatch = await run(
			"configured-model-start-mismatch",
			expectedModel,
			["anthropic/claude-sonnet-4"],
		);
		assertRequestedModelFailure(mismatch, expectedModel);
		assert.match(mismatch.error ?? "", /reported 'openai-codex\/gpt-5\.6-sol'/);
		assert.equal(countMockPiCalls(callsPath), callsBeforeMismatch + 1, "Foreground mismatch launched a fallback");
		assert.equal(existsSync(delayedMarkerPath), false, "Foreground child continued after message_start mismatch");

		writeFileSync(scenarioPath, JSON.stringify({
			events: [assistantEvent("message_start", " opencode-go", "ox-alpha-free", "")],
		}));
		const whitespaceMismatch = await run("configured-model-whitespace-mismatch", "opencode-go/ox-alpha-free");
		assertRequestedModelFailure(whitespaceMismatch, "opencode-go/ox-alpha-free");
		assert.match(whitespaceMismatch.error ?? "", /reported ' opencode-go\/ox-alpha-free'/);

		writeFileSync(
			scenarioPath,
			JSON.stringify({
				events: [assistantEvent("message_end", "opencode-go", "different-model", "END_ONLY_MISMATCH")],
			}),
		);
		const endOnlyMismatch = await run("configured-model-end-only-mismatch", expectedModel);
		assertRequestedModelFailure(endOnlyMismatch, expectedModel);
		assert.match(endOnlyMismatch.error ?? "", /reported 'opencode-go\/different-model'/);

		writeFileSync(
			scenarioPath,
			JSON.stringify({
				events: [
					assistantEvent("message_start", "openai-codex", "gpt-5.6-sol", ""),
					assistantEvent("message_end", "openai-codex", "gpt-5.6-sol", "INHERITED_PARENT_OK"),
				],
			}),
		);
		const inheritedParent = await run(
			"inherited-parent-model-is-not-asserted",
			expectedModel,
			undefined,
			{ modelOverrideFromParent: true },
		);
		assert.equal(inheritedParent.exitCode, 0);
		assert.equal(inheritedParent.error, undefined);
		assert.equal(inheritedParent.finalOutput, "INHERITED_PARENT_OK");
	} finally {
		restoreEnv("FEYNMAN_MOCK_PI_SCENARIO_PATH", previousScenarioPath);
		restoreEnv("FEYNMAN_MOCK_PI_CALLS_PATH", previousCallsPath);
		restoreMockPiCli();
		rmSync(root, { recursive: true, force: true });
	}
}

function waitForProcess(child, timeoutMs = 20_000) {
	return new Promise((resolveProcess, rejectProcess) => {
		let stdout = "";
		let stderr = "";
		const timeout = setTimeout(() => {
			child.kill("SIGKILL");
			rejectProcess(new Error(`Background model verification runner timed out after ${timeoutMs}ms`));
		}, timeoutMs);
		child.stdout.on("data", (chunk) => {
			stdout += chunk;
		});
		child.stderr.on("data", (chunk) => {
			stderr += chunk;
		});
		child.on("error", (error) => {
			clearTimeout(timeout);
			rejectProcess(error);
		});
		child.on("close", (code, signal) => {
			clearTimeout(timeout);
			resolveProcess({ code, signal, stdout, stderr });
		});
	});
}

async function verifyBackgroundModelIdentityBehavior(runtimeRoot, runtimeRequire) {
	const root = mkdtempSync(join(tmpdir(), "feynman-subagent-model-background-"));
	const scenarioPath = join(root, "scenario.json");
	const callsPath = join(root, "calls.jsonl");
	const delayedMarkerPath = join(root, "continued-after-mismatch");
	const runnerPath = resolve(
		runtimeRoot,
		"node_modules",
		"pi-subagents",
		"src",
		"runs",
		"background",
		"subagent-runner.ts",
	);
	const jitiCliPath = resolve(runtimeRequire.resolve("jiti/package.json"), "..", "lib", "jiti-cli.mjs");
	const previousScenarioPath = process.env.FEYNMAN_MOCK_PI_SCENARIO_PATH;
	const previousCallsPath = process.env.FEYNMAN_MOCK_PI_CALLS_PATH;
	process.env.FEYNMAN_MOCK_PI_SCENARIO_PATH = scenarioPath;
	process.env.FEYNMAN_MOCK_PI_CALLS_PATH = callsPath;
	const restoreMockPiCli = installModelIdentityMockPi(root);
	const modelVerificationRegistry = [
		{ provider: "opencode-go", id: "ox-alpha-free", fullId: "opencode-go/ox-alpha-free" },
		{ provider: "openai-codex", id: "gpt-5.6-sol", fullId: "openai-codex/gpt-5.6-sol" },
		{ provider: "anthropic", id: "claude-sonnet-4", fullId: "anthropic/claude-sonnet-4" },
	];
	const run = async (runId, expectedModel, fallbackModels, skipPrimaryModelVerification = false) => {
		const asyncDir = join(root, runId);
		mkdirSync(asyncDir, { recursive: true });
		const resultPath = join(asyncDir, "result.json");
		const configPath = join(asyncDir, "config.json");
		writeFileSync(
			configPath,
			JSON.stringify({
				id: runId,
				steps: [{
					agent: "worker",
					task: "Use the configured model",
					model: expectedModel,
					modelCandidates: [expectedModel, ...fallbackModels],
					...(skipPrimaryModelVerification ? { skipPrimaryModelVerification: true } : {}),
					modelVerificationRegistry,
					systemPrompt: "",
					systemPromptMode: "replace",
					inheritProjectContext: false,
					inheritSkills: false,
					skills: [],
				}],
				resultPath,
				cwd: root,
				placeholder: "{previous}",
				artifactConfig: { enabled: false },
				asyncDir,
				resultMode: "single",
			}),
		);
		const child = spawn(process.execPath, [jitiCliPath, runnerPath, configPath], {
			cwd: root,
			env: process.env,
			stdio: ["ignore", "pipe", "pipe"],
		});
		const processResult = await waitForProcess(child);
		assert.equal(
			processResult.code,
			0,
			`Background runner failed (${processResult.signal ?? "no signal"}): ${processResult.stderr || processResult.stdout}`,
		);
		assert.equal(existsSync(resultPath), true, "Background runner wrote no result");
		return JSON.parse(readFileSync(resultPath, "utf8"));
	};
	try {
		const matchedModel = "opencode-go/ox-alpha-free";
		writeFileSync(
			scenarioPath,
			JSON.stringify({
				events: [
					assistantEvent("message_start", "opencode-go", "ox-alpha-free", ""),
					assistantEvent(
						"message_end",
						"opencode-go",
						"ox-alpha-free",
						"MATCHED",
						{ responseModel: "wrong-provider/wrong-response-model" },
					),
				],
			}),
		);
		const matched = await run("background-model-match", matchedModel, []);
		assert.equal(matched.success, true);
		assert.equal(matched.results[0].model, matchedModel);
		assert.deepEqual(matched.results[0].attemptedModels, [matchedModel]);

		const expectedModel = "opencode-go/ox-alpha-free:max";
		writeFileSync(
			scenarioPath,
			JSON.stringify({
				events: [assistantEvent("message_start", undefined, "ox-alpha-free", "")],
				delayedMarkerPath,
				delayedMarkerMs: 750,
			}),
		);
		const callsBeforeMismatch = countMockPiCalls(callsPath);
		const mismatch = await run(
			"background-model-start-mismatch",
			expectedModel,
			["anthropic/claude-sonnet-4"],
		);
		const result = mismatch.results[0];
		assert.equal(mismatch.success, false);
		assert.equal(result.model, expectedModel);
		assert.deepEqual(result.attemptedModels, [expectedModel]);
		assert.equal(result.modelAttempts.length, 1);
		assert.equal(result.modelAttempts[0].model, expectedModel);
		assert.equal(result.modelAttempts[0].success, false);
		assert.match(result.error ?? "", /model_verification_failed/);
		assert.match(result.error ?? "", /<missing-provider>\/ox-alpha-free/);
		assert.equal(countMockPiCalls(callsPath), callsBeforeMismatch + 1, "Background mismatch launched a fallback");
		assert.equal(existsSync(delayedMarkerPath), false, "Background child continued after message_start mismatch");

		writeFileSync(
			scenarioPath,
			JSON.stringify({
				events: [assistantEvent("message_start", "opencode-go", "ox-alpha-free ", "")],
			}),
		);
		const whitespaceMismatch = await run(
			"background-model-whitespace-mismatch",
			"opencode-go/ox-alpha-free",
			[],
		);
		assert.equal(whitespaceMismatch.success, false);
		assert.match(
			whitespaceMismatch.results[0].error ?? "",
			/model_verification_failed/,
		);
		assert.match(
			whitespaceMismatch.results[0].error ?? "",
			/reported 'opencode-go\/ox-alpha-free '/,
		);

		writeFileSync(
			scenarioPath,
			JSON.stringify({
				events: [
					assistantEvent("message_start", "openai-codex", "gpt-5.6-sol", ""),
					assistantEvent("message_end", "openai-codex", "gpt-5.6-sol", "INHERITED_PARENT_OK"),
				],
			}),
		);
		const inheritedParent = await run(
			"background-inherited-parent-model-is-not-asserted",
			expectedModel,
			[],
			true,
		);
		assert.equal(inheritedParent.success, true);
		assert.equal(inheritedParent.results[0].error, undefined);
		assert.equal(inheritedParent.results[0].output, "INHERITED_PARENT_OK");
	} finally {
		restoreEnv("FEYNMAN_MOCK_PI_SCENARIO_PATH", previousScenarioPath);
		restoreEnv("FEYNMAN_MOCK_PI_CALLS_PATH", previousCallsPath);
		restoreMockPiCli();
		rmSync(root, { recursive: true, force: true });
	}
}

async function verifyBackfilledToolResultBehavior(runtimeRoot, jiti) {
	const root = mkdtempSync(join(tmpdir(), "feynman-subagent-tool-backfill-"));
	const restoreMockPiCli = installMockPiCli(
		root,
		[
			"const events = [",
			'\t{ type: "tool_execution_start", toolCallId: "bash-1", toolName: "bash", args: { command: "echo PROBE_OK" } },',
			'\t{ type: "tool_result_end", message: { role: "toolResult", toolCallId: "bash-1", toolName: "bash", isError: false, content: [{ type: "text", text: "PROBE_OK" }] } },',
			'\t{ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "PROBE_OK" }], provider: "openai", model: "gpt-5-mini", stopReason: "stop", usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, cost: { total: 0 } } } },',
			"];",
			'for (const event of events) process.stdout.write(`${JSON.stringify(event)}\\n`);',
			"",
		].join("\n"),
	);
	try {
		const execution = await jiti.import(
			resolve(
				runtimeRoot,
				"node_modules",
				"pi-subagents",
				"src",
				"runs",
				"foreground",
				"execution.ts",
			),
		);
		const result = await execution.runSync(
			root,
			[{
				name: "worker",
				description: "worker",
				systemPrompt: "",
				systemPromptMode: "replace",
				inheritProjectContext: false,
				inheritSkills: false,
				model: "openai/gpt-5-mini",
			}],
			"worker",
			"Run exactly one tool",
			{
				runId: "tool-result-backfill-clears-active-tool",
				acceptance: false,
				timeoutMs: 2_000,
			},
		);
		assert.equal(result.exitCode, 0);
		assert.equal(result.finalOutput, "PROBE_OK");
		assert.equal(result.progress?.currentTool, undefined);
		assert.equal(result.progress?.currentToolArgs, undefined);
		assert.equal(result.progress?.currentToolStartedAt, undefined);
		assert.equal(result.progress?.currentPath, undefined);
		assert.equal(result.progress?.recentTools?.length, 1);
		assert.equal(result.progress?.recentTools?.[0]?.tool, "bash");
		assert.equal(result.progress?.recentTools?.[0]?.args, "echo PROBE_OK");
	} finally {
		restoreMockPiCli();
		rmSync(root, { recursive: true, force: true });
	}
}

async function verifyLogicalToolFailureBehavior(runtimeRoot, jiti) {
	let registeredTool;
	const toolDescriptions = await jiti.import(
		resolve(runtimeRoot, "node_modules", "pi-subagents", "src", "extension", "tool-description.ts"),
	);
	for (const toolDescriptionMode of ["full", "compact"]) {
		assert.match(
			toolDescriptions.buildSubagentToolDescription({ toolDescriptionMode }),
			/feynman model list.*exact approved provider\/model.*Never pass a bare model id or an agent name/s,
			`Installed pi-subagents ${toolDescriptionMode} description omitted approved model selector guidance`,
		);
	}
	const events = { on: () => () => {}, emit: () => {} };
	const pi = new Proxy({
		events,
		registerTool(tool) {
			if (tool.name === "subagent") registeredTool = tool;
		},
		registerCommand() {},
		on: () => () => {},
	}, {
		get(target, property) {
			return property in target ? target[property] : () => undefined;
		},
	});
	const extension = await jiti.import(
		resolve(runtimeRoot, "node_modules", "pi-subagents", "src", "extension", "index.ts"),
	);
	extension.default(pi);
	assert.ok(registeredTool, "Installed pi-subagents did not register subagent");
	assert.ok(
		Array.isArray(registeredTool.promptGuidelines),
		"Installed pi-subagents did not register prompt guidelines",
	);
	assert.ok(
		registeredTool.promptGuidelines.some((line) =>
			line.includes("feynman model list") &&
			line.includes("exact approved provider/model") &&
			line.includes("Never pass a bare model id or an agent name")
		),
		"Installed pi-subagents did not register approved model selector guidance",
	);
	const sessionManager = new Proxy({
		getSessionFile: () => null,
		getSessionId: () => "feynman-logical-error",
		getEntries: () => [],
	}, {
		get(target, property) {
			return property in target ? target[property] : () => undefined;
		},
	});
	const toolContext = {
		cwd: process.cwd(),
		hasUI: false,
		sessionManager,
		modelRegistry: { getAvailable: () => [] },
	};
	await assert.rejects(
		registeredTool.execute(
			"logical-error",
			{ action: "not-a-real-action" },
			new AbortController().signal,
			undefined,
			toolContext,
		),
		/Unknown action: not-a-real-action/,
	);
	const success = await registeredTool.execute(
		"logical-success",
		{ action: "list" },
		new AbortController().signal,
		undefined,
		toolContext,
	);
	assert.notEqual(success.isError, true, "Successful subagent actions must still resolve");

	const parallelRoot = mkdtempSync(join(tmpdir(), "feynman-subagent-parallel-error-"));
	const restoreParallelMockPiCli = installMockPiCli(
		parallelRoot,
		[
			'process.stderr.write("provider error: forced child failure");',
			"process.exit(1);",
			"",
		].join("\n"),
	);
	try {
		const parallelToolContext = { ...toolContext, cwd: parallelRoot };
		await assert.rejects(
			registeredTool.execute(
				"logical-parallel-error",
				{
					tasks: [
						{ agent: "researcher", task: "fail one" },
						{ agent: "researcher", task: "fail two" },
					],
					concurrency: 1,
				},
				new AbortController().signal,
				undefined,
				parallelToolContext,
			),
			/0\/2 succeeded/,
		);
	} finally {
		restoreParallelMockPiCli();
		rmSync(parallelRoot, { recursive: true, force: true });
	}

	let registeredWaitTool;
	const waitPi = {
		events,
		registerTool(tool) {
			if (tool.name === "subagent_wait") registeredWaitTool = tool;
		},
	};
	const waitToolModule = await jiti.import(
		resolve(
			runtimeRoot,
			"node_modules",
			"pi-subagents",
			"src",
			"runs",
			"background",
			"wait-tool.ts",
		),
	);
	waitToolModule.registerWaitTool(
		waitPi,
		{ currentSessionId: null },
		true,
	);
	assert.ok(registeredWaitTool, "Installed pi-subagents did not register subagent_wait");
	await assert.rejects(
		registeredWaitTool.execute(
			"logical-wait-error",
			{},
			new AbortController().signal,
			undefined,
		),
		/requires an active session identity/,
	);

	const previousChild = process.env.PI_SUBAGENT_CHILD;
	const previousFanout = process.env.PI_SUBAGENT_FANOUT_CHILD;
	process.env.PI_SUBAGENT_CHILD = "1";
	process.env.PI_SUBAGENT_FANOUT_CHILD = "1";
	try {
		let registeredFanoutTool;
		const fanoutPi = {
			events,
			registerTool(tool) {
				if (tool.name === "subagent") registeredFanoutTool = tool;
			},
			getSessionName: () => undefined,
		};
		const fanoutModule = await jiti.import(
			resolve(
				runtimeRoot,
				"node_modules",
				"pi-subagents",
				"src",
				"extension",
				"fanout-child.ts",
			),
		);
		fanoutModule.default(fanoutPi);
		assert.ok(registeredFanoutTool, "Installed pi-subagents did not register the fanout-child subagent");
		const fanoutContext = {
			cwd: process.cwd(),
			hasUI: false,
			sessionManager: {
				getSessionId: () => "feynman-logical-fanout",
				getSessionFile: () => null,
			},
			modelRegistry: { getAvailable: () => [] },
		};
		const fanoutList = await registeredFanoutTool.execute(
			"logical-fanout-success",
			{ action: "list" },
			new AbortController().signal,
			undefined,
			fanoutContext,
		);
		assert.notEqual(fanoutList.isError, true, "Successful fanout-child actions must still resolve");
		await assert.rejects(
			registeredFanoutTool.execute(
				"logical-fanout-error",
				{ action: "create", config: { name: "blocked" } },
				new AbortController().signal,
				undefined,
				fanoutContext,
			),
			/not available from child-safe subagent fanout mode/,
		);
	} finally {
		restoreEnv("PI_SUBAGENT_CHILD", previousChild);
		restoreEnv("PI_SUBAGENT_FANOUT_CHILD", previousFanout);
	}

	const codingAgentPath = resolve(
		runtimeRoot,
		"node_modules",
		"@earendil-works",
		"pi-coding-agent",
		"dist",
		"index.js",
	);
	const piCompatPath = resolve(
		runtimeRoot,
		"node_modules",
		"@earendil-works",
		"pi-ai",
		"dist",
		"compat.js",
	);
	const codingAgent = await import(
		existsSync(codingAgentPath)
			? pathToFileURL(codingAgentPath).href
			: "@earendil-works/pi-coding-agent"
	);
	const piCompat = await import(
		existsSync(piCompatPath)
			? pathToFileURL(piCompatPath).href
			: "@earendil-works/pi-ai/compat"
	);
	const root = mkdtempSync(join(tmpdir(), "feynman-subagent-tool-error-"));
	const faux = piCompat.registerFauxProvider();
	let session;
	try {
		const settingsManager = codingAgent.SettingsManager.inMemory({
			compaction: { enabled: false },
			retry: { enabled: false },
			packages: [],
		});
		const extensionPath = resolve(
			runtimeRoot,
			"node_modules",
			"pi-subagents",
			"src",
			"extension",
			"index.ts",
		);
		const loader = new codingAgent.DefaultResourceLoader({
			cwd: root,
			agentDir: root,
			settingsManager,
			additionalExtensionPaths: [extensionPath],
			noSkills: true,
			noPromptTemplates: true,
			noThemes: true,
			noContextFiles: true,
		});
		await loader.reload();
		assert.deepEqual(
			loader.getExtensions().errors,
			[],
			"Installed pi-subagents failed to load for the logical-error probe",
		);
		const modelRuntime = {
			hasConfiguredAuth: () => true,
			checkAuth: async () => ({ auth: { apiKey: "faux-key" } }),
			getAuth: async () => ({ auth: { apiKey: "faux-key" } }),
			isUsingOAuth: () => false,
			streamSimple: piCompat.streamSimple,
		};
		faux.setResponses([
			piCompat.fauxAssistantMessage(
				piCompat.fauxToolCall(
					"subagent",
					{ action: "not-a-real-action" },
					{ id: "logical-subagent-error" },
				),
				{ stopReason: "toolUse" },
			),
			piCompat.fauxAssistantMessage("done"),
		]);
		const created = await codingAgent.createAgentSession({
			cwd: root,
			agentDir: root,
			modelRuntime,
			model: faux.getModel(),
			resourceLoader: loader,
			sessionManager: codingAgent.SessionManager.inMemory(root),
			settingsManager,
			noTools: "builtin",
		});
		session = created.session;
		await session.prompt("Exercise the installed subagent error boundary.", {
			expandPromptTemplates: false,
		});
		const toolResult = session.messages.find(
			(message) =>
				message.role === "toolResult" &&
				message.toolCallId === "logical-subagent-error",
		);
		assert.ok(toolResult, "Pi emitted no tool result for the logical subagent failure");
		assert.equal(
			toolResult.isError,
			true,
			"Pi presented a logical subagent failure as a successful tool result",
		);
		assert.match(
			toolResult.content
				.filter((item) => item.type === "text")
				.map((item) => item.text)
				.join("\n"),
			/Unknown action: not-a-real-action/,
		);
	} finally {
		session?.dispose();
		faux.unregister();
		rmSync(root, { recursive: true, force: true });
	}
}

export async function verifyPiSubagentUsageLimitFallbackBehavior(packageRoot) {
	const runtimeRoot = resolve(packageRoot, ".feynman", "npm");
	const runtimeRequire = createRequire(resolve(runtimeRoot, "package.json"));
	const jitiEntryPath = runtimeRequire.resolve("jiti");
	const jitiModule = await import(pathToFileURL(jitiEntryPath).href);
	assert.equal(typeof jitiModule.createJiti, "function", "Installed Pi Jiti has no createJiti");
	const jiti = jitiModule.createJiti(import.meta.url, { moduleCache: false });
	const subagentsRoot = resolve(runtimeRoot, "node_modules", "pi-subagents");
	if (isPiSubagentsNativeSource((relativePath) => readFileSync(resolve(subagentsRoot, relativePath), "utf8"))) {
		await verifyPiSubagentsNativeBehavior(subagentsRoot, jiti);
		return;
	}
	const fallback = await jiti.import(
		resolve(runtimeRoot, "node_modules", "pi-subagents", "src", "runs", "shared", "model-fallback.ts"),
	);
	assert.equal(typeof fallback.isRetryableModelFailure, "function");
	assert.equal(fallback.isRetryableModelFailure("The usage limit has been reached"), true);
	assert.equal(fallback.isRetryableModelFailure("research-tools failed with exit code 1"), false);
	assert.equal(
		fallback.isContextOverflow(
			"model error: context_length_exceeded: maximum context length is 8192 tokens",
		),
		true,
	);
	assert.equal(
		fallback.isContextOverflow(
			"research-tools failed with exit code 1 maximum context length",
		),
		false,
	);
	for (const message of [
		"429 rate limit exceeded: maximum 100000 tokens per minute",
		"output max_tokens must be less than or equal to 8192",
		"HTTP 411 length_required",
	]) {
		assert.equal(
			fallback.isContextOverflow(message),
			false,
			`Misclassified non-context failure: ${message}`,
		);
	}
	verifyModelIdentityComparisonBehavior(fallback);
	await verifyContextOverflowBehavior(runtimeRoot, jiti);
	await verifyForegroundModelIdentityBehavior(runtimeRoot, jiti);
	await verifyBackgroundModelIdentityBehavior(runtimeRoot, runtimeRequire);
	await verifyBackfilledToolResultBehavior(runtimeRoot, jiti);
	await verifyLogicalToolFailureBehavior(runtimeRoot, jiti);
}
