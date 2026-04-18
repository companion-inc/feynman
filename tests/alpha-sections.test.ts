import assert from "node:assert/strict";
import test from "node:test";

import { extractPaperSections } from "../extensions/research-tools/alpha-sections.js";

test("extractPaperSections selects canonical sections from object content", () => {
	const content = {
		Abstract: "This paper introduces a benchmark.",
		Methods: "We train a transformer with synthetic data.",
		Results: "The method improves accuracy by 6 points.",
	};

	const result = extractPaperSections(content, undefined, ["abstract", "methodology", "results"]);

	assert.deepEqual(result.requested, ["abstract", "methodology", "results"]);
	assert.deepEqual(result.selected, {
		abstract: "This paper introduces a benchmark.",
		methodology: "We train a transformer with synthetic data.",
		results: "The method improves accuracy by 6 points.",
	});
	assert.deepEqual(result.missing, []);
});

test("extractPaperSections supports nested sections object", () => {
	const content = {
		title: "Paper",
		sections: {
			"Experimental Setup": "Three datasets and two baselines.",
			Discussion: "Error analysis indicates domain shift.",
		},
	};

	const result = extractPaperSections(content, "experiments");

	assert.deepEqual(result.requested, ["experiments"]);
	assert.deepEqual(result.selected, {
		experiments: "Three datasets and two baselines.",
	});
	assert.deepEqual(result.missing, []);
});

test("extractPaperSections parses heading-based sections from text content", () => {
	const content = [
		"# Abstract",
		"A concise summary.",
		"",
		"## Introduction",
		"Intro paragraph.",
		"",
		"## 3 Results",
		"Result paragraph.",
	].join("\n");

	const result = extractPaperSections(content, undefined, ["abstract", "results", "limitations"]);

	assert.deepEqual(result.requested, ["abstract", "results", "limitations"]);
	assert.deepEqual(result.selected, {
		abstract: "A concise summary.",
		results: "Result paragraph.",
	});
	assert.deepEqual(result.missing, ["limitations"]);
});

test("extractPaperSections ignores unknown section names", () => {
	const result = extractPaperSections({ abstract: "x" }, "not-a-section", ["abstract", "UNKNOWN"]);

	assert.deepEqual(result.requested, ["abstract"]);
	assert.deepEqual(result.selected, { abstract: "x" });
	assert.deepEqual(result.missing, []);
});
