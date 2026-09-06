import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { resolveVerifiedNpmSourceCommit } from "./lib/npm-provenance.mjs";

const [auditPath, name, version, integrity, repository, workflowPath, ref, repositoryOwnerId, repositoryId] =
	process.argv.slice(2);
if (!auditPath || !name || !version || !integrity || !repository || !workflowPath || process.argv.length > 11) {
	console.error(
		"Usage: node scripts/verify-npm-provenance.mjs <audit-json> <name> <version> <integrity> <repository-url> <workflow-path> [ref [repository-owner-id repository-id]]",
	);
	process.exit(1);
}

const audit = JSON.parse(readFileSync(resolve(auditPath), "utf8"));
const commit = resolveVerifiedNpmSourceCommit(audit, {
	name,
	version,
	integrity,
	repository,
	workflowPath,
	ref,
	repositoryOwnerId,
	repositoryId,
});
process.stdout.write(`${commit}\n`);
