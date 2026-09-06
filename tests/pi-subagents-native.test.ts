import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { PI_SUBAGENTS_PATCH_TARGETS, patchPiSubagentsSource } from "../scripts/lib/pi-subagents-patch.mjs";
import { assertPiSubagentsNativeSources, PI_SUBAGENTS_NATIVE_MARKER } from "../scripts/lib/pi-subagents-native-patch.mjs";
import { verifyPiSubagentsNativeBehavior } from "../scripts/lib/pi-subagents-native-verification.mjs";

const appRoot = process.env.FEYNMAN_SUBAGENTS_TEST_APP_ROOT ?? resolve(import.meta.dirname, "..");
const runtime = resolve(appRoot, ".feynman/npm");
const root = resolve(runtime, "node_modules/pi-subagents");
const installedVersion = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")).version;
// These cases are native-layout specific; the existing suite keeps legacy tests.
const nativeTest = installedVersion === "0.65.1" ? test : test.skip;

nativeTest("0.65.1 exact native files are idempotent and complete", () => {
	assertPiSubagentsNativeSources((file) => readFileSync(resolve(root, file), "utf8"));
	for (const file of PI_SUBAGENTS_PATCH_TARGETS) {
		if (!existsSync(resolve(root, file))) continue;
		const source = readFileSync(resolve(root, file), "utf8");
		assert.equal(patchPiSubagentsSource(file, source), source, file);
	}
});

nativeTest("native patch rejects tampering rather than accepting markers or legacy rewrites", () => {
	for (const file of [
		"src/extension/tool-description.ts",
		"src/runs/shared/model-fallback.ts",
		"src/runs/foreground/execution.ts",
		"src/runs/background/run-child-session.ts",
	]) {
		const source = readFileSync(resolve(root, file), "utf8");
		assert.ok(source.startsWith(`// ${PI_SUBAGENTS_NATIVE_MARKER}\n`));
		assert.throws(() => patchPiSubagentsSource(file, `${source}\n// tampered`), /Modified pi-subagents/);
		assert.throws(() => assertPiSubagentsNativeSources((path) => readFileSync(resolve(root, path), "utf8") + (path === file ? "\n" : "")), /unreviewed or unpatched/);
	}
});

nativeTest("native foreground/background lifecycle preserves research model safety without providers", async () => {
	const require = createRequire(resolve(runtime, "package.json"));
	const { createJiti } = await import(pathToFileURL(require.resolve("jiti")).href);
	const jiti = createJiti(import.meta.url, { moduleCache: false, fsCache: false });
	assert.deepEqual(await verifyPiSubagentsNativeBehavior(root, jiti), { nativeLifecycleCases: 16, providerRequests: 0 });
});

nativeTest("upstream native diagnostics and canonical error boundaries remain present without duplicate shims", () => {
	for (const file of ["src/extension/fanout-child.ts", "src/runs/background/wait-tool.ts"]) {
		const source = readFileSync(resolve(root, file), "utf8");
		assert.match(source, /import \{ finalizeToolResult \}/);
		assert.doesNotMatch(source, /function finalizeToolResult</);
	}
	const source = readFileSync(resolve(root, "src/agents/agents.ts"), "utf8");
	assert.match(source, /export function findBlockingAgentDiagnostic/);
	assert.ok(source.split("if (!packageMap.has(agent.name)) packageMap.set(agent.name, agent);").length >= 3);
});

nativeTest("research prompt and docs examples validate and collect failed children on the exact workflow engine", async () => {
	const require = createRequire(resolve(runtime, "package.json"));
	const { createJiti } = await import(pathToFileURL(require.resolve("jiti")).href);
	const jiti = createJiti(import.meta.url, { moduleCache: false, fsCache: false });
	const workflows = await jiti.import(resolve(root, "src/workflows/scripted-workflow.ts"));
	const schema = (await jiti.import(resolve(root, "src/extension/schemas.ts"))).createSubagentParamsSchema();
	const repo = resolve(import.meta.dirname, "..");
	let examples = 0;
	for (const file of [
		"prompts/deepresearch.md",
		"prompts/summarize.md",
		"website/src/content/docs/reference/slash-commands.md",
	]) {
		const content = readFileSync(resolve(repo, file), "utf8");
		for (const match of content.matchAll(/```json\n([\s\S]*?)\n```/g)) {
			const call = JSON.parse(match[1]!);
			if (!call.workflowScript && !call.agent) continue;
			for (const key of Object.keys(call)) assert.ok(schema.properties[key], `${file}: unsupported ${key}`);
			assert.equal(call.async, true);
			for (const obsolete of ["tasks", "chain", "failFast", "concurrency"]) assert.equal(call[obsolete], undefined);
			if (!call.workflowScript) continue;
			assert.deepEqual(workflows.validateWorkflowScript(call.workflowScript), { ok: true, errors: [] });
			const launched: string[] = [];
			const result = await workflows.runWorkflowScript({
				script: call.workflowScript, globalConcurrencyLimit: call.globalConcurrencyLimit,
				launch: async (key: string, params: Record<string, unknown>) => {
					assert.equal(params.agent, "researcher");
					assert.equal(typeof params.output, "string");
					launched.push(key);
					return { key, ok: false, output: "", error: "fixture source unavailable", artifactPaths: [] };
				},
				status: async () => { throw new Error("Example must not poll"); },
			});
			assert.ok(launched.length > 0);
			assert.deepEqual(result.value.map((child: { key: string }) => child.key), launched);
			assert.ok(result.value.every((child: { ok: boolean }) => child.ok === false));
			if (file.endsWith("summarize.md")) assert.match(call.workflowScript, /Do NOT use web_search or fetch external URLs/);
			examples++;
		}
	}
	assert.equal(examples, 3);
	const commands = await import(pathToFileURL(resolve(repo, "metadata/commands.mjs")).href);
	const advertised = commands.livePackageCommandGroups.find((group: { title: string }) => group.title === "Agents & Delegation").commands;
	assert.deepEqual(advertised.map((command: { name: string }) => command.name), ["subagents", "run"]);
	const slashSource = readFileSync(resolve(root, "src/slash/slash-commands.ts"), "utf8");
	for (const command of advertised) assert.ok(slashSource.includes(`pi.registerCommand("${command.name}"`));
});
