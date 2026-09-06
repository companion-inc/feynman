export const FEYNMAN_ESBUILD_VERSION: "0.28.2";
export const ESBUILD_REGISTRY_INTEGRITY: string;
export const ESBUILD_TARBALL_SHA256: string;
export const ESBUILD_OPTIONAL_DEPENDENCIES: Readonly<Record<string, string>>;
export const ESBUILD_BINARY_HASHES: Readonly<Record<string, string>>;
export const ESBUILD_SOURCE_HASHES: Readonly<Record<string, string>>;
export const ESBUILD_PLATFORM_LOCK_ENTRIES: Readonly<Record<string, Record<string, unknown>>>;
export const ESBUILD_PORTABLE_BIN_SOURCE: string;
export function assertEsbuildRootManifest(source: string): void;
export function patchPiChordEsbuildManifestSource(source: string): string;
export function patchPiEsbuildShrinkwrapSource(source: string, options?: { runtime?: boolean }): string;
export function patchPiEsbuildPackageLockSource(source: string, options?: { runtime?: boolean }): string;
export function assertEsbuildPlatformPackage(packageRoot: string): string;
export function patchPiEsbuildPackageTree(
	nodeModulesPath: string,
	sourcePackagePath?: string,
	options?: { runtime?: boolean; platform?: string; arch?: string },
): boolean;
