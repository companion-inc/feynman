import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveInitialPrompt } from "../src/cli.js";
import { buildModelStatusSnapshotFromRecords, chooseRecommendedModel } from "../src/model/catalog.js";
import { setDefaultModelSpec } from "../src/model/commands.js";

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

test("resolveInitialPrompt maps top-level research commands to Pi slash workflows", () => {
	const workflows = new Set(["lit", "watch", "jobs", "deepresearch"]);
	assert.equal(resolveInitialPrompt("lit", ["tool-using", "agents"], undefined, workflows), "/lit tool-using agents");
	assert.equal(resolveInitialPrompt("watch", ["openai"], undefined, workflows), "/watch openai");
	assert.equal(resolveInitialPrompt("jobs", [], undefined, workflows), "/jobs");
	assert.equal(resolveInitialPrompt("chat", ["hello"], undefined, workflows), "hello");
	assert.equal(resolveInitialPrompt("unknown", ["topic"], undefined, workflows), "unknown topic");
});

test("chooseRecommendedModel recommends MiniMax-M2.7 when only MiniMax is authenticated", () => {
	const authPath = createAuthPath({
		minimax: { type: "api_key", key: "minimax-test-key" },
	});

	const recommendation = chooseRecommendedModel(authPath);

	assert.equal(recommendation?.spec, "minimax/MiniMax-M2.7");
});

test("buildModelStatusSnapshotFromRecords recommends minimax/MiniMax-M2.7 over minimax/MiniMax-M2.7-highspeed", () => {
	const snapshot = buildModelStatusSnapshotFromRecords(
		[
			{ provider: "minimax", id: "MiniMax-M2.7" },
			{ provider: "minimax", id: "MiniMax-M2.7-highspeed" },
		],
		[
			{ provider: "minimax", id: "MiniMax-M2.7" },
			{ provider: "minimax", id: "MiniMax-M2.7-highspeed" },
		],
		undefined,
	);

	assert.equal(snapshot.recommended, "minimax/MiniMax-M2.7");
});

