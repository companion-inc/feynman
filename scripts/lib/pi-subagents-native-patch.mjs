import { createHash } from "node:crypto";
import { patchPiSubagentsCorrectness } from "./pi-subagents-correctness-patch.mjs";

// Exact npm 0.65.1 source, gitHead 83be9c3de2cde1553c0269f383efc1eb1194dc8b.
// Native AgentSession event boundaries replaced CLI JSON child processes in 0.65.0.
export const PI_SUBAGENTS_NATIVE_VERSION = "0.65.1";
export const PI_SUBAGENTS_NATIVE_MARKER = "feynman-pi-subagents-native-0.65.1-v1";
export const PI_SUBAGENTS_NATIVE_EXTRA_TARGETS = [
	"src/runs/background/run-child-session.ts",
	"src/runs/shared/child-session.ts",
	"src/extension/tool-result.ts",
];

const GUIDANCE = "When a child needs an explicit model, run `feynman model list` first and copy an exact approved provider/model. Never pass a bare model id or an agent name as the model.";
const DESCRIPTION = "Delegate research to configured agents. Call {action:'list',capabilities:true} first and use only executable, non-disabled agents. Use {agent,task,async:true} for one child. For parallel research use {workflowScript,async:true} with await runs.all([{key,agent,task,output}, ...]); for sequential work await runs.run(key,{agent,task,output}) in order. Use explicit return for the final workflow result. Keep one writer per cwd/worktree, use fresh read-only reviewers, and return actual output/artifact paths. Continue independent work after async launch; consume results before dependent work. Do not enable missions, schedules, watchdogs, external CLI runners, or other adjacent workflows unless explicitly requested for the active research run.";

function digest(source) {
	return createHash("sha256").update(source).digest("hex");
}

function replace(source, from, to) {
	if (source.split(from).length !== 2) {
		throw new Error(`Unsupported pi-subagents ${PI_SUBAGENTS_NATIVE_VERSION} layout: ${from.slice(0, 100)}`);
	}
	return source.replace(from, to);
}

function patchPrompt(source) {
	// Keep upstream custom/full/compact selection and safety notes, but make the
	// default research surface truthful about the new workflow API.
	const start = source.indexOf("export const DEFAULT_SUBAGENT_TOOL_DESCRIPTION = `");
	const end = source.indexOf("\nexport const SUBAGENT_SAFETY_GUIDANCE", start);
	if (start < 0 || end < start) throw new Error("Missing native prompt metadata constants");
	let patched = `${source.slice(0, start)}export const DEFAULT_SUBAGENT_TOOL_DESCRIPTION = ${JSON.stringify(`${DESCRIPTION} ${GUIDANCE}`)};

export const SUBAGENT_TOOL_PROMPT_SNIPPET = "Delegate research work to configured subagents.";
export const SUBAGENT_TOOL_PROMPT_GUIDELINES = [
	${JSON.stringify(GUIDANCE)},
	"Use only configured, executable research agents. Keep one writer per cwd/worktree; use fresh read-only reviewers.",
	"Use runs.all for parallel children and sequential awaited runs.run calls for chains. Return actual output paths, not invented filenames.",
	"Ordinary children do not delegate. Do not activate adjacent automation unless the user requests it for this research run.",
];
${source.slice(end)}`;
	// Full/compact may be deliberately selected: approved-model guidance must
	// survive that selection too, not only the default prompt metadata path.
	for (const name of ["FULL_SUBAGENT_TOOL_DESCRIPTION", "COMPACT_SUBAGENT_TOOL_DESCRIPTION"]) {
		const begin = patched.indexOf(`export const ${name} = \``);
		const finish = patched.indexOf("`;", begin);
		if (begin < 0 || finish < begin) throw new Error(`Missing ${name}`);
		patched = `${patched.slice(0, finish)}\n\n${GUIDANCE.replaceAll("`", "\\`")}${patched.slice(finish)}`;
	}
	return patched;
}

function patchNativeEventBoundary(source, background) {
	const event = background ? "event" : "evt";
	const expected = background ? "input.expectedModelForVerification" : "expectedModelForVerification";
	const registry = background ? "input.modelVerificationRegistry" : "options.availableModels";
	const error = background ? "error" : "result.error";
	// Verify assistant identity before tool execution, including streams lacking
	// message_start. Once failed, do not overwrite the error with later events.
	const anchor = background
		? "\t\t\tconst event = raw as ChildSessionEvent & ChildEvent;"
		: "\t\t\tif (lifecycleFinished) return;\n\t\t\tjsonlWriter.writeLine(JSON.stringify(projectChildSessionEventForJson(evt)));";
	const check = [
		`\t\t\tif (${error}?.startsWith("model_verification_failed:")) return;`,
		`\t\t\tif ((${event}.type === "message_start" || ${event}.type === "message_end") && ${event}.message?.role === "assistant" && ${expected}) {`,
		`\t\t\t\tconst identity = ${event}.message as unknown as { provider?: unknown; model?: unknown };`,
		`\t\t\t\tconst failure = formatSubagentModelVerificationError(${expected}, identity.provider, identity.model, ${registry});`,
		`\t\t\t\tif (failure) { ${error} = failure; abortChild(); return; }`,
		"\t\t\t}",
	].join("\n");
	let patched = replace(source, anchor, `${anchor}\n${check}`);
	const old = background
		? "\t\t\t\t\tif (input.expectedModelForVerification && !hasToolCall) {\n\t\t\t\t\t\tconst modelVerificationError = formatSubagentModelVerificationError(input.expectedModelForVerification, event.message.model, input.modelVerificationRegistry, input.modelResponseAliases);\n\t\t\t\t\t\tif (modelVerificationError && !error) error = modelVerificationError;\n\t\t\t\t\t}"
		: "\t\t\t\t\t\tif (expectedModelForVerification && !hasToolCall) {\n\t\t\t\t\t\t\tconst modelVerificationError = formatSubagentModelVerificationError(expectedModelForVerification, evt.message.model, options.availableModels, options.modelResponseAliases);\n\t\t\t\t\t\t\tif (modelVerificationError && !result.error) result.error = modelVerificationError;\n\t\t\t\t\t\t}";
	patched = replace(patched, old, "");
	return patched;
}

function transform(relativePath, source) {
	let patched = source;
	if (relativePath === "src/extension/tool-description.ts") patched = patchPrompt(source);
	if (relativePath === "src/runs/shared/model-fallback.ts") {
		// Reuse the proven exact provider/model comparator and precise overflow
		// classification; do not apply obsolete CLI-spawn rewrites elsewhere.
		patched = patchPiSubagentsCorrectness(relativePath, source);
	}
	if (relativePath === "src/runs/foreground/execution.ts") {
		patched = patchNativeEventBoundary(source, false);
		patched = replace(patched, "\t\t\tif (attemptSucceeded) break modelAttemptsLoop;",
			'\t\t\tif (result.error?.startsWith("model_verification_failed:")) break modelAttemptsLoop;\n\t\t\tif (attemptSucceeded) break modelAttemptsLoop;');
	}
	if (relativePath === "src/runs/background/run-child-session.ts") patched = patchNativeEventBoundary(source, true);
	if (relativePath === "src/runs/background/subagent-runner.ts") {
		patched = replace(source, "\t\tif (attempt.success) break modelAttemptsLoop;",
			'\t\tif (error?.startsWith("model_verification_failed:")) break modelAttemptsLoop;\n\t\tif (attempt.success) break modelAttemptsLoop;');
	}
	return patched === source ? source : `// ${PI_SUBAGENTS_NATIVE_MARKER}\n${patched}`;
}

// Filled from integrity-checked npm tarball, never from mutable installed state.
const BASELINES = {
	"index.ts": "a2f11dbe8e200bd8c590441316a9c6ab222318d2aa738670dedcf0e72592dde3",
	"src/extension/index.ts": "fdb86864e6acaec948206cb5f830b256dcf50f1b3a103f31076501df81d37384",
	"src/extension/tool-description.ts": "e0e5ff1fe670fb452dcda7dac80b2fb6548b8165dd8e81b6f660852a36bae060",
	"src/agents/agents.ts": "02c2e5a5631d365cc4b1bc89f8c1e7e7edf73e68ca060b219f55393087ac275e",
	"src/agents/agent-management.ts": "06c6052b07a09751651819977094dc78be7ad9f1e2f81827543e897a0b8e6c71",
	"src/api/preflight.ts": "e04e6d4cb4dc1b35407103173df24b2a715822b3186e35dfeaf4aaa3ad60f441",
	"src/extension/doctor.ts": "8d63473950da1614cf266a0ec9930c4a24e6ae34f8fa0f8c96b3602f54990f00",
	"src/slash/slash-commands.ts": "6ccf4a73bcb693662309ae895974e02c7a4b3233cdcfed96999681317bef29b5",
	"src/shared/artifacts.ts": "ccca09e94181458bb53c2431dc6b96ec434544187d64cc411c46f1e7f4c22003",
	"src/runs/shared/run-history.ts": "7a20f4dbd5c1c07e24403bf3092a451bd4f5068b9c62a679ccb55242f5482f0c",
	"src/agents/skills.ts": "e17c0b224da5b264dc8973731dacc31d21c497efbda78443a015b0ab15903e14",
	"src/runs/shared/pi-spawn.ts": "80066a47c0127fa9f2527a59a4a50df32c00de9b2e18e468f28a4789211c01f9",
	"src/runs/shared/model-fallback.ts": "1fec27878e544486bcd75f6507e2e5a43c518b3a8ef6c322d14db4c223725aba",
	"src/runs/foreground/execution.ts": "54017d93d1c8cd03d64be5b1bc532c624cae3755f6952017fd8eaf34e76efb61",
	"src/runs/foreground/subagent-executor.ts": "82fe372a9f6b72c09099be45820bd8503da4824bbcbc788deb3c10c125f805be",
	"src/runs/background/async-execution.ts": "5d7d4446ce66d54e324a275b1d649878d0bd4b77d35160caf4ac76c5d0bc534d",
	"src/runs/background/subagent-runner.ts": "0468a7895fce4e7b54c7cb6616abb711c1860c531c103b963869c04072bf3a72",
	"src/runs/background/async-resume.ts": "355d503cfb61925a7ffdfc494675b2fbd9ae9a5bae6ce1a1f87fc86fdaffed65",
	"src/runs/shared/parallel-utils.ts": "4cee58d31247c70049405f28891cff69e2fbef3742876ecf134aa76f328d4c11",
	"src/runs/background/chain-root-attachment.ts": "d1bb1c42b7b161acbb65a8278ccef43b379f54c387a6004d2b6461738fa0e653",
	"src/runs/background/stale-run-reconciler.ts": "de717a2f6485fc2f87ea60854f8fbb99b8f01eefd2d691c96f93209081261c6f",
	"src/runs/background/async-status.ts": "678422a4d67b3a17297dd16fda7faa5ee4d725b96914fd64b9d4cb8e6980d2d8",
	"src/shared/types.ts": "a08a934ef803bfabe9c8018964612643a9771572453588d81807ed9141a9c96c",
	"src/extension/fanout-child.ts": "87fd60892a3059ca0f82fdabd9db6ca1e45c9d4d291260c2926695b8d64a14f9",
	"src/runs/background/wait-tool.ts": "5ed1670e1c560834ca1c2a857440aa6b8152958236a183f86909b36b3d3a1e4f",
	"src/extension/schemas.ts": "9e5c09a37e2017212e3cbe3b674567bcc454e3d9c5cbbba580476d8653139e01",
	"src/runs/background/run-child-session.ts": "86f302832a21afdb0e79446d20d58be242d23c09f3d425bf4db254a09c10c940",
	"src/runs/shared/child-session.ts": "04cf6190c9aa466d481ccafc033ff3a37c1b9b962a18e2c175cf4963b5bf1556",
	"src/extension/tool-result.ts": "14fb8162d7c0a5948c0068b5990c82c4b1f4fbf04176c04618286a71e7f55b87"
};

/** Returns undefined only for a different (legacy) source layout. */
export function patchPiSubagentsNativeSource(relativePath, source) {
	const baseline = BASELINES[relativePath];
	if (!baseline) return undefined;
	const actual = digest(source);
	if (actual === baseline) {
		const patched = transform(relativePath, source);
		if (digest(patched) !== (PATCHED_DIGESTS[relativePath] ?? baseline)) {
			throw new Error(`pi-subagents ${PI_SUBAGENTS_NATIVE_VERSION} transform changed without reviewed digest: ${relativePath}`);
		}
		return patched;
	}
	if (source.startsWith(`// ${PI_SUBAGENTS_NATIVE_MARKER}\n`)) {
		const expected = PATCHED_DIGESTS[relativePath];
		if (actual !== expected) throw new Error(`Modified pi-subagents ${PI_SUBAGENTS_NATIVE_VERSION} patch: ${relativePath}`);
		return source;
	}
	if (
		source.includes("childSessionFactory") ||
		source.includes("modelResponseAliases?: Record<string, string[]>") ||
		(relativePath === "src/extension/tool-description.ts" && source.includes("export function buildSubagentToolPromptMetadata(") && source.includes("workflowScript")) ||
		(relativePath.endsWith("/wait-tool.ts") && source.includes('name: "bg_wait"'))
	) {
		throw new Error(`Unsupported native pi-subagents source (expected ${PI_SUBAGENTS_NATIVE_VERSION}): ${relativePath}`);
	}
	return undefined;
}

// Filled from deterministic transform output; supports idempotence after restart.
const PATCHED_DIGESTS = {
	"src/extension/tool-description.ts": "0aae0f9283bffcc5f676ad3f8d5e14d464c13491cc448c54ff9d9663080f52c3",
	"src/runs/shared/model-fallback.ts": "3ea164f6a469af48005a84e71e20e82a7de3106fea6e09321f3762f95033dbfc",
	"src/runs/foreground/execution.ts": "644bea41f0029f18394119a43d473dd96519990f3f3f63b4bb0fe515f69340e7",
	"src/runs/background/subagent-runner.ts": "067e54602851ef3f4f3aa60eece8a2af8722d500f70285b3f738d2f74e093bc7",
	"src/runs/background/run-child-session.ts": "0aac5527266c135b640d236f76b1404c1533ee838ab2e5537bd2ca01efb3b4af"
};

export function isPiSubagentsNativeSource(readSource) {
	return readSource("src/runs/foreground/execution.ts").includes("childSessionFactory");
}

/** Hashes bind native source checks to reviewed complete files, not loose markers. */
export function assertPiSubagentsNativeSources(readSource, label = "pi-subagents") {
	for (const [relativePath, baseline] of Object.entries(BASELINES)) {
		const expected = PATCHED_DIGESTS[relativePath] ?? baseline;
		if (digest(readSource(relativePath)) !== expected) {
			throw new Error(`${label} ${PI_SUBAGENTS_NATIVE_VERSION}: unreviewed or unpatched ${relativePath}`);
		}
	}
}
