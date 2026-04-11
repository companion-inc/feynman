---
title: Installation
description: Install Feynman on macOS, Linux, or Windows using the standalone installer.
section: Getting Started
order: 1
---

Feynman ships as a standalone runtime bundle for macOS, Linux, and Windows. The one-line installer downloads a prebuilt native bundle with zero external runtime dependencies.

## One-line installer (recommended)

On **macOS or Linux**, open a terminal and run:

```bash
curl -fsSL https://feynman.is/install | bash
```

The installer detects your OS and architecture automatically. On macOS it supports both Intel and Apple Silicon. On Linux it supports x64 and arm64. The launcher is installed to `~/.local/bin`, the bundled runtime is unpacked into `~/.local/share/feynman`, and your `PATH` is updated when needed.

If you previously installed Feynman through a package manager and still see local Node.js errors after a curl install, your shell is probably still resolving the older global binary first. Run `which -a feynman`, then `hash -r`, or launch the standalone shim directly with `~/.local/bin/feynman`.

On **Windows**, open PowerShell as Administrator and run:

```powershell
irm https://feynman.is/install.ps1 | iex
```

This installs the Windows runtime bundle under `%LOCALAPPDATA%\Programs\feynman`, adds its launcher to your user `PATH`, and lets you re-run the installer at any time to update.

## Skills only

If you only want Feynman's research skills and not the full terminal runtime, install the skill library separately.

For a user-level install into `~/.codex/skills/feynman`:

```bash
curl -fsSL https://feynman.is/install-skills | bash
```

For a repo-local install into `.agents/skills/feynman` under the current repository:

```bash
curl -fsSL https://feynman.is/install-skills | bash -s -- --repo
```

On Windows, install the skills into your Codex skill directory:

```powershell
irm https://feynman.is/install-skills.ps1 | iex
```

Or install them repo-locally:

```powershell
& ([scriptblock]::Create((irm https://feynman.is/install-skills.ps1))) -Scope Repo
```

These installers download the bundled `skills/` and `prompts/` trees plus the repo guidance files referenced by those skills. They do not install the Feynman terminal, bundled Node runtime, auth storage, or Pi packages.

## Pinned releases

The one-line installer already targets the latest tagged release. To pin an exact version, pass it explicitly:

```bash
curl -fsSL https://feynman.is/install | bash -s -- 0.2.17
```

On Windows:

```powershell
& ([scriptblock]::Create((irm https://feynman.is/install.ps1))) -Version 0.2.17
```

## Updating Feynman

To upgrade the standalone Feynman app, rerun the installer for your platform. This refreshes the installed runtime bundle to the latest tagged release.

On macOS or Linux:

```bash
curl -fsSL https://feynman.is/install | bash
```

On Windows:

```powershell
irm https://feynman.is/install.ps1 | iex
```

To upgrade to a specific release instead of the latest one, rerun the installer with an explicit version as shown above in [Pinned releases](#pinned-releases).

The `feynman update` command is different: it updates installed Pi packages inside your Feynman environment. It does not replace the standalone Feynman runtime bundle itself.

## Post-install setup

After installation, run the guided setup wizard to configure your model provider and API keys:

```bash
feynman setup
```

This walks you through selecting a default model, authenticating with your provider, and optionally installing extra packages for features like web search and document preview. See the [Setup guide](/docs/getting-started/setup) for a detailed walkthrough.

## Verifying the installation

Confirm Feynman is installed and accessible:

```bash
feynman --version
```

If you see a version number, you are ready to go. Run `feynman doctor` at any time to diagnose configuration issues, missing dependencies, or authentication problems.

## Local development

For contributing or running Feynman from source:

```bash
git clone https://github.com/getcompanion-ai/feynman.git
cd feynman
nvm use || nvm install
npm install
npm start
```
