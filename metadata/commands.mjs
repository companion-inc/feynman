import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

function parseFrontmatter(text) {
	const match = text.match(/^---\n([\s\S]*?)\n---\n?/);
	if (!match) return {};

	const frontmatter = {};
	for (const line of match[1].split("\n")) {
		const separator = line.indexOf(":");
		if (separator === -1) continue;
		const key = line.slice(0, separator).trim();
		const value = line.slice(separator + 1).trim();
		if (!key) continue;
		frontmatter[key] = value;
	}
	return frontmatter;
}

export function readPromptSpecs(appRoot) {
	const dir = resolve(appRoot, "prompts");
	return readdirSync(dir)
		.filter((f) => f.endsWith(".md"))
		.map((f) => {
			const text = readFileSync(resolve(dir, f), "utf8");
			const fm = parseFrontmatter(text);
			return {
				name: f.replace(/\.md$/, ""),
				description: fm.description ?? "",
				args: fm.args ?? "",
				section: fm.section ?? "Research Workflows",
				topLevelCli: fm.topLevelCli === "true",
			};
		});
}

export const extensionCommandSpecs = [
	{ name: "capabilities", args: "", section: "Project & Session", description: "Show installed packages, discovery entrypoints, and runtime capability counts.", publicDocs: true },
	{ name: "commands", args: "", section: "Project & Session", description: "Browse all available slash commands, including built-in and package commands.", publicDocs: true },
	{ name: "help", args: "", section: "Project & Session", description: "Show grouped Feynman commands and prefill the editor with a selected command.", publicDocs: true },
	{ name: "feynman-model", args: "", section: "Project & Session", description: "Open Feynman model menu (main + per-subagent overrides).", publicDocs: true },
	{ name: "init", args: "", section: "Project & Session", description: "Bootstrap AGENTS.md and session-log folders for a research project.", publicDocs: true },
	{ name: "outputs", args: "", section: "Project & Session", description: "Browse all research artifacts (papers, outputs, experiments, notes).", publicDocs: true },
	{ name: "service-tier", args: "", section: "Project & Session", description: "View or set the provider service tier override for supported models.", publicDocs: true },
	{ name: "tools", args: "", section: "Project & Session", description: "Browse all callable tools with their source and parameter summary.", publicDocs: true },
];

export const livePackageCommandGroups = [
	{
		title: "Agents & Delegation",
		commands: [
			{ name: "agents", usage: "/agents" },
			{ name: "run", usage: "/run <agent> <task>" },
			{ name: "chain", usage: "/chain agent1 -> agent2" },
			{ name: "parallel", usage: "/parallel agent1 -> agent2" },
		],
	},
	{
		title: "Bundled Package Commands",
		commands: [
			{ name: "ps", usage: "/ps" },
			{ name: "schedule-prompt", usage: "/schedule-prompt" },
			{ name: "search", usage: "/search" },
			{ name: "preview", usage: "/preview" },
			{ name: "hotkeys", usage: "/hotkeys" },
			{ name: "new", usage: "/new" },
			{ name: "quit", usage: "/quit" },
			{ name: "exit", usage: "/exit" },
		],
	},
];

export const cliCommandSections = [
	{
		title: "Core",
		commands: [
			{ usage: "feynman", description: "Launch the interactive REPL." },
			{ usage: "feynman chat [prompt]", description: "Start chat explicitly, optionally with an initial prompt." },
			{ usage: "feynman help", description: "Show CLI help." },
			{ usage: "feynman setup", description: "Run the guided setup wizard." },
			{ usage: "feynman doctor", description: "Diagnose config, auth, Pi runtime, and preview dependencies." },
			{ usage: "feynman status", description: "Show the current setup summary." },
		],
	},
	{
		title: "Model Management",
		commands: [
			{ usage: "feynman model list", description: "List available models in Pi auth storage." },
			{ usage: "feynman model login [id]", description: "Login to a Pi OAuth model provider." },
			{ usage: "feynman model logout [id]", description: "Logout from a Pi OAuth model provider." },
			{ usage: "feynman model set <provider/model>", description: "Set the default model." },
			{ usage: "feynman model tier [value]", description: "View or set the request service tier override." },
		],
	},
	{
		title: "AlphaXiv",
		commands: [
			{ usage: "feynman alpha login", description: "Sign in to alphaXiv." },
			{ usage: "feynman alpha logout", description: "Clear alphaXiv auth." },
			{ usage: "feynman alpha status", description: "Check alphaXiv auth status." },
		],
	},
	{
		title: "Utilities",
		commands: [
			{ usage: "feynman packages list", description: "Show core and optional Pi package presets." },
			{ usage: "feynman packages install <preset>", description: "Install optional package presets on demand." },
			{ usage: "feynman search status", description: "Show Pi web-access status and config path." },
			{ usage: "feynman search set <provider> [api-key]", description: "Set the web search provider (auto, perplexity, exa, gemini) and optionally its API key." },
			{ usage: "feynman search clear", description: "Reset web search provider to auto." },
			{ usage: "feynman update [package]", description: "Update installed packages, or a specific package." },
		],
	},
];

export const legacyFlags = [
	{ usage: '--prompt "<text>"', description: "Run one prompt and exit." },
	{ usage: "--alpha-login", description: "Sign in to alphaXiv and exit." },
	{ usage: "--alpha-logout", description: "Clear alphaXiv auth and exit." },
	{ usage: "--alpha-status", description: "Show alphaXiv auth status and exit." },
	{ usage: "--model <provider:model>", description: "Force a specific model." },
	{ usage: "--service-tier <tier>", description: "Override request service tier for this run." },
	{ usage: "--thinking <level>", description: "Set thinking level: off | minimal | low | medium | high | xhigh." },
	{ usage: "--cwd <path>", description: "Set the working directory for tools." },
	{ usage: "--session-dir <path>", description: "Set the session storage directory." },
	{ usage: "--new-session", description: "Start a new persisted session." },
	{ usage: "--doctor", description: "Alias for `feynman doctor`." },
	{ usage: "--setup-preview", description: "Alias for `feynman setup preview`." },
];

export const topLevelCommandNames = ["alpha", "chat", "doctor", "help", "model", "packages", "search", "setup", "status", "update"];

export function formatSlashUsage(command) {
	return `/${command.name}${command.args ? ` ${command.args}` : ""}`;
}

export function formatCliWorkflowUsage(command) {
	return `feynman ${command.name}${command.args ? ` ${command.args}` : ""}`;
}

export function getExtensionCommandSpec(name) {
	return extensionCommandSpecs.find((command) => command.name === name);
}
