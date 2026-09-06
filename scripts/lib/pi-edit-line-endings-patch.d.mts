export declare const PI_EDIT_LINE_ENDINGS_REQUIRED_VERSION: "0.85.1";
export declare const PI_EDIT_LINE_ENDINGS_RUNTIME_TARGETS: readonly string[];
export declare const PI_EDIT_LINE_ENDINGS_TYPE_TARGETS: readonly string[];
export declare const PI_EDIT_LINE_ENDINGS_PATCH_TARGETS: readonly string[];
export declare const PI_EDIT_LINE_ENDINGS_PATCH_MARKERS: Readonly<{
	editDiff: string;
	editTypes: string;
	edit: string;
}>;
export declare function assertPiEditLineEndingsVersion(
	version: string | undefined,
	surface: string,
): void;
export declare function assertPiEditLineEndingsPatchSource(
	relativePath: string,
	source: string,
	surface?: string,
): void;
export declare function patchPiEditLineEndingsSource(
	relativePath: string,
	source: string,
): string;
