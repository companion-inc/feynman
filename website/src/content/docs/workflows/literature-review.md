---
title: Literature Review
description: Run a structured literature review with consensus mapping and gap analysis.
section: Workflows
order: 2
---

The literature review workflow produces a structured survey of the academic landscape on a given topic. Unlike deep research which aims for a comprehensive brief, the literature review focuses specifically on mapping the state of the field -- what researchers agree on, where they disagree, and what remains unexplored.

## Usage

From the REPL:

```
/lit Scaling laws for language model performance
```

From the CLI:

```bash
feynman lit "Scaling laws for language model performance"
```

## How it works

The literature review workflow begins by having researcher agents search for papers on the topic across AlphaXiv and the web. The agents prioritize survey papers, highly-cited foundational work, and recent publications to capture both established knowledge and the current frontier.

After gathering sources, the agents extract claims, results, and methodology from each paper. The synthesis step then organizes findings into a structured review that maps out where the community has reached consensus, where active debate exists, and where gaps in the literature remain.

The output is organized chronologically and thematically, showing how ideas evolved over time and how different research groups approach the problem differently. Citation counts and publication venues are used as signals for weighting claims, though the review explicitly notes when influential work contradicts the mainstream view.

## Output format

The literature review produces:

- **Scope and Methodology** -- What was searched and how papers were selected
- **Consensus** -- Claims that most papers agree on, with supporting citations
- **Disagreements** -- Active debates where papers present conflicting evidence or interpretations
- **Open Questions** -- Topics that the literature has not adequately addressed
- **Timeline** -- Key milestones and how the field evolved
- **References** -- Complete bibliography organized by relevance

## When to use it

Use `/lit` when you need a map of the research landscape rather than a deep dive into a specific question. It is particularly useful at the start of a new research project when you need to understand what has already been done, or when preparing a related work section for a paper.

For biomedical and clinical research topics, see [Biomedical Literature Review](/docs/workflows/biomedical-literature-review) for research-only framing, evidence-type separation, and privacy boundaries.
