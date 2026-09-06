import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

// Committed helper uses the real default ChildSession
// factory, a hook-registered offline provider, and actual research-tools.ts.
// No session factory injection, shared runtime writes, or provider credentials.
const root = process.cwd();
const worker = resolve(root, "tests/helpers/pi-subagents-native-child.mjs");
const runtimeRoot = resolve(root, ".feynman/npm/node_modules");

function isolatedEnvironment(home: string, host: string, mode: string): NodeJS.ProcessEnv {
	// Do not copy process.env: CI/developer credentials and provider overrides
	// must not enter this process. Retain only Windows OS locations when needed.
	const systemRoot = process.env.SystemRoot ?? process.env.SYSTEMROOT;
	const osEnvironment = process.platform === "win32" && systemRoot
		? { SystemRoot: systemRoot, WINDIR: systemRoot,
			ComSpec: join(systemRoot, "System32", "cmd.exe") }
		: {};
	return {
		...osEnvironment,
		PATH: [dirname(process.execPath),
			...(process.platform === "win32"
				? (systemRoot ? [join(systemRoot, "System32"), systemRoot] : [])
				: ["/usr/bin", "/bin"])].join(delimiter),
		HOME: home, USERPROFILE: home,
		APPDATA: join(home, "AppData/Roaming"), LOCALAPPDATA: join(home, "AppData/Local"),
		XDG_CONFIG_HOME: join(home, ".config"), XDG_CACHE_HOME: join(home, ".cache"),
		XDG_DATA_HOME: join(home, ".local/share"),
		TMPDIR: home, TMP: home, TEMP: home,
		PI_CODING_AGENT_DIR: join(home, ".pi/agent"),
		PI_TELEMETRY_ENABLED: "false", DO_NOT_TRACK: "1",
		PROOF_ROOT: root, PROOF_HOST: host, PROOF_MODE: mode,
	};
}
for (const host of ["runner", "parent"]) {
	for (const mode of ["valid", "wrong", "wrong-end"]) {
		test(`real SDK ChildSession ${host} plan ${mode}: research tools and pre-tool identity`, () => {
			const home = mkdtempSync(join(tmpdir(), "feynman-child-offline-"));
			try {
				const run = spawnSync(process.execPath, [
					"--import", pathToFileURL(resolve(root, "node_modules/tsx/dist/loader.mjs")).href, worker,
				], {
					cwd: root, encoding: "utf8", timeout: 45000,
					env: isolatedEnvironment(home, host, mode),
				});
				assert.ifError(run.error);
				assert.equal(run.status, 0, run.stderr + run.stdout);
				const line = run.stdout.split("\n").find(value => value.startsWith("PROOF_JSON="));
				assert.ok(line, run.stdout);
				const proof = JSON.parse(line.slice("PROOF_JSON=".length));
				assert.equal(proof.fatal, undefined, proof.fatal);
				assert.equal(proof.network, 0);
				assert.deepEqual(proof.errors, []);
				assert.equal(proof.codingAgentEntry,
					join(runtimeRoot, "@earendil-works/pi-coding-agent/dist/index.js"));
				assert.ok(proof.extensionPaths.includes(resolve(root, "extensions/research-tools.ts")));
				assert.ok(proof.settingsExtensions.includes(resolve(root, "extensions/research-tools.ts")));
				for (const tool of ["hf_dataset_info", "hf_repo_files", "hf_repo_read_file"]) {
					assert.ok(proof.registered.includes(tool), `${tool} registration missing`);
					assert.ok(proof.active.includes(tool), `${tool} inactive`);
				}
				if (mode === "valid") {
					assert.equal(proof.result.exitCode, 0);
					assert.equal(proof.sideEffects, 1);
					assert.equal(proof.calls, 2);
					assert.ok(proof.events.includes("tool_execution_start"));
				} else {
					assert.equal(proof.result.exitCode, 1);
					assert.match(proof.result.error, /^model_verification_failed:/);
					assert.equal(proof.sideEffects, 0);
					assert.equal(proof.calls, 1);
					assert.ok(!proof.events.includes("tool_execution_start"));
				}
			} finally {
				rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
			}
		});
	}
}

test("offline worker cannot accidentally replace the ChildSession factory", () => {
	const source = readFileSync(worker, "utf8");
	assert.match(source, /factory=createDefaultChildSessionFactory\(\)/);
	assert.doesNotMatch(source, /setChildSessionFactory|loadPiCodingAgent:/);
	assert.match(source, /net\.Socket\.prototype\.connect=blocked/);
});

test("real installed host aliases are complete for root and generated native background launches", async () => {
	const source = pathToFileURL(join(runtimeRoot, "pi-subagents/src/runs/background/runner-aliases.ts"));
	const { resolveHostPeerAliases } = await import(source.href) as {
		resolveHostPeerAliases(root: string): { aliases: Record<string, string>; missing: string[] };
	};
	for (const packageRoot of [
		resolve(root, "node_modules/@earendil-works/pi-coding-agent"),
		join(runtimeRoot, "@earendil-works/pi-coding-agent"),
	]) {
		const result = resolveHostPeerAliases(packageRoot);
		assert.deepEqual(result.missing, [],
			`Native background spawn would reject ${packageRoot}: ${result.missing.join(", ")}`);
		assert.equal(result.aliases["@earendil-works/pi-coding-agent"], join(packageRoot, "dist/index.js"),
			"native children must use the patched modular SDK, not bundled rpc-entry");
	}
});

for (const mode of ["valid", "wrong"]) {
	test(`production detached runner ${mode}: real startup and child completion`, () => {
		const home = mkdtempSync(join(tmpdir(), "feynman-detached-offline-"));
		try {
			const environment = isolatedEnvironment(home, "runner", mode);
			environment.PI_SUBAGENTS_TEMP_ROOT = join(home, "runs");
			// Inherited by the production spawnRunner child, unlike a guard
			// installed only in this test process.
			environment.NODE_OPTIONS = `--import=${pathToFileURL(resolve(root,
				"tests/helpers/pi-subagents-detached-network.mjs")).href}`;
			const run = spawnSync(process.execPath, [
				"--import", pathToFileURL(resolve(root, "node_modules/tsx/dist/loader.mjs")).href,
				resolve(root, "tests/helpers/pi-subagents-detached-driver.mjs"),
			], { cwd: root, encoding: "utf8", timeout: 65000, env: environment });
			assert.ifError(run.error);
			assert.equal(run.status, 0, run.stderr + run.stdout);
			const line = run.stdout.split("\n").find(value => value.startsWith("DETACHED_JSON="));
			assert.ok(line, run.stdout);
			const proof = JSON.parse(line.slice("DETACHED_JSON=".length));
			assert.equal(proof.fatal, undefined, proof.fatal);
			assert.notEqual(proof.pid, proof.driverPid, "must execute in a real detached runner process");
			assert.equal(proof.exited, true, "runner must exit before test cleanup");
			assert.equal(proof.proceedConsumed, true, "real runner must consume its startup authorization");
			assert.equal(proof.start.isError, undefined);
			assert.equal(proof.final.launchContractDigest, proof.start.details.launchContractDigest);
			assert.equal(proof.network.filter((event: { type: string }) => event.type === "blocked-network").length, 0);
			assert.ok(proof.network.some((event: { type: string; pid: number }) =>
				event.type === "network-guard-loaded" && event.pid === proof.pid));
			const registered = proof.provider.find((event: { type: string }) => event.type === "registered");
			assert.ok(registered);
			assert.equal(registered.pid, proof.pid);
			for (const tool of ["hf_dataset_info", "hf_repo_files", "hf_repo_read_file"]) {
				assert.ok(registered.tools.includes(tool), `${tool} not registered in detached process`);
				assert.ok(registered.active.includes(tool), `${tool} not active in detached process`);
			}
			const effects = proof.provider.filter((event: { type: string }) => event.type === "side-effect");
			const calls = proof.provider.filter((event: { type: string }) => event.type === "provider-call");
			if (mode === "valid") {
				assert.equal(proof.final.state, "complete");
				assert.equal(effects.length, 1);
				assert.equal(calls.length, 2);
				assert.ok(proof.final.steps[0].recentOutput.includes("OFFLINE_DETACHED_DONE"));
			} else {
				assert.equal(proof.final.state, "failed");
				assert.match(proof.final.error, /^model_verification_failed:/);
				assert.equal(effects.length, 0);
				assert.equal(calls.length, 1);
				assert.equal(proof.final.steps[0].recentTools.length, 0);
			}
		} finally {
			rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
		}
	});
}
