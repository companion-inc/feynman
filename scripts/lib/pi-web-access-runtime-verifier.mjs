import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

function runModelAwareRoutingProbe({
	geminiModulePath,
	indexModulePath,
	jitiModuleUrl,
	configPath,
	home,
}) {
	const env = {
		...process.env,
		FEYNMAN_WEB_SEARCH_CONFIG: configPath,
		HOME: home,
		PI_CODING_AGENT_DIR: home,
		USERPROFILE: home,
	};
	for (const name of [
		"EXA_API_KEY",
		"OPENAI_API_KEY",
		"PI_WEB_SEARCH_CONFIG",
		"SEARXNG_BASE_URL",
	]) {
		delete env[name];
	}
	return execFileSync(process.execPath, ["--input-type=module"], {
		encoding: "utf8",
		env,
		input: `
			import { createJiti } from ${JSON.stringify(jitiModuleUrl)};
			const jiti = createJiti(import.meta.url, { moduleCache: false });
			const index = await jiti.import(${JSON.stringify(indexModulePath)});
			const searchModule = await jiti.import(${JSON.stringify(geminiModulePath)});
			const available = {
				all: true,
				openai: true,
				brave: false,
				parallel: false,
				"parallel-mcp": false,
				tinyfish: false,
				search1api: false,
				searchinfinity: false,
				querit: false,
				tavily: false,
				firecrawl: false,
				jina: false,
				serpdive: false,
				searxng: false,
				duckduckgo: false,
				perplexity: false,
				exa: true,
				gemini: false,
				kagi: false,
				bocha: false,
				ollama: false,
				anysearch: false,
				xai: false,
				brightdata: false,
				serpbase: false,
				serper: false,
				valyu: false,
			};
			const curator = {
				codex: index.resolveCuratorDefaultProvider(
					"auto",
					available,
					{ model: { provider: "openai-codex" } },
				),
				nonCodex: index.resolveCuratorDefaultProvider(
					"auto",
					available,
					{ model: { provider: "openai" } },
				),
				openaiFallback: index.resolveCuratorDefaultProvider(
					"auto",
					{ ...available, exa: false },
					{ model: { provider: "openai" } },
				),
			};
			const models = [{
				provider: "openai-codex",
				id: "gpt-5.6-terra",
				api: "openai-codex-responses",
				baseUrl: "https://chatgpt.com/backend-api",
			}];
			const modelRegistry = {
				getAll: () => models,
				getApiKeyAndHeaders: async () => ({
					ok: true,
					apiKey: "synthetic-codex-token",
					headers: {},
				}),
			};
			let codexUrl = "";
			globalThis.fetch = async (url) => {
				codexUrl = String(url);
				if (codexUrl !== "https://chatgpt.com/backend-api/codex/responses") {
					throw new Error("Expected Codex search first, got " + codexUrl);
				}
				return new Response(JSON.stringify({
					output: [
						{
							type: "web_search_call",
							action: {
								sources: [{
									url: "https://codex.example/source",
									title: "Codex source",
								}],
							},
						},
						{
							type: "message",
							content: [{
								type: "output_text",
								text: "codex search answer",
							}],
						},
					],
				}), {
					status: 200,
					headers: { "content-type": "application/json" },
				});
			};
			const codexResult = await searchModule.search("codex route", {
				provider: "auto",
				extensionContext: {
					model: models[0],
					modelRegistry,
				},
			});
			let exaUrl = "";
			globalThis.fetch = async (url) => {
				exaUrl = String(url);
				if (exaUrl.startsWith("https://api.openai.com/") || exaUrl.startsWith("https://chatgpt.com/")) {
					throw new Error("OpenAI ran before Exa for a non-Codex model");
				}
				if (!exaUrl.startsWith("https://mcp.exa.ai/mcp")) {
					throw new Error("Expected Exa MCP first, got " + exaUrl);
				}
				const event = {
					result: {
						content: [{
							type: "text",
							text: "Title: Exa Source\\nURL: https://exa.example/source\\nText: Exa selected first",
						}],
					},
				};
				return new Response("data: " + JSON.stringify(event) + "\\n\\n", {
					status: 200,
					headers: { "content-type": "text/event-stream" },
				});
			};
			const exaResult = await searchModule.search("non-Codex route", {
				provider: "auto",
				extensionContext: {
					model: {
						provider: "openai",
						id: "gpt-5.6-terra",
						api: "openai-responses",
						baseUrl: "https://api.openai.com/v1",
					},
					modelRegistry,
				},
			});
			console.log(JSON.stringify({
				curator,
				search: {
					codex: codexResult.provider,
					codexUrl,
					nonCodex: exaResult.provider,
					exaUrl,
				},
			}));
		`,
		timeout: 20_000,
	});
}

export function verifyModelAwareSearchRouting(packageRoot) {
	const runtimeRoot = resolve(packageRoot, ".feynman", "npm");
	const jitiModuleUrl = pathToFileURL(createRequire(resolve(runtimeRoot, "node_modules", "@earendil-works", "pi-coding-agent", "package.json")).resolve("jiti")).href;
	const webRoot = resolve(runtimeRoot, "node_modules", "pi-web-access");
	const indexModulePath = resolve(webRoot, "index.ts");
	const geminiModulePath = resolve(webRoot, "gemini-search.ts");
	const root = mkdtempSync(join(tmpdir(), "feynman-installed-search-routing-"));
	const configPath = join(root, "web-search.json");

	assert.ok(existsSync(indexModulePath), "Installed pi-web-access index module is missing");
	assert.ok(existsSync(geminiModulePath), "Installed pi-web-access search module is missing");

	try {
		writeFileSync(
			configPath,
			JSON.stringify({ openaiSearchProviders: ["openai-codex", "openai"] }) + "\n",
			"utf8",
		);
		const result = JSON.parse(runModelAwareRoutingProbe({
			geminiModulePath,
			indexModulePath,
			jitiModuleUrl,
			configPath,
			home: root,
		}).trim());
		assert.deepEqual(result.curator, {
			codex: "openai",
			nonCodex: "exa",
			openaiFallback: "openai",
		});
		assert.equal(result.search.codex, "openai");
		assert.equal(
			result.search.codexUrl,
			"https://chatgpt.com/backend-api/codex/responses",
		);
		assert.equal(result.search.nonCodex, "exa");
		assert.match(result.search.exaUrl, /^https:\/\/mcp\.exa\.ai\/mcp/);
		return {
			curator: result.curator,
			search: {
				codex: result.search.codex,
				nonCodex: result.search.nonCodex,
			},
		};
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

function runGitHubProbe({
	githubModulePath,
	jitiModuleUrl,
	configPath,
	input,
}) {
	return execFileSync(process.execPath, ["--input-type=module"], {
		encoding: "utf8",
		env: {
			...process.env,
			FEYNMAN_WEB_SEARCH_CONFIG: configPath,
		},
		input: `
			import { createJiti } from ${JSON.stringify(jitiModuleUrl)};
			const jiti = createJiti(import.meta.url, { moduleCache: false });
			const github = await jiti.import(${JSON.stringify(githubModulePath)});
			${input}
		`,
		timeout: 15_000,
	});
}

export function verifyGitHubCloneSafety(packageRoot) {
	const runtimeRoot = resolve(packageRoot, ".feynman", "npm");
	const jitiModuleUrl = pathToFileURL(createRequire(resolve(runtimeRoot, "node_modules", "@earendil-works", "pi-coding-agent", "package.json")).resolve("jiti")).href;
	const githubModulePath = resolve(
		runtimeRoot,
		"node_modules",
		"pi-web-access",
		"github-extract.ts",
	);
	const root = mkdtempSync(join(tmpdir(), "feynman-installed-github-clone-"));
	const configPath = join(root, "web-search.json");
	const clonePath = join(root, "repos");
	const victimPath = join(root, "victim", "repo");
	const instrumentedRoot = join(root, "instrumented");
	const instrumentedModulePath = join(instrumentedRoot, "github-extract.ts");

	assert.ok(existsSync(githubModulePath), "Installed pi-web-access GitHub module is missing");

	try {
		mkdirSync(instrumentedRoot, { recursive: true });
		for (const filename of [
			"activity.ts",
			"github-api.ts",
			"github-extract.ts",
			"utils.ts",
		]) {
			copyFileSync(join(dirname(githubModulePath), filename), join(instrumentedRoot, filename));
		}
		writeFileSync(
			instrumentedModulePath,
			`${readFileSync(instrumentedModulePath, "utf8")}\nexport const __feynmanVerifier = { cloneCache, cloneDestination };\n`,
			"utf8",
		);
		mkdirSync(victimPath, { recursive: true });
		writeFileSync(join(victimPath, "marker.txt"), "preserve", "utf8");
		writeFileSync(
			configPath,
			JSON.stringify({ githubClone: { clonePath } }),
			"utf8",
		);
		const malformed = JSON.parse(
			runGitHubProbe({
				githubModulePath,
				jitiModuleUrl,
				configPath,
				input: `
					const result = await github.extractGitHub("https://github.com/..%2Fvictim/repo");
					console.log(JSON.stringify(result));
				`,
			}).trim(),
		);
		assert.equal(malformed, null, "Malformed GitHub owner reached clone handling");
		assert.equal(
			readFileSync(join(victimPath, "marker.txt"), "utf8"),
			"preserve",
			"Malformed GitHub owner deleted a path outside the clone cache",
		);

		mkdirSync(clonePath, { recursive: true });
		const siblingPath = join(clonePath, "preserve.txt");
		writeFileSync(siblingPath, "preserve", "utf8");
		const cleanup = JSON.parse(runGitHubProbe({
			githubModulePath: instrumentedModulePath,
			jitiModuleUrl,
			configPath,
			input: `
				const { existsSync, mkdirSync, readFileSync, writeFileSync } = await import("node:fs");
				const { join } = await import("node:path");
				const destination = github.__feynmanVerifier.cloneDestination(
					{ enabled: true, maxRepoSizeMB: 350, cloneTimeoutSeconds: 30, clonePath: ${JSON.stringify(clonePath)} },
					"owner",
					"repo",
				);
				if (!destination) throw new Error("Installed clone destination was rejected");
				mkdirSync(destination.localPath, { recursive: true });
				writeFileSync(join(destination.localPath, "README.md"), "fixture", "utf8");
				github.__feynmanVerifier.cloneCache.set("owner/repo", {
					destination,
					clonePromise: Promise.resolve(destination.localPath),
				});
				const existedBefore = existsSync(destination.localPath);
				github.clearCloneCache();
				console.log(JSON.stringify({
					existedBefore,
					existsAfter: existsSync(destination.localPath),
					sibling: readFileSync(${JSON.stringify(siblingPath)}, "utf8"),
				}));
			`,
		}).trim());
		assert.equal(cleanup.existedBefore, true, "Verified clone cache fixture was never populated");
		assert.equal(cleanup.existsAfter, false, "Verified clone cache entry survived cleanup");
		assert.equal(cleanup.sibling, "preserve", "Clone cache cleanup removed an unrelated sibling");

		const outsidePath = join(root, "outside");
		mkdirSync(outsidePath, { recursive: true });
		writeFileSync(join(outsidePath, "marker.txt"), "preserve", "utf8");
		const symlinkCleanup = JSON.parse(runGitHubProbe({
			githubModulePath: instrumentedModulePath,
			jitiModuleUrl,
			configPath,
			input: `
				const { existsSync, readFileSync, symlinkSync } = await import("node:fs");
				const destination = github.__feynmanVerifier.cloneDestination(
					{ enabled: true, maxRepoSizeMB: 350, cloneTimeoutSeconds: 30, clonePath: ${JSON.stringify(clonePath)} },
					"owner",
					"repo",
				);
				if (!destination) throw new Error("Installed clone destination was rejected");
				let status = "confined";
				try {
					symlinkSync(${JSON.stringify(outsidePath)}, destination.localPath, process.platform === "win32" ? "junction" : "dir");
				} catch (error) {
					if (!["EPERM", "EACCES", "ENOTSUP"].includes(error?.code)) throw error;
					status = "skipped-unsupported";
				}
				if (status === "confined") {
					github.__feynmanVerifier.cloneCache.set("owner/repo", {
						destination,
						clonePromise: Promise.resolve(destination.localPath),
					});
					github.clearCloneCache();
					if (existsSync(destination.localPath)) throw new Error("Clone cleanup retained a direct-child symlink");
				}
				console.log(JSON.stringify({
					status,
					target: readFileSync(${JSON.stringify(join(outsidePath, "marker.txt"))}, "utf8"),
				}));
			`,
		}).trim());
		assert.equal(symlinkCleanup.target, "preserve", "Clone cleanup followed a direct-child symlink");

		return {
			malformedIdentity: "rejected",
			cleanup: "confined",
			symlinkCleanup: symlinkCleanup.status,
		};
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}
