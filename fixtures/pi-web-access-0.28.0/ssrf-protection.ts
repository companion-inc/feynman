import { lookup as dnsLookup } from "node:dns/promises";
import { existsSync, readFileSync, statSync } from "node:fs";
import net from "node:net";
import { getActiveProxy, getWebSearchConfigPath, hasScopedProxyDecision, isProxyBypassedUrl } from "./utils.ts";

const DEFAULT_MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const LOOPBACK_ALLOW_RANGES = ["127.0.0.0/8", "::1", "::ffff:127.0.0.0/104"];

export type LookupAddress = { address: string; family: number };
export type Lookup = (hostname: string) => Promise<LookupAddress[]>;
type Fetch = typeof fetch;

const WEB_SEARCH_CONFIG_PATH = getWebSearchConfigPath();

let cachedConfigRoot: { signature: string; value: Record<string, unknown> | null } | null = null;

function loadConfigRoot(): Record<string, unknown> | null {
	if (!existsSync(WEB_SEARCH_CONFIG_PATH)) return null;

	let signature: string;
	try {
		const stat = statSync(WEB_SEARCH_CONFIG_PATH);
		signature = `${stat.mtimeMs}:${stat.size}`;
	} catch {
		return null;
	}

	if (cachedConfigRoot?.signature === signature) return cachedConfigRoot.value;

	let raw: string;
	try {
		raw = readFileSync(WEB_SEARCH_CONFIG_PATH, "utf-8");
	} catch {
		// Do not memoize read failures: a chmod fix changes neither mtime nor size,
		// so a cached failure would permanently fail-open the domain policy.
		return null;
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		throw new Error(`Failed to parse ${WEB_SEARCH_CONFIG_PATH}: ${message}`);
	}

	const value = parsed && typeof parsed === "object" && !Array.isArray(parsed)
		? parsed as Record<string, unknown>
		: null;
	cachedConfigRoot = { signature, value };
	return value;
}

export interface SsrfConfig {
	allowRanges: string[];
	trustEnvProxy: boolean;
}

export interface DomainPolicy {
	allow: string[];
	deny: string[];
}

const DEFAULT_DOMAIN_POLICY: DomainPolicy = { allow: [], deny: [] };

export function loadFetchContentDomainPolicy(): DomainPolicy {
	const parsed = loadConfigRoot();
	if (!parsed) return { ...DEFAULT_DOMAIN_POLICY };
	const fetchContent = parsed.fetchContent;
	if (fetchContent === undefined || fetchContent === null) return { ...DEFAULT_DOMAIN_POLICY };
	if (typeof fetchContent !== "object" || Array.isArray(fetchContent)) {
		throw new Error(`fetchContent in ${WEB_SEARCH_CONFIG_PATH} must be an object`);
	}
	const policy = (fetchContent as { domainPolicy?: unknown }).domainPolicy;
	if (policy === undefined || policy === null) return { ...DEFAULT_DOMAIN_POLICY };
	if (typeof policy !== "object" || Array.isArray(policy)) {
		throw new Error(`fetchContent.domainPolicy in ${WEB_SEARCH_CONFIG_PATH} must be an object`);
	}
	const config = policy as { allow?: unknown; deny?: unknown };
	return {
		allow: parseDomainEntries(config.allow, "allow"),
		deny: parseDomainEntries(config.deny, "deny"),
	};
}

function parseDomainEntries(value: unknown, field: "allow" | "deny"): string[] {
	if (value === undefined || value === null) return [];
	if (!Array.isArray(value)) {
		throw new Error(`fetchContent.domainPolicy.${field} in ${WEB_SEARCH_CONFIG_PATH} must be an array of hostnames`);
	}
	return value.map((entry, index) => {
		if (typeof entry !== "string") {
			throw new Error(`fetchContent.domainPolicy.${field} in ${WEB_SEARCH_CONFIG_PATH} must contain only hostnames; entry ${index + 1} is ${typeof entry}`);
		}
		const hostname = normalizeDomainEntry(entry);
		if (!hostname) {
			throw new Error(`fetchContent.domainPolicy.${field} in ${WEB_SEARCH_CONFIG_PATH} contains an invalid hostname: ${JSON.stringify(entry)}`);
		}
		return hostname;
	});
}

function normalizeDomainEntry(entry: string): string | null {
	const hostname = normalizeHostname(entry.trim());
	if (!hostname || /\s|[\\/?:#@]/.test(hostname)) return null;
	if (net.isIP(hostname)) return hostname;
	if (hostname.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(hostname)) return null;
	return hostname;
}

export function loadSsrfConfig(): SsrfConfig {
	const parsed = loadConfigRoot();
	if (!parsed) return { allowRanges: [], trustEnvProxy: false };
	const ssrf = parsed.ssrf;
	if (ssrf === undefined || ssrf === null) return { allowRanges: [], trustEnvProxy: false };
	if (typeof ssrf !== "object" || Array.isArray(ssrf)) {
		throw new Error(`ssrf in ${WEB_SEARCH_CONFIG_PATH} must be an object`);
	}
	const config = ssrf as { allowRanges?: unknown; trustEnvProxy?: unknown };
	if (config.allowRanges !== undefined && config.allowRanges !== null && !Array.isArray(config.allowRanges)) {
		throw new Error(`ssrf.allowRanges in ${WEB_SEARCH_CONFIG_PATH} must be an array of CIDR strings`);
	}
	if (config.trustEnvProxy !== undefined && typeof config.trustEnvProxy !== "boolean") {
		throw new Error(`ssrf.trustEnvProxy in ${WEB_SEARCH_CONFIG_PATH} must be a boolean`);
	}
	const allowRangesValue: unknown[] = Array.isArray(config.allowRanges) ? config.allowRanges : [];
	const allowRanges = allowRangesValue.map((entry, index) => {
		if (typeof entry !== "string") {
			throw new Error(`ssrf.allowRanges in ${WEB_SEARCH_CONFIG_PATH} must contain only CIDR strings; entry ${index + 1} is ${typeof entry}`);
		}
		return entry.trim();
	}).filter(Boolean);
	parseAllowRanges(allowRanges);
	return { allowRanges, trustEnvProxy: config.trustEnvProxy === true };
}

interface ValidationOptions {
	lookup?: Lookup;
	/** Optional hostname policy for fetch_content target URLs. */
	domainPolicy?: DomainPolicy;
	/**
	 * CIDR ranges (e.g. "198.18.0.0/15") to exempt from the SSRF guard.
	 * Useful when a host runs a TUN/fake-IP proxy (Surge, Clash, Mihomo, ...)
	 * that resolves public domains into a reserved range. Entries are validated
	 * strictly; an invalid entry throws so misconfiguration is not silent.
	 */
	allowRanges?: string[];
	/**
	 * When true, trust an explicitly-configured HTTP(S) proxy for hostname
	 * resolution instead of performing local DNS lookups inside the sandbox.
	 * Literal IPs and localhost remain blocked, and NO_PROXY hosts still use
	 * the local SSRF preflight. This does not configure proxy transport.
	 */
	trustEnvProxy?: boolean;
	/** Allow loopback URLs for explicit provider base endpoints, not fetched targets. */
	allowLoopback?: boolean;
}

/** Parsed entry from `allowRanges`: a network address (4 or 16 bytes) + prefix length. */
interface ParsedCidr {
	bytes: Uint8Array;
	prefix: number;
}

interface RedirectRequestInitArgs {
	from: URL;
	to: URL;
	init: RequestInit;
	response: Response;
}

interface FetchRemoteOptions extends ValidationOptions {
	fetch?: Fetch;
	maxRedirects?: number;
	onRedirect?: (args: RedirectRequestInitArgs) => RequestInit;
}

async function defaultLookup(hostname: string): Promise<LookupAddress[]> {
	return dnsLookup(hostname, { all: true, verbatim: true });
}

export async function validateRemoteUrl(rawUrl: string | URL, options: ValidationOptions = {}): Promise<URL> {
	const url = rawUrl instanceof URL ? rawUrl : new URL(rawUrl);
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new Error("Only HTTP and HTTPS URLs can be fetched remotely");
	}

	const hostname = normalizeHostname(url.hostname);
	if (!hostname) throw new Error("URL must include a hostname");
	if (hostname === "localhost") {
		if (options.allowLoopback === true) return url;
		throw new Error(`Blocked internal hostname: ${hostname}`);
	}
	if (hostname.endsWith(".localhost")) {
		throw new Error(`Blocked internal hostname: ${hostname}`);
	}

	const allowRanges = parseAllowRanges(options.allowRanges);
	assertDomainPolicy(hostname, options.domainPolicy);

	if (net.isIP(hostname)) {
		const addressAllowRanges = options.allowLoopback === true
			? [...allowRanges, ...parseAllowRanges(LOOPBACK_ALLOW_RANGES)]
			: allowRanges;
		assertPublicAddress(hostname, hostname, addressAllowRanges);
		return url;
	}

	if (shouldTrustEnvProxy(url, options.trustEnvProxy === true)) return url;

	let addresses: LookupAddress[];
	try {
		addresses = await (options.lookup ?? defaultLookup)(hostname);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		throw new Error(`Failed to resolve ${hostname}: ${message}`);
	}

	if (addresses.length === 0) throw new Error(`Failed to resolve ${hostname}: no addresses returned`);
	for (const { address } of addresses) {
		assertPublicAddress(address, hostname, allowRanges);
	}
	return url;
}

export async function fetchRemoteUrl(
	url: string | URL,
	init: RequestInit = {},
	options: FetchRemoteOptions = {},
): Promise<Response> {
	const fetchImpl = options.fetch ?? fetch;
	const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
	let current = await validateRemoteUrl(url, options);
	let requestInit = init;

	for (let redirects = 0; redirects <= maxRedirects; redirects++) {
		const response = await fetchImpl(current, { ...requestInit, redirect: "manual" });
		if (!REDIRECT_STATUSES.has(response.status)) return response;

		const location = response.headers.get("location");
		if (!location) return response;
		if (redirects === maxRedirects) throw new Error(`Too many redirects fetching ${current.toString()}`);

		const from = current;
		current = await validateRemoteUrl(new URL(location, current), options);
		if (response.status === 303 || ((response.status === 301 || response.status === 302) && requestInit.method?.toUpperCase() === "POST")) {
			const { body: _body, ...nextInit } = requestInit;
			requestInit = { ...nextInit, method: "GET" };
		}
		if (options.onRedirect) requestInit = options.onRedirect({ from, to: current, init: requestInit, response });
	}

	throw new Error(`Too many redirects fetching ${current.toString()}`);
}

function normalizeHostname(hostname: string): string {
	return hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
}

function assertDomainPolicy(hostname: string, policy?: DomainPolicy): void {
	if (!policy) return;
	if (policy.deny.some((entry) => domainMatches(hostname, entry))) {
		throw new Error(`Blocked hostname by fetch_content domain policy: ${hostname}`);
	}
	if (policy.allow.length > 0 && !policy.allow.some((entry) => domainMatches(hostname, entry))) {
		throw new Error(`Hostname not allowed by fetch_content domain policy: ${hostname}`);
	}
}

function domainMatches(hostname: string, entry: string): boolean {
	return hostname === entry || hostname.endsWith(`.${entry}`);
}

function getProxyForProtocol(protocol: string): string {
	const candidates = protocol === "http:"
		? [process.env.HTTP_PROXY, process.env.http_proxy, process.env.ALL_PROXY, process.env.all_proxy]
		: protocol === "https:"
			? [process.env.HTTPS_PROXY, process.env.https_proxy, process.env.HTTP_PROXY, process.env.http_proxy, process.env.ALL_PROXY, process.env.all_proxy]
			: [];
	for (const candidate of candidates) {
		const value = candidate?.trim();
		if (!value) continue;
		try {
			const proxyUrl = new URL(value);
			if ((proxyUrl.protocol === "http:" || proxyUrl.protocol === "https:") && proxyUrl.hostname) return value;
		} catch {
			// Invalid proxy env vars should not weaken local DNS SSRF checks.
		}
	}
	return "";
}

function hostnameMatchesNoProxy(hostname: string, port: string, entry: string): boolean {
	const trimmed = entry.trim();
	if (!trimmed) return false;
	if (trimmed === "*") return true;

	// NO_PROXY entries may include a port. Strip it only after handling
	// bracketed IPv6 literals, which can contain several colons.
	let hostEntry = trimmed;
	let entryPort: string | undefined;
	if (hostEntry.startsWith("[")) {
		const closingBracket = hostEntry.indexOf("]");
		if (closingBracket >= 0) {
			const suffix = hostEntry.slice(closingBracket + 1);
			if (/^:\\d+$/.test(suffix)) entryPort = suffix.slice(1);
			hostEntry = hostEntry.slice(0, closingBracket + 1);
		}
	} else {
		const colon = hostEntry.lastIndexOf(":");
		if (colon > -1 && /^\d+$/.test(hostEntry.slice(colon + 1))) {
			entryPort = hostEntry.slice(colon + 1);
			hostEntry = hostEntry.slice(0, colon);
		}
	}
	if (entryPort !== undefined && entryPort !== port) return false;

	const normalizedEntry = normalizeHostname(hostEntry);
	if (!normalizedEntry) return false;
	if (normalizedEntry === hostname) return true;
	const suffix = normalizedEntry.startsWith("*.")
		? normalizedEntry.slice(1)
		: normalizedEntry.startsWith(".")
			? normalizedEntry
			: `.${normalizedEntry}`;
	return hostname.endsWith(suffix);
}

function shouldTrustEnvProxy(url: URL, enabled: boolean): boolean {
	if (!enabled || !getProxyForProtocol(url.protocol)) return false;
	if (hasScopedProxyDecision()) return false;
	const activeProxy = getActiveProxy();
	if (activeProxy && !isProxyBypassedUrl(url)) return false;
	const hostname = normalizeHostname(url.hostname);
	const port = url.port || (url.protocol === "https:" ? "443" : "80");
	const noProxy = process.env.NO_PROXY || process.env.no_proxy || "";
	return !noProxy.split(",").some(entry => hostnameMatchesNoProxy(hostname, port, entry));
}

function assertPublicAddress(address: string, hostname: string, allowRanges: ParsedCidr[] = []): void {
	const normalized = normalizeHostname(address);
	const ipVersion = net.isIP(normalized);
	if (ipVersion === 0) throw new Error(`Resolved non-IP address for ${hostname}: ${address}`);
	// Explicitly-allowed ranges bypass the private/reserved checks below. This lets
	// users exempt synthetic ranges produced by TUN/fake-IP proxies (e.g. 198.18/15).
	if (isInAllowedRange(normalized, ipVersion, allowRanges)) return;
	if (ipVersion === 4 && isBlockedIPv4(normalized)) {
		const hint = isFakeIpProxyAddress(normalized)
			? '. This address is in 198.18.0.0/15, commonly used by TUN/fake-IP proxies. If that matches your setup, configure ssrf.allowRanges with ["198.18.0.0/15"] in web-search.json.'
			: "";
		throw new Error(`Blocked internal address for ${hostname}: ${normalized}${hint}`);
	}
	if (ipVersion === 6 && isBlockedIPv6(normalized)) {
		throw new Error(`Blocked internal address for ${hostname}: ${normalized}`);
	}
}

function isFakeIpProxyAddress(address: string): boolean {
	const [a, b] = address.split(".").map(part => Number(part));
	return a === 198 && (b === 18 || b === 19);
}

function isBlockedIPv4(address: string): boolean {
	const parts = address.split(".").map(part => Number(part));
	if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return true;
	const [a, b] = parts;
	return a === 0 ||
		a === 10 ||
		a === 127 ||
		(a === 100 && b >= 64 && b <= 127) ||
		(a === 169 && b === 254) ||
		(a === 172 && b >= 16 && b <= 31) ||
		(a === 192 && b === 168) ||
		isFakeIpProxyAddress(address) ||
		a >= 224;
}

function isBlockedIPv6(address: string): boolean {
	const groups = parseIPv6(address);
	if (!groups) return true;

	const first = groups[0];
	if (groups.every(group => group === 0)) return true;
	if (groups.slice(0, 7).every(group => group === 0) && groups[7] === 1) return true;
	if ((first & 0xfe00) === 0xfc00) return true;
	if ((first & 0xffc0) === 0xfe80) return true;

	const isMappedIPv4 = groups.slice(0, 5).every(group => group === 0) && groups[5] === 0xffff;
	if (isMappedIPv4) {
		const ipv4 = [groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff].join(".");
		return isBlockedIPv4(ipv4);
	}

	return false;
}

function parseIPv6(address: string): number[] | null {
	if (address.includes(".")) {
		const lastColon = address.lastIndexOf(":");
		const ipv4 = address.slice(lastColon + 1);
		if (net.isIP(ipv4) !== 4) return null;
		const octets = ipv4.split(".").map(part => Number(part));
		address = `${address.slice(0, lastColon)}:${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
	}

	const pieces = address.split("::");
	if (pieces.length > 2) return null;

	const left = pieces[0] ? pieces[0].split(":") : [];
	const right = pieces.length === 2 && pieces[1] ? pieces[1].split(":") : [];
	const missing = 8 - left.length - right.length;
	if (pieces.length === 1 && missing !== 0) return null;
	if (pieces.length === 2 && missing < 0) return null;

	const groups = [...left, ...Array(missing).fill("0"), ...right].map(part => {
		if (!/^[0-9a-f]{1,4}$/i.test(part)) return -1;
		return parseInt(part, 16);
	});
	return groups.length === 8 && groups.every(group => group >= 0 && group <= 0xffff) ? groups : null;
}

/** Parse `allowRanges` config value into validated CIDR rules. Throws on malformed entries. */
function parseAllowRanges(input: unknown): ParsedCidr[] {
	if (input === undefined || input === null) return [];
	if (!Array.isArray(input)) {
		throw new Error("ssrf.allowRanges must be an array of CIDR strings");
	}
	const rules: ParsedCidr[] = [];
	for (const entry of input) {
		if (typeof entry !== "string") {
			throw new Error(`ssrf.allowRanges entries must be strings, got ${typeof entry}`);
		}
		const rule = parseCidr(entry.trim());
		if (!rule) {
			throw new Error(`Invalid CIDR notation in ssrf.allowRanges: "${entry}"`);
		}
		rules.push(rule);
	}
	return rules;
}

/** Parse a single CIDR (e.g. "198.18.0.0/15", "fd00::/8") or bare host ("1.2.3.4"). Returns null if invalid. */
function parseCidr(raw: string): ParsedCidr | null {
	if (!raw) return null;
	const slash = raw.lastIndexOf("/");
	const addrPart = slash >= 0 ? raw.slice(0, slash) : raw;
	const prefixPart = slash >= 0 ? raw.slice(slash + 1) : null;
	// A slash must be followed by digits. Number("")/Number(" ") are 0, which
	// would silently turn "198.18.0.0/" into /0 and exempt every address.
	if (prefixPart !== null && !/^\d+$/.test(prefixPart)) return null;
	const version = net.isIP(addrPart);

	if (version === 4) {
		const bytes = ipv4ToBytes(addrPart);
		if (!bytes) return null;
		const prefix = prefixPart === null ? 32 : Number(prefixPart);
		if (!Number.isInteger(prefix) || prefix < 1 || prefix > 32) return null;
		return { bytes, prefix };
	}
	if (version === 6) {
		const groups = parseIPv6(addrPart);
		if (!groups) return null;
		const prefix = prefixPart === null ? 128 : Number(prefixPart);
		if (!Number.isInteger(prefix) || prefix < 1 || prefix > 128) return null;
		return { bytes: ipv6GroupsToBytes(groups), prefix };
	}
	return null;
}

function ipv4ToBytes(address: string): Uint8Array | null {
	const parts = address.split(".");
	if (parts.length !== 4) return null;
	const bytes = new Uint8Array(4);
	for (let i = 0; i < 4; i++) {
		const octet = Number(parts[i]);
		if (!Number.isInteger(octet) || octet < 0 || octet > 255) return null;
		bytes[i] = octet;
	}
	return bytes;
}

function ipv6GroupsToBytes(groups: number[]): Uint8Array {
	const bytes = new Uint8Array(16);
	for (let i = 0; i < 8; i++) {
		bytes[i * 2] = groups[i] >> 8;
		bytes[i * 2 + 1] = groups[i] & 0xff;
	}
	return bytes;
}

function ipToBytes(address: string, version: number): Uint8Array | null {
	if (version === 4) return ipv4ToBytes(address);
	if (version === 6) {
		const groups = parseIPv6(address);
		return groups ? ipv6GroupsToBytes(groups) : null;
	}
	return null;
}

/** True if `address` (already validated as `ipVersion`) falls within any allowed CIDR. */
function isInAllowedRange(address: string, ipVersion: number, allowRanges: ParsedCidr[]): boolean {
	if (allowRanges.length === 0) return false;
	const addrBytes = ipToBytes(address, ipVersion);
	if (!addrBytes) return false;
	for (const rule of allowRanges) {
		// Only compare same-family rules (4-byte IPv4 vs 16-byte IPv6).
		if (rule.bytes.length !== addrBytes.length) continue;
		if (bytesMatchPrefix(addrBytes, rule.bytes, rule.prefix)) return true;
	}
	return false;
}

/** Compare the leading `prefix` bits of two equal-length byte arrays. */
function bytesMatchPrefix(addr: Uint8Array, network: Uint8Array, prefix: number): boolean {
	const fullBytes = prefix >> 3;
	const remBits = prefix & 7;
	for (let i = 0; i < fullBytes; i++) {
		if (addr[i] !== network[i]) return false;
	}
	if (remBits > 0 && fullBytes < addr.length) {
		const mask = (0xff << (8 - remBits)) & 0xff;
		if ((addr[fullBytes] & mask) !== (network[fullBytes] & mask)) return false;
	}
	return true;
}
