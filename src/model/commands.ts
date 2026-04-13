import { AuthStorage } from "@mariozechner/pi-coding-agent";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { exec as execCallback } from "node:child_process";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { fromEnv } from "@aws-sdk/credential-provider-env";
import { fromIni } from "@aws-sdk/credential-provider-ini";

import { readJson } from "../pi/settings.js";
import { promptChoice, promptText } from "../setup/prompts.js";
import { openUrl } from "../system/open-url.js";
import { printInfo, printSection, printSuccess, printWarning } from "../ui/terminal.js";
import {
	buildModelStatusSnapshotFromRecords,
	chooseRecommendedModel,
	getAvailableModelRecords,
	getSupportedModelRecords,
	type ModelStatusSnapshot,
} from "./catalog.js";
import { createModelRegistry, getModelsJsonPath } from "./registry.js";
import { upsertProviderBaseUrl, upsertProviderConfig } from "./models-json.js";

const exec = promisify(execCallback);

function collectModelStatus(settingsPath: string, authPath: string): ModelStatusSnapshot {
	return buildModelStatusSnapshotFromRecords(
		getSupportedModelRecords(authPath),
		getAvailableModelRecords(authPath),
		getCurrentModelSpec(settingsPath),
	);
}

type OAuthProviderInfo = {
	id: string;
	name?: string;
	usesCallbackServer?: boolean;
};

function getOAuthProviders(authPath: string): OAuthProviderInfo[] {
	return AuthStorage.create(authPath).getOAuthProviders() as OAuthProviderInfo[];
}

function resolveOAuthProvider(authPath: string, input: string): OAuthProviderInfo | undefined {
	const normalizedInput = input.trim().toLowerCase();
	if (!normalizedInput) {
		return undefined;
	}
	return getOAuthProviders(authPath).find((provider) => provider.id.toLowerCase() === normalizedInput);
}

async function selectOAuthProvider(authPath: string, action: "login" | "logout"): Promise<OAuthProviderInfo | undefined> {
	const providers = getOAuthProviders(authPath);
	if (providers.length === 0) {
		printWarning("No Pi OAuth model providers are available.");
		return undefined;
	}
	if (providers.length === 1) {
		return providers[0];
	}

	const choices = providers.map((provider) => `${provider.id} — ${provider.name ?? provider.id}`);
	choices.push("Cancel");
	const selection = await promptChoice(`Choose an OAuth provider to ${action}:`, choices, 0);
	if (selection >= providers.length) {
		return undefined;
	}
	return providers[selection];
}

type ApiKeyProviderInfo = {
	id: string;
	label: string;
	envVar?: string;
};

const API_KEY_PROVIDERS: ApiKeyProviderInfo[] = [
	{ id: "__custom__", label: "Custom provider (baseUrl + API key)" },
	{ id: "openai", label: "OpenAI Platform API", envVar: "OPENAI_API_KEY" },
	{ id: "anthropic", label: "Anthropic API", envVar: "ANTHROPIC_API_KEY" },
	{ id: "google", label: "Google Gemini API", envVar: "GEMINI_API_KEY" },
	{ id: "amazon-bedrock", label: "Amazon Bedrock (AWS credential chain)" },
	{ id: "openrouter", label: "OpenRouter", envVar: "OPENROUTER_API_KEY" },
	{ id: "zai", label: "Z.AI / GLM", envVar: "ZAI_API_KEY" },
	{ id: "kimi-coding", label: "Kimi / Moonshot", envVar: "KIMI_API_KEY" },
	{ id: "minimax", label: "MiniMax", envVar: "MINIMAX_API_KEY" },
	{ id: "minimax-cn", label: "MiniMax (China)", envVar: "MINIMAX_CN_API_KEY" },
	{ id: "mistral", label: "Mistral", envVar: "MISTRAL_API_KEY" },
	{ id: "groq", label: "Groq", envVar: "GROQ_API_KEY" },
	{ id: "xai", label: "xAI", envVar: "XAI_API_KEY" },
	{ id: "cerebras", label: "Cerebras", envVar: "CEREBRAS_API_KEY" },
	{ id: "vercel-ai-gateway", label: "Vercel AI Gateway", envVar: "AI_GATEWAY_API_KEY" },
	{ id: "huggingface", label: "Hugging Face", envVar: "HF_TOKEN" },
	{ id: "opencode", label: "OpenCode Zen", envVar: "OPENCODE_API_KEY" },
	{ id: "opencode-go", label: "OpenCode Go", envVar: "OPENCODE_API_KEY" },
	{ id: "azure-openai-responses", label: "Azure OpenAI (Responses)", envVar: "AZURE_OPENAI_API_KEY" },
];

function resolveApiKeyProvider(input: string): ApiKeyProviderInfo | undefined {
	const normalizedInput = normalizeProviderId(input);
	if (!normalizedInput) {
		return undefined;
	}
	return API_KEY_PROVIDERS.find((provider) => provider.id === normalizedInput);
}

export function resolveModelProviderForCommand(
	authPath: string,
	input: string,
): { kind: "oauth" | "api-key"; id: string } | undefined {
	const oauthProvider = resolveOAuthProvider(authPath, input);
	if (oauthProvider) {
		return { kind: "oauth", id: oauthProvider.id };
	}

	const apiKeyProvider = resolveApiKeyProvider(input);
	if (apiKeyProvider) {
		return { kind: "api-key", id: apiKeyProvider.id };
	}

	return undefined;
}

async function selectApiKeyProvider(): Promise<ApiKeyProviderInfo | undefined> {
	const choices = API_KEY_PROVIDERS.map(
		(provider) => `${provider.id} — ${provider.label}${provider.envVar ? ` (${provider.envVar})` : ""}`,
	);
	choices.push("Cancel");
	const selection = await promptChoice("Choose an API-key provider:", choices, 0);
	if (selection >= API_KEY_PROVIDERS.length) {
		return undefined;
	}
	return API_KEY_PROVIDERS[selection];
}

type CustomProviderSetup = {
	providerId: string;
	modelIds: string[];
	baseUrl: string;
	api: "openai-completions" | "openai-responses" | "anthropic-messages" | "google-generative-ai";
	apiKeyConfig: string;
	/**
	 * If true, add `Authorization: Bearer <apiKey>` to requests in addition to
	 * whatever the API mode uses (useful for proxies that implement /v1/messages
	 * but expect Bearer auth instead of x-api-key).
	 */
	authHeader: boolean;
};

function normalizeProviderId(value: string): string {
	return value.trim().toLowerCase().replace(/\s+/g, "-");
}

function normalizeModelIds(value: string): string[] {
	const items = value
		.split(",")
		.map((entry) => entry.trim())
		.filter(Boolean);
	return Array.from(new Set(items));
}

function normalizeBaseUrl(value: string): string {
	return value.trim().replace(/\/+$/, "");
}

function normalizeCustomProviderBaseUrl(
	api: CustomProviderSetup["api"],
	baseUrl: string,
): { baseUrl: string; note?: string } {
	const normalized = normalizeBaseUrl(baseUrl);
	if (!normalized) {
		return { baseUrl: normalized };
	}

	// Pi expects Anthropic baseUrl without `/v1` (it appends `/v1/messages` internally).
	if (api === "anthropic-messages" && /\/v1$/i.test(normalized)) {
		return { baseUrl: normalized.replace(/\/v1$/i, ""), note: "Stripped trailing /v1 for Anthropic mode." };
	}

	return { baseUrl: normalized };
}

function isLocalBaseUrl(baseUrl: string): boolean {
	return /^(https?:\/\/)?(localhost|127\.0\.0\.1|0\.0\.0\.0)(:|\/|$)/i.test(baseUrl);
}

async function resolveApiKeyConfig(apiKeyConfig: string): Promise<string | undefined> {
	const trimmed = apiKeyConfig.trim();
	if (!trimmed) return undefined;

	if (trimmed.startsWith("!")) {
		const command = trimmed.slice(1).trim();
		if (!command) return undefined;
		const shell = process.platform === "win32" ? process.env.ComSpec || "cmd.exe" : process.env.SHELL || "/bin/sh";
		try {
			const { stdout } = await exec(command, { shell, maxBuffer: 1024 * 1024 });
			const value = stdout.trim();
			return value || undefined;
		} catch {
			return undefined;
		}
	}

	const envValue = process.env[trimmed];
	if (typeof envValue === "string" && envValue.trim()) {
		return envValue.trim();
	}

	// Fall back to literal value.
	return trimmed;
}

async function bestEffortFetchOpenAiModelIds(
	baseUrl: string,
	apiKey: string,
	authHeader: boolean,
): Promise<string[] | undefined> {
	const url = `${baseUrl}/models`;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 5000);
	try {
		const response = await fetch(url, {
			method: "GET",
			headers: authHeader ? { Authorization: `Bearer ${apiKey}` } : undefined,
			signal: controller.signal,
		});
		if (!response.ok) {
			return undefined;
		}
		const json = (await response.json()) as any;
		if (!Array.isArray(json?.data)) return undefined;
		return json.data
			.map((entry: any) => (typeof entry?.id === "string" ? entry.id : undefined))
			.filter(Boolean);
	} catch {
		return undefined;
	} finally {
		clearTimeout(timer);
	}
}

async function promptCustomProviderSetup(): Promise<CustomProviderSetup | undefined> {
	printSection("Custom Provider");
	const providerIdInput = await promptText("Provider id (e.g. my-proxy)", "custom");
	const providerId = normalizeProviderId(providerIdInput);
	if (!providerId || providerId === "__custom__") {
		printWarning("Invalid provider id.");
		return undefined;
	}

	const apiChoices = [
		"openai-completions — OpenAI Chat Completions compatible (e.g. /v1/chat/completions)",
		"openai-responses — OpenAI Responses compatible (e.g. /v1/responses)",
		"anthropic-messages — Anthropic Messages compatible (e.g. /v1/messages)",
		"google-generative-ai — Google Generative AI compatible (generativelanguage.googleapis.com)",
		"Cancel",
	];
	const apiSelection = await promptChoice("API mode:", apiChoices, 0);
	if (apiSelection >= 4) {
		return undefined;
	}
	const api = ["openai-completions", "openai-responses", "anthropic-messages", "google-generative-ai"][apiSelection] as CustomProviderSetup["api"];

	const baseUrlDefault = ((): string => {
		if (api === "openai-completions" || api === "openai-responses") return "http://localhost:11434/v1";
		if (api === "anthropic-messages") return "https://api.anthropic.com";
		if (api === "google-generative-ai") return "https://generativelanguage.googleapis.com";
		return "http://localhost:11434/v1";
	})();
	const baseUrlPrompt =
		api === "openai-completions" || api === "openai-responses"
			? "Base URL (include /v1 for OpenAI-compatible endpoints)"
			: api === "anthropic-messages"
				? "Base URL (no trailing /, no /v1)"
				: "Base URL (no trailing /)";
	const baseUrlRaw = await promptText(baseUrlPrompt, baseUrlDefault);
	const { baseUrl, note: baseUrlNote } = normalizeCustomProviderBaseUrl(api, baseUrlRaw);
	if (!baseUrl) {
		printWarning("Base URL is required.");
		return undefined;
	}
	if (baseUrlNote) {
		printInfo(baseUrlNote);
	}

	let authHeader = false;
	if (api === "openai-completions" || api === "openai-responses") {
		const defaultAuthHeader = !isLocalBaseUrl(baseUrl);
		const authHeaderChoices = [
			"Yes (send Authorization: Bearer <apiKey>)",
			"No (common for local Ollama/vLLM/LM Studio)",
			"Cancel",
		];
		const authHeaderSelection = await promptChoice(
			"Send Authorization header?",
			authHeaderChoices,
			defaultAuthHeader ? 0 : 1,
		);
		if (authHeaderSelection >= 2) {
			return undefined;
		}
		authHeader = authHeaderSelection === 0;
	}
	if (api === "anthropic-messages") {
		const defaultAuthHeader = isLocalBaseUrl(baseUrl);
		const authHeaderChoices = [
			"Yes (also send Authorization: Bearer <apiKey>)",
			"No (standard Anthropic uses x-api-key only)",
			"Cancel",
		];
		const authHeaderSelection = await promptChoice(
			"Also send Authorization header?",
			authHeaderChoices,
			defaultAuthHeader ? 0 : 1,
		);
		if (authHeaderSelection >= 2) {
			return undefined;
		}
		authHeader = authHeaderSelection === 0;
	}

	printInfo("API key value supports:");
	printInfo("  - literal secret (stored in models.json)");
	printInfo("  - env var name (resolved at runtime)");
	printInfo("  - !command (executes and uses stdout)");
	const apiKeyConfigRaw = (await promptText("API key / resolver", "")).trim();
	const apiKeyConfig = apiKeyConfigRaw || "local";
	if (!apiKeyConfigRaw) {
		printInfo("Using placeholder apiKey value (required by Pi for custom providers).");
	}

	let modelIdsDefault = "my-model";
	if (api === "openai-completions" || api === "openai-responses") {
		// Best-effort: hit /models so users can pick correct ids (especially for proxies).
		const resolvedKey = await resolveApiKeyConfig(apiKeyConfig);
		const modelIds = resolvedKey ? await bestEffortFetchOpenAiModelIds(baseUrl, resolvedKey, authHeader) : undefined;
		if (modelIds && modelIds.length > 0) {
			const sample = modelIds.slice(0, 10).join(", ");
			printInfo(`Detected models: ${sample}${modelIds.length > 10 ? ", ..." : ""}`);
			modelIdsDefault = modelIds.includes("sonnet") ? "sonnet" : modelIds[0]!;
		}
	}

	const modelIdsRaw = await promptText("Model id(s) (comma-separated)", modelIdsDefault);
	const modelIds = normalizeModelIds(modelIdsRaw);
	if (modelIds.length === 0) {
		printWarning("At least one model id is required.");
		return undefined;
	}

	return { providerId, modelIds, baseUrl, api, apiKeyConfig, authHeader };
}

async function verifyCustomProvider(setup: CustomProviderSetup, authPath: string): Promise<void> {
	const registry = createModelRegistry(authPath);
	const modelsError = registry.getError();
	if (modelsError) {
		printWarning("Verification: models.json failed to load.");
		for (const line of modelsError.split("\n")) {
			printInfo(`  ${line}`);
		}
		return;
	}

	const all = registry.getAll();
	const hasModel = setup.modelIds.some((id) => all.some((model) => model.provider === setup.providerId && model.id === id));
	if (!hasModel) {
		printWarning("Verification: model registry does not contain the configured provider/model ids.");
		return;
	}

	const available = registry.getAvailable();
	const hasAvailable = setup.modelIds.some((id) =>
		available.some((model) => model.provider === setup.providerId && model.id === id),
	);
	if (!hasAvailable) {
		printWarning("Verification: provider is not considered authenticated/available.");
		return;
	}

	const apiKey = await registry.getApiKeyForProvider(setup.providerId);
	if (!apiKey) {
		printWarning("Verification: API key could not be resolved (check env var name / !command).");
		return;
	}

	const timeoutMs = 8000;

	// Best-effort network check for OpenAI-compatible endpoints
	if (setup.api === "openai-completions" || setup.api === "openai-responses") {
		const url = `${setup.baseUrl}/models`;
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		try {
			const response = await fetch(url, {
				method: "GET",
				headers: setup.authHeader ? { Authorization: `Bearer ${apiKey}` } : undefined,
				signal: controller.signal,
			});
			if (!response.ok) {
				printWarning(`Verification: ${url} returned ${response.status} ${response.statusText}`);
				return;
			}
			const json = (await response.json()) as unknown;
			const modelIds = Array.isArray((json as any)?.data)
				? (json as any).data.map((entry: any) => (typeof entry?.id === "string" ? entry.id : undefined)).filter(Boolean)
				: [];
			const missing = setup.modelIds.filter((id) => modelIds.length > 0 && !modelIds.includes(id));
			if (modelIds.length > 0 && missing.length > 0) {
				printWarning(`Verification: /models does not list configured model id(s): ${missing.join(", ")}`);
				return;
			}
			printSuccess("Verification: endpoint reachable and authorized.");
		} catch (error) {
			printWarning(`Verification: failed to reach ${url}: ${error instanceof Error ? error.message : String(error)}`);
		} finally {
			clearTimeout(timer);
		}
		return;
	}

	if (setup.api === "anthropic-messages") {
		const url = `${setup.baseUrl}/v1/models?limit=1`;
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		try {
			const headers: Record<string, string> = {
				"x-api-key": apiKey,
				"anthropic-version": "2023-06-01",
			};
			if (setup.authHeader) {
				headers.Authorization = `Bearer ${apiKey}`;
			}
			const response = await fetch(url, {
				method: "GET",
				headers,
				signal: controller.signal,
			});
			if (!response.ok) {
				printWarning(`Verification: ${url} returned ${response.status} ${response.statusText}`);
				if (response.status === 404) {
					printInfo("  Tip: For Anthropic mode, use a base URL without /v1 (e.g. https://api.anthropic.com).");
				}
				if ((response.status === 401 || response.status === 403) && !setup.authHeader) {
					printInfo("  Tip: Some proxies require `Authorization: Bearer <apiKey>` even in Anthropic mode.");
				}
				return;
			}
			printSuccess("Verification: endpoint reachable and authorized.");
		} catch (error) {
			printWarning(`Verification: failed to reach ${url}: ${error instanceof Error ? error.message : String(error)}`);
		} finally {
			clearTimeout(timer);
		}
		return;
	}

	if (setup.api === "google-generative-ai") {
		const url = `${setup.baseUrl}/v1beta/models?key=${encodeURIComponent(apiKey)}`;
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		try {
			const response = await fetch(url, { method: "GET", signal: controller.signal });
			if (!response.ok) {
				printWarning(`Verification: ${url} returned ${response.status} ${response.statusText}`);
				return;
			}
			printSuccess("Verification: endpoint reachable and authorized.");
		} catch (error) {
			printWarning(`Verification: failed to reach ${url}: ${error instanceof Error ? error.message : String(error)}`);
		} finally {
			clearTimeout(timer);
		}
		return;
	}

	printInfo("Verification: skipped network probe for this API mode.");
}

/**
 * Parse profile names from ~/.aws/config.
 * Returns names for [default] and [profile <name>] sections.
 */
function parseAwsProfiles(): string[] {
	const configPath = resolve(homedir(), ".aws", "config");
	if (!existsSync(configPath)) {
		return [];
	}
	try {
		const content = readFileSync(configPath, "utf8");
		const profiles: string[] = [];
		for (const line of content.split("\n")) {
			const trimmed = line.trim();
			// [default] section
			if (trimmed === "[default]") {
				profiles.push("default");
				continue;
			}
			// [profile <name>] sections
			const match = /^\[profile\s+(.+?)\]$/.exec(trimmed);
			if (match?.[1]) {
				profiles.push(match[1].trim());
			}
		}
		return profiles;
	} catch {
		return [];
	}
}

/**
 * Resolve the AWS region for a given profile.
 * Checks the profile's section in ~/.aws/config, then env vars.
 */
function resolveBedrockRegion(profile: string | undefined): string | undefined {
	// Check env vars first (they take precedence over config file for resolution)
	if (process.env.AWS_REGION) return process.env.AWS_REGION;
	if (process.env.AWS_DEFAULT_REGION) return process.env.AWS_DEFAULT_REGION;

	// Try to read from ~/.aws/config
	if (profile) {
		const configPath = resolve(homedir(), ".aws", "config");
		if (existsSync(configPath)) {
			try {
				const content = readFileSync(configPath, "utf8");
				const sectionHeader = profile === "default" ? "[default]" : `[profile ${profile}]`;
				let inSection = false;
				for (const line of content.split("\n")) {
					const trimmed = line.trim();
					if (trimmed === sectionHeader) {
						inSection = true;
						continue;
					}
					if (inSection) {
						if (trimmed.startsWith("[")) break; // next section
						const regionMatch = /^region\s*=\s*(.+)$/.exec(trimmed);
						if (regionMatch?.[1]) {
							return regionMatch[1].trim();
						}
					}
				}
			} catch {
				// ignore
			}
		}
	}

	return undefined;
}

/**
 * Persist bedrock profile + region into settings.json under the `bedrock` key.
 */
function saveBedrockConfig(settingsPath: string, profile: string | undefined, region: string): void {
	const settings = readJson(settingsPath);
	const bedrock: Record<string, string> = { region };
	if (profile) {
		bedrock.profile = profile;
	}
	settings.bedrock = bedrock;
	writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n", "utf8");
}

async function verifyBedrockCredentialChain(profile: string | undefined): Promise<void> {
	const credentials = profile !== undefined
		? await fromIni({ profile })()
		: await fromEnv()();
	if (!credentials?.accessKeyId || !credentials?.secretAccessKey) {
		throw new Error("AWS credential chain resolved without usable Bedrock credentials.");
	}
}

async function configureBedrockProvider(authPath: string, settingsPath: string): Promise<boolean> {
	printSection("AWS Credentials: Amazon Bedrock");

	const profiles = parseAwsProfiles();
	let chosenProfile: string | undefined;

	if (profiles.length > 0) {
		const choices = [...profiles, "Use environment variables instead", "Cancel"];
		const selection = await promptChoice("Select an AWS profile:", choices, 0);
		if (selection >= profiles.length + 1) {
			// Cancel
			printInfo("Bedrock setup cancelled.");
			return false;
		}
		if (selection < profiles.length) {
			chosenProfile = profiles[selection];
		}
		// selection === profiles.length → env-var path, chosenProfile stays undefined
	}
	// If no profiles found, go directly to env-var path (chosenProfile stays undefined)

	try {
		await verifyBedrockCredentialChain(chosenProfile);
	} catch (error) {
		printWarning(`AWS credential verification failed: ${error instanceof Error ? error.message : String(error)}`);
		if (chosenProfile) {
			printInfo(`Ensure profile "${chosenProfile}" has valid credentials in ~/.aws/credentials or ~/.aws/config.`);
		} else {
			printInfo("Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in your environment.");
		}
		return false;
	}

	// Resolve region; prompt only if not already known
	let region = resolveBedrockRegion(chosenProfile);
	if (!region) {
		region = await promptText("AWS region (e.g. us-east-1)", "us-east-1");
	}

	saveBedrockConfig(settingsPath, chosenProfile, region);
	AuthStorage.create(authPath).set("amazon-bedrock", { type: "api_key", key: "<authenticated>" });
	printSuccess("Verified AWS credentials and marked Amazon Bedrock as configured.");
	printInfo("Use `feynman model list` to see available Bedrock models.");
	return true;
}

function maybeSetRecommendedDefaultModel(settingsPath: string | undefined, authPath: string): void {
	if (!settingsPath) {
		return;
	}

	const currentSpec = getCurrentModelSpec(settingsPath);
	const available = getAvailableModelRecords(authPath);
	const currentValid = currentSpec ? available.some((m) => `${m.provider}/${m.id}` === currentSpec) : false;

	if ((!currentSpec || !currentValid) && available.length > 0) {
		const recommended = chooseRecommendedModel(authPath);
		if (recommended) {
			setDefaultModelSpec(settingsPath, authPath, recommended.spec);
		}
	}
}

async function configureApiKeyProvider(authPath: string, providerId?: string, settingsPath?: string): Promise<boolean> {
	const provider = providerId ? resolveApiKeyProvider(providerId) : await selectApiKeyProvider();
	if (!provider) {
		if (providerId) {
			throw new Error(`Unknown API-key model provider: ${providerId}`);
		}
		printInfo("API key setup cancelled.");
		return false;
	}

	if (provider.id === "amazon-bedrock") {
		if (!settingsPath) {
			throw new Error("settingsPath is required for Amazon Bedrock configuration.");
		}
		return configureBedrockProvider(authPath, settingsPath);
	}

	if (provider.id === "__custom__") {
		const setup = await promptCustomProviderSetup();
		if (!setup) {
			printInfo("Custom provider setup cancelled.");
			return false;
		}

		const modelsJsonPath = getModelsJsonPath(authPath);
		const result = upsertProviderConfig(modelsJsonPath, setup.providerId, {
			baseUrl: setup.baseUrl,
			apiKey: setup.apiKeyConfig,
			api: setup.api,
			authHeader: setup.authHeader,
			models: setup.modelIds.map((id) => ({ id })),
		});
		if (!result.ok) {
			printWarning(result.error);
			return false;
		}

		printSuccess(`Saved custom provider: ${setup.providerId}`);
		await verifyCustomProvider(setup, authPath);
		return true;
	}

	printSection(`API Key: ${provider.label}`);
	if (provider.envVar) {
		printInfo(`Tip: to avoid writing secrets to disk, set ${provider.envVar} in your shell or .env.`);
	}

	const apiKey = await promptText("Paste API key (leave empty to use env var instead)", "");
	if (!apiKey) {
		if (provider.envVar) {
			printInfo(`Set ${provider.envVar} and rerun setup (or run \`feynman model list\`).`);
		} else {
			printInfo("No API key provided.");
		}
		return false;
	}

	AuthStorage.create(authPath).set(provider.id, { type: "api_key", key: apiKey });
	printSuccess(`Saved API key for ${provider.id} in auth storage.`);

	const baseUrl = await promptText("Base URL override (optional, include /v1 for OpenAI-compatible endpoints)", "");
	if (baseUrl) {
		const modelsJsonPath = getModelsJsonPath(authPath);
		const result = upsertProviderBaseUrl(modelsJsonPath, provider.id, baseUrl);
		if (result.ok) {
			printSuccess(`Saved baseUrl override for ${provider.id} in models.json.`);
		} else {
			printWarning(result.error);
		}
	}

	return true;
}

function resolveAvailableModelSpec(authPath: string, input: string): string | undefined {
	const normalizedInput = input.trim().replace(/^([^/:]+):(.+)$/, "$1/$2").toLowerCase();
	if (!normalizedInput) {
		return undefined;
	}

	const available = getAvailableModelRecords(authPath);
	const fullSpecMatch = available.find((model) => `${model.provider}/${model.id}`.toLowerCase() === normalizedInput);
	if (fullSpecMatch) {
		return `${fullSpecMatch.provider}/${fullSpecMatch.id}`;
	}

	const exactIdMatches = available.filter((model) => model.id.toLowerCase() === normalizedInput);
	if (exactIdMatches.length === 1) {
		return `${exactIdMatches[0]!.provider}/${exactIdMatches[0]!.id}`;
	}

	// When multiple providers expose the same bare model ID, prefer providers the
	// user explicitly configured in auth storage.
	if (exactIdMatches.length > 1) {
		const authData = readJson(authPath) as Record<string, unknown>;
		const configuredProviders = new Set(Object.keys(authData));
		const configuredMatches = exactIdMatches.filter((model) => configuredProviders.has(model.provider));
		if (configuredMatches.length === 1) {
			return `${configuredMatches[0]!.provider}/${configuredMatches[0]!.id}`;
		}
	}

	return undefined;
}

export function getCurrentModelSpec(settingsPath: string): string | undefined {
	const settings = readJson(settingsPath);
	if (typeof settings.defaultProvider === "string" && typeof settings.defaultModel === "string") {
		return `${settings.defaultProvider}/${settings.defaultModel}`;
	}
	return undefined;
}

export function printModelList(settingsPath: string, authPath: string): void {
	const status = collectModelStatus(settingsPath, authPath);
	if (status.availableModels.length === 0) {
		printWarning("No authenticated Pi models are currently available.");
		for (const line of status.guidance) {
			printInfo(line);
		}
		return;
	}

	let lastProvider: string | undefined;
	for (const spec of status.availableModels) {
		const [provider] = spec.split("/", 1);
		if (provider !== lastProvider) {
			lastProvider = provider;
			printSection(provider);
		}
		const markers = [
			spec === status.current ? "current" : undefined,
			spec === status.recommended ? "recommended" : undefined,
		].filter(Boolean);
		printInfo(`${spec}${markers.length > 0 ? ` (${markers.join(", ")})` : ""}`);
	}
}

export async function authenticateModelProvider(authPath: string, settingsPath?: string): Promise<boolean> {
	const choices = [
		"API key (OpenAI, Anthropic, Google, custom provider, ...)",
		"OAuth login (ChatGPT Plus/Pro, Claude Pro/Max, Copilot, ...)",
		"Cancel",
	];
	const selection = await promptChoice("How do you want to authenticate?", choices, 0);

	if (selection === 0) {
		const configured = await configureApiKeyProvider(authPath, undefined, settingsPath);
		if (configured) {
			maybeSetRecommendedDefaultModel(settingsPath, authPath);
		}
		return configured;
	}

	if (selection === 1) {
		return loginModelProvider(authPath, undefined, settingsPath);
	}

	printInfo("Authentication cancelled.");
	return false;
}

export async function loginModelProvider(authPath: string, providerId?: string, settingsPath?: string): Promise<boolean> {
	if (providerId) {
		const resolvedProvider = resolveModelProviderForCommand(authPath, providerId);
		if (!resolvedProvider) {
			throw new Error(`Unknown model provider: ${providerId}`);
		}
		if (resolvedProvider.kind === "api-key") {
			const configured = await configureApiKeyProvider(authPath, resolvedProvider.id, settingsPath);
			if (configured) {
				maybeSetRecommendedDefaultModel(settingsPath, authPath);
			}
			return configured;
		}
	}

	const provider = providerId ? resolveOAuthProvider(authPath, providerId) : await selectOAuthProvider(authPath, "login");
	if (!provider) {
		if (providerId) {
			throw new Error(`Unknown model provider: ${providerId}`);
		}
		printInfo("Login cancelled.");
		return false;
	}

	const authStorage = AuthStorage.create(authPath);
	const abortController = new AbortController();

	await authStorage.login(provider.id, {
		onAuth: (info: { url: string; instructions?: string }) => {
			printSection(`Login: ${provider.name ?? provider.id}`);
			const opened = openUrl(info.url);
			if (opened) {
				printInfo("Opened the login URL in your browser.");
			} else {
				printWarning("Couldn't open your browser automatically.");
			}
			printInfo(`Auth URL: ${info.url}`);
			if (info.instructions) {
				printInfo(info.instructions);
			}
		},
		onPrompt: async (prompt: { message: string; placeholder?: string }) => {
			return promptText(prompt.message, prompt.placeholder ?? "");
		},
		onProgress: (message: string) => {
			printInfo(message);
		},
		onManualCodeInput: async () => {
			return promptText("Paste redirect URL or auth code");
		},
		signal: abortController.signal,
	});

	printSuccess(`Model provider login complete: ${provider.id}`);

	maybeSetRecommendedDefaultModel(settingsPath, authPath);

	return true;
}

export async function logoutModelProvider(authPath: string, providerId?: string): Promise<void> {
	const authStorage = AuthStorage.create(authPath);
	if (providerId) {
		const resolvedProvider = resolveModelProviderForCommand(authPath, providerId);
		if (resolvedProvider) {
			authStorage.logout(resolvedProvider.id);
			printSuccess(`Model provider logout complete: ${resolvedProvider.id}`);
			return;
		}

		const normalizedProviderId = normalizeProviderId(providerId);
		if (authStorage.has(normalizedProviderId)) {
			authStorage.logout(normalizedProviderId);
			printSuccess(`Model provider logout complete: ${normalizedProviderId}`);
			return;
		}

		throw new Error(`Unknown model provider: ${providerId}`);
	}

	const provider = await selectOAuthProvider(authPath, "logout");
	if (!provider) {
		printInfo("Logout cancelled.");
		return;
	}

	authStorage.logout(provider.id);
	printSuccess(`Model provider logout complete: ${provider.id}`);
}

export function setDefaultModelSpec(settingsPath: string, authPath: string, spec: string): void {
	const resolvedSpec = resolveAvailableModelSpec(authPath, spec);
	if (!resolvedSpec) {
		throw new Error(`Model not available in Pi auth storage: ${spec}. Run \`feynman model list\` first.`);
	}

	const [provider, ...rest] = resolvedSpec.split("/");
	const modelId = rest.join("/");
	const settings = readJson(settingsPath);
	settings.defaultProvider = provider;
	settings.defaultModel = modelId;
	writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n", "utf8");
	printSuccess(`Default model set to ${resolvedSpec}`);
}

export async function runModelSetup(settingsPath: string, authPath: string): Promise<void> {
	let status = collectModelStatus(settingsPath, authPath);

	while (status.availableModels.length === 0) {
		const choices = [
			"API key (OpenAI, Anthropic, ZAI, Kimi, MiniMax, ...)",
			"OAuth login (ChatGPT Plus/Pro, Claude Pro/Max, Copilot, ...)",
			"Cancel",
		];
		const selection = await promptChoice("Choose how to configure model access:", choices, 0);
		if (selection === 0) {
			const configured = await configureApiKeyProvider(authPath, undefined, settingsPath);
			if (!configured) {
				status = collectModelStatus(settingsPath, authPath);
				continue;
			}
		} else if (selection === 1) {
			const loggedIn = await loginModelProvider(authPath, undefined, settingsPath);
			if (!loggedIn) {
				status = collectModelStatus(settingsPath, authPath);
				continue;
			}
		} else {
			printInfo("Setup cancelled.");
			return;
		}
		status = collectModelStatus(settingsPath, authPath);
		if (status.availableModels.length === 0) {
			printWarning("No authenticated models are available yet.");
			printInfo("If you configured a custom provider, ensure it has `apiKey` set in models.json.");
			printInfo("Tip: run `feynman doctor` to see models.json path + load errors.");
		}
	}

	if (status.currentValid) {
		printInfo(`Model: ${status.current}`);
		return;
	}

	const recommended = status.recommended ?? status.availableModels[0];
	if (recommended) {
		setDefaultModelSpec(settingsPath, authPath, recommended);
	}
}
