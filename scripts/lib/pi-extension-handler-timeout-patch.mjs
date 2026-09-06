/**
 * Bounded extension-handler execution for Pi 0.84.2.
 *
 * A handler that never settles currently blocks every later handler and can
 * prevent agent_settled, session persistence, and shutdown from running. This
 * patch gives each handler a cumulative 30 seconds of non-interactive work.
 * Documented Pi UI promises pause the remaining budget while the user is
 * actively deciding, so trust prompts, permission gates, editors, and custom
 * dialogs keep their supported unbounded interactive behavior. Parent abort
 * still settles the runner while a dialog is pending. OAuth login callbacks do
 * not run through the extension runner and are intentionally outside this
 * patch.
 *
 * JavaScript promises are not generally cancellable. On timeout, the patch
 * aborts a handler-scoped signal, invalidates only the expired handler's
 * context, and attaches an explicit late-rejection sink before continuing.
 * Timeout diagnostics keep the extension identity and event in the existing
 * structured ExtensionError fields; the error text and stack do not copy
 * prompts, event payloads, or filesystem paths into telemetry.
 *
 * Removal condition: adopt the first supported Pi release that bounds every
 * extension runner emit path, reports the extension and event on timeout,
 * absorbs late settlement, and preserves interactive UI/OAuth behavior.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export const PI_EXTENSION_HANDLER_TIMEOUT_REQUIRED_VERSION = "0.85.1";
export const PI_EXTENSION_HANDLER_TIMEOUT_TARGET =
	"dist/core/extensions/runner.js";
export const PI_EXTENSION_HANDLER_TIMEOUT_MARKER =
	"Feynman Pi 0.84.2 extension handler deadline #8662";

const ORIGINAL_CLASS_ANCHOR = "export class ExtensionRunner {";
const ORIGINAL_EVENT_AWAIT = "await handler(event, ctx)";
const ORIGINAL_CURRENT_EVENT_AWAIT = "await handler(currentEvent, ctx)";
const PATCHED_EVENT_AWAIT =
	"await runFeynmanExtensionHandler(handler, event, ctx)";
const PATCHED_CURRENT_EVENT_AWAIT =
	"await runFeynmanExtensionHandler(handler, currentEvent, ctx)";
const EXPECTED_EVENT_AWAIT_COUNT = 10;
const EXPECTED_CURRENT_EVENT_AWAIT_COUNT = 2;

const HANDLER_DEADLINE_HELPERS = `
// ${PI_EXTENSION_HANDLER_TIMEOUT_MARKER}
const FEYNMAN_PI_EXTENSION_HANDLER_TIMEOUT_MS = 30000;
// OAuth provider login callbacks run outside ExtensionRunner emit paths and
// retain their provider-owned interactive/authentication lifecycle.
const FEYNMAN_PI_INTERACTIVE_UI_METHODS = new Set([
    "select",
    "confirm",
    "input",
    "custom",
    "editor",
]);
class FeynmanExtensionHandlerTimeoutError extends Error {
    constructor() {
        super(\`Extension handler timed out after \${FEYNMAN_PI_EXTENSION_HANDLER_TIMEOUT_MS}ms\`);
        this.name = "FeynmanExtensionHandlerTimeoutError";
        // ExtensionRunner reports extensionPath and event separately. A
        // synthetic timeout stack would only expose local runtime paths.
        this.stack = undefined;
    }
}
function createFeynmanHandlerContext(context, lifecycle) {
    let wrappedUi;
    return new Proxy(context, {
        get(target, property) {
            lifecycle.assertActive();
            if (property === "ui") {
                if (!wrappedUi) {
                    const ui = Reflect.get(target, property, target);
                    wrappedUi = new Proxy(ui, {
                        get(uiTarget, uiProperty) {
                            lifecycle.assertActive();
                            const value = Reflect.get(uiTarget, uiProperty, uiTarget);
                            if (typeof value !== "function")
                                return value;
                            if (FEYNMAN_PI_INTERACTIVE_UI_METHODS.has(uiProperty)) {
                                return (...args) => {
                                    lifecycle.assertActive();
                                    lifecycle.enterInteractive();
                                    let pending;
                                    try {
                                        pending = Promise.resolve(value.apply(uiTarget, args));
                                    }
                                    catch (error) {
                                        lifecycle.exitInteractive();
                                        throw error;
                                    }
                                    return pending.finally(() => lifecycle.exitInteractive());
                                };
                            }
                            return (...args) => {
                                lifecycle.assertActive();
                                return value.apply(uiTarget, args);
                            };
                        },
                    });
                }
                return wrappedUi;
            }
            if (property === "signal")
                return lifecycle.signal;
            const value = Reflect.get(target, property, target);
            if (typeof value !== "function")
                return value;
            return (...args) => {
                lifecycle.assertActive();
                return value.apply(target, args);
            };
        },
    });
}
async function runFeynmanExtensionHandler(handler, event, context) {
    let deadline;
    let deadlineStartedAt;
    let remainingDeadlineMs = FEYNMAN_PI_EXTENSION_HANDLER_TIMEOUT_MS;
    let interactiveDepth = 0;
    let running = true;
    let timedOut = false;
    let parentAborted = false;
    let resolveInterruption;
    const deadlineController = new AbortController();
    const originalSignal = Reflect.get(context, "signal", context);
    const handlerSignal = originalSignal
        ? AbortSignal.any([originalSignal, deadlineController.signal])
        : deadlineController.signal;
    const clearDeadline = (consumeElapsed = false) => {
        if (deadline !== undefined) {
            clearTimeout(deadline);
            deadline = undefined;
        }
        if (consumeElapsed && deadlineStartedAt !== undefined) {
            remainingDeadlineMs = Math.max(
                0,
                remainingDeadlineMs - (Date.now() - deadlineStartedAt),
            );
        }
        deadlineStartedAt = undefined;
    };
    const settleTimeout = () => {
        if (!running || timedOut || parentAborted)
            return;
        deadline = undefined;
        deadlineStartedAt = undefined;
        remainingDeadlineMs = 0;
        timedOut = true;
        // Resolve the timeout outcome before aborting handler-owned work so an
        // abort-driven rejection cannot win the race and mask the deadline.
        resolveInterruption({ status: "timed-out" });
        deadlineController.abort();
    };
    const armDeadline = () => {
        clearDeadline(false);
        if (!running || timedOut || parentAborted || interactiveDepth > 0)
            return;
        if (remainingDeadlineMs <= 0) {
            settleTimeout();
            return;
        }
        deadlineStartedAt = Date.now();
        deadline = setTimeout(settleTimeout, remainingDeadlineMs);
    };
    const settleParentAbort = () => {
        if (!running || timedOut || parentAborted)
            return;
        parentAborted = true;
        clearDeadline(false);
        resolveInterruption({ status: "parent-aborted" });
    };
    const lifecycle = {
        signal: handlerSignal,
        assertActive() {
            if (timedOut) {
                throw new Error("Extension handler context expired after timeout");
            }
            if (parentAborted) {
                throw new Error("Extension handler context expired after abort");
            }
        },
        enterInteractive() {
            this.assertActive();
            if (interactiveDepth === 0)
                clearDeadline(true);
            interactiveDepth++;
        },
        exitInteractive() {
            if (interactiveDepth > 0)
                interactiveDepth--;
            if (interactiveDepth === 0)
                armDeadline();
        },
    };
    const interruptionPromise = new Promise((resolve) => {
        resolveInterruption = resolve;
        if (originalSignal) {
            if (originalSignal.aborted) {
                settleParentAbort();
            }
            else {
                originalSignal.addEventListener("abort", settleParentAbort, { once: true });
            }
        }
        armDeadline();
    });
    const guardedContext = createFeynmanHandlerContext(context, lifecycle);
    const handlerPromise = Promise.resolve().then(() => handler(event, guardedContext));
    // The handler cannot be forcibly cancelled. Consume a late rejection before
    // racing so it cannot surface as unhandled after the event has continued.
    handlerPromise.catch(() => {});
    const handlerOutcome = handlerPromise.then(
        (value) => ({ status: "fulfilled", value }),
        (error) => ({ status: "rejected", error }),
    );
    try {
        const outcome = await Promise.race([handlerOutcome, interruptionPromise]);
        if (outcome.status === "timed-out")
            throw new FeynmanExtensionHandlerTimeoutError();
        if (outcome.status === "parent-aborted")
            return undefined;
        if (outcome.status === "rejected")
            throw outcome.error;
        return outcome.value;
    }
    finally {
        running = false;
        clearDeadline(false);
        originalSignal?.removeEventListener("abort", settleParentAbort);
    }
}
`;

const ORIGINAL_BOUNDED_TOOL_CALL_METHOD = `    async emitToolCall(event) {
        const ctx = this.createContext();
        let result;
        for (const ext of this.extensions) {
            const handlers = ext.handlers.get("tool_call");
            if (!handlers || handlers.length === 0)
                continue;
            for (const handler of handlers) {
                const handlerResult = await runFeynmanExtensionHandler(handler, event, ctx);
                if (handlerResult) {
                    result = handlerResult;
                    if (result.block) {
                        return result;
                    }
                }
            }
        }
        return result;
    }`;

const PATCHED_TOOL_CALL_METHOD = `    async emitToolCall(event) {
        const ctx = this.createContext();
        let result;
        let deadlineBlocked = false;
        for (const ext of this.extensions) {
            const handlers = ext.handlers.get("tool_call");
            if (!handlers || handlers.length === 0)
                continue;
            for (const handler of handlers) {
                try {
                    const handlerResult = await runFeynmanExtensionHandler(handler, event, ctx);
                    if (handlerResult) {
                        result = handlerResult;
                        if (result.block) {
                            return result;
                        }
                    }
                }
                catch (err) {
                    // Preserve Pi's fail-closed behavior for ordinary tool_call
                    // exceptions. Only a handled deadline continues to later
                    // policy handlers, then blocks execution if none block first.
                    if (!(err instanceof FeynmanExtensionHandlerTimeoutError))
                        throw err;
                    deadlineBlocked = true;
                    this.emitError({
                        extensionPath: ext.path,
                        event: "tool_call",
                        error: err.message,
                        stack: undefined,
                    });
                }
            }
        }
        if (deadlineBlocked) {
            return {
                block: true,
                reason: "Extension handler timed out before tool execution",
            };
        }
        return result;
    }`;

const ORIGINAL_BOUNDED_USER_BASH_METHOD = `    async emitUserBash(event) {
        const ctx = this.createContext();
        for (const ext of this.extensions) {
            const handlers = ext.handlers.get("user_bash");
            if (!handlers || handlers.length === 0)
                continue;
            for (const handler of handlers) {
                try {
                    const handlerResult = await runFeynmanExtensionHandler(handler, event, ctx);
                    if (handlerResult) {
                        return handlerResult;
                    }
                }
                catch (err) {
                    const message = err instanceof Error ? err.message : String(err);
                    const stack = err instanceof Error ? err.stack : undefined;
                    this.emitError({
                        extensionPath: ext.path,
                        event: "user_bash",
                        error: message,
                        stack,
                    });
                }
            }
        }
        return undefined;
    }`;

const PATCHED_USER_BASH_METHOD = `    async emitUserBash(event) {
        const ctx = this.createContext();
        let deadlineBlocked = false;
        for (const ext of this.extensions) {
            const handlers = ext.handlers.get("user_bash");
            if (!handlers || handlers.length === 0)
                continue;
            for (const handler of handlers) {
                try {
                    const handlerResult = await runFeynmanExtensionHandler(handler, event, ctx);
                    if (handlerResult && !deadlineBlocked) {
                        return handlerResult;
                    }
                }
                catch (err) {
                    const message = err instanceof Error ? err.message : String(err);
                    const stack = err instanceof Error ? err.stack : undefined;
                    if (err instanceof FeynmanExtensionHandlerTimeoutError)
                        deadlineBlocked = true;
                    this.emitError({
                        extensionPath: ext.path,
                        event: "user_bash",
                        error: message,
                        stack,
                    });
                }
            }
        }
        if (deadlineBlocked) {
            return {
                result: {
                    output: "Bash command blocked because an extension policy handler timed out before execution.\\n",
                    exitCode: 126,
                    cancelled: false,
                    truncated: false,
                },
            };
        }
        return undefined;
    }`;

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
		throw new Error(
			"Unsupported Pi 0.84.2 extension runner source map layout",
		);
	}
	return source.slice(0, first).replace(/\r?\n$/, "");
}

export function assertPiExtensionHandlerTimeoutVersion(
	version,
	surface = "Pi extension runner",
) {
	if (version !== PI_EXTENSION_HANDLER_TIMEOUT_REQUIRED_VERSION) {
		throw new Error(
			`${surface} timeout patch requires Pi ${PI_EXTENSION_HANDLER_TIMEOUT_REQUIRED_VERSION}, found ${version ?? "missing"}`,
		);
	}
}

export function assertPiExtensionHandlerTimeoutPatchSource(
	source,
	surface = "Pi extension runner",
) {
	for (const fragment of [
		PI_EXTENSION_HANDLER_TIMEOUT_MARKER,
		"const FEYNMAN_PI_EXTENSION_HANDLER_TIMEOUT_MS = 30000;",
		"OAuth provider login callbacks run outside ExtensionRunner emit paths",
		"const FEYNMAN_PI_INTERACTIVE_UI_METHODS = new Set([",
		'"select",\n    "confirm",\n    "input",\n    "custom",\n    "editor",',
		"class FeynmanExtensionHandlerTimeoutError extends Error {",
		"function createFeynmanHandlerContext(context, lifecycle) {",
		"function runFeynmanExtensionHandler(handler, event, context) {",
		"let remainingDeadlineMs = FEYNMAN_PI_EXTENSION_HANDLER_TIMEOUT_MS;",
		"remainingDeadlineMs - (Date.now() - deadlineStartedAt)",
		"const deadlineController = new AbortController();",
		"AbortSignal.any([originalSignal, deadlineController.signal])",
		'resolveInterruption({ status: "timed-out" });',
		'resolveInterruption({ status: "parent-aborted" });',
		"deadlineController.abort();",
		"timedOut = true;",
		"parentAborted = true;",
		'originalSignal.addEventListener("abort", settleParentAbort, { once: true });',
		'originalSignal?.removeEventListener("abort", settleParentAbort);',
		"handlerPromise.catch(() => {});",
		"const outcome = await Promise.race([handlerOutcome, interruptionPromise]);",
		"Extension handler context expired after timeout",
		"Extension handler context expired after abort",
		"let deadlineBlocked = false;",
		'reason: "Extension handler timed out before tool execution"',
		"Bash command blocked because an extension policy handler timed out before execution.",
		"exitCode: 126,",
	]) {
		if (!source.includes(fragment)) {
			throw new Error(`Incomplete ${surface} patch: missing ${fragment}`);
		}
	}
	if (countOccurrences(source, HANDLER_DEADLINE_HELPERS) !== 1) {
		throw new Error(
			`Incomplete ${surface} patch: missing exact handler deadline helper`,
		);
	}
	if (countOccurrences(source, PATCHED_TOOL_CALL_METHOD) !== 1) {
		throw new Error(
			`Incomplete ${surface} patch: missing deadline-safe tool_call path`,
		);
	}
	if (countOccurrences(source, PATCHED_USER_BASH_METHOD) !== 1) {
		throw new Error(
			`Incomplete ${surface} patch: missing deadline-safe user_bash path`,
		);
	}
	if (
		countOccurrences(source, PATCHED_EVENT_AWAIT) !==
		EXPECTED_EVENT_AWAIT_COUNT
	) {
		throw new Error(
			`Incomplete ${surface} patch: expected ${EXPECTED_EVENT_AWAIT_COUNT} bounded event awaits`,
		);
	}
	if (
		countOccurrences(source, PATCHED_CURRENT_EVENT_AWAIT) !==
		EXPECTED_CURRENT_EVENT_AWAIT_COUNT
	) {
		throw new Error(
			`Incomplete ${surface} patch: expected ${EXPECTED_CURRENT_EVENT_AWAIT_COUNT} bounded current-event awaits`,
		);
	}
	if (
		source.includes(ORIGINAL_EVENT_AWAIT) ||
		source.includes(ORIGINAL_CURRENT_EVENT_AWAIT)
	) {
		throw new Error(
			`Incomplete ${surface} patch: retained an unbounded handler await`,
		);
	}
	if (source.includes("//# sourceMappingURL=")) {
		throw new Error(
			`Incomplete ${surface} patch: retained stale source map directive`,
		);
	}
}

export function patchPiExtensionHandlerTimeoutSource(source, version) {
	assertPiExtensionHandlerTimeoutVersion(version);

	if (source.includes(PI_EXTENSION_HANDLER_TIMEOUT_MARKER)) {
		assertPiExtensionHandlerTimeoutPatchSource(source);
		return source;
	}
	if (countOccurrences(source, ORIGINAL_CLASS_ANCHOR) !== 1) {
		throw new Error(
			"Unsupported Pi 0.84.2 extension runner class layout",
		);
	}
	if (
		countOccurrences(source, ORIGINAL_EVENT_AWAIT) !==
		EXPECTED_EVENT_AWAIT_COUNT
	) {
		throw new Error(
			`Unsupported Pi 0.84.2 extension runner event-await layout`,
		);
	}
	if (
		countOccurrences(source, ORIGINAL_CURRENT_EVENT_AWAIT) !==
		EXPECTED_CURRENT_EVENT_AWAIT_COUNT
	) {
		throw new Error(
			`Unsupported Pi 0.84.2 extension runner current-event-await layout`,
		);
	}

	let patched = source.replace(
		ORIGINAL_CLASS_ANCHOR,
		`${HANDLER_DEADLINE_HELPERS}\n${ORIGINAL_CLASS_ANCHOR}`,
	);
	patched = patched
		.split(ORIGINAL_CURRENT_EVENT_AWAIT)
		.join(PATCHED_CURRENT_EVENT_AWAIT);
	patched = patched
		.split(ORIGINAL_EVENT_AWAIT)
		.join(PATCHED_EVENT_AWAIT);
	if (countOccurrences(patched, ORIGINAL_BOUNDED_TOOL_CALL_METHOD) !== 1) {
		throw new Error(
			"Unsupported Pi 0.84.2 bounded tool_call layout",
		);
	}
	patched = patched.replace(
		ORIGINAL_BOUNDED_TOOL_CALL_METHOD,
		PATCHED_TOOL_CALL_METHOD,
	);
	if (countOccurrences(patched, ORIGINAL_BOUNDED_USER_BASH_METHOD) !== 1) {
		throw new Error(
			"Unsupported Pi 0.84.2 bounded user_bash layout",
		);
	}
	patched = patched.replace(
		ORIGINAL_BOUNDED_USER_BASH_METHOD,
		PATCHED_USER_BASH_METHOD,
	);
	patched = stripStaleSourceMapDirective(patched);
	assertPiExtensionHandlerTimeoutPatchSource(patched);
	return patched;
}

export function patchPiExtensionHandlerTimeoutPackageRoot(
	packageRoot,
	surface = packageRoot,
) {
	const manifestPath = resolve(packageRoot, "package.json");
	if (!existsSync(manifestPath)) return false;
	const version = JSON.parse(readFileSync(manifestPath, "utf8")).version;
	assertPiExtensionHandlerTimeoutVersion(version, surface);
	const entryPath = resolve(
		packageRoot,
		...PI_EXTENSION_HANDLER_TIMEOUT_TARGET.split("/"),
	);
	if (!existsSync(entryPath)) {
		throw new Error(`Pi extension handler timeout target is missing: ${entryPath}`);
	}
	const source = readFileSync(entryPath, "utf8");
	const patched = patchPiExtensionHandlerTimeoutSource(source, version);
	if (patched === source) return false;
	writeFileSync(entryPath, patched, "utf8");
	return true;
}
