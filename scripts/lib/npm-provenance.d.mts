export interface NpmProvenanceExpectation {
	name: string;
	version: string;
	integrity: string;
	repository: string;
	workflowPath: string;
	ref?: string;
	registry?: string;
	/** Supply both positive decimal IDs to require the exact immutable OIDC subject. */
	repositoryOwnerId?: string;
	repositoryId?: string;
}

export function resolveVerifiedNpmSourceCommit(
	audit: unknown,
	expected: NpmProvenanceExpectation,
): string;
