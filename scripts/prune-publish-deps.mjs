import { resolve } from "node:path";
import { prunePublishDependencySourceMaps } from "./lib/publish-dependency-pruning.mjs";

// Final prepack step: only verified source maps in the locked bundled graph.
// Executable files, declarations, licenses and platform binaries are retained.
const result = prunePublishDependencySourceMaps(resolve(import.meta.dirname, ".."), { apply: true });
console.log(JSON.stringify({
	step: "prune-publish-source-maps",
	removedFiles: result.removedFiles,
	removedBytes: result.files.reduce((total, file) => total + file.bytes, 0),
}));
