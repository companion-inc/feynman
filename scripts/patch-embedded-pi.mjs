import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FEYNMAN_LOGO_HTML } from "../logo.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, "..");
const appRequire = createRequire(resolve(appRoot, "package.json"));
const isGlobalInstall = process.env.npm_config_global === "true" || process.env.npm_config_location === "global";

function findPackageRoot(packageName) {
	const segments = packageName.split("/");
	let current = appRoot;
	while (current !== dirname(current)) {
		for (const candidate of [resolve(current, "node_modules", ...segments), resolve(current, ...segments)]) {
			if (existsSync(resolve(candidate, "package.json"))) {
				return candidate;
			}
		}
		current = dirname(current);
	}

	for (const spec of [`${packageName}/dist/index.js`, `${packageName}/dist/cli.js`, packageName]) {
		try {
			let current = dirname(appRequire.resolve(spec));
			while (current !== dirname(current)) {
				if (existsSync(resolve(current, "package.json"))) {
					return current;
				}
				current = dirname(current);
			}
		} catch {
			continue;
		}
	}
	return null;
}

const piPackageRoot = findPackageRoot("@mariozechner/pi-coding-agent");
const piTuiRoot = findPackageRoot("@mariozechner/pi-tui");
const piAiRoot = findPackageRoot("@mariozechner/pi-ai");

if (!piPackageRoot) {
	console.warn("[feynman] pi-coding-agent not found, skipping Pi patches");
}

const packageJsonPath = piPackageRoot ? resolve(piPackageRoot, "package.json") : null;
const cliPath = piPackageRoot ? resolve(piPackageRoot, "dist", "cli.js") : null;
const bunCliPath = piPackageRoot ? resolve(piPackageRoot, "dist", "bun", "cli.js") : null;
const interactiveModePath = piPackageRoot ? resolve(piPackageRoot, "dist", "modes", "interactive", "interactive-mode.js") : null;
const interactiveThemePath = piPackageRoot ? resolve(piPackageRoot, "dist", "modes", "interactive", "theme", "theme.js") : null;
const terminalPath = piTuiRoot ? resolve(piTuiRoot, "dist", "terminal.js") : null;
const editorPath = piTuiRoot ? resolve(piTuiRoot, "dist", "components", "editor.js") : null;
const workspaceRoot = resolve(appRoot, ".feynman", "npm", "node_modules");
const webAccessPath = resolve(workspaceRoot, "pi-web-access", "index.ts");
const sessionSearchIndexerPath = resolve(
	workspaceRoot,
	"@kaiserlich-dev",
	"pi-session-search",
	"extensions",
	"indexer.ts",
);
const piMemoryPath = resolve(workspaceRoot, "@samfp", "pi-memory", "src", "index.ts");
const settingsPath = resolve(appRoot, ".feynman", "settings.json");
const workspaceDir = resolve(appRoot, ".feynman", "npm");
const workspacePackageJsonPath = resolve(workspaceDir, "package.json");
const workspaceArchivePath = resolve(appRoot, ".feynman", "runtime-workspace.tgz");

function createInstallCommand(packageManager, packageSpecs) {
	switch (packageManager) {
		case "npm":
			return ["install", "--prefer-offline", "--no-audit", "--no-fund", "--loglevel", "error", ...packageSpecs];
		case "pnpm":
			return ["add", "--prefer-offline", "--reporter", "silent", ...packageSpecs];
		case "bun":
			return ["add", "--silent", ...packageSpecs];
		default:
			throw new Error(`Unsupported package manager: ${packageManager}`);
	}
}

let cachedPackageManager = undefined;

function resolvePackageManager() {
	if (cachedPackageManager !== undefined) return cachedPackageManager;

	const requested = process.env.FEYNMAN_PACKAGE_MANAGER?.trim();
	const candidates = requested ? [requested] : ["npm", "pnpm", "bun"];
	for (const candidate of candidates) {
		if (resolveExecutable(candidate)) {
			cachedPackageManager = candidate;
			return candidate;
		}
	}

	cachedPackageManager = null;
	return null;
}

function installWorkspacePackages(packageSpecs) {
	const packageManager = resolvePackageManager();
	if (!packageManager) {
		process.stderr.write(
			"[feynman] no supported package manager found; install npm, pnpm, or bun, or set FEYNMAN_PACKAGE_MANAGER.\n",
		);
		return false;
	}

	const result = spawnSync(packageManager, createInstallCommand(packageManager, packageSpecs), {
		cwd: workspaceDir,
		stdio: ["ignore", "ignore", "pipe"],
		timeout: 300000,
	});

	if (result.status !== 0) {
		if (result.stderr?.length) process.stderr.write(result.stderr);
		process.stderr.write(`[feynman] ${packageManager} failed while setting up bundled packages.\n`);
		return false;
	}

	return true;
}

function parsePackageName(spec) {
	const match = spec.match(/^(@?[^@]+(?:\/[^@]+)?)(?:@.+)?$/);
	return match?.[1] ?? spec;
}

function restorePackagedWorkspace(packageSpecs) {
	if (!existsSync(workspaceArchivePath)) return false;

	rmSync(workspaceDir, { recursive: true, force: true });
	mkdirSync(resolve(appRoot, ".feynman"), { recursive: true });

	const result = spawnSync("tar", ["-xzf", workspaceArchivePath, "-C", resolve(appRoot, ".feynman")], {
		stdio: ["ignore", "ignore", "pipe"],
		timeout: 300000,
	});

	// On Windows, tar may exit non-zero due to symlink creation failures in
	// .bin/ directories. These are non-fatal — check whether the actual
	// package directories were extracted successfully.
	const packagesPresent = packageSpecs.every((spec) => existsSync(resolve(workspaceRoot, parsePackageName(spec))));
	if (packagesPresent) return true;

	if (result.status !== 0) {
		if (result.stderr?.length) process.stderr.write(result.stderr);
		return false;
	}

	return false;
}

function refreshPackagedWorkspace(packageSpecs) {
	return installWorkspacePackages(packageSpecs);
}

function resolveExecutable(name, fallbackPaths = []) {
	for (const candidate of fallbackPaths) {
		if (existsSync(candidate)) return candidate;
	}

	const isWindows = process.platform === "win32";
	const result = isWindows
		? spawnSync("cmd", ["/c", `where ${name}`], {
				encoding: "utf8",
				stdio: ["ignore", "pipe", "ignore"],
			})
		: spawnSync("sh", ["-lc", `command -v ${name}`], {
				encoding: "utf8",
				stdio: ["ignore", "pipe", "ignore"],
			});
	if (result.status === 0) {
		const resolved = result.stdout.trim().split(/\r?\n/)[0];
		if (resolved) return resolved;
	}
	return null;
}

function ensurePackageWorkspace() {
	if (!existsSync(settingsPath)) return;

	const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
	const packageSpecs = Array.isArray(settings.packages)
		? settings.packages
				.filter((v) => typeof v === "string" && v.startsWith("npm:"))
				.map((v) => v.slice(4))
		: [];

	if (packageSpecs.length === 0) return;
	if (existsSync(resolve(workspaceRoot, parsePackageName(packageSpecs[0])))) return;
	if (restorePackagedWorkspace(packageSpecs) && refreshPackagedWorkspace(packageSpecs)) return;

	mkdirSync(workspaceDir, { recursive: true });
	writeFileSync(
		workspacePackageJsonPath,
		JSON.stringify({ name: "feynman-packages", private: true }, null, 2) + "\n",
		"utf8",
	);

	const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
	let frame = 0;
	const start = Date.now();
	const spinner = setInterval(() => {
		const elapsed = Math.round((Date.now() - start) / 1000);
		process.stderr.write(`\r${frames[frame++ % frames.length]} setting up feynman... ${elapsed}s`);
	}, 80);

	const result = installWorkspacePackages(packageSpecs);

	clearInterval(spinner);
	const elapsed = Math.round((Date.now() - start) / 1000);

	if (!result) {
		process.stderr.write(`\r✗ setup failed (${elapsed}s)\n`);
	} else {
		process.stderr.write(`\r✓ feynman ready (${elapsed}s)\n`);
	}
}

ensurePackageWorkspace();

function ensurePandoc() {
	if (!isGlobalInstall) return;
	if (process.platform !== "darwin") return;
	if (process.env.FEYNMAN_SKIP_PANDOC_INSTALL === "1") return;
	if (resolveExecutable("pandoc", ["/opt/homebrew/bin/pandoc", "/usr/local/bin/pandoc"])) return;

	const brewPath = resolveExecutable("brew", ["/opt/homebrew/bin/brew", "/usr/local/bin/brew"]);
	if (!brewPath) return;

	console.log("[feynman] installing pandoc...");
	const result = spawnSync(brewPath, ["install", "pandoc"], {
		stdio: "inherit",
		timeout: 300000,
	});
	if (result.status !== 0) {
		console.warn("[feynman] warning: pandoc install failed, run `feynman --setup-preview` later");
	}
}

ensurePandoc();

if (packageJsonPath && existsSync(packageJsonPath)) {
	const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8"));
	if (pkg.piConfig?.name !== "feynman" || pkg.piConfig?.configDir !== ".feynman") {
		pkg.piConfig = {
			...(pkg.piConfig || {}),
			name: "feynman",
			configDir: ".feynman",
		};
		writeFileSync(packageJsonPath, JSON.stringify(pkg, null, "\t") + "\n", "utf8");
	}
}

for (const entryPath of [cliPath, bunCliPath].filter(Boolean)) {
	if (!existsSync(entryPath)) {
		continue;
	}

	let cliSource = readFileSync(entryPath, "utf8");
	if (cliSource.includes('process.title = "pi";')) {
		cliSource = cliSource.replace('process.title = "pi";', 'process.title = "feynman";');
	}
	const stdinErrorGuard = [
		"const feynmanHandleStdinError = (error) => {",
		'    if (error && typeof error === "object") {',
		'        const code = "code" in error ? error.code : undefined;',
		'        const syscall = "syscall" in error ? error.syscall : undefined;',
		'        if ((code === "EIO" || code === "EBADF") && syscall === "read") {',
		"            return;",
		"        }",
		"    }",
		"};",
		'process.stdin?.on?.("error", feynmanHandleStdinError);',
	].join("\n");
	if (!cliSource.includes('process.stdin?.on?.("error", feynmanHandleStdinError);')) {
		cliSource = cliSource.replace(
			'process.emitWarning = (() => { });',
			`process.emitWarning = (() => { });\n${stdinErrorGuard}`,
		);
	}
	writeFileSync(entryPath, cliSource, "utf8");
}

if (terminalPath && existsSync(terminalPath)) {
	let terminalSource = readFileSync(terminalPath, "utf8");
	if (!terminalSource.includes("stdinErrorHandler;")) {
		terminalSource = terminalSource.replace(
			"    stdinBuffer;\n    stdinDataHandler;\n",
			[
				"    stdinBuffer;",
				"    stdinDataHandler;",
				"    stdinErrorHandler = (error) => {",
				'        if ((error?.code === "EIO" || error?.code === "EBADF") && error?.syscall === "read") {',
				"            return;",
				"        }",
				"    };",
			].join("\n") + "\n",
		);
	}
	if (!terminalSource.includes('process.stdin.on("error", this.stdinErrorHandler);')) {
		terminalSource = terminalSource.replace(
			'        process.stdin.resume();\n',
			'        process.stdin.resume();\n        process.stdin.on("error", this.stdinErrorHandler);\n',
		);
	}
	if (!terminalSource.includes('            process.stdin.removeListener("error", this.stdinErrorHandler);')) {
		terminalSource = terminalSource.replace(
			'            process.stdin.removeListener("data", onData);\n            this.inputHandler = previousHandler;\n',
			[
				'            process.stdin.removeListener("data", onData);',
				'            process.stdin.removeListener("error", this.stdinErrorHandler);',
				'            this.inputHandler = previousHandler;',
			].join("\n"),
		);
		terminalSource = terminalSource.replace(
			'        process.stdin.pause();\n',
			'        process.stdin.removeListener("error", this.stdinErrorHandler);\n        process.stdin.pause();\n',
		);
	}
	writeFileSync(terminalPath, terminalSource, "utf8");
}

if (interactiveModePath && existsSync(interactiveModePath)) {
	const interactiveModeSource = readFileSync(interactiveModePath, "utf8");
	if (interactiveModeSource.includes("`π - ${sessionName} - ${cwdBasename}`")) {
		writeFileSync(
			interactiveModePath,
			interactiveModeSource
				.replace("`π - ${sessionName} - ${cwdBasename}`", "`feynman - ${sessionName} - ${cwdBasename}`")
				.replace("`π - ${cwdBasename}`", "`feynman - ${cwdBasename}`"),
			"utf8",
		);
	}
}

if (interactiveThemePath && existsSync(interactiveThemePath)) {
	let themeSource = readFileSync(interactiveThemePath, "utf8");
	const desiredGetEditorTheme = [
		"export function getEditorTheme() {",
		"    return {",
		'        borderColor: (text) => " ".repeat(text.length),',
		'        bgColor: (text) => theme.bg("userMessageBg", text),',
		'        placeholderText: "Type your message or /help for commands",',
		'        placeholder: (text) => theme.fg("dim", text),',
		"        selectList: getSelectListTheme(),",
		"    };",
		"}",
	].join("\n");
	themeSource = themeSource.replace(
		/export function getEditorTheme\(\) \{[\s\S]*?\n\}\nexport function getSettingsListTheme\(\) \{/m,
		`${desiredGetEditorTheme}\nexport function getSettingsListTheme() {`,
	);
	writeFileSync(interactiveThemePath, themeSource, "utf8");
}

if (editorPath && existsSync(editorPath)) {
	let editorSource = readFileSync(editorPath, "utf8");
	const importOriginal =
		'import { getSegmenter, isPunctuationChar, isWhitespaceChar, truncateToWidth, visibleWidth } from "../utils.js";';
	const importReplacement =
		'import { applyBackgroundToLine, getSegmenter, isPunctuationChar, isWhitespaceChar, truncateToWidth, visibleWidth } from "../utils.js";';
	if (editorSource.includes(importOriginal)) {
		editorSource = editorSource.replace(importOriginal, importReplacement);
	}
	const desiredRender = [
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
		"        // Emit hardware cursor marker only when focused and not showing autocomplete",
		"        const emitCursorMarker = this.focused && !this.autocompleteState;",
		"        const showPlaceholder = this.state.lines.length === 1 &&",
		'            this.state.lines[0] === "" &&',
		'            typeof this.theme.placeholderText === "string" &&',
		"            this.theme.placeholderText.length > 0;",
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
		"                displayText = before + marker + after;",
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
	editorSource = editorSource.replace(
		/    render\(width\) \{[\s\S]*?\n    handleInput\(data\) \{/m,
		`${desiredRender}\n    handleInput(data) {`,
	);
	writeFileSync(editorPath, editorSource, "utf8");
}

if (existsSync(webAccessPath)) {
	const source = readFileSync(webAccessPath, "utf8");
	if (source.includes('pi.registerCommand("search",')) {
		writeFileSync(
			webAccessPath,
			source.replace('pi.registerCommand("search",', 'pi.registerCommand("web-results",'),
			"utf8",
		);
	}
}

if (existsSync(sessionSearchIndexerPath)) {
	const source = readFileSync(sessionSearchIndexerPath, "utf8");
	const original = 'const sessionsDir = path.join(os.homedir(), ".pi", "agent", "sessions");';
	const replacement =
		'const sessionsDir = process.env.FEYNMAN_SESSION_DIR ?? process.env.PI_SESSION_DIR ?? path.join(os.homedir(), ".pi", "agent", "sessions");';
	if (source.includes(original)) {
		writeFileSync(sessionSearchIndexerPath, source.replace(original, replacement), "utf8");
	}
}

const oauthPagePath = piAiRoot ? resolve(piAiRoot, "dist", "utils", "oauth", "oauth-page.js") : null;

if (oauthPagePath && existsSync(oauthPagePath)) {
	let source = readFileSync(oauthPagePath, "utf8");
	let changed = false;
	const target = `const LOGO_SVG = \`${FEYNMAN_LOGO_HTML}\`;`;
	if (!source.includes(target)) {
		source = source.replace(/const LOGO_SVG = `[^`]*`;/, target);
		changed = true;
	}
	if (changed) writeFileSync(oauthPagePath, source, "utf8");
}

const alphaHubAuthPath = findPackageRoot("@companion-ai/alpha-hub")
	? resolve(findPackageRoot("@companion-ai/alpha-hub"), "src", "lib", "auth.js")
	: null;

if (alphaHubAuthPath && existsSync(alphaHubAuthPath)) {
	let source = readFileSync(alphaHubAuthPath, "utf8");
	const oldSuccess = "'<html><body><h2>Logged in to Alpha Hub</h2><p>You can close this tab.</p></body></html>'";
	const oldError = "'<html><body><h2>Login failed</h2><p>You can close this tab.</p></body></html>'";
	const bodyAttr = `style="font-family:system-ui,sans-serif;text-align:center;padding-top:20vh;background:#050a08;color:#f0f5f2"`;
	const logo = `<h1 style="font-family:monospace;font-size:48px;color:#34d399;margin:0">feynman</h1>`;
	const newSuccess = `'<html><body ${bodyAttr}>${logo}<h2 style="color:#34d399;margin-top:16px">Logged in</h2><p style="color:#8aaa9a">You can close this tab.</p></body></html>'`;
	const newError = `'<html><body ${bodyAttr}>${logo}<h2 style="color:#ef4444;margin-top:16px">Login failed</h2><p style="color:#8aaa9a">You can close this tab.</p></body></html>'`;
	if (source.includes(oldSuccess)) {
		source = source.replace(oldSuccess, newSuccess);
	}
	if (source.includes(oldError)) {
		source = source.replace(oldError, newError);
	}
	const brokenWinOpen = "else if (plat === 'win32') execSync(`start \"${url}\"`);";
	const fixedWinOpen = "else if (plat === 'win32') execSync(`cmd /c start \"\" \"${url}\"`);";
	if (source.includes(brokenWinOpen)) {
		source = source.replace(brokenWinOpen, fixedWinOpen);
	}
	writeFileSync(alphaHubAuthPath, source, "utf8");
}

if (existsSync(piMemoryPath)) {
	let source = readFileSync(piMemoryPath, "utf8");
	const memoryOriginal = 'const MEMORY_DIR = join(homedir(), ".pi", "memory");';
	const memoryReplacement =
		'const MEMORY_DIR = process.env.FEYNMAN_MEMORY_DIR ?? process.env.PI_MEMORY_DIR ?? join(homedir(), ".pi", "memory");';
	if (source.includes(memoryOriginal)) {
		source = source.replace(memoryOriginal, memoryReplacement);
	}
	const execOriginal = 'const result = await pi.exec("pi", ["-p", prompt, "--print"], {';
	const execReplacement = [
		'const execBinary = process.env.FEYNMAN_NODE_EXECUTABLE || process.env.FEYNMAN_EXECUTABLE || "pi";',
		'      const execArgs = process.env.FEYNMAN_BIN_PATH',
		'        ? [process.env.FEYNMAN_BIN_PATH, "--prompt", prompt]',
		'        : ["-p", prompt, "--print"];',
		'      const result = await pi.exec(execBinary, execArgs, {',
	].join("\n");
	if (source.includes(execOriginal)) {
		source = source.replace(execOriginal, execReplacement);
	}
	writeFileSync(piMemoryPath, source, "utf8");
}
