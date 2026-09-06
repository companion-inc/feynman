import { execFile } from "node:child_process";
import { pbkdf2Sync, createDecipheriv } from "node:crypto";
import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { isAbsolute, join, sep } from "node:path";
import { isBrowserCookieAccessAllowed, type BrowserCookiePreset } from "./gemini-web-config.ts";

export type CookieMap = Record<string, string>;

interface BrowserConfig {
	id: BrowserCookiePreset;
	name: string;
	baseDir: string;
	usesLocalAppData?: boolean;
	keychainService?: string;
	keychainAccount?: string;
	secretToolApp?: string;
}

type SqliteRow = Record<string, unknown>;
type SqliteFailure = "unavailable" | "query";

export type BrowserCookieAttemptStatus =
	| "missing-database"
	| "missing-required-cookies"
	| "password-read-failed"
	| "decryption-failed"
	| "sqlite-unavailable"
	| "sqlite-query-failed"
	| "unsafe-profile"
	| "no-host-cookies";

export interface BrowserCookieAttemptDiagnostic {
	browser: string;
	profile: string;
	status: BrowserCookieAttemptStatus;
}

export interface BrowserCookieDiagnosticDetails {
	message: string;
	attempts: BrowserCookieAttemptDiagnostic[];
}

interface BrowserCookieEntry {
	name: string;
	value: string;
	path: string;
}

const GOOGLE_ORIGINS = [
	"https://gemini.google.com",
	"https://accounts.google.com",
	"https://www.google.com",
];

const ALL_COOKIE_NAMES = new Set([
	"__Secure-1PSID", "__Secure-1PSIDTS", "__Secure-1PSIDCC", "__Secure-1PAPISID", "NID", "AEC", "SOCS",
	"__Secure-BUCKET", "__Secure-ENID", "SID", "HSID", "SSID", "APISID", "SAPISID", "__Secure-3PSID",
	"__Secure-3PSIDTS", "__Secure-3PAPISID", "SIDCC",
]);

const MACOS_BROWSER_CONFIGS: BrowserConfig[] = [
	{ id: "helium", name: "Helium", baseDir: "Library/Application Support/net.imput.helium", keychainService: "Helium Storage Key", keychainAccount: "Helium" },
	{ id: "chrome", name: "Chrome", baseDir: "Library/Application Support/Google/Chrome", keychainService: "Chrome Safe Storage", keychainAccount: "Chrome" },
	{ id: "brave", name: "Brave", baseDir: "Library/Application Support/BraveSoftware/Brave-Browser", keychainService: "Brave Safe Storage", keychainAccount: "Brave" },
	{ id: "arc", name: "Arc", baseDir: "Library/Application Support/Arc/User Data", keychainService: "Arc Safe Storage", keychainAccount: "Arc" },
];

const LINUX_BROWSER_CONFIGS: BrowserConfig[] = [
	{ id: "chromium", name: "Chromium", baseDir: ".config/chromium", secretToolApp: "chromium" },
	{ id: "chrome", name: "Chrome", baseDir: ".config/google-chrome", secretToolApp: "chrome" },
];

const WINDOWS_BROWSER_CONFIGS: BrowserConfig[] = [
	{ id: "chrome", name: "Chrome", baseDir: "Google/Chrome/User Data", usesLocalAppData: true },
	{ id: "edge", name: "Edge", baseDir: "Microsoft/Edge/User Data", usesLocalAppData: true },
];

const browserPasswordCache = new Map<string, Promise<string | null>>();
let lastCookieDiagnostic: string | null = null;
let lastCookieDiagnosticDetails: BrowserCookieDiagnosticDetails | null = null;
let sqliteModule: typeof import("node:sqlite") | null = null;
let sqliteImportAttempted = false;

export function getLastGoogleCookieDiagnostic(): string | null {
	return lastCookieDiagnostic;
}

export function getLastBrowserCookieDiagnostic(): string | null {
	return lastCookieDiagnostic;
}

export function getLastGoogleCookieDiagnosticDetails(): BrowserCookieDiagnosticDetails | null {
	return lastCookieDiagnosticDetails;
}

export async function getGoogleCookies(
	options?: { browser?: BrowserCookiePreset; profile?: string; requiredCookies?: string[] },
): Promise<{ cookies: CookieMap; warnings: string[] } | null> {
	return getBrowserCookiesForHosts({
		hosts: GOOGLE_ORIGINS.map((origin) => new URL(origin).hostname),
		browser: options?.browser,
		profile: options?.profile,
		requiredCookies: options?.requiredCookies,
		cookieNames: ALL_COOKIE_NAMES,
		requiredLabel: "Gemini",
	});
}

export async function getBrowserCookiesForHosts(
	options: { hosts: string[]; browser?: BrowserCookiePreset; profile?: string; requiredCookies?: string[]; cookieNames?: Iterable<string>; requiredLabel?: string; requestUrl?: URL },
): Promise<{ cookies: CookieMap; warnings: string[]; cookieHeader?: string } | null> {
	lastCookieDiagnostic = null;
	lastCookieDiagnosticDetails = null;
	if (!isBrowserCookieAccessAllowed()) {
		setCookieDiagnostic("Browser cookie access is disabled; enable allowBrowserCookies to use browser cookies.");
		return null;
	}

	const currentPlatform = process.platform;
	const platformConfigs = currentPlatform === "darwin" ? MACOS_BROWSER_CONFIGS : currentPlatform === "linux" ? LINUX_BROWSER_CONFIGS : currentPlatform === "win32" ? WINDOWS_BROWSER_CONFIGS : [];
	const configs = options.browser ? platformConfigs.filter((config) => config.id === options.browser) : platformConfigs;
	if (options.browser && configs.length === 0) {
		setCookieDiagnostic(`Browser preset '${options.browser}' is not supported on this platform.`);
		return null;
	}
	if (configs.length === 0) {
		setCookieDiagnostic("Chromium cookie extraction is unsupported on this platform.");
		return null;
	}

	const warningSet = new Set<string>();
	const rawProfile = typeof options.profile === "string" ? options.profile.trim() : "";
	const requestedProfile = normalizeProfileName(options.profile);
	if (rawProfile && !requestedProfile) {
		setCookieDiagnostic("Configured Chromium profile must be a profile directory name, not a path.");
		return null;
	}
	const requiredCookies = normalizeCookieNames(options.requiredCookies);
	const cookieNames = normalizeCookieNames(options.cookieNames ? [...options.cookieNames] : undefined);
	const hosts = normalizeHosts(options.hosts);
	if (hosts.length === 0) {
		setCookieDiagnostic("No valid cookie hosts were requested.");
		return null;
	}
	const attempts: BrowserCookieAttemptDiagnostic[] = [];
	const home = currentPlatform === "win32" ? process.env.USERPROFILE || homedir() : homedir();
	let sawCookieDatabase = false;
	let sawRequiredCookies = false;
	let sawAnyHostCookie = false;
	let sawBackendFailure: SqliteFailure | undefined;
	let sawUnsafeProfilePath = false;
	let sawWindowsAppBoundCookie = false;
	let sawDecryptionFailure = false;

	for (const config of configs) {
		const profiles = requestedProfile ? [requestedProfile] : listBrowserProfiles(home, config);
		for (const profile of profiles) {
			const profilePath = resolveProfilePath(home, config, profile);
			if (profilePath === "outside-root") {
				sawUnsafeProfilePath = true;
				recordCookieAttempt(attempts, config, profile, "unsafe-profile");
				continue;
			}
			if (!profilePath) {
				recordCookieAttempt(attempts, config, profile, "missing-database");
				continue;
			}
			const cookiesPath = cookieDatabasePath(profilePath, config);
			if (!cookiesPath) {
				recordCookieAttempt(attempts, config, profile, "missing-database");
				continue;
			}
			sawCookieDatabase = true;

			const tempDir = mkdtempSync(join(tmpdir(), "pi-chrome-cookies-"));
			try {
				const tempDb = join(tempDir, "Cookies");
				copyFileSync(cookiesPath, tempDb);
				copySidecar(cookiesPath, tempDb, "-wal");
				copySidecar(cookiesPath, tempDb, "-shm");

				if (requiredCookies?.length) {
					const preflight = await hasCookieNames(tempDb, hosts, requiredCookies);
					if (preflight.failure) {
						sawBackendFailure = preflight.failure;
						recordCookieAttempt(attempts, config, profile, preflight.failure === "unavailable" ? "sqlite-unavailable" : "sqlite-query-failed");
						continue;
					}
					if (!preflight.present) {
						recordCookieAttempt(attempts, config, profile, "missing-required-cookies");
						continue;
					}
					sawRequiredCookies = true;
				}

				const key = currentPlatform === "win32"
					? await readWindowsEncryptionKey(config, home)
					: await readBrowserPassword(config, currentPlatform).then((password) => password ? pbkdf2Sync(password, "saltysalt", currentPlatform === "darwin" ? 1003 : 1, 16, "sha1") : null);
				if (!key) {
					warningSet.add(currentPlatform === "win32"
						? `Could not read ${config.name} Windows cookie encryption key`
						: `Could not read ${config.name} cookie encryption password`);
					recordCookieAttempt(attempts, config, profile, "password-read-failed");
					continue;
				}
				const metaVersion = await readMetaVersion(tempDb);
				if (metaVersion.failure) {
					sawBackendFailure = metaVersion.failure;
					recordCookieAttempt(attempts, config, profile, metaVersion.failure === "unavailable" ? "sqlite-unavailable" : "sqlite-query-failed");
				}
				if (metaVersion.value === null) continue;
				const rowsResult = await queryCookieRows(tempDb, hosts, cookieNames ?? null, Boolean(options.requestUrl));
				if (rowsResult.status === "failure") {
					sawBackendFailure = rowsResult.failure;
					recordCookieAttempt(attempts, config, profile, rowsResult.failure === "unavailable" ? "sqlite-unavailable" : "sqlite-query-failed");
					continue;
				}

				const entries: BrowserCookieEntry[] = [];
				const cookies: CookieMap = {};
				const requiredDecryptFailures = new Set<string>();
				for (const row of rowsResult.rows) {
					const name = typeof row.name === "string" ? row.name : "";
					if (!name) continue;
					let value = typeof row.value === "string" && row.value.length > 0 ? row.value : null;
					if (!value && typeof row.encrypted_value_hex === "string" && /^[0-9a-f]*$/i.test(row.encrypted_value_hex)) {
						const encrypted = Buffer.from(row.encrypted_value_hex, "hex");
						if (currentPlatform === "win32" && encrypted.subarray(0, 3).toString("utf8") === "v20") sawWindowsAppBoundCookie = true;
						value = currentPlatform === "win32"
							? decryptWindowsCookieValue(encrypted, key, metaVersion.value >= 24)
							: decryptCookieValue(encrypted, key, metaVersion.value >= 24);
						if (!value && requiredCookies?.includes(name)) requiredDecryptFailures.add(name);
					}
					if (!value) continue;
					const path = typeof row.path === "string" && row.path.startsWith("/") ? row.path : "/";
					if (options.requestUrl && !pathMatches(options.requestUrl.pathname || "/", path)) continue;
					entries.push({ name, value, path });
					if (!cookies[name]) cookies[name] = value;
				}

				if (entries.length > 0) sawAnyHostCookie = true;
				if (requiredCookies?.length && !requiredCookies.every((name) => Boolean(cookies[name]))) {
					if (requiredCookies.some((name) => !cookies[name] && requiredDecryptFailures.has(name))) {
						sawDecryptionFailure = true;
						recordCookieAttempt(attempts, config, profile, "decryption-failed");
					} else {
						recordCookieAttempt(attempts, config, profile, "missing-required-cookies");
					}
					continue;
				}
				if (entries.length === 0) {
					recordCookieAttempt(attempts, config, profile, requiredDecryptFailures.size > 0 ? "decryption-failed" : "no-host-cookies");
					if (requiredDecryptFailures.size > 0) sawDecryptionFailure = true;
					continue;
				}
				return {
					cookies,
					warnings: [...warningSet],
					...(options.requestUrl ? { cookieHeader: buildCookieHeader(entries) } : {}),
				};
			} finally {
				rmSync(tempDir, { recursive: true, force: true });
			}
		}
	}

	if (sawBackendFailure === "unavailable") {
		setCookieDiagnostic("SQLite backend unavailable: install sqlite3 or use a runtime with SQLite support.", attempts);
	} else if (sawBackendFailure === "query") {
		setCookieDiagnostic("SQLite query failed while reading the copied Chromium cookie database.", attempts);
	} else if (sawUnsafeProfilePath) {
		setCookieDiagnostic("Configured Chromium profile must resolve inside the browser profile root.", attempts);
	} else if (!sawCookieDatabase) {
		setCookieDiagnostic(requestedProfile
			? `Chromium profile '${requestedProfile}' does not contain a cookie database.`
			: "No detected Chromium profile contains a cookie database.", attempts);
	} else if (requiredCookies?.length && !sawRequiredCookies) {
		setCookieDiagnostic(`No detected Chromium profile contains the required ${options.requiredLabel ?? "browser"} cookies.`, attempts);
	} else if (sawWindowsAppBoundCookie) {
		setCookieDiagnostic("Windows Chromium v20 app-bound cookies are not supported.", attempts);
	} else if (warningSet.size > 0) {
		setCookieDiagnostic([...warningSet][0], attempts);
	} else if (sawDecryptionFailure) {
		setCookieDiagnostic(`Required ${options.requiredLabel ?? "browser"} cookies could not be decrypted.`, attempts);
	} else if (!sawAnyHostCookie) {
		setCookieDiagnostic(options.requestUrl
			? "No detected Chromium profile contains cookies for the requested URL."
			: "No detected Chromium profile contains cookies for the requested host.", attempts);
	} else {
		setCookieDiagnostic("Required Gemini cookies were not available or could not be decrypted.", attempts);
	}
	return null;
}

function setCookieDiagnostic(message: string, attempts: BrowserCookieAttemptDiagnostic[] = []): void {
	lastCookieDiagnostic = message;
	lastCookieDiagnosticDetails = { message, attempts };
}

function recordCookieAttempt(attempts: BrowserCookieAttemptDiagnostic[], config: BrowserConfig, profile: string, status: BrowserCookieAttemptStatus): void {
	attempts.push({ browser: config.name, profile, status });
}

function normalizeProfileName(value: string | undefined): string | undefined {
	if (typeof value !== "string") return undefined;
	const normalized = value.trim();
	if (!normalized) return undefined;
	if (isAbsolute(normalized) || normalized === "." || normalized === ".." || normalized.includes("/") || normalized.includes("\\")) {
		return undefined;
	}
	return normalized;
}

function resolveProfilePath(home: string, config: BrowserConfig, profile: string): string | "outside-root" | null {
	const basePath = browserBasePath(home, config);
	const profilePath = join(basePath, profile);
	if (!cookieDatabasePath(profilePath, config)) return null;
	try {
		const baseRealPath = realpathSync(basePath);
		const profileRealPath = realpathSync(profilePath);
		if (profileRealPath !== baseRealPath && !profileRealPath.startsWith(`${baseRealPath}${sep}`)) return "outside-root";
		return profileRealPath;
	} catch {
		return null;
	}
}

function cookieDatabasePath(profilePath: string, config: BrowserConfig): string | null {
	const networkCookies = join(profilePath, "Network", "Cookies");
	if (config.usesLocalAppData && existsSync(networkCookies)) return networkCookies;
	const legacyCookies = join(profilePath, "Cookies");
	return existsSync(legacyCookies) ? legacyCookies : null;
}

function browserBasePath(home: string, config: BrowserConfig): string {
	return config.usesLocalAppData
		? join(process.env.LOCALAPPDATA || join(home, "AppData", "Local"), config.baseDir)
		: join(home, config.baseDir);
}

function normalizeCookieNames(names: string[] | undefined): string[] | undefined {
	if (!names?.length) return undefined;
	const normalized = names.filter((name): name is string => typeof name === "string").map((name) => name.trim()).filter(Boolean);
	return normalized.length > 0 ? [...new Set(normalized)] : undefined;
}

function normalizeHosts(hosts: string[]): string[] {
	return [...new Set(hosts.map(host => host.trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "")).filter(Boolean))];
}

function listBrowserProfiles(home: string, config: BrowserConfig): string[] {
	const basePath = browserBasePath(home, config);
	if (!existsSync(basePath)) return ["Default"];
	const profiles = new Set<string>();
	try {
		for (const entry of readdirSync(basePath, { withFileTypes: true })) {
			if (entry.isDirectory() && cookieDatabasePath(join(basePath, entry.name), config)) profiles.add(entry.name);
		}
	} catch {
	}
	if (profiles.size === 0) return ["Default"];
	return [...profiles].sort(compareProfileNames);
}

function compareProfileNames(a: string, b: string): number {
	const key = (name: string): [number, number] => {
		if (name === "Default") return [0, 0];
		const profile = /^Profile\s+(\d+)$/i.exec(name);
		if (profile) return [1, Number(profile[1])];
		const person = /^Person\s+(\d+)$/i.exec(name);
		if (person) return [2, Number(person[1])];
		return [3, Number.MAX_SAFE_INTEGER];
	};
	const [ap, ai] = key(a);
	const [bp, bi] = key(b);
	return ap - bp || ai - bi || a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });
}

function decryptCookieValue(encrypted: Uint8Array, key: Buffer, stripHash: boolean): string | null {
	const buf = Buffer.from(encrypted);
	if (buf.length < 3 || !/^v\d\d$/.test(buf.subarray(0, 3).toString("utf8"))) return null;
	const ciphertext = buf.subarray(3);
	if (!ciphertext.length) return "";
	try {
		const decipher = createDecipheriv("aes-128-cbc", key, Buffer.alloc(16, 0x20));
		decipher.setAutoPadding(false);
		const unpadded = removePkcs7Padding(Buffer.concat([decipher.update(ciphertext), decipher.final()]));
		const bytes = stripHash && unpadded.length >= 32 ? unpadded.subarray(32) : unpadded;
		const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
		let i = 0;
		while (i < decoded.length && decoded.charCodeAt(i) < 0x20) i++;
		return decoded.slice(i);
	} catch {
		return null;
	}
}

function decryptWindowsCookieValue(encrypted: Uint8Array, key: Buffer, stripHash: boolean): string | null {
	const buf = Buffer.from(encrypted);
	if (buf.subarray(0, 3).toString("utf8") !== "v10" || buf.length < 3 + 12 + 16) return null;
	try {
		const nonce = buf.subarray(3, 15);
		const ciphertext = buf.subarray(15, -16);
		const decipher = createDecipheriv("aes-256-gcm", key, nonce);
		decipher.setAuthTag(buf.subarray(-16));
		const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
		return new TextDecoder("utf-8", { fatal: true }).decode(stripHash && plaintext.length >= 32 ? plaintext.subarray(32) : plaintext);
	} catch {
		return null;
	}
}

function removePkcs7Padding(buf: Buffer): Buffer {
	if (!buf.length) return buf;
	const padding = buf[buf.length - 1];
	return !padding || padding > 16 ? buf : buf.subarray(0, buf.length - padding);
}

function readBrowserPassword(config: BrowserConfig, currentPlatform: typeof process.platform): Promise<string | null> {
	const cacheKey = `${currentPlatform}:${config.name}`;
	const cached = browserPasswordCache.get(cacheKey);
	if (cached) return cached;
	const passwordResult = currentPlatform === "darwin"
		? config.keychainAccount && config.keychainService
			? readKeychainPassword(config.keychainAccount, config.keychainService).then(password => ({ password, cacheable: Boolean(password) }))
			: Promise.resolve({ password: null, cacheable: false })
		: currentPlatform === "linux"
			? readLinuxPassword(config.secretToolApp)
			: Promise.resolve({ password: null, cacheable: false });
	const passwordPromise = passwordResult.then(({ password, cacheable }) => {
		if (!cacheable) browserPasswordCache.delete(cacheKey);
		return password;
	}, (error) => {
		browserPasswordCache.delete(cacheKey);
		throw error;
	});
	browserPasswordCache.set(cacheKey, passwordPromise);
	return passwordPromise;
}

async function readWindowsEncryptionKey(config: BrowserConfig, home: string): Promise<Buffer | null> {
	try {
		const localState = JSON.parse(readFileSync(join(browserBasePath(home, config), "Local State"), "utf8")) as { os_crypt?: { encrypted_key?: unknown } };
		const encodedKey = localState.os_crypt?.encrypted_key;
		if (typeof encodedKey !== "string") return null;
		const protectedKey = Buffer.from(encodedKey, "base64");
		if (protectedKey.subarray(0, 5).toString("utf8") !== "DPAPI") return null;
		const decrypted = await unprotectWindowsData(protectedKey.subarray(5));
		return decrypted?.length === 32 ? decrypted : null;
	} catch {
		return null;
	}
}

function unprotectWindowsData(protectedData: Buffer): Promise<Buffer | null> {
	return new Promise((resolve) => {
		const script = "Add-Type -AssemblyName System.Security;$data=[Convert]::FromBase64String($env:PIWA_PROTECTED);$clear=[System.Security.Cryptography.ProtectedData]::Unprotect($data,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser);[Console]::Write([Convert]::ToBase64String($clear))";
		const encoded = Buffer.from(script, "utf16le").toString("base64");
		execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], { timeout: 5000, maxBuffer: 1024 * 1024, env: { ...process.env, PIWA_PROTECTED: protectedData.toString("base64") } }, (err, stdout) => {
			if (err) { resolve(null); return; }
			try {
				resolve(Buffer.from(stdout.trim(), "base64"));
			} catch {
				resolve(null);
			}
		});
	});
}

function readKeychainPassword(account: string, service: string): Promise<string | null> {
	return new Promise((resolve) => {
		execFile("security", ["find-generic-password", "-w", "-a", account, "-s", service], { timeout: 5000 }, (err, stdout) => {
			if (err) { resolve(null); return; }
			resolve(stdout.trim() || null);
		});
	});
}

function readLinuxPassword(secretToolApp: string | undefined): Promise<{ password: string; cacheable: boolean }> {
	if (!secretToolApp) return Promise.resolve({ password: "peanuts", cacheable: true });
	return new Promise((resolve) => {
		execFile("secret-tool", ["lookup", "application", secretToolApp], { timeout: 5000 }, (err, stdout) => {
			if (err) { resolve({ password: "peanuts", cacheable: false }); return; }
			const password = stdout.trim();
			resolve(password ? { password, cacheable: true } : { password: "peanuts", cacheable: false });
		});
	});
}

async function importSqlite(): Promise<typeof import("node:sqlite") | null> {
	if (process.env.PI_WEB_ACCESS_DISABLE_NODE_SQLITE === "1") return null;
	if (sqliteImportAttempted) return sqliteModule;
	sqliteImportAttempted = true;
	const orig = process.emitWarning.bind(process);
	process.emitWarning = ((warning: string | Error, ...args: unknown[]) => {
		const msg = typeof warning === "string" ? warning : warning?.message ?? "";
		if (msg.includes("SQLite is an experimental feature")) return;
		return (orig as Function)(warning, ...args);
	}) as typeof process.emitWarning;
	try {
		sqliteModule = await import("node:sqlite");
	} catch {
		sqliteModule = null;
	} finally {
		process.emitWarning = orig;
	}
	return sqliteModule;
}

type QueryResult =
	| { status: "success"; rows: SqliteRow[] }
	| { status: "failure"; failure: SqliteFailure };

async function runSqliteQuery(dbPath: string, sql: string): Promise<QueryResult> {
	const sqlite = await importSqlite();
	let queryFailed = false;
	if (sqlite) {
		try {
			const db = new sqlite.DatabaseSync(dbPath, { readOnly: true });
			try {
				return { status: "success", rows: db.prepare(sql).all() as SqliteRow[] };
			} finally {
				db.close();
			}
		} catch {
			queryFailed = true;
		}
	}

	const cli = await runSqliteCli(dbPath, sql);
	if (cli.status === "success") return cli;
	if (cli.failure === "query") queryFailed = true;
	const python = await runPythonSqlite(dbPath, sql);
	if (python.status === "success") return python;
	if (python.failure === "query") queryFailed = true;
	return { status: "failure", failure: queryFailed ? "query" : "unavailable" };
}

function runSqliteCli(dbPath: string, sql: string): Promise<QueryResult> {
	return new Promise((resolve) => {
		execFile("sqlite3", ["-readonly", "-json", dbPath, sql], { timeout: 5000, maxBuffer: 1024 * 1024 }, (err, stdout) => {
			if (err) { resolve({ status: "failure", failure: err.code === "ENOENT" ? "unavailable" : "query" }); return; }
			try {
				const parsed = JSON.parse(stdout || "[]");
				resolve(Array.isArray(parsed) ? { status: "success", rows: parsed as SqliteRow[] } : { status: "failure", failure: "query" });
			} catch {
				resolve({ status: "failure", failure: "query" });
			}
		});
	});
}

function runPythonSqlite(dbPath: string, sql: string): Promise<QueryResult> {
	const script = "import json,sqlite3,sys\ntry:\n c=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True)\n c.row_factory=sqlite3.Row\n print(json.dumps([dict(r) for r in c.execute(sys.argv[2]).fetchall()]))\nexcept Exception:\n sys.exit(1)";
	return new Promise((resolve) => {
		execFile("python3", ["-c", script, dbPath, sql], { timeout: 5000, maxBuffer: 1024 * 1024 }, (err, stdout) => {
			if (err) { resolve({ status: "failure", failure: err.code === "ENOENT" ? "unavailable" : "query" }); return; }
			try {
				const parsed = JSON.parse(stdout || "[]");
				resolve(Array.isArray(parsed) ? { status: "success", rows: parsed as SqliteRow[] } : { status: "failure", failure: "query" });
			} catch {
				resolve({ status: "failure", failure: "query" });
			}
		});
	});
}

async function readMetaVersion(dbPath: string): Promise<{ value: number | null; failure?: SqliteFailure }> {
	const result = await runSqliteQuery(dbPath, "SELECT value FROM meta WHERE key = 'version'");
	if (result.status === "failure") {
		return result.failure === "unavailable"
			? { value: null, failure: result.failure }
			: { value: 0 };
	}
	const value = result.rows[0]?.value;
	if (typeof value === "number") return { value: Math.floor(value) };
	if (typeof value === "string") return { value: parseInt(value, 10) || 0 };
	return { value: 0 };
}

async function hasCookieNames(dbPath: string, hosts: string[], names: string[]): Promise<{ present: boolean; failure?: SqliteFailure }> {
	const result = await runSqliteQuery(dbPath, `SELECT DISTINCT name FROM cookies WHERE ${buildCookieWhere(hosts, names)}`);
	if (result.status === "failure") return { present: false, failure: result.failure };
	const present = new Set(result.rows.map((row) => typeof row.name === "string" ? row.name : ""));
	return { present: names.every((name) => present.has(name)) };
}

async function queryCookieRows(dbPath: string, hosts: string[], names: Iterable<string> | null, filterExpired: boolean): Promise<QueryResult> {
	const columns = await readCookieColumns(dbPath);
	if (columns.status === "failure") return columns;
	const pathExpr = columns.columns.has("path") ? "path" : "'/' AS path";
	const expiresExpr = columns.columns.has("expires_utc") ? chromeExpiryMillisExpr() : "0";
	const expiryFilter = filterExpired && columns.columns.has("expires_utc") ? ` AND (${expiresExpr} = 0 OR ${expiresExpr} > ${chromeExpiryNowMillis()})` : "";
	const partitionFilter = filterExpired ? unpartitionedCookieFilter(columns.columns) : "";
	return runSqliteQuery(dbPath, `SELECT name, value, host_key, ${pathExpr}, ${expiresExpr} AS expires_utc, hex(encrypted_value) AS encrypted_value_hex FROM cookies WHERE ${buildCookieWhere(hosts, names ?? undefined)}${expiryFilter}${partitionFilter} ORDER BY length(path) DESC, ${expiresExpr} ASC`);
}

async function readCookieColumns(dbPath: string): Promise<{ status: "success"; columns: Set<string> } | { status: "failure"; failure: SqliteFailure }> {
	const result = await runSqliteQuery(dbPath, "PRAGMA table_info(cookies)");
	if (result.status === "failure") return result;
	return { status: "success", columns: new Set(result.rows.map(row => typeof row.name === "string" ? row.name : "")) };
}

function chromeExpiryMillisExpr(): string {
	return "CASE WHEN expires_utc = 0 THEN 0 ELSE CAST(expires_utc / 1000 AS INTEGER) + CASE WHEN expires_utc % 1000 = 0 THEN 0 ELSE 1 END END";
}

function chromeExpiryNowMillis(): number {
	return Date.now() + 11644473600000;
}

function unpartitionedCookieFilter(columns: Set<string>): string {
	const clauses: string[] = [];
	if (columns.has("top_frame_site_key")) clauses.push("(top_frame_site_key IS NULL OR top_frame_site_key = '')");
	if (columns.has("partition_key")) clauses.push("(partition_key IS NULL OR partition_key = '')");
	if (columns.has("is_partitioned")) clauses.push("(is_partitioned IS NULL OR is_partitioned = 0)");
	return clauses.length > 0 ? ` AND ${clauses.join(" AND ")}` : "";
}

function buildCookieHeader(entries: BrowserCookieEntry[]): string {
	return entries
		.sort((a, b) => b.path.length - a.path.length)
		.map(({ name, value }) => `${name}=${value}`)
		.join("; ");
}

function pathMatches(requestPath: string, cookiePath: string): boolean {
	if (requestPath === cookiePath) return true;
	if (!requestPath.startsWith(cookiePath)) return false;
	if (cookiePath.endsWith("/")) return true;
	return requestPath[cookiePath.length] === "/";
}

function buildCookieWhere(hosts: string[], cookieNames?: Iterable<string>): string {
	const hostClauses: string[] = [];
	for (const host of hosts) {
		const escapedHost = escapeSqlString(host);
		hostClauses.push(`host_key = '${escapedHost}'`);
		for (const candidate of domainCookieHosts(host)) {
			hostClauses.push(`host_key = '.${escapeSqlString(candidate)}'`);
		}
	}
	let where = `(${[...new Set(hostClauses)].join(" OR ")})`;
	const names = cookieNames ? [...cookieNames].filter(Boolean) : [];
	if (names.length) where += ` AND name IN (${names.map((name) => `'${escapeSqlString(name)}'`).join(", ")})`;
	return where;
}

function escapeSqlString(value: string): string {
	return value.replaceAll("'", "''");
}

function domainCookieHosts(host: string): string[] {
	const parts = host.split(".").filter(Boolean);
	if (parts.length <= 1) return [];
	const candidates = new Set<string>();
	for (let i = 0; i <= parts.length - 2; i++) candidates.add(parts.slice(i).join("."));
	return [...candidates];
}

function copySidecar(srcDb: string, targetDb: string, suffix: string): void {
	const sidecar = `${srcDb}${suffix}`;
	if (!existsSync(sidecar)) return;
	try {
		copyFileSync(sidecar, `${targetDb}${suffix}`);
	} catch {
	}
}
