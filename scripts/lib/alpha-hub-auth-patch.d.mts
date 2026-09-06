export declare const ALPHA_HUB_AUTH_014_SOURCE_CONTRACT: Readonly<{
	version: "0.1.4";
	upstreamSha256: string;
	patchedSha256: string;
}>;
export declare function assertAlphaHubAuthSource(source: string): void;
export declare function patchAlphaHubAuthSource(source: string, options?: { version?: string }): string;
