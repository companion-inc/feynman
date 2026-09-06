import { AsyncLocalStorage } from "node:async_hooks";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, hostname, tmpdir } from "node:os";
import { join } from "node:path";

let cachedWebSearchConfigDir: string | undefined;

export function getWebSearchConfigDir(): string {
	if (cachedWebSearchConfigDir) return cachedWebSearchConfigDir;

	const explicitDir = process.env.PI_CODING_AGENT_DIR;
	if (explicitDir) return cachedWebSearchConfigDir = explicitDir;

	const xdgConfigHome = process.env.XDG_CONFIG_HOME;
	if (xdgConfigHome) {
		const xdgDir = join(xdgConfigHome, "pi");
		if (existsSync(join(xdgDir, "web-search.json"))) return cachedWebSearchConfigDir = xdgDir;

		const legacyDir = join(homedir(), ".pi");
		if (existsSync(join(legacyDir, "web-search.json"))) return cachedWebSearchConfigDir = legacyDir;
		return cachedWebSearchConfigDir = xdgDir;
	}
	return cachedWebSearchConfigDir = join(homedir(), ".pi");
}

export function getWebSearchConfigPath(): string {
	return join(getWebSearchConfigDir(), "web-search.json");
}

interface ApiBaseUrlOptions {
	configKey: string;
	configuredValue: unknown;
	defaultValue: string;
	environmentKey: string;
	environmentValue: string | undefined;
}

export function resolveApiBaseUrl(options: ApiBaseUrlOptions): string {
	const fromEnvironment = options.environmentValue !== undefined;
	const value = fromEnvironment ? options.environmentValue : options.configuredValue;
	if (value === undefined) return options.defaultValue;

	const source = fromEnvironment
		? options.environmentKey
		: `${options.configKey} in ${getWebSearchConfigPath()}`;
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`${source} must be an absolute HTTP(S) URL`);
	}

	let url: URL;
	try {
		url = new URL(value.trim());
	} catch {
		throw new Error(`${source} must be an absolute HTTP(S) URL`);
	}
	if (url.protocol !== "https:") {
		throw new Error(`${source} must be an absolute HTTPS URL`);
	}
	if (url.username || url.password) {
		throw new Error(`${source} must not include credentials`);
	}
	if (url.search || url.hash) {
		throw new Error(`${source} must not include query parameters or fragments`);
	}

	url.search = "";
	url.hash = "";
	url.pathname = url.pathname.replace(/\/+$/, "");
	return url.toString().replace(/\/+$/, "");
}

const API_REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const API_REQUEST_BODY_HEADERS = ["Content-Encoding", "Content-Language", "Content-Location", "Content-Type"];
const MAX_API_REDIRECTS = 5;

export async function fetchWithCredentialRedirects(
	url: string,
	init: RequestInit,
	credentialHeaders: readonly string[],
): Promise<Response> {
	let current = new URL(url);
	let requestInit = init;

	for (let redirects = 0; ; redirects++) {
		const response = await fetch(current, { ...requestInit, redirect: "manual" });
		if (!API_REDIRECT_STATUSES.has(response.status)) return response;

		const location = response.headers.get("location");
		if (!location) return response;
		if (redirects === MAX_API_REDIRECTS) {
			throw new Error(`Too many API redirects from ${url}`);
		}

		const next = new URL(location, current);
		if (next.protocol !== "http:" && next.protocol !== "https:") {
			throw new Error(`API redirect from ${current.origin} must use HTTP(S)`);
		}
		const method = requestInit.method?.toUpperCase() ?? "GET";
		if (
			((response.status === 301 || response.status === 302) && method === "POST")
			|| (response.status === 303 && method !== "GET" && method !== "HEAD")
		) {
			const headers = new Headers(requestInit.headers);
			for (const name of API_REQUEST_BODY_HEADERS) headers.delete(name);
			const { body: _body, ...withoutBody } = requestInit;
			requestInit = { ...withoutBody, method: "GET", headers };
		}
		if (next.origin !== current.origin) {
			const headers = new Headers(requestInit.headers);
			for (const name of credentialHeaders) headers.delete(name);
			requestInit = { ...requestInit, headers };
		}
		current = next;
	}
}

export interface CuratorNetworkConfig {
	/** Whether remote access was opted into via curatorRemote. */
	enabled: boolean;
	host: string;
	bind: string;
}

const LOCAL_CURATOR_NETWORK_DEFAULTS: CuratorNetworkConfig = { enabled: false, host: "localhost", bind: "127.0.0.1" };

function trimmedString(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

/** Resolves the curator server bind address and URL host from `curatorRemote`. */
export function resolveCuratorNetworkConfig(): CuratorNetworkConfig {
	const configPath = getWebSearchConfigPath();
	if (!existsSync(configPath)) return LOCAL_CURATOR_NETWORK_DEFAULTS;

	let raw: unknown;
	try {
		raw = JSON.parse(readFileSync(configPath, "utf-8"));
	} catch {
		return LOCAL_CURATOR_NETWORK_DEFAULTS;
	}
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return LOCAL_CURATOR_NETWORK_DEFAULTS;

	const curatorRemote = (raw as Record<string, unknown>).curatorRemote;
	if (curatorRemote === true) return { enabled: true, host: hostname(), bind: "0.0.0.0" };

	if (curatorRemote && typeof curatorRemote === "object" && !Array.isArray(curatorRemote)) {
		const obj = curatorRemote as Record<string, unknown>;
		return {
			enabled: true,
			host: trimmedString(obj.host) ?? hostname(),
			bind: trimmedString(obj.bind) ?? "0.0.0.0",
		};
	}

	return LOCAL_CURATOR_NETWORK_DEFAULTS;
}

export function formatSeconds(s: number): string {
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	const sec = s % 60;
	if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
	return `${m}:${String(sec).padStart(2, "0")}`;
}

export function readExecError(err: unknown): { code?: string; stderr: string; message: string } {
	if (!err || typeof err !== "object") {
		return { stderr: "", message: String(err) };
	}
	const code = (err as { code?: string }).code;
	const message = (err as { message?: string }).message ?? "";
	const stderrRaw = (err as { stderr?: Buffer | string }).stderr;
	const stderr = Buffer.isBuffer(stderrRaw)
		? stderrRaw.toString("utf-8")
		: typeof stderrRaw === "string"
			? stderrRaw
			: "";
	return { code, stderr, message };
}

export function isTimeoutError(err: unknown): boolean {
	if (!err || typeof err !== "object") return false;
	if ((err as { killed?: boolean }).killed) return true;
	const name = (err as { name?: string }).name;
	const code = (err as { code?: string }).code;
	const message = (err as { message?: string }).message ?? "";
	return name === "AbortError" || code === "ETIMEDOUT" || message.toLowerCase().includes("timed out");
}

export function trimErrorText(text: string): string {
	return text.replace(/\s+/g, " ").trim().slice(0, 200);
}

export function mapFfmpegError(err: unknown): string {
	const { code, stderr, message } = readExecError(err);
	if (code === "ENOENT") return "ffmpeg is not installed. Install with: brew install ffmpeg";
	if (isTimeoutError(err)) return "ffmpeg timed out extracting frame";
	if (stderr.includes("403")) return "Stream URL returned 403 — may have expired, try again";
	const snippet = trimErrorText(stderr || message);
	return snippet ? `ffmpeg failed: ${snippet}` : "ffmpeg failed";
}

const proxyStorage = new AsyncLocalStorage<string | null>();

export function normalizeProxyUrl(value: unknown, source: string): string | null {
	if (value === undefined || value === null) return null;
	if (typeof value !== "string") throw new Error(`${source} must be an http(s) proxy URL string`);
	const trimmed = value.trim();
	if (!trimmed) return null;
	let parsed: URL;
	try {
		parsed = new URL(trimmed);
	} catch {
		throw new Error(`${source} must be a valid proxy URL: ${JSON.stringify(trimmed)}`);
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		throw new Error(`${source} must use the http:// or https:// scheme: ${trimmed}`);
	}
	if (!parsed.hostname) throw new Error(`${source} must include a proxy host: ${trimmed}`);
	parsed.hash = "";
	parsed.search = "";
	return parsed.toString();
}

function redactProxyUrl(value: string): string {
	const parsed = new URL(value);
	if (parsed.username) parsed.username = "redacted";
	if (parsed.password) parsed.password = "redacted";
	return parsed.toString();
}

function loadConfiguredProxy(): string | null {
	let configured: unknown;
	const path = getWebSearchConfigPath();
	if (existsSync(path)) {
		let raw: unknown;
		try {
			raw = JSON.parse(readFileSync(path, "utf-8"));
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			throw new Error(`Failed to load proxy config from ${path}: ${message}`);
		}
		if (raw && typeof raw === "object" && !Array.isArray(raw)) configured = (raw as { proxy?: unknown }).proxy;
	}
	if (configured === undefined) return null;
	return normalizeProxyUrl(configured, `proxy in ${getWebSearchConfigPath()}`);
}

export function runWithProxy<T>(proxy: string | undefined, fn: () => T): T {
	if (proxy === undefined) {
		const configured = loadConfiguredProxy();
		if (configured === null) return fn();
		return proxyStorage.run(configured, fn);
	}
	const normalized = normalizeProxyUrl(proxy, "proxy");
	return proxyStorage.run(normalized, fn);
}

export function getActiveProxy(): string | null {
	return proxyStorage.getStore() ?? null;
}

export function hasScopedProxyDecision(): boolean {
	return proxyStorage.getStore() !== undefined;
}

function noProxyEntryMatches(hostname: string, entry: string): boolean {
	if (!entry) return false;
	if (entry === "*") return true;
	let host = entry;
	if (host.startsWith("[")) {
		const close = host.indexOf("]");
		if (close > 0) host = host.slice(0, close + 1);
	} else {
		const colon = host.lastIndexOf(":");
		if (colon > -1 && /^\d+$/.test(host.slice(colon + 1))) host = host.slice(0, colon);
	}
	host = host.toLowerCase().replace(/^\[|\]$/g, "");
	if (!host) return false;
	return hostname === host || hostname.endsWith(host.startsWith(".") ? host : `.${host}`);
}

/** True when a URL must NOT be sent through the active proxy. */
export function isProxyBypassedUrl(url: URL): boolean {
	const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
	if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname === "127.0.0.1" || hostname === "::1") return true;
	const noProxy = process.env.NO_PROXY || process.env.no_proxy;
	if (noProxy && noProxy.split(",").some((entry) => noProxyEntryMatches(hostname, entry.trim()))) return true;
	return false;
}

export interface ProxiedRequestInit extends RequestInit {
	/** Caller-supplied proxy; bypasses AsyncLocalStorage for pLimit-safe contexts. */
	__proxy?: string;
}

interface ProxiedFetch {
	(input: RequestInfo | URL, init?: ProxiedRequestInit): Promise<Response>;
	__piWebAccessProxyFetch?: boolean;
}

/** Wraps globalThis.fetch so every http(s) call routes through curl while a proxy is active. Idempotent. */
export function installGlobalProxyFetch(): void {
	const current = globalThis.fetch as ProxiedFetch;
	if (typeof current !== "function" || current.__piWebAccessProxyFetch === true) return;
	const nativeFetch = current;
	const wrapped: ProxiedFetch = ((input: RequestInfo | URL, init?: ProxiedRequestInit) => {
		// Prefer caller-attached __proxy (survives pLimit context loss) over AsyncLocalStorage.
		const proxy = init?.__proxy ?? getActiveProxy();
		if (!proxy) return nativeFetch(input, init);
		let url: URL | null = null;
		try {
			url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
		} catch {
			url = null;
		}
		if (!url || (url.protocol !== "http:" && url.protocol !== "https:") || isProxyBypassedUrl(url)) {
			return nativeFetch(input, init);
		}
		return fetchViaCurl(url, init ?? {}, proxy);
	});
	wrapped.__piWebAccessProxyFetch = true;
	globalThis.fetch = wrapped;
}

function parseHeaderDump(dump: string): { status: number; statusText: string; headers: Array<[string, string]> } {
	const blocks = dump.split(/\r?\n\r?\n/).filter((block) => /^HTTP\/[\d.]+\s+\d{3}/.test(block.trim()));
	const block = (blocks.length > 0 ? blocks[blocks.length - 1] : "").trim();
	const lines = block.split(/\r?\n/);
	let status = 0;
	let statusText = "";
	const headers: Array<[string, string]> = [];
	for (const line of lines) {
		const match = /^HTTP\/[\d.]+\s+(\d{3})(?:\s+(.*))?$/.exec(line.trim());
		if (match) {
			status = Number(match[1]);
			statusText = match[2] ?? "";
			headers.length = 0;
			continue;
		}
		const separator = line.indexOf(":");
		if (separator > 0) {
			const name = line.slice(0, separator).trim();
			if (name.toLowerCase() === "content-encoding" || name.toLowerCase() === "content-length") continue;
			headers.push([name, line.slice(separator + 1).trim()]);
		}
	}
	return { status, statusText, headers };
}

class CurlTransportError extends Error {}

async function fetchViaCurl(url: URL, init: RequestInit, proxyUrl: string): Promise<Response> {
	let current = url;
	let currentInit = init;
	for (let redirects = 0; ; redirects++) {
		const response = await fetchViaCurlOnce(current, currentInit, proxyUrl);
		const location = response.headers.get("location");
		if (!location || ![301, 302, 303, 307, 308].includes(response.status)) {
			if (redirects > 0) Object.defineProperty(response, "redirected", { value: true, configurable: true });
			return response;
		}
		if (currentInit.redirect === "manual") return response;
		if (currentInit.redirect === "error") throw new TypeError(`Proxy fetch redirect blocked from ${current.toString()}`);
		if (redirects === 20) throw new Error(`Too many proxy redirects from ${url.toString()}`);

		const next = new URL(location, current);
		if (next.protocol !== "http:" && next.protocol !== "https:") throw new Error(`Proxy redirect from ${current.origin} must use HTTP(S)`);

		let headers = new Headers(currentInit.headers);
		let nextInit: RequestInit;
		const method = currentInit.method?.toUpperCase() ?? "GET";
		if (((response.status === 301 || response.status === 302) && method === "POST") || (response.status === 303 && method !== "GET" && method !== "HEAD")) {
			for (const name of ["Content-Encoding", "Content-Language", "Content-Location", "Content-Type"]) headers.delete(name);
			const { body: _body, ...withoutBody } = currentInit;
			nextInit = { ...withoutBody, method: "GET", headers };
		} else {
			nextInit = { ...currentInit, headers };
		}

		if (next.origin !== current.origin) {
			headers = new Headers();
			nextInit = { ...nextInit, headers };
		}
		current = next;
		currentInit = nextInit;
	}
}

async function fetchViaCurlOnce(url: URL, init: RequestInit, proxyUrl: string): Promise<Response> {
	const method = (init.method ?? "GET").toUpperCase();
	const headers = new Headers(init.headers);

	const dir = await mkdtemp(join(tmpdir(), "pi-web-access-proxy-"));
	const headerFile = join(dir, "headers");
	const bodyFile = join(dir, "body");
	const requestBodyFile = join(dir, "request-body");

	const args: string[] = [
		"--silent",
		"--show-error",
		"--compressed",
		"--connect-timeout", "20",
		"-x", proxyUrl,
		"-D", headerFile,
		"--output", bodyFile,
		"--write-out", "%{json}",
	];

	if (method !== "GET" && method !== "HEAD") args.push("-X", method);

	for (const [name, value] of headers.entries()) {
		if (value === "") continue;
		args.push("-H", `${name}: ${value}`);
	}

	const body = init.body;
	if (body !== undefined && body !== null) {
		let buffer: Buffer;
		if (typeof body === "string") buffer = Buffer.from(body, "utf-8");
		else if (body instanceof URLSearchParams) buffer = Buffer.from(body.toString(), "utf-8");
		else if (body instanceof ArrayBuffer) buffer = Buffer.from(body);
		else if (ArrayBuffer.isView(body)) buffer = Buffer.from(body.buffer, body.byteOffset, body.byteLength);
		else throw new Error(`Unsupported request body type for proxy fetch: ${typeof body}`);
		await writeFile(requestBodyFile, buffer);
		args.push("--data-binary", `@${requestBodyFile}`);
		if (method === "GET") args.unshift("-X", "GET");
	}

	args.push(url.toString());

	const signal = init.signal ?? null;
	let stdout: string;
	try {
		stdout = await new Promise<string>((resolve, reject) => {
			if (signal?.aborted) {
				reject(new DOMException("The operation was aborted.", "AbortError"));
				return;
			}
			const child = spawn("curl", args, { windowsHide: true });
			let out = "";
			let stderr = "";
			const onAbort = () => { try { child.kill(); } catch {} };
			if (signal) {
				signal.addEventListener("abort", onAbort, { once: true });
			}
			child.stdout?.on("data", (chunk: Buffer) => { out += chunk.toString("utf-8"); });
			child.stderr?.on("data", (chunk: Buffer) => { if (stderr.length < 4096) stderr += chunk.toString("utf-8"); });
			child.once("error", (err: NodeJS.ErrnoException) => {
				signal?.removeEventListener("abort", onAbort);
				reject(new CurlTransportError(err.code === "ENOENT"
					? "curl executable not found on PATH; proxy transport requires curl"
					: `curl failed to start: ${err.message}`));
			});
			child.once("close", (code) => {
				signal?.removeEventListener("abort", onAbort);
				if (signal?.aborted) return reject(new DOMException("The operation was aborted.", "AbortError"));
				if (code !== 0 && !out.trim()) {
					return reject(new CurlTransportError(`curl exited with code ${code ?? "unknown"} via ${redactProxyUrl(proxyUrl)}${stderr.trim() ? `: ${stderr.trim()}` : ""}`));
				}
				resolve(out);
			});
		});
	} catch (err) {
		await rm(dir, { recursive: true, force: true }).catch(() => {});
		if (err instanceof CurlTransportError) throw new Error(err.message);
		throw err;
	}

	let bodyBuffer = Buffer.alloc(0);
	let dump = "";
	try {
		[dump, bodyBuffer] = await Promise.all([readFile(headerFile, "utf-8"), readFile(bodyFile)]);
	} catch {
		// HEAD or empty responses may not produce output files.
	} finally {
		await rm(dir, { recursive: true, force: true }).catch(() => {});
	}

	const { status, statusText, headers: responseHeaders } = parseHeaderDump(dump);
	if (status === 0) {
		throw new Error(`Proxy fetch to ${url.toString()} via ${redactProxyUrl(proxyUrl)} returned no HTTP status`);
	}

	let finalUrl = url.toString();
	let redirected = false;
	try {
		const trimmed = stdout.trim();
		if (trimmed.startsWith("{")) {
			const writeOut = JSON.parse(trimmed) as { url_effective?: string; num_redirects?: number };
			if (writeOut.url_effective) finalUrl = writeOut.url_effective;
			redirected = (writeOut.num_redirects ?? 0) > 0;
		}
	} catch {
		// Older curl without %{json}; the header dump already provided the status.
	}

	const nullBody = status === 204 || status === 205 || status === 304;
	const response = new Response(nullBody ? null : new Uint8Array(bodyBuffer), {
		status,
		statusText: statusText || undefined,
		headers: new Headers(responseHeaders),
	});
	Object.defineProperty(response, "url", { value: finalUrl, configurable: true });
	Object.defineProperty(response, "redirected", { value: redirected, configurable: true });
	return response;
}
