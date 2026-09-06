import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import test from "node:test";
import assert from "node:assert/strict";

import { ALPHA_HUB_AUTH_014_SOURCE_CONTRACT, assertAlphaHubAuthSource, patchAlphaHubAuthSource } from "../scripts/lib/alpha-hub-auth-patch.mjs";

const LEGACY_ENDPOINTS = [
	"const CLERK_ISSUER = 'https://clerk.alphaxiv.org';",
	"const AUTH_ENDPOINT = `${CLERK_ISSUER}/oauth/authorize`;",
	"const TOKEN_ENDPOINT = `${CLERK_ISSUER}/oauth/token`;",
	"const REGISTER_ENDPOINT = `${CLERK_ISSUER}/oauth/register`;",
	"const CALLBACK_PORT = 9876;",
	"const REDIRECT_URI = `http://127.0.0.1:${CALLBACK_PORT}/callback`;",
	"const USERINFO_ENDPOINT = `${CLERK_ISSUER}/oauth/userinfo`;",
	"const SCOPES = 'profile email offline_access';",
].join("\n");

test("patchAlphaHubAuthSource uses alphaXiv's current OAuth endpoints", () => {
	const patched = patchAlphaHubAuthSource(LEGACY_ENDPOINTS);

	assert.match(patched, /https:\/\/api\.alphaxiv\.org\/auth/);
	assert.match(patched, /oauth2\/authorize/);
	assert.match(patched, /oauth2\/token/);
	assert.match(patched, /oauth2\/register/);
	assert.match(patched, /oauth2\/userinfo/);
	assert.match(patched, /openid profile email offline_access/);
	assert.doesNotMatch(patched, /clerk\.alphaxiv\.org/);
});

test("patchAlphaHubAuthSource fixes browser open logic for WSL and Windows", () => {
	const input = [
		"function openBrowser(url) {",
		"  try {",
		"    const plat = platform();",
		"    if (plat === 'darwin') execSync(`open \"${url}\"`);",
		"    else if (plat === 'linux') execSync(`xdg-open \"${url}\"`);",
		"    else if (plat === 'win32') execSync(`start \"\" \"${url}\"`);",
		"  } catch {}",
		"}",
	].join("\n");

	const patched = patchAlphaHubAuthSource(input);

	assert.match(patched, /const isWsl = plat === 'linux'/);
	assert.match(patched, /wslview/);
	assert.match(patched, /cmd\.exe \/c start/);
	assert.match(patched, /cmd \/c start/);
});

test("patchAlphaHubAuthSource includes the auth URL in login output", () => {
	const input = "process.stderr.write('Opening browser for alphaXiv login...\\n');";

	const patched = patchAlphaHubAuthSource(input);

	assert.match(patched, /Auth URL: \$\{authUrl\.toString\(\)\}/);
});

test("patchAlphaHubAuthSource validates OAuth state on the loopback callback", () => {
	const input = [
		"function waitForCallback(server) {",
		"      const code = url.searchParams.get('code');",
		"      const error = url.searchParams.get('error');",
		"",
		"      if (error) {",
		"  const code = await waitForCallback(server);",
	].join("\n");

	const patched = patchAlphaHubAuthSource(input);

	assert.match(patched, /function waitForCallback\(server, expectedState\)/);
	assert.match(patched, /const returnedState = url\.searchParams\.get\('state'\)/);
	assert.match(patched, /returnedState !== expectedState/);
	assert.match(patched, /OAuth state mismatch/);
	assert.match(patched, /waitForCallback\(server, state\)/);
	assert.doesNotMatch(patched, /waitForCallback\(server\);/);
	assert.equal(patchAlphaHubAuthSource(patched), patched);
});

test("patchAlphaHubAuthSource is idempotent", () => {
	const input = [
		"function openBrowser(url) {",
		"  try {",
		"    const plat = platform();",
		"    if (plat === 'darwin') execSync(`open \"${url}\"`);",
		"    else if (plat === 'linux') execSync(`xdg-open \"${url}\"`);",
		"    else if (plat === 'win32') execSync(`start \"\" \"${url}\"`);",
		"  } catch {}",
		"}",
		"process.stderr.write('Opening browser for alphaXiv login...\\n');",
	].join("\n");

	const once = patchAlphaHubAuthSource(input);
	const twice = patchAlphaHubAuthSource(once);

	assert.equal(twice, once);
});

// Exact source fixtures from the integrity-verified @advaitpaliwal/alpha-hub@0.1.4 tarball.
// Published gitHead: 9ec42ba0d499284552220315247b3f2a811e6607. Gzip keeps tests self-contained.
const PERSONAL_AUTH = gunzipSync(Buffer.from(
	"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" +
	"pcG/AeGwZEqsIgAA",
	"base64",
)).toString("utf8");

test("personal 0.1.4 auth keeps upstream OAuth fixes and adds only retained Feynman controls", () => {
	const contract = ALPHA_HUB_AUTH_014_SOURCE_CONTRACT;
	assert.equal(createHash("sha256").update(PERSONAL_AUTH).digest("hex"), contract.upstreamSha256);
	const patched = patchAlphaHubAuthSource(PERSONAL_AUTH, { version: "0.1.4" });
	assertAlphaHubAuthSource(patched);
	assert.equal(createHash("sha256").update(patched).digest("hex"), contract.patchedSha256);
	assert.equal(patchAlphaHubAuthSource(patched, { version: "0.1.4" }), patched);
	assert.equal(patchAlphaHubAuthSource(PERSONAL_AUTH), patched);
	assert.equal((patched.match(/const returnedState =/g) || []).length, 1);
	assert.match(patched, /openid profile email offline_access/);
	assert.match(patched, /waitForCallback\(server, state\)/);
	assert.match(patched, /wslview/);
	assert.match(patched, /Auth URL:/);
	// Existing branding substitution targeted older simple HTML, not 0.1.3/0.1.4 templates.
	for (const name of ["SUCCESS_HTML", "ERROR_HTML"]) {
		const pattern = new RegExp(`const ${name} = \\x60[\\s\\S]*?\\x60;`);
		assert.equal(patched.match(pattern)?.[0], PERSONAL_AUTH.match(pattern)?.[0]);
	}
});

test("personal auth fails closed on mutated raw/patched source and wrong explicit version", () => {
	const patched = patchAlphaHubAuthSource(PERSONAL_AUTH);
	for (const source of [PERSONAL_AUTH, patched]) {
		for (const changed of [source + "\n", source.replace("OAuth state mismatch", "ignored state"), source.replace("openid profile", "profile")]) {
			assert.throws(() => patchAlphaHubAuthSource(changed, { version: "0.1.4" }), /Unsupported/);
			assert.throws(() => patchAlphaHubAuthSource(changed), /Unsupported/);
			assert.throws(() => assertAlphaHubAuthSource(changed), /Unsupported/);
		}
	}
	assert.throws(() => patchAlphaHubAuthSource(PERSONAL_AUTH, { version: "0.1.5" }), /Unsupported/);
	assert.throws(() => patchAlphaHubAuthSource("", { version: "0.1.4" }), /Unsupported/);
	assert.throws(() => assertAlphaHubAuthSource(PERSONAL_AUTH), /Unsupported/);
});

test("personal patched auth executes Windows and WSL browser fallbacks without launching anything", () => {
	const patched = patchAlphaHubAuthSource(PERSONAL_AUTH);
	const browser = patched.match(/function openBrowser\(url\) \{[\s\S]*?\n\}/)?.[0];
	assert.ok(browser);
	for (const [platform, env, failWsl, expected] of [
		["darwin", {}, false, ['open "https://example.invalid/login"']],
		["win32", {}, false, ['cmd /c start "" "https://example.invalid/login"']],
		["linux", {}, false, ['xdg-open "https://example.invalid/login"']],
		["linux", { WSL_INTEROP: "test" }, false, ['wslview "https://example.invalid/login"']],
		["linux", { WSL_DISTRO_NAME: "test" }, true, ['wslview "https://example.invalid/login"', 'cmd.exe /c start "" "https://example.invalid/login"']],
	] as const) {
		const commands: string[] = [];
		const run = new Function("platform", "process", "execSync", `${browser}; return openBrowser;`)(
			() => platform, { env }, (command: string) => {
				commands.push(command);
				if (failWsl && command.startsWith("wslview")) throw new Error("not installed");
			},
		);
		run("https://example.invalid/login");
		assert.deepEqual(commands, expected);
	}
});
