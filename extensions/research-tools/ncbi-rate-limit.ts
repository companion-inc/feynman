// NCBI limits E-utilities to 3 requests/sec/IP, or 10 with an API key. Pi runs
// sibling tool calls from one assistant message concurrently, so a single
// research turn can burst well past that and take 429 responses on most of it.
//
// This gate spaces out request starts. It delays when a request begins, not how
// long it may run, so concurrent calls still overlap on the wire.

const ANONYMOUS_MIN_GAP_MS = 500;
const API_KEY_MIN_GAP_MS = 125;
const NCBI_HOSTS = new Set(["eutils.ncbi.nlm.nih.gov", "pmc.ncbi.nlm.nih.gov"]);

let nextStartAt = 0;

export function withNcbiRateLimit<T>(url: URL, start: () => Promise<T>): Promise<T> {
	if (!NCBI_HOSTS.has(url.hostname)) return start();
	const now = performance.now();
	const startAt = Math.max(now, nextStartAt);
	// Paced from what the request carries rather than from the environment, so a
	// caller that does not attach the key is still paced at the anonymous rate.
	nextStartAt = startAt + (url.searchParams.has("api_key") ? API_KEY_MIN_GAP_MS : ANONYMOUS_MIN_GAP_MS);
	return new Promise((resolve) => setTimeout(resolve, startAt - now)).then(start);
}
