export function verifyPiSubagentsNativeBehavior(subagentsRoot: string, jiti: {
	import(path: string): Promise<any>;
}): Promise<{ nativeLifecycleCases: number; providerRequests: number }>;
export function assertPiSubagentUsageLimitFallbackSource(readSource: (relativePath: string) => string, label: string): void;
