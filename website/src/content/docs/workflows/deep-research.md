---
title: Deep Research
description: Run a thorough, multi-agent investigation that produces a cited research brief.
section: Workflows
order: 1
---

Deep research is the flagship Feynman workflow. For broad topics, it can call researcher agents in parallel to search academic papers, web sources, and code repositories, then synthesize everything into a structured research brief with inline citations. Narrow explainers stay lead-owned and use direct searches.

## Usage

From the REPL:

```
/deepresearch What are the current approaches to mechanistic interpretability in LLMs?
```

From the CLI:

```bash
feynman deepresearch "What are the current approaches to mechanistic interpretability in LLMs?"
```

Both forms are equivalent. The workflow first writes a plan to `outputs/.plans/<slug>.md`, summarizes it, and waits for you to confirm or request changes. After you approve the plan, it streams progress as Feynman discovers and analyzes sources.

## How it works

The deep research workflow proceeds through five phases. First, Feynman creates a plan with key questions, source strategy, scale decision, task ledger, and verification log, then asks for confirmation before executing.

Second, after approval, Feynman chooses the execution scale. Narrow "what is X" explainers usually run as direct lead-owned research with multiple search terms. Broader surveys can dispatch researcher agents in parallel to search academic papers, web sources, and code repositories.

Parallel evidence gathering uses one async `workflowScript` with `runs.all` and a concurrency limit of four. Each child reads its task brief from disk and declares an output file. Feynman checks the ordered completion results and actual returned artifact paths before synthesis, recording failed or missing evidence in the task ledger and provenance. Citation verification completes before the reviewer starts; neither an async launch receipt nor an intended filename proves that step finished.

Third, Feynman reads and extracts key findings from the most relevant sources. It pulls claims, methodology details, results, and limitations from each paper or article. PDF extraction is avoided unless explicitly requested; metadata, abstracts, HTML pages, and official docs are preferred when PDF parsing is brittle.

Fourth, a synthesis step cross-references findings across sources, identifies areas of consensus and disagreement, and organizes the material into a coherent narrative. The output is written as a research brief with sections for background, key findings, open questions, and references.

Finally, Feynman verifies claims against cited sources to flag misattributions or unsupported assertions. The finished report and provenance sidecar are saved under `outputs/` and can be previewed as rendered HTML when a preview command is visible, or opened/rendered with shell tools such as `pandoc`.

## Output format

The research brief follows a consistent structure:

- **Summary** -- A concise overview of the topic and key takeaways
- **Background** -- Context and motivation for the research area
- **Key Findings** -- The main results organized by theme, with inline citations
- **Open Questions** -- Unresolved issues and promising research directions
- **References** -- Full citation list with links to source papers and articles

## Customization

You can steer the research by being specific in your prompt. Narrow topics produce more focused briefs. Broad topics produce survey-style overviews. You can also specify constraints like "focus on papers from 2024" or "only consider empirical results" to guide the agents.
