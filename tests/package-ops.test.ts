import test from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, existsSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { installPackageSources, seedBundledWorkspacePackages, updateConfiguredPackages } from "../src/pi/package-ops.js";

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

test("installPackageSources skips native packages when node:sqlite is unavailable", async () => {
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
	Object.defineProperty(process.versions, "node", { value: "20.20.2", configurable: true });
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

test("updateConfiguredPackages skips native package updates when node:sqlite is unavailable", async () => {
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
	Object.defineProperty(process.versions, "node", { value: "20.20.2", configurable: true });

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
