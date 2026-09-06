import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
	installPackageSources,
	reconcileManagedCorePackageInstalls,
	updateConfiguredPackages,
} from "../src/pi/package-ops.js";
import { CORE_PACKAGE_SOURCES, shouldPruneLegacyDefaultPackages } from "../src/pi/package-presets.js";

function createInstalledPackage(packageDir: string, packageName: string, version = "1.0.0"): void {
	mkdirSync(packageDir, { recursive: true });
	writeFileSync(
		join(packageDir, "package.json"),
		JSON.stringify({ name: packageName, version }, null, 2) + "\n",
		"utf8",
	);
}

function createInstalledGlobalPackage(homeRoot: string, packageName: string, version = "1.0.0"): void {
	createInstalledPackage(resolve(homeRoot, "npm-global", "lib", "node_modules", packageName), packageName, version);
}

function createInstalledManagedPackage(agentDir: string, packageName: string, version = "1.0.0"): void {
	createInstalledPackage(resolve(agentDir, "npm", "node_modules", packageName), packageName, version);
}

function createInstalledProjectPackage(workingDir: string, packageName: string, version = "1.0.0"): void {
	createInstalledPackage(resolve(workingDir, ".feynman", "npm", "node_modules", packageName), packageName, version);
}

function readInstalledPackageVersion(packageRoot: string): string {
	return JSON.parse(readFileSync(resolve(packageRoot, "package.json"), "utf8")).version as string;
}

function writeSettings(agentDir: string, settings: Record<string, unknown>): void {
	mkdirSync(agentDir, { recursive: true });
	writeFileSync(resolve(agentDir, "settings.json"), JSON.stringify(settings, null, 2) + "\n", "utf8");
}

function getRootPiRuntimeVersion(): string {
	const manifest = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8")) as {
		dependencies?: Record<string, string>;
	};
	const version = manifest.dependencies?.["@earendil-works/pi-coding-agent"];
	assert.ok(version);
	return version;
}

function writeFakeNpmScript(root: string, body: string): string {
	const scriptPath = resolve(root, "fake-npm.mjs");
	writeFileSync(scriptPath, body, "utf8");
	return scriptPath;
}

function writeFakeUpdatingNpmScript(
	root: string,
	logPath: string,
	versions: Record<string, string>,
	options?: { leaveStale?: string[] },
): string {
	return writeFakeNpmScript(root, [
		`import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";`,
		`import { resolve } from "node:path";`,
		`const args = process.argv.slice(2);`,
		`const versions = ${JSON.stringify(versions)};`,
		`const leaveStale = new Set(${JSON.stringify(options?.leaveStale ?? [])});`,
		`if (args.length === 2 && args[0] === "root" && args[1] === "-g") {`,
		`  console.log(resolve(${JSON.stringify(root)}, "npm-global", "lib", "node_modules"));`,
		`  process.exit(0);`,
		`}`,
		`if (args.length >= 4 && args[0] === "view" && args[2] === "version" && args[3] === "--json") {`,
		`  console.log(JSON.stringify(versions[args[1]] ?? "1.0.0"));`,
		`  process.exit(0);`,
		`}`,
		`appendFileSync(${JSON.stringify(logPath)}, JSON.stringify(args) + "\\n", "utf8");`,
		`const prefixIndex = args.indexOf("--prefix");`,
		`const prefix = prefixIndex >= 0 ? args[prefixIndex + 1] : undefined;`,
		`if (args.includes("install") && prefix) {`,
		`  const nodeModulesRoot = args.includes("-g")`,
		`    ? resolve(prefix, "lib", "node_modules")`,
		`    : resolve(prefix, "node_modules");`,
		`  for (const [name, version] of Object.entries(versions)) {`,
		`    if (leaveStale.has(name) || !args.some((arg) => arg === name || arg.startsWith(name + "@"))) continue;`,
		`    const packageRoot = resolve(nodeModulesRoot, name);`,
		`    mkdirSync(packageRoot, { recursive: true });`,
		`    writeFileSync(resolve(packageRoot, "package.json"), JSON.stringify({ name, version }, null, 2) + "\\n", "utf8");`,
		`  }`,
		`}`,
		"process.exit(0);",
	].join("\n"));
}

const SESSION_SEARCH_UPSTREAM_INDEXER = `
export async function indexAllSessions() {
    const sessionsDir = path.join(os.homedir(), ".pi", "agent", "sessions");
    const files = findSessionFiles(sessionsDir);
    return files.length;
}
`;

function getSessionSearchIndexerPath(homeRoot: string): string {
	return resolve(homeRoot, "npm-global", "lib", "node_modules", "@kaiserlich-dev", "pi-session-search", "extensions", "indexer.ts");
}

function writeFakeSessionSearchNpmScript(root: string, logPath?: string): string {
	return writeFakeNpmScript(root, [
		`import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";`,
		`import { resolve } from "node:path";`,
		`const args = process.argv.slice(2);`,
		`if (args.length === 2 && args[0] === "root" && args[1] === "-g") {`,
		`  console.log(resolve(${JSON.stringify(root)}, "npm-global", "lib", "node_modules"));`,
		`  process.exit(0);`,
		`}`,
		`if (args.length >= 4 && args[0] === "view" && args[2] === "version" && args[3] === "--json") {`,
		`  console.log(JSON.stringify("1.1.3"));`,
		`  process.exit(0);`,
		`}`,
		logPath ? `appendFileSync(${JSON.stringify(logPath)}, JSON.stringify(args) + "\\n", "utf8");` : "",
		`const prefixIndex = args.indexOf("--prefix");`,
		`const prefix = prefixIndex >= 0 ? args[prefixIndex + 1] : resolve(${JSON.stringify(root)}, "npm-global");`,
		`const packageRoot = resolve(prefix, "lib", "node_modules", "@kaiserlich-dev", "pi-session-search");`,
		`mkdirSync(resolve(packageRoot, "extensions"), { recursive: true });`,
		`writeFileSync(resolve(packageRoot, "package.json"), JSON.stringify({ name: "@kaiserlich-dev/pi-session-search", version: "1.1.3" }, null, 2) + "\\n", "utf8");`,
		`writeFileSync(resolve(packageRoot, "extensions", "indexer.ts"), ${JSON.stringify(SESSION_SEARCH_UPSTREAM_INDEXER)}, "utf8");`,
		"process.exit(0);",
	].filter(Boolean).join("\n"));
}

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

	const result = await installPackageSources(workingDir, agentDir, ["npm:@luxusai/pi-hindsight"]);

	assert.deepEqual(result.installed, ["npm:@luxusai/pi-hindsight"]);
	const invocations = readFileSync(logPath, "utf8").trim().split("\n").map((line) => JSON.parse(line) as string[]);
	assert.equal(invocations.length, 1);
	const invocation = invocations[0] ?? [];
	assert.ok(invocation.includes("@luxusai/pi-hindsight"));
	assert.ok(invocation.some((entry) => /^@mariozechner\/pi-coding-agent@/.test(entry)));
	assert.ok(invocation.some((entry) => /^@mariozechner\/pi-ai@/.test(entry)));
	assert.ok(invocation.some((entry) => /^@mariozechner\/pi-tui@/.test(entry)));
	assert.ok(invocation.some((entry) => /^@earendil-works\/pi-coding-agent@/.test(entry)));
	assert.ok(invocation.some((entry) => /^@earendil-works\/pi-ai@/.test(entry)));
	assert.ok(invocation.some((entry) => /^@earendil-works\/pi-tui@/.test(entry)));
	assert.ok(invocation.some((entry) => /^typebox@/.test(entry)));
	const piRuntimeVersion = getRootPiRuntimeVersion();
	assert.ok(invocation.includes(`@earendil-works/pi-agent-core@${piRuntimeVersion}`));
	assert.ok(invocation.includes(`@earendil-works/pi-ai@${piRuntimeVersion}`));
	assert.ok(invocation.includes(`@earendil-works/pi-coding-agent@${piRuntimeVersion}`));
	assert.ok(invocation.includes(`@earendil-works/pi-tui@${piRuntimeVersion}`));
	assert.ok(invocation.includes(`@mariozechner/pi-agent-core@npm:@earendil-works/pi-agent-core@${piRuntimeVersion}`));
	assert.ok(invocation.includes(`@mariozechner/pi-ai@npm:@earendil-works/pi-ai@${piRuntimeVersion}`));
	assert.ok(invocation.includes(`@mariozechner/pi-coding-agent@npm:@earendil-works/pi-coding-agent@${piRuntimeVersion}`));
	assert.ok(invocation.includes(`@mariozechner/pi-tui@npm:@earendil-works/pi-tui@${piRuntimeVersion}`));
});

test("installPackageSources patches installed Pi packages before returning", async () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-package-ops-"));
	const workingDir = resolve(root, "project");
	const agentDir = resolve(root, "agent");
	mkdirSync(workingDir, { recursive: true });

	const scriptPath = writeFakeSessionSearchNpmScript(root);
	writeSettings(agentDir, {
		npmCommand: [process.execPath, scriptPath],
	});

	const originalVersion = process.versions.node;
	Object.defineProperty(process.versions, "node", { value: "22.17.0", configurable: true });
	try {
		const result = await installPackageSources(workingDir, agentDir, ["npm:@kaiserlich-dev/pi-session-search"]);
		assert.deepEqual(result.installed, ["npm:@kaiserlich-dev/pi-session-search"]);
		assert.deepEqual(result.skipped, []);
	} finally {
		Object.defineProperty(process.versions, "node", { value: originalVersion, configurable: true });
	}

	const patched = readFileSync(getSessionSearchIndexerPath(root), "utf8");
	assert.match(patched, /FEYNMAN_SESSION_DIR/);
	assert.doesNotMatch(patched, /const sessionsDir = path\.join\(os\.homedir\(\), "\.pi", "agent", "sessions"\)/);
});

test("reconcileManagedCorePackageInstalls repairs stale user installs from the bundled exact presets", () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-package-ops-"));
	const agentDir = resolve(root, "agent");
	const appRoot = resolve(root, "app");
	const managedRoot = resolve(agentDir, "npm");
	const bundledRoot = resolve(appRoot, ".feynman", "npm");
	const packageSource = "npm:pi-web-access@0.28.0";
	const customSource = "npm:@samfp/pi-memory@^1.0.0";

	writeSettings(agentDir, { packages: [packageSource, customSource] });
	createInstalledManagedPackage(agentDir, "pi-web-access", "0.21.0");
	createInstalledManagedPackage(agentDir, "@samfp/pi-memory", "1.4.0");
	createInstalledPackage(resolve(bundledRoot, "node_modules", "pi-web-access"), "pi-web-access", "0.28.0");
	mkdirSync(resolve(appRoot, ".feynman"), { recursive: true });
	writeFileSync(
		resolve(appRoot, ".feynman", "runtime-package-lock.json"),
		JSON.stringify({
			name: "feynman-pi-runtime",
			lockfileVersion: 3,
			packages: {
				"": { dependencies: { "pi-web-access": "0.28.0" } },
				"node_modules/pi-web-access": { version: "0.28.0" },
			},
		}, null, 2) + "\n",
	);
	writeFileSync(
		resolve(managedRoot, "package.json"),
		JSON.stringify({
			name: "pi-extensions",
			dependencies: {
				"pi-web-access": "^0.21.0",
				"@samfp/pi-memory": "^1.0.0",
			},
		}, null, 2) + "\n",
	);
	writeFileSync(
		resolve(managedRoot, "package-lock.json"),
		JSON.stringify({
			name: "pi-extensions",
			lockfileVersion: 3,
			packages: {
				"": {
					dependencies: {
						"pi-web-access": "^0.21.0",
						"@samfp/pi-memory": "^1.0.0",
					},
				},
				"node_modules/pi-web-access": { name: "pi-web-access", version: "0.21.0" },
				"node_modules/@samfp/pi-memory": { name: "@samfp/pi-memory", version: "1.4.0" },
			},
		}, null, 2) + "\n",
	);

	assert.deepEqual(reconcileManagedCorePackageInstalls(agentDir, appRoot), [packageSource]);
	assert.equal(existsSync(resolve(managedRoot, "node_modules", "pi-web-access")), false);
	assert.equal(
		readInstalledPackageVersion(resolve(root, "npm-global", "lib", "node_modules", "pi-web-access")),
		"0.28.0",
	);
	assert.equal(
		readInstalledPackageVersion(resolve(managedRoot, "node_modules", "@samfp", "pi-memory")),
		"1.4.0",
	);
	const manifest = JSON.parse(readFileSync(resolve(managedRoot, "package.json"), "utf8"));
	assert.equal(manifest.dependencies["pi-web-access"], undefined);
	assert.equal(manifest.dependencies["@samfp/pi-memory"], "^1.0.0");
	const lock = JSON.parse(readFileSync(resolve(managedRoot, "package-lock.json"), "utf8"));
	assert.equal(lock.packages[""].dependencies["pi-web-access"], undefined);
	assert.equal(lock.packages["node_modules/pi-web-access"], undefined);
	assert.equal(lock.packages[""].dependencies["@samfp/pi-memory"], "^1.0.0");
});

test("reconcileManagedCorePackageInstalls removes a broken stale managed symlink", () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-package-ops-"));
	const agentDir = resolve(root, "agent");
	const appRoot = resolve(root, "app");
	const managedPackagePath = resolve(agentDir, "npm", "node_modules", "pi-web-access");
	const bundledPackagePath = resolve(appRoot, ".feynman", "npm", "node_modules", "pi-web-access");
	const packageSource = "npm:pi-web-access@0.28.0";

	writeSettings(agentDir, { packages: [packageSource] });
	mkdirSync(resolve(managedPackagePath, ".."), { recursive: true });
	symlinkSync(resolve(root, "missing-pi-web-access"), managedPackagePath, "dir");
	createInstalledPackage(bundledPackagePath, "pi-web-access", "0.28.0");
	mkdirSync(resolve(appRoot, ".feynman"), { recursive: true });
	writeFileSync(
		resolve(appRoot, ".feynman", "runtime-package-lock.json"),
		JSON.stringify({
			name: "feynman-pi-runtime",
			lockfileVersion: 3,
			packages: {
				"": { dependencies: { "pi-web-access": "0.28.0" } },
				"node_modules/pi-web-access": { version: "0.28.0" },
			},
		}, null, 2) + "\n",
	);

	assert.deepEqual(reconcileManagedCorePackageInstalls(agentDir, appRoot), [packageSource]);
	assert.equal(existsSync(managedPackagePath), false);
	assert.equal(
		readInstalledPackageVersion(resolve(root, "npm-global", "lib", "node_modules", "pi-web-access")),
		"0.28.0",
	);
});

test("reconcileManagedCorePackageInstalls leaves stale state intact when the bundled workspace is unavailable", () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-package-ops-"));
	const agentDir = resolve(root, "agent");
	const appRoot = resolve(root, "app");
	const managedPackagePath = resolve(agentDir, "npm", "node_modules", "pi-web-access");
	const packageSource = "npm:pi-web-access@0.28.0";

	writeSettings(agentDir, { packages: [packageSource] });
	createInstalledManagedPackage(agentDir, "pi-web-access", "0.21.0");

	assert.deepEqual(reconcileManagedCorePackageInstalls(agentDir, appRoot), []);
	assert.equal(readInstalledPackageVersion(managedPackagePath), "0.21.0");
});

test("reconcileManagedCorePackageInstalls replaces a stale usable prefix copy", () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-package-ops-"));
	const agentDir = resolve(root, "agent");
	const appRoot = resolve(root, "app");
	const packageSource = "npm:pi-web-access@0.28.0";
	const bundledPackagePath = resolve(appRoot, ".feynman", "npm", "node_modules", "pi-web-access");
	const globalPackagePath = resolve(root, "npm-global", "lib", "node_modules", "pi-web-access");
	const managedPackagePath = resolve(agentDir, "npm", "node_modules", "pi-web-access");

	writeSettings(agentDir, { packages: [packageSource] });
	createInstalledManagedPackage(agentDir, "pi-web-access", "0.21.0");
	createInstalledPackage(bundledPackagePath, "pi-web-access", "0.28.0");
	createInstalledPackage(globalPackagePath, "pi-web-access", "0.21.0");

	assert.deepEqual(reconcileManagedCorePackageInstalls(agentDir, appRoot), [packageSource]);
	assert.equal(readInstalledPackageVersion(globalPackagePath), "0.28.0");
	assert.equal(existsSync(managedPackagePath), false);
});

test("reconcileManagedCorePackageInstalls preserves a usable current prefix copy", () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-package-ops-"));
	const agentDir = resolve(root, "agent");
	const appRoot = resolve(root, "app");
	const packageSource = "npm:pi-web-access@0.28.0";
	const bundledPackagePath = resolve(appRoot, ".feynman", "npm", "node_modules", "pi-web-access");
	const globalPackagePath = resolve(root, "npm-global", "lib", "node_modules", "pi-web-access");
	const managedPackagePath = resolve(agentDir, "npm", "node_modules", "pi-web-access");

	writeSettings(agentDir, { packages: [packageSource] });
	createInstalledManagedPackage(agentDir, "pi-web-access", "0.21.0");
	createInstalledPackage(bundledPackagePath, "pi-web-access", "0.28.0");
	createInstalledPackage(globalPackagePath, "pi-web-access", "0.28.0");
	writeFileSync(resolve(globalPackagePath, "custom-marker"), "preserve\n", "utf8");

	assert.deepEqual(reconcileManagedCorePackageInstalls(agentDir, appRoot), [packageSource]);
	assert.equal(readInstalledPackageVersion(globalPackagePath), "0.28.0");
	assert.equal(readFileSync(resolve(globalPackagePath, "custom-marker"), "utf8"), "preserve\n");
	assert.equal(existsSync(managedPackagePath), false);
});

test("reconcileManagedCorePackageInstalls uses normalized personal Alpha and latest agent presets", (t) => {
	const root = mkdtempSync(join(tmpdir(), "feynman-preset-migration-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const agentDir = resolve(root, "agent");
	const appRoot = resolve(root, "app");
	const historic = [
		"npm:@companion-ai/alpha-hub@0.1.3",
		"npm:pi-subagents@0.40.0",
		"npm:pi-btw@0.4.1",
		"npm:pi-docparser@4.0.0",
		"npm:pi-web-access@0.25.0",
		"npm:pi-otel@0.1.0",
	];
	// normalizeFeynmanSettings recognizes whole historical default sets before
	// per-source reconciliation; the latter deliberately retains custom scopes.
	assert.equal(shouldPruneLegacyDefaultPackages(historic), true);
	const normalized = [...CORE_PACKAGE_SOURCES];
	writeSettings(agentDir, { packages: normalized });
	for (const source of CORE_PACKAGE_SOURCES) {
		const spec = source.slice("npm:".length);
		const separator = spec.lastIndexOf("@");
		const name = spec.slice(0, separator);
		const version = spec.slice(separator + 1);
		createInstalledPackage(resolve(appRoot, ".feynman", "npm", "node_modules", name), name, version);
		createInstalledManagedPackage(agentDir, name, "0.0.1");
	}
	const repaired = reconcileManagedCorePackageInstalls(agentDir, appRoot);
	assert.deepEqual(repaired, [...CORE_PACKAGE_SOURCES]);
	assert.equal(readInstalledPackageVersion(resolve(root, "npm-global/lib/node_modules/@advaitpaliwal/alpha-hub")), "0.1.4");
	assert.equal(readInstalledPackageVersion(resolve(root, "npm-global/lib/node_modules/pi-subagents")), "0.65.1");
	assert.equal(readInstalledPackageVersion(resolve(root, "npm-global/lib/node_modules/pi-web-access")), "0.28.0");
	assert.equal(existsSync(resolve(root, "npm-global/lib/node_modules/@companion-ai/alpha-hub")), false);
});

test("reconcileManagedCorePackageInstalls rejects a stale bundle before changing installed state", (t) => {
	const root = mkdtempSync(join(tmpdir(), "feynman-stale-preset-bundle-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const agentDir = resolve(root, "agent");
	const appRoot = resolve(root, "app");
	writeSettings(agentDir, { packages: ["npm:pi-web-access@0.28.0"] });
	createInstalledManagedPackage(agentDir, "pi-web-access", "0.25.0");
	createInstalledGlobalPackage(root, "pi-web-access", "0.25.0");
	createInstalledPackage(resolve(appRoot, ".feynman/npm/node_modules/pi-web-access"), "pi-web-access", "0.25.0");
	assert.throws(() => reconcileManagedCorePackageInstalls(agentDir, appRoot), /must match npm:pi-web-access@0\.28\.0; found 0\.25\.0/);
	assert.equal(readInstalledPackageVersion(resolve(agentDir, "npm/node_modules/pi-web-access")), "0.25.0");
	assert.equal(readInstalledPackageVersion(resolve(root, "npm-global/lib/node_modules/pi-web-access")), "0.25.0");
});

test("reconcileManagedCorePackageInstalls leaves explicit non-managed selectors alone", (t) => {
	const root = mkdtempSync(join(tmpdir(), "feynman-custom-preset-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const agentDir = resolve(root, "agent");
	const appRoot = resolve(root, "app");
	writeSettings(agentDir, { packages: [
		{ source: "npm:pi-subagents@next", extensions: ["custom.ts"] },
		"npm:@companion-ai/alpha-hub@custom",
	] });
	createInstalledManagedPackage(agentDir, "pi-subagents", "0.99.0");
	createInstalledManagedPackage(agentDir, "@companion-ai/alpha-hub", "9.0.0");
	createInstalledPackage(resolve(appRoot, ".feynman/npm/node_modules/pi-subagents"), "pi-subagents", "0.65.1");
	assert.deepEqual(reconcileManagedCorePackageInstalls(agentDir, appRoot), []);
	assert.equal(readInstalledPackageVersion(resolve(agentDir, "npm/node_modules/pi-subagents")), "0.99.0");
	assert.equal(readInstalledPackageVersion(resolve(agentDir, "npm/node_modules/@companion-ai/alpha-hub")), "9.0.0");
});

test("updateConfiguredPackages updates the managed package root Pi actually resolves", async () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-package-ops-"));
	const workingDir = resolve(root, "project");
	const agentDir = resolve(root, "agent");
	const logPath = resolve(root, "npm-invocations.jsonl");
	mkdirSync(workingDir, { recursive: true });

	const scriptPath = writeFakeUpdatingNpmScript(root, logPath, {
		"test-one": "2.0.0",
		"test-two": "2.0.0",
	});

	writeSettings(agentDir, {
		npmCommand: [process.execPath, scriptPath],
		packages: ["npm:test-one", "npm:test-two"],
	});
	createInstalledManagedPackage(agentDir, "test-one", "1.0.0");
	createInstalledManagedPackage(agentDir, "test-two", "1.0.0");
	createInstalledGlobalPackage(root, "test-one", "2.0.0");
	createInstalledGlobalPackage(root, "test-two", "2.0.0");

	const result = await updateConfiguredPackages(workingDir, agentDir);
	assert.deepEqual(result.skipped, []);
	assert.deepEqual(result.updated.sort(), ["npm:test-one", "npm:test-two"]);

	const invocations = readFileSync(logPath, "utf8").trim().split("\n").map((line) => JSON.parse(line) as string[]);
	assert.equal(invocations.length, 1);
	const invocation = invocations[0] ?? [];
	assert.ok(invocation.includes("install"));
	assert.ok(invocation.includes("test-one@latest"));
	assert.ok(invocation.includes("test-two@latest"));
	assert.ok(!invocation.includes("-g"));
	assert.equal(invocation[invocation.indexOf("--prefix") + 1], resolve(agentDir, "npm"));
	assert.equal(
		readInstalledPackageVersion(resolve(agentDir, "npm", "node_modules", "test-one")),
		"2.0.0",
	);
	assert.equal(
		readInstalledPackageVersion(resolve(agentDir, "npm", "node_modules", "test-two")),
		"2.0.0",
	);
	assert.equal(
		readInstalledPackageVersion(resolve(root, "npm-global", "lib", "node_modules", "test-one")),
		"2.0.0",
	);
});

test("updateConfiguredPackages reconciles stale exact-pinned packages omitted by Pi update discovery", async () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-package-ops-"));
	const workingDir = resolve(root, "project");
	const agentDir = resolve(root, "agent");
	const logPath = resolve(root, "npm-invocations.jsonl");
	mkdirSync(workingDir, { recursive: true });

	const scriptPath = writeFakeUpdatingNpmScript(root, logPath, { "test-pinned": "2.0.0" });
	writeSettings(agentDir, {
		npmCommand: [process.execPath, scriptPath],
		packages: ["npm:test-pinned@2.0.0"],
	});
	createInstalledManagedPackage(agentDir, "test-pinned", "1.0.0");

	const result = await updateConfiguredPackages(workingDir, agentDir);

	assert.deepEqual(result, { updated: ["npm:test-pinned@2.0.0"], skipped: [] });
	const invocations = readFileSync(logPath, "utf8").trim().split("\n").map((line) => JSON.parse(line) as string[]);
	assert.equal(invocations.length, 1);
	const invocation = invocations[0] ?? [];
	assert.ok(invocation.includes("test-pinned@2.0.0"));
	assert.ok(!invocation.includes("test-pinned@latest"));
	assert.equal(invocation[invocation.indexOf("--prefix") + 1], resolve(agentDir, "npm"));
	assert.equal(
		readInstalledPackageVersion(resolve(agentDir, "npm", "node_modules", "test-pinned")),
		"2.0.0",
	);
});

test("updateConfiguredPackages leaves current exact-pinned packages untouched", async () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-package-ops-"));
	const workingDir = resolve(root, "project");
	const agentDir = resolve(root, "agent");
	const logPath = resolve(root, "npm-invocations.jsonl");
	mkdirSync(workingDir, { recursive: true });

	const scriptPath = writeFakeUpdatingNpmScript(root, logPath, { "test-pinned": "2.0.0" });
	writeSettings(agentDir, {
		npmCommand: [process.execPath, scriptPath],
		packages: ["npm:test-pinned@2.0.0"],
	});
	createInstalledManagedPackage(agentDir, "test-pinned", "2.0.0");

	const result = await updateConfiguredPackages(workingDir, agentDir);

	assert.deepEqual(result, { updated: [], skipped: [] });
	assert.equal(existsSync(logPath), false);
});

test("updateConfiguredPackages preserves npm range and tag selectors as unpinned sources", async () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-package-ops-"));
	const workingDir = resolve(root, "project");
	const agentDir = resolve(root, "agent");
	const logPath = resolve(root, "npm-invocations.jsonl");
	mkdirSync(workingDir, { recursive: true });

	const scriptPath = writeFakeUpdatingNpmScript(root, logPath, {
		"test-range": "1.0.0",
		"test-tag": "1.0.0",
	});
	const rangeSource = "npm:test-range@^1.0.0";
	const tagSource = "npm:test-tag@next";
	writeSettings(agentDir, {
		npmCommand: [process.execPath, scriptPath],
		packages: [rangeSource, tagSource],
	});
	createInstalledManagedPackage(agentDir, "test-range", "0.9.0");
	createInstalledManagedPackage(agentDir, "test-tag", "0.9.0");

	assert.deepEqual(
		await updateConfiguredPackages(workingDir, agentDir, rangeSource),
		{ updated: [rangeSource], skipped: [] },
	);
	assert.deepEqual(
		await updateConfiguredPackages(workingDir, agentDir, tagSource),
		{ updated: [tagSource], skipped: [] },
	);

	const invocations = readFileSync(logPath, "utf8").trim().split("\n").map((line) => JSON.parse(line) as string[]);
	assert.equal(invocations.length, 2);
	assert.ok(invocations[0]?.includes("test-range@^1.0.0"));
	assert.ok(!invocations[0]?.includes("test-range@latest"));
	assert.ok(invocations[1]?.includes("test-tag@next"));
	assert.ok(!invocations[1]?.includes("test-tag@latest"));
});

test("updateConfiguredPackages rejects a pinned update that did not reach the configured version", async () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-package-ops-"));
	const workingDir = resolve(root, "project");
	const agentDir = resolve(root, "agent");
	const logPath = resolve(root, "npm-invocations.jsonl");
	mkdirSync(workingDir, { recursive: true });

	const scriptPath = writeFakeUpdatingNpmScript(
		root,
		logPath,
		{ "test-pinned": "2.0.0" },
		{ leaveStale: ["test-pinned"] },
	);
	writeSettings(agentDir, {
		npmCommand: [process.execPath, scriptPath],
		packages: ["npm:test-pinned@2.0.0"],
	});
	createInstalledManagedPackage(agentDir, "test-pinned", "1.0.0");

	await assert.rejects(
		updateConfiguredPackages(workingDir, agentDir),
		/Package updates remain available after install: npm:test-pinned@2\.0\.0/,
	);
	assert.equal(
		readInstalledPackageVersion(resolve(agentDir, "npm", "node_modules", "test-pinned")),
		"1.0.0",
	);
});

test("updateConfiguredPackages preserves global install semantics for fallback packages", async () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-package-ops-"));
	const workingDir = resolve(root, "project");
	const agentDir = resolve(root, "agent");
	const logPath = resolve(root, "npm-invocations.jsonl");
	mkdirSync(workingDir, { recursive: true });

	const scriptPath = writeFakeUpdatingNpmScript(root, logPath, { "test-global": "2.0.0" });

	writeSettings(agentDir, {
		npmCommand: [process.execPath, scriptPath],
		packages: ["npm:test-global"],
	});
	createInstalledGlobalPackage(root, "test-global", "1.0.0");

	const result = await updateConfiguredPackages(workingDir, agentDir);

	assert.deepEqual(result.skipped, []);
	assert.deepEqual(result.updated, ["npm:test-global"]);

	const invocations = readFileSync(logPath, "utf8").trim().split("\n").map((line) => JSON.parse(line) as string[]);
	assert.equal(invocations.length, 1);
	const invocation = invocations[0] ?? [];
	assert.ok(invocation.includes("install"));
	assert.ok(invocation.includes("-g"));
	assert.equal(invocation[invocation.indexOf("--prefix") + 1], resolve(root, "npm-global"));
	assert.equal(
		readInstalledPackageVersion(resolve(root, "npm-global", "lib", "node_modules", "test-global")),
		"2.0.0",
	);
	assert.equal(existsSync(resolve(agentDir, "npm", "node_modules", "test-global")), false);
});

test("updateConfiguredPackages updates project packages in the project install root", async () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-package-ops-"));
	const workingDir = resolve(root, "project");
	const agentDir = resolve(root, "agent");
	const logPath = resolve(root, "npm-invocations.jsonl");
	mkdirSync(resolve(workingDir, ".feynman"), { recursive: true });

	const scriptPath = writeFakeUpdatingNpmScript(root, logPath, { "test-project": "2.0.0" });
	writeSettings(agentDir, {
		npmCommand: [process.execPath, scriptPath],
	});
	writeFileSync(
		resolve(workingDir, ".feynman", "settings.json"),
		JSON.stringify({ packages: ["npm:test-project"] }, null, 2) + "\n",
		"utf8",
	);
	createInstalledProjectPackage(workingDir, "test-project", "1.0.0");

	const result = await updateConfiguredPackages(workingDir, agentDir);

	assert.deepEqual(result, { updated: ["npm:test-project"], skipped: [] });
	const invocations = readFileSync(logPath, "utf8").trim().split("\n").map((line) => JSON.parse(line) as string[]);
	assert.equal(invocations.length, 1);
	const invocation = invocations[0] ?? [];
	assert.ok(!invocation.includes("-g"));
	assert.equal(invocation[invocation.indexOf("--prefix") + 1], resolve(workingDir, ".feynman", "npm"));
	assert.equal(
		readInstalledPackageVersion(resolve(workingDir, ".feynman", "npm", "node_modules", "test-project")),
		"2.0.0",
	);
});

test("updateConfiguredPackages targets a specific package's resolved managed root", async () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-package-ops-"));
	const workingDir = resolve(root, "project");
	const agentDir = resolve(root, "agent");
	const logPath = resolve(root, "npm-invocations.jsonl");
	mkdirSync(workingDir, { recursive: true });

	const scriptPath = writeFakeUpdatingNpmScript(root, logPath, { "@samfp/pi-memory": "2.0.0" });
	writeSettings(agentDir, {
		npmCommand: [process.execPath, scriptPath],
		packages: ["npm:@samfp/pi-memory"],
	});
	createInstalledManagedPackage(agentDir, "@samfp/pi-memory", "1.0.0");
	createInstalledGlobalPackage(root, "@samfp/pi-memory", "2.0.0");

	const result = await updateConfiguredPackages(workingDir, agentDir, "npm:@samfp/pi-memory");

	assert.deepEqual(result, { updated: ["npm:@samfp/pi-memory"], skipped: [] });
	const invocations = readFileSync(logPath, "utf8").trim().split("\n").map((line) => JSON.parse(line) as string[]);
	assert.equal(invocations.length, 1);
	const invocation = invocations[0] ?? [];
	assert.ok(invocation.includes("install"));
	assert.ok(invocation.includes("--legacy-peer-deps"));
	assert.ok(invocation.includes("@samfp/pi-memory@latest"));
	assert.ok(!invocation.includes("-g"));
	assert.equal(invocation[invocation.indexOf("--prefix") + 1], resolve(agentDir, "npm"));
	assert.equal(
		readInstalledPackageVersion(resolve(agentDir, "npm", "node_modules", "@samfp", "pi-memory")),
		"2.0.0",
	);
});

test("updateConfiguredPackages targets the effective project package when a source exists in both scopes", async () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-package-ops-"));
	const workingDir = resolve(root, "project");
	const agentDir = resolve(root, "agent");
	const logPath = resolve(root, "npm-invocations.jsonl");
	mkdirSync(resolve(workingDir, ".feynman"), { recursive: true });

	const scriptPath = writeFakeUpdatingNpmScript(root, logPath, { "test-duplicate": "2.0.0" });
	writeSettings(agentDir, {
		npmCommand: [process.execPath, scriptPath],
		packages: ["npm:test-duplicate"],
	});
	writeFileSync(
		resolve(workingDir, ".feynman", "settings.json"),
		JSON.stringify({ packages: ["npm:test-duplicate"] }, null, 2) + "\n",
		"utf8",
	);
	createInstalledManagedPackage(agentDir, "test-duplicate", "1.0.0");
	createInstalledProjectPackage(workingDir, "test-duplicate", "1.0.0");

	const result = await updateConfiguredPackages(workingDir, agentDir, "npm:test-duplicate");

	assert.deepEqual(result, { updated: ["npm:test-duplicate"], skipped: [] });
	const invocations = readFileSync(logPath, "utf8").trim().split("\n").map((line) => JSON.parse(line) as string[]);
	assert.equal(invocations.length, 1);
	const invocation = invocations[0] ?? [];
	assert.ok(!invocation.includes("-g"));
	assert.equal(invocation[invocation.indexOf("--prefix") + 1], resolve(workingDir, ".feynman", "npm"));
	assert.equal(
		readInstalledPackageVersion(resolve(workingDir, ".feynman", "npm", "node_modules", "test-duplicate")),
		"2.0.0",
	);
	assert.equal(
		readInstalledPackageVersion(resolve(agentDir, "npm", "node_modules", "test-duplicate")),
		"1.0.0",
	);
});

test("updateConfiguredPackages rechecks attempted sources before reporting success", async () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-package-ops-"));
	const workingDir = resolve(root, "project");
	const agentDir = resolve(root, "agent");
	const logPath = resolve(root, "npm-invocations.jsonl");
	mkdirSync(workingDir, { recursive: true });

	const scriptPath = writeFakeUpdatingNpmScript(
		root,
		logPath,
		{ "test-stale": "2.0.0" },
		{ leaveStale: ["test-stale"] },
	);
	writeSettings(agentDir, {
		npmCommand: [process.execPath, scriptPath],
		packages: ["npm:test-stale"],
	});
	createInstalledManagedPackage(agentDir, "test-stale", "1.0.0");

	await assert.rejects(
		updateConfiguredPackages(workingDir, agentDir),
		/Package updates remain available after install: npm:test-stale/,
	);
	assert.equal(
		readInstalledPackageVersion(resolve(agentDir, "npm", "node_modules", "test-stale")),
		"1.0.0",
	);
});

test("updateConfiguredPackages patches updated Pi package roots before returning", async () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-package-ops-"));
	const workingDir = resolve(root, "project");
	const agentDir = resolve(root, "agent");
	const logPath = resolve(root, "npm-invocations.jsonl");
	mkdirSync(workingDir, { recursive: true });

	const scriptPath = writeFakeSessionSearchNpmScript(root, logPath);
	writeSettings(agentDir, {
		npmCommand: [process.execPath, scriptPath],
		packages: ["npm:@kaiserlich-dev/pi-session-search"],
	});
	createInstalledGlobalPackage(root, "@kaiserlich-dev/pi-session-search", "1.0.0");

	const originalVersion = process.versions.node;
	Object.defineProperty(process.versions, "node", { value: "22.17.0", configurable: true });
	try {
		const result = await updateConfiguredPackages(workingDir, agentDir, "npm:@kaiserlich-dev/pi-session-search");
		assert.deepEqual(result.skipped, []);
		assert.deepEqual(result.updated, ["npm:@kaiserlich-dev/pi-session-search"]);
	} finally {
		Object.defineProperty(process.versions, "node", { value: originalVersion, configurable: true });
	}

	const invocations = readFileSync(logPath, "utf8").trim().split("\n")
		.map((line) => JSON.parse(line) as string[])
		.filter((args) => args.includes("install"));
	assert.equal(invocations.length, 1);
	assert.ok(invocations[0]?.includes("@kaiserlich-dev/pi-session-search@latest"));
	const patched = readFileSync(getSessionSearchIndexerPath(root), "utf8");
	assert.match(patched, /FEYNMAN_SESSION_DIR/);
	assert.doesNotMatch(patched, /const sessionsDir = path\.join\(os\.homedir\(\), "\.pi", "agent", "sessions"\)/);
});

test("updateConfiguredPackages skips native package updates on unsupported Node majors", async () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-package-ops-"));
	const workingDir = resolve(root, "project");
	const agentDir = resolve(root, "agent");
	const logPath = resolve(root, "npm-invocations.jsonl");
	mkdirSync(workingDir, { recursive: true });

	const scriptPath = writeFakeUpdatingNpmScript(root, logPath, {
		"@kaiserlich-dev/pi-session-search": "2.0.0",
		"test-regular": "2.0.0",
	});

	writeSettings(agentDir, {
		npmCommand: [process.execPath, scriptPath],
		packages: ["npm:@kaiserlich-dev/pi-session-search", "npm:test-regular"],
	});
	createInstalledGlobalPackage(root, "@kaiserlich-dev/pi-session-search", "1.0.0");
	createInstalledGlobalPackage(root, "test-regular", "1.0.0");

	const originalVersion = process.versions.node;
	Object.defineProperty(process.versions, "node", { value: "24.0.0", configurable: true });

	try {
		const result = await updateConfiguredPackages(workingDir, agentDir);
		assert.deepEqual(result.updated, ["npm:test-regular"]);
		assert.deepEqual(result.skipped, ["npm:@kaiserlich-dev/pi-session-search"]);
	} finally {
		Object.defineProperty(process.versions, "node", { value: originalVersion, configurable: true });
	}

	const invocations = existsSync(logPath)
		? readFileSync(logPath, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as string[])
		: [];
	assert.equal(invocations.length, 1);
	assert.ok(invocations[0]?.includes("test-regular@latest"));
	assert.ok(!invocations[0]?.some((entry) => entry.includes("pi-session-search")));
});
