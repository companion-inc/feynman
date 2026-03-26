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
