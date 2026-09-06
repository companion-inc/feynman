import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { Type } from "typebox";

import {
	assertPiCodingAgentForwardFixSource,
	assertPiRuntimeCorrectnessPatchSource,
	assertPiRuntimeCorrectnessVersion,
	PI_RUNTIME_CORRECTNESS_FORBIDDEN_FRAGMENTS,
	PI_RUNTIME_CORRECTNESS_REQUIRED_FRAGMENTS,
	PI_RUNTIME_CORRECTNESS_REQUIRED_VERSION,
	patchPiAgentSessionSource,
	patchPiGithubCopilotDeviceCodeSource,
	patchPiGithubCopilotOAuthSource,
	patchPiSessionManagerSource,
	patchPiTransformMessagesSource,
} from "../scripts/lib/pi-runtime-correctness-patch.mjs";
import { patchPiRuntimeNodeModules } from "../src/pi/runtime-patches.js";

const appRoot = process.cwd();

const agentSessionPath = resolve(
	appRoot,
	"node_modules",
	"@earendil-works",
	"pi-coding-agent",
	"dist",
	"core",
	"agent-session.js",
);
const sessionManagerPath = resolve(
	appRoot,
	"node_modules",
	"@earendil-works",
	"pi-coding-agent",
	"dist",
	"core",
	"session-manager.js",
);
const transformMessagesPath = resolve(
	appRoot,
	"node_modules",
	"@earendil-works",
	"pi-ai",
	"dist",
	"api",
	"transform-messages.js",
);
const nestedTransformMessagesPath = resolve(
	appRoot,
	"node_modules",
	"@earendil-works",
	"pi-coding-agent",
	"node_modules",
	"@earendil-works",
	"pi-ai",
	"dist",
	"api",
	"transform-messages.js",
);
const githubCopilotDeviceCodePath = resolve(
	appRoot,
	"node_modules",
	"@earendil-works",
	"pi-ai",
	"dist",
	"auth",
	"oauth",
	"device-code.js",
);
const githubCopilotOAuthPath = resolve(
	appRoot,
	"node_modules",
	"@earendil-works",
	"pi-ai",
	"dist",
	"auth",
	"oauth",
	"github-copilot.js",
);
const nestedGithubCopilotDeviceCodePath = resolve(
	appRoot,
	"node_modules",
	"@earendil-works",
	"pi-coding-agent",
	"node_modules",
	"@earendil-works",
	"pi-ai",
	"dist",
	"auth",
	"oauth",
	"device-code.js",
);
const nestedGithubCopilotOAuthPath = resolve(
	appRoot,
	"node_modules",
	"@earendil-works",
	"pi-coding-agent",
	"node_modules",
	"@earendil-works",
	"pi-ai",
	"dist",
	"auth",
	"oauth",
	"github-copilot.js",
);
const exifOrientationPath = resolve(
	appRoot,
	"node_modules",
	"@earendil-works",
	"pi-coding-agent",
	"dist",
	"utils",
	"exif-orientation.js",
);

function createResourceLoader(runtime: unknown) {
	return {
		getExtensions: () => ({
			extensions: [],
			errors: [],
			runtime,
		}),
		getSkills: () => ({ skills: [], diagnostics: [] }),
		getPrompts: () => ({ prompts: [], diagnostics: [] }),
		getThemes: () => ({ themes: [], diagnostics: [] }),
		getAgentsFiles: () => ({ agentsFiles: [] }),
		getSystemPrompt: () => undefined,
		getAppendSystemPrompt: () => [],
		extendResources: () => {},
		reload: async () => {},
	};
}

test("Pi 0.84.2 correctness patch is applied, idempotent, and documents its removal condition", () => {
	const agentSessionSource = patchPiAgentSessionSource(readFileSync(agentSessionPath, "utf8"));
	const sessionManagerSource = readFileSync(sessionManagerPath, "utf8");
	const transformMessagesSource = readFileSync(transformMessagesPath, "utf8");
	const nestedTransformMessagesSource = readFileSync(nestedTransformMessagesPath, "utf8");
	const githubCopilotDeviceCodeSource = readFileSync(githubCopilotDeviceCodePath, "utf8");
	const githubCopilotOAuthSource = readFileSync(githubCopilotOAuthPath, "utf8");
	const nestedGithubCopilotDeviceCodeSource = readFileSync(
		nestedGithubCopilotDeviceCodePath,
		"utf8",
	);
	const nestedGithubCopilotOAuthSource = readFileSync(
		nestedGithubCopilotOAuthPath,
		"utf8",
	);
	const patchSource = readFileSync(
		resolve(appRoot, "scripts", "lib", "pi-runtime-correctness-patch.mjs"),
		"utf8",
	);

	assert.match(agentSessionSource, /issue #7053/);
	assert.match(agentSessionSource, /image-only queue delivery #8581/);
	assert.match(agentSessionSource, /interleaved user content #8615/);
	assert.match(agentSessionSource, /async _prompt\(text, options, orderedContent\)/);
	assert.match(agentSessionSource, /_createUserContent\(text, images, orderedContent\)/);
	assert.match(agentSessionSource, /Cannot submit a prompt while compaction is in progress/);
	assert.match(agentSessionSource, /_feynmanEagerlyPersistedToolResults/);
	assert.match(agentSessionSource, /feynmanToolResultIdBeforeExtensions/);
	assert.match(agentSessionSource, /replaceMessage\(eagerlyPersisted\.entryId, event\.message\)/);
	assert.match(sessionManagerSource, /restore eager tool results/);
	assert.match(sessionManagerSource, /upstream #8345/);
	assert.match(sessionManagerSource, /if \(pending\) appendFileSync\(resolvedFilePath, "\\n"\)/);
	assert.match(sessionManagerSource, /restoreFeynmanToolResultsInSourceOrder/);
	assert.match(sessionManagerSource, /replaceMessage\(entryId, message\)/);
	assert.match(transformMessagesSource, /order eager tool results/);
	assert.match(transformMessagesSource, /flushFeynmanToolResults/);
	assert.match(nestedTransformMessagesSource, /order eager tool results/);
	assert.match(nestedTransformMessagesSource, /flushFeynmanToolResults/);
	for (const source of [
		githubCopilotDeviceCodeSource,
		nestedGithubCopilotDeviceCodeSource,
	]) {
		assert.match(source, /export abortableSleep for upstream #8121/);
		assert.match(source, /export function abortableSleep/);
	}
	for (const source of [githubCopilotOAuthSource, nestedGithubCopilotOAuthSource]) {
		assertPiRuntimeCorrectnessPatchSource(source, "githubCopilotOAuth");
		assert.match(source, /response\.status === 429/);
		assert.match(source, /response\.headers\.get\("retry-after"\)/);
		assert.match(source, /for \(const modelId of modelIds\)/);
		assert.match(source, /await sleep\(delayMs, requestSignal\)/);
		assert.doesNotMatch(source, /COPILOT_POLICY_CONCURRENCY/);
	}
	assert.match(patchSource, /Removal condition: delete this patch once a supported released Pi version/);
	assert.match(patchSource, /upstream commits d5278ea and 086c32e/);
	assert.match(patchSource, /delivered image-only queue entries as in commit b67b3db/);
	assert.match(patchSource, /27115254/);
	assert.match(patchSource, /86c42324/);
	assert.match(patchSource, /0b5ee5d8/);
	assert.doesNotMatch(agentSessionSource, /sourceMappingURL/);

	const patchedCurrentAgentSession = patchPiAgentSessionSource(agentSessionSource);
	assert.match(patchedCurrentAgentSession, /deferred context waits for complete agent-run settlement/);
	assert.equal(patchPiAgentSessionSource(patchedCurrentAgentSession), patchedCurrentAgentSession);
	assert.equal(patchPiSessionManagerSource(sessionManagerSource), sessionManagerSource);
	assert.equal(patchPiTransformMessagesSource(transformMessagesSource), transformMessagesSource);
	assert.equal(patchPiTransformMessagesSource(nestedTransformMessagesSource), nestedTransformMessagesSource);
	assert.equal(
		patchPiGithubCopilotDeviceCodeSource(githubCopilotDeviceCodeSource),
		githubCopilotDeviceCodeSource,
	);
	assert.equal(
		patchPiGithubCopilotDeviceCodeSource(nestedGithubCopilotDeviceCodeSource),
		nestedGithubCopilotDeviceCodeSource,
	);
	assert.equal(
		patchPiGithubCopilotOAuthSource(githubCopilotOAuthSource),
		githubCopilotOAuthSource,
	);
	assert.equal(
		patchPiGithubCopilotOAuthSource(nestedGithubCopilotOAuthSource),
		nestedGithubCopilotOAuthSource,
	);
	for (const [target, source] of [
		["agentSession", agentSessionSource],
		["sessionManager", sessionManagerSource],
		["transformMessages", transformMessagesSource],
		["githubCopilotDeviceCode", githubCopilotDeviceCodeSource],
		["githubCopilotOAuth", githubCopilotOAuthSource],
	] as const) {
		assert.doesNotThrow(() => assertPiRuntimeCorrectnessPatchSource(source, target));
		const required = target === "githubCopilotOAuth"
			? ["await sleep(delayMs, requestSignal);", "for (const modelId of modelIds)", "await response.body?.cancel();"]
			: PI_RUNTIME_CORRECTNESS_REQUIRED_FRAGMENTS[target];
		for (const fragment of required) {
			assert.throws(
				() => assertPiRuntimeCorrectnessPatchSource(source.replace(fragment, ""), target),
				/Incomplete Pi runtime correctness patch/,
			);
		}
		for (const fragment of PI_RUNTIME_CORRECTNESS_FORBIDDEN_FRAGMENTS[target]) {
			assert.throws(
				() => assertPiRuntimeCorrectnessPatchSource(`${source}\n${fragment}`, target),
				/Incomplete Pi runtime correctness patch/,
			);
		}
	}
	const appendFragment = "const entryId = this.sessionManager.appendMessage(toolResult);";
	const extensionFragment = "await this._emitExtensionEvent(event);";
	const reorderedAgentSession = agentSessionSource
		.replace(appendFragment, "__FEYNMAN_APPEND__")
		.replace(extensionFragment, appendFragment)
		.replace("__FEYNMAN_APPEND__", extensionFragment);
	assert.throws(
		() => assertPiRuntimeCorrectnessPatchSource(reorderedAgentSession, "agentSession"),
		/out of order/,
	);
	const reformattedImageQueueGuard = agentSessionSource.replace(
		"            // Empty text is valid when a queued user message contains only images.\n",
		"            if (messageText) {\n            // Empty text is valid when a queued user message contains only images.\n",
	);
	assert.notEqual(reformattedImageQueueGuard, agentSessionSource);
	assert.throws(
		() => assertPiRuntimeCorrectnessPatchSource(reformattedImageQueueGuard, "agentSession"),
		/retained messageText truthiness guard/,
	);
	const wrappedImageQueueGuard = agentSessionSource.replace(
		'            const messageText = contentText(event.message.content, "");\n',
		'            if ( messageText ) {\n            const messageText = contentText(event.message.content, "");\n',
	);
	assert.notEqual(wrappedImageQueueGuard, agentSessionSource);
	assert.throws(
		() => assertPiRuntimeCorrectnessPatchSource(wrappedImageQueueGuard, "agentSession"),
		/retained messageText truthiness guard/,
	);
	assert.throws(
		() => patchPiAgentSessionSource("export class AgentSession {}\n"),
		/Unsupported Pi 0\.84\.2 interleaved content prompt delegate layout/,
	);
	assert.throws(
		() => patchPiGithubCopilotDeviceCodeSource("function sleep() {}\n"),
		/Unsupported Pi 0\.85\.1 abortable sleep export/,
	);
	assert.throws(
		() => patchPiGithubCopilotOAuthSource("export const githubCopilotOAuth = {};\n"),
		/Unsupported Pi 0\.85\.1 github-copilot OAuth import layout/,
	);
	assert.doesNotThrow(() =>
		assertPiRuntimeCorrectnessVersion(PI_RUNTIME_CORRECTNESS_REQUIRED_VERSION, "test"),
	);
	assert.throws(
		() => assertPiRuntimeCorrectnessVersion("0.82.1", "test"),
		/expected 0\.85\.1, found 0\.82\.1/,
	);
	assert.throws(
		() => assertPiRuntimeCorrectnessVersion("0.84.0", "test"),
		/expected 0\.85\.1, found 0\.84\.0/,
	);
});

test("runtime semantic validators reject interleaved-content and EXIF fail-open mutations", () => {
	const agentSessionSource = readFileSync(agentSessionPath, "utf8");
	const ignoredOrderedContent = agentSessionSource.replace(
		`    _createUserContent(text, images, orderedContent) {
        return orderedContent ?? [{ type: "text", text }, ...(images ?? [])];
    }`,
		`    _createUserContent(text, images, orderedContent) {
        return [{ type: "text", text }, ...(images ?? [])];
    }`,
	);
	assert.notEqual(ignoredOrderedContent, agentSessionSource);
	assert.throws(
		() => assertPiRuntimeCorrectnessPatchSource(ignoredOrderedContent, "agentSession"),
		/missing exact _createUserContent return/,
	);

	const droppedOrderedContentHandoff = agentSessionSource.replace(
		`        await this._prompt(text, {
            expandPromptTemplates: options?.expandPromptTemplates ?? false,
            streamingBehavior: options?.deliverAs,
            images,
            source: "extension",
        }, orderedContent);`,
		`        await this._prompt(text, {
            expandPromptTemplates: options?.expandPromptTemplates ?? false,
            streamingBehavior: options?.deliverAs,
            images,
            source: "extension",
        });`,
	);
	assert.notEqual(droppedOrderedContentHandoff, agentSessionSource);
	assert.throws(
		() => assertPiRuntimeCorrectnessPatchSource(droppedOrderedContentHandoff, "agentSession"),
		/missing exact sendUserMessage _prompt handoff/,
	);

	const exifSource = readFileSync(exifOrientationPath, "utf8");
	const unconditionalExifReturn = exifSource.replace(
		`            if (hasExifHeader(bytes, segmentStart))
                return segmentStart + 6;`,
		"            return segmentStart + 6;",
	);
	assert.notEqual(unconditionalExifReturn, exifSource);
	assert.throws(
		() =>
			assertPiCodingAgentForwardFixSource(
				"dist/utils/exif-orientation.js",
				unconditionalExifReturn,
			),
		/missing exact conditional EXIF-after-XMP block/,
	);

	const deadExifCondition = exifSource.replace(
		"            if (hasExifHeader(bytes, segmentStart))",
		"            if (false && hasExifHeader(bytes, segmentStart))",
	);
	assert.notEqual(deadExifCondition, exifSource);
	assert.throws(
		() =>
			assertPiCodingAgentForwardFixSource(
				"dist/utils/exif-orientation.js",
				deadExifCondition,
			),
		/missing exact conditional EXIF-after-XMP block/,
	);
});

test("late provider rejection after synchronous abort is handled", async (t) => {
	const originalTimeout = process.env.FEYNMAN_PI_STREAM_EVENT_IDLE_TIMEOUT_MS;
	delete process.env.FEYNMAN_PI_STREAM_EVENT_IDLE_TIMEOUT_MS;
	t.after(() => {
		if (originalTimeout === undefined) {
			delete process.env.FEYNMAN_PI_STREAM_EVENT_IDLE_TIMEOUT_MS;
		} else {
			process.env.FEYNMAN_PI_STREAM_EVENT_IDLE_TIMEOUT_MS = originalTimeout;
		}
	});

	const unhandledRejections: unknown[] = [];
	const onUnhandledRejection = (reason: unknown) => {
		unhandledRejections.push(reason);
	};
	process.on("unhandledRejection", onUnhandledRejection);
	t.after(() => process.off("unhandledRejection", onUnhandledRejection));

	const { agentLoop } = await import("@earendil-works/pi-agent-core");
	const controller = new AbortController();
	let settleProviderResult: ((message: unknown) => void) | undefined;
	const providerResult = new Promise<unknown>((resolveResult) => {
		settleProviderResult = resolveResult;
	});
	let rejectNext: ((error: Error) => void) | undefined;
	const nextResult = new Promise<never>((_resolveNext, reject) => {
		rejectNext = reject;
	});
	const providerStream = {
		end(message: unknown) {
			settleProviderResult?.(message);
		},
		result() {
			return providerResult;
		},
		[Symbol.asyncIterator]() {
			return {
				next() {
					controller.abort();
					setTimeout(() => rejectNext?.(new Error("late provider rejection")), 5);
					return nextResult;
				},
				return() {
					return Promise.resolve({ done: true as const, value: undefined });
				},
			};
		},
	};
	const model = {
		id: "late-rejection",
		name: "late-rejection",
		api: "openai-completions" as const,
		provider: "remote-test",
		baseUrl: "https://provider.example/v1",
		reasoning: false,
		input: ["text" as const],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 1_000,
		maxTokens: 100,
	};
	const stream = agentLoop(
		[{ role: "user", content: "hello", timestamp: Date.now() }],
		{ systemPrompt: "", messages: [], tools: [] },
		{
			model,
			convertToLlm: (messages: unknown[]) => messages,
			streamIdleTimeoutMs: 0,
		} as never,
		controller.signal,
		(() => providerStream) as never,
	);
	for await (const _event of stream) {
		// Drain the real agent loop through its terminal event.
	}
	const messages = await stream.result();
	await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));

	const final = messages.at(-1);
	assert.equal(final?.role === "assistant" ? final.stopReason : undefined, "aborted");
	assert.deepEqual(unhandledRejections, []);
});

test("GitHub Copilot login serializes policy updates and retries model discovery after 429", async (t) => {
	const originalFetch = globalThis.fetch;
	t.after(() => {
		globalThis.fetch = originalFetch;
	});
	let activePolicyRequests = 0;
	let maxActivePolicyRequests = 0;
	let policyRequestCount = 0;
	let modelsRequestCount = 0;
	const catalog = JSON.parse(readFileSync(resolve(appRoot, "node_modules", "@earendil-works",
		"pi-ai", "dist", "providers", "data", "github-copilot.json"), "utf8"));
	const policyIds = Object.values(catalog).flatMap(group => Object.keys(group as object)).slice(0, 2);
	globalThis.fetch = async (input) => {
		const url = typeof input === "string" || input instanceof URL
			? String(input)
			: input.url;
		if (url.endsWith("/login/device/code")) {
			return Response.json({
				device_code: "device-code",
				user_code: "ABCD-EFGH",
				verification_uri: "https://github.com/login/device",
				interval: 1,
				expires_in: 30,
			});
		}
		if (url.endsWith("/login/oauth/access_token")) {
			return Response.json({ access_token: "ghu_refresh_token" });
		}
		if (url.includes("/copilot_internal/v2/token")) {
			return Response.json({
				token: "tid=test;exp=9999999999;proxy-ep=proxy.individual.githubcopilot.com;",
				expires_at: 9_999_999_999,
			});
		}
		if (url.includes("/models/") && url.endsWith("/policy")) {
			policyRequestCount += 1;
			activePolicyRequests += 1;
			maxActivePolicyRequests = Math.max(maxActivePolicyRequests, activePolicyRequests);
			await new Promise((resolveDelay) => setTimeout(resolveDelay, 1));
			activePolicyRequests -= 1;
			return new Response("", { status: 200 });
		}
		if (url.endsWith("/models")) {
			modelsRequestCount += 1;
			if (modelsRequestCount === 1) {
				return new Response("too many requests", {
					status: 429,
					headers: { "retry-after": "0.001" },
				});
			}
			return Response.json({
				data: policyIds.map(id => ({ id, model_picker_enabled: true, policy: { state: "unconfigured" } })),
			});
		}
		throw new Error(`Unexpected GitHub Copilot request: ${url}`);
	};

	const copilotModule = await import(`${pathToFileURL(githubCopilotOAuthPath).href}?test=${Date.now()}`) as {
		githubCopilotOAuth: {
			login: (interaction: {
				prompt: () => Promise<string>;
				notify: (event: unknown) => void;
				signal: AbortSignal;
			}) => Promise<{ availableModelIds?: string[] }>;
		};
	};
	const credentials = await copilotModule.githubCopilotOAuth.login({
		prompt: async () => "",
		notify: () => {},
		signal: new AbortController().signal,
	});

	assert.equal(policyRequestCount, 2);
	assert.equal(maxActivePolicyRequests, 1);
	assert.equal(modelsRequestCount, 2);
	assert.deepEqual(credentials.availableModelIds, policyIds);
});

test("Pi 0.84.2 correctness patch migrates the pre-review eager persistence layout", () => {
	patchPiRuntimeNodeModules(appRoot);
	const current = readFileSync(agentSessionPath, "utf8");
	const currentBoundary = `        const feynmanToolResultIdBeforeExtensions = event.type === "message_end" && event.message.role === "toolResult"
            ? event.message.toolCallId
            : undefined;
        // A finalized result must be durable before a parallel sibling settles.
        // Persist before extension dispatch so a completed tool survives a blocked handler.
        // Public message_end events remain ordered by the assistant's tool calls.
        if (event.type === "tool_execution_end") {
            const toolResult = createFeynmanToolResultMessage(event);
            const entryId = this.sessionManager.appendMessage(toolResult);
            this._feynmanEagerlyPersistedToolResults.set(event.toolCallId, {
                entryId,
                message: toolResult,
                serializedPayload: this.sessionManager.isPersisted()
                    ? serializeFeynmanToolResultPayload(toolResult)
                    : undefined,
            });
        }
        // Emit to extensions first
        await this._emitExtensionEvent(event);
        // Tool result identity is protocol-bound to the assistant's original call.
        // Preserve it when an extension returns a same-role replacement with another ID.
        if (feynmanToolResultIdBeforeExtensions !== undefined &&
            event.type === "message_end" &&
            event.message.role === "toolResult" &&
            event.message.toolCallId !== feynmanToolResultIdBeforeExtensions) {
            event.message.toolCallId = feynmanToolResultIdBeforeExtensions;
        }
`;
	const legacyBoundary = `        // Emit to extensions first
        await this._emitExtensionEvent(event);
        // A finalized result must be durable before a parallel sibling settles.
        // Public message_end events remain ordered by the assistant's tool calls.
        if (event.type === "tool_execution_end") {
            const toolResult = createFeynmanToolResultMessage(event);
            const entryId = this.sessionManager.appendMessage(toolResult);
            this._feynmanEagerlyPersistedToolResults.set(event.toolCallId, {
                entryId,
                message: toolResult,
                serializedPayload: this.sessionManager.isPersisted()
                    ? serializeFeynmanToolResultPayload(toolResult)
                    : undefined,
            });
        }
`;
	const currentLookup = `                const eagerToolCallId = feynmanToolResultIdBeforeExtensions ?? event.message.toolCallId;
                const eagerlyPersisted = this._feynmanEagerlyPersistedToolResults.get(eagerToolCallId);
                this._feynmanEagerlyPersistedToolResults.delete(eagerToolCallId);`;
	const legacyLookup = `                const eagerlyPersisted = this._feynmanEagerlyPersistedToolResults.get(event.message.toolCallId);
                this._feynmanEagerlyPersistedToolResults.delete(event.message.toolCallId);`;
	const legacy = current
		.replace(currentBoundary, legacyBoundary)
		.replace(currentLookup, legacyLookup);
	assert.notEqual(legacy, current);
	assert.doesNotMatch(legacy, /feynmanToolResultIdBeforeExtensions/);
	assert.throws(
		() => assertPiRuntimeCorrectnessPatchSource(legacy, "agentSession"),
		/Incomplete Pi runtime correctness patch/,
	);

	const migrated = patchPiAgentSessionSource(legacy);
	assert.equal(migrated, current);
	assert.equal(patchPiAgentSessionSource(migrated), migrated);
});

test("package artifact verification rejects a mixed Pi runtime train", () => {
	const packageRoot = mkdtempSync(resolve(tmpdir(), "feynman-mixed-pi-artifact-"));
	try {
		const appManifest = JSON.parse(
			readFileSync(resolve(appRoot, "package.json"), "utf8"),
		) as { optionalDependencies?: Record<string, string>; overrides: Record<string, string> };
		const ipAddressVersion = appManifest.overrides["ip-address"];
		assert.ok(ipAddressVersion);
		mkdirSync(resolve(packageRoot, "node_modules", "ip-address"), { recursive: true });
		writeFileSync(
			resolve(packageRoot, "node_modules", "ip-address", "package.json"),
			JSON.stringify({ name: "ip-address", version: ipAddressVersion }),
		);
		writeFileSync(
			resolve(packageRoot, "package.json"),
			JSON.stringify({
				name: "mixed-pi-artifact",
				dependencies: {
					"@earendil-works/pi-agent-core": "0.82.1",
					"@earendil-works/pi-ai": PI_RUNTIME_CORRECTNESS_REQUIRED_VERSION,
					"@earendil-works/pi-coding-agent": PI_RUNTIME_CORRECTNESS_REQUIRED_VERSION,
					"@earendil-works/pi-tui": PI_RUNTIME_CORRECTNESS_REQUIRED_VERSION,
					"brace-expansion": "5.0.9",
				},
				optionalDependencies: appManifest.optionalDependencies,
				overrides: {
					"brace-expansion": "5.0.9",
					"ip-address": ipAddressVersion,
				},
			}),
		);
		const result = spawnSync(
			process.execPath,
			[resolve(appRoot, "scripts", "verify-package-artifact.mjs"), packageRoot],
			{ encoding: "utf8" },
		);
		assert.notEqual(result.status, 0);
		assert.match(
			result.stderr,
			/@earendil-works\/pi-agent-core must be pinned to Pi 0\.85\.1, found 0\.82\.1/,
		);
	} finally {
		rmSync(packageRoot, { recursive: true, force: true });
	}
});

test("manual compaction rejects a prompt before RPC preflight can ACK it", async () => {
	const { AgentSession } = await import("@earendil-works/pi-coding-agent");
	const session = Object.create(AgentSession.prototype) as {
		_compactionAbortController: AbortController;
		_isAgentRunActive: boolean;
		prompt: (
			text: string,
			options: { preflightResult: (success: boolean) => void },
		) => Promise<void>;
	};
	session._compactionAbortController = new AbortController();
	session._isAgentRunActive = false;
	const preflight: boolean[] = [];

	await assert.rejects(
		session.prompt("do not lose this", { preflightResult: (success) => preflight.push(success) }),
		/Cannot submit a prompt while compaction is in progress/,
	);
	assert.deepEqual(preflight, [false]);
});

test("RPC reports success false for a prompt submitted during manual compaction", async (t) => {
	const rpcModeUrl = pathToFileURL(resolve(
		appRoot,
		"node_modules",
		"@earendil-works",
		"pi-coding-agent",
		"dist",
		"modes",
		"rpc",
		"rpc-mode.js",
	)).href;
	const codingAgentUrl = pathToFileURL(resolve(
		appRoot,
		"node_modules",
		"@earendil-works",
		"pi-coding-agent",
		"dist",
		"index.js",
	)).href;
	const childSource = `
		import { AgentSession } from ${JSON.stringify(codingAgentUrl)};
		import { runRpcMode } from ${JSON.stringify(rpcModeUrl)};
		const session = Object.create(AgentSession.prototype);
		session._compactionAbortController = new AbortController();
		session._isAgentRunActive = false;
		session.bindExtensions = async () => {};
		session.subscribe = () => () => {};
		session.agent = { subscribe: () => () => {} };
		const runtimeHost = {
			session,
			setRebindSession() {},
			async dispose() {},
		};
		void runRpcMode(runtimeHost);
	`;
	const child = spawn(process.execPath, ["--input-type=module", "-e", childSource], {
		stdio: ["pipe", "pipe", "pipe"],
	});
	t.after(() => {
		if (child.exitCode === null) child.kill("SIGTERM");
	});
	child.stdout.setEncoding("utf8");
	child.stderr.setEncoding("utf8");
	let stderr = "";
	child.stderr.on("data", (chunk) => {
		stderr += String(chunk);
	});
	const response = new Promise<{
		type: string;
		command: string;
		success: boolean;
		error?: string;
	}>((resolveResponse, rejectResponse) => {
		let stdout = "";
		const timeout = setTimeout(() => {
			rejectResponse(new Error(`Timed out waiting for RPC response. ${stderr}`));
		}, 5_000);
		child.stdout.on("data", (chunk) => {
			stdout += String(chunk);
			const newlineIndex = stdout.indexOf("\n");
			if (newlineIndex === -1) return;
			clearTimeout(timeout);
			resolveResponse(JSON.parse(stdout.slice(0, newlineIndex)));
		});
		child.once("exit", (code, signal) => {
			clearTimeout(timeout);
			rejectResponse(new Error(`RPC child exited before responding: ${code}/${signal}. ${stderr}`));
		});
	});
	child.stdin.write(`${JSON.stringify({
		id: "prompt-during-compaction",
		type: "prompt",
		message: "do not acknowledge this",
	})}\n`);
	const result = await response;
	assert.equal(result.type, "response");
	assert.equal(result.command, "prompt");
	assert.equal(result.success, false);
	assert.match(result.error ?? "", /Cannot submit a prompt while compaction is in progress/);
});

test("interleaved research text and images retain order for idle and queued delivery", async (t) => {
	const [{ Agent }, codingAgent, piAi] = await Promise.all([
		import("@earendil-works/pi-agent-core"),
		import("@earendil-works/pi-coding-agent"),
		import("@earendil-works/pi-ai/compat"),
	]);
	const { AgentSession, SessionManager, SettingsManager, convertToLlm } = codingAgent;
	const { fauxAssistantMessage, registerFauxProvider, streamSimple } = piAi;
	const tempRoot = mkdtempSync(resolve(tmpdir(), "feynman-pi-8615-"));
	const faux = registerFauxProvider();
	let session: InstanceType<typeof AgentSession> | undefined;
	t.after(() => {
		session?.dispose();
		faux.unregister();
		if (existsSync(tempRoot)) rmSync(tempRoot, { recursive: true });
	});
	const content = [
		{ type: "text" as const, text: "Figure A:" },
		{ type: "image" as const, mimeType: "image/png" as const, data: "Zmlyc3Q=" },
		{ type: "text" as const, text: "Figure B:" },
		{ type: "image" as const, mimeType: "image/png" as const, data: "c2Vjb25k" },
	];
	let providerContent: unknown;
	faux.setResponses([
		(context) => {
			providerContent = context.messages.find((message) => message.role === "user")?.content;
			return fauxAssistantMessage("received");
		},
	]);
	const model = faux.getModel();
	const sessionManager = SessionManager.create(tempRoot, tempRoot);
	const agent = new Agent({
		getApiKey: () => "faux-key",
		streamFn: streamSimple,
		initialState: {
			model,
			systemPrompt: "You are a test assistant.",
			tools: [],
		},
		convertToLlm,
	});
	session = new AgentSession({
		agent,
		sessionManager,
		settingsManager: SettingsManager.inMemory({ compaction: { enabled: false } }),
		cwd: tempRoot,
		modelRuntime: {
			hasConfiguredAuth: () => true,
			checkAuth: async () => ({ auth: { apiKey: "faux-key" } }),
			getAuth: async () => ({ auth: { apiKey: "faux-key" } }),
			isUsingOAuth: () => false,
		} as never,
		resourceLoader: createResourceLoader(codingAgent.createExtensionRuntime()) as never,
		baseToolsOverride: {},
	});

	await session.sendUserMessage(content);
	assert.deepEqual(providerContent, content);
	const agentUser = agent.state.messages.find((message) => message.role === "user");
	assert.deepEqual(agentUser?.role === "user" ? agentUser.content : undefined, content);
	const persistedUser = sessionManager
		.buildSessionContext()
		.messages.find((message) => message.role === "user");
	assert.deepEqual(persistedUser?.role === "user" ? persistedUser.content : undefined, content);

	const prototype = AgentSession.prototype as unknown as {
		_createUserContent(
			text: string,
			images?: Array<{ type: "image"; mimeType: "image/png"; data: string }>,
			orderedContent?: typeof content,
		): typeof content;
		_queueSteer(
			this: unknown,
			text: string,
			images: typeof content extends Array<infer Part>
				? Array<Extract<Part, { type: "image" }>>
				: never,
			orderedContent: typeof content,
		): Promise<void>;
		_queueFollowUp(
			this: unknown,
			text: string,
			images: typeof content extends Array<infer Part>
				? Array<Extract<Part, { type: "image" }>>
				: never,
			orderedContent: typeof content,
		): Promise<void>;
	};
	const queued: { steer?: unknown; followUp?: unknown } = {};
	const queueHarness = {
		_steeringMessages: [] as string[],
		_followUpMessages: [] as string[],
		_emitQueueUpdate: () => {},
		_createUserContent: prototype._createUserContent,
		agent: {
			steer: (message: { content: unknown }) => {
				queued.steer = message.content;
			},
			followUp: (message: { content: unknown }) => {
				queued.followUp = message.content;
			},
		},
	};
	const images = content.filter(
		(part): part is Extract<(typeof content)[number], { type: "image" }> =>
			part.type === "image",
	);
	await prototype._queueSteer.call(queueHarness, "Figure A:\nFigure B:", images, content);
	await prototype._queueFollowUp.call(queueHarness, "Figure A:\nFigure B:", images, content);
	assert.deepEqual(queued.steer, content);
	assert.deepEqual(queued.followUp, content);
	assert.deepEqual(
		prototype._createUserContent("transformed", images),
		[{ type: "text", text: "transformed" }, ...images],
	);
});

test("completed parallel results persist before a slow sibling and restore in tool-call order", async (t) => {
	const [{ Agent }, codingAgent, piAi] = await Promise.all([
		import("@earendil-works/pi-agent-core"),
		import("@earendil-works/pi-coding-agent"),
		import("@earendil-works/pi-ai/compat"),
	]);
	const { AgentSession, SessionManager, SettingsManager, convertToLlm } = codingAgent;
	const { fauxAssistantMessage, fauxToolCall, registerFauxProvider, streamSimple } = piAi;
	const tempRoot = mkdtempSync(resolve(tmpdir(), "feynman-pi-7053-"));
	const faux = registerFauxProvider();
	let disposeSession: (() => void) | undefined;
	t.after(() => {
		disposeSession?.();
		faux.unregister();
		if (existsSync(tempRoot)) rmSync(tempRoot, { recursive: true });
	});
	let releaseSlow: (() => void) | undefined;
	const slowGate = new Promise<void>((resolveGate) => {
		releaseSlow = resolveGate;
	});
	type ToolExecution = {
		text: string;
		usage?: {
			input: number;
			output: number;
			cacheRead: number;
			cacheWrite: number;
			totalTokens: number;
			cost: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
		};
	};
	const makeTool = (name: string, execute: () => Promise<ToolExecution>) => ({
		name,
		label: name,
		description: `${name} regression tool`,
		parameters: Type.Object({}),
		execute: async () => {
			const result = await execute();
			return {
				content: [{ type: "text" as const, text: result.text }],
				details: {},
				usage: result.usage,
			};
		},
	});
	const slowTool = makeTool("slow", async () => {
		await slowGate;
		return { text: "slow result" };
	});
	const eagerFastUsage = {
		input: 1,
		output: 2,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 3,
		cost: { input: 0.1, output: 0.2, cacheRead: 0, cacheWrite: 0, total: 0.3 },
	};
	const replacementFastUsage = {
		input: 3,
		output: 4,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 7,
		cost: { input: 0.3, output: 0.4, cacheRead: 0, cacheWrite: 0, total: 0.7 },
	};
	const fastTool = makeTool("fast", async () => ({ text: "fast result", usage: eagerFastUsage }));
	const model = faux.getModel();
	const sessionManager = SessionManager.create(tempRoot, tempRoot);
	const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false } });
	const modelRuntime = {
		hasConfiguredAuth: () => true,
		checkAuth: async () => ({ auth: { apiKey: "faux-key" } }),
		getAuth: async () => ({ auth: { apiKey: "faux-key" } }),
		isUsingOAuth: () => false,
	};
	const agent = new Agent({
		getApiKey: () => "faux-key",
		streamFn: streamSimple,
		initialState: {
			model,
			systemPrompt: "You are a test assistant.",
			tools: [],
		},
		convertToLlm,
	});
	const session = new AgentSession({
		agent,
		sessionManager,
		settingsManager,
		cwd: tempRoot,
		modelRuntime: modelRuntime as never,
		resourceLoader: createResourceLoader(codingAgent.createExtensionRuntime()) as never,
		baseToolsOverride: { slow: slowTool, fast: fastTool },
	});
	disposeSession = () => session.dispose();
	const extensionRunner = (session as unknown as {
		_extensionRunner: {
			emit: (event: {
				type: string;
				toolCallId?: string;
			}) => Promise<void>;
			emitMessageEnd: (event: {
				message: {
					role: string;
					toolCallId?: string;
					content: unknown[];
				};
			}) => Promise<unknown>;
		};
	})._extensionRunner;
	const emitExtensionEvent = extensionRunner.emit.bind(extensionRunner);
	let enterFastExtension: (() => void) | undefined;
	const fastExtensionEntered = new Promise<void>((resolveEntered) => {
		enterFastExtension = resolveEntered;
	});
	let releaseFastExtension: (() => void) | undefined;
	const fastExtensionGate = new Promise<void>((resolveGate) => {
		releaseFastExtension = resolveGate;
	});
	extensionRunner.emit = async (event) => {
		if (event.type === "tool_execution_end" && event.toolCallId === "fast-call") {
			enterFastExtension?.();
			await fastExtensionGate;
		}
		await emitExtensionEvent(event);
	};
	const emitMessageEnd = extensionRunner.emitMessageEnd.bind(extensionRunner);
	extensionRunner.emitMessageEnd = async (event) => {
		const upstreamReplacement = await emitMessageEnd(event);
		const message = (upstreamReplacement ?? event.message) as typeof event.message;
		if (message.role !== "toolResult" || message.toolCallId !== "fast-call") {
			return upstreamReplacement;
		}
		return {
			...message,
			toolCallId: "rewritten-fast-call",
			content: [{ type: "text", text: "extension-modified fast result" }],
			usage: replacementFastUsage,
		};
	};
	const publicMessageEndIds: string[] = [];
	let finishFast: (() => void) | undefined;
	const fastEnded = new Promise<void>((resolveFast) => {
		finishFast = resolveFast;
	});
	session.subscribe((event) => {
		if (event.type === "tool_execution_end" && event.toolCallId === "fast-call") {
			finishFast?.();
		}
		if (event.type === "message_end" && event.message.role === "toolResult") {
			publicMessageEndIds.push(event.message.toolCallId);
		}
	});
	faux.setResponses([
		fauxAssistantMessage(
			[
				fauxToolCall("slow", {}, { id: "slow-call" }),
				fauxToolCall("fast", {}, { id: "fast-call" }),
			],
			{ stopReason: "toolUse" },
		),
		fauxAssistantMessage("done"),
	]);

	const prompt = session.prompt("run both tools");
	try {
		await fastExtensionEntered;
		const blockedSessionFile = sessionManager.getSessionFile();
		assert.ok(blockedSessionFile);
		const reopenedWhileExtensionBlocked = SessionManager.open(blockedSessionFile);
		const resultsWhileExtensionBlocked = reopenedWhileExtensionBlocked
			.getBranch()
			.flatMap((entry) =>
				entry.type === "message" && entry.message.role === "toolResult"
					? [entry.message.toolCallId]
					: [],
			);
		assert.deepEqual(resultsWhileExtensionBlocked, ["fast-call"]);
		releaseFastExtension?.();
		await fastEnded;
		const persistedWhileSlow = sessionManager
			.getBranch()
			.flatMap((entry) =>
				entry.type === "message" && entry.message.role === "toolResult"
					? [entry.message.toolCallId]
					: [],
			);
		assert.deepEqual(persistedWhileSlow, ["fast-call"]);
		const pendingSessionFile = sessionManager.getSessionFile();
		assert.ok(pendingSessionFile);
		const reopenedWhileSlow = SessionManager.open(pendingSessionFile);
		const reopenedPendingResults = reopenedWhileSlow
			.getBranch()
			.flatMap((entry) =>
				entry.type === "message" && entry.message.role === "toolResult"
					? [entry.message.toolCallId]
					: [],
			);
		assert.deepEqual(reopenedPendingResults, ["fast-call"]);
	} finally {
		releaseFastExtension?.();
		releaseSlow?.();
		await prompt;
	}

	const persistedCompletionOrder = sessionManager
		.getBranch()
		.flatMap((entry) =>
			entry.type === "message" && entry.message.role === "toolResult"
				? [entry.message.toolCallId]
				: [],
		);
	assert.deepEqual(persistedCompletionOrder, ["fast-call", "slow-call"]);
	const restoredSourceOrder = sessionManager
		.buildSessionContext()
		.messages.filter((message) => message.role === "toolResult")
		.map((message) => (message.role === "toolResult" ? message.toolCallId : ""));
	assert.deepEqual(restoredSourceOrder, ["slow-call", "fast-call"]);
	assert.deepEqual(publicMessageEndIds, ["slow-call", "fast-call"]);
	const sessionFile = sessionManager.getSessionFile();
	assert.ok(sessionFile);
	const rawToolResults = readFileSync(sessionFile, "utf8")
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line) as {
			type: string;
			message?: {
				role?: string;
				toolCallId?: string;
				content?: Array<{ type: string; text?: string }>;
			};
		})
		.filter((entry) => entry.type === "message" && entry.message?.role === "toolResult");
	assert.deepEqual(
		rawToolResults.map((entry) => entry.message?.toolCallId),
		["fast-call", "slow-call"],
	);
	assert.equal(rawToolResults[0]?.message?.content?.[0]?.text, "extension-modified fast result");
	const reopened = SessionManager.open(sessionFile);
	const reopenedToolResults = reopened
		.buildSessionContext()
		.messages.filter((message) => message.role === "toolResult");
	assert.deepEqual(
		reopenedToolResults.map((message) => message.role === "toolResult" ? message.toolCallId : ""),
		["slow-call", "fast-call"],
	);
	const reopenedFast = reopenedToolResults.find((message) =>
		message.role === "toolResult" && message.toolCallId === "fast-call"
	);
	const reopenedFastContent = reopenedFast?.role === "toolResult"
		? reopenedFast.content[0]
		: undefined;
	assert.equal(
		reopenedFastContent?.type === "text" ? reopenedFastContent.text : undefined,
		"extension-modified fast result",
	);
	const stats = session.getSessionStats();
	assert.equal(stats.toolResults, 2);
	assert.equal(stats.cost, replacementFastUsage.cost.total);
});

test("provider transformation orders eager results and synthesizes only unresolved calls", async () => {
	const moduleUrl = `${pathToFileURL(nestedTransformMessagesPath).href}?feynman-7053`;
	const { transformMessages } = (await import(moduleUrl)) as {
		transformMessages: (messages: unknown[], model: unknown) => Array<{
			role: string;
			toolCallId?: string;
			isError?: boolean;
		}>;
	};
	const timestamp = Date.now();
	const messages = [
		{ role: "user", content: "run tools", timestamp },
		{
			role: "assistant",
			content: [
				{ type: "toolCall", id: "slow-call", name: "slow", arguments: {} },
				{ type: "toolCall", id: "fast-call", name: "fast", arguments: {} },
			],
			api: "faux",
			provider: "faux",
			model: "faux",
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "toolUse",
			timestamp,
		},
		{
			role: "toolResult",
			toolCallId: "fast-call",
			toolName: "fast",
			content: [{ type: "text", text: "fast result" }],
			isError: false,
			timestamp,
		},
	];
	const transformed = transformMessages(messages, {
		id: "faux",
		name: "faux",
		api: "faux",
		provider: "faux",
		baseUrl: "http://localhost",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 1_000,
		maxTokens: 100,
	});
	const toolResults = transformed.filter((message) => message.role === "toolResult");
	assert.deepEqual(toolResults.map((message) => message.toolCallId), ["slow-call", "fast-call"]);
	assert.deepEqual(toolResults.map((message) => message.isError), [true, false]);
});
