/**
 * Temporary Pi 0.84.2 forward patch for upstream commits and issue-scoped fixes:
 * - 90305d90a049d3f7784f15821d117fc6932248e7 (disable tools during summaries)
 * - 97fa14e39cfce78c273a36b2d9e8509cd5bc6b72 (reject truncated summaries)
 * - earendil-works/pi#8651 (bound compaction budgets to the model context window)
 * - earendil-works/pi#8652 (reject unusable persisted summary checkpoints)
 *
 * Removal condition: delete this patch after Feynman adopts a released Pi
 * version that contains the commits above and equivalent fixes for #8651/#8652.
 */

export const PI_COMPACTION_TOOLS_REQUIRED_VERSION = "0.85.1";

export const PI_COMPACTION_TOOLS_RUNTIME_TARGETS = Object.freeze([
	"dist/core/compaction/compaction.js",
	"dist/core/compaction/branch-summarization.js",
	"dist/core/agent-session.js",
]);
export const PI_COMPACTION_TOOLS_TYPE_TARGETS = Object.freeze([
	"dist/core/compaction/compaction.d.ts",
]);
export const PI_COMPACTION_TOOLS_PATCH_TARGETS = Object.freeze([
	...PI_COMPACTION_TOOLS_RUNTIME_TARGETS,
	...PI_COMPACTION_TOOLS_TYPE_TARGETS,
]);

export const PI_COMPACTION_TOOLS_PATCH_MARKERS = Object.freeze({
	request: "Feynman Pi 0.84.2 forward patch: disable tools during summarization",
	historyResponse: "Feynman Pi 0.84.2 forward patch: reject compaction tool calls",
	prefixResponse: "Feynman Pi 0.84.2 forward patch: reject turn-prefix tool calls",
	branchResponse: "Feynman Pi 0.84.2 forward patch: reject branch-summary tool calls",
	summaryFailure: "Feynman Pi 0.84.2 forward patch: reject truncated summaries",
	summaryFailureTypes: "Feynman Pi 0.84.2 forward patch: type truncated-summary guard",
	contextBudgets: "Feynman Pi 0.84.2 hotfix: bound compaction budgets to model context",
	contextCallers: "Feynman Pi 0.84.2 hotfix: pass model context into compaction preparation",
	contextBudgetTypes: "Feynman Pi 0.84.2 hotfix: type model-bounded compaction budgets",
	branchRequestBudget: "Feynman Pi 0.84.2 hotfix: bound branch summary request to model limits",
	branchHistoryCapacity: "Feynman Pi 0.84.2 hotfix: fail closed when non-empty branch history cannot fit",
	summaryIntegrity: "Feynman Pi 0.84.2 hotfix: reject unusable summary checkpoints",
	branchIntegrity: "Feynman Pi 0.84.2 hotfix: reject unusable branch checkpoints",
	summaryIntegrityTypes: "Feynman Pi 0.84.2 hotfix: type summary integrity guard",
});

const SUMMARY_USABILITY_HELPER_IMPLEMENTATION = `const CHECKPOINT_REQUIRED_SECTIONS = Object.freeze(["Goal", "Progress", "Next Steps"]);
const TURN_PREFIX_REQUIRED_SECTIONS = Object.freeze(["Original Request", "Early Progress", "Context for Suffix"]);
const FILE_OPERATION_BLOCK = /<(?:read-files|modified-files)>[\\s\\S]*?<\\/(?:read-files|modified-files)>/gi;
function summarySections(summary) {
    const sections = new Map();
    let current;
    for (const line of summary.split(/\\r?\\n/)) {
        const heading = /^##\\s+(.+?)\\s*$/.exec(line);
        if (heading) {
            current = heading[1].trim().toLowerCase();
            if (!sections.has(current))
                sections.set(current, []);
            continue;
        }
        if (current)
            sections.get(current).push(line);
    }
    return sections;
}
function isSubstantiveSummarySection(lines) {
    const normalized = lines
        .join("\\n")
        .replace(/^#{3,}\\s+.*$/gm, "")
        .replace(/^\\s*(?:[-*+]\\s*)?\\[[ xX]\\]\\s*/gm, "")
        .replace(/^\\s*(?:[-*+]|\\d+[.)])\\s+/gm, "")
        .replace(/[\`*_>#()[\\]]/g, " ")
        .replace(/\\s+/g, " ")
        .trim();
    if (!normalized || /^(?:none|n\\/?a|not applicable|unknown|no (?:information|context|progress|steps?|request|goal)(?: available| provided| yet)?)[.!]*$/i.test(normalized)) {
        return false;
    }
    return normalized.replace(/[^\\p{L}\\p{N}]+/gu, "").length >= 4;
}
function summaryContentCharacters(summary) {
    return summary.replace(/[^\\p{L}\\p{N}]+/gu, "").length;
}
function minimumSummaryContentCharacters(sourceCharacters) {
    if (!Number.isFinite(sourceCharacters) || sourceCharacters <= 0)
        return 64;
    return Math.min(512, Math.max(64, Math.floor(sourceCharacters / 200)));
}
export function getSummaryUsabilityFailure(summary, label, requiredSections = CHECKPOINT_REQUIRED_SECTIONS, sourceCharacters) {
    const checkpoint = summary.replace(FILE_OPERATION_BLOCK, "").trim();
    if (!checkpoint) {
        return \`\${label} failed: generated an empty or file-list-only checkpoint\`;
    }
    const contentCharacters = summaryContentCharacters(checkpoint);
    const minimumCharacters = minimumSummaryContentCharacters(sourceCharacters);
    if (contentCharacters < minimumCharacters) {
        return \`\${label} failed: generated an implausibly small checkpoint (\${contentCharacters} content characters; minimum \${minimumCharacters})\`;
    }
    const sections = summarySections(checkpoint);
    const missing = requiredSections.filter((heading) => !isSubstantiveSummarySection(sections.get(heading.toLowerCase()) ?? []));
    if (missing.length > 0) {
        return \`\${label} failed: generated a structurally unusable checkpoint (missing substantive \${missing.join(", ")})\`;
    }
    return undefined;
}`;
const HISTORY_SUMMARY_USABILITY_GUARD = `    const usabilityFailure = getSummaryUsabilityFailure(textContent, "Summarization", undefined, conversationText.length + (previousSummary?.length ?? 0));
    if (usabilityFailure) {
        throw new Error(usabilityFailure);
    }`;
const TURN_PREFIX_SUMMARY_USABILITY_GUARD = `    const usabilityFailure = getSummaryUsabilityFailure(textContent, "Turn prefix summarization", TURN_PREFIX_REQUIRED_SECTIONS, conversationText.length);
    if (usabilityFailure) {
        throw new Error(usabilityFailure);
    }`;
const BRANCH_SUMMARY_USABILITY_GUARD = `    const usabilityFailure = getSummaryUsabilityFailure(summary, "Branch summarization", replaceInstructions && customInstructions ? [] : undefined, conversationText.length);
    if (usabilityFailure) {
        return { error: usabilityFailure };
    }`;
const EMPTY_BRANCH_HISTORY_RESULT = `    if (entries.length === 0) {
        return { summary: "No content to summarize" };
    }`;
const BRANCH_PREPARATION_CAPACITY_FAILURE = `    if (messages.length === 0) {
        return { error: "Branch summarization failed: non-empty branch history did not fit the conversation budget" };
    }`;
const BRANCH_SERIALIZATION_CAPACITY_FAILURE = `        if (messages.length === 0) {
            return { error: "Branch summarization failed: non-empty branch history did not fit the serialized request budget" };
        }`;

function countOccurrences(source, fragment) {
	return source.split(fragment).length - 1;
}

function replaceRequiredOccurrences(source, original, replacement, label, expectedCount = 1) {
	const count = countOccurrences(source, original);
	if (count !== expectedCount) {
		throw new Error(
			`Unsupported Pi ${PI_COMPACTION_TOOLS_REQUIRED_VERSION} ${label} layout; expected ${expectedCount} occurrence${expectedCount === 1 ? "" : "s"}, found ${count}`,
		);
	}
	return source.split(original).join(replacement);
}

function replaceRequired(source, original, replacement, label) {
	return replaceRequiredOccurrences(source, original, replacement, label, 1);
}

function assertFragments(source, relativePath, fragments) {
	for (const fragment of fragments) {
		if (!source.includes(fragment)) {
			throw new Error(`Incomplete Pi compaction tools patch ${relativePath}: missing ${fragment}`);
		}
	}
}

function assertAbsentFragments(source, relativePath, fragments) {
	for (const fragment of fragments) {
		if (source.includes(fragment)) {
			throw new Error(`Invalid Pi compaction tools patch ${relativePath}: retained ${fragment}`);
		}
	}
}

function assertExactOccurrences(source, relativePath, fragment, label, expectedCount = 1) {
	const count = countOccurrences(source, fragment);
	if (count !== expectedCount) {
		throw new Error(
			`Incomplete Pi compaction tools patch ${relativePath}: expected ${expectedCount} exact ${label}${expectedCount === 1 ? "" : "s"}, found ${count}`,
		);
	}
}

function stripStaleSourceMapDirective(source, sourceMapName, label) {
	const directive = `//# sourceMappingURL=${sourceMapName}`;
	const count = countOccurrences(source, directive);
	if (count > 1) {
		throw new Error(
			`Unsupported Pi ${PI_COMPACTION_TOOLS_REQUIRED_VERSION} ${label} layout; expected at most 1 source map directive, found ${count}`,
		);
	}
	return count === 1 ? source.replace(directive, "") : source;
}

function isFullCompactionSource(source) {
	return [
		"export const DEFAULT_COMPACTION_SETTINGS",
		"export function shouldCompact",
		"export function prepareCompaction",
	].some((fragment) => source.includes(fragment));
}

function isFullBranchSource(source) {
	return source.includes("export async function generateBranchSummary");
}

function isFullCompactionTypesSource(source) {
	return source.includes("export interface CompactionSettings") || source.includes("prepareCompaction(pathEntries:");
}

export function assertPiCompactionToolsPatchedSource(relativePath, source) {
	switch (relativePath) {
		case "dist/core/compaction/compaction.js": {
			assertFragments(source, relativePath, [
				PI_COMPACTION_TOOLS_PATCH_MARKERS.request,
				PI_COMPACTION_TOOLS_PATCH_MARKERS.historyResponse,
				PI_COMPACTION_TOOLS_PATCH_MARKERS.prefixResponse,
				PI_COMPACTION_TOOLS_PATCH_MARKERS.summaryFailure,
				'        toolChoice: "none",',
				"export function getSummarizationFailure(response, label) {",
				'response.stopReason === "length"',
				"generation hit the token cap and the summary is incomplete",
				'throw new Error("Summarization attempted to call a tool");',
				'throw new Error("Turn prefix summarization attempted to call a tool");',
			]);
			if (isFullCompactionSource(source)) {
				assertFragments(source, relativePath, [
					PI_COMPACTION_TOOLS_PATCH_MARKERS.contextBudgets,
					PI_COMPACTION_TOOLS_PATCH_MARKERS.summaryIntegrity,
					"export function getEffectiveCompactionSettings(settings, contextWindow) {",
					"const reserveCeiling = Math.max(1, Math.floor(windowTokens / 4));",
					"const keepRecentCeiling = Math.max(1, windowTokens - 2 * reserveTokens);",
					"return contextTokens > contextWindow - effectiveSettings.reserveTokens;",
					"export function prepareCompaction(pathEntries, settings, contextWindow) {",
					"findCutPoint(pathEntries, boundaryStart, boundaryEnd, effectiveSettings.keepRecentTokens)",
					"settings: effectiveSettings,",
					"export function getSummaryUsabilityFailure(summary, label, requiredSections = CHECKPOINT_REQUIRED_SECTIONS, sourceCharacters) {",
					"return Math.min(512, Math.max(64, Math.floor(sourceCharacters / 200)));",
					"const minimumCharacters = minimumSummaryContentCharacters(sourceCharacters);",
					'getSummaryUsabilityFailure(textContent, "Summarization", undefined, conversationText.length + (previousSummary?.length ?? 0))',
					'getSummaryUsabilityFailure(textContent, "Turn prefix summarization", TURN_PREFIX_REQUIRED_SECTIONS, conversationText.length)',
				]);
				assertExactOccurrences(
					source,
					relativePath,
					SUMMARY_USABILITY_HELPER_IMPLEMENTATION,
					"summary integrity helper implementation",
				);
				assertExactOccurrences(
					source,
					relativePath,
					HISTORY_SUMMARY_USABILITY_GUARD,
					"history summary usability guard",
				);
				assertExactOccurrences(
					source,
					relativePath,
					TURN_PREFIX_SUMMARY_USABILITY_GUARD,
					"turn-prefix summary usability guard",
				);
				assertAbsentFragments(source, relativePath, [
					"return contextTokens > contextWindow - settings.reserveTokens;",
					"findCutPoint(pathEntries, boundaryStart, boundaryEnd, settings.keepRecentTokens)",
					"text: contentText(response.content),",
					"if (false && usabilityFailure)",
				]);
			}
			assertAbsentFragments(source, relativePath, ["//# sourceMappingURL="]);
			return;
		}
		case "dist/core/compaction/branch-summarization.js": {
			assertFragments(source, relativePath, [
				PI_COMPACTION_TOOLS_PATCH_MARKERS.branchResponse,
				'const failure = getSummarizationFailure(response, "Branch summarization");',
				'return { error: "Branch summarization attempted to call a tool" };',
			]);
			if (isFullBranchSource(source)) {
				assertFragments(source, relativePath, [
					PI_COMPACTION_TOOLS_PATCH_MARKERS.contextBudgets,
					PI_COMPACTION_TOOLS_PATCH_MARKERS.branchRequestBudget,
					PI_COMPACTION_TOOLS_PATCH_MARKERS.branchHistoryCapacity,
					PI_COMPACTION_TOOLS_PATCH_MARKERS.branchIntegrity,
					"getEffectiveCompactionSettings",
					"getSummaryUsabilityFailure",
					"const effectiveSettings = getEffectiveCompactionSettings(",
					"const modelMaxTokens = Number.isFinite(model.maxTokens) && model.maxTokens > 0",
					"const systemPromptTokens = estimateTokens({ role: \"user\", content: SUMMARIZATION_SYSTEM_PROMPT, timestamp: 0 });",
					source.includes("const maxTokens = Math.min(4096, modelMaxTokens,")
						? "const maxTokens = Math.min(4096, modelMaxTokens, effectiveSettings.reserveTokens, contextWindow - emptyRequest.inputTokens - 1);"
						: "const maxTokens = Math.min(2048, modelMaxTokens, effectiveSettings.reserveTokens, contextWindow - emptyRequest.inputTokens - 1);",
					"const configuredConversationBudget = contextWindow - effectiveSettings.reserveTokens;",
					"const tokenBudget = Math.min(configuredConversationBudget, contextWindow - emptyRequest.inputTokens - maxTokens);",
					"const inputTokens = systemPromptTokens + estimateTokens(summarizationMessages[0]);",
					"while (messages.length > 0 && request.inputTokens + maxTokens > contextWindow)",
					"const requestOptions = { apiKey, headers, env, signal, maxTokens };",
					'getSummaryUsabilityFailure(summary, "Branch summarization", replaceInstructions && customInstructions ? [] : undefined, conversationText.length)',
				]);
				assertExactOccurrences(
					source,
					relativePath,
					EMPTY_BRANCH_HISTORY_RESULT,
					"genuinely empty branch result",
				);
				assertExactOccurrences(
					source,
					relativePath,
					BRANCH_PREPARATION_CAPACITY_FAILURE,
					"non-empty branch preparation failure",
				);
				assertExactOccurrences(
					source,
					relativePath,
					BRANCH_SERIALIZATION_CAPACITY_FAILURE,
					"non-empty branch serialization failure",
				);
				assertExactOccurrences(
					source,
					relativePath,
					'return { summary: "No content to summarize" };',
					"genuinely empty branch summary",
				);
				assertExactOccurrences(
					source,
					relativePath,
					BRANCH_SUMMARY_USABILITY_GUARD,
					"branch summary usability guard",
				);
				assertAbsentFragments(source, relativePath, [
					"const tokenBudget = contextWindow - reserveTokens;",
					"const tokenBudget = contextWindow - effectiveSettings.reserveTokens;",
					"maxTokens: 2048",
					"if (false && usabilityFailure)",
				]);
			} else {
				assertFragments(source, relativePath, [
					'import { completeSummarization, estimateTokens, getSummarizationFailure } from "./compaction.js";',
				]);
			}
			assertAbsentFragments(source, relativePath, ["//# sourceMappingURL="]);
			return;
		}
		case "dist/core/agent-session.js":
			assertFragments(source, relativePath, [PI_COMPACTION_TOOLS_PATCH_MARKERS.contextCallers]);
			if (countOccurrences(source, PI_COMPACTION_TOOLS_PATCH_MARKERS.contextCallers) !== 2) {
				throw new Error(`Incomplete Pi compaction tools patch ${relativePath}: expected two model-context call sites`);
			}
			if (countOccurrences(source, "prepareCompaction(pathEntries, settings, requestModel.contextWindow)") !== 2) {
				throw new Error(`Incomplete Pi compaction tools patch ${relativePath}: model context is not wired to both compaction paths`);
			}
			assertAbsentFragments(source, relativePath, ["prepareCompaction(pathEntries, settings);"]);
			return;
		case "dist/core/compaction/compaction.d.ts": {
			assertFragments(source, relativePath, [
				PI_COMPACTION_TOOLS_PATCH_MARKERS.summaryFailureTypes,
				"export declare function getSummarizationFailure(",
				"response: AssistantMessage",
				"label: string",
				"): string | undefined;",
			]);
			if (isFullCompactionTypesSource(source)) {
				assertFragments(source, relativePath, [
					PI_COMPACTION_TOOLS_PATCH_MARKERS.contextBudgetTypes,
					PI_COMPACTION_TOOLS_PATCH_MARKERS.summaryIntegrityTypes,
					"export declare function getEffectiveCompactionSettings(settings: CompactionSettings, contextWindow: number | undefined): CompactionSettings;",
					"export declare function getSummaryUsabilityFailure(summary: string, label: string, requiredSections?: readonly string[], sourceCharacters?: number): string | undefined;",
					"prepareCompaction(pathEntries: SessionEntry[], settings: CompactionSettings, contextWindow?: number)",
				]);
			}
			assertAbsentFragments(source, relativePath, ["//# sourceMappingURL="]);
			return;
		}
		default:
			throw new Error(`Unknown Pi compaction tools patch target: ${relativePath}`);
	}
}

function patchCompactionSource(source) {
	let patched = source;
	// 0.85.1 already rejects tool-call/truncated summaries and preserves the
	// caller's routing ID. Keep those exact upstream guards; add our budget
	// and content-integrity defenses below without duplicating exported helpers.
	if (!patched.includes(PI_COMPACTION_TOOLS_PATCH_MARKERS.request) &&
		patched.includes("sessionId: options.sessionId ?? uuidv7(),")) {
		patched = replaceRequired(patched,
			"        sessionId: options.sessionId ?? uuidv7(),",
			`        sessionId: options.sessionId ?? uuidv7(),\n        // ${PI_COMPACTION_TOOLS_PATCH_MARKERS.request}\n        toolChoice: "none",`,
			"upstream routing-aware summarization options");
		for (const [label, marker] of [
			["Summarization", PI_COMPACTION_TOOLS_PATCH_MARKERS.historyResponse],
			["Turn prefix summarization", PI_COMPACTION_TOOLS_PATCH_MARKERS.prefixResponse],
		]) {
			const guard = `    if (response.content.some((block) => block.type === "toolCall")) {\n        throw new Error("${label} attempted to call a tool");\n    }`;
			patched = replaceRequired(patched, guard, `    // ${marker}\n${guard}`, `upstream ${label} tool rejection`);
		}
		patched = replaceRequired(patched,
			"export function getSummarizationFailure(response, label) {",
			`// ${PI_COMPACTION_TOOLS_PATCH_MARKERS.summaryFailure}\nexport function getSummarizationFailure(response, label) {`,
			"upstream truncated-summary guard");
	}
	if (!patched.includes(PI_COMPACTION_TOOLS_PATCH_MARKERS.request)) {
		patched = replaceRequired(
			patched,
			[
				'        cacheRetention: "none",',
				"        sessionId: uuidv7(),",
			].join("\n"),
			[
				'        cacheRetention: "none",',
				"        sessionId: uuidv7(),",
				`        // ${PI_COMPACTION_TOOLS_PATCH_MARKERS.request}`,
				'        toolChoice: "none",',
			].join("\n"),
			"summarization request options",
		);
		patched = replaceRequired(
			patched,
			[
				'        throw new Error(`Summarization failed: ${response.errorMessage || "Unknown error"}`);',
				"    }",
				"    const textContent = contentText(response.content);",
			].join("\n"),
			[
				'        throw new Error(`Summarization failed: ${response.errorMessage || "Unknown error"}`);',
				"    }",
				`    // ${PI_COMPACTION_TOOLS_PATCH_MARKERS.historyResponse}`,
				'    if (response.content.some((block) => block.type === "toolCall")) {',
				'        throw new Error("Summarization attempted to call a tool");',
				"    }",
				"    const textContent = contentText(response.content);",
			].join("\n"),
			"history summary response",
		);
		patched = replaceRequired(
			patched,
			[
				'        throw new Error(`Turn prefix summarization failed: ${response.errorMessage || "Unknown error"}`);',
				"    }",
				"    return {",
			].join("\n"),
			[
				'        throw new Error(`Turn prefix summarization failed: ${response.errorMessage || "Unknown error"}`);',
				"    }",
				`    // ${PI_COMPACTION_TOOLS_PATCH_MARKERS.prefixResponse}`,
				'    if (response.content.some((block) => block.type === "toolCall")) {',
				'        throw new Error("Turn prefix summarization attempted to call a tool");',
				"    }",
				"    return {",
			].join("\n"),
			"turn-prefix summary response",
		);
	}
	if (!patched.includes(PI_COMPACTION_TOOLS_PATCH_MARKERS.summaryFailure)) {
		patched = replaceRequired(
			patched,
			"function createSummarizationOptions(",
			`// ${PI_COMPACTION_TOOLS_PATCH_MARKERS.summaryFailure}
export function getSummarizationFailure(response, label) {
    if (response.stopReason === "error") {
        return \`\${label} failed: \${response.errorMessage || "Unknown error"}\`;
    }
    if (response.stopReason === "length") {
        return \`\${label} failed: generation hit the token cap and the summary is incomplete\`;
    }
    return undefined;
}

function createSummarizationOptions(`,
			"summarization failure helper",
		);
		patched = replaceRequired(
			patched,
			`    if (response.stopReason === "error") {
        throw new Error(\`Summarization failed: \${response.errorMessage || "Unknown error"}\`);
    }`,
			`    const failure = getSummarizationFailure(response, "Summarization");
    if (failure) {
        throw new Error(failure);
    }`,
			"history summary failure",
		);
		patched = replaceRequired(
			patched,
			`    if (response.stopReason === "error") {
        throw new Error(\`Turn prefix summarization failed: \${response.errorMessage || "Unknown error"}\`);
    }`,
			`    const failure = getSummarizationFailure(response, "Turn prefix summarization");
    if (failure) {
        throw new Error(failure);
    }`,
			"turn-prefix summary failure",
		);
	}
	if (isFullCompactionSource(patched) && !patched.includes(PI_COMPACTION_TOOLS_PATCH_MARKERS.contextBudgets)) {
		patched = replaceRequired(
			patched,
			`export const DEFAULT_COMPACTION_SETTINGS = {
    enabled: true,
    reserveTokens: 16384,
    keepRecentTokens: 20000,
};`,
			`export const DEFAULT_COMPACTION_SETTINGS = {
    enabled: true,
    reserveTokens: 16384,
    keepRecentTokens: 20000,
};
// ${PI_COMPACTION_TOOLS_PATCH_MARKERS.contextBudgets}
export function getEffectiveCompactionSettings(settings, contextWindow) {
    if (!Number.isFinite(contextWindow) || contextWindow <= 0) {
        return settings;
    }
    const windowTokens = Math.max(4, Math.floor(contextWindow));
    const configuredReserve = Number.isFinite(settings.reserveTokens) && settings.reserveTokens > 0
        ? Math.floor(settings.reserveTokens)
        : DEFAULT_COMPACTION_SETTINGS.reserveTokens;
    const configuredKeepRecent = Number.isFinite(settings.keepRecentTokens) && settings.keepRecentTokens > 0
        ? Math.floor(settings.keepRecentTokens)
        : DEFAULT_COMPACTION_SETTINGS.keepRecentTokens;
    const reserveCeiling = Math.max(1, Math.floor(windowTokens / 4));
    const reserveTokens = Math.max(1, Math.min(configuredReserve, reserveCeiling));
    const keepRecentCeiling = Math.max(1, windowTokens - 2 * reserveTokens);
    const keepRecentTokens = Math.max(1, Math.min(configuredKeepRecent, keepRecentCeiling));
    if (reserveTokens === settings.reserveTokens && keepRecentTokens === settings.keepRecentTokens) {
        return settings;
    }
    return { ...settings, reserveTokens, keepRecentTokens };
}`,
			"default compaction settings",
		);
		patched = replaceRequired(
			patched,
			`export function shouldCompact(contextTokens, contextWindow, settings) {
    if (!settings.enabled)
        return false;
    return contextTokens > contextWindow - settings.reserveTokens;
}`,
			`export function shouldCompact(contextTokens, contextWindow, settings) {
    if (!settings.enabled)
        return false;
    const effectiveSettings = getEffectiveCompactionSettings(settings, contextWindow);
    return contextTokens > contextWindow - effectiveSettings.reserveTokens;
}`,
			"automatic compaction threshold",
		);
		patched = replaceRequired(
			patched,
			"export function prepareCompaction(pathEntries, settings) {",
			`export function prepareCompaction(pathEntries, settings, contextWindow) {
    const effectiveSettings = getEffectiveCompactionSettings(settings, contextWindow);`,
			"compaction preparation signature",
		);
		patched = replaceRequired(
			patched,
			"const cutPoint = findCutPoint(pathEntries, boundaryStart, boundaryEnd, settings.keepRecentTokens);",
			"const cutPoint = findCutPoint(pathEntries, boundaryStart, boundaryEnd, effectiveSettings.keepRecentTokens);",
			"compaction keep-recent budget",
		);
		patched = replaceRequired(
			patched,
			"        settings,\n    };",
			"        settings: effectiveSettings,\n    };",
			"compaction preparation settings",
		);
	}
	if (isFullCompactionSource(patched) && !patched.includes(PI_COMPACTION_TOOLS_PATCH_MARKERS.summaryIntegrity)) {
		patched = replaceRequired(
			patched,
			"\nfunction createSummarizationOptions(",
			`
// ${PI_COMPACTION_TOOLS_PATCH_MARKERS.summaryIntegrity}
${SUMMARY_USABILITY_HELPER_IMPLEMENTATION}

function createSummarizationOptions(`,
			"summary integrity helper",
		);
		patched = replaceRequired(
			patched,
			`    const textContent = contentText(response.content);
    return { text: textContent, usage: response.usage };`,
			`    const textContent = contentText(response.content);
${HISTORY_SUMMARY_USABILITY_GUARD}
    return { text: textContent, usage: response.usage };`,
			"history summary integrity",
		);
		patched = replaceRequired(
			patched,
			`    return {
        text: contentText(response.content),
        usage: response.usage,
    };`,
			`    const textContent = contentText(response.content);
${TURN_PREFIX_SUMMARY_USABILITY_GUARD}
    return {
        text: textContent,
        usage: response.usage,
    };`,
			"turn-prefix summary integrity",
		);
	}
	if (
		isFullCompactionSource(patched) &&
		patched.includes(PI_COMPACTION_TOOLS_PATCH_MARKERS.summaryIntegrity) &&
		!patched.includes("function minimumSummaryContentCharacters(")
	) {
		patched = replaceRequired(
			patched,
			`export function getSummaryUsabilityFailure(summary, label, requiredSections = CHECKPOINT_REQUIRED_SECTIONS) {
    const checkpoint = summary.replace(FILE_OPERATION_BLOCK, "").trim();`,
			`function summaryContentCharacters(summary) {
    return summary.replace(/[^\\p{L}\\p{N}]+/gu, "").length;
}
function minimumSummaryContentCharacters(sourceCharacters) {
    if (!Number.isFinite(sourceCharacters) || sourceCharacters <= 0)
        return 64;
    return Math.min(512, Math.max(64, Math.floor(sourceCharacters / 200)));
}
export function getSummaryUsabilityFailure(summary, label, requiredSections = CHECKPOINT_REQUIRED_SECTIONS, sourceCharacters) {
    const checkpoint = summary.replace(FILE_OPERATION_BLOCK, "").trim();`,
			"summary-size integrity helper",
		);
		patched = replaceRequired(
			patched,
			"    const sections = summarySections(checkpoint);",
			`    const contentCharacters = summaryContentCharacters(checkpoint);
    const minimumCharacters = minimumSummaryContentCharacters(sourceCharacters);
    if (contentCharacters < minimumCharacters) {
        return \`\${label} failed: generated an implausibly small checkpoint (\${contentCharacters} content characters; minimum \${minimumCharacters})\`;
    }
    const sections = summarySections(checkpoint);`,
			"summary-size integrity guard",
		);
		patched = replaceRequired(
			patched,
			'getSummaryUsabilityFailure(textContent, "Summarization")',
			'getSummaryUsabilityFailure(textContent, "Summarization", undefined, conversationText.length + (previousSummary?.length ?? 0))',
			"history summary-size integrity",
		);
		patched = replaceRequired(
			patched,
			'getSummaryUsabilityFailure(textContent, "Turn prefix summarization", TURN_PREFIX_REQUIRED_SECTIONS)',
			'getSummaryUsabilityFailure(textContent, "Turn prefix summarization", TURN_PREFIX_REQUIRED_SECTIONS, conversationText.length)',
			"turn-prefix summary-size integrity",
		);
	}
	if (
		isFullCompactionSource(patched) &&
		patched.includes(
			'getSummaryUsabilityFailure(textContent, "Summarization", undefined, conversationText.length)',
		)
	) {
		patched = replaceRequired(
			patched,
			'getSummaryUsabilityFailure(textContent, "Summarization", undefined, conversationText.length)',
			'getSummaryUsabilityFailure(textContent, "Summarization", undefined, conversationText.length + (previousSummary?.length ?? 0))',
			"incremental summary-size integrity",
		);
	}
	patched = stripStaleSourceMapDirective(
		patched,
		"compaction.js.map",
		"compaction JavaScript source map",
	);
	assertPiCompactionToolsPatchedSource("dist/core/compaction/compaction.js", patched);
	return patched;
}

function patchBranchSummarizationSource(source) {
	let patched = source;
	const upstreamMaxTokens = "    const maxTokens = Math.min(4096, model.maxTokens > 0 ? model.maxTokens : Number.POSITIVE_INFINITY);\n";
	const hasUpstreamBudget = patched.includes(upstreamMaxTokens);
	if (!patched.includes(PI_COMPACTION_TOOLS_PATCH_MARKERS.branchResponse) &&
		patched.includes('const failure = getSummarizationFailure(response, "Branch summarization");')) {
		const guard = `    if (response.content.some((block) => block.type === "toolCall")) {\n        return { error: "Branch summarization attempted to call a tool" };\n    }`;
		patched = replaceRequired(patched, guard,
			`    // ${PI_COMPACTION_TOOLS_PATCH_MARKERS.branchResponse}\n${guard}`, "upstream branch tool rejection");
	}
	if (hasUpstreamBudget) {
		patched = replaceRequired(patched, upstreamMaxTokens, "", "upstream branch output cap");
		patched = replaceRequired(patched,
			"    const requestOptions = { apiKey, headers, env, signal, maxTokens };",
			"    const requestOptions = { apiKey, headers, env, signal, maxTokens: 2048 };",
			"upstream branch request anchor");
	}
	if (!patched.includes(PI_COMPACTION_TOOLS_PATCH_MARKERS.branchResponse)) {
		patched = replaceRequired(
			patched,
			[
				'        return { error: response.errorMessage || "Summarization failed" };',
				"    }",
				"    let summary = contentText(response.content);",
			].join("\n"),
			[
				'        return { error: response.errorMessage || "Summarization failed" };',
				"    }",
				`    // ${PI_COMPACTION_TOOLS_PATCH_MARKERS.branchResponse}`,
				'    if (response.content.some((block) => block.type === "toolCall")) {',
				'        return { error: "Branch summarization attempted to call a tool" };',
				"    }",
				"    let summary = contentText(response.content);",
			].join("\n"),
			"branch summary response",
		);
	}
	if (!patched.includes("getSummarizationFailure")) {
		patched = replaceRequired(
			patched,
			'import { completeSummarization, estimateTokens } from "./compaction.js";',
			'import { completeSummarization, estimateTokens, getSummarizationFailure } from "./compaction.js";',
			"branch summary import",
		);
		patched = replaceRequired(
			patched,
			`    if (response.stopReason === "error") {
        return { error: response.errorMessage || "Summarization failed" };
    }`,
			`    const failure = getSummarizationFailure(response, "Branch summarization");
    if (failure) {
        return { error: failure };
    }`,
			"branch summary failure",
		);
	}
	if (isFullBranchSource(patched) && !patched.includes(PI_COMPACTION_TOOLS_PATCH_MARKERS.contextBudgets)) {
		patched = replaceRequired(
			patched,
			'import { completeSummarization, estimateTokens, getSummarizationFailure } from "./compaction.js";',
			'import { completeSummarization, estimateTokens, getEffectiveCompactionSettings, getSummarizationFailure, getSummaryUsabilityFailure } from "./compaction.js";',
			"branch compaction helper import",
		);
		patched = replaceRequired(
			patched,
			`    const contextWindow = model.contextWindow || 128000;
    const tokenBudget = contextWindow - reserveTokens;`,
			`    const contextWindow = model.contextWindow || 128000;
    // ${PI_COMPACTION_TOOLS_PATCH_MARKERS.contextBudgets}
    const effectiveSettings = getEffectiveCompactionSettings({ enabled: true, reserveTokens, keepRecentTokens: 1 }, contextWindow);
    const tokenBudget = contextWindow - effectiveSettings.reserveTokens;`,
			"branch summarization token budget",
		);
	}
	if (isFullBranchSource(patched) && !patched.includes(PI_COMPACTION_TOOLS_PATCH_MARKERS.branchRequestBudget)) {
		patched = replaceRequired(
			patched,
			`    // Token budget = context window minus reserved space for prompt + response
    const contextWindow = model.contextWindow || 128000;
    // ${PI_COMPACTION_TOOLS_PATCH_MARKERS.contextBudgets}
    const effectiveSettings = getEffectiveCompactionSettings({ enabled: true, reserveTokens, keepRecentTokens: 1 }, contextWindow);
    const tokenBudget = contextWindow - effectiveSettings.reserveTokens;
    const { messages, fileOps } = prepareBranchEntries(entries, tokenBudget);
    if (messages.length === 0) {
        return { summary: "No content to summarize" };
    }
    // Transform to LLM-compatible messages, then serialize to text
    // Serialization prevents the model from treating it as a conversation to continue
    const llmMessages = convertToLlm(messages);
    const conversationText = serializeConversation(llmMessages);
    // Build prompt
    let instructions;
    if (replaceInstructions && customInstructions) {
        instructions = customInstructions;
    }
    else if (customInstructions) {
        instructions = \`\${BRANCH_SUMMARY_PROMPT}\\n\\nAdditional focus: \${customInstructions}\`;
    }
    else {
        instructions = BRANCH_SUMMARY_PROMPT;
    }
    const promptText = \`<conversation>\\n\${conversationText}\\n</conversation>\\n\\n\${instructions}\`;
    const summarizationMessages = [
        {
            role: "user",
            content: [{ type: "text", text: promptText }],
            timestamp: Date.now(),
        },
    ];`,
			`    // ${PI_COMPACTION_TOOLS_PATCH_MARKERS.branchHistoryCapacity}
${EMPTY_BRANCH_HISTORY_RESULT}
    // Token budget includes the actual system prompt, serialized prompt, and output allowance.
    const contextWindow = Number.isFinite(model.contextWindow) && model.contextWindow > 0
        ? Math.max(1, Math.floor(model.contextWindow))
        : 128000;
    // ${PI_COMPACTION_TOOLS_PATCH_MARKERS.contextBudgets}
    const effectiveSettings = getEffectiveCompactionSettings({ enabled: true, reserveTokens, keepRecentTokens: 1 }, contextWindow);
    // ${PI_COMPACTION_TOOLS_PATCH_MARKERS.branchRequestBudget}
    const modelMaxTokens = Number.isFinite(model.maxTokens) && model.maxTokens > 0
        ? Math.floor(model.maxTokens)
        : Number.POSITIVE_INFINITY;
    let instructions;
    if (replaceInstructions && customInstructions) {
        instructions = customInstructions;
    }
    else if (customInstructions) {
        instructions = \`\${BRANCH_SUMMARY_PROMPT}\\n\\nAdditional focus: \${customInstructions}\`;
    }
    else {
        instructions = BRANCH_SUMMARY_PROMPT;
    }
    const systemPromptTokens = estimateTokens({ role: "user", content: SUMMARIZATION_SYSTEM_PROMPT, timestamp: 0 });
    const buildRequest = (branchMessages) => {
        // Transform to LLM-compatible messages, then serialize to text. Serialization
        // prevents the model from treating the branch as a conversation to continue.
        const conversationText = serializeConversation(convertToLlm(branchMessages));
        const promptText = \`<conversation>\\n\${conversationText}\\n</conversation>\\n\\n\${instructions}\`;
        const summarizationMessages = [
            {
                role: "user",
                content: [{ type: "text", text: promptText }],
                timestamp: Date.now(),
            },
        ];
        const inputTokens = systemPromptTokens + estimateTokens(summarizationMessages[0]);
        return { conversationText, summarizationMessages, inputTokens };
    };
    const emptyRequest = buildRequest([]);
    if (emptyRequest.inputTokens >= contextWindow - 1) {
        return { error: "Branch summarization prompt exceeds the model context window" };
    }
    const maxTokens = Math.min(2048, modelMaxTokens, effectiveSettings.reserveTokens, contextWindow - emptyRequest.inputTokens - 1);
    const configuredConversationBudget = contextWindow - effectiveSettings.reserveTokens;
    const tokenBudget = Math.min(configuredConversationBudget, contextWindow - emptyRequest.inputTokens - maxTokens);
    if (tokenBudget < 1) {
        return { error: "Branch summarization prompt leaves no conversation capacity" };
    }
    let { messages, fileOps } = prepareBranchEntries(entries, tokenBudget);
${BRANCH_PREPARATION_CAPACITY_FAILURE}
    let request = buildRequest(messages);
    while (messages.length > 0 && request.inputTokens + maxTokens > contextWindow) {
        messages = messages.slice(1);
${BRANCH_SERIALIZATION_CAPACITY_FAILURE}
        request = buildRequest(messages);
    }
    const { conversationText, summarizationMessages } = request;`,
			"branch summary context and output budget",
		);
		patched = replaceRequired(
			patched,
			"    const requestOptions = { apiKey, headers, env, signal, maxTokens: 2048 };",
			"    const requestOptions = { apiKey, headers, env, signal, maxTokens };",
			"branch summary output budget",
		);
	}
	if (
		isFullBranchSource(patched) &&
		patched.includes(PI_COMPACTION_TOOLS_PATCH_MARKERS.branchRequestBudget) &&
		!patched.includes(PI_COMPACTION_TOOLS_PATCH_MARKERS.branchHistoryCapacity)
	) {
		patched = replaceRequired(
			patched,
			"    // Token budget includes the actual system prompt, serialized prompt, and output allowance.",
			`    // ${PI_COMPACTION_TOOLS_PATCH_MARKERS.branchHistoryCapacity}
${EMPTY_BRANCH_HISTORY_RESULT}
    // Token budget includes the actual system prompt, serialized prompt, and output allowance.`,
			"genuinely empty branch result",
		);
		patched = replaceRequired(
			patched,
			`    if (messages.length === 0) {
        return { summary: "No content to summarize" };
    }`,
			BRANCH_PREPARATION_CAPACITY_FAILURE,
			"non-empty branch preparation failure",
		);
		patched = replaceRequired(
			patched,
			`        if (messages.length === 0) {
            return { summary: "No content to summarize" };
        }`,
			BRANCH_SERIALIZATION_CAPACITY_FAILURE,
			"non-empty branch serialization failure",
		);
	}
	if (isFullBranchSource(patched) && !patched.includes(PI_COMPACTION_TOOLS_PATCH_MARKERS.branchIntegrity)) {
		patched = replaceRequired(
			patched,
			"    let summary = contentText(response.content);",
			`    let summary = contentText(response.content);
    // ${PI_COMPACTION_TOOLS_PATCH_MARKERS.branchIntegrity}
${BRANCH_SUMMARY_USABILITY_GUARD}`,
			"branch summary integrity",
		);
	}
	if (
		isFullBranchSource(patched) &&
		patched.includes(PI_COMPACTION_TOOLS_PATCH_MARKERS.branchIntegrity) &&
		!patched.includes("replaceInstructions && customInstructions ? [] : undefined")
	) {
		patched = replaceRequired(
			patched,
			'getSummaryUsabilityFailure(summary, "Branch summarization")',
			'getSummaryUsabilityFailure(summary, "Branch summarization", replaceInstructions && customInstructions ? [] : undefined, conversationText.length)',
			"branch replacement-prompt summary integrity",
		);
	}
	patched = stripStaleSourceMapDirective(
		patched,
		"branch-summarization.js.map",
		"branch summarization JavaScript source map",
	);
	// Preserve upstream's increased reasoning allowance, still bounded by the
	// model limit and the measured serialized request budget.
	if (hasUpstreamBudget) {
		patched = replaceRequired(patched, "Math.min(2048, modelMaxTokens,",
			"Math.min(4096, modelMaxTokens,", "upstream branch reasoning allowance");
	}
	assertPiCompactionToolsPatchedSource("dist/core/compaction/branch-summarization.js", patched);
	return patched;
}

function patchAgentSessionSource(source) {
	let patched = source;
	if (!patched.includes(PI_COMPACTION_TOOLS_PATCH_MARKERS.contextCallers)) {
		patched = replaceRequiredOccurrences(
			patched,
			"            const preparation = prepareCompaction(pathEntries, settings);",
			`            // ${PI_COMPACTION_TOOLS_PATCH_MARKERS.contextCallers}
            const preparation = prepareCompaction(pathEntries, settings, requestModel.contextWindow);`,
			"agent-session compaction preparation",
			2,
		);
	}
	assertPiCompactionToolsPatchedSource("dist/core/agent-session.js", patched);
	return patched;
}

function patchCompactionTypesSource(source) {
	let patched = source;
	const upstreamFailureDeclaration = "export declare function getSummarizationFailure(response: AssistantMessage, label: string): string | undefined;";
	if (!patched.includes(PI_COMPACTION_TOOLS_PATCH_MARKERS.summaryFailureTypes) &&
		patched.includes(upstreamFailureDeclaration)) {
		patched = replaceRequired(patched, upstreamFailureDeclaration,
			`/** ${PI_COMPACTION_TOOLS_PATCH_MARKERS.summaryFailureTypes} */\n${upstreamFailureDeclaration}`,
			"upstream summarization failure declaration");
	}
	if (!patched.includes(PI_COMPACTION_TOOLS_PATCH_MARKERS.summaryFailureTypes)) {
		patched = replaceRequired(
			patched,
			"export declare function completeSummarization(",
			`/** ${PI_COMPACTION_TOOLS_PATCH_MARKERS.summaryFailureTypes} */
export declare function getSummarizationFailure(response: AssistantMessage, label: string): string | undefined;
export declare function completeSummarization(`,
			"compaction declarations",
		);
	}
	if (isFullCompactionTypesSource(patched) && !patched.includes(PI_COMPACTION_TOOLS_PATCH_MARKERS.contextBudgetTypes)) {
		patched = replaceRequired(
			patched,
			"export declare const DEFAULT_COMPACTION_SETTINGS: CompactionSettings;",
			`export declare const DEFAULT_COMPACTION_SETTINGS: CompactionSettings;
/** ${PI_COMPACTION_TOOLS_PATCH_MARKERS.contextBudgetTypes} */
export declare function getEffectiveCompactionSettings(settings: CompactionSettings, contextWindow: number | undefined): CompactionSettings;`,
			"compaction budget declarations",
		);
		patched = replaceRequired(
			patched,
			"export declare function prepareCompaction(pathEntries: SessionEntry[], settings: CompactionSettings): CompactionPreparation | undefined;",
			"export declare function prepareCompaction(pathEntries: SessionEntry[], settings: CompactionSettings, contextWindow?: number): CompactionPreparation | undefined;",
			"compaction preparation declaration",
		);
	}
	if (isFullCompactionTypesSource(patched) && !patched.includes(PI_COMPACTION_TOOLS_PATCH_MARKERS.summaryIntegrityTypes)) {
		patched = replaceRequired(
			patched,
			"export declare function completeSummarization(",
			`/** ${PI_COMPACTION_TOOLS_PATCH_MARKERS.summaryIntegrityTypes} */
export declare function getSummaryUsabilityFailure(summary: string, label: string, requiredSections?: readonly string[], sourceCharacters?: number): string | undefined;
export declare function completeSummarization(`,
			"summary integrity declaration",
		);
	}
	if (
		isFullCompactionTypesSource(patched) &&
		patched.includes(PI_COMPACTION_TOOLS_PATCH_MARKERS.summaryIntegrityTypes) &&
		!patched.includes("sourceCharacters?: number")
	) {
		patched = replaceRequired(
			patched,
			"export declare function getSummaryUsabilityFailure(summary: string, label: string, requiredSections?: readonly string[]): string | undefined;",
			"export declare function getSummaryUsabilityFailure(summary: string, label: string, requiredSections?: readonly string[], sourceCharacters?: number): string | undefined;",
			"summary-size integrity declaration",
		);
	}
	patched = stripStaleSourceMapDirective(
		patched,
		"compaction.d.ts.map",
		"compaction declaration source map",
	);
	assertPiCompactionToolsPatchedSource("dist/core/compaction/compaction.d.ts", patched);
	return patched;
}

export function patchPiCompactionToolsSource(relativePath, source) {
	switch (relativePath) {
		case "dist/core/compaction/compaction.js":
			return patchCompactionSource(source);
		case "dist/core/compaction/branch-summarization.js":
			return patchBranchSummarizationSource(source);
		case "dist/core/agent-session.js":
			return patchAgentSessionSource(source);
		case "dist/core/compaction/compaction.d.ts":
			return patchCompactionTypesSource(source);
		default:
			throw new Error(`Unknown Pi compaction tools patch target: ${relativePath}`);
	}
}
