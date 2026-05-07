import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { patchPiAgentCoreSource } from "../../scripts/lib/pi-agent-core-patch.mjs";
import { patchPiInteractiveModeSource } from "../../scripts/lib/pi-custom-provider-patch.mjs";
import { patchPiTuiSource } from "../../scripts/lib/pi-tui-patch.mjs";

function patchFileIfPresent(path: string, patchSource: (source: string) => string): boolean {
	if (!existsSync(path)) {
		return false;
	}
	const source = readFileSync(path, "utf8");
	const patched = patchSource(source);
	if (patched === source) {
		return false;
	}
	writeFileSync(path, patched, "utf8");
	return true;
}

export function patchPiRuntimeNodeModules(appRoot: string): boolean {
	const agentCoreChanged = patchFileIfPresent(
		resolve(appRoot, "node_modules", "@mariozechner", "pi-agent-core", "dist", "agent-loop.js"),
		patchPiAgentCoreSource,
	);
	const tuiChanged = patchFileIfPresent(
		resolve(appRoot, "node_modules", "@mariozechner", "pi-tui", "dist", "tui.js"),
		patchPiTuiSource,
	);
	const interactiveChanged = patchFileIfPresent(
		resolve(appRoot, "node_modules", "@mariozechner", "pi-coding-agent", "dist", "modes", "interactive", "interactive-mode.js"),
		patchPiInteractiveModeSource,
	);
	return agentCoreChanged || tuiChanged || interactiveChanged;
}
