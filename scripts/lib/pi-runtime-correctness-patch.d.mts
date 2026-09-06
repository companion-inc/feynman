export declare const PI_RUNTIME_CORRECTNESS_PATCH_TARGETS: Readonly<{
	codingAgent: readonly string[];
	piAi: readonly string[];
}>;
export declare const PI_RUNTIME_CORRECTNESS_REQUIRED_VERSION: "0.85.1";
export declare const PI_CODING_AGENT_FORWARD_FIX_TARGETS: readonly string[];
export declare const PI_CODING_AGENT_FORWARD_FIX_MARKERS: Readonly<{
	largeToolRender: string;
	toolReleaseRedirect: string;
	exifAfterXmp: string;
}>;
export declare const PI_RUNTIME_CORRECTNESS_PATCH_MARKERS: Readonly<{
	agentSession: string;
	sessionManager: string;
	sessionTailRepair: string;
	transformMessages: string;
	githubCopilotDeviceCode: string;
	githubCopilotOAuth: string;
	imageQueue: string;
	turnEndMessages: string;
	interleavedUserContent: string;
}>;
export declare const PI_RUNTIME_CORRECTNESS_REQUIRED_FRAGMENTS: Readonly<{
	agentSession: readonly string[];
	sessionManager: readonly string[];
	transformMessages: readonly string[];
	githubCopilotDeviceCode: readonly string[];
	githubCopilotOAuth: readonly string[];
}>;
export declare const PI_RUNTIME_CORRECTNESS_FORBIDDEN_FRAGMENTS: Readonly<{
	agentSession: readonly string[];
	sessionManager: readonly string[];
	transformMessages: readonly string[];
	githubCopilotDeviceCode: readonly string[];
	githubCopilotOAuth: readonly string[];
}>;
export declare function assertPiRuntimeCorrectnessVersion(version: string | undefined, surface: string): void;
export declare function assertPiCodingAgentForwardFixSource(
	relativePath: string,
	source: string,
	surface?: string,
): void;
export declare function patchPiCodingAgentForwardFixSource(relativePath: string, source: string): string;
export declare function assertPiRuntimeCorrectnessPatchSource(
	source: string,
	target:
		| "agentSession"
		| "sessionManager"
		| "transformMessages"
		| "githubCopilotDeviceCode"
		| "githubCopilotOAuth",
	surface?: string,
): void;
export declare function patchPiAgentSessionSource(source: string): string;
export declare function patchPiSessionManagerSource(source: string): string;
export declare function patchPiTransformMessagesSource(source: string): string;
export declare function patchPiGithubCopilotDeviceCodeSource(source: string): string;
export declare function patchPiGithubCopilotOAuthSource(source: string): string;
