import { patchPiSubagentAgentDiagnostics } from "./pi-subagents-agent-diagnostics-patch.mjs";
import { patchPiSubagentsCorrectness } from "./pi-subagents-correctness-patch.mjs";
import { patchPiSubagentPromptMetadata } from "./pi-subagents-prompt-metadata-patch.mjs";
import { PI_SUBAGENTS_NATIVE_EXTRA_TARGETS, patchPiSubagentsNativeSource } from "./pi-subagents-native-patch.mjs";

export const PI_SUBAGENTS_PATCH_TARGETS = [
	"index.ts",
	"agents.ts",
	"artifacts.ts",
	"run-history.ts",
	"skills.ts",
	"chain-clarify.ts",
	"pi-spawn.ts",
	"subagent-executor.ts",
	"schemas.ts",
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
	"src/runs/foreground/subagent-executor.ts",
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
	"src/extension/schemas.ts",
	...PI_SUBAGENTS_NATIVE_EXTRA_TARGETS,
];

const RESOLVE_PI_AGENT_DIR_HELPER = [
	"function resolvePiAgentDir(): string {",
	'	const configured = process.env.FEYNMAN_CODING_AGENT_DIR?.trim() || process.env.PI_CODING_AGENT_DIR?.trim();',
	'	if (!configured) return path.join(os.homedir(), ".pi", "agent");',
	'	return configured.startsWith("~/") ? path.join(os.homedir(), configured.slice(2)) : configured;',
	"}",
].join("\n");

const PI_SPAWN_ORIGINAL_ARGV_BLOCK = [
	"\tconst argv1 = deps.argv1 ?? process.argv[1];",
	"",
	"\tif (argv1) {",
	"\t\tconst argvPath = normalizePath(argv1);",
	"\t\tif (isRunnableNodeScript(argvPath, existsSync)) {",
	"\t\t\treturn argvPath;",
	"\t\t}",
	"\t}",
].join("\n");

const PI_SPAWN_FEYNMAN_ARGV_BLOCK = [
	"\tconst argv1 = deps.argv1 ?? process.argv[1];",
	"\tconst feynmanPiCliPath = process.env.FEYNMAN_PI_CLI_PATH;",
	"\tif (feynmanPiCliPath) {",
	"\t\tconst cliPath = normalizePath(feynmanPiCliPath);",
	"\t\tif (isRunnableNodeScript(cliPath, existsSync)) return cliPath;",
	"\t}",
	"",
	"\tif (argv1) {",
	"\t\tconst argvPath = normalizePath(argv1);",
	"\t\tif (path.basename(argvPath) !== \"pi-cli-wrapper.js\" && isRunnableNodeScript(argvPath, existsSync)) {",
	"\t\t\treturn argvPath;",
	"\t\t}",
	"\t}",
].join("\n");

const PI_SPAWN_FEYNMAN_ARGV_BLOCK_WITH_WRAPPER_MAIN = [
	"\tconst argv1 = deps.argv1 ?? process.argv[1];",
	"\tconst argv2 = deps.argv2 ?? process.argv[2];",
	"\tconst feynmanPiCliPath = process.env.FEYNMAN_PI_CLI_PATH;",
	"\tif (feynmanPiCliPath) {",
	"\t\tconst cliPath = normalizePath(feynmanPiCliPath);",
	"\t\tif (isRunnableNodeScript(cliPath, existsSync)) return cliPath;",
	"\t}",
	"",
	"\tif (argv1) {",
	"\t\tconst argvPath = normalizePath(argv1);",
	"\t\tif (path.basename(argvPath) !== \"pi-cli-wrapper.js\" && isRunnableNodeScript(argvPath, existsSync)) {",
	"\t\t\treturn argvPath;",
	"\t\t}",
	"\t\tif (path.basename(argvPath) === \"pi-cli-wrapper.js\" && argv2) {",
	"\t\t\tconst wrapperPiCliPath = path.join(path.dirname(normalizePath(argv2)), \"cli.js\");",
	"\t\t\tif (isRunnableNodeScript(wrapperPiCliPath, existsSync)) return wrapperPiCliPath;",
	"\t\t}",
	"\t}",
].join("\n");

function injectResolvePiAgentDirHelper(source) {
	if (source.includes("function resolvePiAgentDir(): string {")) {
		return source;
	}

	const lines = source.split("\n");
	let insertAt = 0;
	let importSeen = false;
	let importOpen = false;

	for (let index = 0; index < lines.length; index += 1) {
		const trimmed = lines[index].trim();
		if (!importSeen) {
			if (trimmed === "" || trimmed.startsWith("/**") || trimmed.startsWith("*") || trimmed.startsWith("*/")) {
				insertAt = index + 1;
				continue;
			}
			if (trimmed.startsWith("import ")) {
				importSeen = true;
				importOpen = !trimmed.endsWith(";");
				insertAt = index + 1;
				continue;
			}
			break;
		}

		if (trimmed.startsWith("import ")) {
			importOpen = !trimmed.endsWith(";");
			insertAt = index + 1;
			continue;
		}
		if (importOpen) {
			if (trimmed.endsWith(";")) importOpen = false;
			insertAt = index + 1;
			continue;
		}
		if (trimmed === "") {
			insertAt = index + 1;
			continue;
		}
		insertAt = index;
		break;
	}

	return [...lines.slice(0, insertAt), "", RESOLVE_PI_AGENT_DIR_HELPER, "", ...lines.slice(insertAt)].join("\n");
}

function replaceAll(source, from, to) {
	return source.split(from).join(to);
}

function applyReplacementGroup(source, replacements, anchors = []) {
	if (![...anchors, ...replacements.map(([from]) => from)].every((anchor) => source.includes(anchor))) {
		return source;
	}

	let patched = source;
	for (const [from, to] of replacements) {
		patched = replaceAll(patched, from, to);
	}
	return patched;
}

function applyReplacementGroups(source, groups) {
	let patched = source;
	for (const group of groups) {
		patched = applyReplacementGroup(patched, group);
	}
	return patched;
}

function patchTaskSchemaOutputParam(source) {
	if (source.includes("\toutput: Type.Optional(Type.Any")) {
		return source;
	}
	return source.replace(
		/^(\tmodel: Type\.Optional\(Type\.String\(\{ description: "Override model for this task \(e\.g\. '[^']+'\)" \}\)\),)$/m,
		[
			'\toutput: Type.Optional(Type.Any({ description: "Output file for this parallel task (string), or false to disable. Relative paths resolve against cwd." })),',
			"$1",
		].join("\n"),
	);
}

function patchCurrentPiSpawnResolver(source) {
	if (
		!source.includes('export const PI_CODING_AGENT_PACKAGE = "@earendil-works/pi-coding-agent";') ||
		source.includes("FEYNMAN_PI_CLI_PATH")
	) {
		return source;
	}
	return source.replace(
		"\tconst argv1 = deps.argv1 ?? process.argv[1];",
		[
			"\tconst env = deps.env ?? process.env;",
			"\tconst feynmanPiCliPath = env.FEYNMAN_PI_CLI_PATH?.trim();",
			"\tif (feynmanPiCliPath) {",
			"\t\tconst cliPath = normalizePath(feynmanPiCliPath);",
			"\t\tif (isRunnableNodeScript(cliPath, existsSync)) return cliPath;",
			"\t}",
			"\tconst argv1 = deps.argv1 ?? process.argv[1];",
		].join("\n"),
	);
}

const OLD_AGENT_DIR_DECLS = [
	'\tconst userDirOld = path.join(os.homedir(), ".pi", "agent", "agents");',
	'\tconst userDirNew = path.join(os.homedir(), ".agents");',
].join("\n");

const CURRENT_AGENT_DIR_DECLS = [
	'\tconst userDirOld = path.join(getAgentDir(), "agents");',
	'\tconst userDirNew = path.join(os.homedir(), ".agents");',
].join("\n");

const DISCOVER_AGENTS_LEGACY_USER_LOADS = [
	'\tconst userAgentsOld = scope === "project" ? [] : loadAgentsFromDir(userDirOld, "user");',
	'\tconst userAgentsNew = scope === "project" ? [] : loadAgentsFromDir(userDirNew, "user");',
	'\tconst userAgents = [...userAgentsOld, ...userAgentsNew];',
].join("\n");

const DISCOVER_AGENTS_SINGLE_USER_LOAD = '\tconst userAgents = scope === "project" ? [] : loadAgentsFromDir(userDir, "user");';

const DISCOVER_AGENTS_ALL_LEGACY_USER_LOADS = [
	'\tconst user = [',
	'\t\t...loadAgentsFromDir(userDirOld, "user"),',
	'\t\t...loadAgentsFromDir(userDirNew, "user"),',
	'\t];',
].join("\n");

const DISCOVER_AGENTS_ALL_SINGLE_USER_LOAD = '\tconst user = loadAgentsFromDir(userDir, "user");';

const DISCOVER_AGENTS_ALL_LEGACY_CHAIN_LOADS = [
	'\tconst chains = [',
	'\t\t...loadChainsFromDir(userDirOld, "user"),',
	'\t\t...loadChainsFromDir(userDirNew, "user"),',
	'\t\t...(projectDir ? loadChainsFromDir(projectDir, "project") : []),',
	'\t];',
].join("\n");

const DISCOVER_AGENTS_ALL_SINGLE_CHAIN_LOAD = [
	'\tconst chains = [',
	'\t\t...loadChainsFromDir(userDir, "user"),',
	'\t\t...(projectDir ? loadChainsFromDir(projectDir, "project") : []),',
	'\t];',
].join("\n");

const DISCOVER_AGENTS_ALL_LEGACY_USER_DIR_FALLBACK = '\tconst userDir = fs.existsSync(userDirNew) ? userDirNew : userDirOld;';

function repairHalfPatchedAgentsUserDir(source) {
	let patched = source;
	for (const declarations of [CURRENT_AGENT_DIR_DECLS, OLD_AGENT_DIR_DECLS]) {
		patched = applyReplacementGroup(
			patched,
			[[DISCOVER_AGENTS_SINGLE_USER_LOAD, DISCOVER_AGENTS_LEGACY_USER_LOADS]],
			[declarations],
		);
		patched = applyReplacementGroup(
			patched,
			[[DISCOVER_AGENTS_ALL_SINGLE_USER_LOAD, DISCOVER_AGENTS_ALL_LEGACY_USER_LOADS]],
			[declarations],
		);
	}
	return patched;
}

function patchOldAgentsUserDirs(source) {
	return applyReplacementGroup(source, [
		[OLD_AGENT_DIR_DECLS, '\tconst userDir = path.join(resolvePiAgentDir(), "agents");'],
		[DISCOVER_AGENTS_LEGACY_USER_LOADS, DISCOVER_AGENTS_SINGLE_USER_LOAD],
		[DISCOVER_AGENTS_ALL_LEGACY_USER_LOADS, DISCOVER_AGENTS_ALL_SINGLE_USER_LOAD],
		[DISCOVER_AGENTS_ALL_LEGACY_CHAIN_LOADS, DISCOVER_AGENTS_ALL_SINGLE_CHAIN_LOAD],
		[DISCOVER_AGENTS_ALL_LEGACY_USER_DIR_FALLBACK, ""],
	]);
}

export function stripPiSubagentBuiltinModelSource(source) {
	if (!source.startsWith("---\n")) {
		return source;
	}

	const endIndex = source.indexOf("\n---", 4);
	if (endIndex === -1) {
		return source;
	}

	const frontmatter = source.slice(4, endIndex);
	const nextFrontmatter = frontmatter
		.split("\n")
		.filter((line) => !/^\s*model\s*:/.test(line))
		.join("\n");
	return `---\n${nextFrontmatter}${source.slice(endIndex)}`;
}

export function patchPiSubagentsSource(relativePath, source) {
	const native = patchPiSubagentsNativeSource(relativePath, source);
	if (native !== undefined) return native;
	const target = relativePath.split("/").pop();
	let patched = patchPiSubagentsCorrectness(
		relativePath,
		patchPiSubagentPromptMetadata(
			relativePath,
			patchPiSubagentAgentDiagnostics(relativePath, source),
		),
	);

	switch (target) {
		case "index.ts":
			patched = applyReplacementGroups(patched, [
				[[
					'const configPath = path.join(os.homedir(), ".pi", "agent", "extensions", "subagent", "config.json");',
					'const configPath = path.join(resolvePiAgentDir(), "extensions", "subagent", "config.json");',
				]],
				[[
					"• PARALLEL: { tasks: [{agent,task,count?}, ...], concurrency?: number, worktree?: true } - concurrent execution (worktree: isolate each task in a git worktree)",
					"• PARALLEL: { tasks: [{agent,task,count?,output?}, ...], concurrency?: number, worktree?: true } - concurrent execution (output: per-task file target, worktree: isolate each task in a git worktree)",
				]],
			]);
			break;
		case "agents.ts":
			patched = repairHalfPatchedAgentsUserDir(patched);
			patched = applyReplacementGroup(patched, [[
				'const userDir = path.join(os.homedir(), ".pi", "agent", "agents");',
				'const userDir = path.join(resolvePiAgentDir(), "agents");',
			]]);
			patched = patchOldAgentsUserDirs(patched);
			break;
		case "artifacts.ts":
			patched = applyReplacementGroup(patched, [[
				'const sessionsBase = path.join(os.homedir(), ".pi", "agent", "sessions");',
				'const sessionsBase = path.join(resolvePiAgentDir(), "sessions");',
			]]);
			break;
		case "run-history.ts":
			patched = applyReplacementGroup(patched, [[
				'const HISTORY_PATH = path.join(os.homedir(), ".pi", "agent", "run-history.jsonl");',
				'const HISTORY_PATH = path.join(resolvePiAgentDir(), "run-history.jsonl");',
			]]);
			break;
		case "skills.ts":
			patched = applyReplacementGroup(patched, [[
				'const AGENT_DIR = path.join(os.homedir(), ".pi", "agent");',
				"const AGENT_DIR = resolvePiAgentDir();",
			]]);
			break;
		case "chain-clarify.ts":
			patched = applyReplacementGroup(patched, [[
				'const dir = path.join(os.homedir(), ".pi", "agent", "agents");',
				'const dir = path.join(resolvePiAgentDir(), "agents");',
			]]);
			break;
		case "pi-spawn.ts":
			patched = applyReplacementGroup(patched, [
				[PI_SPAWN_ORIGINAL_ARGV_BLOCK, PI_SPAWN_FEYNMAN_ARGV_BLOCK_WITH_WRAPPER_MAIN],
				[
					"\texecPath?: string;\n\targv1?: string;",
					"\texecPath?: string;\n\targv1?: string;\n\targv2?: string;",
				],
			]);
			patched = applyReplacementGroup(patched, [
				[PI_SPAWN_FEYNMAN_ARGV_BLOCK, PI_SPAWN_FEYNMAN_ARGV_BLOCK_WITH_WRAPPER_MAIN],
				[
					"\texecPath?: string;\n\targv1?: string;",
					"\texecPath?: string;\n\targv1?: string;\n\targv2?: string;",
				],
			]);
			patched = patchCurrentPiSpawnResolver(patched);
			break;
		case "model-fallback.ts":
			patched = applyReplacementGroup(patched, [[
				[
					"const RETRYABLE_MODEL_FAILURE_PATTERNS = [",
					"\t/rate\\s*limit/i,",
					"\t/too many requests/i,",
				].join("\n"),
				[
					"const RETRYABLE_MODEL_FAILURE_PATTERNS = [",
					"\t/rate\\s*limit/i,",
					"\t/usage\\s*limit/i,",
					"\t/too many requests/i,",
				].join("\n"),
			]]);
			break;
		case "subagent-executor.ts":
			{
				const withOutputDeclaration = applyReplacementGroup(patched, [[
					[
						"\tcwd?: string;",
						"\tcount?: number;",
						"\tmodel?: string;",
						"\tskill?: string | string[] | boolean;",
					].join("\n"),
					[
						"\tcwd?: string;",
						"\tcount?: number;",
						"\tmodel?: string;",
						"\tskill?: string | string[] | boolean;",
						"\toutput?: string | false;",
					].join("\n"),
				]]);

				if (withOutputDeclaration !== patched) {
					patched = withOutputDeclaration;
					patched = applyReplacementGroups(patched, [
						[[
							[
								"\t\t\tcwd: task.cwd,",
								"\t\t\t...(modelOverrides[index] ? { model: modelOverrides[index] } : {}),",
							].join("\n"),
							[
								"\t\t\tcwd: task.cwd,",
								"\t\t\toutput: task.output,",
								"\t\t\t...(modelOverrides[index] ? { model: modelOverrides[index] } : {}),",
							].join("\n"),
						]],
						[[
							[
								"\t\tcwd: task.cwd,",
								"\t\t...(modelOverrides[index] ? { model: modelOverrides[index] } : {}),",
							].join("\n"),
							[
								"\t\tcwd: task.cwd,",
								"\t\toutput: task.output,",
								"\t\t...(modelOverrides[index] ? { model: modelOverrides[index] } : {}),",
							].join("\n"),
						]],
						[[
							[
								"\t\t\t\tcwd: t.cwd,",
								"\t\t\t\t...(modelOverrides[i] ? { model: modelOverrides[i] } : {}),",
							].join("\n"),
							[
								"\t\t\t\tcwd: t.cwd,",
								"\t\t\t\toutput: t.output,",
								"\t\t\t\t...(modelOverrides[i] ? { model: modelOverrides[i] } : {}),",
							].join("\n"),
						]],
						[[
							[
								"\t\tcwd: t.cwd,",
								"\t\t...(modelOverrides[i] ? { model: modelOverrides[i] } : {}),",
							].join("\n"),
							[
								"\t\tcwd: t.cwd,",
								"\t\toutput: t.output,",
								"\t\t...(modelOverrides[i] ? { model: modelOverrides[i] } : {}),",
							].join("\n"),
						]],
						[
							[
								[
									"\t\tconst behaviors = agentConfigs.map((c, i) =>",
									"\t\t\tresolveStepBehavior(c, { skills: skillOverrides[i] }),",
									"\t\t);",
								].join("\n"),
								[
									"\t\tconst behaviors = agentConfigs.map((c, i) =>",
									"\t\t\tresolveStepBehavior(c, { output: tasks[i]?.output, skills: skillOverrides[i] }),",
									"\t\t);",
								].join("\n"),
							],
							[
								"\tconst behaviors = agentConfigs.map((config) => resolveStepBehavior(config, {}));",
								"\tconst behaviors = agentConfigs.map((config, i) => resolveStepBehavior(config, { output: tasks[i]?.output, skills: skillOverrides[i] }));",
							],
						],
						[
							[
								[
									"\t\tconst taskCwd = resolveParallelTaskCwd(task, input.paramsCwd, input.worktreeSetup, index);",
									"\t\treturn runSync(input.ctx.cwd, input.agents, task.agent, input.taskTexts[index]!, {",
								].join("\n"),
								[
									"\t\tconst taskCwd = resolveParallelTaskCwd(task, input.paramsCwd, input.worktreeSetup, index);",
									"\t\tconst outputPath = typeof input.behaviors[index]?.output === \"string\"",
									"\t\t\t? resolveSingleOutputPath(input.behaviors[index]?.output, input.ctx.cwd, taskCwd)",
									"\t\t\t: undefined;",
									"\t\tconst taskText = injectSingleOutputInstruction(input.taskTexts[index]!, outputPath);",
									"\t\treturn runSync(input.ctx.cwd, input.agents, task.agent, taskText, {",
								].join("\n"),
							],
							[
								[
									"\t\t\tmaxOutput: input.maxOutput,",
									"\t\t\tmaxSubagentDepth: input.maxSubagentDepths[index],",
								].join("\n"),
								[
									"\t\t\tmaxOutput: input.maxOutput,",
									"\t\t\toutputPath,",
									"\t\t\tmaxSubagentDepth: input.maxSubagentDepths[index],",
								].join("\n"),
							],
						],
					]);
				}
			}
			break;
		case "schemas.ts":
			patched = patchTaskSchemaOutputParam(patched);
			patched = applyReplacementGroup(patched, [
				[
					'tasks: Type.Optional(Type.Array(TaskItem, { description: "PARALLEL mode: [{agent, task, count?}, ...]" })),',
					'tasks: Type.Optional(Type.Array(TaskItem, { description: "PARALLEL mode: [{agent, task, count?, output?}, ...]" })),',
				],
			]);
			break;
		default:
			return patched;
	}

	if (patched === source) {
		return source;
	}

	return patched.includes("resolvePiAgentDir()") ? injectResolvePiAgentDirHelper(patched) : patched;
}
