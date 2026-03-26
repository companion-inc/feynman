export const MIN_NODE_VERSION = "20.18.1";

type ParsedNodeVersion = {
	major: number;
	minor: number;
	patch: number;
};

function parseNodeVersion(version: string): ParsedNodeVersion {
	const [major = "0", minor = "0", patch = "0"] = version.replace(/^v/, "").split(".");
	return {
		major: Number.parseInt(major, 10) || 0,
		minor: Number.parseInt(minor, 10) || 0,
		patch: Number.parseInt(patch, 10) || 0,
	};
}

function compareNodeVersions(left: ParsedNodeVersion, right: ParsedNodeVersion): number {
	if (left.major !== right.major) return left.major - right.major;
	if (left.minor !== right.minor) return left.minor - right.minor;
	return left.patch - right.patch;
}

export function isSupportedNodeVersion(version = process.versions.node): boolean {
	return compareNodeVersions(parseNodeVersion(version), parseNodeVersion(MIN_NODE_VERSION)) >= 0;
}

export function getUnsupportedNodeVersionLines(version = process.versions.node): string[] {
	const isWindows = process.platform === "win32";
	return [
		`feynman requires Node.js ${MIN_NODE_VERSION} or later (detected ${version}).`,
		isWindows
			? "Install a newer Node.js from https://nodejs.org, or use the standalone installer:"
			: "Switch to Node 20 with `nvm install 20 && nvm use 20`, or use the standalone installer:",
		isWindows
			? "irm https://feynman.is/install.ps1 | iex"
			: "curl -fsSL https://feynman.is/install | bash",
	];
}

export function ensureSupportedNodeVersion(version = process.versions.node): void {
	if (!isSupportedNodeVersion(version)) {
		throw new Error(getUnsupportedNodeVersionLines(version).join("\n"));
	}
}
