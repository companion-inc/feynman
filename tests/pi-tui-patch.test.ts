import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
	patchPiEditorSource,
	patchPiInteractiveThemeSource,
	patchPiInteractiveUpdateNoticeSource,
	patchPiTuiSource,
} from "../scripts/lib/pi-tui-patch.mjs";

const SOURCE = `
        const renderEnd = Math.min(lastChanged, newLines.length - 1);
        for (let i = firstChanged; i <= renderEnd; i++) {
            if (i > firstChanged)
                buffer += "\\r\\n";
            buffer += "\\x1b[2K"; // Clear current line
            const line = newLines[i];
            const isImage = isImageLine(line);
            if (!isImage && visibleWidth(line) > width) {
                // Log all lines to crash file for debugging
                const crashLogPath = path.join(os.homedir(), ".pi", "agent", "pi-crash.log");
                const crashData = [
                    \`Crash at \${new Date().toISOString()}\`,
                    \`Terminal width: \${width}\`,
                    \`Line \${i} visible width: \${visibleWidth(line)}\`,
                    "",
                    "=== All rendered lines ===",
                    ...newLines.map((l, idx) => \`[\${idx}] (w=\${visibleWidth(l)}) \${l}\`),
                    "",
                ].join("\\n");
                fs.mkdirSync(path.dirname(crashLogPath), { recursive: true });
                fs.writeFileSync(crashLogPath, crashData);
                // Clean up terminal state before throwing
                this.stop();
                const errorMsg = [
                    \`Rendered line \${i} exceeds terminal width (\${visibleWidth(line)} > \${width}).\`,
                    "",
                    "This is likely caused by a custom TUI component not truncating its output.",
                    "Use visibleWidth() to measure and truncateToWidth() to truncate lines.",
                    "",
                    \`Debug log written to: \${crashLogPath}\`,
                ].join("\\n");
                throw new Error(errorMsg);
            }
            buffer += line;
        }
`;

const CURRENT_SOURCE = `
	        const renderEnd = Math.min(lastChanged, newLines.length - 1);
	        for (let i = firstChanged; i <= renderEnd; i++) {
	            if (i > firstChanged)
	                buffer += "\\r\\n";
	            const line = newLines[i];
	            const isImage = isImageLine(line);
	            const imageReservedRows = isImage ? this.getKittyImageReservedRows(newLines, i, renderEnd) : 1;
	            if (imageReservedRows > 1) {
	                const imageStartScreenRow = i - viewportTop;
	                if (imageStartScreenRow < 0 || imageStartScreenRow + imageReservedRows > height) {
	                    logRedraw(\`kitty image pre-clear would scroll (\${imageStartScreenRow} + \${imageReservedRows} > \${height})\`);
	                    fullRender(true);
	                    return;
	                }
	                buffer += "\\x1b[2K";
	                for (let row = 1; row < imageReservedRows; row++) {
	                    buffer += "\\r\\n\\x1b[2K";
	                }
	                buffer += \`\\x1b[\${imageReservedRows - 1}A\`;
	                buffer += line;
	                buffer += \`\\x1b[\${imageReservedRows - 1}B\`;
	                i += imageReservedRows - 1;
	                continue;
	            }
	            buffer += "\\x1b[2K"; // Clear current line
	            if (!isImage && visibleWidth(line) > width) {
	                // Log all lines to crash file for debugging
	                const crashLogPath = path.join(os.homedir(), ".pi", "agent", "pi-crash.log");
	                const crashData = [
	                    \`Crash at \${new Date().toISOString()}\`,
	                    \`Terminal width: \${width}\`,
	                    \`Line \${i} visible width: \${visibleWidth(line)}\`,
	                    "",
	                    "=== All rendered lines ===",
	                    ...newLines.map((l, idx) => \`[\${idx}] (w=\${visibleWidth(l)}) \${l}\`),
	                    "",
	                ].join("\\n");
	                fs.mkdirSync(path.dirname(crashLogPath), { recursive: true });
	                fs.writeFileSync(crashLogPath, crashData);
	                // Clean up terminal state before throwing
	                this.stop();
	                const errorMsg = [
	                    \`Rendered line \${i} exceeds terminal width (\${visibleWidth(line)} > \${width}).\`,
	                    "",
	                    "This is likely caused by a custom TUI component not truncating its output.",
	                    "Use visibleWidth() to measure and truncateToWidth() to truncate lines.",
	                    "",
	                    \`Debug log written to: \${crashLogPath}\`,
	                ].join("\\n");
	                throw new Error(errorMsg);
	            }
	            buffer += line;
	        }
	`;

test("patchPiTuiSource truncates overwide rendered lines instead of throwing", () => {
	const patched = patchPiTuiSource(SOURCE);

	assert.match(patched, /let line = newLines\[i\]/);
	assert.match(patched, /line = sliceByColumn\(line, 0, width, true\)/);
	assert.doesNotMatch(patched, /Rendered line .* exceeds terminal width/);
	assert.doesNotMatch(patched, /pi-crash\.log/);
	assert.doesNotMatch(patched, /throw new Error\(errorMsg\)/);
});

test("patchPiTuiSource truncates the current upstream overflow check after clearing the line", () => {
	const patched = patchPiTuiSource(CURRENT_SOURCE.replace(/^\t/gm, ""));

	assert.match(patched, /let line = newLines\[i\]/);
	assert.match(patched, /line = sliceByColumn\(line, 0, width, true\)/);
	assert.match(patched, /imageReservedRows > 1/);
	assert.doesNotMatch(patched, /Rendered line .* exceeds terminal width/);
	assert.doesNotMatch(patched, /pi-crash\.log/);
	assert.doesNotMatch(patched, /throw new Error\(errorMsg\)/);
});

test("embedded Pi TUI and editor patches apply without dropping Unicode behavior", () => {
	const tuiMainScreen = patchPiTuiSource(readFileSync(
		join(process.cwd(), "node_modules", "@earendil-works", "pi-tui", "dist", "tui-main-screen.js"),
		"utf8",
	));
	const editor = patchPiEditorSource(readFileSync(join(process.cwd(), "node_modules", "@earendil-works", "pi-tui", "dist", "components", "editor.js"), "utf8"));

	assert.match(tuiMainScreen, /line = sliceByColumn\(line, 0, width, true\)/);
	assert.doesNotMatch(tuiMainScreen, /Rendered line .* exceeds terminal width/);
	assert.match(editor, /applyBackgroundToLine, cjkBreakRegex/);
	assert.match(editor, /const styleInput = typeof this\.theme\.input === "function"/);
	assert.match(editor, /createScrollBorder/);
	assert.match(editor, /firstGrapheme/);
	assert.match(editor, /const cursor = `\\x1b\[7m\$\{firstGrapheme\}\\x1b\[27m`/);
	assert.match(editor, /const cursor = "\\x1b\[7m \\x1b\[27m"/);
	assert.doesNotMatch(editor, /const cursor = .*\\x1b\[0m/);
	assert.match(editor, /sliceByColumn/);
});

test("patchPiTuiSource is idempotent", () => {
	const once = patchPiTuiSource(SOURCE);
	const twice = patchPiTuiSource(once);
	assert.equal(twice, once);
});

test("Pi TUI patchers fail closed on unknown upstream layouts", () => {
	assert.throws(
		() => patchPiTuiSource("export class TUI {}"),
		/Unsupported Pi TUI layout/,
	);
	assert.throws(
		() => patchPiEditorSource("export class Editor {}"),
		/Unsupported Pi editor layout/,
	);
	assert.throws(
		() => patchPiInteractiveThemeSource("export function getEditorTheme() { return {}; }"),
		/Unsupported Pi interactive theme layout/,
	);
});

const EDITOR_SOURCE = `
import { getSegmenter, isPunctuationChar, isWhitespaceChar, truncateToWidth, visibleWidth } from "../utils.js";

export class Editor {
    render(width) {
        const layoutLines = this.layoutText(width);
        return layoutLines.map((line) => line.text);
    }
    handleInput(data) {
        return data;
    }
}
`;

const THEME_SOURCE = `
export function getEditorTheme() {
    return {
        borderColor: (text) => theme.fg("borderMuted", text),
        selectList: getSelectListTheme(),
    };
}
export function getSettingsListTheme() {
    return {};
}
`;

const INTERACTIVE_UPDATE_NOTICE_SOURCE = [
	'const unrelatedAction = theme.fg("accent", `${APP_NAME} update --extensions`);',
	"    showPackageUpdateNotification(packages) {",
	'        const action = theme.fg("accent", `${APP_NAME} update --extensions`);',
	'        const updateInstruction = theme.fg("muted", "Package updates are available. Run ") + action;',
	"    }",
].join("\n");

test("patchPiEditorSource styles typed input before applying the editor background", () => {
	const patched = patchPiEditorSource(EDITOR_SOURCE);

	assert.match(patched, /applyBackgroundToLine, getSegmenter/);
	assert.match(patched, /const styleInput = typeof this\.theme\.input === "function"/);
	assert.match(patched, /displayText = styleInput\(before\) \+ marker \+ styleInput\(after\)/);
	assert.match(patched, /displayText = styleInput\(displayText\)/);
	assert.match(patched, /applyBackgroundToLine\(renderedLine, width, bgColor\)/);
});

test("patchPiEditorSource is idempotent", () => {
	const once = patchPiEditorSource(EDITOR_SOURCE);
	const twice = patchPiEditorSource(once);
	assert.equal(twice, once);
});

test("patchPiEditorSource upgrades full fake-cursor resets without clearing the background", () => {
	const source = [
		'const styleInput = typeof this.theme.input === "function" ? this.theme.input : (text) => text;',
		'                    const cursor = `\\x1b[7m${firstGrapheme}\\x1b[0m`;',
		'                    const cursor = "\\x1b[7m \\x1b[0m";',
	].join("\n");
	const patched = patchPiEditorSource(source);

	assert.match(patched, /\\x1b\[27m/);
	assert.doesNotMatch(patched, /\\x1b\[0m/);
	assert.equal(patchPiEditorSource(patched), patched);
});

test("patchPiInteractiveThemeSource gives editor input an explicit foreground", () => {
	const patched = patchPiInteractiveThemeSource(THEME_SOURCE);

	assert.match(patched, /bgColor: \(text\) => theme\.bg\("userMessageBg", text\)/);
	assert.match(patched, /input: \(text\) => theme\.fg\("text", text\)/);
	assert.match(patched, /placeholder: \(text\) => theme\.fg\("dim", text\)/);
});

test("patchPiInteractiveThemeSource is idempotent", () => {
	const once = patchPiInteractiveThemeSource(THEME_SOURCE);
	const twice = patchPiInteractiveThemeSource(once);
	assert.equal(twice, once);
});

test("patchPiInteractiveUpdateNoticeSource routes package notices through the full update command", () => {
	const patched = patchPiInteractiveUpdateNoticeSource(INTERACTIVE_UPDATE_NOTICE_SOURCE);

	assert.match(patched, /Feynman: package update notices use the full update command\./);
	assert.match(
		patched,
		/showPackageUpdateNotification\(packages\) \{\n\s+\/\/ Feynman:[^\n]+\n\s+const action = theme\.fg\("accent", `\$\{APP_NAME\} update`\);/,
	);
	assert.match(
		patched,
		/const unrelatedAction = theme\.fg\("accent", `\$\{APP_NAME\} update --extensions`\);/,
	);
	assert.equal(patchPiInteractiveUpdateNoticeSource(patched), patched);
});

test("patchPiInteractiveUpdateNoticeSource fails closed on unknown or ambiguous layouts", () => {
	assert.throws(
		() => patchPiInteractiveUpdateNoticeSource("export class InteractiveMode {}"),
		/Unsupported Pi interactive update notice layout/,
	);
	assert.throws(
		() => patchPiInteractiveUpdateNoticeSource(
			`${INTERACTIVE_UPDATE_NOTICE_SOURCE}\n${INTERACTIVE_UPDATE_NOTICE_SOURCE}`,
		),
		/Unsupported Pi interactive update notice layout/,
	);
});
