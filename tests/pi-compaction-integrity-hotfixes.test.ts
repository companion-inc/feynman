import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
	cpSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import test from "node:test";

import {
	assertPiCompactionToolsPatchedSource,
	PI_COMPACTION_TOOLS_PATCH_MARKERS,
	PI_COMPACTION_TOOLS_PATCH_TARGETS,
	PI_COMPACTION_TOOLS_REQUIRED_VERSION,
	patchPiCompactionToolsSource,
} from "../scripts/lib/pi-compaction-tools-patch.mjs";
import {
	assertPiCompactionToolsPackageTree,
	verifyPiCompactionToolsBehavior,
} from "../scripts/lib/pi-compaction-tools-verifier.mjs";
import * as piCompactionToolsVerifier from "../scripts/lib/pi-compaction-tools-verifier.mjs";

const assertPiCompactionToolsArchive = (
	piCompactionToolsVerifier as unknown as {
		assertPiCompactionToolsArchive(readEntry: (entryPath: string) => string): void;
	}
).assertPiCompactionToolsArchive;

const appRoot = process.cwd();
const installedPackageRoot = resolve(
	appRoot,
	"node_modules",
	"@earendil-works",
	"pi-coding-agent",
);

function sha256(path: string): string {
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function assistantMessage(model: Record<string, unknown>, text: string, stopReason = "stop") {
	return {
		role: "assistant" as const,
		content: [{ type: "text" as const, text }],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: {
			input: 10,
			output: 10,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 20,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason,
		timestamp: Date.now(),
	};
}

function summaryStream(model: Record<string, unknown>, summaries: string[]) {
	let index = 0;
	return async () => ({
		result: async () => assistantMessage(model, summaries[Math.min(index++, summaries.length - 1)] ?? ""),
	});
}

function compactionPreparation(options: {
	isSplitTurn?: boolean;
	file?: string;
	settings?: { enabled: boolean; reserveTokens: number; keepRecentTokens: number };
} = {}) {
	return {
		firstKeptEntryId: "kept-entry",
		messagesToSummarize: options.isSplitTurn
			? []
			: [{ role: "user" as const, content: "Preserve this research history.", timestamp: 1 }],
		turnPrefixMessages: options.isSplitTurn
			? [{ role: "user" as const, content: "Verify the BRCA1 evidence trail.", timestamp: 1 }]
			: [],
		isSplitTurn: options.isSplitTurn ?? false,
		tokensBefore: 7000,
		fileOps: {
			read: new Set(options.file ? [options.file] : []),
			written: new Set<string>(),
			edited: new Set<string>(),
		},
		settings: options.settings ?? { enabled: true, reserveTokens: 2048, keepRecentTokens: 4096 },
	};
}

const checkpointSummary = [
	"## Goal",
	"Verify the BRCA1 claim against the primary paper.",
	"",
	"## Progress",
	"- Located the cited experiment and recorded its DOI.",
	"",
	"## Next Steps",
	"1. Reproduce the reported confidence interval.",
].join("\n");

const turnPrefixSummary = [
	"## Original Request",
	"Verify the BRCA1 evidence trail.",
	"",
	"## Early Progress",
	"- Located the paper and extracted the reported cohort size.",
	"",
	"## Context for Suffix",
	"- The retained work still needs an independent confidence-interval check.",
].join("\n");

async function withPatchedFixture(
	run: (fixtureAppRoot: string, packageRoot: string) => Promise<void>,
): Promise<void> {
	const fixtureAppRoot = mkdtempSync(resolve(appRoot, ".pi-compaction-hotfix-"));
	const packageRoot = resolve(
		fixtureAppRoot,
		"node_modules",
		"@earendil-works",
		"pi-coding-agent",
	);
	try {
		cpSync(installedPackageRoot, packageRoot, { recursive: true });
		for (const relativePath of PI_COMPACTION_TOOLS_PATCH_TARGETS) {
			const target = resolve(packageRoot, ...relativePath.split("/"));
			const source = readFileSync(target, "utf8");
			writeFileSync(target, patchPiCompactionToolsSource(relativePath, source));
		}
		await run(fixtureAppRoot, packageRoot);
	} finally {
		rmSync(fixtureAppRoot, { recursive: true, force: true });
	}
}

function disableUsabilityGuard(
	label: string,
	source: string,
	guardCall: string,
	disabledCondition: string,
): string {
	const enabledGuard = `${guardCall}\n    if (usabilityFailure) {`;
	const disabledGuard = `${guardCall}\n    if (${disabledCondition}) {`;
	const mutated = source.replace(enabledGuard, disabledGuard);
	assert.notEqual(mutated, source, `failed to mutate ${label} usability guard`);
	return mutated;
}

function disableSummaryHelper(
	label: string,
	source: string,
	original: string,
	replacement: string,
): string {
	const mutated = source.replace(original, replacement);
	assert.notEqual(mutated, source, `failed to mutate ${label} summary helper`);
	return mutated;
}

test("Pi 0.85.1 compaction hotfix transforms are exact, idempotent, and fail closed", async () => {
	assert.equal(PI_COMPACTION_TOOLS_REQUIRED_VERSION, "0.85.1");
	const installedHashes = new Map<string, string>();
	for (const relativePath of PI_COMPACTION_TOOLS_PATCH_TARGETS) {
		const target = resolve(installedPackageRoot, ...relativePath.split("/"));
		installedHashes.set(relativePath, sha256(target));
		const source = readFileSync(target, "utf8");
		const patched = patchPiCompactionToolsSource(relativePath, source);
		assert.equal(patchPiCompactionToolsSource(relativePath, patched), patched, relativePath);
		assert.doesNotThrow(() => assertPiCompactionToolsPatchedSource(relativePath, patched));
	}

	const compactionPath = resolve(
		installedPackageRoot,
		"dist/core/compaction/compaction.js",
	);
	const unsupportedLayout = readFileSync(compactionPath, "utf8").replace(
		"return contextTokens > contextWindow - effectiveSettings.reserveTokens;",
		"return contextTokens >= contextWindow - effectiveSettings.reserveTokens;",
	);
	assert.throws(
		() => patchPiCompactionToolsSource("dist/core/compaction/compaction.js", unsupportedLayout),
		/effectiveSettings\.reserveTokens/,
	);

	const patchedCompaction = patchPiCompactionToolsSource(
		"dist/core/compaction/compaction.js",
		readFileSync(compactionPath, "utf8"),
	);
	const branchPath = resolve(
		installedPackageRoot,
		"dist/core/compaction/branch-summarization.js",
	);
	const patchedBranch = patchPiCompactionToolsSource(
		"dist/core/compaction/branch-summarization.js",
		readFileSync(branchPath, "utf8"),
	);
	assert.throws(
		() => assertPiCompactionToolsPatchedSource(
			"dist/core/compaction/compaction.js",
			patchedCompaction.replace(
				"const keepRecentCeiling = Math.max(1, windowTokens - 2 * reserveTokens);",
				"const keepRecentCeiling = Math.max(1, windowTokens - reserveTokens);",
			),
		),
		/keepRecentCeiling/,
	);
	assert.throws(
		() => assertPiCompactionToolsPatchedSource(
				"dist/core/compaction/compaction.js",
				patchedCompaction.replace(
					'const usabilityFailure = getSummaryUsabilityFailure(textContent, "Summarization", undefined, conversationText.length + (previousSummary?.length ?? 0));',
					"const usabilityFailure = undefined;",
				),
		),
		/getSummaryUsabilityFailure/,
	);
	assert.throws(
		() => assertPiCompactionToolsPatchedSource(
			"dist/core/compaction/compaction.js",
			patchedCompaction.replace(
				"return Math.min(512, Math.max(64, Math.floor(sourceCharacters / 200)));",
				"return 64;",
			),
		),
		/sourceCharacters \/ 200/,
	);
	const guardMutations = [
		{
			label: "history",
			relativePath: "dist/core/compaction/compaction.js",
			source: patchedCompaction,
			guardCall:
				'    const usabilityFailure = getSummaryUsabilityFailure(textContent, "Summarization", undefined, conversationText.length + (previousSummary?.length ?? 0));',
			disabledCondition: "false && usabilityFailure",
		},
		{
			label: "split-turn",
			relativePath: "dist/core/compaction/compaction.js",
			source: patchedCompaction,
			guardCall:
				'    const usabilityFailure = getSummaryUsabilityFailure(textContent, "Turn prefix summarization", TURN_PREFIX_REQUIRED_SECTIONS, conversationText.length);',
			disabledCondition: "Boolean(false) && usabilityFailure",
		},
		{
			label: "branch",
			relativePath: "dist/core/compaction/branch-summarization.js",
			source: patchedBranch,
			guardCall:
				'    const usabilityFailure = getSummaryUsabilityFailure(summary, "Branch summarization", replaceInstructions && customInstructions ? [] : undefined, conversationText.length);',
			disabledCondition: "usabilityFailure && false",
		},
	] as const;
	for (const mutation of guardMutations) {
		const disabledGuard = disableUsabilityGuard(
			mutation.label,
			mutation.source,
			mutation.guardCall,
			mutation.disabledCondition,
		);
		assert.throws(
			() => assertPiCompactionToolsPatchedSource(mutation.relativePath, disabledGuard),
			/usability guard/,
			`${mutation.label} disabled guard must fail source assertion`,
		);
		assert.throws(
			() => patchPiCompactionToolsSource(mutation.relativePath, disabledGuard),
			/usability guard/,
			`${mutation.label} disabled guard must fail migration`,
		);
	}
	const helperMutations = [
		{
			label: "early-return",
			original:
				"export function getSummaryUsabilityFailure(summary, label, requiredSections = CHECKPOINT_REQUIRED_SECTIONS, sourceCharacters) {\n    const checkpoint",
			replacement:
				"export function getSummaryUsabilityFailure(summary, label, requiredSections = CHECKPOINT_REQUIRED_SECTIONS, sourceCharacters) {\n    return undefined;\n    const checkpoint",
		},
		{
			label: "minimum-size",
			original: "    if (contentCharacters < minimumCharacters) {",
			replacement: "    if (false && contentCharacters < minimumCharacters) {",
		},
		{
			label: "required-sections",
			original: "    if (missing.length > 0) {",
			replacement: "    if (false && missing.length > 0) {",
		},
	] as const;
	for (const mutation of helperMutations) {
		const disabledHelper = disableSummaryHelper(
			mutation.label,
			patchedCompaction,
			mutation.original,
			mutation.replacement,
		);
		assert.throws(
			() => assertPiCompactionToolsPatchedSource(
				"dist/core/compaction/compaction.js",
				disabledHelper,
			),
			/summary integrity helper implementation/,
			`${mutation.label} disabled helper must fail source assertion`,
		);
		assert.throws(
			() => patchPiCompactionToolsSource(
				"dist/core/compaction/compaction.js",
				disabledHelper,
			),
			/summary integrity helper implementation/,
			`${mutation.label} disabled helper must fail migration`,
		);
	}

	await withPatchedFixture(async (fixtureAppRoot, packageRoot) => {
		assert.doesNotThrow(() => assertPiCompactionToolsPackageTree(
			fixtureAppRoot,
			(path) => readFileSync(path, "utf8"),
		));
		await verifyPiCompactionToolsBehavior(fixtureAppRoot);
		assert.throws(
			() => assertPiCompactionToolsPackageTree(
				fixtureAppRoot,
				(path) => path.endsWith("pi-coding-agent/package.json")
					? JSON.stringify({ ...JSON.parse(readFileSync(path, "utf8")), version: "0.84.3" })
					: readFileSync(path, "utf8"),
			),
			/0\.84\.3.*0\.85\.1|0\.85\.1.*0\.84\.3/,
		);
		for (const mutation of guardMutations) {
			const target = resolve(packageRoot, ...mutation.relativePath.split("/"));
			const disabledGuard = disableUsabilityGuard(
				mutation.label,
				readFileSync(target, "utf8"),
				mutation.guardCall,
				mutation.disabledCondition,
			);
			assert.throws(
				() => assertPiCompactionToolsPackageTree(
					fixtureAppRoot,
					(path) => path === target ? disabledGuard : readFileSync(path, "utf8"),
				),
				/usability guard|false && usabilityFailure/,
			);
			assert.throws(
				() => assertPiCompactionToolsArchive(
					(entryPath: string) => entryPath.endsWith(mutation.relativePath)
						? disabledGuard
						: readFileSync(
							resolve(
								packageRoot,
								...entryPath
									.replace("npm/node_modules/@earendil-works/pi-coding-agent/", "")
									.split("/"),
							),
							"utf8",
						),
					),
					/usability guard|false && usabilityFailure/,
			);
		}
		for (const mutation of helperMutations) {
			const target = resolve(
				packageRoot,
				"dist/core/compaction/compaction.js",
			);
			const disabledHelper = disableSummaryHelper(
				mutation.label,
				readFileSync(target, "utf8"),
				mutation.original,
				mutation.replacement,
			);
			assert.throws(
				() => assertPiCompactionToolsPackageTree(
					fixtureAppRoot,
					(path) => path === target ? disabledHelper : readFileSync(path, "utf8"),
				),
				/summary integrity helper implementation/,
				`${mutation.label} disabled helper must fail package verification`,
			);
			assert.throws(
				() => assertPiCompactionToolsArchive(
					(entryPath: string) => entryPath.endsWith(
						"dist/core/compaction/compaction.js",
					)
						? disabledHelper
						: readFileSync(
							resolve(
								packageRoot,
								...entryPath
									.replace("npm/node_modules/@earendil-works/pi-coding-agent/", "")
									.split("/"),
							),
							"utf8",
						),
				),
				/summary integrity helper implementation/,
				`${mutation.label} disabled helper must fail archive verification`,
			);
		}
	});

	for (const [relativePath, hash] of installedHashes) {
		assert.equal(
			sha256(resolve(installedPackageRoot, ...relativePath.split("/"))),
			hash,
			`installed runtime changed: ${relativePath}`,
		);
	}
});

test("model-bounded budgets preserve large-context behavior and make 8K compaction viable", async () => {
	await withPatchedFixture(async (_fixtureAppRoot, packageRoot) => {
		const compaction = await import(
			`${pathToFileURL(resolve(packageRoot, "dist/core/compaction/compaction.js")).href}?budget=${Date.now()}`
		);
		const branch = await import(
			`${pathToFileURL(resolve(packageRoot, "dist/core/compaction/branch-summarization.js")).href}?budget=${Date.now()}`
		);
		const defaults = compaction.DEFAULT_COMPACTION_SETTINGS;
		assert.deepEqual(
			compaction.getEffectiveCompactionSettings(defaults, 8192),
			{ enabled: true, reserveTokens: 2048, keepRecentTokens: 4096 },
		);
		assert.equal(compaction.shouldCompact(0, 8192, defaults), false);
		assert.equal(compaction.shouldCompact(6144, 8192, defaults), false);
		assert.equal(compaction.shouldCompact(6145, 8192, defaults), true);

		assert.strictEqual(
			compaction.getEffectiveCompactionSettings(defaults, 128000),
			defaults,
			"normal contexts must retain the exact existing settings object",
		);
		assert.equal(compaction.shouldCompact(111616, 128000, defaults), false);
		assert.equal(compaction.shouldCompact(111617, 128000, defaults), true);

		const pathEntries = [
			{
				type: "message",
				id: "entry-1",
				parentId: null,
				timestamp: new Date(1).toISOString(),
				message: { role: "user", content: "A".repeat(12000), timestamp: 1 },
			},
			{
				type: "message",
				id: "entry-2",
				parentId: "entry-1",
				timestamp: new Date(2).toISOString(),
				message: { role: "assistant", content: [{ type: "text", text: "B".repeat(8000) }], timestamp: 2 },
			},
			{
				type: "message",
				id: "entry-3",
				parentId: "entry-2",
				timestamp: new Date(3).toISOString(),
				message: { role: "user", content: "C".repeat(12000), timestamp: 3 },
			},
			{
				type: "message",
				id: "entry-4",
				parentId: "entry-3",
				timestamp: new Date(4).toISOString(),
				message: { role: "assistant", content: [{ type: "text", text: "D".repeat(8000) }], timestamp: 4 },
			},
		];
		const preparation = compaction.prepareCompaction(pathEntries, defaults, 8192);
		assert.ok(preparation, "expected a small-context compaction preparation");
		assert.deepEqual(preparation.settings, {
			enabled: true,
			reserveTokens: 2048,
			keepRecentTokens: 4096,
		});

		const baseModel = {
			id: "branch-budget-test",
			name: "Branch Budget Test",
			api: "openai-completions",
			provider: "test",
			baseUrl: "https://example.invalid/v1",
			reasoning: false,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 128000,
			maxTokens: 4096,
		};
		const budgetCheckpointSummary = `${checkpointSummary}\n\n${"Preserve the exact research evidence, methods, provenance, and reproduction state. ".repeat(12)}`;
		const verifyBranchBudget = async (
			model: typeof baseModel,
			entries: Array<Record<string, unknown>>,
			expectedMaxTokens: number,
		) => {
			let observedContext: {
				systemPrompt?: string;
				messages: Array<Record<string, unknown>>;
			} | undefined;
			let observedOptions: { maxTokens: number } | undefined;
			const streamFn = async (
				_model: Record<string, unknown>,
				context: typeof observedContext,
				options: typeof observedOptions,
			) => {
				observedContext = context;
				observedOptions = options;
				return {
					result: async () => assistantMessage(model, budgetCheckpointSummary),
				};
			};
			const result = await branch.generateBranchSummary(entries, {
				model,
				apiKey: "test",
				streamFn,
			});
			assert.equal(result.error, undefined);
			assert.ok(observedContext);
			assert.ok(observedOptions);
			assert.equal(observedOptions.maxTokens, expectedMaxTokens);
			assert.ok(observedOptions.maxTokens <= model.maxTokens);
			const inputTokens =
				Math.ceil((observedContext.systemPrompt?.length ?? 0) / 4) +
				observedContext.messages.reduce(
					(total, message) => total + compaction.estimateTokens(message),
					0,
				);
			assert.ok(
				inputTokens + observedOptions.maxTokens <= model.contextWindow,
				`${model.contextWindow}-token branch request exceeded its context`,
			);
			return observedContext;
		};
		const nearBudgetEntries = Array.from({ length: 30 }, (_, index) => ({
			type: "message",
			id: `branch-budget-${index}`,
			parentId: index === 0 ? null : `branch-budget-${index - 1}`,
			timestamp: new Date(index + 1).toISOString(),
			message: { role: "user", content: "A".repeat(800), timestamp: index + 1 },
		}));
		await verifyBranchBudget(
			{ ...baseModel, contextWindow: 8192 },
			nearBudgetEntries,
			2048,
		);
		await verifyBranchBudget(
			{ ...baseModel, contextWindow: 1024, maxTokens: 128 },
			[{
				type: "message",
				id: "branch-budget-tiny",
				parentId: null,
				timestamp: new Date(1).toISOString(),
				message: { role: "user", content: "B".repeat(1200), timestamp: 1 },
			}],
			128,
		);
		const replacementInstructions = "R".repeat(2350);
		assert.equal(replacementInstructions.length, 2350);
		const constrainedModel = {
			...baseModel,
			contextWindow: 1024,
			maxTokens: 1024,
		};
		let constrainedStreamCalls = 0;
		const constrainedStream = async () => {
			constrainedStreamCalls += 1;
			return {
				result: async () => assistantMessage(
					constrainedModel,
					budgetCheckpointSummary,
				),
			};
		};
		const genuinelyEmpty = await branch.generateBranchSummary([], {
			model: constrainedModel,
			apiKey: "test",
			customInstructions: replacementInstructions,
			replaceInstructions: true,
			streamFn: constrainedStream,
		});
		assert.deepEqual(genuinelyEmpty, { summary: "No content to summarize" });
		assert.equal(constrainedStreamCalls, 0);

		const constrainedEntry = (characters: number) => [{
			type: "message",
			id: `branch-capacity-${characters}`,
			parentId: null,
			timestamp: new Date(1).toISOString(),
			message: { role: "user", content: "A".repeat(characters), timestamp: 1 },
		}];
		const preparationFailure = await branch.generateBranchSummary(
			constrainedEntry(400),
			{
				model: constrainedModel,
				apiKey: "test",
				customInstructions: replacementInstructions,
				replaceInstructions: true,
				streamFn: constrainedStream,
			},
		);
		assert.equal(preparationFailure.summary, undefined);
		assert.match(
			preparationFailure.error ?? "",
			/non-empty branch history did not fit the conversation budget/,
		);
		assert.equal(constrainedStreamCalls, 0);

		const serializationFailure = await branch.generateBranchSummary(
			constrainedEntry(370),
			{
				model: constrainedModel,
				apiKey: "test",
				customInstructions: replacementInstructions,
				replaceInstructions: true,
				streamFn: constrainedStream,
			},
		);
		assert.equal(serializationFailure.summary, undefined);
		assert.match(
			serializationFailure.error ?? "",
			/non-empty branch history did not fit the serialized request budget/,
		);
		assert.equal(constrainedStreamCalls, 0);

		const constrainedControl = await branch.generateBranchSummary(
			constrainedEntry(100),
			{
				model: constrainedModel,
				apiKey: "test",
				customInstructions: replacementInstructions,
				replaceInstructions: true,
				streamFn: constrainedStream,
			},
		);
		assert.equal(constrainedControl.error, undefined);
		assert.match(constrainedControl.summary ?? "", /Verify the BRCA1 claim/);
		assert.equal(constrainedStreamCalls, 1);

		const largeContext = await verifyBranchBudget(
			baseModel,
			Array.from({ length: 114 }, (_, index) => ({
				type: "message",
				id: `branch-budget-large-${index}`,
				parentId: index === 0 ? null : `branch-budget-large-${index - 1}`,
				timestamp: new Date(index + 1).toISOString(),
				message: {
					role: "user",
					content: `${index === 0 ? "OLDEST_BRANCH_SENTINEL" : "branch"}${"C".repeat(3980)}`,
					timestamp: index + 1,
				},
			})),
			4096,
		);
		const largePrompt = JSON.stringify(largeContext.messages);
		assert.doesNotMatch(
			largePrompt,
			/OLDEST_BRANCH_SENTINEL/,
			"128K branch summaries must retain Pi's existing 16K reserve",
		);
		assert.match(largePrompt, /branchC{100}/, "newest branch context should remain");

		const agentSessionSource = readFileSync(resolve(packageRoot, "dist/core/agent-session.js"), "utf8");
		assert.equal(
			agentSessionSource.split(PI_COMPACTION_TOOLS_PATCH_MARKERS.contextCallers).length - 1,
			2,
			"manual and automatic compaction must both pass the active model context",
		);
	});
});

test("history, split-turn, and branch compaction reject unusable checkpoints", async () => {
	await withPatchedFixture(async (_fixtureAppRoot, packageRoot) => {
		const nonce = Date.now();
		const compaction = await import(
			`${pathToFileURL(resolve(packageRoot, "dist/core/compaction/compaction.js")).href}?integrity=${nonce}`
		);
		const branch = await import(
			`${pathToFileURL(resolve(packageRoot, "dist/core/compaction/branch-summarization.js")).href}?integrity=${nonce}`
		);
		const model = {
			id: "research-checkpoint-test",
			name: "Research Checkpoint Test",
			api: "openai-completions",
			provider: "test",
			baseUrl: "https://example.invalid/v1",
			reasoning: false,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 8192,
			maxTokens: 2048,
		};

		assert.match(
			compaction.getSummaryUsabilityFailure("", "Summarization") ?? "",
			/empty or file-list-only checkpoint/,
		);
		assert.match(
			compaction.getSummaryUsabilityFailure(
				"<read-files>\npapers/brca1.pdf\n</read-files>",
				"Summarization",
			) ?? "",
			/empty or file-list-only checkpoint/,
		);
		assert.match(
			compaction.getSummaryUsabilityFailure(
				"The paper was read and there may be more work to do.",
				"Summarization",
			) ?? "",
			/implausibly small checkpoint|structurally unusable checkpoint/,
		);
		assert.match(
			compaction.getSummaryUsabilityFailure(
				[
					"## Goal",
					"(none)",
					"## Progress",
					"### Done",
					"- [x] none",
					"## Next Steps",
					"1. none",
				].join("\n"),
				"Summarization",
			) ?? "",
			/implausibly small checkpoint|structurally unusable checkpoint/,
		);
		assert.equal(
			compaction.getSummaryUsabilityFailure(checkpointSummary, "Summarization"),
			undefined,
		);
		const tinyStructuredStub = [
			"## Goal",
			"Research",
			"## Progress",
			"Started",
			"## Next Steps",
			"Continue",
		].join("\n");
		assert.match(
			compaction.getSummaryUsabilityFailure(
				tinyStructuredStub,
				"Summarization",
				undefined,
				100_000,
			) ?? "",
			/implausibly small checkpoint/,
		);
		await assert.rejects(
			() => compaction.generateSummaryWithUsage(
				[{ role: "user", content: "A".repeat(100_000), timestamp: 1 }],
				model,
				2048,
				"test",
				undefined,
				undefined,
				undefined,
				undefined,
				"off",
				summaryStream(model, [tinyStructuredStub]),
			),
			/implausibly small checkpoint/,
		);
		await assert.rejects(
			() => compaction.generateSummaryWithUsage(
				[{ role: "user", content: "Record one new observation.", timestamp: 1 }],
				model,
				2048,
				"test",
				undefined,
				undefined,
				undefined,
				`## Goal\n${"A".repeat(100_000)}\n## Progress\nPrior work\n## Next Steps\nContinue`,
				"off",
				summaryStream(model, [checkpointSummary]),
			),
			/implausibly small checkpoint/,
		);

		await assert.rejects(
			() => compaction.compact(
				compactionPreparation({ file: "papers/brca1.pdf" }),
				model,
				"test",
				undefined,
				undefined,
				undefined,
				undefined,
				summaryStream(model, [""]),
			),
			/empty or file-list-only checkpoint/,
		);
		await assert.rejects(
			() => compaction.compact(
				compactionPreparation(),
				model,
				"test",
				undefined,
				undefined,
				undefined,
				undefined,
				summaryStream(model, ["The paper was read, but the checkpoint has no structure."]),
			),
			/implausibly small checkpoint|structurally unusable checkpoint/,
		);
		const historyResult = await compaction.compact(
			compactionPreparation({ file: "papers/brca1.pdf" }),
			model,
			"test",
			undefined,
			undefined,
			undefined,
			undefined,
			summaryStream(model, [checkpointSummary]),
		);
		assert.match(historyResult.summary, /Verify the BRCA1 claim/);
		assert.match(historyResult.summary, /<read-files>\npapers\/brca1\.pdf\n<\/read-files>/);

		await assert.rejects(
			() => compaction.compact(
				compactionPreparation({ isSplitTurn: true }),
				model,
				"test",
				undefined,
				undefined,
				undefined,
				undefined,
				summaryStream(model, [""]),
			),
			/empty or file-list-only checkpoint/,
		);
		const splitResult = await compaction.compact(
			compactionPreparation({ isSplitTurn: true }),
			model,
			"test",
			undefined,
			undefined,
			undefined,
			undefined,
			summaryStream(model, [turnPrefixSummary]),
		);
		assert.match(splitResult.summary, /Turn Context \(split turn\)/);
		assert.match(splitResult.summary, /independent confidence-interval check/);

		const entries = [{
			type: "message",
			id: "branch-entry",
			parentId: null,
			timestamp: new Date(1).toISOString(),
			message: { role: "user", content: "Investigate the alternate BRCA1 method.", timestamp: 1 },
		}];
		const unusableBranch = await branch.generateBranchSummary(entries, {
			model,
			apiKey: "test",
			streamFn: summaryStream(model, [""]),
		});
		assert.match(unusableBranch.error ?? "", /empty or file-list-only checkpoint/);
		const acceptedBranch = await branch.generateBranchSummary(entries, {
			model,
			apiKey: "test",
			streamFn: summaryStream(model, [checkpointSummary]),
		});
		assert.match(acceptedBranch.summary ?? "", /Summary of that exploration/);
		assert.match(acceptedBranch.summary ?? "", /Reproduce the reported confidence interval/);
		const customReplacementSummary =
			"The alternate branch established that the primary paper used a distinct BRCA1 cohort, recorded the exact DOI and sample size, and left an independent confidence-interval reproduction as the next research step.";
		const customBranch = await branch.generateBranchSummary(entries, {
			model,
			apiKey: "test",
			customInstructions: "Return one concise paragraph with the result and next research step.",
			replaceInstructions: true,
			streamFn: summaryStream(model, [customReplacementSummary]),
		});
		assert.equal(customBranch.error, undefined);
		assert.match(customBranch.summary ?? "", /alternate branch established/);
	});
});
