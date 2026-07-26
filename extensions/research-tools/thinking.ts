import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const thinkingLevels = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;

type ThinkingLevel = (typeof thinkingLevels)[number];

function parseThinkingLevel(value: string): ThinkingLevel | undefined {
	const normalized = value.trim().toLowerCase();
	return thinkingLevels.find((level) => level === normalized);
}

function setThinkingLevel(
	pi: ExtensionAPI,
	ctx: { ui: { notify: (message: string, level: "info" | "error") => void } },
	level: ThinkingLevel,
): void {
	pi.setThinkingLevel(level);
	ctx.ui.notify(`Thinking level set to ${pi.getThinkingLevel()}.`, "info");
}

export function registerThinkingCommand(pi: ExtensionAPI): void {
	pi.registerCommand("thinking", {
		description: "View or set the current thinking level.",
		handler: async (args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("thinking requires interactive mode.", "error");
				return;
			}

			const requestedLevel = args.trim();
			if (requestedLevel) {
				const level = parseThinkingLevel(requestedLevel);
				if (!level) {
					ctx.ui.notify(
						`Unknown thinking level "${requestedLevel}". Available: ${thinkingLevels.join(", ")}.`,
						"error",
					);
					return;
				}
				setThinkingLevel(pi, ctx, level);
				return;
			}

			const currentLevel = pi.getThinkingLevel();
			const options = thinkingLevels.map((level) => ({
				label: level === currentLevel ? `${level} (current)` : level,
				level,
			}));
			const selected = await ctx.ui.select(
				`Thinking level: ${currentLevel}`,
				options.map((option) => option.label),
			);
			const level = options.find((option) => option.label === selected)?.level;
			if (!level) return;
			setThinkingLevel(pi, ctx, level);
		},
	});
}
