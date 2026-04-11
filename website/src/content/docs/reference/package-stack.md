---
title: Package Stack
description: Core and optional Pi packages bundled with Feynman.
section: Reference
order: 3
---

Feynman is built on the Pi runtime and uses curated Pi packages for its capabilities. Packages are managed through `feynman packages` commands and configured in `~/.feynman/settings.json`.

## Core packages

These are installed by default with every Feynman installation. They provide the foundation for all research workflows.

| Package | Purpose |
| --- | --- |
| `pi-subagents` | Parallel agent spawning for literature gathering and task decomposition. Powers the multi-agent workflows |
| `pi-btw` | Fast side-thread `/btw` conversations without interrupting the main research run |
| `pi-docparser` | Parse PDFs, Office documents, spreadsheets, and images for content extraction |
| `pi-web-access` | Web browsing, GitHub access, PDF fetching, and media retrieval |
| `pi-markdown-preview` | Render Markdown and LaTeX-heavy research documents as polished HTML/PDF |
| `@walterra/pi-charts` | Generate charts and quantitative visualizations from data |
| `pi-mermaid` | Render Mermaid diagrams in the terminal UI |
| `@aliou/pi-processes` | Manage long-running experiments, background tasks, and log tailing |
| `pi-zotero` | Integration with Zotero for citation library management |
| `pi-schedule-prompt` | Schedule recurring and deferred research jobs. Powers the `/watch` workflow |
| `@tmustier/pi-ralph-wiggum` | Long-running agent loops for iterative development. Powers `/autoresearch` |

These packages are updated together when you run `feynman update`. You do not need to install them individually.

This package update flow is separate from upgrading the standalone Feynman app. To upgrade the app itself, rerun the installer from the [Installation](/docs/getting-started/installation) guide.

## Optional packages

Install on demand with `feynman packages install <preset>`. These extend Feynman with capabilities that not every user needs.

| Package | Preset | Purpose |
| --- | --- | --- |
| `pi-generative-ui` | `generative-ui` | Interactive HTML-style widgets for rich output |
| `@kaiserlich-dev/pi-session-search` | `session-search` | Indexed session recall with summarize and resume UI. Powers `/search` |
| `@samfp/pi-memory` | `memory` | Automatic preference and correction memory across sessions |

## Installing and managing packages

List all available packages and their install status:

```bash
feynman packages list
```

Install a specific optional preset:

```bash
feynman packages install session-search
feynman packages install memory
feynman packages install generative-ui
```

Install all optional packages at once:

```bash
feynman packages install all-extras
```

## Updating packages

Update all installed packages to their latest versions:

```bash
feynman update
```

Update a specific package:

```bash
feynman update pi-subagents
```

Running `feynman update` without arguments updates everything. Pass a specific package name to update just that one. Updates are safe and preserve your configuration.
