import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createCipheriv, createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import {
	PI_WEB_ACCESS_WINDOWS_COOKIES_SHA256,
	patchPiWebAccessWindowsCookiesSource,
} from "../scripts/lib/pi-web-access-windows-cookies-patch.mjs";

const PI_WEB_ACCESS_FIXTURE_ROOT = join(
	import.meta.dirname,
	"..",
	"fixtures",
	"pi-web-access-0.28.0",
);
const PI_WEB_ACCESS_RUNTIME_ROOT = join(
	import.meta.dirname,
	"..",
	".feynman",
	"npm",
	"node_modules",
	"pi-web-access",
);

test("Windows cookie forward port is exact, digest-gated, and idempotent", () => {
	const baseline = readFileSync(
		join(PI_WEB_ACCESS_FIXTURE_ROOT, "chrome-cookies.ts"),
		"utf8",
	);
	const patched = patchPiWebAccessWindowsCookiesSource(baseline);
	assert.equal(
		createHash("sha256").update(patched).digest("hex"),
		PI_WEB_ACCESS_WINDOWS_COOKIES_SHA256,
	);
	assert.equal(patchPiWebAccessWindowsCookiesSource(patched), patched);
	assert.throws(
		() => patchPiWebAccessWindowsCookiesSource(`${baseline}\n`),
		/expected d69f91df.*eed7b448/,
	);
});

function createWindowsCookieFixture(
	home: string,
	browser: "Chrome" | "Edge",
	rows: Array<[string, string, string, string, number]>,
): void {
	const base = browser === "Edge"
		? join(home, "AppData", "Local", "Microsoft", "Edge", "User Data")
		: join(home, "AppData", "Local", "Google", "Chrome", "User Data");
	const databasePath = join(base, "Default", "Network", "Cookies");
	mkdirSync(dirname(databasePath), { recursive: true });
	const created = spawnSync("python3", ["-c", `
import json, sqlite3, sys
c = sqlite3.connect(sys.argv[1])
c.execute("create table meta (key text, value integer)")
c.execute("insert into meta values ('version', 24)")
c.execute("create table cookies (name text, value text, host_key text, encrypted_value blob, expires_utc integer)")
for row in json.loads(sys.argv[2]):
    c.execute("insert into cookies values (?, ?, ?, ?, ?)", [row[0], row[1], row[2], bytes.fromhex(row[3]), row[4]])
c.commit()
c.close()
`, databasePath, JSON.stringify(rows)], { encoding: "utf8" });
	assert.equal(created.status, 0, created.stderr);
	writeFileSync(
		join(base, "Local State"),
		JSON.stringify({
			os_crypt: {
				encrypted_key: Buffer.concat([
					Buffer.from("DPAPI"),
					Buffer.from("protected"),
				]).toString("base64"),
			},
		}),
	);
}

function encryptWindowsCookie(
	value: string,
	key: Buffer,
	version: "v10" | "v20",
	hostKey?: string,
): string {
	const nonce = Buffer.alloc(12, 7);
	const cipher = createCipheriv("aes-256-gcm", key, nonce);
	const plaintext = hostKey
		? Buffer.concat([createHash("sha256").update(hostKey).digest(), Buffer.from(value)])
		: Buffer.from(value);
	return Buffer.concat([
		Buffer.from(version),
		nonce,
		cipher.update(plaintext),
		cipher.final(),
		cipher.getAuthTag(),
	]).toString("hex");
}

function runWindowsCookieProbe(
	home: string,
	bin: string,
	key: Buffer,
	localAppData: boolean,
	requestUrl = false,
): { result: { cookies: Record<string, string> } | null; diagnostic: string | null } {
	const powershellPath = join(bin, "powershell.exe");
	writeFileSync(
		powershellPath,
		'#!/bin/sh\nscript=\nwhile [ "$#" -gt 0 ]; do\n\tif [ "$1" = "-Command" ]; then\n\t\tshift\n\t\tscript=${1-}\n\t\tshift\n\t\t[ "$#" -eq 0 ] || exit 2\n\t\tbreak\n\tfi\n\tshift\ndone\ncase "$script" in\n\t*"Add-Type -AssemblyName System.Security"*"[Console]::In.ReadToEnd()"*) ;;\n\t*) exit 3 ;;\nesac\ninput=$(cat)\n[ "$input" = "$DPAPI_PROTECTED" ] || exit 4\nprintf "%s" "$DPAPI_KEY"\n',
	);
	chmodSync(powershellPath, 0o755);
	const chromeCookiesUrl = pathToFileURL(
		join(PI_WEB_ACCESS_RUNTIME_ROOT, "chrome-cookies.ts"),
	).href;
	const env = {
		...process.env,
		HOME: home,
		USERPROFILE: home,
		PI_ALLOW_BROWSER_COOKIES: "1",
		PATH: `${bin}:${process.env.PATH ?? ""}`,
		DPAPI_KEY: key.toString("base64"),
		DPAPI_PROTECTED: Buffer.from("protected").toString("base64"),
		TEMP: tmpdir(),
		TMP: tmpdir(),
		...(localAppData ? { LOCALAPPDATA: join(home, "AppData", "Local") } : {}),
	};
	if (!localAppData) delete env.LOCALAPPDATA;
	const child = spawnSync(
		process.execPath,
		["--import", "tsx", "--input-type=module"],
		{
			encoding: "utf8",
			env,
			input: `
				Object.defineProperty(process, "platform", { value: "win32" });
				const module = await import(${JSON.stringify(chromeCookiesUrl)});
				const result = ${requestUrl
					? `await module.getBrowserCookiesForHosts({
						hosts: ["google.com"],
						requiredCookies: ["__Secure-1PSID", "__Secure-1PSIDTS"],
						requestUrl: new URL("https://google.com/"),
					})`
					: `await module.getGoogleCookies({
						requiredCookies: ["__Secure-1PSID", "__Secure-1PSIDTS"],
					})`};
				console.log(JSON.stringify({
					result,
					diagnostic: module.getLastGoogleCookieDiagnostic(),
				}));
			`,
		},
	);
	assert.equal(child.status, 0, child.stderr);
	assert.doesNotMatch(child.stderr, new RegExp(key.toString("base64"), "i"));
	return JSON.parse(child.stdout.trim());
}

test("runtime Windows Chrome handles large expiries and decrypts DPAPI-backed v10 cookies", () => {
	const home = mkdtempSync(join(tmpdir(), "feynman-cookie-windows-"));
	const bin = mkdtempSync(join(tmpdir(), "feynman-cookie-bin-"));
	try {
		const key = Buffer.alloc(32, 3);
		createWindowsCookieFixture(home, "Chrome", [
			["__Secure-1PSID", "", ".google.com", encryptWindowsCookie("one", key, "v10", ".google.com"), 13_500_000_000_000_000],
			["__Secure-1PSIDTS", "", ".google.com", encryptWindowsCookie("two", key, "v10", ".google.com"), 13_500_000_000_000_000],
			["STALE", "expired", ".google.com", "", 13_000_000_000_000_000],
		]);
		assert.deepEqual(
			runWindowsCookieProbe(home, bin, key, true, true).result?.cookies,
			{ "__Secure-1PSIDTS": "two", "__Secure-1PSID": "one" },
		);
	} finally {
		rmSync(home, { recursive: true, force: true });
		rmSync(bin, { recursive: true, force: true });
	}
});

test("runtime Windows Edge reports unsupported v20 app-bound Gemini cookies", () => {
	const home = mkdtempSync(join(tmpdir(), "feynman-cookie-edge-"));
	const bin = mkdtempSync(join(tmpdir(), "feynman-cookie-bin-"));
	try {
		const key = Buffer.alloc(32, 4);
		createWindowsCookieFixture(home, "Edge", [
			["__Secure-1PSID", "", ".google.com", encryptWindowsCookie("one", key, "v20"), 1],
			["__Secure-1PSIDTS", "", ".google.com", encryptWindowsCookie("two", key, "v20"), 2],
		]);
		const probe = runWindowsCookieProbe(home, bin, key, false);
		assert.equal(probe.result, null);
		assert.match(probe.diagnostic ?? "", /v20 app-bound cookies are not supported/);
	} finally {
		rmSync(home, { recursive: true, force: true });
		rmSync(bin, { recursive: true, force: true });
	}
});
