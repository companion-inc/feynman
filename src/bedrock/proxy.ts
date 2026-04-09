import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";

const PROXY_PORT = 4000;
const PROXY_HEALTH_URL = `http://127.0.0.1:${PROXY_PORT}/health`;
const STARTUP_TIMEOUT_MS = 15_000;
const POLL_INTERVAL_MS = 300;

let proxyProcess: ChildProcess | undefined;

async function isProxyRunning(): Promise<boolean> {
	try {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), 2000);
		const res = await fetch(PROXY_HEALTH_URL, { signal: controller.signal });
		clearTimeout(timer);
		return res.ok;
	} catch {
		return false;
	}
}

async function waitForProxy(): Promise<void> {
	const deadline = Date.now() + STARTUP_TIMEOUT_MS;
	while (Date.now() < deadline) {
		if (await isProxyRunning()) return;
		await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
	}
	throw new Error(`Bedrock proxy did not become healthy within ${STARTUP_TIMEOUT_MS / 1000}s on port ${PROXY_PORT}`);
}

export async function ensureBedrockProxy(appRoot: string): Promise<void> {
	if (await isProxyRunning()) {
		return;
	}

	const scriptPath = resolve(appRoot, "scripts", "bedrock-proxy.py");
	const child = spawn("python3", ["-u", scriptPath, "--port", String(PROXY_PORT)], {
		stdio: "ignore",
		detached: false,
		env: {
			...process.env,
			HTTP_PROXY: process.env.HTTP_PROXY ?? "http://127.0.0.1:7890",
			HTTPS_PROXY: process.env.HTTPS_PROXY ?? "http://127.0.0.1:7890",
			http_proxy: process.env.http_proxy ?? "http://127.0.0.1:7890",
			https_proxy: process.env.https_proxy ?? "http://127.0.0.1:7890",
			NO_PROXY: "localhost,127.0.0.1",
			no_proxy: "localhost,127.0.0.1",
		},
	});

	child.on("error", () => {});
	child.unref();
	proxyProcess = child;

	await waitForProxy();
}

export function stopBedrockProxy(): void {
	if (proxyProcess && !proxyProcess.killed) {
		proxyProcess.kill();
		proxyProcess = undefined;
	}
}
