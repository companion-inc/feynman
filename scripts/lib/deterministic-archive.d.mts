export const ARCHIVE_EPOCH_MS: number;

export function deterministicTarMetadataArgs(flavor: "bsd" | "gnu"): string[];

export function collectArchiveEntries(rootPath: string): string[];

export function normalizeArchiveTreeTimestamps(
	rootPath: string,
	epochMs?: number,
): void;

export function createDeterministicTarGz(
	rootPath: string,
	archivePath: string,
): Promise<string>;

export function createDeterministicZip(
	rootPath: string,
	archivePath: string,
): string;
