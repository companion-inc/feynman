import test from "node:test";
import assert from "node:assert/strict";

import { getOpenUrlCommand } from "../src/system/open-url.js";

test("getOpenUrlCommand on win32 does not use cmd shell", () => {
	const result = getOpenUrlCommand("https://example.com", "win32");
	assert.ok(result, "should return a command");
	assert.notEqual(result.command, "cmd", "should not invoke cmd.exe");
});

test("getOpenUrlCommand on win32 passes URL as single argument", () => {
	const malicious = "https://example.com&calc";
	const result = getOpenUrlCommand(malicious, "win32");
	assert.ok(result, "should return a command");
	// URL must be a single argument, not split or interpreted
	assert.ok(result.args.includes(malicious), "URL should appear as a single argument");
});

test("getOpenUrlCommand on darwin uses open", () => {
	const resolve = (name: string) => (name === "open" ? "/usr/bin/open" : undefined);
	const result = getOpenUrlCommand("https://example.com", "darwin", resolve);
	assert.ok(result);
	assert.equal(result.command, "/usr/bin/open");
	assert.deepEqual(result.args, ["https://example.com"]);
});

test("getOpenUrlCommand on linux uses xdg-open", () => {
	const resolve = (name: string) => (name === "xdg-open" ? "/usr/bin/xdg-open" : undefined);
	const result = getOpenUrlCommand("https://example.com", "linux", resolve);
	assert.ok(result);
	assert.equal(result.command, "/usr/bin/xdg-open");
	assert.deepEqual(result.args, ["https://example.com"]);
});
