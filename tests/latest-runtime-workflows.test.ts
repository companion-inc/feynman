import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

const { parse } = createRequire(import.meta.url)("yaml") as typeof import("yaml");
const e2eSource = readFileSync(".github/workflows/e2e.yml", "utf8");
const publishSource = readFileSync(".github/workflows/publish.yml", "utf8");
const e2e = parse(e2eSource);
const publish = parse(publishSource);

function scriptFor(name: string): string {
	const step = e2e.jobs["install-e2e"].steps.find((step: { name?: string }) => step.name === name);
	assert.ok(step);
	const match = (step.run as string).match(/<<'NODE'\n([\s\S]*?)\nNODE/);
	assert.ok(match);
	// Replace only npm-root discovery. All manifest reads, imports, assertions
	// and loops below run exactly as shipped in the workflow, without npm access.
	return match[1].replace(
		'import { execFileSync } from "node:child_process";',
		'const execFileSync = () => process.env.MOCK_GLOBAL_ROOT;',
	);
}

function withInstalledFixture(run: (root: string, pkg: string) => void) {
	const root = mkdtempSync(join(tmpdir(), "feynman-workflow-contracts-"));
	const pkg = join(root, "@advaitpaliwal", "feynman");
	const put = (path: string, source: unknown) => {
		const target = join(pkg, path);
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, typeof source === "string" ? source : JSON.stringify(source));
	};
	try {
		for (const modules of ["node_modules", ".feynman/npm/node_modules"]) {
			for (const name of ["pi-coding-agent", "pi-agent-core", "pi-ai", "pi-tui", "pi-telemetry"]) {
				put(`${modules}/@earendil-works/${name}/package.json`, { name: `@earendil-works/${name}`, version: "0.85.1" });
			}
			put(`${modules}/@earendil-works/pi-coding-agent/dist/cli/args.js`, "reviewed-pi-cli");
			put(`${modules}/@advaitpaliwal/alpha-hub/package.json`, { name: "@advaitpaliwal/alpha-hub", version: "0.1.4" });
			for (const file of ["auth.js", "alphaxiv.js", "index.js"]) {
				put(`${modules}/@advaitpaliwal/alpha-hub/src/lib/${file}`, `reviewed-${file}`);
			}
		}
		put(".feynman/npm/node_modules/pi-subagents/package.json", { name: "pi-subagents", version: "0.65.1" });
		put(".feynman/npm/node_modules/pi-subagents/src/runs/shared/child-session.ts", "reviewed-native-session");
		const assertion = 'import assert from "node:assert/strict";\n';
		put("scripts/lib/pi-cli-args-patch.mjs", assertion + `
import {readFileSync} from "node:fs"; import {join} from "node:path";
export const PI_CLI_ARGS_REQUIRED_VERSION = "0.85.1";
export function assertPatchedPiCliArgsPackageRoot(root) {
  assert.equal(readFileSync(join(root, "dist/cli/args.js"), "utf8"), "reviewed-pi-cli");
}`);
		put("scripts/lib/pi-subagents-native-patch.mjs", assertion + `
export const PI_SUBAGENTS_NATIVE_VERSION = "0.65.1";
export function assertPiSubagentsNativeSources(read) {
  assert.equal(read("src/runs/shared/child-session.ts"), "reviewed-native-session");
}`);
		put("scripts/lib/alpha-hub-auth-patch.mjs", assertion + `
export const ALPHA_HUB_AUTH_014_SOURCE_CONTRACT = {version: "0.1.4"};
export function assertAlphaHubAuthSource(source) { assert.equal(source, "reviewed-auth.js"); }`);
		put("scripts/lib/alpha-hub-search-patch.mjs", assertion + `
export const ALPHA_HUB_SEARCH_014_SOURCE_CONTRACT = {version: "0.1.4"};
export const ALPHA_HUB_RESULTS_014_SOURCE_CONTRACT = {version: "0.1.4"};
export function assertAlphaHubSearchSource(source) { assert.equal(source, "reviewed-alphaxiv.js"); }
export function assertAlphaHubSearchResultsSource(source) { assert.equal(source, "reviewed-index.js"); }`);
		run(root, pkg);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

function execute(script: string, root: string) {
	return spawnSync(process.execPath, ["--input-type=module", "-e", script], {
		env: { ...process.env, MOCK_GLOBAL_ROOT: root },
		encoding: "utf8",
		timeout: 10_000,
	});
}

test("manual e2e requires exact Alpha Hub contracts for both installed copies", () => {
	const script = scriptFor("Assert exact personal Alpha Hub source contracts");
	withInstalledFixture((root, pkg) => {
		const good = execute(script, root);
		assert.equal(good.status, 0, good.stderr);
		for (const modules of ["node_modules", ".feynman/npm/node_modules"]) {
			const alpha = join(pkg, modules, "@advaitpaliwal", "alpha-hub");
			for (const file of ["auth.js", "alphaxiv.js", "index.js"]) {
				const path = join(alpha, "src/lib", file);
				const source = readFileSync(path, "utf8");
				writeFileSync(path, source + "\nparseStructuredSearchResults");
				assert.notEqual(execute(script, root).status, 0, `${modules}/${file} must reject marker-only drift`);
				writeFileSync(path, source);
			}
			const manifest = join(alpha, "package.json");
			const source = readFileSync(manifest, "utf8");
			writeFileSync(manifest, JSON.stringify({ name: "@companion-ai/alpha-hub", version: "0.1.3" }));
			assert.notEqual(execute(script, root).status, 0, "old identity must fail");
			writeFileSync(manifest, source);
		}
		rmSync(join(pkg, ".feynman/npm/node_modules/@advaitpaliwal/alpha-hub"), { recursive: true });
		assert.notEqual(execute(script, root).status, 0, "missing second copy must fail");
	});
});

test("manual e2e requires coordinated Pi and exact native subagent contracts", () => {
	const script = scriptFor("Assert exact Pi and native subagent source contracts");
	withInstalledFixture((root, pkg) => {
		const good = execute(script, root);
		assert.equal(good.status, 0, good.stderr);
		for (const modules of ["node_modules", ".feynman/npm/node_modules"]) {
			const manifest = join(pkg, modules, "@earendil-works/pi-ai/package.json");
			const source = readFileSync(manifest, "utf8");
			writeFileSync(manifest, JSON.stringify({ name: "@earendil-works/pi-ai", version: "0.84.2" }));
			assert.notEqual(execute(script, root).status, 0, "mixed Pi train must fail");
			writeFileSync(manifest, source);
		}
		const native = join(pkg, ".feynman/npm/node_modules/pi-subagents/src/runs/shared/child-session.ts");
		writeFileSync(native, "FEYNMAN_PI_CLI_PATH childSessionFactory");
		assert.notEqual(execute(script, root).status, 0, "native marker-only mutation must fail");
		writeFileSync(native, "reviewed-native-session");
		const manifest = join(pkg, ".feynman/npm/node_modules/pi-subagents/package.json");
		writeFileSync(manifest, JSON.stringify({ name: "pi-subagents", version: "0.57.0" }));
		assert.notEqual(execute(script, root).status, 0, "legacy subagents must fail");
	});
});

test("workflows retain exact artifact checks on local, global, and native consumers", () => {
	for (const source of [e2eSource, publishSource]) {
		assert.doesNotMatch(source, /@companion-ai|src", "runs", "shared", "pi-spawn\.ts"|parseStructuredSearchResults/);
		assert.match(source, /global_node_modules\/@advaitpaliwal\/feynman\/scripts\/verify-package-artifact\.mjs/);
		assert.equal((source.match(/--pruned-native/g) ?? []).length, 3);
		assert.match(source, /consumer=\$\(cygpath -u "\$consumer"\)/);
	}
	for (const [workflow, job, name] of [
		[e2e, "published-native-installer-e2e", "Install the published native bundle through the live Windows installer"],
		[e2e, "windows-native-installer-pr", "Build Windows native ZIP"],
		[publish, "build-native-bundles", "Smoke native bundle (Windows)"],
	] as const) {
		const run = workflow.jobs[job].steps.find((step: { name?: string }) => step.name === name).run;
		assert.match(run, /verify-package-artifact\.mjs/);
		assert.match(run, /--pruned-native\nif \(\$LASTEXITCODE -ne 0\)/);
	}
});
