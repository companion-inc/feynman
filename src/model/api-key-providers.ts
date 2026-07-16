export type ApiKeyProviderInfo = {
	id: string;
	label: string;
	envVar?: string;
};

export const MODEL_API_KEY_PROVIDERS: ApiKeyProviderInfo[] = [
	{ id: "atlascloud", label: "Atlas Cloud (OpenAI-compatible)", envVar: "ATLASCLOUD_API_KEY" },
	{ id: "openai", label: "OpenAI Platform API", envVar: "OPENAI_API_KEY" },
	{ id: "anthropic", label: "Anthropic API", envVar: "ANTHROPIC_API_KEY" },
	{ id: "google", label: "Google Gemini API", envVar: "GEMINI_API_KEY" },
	{ id: "lm-studio", label: "LM Studio (local OpenAI-compatible server)" },
	{ id: "litellm", label: "LiteLLM Proxy (OpenAI-compatible gateway)" },
	{ id: "__custom__", label: "Custom provider (local/self-hosted/proxy)" },
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
