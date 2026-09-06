import { existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { validateRuntimePlatformPruning } from "./lib/runtime-platform-pruning.mjs";

const root = resolve(process.argv[2] ?? ".");
const nodeModulesDir = resolve(root, "node_modules");

const STRIP_FILE_PATTERNS = [
	/\.map$/i,
	/\.d\.cts$/i,
	/\.d\.ts$/i,
	/^README(\..+)?\.md$/i,
	/^CHANGELOG(\..+)?\.md$/i,
];

function safeStat(path) {
	try {
		return statSync(path);
	} catch {
		return null;
	}
}

function removePath(path) {
	rmSync(path, { recursive: true, force: true });
}

function walkAndPrune(dir) {
	if (!existsSync(dir)) return;

	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		const stats = entry.isSymbolicLink() ? safeStat(path) : null;
		const isDirectory = entry.isDirectory() || stats?.isDirectory();
		const isFile = entry.isFile() || stats?.isFile();

		if (isDirectory) {
			walkAndPrune(path);
			continue;
		}

		if (isFile && STRIP_FILE_PATTERNS.some((pattern) => pattern.test(entry.name))) {
			removePath(path);
		}
	}
}

function currentKoffiVariant() {
	if (process.platform === "darwin" && process.arch === "arm64") return "darwin_arm64";
	if (process.platform === "darwin" && process.arch === "x64") return "darwin_x64";
	if (process.platform === "linux" && process.arch === "arm64") return "linux_arm64";
	if (process.platform === "linux" && process.arch === "x64") return "linux_x64";
	if (process.platform === "win32" && process.arch === "arm64") return "win32_arm64";
	if (process.platform === "win32" && process.arch === "x64") return "win32_x64";
	return null;
}

function pruneKoffi(nodeModulesRoot) {
	const koffiRoot = join(nodeModulesRoot, "koffi");
	if (!existsSync(koffiRoot)) return;

	for (const dirName of ["doc", "src", "vendor"]) {
		removePath(join(koffiRoot, dirName));
	}

	const buildRoot = join(koffiRoot, "build", "koffi");
	if (!existsSync(buildRoot)) return;

	const keep = currentKoffiVariant();
	for (const entry of readdirSync(buildRoot, { withFileTypes: true })) {
		if (entry.name === keep) continue;
		removePath(join(buildRoot, entry.name));
	}
}

function pruneBetterSqlite3(nodeModulesRoot) {
	const pkgRoot = join(nodeModulesRoot, "better-sqlite3");
	if (!existsSync(pkgRoot)) return;

	removePath(join(pkgRoot, "deps"));
	removePath(join(pkgRoot, "src"));
	removePath(join(pkgRoot, "binding.gyp"));

	const buildRoot = join(pkgRoot, "build");
	const releaseRoot = join(buildRoot, "Release");
	if (existsSync(releaseRoot)) {
		for (const entry of readdirSync(releaseRoot, { withFileTypes: true })) {
			if (entry.name === "better_sqlite3.node") continue;
			removePath(join(releaseRoot, entry.name));
		}
	}

	for (const entry of ["Makefile", "binding.Makefile", "config.gypi", "deps", "gyp-mac-tool", "test_extension.target.mk", "better_sqlite3.target.mk"]) {
		removePath(join(buildRoot, entry));
	}
}

function pruneLiteparse(nodeModulesRoot) {
	const pkgRoot = join(nodeModulesRoot, "@llamaindex", "liteparse");
	if (!existsSync(pkgRoot)) return;
	if (existsSync(join(pkgRoot, "dist"))) {
		removePath(join(pkgRoot, "src"));
	}
}

function prunePiCodingAgent(nodeModulesRoot) {
	for (const scope of ["@earendil-works", "@mariozechner"]) {
		const pkgRoot = join(nodeModulesRoot, scope, "pi-coding-agent");
		if (!existsSync(pkgRoot)) continue;
		removePath(join(pkgRoot, "docs"));
		removePath(join(pkgRoot, "examples"));
	}
}

function pruneMermaid(nodeModulesRoot) {
	const pkgRoot = join(nodeModulesRoot, "mermaid", "dist");
	if (!existsSync(pkgRoot)) return;
	removePath(join(pkgRoot, "docs"));
	removePath(join(pkgRoot, "tests"));
	removePath(join(pkgRoot, "__mocks__"));
}

if (!existsSync(nodeModulesDir)) {
	process.exit(0);
}

const platformKind = process.argv.includes("--platform-runtime") ? "runtime"
	: process.argv.includes("--platform-native") ? "native" : undefined;
if (platformKind) {
	const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
	// Validate the whole owned staging tree before the first deletion. The
	// universal npm root never opts into this target-specific pruning.
	const plan = validateRuntimePlatformPruning(root, lock, {
		kind: platformKind, platform: process.platform, arch: process.arch,
	});
	for (const relativePath of plan.remove) removePath(join(plan.workspacePath, relativePath));
}

walkAndPrune(nodeModulesDir);
pruneKoffi(nodeModulesDir);
pruneBetterSqlite3(nodeModulesDir);
pruneLiteparse(nodeModulesDir);
prunePiCodingAgent(nodeModulesDir);
pruneMermaid(nodeModulesDir);

console.log(`[feynman] pruned runtime deps in ${basename(root)}`);
