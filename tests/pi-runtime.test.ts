import test from "node:test";
import assert from "node:assert/strict";
import { delimiter, resolve } from "node:path";

import { applyFeynmanPackageManagerEnv, buildPiArgs, buildPiEnv, resolvePiPaths } from "../src/pi/runtime.js";

test("buildPiArgs includes configured runtime paths and prompt", () => {
	const args = buildPiArgs({
		appRoot: "/repo/feynman",
		workingDir: "/workspace",
		sessionDir: "/sessions",
		feynmanAgentDir: "/home/.feynman/agent",
		initialPrompt: "hello",
		explicitModelSpec: "openai:gpt-5.4",
		thinkingLevel: "medium",
	});

	assert.deepEqual(args, [
		"--session-dir",
		"/sessions",
		"--extension",
		resolve("/repo/feynman", "extensions", "research-tools.ts"),
		"--prompt-template",
		resolve("/repo/feynman", "prompts"),
		"--model",
		"openai:gpt-5.4",
		"--thinking",
		"medium",
		"hello",
	]);
});

test("buildPiEnv wires Feynman paths into the Pi environment", () => {
	const previousUppercasePrefix = process.env.NPM_CONFIG_PREFIX;
	const previousLowercasePrefix = process.env.npm_config_prefix;
	process.env.NPM_CONFIG_PREFIX = "/tmp/global-prefix";
	process.env.npm_config_prefix = "/tmp/global-prefix-lower";

	const env = buildPiEnv({
		appRoot: "/repo/feynman",
		workingDir: "/workspace",
		sessionDir: "/sessions",
		feynmanAgentDir: "/home/.feynman/agent",
		feynmanVersion: "0.1.5",
	});

	try {
		assert.equal(env.FEYNMAN_SESSION_DIR, "/sessions");
		assert.equal(env.FEYNMAN_BIN_PATH, resolve("/repo/feynman", "bin", "feynman.js"));
		assert.equal(env.FEYNMAN_MEMORY_DIR, resolve("/home/.feynman", "memory"));
		assert.equal(env.FEYNMAN_NPM_PREFIX, resolve("/home/.feynman", "npm-global"));
		assert.equal(env.NPM_CONFIG_PREFIX, resolve("/home/.feynman", "npm-global"));
		assert.equal(env.npm_config_prefix, resolve("/home/.feynman", "npm-global"));
		assert.equal(env.PI_CODING_AGENT_DIR, "/home/.feynman/agent");
		assert.ok(
			env.PATH?.startsWith(
				[
					resolve("/repo/feynman", "node_modules", ".bin"),
					resolve("/repo/feynman", ".feynman", "npm", "node_modules", ".bin"),
					resolve("/home/.feynman", "npm-global", "bin"),
				].join(delimiter) + delimiter,
			),
		);
	} finally {
		if (previousUppercasePrefix === undefined) {
			delete process.env.NPM_CONFIG_PREFIX;
		} else {
			process.env.NPM_CONFIG_PREFIX = previousUppercasePrefix;
		}
		if (previousLowercasePrefix === undefined) {
			delete process.env.npm_config_prefix;
		} else {
			process.env.npm_config_prefix = previousLowercasePrefix;
		}
	}
});

test("applyFeynmanPackageManagerEnv pins npm globals to the Feynman prefix", () => {
	const previousFeynmanPrefix = process.env.FEYNMAN_NPM_PREFIX;
	const previousUppercasePrefix = process.env.NPM_CONFIG_PREFIX;
	const previousLowercasePrefix = process.env.npm_config_prefix;

	try {
		const prefix = applyFeynmanPackageManagerEnv("/home/.feynman/agent");

		assert.equal(prefix, resolve("/home/.feynman", "npm-global"));
		assert.equal(process.env.FEYNMAN_NPM_PREFIX, resolve("/home/.feynman", "npm-global"));
		assert.equal(process.env.NPM_CONFIG_PREFIX, resolve("/home/.feynman", "npm-global"));
		assert.equal(process.env.npm_config_prefix, resolve("/home/.feynman", "npm-global"));
	} finally {
		if (previousFeynmanPrefix === undefined) {
			delete process.env.FEYNMAN_NPM_PREFIX;
		} else {
			process.env.FEYNMAN_NPM_PREFIX = previousFeynmanPrefix;
		}
		if (previousUppercasePrefix === undefined) {
			delete process.env.NPM_CONFIG_PREFIX;
		} else {
			process.env.NPM_CONFIG_PREFIX = previousUppercasePrefix;
		}
		if (previousLowercasePrefix === undefined) {
			delete process.env.npm_config_prefix;
		} else {
			process.env.npm_config_prefix = previousLowercasePrefix;
		}
	}
});

test("resolvePiPaths includes the Promise.withResolvers polyfill path", () => {
	const paths = resolvePiPaths("/repo/feynman");

	assert.equal(paths.promisePolyfillPath, resolve("/repo/feynman", "dist", "system", "promise-polyfill.js"));
});
