import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { Tool, ToolCall } from "@earendil-works/pi-ai";
import { validateToolArguments } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { registerAlphaTools } from "../extensions/research-tools/alpha.js";
import { registerModelEndpointTools } from "../extensions/research-tools/model-endpoints.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const researchToolsRoot = join(repoRoot, "extensions", "research-tools");
const coordinatedTypeboxVersion = "1.3.27";

function readJson(path: string): Record<string, any> {
	return JSON.parse(readFileSync(path, "utf8")) as Record<string, any>;
}

test("research extension source and direct locks use Pi's coordinated TypeBox package", () => {
	const sourceFiles = readdirSync(researchToolsRoot)
		.filter((name) => name.endsWith(".ts"))
		.map((name) => join(researchToolsRoot, name));
	const typeboxSources = sourceFiles.filter((path) => readFileSync(path, "utf8").includes('from "typebox"'));
	const legacySources = sourceFiles.filter((path) => readFileSync(path, "utf8").includes("@sinclair/typebox"));

	assert.deepEqual(
		typeboxSources.map((path) => path.slice(researchToolsRoot.length + 1)).sort(),
		[
			"alpha.ts",
			"chemistry-sketcher.ts",
			"huggingface.ts",
			"model-endpoints.ts",
			"science-databases.ts",
			"workbench-connectors.ts",
			"workbench-context.ts",
		],
	);
	assert.deepEqual(legacySources, []);

	const manifest = readJson(join(repoRoot, "package.json"));
	const rootLock = readJson(join(repoRoot, "package-lock.json"));
	const runtimeLock = readJson(join(repoRoot, ".feynman", "runtime-package-lock.json"));

	assert.equal(manifest.dependencies.typebox, coordinatedTypeboxVersion);
	assert.equal(manifest.dependencies["@sinclair/typebox"], undefined);
	assert.equal(rootLock.packages[""].dependencies.typebox, coordinatedTypeboxVersion);
	assert.equal(rootLock.packages[""].dependencies["@sinclair/typebox"], undefined);
	assert.equal(rootLock.packages["node_modules/typebox"].version, coordinatedTypeboxVersion);
	assert.equal(rootLock.packages["node_modules/@sinclair/typebox"], undefined);
	assert.equal(runtimeLock.packages[""].dependencies.typebox, coordinatedTypeboxVersion);
	assert.equal(runtimeLock.packages["node_modules/typebox"].version, coordinatedTypeboxVersion);
});

test("Pi runtime validation omits null alpha_get_paper sections without losing optional arrays", () => {
	const tools = new Map<string, Tool>();
	registerAlphaTools({
		registerTool(tool) {
			tools.set(tool.name, tool);
		},
	} as ExtensionAPI);

	const tool = tools.get("alpha_get_paper");
	assert.ok(tool);
	const providerSchema = JSON.parse(JSON.stringify(tool.parameters)) as {
		required?: string[];
		properties?: { sections?: Record<string, unknown> };
	};
	assert.deepEqual(providerSchema.required, ["paper"]);
	assert.equal(providerSchema.properties?.sections?.type, "array");
	assert.equal(providerSchema.properties?.sections?.uniqueItems, undefined);

	const validate = (arguments_: Record<string, unknown>) =>
		validateToolArguments(tool, {
			type: "toolCall",
			id: "typebox-regression",
			name: tool.name,
			arguments: arguments_,
		} satisfies ToolCall);

	assert.deepEqual(validate({ paper: "2401.00001" }), { paper: "2401.00001" });
	assert.deepEqual(validate({ paper: "2401.00001", sections: ["methodology", "results"] }), {
		paper: "2401.00001",
		sections: ["methodology", "results"],
	});
	assert.deepEqual(validate({ paper: "2401.00001", sections: null }), {
		paper: "2401.00001",
	});
	assert.throws(
		() => validate({ paper: "2401.00001", sections: "methodology" }),
		/Validation failed for tool "alpha_get_paper":[\s\S]*sections: must be array/,
	);
});

test("Pi runtime validation omits null AlphaFold2 databases without losing optional arrays", () => {
	const tools = new Map<string, Tool>();
	registerModelEndpointTools({
		registerTool(tool) {
			tools.set(tool.name, tool);
		},
	} as ExtensionAPI);

	const tool = tools.get("feynman_model_endpoint_call");
	assert.ok(tool);
	const validate = (arguments_: Record<string, unknown>) =>
		validateToolArguments(tool, {
			type: "toolCall",
			id: "typebox-model-endpoint-regression",
			name: tool.name,
			arguments: arguments_,
		} satisfies ToolCall);
	const required = {
		provider: "nvidia-bionemo",
		model: "alphafold2",
		sequence: "MSTNPKPQR",
	};

	assert.deepEqual(validate(required), required);
	assert.deepEqual(validate({ ...required, databases: ["uniref90", "mgnify"] }), {
		...required,
		databases: ["uniref90", "mgnify"],
	});
	assert.deepEqual(validate({ ...required, databases: null }), required);
	assert.throws(
		() => validate({ ...required, databases: "uniref90" }),
		/Validation failed for tool "feynman_model_endpoint_call":[\s\S]*databases: must be array/,
	);
});
