---
title: Slash Commands
description: Complete reference for REPL slash commands.
section: Reference
order: 2
---

Slash commands are available inside the Feynman REPL. They map to research workflows, project management tools, and setup utilities. Type `/help` inside the REPL for the live command list, which may include additional commands from installed Pi packages.

## Research workflows

| Command | Description |
| --- | --- |
| `/deepresearch <topic>` | Run a thorough, source-heavy investigation and produce a research brief with inline citations |
| `/lit <topic>` | Run a structured literature review with consensus, disagreements, and open questions |
| `/review <artifact>` | Simulate a peer review with severity-graded feedback and inline annotations |
| `/audit <item>` | Compare a paper's claims against its public codebase for mismatches and reproducibility risks |
| `/replicate <paper>` | Plan or execute a replication workflow for a paper, claim, or benchmark |
| `/compare <topic>` | Compare multiple sources and produce an agreement/disagreement matrix |
| `/draft <topic>` | Generate a paper-style draft from research findings |
| `/autoresearch <idea>` | Start an autonomous experiment loop that iteratively optimizes toward a goal |
| `/watch <topic>` | Set up recurring research monitoring on a topic |

These are the primary commands you will use day-to-day. Each workflow dispatches one or more specialized agents (researcher, reviewer, writer, verifier) depending on the task.

## Project and session

| Command | Description |
| --- | --- |
| `/log` | Write a durable session log with completed work, findings, open questions, and next steps |
| `/jobs` | Inspect active background work: running processes, scheduled follow-ups, and active watches |
| `/help` | Show grouped Feynman commands and prefill the editor with a selected command |
| `/feynman-model` | Open the model picker for the main default model and per-subagent overrides |
| `/init` | Bootstrap `AGENTS.md` and session-log folders for a new research project |
| `/outputs` | Browse all research artifacts (papers, outputs, experiments, notes) |
| `/search` | Search prior session transcripts for past research and findings |
| `/preview` | Preview the current artifact as rendered HTML or PDF |

Session management commands help you organize ongoing work. The `/log` command is particularly useful at the end of a research session to capture what was accomplished and what remains.

The `/feynman-model` command opens an interactive picker that lets you either change the main default model or assign a different model to a specific bundled subagent like `researcher`, `reviewer`, `writer`, or `verifier`.

## Running workflows from the CLI

All research workflow slash commands can also be run directly from the command line:

```bash
feynman deepresearch "topic"
feynman lit "topic"
feynman review artifact.md
feynman audit 2401.12345
feynman replicate "claim"
feynman compare "topic"
feynman draft "topic"
```

This is equivalent to launching the REPL and typing the slash command. The CLI form is useful for scripting and automation.
