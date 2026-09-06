import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
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
	reconcileManagedCorePackageSources,
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

test("normalizeFeynmanSettings migrates the complete pre-refresh old-scope package set", async (t) => {
	const root = mkdtempSync(join(tmpdir(), "feynman-settings-old-scope-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const settingsPath = join(root, "settings.json");
	const authPath = join(root, "auth.json");
	writeFileSync(authPath, "{}\n");
	writeFileSync(settingsPath, JSON.stringify({ packages: [
		"npm:@companion-ai/alpha-hub@0.1.3",
		"npm:pi-subagents@0.40.0",
		"npm:pi-btw@0.4.1",
		"npm:pi-docparser@4.0.0",
		"npm:pi-web-access@0.25.0",
		"npm:pi-otel@0.1.0",
	] }));
	await normalizeFeynmanSettings(settingsPath, join(root, "absent.json"), "medium", authPath);
	assert.deepEqual(JSON.parse(readFileSync(settingsPath, "utf8")).packages, [...CORE_PACKAGE_SOURCES]);
});

test("subagent defaults follow settingsPath, not HOME, authPath, or the Pi environment", async (t) => {
	const root = mkdtempSync(join(tmpdir(), "feynman-subagent-defaults-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const agentDir = join(root, "custom", "agent");
	const decoyDir = join(root, "unrelated-agent");
	mkdirSync(agentDir, { recursive: true });
	mkdirSync(decoyDir);
	const settingsPath = join(agentDir, "settings.json");
	const bundledSettingsPath = join(root, "bundled.json");
	const authPath = join(decoyDir, "auth.json");
	writeFileSync(bundledSettingsPath, "{}\n");
	writeFileSync(authPath, "{}\n");
	const keys = ["HOME", "FEYNMAN_CODING_AGENT_DIR", "PI_CODING_AGENT_DIR"] as const;
	const previous = keys.map((key) => process.env[key]);
	for (const key of keys) process.env[key] = decoyDir;
	try {
		await normalizeFeynmanSettings(settingsPath, bundledSettingsPath, "medium", authPath);
	} finally {
		keys.forEach((key, index) => {
			if (previous[index] === undefined) delete process.env[key];
			else process.env[key] = previous[index];
		});
	}
	const configPath = join(agentDir, "extensions", "subagent", "config.json");
	assert.deepEqual(JSON.parse(readFileSync(configPath, "utf8")), {
		missions: { enabled: false }, fleetView: false, asyncByDefault: true,
	});
	assert.equal(statSync(configPath).mode & 0o777, 0o600);
	assert.equal(existsSync(join(decoyDir, "extensions")), false);
	const before = readFileSync(configPath, "utf8");
	const modifiedAt = statSync(configPath).mtimeMs;
	await normalizeFeynmanSettings(settingsPath, bundledSettingsPath, "medium", authPath);
	assert.equal(readFileSync(configPath, "utf8"), before);
	assert.equal(statSync(configPath).mtimeMs, modifiedAt);
});

test("subagent defaults preserve explicit custom values and complete config bytes", async (t) => {
	const root = mkdtempSync(join(tmpdir(), "feynman-subagent-custom-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const configPath = join(root, "extensions", "subagent", "config.json");
	mkdirSync(join(root, "extensions", "subagent"), { recursive: true });
	const original = '{"missions":{"enabled":true,"globalIndex":false},"fleetView":true,"asyncByDefault":false,"maxSubagentDepth":1}\n';
	writeFileSync(configPath, original, { mode: 0o640 });
	writeFileSync(join(root, "auth.json"), "{}\n");
	await normalizeFeynmanSettings(join(root, "settings.json"), join(root, "absent.json"), "medium", join(root, "auth.json"));
	assert.equal(readFileSync(configPath, "utf8"), original);
	assert.equal(statSync(configPath).mode & 0o777, 0o640);
});

test("subagent defaults merge only missing fields while preserving nested config and false values", async (t) => {
	const root = mkdtempSync(join(tmpdir(), "feynman-subagent-partial-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const configPath = join(root, "extensions", "subagent", "config.json");
	mkdirSync(join(root, "extensions", "subagent"), { recursive: true });
	writeFileSync(configPath, JSON.stringify({
		missions: { directory: join(root, "custom-missions"), retainTerminal: 12 },
		asyncByDefault: false, asyncWidget: true, custom: { nested: ["preserved"] },
	}));
	writeFileSync(join(root, "auth.json"), "{}\n");
	await normalizeFeynmanSettings(join(root, "settings.json"), join(root, "absent.json"), "medium", join(root, "auth.json"));
	assert.deepEqual(JSON.parse(readFileSync(configPath, "utf8")), {
		missions: { directory: join(root, "custom-missions"), retainTerminal: 12, enabled: false },
		asyncByDefault: false, asyncWidget: true, custom: { nested: ["preserved"] }, fleetView: false,
	});
});

for (const invalid of [
	"{", "null", "[]", "false", '"string"',
	'{"missions":null}', '{"missions":[]}', '{"missions":false}',
	'{"missions":{"enabled":"false"}}', '{"missions":{"enabled":null}}',
	'{"fleetView":0}', '{"fleetView":null}', '{"asyncByDefault":"true"}', '{"asyncByDefault":null}',
]) {
	test(`subagent defaults reject invalid config without rewriting any settings: ${invalid}`, async (t) => {
		const root = mkdtempSync(join(tmpdir(), "feynman-subagent-invalid-"));
		t.after(() => rmSync(root, { recursive: true, force: true }));
		const configPath = join(root, "extensions", "subagent", "config.json");
		const settingsPath = join(root, "settings.json");
		mkdirSync(join(root, "extensions", "subagent"), { recursive: true });
		writeFileSync(configPath, invalid);
		const settings = '{"subagents":{"agentOverrides":{"researcher":{"subagentOnlyExtensions":["custom.ts"]}}}}\n';
		writeFileSync(settingsPath, settings);
		await assert.rejects(
			normalizeFeynmanSettings(settingsPath, join(root, "absent.json"), "medium", join(root, "absent-auth.json")),
			/Invalid subagent config/,
		);
		assert.equal(readFileSync(configPath, "utf8"), invalid);
		assert.equal(readFileSync(settingsPath, "utf8"), settings);
		assert.equal(existsSync(join(root, "absent-auth.json")), false);
	});
}

test("invalid main settings fail closed before creating subagent defaults", async (t) => {
	const root = mkdtempSync(join(tmpdir(), "feynman-settings-invalid-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const settingsPath = join(root, "settings.json");
	writeFileSync(settingsPath, "{");
	await assert.rejects(
		normalizeFeynmanSettings(settingsPath, join(root, "absent.json"), "medium", join(root, "absent-auth.json")),
		/Invalid Feynman settings/,
	);
	assert.equal(readFileSync(settingsPath, "utf8"), "{");
	assert.equal(existsSync(join(root, "extensions")), false);
});

test("normalizeFeynmanSettings gives the researcher child its Hugging Face tool provider", async () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-settings-"));
	const settingsPath = join(root, "settings.json");
	const bundledSettingsPath = join(root, "bundled-settings.json");
	const authPath = join(root, "auth.json");
	const researchToolsExtensionPath = join(root, "app", "extensions", "research-tools.ts");

	writeFileSync(
		settingsPath,
		JSON.stringify({
			subagents: {
				defaultThinking: "high",
				agentOverrides: {
					reviewer: { thinking: "medium" },
				},
			},
		}) + "\n",
		"utf8",
	);
	writeFileSync(bundledSettingsPath, "{}\n", "utf8");
	writeFileSync(authPath, "{}\n", "utf8");

	await normalizeFeynmanSettings(settingsPath, bundledSettingsPath, "medium", authPath, {
		researchToolsExtensionPath,
	});

	const settings = JSON.parse(readFileSync(settingsPath, "utf8")) as {
		subagents?: {
			defaultThinking?: string;
			agentOverrides?: Record<string, { thinking?: string; subagentOnlyExtensions?: string[] }>;
		};
	};
	assert.equal(settings.subagents?.defaultThinking, "high");
	assert.deepEqual(settings.subagents?.agentOverrides?.reviewer, { thinking: "medium" });
	assert.deepEqual(
		settings.subagents?.agentOverrides?.researcher?.subagentOnlyExtensions,
		[researchToolsExtensionPath],
	);
});

test("normalizeFeynmanSettings preserves custom researcher child extensions and adds the provider", async () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-settings-"));
	const settingsPath = join(root, "settings.json");
	const bundledSettingsPath = join(root, "bundled-settings.json");
	const authPath = join(root, "auth.json");
	const customExtensionPath = join(root, "custom-research-tools.ts");
	const researchToolsExtensionPath = join(root, "app", "extensions", "research-tools.ts");

	writeFileSync(
		settingsPath,
		JSON.stringify({
			subagents: {
				agentOverrides: {
					researcher: { subagentOnlyExtensions: [customExtensionPath] },
				},
			},
		}) + "\n",
		"utf8",
	);
	writeFileSync(bundledSettingsPath, "{}\n", "utf8");
	writeFileSync(authPath, "{}\n", "utf8");

	await normalizeFeynmanSettings(settingsPath, bundledSettingsPath, "medium", authPath, {
		researchToolsExtensionPath,
	});

	const settings = JSON.parse(readFileSync(settingsPath, "utf8")) as {
		subagents?: { agentOverrides?: Record<string, { subagentOnlyExtensions?: string[] }> };
	};
	assert.deepEqual(
		settings.subagents?.agentOverrides?.researcher?.subagentOnlyExtensions,
		[customExtensionPath, researchToolsExtensionPath],
	);
});

test("normalizeFeynmanSettings refreshes a relocated bundled researcher extension", async () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-settings-"));
	const settingsPath = join(root, "settings.json");
	const bundledSettingsPath = join(root, "bundled-settings.json");
	const authPath = join(root, "auth.json");
	const customExtensionPath = join(root, "custom-research-tools.ts");
	const oldResearchToolsExtensionPath = join(root, "old-app", "extensions", "research-tools.ts");
	const currentResearchToolsExtensionPath = join(root, "current-app", "extensions", "research-tools.ts");

	writeFileSync(
		settingsPath,
		JSON.stringify({
			subagents: {
				agentOverrides: {
					researcher: { subagentOnlyExtensions: [customExtensionPath] },
				},
			},
		}) + "\n",
		"utf8",
	);
	writeFileSync(bundledSettingsPath, "{}\n", "utf8");
	writeFileSync(authPath, "{}\n", "utf8");

	await normalizeFeynmanSettings(settingsPath, bundledSettingsPath, "medium", authPath, {
		researchToolsExtensionPath: oldResearchToolsExtensionPath,
	});
	await normalizeFeynmanSettings(settingsPath, bundledSettingsPath, "medium", authPath, {
		researchToolsExtensionPath: currentResearchToolsExtensionPath,
	});

	const settings = JSON.parse(readFileSync(settingsPath, "utf8")) as {
		subagents?: {
			agentOverrides?: Record<string, {
				subagentOnlyExtensions?: string[];
				_feynmanResearchToolsExtension?: string;
			}>;
		};
	};
	assert.deepEqual(
		settings.subagents?.agentOverrides?.researcher?.subagentOnlyExtensions,
		[customExtensionPath, currentResearchToolsExtensionPath],
	);
	assert.equal(
		settings.subagents?.agentOverrides?.researcher?._feynmanResearchToolsExtension,
		currentResearchToolsExtensionPath,
	);
});

test("bundled settings and package-list defaults use the same current core package set", () => {
	const bundledSettings = JSON.parse(
		readFileSync(join(process.cwd(), ".feynman", "settings.json"), "utf8"),
	) as { packages?: string[] };
	assert.deepEqual(bundledSettings.packages, [...CORE_PACKAGE_SOURCES]);
	assert.deepEqual(CORE_PACKAGE_SOURCES, [
		"npm:@advaitpaliwal/alpha-hub@0.1.4",
		"npm:pi-subagents@0.65.1",
		"npm:pi-btw@0.4.1",
		"npm:pi-docparser@4.0.0",
		"npm:pi-web-access@0.28.0",
		"npm:pi-otel@0.1.0",
	]);
});

test("normalizeFeynmanSettings pins managed package names and preserves custom packages", async () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-settings-"));
	const settingsPath = join(root, "settings.json");
	const bundledSettingsPath = join(root, "bundled-settings.json");
	const authPath = join(root, "auth.json");
	const customPackage = {
		source: "npm:@samfp/pi-memory@1.2.3",
		autoload: false,
		skills: ["skills/memory/SKILL.md"],
	};

	writeFileSync(
		settingsPath,
		JSON.stringify({
			packages: [
				"npm:@companion-ai/alpha-hub",
				"npm:pi-subagents",
				"npm:pi-docparser",
				"npm:pi-web-access",
				customPackage,
			],
		}, null, 2) + "\n",
		"utf8",
	);
	writeFileSync(bundledSettingsPath, "{}\n", "utf8");
	writeFileSync(authPath, "{}\n", "utf8");

	await normalizeFeynmanSettings(settingsPath, bundledSettingsPath, "medium", authPath);

	const settings = JSON.parse(readFileSync(settingsPath, "utf8")) as { packages?: unknown[] };
	assert.deepEqual(settings.packages, [
		"npm:@companion-ai/alpha-hub",
		CORE_PACKAGE_SOURCES[1],
		CORE_PACKAGE_SOURCES[3],
		CORE_PACKAGE_SOURCES[4],
		customPackage,
		CORE_PACKAGE_SOURCES[0],
		CORE_PACKAGE_SOURCES[2],
		CORE_PACKAGE_SOURCES[5],
	]);
});

test("managed package reconciliation updates stale sources without changing custom selectors", () => {
	const custom = { source: "npm:@samfp/pi-memory@next", autoload: false };
	assert.deepEqual(
		reconcileManagedCorePackageSources([
			"npm:pi-web-access@0.21.0",
			"npm:pi-subagents",
			custom,
		]),
		[
			"npm:pi-web-access@0.28.0",
			"npm:pi-subagents@0.65.1",
			custom,
			"npm:@advaitpaliwal/alpha-hub@0.1.4",
			"npm:pi-btw@0.4.1",
			"npm:pi-docparser@4.0.0",
			"npm:pi-otel@0.1.0",
		],
	);
});

test("managed package reconciliation updates every previously shipped package pin", () => {
	assert.deepEqual(
		reconcileManagedCorePackageSources([
			"npm:pi-subagents@0.37.0",
			"npm:pi-web-access@0.14.0",
		]),
		[
			"npm:pi-subagents@0.65.1",
			"npm:pi-web-access@0.28.0",
			"npm:@advaitpaliwal/alpha-hub@0.1.4",
			"npm:pi-btw@0.4.1",
			"npm:pi-docparser@4.0.0",
			"npm:pi-otel@0.1.0",
		],
	);
	assert.deepEqual(
		reconcileManagedCorePackageSources(["npm:pi-web-access@0.18.0"]),
		[
			"npm:pi-web-access@0.28.0",
			"npm:@advaitpaliwal/alpha-hub@0.1.4",
			"npm:pi-subagents@0.65.1",
			"npm:pi-btw@0.4.1",
			"npm:pi-docparser@4.0.0",
			"npm:pi-otel@0.1.0",
		],
	);
	assert.deepEqual(
		reconcileManagedCorePackageSources(["npm:pi-web-access@0.22.0"]),
		[
			"npm:pi-web-access@0.28.0",
			"npm:@advaitpaliwal/alpha-hub@0.1.4",
			"npm:pi-subagents@0.65.1",
			"npm:pi-btw@0.4.1",
			"npm:pi-docparser@4.0.0",
			"npm:pi-otel@0.1.0",
		],
	);
	assert.deepEqual(
		reconcileManagedCorePackageSources(["npm:pi-web-access@0.23.0"]),
		[
			"npm:pi-web-access@0.28.0",
			"npm:@advaitpaliwal/alpha-hub@0.1.4",
			"npm:pi-subagents@0.65.1",
			"npm:pi-btw@0.4.1",
			"npm:pi-docparser@4.0.0",
			"npm:pi-otel@0.1.0",
		],
	);
	assert.deepEqual(
		reconcileManagedCorePackageSources(["npm:pi-web-access@0.24.0"]),
		[
			"npm:pi-web-access@0.28.0",
			"npm:@advaitpaliwal/alpha-hub@0.1.4",
			"npm:pi-subagents@0.65.1",
			"npm:pi-btw@0.4.1",
			"npm:pi-docparser@4.0.0",
			"npm:pi-otel@0.1.0",
		],
	);
	assert.deepEqual(
		reconcileManagedCorePackageSources(["npm:pi-web-access@0.24.2"]),
		[
			"npm:pi-web-access@0.28.0",
			"npm:@advaitpaliwal/alpha-hub@0.1.4",
			"npm:pi-subagents@0.65.1",
			"npm:pi-btw@0.4.1",
			"npm:pi-docparser@4.0.0",
			"npm:pi-otel@0.1.0",
		],
	);
});

test("managed package reconciliation preserves an explicit custom core selector without adding a duplicate", () => {
	const custom = { source: "npm:pi-web-access@next", autoload: false };
	assert.deepEqual(
		reconcileManagedCorePackageSources([
			"npm:pi-subagents",
			custom,
		]),
		[
			"npm:pi-subagents@0.65.1",
			custom,
			"npm:@advaitpaliwal/alpha-hub@0.1.4",
			"npm:pi-btw@0.4.1",
			"npm:pi-docparser@4.0.0",
			"npm:pi-otel@0.1.0",
		],
	);
});

test("managed package reconciliation preserves a custom core string selector", () => {
	assert.deepEqual(
		reconcileManagedCorePackageSources([
			"npm:pi-subagents",
			"npm:pi-web-access@next",
		]),
		[
			"npm:pi-subagents@0.65.1",
			"npm:pi-web-access@next",
			"npm:@advaitpaliwal/alpha-hub@0.1.4",
			"npm:pi-btw@0.4.1",
			"npm:pi-docparser@4.0.0",
			"npm:pi-otel@0.1.0",
		],
	);
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

test("normalizeFeynmanSettings upgrades the 0.3.13 pinned core package set", async () => {
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
				"npm:pi-docparser@4.0.0",
				"npm:pi-web-access@0.19.0",
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

test("normalizeFeynmanSettings upgrades the 0.3.15 pinned core package set", async () => {
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
				"npm:pi-docparser@4.0.0",
				"npm:pi-web-access@0.20.0",
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

test("normalizeFeynmanSettings preserves an available DeepSeek V4 Pro default", async () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-settings-"));
	const settingsPath = join(root, "settings.json");
	const bundledSettingsPath = join(root, "bundled-settings.json");
	const authPath = join(root, "auth.json");

	writeFileSync(
		settingsPath,
		JSON.stringify({
			defaultProvider: "nebius",
			defaultModel: "deepseek-ai/DeepSeek-V4-Pro",
		}) + "\n",
		"utf8",
	);
	writeFileSync(bundledSettingsPath, "{}\n", "utf8");
	writeFileSync(authPath, JSON.stringify({ nebius: { type: "api_key", key: "nebius-test-key" } }) + "\n", "utf8");
	writeFileSync(
		join(root, "models.json"),
		JSON.stringify({
			providers: {
				nebius: {
					baseUrl: "https://api.studio.nebius.ai/v1",
					api: "openai-completions",
					models: [{ id: "deepseek-ai/DeepSeek-V4-Pro" }],
				},
			},
		}) + "\n",
		"utf8",
	);

	await normalizeFeynmanSettings(settingsPath, bundledSettingsPath, "medium", authPath);

	const settings = JSON.parse(readFileSync(settingsPath, "utf8")) as {
		defaultProvider?: string;
		defaultModel?: string;
	};
	assert.equal(settings.defaultProvider, "nebius");
	assert.equal(settings.defaultModel, "deepseek-ai/DeepSeek-V4-Pro");
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
	assert.deepEqual(resolvePackageUpdateSources("pi-subagents"), ["npm:pi-subagents@0.65.1"]);
	assert.deepEqual(resolvePackageUpdateSources("subagents"), ["npm:pi-subagents@0.65.1"]);
	assert.deepEqual(resolvePackageUpdateSources("npm:pi-subagents"), ["npm:pi-subagents@0.65.1"]);
	assert.deepEqual(resolvePackageUpdateSources("pi-web-access"), ["npm:pi-web-access@0.28.0"]);
	assert.deepEqual(resolvePackageUpdateSources("alpha-hub"), ["npm:@advaitpaliwal/alpha-hub@0.1.4"]);
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
