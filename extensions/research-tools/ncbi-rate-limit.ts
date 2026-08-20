// NCBI limits E-utilities to 3 requests/sec/IP, or 10 with an API key. Pi runs
// sibling tool calls from one assistant message concurrently, so a single
// research turn can burst well past that and take 429 responses on most of it.
//
// This gate spaces out request starts. It delays when a request begins, not how
// long it may run, so concurrent calls still overlap on the wire.

// Empirical and deliberately under the published ceilings: 400ms anonymous still
// let a live burst through, because two starts can fall inside one rolling
// second from either side of a boundary. Shared or institutional IPs may need
// more room, so NCBI_MIN_REQUEST_GAP_MS overrides the anonymous interval.
const ANONYMOUS_MIN_GAP_MS = 500;
const API_KEY_MIN_GAP_MS = 125;
const NCBI_HOSTS = new Set(["eutils.ncbi.nlm.nih.gov", "pmc.ncbi.nlm.nih.gov"]);

// Each waiter measures from the previous request's ACTUAL start, read when its
// turn comes up. Reserving absolute wake times upfront looks simpler and still
// collapses: one long tick leaves every reservation overdue, and the whole burst
// then starts at once.
let chain: Promise<void> = Promise.resolve();
let lastStartedAt = Number.NEGATIVE_INFINITY;

// Paced from what the request carries rather than from the environment, so a
// caller that does not attach the key is still paced at the anonymous rate.
function minGapMs(url: URL): number {
	const override = Number(process.env.NCBI_MIN_REQUEST_GAP_MS);
	if (Number.isFinite(override) && override >= 0) return override;
	return url.searchParams.has("api_key") ? API_KEY_MIN_GAP_MS : ANONYMOUS_MIN_GAP_MS;
}

export function withNcbiRateLimit<T>(url: URL, start: () => Promise<T>): Promise<T> {
	if (!NCBI_HOSTS.has(url.hostname)) return start();
	const slot = chain.then(async () => {
		const wait = lastStartedAt + minGapMs(url) - performance.now();
		if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
		lastStartedAt = performance.now();
	});
	// The queue holds only the waits, never the requests, so a slow or failed
	// request cannot stall a later start: start runs on the branch below.
	chain = slot;
	return slot.then(start);
}

/** Test seam: drop the recorded schedule so cases do not inherit each other's spacing. */
export function resetNcbiRateLimitForTests(): void {
	chain = Promise.resolve();
	lastStartedAt = Number.NEGATIVE_INFINITY;
}
