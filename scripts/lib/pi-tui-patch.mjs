const OVERFLOW_THROW_BLOCK = `            const line = newLines[i];
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
            buffer += line;`;

const OVERFLOW_TRUNCATE_BLOCK = `            let line = newLines[i];
            const isImage = isImageLine(line);
            if (!isImage && visibleWidth(line) > width) {
                line = sliceByColumn(line, 0, width, true);
            }
            buffer += line;`;

const OVERFLOW_THROW_BLOCK_AFTER_CLEAR = `            const line = newLines[i];
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
            buffer += line;`;

const OVERFLOW_TRUNCATE_BLOCK_AFTER_CLEAR = `            let line = newLines[i];
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
                line = sliceByColumn(line, 0, width, true);
            }
            buffer += line;`;

const OVERFLOW_THROW_BLOCK_AFTER_CLEAR_CURRENT = OVERFLOW_THROW_BLOCK_AFTER_CLEAR.replace(
	'path.join(os.homedir(), ".pi", "agent", "pi-crash.log")',
	'path.join(this.logDirectory, "pi-crash.log")',
);

const CURRENT_EDITOR_IMPORT = 'import { cjkBreakRegex, getGraphemeSegmenter, getWordSegmenter, isWhitespaceChar, sliceByColumn, visibleWidth, } from "../utils.js";';
const CURRENT_EDITOR_IMPORT_PATCHED = 'import { applyBackgroundToLine, cjkBreakRegex, getGraphemeSegmenter, getWordSegmenter, isWhitespaceChar, sliceByColumn, visibleWidth, } from "../utils.js";';

// Two known upstream layouts: pi-tui <=0.75 and the 0.76+ Unicode
// word-navigation rework. Both need applyBackgroundToLine added for the
// background-fill render below.
const EDITOR_IMPORT_PAIRS = [
	[
		'import { getSegmenter, isPunctuationChar, isWhitespaceChar, truncateToWidth, visibleWidth } from "../utils.js";',
		'import { applyBackgroundToLine, getSegmenter, isPunctuationChar, isWhitespaceChar, truncateToWidth, visibleWidth } from "../utils.js";',
	],
	[
		'import { getGraphemeSegmenter, getWordSegmenter, isWhitespaceChar, truncateToWidth, visibleWidth } from "../utils.js";',
		'import { applyBackgroundToLine, getGraphemeSegmenter, getWordSegmenter, isWhitespaceChar, truncateToWidth, visibleWidth } from "../utils.js";',
	],
];

const EDITOR_RENDER_BLOCK = [
	"    render(width) {",
	"        const maxPadding = Math.max(0, Math.floor((width - 1) / 2));",
	"        const paddingX = Math.min(this.paddingX, maxPadding);",
	"        const contentWidth = Math.max(1, width - paddingX * 2);",
	"        // Layout width: with padding the cursor can overflow into it,",
	"        // without padding we reserve 1 column for the cursor.",
	"        const layoutWidth = Math.max(1, contentWidth - (paddingX ? 0 : 1));",
	"        // Store for cursor navigation (must match wrapping width)",
	"        this.lastWidth = layoutWidth;",
	'        const horizontal = this.borderColor("─");',
	"        const bgColor = this.theme.bgColor;",
	"        // Layout the text",
	"        const layoutLines = this.layoutText(layoutWidth);",
	"        // Calculate max visible lines: 30% of terminal height, minimum 5 lines",
	"        const terminalRows = this.tui.terminal.rows;",
	"        const maxVisibleLines = Math.max(5, Math.floor(terminalRows * 0.3));",
	"        // Find the cursor line index in layoutLines",
	"        let cursorLineIndex = layoutLines.findIndex((line) => line.hasCursor);",
	"        if (cursorLineIndex === -1)",
	"            cursorLineIndex = 0;",
	"        // Adjust scroll offset to keep cursor visible",
	"        if (cursorLineIndex < this.scrollOffset) {",
	"            this.scrollOffset = cursorLineIndex;",
	"        }",
	"        else if (cursorLineIndex >= this.scrollOffset + maxVisibleLines) {",
	"            this.scrollOffset = cursorLineIndex - maxVisibleLines + 1;",
	"        }",
	"        // Clamp scroll offset to valid range",
	"        const maxScrollOffset = Math.max(0, layoutLines.length - maxVisibleLines);",
	"        this.scrollOffset = Math.max(0, Math.min(this.scrollOffset, maxScrollOffset));",
	"        // Get visible lines slice",
	"        const visibleLines = layoutLines.slice(this.scrollOffset, this.scrollOffset + maxVisibleLines);",
	"        const result = [];",
	'        const leftPadding = " ".repeat(paddingX);',
	"        const rightPadding = leftPadding;",
	"        const renderBorderLine = (indicator) => {",
	"            const remaining = width - visibleWidth(indicator);",
	"            if (remaining >= 0) {",
	'                return this.borderColor(indicator + "─".repeat(remaining));',
	"            }",
	"            return this.borderColor(truncateToWidth(indicator, width));",
	"        };",
	"        // Render top padding row. When background fill is active, mimic the user-message block",
	"        // instead of the stock editor chrome.",
	"        if (bgColor) {",
	"            if (this.scrollOffset > 0) {",
	"                const indicator = `  ↑ ${this.scrollOffset} more`;",
	"                result.push(applyBackgroundToLine(indicator, width, bgColor));",
	"            }",
	"            else {",
	'                result.push(applyBackgroundToLine("", width, bgColor));',
	"            }",
	"        }",
	"        else if (this.scrollOffset > 0) {",
	"            const indicator = `─── ↑ ${this.scrollOffset} more `;",
	"            result.push(renderBorderLine(indicator));",
	"        }",
	"        else {",
	"            result.push(horizontal.repeat(width));",
	"        }",
	"        // Render each visible layout line",
	"        // Emit hardware cursor marker when focused so the TUI can position the",
	"        // hardware cursor for IME candidate windows even while autocomplete is open.",
	"        const emitCursorMarker = this.focused;",
	"        const showPlaceholder = this.state.lines.length === 1 &&",
	'            this.state.lines[0] === "" &&',
	'            typeof this.theme.placeholderText === "string" &&',
	"            this.theme.placeholderText.length > 0;",
	"        const styleInput = typeof this.theme.input === \"function\" ? this.theme.input : (text) => text;",
	"        for (let visibleIndex = 0; visibleIndex < visibleLines.length; visibleIndex++) {",
	"            const layoutLine = visibleLines[visibleIndex];",
	"            const isFirstLayoutLine = this.scrollOffset + visibleIndex === 0;",
	"            let displayText = layoutLine.text;",
	"            let lineVisibleWidth = visibleWidth(layoutLine.text);",
	"            const isPlaceholderLine = showPlaceholder && isFirstLayoutLine;",
	"            if (isPlaceholderLine) {",
	"                const marker = emitCursorMarker ? CURSOR_MARKER : \"\";",
	"                const rawPlaceholder = this.theme.placeholderText;",
	'                const styledPlaceholder = typeof this.theme.placeholder === "function"',
	"                    ? this.theme.placeholder(rawPlaceholder)",
	"                    : rawPlaceholder;",
	"                displayText = marker + styledPlaceholder;",
	"                lineVisibleWidth = visibleWidth(rawPlaceholder);",
	"            }",
	"            else if (layoutLine.hasCursor && layoutLine.cursorPos !== undefined) {",
	'                const marker = emitCursorMarker ? CURSOR_MARKER : "";',
	"                const before = displayText.slice(0, layoutLine.cursorPos);",
	"                const after = displayText.slice(layoutLine.cursorPos);",
	"                displayText = styleInput(before) + marker + styleInput(after);",
	"            }",
	"            else {",
	"                displayText = styleInput(displayText);",
	"            }",
	"            // Calculate padding based on actual visible width",
	'            const padding = " ".repeat(Math.max(0, contentWidth - lineVisibleWidth));',
	"            const renderedLine = `${leftPadding}${displayText}${padding}${rightPadding}`;",
	"            result.push(bgColor ? applyBackgroundToLine(renderedLine, width, bgColor) : renderedLine);",
	"        }",
	"        // Render bottom padding row. When background fill is active, mimic the user-message block",
	"        // instead of the stock editor chrome.",
	"        const linesBelow = layoutLines.length - (this.scrollOffset + visibleLines.length);",
	"        if (bgColor) {",
	"            if (linesBelow > 0) {",
	"                const indicator = `  ↓ ${linesBelow} more`;",
	"                result.push(applyBackgroundToLine(indicator, width, bgColor));",
	"            }",
	"            else {",
	'                result.push(applyBackgroundToLine("", width, bgColor));',
	"            }",
	"        }",
	"        else if (linesBelow > 0) {",
	"            const indicator = `─── ↓ ${linesBelow} more `;",
	"            const bottomLine = renderBorderLine(indicator);",
	"            result.push(bottomLine);",
	"        }",
	"        else {",
	"            const bottomLine = horizontal.repeat(width);",
	"            result.push(bottomLine);",
	"        }",
	"        // Add autocomplete list if active",
	"        if (this.autocompleteState && this.autocompleteList) {",
	"            const autocompleteResult = this.autocompleteList.render(contentWidth);",
	"            for (const line of autocompleteResult) {",
	"                const lineWidth = visibleWidth(line);",
	'                const linePadding = " ".repeat(Math.max(0, contentWidth - lineWidth));',
	"                const autocompleteLine = `${leftPadding}${line}${linePadding}${rightPadding}`;",
	"                result.push(bgColor ? applyBackgroundToLine(autocompleteLine, width, bgColor) : autocompleteLine);",
	"            }",
	"        }",
	"        return result;",
	"    }",
].join("\n");

const EDITOR_THEME_BLOCK = [
	"export function getEditorTheme() {",
	"    return {",
	'        borderColor: (text) => " ".repeat(text.length),',
	'        bgColor: (text) => theme.bg("userMessageBg", text),',
	'        input: (text) => theme.fg("text", text),',
	'        placeholderText: "Type your message or /help for commands",',
	'        placeholder: (text) => theme.fg("dim", text),',
	"        selectList: getSelectListTheme(),",
	"    };",
	"}",
].join("\n");

function patchCurrentEditorSource(source) {
	const replacements = [
		[
			CURRENT_EDITOR_IMPORT,
			CURRENT_EDITOR_IMPORT_PATCHED,
		],
		[
			'        const horizontal = this.borderColor("─");\n        // Layout the text',
			'        const horizontal = this.borderColor("─");\n        const bgColor = this.theme.bgColor;\n        const styleInput = typeof this.theme.input === "function" ? this.theme.input : (text) => text;\n        // Layout the text',
		],
		[
			`        // Render top border (with scroll indicator if scrolled down)
        if (this.scrollOffset > 0) {
            const border = createScrollBorder("↑", this.scrollOffset, width);
            result.push(this.borderColor(border));
        }
        else {
            result.push(horizontal.repeat(width));
        }`,
			`        // Render top border (with scroll indicator if scrolled down)
        if (this.scrollOffset > 0) {
            const border = createScrollBorder("↑", this.scrollOffset, width);
            result.push(bgColor ? applyBackgroundToLine(\`  ↑ \${this.scrollOffset} more\`, width, bgColor) : this.borderColor(border));
        }
        else {
            result.push(bgColor ? applyBackgroundToLine("", width, bgColor) : horizontal.repeat(width));
        }`,
		],
		[
			"        const emitCursorMarker = this.focused;\n        for (const layoutLine of visibleLines) {",
			`        const emitCursorMarker = this.focused;
        const showPlaceholder = this.state.lines.length === 1 &&
            this.state.lines[0] === "" &&
            typeof this.theme.placeholderText === "string" &&
            this.theme.placeholderText.length > 0;
        for (const layoutLine of visibleLines) {`,
		],
		[
			`            let cursorInPadding = false;
            // Add cursor if this line has it
            if (layoutLine.hasCursor && layoutLine.cursorPos !== undefined) {`,
			`            let cursorInPadding = false;
            const isPlaceholderLine = showPlaceholder && this.scrollOffset === 0 && layoutLine === visibleLines[0];
            if (isPlaceholderLine) {
                const marker = emitCursorMarker ? CURSOR_MARKER : "";
                const placeholder = typeof this.theme.placeholder === "function"
                    ? this.theme.placeholder(this.theme.placeholderText)
                    : this.theme.placeholderText;
                displayText = marker + placeholder;
                lineVisibleWidth = visibleWidth(this.theme.placeholderText);
            }
            // Add cursor if this line has it
            else if (layoutLine.hasCursor && layoutLine.cursorPos !== undefined) {`,
		],
		[
			"                    displayText = before + marker + cursor + restAfter;",
			"                    displayText = styleInput(before) + marker + cursor + styleInput(restAfter);",
		],
		[
			'                    const cursor = `\\x1b[7m${firstGrapheme}\\x1b[0m`;',
			'                    const cursor = `\\x1b[7m${firstGrapheme}\\x1b[27m`;',
		],
		[
			'                    const cursor = "\\x1b[7m \\x1b[0m";',
			'                    const cursor = "\\x1b[7m \\x1b[27m";',
		],
		[
			"                    displayText = before + marker + cursor;",
			"                    displayText = styleInput(before) + marker + cursor;",
		],
		[
			`                }
            }
            // Calculate padding based on actual visible width`,
			`                }
            }
            else {
                displayText = styleInput(displayText);
            }
            // Calculate padding based on actual visible width`,
		],
		[
			'            result.push(`${leftPadding}${displayText}${padding}${lineRightPadding}`);',
			'            const renderedLine = `${leftPadding}${displayText}${padding}${lineRightPadding}`;\n            result.push(bgColor ? applyBackgroundToLine(renderedLine, width, bgColor) : renderedLine);',
		],
		[
			`        // Render bottom border (with scroll indicator if more content below)
        const linesBelow = layoutLines.length - (this.scrollOffset + visibleLines.length);
        if (linesBelow > 0) {
            const border = createScrollBorder("↓", linesBelow, width);
            result.push(this.borderColor(border));
        }
        else {
            result.push(horizontal.repeat(width));
        }`,
			`        // Render bottom border (with scroll indicator if more content below)
        const linesBelow = layoutLines.length - (this.scrollOffset + visibleLines.length);
        if (linesBelow > 0) {
            const border = createScrollBorder("↓", linesBelow, width);
            result.push(bgColor ? applyBackgroundToLine(\`  ↓ \${linesBelow} more\`, width, bgColor) : this.borderColor(border));
        }
        else {
            result.push(bgColor ? applyBackgroundToLine("", width, bgColor) : horizontal.repeat(width));
        }`,
		],
		[
			'                result.push(`${leftPadding}${line}${linePadding}${rightPadding}`);',
			'                const renderedLine = `${leftPadding}${line}${linePadding}${rightPadding}`;\n                result.push(bgColor ? applyBackgroundToLine(renderedLine, width, bgColor) : renderedLine);',
		],
	];
	// 0.85.1 extracted border methods so the embedded working indicator can
	// customize them. Preserve those calls while applying the same input,
	// placeholder, cursor and background transformations.
	if (source.includes("        result.push(this.renderTopBorder(width, this.scrollOffset));")) {
		replacements[1] = [
			"        this.lastWidth = layoutWidth;\n        // Layout the text",
			'        this.lastWidth = layoutWidth;\n        const bgColor = this.theme.bgColor;\n        const styleInput = typeof this.theme.input === "function" ? this.theme.input : (text) => text;\n        // Layout the text',
		];
		replacements[2] = [
			"        result.push(this.renderTopBorder(width, this.scrollOffset));",
			"        const topBorder = this.renderTopBorder(width, this.scrollOffset);\n        result.push(bgColor ? applyBackgroundToLine(topBorder, width, bgColor) : topBorder);",
		];
		replacements[11] = [
			"        result.push(this.renderBottomBorder(width, linesBelow));",
			"        const bottomBorder = this.renderBottomBorder(width, linesBelow);\n        result.push(bgColor ? applyBackgroundToLine(bottomBorder, width, bgColor) : bottomBorder);",
		];
	}
	const missing = replacements
		.map(([original], index) => source.includes(original) ? undefined : index + 1)
		.filter(Boolean);
	if (missing.length > 0) {
		throw new Error(`Unsupported Pi editor layout: missing required 0.82 patch anchors ${missing.join(", ")}`);
	}
	return replacements.reduce((patched, [original, replacement]) => patched.replace(original, replacement), source);
}

export function patchPiTuiSource(source) {
	if (source.includes("line = sliceByColumn(line, 0, width, true);")) {
		return source;
	}
	// Pi 0.84 split main-screen rendering out of tui.js. The base controller
	// no longer owns the overflow check; patch tui-main-screen.js separately.
	if (
		source.includes("export class TuiBase extends Container") &&
		source.includes("export const VIEWPORT_TUI")
	) {
		return source;
	}
	if (source.includes(OVERFLOW_THROW_BLOCK)) {
		return source.replace(OVERFLOW_THROW_BLOCK, OVERFLOW_TRUNCATE_BLOCK);
	}
	if (source.includes(OVERFLOW_THROW_BLOCK_AFTER_CLEAR)) {
		return source.replace(OVERFLOW_THROW_BLOCK_AFTER_CLEAR, OVERFLOW_TRUNCATE_BLOCK_AFTER_CLEAR);
	}
	if (source.includes(OVERFLOW_THROW_BLOCK_AFTER_CLEAR_CURRENT)) {
		return source.replace(OVERFLOW_THROW_BLOCK_AFTER_CLEAR_CURRENT, OVERFLOW_TRUNCATE_BLOCK_AFTER_CLEAR);
	}
	// 0.85.1 changed the output accumulator to RenderBuffer.append. Preserve it
	// (avoids V8 large-string overflow) and the complete Kitty-image handling.
	const currentThrow = OVERFLOW_THROW_BLOCK_AFTER_CLEAR_CURRENT.replace(
		/buffer \+= ([^;\n]+);/g, "output.append($1);",
	).replace('path.join(this.logDirectory, "pi-crash.log")',
		'path.join(this.logDirectory ?? os.tmpdir(), "pi-tui-crash.log")');
	const currentTruncate = OVERFLOW_TRUNCATE_BLOCK_AFTER_CLEAR.replace(
		/buffer \+= ([^;\n]+);/g, "output.append($1);",
	);
	if (source.includes(currentThrow)) {
		const importAnchor = 'import { visibleWidth } from "./utils.js";';
		if (source.split(importAnchor).length !== 2)
			throw new Error("Unsupported Pi 0.85.1 TUI truncation import");
		return source.replace(currentThrow, currentTruncate)
			.replace(importAnchor, 'import { sliceByColumn, visibleWidth } from "./utils.js";');
	}
	throw new Error("Unsupported Pi TUI layout: required overflow patch anchor was not found");
}

export function patchPiEditorSource(source) {
	if (source.includes(CURRENT_EDITOR_IMPORT) && !source.includes("const styleInput = typeof this.theme.input")) {
		return patchCurrentEditorSource(source);
	}
	if (source.includes("const styleInput = typeof this.theme.input")) {
		return source
			.replace(
				'                    const cursor = `\\x1b[7m${firstGrapheme}\\x1b[0m`;',
				'                    const cursor = `\\x1b[7m${firstGrapheme}\\x1b[27m`;',
			)
			.replace(
				'                    const cursor = "\\x1b[7m \\x1b[0m";',
				'                    const cursor = "\\x1b[7m \\x1b[27m";',
			);
	}
	let patched = source;
	let importsPatched = patched.includes("applyBackgroundToLine,");
	for (const [original, replacement] of EDITOR_IMPORT_PAIRS) {
		if (patched.includes(original)) {
			patched = patched.replace(original, replacement);
			importsPatched = true;
		}
	}
	if (!importsPatched) {
		throw new Error("Unsupported Pi editor layout: required import patch anchor was not found");
	}
	const rendered = patched.replace(
		/    render\(width\) \{[\s\S]*?\n    handleInput\(data\) \{/m,
		`${EDITOR_RENDER_BLOCK}\n    handleInput(data) {`,
	);
	if (rendered === patched || !rendered.includes("const styleInput = typeof this.theme.input")) {
		throw new Error("Unsupported Pi editor layout: required render patch anchor was not found");
	}
	return rendered;
}

export function patchPiInteractiveThemeSource(source) {
	if (
		source.includes('bgColor: (text) => theme.bg("userMessageBg", text),') &&
		source.includes('input: (text) => theme.fg("text", text),')
	) {
		return source;
	}
	const patched = source.replace(
		/export function getEditorTheme\(\) \{[\s\S]*?\n\}\nexport function getSettingsListTheme\(\) \{/m,
		`${EDITOR_THEME_BLOCK}\nexport function getSettingsListTheme() {`,
	);
	if (
		patched === source ||
		!patched.includes('bgColor: (text) => theme.bg("userMessageBg", text),') ||
		!patched.includes('input: (text) => theme.fg("text", text),')
	) {
		throw new Error("Unsupported Pi interactive theme layout: required editor-theme patch anchor was not found");
	}
	return patched;
}

const INTERACTIVE_UPDATE_NOTICE_SOURCE = `    showPackageUpdateNotification(packages) {
        const action = theme.fg("accent", \`\${APP_NAME} update --extensions\`);`;
const INTERACTIVE_UPDATE_NOTICE_PATCHED_SOURCE = `    showPackageUpdateNotification(packages) {
        // Feynman: package update notices use the full update command.
        const action = theme.fg("accent", \`\${APP_NAME} update\`);`;

export function patchPiInteractiveUpdateNoticeSource(source) {
	if (
		source.includes(INTERACTIVE_UPDATE_NOTICE_PATCHED_SOURCE) &&
		!source.includes(INTERACTIVE_UPDATE_NOTICE_SOURCE)
	) {
		return source;
	}
	const firstAnchor = source.indexOf(INTERACTIVE_UPDATE_NOTICE_SOURCE);
	if (
		firstAnchor === -1 ||
		source.indexOf(INTERACTIVE_UPDATE_NOTICE_SOURCE, firstAnchor + INTERACTIVE_UPDATE_NOTICE_SOURCE.length) !== -1
	) {
		throw new Error(
			"Unsupported Pi interactive update notice layout: required unique package-update anchor was not found",
		);
	}
	return source.replace(INTERACTIVE_UPDATE_NOTICE_SOURCE, INTERACTIVE_UPDATE_NOTICE_PATCHED_SOURCE);
}
