import {
	createReadStream,
	createWriteStream,
	lstatSync,
	lutimesSync,
	mkdtempSync,
	readdirSync,
	rmSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { createGzip } from "node:zlib";
import { pipeline } from "node:stream/promises";

export const ARCHIVE_EPOCH_MS = Date.UTC(2000, 0, 1, 0, 0, 0);

function normalizeLabel(path) {
	return path.split(sep).join("/");
}

function walkArchiveTree(rootPath, currentPath, entries) {
	const stat = lstatSync(currentPath);
	entries.push(normalizeLabel(relative(dirname(rootPath), currentPath)));
	if (!stat.isDirectory()) return;
	for (const entry of readdirSync(currentPath, { withFileTypes: true })
		.sort((left, right) => left.name.localeCompare(right.name, "en"))) {
		walkArchiveTree(rootPath, resolve(currentPath, entry.name), entries);
	}
}

export function collectArchiveEntries(rootPath) {
	const resolvedRoot = resolve(rootPath);
	const entries = [];
	walkArchiveTree(resolvedRoot, resolvedRoot, entries);
	for (const entry of entries) {
		if (entry.includes("\n") || entry.includes("\r")) {
			throw new Error(`Archive paths may not contain newlines: ${entry}`);
		}
	}
	return entries;
}

function normalizeTreeTimestamp(path, date) {
	const stat = lstatSync(path);
	if (stat.isDirectory()) {
		for (const entry of readdirSync(path, { withFileTypes: true })
			.sort((left, right) => left.name.localeCompare(right.name, "en"))) {
			normalizeTreeTimestamp(resolve(path, entry.name), date);
		}
	}
	if (stat.isSymbolicLink()) {
		try {
			lutimesSync(path, date, date);
		} catch {
			// Some Windows filesystems do not expose symlink timestamp updates.
		}
		return;
	}
	utimesSync(path, date, date);
}

export function normalizeArchiveTreeTimestamps(rootPath, epochMs = ARCHIVE_EPOCH_MS) {
	normalizeTreeTimestamp(resolve(rootPath), new Date(epochMs));
}

function tarFlavor() {
	const result = spawnSync("tar", ["--version"], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});
	if (result.status !== 0) {
		throw new Error(`tar --version failed: ${result.stderr?.trim() || result.status}`);
	}
	return /bsdtar|libarchive/i.test(`${result.stdout}\n${result.stderr}`) ? "bsd" : "gnu";
}

export function deterministicTarMetadataArgs(flavor) {
	return flavor === "bsd"
		? [
			"--uid",
			"0",
			"--gid",
			"0",
			"--uname",
			"root",
			"--gname",
			"root",
			"--no-acls",
			"--no-fflags",
			"--no-mac-metadata",
			"--no-xattrs",
		]
		: [
			"--owner=0",
			"--group=0",
			"--numeric-owner",
			`--mtime=@${Math.floor(ARCHIVE_EPOCH_MS / 1000)}`,
			"--sort=name",
			"--pax-option=delete=atime,delete=ctime",
		];
}

function runArchiveCommand(command, args, options = {}) {
	const result = spawnSync(command, args, {
		stdio: "inherit",
		...options,
	});
	if (result.error) {
		throw new Error(`${command} failed: ${result.error.message}`);
	}
	if (result.status !== 0) {
		throw new Error(`${command} ${args.join(" ")} failed with code ${result.status ?? 1}`);
	}
}

function writeEntryList(rootPath, listPath) {
	const entries = collectArchiveEntries(rootPath);
	writeFileSync(listPath, `${entries.join("\n")}\n`, "utf8");
	return entries;
}

export async function createDeterministicTarGz(rootPath, archivePath) {
	const resolvedRoot = resolve(rootPath);
	const resolvedArchive = resolve(archivePath);
	normalizeArchiveTreeTimestamps(resolvedRoot);

	const tempRoot = mkdtempSync(join(tmpdir(), "feynman-tar-"));
	const listPath = resolve(tempRoot, "entries.txt");
	const tarPath = resolve(tempRoot, `${basename(resolvedArchive)}.tar`);
	writeEntryList(resolvedRoot, listPath);

	try {
		const common = [
			"--no-recursion",
			"-cf",
			tarPath,
			"-C",
			dirname(resolvedRoot),
			"-T",
			listPath,
		];
		const ownership = deterministicTarMetadataArgs(tarFlavor());
		runArchiveCommand("tar", [...ownership, ...common], {
			env: {
				...process.env,
				COPYFILE_DISABLE: "1",
				TZ: "UTC",
			},
		});
		await pipeline(
			createReadStream(tarPath),
			createGzip({ level: 9, mtime: 0 }),
			createWriteStream(resolvedArchive, { mode: 0o644 }),
		);
	} finally {
		rmSync(tempRoot, { recursive: true, force: true });
	}
	return resolvedArchive;
}

export function createDeterministicZip(rootPath, archivePath) {
	const resolvedRoot = resolve(rootPath);
	const resolvedArchive = resolve(archivePath);
	normalizeArchiveTreeTimestamps(resolvedRoot);

	const tempRoot = mkdtempSync(join(tmpdir(), "feynman-zip-"));
	const listPath = resolve(tempRoot, "entries.txt");
	writeEntryList(resolvedRoot, listPath);
	const cwd = dirname(resolvedRoot);
	const env = { ...process.env, COPYFILE_DISABLE: "1", TZ: "UTC" };

	try {
		if (process.platform === "win32") {
			runArchiveCommand(
				"7z",
				[
					"a",
					"-tzip",
					resolvedArchive,
					`@${listPath}`,
					"-mx=1",
					"-bb0",
					"-bd",
					"-mtc=off",
					"-mta=off",
					"-mtm=off",
				],
				{ cwd, env },
			);
		} else {
			const entries = collectArchiveEntries(resolvedRoot);
			const result = spawnSync("zip", ["-X", "-q", "-y", resolvedArchive, "-@"], {
				cwd,
				env,
				input: `${entries.join("\n")}\n`,
				encoding: "utf8",
				stdio: ["pipe", "inherit", "inherit"],
			});
			if (result.error) throw new Error(`zip failed: ${result.error.message}`);
			if (result.status !== 0) {
				throw new Error(`zip failed with code ${result.status ?? 1}`);
			}
		}
	} finally {
		rmSync(tempRoot, { recursive: true, force: true });
	}
	return resolvedArchive;
}
