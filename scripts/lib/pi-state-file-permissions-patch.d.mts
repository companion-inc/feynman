export declare const PI_STATE_FILE_PERMISSIONS_REQUIRED_VERSION: "0.85.1";
export declare const PI_STATE_FILE_PERMISSIONS_UPSTREAM_FIX: "https://github.com/earendil-works/pi/commit/c49906ec7778";
export declare function assertPiStateFilePermissionsPatchSource(
	source: string,
	label?: string,
): void;
export declare function patchPiStateFilePermissionsSource(source: string): string;
