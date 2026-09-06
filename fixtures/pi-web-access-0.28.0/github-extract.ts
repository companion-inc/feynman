import { chmodSync, closeSync, constants as fsConstants, existsSync, fstatSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, readdirSync, realpathSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { lstat as lstatAsync, open as openAsync, opendir as opendirAsync, readFile as readFileAsync, realpath as realpathAsync, rm as rmAsync, type FileHandle } from "node:fs/promises";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { basename, dirname, extname, join, resolve as resolvePath, sep as pathSep } from "node:path";
import { activityMonitor } from "./activity.ts";
import type { ExtractedContent } from "./extract.ts";
import { checkGhAvailable, checkRepoSize, fetchViaApi, showGhHint } from "./github-api.ts";
import { getWebSearchConfigPath } from "./utils.ts";

const CONFIG_PATH = getWebSearchConfigPath();

const BINARY_EXTENSIONS = new Set([
	".png", ".jpg", ".jpeg", ".gif", ".bmp", ".ico", ".webp", ".svg", ".tiff", ".tif",
	".mp3", ".mp4", ".avi", ".mov", ".mkv", ".flv", ".wmv", ".wav", ".ogg", ".webm", ".flac", ".aac",
	".zip", ".tar", ".gz", ".bz2", ".xz", ".7z", ".rar", ".zst",
	".exe", ".dll", ".so", ".dylib", ".bin", ".o", ".a", ".lib",
	".woff", ".woff2", ".ttf", ".otf", ".eot",
	".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
	".sqlite", ".db", ".sqlite3",
	".pyc", ".pyo", ".class", ".jar", ".war",
	".iso", ".img", ".dmg",
]);

const NOISE_DIRS = new Set([
	"node_modules", "vendor", ".next", "dist", "build", "__pycache__",
	".venv", "venv", ".tox", ".mypy_cache", ".pytest_cache",
	"target", ".gradle", ".idea", ".vscode",
]);

const MAX_INLINE_FILE_CHARS = 100_000;
const MAX_TREE_ENTRIES = 200;
const CLONE_RUNTIME_OWNER_FILENAME = ".owner.json";
const CLONE_RUNTIME_OWNER_VERSION = 1;
const MAX_CLONE_RUNTIME_OWNER_BYTES = 1024;

export interface GitHubUrlInfo {
	owner: string;
	repo: string;
	ref?: string;
	refIsFullSha: boolean;
	path?: string;
	type: "root" | "blob" | "tree";
}

interface CachedClone {
	destination: CloneDestination;
	clonePromise: Promise<string | null>;
}

interface CloneDestination {
	rootPath: string;
	localPath: string;
}

interface CloneRuntimeOwner {
	version: 1;
	pid: number;
	platform: string;
	bootId?: string;
	startTime?: string;
}

interface GitHubCloneConfig {
	enabled: boolean;
	maxRepoSizeMB: number;
	cloneTimeoutSeconds: number;
	clonePath: string;
}

const cloneCache = new Map<string, CachedClone>();
const startedCloneRuntimeCleanups = new Set<string>();

let cachedConfig: GitHubCloneConfig | null = null;
let cloneRuntime: { parentPath: string; rootPath: string } | null = null;

function normalizeEnabled(value: unknown, fallback: boolean): boolean {
	return typeof value === "boolean" ? value : fallback;
}

function normalizePositiveNumber(value: unknown, fallback: number): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
	return value > 0 ? value : fallback;
}

function expandPath(value: string): string {
	let expanded = value;
	// Expand ~ at the start of the path
	if (expanded.startsWith("~/") || expanded === "~") {
		expanded = expanded.replace(/^~/, process.env.HOME || process.env.USERPROFILE || "");
	}
	// Expand environment variables like $HOME, $USER, etc.
	expanded = expanded.replace(/\$([A-Z_][A-Z0-9_]*)/gi, (match, varName) => {
		return process.env[varName] ?? match;
	});
	return expanded;
}

function normalizeClonePath(value: unknown, fallback: string): string {
	if (typeof value !== "string") return fallback;
	const normalized = value.trim();
	if (normalized.length === 0) return fallback;
	return expandPath(normalized);
}

function loadGitHubConfig(): GitHubCloneConfig {
	if (cachedConfig) return cachedConfig;

	const defaults: GitHubCloneConfig = {
		enabled: true,
		maxRepoSizeMB: 350,
		cloneTimeoutSeconds: 30,
		clonePath: "/tmp/pi-github-repos",
	};

	if (!existsSync(CONFIG_PATH)) {
		cachedConfig = defaults;
		return cachedConfig;
	}

	const rawText = readFileSync(CONFIG_PATH, "utf-8");
	let raw: { githubClone?: { enabled?: unknown; maxRepoSizeMB?: unknown; cloneTimeoutSeconds?: unknown; clonePath?: unknown } };
	try {
		raw = JSON.parse(rawText) as { githubClone?: { enabled?: unknown; maxRepoSizeMB?: unknown; cloneTimeoutSeconds?: unknown; clonePath?: unknown } };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		throw new Error(`Failed to parse ${CONFIG_PATH}: ${message}`);
	}

	const gc = raw.githubClone ?? {};
	cachedConfig = {
		enabled: normalizeEnabled(gc.enabled, defaults.enabled),
		maxRepoSizeMB: normalizePositiveNumber(gc.maxRepoSizeMB, defaults.maxRepoSizeMB),
		cloneTimeoutSeconds: normalizePositiveNumber(gc.cloneTimeoutSeconds, defaults.cloneTimeoutSeconds),
		clonePath: normalizeClonePath(gc.clonePath, defaults.clonePath),
	};
	return cachedConfig;
}

const NON_CODE_SEGMENTS = new Set([
	"issues", "pull", "pulls", "discussions", "releases", "wiki",
	"actions", "settings", "security", "projects", "graphs",
	"compare", "commits", "tags", "branches", "stargazers",
	"watchers", "network", "forks", "milestone", "labels",
	"packages", "codespaces", "contribute", "community",
	"sponsors", "invitations", "notifications", "insights",
]);

export function parseGitHubUrl(url: string): GitHubUrlInfo | null {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return null;
	}

	const host = parsed.hostname.toLowerCase();
	if (host !== "github.com" && host !== "www.github.com") return null;

	const segments: string[] = [];
	for (const segment of parsed.pathname.split("/").filter(Boolean)) {
		try {
			segments.push(decodeURIComponent(segment));
		} catch {
			return null;
		}
	}
	if (segments.length < 2) return null;

	const owner = segments[0];
	const repo = segments[1].replace(/\.git$/, "");
	if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(owner)) return null;
	if (owner.includes("--")) return null;
	if (!/^[A-Za-z0-9._-]{1,100}$/.test(repo) || repo === "." || repo === "..") return null;

	if (NON_CODE_SEGMENTS.has(segments[2]?.toLowerCase())) return null;

	if (segments.length === 2) {
		return { owner, repo, refIsFullSha: false, type: "root" };
	}

	const action = segments[2];
	if (action !== "blob" && action !== "tree") return null;
	if (segments.length < 4) return null;

	const ref = segments[3];
	if (ref.length === 0 || ref.length > 1024 || /[\0-\x1f\x7f]/.test(ref)) return null;
	const refIsFullSha = /^[0-9a-f]{40}$/.test(ref);
	const pathParts = segments.slice(4);
	const path = pathParts.length > 0 ? pathParts.join("/") : "";

	return {
		owner,
		repo,
		ref,
		refIsFullSha,
		path,
		type: action as "blob" | "tree",
	};
}

function cacheKey(owner: string, repo: string, ref?: string): string {
	return ref ? `${owner}/${repo}@${ref}` : `${owner}/${repo}`;
}

function readLinuxBootId(): string | null {
	try {
		const bootId = readFileSync("/proc/sys/kernel/random/boot_id", "utf-8").trim();
		return bootId.length > 0 ? bootId : null;
	} catch {
		return null;
	}
}

async function readLinuxBootIdAsync(): Promise<string | null> {
	try {
		const bootId = (await readFileAsync("/proc/sys/kernel/random/boot_id", "utf-8")).trim();
		return bootId.length > 0 ? bootId : null;
	} catch {
		return null;
	}
}

interface LinuxProcessInfo {
	state: string;
	startTime: string | null;
	dead: boolean;
}

function parseLinuxProcessInfo(stat: string): LinuxProcessInfo | null {
	const closingParen = stat.lastIndexOf(") ");
	if (closingParen < 0) return null;
	const fields = stat.slice(closingParen + 2).trim().split(/\s+/);
	const state = fields[0];
	const startTime = fields[19];
	if (!state || !startTime || !/^\d+$/.test(startTime)) return null;
	return { state, startTime, dead: false };
}

function readLinuxProcessInfo(pid: number): LinuxProcessInfo | null {
	try {
		return parseLinuxProcessInfo(readFileSync(`/proc/${pid}/stat`, "utf-8"));
	} catch (err) {
		if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") {
			return { state: "", startTime: null, dead: true };
		}
		return null;
	}
}

async function readLinuxProcessInfoAsync(pid: number): Promise<LinuxProcessInfo | null> {
	try {
		return parseLinuxProcessInfo(await readFileAsync(`/proc/${pid}/stat`, "utf-8"));
	} catch (err) {
		if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") {
			return { state: "", startTime: null, dead: true };
		}
		return null;
	}
}

function currentCloneRuntimeOwner(): CloneRuntimeOwner {
	const owner: CloneRuntimeOwner = {
		version: CLONE_RUNTIME_OWNER_VERSION,
		pid: process.pid,
		platform: process.platform,
	};

	if (process.platform === "linux") {
		const bootId = readLinuxBootId();
		const processInfo = readLinuxProcessInfo(process.pid);
		if (bootId && processInfo?.startTime) {
			owner.bootId = bootId;
			owner.startTime = processInfo.startTime;
		}
	}

	return owner;
}

function writeCloneRuntimeOwner(runtimePath: string): void {
	const ownerPath = join(runtimePath, CLONE_RUNTIME_OWNER_FILENAME);
	writeFileSync(ownerPath, JSON.stringify(currentCloneRuntimeOwner()), {
		encoding: "utf-8",
		flag: "wx",
		mode: 0o600,
	});
}

function parseCloneRuntimeOwner(text: string): CloneRuntimeOwner | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return null;
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;

	const record = parsed as Record<string, unknown>;
	if (
		record.version !== CLONE_RUNTIME_OWNER_VERSION ||
		typeof record.pid !== "number" ||
		!Number.isSafeInteger(record.pid) ||
		record.pid <= 0 ||
		typeof record.platform !== "string" ||
		record.platform.length === 0 ||
		record.platform.length > 32
	) {
		return null;
	}

	const owner: CloneRuntimeOwner = {
		version: CLONE_RUNTIME_OWNER_VERSION,
		pid: record.pid,
		platform: record.platform,
	};
	if (record.bootId !== undefined) {
		if (typeof record.bootId !== "string" || record.bootId.length === 0 || record.bootId.length > 256) return null;
		owner.bootId = record.bootId;
	}
	if (record.startTime !== undefined) {
		if (typeof record.startTime !== "string" || !/^\d+$/.test(record.startTime)) return null;
		owner.startTime = record.startTime;
	}
	return owner;
}

async function readCloneRuntimeOwner(runtimePath: string): Promise<CloneRuntimeOwner | null> {
	const ownerPath = join(runtimePath, CLONE_RUNTIME_OWNER_FILENAME);
	let file: FileHandle | undefined;
	try {
		const entry = await lstatAsync(ownerPath);
		if (!entry.isFile() || entry.size > MAX_CLONE_RUNTIME_OWNER_BYTES) return null;
		const noFollow = fsConstants.O_NOFOLLOW ?? 0;
		file = await openAsync(ownerPath, fsConstants.O_RDONLY | noFollow);
		const opened = await file.stat();
		if (!opened.isFile() || opened.size > MAX_CLONE_RUNTIME_OWNER_BYTES) return null;
		return parseCloneRuntimeOwner(await file.readFile("utf-8"));
	} catch {
		return null;
	} finally {
		if (file !== undefined) {
			try {
				await file.close();
			} catch {
				// The handle may already have been closed externally.
			}
		}
	}
}

function processNonexistenceProven(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return false;
	} catch (err) {
		return Boolean(err && typeof err === "object" && "code" in err && err.code === "ESRCH");
	}
}

async function cloneRuntimeOwnerIsDead(owner: CloneRuntimeOwner, bootId: string | null): Promise<boolean> {
	if (owner.platform !== process.platform) return false;

	if (process.platform !== "linux") {
		return processNonexistenceProven(owner.pid);
	}

	// Linux PID values can be reused. Require both boot ID and proc start time
	// before treating a runtime as owned, and preserve it when either check is
	// unavailable.
	if (!owner.bootId || !owner.startTime || !bootId) return false;
	const processInfo = await readLinuxProcessInfoAsync(owner.pid);
	if (!processInfo) return false;
	if (processInfo.dead || processInfo.state === "Z" || processInfo.state === "X") return true;
	return processInfo.startTime !== owner.startTime || bootId !== owner.bootId;
}

async function removeCloneRuntimeAsync(parentPath: string, runtimePath: string): Promise<void> {
	const normalizedParentPath = resolvePath(parentPath);
	const normalizedRuntimePath = resolvePath(runtimePath);
	if (dirname(normalizedRuntimePath) !== normalizedParentPath || !basename(normalizedRuntimePath).startsWith("runtime-")) return;

	try {
		const realRuntimePath = await realpathAsync(normalizedRuntimePath);
		if (dirname(realRuntimePath) !== normalizedParentPath || basename(realRuntimePath) !== basename(normalizedRuntimePath)) return;
		const entry = await lstatAsync(normalizedRuntimePath);
		if (entry.isSymbolicLink() || !entry.isDirectory()) return;
		await rmAsync(normalizedRuntimePath, { recursive: true, force: true });
	} catch {
		// The runtime directory may already have been removed externally.
	}
}

async function sweepStaleCloneRuntimes(parentPath: string): Promise<void> {
	const normalizedParentPath = resolvePath(parentPath);
	const bootId = process.platform === "linux" ? await readLinuxBootIdAsync() : null;
	try {
		const directory = await opendirAsync(normalizedParentPath);
		for await (const entry of directory) {
			if (!entry.name.startsWith("runtime-")) continue;
			try {
				if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
				const runtimePath = resolvePath(normalizedParentPath, entry.name);
				if (dirname(runtimePath) !== normalizedParentPath) continue;
				const runtimeEntry = await lstatAsync(runtimePath);
				if (!runtimeEntry.isDirectory() || runtimeEntry.isSymbolicLink()) continue;
				const realRuntimePath = await realpathAsync(runtimePath);
				if (dirname(realRuntimePath) !== normalizedParentPath || basename(realRuntimePath) !== basename(runtimePath)) continue;
				const owner = await readCloneRuntimeOwner(runtimePath);
				if (!owner || !(await cloneRuntimeOwnerIsDead(owner, bootId))) continue;
				await removeCloneRuntimeAsync(normalizedParentPath, runtimePath);
			} catch {
				// A changing or unreadable runtime must not stop the rest of the sweep.
			}
		}
	} catch {
		// Cleanup is opportunistic. A changing or unreadable cache must not stop
		// GitHub extraction from falling back to the API.
	}
}

function startStaleCloneRuntimeCleanup(parentPath: string): void {
	const normalizedParentPath = resolvePath(parentPath);
	if (startedCloneRuntimeCleanups.has(normalizedParentPath)) return;
	startedCloneRuntimeCleanups.add(normalizedParentPath);
	// Keep runtime creation synchronous and let the complete sweep run in the background.
	void sweepStaleCloneRuntimes(normalizedParentPath).catch(() => {
		// Cleanup is best effort and must never affect extraction.
	});
}

function removeCloneRuntime(parentPath: string, runtimePath: string): void {
	const normalizedParentPath = resolvePath(parentPath);
	const normalizedRuntimePath = resolvePath(runtimePath);
	if (dirname(normalizedRuntimePath) !== normalizedParentPath || !basename(normalizedRuntimePath).startsWith("runtime-")) return;

	try {
		const entry = lstatSync(normalizedRuntimePath);
		if (entry.isSymbolicLink()) unlinkSync(normalizedRuntimePath);
		else rmSync(normalizedRuntimePath, { recursive: true, force: true });
	} catch {
		// The runtime directory may already have been removed externally.
	}
}

function getCloneRuntimeRoot(config: GitHubCloneConfig): string | null {
	if (cloneRuntime) return cloneRuntime.rootPath;

	let parentPath: string | null = null;
	let runtimePath: string | null = null;
	try {
		const configuredPath = resolvePath(config.clonePath);
		mkdirSync(configuredPath, { recursive: true });
		parentPath = realpathSync(configuredPath);
		startStaleCloneRuntimeCleanup(parentPath);
		runtimePath = mkdtempSync(join(parentPath, "runtime-"));
		chmodSync(runtimePath, 0o700);
		const rootPath = realpathSync(runtimePath);
		if (dirname(rootPath) !== parentPath) {
			removeCloneRuntime(parentPath, runtimePath);
			return null;
		}
		writeCloneRuntimeOwner(rootPath);
		cloneRuntime = { parentPath, rootPath };
		return rootPath;
	} catch {
		if (parentPath && runtimePath) removeCloneRuntime(parentPath, runtimePath);
		return null;
	}
}

function cloneDestination(config: GitHubCloneConfig, owner: string, repo: string, ref?: string): CloneDestination | null {
	try {
		const rootPath = getCloneRuntimeRoot(config);
		if (!rootPath) return null;
		const digest = createHash("sha256").update(JSON.stringify([owner, repo, ref ?? null])).digest("hex");
		const localPath = resolvePath(rootPath, digest);
		if (dirname(localPath) !== rootPath) return null;
		return { rootPath, localPath };
	} catch {
		return null;
	}
}

function removeCloneDestination(destination: CloneDestination): boolean {
	const rootPath = resolvePath(destination.rootPath);
	const localPath = resolvePath(destination.localPath);
	if (dirname(localPath) !== rootPath || !/^[0-9a-f]{64}$/.test(basename(localPath))) return false;
	try {
		const entry = lstatSync(localPath);
		if (entry.isSymbolicLink()) unlinkSync(localPath);
		else rmSync(localPath, { recursive: true, force: true });
		return true;
	} catch (err) {
		if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") return true;
		return false;
	}
}

const PROCESS_KILL_GRACE_MS = 3000;

function terminateProcessTree(child: ChildProcess): void {
	const pid = child.pid;
	if (!pid) return;

	if (process.platform === "win32") {
		const killer = execFile(
			"taskkill",
			["/pid", String(pid), "/T", "/F"],
			{ windowsHide: true },
			(err) => {
				if (err) child.kill();
			},
		);
		killer.unref();
		return;
	}

	try {
		// Clone commands run in their own process group so git/gh helpers cannot
		// survive a timeout or cancellation and keep reading from the host TTY.
		process.kill(-pid, "SIGTERM");
	} catch {
		child.kill();
	}

	// A credential helper may handle or ignore SIGTERM. Escalate against the
	// entire process group so neither git nor any descendant can block forever.
	const forceKill = setTimeout(() => {
		try {
			process.kill(-pid, "SIGKILL");
		} catch {
			child.kill("SIGKILL");
		}
	}, PROCESS_KILL_GRACE_MS);
	forceKill.unref();
}

function execClone(args: string[], destination: CloneDestination, timeoutMs: number, signal?: AbortSignal): Promise<string | null> {
	return new Promise((resolve) => {
		const { localPath } = destination;
		let settled = false;
		let timeout: ReturnType<typeof setTimeout> | undefined;
		let onAbort: (() => void) | undefined;

		const finish = (success: boolean) => {
			if (settled) return;
			settled = true;
			if (timeout) clearTimeout(timeout);
			if (signal && onAbort) signal.removeEventListener("abort", onAbort);

			if (!success) {
				removeCloneDestination(destination);
				resolve(null);
				return;
			}
			resolve(localPath);
		};

		const child = spawn(args[0], args.slice(1), {
			detached: process.platform !== "win32",
			env: {
				...process.env,
				GIT_TERMINAL_PROMPT: "0",
				GCM_INTERACTIVE: "Never",
				GH_PROMPT_DISABLED: "1",
			},
			stdio: "ignore",
			windowsHide: true,
		});

		child.once("error", () => finish(false));
		child.once("close", (code) => finish(code === 0));

		timeout = setTimeout(() => terminateProcessTree(child), timeoutMs);
		timeout.unref();

		if (signal) {
			onAbort = () => {
				if (timeout) clearTimeout(timeout);
				terminateProcessTree(child);
			};
			if (signal.aborted) onAbort();
			else signal.addEventListener("abort", onAbort, { once: true });
		}
	});
}

async function cloneRepo(
	owner: string,
	repo: string,
	ref: string | undefined,
	config: GitHubCloneConfig,
	destination: CloneDestination,
	signal?: AbortSignal,
): Promise<string | null> {
	const { localPath } = destination;
	if (!removeCloneDestination(destination)) return null;

	const timeoutMs = config.cloneTimeoutSeconds * 1000;
	const hasGh = await checkGhAvailable();

	if (hasGh) {
		const args = ["gh", "repo", "clone", `${owner}/${repo}`, localPath, "--", "--depth", "1", "--single-branch"];
		if (ref) args.push("--branch", ref);
		return execClone(args, destination, timeoutMs, signal);
	}

	showGhHint();

	const gitUrl = `https://github.com/${owner}/${repo}.git`;
	const args = ["git", "clone", "--depth", "1", "--single-branch"];
	if (ref) args.push("--branch", ref);
	args.push(gitUrl, localPath);
	return execClone(args, destination, timeoutMs, signal);
}

function isBinaryFile(filePath: string): boolean {
	const ext = extname(filePath).toLowerCase();
	if (BINARY_EXTENSIONS.has(ext)) return true;

	let fd: number;
	try {
		fd = openSync(filePath, "r");
	} catch {
		return false;
	}
	try {
		const buf = Buffer.alloc(512);
		const bytesRead = readSync(fd, buf, 0, 512, 0);
		for (let i = 0; i < bytesRead; i++) {
			if (buf[i] === 0) return true;
		}
	} catch {
		return false;
	} finally {
		closeSync(fd);
	}

	return false;
}

function formatFileSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function resolveWithinRepo(rootPath: string, relativePath: string): string | null {
	const normalizedRoot = resolvePath(rootPath);
	const candidate = resolvePath(normalizedRoot, relativePath);
	if (candidate !== normalizedRoot) {
		const rootPrefix = normalizedRoot.endsWith(pathSep) ? normalizedRoot : normalizedRoot + pathSep;
		if (!candidate.startsWith(rootPrefix)) return null;
	}

	if (!existsSync(candidate)) return candidate;

	try {
		const realRoot = realpathSync(normalizedRoot);
		const realCandidate = realpathSync(candidate);
		if (realCandidate === realRoot) return candidate;
		const realRootPrefix = realRoot.endsWith(pathSep) ? realRoot : realRoot + pathSep;
		return realCandidate.startsWith(realRootPrefix) ? candidate : null;
	} catch {
		return null;
	}
}

function readTextFile(path: string): string | null {
	try {
		return readFileSync(path, "utf-8");
	} catch {
		return null;
	}
}

function buildTree(rootPath: string): string {
	const entries: string[] = [];

	function walk(dir: string, relPath: string): void {
		if (entries.length >= MAX_TREE_ENTRIES) return;

		let items: string[];
		try {
			items = readdirSync(dir).sort();
		} catch {
			return;
		}

		for (const item of items) {
			if (entries.length >= MAX_TREE_ENTRIES) return;
			if (item === ".git") continue;

			const rel = relPath ? `${relPath}/${item}` : item;
			const safePath = resolveWithinRepo(rootPath, rel);
			if (!safePath) {
				entries.push(`${rel}  [outside repo skipped]`);
				continue;
			}

			let stat;
			try {
				stat = statSync(safePath);
			} catch {
				continue;
			}

			if (stat.isDirectory()) {
				if (NOISE_DIRS.has(item)) {
					entries.push(`${rel}/  [skipped]`);
					continue;
				}
				entries.push(`${rel}/`);
				walk(safePath, rel);
			} else {
				entries.push(rel);
			}
		}
	}

	walk(rootPath, "");

	if (entries.length >= MAX_TREE_ENTRIES) {
		entries.push(`... (truncated at ${MAX_TREE_ENTRIES} entries)`);
	}

	return entries.join("\n");
}

function buildDirListing(rootPath: string, subPath: string): string {
	const targetPath = resolveWithinRepo(rootPath, subPath);
	if (!targetPath) return "(path escapes repository root)";
	const lines: string[] = [];

	let items: string[];
	try {
		items = readdirSync(targetPath).sort();
	} catch {
		return "(directory not readable)";
	}

	for (const item of items) {
		if (item === ".git") continue;
		const rel = subPath ? `${subPath}/${item}` : item;
		const safePath = resolveWithinRepo(rootPath, rel);
		if (!safePath) {
			lines.push(`  ${item}  (outside repo)`);
			continue;
		}
		try {
			const stat = statSync(safePath);
			if (stat.isDirectory()) {
				lines.push(`  ${item}/`);
			} else {
				lines.push(`  ${item}  (${formatFileSize(stat.size)})`);
			}
		} catch {
			lines.push(`  ${item}  (unreadable)`);
		}
	}

	return lines.join("\n");
}

function readReadme(localPath: string): string | null {
	const candidates = ["README.md", "readme.md", "README", "README.txt", "README.rst"];
	for (const name of candidates) {
		const readmePath = join(localPath, name);
		if (existsSync(readmePath)) {
			try {
				const content = readFileSync(readmePath, "utf-8");
				return content.length > 8192 ? content.slice(0, 8192) + "\n\n[README truncated at 8K chars]" : content;
			} catch {
				continue;
			}
		}
	}
	return null;
}

function generateContent(localPath: string, info: GitHubUrlInfo): string {
	const lines: string[] = [];
	lines.push(`Repository cloned to: ${localPath}`);
	lines.push("");

	if (info.type === "root") {
		lines.push("## Structure");
		lines.push(buildTree(localPath));
		lines.push("");

		const readme = readReadme(localPath);
		if (readme) {
			lines.push("## README.md");
			lines.push(readme);
			lines.push("");
		}

		lines.push("Use `read` and `bash` tools at the path above to explore further.");
		return lines.join("\n");
	}

	if (info.type === "tree") {
		const dirPath = info.path || "";
		const fullDirPath = resolveWithinRepo(localPath, dirPath);

		if (!fullDirPath || !existsSync(fullDirPath)) {
			lines.push(`Path \`${dirPath}\` not found in clone. Showing repository root instead.`);
			lines.push("");
			lines.push("## Structure");
			lines.push(buildTree(localPath));
		} else {
			lines.push(`## ${dirPath || "/"}`);
			lines.push(buildDirListing(localPath, dirPath));
		}

		lines.push("");
		lines.push("Use `read` and `bash` tools at the path above to explore further.");
		return lines.join("\n");
	}

	if (info.type === "blob") {
		const filePath = info.path || "";
		const fullFilePath = resolveWithinRepo(localPath, filePath);

		if (!fullFilePath || !existsSync(fullFilePath)) {
			lines.push(`Path \`${filePath}\` not found in clone. Showing repository root instead.`);
			lines.push("");
			lines.push("## Structure");
			lines.push(buildTree(localPath));
			lines.push("");
			lines.push("Use `read` and `bash` tools at the path above to explore further.");
			return lines.join("\n");
		}

		let stat: ReturnType<typeof statSync>;
		try {
			stat = statSync(fullFilePath);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			lines.push(`Could not inspect \`${filePath}\`: ${message}`);
			lines.push("");
			lines.push("Use `read` and `bash` tools at the path above to explore further.");
			return lines.join("\n");
		}

		if (stat.isDirectory()) {
			lines.push(`## ${filePath || "/"}`);
			lines.push(buildDirListing(localPath, filePath));
			lines.push("");
			lines.push("Use `read` and `bash` tools at the path above to explore further.");
			return lines.join("\n");
		}

		if (isBinaryFile(fullFilePath)) {
			const ext = extname(filePath).replace(".", "");
			lines.push(`## ${filePath}`);
			lines.push(`Binary file (${ext}, ${formatFileSize(stat.size)}). Use \`read\` or \`bash\` tools at the path above to inspect.`);
			return lines.join("\n");
		}

		const content = readTextFile(fullFilePath);
		if (content === null) {
			lines.push(`Could not read \`${filePath}\` as UTF-8 text.`);
			lines.push("");
			lines.push("Use `read` and `bash` tools at the path above to explore further.");
			return lines.join("\n");
		}
		lines.push(`## ${filePath}`);

		if (content.length > MAX_INLINE_FILE_CHARS) {
			lines.push(content.slice(0, MAX_INLINE_FILE_CHARS));
			lines.push("");
			lines.push(`[File truncated at 100K chars. Full file: ${fullFilePath}]`);
		} else {
			lines.push(content);
		}

		lines.push("");
		lines.push("Use `read` and `bash` tools at the path above to explore further.");
		return lines.join("\n");
	}

	return lines.join("\n");
}

async function awaitCachedClone(
	cached: CachedClone,
	url: string,
	owner: string,
	repo: string,
	info: GitHubUrlInfo,
	signal?: AbortSignal,
): Promise<ExtractedContent | null> {
	if (signal?.aborted) return null;
	const result = await cached.clonePromise;
	if (signal?.aborted) return null;
	if (result) {
		const content = generateContent(result, info);
		const title = info.path ? `${owner}/${repo} - ${info.path}` : `${owner}/${repo}`;
		return { url, title, content, error: null };
	}
	return fetchViaApi(url, owner, repo, info);
}

export async function extractGitHub(
	url: string,
	signal?: AbortSignal,
	forceClone?: boolean,
): Promise<ExtractedContent | null> {
	const info = parseGitHubUrl(url);
	if (!info) return null;

	if (signal?.aborted) return null;

	const config = loadGitHubConfig();
	if (!config.enabled) return null;

	const { owner, repo } = info;
	const key = cacheKey(owner, repo, info.ref);

	const cached = cloneCache.get(key);
	if (cached) return awaitCachedClone(cached, url, owner, repo, info, signal);

	if (info.refIsFullSha) {
		if (signal?.aborted) return null;
		const sizeNote = `Note: Commit SHA URLs use the GitHub API instead of cloning.`;
		return fetchViaApi(url, owner, repo, info, sizeNote);
	}

	const activityId = activityMonitor.logStart({ type: "fetch", url: `github.com/${owner}/${repo}` });

	if (!forceClone) {
		const sizeKB = await checkRepoSize(owner, repo);
		if (signal?.aborted) {
			activityMonitor.logComplete(activityId, 0);
			return null;
		}
		if (sizeKB !== null) {
			const sizeMB = sizeKB / 1024;
			if (sizeMB > config.maxRepoSizeMB) {
				if (signal?.aborted) {
					activityMonitor.logComplete(activityId, 0);
					return null;
				}
				const sizeNote =
					`Note: Repository is ${Math.round(sizeMB)}MB (threshold: ${config.maxRepoSizeMB}MB). ` +
					`Showing API-fetched content instead of full clone. Ask the user if they'd like to clone the full repo -- ` +
					`if yes, call fetch_content again with the same URL and add forceClone: true to the params.`;
				const apiView = await fetchViaApi(url, owner, repo, info, sizeNote);
				if (apiView) {
					activityMonitor.logComplete(activityId, 200);
					return apiView;
				}
				activityMonitor.logError(activityId, "api fallback unavailable for oversized repository");
				return null;
			}
		}
	}

	if (signal?.aborted) {
		activityMonitor.logComplete(activityId, 0);
		return null;
	}

	// Re-check: another concurrent caller may have started a clone while we awaited the size check
	const cachedAfterSizeCheck = cloneCache.get(key);
	if (cachedAfterSizeCheck) {
		const cachedResult = await awaitCachedClone(cachedAfterSizeCheck, url, owner, repo, info, signal);
		if (signal?.aborted) {
			activityMonitor.logComplete(activityId, 0);
		} else if (cachedResult) {
			activityMonitor.logComplete(activityId, 200);
		} else {
			activityMonitor.logError(activityId, "clone failed");
		}
		return cachedResult;
	}

	const destination = cloneDestination(config, owner, repo, info.ref);
	if (!destination) {
		const apiFallback = await fetchViaApi(url, owner, repo, info);
		if (apiFallback) activityMonitor.logComplete(activityId, 200);
		else activityMonitor.logError(activityId, "invalid clone destination");
		return apiFallback;
	}
	const clonePromise = cloneRepo(owner, repo, info.ref, config, destination, signal);
	cloneCache.set(key, { destination, clonePromise });

	const result = await clonePromise;
	if (signal?.aborted) {
		if (!result) cloneCache.delete(key);
		activityMonitor.logComplete(activityId, 0);
		return null;
	}

	if (!result) {
		cloneCache.delete(key);
		if (signal?.aborted) {
			activityMonitor.logComplete(activityId, 0);
			return null;
		}

		const apiFallback = await fetchViaApi(url, owner, repo, info);
		if (apiFallback) {
			activityMonitor.logComplete(activityId, 200);
			return apiFallback;
		}

		activityMonitor.logError(activityId, "clone and API fallback failed");
		return null;
	}

	activityMonitor.logComplete(activityId, 200);
	const content = generateContent(result, info);
	const title = info.path ? `${owner}/${repo} - ${info.path}` : `${owner}/${repo}`;
	return { url, title, content, error: null };
}

export function clearCloneCache(): void {
	for (const entry of cloneCache.values()) {
		removeCloneDestination(entry.destination);
	}
	cloneCache.clear();

	if (cloneRuntime) {
		removeCloneRuntime(cloneRuntime.parentPath, cloneRuntime.rootPath);
	}
	cloneRuntime = null;
	cachedConfig = null;
}
