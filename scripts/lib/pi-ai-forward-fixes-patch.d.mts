export declare const PI_AI_FORWARD_FIX_REQUIRED_VERSION: "0.85.1";
export declare const PI_AI_FORWARD_FIX_TARGETS: readonly string[];
export declare const PI_AI_FORWARD_FIX_RUNTIME_TARGETS: readonly string[];
export declare const PI_AI_FORWARD_FIX_MARKERS: Readonly<{
	googleGenerativeAi: string;
	googleShared: string;
	googleVertex: string;
	bedrock: string;
	bedrockToolResultImages: string;
	toolChoice: string;
	openAiCompletions: string;
	providerRetry: string;
}>;
export declare function assertPiAiForwardFixSource(relativePath: string, source: string): void;
export declare function patchPiAiForwardFixSource(relativePath: string, source: string): string;
