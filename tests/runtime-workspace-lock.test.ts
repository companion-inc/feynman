import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import {
	acquireRuntimeWorkspaceSetupLock,
	cleanupRuntimeWorkspaceSetupLockTombstones,
	heartbeatRuntimeWorkspaceSetupLock,
	releaseRuntimeWorkspaceSetupLock,
} from "../scripts/lib/runtime-workspace-lock.mjs";

const repoRoot = process.cwd();

test("vendored runtime uses a committed exact dependency lock", () => {
	const settings = JSON.parse(
		readFileSync(join(repoRoot, ".feynman", "settings.json"), "utf8"),
	) as { packages: string[] };
	const rootLock = JSON.parse(
		readFileSync(join(repoRoot, "package-lock.json"), "utf8"),
	) as { packages: Record<string, { version?: string }> };
	const runtimeLock = JSON.parse(
		readFileSync(
			join(repoRoot, ".feynman", "runtime-package-lock.json"),
			"utf8",
		),
	) as {
		lockfileVersion: number;
		packages: Record<
			string,
			{ dependencies?: Record<string, string>; version?: string }
		>;
	};

	const expected = Object.fromEntries(
		settings.packages.map((source) => {
			const spec = source.slice("npm:".length);
			const match = spec.match(/^(@?[^@]+(?:\/[^@]+)?)@(.+)$/);
			assert.ok(match, `runtime package is not exact: ${source}`);
			return [match[1], match[2]];
		}),
	);
	for (const packageName of [
		"@earendil-works/pi-agent-core",
		"@earendil-works/pi-client",
		"@earendil-works/pi-server",
		"@earendil-works/pi-ai",
		"@earendil-works/pi-coding-agent",
		"@earendil-works/pi-telemetry",
		"@earendil-works/pi-tui",
		"brace-expansion",
		"esbuild",
		"typebox",
		"undici",
	]) {
		const version =
			rootLock.packages[`node_modules/${packageName}`]?.version;
		if (version) expected[packageName] = version;
	}

	assert.equal(runtimeLock.lockfileVersion, 3);
	assert.deepEqual(runtimeLock.packages[""].dependencies, expected);
	assert.equal(
		runtimeLock.packages["node_modules/@hono/node-server"]?.version,
		"2.1.1",
	);
	assert.deepEqual(
		{
			piTelemetry:
				runtimeLock.packages[
					"node_modules/@earendil-works/pi-telemetry"
				]?.version,
			nodeTypes:
				runtimeLock.packages["node_modules/@types/node"]?.version,
			fastUri:
				runtimeLock.packages["node_modules/fast-uri"]?.version,
			qs: runtimeLock.packages["node_modules/qs"]?.version,
			hono: runtimeLock.packages["node_modules/hono"]?.version,
		},
		{
			piTelemetry: "0.85.1",
			nodeTypes: "26.4.1",
			fastUri: "3.1.7",
			qs: "6.16.0",
			hono: "4.13.7",
		},
	);
	assert.deepEqual(
		{
			version:
				runtimeLock.packages["node_modules/@llamaindex/liteparse"]
					?.version,
			resolved: (
				runtimeLock.packages[
					"node_modules/@llamaindex/liteparse"
				] as { resolved?: string }
			)?.resolved,
			integrity: (
				runtimeLock.packages[
					"node_modules/@llamaindex/liteparse"
				] as { integrity?: string }
			)?.integrity,
		},
		{
			version: "2.14.3",
			resolved:
				"https://registry.npmjs.org/@llamaindex/liteparse/-/liteparse-2.14.3.tgz",
			integrity:
				"sha512-6gf70TDkNcu2lsYS5RAz+jl3lpwHKf8ppXyUb1PAFAF8BVW8Zg71ncvrkLMh3CYXF16kGO7p1Scymzpvmht0IQ==",
		},
	);
	assert.equal(
		runtimeLock.packages["node_modules/undici"]?.version,
		"8.10.2",
	);
	for (const [packagePath, entry] of Object.entries(
		runtimeLock.packages,
	)) {
		if (
			packagePath.endsWith(
				"/pi-coding-agent/node_modules/brace-expansion",
			)
		) {
			assert.equal(entry.version, "5.0.9");
		}
		if (
			packagePath.endsWith("/pi-coding-agent/node_modules/undici")
		) {
			assert.equal(entry.version, "8.10.2");
		}
	}
});

test("runtime build hashes its lock and pruning logic and installs with npm ci", () => {
	const source = readFileSync(
		join(repoRoot, "scripts", "prepare-runtime-workspace.mjs"),
		"utf8",
	);
	assert.match(source, /runtime-package-lock\.json/);
	assert.match(source, /prune-runtime-deps\.mjs/);
	assert.match(source, /"ci"/);
	assert.match(source, /--refresh-lock/);
	assert.match(source, /--save-exact/);
	assert.match(source, /workspacePackagesMatch/);
	assert.match(source, /runtimeArchiveMatches/);
	assert.match(source, /computeRuntimeInputHash/);
	assert.match(source, /computeRuntimeTreeHash/);
	assert.match(source, /filesMatch/);
	assert.match(source, /removeGeneratedHiddenRuntimeLock/);
	assert.match(source, /node_modules.*\.package-lock\.json/s);
	assert.match(source, /runtime-workspace\.sha256/);
	assert.match(source, /createDeterministicTarGz/);
	assert.match(source, /--rebuild/);
});

test("workspace setup locks preserve active owners and release only matching tokens", () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-runtime-lock-"));
	const lockDir = join(root, ".workspace-setup.lock");
	try {
		const token = acquireRuntimeWorkspaceSetupLock(lockDir, { staleMs: 25 });
		const ownerPath = join(lockDir, "owner.json");
		const initialOwner = JSON.parse(readFileSync(ownerPath, "utf8"));
		assert.equal(heartbeatRuntimeWorkspaceSetupLock(lockDir, token), true);
		const heartbeatOwner = JSON.parse(readFileSync(ownerPath, "utf8"));
		assert.equal(heartbeatOwner.token, token);
		assert.equal(heartbeatOwner.heartbeatAt >= initialOwner.heartbeatAt, true);
		assert.throws(
			() => acquireRuntimeWorkspaceSetupLock(lockDir, { staleMs: 25 }),
			/Timed out waiting/,
		);
		assert.equal(existsSync(lockDir), true);
		releaseRuntimeWorkspaceSetupLock(lockDir, "wrong-token");
		assert.equal(existsSync(lockDir), true);

		const validOwnerSource = readFileSync(ownerPath, "utf8");
		writeFileSync(
			ownerPath,
			`${JSON.stringify({
				...heartbeatOwner,
				createdAt: heartbeatOwner.createdAt + 1,
			})}\n`,
		);
		releaseRuntimeWorkspaceSetupLock(lockDir, token);
		assert.equal(existsSync(lockDir), true);
		writeFileSync(ownerPath, validOwnerSource);

		rmSync(ownerPath);
		releaseRuntimeWorkspaceSetupLock(lockDir, token);
		assert.equal(existsSync(lockDir), true);
		writeFileSync(ownerPath, validOwnerSource);

		const originalLockDir = `${lockDir}.original`;
		renameSync(lockDir, originalLockDir);
		mkdirSync(lockDir);
		writeFileSync(join(lockDir, "owner.json"), validOwnerSource);
		releaseRuntimeWorkspaceSetupLock(lockDir, token);
		assert.equal(existsSync(lockDir), true);
		rmSync(lockDir, { recursive: true });
		renameSync(originalLockDir, lockDir);
		releaseRuntimeWorkspaceSetupLock(lockDir, token);
		assert.equal(existsSync(lockDir), false);

		mkdirSync(lockDir);
		writeFileSync(
			join(lockDir, "owner.json"),
			`${JSON.stringify({
				pid: 2_147_483_647,
				token: "dead-owner",
				createdAt: 0,
			})}\n`,
		);
		const replacementToken = acquireRuntimeWorkspaceSetupLock(lockDir, {
			staleMs: 0,
		});
		assert.notEqual(replacementToken, "dead-owner");
		releaseRuntimeWorkspaceSetupLock(lockDir, replacementToken);
		assert.equal(existsSync(lockDir), false);

		mkdirSync(lockDir);
		writeFileSync(
			join(lockDir, "owner.json"),
			`${JSON.stringify({
				version: 1,
				pid: process.pid,
				token: "reused-pid",
				hostname: hostname(),
				createdAt: 0,
				heartbeatAt: 0,
				processStartedAt: 0,
			})}\n`,
		);
		const reusedPidReplacement = acquireRuntimeWorkspaceSetupLock(lockDir, {
			staleMs: 0,
		});
		assert.notEqual(reusedPidReplacement, "reused-pid");
		releaseRuntimeWorkspaceSetupLock(lockDir, reusedPidReplacement);

		mkdirSync(lockDir);
		writeFileSync(
			join(lockDir, "owner.json"),
			`${JSON.stringify({
				version: 1,
				pid: process.pid,
				token: "unverifiable-owner",
				hostname: hostname(),
				createdAt: 0,
				heartbeatAt: 0,
				processStartedAt: 1,
			})}\n`,
		);
		const unverifiableReplacement = acquireRuntimeWorkspaceSetupLock(lockDir, {
			staleMs: 0,
			readOwnerProcessStartedAt: () => undefined,
		});
		assert.notEqual(unverifiableReplacement, "unverifiable-owner");
		releaseRuntimeWorkspaceSetupLock(lockDir, unverifiableReplacement);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
test("setup lock heartbeats preserve a live owner when process-start lookup is unavailable", async () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-runtime-heartbeat-"));
	const lockDir = join(root, ".workspace-setup.lock");
	const readyPath = join(root, "ready");
	const stopPath = join(root, "stop");
	const childPath = join(root, "heartbeat-owner.mjs");
	const lockModuleUrl = pathToFileURL(
		join(
			process.cwd(),
			"scripts",
			"lib",
			"runtime-workspace-lock.mjs",
		),
	).href;
	writeFileSync(
		childPath,
		`
			import { existsSync, writeFileSync } from "node:fs";
			import {
				acquireRuntimeWorkspaceSetupLock,
				heartbeatRuntimeWorkspaceSetupLock,
				releaseRuntimeWorkspaceSetupLock,
			} from ${JSON.stringify(lockModuleUrl)};
			const [lockDir, readyPath, stopPath] = process.argv.slice(2);
			const token = acquireRuntimeWorkspaceSetupLock(lockDir, { staleMs: 1000 });
			writeFileSync(readyPath, "ready\\n");
			const timer = setInterval(() => {
				if (!heartbeatRuntimeWorkspaceSetupLock(lockDir, token)) process.exit(2);
			}, 20);
			while (!existsSync(stopPath)) {
				await new Promise((resolve) => setTimeout(resolve, 20));
			}
			clearInterval(timer);
			releaseRuntimeWorkspaceSetupLock(lockDir, token);
		`,
	);
	const child = spawn(
		process.execPath,
		[childPath, lockDir, readyPath, stopPath],
		{ stdio: "ignore" },
	);
	try {
		const deadline = Date.now() + 5_000;
		while (!existsSync(readyPath) && Date.now() < deadline) {
			await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
		}
		assert.equal(existsSync(readyPath), true);
		assert.throws(
			() =>
					acquireRuntimeWorkspaceSetupLock(lockDir, {
						// Keep the test below the production five-minute budget while
						// allowing a loaded CI host to schedule the separate heartbeat
						// process before stale ownership is evaluated.
						staleMs: 1_000,
						readOwnerProcessStartedAt: () => undefined,
					}),
			/Timed out waiting/,
		);
		assert.equal(existsSync(lockDir), true);
		writeFileSync(stopPath, "stop\n");
		const exitCode = await new Promise<number | null>((resolvePromise) => {
			child.once("exit", resolvePromise);
		});
		assert.equal(exitCode, 0);
		assert.equal(existsSync(lockDir), false);
	} finally {
		child.kill();
		rmSync(root, { recursive: true, force: true });
	}
});

test("setup lock acquisition bounds cleanup of crashed ownership tombstones", () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-runtime-lock-tombstones-"));
	const lockDir = join(root, ".workspace-setup.lock");
	const now = Date.now();
	try {
		const oldPaths = [
			join(root, `.workspace-setup.lock.released-1-${now - 20_000}-00000000-0000-0000-0000-000000000001`),
			join(root, `.workspace-setup.lock.stale-2-${now - 10_000}-00000000-0000-0000-0000-000000000002`),
			join(root, `.workspace-setup.lock.released-3-${now - 5_000}-00000000-0000-0000-0000-000000000003`),
		];
		for (const path of oldPaths) mkdirSync(path);
		const freshPath = join(
			root,
			`.workspace-setup.lock.released-4-${now}-00000000-0000-0000-0000-000000000004`,
		);
		mkdirSync(freshPath);
		const unrelatedPath = join(root, ".workspace-setup.lock.released-not-owned");
		mkdirSync(unrelatedPath);

		assert.equal(
			cleanupRuntimeWorkspaceSetupLockTombstones(lockDir, {
				now,
				staleMs: 1_000,
				maxCleanups: 2,
			}),
			2,
		);
		assert.equal(oldPaths.filter((path) => existsSync(path)).length, 1);
		assert.equal(existsSync(freshPath), true);
		assert.equal(existsSync(unrelatedPath), true);

		const token = acquireRuntimeWorkspaceSetupLock(lockDir, { staleMs: 0 });
		releaseRuntimeWorkspaceSetupLock(lockDir, token);
		assert.equal(oldPaths.some((path) => existsSync(path)), false);
		assert.equal(existsSync(freshPath), false);
		assert.equal(existsSync(unrelatedPath), true);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
