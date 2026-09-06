import { activityMonitor } from "./activity.ts";
import { CredentialResolutionError } from "./credential-source.ts";
import { getApiKey, getVersionedApiBase, fetchGeminiApi, isGatewayConfigured, DEFAULT_MODEL } from "./gemini-api.ts";
import { isGeminiAdcAvailable } from "./gemini-adc.ts";
import { isGeminiWebAvailable, queryWithCookies } from "./gemini-web.ts";
import { extractHeadingTitle, type ExtractedContent } from "./extract.ts";

const EXTRACTION_PROMPT = `Extract the complete readable content from this URL as clean markdown.
Include the page title, all text content, code blocks, and tables.
Do not summarize — extract the full content.

URL: `;

function shouldRethrow(err: unknown): boolean {
	const message = err instanceof Error ? err.message : String(err);
	return err instanceof CredentialResolutionError || message.startsWith("Failed to parse ");
}

export async function extractWithUrlContext(
	url: string,
	signal?: AbortSignal,
): Promise<ExtractedContent | null> {
	const requestSignal = AbortSignal.any([
		AbortSignal.timeout(60000),
		...(signal ? [signal] : []),
	]);
	const apiKey = isGeminiAdcAvailable() ? null : await getApiKey(requestSignal);
	if (!apiKey && !isGatewayConfigured() && !isGeminiAdcAvailable()) return null;

	const activityId = activityMonitor.logStart({ type: "api", query: `url_context: ${url}` });

	try {
		const model = DEFAULT_MODEL;
		const body = {
			contents: [{ role: "user", parts: [{ text: EXTRACTION_PROMPT + url }] }],
			tools: [{ url_context: {} }],
		};

		const res = await fetchGeminiApi(`${getVersionedApiBase()}/models/${model}:generateContent`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
			signal: requestSignal,
		}, apiKey);

		if (!res.ok) {
			activityMonitor.logComplete(activityId, res.status);
			return null;
		}

		const data = await res.json() as UrlContextResponse;
		activityMonitor.logComplete(activityId, res.status);

		const metadata = data.candidates?.[0]?.url_context_metadata;
		if (metadata?.url_metadata?.length) {
			const status = metadata.url_metadata[0].url_retrieval_status;
			if (status === "URL_RETRIEVAL_STATUS_UNSAFE" || status === "URL_RETRIEVAL_STATUS_ERROR") {
				return null;
			}
		}

		const content = data.candidates?.[0]?.content?.parts
			?.map(p => p.text).filter(Boolean).join("\n") ?? "";

		if (!content || content.length < 50) return null;

		const title = extractTitleFromContent(content, url);
		return { url, title, content, error: null };
	} catch (err) {
		if (shouldRethrow(err)) throw err;
		const message = err instanceof Error ? err.message : String(err);
		if (message.toLowerCase().includes("abort")) {
			activityMonitor.logComplete(activityId, 0);
		} else {
			activityMonitor.logError(activityId, message);
		}
		return null;
	}
}

export async function extractWithGeminiWeb(
	url: string,
	signal?: AbortSignal,
): Promise<ExtractedContent | null> {
	const cookies = await isGeminiWebAvailable();
	if (!cookies) return null;

	const activityId = activityMonitor.logStart({ type: "api", query: `gemini_web: ${url}` });

	try {
		const text = await queryWithCookies(EXTRACTION_PROMPT + url, cookies, {
			signal,
			timeoutMs: 60000,
		});

		activityMonitor.logComplete(activityId, 200);

		if (!text || text.length < 50) return null;

		const title = extractTitleFromContent(text, url);
		return { url, title, content: text, error: null };
	} catch (err) {
		if (shouldRethrow(err)) throw err;
		const message = err instanceof Error ? err.message : String(err);
		if (message.toLowerCase().includes("abort")) {
			activityMonitor.logComplete(activityId, 0);
		} else {
			activityMonitor.logError(activityId, message);
		}
		return null;
	}
}

function extractTitleFromContent(text: string, url: string): string {
	return extractHeadingTitle(text) ?? (new URL(url).pathname.split("/").pop() || url);
}

interface UrlContextResponse {
	candidates?: Array<{
		content?: { parts?: Array<{ text?: string }> };
		url_context_metadata?: {
			url_metadata?: Array<{
				retrieved_url?: string;
				url_retrieval_status?: string;
			}>;
		};
	}>;
}
