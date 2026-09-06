import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";

import { testableChemistrySketcher } from "../extensions/research-tools/chemistry-sketcher.js";

test("bundled Ketcher treats untrusted monomer labels as text", () => {
	for (const packageName of [
		"ketcher-core",
		"ketcher-react",
		"ketcher-standalone",
	]) {
		const packageJson = JSON.parse(
			readFileSync(
				join(process.cwd(), "node_modules", packageName, "package.json"),
				"utf8",
			),
		);
		assert.equal(packageJson.version, "3.18.0", packageName);
	}

	const dist = join(process.cwd(), "node_modules", "ketcher-core", "dist");
	const rendererPath = "application/render/renderers/UnsplitNucleotideRenderer.modern.js";
	assert.ok(
		readFileSync(join(dist, "index.modern.js"), "utf8").includes(
			`export { UnsplitNucleotideRenderer } from './${rendererPath}';`,
		),
		"check the renderer actually exported by the installed split-module bundle",
	);
	const ketcherCore = readFileSync(join(dist, rendererPath), "utf8");
	assert.match(
		ketcherCore,
		/foreignObject\.append\('xhtml:div'\)[^;]+\.text\(this\.monomer\.label\)/,
	);
	// Preserve the old whole-bundle negative guard across the split JS modules.
	for (const file of readdirSync(dist, { recursive: true, encoding: "utf8" })) {
		if (file.endsWith(".modern.js")) {
			assert.doesNotMatch(
				readFileSync(join(dist, file), "utf8"),
				/\.html\([^;]{0,1000}this\.monomer\.label/,
				file,
			);
		}
	}

	const methods = [...ketcherCore.matchAll(
		/value: function appendLabel\(rootElement\) \{([\s\S]*?)\n    \}/g,
	)];
	assert.equal(methods.length, 1, "extract exactly one complete installed appendLabel method");
	const body = methods[0][1];
	assert.doesNotMatch(body, /\.html\s*\(/);

	function renderLabel(methodBody: string, label: string) {
		const elements: { name: string; textContent: string; children: unknown[] }[] = [];
		function selection(name: string) {
			const element = { name, textContent: "", children: [] as unknown[] };
			elements.push(element);
			const result = {
				append(childName: string) {
					const child = selection(childName);
					element.children.push(child.element);
					return child;
				},
				attr() { return result; },
				style() { return result; },
				text(value: string) {
					element.textContent = value;
					return result;
				},
				html() { throw new Error("unsafe HTML sink reached"); },
				element,
			};
			return result;
		}
		const rootElement = selection("g");
		// Execute the actual installed method, not a reimplementation of its sink.
		runInNewContext(
			`(function appendLabel(rootElement) {${methodBody}\n}).call(renderer, rootElement)`,
			{
				rootElement,
				renderer: { width: 32, height: 24, textColor: "black", monomer: { label } },
			},
			{ timeout: 1_000 },
		);
		const labels = elements.filter((element) => element.name === "xhtml:div");
		assert.equal(labels.length, 1);
		assert.equal(labels[0].textContent, label);
		assert.deepEqual(labels[0].children, []);
		assert.deepEqual(elements.map((element) => element.name), ["g", "foreignObject", "xhtml:div"]);
	}

	for (const label of [
		'<img src=x onerror="globalThis.compromised=true">',
		'<svg onload="globalThis.compromised=true"></svg>',
		'A & B < C "quoted" \u03b1',
	]) {
		renderLabel(body, label);
	}
	const unsafeBody = body.replace(".text(this.monomer.label)", ".html(this.monomer.label)");
	assert.notEqual(unsafeBody, body, "negative control must mutate the real label sink");
	assert.throws(
		() => renderLabel(unsafeBody, "<img src=x onerror=alert(1)>"),
		/unsafe HTML sink reached/,
		"the behavioral harness must reject the historical HTML-sink regression",
	);
});

test("chemistry sketcher creates Feynman-owned SMILES artifacts", () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-chemistry-sketcher-"));
	try {
		const result = testableChemistrySketcher.createChemistrySketcherSeed(root, {
			filename: "Benzene Sketch",
			smiles: "c1ccccc1",
		});
		assert.equal(result.schema, "feynman.chemistrySketcherSeed.v1");
		assert.equal(result.filename, "benzene-sketch.smi");
		assert.equal(result.format, "smiles");
		assert.equal(result.mimeType, "chemical/x-daylight-smiles");
		assert.equal(existsSync(result.artifactPath), true);
		assert.equal(readFileSync(result.artifactPath, "utf8"), "c1ccccc1\n");
		assert.match(result.artifactPath, /outputs\/chemistry-sketches\/benzene-sketch\.smi$/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("chemistry sketcher prefers KET and writes a blank KET when no seed is provided", () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-chemistry-sketcher-"));
	try {
		const ketResult = testableChemistrySketcher.createChemistrySketcherSeed(root, {
			filename: "state",
			ket: "{\"root\":{\"nodes\":[{\"type\":\"atom\"}]}}",
			smiles: "CCO",
		});
		assert.equal(ketResult.filename, "state.ket");
		assert.equal(ketResult.format, "ket");
		assert.equal(readFileSync(ketResult.artifactPath, "utf8"), "{\"root\":{\"nodes\":[{\"type\":\"atom\"}]}}\n");

		const blankResult = testableChemistrySketcher.createChemistrySketcherSeed(root, {});
		assert.equal(blankResult.filename, "sketcher.ket");
		assert.equal(blankResult.format, "ket");
		assert.equal(readFileSync(blankResult.artifactPath, "utf8"), "{\"root\":{\"nodes\":[]}}\n");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
