import { spawn } from "node:child_process";

import { resolveExecutable } from "./executables.js";

type ResolveExecutableFn = (name: string, fallbackPaths?: string[]) => string | undefined;

type OpenUrlCommand = {
	command: string;
	args: string[];
};

export function getOpenUrlCommand(
	url: string,
	platform = process.platform,
	resolveCommand: ResolveExecutableFn = resolveExecutable,
): OpenUrlCommand | undefined {
	if (platform === "win32") {
		// Use explorer.exe directly instead of cmd /c start to avoid
		// shell metacharacter injection (CWE-78).
		return {
			command: "explorer",
			args: [url],
		};
	}

	if (platform === "darwin") {
		const command = resolveCommand("open");
		return command ? { command, args: [url] } : undefined;
	}

	const command = resolveCommand("xdg-open");
	return command ? { command, args: [url] } : undefined;
}

export function openUrl(url: string): boolean {
	const command = getOpenUrlCommand(url);
	if (!command) {
		return false;
	}

	try {
		const child = spawn(command.command, command.args, {
			detached: true,
			stdio: "ignore",
			windowsHide: true,
		});
		child.on("error", () => {});
		child.unref();
		return true;
	} catch {
		return false;
	}
}
