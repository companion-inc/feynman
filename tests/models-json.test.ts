import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ATLASCLOUD_PROVIDER_CONFIG, getAtlasCloudProviderSetup } from "../src/model/commands.js";
import { upsertProviderConfig } from "../src/model/models-json.js";

test("upsertProviderConfig creates models.json and merges provider config", () => {
	const dir = mkdtempSync(join(tmpdir(), "feynman-models-"));
	const modelsPath = join(dir, "models.json");

	const first = upsertProviderConfig(modelsPath, "custom", {
		baseUrl: "http://localhost:11434/v1",
		apiKey: "ollama",
		api: "openai-completions",
		authHeader: true,
		models: [{ id: "llama3.1:8b" }],
	});
	assert.deepEqual(first, { ok: true });

	const second = upsertProviderConfig(modelsPath, "custom", {
		baseUrl: "http://localhost:9999/v1",
	});
	assert.deepEqual(second, { ok: true });

	const parsed = JSON.parse(readFileSync(modelsPath, "utf8")) as any;
	assert.equal(parsed.providers.custom.baseUrl, "http://localhost:9999/v1");
	assert.equal(parsed.providers.custom.api, "openai-completions");
	assert.equal(parsed.providers.custom.authHeader, true);
	assert.deepEqual(parsed.providers.custom.models, [{ id: "llama3.1:8b" }]);
});

test("upsertProviderConfig writes LiteLLM proxy config with master key", () => {
	const dir = mkdtempSync(join(tmpdir(), "feynman-litellm-"));
	const modelsPath = join(dir, "models.json");

	const result = upsertProviderConfig(modelsPath, "litellm", {
		baseUrl: "http://localhost:4000/v1",
		apiKey: "LITELLM_MASTER_KEY",
		api: "openai-completions",
		authHeader: true,
		models: [{ id: "gpt-4o" }],
	});
	assert.deepEqual(result, { ok: true });

	const parsed = JSON.parse(readFileSync(modelsPath, "utf8")) as any;
	assert.equal(parsed.providers.litellm.baseUrl, "http://localhost:4000/v1");
	assert.equal(parsed.providers.litellm.apiKey, "LITELLM_MASTER_KEY");
	assert.equal(parsed.providers.litellm.api, "openai-completions");
	assert.equal(parsed.providers.litellm.authHeader, true);
	assert.deepEqual(parsed.providers.litellm.models, [{ id: "gpt-4o" }]);
});

test("upsertProviderConfig writes LiteLLM proxy config without master key", () => {
	const dir = mkdtempSync(join(tmpdir(), "feynman-litellm-"));
	const modelsPath = join(dir, "models.json");

	const result = upsertProviderConfig(modelsPath, "litellm", {
		baseUrl: "http://localhost:4000/v1",
		apiKey: "local",
		api: "openai-completions",
		authHeader: false,
		models: [{ id: "llama3" }],
	});
	assert.deepEqual(result, { ok: true });

	const parsed = JSON.parse(readFileSync(modelsPath, "utf8")) as any;
	assert.equal(parsed.providers.litellm.baseUrl, "http://localhost:4000/v1");
	assert.equal(parsed.providers.litellm.apiKey, "local");
	assert.equal(parsed.providers.litellm.api, "openai-completions");
	assert.equal(parsed.providers.litellm.authHeader, false);
	assert.deepEqual(parsed.providers.litellm.models, [{ id: "llama3" }]);
});

test("Atlas Cloud setup maps to OpenAI-compatible provider config", () => {
	const setup = getAtlasCloudProviderSetup();
	assert.equal(setup.providerId, "atlascloud");
	assert.equal(setup.baseUrl, "https://api.atlascloud.ai/v1");
	assert.equal(setup.api, "openai-completions");
	assert.equal(setup.apiKeyConfig, "ATLASCLOUD_API_KEY");
	assert.equal(setup.authHeader, true);
	assert.deepEqual(setup.modelIds, [...ATLASCLOUD_PROVIDER_CONFIG.modelIds]);

	const dir = mkdtempSync(join(tmpdir(), "feynman-atlascloud-"));
	const modelsPath = join(dir, "models.json");

	const result = upsertProviderConfig(modelsPath, setup.providerId, {
		baseUrl: setup.baseUrl,
		apiKey: setup.apiKeyConfig,
		api: setup.api,
		authHeader: setup.authHeader,
		models: setup.modelIds.map((id) => ({ id })),
	});
	assert.deepEqual(result, { ok: true });

	const parsed = JSON.parse(readFileSync(modelsPath, "utf8")) as any;
	assert.equal(parsed.providers.atlascloud.baseUrl, "https://api.atlascloud.ai/v1");
	assert.equal(parsed.providers.atlascloud.apiKey, "ATLASCLOUD_API_KEY");
	assert.equal(parsed.providers.atlascloud.api, "openai-completions");
	assert.equal(parsed.providers.atlascloud.authHeader, true);
	assert.deepEqual(parsed.providers.atlascloud.models, [
		{ id: "qwen/qwen3.5-flash" },
		{ id: "deepseek-ai/deepseek-v4-pro" },
	]);
});

test("upsertProviderConfig rejects provider ids with path traversal chars", () => {
	const dir = mkdtempSync(join(tmpdir(), "feynman-models-"));
	const modelsPath = join(dir, "models.json");

	const withDots = upsertProviderConfig(modelsPath, "../etc/passwd", {
		baseUrl: "http://localhost:11434/v1",
	});
	assert.equal(withDots.ok, false);
	assert.ok(withDots.ok === false && "error" in withDots);

	const withSlash = upsertProviderConfig(modelsPath, "foo/bar", {
		baseUrl: "http://localhost:11434/v1",
	});
	assert.equal(withSlash.ok, false);
});
