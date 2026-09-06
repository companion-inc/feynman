import { createHash } from "node:crypto";

// pi-web-access 0.28.0 retains bounded Chromium expiry conversion and
// app-bound-cookie rejection while adding browser/profile selection and
// structured diagnostics, but its DPAPI subprocess again places protected
// ciphertext in the child environment. Keep Feynman's narrower stdin-only
// transport and exact digest gate.
const BASELINE_SHA256 =
	"d69f91df6ef0e1768fc487c49c1056c3601b798989143eda95b0eefa8e3e108b";
export const PI_WEB_ACCESS_WINDOWS_COOKIES_SHA256 =
	"eed7b4488bee4fcedaa7007edfc387ce01491500566e54140273de958d65f9da";

const UPSTREAM_UNPROTECT_WINDOWS_DATA = `function unprotectWindowsData(protectedData: Buffer): Promise<Buffer | null> {
	return new Promise((resolve) => {
		const script = "Add-Type -AssemblyName System.Security;$data=[Convert]::FromBase64String($env:PIWA_PROTECTED);$clear=[System.Security.Cryptography.ProtectedData]::Unprotect($data,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser);[Console]::Write([Convert]::ToBase64String($clear))";
		const encoded = Buffer.from(script, "utf16le").toString("base64");
		execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], { timeout: 5000, maxBuffer: 1024 * 1024, env: { ...process.env, PIWA_PROTECTED: protectedData.toString("base64") } }, (err, stdout) => {
			if (err) { resolve(null); return; }
			try {
				resolve(Buffer.from(stdout.trim(), "base64"));
			} catch {
				resolve(null);
			}
		});
	});
}`;

const FIXED_UNPROTECT_WINDOWS_DATA = `function unprotectWindowsData(protectedData: Buffer): Promise<Buffer | null> {
	return new Promise((resolve) => {
		const script = "$ErrorActionPreference='Stop';Add-Type -AssemblyName System.Security;$encoded=[Console]::In.ReadToEnd();$data=[Convert]::FromBase64String($encoded);$clear=[Security.Cryptography.ProtectedData]::Unprotect($data,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);[Console]::Write([Convert]::ToBase64String($clear))";
		const child = execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { timeout: 5000, maxBuffer: 1024 * 1024, windowsHide: true }, (err, stdout) => {
			if (err) { resolve(null); return; }
			try {
				resolve(Buffer.from(stdout.trim(), "base64"));
			} catch {
				resolve(null);
			}
		});
		if (!child.stdin) {
			child.kill();
			resolve(null);
			return;
		}
		child.stdin.on("error", () => {});
		child.stdin.end(protectedData.toString("base64"));
	});
}`;

function digest(source) {
	return createHash("sha256").update(source.replace(/\r\n/g, "\n")).digest("hex");
}

export function patchPiWebAccessWindowsCookiesSource(source) {
	const sourceDigest = digest(source);
	if (sourceDigest === PI_WEB_ACCESS_WINDOWS_COOKIES_SHA256) return source;
	if (sourceDigest === BASELINE_SHA256 && source.includes(UPSTREAM_UNPROTECT_WINDOWS_DATA)) {
		const patched = source.replace(
			UPSTREAM_UNPROTECT_WINDOWS_DATA,
			FIXED_UNPROTECT_WINDOWS_DATA,
		);
		if (digest(patched) === PI_WEB_ACCESS_WINDOWS_COOKIES_SHA256) {
			return patched;
		}
	}
	throw new Error(
		`Unsupported pi-web-access 0.28.0 chrome-cookies.ts: expected ${BASELINE_SHA256} or ${PI_WEB_ACCESS_WINDOWS_COOKIES_SHA256}, found ${sourceDigest}`,
	);
}
