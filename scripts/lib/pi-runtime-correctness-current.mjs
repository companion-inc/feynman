import { createHash } from "node:crypto";

// Exact published 0.85.1 OAuth source (npm gitHead d981de1229ef899957bbe968bc8dcda02a21f477),
// sans source-map trailer. Upstream now has abortable bounded 429 retry, body
// draining and sequential selected-model policy updates; do not restore the old
// all-catalog mutation. Other source shapes still enter the legacy strict patch.
export function isCurrentCopilotOAuthSource(source) {
	return createHash("sha256").update(source).digest("hex") ===
		"4a689a10de091a9aa83fca89095ed2c057f14636dab9025a25f97243ebbc5f11";
}

function replaceRequired(source, from, to, label) {
	if (source.split(from).length !== 2) throw new Error(`Unsupported Pi 0.85.1 ${label}`);
	return source.replace(from, to);
}

export function normalizeCurrentDeferredCustomMessages(source) {
	if (source.includes("    _pendingCustomMessages = [];")) {
		// Keep upstream's append helper but replace its unsafe listener-sensitive
		// drain with the existing snapshot/disposal-safe Feynman queue.
		source = replaceRequired(source, "    _pendingCustomMessages = [];\n", "", "upstream custom queue state");
		const drain = `    _flushPendingCustomMessages() {
        if (this._pendingCustomMessages.length === 0)
            return;
        const pending = this._pendingCustomMessages;
        this._pendingCustomMessages = [];
        for (const appMessage of pending) {
            this._appendCustomMessage(appMessage);
        }
    }`;
		source = replaceRequired(source, drain, "", "upstream custom message drain");
		source = source.replaceAll("this._flushPendingCustomMessages();", "this._flushPendingTurnEndMessages();");
		source = replaceRequired(source,
			`        else if (this.isStreaming) {
            // Appending now would put the message between an assistant tool call and its
            // result, which providers that validate message order reject on replay. Defer
            // to the end of the turn. Nothing is emitted yet: message events must not
            // describe messages the session tree does not contain.
            this._pendingCustomMessages.push(appMessage);
        }
        else {
            this._appendCustomMessage(appMessage);`,
			`        else {
            this.agent.state.messages.push(appMessage);
            this.sessionManager.appendCustomMessageEntry(appMessage.customType, appMessage.content, appMessage.display, appMessage.details);
            this._emit({ type: "message_start", message: appMessage });
            this._emit({ type: "message_end", message: appMessage });`,
			"upstream custom message enqueue");
	}
	return source;
}

const DEFERRED_DRAIN_START = "    _flushPendingTurnEndMessages() {\n";
const DEFERRED_RUN_GUARD = `${DEFERRED_DRAIN_START}        // Feynman: deferred context waits for complete agent-run settlement.
        if (this._isAgentRunActive)
            return;
`;

export function assertDeferredRunGuard(source) {
	if (source.split(DEFERRED_DRAIN_START).length !== 2 ||
		source.split(DEFERRED_RUN_GUARD).length !== 2) {
		throw new Error("Incomplete Pi runtime correctness patch: missing exact active-run guard");
	}
}

export function patchDeferredRunGuard(source) {
	if (source.includes("Feynman: deferred context waits for complete agent-run settlement.")) {
		assertDeferredRunGuard(source);
		return source;
	}
	// 0.85.1 introduced extra turn_end/prompt/finally drains. Keep them harmless
	// during a run; _emitAgentSettled clears the flag before the sole safe drain.
	return replaceRequired(source, DEFERRED_DRAIN_START, DEFERRED_RUN_GUARD, "deferred active-run boundary");
}

export function patchCurrentToolReleaseRedirect(source, replacement) {
	const start = source.indexOf("export async function getLatestVersion(repo) {");
	const end = source.indexOf("\n// Download a file from URL", start);
	if (start < 0 || end <= start ||
		!source.includes('const tag = new URL(location, "https://github.com").pathname.split("/").pop();')) return undefined;
	if (source.indexOf("export async function getLatestVersion(repo) {", start + 1) !== -1)
		throw new Error("Unsupported Pi 0.85.1 duplicate release resolver");
	return source.slice(0, start) + replacement + source.slice(end);
}

export function patchCurrentDeviceCodeExport(source, marker) {
	if (source.includes(marker)) return source;
	const declaration = "function abortableSleep(ms, signal, cancelMessage) {";
	const original = source.includes(`export ${declaration}`) ? `export ${declaration}` : declaration;
	return replaceRequired(source, original, `// ${marker}\nexport ${declaration}`, "abortable sleep export");
}
