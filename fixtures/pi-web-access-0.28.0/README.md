<p>
  <img src="banner.png" alt="pi-web-access" width="1100">
</p>

# Pi Web Access

**Web search, content extraction, and video understanding for Pi agent. OpenAI/Codex search, zero-config Exa search, Brave, Parallel, TinyFish, Search1API, Searchinfinity, Querit, Tavily, Firecrawl, Jina, SERPdive, Kagi, Bocha, Ollama, AnySearch, XCrawl, Valyu, xAI/Grok, Mistral, Bright Data SERP, SerpBase, Serper, self-hosted SearXNG, keyless DuckDuckGo, optional browser-cookie Gemini Web, Kimi Code Plan search, or bring your own API keys.**

[![npm version](https://img.shields.io/npm/v/pi-web-access?style=for-the-badge)](https://www.npmjs.com/package/pi-web-access)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)
[![Platform](https://img.shields.io/badge/Platform-macOS%20%7C%20Linux%20%7C%20Windows*-blue?style=for-the-badge)]()

<https://github.com/user-attachments/assets/cac6a17a-1eeb-4dde-9818-cdf85d8ea98f>

## Why Pi Web Access

**Zero Config** — Works out of the box with Exa MCP (no API key needed). If you're signed into Pi with a Codex subscription, OpenAI web search can reuse that auth. An active Kimi Code Plan signed in through `/login kimi-coding` enables explicit Kimi search without a separate Open Platform key. Add API keys or endpoints for OpenAI, Brave, Parallel, TinyFish, Search1API, Searchinfinity, Querit, Tavily, Firecrawl, Jina, SERPdive, Kagi, Bocha, Ollama, Valyu, SerpBase, Serper, Exa, Perplexity, Gemini API, or Mistral for more control; configure a self-hosted SearXNG endpoint for private search; or opt into browser-cookie access for Gemini Web.

**Video Understanding** — Point it at a YouTube video or local screen recording and ask questions about what's on screen. Full transcripts, visual descriptions, and frame extraction at exact timestamps.

**Smart Fallbacks** — Every capability has a fallback chain. Search tries configured SearXNG first for local/private search. When the active Pi model is `openai-codex`, it then tries Codex-backed OpenAI search. Otherwise it tries Exa before OpenAI, then Brave, Parallel, TinyFish, Search1API, Searchinfinity, Querit, Tavily, Firecrawl, Jina, SERPdive, Kagi, Bocha, Ollama, Perplexity, Gemini API, and Gemini Web when browser cookies are enabled. YouTube tries Gemini Web when enabled, then API, then Perplexity. Blocked pages try configured self-hosted Firecrawl first. Third-party hosted page fetchers require explicit `fetchRouting.allowRemoteHostedProviders` opt-in for remote HTTP(S) targets.

**GitHub Cloning** — GitHub URLs are cloned locally instead of scraped. The agent gets real file contents and a local path to explore, not rendered HTML.

## Install

```bash
pi install npm:pi-web-access
```

Works immediately with no API keys — Exa MCP provides zero-config search. If Pi has Codex auth from `/login`, OpenAI search can also work without a separate key. For more providers or direct API access, add keys to `~/.pi/web-search.json`:

```json
{
  "openaiApiKey": "sk-...",
  "braveApiKey": "BSA_...",
  "exaApiKey": "exa-...",
  "tinyfishApiKey": "sk-tinyfish-...",
  "search1apiApiKey": "...",
  "searchinfinityApiKey": "...",
  "queritApiKey": "...",
  "jinaApiKey": "jina_...",
  "bochaApiKey": "sk-...",
  "perplexityApiKey": "pplx-...",
  "geminiApiKey": "AIza...",
  "mistralApiKey": "..."
}
```

In `auto` mode (default), `web_search` tries a configured SearXNG endpoint first for local/private search. When the active Pi model is `openai-codex`, it then tries Codex-backed OpenAI search. Otherwise it tries Exa (direct API if keyed, MCP if not) before OpenAI, then Brave, Parallel, TinyFish, Search1API, Searchinfinity, Querit, Tavily, Firecrawl, Jina, SERPdive, Perplexity, Gemini API, and Gemini Web when browser-cookie access is enabled. Exa handles search; curator summary drafts are generated separately by the configured Pi summary model, defaulting to Claude Haiku, Codex Luna, Codex Terra, Gemini 3.6 Flash, GPT-5 mini, then DeepSeek V4 Flash when available. Slow summary drafts fall back to a deterministic result summary after a bounded deadline.

If your OpenAI key belongs to a third-party Responses-compatible gateway, set `openaiResponsesUrl` to that gateway's full Responses endpoint. The default remains `https://api.openai.com/v1/responses`.

To route automatic searches through the active Pi model, configure an ordered route without a top-level `provider`:

```json
{
  "searchRouting": {
    "providers": ["openai", "tavily"],
    "useCurrentModel": true,
    "fallbackOn": ["unsupported", "transient", "quota", "network", "invalid-response"]
  }
}
```

With `useCurrentModel: true`, the automatic `openai` step uses Hosted `web_search` when the active model is a GPT model backed by an official OpenAI Responses endpoint: `openai`/`openai-responses` on HTTPS `api.openai.com`, or `openai-codex`/`openai-codex-responses` on the official ChatGPT Codex endpoint. Third-party gateways, Azure, and other models continue to the next route entry. A tool-level `provider` or top-level `provider` remains an explicit override; `provider: "openai"` keeps the existing independent OpenAI/Codex search-model behavior.

For sandboxed networks that provide outbound proxy transport through environment variables, set `ssrf.trustEnvProxy` to `true` to skip local DNS preflight for proxied hostnames:

```json
{
  "ssrf": {
    "trustEnvProxy": true
  }
}
```

This is an opt-in DNS-preflight adjustment, not proxy transport configuration. `HTTP_PROXY`, `HTTPS_PROXY`, and `ALL_PROXY` are recognized; `NO_PROXY` hosts still undergo DNS validation, and localhost or literal private IP targets remain blocked.

Optional dependencies for video frame extraction:

```bash
brew install ffmpeg   # frame extraction, video thumbnails, local video duration
brew install yt-dlp   # YouTube stream URLs for frame extraction
```

Without these, video content analysis (transcripts, visual descriptions via Gemini) still works. The binaries are only needed for extracting individual frames as images.

System dependency for curator browser launch on Linux:

| Package | Purpose | Install |
|---------|---------|---------|
| `xdg-utils` | Opens the curator UI in your default browser | Debian/Ubuntu: `sudo apt install -y xdg-utils` · Fedora/RHEL: `sudo dnf install -y xdg-utils` · Arch: `sudo pacman -S xdg-utils` |

Without `xdg-utils`, the curator URL is printed to the tool output so you can copy it into a browser.

Requires Pi v0.37.3+.

## Quick Start

```typescript
// Search the web
web_search({ query: "TypeScript best practices 2025" })

// Fetch a page
fetch_content({ url: "https://docs.example.com/guide" })

// Clone a GitHub repo
fetch_content({ url: "https://github.com/owner/repo" })

// Understand a YouTube video
fetch_content({ url: "https://youtube.com/watch?v=abc", prompt: "What libraries are shown?" })

// Analyze a screen recording
fetch_content({ url: "/path/to/recording.mp4", prompt: "What error appears on screen?" })
```

## Tools

### web_search

Search the web via OpenAI, Brave, Parallel, TinyFish, Search1API, Searchinfinity, Querit, Tavily, Firecrawl, Jina, SERPdive, Kagi, Bocha, Ollama, AnySearch, XCrawl, Valyu, xAI, Mistral, Bright Data SERP, SerpBase, Serper, self-hosted SearXNG, keyless DuckDuckGo, Exa, Perplexity AI, Gemini, or Kimi. Returns a synthesized answer with source citations.

```typescript
web_search({ query: "rust async programming" })
web_search({ queries: ["query 1", "query 2"] })
web_search({ query: "latest news", numResults: 10, recencyFilter: "week" })
web_search({ query: "...", domainFilter: ["github.com"] })
web_search({ query: "...", provider: "openai" })
web_search({ query: "...", provider: "kimi" })
web_search({ query: "...", provider: "mistral" })
web_search({ query: "...", provider: "all" })
web_search({ query: "...", includeContent: true })
web_search({ queries: ["query 1", "query 2"], workflow: "none" })
web_search({ queries: ["query 1", "query 2"], workflow: "summary-review" })
web_search({ queries: ["query 1", "query 2"], workflow: "auto-summary" })
```

| Parameter | Description |
| ----------- | ------------- |
| `query` / `queries` | Single query or batch of queries |
| `numResults` | Results per query (default: 5, max: 20) |
| `recencyFilter` | `day`, `week`, `month`, or `year` |
| `domainFilter` | Limit to domains (prefix with `-` to exclude) |
| `provider` | Configured provider when omitted or set to `auto`; `all` searches every eligible provider except Parallel MCP, DuckDuckGo, Kimi, AnySearch, XCrawl, Valyu, xAI, Mistral, Bright Data, SerpBase, and Serper simultaneously; otherwise `openai`, `brave`, `parallel`, `parallel-mcp`, `tinyfish`, `search1api`, `searchinfinity`, `querit`, `tavily`, `firecrawl`, `jina`, `serpdive`, `kagi`, `bocha`, `ollama`, `anysearch`, `xcrawl`, `valyu`, `xai`, `mistral`, `brightdata`, `serpbase`, `serper`, `searxng`, `duckduckgo`, `exa`, `perplexity`, `gemini`, or `kimi` (auto-selects when no provider or routing is configured; Parallel MCP, DuckDuckGo, Kimi, AnySearch, XCrawl, Valyu, xAI, Mistral, Bright Data, SerpBase, and Serper are explicit-only) |
| `includeContent` | Fetch full page content from sources in background |
| `workflow` | `none` (skip curator), `summary-review` (open curator and auto-generate a summary draft, default), or `auto-summary` (generate a summary without opening the curator) |

Batch searches run up to three queries concurrently. Provider routing and fallback within each query remain sequential.

### fetch_content

Fetch URL(s) as readable markdown, exact textual HTTP bodies, direct images, or page-grounded answers. Automatically detects and handles GitHub repos, GitHub PRs and issues, YouTube videos, PDFs, local video files, images, and regular web pages.

```typescript
fetch_content({ url: "https://example.com/article" })
fetch_content({ urls: ["url1", "url2", "url3"] })
fetch_content({ url: "https://github.com/owner/repo" })
fetch_content({ url: "https://github.com/owner/repo/pull/123#discussion_r456" })
fetch_content({ url: "https://youtube.com/watch?v=abc", prompt: "What libraries are shown?" })
fetch_content({ url: "/path/to/recording.mp4", prompt: "What error appears on screen?" })
fetch_content({ url: "https://youtube.com/watch?v=abc", timestamp: "23:41-25:00", frames: 4 })
fetch_content({ url: "https://example.com/api", mode: "raw" })
fetch_content({ url: "https://example.com/guide", mode: "answer", prompt: "What are the installation steps?" })
fetch_content({ url: "https://example.com/account", auth: "work", mode: "raw" })
fetch_content({ url: "https://example.com/diagram.png" })
```

| Parameter | Description |
| ----------- | ------------- |
| `url` / `urls` | Single URL/path or multiple URLs |
| `prompt` | Question for video analysis, or the page-local question required by `mode: "answer"` |
| `mode` | `readable` (default), `raw` for exact textual HTTP bodies, or `answer` for a grounded answer from fetched content |
| `answerModel` | Optional `provider/model-id` override for answer mode; defaults to the configured `fetch.answerProvider` + `fetch.answerModel` pair, or the current enabled Pi model when no pair is configured |
| `timestamp` | Extract frame(s) — single (`"23:41"`), range (`"23:41-25:00"`), or seconds (`"85"`) |
| `frames` | Number of frames to extract (max 12) |
| `forceClone` | Clone GitHub repos that exceed the 350MB size threshold |

For a standing answer-mode model, set both `fetch.answerProvider` and `fetch.answerModel` in `web-search.json`; a per-call `answerModel` takes precedence. Configured answer defaults are opt-in and can send fetched page text to a different provider/model, which may change privacy and cost behavior.

Thanks to [@linuxtextadventurer](https://github.com/linuxtextadventurer) for PR #328.

### get_search_content

Retrieve stored content from previous searches or fetches. Fetched URL content is stored in full in a private `web-search-cache` directory under the Pi config directory, not in the session JSONL. This includes `fetch_content` answer mode, which stores the original page content. The cache has a one-hour lifetime and fixed limits of 128 entries and 128 MiB; when either limit is reached, the oldest entries are removed first. On macOS and Linux the cache directory and files are kept at permissions `0700` and `0600`, respectively. Use `findText` to locate bounded matching passages without paging through a large page, or use `offset` and `limit` to retrieve slices intentionally.

```typescript
get_search_content({ responseId: "abc123", urlIndex: 0 })
get_search_content({ responseId: "abc123", url: "https://...", offset: 30000 })
get_search_content({ responseId: "abc123", query: "original query" })
get_search_content({ responseId: "abc123", urlIndex: 0, findText: "installation" })
get_search_content({ responseId: "abc123", urlIndex: 0, findText: ["timeout", "retry"], findMode: "fuzzy" })
```

`findMode` supports `exact`, `case-insensitive` (default), and `fuzzy`. Finder output is capped at 20,000 characters with match counts and nearby context. `findText` cannot be combined with `offset` or `limit`. The default `limit` and maximum permitted `limit` use `maxInlineContentChars`.

### source_check

Check a claim and return a machine-readable artifact with exact passage citations. Search results are deduplicated and capped at 20 sources; `fetchContent` fetches at most 5 pages, while stored and retrieved content remains subject to the configured `maxInlineContentChars` `offset`/`limit` bounds.

```typescript
source_check({ claim: "The API supports streaming responses" })
source_check({
  claim: "The API supports streaming responses",
  queries: ["API streaming responses documentation", "API streaming limitations"],
  fetchContent: true,
  domainFilter: ["docs.example.com", "-old.example.com"]
})
```

The artifact includes `supported`, `contradicted`, `unclear`, or `missing-evidence` claim status, source quality hints, SHA-256 content hashes, and passage IDs with exact source offsets. Search and fetch errors remain in the artifact instead of being silently discarded. Artifacts are stored with the session and retrieved through `get_search_content` using the returned `responseId`; paged artifact responses are JSON slices, so request the next `offset` when needed.

## Capabilities

### GitHub repos

GitHub URLs are cloned locally instead of scraped. The agent gets real file contents and a local path to explore with `read` and `bash`. Root URLs return the repo tree + README, `/tree/` paths return directory listings, `/blob/` paths return file contents.

Repos over 350MB get a lightweight API-based view instead of a full clone (override with `forceClone: true`). Commit SHA URLs are handled via the API. Clones are cached for the session and wiped on session change. Private repos require the `gh` CLI. Set `githubClone.enabled` to `false` to skip this GitHub-specific clone/API handling; `fetch_content` remains available, so the URL can continue through the normal HTTP extraction path.

Pull request and issue URLs are rendered as one priority-ordered markdown document instead of scraped HTML. PR views include status, body, checks when `gh` supports them, review verdicts, linked references, files, commits, conversation comments, review thread comments, truncation markers, and escalation commands. Issue views include state, metadata, body, linked closing PRs when available, and comments. Comment anchors such as `#issuecomment-...` and `#discussion_r...` are forced inline. The full rendered document is stored for `get_search_content` offsets and `findText`.

`fetch_content` uses `gh pr view` or `gh issue view` first with prompts disabled. It retries with a smaller field set when an older `gh` does not know a requested field. Public unauthenticated REST is used as a bounded fallback under the same `fetchContent.domainPolicy` and SSRF rules; REST cannot include checks. Set `githubPrIssue.enabled` to `false` to skip PR/issue specialization and keep normal HTTP extraction.

### YouTube videos

YouTube URLs are processed via Gemini for full video understanding — visual descriptions, transcripts with timestamps, and chapter markers. Pass a `prompt` to ask specific questions about the video. Results include the video thumbnail so the agent gets visual context alongside the transcript.

Fallback: Gemini Web when browser cookies are enabled → Gemini API → Perplexity (text summary only). Handles all URL formats: `/watch?v=`, `youtu.be/`, `/shorts/`, `/live/`, `/embed/`, `/v/`.

### Local video files

Pass a file path (`/`, `./`, `../`, or `file://` prefix) to analyze video content via Gemini. Supports MP4, MOV, WebM, AVI, and other common formats up to 50MB for Gemini analysis. Pass a `prompt` to ask about specific content. If ffmpeg is installed, a thumbnail frame is included alongside the analysis. Timestamp/frame extraction uses ffmpeg directly and can still operate on larger local files.

Fallback: Gemini API (Files API upload) → Gemini Web when browser cookies are enabled.

### Video frame extraction

Use `timestamp` and/or `frames` on any YouTube URL or local video file to extract visual frames as images.

```typescript
fetch_content({ url: "...", timestamp: "23:41" })                       // single frame
fetch_content({ url: "...", timestamp: "23:41-25:00" })                 // range, 6 frames
fetch_content({ url: "...", timestamp: "23:41-25:00", frames: 3 })      // range, custom count
fetch_content({ url: "...", timestamp: "23:41", frames: 5 })            // 5 frames at 5s intervals
fetch_content({ url: "...", frames: 6 })                                // sample whole video
```

Requires `ffmpeg` (and `yt-dlp` for YouTube). Timestamps accept `H:MM:SS`, `MM:SS`, or bare seconds.

### PDFs

PDF URLs are converted to Markdown and saved under the temporary `pi-web-pdf` directory by default so the agent can `read` specific sections without loading the full document into context. Three engines are available, selected with `pdf.provider` (`"auto"` is the default):

| Provider | Engine | Trade-offs |
| --- | --- | --- |
| `datalab` | Datalab hosted conversion (Marker) | Deterministic layout-aware output — tables, multi-column reading order, headings, math; `accurate` mode handles scanned pages; may return a `parse_quality_score`; requires a Datalab key, billed per page with a free monthly credit |
| `gemini` | Gemini API (vision LLM) | Best on scanned/complex pages; LLM transcription can occasionally drift or truncate; requires a Gemini key |
| `unpdf` | Local pdf.js text extraction | Free, offline, no key; flattened text only — no layout, no tables, no OCR |

`auto` order: Datalab (when a key is configured) → Gemini (when a key is configured) → local `unpdf`. Datalab runs first for layout-aware conversion. If its request fails — including after free-tier credit is exhausted — the chain continues to Gemini, then `unpdf`, automatically. Setting `pdf.provider` to `gemini`, `datalab`, or `unpdf` pins that engine and skips the other remote tiers (an explicit engine still falls back to `unpdf` when it errors, except for credential/config errors and caller cancellation). No Datalab key means the `datalab` tier is simply skipped — behavior is unchanged for existing users.

**Why Datalab.** The hosted converter uses a dedicated extraction engine (Marker) intended to retain document structure such as tables, multi-column reading order, headings, links, and math, where local `unpdf` extraction only yields flattened text. It is deterministic rather than LLM-based. Completed responses may include a `parse_quality_score` (0–5) for optional quality gating. Pricing is per processed page: **fast / balanced** $4 / 1,000 pages; **accurate** $10 / 1,000 pages. The free tier gives a **$10 monthly credit** (personal email; $20 with a work email) at **25 requests/minute** — roughly **2,500 pages/month free in `fast` mode** or 1,000 in `accurate` mode. Processing defaults to the **US region**. EU data residency uses **1.25× usage**; opt in with `DATALAB_PROCESSING_LOCATION=eu`.

Configure Datalab via the web-search config:

```jsonc
{
  "datalabApiKey": "$DATALAB_API_KEY",
  "pdf": {
    "maxSizeMB": 20,
    "maxPages": 100,
    "provider": "auto",      // "auto" | "gemini" | "datalab" | "unpdf"
    "datalabMode": "balanced", // "fast" | "balanced" | "accurate"
    "datalabTimeoutMs": 120000
  }
}
```

Env vars: `DATALAB_API_KEY` (or `datalabApiKey` in config), `DATALAB_PROCESSING_LOCATION` (`us` default; `eu` enables EU data residency at 1.25× usage), `DATALAB_MODE` (`fast` / `balanced` / `accurate`), and `DATALAB_API_BASE` (custom gateway). `pdf.datalabMode` overrides `DATALAB_MODE`. The default `datalabTimeoutMs` is 120s and is capped at 300s.

> Privacy note: like the Gemini tier, the PDF bytes are sent to the Datalab cloud for conversion. Files are uploaded to the selected region's storage and deleted best-effort after conversion.

### Blocked pages

Raw and direct-image HTTP requests use the same SSRF validation, hostname domain policy, redirect checks, timeout, and 5MB streamed response bound as normal extraction. Raw mode returns textual bodies even for non-2xx responses and exposes the HTTP status in tool details; it does not run readability or hosted extraction fallbacks.

`fetch_content` can opt into local browser-cookie auth with `auth: "profile"`, or `auth: true` when exactly one `authFetch` profile exists. Configure profiles in `~/.pi/web-search.json`, for example `{ "authFetch": { "social": ["x.com", "instagram.com"], "work": { "hosts": ["docs.company.com"], "chromeProfile": "Profile 2", "cache": "off" } } }`. Auth fetch uses only the local direct HTTP path, requires HTTPS, allows only configured hosts and their subdomains, refuses cross-origin redirects, and never sends cookies or authenticated content to hosted extraction providers. Browser cookie extraction remains opt-in through `allowBrowserCookies: true` or `PI_ALLOW_BROWSER_COOKIES=1`.

#### Proxy (`proxy`)

`web_search`, `source_check`, and `fetch_content` all accept an optional `proxy` string (e.g. `"http://mcr:4444"`). When provided, every outbound HTTP(S) request is routed through `curl` instead of Node's built-in fetch — this works around Node fetch ignoring `HTTP(S)_PROXY` env vars and undici `ProxyAgent` failing the TLS handshake against several common HTTP proxies (ERR_SSL_WRONG_VERSION_NUMBER).

An empty string (`""`) forces a direct connection even when a config-level proxy is set. Omitting the parameter falls back to the global `proxy` in `~/.pi/web-search.json`.

The config-level `proxy` applies only to requests made by this extension's tools. Other traffic in the host process — such as the coding agent's own model API calls — is never routed through it, so a configured proxy that is temporarily down cannot break unrelated requests.

```jsonc
// ~/.pi/web-search.json — global proxy for all tools
{
  "proxy": "http://mcr:4444"
}
```

Localhost, `127.0.0.1`, `[::1]`, and any host matching the `NO_PROXY` environment variable are never proxied.

When Readability fails or returns only a cookie notice, the extension can retry configured Firecrawl extraction, Jina Reader (handles JS rendering server-side, no API key needed), TinyFish, Search1API, Querit, Kagi Extract, Ollama Web Fetch, Parallel, Bright Data Web Unlocker, Gemini URL Context API, and Gemini Web extraction when browser cookies are enabled. Configure `fetchRouting.providers` to change the order or set of `fetch_content` providers. Supported values are `http`, `firecrawl`, `jina`, `tinyfish`, `search1api`, `querit`, `kagi`, `ollama`, `parallel`, `parallel-mcp`, `brightdata`, and `gemini`; when absent, the default order is unchanged. `parallel-mcp` is not in the default fetch order and must be listed explicitly. For remote HTTP(S) targets, third-party hosted providers are disabled unless `fetchRouting.allowRemoteHostedProviders` is `true`, because hosted services perform their own fetch and can see a different redirect chain than the local safety gate. Firecrawl stays available as a configured extraction service. Firecrawl requests are cache-only by default and require an explicit fresh-scrape opt-in before the Firecrawl server can fetch target URLs. Bright Data Web Unlocker runs last of the remote scraping providers, ahead of only the Gemini fallbacks, because it is billed per request against a paid account; it is skipped unless both a key and an `unblocker` zone are configured. It applies no minimum-length check, so any non-empty body it returns — including a short consent or paywall stub — is the final answer for that URL and the Gemini fallbacks are not tried. Handles SPAs, JS-heavy pages, and anti-bot protections transparently. Also parses Next.js RSC flight data when present. HTML extraction also surfaces registered discovery relations (`service-desc`, `service-doc`, `service-meta`, `api-catalog`, `describedby`) from the HTTP `Link` header and matching `link`/`a[rel]` markup. Readable or rendered content remains primary; on an empty shell, the normal extraction fallbacks run before declared links are returned on their own.

## How It Works

```
web_search(query)
  → configured searchRouting (optionally active-model-aware OpenAI Hosted Search) → automatic provider chain

fetch_content(url)
  → Video file?  Gemini API (Files API) → Gemini Web (if browser cookies enabled)
  → GitHub URL?  Clone repo, return file contents + local path
  → YouTube URL? Gemini Web (if browser cookies enabled) → Gemini API → Perplexity
  → HTTP fetch → PDF? Datalab → Gemini API → local text extraction, save to temp pi-web-pdf
               → HTML? Readability (+ declared Link/rel discovery) → RSC parser → Firecrawl (if configured) → third-party hosted fallbacks only when fetchRouting.allowRemoteHostedProviders is enabled
               → Text/JSON/Markdown? Return directly
```

## Commands

### /websearch

Open the search curator directly. Runs searches and lets you review, add, select results, and approve a summary before it is sent back to the agent — no LLM round-trip needed.

```
/websearch                                               # empty page, type your own searches
/websearch react hooks, next.js caching                  # pre-fill with comma-separated queries
```

Results get injected into the conversation when you approve the summary or click "Send selected results without summary". On timeout, the curator auto-submits and falls back to a deterministic summary if no approved draft is present.

### /curator

Toggle or configure the curator workflow at runtime.

```
/curator                    # toggle on/off
/curator on                 # enable curator (summary-review)
/curator off                # disable curator (raw results only)
/curator summary-review     # explicit workflow
```

Persists to `~/.pi/web-search.json` and takes effect on the next `web_search` call. When disabled, `web_search` returns raw results without opening the curator window.

### /search

Browse stored search results interactively. Lists all results from the current session with their response IDs for easy retrieval.

### /google-account

Show the active Google account currently authenticated for Gemini Web. If cookie extraction fails, it reports sanitized attempted browser/profile entries and whether the failure was missing required cookies, password-store access, decryption, SQLite, or profile lookup.

## Activity Monitor

Toggle with **Ctrl+Shift+W** to see live request/response activity:

```
─── Web Search Activity ────────────────────────────────────
  API  "typescript best practices"     200    2.1s ✓
  GET  docs.example.com/article        200    0.8s ✓
  GET  blog.example.com/post           404    0.3s ✗
────────────────────────────────────────────────────────────
```

## Configuration

Config defaults to `~/.pi/web-search.json`. `PI_CODING_AGENT_DIR` takes precedence when set; with `XDG_CONFIG_HOME`, an existing `XDG_CONFIG_HOME/pi/web-search.json` is preferred, an existing legacy `~/.pi/web-search.json` remains usable, and the XDG path is used as the new-config target when neither file exists. Every field is optional.

```json
{
  "openaiApiKey": "sk-...",
  "openaiResponsesUrl": "https://gateway.example.com/v1/responses",
  "braveApiKey": "BSA_...",
  "braveBaseUrl": "https://gateway.example.com/brave/res/v1",
  "exaApiKey": "exa-...",
  "exaBaseUrl": "https://gateway.example.com/exa",
  "parallelApiKey": "...",
  "tinyfishApiKey": "sk-tinyfish-...",
  "search1apiApiKey": "...",
  "tavilyApiKey": "tvly-...",
  "tavilyBaseUrl": "https://gateway.example.com/tavily",
  "jinaApiKey": "$JINA_API_KEY",
  "serpdiveApiKey": "sd_live_...",
  "serpdiveModel": "krill",
  "kagiApiKey": "$KAGI_API_KEY",
  "ollamaApiKey": "$OLLAMA_API_KEY",
  "valyuApiKey": "$VALYU_API_KEY",
  "serpbaseApiKey": "$SERPBASE_API_KEY",
  "serperApiKey": "$SERPER_API_KEY",
  "brightdataApiKey": "$BRIGHTDATA_API_KEY",
  "brightdataSerpZone": "pi_serp",
  "xaiApiKey": "xai-...",
  "xaiSearchTools": ["web_search"],
  "mistralApiKey": "$MISTRAL_API_KEY",
  "mistralSearchModel": "mistral-small-latest",
  "mistralSearchTool": "web_search",
  "searxngBaseUrl": "https://search.example.com",
  "searxngHeaders": {
    "CF-Access-Client-Id": "xxxxxxxx.access",
    "CF-Access-Client-Secret": "xxxxxxxx"
  },
  "firecrawlBaseUrl": "https://crawl.example.com",
  "firecrawlApiKey": "fc-...",
  "firecrawlApiVersion": "v2",
  "firecrawlFreshScrape": false,
  "brightdataUnlockerZone": "pi_unlocker",
  "perplexityApiKey": "pplx-...",
  "geminiApiKey": "AIza...",
  "geminiBaseUrl": "https://my-gateway.example.com/gemini",
  "cloudflareApiKey": "...",
  "geminiAuth": "adc",
  "geminiProject": "my-gcp-project",
  "geminiLocation": "us-central1",
  "provider": "openai",
  "searchRouting": {
    "providers": ["openai", "brave", "exa"],
    "useCurrentModel": false,
    "fallbackOn": ["transient", "quota", "network", "invalid-response"]
  },
  "fetchRouting": {
    "providers": ["http", "firecrawl", "jina", "tinyfish", "search1api", "querit", "kagi", "ollama", "parallel", "brightdata", "gemini"],
    "allowRemoteHostedProviders": false
  },
  "fetch": {
    "timeout": 30,
    "answerProvider": "openai",
    "answerModel": "gpt-5.6"
  },
  "webSearch": {
    "enabled": true
  },
  "tools": {
    "webSearch": { "enabled": true },
    "sourceCheck": { "enabled": true },
    "fetchContent": { "enabled": true },
    "getSearchContent": { "enabled": true }
  },
  "commands": {
    "websearch": { "enabled": true },
    "curator": { "enabled": true },
    "search": { "enabled": true },
    "google-account": { "enabled": true }
  },
  "image": {
    "enabled": true
  },
  "browserCookies": {
    "browser": "helium",
    "profile": "Profile 2"
  },
  "allowBrowserCookies": false,
  "searchModel": "gemini-3.6-flash",
  "summaryModel": "anthropic/claude-haiku-4-5",
  "summaryGenerationDeadlineMs": 30000,
  "maxInlineContentChars": 30000,
  "workflow": "summary-review",
  "curatorTimeoutSeconds": 20,
  "curatorRemote": {
    "host": "my-box.tailnet.ts.net",
    "bind": "100.101.102.103"
  },
  "autoOpenBrowser": true,
  "githubClone": {
    "enabled": true,
    "maxRepoSizeMB": 350,
    "cloneTimeoutSeconds": 30,
    "clonePath": "/tmp/pi-github-repos"
  },
  "githubPrIssue": {
    "enabled": true
  },
  "youtube": {
    "enabled": true,
    "preferredModel": "gemini-3.6-flash"
  },
  "video": {
    "enabled": true,
    "preferredModel": "gemini-3.6-flash",
    "maxSizeMB": 50
  },
  "pdf": {
    "enabled": true,
    "maxSizeMB": 20,
    "provider": "auto"
  },
  "fetchContent": {
    "domainPolicy": {
      "allow": ["example.com"],
      "deny": ["blocked.example.com"]
    }
  },
  "shortcuts": {
    "curate": "ctrl+shift+s",
    "activity": "ctrl+shift+w"
  },
  "ssrf": {
    "allowRanges": ["198.18.0.0/15"],
    "trustEnvProxy": false
  }
}
```

`summaryModel` accepts an optional thinking-level suffix, such as `anthropic/claude-haiku-4-5:low`. Supported suffixes are `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, and `max`.

All provider API-key fields (`openaiApiKey`, `braveApiKey`, `parallelApiKey`, `tinyfishApiKey`, `search1apiApiKey`, `searchinfinityApiKey`, `queritApiKey`, `tavilyApiKey`, `jinaApiKey`, `serpdiveApiKey`, `kagiApiKey`, `bochaApiKey`, `ollamaApiKey`, `serpbaseApiKey`, `anysearchApiKey`, `xcrawlApiKey`, `xaiApiKey`, `mistralApiKey`, `brightdataApiKey`, `firecrawlApiKey`, `exaApiKey`, `perplexityApiKey`, `geminiApiKey`, `datalabApiKey`, and `cloudflareApiKey`) accept explicit credential sources. Use `$NAME` or `${NAME}` to read one named environment variable, or prefix a trusted local shell command with `!` to resolve one value at provider request time. Escape `$$` as a literal leading `$` and `$!` as a literal leading `!`:

```json
{
  "openaiApiKey": "!/absolute/path/to/secret-manager read openai",
  "braveApiKey": "${SCOPED_BRAVE_API_KEY}",
  "exaApiKey": "$$literal-key",
  "geminiApiKey": "$!literal-command"
}
```

This syntax applies to provider credentials only; other configuration fields are not interpolated. `firecrawlApiKey`, `kagiApiKey`, `ollamaApiKey`, `valyuApiKey`, `serpbaseApiKey`, `serperApiKey`, `mistralApiKey`, and `brightdataApiKey` use the same credential-source rules, while `braveBaseUrl`, `exaBaseUrl`, `tavilyBaseUrl`, `firecrawlBaseUrl`, `firecrawlApiVersion`, `firecrawlFreshScrape`, `brightdataSerpZone`, and `brightdataUnlockerZone` are literal config values.

A command source is not run while the extension loads or registers tools. Each selected provider request runs it again with a five-second timeout, a 16 KiB output limit, a minimized environment, and a one-line non-empty stdout requirement. Command text and stderr are omitted from errors. These commands are trusted local configuration, not a same-user process isolation boundary; use absolute executable paths and protect the config file. `OP_SESSION_*` variables are forwarded to trusted resolver commands so shell-local 1Password sessions can be reused without storing them in config. An explicit source overrides legacy provider environment variables and fails that provider locally rather than falling back with a stale credential. Direct Google Gemini API requests send the resolved key only in the `x-goog-api-key` header, never in the URL.

`mistralSearchModel` defaults to `mistral-small-latest` and must be a non-empty string. `mistralSearchTool` defaults to `web_search` and accepts only `web_search` or the opt-in `web_search_premium` tool.

Set `braveBaseUrl`, `exaBaseUrl`, or `tavilyBaseUrl` to route those providers through a compatible HTTPS API gateway. `BRAVE_BASE_URL`, `EXA_BASE_URL`, and `TAVILY_BASE_URL` are the environment-variable equivalents and take precedence over config. Brave appends `/web/search`, Exa appends `/answer` or `/search`, and Tavily appends `/search`. Defaults remain the providers' official API roots. `exaBaseUrl` applies only to keyed direct API calls; zero-config Exa MCP search continues to use Exa's hosted MCP endpoint. Invalid overrides fail before a request is sent instead of falling back to an official endpoint, and credential headers are removed if a gateway redirects to another origin.

`authFetch` configures named local browser-cookie auth profiles for explicit `fetch_content` calls. A profile can be a host array (`"work": ["docs.company.com"]`) or an object with `hosts`, optional `chromeProfile`, `redirects: "same-origin"`, and `cache: "session" | "off"`.

`browserCookies` selects the Chromium browser preset and profile used for Gemini Web cookies, for example `{ "browserCookies": { "browser": "helium", "profile": "Profile 1" } }`. When `browser` is set, cookie discovery checks only that browser, which avoids unrelated password-store prompts. Supported preset names are `helium`, `chrome`, `brave`, `arc`, `chromium`, and `edge`, subject to platform availability. Omit `browser` to keep automatic browser discovery. `profile` must be a profile directory name. The old top-level `chromeProfile` field is rejected; move it to `browserCookies.profile`. Arbitrary profile paths and `profilePath` are intentionally not supported.

`fetchContent.domainPolicy` is an optional hostname allow/deny policy for `fetch_content` target URLs. It is off when omitted. Each bare hostname matches itself and its subdomains; `deny` wins when a hostname matches both lists. The policy is checked before HTTP(S) target handling and before each redirect followed by this extension's own fetch path. Local file paths and non-HTTP sources are not subject to this policy. It is an additional restriction: the existing SSRF guard still blocks private and internal destinations. Remote extraction services can still perform their own DNS, redirects, and egress after this extension preflights the submitted target URL, so third-party hosted HTTP(S) fallbacks stay disabled unless `fetchRouting.allowRemoteHostedProviders` is enabled for separately isolated provider deployments.

`fetch.timeout` is an optional positive finite number of seconds for direct HTTP fetches and the Jina Reader fallback. When omitted, both use a 30-second budget. Fractional values are supported and rounded up to at least 1 millisecond; values that cannot be converted to a finite safe integer delay from 1 through Node's 2,147,483,647 ms timer maximum are rejected. An invalid declared value fails closed with an error naming `web-search.json`. An internal/per-call `timeoutMs` override takes precedence over this setting. Other remote extraction fallbacks keep their own documented budgets.

`fetch.answerProvider` and `fetch.answerModel` are an optional pair that selects the model used by `fetch_content` answer mode when no per-call `answerModel` is supplied. Both values must be non-empty strings and must identify an enabled text-capable model available in Pi's model registry; invalid or partial configuration fails closed. This is opt-in: answering with the configured provider/model can send fetched page text outside the current session and may incur that provider's costs. A per-call `answerModel` override is resolved first and remains usable even when these configured defaults are malformed.

Set `searxngBaseUrl` or `SEARXNG_BASE_URL` to use a self-hosted SearXNG JSON API. A configured endpoint is preferred first in `auto` mode for local/private search. Its base URL and redirects remain subject to the SSRF guard; add only the narrowest self-hosted range to `ssrf.allowRanges` when it resolves to a private or synthetic range. Optional `searxngHeaders` merges extra HTTP headers into each SearXNG request (string values only; invalid header names are ignored), which is useful for reverse-proxy or Zero Trust auth such as Cloudflare Access service tokens (`CF-Access-Client-Id` / `CF-Access-Client-Secret`). Configured headers override the default `Accept: application/json` when the same name is supplied. Thanks to Marcos A. Núñez (@marnunez) for PR #107 and Avinash Kanaujiya (@avinashkanaujiya) for issue #105.

**DuckDuckGo.** DuckDuckGo HTML search is keyless and explicit-only. Select it with `provider: "duckduckgo"` or place it in `searchRouting`; it is never chosen by `auto` and never participates in `provider: "all"`. Domain filters are enforced locally after DuckDuckGo redirect URLs are decoded. `recencyFilter` is not guaranteed because the HTML endpoint has no documented stable time parameter. A 200 page with no parseable results is reported as an invalid response, so routing can continue when `fallbackOn` includes `"invalid-response"`.

Set `firecrawlBaseUrl` or `FIRECRAWL_BASE_URL` to use Firecrawl for `web_search` and as an extraction fallback for `fetch_content`. Search calls `/v2/search` by default, requests `sources: ["web"]`, maps `numResults` to `limit`, maps `recencyFilter` to Firecrawl's `tbs`, and maps domain filters to `includeDomains` or `excludeDomains` when possible. With `includeContent: true`, Firecrawl search adds Markdown scrape options and returns successful result Markdown as inline content. Fetch extraction calls `/v2/scrape` by default. Set `firecrawlApiVersion` or `FIRECRAWL_API_VERSION` to `v1` for older self-hosted images. Firecrawl page scraping is cache-only by default (`lockdown: true`), so the Firecrawl server does not make fresh outbound target requests unless you explicitly set `firecrawlFreshScrape: true` or `FIRECRAWL_FRESH_SCRAPE=1`. Enable fresh scraping only for a Firecrawl deployment whose own egress, redirects, DNS rebinding behavior, and internal-network access are isolated or allowlisted; this extension can preflight submitted fetch URLs but cannot control network requests made by the Firecrawl server. A configured Firecrawl API base URL may use `localhost`, `127.0.0.0/8`, or `::1` without adding those loopback ranges to global `ssrf.allowRanges`; that exception is only for Firecrawl API calls, not submitted fetch/search target URLs. The configured Firecrawl API base URL and redirects are otherwise still validated by the same SSRF guard as other remote requests, and Firecrawl credentials are stripped from cross-origin API redirects.

**Bright Data.** Set `brightdataApiKey` or `BRIGHTDATA_API_KEY` to use Bright Data-backed features. The SERP search provider also requires `brightdataSerpZone` or `BRIGHTDATA_SERP_ZONE`, and the Web Unlocker extraction fallback also requires `brightdataUnlockerZone` or `BRIGHTDATA_UNLOCKER_ZONE`. These zone settings are separate and are never substituted for each other: SERP requires a Bright Data zone of type `serp`, while Web Unlocker requires a zone of type `unblocker`. Leaving either zone unset keeps that product unavailable, so enabling one Bright Data feature does not opt into the other.

Bright Data search is explicit-only. Select it with `provider: "brightdata"` or place it in `searchRouting`; it is never chosen by `auto` and never participates in `provider: "all"`. The SERP path maps domain filters to Google `site:` clauses and recency filters to Google `tbs` parameters, validates the returned SERP envelope, and surfaces provider errors instead of converting them to empty results.

Bright Data Web Unlocker is a paid `fetch_content` fallback after Parallel and before Gemini. It validates the target URL with the local SSRF guard before resolving credentials or sending any request to Bright Data, validates redirects from the Bright Data API endpoint, and strips authorization across cross-origin API redirects. As with any remote extraction service, Bright Data fetches the submitted target from its own infrastructure; keep `brightdataUnlockerZone` unset for URLs that must not be disclosed to a third party. Successful Unlocker responses are returned as Markdown, including short pages or consent stubs, because the request has already been billed and discarding the body would hide what Bright Data saw.

**Kagi.** Set `kagiApiKey` or `KAGI_API_KEY` to use Kagi Search API as a normal configured search provider. It maps `numResults` to Kagi's `limit` parameter and returns Kagi result snippets; when Kagi includes extracted Markdown in the search response, `includeContent` exposes it as inline content. Kagi Extract is also available as a `fetch_content` fallback after Querit and before Ollama/Parallel. The target URL is validated locally before the API request and Kagi authorization is stripped across cross-origin API redirects.

**Ollama.** Set `ollamaApiKey` or `OLLAMA_API_KEY` to use Ollama Cloud Web Search without running a local daemon. The same account key used for Ollama Cloud inference authenticates `POST https://ollama.com/api/web_search`, with `numResults` capped to Ollama's documented max of 10. Ollama Web Fetch is available as a `fetch_content` fallback after Kagi and before Parallel, with local target validation before the Cloud request.

**SerpBase.** Set `serpbaseApiKey` or `SERPBASE_API_KEY` and select `provider: "serpbase"` to query SerpBase's Google Search Results API. SerpBase is explicit-only: it is never chosen by `auto` and never participates in `provider: "all"`, because each request can consume paid Google SERP credits. Domain filters are sent as Google `site:` clauses and reapplied locally; recency maps to Google's `tbs` time filter.

**Valyu.** Set `valyuApiKey` or `VALYU_API_KEY` and select `provider: "valyu"` to query Valyu's research search API. Valyu is explicit-only: it is never chosen by `auto` or `provider: "all"`, but it can be configured as the named provider or added to `searchRouting`. Returned page bodies provide result snippets and optional inline content, capped at 2,500 and 4,000 characters per result.

**Serper.** Set `serperApiKey` or `SERPER_API_KEY` and select `provider: "serper"` to query Serper's Google Search API. Serper is explicit-only: it is never chosen by `auto` or `provider: "all"`, but it can be configured as the named provider or added to `searchRouting`.

**Parallel MCP.** Select `provider: "parallel-mcp"` to use Parallel Search MCP without an API key, or add it to `searchRouting`. It is explicit-only and is never chosen by `auto` or `provider: "all"`; the existing `parallel` provider remains the key-required REST API. A configured `parallelApiKey` or `PARALLEL_API_KEY` is sent as an optional Bearer token for higher MCP limits. To use MCP `web_fetch`, add `parallel-mcp` to `fetchRouting.providers` and set `fetchRouting.allowRemoteHostedProviders` to `true`; it is not part of the default fetch route.

Without an explicit `$` or `!` source, `OPENAI_API_KEY`, `BRAVE_API_KEY`, `PARALLEL_API_KEY`, `TINYFISH_API_KEY`, `SEARCH1API_KEY`, `SEARCHINFINITY_API_KEY`, `QUERIT_API_KEY`, `TAVILY_API_KEY`, `JINA_API_KEY`, `SERPDIVE_API_KEY`, `KAGI_API_KEY`, `BOCHA_API_KEY`, `OLLAMA_API_KEY`, `SERPBASE_API_KEY`, `SERPER_API_KEY`, `ANYSEARCH_API_KEY`, `XCRAWL_API_KEY`, `VALYU_API_KEY`, `XAI_API_KEY`, `MISTRAL_API_KEY`, `BRIGHTDATA_API_KEY`, `FIRECRAWL_API_KEY`, `EXA_API_KEY`, `GEMINI_API_KEY`, `DATALAB_API_KEY`, `DATALAB_PROCESSING_LOCATION`, `DATALAB_MODE`, `DATALAB_API_BASE`, `PERPLEXITY_API_KEY`, `GOOGLE_GEMINI_BASE_URL`, and `CLOUDFLARE_API_KEY` env vars retain their existing precedence over literal config file values. `openaiResponsesUrl` can point OpenAI `web_search` and `source_check` at a third-party gateway that supports the OpenAI Responses API and web search tool; it is an explicit endpoint override, not derived from Pi model provider settings, and defaults to `https://api.openai.com/v1/responses`. `openaiSearchModel` pins the model id used for OpenAI `web_search`, bypassing automatic selection (newest terra-tier model); the id is sent verbatim with whichever OpenAI auth resolves, so gateway-only model ids work too. `xaiSearchModel` similarly pins the xAI search model. `openaiSearchProviders` sets which Pi model providers OpenAI `web_search` resolves login credentials from, in priority order; it defaults to `["openai-codex", "openai"]`, entries that are not registered or not signed in are skipped, and an empty array skips Pi credentials entirely so the `openaiApiKey` / `OPENAI_API_KEY` fallback applies. Useful for choosing between multiple Codex accounts (for example a second account registered by an extension) or forcing API-key billing while signed into Codex. Configured Exa API keys use Exa's own account limits directly; any legacy local `exa-usage.json` file is ignored. `GOOGLE_GEMINI_BASE_URL` overrides the Gemini API host for Gemini generate-content calls such as search, URL context, YouTube, and local video analysis. Set it to a bare host with no trailing slash and no version segment, for example `https://my-gateway.example.com/gemini`; `geminiBaseUrl` is the config-file equivalent. When the configured host contains `gateway.ai.cloudflare.com`, authentication uses `cf-aig-authorization: Bearer <token>` from `CLOUDFLARE_API_KEY` or `cloudflareApiKey`, and `GEMINI_API_KEY` is not required for generate-content calls. Alternatively, set `geminiAuth` to `"adc"` to authenticate Gemini generate-content calls with Google Application Default Credentials (ADC) instead of an API key; calls go to the Vertex AI endpoint (`aiplatform.googleapis.com`) with an OAuth bearer token minted from the ADC file (`GOOGLE_APPLICATION_CREDENTIALS` or `~/.config/gcloud/application_default_credentials.json`, i.e. `gcloud auth application-default login`). `geminiProject`/`geminiLocation` set the Vertex project and location and fall back to the `GOOGLE_CLOUD_PROJECT`/`GOOGLE_CLOUD_LOCATION` (or `GCLOUD_PROJECT`) env vars; project and location are required. ADC supports `authorized_user` (OAuth refresh token) and `service_account` (JWT assertion) credential files, and tokens are cached and refreshed from expiry. ADC mode covers search, URL context, and PDF/inline-data extraction; YouTube and local video analysis still go through the Gemini Files API, so they fall back to Gemini Web unless a `GEMINI_API_KEY` is also configured. The access token is treated as a credential and is redacted from errors. Local video file upload still uses Google's Files API directly, so gateway-only video extraction falls back to Gemini Web unless a `GEMINI_API_KEY` is also configured. `provider` or `searchProvider` sets the default search provider and is used when a tool call omits `provider` or sends `"auto"`: `"all"`, `"openai"`, `"brave"`, `"parallel"`, `"parallel-mcp"`, `"tinyfish"`, `"search1api"`, `"searchinfinity"`, `"querit"`, `"tavily"`, `"firecrawl"`, `"jina"`, `"serpdive"`, `"kagi"`, `"bocha"`, `"ollama"`, `"anysearch"`, `"xcrawl"`, `"valyu"`, `"xai"`, `"mistral"`, `"brightdata"`, `"serpbase"`, `"serper"`, `"searxng"`, `"exa"`, `"perplexity"`, or `"gemini"`. Parallel MCP, AnySearch, XCrawl, Valyu, xAI, Mistral, Bright Data, SerpBase, and Serper are never selected by `auto`; choose them explicitly or place them in `searchRouting`. If either single-provider field is configured, it takes precedence over `searchRouting`. Otherwise, `searchRouting` can opt into an ordered `providers` list and an explicit `fallbackOn` list containing `"transient"`, `"quota"`, `"network"`, and/or `"invalid-response"`; only those typed failures continue to the next available candidate. `"all"` is not valid inside `searchRouting.providers`, because that list defines sequential fallback rather than multi-provider aggregation. Named providers remain strict, and exhausted routes return per-provider diagnostics. `provider` can also be a non-empty array of named providers such as `["brave", "exa"]`; those providers run concurrently using the same aggregation path as `"all"`, while `"auto"` and `"all"` are invalid inside arrays. Random, weighted, sticky, and cooldown routing are not enabled. This is also updated automatically when you change the provider in the curator UI. Set `webSearch.enabled` to `false` to unregister the configured search and source-check tools while leaving fetch/content tools available. `toolNames` can opt into alternate public tool names for environments where another extension or model reserves the defaults, without changing behavior: `webSearch`, `sourceCheck`, `fetchContent`, and `getSearchContent` default to `web_search`, `source_check`, `fetch_content`, and `get_search_content`. `workflow` sets the default search workflow: `"summary-review"` (default, opens curator with auto-generated summary draft), `"auto-summary"` (returns a model-generated summary without opening the browser curator), or `"none"` (raw results, no curator). Overridden per-call via the `workflow` parameter on the configured search tool, or toggled at runtime with `/curator`. `browserCookies.profile` pins Gemini Web cookie lookup to a specific Chromium profile. When omitted, detected Chromium profiles are scanned in stable order and the first profile containing the required Gemini cookies is used. macOS discovery supports Helium, Chrome, Brave, and Arc; Linux discovery supports Chromium and Chrome. `allowBrowserCookies` enables Chromium cookie extraction for Gemini Web; it defaults to `false` to avoid browser data access and surprise macOS Keychain prompts. You can also set `PI_ALLOW_BROWSER_COOKIES=1`. Cookie databases are copied to a temporary read-only working copy; the reader uses `node:sqlite` when available and otherwise tries the `sqlite3` CLI or Python's standard-library SQLite module. `searchModel` overrides the Gemini API model used by the configured search tool without changing URL, YouTube, or video extraction defaults. Gemini API grounded search uses `gemini-3.6-flash` by default; set `searchModel` to choose another model. Gemini Web browser-cookie fallback uses its separate `gemini-3.1-pro` default because Gemini Web relies on private header values; explicitly configured unsupported Web models fail instead of silently falling back to 2.5 Flash. `summaryModel` sets the default model used for generating summary drafts in the curator UI and `auto-summary` mode (e.g. `"anthropic/claude-haiku-4-5"`, `"openai-codex/gpt-5.3-codex-spark"`, or `"openrouter/nvidia/nemotron-3-super-120b-a12b:free"`). Preferred summary and query-rewrite models also resolve through routed provider registrations such as OpenRouter when the native provider is unavailable. When Pi `enabledModels` is configured, summaries are limited to that allowlist; if no enabled summary model is available, the tool returns a deterministic summary instead of calling an unrelated model. `summaryGenerationDeadlineMs` sets the maximum time for one summary model attempt in the curator UI and `auto-summary` mode. It defaults to `30000`, must be a positive integer, and is capped at `600000`. `maxInlineContentChars` sets the direct `fetch_content` content slice and the default and maximum `get_search_content` slice. It defaults to `30000`, must be a positive integer, and is capped at `200000`; full fetched content remains stored for later retrieval. `curatorTimeoutSeconds` controls the initial curator idle timeout (default `20`, max `600`); users can still adjust the timer in the curator UI. `ssrf.allowRanges` lists CIDR ranges (e.g. `"198.18.0.0/15"`, `"fd00::/8"`) exempted from the SSRF guard that otherwise blocks private/reserved IP ranges. This unblocks `fetch_content`/`web_search` on hosts whose network proxy runs in TUN + fake-IP mode (Surge, Clash, Mihomo, Stash, ...), where public domains resolve into a synthetic reserved range. It is **off by default** — the guard stays fully enabled unless you list ranges here. Use the narrowest range that covers your proxy's fake-IP pool. All-address CIDRs such as `0.0.0.0/0` and `::/0` are rejected. `ssrf.trustEnvProxy` is a separate opt-in for sandboxed environments with valid HTTP(S) proxy env vars; it skips local DNS preflight only for proxied hostnames and still blocks localhost, literal private IP targets, and `NO_PROXY` matches. It does not configure proxy transport.
### Kimi Code Plan

Run `/login kimi-coding` in Pi and complete sign-in for an active Kimi Code Plan. Then select `provider: "kimi"`, include `"kimi"` in an explicit provider array, or add it to `searchRouting.providers`. The extension resolves a model with provider `kimi-coding` from Pi's model registry and reuses Pi's refreshed OAuth credential; no Moonshot Open Platform key is configured here.

Kimi search calls `POST https://api.kimi.com/coding/v1/search` with the query as `text_query`. This is the Kimi Code Plan search service, not Moonshot Open Platform `$web_search`. The endpoint exposes no native recency parameter, so `recencyFilter` is unsupported and is not sent. Shared `domainFilter` and `numResults` behavior is enforced locally on the returned `search_results`.

Kimi is explicit-only: it is never chosen by `auto` and never participates in `provider: "all"`. Search usage is drawn from the Kimi Code Plan's shared subscription quota, while the response reports no per-request usage. Excluding Kimi from automatic fan-out prevents one search from consuming opaque plan quota without an explicit choice.

### All providers

Set `provider: "all"` on `web_search` or `source_check`, or configure `"provider": "all"` as the default, to run the same query against every eligible search provider simultaneously. Parallel MCP, DuckDuckGo, Kimi, AnySearch, XCrawl, Valyu, xAI, Mistral, Bright Data, SerpBase, and Serper are always excluded because they are explicit-only; Bright Data, SerpBase, and Serper are paid Google SERP providers, while Kimi and Mistral may consume account quota or paid search-tool usage, so `all` never spends either resource without an explicit request. Exa remains eligible through its zero-config MCP path, OpenAI can use Pi auth, and other API-backed search providers participate when their API key, local endpoint, or gateway makes them available. Browser-cookie access alone does not opt Gemini into `all`; select Gemini explicitly or configure its API/gateway.

Successful provider answers are preserved separately while source URLs and inline content are deduplicated, and one provider failure does not discard the other results. If every participating provider fails, the tool returns per-provider diagnostics. Configured Firecrawl participates in `all` like other eligible providers. In the Curator, **All** can also be selected like the other provider buttons. Each participating provider gets its own result card, including a provider badge and independent selection checkbox; failed providers get their own disabled error card. The final summary is generated from the selected provider cards and is what Pi receives. Outside the Curator, the same provider answers remain available as labeled sections in one tool response.

### Jina Search

`jinaApiKey` enables [Jina Search](https://s.jina.ai); alternatively, set `JINA_API_KEY`. The key may be a literal, an environment-variable reference, or a trusted command credential source:

```json
{
  "jinaApiKey": "$JINA_API_KEY",
  "provider": "jina"
}
```

Setting `provider` is optional. In `auto` mode, Jina is tried after Firecrawl and before SERPdive. It can also be selected per request with `provider: "jina"`, included in provider arrays or `provider: "all"`, or placed in `searchRouting.providers`.

Jina Search maps `numResults` to its bounded `count` parameter, sends included domains as `site` filters, and adds excluded domains and recency constraints to the search query. Without `includeContent`, it requests SERP metadata only. With `includeContent: true`, Jina visits matching pages and returns their Markdown inline, so requests can take longer and consume more Jina tokens. The fixed hosted endpoint is `https://s.jina.ai`; no custom endpoint is configured by this extension.

### TinyFish

`tinyfishApiKey` enables the TinyFish Search and Fetch APIs; alternatively, set `TINYFISH_API_KEY`. Get an API key from the [TinyFish API Keys](https://agent.tinyfish.ai/api-keys) page. Like the other provider keys, `tinyfishApiKey` can contain a literal key, an environment-variable reference, or a trusted command credential source:

```json
{
  "tinyfishApiKey": "$TINYFISH_API_KEY",
  "provider": "tinyfish"
}
```

Setting `provider` is optional. In `auto` mode, an available TinyFish provider is tried after Parallel and before Search1API. You can also select it per request with `provider: "tinyfish"` or place `"tinyfish"` in `searchRouting.providers`.

TinyFish Search supports the shared `numResults`, `recencyFilter`, and include/exclude `domainFilter` options. Requests above 10 results use TinyFish pagination. When `includeContent` is true, result URLs are sent to TinyFish Fetch in batches of up to 10 and returned as inline Markdown content. TinyFish Fetch is also used as a hosted `fetch_content` fallback after Jina Reader and before Search1API.

The stable Search (`https://api.search.tinyfish.ai`) and Fetch (`https://api.fetch.tinyfish.ai`) endpoints are built in, so no base URL setting is required. TinyFish currently documents both APIs as credit-free, with Free-plan limits of 30 search requests per minute and 150 fetched URLs per minute; an API key is still required. See the [TinyFish Search reference](https://docs.tinyfish.ai/search-api/reference) and [TinyFish Fetch reference](https://docs.tinyfish.ai/fetch-api/reference).

### Search1API

`search1apiApiKey` enables [Search1API](https://www.search1api.com) Search and Crawl; alternatively, set `SEARCH1API_KEY`. Create a key in the [Search1API dashboard](https://dashboard.search1api.com). Like the other provider keys, `search1apiApiKey` can contain a literal key, an environment-variable reference, or a trusted command credential source:

```json
{
  "search1apiApiKey": "$SEARCH1API_KEY",
  "provider": "search1api"
}
```

Setting `provider` is optional. In `auto` mode, an available Search1API provider is tried after TinyFish and before Searchinfinity. You can also select it per request with `provider: "search1api"`, include it in provider arrays or `provider: "all"`, or place `"search1api"` in `searchRouting.providers`.

Search1API Search supports the shared `numResults`, `recencyFilter`, and include/exclude `domainFilter` options. When `includeContent` is true, it maps to Search1API Deep Search and returns successfully crawled result content inline. The Search1API Crawl endpoint is also used as a hosted `fetch_content` fallback after Jina Reader and TinyFish, before Parallel.

Search1API is credit-based. A basic search costs 1 credit; Deep Search adds 1 credit for each result page crawled successfully, and a Crawl request costs 1 credit. The extension never enables Deep Search unless `includeContent` is true. See the [Search API guide](https://www.search1api.com/docs/basic/search), [Crawl API guide](https://www.search1api.com/docs/basic/crawl), and [credit rules](https://www.search1api.com/docs/essentials/credits-and-limits).

### Searchinfinity

`searchinfinityApiKey` enables [Byteplus Searchinfinity](https://docs.byteplus.com/en/docs/searchinfinity/) web search (the Global edition of Volcengine 豆包搜索); alternatively, set `SEARCHINFINITY_API_KEY`. Create a key in the [Searchinfinity console](https://console.byteplus.com/search-infinity/api-key). Like the other provider keys, `searchinfinityApiKey` can contain a literal key, an environment-variable reference, or a trusted command credential source:

```json
{
  "searchinfinityApiKey": "$SEARCHINFINITY_API_KEY",
  "provider": "searchinfinity"
}
```

Setting `provider` is optional. In `auto` mode, an available Searchinfinity provider is tried after Search1API and before Querit. You can also select it per request with `provider: "searchinfinity"`, include it in provider arrays or `provider: "all"`, or place `"searchinfinity"` in `searchRouting.providers`.

Searchinfinity Search supports the shared `numResults` (max 20 per request), `recencyFilter`, and include/exclude `domainFilter` options (up to 5 domains each). Answers are assembled from the model-generated per-result summaries when present, falling back to plain snippets. Accounts include a monthly free search quota shared with the Custom edition; API Key requests are limited to 5 QPS and a 30-second server-side timeout. See the [Searchinfinity API reference](https://docs.byteplus.com/api/docs/searchinfinity/Searchinfinity_API_Reference).

### Querit

`queritApiKey` enables Querit Search and Contents; alternatively, set `QUERIT_API_KEY`. Create a key in the [Querit dashboard](https://www.querit.ai/en/dashboard/api-keys). Like the other provider keys, `queritApiKey` can contain a literal key, an environment-variable reference, or a trusted command credential source:

```json
{
  "queritApiKey": "$QUERIT_API_KEY",
  "provider": "querit"
}
```

Setting `provider` is optional. In `auto` mode, an available Querit provider is tried after Searchinfinity and before Tavily. You can also select it per request with `provider: "querit"`, include it in provider arrays or `provider: "all"`, or place `"querit"` in `searchRouting.providers`.

Search requests follow the official [`querit-python`](https://github.com/querit-ai/querit-python) models: `numResults` maps to `count`, include/exclude `domainFilter` values map to `filters.sites`, and recency maps to `filters.timeRange.date` (`d1`, `w1`, `m1`, or `y1`). When `includeContent` is true, result URLs are sent to `POST /v1/contents` in batches of up to 10 and returned as inline Markdown. The same Contents endpoint is used as a hosted `fetch_content` fallback after Search1API and before Parallel. Querit Search and Contents subscriptions are independent; an API key can search successfully while `/v1/contents` returns `403 No active contents subscription`.

### AnySearch

AnySearch is an explicit-only provider: it is never included in zero-config `auto` fallback or in `provider: "all"`, but it can be selected with `provider: "anysearch"`, configured as the named provider, or placed in `searchRouting`. It supports anonymous requests and optional `anysearchApiKey` / `ANYSEARCH_API_KEY` credentials. Requests intentionally send only `{ query, max_results }`; `recencyFilter`, `domainFilter`, and `includeContent` do not add API request parameters. When `includeContent` is true, returned `content` fields are exposed as inline content.

### XCrawl

XCrawl is an explicit-only provider: it is never included in zero-config `auto` fallback or in `provider: "all"`, but it can be selected with `provider: "xcrawl"`, configured as the named provider, or placed in `searchRouting`. It requires `xcrawlApiKey` / `XCRAWL_API_KEY` credentials ([dashboard](https://dash.xcrawl.com/)). Requests send `{ engine: "google_search", q }` to the SERP endpoint; `recencyFilter`, `domainFilter`, and `includeContent` do not add API request parameters, and the shared include/exclude `domainFilter` is applied client-side. A provider-side timeout surfaces as a retriable failure rather than caller cancellation. Results with a null title fall back to the result URL; result items expose their SERP snippet as usual.

### xAI (Grok)

xAI is an explicit-only provider: it is never included in zero-config `auto` fallback or in `provider: "all"`, but it can be selected with `provider: "xai"`, configured as the named provider, or placed in `searchRouting`.

It calls xAI's Agent Tools API — the hosted `web_search` tool, with opt-in `x_search`, on `https://api.x.ai/v1/responses` — so the search runs inside Grok's own inference rather than here. Auth resolves through Pi's model registry first, which means a **SuperGrok or X Premium subscription pays for its own searches** and no `xaiApiKey` has to be configured at all; `xaiApiKey` / `XAI_API_KEY` are the fallback for pay-as-you-go API keys.

Explicit-only is deliberate. A single question typically fans out to roughly a dozen `web_search` tool calls, billed at xAI's per-call tool rate on top of tokens and drawn from the same allowance the account uses for chatting. Letting `auto` or `all` reach for it would spend a subscription the user only meant to talk to. X Search is an additional opt-in because it sends the query to xAI's X search surface and may incur its own tool-call charges.

The model is chosen for you: the registry path walks a best-first candidate list and uses the first id Pi actually knows, so a retired model is skipped rather than sent. The API-key path has no registry to consult and starts at `grok-4.5` for the default web-only request. When `x_search` is enabled, the current xAI docs' `grok-4.6` example is preferred instead. `xaiSearchModel` pins the id explicitly on either path, which is the escape hatch if xAI retires a model before a release ships.

Requests send only `{ model, input, tools }`, the shape verified against a live subscription account. The default `xaiSearchTools` value is `["web_search"]`, preserving the existing behavior. To opt into X Search, set it to `["x_search"]` for X-only searches or `["web_search", "x_search"]` to expose both tools:

```json
{
  "xaiSearchTools": ["web_search", "x_search"]
}
```

The value must be a non-empty array containing each of `web_search` and `x_search` at most once. This intentionally does not expose per-call X handle, date, or media-understanding parameters until their request contract is stable. `recencyFilter`, `domainFilter`, and `numResults` remain prompt guidance rather than tool parameters, so an unrecognized field cannot turn a search into a 400. Sources are read in annotation-first order from `url_citation` annotations, raw `web_search_call`/`x_search_call` source lists when present, and xAI's response-level `citations` URL list.

xAI's older Live Search (`search_parameters` on `/v1/chat/completions`) is deprecated and now answers HTTP 410.

### Mistral Conversations

Mistral is an explicit-only provider. Set `mistralApiKey` or `MISTRAL_API_KEY`, then select `provider: "mistral"` or place `"mistral"` in `searchRouting.providers`; it is never chosen by `auto` and never participates in `provider: "all"`. Requests use direct HTTP `POST https://api.mistral.ai/v1/conversations` with bearer authentication and do not require the Mistral SDK.

The default model is `mistral-small-latest`; override it with `mistralSearchModel`. The default built-in tool is `web_search`. Set `mistralSearchTool` to `"web_search_premium"` only when your account is entitled to that potentially cost-sensitive premium search tool:

```json
{
  "mistralApiKey": "$MISTRAL_API_KEY",
  "mistralSearchModel": "mistral-small-latest",
  "mistralSearchTool": "web_search_premium",
  "provider": "mistral"
}
```

Mistral's Conversations response text becomes the synthesized answer, and `tool_reference` chunks become source results. References without a usable HTTP(S) URL are ignored, duplicate URLs are removed, and shared `numResults` and `domainFilter` limits are enforced locally. Recency, domain, and result-count guidance is included in the user prompt because Mistral's built-in tool does not expose those extension filter fields.

### Bright Data

Bright Data SERP is a **paid, third-party search proxy**: your query, its filters, and the result URLs
it turns up all pass through Bright Data's network. It is explicit-only — never included in zero-config
`auto` fallback and never in `provider: "all"` — so adding a token never starts spending on your
behalf, and one `all` search can never bill you for a Bright Data request. Select it with
`provider: "brightdata"`, set it as the named `provider`, or place `"brightdata"` in
`searchRouting.providers`. Naming it as the provider is never quietly redirected: if the Bright Data
settings are incomplete, the search reports that rather than curating through a different provider
under Bright Data's name. A `searchRouting` list is the exception, and it behaves there exactly as it
does for every other provider in the list: an unavailable entry is skipped and the next candidate
answers the query.

It needs two settings, and it reports itself unavailable until both are present — as does a zone name
it cannot use, so a typo makes Bright Data unavailable rather than breaking `web_search` for the
providers that are configured correctly:

```json
{
  "brightdataApiKey": "$BRIGHTDATA_API_KEY",
  "brightdataSerpZone": "pi_serp",
  "provider": "brightdata"
}
```

`brightdataApiKey` (or `BRIGHTDATA_API_KEY`) is your account API token from
[Bright Data → API tokens](https://brightdata.com/cp/setting/users). This extension uses one name per
field, matching every other provider here, so if you already export that token under a different
variable name, point at it explicitly rather than expecting an alias:
`"brightdataApiKey": "$BRIGHTDATA_API_TOKEN"`. Like the other provider keys it also accepts a
`!command` credential source, resolved once per request.

**Zones.** A Bright Data zone is a named, per-product configuration on your account; requests are made
against a zone and billed to it. `brightdataSerpZone` (or `BRIGHTDATA_SERP_ZONE`) must name a zone of
type **`serp`**, created at
[Bright Data → proxies and scraping infrastructure](https://brightdata.com/cp/zones). A Web Unlocker
zone (type `unblocker`) is a different Bright Data product, priced differently, and it does not return
SERP JSON: point this setting at one and the request is still made and billed, and whatever comes back
is reported as an error rather than as zero results — an envelope with no `organic` array names the
wrong zone type as the likely cause. The two zone types are never substituted for one another. There
is deliberately no default, and no fallback to any other Bright Data zone setting you may have
configured: guessing a zone name would bill the wrong product. Every request carries the zone, and
every error about a request that was billed names it, because "which zone did I pay on" is the first
question a paid failure has to answer. The messages that name no zone are the ones with nothing to
attribute — a missing token, a rejected zone value, a config file that could not be read, or a
connection that never returned a response.

**Getting a token and a zone.** Sign up at [brightdata.com](https://brightdata.com); no credit card is
required, and adding one is a verification step only. Connecting Bright Data's MCP server to your agent
is the shortest path to a working setup: it provisions the zones for you and they draw on the same
monthly free credits. Then put the SERP zone's name in `brightdataSerpZone`. This extension does not
know or guess those names — a zone must be configured explicitly, so a stray `BRIGHTDATA_API_KEY` in
your environment cannot make Bright Data available, and nothing can be billed against a zone that may
not exist on your account.

**Cost.** One search is one billable Bright Data request against that zone, charged whether or not the
results are useful. `numResults` does not change that: one query is one request no matter how many
results come back, so a slightly larger page size is requested to leave room for local filtering.
Bright Data's free tier is 5,000 credits per month with no credit card required, and it covers the SERP
API this provider uses; credits reset to 5,000 on the first of each month and unused credits are
forfeited. Billing is a pre-paid wallet model — you are only ever charged for funds you have
explicitly deposited, and when the free credits are exhausted requests return an error rather than
incurring a charge — so accidental spend is not possible without a deliberate deposit. Two caveats:
the free credits do not cover proxy products (Datacenter / ISP / Residential) or the Browser API, none
of which this provider uses; and accounts already on custom pay-as-you-go pricing or a pre-commit plan
are not eligible for the monthly credits. An account that has never deposited funds is also capped at
1,000 requests per minute. See
[free tier](https://docs.brightdata.com/general/account/billing-and-pricing/free-tier) and
[brightdata.com/pricing](https://brightdata.com/pricing).

**Privacy.** Your query text, your `domainFilter` and `recencyFilter` values, and the ranked URLs the
search turns up are all visible to Bright Data, which runs the Google search from its own network on
your behalf. Use SearXNG instead if queries must not leave infrastructure you control. Bright Data
holds ISO/IEC 27001, 27017 and 27018 certification, SOC 2 Type II and SOC 3, states that it does not
sell or license customer data to any third party, and will delete customer data on request; traffic is
TLS 1.3 in transit and AES-256 at rest. Its published security documentation does not state a retention
period for request data itself — the queries and URLs sent — and nothing here claims one:
[security and privacy overview](https://docs.brightdata.com/general/security/security-overview#privacy-&-regulatory-compliance).

**What the request looks like.** A Google search URL — carrying your query, `site:` operators, Google's
`tbs` time filter, and `brd_json=1` — is submitted to `https://api.brightdata.com/request` with
`{ zone, format: "raw", data_format: "parsed_light" }`. Bright Data returns the SERP as JSON and this
extension reads its `organic` array.

**Filters reach the engine.** Unlike providers with no filter parameters, both shared filters are
expressed to Google itself:

- **Recency is a real filter.** `recencyFilter` maps to Google's `tbs=qdr:d|w|m|y`, so pages outside the
  window are not returned at all — not a ranking hint.
- **Domain filters are `site:` operators.** Includes become `site:example.com` (multiple includes are
  OR-ed), excludes become `-site:example.com`. Google honours these loosely, so the same filter is
  applied again to the results that come back; a host you excluded never reaches the caller.

**Output contract.** A SERP zone returns ranked links, so results are `{ title, url, snippet }` mapped
from `organic[].{title, link, description}` and the `answer` is assembled from those sources, the same
way Brave and SearXNG answers are assembled. There is no API-side answer synthesis. `includeContent` is
accepted and has no effect: `parsed_light` carries no page bodies, so `inlineContent` is never returned
and no second billable request is made behind your back. Entries with no link, and hosts your filters
exclude, are skipped.

**Failures are never silent.** A non-2xx response throws
`Bright Data API error <status> for zone <zone>` with the response body redacted of your token, so
`402`/`429` classify as `quota` and `401`/`403` as `auth` for `searchRouting.fallbackOn`. Every billed
`200` this extension cannot read throws as well, because the request was paid for and an empty result
list would report it as "the web had no answer":

- **not JSON at all** — Google's "unusual traffic" interstitial reaches you as the raw proxied body,
  quoted to the first 300 characters rather than reduced to `Unexpected token <`;
- **JSON, but Bright Data's own error envelope** — `format: "raw"` means failures like
  `{"error":"zone not found","code":"zone_missing"}` arrive with HTTP 200, and the reported message
  repeats what Bright Data said and the code it said it with;
- **JSON, but not a SERP** — an envelope with no `organic` array is reported as such, naming the
  likeliest cause (a zone that is not of type `serp`), rather than as zero results.

Quoted upstream text cannot impersonate this extension's own diagnostics, in either of the two ways
routing reads them. It cannot impersonate a status: a proxied page mentioning "Error 503" is quoted as
`upstream 503`, and because the quoted text is truncated before it is rewritten, a body engineered so
that the length cut turns a longer number into a three-digit one cannot manufacture a status either.
It cannot impersonate a rate-limit phrase: those are quoted as `upstream rate-limit notice`, so a page
saying "you have exceeded your rate limit" cannot make a billed request look like a quota failure. The
number and the wording still reach you; only this extension's own text decides how the failure is
classified. A billed `200` therefore surfaces as an unreadable-response error. It is not retried by
default; it only falls through a configured route when you explicitly include
`"invalid-response"` in `searchRouting.fallbackOn`.

Your token is removed from every quoted response body, error message and activity log line before it
is shown, and no prefix of it survives either: the parser's own message, which quotes the first
characters of a body back inside itself, is dropped rather than filtered. `web-search.json` gets the
same treatment from the other direction: if the file is not valid JSON, the error names the file, and
the parse position where the parser reports one, but repeats none of the file's own text, since that
text is where your credentials live.

A missing or malformed zone, and a missing token, all fail before any request is made. A malformed
zone is a request-path error only — it makes Bright Data report itself unavailable, and never
propagates out of provider availability into an unrelated provider's search.

Searches use a 60-second timeout and honour cancellation: aborting a `web_search` aborts the in-flight
Bright Data request rather than waiting for it.

### SERPdive

`serpdiveApiKey` enables the SERPdive provider; get a key at [serpdive.com](https://serpdive.com/dashboard/keys). `serpdiveModel` (or `SERPDIVE_MODEL`) picks the retrieval depth:

| Model | Cost | What comes back |
| --- | --- | --- |
| `krill` (default) | free, fair use | Extracted page content. No API-side answer synthesis — the answer is assembled from the sources, as for Brave and SearXNG. |
| `mako` | 1 credit | The fact-carrying sentences of each page, plus a synthesized answer. |
| `moby` | 1.5 credits | The full readable content of every page, plus a cited answer. |

The model is the only thing that decides retrieval depth: `includeContent` controls whether that content is also returned inline, it never changes the model. For full page text, set `serpdiveModel` to `moby` yourself. The default is the free tier on purpose: installing this provider never starts spending on your behalf. An unrecognised value falls back to `krill` rather than failing, so a typo cannot cost money. Current pricing: [serpdive.com/pricing](https://serpdive.com/pricing).

Two behaviours worth knowing, both consequences of the API surface:

- **Recency is a hint, not a filter.** SERPdive exposes no time-range parameter. `recencyFilter` is appended to the question ("past week"), which biases ranking toward recent pages; results outside the window can still come back.
- **Domain filters are applied locally.** SERPdive has no include/exclude domain parameter, so `domainFilter` is applied to the results that come back. It can narrow a page of results, not ask the engine for more from a given domain.

`numResults` maps to `max_results`, which the API treats as a cap between 1 and 10 — never a minimum. Values above 10 are clamped; the engine returns what it judges relevant, which is often fewer.

### Remote curator access

By default the curator HTTP server binds to `127.0.0.1` and hands out a `http://localhost:<port>/?session=<token>` URL, so it is reachable only from the machine running Pi. That is the right default and nothing below changes it unless you opt in.

Opt in when Pi runs somewhere other than where your browser is — a dev box you SSH into, a container, a remote workstation on a Tailscale/WireGuard network:

```json
{
  "curatorRemote": true
}
```

`true` derives both values: the URL host becomes `os.hostname()` and the server binds `0.0.0.0`. Either can be overridden, and you should usually override `bind`:

```json
{
  "curatorRemote": {
    "host": "my-box.tailnet.ts.net",
    "bind": "100.101.102.103"
  }
}
```

| Value | URL host | Bind address |
| --- | --- | --- |
| omitted or `false` | `localhost` | `127.0.0.1` |
| `true` | `os.hostname()` | `0.0.0.0` |
| `{ "host": "h" }` | `h` | `0.0.0.0` |
| `{ "bind": "b" }` | `os.hostname()` | `b` |
| `{ "host": "h", "bind": "b" }` | `h` | `b` |

Anything else — a string, `null`, an array — is treated as not configured and stays local.

`host` only changes the URL that gets printed; `bind` is what actually determines who can reach the server. Set them to a matching pair — a `host` that does not resolve to the interface you bound produces a link that looks right and does not load.

**Security.** Enabling this exposes the curator beyond the local machine, and `bind: "0.0.0.0"` exposes it on every interface, including untrusted networks. The only access control is the unguessable session token in the URL, carried over plain HTTP with no TLS — so the token and everything you curate are readable by anyone able to observe that traffic. Anyone who reaches the port with the token can run searches against your configured providers (spending your API credits) and edit the summary that gets returned into the agent's context. Prefer binding to one private-network interface, as in the example above, over `0.0.0.0`, and treat the curator URL as a secret. The server is short-lived — it exists only for the duration of a curation session — but it is unauthenticated apart from that token.

Remote curator sessions print the URL instead of trying to open a browser by default. Turning remote access on also raises the default curator idle timeout from 20 to 60 seconds, giving you time to notice and click that link; set `curatorTimeoutSeconds` explicitly to override. If you do want Pi to launch a browser on the remote host anyway, set `autoOpenBrowser: true` explicitly.

#### Disabling browser auto-open

`autoOpenBrowser` is also useful on its own for local sessions:

```json
{
  "autoOpenBrowser": false
}
```

When `false`, the extension never tries to open a Glimpse window or a browser and always prints the URL for you to open manually. For local-only sessions it defaults to `true`; remote curator sessions print the URL unless you set `autoOpenBrowser: true` explicitly. This is worth setting locally when you would rather paste the link into a specific browser than have one launched for you. It changes nothing about where the server binds; that is `curatorRemote`'s job alone.

### Shortcuts

Both shortcuts are configurable via `~/.pi/web-search.json`:

```json
{
  "shortcuts": {
    "curate": "ctrl+shift+s",
    "activity": "ctrl+shift+w"
  }
}
```

Values use the same format as pi keybindings (e.g. `ctrl+s`, `ctrl+shift+s`, `alt+r`). Changes take effect on next pi restart.

Set `"enabled": false` under `tools`, `commands`, `image`, or `pdf` to disable that feature. Tool-specific settings override the legacy `webSearch.enabled` shorthand; without an override, it still disables `web_search` and `source_check`. `image.enabled: false` blocks direct image fetches and video frame extraction, and prevents video thumbnails. `pdf.enabled: false` blocks PDF extraction. For GitHub specifically, `githubClone.enabled: false` only skips clone/API specialization, and `githubPrIssue.enabled: false` only skips PR/issue specialization; neither setting unregisters `fetch_content` or blocks generic URL extraction. Pi restart is required for tool and command registration changes.

Rate limits: Perplexity is capped at 10 requests/minute (client-side). Jina Search, TinyFish, Search1API, and Searchinfinity apply the plan limits documented by their APIs. Querit Search and Contents subscriptions are independent. Content fetches run 3 concurrent; direct HTTP fetches and Jina Reader use a 30s timeout by default, configurable together with `fetch.timeout` in seconds. Remote extraction fallbacks carry their own budgets and are not covered by that setting: Firecrawl 60s, Kagi Extract 60s, Ollama Web Fetch 60s, Bright Data Web Unlocker 60s, TinyFish up to 150s, Gemini 120s, Datalab 120s (capped at 300s, rate-limited to 25 requests/minute on the free tier). `pdf.maxSizeMB` defaults to 20 and is capped at 50. `pdf.maxPages` defaults to 100 and limits every PDF provider to the first N pages.

## Limitations

- If the curator cannot open a browser automatically, such as in Docker, WSL, SSH, or headless environments, the running curator URL is shown in the tool output. Copy it into a browser that can reach the Pi host, or use a tunnel/port-forward when needed.
- Chromium cookie extraction for Gemini Web is opt-in via `allowBrowserCookies: true` or `PI_ALLOW_BROWSER_COOKIES=1`; no browser data or password store is touched while it is disabled. On macOS, enabling it may trigger a Keychain dialog. On Windows, Chrome and Edge v10 cookies use the current user's DPAPI key; v20 app-bound cookies are not supported. Required cookie names are checked before password-store access, and browser encryption passwords are cached only in-process. If `node:sqlite` is unavailable, the reader falls back to the `sqlite3` CLI or Python stdlib; `/google-account` reports sanitized browser/profile attempts and classifies SQLite, profile, missing-cookie, password-store, and decryption failures.
- YouTube private/age-restricted videos may fail on all extraction paths.
- Gemini can process videos up to ~1 hour; longer videos may be truncated.
- PDFs are text-extracted only (no OCR for scanned documents).
- GitHub branch names with slashes may misresolve file paths; the clone still works and the agent can navigate manually.
- GitHub wiki, discussion, and other non-code pages still fall through to normal web extraction. PR review-thread resolution state is unknown in the specialized PR view, and REST fallback omits checks.

<details>
<summary>Files</summary>

| File | Purpose |
| ------ | --------- |
| `index.ts` | Extension entry, tool definitions, commands, widget |
| `curator-page.ts` | HTML/CSS/JS generation for the curator UI with markdown rendering |
| `curator-server.ts` | Ephemeral HTTP server with SSE streaming and state machine |
| `summary-review.ts` | Summary prompt construction, model-based draft generation, and deterministic fallback summary |
| `openai-search.ts` | OpenAI Responses API web search provider with Codex/API-key auth |
| `brave.ts` | Brave Search API provider |
| `parallel.ts` | Parallel search provider and extraction fallback |
| `brightdata-unlocker.ts` | Bright Data Web Unlocker extraction fallback |
| `tinyfish.ts` | TinyFish Search and Fetch API provider |
| `search1api.ts` | Search1API Search and Crawl API provider |
| `searchinfinity.ts` | Byteplus Searchinfinity search provider |
| `querit.ts` | Querit Search and Contents API provider |
| `tavily.ts` | Tavily Search API provider |
| `firecrawl.ts` | Firecrawl search provider and extraction fallback |
| `jina-search.ts` | Jina Search API provider |
| `serpdive.ts` | SERPdive Search API provider |
| `kagi.ts` | Kagi Search API provider and Extract API fallback |
| `ollama.ts` | Ollama Cloud Web Search provider and Web Fetch fallback |
| `brightdata.ts` | Explicit-only Bright Data SERP search provider |
| `serpbase.ts` | Explicit-only SerpBase Google SERP provider |
| `serper.ts` | Explicit-only Serper Google SERP provider |
| `anysearch.ts` | Explicit-only AnySearch search provider |
| `xcrawl.ts` | Explicit-only XCrawl search provider |
| `valyu.ts` | Explicit-only Valyu research search provider |
| `xai-search.ts` | Explicit-only xAI (Grok) hosted web/X search provider |
| `mistral-search.ts` | Explicit-only Mistral Conversations web search provider |
| `kimi-search.ts` | Explicit-only Kimi Code Plan search provider |
| `searxng.ts` | Self-hosted SearXNG JSON API search provider |
| `duckduckgo.ts` | Explicit-only keyless DuckDuckGo HTML search provider |
| `exa.ts` | Exa.ai search provider — direct API and MCP proxy |
| `extract.ts` | URL/file path routing, HTTP extraction, fallback orchestration |
| `content-find.ts` | Bounded exact, case-insensitive, and fuzzy passage lookup |
| `page-query.ts` | Grounded page-local answer generation with model context budgeting |
| `gemini-search.ts` | Single-provider, ordered-fallback, and simultaneous all-provider search aggregation |
| `gemini-url-context.ts` | Gemini URL Context + Web extraction fallbacks |
| `gemini-web.ts` | Gemini Web client (cookie auth, StreamGenerate) |
| `gemini-web-config.ts` | Gemini Web profile and browser-cookie opt-in config |
| `gemini-api.ts` | Gemini REST API client (generateContent) |
| `chrome-cookies.ts` | Chromium-based cookie extraction (macOS Keychain, Linux secret-tool, Windows DPAPI + SQLite) |
| `youtube-extract.ts` | YouTube detection, three-tier extraction, frame extraction |
| `video-extract.ts` | Local video detection, Files API upload, Gemini analysis |
| `github-extract.ts` | GitHub URL parsing, clone cache, content generation |
| `github-api.ts` | GitHub API fallback for large repos and commit SHAs |
| `github-issue-pr.ts` | GitHub PR and issue URL parsing, gh/REST fetch, markdown rendering |
| `perplexity.ts` | Perplexity API client with rate limiting |
| `datalab-pdf-extract.ts` | Datalab hosted PDF-to-Markdown conversion client (upload → convert → poll) |
| `pdf-extract.ts` | PDF text extraction, saves to markdown |
| `rsc-extract.ts` | RSC flight data parser for Next.js pages |
| `utils.ts` | Shared formatting and error helpers |
| `storage.ts` | Session-aware result storage |
| `activity.ts` | Activity tracking for the observability widget |

</details>
