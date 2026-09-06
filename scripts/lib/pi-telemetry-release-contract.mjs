export const FEYNMAN_PI_TELEMETRY_PACKAGE =
	"@earendil-works/pi-telemetry";
export const FEYNMAN_PI_TELEMETRY_VERSION = "0.85.1";
export const FEYNMAN_PI_TELEMETRY_RESOLVED =
	"https://registry.npmjs.org/@earendil-works/pi-telemetry/-/pi-telemetry-0.85.1.tgz";
export const FEYNMAN_PI_TELEMETRY_INTEGRITY =
	"sha512-Bg/YN6kA7Swja/NQxka8xFdecb4E/auIEGF2G5A25EaQXhRnPj300/7/KpgsDDMYUzHTDAv4RyUxaQPJKW81Rw==";

const PI_TELEMETRY_LOCK_PATHS = Object.freeze([
	"node_modules/@earendil-works/pi-telemetry",
	"node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-telemetry",
]);
const PI_TELEMETRY_ARCHIVE_MANIFEST_PATHS = Object.freeze(
	PI_TELEMETRY_LOCK_PATHS.map(
		(packagePath) => `npm/${packagePath}/package.json`,
	),
);

function isPiTelemetryLockPath(packagePath) {
	return (
		packagePath === PI_TELEMETRY_LOCK_PATHS[0] ||
		packagePath.endsWith(
			`/node_modules/${FEYNMAN_PI_TELEMETRY_PACKAGE}`,
		)
	);
}

function verifyExpectedVersion(expectedVersion, fail) {
	if (expectedVersion !== FEYNMAN_PI_TELEMETRY_VERSION) {
		fail(
			`Pi telemetry release contract is pinned to ${FEYNMAN_PI_TELEMETRY_PACKAGE}@${FEYNMAN_PI_TELEMETRY_VERSION}, not ${expectedVersion}`,
		);
	}
}

export function resolvePiTelemetryRuntimeVersion(
	lockedVersion,
	hasRootPackageLock,
) {
	if (!hasRootPackageLock) {
		return FEYNMAN_PI_TELEMETRY_VERSION;
	}
	if (lockedVersion !== FEYNMAN_PI_TELEMETRY_VERSION) {
		throw new Error(
			`Pi telemetry must match the maintained Pi ${FEYNMAN_PI_TELEMETRY_VERSION} train, found ${lockedVersion ?? "missing"}`,
		);
	}
	return lockedVersion;
}

function verifyPiTelemetryLockEntry(entry, packagePath, canonicalIntegrity, fail) {
	const observedIntegrity =
		entry?.integrity === undefined
			? canonicalIntegrity
			: entry.integrity;
	if (
		entry?.version !== FEYNMAN_PI_TELEMETRY_VERSION ||
		entry?.resolved !== FEYNMAN_PI_TELEMETRY_RESOLVED ||
		(entry?.name !== undefined &&
			entry.name !== FEYNMAN_PI_TELEMETRY_PACKAGE) ||
		observedIntegrity !== FEYNMAN_PI_TELEMETRY_INTEGRITY
	) {
		fail(
			`committed runtime lock does not resolve exact ${FEYNMAN_PI_TELEMETRY_PACKAGE}@${FEYNMAN_PI_TELEMETRY_VERSION} at ${packagePath}`,
		);
	}
}

export function verifyPiTelemetryRuntimeLockContract(
	runtimeLock,
	expectedVersion,
	fail,
) {
	verifyExpectedVersion(expectedVersion, fail);
	if (
		runtimeLock.packages?.[""]?.dependencies?.[
			FEYNMAN_PI_TELEMETRY_PACKAGE
		] !== FEYNMAN_PI_TELEMETRY_VERSION
	) {
		fail(
			`committed runtime lock does not directly pin ${FEYNMAN_PI_TELEMETRY_PACKAGE}@${FEYNMAN_PI_TELEMETRY_VERSION}`,
		);
	}
	const packages = Object.entries(runtimeLock.packages ?? {}).filter(
		([packagePath]) => isPiTelemetryLockPath(packagePath),
	);
	const expectedPaths = new Set(PI_TELEMETRY_LOCK_PATHS);
	for (const [packagePath] of packages) {
		if (!expectedPaths.has(packagePath)) {
			fail(
				`committed runtime lock has unapproved Pi telemetry placement: ${packagePath}`,
			);
		}
	}
	for (const packagePath of expectedPaths) {
		if (!packages.some(([observedPath]) => observedPath === packagePath)) {
			fail(`committed runtime lock is missing Pi telemetry placement: ${packagePath}`);
		}
	}
	const canonicalIntegrity =
		runtimeLock.packages?.[PI_TELEMETRY_LOCK_PATHS[0]]?.integrity;
	if (canonicalIntegrity !== FEYNMAN_PI_TELEMETRY_INTEGRITY) {
		fail(
			`committed runtime lock does not bind ${FEYNMAN_PI_TELEMETRY_PACKAGE}@${FEYNMAN_PI_TELEMETRY_VERSION} to the reviewed npm integrity`,
		);
	}
	for (const [packagePath, entry] of packages) {
		verifyPiTelemetryLockEntry(
			entry,
			packagePath,
			canonicalIntegrity,
			fail,
		);
	}
}

export function verifyPiTelemetryArchiveContract(
	readArchivedJson,
	expectedVersion,
	fail,
) {
	verifyExpectedVersion(expectedVersion, fail);
	verifyPiTelemetryRuntimeLockContract(
		readArchivedJson("npm/package-lock.json"),
		expectedVersion,
		fail,
	);
	for (const entryPath of PI_TELEMETRY_ARCHIVE_MANIFEST_PATHS) {
		const manifest = readArchivedJson(entryPath);
		if (
			manifest?.name !== FEYNMAN_PI_TELEMETRY_PACKAGE ||
			manifest?.version !== FEYNMAN_PI_TELEMETRY_VERSION
		) {
			fail(
				`runtime archive ${entryPath} is not exact ${FEYNMAN_PI_TELEMETRY_PACKAGE}@${FEYNMAN_PI_TELEMETRY_VERSION}`,
			);
		}
	}
}
