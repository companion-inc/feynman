import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { appendWorkflowFlagPositionals, buildLocalModelWorkflowNotice, resolveInitialPrompt, resolvePiPromptOptions, resolveThinkingConfig, shouldRunInteractiveSetup } from "../src/cli.js";
import { buildModelStatusSnapshotFromRecords, chooseRecommendedModel, getAvailableModelRecords } from "../src/model/catalog.js";
import { isLocalModelProvider, resolveModelProviderForCommand, setDefaultModelSpec } from "../src/model/commands.js";
import { createModelRegistry } from "../src/model/registry.js";

function createAuthPath(contents: Record<string, unknown>): string {
	const root = mkdtempSync(join(tmpdir(), "feynman-auth-"));
	const authPath = join(root, "auth.json");
	writeFileSync(authPath, JSON.stringify(contents, null, 2) + "\n", "utf8");
	return authPath;
}

test("chooseRecommendedModel prefers the strongest authenticated research model", () => {
	const authPath = createAuthPath({
		openai: { type: "api_key", key: "openai-test-key" },
		anthropic: { type: "api_key", key: "anthropic-test-key" },
	});

	const recommendation = chooseRecommendedModel(authPath);

	assert.equal(recommendation?.spec, "anthropic/claude-opus-4-6");
});

test("getAvailableModelRecords excludes expired OAuth credentials without an env fallback", () => {
	const authPath = createAuthPath({
		anthropic: {
			type: "oauth",
			access: "expired-access-token",
			refresh: "expired-refresh-token",
			expires: Date.now() - 1000,
		},
	});

	const available = getAvailableModelRecords(authPath);

	assert.equal(available.some((model) => model.provider === "anthropic"), false);
});

test("getAvailableModelRecords keeps unexpired OAuth credentials available", () => {
	const authPath = createAuthPath({
		anthropic: {
			type: "oauth",
			access: "current-access-token",
			refresh: "current-refresh-token",
			expires: Date.now() + 60_000,
		},
	});

	const available = getAvailableModelRecords(authPath);

	assert.equal(available.some((model) => model.provider === "anthropic"), true);
});

test("createModelRegistry overlays new Anthropic Opus model before upstream Pi updates", () => {
	const authPath = createAuthPath({
		anthropic: { type: "api_key", key: "anthropic-test-key" },
	});

	const registry = createModelRegistry(authPath);

	assert.ok(registry.find("anthropic", "claude-opus-4-7"));
	assert.equal(registry.getAvailable().some((model) => model.provider === "anthropic" && model.id === "claude-opus-4-7"), true);
});

test("setDefaultModelSpec accepts a unique bare model id from authenticated models", () => {
	const authPath = createAuthPath({
		openai: { type: "api_key", key: "openai-test-key" },
	});
	const settingsPath = join(mkdtempSync(join(tmpdir(), "feynman-settings-")), "settings.json");

	setDefaultModelSpec(settingsPath, authPath, "gpt-5.4");

	const settings = JSON.parse(readFileSync(settingsPath, "utf8")) as {
		defaultProvider?: string;
		defaultModel?: string;
	};
	assert.equal(settings.defaultProvider, "openai");
	assert.equal(settings.defaultModel, "gpt-5.4");
});

test("setDefaultModelSpec accepts provider:model syntax for authenticated models", () => {
	const authPath = createAuthPath({
		google: { type: "api_key", key: "google-test-key" },
	});
	const settingsPath = join(mkdtempSync(join(tmpdir(), "feynman-settings-")), "settings.json");

	setDefaultModelSpec(settingsPath, authPath, "google:gemini-3-pro-preview");

	const settings = JSON.parse(readFileSync(settingsPath, "utf8")) as {
		defaultProvider?: string;
		defaultModel?: string;
	};
	assert.equal(settings.defaultProvider, "google");
	assert.equal(settings.defaultModel, "gemini-3-pro-preview");
});

test("resolveModelProviderForCommand falls back to API-key providers when OAuth is unavailable", () => {
	const authPath = createAuthPath({});

	const resolved = resolveModelProviderForCommand(authPath, "google");

	assert.equal(resolved?.kind, "api-key");
	assert.equal(resolved?.id, "google");
});

test("resolveModelProviderForCommand supports LM Studio as a first-class local provider", () => {
	const authPath = createAuthPath({});

	const resolved = resolveModelProviderForCommand(authPath, "lm-studio");

	assert.equal(resolved?.kind, "api-key");
	assert.equal(resolved?.id, "lm-studio");
});

test("resolveModelProviderForCommand supports LiteLLM as a first-class proxy provider", () => {
	const authPath = createAuthPath({});

	const resolved = resolveModelProviderForCommand(authPath, "litellm");

	assert.equal(resolved?.kind, "api-key");
	assert.equal(resolved?.id, "litellm");
});

test("resolveModelProviderForCommand prefers OAuth when a provider supports both auth modes", () => {
	const authPath = createAuthPath({});

	const resolved = resolveModelProviderForCommand(authPath, "anthropic");

	assert.equal(resolved?.kind, "oauth");
	assert.equal(resolved?.id, "anthropic");
});

test("setDefaultModelSpec prefers the explicitly configured provider when a bare model id is ambiguous", () => {
	const authPath = createAuthPath({
		openai: { type: "api_key", key: "openai-test-key" },
	});
	const settingsPath = join(mkdtempSync(join(tmpdir(), "feynman-settings-")), "settings.json");

	setDefaultModelSpec(settingsPath, authPath, "gpt-5.4");

	const settings = JSON.parse(readFileSync(settingsPath, "utf8")) as {
		defaultProvider?: string;
		defaultModel?: string;
	};
	assert.equal(settings.defaultProvider, "openai");
	assert.equal(settings.defaultModel, "gpt-5.4");
});

test("buildModelStatusSnapshotFromRecords flags an invalid current model and suggests a replacement", () => {
	const snapshot = buildModelStatusSnapshotFromRecords(
		[
			{ provider: "anthropic", id: "claude-opus-4-6" },
			{ provider: "openai", id: "gpt-5.4" },
		],
		[{ provider: "openai", id: "gpt-5.4" }],
		"anthropic/claude-opus-4-6",
	);

	assert.equal(snapshot.currentValid, false);
	assert.equal(snapshot.recommended, "openai/gpt-5.4");
	assert.ok(snapshot.guidance.some((line) => line.includes("Configured default model is unavailable")));
});

test("chooseRecommendedModel prefers MiniMax M2.7 over highspeed when that is the authenticated provider", () => {
	const envKeys = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GOOGLE_API_KEY", "GEMINI_API_KEY", "OPENROUTER_API_KEY"];
	const savedEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));

	for (const key of envKeys) {
		delete process.env[key];
	}

	try {
		const authPath = createAuthPath({
			minimax: { type: "api_key", key: "minimax-test-key" },
		});

		const recommendation = chooseRecommendedModel(authPath);

		assert.equal(recommendation?.spec, "minimax/MiniMax-M2.7");
	} finally {
		for (const [key, value] of Object.entries(savedEnv)) {
			if (value === undefined) {
				delete process.env[key];
			} else {
				process.env[key] = value;
			}
		}
	}
});

test("resolveInitialPrompt maps top-level research commands to Pi slash workflows", () => {
	const workflows = new Set([
		"lit",
		"watch",
		"jobs",
		"deepresearch",
		"review",
		"audit",
		"replicate",
		"compare",
		"draft",
		"autoresearch",
		"summarize",
		"log",
	]);
	assert.equal(resolveInitialPrompt("lit", ["tool-using", "agents"], undefined, workflows), "/lit tool-using agents");
	assert.equal(resolveInitialPrompt("watch", ["openai"], undefined, workflows), "/watch openai");
	assert.equal(resolveInitialPrompt("jobs", [], undefined, workflows), "/jobs");
	assert.equal(resolveInitialPrompt("deepresearch", ["scaling", "laws"], undefined, workflows), "/deepresearch scaling laws");
	assert.equal(resolveInitialPrompt("review", ["paper.md"], undefined, workflows), "/review paper.md");
	assert.equal(resolveInitialPrompt("audit", ["2401.12345"], undefined, workflows), "/audit 2401.12345");
	assert.equal(resolveInitialPrompt("replicate", ["chain-of-thought"], undefined, workflows), "/replicate chain-of-thought");
	assert.equal(resolveInitialPrompt("compare", ["tool", "use"], undefined, workflows), "/compare tool use");
	assert.equal(resolveInitialPrompt("draft", ["mechanistic", "interp"], undefined, workflows), "/draft mechanistic interp");
	assert.equal(resolveInitialPrompt("autoresearch", ["gsm8k"], undefined, workflows), "/autoresearch gsm8k");
	assert.equal(resolveInitialPrompt("summarize", ["README.md"], undefined, workflows), "/summarize README.md");
	assert.equal(resolveInitialPrompt("log", [], undefined, workflows), "/log");
	assert.equal(resolveInitialPrompt("chat", ["hello"], undefined, workflows), "hello");
	assert.equal(resolveInitialPrompt("unknown", ["topic"], undefined, workflows), "unknown topic");
});

test("appendWorkflowFlagPositionals preserves summarize CLI flags parsed after positionals", () => {
	assert.deepEqual(
		appendWorkflowFlagPositionals("summarize", ["paper.md"], {
			"window-size": "2000",
			overlap: "200",
			"tier1-threshold": "8000",
			"tier2-threshold": "20000",
		}),
		["paper.md", "--window-size", "2000", "--overlap", "200", "--tier1-threshold", "8000", "--tier2-threshold", "20000"],
	);
	assert.deepEqual(appendWorkflowFlagPositionals("review", ["paper.md"], { "window-size": "2000" }), ["paper.md"]);
});

test("resolveThinkingConfig only passes launch thinking when explicitly configured", () => {
	assert.deepEqual(resolveThinkingConfig(undefined), {
		defaultThinkingLevel: "medium",
		launchThinkingLevel: undefined,
	});
	assert.deepEqual(resolveThinkingConfig("high"), {
		defaultThinkingLevel: "high",
		launchThinkingLevel: "high",
	});
	assert.deepEqual(resolveThinkingConfig("not-a-level"), {
		defaultThinkingLevel: "medium",
		launchThinkingLevel: undefined,
	});
});

test("resolvePiPromptOptions keeps top-level workflows interactive when stdin is a tty", () => {
	const workflows = new Set(["deepresearch", "summarize"]);

	assert.deepEqual(resolvePiPromptOptions("deepresearch", ["BM25"], undefined, workflows), {
		initialPrompt: "/deepresearch BM25",
	});
	assert.deepEqual(resolvePiPromptOptions("chat", ["hello"], undefined, workflows), {
		initialPrompt: "hello",
	});
	assert.deepEqual(resolvePiPromptOptions(undefined, [], "hello", workflows), {
		oneShotPrompt: "hello",
	});
	assert.deepEqual(resolvePiPromptOptions(undefined, [], undefined, workflows), {});
});

test("shouldRunInteractiveSetup triggers on first run when no default model is configured", () => {
	const authPath = createAuthPath({});

	assert.equal(shouldRunInteractiveSetup(undefined, undefined, true, authPath), true);
});

test("shouldRunInteractiveSetup triggers when the configured default model is unavailable", () => {
	const authPath = createAuthPath({
		openai: { type: "api_key", key: "openai-test-key" },
	});

	assert.equal(shouldRunInteractiveSetup(undefined, "anthropic/claude-opus-4-6", true, authPath), true);
});

test("shouldRunInteractiveSetup skips onboarding when the configured default model is available", () => {
	const authPath = createAuthPath({
		openai: { type: "api_key", key: "openai-test-key" },
	});

	assert.equal(shouldRunInteractiveSetup(undefined, "openai/gpt-5.4", true, authPath), false);
});

test("shouldRunInteractiveSetup skips onboarding for explicit model overrides or non-interactive terminals", () => {
	const authPath = createAuthPath({
		openai: { type: "api_key", key: "openai-test-key" },
	});

	assert.equal(shouldRunInteractiveSetup("openai/gpt-5.4", undefined, true, authPath), false);
	assert.equal(shouldRunInteractiveSetup(undefined, undefined, false, authPath), false);
});

test("isLocalModelProvider flags known local provider ids without consulting models.json", () => {
	const authPath = createAuthPath({});
	assert.equal(isLocalModelProvider(authPath, "ollama"), true);
	assert.equal(isLocalModelProvider(authPath, "lm-studio"), true);
	assert.equal(isLocalModelProvider(authPath, "vllm"), true);
	assert.equal(isLocalModelProvider(authPath, "anthropic"), false);
	assert.equal(isLocalModelProvider(authPath, ""), false);
});

test("isLocalModelProvider flags custom providers whose models.json baseUrl points at localhost", () => {
	const authPath = createAuthPath({});
	const modelsJsonPath = join(authPath, "..", "models.json");
	writeFileSync(
		modelsJsonPath,
		JSON.stringify({
			providers: {
				"my-proxy": { baseUrl: "http://127.0.0.1:8000/v1" },
				openrouter: { baseUrl: "https://openrouter.ai/api/v1" },
			},
		}) + "\n",
		"utf8",
	);

	assert.equal(isLocalModelProvider(authPath, "my-proxy"), true);
	assert.equal(isLocalModelProvider(authPath, "openrouter"), false);
});

test("buildLocalModelWorkflowNotice names the configured model and the workflow", () => {
	const notice = buildLocalModelWorkflowNotice("ollama/gemma4:latest", "deepresearch");
	assert.ok(notice.includes("ollama/gemma4:latest"));
	assert.ok(notice.includes("/deepresearch"));
	assert.ok(notice.includes("feynman model set"));
});
