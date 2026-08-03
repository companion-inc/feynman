---
title: Web Search
description: Web search routing, configuration, and usage within Feynman.
section: Tools
order: 2
---

Feynman's web research tools retrieve current information and source text during research workflows. They support multiple simultaneous queries, simultaneous all-provider search, domain filtering, recency filtering, provider-available page-text retrieval, raw or question-grounded page retrieval, direct images, and passage lookup inside stored page content. The researcher agent uses them alongside AlphaXiv to gather evidence from non-academic sources like blog posts, documentation, news, and code repositories.

## Routing modes

The bundled `pi-web-access` package can choose one provider, follow a configured fallback route, or query every eligible provider simultaneously:

| Mode | Description |
| --- | --- |
| `auto` | Follow the available-provider fallback route |
| `all` | Query every eligible provider except explicit-only AnySearch, xAI, Bright Data, and SerpBase; preserve partial successes and deduplicate sources |
| `tinyfish` | Force TinyFish Search; also enables TinyFish Fetch as a hosted extraction fallback |
| `kagi` | Force Kagi Search; also enables Kagi Extract as a hosted extraction fallback |
| `ollama` | Force Ollama Cloud Web Search; also enables Ollama Web Fetch as an extraction fallback |
| `perplexity` | Force Perplexity Sonar for all web searches |
| `exa` | Force Exa for all web searches |
| `gemini` | Force Gemini API grounding |
| `xai` | Explicit-only xAI/Grok hosted search |
| `brightdata` | Explicit-only Bright Data SERP search; requires a SERP zone |
| `serpbase` | Explicit-only SerpBase Google SERP search |

## Default behavior

The default path does not read Chromium or Chrome cookies and does not request macOS Keychain access. In `auto` mode, Feynman uses API-backed search providers when they are configured: Exa first, then Perplexity, then Gemini API.

Configure an explicit API key for Exa, Perplexity, TinyFish, or Gemini in `~/.feynman/web-search.json` before running source-heavy workflows like `/deepresearch`. Exa's zero-config MCP fallback remains available without a key.

## Configuration

Check the current search configuration:

```bash
feynman search status
```

Edit `~/.feynman/web-search.json` to configure the backend:

```json
{
  "provider": "auto",
  "searchProvider": "auto",
  "exaApiKey": "exa_...",
  "perplexityApiKey": "pplx-...",
  "tinyfishApiKey": "sk-tinyfish-...",
  "geminiApiKey": "AIza...",
  "kagiApiKey": "kagi-...",
  "ollamaApiKey": "ollama-..."
}
```

Set `provider` and `searchProvider` to `all` to query every eligible provider concurrently, or to a specific `pi-web-access` provider such as `tinyfish`, `kagi`, `ollama`, `exa`, `perplexity`, or `gemini`. `searchRouting` instead defines an ordered fallback route; `all` is not valid inside that sequential list. AnySearch, xAI, Bright Data, and SerpBase must be selected explicitly and do not participate in `all`. The `feynman search set <provider> [api-key]` convenience command supports `auto`, `exa`, `perplexity`, and `gemini`; edit the JSON directly for the broader upstream provider set.

Self-hosted SearXNG can use `searxngHeaders` for reverse-proxy or Zero Trust authentication. Bright Data search requires `brightdataSerpZone`; its optional Web Unlocker extraction fallback uses a separate `brightdataUnlockerZone`.

To route OpenAI `web_search` and `source_check` calls through a third-party gateway, set `openaiResponsesUrl` to the gateway's full Responses-compatible endpoint. The default remains OpenAI's official Responses endpoint.

Gemini Web browser-cookie access is disabled by default. To opt into that legacy fallback, add `"geminiBrowser": true` to `~/.feynman/web-search.json`. On macOS, that can trigger a Keychain prompt from the browser's cookie store, so API keys are the recommended route.

## Search features

The web search tool supports several capabilities that the researcher agent leverages automatically:

- **Multiple queries** -- Send 2-4 varied-angle queries simultaneously for broader coverage of a topic
- **Domain filtering** -- Restrict results to specific domains like `arxiv.org`, `github.com`, or `nature.com`
- **Recency filtering** -- Filter results by date, useful for fast-moving topics where only recent work matters
- **Page text retrieval** -- Fetch provider-available page text for the most important results rather than relying only on snippets
- **Raw HTTP text** -- Use `fetch_content` with `mode: "raw"` to inspect textual API responses, error pages, or other source bytes without article extraction
- **Page-grounded answers** -- Use `fetch_content` with `mode: "answer"` and a question to answer against one page while retaining the original page text for inspection
- **Direct images** -- Retrieve PNG, JPEG, WebP, and GIF links as safely bounded inline images
- **Passage lookup** -- Use `get_search_content` with `findText` and exact, case-insensitive, or fuzzy `findMode` matching to locate a passage in stored content without paging through the entire page
- **Clean continuation** -- Long fetched pages report character, byte, and line totals and the exact offset for the next slice

## When it runs

Web search is used automatically by researcher agents during workflows. You do not need to invoke it directly. The researcher decides when to use web search versus paper search based on the topic and source availability. Academic topics lean toward AlphaXiv; engineering and applied topics lean toward web search.
