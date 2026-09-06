/**
 * Exact Pi 0.84.2 OpenAI-compatible structured-reasoning transformer.
 *
 * Ports upstream commits 4ca636c5, b7bb00b9, and c5ad7c1b while retaining
 * Feynman's same-version Gemini tool thought-signature compatibility. Remove
 * this helper with the parent Pi AI forward patch after a supported Pi release
 * contains all three structured-reasoning fixes.
 */

function countOccurrences(source, fragment) {
	return source.split(fragment).length - 1;
}

function replaceRequired(source, original, replacement, label) {
	const count = countOccurrences(source, original);
	if (count !== 1) {
		throw new Error(
			`Unsupported Pi 0.84.2 ${label} layout; expected 1 occurrence, found ${count}`,
		);
	}
	return source.replace(original, replacement);
}

const OPENAI_REASONING_DETAIL_HELPERS = `function isReasoningDetailObject(detail) {
    return typeof detail === "object" && detail !== null && !Array.isArray(detail);
}
function hasValidCommonReasoningDetailFields(candidate) {
    return ((candidate.id === undefined || candidate.id === null || typeof candidate.id === "string") &&
        (candidate.format === undefined || typeof candidate.format === "string") &&
        (candidate.index === undefined || typeof candidate.index === "number"));
}
function isOpenAIReasoningDetail(detail) {
    if (!isReasoningDetailObject(detail) || !hasValidCommonReasoningDetailFields(detail)) {
        return false;
    }
    switch (detail.type) {
        case "reasoning.summary":
            return typeof detail.summary === "string";
        case "reasoning.encrypted":
            return typeof detail.data === "string";
        case "reasoning.text":
            return (typeof detail.text === "string" &&
                (detail.signature === undefined || detail.signature === null || typeof detail.signature === "string"));
        default:
            return false;
    }
}
function parseOpenAIReasoningDetails(signature) {
    if (!signature)
        return undefined;
    try {
        const parsed = JSON.parse(signature);
        return Array.isArray(parsed) && parsed.length > 0 && parsed.every(isOpenAIReasoningDetail)
            ? parsed
            : undefined;
    }
    catch {
        return undefined;
    }
}
function parseLegacyEncryptedReasoningDetail(signature) {
    if (!signature)
        return undefined;
    try {
        const parsed = JSON.parse(signature);
        return isOpenAIReasoningDetail(parsed) &&
            parsed.type === "reasoning.encrypted" &&
            typeof parsed.id === "string" &&
            parsed.id.length > 0 &&
            parsed.data.length > 0
            ? parsed
            : undefined;
    }
    catch {
        return undefined;
    }
}
function fillMissingCommonReasoningDetailFields(target, source) {
    target.id ??= source.id;
    target.format ||= source.format;
    target.index ??= source.index;
}
function appendOpenAIReasoningDetail(details, detail) {
    const lastDetail = details[details.length - 1];
    if (detail.type === "reasoning.text" && lastDetail?.type === "reasoning.text") {
        lastDetail.text += detail.text;
        lastDetail.signature ||= detail.signature;
        fillMissingCommonReasoningDetailFields(lastDetail, detail);
        return;
    }
    if (detail.type === "reasoning.summary" && lastDetail?.type === "reasoning.summary") {
        lastDetail.summary += detail.summary;
        fillMissingCommonReasoningDetailFields(lastDetail, detail);
        return;
    }
    details.push({ ...detail });
}
const OPENAI_COMPLETIONS_REASONING_FIELDS = ["reasoning", "reasoning_content", "reasoning_text"];
function isOpenAICompletionsReasoningField(field) {
    return OPENAI_COMPLETIONS_REASONING_FIELDS.includes(field);
}`;

const OPENAI_REASONING_STREAM_STATE = `        const openAiReasoningDetailsByBlock = new WeakMap();
        const finalizeOpenAiReasoningDetails = (block) => {
            const preservedDetails = openAiReasoningDetailsByBlock.get(block);
            if (!preservedDetails || preservedDetails.length === 0)
                return;
            block.thinkingSignature = JSON.stringify(preservedDetails);
            openAiReasoningDetailsByBlock.delete(block);
        };`;

const OPENAI_REASONING_QUADRATIC_STREAM_CAPTURE = `                    const reasoningDetails = choice.delta.reasoning_details;
                    if (Array.isArray(reasoningDetails)) {
                        for (const detail of reasoningDetails) {
                            if (!isOpenAIReasoningDetail(detail))
                                continue;
                            const block = ensureThinkingBlock("");
                            const preservedDetails = parseOpenAIReasoningDetails(block.thinkingSignature) ?? [];
                            appendOpenAIReasoningDetail(preservedDetails, detail);
                            // Keep provider replay data in the existing signature slot. OpenRouter streams
                            // reasoning_details as deltas: consecutive text/summary deltas are merged into
                            // logical entries, while encrypted entries remain opaque and discrete.
                            block.thinkingSignature = JSON.stringify(preservedDetails);
                        }
                    }`;

const OPENAI_REASONING_STREAM_CAPTURE = `                    const reasoningDetails = choice.delta.reasoning_details;
                    if (Array.isArray(reasoningDetails)) {
                        for (const detail of reasoningDetails) {
                            if (!isOpenAIReasoningDetail(detail))
                                continue;
                            const block = ensureThinkingBlock("");
                            let preservedDetails = openAiReasoningDetailsByBlock.get(block);
                            if (!preservedDetails) {
                                preservedDetails = [];
                                openAiReasoningDetailsByBlock.set(block, preservedDetails);
                            }
                            // Accumulate provider replay data in memory. OpenRouter streams
                            // reasoning_details as deltas: consecutive text/summary deltas are merged into
                            // logical entries, while encrypted entries remain opaque and discrete.
                            appendOpenAIReasoningDetail(preservedDetails, detail);
                        }
                    }`;

const OPENAI_REASONING_FINISH_BOUNDARY = `                else if (block.type === "thinking") {
                    finalizeOpenAiReasoningDetails(block);
                    stream.push({`;

const OPENAI_REASONING_ERROR_BOUNDARY = `            for (const block of output.content) {
                finalizeOpenAiReasoningDetails(block);
                delete block.index;`;

const OPENAI_REASONING_REPLAY_SETUP = `            const thinkingBlocks = msg.content.filter(isThinkingContentBlock);
            const toolCalls = msg.content.filter(isToolCallBlock);
            const signedReasoningDetails = thinkingBlocks
                .map((block) => parseOpenAIReasoningDetails(block.thinkingSignature))
                .find((details) => details !== undefined);
            const legacyMessageReasoningDetails = msg.provider === model.provider &&
                msg.api === model.api &&
                msg.model === model.id &&
                Array.isArray(msg.reasoningDetails) &&
                msg.reasoningDetails.length > 0 &&
                msg.reasoningDetails.every(isOpenAIReasoningDetail)
                ? msg.reasoningDetails
                : undefined;
            const legacyReasoningDetails = toolCalls
                .map((toolCall) => parseLegacyEncryptedReasoningDetail(toolCall.thoughtSignature))
                .filter((detail) => detail !== undefined);
            const preservedReasoningDetails = signedReasoningDetails ??
                legacyMessageReasoningDetails ??
                (legacyReasoningDetails.length > 0 ? legacyReasoningDetails : undefined);
            const nonEmptyThinkingBlocks = thinkingBlocks.filter((block) => block.thinking.trim().length > 0);`;

const OPENAI_REASONING_RAW_REPLAY = `                    // reasoning_details is the structured alternative to a raw reasoning field.
                    if (!preservedReasoningDetails) {
                        // Use the signature from the first thinking block if available (for llama.cpp server + gpt-oss)
                        let signature = nonEmptyThinkingBlocks[0].thinkingSignature;
                        if (model.provider === "opencode-go" && signature === "reasoning") {
                            signature = "reasoning_content";
                        }
                        if (signature && isOpenAICompletionsReasoningField(signature)) {
                            assistantMsg[signature] = nonEmptyThinkingBlocks.map((block) => block.thinking).join("\\n");
                        }
                    }`;

const OPENAI_REASONING_REPLAY_ASSIGNMENT = `            if (preservedReasoningDetails) {
                assistantMsg.reasoning_details = preservedReasoningDetails;
            }`;

export function isPiOpenAiStructuredReasoningPatched(source) {
	return [
		OPENAI_REASONING_DETAIL_HELPERS,
		OPENAI_REASONING_STREAM_STATE,
		OPENAI_REASONING_STREAM_CAPTURE,
		OPENAI_REASONING_FINISH_BOUNDARY,
		OPENAI_REASONING_ERROR_BOUNDARY,
	].every((fragment) => source.includes(fragment));
}

export function assertPiOpenAiStructuredReasoningSource(
	source,
	relativePath = "dist/api/openai-completions.js",
) {
	for (const fragment of [
		OPENAI_REASONING_DETAIL_HELPERS,
		OPENAI_REASONING_STREAM_STATE,
		OPENAI_REASONING_STREAM_CAPTURE,
		OPENAI_REASONING_FINISH_BOUNDARY,
		OPENAI_REASONING_ERROR_BOUNDARY,
		OPENAI_REASONING_REPLAY_SETUP,
		OPENAI_REASONING_RAW_REPLAY,
		OPENAI_REASONING_REPLAY_ASSIGNMENT,
		"function isFeynmanSerializedReasoningDetail(value) {\n    return parseLegacyEncryptedReasoningDetail(value) !== undefined;\n}",
	]) {
		const count = countOccurrences(source, fragment);
		if (count !== 1) {
			throw new Error(
				`Incomplete Pi AI forward patch ${relativePath}: expected exactly one semantic fragment, found ${count}: ${fragment}`,
			);
		}
	}
	for (const forbidden of [
		"output.reasoningDetails",
		"pendingReasoningDetailsByToolCallId",
		"appendFeynmanEncryptedReasoningDetail",
		"function isEncryptedReasoningDetail(",
		"const preservedDetails = parseOpenAIReasoningDetails(block.thinkingSignature) ?? [];",
	]) {
		if (source.includes(forbidden)) {
			throw new Error(`Incomplete Pi AI forward patch ${relativePath}: retained ${forbidden}`);
		}
	}
}

function patchPiOpenAiStructuredReasoningAccumulator(source) {
	let patched = replaceRequired(
		source,
		`            timestamp: Date.now(),
        };
        try {`,
		`            timestamp: Date.now(),
        };
${OPENAI_REASONING_STREAM_STATE}
        try {`,
		"OpenAI structured reasoning stream accumulator",
	);
	patched = replaceRequired(
		patched,
		OPENAI_REASONING_QUADRATIC_STREAM_CAPTURE,
		OPENAI_REASONING_STREAM_CAPTURE,
		"OpenAI structured reasoning constant-work stream capture",
	);
	patched = replaceRequired(
		patched,
		`                else if (block.type === "thinking") {
                    stream.push({`,
		OPENAI_REASONING_FINISH_BOUNDARY,
		"OpenAI structured reasoning block-finalization boundary",
	);
	patched = replaceRequired(
		patched,
		`            for (const block of output.content) {
                delete block.index;`,
		OPENAI_REASONING_ERROR_BOUNDARY,
		"OpenAI structured reasoning error-finalization boundary",
	);
	return patched;
}

export function patchPiOpenAiStructuredReasoningSource(source) {
	if (isPiOpenAiStructuredReasoningPatched(source)) {
		return source;
	}
	if (source.includes("        let streamedReasoningDetails;")) {
		// Upstream 0.85.1 landed structured replay but its accumulator is shared
		// across thinking blocks. Retain our per-block, once-only finalization
		// and scoped legacy-message replay without undoing new stream events.
		let patched = replaceRequired(source,
			`        let streamedReasoningDetails;
        const applyStreamedReasoningDetails = (block) => {
            if (streamedReasoningDetails !== undefined) {
                block.thinkingSignature = JSON.stringify(streamedReasoningDetails);
            }
        };`,
			OPENAI_REASONING_STREAM_STATE, "0.85.1 reasoning accumulator");
		patched = replaceRequired(patched,
			`                            ensureThinkingBlock("");
                            streamedReasoningDetails ??= [];
                            // Keep provider replay data in the existing signature slot. OpenRouter streams
                            // reasoning_details as deltas: consecutive text/summary deltas are merged into
                            // logical entries, while encrypted entries remain opaque and discrete.
                            appendOpenAIReasoningDetail(streamedReasoningDetails, detail);`,
			`                            const block = ensureThinkingBlock("");
                            let preservedDetails = openAiReasoningDetailsByBlock.get(block);
                            if (!preservedDetails) {
                                preservedDetails = [];
                                openAiReasoningDetailsByBlock.set(block, preservedDetails);
                            }
                            // Accumulate provider replay data in memory. OpenRouter streams
                            // reasoning_details as deltas: consecutive text/summary deltas are merged into
                            // logical entries, while encrypted entries remain opaque and discrete.
                            appendOpenAIReasoningDetail(preservedDetails, detail);`,
			"0.85.1 reasoning capture");
		patched = replaceRequired(patched,
			"                else if (block.type === \"thinking\") {\n                    applyStreamedReasoningDetails(block);",
			"                else if (block.type === \"thinking\") {\n                    finalizeOpenAiReasoningDetails(block);", "0.85.1 thinking finalization");
		// The same line occurs in the error boundary too; distinguish its wrapper.
		patched = replaceRequired(patched,
			`                if (block.type === "thinking") {
                    applyStreamedReasoningDetails(block);
                }
                delete block.index;`,
			"                finalizeOpenAiReasoningDetails(block);\n                delete block.index;",
			"0.85.1 error finalization");
		patched = replaceRequired(patched,
			"return Array.isArray(parsed) && parsed.length > 0 && parsed.every(isOpenAIReasoningDetail) ? parsed : undefined;",
			"return Array.isArray(parsed) && parsed.length > 0 && parsed.every(isOpenAIReasoningDetail)\n            ? parsed\n            : undefined;",
			"0.85.1 reasoning parser formatting");
		const start = patched.indexOf("            const thinkingBlocks = msg.content.filter(isThinkingContentBlock);");
		const endFragment = "            const nonEmptyThinkingBlocks = thinkingBlocks.filter((block) => block.thinking.trim().length > 0);";
		const end = patched.indexOf(endFragment, start);
		if (start < 0 || end < 0) throw new Error("Unsupported Pi 0.85.1 reasoning replay boundary");
		patched = patched.slice(0, start) + OPENAI_REASONING_REPLAY_SETUP + patched.slice(end + endFragment.length);
		return patched;
	}
	if (source.includes(OPENAI_REASONING_DETAIL_HELPERS)) {
		return patchPiOpenAiStructuredReasoningAccumulator(source);
	}

	let patched = replaceRequired(
		source,
		`function isEncryptedReasoningDetail(detail) {
    if (typeof detail !== "object" || detail === null) {
        return false;
    }
    const candidate = detail;
    return (candidate.type === "reasoning.encrypted" &&
        typeof candidate.id === "string" &&
        candidate.id.length > 0 &&
        typeof candidate.data === "string" &&
        candidate.data.length > 0);
}`,
		OPENAI_REASONING_DETAIL_HELPERS,
		"OpenAI structured reasoning detail parsers",
	);
	patched = replaceRequired(
		patched,
		`function isFeynmanSerializedReasoningDetail(value) {
    if (typeof value !== "string")
        return false;
    try {
        return isEncryptedReasoningDetail(JSON.parse(value));
    }
    catch {
        return false;
    }
}`,
		`function isFeynmanSerializedReasoningDetail(value) {
    return parseLegacyEncryptedReasoningDetail(value) !== undefined;
}`,
		"OpenAI legacy encrypted reasoning parser",
	);
	patched = replaceRequired(
		patched,
		`            const toolCallBlocksById = new Map();
            const pendingReasoningDetailsByToolCallId = new Map();
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
		"            const toolCallBlocksById = new Map();",
		"OpenAI structured reasoning stream state",
	);
	patched = replaceRequired(
		patched,
		`            const applyPendingReasoningDetail = (block) => {
                if (!block.id) {
                    return;
                }
                const pendingReasoningDetail = pendingReasoningDetailsByToolCallId.get(block.id);
                if (pendingReasoningDetail) {
                    block.thoughtSignature = pendingReasoningDetail;
                    pendingReasoningDetailsByToolCallId.delete(block.id);
                }
            };
`,
		"",
		"OpenAI legacy pending reasoning attachment",
	);
	patched = replaceRequired(
		patched,
		"                applyPendingReasoningDetail(block);\n",
		"",
		"OpenAI legacy pending reasoning application",
	);
	patched = replaceRequired(
		patched,
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
		`                            if (compat.supportsGoogleThoughtSignatures &&
                                typeof signature === "string" &&
                                signature.length > 0) {
                                if (!block.thoughtSignature ||
                                    isFeynmanSerializedReasoningDetail(block.thoughtSignature)) {
                                    block.thoughtSignature = signature;
                                }
                            }`,
		"Gemini thought-signature coexistence with structured reasoning",
	);
	patched = replaceRequired(
		patched,
		`                    const reasoningDetails = choice.delta.reasoning_details;
                    if (Array.isArray(reasoningDetails)) {
                        for (const detail of reasoningDetails) {
                            if (isEncryptedReasoningDetail(detail)) {
                                const serializedDetail = JSON.stringify(detail);
                                const matchingToolCall = toolCallBlocksById.get(detail.id);
                                if (matchingToolCall) {
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
                                }
                                else {
                                    pendingReasoningDetailsByToolCallId.set(detail.id, serializedDetail);
                                }
                            }
                        }
                    }`,
		OPENAI_REASONING_QUADRATIC_STREAM_CAPTURE,
		"OpenAI structured reasoning stream capture",
	);
	patched = replaceRequired(
		patched,
		`            const nonEmptyThinkingBlocks = msg.content
                .filter(isThinkingContentBlock)
                .filter((block) => block.thinking.trim().length > 0);`,
		OPENAI_REASONING_REPLAY_SETUP,
		"OpenAI structured reasoning replay setup",
	);
	patched = replaceRequired(
		patched,
		`                    // Use the signature from the first thinking block if available (for llama.cpp server + gpt-oss)
                    let signature = nonEmptyThinkingBlocks[0].thinkingSignature;
                    if (model.provider === "opencode-go" && signature === "reasoning") {
                        signature = "reasoning_content";
                    }
                    if (signature && signature.length > 0) {
                        assistantMsg[signature] = nonEmptyThinkingBlocks.map((block) => block.thinking).join("\\n");
                    }`,
		OPENAI_REASONING_RAW_REPLAY,
		"OpenAI structured reasoning raw field exclusion",
	);
	patched = replaceRequired(
		patched,
		`            const toolCalls = msg.content.filter(isToolCallBlock);
            if (toolCalls.length > 0) {`,
		"            if (toolCalls.length > 0) {",
		"OpenAI structured reasoning shared tool calls",
	);
	patched = replaceRequired(
		patched,
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
                }
`,
		"",
		"OpenAI legacy reasoning replay aggregation",
	);
	patched = replaceRequired(
		patched,
		`            if (compat.requiresReasoningContentOnAssistantMessages &&
                model.reasoning &&
                assistantMsg.reasoning_content === undefined) {`,
		`${OPENAI_REASONING_REPLAY_ASSIGNMENT}
            if (compat.requiresReasoningContentOnAssistantMessages &&
                model.reasoning &&
                assistantMsg.reasoning_content === undefined) {`,
		"OpenAI structured reasoning replay assignment",
	);
	return patchPiOpenAiStructuredReasoningAccumulator(patched);
}
