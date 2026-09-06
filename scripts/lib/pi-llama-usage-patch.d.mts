export declare const PI_LLAMA_USAGE_REQUIRED_VERSION: "0.85.1";
export declare const PI_LLAMA_USAGE_PATCH_MARKER: string;
export declare const PI_LLAMA_USAGE_REQUIRED_FRAGMENTS: readonly string[];
export declare function assertPiLlamaUsageVersion(
	version: string | undefined,
	surface: string,
): void;
export declare function assertPiLlamaUsagePatchSource(
	source: string,
	surface?: string,
): void;
export declare function patchPiLlamaUsageSource(source: string): string;
