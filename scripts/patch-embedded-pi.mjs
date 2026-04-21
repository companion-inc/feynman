import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { delimiter, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FEYNMAN_LOGO_HTML } from "../logo.mjs";
import { patchAlphaHubAuthSource } from "./lib/alpha-hub-auth-patch.mjs";
import { patchPiAgentCoreSource } from "./lib/pi-agent-core-patch.mjs";
import { patchPiExtensionLoaderSource } from "./lib/pi-extension-loader-patch.mjs";
import { patchPiGoogleLegacySchemaSource } from "./lib/pi-google-legacy-schema-patch.mjs";
import { PI_WEB_ACCESS_PATCH_TARGETS, patchPiWebAccessSource } from "./lib/pi-web-access-patch.mjs";
import { PI_SUBAGENTS_PATCH_TARGETS, patchPiSubagentsSource, stripPiSubagentBuiltinModelSource } from "./lib/pi-subagents-patch.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, "..");
const feynmanHome = resolve(process.env.FEYNMAN_HOME ?? homedir(), ".feynman");
const feynmanNpmPrefix = resolve(feynmanHome, "npm-global");
process.env.FEYNMAN_NPM_PREFIX = feynmanNpmPrefix;
process.env.NPM_CONFIG_PREFIX = feynmanNpmPrefix;
process.env.npm_config_prefix = feynmanNpmPrefix;
const appRequire = createRequire(resolve(appRoot, "package.json"));
const isGlobalInstall = process.env.npm_config_global === "true" || process.env.npm_config_location === "global";

function findPackageRoot(packageName) {
	const segments = packageName.split("/");
	let current = appRoot;
	while (current !== dirname(current)) {
		for (const candidate of [resolve(current, "node_modules", ...segments), resolve(current, ...segments)]) {
			if (existsSync(resolve(candidate, "package.json"))) {
				return candidate;
			}
		}
		current = dirname(current);
	}

	for (const spec of [`${packageName}/dist/index.js`, `${packageName}/dist/cli.js`, packageName]) {
		try {
			let current = dirname(appRequire.resolve(spec));
			while (current !== dirname(current)) {
				if (existsSync(resolve(current, "package.json"))) {
					return current;
				}
				current = dirname(current);
			}
		} catch {
			continue;
		}
	}
	return null;
}

const piPackageRoot = findPackageRoot("@mariozechner/pi-coding-agent");
const piAgentCoreRoot = findPackageRoot("@mariozechner/pi-agent-core");
const piTuiRoot = findPackageRoot("@mariozechner/pi-tui");
const piAiRoot = findPackageRoot("@mariozechner/pi-ai");

if (!piPackageRoot) {
	console.warn("[feynman] pi-coding-agent not found, skipping Pi patches");
}

const packageJsonPath = piPackageRoot ? resolve(piPackageRoot, "package.json") : null;
const cliPath = piPackageRoot ? resolve(piPackageRoot, "dist", "cli.js") : null;
const bunCliPath = piPackageRoot ? resolve(piPackageRoot, "dist", "bun", "cli.js") : null;
const interactiveModePath = piPackageRoot ? resolve(piPackageRoot, "dist", "modes", "interactive", "interactive-mode.js") : null;
const interactiveThemePath = piPackageRoot ? resolve(piPackageRoot, "dist", "modes", "interactive", "theme", "theme.js") : null;
const extensionLoaderPath = piPackageRoot ? resolve(piPackageRoot, "dist", "core", "extensions", "loader.js") : null;
const agentLoopPath = piAgentCoreRoot ? resolve(piAgentCoreRoot, "dist", "agent-loop.js") : null;
const terminalPath = piTuiRoot ? resolve(piTuiRoot, "dist", "terminal.js") : null;
const editorPath = piTuiRoot ? resolve(piTuiRoot, "dist", "components", "editor.js") : null;
const workspaceRoot = resolve(appRoot, ".feynman", "npm", "node_modules");
const workspaceAgentLoopPath = resolve(
	workspaceRoot,
	"@mariozechner",
	"pi-agent-core",
	"dist",
	"agent-loop.js",
);
const workspaceExtensionLoaderPath = resolve(
	workspaceRoot,
	"@mariozechner",
	"pi-coding-agent",
	"dist",
	"core",
	"extensions",
	"loader.js",
);
const piSubagentsRoot = resolve(workspaceRoot, "pi-subagents");
const webAccessPath = resolve(workspaceRoot, "pi-web-access", "index.ts");
const sessionSearchIndexerPath = resolve(
	workspaceRoot,
	"@kaiserlich-dev",
	"pi-session-search",
	"extensions",
	"indexer.ts",
);
const piMemoryPath = resolve(workspaceRoot, "@samfp", "pi-memory", "src", "index.ts");
const settingsPath = resolve(appRoot, ".feynman", "settings.json");
const workspaceDir = resolve(appRoot, ".feynman", "npm");
const workspacePackageJsonPath = resolve(workspaceDir, "package.json");
const workspaceManifestPath = resolve(workspaceDir, ".runtime-manifest.json");
const workspaceArchivePath = resolve(appRoot, ".feynman", "runtime-workspace.tgz");
const workspaceSetupLockDir = resolve(appRoot, ".feynman", ".workspace-setup.lock");
const globalNodeModulesRoot = resolve(feynmanNpmPrefix, "lib", "node_modules");
const PRUNE_VERSION = 4;
const WORKSPACE_SETUP_LOCK_STALE_MS = 300000;
const NATIVE_PACKAGE_SPECS = new Set([
	"@kaiserlich-dev/pi-session-search",
	"@samfp/pi-memory",
]);
const FILTERED_INSTALL_OUTPUT_PATTERNS = [
	/npm warn deprecated node-domexception@1\.0\.0/i,
	/npm notice/i,
	/^(added|removed|changed) \d+ packages?( in .+)?$/i,
	/^\d+ packages are looking for funding$/i,
	/^run `npm fund` for details$/i,
];

function arraysMatch(left, right) {
	return left.length === right.length && left.every((value, index) => value === right[index]);
}

function supportsNativePackageSources(version = process.versions.node) {
	const [major = "0"] = version.replace(/^v/, "").split(".");
	return (Number.parseInt(major, 10) || 0) <= 24;
}

function createInstallCommand(packageManager, packageSpecs) {
	switch (packageManager) {
		case "npm":
			return [
				"install",
				"--global=false",
				"--location=project",
				"--prefer-offline",
				"--no-audit",
				"--no-fund",
				"--legacy-peer-deps",
				"--loglevel",
				"error",
				...packageSpecs,
			];
		case "pnpm":
			return ["add", "--prefer-offline", "--reporter", "silent", ...packageSpecs];
		case "bun":
			return ["add", "--silent", ...packageSpecs];
		default:
			throw new Error(`Unsupported package manager: ${packageManager}`);
	}
}

let cachedPackageManager = undefined;

function resolvePackageManager() {
	if (cachedPackageManager !== undefined) return cachedPackageManager;

	const requested = process.env.FEYNMAN_PACKAGE_MANAGER?.trim();
	const candidates = requested ? [requested] : ["npm", "pnpm", "bun"];
	for (const candidate of candidates) {
		if (resolveExecutable(candidate)) {
			cachedPackageManager = candidate;
			return candidate;
		}
	}

	cachedPackageManager = null;
	return null;
}

function installWorkspacePackages(packageSpecs) {
	const packageManager = resolvePackageManager();
	if (!packageManager) {
		process.stderr.write(
			"[feynman] no supported package manager found; install npm, pnpm, or bun, or set FEYNMAN_PACKAGE_MANAGER.\n",
		);
		return false;
	}

	const result = spawnSync(packageManager, createInstallCommand(packageManager, packageSpecs), {
		cwd: workspaceDir,
		stdio: ["ignore", "pipe", "pipe"],
		timeout: 300000,
		env: {
			...process.env,
			PATH: getPathWithCurrentNode(process.env.PATH),
		},
	});

	for (const stream of [result.stdout, result.stderr]) {
		if (!stream?.length) continue;
		for (const line of stream.toString().split(/\r?\n/)) {
			if (!line.trim()) continue;
			if (FILTERED_INSTALL_OUTPUT_PATTERNS.some((pattern) => pattern.test(line.trim()))) continue;
			process.stderr.write(`${line}\n`);
		}
	}

	if (result.status !== 0) {
		process.stderr.write(`[feynman] ${packageManager} failed while setting up bundled packages.\n`);
		return false;
	}

	return true;
}

function parsePackageName(spec) {
	const match = spec.match(/^(@?[^@]+(?:\/[^@]+)?)(?:@.+)?$/);
	return match?.[1] ?? spec;
}

function filterUnsupportedPackageSpecs(packageSpecs) {
	if (supportsNativePackageSources()) return packageSpecs;
	return packageSpecs.filter((spec) => !NATIVE_PACKAGE_SPECS.has(parsePackageName(spec)));
}

function workspaceContainsPackages(packageSpecs) {
	return packageSpecs.every((spec) => existsSync(resolve(workspaceRoot, parsePackageName(spec))));
}

function workspaceMatchesRuntime(packageSpecs) {
	if (!existsSync(workspaceManifestPath)) return false;

	try {
		const manifest = JSON.parse(readFileSync(workspaceManifestPath, "utf8"));
		if (!Array.isArray(manifest.packageSpecs)) {
			return false;
		}
		if (!arraysMatch(manifest.packageSpecs, packageSpecs)) {
			if (!(workspaceContainsPackages(packageSpecs) && packageSpecs.every((spec) => manifest.packageSpecs.includes(spec)))) {
				return false;
			}
		}
		if (!supportsNativePackageSources() && workspaceContainsPackages(packageSpecs)) {
			return true;
		}
		if (
			manifest.nodeAbi !== process.versions.modules ||
			manifest.platform !== process.platform ||
			manifest.arch !== process.arch ||
			manifest.pruneVersion !== PRUNE_VERSION
		) {
			return false;
		}

		return packageSpecs.every((spec) => existsSync(resolve(workspaceRoot, parsePackageName(spec))));
	} catch {
		return false;
	}
}

function writeWorkspaceManifest(packageSpecs) {
	writeFileSync(
		workspaceManifestPath,
		JSON.stringify(
			{
				packageSpecs,
				generatedAt: new Date().toISOString(),
				nodeAbi: process.versions.modules,
				nodeVersion: process.version,
				platform: process.platform,
				arch: process.arch,
				pruneVersion: PRUNE_VERSION,
			},
			null,
			2,
		) + "\n",
		"utf8",
	);
}

function ensureParentDir(path) {
	mkdirSync(dirname(path), { recursive: true });
}

function packageDependencyExists(packagePath, globalNodeModulesRoot, dependency) {
	return existsSync(resolve(packagePath, "node_modules", dependency)) ||
		existsSync(resolve(globalNodeModulesRoot, dependency));
}

function installedPackageLooksUsable(packagePath, globalNodeModulesRoot) {
	if (!existsSync(resolve(packagePath, "package.json"))) return false;
	try {
		const pkg = JSON.parse(readFileSync(resolve(packagePath, "package.json"), "utf8"));
		return Object.keys(pkg.dependencies ?? {}).every((dependency) =>
			packageDependencyExists(packagePath, globalNodeModulesRoot, dependency)
		);
	} catch {
		return false;
	}
}

function linkPointsTo(linkPath, targetPath) {
	try {
		if (!lstatSync(linkPath).isSymbolicLink()) return false;
		return resolve(dirname(linkPath), readlinkSync(linkPath)) === targetPath;
	} catch {
		return false;
	}
}

function listWorkspacePackageNames(root) {
	if (!existsSync(root)) return [];
	const names = [];
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
		if (entry.name.startsWith(".")) continue;
		if (entry.name.startsWith("@")) {
			const scopeRoot = resolve(root, entry.name);
			for (const scopedEntry of readdirSync(scopeRoot, { withFileTypes: true })) {
				if (!scopedEntry.isDirectory() && !scopedEntry.isSymbolicLink()) continue;
				names.push(`${entry.name}/${scopedEntry.name}`);
			}
			continue;
		}
		names.push(entry.name);
	}
	return names;
}

function linkBundledPackage(packageName) {
	const sourcePath = resolve(workspaceRoot, packageName);
	const targetPath = resolve(globalNodeModulesRoot, packageName);
	if (!existsSync(sourcePath)) return false;
	if (linkPointsTo(targetPath, sourcePath)) return false;
	try {
		if (lstatSync(targetPath).isSymbolicLink()) {
			rmSync(targetPath, { force: true });
		} else if (!installedPackageLooksUsable(targetPath, globalNodeModulesRoot)) {
			rmSync(targetPath, { recursive: true, force: true });
		}
	} catch {}
	if (existsSync(targetPath)) return false;

	ensureParentDir(targetPath);
	try {
		symlinkSync(sourcePath, targetPath, process.platform === "win32" ? "junction" : "dir");
		return true;
	} catch {
		return false;
	}
}

function ensureBundledPackageLinks(packageSpecs) {
	if (!workspaceMatchesRuntime(packageSpecs)) return;

	for (const packageName of listWorkspacePackageNames(workspaceRoot)) {
		linkBundledPackage(packageName);
	}
}

function restorePackagedWorkspace(packageSpecs) {
	if (!existsSync(workspaceArchivePath)) return false;

	rmSync(workspaceDir, { recursive: true, force: true });
	mkdirSync(resolve(appRoot, ".feynman"), { recursive: true });

	const result = spawnSync("tar", ["-xzf", workspaceArchivePath, "-C", resolve(appRoot, ".feynman")], {
		stdio: ["ignore", "ignore", "pipe"],
		timeout: 300000,
	});

	// On Windows, tar may exit non-zero due to symlink creation failures in
	// .bin/ directories. These are non-fatal — check whether the actual
	// package directories were extracted successfully.
	const packagesPresent = packageSpecs.every((spec) => existsSync(resolve(workspaceRoot, parsePackageName(spec))));
	if (packagesPresent) return true;

	if (result.status !== 0) {
		if (result.stderr?.length) process.stderr.write(result.stderr);
		return false;
	}

	return false;
}

function resolveExecutable(name, fallbackPaths = []) {
	for (const candidate of fallbackPaths) {
		if (existsSync(candidate)) return candidate;
	}

	const isWindows = process.platform === "win32";
	const env = {
		...process.env,
		PATH: process.env.PATH ?? "",
	};
	const result = isWindows
		? spawnSync("cmd", ["/c", `where ${name}`], {
				encoding: "utf8",
				stdio: ["ignore", "pipe", "ignore"],
				env,
			})
		: spawnSync("sh", ["-c", `command -v ${name}`], {
				encoding: "utf8",
				stdio: ["ignore", "pipe", "ignore"],
				env,
			});
	if (result.status === 0) {
		const resolved = result.stdout.trim().split(/\r?\n/)[0];
		if (resolved) return resolved;
	}
	return null;
}

function getPathWithCurrentNode(pathValue = process.env.PATH ?? "") {
	const nodeDir = dirname(process.execPath);
	const parts = pathValue.split(delimiter).filter(Boolean);
	return parts.includes(nodeDir) ? pathValue : `${nodeDir}${delimiter}${pathValue}`;
}

function sleepSync(ms) {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function acquireWorkspaceSetupLock() {
	mkdirSync(dirname(workspaceSetupLockDir), { recursive: true });
	const startedAt = Date.now();

	while (true) {
		try {
			mkdirSync(workspaceSetupLockDir);
			writeFileSync(resolve(workspaceSetupLockDir, "owner"), `${process.pid}\n${new Date().toISOString()}\n`, "utf8");
			return;
		} catch (error) {
			if (error?.code !== "EEXIST") throw error;
			try {
				if (Date.now() - statSync(workspaceSetupLockDir).mtimeMs > WORKSPACE_SETUP_LOCK_STALE_MS) {
					rmSync(workspaceSetupLockDir, { recursive: true, force: true });
					continue;
				}
			} catch {}
			if (Date.now() - startedAt > WORKSPACE_SETUP_LOCK_STALE_MS) {
				throw new Error("Timed out waiting for another Feynman process to finish package setup.");
			}
			sleepSync(100);
		}
	}
}

function releaseWorkspaceSetupLock() {
	rmSync(workspaceSetupLockDir, { recursive: true, force: true });
}

function ensurePackageWorkspace() {
	if (!existsSync(settingsPath)) return;
	acquireWorkspaceSetupLock();
	try {
		ensurePackageWorkspaceUnlocked();
	} finally {
		releaseWorkspaceSetupLock();
	}
}

function ensurePackageWorkspaceUnlocked() {
	const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
	const packageSpecs = Array.isArray(settings.packages)
		? settings.packages
				.filter((v) => typeof v === "string" && v.startsWith("npm:"))
				.map((v) => v.slice(4))
		: [];
	const supportedPackageSpecs = filterUnsupportedPackageSpecs(packageSpecs);

	if (supportedPackageSpecs.length === 0) return;
	if (workspaceMatchesRuntime(supportedPackageSpecs)) {
		ensureBundledPackageLinks(supportedPackageSpecs);
		return;
	}
	if (restorePackagedWorkspace(packageSpecs) && workspaceMatchesRuntime(supportedPackageSpecs)) {
		ensureBundledPackageLinks(supportedPackageSpecs);
		return;
	}

	mkdirSync(workspaceDir, { recursive: true });
	writeFileSync(
		workspacePackageJsonPath,
		JSON.stringify({ name: "feynman-packages", private: true }, null, 2) + "\n",
		"utf8",
	);

	const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
	let frame = 0;
	const start = Date.now();
	const spinner = setInterval(() => {
		const elapsed = Math.round((Date.now() - start) / 1000);
		process.stderr.write(`\r${frames[frame++ % frames.length]} setting up feynman... ${elapsed}s`);
	}, 80);

	const result = installWorkspacePackages(supportedPackageSpecs);

	clearInterval(spinner);
	const elapsed = Math.round((Date.now() - start) / 1000);

	if (!result) {
		process.stderr.write(`\r✗ setup failed (${elapsed}s)\n`);
	} else {
		process.stderr.write("\r\x1b[2K");
		writeWorkspaceManifest(supportedPackageSpecs);
		ensureBundledPackageLinks(supportedPackageSpecs);
	}
}

ensurePackageWorkspace();

function ensurePandoc() {
	if (!isGlobalInstall) return;
	if (process.platform !== "darwin") return;
	if (process.env.FEYNMAN_SKIP_PANDOC_INSTALL === "1") return;
	if (resolveExecutable("pandoc", ["/opt/homebrew/bin/pandoc", "/usr/local/bin/pandoc"])) return;

	const brewPath = resolveExecutable("brew", ["/opt/homebrew/bin/brew", "/usr/local/bin/brew"]);
	if (!brewPath) return;

	console.log("[feynman] installing pandoc...");
	const result = spawnSync(brewPath, ["install", "pandoc"], {
		stdio: "inherit",
		timeout: 300000,
	});
	if (result.status !== 0) {
		console.warn("[feynman] warning: pandoc install failed, run `feynman --setup-preview` later");
	}
}

ensurePandoc();

if (existsSync(piSubagentsRoot)) {
	for (const relativePath of PI_SUBAGENTS_PATCH_TARGETS) {
		const entryPath = resolve(piSubagentsRoot, relativePath);
		if (!existsSync(entryPath)) continue;

		const source = readFileSync(entryPath, "utf8");
		const patched = patchPiSubagentsSource(relativePath, source);
		if (patched !== source) {
			writeFileSync(entryPath, patched, "utf8");
		}
	}

	const builtinAgentsRoot = resolve(piSubagentsRoot, "agents");
	if (existsSync(builtinAgentsRoot)) {
		for (const entry of readdirSync(builtinAgentsRoot, { withFileTypes: true })) {
			if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
			const entryPath = resolve(builtinAgentsRoot, entry.name);
			const source = readFileSync(entryPath, "utf8");
			const patched = stripPiSubagentBuiltinModelSource(source);
			if (patched !== source) {
				writeFileSync(entryPath, patched, "utf8");
			}
		}
	}
}

if (packageJsonPath && existsSync(packageJsonPath)) {
	const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8"));
	if (pkg.piConfig?.name !== "feynman" || pkg.piConfig?.configDir !== ".feynman") {
		pkg.piConfig = {
			...(pkg.piConfig || {}),
			name: "feynman",
			configDir: ".feynman",
		};
		writeFileSync(packageJsonPath, JSON.stringify(pkg, null, "\t") + "\n", "utf8");
	}
}

for (const entryPath of [cliPath, bunCliPath].filter(Boolean)) {
	if (!existsSync(entryPath)) {
		continue;
	}

	let cliSource = readFileSync(entryPath, "utf8");
	if (cliSource.includes('process.title = "pi";')) {
		cliSource = cliSource.replace('process.title = "pi";', 'process.title = "feynman";');
	}
	const stdinErrorGuard = [
		"const feynmanHandleStdinError = (error) => {",
		'    if (error && typeof error === "object") {',
		'        const code = "code" in error ? error.code : undefined;',
		'        const syscall = "syscall" in error ? error.syscall : undefined;',
		'        if ((code === "EIO" || code === "EBADF") && syscall === "read") {',
		"            return;",
		"        }",
		"    }",
		"};",
		'process.stdin?.on?.("error", feynmanHandleStdinError);',
	].join("\n");
	if (!cliSource.includes('process.stdin?.on?.("error", feynmanHandleStdinError);')) {
		cliSource = cliSource.replace(
			'process.emitWarning = (() => { });',
			`process.emitWarning = (() => { });\n${stdinErrorGuard}`,
		);
	}
	writeFileSync(entryPath, cliSource, "utf8");
}

if (terminalPath && existsSync(terminalPath)) {
	let terminalSource = readFileSync(terminalPath, "utf8");
	if (!terminalSource.includes("stdinErrorHandler = (error) =>")) {
		terminalSource = terminalSource.replace(
			"    stdinBuffer;\n    stdinDataHandler;\n",
			[
				"    stdinBuffer;",
				"    stdinDataHandler;",
				"    stdinErrorHandler = (error) => {",
				'        if ((error?.code === "EIO" || error?.code === "EBADF") && error?.syscall === "read") {',
				"            return;",
				"        }",
				"    };",
			].join("\n") + "\n",
		);
	}
	if (!terminalSource.includes('process.stdin.on("error", this.stdinErrorHandler);')) {
		terminalSource = terminalSource.replace(
			'        process.stdin.resume();\n',
			'        process.stdin.resume();\n        process.stdin.on("error", this.stdinErrorHandler);\n',
		);
	}
	if (!terminalSource.includes('            process.stdin.removeListener("error", this.stdinErrorHandler);')) {
		terminalSource = terminalSource.replace(
			'            process.stdin.removeListener("data", onData);\n            this.inputHandler = previousHandler;\n',
			[
				'            process.stdin.removeListener("data", onData);',
				'            process.stdin.removeListener("error", this.stdinErrorHandler);',
				'            this.inputHandler = previousHandler;',
			].join("\n"),
		);
		terminalSource = terminalSource.replace(
			'        process.stdin.pause();\n',
			'        process.stdin.removeListener("error", this.stdinErrorHandler);\n        process.stdin.pause();\n',
		);
	}
	writeFileSync(terminalPath, terminalSource, "utf8");
}

if (interactiveModePath && existsSync(interactiveModePath)) {
	const interactiveModeSource = readFileSync(interactiveModePath, "utf8");
	if (interactiveModeSource.includes("`π - ${sessionName} - ${cwdBasename}`")) {
		writeFileSync(
			interactiveModePath,
			interactiveModeSource
				.replace("`π - ${sessionName} - ${cwdBasename}`", "`feynman - ${sessionName} - ${cwdBasename}`")
				.replace("`π - ${cwdBasename}`", "`feynman - ${cwdBasename}`"),
			"utf8",
		);
	}
}

for (const loaderPath of [extensionLoaderPath, workspaceExtensionLoaderPath].filter(Boolean)) {
	if (!existsSync(loaderPath)) {
		continue;
	}

	const source = readFileSync(loaderPath, "utf8");
	const patched = patchPiExtensionLoaderSource(source);
	if (patched !== source) {
		writeFileSync(loaderPath, patched, "utf8");
	}
}

for (const entryPath of [agentLoopPath, workspaceAgentLoopPath].filter(Boolean)) {
	if (!existsSync(entryPath)) {
		continue;
	}

	const source = readFileSync(entryPath, "utf8");
	const patched = patchPiAgentCoreSource(source);
	if (patched !== source) {
		writeFileSync(entryPath, patched, "utf8");
	}
}

if (interactiveThemePath && existsSync(interactiveThemePath)) {
	let themeSource = readFileSync(interactiveThemePath, "utf8");
	const desiredGetEditorTheme = [
		"export function getEditorTheme() {",
		"    return {",
		'        borderColor: (text) => " ".repeat(text.length),',
		'        bgColor: (text) => theme.bg("userMessageBg", text),',
		'        placeholderText: "Type your message or /help for commands",',
		'        placeholder: (text) => theme.fg("dim", text),',
		"        selectList: getSelectListTheme(),",
		"    };",
		"}",
	].join("\n");
	themeSource = themeSource.replace(
		/export function getEditorTheme\(\) \{[\s\S]*?\n\}\nexport function getSettingsListTheme\(\) \{/m,
		`${desiredGetEditorTheme}\nexport function getSettingsListTheme() {`,
	);
	writeFileSync(interactiveThemePath, themeSource, "utf8");
}

if (editorPath && existsSync(editorPath)) {
	let editorSource = readFileSync(editorPath, "utf8");
	const importOriginal =
		'import { getSegmenter, isPunctuationChar, isWhitespaceChar, truncateToWidth, visibleWidth } from "../utils.js";';
	const importReplacement =
		'import { applyBackgroundToLine, getSegmenter, isPunctuationChar, isWhitespaceChar, truncateToWidth, visibleWidth } from "../utils.js";';
	if (editorSource.includes(importOriginal)) {
		editorSource = editorSource.replace(importOriginal, importReplacement);
	}
	const desiredRender = [
		"    render(width) {",
		"        const maxPadding = Math.max(0, Math.floor((width - 1) / 2));",
		"        const paddingX = Math.min(this.paddingX, maxPadding);",
		"        const contentWidth = Math.max(1, width - paddingX * 2);",
		"        // Layout width: with padding the cursor can overflow into it,",
		"        // without padding we reserve 1 column for the cursor.",
		"        const layoutWidth = Math.max(1, contentWidth - (paddingX ? 0 : 1));",
		"        // Store for cursor navigation (must match wrapping width)",
		"        this.lastWidth = layoutWidth;",
		'        const horizontal = this.borderColor("─");',
		"        const bgColor = this.theme.bgColor;",
		"        // Layout the text",
		"        const layoutLines = this.layoutText(layoutWidth);",
		"        // Calculate max visible lines: 30% of terminal height, minimum 5 lines",
		"        const terminalRows = this.tui.terminal.rows;",
		"        const maxVisibleLines = Math.max(5, Math.floor(terminalRows * 0.3));",
		"        // Find the cursor line index in layoutLines",
		"        let cursorLineIndex = layoutLines.findIndex((line) => line.hasCursor);",
		"        if (cursorLineIndex === -1)",
		"            cursorLineIndex = 0;",
		"        // Adjust scroll offset to keep cursor visible",
		"        if (cursorLineIndex < this.scrollOffset) {",
		"            this.scrollOffset = cursorLineIndex;",
		"        }",
		"        else if (cursorLineIndex >= this.scrollOffset + maxVisibleLines) {",
		"            this.scrollOffset = cursorLineIndex - maxVisibleLines + 1;",
		"        }",
		"        // Clamp scroll offset to valid range",
		"        const maxScrollOffset = Math.max(0, layoutLines.length - maxVisibleLines);",
		"        this.scrollOffset = Math.max(0, Math.min(this.scrollOffset, maxScrollOffset));",
		"        // Get visible lines slice",
		"        const visibleLines = layoutLines.slice(this.scrollOffset, this.scrollOffset + maxVisibleLines);",
		"        const result = [];",
		'        const leftPadding = " ".repeat(paddingX);',
		"        const rightPadding = leftPadding;",
		"        const renderBorderLine = (indicator) => {",
		"            const remaining = width - visibleWidth(indicator);",
		"            if (remaining >= 0) {",
		'                return this.borderColor(indicator + "─".repeat(remaining));',
		"            }",
		"            return this.borderColor(truncateToWidth(indicator, width));",
		"        };",
		"        // Render top padding row. When background fill is active, mimic the user-message block",
		"        // instead of the stock editor chrome.",
		"        if (bgColor) {",
		"            if (this.scrollOffset > 0) {",
		"                const indicator = `  ↑ ${this.scrollOffset} more`;",
		"                result.push(applyBackgroundToLine(indicator, width, bgColor));",
		"            }",
		"            else {",
		'                result.push(applyBackgroundToLine("", width, bgColor));',
		"            }",
		"        }",
		"        else if (this.scrollOffset > 0) {",
		"            const indicator = `─── ↑ ${this.scrollOffset} more `;",
		"            result.push(renderBorderLine(indicator));",
		"        }",
		"        else {",
		"            result.push(horizontal.repeat(width));",
		"        }",
		"        // Render each visible layout line",
		"        // Emit hardware cursor marker only when focused and not showing autocomplete",
		"        const emitCursorMarker = this.focused && !this.autocompleteState;",
		"        const showPlaceholder = this.state.lines.length === 1 &&",
		'            this.state.lines[0] === "" &&',
		'            typeof this.theme.placeholderText === "string" &&',
		"            this.theme.placeholderText.length > 0;",
		"        for (let visibleIndex = 0; visibleIndex < visibleLines.length; visibleIndex++) {",
		"            const layoutLine = visibleLines[visibleIndex];",
		"            const isFirstLayoutLine = this.scrollOffset + visibleIndex === 0;",
		"            let displayText = layoutLine.text;",
		"            let lineVisibleWidth = visibleWidth(layoutLine.text);",
		"            const isPlaceholderLine = showPlaceholder && isFirstLayoutLine;",
		"            if (isPlaceholderLine) {",
		"                const marker = emitCursorMarker ? CURSOR_MARKER : \"\";",
		"                const rawPlaceholder = this.theme.placeholderText;",
		'                const styledPlaceholder = typeof this.theme.placeholder === "function"',
		"                    ? this.theme.placeholder(rawPlaceholder)",
		"                    : rawPlaceholder;",
		"                displayText = marker + styledPlaceholder;",
		"                lineVisibleWidth = visibleWidth(rawPlaceholder);",
		"            }",
		"            else if (layoutLine.hasCursor && layoutLine.cursorPos !== undefined) {",
		'                const marker = emitCursorMarker ? CURSOR_MARKER : "";',
		"                const before = displayText.slice(0, layoutLine.cursorPos);",
		"                const after = displayText.slice(layoutLine.cursorPos);",
		"                displayText = before + marker + after;",
		"            }",
		"            // Calculate padding based on actual visible width",
		'            const padding = " ".repeat(Math.max(0, contentWidth - lineVisibleWidth));',
		"            const renderedLine = `${leftPadding}${displayText}${padding}${rightPadding}`;",
		"            result.push(bgColor ? applyBackgroundToLine(renderedLine, width, bgColor) : renderedLine);",
		"        }",
		"        // Render bottom padding row. When background fill is active, mimic the user-message block",
		"        // instead of the stock editor chrome.",
		"        const linesBelow = layoutLines.length - (this.scrollOffset + visibleLines.length);",
		"        if (bgColor) {",
		"            if (linesBelow > 0) {",
		"                const indicator = `  ↓ ${linesBelow} more`;",
		"                result.push(applyBackgroundToLine(indicator, width, bgColor));",
		"            }",
		"            else {",
		'                result.push(applyBackgroundToLine("", width, bgColor));',
		"            }",
		"        }",
		"        else if (linesBelow > 0) {",
		"            const indicator = `─── ↓ ${linesBelow} more `;",
		"            const bottomLine = renderBorderLine(indicator);",
		"            result.push(bottomLine);",
		"        }",
		"        else {",
		"            const bottomLine = horizontal.repeat(width);",
		"            result.push(bottomLine);",
		"        }",
		"        // Add autocomplete list if active",
		"        if (this.autocompleteState && this.autocompleteList) {",
		"            const autocompleteResult = this.autocompleteList.render(contentWidth);",
		"            for (const line of autocompleteResult) {",
		"                const lineWidth = visibleWidth(line);",
		'                const linePadding = " ".repeat(Math.max(0, contentWidth - lineWidth));',
		"                const autocompleteLine = `${leftPadding}${line}${linePadding}${rightPadding}`;",
		"                result.push(bgColor ? applyBackgroundToLine(autocompleteLine, width, bgColor) : autocompleteLine);",
		"            }",
		"        }",
		"        return result;",
		"    }",
	].join("\n");
	editorSource = editorSource.replace(
		/    render\(width\) \{[\s\S]*?\n    handleInput\(data\) \{/m,
		`${desiredRender}\n    handleInput(data) {`,
	);
	writeFileSync(editorPath, editorSource, "utf8");
}

if (existsSync(webAccessPath)) {
	const source = readFileSync(webAccessPath, "utf8");
	if (source.includes('pi.registerCommand("search",')) {
		writeFileSync(
			webAccessPath,
			source.replace('pi.registerCommand("search",', 'pi.registerCommand("web-results",'),
			"utf8",
		);
	}
}

const piWebAccessRoot = resolve(workspaceRoot, "pi-web-access");

if (existsSync(piWebAccessRoot)) {
	for (const relativePath of PI_WEB_ACCESS_PATCH_TARGETS) {
		const entryPath = resolve(piWebAccessRoot, relativePath);
		if (!existsSync(entryPath)) continue;

		const source = readFileSync(entryPath, "utf8");
		const patched = patchPiWebAccessSource(relativePath, source);
		if (patched !== source) {
			writeFileSync(entryPath, patched, "utf8");
		}
	}
}

if (existsSync(sessionSearchIndexerPath)) {
	const source = readFileSync(sessionSearchIndexerPath, "utf8");
	const original = 'const sessionsDir = path.join(os.homedir(), ".pi", "agent", "sessions");';
	const replacement =
		'const sessionsDir = process.env.FEYNMAN_SESSION_DIR ?? process.env.PI_SESSION_DIR ?? path.join(os.homedir(), ".pi", "agent", "sessions");';
	if (source.includes(original)) {
		writeFileSync(sessionSearchIndexerPath, source.replace(original, replacement), "utf8");
	}
}

const oauthPagePath = piAiRoot ? resolve(piAiRoot, "dist", "utils", "oauth", "oauth-page.js") : null;
const googleSharedPath = piAiRoot ? resolve(piAiRoot, "dist", "providers", "google-shared.js") : null;

if (oauthPagePath && existsSync(oauthPagePath)) {
	let source = readFileSync(oauthPagePath, "utf8");
	let changed = false;
	const target = `const LOGO_SVG = \`${FEYNMAN_LOGO_HTML}\`;`;
	if (!source.includes(target)) {
		source = source.replace(/const LOGO_SVG = `[^`]*`;/, target);
		changed = true;
	}
	if (changed) writeFileSync(oauthPagePath, source, "utf8");
}

if (googleSharedPath && existsSync(googleSharedPath)) {
	const source = readFileSync(googleSharedPath, "utf8");
	const patched = patchPiGoogleLegacySchemaSource(source);
	if (patched !== source) {
		writeFileSync(googleSharedPath, patched, "utf8");
	}
}

const alphaHubAuthPath = findPackageRoot("@companion-ai/alpha-hub")
	? resolve(findPackageRoot("@companion-ai/alpha-hub"), "src", "lib", "auth.js")
	: null;

if (alphaHubAuthPath && existsSync(alphaHubAuthPath)) {
	const source = readFileSync(alphaHubAuthPath, "utf8");
	const patched = patchAlphaHubAuthSource(source);
	if (patched !== source) {
		writeFileSync(alphaHubAuthPath, patched, "utf8");
	}
}

if (existsSync(piMemoryPath)) {
	let source = readFileSync(piMemoryPath, "utf8");
	const memoryOriginal = 'const MEMORY_DIR = join(homedir(), ".pi", "memory");';
	const memoryReplacement =
		'const MEMORY_DIR = process.env.FEYNMAN_MEMORY_DIR ?? process.env.PI_MEMORY_DIR ?? join(homedir(), ".pi", "memory");';
	if (source.includes(memoryOriginal)) {
		source = source.replace(memoryOriginal, memoryReplacement);
	}
	const execOriginal = 'const result = await pi.exec("pi", ["-p", prompt, "--print"], {';
	const execReplacement = [
		'const execBinary = process.env.FEYNMAN_NODE_EXECUTABLE || process.env.FEYNMAN_EXECUTABLE || "pi";',
		'      const execArgs = process.env.FEYNMAN_BIN_PATH',
		'        ? [process.env.FEYNMAN_BIN_PATH, "--prompt", prompt]',
		'        : ["-p", prompt, "--print"];',
		'      const result = await pi.exec(execBinary, execArgs, {',
	].join("\n");
	if (source.includes(execOriginal)) {
		source = source.replace(execOriginal, execReplacement);
	}
	writeFileSync(piMemoryPath, source, "utf8");
}
