---
title: Installation
description: Install Feynman on macOS, Linux, or Windows with curl or npm.
section: Getting Started
order: 1
---

Feynman can be installed either as a standalone runtime bundle or as an npm package. For most users, the standalone installer is the simplest path because it downloads a prebuilt native bundle with zero external runtime dependencies and verifies its published SHA-256 before replacing an existing installation.

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

This installs the Windows x64 runtime bundle under `%LOCALAPPDATA%\Programs\feynman`, adds its launcher to your user `PATH`, and lets you re-run the installer at any time to update. Windows 11 on Arm uses the same bundle through its x64 compatibility layer.

## Alternative: npm install

If you prefer installing Feynman into an existing Node.js environment, use npm instead:

```bash
npm install -g @advaitpaliwal/feynman
```

This path uses your local Node.js runtime instead of the bundled standalone runtime. It requires a compatible Node.js version that satisfies Feynman's current engine range: `>=22.22.0 <26`.

### Migrating from the old npm scope

If you installed `@companion-ai/feynman`, remove it before installing the new canonical package:

```bash
npm uninstall -g @companion-ai/feynman
npm install -g @advaitpaliwal/feynman
```

The command remains `feynman`. Native install commands are unchanged; standalone users can continue to rerun the one-line installer above.

## Updating the standalone app

To update the standalone Feynman app on macOS, Linux, or Windows, rerun the installer you originally used. That replaces the downloaded runtime bundle with the latest tagged release.

`feynman update` is different: it updates installed Pi packages inside Feynman's environment, not the standalone app bundle itself.

If you installed Feynman with npm, upgrade it with:

```bash
npm install -g @advaitpaliwal/feynman@latest
```

## Uninstalling

Feynman does not currently ship a dedicated `uninstall` command. Remove the standalone launcher and runtime bundle directly, then optionally remove the Feynman home directory if you also want to delete settings, workbench app state, sessions, and installed package state. If you also want to clear alphaXiv login state, remove `~/.ahub`.

If you installed Feynman with npm, uninstall it with:

```bash
npm uninstall -g @advaitpaliwal/feynman
```

On macOS or Linux:

```bash
rm -f ~/.local/bin/feynman
rm -rf ~/.local/share/feynman
# optional: remove settings, workbench state, sessions, and installed package state
rm -rf ~/.feynman
# optional: remove alphaXiv auth state
rm -rf ~/.ahub
```

On Windows PowerShell:

```powershell
Remove-Item "$env:LOCALAPPDATA\\Programs\\feynman" -Recurse -Force
# optional: remove settings, workbench state, sessions, and installed package state
Remove-Item "$HOME\\.feynman" -Recurse -Force
# optional: remove alphaXiv auth state
Remove-Item "$HOME\\.ahub" -Recurse -Force
```

If you added the launcher directory to `PATH` manually, remove that entry as well.

## Skills only

If you only want Feynman's research skills and not the full terminal runtime, install the skill library separately.

For a Codex user-level install into `~/.codex/skills/feynman`:

```bash
curl -fsSL https://feynman.is/install-skills | bash
```

You can also name the Codex target explicitly:

```bash
curl -fsSL https://feynman.is/install-skills | bash -s -- --codex
```

For a repo-local Claude/agent install into `.agents/skills/feynman` under the current repository:

```bash
curl -fsSL https://feynman.is/install-skills | bash -s -- --repo
```

For an OpenCode project-local install into `.opencode/skills/feynman`:

```bash
curl -fsSL https://feynman.is/install-skills | bash -s -- --opencode
```

On Windows, install the skills into your Codex skill directory:

```powershell
irm https://feynman.is/install-skills.ps1 | iex
```

Or name the Codex target explicitly:

```powershell
& ([scriptblock]::Create((irm https://feynman.is/install-skills.ps1))) -Scope Codex
```

Or install them repo-locally:

```powershell
& ([scriptblock]::Create((irm https://feynman.is/install-skills.ps1))) -Scope Repo
```

Or install them into an OpenCode project:

```powershell
& ([scriptblock]::Create((irm https://feynman.is/install-skills.ps1))) -Scope OpenCode
```

These installers download the bundled `skills/` and `prompts/` trees plus the repo guidance files referenced by those skills. They do not install the Feynman terminal, bundled Node runtime, auth storage, or Pi packages.

## Pinned releases

The one-line installer already targets the latest tagged release. To pin an exact version, pass it explicitly:

```bash
curl -fsSL https://feynman.is/install | bash -s -- 0.2.31
```

On Windows:

```powershell
& ([scriptblock]::Create((irm https://feynman.is/install.ps1))) -Version 0.2.31
```

## Post-install setup

After installation, run the guided setup wizard to configure your model provider and API keys:

```bash
feynman setup
```

This walks you through selecting an approved research model, authenticating with your provider, and optionally installing research-continuity extras such as memory or session search. See the [Setup guide](/docs/getting-started/setup) for a detailed walkthrough.

## Verifying the installation

Confirm Feynman is installed and accessible:

```bash
feynman --version
```

If you see a version number, you are ready to go. Run `feynman doctor` at any time to diagnose configuration issues, missing dependencies, or authentication problems.
