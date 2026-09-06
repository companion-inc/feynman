import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { PI_SUBAGENTS_PATCH_TARGETS, patchPiSubagentsSource, stripPiSubagentBuiltinModelSource } from "../scripts/lib/pi-subagents-patch.mjs";
import {
	assertPiSubagentCorrectnessSources,
	assertPiSubagentUsageLimitFallbackSource,
	verifyPiSubagentUsageLimitFallbackBehavior,
} from "../scripts/lib/pi-subagents-verification.mjs";

// Frozen 0.40-era minimal prompt surface: do not derive legacy tests from installed latest.
const LEGACY_TOOL_DESCRIPTION_SOURCE = [
	'import type { ExtensionConfig, ToolDescriptionMode } from "../shared/types.ts";',
	'const CUSTOM_TOOL_DESCRIPTION_FILE = "subagent-tool-description.md";',
	"const CUSTOM_TOOL_DESCRIPTION_MAX_BYTES = 50 * 1024;",
	"export const FULL_SUBAGENT_TOOL_DESCRIPTION = `full`;",
	"export const COMPACT_SUBAGENT_TOOL_DESCRIPTION = `compact`;",
	"export interface ToolDescriptionOptions {",
	"\tcwd?: string;",
	"\tagentDir?: string;",
	"\twarn?: (message: string) => void;",
	"}",
	"",
	'export function resolveToolDescriptionMode(config: Pick<ExtensionConfig, "toolDescriptionMode">, options?: ToolDescriptionOptions): ToolDescriptionMode {',
	'\treturn config.toolDescriptionMode ?? "full";',
	"}",
	"",
	'export function buildSubagentToolDescription(config: Pick<ExtensionConfig, "toolDescriptionMode"> = {}, options?: ToolDescriptionOptions): string {',
	"\tconst mode = resolveToolDescriptionMode(config, options);",
	'\treturn mode === "compact" ? COMPACT_SUBAGENT_TOOL_DESCRIPTION : FULL_SUBAGENT_TOOL_DESCRIPTION;',
	"}",
].join("\n");

function assertUserDirLoadsHaveDeclaration(source: string): void {
	for (const chunk of source.split(/\n(?=export function |function )/)) {
		if (!/load(?:Agents|Chains)FromDir\(userDir, "user"\)/.test(chunk)) continue;
		assert.match(chunk, /\bconst userDir\b/);
	}
}

const CASES = [
	{
		name: "index.ts config path",
		file: "index.ts",
		input: [
			'import * as os from "node:os";',
			'import * as path from "node:path";',
			'const configPath = path.join(os.homedir(), ".pi", "agent", "extensions", "subagent", "config.json");',
			"",
		].join("\n"),
		original: 'const configPath = path.join(os.homedir(), ".pi", "agent", "extensions", "subagent", "config.json");',
		expected: 'const configPath = path.join(resolvePiAgentDir(), "extensions", "subagent", "config.json");',
	},
	{
		name: "agents.ts user agents dir",
		file: "agents.ts",
		input: [
			'import * as os from "node:os";',
			'import * as path from "node:path";',
			'const userDir = path.join(os.homedir(), ".pi", "agent", "agents");',
			"",
		].join("\n"),
		original: 'const userDir = path.join(os.homedir(), ".pi", "agent", "agents");',
		expected: 'const userDir = path.join(resolvePiAgentDir(), "agents");',
	},
	{
		name: "artifacts.ts sessions dir",
		file: "artifacts.ts",
		input: [
			'import * as os from "node:os";',
			'import * as path from "node:path";',
			'const sessionsBase = path.join(os.homedir(), ".pi", "agent", "sessions");',
			"",
		].join("\n"),
		original: 'const sessionsBase = path.join(os.homedir(), ".pi", "agent", "sessions");',
		expected: 'const sessionsBase = path.join(resolvePiAgentDir(), "sessions");',
	},
	{
		name: "run-history.ts history file",
		file: "run-history.ts",
		input: [
			'import * as os from "node:os";',
			'import * as path from "node:path";',
			'const HISTORY_PATH = path.join(os.homedir(), ".pi", "agent", "run-history.jsonl");',
			"",
		].join("\n"),
		original: 'const HISTORY_PATH = path.join(os.homedir(), ".pi", "agent", "run-history.jsonl");',
		expected: 'const HISTORY_PATH = path.join(resolvePiAgentDir(), "run-history.jsonl");',
	},
	{
		name: "skills.ts agent dir",
		file: "skills.ts",
		input: [
			'import * as os from "node:os";',
			'import * as path from "node:path";',
			'const AGENT_DIR = path.join(os.homedir(), ".pi", "agent");',
			"",
		].join("\n"),
		original: 'const AGENT_DIR = path.join(os.homedir(), ".pi", "agent");',
		expected: "const AGENT_DIR = resolvePiAgentDir();",
	},
	{
		name: "chain-clarify.ts chain save dir",
		file: "chain-clarify.ts",
		input: [
			'import * as os from "node:os";',
			'import * as path from "node:path";',
			'const dir = path.join(os.homedir(), ".pi", "agent", "agents");',
			"",
		].join("\n"),
		original: 'const dir = path.join(os.homedir(), ".pi", "agent", "agents");',
		expected: 'const dir = path.join(resolvePiAgentDir(), "agents");',
	},
];

for (const scenario of CASES) {
	test(`patchPiSubagentsSource rewrites ${scenario.name}`, () => {
		const patched = patchPiSubagentsSource(scenario.file, scenario.input);

		assert.match(patched, /function resolvePiAgentDir\(\): string \{/);
		assert.match(patched, /process\.env\.FEYNMAN_CODING_AGENT_DIR\?\.trim\(\) \|\| process\.env\.PI_CODING_AGENT_DIR\?\.trim\(\)/);
		assert.ok(patched.includes(scenario.expected));
		assert.ok(!patched.includes(scenario.original));
	});
}

test("PI_SUBAGENTS_PATCH_TARGETS covers current pi-subagents source paths", () => {
	assert.deepEqual(
		[
			"src/extension/index.ts",
			"src/extension/tool-description.ts",
			"src/agents/agents.ts",
			"src/agents/agent-management.ts",
			"src/api/preflight.ts",
			"src/extension/doctor.ts",
			"src/slash/slash-commands.ts",
			"src/shared/artifacts.ts",
			"src/runs/shared/run-history.ts",
			"src/agents/skills.ts",
			"src/runs/foreground/chain-clarify.ts",
			"src/runs/shared/pi-spawn.ts",
			"src/runs/shared/model-fallback.ts",
			"src/runs/foreground/execution.ts",
			"src/runs/foreground/chain-execution.ts",
			"src/runs/background/async-execution.ts",
			"src/runs/background/subagent-runner.ts",
			"src/runs/background/async-resume.ts",
			"src/runs/shared/parallel-utils.ts",
			"src/runs/background/chain-root-attachment.ts",
			"src/runs/background/stale-run-reconciler.ts",
			"src/runs/background/async-status.ts",
			"src/shared/types.ts",
			"src/extension/fanout-child.ts",
			"src/runs/background/wait-tool.ts",
			"src/runs/foreground/subagent-executor.ts",
			"src/extension/schemas.ts",
		].filter((entry) => !PI_SUBAGENTS_PATCH_TARGETS.includes(entry)),
		[],
	);
});

test("patchPiSubagentsSource replaces registry-gated model verification with exact provider identity checks", () => {
	const weakHelper = [
		"export function splitThinkingSuffix(model: string) {",
		"\treturn model;",
		"}",
		"",
		"export function formatSubagentModelVerificationError(expectedModel: string, observedModel: string, availableModels: AvailableModelInfo[] | undefined): string | undefined {",
		"\tif (!availableModels || availableModels.length === 0) return undefined;",
		"\tconst expectedBase = splitThinkingSuffix(expectedModel).baseModel;",
		"\tconst observedBase = splitThinkingSuffix(observedModel).baseModel;",
		"\tif (!availableModels.some((entry) => entry.fullId === observedBase)) return undefined;",
		"\tif (expectedBase === observedBase) return undefined;",
		"\treturn `model_verification_failed: child reported a different model than the launch candidate. Expected '${expectedModel}' but observed '${observedModel}'.`;",
		"}",
		"",
		"/** Sentinel model value requesting that a subagent inherit the parent session's model. */",
		'export const INHERIT_MODEL = "inherit";',
	].join("\n");
	const patched = patchPiSubagentsSource("src/runs/shared/model-fallback.ts", weakHelper);

	assert.match(patched, /parseExpectedSubagentModelIdentity/);
	assert.match(patched, /observedProvider: unknown,/);
	assert.match(patched, /observedModel: unknown,/);
	assert.match(patched, /availableModels\?: AvailableModelInfo\[\]/);
	assert.match(patched, /expected\.provider === provider/);
	assert.match(patched, /expected\.model === model/);
	assert.match(
		patched,
		/typeof observedProvider === "string" \? observedProvider : ""/,
	);
	assert.match(
		patched,
		/typeof observedModel === "string" \? observedModel : ""/,
	);
	assert.doesNotMatch(patched, /observedProvider\.trim\(\)/);
	assert.doesNotMatch(patched, /observedModel\.trim\(\)/);
	assert.match(patched, /entry\.fullId === requested/);
	assert.match(patched, /entry\.fullId === expectedBase/);
	assert.match(patched, /<missing-provider>/);
	assert.match(patched, /<missing-model>/);
	assert.match(patched, /\["off", "minimal", "low", "medium", "high", "xhigh", "max"\]/);
	assert.doesNotMatch(patched, /requested\.toLowerCase/);
	assert.doesNotMatch(patched, /expectedBase\.toLowerCase/);
	assert.doesNotMatch(patched, /model\.slice\(colonIndex \+ 1\)\.toLowerCase/);
	assert.doesNotMatch(patched, /availableModels\.some/);
	assert.equal(patchPiSubagentsSource("src/runs/shared/model-fallback.ts", patched), patched);
});

test("patchPiSubagentsSource keeps parent-model metadata out of fork model resolver arguments", () => {
	const input = [
		"const options = {",
		"\tmodelOverride,",
		"\tthinkingOverride: delegatedThinkingOverride,",
		"};",
		"const primaryModel = resolveEffectiveSubagentModel(",
		"\tmodelOverride,",
		"\tmodelOverrideFromParent,",
		"\tagentConfig?.model,",
		"\tparentModel,",
		");",
	].join("\n");

	const patched = patchPiSubagentsSource(
		"src/runs/foreground/subagent-executor.ts",
		input,
	);

	assert.match(
		patched,
		/\tmodelOverride,\n\tmodelOverrideFromParent,\n\tthinkingOverride:/,
	);
	assert.match(
		patched,
		/resolveEffectiveSubagentModel\(\n\tmodelOverride,\n\tagentConfig\?\.model,/,
	);
	assert.doesNotMatch(
		patched,
		/resolveEffectiveSubagentModel\(\n\tmodelOverride,\n\tmodelOverrideFromParent,/,
	);
	assert.equal(
		patchPiSubagentsSource(
			"src/runs/foreground/subagent-executor.ts",
			patched,
		),
		patched,
	);
});

test("current pi-subagents identity patches are exact idempotent fixed points", () => {
	const appRoot = process.env.FEYNMAN_SUBAGENTS_TEST_APP_ROOT ?? resolve(import.meta.dirname, "..");
	const subagentsRoot = resolve(
		appRoot,
		".feynman",
		"npm",
		"node_modules",
		"pi-subagents",
	);
	for (const relativePath of [
		"src/runs/shared/model-fallback.ts",
		"src/runs/foreground/execution.ts",
		"src/runs/foreground/chain-execution.ts",
		"src/runs/foreground/subagent-executor.ts",
		"src/runs/background/async-execution.ts",
		"src/runs/background/subagent-runner.ts",
		"src/runs/background/async-resume.ts",
		"src/runs/shared/parallel-utils.ts",
		"src/shared/types.ts",
	]) {
		// 0.65 routes sequential orchestration through workflows, not chain-execution.ts.
		if (relativePath.endsWith("/chain-execution.ts") && !existsSync(resolve(subagentsRoot, relativePath))) {
			assert.equal(JSON.parse(readFileSync(resolve(subagentsRoot, "package.json"), "utf8")).version, "0.65.1");
			continue;
		}
		const source = readFileSync(resolve(subagentsRoot, relativePath), "utf8");
		const patched = patchPiSubagentsSource(relativePath, source);
		assert.equal(
			patchPiSubagentsSource(relativePath, patched),
			patched,
			`${relativePath} patch is not idempotent`,
		);
		if (relativePath === "src/runs/foreground/subagent-executor.ts") {
			assert.doesNotMatch(
				patched,
				/resolveEffectiveSubagentModel\(\s*modelOverride,\s*modelOverrideFromParent,/s,
				"model inheritance metadata must not alter a resolver argument list",
			);
		}
	}
});

test("patched installed pi-subagents carries model identity, context overflow, backfilled tool completion, and logical failures end to end", async () => {
	const appRoot = process.env.FEYNMAN_SUBAGENTS_TEST_APP_ROOT ?? resolve(import.meta.dirname, "..");
	const subagentsRoot = resolve(
		appRoot,
		".feynman",
		"npm",
		"node_modules",
		"pi-subagents",
	);
	assert.doesNotThrow(() =>
		assertPiSubagentCorrectnessSources(
			(relativePath) => readFileSync(resolve(subagentsRoot, relativePath), "utf8"),
			"focused installed runtime",
		),
	);
	await verifyPiSubagentUsageLimitFallbackBehavior(appRoot);
});

test("installed pi-subagents verifier launches mock Pi scripts through Node on every platform", () => {
	const source = readFileSync(
		resolve(import.meta.dirname, "..", "scripts", "lib", "pi-subagents-verification.mjs"),
		"utf8",
	);
	assert.match(source, /process\.env\.FEYNMAN_PI_CLI_PATH = mockPath/);
	assert.doesNotMatch(source, /#!\/bin\/sh/);
	assert.doesNotMatch(source, /process\.env\.PI_SUBAGENT_PI_BINARY =/);
});

test("patchPiSubagentsSource retries provider subscription usage limits", async () => {
	const input = [
		"const RETRYABLE_MODEL_FAILURE_PATTERNS = [",
		"\t/rate\\s*limit/i,",
		"\t/too many requests/i,",
		"];",
	].join("\n");
	const patched = patchPiSubagentsSource("src/runs/shared/model-fallback.ts", input);

	assert.ok(patched.includes("/usage\\s*limit/i"));
	assert.equal(patchPiSubagentsSource("src/runs/shared/model-fallback.ts", patched), patched);

	const executable = [
		patched,
		"export function isRetryableModelFailure(error) {",
		"\treturn RETRYABLE_MODEL_FAILURE_PATTERNS.some((pattern) => pattern.test(error));",
		"}",
	].join("\n");
	const patchedModule = await import(`data:text/javascript,${encodeURIComponent(executable)}`);
	assert.equal(patchedModule.isRetryableModelFailure("The usage limit has been reached"), true);
	assert.equal(patchedModule.isRetryableModelFailure("ordinary tool failure"), false);

	assert.throws(
		() => assertPiSubagentUsageLimitFallbackSource(
			() => `// /usage\\\\s*limit/i\n${input}`,
			"comment-only pi-subagents",
		),
		/does not retry provider usage-limit errors/,
	);
});

test("patchPiSubagentsSource rewrites current src paths", () => {
	const input = [
		'import * as os from "node:os";',
		'import * as path from "node:path";',
		'const configPath = path.join(os.homedir(), ".pi", "agent", "extensions", "subagent", "config.json");',
		"",
	].join("\n");

	const patched = patchPiSubagentsSource("src/extension/index.ts", input);

	assert.match(patched, /function resolvePiAgentDir\(\): string \{/);
	assert.match(patched, /path\.join\(resolvePiAgentDir\(\), "extensions", "subagent", "config\.json"\)/);
});

test("patchPiSubagentsSource registers split prompt metadata by default", () => {
	const toolDescription = LEGACY_TOOL_DESCRIPTION_SOURCE;
	const extensionIndex = [
		'import { buildSubagentToolDescription } from "./tool-description.ts";',
		"const tool = {",
		'\t\tdescription: buildSubagentToolDescription(config),',
		"\t\tparameters: SubagentParams,",
		"};",
	].join("\n");

	const patchedDescription = patchPiSubagentsSource("src/extension/tool-description.ts", toolDescription);
	const patchedIndex = patchPiSubagentsSource("src/extension/index.ts", extensionIndex);

	assert.match(patchedDescription, /feynman-pi-subagents-prompt-metadata-v2/);
	assert.match(patchedDescription, /Delegate to configured research subagents/);
	assert.match(patchedDescription, /run `feynman model list` first/);
	assert.match(patchedDescription, /exact approved provider\/model/);
	assert.match(patchedDescription, /Never pass a bare model id or an agent name/);
	assert.equal(
		patchedDescription.split(
			"Never pass a bare model id or an agent name as the model.",
		).length - 1,
		3,
	);
	assert.match(patchedDescription, /buildSubagentToolPromptMetadata/);
	assert.match(patchedDescription, /if \(config\.toolDescriptionMode === undefined\) return DEFAULT_SUBAGENT_TOOL_DESCRIPTION/);
	assert.match(patchedIndex, /\.\.\.buildSubagentToolPromptMetadata\(config\)/);
	assert.equal(patchPiSubagentsSource("src/extension/tool-description.ts", patchedDescription), patchedDescription);
	assert.equal(patchPiSubagentsSource("src/extension/index.ts", patchedIndex), patchedIndex);
	const guidance =
		"When a child needs an explicit model, run `feynman model list` first and copy an exact approved provider/model. Never pass a bare model id or an agent name as the model.";
	assert.throws(
		() => patchPiSubagentsSource(
			"src/extension/tool-description.ts",
			patchedDescription.replace(guidance, "Malformed selector guidance."),
		),
		/expected 1 prompt model selector guidance copy, found 0/,
	);
	assert.throws(
		() => patchPiSubagentsSource(
			"src/extension/tool-description.ts",
			patchedDescription.replace(guidance, `${guidance} ${guidance}`),
		),
		/expected 1 prompt model selector guidance copy, found 2/,
	);
	assert.throws(
		() => patchPiSubagentsSource(
			"src/extension/tool-description.ts",
			`${patchedDescription}\n// feynman-pi-subagents-prompt-metadata-v1`,
		),
		/expected 0 stale v1 patch markers, found 1/,
	);
	const descriptionGuidance = `\n\n• ${guidance.replaceAll("`", "\\`")}`;
	const compactStart = patchedDescription.indexOf(
		"export const COMPACT_SUBAGENT_TOOL_DESCRIPTION",
	);
	const compactGuidance = patchedDescription.indexOf(
		descriptionGuidance,
		compactStart,
	);
	const withoutCompactGuidance =
		patchedDescription.slice(0, compactGuidance) +
		patchedDescription.slice(compactGuidance + descriptionGuidance.length);
	const fullEnd = withoutCompactGuidance.indexOf(
		"`;",
		withoutCompactGuidance.indexOf("export const FULL_SUBAGENT_TOOL_DESCRIPTION"),
	);
	const relocatedGuidance =
		withoutCompactGuidance.slice(0, fullEnd) +
		descriptionGuidance +
		withoutCompactGuidance.slice(fullEnd);
	assert.throws(
		() => patchPiSubagentsSource(
			"src/extension/tool-description.ts",
			relocatedGuidance,
		),
		/FULL_SUBAGENT_TOOL_DESCRIPTION model selector guidance copy/,
	);
});

test("patchPiSubagentsSource upgrades v1 prompt metadata with approved model guidance", () => {
	const guidance =
		"When a child needs an explicit model, run `feynman model list` first and copy an exact approved provider/model. Never pass a bare model id or an agent name as the model.";
	const descriptionGuidance = guidance.replaceAll("`", "\\`");
	const currentRuntime = patchPiSubagentsSource("src/extension/tool-description.ts", LEGACY_TOOL_DESCRIPTION_SOURCE).replace(
		"feynman-pi-subagents-prompt-metadata-v2",
		"feynman-pi-subagents-prompt-metadata-v1",
	).replace(
		`\t${JSON.stringify(guidance)},\n`,
		"",
	).replaceAll(
		`\n\n• ${descriptionGuidance}`,
		"",
	);

	const patched = patchPiSubagentsSource(
		"src/extension/tool-description.ts",
		currentRuntime,
	);

	assert.match(patched, /feynman-pi-subagents-prompt-metadata-v2/);
	assert.doesNotMatch(patched, /feynman-pi-subagents-prompt-metadata-v1/);
	assert.match(patched, /run `feynman model list` first/);
	assert.equal(
		patched.split("Never pass a bare model id or an agent name as the model.").length - 1,
		3,
	);
	assert.equal(
		patchPiSubagentsSource("src/extension/tool-description.ts", patched),
		patched,
	);
	assert.throws(
		() => patchPiSubagentsSource(
			"src/extension/tool-description.ts",
			`${currentRuntime}\n// feynman-pi-subagents-prompt-metadata-v1`,
		),
		/expected 1 v1 patch marker, found 2/,
	);
});

test("patchPiSubagentsSource is idempotent", () => {
	const input = [
		'import * as os from "node:os";',
		'import * as path from "node:path";',
		'const configPath = path.join(os.homedir(), ".pi", "agent", "extensions", "subagent", "config.json");',
		"",
	].join("\n");

	const once = patchPiSubagentsSource("index.ts", input);
	const twice = patchPiSubagentsSource("index.ts", once);

	assert.equal(twice, once);
});

test("patchPiSubagentsSource rewrites old agents.ts discovery paths transactionally", () => {
	const input = [
		'import * as fs from "node:fs";',
		'import * as os from "node:os";',
		'import * as path from "node:path";',
		'export function discoverAgents(cwd: string, scope: AgentScope): AgentDiscoveryResult {',
		'\tconst userDirOld = path.join(os.homedir(), ".pi", "agent", "agents");',
		'\tconst userDirNew = path.join(os.homedir(), ".agents");',
		'\tconst userAgentsOld = scope === "project" ? [] : loadAgentsFromDir(userDirOld, "user");',
		'\tconst userAgentsNew = scope === "project" ? [] : loadAgentsFromDir(userDirNew, "user");',
		'\tconst userAgents = [...userAgentsOld, ...userAgentsNew];',
		'}',
		'export function discoverAgentsAll(cwd: string) {',
		'\tconst userDirOld = path.join(os.homedir(), ".pi", "agent", "agents");',
		'\tconst userDirNew = path.join(os.homedir(), ".agents");',
		'\tconst user = [',
		'\t\t...loadAgentsFromDir(userDirOld, "user"),',
		'\t\t...loadAgentsFromDir(userDirNew, "user"),',
		'\t];',
		'\tconst chains = [',
		'\t\t...loadChainsFromDir(userDirOld, "user"),',
		'\t\t...loadChainsFromDir(userDirNew, "user"),',
		'\t\t...(projectDir ? loadChainsFromDir(projectDir, "project") : []),',
		'\t];',
		'\tconst userDir = fs.existsSync(userDirNew) ? userDirNew : userDirOld;',
		'}',
	].join("\n");

	const patched = patchPiSubagentsSource("agents.ts", input);

	assert.match(patched, /function resolvePiAgentDir\(\): string \{/);
	assert.match(patched, /const userDir = path\.join\(resolvePiAgentDir\(\), "agents"\);/);
	assert.match(patched, /const userAgents = scope === "project" \? \[\] : loadAgentsFromDir\(userDir, "user"\);/);
	assert.equal((patched.match(/\bconst userDir\b/g) ?? []).length, 2);
	assertUserDirLoadsHaveDeclaration(patched);
	assert.ok(!patched.includes('loadAgentsFromDir(userDirOld, "user")'));
	assert.ok(!patched.includes('loadChainsFromDir(userDirNew, "user")'));
	assert.ok(!patched.includes('fs.existsSync(userDirNew) ? userDirNew : userDirOld'));
});

test("patchPiSubagentsSource leaves current getAgentDir agents.ts discovery paths native", () => {
	const input = [
		'import * as fs from "node:fs";',
		'import * as os from "node:os";',
		'import * as path from "node:path";',
		'import { getAgentDir } from "../shared/utils.ts";',
		'export function discoverAgents(cwd: string, scope: AgentScope): AgentDiscoveryResult {',
		'\tconst userDirOld = path.join(getAgentDir(), "agents");',
		'\tconst userDirNew = path.join(os.homedir(), ".agents");',
		'\tconst userAgentsOld = scope === "project" ? [] : loadAgentsFromDir(userDirOld, "user");',
		'\tconst userAgentsNew = scope === "project" ? [] : loadAgentsFromDir(userDirNew, "user");',
		'\tconst userAgents = [...userAgentsOld, ...userAgentsNew];',
		'}',
		'export function discoverAgentsAll(cwd: string) {',
		'\tconst userDirOld = path.join(getAgentDir(), "agents");',
		'\tconst userDirNew = path.join(os.homedir(), ".agents");',
		'\tconst user = [',
		'\t\t...loadAgentsFromDir(userDirOld, "user"),',
		'\t\t...loadAgentsFromDir(userDirNew, "user"),',
		'\t];',
		'\tconst userDir = process.env.PI_CODING_AGENT_DIR ? userDirOld : fs.existsSync(userDirNew) ? userDirNew : userDirOld;',
		'\treturn { userDir };',
		'}',
	].join("\n");

	const patched = patchPiSubagentsSource("agents.ts", input);

	assert.equal(patched, input);
	assert.doesNotMatch(patched, /resolvePiAgentDir/);
	assertUserDirLoadsHaveDeclaration(patched);
});

test("patchPiSubagentsSource upgrades legacy pi-subagents management diagnostics without crashing", () => {
	const input = [
		"import {",
		"\ttype AgentConfig,",
		"\ttype AgentScope,",
		"\ttype AgentSource,",
		"\ttype ChainConfig,",
		"\tdiscoverAgentsAll,",
		"\tbuildRuntimeName,",
		'} from "./agents.ts";',
		"function sanitizeName(name: string): string { return name; }",
		"function findChains(name: string, cwd: string, scope: AgentScope = \"both\"): ChainConfig[] { return []; }",
		"function mergeAgentsForScope(scope: AgentScope, user: AgentConfig[], project: AgentConfig[], builtin: AgentConfig[], pkg: AgentConfig[]): AgentConfig[] { return []; }",
		"function availableNames(cwd: string, kind: \"agent\"): string[] { return []; }",
		"function result(text: string, isError = false) { return { text, isError }; }",
		"export function handleList(params: ManagementParams, ctx: ManagementContext) {",
		"\tconst scope = normalizeListScope(params.agentScope) ?? \"both\";",
		"\tconst d = discoverAgentsAll(ctx.cwd);",
		"\tconst agents = [];",
		"\tconst chains = [];",
		"\tconst diagnostics = d.chainDiagnostics.filter((entry) => scope === \"both\" || entry.source === scope);",
		"\tconst lines = [",
		"\t\t\"Executable agents:\",",
		"\t\t...(diagnostics.length ? [",
		"\t\t\t\"\",",
		"\t\t\t\"Chain diagnostics:\",",
		"\t\t\t...diagnostics.map((entry) => `- ${entry.filePath}: ${entry.error}`),",
		"\t\t] : []),",
		"\t];",
		"\treturn result(lines.join(\"\\n\"));",
		"}",
		"function findAgents(name: string, cwd: string, scope: AgentScope = \"both\"): AgentConfig[] { return []; }",
		"function formatAgentDetail(agent: AgentConfig): string { return agent.name; }",
		"function findChainDetails(name: string, cwd: string, scope: AgentScope): ChainConfig[] { return []; }",
		"function formatChainDetail(chain: ChainConfig): string { return chain.name; }",
		"function handleGet(params: ManagementParams, ctx: ManagementContext) {",
		"\tconst scope = normalizeListScope(params.agentScope);",
		"\tconst hasBoth = Boolean(params.agent && params.chainName);",
		"\tconst blocks: string[] = [];",
		"\tlet anyFound = false;",
		"\tif (params.agent) {",
		"\t\tconst raw = params.agent.trim();",
		"\t\tconst sanitized = sanitizeName(raw);",
		"\t\tconst d = discoverAgentsAll(ctx.cwd);",
		"\t\tconst matches = mergeAgentsForScope(scope, d.user, d.project, d.builtin, d.package)",
		"\t\t\t.filter((agent) => agent.name === raw || agent.name === sanitized);",
		"\t\tif (!matches.length) {",
		"\t\t\tconst msg = `Agent '${params.agent}' not found. Available: ${availableNames(ctx.cwd, \"agent\").join(\", \") || \"none\"}.`;",
		"\t\t\tif (!hasBoth) return result(msg, true);",
		"\t\t\tblocks.push(msg);",
		"\t\t} else {",
		"\t\t\tanyFound = true;",
		"\t\t\tblocks.push(...matches.map(formatAgentDetail));",
		"\t\t}",
		"\t}",
		"}",
	].join("\n");

	const patched = patchPiSubagentsSource("src/agents/agent-management.ts", input);
	assert.match(patched, /Invalid agent definitions:/);
	assert.match(patched, /findBlockingAgentDiagnostic/);
	assert.match(patched, /has invalid configuration:/);
	assert.equal(patchPiSubagentsSource("src/agents/agent-management.ts", patched), patched);

	const compactInput = input.replace(
		[
			"\t\t...(diagnostics.length ? [",
			"\t\t\t\"\",",
			"\t\t\t\"Chain diagnostics:\",",
			"\t\t\t...diagnostics.map((entry) => `- ${entry.filePath}: ${entry.error}`),",
			"\t\t] : []),",
		].join("\n"),
		"\t\t...(diagnostics.length ? [\"\", \"Chain diagnostics:\", ...diagnostics.map((entry) => `- ${entry.filePath}: ${entry.error}`)] : []),",
	);
	const compactPatched = patchPiSubagentsSource("src/agents/agent-management.ts", compactInput);
	assert.match(compactPatched, /Invalid agent definitions:/);
	assert.equal(
		patchPiSubagentsSource("src/agents/agent-management.ts", compactPatched),
		compactPatched,
	);
});

test("patchPiSubagentsSource repairs current half-patched agents.ts userDir loads", () => {
	const input = [
		'import * as fs from "node:fs";',
		'import * as os from "node:os";',
		'import * as path from "node:path";',
		'import { getAgentDir } from "../shared/utils.ts";',
		'export function discoverAgents(cwd: string, scope: AgentScope): AgentDiscoveryResult {',
		'\tconst userDirOld = path.join(getAgentDir(), "agents");',
		'\tconst userDirNew = path.join(os.homedir(), ".agents");',
		'\tconst userAgents = scope === "project" ? [] : loadAgentsFromDir(userDir, "user");',
		'}',
		'export function discoverAgentsAll(cwd: string) {',
		'\tconst userDirOld = path.join(getAgentDir(), "agents");',
		'\tconst userDirNew = path.join(os.homedir(), ".agents");',
		'\tconst user = loadAgentsFromDir(userDir, "user");',
		'\tconst userDir = process.env.PI_CODING_AGENT_DIR ? userDirOld : fs.existsSync(userDirNew) ? userDirNew : userDirOld;',
		'\treturn { userDir };',
		'}',
	].join("\n");

	const patched = patchPiSubagentsSource("src/agents/agents.ts", input);

	assert.match(patched, /const userAgentsOld = scope === "project" \? \[\] : loadAgentsFromDir\(userDirOld, "user"\);/);
	assert.match(patched, /const userAgentsNew = scope === "project" \? \[\] : loadAgentsFromDir\(userDirNew, "user"\);/);
	assert.match(patched, /const user = \[\n\t\t\.\.\.loadAgentsFromDir\(userDirOld, "user"\),\n\t\t\.\.\.loadAgentsFromDir\(userDirNew, "user"\),\n\t\];/);
	assert.doesNotMatch(patched, /resolvePiAgentDir/);
	assertUserDirLoadsHaveDeclaration(patched);
});

test("patchPiSubagentsSource preserves output on top-level parallel tasks", () => {
	const input = [
		"interface TaskParam {",
		"\tagent: string;",
		"\ttask: string;",
		"\tcwd?: string;",
		"\tcount?: number;",
		"\tmodel?: string;",
		"\tskill?: string | string[] | boolean;",
		"}",
		"function run(params: { tasks: TaskParam[] }) {",
		"\tconst modelOverrides = params.tasks.map(() => undefined);",
		"\tconst skillOverrides = params.tasks.map(() => undefined);",
		"\tconst parallelTasks = params.tasks.map((task, index) => ({",
		"\t\tagent: task.agent,",
		"\t\ttask: params.context === \"fork\" ? wrapForkTask(task.task) : task.task,",
		"\t\tcwd: task.cwd,",
		"\t\t...(modelOverrides[index] ? { model: modelOverrides[index] } : {}),",
		"\t\t...(skillOverrides[index] !== undefined ? { skill: skillOverrides[index] } : {}),",
		"\t}));",
		"}",
	].join("\n");

	const patched = patchPiSubagentsSource("subagent-executor.ts", input);

	assert.match(patched, /output\?: string \| false;/);
	assert.match(patched, /\n\t\toutput: task\.output,/);
	assert.doesNotMatch(patched, /resolvePiAgentDir/);
});

test("patchPiSubagentsSource preserves output in async parallel task handoff", () => {
	const input = [
		"interface TaskParam {",
		"\tagent: string;",
		"\ttask: string;",
		"\tcwd?: string;",
		"\tcount?: number;",
		"\tmodel?: string;",
		"\tskill?: string | string[] | boolean;",
		"}",
		"function run(tasks: TaskParam[]) {",
		"\tconst modelOverrides = tasks.map(() => undefined);",
		"\tconst skillOverrides = tasks.map(() => undefined);",
		"\tconst parallelTasks = tasks.map((t, i) => ({",
		"\t\tagent: t.agent,",
		"\t\ttask: params.context === \"fork\" ? wrapForkTask(taskTexts[i]!) : taskTexts[i]!,",
		"\t\tcwd: t.cwd,",
		"\t\t...(modelOverrides[i] ? { model: modelOverrides[i] } : {}),",
		"\t\t...(skillOverrides[i] !== undefined ? { skill: skillOverrides[i] } : {}),",
		"\t}));",
		"}",
	].join("\n");

	const patched = patchPiSubagentsSource("subagent-executor.ts", input);

	assert.match(patched, /output\?: string \| false;/);
	assert.match(patched, /\n\t\toutput: t\.output,/);
});

test("patchPiSubagentsSource uses task output when resolving foreground parallel behavior", () => {
	const input = [
		"interface TaskParam {",
		"\tagent: string;",
		"\ttask: string;",
		"\tcwd?: string;",
		"\tcount?: number;",
		"\tmodel?: string;",
		"\tskill?: string | string[] | boolean;",
		"}",
		"async function run(tasks: TaskParam[]) {",
		"\tconst skillOverrides = tasks.map((t) => normalizeSkillInput(t.skill));",
		"\tif (params.clarify === true && ctx.hasUI) {",
		"\t\tconst behaviors = agentConfigs.map((c, i) =>",
		"\t\t\tresolveStepBehavior(c, { skills: skillOverrides[i] }),",
		"\t\t);",
		"\t}",
		"\tconst behaviors = agentConfigs.map((config) => resolveStepBehavior(config, {}));",
		"}",
	].join("\n");

	const patched = patchPiSubagentsSource("subagent-executor.ts", input);

	assert.match(patched, /output\?: string \| false;/);
	assert.match(patched, /resolveStepBehavior\(c, \{ output: tasks\[i\]\?\.output, skills: skillOverrides\[i\] \}\)/);
	assert.match(patched, /resolveStepBehavior\(config, \{ output: tasks\[i\]\?\.output, skills: skillOverrides\[i\] \}\)/);
	assert.doesNotMatch(patched, /resolveStepBehavior\(config, \{\}\)/);
});

test("patchPiSubagentsSource passes foreground parallel output paths into runSync", () => {
	const input = [
		"interface TaskParam {",
		"\tagent: string;",
		"\ttask: string;",
		"\tcwd?: string;",
		"\tcount?: number;",
		"\tmodel?: string;",
		"\tskill?: string | string[] | boolean;",
		"}",
		"async function runForegroundParallelTasks(input: ForegroundParallelRunInput): Promise<SingleResult[]> {",
		"\treturn mapConcurrent(input.tasks, input.concurrencyLimit, async (task, index) => {",
		"\t\tconst overrideSkills = input.skillOverrides[index];",
		"\t\tconst effectiveSkills = overrideSkills === undefined ? input.behaviors[index]?.skills : overrideSkills;",
		"\t\tconst taskCwd = resolveParallelTaskCwd(task, input.paramsCwd, input.worktreeSetup, index);",
		"\t\treturn runSync(input.ctx.cwd, input.agents, task.agent, input.taskTexts[index]!, {",
		"\t\t\tcwd: taskCwd,",
		"\t\t\tsignal: input.signal,",
		"\t\t\tmaxOutput: input.maxOutput,",
		"\t\t\tmaxSubagentDepth: input.maxSubagentDepths[index],",
		"\t\t});",
		"\t});",
		"}",
	].join("\n");

	const patched = patchPiSubagentsSource("subagent-executor.ts", input);

	assert.match(patched, /output\?: string \| false;/);
	assert.match(patched, /const outputPath = typeof input\.behaviors\[index\]\?\.output === "string"/);
	assert.match(patched, /const taskText = injectSingleOutputInstruction\(input\.taskTexts\[index\]!, outputPath\)/);
	assert.match(patched, /runSync\(input\.ctx\.cwd, input\.agents, task\.agent, taskText, \{/);
	assert.match(patched, /\n\t\t\toutputPath,/);
});

test("patchPiSubagentsSource documents output in top-level task schema", () => {
	const input = [
		"export const TaskItem = Type.Object({ ",
		"\tagent: Type.String(), ",
		"\ttask: Type.String(), ",
		"\tcwd: Type.Optional(Type.String()),",
		"\tcount: Type.Optional(Type.Integer({ minimum: 1, description: \"Repeat this parallel task N times with the same settings.\" })),",
		"\tmodel: Type.Optional(Type.String({ description: \"Override model for this task (e.g. 'openai/gpt-5')\" })),",
		"\tskill: Type.Optional(SkillOverride),",
		"});",
		"export const SubagentParams = Type.Object({",
		"\ttasks: Type.Optional(Type.Array(TaskItem, { description: \"PARALLEL mode: [{agent, task, count?}, ...]\" })),",
		"});",
	].join("\n");

	const patched = patchPiSubagentsSource("schemas.ts", input);

	assert.match(patched, /output: Type\.Optional\(Type\.Any/);
	assert.match(patched, /count\?, output\?/);
	assert.doesNotMatch(patched, /resolvePiAgentDir/);
});

test("patchPiSubagentsSource documents output in top-level parallel help", () => {
	const input = [
		'import * as os from "node:os";',
		'import * as path from "node:path";',
		"const help = `",
		"• PARALLEL: { tasks: [{agent,task,count?}, ...], concurrency?: number, worktree?: true } - concurrent execution (worktree: isolate each task in a git worktree)",
		"`;",
	].join("\n");

	const patched = patchPiSubagentsSource("index.ts", input);

	assert.match(patched, /output\?/);
	assert.match(patched, /per-task file target/);
	assert.doesNotMatch(patched, /function resolvePiAgentDir/);
});

test("patchPiSubagentsSource makes pi-spawn prefer the real Pi CLI over Feynman wrapper", () => {
	const input = [
		"export interface PiSpawnDeps {",
		"\texecPath?: string;",
		"\targv1?: string;",
		"}",
		"export function resolveWindowsPiCliScript(deps: PiSpawnDeps = {}): string | undefined {",
		"\tconst existsSync = deps.existsSync ?? fs.existsSync;",
		'\tconst readFileSync = deps.readFileSync ?? ((filePath, encoding) => fs.readFileSync(filePath, encoding));',
		"\tconst argv1 = deps.argv1 ?? process.argv[1];",
		"",
		"\tif (argv1) {",
		"\t\tconst argvPath = normalizePath(argv1);",
		"\t\tif (isRunnableNodeScript(argvPath, existsSync)) {",
		"\t\t\treturn argvPath;",
		"\t\t}",
		"\t}",
		"}",
	].join("\n");

	const patched = patchPiSubagentsSource("src/runs/shared/pi-spawn.ts", input);

	assert.match(patched, /process\.env\.FEYNMAN_PI_CLI_PATH/);
	assert.match(patched, /\targv2\?: string;/);
	assert.match(patched, /path\.basename\(argvPath\) !== "pi-cli-wrapper\.js"/);
	assert.match(patched, /const argv2 = deps\.argv2 \?\? process\.argv\[2\]/);
	assert.match(patched, /path\.join\(path\.dirname\(normalizePath\(argv2\)\), "cli\.js"\)/);
	assert.doesNotMatch(patched, /resolvePiAgentDir/);
});

test("patchPiSubagentsSource preserves the exact Feynman Pi path in the current package resolver", () => {
	const input = [
		'import * as fs from "node:fs";',
		'import * as path from "node:path";',
		'export const PI_CODING_AGENT_PACKAGE = "@earendil-works/pi-coding-agent";',
		"interface PiSpawnDeps {",
		"\targv1?: string;",
		"\tenv?: NodeJS.ProcessEnv;",
		"}",
		"function isRunnableNodeScript(filePath: string, existsSync: (filePath: string) => boolean): boolean {",
		"\treturn existsSync(filePath);",
		"}",
		"function normalizePath(filePath: string): string { return path.resolve(filePath); }",
		"export function resolvePiCliScript(deps: PiSpawnDeps = {}): string | undefined {",
		"\tconst existsSync = fs.existsSync;",
		"\tconst argv1 = deps.argv1 ?? process.argv[1];",
		"\treturn argv1;",
		"}",
	].join("\n");

	const patched = patchPiSubagentsSource("src/runs/shared/pi-spawn.ts", input);

	assert.match(patched, /const env = deps\.env \?\? process\.env;/);
	assert.match(patched, /env\.FEYNMAN_PI_CLI_PATH\?\.trim\(\)/);
	assert.match(patched, /isRunnableNodeScript\(cliPath, existsSync\)/);
	assert.equal(patchPiSubagentsSource("src/runs/shared/pi-spawn.ts", patched), patched);
});

test("patchPiSubagentsSource upgrades old Feynman pi-spawn patch to derive cli.js from wrapper main arg", () => {
	const input = [
		"export interface PiSpawnDeps {",
		"\texecPath?: string;",
		"\targv1?: string;",
		"}",
		"export function resolveWindowsPiCliScript(deps: PiSpawnDeps = {}): string | undefined {",
		"\tconst existsSync = deps.existsSync ?? fs.existsSync;",
		'\tconst readFileSync = deps.readFileSync ?? ((filePath, encoding) => fs.readFileSync(filePath, encoding));',
		"\tconst argv1 = deps.argv1 ?? process.argv[1];",
		"\tconst feynmanPiCliPath = process.env.FEYNMAN_PI_CLI_PATH;",
		"\tif (feynmanPiCliPath) {",
		"\t\tconst cliPath = normalizePath(feynmanPiCliPath);",
		"\t\tif (isRunnableNodeScript(cliPath, existsSync)) return cliPath;",
		"\t}",
		"",
		"\tif (argv1) {",
		"\t\tconst argvPath = normalizePath(argv1);",
		'\t\tif (path.basename(argvPath) !== "pi-cli-wrapper.js" && isRunnableNodeScript(argvPath, existsSync)) {',
		"\t\t\treturn argvPath;",
		"\t\t}",
		"\t}",
		"}",
	].join("\n");

	const patched = patchPiSubagentsSource("src/runs/shared/pi-spawn.ts", input);

	assert.match(patched, /\targv2\?: string;/);
	assert.match(patched, /const argv2 = deps\.argv2 \?\? process\.argv\[2\]/);
	assert.match(patched, /path\.basename\(argvPath\) === "pi-cli-wrapper\.js" && argv2/);
	assert.match(patched, /path\.join\(path\.dirname\(normalizePath\(argv2\)\), "cli\.js"\)/);
});

test("stripPiSubagentBuiltinModelSource removes built-in model pins", () => {
	const input = [
		"---",
		"name: researcher",
		"description: Web researcher",
		"model: anthropic/claude-sonnet-4-6",
		"tools: read, web_search",
		"---",
		"",
		"Body",
	].join("\n");

	const patched = stripPiSubagentBuiltinModelSource(input);

	assert.ok(!patched.includes("model: anthropic/claude-sonnet-4-6"));
	assert.match(patched, /name: researcher/);
	assert.match(patched, /tools: read, web_search/);
});

test("pi-spawn patch is idempotent including the SpawnDeps argv2 member", () => {
	const input = [
		"interface SpawnDeps {",
		"\texecPath?: string;",
		"\targv1?: string;",
		"\texistsSync?: (filePath: string) => boolean;",
		"}",
		"",
		"\tconst argv1 = deps.argv1 ?? process.argv[1];",
		"",
		"\tif (argv1) {",
		"\t\tconst argvPath = normalizePath(argv1);",
		"\t\tif (isRunnableNodeScript(argvPath, existsSync)) {",
		"\t\t\treturn argvPath;",
		"\t\t}",
		"\t}",
		"",
	].join("\n");

	const once = patchPiSubagentsSource("src/runs/shared/pi-spawn.ts", input);
	const twice = patchPiSubagentsSource("src/runs/shared/pi-spawn.ts", once);

	assert.equal(twice, once);
	assert.equal((once.match(/argv2\?: string;/g) ?? []).length, 1);
	assert.match(once, /wrapperPiCliPath/);
});
