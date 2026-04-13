---
title: Configuration
description: Understand Feynman's configuration files and environment variables.
section: Getting Started
order: 4
---

Feynman stores all configuration and state under `~/.feynman/`. This directory is created on first run and contains settings, authentication tokens, session history, and installed packages.

## Directory structure

```
~/.feynman/
├── settings.json       # Core configuration
├── web-search.json     # Web search routing config
├── auth/               # OAuth tokens and API keys
├── sessions/           # Persisted conversation history
└── packages/           # Installed optional packages
```

The `settings.json` file is the primary configuration file. It is created by `feynman setup` and can be edited manually. A typical configuration looks like:

```json
{
  "defaultProvider": "anthropic",
  "defaultModel": "claude-sonnet-4-20250514",
  "defaultThinkingLevel": "medium"
}
```

When Amazon Bedrock is configured, a `bedrock` key is added:

```json
{
  "defaultProvider": "amazon-bedrock",
  "defaultModel": "amazon-bedrock/...",
  "defaultThinkingLevel": "medium",
  "bedrock": {
    "profile": "my-work-profile",
    "region": "us-east-1"
  }
}
```

`profile` is omitted when the env-var path was chosen during setup. Feynman injects these values as `AWS_PROFILE` and `AWS_REGION` into the Pi child process on every launch, but only when those variables are not already set in your shell — shell environment always takes precedence.

## Model configuration

The `defaultProvider` and `defaultModel` fields set which model is used when you launch Feynman without the `--model` flag. You can change them via the CLI:

```bash
feynman model set anthropic/claude-opus-4-20250514
```

To see all models you have configured:

```bash
feynman model list
```

Only authenticated/configured providers appear in `feynman model list`. If you only see OpenAI models, it usually means only OpenAI auth is configured so far.

To add another provider, authenticate it first:

```bash
feynman model login anthropic
feynman model login google
feynman model login amazon-bedrock
```

Then switch the default model:

```bash
feynman model set anthropic/claude-opus-4-6
```

The `model set` command accepts both `provider/model` and `provider:model` formats. `feynman model login google` opens the API-key flow directly. `feynman model login amazon-bedrock` reads `~/.aws/config`, presents a profile picker, verifies credentials, and saves the chosen profile and region to `settings.json` so they are injected into the Pi child process on every launch.

## Subagent model overrides

Feynman's bundled subagents inherit the main default model unless you override them explicitly. Inside the REPL, run:

```bash
/feynman-model
```

This opens an interactive picker where you can either:

- change the main default model for the session environment
- assign a different model to a specific bundled subagent such as `researcher`, `reviewer`, `writer`, or `verifier`

Per-subagent overrides are persisted in the synced agent files under `~/.feynman/agent/agents/` with a `model:` frontmatter field. Removing that field makes the subagent inherit the main default model again.

## Thinking levels

The `thinkingLevel` field controls how much reasoning the model does before responding. Available levels are `off`, `minimal`, `low`, `medium`, `high`, and `xhigh`. Higher levels produce more thorough analysis at the cost of latency and token usage. You can override per-session:

```bash
feynman --thinking high
```

## Environment variables

Feynman respects the following environment variables, which take precedence over `settings.json`:

| Variable | Description |
| --- | --- |
| `FEYNMAN_MODEL` | Override the default model |
| `FEYNMAN_HOME` | Override the config directory (default: `~/.feynman`) |
| `FEYNMAN_THINKING` | Override the thinking level |
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `OPENAI_API_KEY` | OpenAI API key |
| `GEMINI_API_KEY` | Google Gemini API key |
| `AWS_PROFILE` | AWS profile for Amazon Bedrock (overrides `settings.json`) |
| `AWS_REGION` | AWS region for Amazon Bedrock (overrides `settings.json`) |
| `AWS_ACCESS_KEY_ID` | AWS access key ID (used when no profile is configured) |
| `AWS_SECRET_ACCESS_KEY` | AWS secret access key (used when no profile is configured) |
| `TAVILY_API_KEY` | Tavily web search API key |
| `SERPER_API_KEY` | Serper web search API key |

## Session storage

Each conversation is persisted as a JSON file in `~/.feynman/sessions/`. To start a fresh session:

```bash
feynman --new-session
```

To point sessions at a different directory (useful for per-project session isolation):

```bash
feynman --session-dir ~/myproject/.feynman/sessions
```

## Diagnostics

Run `feynman doctor` to verify your configuration is valid, check authentication status for all configured providers, and detect missing optional dependencies. The doctor command outputs a checklist showing what is working and what needs attention.
