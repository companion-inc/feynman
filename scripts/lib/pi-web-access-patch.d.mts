export declare const PI_WEB_ACCESS_REQUIRED_VERSION: "0.28.0";
export declare const PI_WEB_ACCESS_FORWARD_FILE_TARGETS: string[];
export declare const PI_WEB_ACCESS_PATCH_TARGETS: string[];
export declare function patchPiWebAccessForwardFixSource(
	relativePath: string,
	source: string,
): string;
export declare function syncPiWebAccessForwardFiles(
	appRoot: string,
	packageRoot: string,
	version: string,
): boolean;
export declare function assertPiWebAccessVersion(version: string | undefined, surface: string): void;
export declare function assertPiWebAccessPatchedSources(
	sources: ReadonlyMap<string, string>,
	surface?: string,
): void;
export declare function patchPiWebAccessSources(
	sources: ReadonlyMap<string, string>,
	surface?: string,
): Map<string, string>;
export function patchPiWebAccessSource(relativePath: string, source: string): string;
