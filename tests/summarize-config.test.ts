import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const summarizePromptPath = resolve(process.cwd(), "prompts/summarize.md");

test("summarize prompt exposes configurable window and threshold knobs", () => {
	const summarizePrompt = readFileSync(summarizePromptPath, "utf8");

	assert.match(summarizePrompt, /args:\s*<source>\s+\[--window-size\s+<chars>\]/i);
	assert.match(summarizePrompt, /--overlap\s+<chars>/i);
	assert.match(summarizePrompt, /--tier1-threshold\s+<chars>/i);
	assert.match(summarizePrompt, /--tier2-threshold\s+<chars>/i);

	assert.match(summarizePrompt, /FEYNMAN_SUMMARIZE_WINDOW_CHARS/i);
	assert.match(summarizePrompt, /FEYNMAN_SUMMARIZE_OVERLAP_CHARS/i);
	assert.match(summarizePrompt, /FEYNMAN_SUMMARIZE_TIER1_THRESHOLD/i);
	assert.match(summarizePrompt, /FEYNMAN_SUMMARIZE_TIER2_THRESHOLD/i);

	assert.match(summarizePrompt, /window-size\s*>\s*overlap/i);
	assert.match(summarizePrompt, /tier1-threshold\s*<\s*tier2-threshold/i);
});
