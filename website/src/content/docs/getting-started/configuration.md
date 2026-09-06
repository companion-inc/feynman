---
title: Configuration
description: Understand Feynman's configuration files and environment variables.
section: Getting Started
order: 4
---

Feynman stores user-level configuration and state under `~/.feynman/`. This directory is created on first run and contains the active local org manifest, Pi agent profile, model settings, authentication state, session history, org-scoped workbench app data, web-search routing, memory state, command shims, and installed user packages.

## Directory structure

```
~/.feynman/
├── active-org.json      # Current local Feynman org selection
├── orgs/
│   └── <org_uuid>/
│       ├── feynman-workbench.db  # Org-level SQLite mirror of core workbench records
│       └── workbench/
│           ├── workspaces.json  # Workspace index for the active org
│           └── workspaces/      # Projects, sessions, settings, uploads, snapshots, and compute logs by workspace
├── agent/
│   ├── settings.json   # Core model and runtime configuration
│   ├── auth.json       # Provider auth metadata and API-key references
│   ├── agents/         # Synced bundled subagent prompts
│   ├── skills/         # Synced bundled skills
│   └── themes/         # Synced Feynman/Pi theme files
├── sessions/           # Persisted conversation history
├── workbench/           # Legacy pre-org workbench location, copied forward on first access
├── memory/             # Feynman memory storage
├── web-search.json     # Web-search routing config
├── web-search-cache/   # Private one-hour fetched-page cache
├── npm-global/         # User-scope optional Pi packages
├── bin/                # Feynman command shim used by child agents
└── .state/             # Bootstrap and telemetry state
```

The `agent/settings.json` file is the primary configuration file. It is created by `feynman setup` and can be edited manually. A typical configuration looks like:

```json
{
  "defaultProvider": "openai",
  "defaultModel": "<approved-model-id-from-model-list>",
  "defaultThinkingLevel": "medium"
}
```

## Model configuration

The `defaultProvider` and `defaultModel` fields set which model is used when you launch Feynman without the `--model` flag. You can change them via the CLI:

```bash
feynman model list
feynman model set <provider>/<model-id>
```

To see all models you have configured:

```bash
feynman model list
```

Only authenticated/configured providers appear in `feynman model list`. If you only see OpenAI models, it usually means only OpenAI auth is configured so far.

To add another provider, authenticate it first:

```bash
feynman model login anthropic
feynman model login openrouter
feynman model login google
feynman model login amazon-bedrock
```

Then switch the default model:

```bash
feynman model list
feynman model set <provider>/<model-id>
```

The `model set` command accepts both `provider/model` and `provider:model` formats. Feynman rejects premium Pro-class model IDs here and in `--model`. Exact DeepSeek V4 Pro IDs remain available because the model name does not identify a premium service tier. `feynman model login openrouter` opens the OAuth authorization page. If a remote or headless session cannot receive the loopback callback, copy the browser's final redirect URL or authorization code back into Feynman's prompt to finish sign-in. As an alternative, set `OPENROUTER_API_KEY` before launching Feynman to use API-key authentication without the OAuth flow. `feynman model login google` opens the API-key flow directly, while `feynman model login amazon-bedrock` verifies the AWS credential chain that Pi uses for Bedrock access.

## Web search configuration

Research workflows use `~/.feynman/web-search.json` for web-search routing. The default `auto` route uses configured API-backed providers, including Exa, Jina, Perplexity, and Gemini API. It does not read Chromium or Chrome cookies, so it should not trigger a macOS Keychain prompt.

Example:

```json
{
  "provider": "auto",
  "searchProvider": "auto",
  "exaApiKey": "exa_...",
  "jinaApiKey": "jina_...",
  "perplexityApiKey": "pplx-...",
  "geminiApiKey": "AIza...",
  "openaiSearchProviders": ["openai-codex", "openai"],
  "datalabApiKey": "$DATALAB_API_KEY",
  "pdf": {
    "enabled": true,
    "provider": "auto",
    "maxPages": 100,
    "datalabMode": "balanced",
    "datalabTimeoutMs": 120000
  },
  "summaryGenerationDeadlineMs": 30000,
  "image": { "enabled": true }
}
```

Gemini Web browser-cookie access is disabled by default. To opt into it, set `"geminiBrowser": true` in `web-search.json`. On Windows, this can read Chrome or Edge `v10` cookies through current-user DPAPI; Chromium `v20` app-bound cookies are unsupported and fail closed. API-backed search is recommended for `/deepresearch`.

PDF extraction uses Datalab when its key is present, then Gemini, then local PDF.js. The local parser remains available without a key. `pdf.maxPages` bounds every tier and defaults to `100`.

`openaiSearchProviders` sets the ordered Pi provider IDs considered for OpenAI-compatible `web_search`; it defaults to `["openai-codex", "openai"]`.

Full fetched pages live in `~/.feynman/web-search-cache/` for one hour. Session files store bounded metadata and a cache reference, not page bodies. If `FEYNMAN_WEB_SEARCH_CONFIG` names another config file, Feynman places `web-search-cache/` beside that file.

`tools`, `commands`, `image`, and `pdf` entries can disable individual web features. Feynman's stored-results command key is `web-results`, while `/search` remains research-session search. `summaryGenerationDeadlineMs` defaults to 30 seconds and caps one summary attempt at 10 minutes.

## Subagent model overrides

The subagent runtime has a separate config at `~/.feynman/agent/extensions/subagent/config.json`. When relocated, it uses `extensions/subagent/config.json` under the directory containing the active agent `settings.json`. Feynman fills only missing research defaults:

```json
{
  "missions": { "enabled": false },
  "fleetView": false,
  "asyncByDefault": true
}
```

Existing custom values and unrelated settings are preserved. Malformed JSON, a non-object config, or invalid types for these defaults stop normalization without replacing the config. Automatic mission creation and Fleet UI therefore remain off for a fresh research setup; background delegation stays on. This does not change researcher `subagentOnlyExtensions` wiring or prove native background tool availability.

Feynman's bundled subagents inherit the main approved research model unless you override them explicitly. Inside the REPL, run:

```bash
/feynman-model
```

This opens an interactive picker where you can either:

- change the main approved research model for the session environment
- assign a different approved model to a specific bundled subagent such as `researcher`, `reviewer`, `writer`, or `verifier`

Per-subagent overrides are persisted in the synced agent files under `~/.feynman/agent/agents/` with a `model:` frontmatter field. Removing that field makes the subagent inherit the main approved research model again.

## Thinking levels

The `thinkingLevel` field controls how much reasoning the model does before responding. Available levels are `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, and `max`, subject to the active model's capabilities. Higher levels produce more thorough analysis at the cost of latency and token usage. You can override per-session:

```bash
feynman --thinking high
```

## Environment variables

Feynman respects the following environment variables, which take precedence over `settings.json`:

| Variable | Description |
| --- | --- |
| `FEYNMAN_MODEL` | Override the default with an approved research model |
| `FEYNMAN_HOME` | Override the parent directory used to create `.feynman` (default parent: `~`) |
| `FEYNMAN_WORKBENCH_HOME` | Override the workbench app-data root; otherwise Feynman uses `~/.feynman/orgs/<org_uuid>/workbench` |
| `FEYNMAN_FETCH_CACHE_DIR` | Override the project-local directory used for `fetch_content` PDF scratch Markdown |
| `FEYNMAN_THINKING` | Override the thinking level |
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `OPENAI_API_KEY` | OpenAI API key |
| `GEMINI_API_KEY` | Google Gemini API key |
| `DATALAB_API_KEY` | Optional Datalab key for layout-aware PDF-to-Markdown extraction |
| `AWS_PROFILE` | Preferred AWS profile for Amazon Bedrock |
| `TAVILY_API_KEY` | Tavily web search API key |
| `SERPER_API_KEY` | Serper web search API key |
| `NCBI_API_KEY` | Optional NCBI E-utilities key; raises the paced request budget from 3 to 10 requests per second |
| `NCBI_MIN_REQUEST_GAP_MS` | Override the minimum delay between NCBI request starts; defaults to 500 ms anonymously and 125 ms with a key |
| `FEYNMAN_TELEMETRY` | Set to `off` to disable Feynman analytics, logs, and traces |
| `FEYNMAN_POSTHOG_HOST` | Override the PostHog ingest host |
| `FEYNMAN_POSTHOG_PROJECT_ID` | Override the PostHog project ID used in telemetry metadata |
| `FEYNMAN_POSTHOG_KEY` | Override the PostHog project token |
| `PI_OTEL_CAPTURE_CONTENT` | Controls Pi runtime span content capture. Feynman defaults this to `metadata_only` |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | Pi runtime trace endpoint. Feynman sets this to PostHog AI Observability by default |
| `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` | Feynman CLI log endpoint. Feynman sets this to PostHog Logs by default |

## Observability

Feynman sends three bounded telemetry streams to the configured PostHog project when telemetry is enabled:

- product analytics events from the CLI through the PostHog SDK
- CLI logs through PostHog Logs at `/i/v1/logs`
- OpenTelemetry spans for the CLI and Pi runtime

The CLI's generic spans use PostHog distributed tracing at `/i/v1/traces`; query them in HogQL from `posthog.trace_spans`. The Pi runtime's LLM/tool spans use PostHog AI Observability at `/i/v0/ai/otel`; inspect them in the AI Observability traces UI or query their metadata as `$ai_*` events in `events`. Large AI properties live in `posthog.ai_events` during PostHog's AI-event retention window. Do not query bare `traces`, `spans`, or `trace_spans` table names; PostHog registers distributed trace spans as `posthog.trace_spans`.

Feynman sets `PI_OTEL_CAPTURE_CONTENT=metadata_only`, so Pi spans carry model, tool, timing, count, and status metadata without prompt text or tool payload bodies. The CLI makes one attempt for each analytics, log, or trace send; the first network or ingest failure disables further PostHog sends for that process without printing into command output. Pi performs a silent HTTP preflight and does not start its OTLP exporter when Feynman's collector is blocked. Set `FEYNMAN_DEBUG=1` to show the single CLI diagnostic notice. Set `FEYNMAN_TELEMETRY=off` to disable analytics, logs, and traces explicitly; Feynman also clears inherited OTLP/PostHog environment variables before launching Pi in that mode.

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
