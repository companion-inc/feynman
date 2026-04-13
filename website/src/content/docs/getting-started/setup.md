---
title: Setup
description: Walk through the guided setup wizard to configure Feynman.
section: Getting Started
order: 3
---

The `feynman setup` wizard configures your model provider, API keys, and optional packages. It runs automatically on first launch, but you can re-run it at any time to change your configuration.

## Running setup

```bash
feynman setup
```

The wizard walks you through three stages: model configuration, authentication, and optional package installation.

## Stage 1: Model selection

Feynman supports multiple model providers. The setup wizard presents a list of available providers and models. Select your preferred default model using the arrow keys:

```
? Select your default model:
  anthropic:claude-sonnet-4-20250514
> anthropic:claude-opus-4-20250514
  openai:gpt-4o
  openai:o3
  google:gemini-2.5-pro
```

The model you choose here becomes the default for all sessions. You can override it per-session with the `--model` flag or change it later via `feynman model set <provider/model>` or `feynman model set <provider:model>`.

## Stage 2: Authentication

Depending on your chosen provider, setup prompts you for an API key or walks you through OAuth login. For providers that support Pi OAuth (like Anthropic and OpenAI), Feynman opens a browser window to complete the sign-in flow. Your credentials are stored securely in the Pi auth storage at `~/.feynman/`.

For API key providers, you are prompted to paste your key directly:

```
? Enter your API key: sk-ant-...
```

Keys are encrypted at rest and never sent anywhere except the provider's API endpoint.

### Amazon Bedrock

For Amazon Bedrock, choose:

```text
Amazon Bedrock (AWS credential chain)
```

Feynman reads `~/.aws/config` and presents a numbered list of your named profiles:

```
? Select an AWS profile:
  default
  my-work-profile
  prod-readonly
  Use environment variables instead
  Cancel
```

Select a profile to verify credentials via `~/.aws/credentials` or `~/.aws/config` (including SSO, ECS/IRSA, and EC2 instance roles). If no `~/.aws/config` exists or you prefer to supply credentials directly, choose **Use environment variables instead** — Feynman will verify `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` from your shell environment.

If the chosen profile's config already specifies a `region`, or if `AWS_REGION`/`AWS_DEFAULT_REGION` is set, the region is resolved silently. Otherwise you are prompted:

```
AWS region (e.g. us-east-1) [us-east-1]:
```

On success, the chosen profile and region are saved to `~/.feynman/settings.json` under a `bedrock` key and injected as `AWS_PROFILE`/`AWS_REGION` into the Pi child process on every launch. Bedrock models then appear in `feynman model list` without a traditional API key.

### Local models: Ollama, LM Studio, vLLM

If you want to use a model running locally, choose the API-key flow and then select:

```text
Custom provider (baseUrl + API key)
```

For Ollama, the typical settings are:

```text
API mode: openai-completions
Base URL: http://localhost:11434/v1
Authorization header: No
Model ids: llama3.1:8b
API key: local
```

That same custom-provider flow also works for other OpenAI-compatible local servers such as LM Studio or vLLM. After saving the provider, run:

```bash
feynman model list
feynman model set <provider>/<model-id>
```

to confirm the local model is available and make it the default.

## Stage 3: Optional packages

Feynman's core ships with the essentials, but some features require additional packages. The wizard asks if you want to install optional presets:

- **session-search** -- Enables searching prior session transcripts for past research
- **memory** -- Automatic preference and correction memory across sessions
- **generative-ui** -- Interactive HTML-style widgets for rich output

You can skip this step and install packages later with `feynman packages install <preset>`.

## Re-running setup

Configuration is stored in `~/.feynman/settings.json`. Running `feynman setup` again overwrites previous settings. If you only need to change a specific value, edit the config file directly or use the targeted commands like `feynman model set` or `feynman alpha login`.
