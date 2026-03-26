import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

export const PANDOC_FALLBACK_PATHS = [
	"/opt/homebrew/bin/pandoc",
	"/usr/local/bin/pandoc",
];

export const BREW_FALLBACK_PATHS = [
	"/opt/homebrew/bin/brew",
	"/usr/local/bin/brew",
];

export const BROWSER_FALLBACK_PATHS = [
	"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
	"/Applications/Chromium.app/Contents/MacOS/Chromium",
	"/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
	"/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
];

export const MERMAID_FALLBACK_PATHS = [
	"/opt/homebrew/bin/mmdc",
	"/usr/local/bin/mmdc",
];

export function resolveExecutable(name: string, fallbackPaths: string[] = []): string | undefined {
	for (const candidate of fallbackPaths) {
		if (existsSync(candidate)) {
			return candidate;
		}
	}

	if (process.platform === "win32") {
		const result = spawnSync("where", [name], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		});
		if (result.status === 0) {
			const resolved = result.stdout
				.split(/\r?\n/)
				.map((entry) => entry.trim())
				.find(Boolean);
			if (resolved) {
				return resolved;
			}
		}
		return undefined;
	}

	const result = spawnSync("sh", ["-lc", `command -v ${name}`], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "ignore"],
	});

	if (result.status === 0) {
		const resolved = result.stdout.trim();
		if (resolved) {
			return resolved;
		}
	}

	return undefined;
}
