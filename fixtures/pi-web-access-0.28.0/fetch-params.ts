import { normalizeProxyUrl } from "./utils.ts";

export interface FetchContentParams {
	url?: unknown;
	urls?: unknown;
	forceClone?: unknown;
	prompt?: unknown;
	timestamp?: unknown;
	frames?: unknown;
	model?: unknown;
	mode?: unknown;
	answerModel?: unknown;
	auth?: unknown;
	proxy?: unknown;
}

export interface NormalizedFetchContentParams {
	urlList: string[];
	options: {
		forceClone?: boolean;
		prompt?: string;
		timestamp?: string;
		frames?: number;
		model?: string;
		mode?: "readable" | "raw" | "answer";
		answerModel?: string;
		auth?: true | string;
		proxy?: string;
	};
}

export function normalizeFetchContentParams(params: FetchContentParams): NormalizedFetchContentParams {
	const normalizedUrls = uniqueUrls(normalizeUrlArray(params.urls));
	const urlList = normalizedUrls.length > 0 ? normalizedUrls : normalizeSingleUrl(params.url);
	const prompt = normalizeOptionalString(params.prompt);
	const timestamp = normalizeOptionalString(params.timestamp);
	const frames = normalizeOptionalFrameCount(params.frames);

	const shouldIncludeFrames = frames !== undefined && (timestamp !== undefined || frames > 1);

	const forceClone = typeof params.forceClone === "boolean" ? params.forceClone : undefined;
	const model = normalizeOptionalString(params.model);
	const mode = normalizeMode(params.mode);
	const answerModel = normalizeOptionalString(params.answerModel);
	const auth = normalizeAuth(params.auth);
	const proxy = normalizeProxy(params.proxy);

	return {
		urlList,
		options: {
			...(forceClone !== undefined ? { forceClone } : {}),
			...(prompt !== undefined ? { prompt } : {}),
			...(timestamp !== undefined ? { timestamp } : {}),
			...(shouldIncludeFrames ? { frames } : {}),
			...(model !== undefined ? { model } : {}),
			...(mode !== undefined ? { mode } : {}),
			...(answerModel !== undefined ? { answerModel } : {}),
			...(auth !== undefined ? { auth } : {}),
			...(proxy !== undefined ? { proxy } : {}),
		},
	};
}

function normalizeUrlArray(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.flatMap(normalizeSingleUrl);
}

function normalizeSingleUrl(value: unknown): string[] {
	if (typeof value !== "string") return [];
	const trimmed = value.trim();
	return trimmed ? [trimmed] : [];
}

function normalizeOptionalString(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed || undefined;
}

function normalizeMode(value: unknown): "readable" | "raw" | "answer" | undefined {
	if (value === undefined) return undefined;
	if (value === "readable" || value === "raw" || value === "answer") return value;
	throw new Error('mode must be "readable", "raw", or "answer"');
}

function normalizeAuth(value: unknown): true | string | undefined {
	if (value === undefined || value === false) return undefined;
	if (value === true) return true;
	if (typeof value === "string") {
		const trimmed = value.trim();
		if (trimmed) return trimmed;
	}
	throw new Error("auth must be a profile name, true, or false");
}

function normalizeProxy(value: unknown): string | undefined {
	if (value === undefined || value === false) return undefined;
	if (value === null) throw new Error("proxy must be an http(s) proxy URL string");
	const normalized = normalizeProxyUrl(value, "proxy");
	return normalized ?? "";
}

function normalizeOptionalFrameCount(value: unknown): number | undefined {
	if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 12) return undefined;
	return value;
}

function uniqueUrls(urls: string[]): string[] {
	return [...new Set(urls)];
}
