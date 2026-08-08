// Issue #214: alphaXiv's answer_pdf_queries tool now requires
// { paper: string, queries: string[] }. Bundled alpha-hub@0.1.3 still sends
// { urls, queries }, so MCP rejects the call with -32602.

const LEGACY_ASK_ARGS = "callTool('answer_pdf_queries', { urls: [url], queries: [query] })";
const CURRENT_ASK_ARGS = "callTool('answer_pdf_queries', { paper: url, queries: [query] })";

export function patchAlphaHubAskSource(source) {
	let patched = source;

	if (patched.includes(LEGACY_ASK_ARGS)) {
		patched = patched.replace(LEGACY_ASK_ARGS, CURRENT_ASK_ARGS);
	}

	return patched;
}
