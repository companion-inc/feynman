import test from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

import { toNodeImportSpecifier } from "../src/pi/launch.js";

test(
	"toNodeImportSpecifier converts Windows absolute paths into file URLs",
	{ skip: process.platform !== "win32" ? "Windows path assertion only applies on win32" : false },
	() => {
		assert.equal(
			toNodeImportSpecifier("C:\\repo\\feynman\\dist\\system\\promise-polyfill.js"),
			"file:///C:/repo/feynman/dist/system/promise-polyfill.js",
		);
	},
);

test("toNodeImportSpecifier matches Node's URL encoding for import targets", () => {
	const modulePath = resolve("/repo/feynman", "dist", "system", "promise polyfill.js");

	assert.equal(toNodeImportSpecifier(modulePath), pathToFileURL(modulePath).href);
});
