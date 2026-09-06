export const FEYNMAN_PI_TELEMETRY_PACKAGE: "@earendil-works/pi-telemetry";
export const FEYNMAN_PI_TELEMETRY_VERSION: "0.85.1";
export const FEYNMAN_PI_TELEMETRY_RESOLVED: "https://registry.npmjs.org/@earendil-works/pi-telemetry/-/pi-telemetry-0.85.1.tgz";
export const FEYNMAN_PI_TELEMETRY_INTEGRITY: "sha512-Bg/YN6kA7Swja/NQxka8xFdecb4E/auIEGF2G5A25EaQXhRnPj300/7/KpgsDDMYUzHTDAv4RyUxaQPJKW81Rw==";

export interface PiTelemetryLockEntry {
	dependencies?: Record<string, string>;
	integrity?: string;
	name?: string;
	resolved?: string;
	version?: string;
}

export interface PiTelemetryRuntimeLock {
	packages?: Record<string, PiTelemetryLockEntry>;
}

export type PiTelemetryContractFailure = (message: string) => never;
export type ReadArchivedJson = (entryPath: string) => unknown;

export function resolvePiTelemetryRuntimeVersion(
	lockedVersion: string | undefined,
	hasRootPackageLock: boolean,
): "0.85.1";

export function verifyPiTelemetryRuntimeLockContract(
	runtimeLock: PiTelemetryRuntimeLock,
	expectedVersion: string,
	fail: PiTelemetryContractFailure,
): void;

export function verifyPiTelemetryArchiveContract(
	readArchivedJson: ReadArchivedJson,
	expectedVersion: string,
	fail: PiTelemetryContractFailure,
): void;
