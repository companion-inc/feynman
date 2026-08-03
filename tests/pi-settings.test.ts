import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { DefaultPackageManager, SettingsManager } from "@earendil-works/pi-coding-agent";

import {
	CORE_PACKAGE_SOURCES,
	getOptionalPackagePresetSources,
	isRemovedOptionalPackageTarget,
	isOptionalPackagePresetSupported,
	listOptionalPackagePresetInstallTargets,
	listOptionalPackagePresets,
	NATIVE_PACKAGE_SOURCES,
	normalizeOptionalPackagePresetName,
	resolvePackageUpdateSources,
	shouldPruneLegacyDefaultPackages,
	supportsNativePackageSources,
} from "../src/pi/package-presets.js";
import { chooseRecommendedModel } from "../src/model/catalog.js";
import { normalizeFeynmanSettings, normalizeThinkingLevel } from "../src/pi/settings.js";

test("bundled settings disable the project theme copy while the synced agent theme stays enabled", async () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-settings-"));
	const workingDir = join(root, "project");
	const agentDir = join(root, "agent");
	const themeJson = JSON.stringify({ name: "feynman", colors: {} }) + "\n";
	mkdirSync(join(workingDir, ".feynman", "themes"), { recursive: true });
	mkdirSync(join(agentDir, "themes"), { recursive: true });
	writeFileSync(
		join(workingDir, ".feynman", "settings.json"),
		JSON.stringify({ themes: ["-themes/feynman.json"] }, null, 2) + "\n",
		"utf8",
	);
	writeFileSync(join(workingDir, ".feynman", "themes", "feynman.json"), themeJson, "utf8");
	writeFileSync(join(agentDir, "themes", "feynman.json"), themeJson, "utf8");

	const settingsManager = SettingsManager.create(workingDir, agentDir, { projectTrusted: true });
	const packageManager = new DefaultPackageManager({ cwd: workingDir, agentDir, settingsManager });
	const resolved = await packageManager.resolve();

	const feynmanThemeResources = resolved.themes
		.filter((resource) => resource.path.endsWith(join("themes", "feynman.json")))
		.map((resource) => ({
			path: resource.path,
			enabled: resource.enabled,
			scope: resource.metadata.scope,
			source: resource.metadata.source,
		}));

	assert.deepEqual(
		feynmanThemeResources.find((resource) => resource.path === join(agentDir, "themes", "feynman.json")),
		{ path: join(agentDir, "themes", "feynman.json"), enabled: true, scope: "user", source: "auto" },
	);
	assert.deepEqual(
		feynmanThemeResources.find((resource) => resource.path === join(workingDir, ".feynman", "themes", "feynman.json")),
		{ path: join(workingDir, ".feynman", "themes", "feynman.json"), enabled: false, scope: "project", source: "auto" },
	);
	assert.equal(feynmanThemeResources.length, 2);
});

test("normalizeThinkingLevel accepts the latest Pi thinking levels", () => {
	assert.equal(normalizeThinkingLevel("off"), "off");
	assert.equal(normalizeThinkingLevel("minimal"), "minimal");
	assert.equal(normalizeThinkingLevel("low"), "low");
	assert.equal(normalizeThinkingLevel("medium"), "medium");
	assert.equal(normalizeThinkingLevel("high"), "high");
	assert.equal(normalizeThinkingLevel("xhigh"), "xhigh");
	assert.equal(normalizeThinkingLevel("max"), "max");
});

test("normalizeThinkingLevel rejects unknown values", () => {
	assert.equal(normalizeThinkingLevel("turbo"), undefined);
	assert.equal(normalizeThinkingLevel(undefined), undefined);
});

test("normalizeFeynmanSettings seeds the fast core package set", async () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-settings-"));
	const settingsPath = join(root, "settings.json");
	const bundledSettingsPath = join(root, "bundled-settings.json");
	const authPath = join(root, "auth.json");

	writeFileSync(bundledSettingsPath, "{}\n", "utf8");
	writeFileSync(authPath, "{}\n", "utf8");

	await normalizeFeynmanSettings(settingsPath, bundledSettingsPath, "medium", authPath);

	const settings = JSON.parse(readFileSync(settingsPath, "utf8")) as { packages?: string[] };
	assert.deepEqual(settings.packages, [...CORE_PACKAGE_SOURCES]);
});

test("bundled settings and package-list defaults use the same current core package set", () => {
	const bundledSettings = JSON.parse(
		readFileSync(join(process.cwd(), ".feynman", "settings.json"), "utf8"),
	) as { packages?: string[] };
	assert.deepEqual(bundledSettings.packages, [...CORE_PACKAGE_SOURCES]);
	assert.deepEqual(CORE_PACKAGE_SOURCES, [
		"npm:@companion-ai/alpha-hub@0.1.3",
		"npm:pi-subagents@0.40.0",
		"npm:pi-btw@0.4.1",
		"npm:pi-docparser@3.0.1",
		"npm:pi-web-access@0.18.0",
		"npm:pi-otel@0.1.0",
	]);
});

test("normalizeFeynmanSettings upgrades the 0.3.6 pinned core package set", async () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-settings-"));
	const settingsPath = join(root, "settings.json");
	const bundledSettingsPath = join(root, "bundled-settings.json");
	const authPath = join(root, "auth.json");

	writeFileSync(
		settingsPath,
		JSON.stringify({
			packages: [
				"npm:@companion-ai/alpha-hub@0.1.3",
				"npm:pi-subagents@0.37.2",
				"npm:pi-btw@0.4.1",
				"npm:pi-docparser@3.0.1",
				"npm:pi-web-access@0.15.0",
				"npm:pi-otel@0.1.0",
			],
		}, null, 2) + "\n",
		"utf8",
	);
	writeFileSync(bundledSettingsPath, "{}\n", "utf8");
	writeFileSync(authPath, "{}\n", "utf8");

	await normalizeFeynmanSettings(settingsPath, bundledSettingsPath, "medium", authPath);

	const settings = JSON.parse(readFileSync(settingsPath, "utf8")) as { packages?: string[] };
	assert.deepEqual(settings.packages, [...CORE_PACKAGE_SOURCES]);
});

test("normalizeFeynmanSettings upgrades the 0.3.10 pinned core package set", async () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-settings-"));
	const settingsPath = join(root, "settings.json");
	const bundledSettingsPath = join(root, "bundled-settings.json");
	const authPath = join(root, "auth.json");

	writeFileSync(
		settingsPath,
		JSON.stringify({
			packages: [
				"npm:@companion-ai/alpha-hub@0.1.3",
				"npm:pi-subagents@0.38.0",
				"npm:pi-btw@0.4.1",
				"npm:pi-docparser@3.0.1",
				"npm:pi-web-access@0.17.1",
				"npm:pi-otel@0.1.0",
			],
		}, null, 2) + "\n",
		"utf8",
	);
	writeFileSync(bundledSettingsPath, "{}\n", "utf8");
	writeFileSync(authPath, "{}\n", "utf8");

	await normalizeFeynmanSettings(settingsPath, bundledSettingsPath, "medium", authPath);

	const settings = JSON.parse(readFileSync(settingsPath, "utf8")) as { packages?: string[] };
	assert.deepEqual(settings.packages, [...CORE_PACKAGE_SOURCES]);
});

test("normalizeFeynmanSettings upgrades the 0.3.11 pinned core package set", async () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-settings-"));
	const settingsPath = join(root, "settings.json");
	const bundledSettingsPath = join(root, "bundled-settings.json");
	const authPath = join(root, "auth.json");

	writeFileSync(
		settingsPath,
		JSON.stringify({
			packages: [
				"npm:@companion-ai/alpha-hub@0.1.3",
				"npm:pi-subagents@0.40.0",
				"npm:pi-btw@0.4.1",
				"npm:pi-docparser@3.0.1",
				"npm:pi-web-access@0.17.1",
				"npm:pi-otel@0.1.0",
			],
		}, null, 2) + "\n",
		"utf8",
	);
	writeFileSync(bundledSettingsPath, "{}\n", "utf8");
	writeFileSync(authPath, "{}\n", "utf8");

	await normalizeFeynmanSettings(settingsPath, bundledSettingsPath, "medium", authPath);

	const settings = JSON.parse(readFileSync(settingsPath, "utf8")) as { packages?: string[] };
	assert.deepEqual(settings.packages, [...CORE_PACKAGE_SOURCES]);
});

test("normalizeFeynmanSettings prunes the legacy slow default package set", async () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-settings-"));
	const settingsPath = join(root, "settings.json");
	const bundledSettingsPath = join(root, "bundled-settings.json");
	const authPath = join(root, "auth.json");

	writeFileSync(
		settingsPath,
		JSON.stringify(
				{
					packages: [
						"npm:@companion-ai/alpha-hub",
						"npm:pi-subagents",
						"npm:pi-btw",
						"npm:pi-docparser",
						"npm:pi-web-access",
						"npm:pi-otel",
					"npm:pi-generative-ui",
				],
			},
			null,
			2,
		) + "\n",
		"utf8",
	);
	writeFileSync(bundledSettingsPath, "{}\n", "utf8");
	writeFileSync(authPath, "{}\n", "utf8");

	await normalizeFeynmanSettings(settingsPath, bundledSettingsPath, "medium", authPath);

	const settings = JSON.parse(readFileSync(settingsPath, "utf8")) as { packages?: string[] };
	assert.deepEqual(settings.packages, [...CORE_PACKAGE_SOURCES]);
});

test("normalizeFeynmanSettings prunes the legacy Devkade telemetry default package", async () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-settings-"));
	const settingsPath = join(root, "settings.json");
	const bundledSettingsPath = join(root, "bundled-settings.json");
	const authPath = join(root, "auth.json");

	writeFileSync(
		settingsPath,
		JSON.stringify(
			{
				packages: [
					...CORE_PACKAGE_SOURCES,
					"npm:@devkade/pi-opentelemetry",
				],
			},
			null,
			2,
		) + "\n",
		"utf8",
	);
	writeFileSync(bundledSettingsPath, "{}\n", "utf8");
	writeFileSync(authPath, "{}\n", "utf8");

	await normalizeFeynmanSettings(settingsPath, bundledSettingsPath, "medium", authPath);

	const settings = JSON.parse(readFileSync(settingsPath, "utf8")) as { packages?: string[] };
	assert.deepEqual(settings.packages, [...CORE_PACKAGE_SOURCES]);
});

test("normalizeFeynmanSettings seeds the newest OpenAI GPT default exposed by Pi", async () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-settings-"));
	const settingsPath = join(root, "settings.json");
	const bundledSettingsPath = join(root, "bundled-settings.json");
	const authPath = join(root, "auth.json");

	writeFileSync(bundledSettingsPath, "{}\n", "utf8");
	writeFileSync(authPath, JSON.stringify({ openai: { type: "api_key", key: "openai-test-key" } }) + "\n", "utf8");
	const recommendation = await chooseRecommendedModel(authPath);

	await normalizeFeynmanSettings(settingsPath, bundledSettingsPath, "medium", authPath);

	const settings = JSON.parse(readFileSync(settingsPath, "utf8")) as {
		defaultProvider?: string;
		defaultModel?: string;
	};
	assert.equal(`${settings.defaultProvider}/${settings.defaultModel}`, recommendation?.spec);
});

test("normalizeFeynmanSettings replaces an unavailable stale default with the current default", async () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-settings-"));
	const settingsPath = join(root, "settings.json");
	const bundledSettingsPath = join(root, "bundled-settings.json");
	const authPath = join(root, "auth.json");

	writeFileSync(
		settingsPath,
		JSON.stringify({ defaultProvider: "anthropic", defaultModel: "claude-opus-1" }, null, 2) + "\n",
		"utf8",
	);
	writeFileSync(bundledSettingsPath, "{}\n", "utf8");
	writeFileSync(authPath, JSON.stringify({ openai: { type: "api_key", key: "openai-test-key" } }) + "\n", "utf8");
	const recommendation = await chooseRecommendedModel(authPath);

	await normalizeFeynmanSettings(settingsPath, bundledSettingsPath, "medium", authPath);

	const settings = JSON.parse(readFileSync(settingsPath, "utf8")) as {
		defaultProvider?: string;
		defaultModel?: string;
	};
	assert.equal(`${settings.defaultProvider}/${settings.defaultModel}`, recommendation?.spec);
});

test("normalizeFeynmanSettings seeds OpenCode Go Kimi as the preferred OpenCode Go default", async () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-settings-"));
	const settingsPath = join(root, "settings.json");
	const bundledSettingsPath = join(root, "bundled-settings.json");
	const authPath = join(root, "auth.json");

	writeFileSync(bundledSettingsPath, "{}\n", "utf8");
	writeFileSync(authPath, JSON.stringify({ "opencode-go": { type: "api_key", key: "opencode-test-key" } }) + "\n", "utf8");

	await normalizeFeynmanSettings(settingsPath, bundledSettingsPath, "medium", authPath);

	const settings = JSON.parse(readFileSync(settingsPath, "utf8")) as {
		defaultProvider?: string;
		defaultModel?: string;
	};
	assert.equal(settings.defaultProvider, "opencode-go");
	assert.equal(settings.defaultModel, "kimi-k2.6");
});

test("optional package presets map friendly aliases", () => {
	assert.deepEqual(getOptionalPackagePresetSources("memory"), ["npm:@samfp/pi-memory"]);
	assert.deepEqual(getOptionalPackagePresetSources("hindsight"), ["npm:@luxusai/pi-hindsight"]);
	assert.deepEqual(getOptionalPackagePresetSources("session-search", "darwin", "22.12.0"), ["npm:@kaiserlich-dev/pi-session-search"]);
	assert.deepEqual(getOptionalPackagePresetSources("session-search", "darwin", "24.8.0"), undefined);
	assert.deepEqual(getOptionalPackagePresetSources("ui", "darwin"), undefined);
	assert.deepEqual(getOptionalPackagePresetSources("generative-ui", "darwin"), undefined);
	assert.deepEqual(getOptionalPackagePresetSources("all-extras", "darwin", "22.12.0"), undefined);
	assert.deepEqual(getOptionalPackagePresetSources("search"), undefined);
	assert.equal(normalizeOptionalPackagePresetName("ui"), undefined);
	assert.equal(normalizeOptionalPackagePresetName("all-extras"), undefined);
	assert.equal(isOptionalPackagePresetSupported("session-search", "darwin", "24.8.0"), false);
	assert.deepEqual(listOptionalPackagePresets("linux", "24.8.0").map((preset) => preset.name), ["memory", "hindsight"]);
	assert.deepEqual(listOptionalPackagePresetInstallTargets("linux", "24.8.0"), ["memory", "hindsight"]);
	assert.equal(shouldPruneLegacyDefaultPackages(["npm:custom"]), false);
});

test("package update sources map core and optional aliases", () => {
	assert.deepEqual(resolvePackageUpdateSources("pi-subagents"), ["npm:pi-subagents@0.40.0"]);
	assert.deepEqual(resolvePackageUpdateSources("subagents"), ["npm:pi-subagents@0.40.0"]);
	assert.deepEqual(resolvePackageUpdateSources("npm:pi-subagents"), ["npm:pi-subagents@0.40.0"]);
	assert.deepEqual(resolvePackageUpdateSources("pi-web-access"), ["npm:pi-web-access@0.18.0"]);
	assert.deepEqual(resolvePackageUpdateSources("alpha-hub"), ["npm:@companion-ai/alpha-hub@0.1.3"]);
	assert.deepEqual(resolvePackageUpdateSources("npm:pi-subagents@0.37.2"), ["npm:pi-subagents@0.37.2"]);
	assert.deepEqual(resolvePackageUpdateSources("hindsight"), ["npm:@luxusai/pi-hindsight"]);
	assert.deepEqual(resolvePackageUpdateSources("pi-hindsight"), ["npm:@luxusai/pi-hindsight"]);
	assert.deepEqual(resolvePackageUpdateSources("memory"), ["npm:@samfp/pi-memory"]);
	assert.deepEqual(resolvePackageUpdateSources("pi-memory"), ["npm:@samfp/pi-memory"]);
	assert.deepEqual(resolvePackageUpdateSources("session-search"), ["npm:@kaiserlich-dev/pi-session-search"]);
	for (const removedTarget of ["ui", "generative-ui", "pi-generative-ui", "npm:pi-generative-ui", "all-extras"]) {
		assert.equal(isRemovedOptionalPackageTarget(removedTarget), true);
		assert.throws(
			() => resolvePackageUpdateSources(removedTarget, "darwin"),
			/Removed optional package target/,
		);
	}
	assert.deepEqual(resolvePackageUpdateSources("npm:@samfp/pi-memory"), ["npm:@samfp/pi-memory"]);
	assert.deepEqual(resolvePackageUpdateSources("custom-package"), ["custom-package"]);
});

test("supportsNativePackageSources disables sqlite-backed packages on Node 23+", () => {
	assert.equal(supportsNativePackageSources("22.12.0"), true);
	assert.equal(supportsNativePackageSources("23.0.0"), false);
	assert.equal(supportsNativePackageSources("24.8.0"), false);
});

test("normalizeFeynmanSettings prunes legacy package defaults to the lean research core", async () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-settings-"));
	const settingsPath = join(root, "settings.json");
	const bundledSettingsPath = join(root, "bundled-settings.json");
	const authPath = join(root, "auth.json");

	writeFileSync(
		settingsPath,
		JSON.stringify(
			{
				packages: [
					...CORE_PACKAGE_SOURCES,
					"npm:pi-markdown-preview",
					"npm:@walterra/pi-charts",
					"npm:pi-mermaid",
					"npm:@aliou/pi-processes",
					"npm:pi-zotero",
					"npm:@kaiserlich-dev/pi-session-search",
					"npm:pi-schedule-prompt",
					"npm:@samfp/pi-memory",
					"npm:@tmustier/pi-ralph-wiggum",
				],
			},
			null,
			2,
		) + "\n",
		"utf8",
	);
	writeFileSync(bundledSettingsPath, "{}\n", "utf8");
	writeFileSync(authPath, "{}\n", "utf8");

	const originalVersion = process.versions.node;
	Object.defineProperty(process.versions, "node", { value: "24.0.0", configurable: true });
	try {
		await normalizeFeynmanSettings(settingsPath, bundledSettingsPath, "medium", authPath);
	} finally {
		Object.defineProperty(process.versions, "node", { value: originalVersion, configurable: true });
	}

	const settings = JSON.parse(readFileSync(settingsPath, "utf8")) as { packages?: string[] };
	assert.deepEqual(settings.packages, [...CORE_PACKAGE_SOURCES]);
	assert.equal((settings.packages as string[] | undefined)?.some((source) => source.startsWith("npm:pi-btw@")), true);
	for (const source of NATIVE_PACKAGE_SOURCES) {
		assert.equal((settings.packages as string[] | undefined)?.includes(source), false);
	}
	assert.equal((settings.packages as string[] | undefined)?.includes("npm:@samfp/pi-memory"), false);
});
