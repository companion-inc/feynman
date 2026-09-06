import test from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";

import {
	getMissingConfiguredPackages,
	resolveAdjacentNpmCommand,
	seedBundledWorkspacePackages,
} from "../src/pi/package-ops.js";
import { RUNTIME_INPUT_FILES } from "../scripts/lib/runtime-workspace-integrity.mjs";

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

function writeSettings(agentDir: string, settings: Record<string, unknown>): void {
	mkdirSync(agentDir, { recursive: true });
	writeFileSync(resolve(agentDir, "settings.json"), JSON.stringify(settings, null, 2) + "\n", "utf8");
}

test("Pi runtime fallback version follows the bundled Pi runtime version", async () => {
	const manifest = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8")) as { dependencies?: Record<string, string> };
	const version = manifest.dependencies?.["@earendil-works/pi-coding-agent"];
	assert.match(version ?? "", /^\d+\.\d+\.\d+$/);
	const packageOpsSource = readFileSync(resolve(process.cwd(), "src", "pi", "package-ops.ts"), "utf8");
	const runtimeWorkspaceSource = readFileSync(resolve(process.cwd(), "scripts", "prepare-runtime-workspace.mjs"), "utf8");

	assert.match(packageOpsSource, new RegExp(`PI_RUNTIME_FALLBACK_VERSION = "${version}"`));
	assert.match(runtimeWorkspaceSource, new RegExp(`PI_RUNTIME_FALLBACK_VERSION = "${version}"`));
});

test("prepare runtime workspace hash tracks every transitive patch file", async () => {
	const repoRoot = process.cwd();
	const pending = [resolve(repoRoot, "scripts", "prepare-runtime-workspace.mjs")];
	const importedFiles = new Set<string>();
	while (pending.length > 0) {
		const currentPath = pending.shift()!;
		const currentFile = relative(repoRoot, currentPath).split("\\").join("/");
		if (importedFiles.has(currentFile)) continue;
		importedFiles.add(currentFile);
		const source = readFileSync(currentPath, "utf8");
		for (const match of source.matchAll(/from ["'](\.[^"']+\.mjs)["']/g)) {
			const importedPath = resolve(dirname(currentPath), match[1]!);
			if (existsSync(importedPath)) pending.push(importedPath);
		}
	}

	assert.ok(RUNTIME_INPUT_FILES.includes("scripts/prepare-runtime-workspace.mjs"));
	assert.ok(RUNTIME_INPUT_FILES.includes("scripts/prune-runtime-deps.mjs"));
	assert.ok(importedFiles.size > 1);
	for (const importedFile of importedFiles) {
		assert.ok(
			RUNTIME_INPUT_FILES.includes(importedFile),
			`${importedFile} must be included in the runtime input hash`,
		);
	}
	for (const inputFile of RUNTIME_INPUT_FILES) {
		assert.equal(existsSync(resolve(process.cwd(), inputFile)), true, `${inputFile} must exist`);
	}
});

test("prepare runtime workspace pins audited transitive runtime overrides", async () => {
	const runtimeWorkspaceSource = readFileSync(resolve(process.cwd(), "scripts", "prepare-runtime-workspace.mjs"), "utf8");
	const installedRuntimeSource = readFileSync(resolve(process.cwd(), "scripts", "patch-embedded-pi.mjs"), "utf8");
	const runtimeInstallSource = readFileSync(resolve(process.cwd(), "scripts", "lib", "runtime-workspace-install.mjs"), "utf8");

	assert.match(runtimeWorkspaceSource, /"@mozilla\/readability": "0\.6\.0"/);
	assert.match(runtimeWorkspaceSource, /"@opentelemetry\/sdk-node": "0\.222\.0"/);
	assert.match(runtimeWorkspaceSource, /"@opentelemetry\/resources": "2\.11\.0"/);
	assert.match(runtimeWorkspaceSource, /"@llamaindex\/liteparse": "2\.14\.3"/);
	assert.match(runtimeWorkspaceSource, /"ip-address": "10\.7\.0"/);
	assert.match(runtimeWorkspaceSource, /undici: "8\.10\.2"/);
	assert.match(runtimeWorkspaceSource, /"undici",\n\];/);
	assert.match(runtimeWorkspaceSource, /overrides: RUNTIME_PACKAGE_OVERRIDES/);
	assert.match(installedRuntimeSource, /buildSourceRuntimeArchive/);
	assert.match(installedRuntimeSource, /installRuntimeWorkspaceFromPackageLock/);
	assert.match(installedRuntimeSource, /patchStagedRuntimeWorkspace/);
	assert.match(installedRuntimeSource, /let installSeed = packagedRestore\.installSeed;/);
	assert.doesNotMatch(
		installedRuntimeSource,
		/readRuntimeWorkspaceInstallSeedFromDirectory|existingInstallSeed/,
	);
	assert.match(runtimeInstallSource, /"ci"/);
	assert.match(runtimeInstallSource, /--patch-existing/);
	assert.doesNotMatch(runtimeInstallSource, /case "pnpm"|case "bun"/);
});

test("installed runtime scripts follow npm's platform-specific global prefix layout", () => {
	for (const relativePath of [
		"scripts/patch-embedded-pi.mjs",
		"scripts/verify-stale-pi-upgrade.mjs",
	]) {
		const source = readFileSync(resolve(process.cwd(), relativePath), "utf8");
		assert.match(source, /process\.platform === "win32"/, relativePath);
		assert.match(source, /"npm-global", "node_modules"|"node_modules"/, relativePath);
		assert.match(source, /"lib", "node_modules"/, relativePath);
	}
});

test("0.3.26 release notes name the table-header extraction repair", () => {
	for (const path of [
		resolve(process.cwd(), "RELEASES.md"),
		resolve(process.cwd(), "website", "src", "content", "docs", "reference", "releases.md"),
	]) {
		const releases = readFileSync(path, "utf8");
		const currentRelease = releases.match(/## v0\.3\.26[\s\S]*?(?=\n## v0\.3\.25)/)?.[0] ?? "";
		assert.match(currentRelease, /bundled LiteParse runtime to `2\.13\.1`/i);
		assert.match(currentRelease, /multi-line table headers/i);
		assert.match(currentRelease, /silently dropping/i);
	}
});

test("published manifest pins the Undici override for npm 10 consumers", async () => {
	const manifest = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8")) as {
		dependencies?: Record<string, string>;
		overrides?: Record<string, unknown>;
	};

	assert.equal(manifest.dependencies?.undici, "8.10.2");
	assert.equal(manifest.overrides?.undici, manifest.dependencies?.undici);
	assert.doesNotMatch(String(manifest.overrides?.undici), /^\$/);
});

test("release manifests pin current document and website security repairs", () => {
	const manifest = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8")) as {
		dependencies?: Record<string, string>;
		optionalDependencies?: Record<string, string>;
		overrides?: Record<string, string>;
	};
	const lock = JSON.parse(readFileSync(resolve(process.cwd(), "package-lock.json"), "utf8")) as {
		packages?: Record<string, {
			optional?: boolean;
			optionalDependencies?: Record<string, string>;
			version?: string;
		}>;
	};
	const websiteManifest = JSON.parse(readFileSync(resolve(process.cwd(), "website", "package.json"), "utf8")) as {
		overrides?: Record<string, string>;
	};
	const websiteLock = JSON.parse(readFileSync(resolve(process.cwd(), "website", "package-lock.json"), "utf8")) as {
		packages?: Record<string, { version?: string }>;
	};

	assert.equal(manifest.dependencies?.["pdfjs-dist"], "^6.3.289");
	assert.equal(lock.packages?.["node_modules/pdfjs-dist"]?.version, "6.3.289");
	assert.equal(manifest.overrides?.nanoid, "3.3.18");
	const nanoidEntries = Object.entries(lock.packages ?? {}).filter(([path]) => path.endsWith("/node_modules/nanoid") || path === "node_modules/nanoid");
	assert.ok(nanoidEntries.length > 0, "the resolved PostCSS nanoid dependency must remain covered");
	for (const [path, entry] of nanoidEntries) assert.equal(entry.version, "3.3.18", path);
	assert.equal(manifest.overrides?.["ip-address"], "10.7.0");
	assert.equal(lock.packages?.["node_modules/ip-address"]?.version, "10.7.0");
	for (const packageName of [
		"@llamaindex/liteparse-darwin-arm64",
		"@llamaindex/liteparse-darwin-x64",
		"@llamaindex/liteparse-linux-arm64-gnu",
		"@llamaindex/liteparse-linux-x64-gnu",
		"@llamaindex/liteparse-linux-x64-musl",
		"@llamaindex/liteparse-win32-arm64-msvc",
		"@llamaindex/liteparse-win32-x64-msvc",
	]) {
		assert.equal(manifest.optionalDependencies?.[packageName], "2.14.3");
		assert.equal(lock.packages?.[""]?.optionalDependencies?.[packageName], "2.14.3");
		assert.equal(lock.packages?.[`node_modules/${packageName}`]?.version, "2.14.3");
		assert.equal(lock.packages?.[`node_modules/${packageName}`]?.optional, true);
	}
	// Keep the approved compatible majors used by Astro/cosmiconfig, PostCSS,
	// and AJV. Overrides may resolve beneath consumers rather than at the root.
	for (const [packageName, version] of [
		["js-yaml", "4.3.2"],
		["nanoid", "3.3.18"],
		["fast-uri", "3.1.7"],
	]) {
		assert.equal(websiteManifest.overrides?.[packageName!], version);
		const entries = Object.entries(websiteLock.packages ?? {}).filter(([path]) =>
			path === `node_modules/${packageName}` || path.endsWith(`/node_modules/${packageName}`),
		);
		assert.ok(entries.length > 0, `${packageName} must remain covered in the website lock`);
		for (const [path, entry] of entries) assert.equal(entry.version, version, path);
	}
});

test("prepare runtime workspace links legacy Pi aliases instead of installing duplicates", async () => {
	const runtimeWorkspaceSource = readFileSync(resolve(process.cwd(), "scripts", "prepare-runtime-workspace.mjs"), "utf8");

	assert.match(runtimeWorkspaceSource, /function linkLegacyPiRuntimeAliases/);
	assert.match(runtimeWorkspaceSource, /ensureLegacyPiRuntimeAliases\(workspaceNodeModulesDir\)/);
	assert.doesNotMatch(runtimeWorkspaceSource, /packageSpecs\.push\(`\$\{legacyName\}@npm:/);
});

test("resolveAdjacentNpmCommand uses npm-cli.js on Windows when it is bundled beside Node", async () => {
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

test("resolveAdjacentNpmCommand falls back to npm.cmd with a shell on Windows", async () => {
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

test("seedBundledWorkspacePackages links bundled packages into the Feynman npm prefix", async () => {
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

test("seedBundledWorkspacePackages uses the Windows npm prefix layout", async () => {
	const appRoot = mkdtempSync(join(tmpdir(), "feynman-bundle-"));
	const homeRoot = mkdtempSync(join(tmpdir(), "feynman-home-"));
	const agentDir = resolve(homeRoot, "agent");
	mkdirSync(agentDir, { recursive: true });
	createBundledWorkspace(appRoot, ["pi-subagents"]);

	const seeded = seedBundledWorkspacePackages(
		agentDir,
		appRoot,
		["npm:pi-subagents"],
		"win32",
	);

	assert.deepEqual(seeded, ["npm:pi-subagents"]);
	assert.equal(
		existsSync(resolve(homeRoot, "npm-global", "node_modules", "pi-subagents", "package.json")),
		true,
	);
	assert.equal(
		existsSync(resolve(homeRoot, "npm-global", "lib", "node_modules", "pi-subagents")),
		false,
	);
});

test("seedBundledWorkspacePackages preserves existing installed packages", async () => {
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

test("seedBundledWorkspacePackages treats copied bundled packages as satisfied", async () => {
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

test("getMissingConfiguredPackages seeds bundled packages before reporting missing startup packages", async () => {
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

test("seedBundledWorkspacePackages repairs broken existing bundled packages", async () => {
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

test("seedBundledWorkspacePackages prunes stale links from previous bundled runtimes", async () => {
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
