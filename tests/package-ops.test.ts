import test from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, cpSync, existsSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
	getMissingConfiguredPackages,
	installPackageSources,
	resolveAdjacentNpmCommand,
	seedBundledWorkspacePackages,
	updateConfiguredPackages,
} from "../src/pi/package-ops.js";

function createBundledWorkspace(
	appRoot: string,
	packageNames: string[],
	dependenciesByPackage: Record<string, Record<string, string>> = {},
): void {
	for (const packageName of packageNames) {
		const packageDir = resolve(appRoot, ".feynman", "npm", "node_modules", packageName);
		mkdirSync(packageDir, { recursive: true });
		writeFileSync(
			join(packageDir, "package.json"),
			JSON.stringify({ name: packageName, version: "1.0.0", dependencies: dependenciesByPackage[packageName] }, null, 2) + "\n",
			"utf8",
		);
	}
}

function createInstalledGlobalPackage(homeRoot: string, packageName: string, version = "1.0.0"): void {
	const packageDir = resolve(homeRoot, "npm-global", "lib", "node_modules", packageName);
	mkdirSync(packageDir, { recursive: true });
	writeFileSync(
		join(packageDir, "package.json"),
		JSON.stringify({ name: packageName, version }, null, 2) + "\n",
		"utf8",
	);
}

function writeSettings(agentDir: string, settings: Record<string, unknown>): void {
	mkdirSync(agentDir, { recursive: true });
	writeFileSync(resolve(agentDir, "settings.json"), JSON.stringify(settings, null, 2) + "\n", "utf8");
}

function writeFakeNpmScript(root: string, body: string): string {
	const scriptPath = resolve(root, "fake-npm.mjs");
	writeFileSync(scriptPath, body, "utf8");
	return scriptPath;
}

test("resolveAdjacentNpmCommand uses npm-cli.js on Windows when it is bundled beside Node", () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-windows-npm-"));
	const nodePath = resolve(root, "node.exe");
	const npmCliPath = resolve(root, "node_modules", "npm", "bin", "npm-cli.js");
	mkdirSync(resolve(root, "node_modules", "npm", "bin"), { recursive: true });
	writeFileSync(nodePath, "", "utf8");
	writeFileSync(npmCliPath, "", "utf8");
	writeFileSync(resolve(root, "npm.cmd"), "", "utf8");

	assert.deepEqual(resolveAdjacentNpmCommand(nodePath, "win32"), {
		command: nodePath,
		args: [npmCliPath],
	});
});

test("resolveAdjacentNpmCommand falls back to npm.cmd with a shell on Windows", () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-windows-npm-cmd-"));
	const nodePath = resolve(root, "node.exe");
	const npmCmdPath = resolve(root, "npm.cmd");
	writeFileSync(nodePath, "", "utf8");
	writeFileSync(npmCmdPath, "", "utf8");

	assert.deepEqual(resolveAdjacentNpmCommand(nodePath, "win32"), {
		command: npmCmdPath,
		args: [],
		shell: true,
	});
});

test("seedBundledWorkspacePackages links bundled packages into the Feynman npm prefix", () => {
	const appRoot = mkdtempSync(join(tmpdir(), "feynman-bundle-"));
	const homeRoot = mkdtempSync(join(tmpdir(), "feynman-home-"));
	const agentDir = resolve(homeRoot, "agent");
	mkdirSync(agentDir, { recursive: true });

	createBundledWorkspace(appRoot, ["pi-subagents", "@samfp/pi-memory"]);

	const seeded = seedBundledWorkspacePackages(agentDir, appRoot, [
		"npm:pi-subagents",
		"npm:@samfp/pi-memory",
	]);

	assert.deepEqual(seeded.sort(), ["npm:@samfp/pi-memory", "npm:pi-subagents"]);
	const globalRoot = resolve(homeRoot, "npm-global", "lib", "node_modules");
	assert.equal(existsSync(resolve(globalRoot, "pi-subagents", "package.json")), true);
	assert.equal(existsSync(resolve(globalRoot, "@samfp", "pi-memory", "package.json")), true);
});

test("seedBundledWorkspacePackages preserves existing installed packages", () => {
	const appRoot = mkdtempSync(join(tmpdir(), "feynman-bundle-"));
	const homeRoot = mkdtempSync(join(tmpdir(), "feynman-home-"));
	const agentDir = resolve(homeRoot, "agent");
	const existingPackageDir = resolve(homeRoot, "npm-global", "lib", "node_modules", "pi-subagents");

	mkdirSync(agentDir, { recursive: true });
	createBundledWorkspace(appRoot, ["pi-subagents"]);
	mkdirSync(existingPackageDir, { recursive: true });
	writeFileSync(resolve(existingPackageDir, "package.json"), '{"name":"pi-subagents","version":"user"}\n', "utf8");

	const seeded = seedBundledWorkspacePackages(agentDir, appRoot, ["npm:pi-subagents"]);

	assert.deepEqual(seeded, []);
	assert.equal(readFileSync(resolve(existingPackageDir, "package.json"), "utf8"), '{"name":"pi-subagents","version":"user"}\n');
	assert.equal(lstatSync(existingPackageDir).isSymbolicLink(), false);
});

test("seedBundledWorkspacePackages treats copied bundled packages as satisfied", () => {
	const appRoot = mkdtempSync(join(tmpdir(), "feynman-bundle-"));
	const homeRoot = mkdtempSync(join(tmpdir(), "feynman-home-"));
	const agentDir = resolve(homeRoot, "agent");
	const bundledPackageDir = resolve(appRoot, ".feynman", "npm", "node_modules", "pi-subagents");
	const existingPackageDir = resolve(homeRoot, "npm-global", "lib", "node_modules", "pi-subagents");

	mkdirSync(agentDir, { recursive: true });
	createBundledWorkspace(appRoot, ["pi-subagents"]);
	cpSync(bundledPackageDir, existingPackageDir, { recursive: true });

	const seeded = seedBundledWorkspacePackages(agentDir, appRoot, ["npm:pi-subagents"]);

	assert.deepEqual(seeded, ["npm:pi-subagents"]);
	assert.equal(lstatSync(existingPackageDir).isSymbolicLink(), false);
});

test("getMissingConfiguredPackages seeds bundled packages before reporting missing startup packages", () => {
	const appRoot = mkdtempSync(join(tmpdir(), "feynman-bundle-"));
	const homeRoot = mkdtempSync(join(tmpdir(), "feynman-home-"));
	const workingDir = resolve(homeRoot, "project");
	const agentDir = resolve(homeRoot, "agent");
	mkdirSync(workingDir, { recursive: true });
	createBundledWorkspace(appRoot, ["pi-subagents"]);
	writeSettings(agentDir, {
		packages: ["npm:pi-subagents"],
	});

	const result = getMissingConfiguredPackages(workingDir, agentDir, appRoot);

	assert.deepEqual(result.missing, []);
	assert.equal(existsSync(resolve(homeRoot, "npm-global", "lib", "node_modules", "pi-subagents", "package.json")), true);
});

test("seedBundledWorkspacePackages repairs broken existing bundled packages", () => {
	const appRoot = mkdtempSync(join(tmpdir(), "feynman-bundle-"));
	const homeRoot = mkdtempSync(join(tmpdir(), "feynman-home-"));
	const agentDir = resolve(homeRoot, "agent");
	const existingPackageDir = resolve(homeRoot, "npm-global", "lib", "node_modules", "pi-markdown-preview");

	mkdirSync(agentDir, { recursive: true });
	createBundledWorkspace(appRoot, ["pi-markdown-preview", "puppeteer-core"], {
		"pi-markdown-preview": { "puppeteer-core": "^24.0.0" },
	});
	mkdirSync(existingPackageDir, { recursive: true });
	writeFileSync(
		resolve(existingPackageDir, "package.json"),
		JSON.stringify({ name: "pi-markdown-preview", version: "broken", dependencies: { "puppeteer-core": "^24.0.0" } }) + "\n",
		"utf8",
	);

	const seeded = seedBundledWorkspacePackages(agentDir, appRoot, ["npm:pi-markdown-preview"]);

	assert.deepEqual(seeded, ["npm:pi-markdown-preview"]);
	assert.equal(lstatSync(existingPackageDir).isSymbolicLink(), true);
	assert.equal(lstatSync(resolve(homeRoot, "npm-global", "lib", "node_modules", "puppeteer-core")).isSymbolicLink(), true);
	assert.equal(
		readFileSync(resolve(existingPackageDir, "package.json"), "utf8").includes('"version": "1.0.0"'),
		true,
	);
});

test("seedBundledWorkspacePackages prunes stale links from previous bundled runtimes", () => {
	const appRoot = mkdtempSync(join(tmpdir(), "feynman-bundle-"));
	const homeRoot = mkdtempSync(join(tmpdir(), "feynman-home-"));
	const agentDir = resolve(homeRoot, "agent");
	const globalRoot = resolve(homeRoot, "npm-global", "lib", "node_modules");
	const stalePackagePath = resolve(globalRoot, "@opentelemetry", "api");
	const externalPackagePath = resolve(globalRoot, "@external", "kept");
	const externalTarget = resolve(homeRoot, "external", "kept");

	mkdirSync(agentDir, { recursive: true });
	mkdirSync(resolve(globalRoot, "@opentelemetry"), { recursive: true });
	mkdirSync(resolve(globalRoot, "@external"), { recursive: true });
	mkdirSync(externalTarget, { recursive: true });
	createBundledWorkspace(appRoot, ["pi-subagents"]);
	symlinkSync(resolve(appRoot, ".feynman", "npm", "node_modules", "@opentelemetry", "api"), stalePackagePath, "dir");
	symlinkSync(externalTarget, externalPackagePath, "dir");

	const seeded = seedBundledWorkspacePackages(agentDir, appRoot, ["npm:pi-subagents"]);

	assert.deepEqual(seeded, ["npm:pi-subagents"]);
	assert.equal(existsSync(stalePackagePath), false);
	assert.equal(existsSync(resolve(globalRoot, "@opentelemetry")), false);
	assert.equal(lstatSync(externalPackagePath).isSymbolicLink(), true);
});

test("installPackageSources filters noisy npm chatter but preserves meaningful output", async () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-package-ops-"));
	const workingDir = resolve(root, "project");
	const agentDir = resolve(root, "agent");
	mkdirSync(workingDir, { recursive: true });

	const scriptPath = writeFakeNpmScript(root, [
		`console.log("npm warn deprecated node-domexception@1.0.0: Use your platform's native DOMException instead");`,
		'console.log("changed 343 packages in 9s");',
		'console.log("59 packages are looking for funding");',
		'console.log("run `npm fund` for details");',
		'console.error("visible stderr line");',
		'console.log("visible stdout line");',
		"process.exit(0);",
	].join("\n"));

	writeSettings(agentDir, {
		npmCommand: [process.execPath, scriptPath],
	});

	let stdout = "";
	let stderr = "";
	const originalStdoutWrite = process.stdout.write.bind(process.stdout);
	const originalStderrWrite = process.stderr.write.bind(process.stderr);
	(process.stdout.write as unknown as (chunk: string | Uint8Array) => boolean) = ((chunk: string | Uint8Array) => {
		stdout += chunk.toString();
		return true;
	}) as typeof process.stdout.write;
	(process.stderr.write as unknown as (chunk: string | Uint8Array) => boolean) = ((chunk: string | Uint8Array) => {
		stderr += chunk.toString();
		return true;
	}) as typeof process.stderr.write;

	try {
		const result = await installPackageSources(workingDir, agentDir, ["npm:test-visible-package"]);
		assert.deepEqual(result.installed, ["npm:test-visible-package"]);
		assert.deepEqual(result.skipped, []);
	} finally {
		process.stdout.write = originalStdoutWrite;
		process.stderr.write = originalStderrWrite;
	}

	const combined = `${stdout}\n${stderr}`;
	assert.match(combined, /visible stdout line/);
	assert.match(combined, /visible stderr line/);
	assert.doesNotMatch(combined, /node-domexception/);
	assert.doesNotMatch(combined, /changed 343 packages/);
	assert.doesNotMatch(combined, /packages are looking for funding/);
	assert.doesNotMatch(combined, /npm fund/);
});

test("installPackageSources skips native packages on unsupported Node majors before invoking npm", async () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-package-ops-"));
	const workingDir = resolve(root, "project");
	const agentDir = resolve(root, "agent");
	const markerPath = resolve(root, "npm-invoked.txt");
	mkdirSync(workingDir, { recursive: true });

	const scriptPath = writeFakeNpmScript(root, [
		`import { writeFileSync } from "node:fs";`,
		`writeFileSync(${JSON.stringify(markerPath)}, "invoked\\n", "utf8");`,
		"process.exit(0);",
	].join("\n"));

	writeSettings(agentDir, {
		npmCommand: [process.execPath, scriptPath],
	});

	const originalVersion = process.versions.node;
	Object.defineProperty(process.versions, "node", { value: "24.0.0", configurable: true });
	try {
		const result = await installPackageSources(workingDir, agentDir, ["npm:@kaiserlich-dev/pi-session-search"]);
		assert.deepEqual(result.installed, []);
		assert.deepEqual(result.skipped, ["npm:@kaiserlich-dev/pi-session-search"]);
		assert.equal(existsSync(markerPath), false);
	} finally {
		Object.defineProperty(process.versions, "node", { value: originalVersion, configurable: true });
	}
});

test("installPackageSources disables inherited npm dry-run config for child installs", async () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-package-ops-"));
	const workingDir = resolve(root, "project");
	const agentDir = resolve(root, "agent");
	const markerPath = resolve(root, "install-env-ok.txt");
	mkdirSync(workingDir, { recursive: true });

	const scriptPath = writeFakeNpmScript(root, [
		`import { writeFileSync } from "node:fs";`,
		`if (process.env.npm_config_dry_run !== "false" || process.env.NPM_CONFIG_DRY_RUN !== "false") process.exit(42);`,
		`writeFileSync(${JSON.stringify(markerPath)}, "ok\\n", "utf8");`,
		"process.exit(0);",
	].join("\n"));

	writeSettings(agentDir, {
		npmCommand: [process.execPath, scriptPath],
	});

	const originalLower = process.env.npm_config_dry_run;
	const originalUpper = process.env.NPM_CONFIG_DRY_RUN;
	process.env.npm_config_dry_run = "true";
	process.env.NPM_CONFIG_DRY_RUN = "true";
	try {
		const result = await installPackageSources(workingDir, agentDir, ["npm:test-package"]);
		assert.deepEqual(result.installed, ["npm:test-package"]);
		assert.equal(existsSync(markerPath), true);
	} finally {
		if (originalLower === undefined) {
			delete process.env.npm_config_dry_run;
		} else {
			process.env.npm_config_dry_run = originalLower;
		}
		if (originalUpper === undefined) {
			delete process.env.NPM_CONFIG_DRY_RUN;
		} else {
			process.env.NPM_CONFIG_DRY_RUN = originalUpper;
		}
	}
});

test("installPackageSources installs Pi runtime peers beside Pi packages", async () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-package-ops-"));
	const workingDir = resolve(root, "project");
	const agentDir = resolve(root, "agent");
	const logPath = resolve(root, "npm-invocations.jsonl");
	mkdirSync(workingDir, { recursive: true });

	const scriptPath = writeFakeNpmScript(root, [
		`import { appendFileSync } from "node:fs";`,
		`appendFileSync(${JSON.stringify(logPath)}, JSON.stringify(process.argv.slice(2)) + "\\n", "utf8");`,
		"process.exit(0);",
	].join("\n"));

	writeSettings(agentDir, {
		npmCommand: [process.execPath, scriptPath],
	});

	const result = await installPackageSources(workingDir, agentDir, ["npm:pi-btw"]);

	assert.deepEqual(result.installed, ["npm:pi-btw"]);
	const invocations = readFileSync(logPath, "utf8").trim().split("\n").map((line) => JSON.parse(line) as string[]);
	assert.equal(invocations.length, 1);
	assert.ok(invocations[0]?.includes("pi-btw"));
	assert.ok(invocations[0]?.some((entry) => /^@mariozechner\/pi-agent-core@npm:@earendil-works\/pi-agent-core@/.test(entry)));
	assert.ok(invocations[0]?.some((entry) => /^@mariozechner\/pi-coding-agent@npm:@earendil-works\/pi-coding-agent@/.test(entry)));
	assert.ok(invocations[0]?.some((entry) => /^@mariozechner\/pi-ai@npm:@earendil-works\/pi-ai@/.test(entry)));
	assert.ok(invocations[0]?.some((entry) => /^@mariozechner\/pi-tui@npm:@earendil-works\/pi-tui@/.test(entry)));
	assert.ok(invocations[0]?.some((entry) => /^@earendil-works\/pi-agent-core@/.test(entry)));
	assert.ok(invocations[0]?.some((entry) => /^@earendil-works\/pi-coding-agent@/.test(entry)));
	assert.ok(invocations[0]?.some((entry) => /^@earendil-works\/pi-ai@/.test(entry)));
	assert.ok(invocations[0]?.some((entry) => /^@earendil-works\/pi-tui@/.test(entry)));
	assert.ok(invocations[0]?.some((entry) => /^typebox@/.test(entry)));
});

test("updateConfiguredPackages batches multiple npm updates into a single install per scope", async () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-package-ops-"));
	const workingDir = resolve(root, "project");
	const agentDir = resolve(root, "agent");
	const logPath = resolve(root, "npm-invocations.jsonl");
	mkdirSync(workingDir, { recursive: true });

	const scriptPath = writeFakeNpmScript(root, [
		`import { appendFileSync } from "node:fs";`,
		`import { resolve } from "node:path";`,
		`const args = process.argv.slice(2);`,
		`if (args.length === 2 && args[0] === "root" && args[1] === "-g") {`,
		`  console.log(resolve(${JSON.stringify(root)}, "npm-global", "lib", "node_modules"));`,
		`  process.exit(0);`,
		`}`,
		`if (args.length >= 4 && args[0] === "view" && args[2] === "version" && args[3] === "--json") {`,
		`  console.log(JSON.stringify("2.0.0"));`,
		`  process.exit(0);`,
		`}`,
		`appendFileSync(${JSON.stringify(logPath)}, JSON.stringify(args) + "\\n", "utf8");`,
		"process.exit(0);",
	].join("\n"));

	writeSettings(agentDir, {
		npmCommand: [process.execPath, scriptPath],
		packages: ["npm:test-one", "npm:test-two"],
	});
	createInstalledGlobalPackage(root, "test-one", "1.0.0");
	createInstalledGlobalPackage(root, "test-two", "1.0.0");

	const originalFetch = globalThis.fetch;
	globalThis.fetch = (async () => ({
		ok: true,
		json: async () => ({ version: "2.0.0" }),
	})) as unknown as typeof fetch;

	try {
		const result = await updateConfiguredPackages(workingDir, agentDir);
		assert.deepEqual(result.skipped, []);
		assert.deepEqual(result.updated.sort(), ["npm:test-one", "npm:test-two"]);
	} finally {
		globalThis.fetch = originalFetch;
	}

	const invocations = readFileSync(logPath, "utf8").trim().split("\n").map((line) => JSON.parse(line) as string[]);
	assert.equal(invocations.length, 1);
	assert.ok(invocations[0]?.includes("install"));
	assert.ok(invocations[0]?.includes("test-one@latest"));
	assert.ok(invocations[0]?.includes("test-two@latest"));
});

test("updateConfiguredPackages updates a specific npm package through the npm install path", async () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-package-ops-"));
	const workingDir = resolve(root, "project");
	const agentDir = resolve(root, "agent");
	const logPath = resolve(root, "npm-invocations.jsonl");
	mkdirSync(workingDir, { recursive: true });

	const scriptPath = writeFakeNpmScript(root, [
		`import { appendFileSync } from "node:fs";`,
		`import { resolve } from "node:path";`,
		`const args = process.argv.slice(2);`,
		`if (args.length === 2 && args[0] === "root" && args[1] === "-g") {`,
		`  console.log(resolve(${JSON.stringify(root)}, "npm-global", "lib", "node_modules"));`,
		`  process.exit(0);`,
		`}`,
		`appendFileSync(${JSON.stringify(logPath)}, JSON.stringify(args) + "\\n", "utf8");`,
		"process.exit(0);",
	].join("\n"));

	writeSettings(agentDir, {
		npmCommand: [process.execPath, scriptPath],
		packages: ["npm:@samfp/pi-memory"],
	});
	createInstalledGlobalPackage(root, "@samfp/pi-memory", "1.0.0");

	const result = await updateConfiguredPackages(workingDir, agentDir, "npm:@samfp/pi-memory");

	assert.deepEqual(result.skipped, []);
	assert.deepEqual(result.updated, ["npm:@samfp/pi-memory"]);

	const invocations = readFileSync(logPath, "utf8").trim().split("\n").map((line) => JSON.parse(line) as string[]);
	assert.equal(invocations.length, 1);
	assert.ok(invocations[0]?.includes("install"));
	assert.ok(invocations[0]?.includes("--legacy-peer-deps"));
	assert.ok(invocations[0]?.includes("@samfp/pi-memory@latest"));
});

test("updateConfiguredPackages skips native package updates on unsupported Node majors", async () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-package-ops-"));
	const workingDir = resolve(root, "project");
	const agentDir = resolve(root, "agent");
	const logPath = resolve(root, "npm-invocations.jsonl");
	mkdirSync(workingDir, { recursive: true });

	const scriptPath = writeFakeNpmScript(root, [
		`import { appendFileSync } from "node:fs";`,
		`import { resolve } from "node:path";`,
		`const args = process.argv.slice(2);`,
		`if (args.length === 2 && args[0] === "root" && args[1] === "-g") {`,
		`  console.log(resolve(${JSON.stringify(root)}, "npm-global", "lib", "node_modules"));`,
		`  process.exit(0);`,
		`}`,
		`if (args.length >= 4 && args[0] === "view" && args[2] === "version" && args[3] === "--json") {`,
		`  console.log(JSON.stringify("2.0.0"));`,
		`  process.exit(0);`,
		`}`,
		`appendFileSync(${JSON.stringify(logPath)}, JSON.stringify(args) + "\\n", "utf8");`,
		"process.exit(0);",
	].join("\n"));

	writeSettings(agentDir, {
		npmCommand: [process.execPath, scriptPath],
		packages: ["npm:@kaiserlich-dev/pi-session-search", "npm:test-regular"],
	});
	createInstalledGlobalPackage(root, "@kaiserlich-dev/pi-session-search", "1.0.0");
	createInstalledGlobalPackage(root, "test-regular", "1.0.0");

	const originalFetch = globalThis.fetch;
	const originalVersion = process.versions.node;
	globalThis.fetch = (async () => ({
		ok: true,
		json: async () => ({ version: "2.0.0" }),
	})) as unknown as typeof fetch;
	Object.defineProperty(process.versions, "node", { value: "24.0.0", configurable: true });

	try {
		const result = await updateConfiguredPackages(workingDir, agentDir);
		assert.deepEqual(result.updated, ["npm:test-regular"]);
		assert.deepEqual(result.skipped, ["npm:@kaiserlich-dev/pi-session-search"]);
	} finally {
		globalThis.fetch = originalFetch;
		Object.defineProperty(process.versions, "node", { value: originalVersion, configurable: true });
	}

	const invocations = existsSync(logPath)
		? readFileSync(logPath, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as string[])
		: [];
	assert.equal(invocations.length, 1);
	assert.ok(invocations[0]?.includes("test-regular@latest"));
	assert.ok(!invocations[0]?.some((entry) => entry.includes("pi-session-search")));
});

test("installPackageSources emits npm alias specs for legacy Pi runtime peers found in node_modules", async () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-package-ops-"));
	const workingDir = resolve(root, "project");
	const agentDir = resolve(root, "agent");
	const logPath = resolve(root, "npm-invocations.jsonl");
	mkdirSync(workingDir, { recursive: true });

	const scriptPath = writeFakeNpmScript(root, [
		`import { appendFileSync } from "node:fs";`,
		`appendFileSync(${JSON.stringify(logPath)}, JSON.stringify(process.argv.slice(2)) + "\\n", "utf8");`,
		"process.exit(0);",
	].join("\n"));

	writeSettings(agentDir, {
		npmCommand: [process.execPath, scriptPath],
	});

	// Simulate the standalone bundle layout: legacy-scope directories whose
	// package.json name field points at the current @earendil-works scope.
	const appRoot = resolve(import.meta.dirname ?? __dirname, "..");
	const bundledRoot = resolve(appRoot, ".feynman", "npm", "node_modules");
	const legacyPackages = {
		"@mariozechner/pi-agent-core": "@earendil-works/pi-agent-core",
		"@mariozechner/pi-coding-agent": "@earendil-works/pi-coding-agent",
		"@mariozechner/pi-ai": "@earendil-works/pi-ai",
		"@mariozechner/pi-tui": "@earendil-works/pi-tui",
	};

	const createdPaths: string[] = [];
	try {
		for (const [dirName, realName] of Object.entries(legacyPackages)) {
			const pkgDir = resolve(bundledRoot, dirName);
			mkdirSync(pkgDir, { recursive: true });
			createdPaths.push(pkgDir);
			writeFileSync(
				resolve(pkgDir, "package.json"),
				JSON.stringify({ name: realName, version: "0.79.1" }, null, 2) + "\n",
				"utf8",
			);
		}

		const result = await installPackageSources(workingDir, agentDir, ["npm:pi-btw"]);

		assert.deepEqual(result.installed, ["npm:pi-btw"]);
		const invocations = readFileSync(logPath, "utf8").trim().split("\n").map((line) => JSON.parse(line) as string[]);
		assert.equal(invocations.length, 1);

		// When found in node_modules with a mismatched name, the spec must use
		// the npm: alias form so the registry can resolve it.
		assert.ok(invocations[0]?.some((entry) => /^@mariozechner\/pi-agent-core@npm:@earendil-works\/pi-agent-core@0\.79\.1$/.test(entry)));
		assert.ok(invocations[0]?.some((entry) => /^@mariozechner\/pi-coding-agent@npm:@earendil-works\/pi-coding-agent@0\.79\.1$/.test(entry)));
		assert.ok(invocations[0]?.some((entry) => /^@mariozechner\/pi-ai@npm:@earendil-works\/pi-ai@0\.79\.1$/.test(entry)));
		assert.ok(invocations[0]?.some((entry) => /^@mariozechner\/pi-tui@npm:@earendil-works\/pi-tui@0\.79\.1$/.test(entry)));
	} finally {
		for (const pkgDir of createdPaths) {
			rmSync(pkgDir, { recursive: true, force: true });
		}
		const scopeDir = resolve(bundledRoot, "@mariozechner");
		try { rmSync(scopeDir, { recursive: true, force: true }); } catch {}
	}
});
