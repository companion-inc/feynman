import { readdir } from "node:fs/promises";
import { cpus, homedir, totalmem } from "node:os";
import { execSync } from "node:child_process";
import { resolve as resolvePath } from "node:path";

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

import {
	APP_ROOT,
	FEYNMAN_AGENT_LOGO,
	FEYNMAN_VERSION,
} from "./shared.js";

function visibleLength(text: string): number {
	return visibleWidth(text);
}

function formatHeaderPath(path: string): string {
	const home = homedir();
	return path.startsWith(home) ? `~${path.slice(home.length)}` : path;
}

function truncateVisible(text: string, maxVisible: number): string {
	if (visibleWidth(text) <= maxVisible) return text;
	return truncateToWidth(text, maxVisible, maxVisible <= 3 ? "" : "...");
}

function wrapWords(text: string, maxW: number): string[] {
	const words = text.split(" ");
	const lines: string[] = [];
	let cur = "";
	for (let word of words) {
		if (visibleWidth(word) > maxW) {
			if (cur) { lines.push(cur); cur = ""; }
			word = truncateToWidth(word, maxW, maxW > 3 ? "…" : "");
		}
		const test = cur ? `${cur} ${word}` : word;
		if (cur && visibleWidth(test) > maxW) {
			lines.push(cur);
			cur = word;
		} else {
			cur = test;
		}
	}
	if (cur) lines.push(cur);
	return lines.length ? lines : [""];
}

function padRight(text: string, width: number): string {
	const gap = Math.max(0, width - visibleLength(text));
	return `${text}${" ".repeat(gap)}`;
}

function centerText(text: string, width: number): string {
	const textWidth = visibleWidth(text);
	if (textWidth >= width) return truncateToWidth(text, width, "");
	const left = Math.floor((width - textWidth) / 2);
	const right = width - textWidth - left;
	return `${" ".repeat(left)}${text}${" ".repeat(right)}`;
}

function getCurrentModelLabel(ctx: ExtensionContext): string {
	if (ctx.model) return `${ctx.model.provider}/${ctx.model.id}`;
	const branch = ctx.sessionManager.getBranch();
	for (let index = branch.length - 1; index >= 0; index -= 1) {
		const entry = branch[index]!;
		if (entry.type === "model_change") return `${(entry as any).provider}/${(entry as any).modelId}`;
	}
	return "not set";
}

function extractMessageText(message: unknown): string {
	if (!message || typeof message !== "object") return "";
	const content = (message as { content?: unknown }).content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((item) => {
			if (!item || typeof item !== "object") return "";
			const record = item as { type?: string; text?: unknown; name?: unknown };
			if (record.type === "text" && typeof record.text === "string") return record.text;
			if (record.type === "toolCall") return `[${typeof record.name === "string" ? record.name : "tool"}]`;
			return "";
		})
		.filter(Boolean)
		.join(" ");
}

function getRecentActivitySummary(ctx: ExtensionContext): string {
	const branch = ctx.sessionManager.getBranch();
	for (let index = branch.length - 1; index >= 0; index -= 1) {
		const entry = branch[index]!;
		if (entry.type !== "message") continue;
		const msg = entry as any;
		const text = extractMessageText(msg.message).replace(/\s+/g, " ").trim();
		if (!text) continue;
		const role = msg.message.role === "assistant" ? "agent" : msg.message.role === "user" ? "you" : msg.message.role;
		return `${role}: ${text}`;
	}
	return "";
}

async function buildAgentCatalogSummary(): Promise<{ agents: string[]; chains: string[] }> {
	const agents: string[] = [];
	const chains: string[] = [];
	try {
		const entries = await readdir(resolvePath(APP_ROOT, ".feynman", "agents"), { withFileTypes: true });
		for (const entry of entries) {
			if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
			if (entry.name.endsWith(".chain.md")) {
				chains.push(entry.name.replace(/\.chain\.md$/i, ""));
			} else {
				agents.push(entry.name.replace(/\.md$/i, ""));
			}
		}
	} catch {
		return { agents: [], chains: [] };
	}
	agents.sort();
	chains.sort();
	return { agents, chains };
}

type SystemResources = {
	cpu: string;
	cores: number;
	ramTotal: string;
	ramFree: string;
	gpu: string | null;
	docker: boolean;
};

let cachedResources: SystemResources | null = null;

function detectSystemResources(): SystemResources {
	if (cachedResources) return cachedResources;

	const cores = cpus().length;
	const totalBytes = totalmem();
	const ramTotal = `${Math.round(totalBytes / (1024 ** 3))}GB`;

	cachedResources = { cpu: "", cores, ramTotal, ramFree: "", gpu: null, docker: false };

	try {
		if (process.platform === "darwin") {
			const out = execSync("sysctl -n machdep.cpu.brand_string 2>/dev/null", { encoding: "utf8", timeout: 1000 }).trim();
			if (out) cachedResources.cpu = out;
		}
	} catch {}

	try {
		const probe = process.platform === "win32" ? "where docker" : "command -v docker";
		execSync(probe, { timeout: 500, stdio: "ignore" });
		cachedResources.docker = true;
	} catch {}

	return cachedResources;
}

type WorkflowInfo = { name: string; description: string };

function getResearchWorkflows(pi: ExtensionAPI): WorkflowInfo[] {
	return pi.getCommands()
		.filter((cmd) => cmd.source === "prompt")
		.map((cmd) => ({ name: `/${cmd.name}`, description: cmd.description ?? "" }))
		.sort((a, b) => a.name.localeCompare(b.name));
}

function shortDescription(desc: string): string {
	const lower = desc.toLowerCase();
	for (const prefix of ["run a ", "run an ", "set up a ", "build a ", "build the ", "turn ", "design the ", "produce a ", "compare ", "simulate ", "inspect ", "write a ", "plan or execute a ", "prepare a "]) {
		if (lower.startsWith(prefix)) return desc.slice(prefix.length);
	}
	return desc;
}

export function installFeynmanHeader(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	cache: { agentSummaryPromise?: Promise<{ agents: string[]; chains: string[] }> },
): void | Promise<void> {
	if (!ctx.hasUI) return;

	cache.agentSummaryPromise ??= buildAgentCatalogSummary();

	return cache.agentSummaryPromise.then((agentData) => {
		const resources = detectSystemResources();
		const workflows = getResearchWorkflows(pi);
		const toolCount = pi.getAllTools().length;
		const commandCount = pi.getCommands().length;
		const agentCount = agentData.agents.length + agentData.chains.length;
		const activitySnapshot = getRecentActivitySummary(ctx);

		ctx.ui.setHeader((_tui, theme) => ({
			render(width: number): string[] {
				const maxW = Math.max(width - 2, 1);
				const cardW = Math.min(maxW, 120);
				const innerW = cardW - 2;
				const contentW = innerW - 2;
				const outerPad = " ".repeat(Math.max(0, Math.floor((width - cardW) / 2)));
				const lines: string[] = [];

				const push = (line: string) => { lines.push(`${outerPad}${line}`); };
				const border = (ch: string) => theme.fg("borderMuted", ch);

				const row = (content: string): string =>
					`${border("│")} ${padRight(content, contentW)} ${border("│")}`;
				const emptyRow = (): string =>
					`${border("│")}${" ".repeat(innerW)}${border("│")}`;
				const sep = (): string =>
					`${border("├")}${border("─".repeat(innerW))}${border("┤")}`;

				const useWideLayout = contentW >= 70;
				const leftW = useWideLayout ? Math.min(38, Math.floor(contentW * 0.35)) : 0;
				const divColW = useWideLayout ? 3 : 0;
				const rightW = useWideLayout ? contentW - leftW - divColW : contentW;

				const twoCol = (left: string, right: string): string => {
					if (!useWideLayout) return row(left || right);
					return row(
						`${padRight(left, leftW)}${border(" │ ")}${padRight(right, rightW)}`,
					);
				};

				const modelLabel = getCurrentModelLabel(ctx);
				const sessionId = ctx.sessionManager.getSessionName()?.trim() || ctx.sessionManager.getSessionId();
				const dirLabel = formatHeaderPath(ctx.cwd);
				// Keep the header stable during streaming work. Recomputing this from the live
				// branch on every render makes high-churn workflows redraw the whole viewport.
				const activity = activitySnapshot;

				push("");
				if (cardW >= 70) {
					const maxLogoW = Math.max(...FEYNMAN_AGENT_LOGO.map((l) => l.length));
					const logoOffset = " ".repeat(Math.max(0, Math.floor((cardW - maxLogoW) / 2)));
					for (const logoLine of FEYNMAN_AGENT_LOGO) {
						push(theme.fg("accent", theme.bold(`${logoOffset}${truncateVisible(logoLine, cardW)}`)));
					}
					push("");
				}

				const versionTag = ` v${FEYNMAN_VERSION} `;
				const gap = Math.max(0, innerW - versionTag.length);
				const gapL = Math.floor(gap / 2);
				push(
					border(`╭${"─".repeat(gapL)}`) +
					theme.fg("dim", versionTag) +
					border(`${"─".repeat(gap - gapL)}╮`),
				);

				if (useWideLayout) {
					const cmdNameW = 16;
					const descW = Math.max(10, rightW - cmdNameW - 2);

					const leftValueW = Math.max(1, leftW - 11);
					const indent = " ".repeat(11);
					const leftLines: string[] = [""];

					const pushLabeled = (label: string, value: string, color: "text" | "dim") => {
						const wrapped = wrapWords(value, leftValueW);
						leftLines.push(`${theme.fg("dim", label.padEnd(10))} ${theme.fg(color, wrapped[0]!)}`);
						for (let i = 1; i < wrapped.length; i++) {
							leftLines.push(`${indent}${theme.fg(color, wrapped[i]!)}`);
						}
					};

					pushLabeled("model", modelLabel, "text");
					pushLabeled("directory", dirLabel, "text");
					pushLabeled("session", sessionId, "dim");
					leftLines.push("");
					const sysParts = [`${resources.cores} cores`, resources.ramTotal];
					if (resources.docker) sysParts.push("docker");
					pushLabeled("system", sysParts.join(" · "), "dim");
					leftLines.push("");
					leftLines.push(theme.fg("dim", `${toolCount} tools · ${agentCount} agents`));

					const pushList = (heading: string, items: string[]) => {
						if (items.length === 0) return;
						leftLines.push("");
						leftLines.push(theme.fg("accent", theme.bold(heading)));
						for (const line of wrapWords(items.join(", "), leftW)) {
							leftLines.push(theme.fg("dim", line));
						}
					};

					pushList("Agents", agentData.agents);
					pushList("Chains", agentData.chains);

					if (activity) {
						const maxActivityLen = leftW * 2;
						const trimmed = visibleWidth(activity) > maxActivityLen
							? truncateToWidth(activity, maxActivityLen, "…")
							: activity;
						leftLines.push("");
						leftLines.push(theme.fg("accent", theme.bold("Last Activity")));
						for (const line of wrapWords(trimmed, leftW)) {
							leftLines.push(theme.fg("dim", line));
						}
					}

					const rightLines: string[] = [
						"",
						theme.fg("accent", theme.bold("Research Workflows")),
					];

					for (const wf of workflows) {
						if (wf.name === "/jobs" || wf.name === "/log") continue;
						const desc = shortDescription(wf.description);
						const descWords = desc.split(" ");
						let line = "";
						let first = true;
						for (const word of descWords) {
							const test = line ? `${line} ${word}` : word;
							if (line && test.length > descW) {
								rightLines.push(
									first
										? `${theme.fg("accent", wf.name.padEnd(cmdNameW))}${theme.fg("dim", line)}`
										: `${" ".repeat(cmdNameW)}${theme.fg("dim", line)}`,
								);
								first = false;
								line = word;
							} else {
								line = test;
							}
						}
						if (line || first) {
							rightLines.push(
								first
									? `${theme.fg("accent", wf.name.padEnd(cmdNameW))}${theme.fg("dim", line)}`
									: `${" ".repeat(cmdNameW)}${theme.fg("dim", line)}`,
							);
						}
					}

					const maxRows = Math.max(leftLines.length, rightLines.length);
					for (let i = 0; i < maxRows; i++) {
						push(twoCol(leftLines[i] ?? "", rightLines[i] ?? ""));
					}
				} else {
					const narrowValW = Math.max(1, contentW - 11);
					push(emptyRow());
					push(row(`${theme.fg("dim", "model".padEnd(10))} ${theme.fg("text", truncateVisible(modelLabel, narrowValW))}`));
					push(row(`${theme.fg("dim", "directory".padEnd(10))} ${theme.fg("text", truncateVisible(dirLabel, narrowValW))}`));
					push(row(`${theme.fg("dim", "session".padEnd(10))} ${theme.fg("dim", truncateVisible(sessionId, narrowValW))}`));
					const resourceLine = `${resources.cores} cores · ${resources.ramTotal}${resources.docker ? " · docker" : ""}`;
					push(row(theme.fg("dim", truncateVisible(resourceLine, contentW))));
					push(row(theme.fg("dim", truncateVisible(`${toolCount} tools · ${agentCount} agents · ${commandCount} commands`, contentW))));
					push(emptyRow());

					push(sep());
					push(row(theme.fg("accent", theme.bold("Research Workflows"))));
					const narrowDescW = Math.max(1, contentW - 17);
					for (const wf of workflows) {
						if (wf.name === "/jobs" || wf.name === "/log") continue;
						const desc = shortDescription(wf.description);
						push(row(`${theme.fg("accent", wf.name.padEnd(16))} ${theme.fg("dim", truncateVisible(desc, narrowDescW))}`));
					}

					if (agentData.agents.length > 0 || agentData.chains.length > 0) {
						push(sep());
						push(row(theme.fg("accent", theme.bold("Agents & Chains"))));
						if (agentData.agents.length > 0) {
							push(row(theme.fg("dim", truncateVisible(`agents  ${agentData.agents.join(", ")}`, contentW))));
						}
						if (agentData.chains.length > 0) {
							push(row(theme.fg("dim", truncateVisible(`chains  ${agentData.chains.join(", ")}`, contentW))));
						}
					}
				}

				push(border(`╰${"─".repeat(innerW)}╯`));
				push("");
				return lines;
			},
			invalidate() {},
		}));
	});
}
