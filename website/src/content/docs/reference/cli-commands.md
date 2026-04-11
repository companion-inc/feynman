---
title: CLI Commands
description: Complete reference for all Feynman CLI commands and flags.
section: Reference
order: 1
---

This page covers the dedicated Feynman CLI commands and flags. Workflow commands like `feynman deepresearch` are also documented in the [Slash Commands](/docs/reference/slash-commands) reference since they map directly to REPL slash commands.

## Core commands

| Command | Description |
| --- | --- |
| `feynman` | Launch the interactive REPL |
| `feynman chat [prompt]` | Start chat explicitly, optionally with an initial prompt |
| `feynman help` | Show CLI help |
| `feynman setup` | Run the guided setup wizard |
| `feynman doctor` | Diagnose config, auth, Pi runtime, and preview dependencies |
| `feynman status` | Show the current setup summary (model, auth, packages) |

## Model management

| Command | Description |
| --- | --- |
| `feynman model list` | List available models in Pi auth storage |
| `feynman model login [id]` | Login to a Pi OAuth model provider |
| `feynman model logout [id]` | Logout from a Pi OAuth model provider |
| `feynman model set <provider:model>` | Set the default model for all sessions |

These commands manage your model provider configuration. The `model set` command updates `~/.feynman/settings.json` with the new default. The format is `provider:model-name`, for example `anthropic:claude-sonnet-4-20250514`.

## AlphaXiv commands

| Command | Description |
| --- | --- |
| `feynman alpha login` | Sign in to alphaXiv |
| `feynman alpha logout` | Clear alphaXiv auth |
| `feynman alpha status` | Check alphaXiv auth status |

AlphaXiv authentication enables Feynman to search and retrieve papers, access discussion threads, and pull citation metadata. The `alpha` CLI is also available directly in the agent shell for paper search, Q&A, and code inspection.

## Package management

| Command | Description |
| --- | --- |
| `feynman packages list` | List all available packages and their install status |
| `feynman packages install <preset>` | Install an optional package preset |
| `feynman update [package]` | Update installed Pi packages, or a specific package by name |

Use `feynman packages list` to see which optional packages are available and which are already installed. The `all-extras` preset installs every optional package at once.

`feynman update` updates the Pi packages inside your Feynman environment. It does not upgrade the standalone Feynman app itself. To upgrade the app, rerun the platform installer from the [Installation](/docs/getting-started/installation) guide.

## Utility commands

| Command | Description |
| --- | --- |
| `feynman search status` | Show Pi web-access status and config path |

## Workflow commands

All research workflow slash commands can also be invoked directly from the CLI:

```bash
feynman deepresearch "topic"
feynman lit "topic"
feynman review artifact.md
feynman audit 2401.12345
feynman replicate "claim"
feynman compare "topic"
feynman draft "topic"
```

These are equivalent to launching the REPL and typing the corresponding slash command.

## Flags

| Flag | Description |
| --- | --- |
| `--prompt "<text>"` | Run one prompt and exit (one-shot mode) |
| `--model <provider:model>` | Force a specific model for this session |
| `--thinking <level>` | Set thinking level: `off`, `minimal`, `low`, `medium`, `high`, `xhigh` |
| `--cwd <path>` | Set the working directory for all file operations |
| `--session-dir <path>` | Set the session storage directory |
| `--new-session` | Start a new persisted session |
| `--alpha-login` | Sign in to alphaXiv and exit |
| `--alpha-logout` | Clear alphaXiv auth and exit |
| `--alpha-status` | Show alphaXiv auth status and exit |
| `--doctor` | Alias for `feynman doctor` |
| `--setup-preview` | Install preview dependencies (pandoc) |
