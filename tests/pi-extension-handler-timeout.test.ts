import assert from "node:assert/strict";
import {
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test, { type TestContext } from "node:test";
import { pathToFileURL } from "node:url";

import {
	assertPiExtensionHandlerTimeoutPatchSource,
	assertPiExtensionHandlerTimeoutVersion,
	PI_EXTENSION_HANDLER_TIMEOUT_MARKER,
	PI_EXTENSION_HANDLER_TIMEOUT_TARGET,
	patchPiExtensionHandlerTimeoutSource,
} from "../scripts/lib/pi-extension-handler-timeout-patch.mjs";
import {
	readArchiveEntry,
	RUNTIME_INPUT_FILES,
} from "../scripts/lib/runtime-workspace-integrity.mjs";
import {
	assertPiExtensionHandlerTimeoutArchive,
	assertPiExtensionHandlerTimeoutPackageTree,
} from "../scripts/lib/pi-extension-handler-timeout-verifier.mjs";

const appRoot = process.cwd();
const piCodingAgentRoot = resolve(
	appRoot,
	"node_modules",
	"@earendil-works",
	"pi-coding-agent",
);
const runnerPath = resolve(
	piCodingAgentRoot,
	...PI_EXTENSION_HANDLER_TIMEOUT_TARGET.split("/"),
);
const interactiveModePath = resolve(
	piCodingAgentRoot,
	"dist",
	"modes",
	"interactive",
	"interactive-mode.js",
);
const rpcModePath = resolve(
	piCodingAgentRoot,
	"dist",
	"modes",
	"rpc",
	"rpc-mode.js",
);
const testTimeoutMs = 25;

const OFFICIAL_TOOL_CALL_METHOD = `    async emitToolCall(event) {
        const ctx = this.createContext();
        let result;
        for (const ext of this.extensions) {
            const handlers = ext.handlers.get("tool_call");
            if (!handlers || handlers.length === 0)
                continue;
            for (const handler of handlers) {
                const handlerResult = await handler(event, ctx);
                if (handlerResult) {
                    result = handlerResult;
                    if (result.block) {
                        return result;
                    }
                }
            }
        }
        return result;
    }`;

const OFFICIAL_USER_BASH_METHOD = `    async emitUserBash(event) {
        const ctx = this.createContext();
        for (const ext of this.extensions) {
            const handlers = ext.handlers.get("user_bash");
            if (!handlers || handlers.length === 0)
                continue;
            for (const handler of handlers) {
                try {
                    const handlerResult = await handler(event, ctx);
                    if (handlerResult) {
                        return handlerResult;
                    }
                }
                catch (err) {
                    const message = err instanceof Error ? err.message : String(err);
                    const stack = err instanceof Error ? err.stack : undefined;
                    this.emitError({
                        extensionPath: ext.path,
                        event: "user_bash",
                        error: message,
                        stack,
                    });
                }
            }
        }
        return undefined;
    }`;

function readPiVersion(): string {
	const manifest = JSON.parse(
		readFileSync(resolve(piCodingAgentRoot, "package.json"), "utf8"),
	) as { version?: string };
	return manifest.version ?? "";
}

function extension(path: string, event: string, handlers: Array<(...args: any[]) => any>) {
	return {
		path,
		handlers: new Map([[event, handlers]]),
		tools: new Map(),
		commands: new Map(),
		shortcuts: new Map(),
		flags: new Map(),
		messageRenderers: new Map(),
		entryRenderers: new Map(),
	};
}

function runtime() {
	return {
		flagValues: new Map(),
		pendingProviderRegistrations: [],
		pendingNativeProviderRegistrations: [],
	};
}

function delay(ms: number): Promise<void> {
	return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function replaceRunnerMethod(
	source: string,
	methodName: string,
	nextMethodName: string,
	replacement: string,
): string {
	const startAnchor = `    async ${methodName}(`;
	const endAnchor = `\n    async ${nextMethodName}(`;
	const start = source.indexOf(startAnchor);
	const end = source.indexOf(endAnchor, start);
	assert.notEqual(start, -1, `missing ${methodName} method`);
	assert.notEqual(end, -1, `missing ${nextMethodName} boundary`);
	return `${source.slice(0, start)}${replacement}${source.slice(end)}`;
}

function restoreOfficialRunnerSource(source: string): string {
	if (!source.includes(PI_EXTENSION_HANDLER_TIMEOUT_MARKER)) {
		return source;
	}
	const helperStart = source.indexOf(
		`\n// ${PI_EXTENSION_HANDLER_TIMEOUT_MARKER}`,
	);
	const classStart = source.indexOf(
		"\nexport class ExtensionRunner {",
		helperStart,
	);
	assert.notEqual(helperStart, -1, "missing timeout helper start");
	assert.notEqual(classStart, -1, "missing ExtensionRunner after timeout helper");
	let restored = `${source.slice(0, helperStart)}${source.slice(classStart)}`;
	restored = replaceRunnerMethod(
		restored,
		"emitToolCall",
		"emitUserBash",
		OFFICIAL_TOOL_CALL_METHOD,
	);
	restored = replaceRunnerMethod(
		restored,
		"emitUserBash",
		"emitContext",
		OFFICIAL_USER_BASH_METHOD,
	);
	return restored
		.split("await runFeynmanExtensionHandler(handler, currentEvent, ctx)")
		.join("await handler(currentEvent, ctx)")
		.split("await runFeynmanExtensionHandler(handler, event, ctx)")
		.join("await handler(event, ctx)");
}

async function loadFastPatchedRunner(
	t: TestContext,
	timeoutMs = testTimeoutMs,
) {
	const root = mkdtempSync(join(tmpdir(), "feynman-pi-extension-timeout-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const pristine = restoreOfficialRunnerSource(
		readFileSync(runnerPath, "utf8"),
	);
	let source = patchPiExtensionHandlerTimeoutSource(pristine, readPiVersion());
	source = source
		.replace(
			'import { theme } from "../../modes/interactive/theme/theme.js";',
			"const theme = {};",
		)
		.replace(
			"const FEYNMAN_PI_EXTENSION_HANDLER_TIMEOUT_MS = 30000;",
			`const FEYNMAN_PI_EXTENSION_HANDLER_TIMEOUT_MS = ${timeoutMs};`,
		);
	const path = resolve(root, "runner.mjs");
	writeFileSync(path, source, "utf8");
	return import(`${pathToFileURL(path).href}?run=${Date.now()}-${Math.random()}`) as Promise<{
		ExtensionRunner: new (...args: any[]) => any;
		emitProjectTrustEvent: (...args: any[]) => Promise<any>;
	}>;
}

test("Pi 0.85.1 extension timeout patch is exact, idempotent, and fail closed", () => {
	assert.equal(readPiVersion(), "0.85.1");
	assert.doesNotThrow(() =>
		assertPiExtensionHandlerTimeoutVersion("0.85.1", "installed Pi"),
	);
	assert.throws(
		() => assertPiExtensionHandlerTimeoutVersion("0.84.3", "future Pi"),
		/requires Pi 0\.85\.1, found 0\.84\.3/,
	);

	const pristine = restoreOfficialRunnerSource(
		readFileSync(runnerPath, "utf8"),
	);
	const once = patchPiExtensionHandlerTimeoutSource(pristine, "0.85.1");
	const twice = patchPiExtensionHandlerTimeoutSource(once, "0.85.1");
	assert.equal(twice, once);
	assert.doesNotThrow(() =>
		assertPiExtensionHandlerTimeoutPatchSource(once, "patched runner"),
	);
	assert.match(once, new RegExp(PI_EXTENSION_HANDLER_TIMEOUT_MARKER));
	assert.equal(
		once.match(/runFeynmanExtensionHandler\(handler, (?:currentEvent|event), ctx\)/g)?.length,
		12,
	);
	assert.doesNotMatch(once, /await handler\((?:currentEvent|event), ctx\)/);
	assert.doesNotMatch(once, /sourceMappingURL/);
	assert.match(once, /const deadlineController = new AbortController\(\);/);
	assert.match(
		once,
		/OAuth provider login callbacks run outside ExtensionRunner emit paths/,
	);
	assert.match(
		once,
		/resolveInterruption\(\{ status: "timed-out" \}\);\s+deadlineController\.abort\(\);/,
	);
	assert.equal(once.match(/let deadlineBlocked = false;/g)?.length, 2);
	assert.match(
		once,
		/reason: "Extension handler timed out before tool execution"/,
	);
	assert.match(
		once,
		/output: "Bash command blocked because an extension policy handler timed out before execution\.\\n"/,
	);
	assert.match(
		once,
		/if \(interactiveDepth === 0\)\s+clearDeadline\(true\);/,
	);
	assert.match(
		once,
		/resolveInterruption\(\{ status: "parent-aborted" \}\);/,
	);
	assert.doesNotMatch(
		once,
		/super\(`Extension handler \$\{extensionPath\}/,
	);

	for (const mutation of [
		(source: string) => source.replace("handlerPromise.catch(() => {});", ""),
		(source: string) => source.replace("deadlineController.abort();", ""),
		(source: string) => source.replace("timedOut = true;", "timedOut = false;"),
		(source: string) => source.replace('    "confirm",\n', ""),
		(source: string) =>
			source.replace("clearDeadline(true);", "clearDeadline(false);"),
		(source: string) =>
			source.replace(
				'resolveInterruption({ status: "parent-aborted" });',
				'resolveInterruption({ status: "timed-out" });',
			),
		(source: string) =>
			source.replace(
				"if (handlerResult && !deadlineBlocked) {",
				"if (handlerResult) {",
			),
		(source: string) => source.replace("exitCode: 126,", "exitCode: 0,"),
		(source: string) =>
			source.replace(
				"await runFeynmanExtensionHandler(handler, event, ctx)",
				"await handler(event, ctx)",
			),
	]) {
		const drifted = mutation(once);
		assert.notEqual(drifted, once);
		assert.throws(
			() => assertPiExtensionHandlerTimeoutPatchSource(drifted, "drifted runner"),
			/Incomplete drifted runner patch/,
		);
		assert.throws(
			() => patchPiExtensionHandlerTimeoutSource(drifted, "0.85.1"),
			/Incomplete Pi extension runner patch/,
		);
		assert.throws(
			() => assertPiExtensionHandlerTimeoutPackageTree(() => drifted),
			/Incomplete bundled Pi extension runner patch/,
		);
		assert.throws(
			() => assertPiExtensionHandlerTimeoutArchive(() => drifted),
			/Incomplete runtime Pi extension runner patch/,
		);
	}
});

test("root, vendored, and archived Pi runners accept the same in-memory repair", () => {
	const archivePath = resolve(appRoot, ".feynman", "runtime-workspace.tgz");
	const surfaces = [
		{
			label: "root package",
			version: readPiVersion(),
			source: restoreOfficialRunnerSource(
				readFileSync(runnerPath, "utf8"),
			),
		},
		{
			label: "vendored package",
			version: (
				JSON.parse(
					readFileSync(
						resolve(
							appRoot,
							".feynman",
							"npm",
							"node_modules",
							"@earendil-works",
							"pi-coding-agent",
							"package.json",
						),
						"utf8",
					),
				) as { version?: string }
			).version ?? "",
			source: restoreOfficialRunnerSource(
				readFileSync(
					resolve(
						appRoot,
						".feynman",
						"npm",
						"node_modules",
						"@earendil-works",
						"pi-coding-agent",
						...PI_EXTENSION_HANDLER_TIMEOUT_TARGET.split("/"),
					),
					"utf8",
				),
			),
		},
		{
			label: "runtime archive",
			version: (
				JSON.parse(
					readArchiveEntry(
						archivePath,
						"npm/node_modules/@earendil-works/pi-coding-agent/package.json",
					) ?? "{}",
				) as { version?: string }
			).version ?? "",
			source: restoreOfficialRunnerSource(
				readArchiveEntry(
					archivePath,
					`npm/node_modules/@earendil-works/pi-coding-agent/${PI_EXTENSION_HANDLER_TIMEOUT_TARGET}`,
				) ?? "",
			),
		},
	];
	for (const surface of surfaces) {
		assert.equal(surface.version, "0.85.1", surface.label);
		const patched = patchPiExtensionHandlerTimeoutSource(
			surface.source,
			surface.version,
		);
		assert.doesNotThrow(() =>
			assertPiExtensionHandlerTimeoutPatchSource(patched, surface.label),
		);
		assert.equal(
			patchPiExtensionHandlerTimeoutSource(patched, surface.version),
			patched,
			surface.label,
		);
	}
});

test("all runtime and package surfaces wire and verify the timeout patch", () => {
	const prepareSource = readFileSync(
		resolve(appRoot, "scripts", "prepare-runtime-workspace.mjs"),
		"utf8",
	);
	const embeddedSource = readFileSync(
		resolve(appRoot, "scripts", "patch-embedded-pi.mjs"),
		"utf8",
	);
	const verifierSource = readFileSync(
		resolve(appRoot, "scripts", "verify-package-artifact.mjs"),
		"utf8",
	);
	const launchPatchSource = readFileSync(
		resolve(appRoot, "src", "pi", "runtime-patches.ts"),
		"utf8",
	);
	assert.ok(
		RUNTIME_INPUT_FILES.includes(
			"scripts/lib/pi-extension-handler-timeout-patch.mjs",
		),
	);
	assert.match(prepareSource, /patchPiExtensionHandlerTimeoutSource/);
	assert.match(prepareSource, /assertPiExtensionHandlerTimeoutVersion/);
	assert.match(prepareSource, /PI_EXTENSION_HANDLER_TIMEOUT_TARGET/);
	assert.match(
		embeddedSource,
		/patchPiExtensionHandlerTimeoutPackageRoot/,
	);
	assert.match(launchPatchSource, /patchPiExtensionHandlerTimeoutSource/);
	assert.match(launchPatchSource, /assertPiExtensionHandlerTimeoutVersion/);
	assert.match(launchPatchSource, /PI_EXTENSION_HANDLER_TIMEOUT_TARGET/);
	assert.match(
		verifierSource,
		/assertPiExtensionHandlerTimeoutPackageTree\(/,
	);
	assert.match(
		verifierSource,
		/pi-extension-handler-timeout-verifier\.mjs/,
	);
});

test("a hung handler aborts scoped work, reports safely, and cannot starve later handlers", async (t) => {
	const { ExtensionRunner } = await loadFastPatchedRunner(t);
	let downstreamCalls = 0;
	let cleanupAborts = 0;
	let expiredContextError: unknown;
	const errors: Array<{
		extensionPath: string;
		event: string;
		error: string;
	}> = [];
	const unhandled: unknown[] = [];
	const onUnhandled = (reason: unknown) => unhandled.push(reason);
	process.on("unhandledRejection", onUnhandled);
	t.after(() => process.off("unhandledRejection", onUnhandled));
	const parentController = new AbortController();

	const runner = new ExtensionRunner(
		[
			extension("private/hung-extension.ts", "before_agent_start", [
				async (_event, ctx) =>
					new Promise((_resolve, reject) => {
						ctx.signal.addEventListener(
							"abort",
							() => cleanupAborts++,
							{ once: true },
						);
						const ui = ctx.ui;
						setTimeout(() => {
							try {
								ui.notify("late");
							} catch (error) {
								expiredContextError = error;
							}
							reject(new Error("late handler rejection"));
						}, testTimeoutMs * 3);
					}),
			]),
			extension("downstream-extension.ts", "before_agent_start", [
				async () => {
					downstreamCalls++;
				},
			]),
		],
		runtime(),
		appRoot,
		{},
		{},
	);
	runner.getSignalFn = () => parentController.signal;
	runner.onError((error: any) => errors.push(error));

	const startedAt = Date.now();
	const result = await runner.emitBeforeAgentStart(
		"private research prompt",
		undefined,
		"private system prompt",
		{ cwd: appRoot },
	);
	const elapsedMs = Date.now() - startedAt;
	assert.ok(elapsedMs >= testTimeoutMs - 5, `elapsed ${elapsedMs}ms`);
	assert.ok(elapsedMs < 500, `elapsed ${elapsedMs}ms`);
	assert.equal(result, undefined);
	assert.equal(downstreamCalls, 1);
	assert.equal(cleanupAborts, 1);
	assert.equal(
		parentController.signal.aborted,
		false,
		"the handler deadline must not abort the owning agent signal",
	);
	assert.equal(errors.length, 1);
	assert.equal(errors[0]?.extensionPath, "private/hung-extension.ts");
	assert.equal(errors[0]?.event, "before_agent_start");
	assert.equal(errors[0]?.error, "Extension handler timed out after 25ms");
	assert.equal((errors[0] as { stack?: string }).stack, undefined);
	assert.doesNotMatch(errors[0]?.error ?? "", /private|prompt|system|feynman/i);

	await delay(testTimeoutMs * 4);
	assert.match(
		expiredContextError instanceof Error ? expiredContextError.message : "",
		/^Extension handler context expired after timeout$/,
	);
	assert.deepEqual(unhandled, []);
	assert.equal(errors.length, 1, "late rejection must not emit a second error");
});

test("the handler-scoped signal preserves caller aborts without waiting for the deadline", async (t) => {
	const { ExtensionRunner } = await loadFastPatchedRunner(t);
	const parentController = new AbortController();
	let observedAbort = false;
	let downstreamCalls = 0;
	const errors: unknown[] = [];
	const runner = new ExtensionRunner(
		[
			extension("abort-aware-extension.ts", "agent_start", [
				async (_event, ctx) => {
					await new Promise<void>((resolveAbort) => {
						if (ctx.signal.aborted) {
							observedAbort = true;
							resolveAbort();
							return;
						}
						ctx.signal.addEventListener("abort", () => {
							observedAbort = true;
							resolveAbort();
						}, { once: true });
					});
				},
			]),
			extension("after-abort-extension.ts", "agent_start", [
				async () => {
					downstreamCalls++;
				},
			]),
		],
		runtime(),
		appRoot,
		{},
		{},
	);
	runner.getSignalFn = () => parentController.signal;
	runner.onError((error: any) => errors.push(error));

	const emission = runner.emit({ type: "agent_start" });
	setTimeout(() => parentController.abort(), 5);
	await emission;

	assert.equal(observedAbort, true);
	assert.equal(downstreamCalls, 1);
	assert.deepEqual(errors, []);
});

test("a timed-out tool policy runs downstream handlers and still blocks execution", async (t) => {
	const { ExtensionRunner } = await loadFastPatchedRunner(t);
	let downstreamCalls = 0;
	let cleanupAborts = 0;
	const errors: Array<{
		extensionPath: string;
		event: string;
		error: string;
		stack?: string;
	}> = [];
	const runner = new ExtensionRunner(
		[
			extension("hung-tool-policy.ts", "tool_call", [
				async (_event, ctx) =>
					new Promise(() => {
						ctx.signal.addEventListener(
							"abort",
							() => cleanupAborts++,
							{ once: true },
						);
					}),
			]),
			extension("downstream-tool-policy.ts", "tool_call", [
				async () => {
					downstreamCalls++;
					return undefined;
				},
			]),
		],
		runtime(),
		appRoot,
		{},
		{},
	);
	runner.onError((error: any) => errors.push(error));

	const result = await runner.emitToolCall({
		type: "tool_call",
		toolName: "bash",
		toolCallId: "tool-timeout",
		input: { command: "printf secret" },
	});

	assert.equal(downstreamCalls, 1);
	assert.equal(cleanupAborts, 1);
	assert.deepEqual(result, {
		block: true,
		reason: "Extension handler timed out before tool execution",
	});
	assert.deepEqual(errors, [{
		extensionPath: "hung-tool-policy.ts",
		event: "tool_call",
		error: "Extension handler timed out after 25ms",
		stack: undefined,
	}]);
});

test("a timed-out user bash policy runs later handlers and blocks TUI and RPC execution", async (t) => {
	const { ExtensionRunner } = await loadFastPatchedRunner(t);
	let downstreamCalls = 0;
	let cleanupAborts = 0;
	const errors: Array<{
		extensionPath: string;
		event: string;
		error: string;
		stack?: string;
	}> = [];
	const runner = new ExtensionRunner(
		[
			extension("hung-user-bash-policy.ts", "user_bash", [
				async (_event, ctx) =>
					new Promise(() => {
						ctx.signal.addEventListener(
							"abort",
							() => cleanupAborts++,
							{ once: true },
						);
					}),
			]),
			extension("downstream-user-bash-policy.ts", "user_bash", [
				async () => {
					downstreamCalls++;
					return { operations: { exec: () => assert.fail("must not execute") } };
				},
			]),
		],
		runtime(),
		appRoot,
		{},
		{},
	);
	runner.onError((error: any) => errors.push(error));

	const eventResult = await runner.emitUserBash({
		type: "user_bash",
		command: "printf private-command",
		excludeFromContext: false,
		cwd: appRoot,
	});

	assert.equal(downstreamCalls, 1);
	assert.equal(cleanupAborts, 1);
	assert.deepEqual(eventResult, {
		result: {
			output:
				"Bash command blocked because an extension policy handler timed out before execution.\n",
			exitCode: 126,
			cancelled: false,
			truncated: false,
		},
	});
	assert.deepEqual(errors, [{
		extensionPath: "hung-user-bash-policy.ts",
		event: "user_bash",
		error: "Extension handler timed out after 25ms",
		stack: undefined,
	}]);
	assert.doesNotMatch(eventResult.result.output, /private-command/);

	// Both supported callers short-circuit on a full replacement result before
	// reaching their normal session.executeBash path.
	for (const [label, source, eventAnchor, executionAnchor] of [
		[
			"TUI",
			readFileSync(interactiveModePath, "utf8"),
			"const eventResult = await extensionRunner.emitUserBash",
			"this.session.executeBash(",
		],
		[
			"RPC",
			readFileSync(rpcModePath, "utf8"),
			"const eventResult = await session.extensionRunner.emitUserBash",
			"session.executeBash(",
		],
	] as const) {
		const eventStart = source.indexOf(eventAnchor);
		const shortCircuit = source.indexOf(
			"if (eventResult?.result)",
			eventStart,
		);
		const execution = source.indexOf(executionAnchor, shortCircuit);
		assert.notEqual(eventStart, -1, `${label} user_bash interception`);
		assert.ok(shortCircuit > eventStart, `${label} result short circuit`);
		assert.ok(execution > shortCircuit, `${label} normal execution path`);
		assert.match(
			source.slice(shortCircuit, execution),
			/\breturn(?:\s+success\([^;]+)?;/,
			`${label} must return before normal execution`,
		);
	}

	let tuiExecuted = false;
	let rpcExecuted = false;
	if (!eventResult?.result) tuiExecuted = true;
	if (!eventResult?.result) rpcExecuted = true;
	assert.equal(tuiExecuted, false);
	assert.equal(rpcExecuted, false);
});

test("interactive dialogs pause the remaining non-interactive budget instead of resetting it", async (t) => {
	const timeoutMs = 40;
	const { ExtensionRunner } = await loadFastPatchedRunner(t, timeoutMs);
	const workSliceMs = 24;
	const dialogMs = 80;
	let downstreamCalls = 0;
	let handlerCompleted = false;
	const errors: Array<{
		extensionPath: string;
		event: string;
		error: string;
		stack?: string;
	}> = [];
	const runner = new ExtensionRunner(
		[
			extension("cumulative-budget-extension.ts", "agent_start", [
				async (_event, ctx) => {
					await delay(workSliceMs);
					await ctx.ui.confirm("Continue?", "research");
					await delay(workSliceMs);
					handlerCompleted = true;
				},
			]),
			extension("after-cumulative-timeout.ts", "agent_start", [
				async () => {
					downstreamCalls++;
				},
			]),
		],
		runtime(),
		appRoot,
		{},
		{},
	);
	runner.setUIContext(
		{
			confirm: async () => {
				await delay(dialogMs);
				return true;
			},
		},
		"tui",
	);
	runner.onError((error: any) => errors.push(error));

	const startedAt = Date.now();
	await runner.emit({ type: "agent_start" });
	const elapsedMs = Date.now() - startedAt;

	assert.equal(handlerCompleted, false);
	assert.equal(downstreamCalls, 1);
	assert.ok(
		elapsedMs >= dialogMs + timeoutMs - 15,
		`elapsed ${elapsedMs}ms`,
	);
	assert.ok(elapsedMs < 2_000, `elapsed ${elapsedMs}ms`);
	assert.deepEqual(errors, [{
		extensionPath: "cumulative-budget-extension.ts",
		event: "agent_start",
		error: "Extension handler timed out after 40ms",
		stack: undefined,
	}]);

	await delay(workSliceMs * 2);
	assert.equal(handlerCompleted, true, "late handler settlement is absorbed");
});

test("parent abort settles a never-resolving dialog promptly and absorbs late rejection", async (t) => {
	const timeoutMs = 250;
	const { ExtensionRunner } = await loadFastPatchedRunner(t, timeoutMs);
	const parentController = new AbortController();
	let rejectDialog: ((error: Error) => void) | undefined;
	let resolveDialogStarted: (() => void) | undefined;
	const dialogStarted = new Promise<void>((resolveStarted) => {
		resolveDialogStarted = resolveStarted;
	});
	let downstreamCalls = 0;
	const errors: unknown[] = [];
	const unhandled: unknown[] = [];
	const onUnhandled = (reason: unknown) => unhandled.push(reason);
	process.on("unhandledRejection", onUnhandled);
	t.after(() => process.off("unhandledRejection", onUnhandled));

	const runner = new ExtensionRunner(
		[
			extension("hung-dialog-extension.ts", "agent_start", [
				async (_event, ctx) => {
					await ctx.ui.custom(
						() =>
							new Promise((_resolve, reject) => {
								rejectDialog = reject;
								resolveDialogStarted?.();
							}),
					);
				},
			]),
			extension("after-parent-abort.ts", "agent_start", [
				async () => {
					downstreamCalls++;
				},
			]),
		],
		runtime(),
		appRoot,
		{},
		{},
	);
	runner.setUIContext(
		{
			custom: (factory: (...args: any[]) => any) => factory(),
		},
		"tui",
	);
	runner.getSignalFn = () => parentController.signal;
	runner.onError((error: any) => errors.push(error));

	const emission = runner.emit({ type: "agent_start" });
	await dialogStarted;
	const abortedAt = Date.now();
	parentController.abort();
	await Promise.race([
		emission,
		delay(100).then(() => {
			throw new Error("parent abort did not settle the hung dialog promptly");
		}),
	]);
	const abortElapsedMs = Date.now() - abortedAt;

	assert.ok(abortElapsedMs < 100, `abort elapsed ${abortElapsedMs}ms`);
	assert.equal(downstreamCalls, 1);
	assert.deepEqual(errors, []);

	rejectDialog?.(new Error("late dialog rejection"));
	await delay(20);
	assert.deepEqual(unhandled, []);
});

test("project trust and tool permission dialogs suspend the handler deadline", async (t) => {
	const { ExtensionRunner, emitProjectTrustEvent } =
		await loadFastPatchedRunner(t);
	const interactiveDelay = testTimeoutMs * 3;
	const trustResult = await emitProjectTrustEvent(
		{
			extensions: [
				extension("trust-extension.ts", "project_trust", [
					async (_event, ctx) => ({
						trusted: (await ctx.ui.confirm("Trust?", "project"))
							? "yes"
							: "no",
						remember: true,
					}),
				]),
			],
		},
		{ type: "project_trust", cwd: appRoot },
		{
			cwd: appRoot,
			mode: "tui",
			hasUI: true,
			ui: {
				confirm: async () => {
					await delay(interactiveDelay);
					return true;
				},
			},
		},
	);
	assert.deepEqual(trustResult.errors, []);
	assert.deepEqual(trustResult.result, { trusted: "yes", remember: true });

	const runner = new ExtensionRunner(
		[
			extension("permission-extension.ts", "tool_call", [
				async (_event, ctx) => ({
					block: !(await ctx.ui.confirm("Allow?", "tool")),
					reason: "permission decision",
				}),
			]),
		],
		runtime(),
		appRoot,
		{},
		{},
	);
	runner.setUIContext(
		{
			confirm: async () => {
				await delay(interactiveDelay);
				return false;
			},
		},
		"tui",
	);
	const toolResult = await runner.emitToolCall({
		type: "tool_call",
		toolName: "bash",
		toolCallId: "tool-1",
		input: { command: "true" },
	});
	assert.deepEqual(toolResult, {
		block: true,
		reason: "permission decision",
	});
});
