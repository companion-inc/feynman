---
title: Slash Commands
description: Complete reference for REPL slash commands.
section: Reference
order: 2
---

Slash commands are available inside the Feynman REPL. They map to research workflows, research-session utilities, and setup utilities. Type `/help` inside the REPL for Feynman's curated live command list.

## Research workflows

| Command | Description |
| --- | --- |
| `/deepresearch <topic>` | Run a thorough, source-heavy investigation and produce a research brief with inline citations |
| `/lit <topic-or-lab>` | Run a structured literature review with consensus, disagreements, open questions, and lab/PI corpus mode |
| `/review <artifact>` | Run an internal research review with severity-graded feedback and inline annotations |
| `/audit <item>` | Compare a paper's claims against its public codebase for mismatches and reproducibility risks |
| `/replicate <paper>` | Plan a replication workflow for a paper, claim, or benchmark; execute only after choosing an environment |
| `/recipe <task-or-paper>` | Find ranked, implementable ML training recipes backed by papers, datasets, docs, and code |
| `/compare <topic>` | Compare multiple sources and produce an agreement/disagreement matrix |
| `/draft <topic>` | Generate a paper-style draft from research findings |
| `/autoresearch <idea>` | Start a bounded research experiment loop that iteratively optimizes against a benchmark |
| `/watch <topic>` | Create a research watch baseline and optionally schedule follow-up checks |

These are the primary commands you use during research runs. Workflow prompts can call specialized agents (researcher, reviewer, writer, verifier) through Pi's `subagent` tool when delegation helps; narrow tasks stay lead-owned. ML recipe and replication runs can inspect Hugging Face dataset metadata, repo files, and small Hub files when grounding implementation plans.

## Project and session

| Command | Description |
| --- | --- |
| `/log` | Write a durable session log with completed work, findings, open questions, and next steps |
| `/jobs` | Inspect visible research-run process/scheduler state and durable watch or experiment artifacts |
| `/help` | Show grouped Feynman commands and prefill the editor with a selected command |
| `/feynman-model` | Open the non-Pro model picker for the main default model and per-subagent overrides |
| `/thinking [level]` | Show the current thinking level and choose one, or set `off`, `minimal`, `low`, `medium`, `high`, or `xhigh` directly; `Shift+Tab` still cycles levels |
| `/init` | Bootstrap `AGENTS.md` and session-log folders for a new research project |
| `/outputs` | Browse all research artifacts (papers, outputs, experiments, notes) |
| `/btw <question>` | Ask a side question while the main research agent is busy and hand the result back when needed |
| `/search` | Search prior research-session transcripts for past research and findings |

Session management commands help you organize ongoing work. The `/log` command is particularly useful at the end of a research session to capture what was accomplished and what remains.

The `/feynman-model` command opens an interactive picker that lets you either change the main non-Pro default model or assign a different non-Pro model to a bundled subagent like `researcher`, `reviewer`, `writer`, or `verifier`.

## Running workflows from the CLI

All research workflow slash commands can also be run directly from the command line:

```bash
feynman deepresearch "topic"
feynman lit "topic"
feynman review artifact.md
feynman audit 2401.12345
feynman replicate "claim"
feynman recipe "fine-tune a small model for math reasoning"
feynman compare "topic"
feynman draft "topic"
```

This is equivalent to launching the REPL and typing the slash command. The CLI form is useful for scripting and automation.

See [ML Training Recipe](/docs/workflows/recipe) for the `/recipe` workflow and [Hugging Face Hub](/docs/tools/hugging-face) for the dataset and repo inspection tools used by recipe and replication runs.
