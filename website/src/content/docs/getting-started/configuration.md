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
  "defaultModel": "anthropic:claude-sonnet-4-20250514",
  "thinkingLevel": "medium"
}
```

## Model configuration

The `defaultModel` field sets which model is used when you launch Feynman without the `--model` flag. The format is `provider:model-name`. You can change it via the CLI:

```bash
feynman model set anthropic:claude-opus-4-20250514
```

To see all models you have configured:

```bash
feynman model list
```

## Subagent model overrides

Feynman's bundled subagents inherit the main default model unless you override them explicitly. Inside the REPL, run:

```bash
/feynman-model
```

This opens an interactive picker where you can either:

- change the **main (default)** model for the whole session environment, or
- assign a different model to a specific bundled subagent such as `researcher`, `reviewer`, `writer`, or `verifier`

Per-subagent overrides are persisted in the synced agent files under `~/.feynman/agent/agents/` by adding a `model:` frontmatter field. Removing that field makes the subagent inherit the main default model again.

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
| `GOOGLE_API_KEY` | Google AI API key |
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
