import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { constants } from "node:os";

import { buildPiArgs, buildPiEnv, type PiRuntimeOptions, resolvePiPaths, toNodeImportSpecifier } from "./runtime.js";
import { patchPiRuntimeNodeModules } from "./runtime-patches.js";
import { ensureSupportedNodeVersion } from "../system/node-version.js";
import { resolveAllExecutables } from "../system/executables.js";

export function exitCodeFromSignal(signal: NodeJS.Signals): number {
	const signalNumber = constants.signals[signal];
	return typeof signalNumber === "number" ? 128 + signalNumber : 1;
}

export async function launchPiChat(options: PiRuntimeOptions): Promise<void> {
	ensureSupportedNodeVersion();
	patchPiRuntimeNodeModules(options.appRoot);

	const paths = resolvePiPaths(options.appRoot);
	const {
		piCliPath,
		piMainPath,
		piCliWrapperPath,
		piCliWrapperSourcePath,
		promisePolyfillPath,
		promisePolyfillSourcePath,
		tsxLoaderPath,
	} = paths;
	if (!existsSync(piCliPath)) {
		throw new Error(`Pi CLI not found: ${piCliPath}`);
	}
	if (!existsSync(piMainPath)) {
		throw new Error(`Pi main module not found: ${piMainPath}`);
	}

	const useBuiltPolyfill = existsSync(promisePolyfillPath);
	const useDevPolyfill = !useBuiltPolyfill && existsSync(promisePolyfillSourcePath) && existsSync(tsxLoaderPath);
	if (!useBuiltPolyfill && !useDevPolyfill) {
		throw new Error(`Promise polyfill not found: ${promisePolyfillPath}`);
	}

	const useBuiltWrapper = existsSync(piCliWrapperPath);
	const useDevWrapper = !useBuiltWrapper && existsSync(piCliWrapperSourcePath) && existsSync(tsxLoaderPath);
	if (!useBuiltWrapper && !useDevWrapper) {
		throw new Error(`Feynman Pi CLI wrapper not found: ${piCliWrapperPath}`);
	}

	if (process.stdout.isTTY && options.mode !== "rpc") {
		process.stdout.write("\x1b[2J\x1b[3J\x1b[H");
	}

	if (options.preLaunchNotice) {
		process.stdout.write(`${options.preLaunchNotice}\n`);
	}

	const wrapperPath = useBuiltWrapper ? piCliWrapperPath : piCliWrapperSourcePath;
	const importArgs = useDevPolyfill
		? ["--import", toNodeImportSpecifier(tsxLoaderPath), "--import", toNodeImportSpecifier(promisePolyfillSourcePath)]
		: ["--import", toNodeImportSpecifier(promisePolyfillPath)];
	const executables = await resolveAllExecutables();

	const child = spawn(process.execPath, [...importArgs, wrapperPath, piMainPath, ...buildPiArgs(options, paths)], {
		cwd: options.workingDir,
		stdio: "inherit",
		env: buildPiEnv(options, paths, executables),
	});

	await new Promise<void>((resolvePromise, reject) => {
		child.on("error", reject);
		child.on("exit", (code, signal) => {
			if (signal) {
				console.error(`feynman terminated because the Pi child exited with ${signal}.`);
				process.exitCode = exitCodeFromSignal(signal);
				resolvePromise();
				return;
			}
			process.exitCode = code ?? 0;
			resolvePromise();
		});
	});
}
