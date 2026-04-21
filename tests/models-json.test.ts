import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
