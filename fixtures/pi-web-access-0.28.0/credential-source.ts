import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);
const COMMAND_TIMEOUT_MS = 5_000;
const MAX_CREDENTIAL_BYTES = 16_384;
const ENV_SOURCE = /^\$(?:([A-Za-z_][A-Za-z0-9_]*)|\{([A-Za-z_][A-Za-z0-9_]*)\})$/;
const OP_SESSION_NAME = /^OP_SESSION_[A-Za-z0-9_]+$/;
const COMMAND_ENVIRONMENT_NAMES = [
	"HOME",
	"USER",
	"LOGNAME",
	"PATH",
	"LANG",
	"LC_ALL",
	"LC_CTYPE",
	"TERM",
	"TMPDIR",
	"XDG_CONFIG_HOME",
	"XDG_RUNTIME_DIR",
	"DBUS_SESSION_BUS_ADDRESS",
	"SSH_AUTH_SOCK",
	"WSL_DISTRO_NAME",
	"WSL_INTEROP",
] as const;

export type CredentialFailureCategory =
	| "invalid-source"
	| "command-failed"
	| "command-timeout"
	| "command-aborted"
	| "command-empty"
	| "command-invalid-output"
	| "command-output-too-large"
	| "environment-empty"
	| "oauth-credential-rejected";

export class CredentialResolutionError extends Error {
	readonly provider: string;
	readonly category: CredentialFailureCategory;

	constructor(provider: string, category: CredentialFailureCategory) {
		const suffix =
			category === "command-aborted" ? "aborted" :
			category === "oauth-credential-rejected" ? "OAuth token exchange rejected the credentials" :
			category;
		super(`${provider} credential resolution failed: ${suffix}`);
		this.name = "CredentialResolutionError";
		this.provider = provider;
		this.category = category;
	}
}

export interface CredentialCommandResult {
	stdout: string | Buffer;
}

export interface CredentialCommandOptions {
	signal?: AbortSignal;
	timeoutMs: number;
	maxOutputBytes: number;
	environment: Record<string, string>;
}

export type CredentialCommandRunner = (
	command: string,
	options: CredentialCommandOptions,
) => Promise<CredentialCommandResult>;

export interface CredentialOptions {
	provider: string;
	configuredValue?: unknown;
	environmentValue?: unknown;
	environment?: Record<string, string | undefined>;
	signal?: AbortSignal;
	runCommand?: CredentialCommandRunner;
}

export function redactCredential(text: string, credential: string | null | undefined): string {
	return credential ? text.split(credential).join("[redacted]") : text;
}

function normalize(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const normalized = value.trim();
	return normalized.length > 0 ? normalized : null;
}

function commandEnvironment(source: Record<string, string | undefined>): Record<string, string> {
	const environment: Record<string, string> = {};
	for (const name of COMMAND_ENVIRONMENT_NAMES) {
		const value = source[name];
		if (value !== undefined) environment[name] = value;
	}
	for (const [name, value] of Object.entries(source)) {
		if (value !== undefined && OP_SESSION_NAME.test(name)) environment[name] = value;
	}
	return environment;
}

function configuredSource(options: CredentialOptions): string | null {
	return normalize(options.configuredValue);
}

function explicitEnvironmentName(source: string): string | null {
	const match = source.match(ENV_SOURCE);
	return match ? match[1] ?? match[2] : null;
}

function escapedSource(source: string): string | null {
	if (source.startsWith("$$") || source.startsWith("$!")) return source.slice(1);
	return null;
}

function isMalformedExplicitSource(source: string): boolean {
	return source.startsWith("$") && escapedSource(source) === null && explicitEnvironmentName(source) === null;
}

async function defaultRunCommand(
	command: string,
	options: CredentialCommandOptions,
): Promise<CredentialCommandResult> {
	const result = await execAsync(command, {
		encoding: "utf8",
		env: options.environment,
		maxBuffer: options.maxOutputBytes + 1,
		signal: options.signal,
		timeout: options.timeoutMs,
		windowsHide: true,
	});
	return { stdout: result.stdout };
}

function commandFailureCategory(error: unknown, signal?: AbortSignal): CredentialFailureCategory {
	if (signal?.aborted) return "command-aborted";
	if (error && typeof error === "object") {
		const code = (error as { code?: string }).code;
		if (code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") return "command-output-too-large";
		if ((error as { killed?: boolean }).killed || code === "ETIMEDOUT") return "command-timeout";
	}
	return "command-failed";
}

export function hasCredentialSource(options: CredentialOptions): boolean {
	const source = configuredSource(options);
	if (source?.startsWith("!")) return true;
	if (source?.startsWith("$")) return true;
	return normalize(options.environmentValue) !== null || source !== null;
}

export async function resolveCredential(options: CredentialOptions): Promise<string | null> {
	const source = configuredSource(options);
	const escaped = source ? escapedSource(source) : null;
	if (escaped !== null) return escaped;
	if (source?.startsWith("!")) {
		const command = source.slice(1).trim();
		if (!command) throw new CredentialResolutionError(options.provider, "invalid-source");
		let result: CredentialCommandResult;
		try {
			result = await (options.runCommand ?? defaultRunCommand)(command, {
				signal: options.signal,
				timeoutMs: COMMAND_TIMEOUT_MS,
				maxOutputBytes: MAX_CREDENTIAL_BYTES,
				environment: commandEnvironment(options.environment ?? process.env),
			});
		} catch (error) {
			throw new CredentialResolutionError(options.provider, commandFailureCategory(error, options.signal));
		}
		const stdout = Buffer.isBuffer(result.stdout) ? result.stdout.toString("utf8") : result.stdout;
		if (Buffer.byteLength(stdout, "utf8") > MAX_CREDENTIAL_BYTES) {
			throw new CredentialResolutionError(options.provider, "command-output-too-large");
		}
		const value = stdout.trim();
		if (!value) throw new CredentialResolutionError(options.provider, "command-empty");
		if (/[\0-\x1f\x7f]/.test(value)) {
			throw new CredentialResolutionError(options.provider, "command-invalid-output");
		}
		return value;
	}
	if (source && isMalformedExplicitSource(source)) {
		throw new CredentialResolutionError(options.provider, "invalid-source");
	}
	if (source?.startsWith("$")) {
		const name = explicitEnvironmentName(source);
		if (!name) throw new CredentialResolutionError(options.provider, "invalid-source");
		const value = normalize((options.environment ?? process.env)[name]);
		if (!value) throw new CredentialResolutionError(options.provider, "environment-empty");
		return value;
	}
	return normalize(options.environmentValue) ?? source;
}
