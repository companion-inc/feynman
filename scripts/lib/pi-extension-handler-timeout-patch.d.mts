export declare const PI_EXTENSION_HANDLER_TIMEOUT_REQUIRED_VERSION: "0.85.1";
export declare const PI_EXTENSION_HANDLER_TIMEOUT_TARGET: "dist/core/extensions/runner.js";
export declare const PI_EXTENSION_HANDLER_TIMEOUT_MARKER: string;
export declare function assertPiExtensionHandlerTimeoutVersion(
	version: string | undefined,
	surface?: string,
): void;
export declare function assertPiExtensionHandlerTimeoutPatchSource(
	source: string,
	surface?: string,
): void;
export declare function patchPiExtensionHandlerTimeoutSource(
	source: string,
	version: string | undefined,
): string;
export declare function patchPiExtensionHandlerTimeoutPackageRoot(
	packageRoot: string,
	surface?: string,
): boolean;
