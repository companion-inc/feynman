import { createHash } from "node:crypto";
import {
	existsSync,
	lstatSync,
	readFileSync,
	readdirSync,
	readlinkSync,
	writeFileSync,
} from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { gunzipSync } from "node:zlib";

export const RUNTIME_INPUT_FILES = Object.freeze([
	"scripts/prepare-runtime-workspace.mjs",
	"scripts/prune-runtime-deps.mjs",
	"package.json",
	".feynman/runtime-package-lock.json",
	".feynman/settings.json",
	"scripts/lib/pi-agent-core-patch.mjs",
	"scripts/lib/pi-runtime-correctness-patch.mjs",
	"scripts/lib/pi-llama-usage-patch.mjs",
	"scripts/lib/pi-extension-loader-patch.mjs",
	"scripts/lib/pi-tui-patch.mjs",
	"scripts/lib/pi-web-access-patch.mjs",
	"scripts/lib/pi-subagents-patch.mjs",
	"scripts/lib/pi-otel-patch.mjs",
	"scripts/lib/pi-session-search-patch.mjs",
	"scripts/lib/pi-model-registry-patch.mjs",
	"scripts/lib/pi-shrinkwrap-security-patch.mjs",
	"scripts/lib/pi-undici-proxy-patch.mjs",
	"scripts/lib/alpha-hub-auth-patch.mjs",
	"scripts/lib/alpha-hub-ask-patch.mjs",
	"scripts/lib/alpha-hub-search-patch.mjs",
	"scripts/lib/mcp-sdk-package-patch.mjs",
	"scripts/lib/deterministic-archive.mjs",
	"scripts/lib/runtime-workspace-integrity.mjs",
]);

const RUNTIME_TREE_EXCLUDES = new Set([".runtime-manifest.json"]);

export function parseExactRuntimePackageSpec(spec) {
	const separator = spec.lastIndexOf("@");
	if (separator <= 0 || separator === spec.length - 1) {
		throw new Error(`Runtime package must use an exact spec: ${spec}`);
	}
	return {
		name: spec.slice(0, separator),
		version: spec.slice(separator + 1),
	};
}

function readPackageVersion(packageJsonPath) {
	try {
		const manifest = JSON.parse(readFileSync(packageJsonPath, "utf8"));
		return typeof manifest.version === "string" ? manifest.version : undefined;
	} catch {
		return undefined;
	}
}

export function workspacePackagesMatch(nodeModulesPath, packageSpecs) {
	return packageSpecs.every((spec) => {
		const { name, version } = parseExactRuntimePackageSpec(spec);
		return readPackageVersion(resolve(nodeModulesPath, ...name.split("/"), "package.json")) === version;
	});
}

export function runtimeManifestPackagesMatch(
	nodeModulesPath,
	manifestPackageSpecs,
	configuredPackageSpecs = manifestPackageSpecs,
) {
	if (!configuredPackageSpecs.every((spec) => manifestPackageSpecs.includes(spec))) {
		return false;
	}
	return workspacePackagesMatch(nodeModulesPath, manifestPackageSpecs);
}

export function computeFileSha256(path) {
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function normalizeRelativePath(path) {
	const normalized = path.split(sep).join("/").replace(/^\.\//, "");
	if (
		!normalized ||
		normalized.startsWith("/") ||
		normalized === ".." ||
		normalized.startsWith("../") ||
		normalized.includes("/../")
	) {
		throw new Error(`Expected a normalized relative path, received: ${path}`);
	}
	return normalized;
}

export function computeRuntimeInputHash(rootPath, inputFiles = RUNTIME_INPUT_FILES) {
	const hash = createHash("sha256");
	for (const label of [...new Set(inputFiles.map(normalizeRelativePath))].sort()) {
		const path = resolve(rootPath, ...label.split("/"));
		hash.update(label);
		hash.update("\0");
		hash.update(existsSync(path) ? computeFileSha256(path) : "missing");
		hash.update("\0");
	}
	return hash.digest("hex");
}

function collectRuntimeTreeEntries(rootPath, currentPath, entries) {
	for (const entry of readdirSync(currentPath, { withFileTypes: true })) {
		const path = resolve(currentPath, entry.name);
		const label = normalizeRelativePath(relative(rootPath, path));
		if (RUNTIME_TREE_EXCLUDES.has(label)) continue;

		const stat = lstatSync(path);
		if (stat.isDirectory()) {
			collectRuntimeTreeEntries(rootPath, path, entries);
			continue;
		}
		if (stat.isSymbolicLink()) {
			entries.push({
				label,
				type: "symlink",
				value: readlinkSync(path).split(sep).join("/"),
			});
			continue;
		}
		if (stat.isFile()) {
			entries.push({
				label,
				type: "file",
				value: computeFileSha256(path),
			});
			continue;
		}
		throw new Error(`Unsupported runtime workspace entry: ${path}`);
	}
}

export function computeRuntimeTreeHash(rootPath) {
	if (!existsSync(rootPath)) {
		throw new Error(`Runtime workspace does not exist: ${rootPath}`);
	}
	const entries = [];
	collectRuntimeTreeEntries(rootPath, rootPath, entries);
	entries.sort((left, right) => left.label.localeCompare(right.label));

	const hash = createHash("sha256");
	for (const entry of entries) {
		hash.update(entry.label);
		hash.update("\0");
		hash.update(entry.type);
		hash.update("\0");
		hash.update(entry.value);
		hash.update("\0");
	}
	return hash.digest("hex");
}

export function computeRuntimeArchiveTreeHash(archivePath) {
	const tarball = gunzipSync(readFileSync(archivePath));
	const entries = [];
	let offset = 0;
	let nextPax = {};
	let nextLongPath;
	let sawWorkspace = false;

	while (offset + 512 <= tarball.length) {
		const header = tarball.subarray(offset, offset + 512);
		if (header.every((byte) => byte === 0)) break;

		const readField = (start, length) =>
			header.subarray(start, start + length).toString("utf8").replace(/\0.*$/s, "");
		const sizeSource = readField(124, 12).trim();
		const size = sizeSource ? Number.parseInt(sizeSource, 8) : 0;
		if (!Number.isSafeInteger(size) || size < 0) {
			throw new Error(`Invalid runtime archive entry size at byte ${offset}`);
		}
		const type = String.fromCharCode(header[156] || 48);
		const contentStart = offset + 512;
		const contentEnd = contentStart + size;
		if (contentEnd > tarball.length) {
			throw new Error(`Truncated runtime archive entry at byte ${offset}`);
		}
		const content = tarball.subarray(contentStart, contentEnd);
		const prefix = readField(345, 155);
		const headerPath = [prefix, readField(0, 100)].filter(Boolean).join("/");
		const headerLink = readField(157, 100);

		if (type === "x" || type === "g") {
			const pax = {};
			let paxOffset = 0;
			while (paxOffset < content.length) {
				const space = content.indexOf(0x20, paxOffset);
				if (space === -1) throw new Error("Invalid PAX record length");
				const recordLength = Number.parseInt(
					content.subarray(paxOffset, space).toString("ascii"),
					10,
				);
				if (!Number.isSafeInteger(recordLength) || recordLength <= 0) {
					throw new Error("Invalid PAX record size");
				}
				const recordEnd = paxOffset + recordLength;
				const record = content.subarray(space + 1, recordEnd - 1).toString("utf8");
				const equals = record.indexOf("=");
				if (equals > 0) pax[record.slice(0, equals)] = record.slice(equals + 1);
				paxOffset = recordEnd;
			}
			nextPax = type === "g" ? { ...nextPax, ...pax } : pax;
		} else if (type === "L") {
			nextLongPath = content.toString("utf8").replace(/\0.*$/s, "");
		} else {
			const archivePath = nextPax.path ?? nextLongPath ?? headerPath;
			const linkPath = nextPax.linkpath ?? headerLink;
			nextPax = {};
			nextLongPath = undefined;
			if (archivePath === "npm" || archivePath === "npm/") {
				sawWorkspace = true;
			} else if (archivePath.startsWith("npm/")) {
				sawWorkspace = true;
				const label = normalizeRelativePath(archivePath.slice("npm/".length));
				if (!RUNTIME_TREE_EXCLUDES.has(label)) {
					if (type === "0" || type === "\0") {
						entries.push({
							label,
							type: "file",
							value: createHash("sha256").update(content).digest("hex"),
						});
					} else if (type === "2") {
						entries.push({ label, type: "symlink", value: linkPath });
					} else if (type === "1") {
						const targetPath = linkPath.replace(/^\.\//, "");
						if (!targetPath.startsWith("npm/")) {
							throw new Error(
								`Runtime archive hardlink target is outside npm/: ${linkPath}`,
							);
						}
						entries.push({
							label,
							type: "hardlink",
							value: normalizeRelativePath(targetPath.slice("npm/".length)),
						});
					} else if (type !== "5") {
						throw new Error(`Unsupported runtime archive entry type ${type}: ${archivePath}`);
					}
				}
			} else {
				throw new Error(`Runtime archive entry is outside npm/: ${archivePath}`);
			}
		}

		offset = contentStart + Math.ceil(size / 512) * 512;
	}
	if (!sawWorkspace) throw new Error("Runtime archive does not contain the npm workspace");
	const entriesByLabel = new Map();
	for (const entry of entries) {
		if (entriesByLabel.has(entry.label)) {
			throw new Error(`Duplicate runtime archive entry: ${entry.label}`);
		}
		entriesByLabel.set(entry.label, entry);
	}
	const resolveHardlink = (entry, seen = new Set()) => {
		if (entry.type !== "hardlink") return entry;
		if (seen.has(entry.label)) {
			throw new Error(`Runtime archive hardlink cycle: ${[...seen, entry.label].join(" -> ")}`);
		}
		const target = entriesByLabel.get(entry.value);
		if (!target) {
			throw new Error(
				`Runtime archive hardlink target is missing: ${entry.label} -> ${entry.value}`,
			);
		}
		return resolveHardlink(target, new Set([...seen, entry.label]));
	};
	const normalizedEntries = entries.map((entry) => {
		const resolved = resolveHardlink(entry);
		return {
			label: entry.label,
			type: resolved.type,
			value: resolved.value,
		};
	});
	normalizedEntries.sort((left, right) => left.label.localeCompare(right.label));
	const hash = createHash("sha256");
	for (const entry of normalizedEntries) {
		hash.update(entry.label);
		hash.update("\0");
		hash.update(entry.type);
		hash.update("\0");
		hash.update(entry.value);
		hash.update("\0");
	}
	return hash.digest("hex");
}

export function writeFileSha256(path, digestPath) {
	const digest = computeFileSha256(path);
	writeFileSync(digestPath, `${digest}  ${path.split(/[\\/]/).at(-1)}\n`, "utf8");
	return digest;
}

export function verifyFileSha256(path, digestPath) {
	if (!existsSync(path) || !existsSync(digestPath)) {
		return false;
	}
	const expected = readFileSync(digestPath, "utf8").trim().split(/\s+/, 1)[0];
	return /^[a-f0-9]{64}$/.test(expected) && computeFileSha256(path) === expected;
}

export function filesMatch(leftPath, rightPath) {
	if (!existsSync(leftPath) || !existsSync(rightPath)) {
		return false;
	}
	return readFileSync(leftPath).equals(readFileSync(rightPath));
}

export function readArchiveEntry(archivePath, entryPath) {
	const tarball = gunzipSync(readFileSync(archivePath));
	const requestedPath = entryPath.replace(/^\.\//, "").replace(/\/$/, "");
	const entries = new Map();
	let offset = 0;
	let globalPax = {};
	let nextPax = {};
	let nextLongPath;

	while (offset + 512 <= tarball.length) {
		const header = tarball.subarray(offset, offset + 512);
		if (header.every((byte) => byte === 0)) break;

		const readField = (start, length) =>
			header.subarray(start, start + length).toString("utf8").replace(/\0.*$/s, "");
		const sizeSource = readField(124, 12).trim();
		const size = sizeSource ? Number.parseInt(sizeSource, 8) : 0;
		if (!Number.isSafeInteger(size) || size < 0) {
			throw new Error(`Invalid runtime archive entry size at byte ${offset}`);
		}
		const type = String.fromCharCode(header[156] || 48);
		const contentStart = offset + 512;
		const contentEnd = contentStart + size;
		if (contentEnd > tarball.length) {
			throw new Error(`Truncated runtime archive entry at byte ${offset}`);
		}
		const content = tarball.subarray(contentStart, contentEnd);
		const prefix = readField(345, 155);
		const headerPath = [prefix, readField(0, 100)].filter(Boolean).join("/");
		const headerLink = readField(157, 100);

		if (type === "x" || type === "g") {
			const pax = {};
			let paxOffset = 0;
			while (paxOffset < content.length) {
				const space = content.indexOf(0x20, paxOffset);
				if (space === -1) throw new Error("Invalid PAX record length");
				const recordLength = Number.parseInt(
					content.subarray(paxOffset, space).toString("ascii"),
					10,
				);
				if (!Number.isSafeInteger(recordLength) || recordLength <= 0) {
					throw new Error("Invalid PAX record size");
				}
				const recordEnd = paxOffset + recordLength;
				const record = content.subarray(space + 1, recordEnd - 1).toString("utf8");
				const equals = record.indexOf("=");
				if (equals > 0) pax[record.slice(0, equals)] = record.slice(equals + 1);
				paxOffset = recordEnd;
			}
			if (type === "g") globalPax = { ...globalPax, ...pax };
			else nextPax = pax;
		} else if (type === "L") {
			nextLongPath = content.toString("utf8").replace(/\0.*$/s, "");
		} else {
			const pax = { ...globalPax, ...nextPax };
			const archiveEntryPath = (pax.path ?? nextLongPath ?? headerPath)
				.replace(/^\.\//, "")
				.replace(/\/$/, "");
			const linkPath = (pax.linkpath ?? headerLink).replace(/^\.\//, "");
			nextPax = {};
			nextLongPath = undefined;

			if (type === "0" || type === "\0") {
				if (archiveEntryPath === requestedPath) return content.toString("utf8");
				entries.set(archiveEntryPath, { type: "file", content });
			} else if (type === "1") {
				entries.set(archiveEntryPath, { type: "hardlink", target: linkPath });
			}
		}

		offset = contentStart + Math.ceil(size / 512) * 512;
	}

	const resolveEntry = (path, seen = new Set()) => {
		const entry = entries.get(path);
		if (!entry) return undefined;
		if (entry.type === "file") return entry.content;
		if (seen.has(path)) {
			throw new Error(`Runtime archive hardlink cycle: ${[...seen, path].join(" -> ")}`);
		}
		return resolveEntry(entry.target, new Set([...seen, path]));
	};
	return resolveEntry(requestedPath)?.toString("utf8");
}

export function runtimeArchiveMatches({
	archivePath,
	digestPath,
	lockPath,
	manifestPath,
	packageSpecs,
	runtimeInputHash,
}) {
	if (
		!verifyFileSha256(archivePath, digestPath) ||
		!existsSync(lockPath) ||
		!existsSync(manifestPath)
	) {
		return false;
	}
	const archivedLock = readArchiveEntry(archivePath, "npm/package-lock.json");
	if (archivedLock === undefined || archivedLock !== readFileSync(lockPath, "utf8")) {
		return false;
	}
	const manifestSource = readFileSync(manifestPath, "utf8");
	if (readArchiveEntry(archivePath, "npm/.runtime-manifest.json") !== manifestSource) {
		return false;
	}
	let manifest;
	try {
		manifest = JSON.parse(manifestSource);
	} catch {
		return false;
	}
	if (
		typeof runtimeInputHash !== "string" ||
		manifest.runtimeInputHash !== runtimeInputHash ||
		typeof manifest.runtimeTreeHash !== "string" ||
		!/^[a-f0-9]{64}$/.test(manifest.runtimeTreeHash) ||
		(typeof manifest.workspaceTreeHash !== "undefined" &&
			(typeof manifest.workspaceTreeHash !== "string" ||
				!/^[a-f0-9]{64}$/.test(manifest.workspaceTreeHash)))
	) {
		return false;
	}
	try {
		const workspacePath = dirname(manifestPath);
		if (
			computeRuntimeTreeHash(workspacePath) !==
				(manifest.workspaceTreeHash ?? manifest.runtimeTreeHash) ||
			computeRuntimeArchiveTreeHash(archivePath) !== manifest.runtimeTreeHash
		) {
			return false;
		}
	} catch {
		return false;
	}
	return packageSpecs.every((spec) => {
		const { name, version } = parseExactRuntimePackageSpec(spec);
		const source = readArchiveEntry(
			archivePath,
			`npm/node_modules/${name}/package.json`,
		);
		if (!source) return false;
		try {
			return JSON.parse(source).version === version;
		} catch {
			return false;
		}
	});
}
