import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

const require = createRequire(import.meta.url);

export const FEYNMAN_UNDICI_VERSION = "8.10.2";
const UPSTREAM_PI_UNDICI_VERSION = "8.5.0";
const PRIOR_FEYNMAN_UNDICI_VERSION = "8.9.0";
const FEYNMAN_UNDICI_LOCK_ENTRY = {
	version: FEYNMAN_UNDICI_VERSION,
	resolved: `https://registry.npmjs.org/undici/-/undici-${FEYNMAN_UNDICI_VERSION}.tgz`,
	integrity: "sha512-/y4/bH9YNU5hi9NIrpOuvGXFcxrj3CMrV+/AYpowAYTpHn8gX/XPFjNy766FPoYY0miQhdW977JFWKGNhBdwyQ==",
	license: "MIT",
	engines: { node: ">=22.19.0" },
};

function readPackageVersion(packageRoot) {
	try {
		return JSON.parse(readFileSync(resolve(packageRoot, "package.json"), "utf8")).version;
	} catch {
		return undefined;
	}
}

function assertSupportedUndiciVersion(version, surface) {
	if (
		![
			UPSTREAM_PI_UNDICI_VERSION,
			PRIOR_FEYNMAN_UNDICI_VERSION,
			"8.10.0",
			FEYNMAN_UNDICI_VERSION,
		].includes(version)
	) {
		throw new Error(`Unsupported Pi Undici ${surface}: ${version ?? "missing"}`);
	}
}

function lockEntryMatches(entry) {
	return entry?.version === FEYNMAN_UNDICI_LOCK_ENTRY.version &&
		entry?.resolved === FEYNMAN_UNDICI_LOCK_ENTRY.resolved &&
		entry?.integrity === FEYNMAN_UNDICI_LOCK_ENTRY.integrity;
}

function resolveFeynmanUndiciPath(nodeModulesPath, fallbackPackagePath) {
	const candidates = [resolve(nodeModulesPath, "undici"), fallbackPackagePath];
	try {
		candidates.push(dirname(require.resolve("undici/package.json")));
	} catch {}
	return candidates.find((candidate) =>
		candidate && readPackageVersion(candidate) === FEYNMAN_UNDICI_VERSION
	);
}

export function patchPiCodingAgentUndiciPackageJsonSource(source) {
	const manifest = JSON.parse(source);
	const currentVersion = manifest.dependencies?.undici;
	assertSupportedUndiciVersion(currentVersion, "package dependency");
	if (currentVersion === FEYNMAN_UNDICI_VERSION) {
		return source;
	}
	manifest.dependencies.undici = FEYNMAN_UNDICI_VERSION;
	return JSON.stringify(manifest, null, 2) + "\n";
}

export function patchPiCodingAgentUndiciShrinkwrapSource(source) {
	const shrinkwrap = JSON.parse(source);
	const dependencyVersion = shrinkwrap.packages?.[""]?.dependencies?.undici;
	const entry = shrinkwrap.packages?.["node_modules/undici"];
	assertSupportedUndiciVersion(dependencyVersion, "shrinkwrap dependency");
	assertSupportedUndiciVersion(entry?.version, "shrinkwrap entry");
	if (
		dependencyVersion === FEYNMAN_UNDICI_VERSION &&
		lockEntryMatches(entry)
	) {
		return source;
	}
	shrinkwrap.packages[""].dependencies.undici = FEYNMAN_UNDICI_VERSION;
	shrinkwrap.packages["node_modules/undici"] = FEYNMAN_UNDICI_LOCK_ENTRY;
	return JSON.stringify(shrinkwrap, null, 2) + "\n";
}

export function assertPiCodingAgentUndiciShrinkwrapSource(source, surface) {
	const shrinkwrap = JSON.parse(source);
	const dependencyVersion = shrinkwrap.packages?.[""]?.dependencies?.undici;
	const entry = shrinkwrap.packages?.["node_modules/undici"];
	if (
		dependencyVersion !== FEYNMAN_UNDICI_VERSION ||
		!lockEntryMatches(entry)
	) {
		throw new Error(
			`Incomplete Pi Undici metadata ${surface}: expected exact ${FEYNMAN_UNDICI_VERSION} dependency, resolved URL, and integrity`,
		);
	}
}

export function patchPiUndiciPackageLockSource(source, requiredPiVersion) {
	const lockfile = JSON.parse(source);
	let changed = false;
	for (const [packagePath, entry] of Object.entries(lockfile.packages ?? {})) {
		if (/node_modules\/(?:@[^/]+\/)?pi-coding-agent$/.test(packagePath)) {
			if (requiredPiVersion && entry?.version !== requiredPiVersion) {
				continue;
			}
			const currentVersion = entry?.dependencies?.undici;
			assertSupportedUndiciVersion(currentVersion, "package-lock dependency");
			if (currentVersion !== FEYNMAN_UNDICI_VERSION) {
				entry.dependencies.undici = FEYNMAN_UNDICI_VERSION;
				changed = true;
			}
			continue;
		}
		if (!packagePath.endsWith("/pi-coding-agent/node_modules/undici")) {
			continue;
		}
		const piPackagePath = packagePath.slice(0, -"/node_modules/undici".length);
		if (
			requiredPiVersion &&
			lockfile.packages?.[piPackagePath]?.version !== requiredPiVersion
		) {
			continue;
		}
		assertSupportedUndiciVersion(entry?.version, "package-lock entry");
		if (!lockEntryMatches(entry)) {
			lockfile.packages[packagePath] = {
				...FEYNMAN_UNDICI_LOCK_ENTRY,
				...(entry.inBundle === true ? { inBundle: true } : {}),
			};
			changed = true;
		}
	}
	return changed ? JSON.stringify(lockfile, null, 2) + "\n" : source;
}

/**
 * Pi 0.85.1 still shrinkwraps an older Undici. Replace that nested tree with 8.10.2 so
 * Feynman and Pi inherit the current proxy and retrieval reliability fixes.
 * Remove this patch after a supported Pi release depends on Undici >=8.10.2.
 */
export function patchPiUndiciProxyTree(nodeModulesPath, fallbackPackagePath, requiredPiVersion) {
	const piRoots = ["@earendil-works", "@mariozechner"]
		.map((scope) => resolve(nodeModulesPath, scope, "pi-coding-agent"))
		.filter((piRoot) =>
			existsSync(resolve(piRoot, "npm-shrinkwrap.json")) &&
			(!requiredPiVersion || readPackageVersion(piRoot) === requiredPiVersion)
		);
	if (piRoots.length === 0) {
		return false;
	}

	let changed = false;
	for (const piRoot of piRoots) {
		const packageJsonPath = resolve(piRoot, "package.json");
		const packageJsonSource = readFileSync(packageJsonPath, "utf8");
		const patchedPackageJson = patchPiCodingAgentUndiciPackageJsonSource(packageJsonSource);
		const shrinkwrapPath = resolve(piRoot, "npm-shrinkwrap.json");
		const shrinkwrapSource = readFileSync(shrinkwrapPath, "utf8");
		const patchedShrinkwrap = patchPiCodingAgentUndiciShrinkwrapSource(shrinkwrapSource);
		const nestedPackagePath = resolve(piRoot, "node_modules", "undici");
		const nestedVersion = readPackageVersion(nestedPackagePath);

		if (nestedVersion !== FEYNMAN_UNDICI_VERSION) {
			if (nestedVersion !== undefined) {
				assertSupportedUndiciVersion(nestedVersion, "installed version");
			}
			const safePackagePath = resolveFeynmanUndiciPath(nodeModulesPath, fallbackPackagePath);
			if (!safePackagePath) {
				throw new Error(`Undici ${FEYNMAN_UNDICI_VERSION} package tree is unavailable`);
			}
			const temporaryPath = `${nestedPackagePath}.feynman-proxy-${process.pid}`;
			rmSync(temporaryPath, { recursive: true, force: true });
			mkdirSync(dirname(temporaryPath), { recursive: true });
			cpSync(safePackagePath, temporaryPath, { recursive: true });
			rmSync(nestedPackagePath, { recursive: true, force: true });
			renameSync(temporaryPath, nestedPackagePath);
			changed = true;
		}
		if (patchedPackageJson !== packageJsonSource) {
			writeFileSync(packageJsonPath, patchedPackageJson, "utf8");
			changed = true;
		}
		if (patchedShrinkwrap !== shrinkwrapSource) {
			writeFileSync(shrinkwrapPath, patchedShrinkwrap, "utf8");
			changed = true;
		}
	}

	const packageLockPath = resolve(nodeModulesPath, "..", "package-lock.json");
	if (existsSync(packageLockPath)) {
		const packageLockSource = readFileSync(packageLockPath, "utf8");
		const patchedPackageLock = patchPiUndiciPackageLockSource(
			packageLockSource,
			requiredPiVersion,
		);
		if (patchedPackageLock !== packageLockSource) {
			writeFileSync(packageLockPath, patchedPackageLock, "utf8");
			changed = true;
		}
	}
	return changed;
}
