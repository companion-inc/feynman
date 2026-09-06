import assert from "node:assert/strict";
import {
	existsSync,
	readFileSync,
	readdirSync,
	realpathSync,
	statSync,
} from "node:fs";
import { resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

import {
	assertPiCompactionToolsPatchedSource,
	PI_COMPACTION_TOOLS_PATCH_TARGETS,
	PI_COMPACTION_TOOLS_RUNTIME_TARGETS,
	PI_COMPACTION_TOOLS_REQUIRED_VERSION,
} from "./pi-compaction-tools-patch.mjs";

export function resolvePiCompactionToolsPackageTargets(options = {}) {
	return options.prunedNative
		? PI_COMPACTION_TOOLS_RUNTIME_TARGETS
		: PI_COMPACTION_TOOLS_PATCH_TARGETS;
}

export function isPiCompactionToolsNativePackageRoot(packageRoot) {
	const bundleRoot = resolve(packageRoot, "..");
	const nativeNodePath =
		process.platform === "win32"
			? resolve(bundleRoot, "node", "node.exe")
			: resolve(bundleRoot, "node", "bin", "node");
	if (!existsSync(nativeNodePath)) return false;
	try {
		const stats = statSync(nativeNodePath);
		return (
			stats.isFile() &&
			stats.size > 0 &&
			realpathSync(nativeNodePath) === realpathSync(process.execPath)
		);
	} catch {
		return false;
	}
}

const PRUNED_NATIVE_FORBIDDEN_FILE_PATTERNS = Object.freeze([
	/\.map$/i,
	/\.d\.cts$/i,
	/\.d\.ts$/i,
	/^README(\..+)?\.md$/i,
	/^CHANGELOG(\..+)?\.md$/i,
]);

export function assertPiCompactionToolsPrunedDependencyTree(packageRoot) {
	const nodeModulesRoot = resolve(packageRoot, "node_modules");
	assert.ok(
		existsSync(nodeModulesRoot),
		"Pruned native Pi compaction verification requires a dependency tree",
	);
	const rootRealPath = realpathSync(nodeModulesRoot);
	const seen = new Set([rootRealPath]);

	const visit = (directory) => {
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			const entryPath = resolve(directory, entry.name);
			const stats = entry.isSymbolicLink() ? statSync(entryPath) : null;
			if (entry.isDirectory() || stats?.isDirectory()) {
				const realPath = realpathSync(entryPath);
				assert.ok(
					realPath === rootRealPath || realPath.startsWith(`${rootRealPath}${sep}`),
					`Pruned native dependency link escapes node_modules: ${entryPath}`,
				);
				if (!seen.has(realPath)) {
					seen.add(realPath);
					visit(entryPath);
				}
				continue;
			}
			if (
				(entry.isFile() || stats?.isFile()) &&
				PRUNED_NATIVE_FORBIDDEN_FILE_PATTERNS.some((pattern) => pattern.test(entry.name))
			) {
				assert.fail(`Pruned native dependency tree retained ${entryPath}`);
			}
		}
	};

	visit(nodeModulesRoot);
}

export function assertPiCompactionToolsPackageTree(packageRoot, readText, options = {}) {
	if (options.prunedNative) {
		assert.equal(
			isPiCompactionToolsNativePackageRoot(packageRoot),
			true,
			"Pruned Pi compaction verification requires a native bundle package root",
		);
		assertPiCompactionToolsPrunedDependencyTree(packageRoot);
	}
	const codingAgentRoot = resolve(
		packageRoot,
		"node_modules",
		"@earendil-works",
		"pi-coding-agent",
	);
	const manifest = JSON.parse(
		readText(resolve(codingAgentRoot, "package.json"), "bundled Pi coding-agent manifest"),
	);
	assert.equal(manifest.version, PI_COMPACTION_TOOLS_REQUIRED_VERSION);
	for (const relativePath of resolvePiCompactionToolsPackageTargets(options)) {
		assertPiCompactionToolsPatchedSource(
			relativePath,
			readText(
				resolve(codingAgentRoot, ...relativePath.split("/")),
				`bundled Pi coding-agent ${relativePath}`,
			),
		);
	}
}

export function assertPiCompactionToolsArchive(readEntry) {
	for (const relativePath of PI_COMPACTION_TOOLS_RUNTIME_TARGETS) {
		assertPiCompactionToolsPatchedSource(
			relativePath,
			readEntry(`npm/node_modules/@earendil-works/pi-coding-agent/${relativePath}`),
		);
	}
}

function assistantMessage(model, content, stopReason = "stop") {
	return {
		role: "assistant",
		content,
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: {
			input: 1,
			output: 1,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 2,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason,
		timestamp: Date.now(),
	};
}

export async function verifyPiCompactionToolsBehavior(packageRoot) {
	const codingAgentRoot = resolve(
		packageRoot,
		"node_modules",
		"@earendil-works",
		"pi-coding-agent",
	);
	for (const relativePath of PI_COMPACTION_TOOLS_RUNTIME_TARGETS) {
		assertPiCompactionToolsPatchedSource(
			relativePath,
			readFileSync(resolve(codingAgentRoot, ...relativePath.split("/")), "utf8"),
		);
	}

	const compaction = await import(
		`${pathToFileURL(resolve(codingAgentRoot, "dist", "core", "compaction", "compaction.js")).href}?feynman-tools=${Date.now()}`
	);
	const branch = await import(
		`${pathToFileURL(resolve(codingAgentRoot, "dist", "core", "compaction", "branch-summarization.js")).href}?feynman-tools=${Date.now()}`
	);
	const model = {
		id: "summary-test",
		name: "Summary Test",
		api: "openai-completions",
		provider: "test",
		baseUrl: "https://example.invalid/v1",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 4096,
	};
	const checkpointSummary = [
		"## Goal",
		"Verify a research claim against its cited source and preserve the exact evidence trail.",
		"",
		"## Progress",
		"- Located and checked the primary paper, DOI, cohort size, and reported confidence interval.",
		"",
		"## Next Steps",
		"1. Reproduce the reported result independently and compare it against the paper.",
	].join("\n");
	let observedOptions;
	const textStream = async (_model, _context, options) => {
		observedOptions = options;
		return {
			result: async () => assistantMessage(model, [{ type: "text", text: checkpointSummary }]),
		};
	};
	await compaction.completeSummarization(
		model,
		{ messages: [{ role: "user", content: "summarize", timestamp: 1 }] },
		{ apiKey: "test" },
		textStream,
	);
	assert.equal(observedOptions?.toolChoice, "none");
	assert.deepEqual(
		compaction.getEffectiveCompactionSettings(compaction.DEFAULT_COMPACTION_SETTINGS, 8192),
		{ enabled: true, reserveTokens: 2048, keepRecentTokens: 4096 },
	);
	assert.equal(
		compaction.shouldCompact(0, 8192, compaction.DEFAULT_COMPACTION_SETTINGS),
		false,
	);
	assert.equal(
		compaction.shouldCompact(6145, 8192, compaction.DEFAULT_COMPACTION_SETTINGS),
		true,
	);
	assert.deepEqual(
		compaction.getEffectiveCompactionSettings(compaction.DEFAULT_COMPACTION_SETTINGS, 128000),
		compaction.DEFAULT_COMPACTION_SETTINGS,
	);
	const branchCheckpointSummary = `${checkpointSummary}\n\n${"Preserve the exact research evidence, methods, provenance, and reproduction state. ".repeat(12)}`;
	const verifyBranchRequestBudget = async (branchModel, entries, expectedMaxTokens) => {
		let observedContext;
		let observedBranchOptions;
		const branchStream = async (_model, context, options) => {
			observedContext = context;
			observedBranchOptions = options;
			return {
				result: async () => assistantMessage(
					branchModel,
					[{ type: "text", text: branchCheckpointSummary }],
				),
			};
		};
		const result = await branch.generateBranchSummary(entries, {
			model: branchModel,
			apiKey: "test",
			streamFn: branchStream,
		});
		assert.equal(result.error, undefined);
		assert.equal(observedBranchOptions?.maxTokens, expectedMaxTokens);
		assert.ok(
			observedBranchOptions.maxTokens <= branchModel.maxTokens,
			"Branch summary output exceeded the model output limit",
		);
		const inputTokens =
			Math.ceil((observedContext.systemPrompt?.length ?? 0) / 4) +
			observedContext.messages.reduce(
				(total, message) => total + compaction.estimateTokens(message),
				0,
			);
		assert.ok(
			inputTokens + observedBranchOptions.maxTokens <= branchModel.contextWindow,
			"Branch summary system, prompt, and output exceeded the model context window",
		);
		return observedContext;
	};
	const eightKModel = { ...model, contextWindow: 8192, maxTokens: 4096 };
	await verifyBranchRequestBudget(
		eightKModel,
		Array.from({ length: 30 }, (_, index) => ({
			type: "message",
			id: `branch-budget-${index}`,
			parentId: index === 0 ? null : `branch-budget-${index - 1}`,
			timestamp: new Date(index + 1).toISOString(),
			message: { role: "user", content: "A".repeat(800), timestamp: index + 1 },
		})),
		2048,
	);
	await verifyBranchRequestBudget(
		{ ...model, contextWindow: 1024, maxTokens: 128 },
		[{
			type: "message",
			id: "branch-budget-tiny",
			parentId: null,
			timestamp: new Date(1).toISOString(),
			message: { role: "user", content: "B".repeat(1200), timestamp: 1 },
		}],
		128,
	);
	const largeContext = await verifyBranchRequestBudget(
		model,
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
		"Large-context branch summaries must preserve the existing reserve",
	);
	assert.match(largePrompt, /branchC{100}/, "Large-context branch summary dropped recent context");
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
	const mediumStructuredStub = [
		"## Goal",
		"A".repeat(60),
		"## Progress",
		"B".repeat(60),
		"## Next Steps",
		"C".repeat(60),
	].join("\n");
	assert.match(
		compaction.getSummaryUsabilityFailure(
			mediumStructuredStub,
			"Summarization",
			undefined,
			100_000,
		) ?? "",
		/implausibly small checkpoint/,
	);

	const toolStream = async () => ({
		result: async () => assistantMessage(
			model,
			[{ type: "toolCall", id: "tool-1", name: "read", arguments: { path: "README.md" } }],
			"toolUse",
		),
	});
	await assert.rejects(
		() => compaction.generateSummaryWithUsage(
			[{ role: "user", content: "summarize", timestamp: 1 }],
			model,
			2048,
			"test",
			undefined,
			undefined,
			undefined,
			undefined,
			"off",
			toolStream,
		),
		/Summarization attempted to call a tool/,
	);
	await assert.rejects(
		() => compaction.compact(
			{
				firstKeptEntryId: "entry-keep",
				messagesToSummarize: [],
				turnPrefixMessages: [{ role: "user", content: "split turn", timestamp: 1 }],
				isSplitTurn: true,
				tokensBefore: 100,
				fileOps: { read: new Set(), written: new Set(), edited: new Set() },
				settings: { enabled: true, reserveTokens: 2048, keepRecentTokens: 20 },
			},
			model,
			"test",
			undefined,
			undefined,
			undefined,
			undefined,
			toolStream,
		),
		/Turn prefix summarization attempted to call a tool/,
	);
	const branchResult = await branch.generateBranchSummary(
		[{
			type: "message",
			id: "entry-1",
			parentId: null,
			timestamp: new Date(1).toISOString(),
			message: { role: "user", content: "abandoned work", timestamp: 1 },
		}],
		{ model, apiKey: "test", streamFn: toolStream },
	);
	assert.equal(branchResult.error, "Branch summarization attempted to call a tool");

	const lengthStream = async () => ({
		result: async () => assistantMessage(
			model,
			[{ type: "text", text: "partial summary" }],
			"length",
		),
	});
	await assert.rejects(
		() => compaction.generateSummaryWithUsage(
			[{ role: "user", content: "summarize", timestamp: 1 }],
			model,
			2048,
			"test",
			undefined,
			undefined,
			undefined,
			undefined,
			"off",
			lengthStream,
		),
		/generation hit the token cap/,
	);
	await assert.rejects(
		() => compaction.compact(
			{
				firstKeptEntryId: "entry-keep",
				messagesToSummarize: [],
				turnPrefixMessages: [{ role: "user", content: "split turn", timestamp: 1 }],
				isSplitTurn: true,
				tokensBefore: 100,
				fileOps: { read: new Set(), written: new Set(), edited: new Set() },
				settings: { enabled: true, reserveTokens: 2048, keepRecentTokens: 20 },
			},
			model,
			"test",
			undefined,
			undefined,
			undefined,
			undefined,
			lengthStream,
		),
		/generation hit the token cap/,
	);
	const truncatedBranch = await branch.generateBranchSummary(
		[{
			type: "message",
			id: "entry-1",
			parentId: null,
			timestamp: new Date(1).toISOString(),
			message: { role: "user", content: "abandoned work", timestamp: 1 },
		}],
		{ model, apiKey: "test", streamFn: lengthStream },
	);
	assert.match(truncatedBranch.error ?? "", /generation hit the token cap/);

	const emptyStream = async () => ({
		result: async () => assistantMessage(model, [{ type: "text", text: "" }]),
	});
	await assert.rejects(
		() => compaction.generateSummaryWithUsage(
			[{ role: "user", content: "preserve this research history", timestamp: 1 }],
			model,
			2048,
			"test",
			undefined,
			undefined,
			undefined,
			undefined,
			"off",
			emptyStream,
		),
		/empty or file-list-only checkpoint/,
	);
	const emptyBranch = await branch.generateBranchSummary(
		[{
			type: "message",
			id: "entry-1",
			parentId: null,
			timestamp: new Date(1).toISOString(),
			message: { role: "user", content: "abandoned research work", timestamp: 1 },
		}],
		{ model, apiKey: "test", streamFn: emptyStream },
	);
	assert.match(emptyBranch.error ?? "", /empty or file-list-only checkpoint/);

	const accepted = await compaction.generateSummaryWithUsage(
		[{ role: "user", content: "preserve this research history", timestamp: 1 }],
		model,
		2048,
		"test",
		undefined,
		undefined,
		undefined,
		undefined,
		"off",
		textStream,
	);
	assert.equal(accepted.text, checkpointSummary);
}
