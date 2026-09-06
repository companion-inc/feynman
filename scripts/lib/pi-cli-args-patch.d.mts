export declare const PI_CLI_ARGS_REQUIRED_VERSION: "0.85.1";
export declare const PI_CLI_ARGS_UPSTREAM_FIX: "https://github.com/earendil-works/pi/commit/74786a748f5314cc2127ebbcfa2d732e9b8433f5";
export declare const PI_CLI_ARGS_UPSTREAM_DOCS: "https://github.com/earendil-works/pi/commit/62bcbf6be0206cc4fd2ca0e35dd5eb879ca6c8e7";
export declare const LEGACY_PI_RUNTIME_PACKAGE_ALIASES: Readonly<{
	"@mariozechner/pi-agent-core": "@earendil-works/pi-agent-core";
	"@mariozechner/pi-ai": "@earendil-works/pi-ai";
	"@mariozechner/pi-coding-agent": "@earendil-works/pi-coding-agent";
	"@mariozechner/pi-tui": "@earendil-works/pi-tui";
}>;
export declare function ensureLegacyPiRuntimeAliases(
	nodeModulesRoot: string,
): number;
export declare function assertPiCliArgsVersion(
	version: string | undefined,
	label?: string,
): void;
export declare function assertPiCliArgsPatchSource(
	source: string,
	label?: string,
): void;
export declare function patchPiCliArgsSource(source: string): string;
export declare function preflightPiCliArgsPackageRoot(
	packageRoot: string | null | undefined,
	label: string,
): void;
export declare function assertPatchedPiCliArgsPackageRoot(
	packageRoot: string,
	label: string,
): void;
