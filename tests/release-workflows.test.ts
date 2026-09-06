import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const e2eWorkflow = readFileSync(".github/workflows/e2e.yml", "utf8");
const publishWorkflow = readFileSync(".github/workflows/publish.yml", "utf8");
const packageArtifactVerifier = readFileSync("scripts/verify-package-artifact.mjs", "utf8");
const packageManifest = JSON.parse(readFileSync("package.json", "utf8")) as {
	bundleDependencies?: string[];
	files?: string[];
};

test("pull-request release gates validate the merge candidate", () => {
	assert.match(e2eWorkflow, /pull_request:\s*\n\s+branches: \[main\]/);
	assert.match(e2eWorkflow, /\npermissions:\s*\n\s+contents: read\s*\n/);
	assert.doesNotMatch(e2eWorkflow, /github\.event\.pull_request\.head\.sha/);
	assert.match(e2eWorkflow, /name: Release candidate \(PR\)/);
	assert.match(e2eWorkflow, /name: Candidate consumer \(\$\{\{ matrix\.os \}\}, Node \$\{\{ matrix\.node \}\}\)/);
	assert.match(e2eWorkflow, /name: pr-npm-package/);
	assert.match(e2eWorkflow, /node: "22\.22\.0"/);
	assert.match(e2eWorkflow, /node: "25"/);
	assert.match(e2eWorkflow, /name: Windows native installer \(PR\)/);
	assert.match(e2eWorkflow, /shell: powershell/);
	assert.match(e2eWorkflow, /shell: pwsh/);
	assert.match(e2eWorkflow, /tarball_for_tar=\$\(cygpath -u "\$tarball"\)/);
	assert.match(e2eWorkflow, /consumer=\$\(cygpath -u "\$consumer"\)/);
	assert.match(e2eWorkflow, /runtime_archive=\$\(cygpath -u "\$runtime_archive"\)/);
	assert.equal(
		(e2eWorkflow.match(/scripts\/verify-windows-installer\.ps1/g) ?? []).length,
		2,
	);
});

test("manual post-release gates exercise the live native installers", () => {
	const installerJob = e2eWorkflow.match(
		/\n  published-native-installer-e2e:[\s\S]*?(?=\n  release-candidate-pr:)/,
	);
	assert.ok(installerJob, "manual workflow must define the published native installer job");
	assert.match(installerJob[0], /if: github\.event_name == 'workflow_dispatch'/);
	assert.match(installerJob[0], /https:\/\/feynman\.is\/install\b/);
	assert.match(installerJob[0], /https:\/\/feynman\.is\/install\.ps1/);
	assert.match(installerJob[0], /FEYNMAN_INSTALL_BIN_DIR/);
	assert.match(installerJob[0], /shell: powershell/);
	assert.match(installerJob[0], /verify-installed-runtime\.mjs/);
	for (const os of ["ubuntu-latest", "macos-14", "windows-latest"]) {
		assert.match(installerJob[0], new RegExp(`- ${os}`));
	}
});

test("PR and publish workflows require clean package and consumer audits", () => {
	for (const workflow of [e2eWorkflow, publishWorkflow]) {
		assert.match(workflow, /npm audit --omit=dev --prefix \.feynman\/npm/);
		assert.match(workflow, /npm audit --omit=dev --prefix "\$consumer"/);
		assert.match(workflow, /\.feynman\/runtime-workspace\.tgz/);
		assert.match(workflow, /npm audit --omit=dev --prefix "\$runtime_audit\/npm"/);
		assert.doesNotMatch(
			workflow,
			/npm audit --omit=dev --prefix\s+\\?\s*"\$consumer\/node_modules\/@advaitpaliwal\/feynman\/\.feynman\/npm"/,
		);
		assert.match(workflow, /npm pack --dry-run --json/);
		assert.match(workflow, /verify-package-artifact\.mjs/);
		assert.match(workflow, /verify-package-budget\.mjs/);
		assert.match(workflow, /git status --porcelain --untracked-files=all/);
	}
});

test("package verification checks the current nested Pi TUI render module", () => {
	assert.match(
		packageArtifactVerifier,
		/"pi-coding-agent",\s*"node_modules",\s*"@earendil-works",\s*"pi-tui",\s*"dist",\s*"tui-main-screen\.js"/,
	);
	assert.doesNotMatch(
		packageArtifactVerifier,
		/"pi-coding-agent",\s*"node_modules",\s*"@earendil-works",\s*"pi-tui",\s*"dist",\s*"tui\.js"/,
	);
});

test("package and native release gates exercise persisted Pi user-package upgrades", () => {
	const staleUpgradeVerifier = /node scripts\/verify-stale-pi-upgrade\.mjs/g;
	assert.equal((e2eWorkflow.match(staleUpgradeVerifier) ?? []).length, 1);
	assert.equal((publishWorkflow.match(staleUpgradeVerifier) ?? []).length, 3);
});

test("installed package gates verify Feynman commands, tools, and TypeBox schemas across launchers", () => {
	const installedRuntimeVerifier = /scripts\/verify-installed-runtime\.mjs/g;
	assert.equal((e2eWorkflow.match(installedRuntimeVerifier) ?? []).length, 5);
	assert.equal((publishWorkflow.match(installedRuntimeVerifier) ?? []).length, 8);
	for (const workflow of [e2eWorkflow, publishWorkflow]) {
		assert.match(workflow, /bin="\$consumer\/node_modules\/\.bin\/feynman\.cmd"/);
		assert.match(
			workflow,
			/global_node_modules\/@advaitpaliwal\/feynman\/scripts\/verify-installed-runtime\.mjs" "\$global_bin"/,
		);
		assert.match(workflow, /global_node_modules=\$\(npm root --global --prefix "\$global_prefix"\)/);
	}
	assert.match(e2eWorkflow, /& \$nativeNode \$nativeVerifier \$native/);
	assert.match(publishWorkflow, /"\$bundle\/node\/bin\/node" "\$bundle\/app\/scripts\/verify-installed-runtime\.mjs"/);
	assert.match(
		publishWorkflow,
		/"\$native_bundle_root\/node\/bin\/node"\s+\\\n\s+"\$native_bundle_root\/app\/scripts\/verify-installed-runtime\.mjs"/,
	);
});

test("installed package and native gates execute pi-docparser tools through the shipped verifier", () => {
	assert.ok(
		packageManifest.files?.includes("scripts/verify-installed-docparser.mjs"),
		"package files must include the installed pi-docparser verifier",
	);
	assert.match(
		packageArtifactVerifier,
		/resolve\(packageRoot, "scripts", "verify-installed-docparser\.mjs"\)/,
	);
	for (const [label, workflow, expectedCount] of [
		["PR", e2eWorkflow, 6],
		["publish", publishWorkflow, 8],
	] as const) {
		const runtimeCalls = [...workflow.matchAll(/verify-installed-runtime\.mjs/g)];
		const docparserCalls = [...workflow.matchAll(/verify-installed-docparser\.mjs/g)];
		assert.equal(runtimeCalls.length, expectedCount, `${label} installed-runtime verifier count`);
		assert.equal(docparserCalls.length, expectedCount, `${label} pi-docparser verifier count`);
		for (let index = 0; index < runtimeCalls.length; index += 1) {
			const runtimeOffset = runtimeCalls[index]?.index ?? -1;
			const docparserOffset = docparserCalls[index]?.index ?? -1;
			assert.ok(
				docparserOffset > runtimeOffset && docparserOffset - runtimeOffset < 600,
				`${label} pi-docparser verifier ${index + 1} must follow its installed-runtime verifier`,
			);
		}
	}
	assert.match(e2eWorkflow, /& \$nativeNode \$nativeDocparserVerifier/);
	assert.match(
		publishWorkflow,
		/"\$native_bundle_root\/node\/bin\/node"\s+\\\n\s+"\$native_bundle_root\/app\/scripts\/verify-installed-docparser\.mjs"/,
	);
});

test("package gates exercise the global npm install path", () => {
	assert.ok(
		packageManifest.bundleDependencies?.includes("@opentelemetry/api"),
		"the direct telemetry API must be bundled so npm global installs cannot leave an empty hoist target",
	);
	assert.equal(
		(e2eWorkflow.match(/npm install --global --prefix "\$global_prefix"/g) ?? []).length,
		1,
	);
	assert.equal(
		(publishWorkflow.match(/npm install --global --prefix "\$global_prefix"/g) ?? []).length,
		2,
	);
	for (const workflow of [e2eWorkflow, publishWorkflow]) {
		assert.match(workflow, /global_bin="\$global_prefix\/feynman\.cmd"/);
		assert.match(workflow, /global_bin="\$global_prefix\/bin\/feynman"/);
		assert.match(workflow, /test "\$\("\$global_bin" --version \| tail -1\)"/);
		assert.match(workflow, /"\$global_bin" --help >\/dev\/null/);
	}
	assert.match(publishWorkflow, /global_prefix="\$RUNNER_TEMP\/published-global"/);
	assert.match(publishWorkflow, /"@advaitpaliwal\/feynman@\$VERSION"/);
});

test("package consumer matrices allow two slow Windows package installs", () => {
	const candidateConsumerJob = e2eWorkflow.match(
		/\n  supported-node-consumers-pr:[\s\S]*?(?=\n  windows-native-installer-pr:)/,
	);
	assert.ok(candidateConsumerJob, "PR workflow must define the candidate consumer job");
	assert.match(candidateConsumerJob[0], /\n    timeout-minutes: 90\n/);

	const releaseConsumerJob = publishWorkflow.match(
		/\n  verify-package-consumers:[\s\S]*?(?=\n  publish-npm:)/,
	);
	assert.ok(releaseConsumerJob, "publish workflow must define the package consumer job");
	assert.match(releaseConsumerJob[0], /\n    timeout-minutes: 90\n/);
});

test("publish uses the exact verified tarball after native bundles pass", () => {
	assert.match(publishWorkflow, /concurrency:\s*\n\s+group: publish-/);
	assert.match(publishWorkflow, /workflow_dispatch:/);
	assert.match(publishWorkflow, /name: npm-package/);
	assert.match(publishWorkflow, /name: npm-package\s*\n\s+path: npm-package/);
	const versionCheckJob = publishWorkflow.match(
		/\n  version-check:[\s\S]*?(?=\n  verify:)/,
	);
	assert.ok(versionCheckJob, "publish workflow must define the version check job");
	const manualPublishGate =
		/if \[ "\$GITHUB_EVENT_NAME" = "workflow_dispatch" \] && \[ "\$PUBLISHED" != "\$LOCAL" \]; then/;
	assert.match(versionCheckJob[0], manualPublishGate);
	assert.ok(
		versionCheckJob[0].search(manualPublishGate) <
			versionCheckJob[0].indexOf('echo "should_publish_npm=true"'),
		"manual publication must fail before publication is authorized",
	);
	const publishNpmJob = publishWorkflow.match(/\n  publish-npm:[\s\S]*?(?=\n  build-native-bundles:)/);
	assert.ok(publishNpmJob, "publish workflow must define the npm publication job");
	assert.match(
		publishNpmJob[0],
		/tarball=\$\(node -e 'process\.stdout\.write\(require\("node:path"\)\.resolve\(process\.argv\[1\]\)\)' "\$tarball"\)/,
	);
	assert.match(publishNpmJob[0], /npx npm@11\.18\.0 publish "\$tarball" --access public --provenance/);
	assert.match(publishNpmJob[0], /github\.event_name == 'push'/);
	assert.match(
		publishWorkflow,
		/Manual release runs may only reconcile an npm version already published from a main push\./,
	);
	assert.match(
		publishWorkflow,
		/publish-npm:\s*\n\s+needs:\s*\n\s+- version-check\s*\n\s+- verify\s*\n\s+- verify-package-consumers\s*\n\s+- build-native-bundles/,
	);
	assert.match(
		publishWorkflow,
		/build-native-bundles:\s*\n\s+needs:\s*\n\s+- version-check\s*\n\s+- verify\s*\n\s+- verify-package-consumers/,
	);
	assert.match(publishWorkflow, /verify-package-consumers:/);
	for (const os of ["ubuntu-latest", "macos-14", "windows-latest"]) {
		assert.match(publishWorkflow, new RegExp(`- os: ${os}`));
	}
	for (const nodeVersion of ["22.22.0", "24.18.0", "25"]) {
		assert.match(publishWorkflow, new RegExp(`node: "${nodeVersion.replace(/\./g, "\\.")}"`));
	}
	const consumerJob = publishWorkflow.match(
		/\n  verify-package-consumers:[\s\S]*?(?=\n  publish-npm:)/,
	);
	assert.ok(consumerJob, "publish workflow must define the package consumer job");
	assert.match(
		consumerJob[0],
		/runtime_archive="\$consumer\/node_modules\/@advaitpaliwal\/feynman\/\.feynman\/runtime-workspace\.tgz"/,
	);
	assert.match(consumerJob[0], /runtime_archive=\$\(cygpath -u "\$runtime_archive"\)/);
	assert.match(consumerJob[0], /runtime_audit=\$\(cygpath -u "\$runtime_audit"\)/);
	assert.match(publishWorkflow, /needs\.build-native-bundles\.result == 'success'/);
	assert.match(publishWorkflow, /needs\.verify-package-consumers\.result == 'success'/);
	assert.match(publishWorkflow, /dist\.integrity/);
	assert.match(publishWorkflow, /dist\.tarball/);
	assert.match(publishWorkflow, /audit signatures --json --include-attestations/);
	assert.match(publishWorkflow, /verify-npm-provenance\.mjs/);
	assert.match(publishWorkflow, /SHOULD_PUBLISH_NPM/);
	assert.match(publishWorkflow, /needs\.verify\.outputs\.package_integrity/);
	assert.doesNotMatch(
		publishWorkflow,
		/if \[ "\$\{\{ needs\.version-check\.outputs\.should_publish_npm \}\}" = "true" \]/,
	);
});

test("all three provenance verifier calls pin immutable IDs from trusted GitHub context", () => {
	const calls = [...publishWorkflow.matchAll(/node scripts\/verify-npm-provenance\.mjs \\\n[\s\S]*?\)/g)];
	assert.equal(calls.length, 3);
	for (const [call] of calls) {
		assert.match(call,
			/"refs\/heads\/main" \\\n\s+'\$\{\{ github\.repository_owner_id \}\}' \\\n\s+'\$\{\{ github\.repository_id \}\}'\)$/);
		assert.match(call, /"https:\/\/github\.com\/\$GITHUB_REPOSITORY"/);
		assert.match(call, /"\.github\/workflows\/publish\.yml"/);
	}
	assert.equal((publishWorkflow.match(/audit signatures --json --include-attestations/g) ?? []).length, 3);
});

test("GitHub release waits for verification, native bundles, and npm publication", () => {
	assert.match(
		publishWorkflow,
		/release-github:\s*\n\s+needs:\s*\n\s+- version-check\s*\n\s+- verify\s*\n\s+- publish-npm\s*\n\s+- build-native-bundles/,
	);
	const releaseGithubJob = publishWorkflow.match(
		/\n  release-github:[\s\S]*?(?=\n  verify-published-state:)/,
	);
	assert.ok(releaseGithubJob, "publish workflow must define the GitHub release job");
	assert.match(releaseGithubJob[0], /needs\.verify\.result == 'success'/);
	assert.match(releaseGithubJob[0], /always\(\)/);
	assert.match(
		releaseGithubJob[0],
		/needs\.version-check\.outputs\.should_publish_npm == 'false' \|\|\s+needs\.publish-npm\.result == 'success'/,
	);
	assert.match(publishWorkflow, /pattern: native-\*/);
	assert.doesNotMatch(publishWorkflow, /gh release view "v\$VERSION" >\/dev\/null 2>&1/);
	assert.match(publishWorkflow, /release_exists=true/);
	assert.match(publishWorkflow, /release_exists=false/);
	assert.match(publishWorkflow, /--draft/);
	assert.match(publishWorkflow, /Staged release asset mismatch/);
});

test("version reconciliation and post-publish verification cover all release surfaces", () => {
	for (const id of ["linux-x64", "linux-arm64", "darwin-x64", "darwin-arm64", "win32-x64"]) {
		assert.match(publishWorkflow, new RegExp(`feynman-.*-${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
	}
	assert.match(publishWorkflow, /SHA256SUMS/);
	assert.match(publishWorkflow, /sha256sum -c SHA256SUMS/);
	assert.match(publishWorkflow, /SHA256SUMS entry mismatch/);
	assert.match(publishWorkflow, /assets\.length === expected\.size/);
	assert.match(publishWorkflow, /Number\(asset\.size\) > 0/);
	assert.match(publishWorkflow, /verify-published-state:/);
	const verifyPublishedJob = publishWorkflow.match(/\n  verify-published-state:[\s\S]*$/);
	assert.ok(verifyPublishedJob, "publish workflow must define the published-state verification job");
	assert.match(verifyPublishedJob[0], /always\(\)/);
	assert.match(
		verifyPublishedJob[0],
		/needs\.version-check\.outputs\.should_publish_npm == 'false' \|\|\s+needs\.publish-npm\.result == 'success'/,
	);
	assert.match(publishWorkflow, /gh release download "v\$VERSION"/);
	assert.match(
		publishWorkflow,
		/npm install --prefix "\$consumer" --omit=dev --no-audit \\\s+"@advaitpaliwal\/feynman@\$VERSION"/,
	);
	assert.match(verifyPublishedJob[0], /npm_install_error="\$RUNNER_TEMP\/npm-install-published\.err"/);
	assert.match(verifyPublishedJob[0], /if ! grep -q 'E404' "\$npm_install_error"/);
	assert.match(verifyPublishedJob[0], /npm tarball did not become installable/);
	assert.match(verifyPublishedJob[0], /rm -rf "\$consumer\/node_modules" "\$consumer\/package-lock\.json"/);
	assert.match(publishWorkflow, /unzip -t/);
	assert.match(publishWorkflow, /targetCommitish/);
	assert.match(publishWorkflow, /asset\.digest/);
	assert.match(
		publishWorkflow,
		/repos\/\$GITHUB_REPOSITORY\/compare\/\$RELEASE_TARGET\.\.\.\$GITHUB_SHA/,
	);
	assert.match(publishWorkflow, /identical \| ahead/);
	assert.match(
		publishWorkflow,
		/npm version \$LOCAL provenance belongs to \$PUBLISHED_SOURCE_SHA, but GitHub release v\$LOCAL targets \$RELEASE_TARGET/,
	);
	assert.doesNotMatch(publishWorkflow, /npm view .* gitHead/);
	assert.doesNotMatch(
		publishWorkflow,
		/npm view "@advaitpaliwal\/feynman@\$VERSION" version 2>\/dev\/null \|\| true/,
	);
	assert.match(publishWorkflow, /node-version-file: \.nvmrc/);
	assert.match(publishWorkflow, /npx npm@11\.18\.0 publish/);
	assert.match(publishWorkflow, /Windows native launcher failed --help/);
	assert.match(
		publishWorkflow,
		/\[System\.IO\.Compression\.ZipFile\]::ExtractToDirectory/,
	);
	assert.doesNotMatch(publishWorkflow, /Expand-Archive/);
	assert.doesNotMatch(publishWorkflow, /npm@latest/);
	for (const workflow of [e2eWorkflow, publishWorkflow]) {
		assert.doesNotMatch(workflow, /uses: actions\/[^@\s]+@v\d/);
	}
});
