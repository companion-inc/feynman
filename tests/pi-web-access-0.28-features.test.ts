import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import {
	PI_WEB_ACCESS_PATCH_TARGETS,
	assertPiWebAccessPatchedSources,
	patchPiWebAccessSources,
} from "../scripts/lib/pi-web-access-patch.mjs";

const fixtureRoot = resolve(import.meta.dirname, "../fixtures/pi-web-access-0.28.0");
const webRoot = resolve(process.cwd(), ".feynman/npm/node_modules/pi-web-access");
const moduleUrl = (file: string) => pathToFileURL(join(webRoot, file)).href;
const reviewed = () => new Map(PI_WEB_ACCESS_PATCH_TARGETS.map(
	(file) => [file, readFileSync(join(fixtureRoot, file), "utf8")],
));

function probe(config: unknown, source: string): any {
	const root = mkdtempSync(join(tmpdir(), "feynman-web-028-"));
	const configPath = join(root, "web-search.json");
	writeFileSync(configPath, JSON.stringify(config));
	try {
		const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module"], {
			input: `
				import assert from "node:assert/strict";
				import { writeFileSync } from "node:fs";
				globalThis.fetch = async () => { throw new Error("Unexpected real-network path"); };
				${source}
			`,
			encoding: "utf8",
			timeout: 20_000,
			env: {
				...process.env,
				HOME: root,
				USERPROFILE: root,
				PI_CODING_AGENT_DIR: root,
				FEYNMAN_WEB_SEARCH_CONFIG: configPath,
			},
		});
		assert.equal(child.status, 0, child.stderr || child.error?.message || "Child process failed");
		return JSON.parse(child.stdout.trim().split("\n").at(-1)!);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

test("0.28 fixtures match every recorded registry source digest", () => {
	const provenance = JSON.parse(readFileSync(join(fixtureRoot, "SOURCE.json"), "utf8"));
	assert.equal(provenance.gitHead, "e55f78a6cf28e2ba5013e14c3dd7bb5eef2ac7c5");
	assert.equal(provenance.sha256, "8d27bd1440c5d1e2885e97b44efafe60f3d81a2a9e56c18ac8b84d6080718eb5");
	assert.equal(Object.keys(provenance.files).length, 72);
	for (const [file, digest] of Object.entries(provenance.files)) {
		const bytes = readFileSync(join(fixtureRoot, file));
		// Git may translate fixture newlines on Windows; registry bytes are LF.
		const normalized = bytes.toString("utf8").replace(/\r\n/g, "\n");
		assert.equal(createHash("sha256").update(normalized).digest("hex"), digest, file);
	}
	for (const file of PI_WEB_ACCESS_PATCH_TARGETS) assert.ok(provenance.files[file], file);
	const patched = patchPiWebAccessSources(reviewed(), "0.28 exact registry fixture");
	assert.deepEqual(patchPiWebAccessSources(patched), patched);
	const windowsCheckout = new Map([...reviewed()].map(
		([file, source]) => [file, source.replace(/\n/g, "\r\n")],
	));
	assert.deepEqual(patchPiWebAccessSources(windowsCheckout), patched);
});

test("0.28 new provider surfaces stay explicit-only and security controls stay mandatory", () => {
	const patched = patchPiWebAccessSources(reviewed());
	const index = patched.get("index.ts")!;
	assert.equal((index.match(/await searchWithDeadline\(/g) ?? []).length, 5);
	assert.equal((index.match(/\(\) => searchWithDeadline\(/g) ?? []).length, 1);
	assert.doesNotMatch(index, /await search\(|\(\) => search\(/);
	const routing = patched.get("gemini-search.ts")!;
	const all = routing.match(/export const ALL_SEARCH_PROVIDERS[^=]*= (\[[^\n]+);/)?.[1];
	assert.ok(all);
	for (const provider of ["xcrawl", "mistral", "xai"]) assert.ok(!all.includes(`"${provider}"`));
	assert.match(patched.get("xai-search.ts")!, /DEFAULT_XAI_SEARCH_TOOLS = \["web_search"\] as const/);
	assert.match(patched.get("mistral-search.ts")!, /const DEFAULT_SEARCH_TOOL = "web_search";/);
	for (const [file, anchor, disabled] of [
		["utils.ts", "return proxyStorage.getStore() ?? null;", "return loadConfiguredProxy();"],
		["index.ts", "() => searchWithDeadline(query, {", "() => search(query, {"],
		["page-query.ts", "modelMatchesScopedModels(model, ctx.scopedModels)", "true"],
		["gemini-search.ts", '"bocha"];', '"bocha", "mistral"];'],
	] as const) {
		const mutation = new Map(patched);
		assert.ok(mutation.get(file)!.includes(anchor), `${file}: mutation anchor`);
		mutation.set(file, mutation.get(file)!.replace(anchor, disabled));
		assert.throws(() => assertPiWebAccessPatchedSources(mutation), /expected .*found/);
	}
});

test("0.28 configured web proxy never leaks into unrelated or concurrent contexts", () => {
	const result = probe({ proxy: "http://config-user:config-secret@proxy.example:3128/" }, `
		const utils = await import(${JSON.stringify(moduleUrl("utils.ts"))});
		assert.equal(utils.getActiveProxy(), null);
		const outcomes = await Promise.all([
			utils.runWithProxy(undefined, async () => {
				await new Promise(resolve => setTimeout(resolve, 10));
				assert.equal(utils.getActiveProxy(), "http://config-user:config-secret@proxy.example:3128/");
				assert.equal(utils.hasScopedProxyDecision(), true);
				return "configured";
			}),
			utils.runWithProxy("", async () => {
				await new Promise(resolve => setTimeout(resolve, 5));
				assert.equal(utils.getActiveProxy(), null);
				assert.equal(utils.hasScopedProxyDecision(), true);
				return "disabled";
			}),
			(async () => {
				await new Promise(resolve => setTimeout(resolve, 7));
				assert.equal(utils.getActiveProxy(), null);
				assert.equal(utils.hasScopedProxyDecision(), false);
				return "unrelated";
			})(),
		]);
		assert.equal(utils.getActiveProxy(), null);
		console.log(JSON.stringify(outcomes));
	`);
	assert.deepEqual(result, ["configured", "disabled", "unrelated"]);
});

test("0.28 configured page answer defaults and explicit overrides obey the live session scope", () => {
	const result = probe({ fetch: { answerProvider: "test", answerModel: "configured" } }, `
		const { answerFromPage } = await import(${JSON.stringify(moduleUrl("page-query.ts"))});
		const models = ["current", "configured", "override"].map(id => ({
			api: "test-api", provider: "test", id, input: ["text"], contextWindow: 10000,
		}));
		const calls = [];
		const ctx = {
			model: models[0], scopedModels: [{model: models[1]}], cwd: process.cwd(),
			isProjectTrusted: () => false,
			modelRegistry: {
				find: (provider, id) => models.find(m => m.provider === provider && m.id === id),
				getAvailable: () => models,
				getApiKeyAndHeaders: async () => ({ok:true, apiKey:"synthetic-key"}),
				complete: async model => {
					calls.push(model.id);
					return {stopReason:"stop", content:[{type:"text",text:"Grounded answer"}]};
				},
			},
		};
		const input = {question:"Value?",pageText:"Value is 42.",sourceUrl:"https://example.com"};
		await answerFromPage(input, ctx);
		ctx.scopedModels = [{model: models[2]}];
		await assert.rejects(() => answerFromPage(input, ctx), /not enabled/);
		writeFileSync(process.env.FEYNMAN_WEB_SEARCH_CONFIG, "{");
		await answerFromPage({...input, model:"test/override"}, ctx);
		await assert.rejects(() => answerFromPage({...input, model:"test/current"}, ctx), /not enabled/);
		console.log(JSON.stringify(calls));
	`);
	assert.deepEqual(result, ["configured", "override"]);
});

test("0.28 direct/Jina timeout config keeps bounded defaults and explicit override precedence", () => {
	assert.deepEqual(probe({ fetch: { timeout: 1.2345 } }, `
		const { resolveFetchTimeoutMs } = await import(${JSON.stringify(moduleUrl("extract.ts"))});
		const configured = resolveFetchTimeoutMs({});
		writeFileSync(process.env.FEYNMAN_WEB_SEARCH_CONFIG, JSON.stringify({fetch:{timeout:0}}));
		assert.throws(() => resolveFetchTimeoutMs({}), /Invalid fetch.timeout/);
		const explicit = resolveFetchTimeoutMs({timeoutMs: 2000});
		writeFileSync(process.env.FEYNMAN_WEB_SEARCH_CONFIG, "{}");
		const fallback = resolveFetchTimeoutMs({});
		console.log(JSON.stringify({configured, explicit, fallback}));
	`), { configured: 1235, explicit: 2000, fallback: 30000 });
});

test("0.28 batch searches stay bounded, ordered and retrievable by the visible response ID", () => {
	const result = probe({ xcrawlApiKey: "synthetic-xcrawl-key", autoOpenBrowser: false }, `
		let active = 0, maxActive = 0;
		const completed = [];
		globalThis.fetch = async (url, init) => {
			assert.equal(String(url), "https://run.xcrawl.com/v1/serp");
			const query = JSON.parse(init.body).q;
			active++;
			maxActive = Math.max(active, maxActive);
			await new Promise(resolve => setTimeout(resolve, query === "q1" ? 75 : 5));
			active--;
			completed.push(query);
			return new Response(JSON.stringify({
				search_metadata: {status:"completed"},
				organic_results:[{title:query, link:"https://example.com/"+query, snippet:query}],
			}), {status:200});
		};
		const tools = new Map(), handlers = new Map();
		const initialize = (await import(${JSON.stringify(moduleUrl("index.ts"))})).default;
		initialize({
			registerTool: t => tools.set(t.name,t),
			registerCommand(){}, registerShortcut(){}, appendEntry(){}, sendMessage(){},
			on: (name, handler) => handlers.set(name,handler),
		});
		await handlers.get("session_start")({}, {sessionManager:{getBranch:()=>[]}});
		const raw = await tools.get("web_search").execute("batch", {
			query:'["q1","q2","q3","q4","q5"]', provider:"xcrawl", workflow:"none",
		});
		assert.ok(!raw.isError, JSON.stringify(raw));
		const text = raw.content[0].text;
		let previous = -1;
		for (const q of ["q1","q2","q3","q4","q5"]) {
			const position = text.indexOf('## Query: "'+q+'"');
			assert.ok(position > previous);
			previous = position;
		}
		const responseId = text.match(/Results stored as responseId "([^"]+)"/)[1];
		assert.equal(responseId, raw.details.searchId);
		const retrieved = await tools.get("get_search_content").execute("retrieve", {responseId,queryIndex:0});
		assert.ok(!retrieved.isError, JSON.stringify(retrieved));
		assert.ok(retrieved.content[0].text.includes("q1"));
		console.log(JSON.stringify({maxActive, count:completed.length, first:completed[0]}));
	`);
	assert.equal(result.maxActive, 3);
	assert.equal(result.count, 5);
	assert.notEqual(result.first, "q1");
});

test("0.28 Perplexity preserves cited sources beyond numResults without unbounded output", () => {
	const result = probe({ perplexityApiKey: "synthetic-perplexity-key" }, `
		globalThis.fetch = async () => new Response(JSON.stringify({
			choices:[{message:{content:"Evidence [1] and [4]"}}],
			citations: Array.from({length:30},(_,i)=>"https://example.com/"+(i+1)),
		}), {status:200});
		const { searchWithPerplexity } = await import(${JSON.stringify(moduleUrl("perplexity.ts"))});
		const result = await searchWithPerplexity("evidence", {numResults:1});
		console.log(JSON.stringify({count:result.results.length, fourth:result.results[3].url}));
	`);
	assert.deepEqual(result, { count: 4, fourth: "https://example.com/4" });
});
