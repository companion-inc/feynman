import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, realpathSync, unlinkSync } from "node:fs";
import { join, posix, relative, sep } from "node:path";

const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const fail = message => { throw new Error(`Publish dependency pruning: ${message}`); };
const sort = values => [...values].sort();
const PACKAGE_SEGMENT = "(?:@[A-Za-z0-9._-]+/)?[A-Za-z0-9._-]+";
const LOCK_PACKAGE_PATH = new RegExp(`^node_modules/${PACKAGE_SEGMENT}(?:/node_modules/${PACKAGE_SEGMENT})*$`);

function plainPath(root, path, allowMissing = false) {
	if (!path || path.includes("\\") || posix.normalize(path) !== path ||
		path.startsWith("/") || path.split("/").some(part => part === "." || part === "..")) {
		fail(`unsafe path ${path}`);
	}
	let current = root;
	for (const part of path.split("/")) {
		current = join(current, part);
		try {
			if (lstatSync(current).isSymbolicLink()) fail(`symlink path ${path}`);
		} catch (error) {
			if (allowMissing && error.code === "ENOENT") return undefined;
			throw error;
		}
	}
	return current;
}

function sourceMap(bytes) {
	try {
		const value = JSON.parse(bytes.toString("utf8"));
		return value?.version === 3 && (
			(Array.isArray(value.sources) && typeof value.mappings === "string") ||
			(Array.isArray(value.sections) && value.sections.length > 0 &&
				value.sections.every(section => section && typeof section.offset === "object" &&
					(section.map?.version === 3 || typeof section.url === "string")))
		);
	} catch {
		return false;
	}
}

function referencedMaps(manifest) {
	const paths = new Set();
	function visit(value) {
		if (typeof value === "string" && value.endsWith(".map")) paths.add(value.replace(/^\.\//, ""));
		else if (value && typeof value === "object") Object.values(value).forEach(visit);
	}
	for (const key of ["main", "module", "bin", "exports", "imports", "browser", "types", "typings"]) visit(manifest[key]);
	return paths;
}

/**
 * Read-only plan for source maps in the actual lock-marked bundled dependency
 * graph. Never visits runtime archives, app output, arbitrary dev dependencies,
 * nested node_modules via recursive traversal, or symlink targets.
 */
export function planPublishDependencyPruning(packageRoot) {
	const root = realpathSync(packageRoot);
	const manifestBytes = readFileSync(plainPath(root, "package.json"));
	const lockBytes = readFileSync(plainPath(root, "package-lock.json"));
	const manifest = JSON.parse(manifestBytes), lock = JSON.parse(lockBytes);
	const bundles = manifest.bundleDependencies;
	if (!Array.isArray(bundles) || !bundles.every(name => typeof name === "string" &&
		/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/.test(name)) ||
		new Set(bundles).size !== bundles.length || !lock.packages ||
		lock.packages[""]?.name !== manifest.name || lock.packages[""]?.version !== manifest.version ||
		JSON.stringify(sort(lock.packages[""]?.bundleDependencies ?? [])) !== JSON.stringify(sort(bundles))) {
		fail("root manifest and locked bundle graph must agree");
	}
	for (const name of bundles) {
		if (lock.packages[`node_modules/${name}`]?.inBundle !== true) fail(`missing bundled identity ${name}`);
	}
	const files = [], skipped = [];
	for (const [owner, entry] of Object.entries(lock.packages).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
		if (!owner || entry?.inBundle !== true) continue;
		if (!LOCK_PACKAGE_PATH.test(owner) || entry.link || entry.dev === true) fail(`invalid bundled owner ${owner}`);
		const directory = plainPath(root, owner, entry.optional === true);
		if (!directory) continue;
		if (!lstatSync(directory).isDirectory()) fail(`bundled owner is not a directory: ${owner}`);
		const installed = JSON.parse(readFileSync(plainPath(root, `${owner}/package.json`)));
		if (typeof entry.version !== "string" || installed.version !== entry.version) fail(`bundled version mismatch at ${owner}`);
		const referenced = referencedMaps(installed);
		function walk(path) {
			for (const name of readdirSync(path).sort()) {
				if (name === "node_modules") continue;
				const item = join(path, name), stats = lstatSync(item);
				const rel = relative(root, item).split(sep).join("/");
				if (stats.isSymbolicLink()) { skipped.push({ path: rel, reason: "symlink" }); continue; }
				if (stats.isDirectory()) { walk(item); continue; }
				if (!stats.isFile() || !name.endsWith(".map")) continue;
				const local = relative(directory, item).split(sep).join("/");
				if ((stats.mode & 0o111) !== 0 || /^(?:licen[cs]e|copying|notice|third.party)/i.test(name) ||
					referenced.has(local)) {
					skipped.push({ path: rel, reason: "protected map" }); continue;
				}
				const bytes = readFileSync(item);
				if (!sourceMap(bytes)) { skipped.push({ path: rel, reason: "not a source map" }); continue; }
				files.push({ path: rel, owner, bytes: bytes.length, sha256: digest(bytes) });
			}
		}
		walk(directory);
	}
	files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
	return { packageRoot: root, manifestSha256: digest(manifestBytes), lockSha256: digest(lockBytes),
		files, skipped, totalBytes: files.reduce((sum, file) => sum + file.bytes, 0) };
}

/**
 * Defaults to dry-run. Apply only in the parent's serialized post-build,
 * post-patch, post-prepare publish stage. Deletes regular files individually,
 * never directories. An expected plan binds preflight to inspected bytes.
 * This is not a concurrent-filesystem transaction; exclusive ownership is
 * required. If another writer races, the operation may abort after some maps.
 */
export function prunePublishDependencySourceMaps(packageRoot, { apply = false, expectedPlan } = {}) {
	if (typeof apply !== "boolean") fail("apply must be an explicit boolean");
	const plan = planPublishDependencyPruning(packageRoot);
	if (expectedPlan && JSON.stringify(plan) !== JSON.stringify(expectedPlan)) fail("plan changed before application");
	if (!apply) return { ...plan, applied: false, removedFiles: 0 };
	// Finish all static preflight before the first unlink.
	for (const file of plan.files) {
		const path = plainPath(plan.packageRoot, file.path);
		if (!lstatSync(path).isFile() || digest(readFileSync(path)) !== file.sha256) fail(`map changed: ${file.path}`);
	}
	for (const file of plan.files) {
		const path = plainPath(plan.packageRoot, file.path);
		if (!lstatSync(path).isFile() || digest(readFileSync(path)) !== file.sha256) fail(`map changed: ${file.path}`);
		unlinkSync(path);
	}
	return { ...plan, applied: true, removedFiles: plan.files.length };
}
