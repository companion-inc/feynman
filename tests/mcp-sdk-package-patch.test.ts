import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import { patchMcpSdkPackageJsonSource } from "../scripts/lib/mcp-sdk-package-patch.mjs";

test("MCP SDK package patch carries the safe Hono node server into bundled consumers", () => {
	for (const [version, range] of [
		["1.29.0", "^1.19.9"],
		["1.30.0", "^1.19.9 || ^2.0.5"],
	]) {
		const source = JSON.stringify({
			name: "@modelcontextprotocol/sdk",
			version,
			dependencies: {
				"@hono/node-server": range,
			},
		});

		const patched = JSON.parse(patchMcpSdkPackageJsonSource(source)) as {
			dependencies: Record<string, string>;
		};
		assert.equal(patched.dependencies["@hono/node-server"], "2.1.1");
	}
});

test("MCP SDK package patch is idempotent and replaces unsafe lower 2.x ranges", () => {
	const safe = JSON.stringify({
		dependencies: {
			"@hono/node-server": "2.1.1",
		},
	});
	assert.equal(patchMcpSdkPackageJsonSource(safe), safe);
	for (const unsafe of ["2.0.0", "^2.0.0", "~2.0.4", "2.0.12"]) {
		const patched = JSON.parse(patchMcpSdkPackageJsonSource(JSON.stringify({
			dependencies: { "@hono/node-server": unsafe },
		}))) as { dependencies: Record<string, string> };
		assert.equal(patched.dependencies["@hono/node-server"], "2.1.1");
	}
});

test("MCP SDK package patch fails closed on incompatible manifests", () => {
	assert.throws(
		() => patchMcpSdkPackageJsonSource(JSON.stringify({ dependencies: {} })),
		/no @hono\/node-server dependency/,
	);
	for (const unsupported of ["^1.20.0", "^2.1.0", "3.0.0", "workspace:*"]) {
		assert.throws(
			() => patchMcpSdkPackageJsonSource(JSON.stringify({
				dependencies: { "@hono/node-server": unsupported },
			})),
			/Unsupported .* @hono\/node-server dependency/,
		);
	}
});

test("embedded runtime patch wires the MCP manifest repair into installed package graphs", () => {
	const source = readFileSync(resolve("scripts", "patch-embedded-pi.mjs"), "utf8");
	assert.match(
		source,
		/import \{ patchMcpSdkPackageJsonSource \} from "\.\/lib\/mcp-sdk-package-patch\.mjs";/,
	);
	assert.match(source, /function patchMcpSdkManifest\(nodeModulesRoot\)/);
	assert.match(source, /resolve\(appRoot, "node_modules"\)/);
	assert.match(source, /patchMcpSdkManifest\(nodeModulesRoot\)/);
});
