import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

function jsonResponse(value) {
	return new Response(JSON.stringify(value), {
		status: 200,
		headers: { "content-type": "application/json" },
	});
}

function makeTwoPagePdf() {
	const contentOne = "BT /F1 24 Tf 72 720 Td (Installed Page One) Tj ET";
	const contentTwo = "BT /F1 24 Tf 72 720 Td (Installed Page Two) Tj ET";
	const objects = [
		"<< /Type /Catalog /Pages 2 0 R >>",
		"<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>",
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>",
		"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
		`<< /Length ${Buffer.byteLength(contentOne, "ascii")} >>\nstream\n${contentOne}\nendstream`,
		`<< /Length ${Buffer.byteLength(contentTwo, "ascii")} >>\nstream\n${contentTwo}\nendstream`,
	];
	let body = "%PDF-1.4\n";
	const offsets = [0];
	for (let index = 0; index < objects.length; index += 1) {
		offsets.push(Buffer.byteLength(body, "ascii"));
		body += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
	}
	const xrefOffset = Buffer.byteLength(body, "ascii");
	body += `xref\n0 ${objects.length + 1}\n`;
	body += "0000000000 65535 f \n";
	for (const offset of offsets.slice(1)) {
		body += `${String(offset).padStart(10, "0")} 00000 n \n`;
	}
	body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
	body += `startxref\n${xrefOffset}\n%%EOF\n`;
	return new TextEncoder().encode(body).buffer;
}

function restoreEnvironment(name, value) {
	if (value === undefined) delete process.env[name];
	else process.env[name] = value;
}

export async function verifyPdfPageLimits(packageRoot) {
	const runtimeRoot = resolve(packageRoot, ".feynman", "npm");
	const jitiModule = await import(pathToFileURL(createRequire(resolve(runtimeRoot, "node_modules", "@earendil-works", "pi-coding-agent", "package.json")).resolve("jiti")).href);
	const jiti = jitiModule.createJiti(import.meta.url, { moduleCache: false });
	const webRoot = resolve(runtimeRoot, "node_modules", "pi-web-access");
	const pdfPath = resolve(webRoot, "pdf-extract.ts");
	const datalabPath = resolve(webRoot, "datalab-pdf-extract.ts");
	const geminiPath = resolve(webRoot, "gemini-pdf-extract.ts");
	const root = mkdtempSync(join(tmpdir(), "feynman-installed-pdf-limits-"));
	const configPath = join(root, "web-search.json");
	const outputDir = join(root, "output");
	const previousFetch = globalThis.fetch;
	const previousEnvironment = new Map(
		[
			"DATALAB_API_KEY",
			"DATALAB_API_BASE",
			"DATALAB_MODE",
			"FEYNMAN_WEB_SEARCH_CONFIG",
			"GEMINI_API_KEY",
			"GOOGLE_GEMINI_BASE_URL",
		].map((name) => [name, process.env[name]]),
	);

	assert.ok(existsSync(pdfPath), "Installed pi-web-access PDF module is missing");
	assert.ok(existsSync(datalabPath), "Installed pi-web-access Datalab module is missing");
	assert.ok(existsSync(geminiPath), "Installed pi-web-access Gemini PDF module is missing");

	try {
		writeFileSync(
			configPath,
			JSON.stringify({ pdf: { provider: "unpdf", maxPages: 1.9 } }),
			"utf8",
		);
		process.env.FEYNMAN_WEB_SEARCH_CONFIG = configPath;
		process.env.DATALAB_API_KEY = "synthetic-datalab-key";
		process.env.GEMINI_API_KEY = "synthetic-gemini-key";
		delete process.env.DATALAB_API_BASE;
		delete process.env.DATALAB_MODE;
		delete process.env.GOOGLE_GEMINI_BASE_URL;

		const pdf = await jiti.import(pdfPath);
		assert.equal(pdf.loadPDFConfig().maxPages, 1, "Installed PDF config did not normalize maxPages");

		let datalabMaxPages = null;
		globalThis.fetch = async (url, init = {}) => {
			const value = String(url);
			if (value.endsWith("/files/upload")) {
				return jsonResponse({
					file_id: 7,
					upload_url: "https://storage.test/put/abc",
					reference: "datalab://file-7",
				});
			}
			if (value.includes("/put/") || (value.endsWith("/files/7") && init.method === "DELETE")) {
				return new Response(null, { status: 200 });
			}
			if (value.endsWith("/files/7/confirm")) {
				return jsonResponse({ file_id: 7, reference: "datalab://file-7" });
			}
			if (value.endsWith("/convert")) {
				assert.ok(init.body instanceof FormData, "Datalab conversion omitted multipart data");
				datalabMaxPages = init.body.get("max_pages");
				return jsonResponse({
					status: "complete",
					success: true,
					markdown: "<!-- Page 1 -->\nDatalab page",
					page_count: 1,
				});
			}
			throw new Error(`Unexpected installed Datalab request: ${value}`);
		};
		const datalab = await jiti.import(datalabPath);
		await datalab.extractPDFViaDatalab(new ArrayBuffer(1), {
			maxPages: pdf.loadPDFConfig().maxPages,
			title: "Installed PDF",
		});
		assert.equal(datalabMaxPages, "1", "Installed Datalab request ignored pdf.maxPages");

		let geminiPrompt = "";
		globalThis.fetch = async (_url, init = {}) => {
			const body = JSON.parse(String(init.body));
			geminiPrompt = body.contents[0].parts[1].text;
			return jsonResponse({
				candidates: [{
					finishReason: "STOP",
					content: { parts: [{ text: "<!-- Page 1 -->\nGemini page" }] },
				}],
			});
		};
		const gemini = await jiti.import(geminiPath);
		await gemini.extractPDFViaGemini(new ArrayBuffer(1), {
			pages: 3,
			maxPages: pdf.loadPDFConfig().maxPages,
			title: "Installed PDF",
		});
		assert.match(geminiPrompt, /pages 1 through 1/);
		assert.match(geminiPrompt, /Stop after page 1/);

		delete process.env.DATALAB_API_KEY;
		delete process.env.GEMINI_API_KEY;
		globalThis.fetch = previousFetch;
		const local = await pdf.extractPDFToMarkdown(
			makeTwoPagePdf(),
			"https://example.test/installed.pdf",
			{ outputDir },
		);
		const markdown = readFileSync(local.outputPath, "utf8");
		assert.match(markdown, /Installed Page One/);
		assert.doesNotMatch(markdown, /Installed Page Two/);
		assert.match(markdown, /Only first 1 of 2 pages extracted/);

		return { configured: 1, datalab: 1, gemini: 1, local: "1/2" };
	} finally {
		globalThis.fetch = previousFetch;
		for (const [name, value] of previousEnvironment) {
			restoreEnvironment(name, value);
		}
		rmSync(root, { recursive: true, force: true });
	}
}
