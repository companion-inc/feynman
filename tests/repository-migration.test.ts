import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const repository = "https://github.com/advaitpaliwal/feynman";
const read = (path: string) => readFileSync(path, "utf8");

test("npm uses the personal package and transferred repository", () => {
	const manifest = JSON.parse(read("package.json"));
	const lock = JSON.parse(read("package-lock.json"));
	assert.equal(manifest.name, "@advaitpaliwal/feynman");
	assert.equal(manifest.author, "Advait Paliwal");
	assert.equal(manifest.publishConfig.access, "public");
	assert.equal(manifest.bin.feynman, "bin/feynman.js");
	assert.ok(manifest.dependencies["@companion-ai/alpha-hub"]);
	assert.ok(manifest.bundleDependencies.includes("@companion-ai/alpha-hub"));
	assert.equal(lock.name, manifest.name);
	assert.equal(lock.packages[""].name, manifest.name);
	assert.equal(lock.version, manifest.version);
	assert.equal(lock.packages[""].version, manifest.version);
	assert.equal(manifest.repository.url, `git+${repository}.git`);
	assert.equal(manifest.homepage, `${repository}#readme`);
	assert.equal(manifest.bugs.url, `${repository}/issues`);
});

test("release and consumer workflows use only the personal Feynman scope", () => {
	const manifest = JSON.parse(read("package.json"));
	const tarballPrefix = manifest.name.replace(/^@/, "").replaceAll("/", "-");
	for (const path of [".github/workflows/publish.yml", ".github/workflows/e2e.yml"]) {
		const content = read(path);
		assert.ok(content.includes("@advaitpaliwal/feynman"), path);
		assert.doesNotMatch(content, /@companion-ai\/feynman/, path);
		assert.doesNotMatch(content, /["']@companion-ai["']\s*,\s*["']feynman["']/, path);
		assert.doesNotMatch(content, /companion-ai-feynman-/, path);
		assert.ok(content.includes(`${tarballPrefix}-`), path);
	}
	assert.ok(read(".github/workflows/e2e.yml").includes(`runner.temp }}/${tarballPrefix}-*.tgz`));
});

test("research source request identities use the transferred repository", () => {
	for (const name of readdirSync("extensions/research-tools").filter((name) => name.endsWith(".ts"))) {
		assert.doesNotMatch(read(`extensions/research-tools/${name}`), /github\.com\/companion-(?:ai|inc)\/feynman/i, name);
	}
});

test("installation docs include the ordered one-time npm scope migration", () => {
	for (const path of ["README.md", "website/src/content/docs/getting-started/installation.md"]) {
		const content = read(path);
		assert.ok(content.includes("npm uninstall -g @companion-ai/feynman\nnpm install -g @advaitpaliwal/feynman"), path);
	}
});

test("installers and their public copies use the new owner directly", () => {
	for (const [source, published] of [
		["install.sh", "install"],
		["install.ps1", "install.ps1"],
		["install-skills.sh", "install-skills"],
		["install-skills.ps1", "install-skills.ps1"],
	]) {
		const installer = read(`scripts/install/${source}`);
		assert.ok(installer.includes(`${repository}/releases/latest`), source);
		assert.doesNotMatch(installer, /companion-inc(?:\/|%2f)feynman/i);
		assert.equal(read(`website/public/${published}`), installer);
	}
});

test("public source links do not depend on old-owner redirects", () => {
	for (const path of [
		"README.md",
		"CONTRIBUTING.md",
		"website/src/layouts/main.astro",
		"website/src/pages/index.astro",
	]) {
		const content = read(path);
		assert.ok(content.includes(repository), path);
		assert.doesNotMatch(content, /companion-inc(?:\/|%2f)feynman/i);
	}
});
