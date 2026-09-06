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
| `/feynman-model` | Open the approved research model picker for the main default and per-subagent overrides |
| `/init` | Bootstrap `AGENTS.md` and session-log folders for a new research project |
| `/outputs` | Browse all research artifacts (papers, outputs, experiments, notes) |
| `/btw <question>` | Ask a side question while the main research agent is busy and hand the result back when needed |
| `/thinking [level]` | View the current model thinking level, open a model-aware picker, or set `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, or `max` directly |
| `/search` | Search prior research-session transcripts for past research and findings |
| `/web-results` | Browse stored web-search and fetched-content result metadata |

Session management commands help you organize ongoing work. The `/log` command is particularly useful at the end of a research session to capture what was accomplished and what remains.

The `/feynman-model` command opens an interactive picker that lets you either change the main approved research model or assign a different approved model to a bundled subagent like `researcher`, `reviewer`, `writer`, or `verifier`.

## Research delegation

Use `/subagents` to inspect configured agents and `/run <agent> [task] [--bg] [--fork]` for one child. The current runtime does not provide `/chain` or `/parallel` commands.

Research workflows call `subagent` directly for one child or use `workflowScript` for parallel or sequential work:

```json
{
  "workflowScript": "return await runs.all([{key:'papers',agent:'researcher',task:'Read outputs/.plans/<slug>-papers.md.',output:'<slug>-research-papers.md'},{key:'web',agent:'researcher',task:'Read outputs/.plans/<slug>-web.md.',output:'<slug>-research-web.md'}]);",
  "async": true,
  "globalConcurrencyLimit": 4
}
```

For sequential work, await `runs.run(key, {agent, task, output})` before starting the next step. Legacy top-level `tasks`, `chain`, `concurrency`, and `failFast` call fields are not supported. `runs.all` returns an ordered array, including ordinary child failures; inspect each result's `ok` and returned output references. Validation and infrastructure failures can still fail the workflow.

Keep task briefs and provenance on disk. An async launch receipt is not completion: consume the result and verify child output paths before synthesis or dependent review. Ordinary background subagents notify their parent; `bg_wait` is for background work without native completion notification.

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
