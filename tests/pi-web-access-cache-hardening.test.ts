import test from "node:test";
import assert from "node:assert/strict";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
	symlinkSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import {
	PI_WEB_ACCESS_PATCH_TARGETS,
	patchPiWebAccessSource,
	patchPiWebAccessSources,
} from "../scripts/lib/pi-web-access-patch.mjs";

const PI_WEB_ACCESS_FIXTURE_ROOT = join(
	import.meta.dirname,
	"..",
	"fixtures",
	"pi-web-access-0.28.0",
);

function readPiWebAccessFixtureSources(): Map<string, string> {
	return new Map(
		PI_WEB_ACCESS_PATCH_TARGETS.map((relativePath) => [
			relativePath,
			readFileSync(
				join(PI_WEB_ACCESS_FIXTURE_ROOT, relativePath),
				"utf8",
			),
		]),
	);
}

async function loadPatchedStorageFixture(fixtureRoot: string, label: string) {
	const storagePath = join(fixtureRoot, "storage.ts");
	const utilsPath = join(fixtureRoot, "utils.ts");
	const patchedSources = patchPiWebAccessSources(
		readPiWebAccessFixtureSources(),
		label,
	);
	writeFileSync(storagePath, patchedSources.get("storage.ts") ?? "", "utf8");
	writeFileSync(utilsPath, patchedSources.get("utils.ts") ?? "", "utf8");
	return import(
		`${pathToFileURL(storagePath).href}?fixture=${Date.now()}-${Math.random()}`,
	);
}

test("single fetch responses expose their response ID in model-visible text", () => {
	const indexSource = patchPiWebAccessSources(
		readPiWebAccessFixtureSources(),
		"single fetch response id fixture",
	).get("index.ts") ?? "";

	assert.match(
		indexSource,
		/content: \[\{ type: "text", text: `Error: \$\{result\.error\}\\nStored content responseId: "\$\{responseId\}"\.` \}\]/,
	);
	assert.match(
		indexSource,
		/output \+= `\\n\\n---\\nStored content responseId: "\$\{responseId\}"\.`;/,
	);
	assert.equal(
		indexSource.split('Stored content responseId: "${responseId}".').length - 1,
		2,
	);
});

test("external fetched-content cache follows Feynman's exact web-search config path", async () => {
	const fixtureRoot = mkdtempSync(join(tmpdir(), "feynman-web-content-cache-"));
	const configPath = join(fixtureRoot, "custom-config", "research-web.json");
	const cacheDir = join(fixtureRoot, "custom-config", "web-search-cache");
	const originalConfigPath = process.env.FEYNMAN_WEB_SEARCH_CONFIG;
	process.env.FEYNMAN_WEB_SEARCH_CONFIG = configPath;

	try {
		const storage = await loadPatchedStorageFixture(
			fixtureRoot,
			"external cache fixture",
		);
		const responseId = "feynman-cache-proof";
		const largeBody = "external-only-content-".repeat(2_000);
		const storedAt = Date.now();
		const sessionData = storage.storeFetchedContentResult(responseId, {
			id: responseId,
			type: "fetch",
			timestamp: storedAt,
			urls: [{
				url: "https://example.com/research",
				title: "Research source",
				content: largeBody,
				error: null,
			}],
		});

		assert.equal(storage.getFetchCacheDir(), cacheDir);
		assert.equal(existsSync(join(cacheDir, `${responseId}.json`)), true);
		if (process.platform !== "win32") {
			assert.equal(statSync(cacheDir).mode & 0o777, 0o700);
			assert.equal(statSync(join(cacheDir, `${responseId}.json`)).mode & 0o777, 0o600);
		}
		assert.equal(JSON.stringify(sessionData).includes(largeBody), false);
		assert.equal(sessionData.urlMetadata?.[0]?.contentLength, largeBody.length);

		storage.clearResults();
		storage.restoreFromSession({
			sessionManager: {
				getBranch: () => [{
					type: "custom",
					customType: "web-search-results",
					data: sessionData,
				}],
			},
		});
		assert.equal(
			storage.getResult(responseId)?.urls?.[0]?.content,
			largeBody,
		);
	} finally {
		if (originalConfigPath === undefined) {
			delete process.env.FEYNMAN_WEB_SEARCH_CONFIG;
		} else {
			process.env.FEYNMAN_WEB_SEARCH_CONFIG = originalConfigPath;
		}
		rmSync(fixtureRoot, { recursive: true, force: true });
	}
});

test("fetched-content cache evicts oldest entries and removes only stale owned temp files", async () => {
	const fixtureRoot = mkdtempSync(join(tmpdir(), "feynman-web-cache-limits-"));
	const configPath = join(fixtureRoot, "config", "web-search.json");
	const cacheDir = join(fixtureRoot, "config", "web-search-cache");
	const originalConfigPath = process.env.FEYNMAN_WEB_SEARCH_CONFIG;
	process.env.FEYNMAN_WEB_SEARCH_CONFIG = configPath;

	try {
		const storage = await loadPatchedStorageFixture(
			fixtureRoot,
			"cache limits fixture",
		);
		mkdirSync(cacheDir, { recursive: true });
		const now = Date.now();
		for (const [name, content, ageSeconds] of [
			["oldest.json", "1111", 30],
			["middle.json", "222222", 20],
			["newest.json", "33333333", 10],
		] as const) {
			const path = join(cacheDir, name);
			writeFileSync(path, content);
			const modified = new Date(now - ageSeconds * 1_000);
			utimesSync(path, modified, modified);
		}

		storage.pruneExpiredFetchCache(now, { maxEntries: 2, maxBytes: 1_024 });
		assert.deepEqual(readdirSync(cacheDir).sort(), ["middle.json", "newest.json"]);
		storage.pruneExpiredFetchCache(now, { maxEntries: 10, maxBytes: 8 });
		assert.deepEqual(readdirSync(cacheDir), ["newest.json"]);
		assert.throws(
			() => storage.pruneExpiredFetchCache(now, { maxEntries: 0 }),
			/finite positive integers/,
		);

		const staleTemp = `stale.json.123.456.${"a".repeat(32)}.tmp`;
		const freshTemp = `fresh.json.123.456.${"b".repeat(32)}.tmp`;
		for (const name of [staleTemp, freshTemp, "foreign.tmp"]) {
			const path = join(cacheDir, name);
			writeFileSync(path, name);
			if (name === staleTemp) {
				const modified = new Date(now - 2 * 60 * 60 * 1_000);
				utimesSync(path, modified, modified);
			}
		}
		storage.pruneExpiredFetchCache(now);
		const remaining = readdirSync(cacheDir);
		assert.equal(remaining.includes(staleTemp), false);
		assert.equal(remaining.includes(freshTemp), true);
		assert.equal(remaining.includes("foreign.tmp"), true);
	} finally {
		if (originalConfigPath === undefined) {
			delete process.env.FEYNMAN_WEB_SEARCH_CONFIG;
		} else {
			process.env.FEYNMAN_WEB_SEARCH_CONFIG = originalConfigPath;
		}
		rmSync(fixtureRoot, { recursive: true, force: true });
	}
});

test("fetched-content cache rejects directory and entry symlinks", { skip: process.platform === "win32" }, async () => {
	const fixtureRoot = mkdtempSync(join(tmpdir(), "feynman-web-cache-symlink-"));
	const configPath = join(fixtureRoot, "config", "web-search.json");
	const cacheDir = join(fixtureRoot, "config", "web-search-cache");
	const outsideDir = join(fixtureRoot, "outside");
	const originalConfigPath = process.env.FEYNMAN_WEB_SEARCH_CONFIG;
	process.env.FEYNMAN_WEB_SEARCH_CONFIG = configPath;

	try {
		const storage = await loadPatchedStorageFixture(
			fixtureRoot,
			"cache symlink fixture",
		);
		mkdirSync(join(fixtureRoot, "config"), { recursive: true });
		mkdirSync(outsideDir);
		symlinkSync(outsideDir, cacheDir);
		const rejected = storage.storeFetchedContentResult("dir-link", {
			id: "dir-link",
			type: "fetch",
			timestamp: Date.now(),
			urls: [{
				url: "https://example.com/dir-link",
				title: "Directory link",
				content: "must stay inside the cache",
				error: null,
			}],
		});
		assert.equal(rejected.fetchCache, undefined);
		assert.match(rejected.fetchCacheError, /not a safe directory/);
		assert.deepEqual(readdirSync(outsideDir), []);

		rmSync(cacheDir);
		mkdirSync(cacheDir);
		const targetPath = join(outsideDir, "outside.json");
		const linkedData = {
			id: "file-link",
			type: "fetch",
			timestamp: Date.now(),
			urls: [{
				url: "https://example.com/file-link",
				title: "File link",
				content: "outside cached content",
				error: null,
			}],
		};
		writeFileSync(targetPath, JSON.stringify(linkedData));
		symlinkSync(targetPath, join(cacheDir, "file-link.json"));
		storage.clearResults();
		storage.restoreFromSession({
			sessionManager: {
				getBranch: () => [{
					type: "custom",
					customType: "web-search-results",
					data: {
						id: "file-link",
						type: "fetch",
						timestamp: linkedData.timestamp,
						fetchCache: {
							version: 1,
							key: "file-link.json",
							storedAt: linkedData.timestamp,
						},
						urlMetadata: [{
							url: "https://example.com/file-link",
							title: "File link",
							error: null,
							contentLength: 22,
						}],
					},
				}],
			},
		});
		const restored = storage.getResult("file-link");
		assert.equal(restored?.urls?.[0]?.content, "");
		assert.match(restored?.urls?.[0]?.error ?? "", /not a regular file/);
		assert.equal(readFileSync(targetPath, "utf8"), JSON.stringify(linkedData));
	} finally {
		if (originalConfigPath === undefined) {
			delete process.env.FEYNMAN_WEB_SEARCH_CONFIG;
		} else {
			process.env.FEYNMAN_WEB_SEARCH_CONFIG = originalConfigPath;
		}
		rmSync(fixtureRoot, { recursive: true, force: true });
	}
});

test("fetched-content cache hardening treats concurrent missing prune targets as success", () => {
	const storageSource = patchPiWebAccessSources(
		readPiWebAccessFixtureSources(),
		"concurrent cache pruning fixture",
	).get("storage.ts") ?? "";

	assert.match(
		storageSource,
		/return \(err as NodeJS\.ErrnoException\)\.code === "ENOENT" \? "missing" : "error";/,
	);
	assert.equal(
		storageSource.split('removed === "removed" || removed === "missing"').length - 1,
		1,
	);
	assert.match(
		storageSource,
		/removed !== "removed" && removed !== "missing"/,
	);
});

test("fetched-content cache hardening upgrades the prior config-path-only patch", () => {
	const baseline = readPiWebAccessFixtureSources().get("storage.ts") ?? "";
	const configPatched = baseline
		.replace(
			'import { join } from "node:path";',
			'import { dirname, join } from "node:path";',
		)
		.replace(
			'import { getWebSearchConfigDir } from "./utils.ts";',
			'import { getWebSearchConfigPath } from "./utils.ts";',
		)
		.replace(
			"return join(getWebSearchConfigDir(), FETCH_CACHE_DIR);",
			"return join(dirname(getWebSearchConfigPath()), FETCH_CACHE_DIR);",
		);

	const hardened = patchPiWebAccessSource("storage.ts", configPatched);
	assert.match(hardened, /const DEFAULT_CACHE_LIMITS = \{ maxEntries: 128,/);
	assert.match(hardened, /type CacheUnlinkResult = "removed" \| "missing"/);
	assert.equal(patchPiWebAccessSource("storage.ts", hardened), hardened);

	const windowsBaseline = baseline.replace(/\n/g, "\r\n");
	const windowsHardened = patchPiWebAccessSource("storage.ts", windowsBaseline);
	assert.match(windowsHardened, /const DEFAULT_CACHE_LIMITS = \{ maxEntries: 128,/);
	assert.equal(
		patchPiWebAccessSource("storage.ts", windowsHardened),
		windowsHardened,
	);
});
