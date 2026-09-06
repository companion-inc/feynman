export interface PublishDependencyPruningPlan {
	packageRoot: string;
	manifestSha256: string;
	lockSha256: string;
	files: Array<{ path: string; owner: string; bytes: number; sha256: string }>;
	skipped: Array<{ path: string; reason: string }>;
	totalBytes: number;
}
export declare function planPublishDependencyPruning(packageRoot: string): PublishDependencyPruningPlan;
export declare function prunePublishDependencySourceMaps(
	packageRoot: string,
	options?: { apply?: boolean; expectedPlan?: PublishDependencyPruningPlan },
): PublishDependencyPruningPlan & { applied: boolean; removedFiles: number };
