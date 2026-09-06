import assert from "node:assert/strict";
import test from "node:test";

import {
	FEYNMAN_PI_TELEMETRY_INTEGRITY,
	FEYNMAN_PI_TELEMETRY_PACKAGE,
	FEYNMAN_PI_TELEMETRY_RESOLVED,
	FEYNMAN_PI_TELEMETRY_VERSION,
	resolvePiTelemetryRuntimeVersion,
	verifyPiTelemetryArchiveContract,
	verifyPiTelemetryRuntimeLockContract,
	type PiTelemetryRuntimeLock,
} from "../scripts/lib/pi-telemetry-release-contract.mjs";

const TOP_LEVEL_LOCK_PATH =
	"node_modules/@earendil-works/pi-telemetry";
const CODING_AGENT_LOCK_PATH =
	"node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-telemetry";
const TOP_LEVEL_ARCHIVE_PATH = `npm/${TOP_LEVEL_LOCK_PATH}/package.json`;
const CODING_AGENT_ARCHIVE_PATH = `npm/${CODING_AGENT_LOCK_PATH}/package.json`;

const fail = (message: string): never => {
	throw new Error(message);
};

test("Pi telemetry runtime pin falls back only when package-lock is not shipped", () => {
	assert.equal(
		resolvePiTelemetryRuntimeVersion(undefined, false),
		FEYNMAN_PI_TELEMETRY_VERSION,
	);
	assert.equal(
		resolvePiTelemetryRuntimeVersion(FEYNMAN_PI_TELEMETRY_VERSION, true),
		FEYNMAN_PI_TELEMETRY_VERSION,
	);
	assert.throws(
		() => resolvePiTelemetryRuntimeVersion(undefined, true),
		/maintained Pi 0\.85\.1 train, found missing/,
	);
	assert.throws(
		() => resolvePiTelemetryRuntimeVersion("0.84.3", true),
		/maintained Pi 0\.85\.1 train, found 0\.84\.3/,
	);
});

function makeRuntimeLock(): PiTelemetryRuntimeLock {
	return {
		packages: {
			"": {
				dependencies: {
					[FEYNMAN_PI_TELEMETRY_PACKAGE]:
						FEYNMAN_PI_TELEMETRY_VERSION,
				},
			},
			[TOP_LEVEL_LOCK_PATH]: {
				version: FEYNMAN_PI_TELEMETRY_VERSION,
				resolved: FEYNMAN_PI_TELEMETRY_RESOLVED,
				integrity: FEYNMAN_PI_TELEMETRY_INTEGRITY,
			},
			[CODING_AGENT_LOCK_PATH]: {
				version: FEYNMAN_PI_TELEMETRY_VERSION,
				resolved: FEYNMAN_PI_TELEMETRY_RESOLVED,
			},
		},
	};
}

function verifyRuntimeLock(runtimeLock: PiTelemetryRuntimeLock) {
	verifyPiTelemetryRuntimeLockContract(
		runtimeLock,
		FEYNMAN_PI_TELEMETRY_VERSION,
		fail,
	);
}

function makeArchiveEntries() {
	return new Map<string, unknown>([
		["npm/package-lock.json", makeRuntimeLock()],
		[
			TOP_LEVEL_ARCHIVE_PATH,
			{
				name: FEYNMAN_PI_TELEMETRY_PACKAGE,
				version: FEYNMAN_PI_TELEMETRY_VERSION,
			},
		],
		[
			CODING_AGENT_ARCHIVE_PATH,
			{
				name: FEYNMAN_PI_TELEMETRY_PACKAGE,
				version: FEYNMAN_PI_TELEMETRY_VERSION,
			},
		],
	]);
}

function verifyArchive(entries: Map<string, unknown>) {
	verifyPiTelemetryArchiveContract(
		(entryPath) => {
			if (!entries.has(entryPath)) {
				throw new Error(`missing archive fixture: ${entryPath}`);
			}
			return entries.get(entryPath);
		},
		FEYNMAN_PI_TELEMETRY_VERSION,
		fail,
	);
}

test("Pi telemetry runtime lock binds the exact official 0.85.1 identity", () => {
	assert.doesNotThrow(() => verifyRuntimeLock(makeRuntimeLock()));

	for (const packagePath of [
		TOP_LEVEL_LOCK_PATH,
		CODING_AGENT_LOCK_PATH,
	]) {
		const alteredResolved = makeRuntimeLock();
		alteredResolved.packages![packagePath]!.resolved =
			"https://packages.example.invalid/pi-telemetry-0.84.2.tgz";
		assert.throws(
			() => verifyRuntimeLock(alteredResolved),
			/exact @earendil-works\/pi-telemetry@0\.85\.1/,
			`${packagePath} accepted an altered resolved URL`,
		);

		const alteredIntegrity = makeRuntimeLock();
		alteredIntegrity.packages![packagePath]!.integrity =
			"sha512-altered";
		assert.throws(
			() => verifyRuntimeLock(alteredIntegrity),
			/(reviewed npm integrity|exact @earendil-works\/pi-telemetry@0\.85\.1)/,
			`${packagePath} accepted altered integrity`,
		);

		const alteredVersion = makeRuntimeLock();
		alteredVersion.packages![packagePath]!.version = "0.84.3";
		assert.throws(
			() => verifyRuntimeLock(alteredVersion),
			/exact @earendil-works\/pi-telemetry@0\.85\.1/,
			`${packagePath} accepted version drift`,
		);
	}

	const wrongExpectedVersion = makeRuntimeLock();
	assert.throws(
		() =>
			verifyPiTelemetryRuntimeLockContract(
				wrongExpectedVersion,
				"0.84.3",
				fail,
			),
		/release contract is pinned.*0\.85\.1.*not 0\.84\.3/,
	);
});

test("Pi telemetry runtime lock rejects missing and extra placements", () => {
	for (const packagePath of [
		TOP_LEVEL_LOCK_PATH,
		CODING_AGENT_LOCK_PATH,
	]) {
		const missingPlacement = makeRuntimeLock();
		delete missingPlacement.packages![packagePath];
		assert.throws(
			() => verifyRuntimeLock(missingPlacement),
			/missing Pi telemetry placement/,
			`${packagePath} was not required`,
		);
	}

	const extraPlacement = makeRuntimeLock();
	extraPlacement.packages![
		"node_modules/unapproved/node_modules/@earendil-works/pi-telemetry"
	] = {
		version: FEYNMAN_PI_TELEMETRY_VERSION,
		resolved: FEYNMAN_PI_TELEMETRY_RESOLVED,
		integrity: FEYNMAN_PI_TELEMETRY_INTEGRITY,
	};
	assert.throws(
		() => verifyRuntimeLock(extraPlacement),
		/unapproved Pi telemetry placement/,
	);

	const missingDirectPin = makeRuntimeLock();
	delete missingDirectPin.packages![""]!.dependencies![
		FEYNMAN_PI_TELEMETRY_PACKAGE
	];
	assert.throws(
		() => verifyRuntimeLock(missingDirectPin),
		/does not directly pin @earendil-works\/pi-telemetry@0\.85\.1/,
	);

	const rangedDirectPin = makeRuntimeLock();
	rangedDirectPin.packages![""]!.dependencies![
		FEYNMAN_PI_TELEMETRY_PACKAGE
	] = "^0.84.2";
	assert.throws(
		() => verifyRuntimeLock(rangedDirectPin),
		/does not directly pin @earendil-works\/pi-telemetry@0\.85\.1/,
	);
});

test("Pi telemetry archive binds manifest names and archived lock identity", () => {
	assert.doesNotThrow(() => verifyArchive(makeArchiveEntries()));

	for (const manifestPath of [
		TOP_LEVEL_ARCHIVE_PATH,
		CODING_AGENT_ARCHIVE_PATH,
	]) {
		const wrongName = makeArchiveEntries();
		wrongName.set(manifestPath, {
			name: "@attacker/pi-telemetry",
			version: FEYNMAN_PI_TELEMETRY_VERSION,
		});
		assert.throws(
			() => verifyArchive(wrongName),
			/not exact @earendil-works\/pi-telemetry@0\.85\.1/,
			`${manifestPath} accepted the wrong package name`,
		);

		const wrongVersion = makeArchiveEntries();
		wrongVersion.set(manifestPath, {
			name: FEYNMAN_PI_TELEMETRY_PACKAGE,
			version: "0.84.3",
		});
		assert.throws(
			() => verifyArchive(wrongVersion),
			/not exact @earendil-works\/pi-telemetry@0\.85\.1/,
			`${manifestPath} accepted version drift`,
		);

		const missingManifest = makeArchiveEntries();
		missingManifest.delete(manifestPath);
		assert.throws(
			() => verifyArchive(missingManifest),
			/missing archive fixture/,
			`${manifestPath} was not required`,
		);
	}

	const alteredArchivedResolved = makeArchiveEntries();
	const resolvedLock = alteredArchivedResolved.get(
		"npm/package-lock.json",
	) as PiTelemetryRuntimeLock;
	resolvedLock.packages![TOP_LEVEL_LOCK_PATH]!.resolved =
		"https://packages.example.invalid/pi-telemetry-0.84.2.tgz";
	assert.throws(
		() => verifyArchive(alteredArchivedResolved),
		/exact @earendil-works\/pi-telemetry@0\.85\.1/,
	);

	const alteredArchivedIntegrity = makeArchiveEntries();
	const integrityLock = alteredArchivedIntegrity.get(
		"npm/package-lock.json",
	) as PiTelemetryRuntimeLock;
	integrityLock.packages![TOP_LEVEL_LOCK_PATH]!.integrity =
		"sha512-altered";
	assert.throws(
		() => verifyArchive(alteredArchivedIntegrity),
		/reviewed npm integrity/,
	);
});

test("Pi telemetry archive rejects missing and extra locked placements", () => {
	for (const packagePath of [
		TOP_LEVEL_LOCK_PATH,
		CODING_AGENT_LOCK_PATH,
	]) {
		const missingPlacement = makeArchiveEntries();
		const runtimeLock = missingPlacement.get(
			"npm/package-lock.json",
		) as PiTelemetryRuntimeLock;
		delete runtimeLock.packages![packagePath];
		assert.throws(
			() => verifyArchive(missingPlacement),
			/missing Pi telemetry placement/,
			`archive lock did not require ${packagePath}`,
		);
	}

	const extraPlacement = makeArchiveEntries();
	const runtimeLock = extraPlacement.get(
		"npm/package-lock.json",
	) as PiTelemetryRuntimeLock;
	runtimeLock.packages![
		"node_modules/unapproved/node_modules/@earendil-works/pi-telemetry"
	] = {
		version: FEYNMAN_PI_TELEMETRY_VERSION,
		resolved: FEYNMAN_PI_TELEMETRY_RESOLVED,
		integrity: FEYNMAN_PI_TELEMETRY_INTEGRITY,
	};
	assert.throws(
		() => verifyArchive(extraPlacement),
		/unapproved Pi telemetry placement/,
	);
});
