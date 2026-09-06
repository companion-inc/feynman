import assert from "node:assert/strict";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readlinkSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

import {
	assertPiCliArgsPatchSource,
	assertPiCliArgsVersion,
	ensureLegacyPiRuntimeAliases,
	patchPiCliArgsSource,
} from "../scripts/lib/pi-cli-args-patch.mjs";
import { buildPiArgs } from "../src/pi/runtime.js";
import { patchPiRuntimeNodeModules } from "../src/pi/runtime-patches.js";

const installedArgsPath = resolve(
	process.cwd(),
	"node_modules",
	"@earendil-works",
	"pi-coding-agent",
	"dist",
	"cli",
	"args.js",
);

const REVIEWED_ARGS_FIXTURE = `export function parseArgs(args) {
    const result = {
        messages: [],
        fileArgs: [],
        unknownFlags: new Map(),
        diagnostics: [],
    };
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === "--help" || arg === "-h") {
            result.help = true;
        }
        else if (arg === "--print" || arg === "-p") {
            result.print = true;
            const next = args[i + 1];
            if (next !== undefined && !next.startsWith("@") && (!next.startsWith("-") || next.startsWith("---"))) {
                result.messages.push(next);
                i++;
            }
        }
        else if (arg.startsWith("@")) {
            result.fileArgs.push(arg.slice(1));
        }
        else if (arg.startsWith("--")) {
            result.unknownFlags.set(arg.slice(2), true);
        }
        else if (arg.startsWith("-") && !arg.startsWith("--")) {
            result.diagnostics.push({ type: "error", message: \`Unknown option: \${arg}\` });
        }
        else if (!arg.startsWith("-")) {
            result.messages.push(arg);
        }
    }
    return result;
}
`;

test("legacy Pi runtime aliases use rename-stable relative directory links", () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-pi-alias-repair-"));
	const nodeModulesRoot = join(root, "node_modules");
	const currentRoot = join(
		nodeModulesRoot,
		"@earendil-works",
		"pi-coding-agent",
	);
	const legacyRoot = join(
		nodeModulesRoot,
		"@mariozechner",
		"pi-coding-agent",
	);
	const manifest = `${JSON.stringify({
		name: "@earendil-works/pi-coding-agent",
		version: "0.84.2",
	})}\n`;
	try {
		mkdirSync(currentRoot, { recursive: true });
		writeFileSync(join(currentRoot, "package.json"), manifest);

		assert.equal(ensureLegacyPiRuntimeAliases(nodeModulesRoot), 1);
		assert.equal(readFileSync(join(legacyRoot, "package.json"), "utf8"), manifest);
		assert.equal(
			resolve(dirname(legacyRoot), readlinkSync(legacyRoot)),
			currentRoot,
		);
		assert.equal(ensureLegacyPiRuntimeAliases(nodeModulesRoot), 0);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("legacy Pi runtime alias repair refuses an unexpected link target", () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-pi-alias-target-"));
	const nodeModulesRoot = join(root, "node_modules");
	const currentRoot = join(
		nodeModulesRoot,
		"@earendil-works",
		"pi-coding-agent",
	);
	const legacyRoot = join(
		nodeModulesRoot,
		"@mariozechner",
		"pi-coding-agent",
	);
	try {
		mkdirSync(currentRoot, { recursive: true });
		writeFileSync(
			join(currentRoot, "package.json"),
			'{"name":"@earendil-works/pi-coding-agent","version":"0.84.2"}\n',
		);
		mkdirSync(resolve(legacyRoot, ".."), { recursive: true });
		symlinkSync("../unexpected-package", legacyRoot, "dir");

		assert.throws(
			() => ensureLegacyPiRuntimeAliases(nodeModulesRoot),
			/unexpected target/,
		);
		assert.equal(readlinkSync(legacyRoot), "../unexpected-package");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

function relocateExactPatchLoopIntoComment(source: string): string {
	const marker =
		"        // Feynman: support Pi's -- end-of-options delimiter for research prompts.";
	const loopPrefix = `    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
`;
	const patchedHelpAnchor =
		'        else if (arg === "--help" || arg === "-h") {';
	const markerIndex = source.indexOf(marker);
	const loopIndex = source.lastIndexOf(loopPrefix, markerIndex);
	const helpAnchorEnd =
		source.indexOf(patchedHelpAnchor, markerIndex)
		+ patchedHelpAnchor.length;
	assert.ok(markerIndex >= 0);
	assert.ok(loopIndex >= 0);
	assert.ok(helpAnchorEnd >= patchedHelpAnchor.length);
	const exactPatchBranch = source.slice(markerIndex, helpAnchorEnd);
	const exactLoopAndPatchBranch = source.slice(loopIndex, helpAnchorEnd);
	const drifted = source.replace(
		exactPatchBranch,
		`        if (arg === "--" && false) {
            break;
        }
        else if ((arg === "--help") || arg === "-h") {`,
	);
	return `${drifted}
/*
${exactLoopAndPatchBranch}
*/
`;
}

function writeInstalledPiCliCopy(
	piPackageRoot: string,
	source: string,
	version = "0.85.1",
): void {
	mkdirSync(join(piPackageRoot, "dist", "cli"), { recursive: true });
	writeFileSync(
		join(piPackageRoot, "package.json"),
		`${JSON.stringify({
			name: "@earendil-works/pi-coding-agent",
			version,
			type: "module",
		})}\n`,
	);
	writeFileSync(join(piPackageRoot, "dist", "cli", "args.js"), source);
}

async function verifyInstalledPiCliEndOfOptions(
	installedPackageRoot: string,
): Promise<void> {
	const verifier = await import(
		"../scripts/verify-installed-runtime.mjs"
	) as unknown as {
		verifyPiCliEndOfOptions(packageRoot: string): Promise<void>;
	};
	await verifier.verifyPiCliEndOfOptions(installedPackageRoot);
}

async function importInstalledParser(source: string) {
	const executableSource = source
		.replace(
			'import chalk from "chalk";',
			"const chalk = { bold: (value) => value };",
		)
		.replace(
			'import { APP_NAME, CONFIG_DIR_NAME, ENV_AGENT_DIR, ENV_SESSION_DIR } from "../config.js";',
			'const APP_NAME = "pi", CONFIG_DIR_NAME = ".pi", ENV_AGENT_DIR = "PI_AGENT_DIR", ENV_SESSION_DIR = "PI_SESSION_DIR";',
		);
	const url = `data:text/javascript;base64,${Buffer.from(executableSource).toString("base64")}#${Date.now()}`;
	return import(url) as Promise<{
		parseArgs(args: string[]): {
			messages: string[];
			fileArgs: string[];
			unknownFlags: Map<string, unknown>;
			diagnostics: unknown[];
			print?: boolean;
		};
	}>;
}

test("Pi CLI args patch matches installed 0.85.1 and is idempotent", () => {
	const source = readFileSync(installedArgsPath, "utf8");
	const patched = patchPiCliArgsSource(source);

	assertPiCliArgsPatchSource(patched, "installed Pi CLI args");
	assert.equal(patchPiCliArgsSource(patched), patched);
});

test("Pi CLI end-of-options preserves dash prompts, literal delimiters, and @files", async () => {
	const source = patchPiCliArgsSource(readFileSync(installedArgsPath, "utf8"));
	const { parseArgs } = await importInstalledParser(source);

	for (const prompt of [
		"- summarize the following points for me",
		"--answer my question briefly",
	]) {
		const parsed = parseArgs(["-p", "--", prompt]);
		assert.equal(parsed.print, true);
		assert.deepEqual(parsed.messages, [prompt]);
		assert.equal(parsed.unknownFlags.size, 0);
		assert.deepEqual(parsed.diagnostics, []);
	}

	const parsed = parseArgs([
		"--unknown-flag",
		"value",
		"--",
		"--provider",
		"openai",
		"-c",
		"--",
		"@prompt.md",
	]);
	assert.deepEqual(parsed.messages, ["--provider", "openai", "-c", "--"]);
	assert.deepEqual(parsed.fileArgs, ["prompt.md"]);
	assert.equal(parsed.unknownFlags.get("unknown-flag"), "value");
	assert.deepEqual(parsed.diagnostics, []);
});

test("Feynman launch arguments and patched Pi parser form one delimiter contract", async () => {
	const source = patchPiCliArgsSource(readFileSync(installedArgsPath, "utf8"));
	const { parseArgs } = await importInstalledParser(source);

	const oneShotPrompt = "--answer briefly";
	const oneShotArgs = buildPiArgs({
		appRoot: "/repo/feynman",
		workingDir: "/workspace",
		sessionDir: "/sessions",
		feynmanAgentDir: "/home/.feynman/agent",
		mode: "text",
		oneShotPrompt,
	});
	const oneShotParsed = parseArgs(oneShotArgs);
	assert.equal(oneShotParsed.print, true);
	assert.deepEqual(oneShotParsed.messages, [oneShotPrompt]);
	assert.equal(oneShotParsed.unknownFlags.size, 0);

	const initialPrompt = "- summarize these results";
	const initialArgs = buildPiArgs({
		appRoot: "/repo/feynman",
		workingDir: "/workspace",
		sessionDir: "/sessions",
		feynmanAgentDir: "/home/.feynman/agent",
		mode: "rpc",
		initialPrompt,
	});
	const initialParsed = parseArgs(initialArgs);
	assert.deepEqual(initialParsed.messages, [initialPrompt]);
	assert.equal(initialParsed.unknownFlags.size, 0);
});

test("Pi CLI args patch fails closed when patched behavior drifts", () => {
	const patched = patchPiCliArgsSource(REVIEWED_ARGS_FIXTURE);
	assert.throws(
		() =>
			patchPiCliArgsSource(
				patched.replace(
					"                    result.messages.push(positionalArg);",
					"                    result.messages.push(positionalArg.trim());",
				),
			),
		/exact ordered patch block|message write/,
	);
	assert.throws(
		() =>
			patchPiCliArgsSource(
				REVIEWED_ARGS_FIXTURE.replace(
					'        if (arg === "--help" || arg === "-h") {',
					'        if (arg === "--help") {',
				),
			),
		/unpatched help branch/,
	);
	assert.throws(
		() =>
			patchPiCliArgsSource(
				patched.replace(
					'        if (arg === "--") {',
					'        if (arg === "--") {\n            // reordered',
				),
			),
		/exact ordered patch block/,
	);
	assert.throws(
		() => patchPiCliArgsSource(`${patched}\n${patched}`),
		/parseArgs declaration|patch marker/,
	);
	assert.throws(
		() =>
			assertPiCliArgsPatchSource(
				relocateExactPatchLoopIntoComment(patched),
				"relocated-comment fixture",
			),
		/exact parseArgs loop|not executable inside parseArgs/,
	);
	for (const version of ["0.84.1", "0.84.3", undefined]) {
		assert.throws(
			() => assertPiCliArgsVersion(version, "test Pi"),
			/requires 0\.85\.1/,
		);
	}
	assert.doesNotThrow(() => assertPiCliArgsVersion("0.85.1", "test Pi"));
});

test("installed verifier preflights both exact Pi copies before executing either parser", async () => {
	const installedRoot = mkdtempSync(
		join(tmpdir(), "feynman-installed-pi-cli-verifier-"),
	);
	const packageRoots = [
		join(
			installedRoot,
			"node_modules",
			"@earendil-works",
			"pi-coding-agent",
		),
		join(
			installedRoot,
			".feynman",
			"npm",
			"node_modules",
			"@earendil-works",
			"pi-coding-agent",
		),
	];
	const executionKey =
		`__feynmanPiCliVerifierExecution${Date.now().toString(36)}`;
	const patched = patchPiCliArgsSource(REVIEWED_ARGS_FIXTURE);
	const instrumented = `globalThis[${JSON.stringify(executionKey)}] = (globalThis[${JSON.stringify(executionKey)}] ?? 0) + 1;\n${patched}`;
	try {
		writeInstalledPiCliCopy(packageRoots[0], instrumented);
		await assert.rejects(
			() => verifyInstalledPiCliEndOfOptions(installedRoot),
			/Installed Pi CLI package copy 2 is missing/,
		);
		assert.equal(
			(globalThis as Record<string, unknown>)[executionKey],
			undefined,
		);

		writeInstalledPiCliCopy(packageRoots[1], patched, "0.84.1");
		await assert.rejects(
			() => verifyInstalledPiCliEndOfOptions(installedRoot),
			/requires 0\.85\.1/,
		);
		assert.equal(
			(globalThis as Record<string, unknown>)[executionKey],
			undefined,
		);

		writeInstalledPiCliCopy(
			packageRoots[1],
			relocateExactPatchLoopIntoComment(patched),
		);
		await assert.rejects(
			() => verifyInstalledPiCliEndOfOptions(installedRoot),
			/exact parseArgs loop|not executable inside parseArgs/,
		);
		assert.equal(
			(globalThis as Record<string, unknown>)[executionKey],
			undefined,
		);

		writeInstalledPiCliCopy(packageRoots[1], patched);
		await verifyInstalledPiCliEndOfOptions(installedRoot);
		assert.equal(
			(globalThis as Record<string, unknown>)[executionKey],
			1,
		);
	} finally {
		delete (globalThis as Record<string, unknown>)[executionKey];
		rmSync(installedRoot, { recursive: true, force: true });
	}
});

test("launch-time Pi repair reaches root, generated, global, and agent-managed copies", () => {
	const appRoot = mkdtempSync(join(tmpdir(), "feynman-pi-cli-args-roots-"));
	const agentDir = join(appRoot, "agent-home", ".feynman");
	const globalNodeModules = process.platform === "win32"
		? join(appRoot, "agent-home", "npm-global", "node_modules")
		: join(appRoot, "agent-home", "npm-global", "lib", "node_modules");
	const nodeModulesRoots = [
		join(appRoot, "node_modules"),
		join(appRoot, ".feynman", "npm", "node_modules"),
		globalNodeModules,
		join(agentDir, "npm", "node_modules"),
	];
	try {
		const argsPaths = nodeModulesRoots.map((nodeModulesRoot) => {
			const packageRoot = join(
				nodeModulesRoot,
				"@earendil-works",
				"pi-coding-agent",
			);
			const argsPath = join(packageRoot, "dist", "cli", "args.js");
			mkdirSync(join(packageRoot, "dist", "cli"), { recursive: true });
			writeFileSync(
				join(packageRoot, "package.json"),
				`${JSON.stringify({
					name: "@earendil-works/pi-coding-agent",
					version: "0.85.1",
					piConfig: { name: "feynman", configDir: ".feynman" },
				})}\n`,
			);
			writeFileSync(argsPath, REVIEWED_ARGS_FIXTURE);
			return argsPath;
		});

		assert.equal(
			patchPiRuntimeNodeModules(appRoot, agentDir, process.platform),
			true,
		);
		for (const argsPath of argsPaths) {
			assertPiCliArgsPatchSource(readFileSync(argsPath, "utf8"), argsPath);
		}
		assert.equal(
			patchPiRuntimeNodeModules(appRoot, agentDir, process.platform),
			false,
		);
	} finally {
		rmSync(appRoot, { recursive: true, force: true });
	}
});

test("launch-time Pi repair preflights all managed copies before writing", () => {
	const appRoot = mkdtempSync(join(tmpdir(), "feynman-pi-cli-args-atomic-"));
	const agentDir = join(appRoot, "agent-home", ".feynman");
	const roots = [
		join(appRoot, "node_modules"),
		join(appRoot, ".feynman", "npm", "node_modules"),
		join(agentDir, "npm", "node_modules"),
	];
	try {
		const argsPaths = roots.map((nodeModulesRoot, index) => {
			const packageRoot = join(
				nodeModulesRoot,
				"@earendil-works",
				"pi-coding-agent",
			);
			const argsPath = join(packageRoot, "dist", "cli", "args.js");
			mkdirSync(join(packageRoot, "dist", "cli"), { recursive: true });
			writeFileSync(
				join(packageRoot, "package.json"),
				`${JSON.stringify({
					name: "@earendil-works/pi-coding-agent",
					version: index === 2 ? "0.84.1" : "0.85.1",
				})}\n`,
			);
			writeFileSync(
				argsPath,
				index === 1
					? REVIEWED_ARGS_FIXTURE.replace(
						'        if (arg === "--help" || arg === "-h") {',
						'        if (arg === "--help") {',
					)
					: REVIEWED_ARGS_FIXTURE,
			);
			return argsPath;
		});
		const before = argsPaths.map((path) => readFileSync(path, "utf8"));

		assert.throws(
			() => patchPiRuntimeNodeModules(appRoot, agentDir),
			/unpatched help branch/,
		);
		assert.deepEqual(
			argsPaths.map((path) => readFileSync(path, "utf8")),
			before,
			);

			writeFileSync(argsPaths[1], REVIEWED_ARGS_FIXTURE);
			assert.equal(patchPiRuntimeNodeModules(appRoot, agentDir), true);
			assertPiCliArgsPatchSource(readFileSync(argsPaths[0], "utf8"));
			assertPiCliArgsPatchSource(readFileSync(argsPaths[1], "utf8"));
			assert.equal(readFileSync(argsPaths[2], "utf8"), before[2]);

			writeFileSync(
				resolve(argsPaths[2], "../../..", "package.json"),
				`${JSON.stringify({
					name: "@earendil-works/pi-coding-agent",
					version: "0.85.1",
				})}\n`,
			);
			rmSync(argsPaths[0]);
			assert.throws(
				() => patchPiRuntimeNodeModules(appRoot, agentDir),
				/patch target is missing/,
			);
			assertPiCliArgsPatchSource(readFileSync(argsPaths[1], "utf8"));
			assert.equal(readFileSync(argsPaths[2], "utf8"), REVIEWED_ARGS_FIXTURE);
	} finally {
		rmSync(appRoot, { recursive: true, force: true });
	}
});

test("production and preparation scripts preflight Pi parsers before patch writes", () => {
	const installedPatcher = readFileSync(
		resolve(process.cwd(), "scripts", "patch-embedded-pi.mjs"),
		"utf8",
	);
	const rootPreflight = installedPatcher.indexOf(
		"const outerPiCliArgsPaths = preflightPiCliArgsPackageRoots([",
	);
	const packageSetup = installedPatcher.indexOf("ensurePackageWorkspace();");
	const workspacePreflight = installedPatcher.indexOf(
		"const piCliArgsPaths = preflightPiCliArgsPackageRoots([",
	);
	const firstPostSetupPatch = installedPatcher.indexOf(
		"function ensurePandoc()",
	);
	assert.ok(rootPreflight >= 0);
	assert.ok(packageSetup > rootPreflight);
	assert.ok(workspacePreflight > packageSetup);
	assert.ok(firstPostSetupPatch > workspacePreflight);
	assert.match(
		installedPatcher,
		/validateWorkspace: \(stagedWorkspaceDir\) => \{[\s\S]*ensureLegacyPiRuntimeAliases\([\s\S]*preflightPiCliArgsPackageRoots\([\s\S]*return workspaceMatchesRuntime\(/,
	);
	assert.match(
		installedPatcher,
		/patchFilesIfPresent\(piCliArgsPaths, patchPiCliArgsSource\)/,
	);
	assert.match(
		installedPatcher,
		/if \(!uniqueRoots\.has\(identity\)\) \{\s*uniqueRoots\.set\(identity, packageRoot\);\s*\}/,
	);

	const preparation = readFileSync(
		resolve(process.cwd(), "scripts", "prepare-runtime-workspace.mjs"),
		"utf8",
	);
	assert.match(
		preparation,
		/function collectBundledPiCliArgsCandidates\(\) \{\s*const candidates = \[\];[\s\S]*patched: patchPiCliArgsSource\(source\),[\s\S]*return candidates;/,
	);
	assert.match(
		preparation,
		/function patchBundledRuntime\([\s\S]*piCliArgsCandidates = collectBundledPiCliArgsCandidates\(\),[\s\S]*changed = patchBundledPiCliArgs\(piCliArgsCandidates\) \|\| changed;\s*changed = patchBundledPiCodingAgentPackageJson\(\)/,
	);
	assert.match(
		preparation,
		/const piCliArgsCandidates = collectBundledPiCliArgsCandidates\(\);\s*linkLegacyPiRuntimeAliases\(\);\s*patchBundledRuntime\(piCliArgsCandidates\)/,
	);
});
