import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import type { Context } from "@earendil-works/pi-ai";
import { Type } from "typebox";

import { patchPiAgentSessionSource } from "../scripts/lib/pi-runtime-correctness-patch.mjs";

const appRoot = process.cwd();
async function loadCodingAgentWithPatchedSession() {
	const codingAgent = await import("@earendil-works/pi-coding-agent");
	const moduleUrl = pathToFileURL(resolve(appRoot, "node_modules", "@earendil-works",
		"pi-coding-agent", "dist", "core", "agent-session.js"));
	const source = patchPiAgentSessionSource(readFileSync(moduleUrl, "utf8"));
	const linked = source.replace(/from "([^"]+)";/g, (_match, specifier: string) =>
		`from ${JSON.stringify(specifier.startsWith(".") ? new URL(specifier, moduleUrl).href : import.meta.resolve(specifier))};`);
	const session = await import(`data:text/javascript;base64,${Buffer.from(linked).toString("base64")}`) as typeof codingAgent;
	return { ...codingAgent, AgentSession: session.AgentSession };
}

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

test("real image-only steering and follow-up delivery clears colliding empty queue keys", async (t) => {
	const [{ Agent }, codingAgent, piAi] = await Promise.all([
		import("@earendil-works/pi-agent-core"),
		loadCodingAgentWithPatchedSession(),
		import("@earendil-works/pi-ai/compat"),
	]);
	const { AgentSession, SessionManager, SettingsManager, convertToLlm } = codingAgent;
	const { fauxAssistantMessage, fauxToolCall, registerFauxProvider, streamSimple } = piAi;
	const faux = registerFauxProvider({
		models: [{ id: "faux-image-queue", input: ["text", "image"] }],
	});
	let disposeSession: (() => void) | undefined;
	t.after(() => {
		disposeSession?.();
		faux.unregister();
	});

	let markToolStarted: (() => void) | undefined;
	const toolStarted = new Promise<void>((resolveStarted) => {
		markToolStarted = resolveStarted;
	});
	let releaseTool: (() => void) | undefined;
	const toolGate = new Promise<void>((resolveTool) => {
		releaseTool = resolveTool;
	});
	const waitTool = {
		name: "wait",
		label: "wait",
		description: "Hold the turn while image-only messages are queued",
		parameters: Type.Object({}),
		execute: async () => {
			markToolStarted?.();
			await toolGate;
			return {
				content: [{ type: "text" as const, text: "released" }],
				details: {},
			};
		},
	};
	const model = faux.getModel();
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
		sessionManager: SessionManager.inMemory(appRoot),
		settingsManager: SettingsManager.inMemory({ compaction: { enabled: false } }),
		cwd: appRoot,
		modelRuntime: modelRuntime as never,
		resourceLoader: createResourceLoader(codingAgent.createExtensionRuntime()) as never,
		baseToolsOverride: { wait: waitTool },
	});
	disposeSession = () => session.dispose();

	const receivedImageData: string[] = [];
	const recordLatestImage = (context: Context) => {
		const user = [...context.messages].reverse().find((message) => message.role === "user");
		const image = user?.role === "user" && Array.isArray(user.content)
			? user.content.find((part) => part.type === "image")
			: undefined;
		assert.equal(image?.type, "image");
		receivedImageData.push(image?.type === "image" ? image.data : "");
	};
	faux.setResponses([
		fauxAssistantMessage(fauxToolCall("wait", {}, { id: "wait-call" }), {
			stopReason: "toolUse",
		}),
		(context) => {
			recordLatestImage(context);
			return fauxAssistantMessage("steering image received");
		},
		(context) => {
			recordLatestImage(context);
			return fauxAssistantMessage("follow-up image received");
		},
	]);

	const updates: Array<{ steering: string[]; followUp: string[] }> = [];
	session.subscribe((event) => {
		if (event.type === "queue_update") {
			updates.push({
				steering: [...event.steering],
				followUp: [...event.followUp],
			});
		}
	});
	const followUpImage = {
		type: "image" as const,
		mimeType: "image/png",
		data: "Zm9sbG93LXVw",
	};
	const steeringImage = {
		type: "image" as const,
		mimeType: "image/png",
		data: "c3RlZXI=",
	};

	const prompt = session.prompt("wait for queued images");
	await toolStarted;
	await session.followUp("", [followUpImage]);
	await session.steer("", [steeringImage]);
	assert.equal(session.pendingMessageCount, 2);
	assert.deepEqual(updates.at(-1), { steering: [""], followUp: [""] });
	releaseTool?.();
	await prompt;

	assert.deepEqual(receivedImageData, [steeringImage.data, followUpImage.data]);
	assert.equal(session.agent.hasQueuedMessages(), false);
	assert.equal(session.pendingMessageCount, 0);
	assert.deepEqual(updates, [
		{ steering: [], followUp: [""] },
		{ steering: [""], followUp: [""] },
		{ steering: [], followUp: [""] },
		{ steering: [], followUp: [] },
	]);
});

test("triggerTurn-false custom messages wait until tool results and the run settle", async (t) => {
	const [{ Agent }, codingAgent, piAi] = await Promise.all([
		import("@earendil-works/pi-agent-core"),
		loadCodingAgentWithPatchedSession(),
		import("@earendil-works/pi-ai/compat"),
	]);
	const { AgentSession, SessionManager, SettingsManager, convertToLlm } = codingAgent;
	const { fauxAssistantMessage, fauxToolCall, registerFauxProvider, streamSimple } = piAi;
	const faux = registerFauxProvider({ models: [{ id: "faux-custom-order" }] });
	let session: InstanceType<typeof AgentSession> | undefined;
	t.after(() => {
		session?.dispose();
		faux.unregister();
	});

	let markToolStarted: (() => void) | undefined;
	const toolStarted = new Promise<void>((resolveStarted) => {
		markToolStarted = resolveStarted;
	});
	let releaseTool: (() => void) | undefined;
	const toolGate = new Promise<void>((resolveTool) => {
		releaseTool = resolveTool;
	});
	const waitTool = {
		name: "wait",
		label: "wait",
		description: "Hold the turn while a custom message arrives",
		parameters: Type.Object({}),
		execute: async () => {
			markToolStarted?.();
			await toolGate;
			return { content: [{ type: "text" as const, text: "released" }], details: {} };
		},
	};
	const model = faux.getModel();
	const sessionManager = SessionManager.inMemory(appRoot);
	const agent = new Agent({
		getApiKey: () => "faux-key",
		streamFn: streamSimple,
		initialState: { model, systemPrompt: "test", tools: [] },
		convertToLlm,
	});
	session = new AgentSession({
		agent,
		sessionManager,
		settingsManager: SettingsManager.inMemory({ compaction: { enabled: false } }),
		cwd: appRoot,
		modelRuntime: {
			hasConfiguredAuth: () => true,
			checkAuth: async () => ({ auth: { apiKey: "faux-key" } }),
			getAuth: async () => ({ auth: { apiKey: "faux-key" } }),
			isUsingOAuth: () => false,
		} as never,
		resourceLoader: createResourceLoader(codingAgent.createExtensionRuntime()) as never,
		baseToolsOverride: { wait: waitTool },
	});
	let agentEndMessage: Promise<void> | undefined;
	let sentAtAgentEnd = false;
	session.subscribe((event) => {
		if (
			event.type === "message_end" &&
			event.message.role === "custom" &&
			event.message.customType === "research-progress"
		) {
			throw new Error("listener failure must not stop the deferred drain");
		}
		if (event.type === "agent_end" && !sentAtAgentEnd) {
			sentAtAgentEnd = true;
			agentEndMessage = session?.sendCustomMessage(
				{ customType: "run-complete", content: "done", display: true },
				{ triggerTurn: false },
			);
		}
	});

	let resumedMessages: Context["messages"] = [];
	faux.setResponses([
		fauxAssistantMessage(fauxToolCall("wait", {}, { id: "wait-order" }), {
			stopReason: "toolUse",
		}),
		fauxAssistantMessage("original turn complete"),
		(context) => {
			resumedMessages = [...context.messages];
			return fauxAssistantMessage("resume complete");
		},
	]);

	const prompt = session.prompt("run tool");
	await toolStarted;
	await session.sendCustomMessage(
		{ customType: "research-progress", content: "deferred", display: true },
		{ triggerTurn: false, deliverAs: "followUp" },
	);
	await session.sendCustomMessage(
		{ customType: "after-progress", content: "still deferred", display: true },
		{ triggerTurn: false },
	);
	assert.equal(session.messages.some((message) => message.role === "custom"), false);
	releaseTool?.();
	await prompt;
	await agentEndMessage;

	const roles = session.messages.map((message) => message.role);
	assert.ok(roles.indexOf("custom") > roles.indexOf("toolResult"));
	assert.ok(roles.indexOf("custom") > roles.lastIndexOf("assistant"));
	assert.deepEqual(
		session.messages
			.filter((message) => message.role === "custom")
			.map((message) => message.customType),
		["research-progress", "after-progress", "run-complete"],
	);
	assert.deepEqual(
		sessionManager.getEntries()
			.filter((entry) => entry.type === "custom_message")
			.map((entry) => entry.customType),
		["research-progress", "after-progress", "run-complete"],
	);

	await session.prompt("continue");
	const resumedRoles = resumedMessages.map((message) => message.role);
	const toolResultIndex = resumedRoles.indexOf("toolResult");
	assert.equal(resumedRoles[toolResultIndex - 1], "assistant");
	const deferredIndex = resumedMessages.findIndex((message) =>
		message.role === "user" && JSON.stringify(message.content).includes("deferred")
	);
	assert.ok(deferredIndex > toolResultIndex);
});
