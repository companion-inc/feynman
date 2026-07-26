import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { registerAlphaTools } from "./research-tools/alpha.js";
import { registerChemistrySketcherTool } from "./research-tools/chemistry-sketcher.js";
import { registerDiscoveryCommands } from "./research-tools/discovery.js";
import { registerFeynmanModelCommand } from "./research-tools/feynman-model.js";
import { installFeynmanHeader } from "./research-tools/header.js";
import { registerHelpCommand } from "./research-tools/help.js";
import { registerHuggingFaceTools } from "./research-tools/huggingface.js";
import { registerInitCommand, registerOutputsCommand } from "./research-tools/project.js";
import { registerServiceTierControls } from "./research-tools/service-tier.js";
import { registerScienceDatabaseTools } from "./research-tools/science-databases.js";
import { registerThinkingCommand } from "./research-tools/thinking.js";
import { registerModelEndpointTools } from "./research-tools/model-endpoints.js";
import { registerWorkbenchConnectorTools } from "./research-tools/workbench-connectors.js";
import { registerWorkbenchContextTool } from "./research-tools/workbench-context.js";

export default function researchTools(pi: ExtensionAPI): void {
	const cache: { agentSummaryPromise?: Promise<{ agents: string[]; chains: string[] }> } = {};

	// Pi 0.66.x folds post-switch/resume lifecycle into session_start.
	pi.on("session_start", async (_event, ctx) => {
		await installFeynmanHeader(pi, ctx, cache);
	});

	registerAlphaTools(pi);
	registerChemistrySketcherTool(pi);
	registerHuggingFaceTools(pi);
	registerDiscoveryCommands(pi);
	registerFeynmanModelCommand(pi);
	registerHelpCommand(pi);
	registerInitCommand(pi);
	registerOutputsCommand(pi);
	registerServiceTierControls(pi);
	registerThinkingCommand(pi);
	registerScienceDatabaseTools(pi);
	registerModelEndpointTools(pi);
	registerWorkbenchConnectorTools(pi);
	registerWorkbenchContextTool(pi);
}
