import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { computeFileSha256, computeRuntimeTreeHash } from "../scripts/lib/runtime-workspace-integrity.mjs";
import {
	runtimeWorkspaceCompletionMatches,
	runtimeWorkspaceMatches,
	writeRuntimeWorkspaceCompletion,
} from "../scripts/lib/runtime-workspace-restore.mjs";

function declaredPruneVersion(path: string): number {
	const source = readFileSync(path, "utf8");
	const matches = [...source.matchAll(/^const PRUNE_VERSION = (\d+);$/gm)];
	assert.equal(matches.length, 1, `${path} must have one explicit prune identity`);
	return Number(matches[0][1]);
}

test("archive builder and Node 22 fallback require the same current prune identity", () => {
	const builder = declaredPruneVersion("scripts/prepare-runtime-workspace.mjs");
	const restorer = declaredPruneVersion("scripts/patch-embedded-pi.mjs");
	assert.equal(builder, 9);
	assert.equal(restorer, builder, "a stale restorer silently rejects a correctly rebuilt Node 22 workspace");
	const source = readFileSync("scripts/patch-embedded-pi.mjs", "utf8");
	assert.match(source, /pruneVersion: PRUNE_VERSION/);
	assert.match(source, /requirePlatformIdentity: supportsNativePackageSources\(\)/);
	assert.match(source, /requireCurrentPlatformPackageGraph: true/);
	assert.match(source, /expectedPackageLockSha256: installSeed\.packageLockSha256/);
});

test("current staged runtime passes strict identity, while stale prune, ABI and graph remain rejected", () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-prune-identity-"));
	try {
		const dependencyRoot = join(root, "node_modules/proof-runtime");
		mkdirSync(dependencyRoot, { recursive: true });
		const dependencyPath = join(dependencyRoot, "package.json");
		const dependency = JSON.stringify({ name: "proof-runtime", version: "1.0.0" });
		writeFileSync(dependencyPath, dependency);
		writeFileSync(join(root, "package.json"), JSON.stringify({
			name: "runtime-fixture", dependencies: { "proof-runtime": "1.0.0" },
		}));
		const lockPath = join(root, "package-lock.json");
		const lock = JSON.stringify({ lockfileVersion: 3, packages: {
			"": { dependencies: { "proof-runtime": "1.0.0" } },
			"node_modules/proof-runtime": { version: "1.0.0" },
		} });
		writeFileSync(lockPath, lock);
		const expectedLock = computeFileSha256(lockPath);
		const report = process.report?.getReport?.() as { header?: { glibcVersionRuntime?: string } };
		const current = {
			packageSpecs: ["proof-runtime@1.0.0"],
			nodeAbi: process.versions.modules,
			platform: process.platform,
			arch: process.arch,
			...(process.platform === "linux" ? { libc: report.header?.glibcVersionRuntime ? "glibc" : "musl" } : {}),
			pruneVersion: declaredPruneVersion("scripts/prepare-runtime-workspace.mjs"),
		};
		const writeCompleted = (changes: Record<string, unknown> = {}) => {
			writeFileSync(join(root, ".runtime-manifest.json"), JSON.stringify({
				...current, ...changes, runtimeTreeHash: computeRuntimeTreeHash(root),
			}));
			writeRuntimeWorkspaceCompletion(root, {
				source: "package-manager",
				runtimeTreeHash: computeRuntimeTreeHash(root),
				expectedPackageLockSha256: expectedLock,
			});
		};
		const completionOptions = { archivePath: join(root, "unused.tgz"), digestPath: join(root, "unused.sha256") };
		const matches = () => runtimeWorkspaceMatches(root, current.packageSpecs, {
			...completionOptions,
			pruneVersion: declaredPruneVersion("scripts/patch-embedded-pi.mjs"),
			requireCompletion: true,
			requireCurrentPlatformPackageGraph: true,
			requirePlatformIdentity: true,
		});
		writeCompleted();
		assert.equal(runtimeWorkspaceCompletionMatches(root, completionOptions), true);
		assert.equal(matches(), true, `strict restoration must accept ABI ${process.versions.modules}`);
		for (const changes of [
			{ pruneVersion: 8 }, { nodeAbi: "wrong-abi" },
			{ platform: "wrong-platform" }, { arch: "wrong-arch" },
		]) {
			writeCompleted(changes);
			// A valid completed tree is insufficient when its platform/prune identity differs.
			assert.equal(runtimeWorkspaceCompletionMatches(root, completionOptions), true);
			assert.equal(matches(), false, JSON.stringify(changes));
		}
		writeCompleted();
		writeFileSync(lockPath, `${lock}\n`);
		assert.equal(matches(), false, "even equivalent JSON must retain the authenticated lock bytes");
		assert.throws(() => writeRuntimeWorkspaceCompletion(root, {
			source: "package-manager", runtimeTreeHash: computeRuntimeTreeHash(root),
			expectedPackageLockSha256: expectedLock,
		}), /package lock changed/);
		writeFileSync(lockPath, lock);
		writeCompleted();
		rmSync(dependencyPath);
		assert.equal(matches(), false, "a missing locked dependency must not pass");
		writeFileSync(dependencyPath, JSON.stringify({ name: "proof-runtime", version: "2.0.0" }));
		assert.equal(matches(), false, "a wrong locked dependency version must not pass");
	} finally {
		rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
	}
});
