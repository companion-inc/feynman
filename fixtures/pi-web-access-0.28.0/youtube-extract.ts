import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { activityMonitor } from "./activity.ts";
import { canAttachImages } from "./feature-config.ts";
import { isGeminiWebAvailable, queryWithCookies } from "./gemini-web.ts";
import { isGeminiApiAvailableWithVideo, queryGeminiApiWithVideo } from "./gemini-api.ts";
import { isPerplexityAvailable, searchWithPerplexity } from "./perplexity.ts";
import { extractHeadingTitle, type ExtractedContent, type FrameResult, type VideoFrame } from "./extract.ts";
import { formatSeconds, readExecError, isTimeoutError, trimErrorText, mapFfmpegError, getWebSearchConfigPath } from "./utils.ts";

const CONFIG_PATH = getWebSearchConfigPath();

const YOUTUBE_PROMPT = `Extract the complete content of this YouTube video. Include:
1. Video title, channel name, and duration
2. A brief summary (2-3 sentences)
3. Full transcript with timestamps
4. Descriptions of any code, terminal commands, diagrams, slides, or UI shown on screen

Format as markdown.`;

const YOUTUBE_REGEX =
	/(?:(?:www\.|m\.)?youtube\.com\/(?:watch\?.*v=|shorts\/|live\/|embed\/|v\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;

function errorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

function shouldRethrow(err: unknown): boolean {
	return errorMessage(err).startsWith("Failed to parse ");
}

function addAttemptError(errors: string[], label: string, err: unknown): void {
	const message = errorMessage(err).replace(/\s+/g, " ").trim();
	if (message) errors.push(`${label}: ${message}`);
}

interface YouTubeConfig {
	enabled: boolean;
	preferredModel: string;
}

function normalizePreferredModel(value: unknown, fallback: string): string {
	if (typeof value !== "string") return fallback;
	const normalized = value.trim();
	return normalized.length > 0 ? normalized : fallback;
}

function normalizeEnabled(value: unknown, fallback: boolean): boolean {
	return typeof value === "boolean" ? value : fallback;
}

const defaults: YouTubeConfig = { enabled: true, preferredModel: "gemini-3.6-flash" };
let cachedConfig: YouTubeConfig | null = null;

function loadYouTubeConfig(): YouTubeConfig {
	if (cachedConfig) return cachedConfig;
	if (!existsSync(CONFIG_PATH)) {
		cachedConfig = { ...defaults };
		return cachedConfig;
	}

	const rawText = readFileSync(CONFIG_PATH, "utf-8");
	let raw: { youtube?: { enabled?: boolean; preferredModel?: string } };
	try {
		raw = JSON.parse(rawText) as { youtube?: { enabled?: boolean; preferredModel?: string } };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		throw new Error(`Failed to parse ${CONFIG_PATH}: ${message}`);
	}

	const yt = raw.youtube ?? {};
	cachedConfig = {
		enabled: normalizeEnabled(yt.enabled, defaults.enabled),
		preferredModel: normalizePreferredModel(yt.preferredModel, defaults.preferredModel),
	};
	return cachedConfig;
}

export function isYouTubeURL(url: string): { isYouTube: boolean; videoId: string | null } {
	try {
		const parsed = new URL(url);
		if (parsed.pathname === "/playlist") {
			return { isYouTube: false, videoId: null };
		}
	} catch {
	}

	const match = url.match(YOUTUBE_REGEX);
	if (!match) return { isYouTube: false, videoId: null };
	return { isYouTube: true, videoId: match[1] };
}

export function isYouTubeEnabled(): boolean {
	return loadYouTubeConfig().enabled;
}

export async function extractYouTube(
	url: string,
	signal?: AbortSignal,
	prompt?: string,
	model?: string,
): Promise<ExtractedContent | null> {
	const config = loadYouTubeConfig();
	const { videoId } = isYouTubeURL(url);
	const canonicalUrl = videoId
		? `https://www.youtube.com/watch?v=${videoId}`
		: url;
	const effectivePrompt = prompt ?? YOUTUBE_PROMPT;
	const effectiveModel = model ?? config.preferredModel;

	const activityId = activityMonitor.logStart({ type: "fetch", url: `youtube.com/${videoId ?? "video"}` });
	const attemptErrors: string[] = [];

	const result = await tryGeminiWeb(canonicalUrl, effectivePrompt, effectiveModel, signal, attemptErrors)
		?? await tryGeminiApi(canonicalUrl, effectivePrompt, effectiveModel, signal, attemptErrors)
		?? await tryPerplexity(url, effectivePrompt, signal, attemptErrors);

	if (result) {
		result.url = url;
		if (!result.error && videoId && canAttachImages()) {
			const thumb = await fetchYouTubeThumbnail(videoId);
			if (thumb) result.thumbnail = thumb;
		}
		activityMonitor.logComplete(activityId, result.error ? 0 : 200);
		return result;
	}

	if (signal?.aborted) {
		activityMonitor.logComplete(activityId, 0);
		return null;
	}

	const error = attemptErrors.length > 0
		? ["Could not extract YouTube video content.", "", ...attemptErrors.map(message => `- ${message}`)].join("\n")
		: "Could not extract YouTube video content. Sign into Google in a supported Chromium browser for automatic access, or set GEMINI_API_KEY.";
	activityMonitor.logError(activityId, error);
	return { url, title: "", content: "", error };
}

type StreamInfo = { streamUrl: string; duration: number | null };
type StreamResult = StreamInfo | { error: string };

function mapYtDlpError(err: unknown): string {
	const { code, stderr, message } = readExecError(err);
	if (code === "ENOENT") return "yt-dlp is not installed. Install with: brew install yt-dlp";
	if (isTimeoutError(err)) return "yt-dlp timed out fetching video info";
	const lower = stderr.toLowerCase();
	if (lower.includes("private")) return "Video is private or unavailable";
	if (lower.includes("sign in")) return "Video is age-restricted and requires authentication";
	if (lower.includes("not available")) return "Video is unavailable in your region or has been removed";
	if (lower.includes("live")) return "Cannot extract frames from a live stream";
	const snippet = trimErrorText(stderr || message);
	return snippet ? `yt-dlp failed: ${snippet}` : "yt-dlp failed";
}

export async function getYouTubeStreamInfo(videoId: string): Promise<StreamResult> {
	try {
		const output = execFileSync("yt-dlp", [
			"--print", "duration",
			"-g", `https://www.youtube.com/watch?v=${videoId}`,
		], { timeout: 15000, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
		const lines = output.split(/\r?\n/);
		const rawDuration = lines[0]?.trim();
		const streamUrl = lines[1]?.trim();
		if (!streamUrl) return { error: "yt-dlp failed: missing stream URL" };
		const parsedDuration = rawDuration && rawDuration !== "NA" ? Number.parseFloat(rawDuration) : NaN;
		const duration = Number.isFinite(parsedDuration) ? parsedDuration : null;
		return { streamUrl, duration };
	} catch (err) {
		return { error: mapYtDlpError(err) };
	}
}

async function extractFrameFromStream(streamUrl: string, seconds: number): Promise<FrameResult> {
	try {
		const buffer = execFileSync("ffmpeg", [
			"-ss", String(seconds), "-i", streamUrl,
			"-frames:v", "1", "-f", "image2pipe", "-vcodec", "mjpeg", "pipe:1",
		], { maxBuffer: 5 * 1024 * 1024, timeout: 30000, stdio: ["pipe", "pipe", "pipe"] });
		if (buffer.length === 0) return { error: "ffmpeg failed: empty output" };
		return { data: buffer.toString("base64"), mimeType: "image/jpeg" };
	} catch (err) {
		return { error: mapFfmpegError(err) };
	}
}

export async function extractYouTubeFrame(
	videoId: string,
	seconds: number,
	streamInfo?: StreamInfo,
): Promise<FrameResult> {
	const info = streamInfo ?? await getYouTubeStreamInfo(videoId);
	if ("error" in info) return info;
	return extractFrameFromStream(info.streamUrl, seconds);
}

export async function extractYouTubeFrames(
	videoId: string,
	timestamps: number[],
	streamInfo?: StreamInfo,
): Promise<{ frames: VideoFrame[]; duration: number | null; error: string | null }> {
	const info = streamInfo ?? await getYouTubeStreamInfo(videoId);
	if ("error" in info) return { frames: [], duration: null, error: info.error };
	const results = await Promise.all(timestamps.map(async (t) => {
		const frame = await extractFrameFromStream(info.streamUrl, t);
		if ("error" in frame) return { error: frame.error };
		return { ...frame, timestamp: formatSeconds(t) };
	}));
	const frames = results.filter((f): f is VideoFrame => "data" in f);
	const errorResult = results.find((f): f is { error: string } => "error" in f);
	return { frames, duration: info.duration, error: frames.length === 0 && errorResult ? errorResult.error : null };
}

export async function fetchYouTubeThumbnail(videoId: string): Promise<{ data: string; mimeType: string } | null> {
	try {
		const res = await fetch(`https://img.youtube.com/vi/${videoId}/hqdefault.jpg`, {
			signal: AbortSignal.timeout(5000),
		});
		if (!res.ok) return null;
		const buffer = Buffer.from(await res.arrayBuffer());
		if (buffer.length === 0) return null;
		return { data: buffer.toString("base64"), mimeType: "image/jpeg" };
	} catch {
		return null;
	}
}

async function tryGeminiWeb(
	url: string,
	prompt: string,
	model: string,
	signal: AbortSignal | undefined,
	attemptErrors: string[],
): Promise<ExtractedContent | null> {
	try {
		const cookies = await isGeminiWebAvailable();
		if (!cookies) return null;

		if (signal?.aborted) return null;

		const text = await queryWithCookies(prompt, cookies, {
			youtubeUrl: url,
			...(model !== "gemini-3.6-flash" ? { model } : {}),
			signal,
			timeoutMs: 120000,
		});

		return {
			url,
			title: extractHeadingTitle(text) ?? "YouTube Video",
			content: text,
			error: null,
		};
	} catch (err) {
		if (shouldRethrow(err)) throw err;
		if (!signal?.aborted) addAttemptError(attemptErrors, "Gemini Web", err);
		return null;
	}
}

async function tryGeminiApi(
	url: string,
	prompt: string,
	model: string,
	signal: AbortSignal | undefined,
	attemptErrors: string[],
): Promise<ExtractedContent | null> {
	try {
		if (!isGeminiApiAvailableWithVideo()) return null;

		if (signal?.aborted) return null;

		const text = await queryGeminiApiWithVideo(prompt, url, {
			model,
			signal,
			timeoutMs: 120000,
		});

		return {
			url,
			title: extractHeadingTitle(text) ?? "YouTube Video",
			content: text,
			error: null,
		};
	} catch (err) {
		if (shouldRethrow(err)) throw err;
		if (!signal?.aborted) addAttemptError(attemptErrors, "Gemini API", err);
		return null;
	}
}

async function tryPerplexity(
	url: string,
	prompt: string,
	signal: AbortSignal | undefined,
	attemptErrors: string[],
): Promise<ExtractedContent | null> {
	try {
		if (signal?.aborted || !isPerplexityAvailable()) return null;

		const perplexityQuery = prompt === YOUTUBE_PROMPT
			? `Summarize this YouTube video in detail: ${url}`
			: `${prompt} YouTube video: ${url}`;

		const { answer } = await searchWithPerplexity(
			perplexityQuery,
			{ signal },
		);

		if (!answer) return null;

		const content =
			`# Video Summary (via Perplexity)\n\n${answer}\n\n` +
			`*Full video understanding requires Gemini access. Set GEMINI_API_KEY or sign into Google in a supported Chromium browser.*`;

		return {
			url,
			title: "Video Summary (via Perplexity)",
			content,
			error: null,
		};
	} catch (err) {
		if (shouldRethrow(err)) throw err;
		if (!signal?.aborted) addAttemptError(attemptErrors, "Perplexity", err);
		return null;
	}
}
