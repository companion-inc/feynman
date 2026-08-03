---
title: Package Stack
description: Core and optional Pi packages bundled with Feynman.
section: Reference
order: 3
---

Feynman is built on the Pi runtime and uses curated Pi packages for its capabilities. Packages are managed through `feynman packages` commands and configured in `~/.feynman/agent/settings.json`.

Feynman also ships a local research extension that registers project-specific tools such as AlphaXiv wrappers, Feynman commands, and read-only Hugging Face Hub inspection. Those extension tools are bundled with Feynman itself rather than installed as separate Pi packages. Pi runtime observability is provided by the bundled `pi-otel` package, pointed at PostHog AI Observability through trace-specific OTLP variables, and configured for metadata-only spans by default. CLI spans use PostHog distributed tracing and are queryable from `posthog.trace_spans`; Pi LLM/tool spans appear in AI Observability and as `$ai_*` events.

This page follows Pi's upstream docs for [packages](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/packages.md), [extensions](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/extensions.md), and [skills](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/skills.md). Feynman adds its own package presets and bundled research extension on top of that model.

## Core packages

These are installed by default with every Feynman installation. They provide the foundation for research workflows while still letting Pi own the underlying runtime, RPC transport, provider model, and package loader.

| Package | Purpose |
| --- | --- |
| `@companion-ai/alpha-hub` | Direct alphaXiv tools for paper and author workflows |
| `pi-subagents` | Parallel agent spawning for literature gathering and task decomposition. Powers the multi-agent workflows |
| `pi-btw` | Side conversations while the main research agent is busy, including `/btw` follow-ups and handoff back into the main thread |
| `pi-docparser` | Parse PDFs, Office documents, spreadsheets, and images for content extraction |
| `pi-web-access` | Multi-provider web search, raw and page-grounded retrieval, stored-page passage lookup, GitHub access, PDFs, and direct image/media retrieval |
| `pi-otel` | OpenTelemetry spans for Pi sessions, model calls, turns, and tool usage, exported without prompt or tool payload content |

These packages are updated together when you run `feynman update`. You do not need to install them individually.

## Bundled research extension

| Tool group | Purpose |
| --- | --- |
| AlphaXiv tools | Search papers, fetch paper reports, ask paper questions, read linked code, and manage annotations |
| Hugging Face Hub tools | Inspect dataset metadata, features, splits, access status, and small files from model, dataset, and Space repos |
| Feynman commands | `/help`, `/outputs`, `/init`, `/feynman-model`, `/service-tier`, `/thinking`, and discovery helpers |

## Optional packages

Install on demand with `feynman packages install <preset>`. These extend Feynman with capabilities that not every user needs.

| Package | Preset | Purpose |
| --- | --- | --- |
| `@samfp/pi-memory` | `memory` | Pi-managed preference and correction memory for research-session continuity |
| `@luxusai/pi-hindsight` | `hindsight` | Hindsight-backed research-continuity memory. Requires a Hindsight server or Hindsight Cloud account |
| `@kaiserlich-dev/pi-session-search` | `session-search` | Indexed recall for prior research-session transcripts. Available through Node.js 22.x while its sqlite dependency is native-bound |

## Installing and managing packages

List supported optional research packages and their install status:

```bash
feynman packages list
```

Install a specific optional preset:

```bash
feynman packages install session-search
```

## Updating packages

Reconcile all installed packages with their configured versions:

```bash
feynman update
```

Update a specific package:

```bash
feynman update pi-subagents
```

Running `feynman update` without arguments updates unpinned packages to their current registry versions and repairs stale exact-pinned core packages to the versions shipped by Feynman. Semver ranges and registry tags remain unpinned selectors and are preserved during installation. Pass a specific package name to reconcile just that one. Updates are safe and preserve your configuration.

This command updates Pi packages inside Feynman's environment. To upgrade the standalone Feynman app itself, rerun the installer from the [Installation guide](/docs/getting-started/installation).
