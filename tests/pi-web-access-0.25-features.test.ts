import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import {
	PI_WEB_ACCESS_PATCH_TARGETS,
	patchPiWebAccessSources,
} from "../scripts/lib/pi-web-access-patch.mjs";

const appRoot = process.cwd();
const runtimeRoot = resolve(appRoot, ".feynman", "npm");
const webRoot = resolve(runtimeRoot, "node_modules", "pi-web-access");
const fixtureRoot = resolve(
	appRoot,
	"tests",
	"fixtures",
	"pi-web-access-0.25.0",
);
const runtimeRequire = createRequire(resolve(runtimeRoot, "package.json"));
const jitiModule = await import(pathToFileURL(runtimeRequire.resolve("jiti")).href);
const jiti = jitiModule.createJiti(import.meta.url, { moduleCache: false });

function createPatchedPackageRoot(): string {
	const root = mkdtempSync(resolve(tmpdir(), "feynman-web-025-patched-"));
	const sources = new Map(
		PI_WEB_ACCESS_PATCH_TARGETS.map((relativePath) => [
			relativePath,
			readFileSync(resolve(fixtureRoot, `${relativePath}.fixture`), "utf8"),
		]),
	);
	const patched = patchPiWebAccessSources(sources, "executable feature fixture");
	for (const [relativePath, source] of patched) {
		const path = resolve(root, relativePath);
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, source, "utf8");
	}
	for (const relativePath of ["activity.ts"]) {
		const path = resolve(root, relativePath);
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(
			path,
			readFileSync(resolve(webRoot, relativePath), "utf8"),
			"utf8",
		);
	}
	writeFileSync(
		resolve(root, "package.json"),
		JSON.stringify({ name: "pi-web-access", version: "0.25.0", type: "module" }) + "\n",
		"utf8",
	);
	return root;
}

test("pi-web-access 0.25 renders bounded GitHub PR research documents", async () => {
	const github = await jiti.import(
		resolve(webRoot, "github-issue-pr.ts"),
	) as {
		parseGitHubIssuePrUrl(url: string): {
			kind: string;
			number: number;
			anchor?: string;
		} | null;
		renderGitHubPrIssue(data: unknown): {
			title: string;
			content: string;
			error: string | null;
		};
	};
	assert.deepEqual(
		github.parseGitHubIssuePrUrl(
			"https://github.com/advaitpaliwal/feynman/pull/259#discussion_r123",
		),
		{
			owner: "advaitpaliwal",
			repo: "feynman",
			kind: "pull",
			number: 259,
			anchor: "discussion_r123",
		},
	);
	const rendered = github.renderGitHubPrIssue({
		url: "https://github.com/advaitpaliwal/feynman/pull/259",
		owner: "advaitpaliwal",
		repo: "feynman",
		kind: "pull",
		number: 259,
		view: {
			number: 259,
			title: "Harden runtime timeouts",
			state: "MERGED",
			author: { login: "maintainer" },
			baseRefName: "main",
			headRefName: "runtime-timeouts",
			headRepositoryOwner: { login: "advaitpaliwal" },
			additions: 10,
			deletions: 2,
			changedFiles: 3,
			commits: [],
			files: [],
			comments: [],
			reviews: [],
			statusCheckRollup: [],
			closingIssuesReferences: [],
			labels: [],
			assignees: [],
		},
		reviewThreads: [],
		reviewThreadsBounded: false,
		reviewThreadsUnavailable: false,
		fallbackNotes: [],
	});
	assert.equal(rendered.error, null);
	assert.match(rendered.title, /pull #259/);
	assert.match(rendered.content, /## Checks/);
	assert.match(rendered.content, /Stored full document: use `get_search_content`/);
	assert.match(rendered.content, /Complete diff: `gh pr diff 259/);
});

test("pi-web-access 0.25 scopes explicit proxies and always bypasses loopback", async () => {
	const [fetchParams, utils] = await Promise.all([
		jiti.import(resolve(webRoot, "fetch-params.ts")) as Promise<{
			normalizeFetchContentParams(params: unknown): {
				options: { proxy?: string };
			};
		}>,
		jiti.import(resolve(webRoot, "utils.ts")) as Promise<{
			getActiveProxy(): string | null;
			isProxyBypassedUrl(url: URL): boolean;
			runWithProxy<T>(proxy: string | undefined, callback: () => T): T;
		}>,
	]);
	const normalized = fetchParams.normalizeFetchContentParams({
		url: "https://example.com/paper",
		proxy: "https://proxy.example:8443",
	});
	assert.equal(normalized.options.proxy, "https://proxy.example:8443/");
	assert.equal(
		utils.runWithProxy(normalized.options.proxy, () => utils.getActiveProxy()),
		"https://proxy.example:8443/",
	);
	assert.equal(utils.isProxyBypassedUrl(new URL("http://127.0.0.1:3000")), true);
	assert.equal(utils.isProxyBypassedUrl(new URL("http://localhost:3000")), true);
});

test("patched proxy routing covers loopback and port-aware domain NO_PROXY semantics", () => {
	const packageRoot = createPatchedPackageRoot();
	try {
		const utilsUrl = pathToFileURL(resolve(packageRoot, "utils.ts")).href;
		const child = spawnSync(
			process.execPath,
			["--import", "tsx", "--input-type=module"],
			{
				encoding: "utf8",
				env: {
					...process.env,
					NO_PROXY: "",
					no_proxy: "",
					HTTP_PROXY: "http://inherited.invalid:1",
					HTTPS_PROXY: "http://inherited.invalid:1",
					ALL_PROXY: "http://inherited.invalid:1",
				},
				input: `
					const utils = await import(${JSON.stringify(utilsUrl)});
					const loopback = Object.fromEntries([
						"http://127.0.0.1:3000",
						"http://127.0.0.2:3000",
						"http://127.255.255.255:3000",
						"http://localhost.:3000",
						"http://foo.localhost.:3000",
						"http://[::1]:3000",
						"http://[::ffff:127.0.0.1]:3000",
					].map((value) => [value, utils.isProxyBypassedUrl(new URL(value))]));
					process.env.NO_PROXY = "example.com:8443,.internal.example";
					const noProxy = {
						matchingPort: utils.isProxyBypassedUrl(new URL("https://example.com:8443")),
						otherPort: utils.isProxyBypassedUrl(new URL("https://example.com")),
						baseDomain: utils.isProxyBypassedUrl(new URL("https://internal.example")),
						subdomain: utils.isProxyBypassedUrl(new URL("https://api.internal.example")),
					};
					process.env.NO_PROXY = "";
					const proxied = utils.runWithProxy(
						"http://user:secret@proxy.example:8080",
						() => utils.getProxyProcessEnv("https://github.com"),
					);
					process.env.NO_PROXY = "github.com";
					const bypassed = utils.runWithProxy(
						"http://user:secret@proxy.example:8080",
						() => utils.getProxyProcessEnv("https://github.com"),
					);
					process.env.NO_PROXY = "";
					const forcedDirect = utils.runWithProxy(
						"",
						() => utils.getProxyProcessEnv("https://github.com"),
					);
					console.log(JSON.stringify({ loopback, noProxy, proxied, bypassed, forcedDirect }));
				`,
			},
		);
		assert.equal(child.status, 0, child.stderr);
		const output = JSON.parse(child.stdout.trim()) as {
			loopback: Record<string, boolean>;
			noProxy: Record<string, boolean>;
			proxied: NodeJS.ProcessEnv;
			bypassed: NodeJS.ProcessEnv;
			forcedDirect: NodeJS.ProcessEnv;
		};
		assert.ok(
			Object.values(output.loopback).every(Boolean),
			JSON.stringify(output.loopback),
		);
		assert.deepEqual(output.noProxy, {
			matchingPort: true,
			otherPort: false,
			baseDomain: true,
			subdomain: true,
		});
		for (const name of [
			"HTTP_PROXY",
			"HTTPS_PROXY",
			"ALL_PROXY",
			"http_proxy",
			"https_proxy",
			"all_proxy",
		]) {
			assert.equal(
				output.proxied[name],
				"http://user:secret@proxy.example:8080/",
				`${name} did not receive the per-call proxy`,
			);
			assert.equal(output.bypassed[name], undefined, `${name} ignored NO_PROXY`);
			assert.equal(output.forcedDirect[name], undefined, `${name} survived forced direct mode`);
		}
	} finally {
		rmSync(packageRoot, { recursive: true, force: true });
	}
});

test("patched curl proxy transport keeps credentials and headers out of process argv", () => {
	const packageRoot = createPatchedPackageRoot();
	const root = mkdtempSync(resolve(tmpdir(), "feynman-web-curl-stdin-"));
	try {
		const bin = resolve(root, "bin");
		const logPath = resolve(root, "curl.json");
		mkdirSync(bin, { recursive: true });
		const fakeCurlSource = `
			const fs = require("node:fs");
			let input = "";
			process.stdin.setEncoding("utf8");
			process.stdin.on("data", (chunk) => { input += chunk; });
			process.stdin.on("end", () => {
				const args = process.argv.slice(2);
				fs.writeFileSync(process.env.FEYNMAN_CURL_LOG, JSON.stringify({ args, stdin: input }));
				const valueAfter = (name) => {
					const index = args.indexOf(name);
					return index >= 0 ? args[index + 1] : undefined;
				};
				const headerFile = valueAfter("-D");
				const bodyFile = valueAfter("--output");
				if (!headerFile || !bodyFile) process.exit(2);
				fs.writeFileSync(headerFile, "HTTP/1.1 200 OK\\r\\nContent-Type: text/plain\\r\\n\\r\\n");
				fs.writeFileSync(bodyFile, "proxy-ok");
				process.stdout.write(JSON.stringify({
					url_effective: "https://research.example/paper?token=url-secret",
					num_redirects: 0,
				}));
			});
		`;
		const fakeCurlJs = resolve(bin, "fake-curl.cjs");
		writeFileSync(fakeCurlJs, fakeCurlSource, "utf8");
		if (process.platform === "win32") {
			writeFileSync(
				resolve(bin, "curl.cmd"),
				`@echo off\r\n"${process.execPath}" "${fakeCurlJs}" %*\r\n`,
				"utf8",
			);
		} else {
			const curlPath = resolve(bin, "curl");
			writeFileSync(curlPath, `#!/usr/bin/env node\n${fakeCurlSource}`, "utf8");
			chmodSync(curlPath, 0o755);
		}

		const utilsUrl = pathToFileURL(resolve(packageRoot, "utils.ts")).href;
		const child = spawnSync(
			process.execPath,
			["--import", "tsx", "--input-type=module"],
			{
				encoding: "utf8",
				env: {
					...process.env,
					PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
					FEYNMAN_CURL_LOG: logPath,
					NO_PROXY: "",
					no_proxy: "",
				},
				input: `
					const utils = await import(${JSON.stringify(utilsUrl)});
					utils.installGlobalProxyFetch();
					const response = await utils.runWithProxy(
						"http://proxy-user:proxy-password@proxy.example:8080",
						() => fetch("https://research.example/paper?token=url-secret", {
							headers: {
								Authorization: "Bearer header-secret",
								Cookie: "browser-secret",
							},
						}),
					);
					console.log(await response.text());
				`,
			},
		);
		assert.equal(child.status, 0, child.stderr);
		assert.equal(child.stdout.trim(), "proxy-ok");
		const log = JSON.parse(readFileSync(logPath, "utf8")) as {
			args: string[];
			stdin: string;
		};
		assert.deepEqual(log.args.slice(-2), ["--config", "-"]);
		const argv = log.args.join("\n");
		for (const secret of [
			"proxy-user",
			"proxy-password",
			"url-secret",
			"header-secret",
			"browser-secret",
		]) {
			assert.doesNotMatch(argv, new RegExp(secret));
			assert.match(log.stdin, new RegExp(secret));
		}
		assert.match(log.stdin, /^proxy = /m);
		assert.match(log.stdin, /^header = /m);
		assert.match(log.stdin, /^url = /m);
	} finally {
		rmSync(packageRoot, { recursive: true, force: true });
		rmSync(root, { recursive: true, force: true });
	}
});

test("patched curl proxy transport remains compatible with real curl config parsing", (t) => {
	const curlVersion = spawnSync("curl", ["--version"], { encoding: "utf8" });
	if (curlVersion.status !== 0) {
		t.skip("curl is unavailable");
		return;
	}
	const packageRoot = createPatchedPackageRoot();
	try {
		const utilsUrl = pathToFileURL(resolve(packageRoot, "utils.ts")).href;
		const child = spawnSync(
			process.execPath,
			["--import", "tsx", "--input-type=module"],
			{
				encoding: "utf8",
				env: {
					...process.env,
					NO_PROXY: "",
					no_proxy: "",
				},
				input: `
					import { createServer } from "node:http";
					const requests = [];
					const server = createServer((request, response) => {
						requests.push({
							url: request.url,
							proxyAuthorization: request.headers["proxy-authorization"] ?? null,
							authorization: request.headers.authorization ?? null,
							cookie: request.headers.cookie ?? null,
						});
						response.writeHead(200, { "content-type": "text/plain" });
						response.end("proxy-ok");
					});
					await new Promise((resolvePromise, reject) => {
						server.once("error", reject);
						server.listen(0, "127.0.0.1", resolvePromise);
					});
					try {
						const address = server.address();
						if (!address || typeof address === "string") throw new Error("missing proxy address");
						const utils = await import(${JSON.stringify(utilsUrl)});
						utils.installGlobalProxyFetch();
						const response = await utils.runWithProxy(
							\`http://proxy-user:proxy-password@127.0.0.1:\${address.port}\`,
							() => fetch("http://research.example/paper?token=url-secret", {
								headers: {
									Authorization: "Bearer header-secret",
									Cookie: "browser-secret",
								},
							}),
						);
						console.log(JSON.stringify({
							body: await response.text(),
							status: response.status,
							requests,
						}));
					} finally {
						await new Promise((resolvePromise) => server.close(resolvePromise));
					}
				`,
			},
		);
		assert.equal(child.status, 0, child.stderr);
		const output = JSON.parse(child.stdout.trim()) as {
			body: string;
			status: number;
			requests: Array<{
				url: string;
				proxyAuthorization: string | null;
				authorization: string | null;
				cookie: string | null;
			}>;
		};
		assert.equal(output.status, 200);
		assert.equal(output.body, "proxy-ok");
		assert.equal(output.requests.length, 1);
		assert.equal(
			output.requests[0].url,
			"http://research.example/paper?token=url-secret",
		);
		assert.equal(
			output.requests[0].proxyAuthorization,
			`Basic ${Buffer.from("proxy-user:proxy-password").toString("base64")}`,
		);
		assert.equal(output.requests[0].authorization, "Bearer header-secret");
		assert.equal(output.requests[0].cookie, "browser-secret");
	} finally {
		rmSync(packageRoot, { recursive: true, force: true });
	}
});

test("patched GitHub issue and PR gh calls inherit the per-call proxy and bypass it via NO_PROXY", () => {
	const packageRoot = createPatchedPackageRoot();
	const root = mkdtempSync(resolve(tmpdir(), "feynman-web-gh-proxy-"));
	try {
		const bin = resolve(root, "bin");
		const logPath = resolve(root, "gh.jsonl");
		mkdirSync(bin, { recursive: true });
		const fakeGhSource = `
			const fs = require("node:fs");
			const args = process.argv.slice(2);
			fs.appendFileSync(process.env.FEYNMAN_GH_PROXY_LOG, JSON.stringify({
				args,
				HTTP_PROXY: process.env.HTTP_PROXY ?? null,
				HTTPS_PROXY: process.env.HTTPS_PROXY ?? null,
				ALL_PROXY: process.env.ALL_PROXY ?? null,
				GH_PROMPT_DISABLED: process.env.GH_PROMPT_DISABLED ?? null,
			}) + "\\n");
			if (args[0] === "--version") {
				console.log("gh version test");
				process.exit(0);
			}
			if (args[0] === "pr" && args[1] === "view") {
				console.log(JSON.stringify({
					number: 1,
					title: "Proxy boundary",
					state: "OPEN",
					author: { login: "maintainer" },
					baseRefName: "main",
					headRefName: "proxy",
					headRepositoryOwner: { login: "owner" },
					additions: 0,
					deletions: 0,
					changedFiles: 0,
					commits: [],
					files: [],
					comments: [],
					reviews: [],
					statusCheckRollup: [],
					closingIssuesReferences: [],
					labels: [],
					assignees: [],
					body: "",
					url: "https://github.com/owner/repo/pull/1",
				}));
				process.exit(0);
			}
			if (args[0] === "api") {
				console.log("[]");
				process.exit(0);
			}
			process.exit(1);
		`;
		const fakeGhJs = resolve(bin, "fake-gh.cjs");
		writeFileSync(fakeGhJs, fakeGhSource, "utf8");
		if (process.platform === "win32") {
			writeFileSync(
				resolve(bin, "gh.cmd"),
				`@echo off\r\n"${process.execPath}" "${fakeGhJs}" %*\r\n`,
				"utf8",
			);
		} else {
			const ghPath = resolve(bin, "gh");
			writeFileSync(
				ghPath,
				`#!/usr/bin/env node\n${fakeGhSource}`,
				"utf8",
			);
			chmodSync(ghPath, 0o755);
		}

		const utilsUrl = pathToFileURL(resolve(packageRoot, "utils.ts")).href;
		const githubUrl = pathToFileURL(resolve(packageRoot, "github-issue-pr.ts")).href;
		const child = spawnSync(
			process.execPath,
			["--import", "tsx", "--input-type=module"],
			{
				encoding: "utf8",
				env: {
					...process.env,
					PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
					FEYNMAN_GH_PROXY_LOG: logPath,
					FEYNMAN_WEB_SEARCH_CONFIG: resolve(root, "web-search.json"),
					NO_PROXY: "",
					no_proxy: "",
					HTTP_PROXY: "http://inherited.invalid:1",
					HTTPS_PROXY: "http://inherited.invalid:1",
					ALL_PROXY: "http://inherited.invalid:1",
				},
				input: `
					const utils = await import(${JSON.stringify(utilsUrl)});
					const github = await import(${JSON.stringify(githubUrl)});
					await utils.runWithProxy(
						"http://explicit.proxy:8123",
						() => github.extractGitHubIssuePr("https://github.com/owner/repo/pull/1"),
					);
					process.env.NO_PROXY = "github.com";
					await utils.runWithProxy(
						"http://explicit.proxy:8123",
						() => github.extractGitHubIssuePr("https://github.com/owner/repo/pull/1"),
					);
				`,
			},
		);
		assert.equal(child.status, 0, child.stderr);
		const calls = readFileSync(logPath, "utf8")
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line)) as Array<Record<string, unknown>>;
		assert.ok(calls.length >= 5, JSON.stringify(calls));
		const proxiedCalls = calls.slice(0, 3);
		for (const call of proxiedCalls) {
			assert.equal(call.HTTP_PROXY, "http://explicit.proxy:8123/");
			assert.equal(call.HTTPS_PROXY, "http://explicit.proxy:8123/");
			assert.equal(call.ALL_PROXY, "http://explicit.proxy:8123/");
		}
		for (const call of calls.slice(3)) {
			assert.equal(call.HTTP_PROXY, null);
			assert.equal(call.HTTPS_PROXY, null);
			assert.equal(call.ALL_PROXY, null);
		}
		assert.ok(calls.some((call) => call.GH_PROMPT_DISABLED === "1"));
	} finally {
		rmSync(packageRoot, { recursive: true, force: true });
		rmSync(root, { recursive: true, force: true });
	}
});

test("patched GitHub clones propagate explicit, bypassed, and forced-direct proxy decisions", () => {
	const packageRoot = createPatchedPackageRoot();
	const root = mkdtempSync(resolve(tmpdir(), "feynman-web-clone-proxy-"));
	try {
		const bin = resolve(root, "bin");
		const logPath = resolve(root, "clone.jsonl");
		mkdirSync(bin, { recursive: true });
		const fakeCommandSource = `
			const fs = require("node:fs");
			const path = require("node:path");
			const args = process.argv.slice(2);
			const command = args[0] === "--version" || args[0] === "repo" ? "gh" : "git";
			fs.appendFileSync(process.env.FEYNMAN_CLONE_PROXY_LOG, JSON.stringify({
				scenario: process.env.FEYNMAN_SCENARIO,
				command,
				args,
				HTTP_PROXY: process.env.HTTP_PROXY ?? null,
				HTTPS_PROXY: process.env.HTTPS_PROXY ?? null,
				ALL_PROXY: process.env.ALL_PROXY ?? null,
				GIT_TERMINAL_PROMPT: process.env.GIT_TERMINAL_PROMPT ?? null,
			}) + "\\n");
			if (command === "gh" && args[0] === "--version") {
				if (process.env.FEYNMAN_GH_AVAILABLE === "1") {
					console.log("gh version test");
					process.exit(0);
				}
				process.exit(1);
			}
			let destination;
			if (command === "gh" && args[0] === "repo" && args[1] === "clone") {
				destination = args[3];
			} else if (command === "git" && args[0] === "clone") {
				destination = args.at(-1);
			}
			if (!destination) process.exit(2);
			fs.mkdirSync(destination, { recursive: true });
			fs.writeFileSync(path.join(destination, "README.md"), "# Proxy clone\\n");
		`;
		const fakeGhJs = resolve(bin, "fake-gh.cjs");
		const fakeGitJs = resolve(bin, "fake-git.cjs");
		writeFileSync(fakeGhJs, fakeCommandSource, "utf8");
		writeFileSync(fakeGitJs, fakeCommandSource, "utf8");
		if (process.platform === "win32") {
			writeFileSync(
				resolve(bin, "gh.cmd"),
				`@echo off\r\n"${process.execPath}" "${fakeGhJs}" %*\r\n`,
				"utf8",
			);
			writeFileSync(
				resolve(bin, "git.cmd"),
				`@echo off\r\n"${process.execPath}" "${fakeGitJs}" %*\r\n`,
				"utf8",
			);
		} else {
			const ghPath = resolve(bin, "gh");
			const gitPath = resolve(bin, "git");
			writeFileSync(
				ghPath,
				`#!/usr/bin/env node\n${fakeCommandSource}`,
				"utf8",
			);
			writeFileSync(
				gitPath,
				`#!/usr/bin/env node\n${fakeCommandSource}`,
				"utf8",
			);
			chmodSync(ghPath, 0o755);
			chmodSync(gitPath, 0o755);
		}

		const utilsUrl = pathToFileURL(resolve(packageRoot, "utils.ts")).href;
		const githubUrl = pathToFileURL(
			resolve(packageRoot, "github-extract.ts"),
		).href;
		const scenarios = [
			{
				name: "explicit-gh",
				ghAvailable: true,
				noProxy: "",
				proxy: "http://explicit.proxy:8123",
			},
			{
				name: "bypassed-gh",
				ghAvailable: true,
				noProxy: "github.com",
				proxy: "http://explicit.proxy:8123",
			},
			{
				name: "forced-direct-gh",
				ghAvailable: true,
				noProxy: "",
				proxy: "",
			},
			{
				name: "explicit-git",
				ghAvailable: false,
				noProxy: "",
				proxy: "http://explicit.proxy:8123",
			},
		];
		for (const scenario of scenarios) {
			const configPath = resolve(root, `${scenario.name}.json`);
			writeFileSync(
				configPath,
				JSON.stringify({
					githubClone: {
						enabled: true,
						clonePath: resolve(root, "clones", scenario.name),
					},
				}),
				"utf8",
			);
			const child = spawnSync(
				process.execPath,
				["--import", "tsx", "--input-type=module"],
				{
					encoding: "utf8",
					env: {
						...process.env,
						PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
						FEYNMAN_CLONE_PROXY_LOG: logPath,
						FEYNMAN_SCENARIO: scenario.name,
						FEYNMAN_GH_AVAILABLE: scenario.ghAvailable ? "1" : "0",
						FEYNMAN_WEB_SEARCH_CONFIG: configPath,
						NO_PROXY: scenario.noProxy,
						no_proxy: scenario.noProxy,
						HTTP_PROXY: "http://inherited.invalid:1",
						HTTPS_PROXY: "http://inherited.invalid:1",
						ALL_PROXY: "http://inherited.invalid:1",
					},
					input: `
						const utils = await import(${JSON.stringify(utilsUrl)});
						const github = await import(${JSON.stringify(githubUrl)});
						const result = await utils.runWithProxy(
							${JSON.stringify(scenario.proxy)},
							() => github.extractGitHub(
								${JSON.stringify(`https://github.com/owner/${scenario.name}`)},
								undefined,
								true,
							),
						);
						console.log(JSON.stringify({
							ok: !!result,
							content: result?.content ?? "",
						}));
						github.clearCloneCache();
					`,
				},
			);
			assert.equal(child.status, 0, `${scenario.name}: ${child.stderr}`);
			const output = JSON.parse(child.stdout.trim()) as {
				ok: boolean;
				content: string;
			};
			assert.equal(output.ok, true, scenario.name);
			assert.match(output.content, /Repository cloned to:/);
			assert.match(output.content, /README\.md/);
		}

		const calls = readFileSync(logPath, "utf8")
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line)) as Array<{
			scenario: string;
			command: string;
			args: string[];
			HTTP_PROXY: string | null;
			HTTPS_PROXY: string | null;
			ALL_PROXY: string | null;
			GIT_TERMINAL_PROMPT: string | null;
		}>;
		for (const scenario of ["explicit-gh", "explicit-git"]) {
			const scenarioCalls = calls.filter((call) => call.scenario === scenario);
			assert.ok(scenarioCalls.length >= 2, JSON.stringify(scenarioCalls));
			for (const call of scenarioCalls) {
				assert.equal(call.HTTP_PROXY, "http://explicit.proxy:8123/");
				assert.equal(call.HTTPS_PROXY, "http://explicit.proxy:8123/");
				assert.equal(call.ALL_PROXY, "http://explicit.proxy:8123/");
			}
		}
		for (const scenario of ["bypassed-gh", "forced-direct-gh"]) {
			const scenarioCalls = calls.filter((call) => call.scenario === scenario);
			assert.ok(scenarioCalls.length >= 2, JSON.stringify(scenarioCalls));
			for (const call of scenarioCalls) {
				assert.equal(call.HTTP_PROXY, null);
				assert.equal(call.HTTPS_PROXY, null);
				assert.equal(call.ALL_PROXY, null);
			}
		}
		assert.ok(
			calls.some(
				(call) =>
					call.scenario === "explicit-gh" &&
					call.command === "gh" &&
					call.args[0] === "repo" &&
					call.GIT_TERMINAL_PROMPT === "0",
			),
		);
		assert.ok(
			calls.some(
				(call) =>
					call.scenario === "explicit-git" &&
					call.command === "git" &&
					call.args[0] === "clone" &&
					call.GIT_TERMINAL_PROMPT === "0",
			),
		);
	} finally {
		rmSync(packageRoot, { recursive: true, force: true });
		rmSync(root, { recursive: true, force: true });
	}
});

test("pi-web-access 0.25 recognizes Kimi child-session credentials without a network call", async () => {
	const kimi = await jiti.import(resolve(webRoot, "kimi-search.ts")) as {
		isKimiSearchAvailable(ctx: unknown): Promise<boolean>;
	};
	const model = {
		provider: "kimi-coding",
		id: "kimi-for-coding",
		api: "openai-completions",
	};
	assert.equal(
		await kimi.isKimiSearchAvailable({
			modelRegistry: {
				getAll: () => [model],
				getApiKeyAndHeaders: async () => ({
					ok: true,
					apiKey: "test-kimi-token",
					headers: {},
				}),
			},
		}),
		true,
	);
});

test("pi-web-access 0.25 loads explicit Gemini ADC project and location config", (t) => {
	const root = mkdtempSync(resolve(tmpdir(), "feynman-web-adc-"));
	t.after(() => {
		if (existsSync(root)) rmSync(root, { recursive: true });
	});
	const configPath = resolve(root, "web-search.json");
	writeFileSync(
		configPath,
		JSON.stringify({
			geminiAuth: "adc",
			geminiProject: "research-project",
			geminiLocation: "us-central1",
		}) + "\n",
		"utf8",
	);
	const moduleUrl = pathToFileURL(resolve(webRoot, "gemini-adc.ts")).href;
	const child = spawnSync(
		process.execPath,
		["--import", "tsx", "--input-type=module"],
		{
			encoding: "utf8",
			env: {
				...process.env,
				FEYNMAN_WEB_SEARCH_CONFIG: configPath,
			},
			input: `
				const adc = await import(${JSON.stringify(moduleUrl)});
				console.log(JSON.stringify({
					selected: adc.isAdcAuthSelected(),
					project: adc.getAdcProject(),
					location: adc.getAdcLocation(),
					base: adc.getVertexApiBase(adc.getAdcProject(), adc.getAdcLocation()),
				}));
			`,
		},
	);
	assert.equal(child.status, 0, child.stderr);
	assert.deepEqual(JSON.parse(child.stdout.trim()), {
		selected: true,
		project: "research-project",
		location: "us-central1",
		base:
			"https://aiplatform.googleapis.com/v1/projects/research-project/locations/us-central1/publishers/google",
	});
});

test("patched Gemini ADC resolves the standard Windows APPDATA credential path", () => {
	const packageRoot = createPatchedPackageRoot();
	try {
		const adcUrl = pathToFileURL(resolve(packageRoot, "gemini-adc.ts")).href;
		const child = spawnSync(
			process.execPath,
			["--import", "tsx", "--input-type=module"],
			{
				encoding: "utf8",
				input: `
					const adc = await import(${JSON.stringify(adcUrl)});
					console.log(JSON.stringify({
						windows: adc.getDefaultAdcPath(
							"win32",
							{ APPDATA: "C:\\\\Users\\\\researcher\\\\AppData\\\\Roaming" },
							"/ignored",
						),
						posix: adc.getDefaultAdcPath("darwin", {}, "/Users/researcher"),
					}));
				`,
			},
		);
		assert.equal(child.status, 0, child.stderr);
		assert.deepEqual(JSON.parse(child.stdout.trim()), {
			windows:
				"C:\\Users\\researcher\\AppData\\Roaming\\gcloud\\application_default_credentials.json",
			posix:
				"/Users/researcher/.config/gcloud/application_default_credentials.json",
		});
	} finally {
		rmSync(packageRoot, { recursive: true, force: true });
	}
});
