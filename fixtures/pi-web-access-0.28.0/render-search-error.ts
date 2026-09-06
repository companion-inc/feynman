/**
 * Pure, dependency-free renderer for web_search error / cancel results.
 *
 * WHY THIS EXISTS: the upstream web_search `renderResult` (index.ts) early-returns
 * a SINGLE line on the error/cancel path, before the collapsed/expanded branch.
 * That makes Ctrl+O (app.tools.expand) flip `expanded` with zero visible effect —
 * a dead-end with no diagnostics. It also discards the partial search results
 * gathered before the cancel, so even an expandable view would have nothing to show.
 *
 * This module is the single source of truth for the error/cancel render PLAN
 * (plain strings, no theme/ANSI), so it is unit-testable without pi's runtime
 * (@mariozechner/pi-tui Text/Box). index.ts.renderResult delegates to it and only
 * applies theme colors + creates Text/Box components.
 *
 * Contract for callers:
 *   const plan = buildSearchErrorPlan(details);
 *   if (plan === null) ... // not an error/cancel result; use the normal renderer
 *   // collapsed: [statusLine, ...plan.collapsed, plan.expandHint].filter(Boolean)
 *   // expanded:  plan.expanded
 */

export interface CancelledQueryDetail {
	query: string;
	provider: string | null;
	error: string | null; // null = completed ok; string = per-query error
	resultCount: number;
}

export interface SearchErrorDetails {
	/** The headline error/cancel message, e.g. "Search curation cancelled (stale)." */
	error?: string;
	cancelled?: boolean;
	cancelReason?: string;
	/** Did the curator browser page ever establish a connection? */
	browserConnected?: boolean;
	/** Age (ms) of the last curator heartbeat at cancel time, if known. */
	lastHeartbeatAgeMs?: number | null;
	/** Total queries the user requested. */
	queryCount?: number;
	/** Partial per-query results gathered before the cancel/error. */
	cancelledQueries?: CancelledQueryDetail[];
	/** Arbitrary extra diagnostic lines (e.g. URLs, response id) for non-cancel errors
	 * like fetch_content / get_search_content. Shown in the expanded view. */
	extraLines?: string[];
}

export interface SearchErrorPlan {
	/** Full diagnostic block, shown when expanded (Ctrl+O). */
	expanded: string[];
	/** Short preview lines, shown under the headline when collapsed. */
	collapsed: string[];
	/** The "... (N more lines, ctrl+o to expand)" hint, or null if nothing is hidden. */
	expandHint: string | null;
}

function truncate(text: string, max: number): string {
	return text.length > max ? text.slice(0, max - 1) + "\u2026" : text;
}

/**
 * Build the error/cancel render plan. Returns null when `details` carries no
 * error/cancel signal (so the caller falls through to the normal success renderer).
 */
export function buildSearchErrorPlan(details: SearchErrorDetails | undefined | null): SearchErrorPlan | null {
	if (!details || (!details.error && !details.cancelled)) {
		return null;
	}

	const headline = details.error ?? "Search cancelled.";
	const queries = details.cancelledQueries ?? [];
	const queryCount = typeof details.queryCount === "number" && details.queryCount > 0
		? details.queryCount
		: queries.length;
	const done = queries.length;
	const errored = queries.filter(q => q.error).length;

	// Rich diagnostics only make sense when there is something to diagnose: a
	// cancelled/curator result with partial data, OR a non-cancel error that carries
	// extra detail (urls/response-id for fetch_content, the failed query for
	// get_search_content). A bare argument error (e.g. "No URL
	// provided") stays a clean single line -- no noise.
	const extras = details.extraLines ?? [];
	const rich = details.cancelled === true || queries.length > 0 || extras.length > 0;
	if (!rich) {
		return { expanded: [headline], collapsed: [], expandHint: null };
	}

	// --- diagnostics block (expanded): curator/cancel-specific only. For non-cancel
	// errors (fetch_content/get_search_content) there is no browser or
	// query-curation state to report, so we skip this block and show only Details. ---
	const expanded: string[] = [headline, ""];

	if (details.cancelled === true || queries.length > 0) {
		const diag: string[] = [];
		if (details.cancelled) {
			diag.push(`cancel reason   : ${details.cancelReason ?? "unknown"}`);
		}
		// Browser connection state — the most common stale cause (page never opened).
		const browserLabel = details.browserConnected === undefined
			? "unknown"
			: details.browserConnected
				? "connected"
				: "never connected";
		diag.push(`browser         : ${browserLabel}`);
		if (typeof details.lastHeartbeatAgeMs === "number" && Number.isFinite(details.lastHeartbeatAgeMs)) {
			diag.push(`last heartbeat  : ${Math.round(details.lastHeartbeatAgeMs / 1000)}s ago`);
		}
		if (queryCount > 0) {
			diag.push(`queries started : ${queryCount}`);
			diag.push(`queries done    : ${done}`);
			if (errored > 0) diag.push(`queries errored : ${errored}`);
		}
		expanded.push("Diagnostics:");
		for (const line of diag) expanded.push(`  ${line}`);
	}

	// --- per-query results gathered before cancel ---
	if (queries.length > 0) {
		expanded.push("");
		expanded.push("Per-query results (gathered before cancel):");
		for (const q of queries) {
			const dq = truncate(q.query, 52);
			const tag = q.error ? "[err] " : "[ok]  ";
			const provider = q.provider ? ` (${q.provider})` : "";
			const tail = q.error
				? `\u2014 ${truncate(q.error, 60)}`
				: `\u2014 ${q.resultCount} source${q.resultCount === 1 ? "" : "s"}`;
			expanded.push(`  ${tag}"${dq}"${provider} ${tail}`);
		}
	}

	// --- arbitrary extra detail (non-cancel errors) ---
	if (extras.length > 0) {
		expanded.push("");
		expanded.push("Details:");
		for (const e of extras) expanded.push(`  ${e}`);
	}

	// --- collapsed preview ---
	const collapsed: string[] = [];
	const parts: string[] = [];
	if (queryCount > 0) {
		parts.push(`${done}/${queryCount} queries completed`);
	}
	if (errored > 0) {
		parts.push(`${errored} errored`);
	}
	if (details.browserConnected === false) {
		parts.push("browser never connected");
	} else if (details.cancelReason) {
		parts.push(`reason: ${details.cancelReason}`);
	}
	if (parts.length > 0) {
		collapsed.push(parts.join("; ") + ".");
	}
	// For non-cancel errors with extra detail, preview the first detail line.
	if (collapsed.length === 0 && extras.length > 0) {
		for (const e of extras.slice(0, 2)) {
			collapsed.push(truncate(e, 100));
		}
	}

	// --- expand hint ---
	const hiddenLines = Math.max(0, expanded.length - (1 + collapsed.length)); // headline + preview shown when collapsed
	const expandHint = hiddenLines > 0
		? `... (${hiddenLines} more lines, ${expanded.length} total, ctrl+o to expand)`
		: null;

	return { expanded, collapsed, expandHint };
}
