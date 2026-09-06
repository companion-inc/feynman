import assert from "node:assert/strict";
import { existsSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

export const VERIFICATION_PHRASE = "Feynman installed docparser verification phrase";
export const HIDDEN_GPO_STAMP = "jbell on PROD1PC69 with BILLS";
export const HIDDEN_GPO_PRINT_STAMP =
	"VerDate Aug 31 2005 05:35 Dec 11, 2008 Jkt 079200 PO 00000 Frm 00002 Fmt 6652 Sfmt 6301 E:\\BILLS\\H7337.IH H7337";
const EXPECTED_PI_DOCPARSER_VERSION = "4.0.0";
const EXPECTED_LITEPARSE_VERSION = "2.14.3";
const EXPECTED_LITEPARSE_NATIVE_PACKAGES = [
	"@llamaindex/liteparse-darwin-arm64",
	"@llamaindex/liteparse-darwin-x64",
	"@llamaindex/liteparse-linux-arm64-gnu",
	"@llamaindex/liteparse-linux-x64-gnu",
	"@llamaindex/liteparse-linux-x64-musl",
	"@llamaindex/liteparse-win32-arm64-msvc",
	"@llamaindex/liteparse-win32-x64-msvc",
];

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const defaultPackageRoot = resolve(import.meta.dirname, "..");

function isPathInside(path, root) {
	const relativePath = relative(root, path);
	return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function escapePdfText(value) {
	return value
		.replaceAll("\\", "\\\\")
		.replaceAll("(", "\\(")
		.replaceAll(")", "\\)");
}

export function createMinimalPdf(
	text = VERIFICATION_PHRASE,
	stampFill = "1 g",
	stampBackgroundFill,
	printRowCount = 1,
) {
	const byteLength = (value) => Buffer.byteLength(value, "latin1");
	const content = [
		"BT",
		"/F1 18 Tf",
		"0 g",
		"72 720 Td",
		`(${escapePdfText(text)}) Tj`,
		"ET",
		"BT",
		"/F1 8 Tf",
		"0 g",
		"72 690 Td",
		`(${escapePdfText(HIDDEN_GPO_STAMP)}) Tj`,
		"ET",
		...(stampBackgroundFill
			? [
					"q",
					stampBackgroundFill,
					"16 10 10 110 re f",
					`20 10 580 ${Math.max(14, printRowCount * 12 + 4)} re f`,
					"Q",
				]
			: []),
		"BT",
		"/F1 1 Tf",
		stampFill,
		"0 5 -5 0 22 18 Tm",
		`(${escapePdfText(HIDDEN_GPO_STAMP)}) Tj`,
		"ET",
		...Array.from({ length: printRowCount }, (_, rowIndex) =>
			[
				["VerDate Aug 31 2005", 72],
				["05:35 Dec 11, 2008", 160],
				["Jkt 079200", 240],
				["PO 00000", 300],
				["Frm 00002", 350],
				["Fmt 6652", 410],
				["Sfmt 6301", 460],
				["E:\\BILLS\\H7337.IH", 510],
				["H7337", 585],
			].flatMap(([stampText, x]) => [
				"BT",
				"/F1 1 Tf",
				stampFill,
				`1 0 0 1 ${x} ${18 + rowIndex * 12} Tm`,
				`(${escapePdfText(stampText)}) Tj`,
				"ET",
			]),
		).flat(),
		"",
	].join("\n");
	const objects = [
		"<< /Type /Catalog /Pages 2 0 R >>",
		"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
		"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
		`<< /Length ${byteLength(content)} >>\nstream\n${content}endstream`,
	];
	let source = "%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n";
	const offsets = [0];
	for (let index = 0; index < objects.length; index += 1) {
		offsets.push(byteLength(source));
		source += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
	}
	const xrefOffset = byteLength(source);
	source += `xref\n0 ${objects.length + 1}\n`;
	source += "0000000000 65535 f \n";
	for (const offset of offsets.slice(1)) {
		source += `${String(offset).padStart(10, "0")} 00000 n \n`;
	}
	source += [
		"trailer",
		`<< /Size ${objects.length + 1} /Root 1 0 R >>`,
		"startxref",
		String(xrefOffset),
		"%%EOF",
		"",
	].join("\n");
	return Buffer.from(source, "latin1");
}

export function resolveInstalledDocparserPaths(packageRoot = defaultPackageRoot) {
	const resolvedPackageRoot = realpathSync(resolve(packageRoot));
	const piRoot = resolve(
		resolvedPackageRoot,
		"node_modules",
		"@earendil-works",
		"pi-coding-agent",
	);
	const piRequire = createRequire(resolve(piRoot, "package.json"));
	const jitiEntryPath = realpathSync(piRequire.resolve("jiti"));
	const jitiManifestPath = realpathSync(piRequire.resolve("jiti/package.json"));
	const piNodeModulesRoot = resolve(piRoot, "node_modules");
	const packageNodeModulesRoot = resolve(resolvedPackageRoot, "node_modules");
	assert.ok(
		isPathInside(jitiEntryPath, piNodeModulesRoot) ||
			isPathInside(jitiEntryPath, packageNodeModulesRoot),
		`Pi resolved Jiti outside the installed package: ${jitiEntryPath}`,
	);

	const docparserRoot = resolve(
		resolvedPackageRoot,
		".feynman",
		"npm",
		"node_modules",
		"pi-docparser",
	);
	const runtimeRoot = resolve(resolvedPackageRoot, ".feynman", "npm");
	const runtimeRequire = createRequire(resolve(runtimeRoot, "package.json"));
	const liteparseManifestPath = realpathSync(runtimeRequire.resolve("@llamaindex/liteparse/package.json"));
	const liteparseManifest = JSON.parse(readFileSync(liteparseManifestPath, "utf8"));
	assert.equal(
		liteparseManifest.version,
		EXPECTED_LITEPARSE_VERSION,
		`Installed LiteParse is not ${EXPECTED_LITEPARSE_VERSION}`,
	);
	const liteparseNativePackages = Object.keys(liteparseManifest.optionalDependencies ?? {})
		.filter((packageName) => packageName.startsWith("@llamaindex/liteparse-"))
		.sort();
	assert.deepEqual(
		liteparseNativePackages,
		EXPECTED_LITEPARSE_NATIVE_PACKAGES.toSorted(),
		"Installed LiteParse does not declare the reviewed seven native packages",
	);
	for (const packageName of EXPECTED_LITEPARSE_NATIVE_PACKAGES) {
		assert.equal(
			liteparseManifest.optionalDependencies?.[packageName],
			EXPECTED_LITEPARSE_VERSION,
			`Installed LiteParse does not pin ${packageName} ${EXPECTED_LITEPARSE_VERSION}`,
		);
	}
	const liteparseEntryPath = realpathSync(
		resolve(liteparseManifestPath, "..", liteparseManifest.main),
	);
	assert.ok(
		isPathInside(liteparseEntryPath, resolve(runtimeRoot, "node_modules")),
		`Installed LiteParse resolved outside the runtime workspace: ${liteparseEntryPath}`,
	);
	const extensionPath = resolve(docparserRoot, "extensions", "docparser", "index.ts");
	assert.ok(existsSync(extensionPath), `Installed pi-docparser extension is missing: ${extensionPath}`);
	const docparserManifest = JSON.parse(
		readFileSync(resolve(docparserRoot, "package.json"), "utf8"),
	);
	assert.equal(
		docparserManifest.version,
		EXPECTED_PI_DOCPARSER_VERSION,
		`Installed pi-docparser is not ${EXPECTED_PI_DOCPARSER_VERSION}`,
	);
	return {
		packageRoot: resolvedPackageRoot,
		piRoot,
		jitiEntryPath,
		jitiManifestPath,
		docparserRoot,
		extensionPath,
		liteparseEntryPath,
		liteparseManifestPath,
	};
}

function findTool(tools, name) {
	const tool = tools.get(name);
	assert.ok(tool, `Installed pi-docparser did not register ${name}`);
	assert.equal(typeof tool.execute, "function", `${name} has no execute function`);
	return tool;
}

export function assertDocumentParseResult(result) {
	assert.equal(result?.details?.pageCount, 1, "document_parse did not parse exactly one page");
	assert.ok(
		typeof result.details.outputPath === "string" && statSync(result.details.outputPath).size > 0,
		"document_parse did not write a nonempty parsed artifact",
	);
	return result.details.outputDir;
}

export function assertDocumentSearchResult(result, phrase = VERIFICATION_PHRASE) {
	const hits = result?.details?.hits;
	assert.ok(Array.isArray(hits), "document_search returned no structured hit list");
	assert.ok(
		hits.some((hit) => hit?.pageNum === 1 && hit?.text === phrase),
		`document_search did not return the exact phrase on page 1: ${phrase}`,
	);
}

export function assertDocumentScreenshotResult(result) {
	const screenshots = result?.details?.screenshots;
	assert.equal(screenshots?.length, 1, "document_screenshot did not return exactly one page");
	const screenshot = screenshots[0];
	assert.equal(screenshot.pageNum, 1, "document_screenshot returned the wrong page");
	assert.ok(screenshot.bytes > 0, "document_screenshot reported an empty PNG");
	const png = readFileSync(screenshot.outputPath);
	assert.ok(png.byteLength > PNG_SIGNATURE.byteLength, "document_screenshot wrote an empty PNG");
	assert.deepEqual(
		png.subarray(0, PNG_SIGNATURE.byteLength),
		PNG_SIGNATURE,
		"document_screenshot output is not a PNG",
	);
	return result.details.outputDir;
}

export function createTableHeaderProbePage() {
	const item = (text, x, y, width = 20) => ({
		text,
		x,
		y,
		width,
		height: 6,
		fontName: "Helvetica",
		fontSize: 5,
		fontHeight: 5,
		fontWeight: 400,
		words: [],
	});
	return {
		pageNumber: 1,
		pageWidth: 500,
		pageHeight: 700,
		textItems: [
			item("Model", 50, 100),
			item("Metric A", 170, 100),
			item("Metric B", 290, 100),
			item("Family", 50, 110),
			item("Detail", 159, 110, 3),
			item("Score A", 170, 110),
			item("Score B", 290, 110),
			item("Alpha", 50, 120),
			item("X", 159, 120, 3),
			item("10", 170, 120),
			item("20", 290, 120),
			item("Beta", 50, 130),
			item("Y", 159, 130, 3),
			item("11", 170, 130),
			item("21", 290, 130),
			item("Gamma", 50, 140),
			item("Z", 159, 140, 3),
			item("12", 170, 140),
			item("22", 290, 140),
		],
	};
}

export function assertTableHeaderProbeResult(result) {
	const markdown = result?.pages?.[0]?.markdown ?? result?.text ?? "";
	for (const expectedRow of [
		"| Model |  | Metric A | Metric B |",
		"| Family | Detail | Score A | Score B |",
		"| Alpha | X | 10 | 20 |",
		"| Beta | Y | 11 | 21 |",
		"| Gamma | Z | 12 | 22 |",
	]) {
		assert.ok(
			markdown.includes(expectedRow),
			`LiteParse lost an in-table cell from the multi-line header fixture: ${expectedRow}`,
		);
	}
	return markdown;
}

export async function verifyInstalledDocparser(options = {}) {
	const paths = resolveInstalledDocparserPaths(options.packageRoot);
	const root = await mkdtemp(resolve(tmpdir(), "feynman-installed-docparser-"));
	const pdfPath = resolve(root, "verification.pdf");
	const visibleStampPdfPath = resolve(root, "visible-stamps.pdf");
	const visibleWhiteStampPdfPath = resolve(root, "visible-white-stamps.pdf");
	const nearWhiteStampPdfPath = resolve(root, "near-white-stamps.pdf");
	const tools = new Map();
	const shutdownHandlers = [];
	const outputDirs = new Set();
	const previousTempEnv = {
		TMPDIR: process.env.TMPDIR,
		TMP: process.env.TMP,
		TEMP: process.env.TEMP,
	};
	let verification;
	let primaryError;
	const cleanupErrors = [];

	try {
		process.env.TMPDIR = root;
		process.env.TMP = root;
		process.env.TEMP = root;
		writeFileSync(pdfPath, createMinimalPdf(VERIFICATION_PHRASE, "1 g", false, 2));
		writeFileSync(visibleStampPdfPath, createMinimalPdf(VERIFICATION_PHRASE, "0 g"));
		writeFileSync(
			visibleWhiteStampPdfPath,
			createMinimalPdf(VERIFICATION_PHRASE, "1 g", "0 g"),
		);
		writeFileSync(
			nearWhiteStampPdfPath,
			createMinimalPdf(VERIFICATION_PHRASE, "1 g", "0.960784 g"),
		);
		const jitiModule = await import(pathToFileURL(paths.jitiEntryPath).href);
		assert.equal(typeof jitiModule.createJiti, "function", "Pi's installed Jiti has no createJiti");
		const liteparseModule = await import(pathToFileURL(paths.liteparseEntryPath).href);
		assert.equal(typeof liteparseModule.LiteParse, "function", "Installed LiteParse has no parser");
		const tableParser = new liteparseModule.LiteParse({
			ocrEnabled: false,
			outputFormat: "markdown",
			quiet: true,
		});
		const tableMarkdown = assertTableHeaderProbeResult(
			tableParser.parsePages([createTableHeaderProbePage()]),
		);
		const jiti = jitiModule.createJiti(import.meta.url, { moduleCache: false });
		const extension = await jiti.import(
			process.platform === "win32"
				? pathToFileURL(paths.extensionPath).href
				: paths.extensionPath,
			{ default: true },
		);
		assert.equal(typeof extension, "function", "Installed pi-docparser extension has no factory");
		extension({
			on(event, handler) {
				if (event === "session_shutdown") shutdownHandlers.push(handler);
			},
			registerCommand() {},
			registerTool(tool) {
				assert.equal(tools.has(tool.name), false, `Duplicate installed tool: ${tool.name}`);
				tools.set(tool.name, tool);
			},
		});

		const context = { cwd: root };
		const parseResult = await findTool(tools, "document_parse").execute(
			"installed-docparser-parse",
			{ path: pdfPath, format: "json", ocr: "off", maxPages: 1 },
			undefined,
			undefined,
			context,
		);
		if (parseResult?.details?.outputDir) outputDirs.add(parseResult.details.outputDir);
		assertDocumentParseResult(parseResult);
		const parsedArtifact = readFileSync(parseResult.details.outputPath, "utf8");
		const parsedJson = JSON.parse(parsedArtifact);
		assert.match(parsedJson.text, new RegExp(VERIFICATION_PHRASE));
		const visibleGpoControls = parsedJson.pages[0].textItems
			.filter((item) => item.text === HIDDEN_GPO_STAMP);
		assert.equal(
			visibleGpoControls.length,
			1,
			"document_parse did not preserve exactly one visible GPO-shaped negative control",
		);
		assert.ok(
			visibleGpoControls[0].x > 50,
			"document_parse retained the hidden margin stamp instead of the visible control",
		);
		assert.equal(
			parsedJson.text.split(HIDDEN_GPO_STAMP).length - 1,
			1,
			"document_parse text did not preserve exactly the visible GPO-shaped negative control",
		);
		assert.doesNotMatch(
			parsedJson.text,
			/VerDate Aug 31 2005/,
			"document_parse leaked the hidden GPO print-tracking stamp",
		);

		const searchResult = await findTool(tools, "document_search").execute(
			"installed-docparser-search",
			{
				path: pdfPath,
				phrase: VERIFICATION_PHRASE,
				ocr: "off",
				maxPages: 1,
				maxResults: 5,
			},
			undefined,
			undefined,
			context,
		);
		assertDocumentSearchResult(searchResult);
		const hiddenSearchResult = await findTool(tools, "document_search").execute(
			"installed-docparser-hidden-gpo-search",
			{
				path: pdfPath,
				phrase: HIDDEN_GPO_STAMP,
				ocr: "off",
				maxPages: 1,
				maxResults: 5,
			},
			undefined,
			undefined,
			context,
		);
		assert.equal(
			hiddenSearchResult?.details?.hits?.length,
			1,
			"document_search did not preserve exactly one visible GPO-shaped negative control",
		);
		assert.equal(hiddenSearchResult.details.hits[0].text, HIDDEN_GPO_STAMP);
		assert.ok(
			hiddenSearchResult.details.hits[0].x > 50,
			"document_search retained the hidden margin stamp instead of the visible control",
		);
		const hiddenPrintSearchResult = await findTool(tools, "document_search").execute(
			"installed-docparser-hidden-gpo-print-search",
			{
				path: pdfPath,
				phrase: "VerDate Aug 31 2005",
				ocr: "off",
				maxPages: 1,
				maxResults: 5,
			},
			undefined,
			undefined,
			context,
		);
		assert.deepEqual(
			hiddenPrintSearchResult?.details?.hits,
			[],
			"document_search returned the hidden GPO print-tracking stamp",
		);
		const visibleStampParseResult = await findTool(tools, "document_parse").execute(
			"installed-docparser-visible-gpo-parse",
			{ path: visibleStampPdfPath, format: "json", ocr: "off", maxPages: 1 },
			undefined,
			undefined,
			context,
		);
		if (visibleStampParseResult?.details?.outputDir) {
			outputDirs.add(visibleStampParseResult.details.outputDir);
		}
		const visibleStampArtifact = JSON.parse(
			readFileSync(visibleStampParseResult.details.outputPath, "utf8"),
		);
		assert.equal(
			visibleStampArtifact.pages[0].textItems
				.filter((item) => item.text === HIDDEN_GPO_STAMP).length,
			2,
			"document_parse removed a visibly painted GPO-shaped operator pair",
		);
		assert.match(
			visibleStampArtifact.text,
			/VerDate Aug 31 2005/,
			"document_parse removed a visibly painted GPO-shaped print row",
		);
		const visiblePrintSearchResult = await findTool(tools, "document_search").execute(
			"installed-docparser-visible-gpo-search",
			{
				path: visibleStampPdfPath,
				phrase: "VerDate Aug 31 2005",
				ocr: "off",
				maxPages: 1,
				maxResults: 5,
			},
			undefined,
			undefined,
			context,
		);
		assert.equal(
			visiblePrintSearchResult?.details?.hits?.length,
			1,
			"document_search removed a visibly painted GPO-shaped print row",
		);
		const visibleWhiteStampParseResult = await findTool(tools, "document_parse").execute(
			"installed-docparser-visible-white-gpo-parse",
			{ path: visibleWhiteStampPdfPath, format: "json", ocr: "off", maxPages: 1 },
			undefined,
			undefined,
			context,
		);
		if (visibleWhiteStampParseResult?.details?.outputDir) {
			outputDirs.add(visibleWhiteStampParseResult.details.outputDir);
		}
		const visibleWhiteStampArtifact = JSON.parse(
			readFileSync(visibleWhiteStampParseResult.details.outputPath, "utf8"),
		);
		assert.equal(
			visibleWhiteStampArtifact.pages[0].textItems
				.filter((item) => item.text === HIDDEN_GPO_STAMP).length,
			2,
			"document_parse removed a visible white-on-dark GPO-shaped operator pair",
		);
		assert.match(
			visibleWhiteStampArtifact.text,
			/VerDate Aug 31 2005/,
			"document_parse removed a visible white-on-dark GPO-shaped print row",
		);
		const visibleWhitePrintSearchResult = await findTool(tools, "document_search").execute(
			"installed-docparser-visible-white-gpo-search",
			{
				path: visibleWhiteStampPdfPath,
				phrase: "VerDate Aug 31 2005",
				ocr: "off",
				maxPages: 1,
				maxResults: 5,
			},
			undefined,
			undefined,
			context,
		);
		assert.equal(
			visibleWhitePrintSearchResult?.details?.hits?.length,
			1,
			"document_search removed a visible white-on-dark GPO-shaped print row",
		);
		const nearWhiteStampParseResult = await findTool(tools, "document_parse").execute(
			"installed-docparser-near-white-gpo-parse",
			{ path: nearWhiteStampPdfPath, format: "json", ocr: "off", maxPages: 1 },
			undefined,
			undefined,
			context,
		);
		if (nearWhiteStampParseResult?.details?.outputDir) {
			outputDirs.add(nearWhiteStampParseResult.details.outputDir);
		}
		const nearWhiteStampArtifact = JSON.parse(
			readFileSync(nearWhiteStampParseResult.details.outputPath, "utf8"),
		);
		assert.equal(
			nearWhiteStampArtifact.pages[0].textItems
				.filter((item) => item.text === HIDDEN_GPO_STAMP).length,
			2,
			"document_parse removed visible white-on-RGB-245 GPO-shaped operators",
		);
		assert.match(
			nearWhiteStampArtifact.text,
			/VerDate Aug 31 2005/,
			"document_parse removed a visible white-on-RGB-245 GPO-shaped print row",
		);
		const nearWhitePrintSearchResult = await findTool(tools, "document_search").execute(
			"installed-docparser-near-white-gpo-search",
			{
				path: nearWhiteStampPdfPath,
				phrase: "VerDate Aug 31 2005",
				ocr: "off",
				maxPages: 1,
				maxResults: 5,
			},
			undefined,
			undefined,
			context,
		);
		assert.equal(
			nearWhitePrintSearchResult?.details?.hits?.length,
			1,
			"document_search removed a visible white-on-RGB-245 GPO-shaped print row",
		);

		const screenshotResult = await findTool(tools, "document_screenshot").execute(
			"installed-docparser-screenshot",
			{ path: pdfPath, pages: "1", dpi: 72 },
			undefined,
			undefined,
			context,
		);
		if (screenshotResult?.details?.outputDir) outputDirs.add(screenshotResult.details.outputDir);
		assertDocumentScreenshotResult(screenshotResult);

		const jitiManifest = JSON.parse(readFileSync(paths.jitiManifestPath, "utf8"));
		verification = {
			docparser: EXPECTED_PI_DOCPARSER_VERSION,
			liteparse: EXPECTED_LITEPARSE_VERSION,
			jiti: jitiManifest.version,
			pageCount: parseResult.details.pageCount,
			hits: searchResult.details.hits.length,
			hiddenGpoStamps: "suppressed",
			pngBytes: screenshotResult.details.screenshots[0].bytes,
			tableColumns: tableMarkdown.split("\n")[0].split("|").length - 2,
		};
	} catch (error) {
		primaryError = error;
	} finally {
		for (const handler of shutdownHandlers.reverse()) {
			try {
				await handler();
			} catch (error) {
				cleanupErrors.push(error);
			}
		}
		for (const [name, value] of Object.entries(previousTempEnv)) {
			if (value === undefined) delete process.env[name];
			else process.env[name] = value;
		}
		for (const outputDir of outputDirs) {
			try {
				rmSync(outputDir, { recursive: true, force: true });
			} catch (error) {
				cleanupErrors.push(error);
			}
		}
		try {
			rmSync(root, { recursive: true, force: true });
		} catch (error) {
			cleanupErrors.push(error);
		}
	}
	if (primaryError && cleanupErrors.length > 0) {
		const aggregate = new AggregateError(
			[primaryError, ...cleanupErrors],
			`${primaryError instanceof Error ? primaryError.message : String(primaryError)}; installed pi-docparser cleanup also failed`,
		);
		aggregate.cause = primaryError;
		throw aggregate;
	}
	if (primaryError) throw primaryError;
	if (cleanupErrors.length > 0) {
		throw new AggregateError(cleanupErrors, "Installed pi-docparser cleanup failed");
	}
	return verification;
}

export function isDirectExecution(
	entryPath = process.argv[1],
	modulePath = fileURLToPath(import.meta.url),
) {
	if (!entryPath) return false;
	try {
		return realpathSync(entryPath) === realpathSync(modulePath);
	} catch {
		return resolve(entryPath) === resolve(modulePath);
	}
}

if (isDirectExecution()) {
	console.log(JSON.stringify(await verifyInstalledDocparser()));
}
