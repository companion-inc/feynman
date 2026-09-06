/**
 * Feynman patches for Pi AgentCore 0.84.2.
 *
 * The provider-stream watchdog is disabled by default because local and private
 * models can legitimately remain silent during long prefills. Users can opt in
 * with FEYNMAN_PI_STREAM_EVENT_IDLE_TIMEOUT_MS. Zero disables the watchdog.
 *
 * This deliberately ports only the research-session continuity fix from issue
 * #8331 / closed PR #8593, not its enabled default or adjacent coding-agent UI.
 * It also ports only the post-turn abort guard from closed upstream PR #8658
 * (head daad15954920894581c59ced4cae7c295f755e45), adapted to Pi 0.84.2's
 * optional AbortSignal.
 *
 * Removal condition: adopt a released Pi watchdog that is safe for silent local
 * prefills and settles without awaiting a non-cooperative provider iterator,
 * and which preserves queued steering/follow-up input after a tool-time abort.
 */

const PI_AGENT_CORE_PATCH_REQUIRED_VERSION = "0.84.2";
const ABORT_QUEUE_GUARD_MARKER =
	`Feynman Pi ${PI_AGENT_CORE_PATCH_REQUIRED_VERSION} forward patch: preserve queued input on abort #8658`;

export const PI_AGENT_CORE_PATCH_MARKERS = Object.freeze({
	toolAliases: "function normalizeFeynmanToolAlias(",
	streamWatchdog: "Feynman Pi 0.84.2 forward patch: provider stream watchdog #8331",
});

const HELPER = `
function normalizeFeynmanSearchToolArguments(args) {
    if (!args || typeof args !== "object" || Array.isArray(args)) {
        return args;
    }
    const normalized = { ...args };
    if (Array.isArray(normalized.queries) || typeof normalized.query === "string") {
        return normalized;
    }
    if (Array.isArray(normalized.q)) {
        normalized.queries = normalized.q;
        delete normalized.q;
        return normalized;
    }
    if (typeof normalized.q === "string") {
        normalized.query = normalized.q;
        delete normalized.q;
    }
    return normalized;
}

function normalizeFeynmanFetchToolArguments(args) {
    if (!args || typeof args !== "object" || Array.isArray(args)) {
        return args;
    }
    const normalized = { ...args };
    if (Array.isArray(normalized.urls) || typeof normalized.url === "string") {
        return normalized;
    }
    if (Array.isArray(normalized.url)) {
        normalized.urls = normalized.url;
        delete normalized.url;
    }
    return normalized;
}

function normalizeFeynmanToolAlias(toolCall, tools) {
    const aliases = new Map([
        ["google:search", "web_search"],
        ["google_search", "web_search"],
        ["google.search", "web_search"],
        ["search_google", "web_search"],
        ["search_web", "web_search"],
        ["WebSearch", "web_search"],
        ["fetch", "fetch_content"],
        ["WebFetch", "fetch_content"],
        ["read_url_content", "fetch_content"],
    ]);
    const targetName = aliases.get(toolCall.name);
    if (!targetName || !tools?.some((tool) => tool.name === targetName)) {
        return toolCall;
    }
    const args = targetName === "fetch_content"
        ? normalizeFeynmanFetchToolArguments(toolCall.arguments)
        : normalizeFeynmanSearchToolArguments(toolCall.arguments);
    return {
        ...toolCall,
        name: targetName,
        arguments: args,
    };
}
`;

const WATCHDOG_HELPERS = `
// ${PI_AGENT_CORE_PATCH_MARKERS.streamWatchdog}
const FEYNMAN_MAX_STREAM_EVENT_IDLE_TIMEOUT_MS = 2147483647;
const FEYNMAN_EMPTY_USAGE = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};
function parseFeynmanStreamIdleTimeoutMs(value, surface) {
    if (value === undefined || value === null)
        return undefined;
    if (typeof value === "string" && value.trim() === "")
        return undefined;
    const parsed = typeof value === "number" ? value : Number(value);
    if (!Number.isInteger(parsed) ||
        parsed < 0 ||
        parsed > FEYNMAN_MAX_STREAM_EVENT_IDLE_TIMEOUT_MS) {
        throw new Error(\`Invalid \${surface}: expected an integer from 0 to \${FEYNMAN_MAX_STREAM_EVENT_IDLE_TIMEOUT_MS}\`);
    }
    return parsed;
}
function resolveFeynmanStreamIdleTimeoutMs(config) {
    const configured = parseFeynmanStreamIdleTimeoutMs(config?.streamIdleTimeoutMs, "streamIdleTimeoutMs");
    if (configured !== undefined)
        return configured;
    const rawOverride = typeof process !== "undefined"
        ? process.env?.FEYNMAN_PI_STREAM_EVENT_IDLE_TIMEOUT_MS
        : undefined;
    return parseFeynmanStreamIdleTimeoutMs(
        rawOverride,
        "FEYNMAN_PI_STREAM_EVENT_IDLE_TIMEOUT_MS",
    ) ?? 0;
}
function sanitizeFeynmanPartialMessage(message) {
    return {
        ...message,
        content: message.content.map((block) => {
            const sanitized = { ...block };
            delete sanitized.index;
            delete sanitized.partialJson;
            delete sanitized.partialArgs;
            delete sanitized.customInput;
            delete sanitized.streamIndex;
            return sanitized;
        }),
    };
}
`;

const ORIGINAL_STREAM_LOOP_START = `    let partialMessage = null;
    let addedPartial = false;
    for await (const event of response) {`;

const PATCHED_STREAM_NEXT_SEQUENCE = `        const next = iterator.next();
        // A timeout or caller abort cannot cancel every provider iterator. Attach a
        // rejection handler before racing so a late provider failure is not reported
        // as an unhandled rejection after this turn has already settled.
        next.catch(() => {});
        const pending = [next];`;

const LEGACY_STREAM_NEXT_SEQUENCES = Object.freeze([
	"        const pending = [iterator.next()];",
	`        const next = iterator.next();
        const pending = [next];`,
	PATCHED_STREAM_NEXT_SEQUENCE.replace("        next.catch(() => {});\n", ""),
]);

const PATCHED_STREAM_TIMEOUT_CONFIG =
	'    const configured = parseFeynmanStreamIdleTimeoutMs(config?.streamIdleTimeoutMs, "streamIdleTimeoutMs");';
const LEGACY_STREAM_TIMEOUT_CONFIG =
	'    const configured = parseFeynmanStreamIdleTimeoutMs(config.streamIdleTimeoutMs, "streamIdleTimeoutMs");';

const ORIGINAL_POST_TURN_SEQUENCE = `            await emit({ type: "turn_end", message, toolResults });
            const nextTurnContext = {`;

const PATCHED_POST_TURN_SEQUENCE = `            await emit({ type: "turn_end", message, toolResults });
            // ${ABORT_QUEUE_GUARD_MARKER}
            // Stop before prepareNextTurn or either queue callback. The owning
            // Agent/session can then restore the untouched queued input.
            if (signal?.aborted) {
                await emit({ type: "agent_end", messages: newMessages });
                return;
            }
            const nextTurnContext = {`;
// 0.85.1 moved prepareNextTurn to the next iteration; the abort guard must
// still precede shouldStopAfterTurn and either destructive queue callback.
const CURRENT_POST_TURN_SEQUENCE = ORIGINAL_POST_TURN_SEQUENCE.replace(
	"const nextTurnContext =", "lastCompletedTurn =",
);
const CURRENT_PATCHED_POST_TURN_SEQUENCE = PATCHED_POST_TURN_SEQUENCE.replace(
	"const nextTurnContext =", "lastCompletedTurn =",
);

const PATCHED_STREAM_LOOP = `    let partialMessage = null;
    let addedPartial = false;
    const iterator = response[Symbol.asyncIterator]();
    while (true) {
        let idleTimer;
        let abortListener;
${PATCHED_STREAM_NEXT_SEQUENCE}
        if (idleTimeoutMs > 0) {
            pending.push(new Promise((resolve) => {
                idleTimer = setTimeout(() => resolve("feynman-idle"), idleTimeoutMs);
                idleTimer.unref?.();
            }));
        }
        if (signal && !signal.aborted) {
            pending.push(new Promise((resolve) => {
                abortListener = () => resolve("feynman-aborted");
                signal.addEventListener("abort", abortListener, { once: true });
            }));
        }
        const settled = signal?.aborted
            ? "feynman-aborted"
            : await Promise.race(pending);
        if (idleTimer !== undefined)
            clearTimeout(idleTimer);
        if (abortListener)
            signal?.removeEventListener("abort", abortListener);
        if (settled === "feynman-idle" || settled === "feynman-aborted") {
            const aborted = settled === "feynman-aborted" || signal?.aborted === true;
            const errorMessage = aborted
                ? undefined
                : \`Provider stream event timeout after \${idleTimeoutMs}ms without a Pi event\`;
            const finalMessage = partialMessage
                ? {
                    ...sanitizeFeynmanPartialMessage(partialMessage),
                    stopReason: aborted ? "aborted" : "error",
                    errorMessage,
                }
                : {
                    role: "assistant",
                    content: [{ type: "text", text: "" }],
                    api: config.model.api,
                    provider: config.model.provider,
                    model: config.model.id,
                    usage: FEYNMAN_EMPTY_USAGE,
                    stopReason: aborted ? "aborted" : "error",
                    errorMessage,
                    timestamp: Date.now(),
                };
            response.end(finalMessage);
            watchdogController.abort();
            try {
                // Provider iterators can ignore abort and leave return() pending behind
                // the same silent network read. Cleanup is best-effort; the watchdog
                // must still settle the Pi turn immediately.
                Promise.resolve(iterator.return?.()).catch(() => {});
            }
            catch {
                // Some provider iterators do not implement cooperative return.
            }
            if (addedPartial) {
                context.messages[context.messages.length - 1] = finalMessage;
            }
            else {
                context.messages.push(finalMessage);
                await emit({ type: "message_start", message: { ...finalMessage } });
            }
            await emit({ type: "message_end", message: finalMessage });
            return finalMessage;
        }
        if (settled.done)
            break;
        const event = settled.value;`;

function countOccurrences(source, fragment) {
	return source.split(fragment).length - 1;
}

function stripStaleSourceMapDirective(source) {
	const marker = "//# sourceMappingURL=";
	const first = source.indexOf(marker);
	if (first === -1) {
		return source;
	}
	if (
		source.indexOf(marker, first + marker.length) !== -1 ||
		!/^\/\/# sourceMappingURL=[^\r\n]*[\r\n]*$/.test(source.slice(first))
	) {
		throw new Error("Unsupported Pi 0.84.2 AgentCore source map layout");
	}
	return source.slice(0, first).replace(/\r?\n$/, "");
}

export function assertPiAgentCorePatchSource(source, surface = "Pi AgentCore") {
	for (const fragment of [
		PI_AGENT_CORE_PATCH_MARKERS.toolAliases,
		PI_AGENT_CORE_PATCH_MARKERS.streamWatchdog,
		'["search_web", "web_search"]',
		"prepareToolCallArguments(tool, effectiveToolCall)",
		"resolveFeynmanStreamIdleTimeoutMs(",
		"FEYNMAN_PI_STREAM_EVENT_IDLE_TIMEOUT_MS",
		"FEYNMAN_MAX_STREAM_EVENT_IDLE_TIMEOUT_MS",
		"AbortSignal.any([signal, watchdogController.signal])",
		"signal: providerSignal",
		"response[Symbol.asyncIterator]()",
		PATCHED_STREAM_TIMEOUT_CONFIG,
		'settled === "feynman-idle"',
		"response.end(finalMessage)",
		"watchdogController.abort()",
		"Promise.resolve(iterator.return?.()).catch(() => {})",
		"Provider stream event timeout after",
		"sanitizeFeynmanPartialMessage(partialMessage)",
	]) {
		if (!source.includes(fragment)) {
			throw new Error(`Incomplete ${surface} patch: missing ${fragment}`);
		}
	}
	if (source.split(PATCHED_STREAM_NEXT_SEQUENCE).length - 1 !== 1) {
		throw new Error(
			`Incomplete ${surface} patch: missing exact provider iterator next/catch/pending sequence`,
		);
	}
	if (source.includes("for await (const event of response)")) {
		throw new Error(`Incomplete ${surface} patch: retained unbounded provider stream loop`);
	}
	if (source.includes("//# sourceMappingURL=")) {
		throw new Error(`Incomplete ${surface} patch: retained stale source map directive`);
	}
	const hasAgentLoopSurface =
		source.includes("function createAgentStream()") ||
		source.includes("async function runLoop(") ||
		source.includes(ABORT_QUEUE_GUARD_MARKER);
	if (hasAgentLoopSurface) {
		if (countOccurrences(source, PATCHED_POST_TURN_SEQUENCE) +
			countOccurrences(source, CURRENT_PATCHED_POST_TURN_SEQUENCE) !== 1) {
			throw new Error(
				`Incomplete ${surface} patch: missing exact post-turn abort queue guard`,
			);
		}
		if (source.includes(ORIGINAL_POST_TURN_SEQUENCE) || source.includes(CURRENT_POST_TURN_SEQUENCE)) {
			throw new Error(
				`Incomplete ${surface} patch: retained unguarded post-turn queue path`,
			);
		}
	}
}

function patchToolAliases(source) {
	if (source.includes(PI_AGENT_CORE_PATCH_MARKERS.toolAliases)) {
		return source;
	}
	const prepareStart = "async function prepareToolCall(currentContext, assistantMessage, toolCall, config, signal) {\n";
	if (!source.includes(prepareStart)) {
		throw new Error("Unsupported Pi 0.84.2 AgentCore tool-alias layout");
	}
	let patched = source.replace(prepareStart, `${HELPER}\n${prepareStart}`);
	patched = patched.replace(
		"async function prepareToolCall(currentContext, assistantMessage, toolCall, config, signal) {\n    const tool = currentContext.tools?.find((t) => t.name === toolCall.name);",
		"async function prepareToolCall(currentContext, assistantMessage, toolCall, config, signal) {\n    const effectiveToolCall = normalizeFeynmanToolAlias(toolCall, currentContext.tools);\n    const tool = currentContext.tools?.find((t) => t.name === effectiveToolCall.name);",
	);
	patched = patched.replace(
		"        const preparedToolCall = prepareToolCallArguments(tool, toolCall);",
		"        const preparedToolCall = prepareToolCallArguments(tool, effectiveToolCall);",
	);
	patched = patched.replace(
		"                toolCall,\n                args: validatedArgs,",
		"                toolCall: preparedToolCall,\n                args: validatedArgs,",
	);
	patched = patched.replace(
		"            toolCall,\n            tool,",
		"            toolCall: preparedToolCall,\n            tool,",
	);
	return patched;
}

function patchStreamWatchdog(source) {
	if (source.includes(PI_AGENT_CORE_PATCH_MARKERS.streamWatchdog)) {
		let upgraded = source.replace(LEGACY_STREAM_TIMEOUT_CONFIG, PATCHED_STREAM_TIMEOUT_CONFIG);
		if (!upgraded.includes(PATCHED_STREAM_NEXT_SEQUENCE) && !upgraded.includes("next.catch")) {
			for (const legacySequence of LEGACY_STREAM_NEXT_SEQUENCES) {
				if (upgraded.includes(legacySequence)) {
					upgraded = upgraded.replace(legacySequence, PATCHED_STREAM_NEXT_SEQUENCE);
					break;
				}
			}
		}
		const legacyReturn = `            try {
                await iterator.return?.();
            }
            catch {
                // Some provider iterators do not implement cooperative return.
            }`;
		if (upgraded.includes(legacyReturn)) {
			upgraded = upgraded.replace(
				legacyReturn,
				`            try {
                // Provider iterators can ignore abort and leave return() pending behind
                // the same silent network read. Cleanup is best-effort; the watchdog
                // must still settle the Pi turn immediately.
                Promise.resolve(iterator.return?.()).catch(() => {});
            }
            catch {
                // Some provider iterators do not implement cooperative return.
            }`,
			);
		}
		return upgraded;
	}
	let patched = source.replace(
		"async function streamAssistantResponse(context, config, signal, emit, streamFunction) {\n",
		`${WATCHDOG_HELPERS}\nasync function streamAssistantResponse(context, config, signal, emit, streamFunction) {\n`,
	);
	if (patched === source) {
		throw new Error("Unsupported Pi 0.84.2 AgentCore stream helper layout");
	}
	patched = patched.replace(
		`    const response = await streamFunction(config.model, llmContext, {
        ...config,
        apiKey: resolvedApiKey,
        signal,
    });`,
		`    const idleTimeoutMs = resolveFeynmanStreamIdleTimeoutMs(config);
    const watchdogController = new AbortController();
    const providerSignal = signal
        ? AbortSignal.any([signal, watchdogController.signal])
        : watchdogController.signal;
    const response = await streamFunction(config.model, llmContext, {
        ...config,
        apiKey: resolvedApiKey,
        signal: providerSignal,
    });`,
	);
	if (!patched.includes("signal: providerSignal")) {
		throw new Error("Unsupported Pi 0.84.2 AgentCore provider signal layout");
	}
	const startIndex = patched.indexOf(ORIGINAL_STREAM_LOOP_START);
	const suffixAnchor = "    const finalMessage = await response.result();\n    if (addedPartial) {";
	const endIndex = patched.indexOf(suffixAnchor, startIndex);
	if (startIndex === -1 || endIndex === -1) {
		throw new Error("Unsupported Pi 0.84.2 AgentCore provider stream loop layout");
	}
	const originalBodyStart = startIndex + ORIGINAL_STREAM_LOOP_START.length;
	patched = patched.slice(0, startIndex) +
		PATCHED_STREAM_LOOP +
		patched.slice(originalBodyStart, endIndex) +
		patched.slice(endIndex);
	return patched;
}

function patchAbortQueueGuard(source) {
	// Unit fixtures that exercise only the stream/tool transforms intentionally
	// omit runLoop. Real Pi AgentCore sources must match the exact 0.84.2 layout.
	const hasAgentLoopSurface =
		source.includes("function createAgentStream()") ||
		source.includes("async function runLoop(") ||
		source.includes(ABORT_QUEUE_GUARD_MARKER);
	if (!hasAgentLoopSurface) {
		return source;
	}
	if (source.includes(ABORT_QUEUE_GUARD_MARKER)) {
		return source;
	}
	if (countOccurrences(source, CURRENT_POST_TURN_SEQUENCE) === 1) {
		return source.replace(CURRENT_POST_TURN_SEQUENCE, CURRENT_PATCHED_POST_TURN_SEQUENCE);
	}
	const occurrences = countOccurrences(source, ORIGINAL_POST_TURN_SEQUENCE);
	if (occurrences !== 1) {
		throw new Error(
			`Unsupported Pi ${PI_AGENT_CORE_PATCH_REQUIRED_VERSION} AgentCore abort queue layout; expected 1 occurrence, found ${occurrences}`,
		);
	}
	return source.replace(ORIGINAL_POST_TURN_SEQUENCE, PATCHED_POST_TURN_SEQUENCE);
}

export function patchPiAgentCoreSource(source) {
	let patched = stripStaleSourceMapDirective(source);
	patched = patchToolAliases(patched);
	patched = patchStreamWatchdog(patched);
	patched = patchAbortQueueGuard(patched);
	assertPiAgentCorePatchSource(patched);
	return patched;
}
