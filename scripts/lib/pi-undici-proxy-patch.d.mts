export const FEYNMAN_UNDICI_VERSION: "8.10.2";

export function patchPiCodingAgentUndiciPackageJsonSource(source: string): string;
export function patchPiCodingAgentUndiciShrinkwrapSource(source: string): string;
export function assertPiCodingAgentUndiciShrinkwrapSource(
	source: string,
	surface: string,
): void;
export function patchPiUndiciPackageLockSource(source: string, requiredPiVersion?: string): string;
export function patchPiUndiciProxyTree(
	nodeModulesPath: string,
	fallbackPackagePath?: string,
	requiredPiVersion?: string,
): boolean;
