/**
 * Temporary Pi 0.84.2 correctness patches for:
 * Pi issues #7053, #8121, #8166, #8581 (https://github.com/earendil-works/pi).
 *
 * Removal condition: delete this patch once a supported released Pi version
 * eagerly persists finalized parallel tool results while restoring them in
 * tool-call order, includes upstream commits d5278ea and 086c32e, and clears
 * delivered image-only queue entries as in commit b67b3db. It also defers
 * triggerTurn-false custom messages as in commits 7b1dcfd and 240eb29c.
 *
 * The coding-agent forward fixes port commits 8c16a558 (bounded large-tool
 * rendering), 6d05adb (quota-free GitHub release lookup), 27115254
 * (interleaved user content), and 86c42324 (EXIF after XMP). Remove each only
 * after the supported released Pi version contains its corresponding commit and
 * the executable regressions below continue to pass without the patch.
 * The SessionManager patch also ports commit 0b5ee5d8 so resuming a valid
 * unterminated JSONL session cannot fuse the next appended research entry.
 */
import { isCurrentCopilotOAuthSource, normalizeCurrentDeferredCustomMessages, patchCurrentToolReleaseRedirect, patchCurrentDeviceCodeExport, patchDeferredRunGuard, assertDeferredRunGuard } from "./pi-runtime-correctness-current.mjs";
import {
	assertPiInterleavedUserContentSource,
	PI_INTERLEAVED_USER_CONTENT_MARKER,
	patchPiInterleavedUserContentSource,
} from "./pi-interleaved-user-content-patch.mjs";
import {
	assertPiSessionTailPatchedSource,
	PI_SESSION_TAIL_PATCH_MARKER,
	patchPiSessionTailSource,
} from "./pi-session-tail-patch.mjs";

export const PI_RUNTIME_CORRECTNESS_PATCH_TARGETS = Object.freeze({
	codingAgent: Object.freeze([
		"dist/core/agent-session.js",
		"dist/core/session-manager.js",
	]),
	piAi: Object.freeze([
		"dist/api/transform-messages.js",
		"dist/auth/oauth/device-code.js",
		"dist/auth/oauth/github-copilot.js",
	]),
});
export const PI_RUNTIME_CORRECTNESS_REQUIRED_VERSION = "0.85.1";
export const PI_CODING_AGENT_FORWARD_FIX_TARGETS = Object.freeze([
	"dist/modes/interactive/components/tool-execution.js",
	"dist/utils/tools-manager.js",
	"dist/utils/exif-orientation.js",
]);
export const PI_CODING_AGENT_FORWARD_FIX_MARKERS = Object.freeze({
	largeToolRender: "Feynman Pi 0.84.2 forward patch: large tool render #8036",
	toolReleaseRedirect: "Feynman Pi 0.84.2 forward patch: GitHub release redirect #8594",
	exifAfterXmp: "Feynman Pi 0.84.2 forward patch: EXIF after XMP #8616",
});
const PATCHED_EXIF_AFTER_XMP_BLOCK = `            // ${PI_CODING_AGENT_FORWARD_FIX_MARKERS.exifAfterXmp}
            // APP1 may contain XMP before a later EXIF segment.
            if (hasExifHeader(bytes, segmentStart))
                return segmentStart + 6;`;
export const PI_RUNTIME_CORRECTNESS_PATCH_MARKERS = Object.freeze({
	agentSession: "Feynman Pi 0.84.2 correctness patch: issue #7053",
	sessionManager: "Feynman Pi 0.84.2 correctness patch: restore eager tool results",
	sessionTailRepair: PI_SESSION_TAIL_PATCH_MARKER,
	transformMessages: "Feynman Pi 0.84.2 correctness patch: order eager tool results",
	githubCopilotDeviceCode: "Feynman Pi 0.84.2 correctness patch: export abortableSleep for upstream #8121",
	githubCopilotOAuth: "Feynman Pi 0.84.2 correctness patch: upstream #8121",
	imageQueue: "Feynman Pi 0.84.2 correctness patch: image-only queue delivery #8581",
	turnEndMessages: "Feynman Pi 0.84.2 correctness patch: defer custom messages #8166",
	interleavedUserContent: PI_INTERLEAVED_USER_CONTENT_MARKER,
});

function stripStaleSourceMapDirective(source, surface) {
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
			`Unsupported Pi ${PI_RUNTIME_CORRECTNESS_REQUIRED_VERSION} ${surface} source map layout`,
		);
	}
	return source.slice(0, first).replace(/\r?\n$/, "");
}
export const PI_RUNTIME_CORRECTNESS_REQUIRED_FRAGMENTS = Object.freeze({
	agentSession: Object.freeze([
		PI_RUNTIME_CORRECTNESS_PATCH_MARKERS.agentSession,
		PI_RUNTIME_CORRECTNESS_PATCH_MARKERS.imageQueue,
		PI_RUNTIME_CORRECTNESS_PATCH_MARKERS.turnEndMessages,
		PI_RUNTIME_CORRECTNESS_PATCH_MARKERS.interleavedUserContent,
		"const steeringIndex = this._steeringMessages.indexOf(messageText);",
		"const followUpIndex = this._followUpMessages.indexOf(messageText);",
		"_pendingNextTurnMessages = [];\n    _pendingTurnEndMessages = [];",
		"_flushPendingTurnEndMessages() {",
		"const messages = this._pendingTurnEndMessages.splice(0);",
		"this._flushPendingTurnEndMessages();",
		"this._pendingTurnEndMessages.push(appMessage);",
		"async _prompt(text, options, orderedContent)",
		"currentImages = inputResult.images ?? currentImages;\n                    orderedContent = undefined;",
		"if (expandedText !== currentText)",
		"this._createUserContent(expandedText, currentImages, orderedContent)",
		"async _queueSteer(text, images, orderedContent)",
		"async _queueFollowUp(text, images, orderedContent)",
		"    _createUserContent(text, images, orderedContent)",
		'const orderedContent = typeof content === "string" ? undefined : [...content];',
		"await this._prompt(text, options);",
		"if (this._isAgentRunActive) {",
		'const feynmanToolResultIdBeforeExtensions = event.type === "message_end" && event.message.role === "toolResult"',
		"const entryId = this.sessionManager.appendMessage(toolResult);",
		"this._feynmanEagerlyPersistedToolResults.set(event.toolCallId, {",
		"await this._emitExtensionEvent(event);",
		"event.message.toolCallId = feynmanToolResultIdBeforeExtensions;",
		"const eagerToolCallId = feynmanToolResultIdBeforeExtensions ?? event.message.toolCallId;",
		"this.sessionManager.replaceMessage(eagerlyPersisted.entryId, event.message);",
	]),
	sessionManager: Object.freeze([
		PI_RUNTIME_CORRECTNESS_PATCH_MARKERS.sessionManager,
		PI_RUNTIME_CORRECTNESS_PATCH_MARKERS.sessionTailRepair,
		'let pending = "";',
		'if (pending) appendFileSync(resolvedFilePath, "\\n");',
		"function restoreFeynmanToolResultsInSourceOrder(messages) {",
		"activeBatch.results.set(message.toolCallId, message);",
		"restored.push(toolResult);",
		"replaceMessage(entryId, message) {",
		`this.byId.set(entryId, replacement);
        this._rewriteFile();`,
		"const messages = restoreFeynmanToolResultsInSourceOrder(buildContextEntries(entries, leafId, byId).flatMap(sessionEntryToContextMessages));",
	]),
	transformMessages: Object.freeze([
		PI_RUNTIME_CORRECTNESS_PATCH_MARKERS.transformMessages,
		"let pendingToolResults = new Map();",
		"const flushFeynmanToolResults = () => {",
		"const toolResult = pendingToolResults.get(toolCall.id);",
		"result.push(toolResult ?? {",
		"pendingToolResults.set(msg.toolCallId, msg);",
		`if (msg.role === "assistant") {
            flushFeynmanToolResults();`,
		`else if (msg.role === "user") {
            flushFeynmanToolResults();`,
		`    }
    flushFeynmanToolResults();
`,
	]),
	githubCopilotDeviceCode: Object.freeze([
		PI_RUNTIME_CORRECTNESS_PATCH_MARKERS.githubCopilotDeviceCode,
		"export function abortableSleep(ms, signal, cancelMessage) {",
	]),
	githubCopilotOAuth: Object.freeze([
		PI_RUNTIME_CORRECTNESS_PATCH_MARKERS.githubCopilotOAuth,
		'import { abortableSleep, pollOAuthDeviceCodeFlow } from "./device-code.js";',
		"const MAX_RETRY_AFTER_MS = 10_000;",
		"const DEFAULT_RETRY_AFTER_MS = 1_000;",
		"const request = () =>",
		"if (response.status === 429) {",
		'response.headers.get("retry-after")',
		'await abortableSleep(waitMs, signal, "Login cancelled");',
		"return parseAvailableCopilotModelIds(await response.json(), allowPolicyFallback);",
		"for (const model of Object.values(GITHUB_COPILOT_MODELS)) {",
		"await enableGitHubCopilotModel(token, model.id, enterpriseDomain, signal);",
	]),
});
export const PI_RUNTIME_CORRECTNESS_FORBIDDEN_FRAGMENTS = Object.freeze({
	agentSession: Object.freeze([
		`            if (messageText) {
                // Check steering queue first`,
	]),
	sessionManager: Object.freeze([]),
	transformMessages: Object.freeze([]),
	githubCopilotDeviceCode: Object.freeze([]),
	githubCopilotOAuth: Object.freeze([]),
});

const PI_RUNTIME_CORRECTNESS_ORDERED_FRAGMENTS = Object.freeze({
	agentSession: Object.freeze([
		PI_RUNTIME_CORRECTNESS_PATCH_MARKERS.turnEndMessages,
		"this._flushPendingTurnEndMessages();",
		PI_RUNTIME_CORRECTNESS_PATCH_MARKERS.imageQueue,
		"const entryId = this.sessionManager.appendMessage(toolResult);",
		"await this._emitExtensionEvent(event);",
		"event.message.toolCallId = feynmanToolResultIdBeforeExtensions;",
		"const eagerToolCallId = feynmanToolResultIdBeforeExtensions ?? event.message.toolCallId;",
		"this.sessionManager.replaceMessage(eagerlyPersisted.entryId, event.message);",
		"this._pendingTurnEndMessages.push(appMessage);",
	]),
	sessionManager: Object.freeze([
		"function restoreFeynmanToolResultsInSourceOrder(messages) {",
		"const messages = restoreFeynmanToolResultsInSourceOrder(buildContextEntries(entries, leafId, byId).flatMap(sessionEntryToContextMessages));",
	]),
	transformMessages: Object.freeze([
		"const flushFeynmanToolResults = () => {",
		"pendingToolResults.set(msg.toolCallId, msg);",
	]),
	githubCopilotDeviceCode: Object.freeze([
		PI_RUNTIME_CORRECTNESS_PATCH_MARKERS.githubCopilotDeviceCode,
		"export function abortableSleep(ms, signal, cancelMessage) {",
	]),
	githubCopilotOAuth: Object.freeze([
		PI_RUNTIME_CORRECTNESS_PATCH_MARKERS.githubCopilotOAuth,
		"const request = () =>",
		"if (response.status === 429) {",
		'await abortableSleep(waitMs, signal, "Login cancelled");',
		"for (const model of Object.values(GITHUB_COPILOT_MODELS)) {",
	]),
});

const AGENT_SESSION_MARKER = PI_RUNTIME_CORRECTNESS_PATCH_MARKERS.agentSession;
const SESSION_MANAGER_MARKER = PI_RUNTIME_CORRECTNESS_PATCH_MARKERS.sessionManager;
const TRANSFORM_MESSAGES_MARKER = PI_RUNTIME_CORRECTNESS_PATCH_MARKERS.transformMessages;
const GITHUB_COPILOT_DEVICE_CODE_MARKER =
	PI_RUNTIME_CORRECTNESS_PATCH_MARKERS.githubCopilotDeviceCode;
const GITHUB_COPILOT_OAUTH_MARKER =
	PI_RUNTIME_CORRECTNESS_PATCH_MARKERS.githubCopilotOAuth;

export function assertPiRuntimeCorrectnessVersion(version, surface) {
	if (version !== PI_RUNTIME_CORRECTNESS_REQUIRED_VERSION) {
		throw new Error(
			`Unsupported Pi runtime correctness patch ${surface}: expected ${PI_RUNTIME_CORRECTNESS_REQUIRED_VERSION}, found ${version ?? "missing"}`,
		);
	}
}

export function assertPiCodingAgentForwardFixSource(relativePath, source, surface = relativePath) {
	if (source.includes("//# sourceMappingURL=")) {
		throw new Error(`Incomplete Pi coding-agent forward patch ${surface}: retained stale source map directive`);
	}
	switch (relativePath) {
		case "dist/modes/interactive/components/tool-execution.js":
			for (const fragment of [
				PI_CODING_AGENT_FORWARD_FIX_MARKERS.largeToolRender,
				"for (const line of contentLines)",
				"for (const line of spacer.render(width))",
				"for (const line of imageComponent.render(width))",
			]) {
				if (!source.includes(fragment)) {
					throw new Error(`Incomplete Pi coding-agent forward patch ${surface}: missing ${fragment}`);
				}
			}
			for (const fragment of [
				"lines.push(...contentLines)",
				"lines.push(...spacer.render(width))",
				"lines.push(...imageComponent.render(width))",
			]) {
				if (source.includes(fragment)) {
					throw new Error(`Incomplete Pi coding-agent forward patch ${surface}: retained ${fragment}`);
				}
			}
			return;
		case "dist/utils/tools-manager.js":
			for (const fragment of [
				PI_CODING_AGENT_FORWARD_FIX_MARKERS.toolReleaseRedirect,
				"`https://github.com/${repo}/releases/latest`",
				"export async function getLatestVersion(repo)",
				'redirect: "manual"',
				"await response.body?.cancel()",
				'resolved.origin !== "https://github.com"',
				"decodeURIComponent(tag)",
				'tool === "fd" && plat === "darwin" && architecture === "x64"',
				"Download failed with HTTP ${response.status}: ${url}",
				"messages.join(\": \")",
			]) {
				if (!source.includes(fragment)) {
					throw new Error(`Incomplete Pi coding-agent forward patch ${surface}: missing ${fragment}`);
				}
			}
			if (source.includes("https://api.github.com/repos/${repo}/releases/latest")) {
				throw new Error(`Incomplete Pi coding-agent forward patch ${surface}: retained GitHub API lookup`);
			}
			return;
		case "dist/utils/exif-orientation.js":
			if (source.split(PATCHED_EXIF_AFTER_XMP_BLOCK).length - 1 !== 1) {
				throw new Error(
					`Incomplete Pi coding-agent forward patch ${surface}: missing exact conditional EXIF-after-XMP block`,
				);
			}
			if (source.split("return segmentStart + 6;").length - 1 !== 1) {
				throw new Error(
					`Incomplete Pi coding-agent forward patch ${surface}: expected exactly one EXIF TIFF offset return`,
				);
			}
			if (source.includes("if (!hasExifHeader(bytes, segmentStart))")) {
				throw new Error(
					`Incomplete Pi coding-agent forward patch ${surface}: retained first-APP1 early return`,
				);
			}
			return;
		default:
			throw new Error(`Unknown Pi coding-agent forward patch target: ${relativePath}`);
	}
}

export function patchPiCodingAgentForwardFixSource(relativePath, source) {
	source = stripStaleSourceMapDirective(source, relativePath);
	if (relativePath === "dist/modes/interactive/components/tool-execution.js") {
		if (source.includes(PI_CODING_AGENT_FORWARD_FIX_MARKERS.largeToolRender)) {
			assertPiCodingAgentForwardFixSource(relativePath, source);
			return source;
		}
		let patched = replaceRequired(
			source,
			`                lines.push("");
                lines.push(...contentLines);`,
			`                lines.push("");
                // ${PI_CODING_AGENT_FORWARD_FIX_MARKERS.largeToolRender}
                // Avoid V8's function-argument ceiling for very large rendered diffs.
                for (const line of contentLines)
                    lines.push(line);`,
			"large tool content render",
		);
		patched = replaceRequired(
			patched,
			"                    lines.push(...spacer.render(width));",
			"                    for (const line of spacer.render(width))\n                        lines.push(line);",
			"large tool spacer render",
		);
		patched = replaceRequired(
			patched,
			"                    lines.push(...imageComponent.render(width));",
			"                    for (const line of imageComponent.render(width))\n                        lines.push(line);",
			"large tool image render",
		);
		assertPiCodingAgentForwardFixSource(relativePath, patched);
		return patched;
	}

	if (relativePath === "dist/utils/tools-manager.js") {
		if (source.includes(PI_CODING_AGENT_FORWARD_FIX_MARKERS.toolReleaseRedirect)) {
			assertPiCodingAgentForwardFixSource(relativePath, source);
			return source;
		}
		const original = `// Fetch latest release version from GitHub
async function getLatestVersion(repo) {
    const response = await fetchWithRetry(\`https://api.github.com/repos/\${repo}/releases/latest\`, {
        headers: { "User-Agent": \`\${APP_NAME}-coding-agent\` },
    }, { timeoutMs: NETWORK_TIMEOUT_MS });
    if (!response.ok) {
        throw new Error(\`GitHub API error: \${response.status}\`);
    }
    const data = (await response.json());
    return data.tag_name.replace(/^v/, "");
}`;
		const replacement = `// Fetch latest release version without consuming the anonymous GitHub API quota.
// ${PI_CODING_AGENT_FORWARD_FIX_MARKERS.toolReleaseRedirect}
export async function getLatestVersion(repo) {
    const latestUrl = \`https://github.com/\${repo}/releases/latest\`;
    const response = await fetchWithRetry(latestUrl, {
        headers: { "User-Agent": \`\${APP_NAME}-coding-agent\` },
        redirect: "manual",
    }, { timeoutMs: NETWORK_TIMEOUT_MS });
    try {
        await response.body?.cancel();
    }
    catch {
        // Releasing the redirect body is best-effort.
    }
    const location = response.headers.get("location");
    if (response.status < 300 || response.status >= 400 || !location) {
        throw new Error(\`Failed to resolve latest \${repo} release: HTTP \${response.status} without redirect\`);
    }
    const resolved = new URL(location, latestUrl);
    const prefix = \`/\${repo}/releases/tag/\`;
    if (resolved.origin !== "https://github.com" || !resolved.pathname.startsWith(prefix)) {
        throw new Error(\`Unexpected GitHub release redirect: \${resolved.href}\`);
    }
    const tag = resolved.pathname.slice(prefix.length);
    if (!tag || tag.includes("/")) {
        throw new Error(\`Invalid GitHub release tag redirect: \${resolved.href}\`);
    }
    const version = decodeURIComponent(tag).replace(/^v/, "");
    if (!/^[0-9][0-9A-Za-z._-]*$/.test(version)) {
        throw new Error(\`Invalid GitHub release version: \${version}\`);
    }
    return version;
}`;
		const currentRedirect = patchCurrentToolReleaseRedirect(source, replacement);
		if (currentRedirect !== undefined) {
			assertPiCodingAgentForwardFixSource(relativePath, currentRedirect);
			return currentRedirect;
		}

		let patched = replaceRequired(source, original, replacement, "tool release version lookup");
		patched = replaceRequired(
			patched,
			`    // Get latest version
    let version = await getLatestVersion(config.repo);
    if (tool === "fd" && plat === "darwin" && architecture === "x64") {
        version = "10.3.0";
    }`,
			`    // fd is pinned on darwin/x64, so do not perform an unnecessary lookup.
    const version = tool === "fd" && plat === "darwin" && architecture === "x64"
        ? "10.3.0"
        : await getLatestVersion(config.repo);`,
			"pinned fd release lookup bypass",
		);
		patched = replaceRequired(
			patched,
			"        throw new Error(`Failed to download: ${response.status}`);",
			"        throw new Error(`Download failed with HTTP ${response.status}: ${url}`);",
			"tool download diagnostics",
		);
		patched = replaceRequired(
			patched,
			`    catch (e) {
        onStatus?.({
            type: "warning",
            message: \`Failed to download \${config.name}: \${e instanceof Error ? e.message : e}\`,
        });
        return undefined;
    }`,
			`    catch (e) {
        const messages = [];
        for (let current = e, depth = 0; current instanceof Error && depth < 5; current = current.cause, depth++) {
            if (!messages.includes(current.message))
                messages.push(current.message);
        }
        onStatus?.({
            type: "warning",
            message: \`Failed to download \${config.name}: \${messages.length > 0 ? messages.join(": ") : String(e)}\`,
        });
        return undefined;
    }`,
			"tool download cause-chain diagnostics",
		);
		assertPiCodingAgentForwardFixSource(relativePath, patched);
		return patched;
	}

	if (relativePath === "dist/utils/exif-orientation.js") {
		if (source.includes(PI_CODING_AGENT_FORWARD_FIX_MARKERS.exifAfterXmp)) {
			assertPiCodingAgentForwardFixSource(relativePath, source);
			return source;
		}
		const upstreamExif = "            if (hasExifHeader(bytes, segmentStart))\n                return segmentStart + 6;";
		if (source.includes(upstreamExif)) {
			const patched = replaceRequired(source, upstreamExif, PATCHED_EXIF_AFTER_XMP_BLOCK, "upstream EXIF guard");
			assertPiCodingAgentForwardFixSource(relativePath, patched);
			return patched;
		}
		const patched = replaceRequired(
			source,
			`            if (!hasExifHeader(bytes, segmentStart))
                return -1;
            return segmentStart + 6;`,
			PATCHED_EXIF_AFTER_XMP_BLOCK,
			"EXIF scan after non-EXIF APP1",
		);
		assertPiCodingAgentForwardFixSource(relativePath, patched);
		return patched;
	}

	throw new Error(`Unknown Pi coding-agent forward patch target: ${relativePath}`);
}

export function assertPiRuntimeCorrectnessPatchSource(source, target, surface = target) {
	if (target === "githubCopilotOAuth" && isCurrentCopilotOAuthSource(source)) return;
	const required = PI_RUNTIME_CORRECTNESS_REQUIRED_FRAGMENTS[target];
	const forbidden = PI_RUNTIME_CORRECTNESS_FORBIDDEN_FRAGMENTS[target];
	const ordered = PI_RUNTIME_CORRECTNESS_ORDERED_FRAGMENTS[target];
	if (!required || !forbidden || !ordered) {
		throw new Error(`Unknown Pi runtime correctness target: ${target}`);
	}
	if (source.includes("//# sourceMappingURL=")) {
		throw new Error(`Incomplete Pi runtime correctness patch ${surface}: retained stale source map directive`);
	}
	for (const fragment of required) {
		if (!source.includes(fragment)) {
			throw new Error(`Incomplete Pi runtime correctness patch ${surface}: missing ${fragment}`);
		}
	}
	for (const fragment of forbidden) {
		if (source.includes(fragment)) {
			throw new Error(`Incomplete Pi runtime correctness patch ${surface}: retained ${fragment}`);
		}
	}
	if (target === "agentSession") {
		assertDeferredRunGuard(source);
		assertPiInterleavedUserContentSource(source, surface);
		if (/\bif\s*\([^{}\n]*\bmessageText\b[^{}\n]*\)\s*\{/.test(source)) {
			throw new Error(
				`Incomplete Pi runtime correctness patch ${surface}: retained messageText truthiness guard`,
			);
		}
		if (!source.includes(PATCHED_IMAGE_QUEUE_EVENT_HANDLER)) {
			throw new Error(
				`Incomplete Pi runtime correctness patch ${surface}: missing exact image-only queue event handler`,
			);
		}
	}
	if (target === "sessionManager") {
		assertPiSessionTailPatchedSource(source, surface);
	}
	let previousIndex = -1;
	for (const fragment of ordered) {
		const index = source.indexOf(fragment);
		if (index <= previousIndex) {
			throw new Error(`Incomplete Pi runtime correctness patch ${surface}: out of order ${fragment}`);
		}
		previousIndex = index;
	}
}

function replaceRequired(source, original, replacement, label) {
	const first = source.indexOf(original);
	if (first === -1 || source.indexOf(original, first + original.length) !== -1) {
		throw new Error(
			`Unsupported Pi ${PI_RUNTIME_CORRECTNESS_REQUIRED_VERSION} ${label} layout; remove or update the runtime correctness patch`,
		);
	}
	return source.replace(original, replacement);
}

const ORIGINAL_IMAGE_QUEUE_DELIVERY = `            const messageText = contentText(event.message.content, "");
            if (messageText) {
                // Check steering queue first
                const steeringIndex = this._steeringMessages.indexOf(messageText);
                if (steeringIndex !== -1) {
                    this._steeringMessages.splice(steeringIndex, 1);
                    this._emitQueueUpdate();
                }
                else {
                    // Check follow-up queue
                    const followUpIndex = this._followUpMessages.indexOf(messageText);
                    if (followUpIndex !== -1) {
                        this._followUpMessages.splice(followUpIndex, 1);
                        this._emitQueueUpdate();
                    }
                }
            }`;

const PATCHED_IMAGE_QUEUE_DELIVERY = `            const messageText = contentText(event.message.content, "");
            // ${PI_RUNTIME_CORRECTNESS_PATCH_MARKERS.imageQueue}
            // Empty text is valid when a queued user message contains only images.
            // Match it just like textual steering and follow-up messages.
            const steeringIndex = this._steeringMessages.indexOf(messageText);
            if (steeringIndex !== -1) {
                this._steeringMessages.splice(steeringIndex, 1);
                this._emitQueueUpdate();
            }
            else {
                // Check follow-up queue
                const followUpIndex = this._followUpMessages.indexOf(messageText);
                if (followUpIndex !== -1) {
                    this._followUpMessages.splice(followUpIndex, 1);
                    this._emitQueueUpdate();
                }
            }`;

const PATCHED_IMAGE_QUEUE_EVENT_HANDLER = `        if (event.type === "message_start" && event.message.role === "user") {
            this._overflowRecoveryAttempted = false;
${PATCHED_IMAGE_QUEUE_DELIVERY}
        }
        const feynmanToolResultIdBeforeExtensions =`;

function patchPiImageQueueDeliverySource(source) {
	if (source.includes(PI_RUNTIME_CORRECTNESS_PATCH_MARKERS.imageQueue)) {
		return source;
	}
	return replaceRequired(
		source,
		ORIGINAL_IMAGE_QUEUE_DELIVERY,
		PATCHED_IMAGE_QUEUE_DELIVERY,
		"agent-session image-only queue delivery",
	);
}

const TURN_END_MESSAGE_HELPER = `    /** Append deferred triggerTurn-false custom messages after the active run settles. */
    _flushPendingTurnEndMessages() {
        // ${PI_RUNTIME_CORRECTNESS_PATCH_MARKERS.turnEndMessages}
        // Snapshot first: a listener may synchronously start another run and
        // messages queued by that run must wait for its own settlement.
        const messages = this._pendingTurnEndMessages.splice(0);
        for (const message of messages) {
            if (this._disposed)
                break;
            try {
                this.agent.state.messages.push(message);
                this.sessionManager.appendCustomMessageEntry(message.customType, message.content, message.display, message.details);
            }
            catch {
                // A failed persisted parent makes later entries unsafe to append.
                break;
            }
            try {
                this._emit({ type: "message_start", message });
                this._emit({ type: "message_end", message });
            }
            catch {
                // Listener failures must not deadlock waitForIdle or drop later messages.
            }
        }
    }
`;

const TURN_END_DISPOSE_SAFETY = `        // Persist deferred notifications only when no run is active. During a run
        // the transcript may end on tool calls without their results; appending a
        // custom message there would recreate the ordering corruption.
        if (this._isAgentRunActive) {
            this._pendingTurnEndMessages = [];
        }
        else {
            while (this._pendingTurnEndMessages.length > 0) {
                const message = this._pendingTurnEndMessages.shift();
                if (!message)
                    break;
                try {
                    this.sessionManager.appendCustomMessageEntry(message.customType, message.content, message.display, message.details);
                }
                catch {
                    // Dispose must remain best-effort.
                }
            }
        }
`;

function patchPiDeferredTurnEndMessagesSource(source) {
	if (source.includes(PI_RUNTIME_CORRECTNESS_PATCH_MARKERS.turnEndMessages)) {
		return source;
	}
	source = normalizeCurrentDeferredCustomMessages(source);
	let patched = replaceRequired(
		source,
		"    _pendingNextTurnMessages = [];\n",
		"    _pendingNextTurnMessages = [];\n    _pendingTurnEndMessages = [];\n    _disposed = false;\n",
		"agent-session deferred turn-end state",
	);
	patched = replaceRequired(
		patched,
		"    async _emitAgentSettled() {\n",
		`${TURN_END_MESSAGE_HELPER}    async _emitAgentSettled() {\n`,
		"agent-session deferred turn-end helper",
	);
	patched = replaceRequired(
		patched,
		"    async _emitAgentSettled() {\n        this._isAgentRunActive = false;\n",
		"    async _emitAgentSettled() {\n        this._isAgentRunActive = false;\n        this._flushPendingTurnEndMessages();\n",
		"agent-session deferred turn-end drain",
	);
	patched = replaceRequired(
		patched,
		"    dispose() {\n        try {\n",
		"    dispose() {\n        this._disposed = true;\n        try {\n",
		"agent-session disposed state",
	);
	patched = replaceRequired(
		patched,
		`        catch {
            // Dispose must succeed even if an abort hook throws.
        }
        this._extensionRunner.invalidate(`,
		`        catch {
            // Dispose must succeed even if an abort hook throws.
        }
${TURN_END_DISPOSE_SAFETY}        this._extensionRunner.invalidate(`,
		"agent-session deferred turn-end disposal",
	);
	patched = replaceRequired(
		patched,
		`        else if (options?.triggerTurn) {
            await this._runAgentPrompt(appMessage);
        }
        else {
            this.agent.state.messages.push(appMessage);`,
		`        else if (options?.triggerTurn) {
            await this._runAgentPrompt(appMessage);
        }
        else if (this.isStreaming) {
            // Never insert a custom/user-converted message between assistant tool
            // calls and their results. Deliver it after this run settles instead.
            this._pendingTurnEndMessages.push(appMessage);
        }
        else {
            this.agent.state.messages.push(appMessage);`,
		"agent-session deferred turn-end enqueue",
	);
	return patched;
}

const AGENT_SESSION_HELPERS = `
// ${AGENT_SESSION_MARKER}
function createFeynmanToolResultMessage(event) {
    return {
        role: "toolResult",
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        content: event.result.content ?? [],
        details: event.result.details,
        usage: event.result.usage,
        ...(event.result.addedToolNames?.length ? { addedToolNames: event.result.addedToolNames } : {}),
        isError: event.isError,
        timestamp: Date.now(),
    };
}
function hasSameFeynmanToolResultPayload(left, right) {
    return (left.toolCallId === right.toolCallId &&
        left.toolName === right.toolName &&
        left.isError === right.isError &&
        isDeepStrictEqual(left.content, right.content) &&
        isDeepStrictEqual(left.details, right.details) &&
        isDeepStrictEqual(left.usage, right.usage) &&
        isDeepStrictEqual(left.addedToolNames, right.addedToolNames));
}
function serializeFeynmanToolResultPayload(message) {
    return JSON.stringify({
        toolCallId: message.toolCallId,
        toolName: message.toolName,
        content: message.content,
        details: message.details,
        usage: message.usage,
        addedToolNames: message.addedToolNames,
        isError: message.isError,
    });
}
`;

const AGENT_SESSION_LEGACY_EAGER_PERSISTENCE = `        // A finalized result must be durable before a parallel sibling settles.
        // Public message_end events remain ordered by the assistant's tool calls.
        if (event.type === "tool_execution_end") {
            const toolResult = createFeynmanToolResultMessage(event);
            const entryId = this.sessionManager.appendMessage(toolResult);
            this._feynmanEagerlyPersistedToolResults.set(event.toolCallId, {
                entryId,
                message: toolResult,
                serializedPayload: this.sessionManager.isPersisted()
                    ? serializeFeynmanToolResultPayload(toolResult)
                    : undefined,
            });
        }
`;

const AGENT_SESSION_EAGER_PERSISTENCE = `        // A finalized result must be durable before a parallel sibling settles.
        // Persist before extension dispatch so a completed tool survives a blocked handler.
        // Public message_end events remain ordered by the assistant's tool calls.
        if (event.type === "tool_execution_end") {
            const toolResult = createFeynmanToolResultMessage(event);
            const entryId = this.sessionManager.appendMessage(toolResult);
            this._feynmanEagerlyPersistedToolResults.set(event.toolCallId, {
                entryId,
                message: toolResult,
                serializedPayload: this.sessionManager.isPersisted()
                    ? serializeFeynmanToolResultPayload(toolResult)
                    : undefined,
            });
        }
`;

const AGENT_SESSION_EXTENSION_BOUNDARY = `        const feynmanToolResultIdBeforeExtensions = event.type === "message_end" && event.message.role === "toolResult"
            ? event.message.toolCallId
            : undefined;
${AGENT_SESSION_EAGER_PERSISTENCE}        // Emit to extensions first
        await this._emitExtensionEvent(event);
        // Tool result identity is protocol-bound to the assistant's original call.
        // Preserve it when an extension returns a same-role replacement with another ID.
        if (feynmanToolResultIdBeforeExtensions !== undefined &&
            event.type === "message_end" &&
            event.message.role === "toolResult" &&
            event.message.toolCallId !== feynmanToolResultIdBeforeExtensions) {
            event.message.toolCallId = feynmanToolResultIdBeforeExtensions;
        }
`;

const ORIGINAL_MESSAGE_PERSISTENCE = `            else if (event.message.role === "user" ||
                event.message.role === "assistant" ||
                event.message.role === "toolResult") {
                // Regular LLM message - persist as SessionMessageEntry
                this.sessionManager.appendMessage(event.message);
            }`;

const PATCHED_MESSAGE_PERSISTENCE = `            else if (event.message.role === "toolResult") {
                const eagerToolCallId = feynmanToolResultIdBeforeExtensions ?? event.message.toolCallId;
                const eagerlyPersisted = this._feynmanEagerlyPersistedToolResults.get(eagerToolCallId);
                this._feynmanEagerlyPersistedToolResults.delete(eagerToolCallId);
                const payloadUnchanged = eagerlyPersisted?.serializedPayload !== undefined
                    ? eagerlyPersisted.serializedPayload === serializeFeynmanToolResultPayload(event.message)
                    : eagerlyPersisted
                        ? hasSameFeynmanToolResultPayload(eagerlyPersisted.message, event.message)
                        : false;
                if (eagerlyPersisted && !payloadUnchanged) {
                    this.sessionManager.replaceMessage(eagerlyPersisted.entryId, event.message);
                }
                else if (!eagerlyPersisted) {
                    this.sessionManager.appendMessage(event.message);
                }
            }
            else if (event.message.role === "user" || event.message.role === "assistant") {
                // Regular LLM message - persist as SessionMessageEntry
                this.sessionManager.appendMessage(event.message);
            }`;

export function patchPiAgentSessionSource(source) {
	source = stripStaleSourceMapDirective(source, "agent-session");
	source = patchPiInterleavedUserContentSource(source);
	source = patchPiImageQueueDeliverySource(source);
	source = patchPiDeferredTurnEndMessagesSource(source);
	source = patchDeferredRunGuard(source);
	if (source.includes(AGENT_SESSION_MARKER)) {
		try {
			assertPiRuntimeCorrectnessPatchSource(source, "agentSession");
			return source;
		} catch (error) {
			if (!source.includes(`        // Emit to extensions first
        await this._emitExtensionEvent(event);
${AGENT_SESSION_LEGACY_EAGER_PERSISTENCE}`)) {
				throw error;
			}
			let upgraded = replaceRequired(
				source,
				`        // Emit to extensions first
        await this._emitExtensionEvent(event);
${AGENT_SESSION_LEGACY_EAGER_PERSISTENCE}`,
				AGENT_SESSION_EXTENSION_BOUNDARY,
				"legacy agent-session extension boundary",
			);
			upgraded = replaceRequired(
				upgraded,
				`                const eagerlyPersisted = this._feynmanEagerlyPersistedToolResults.get(event.message.toolCallId);
                this._feynmanEagerlyPersistedToolResults.delete(event.message.toolCallId);`,
				`                const eagerToolCallId = feynmanToolResultIdBeforeExtensions ?? event.message.toolCallId;
                const eagerlyPersisted = this._feynmanEagerlyPersistedToolResults.get(eagerToolCallId);
                this._feynmanEagerlyPersistedToolResults.delete(eagerToolCallId);`,
				"legacy agent-session eager result lookup",
			);
			assertPiRuntimeCorrectnessPatchSource(upgraded, "agentSession");
			return upgraded;
		}
	}

	let patched = replaceRequired(
		source,
		'import { basename, dirname } from "node:path";\n',
		'import { basename, dirname } from "node:path";\nimport { isDeepStrictEqual } from "node:util";\n',
		"agent-session import",
	);
	patched = replaceRequired(
		patched,
		"// ============================================================================\n// Constants\n// ============================================================================\n",
		`${AGENT_SESSION_HELPERS}\n// ============================================================================\n// Constants\n// ============================================================================\n`,
		"agent-session helper",
	);
	patched = replaceRequired(
		patched,
		"    _eventListeners = [];\n",
		"    _eventListeners = [];\n    _feynmanEagerlyPersistedToolResults = new Map();\n",
		"agent-session state",
	);
	patched = replaceRequired(
		patched,
		"        // Emit to extensions first\n        await this._emitExtensionEvent(event);\n",
		AGENT_SESSION_EXTENSION_BOUNDARY,
		"agent-session extension boundary",
	);
	patched = replaceRequired(
		patched,
		ORIGINAL_MESSAGE_PERSISTENCE,
		PATCHED_MESSAGE_PERSISTENCE,
		"agent-session message persistence",
	);
	assertPiRuntimeCorrectnessPatchSource(patched, "agentSession");
	return patched;
}

const SESSION_MANAGER_HELPER = `
// ${SESSION_MANAGER_MARKER}
function restoreFeynmanToolResultsInSourceOrder(messages) {
    const batchesByAssistantIndex = new Map();
    const associatedResultIndexes = new Set();
    let activeBatch;
    for (let i = 0; i < messages.length; i++) {
        const message = messages[i];
        if (message.role === "assistant") {
            activeBatch = undefined;
            if (message.stopReason === "error" || message.stopReason === "aborted")
                continue;
            const toolCallIds = message.content.filter((block) => block.type === "toolCall").map((block) => block.id);
            if (toolCallIds.length > 0) {
                activeBatch = { toolCallIds, results: new Map() };
                batchesByAssistantIndex.set(i, activeBatch);
            }
            continue;
        }
        if (message.role === "toolResult" && activeBatch?.toolCallIds.includes(message.toolCallId)) {
            activeBatch.results.set(message.toolCallId, message);
            associatedResultIndexes.add(i);
        }
    }
    const restored = [];
    for (let i = 0; i < messages.length; i++) {
        if (associatedResultIndexes.has(i))
            continue;
        const message = messages[i];
        restored.push(message);
        const batch = batchesByAssistantIndex.get(i);
        if (!batch)
            continue;
        for (const toolCallId of batch.toolCallIds) {
            const toolResult = batch.results.get(toolCallId);
            if (toolResult)
                restored.push(toolResult);
        }
    }
    return restored;
}
`;

const SESSION_MANAGER_REPLACE_MESSAGE = `    /**
     * Replace an eagerly persisted message without appending a second billable entry.
     * Feynman uses this only when a message_end extension rewrites a finalized tool result.
     */
    replaceMessage(entryId, message) {
        const existing = this.byId.get(entryId);
        if (!existing || existing.type !== "message") {
            throw new Error(\`Cannot replace missing session message entry: \${entryId}\`);
        }
        const index = this.fileEntries.findIndex((entry) => entry.type === "message" && entry.id === entryId);
        if (index === -1) {
            throw new Error(\`Cannot replace unindexed session message entry: \${entryId}\`);
        }
        const replacement = { ...existing, message };
        this.fileEntries[index] = replacement;
        this.byId.set(entryId, replacement);
        this._rewriteFile();
    }
`;

export function patchPiSessionManagerSource(source) {
	source = stripStaleSourceMapDirective(source, "session-manager");
	source = patchPiSessionTailSource(source);
	if (source.includes(SESSION_MANAGER_MARKER)) {
		assertPiRuntimeCorrectnessPatchSource(source, "sessionManager");
		return source;
	}
	let patched = replaceRequired(
		source,
		"/**\n * Build the active, compaction-aware session entry list.\n",
		`${SESSION_MANAGER_HELPER}\n/**\n * Build the active, compaction-aware session entry list.\n`,
		"session-manager helper",
	);
	patched = replaceRequired(
		patched,
		"    /** Append a thinking level change as child of current leaf, then advance leaf. Returns entry id. */\n",
		`${SESSION_MANAGER_REPLACE_MESSAGE}    /** Append a thinking level change as child of current leaf, then advance leaf. Returns entry id. */\n`,
		"session-manager message replacement",
	);
	patched = replaceRequired(
		patched,
		"    const messages = buildContextEntries(entries, leafId, byId).flatMap(sessionEntryToContextMessages);\n",
		"    const messages = restoreFeynmanToolResultsInSourceOrder(buildContextEntries(entries, leafId, byId).flatMap(sessionEntryToContextMessages));\n",
		"session-manager context restoration",
	);
	assertPiRuntimeCorrectnessPatchSource(patched, "sessionManager");
	return patched;
}

const ORIGINAL_TRANSFORM_SECOND_PASS = `    // Second pass: insert synthetic empty tool results for orphaned tool calls
    // This preserves thinking signatures and satisfies API requirements
    const result = [];
    let pendingToolCalls = [];
    let existingToolResultIds = new Set();
    const insertSyntheticToolResults = () => {
        if (pendingToolCalls.length > 0) {
            for (const tc of pendingToolCalls) {
                if (!existingToolResultIds.has(tc.id)) {
                    result.push({
                        role: "toolResult",
                        toolCallId: tc.id,
                        toolName: tc.name,
                        content: [{ type: "text", text: "No result provided" }],
                        isError: true,
                        timestamp: Date.now(),
                    });
                }
            }
            pendingToolCalls = [];
            existingToolResultIds = new Set();
        }
    };
    for (let i = 0; i < transformed.length; i++) {
        const msg = transformed[i];
        if (msg.role === "assistant") {
            // If we have pending orphaned tool calls from a previous assistant, insert synthetic results now
            insertSyntheticToolResults();
            // Skip errored/aborted assistant messages entirely.
            // These are incomplete turns that shouldn't be replayed:
            // - May have partial content (reasoning without message, incomplete tool calls)
            // - Replaying them can cause API errors (e.g., OpenAI "reasoning without following item")
            // - The model should retry from the last valid state
            const assistantMsg = msg;
            if (assistantMsg.stopReason === "error" || assistantMsg.stopReason === "aborted") {
                continue;
            }
            // Track tool calls from this assistant message
            const toolCalls = assistantMsg.content.filter((b) => b.type === "toolCall");
            if (toolCalls.length > 0) {
                pendingToolCalls = toolCalls;
                existingToolResultIds = new Set();
            }
            result.push(msg);
        }
        else if (msg.role === "toolResult") {
            existingToolResultIds.add(msg.toolCallId);
            result.push(msg);
        }
        else if (msg.role === "user") {
            // User message interrupts tool flow - insert synthetic results for orphaned calls
            insertSyntheticToolResults();
            result.push(msg);
        }
        else {
            result.push(msg);
        }
    }
    // If the conversation ends with unresolved tool calls, synthesize results now.
    insertSyntheticToolResults();
`;

const PATCHED_TRANSFORM_SECOND_PASS = `    // ${TRANSFORM_MESSAGES_MARKER}
    // Order results by assistant source calls and synthesize only unresolved calls.
    // Eager persistence can store parallel results in completion order.
    const result = [];
    let pendingToolCalls = [];
    let pendingToolResults = new Map();
    const flushFeynmanToolResults = () => {
        if (pendingToolCalls.length > 0) {
            for (const toolCall of pendingToolCalls) {
                const toolResult = pendingToolResults.get(toolCall.id);
                result.push(toolResult ?? {
                    role: "toolResult",
                    toolCallId: toolCall.id,
                    toolName: toolCall.name,
                    content: [{ type: "text", text: "No result provided" }],
                    isError: true,
                    timestamp: Date.now(),
                });
            }
            pendingToolCalls = [];
            pendingToolResults = new Map();
        }
    };
    for (let i = 0; i < transformed.length; i++) {
        const msg = transformed[i];
        if (msg.role === "assistant") {
            flushFeynmanToolResults();
            // Skip errored/aborted assistant messages entirely.
            // These are incomplete turns that shouldn't be replayed:
            // - May have partial content (reasoning without message, incomplete tool calls)
            // - Replaying them can cause API errors (e.g., OpenAI "reasoning without following item")
            // - The model should retry from the last valid state
            const assistantMsg = msg;
            if (assistantMsg.stopReason === "error" || assistantMsg.stopReason === "aborted") {
                continue;
            }
            const toolCalls = assistantMsg.content.filter((b) => b.type === "toolCall");
            if (toolCalls.length > 0) {
                pendingToolCalls = toolCalls;
                pendingToolResults = new Map();
            }
            result.push(msg);
        }
        else if (msg.role === "toolResult") {
            if (pendingToolCalls.some((toolCall) => toolCall.id === msg.toolCallId)) {
                pendingToolResults.set(msg.toolCallId, msg);
            }
            else {
                result.push(msg);
            }
        }
        else if (msg.role === "user") {
            flushFeynmanToolResults();
            result.push(msg);
        }
        else {
            result.push(msg);
        }
    }
    flushFeynmanToolResults();
`;

export function patchPiTransformMessagesSource(source) {
	source = stripStaleSourceMapDirective(source, "transform-messages");
	if (source.includes(TRANSFORM_MESSAGES_MARKER)) {
		assertPiRuntimeCorrectnessPatchSource(source, "transformMessages");
		return source;
	}
	const patched = replaceRequired(
		source,
		ORIGINAL_TRANSFORM_SECOND_PASS,
		PATCHED_TRANSFORM_SECOND_PASS,
		"transform-messages second pass",
	);
	assertPiRuntimeCorrectnessPatchSource(patched, "transformMessages");
	return patched;
}

const ORIGINAL_COPILOT_MODEL_FETCH = `    const raw = await fetchJson(\`\${baseUrl}/models\`, {
        headers: {
            Accept: "application/json",
            Authorization: \`Bearer \${copilotToken}\`,
            ...COPILOT_HEADERS,
            "X-GitHub-Api-Version": COPILOT_API_VERSION,
        },
        signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
    });
    return parseAvailableCopilotModelIds(raw, allowPolicyFallback);`;

const PATCHED_COPILOT_MODEL_FETCH = `    const request = () =>
        fetch(\`\${baseUrl}/models\`, {
            headers: {
                Accept: "application/json",
                Authorization: \`Bearer \${copilotToken}\`,
                ...COPILOT_HEADERS,
                "X-GitHub-Api-Version": COPILOT_API_VERSION,
            },
            signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
        });
    // The login-time policy updates can drain the Copilot API rate-limit bucket, in which case
    // this request is rejected with 429. Honor Retry-After and retry once instead of failing.
    let response = await request();
    if (response.status === 429) {
        const retryAfterSeconds = Number(response.headers.get("retry-after"));
        const waitMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
            ? Math.min(retryAfterSeconds * 1000, MAX_RETRY_AFTER_MS)
            : DEFAULT_RETRY_AFTER_MS;
        await abortableSleep(waitMs, signal, "Login cancelled");
        response = await request();
    }
    if (!response.ok) {
        const text = await response.text();
        throw new Error(\`\${response.status} \${response.statusText}: \${text}\`);
    }
    return parseAvailableCopilotModelIds(await response.json(), allowPolicyFallback);`;

const ORIGINAL_COPILOT_POLICY_UPDATES = `    const models = Object.values(GITHUB_COPILOT_MODELS);
    for (let index = 0; index < models.length; index += COPILOT_POLICY_CONCURRENCY) {
        await Promise.all(models.slice(index, index + COPILOT_POLICY_CONCURRENCY).map(async (model) => {
            await enableGitHubCopilotModel(token, model.id, enterpriseDomain, signal);
        }));
    }`;

const PATCHED_COPILOT_POLICY_UPDATES = `    for (const model of Object.values(GITHUB_COPILOT_MODELS)) {
        await enableGitHubCopilotModel(token, model.id, enterpriseDomain, signal);
    }`;

export function patchPiGithubCopilotDeviceCodeSource(source) {
	source = stripStaleSourceMapDirective(source, "github-copilot device-code");
	const patched = patchCurrentDeviceCodeExport(source, GITHUB_COPILOT_DEVICE_CODE_MARKER);
	assertPiRuntimeCorrectnessPatchSource(patched, "githubCopilotDeviceCode", "github-copilot device-code");
	return patched;
}

export function patchPiGithubCopilotOAuthSource(source) {
	source = stripStaleSourceMapDirective(source, "github-copilot OAuth");
	if (isCurrentCopilotOAuthSource(source)) return source;
	if (source.includes(GITHUB_COPILOT_OAUTH_MARKER)) {
		assertPiRuntimeCorrectnessPatchSource(
			source,
			"githubCopilotOAuth",
			"github-copilot OAuth",
		);
		return source;
	}
	let patched = replaceRequired(
		source,
		'import { pollOAuthDeviceCodeFlow } from "./device-code.js";',
		'import { abortableSleep, pollOAuthDeviceCodeFlow } from "./device-code.js";',
		"github-copilot OAuth import",
	);
	patched = replaceRequired(
		patched,
		`const COPILOT_API_VERSION = "2026-06-01";
const COPILOT_POLICY_CONCURRENCY = 4;`,
		`const COPILOT_API_VERSION = "2026-06-01";
// ${GITHUB_COPILOT_OAUTH_MARKER}
const MAX_RETRY_AFTER_MS = 10_000;
const DEFAULT_RETRY_AFTER_MS = 1_000;`,
		"github-copilot OAuth limits",
	);
	patched = replaceRequired(
		patched,
		ORIGINAL_COPILOT_MODEL_FETCH,
		PATCHED_COPILOT_MODEL_FETCH,
		"github-copilot model discovery",
	);
	patched = replaceRequired(
		patched,
		ORIGINAL_COPILOT_POLICY_UPDATES,
		PATCHED_COPILOT_POLICY_UPDATES,
		"github-copilot policy updates",
	);
	assertPiRuntimeCorrectnessPatchSource(
		patched,
		"githubCopilotOAuth",
		"github-copilot OAuth",
	);
	return patched;
}
