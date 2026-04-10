import {
	getPiWebAccessStatus,
	loadPiWebAccessConfig,
	savePiWebAccessConfig,
	type PiWebSearchProvider,
} from "../pi/web-access.js";
import { printInfo } from "../ui/terminal.js";

const VALID_PROVIDERS: PiWebSearchProvider[] = ["auto", "perplexity", "exa", "gemini"];

export function printSearchStatus(): void {
	const status = getPiWebAccessStatus();
	printInfo("Managed by: pi-web-access");
	printInfo(`Search route: ${status.routeLabel}`);
	printInfo(`Request route: ${status.requestProvider}`);
	printInfo(`Perplexity API configured: ${status.perplexityConfigured ? "yes" : "no"}`);
	printInfo(`Exa API configured: ${status.exaConfigured ? "yes" : "no"}`);
	printInfo(`Gemini API configured: ${status.geminiApiConfigured ? "yes" : "no"}`);
	printInfo(`Browser profile: ${status.chromeProfile ?? "default Chromium profile"}`);
	printInfo(`Config path: ${status.configPath}`);
}

// Maps each named provider to the config key that holds its API key.
const PROVIDER_KEY_FIELD: Partial<Record<PiWebSearchProvider, string>> = {
	perplexity: "perplexityApiKey",
	exa: "exaApiKey",
	gemini: "geminiApiKey",
};

export function setSearchProvider(provider: PiWebSearchProvider, apiKey?: string): void {
	if (!VALID_PROVIDERS.includes(provider)) {
		throw new Error(`Usage: feynman search set <${VALID_PROVIDERS.join("|")}> [--key <api-key>]`);
	}
	if (apiKey !== undefined && provider === "auto") {
		throw new Error("The 'auto' provider does not use an API key. Usage: feynman search set auto");
	}

	const updates: Record<string, unknown> = { provider };
	if (apiKey !== undefined) {
		const keyField = PROVIDER_KEY_FIELD[provider];
		if (keyField) updates[keyField] = apiKey;
	}

	savePiWebAccessConfig(updates);

	const status = getPiWebAccessStatus();
	console.log(`Web search provider set to ${status.routeLabel}.`);
	console.log(`Config path: ${status.configPath}`);
}

export function clearSearchConfig(): void {
	// Remove provider fields, preserving any stored API keys.
	savePiWebAccessConfig({ provider: undefined, searchProvider: undefined, route: undefined });

	const status = getPiWebAccessStatus();
	console.log(`Web search provider reset to ${status.routeLabel}.`);
	console.log(`Config path: ${status.configPath}`);
}
