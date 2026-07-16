import { readFileSync } from "node:fs";

import { getEnvApiKey } from "@earendil-works/pi-ai/compat";

import { createModelRegistry } from "./registry.js";

type ModelRecord = {
	provider: string;
	id: string;
	name?: string;
};

const PRO_CLASS_MODEL_PATTERN = /(?:^|[-_.:/])pro(?:$|[-_.:/])/i;

export type ProviderStatus = {
	id: string;
	label: string;
	supportedModels: number;
	availableModels: number;
	configured: boolean;
	current: boolean;
	recommended: boolean;
};

export type ModelStatusSnapshot = {
	current?: string;
	currentValid: boolean;
	recommended?: string;
	recommendationReason?: string;
	availableModels: string[];
	providers: ProviderStatus[];
	guidance: string[];
};

const PROVIDER_LABELS: Record<string, string> = {
	atlascloud: "Atlas Cloud",
	anthropic: "Anthropic",
	openai: "OpenAI",
	"openai-codex": "OpenAI Codex",
	openrouter: "OpenRouter",
	google: "Google",
	"google-gemini-cli": "Google Gemini CLI",
	zai: "Z.AI / GLM",
	minimax: "MiniMax",
	"minimax-cn": "MiniMax (China)",
	"github-copilot": "GitHub Copilot",
	"vercel-ai-gateway": "Vercel AI Gateway",
	opencode: "OpenCode",
	"opencode-go": "OpenCode Go",
	"kimi-coding": "Kimi / Moonshot",
	xai: "xAI",
	groq: "Groq",
	mistral: "Mistral",
	cerebras: "Cerebras",
	huggingface: "Hugging Face",
	"amazon-bedrock": "Amazon Bedrock",
	"azure-openai-responses": "Azure OpenAI Responses",
	litellm: "LiteLLM Proxy",
};

type ResearchModelPreference = {
	matches: (model: ModelRecord) => boolean;
	reason: string;
};

function exactResearchModel(spec: string, reason: string): ResearchModelPreference {
	return {
		matches: (model) => modelSpec(model) === spec,
		reason,
	};
}

const RESEARCH_MODEL_FAMILY_PREFERENCES: ResearchModelPreference[] = [
	{
		matches: (model) => model.provider === "anthropic" && /^claude-opus-\d+(?:-\d+)*$/i.test(model.id),
		reason: "newest authenticated Claude Opus model for source-heavy research work",
	},
	{
		matches: (model) => model.provider === "anthropic" && /^claude-sonnet-\d+(?:-\d+)*$/i.test(model.id),
		reason: "newest authenticated Claude Sonnet model for iterative research work",
	},
	{
		matches: (model) => model.provider === "openai" && /^gpt-\d+(?:\.\d+)*(?:-.+)?$/i.test(model.id),
		reason: "newest authenticated OpenAI GPT model for research synthesis",
	},
	{
		matches: (model) => model.provider === "openai-codex" && /^gpt-\d+(?:\.\d+)*(?:-.+)?$/i.test(model.id),
		reason: "newest authenticated GPT model exposed through OpenAI Codex",
	},
	{
		matches: (model) => model.provider === "opencode" && /^claude-opus-\d+(?:-\d+)*$/i.test(model.id),
		reason: "newest OpenCode Zen Claude Opus model for source-heavy research work",
	},
	{
		matches: (model) => model.provider === "opencode" && /^claude-sonnet-\d+(?:-\d+)*$/i.test(model.id),
		reason: "newest OpenCode Zen Claude Sonnet model for iterative research work",
	},
	{
		matches: (model) => model.provider === "opencode" && /^gpt-\d+(?:\.\d+)*(?:-.+)?$/i.test(model.id),
		reason: "newest OpenCode Zen GPT fallback when direct OpenAI access is unavailable",
	},
];

const RESEARCH_MODEL_FALLBACK_PREFERENCES: ResearchModelPreference[] = [
	exactResearchModel("opencode/kimi-k2.6", "good OpenCode Zen fallback for coding and research work"),
	exactResearchModel("opencode/minimax-m2.7", "good OpenCode Zen fallback for source-heavy research work"),
	exactResearchModel("opencode-go/kimi-k2.6", "recommended OpenCode Go model for coding and research work"),
	exactResearchModel("opencode-go/minimax-m3", "good OpenCode Go fallback for source-heavy research work"),
	exactResearchModel("opencode-go/qwen3.7-max", "good OpenCode Go fallback for source-heavy research work"),
	exactResearchModel("opencode-go/glm-5.1", "good OpenCode Go fallback for GLM-backed research work"),
	exactResearchModel("opencode-go/minimax-m2.7", "good OpenCode Go fallback for MiniMax-backed research work"),
	{
		matches: (model) => model.provider === "openrouter" && /^openai\/gpt-\d+(?:\.\d+)*(?:-.+)?$/i.test(model.id),
		reason: "newest OpenRouter OpenAI GPT fallback when direct OpenAI access is unavailable",
	},
	exactResearchModel("zai/glm-5", "good fallback when GLM is the available research model"),
	exactResearchModel("minimax/MiniMax-M3", "good fallback when MiniMax is the available research model"),
	exactResearchModel("minimax/MiniMax-M2.7", "good fallback when MiniMax is the available research model"),
	exactResearchModel("minimax/MiniMax-M2.7-highspeed", "good fallback when MiniMax is the available research model"),
	exactResearchModel("kimi-coding/kimi-for-coding", "Kimi Coding Plan stable ID, auto-maps to the latest backend model"),
	exactResearchModel("kimi-coding/k2p6", "Kimi K2.6 with strong reasoning for coding and research tasks"),
	exactResearchModel("kimi-coding/kimi-k2-thinking", "good fallback when Kimi is the available research model"),
];

const PROVIDER_SORT_ORDER = [
	"atlascloud",
	"anthropic",
	"openai",
	"openai-codex",
	"opencode",
	"opencode-go",
	"google",
	"openrouter",
	"zai",
	"kimi-coding",
	"minimax",
	"minimax-cn",
	"github-copilot",
	"vercel-ai-gateway",
];

function formatProviderLabel(provider: string): string {
	return PROVIDER_LABELS[provider] ?? provider;
}

function modelSpec(model: ModelRecord): string {
	return `${model.provider}/${model.id}`;
}

export function choosePreferredModelRecord<T extends ModelRecord>(available: T[]): T | undefined {
	return available.filter((model) => !isProClassModel(model)).slice().sort(compareByResearchPreference)[0];
}

function compareByResearchPreference(left: ModelRecord, right: ModelRecord): number {
	const leftPro = isProClassModel(left);
	const rightPro = isProClassModel(right);
	if (leftPro !== rightPro) {
		return leftPro ? 1 : -1;
	}
	const familyComparison = compareCurrentModelFamily(left, right);
	if (familyComparison !== 0) {
		return familyComparison;
	}
	const leftIndex = researchPreferenceRank(left);
	const rightIndex = researchPreferenceRank(right);

	if (leftIndex !== undefined || rightIndex !== undefined) {
		if (leftIndex === undefined) return 1;
		if (rightIndex === undefined) return -1;
		return leftIndex - rightIndex;
	}

	const leftProviderIndex = PROVIDER_SORT_ORDER.indexOf(left.provider);
	const rightProviderIndex = PROVIDER_SORT_ORDER.indexOf(right.provider);
	if (leftProviderIndex !== -1 || rightProviderIndex !== -1) {
		if (leftProviderIndex === -1) return 1;
		if (rightProviderIndex === -1) return -1;
		return leftProviderIndex - rightProviderIndex;
	}

	return modelSpec(left).localeCompare(modelSpec(right));
}

function researchPreferenceRank(model: ModelRecord): number | undefined {
	const familyIndex = RESEARCH_MODEL_FAMILY_PREFERENCES.findIndex((entry) => entry.matches(model));
	if (familyIndex !== -1) return familyIndex;
	const fallbackIndex = RESEARCH_MODEL_FALLBACK_PREFERENCES.findIndex((entry) => entry.matches(model));
	return fallbackIndex === -1 ? undefined : RESEARCH_MODEL_FAMILY_PREFERENCES.length + fallbackIndex;
}

function researchPreferenceReason(model: ModelRecord): string | undefined {
	return RESEARCH_MODEL_FAMILY_PREFERENCES.find((entry) => entry.matches(model))?.reason
		?? RESEARCH_MODEL_FALLBACK_PREFERENCES.find((entry) => entry.matches(model))?.reason;
}

export function isProClassModelSpec(spec: string | undefined): boolean {
	const normalized = spec?.trim().replace(/^([^/:]+):(.+)$/, "$1/$2");
	return normalized ? PRO_CLASS_MODEL_PATTERN.test(normalized) : false;
}

function isProClassModel(model: ModelRecord): boolean {
	return isProClassModelSpec(modelSpec(model));
}

type CurrentFamilyPreference = {
	family: string;
	version: number[];
	qualityRank: number;
	reason: string;
};

function compareCurrentModelFamily(left: ModelRecord, right: ModelRecord): number {
	const leftPreference = currentFamilyPreference(left);
	const rightPreference = currentFamilyPreference(right);
	if (!leftPreference || !rightPreference || leftPreference.family !== rightPreference.family) {
		return 0;
	}

	if (leftPreference.qualityRank !== rightPreference.qualityRank) {
		return leftPreference.qualityRank - rightPreference.qualityRank;
	}

	const versionComparison = compareVersionDesc(leftPreference.version, rightPreference.version);
	if (versionComparison !== 0) {
		return versionComparison;
	}

	return modelSpec(left).localeCompare(modelSpec(right));
}

function currentFamilyPreference(model: ModelRecord): CurrentFamilyPreference | undefined {
	const anthropic = /^claude-(opus|sonnet)-(\d+(?:-\d+)*)$/i.exec(model.id);
	if (anthropic) {
		const family = anthropic[1]!.toLowerCase();
		const parsedVersion = parseClaudeVersion(anthropic[2]!);
		return {
			family: `${model.provider}/claude-${family}`,
			version: parsedVersion.version,
			qualityRank: parsedVersion.qualityRank,
			reason: family === "opus"
				? "newest authenticated Claude Opus model for source-heavy research work"
				: "newest authenticated Claude Sonnet model for iterative research work",
		};
	}

	const openAi = /^gpt-(\d+(?:\.\d+)*)(?:-(.+))?$/i.exec(model.id);
	if (openAi && (model.provider === "openai" || model.provider === "openai-codex" || model.provider === "opencode")) {
		const suffix = openAi[2]?.toLowerCase();
		return {
			family: `${model.provider}/gpt`,
			version: openAi[1]!.split(".").map(Number),
			qualityRank: openAiGptQualityRank(suffix),
			reason: model.provider === "openai"
				? "newest authenticated OpenAI GPT model for research synthesis"
				: "newest authenticated GPT model exposed through this provider",
		};
	}

	const openRouterOpenAi = /^openai\/gpt-(\d+(?:\.\d+)*)(?:-(.+))?$/i.exec(model.id);
	if (openRouterOpenAi && model.provider === "openrouter") {
		const suffix = openRouterOpenAi[2]?.toLowerCase();
		return {
			family: "openrouter/openai-gpt",
			version: openRouterOpenAi[1]!.split(".").map(Number),
			qualityRank: openAiGptQualityRank(suffix),
			reason: "newest OpenRouter OpenAI GPT fallback when direct OpenAI access is unavailable",
		};
	}

	const google = /^gemini-(\d+(?:\.\d+)*)(?:-(.+))?$/i.exec(model.id);
	if (google && (model.provider === "google" || model.provider === "opencode")) {
		const suffix = google[2]?.toLowerCase();
		return {
			family: `${model.provider}/gemini`,
			version: google[1]!.split(".").map(Number),
			qualityRank: geminiQualityRank(suffix),
			reason: "newest authenticated non-Pro Gemini model for broad research work",
		};
	}

	return undefined;
}

function parseClaudeVersion(rawVersion: string): { version: number[]; qualityRank: number } {
	const rawParts = rawVersion.split("-");
	if (rawParts.length >= 2 && /^\d{8}$/.test(rawParts[rawParts.length - 1]!)) {
		const baseParts = rawParts.slice(0, -1).map(Number);
		return {
			version: baseParts.length === 1 ? [baseParts[0]!, 0] : baseParts,
			qualityRank: 1,
		};
	}
	return { version: rawParts.map(Number), qualityRank: 0 };
}

function openAiGptQualityRank(suffix: string | undefined): number {
	if (!suffix) return 0;
	if (suffix === "chat-latest") return 2;
	if (suffix === "codex-max") return 3;
	if (suffix === "codex") return 4;
	if (suffix === "codex-mini") return 8;
	if (suffix === "mini") return 9;
	if (suffix === "nano") return 10;
	return 5;
}

function geminiQualityRank(suffix: string | undefined): number {
	if (suffix?.includes("pro")) return 99;
	if (suffix?.includes("flash-lite")) return 6;
	if (suffix?.includes("flash")) return 5;
	if (suffix?.includes("lite")) return 7;
	return 4;
}

function compareVersionDesc(left: number[], right: number[]): number {
	const length = Math.max(left.length, right.length);
	for (let index = 0; index < length; index += 1) {
		const leftPart = left[index] ?? 0;
		const rightPart = right[index] ?? 0;
		if (leftPart !== rightPart) {
			return rightPart - leftPart;
		}
	}
	return 0;
}

function currentFamilyReason(model: ModelRecord): string | undefined {
	return currentFamilyPreference(model)?.reason;
}

function sortProviders(left: ProviderStatus, right: ProviderStatus): number {
	if (left.configured !== right.configured) {
		return left.configured ? -1 : 1;
	}
	if (left.current !== right.current) {
		return left.current ? -1 : 1;
	}
	if (left.recommended !== right.recommended) {
		return left.recommended ? -1 : 1;
	}
	const leftIndex = PROVIDER_SORT_ORDER.indexOf(left.id);
	const rightIndex = PROVIDER_SORT_ORDER.indexOf(right.id);
	if (leftIndex !== -1 || rightIndex !== -1) {
		if (leftIndex === -1) return 1;
		if (rightIndex === -1) return -1;
		return leftIndex - rightIndex;
	}
	return left.label.localeCompare(right.label);
}

export function getAuthenticatedModelRecords(authPath: string): ModelRecord[] {
	const expiredOAuthProviders = readExpiredOAuthProviders(authPath);
	return createModelRegistry(authPath)
		.getAvailable()
		.filter((model) => !expiredOAuthProviders.has(model.provider))
		.map((model) => ({ provider: model.provider, id: model.id, name: model.name }));
}

export function getAvailableModelRecords(authPath: string): ModelRecord[] {
	return getAuthenticatedModelRecords(authPath).filter((model) => !isProClassModel(model));
}

export function getSupportedModelRecords(authPath: string): ModelRecord[] {
	return createModelRegistry(authPath)
		.getAll()
		.map((model) => ({ provider: model.provider, id: model.id, name: model.name }));
}

function readExpiredOAuthProviders(authPath: string): Set<string> {
	const expired = new Set<string>();
	try {
		const parsed = JSON.parse(readFileSync(authPath, "utf8")) as Record<string, unknown>;
		for (const [provider, credential] of Object.entries(parsed)) {
			if (!credential || typeof credential !== "object") continue;
			const typedCredential = credential as { type?: unknown; expires?: unknown };
			if (typedCredential.type !== "oauth" || typeof typedCredential.expires !== "number") continue;
			if (typedCredential.expires > Date.now()) continue;
			if (getEnvApiKey(provider)) continue;
			expired.add(provider);
		}
	} catch {}
	return expired;
}

export function chooseRecommendedModel(authPath: string): { spec: string; reason: string } | undefined {
	const preferred = choosePreferredModelRecord(getAvailableModelRecords(authPath));
	if (!preferred) {
		return undefined;
	}

	return {
		spec: modelSpec(preferred),
		reason: researchPreferenceReason(preferred) ?? currentFamilyReason(preferred) ?? "best currently authenticated fallback for research work",
	};
}

export function buildModelStatusSnapshotFromRecords(
	supported: ModelRecord[],
	available: ModelRecord[],
	current: string | undefined,
): ModelStatusSnapshot {
	const nonProAvailable = available.filter((model) => !isProClassModel(model));
	const proClassAvailableCount = available.length - nonProAvailable.length;
	const availableSpecs = nonProAvailable
		.slice()
		.sort(compareByResearchPreference)
		.map((model) => modelSpec(model));
	const preferred = choosePreferredModelRecord(nonProAvailable);
	const recommended = preferred
		? (() => {
			return {
				spec: modelSpec(preferred),
				reason: researchPreferenceReason(preferred) ?? currentFamilyReason(preferred) ?? "best currently authenticated fallback for research work",
			};
		})()
		: undefined;

	const currentValid = current ? availableSpecs.includes(current) : false;
	const providerMap = new Map<string, ProviderStatus>();

	for (const model of supported) {
		const provider = providerMap.get(model.provider) ?? {
			id: model.provider,
			label: formatProviderLabel(model.provider),
			supportedModels: 0,
			availableModels: 0,
			configured: false,
			current: false,
			recommended: false,
		};
		provider.supportedModels += 1;
		provider.current ||= current?.startsWith(`${model.provider}/`) ?? false;
		provider.recommended ||= recommended?.spec.startsWith(`${model.provider}/`) ?? false;
		providerMap.set(model.provider, provider);
	}

	for (const model of nonProAvailable) {
		const provider = providerMap.get(model.provider) ?? {
			id: model.provider,
			label: formatProviderLabel(model.provider),
			supportedModels: 0,
			availableModels: 0,
			configured: false,
			current: false,
			recommended: false,
		};
		provider.availableModels += 1;
		provider.configured = true;
		provider.current ||= current?.startsWith(`${model.provider}/`) ?? false;
		provider.recommended ||= recommended?.spec.startsWith(`${model.provider}/`) ?? false;
		providerMap.set(model.provider, provider);
	}

	const guidance: string[] = [];
	if (nonProAvailable.length === 0) {
		if (proClassAvailableCount > 0) {
			guidance.push("No non-Pro authenticated Pi models are available. Pro-class models are disabled in Feynman.");
			guidance.push("Configure a non-Pro research model, then rerun `feynman model list`.");
		} else {
			guidance.push("No authenticated Pi models are available yet.");
			guidance.push(
				"Run `feynman model login <provider>` (OAuth) or configure an API key (env var, auth.json, or models.json for custom providers).",
			);
			guidance.push("After auth is in place, rerun `feynman model list`.");
		}
	} else if (!current) {
		if (recommended) {
			guidance.push(`No default research model is set. Recommended: ${recommended.spec}.`);
		} else {
			guidance.push("No default research model is set, and no non-Pro research model is available for automatic selection.");
		}
		guidance.push("Run `feynman model set <provider/non-pro-model>` after choosing from `feynman model list`.");
	} else if (!currentValid) {
		guidance.push(`Configured default model is unavailable: ${current}.`);
		if (recommended) {
			guidance.push(`Switch to the current research recommendation: ${recommended.spec}.`);
		} else {
			guidance.push("Configure a non-Pro research model before using automatic model selection.");
		}
	}

	return {
		current,
		currentValid,
		recommended: recommended?.spec,
		recommendationReason: recommended?.reason,
		availableModels: availableSpecs,
		providers: Array.from(providerMap.values()).sort(sortProviders),
		guidance,
	};
}
