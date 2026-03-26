import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

type ModelsJson = {
	providers?: Record<string, Record<string, unknown>>;
};

function readModelsJson(modelsJsonPath: string): { ok: true; value: ModelsJson } | { ok: false; error: string } {
	if (!existsSync(modelsJsonPath)) {
		return { ok: true, value: { providers: {} } };
	}

	try {
		const raw = readFileSync(modelsJsonPath, "utf8").trim();
		if (!raw) {
			return { ok: true, value: { providers: {} } };
		}
		const parsed = JSON.parse(raw) as unknown;
		if (!parsed || typeof parsed !== "object") {
			return { ok: false, error: `Invalid models.json (expected an object): ${modelsJsonPath}` };
		}
		return { ok: true, value: parsed as ModelsJson };
	} catch (error) {
		return {
			ok: false,
			error: `Failed to read models.json: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}

export function upsertProviderBaseUrl(
	modelsJsonPath: string,
	providerId: string,
	baseUrl: string,
): { ok: true } | { ok: false; error: string } {
	return upsertProviderConfig(modelsJsonPath, providerId, { baseUrl });
}

export type ProviderConfigPatch = {
	baseUrl?: string;
	apiKey?: string;
	api?: string;
	authHeader?: boolean;
	headers?: Record<string, string>;
	models?: Array<{ id: string }>;
};

export function upsertProviderConfig(
	modelsJsonPath: string,
	providerId: string,
	patch: ProviderConfigPatch,
): { ok: true } | { ok: false; error: string } {
	const loaded = readModelsJson(modelsJsonPath);
	if (!loaded.ok) {
		return loaded;
	}

	const value: ModelsJson = loaded.value;
	const providers: Record<string, Record<string, unknown>> = {
		...(value.providers && typeof value.providers === "object" ? value.providers : {}),
	};

	const currentProvider =
		providers[providerId] && typeof providers[providerId] === "object" ? providers[providerId] : {};

	const nextProvider: Record<string, unknown> = { ...currentProvider };
	if (patch.baseUrl !== undefined) nextProvider.baseUrl = patch.baseUrl;
	if (patch.apiKey !== undefined) nextProvider.apiKey = patch.apiKey;
	if (patch.api !== undefined) nextProvider.api = patch.api;
	if (patch.authHeader !== undefined) nextProvider.authHeader = patch.authHeader;
	if (patch.headers !== undefined) nextProvider.headers = patch.headers;
	if (patch.models !== undefined) nextProvider.models = patch.models;

	providers[providerId] = nextProvider;

	const next: ModelsJson = { ...value, providers };

	try {
		mkdirSync(dirname(modelsJsonPath), { recursive: true });
		writeFileSync(modelsJsonPath, JSON.stringify(next, null, 2) + "\n", "utf8");
		// models.json can contain API keys/headers; default to user-only permissions.
		try {
			chmodSync(modelsJsonPath, 0o600);
		} catch {
			// ignore permission errors (best-effort)
		}
		return { ok: true };
	} catch (error) {
		return { ok: false, error: `Failed to write models.json: ${error instanceof Error ? error.message : String(error)}` };
	}
}
