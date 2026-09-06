export interface RuntimePlatformPruningOptions {
	/** Only explicit runtime/native values are accepted at runtime. */
	kind?: unknown;
	platform?: unknown;
	arch?: unknown;
}

export interface RuntimePlatformPruningPlan {
	kind: "runtime" | "native";
	platform: string;
	arch: string;
	keep: string[];
	remove: string[];
}

export declare function planRuntimePlatformPruning(
	lock: unknown,
	options?: RuntimePlatformPruningOptions,
): RuntimePlatformPruningPlan;

export declare function validateRuntimePlatformPruning(
	workspacePath: string,
	lock: unknown,
	options?: RuntimePlatformPruningOptions,
): RuntimePlatformPruningPlan & { workspacePath: string };
