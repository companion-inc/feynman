<p align="center">
  <a href="https://www.atlascloud.ai/?utm_source=github&utm_medium=link&utm_campaign=feynman">
    <img src="assets/atlas-cloud-logo.png" alt="Atlas Cloud" width="200">
  </a>
</p>

> 🎁 **[Atlas Cloud](https://www.atlascloud.ai/?utm_source=github&utm_medium=link&utm_campaign=feynman)** is a full-modal AI inference platform — 59 frontier models (DeepSeek-V4, Qwen3, Kimi K2, GPT-5, Gemini 2.5 Pro, Claude, Grok-4…) via a single OpenAI-compatible endpoint. Use Atlas Cloud as the LLM backend for Feynman research agents. [View all models](https://www.atlascloud.ai/models) · [Coding Plan](https://www.atlascloud.ai/console/coding-plan)

<details>
<summary>📋 59 models available on Atlas Cloud</summary>

| Model | Type |
|-------|------|
| deepseek-ai/deepseek-v4-pro | LLM |
| deepseek-ai/deepseek-v4-0520 | LLM |
| deepseek-ai/deepseek-v4-flash | LLM |
| deepseek-ai/deepseek-r2 | LLM |
| deepseek-ai/deepseek-r2-0528 | LLM |
| deepseek-ai/deepseek-r1-0528 | LLM |
| deepseek-ai/deepseek-r1 | LLM |
| deepseek-ai/deepseek-prover-v2 | LLM |
| moonshot-ai/kimi-k2 | LLM |
| moonshot-ai/kimi-k2-0711 | LLM |
| moonshot-ai/kimi-k1.5-long | LLM |
| qwen/qwen3-235b-a22b | LLM |
| qwen/qwen3-30b-a3b | LLM |
| qwen/qwen3-32b | LLM |
| qwen/qwq-32b | LLM |
| openai/gpt-5 | LLM |
| openai/gpt-5-mini | LLM |
| openai/gpt-4.1 | LLM |
| openai/gpt-4o | LLM |
| openai/o3 | LLM |
| openai/o4-mini | LLM |
| openai/o3-mini | LLM |
| anthropic/claude-sonnet-4-5 | LLM |
| anthropic/claude-opus-4 | LLM |
| anthropic/claude-sonnet-4 | LLM |
| anthropic/claude-haiku-4-5 | LLM |
| google/gemini-2.5-pro | LLM |
| google/gemini-2.5-flash | LLM |
| google/gemini-2.5-flash-lite | LLM |
| google/gemini-2.0-flash | LLM |
| xai/grok-4 | LLM |
| xai/grok-3 | LLM |
| xai/grok-3-mini | LLM |
| meta-llama/llama-4-scout | LLM |
| meta-llama/llama-4-maverick | LLM |
| meta-llama/llama-3.3-70b | LLM |
| cohere/command-a | LLM |
| mistral/mistral-large | LLM |
| minimax/minimax-m1 | LLM |
| 01ai/yi-lightning | LLM |
| seedance/seedance-v1-pro | Video |
| seedance/seedance-v1-pro-fast | Video |
| seedance/seedance-v1-lite | Video |
| kling/kling-v2.1-pro | Video |
| kling/kling-v2.1-standard | Video |
| kling/kling-v1.6-pro | Video |
| kling/kling-v1.6-standard | Video |
| wan2/wan2.1-t2v-turbo | Video |
| wan2/wan2.1-i2v-turbo | Video |
| veo/veo3.1-fast | Video |
| veo/veo3-fast | Video |
| veo/veo3 | Video |
| runway/gen4-turbo | Video |
| stable-diffusion/sd3.5-large | Image |
| flux/flux1.1-pro-ultra | Image |
| flux/flux1.1-pro | Image |
| ideogram/ideogram-v3 | Image |
| recraft/recraft-v3 | Image |
| minimax/hailuo-i2v-01-live | Video |

</details>

---

<p align="center">
  <a href="https://feynman.is">
    <img src="assets/hero.png" alt="Feynman CLI" width="800" />
  </a>
</p>
<p align="center">The open source AI research agent.</p>
<p align="center">
  <a href="https://feynman.is/docs"><img alt="Docs" src="https://img.shields.io/badge/docs-feynman.is-0d9668?style=flat-square" /></a>
  <a href="https://github.com/companion-inc/feynman/blob/main/LICENSE"><img alt="License" src="https://img.shields.io/github/license/companion-inc/feynman?style=flat-square" /></a>
</p>

---

### Installation

**macOS / Linux:**

```bash
curl -fsSL https://feynman.is/install | bash
```

**Windows (PowerShell):**

```powershell
irm https://feynman.is/install.ps1 | iex
```

The one-line installer fetches the latest tagged release. To pin a version, pass it explicitly, for example `curl -fsSL https://feynman.is/install | bash -s -- 0.2.35`.

The installer downloads a standalone native bundle with its own Node.js runtime.

To upgrade the standalone app later, rerun the installer. `feynman update` only refreshes installed Pi packages inside Feynman's environment; it does not replace the standalone runtime bundle itself.

To uninstall the standalone app, remove the launcher and runtime bundle, then optionally remove `~/.feynman` if you also want to delete settings, sessions, and installed package state. If you also want to delete alphaXiv login state, remove `~/.ahub`. See the installation guide for platform-specific paths.

Local models are supported through the setup flow. For LM Studio, run `feynman setup`, choose `LM Studio`, and keep the default `http://localhost:1234/v1` unless you changed the server port. For LiteLLM, choose `LiteLLM Proxy` and keep the default `http://localhost:4000/v1`. For Ollama or vLLM, choose `Custom provider (baseUrl + API key)`, use `openai-completions`, and point it at the local `/v1` endpoint.

### Skills Only

If you want just the research skills without the full terminal app:

**macOS / Linux:**

```bash
curl -fsSL https://feynman.is/install-skills | bash
```

**Windows (PowerShell):**

```powershell
irm https://feynman.is/install-skills.ps1 | iex
```

That installs the skill library into `~/.codex/skills/feynman` for Codex. You can also name the Codex target explicitly:

**macOS / Linux:**

```bash
curl -fsSL https://feynman.is/install-skills | bash -s -- --codex
```

**Windows (PowerShell):**

```powershell
& ([scriptblock]::Create((irm https://feynman.is/install-skills.ps1))) -Scope Codex
```

For a repo-local Claude/agent install instead:

**macOS / Linux:**

```bash
curl -fsSL https://feynman.is/install-skills | bash -s -- --repo
```

**Windows (PowerShell):**

```powershell
& ([scriptblock]::Create((irm https://feynman.is/install-skills.ps1))) -Scope Repo
```

That installs into `.agents/skills/feynman` under the current repository.

For an OpenCode project-local install instead:

**macOS / Linux:**

```bash
curl -fsSL https://feynman.is/install-skills | bash -s -- --opencode
```

**Windows (PowerShell):**

```powershell
& ([scriptblock]::Create((irm https://feynman.is/install-skills.ps1))) -Scope OpenCode
```

That installs into `.opencode/skills/feynman` under the current repository.

These installers download the bundled `skills/` and `prompts/` trees plus the repo guidance files referenced by those skills. They do not install the Feynman terminal, bundled Node runtime, auth storage, or Pi packages.

---

### What you type → what happens

```
$ feynman "what do we know about scaling laws"
→ Searches papers and web, produces a cited research brief

$ feynman deepresearch "mechanistic interpretability"
→ Multi-agent investigation with parallel researchers, synthesis, verification

$ feynman lit "RLHF alternatives"
→ Literature review with consensus, disagreements, open questions

$ feynman audit 2401.12345
→ Compares paper claims against the public codebase

$ feynman replicate "chain-of-thought improves math"
→ Replicates experiments on local or cloud GPUs

$ feynman recipe "fine-tune a small model for math reasoning"
→ Finds ranked, implementable ML training recipes from papers, datasets, docs, and code
```

---

### Workflows

Ask naturally or use slash commands as shortcuts.

| Command | What it does |
| --- | --- |
| `/deepresearch <topic>` | Source-heavy multi-agent investigation |
| `/lit <topic>` | Literature review from paper search and primary sources |
| `/review <artifact>` | Simulated peer review with severity and revision plan |
| `/audit <item>` | Paper vs. codebase mismatch audit |
| `/replicate <paper>` | Replicate experiments on local or cloud GPUs |
| `/recipe <task-or-paper>` | Ranked ML training recipes with dataset, method, code, and verification status |
| `/compare <topic>` | Source comparison matrix |
| `/draft <topic>` | Paper-style draft from research findings |
| `/autoresearch <idea>` | Autonomous experiment loop |
| `/watch <topic>` | Recurring research watch |
| `/outputs` | Browse all research artifacts |

---

### Agents

Four bundled research agents, dispatched automatically.

- **Researcher** — gather evidence across papers, web, repos, docs
- **Reviewer** — simulated peer review with severity-graded feedback
- **Writer** — structured drafts from research notes
- **Verifier** — inline citations, source URL verification, dead link cleanup

---

### Skills & Tools

- **[AlphaXiv](https://www.alphaxiv.org/)** — paper search, Q&A, code reading, annotations (via `alpha` CLI)
- **[Hugging Face Hub](https://huggingface.co/docs/hub/api)** — dataset metadata, split/schema inspection, and small file reads from model, dataset, and Space repos
- **Docker** — isolated container execution for safe experiments on your machine
- **Web search** — Exa, Perplexity, or Gemini API; no Chromium cookie access by default
- **Session search** — indexed recall across prior research sessions
- **Preview** — browser and PDF export of generated artifacts
- **Modal** — serverless GPU compute for burst training and inference
- **RunPod** — persistent GPU pods with SSH access for long-running experiments

---

### How it works

Built on [Pi](https://github.com/badlogic/pi-mono) for the agent runtime, [alphaXiv](https://www.alphaxiv.org/) for paper search and analysis, and CLI tools for compute and execution. Runtime resources follow Pi's documented package model for [packages](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/packages.md), [extensions](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/extensions.md), and [skills](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/skills.md). Hugging Face inspection uses the public [Hub API endpoints](https://huggingface.co/docs/hub/api) and `HF_TOKEN` / `HUGGINGFACE_HUB_TOKEN` environment variables documented by [`huggingface_hub`](https://huggingface.co/docs/huggingface_hub/main/en/package_reference/environment_variables). The ML recipe workflow was informed by the open-source [Hugging Face `ml-intern`](https://github.com/huggingface/ml-intern) research-agent repo, but is implemented as native Feynman prompts, skills, and read-only tools. Every output is source-grounded — claims link to papers, docs, or repos with direct URLs.

---

### Star History

<a href="https://www.star-history.com/?repos=companion-inc%2Ffeynman&type=date&legend=top-left">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=companion-inc/feynman&type=date&theme=dark&legend=top-left" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=companion-inc/feynman&type=date&legend=top-left" />
    <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=companion-inc/feynman&type=date&legend=top-left" />
  </picture>
</a>

---

### Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full contributor guide.

```bash
git clone https://github.com/companion-inc/feynman.git
cd feynman
nvm use || nvm install
npm install
npm test
npm run typecheck
npm run build
```

[Docs](https://feynman.is/docs) · [Release Notes](RELEASES.md) · [MIT License](LICENSE)
