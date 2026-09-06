# Pi Web Access - Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

## [0.28.0] - 2026-09-04

### Highlights

- Search X posts through xAI or choose Mistral for web searches.
- Batch searches run in parallel for faster multi-query research.
- Follow-up retrieval can access stored search results, and Perplexity keeps all cited sources.
- Web-tool proxy settings no longer affect unrelated Pi requests.

### Added

- Documented the Linux `xdg-utils` dependency for automatic curator browser launch and the manual URL fallback. Thanks to [@wickedTangent](https://github.com/wickedTangent) for issue #336 and PR #337.
- Added opt-in X post search through xAI alongside web search, configured with `xaiSearchTools`. Thanks to [@Jerry2003sky](https://github.com/Jerry2003sky) for issue #342.
- Added Mistral web search with `provider: "mistral"`, using `mistralApiKey` / `MISTRAL_API_KEY` credentials. Premium web search is available as a separate opt-in. Thanks to [@jaudiger](https://github.com/jaudiger) for issue #346.

### Changed

- Run batch searches in parallel with a concurrency limit, keeping results in query order and preserving provider fallback. Thanks to [@Noir-Lime](https://github.com/Noir-Lime) for PR #345.

### Fixed

- Included `responseId` in search output so the model can retrieve stored results with `get_search_content`. Thanks to [@axelbaumlisto](https://github.com/axelbaumlisto) for PR #354.
- Fixed flaky tests on slower Node startups. Thanks to [@axelbaumlisto](https://github.com/axelbaumlisto) for PR #353.
- Kept all sources cited in Perplexity answers, even beyond `numResults`. Answers without citations still respect the result limit. Thanks to [@schlessera](https://github.com/schlessera) for issue #340 and PR #341.
- Limited configured proxies to web-tool requests so unrelated Pi requests are unaffected. Thanks to [@alexei-ciobanu](https://github.com/alexei-ciobanu) for PR #339 and [@mystery4f](https://github.com/mystery4f) for PR #343.
- Cleaned up abandoned GitHub clone directories after crashes, only when their owning process is confirmed dead. Thanks to [@yazanabuashour](https://github.com/yazanabuashour) for issue #331.
- Kept using an existing `~/.pi/web-search.json` when `XDG_CONFIG_HOME` is set but no config file exists there. Thanks to [@hu3rror](https://github.com/hu3rror) for issue #333.

## [0.27.0] - 2026-08-28

### Highlights

- `fetch_content` now lets you tune direct HTTP and Jina Reader timeouts from config.
- Answer mode can use a configured default model while still allowing per-call overrides.
- HTML fallback parsing is quieter for pages with relative canonical links.
- GitHub repository fetching is safer when more than one Pi process is running.

### Added

- Added opt-in `fetch.timeout` configuration in seconds for the direct HTTP and Jina Reader `fetch_content` paths, with per-call timeout overrides taking precedence. Thanks to [@linuxtextadventurer](https://github.com/linuxtextadventurer) for PR #327.
- Added opt-in `fetch.answerProvider` and `fetch.answerModel` defaults for `fetch_content` answer mode, with per-call `answerModel` overrides taking precedence. Thanks to [@linuxtextadventurer](https://github.com/linuxtextadventurer) for PR #328.

### Fixed

- Set the Defuddle fallback document URL before parsing pages with relative canonical links, preventing `ERR_INVALID_URL` warnings. Thanks to [@bin115885](https://github.com/bin115885) for issue #322.
- Isolated GitHub clone workdirs per extension runtime so cleanup in one process cannot delete another process's clone. Thanks to [@MDGChamomile](https://github.com/MDGChamomile) for PR #323.


## [0.26.0] - 2026-08-28

### Highlights
- `web_search` now includes XCrawl as an explicit search provider.
- XCrawl results now produce safer clickable links, including relative redirect links from the API.
- Local models can send multiple web-search queries as a JSON string and still get separate searches.
- HTML fallback extraction is quieter and more accurate when Defuddle cannot process a page.

### Added

- Added XCrawl as an explicit-only search provider (`provider: "xcrawl"`) with `xcrawlApiKey` / `XCRAWL_API_KEY` credentials, client-side domain filtering, fallback titles, and retriable provider-timeout errors. Thanks to [@zeroicey](https://github.com/zeroicey) for #312 and #313.

### Changed

- Refined the XCrawl provider docs, parser shape, availability metadata, and focused tests.

### Fixed

- Expanded JSON-array strings supplied in the singular `web_search` `query` field into independent searches, with a clear no-query error for empty arrays. Thanks to [@alex-rs](https://github.com/alex-rs) for #317 and [@zeroicey](https://github.com/zeroicey) for PR #319.
- Kept Defuddle selector-processing failures out of the Pi console and stopped treating the raw page body as a successful extraction. Thanks to [@riabiy](https://github.com/riabiy) for #315.
- Resolved API-origin-relative XCrawl result links to absolute URLs and rejected blank result links instead of emitting fabricated source URLs. Thanks to [@zeroicey](https://github.com/zeroicey) for #318.

## [0.25.0] - 2026-08-25

### Highlights
- `web_search`, `source_check`, and `fetch_content` can now use an explicit HTTP(S) proxy for restricted networks.
- `fetch_content` now gives useful GitHub PR and issue summaries, including comments, review threads, anchors, and truncation markers.
- Gemini users can choose browser cookie profiles more predictably and can use Google Application Default Credentials for Gemini generate-content calls.
- Kimi Code Plan users can run explicit Kimi web searches through Pi's `kimi-coding` login.
- HTML extraction, missing-page guidance, and stored-content lookup are more reliable.

### Added
- Added an optional `proxy` parameter to `web_search`, `source_check`, and `fetch_content`. When set, search APIs, page fetches, and content extraction use `curl` through that proxy. Localhost and `NO_PROXY` hosts still bypass the proxy. A default proxy can also be set with `"proxy"` in `~/.pi/web-search.json`. Thanks to [@mystery4f](https://github.com/mystery4f) for PR #307.
- Added deterministic Chromium cookie selection with `browserCookies.browser` and `browserCookies.profile`; arbitrary profile paths remain unsupported. Thanks to [@lmilojevicc](https://github.com/lmilojevicc) for issue #297.
- Added GitHub PR and issue specialization in `fetch_content`, with `gh`-first metadata, bounded REST fallback, comment anchors, review threads, truncation markers, and the `githubPrIssue.enabled` opt-out (#294).
- Added explicit-only Kimi Code Plan search using Pi's refreshed `kimi-coding` OAuth credentials. Thanks to [@lushangkan](https://github.com/lushangkan) for PR #275.
- Added opt-in `searchRouting.useCurrentModel` routing for automatic searches. Official OpenAI GPT Responses models can now fund Hosted Search with their current endpoint, credentials, and headers before configured fallbacks. Thanks to [@nyankosama](https://github.com/nyankosama) for PR #293.
- Added strict Hosted Search response validation and better fallback classification for unsupported Hosted Search tools.
- Added current-model Hosted Search routing for official `openai-codex` GPT Responses models through the Codex Responses endpoint.
- Added Google Application Default Credentials support for Gemini generate-content calls with `geminiAuth: "adc"`. This covers Gemini search, URL context, PDF, and inline-data extraction through Vertex AI. YouTube and local video analysis still require `GEMINI_API_KEY` because they use the Gemini Files API. Thanks to [@smazurov](https://github.com/smazurov) for PR #301.

### Fixed
- Added Defuddle as a local fallback when Readability and RSC extraction cannot recover useful HTML content. Thanks to [@tobru](https://github.com/tobru) for issue #300.
- Kept Gemini ADC config and credential errors, GitHub PR/issue REST fallback failures, and Defuddle fallback failures visible instead of silently downgrading them.
- Pointed definitive `fetch_content` 404/410 failures to search guidance instead of provider configuration. Thanks to [@Daniishkhan](https://github.com/Daniishkhan) for PR #308.
- Improved Gemini Web browser-cookie diagnostics so `/google-account` shows sanitized attempted browser/profile entries and distinguishes missing required cookies, password-store access, and decryption failures. Thanks to [@lmilojevicc](https://github.com/lmilojevicc) for issue #296.
- Made `get_search_content` tolerate bridge defaults when `findText` is supplied, while preserving ordinary pagination. Thanks to [@ZacharyQin](https://github.com/ZacharyQin) for PR #295.

## [0.24.2] - 2026-08-22

### Highlights
- `auto` search now uses Codex-backed OpenAI search when Pi is running a Codex model.
- Non-Codex sessions still prefer Exa first, so zero-config search keeps its fast keyless path.
- Gemini Web browser-cookie access is more reliable on Windows Chrome and Edge profiles.

### Changed
- Prefer Codex-backed OpenAI search in `auto` mode when the active Pi model is `openai-codex`; otherwise prefer Exa before OpenAI.

### Fixed
- Fixed Windows Gemini Web browser-cookie extraction when Chromium cookie expiry values are too large for JavaScript numbers or PowerShell DPAPI key unprotect needs encoded command transport. Thanks to [@laixuanthoi](https://github.com/laixuanthoi) for issue #290.

## [0.24.1] - 2026-08-21

### Added
- Added `pdf.maxPages` to limit Datalab, Gemini, and local PDF extraction to the first N pages. Thanks to [@jaudiger](https://github.com/jaudiger) for issue #277.
- Added optional `openaiSearchProviders` config to choose which Pi model providers fund OpenAI `web_search`, in priority order. Thanks to [@hank-warren](https://github.com/hank-warren) for PR #276.
- Added Windows Chrome and Edge browser-cookie support for Gemini Web. Thanks to [@laixuanthoi](https://github.com/laixuanthoi) for issue #286.

### Fixed
- Hardened GitHub clone cache path handling. Thanks to [@spikelab](https://github.com/spikelab) for the responsible disclosure.
- Updated the local `fetch_content` HTTP User-Agent for wider compatible content retrieval. Thanks to [@_can1357](https://x.com/_can1357) for [the User-Agent observation](https://x.com/_can1357/status/2090837707069014224).
- Replaced inline RFC 2397 `data:` URIs in extracted page content with explicit bounded omission markers (MIME type, encoding, encoded/decoded byte counts, SHA-256 digest, `retrieval=not-retained`) before content reaches tool results, the fetch cache, or session persistence. Readable prose and Markdown image alt text are preserved; typed thumbnail/frame image blocks are unaffected. Thanks to [@bbbRye007](https://github.com/bbbRye007) for #281 and #282.
- Detached Linux curator browser launches so `xdg-open` cannot block `web_search` until the browser exits. Thanks to [@nguyenphivn](https://github.com/nguyenphivn) for issue #279.
- Allowed configured Firecrawl API base URLs to use loopback addresses without opening loopback for submitted fetch targets. Thanks to [@ackalker](https://github.com/ackalker) for issue #280.

## [0.24.0] - 2026-08-18

### Highlights
- Added more provider choices, including Parallel Search MCP, Valyu, and Serper.
- Made `fetch_content` recover useful article text from more Next.js and React Server Components pages.
- Updated summary and query rewrite model defaults to newer fast models.
- Made nested summary and rewrite model calls follow Pi's model registry routing.
- Added more control over summary thinking levels and provider API base URLs.

### Added
- Added `summaryModel` thinking-level suffix support. Thanks to [@pkos98](https://github.com/pkos98) for issue #264.
- Added explicit-only Parallel Search MCP support for keyless search and opt-in hosted fetch. Thanks to [@happytomatoe](https://github.com/happytomatoe) for #257.
- Added explicit-only Valyu and Serper search providers. Thanks to [@mikhel01](https://github.com/mikhel01) for issues #259 and #260.
- Added configurable API base URLs for Brave, keyed Exa, and Tavily requests, with credential stripping across redirect origins. Thanks to [@XWIlluDelu](https://github.com/XWIlluDelu) for #265.

### Changed
- Refreshed default summary and query rewrite model preferences. Thanks to [@hyein-cbio](https://github.com/hyein-cbio) for #266.

### Fixed
- Route nested model calls through Pi's model registry. Thanks to [@rany2](https://github.com/rany2) for #263.
- Recover useful Next.js RSC content when Readability only extracts a loading shell, and report full, partial, or failed background content fetches accurately (#272, #273).
- Keep valid AnySearch results when the API omits or nulls result content. Thanks to [@mikhel01](https://github.com/mikhel01) for #258.

## [0.23.0] - 2026-08-15

### Added
- Added opt-in `authFetch` profiles for local browser-cookie `fetch_content` requests. Thanks Luka (`@lmilojevicc`) for issue #254.
- Added Firecrawl as a `web_search` provider using the existing Firecrawl configuration. Thanks Andrés Sanabria (`@andy-spike`) for issue #246.
- Added macOS Brave profile support for opt-in Gemini Web browser-cookie access. Thanks Rajyavardhan Singh (`@imrajyavardhan12`) for PR #248.

### Changed
- Made local-video detection use an explicit result state in extraction code.

### Fixed
- Preserve summary draft completion routing through the model registry. Thanks `@limwa` for PR #249.
- Constrain numeric tool parameters to supported integer ranges. Thanks `@jaudiger` for issue #250 and PR #251.

## [0.22.0] - 2026-08-11

### Added
- Added Bocha web search provider support. Thanks @jingyulong for PR #243.
- Added `maxInlineContentChars` to configure the direct content and stored-content slice limit, with a 200,000-character maximum. Thanks @be4zad for issue #244.

### Fixed
- Hardened the fetched-content cache against symlink traversal and unsafe permissions, and bounded it to 128 entries and 128 MiB with oldest-entry eviction. Thanks `@HerbertGao` for issue #240 and PR #241.

## [0.21.0] - 2026-08-10

### Added
- Added per-tool and per-command registration gates plus image and PDF extraction gates. Thanks @jaudiger for issue #234.
- Added `summaryGenerationDeadlineMs` to configure the summary model deadline for curator and auto-summary workflows. Thanks @cataldoc for issue #237.

### Fixed
- Store full fetched content in an external cache instead of embedding it in session JSONL entries, preventing large search-heavy sessions from ballooning on restore. Thanks Igor Samokhovets (`@samohovets`) for issue #236.
- Document `get_search_content` parameter constraints in the tool schema. Thanks `@iwangjie` for PR #233.

## [0.20.0] - 2026-08-10

### Added
- Added keyless DuckDuckGo HTML search as an explicit and routing provider. Thanks @lmilojevicc for issue #228.
- Added Datalab hosted PDF-to-Markdown extraction as an optional PDF provider. Thanks José Antonio Galiano Sandoval (`@jagaliano`) for PR #226.

### Changed
- Tightened Datalab JSON response validation and Gemini Web fetch initialization internals.

### Fixed
- Fix Gemini Web "fetch failed" (`UND_ERR_HEADERS_OVERFLOW`) when running inside a host agent whose global undici dispatcher uses HTTP/1.1 with the default 16 KiB `maxHeaderSize`: Google's `/app` page exceeds that budget. Gemini Web requests now use a dedicated undici agent with a 4 MiB header budget. Thanks José Antonio Galiano Sandoval (`@jagaliano`) for PR #230.
- Preserve collapsed `web_search` result background padding. Thanks `@SheffeyG` for PR #224.

## [0.19.0] - 2026-08-08

### Added
- Added Jina Search as a normal configured `web_search` provider with `jinaApiKey` / `JINA_API_KEY`, explicit/auto/routing/all-provider support, domain and recency constraints, optional inline page content, and Curator integration. Thanks Orbio Agent (`@Gabrielgvl`) for PR #214.

### Fixed
- Added a tracked npm lockfile for reproducible contributor installs, and updated model-registry auth header typing for current Pi peer packages. Thanks `@dougEfresh` for PR #218.
- Keep manual `/websearch` curator pages in sync if the live SSE stream disconnects or misses events while searches are still running. Thanks `@Whisperfall` for issue #215.
- Updated Kagi Search and Extract requests for the current v1 API contracts. Thanks `@mattgaff` for PR #217.
- Recognize `:max` thinking suffixes when matching scoped summary models. Thanks `@justin8ty` for PR #219.
- Route local video Gemini upload, polling, and deletion requests through configured `geminiBaseUrl` / `GOOGLE_GEMINI_BASE_URL` relays. Thanks Mr. (`@Liemo99`) for PR #213.
- Classify xAI `403` spending-limit and quota-exhaustion responses as quota errors so configured search routing can fall back, while preserving ordinary `403` responses as authentication errors. Thanks `@0xmarcinz` for PR #212.

## [0.18.0] - 2026-08-03

### Added
- `fetch_content` can now return the original text response with `mode: "raw"`, which is useful for JSON APIs, error pages, and debugging what a server actually sent.
- `fetch_content` can now answer a question about a single fetched page with `mode: "answer"`, while still saving the original page text so you can inspect it later.
- Direct image links now work for PNG, JPEG, WebP, and GIF files. The tool downloads them safely, resizes large images, and returns an inline image result.
- `get_search_content` now accepts `findText` and `findMode`, so you can search saved content for the passage you need instead of paging through a long page by hand. Inspired by `@xl0`'s `pi-lovely-web` project.
- Added optional `searxngHeaders` so self-hosted SearXNG requests can carry reverse-proxy or Zero Trust auth headers. Thanks `@preinpost` for PR #202.
- Added explicit-only xAI/Grok search with `xaiApiKey` / `XAI_API_KEY`, Pi model-registry auth, and optional `xaiSearchModel`. Thanks `@join3r` for PR #196.
- Added explicit-only Bright Data SERP search with `brightdataApiKey` / `BRIGHTDATA_API_KEY` credentials and a required `brightdataSerpZone` / `BRIGHTDATA_SERP_ZONE` zone of Bright Data type `serp`. Bright Data is never chosen by `auto` and never participates in `provider: "all"`. Thanks `@mo-root` for PR #198.
- Added Bright Data Web Unlocker as a paid `fetch_content` extraction fallback with `brightdataApiKey` / `BRIGHTDATA_API_KEY` credentials and a required `brightdataUnlockerZone` / `BRIGHTDATA_UNLOCKER_ZONE` zone of Bright Data type `unblocker`. Thanks `@mo-root` for PR #199.
- Added Kagi Search API support with `kagiApiKey` / `KAGI_API_KEY`, plus Kagi Extract as a `fetch_content` fallback. Thanks `@imlonghao` for issue #197.
- Added Ollama Cloud Web Search support with `ollamaApiKey` / `OLLAMA_API_KEY`, plus Ollama Web Fetch as a `fetch_content` fallback. Thanks `@bradley-holt` for issue #203.
- Added explicit-only SerpBase Google SERP search with `serpbaseApiKey` / `SERPBASE_API_KEY`, domain filters as `site:` clauses, and recency mapped to Google `tbs`. Thanks `@gefsikatsinelou` for issue #195.

### Changed
- Long `fetch_content` results are easier to continue reading. The first response now stops on cleaner line boundaries and tells you the character, byte, and line totals plus the exact offset to request next.

### Fixed
- Fixed the `fetch_content` call header showing `fetch (no URL)` when Pi supplied `url` together with an empty `urls` array. Thanks `@Vergil824` for issue #192.
- Resolve preferred summary and query-rewrite models through routed provider registrations such as OpenRouter, preserving the registered provider and model ID instead of falling back when the native provider is unavailable. Thanks `@robzolkos` for issue #200 and PR #201.
- GitHub clone subprocesses now disable interactive credential prompts and terminate their process trees on timeout or cancellation, preventing orphaned Git helpers from capturing terminal input. Thanks `@MDGChamomile` for PR #193.


## [0.17.1] - 2026-07-31

### Fixed
- Removed the unsupported JSON Schema `uniqueItems` keyword from provider-array tool schemas so Gemini-compatible tool validators can register pi-web-access tools. Thanks `@akmaldira` for PR #191.

## [0.17.0] - 2026-07-30

### Added
- Added Gemini API PDF-to-Markdown conversion before local `unpdf` fallback, with inline PDF upload, page-marker validation, configurable `pdf.maxSizeMB`, and streamed size enforcement. Thanks José Antonio Galiano Sandoval (`@jagaliano`) for PR #180.
- Added Searchinfinity (Byteplus Searchinfinity / 豆包搜索 Global edition) as a search provider with `searchinfinityApiKey` / `SEARCHINFINITY_API_KEY` credentials, native domain and recency filters, model-generated result summaries, HTTP-semantics mapping for business error codes, provider-array/all-provider routing, and curator selection. Thanks `@cyzlmh` for PR #186.
- Added Querit as a search and hosted content provider with `queritApiKey` / `QUERIT_API_KEY` credentials, native domain and recency filters, optional inline Contents retrieval, provider-array/all-provider routing, curator selection, and a `fetch_content` fallback. Thanks `@MCapricorns` for PR #185.

### Changed
- The 5MB `fetch_content` response size limit is now enforced while streaming the decoded body, not just via the `Content-Length` header. Chunked or compressed pages whose decoded content exceeds 5MB now fail with `Response too large (5MB)` instead of being buffered unbounded and parsed. Shared config parsing for SSRF and fetch-content domain policy loaders also removes duplicate reads on the fetch hot path.

### Fixed
- Fixed filtered zero-config Exa search silently losing its request options: the default keyless MCP tool (`web_search_exa`) only accepts `query` and `numResults`, so `type`, `livecrawl`, and `contextMaxCharacters` were dropped server-side and `includeContent` never returned page text. Filtered or content-carrying keyless searches now use `web_search_advanced_exa` — served by the same keyless free tier — which applies `includeDomains`/`excludeDomains`, `startPublishedDate`, highlights, and text limits as real parameters instead of `site:` / "past week" strings appended to the semantic query. Plain searches stay on `web_search_exa`, and the advanced path falls back to it if it is unavailable.
- Stopped requesting citation text on keyed Exa `/answer` calls, which was fetched and then discarded, and stopped requesting page text on keyed `/search` calls that do not ask for content.
- Exa MCP rate-limit responses (429) now explain that adding `exaApiKey` to `~/.pi/web-search.json` removes the free-tier limit, instead of surfacing a bare status code. Thanks `@kesku` for PR #187.

## [0.16.0] - 2026-07-30

### Added
- Added Search1API as a first-class search and extraction provider with `search1apiApiKey` / `SEARCH1API_KEY` credentials, native domain and recency filters, opt-in Deep Search inline content, provider-array/all-provider routing, curator selection, and a hosted `fetch_content` fallback through the Crawl API. Thanks `@fatwang2` for PR #176.

### Fixed
- Standardized Gemini API defaults on `gemini-3.6-flash` for search, URL context, YouTube, and local video paths, set Gemini Web’s separate browser-cookie default to `gemini-3.1-pro`, and stopped unsupported Web models from silently falling back to 2.5 Flash. Thanks `@jagaliano` for issue #181.
- Accept explicit provider arrays for `web_search` and `source_check`, running only the selected providers concurrently while preserving `auto`, `all`, and sequential routing behavior. Thanks `@XWIlluDelu` for PR #179.
- Added `curatorRemote` and `autoOpenBrowser` controls for remote-accessible curator sessions, defaulting remote mode to a printed manual URL unless browser auto-open is explicitly requested. Thanks `@tylerdavis` for PR #178.
- Resolve the OpenAI search model from Pi’s model registry, with an `openaiSearchModel` override and preserved API-key fallback for partial registries. Thanks `@ahalekelly` for PR #182.
- Surfaced RFC Link / HTML discovery relations (`service-desc`, `service-doc`, `service-meta`, `api-catalog`, `describedby`) from HTTP `Link` headers and matching `link`/`a[rel]` markup during `fetch_content` HTML extraction, including empty SPA shells, without broad `/docs` URL heuristics. Thanks `@XWIlluDelu` for PR #175.
- Expand leading `~` and `$HOME`-style environment variables in `githubClone.clonePath` before cloning repositories. Thanks `@unship` for PR #184.
- Write extracted PDF markdown to a temporary `pi-web-pdf` directory by default instead of `~/Downloads`, while preserving explicit output directories. Thanks `@ahalekelly` for PR #183.

## [0.15.0] - 2026-07-28

### Added
- Added `openaiResponsesUrl` for routing OpenAI `web_search` and `source_check` calls through third-party Responses-compatible gateways while keeping the official OpenAI endpoint as the default. Thanks The Loki (`@the-loki`) for issue #174.
- Added `provider: "all"` to search every available provider except AnySearch simultaneously, render one independently selectable Curator card per provider before the final summary, deduplicate sources and inline content, and preserve partial successes with per-provider diagnostics. Thanks José Antonio Galiano Sandoval (`@jagaliano`) for PR #173.
- Added TinyFish as a first-class search and extraction provider with `tinyfishApiKey` / `TINYFISH_API_KEY` credentials, domain and recency filters, paginated result counts, batched inline content, ordered routing, curator selection, and a hosted `fetch_content` fallback before Parallel. Thanks José Antonio Galiano Sandoval (`@jagaliano`) for PR #172.

## [0.14.0] - 2026-07-25

### Added
- Added optional `fetchContent.domainPolicy` hostname allow/deny rules for `fetch_content`, checked before target requests and redirects while preserving SSRF protection and local-source behavior. Thanks Joseph Maliksi (@jmaliksi) for #79.
- Added explicit-only AnySearch direct search provider with anonymous access, optional `anysearchApiKey` / `ANYSEARCH_API_KEY` credentials, strict response validation, and request-time credential sources. Thanks Robin (@choronz) for #130.
- Added SERPdive search provider with request-time credential sources, a free-tier `krill` default that never spends on install, opt-in `mako`/`moby` retrieval depth, locally applied domain filters, and recency documented as a query hint rather than a guaranteed freshness filter. Thanks Eden d'Alexis (@edendalexis) for #139.
- Added opt-in ordered search routing through `searchRouting.providers` with explicit transient, quota, and network fallback kinds; named providers remain strict, single-provider config retains precedence, and exhausted routes preserve per-provider diagnostics. Thanks @smithyyang for #77.
- Added optional self-hosted SearXNG search with SSRF-guarded base URLs, local-first auto selection, result filters, and documented `ssrf.allowRanges` opt-ins. Thanks to Marcos A. Núñez (@marnunez) for PR #107 and Avinash Kanaujiya (@avinashkanaujiya) for issue #105.
- Added optional self-hosted Firecrawl extraction for `fetch_content`, using `/v2/scrape` by default (or `/v1/scrape` for older images), request-time credential sources, cache-only requests by default, cross-origin redirect credential stripping, and local-first fallback behavior when configured. Thanks Florian Kinder (@fank) for PR #123 and Avinash Kanaujiya (@avinashkanaujiya) for issue #105.
- Added opt-in configurable public tool names for environments where another extension or model reserves the defaults, while keeping `web_search`, `source_check`, `fetch_content`, and `get_search_content` unchanged by default. Thanks Kaiqiang (@youkq95) for reporting #138.
- Added `SECURITY.md` guidance for private vulnerability reporting. Thanks Aurelio Ribeiro (@aurelio-ribeiro) for #128.
- Added request-time `$ENV_VAR` and `!command` credential sources for every provider API-key field, including escaped `$$` and `$!` literals, while preserving legacy environment precedence for literal config values. Thanks to Eugene Strizhok (@estrizhok) for #159.
- Added request-time `$ENV_VAR` and `!command` credential sources for Exa and Gemini API configuration, with bounded output, redacted failures, strict source precedence, and shell-local 1Password session forwarding limited to the resolver command. Thanks to Ezra Miller (@ezmill) for #137.
- Added `source_check` machine-readable research artifacts with passage-level provenance, bounded page fetching, durable session retrieval, and conservative claim assessments. Thanks Clark Everson (@gr3enarr0w) for PR #111 and issue #108.

### Changed
- Limited the published package contents to runtime files, docs, and declared assets, keeping internal tests out of the npm tarball.
- Deferred the heavy content extraction module until the first `fetch_content` or `includeContent` search call, reducing extension startup work. Thanks Kaushik Gopal (@kaushikgopal) for PR #125.
- Send direct Gemini API credentials in `x-goog-api-key` headers for generate, upload, status, and delete requests instead of URL query parameters.

### Removed
- Removed the bundled `librarian` skill from this package instead of keeping a second research workflow coupled to GitHub clone internals. Thanks mcwalrus (@mcwalrus) for #136 and gravewhisper (@gravewhisper) for #23.

### Fixed
- Prevented opt-in Gemini Web browser cookies from crossing origins on redirects, disabled automatic redirects for cookie-bearing generation and upload requests, and restored local file reads for Gemini Web uploads.
- Preserved caller cancellation in non-curated multi-query searches instead of continuing with later queries, and passed the active extension context into curator-added searches.
- Hardened new provider result boundaries and removed a dead auto-routing condition without changing provider behavior.
- Hardened unreleased config/result boundaries by rejecting malformed config roots, reporting malformed SSRF JSON, normalizing invalid Perplexity result counts, and rejecting contradictory curator summary metadata.
- Reworked opt-in Gemini Web browser-cookie extraction to scan non-default Chromium profiles, preflight required cookie names before Keychain/secret-tool access, and cache encryption passwords only in-process. Thanks Kevin Truong (@kevinQTruong) for the originating PR #14, Jessica Black (@jssblck) for reporting #9, János Veres (@jveres) for reporting #2, and RimuruW (@RimuruW) for reporting #15.
- Added read-only `sqlite3` CLI and Python stdlib fallbacks when `node:sqlite` is unavailable, with sanitized actionable diagnostics instead of silently reporting Gemini Web as unavailable.
- Bounded curator summary-model generation and returned a deterministic, phase-labeled fallback when a draft exceeds its deadline, while preserving caller cancellation and model-resolution errors. Thanks torn1147 (@torn1147) for reporting #43.
- Used `gemini-2.5-flash` as the Gemini API grounded-search default while preserving configured `searchModel` values and the shared URL/video defaults. Thanks lajarre for reporting #11.
- Used the configured search provider when tool calls omit `provider` or emit the schema's `auto` default, while preserving explicit provider overrides and auto fallback without configuration. Thanks Pavlo (@fxposter) for reporting #17.
- Clarified that `githubClone.enabled: false` disables GitHub clone/API specialization while leaving generic URL extraction available. Thanks Carlos Peralta (@cperalt) for issue #26.
- Added an opt-in `ssrf.trustEnvProxy` setting that skips local DNS preflight only for hostnames routed through configured HTTP(S) proxy environment variables, while retaining localhost, literal private-IP, and `NO_PROXY` protections. This addresses the DNS failure described in #104 without claiming full proxy transport support. Thanks Daniel Birn (@DBPhoenix) for PR #109 and mystery4f for reporting #104.
- Kept PDF extraction compatible with runtimes without native `Promise.try` and limited PDF.js output to errors. Thanks Guido Witt-Dörring (@guwidoe) for PRs #33 and #34.
- Returned fetched URL content from `get_search_content` in bounded slices with explicit `offset`/`limit` continuation metadata, preventing large stored pages from overflowing the next model request. Thanks @manfredlift for reporting #112.
- Kept oversized local videos recognizable for ffmpeg frame/timestamp extraction while preserving the Gemini analysis upload size limit. Thanks @Xandaar for reporting #135.
- Declared `typebox` as a regular runtime dependency so clean/global installs can load the extension without relying on Pi or Feynman to provide that peer. Thanks @DuskyElf, @tonytziorvas, and @53able for reporting #59, #63, and #66.
- Preserved OpenAI/Codex answers even when the provider returns no source citations instead of replacing them with `No results found`. Thanks AstroHan (@Astro-Han) for reporting #117.
- Prevented browser auto-open failures from crashing the curator fallback path with `ReferenceError: sendCuratorFallbackUpdate is not defined`. Thanks Nisarg Patel (@pnisarg) for PR #121; Apostol Apostolov (@apoapostolov), @2seoik, and Demetre Dzmanashvili (@demetere) for related PRs #133, #120, and #114; and @ruanlinxin, @bluewatercg, @tonydiep, and @pinion05 for reports #103, #116, #126, and #127.
- Added a focused SSRF error hint for TUN/fake-IP `198.18.0.0/15` addresses that points users to the existing `ssrf.allowRanges` opt-in. Thanks Aaron (@BenjaminAaron196) for PR #141 and AstroHan (@Astro-Han) for reporting #134.
- Registered the web activity widget with Pi's supported string-array API to prevent `content is not a function` crashes when toggling non-default shortcuts. Thanks @llllllllqq for reporting #158.
- Registered the web activity widget as a Pi component factory instead of passing a `Text` instance directly. Thanks Trey Hoover (@treyhoover) for PR #132.

## [0.13.0] - 2026-06-25

### Added
- Added `ssrf.allowRanges` config to exempt CIDR ranges (e.g. `198.18.0.0/15`) from the SSRF guard, so `fetch_content`/`web_search` work on hosts whose network proxy runs in TUN + fake-IP mode (Surge, Clash, Mihomo, Stash, ...) where public domains resolve into a synthetic reserved range. Off by default. Thanks @TianZuo555 for reporting #101 and PR #102.

### Fixed
- Hardened `ssrf.allowRanges` validation to reject all-address `/0` CIDRs and non-string entries.

## [0.12.0] - 2026-06-24

### Added
- Added `webSearch.enabled` config to disable `web_search` tool registration. Thanks @webwarrior-ws for PR #38 and @knocte for reporting #22.
- Added `workflow: "auto-summary"` for `web_search` to generate a summary without opening the browser curator. Thanks @Ilm-Alan for PR #57 and @baflow for reporting #32.
- Added Tavily Search API provider support with `TAVILY_API_KEY` / `tavilyApiKey`, domain filters, recency filters, and auto-provider fallback integration.
- Added Parallel search provider support, auto-provider fallback integration, and Parallel `fetch_content` extraction fallback.
- Resolved `web-search.json` from `PI_CODING_AGENT_DIR`, then `XDG_CONFIG_HOME/pi`, before falling back to `~/.pi`.
- Added `GOOGLE_GEMINI_BASE_URL` / `geminiBaseUrl` for routing Gemini generate-content calls through compatible gateways, plus `CLOUDFLARE_API_KEY` / `cloudflareApiKey` authentication for Cloudflare AI Gateway. Thanks @meatballhat-cf for PR #76 and @tynril for reporting #74.

### Removed
- Removed the deprecated `code_search` tool that duplicated the Exa search provider from `web_search`. Thanks @picasso250 for PR #62 and reporting #61.

### Fixed
- Kept curator sessions alive when browser auto-open fails and surfaced a copyable curator URL for Docker, WSL, and headless environments. Thanks @rca, @runningman84, and @k0valik for reporting #92, #93, and #55.
- Updated `@mozilla/readability` to `^0.6.0` for GHSA-3p6v-hrg8-8qj7. Thanks @omar-elmountassir for reporting #86, and @henriquebastos and @av1155 for PRs #35 and #68.
- Limited curator summary model selection to Pi `enabledModels` when configured, and fall back to a deterministic no-billing summary instead of silently calling unrelated catalog models. Thanks @Horace1423 for reporting #73.
- Let configured Exa API keys use Exa's own account limits instead of blocking at the legacy local 1,000-request counter. Thanks @totoDoP for reporting #80.
- Supported parallel `web_search` curator tool calls with per-call browser and cancellation state.
- Prevented curator sessions from hanging after searches finish when no browser connects, and finalized connected idle sessions once the curator timeout elapses.
- Added explicit `role: "user"` fields to Gemini generate-content requests for Vertex AI-backed proxy compatibility. Thanks @meatballhat-cf for PR #76 and @tynril for reporting #74.

## [0.11.0] - 2026-06-24

### Added
- Added OpenAI Responses API web search with Codex subscription auth, OpenAI API key auth, required web-search tool use, model-registry header forwarding, and source extraction from citations and web-search sources.
- Added Brave Search API provider with `BRAVE_API_KEY` / `braveApiKey`, freshness mapping, and domain include/exclude handling.
- Added OpenAI and Brave to `auto` provider routing, explicit `provider` selection, curator provider buttons, provider tags, and provider availability checks.

### Changed
- Updated extension imports for Pi 0.80.x, including the `@earendil-works` package namespace, `.ts` local module specifiers, and the `@earendil-works/pi-ai/compat` entrypoint for legacy model helpers.
- Declared Pi-bundled packages as peer dependencies so Pi can provide its runtime aliases when loading the extension.

### Fixed
- Aligned custom message display values and widget clearing with the current Pi extension API types.
- Surfaced real YouTube Gemini API failures instead of replacing them with the generic Chrome/API-key guidance.
- Kept Brave snippets out of `inlineContent` so `includeContent` searches still fetch full page content through the background extraction pipeline.
- Prevented constrained auto searches from silently losing recency/count constraints by preferring Exa/Brave over OpenAI when OpenAI cannot enforce them strictly.

### Removed
- Removed the committed `package-lock.json` from the extension package and ignored future lockfiles.

## [0.10.7] - 2026-05-02

### Added
- Added `summaryModel` config for choosing the default curator summary draft model from `~/.pi/web-search.json`.

### Fixed
- Made Gemini Web browser-cookie access opt-in via `allowBrowserCookies` or `PI_ALLOW_BROWSER_COOKIES=1`, preventing surprise macOS Keychain prompts during provider checks.
- Restored `code_search` after Exa removed the `get_code_context_exa` MCP tool by falling back to `web_search_exa` with code-focused queries.
- Migrated extension tool schemas from `@sinclair/typebox` to Pi's bundled `typebox` 1.x import path.

## [0.10.6] - 2026-04-04

### Changed
- Added `promptSnippet` metadata for `web_search`, `code_search`, `fetch_content`, and `get_search_content` so Pi 0.59+ includes these tools in the default prompt tool section and improves discoverability of research/fetch flows.

## [0.10.5] - 2026-04-03

### Fixed
- Forward dynamic request `headers` from `ctx.modelRegistry.getApiKeyAndHeaders()` into `complete()` for query rewriting and summary generation, finishing the pi 0.63+ auth migration for providers that require per-request headers.
- Removed legacy `session_switch`/`session_fork` lifecycle listeners and rely on immutable-session `session_start` reinitialization.

## [0.10.4] - 2026-03-27

### Added
- **Workflow-based curator hard cutover (`workflow`).** Replaced `curate` with `workflow: "none" | "summary-review"`, added summary-review approval flow with `POST /summarize`, made summary text the primary returned output while retaining raw curated evidence in `details`, and switched timeout handling to submit-first with deterministic summary fallback when no approved draft exists.
- **Auto-open curator for all `web_search` runs (single + multi query).** Searches now open the curator window immediately and stream results live for review workflows; the old countdown/auto-condense fallback path was removed.
- **Exa.ai search provider.** Neural/semantic search available alongside Perplexity and Gemini. 1,000 free requests/month. Set `EXA_API_KEY` env var or `exaApiKey` in `~/.pi/web-search.json`, or select explicitly with `provider: "exa"`. Includes built-in content extraction — when `includeContent` is true, full page text comes back with search results instead of requiring a separate background fetch. Monthly usage tracked in `~/.pi/exa-usage.json` with a warning at 80%.
- **Exa MCP fallback.** When no Exa API key is configured, search routes through `mcp.exa.ai` with zero setup. Supports basic search and `includeContent` but not domain/recency filtering (falls through to Gemini for those).
- **`code_search` tool.** Code/documentation search via Exa MCP (`get_code_context_exa`). No API key required. Returns code examples, docs, and API references from GitHub, Stack Overflow, and official documentation.
- **Glimpse native curator window.** On macOS with Glimpse installed, the search curator opens in a native WKWebView window instead of a browser tab. Faster launch, closer integration. Falls back to browser automatically when Glimpse is unavailable.
- **Curator provider UX rewrite.** Replaced the provider dropdown with provider buttons (hidden when unavailable), made provider re-search additive, added provider badges on all cards (including errors), and switched button states to coverage-based logic keyed by logical query slots so duplicate query text is handled correctly.
- **Per-card provider re-search.** Completed result cards now show "Also try" chips for other available providers. Clicking one searches the same query with that provider and adds a new card below, keeping both results for comparison.
- **Query rewrite with magic wand.** The "Add a search" input now has a ✨ button that rewrites the entered query using a fast LLM (haiku/flash) to make it more specific and effective. The improved query replaces the input text for review before searching.
- **Summary model chooser redesign.** Summary review now follows a provider-first flow: provider dropdown first, then provider-scoped model dropdown.
- **Active summary-generation loading state.** Summary review now shows a dedicated animated in-progress panel while `/summarize` is running (panel sweep, pulse + shimmer placeholders, staged copy updates, and active model label) instead of only a static disabled textarea.
- **Model/provider guard retry for summary generation.** If a selected summary model fails with model/provider configuration errors, curator now retries once with Auto model selection before surfacing a terminal error.
- **Feedback input for summary regeneration.** Optional text field in the summary review panel for providing instructions when regenerating a summary. Only the Regenerate button passes feedback to the prompt; auto-generation and the initial Generate button do not. Feedback is cleared on success and persisted on error for retry.
- **`/curator` command.** Toggle or configure the curator workflow at runtime: `/curator on`, `/curator off`, `/curator summary-review`, or `/curator` to toggle. Persists to `~/.pi/web-search.json` and takes effect on the next `web_search` call.
- **Config-based workflow default.** Added `workflow` field to `~/.pi/web-search.json` for persistent curator preference. Per-call `workflow` parameter on `web_search` takes priority, then config, then the built-in default (`summary-review` with UI, `none` without).
- **"Send selected results without summary" button.** New secondary button in the curator that submits curated results directly without generating or approving a summary. Works from any stage when results are selected. Output uses the raw curated results format with per-query detail.
- **Summary preview modal.** Preview button in the summary actions opens a full-page modal with the summary rendered as formatted markdown. Includes Approve and Regenerate actions with an inline model selector for switching models without leaving the preview.
- **"Also try" provider chips on searching cards.** Provider re-search chips now appear on cards still in-flight, not just completed ones, so alternative-provider searches can be kicked off in parallel without waiting.
- **Live search progress in heading.** Hero heading shows "2 of 4 Searches Complete" while searches are running, with status line showing "2 completed, 2 searching". Reverts to "N Searches Complete" when all finish.
- **Summary subtitle with selection count.** Subtitle now shows "Summary of N selected results" and reacts to selection changes ("Selection changed — regenerating summary…").
- **Summary model selector relocated.** Moved the provider/model dropdowns from the hero area into the summary panel header, next to the title, so the model choice is adjacent to the summary it controls.
- **Improved collapsed TUI preview.** Collapsed search result cards now show adaptive content: summary text when available, curated query titles with source counts when results were sent without summary, or a fallback text line otherwise. Line count hint matching pi's built-in pattern: `... (X more lines, Y total, ctrl+o to expand)`.
- **Inline annotation feedback in preview modal.** Select any text in the rendered summary preview to get a popover with a quoted excerpt and a feedback textarea. Regenerate from the popover to send targeted feedback like `Regarding: "<selected text>" — <your note>`. Supports Cmd/Ctrl+Enter to submit and Escape to dismiss.
- **Concurrent add-search and alt-chip searches.** The "Add a search" input and "Also try" provider chips are no longer locked while other searches are in-flight. Multiple searches can run in parallel.
- **Batch provider search shows searching cards immediately.** Clicking a provider button now creates placeholder cards with loading animations upfront instead of waiting for results to arrive.

### Changed
- Exa search now always requests text content from both direct API and MCP paths (3000 chars default, 50000 with `includeContent`) instead of requesting highlights only. Ensures consistent answer quality regardless of whether Exa returns highlight snippets.
- Adapted model registry calls to pi SDK changes: `getApiKey()` → `getApiKeyAndHeaders()` in `index.ts` and `summary-review.ts`, and `getAvailable()` from async to sync.
- Hoisted dynamic `await import()` calls to static top-level imports in `gemini-web.ts`, `video-extract.ts`, and `youtube-extract.ts`.
- Removed legacy `session_switch`/`session_fork` lifecycle listeners and rely on immutable-session `session_start` reinitialization.

### Removed
- **`result-review` workflow.** Hard cutover — only `"none"` and `"summary-review"` remain. Removed from `WebSearchWorkflow` type, `resolveWorkflow()`, tool schema, `/websearch` command, and `/curator` command.

### Fixed
- Summary generation no longer hard-fails on empty model payloads (`content parts: none`): empty-response failures now fall back to deterministic summary output with explicit fallback metadata (`fallbackReason: "summary-model-empty-response"`) instead of surfacing a terminal UI error.
- Deterministic fallback summaries now strip trailing `Source:`/`Sources:` boilerplate from provider answer text before building query previews, preventing noisy source-list dumps from replacing actual summary prose. Fixed regex matching so `Source:` tokens at the start of provider answers are correctly detected and removed.
- Curator now allows provider switching and add-search actions while summary generation is running. User-initiated search mutations supersede the in-flight summary request client-side and return the UI to results mode so searching can continue without waiting for draft completion.
- Curator client now handles non-2xx server responses consistently across `/provider`, `/search`, `/submit`, `/cancel`, and heartbeat requests, and no longer leaves timeout/heartbeat POST promises unhandled.
- Prevented duplicate completion counting when the same result card is updated more than once.
- Fixed background fetch abort detection to avoid crashing on non-`Error` rejection values.
- Fixed YouTube detection for protocol-less links (`youtu.be/...`) by allowing regex fallback after URL-parse failures.
- Fixed README probing in GitHub clone mode to continue scanning alternate README filenames when one candidate is unreadable.
- Removed dead `search-filter.ts` code path and its stale README file-table entry.
- Gemini provider routing now preserves provider failure context in explicit/final Gemini paths instead of silently collapsing errors to `null`.
- Hardened auto-provider fallback diagnostics: when Exa/Perplexity/Gemini are available but fail at runtime, the thrown error now includes all provider-specific failure reasons instead of dropping context.
- Prevented queued SSE event loss in curator reconnect flows by preserving unsent buffered messages when an SSE flush write fails.
- Hardened curator server provider validation (`/provider`, `/search`) so invalid/unavailable provider names are rejected explicitly instead of mutating session state.
- Fixed `file://` local-video path handling to decode URL-escaped paths and treat malformed file URLs as invalid inputs instead of throwing.
- Prevented path-escape reads in GitHub clone rendering by constraining blob/tree paths to remain within the cloned repository root.
- Prevented symlink-escape traversal in clone tree/list rendering (`buildTree` / `buildDirListing`) by skipping entries that resolve outside the repository root.
- Config parse errors from YouTube/video/Gemini fallback paths are now surfaced explicitly to users instead of silently collapsing to generic fallback messages.
- Fixed provider switching during streaming curator searches (`web_search` + `/websearch`) so remaining queued searches use the latest selected provider instead of the initial one.
- Fixed `fetch_content` timestamp behavior to fail explicitly on invalid timestamp formats and non-video/non-YouTube targets instead of silently ignoring `timestamp` and falling through to generic extraction.
- Removed `Promise.withResolvers` from `web_search` curation flow for broader Node compatibility (no ES2024 runtime requirement).
- Hardened PDF metadata handling (`pdf-extract.ts`) with typed metadata guards and safe `maxPages` clamping.
- Normalized configured/default provider values in `index.ts` and `gemini-search.ts` (including case-insensitive values) so invalid provider strings no longer leak into curator state and now safely fall back to `auto` resolution.
- Hardened config string/number normalization (`index.ts`, `gemini-search.ts`, `gemini-web.ts`, `youtube-extract.ts`, `video-extract.ts`): whitespace-only model/profile/provider values now safely fall back to defaults, and invalid/non-positive video `maxSizeMB` no longer disables local video detection accidentally.
- Hardened API key/config handling (`gemini-api.ts`, `perplexity.ts`, `exa.ts`, `github-extract.ts`): whitespace/invalid key values are no longer treated as configured credentials, and invalid GitHub clone config booleans/numbers/paths now safely fall back to defaults instead of causing silent misconfiguration.
- Fixed mid-flight abort behavior in extraction fallbacks (`extract.ts`, `github-extract.ts`): aborted YouTube/local-video/GitHub extraction no longer degrades into misleading fallback guidance and now returns explicit `Aborted` results instead of continuing with fallback network work.
- Fixed abort lifecycle consistency in GitHub clone extraction (`github-extract.ts`): aborted clone attempts now correctly close activity entries as aborted and avoid persisting failed-abort clone cache entries that could force stale API-only fallback on later requests.
- Fixed activity-monitor lifecycle for shared-clone races (`github-extract.ts`): callers that race onto an already-started clone now properly close their own activity entry (success/error/aborted) instead of leaving stale pending entries.
- Fixed oversized-repo activity status accuracy (`github-extract.ts`): API fallback paths now mark activity success only when API fetch succeeds and correctly log an error when API fallback is unavailable instead of reporting false-positive success.
- Fixed clone-failure fallback telemetry (`github-extract.ts`): when clone fails but API fallback succeeds, activity now reports success instead of remaining an error, and aborted clone-failure paths now short-circuit without extra fallback fetches.
- Fixed GitHub URL host matching (`github-extract.ts`) so `https://www.github.com/...` URLs are recognized as clone/API candidates instead of silently falling through to generic HTTP extraction.
- Hardened curator markdown rendering (`curator-page.ts`) against HTML/script injection by escaping provider answer text before markdown rendering, preserving markdown formatting while blocking raw HTML execution in the UI.
- Closed additional curator link-safety gaps (`curator-page.ts`): sanitized markdown-rendered `href`/`src` protocols and source-link URLs to block `javascript:`/non-http schemes, enforced safe link attrs (`noopener noreferrer`), and stripped inline event-handler attributes from rendered markdown DOM.
- Hardened inline script data serialization in curator page generation (`curator-page.ts`) by escaping Unicode line/paragraph separators (`U+2028`, `U+2029`) in `safeInlineJSON`, preventing malformed script blocks or injection edge cases from unescaped JSON payloads.
- Fixed abort telemetry misclassification in media extractors (`youtube-extract.ts`, `video-extract.ts`): canceled extractions now log activity as aborted (`status: 0`) instead of incorrectly reporting `all ... paths failed` errors after abort races.
- Fixed GitHub URL path decoding in clone/API extraction (`github-extract.ts`): percent-encoded path segments (for example `%20`) are now decoded before blob/tree resolution, so URLs that point to files/directories with encoded characters no longer fall through to incorrect "path not found" output.
- Fixed error-signal downgrade in local-video API fallback (`video-extract.ts`): `tryVideoGeminiApi` now rethrows config parse failures (`Failed to parse ~/.pi/web-search.json`) instead of swallowing them as `null`, preserving actionable root-cause errors.
- Fixed provider config type hardening in search routing (`index.ts`): `normalizeProviderInput` now guards non-string config values before trimming so malformed `provider` entries in `~/.pi/web-search.json` no longer crash runtime provider resolution with `value.trim is not a function`.
- Simplified provider typing flow in curator/search orchestration (`index.ts`): narrowed `resolveProvider` and `PendingCurate.defaultProvider` to resolved provider types, normalized incoming provider strings at callback boundaries, and removed redundant `as SearchProvider | undefined` casts while preserving search behavior.
- Improved curator loading experience in `curator-page.ts`: added animated skeleton loading panel in the content area while searches are in-flight, upgraded searching card visuals with shimmer/active-state styling, and wired loading visibility to real search state transitions (including add-search, done, submit/cancel, and timeout paths).
- Updated curator session timeout defaults in `index.ts`: curator now starts at 20 seconds by default (down from 60) and can be configured via `curatorTimeoutSeconds` in `~/.pi/web-search.json` (capped at 600 seconds).
- Hardened `/websearch` startup error handling in `index.ts`: config/provider bootstrap now runs behind explicit error handling so malformed `~/.pi/web-search.json` no longer throws uncaught command errors before the existing server-start try/catch; users now receive a direct UI error with parse context.
- Hardened extension bootstrap config handling in `index.ts`: shortcut initialization now uses guarded config loading, logging parse errors and falling back to default shortcuts instead of crashing extension registration on malformed `~/.pi/web-search.json`.
- Simplified curator-timeout config plumbing in `index.ts` by removing an unused `getCuratorTimeoutSeconds(config)` parameter path and keeping a single config-read code path.
- Simplified curator bootstrap wiring in `index.ts` by extracting shared provider/timeout setup (`ProviderAvailability`, `CuratorBootstrap`, `getProviderAvailability`, `loadCuratorBootstrap`) and removing duplicated availability assembly across `web_search` and `/websearch` flows.
- Hardened SSE event parsing in curator client (`curator-page.ts`): malformed JSON payloads from SSE `data:` lines now surface as user-visible errors instead of crashing the page via uncaught `JSON.parse` exceptions.
- Fixed "Send results" producing a deterministic summary instead of raw curated results. The submit payload now uses a `rawResults` flag to distinguish explicit "Send results" clicks from timeout-via-submit, which correctly falls back to a deterministic summary.
- Exa search results with no highlight snippets now fall back to `item.text` (truncated to 1000 chars) instead of producing empty answers. Empty snippets are also skipped during MCP answer assembly.
- Exa MCP result parsing now handles `Highlights:` response blocks in addition to `Text:` blocks, and strips trailing `---` separators from parsed content.
- Fixed stale heading count after a user-added search fails and its card is removed. `updateSummaryText()` is now called in all card-removal error paths.
- Fixed heading not reflecting new in-progress searches immediately. Adding a search via "Also try" or "Add a search" now updates the heading to show the new total (e.g., "4 of 5 Searches Complete") right away instead of waiting for completion.

## [0.10.3] - 2026-03-12

### Added
- `/google-account` command to report the active Google account currently authenticated for Gemini Web.
- `chromeProfile` config support for targeting a non-default Chromium profile when reading Gemini Web cookies.
- `searchModel` config support for overriding the Gemini API model used by `web_search`.

### Changed
- Chromium cookie extraction now tries Helium, Chrome, and Arc on macOS, plus Chromium and Chrome on Linux, with profile-aware cookie paths and per-platform key handling.
- Gemini Web availability checks now pass required cookie names into cookie extraction and can look up the active signed-in Google account without changing existing `isGeminiWebAvailable()` callers.
- README documentation now covers macOS/Linux cookie extraction limits, the new config fields, the `/google-account` command, and the expanded `chrome-cookies.ts` role.

## [0.10.2] - 2026-02-18

### Added
- **Interactive search curation.** Press Ctrl+Shift+S during or after a multi-query search to open a browser-based review UI. Results stream in live via SSE. Pick which queries to keep, add new searches on the fly, switch providers — then submit to send only the curated results to the agent.
- **Auto-condense pipeline.** When the countdown expires without manual curation, a single LLM call (Claude Haiku by default) condenses all search results into a deduplicated briefing organized by topic. Preprocessing enriches the prompt with URL overlap, answer similarity, and source quality analysis. Configure via `"autoFilter"` in `~/.pi/web-search.json`. Full uncondensed results stored and retrievable via `get_search_content`.
- **Configurable keyboard shortcuts.** Both shortcuts (curate: Ctrl+Shift+S, activity monitor: Ctrl+Shift+W) can be remapped via `"shortcuts"` in `~/.pi/web-search.json`. Changes take effect on restart.
- **`/websearch` command** — opens the curator directly from pi without an agent round-trip. Accepts optional comma-separated queries or opens empty.
- **Task-aware condensation.** Optional `context` parameter on `web_search` — a brief description of the user's task. The condenser uses it to focus the briefing on what matters.
- **Provider selection** — global dropdown in the curator UI to switch between Perplexity and Gemini. Persists to `~/.pi/web-search.json`.
- **Live condense status in countdown.** Shows "condensing..." while the LLM is working, then "N searches condensed" once complete.
- Markdown rendering in curator result cards via marked.js.
- Query-level result cards with expandable answers and source lists. Check/uncheck to include or exclude.
- SSE streaming with keepalive, socket health checks, and buffered delivery.
- Idle-based timer (60s default, adjustable). Timeout sends all results as safe default.
- Keyboard shortcuts: Enter (submit), Escape (skip), A (toggle all).
- Dark/light theme via `prefers-color-scheme` with teal accent palette.

### Changed
- **Curate enabled by default.** Multi-query searches show a 10-second review window; single queries send immediately. Pass `curate: false` to opt out.
- **Curate shortcut opens browser immediately, even mid-search.** Remaining results stream in live via SSE.
- **Tool descriptions encourage multi-query research.** The `queries` param explains how to vary phrasing and scope across 2-4 queries, with good/bad examples.
- **Curated results instruct the LLM.** Tool output prefixed with an instruction telling the LLM to use curated results as-is.
- Expanded view shows full answer text per query with source titles and domains.
- Non-curated `web_search` calls now respect the saved provider preference.
- Config helpers generalized from `loadSavedProvider`/`saveProvider` to `loadConfig`/`saveConfig`.

### Fixed
- Curated `onSubmit` passed the original full query list instead of the filtered list, inflating `queryCount`.
- Collapsed curated status mixed source URL counts with query counts.

### New files
- `curator-server.ts` — ephemeral HTTP server with SSE streaming, state machine, heartbeat watchdog, and token auth.
- `curator-page.ts` — HTML/CSS/JS for the curator UI with markdown rendering and overlay transitions.
- `search-filter.ts` — auto-condense pipeline: preprocessing, LLM condensation via pi's model registry, and post-processing (citation verification, source list completion).

## [0.7.3] - 2026-02-05

### Added
- Jina Reader fallback for JS-rendered pages. When Readability returns insufficient content (cookie notices, consent walls, SPA shells), the extraction chain now tries Jina Reader (`r.jina.ai`) before falling back to Gemini. Jina handles JavaScript rendering server-side and returns clean markdown. No API key required.
- JS-render detection heuristic (`isLikelyJSRendered`) produces more specific error messages when pages appear to load content dynamically.
- Actionable guidance when all extraction methods fail, listing steps to configure Gemini API or use `web_search` instead.

### Changed
- HTTP fetch headers now mimic Chrome (realistic `User-Agent`, `Sec-Fetch-*`, `Accept-Language`) instead of the default Node.js user agent. Reduces blocks from bot-detection systems.
- Short Readability output (< 500 chars) is now treated as a content failure, triggering the fallback chain. Previously, a 266-char cookie notice was returned as "successful" content.
- Extraction fallback order is now: HTTP+Readability → RSC → Jina Reader → Gemini URL Context → Gemini Web → error with guidance.

### Fixed
- `parseTimestamp` now rejects negative values in colon-separated format (`-1:30`, `1:-30`). Previously only the numeric path (`-90`) rejected negatives, while the colon path computed and returned negative seconds.

## [0.7.2] - 2026-02-03

### Added
- `model` parameter on `fetch_content` to override the Gemini model per-request (e.g. `model: "gemini-2.5-flash"`)
- Collapsed TUI results now show a 200-char text preview instead of just the status line
- LICENSE file (MIT)

### Changed
- Default Gemini model updated from `gemini-2.5-flash` to `gemini-3-flash-preview` across all API, search, URL context, YouTube, and video paths. Gemini Web gracefully falls back to `gemini-2.5-flash` when the model header isn't available.
- README rewritten: added tagline, badges, "Why" section, Quick Start, corrected "How It Works" routing order, fixed inaccurate env var precedence claim, added missing `/v/` YouTube format, restored `/search` command docs, collapsible Files table

### Fixed
- `PERPLEXITY_API_KEY` env var now takes precedence over config file value, matching `GEMINI_API_KEY` behavior and README documentation (was reversed)
- `package.json` now includes `repository`, `homepage`, `bugs`, and `description` fields (repo link was missing from pi packages site)

## [0.7.0] - 2026-02-03

### Added
- **Multi-provider web search**: `web_search` now supports Perplexity, Gemini API (with Google Search grounding), and Gemini Web (cookie auth) as search providers. New `provider` parameter (`auto`, `perplexity`, `gemini`) controls selection. In `auto` mode (default): Perplexity → Gemini API → Gemini Web. Backwards-compatible — existing Perplexity users see no change.
- **Gemini API grounded search**: Structured citations via `groundingMetadata` with source URIs and text-to-source mappings. Google proxy URLs are resolved via HEAD redirects. Configured via `GEMINI_API_KEY` or `geminiApiKey` in config.
- **Gemini Web search**: Zero-config web search for users signed into Google in Chrome. Prompt instructs Gemini to cite sources; URLs extracted from markdown response.
- **Gemini extraction fallback**: When `fetch_content` fails (HTTP 403/429, Readability fails, network errors), automatically retries via Gemini URL Context API then Gemini Web extraction. Each has an independent 60s timeout. Handles SPAs, JS-heavy pages, and anti-bot protections.
- **Local video file analysis**: `fetch_content` accepts file paths to video files (MP4, MOV, WebM, AVI, etc.). Detected by path prefix (`/`, `./`, `../`, `file://`), validated by extension and 50MB limit. Two-tier fallback: Gemini API (resumable upload via Files API with proper MIME types, poll-until-active and cleanup) → Gemini Web (free, cookie auth).
- **Video prompt parameter**: `fetch_content` gains optional `prompt` parameter for asking specific questions about video content. Threads through YouTube and local video extraction. Without prompt, uses default extraction (transcript + visual descriptions).
- **Video thumbnails**: YouTube results include the video thumbnail (fetched from `img.youtube.com`). Local video results include a frame extracted via ffmpeg (at ~1 second). Returned as image content parts alongside text — the agent sees the thumbnail as vision context.
- **Configurable frame extraction**: `frames` parameter (1-12) on `fetch_content` for pulling visual frames from YouTube or local video. Works in five modes: frames alone (sample across entire video), single timestamp (one frame), single+frames (N frames at 5s intervals), range (default 6 frames), range+frames (N frames across the range). Endpoint-inclusive distribution with 5-second minimum spacing.
- **Video duration in responses**: Frame extraction results include the video duration for context.
- `searchProvider` config option in `~/.pi/web-search.json` for global provider default
- `video` config section: `enabled`, `preferredModel`, `maxSizeMB`

### Changed
- `PerplexityResponse` renamed to `SearchResponse` (shared interface for all search providers)
- Extracted HTTP pipeline from `extractContent` into `extractViaHttp` for cleaner Gemini fallback orchestration
- `getApiKey()`, `API_BASE`, `DEFAULT_MODEL` exported from `gemini-api.ts` for use by search and URL Context modules
- `isPerplexityAvailable()` added to `perplexity.ts` as non-throwing API key check
- Content-type routing in `extract.ts`: only `text/html` and `application/xhtml+xml` go through Readability; all other text types (`text/markdown`, `application/json`, `text/csv`, etc.) returned directly. Fixes the OpenAI cookbook `.md` URL that returned "Untitled (30 chars)".
- Title extraction for non-HTML content: `extractTextTitle()` pulls from markdown `#`/`##` headings, falls back to URL filename
- Combined `yt-dlp --print duration -g` call fetches stream URL and duration in a single invocation, reused across all frame extraction paths via `streamInfo` passthrough
- Shared helpers in `utils.ts` (`formatSeconds`, error mapping) eliminate circular imports and duplication across youtube-extract.ts and video-extract.ts

### Fixed
- `fetch_content` TUI rendered `undefined/undefined URLs` during progress updates (renderResult didn't handle `isPartial`, now shows a progress bar like `web_search` does)
- RSC extractor produced malformed markdown for `<pre><code>` blocks (backticks inside fenced code blocks) -- extremely common on Next.js documentation pages
- Multi-URL fetch failures rendered in green "success" color even when 0 URLs succeeded (now red)
- `web_search` queries parameter described as "parallel" in schema but execution is sequential (changed to "batch"; `urls` correctly remains "parallel")
- Proper error propagation for frame extraction: missing binaries (yt-dlp, ffmpeg, ffprobe), private/age-restricted/region-blocked videos, expired stream URLs (403), timestamp-exceeds-duration, and timeouts all produce specific user-facing messages instead of silent nulls
- `isTimeoutError` now detects `execFileSync` timeouts via the `killed` flag (SIGTERM from timeout was previously unrecognized)
- Float video durations (e.g. 15913.7s from yt-dlp) no longer produce out-of-range timestamps — durations are floored before computing frame positions
- `parseTimestamp` consistently floors results across both bare-number ("90.5" → 90) and colon ("1:30.5" → 90) paths — previously the colon path returned floats
- YouTube thumbnail assignment no longer sets `null` on the optional `thumbnail` field when fetch fails (was a type mismatch; now only assigned on success)

### New files
- `gemini-search.ts` -- search routing + Gemini Web/API search providers with grounding
- `gemini-url-context.ts` -- URL Context API extraction + Gemini Web extraction fallback
- `video-extract.ts` -- local video file detection, Gemini Web/API analysis with Files API upload
- `utils.ts` -- shared formatting and error helpers for frame extraction

## [0.6.0] - 2026-02-02

### Added
- YouTube video understanding in `fetch_content` via three-tier fallback chain:
  - **Gemini Web** (primary): reads Chrome session cookies from macOS Keychain + SQLite, authenticates to gemini.google.com, sends YouTube URL via StreamGenerate endpoint. Full visual + audio understanding with timestamps. Zero config needed if signed into Google in Chrome.
  - **Gemini API** (secondary): direct REST calls with `GEMINI_API_KEY`. YouTube URLs passed as `file_data.file_uri`. Configure via `GEMINI_API_KEY` env var or `geminiApiKey` in `~/.pi/web-search.json`.
  - **Perplexity** (fallback): uses existing `searchWithPerplexity` for a topic summary when neither Gemini path is available. Output labeled as "Summary (via Perplexity)" so the agent knows it's not a full transcript.
- YouTube URL detection for all common formats: `/watch?v=`, `youtu.be/`, `/shorts/`, `/live/`, `/embed/`, `/v/`, `m.youtube.com`
- Configurable via `~/.pi/web-search.json` under `youtube` key (`enabled`, `preferredModel`)
- Actionable error messages when extraction fails (directs user to sign into Chrome or set API key)
- YouTube URLs no longer fall through to HTTP/Readability (which returns garbage); returns error instead

### New files
- `chrome-cookies.ts` -- macOS Chrome cookie extraction using Node builtins (`node:crypto`, `node:sqlite`, `child_process`)
- `gemini-web.ts` -- Gemini Web client ported from surf's gemini-client.cjs (cookie auth, StreamGenerate, model fallback)
- `gemini-api.ts` -- Gemini REST API client (generateContent, file upload/processing/cleanup for Phase 2)
- `youtube-extract.ts` -- YouTube extraction orchestrator with three-tier fallback and activity logging

## [0.5.1] - 2026-02-02

### Added
- Bundled `librarian` skill -- structured research workflow for open-source libraries with GitHub permalinks, combining fetch_content (cloning), web_search (recent info), and git operations (blame, log, show)

### Fixed
- Session fork event handler was registered as `session_branch` (non-existent event) instead of `session_fork`, meaning forks never triggered cleanup (abort pending fetches, clear clone cache, restore session data)
- API fallback title for tree URLs with a path (e.g. `/tree/main/src`) now includes the path (`owner/repo - src`), consistent with clone-based results
- Removed unnecessary export on `getDefaultBranch` (only used internally by `fetchViaApi`)

## [0.5.0] - 2026-02-01

### Added
- GitHub repository clone extraction for `fetch_content` -- detects GitHub code URLs, clones repos to `/tmp/pi-github-repos/`, and returns actual file contents plus local path for further exploration with `read` and `bash`
- Lightweight API fallback for oversized repos (>350MB) and commit SHA URLs via `gh api`
- Clone cache with concurrent request deduplication (second request awaits first's clone)
- `forceClone` parameter on `fetch_content` to override the size threshold
- Configurable via `~/.pi/web-search.json` under `githubClone` key (enabled, maxRepoSizeMB, cloneTimeoutSeconds, clonePath)
- Falls back to `git clone` when `gh` CLI is unavailable (public repos only)
- README: GitHub clone documentation with config, flow diagram, and limitations

### Changed
- Refactored `extractContent`/`fetchAllContent` signatures from positional `timeoutMs` to `ExtractOptions` object
- Blob/tree fetch titles now include file path (e.g. `owner/repo - src/index.ts`) for better disambiguation in multi-URL results and TUI

### Fixed
- README: Activity monitor keybinding corrected from `Ctrl+Shift+O` to `Ctrl+Shift+W`

## [0.4.5] - 2026-02-01

### Changed
- Added package keywords for npm discoverability

## [0.4.4] - 2026-02-01

### Fixed
- Adapt execute signatures to pi v0.51.0: reorder signal, onUpdate, ctx parameters across all three tools

## [0.4.3] - 2026-01-27

### Fixed
- Google API compatibility: Use `StringEnum` for `recencyFilter` to avoid unsupported `anyOf`/`const` JSON Schema patterns

## [0.4.2] - 2026-01-27

### Fixed

- Single-URL fetches now store content for retrieval via `get_search_content` (previously only multi-URL)
- Corrected `get_search_content` usage syntax in fetch_content help messages

### Changed

- Increased inline content limit from 10K to 30K chars (larger content truncated but fully retrievable)

### Added

- Banner image for README

## [0.4.1] - 2026-01-26

### Changed
- Added `pi` manifest to package.json for pi v0.50.0 package system compliance
- Added `pi-package` keyword for npm discoverability

## [0.4.0] - 2026-01-19

### Added

- PDF extraction via `unpdf` - fetches PDFs from URLs and saves as markdown to `~/Downloads/`
  - Extracts text, metadata (title, author), page count
  - Supports PDFs up to 20MB (vs 5MB for HTML)
  - Handles arxiv URLs with smart title fallback

### Fixed

- Plain text URL detection now uses hostname check instead of substring match

## [0.3.0] - 2026-01-19

### Added

- RSC (React Server Components) content extraction for Next.js App Router pages
  - Parses flight data from `<script>self.__next_f.push([...])</script>` tags
  - Reconstructs markdown with headings, tables, code blocks, links
  - Handles chunk references and nested components
  - Falls back to RSC extraction when Readability fails
- Content-type validation rejects binary files (images, PDFs, audio, video, zip)
- 5MB response size limit (checked via Content-Length header) to prevent memory issues

### Fixed

- `fetch_content` now handles plain text URLs (raw.githubusercontent.com, gist.githubusercontent.com, any text/plain response) instead of failing with "Could not extract readable content"

## [0.2.0] - 2026-01-11

### Added

- Activity monitor widget (`Ctrl+Shift+O`) showing live request/response activity
  - Displays last 10 API calls and URL fetches with status codes and timing
  - Shows rate limit usage and reset countdown
  - Live updates as requests complete
  - Auto-clears on session switch

### Changed

- Refactored activity tracking into dedicated `activity.ts` module

## [0.1.0] - 2026-01-06

Initial release. Designed for pi v0.37.3.

### Added

- `web_search` tool - Search via Perplexity AI with synthesized answers and citations
  - Single or batch queries (parallel execution)
  - Recency filter (day/week/month/year)
  - Domain filter (include or exclude)
  - Optional async content fetching with agent notification
- `fetch_content` tool - Fetch and extract readable content from URLs
  - Single URL returns content directly
  - Multiple URLs store for retrieval via `get_search_content`
  - Concurrent fetching (3 max) with 30s timeout
- `get_search_content` tool - Retrieve stored search results or fetched content
  - Access by response ID, URL, query, or index
- `/search` command - Interactive browser for stored results
- TUI rendering with progress bars, URL lists, and expandable previews
- Session-aware storage with 1-hour TTL
- Rate limiting (10 req/min for Perplexity API)
- Config file support (`~/.pi/web-search.json`)
- Content extraction via Readability + Turndown (max 10k chars)
- Proper session isolation - pending fetches abort on session switch
- URL validation before fetch attempts
- Defensive JSON parsing for API responses
