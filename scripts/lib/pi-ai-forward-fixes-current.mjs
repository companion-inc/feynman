import { createHash } from "node:crypto";
import { patchPiOpenAiStructuredReasoningSource } from "./pi-openai-reasoning-patch.mjs";

function replace(source, from, to, label) {
	if (source.split(from).length !== 2) throw new Error(`Unsupported Pi 0.85.1 ${label}`);
	return source.replace(from, to);
}

// Called after the parent normalizes tool IDs. Upstream owns new streamed-event
// sequencing; this adds only the still-missing provider-specific replay/retry fixes.
export function patchCurrentOpenAiCompletions(source) {
	let patched = patchPiOpenAiStructuredReasoningSource(source);
	patched = replace(patched, "export const stream = (model, context, options) => {",
		`function isFeynmanSerializedReasoningDetail(value) {
    return parseLegacyEncryptedReasoningDetail(value) !== undefined;
}
export const stream = (model, context, options) => {`, "Gemini signature helper");
	patched = replace(patched,
		"                            const block = ensureToolCallBlock(toolCall);",
		`                            const block = ensureToolCallBlock(toolCall);
                            const signature = toolCall.extra_content?.google?.thought_signature;
                            if (compat.supportsGoogleThoughtSignatures &&
                                typeof signature === "string" &&
                                signature.length > 0) {
                                if (!block.thoughtSignature ||
                                    isFeynmanSerializedReasoningDetail(block.thoughtSignature)) {
                                    block.thoughtSignature = signature;
                                }
                            }`, "Gemini signature capture");
	patched = replace(patched,
		`                        type: "function",
                        function: {
                            name: tc.name,
                            arguments: JSON.stringify(tc.arguments),
                        },`,
		`                        type: "function",
                        function: {
                            name: tc.name,
                            arguments: JSON.stringify(tc.arguments),
                        },
                        ...(compat.supportsGoogleThoughtSignatures && tc.thoughtSignature &&
                            !isFeynmanSerializedReasoningDetail(tc.thoughtSignature)
                            ? { extra_content: { google: { thought_signature: tc.thoughtSignature } } }
                            : {}),`, "Gemini signature replay");
	patched = replace(patched,
		"    if (options?.toolChoice) {\n        params.tool_choice = options.toolChoice;\n    }",
		"    if (options?.toolChoice && params.tools?.length) {\n        params.tool_choice = options.toolChoice;\n    }",
		"no-tools tool choice");
	patched = replace(patched,
		`            isAntLing),
    };`,
		`            isAntLing),
        supportsGoogleThoughtSignatures: ((model.provider === "openrouter" && /^~?google\\/gemini-3(?:[.:-]|$)/.test(model.id)) ||
            (model.provider === "github-copilot" && /^gemini-3(?:[.:-]|$)/.test(model.id))),
    };`, "Gemini model detection");
	patched = replace(patched,
		"        vllmPriority: model.compat.vllmPriority,",
		`        vllmPriority: model.compat.vllmPriority,
        supportsGoogleThoughtSignatures: model.compat.supportsGoogleThoughtSignatures ??
            detected.supportsGoogleThoughtSignatures,`, "Gemini compatibility override");
	patched = replace(patched,
		'import { retryProviderRequest } from "../utils/provider-retry.js";',
		'import { isTransientInFlightBudgetError, retryProviderRequest } from "../utils/provider-retry.js";',
		"OpenRouter retry import");
	patched = replace(patched,
		`            const { data: openaiStream, response } = await retryProviderRequest(() => client.chat.completions.create(params, requestOptions).withResponse(), {
                maxRetries: options?.maxRetries,
                maxRetryDelayMs: options?.maxRetryDelayMs,
                signal: options?.signal,
            });`,
		`            const openRouterBudgetRetry = model.provider === "openrouter";
            const { data: openaiStream, response } = await retryProviderRequest(() => client.chat.completions.create(params, requestOptions).withResponse(), {
                maxRetries: openRouterBudgetRetry ? (options?.maxRetries ?? 2) : options?.maxRetries,
                maxRetryDelayMs: openRouterBudgetRetry ? (options?.maxRetryDelayMs ?? 120_000) : options?.maxRetryDelayMs,
                retryOn: openRouterBudgetRetry ? isTransientInFlightBudgetError : undefined,
                signal: options?.signal,
            });`, "OpenRouter bounded budget retry");
	return patched;
}

// Exact published 0.85.1 catalog identities. Never replay 0.84.2 catalog edits
// over these files: upstream added models and corrected GLM-5.2 to text-only.
const CURRENT_CATALOG_HASHES = Object.freeze({
  "dist/providers/data/xiaomi.json": "f06f1011d606d22311b1f4c50eb36d38b8cd99abf5760faee657d5559e87452b",
  "dist/providers/data/xiaomi-token-plan-cn.json": "c295dadf4097b5d86af15e924fb2a1a6342bae9e0a9a5839c9fca216308c51e5",
  "dist/providers/data/xiaomi-token-plan-ams.json": "a36446cb9e3cb4f7054617676fd711092245a74f703ba89573f21d2673b85fa8",
  "dist/providers/data/xiaomi-token-plan-sgp.json": "93d359575c2348c97d79a2b14e1e9437199bd4aee948d58611b3fbab75cd9fb3",
  "dist/providers/data/zai.json": "f42790c77fb4681a656897a9d860b939916c0ddf979a5f16856bce9573cdf64e",
  "dist/providers/data/zai-coding-cn.json": "d3c969020a7ab978497837a3301c7bca364d704082832221cfe61e6596333e56",
  "dist/providers/data/baseten.json": "51e518cfa5b2578f1946bcc0defc15814a6391706671a1b2c09a4558582ca99d",
  "dist/providers/data/.manifest.json": "30e7f58cc33d5901dbcb64f0e00d0133620005737ffb73553b358ca23572bac8"
});

export function isCurrentPiAiCatalog(relativePath, source) {
	return CURRENT_CATALOG_HASHES[relativePath] === createHash("sha256").update(source).digest("hex");
}
