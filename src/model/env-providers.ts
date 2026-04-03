import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { upsertProviderConfig } from "./models-json.js";

type EnvOverridesState = {
	providers?: string[];
};

/**
 * Path to the file that tracks which models.json entries were created from
 * environment variables so they can be cleaned up when the env vars change.
 */
function getEnvOverridesStatePath(modelsJsonPath: string): string {
	return resolve(dirname(modelsJsonPath), ".env-overrides.json");
}

function readEnvOverridesState(statePath: string): EnvOverridesState {
	if (!existsSync(statePath)) return {};
	try {
		return JSON.parse(readFileSync(statePath, "utf8")) as EnvOverridesState;
	} catch {
		return {};
	}
}

function writeEnvOverridesState(statePath: string, state: EnvOverridesState): void {
	writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n", "utf8");
}

/**
 * Remove provider entries from models.json that were previously created by
 * env-var overrides.  This ensures stale config doesn't linger when env vars
 * are removed.
 */
function cleanupStaleEnvProviders(modelsJsonPath: string, statePath: string): void {
	const state = readEnvOverridesState(statePath);
	const staleProviders = state.providers ?? [];
	if (staleProviders.length === 0) return;

	if (!existsSync(modelsJsonPath)) {
		writeEnvOverridesState(statePath, {});
		return;
	}

	try {
		const raw = readFileSync(modelsJsonPath, "utf8").trim();
		if (!raw) return;
		const parsed = JSON.parse(raw) as Record<string, unknown>;
		const providers = parsed?.providers as Record<string, unknown> | undefined;
		if (!providers || typeof providers !== "object") return;

		let changed = false;
		for (const id of staleProviders) {
			if (id in providers) {
				delete providers[id];
				changed = true;
			}
		}

		if (changed) {
			writeFileSync(modelsJsonPath, JSON.stringify(parsed, null, 2) + "\n", "utf8");
		}
	} catch {
		// best-effort cleanup
	}

	writeEnvOverridesState(statePath, {});
}

/**
 * Best-effort model discovery from an OpenAI-compatible /models endpoint.
 */
async function discoverModels(baseUrl: string, apiKey?: string): Promise<string[]> {
	const url = `${baseUrl}/models`;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 3000);
	try {
		const headers: Record<string, string> = {};
		if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
		const response = await fetch(url, { method: "GET", headers, signal: controller.signal });
		if (!response.ok) return [];
		const json = (await response.json()) as { data?: Array<{ id?: string }> };
		if (!Array.isArray(json?.data)) return [];
		return json.data
			.map((entry) => (typeof entry?.id === "string" ? entry.id : undefined))
			.filter((id): id is string => Boolean(id));
	} catch {
		return [];
	} finally {
		clearTimeout(timer);
	}
}

export type EnvProviderOverride = {
	providerId: string;
	baseUrl: string;
	modelIds: string[];
	source: string;
};

/**
 * Applies provider configuration from well-known environment variables.
 *
 * When OPENAI_BASE_URL is set together with OPENAI_MODEL, a dedicated
 * "openai-custom" provider is created in models.json so the custom endpoint
 * doesn't clobber the built-in openai provider (gpt-4o, gpt-5, etc.).
 *
 * When OPENAI_BASE_URL is set WITHOUT OPENAI_MODEL, the built-in openai
 * provider's base URL is overridden (proxy/redirect mode).
 *
 * Env-sourced provider entries are tracked in a sidecar state file and
 * automatically cleaned up when the env vars are removed.
 *
 * Supported env vars:
 *   OPENAI_BASE_URL  — base URL for an OpenAI-compatible endpoint
 *   OPENAI_API_KEY   — API key (referenced by env var name, not stored literally)
 *   OPENAI_MODEL     — model id(s) to register (comma-separated)
 *
 * When both OPENAI_BASE_URL and OPENAI_MODEL are set, FEYNMAN_MODEL is
 * automatically pointed at the first custom model if not already set.
 */
export async function applyEnvProviderOverrides(modelsJsonPath: string): Promise<EnvProviderOverride[]> {
	const statePath = getEnvOverridesStatePath(modelsJsonPath);

	// Always clean up previous env-sourced entries first.
	cleanupStaleEnvProviders(modelsJsonPath, statePath);

	const results: EnvProviderOverride[] = [];
	const openaiBaseUrl = process.env.OPENAI_BASE_URL?.trim().replace(/\/+$/, "");
	if (!openaiBaseUrl) return results;

	const apiKey = process.env.OPENAI_API_KEY?.trim();
	const openaiModel = process.env.OPENAI_MODEL?.trim();

	if (openaiModel) {
		// --- Custom endpoint with specific models: use a dedicated provider ---
		const modelIds = openaiModel
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean);
		if (modelIds.length === 0) return results;

		const providerId = "openai-custom";
		const result = upsertProviderConfig(modelsJsonPath, providerId, {
			baseUrl: openaiBaseUrl,
			apiKey: apiKey ? "OPENAI_API_KEY" : "local",
			api: "openai-completions",
			authHeader: Boolean(apiKey),
			models: modelIds.map((id) => ({ id })),
		});

		if (result.ok) {
			// Track for cleanup on next startup.
			writeEnvOverridesState(statePath, { providers: [providerId] });

			// Auto-select the custom model when FEYNMAN_MODEL is not set.
			if (!process.env.FEYNMAN_MODEL) {
				process.env.FEYNMAN_MODEL = `${providerId}/${modelIds[0]}`;
			}

			results.push({ providerId, baseUrl: openaiBaseUrl, modelIds, source: "OPENAI_BASE_URL" });
		}
	} else {
		// --- Proxy/redirect mode: override built-in openai provider base URL ---
		// Try to discover what models the endpoint serves.
		let modelIds = await discoverModels(openaiBaseUrl, apiKey);

		if (modelIds.length === 0) {
			// Fall back to FEYNMAN_MODEL (strip provider/ prefix).
			const feynmanModel = process.env.FEYNMAN_MODEL?.trim();
			if (feynmanModel) {
				const id = feynmanModel.includes("/") ? feynmanModel.split("/").slice(1).join("/") : feynmanModel;
				if (id) modelIds = [id];
			}
		}

		// In proxy mode we only set the base URL on the openai provider.
		// If the endpoint is an actual proxy for OpenAI, the built-in model
		// list still applies.  We create an override entry only when we have
		// discovered custom model ids (i.e., the endpoint is not an OpenAI proxy
		// but a standalone server the user forgot to set OPENAI_MODEL for).
		const providerId = "openai";
		const result = upsertProviderConfig(modelsJsonPath, providerId, {
			baseUrl: openaiBaseUrl,
			...(apiKey ? { apiKey: "OPENAI_API_KEY" } : {}),
			...(modelIds.length > 0 ? { models: modelIds.map((id) => ({ id })) } : {}),
		});

		if (result.ok) {
			writeEnvOverridesState(statePath, { providers: [providerId] });
			results.push({ providerId, baseUrl: openaiBaseUrl, modelIds, source: "OPENAI_BASE_URL" });
		}
	}

	return results;
}
