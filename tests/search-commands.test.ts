import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { printSearchStatus } from "../src/search/commands.js";
import {
	getPiWebAccessStatus,
	getPiWebSearchConfigPath,
	loadPiWebAccessConfig,
	savePiWebAccessConfig,
} from "../src/pi/web-access.js";

function captureConsoleLog(fn: () => void): string[] {
	const lines: string[] = [];
	const original = console.log;
	console.log = (...args: unknown[]) => {
		lines.push(args.map((arg) => String(arg)).join(" "));
	};
	try {
		fn();
	} finally {
		console.log = original;
	}
	return lines;
}

function stripAnsi(line: string): string {
	// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI strip
	return line.replace(/\x1b\[[0-9;]*m/g, "");
}

test("printSearchStatus marks config path and prints setup hint when web-search.json is missing", () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-search-cmds-"));
	const configPath = getPiWebSearchConfigPath(root);
	const status = getPiWebAccessStatus(loadPiWebAccessConfig(configPath), configPath);

	const output = captureConsoleLog(() => printSearchStatus(status)).map(stripAnsi);

	const configLine = output.find((line) => line.includes("Config path:"));
	assert.ok(configLine, "expected Config path line");
	assert.ok(configLine!.includes("(not created yet)"), `expected '(not created yet)' marker, got: ${configLine}`);
	assert.ok(
		output.some((line) => line.toLowerCase().includes("feynman search set")),
		"expected a hint referencing `feynman search set`",
	);
});

test("printSearchStatus omits marker and hint when web-search.json exists", () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-search-cmds-"));
	const configPath = getPiWebSearchConfigPath(root);
	savePiWebAccessConfig({ provider: "auto", searchProvider: "auto" }, configPath);
	const status = getPiWebAccessStatus(loadPiWebAccessConfig(configPath), configPath);

	const output = captureConsoleLog(() => printSearchStatus(status)).map(stripAnsi);

	const configLine = output.find((line) => line.includes("Config path:"));
	assert.ok(configLine, "expected Config path line");
	assert.ok(!configLine!.includes("(not created yet)"), `did not expect '(not created yet)' marker: ${configLine}`);
	assert.ok(
		!output.some((line) => line.toLowerCase().includes("feynman search set")),
		"did not expect a setup hint when config exists",
	);
});
