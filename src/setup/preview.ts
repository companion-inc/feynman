import { spawnSync } from "node:child_process";

import { BREW_FALLBACK_PATHS, PANDOC_FALLBACK_PATHS, resolveExecutable } from "../system/executables.js";

export type PreviewSetupResult =
	| { status: "ready"; message: string }
	| { status: "installed"; message: string }
	| { status: "manual"; message: string };

export function setupPreviewDependencies(): PreviewSetupResult {
	const pandocPath = resolveExecutable("pandoc", PANDOC_FALLBACK_PATHS);
	if (pandocPath) {
		return { status: "ready", message: `pandoc already installed at ${pandocPath}` };
	}

	if (process.platform === "darwin") {
		const brewPath = resolveExecutable("brew", BREW_FALLBACK_PATHS);
		if (brewPath) {
			const result = spawnSync(brewPath, ["install", "pandoc"], { stdio: "inherit" });
			if (result.status !== 0) {
				throw new Error("Failed to install pandoc via Homebrew.");
			}
			return { status: "installed", message: "Preview dependency installed: pandoc" };
		}
	}

	if (process.platform === "win32") {
		const wingetPath = resolveExecutable("winget");
		if (wingetPath) {
			const result = spawnSync(wingetPath, ["install", "--id", "JohnMacFarlane.Pandoc", "-e"], { stdio: "inherit" });
			if (result.status === 0) {
				return { status: "installed", message: "Preview dependency installed: pandoc (via winget)" };
			}
		}
	}

	if (process.platform === "linux") {
		const aptPath = resolveExecutable("apt-get");
		if (aptPath) {
			const result = spawnSync(aptPath, ["install", "-y", "pandoc"], { stdio: "inherit" });
			if (result.status === 0) {
				return { status: "installed", message: "Preview dependency installed: pandoc (via apt)" };
			}
		}
	}

	return {
		status: "manual",
		message: "pandoc is required for preview support. Install it manually and rerun `feynman --doctor`.",
	};
}
