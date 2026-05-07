const CUSTOM_SETUP_METHOD = `
    async showCustomProviderSetupDialog() {
        const previousModel = this.session.model;
        const dialog = new LoginDialogComponent(this.ui, "__custom__", (_s, _m) => {}, "Custom provider", "Custom API Provider Setup");
        this.editorContainer.clear();
        this.editorContainer.addChild(dialog);
        this.ui.setFocus(dialog);
        this.ui.requestRender();
        const restoreEditor = () => {
            this.editorContainer.clear();
            this.editorContainer.addChild(this.editor);
            this.ui.setFocus(this.editor);
            this.ui.requestRender();
        };
        const echo = (label, value) => {
            dialog.contentContainer.removeChild(dialog.input);
            dialog.contentContainer.addChild(new Text(theme.fg("dim", "  " + label + value), 1, 0));
            dialog.contentContainer.addChild(new Spacer(1));
            dialog.tui.requestRender();
        };
        try {
            const pid = (await dialog.showPrompt("Provider ID (e.g. my-proxy):")).trim();
            if (!pid || pid === "__custom__") throw new Error("Invalid provider ID.");
            echo("Provider: ", pid);
            const apiPrompt = [
                "API mode:",
                "  1) OpenAI Chat Completions (/v1/chat/completions)",
                "  2) OpenAI Responses (/v1/responses)",
                "  3) Anthropic Messages (/v1/messages)",
                "  4) Google Generative AI",
                "Enter number (1-4):"
            ].join("\\n");
            const apiChoice = (await dialog.showPrompt(apiPrompt)).trim();
            const apiMap = {"1":"openai-completions","2":"openai-responses","3":"anthropic-messages","4":"google-generative-ai"};
            const api = apiMap[apiChoice] || "openai-completions";
            const apiLabels = {"openai-completions":"OpenAI Chat","openai-responses":"OpenAI Responses","anthropic-messages":"Anthropic","google-generative-ai":"Google"};
            echo("API: ", apiLabels[api] || api);
            const baseUrlDefault = api === "openai-completions" || api === "openai-responses"
                ? "http://localhost:11434/v1"
                : api === "anthropic-messages" ? "https://api.anthropic.com" : "https://generativelanguage.googleapis.com";
            const baseUrlPrompt = api === "openai-completions" || api === "openai-responses"
                ? "Base URL (include /v1 for OpenAI endpoints):"
                : "Base URL:";
            const baseUrl = (await dialog.showPrompt(baseUrlPrompt, baseUrlDefault)).trim();
            if (!baseUrl) throw new Error("Base URL is required.");
            let cleanedBaseUrl = baseUrl.replace(/\\/+$/, "");
            if (api === "anthropic-messages" && /\\/v1$/i.test(cleanedBaseUrl)) cleanedBaseUrl = cleanedBaseUrl.replace(/\\/v1$/i, "");
            echo("URL: ", cleanedBaseUrl);
            let authHeader = false;
            if (api === "openai-completions" || api === "openai-responses" || api === "anthropic-messages") {
                const isLocal = /^(https?:\\/\\/)?(localhost|127\\.0\\.0\\.1|0\\.0\\.0\\.0)(:|\\/|$)/i.test(cleanedBaseUrl);
                const choice = (await dialog.showPrompt("Send Authorization: Bearer header? (y/n) [" + (isLocal ? "n" : "y") + "]:")).trim().toLowerCase();
                authHeader = choice === "y" || choice === "yes" || (choice === "" && !isLocal);
                echo("Auth header: ", authHeader ? "yes" : "no");
            }
            const apiKey = (await dialog.showPrompt("API key (literal, env var, or !command):")).trim();
            if (!apiKey) throw new Error("API key is required.");
            echo("API key: ", apiKey.startsWith("!") ? "(command)" : apiKey.length > 8 ? apiKey.slice(0,4) + "***" + apiKey.slice(-3) : "***");
            let modelIds = [];
            if (api === "openai-completions" || api === "openai-responses") {
                const fetchChoice = (await dialog.showPrompt("Fetch models from API? (y/n) [y]:")).trim().toLowerCase();
                if (fetchChoice === "" || fetchChoice === "y" || fetchChoice === "yes") {
                    dialog.contentContainer.removeChild(dialog.input);
                    dialog.contentContainer.addChild(new Spacer(1));
                    dialog.contentContainer.addChild(new Text(theme.fg("accent", "Fetching models..."), 1, 0));
                    dialog.tui.requestRender();
                    try {
                        const modelsUrl = cleanedBaseUrl + (cleanedBaseUrl.endsWith("/v1") ? "/models" : "/v1/models");
                        const headers = {};
                        if (authHeader) headers["Authorization"] = "Bearer " + apiKey;
                        const controller = new AbortController();
                        const timeoutId = setTimeout(() => controller.abort(), 10000);
                        const response = await fetch(modelsUrl, { headers, signal: controller.signal });
                        clearTimeout(timeoutId);
                        if (response.ok) {
                            const data = await response.json();
                            const fetchedModels = (data.data || []).map(m => m.id).filter(id => {
                                const lower = id.toLowerCase();
                                return !lower.includes("embed") && !lower.includes("tts") && !lower.includes("whisper") && !lower.includes("dall-e");
                            });
                            if (fetchedModels.length > 0) {
                                modelIds = fetchedModels;
                                dialog.contentContainer.addChild(new Text(theme.fg("success", "  Found " + modelIds.length + " model(s)"), 1, 0));
                                dialog.contentContainer.addChild(new Spacer(1));
                                dialog.tui.requestRender();
                            } else {
                                dialog.contentContainer.addChild(new Text(theme.fg("warning", "  No chat models found"), 1, 0));
                                dialog.contentContainer.addChild(new Spacer(1));
                                dialog.tui.requestRender();
                            }
                        } else {
                            dialog.contentContainer.addChild(new Text(theme.fg("warning", "  HTTP " + response.status), 1, 0));
                            dialog.contentContainer.addChild(new Spacer(1));
                            dialog.tui.requestRender();
                        }
                    } catch (err) {
                        const errMsg = err.name === "AbortError" ? "Timeout" : (err.message || "Failed");
                        dialog.contentContainer.addChild(new Text(theme.fg("warning", "  " + errMsg), 1, 0));
                        dialog.contentContainer.addChild(new Spacer(1));
                        dialog.tui.requestRender();
                    }
                }
            }
            if (modelIds.length === 0) {
                const modelIdsRaw = (await dialog.showPrompt("Model ID(s) (comma-separated):")).trim();
                modelIds = modelIdsRaw.split(",").map(s => s.trim()).filter(Boolean);
                if (modelIds.length === 0) throw new Error("At least one model ID is required.");
            }
            echo("Models: ", modelIds.join(", "));
            dialog.contentContainer.removeChild(dialog.input);
            dialog.contentContainer.addChild(new Spacer(1));
            dialog.contentContainer.addChild(new Text(theme.fg("accent", "Saving configuration..."), 1, 0));
            dialog.tui.requestRender();
            const modelsJsonPath = this.session.modelRegistry.modelsJsonPath || path.join(getAgentDir(), "models.json");
            let modelsJson = { providers: {} };
            try {
                if (fs.existsSync(modelsJsonPath)) {
                    const raw = fs.readFileSync(modelsJsonPath, "utf8");
                    if (raw.trim()) modelsJson = JSON.parse(raw);
                }
            } catch (_) {}
            if (!modelsJson.providers) modelsJson.providers = {};
            modelsJson.providers[pid] = {
                baseUrl: cleanedBaseUrl,
                apiKey: apiKey,
                api: api,
                authHeader: authHeader,
                models: modelIds.map(id => ({ id }))
            };
            const dir = path.dirname(modelsJsonPath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(modelsJsonPath, JSON.stringify(modelsJson, null, 2) + "\\n", "utf8");
            try { fs.chmodSync(modelsJsonPath, 0o600); } catch (_) {}
            this.session.modelRegistry.authStorage.set(pid, { type: "api_key", key: apiKey });
            this.session.modelRegistry.refresh();
            await this.updateAvailableProviderCount();
            this.footer.invalidate();
            restoreEditor();
            this.showStatus("Custom provider '" + pid + "' configured. Use /model to select a model.");
            const providerModels = this.session.modelRegistry.getAll().filter(m => m.provider === pid);
            if (providerModels.length > 0) {
                try {
                    await this.session.setModel(providerModels[0]);
                    this.showStatus("Custom provider '" + pid + "' configured. Selected " + providerModels[0].id + ".");
                } catch (_) {}
            }
        } catch (error) {
            restoreEditor();
            const errorMsg = error instanceof Error ? error.message : String(error);
            if (errorMsg !== "Login cancelled") this.showError("Custom provider setup failed: " + errorMsg);
        }
    }
`;

export function patchPiInteractiveModeSource(source) {
	if (source.includes("showCustomProviderSetupDialog")) {
		return source;
	}

	// 1) Append custom provider option in getLoginProviderOptions return value
	const loginOptsMatch = `        const filteredOptions = authType ? options.filter((option) => option.authType === authType) : options;
        return filteredOptions.sort((a, b) => a.name.localeCompare(b.name));`;

	if (!source.includes(loginOptsMatch)) {
		return source;
	}

	let patched = source.replace(
		loginOptsMatch,
		`        const filteredOptions = authType ? options.filter((option) => option.authType === authType) : options;
        if (authType !== "oauth") { filteredOptions.push({ id: "__custom__", name: "Custom provider", authType: "api_key" }); }
        return filteredOptions.sort((a, b) => a.name.localeCompare(b.name));`,
	);

	// 2) Intercept __custom__ in showLoginProviderSelector callback
	const selectorMatch = `                if (providerOption.authType === "oauth") {
                    await this.showLoginDialog(providerOption.id, providerOption.name);
                }
                else if (providerOption.id === BEDROCK_PROVIDER_ID) {
                    this.showBedrockSetupDialog(providerOption.id, providerOption.name);
                }
                else {
                    await this.showApiKeyLoginDialog(providerOption.id, providerOption.name);
                }`;

	if (patched.includes(selectorMatch)) {
		patched = patched.replace(
			selectorMatch,
			`                if (providerOption.authType === "oauth") {
                    await this.showLoginDialog(providerOption.id, providerOption.name);
                }
                else if (providerOption.id === BEDROCK_PROVIDER_ID) {
                    this.showBedrockSetupDialog(providerOption.id, providerOption.name);
                }
                else if (providerOption.id === "__custom__") {
                    await this.showCustomProviderSetupDialog();
                }
                else {
                    await this.showApiKeyLoginDialog(providerOption.id, providerOption.name);
                }`,
		);
	}

	// 3) Inject showCustomProviderSetupDialog method before showLoginDialog
	const injectPoint = `    async showLoginDialog(providerId, providerName) {`;

	if (patched.includes(injectPoint)) {
		patched = patched.replace(
			injectPoint,
			`${CUSTOM_SETUP_METHOD}
    async showLoginDialog(providerId, providerName) {`,
		);
	}

	return patched;
}
