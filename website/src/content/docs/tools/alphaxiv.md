---
title: AlphaXiv
description: Search and retrieve academic papers through the AlphaXiv integration.
section: Tools
order: 1
---

AlphaXiv is the primary academic paper search and retrieval tool in Feynman. It provides access to a vast corpus of research papers, discussion threads, citation metadata, and full-text PDFs. The researcher agent uses AlphaXiv as its primary source for academic content.

## Authentication

AlphaXiv requires authentication. Set it up during initial setup or at any time:

```bash
feynman alpha login
```

Check your authentication status:

```bash
feynman alpha status
```

## What it provides

AlphaXiv gives Feynman access to several capabilities that power the research workflows:

- **Paper search** -- Find papers by topic, author, keyword, or arXiv ID (`alpha search`)
- **Full-text retrieval** -- Download and parse complete PDFs for in-depth reading (`alpha get`)
- **Section-focused extraction (agent tool)** -- In-agent `alpha_get_paper` supports `section` / `sections` filters for abstract/introduction/methodology/experiments/results/discussion/limitations/conclusion when available
- **Paper Q&A** -- Ask targeted questions about a paper's content (`alpha ask`)
- **Code inspection** -- Read files from a paper's linked GitHub repository (`alpha code`)
- **Annotations** -- Persistent local notes on papers across sessions (`alpha annotate`)

## How it is used

Feynman ships an `alpha-research` skill that teaches the agent to use the `alpha` CLI for paper operations. The researcher agent uses it automatically during workflows like deep research, literature review, and peer review. When you provide an arXiv ID (like `2401.12345`), the agent fetches the paper via `alpha get`.

You can also use the `alpha` CLI directly from the terminal:

```bash
alpha search "scaling laws"
alpha get 2401.12345
alpha ask 2401.12345 "What optimizer did they use?"
alpha code https://github.com/org/repo src/model.py
```

## Configuration

Authentication tokens are stored in `~/.feynman/auth/` and persist across sessions. No additional configuration is needed beyond logging in.

## Without AlphaXiv

If you choose not to authenticate with AlphaXiv, Feynman still functions but with reduced academic search capabilities. It falls back to web search for finding papers, which works for well-known work but misses the citation metadata, discussion threads, and full-text access that AlphaXiv provides. For serious research workflows, AlphaXiv authentication is strongly recommended.
