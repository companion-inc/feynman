const PI_BEDROCK_FORWARD_FIX_REQUIRED_VERSION = "0.84.2";
const PI_BEDROCK_FORWARD_FIX_RELATIVE_PATH = "dist/api/bedrock-converse-stream.js";

export const PI_BEDROCK_RESPONSE_HEADERS_MARKER =
	"Feynman Pi 0.84.2 forward patch: Bedrock Smithy response headers";
export const PI_BEDROCK_TOOL_RESULT_IMAGES_MARKER =
	"Feynman Pi 0.84.2 forward patch: Bedrock OpenAI tool-result images";

const PATCHED_TOOL_RESULT_CONVERTER = `function convertToolResultContent(content, hoistImages = false) {
    const result = [];
    for (const c of content) {
        if (c.type === "image") {
            if (!hoistImages)
                result.push({ image: createImageBlock(c.mimeType, c.data) });
        }
        else {
            const textBlock = createNonBlankTextBlock(c.text);
            if (textBlock)
                result.push(textBlock);
        }
    }
    if (result.length === 0)
        result.push({ text: EMPTY_TEXT_PLACEHOLDER });
    return result;
}`;

const PATCHED_TOOL_RESULT_HELPERS = `// ${PI_BEDROCK_TOOL_RESULT_IMAGES_MARKER}
function shouldHoistToolResultImages(model) {
    return model.id.startsWith("openai.") || model.id.includes(".openai.");
}
function convertToolResultImages(content) {
    return content
        .filter((c) => c.type === "image")
        .map((c) => ({ image: createImageBlock(c.mimeType, c.data) }));
}`;

const PATCHED_TOOL_RESULT_CASE = `            case "toolResult": {
                // Collect all consecutive toolResult messages into a single user message
                // Bedrock requires all tool results to be in one message
                const toolResults = [];
                const toolImages = [];
                const hoistImages = shouldHoistToolResultImages(model);
                // Add current tool result with all content blocks combined
                toolResults.push({
                    toolResult: {
                        toolUseId: m.toolCallId,
                        content: convertToolResultContent(m.content, hoistImages),
                        status: m.isError ? ToolResultStatus.ERROR : ToolResultStatus.SUCCESS,
                    },
                });
                if (hoistImages)
                    toolImages.push(...convertToolResultImages(m.content));
                // Look ahead for consecutive toolResult messages
                let j = i + 1;
                while (j < transformedMessages.length && transformedMessages[j].role === "toolResult") {
                    const nextMsg = transformedMessages[j];
                    toolResults.push({
                        toolResult: {
                            toolUseId: nextMsg.toolCallId,
                            content: convertToolResultContent(nextMsg.content, hoistImages),
                            status: nextMsg.isError ? ToolResultStatus.ERROR : ToolResultStatus.SUCCESS,
                        },
                    });
                    if (hoistImages)
                        toolImages.push(...convertToolResultImages(nextMsg.content));
                    j++;
                }
                // Skip the messages we've already processed
                i = j - 1;
                result.push({
                    role: ConversationRole.USER,
                    content: [...toolResults, ...toolImages],
                });
                break;
            }`;

function countOccurrences(source, fragment) {
	return source.split(fragment).length - 1;
}

function replaceRequired(source, original, replacement, label) {
	const count = countOccurrences(source, original);
	if (count !== 1) {
		throw new Error(
			`Unsupported Pi ${PI_BEDROCK_FORWARD_FIX_REQUIRED_VERSION} ${label} layout; expected 1 occurrence, found ${count}`,
		);
	}
	return source.replace(original, replacement);
}

function assertExactBlock(source, block, label) {
	const count = countOccurrences(source, block);
	if (count !== 1) {
		throw new Error(
			`Incomplete Pi AI forward patch ${PI_BEDROCK_FORWARD_FIX_RELATIVE_PATH}: expected 1 exact ${label} block, found ${count}`,
		);
	}
}

function assertBedrockResponseHeadersSource(source) {
	for (const fragment of [
		PI_BEDROCK_RESPONSE_HEADERS_MARKER,
		"addResponseHeadersMiddleware(client, options.onResponse, model",
		"if (!observedRawResponse && response.$metadata.httpStatusCode !== undefined)",
		'name: "pi-ai-response-headers"',
	]) {
		if (!source.includes(fragment)) {
			throw new Error(
				`Incomplete Pi AI forward patch ${PI_BEDROCK_FORWARD_FIX_RELATIVE_PATH}: missing ${fragment}`,
			);
		}
	}
}

function assertBedrockToolResultImagesSource(source) {
	assertExactBlock(source, PATCHED_TOOL_RESULT_CONVERTER, "Bedrock tool-result converter");
	assertExactBlock(source, PATCHED_TOOL_RESULT_HELPERS, "Bedrock tool-result helper");
	assertExactBlock(source, PATCHED_TOOL_RESULT_CASE, "Bedrock tool-result publication");
}

export function assertPiBedrockForwardFixSource(source) {
	assertBedrockResponseHeadersSource(source);
	assertBedrockToolResultImagesSource(source);
}

function patchBedrockResponseHeaders(source) {
	if (source.includes(PI_BEDROCK_RESPONSE_HEADERS_MARKER)) {
		assertBedrockResponseHeadersSource(source);
		return source;
	}
	if (source.includes("function addResponseHeadersMiddleware(")) {
		const annotated = `// ${PI_BEDROCK_RESPONSE_HEADERS_MARKER}\n${source}`;
		assertBedrockResponseHeadersSource(annotated);
		return annotated;
	}
	let patched = replaceRequired(
		source,
		"            const client = new BedrockRuntimeClient(config);",
		`            const client = new BedrockRuntimeClient(config);
            let observedRawResponse = false;
            if (options.onResponse) {
                addResponseHeadersMiddleware(client, options.onResponse, model, () => {
                    observedRawResponse = true;
                });
            }`,
		"Bedrock response middleware registration",
	);
	patched = replaceRequired(
		patched,
		"            if (response.$metadata.httpStatusCode !== undefined) {",
		"            if (!observedRawResponse && response.$metadata.httpStatusCode !== undefined) {",
		"Bedrock metadata fallback",
	);
	const anchor = `    client.middlewareStack.add(middleware, { step: "build", name: "pi-ai-custom-headers", priority: "low" });
}
export const streamSimple`;
	const helper = `    client.middlewareStack.add(middleware, { step: "build", name: "pi-ai-custom-headers", priority: "low" });
}
// ${PI_BEDROCK_RESPONSE_HEADERS_MARKER}
function isSmithyHttpResponse(response) {
    if (!response || typeof response !== "object")
        return false;
    const candidate = response;
    return typeof candidate.statusCode === "number" && !!candidate.headers && typeof candidate.headers === "object";
}
function toProviderResponse(response) {
    if (!isSmithyHttpResponse(response))
        return undefined;
    return { status: response.statusCode, headers: { ...response.headers } };
}
function addResponseHeadersMiddleware(client, onResponse, model, onObserved) {
    const middleware = (next) => async (args) => {
        const result = await next(args);
        const providerResponse = toProviderResponse(result.response);
        if (providerResponse) {
            onObserved();
            await onResponse(providerResponse, model);
        }
        return result;
    };
    client.middlewareStack.add(middleware, { step: "deserialize", name: "pi-ai-response-headers" });
}
export const streamSimple`;
	patched = replaceRequired(patched, anchor, helper, "Bedrock response middleware");
	assertBedrockResponseHeadersSource(patched);
	return patched;
}

function patchBedrockToolResultImages(source) {
	if (source.includes(PI_BEDROCK_TOOL_RESULT_IMAGES_MARKER)) {
		assertBedrockToolResultImagesSource(source);
		return source;
	}
	let patched = replaceRequired(
		source,
		"function convertToolResultContent(content) {",
		"function convertToolResultContent(content, hoistImages = false) {",
		"Bedrock tool result converter signature",
	);
	patched = replaceRequired(
		patched,
		`        if (c.type === "image") {
            result.push({ image: createImageBlock(c.mimeType, c.data) });
        }`,
		`        if (c.type === "image") {
            if (!hoistImages)
                result.push({ image: createImageBlock(c.mimeType, c.data) });
        }`,
		"Bedrock nested tool result image filter",
	);
	patched = replaceRequired(
		patched,
		`    return result;
}
function convertMessages(context, model, cacheRetention, env) {`,
		`    return result;
}
${PATCHED_TOOL_RESULT_HELPERS}
function convertMessages(context, model, cacheRetention, env) {`,
		"Bedrock tool result image helpers",
	);
	patched = replaceRequired(
		patched,
		`                const toolResults = [];
                // Add current tool result with all content blocks combined`,
		`                const toolResults = [];
                const toolImages = [];
                const hoistImages = shouldHoistToolResultImages(model);
                // Add current tool result with all content blocks combined`,
		"Bedrock tool result image collections",
	);
	patched = replaceRequired(
		patched,
		"                        content: convertToolResultContent(m.content),",
		"                        content: convertToolResultContent(m.content, hoistImages),",
		"Bedrock current tool result conversion",
	);
	patched = replaceRequired(
		patched,
		`                });
                // Look ahead for consecutive toolResult messages`,
		`                });
                if (hoistImages)
                    toolImages.push(...convertToolResultImages(m.content));
                // Look ahead for consecutive toolResult messages`,
		"Bedrock current tool result image hoist",
	);
	patched = replaceRequired(
		patched,
		"                            content: convertToolResultContent(nextMsg.content),",
		"                            content: convertToolResultContent(nextMsg.content, hoistImages),",
		"Bedrock consecutive tool result conversion",
	);
	patched = replaceRequired(
		patched,
		`                    });
                    j++;`,
		`                    });
                    if (hoistImages)
                        toolImages.push(...convertToolResultImages(nextMsg.content));
                    j++;`,
		"Bedrock consecutive tool result image hoist",
	);
	patched = replaceRequired(
		patched,
		"                    content: toolResults,",
		"                    content: [...toolResults, ...toolImages],",
		"Bedrock user tool result image siblings",
	);
	assertBedrockToolResultImagesSource(patched);
	return patched;
}

export function patchPiBedrockForwardFixSource(source) {
	let patched = patchBedrockResponseHeaders(source);
	patched = patchBedrockToolResultImages(patched);
	assertPiBedrockForwardFixSource(patched);
	return patched;
}
