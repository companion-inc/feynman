import test from "node:test";
import assert from "node:assert/strict";
import {
	chmodSync,
	mkdtempSync,
	mkdirSync,
	readFileSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
	assertPiStateFilePermissionsPatchSource,
	PI_STATE_FILE_PERMISSIONS_REQUIRED_VERSION,
	patchPiStateFilePermissionsSource,
} from "../scripts/lib/pi-state-file-permissions-patch.mjs";
import { verifyInstalledPiStateFilePermissions } from "../scripts/lib/pi-state-file-permissions-verifier.mjs";
import { patchPiRuntimeNodeModules } from "../src/pi/runtime-patches.js";

const piRoot = resolve(
	process.cwd(),
	"node_modules",
	"@earendil-works",
	"pi-coding-agent",
);
const authStoragePath = resolve(piRoot, "dist", "core", "auth-storage.js");
const modelsStorePath = resolve(piRoot, "dist", "core", "models-store.js");
const cliArgsSource = readFileSync(
	resolve(piRoot, "dist", "cli", "args.js"),
	"utf8",
);
const baselineSource = `
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
const AUTH_FILE_WRITE_OPTIONS = { encoding: "utf-8", mode: 0o600 };
writeFileSync(this.authPath, "{}", AUTH_FILE_WRITE_OPTIONS);
chmodSync(this.authPath, 0o600);
writeFileSync(this.authPath, next, AUTH_FILE_WRITE_OPTIONS);
chmodSync(this.authPath, 0o600);
writeFileSync(this.authPath, next, AUTH_FILE_WRITE_OPTIONS);
chmodSync(this.authPath, 0o600);
`;

test("Pi state-file patch matches the installed runtime and is idempotent", () => {
	const source = readFileSync(authStoragePath, "utf8");
	const patched = patchPiStateFilePermissionsSource(source);

	assertPiStateFilePermissionsPatchSource(patched, "installed Pi auth storage");
	assert.equal(patchPiStateFilePermissionsSource(patched), patched);
	assert.match(
		patched,
		/const AUTH_FILE_WRITE_OPTIONS = \{ encoding: "utf-8", mode: 0o600 \};/,
	);
	assert.doesNotMatch(patched, /chmodSync/);
});

test("Pi state-file patch transforms the reviewed 0.84.2 layout", () => {
	const patched = patchPiStateFilePermissionsSource(baselineSource);

	assertPiStateFilePermissionsPatchSource(patched, "reviewed Pi fixture");
	assert.equal(patchPiStateFilePermissionsSource(patched), patched);
});

test("Pi state-file patch fails closed on an unreviewed layout", () => {
	const source = baselineSource
		.replace("chmodSync(this.authPath, 0o600);", "chmodSync(this.authPath, 0o640);");

	assert.throws(
		() => patchPiStateFilePermissionsSource(source),
		/expected 3 occurrences/,
	);

	const patched = patchPiStateFilePermissionsSource(baselineSource);
	assert.throws(
		() => patchPiStateFilePermissionsSource(
			patched.replace(
				'writeFileSync(this.authPath, "{}", AUTH_FILE_WRITE_OPTIONS);',
				'writeFileSync(this.authPath, "{}");',
			),
		),
		/fresh private write/,
	);
	assert.throws(
		() => patchPiStateFilePermissionsSource(
			patched.replace(
				"writeFileSync(this.authPath, next, AUTH_FILE_WRITE_OPTIONS);",
				"writeFileSync(this.authPath, next);",
			),
		),
		/managed updates/,
	);
});

test("launch-time repair reaches bundled, vendored, global, and agent-managed Pi copies", () => {
	assert.match(
		readFileSync(resolve(process.cwd(), "scripts", "patch-embedded-pi.mjs"), "utf8"),
		/assertPiPackageVersion\(workspacePiPackageRoot, "vendored pi-coding-agent"\);[\s\S]*patchFilesIfPresent\(\[authStoragePath, workspaceAuthStoragePath\]/,
	);
	const appRoot = mkdtempSync(join(tmpdir(), "feynman-pi-state-file-roots-"));
	const agentDir = join(appRoot, "agent-home", ".feynman");
	const globalNodeModules = process.platform === "win32"
		? join(appRoot, "agent-home", "npm-global", "node_modules")
		: join(appRoot, "agent-home", "npm-global", "lib", "node_modules");
	const nodeModulesRoots = [
		join(appRoot, "node_modules"),
		join(appRoot, ".feynman", "npm", "node_modules"),
		globalNodeModules,
		join(agentDir, "npm", "node_modules"),
	];
	try {
		const authPaths = nodeModulesRoots.map((nodeModulesRoot) => {
			const packageRoot = join(
				nodeModulesRoot,
				"@earendil-works",
				"pi-coding-agent",
			);
			const authPath = join(packageRoot, "dist", "core", "auth-storage.js");
			mkdirSync(join(packageRoot, "dist", "core"), { recursive: true });
			mkdirSync(join(packageRoot, "dist", "cli"), { recursive: true });
			writeFileSync(
				join(packageRoot, "package.json"),
				JSON.stringify({
					name: "@earendil-works/pi-coding-agent",
					version: PI_STATE_FILE_PERMISSIONS_REQUIRED_VERSION,
					piConfig: { name: "feynman", configDir: ".feynman" },
				}),
				"utf8",
			);
			writeFileSync(authPath, baselineSource, "utf8");
			writeFileSync(
				join(packageRoot, "dist", "cli", "args.js"),
				cliArgsSource,
				"utf8",
			);
			return authPath;
		});

		assert.equal(
			patchPiRuntimeNodeModules(appRoot, agentDir, process.platform),
			true,
		);
		for (const authPath of authPaths) {
			assertPiStateFilePermissionsPatchSource(
				readFileSync(authPath, "utf8"),
				authPath,
			);
		}
		assert.equal(
			patchPiRuntimeNodeModules(appRoot, agentDir, process.platform),
			false,
		);
	} finally {
		rmSync(appRoot, { recursive: true, force: true });
	}
});

test("installed state verifier checks Windows ACLs without PowerShell command interpolation", () => {
	const verifier = readFileSync(
		resolve(
			process.cwd(),
			"scripts",
			"lib",
			"pi-state-file-permissions-verifier.mjs",
		),
		"utf8",
	);

	assert.match(verifier, /runWindowsCommand\("whoami\.exe", \[\]\)/);
	assert.match(verifier, /runWindowsCommand\("icacls\.exe", \[/);
	assert.doesNotMatch(verifier, /powershell\.exe|Get-Acl|Set-Acl/);
	assert.match(
		verifier,
		/\["-xzf", "runtime-workspace\.tgz", "-C", basename\(extractionRoot\)\]/,
	);
	assert.match(
		verifier,
		/const runtimeArchiveRoot = resolve\(packageRoot, "\.feynman"\)/,
	);
	assert.match(
		verifier,
		/mkdtempSync\(\s*join\(runtimeArchiveRoot, "\.state-verification-"\)/,
	);
	assert.match(verifier, /cwd: runtimeArchiveRoot/);
	assert.doesNotMatch(verifier, /\["-xzf", runtimeArchivePath/);
	assert.doesNotMatch(
		verifier,
		/\["-xzf", "runtime-workspace\.tgz", "-C", extractionRoot\]/,
	);
});

test(
	"installed state verifier accepts the extracted runtime used by native bundles",
	{ skip: process.platform === "win32" },
	async () => {
		const packageRoot = mkdtempSync(join(tmpdir(), "feynman-native-state-verifier-"));
		try {
			for (const nodeModulesRoot of [
				resolve(packageRoot, "node_modules"),
				resolve(packageRoot, ".feynman", "npm", "node_modules"),
			]) {
				const scope = resolve(nodeModulesRoot, "@earendil-works");
				mkdirSync(scope, { recursive: true });
				symlinkSync(piRoot, resolve(scope, "pi-coding-agent"), "dir");
			}

			assert.equal(
				await verifyInstalledPiStateFilePermissions(packageRoot),
				"fresh-0600-managed-modes-preserved",
			);
		} finally {
			rmSync(packageRoot, { recursive: true, force: true });
		}
	},
);

test(
	"patched Pi creates private state files and preserves administrator-managed modes",
	{ skip: process.platform === "win32" },
	async () => {
		const root = mkdtempSync(join(tmpdir(), "feynman-pi-managed-modes-"));
		const authPath = join(root, "auth.json");
		const modelsPath = join(root, "models-store.json");
		try {
			const authModule = await import(
				`${pathToFileURL(authStoragePath).href}?managed-modes=${Date.now()}`
			) as {
				AuthStorage: {
					create(path: string): {
						modify(provider: string, operation: () => Promise<unknown>): Promise<void>;
					};
				};
			};
			const modelsModule = await import(
				`${pathToFileURL(modelsStorePath).href}?managed-modes=${Date.now()}`
			) as {
				FileModelsStore: new (path: string) => {
					write(provider: string, entry: Record<string, unknown>): Promise<void>;
				};
			};

			const freshPath = join(root, "fresh-auth.json");
			authModule.AuthStorage.create(freshPath);
			assert.equal(statSync(freshPath).mode & 0o777, 0o600);

			writeFileSync(
				authPath,
				JSON.stringify({ anthropic: { type: "api_key", key: "old" } }),
				"utf8",
			);
			chmodSync(authPath, 0o660);
			const auth = authModule.AuthStorage.create(authPath);
			await auth.modify("anthropic", async () => ({
				type: "api_key",
				key: "new",
			}));
			assert.equal(statSync(authPath).mode & 0o777, 0o660);

			writeFileSync(modelsPath, "{}", "utf8");
			chmodSync(modelsPath, 0o640);
			const models = new modelsModule.FileModelsStore(modelsPath);
			await models.write("test", {
				models: [],
				checkedAt: Date.now(),
			});
			assert.equal(statSync(modelsPath).mode & 0o777, 0o640);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	},
);
