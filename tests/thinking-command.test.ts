import assert from "node:assert/strict";
import test from "node:test";

import { registerThinkingCommand } from "../extensions/research-tools/thinking.js";

type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

type RegisteredCommand = {
	description?: string;
	handler: (args: string, ctx: unknown) => Promise<void>;
};

function createCommandFixture(initialLevel: ThinkingLevel, selected?: string) {
	const registered = new Map<string, RegisteredCommand>();
	const notifications: Array<{ message: string; level: string }> = [];
	const selections: Array<{ title: string; items: string[] }> = [];
	let thinkingLevel = initialLevel;

	const pi = {
		getThinkingLevel: () => thinkingLevel,
		setThinkingLevel: (level: ThinkingLevel) => {
			thinkingLevel = level;
		},
		registerCommand: (name: string, command: RegisteredCommand) => {
			registered.set(name, command);
		},
	};
	const ctx = {
		hasUI: true,
		ui: {
			select: async (title: string, items: string[]) => {
				selections.push({ title, items });
				return selected;
			},
			notify: (message: string, level: string) => {
				notifications.push({ message, level });
			},
		},
	};

	registerThinkingCommand(pi as any);
	const command = registered.get("thinking");
	assert.ok(command);

	return {
		command,
		ctx,
		getThinkingLevel: () => thinkingLevel,
		notifications,
		selections,
	};
}

test("/thinking directly sets a valid thinking level", async () => {
	const fixture = createCommandFixture("medium");

	await fixture.command.handler(" high ", fixture.ctx);

	assert.equal(fixture.getThinkingLevel(), "high");
	assert.deepEqual(fixture.selections, []);
	assert.deepEqual(fixture.notifications, [{ message: "Thinking level set to high.", level: "info" }]);
});

test("/thinking shows the current level in its picker", async () => {
	const fixture = createCommandFixture("medium", "xhigh");

	await fixture.command.handler("", fixture.ctx);

	assert.equal(fixture.getThinkingLevel(), "xhigh");
	assert.deepEqual(fixture.selections, [
		{
			title: "Thinking level: medium",
			items: ["off", "minimal", "low", "medium (current)", "high", "xhigh"],
		},
	]);
	assert.deepEqual(fixture.notifications, [{ message: "Thinking level set to xhigh.", level: "info" }]);
});

test("/thinking rejects an unknown thinking level", async () => {
	const fixture = createCommandFixture("medium");

	await fixture.command.handler("maximum", fixture.ctx);

	assert.equal(fixture.getThinkingLevel(), "medium");
	assert.deepEqual(fixture.selections, []);
	assert.deepEqual(fixture.notifications, [
		{
			message: 'Unknown thinking level "maximum". Available: off, minimal, low, medium, high, xhigh.',
			level: "error",
		},
	]);
});
