const SAFE_HONO_NODE_SERVER_VERSION = "2.1.1";

/**
 * MCP SDK 1.30.0 allows the security-fixed @hono/node-server v2 line, but also
 * permits older transitive resolutions for compatibility. Feynman bundles this
 * dependency tree, so pin the exact tested v2 release in the shipped manifest.
 * Keep the reviewed adapter identity aligned with the root/runtime override.
 */
export function patchMcpSdkPackageJsonSource(source) {
	const manifest = JSON.parse(source);
	if (!manifest.dependencies || typeof manifest.dependencies !== "object") {
		throw new Error("@modelcontextprotocol/sdk package.json has no dependencies object");
	}

	const current = manifest.dependencies["@hono/node-server"];
	if (current === SAFE_HONO_NODE_SERVER_VERSION) {
		return source;
	}
	if (typeof current !== "string") {
		throw new Error("@modelcontextprotocol/sdk package.json has no @hono/node-server dependency");
	}
	const knownUnsafeRange =
		current === "2.0.12" ||
		current === "^1.19.9" ||
		current === "^1.19.9 || ^2.0.5" ||
		(() => {
			const match = /^[~^]?2\.0\.(\d+)$/.exec(current);
			return match !== null && Number.parseInt(match[1], 10) < 12;
		})();
	if (!knownUnsafeRange) {
		throw new Error(
			`Unsupported @modelcontextprotocol/sdk @hono/node-server dependency: ${current}`,
		);
	}

	manifest.dependencies["@hono/node-server"] = SAFE_HONO_NODE_SERVER_VERSION;
	return JSON.stringify(manifest, null, 2) + "\n";
}
