import {
	assertPiOpenAiStructuredReasoningSource,
	isPiOpenAiStructuredReasoningPatched,
	patchPiOpenAiStructuredReasoningSource,
} from "./pi-openai-reasoning-patch.mjs";
import {
	assertPiOpenAiResponsesNoToolsSource,
	PI_OPENAI_RESPONSES_NO_TOOLS_MARKER,
	patchPiOpenAiResponsesNoToolsSource,
} from "./pi-openai-responses-no-tools-patch.mjs";
import {
	assertPiBedrockForwardFixSource,
	PI_BEDROCK_RESPONSE_HEADERS_MARKER,
	PI_BEDROCK_TOOL_RESULT_IMAGES_MARKER,
	patchPiBedrockForwardFixSource,
} from "./pi-bedrock-forward-fixes-patch.mjs";
import { isCurrentPiAiCatalog, patchCurrentOpenAiCompletions } from "./pi-ai-forward-fixes-current.mjs";

/**
 * Temporary Pi 0.84.2 forward patches for upstream commits:
 * - af2c352238cffd12d404d5a4cd35a21f93a78fe0 (Google thinking maps)
 * - 10acee6045e9025a22dff7e5220ed0d7538f12aa (Bedrock response headers)
 * - 0e4d49541477c4fc6e404f845ad40ed47d157f24 (deprecated Xiaomi models)
 * - 87205484bf749c2140fef5d1bea68995d57e739c (China ZAI catalog)
 * - ad58801ce793ca4ca2f6fb64b307e9eaffd2c471 (Baseten GLM image inputs)
 * - e5dde9a76bfec3c4eff764d1b6db3b60e5dd0b30 (provider-neutral tool choice)
 * - 94f6e7c9ffdb9a57fabdc39fb6b12ee54fa05ee6 (Gemini thought signatures)
 * - d8def8121bcb4d4e2cce16d12a521347559329ce (OpenAI-compatible tool-call IDs)
 * - fe37e9f9b5fb2e7bd9ff504e678f08d115375230 (omit tool_choice without tools)
 * - 4ca636c5e07eb1e0fbc6be6c11c720d1a8856daa (structured reasoning details)
 * - b7bb00b936dbe21b8e160b3e89efdec361846699 (reasoning signature storage)
 * - c5ad7c1b0f7623bbfdf64dd4967fa6e99c15c01a (reasoning delta concatenation)
 * - 7280f89b42e4b233afc4f18e41366e845d179cef (Responses no-tools contract, Pi #8649/#8650)
 * - 331e187b8ee86cc87360600eef6f9620a5d1967b (Bedrock OpenAI tool-result images, Pi #8643)
 * - https://github.com/earendil-works/pi/issues/8507 (transient OpenRouter budget retry)
 *
 * Removal condition: delete this patch after Feynman adopts a released Pi
 * version that contains all fifteen fixes.
 */

export const PI_AI_FORWARD_FIX_REQUIRED_VERSION = "0.85.1";

export const PI_AI_FORWARD_FIX_TARGETS = Object.freeze([
	"dist/api/google-generative-ai.js",
	"dist/api/google-shared.js",
	"dist/api/google-vertex.js",
	"dist/api/bedrock-converse-stream.js",
	"dist/api/openai-completions.js",
	"dist/utils/provider-retry.js",
	"dist/utils/provider-retry.d.ts",
	"dist/types.d.ts",
	"dist/api/anthropic-messages.js",
	"dist/api/azure-openai-responses.js",
	"dist/api/mistral-conversations.js",
	"dist/api/openai-codex-responses.js",
	"dist/api/openai-responses.js",
	"dist/providers/data/xiaomi.json",
	"dist/providers/data/xiaomi-token-plan-cn.json",
	"dist/providers/data/xiaomi-token-plan-ams.json",
	"dist/providers/data/xiaomi-token-plan-sgp.json",
	"dist/providers/data/zai.json",
	"dist/providers/data/zai-coding-cn.json",
	"dist/providers/data/baseten.json",
	"dist/providers/data/.manifest.json",
]);
export const PI_AI_FORWARD_FIX_RUNTIME_TARGETS = Object.freeze(
	PI_AI_FORWARD_FIX_TARGETS.filter((relativePath) => !relativePath.endsWith(".d.ts")),
);

export const PI_AI_FORWARD_FIX_MARKERS = Object.freeze({
	googleGenerativeAi: "Feynman Pi 0.84.2 forward patch: Google thinking level maps",
	googleShared: "Feynman Pi 0.84.2 forward patch: resolve Google thinking level maps",
	googleVertex: "Feynman Pi 0.84.2 forward patch: Vertex thinking level maps",
	bedrock: PI_BEDROCK_RESPONSE_HEADERS_MARKER,
	bedrockToolResultImages: PI_BEDROCK_TOOL_RESULT_IMAGES_MARKER,
	toolChoice: "Feynman Pi 0.84.2 forward patch: provider-neutral tool choice",
	openAiCompletions: "Feynman Pi 0.84.2 forward patch: Gemini signatures and bounded tool IDs",
	openAiResponsesNoTools: PI_OPENAI_RESPONSES_NO_TOOLS_MARKER,
	providerRetry: "Feynman Pi 0.84.2 forward patch: transient in-flight budget retry #8507",
});

const TOOL_CHOICE_BASE_OPTIONS = Object.freeze({
	"dist/api/anthropic-messages.js": "    const base = buildBaseOptions(model, context, options, options?.apiKey);",
	"dist/api/azure-openai-responses.js": "    const base = buildBaseOptions(model, context, options, apiKey);",
	"dist/api/bedrock-converse-stream.js": "    const base = buildBaseOptions(model, context, options, undefined);",
	"dist/api/google-generative-ai.js": "    const base = buildBaseOptions(model, context, options, apiKey);",
	"dist/api/google-vertex.js": "    const base = buildBaseOptions(model, context, options, undefined);",
	"dist/api/mistral-conversations.js": "    const base = buildBaseOptions(model, context, options, apiKey);",
	"dist/api/openai-codex-responses.js": "    const base = buildBaseOptions(model, context, options, apiKey);",
	"dist/api/openai-responses.js": "    const base = buildBaseOptions(model, context, options, options?.apiKey);",
});

const XIAOMI_DEPRECATED_MODEL_IDS = Object.freeze([
	"mimo-v2-flash",
	"mimo-v2-omni",
	"mimo-v2-pro",
]);

const BASETEN_IMAGE_MODEL_IDS = Object.freeze([
	"zai-org/GLM-5.2",
	"zai-org/GLM-5.2-Fast",
]);

const PATCHED_MODEL_DATA_STRUCTURE_HASH = "a2a167065a0bd00645b34c52292f2f2b468af195d0d58e15382a3e071ebf94dd";

const PATCHED_MODEL_DATA_FILE_HASHES = Object.freeze({
	"baseten.json": "245c6ef6381f3d8e9d251857e07585db0aeef4156e8d4c31de31aef12444f2e0",
	"xiaomi.json": "59826b1eba4cc3d2ad2c7af809f72318eedb797412e5ffd988c7ff88e873d6aa",
	"xiaomi-token-plan-cn.json": "ec410f4271853b3433080a5237b7d361eced8d1a66387f8b10eb4d0ad127cdf5",
	"xiaomi-token-plan-ams.json": "1173ec57ebd2b67591b60e8968c176714220689a9ddf21c3fbd928ed76f8635b",
	"xiaomi-token-plan-sgp.json": "4561b64e163d7c1808872c2c313a2a5dc07d8c974d8eacb4398d2be3b7ccc678",
	"zai.json": "c21ae231e84e0c3a885c9948008b830f9ea82b9ed552fb3daa548791e7f66f31",
	"zai-coding-cn.json": "1b53f0c7cd10d8f11bd2cfb177a66ba7e782c3798232e3f9dcf51d83ba8dfe11",
});

const ZAI_REFERENCE_COSTS = Object.freeze({
	"glm-4.7": Object.freeze({ input: 0.6, output: 2.2, cacheRead: 0.11, cacheWrite: 0 }),
	"glm-5-turbo": Object.freeze({ input: 1.2, output: 4, cacheRead: 0.24, cacheWrite: 0 }),
	"glm-5.2": Object.freeze({ input: 1.4, output: 4.4, cacheRead: 0.26, cacheWrite: 0 }),
});

const ZAI_CHINA_ADDITIONS = Object.freeze({
	"glm-4.6v": Object.freeze({
		id: "glm-4.6v",
		name: "GLM-4.6V",
		api: "openai-completions",
		provider: "zai-coding-cn",
		baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4",
		reasoning: true,
		input: Object.freeze(["text", "image"]),
		cost: Object.freeze({ input: 0.3, output: 0.9, cacheRead: 0, cacheWrite: 0 }),
		compat: Object.freeze({
			supportsStore: false,
			supportsDeveloperRole: false,
			supportsReasoningEffort: false,
			maxTokensField: "max_tokens",
			thinkingFormat: "zai",
			zaiToolStream: true,
		}),
		contextWindow: 128000,
		maxTokens: 32768,
	}),
	"glm-5.1": Object.freeze({
		id: "glm-5.1",
		name: "GLM-5.1",
		api: "openai-completions",
		provider: "zai-coding-cn",
		baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4",
		reasoning: true,
		input: Object.freeze(["text"]),
		cost: Object.freeze({ input: 1.4, output: 4.4, cacheRead: 0.26, cacheWrite: 0 }),
		compat: Object.freeze({
			supportsStore: false,
			supportsDeveloperRole: false,
			supportsReasoningEffort: false,
			maxTokensField: "max_tokens",
			thinkingFormat: "zai",
			zaiToolStream: true,
		}),
		contextWindow: 200000,
		maxTokens: 131072,
	}),
	"glm-5v-turbo": Object.freeze({
		id: "glm-5v-turbo",
		name: "GLM-5V-Turbo",
		api: "openai-completions",
		provider: "zai-coding-cn",
		baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4",
		reasoning: true,
		input: Object.freeze(["text", "image"]),
		cost: Object.freeze({ input: 1.2, output: 4, cacheRead: 0.24, cacheWrite: 0 }),
		compat: Object.freeze({
			supportsStore: false,
			supportsDeveloperRole: false,
			supportsReasoningEffort: false,
			maxTokensField: "max_tokens",
			thinkingFormat: "zai",
			zaiToolStream: true,
		}),
		contextWindow: 200000,
		maxTokens: 131072,
	}),
});

function countOccurrences(source, fragment) {
	return source.split(fragment).length - 1;
}

function stripStaleSourceMapDirective(source, relativePath) {
	const marker = "//# sourceMappingURL=";
	const first = source.indexOf(marker);
	if (first === -1) {
		return source;
	}
	if (
		source.indexOf(marker, first + marker.length) !== -1 ||
		!/^\/\/# sourceMappingURL=[^\r\n]*[\r\n]*$/.test(source.slice(first))
	) {
		throw new Error(
			`Unsupported Pi ${PI_AI_FORWARD_FIX_REQUIRED_VERSION} ${relativePath} source map layout`,
		);
	}
	return source.slice(0, first).replace(/\r?\n$/, "");
}

function replaceRequired(source, original, replacement, label) {
	const count = countOccurrences(source, original);
	if (count !== 1) {
		throw new Error(
			`Unsupported Pi ${PI_AI_FORWARD_FIX_REQUIRED_VERSION} ${label} layout; expected 1 occurrence, found ${count}`,
		);
	}
	return source.replace(original, replacement);
}

function replaceRequiredCount(source, original, replacement, expectedCount, label) {
	const count = countOccurrences(source, original);
	if (count !== expectedCount) {
		throw new Error(
			`Unsupported Pi ${PI_AI_FORWARD_FIX_REQUIRED_VERSION} ${label} layout; expected ${expectedCount} occurrences, found ${count}`,
		);
	}
	return source.replaceAll(original, replacement);
}

function deepEqual(left, right) {
	return JSON.stringify(left) === JSON.stringify(right);
}

function parseCatalog(source, relativePath) {
	try {
		const parsed = JSON.parse(source);
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			throw new Error("catalog root is not an object");
		}
		return parsed;
	} catch (error) {
		throw new Error(`Invalid Pi AI model catalog ${relativePath}: ${error instanceof Error ? error.message : String(error)}`);
	}
}

function getOpenAiModels(catalog, relativePath) {
	const models = catalog["openai-completions"];
	if (!models || typeof models !== "object" || Array.isArray(models)) {
		throw new Error(`Unsupported Pi ${PI_AI_FORWARD_FIX_REQUIRED_VERSION} ${relativePath}: missing openai-completions`);
	}
	return models;
}

function assertXiaomiCatalog(relativePath, catalog) {
	const models = getOpenAiModels(catalog, relativePath);
	for (const modelId of XIAOMI_DEPRECATED_MODEL_IDS) {
		if (modelId in models) {
			throw new Error(`Incomplete Pi AI Xiaomi catalog patch ${relativePath}: retained ${modelId}`);
		}
	}
	for (const modelId of ["mimo-v2.5", "mimo-v2.5-pro"]) {
		if (!(modelId in models)) {
			throw new Error(`Incomplete Pi AI Xiaomi catalog patch ${relativePath}: missing ${modelId}`);
		}
	}
}

function assertZaiCatalog(relativePath, catalog) {
	const models = getOpenAiModels(catalog, relativePath);
	for (const [modelId, cost] of Object.entries(ZAI_REFERENCE_COSTS)) {
		if (!deepEqual(models[modelId]?.cost, cost)) {
			throw new Error(`Incomplete Pi AI ZAI catalog patch ${relativePath}: incorrect ${modelId} cost`);
		}
	}
	if (relativePath.endsWith("/zai-coding-cn.json")) {
		for (const [modelId, expected] of Object.entries(ZAI_CHINA_ADDITIONS)) {
			if (!deepEqual(models[modelId], expected)) {
				throw new Error(`Incomplete Pi AI China ZAI catalog patch ${relativePath}: incorrect ${modelId}`);
			}
		}
		const modelIds = Object.keys(models);
		const sortedModelIds = [...modelIds].sort((left, right) => left.localeCompare(right));
		if (!deepEqual(modelIds, sortedModelIds)) {
			throw new Error(`Incomplete Pi AI China ZAI catalog patch ${relativePath}: model order differs from upstream`);
		}
	}
}

function assertBasetenCatalog(relativePath, catalog) {
	const models = getOpenAiModels(catalog, relativePath);
	for (const modelId of BASETEN_IMAGE_MODEL_IDS) {
		if (!deepEqual(models[modelId]?.input, ["text", "image"])) {
			throw new Error(`Incomplete Pi AI Baseten catalog patch ${relativePath}: incorrect ${modelId} input`);
		}
	}
}

function assertModelDataManifest(relativePath, manifest) {
	if (manifest.schemaVersion !== 3) {
		throw new Error(`Incomplete Pi AI model manifest patch ${relativePath}: incorrect schema version`);
	}
	if (manifest.structureHash !== PATCHED_MODEL_DATA_STRUCTURE_HASH) {
		throw new Error(`Incomplete Pi AI model manifest patch ${relativePath}: incorrect structure hash`);
	}
	if (!manifest.files || typeof manifest.files !== "object" || Array.isArray(manifest.files)) {
		throw new Error(`Incomplete Pi AI model manifest patch ${relativePath}: missing file hashes`);
	}
	for (const [filename, expectedHash] of Object.entries(PATCHED_MODEL_DATA_FILE_HASHES)) {
		if (manifest.files[filename] !== expectedHash) {
			throw new Error(`Incomplete Pi AI model manifest patch ${relativePath}: incorrect ${filename} hash`);
		}
	}
}

function patchModelDataManifest(relativePath, source) {
	const manifest = parseCatalog(source, relativePath);
	manifest.generatedAt = "2026-08-18T06:19:46.000Z";
	manifest.structureHash = PATCHED_MODEL_DATA_STRUCTURE_HASH;
	for (const [filename, expectedHash] of Object.entries(PATCHED_MODEL_DATA_FILE_HASHES)) {
		manifest.files[filename] = expectedHash;
	}
	assertModelDataManifest(relativePath, manifest);
	return JSON.stringify(manifest);
}

function patchModelCatalog(relativePath, source) {
	const catalog = parseCatalog(source, relativePath);
	const models = getOpenAiModels(catalog, relativePath);

	if (relativePath.includes("/xiaomi")) {
		for (const modelId of XIAOMI_DEPRECATED_MODEL_IDS) {
			delete models[modelId];
		}
		assertXiaomiCatalog(relativePath, catalog);
		return JSON.stringify(catalog);
	}

	if (relativePath.endsWith("/baseten.json")) {
		for (const modelId of BASETEN_IMAGE_MODEL_IDS) {
			if (!models[modelId]) {
				throw new Error(`Unsupported Pi ${PI_AI_FORWARD_FIX_REQUIRED_VERSION} ${relativePath}: missing ${modelId}`);
			}
			models[modelId].input = ["text", "image"];
		}
		assertBasetenCatalog(relativePath, catalog);
		return JSON.stringify(catalog);
	}

	if (relativePath.endsWith("/zai.json") || relativePath.endsWith("/zai-coding-cn.json")) {
		for (const [modelId, cost] of Object.entries(ZAI_REFERENCE_COSTS)) {
			if (!models[modelId]) {
				throw new Error(`Unsupported Pi ${PI_AI_FORWARD_FIX_REQUIRED_VERSION} ${relativePath}: missing ${modelId}`);
			}
			models[modelId].cost = { ...cost };
		}
		if (relativePath.endsWith("/zai-coding-cn.json")) {
			for (const [modelId, model] of Object.entries(ZAI_CHINA_ADDITIONS)) {
				models[modelId] = structuredClone(model);
			}
			catalog["openai-completions"] = Object.fromEntries(
				Object.entries(models).sort(([left], [right]) => left.localeCompare(right)),
			);
		}
		assertZaiCatalog(relativePath, catalog);
		return JSON.stringify(catalog);
	}

	throw new Error(`Unknown Pi AI model catalog patch target: ${relativePath}`);
}

function assertSourceFragments(source, relativePath, fragments) {
	for (const fragment of fragments) {
		if (!source.includes(fragment)) {
			throw new Error(`Incomplete Pi AI forward patch ${relativePath}: missing ${fragment}`);
		}
	}
}

export function assertPiAiForwardFixSource(relativePath, source) {
	if (isCurrentPiAiCatalog(relativePath, source)) return;
	if (!relativePath.endsWith(".json") && source.includes("//# sourceMappingURL=")) {
		throw new Error(`Incomplete Pi AI forward patch ${relativePath}: retained stale source map directive`);
	}
	if (relativePath.includes("/providers/data/")) {
		const catalog = parseCatalog(source, relativePath);
		if (relativePath.endsWith("/.manifest.json")) {
			assertModelDataManifest(relativePath, catalog);
			return;
		}
		if (relativePath.includes("/xiaomi")) {
			assertXiaomiCatalog(relativePath, catalog);
			return;
		}
		if (relativePath.endsWith("/baseten.json")) {
			assertBasetenCatalog(relativePath, catalog);
			return;
		}
		assertZaiCatalog(relativePath, catalog);
		return;
	}

	if (relativePath in TOOL_CHOICE_BASE_OPTIONS) {
		assertSourceFragments(source, relativePath, [
			PI_AI_FORWARD_FIX_MARKERS.toolChoice,
			"        ...buildBaseOptions(",
			"        toolChoice: options?.toolChoice,",
		]);
	}

	switch (relativePath) {
		case "dist/api/google-generative-ai.js":
			assertSourceFragments(source, relativePath, [
				PI_AI_FORWARD_FIX_MARKERS.googleGenerativeAi,
				"resolveGoogleThinkingLevel(model, clampedReasoning)",
				"level: getThinkingLevel(resolvedLevel, googleModel)",
				"budgetTokens: getGoogleBudget(googleModel, resolvedLevel, options.thinkingBudgets)",
			]);
			return;
		case "dist/api/google-shared.js":
			assertSourceFragments(source, relativePath, [
				PI_AI_FORWARD_FIX_MARKERS.googleShared,
				"export function resolveGoogleThinkingLevel(model, level)",
				"Unsupported Google thinking level mapping",
			]);
			return;
		case "dist/api/google-vertex.js":
			assertSourceFragments(source, relativePath, [
				PI_AI_FORWARD_FIX_MARKERS.googleVertex,
				"resolveGoogleThinkingLevel(model, clampedReasoning)",
				"level: getGemini3ThinkingLevel(resolvedLevel, geminiModel)",
				"budgetTokens: getGoogleBudget(geminiModel, resolvedLevel, options.thinkingBudgets)",
			]);
			return;
		case "dist/api/bedrock-converse-stream.js":
			assertPiBedrockForwardFixSource(source);
			return;
		case "dist/api/openai-completions.js":
			assertSourceFragments(source, relativePath, [
				PI_AI_FORWARD_FIX_MARKERS.openAiCompletions,
				"const maxToolCallIdLength = 40;",
				"fitToolCallIdWithHash(combinedId, id)",
				"const hash = shortHash(hashSource);",
				"const signature = toolCall.extra_content?.google?.thought_signature;",
				"compat.supportsGoogleThoughtSignatures",
				"isFeynmanSerializedReasoningDetail",
				"if (!block.thoughtSignature ||",
				"isFeynmanSerializedReasoningDetail(block.thoughtSignature))",
				"extra_content: { google: { thought_signature: tc.thoughtSignature } }",
				"if (options?.toolChoice && params.tools?.length)",
				'model.provider === "openrouter" && /^~?google\\/gemini-3(?:[.:-]|$)/.test(model.id)',
				'model.provider === "github-copilot" && /^gemini-3(?:[.:-]|$)/.test(model.id)',
				"retryProviderRequest",
				'const openRouterBudgetRetry = model.provider === "openrouter";',
				"maxRetries: openRouterBudgetRetry ?",
				"retryOn: openRouterBudgetRetry ? isTransientInFlightBudgetError : undefined",
			]);
			assertPiOpenAiStructuredReasoningSource(source, relativePath);
			if (/model\.provider === "openai"\)\s*\n?\s*return id\.length > 40 \? id\.slice/.test(source)) {
				throw new Error(`Incomplete Pi AI forward patch ${relativePath}: retained provider-only truncation`);
			}
			return;
		case "dist/utils/provider-retry.js":
			assertSourceFragments(source, relativePath, [
				PI_AI_FORWARD_FIX_MARKERS.providerRetry,
				"function isTransientInFlightBudgetError(error)",
				"!(error instanceof Error)",
				"error.status !== 402",
				'error.headers.get("x-should-retry") === "false"',
				'error.headers.get("retry-after")',
				'getFeynmanStructuredErrorCode(error) === "in_flight_budget_exhausted"',
				"retryOn",
				"isTransientInFlightBudgetError(error)",
				"isRetryableProviderError(error) || options.retryOn?.(error) === true",
			]);
			if (source.includes("if (isTransientInFlightBudgetError(error))")) {
				throw new Error(
					`Incomplete Pi AI forward patch ${relativePath}: leaked OpenRouter budget retries into the provider-global policy`,
				);
			}
			return;
		case "dist/utils/provider-retry.d.ts":
			assertSourceFragments(source, relativePath, [
				"retryOn?: (error: unknown) => boolean;",
				"export declare function isTransientInFlightBudgetError(error: unknown): boolean;",
			]);
			return;
		case "dist/types.d.ts":
			assertSourceFragments(source, relativePath, ["supportsGoogleThoughtSignatures?: boolean;"]);
			if (source.includes("reasoningDetails?: JsonValue[];")) {
				throw new Error(`Incomplete Pi AI forward patch ${relativePath}: retained top-level reasoningDetails`);
			}
			return;
		case "dist/api/anthropic-messages.js":
		case "dist/api/azure-openai-responses.js":
		case "dist/api/mistral-conversations.js":
		case "dist/api/openai-codex-responses.js":
			return;
		case "dist/api/openai-responses.js":
			assertPiOpenAiResponsesNoToolsSource(source, relativePath);
			return;
		default:
			throw new Error(`Unknown Pi AI forward patch target: ${relativePath}`);
	}
}

function patchProviderNeutralToolChoice(relativePath, source) {
	if (source.includes(PI_AI_FORWARD_FIX_MARKERS.toolChoice)) {
		assertSourceFragments(source, relativePath, [
			PI_AI_FORWARD_FIX_MARKERS.toolChoice,
			"        ...buildBaseOptions(",
			"        toolChoice: options?.toolChoice,",
		]);
		return source;
	}
	const original = TOOL_CHOICE_BASE_OPTIONS[relativePath];
	if (!original) {
		throw new Error(`Unknown Pi AI provider-neutral tool choice target: ${relativePath}`);
	}
	const buildOptions = original.slice(original.indexOf("buildBaseOptions("), -1);
	const replacement = [
		`    // ${PI_AI_FORWARD_FIX_MARKERS.toolChoice}`,
		"    const base = {",
		`        ...${buildOptions},`,
		"        toolChoice: options?.toolChoice,",
		"    };",
	].join("\n");
	const upstream = replacement.replace(`    // ${PI_AI_FORWARD_FIX_MARKERS.toolChoice}\n`, "");
	if (source.includes(upstream)) {
		return replaceRequired(source, upstream, replacement, `${relativePath} upstream tool choice`);
	}
	const patched = replaceRequired(source, original, replacement, `${relativePath} tool choice`);
	assertSourceFragments(patched, relativePath, [
		PI_AI_FORWARD_FIX_MARKERS.toolChoice,
		"        ...buildBaseOptions(",
		"        toolChoice: options?.toolChoice,",
	]);
	return patched;
}

function patchGoogleShared(source) {
	const relativePath = "dist/api/google-shared.js";
	if (source.includes(PI_AI_FORWARD_FIX_MARKERS.googleShared)) {
		assertPiAiForwardFixSource(relativePath, source);
		return source;
	}
	const anchor = 'import { transformMessages } from "./transform-messages.js";';
	const helper = `${anchor}
// ${PI_AI_FORWARD_FIX_MARKERS.googleShared}
export function resolveGoogleThinkingLevel(model, level) {
    if (level === "off")
        return "high";
    const mapped = model.thinkingLevelMap?.[level];
    const resolvedLevel = typeof mapped === "string" ? mapped.toLowerCase() : level;
    switch (resolvedLevel) {
        case "minimal":
        case "low":
        case "medium":
        case "high":
            return resolvedLevel;
        default:
            throw new Error(\`Unsupported Google thinking level mapping for \${model.provider}/\${model.id}: \${level} -> \${String(mapped)}\`);
    }
}`;
	const upstreamHelper = helper.slice(helper.indexOf("export function"));
	if (source.includes(upstreamHelper)) {
		const patched = replaceRequired(source, upstreamHelper,
			`// ${PI_AI_FORWARD_FIX_MARKERS.googleShared}\n${upstreamHelper}`, "upstream Google thinking map");
		assertPiAiForwardFixSource(relativePath, patched);
		return patched;
	}
	const patched = replaceRequired(source, anchor, helper, "Google shared thinking map");
	assertPiAiForwardFixSource(relativePath, patched);
	return patched;
}

function patchGoogleGenerativeAi(source) {
	const relativePath = "dist/api/google-generative-ai.js";
	if (!source.includes(PI_AI_FORWARD_FIX_MARKERS.googleGenerativeAi) &&
		source.includes("const resolvedLevel = resolveGoogleThinkingLevel(model, clampedReasoning);")) {
		const annotated = `// ${PI_AI_FORWARD_FIX_MARKERS.googleGenerativeAi}\n${source}`;
		assertPiAiForwardFixSource(relativePath, annotated);
		return annotated;
	}
	if (source.includes(PI_AI_FORWARD_FIX_MARKERS.googleGenerativeAi)) {
		assertPiAiForwardFixSource(relativePath, source);
		return source;
	}
	let patched = replaceRequired(
		source,
		'import { convertMessages, convertTools, isThinkingPart, mapStopReason, resolveGoogleFunctionCallingMode, retainThoughtSignature, retryGoogleRequest, supportsGoogleStrictToolSampling, } from "./google-shared.js";',
		`import { convertMessages, convertTools, isThinkingPart, mapStopReason, resolveGoogleFunctionCallingMode, resolveGoogleThinkingLevel, retainThoughtSignature, retryGoogleRequest, supportsGoogleStrictToolSampling, } from "./google-shared.js";
// ${PI_AI_FORWARD_FIX_MARKERS.googleGenerativeAi}`,
		"Google Generative AI import",
	);
	patched = replaceRequired(
		patched,
		'    const effort = (clampedReasoning === "off" ? "high" : clampedReasoning);',
		"    const resolvedLevel = resolveGoogleThinkingLevel(model, clampedReasoning);",
		"Google Generative AI level resolution",
	);
	patched = replaceRequired(patched, "level: getThinkingLevel(effort, googleModel)", "level: getThinkingLevel(resolvedLevel, googleModel)", "Google Generative AI thinking level");
	patched = replaceRequired(patched, "budgetTokens: getGoogleBudget(googleModel, effort, options.thinkingBudgets)", "budgetTokens: getGoogleBudget(googleModel, resolvedLevel, options.thinkingBudgets)", "Google Generative AI thinking budget");
	patched = replaceRequired(patched, "function getGoogleBudget(model, effort, customBudgets) {", "function getGoogleBudget(model, level, customBudgets) {", "Google Generative AI budget parameter");
	patched = replaceRequired(patched, "customBudgets?.[effort]", "customBudgets?.[level]", "Google Generative AI custom budget check");
	patched = replaceRequired(patched, "customBudgets[effort]", "customBudgets[level]", "Google Generative AI custom budget value");
	patched = replaceRequiredCount(patched, "budgets[effort]", "budgets[level]", 3, "Google Generative AI built-in budgets");
	assertPiAiForwardFixSource(relativePath, patched);
	return patched;
}

function patchGoogleVertex(source) {
	const relativePath = "dist/api/google-vertex.js";
	if (!source.includes(PI_AI_FORWARD_FIX_MARKERS.googleVertex) &&
		source.includes("const resolvedLevel = resolveGoogleThinkingLevel(model, clampedReasoning);")) {
		const annotated = `// ${PI_AI_FORWARD_FIX_MARKERS.googleVertex}\n${source}`;
		assertPiAiForwardFixSource(relativePath, annotated);
		return annotated;
	}
	if (source.includes(PI_AI_FORWARD_FIX_MARKERS.googleVertex)) {
		assertPiAiForwardFixSource(relativePath, source);
		return source;
	}
	let patched = replaceRequired(
		source,
		'import { convertMessages, convertTools, isThinkingPart, mapStopReason, resolveGoogleFunctionCallingMode, retainThoughtSignature, retryGoogleRequest, supportsGoogleStrictToolSampling, } from "./google-shared.js";',
		`import { convertMessages, convertTools, isThinkingPart, mapStopReason, resolveGoogleFunctionCallingMode, resolveGoogleThinkingLevel, retainThoughtSignature, retryGoogleRequest, supportsGoogleStrictToolSampling, } from "./google-shared.js";
// ${PI_AI_FORWARD_FIX_MARKERS.googleVertex}`,
		"Google Vertex import",
	);
	patched = replaceRequired(
		patched,
		'    const effort = (clampedReasoning === "off" ? "high" : clampedReasoning);',
		"    const resolvedLevel = resolveGoogleThinkingLevel(model, clampedReasoning);",
		"Google Vertex level resolution",
	);
	patched = replaceRequired(patched, "level: getGemini3ThinkingLevel(effort, geminiModel)", "level: getGemini3ThinkingLevel(resolvedLevel, geminiModel)", "Google Vertex thinking level");
	patched = replaceRequired(patched, "budgetTokens: getGoogleBudget(geminiModel, effort, options.thinkingBudgets)", "budgetTokens: getGoogleBudget(geminiModel, resolvedLevel, options.thinkingBudgets)", "Google Vertex thinking budget");
	patched = replaceRequired(patched, "function getGoogleBudget(model, effort, customBudgets) {", "function getGoogleBudget(model, level, customBudgets) {", "Google Vertex budget parameter");
	patched = replaceRequired(patched, "customBudgets?.[effort]", "customBudgets?.[level]", "Google Vertex custom budget check");
	patched = replaceRequired(patched, "customBudgets[effort]", "customBudgets[level]", "Google Vertex custom budget value");
	patched = replaceRequiredCount(patched, "budgets[effort]", "budgets[level]", 2, "Google Vertex built-in budgets");
	assertPiAiForwardFixSource(relativePath, patched);
	return patched;
}

function patchOpenAiCompletions(source) {
	const relativePath = "dist/api/openai-completions.js";
	if (source.includes(PI_AI_FORWARD_FIX_MARKERS.openAiCompletions)) {
		if (isPiOpenAiStructuredReasoningPatched(source)) {
			assertPiAiForwardFixSource(relativePath, source);
			return source;
		}
		if (source.includes("function isReasoningDetailObject(detail) {")) {
			const upgraded = patchPiOpenAiStructuredReasoningSource(source);
			assertPiAiForwardFixSource(relativePath, upgraded);
			return upgraded;
		}
		let upgraded = source
			.replaceAll("output.reasoning_details", "output.reasoningDetails")
			.replace(
				`                            if (compat.supportsGoogleThoughtSignatures &&
                                typeof signature === "string" &&
                                signature.length > 0) {
                                if (isFeynmanSerializedReasoningDetail(block.thoughtSignature)) {
                                    appendFeynmanEncryptedReasoningDetail(block.thoughtSignature);
                                }
                                block.thoughtSignature = signature;
                            }`,
				`                            if (compat.supportsGoogleThoughtSignatures &&
                                typeof signature === "string" &&
                                signature.length > 0) {
                                if (!block.thoughtSignature ||
                                    isFeynmanSerializedReasoningDetail(block.thoughtSignature)) {
                                    if (isFeynmanSerializedReasoningDetail(block.thoughtSignature)) {
                                        appendFeynmanEncryptedReasoningDetail(block.thoughtSignature);
                                    }
                                    block.thoughtSignature = signature;
                                }
                            }`,
			)
			.replace(
				`                                    else {
                                        matchingToolCall.thoughtSignature = serializedDetail;
                                    }`,
				`                                    else {
                                        if (isFeynmanSerializedReasoningDetail(matchingToolCall.thoughtSignature)) {
                                            appendFeynmanEncryptedReasoningDetail(matchingToolCall.thoughtSignature);
                                        }
                                        matchingToolCall.thoughtSignature = serializedDetail;
                                    }`,
				);
		upgraded = upgraded.replace(
			"    if (options?.toolChoice) {\n        params.tool_choice = options.toolChoice;\n    }",
			"    if (options?.toolChoice && params.tools?.length) {\n        params.tool_choice = options.toolChoice;\n    }",
		);
		if (!upgraded.includes("const preservedReasoningDetails = Array.isArray(msg.reasoningDetails)")) {
			upgraded = replaceRequired(
				upgraded,
				`                const reasoningDetails = toolCalls
                    .filter((tc) => tc.thoughtSignature)
                    .map((tc) => {
                    try {
                        return JSON.parse(tc.thoughtSignature);
                    }
                    catch {
                        return null;
                    }
                })
                    .filter(Boolean);
                if (reasoningDetails.length > 0) {
                    assistantMsg.reasoning_details = reasoningDetails;
                }`,
				`                const preservedReasoningDetails = Array.isArray(msg.reasoningDetails)
                    ? msg.reasoningDetails
                    : [];
                const reasoningDetails = [];
                const seenReasoningDetails = new Set();
                for (const detail of [
                    ...preservedReasoningDetails,
                    ...toolCalls.map((tc) => {
                        if (!tc.thoughtSignature)
                            return null;
                        try {
                            return JSON.parse(tc.thoughtSignature);
                        }
                        catch {
                            return null;
                        }
                    }),
                ]) {
                    if (!isEncryptedReasoningDetail(detail))
                        continue;
                    const serializedDetail = JSON.stringify(detail);
                    if (seenReasoningDetails.has(serializedDetail))
                        continue;
                    seenReasoningDetails.add(serializedDetail);
                    reasoningDetails.push(detail);
                }
                if (reasoningDetails.length > 0) {
                    assistantMsg.reasoning_details = reasoningDetails;
                }`,
				"Gemini encrypted-reasoning candidate migration",
			);
			}
			upgraded = patchPiOpenAiStructuredReasoningSource(upgraded);
			assertPiAiForwardFixSource(relativePath, upgraded);
			return upgraded;
	}
	const originalNormalize = `    const normalizeToolCallId = (id) => {
        // Handle pipe-separated IDs from OpenAI Responses API
        // Format: {call_id}|{id} where {id} can be 400+ chars with special chars (+, /, =)
        // These come from providers like github-copilot, openai-codex, opencode
        // Extract just the call_id part and normalize it
        // Multiple tool calls in the same turn can share call_id but differ by item_id.
        // Preserve item-level uniqueness when replaying into Chat Completions, which
        // requires distinct tool call ids.
        if (id.includes("|")) {
            // Sanitize to allowed chars and truncate to 40 chars (OpenAI limit)
            const separatorIndex = id.indexOf("|");
            const callId = id.slice(0, separatorIndex).replace(/[^a-zA-Z0-9_-]/g, "_");
            const itemId = id.slice(separatorIndex + 1).replace(/[^a-zA-Z0-9_-]/g, "_");
            const combinedId = itemId.length > 0 ? \`\${callId}_\${itemId}\` : callId;
            if (combinedId.length <= 40) {
                return combinedId;
            }
            const hash = shortHash(id).slice(0, 8);
            const prefix = callId.slice(0, Math.max(1, 40 - hash.length - 1));
            return \`\${prefix}_\${hash}\`;
        }
        if (model.provider === "openai")
            return id.length > 40 ? id.slice(0, 40) : id;
        return id;
    };`;
	const patchedNormalize = `    // ${PI_AI_FORWARD_FIX_MARKERS.openAiCompletions}
    const maxToolCallIdLength = 40;
    const fitToolCallIdWithHash = (candidate, hashSource) => {
        if (candidate.length <= maxToolCallIdLength)
            return candidate;
        const hash = shortHash(hashSource);
        const prefix = candidate.slice(0, Math.max(1, maxToolCallIdLength - hash.length - 1));
        return \`\${prefix}_\${hash}\`;
    };
    const normalizeToolCallId = (id) => {
        if (id.includes("|")) {
            const separatorIndex = id.indexOf("|");
            const callId = id.slice(0, separatorIndex).replace(/[^a-zA-Z0-9_-]/g, "_");
            const itemId = id.slice(separatorIndex + 1).replace(/[^a-zA-Z0-9_-]/g, "_");
            const combinedId = itemId.length > 0 ? \`\${callId}_\${itemId}\` : callId;
            return fitToolCallIdWithHash(combinedId, id);
        }
        // Gateways can forward foreign Chat Completions history into a Responses
        // backend. Preserve short native IDs; sanitize and hash only oversized IDs.
        if (id.length <= maxToolCallIdLength)
            return id;
        return fitToolCallIdWithHash(id.replace(/[^a-zA-Z0-9_-]/g, "_"), id);
    };`;
	let patched = replaceRequired(
		source,
		originalNormalize,
		patchedNormalize,
		"OpenAI-compatible tool-call ID normalization",
	);
	if (patched.includes("        let streamedReasoningDetails;")) {
		patched = patchCurrentOpenAiCompletions(patched);
		assertPiAiForwardFixSource(relativePath, patched);
		return patched;
	}
	patched = replaceRequired(
		patched,
		'import { retryProviderRequest } from "../utils/provider-retry.js";',
		'import { isTransientInFlightBudgetError, retryProviderRequest } from "../utils/provider-retry.js";',
		"OpenRouter retry helper import",
	);
	patched = replaceRequired(
		patched,
		"export const stream = (model, context, options) => {",
		`function isFeynmanSerializedReasoningDetail(value) {
    if (typeof value !== "string")
        return false;
    try {
        return isEncryptedReasoningDetail(JSON.parse(value));
    }
    catch {
        return false;
    }
}
export const stream = (model, context, options) => {`,
		"Gemini reasoning-signature helper",
	);
	patched = replaceRequired(
		patched,
		"            const pendingReasoningDetailsByToolCallId = new Map();",
		`            const pendingReasoningDetailsByToolCallId = new Map();
            const appendFeynmanEncryptedReasoningDetail = (serializedDetail) => {
                try {
                    const detail = JSON.parse(serializedDetail);
                    if (!isEncryptedReasoningDetail(detail))
                        return;
                    output.reasoningDetails ??= [];
                    if (!output.reasoningDetails.some((existing) => JSON.stringify(existing) === serializedDetail)) {
                        output.reasoningDetails.push(detail);
                    }
                }
                catch {
                    // Keep malformed provider metadata out of the replay payload.
                }
            };`,
		"Gemini and encrypted-reasoning state",
	);
	patched = replaceRequired(
		patched,
		`                            const name = toolCall.function?.name ?? toolCall.custom?.name;`,
		`                            // Gemini 3 OpenAI-compatible endpoints attach a signature
                            // to streamed function calls and require it verbatim on replay.
                            const signature = toolCall.extra_content?.google?.thought_signature;
                            if (compat.supportsGoogleThoughtSignatures &&
                                typeof signature === "string" &&
                                signature.length > 0) {
                                if (!block.thoughtSignature ||
                                    isFeynmanSerializedReasoningDetail(block.thoughtSignature)) {
                                    if (isFeynmanSerializedReasoningDetail(block.thoughtSignature)) {
                                        appendFeynmanEncryptedReasoningDetail(block.thoughtSignature);
                                    }
                                    block.thoughtSignature = signature;
                                }
                            }
                            const name = toolCall.function?.name ?? toolCall.custom?.name;`,
		"Gemini thought-signature capture",
	);
	patched = replaceRequired(
		patched,
		`                        function: {
                            name: tc.name,
                            arguments: JSON.stringify(tc.arguments),
                        },
                    };`,
		`                        function: {
                            name: tc.name,
                            arguments: JSON.stringify(tc.arguments),
                        },
                        ...(compat.supportsGoogleThoughtSignatures &&
                            tc.thoughtSignature &&
                            !isFeynmanSerializedReasoningDetail(tc.thoughtSignature)
                            ? { extra_content: { google: { thought_signature: tc.thoughtSignature } } }
                            : {}),
                    };`,
		"Gemini thought-signature replay",
	);
	patched = replaceRequired(
		patched,
		`                const reasoningDetails = toolCalls
                    .filter((tc) => tc.thoughtSignature)
                    .map((tc) => {
                    try {
                        return JSON.parse(tc.thoughtSignature);
                    }
                    catch {
                        return null;
                    }
                })
                    .filter(Boolean);
                if (reasoningDetails.length > 0) {
                    assistantMsg.reasoning_details = reasoningDetails;
                }`,
		`                const preservedReasoningDetails = Array.isArray(msg.reasoningDetails)
                    ? msg.reasoningDetails
                    : [];
                const reasoningDetails = [];
                const seenReasoningDetails = new Set();
                for (const detail of [
                    ...preservedReasoningDetails,
                    ...toolCalls.map((tc) => {
                        if (!tc.thoughtSignature)
                            return null;
                        try {
                            return JSON.parse(tc.thoughtSignature);
                        }
                        catch {
                            return null;
                        }
                    }),
                ]) {
                    if (!isEncryptedReasoningDetail(detail))
                        continue;
                    const serializedDetail = JSON.stringify(detail);
                    if (seenReasoningDetails.has(serializedDetail))
                        continue;
                    seenReasoningDetails.add(serializedDetail);
                    reasoningDetails.push(detail);
                }
                if (reasoningDetails.length > 0) {
                    assistantMsg.reasoning_details = reasoningDetails;
                }`,
		"Gemini encrypted-reasoning replay",
	);
	patched = replaceRequired(
		patched,
		"    if (options?.toolChoice) {\n        params.tool_choice = options.toolChoice;\n    }",
		"    if (options?.toolChoice && params.tools?.length) {\n        params.tool_choice = options.toolChoice;\n    }",
		"OpenAI-compatible tool choice without tools",
	);
	patched = replaceRequired(
		patched,
		`        supportsLongCacheRetention: !(isTogether ||
            isCloudflareWorkersAI ||
            isCloudflareAiGateway ||
            isNvidia ||
            isAntLing),
    };`,
		`        supportsLongCacheRetention: !(isTogether ||
            isCloudflareWorkersAI ||
            isCloudflareAiGateway ||
            isNvidia ||
            isAntLing),
        supportsGoogleThoughtSignatures: ((model.provider === "openrouter" && /^~?google\\/gemini-3(?:[.:-]|$)/.test(model.id)) ||
            (model.provider === "github-copilot" && /^gemini-3(?:[.:-]|$)/.test(model.id))),
    };`,
		"Gemini thought-signature runtime detection",
	);
	patched = replaceRequired(
		patched,
		`        supportsLongCacheRetention: model.compat.supportsLongCacheRetention ?? detected.supportsLongCacheRetention,
    };`,
		`        supportsLongCacheRetention: model.compat.supportsLongCacheRetention ?? detected.supportsLongCacheRetention,
        supportsGoogleThoughtSignatures: model.compat.supportsGoogleThoughtSignatures ??
            detected.supportsGoogleThoughtSignatures,
    };`,
		"Gemini thought-signature compatibility override",
	);
	patched = replaceRequired(
		patched,
		`                                if (matchingToolCall) {
                                    matchingToolCall.thoughtSignature = serializedDetail;
                                }`,
		`                                if (matchingToolCall) {
                                    if (compat.supportsGoogleThoughtSignatures &&
                                        matchingToolCall.thoughtSignature &&
                                        !isFeynmanSerializedReasoningDetail(matchingToolCall.thoughtSignature)) {
                                        appendFeynmanEncryptedReasoningDetail(serializedDetail);
                                    }
                                    else {
                                        if (isFeynmanSerializedReasoningDetail(matchingToolCall.thoughtSignature)) {
                                            appendFeynmanEncryptedReasoningDetail(matchingToolCall.thoughtSignature);
                                        }
                                        matchingToolCall.thoughtSignature = serializedDetail;
                                    }
                                }`,
		"Gemini encrypted-reasoning coexistence",
	);
	patched = replaceRequired(
		patched,
		`            const { data: openaiStream, response } = await retryProviderRequest(() => client.chat.completions.create(params, requestOptions).withResponse(), {
                maxRetries: options?.maxRetries,
                maxRetryDelayMs: options?.maxRetryDelayMs,
                signal: options?.signal,
            });`,
		`            const openRouterBudgetRetry = model.provider === "openrouter";
            const { data: openaiStream, response } = await retryProviderRequest(() => client.chat.completions.create(params, requestOptions).withResponse(), {
                maxRetries: openRouterBudgetRetry ? (options?.maxRetries ?? 2) : options?.maxRetries,
                maxRetryDelayMs: openRouterBudgetRetry
                    ? (options?.maxRetryDelayMs ?? 120_000)
                    : options?.maxRetryDelayMs,
                retryOn: openRouterBudgetRetry ? isTransientInFlightBudgetError : undefined,
                signal: options?.signal,
            });`,
		"OpenRouter retry layout",
	);
	patched = patchPiOpenAiStructuredReasoningSource(patched);
	assertPiAiForwardFixSource(relativePath, patched);
	return patched;
}

function patchProviderRetry(source) {
	const relativePath = "dist/utils/provider-retry.js";
	if (source.includes(PI_AI_FORWARD_FIX_MARKERS.providerRetry)) {
		let upgraded = source;
		upgraded = upgraded.replace(
			`    if (error.status !== 402 || !error.headers?.get("retry-after"))
        return false;`,
			`    if (error.status !== 402 ||
        error.headers?.get("x-should-retry") === "false" ||
        !error.headers?.get("retry-after"))
        return false;`,
		);
		upgraded = upgraded.replace(
			`    if (error.status !== 402 ||
        error.headers?.get("x-should-retry") === "false" ||
        !error.headers?.get("retry-after"))
        return false;`,
			`    if (!(error instanceof Error) ||
        error.status !== 402 ||
        typeof error.headers?.get !== "function" ||
        error.headers.get("x-should-retry") === "false" ||
        !error.headers.get("retry-after"))
        return false;`,
		);
		upgraded = upgraded.replace(
			`    if (isTransientInFlightBudgetError(error))
        return true;
`,
			"",
		);
		upgraded = upgraded.replace(
			`            if (retriesRemaining <= 0 || !isProviderError(error) ||
                (options.retryOn ? !options.retryOn(error) : !isRetryableProviderError(error)))
                throw error;`,
			`            if (retriesRemaining <= 0 || !isProviderError(error) ||
                !(isRetryableProviderError(error) || options.retryOn?.(error) === true))
                throw error;`,
		);
		assertPiAiForwardFixSource(relativePath, upgraded);
		return upgraded;
	}
	const helper = `// ${PI_AI_FORWARD_FIX_MARKERS.providerRetry}
function getFeynmanStructuredErrorCode(error) {
    for (const candidate of [error.error, error.body, error.response?.data]) {
        if (!candidate || typeof candidate !== "object")
            continue;
        const code = candidate.code ?? candidate.error?.code;
        if (typeof code === "string")
            return code;
    }
    return undefined;
}
export function isTransientInFlightBudgetError(error) {
    if (!(error instanceof Error) ||
        error.status !== 402 ||
        typeof error.headers?.get !== "function" ||
        error.headers.get("x-should-retry") === "false" ||
        !error.headers.get("retry-after"))
        return false;
    return getFeynmanStructuredErrorCode(error) === "in_flight_budget_exhausted";
}
`;
	let patched = replaceRequired(
		source,
		"/** Mirrors the pinned OpenAI/Anthropic SDK retry policy; review when either SDK is upgraded. */\n",
		`${helper}/** Mirrors the pinned OpenAI/Anthropic SDK retry policy; review when either SDK is upgraded. */\n`,
		"transient in-flight budget helper",
	);
	patched = replaceRequired(
		patched,
		`            if (retriesRemaining <= 0 || !isProviderError(error) || !isRetryableProviderError(error))
                throw error;`,
		`            if (retriesRemaining <= 0 || !isProviderError(error) ||
                !(isRetryableProviderError(error) || options.retryOn?.(error) === true))
                throw error;`,
		"scoped retry predicate",
	);
	assertPiAiForwardFixSource(relativePath, patched);
	return patched;
}

function patchProviderRetryDeclaration(source) {
	let patched = source;
	if (!patched.includes("retryOn?: (error: unknown) => boolean;")) {
		patched = patched.replace(
			"    signal?: AbortSignal;\n",
			"    signal?: AbortSignal;\n    retryOn?: (error: unknown) => boolean;\n",
		);
	}
	if (!patched.includes("export declare function isTransientInFlightBudgetError(error: unknown): boolean;")) {
		patched = patched.replace(
			"/**\n * Reproduce the retry behavior used by the OpenAI and Anthropic SDKs",
			"export declare function isTransientInFlightBudgetError(error: unknown): boolean;\n/**\n * Reproduce the retry behavior used by the OpenAI and Anthropic SDKs",
		);
	}
	return patched;
}

function patchPiAiTypesDeclaration(source) {
	let patched = source;
	if (!patched.includes("supportsGoogleThoughtSignatures?: boolean;")) {
		patched = patched.replace(
			"    supportsLongCacheRetention?: boolean;\n",
			"    supportsLongCacheRetention?: boolean;\n    /** Whether OpenAI-compatible Gemini 3 tool calls require Google thought-signature replay. */\n    supportsGoogleThoughtSignatures?: boolean;\n",
		);
	}
	patched = patched.replace(
		"    /** Provider-encrypted reasoning metadata retained alongside Gemini tool signatures. */\n    reasoningDetails?: JsonValue[];\n",
		"",
	);
	return patched;
}

export function patchPiAiForwardFixSource(relativePath, source) {
	if (isCurrentPiAiCatalog(relativePath, source)) return source;
	if (relativePath.includes("/providers/data/")) {
		if (relativePath.endsWith("/.manifest.json")) {
			return patchModelDataManifest(relativePath, source);
		}
		return patchModelCatalog(relativePath, source);
	}
	let patched = stripStaleSourceMapDirective(source, relativePath);
	patched = relativePath in TOOL_CHOICE_BASE_OPTIONS
		? patchProviderNeutralToolChoice(relativePath, patched)
		: patched;
	switch (relativePath) {
		case "dist/api/google-generative-ai.js":
			patched = patchGoogleGenerativeAi(patched);
			break;
		case "dist/api/google-shared.js":
			patched = patchGoogleShared(patched);
			break;
		case "dist/api/google-vertex.js":
			patched = patchGoogleVertex(patched);
			break;
		case "dist/api/bedrock-converse-stream.js":
			patched = patchPiBedrockForwardFixSource(patched);
			break;
		case "dist/api/openai-completions.js":
			patched = patchOpenAiCompletions(patched);
			break;
		case "dist/utils/provider-retry.js":
			patched = patchProviderRetry(patched);
			break;
		case "dist/utils/provider-retry.d.ts":
			patched = patchProviderRetryDeclaration(patched);
			break;
		case "dist/types.d.ts":
			patched = patchPiAiTypesDeclaration(patched);
			break;
		case "dist/api/anthropic-messages.js":
		case "dist/api/azure-openai-responses.js":
		case "dist/api/mistral-conversations.js":
		case "dist/api/openai-codex-responses.js":
			break;
		case "dist/api/openai-responses.js":
			patched = patchPiOpenAiResponsesNoToolsSource(patched, relativePath);
			break;
		default:
			throw new Error(`Unknown Pi AI forward patch target: ${relativePath}`);
	}
	assertPiAiForwardFixSource(relativePath, patched);
	return patched;
}
