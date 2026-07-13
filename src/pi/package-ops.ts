import { spawn } from "node:child_process";
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

import { DefaultPackageManager, SettingsManager } from "@earendil-works/pi-coding-agent";

import { resolveAdjacentNpmCommand } from "../../scripts/lib/npm-command.mjs";
import { NATIVE_PACKAGE_SOURCES, supportsNativePackageSources } from "./package-presets.js";

export { resolveAdjacentNpmCommand };
import { applyFeynmanPackageManagerEnv, getFeynmanNpmPrefixPath } from "./runtime.js";
import { patchPiRuntimeNodeModules } from "./runtime-patches.js";
import { getPathWithCurrentNode, resolveExecutable } from "../system/executables.js";

type PackageScope = "user" | "project";

type ConfiguredPackage = {
	source: string;
	scope: PackageScope;
	filtered: boolean;
	installedPath?: string;
};

type NpmSource = {
	name: string;
	source: string;
	spec: string;
	pinned: boolean;
};

type PackageManagerCommand = {
	command: string;
	args: string[];
	shell?: boolean;
};

export type MissingConfiguredPackageSummary = {
	missing: ConfiguredPackage[];
	bundled: ConfiguredPackage[];
};

export type InstallPackageSourcesResult = {
	installed: string[];
	skipped: string[];
};

export type UpdateConfiguredPackagesResult = {
	updated: string[];
	skipped: string[];
};

const FILTERED_INSTALL_OUTPUT_PATTERNS = [
	/npm warn deprecated node-domexception@1\.0\.0/i,
	/npm notice/i,
	/^(added|removed|changed) \d+ packages?( in .+)?$/i,
	/^(\d+ )?packages are looking for funding$/i,
	/^run `npm fund` for details$/i,
];
const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PI_RUNTIME_FALLBACK_VERSION = "0.80.3";
const LEGACY_PI_RUNTIME_PACKAGE_ALIASES = {
	"@mariozechner/pi-agent-core": "@earendil-works/pi-agent-core",
	"@mariozechner/pi-ai": "@earendil-works/pi-ai",
	"@mariozechner/pi-coding-agent": "@earendil-works/pi-coding-agent",
	"@mariozechner/pi-tui": "@earendil-works/pi-tui",
} as const;
const PI_RUNTIME_PEER_PACKAGE_NAMES = [
	"@earendil-works/pi-agent-core",
	"@earendil-works/pi-ai",
	"@earendil-works/pi-coding-agent",
	"@earendil-works/pi-tui",
	"@mariozechner/pi-agent-core",
	"@mariozechner/pi-ai",
	"@mariozechner/pi-coding-agent",
	"@mariozechner/pi-tui",
	"typebox",
] as const;
const FALLBACK_RUNTIME_PEER_SPECS: Partial<Record<(typeof PI_RUNTIME_PEER_PACKAGE_NAMES)[number], string>> = {
	"@earendil-works/pi-agent-core": `@earendil-works/pi-agent-core@${PI_RUNTIME_FALLBACK_VERSION}`,
	"@earendil-works/pi-ai": `@earendil-works/pi-ai@${PI_RUNTIME_FALLBACK_VERSION}`,
	"@earendil-works/pi-coding-agent": `@earendil-works/pi-coding-agent@${PI_RUNTIME_FALLBACK_VERSION}`,
	"@earendil-works/pi-tui": `@earendil-works/pi-tui@${PI_RUNTIME_FALLBACK_VERSION}`,
};

function createPackageContext(workingDir: string, agentDir: string) {
	applyFeynmanPackageManagerEnv(agentDir);
	process.env.PATH = getPathWithCurrentNode(process.env.PATH);
	const settingsManager = SettingsManager.create(workingDir, agentDir);
	const packageManager = new DefaultPackageManager({
		cwd: workingDir,
		agentDir,
		settingsManager,
	});

	return {
		settingsManager,
		packageManager,
	};
}

function shouldSkipNativeSource(source: string, version = process.versions.node): boolean {
	return !supportsNativePackageSources(version) && NATIVE_PACKAGE_SOURCES.includes(source as (typeof NATIVE_PACKAGE_SOURCES)[number]);
}

function filterUnsupportedSources(sources: string[], version = process.versions.node): { supported: string[]; skipped: string[] } {
	const supported: string[] = [];
	const skipped: string[] = [];

	for (const source of sources) {
		if (shouldSkipNativeSource(source, version)) {
			skipped.push(source);
			continue;
		}
		supported.push(source);
	}

	return { supported, skipped };
}

function relayFilteredOutput(chunk: Buffer | string, writer: NodeJS.WriteStream): void {
	const text = chunk.toString();
	for (const line of text.split(/\r?\n/)) {
		if (!line.trim()) continue;
		if (FILTERED_INSTALL_OUTPUT_PATTERNS.some((pattern) => pattern.test(line.trim()))) {
			continue;
		}
		writer.write(`${line}\n`);
	}
}

function parseNpmSource(source: string): NpmSource | undefined {
	if (!source.startsWith("npm:")) {
		return undefined;
	}

	const spec = source.slice("npm:".length).trim();
	const match = spec.match(/^(@?[^@]+(?:\/[^@]+)?)(?:@(.+))?$/);
	const name = match?.[1] ?? spec;
	const version = match?.[2];

	return {
		name,
		source,
		spec,
		pinned: Boolean(version),
	};
}

function dedupeNpmSources(sources: string[], updateToLatest: boolean): string[] {
	const specs = new Map<string, string>();

	for (const source of sources) {
		const parsed = parseNpmSource(source);
		if (!parsed) continue;

		specs.set(parsed.name, updateToLatest && !parsed.pinned ? `${parsed.name}@latest` : parsed.spec);
	}

	return [...specs.values()];
}

function parseNpmSpecName(spec: string): string {
	const match = spec.match(/^(@?[^@]+(?:\/[^@]+)?)(?:@.+)?$/);
	return match?.[1] ?? spec;
}

function isPiRuntimePackageName(packageName: string): boolean {
	return packageName.startsWith("pi-") || packageName.includes("/pi-");
}

function resolveRuntimePeerSpec(packageName: string): string | undefined {
	const aliasTarget = LEGACY_PI_RUNTIME_PACKAGE_ALIASES[packageName as keyof typeof LEGACY_PI_RUNTIME_PACKAGE_ALIASES];
	if (aliasTarget) {
		const targetSpec = resolveRuntimePeerSpec(aliasTarget);
		const targetVersion = targetSpec?.match(/@(\d+\.\d+\.\d+)$/)?.[1] ?? PI_RUNTIME_FALLBACK_VERSION;
		return `${packageName}@npm:${aliasTarget}@${targetVersion}`;
	}

	for (const packageRoot of [
		resolve(APP_ROOT, "node_modules", packageName),
		resolve(APP_ROOT, ".feynman", "npm", "node_modules", packageName),
	]) {
		try {
			const pkg = JSON.parse(readFileSync(resolve(packageRoot, "package.json"), "utf8")) as {
				name?: unknown;
				version?: unknown;
			};
			const version = typeof pkg.version === "string" ? pkg.version : undefined;
			if (!version) continue;
			const installedName = typeof pkg.name === "string" ? pkg.name : undefined;
			if (installedName && installedName !== packageName) {
				return `${packageName}@npm:${installedName}@${version}`;
			}
			return `${packageName}@${version}`;
		} catch {
			continue;
		}
	}

	return FALLBACK_RUNTIME_PEER_SPECS[packageName as (typeof PI_RUNTIME_PEER_PACKAGE_NAMES)[number]];
}

function withRuntimePeerSpecs(specs: string[]): string[] {
	if (!specs.some((spec) => isPiRuntimePackageName(parseNpmSpecName(spec)))) {
		return specs;
	}

	const existingPackageNames = new Set(specs.map(parseNpmSpecName));
	const peerSpecs = PI_RUNTIME_PEER_PACKAGE_NAMES
		.filter((packageName) => !existingPackageNames.has(packageName))
		.map(resolveRuntimePeerSpec)
		.filter((spec): spec is string => Boolean(spec));
	return [...specs, ...peerSpecs];
}

function ensureProjectInstallRoot(workingDir: string): string {
	const installRoot = resolve(workingDir, ".feynman", "npm");
	mkdirSync(installRoot, { recursive: true });

	const ignorePath = join(installRoot, ".gitignore");
	if (!existsSync(ignorePath)) {
		writeFileSync(ignorePath, "*\n!.gitignore\n", "utf8");
	}

	const packageJsonPath = join(installRoot, "package.json");
	if (!existsSync(packageJsonPath)) {
		writeFileSync(packageJsonPath, JSON.stringify({ name: "feynman-packages", private: true }, null, 2) + "\n", "utf8");
	}

	return installRoot;
}


function resolvePackageManagerCommand(settingsManager: SettingsManager): PackageManagerCommand | undefined {
	const configured = settingsManager.getNpmCommand();
	if (!configured || configured.length === 0) {
		const npmExecutable = resolveExecutable("npm");
		return resolveAdjacentNpmCommand() ?? (npmExecutable ? { command: npmExecutable, args: [] } : undefined);
	}

	const [command = "npm", ...args] = configured;
	if (!command) {
		return undefined;
	}

	const executable = resolveExecutable(command);
	if (!executable) {
		return undefined;
	}

	return {
		command: executable,
		args,
		shell: process.platform === "win32" && /\.(?:cmd|bat)$/i.test(executable),
	};
}

function childPackageManagerEnv(): NodeJS.ProcessEnv {
	return {
		...process.env,
		PATH: getPathWithCurrentNode(process.env.PATH),
		npm_config_dry_run: "false",
		NPM_CONFIG_DRY_RUN: "false",
	};
}

async function runPackageManagerInstall(
	settingsManager: SettingsManager,
	workingDir: string,
	agentDir: string,
	scope: PackageScope,
	specs: string[],
): Promise<void> {
	if (specs.length === 0) {
		return;
	}

	const packageManagerCommand = resolvePackageManagerCommand(settingsManager);
	if (!packageManagerCommand) {
		throw new Error("No supported package manager found. Install npm, pnpm, or bun, or configure `npmCommand`.");
	}

	const args = [
		...packageManagerCommand.args,
		"install",
		"--no-audit",
		"--no-fund",
		"--legacy-peer-deps",
		"--loglevel",
		"error",
	];

	if (scope === "user") {
		args.push("-g", "--prefix", getFeynmanNpmPrefixPath(agentDir));
	} else {
		args.push("--prefix", ensureProjectInstallRoot(workingDir));
	}

	args.push(...withRuntimePeerSpecs(specs));

	await new Promise<void>((resolvePromise, reject) => {
		const child = spawn(packageManagerCommand.command, args, {
			cwd: scope === "user" ? agentDir : workingDir,
			stdio: ["ignore", "pipe", "pipe"],
			env: childPackageManagerEnv(),
			shell: packageManagerCommand.shell,
		});

		child.stdout?.on("data", (chunk) => {
			relayFilteredOutput(chunk, process.stdout);
		});
		child.stderr?.on("data", (chunk) => {
			relayFilteredOutput(chunk, process.stderr);
		});

		child.on("error", reject);
		child.on("exit", (code) => {
			if ((code ?? 1) !== 0) {
				reject(new Error(`${packageManagerCommand.command} install failed with code ${code ?? 1}`));
				return;
			}

			resolvePromise();
		});
	});
}

function groupConfiguredNpmSources(packages: ConfiguredPackage[]): Record<PackageScope, string[]> {
	return {
		user: packages.filter((entry) => entry.scope === "user").map((entry) => entry.source),
		project: packages.filter((entry) => entry.scope === "project").map((entry) => entry.source),
	};
}

function patchInstalledPackageRoots(agentDir: string): void {
	patchPiRuntimeNodeModules(APP_ROOT, agentDir);
}

function isBundledWorkspacePackagePath(installedPath: string | undefined, appRoot: string): boolean {
	if (!installedPath) {
		return false;
	}

	const bundledRoot = resolve(appRoot, ".feynman", "npm", "node_modules");
	return installedPath.startsWith(bundledRoot);
}

export function getMissingConfiguredPackages(
	workingDir: string,
	agentDir: string,
	appRoot: string,
): MissingConfiguredPackageSummary {
	let { packageManager } = createPackageContext(workingDir, agentDir);
	let configured = packageManager.listConfiguredPackages();
	const missingUserNpmSources = configured
		.filter((entry) => entry.scope === "user" && !entry.installedPath && parseNpmSource(entry.source))
		.map((entry) => entry.source);
	const bundledSeeded = seedBundledWorkspacePackages(agentDir, appRoot, missingUserNpmSources);
	if (bundledSeeded.length > 0) {
		({ packageManager } = createPackageContext(workingDir, agentDir));
		configured = packageManager.listConfiguredPackages();
	}

	return configured.reduce<MissingConfiguredPackageSummary>(
		(summary, entry) => {
			if (entry.installedPath) {
				if (isBundledWorkspacePackagePath(entry.installedPath, appRoot)) {
					summary.bundled.push(entry);
				}
				return summary;
			}

			summary.missing.push(entry);
			return summary;
		},
		{ missing: [], bundled: [] },
	);
}

export async function installPackageSources(
	workingDir: string,
	agentDir: string,
	sources: string[],
	options?: { local?: boolean; persist?: boolean },
): Promise<InstallPackageSourcesResult> {
	const { settingsManager, packageManager } = createPackageContext(workingDir, agentDir);
	const scope: PackageScope = options?.local ? "project" : "user";
	const installed: string[] = [];

	const bundledSeeded = scope === "user" ? seedBundledWorkspacePackages(agentDir, APP_ROOT, sources) : [];
	installed.push(...bundledSeeded);
	const remainingSources = sources.filter((source) => !bundledSeeded.includes(source));
	const grouped = groupConfiguredNpmSources(
		remainingSources.map((source) => ({
			source,
			scope,
			filtered: false,
		})),
	);
	const { supported: supportedUserSources, skipped } = filterUnsupportedSources(grouped.user);
	const { supported: supportedProjectSources, skipped: skippedProject } = filterUnsupportedSources(grouped.project);
	skipped.push(...skippedProject);

	const supportedNpmSources = scope === "user" ? supportedUserSources : supportedProjectSources;
	if (supportedNpmSources.length > 0) {
		await runPackageManagerInstall(settingsManager, workingDir, agentDir, scope, dedupeNpmSources(supportedNpmSources, false));
		installed.push(...supportedNpmSources);
	}

	for (const source of sources) {
		if (parseNpmSource(source)) {
			continue;
		}

		await packageManager.install(source, { local: options?.local });
		installed.push(source);
	}

	if (options?.persist) {
		for (const source of installed) {
			if (packageManager.addSourceToSettings(source, { local: options?.local })) {
				continue;
			}
			skipped.push(source);
		}
		await settingsManager.flush();
	}

	if (installed.length > 0) {
		patchInstalledPackageRoots(agentDir);
	}

	return { installed, skipped };
}

export async function updateConfiguredPackages(
	workingDir: string,
	agentDir: string,
	source?: string,
): Promise<UpdateConfiguredPackagesResult> {
	const { settingsManager, packageManager } = createPackageContext(workingDir, agentDir);
	seedBundledWorkspacePackages(agentDir, APP_ROOT, []);

	if (source) {
		const parsed = parseNpmSource(source);
		if (parsed) {
			if (shouldSkipNativeSource(source)) {
				return { updated: [], skipped: [source] };
			}

			const configured = packageManager.listConfiguredPackages();
			const match = configured.find((entry) => entry.source === source);
			if (!match) {
				throw new Error(`No matching package found for ${source}`);
			}

			await runPackageManagerInstall(settingsManager, workingDir, agentDir, match.scope, dedupeNpmSources([source], true));
			patchInstalledPackageRoots(agentDir);
			return { updated: [source], skipped: [] };
		}

		await packageManager.update(source);
		patchInstalledPackageRoots(agentDir);
		return { updated: [source], skipped: [] };
	}

	const availableUpdates = await packageManager.checkForAvailableUpdates();
	if (availableUpdates.length === 0) {
		return { updated: [], skipped: [] };
	}

	const npmUpdatesByScope: Record<PackageScope, string[]> = { user: [], project: [] };
	const gitUpdates: string[] = [];
	const skipped: string[] = [];

	for (const entry of availableUpdates) {
		if (entry.type === "npm") {
			if (shouldSkipNativeSource(entry.source)) {
				skipped.push(entry.source);
				continue;
			}
			npmUpdatesByScope[entry.scope].push(entry.source);
			continue;
		}

		gitUpdates.push(entry.source);
	}

	for (const scope of ["user", "project"] as const) {
		const sources = npmUpdatesByScope[scope];
		if (sources.length === 0) continue;

		await runPackageManagerInstall(settingsManager, workingDir, agentDir, scope, dedupeNpmSources(sources, true));
	}

	for (const gitSource of gitUpdates) {
		await packageManager.update(gitSource);
	}

	const updated = availableUpdates
		.map((entry) => entry.source)
		.filter((source) => !skipped.includes(source));
	if (updated.length > 0) {
		patchInstalledPackageRoots(agentDir);
	}

	return { updated, skipped };
}

function ensureParentDir(path: string): void {
	mkdirSync(dirname(path), { recursive: true });
}

function pathsMatchSymlinkTarget(linkPath: string, targetPath: string): boolean {
	try {
		if (!lstatSync(linkPath).isSymbolicLink()) {
			return false;
		}
		return resolve(dirname(linkPath), readlinkSync(linkPath)) === targetPath;
	} catch {
		return false;
	}
}

function isPathInsideRoot(path: string, root: string): boolean {
	const relativePath = relative(root, path);
	return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function linkDirectory(linkPath: string, targetPath: string): void {
	if (pathsMatchSymlinkTarget(linkPath, targetPath)) {
		return;
	}

	try {
		if (existsSync(linkPath) && lstatSync(linkPath).isSymbolicLink()) {
			rmSync(linkPath, { force: true });
		}
	} catch {}

	if (existsSync(linkPath)) {
		return;
	}

	ensureParentDir(linkPath);
	try {
		symlinkSync(targetPath, linkPath, process.platform === "win32" ? "junction" : "dir");
	} catch {
		// Fallback for filesystems that do not allow symlinks.
		if (!existsSync(linkPath)) {
			cpSync(targetPath, linkPath, { recursive: true });
		}
	}
}

function packageNameToPath(root: string, packageName: string): string {
	return resolve(root, packageName);
}

function listBundledWorkspacePackageNames(root: string): string[] {
	if (!existsSync(root)) {
		return [];
	}

	const names: string[] = [];
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

function removeEmptyScopeDirectory(packagePath: string, packageName: string, globalNodeModulesRoot: string): void {
	if (!packageName.startsWith("@")) {
		return;
	}

	const scopePath = dirname(packagePath);
	if (!isPathInsideRoot(scopePath, globalNodeModulesRoot) || !existsSync(scopePath)) {
		return;
	}
	if (readdirSync(scopePath).length > 0) {
		return;
	}

	rmSync(scopePath, { recursive: true, force: true });
}

function pruneStaleBundledPackageLinks(
	globalNodeModulesRoot: string,
	bundledNodeModulesRoot: string,
	bundledPackageNames: string[],
): void {
	if (!existsSync(globalNodeModulesRoot)) {
		return;
	}

	const currentBundledPackages = new Set(bundledPackageNames);
	for (const packageName of listBundledWorkspacePackageNames(globalNodeModulesRoot)) {
		const packagePath = resolve(globalNodeModulesRoot, packageName);
		let linkedTarget: string;
		try {
			if (!lstatSync(packagePath).isSymbolicLink()) {
				continue;
			}
			linkedTarget = resolve(dirname(packagePath), readlinkSync(packagePath));
		} catch {
			continue;
		}
		if (!isPathInsideRoot(linkedTarget, bundledNodeModulesRoot)) {
			continue;
		}
		if (currentBundledPackages.has(packageName) && existsSync(linkedTarget)) {
			continue;
		}

		unlinkSync(packagePath);
		removeEmptyScopeDirectory(packagePath, packageName, globalNodeModulesRoot);
	}
}

function packageDependencyExists(packagePath: string, globalNodeModulesRoot: string, dependency: string): boolean {
	return existsSync(packageNameToPath(resolve(packagePath, "node_modules"), dependency)) ||
		existsSync(packageNameToPath(globalNodeModulesRoot, dependency));
}

function installedPackageLooksUsable(packagePath: string, globalNodeModulesRoot: string): boolean {
	if (!existsSync(resolve(packagePath, "package.json"))) {
		return false;
	}

	try {
		const pkg = JSON.parse(readFileSync(resolve(packagePath, "package.json"), "utf8")) as {
			dependencies?: Record<string, string>;
		};
		const dependencies = Object.keys(pkg.dependencies ?? {});
		return dependencies.every((dependency) => packageDependencyExists(packagePath, globalNodeModulesRoot, dependency));
	} catch {
		return false;
	}
}

function packageJsonMatchesBundledCopy(packagePath: string, bundledPackagePath: string): boolean {
	try {
		return readFileSync(resolve(packagePath, "package.json"), "utf8") ===
			readFileSync(resolve(bundledPackagePath, "package.json"), "utf8");
	} catch {
		return false;
	}
}

function replaceBrokenPackageWithBundledCopy(targetPath: string, bundledPackagePath: string, globalNodeModulesRoot: string): boolean {
	if (!existsSync(targetPath)) {
		return false;
	}
	if (pathsMatchSymlinkTarget(targetPath, bundledPackagePath)) {
		return false;
	}
	if (installedPackageLooksUsable(targetPath, globalNodeModulesRoot)) {
		return false;
	}

	rmSync(targetPath, { recursive: true, force: true });
	linkDirectory(targetPath, bundledPackagePath);
	return true;
}

function seedBundledPackage(globalNodeModulesRoot: string, bundledNodeModulesRoot: string, packageName: string): boolean {
	const bundledPackagePath = resolve(bundledNodeModulesRoot, packageName);
	if (!existsSync(bundledPackagePath)) {
		return false;
	}

	const targetPath = resolve(globalNodeModulesRoot, packageName);
	if (replaceBrokenPackageWithBundledCopy(targetPath, bundledPackagePath, globalNodeModulesRoot)) {
		return true;
	}
	if (!existsSync(targetPath)) {
		linkDirectory(targetPath, bundledPackagePath);
		return true;
	}
	return false;
}

export function seedBundledWorkspacePackages(
	agentDir: string,
	appRoot: string,
	sources: string[],
): string[] {
	const bundledNodeModulesRoot = resolve(appRoot, ".feynman", "npm", "node_modules");
	if (!existsSync(bundledNodeModulesRoot)) {
		return [];
	}

	const globalNodeModulesRoot = resolve(getFeynmanNpmPrefixPath(agentDir), "lib", "node_modules");
	const seeded: string[] = [];
	const bundledPackageNames = listBundledWorkspacePackageNames(bundledNodeModulesRoot);
	const newlySeededPackageNames = new Set<string>();
	pruneStaleBundledPackageLinks(globalNodeModulesRoot, bundledNodeModulesRoot, bundledPackageNames);
	for (const packageName of bundledPackageNames) {
		if (seedBundledPackage(globalNodeModulesRoot, bundledNodeModulesRoot, packageName)) {
			newlySeededPackageNames.add(packageName);
		}
	}

	for (const source of sources) {
		if (shouldSkipNativeSource(source)) continue;

		const parsed = parseNpmSource(source);
		if (!parsed) continue;

		const targetPath = resolve(globalNodeModulesRoot, parsed.name);
		const bundledPackagePath = resolve(bundledNodeModulesRoot, parsed.name);
		if (
			newlySeededPackageNames.has(parsed.name) ||
			pathsMatchSymlinkTarget(targetPath, bundledPackagePath) ||
			packageJsonMatchesBundledCopy(targetPath, bundledPackagePath)
		) {
			seeded.push(source);
		}
	}

	return seeded;
}
