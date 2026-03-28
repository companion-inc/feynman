import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import { registerAlphaTools } from "./research-tools/alpha.js";
import { registerFeynmanModelCommand } from "./research-tools/feynman-model.js";
import { installFeynmanHeader } from "./research-tools/header.js";
import { registerHelpCommand } from "./research-tools/help.js";
import { registerInitCommand, registerOutputsCommand } from "./research-tools/project.js";

export default function researchTools(pi: ExtensionAPI): void {
	const cache: { agentSummaryPromise?: Promise<{ agents: string[]; chains: string[] }> } = {};

	pi.on("session_start", async (_event, ctx) => {
		await installFeynmanHeader(pi, ctx, cache);
	});

	pi.on("session_switch", async (_event, ctx) => {
		await installFeynmanHeader(pi, ctx, cache);
	});

	registerAlphaTools(pi);
	registerFeynmanModelCommand(pi);
	registerHelpCommand(pi);
	registerInitCommand(pi);
	registerOutputsCommand(pi);
}
