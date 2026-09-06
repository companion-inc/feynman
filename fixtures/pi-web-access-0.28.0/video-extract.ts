import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve, extname, basename, join, dirname } from "node:path";
import { activityMonitor } from "./activity.ts";
import { canAttachImages } from "./feature-config.ts";
import { isGeminiWebAvailable, queryWithCookies } from "./gemini-web.ts";
import { queryGeminiApiWithVideo, getApiKey, fetchGeminiApi, getVersionedApiBase, getUploadBase, redactGeminiApiResponse } from "./gemini-api.ts";
import { extractHeadingTitle, type ExtractedContent, type ExtractOptions, type FrameResult } from "./extract.ts";
import { readExecError, trimErrorText, mapFfmpegError, getWebSearchConfigPath } from "./utils.ts";

const CONFIG_PATH = getWebSearchConfigPath();

const DEFAULT_VIDEO_PROMPT = `Extract the complete content of this video. Include:
1. Video title (infer from content if not explicit), duration
2. A brief summary (2-3 sentences)
3. Full transcript with timestamps
4. Descriptions of any code, terminal commands, diagrams, slides, or UI shown on screen

Format as markdown.`;

const VIDEO_EXTENSIONS: Record<string, string> = {
	".mp4": "video/mp4",
	".mov": "video/quicktime",
	".webm": "video/webm",
	".avi": "video/x-msvideo",
	".mpeg": "video/mpeg",
	".mpg": "video/mpeg",
	".wmv": "video/x-ms-wmv",
	".flv": "video/x-flv",
	".3gp": "video/3gpp",
	".3gpp": "video/3gpp",
};

function shouldRethrow(err: unknown): boolean {
	const message = err instanceof Error ? err.message : String(err);
	return message.startsWith("Failed to parse ");
}

interface VideoFileInfo {
	absolutePath: string;
	mimeType: string;
	sizeBytes: number;
	maxSizeBytes: number;
	withinUploadLimit: boolean;
}

interface VideoConfig {
	enabled: boolean;
	preferredModel: string;
	maxSizeMB: number;
}

function normalizePreferredModel(value: unknown, fallback: string): string {
	if (typeof value !== "string") return fallback;
	const normalized = value.trim();
	return normalized.length > 0 ? normalized : fallback;
}

function normalizeEnabled(value: unknown, fallback: boolean): boolean {
	return typeof value === "boolean" ? value : fallback;
}

function normalizeMaxSizeMB(value: unknown, fallback: number): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
	return value > 0 ? value : fallback;
}

const VIDEO_CONFIG_DEFAULTS: VideoConfig = {
	enabled: true,
	preferredModel: "gemini-3.6-flash",
	maxSizeMB: 50,
};

let cachedVideoConfig: VideoConfig | null = null;

function loadVideoConfig(): VideoConfig {
	if (cachedVideoConfig) return cachedVideoConfig;
	if (!existsSync(CONFIG_PATH)) {
		cachedVideoConfig = { ...VIDEO_CONFIG_DEFAULTS };
		return cachedVideoConfig;
	}

	const rawText = readFileSync(CONFIG_PATH, "utf-8");
	let raw: { video?: { enabled?: boolean; preferredModel?: string; maxSizeMB?: number } };
	try {
		raw = JSON.parse(rawText) as { video?: { enabled?: boolean; preferredModel?: string; maxSizeMB?: number } };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		throw new Error(`Failed to parse ${CONFIG_PATH}: ${message}`);
	}

	const v = raw.video ?? {};
	cachedVideoConfig = {
		enabled: normalizeEnabled(v.enabled, VIDEO_CONFIG_DEFAULTS.enabled),
		preferredModel: normalizePreferredModel(v.preferredModel, VIDEO_CONFIG_DEFAULTS.preferredModel),
		maxSizeMB: normalizeMaxSizeMB(v.maxSizeMB, VIDEO_CONFIG_DEFAULTS.maxSizeMB),
	};
	return cachedVideoConfig;
}

export function isVideoFile(input: string): VideoFileInfo | null {
	const config = loadVideoConfig();
	if (!config.enabled) return null;

	const isFilePath = input.startsWith("/") || input.startsWith("./") || input.startsWith("../") || input.startsWith("file://");
	if (!isFilePath) return null;

	let filePath = input;
	if (input.startsWith("file://")) {
		try {
			filePath = decodeURIComponent(new URL(input).pathname);
		} catch {
			return null;
		}
	}

	const ext = extname(filePath).toLowerCase();
	const mimeType = VIDEO_EXTENSIONS[ext];
	if (!mimeType) return null;

	const absolutePath = resolveFilePath(filePath);
	if (!absolutePath) return null;

	let stat: ReturnType<typeof statSync>;
	try {
		stat = statSync(absolutePath);
	} catch {
		return null;
	}
	if (!stat.isFile()) return null;

	const maxBytes = config.maxSizeMB * 1024 * 1024;
	return {
		absolutePath,
		mimeType,
		sizeBytes: stat.size,
		maxSizeBytes: maxBytes,
		withinUploadLimit: stat.size <= maxBytes,
	};
}

function resolveFilePath(filePath: string): string | null {
	const absolutePath = resolve(filePath);
	if (existsSync(absolutePath)) return absolutePath;

	const dir = dirname(absolutePath);
	const base = basename(absolutePath);
	if (!existsSync(dir)) return null;

	try {
		const normalizedBase = normalizeSpaces(base);
		const match = readdirSync(dir).find(f => normalizeSpaces(f) === normalizedBase);
		return match ? join(dir, match) : null;
	} catch {
		return null;
	}
}

function normalizeSpaces(s: string): string {
	return s.replace(/[\u00A0\u2000-\u200B\u202F\u205F\u3000\uFEFF]/g, " ");
}

export async function extractVideo(
	info: VideoFileInfo,
	signal?: AbortSignal,
	options?: ExtractOptions,
): Promise<ExtractedContent | null> {
	const config = loadVideoConfig();
	const effectivePrompt = options?.prompt ?? DEFAULT_VIDEO_PROMPT;
	const effectiveModel = options?.model ?? config.preferredModel;
	const displayName = basename(info.absolutePath);
	if (!info.withinUploadLimit) {
		const sizeMB = (info.sizeBytes / 1024 / 1024).toFixed(1);
		const maxSizeMB = (info.maxSizeBytes / 1024 / 1024).toFixed(1);
		const error = `Local video ${displayName} is ${sizeMB} MiB, above configured video.maxSizeMB (${maxSizeMB} MiB) for Gemini analysis. Use timestamp/frames for ffmpeg frame extraction, increase video.maxSizeMB, or compress the file.`;
		return { url: info.absolutePath, title: displayName, content: error, error };
	}
	const activityId = activityMonitor.logStart({ type: "fetch", url: `video:${displayName}` });

	const result = await tryVideoGeminiApi(info, effectivePrompt, effectiveModel, signal)
		?? await tryVideoGeminiWeb(info, effectivePrompt, effectiveModel, signal);

	if (result) {
		if (canAttachImages()) {
			const thumbnail = await extractVideoFrame(info.absolutePath);
			if (!("error" in thumbnail)) {
				result.thumbnail = thumbnail;
			}
		}
		activityMonitor.logComplete(activityId, 200);
		return result;
	}

	if (signal?.aborted) {
		activityMonitor.logComplete(activityId, 0);
		return null;
	}

	activityMonitor.logError(activityId, "all video extraction paths failed");
	return null;
}

function mapFfprobeError(err: unknown): string {
	const { code, stderr, message } = readExecError(err);
	if (code === "ENOENT") return "ffprobe is not installed. Install ffmpeg which includes ffprobe";
	const snippet = trimErrorText(stderr || message);
	return snippet ? `ffprobe failed: ${snippet}` : "ffprobe failed";
}

export async function extractVideoFrame(filePath: string, seconds: number = 1): Promise<FrameResult> {
	try {
		const buffer = execFileSync("ffmpeg", [
			"-ss", String(seconds), "-i", filePath,
			"-frames:v", "1", "-f", "image2pipe", "-vcodec", "mjpeg", "pipe:1",
		], { maxBuffer: 5 * 1024 * 1024, timeout: 10000, stdio: ["pipe", "pipe", "pipe"] });
		if (buffer.length === 0) return { error: "ffmpeg failed: empty output" };
		return { data: buffer.toString("base64"), mimeType: "image/jpeg" };
	} catch (err) {
		return { error: mapFfmpegError(err) };
	}
}

export async function getLocalVideoDuration(filePath: string): Promise<number | { error: string }> {
	try {
		const output = execFileSync("ffprobe", [
			"-v", "quiet",
			"-show_entries", "format=duration",
			"-of", "csv=p=0",
			filePath,
		], { timeout: 10000, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
		const duration = Number.parseFloat(output);
		if (!Number.isFinite(duration)) return { error: "ffprobe failed: invalid duration output" };
		return duration;
	} catch (err) {
		return { error: mapFfprobeError(err) };
	}
}

async function tryVideoGeminiWeb(
	info: VideoFileInfo,
	prompt: string,
	model: string,
	signal?: AbortSignal,
): Promise<ExtractedContent | null> {
	try {
		const cookies = await isGeminiWebAvailable();
		if (!cookies) return null;
		if (signal?.aborted) return null;

		const text = await queryWithCookies(prompt, cookies, {
			files: [info.absolutePath],
			...(model !== "gemini-3.6-flash" ? { model } : {}),
			signal,
			timeoutMs: 180000,
		});

		return {
			url: info.absolutePath,
			title: extractVideoTitle(text, info.absolutePath),
			content: text,
			error: null,
		};
	} catch (err) {
		if (shouldRethrow(err)) throw err;
		return null;
	}
}

async function tryVideoGeminiApi(
	info: VideoFileInfo,
	prompt: string,
	model: string,
	signal?: AbortSignal,
): Promise<ExtractedContent | null> {
	const apiKey = await getApiKey(signal);
	if (!apiKey) return null;
	if (signal?.aborted) return null;

	let fileName: string | null = null;
	try {
		const uploaded = await uploadToFilesApi(info, apiKey, signal);
		fileName = uploaded.name;

		await pollFileState(fileName, apiKey, signal, 120000);

		const text = await queryGeminiApiWithVideo(prompt, uploaded.uri, {
			apiKey,
			model,
			mimeType: info.mimeType,
			signal,
			timeoutMs: 120000,
		});

		return {
			url: info.absolutePath,
			title: extractVideoTitle(text, info.absolutePath),
			content: text,
			error: null,
		};
	} catch (err) {
		if (shouldRethrow(err)) throw err;
		return null;
	} finally {
		if (fileName) deleteGeminiFile(fileName, apiKey);
	}
}

async function uploadToFilesApi(
	info: VideoFileInfo,
	apiKey: string,
	signal?: AbortSignal,
): Promise<{ name: string; uri: string }> {
	const displayName = basename(info.absolutePath);

	const initRes = await fetchGeminiApi(`${getUploadBase()}/files`, {
		method: "POST",
		headers: {
			"X-Goog-Upload-Protocol": "resumable",
			"X-Goog-Upload-Command": "start",
			"X-Goog-Upload-Header-Content-Length": String(info.sizeBytes),
			"X-Goog-Upload-Header-Content-Type": info.mimeType,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ file: { display_name: displayName } }),
		signal,
	}, apiKey);

	if (!initRes.ok) {
		const text = redactGeminiApiResponse(initRes, await initRes.text(), apiKey);
		throw new Error(`File upload init failed: ${initRes.status} (${text.slice(0, 200)})`);
	}

	const uploadUrl = initRes.headers.get("x-goog-upload-url");
	if (!uploadUrl) throw new Error("No upload URL in response headers");

	const fileData = await readFile(info.absolutePath);
	const uploadRes = await fetchGeminiApi(uploadUrl, {
		method: "PUT",
		headers: {
			"Content-Length": String(info.sizeBytes),
			"X-Goog-Upload-Offset": "0",
			"X-Goog-Upload-Command": "upload, finalize",
		},
		body: fileData,
		signal,
	}, apiKey);

	if (!uploadRes.ok) {
		const text = redactGeminiApiResponse(uploadRes, await uploadRes.text(), apiKey);
		throw new Error(`File upload failed: ${uploadRes.status} (${text.slice(0, 200)})`);
	}

	const result = await uploadRes.json() as { file: { name: string; uri: string } };
	return result.file;
}

async function pollFileState(
	fileName: string,
	apiKey: string,
	signal?: AbortSignal,
	timeoutMs: number = 120000,
): Promise<void> {
	const deadline = Date.now() + timeoutMs;

	while (Date.now() < deadline) {
		if (signal?.aborted) throw new Error("Aborted");

		const res = await fetchGeminiApi(`${getVersionedApiBase()}/${fileName}`, { signal }, apiKey);
		if (!res.ok) throw new Error(`File state check failed: ${res.status}`);

		const data = await res.json() as { state: string };
		if (data.state === "ACTIVE") return;
		if (data.state === "FAILED") throw new Error("File processing failed");

		await new Promise(r => setTimeout(r, 5000));
	}

	throw new Error("File processing timed out");
}

function deleteGeminiFile(fileName: string, apiKey: string): void {
	void fetchGeminiApi(`${getVersionedApiBase()}/${fileName}`, { method: "DELETE" }, apiKey).catch((err) => {
		const message = err instanceof Error ? err.message : String(err);
		console.error(`Failed to delete Gemini file ${fileName}: ${message}`);
	});
}

function extractVideoTitle(text: string, filePath: string): string {
	return extractHeadingTitle(text) ?? basename(filePath, extname(filePath));
}
