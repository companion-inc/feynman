---
title: Researcher
description: The researcher agent searches, reads, and extracts findings from papers and web sources.
section: Agents
order: 1
---

The researcher is the primary information-gathering agent in Feynman. It searches academic databases and the web, reads papers and articles, extracts key findings, and organizes source material for other agents to synthesize. Most workflows start with the researcher.

## What it does

The researcher agent handles source discovery and extraction for workflows that need gathered evidence. It formulates search queries based on your topic, evaluates results for relevance, reads selected sources in depth, and extracts structured information including claims, methodology, results, and limitations.

For broad deep research and literature review tasks, workflow prompts can spawn multiple researcher agents in parallel through one async `workflowScript` using `await runs.all([{key, agent, task, output}, ...])`. Each child tackles a different angle of the topic. One might search for foundational papers while another looks for recent work that challenges the established view. Feynman consumes the ordered results and verifies the declared output paths before synthesis. This parallel approach produces broader coverage than a single sequential search.

## Search strategy

The researcher uses a multi-source search strategy. For academic topics, it queries AlphaXiv for papers and uses citation chains to discover related work. For applied topics, it searches the web for documentation, blog posts, and code repositories. For ML implementation tasks, it can inspect Hugging Face dataset metadata and repo files directly. For most topics, it uses multiple channels and cross-references findings.

Search queries are diversified when breadth is needed. Rather than running the same query multiple times, the researcher generates varied queries that approach the topic from different angles. This catches papers that use different terminology for the same concept and surfaces sources that a single query would miss.

## Source evaluation

Not every search result is worth reading in full. The researcher evaluates results by scanning abstracts and summaries first, then selects the most relevant and authoritative sources for deep reading. It considers publication venue, citation count, recency, and topical relevance when prioritizing sources.

## Extraction

When reading a source in depth, the researcher extracts structured data: the main claims and their supporting evidence, methodology details, experimental results, stated limitations, and connections to other work. Each extracted item is tagged with its source location for traceability.

For ML recipe and replication work, the researcher switches to recipe-shaped extraction. It links reported results to the dataset, split/schema, method, hyperparameters, compute assumptions, metric, implementation code path, and verification status. A dataset is not described as usable unless the researcher checked availability and format, or explicitly marks that check as `unverified` or `blocked`.

## Used by

The researcher agent is used by the `/deepresearch`, `/lit`, `/review`, `/audit`, `/replicate`, `/recipe`, `/compare`, and `/draft` workflows. The workflow prompts call it through Pi's `subagent` tool when delegation improves coverage or context management; narrow tasks stay lead-owned.
