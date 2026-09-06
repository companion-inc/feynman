export const FEYNMAN_PACKAGE_NAME = "@advaitpaliwal/feynman";
const REGISTRY_LATEST_URL = `https://registry.npmjs.org/${FEYNMAN_PACKAGE_NAME}/latest`;

function parseVersion(version: string): number[] | undefined {
	const match = version.trim().replace(/^v/, "").match(/^(\d+)\.(\d+)\.(\d+)$/);
	if (!match) return undefined;
	return [Number.parseInt(match[1]!, 10), Number.parseInt(match[2]!, 10), Number.parseInt(match[3]!, 10)];
}

export function isNewerVersion(candidate: string, current: string): boolean {
	const parsedCandidate = parseVersion(candidate);
	const parsedCurrent = parseVersion(current);
	if (!parsedCandidate || !parsedCurrent) return false;
	for (let index = 0; index < 3; index += 1) {
		if (parsedCandidate[index]! !== parsedCurrent[index]!) {
			return parsedCandidate[index]! > parsedCurrent[index]!;
		}
	}
	return false;
}

export async function fetchLatestFeynmanVersion(timeoutMs = 5000): Promise<string | undefined> {
	try {
		const response = await fetch(REGISTRY_LATEST_URL, {
			headers: { Accept: "application/json" },
			signal: AbortSignal.timeout(timeoutMs),
		});
		if (!response.ok) return undefined;
		const data = (await response.json()) as { version?: unknown };
		return typeof data.version === "string" && parseVersion(data.version) ? data.version : undefined;
	} catch {
		return undefined;
	}
}

export function getFeynmanUpgradeLines(
	latestVersion: string,
	currentVersion: string,
	options: { standaloneBundle: boolean; platform?: NodeJS.Platform },
): string[] {
	const platform = options.platform ?? process.platform;
	const upgradeCommand = options.standaloneBundle
		? platform === "win32"
			? "irm https://feynman.is/install.ps1 | iex"
			: "curl -fsSL https://feynman.is/install | bash"
		: `npm install -g ${FEYNMAN_PACKAGE_NAME}`;
	return [
		`A newer Feynman is available: ${latestVersion} (installed ${currentVersion}).`,
		`Update the CLI itself with: ${upgradeCommand}`,
	];
}
