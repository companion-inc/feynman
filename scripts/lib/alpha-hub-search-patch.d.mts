export declare const ALPHA_HUB_SEARCH_014_SOURCE_CONTRACT: Readonly<{
	version: "0.1.4";
	upstreamSha256: string;
	patchedSha256: string;
}>;
export declare const ALPHA_HUB_RESULTS_014_SOURCE_CONTRACT: Readonly<{
	version: "0.1.4";
	upstreamSha256: string;
	patchedSha256: string;
}>;
export declare function assertAlphaHubSearchSource(source: string): void;
export declare function assertAlphaHubSearchResultsSource(source: string): void;
export declare function patchAlphaHubSearchSource(source: string, options?: { version?: string }): string;
export declare function patchAlphaHubSearchResultsSource(source: string, options?: { version?: string }): string;
