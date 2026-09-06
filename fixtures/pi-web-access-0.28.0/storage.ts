import { closeSync, constants, fchmodSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, type Stats, unlinkSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ExtractedContent } from "./extract.ts";
import type { SearchResult } from "./perplexity.ts";
import { getWebSearchConfigDir } from "./utils.ts";

const CACHE_TTL_MS = 60 * 60 * 1000;
const FETCH_CACHE_DIR = "web-search-cache";
const FETCH_CACHE_VERSION = 1;
const CACHE_KEY_PATTERN = /^[A-Za-z0-9_-]+\.json$/;
const CACHE_TMP_PATTERN = /^[A-Za-z0-9_-]+\.json\.\d+\.\d+(?:\.[a-f0-9]{32})?\.tmp$/;
const CACHE_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const MAX_METADATA_TEXT = 8192;
const DEFAULT_CACHE_LIMITS = { maxEntries: 128, maxBytes: 128 * 1024 * 1024 };
const O_DIRECTORY = process.platform === "win32" ? 0 : (constants.O_DIRECTORY ?? 0);
const O_NOFOLLOW = process.platform === "win32" ? 0 : (constants.O_NOFOLLOW ?? 0);

interface FetchCacheLimits {
	maxEntries: number;
	maxBytes: number;
}

interface CacheFile {
	name: string;
	size: number;
	mtimeMs: number;
	dev: number;
	ino: number;
}

export interface QueryResultData {
	query: string;
	answer: string;
	results: SearchResult[];
	error: string | null;
	provider?: string;
}

interface FetchCacheRef {
	version: typeof FETCH_CACHE_VERSION;
	key: string;
	storedAt: number;
}

interface StoredFetchUrlMetadata {
	url: string;
	title: string;
	error: string | null;
	contentLength: number;
	mimeType?: string;
	status?: number;
	duration?: number;
}

export interface StoredSearchData {
	id: string;
	type: "search" | "fetch" | "research";
	timestamp: number;
	queries?: QueryResultData[];
	urls?: ExtractedContent[];
	artifact?: unknown;
	fetchCache?: FetchCacheRef;
	urlMetadata?: StoredFetchUrlMetadata[];
	fetchCacheError?: string;
}

const storedResults = new Map<string, StoredSearchData>();

export function generateId(): string {
	return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function getFetchCacheDir(): string {
	return join(getWebSearchConfigDir(), FETCH_CACHE_DIR);
}

function fetchCachePath(key: string): string | null {
	if (!CACHE_KEY_PATTERN.test(key)) return null;
	return join(getFetchCacheDir(), key);
}

function cacheKeyForId(id: string): string {
	if (!CACHE_ID_PATTERN.test(id)) {
		throw new Error(`Invalid fetched content cache id: ${id}`);
	}
	return `${id}.json`;
}

function truncateMetadataText(value: string | undefined): string {
	if (!value) return "";
	return value.length > MAX_METADATA_TEXT ? `${value.slice(0, MAX_METADATA_TEXT)}...` : value;
}

function metadataForUrls(urls: ExtractedContent[]): StoredFetchUrlMetadata[] {
	return urls.map((url) => ({
		url: truncateMetadataText(url.url),
		title: truncateMetadataText(url.title),
		error: url.error ? truncateMetadataText(url.error) : null,
		contentLength: url.content.length,
		...(url.mimeType ? { mimeType: truncateMetadataText(url.mimeType) } : {}),
		...(typeof url.status === "number" ? { status: url.status } : {}),
		...(typeof url.duration === "number" ? { duration: url.duration } : {}),
	}));
}

function isFetchCacheRef(value: unknown): value is FetchCacheRef {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const ref = value as Record<string, unknown>;
	return ref.version === FETCH_CACHE_VERSION &&
		typeof ref.key === "string" && CACHE_KEY_PATTERN.test(ref.key) &&
		typeof ref.storedAt === "number" && Number.isFinite(ref.storedAt);
}

function isStoredFetchUrlMetadata(value: unknown): value is StoredFetchUrlMetadata {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const meta = value as Record<string, unknown>;
	return typeof meta.url === "string" &&
		typeof meta.title === "string" &&
		(meta.error === null || typeof meta.error === "string") &&
		typeof meta.contentLength === "number" && Number.isFinite(meta.contentLength) && meta.contentLength >= 0 &&
		(meta.mimeType === undefined || typeof meta.mimeType === "string") &&
		(meta.status === undefined || typeof meta.status === "number") &&
		(meta.duration === undefined || typeof meta.duration === "number");
}

function isInlineFetchedUrl(value: unknown): value is ExtractedContent {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const url = value as Record<string, unknown>;
	return typeof url.url === "string" &&
		typeof url.title === "string" &&
		typeof url.content === "string" &&
		(url.error === null || typeof url.error === "string");
}

function isInlineFetchData(data: StoredSearchData): data is StoredSearchData & { urls: ExtractedContent[] } {
	return data.type === "fetch" && Array.isArray(data.urls) && data.urls.every(isInlineFetchedUrl);
}

function cacheLimits(limits?: Partial<FetchCacheLimits>): FetchCacheLimits {
	const resolved = {
		maxEntries: limits?.maxEntries ?? DEFAULT_CACHE_LIMITS.maxEntries,
		maxBytes: limits?.maxBytes ?? DEFAULT_CACHE_LIMITS.maxBytes,
	};
	if (!Number.isFinite(resolved.maxEntries) || !Number.isInteger(resolved.maxEntries) || resolved.maxEntries <= 0 ||
		!Number.isFinite(resolved.maxBytes) || !Number.isInteger(resolved.maxBytes) || resolved.maxBytes <= 0) {
		throw new Error("Fetched content cache limits must be finite positive integers");
	}
	return resolved;
}

function enforceDirectoryMode(fd: number): void {
	try {
		fchmodSync(fd, 0o700);
	} catch (err) {
		if (process.platform !== "win32") throw err;
	}
}

function enforceFileMode(fd: number): void {
	try {
		fchmodSync(fd, 0o600);
	} catch (err) {
		if (process.platform !== "win32") throw err;
	}
}

function safeFetchCacheDir(create: true): string;
function safeFetchCacheDir(create: false): string | null;
function safeFetchCacheDir(create: boolean): string | null {
	const dir = getFetchCacheDir();
	if (create) mkdirSync(dir, { recursive: true, mode: 0o700 });
	let before: Stats;
	try {
		before = lstatSync(dir);
	} catch (err) {
		if (!create && (err as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw err;
	}
	if (before.isSymbolicLink() || !before.isDirectory()) {
		throw new Error("Fetched content cache path is not a safe directory");
	}
	if (process.platform === "win32") {
		const after = lstatSync(dir);
		if (after.isSymbolicLink() || !after.isDirectory() || after.dev !== before.dev || after.ino !== before.ino) {
			throw new Error("Fetched content cache directory changed while securing it");
		}
		return dir;
	}
	let fd: number | null = null;
	try {
		fd = openSync(dir, constants.O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
		const opened = fstatSync(fd);
		if (!opened.isDirectory() || opened.dev !== before.dev || opened.ino !== before.ino) {
			throw new Error("Fetched content cache directory changed while opening");
		}
		enforceDirectoryMode(fd);
		closeSync(fd);
		fd = null;
		const after = lstatSync(dir);
		if (after.isSymbolicLink() || !after.isDirectory() || after.dev !== before.dev || after.ino !== before.ino) {
			throw new Error("Fetched content cache directory changed while securing it");
		}
		return dir;
	} finally {
		if (fd !== null) try { closeSync(fd); } catch {}
	}
}

function openRegularFile(path: string): { fd: number; info: Stats } {
	const before = lstatSync(path);
	if (before.isSymbolicLink() || !before.isFile()) throw new Error("Fetched content cache entry is not a regular file");
	const fd = openSync(path, constants.O_RDONLY | O_NOFOLLOW);
	try {
		const info = fstatSync(fd);
		if (!info.isFile() || info.dev !== before.dev || info.ino !== before.ino) {
			throw new Error("Fetched content cache entry changed while opening");
		}
		return { fd, info };
	} catch (err) {
		closeSync(fd);
		throw err;
	}
}

type CacheUnlinkResult = "removed" | "missing" | "changed" | "error";

function unlinkCacheFile(dir: string, file: CacheFile): CacheUnlinkResult {
	try {
		const root = lstatSync(dir);
		if (root.isSymbolicLink() || !root.isDirectory()) return "changed";
		const path = join(dir, file.name);
		let current: Stats;
		try {
			current = lstatSync(path);
		} catch (err) {
			return (err as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "error";
		}
		if (current.isSymbolicLink() || !current.isFile() || current.dev !== file.dev || current.ino !== file.ino) return "changed";
		try {
			unlinkSync(path);
			return "removed";
		} catch (err) {
			return (err as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "error";
		}
	} catch {
		return "error";
	}
}

function pruneFetchCache(now: number, limits: FetchCacheLimits, preferredKey?: string, reservation?: { key: string; bytes: number }): boolean {
	let dir: string | null;
	try {
		dir = safeFetchCacheDir(false);
	} catch {
		return false;
	}
	if (!dir) return true;

	let entries: string[];
	try {
		entries = readdirSync(dir);
	} catch {
		return false;
	}

	const files: CacheFile[] = [];
	for (const entry of entries) {
		if (!CACHE_KEY_PATTERN.test(entry) && !CACHE_TMP_PATTERN.test(entry)) continue;
		const path = join(dir, entry);
		let opened: ReturnType<typeof openRegularFile>;
		try {
			opened = openRegularFile(path);
		} catch {
			continue;
		}
		try {
			enforceFileMode(opened.fd);
		} catch {
			closeSync(opened.fd);
			continue;
		}
		closeSync(opened.fd);
		const file = { name: entry, size: opened.info.size, mtimeMs: opened.info.mtimeMs, dev: opened.info.dev, ino: opened.info.ino };
		if (now - file.mtimeMs >= CACHE_TTL_MS) {
			const removed = unlinkCacheFile(dir, file);
			if (removed !== "removed" && removed !== "missing") return false;
			continue;
		}
		if (CACHE_KEY_PATTERN.test(entry)) files.push(file);
	}

	files.sort((a, b) => a.mtimeMs - b.mtimeMs || a.name.localeCompare(b.name));
	const projectedUsage = () => {
		const replaced = reservation ? files.find((file) => file.name === reservation.key) : undefined;
		return {
			entries: files.length + (reservation && !replaced ? 1 : 0),
			bytes: files.reduce((total, file) => total + file.size, 0) + (reservation ? reservation.bytes - (replaced?.size ?? 0) : 0),
		};
	};
	const attempted = new Set<string>();
	let usage = projectedUsage();
	while (usage.entries > limits.maxEntries || usage.bytes > limits.maxBytes) {
		const index = files.findIndex((file) => file.name !== preferredKey && !attempted.has(file.name));
		if (index < 0) break;
		const file = files[index];
		attempted.add(file.name);
		const removed = unlinkCacheFile(dir, file);
		if (removed === "removed" || removed === "missing") files.splice(index, 1);
		usage = projectedUsage();
	}
	return usage.entries <= limits.maxEntries && usage.bytes <= limits.maxBytes;
}

function writeFetchCache(data: StoredSearchData & { urls: ExtractedContent[] }): FetchCacheRef {
	const limits = DEFAULT_CACHE_LIMITS;
	const serialized = JSON.stringify(data);
	const size = Buffer.byteLength(serialized);
	if (size > limits.maxBytes) throw new Error(`Fetched content cache entry exceeds ${limits.maxBytes} bytes`);

	const dir = safeFetchCacheDir(true);
	const key = cacheKeyForId(data.id);
	if (!pruneFetchCache(Date.now(), limits, key, { key, bytes: size })) {
		throw new Error("Fetched content cache could not reserve space for a new entry");
	}
	const finalPath = join(dir, key);
	const tmpName = `${key}.${process.pid}.${Date.now()}.${randomBytes(16).toString("hex")}.tmp`;
	const tmpPath = join(dir, tmpName);
	let fd: number | null = null;
	let tmpFile: CacheFile | null = null;
	let renamed = false;
	try {
		fd = openSync(tmpPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | O_NOFOLLOW, 0o600);
		const tmpInfo = fstatSync(fd);
		tmpFile = { name: tmpName, size: tmpInfo.size, mtimeMs: tmpInfo.mtimeMs, dev: tmpInfo.dev, ino: tmpInfo.ino };
		enforceFileMode(fd);
		writeFileSync(fd, serialized, "utf8");
		fsyncSync(fd);
		closeSync(fd);
		fd = null;
		safeFetchCacheDir(false);
		renameSync(tmpPath, finalPath);
		renamed = true;
		const written = lstatSync(finalPath);
		if (!written.isFile() || written.dev !== tmpFile.dev || written.ino !== tmpFile.ino) {
			throw new Error("Fetched content cache entry changed after writing");
		}
		if (!pruneFetchCache(Date.now(), limits, key)) {
			throw new Error("Fetched content cache could not meet its limits after writing");
		}
	} catch (err) {
		if (fd !== null) try { closeSync(fd); } catch {}
		if (tmpFile) unlinkCacheFile(dir, { ...tmpFile, name: renamed ? key : tmpName });
		throw err;
	}
	return { version: FETCH_CACHE_VERSION, key, storedAt: Date.now() };
}

function cacheWriteError(err: unknown): string {
	const message = err instanceof Error ? err.message : String(err);
	return `Failed to write fetched content cache: ${message}`;
}

function createFetchSessionData(data: StoredSearchData & { urls: ExtractedContent[] }, ref: FetchCacheRef | null, cacheError?: string): StoredSearchData {
	return {
		id: data.id,
		type: "fetch",
		timestamp: data.timestamp,
		urlMetadata: metadataForUrls(data.urls),
		...(ref ? { fetchCache: ref } : {}),
		...(cacheError ? { fetchCacheError: truncateMetadataText(cacheError) } : {}),
	};
}

function fetchUrlMetadata(data: StoredSearchData): StoredFetchUrlMetadata[] {
	if (data.urlMetadata) return data.urlMetadata;
	return isInlineFetchData(data) ? metadataForUrls(data.urls) : [];
}

function unavailableFetchData(data: StoredSearchData, reason: string): StoredSearchData {
	return {
		...data,
		urls: fetchUrlMetadata(data).map((meta) => ({
			url: meta.url,
			title: meta.title,
			content: "",
			error: reason,
			...(meta.mimeType ? { mimeType: meta.mimeType } : {}),
			...(typeof meta.status === "number" ? { status: meta.status } : {}),
			...(typeof meta.duration === "number" ? { duration: meta.duration } : {}),
		})),
	};
}

function readCachedFetchData(data: StoredSearchData, now = Date.now()): StoredSearchData {
	if (data.type !== "fetch") return data;
	if (now - data.timestamp >= CACHE_TTL_MS) {
		return unavailableFetchData(data, "Cached fetched content is missing or expired");
	}
	if (isInlineFetchData(data)) return data;
	if (!data.fetchCache) {
		return unavailableFetchData(data, data.fetchCacheError ?? "Cached fetched content is unavailable");
	}
	const path = fetchCachePath(data.fetchCache.key);
	if (!path) return unavailableFetchData(data, "Cached fetched content is missing or expired");
	let fd: number | null = null;
	try {
		if (!safeFetchCacheDir(false)) return unavailableFetchData(data, "Cached fetched content is missing or expired");
		const opened = openRegularFile(path);
		fd = opened.fd;
		enforceFileMode(fd);
		const parsed: unknown = JSON.parse(readFileSync(fd, "utf8"));
		if (!isValidStoredData(parsed) || parsed.type !== "fetch" || parsed.id !== data.id || !isInlineFetchData(parsed)) {
			return unavailableFetchData(data, "Cached fetched content is invalid");
		}
		return { ...parsed, fetchCache: data.fetchCache, urlMetadata: data.urlMetadata };
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") {
			return unavailableFetchData(data, "Cached fetched content is missing or expired");
		}
		const message = err instanceof Error ? err.message : String(err);
		return unavailableFetchData(data, `Cached fetched content could not be read: ${message}`);
	} finally {
		if (fd !== null) try { closeSync(fd); } catch {}
	}
}

export function pruneExpiredFetchCache(now = Date.now(), requestedLimits?: Partial<FetchCacheLimits>): void {
	const limits = cacheLimits(requestedLimits);
	try { pruneFetchCache(now, limits); } catch {}
}

export function storeResult(id: string, data: StoredSearchData): void {
	storedResults.set(id, data);
}

export function storeFetchedContentResult(id: string, data: StoredSearchData & { type: "fetch"; urls: ExtractedContent[] }): StoredSearchData {
	let ref: FetchCacheRef | null = null;
	let cacheError: string | undefined;
	try {
		ref = writeFetchCache(data);
	} catch (err) {
		cacheError = cacheWriteError(err);
	}
	storedResults.set(id, ref ? { ...data, fetchCache: ref, urlMetadata: metadataForUrls(data.urls) } : { ...data, fetchCacheError: cacheError });
	return createFetchSessionData(data, ref, cacheError);
}

export function getResult(id: string): StoredSearchData | null {
	const data = storedResults.get(id);
	if (!data) return null;
	const loaded = readCachedFetchData(data);
	if (loaded !== data) storedResults.set(id, loaded);
	return loaded;
}

export function getAllResults(): StoredSearchData[] {
	return Array.from(storedResults.values());
}

export function deleteResult(id: string): boolean {
	const data = storedResults.get(id);
	if (data?.fetchCache) {
		try {
			const dir = safeFetchCacheDir(false);
			const path = fetchCachePath(data.fetchCache.key);
			if (dir && path) {
				const info = lstatSync(path);
				if (!info.isSymbolicLink() && info.isFile()) {
					unlinkCacheFile(dir, { name: data.fetchCache.key, size: info.size, mtimeMs: info.mtimeMs, dev: info.dev, ino: info.ino });
				}
			}
		} catch {}
	}
	return storedResults.delete(id);
}

export function clearResults(): void {
	storedResults.clear();
}

function isValidStoredData(data: unknown): data is StoredSearchData {
	if (!data || typeof data !== "object") return false;
	const d = data as Record<string, unknown>;
	if (typeof d.id !== "string" || !d.id) return false;
	if (d.type !== "search" && d.type !== "fetch" && d.type !== "research") return false;
	if (typeof d.timestamp !== "number") return false;
	if (d.type === "search" && !Array.isArray(d.queries)) return false;
	if (d.type === "fetch") {
		if (Array.isArray(d.urls)) return d.urls.every(isInlineFetchedUrl);
		if (!Array.isArray(d.urlMetadata) || !d.urlMetadata.every(isStoredFetchUrlMetadata)) return false;
		return d.fetchCache === undefined ? d.fetchCacheError === undefined || typeof d.fetchCacheError === "string" : isFetchCacheRef(d.fetchCache);
	}
	if (d.type === "research" && (!d.artifact || typeof d.artifact !== "object")) return false;
	return true;
}

export function restoreFromSession(ctx: ExtensionContext): void {
	storedResults.clear();
	const now = Date.now();
	pruneExpiredFetchCache(now);

	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type === "custom" && entry.customType === "web-search-results") {
			const data = entry.data;
			if (isValidStoredData(data) && now - data.timestamp < CACHE_TTL_MS) {
				storedResults.set(data.id, data);
			}
		}
	}
}
