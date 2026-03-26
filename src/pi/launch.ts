import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

import { buildPiArgs, buildPiEnv, type PiRuntimeOptions, resolvePiPaths } from "./runtime.js";
import { ensureSupportedNodeVersion } from "../system/node-version.js";

export async function launchPiChat(options: PiRuntimeOptions): Promise<void> {
	ensureSupportedNodeVersion();

	const { piCliPath, promisePolyfillPath, promisePolyfillSourcePath, tsxLoaderPath } = resolvePiPaths(options.appRoot);
	if (!existsSync(piCliPath)) {
		throw new Error(`Pi CLI not found: ${piCliPath}`);
	}

	const useBuiltPolyfill = existsSync(promisePolyfillPath);
	const useDevPolyfill = !useBuiltPolyfill && existsSync(promisePolyfillSourcePath) && existsSync(tsxLoaderPath);
	if (!useBuiltPolyfill && !useDevPolyfill) {
		throw new Error(`Promise polyfill not found: ${promisePolyfillPath}`);
	}

	if (process.stdout.isTTY) {
		process.stdout.write("\x1b[2J\x1b[3J\x1b[H");
	}

	const importArgs = useDevPolyfill
		? ["--import", tsxLoaderPath, "--import", promisePolyfillSourcePath]
		: ["--import", promisePolyfillPath];

	const child = spawn(process.execPath, [...importArgs, piCliPath, ...buildPiArgs(options)], {
		cwd: options.workingDir,
		stdio: "inherit",
		env: buildPiEnv(options),
	});

	await new Promise<void>((resolvePromise, reject) => {
		child.on("error", reject);
		child.on("exit", (code, signal) => {
			if (signal) {
				try {
					process.kill(process.pid, signal);
				} catch {
					process.exitCode = 1;
				}
				return;
			}
			process.exitCode = code ?? 0;
			resolvePromise();
		});
	});
}
