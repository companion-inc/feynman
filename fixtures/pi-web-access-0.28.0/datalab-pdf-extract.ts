import { existsSync, readFileSync } from "node:fs";
import {
	hasCredentialSource,
	resolveCredential,
	redactCredential,
} from "./credential-source.ts";
import { getWebSearchConfigPath } from "./utils.ts";

const DEFAULT_API_HOST = "https://www.datalab.to";
const API_PREFIX = "/api/v1";
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_POLL_INTERVAL_MS = 1_500;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_ERROR_BODY_BYTES = 300;
const CLEANUP_TIMEOUT_MS = 5_000;
const CONFIG_PATH = getWebSearchConfigPath();

export type DatalabMode = "fast" | "balanced" | "accurate";
export type DatalabProcessingLocation = "eu" | "us";

export const DATALAB_MODE_VALUES = new Set<DatalabMode>([
	"fast",
	"balanced",
	"accurate",
]);
export const DATALAB_LOCATION_VALUES = new Set<DatalabProcessingLocation>([
	"eu",
	"us",
]);
export const DEFAULT_DATALAB_MODE: DatalabMode = "balanced";
export const DEFAULT_PROCESSING_LOCATION: DatalabProcessingLocation = "us";
export const DEFAULT_DATALAB_TIMEOUT_MS = DEFAULT_TIMEOUT_MS;

interface DatalabConfig {
	datalabApiKey?: unknown;
}

let cachedConfig: DatalabConfig | null = null;

function loadConfig(): DatalabConfig {
	if (cachedConfig) return cachedConfig;
	if (!existsSync(CONFIG_PATH)) {
		cachedConfig = {};
		return cachedConfig;
	}

	const rawText = readFileSync(CONFIG_PATH, "utf-8");
	try {
		cachedConfig = JSON.parse(rawText) as DatalabConfig;
		return cachedConfig;
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		throw new Error(`Failed to parse ${CONFIG_PATH}: ${message}`);
	}
}

function normalizeString(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const normalized = value.trim();
	return normalized.length > 0 ? normalized : null;
}

function normalizeFileId(value: unknown): string | null {
	if (typeof value === "number" && Number.isFinite(value)) return String(value);
	return normalizeString(value);
}

export function isDatalabApiAvailable(): boolean {
	return hasCredentialSource({
		provider: "Datalab",
		configuredValue: loadConfig().datalabApiKey,
		environmentValue: process.env.DATALAB_API_KEY,
	});
}

export async function getDatalabApiKey(
	signal?: AbortSignal,
): Promise<string | null> {
	return resolveCredential({
		provider: "Datalab",
		configuredValue: loadConfig().datalabApiKey,
		environmentValue: process.env.DATALAB_API_KEY,
		signal,
	});
}

export function getDatalabApiBase(): string {
	const normalized = normalizeString(process.env.DATALAB_API_BASE)?.replace(
		/\/+$/,
		"",
	);
	return normalized || `${DEFAULT_API_HOST}${API_PREFIX}`;
}

/**
 * Resolve the processing region. US storage and processing is the default;
 * set `DATALAB_PROCESSING_LOCATION=eu` to use EU data residency at Datalab's
 * documented 1.25× usage rate. Only `eu` and `us` are supported by the API.
 * Config errors are thrown with a `Failed to parse` prefix so the
 * extraction fallback chain treats them as fatal, mirroring how malformed
 * web-search config is handled elsewhere.
 */
export function getDatalabProcessingLocation(): DatalabProcessingLocation {
	const value =
		normalizeString(process.env.DATALAB_PROCESSING_LOCATION) ??
		DEFAULT_PROCESSING_LOCATION;
	const normalized = value.toLowerCase() as DatalabProcessingLocation;
	if (!DATALAB_LOCATION_VALUES.has(normalized)) {
		throw new Error(
			`Failed to parse DATALAB_PROCESSING_LOCATION: expected "eu" or "us", got "${value}"`,
		);
	}
	return normalized;
}

export function normalizeDatalabMode(value: unknown): DatalabMode {
	const raw = normalizeString(value);
	if (!raw) return DEFAULT_DATALAB_MODE;
	const normalized = raw.toLowerCase() as DatalabMode;
	if (DATALAB_MODE_VALUES.has(normalized)) return normalized;
	throw new Error(
		`Failed to parse datalab mode: expected "fast", "balanced", or "accurate", got "${value}"`,
	);
}

export interface DatalabPDFExtractOptions {
	maxPages: number;
	title: string;
	signal?: AbortSignal;
	timeoutMs?: number;
	mode?: DatalabMode;
	processingLocation?: DatalabProcessingLocation;
}

export interface DatalabPDFExtractResult {
	markdown: string;
	pages: number;
	parseQualityScore?: number;
}

interface DatalabUploadRequest {
	file_id?: unknown;
	upload_url?: unknown;
	reference?: unknown;
}

interface DatalabConfirmResponse {
	file_id?: unknown;
	reference?: unknown;
}

interface DatalabConversionState {
	status?: unknown;
	success?: unknown;
	request_check_url?: unknown;
	markdown?: unknown;
	page_count?: unknown;
	parse_quality_score?: unknown;
	error?: unknown;
}

/**
 * Convert a PDF buffer to Markdown through the Datalab hosted API.
 *
 * Datalab converts documents with a dedicated extraction engine (Marker),
 * which preserves tables, multi-column reading order, headings, and math
 * where the local `unpdf` fallback only produces flattened text. Conversion
 * is deterministic (no LLM transcription drift), and `accurate` mode handles
 * scanned pages. Completed responses may include a `parse_quality_score` (0–5)
 * for quality gating. Billing is per processed page; the free tier includes a
 * monthly credit (see README) so light use costs nothing.
 *
 * The flow is:
 *   1. request a presigned upload URL for the selected processing region,
 *   2. PUT the PDF bytes directly to storage,
 *   3. confirm the upload to obtain a `datalab://` reference,
 *   4. submit the conversion with that reference, then
 *   5. poll the returned `request_check_url` until `complete` or `failed`.
 *
 * The processing region is fixed at the upload step (US by default; set
 * `DATALAB_PROCESSING_LOCATION=eu` for EU data residency). The convert step
 * deliberately omits `processing_location` because the API rejects multipart form data that
 * carries it; the server processes the file from the storage region it was
 * uploaded to. The uploaded file is deleted best-effort after conversion.
 * The caller's signal and a shared deadline bound the whole exchange.
 */
export async function extractPDFViaDatalab(
	buffer: ArrayBuffer,
	options: DatalabPDFExtractOptions,
): Promise<DatalabPDFExtractResult> {
	options.signal?.throwIfAborted();
	const apiKey = await getDatalabApiKey(options.signal);
	options.signal?.throwIfAborted();
	if (!apiKey) {
		throw new Error(
			"Datalab PDF conversion requires a configured Datalab API key",
		);
	}

	const mode = options.mode ?? normalizeDatalabMode(process.env.DATALAB_MODE);
	const processingLocation =
		options.processingLocation ?? getDatalabProcessingLocation();
	const timeoutMs =
		typeof options.timeoutMs === "number" &&
		Number.isFinite(options.timeoutMs) &&
		options.timeoutMs > 0
			? Math.floor(options.timeoutMs)
			: DEFAULT_TIMEOUT_MS;
	const deadline = Date.now() + timeoutMs;

	const upload = await requestUploadUrl({
		apiKey,
		title: options.title,
		processingLocation,
		signal: options.signal,
		deadline,
	});
	if (typeof upload.upload_url !== "string" || !upload.upload_url) {
		throw new Error("Datalab PDF conversion failed: missing upload_url");
	}
	const uploadFileId = normalizeFileId(upload.file_id);
	if (!uploadFileId) {
		throw new Error("Datalab PDF conversion failed: missing file_id");
	}

	let fileId = uploadFileId;
	let reference = normalizeString(upload.reference);

	try {
		const put = await fetchDatalab(
			upload.upload_url,
			{
				method: "PUT",
				headers: { "content-type": "application/pdf" },
				body: new Blob([buffer], { type: "application/pdf" }),
				signal: withTimeout(options.signal, remaining(deadline)),
			},
			apiKey,
		);
		if (!put.ok) {
			throw new Error(
				`Datalab PDF upload failed: HTTP ${put.status} ${put.statusText}`,
			);
		}

		const confirmed = await confirmUpload(
			apiKey,
			String(fileId),
			options.signal,
			deadline,
		);
		fileId = normalizeFileId(confirmed.file_id) ?? fileId;
		reference = normalizeString(confirmed.reference) ?? reference;
		if (!reference) {
			throw new Error("Datalab PDF conversion failed: missing file reference");
		}

		const form = new FormData();
		form.append("file_url", reference);
		form.append("output_format", "markdown");
		form.append("mode", mode);
		form.append("max_pages", String(options.maxPages));
		form.append("paginate", "true");

		// The conversion itself must NOT repeat processing_location: the API
		// rejects multipart form data carrying processing_location (HTTP 403).
		// The region was already fixed when the presigned upload was issued for
		// storage in the selected region, so the server processes the file
		// wherever it was stored (US by default; use the env override for EU).

		const submit = await fetchDatalab(
			`${getDatalabApiBase()}/convert`,
			{
				method: "POST",
				headers: { "x-api-key": apiKey },
				body: form,
				signal: withTimeout(options.signal, remaining(deadline)),
			},
			apiKey,
		);
		const state = await readJsonResponse(submit, apiKey);

		// The submit response is an acceptance ack ({ success: true,
		// request_check_url }) with no status field and no markdown; only the
		// polled result carries a status. Key on status, never on success.
		if (state.status === "complete") return toResult(state);
		if (state.status === "failed") {
			throw new Error(
				`Datalab PDF conversion failed: ${state.error ?? "unknown error"}`,
			);
		}

		const checkUrl = normalizeCheckUrl(state.request_check_url);
		while (Date.now() < deadline) {
			await sleep(
				Math.min(DEFAULT_POLL_INTERVAL_MS, remaining(deadline)),
				options.signal,
			);
			if (Date.now() >= deadline) break;
			const poll = await fetchDatalab(
				checkUrl,
				{
					method: "GET",
					headers: { "x-api-key": apiKey },
					signal: withTimeout(options.signal, remaining(deadline)),
				},
				apiKey,
			);
			const next = await readJsonResponse(poll, apiKey);
			if (next.status === "complete") return toResult(next);
			if (next.status === "failed") {
				throw new Error(
					`Datalab PDF conversion failed: ${next.error ?? "unknown error"}`,
				);
			}
		}

		throw new Error("Datalab PDF conversion timed out");
	} finally {
		// File deletion is best-effort. Do not extend a caller's timeout or
		// cancellation while waiting for a remote cleanup request.
		void deleteDatalabFile(apiKey, fileId);
	}
}

async function requestUploadUrl(options: {
	apiKey: string;
	title: string;
	processingLocation: DatalabProcessingLocation;
	signal: AbortSignal | undefined;
	deadline: number;
}): Promise<DatalabUploadRequest> {
	const { apiKey, title, processingLocation, signal, deadline } = options;
	const response = await fetchDatalab(
		`${getDatalabApiBase()}/files/upload`,
		{
			method: "POST",
			headers: {
				"x-api-key": apiKey,
				"content-type": "application/json",
			},
			body: JSON.stringify({
				filename: `${datalabFilename(title)}.pdf`,
				content_type: "application/pdf",
				processing_location: processingLocation,
			}),
			signal: withTimeout(signal, remaining(deadline)),
		},
		apiKey,
	);
	return readJsonResponse(response, apiKey);
}

async function confirmUpload(
	apiKey: string,
	fileId: string,
	signal: AbortSignal | undefined,
	deadline: number,
): Promise<DatalabConfirmResponse> {
	const response = await fetchDatalab(
		`${getDatalabApiBase()}/files/${encodeURIComponent(fileId)}/confirm`,
		{
			method: "GET",
			headers: { "x-api-key": apiKey },
			signal: withTimeout(signal, remaining(deadline)),
		},
		apiKey,
	);
	return readJsonResponse(response, apiKey);
}

async function deleteDatalabFile(
	apiKey: string,
	fileId: string,
): Promise<void> {
	try {
		await fetchDatalab(
			`${getDatalabApiBase()}/files/${encodeURIComponent(fileId)}`,
			{
				method: "DELETE",
				headers: { "x-api-key": apiKey },
				signal: AbortSignal.timeout(CLEANUP_TIMEOUT_MS),
			},
			apiKey,
		);
	} catch {
		// Best-effort cleanup; a leftover file is not worth failing the conversion.
	}
}

function toResult(state: DatalabConversionState): DatalabPDFExtractResult {
	const markdown = normalizeString(state.markdown);
	if (!markdown) {
		throw new Error("Datalab PDF conversion returned empty markdown");
	}
	const quality = state.parse_quality_score;
	return {
		markdown,
		pages: numericField(state.page_count) ?? countPageMarkers(markdown),
		...(typeof quality === "number" && Number.isFinite(quality)
			? { parseQualityScore: quality }
			: {}),
	};
}

function numericField(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) && value > 0
		? Math.floor(value)
		: null;
}

function countPageMarkers(markdown: string): number {
	return [...markdown.matchAll(/^<!-- Page (\d+) -->$/gm)].length;
}

function normalizeCheckUrl(value: unknown): string {
	if (typeof value !== "string" || !value.trim()) {
		throw new Error("Datalab PDF conversion failed: missing request_check_url");
	}
	const apiBase = getDatalabApiUrl();
	let checkUrl: URL;
	try {
		checkUrl = new URL(value.trim(), apiBase);
	} catch {
		throw new Error("Datalab PDF conversion failed: invalid request_check_url");
	}
	if (checkUrl.origin !== apiBase.origin) {
		throw new Error(
			"Datalab PDF conversion failed: request_check_url has an unexpected origin",
		);
	}
	return checkUrl.toString();
}

function getDatalabApiUrl(): URL {
	try {
		return new URL(getDatalabApiBase());
	} catch {
		throw new Error(
			"Failed to parse DATALAB_API_BASE: expected an absolute URL",
		);
	}
}

function remaining(deadline: number): number {
	return Math.max(1, deadline - Date.now());
}

function withTimeout(
	signal: AbortSignal | undefined,
	timeoutMs: number,
): AbortSignal {
	const timeout = AbortSignal.timeout(timeoutMs);
	return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		let timer: ReturnType<typeof setTimeout>;
		const cleanup = () => signal?.removeEventListener("abort", onAbort);
		const onTimeout = () => {
			cleanup();
			resolve();
		};
		const onAbort = () => {
			clearTimeout(timer);
			cleanup();
			reject(signal?.reason);
		};

		if (signal?.aborted) {
			onAbort();
			return;
		}
		timer = setTimeout(onTimeout, ms);
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}

async function fetchDatalab(
	url: string,
	init: RequestInit,
	apiKey: string,
): Promise<Response> {
	try {
		return await fetch(url, { ...init, redirect: init.redirect ?? "error" });
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const redacted = redactCredential(message, apiKey);
		if (redacted === message) throw error;
		const redactedError = new Error(redacted);
		if (error instanceof Error) redactedError.name = error.name;
		throw redactedError;
	}
}

async function readJsonResponse(
	response: Response,
	apiKey: string,
): Promise<Record<string, unknown>> {
	const text = await readResponseText(response);
	if (!response.ok) {
		const detail = text.trim().slice(0, MAX_ERROR_BODY_BYTES);
		const message = detail
			? `Datalab PDF conversion failed: HTTP ${response.status} ${response.statusText}: ${detail}`
			: `Datalab PDF conversion failed: HTTP ${response.status} ${response.statusText}`;
		throw new Error(redactCredential(message, apiKey));
	}
	return parseJsonRecord(text);
}

function parseJsonRecord(text: string): Record<string, unknown> {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch (error) {
		throw new Error("Datalab PDF conversion returned invalid JSON", { cause: error });
	}
	if (Object.prototype.toString.call(parsed) !== "[object Object]") {
		throw new Error("Datalab PDF conversion returned invalid JSON object");
	}
	return parsed as Record<string, unknown>;
}

async function readResponseText(response: Response): Promise<string> {
	const contentLength = Number(response.headers.get("content-length"));
	if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
		throw new Error("Datalab PDF conversion response too large");
	}
	if (!response.body) return "";

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	const chunks: string[] = [];
	let bytesRead = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			bytesRead += value.byteLength;
			if (bytesRead > MAX_RESPONSE_BYTES) {
				try {
					await reader.cancel();
				} catch {
					// The response is already too large; cancellation is best-effort.
				}
				throw new Error("Datalab PDF conversion response too large");
			}
			chunks.push(decoder.decode(value, { stream: true }));
		}
		chunks.push(decoder.decode());
		return chunks.join("");
	} finally {
		reader.releaseLock();
	}
}

function datalabFilename(title: string): string {
	return (
		title
			.toLowerCase()
			.replace(/[^a-z0-9\s-]/g, "")
			.replace(/\s+/g, "-")
			.replace(/-+/g, "-")
			.replace(/^-|-$/g, "")
			.slice(0, 60) || "document"
	);
}
