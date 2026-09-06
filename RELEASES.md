# Release Notes

This file is the public release history for Feynman. Keep entries user-facing: what changed, why it matters, and anything users should do after upgrading.

GitHub release notes are generated from the matching `## vX.Y.Z` section in this file.

## Unreleased

## v0.3.48 - 2026-09-06

### Installation and source reliability

- Moved the canonical GitHub repository to `advaitpaliwal/feynman`. Native installers, skills downloads, package source/issue metadata, and public documentation now use the new owner directly.
- The canonical npm package is now `@advaitpaliwal/feynman`. Migrate old npm installs with `npm uninstall -g @companion-ai/feynman`, then `npm install -g @advaitpaliwal/feynman`. Future npm updates use `npm install -g @advaitpaliwal/feynman@latest`. The command remains `feynman`, and native install commands are unchanged.
- Historical release attestations retain their original source identity; new releases are verified against the new repository owner without relaxing provenance checks.
- Updated affected URL/query parsing dependencies in the CLI and bundled research runtime, plus the website's browser-target resolver, to patched versions.

## v0.3.47 - 2026-08-26

### Research continuity

- Resuming a valid Pi session whose JSONL file lacks a trailing newline now repairs the append boundary before new research messages are persisted, preventing the next record from being fused into the previous one.
- `/btw` and `/btw:summarize` now copy extension-registered providers, native providers, and temporary runtime API keys into their isolated child `ModelRuntime`. Side research can use the same custom provider that is already active in the main session.

### Web research

- Updated `pi-web-access` to `0.25.0`. Researchers can route search and fetch calls through an explicit HTTP(S) proxy, retrieve bounded GitHub issue and pull-request documents with comments and review threads, use Defuddle when ordinary HTML extraction is insufficient, and select Chromium browser/profile cookies explicitly.
- Gemini generate-content paths can use Google Application Default Credentials for Vertex AI, and Kimi Code Plan accounts can be selected explicitly for web search. Stored-content passage lookup also tolerates bridge defaults when `findText` is supplied.

### Observability

- Generic HTTP OTLP collectors configured through one shared endpoint now receive traces, metrics, and logs at their signal-specific `/v1/*` paths, including collectors on default HTTP and HTTPS ports. Explicit per-signal endpoints remain exact and retain their own headers and protocols; Feynman's PostHog AI trace endpoint is unchanged.
- Existing `0.3.45` pi-otel package roots migrate through the reviewed legacy digest. Embedded package setup and runtime-workspace preparation preflight every discovered pi-btw and pi-otel root before applying their combined patch plan, so an unsupported later root cannot leave earlier research packages partially updated.
- Session shutdown now flushes the telemetry SDK in its own handler, while `/otel` dashboard and collector overrides clear stale per-signal routing before rewiring exporters.

### Proxy and credential safety

- Explicit proxy credentials, target URLs, and provider request headers are delivered to curl over stdin instead of appearing in process arguments. GitHub repository clones now follow the same scoped proxy, `NO_PROXY`, and forced-direct decision as GitHub API requests.
- Vertex ADC setup documentation no longer combines `geminiAuth: "adc"` with an API key that would select API-key mode.

### Validation

- Added exact source, published-upgrade, patch-plan transaction, package-tree, runtime-archive, executable OTLP handler, stdin-only proxy credential, GitHub clone proxy, installed-runtime OTLP behavior, GitHub document, Gemini ADC, Kimi credential, BTW provider, and unterminated-session regressions.
- Runtime archives omit npm's pre-patch hidden lock metadata and verify its absence, so `npm ls` reads the committed exact lock instead of a stale nested Undici version.

## v0.3.46 - 2026-08-26

### Superseded release

- Do not install `0.3.46`. Its canceled workflow was retried and published the superseded `6bbb6e8` tree with a pi-otel shutdown failure, explicit proxy/provider credentials in process arguments, and stale npm runtime metadata. Upgrade to `0.3.47` or later.

## v0.3.45 - 2026-08-26

### Release reliability

- Windows publication smoke tests now use the supported .NET ZIP extractor instead of the pathologically slow PowerShell `Expand-Archive` cmdlet, so large native research bundles complete within the release job budget.
- Source-checkout runtime archive rebuilds now use the same fifteen-minute process budget as exact locked runtime restores, avoiding premature timeouts on slow clean environments while retaining the existing transactional exact-lock checks.

### Validation

- Added workflow and runtime regressions that bind Windows native extraction and source-archive rebuilding to their supported timeout contracts.

## v0.3.44 - 2026-08-26

### Research continuity

- Stopping a tool run now ends the active Pi loop before queued steering or follow-up research input can be drained into an already-aborted model call. The queued input remains available for the next turn instead of producing a second spurious cancellation.

### Compaction integrity

- Small-context local and proxy models now bound compaction reserve and retained-history budgets to the model's actual context window, preventing empty or short sessions from compacting continuously.
- Empty or structurally unusable summaries no longer replace research history. OpenAI Responses providers such as Grok also omit `tool_choice` when a compaction request has no tools.

### Model reliability

- OpenAI-compatible structured reasoning deltas are accumulated without reparsing and reserializing the complete history for every streamed detail, preventing long reasoning streams from blocking the event loop while preserving same-model replay.
- OpenAI models reached through Amazon Bedrock now receive images returned by research tools as sibling user-image blocks instead of unsupported images nested inside `toolResult.content`. Text stays attached to its tool result, image-only results retain an explicit placeholder, and Anthropic Bedrock models keep their native nested-image shape.

### Runtime reliability

- Non-interactive Pi extension handler work now has a cumulative 30-second budget. A handler that never settles reports its extension and event, expires its local context, safely absorbs late settlement, and lets later handlers and the research session continue.
- Timed-out model-tool and user-shell policy handlers still allow later policy handlers to run, then fail closed. User-shell interception returns an explicit non-executing result, so both TUI and RPC paths do not run the command after a policy timeout.
- Project trust, OAuth, and interactive dialogs preserve their supported behavior: documented UI prompts pause the remaining handler budget instead of resetting it, parent cancellation settles even a non-cooperative dialog, and OAuth callbacks remain outside the bounded event runner.

### Document research

- Updated the bundled LiteParse runtime to `2.14.0`. OCR rasterization now runs in bounded worker-sized rounds, and dense PDF layout deduplication avoids quadratic work. Existing parse, search, and screenshot interfaces are unchanged.

### Validation

- Added executable abort-queue, Responses payload, structured-reasoning scale, small-context compaction, and summary-usability regressions across the maintained Pi runtime.
- Added executable extension-handler deadline coverage for downstream progress, timeout reporting, expired contexts, late rejection handling, fail-closed TUI/RPC user-shell interception, cumulative dialog timing, parent cancellation, project trust, and tool permission dialogs.
- Added exact source, root/nested runtime, package-tree, and runtime-archive verifier coverage for Bedrock tool-result images across bare, regional, and global OpenAI model IDs, with an Anthropic control.
- Re-ran installed document parsing, page-count, search, screenshot, package-artifact, runtime, and clean-consumer verification against LiteParse `2.14.0`.

## v0.3.43 - 2026-08-25

### Installation reliability

- Upgrading from an older Feynman installation no longer crashes while migrating a legacy `pi-subagents` package's agent diagnostics source. Fresh native-bundle installs and updates now tolerate the older management-source layout while preserving malformed-agent diagnostics.

### Validation

- Added an executable source regression for the `pi-subagents@0.37.2` management layout that previously raised `missing management list diagnostics` during `--version`.

## v0.3.42 - 2026-08-25

### Reasoning integrity

- Same-model research turns now preserve structured reasoning metadata through session persistence and model replay instead of flattening or dropping it.
- When research history crosses a provider boundary, Feynman strips provider-private reasoning fields before forwarding it, preventing incompatible metadata from leaking into the next model's context.

### Runtime reliability

- Runtime preparation now repairs stale Pi AgentCore copies to the current maintained patch before verification, so restored and installed research runtimes cannot retain an older patch shape.

### Validation

- Reasoning and AgentCore patch validators now fail closed on missing, mixed, or stale transformations across source, bundled, restored, installed, and package-artifact copies.

## v0.3.41 - 2026-08-25

### Research continuity

- Custom research messages queued while a Pi turn is active now wait until the turn settles before they are persisted and emitted. Tool results remain adjacent to their calls, and `triggerTurn: false` notifications no longer corrupt resumable session history.
- Extension-supplied research prompts now preserve interleaved text and image order through idle, steering, and follow-up delivery, so captions and questions stay attached to the intended figure.
- Large rendered tool diffs no longer hit V8's argument-count limit. Feynman's Pi runtime also resolves `fd` and `rg` releases through GitHub's public redirect without spending anonymous API quota.

### Research images

- JPEG conversion and provider-bound resizing now continue past XMP APP1 metadata to apply a later EXIF orientation block. Figures, scans, photographs, and microscopy images no longer remain sideways when XMP precedes EXIF.

### Model reliability

- OpenAI-compatible Gemini 3 streams now preserve the first Google thought signature and encrypted reasoning details together across persisted tool-call replay.
- Foreign OpenAI-compatible tool-call IDs now retain the full hash when they must be sanitized and bounded, reducing cross-provider replay collisions.
- OpenRouter's structured `in_flight_budget_exhausted` 402 responses can use their `Retry-After` budget without replacing ordinary 429 and server-error retries or overriding an explicit provider no-retry response.
- OpenAI-compatible compaction no longer sends `tool_choice: "none"` when no tools are present, avoiding requests that strict gateways reject before summary generation.

### Runtime reliability

- An opt-in `FEYNMAN_PI_STREAM_EVENT_IDLE_TIMEOUT_MS` watchdog can terminate a provider stream that stops producing Pi events, even when the provider's iterator cleanup never settles. It remains disabled by default for local and private models that legitimately spend time in silent prefills.

### Validation

- Ported the focused Pi fixes from commits `240eb29c` (following contributor precursor `7b1dcfd`), `8c16a558`, `6d05adb`, `94f6e7c`, `d8def812`, `fe37e9f9`, `27115254`, and `86c42324`, plus the structured OpenRouter retry correction, across source, bundled, restored, installed, and package-artifact copies. Added fail-closed source-map checks, restored-runtime coverage, provider and image regressions, and clean installed-package verification.

## v0.3.40 - 2026-08-24

### Research continuity

- Image-only steering and follow-up messages are now removed from Pi's pending queue state when they are delivered. Research sessions that add screenshots, paper figures, or other image context no longer remain falsely marked as waiting on input after the model receives the image.

### Validation

- Reproduced the defect on the bundled Pi `0.84.2`: the agent queue was empty after image delivery while `pendingMessageCount` remained `1` and no clearing `queue_update` event was emitted. Ported the focused fix from commit `b67b3db` across source, bundled, restored, installed, and package-artifact copies, with executable steering and follow-up regressions plus fail-closed patch verification.

## v0.3.39 - 2026-08-24

### Research continuity

- Pi no longer persists a partial compaction, split-turn, or branch summary when summary generation reaches its output-token limit. The incomplete checkpoint now fails explicitly so long research sessions retain the last complete context instead of silently replacing it with truncated history.

### Reliability

- Updated `posthog-node` to `5.51.1`. On Node 24.16 and later, each telemetry flush now sends gzip bytes directly instead of retaining a native `BlobReader` for the life of the process.

### Validation

- Backported Pi commit `97fa14e` across source, bundled, restored, installed, and package-artifact copies, with executable history, split-turn, and branch-summary regressions. Disabled stale upstream source-map directives in the forward-patched files so diagnostics cannot resolve the new guards to unrelated pre-patch TypeScript lines. Matched the PostHog fix to upstream commit `3593c43` and added a transport regression that requires a `Uint8Array` gzip body instead of a `Blob`.

## v0.3.38 - 2026-08-24

### Research artifacts

- Congress.gov and GovInfo bill parsing now excludes paired white-on-white GPO operator and print-tracking stamps from parsed text, JSON text items, and document search. Removal requires matching metadata, geometry, and exact rendered-white regions, so visible bill text and visible text that merely resembles a stamp remain available.

### Research runtime

- Pi's edit tool now preserves the original CRLF, LF, and CR terminators outside each replacement. Exact and fuzzy edits no longer create unrelated full-file diffs in mixed-line-ending research code or data.

### Validation

- Reproduced the hidden-stamp path with official 2008 and 2026 GPO bill PDFs and verified consistent parsed artifacts and searches with visible body-text, same-geometry black, white-on-dark, and white-on-RGB-245 controls.
- Added exact, fuzzy, multiline, bare-CR, restored-runtime, package-artifact, and clean installed-package regressions for the maintained Pi and pi-docparser patches.

## v0.3.37 - 2026-08-23

### Research visualization

- Updated IGV to `3.8.5`. Embedded VCF, BED, and GFF genome previews now load IGV's legacy URL-mapping catalog from `igv.org` instead of raw GitHub, avoiding unnecessary blocked-origin warnings under restrictive content-security policies.

### Validation

- Matched the installed package to the published `3.8.5` npm artifact and upstream commit `1ff36cd`, with an executable regression for the supported mapping origin.

## v0.3.36 - 2026-08-23

### Research runtime

- Cross-platform runtime repair now allows up to fifteen minutes for the exact locked npm restore. This keeps slow Windows and Node 25 clean installs from terminating a valid research-runtime rebuild at the previous five-minute process limit.

### Validation

- Reproduced the published `0.3.35` failure on Windows with Node 25 after npm exhausted the five-minute child-process budget, while the same package passed the other five Node/OS consumers and all three native installers.
- Added an exact timeout regression and retained fail-closed lock, package-graph, and post-install verification.

## v0.3.35 - 2026-08-22

### Research runtime

- Installed packages no longer accept a partial bundled-runtime extraction merely because the top-level research extensions happened to arrive first. Feynman verifies the complete staged tree before publishing it, retains only known Windows npm links whose targets exist, and runs fallback from the archive's exact npm lock with maintained runtime patches applied before publication.
- Windows runtime restoration now recreates legacy Pi package aliases as traversable directory links before launch, with a copy fallback when links are unavailable.
- Configured provider-qualified research subagents now fail explicitly if the child reports that it actually launched on a different active model, instead of silently completing with misleading model metadata.
- Research prompts beginning with `-` now pass safely through Pi's standard `--` end-of-options delimiter instead of being mistaken for runtime options.
- Updated `pi-web-access` to `0.24.2`. Automatic search prefers Codex-backed OpenAI search when the active model is `openai-codex`, keeps Exa first for other models, and reads Windows Chromium cookie expiries without overflowing JavaScript numbers.

### Workbench security

- Updated Ketcher to `3.17.2`, which renders monomer labels from opened chemistry artifacts as text instead of interpolating them as HTML.

### Validation

- Added atomic restore, completion-marker, package-lock-graph, missing-transitive-file, exact-lock fallback, pre-publication patch, crash-backup, stale-lock, stale-stage cleanup, Windows npm-link and Pi-alias repair, terminated-process, child-model verification, dash-leading prompt, exact `pi-web-access@0.24.2` source, model-routing, Windows-cookie, and Ketcher monomer-label regressions.

## v0.3.34 - 2026-08-22

### Research runtime

- Existing Pi `auth.json` and dynamic `models-store.json` files now retain administrator-managed modes and ACLs when Feynman updates them. On POSIX systems, newly created state files still use owner-only `0600` permissions.
- Research subagent guidance now directs explicit model selection through `feynman model list` and tells the parent to use an exact approved `provider/model`. Raw unscoped registry output is not added to the tool.
- Bundled and restored alphaXiv research runtimes now retain structured search-result parsing after Feynman rebuilds their runtime archive.
- Clean package builds now publish the bundled runtime archive only after compression closes, preventing intermittent partial-archive reads on Node 25.

### Validation

- Backported Pi's focused managed-state permission fix from commit `c49906e` and the Feynman-safe guidance portion of pi-subagents commit `62e0934`.
- Added exact transformation, fail-closed, fresh-file, existing-mode, launch-root, restored-runtime, installed-package, registered-tool, runtime-archive parser, and atomic archive-publication regressions.

## v0.3.33 - 2026-08-22

### Research evidence

- arXiv metadata now accepts only the requested paper's Atom entry plus exact HTTPS arXiv paper and PDF links instead of trusting labels or URL substrings from untrusted responses.
- Europe PMC full text decodes XML entities exactly once, preserving nested encodings instead of changing their research meaning.
- UCSC track descriptions now remove nested provider markup while preserving scientific comparisons in research results.
- Updated `fast-xml-parser` to `5.11.0` for unsafe entity validation, multiple-DOCTYPE rejection, and malformed XML handling.

### Workbench security

- OAuth access tokens, refresh tokens, and pending PKCE state now use atomic writes. On POSIX systems, current and migrated destination stores use `0600` files inside `0700` workspace-state directories; workspace-controlled symlinks are rejected, and legacy workspace sources are never permission-mutated during migration.
- Unexpected workbench request and OAuth callback failures now return generic responses. Local diagnostics retain only a standard error class and a bounded message fingerprint, not private paths or provider details.
- Malformed launch cookies stay unauthorized without disrupting the workbench, invalid streaming requests fail before HTTP success, and interrupted streams end with an explicit terminal error instead of silent success.
- End-to-end release workflows now declare read-only repository permissions explicitly.

### Reliability

- Updated `posthog-node` to `5.50.0`, including fixes for queue flushing, response-body timeouts, compression memory growth, shutdown, and telemetry value serialization.
- Added executable regressions for XML entities, arXiv link origins, OAuth store permissions, generic server errors, UCSC markup, and workflow permissions.

## v0.3.32 - 2026-08-21

### Web research

- Updated `pi-web-access` to `0.24.1`. Direct page retrieval now uses the upstream compatibility identity so more public sources return readable content.
- GitHub source retrieval now validates repository identities and isolates clone-cache destinations by digest before cleanup.
- `pdf.maxPages` can bound Datalab, Gemini, and local PDF extraction. It defaults to `100`.
- `openaiSearchProviders` can choose the ordered Pi provider list used for OpenAI-compatible `web_search` calls.
- Automatic search now prefers Codex-backed OpenAI retrieval when the active model is `openai-codex`; other models try Exa before OpenAI.
- Opt-in Chrome and Edge research on Windows now reads modern large cookie-expiry values safely in addition to using the corrected PowerShell 5.1 DPAPI path.

### Validation

- Matched every patched source fixture to the published `pi-web-access@0.24.1` package and GitHub tag `v0.24.1`.
- Preserved Feynman's exact config path, private cache, session model scope, Firecrawl loopback redirect confinement, browser-cookie opt-in, request deadlines, and Windows PowerShell 5.1 DPAPI correction.
- Added executable retrieval-header, GitHub identity, PDF page-limit, model-aware provider-priority, large Windows cookie-expiry, restored-runtime, and installed-package regressions.

## v0.3.31 - 2026-08-21

### Research agents

- Research subagents now stop after a context-window overflow instead of retrying the same oversized input on fallback models.
- Completed subagent tools no longer remain marked active when Pi backfills a result without a separate execution-end event.
- Logical subagent failures now reach the model as failed tool results. The model no longer treats an invalid or failed research-agent action as success.

### Web research

- Opt-in Gemini Web research on Windows can now read Chrome and Edge `v10` cookies through current-user DPAPI.
- Chromium `v20` app-bound cookies remain blocked and now return a clear diagnostic instead of a false authentication success.

### Validation

- Ported only the focused upstream `pi-subagents` context-overflow, tool-result backfill, and logical-failure corrections into the bundled research-agent runtime.
- Added exact-source, restored-runtime, installed-package, model-loop, tool-result backfill, logical-failure, and native Windows DPAPI regressions.

## v0.3.30 - 2026-08-21

### Web research

- Readable page extraction now replaces inline `data:` URI payloads with bounded omission markers before content reaches model context, the fetched-content cache, or session persistence. Raw mode still returns the exact textual response body.
- Self-hosted Firecrawl API endpoints may use `localhost`, `127.0.0.0/8`, or `::1`. The exception stays limited to the configured API origin, including redirects, and does not permit loopback research targets.
- Linux curator launches now detach `xdg-open`, so the browser process cannot hold a completed web search open.

### Validation

- Ported three focused post-`0.24.0` fixes from `pi-web-access` while preserving Feynman's exact config path, private cache, session model scope, and existing provider controls.
- Added executable readable/raw extraction, Firecrawl loopback and redirect isolation, Linux launch-failure, restored-runtime, and installed-package regressions.

## v0.3.29 - 2026-08-21

### Biomedical literature

- Concurrent PubMed, ClinVar, GEO, and other NCBI requests now share one paced queue. Literature-review turns no longer drop NCBI evidence after a burst of `429 Too Many Requests` responses.
- `NCBI_API_KEY` now reaches E-utilities while remaining redacted from reported provenance. Keyed requests use the higher NCBI budget, and `NCBI_MIN_REQUEST_GAP_MS` can set a wider delay for shared IP addresses.
- PubMed request timeouts now cover the response body as well as the initial headers.

### Research runtime

- Summary-only compaction and branch requests now disable tool calls across Pi providers. Feynman also rejects unexpected tool-call responses before they can enter a research summary.
- Provider-neutral tool choice now reaches Anthropic, Azure OpenAI, Bedrock, Google, Mistral, OpenAI, and Codex requests.
- Updated `pi-web-access` to `0.24.0` for current provider routing, provider base URLs, redirect credential stripping, and summary-model thinking suffixes. Feynman's private cache, exact config path, model scope, browser-cookie opt-in, and request deadlines remain intact.

### Validation

- Reproduced the anonymous 12-search NCBI burst on `0.3.28` at `0/12`, then verified `12/12` successful calls with pacing.
- Added executable history, split-turn, and branch-summary guards across source, package archives, and installed runtimes.
- Matched every patched `pi-web-access@0.24.0` fixture to the published npm package before applying Feynman's maintained patch set.

## v0.3.28 - 2026-08-18

### Research agents

- Delegated research now treats provider subscription usage-limit errors as retryable. Configured fallback models continue instead of ending the run.

### Model inputs

- Baseten GLM 5.2 and GLM 5.2 Fast now accept image inputs. Paper figures and other attached research images reach these models.
- Pi's model-data manifest now matches every backported catalog shard and its final model structure.

### Validation

- Backported the two focused upstream corrections across local, packaged, restored, and installed runtime copies.
- Added executable fallback behavior plus complete catalog hash and structure checks across source, package archives, and installed runtimes.

## v0.3.27 - 2026-08-17

### Provider reliability

- Google and Vertex models now honor model-specific thinking-level maps. Extended or remapped levels produce the supported provider level and use its matching token budget.
- Bedrock gateway response callbacks now receive the raw Smithy response headers. Provider routing and request headers no longer disappear before Feynman can record them.

### Model catalogs

- Removed deprecated Xiaomi MiMo model IDs while keeping the current MiMo 2.5 models across direct and token-plan providers.
- Added the current China Z.AI Coding Plan models, including GLM-4.6V, GLM-5.1, and GLM-5V-Turbo. Matching API-priced models now report their reference costs.

### Validation

- Backported four focused fixes from Pi after `0.84.2` and applied them to root, nested, packaged, and restored runtime copies.
- Added direct Google, Vertex, Bedrock, Xiaomi, and Z.AI regressions plus installed-package and archive checks.

## v0.3.26 - 2026-08-17

### Document research

- Updated the bundled LiteParse runtime to `2.13.1`. Multi-line table headers now keep in-table cells between established columns instead of silently dropping them. The existing parse, search, and screenshot tools keep their current interface.

### Validation

- Added an installed-runtime regression that reproduces the lost table-header cell and checks the corrected Markdown table.
- Re-ran the installed document parse, search, and screenshot flow against the bundled runtime.
- Fixed cross-Node runtime repair to preserve the bundled exact package manifest and overrides. Node 22 consumers now keep LiteParse `2.13.1` instead of reinstalling pi-docparser's older transitive default.

## v0.3.25 - 2026-08-16

### Research agents

- A malformed custom agent definition no longer blocks unrelated valid research agents from loading or running.
- Direct requests for a malformed agent now report its invalid configuration instead of using a lower-priority definition.
- Agent listings and doctor diagnostics now identify malformed definitions without stopping discovery.
- The default subagent tool now uses concise split prompt metadata, reducing always-loaded instructions while keeping explicit full, compact, and custom modes.

### Package reliability

- Existing `pi-web-access@0.22.0` core pins now upgrade to the bundled `0.23.0` release before launch.

### Validation

- Backported the focused upstream `pi-subagents` malformed-agent isolation fix and added installed-runtime and stale-settings regressions.

## v0.3.24 - 2026-08-15

### Document research

- Updated the bundled LiteParse runtime to `2.13.0`. Document parsing now improves garbled-text detection for mixed-font papers and uses layout-aware block classification for richer structured extraction. The existing parse, search, and screenshot tools keep their current interface.

### Validation

- Re-ran the installed document parse, search, and screenshot flow against the bundled runtime.

## v0.3.23 - 2026-08-15

### Provider login reliability

- GitHub Copilot sign-in now enables model policies sequentially instead of sending a burst of parallel requests.
- If Copilot rate-limits model discovery, Feynman honors `Retry-After` and retries once instead of ending sign-in.

### Validation

- Added exact source, packaged-runtime, and login regressions for the Copilot rate-limit path.

## v0.3.22 - 2026-08-14

### Web research

- Updated `pi-web-access` to `0.23.0`. Researchers can use Firecrawl search and opt-in authenticated browser fetch profiles.
- Preserved Feynman's exact web-search config path, private fetched-content cache, resolved Pi model scope, browser-cookie opt-in, raw-result default, and bounded primary-search deadline.

### Research runtime

- Updated the bundled Pi runtime to `0.84.2`. Fullscreen transcript search now supports match navigation and configurable match colors.
- Managed tool downloads now report progress after the TUI mounts, and model catalog refreshes no longer restart when a selector opens during startup.
- Optional non-nullable tool arguments that arrive as `null` are now omitted before execution, while other malformed arguments remain rejected.

### Validation

- Added exact-source gates for the `pi-web-access@0.23.0` contract and refreshed the packaged runtime lock and archive.

## v0.3.21 - 2026-08-13

### Document research

- Updated the bundled LiteParse runtime to `2.12.0`. Document parsing now handles large documents more reliably and fixes rotated-page edge clipping and Markdown inline-code escaping. The existing parse, search, and screenshot tools keep their current interface.

### Validation

- Re-ran the installed document parse, search, and screenshot flow against the bundled runtime.

## v0.3.20 - 2026-08-12

### Current research

- Added the local current date to parent research turns and `researcher` child sessions.
- Required current-source checks for recent claims and stopped models from rejecting valid post-training data by date alone.

### Package reliability

- Reconciled Feynman-managed package sources to the exact bundled versions before launch.
- Removed stale managed shadow installs while preserving custom package selectors, package filters, and optional packages.

### Validation

- Added clean stale-settings, stale-install, broken-symlink, custom-package, and installed model-context regressions.

## v0.3.19 - 2026-08-11

### Web research

- Updated `pi-web-access` to `0.22.0`. Researchers can use Bocha as a configured search route.
- Added `maxInlineContentChars` for larger fetched-page and stored-content slices. The default remains 30,000 characters, with a 200,000-character cap.

### Reliability

- Adopted upstream fetched-content cache hardening and removed Feynman's temporary storage replacement.
- Preserved Feynman's exact config path, private cache location, model scope, browser-cookie opt-in, raw-result default, and 90-second primary-search deadline.

### Validation

- Added exact-source gates for Bocha routing, configurable content limits, cache hardening, and the full Feynman patch set.

## v0.3.18 - 2026-08-11

### Research agents

- Loaded Feynman's research-tool extension explicitly in every bundled `researcher` child session.
- Kept Hugging Face dataset and repository tools in the strict researcher allowlist without relying on ambient child discovery.

### Reliability

- Preserved custom researcher extension overrides while adding the bundled provider to default settings.
- Made the published subagent smoke reject unavailable child-tool diagnostics even when the parent model repeats a child result.

## v0.3.17 - 2026-08-11

### Web research

- Exposed the stored response ID in every single-URL `fetch_content` result, including short pages and failures. Researchers can now pass the exact ID to `get_search_content` instead of guessing from hidden tool details.
- Bounded the fetched-page cache to 128 entries and 128 MiB. Feynman removes expired entries first, then evicts the oldest entries until both limits hold.

### Security and reliability

- Normalized fetched-content cache permissions to `0700` directories and `0600` files on macOS and Linux.
- Rejected cache-directory and cache-entry symlinks, removed stale extension-owned temporary files, and moved writes to exclusive random temporary files with durable atomic replacement.
- Made concurrent pruning tolerate entries that another Feynman process already removed.

### Validation

- Ported the focused storage repair from upstream `pi-web-access` PR `#241` at commit `b3e784f`, while retaining Feynman's exact custom configuration path.
- Added regressions for model-visible response IDs, quota eviction, temporary-file cleanup, permissions, symlink rejection, and concurrent deletion.

## v0.3.16 - 2026-08-10

### Web research

- Updated `pi-web-access` to `0.21.0`. Full fetched pages now live in a private external cache instead of session JSONL, so search-heavy sessions stay bounded and restore without loading page bodies into the transcript.
- Added per-tool and per-command registration gates, direct-image and PDF extraction gates, and a configurable summary-generation deadline.
- Documented the exact `get_search_content` argument constraints and added `/web-results` for browsing stored web results without conflicting with session search.

### Reliability

- Kept the fetched-content cache beside Feynman's exact web-search configuration, including custom `FEYNMAN_WEB_SEARCH_CONFIG` paths.
- Preserved Feynman's project-local PDF scratch files, session model scope, browser-cookie opt-in, raw-result default, and bounded primary search deadline.
- Restored automatic package reconciliation for workspaces that retained the `0.3.15` core package pins.

### Validation

- Verified the exact upstream `0.21.0` source through all `437` tests, typecheck, production audit, and package inspection.
- Added regressions for external cache persistence, bounded session metadata, the `/web-results` gate translation, current feature markers, and installed tool and command registration gates.

## v0.3.15 - 2026-08-10

### Model selection

- Fixed the Pro-class cost guard so exact DeepSeek V4 Pro model IDs remain selectable across Pi providers. These open-weight models use ordinary provider pricing even though their product name contains `Pro`.
- Kept premium service tiers such as Gemini Pro and `o1-pro` blocked. Feynman does not provide a broad environment-variable bypass for future Pro-class models.
- Preserved an existing DeepSeek V4 Pro default during settings repair, included it in model lists and recommendations, and allowed explicit CLI and PaperRank synthesis selection.

### Validation

- Added regressions for Pi's direct, vendor-prefixed, and Fireworks DeepSeek V4 Pro IDs across catalog, recommendation, explicit-model, default-setting, and settings-normalization paths.

## v0.3.14 - 2026-08-10

### Web and document research

- Updated `pi-web-access` to `0.20.0`. Researchers can use keyless DuckDuckGo HTML search as an explicit provider or fallback route.
- Added optional Datalab PDF-to-Markdown extraction before Gemini and local PDF.js. Datalab retains tables, multi-column order, headings, links, and math, while the local parser remains the no-key fallback.
- Fixed Gemini Web requests that failed when Google response headers exceeded the host agent's default HTTP/1.1 header limit.

### Reliability

- Preserved Feynman's project-local fetch cache, exact web configuration path, session model scope, browser-cookie opt-in, and bounded search deadline across the upstream upgrade.
- Updated root and packaged runtime IP parsing to `10.5.0`, so IPv6 URL parsing fails gracefully for non-IPv6 hosts instead of throwing.
- Restored automatic package reconciliation for workspaces that retained the `0.3.13` core package pins.

### Validation

- Verified the exact upstream `0.20.0` source through all `425` tests, typecheck, production audit, and package inspection. Added installed-runtime checks for DuckDuckGo and Datalab.

## v0.3.13 - 2026-08-09

### Reliability

- Kept Pi agent-managed `brace-expansion` versions at or above the current secure `5.0.9` floor intact. A newer registry release can no longer stop Feynman during launch, while stale `5.0.6` through `5.0.8` trees still upgrade to the verified `5.0.9` package.
- Kept malformed and older unsupported versions fail-closed instead of weakening the launch-time security repair.

### Validation

- Added source, package-lock, installed-tree, and exact agent-managed runtime regressions for future `brace-expansion` versions.

## v0.3.12 - 2026-08-08

### Research runtime

- Updated the bundled Pi runtime to `0.84.1`. Provider authentication preflights, bounded blocked-tool termination, provider refresh transactions, and active-run reset protection now use Pi's current contracts.
- Updated Workbench chat for Pi's delta-only RPC stream. Live assistant text now accumulates correctly while the final `message_end` remains authoritative.

### Document research

- Updated `pi-docparser` to `4.0.0`. Native PDFium and OCR work now runs in isolated, cancellable child processes, so parser crashes and memory failures become bounded tool errors instead of terminating the research session.
- Added strict page, worker, DPI, search, screenshot, and output limits. Parse publication is atomic, JSON output has a stable `{ pages, text }` shape, screenshots default to page 1, and each call accepts at most four explicit pages.
- Removed the ImageMagick requirement for supported image inputs and updated LiteParse to `2.11.1`. The document runtime now includes stronger table extraction, RTL/LTR text ordering, and source-provenance metadata support. Document parsing requires Node.js `22.19.0` or newer; Feynman's supported Node floor already satisfies it.
- Added LiteParse's platform-native packages as optional npm dependencies, so one published Feynman tarball can parse documents on supported macOS, Linux, and Windows consumers.

### Web research

- Updated `pi-web-access` to `0.19.0`. `fetch_content` can now return raw textual HTTP responses, answer a question against one page while retaining its source text, retrieve direct PNG/JPEG/WebP/GIF images, and paginate long content on cleaner boundaries.
- Added exact, case-insensitive, and fuzzy passage lookup over stored page content through `findText` and `findMode`, plus current Jina Search, Kagi, Ollama Cloud, xAI, Bright Data, SerpBase, and authenticated SearXNG routes.
- Adopted current Kagi Search and Extract contracts, Gemini relay routing for local video requests, xAI quota fallback classification, and `:max` scoped summary-model matching.
- Preserved routed-provider model selection and hardened Git clone cancellation from upstream, including non-interactive credential handling and process-tree termination.

### Reliability

- Fixed `feynman alpha ask` sending obsolete `urls`/`url` arguments to alphaXiv. Paper Q&A now sends the current `paper` plus `queries` schema.
- Kept PDF scratch Markdown in the active project's `.feynman/cache/fetch-content`, kept browser-cookie access opt-in, retained the bounded primary search deadline, and adopted upstream's per-call curator isolation and no-browser timeout rather than carrying superseded local patches.
- Bound page-answer, search-rewrite, and curator summary model selection to Pi's resolved session model scope, including `--models` overrides, instead of rereading an adjacent settings file.
- Bound web-search configuration reads and writes to the same Feynman-managed path, including custom `FEYNMAN_WEB_SEARCH_CONFIG` locations, and create that file's parent before saving.
- Updated Feynman's direct, nested Pi, and packaged runtime copies of Undici to `8.10.0` for current idle-connection, readable-body, retry, HTTP/2, proxy IPv6, and DNS-origin fixes.
- Updated PDF.js to `6.2.108` and the website's audited JS-YAML and Nano ID trees to close current malicious-document and denial-of-service advisories.
- Removed macOS ACL, file-flag, Apple metadata, and extended-attribute records from bundled runtime archives so those host records no longer change package bytes.
- Updated audited Hono, `fast-uri`, `ip-address`, `express-rate-limit`, and website `brace-expansion` overrides after new registry advisories, and removed a streamed checksum-file handle from the Windows installer verifier.
- Restored automatic package reconciliation for workspaces retaining the `0.3.11`, `0.3.10`, or older `0.3.6` bundled package defaults.

### Validation

- Added an installed document-tool gate that loads the shipped TypeScript extension through Pi's bundled Jiti, then executes `document_parse`, `document_search`, and `document_screenshot` against a generated PDF.

## v0.3.11 - 2026-08-01

### Research agents

- Updated `pi-subagents` to `0.40.0` so delegated research runs have stable child identities, explicit signal-termination status, separate process and output-availability state, and clearer model and thinking-level visibility.
- Added session-scoped agent capability ceilings, chain approval checkpoints, reported token and cost budgets, and child-runtime extension acknowledgements for safer, more auditable multi-agent research workflows.
- Restored automatic package reconciliation for workspaces that retained either the `0.3.10` or older `0.3.6` bundled package defaults.

## v0.3.10 - 2026-08-01

### Runtime

- Updated the bundled Pi runtime train from `0.82.1` to `0.83.0`, including Pi's provider, session, package-install, headless OpenRouter sign-in, and extension model-scope improvements.
- Migrated Feynman's bundled extension runtime to Pi's TypeBox `1.3.7` contract. Extension authors must replace removed `Type.Base`, `Type.Awaited`, `Type.Promise`, `Type.AsyncIterator`, `Type.Iterator`, `Type.Options`, and `Value.Mutate` APIs before upgrading.
- Updated `pi-web-access` to `0.17.1` for bounded streamed fetches, Gemini-compatible provider schemas, and current search/extraction fixes, and updated `pi-subagents` to `0.38.0` for startup retries and bounded progress snapshots.

### Reliability

- Retained Feynman's fail-closed manual-compaction and eager parallel-result durability repairs because the owning upstream Pi issues remain open, and bound every Pi package plus artifact verification to the coordinated `0.83.0` train.
- Adopted Pi's native llama.cpp streaming-usage fix while preserving Feynman's automatic repair of older cached model metadata, so upgrades retain token accounting without deleting `models-store.json`.
- Reapplied the narrow Pi shrinkwrap repairs for `brace-expansion` `5.0.9` and Undici `8.9.0`; upstream Pi `0.83.0` still ships the affected `5.0.7` and `8.5.0` copies.
- Fixed `feynman update` writing user-package upgrades to a shadow npm prefix while Pi continued loading an older managed copy. Updates now target the resolved package root, reconcile stale exact-pinned core packages against Feynman's configured versions, preserve range and registry-tag selectors as unpinned sources, verify that attempted updates actually completed, and accept names such as `feynman update pi-subagents`; the in-app notice now points to that supported command.
- Fixed the Windows one-line installer failing on valid long archive entries. Extraction and rollback cleanup now run through a unique short temporary drive on the install volume while preserving the transactional replacement boundary.
- CLI analytics, log, and trace sends now make one attempt before opening a silent per-process circuit breaker, rather than printing PostHog transport errors into research output. The bundled Pi tracer also performs a silent status-checked HTTP preflight and skips exporter startup when Feynman's collector is blocked or returns an error. Set `FEYNMAN_DEBUG=1` for the single CLI diagnostic notice or `FEYNMAN_TELEMETRY=off` to disable telemetry explicitly.
- PaperRank model synthesis now rejects terminal provider errors and output-token truncation even when a failed stream contains partial text, so incomplete output cannot be labeled or written as a generated synthesis.
- Restored Feynman's 15 built-in research tools to `/tools` and `/capabilities` when Pi reports their source as the top-level `research-tools.ts` extension, including on Windows paths.

### Validation

- Added mixed-version and older/newer Pi rejection coverage, installed-package checks for all 15 Feynman tools and 9 extension commands, compilation of every installed tool schema, optional-array and malformed-null rejection through Pi's TypeBox 1.3 runtime path, managed/global package-update checks, long-path Windows installer fixtures, cached llama.cpp migration and streaming accounting checks, and exact runtime-lock and package-artifact verification.

## v0.3.9 - 2026-07-29

### Reliability

- Prevented Workbench and other RPC prompts submitted during manual compaction from being acknowledged and then lost. Pi now rejects the prompt before a success acknowledgment with a retryable error.
- Persisted each completed parallel tool result before slower siblings finish, so successful research evidence survives an abort or restart. Restored sessions and provider requests continue to present results in the assistant's original tool-call order.
- Replaced eagerly persisted tool results in place when an extension modifies the finalized message, preventing duplicate session entries and duplicate tool-usage accounting.
- Restored token accounting for the built-in llama.cpp provider by requesting streaming usage from compatible llama-server releases. Existing cached llama.cpp model metadata is repaired in place, so users do not need to delete `models-store.json` or repeat provider setup.
- Fixed plain HTTP API and MCP traffic behind `HTTP_PROXY` using a `CONNECT` tunnel that compatible proxies reject. HTTP targets now use absolute-form forwarding while HTTPS targets continue to tunnel.
- Replaced deprecated Windows shell-with-arguments launches in native builds and stale-upgrade verification with explicitly escaped `ComSpec` invocations.

### Package Stack

- Updated Feynman's direct and nested Pi Undici runtime from `8.5.0` to `8.9.0`. The narrow Pi manifest, shrinkwrap, and installed-tree repair can be removed after a supported Pi release requires Undici `8.7.0` or newer.

### Validation

- Strengthened the installed-package and native-bundle stale-Pi gate with representative shrinkwrap metadata and its vulnerable nested dependency, a complete persistent-fixture mutation allowlist, exact security-tree checks, and byte-idempotent second-launch verification.
- Added real RPC and proxy-server regressions, reopened-session checks while parallel work remains pending, real file-store and concurrent-refresh llama.cpp migration coverage, a mock SSE token-accounting check, and package-artifact mechanism checks for every temporary Pi correctness patch plus exact Pi shrinkwrap dependency, resolved URL, and integrity metadata.

## v0.3.8 - 2026-07-29

### Reliability

- Fixed standalone upgrades failing at launch with `Unsupported Pi editor layout` when an older Pi core dependency remained in the user's package directory. Startup now leaves stale Pi core entrypoints untouched while applying the narrow nested dependency security repair and continuing to patch installed extensions, which Pi loads against Feynman's current bundled runtime.

### Validation

- Added an installed-package and native-bundle upgrade smoke that stages representative Pi `0.80.6` core entrypoints, proves those entrypoints remain unchanged, verifies extension patching stays idempotent, and launches Feynman through RPC twice before a release can publish.

## v0.3.7 - 2026-07-28

### Reliability

- Fixed `npm install -g @companion-ai/feynman` producing an unusable CLI when npm left the direct OpenTelemetry API hoist target empty beside Feynman's bundled Pi packages. The package now bundles its exact direct telemetry API so global installs can start reliably.

### Validation

- Added clean global-install version and help smokes to every supported Linux, macOS, Windows, and Node `22`/`24`/`25` package-consumer gate, plus post-publication verification of the registry package.

## v0.3.6 - 2026-07-28

- Raised the npm-install Node 22 floor to `22.22.0`, matching the direct telemetry runtime's actual engine contract; standalone installers continue to bundle Node `24.18.0`.

### Reliability

- Fixed alphaXiv login after its OAuth migration by shipping the current OAuth2 endpoints and validating the loopback callback state before exchanging authorization codes. `feynman alpha status` now refreshes expired credentials and verifies them against the live user-info endpoint instead of treating any cached token as logged in.
- Fixed Windows one-line installs by extracting release archives into temporary staging before replacing the installed bundle.
- Fixed workbench state switching between newly minted local organizations when concurrent processes read `active-org.json` during a rewrite. Valid manifests are no longer rewritten, and required writes are atomic.
- Option+Enter now inserts a newline in Feynman's REPL input. Shift+Enter preserves Pi's follow-up action in terminals that report modified Enter keys, Ctrl+J remains a portable newline alternative, and existing user-modified keybindings remain untouched.
- Added `/thinking [level]` so reasoning effort is discoverable and directly adjustable inside the REPL while Shift+Tab remains available. The picker follows the active model's supported levels, including `max` where Pi exposes it.
- `fetch_content` now writes extracted PDF scratch Markdown under the active project's `.feynman/cache/fetch-content` instead of `~/Downloads`. Set `FEYNMAN_FETCH_CACHE_DIR` to override the location.
- Unknown CLI flags now point to `feynman help`, and `feynman update` help clarifies that extensions update with their packages rather than through a separate `--extensions` flag.

### Package Stack

- Added `pi-btw` to Feynman's default Pi package stack so `/btw` side conversations are available during long-running research turns without requiring a separate package install.
- Updated `pi-subagents` to `0.37.2` so child runs that disable inherited project context follow Pi's current context-file contract, while reducing repeated TUI and skill-file scans.
- Updated `pi-web-access` to `0.15.0`, adding simultaneous all-provider search with partial-failure diagnostics, TinyFish search and extraction, and configurable OpenAI Responses-compatible search gateways.
- Refreshed the bundled Pi runtime packages from `0.80.3` to `0.82.1`, migrated Feynman's model/auth integration to Pi's asynchronous `ModelRuntime`, and kept the runtime fallback pins aligned with the installed package set.
- Repaired the current Pi and MCP production dependency advisories in the packaged runtime by replacing Pi's vulnerable nested `brace-expansion` copy with `5.0.8`, updating MCP SDK to `1.30.0`, and pinning its compatible Hono server dependency to `2.0.12`. The Pi repair can be removed after upstream updates its shrinkwrap; the Hono pin can be removed after MCP no longer permits the vulnerable v1 range.
- Pinned the bundled runtime's complete dependency graph in a committed lockfile, upgraded its coordinated OpenTelemetry train to `2.10.0`/`0.221.0`, and made pruning changes and archive digests invalidate stale runtime artifacts. Startup now verifies every package named by the bundled runtime manifest, so a stale Pi copy is restored even when it is not itself a user-configured extension.
- Runtime and standalone archives now bind relative build inputs and the complete patched tree, reject stale or transplanted manifests, normalize archive metadata, and omit macOS AppleDouble metadata that previously doubled package size.
- Added pre-merge Linux package/consumer plus Windows PowerShell installer replacement gates. Release publication now promotes the exact verified tarball only after native bundles pass.
- Added explicit release-package budgets of 125 MiB compressed, 360 MiB unpacked, and 42,000 files around the current bundled research runtime so accidental package growth fails before publication.
- Pinned release executors and the bundled Node `24.18.0` archives, added Linux arm64 release builds, and made every standalone installer verify the published `SHA256SUMS` entry before replacing a working installation.

### Science Workbench

- Expanded `feynman serve` into a standalone open-science workbench surface with Feynman-owned project/session/frame state, project metadata, Pi chat, frame message rows, frame backfill health records, Feynman Bio Tools, notebooks, compute inventory, artifacts, lineage, provenance, settings, memory categories, onboarding intent context, and redacted credential availability ledgers.
- Added `feynman serve --no-auth` for trusted local testing with a plain localhost URL, while keeping the default tokenized local URL available.
- Flattened the workbench chat composer and activity-card state colors so focused, running, approval, and failed-fetch states stay in the green Feynman surface instead of rendering warm rounded edge accents.
- Added a Feynman-owned `~/.feynman/active-org.json` and `~/.feynman/orgs/<org_uuid>/` app spine so the local workbench has an org-scoped home structure instead of a flat scratch directory.
- Added a Feynman-owned org database at `~/.feynman/orgs/<org_uuid>/feynman-workbench.db`, refreshed from the local workbench state with reference-shaped project, frame, message, artifact, artifact-version, execution, verification, memory, note, annotation, read-cursor, artifact-folder, compute-provider, MCP-grant, memory-category, routine-schedule, managed-endpoint, and capability-setting tables.
- Added compact table envelopes in that database for the remaining reference-shaped workbench ledgers Feynman already owns in state, including agents, skills, credentials, OAuth tokens, events, notifications, session activity, claims, host logs, marketplace rows, and archive rows.
- Compute-provider rows in the org database now persist egress policy and Modal environment fields, including in-place upgrades for existing local databases. Split science connector attachments, split MCP grants, and custom MCP resource identifiers are mirrored through Feynman's owned ledger rows.
- Added a Feynman-owned chemistry sketcher tool that creates editable KET, Molfile, RXN, or SMILES artifacts under `outputs/chemistry-sketches/` for the local Ketcher editor, instead of requiring a reference-app MCP runtime.
- KET, RXN, CDXML, and CXSMILES chemistry artifacts now open as first-class molecule previews in the workbench. Feynman marks these scanner formats as previewable text artifacts, shows lightweight chemistry metadata, routes sketch files into the local Ketcher editor, and avoids trying to render Ketcher-only formats through RDKit.
- Moved app-owned workbench state into `~/.feynman/orgs/<org_uuid>/workbench/workspaces/<workspace-id>/`, including workbench settings, chat sessions, uploads, memory, annotations, OAuth token references, notebook logs, Modal job scripts, managed Python/R environments, artifact snapshots, and cloud-export audit logs. Existing home-level `~/.feynman/workbench` records and checkout-local `.feynman/workbench` records are copied forward on first access.
- Added Feynman-owned credential and setup-intent state so the workbench can show which research capabilities are available without exposing raw secrets or requiring another local app at runtime.
- Added Feynman-owned skill source and license-assent ledgers so the workbench can audit its bundled science skill pack without depending on an external marketplace service.
- Added Feynman-owned watch routine ledgers so `/watch` plans and baselines appear as honest scheduled or blocked routine state in the workbench.
- Added Feynman-owned contact-email and credential-ask decision ledgers so public database contact consent and provider credential readiness are auditable without exposing raw credential values.
- Added Feynman-owned compute poller lease rows so active compute jobs and pending terminations expose the same single-writer polling guard shape as the science workbench control plane.
- Added Feynman-owned review feedback rows so user-requested reviewer passes are auditable by frame, type, model, response id, and bounded context snapshot.
- Added Feynman-owned frame rows so projects, chat sessions, artifact runs, and upload areas expose a first-class control-plane frame spine through local state.
- Added Feynman-owned project metadata rows with local owner, created/updated timestamps, context, memory state, and upload-frame linkage.
- Added Feynman-owned frame message rows so persisted chat turns are auditable by frame id, message index, UUID, role, status, and structured message JSON.
- Added Feynman-owned frame backfill health records so failed historical frame imports can be tracked without inventing failures in clean workspaces.
- Chat-produced artifacts now attach to the producing session and project by snapshot/output provenance, so Run and Project file scopes, header metrics, artifact folders, versions, and verification evidence agree even when the file slug differs from the chat frame id.
- Files now show a host selector for local workspace artifacts, SSH/BYOC compute hosts, and cloud buckets derived from Feynman's owned compute and credential state.
- HTML report previews now support element-level annotation inside the sandboxed iframe, including selector/text capture, saved badges, and the same artifact annotation/refinement path used by text, image, and PDF anchors.
- Artifact Notes now open in workbench modals with target context, existing note count, add/edit/delete controls, Cmd/Ctrl+Enter save, note preview, and Open artifact navigation, backed by Feynman's owned target-note ledger.
- Cloud storage now opens a workbench modal from Customize > Storage, showing credential-backed S3/GCS/Azure/local targets, configured or missing status, target details, connection-reference feedback, delete, and a Credentials navigation action.
- Artifact Cloud export now opens a workbench modal that shows configured and missing storage targets, lets users choose the destination path, and records exports through Feynman's owned cloud-export audit log.
- Expanded Feynman Bio Tools with no-login KEGG `link:` and `conv:` modes for batched pathway/reaction/database cross-links and outside ID conversions, including missing-ID reporting and endpoint provenance.
- Expanded Feynman Bio Tools with no-login PanglaoDB support for curated single-cell marker genes by cell type or gene symbol, including canonical-marker filters, organ/species context, nicknames, and sensitivity/specificity scores.
- Expanded Feynman Bio Tools with no-login public sources for AlphaFold DB predicted structures, ArrayExpress/BioStudies functional-genomics studies, MGnify metagenomics studies, JASPAR transcription-factor matrices, and MyGene.info gene annotations.
- Expanded Feynman Bio Tools with richer no-login PubMed support for article metadata, PMID/PMCID/DOI conversion, related-article and PMC links, citation matching, copyright/license checks, and PMC full-text routing with bounded section snippets.
- Expanded Feynman Bio Tools with richer no-login ClinicalTrials.gov support for NCT detail records, sponsor-specific trial programs, eligibility filters, investigator/contact discovery, and endpoint summaries.
- Expanded Feynman Bio Tools with richer no-login bioRxiv and medRxiv support for preprint DOI lookup, date/category windows, published-preprint links, funder/ROR lookup, bioRxiv content statistics, and server-specific usage statistics.
- Expanded Feynman Bio Tools with no-login EBI structural and interaction sources for ChEBI compounds and ontology records, Complex Portal macromolecular complexes, IntAct molecular interactions, and EMDB cryo-EM map metadata.
- Expanded Feynman Bio Tools with no-login public atlas and regulatory sources for openFDA drug labels, adverse events, recalls, Drugs@FDA applications, application count aggregations, pharmacologic classes, generic-equivalent active-ingredient sets, Human Protein Atlas gene/protein expression rows, and eQTL Catalogue variant-gene association rows.
- Expanded Feynman Bio Tools with richer no-login ChEMBL support for compound name/SMILES similarity and substructure search, drug indications and warnings, calculated ADMET properties, ligand-target bioactivity filters, mechanism records, and target/gene search.
- Expanded Feynman Bio Tools with no-login GWAS Catalog support for curated SNP-trait associations, EFO trait search, study accessions, PMIDs, p-values, mapped genes, and ancestry/sample metadata.
- Expanded Feynman Bio Tools with exact human-genetics modes for GWAS Catalog association, trait, study, and SNP detail queries; eQTL Catalogue dataset and dataset-scoped association queries; and PheWeb/FinnGen variant, gene, phenotype-listing, and phenotype-search PheWAS workflows.
- Expanded Feynman Bio Tools with exact literature modes for OpenAlex work search/detail, citations, references, author search/detail, venue metadata, and arXiv search plus batch paper retrieval.
- Expanded Feynman Bio Tools with exact protein-annotation modes for InterPro/Pfam domain architecture, entry search/detail, Pfam clan and family member lookups, Human Protein Atlas gene/search records, and STRING mapping/network/similarity workflows.
- Expanded Feynman Bio Tools with exact research-resource modes for Antibody Registry search/detail/catalog/stat workflows and Grants.gov Search2 opportunity lookup by keyword, opportunity number, ALN, agency, status, eligibility, funding category, and funding instrument.
- Expanded Feynman Bio Tools with exact Rfam RNA modes for family metadata, accession/id conversion, seed alignments, covariance models, phylogenetic trees, sequence regions, PDB structure mappings, and batch sequence search.
- Expanded Feynman Bio Tools with exact omics-archive modes for ArrayExpress experiments/files/samples, GEO series search/detail, MetaboLights studies/files/data files, MGnify studies/analyses, and PRIDE project/protein-evidence workflows.
- Expanded Feynman Bio Tools with exact regulation modes for ENCODE experiment/biosample/file search and detail records, JASPAR matrix/version/catalog workflows, and UniBind dataset plus regional TFBS workflows through UCSC hub data.
- Expanded Feynman Bio Tools with exact variant modes for gnomAD short variant search/detail, gene variants, constraint, region variants, liftover, ClinVar mirror variants, structural variants, mitochondrial variants, CADD variant/position/range scores, direct ClinVar search/accession/rsID records, and dbSNP rsID/region lookup.
- Expanded Feynman Bio Tools with no-login BioMart support for Ensembl mart discovery, dataset listings, common attributes, filters, and constrained gene table retrieval through Feynman's built-in database search tool.
- Expanded Feynman Bio Tools with no-login MetaboLights support for public metabolomics study metadata, MTBLS accessions, assay context, study-folder files, and public data-file listings.
- Expanded Feynman Bio Tools with no-login UCSC Genome Browser support for assembly discovery, track search, chromosome sizes, bounded genomic region track rows, conservation score summaries, and ENCODE TFBS clusters.
- Expanded Feynman Bio Tools with exact genome modes for Ensembl lookup, xrefs, VEP variant consequence summaries, homology, sequence, and overlap-region retrieval plus UCSC `ucsc_list_tracks`, `ucsc_chrom_sizes`, `ucsc_track_data`, `ucsc_conservation`, and `ucsc_tfbs_clusters` query names.
- Expanded Feynman Bio Tools with no-login UniBind support for direct TF-DNA interaction dataset search, exact dataset model metadata, BED/FASTA/plot model links, and UCSC hub-backed TFBS region rows.
- Expanded Feynman Bio Tools with Europe PMC open-access full-text section lookup for PMCID/PMID inputs, returning section inventories, bounded snippets, figure/table/reference counts, and explicit not-open-access or missing-full-text statuses without exposing raw XML.
- Expanded Feynman Bio Tools with no-login ZINC support for purchasable compound lookup by ZINC ID, SMILES exact or analog search, supplier catalog-code resolution, random screening-set sampling, and 3D tranche repository locations.
- Expanded Feynman Bio Tools with PubChem compound search/detail, SMILES similarity, bioassay summary, and GHS safety modes; ChEBI search/entity/ontology modes; BindingDB target-ligand and compound-target modes; and Rhea reaction search/detail modes.
- Expanded Feynman Bio Tools with CIViC gene/variant/evidence/assertion/molecular-profile/disease/therapy modes, ClinGen validity/dosage/actionability/variant-classification modes, and Open Targets bounded GraphQL-compatible search plus disease-drug, disease-target, and drug wrapper modes.
- Expanded Feynman Bio Tools with GTEx dataset, tissue-site, sample, gene-resolution, expression, top-expressed-gene, and eQTL modes plus exact PanglaoDB marker-gene, gene-to-cell-type, and options modes.
- Expanded Feynman Bio Tools with exact genes/ontologies modes for MyGene query-many lookup, OLS ontology catalogue/search/term lookup, QuickGO GO annotations, UniProt TSV/FASTA/TXT entry retrieval, Reactome pathway mapping, and KEGG entry/search/link/ID-conversion workflows.
- Expanded Feynman Bio Tools with no-login CellGuide support for Cell Ontology cell-type lookup, marker genes, tissue occurrence, and CELLxGENE source collections.
- Expanded Feynman Bio Tools with no-login Antibody Registry support for antibody RRID search, catalog-number lookup, vendor filtering, registry stats, and per-antibody detail records.
- Expanded Feynman Bio Tools with credential-aware OpenAlex support for scholarly work search, work detail, DOI claimant resolution, incoming citations, outgoing references, authors, sources/venues, OA status, and rate-limit diagnostics.
- Expanded Feynman Bio Tools with cBioPortal cancer-model parity modes for study search/detail, clinical attributes, per-gene mutation rows, cross-study mutation frequency, and discrete CNA events, plus DepMap reference-name modes for model listing/detail/search, gene search, and CRISPR dependency rows.
- Added native workbench previews for audio, video, XLSX spreadsheets, Jupyter notebooks, and LaTeX/TeX artifacts alongside the existing report, JSON, PDF, genome, alignment, molecule, structure, tree, and tensor viewers.

### Website and Docs

- Added workbench documentation to the website, command reference, setup guide, release notes, and README so the public product description matches the local workbench surface.
- Corrected the npm install Node.js range in the website docs to match the package engine range.

## v0.3.5 - 2026-06-28

### Pi Runtime

- Refreshed the bundled Pi runtime from `0.79.10` to `0.80.2` across all four packages (`pi-coding-agent`, `pi-agent-core`, `pi-ai`, `pi-tui`). This restores the `@earendil-works/pi-ai/compat` entrypoint and loader aliases used by optional packages such as `pi-web-access`, fixing the extension-load failure reported in #183.
- Feynman's package installer now derives legacy `@mariozechner/*` alias versions from the current canonical `@earendil-works/*` runtime packages first, so stale legacy package roots cannot seed old Pi peer versions during `feynman update`.
- Updated the Pi TUI patcher for the current upstream overflow-check layout so overwide rendered lines are clipped instead of crashing the session renderer.

### Validation

- Added regression coverage for the current Pi TUI overflow block, the `@earendil-works/pi-ai/compat` release-note boundary, and legacy Pi alias derivation from current runtime metadata.
- Rebuilt and inspected the vendored runtime workspace so the packaged archive includes Pi `0.80.2`, `@earendil-works/pi-ai/dist/compat.js`, and the current/legacy `/compat` extension-loader aliases.

## v0.3.4 - 2026-06-12

### Research

- Added `feynman paper <id-or-title>` for single-paper access resolution. It writes Markdown and JSON access reports, records legal candidates from OpenAlex, DOI, PMID/PMCID, arXiv/alphaXiv, and Europe PMC, and can fetch source-specific text with `--fetch-full-text` while keeping raw full-text bodies out of artifacts.
- Added `feynman rank <topic>`, the first PaperRank workflow. It fetches OpenAlex paper metadata, ranks candidates for read-first triage with transparent scores for topical fit, citation influence, graph prestige, citation velocity, methodology evidence, and reproducibility evidence, then writes auditable artifacts under `outputs/`.
- PaperRank's core user job is read-order triage: answer "what should I read first, and why?" with a ranked brief, per-paper score audit, JSONL data, local citation/field structure, and provenance.
- Added research-loop artifacts that stay tied to that job: a ranked brief, score audit, JSONL score/data, rank-sensitivity checks, local citation graph/explorer, field map, and provenance by default. Optional flags add citation-neighborhood expansion, source-specific full-text enrichment, research critique, empirical preference calibration templates, reproduction-evidence ledgers/templates/replication plans, or bounded model synthesis.
- PaperRank does not claim completed replication or peer review. It keeps raw full-text bodies out of generated artifacts, records model-selection provenance for synthesis, and labels uncalibrated or missing evidence explicitly.

### Model Catalog

- Fixed research model selection so recommended/default model paths, stale settings, model lists, and explicit CLI overrides reject Pro-class model IDs and keep OpenAI-only installs on the newest available non-Pro GPT model exposed by Pi. Updated LiteLLM setup fallback and setup/configuration docs to avoid GPT-4-era, stale, and premium-tier defaults.
- Added model-selection provenance to PaperRank synthesis so normal CLI output, JSON output, generated synthesis Markdown, and rank provenance name the actual model and whether it came from the current recommendation path or an explicit override.

### AlphaXiv

- Hardened shell-based alphaXiv access through `feynman alpha ...` so Feynman uses its bundled patched alphaXiv client instead of stale global `alpha` or `feynman` binaries inside agent bash sessions.

### Pi Runtime

- Refreshed the bundled Pi runtime from `0.79.1` to `0.79.10` across all four packages (`pi-coding-agent`, `pi-agent-core`, `pi-ai`, `pi-tui`) and aligned Feynman's packaged fallback/runtime-peer seeding to the same version, so clean installs and bundled runtime rebuilds no longer lag behind the latest published Pi patch line. This inherits Pi's compaction-event context, safer exact-version update flow, nested-repo `find` fix, and OpenAI-compatible `reasoning_details` streaming fix.
- Updated the production dependency overrides for `hono`, `protobufjs`, `undici`, and `ws` so `npm audit --omit=dev` is clean after the Pi refresh.
- Fixed session rename crashes when long slash-workflow names overflowed the custom header. Header workflow names are now clipped to their column in both wide and narrow layouts before descriptions are rendered.
- Removed the old `generative-ui`, `ui`, and `all-extras` optional package/update targets. Optional packages now stay one-by-one and research-continuity focused.

### Website

- Updated the website's in-range stale package set (`@tailwindcss/vite`, `tailwindcss`, `lucide-react`, and `eslint`) after the dependency freshness sweep.

### Validation

- Re-ran the full local validation sweep after the version refresh: tests, typecheck, build, package dry-run, CLI version smoke, production audits, and website build.

## v0.3.3 - 2026-06-12

### Windows

- Fixed the remaining Windows subagent launch failure where Pi loaded `pi-subagents` from its own `<agentDir>/npm/node_modules` package root. The 0.3.2 fix patched Feynman's bundled workspace and npm-global copy, but Pi 0.79 can self-install configured packages under the active agent directory after `FEYNMAN_HOME` is set; that fresh copy was still unpatched and could spawn Feynman's wrapper with `--mode` in the main-module slot.

### Validation

- Added regression coverage for both Feynman's user npm-global package root and Pi's agent-local npm package root, so launch-time patching now checks the exact Windows copy that failed in e2e run `27392984208`.

## v0.3.2 - 2026-06-11

### Subagents

- Fixed subagent launches failing with `userDir is not defined`. Upstream pi-subagents moved its directory handling behind `getAgentDir()` (which natively honors `PI_CODING_AGENT_DIR`), so Feynman's launch-time patch partially applied — rewriting usages whose declarations no longer matched. The patcher now applies grouped edits transactionally (a usage rewrite only lands with its paired declaration), repairs already-broken installs in place, and stops rewriting what upstream now handles itself.
- Fixed the persistent Windows `Cannot find module '...\--mode'` subagent failure (#172) at its true root: Pi resolves user-scope packages from Feynman's pinned npm prefix (`~/.feynman/npm-global/lib/node_modules`). When that copy is a real directory instead of a link into the bundled workspace — junction-creation fallback or a `feynman update` reinstall — it was never patched, so unpatched spawn code executed regardless of the fixes shipped in 0.2.59–0.3.1. That package root is now a first-class patch target in both launch-time patchers.

### Validation

- The end-to-end workflow's subagent smoke now requires the child's actual relayed output (`RESULT=PONG`), not just the parent's completion marker — earlier passes could be vacuous when the tool call failed and the model narrated past it. Verified by driving the interactive TUI in conversation on a clean Linux machine.

## v0.3.1 - 2026-06-11

### Windows

- Fixed a recurrence of subagent launches failing with `Cannot find module '...\--mode'` (#172). When `FEYNMAN_PI_CLI_PATH` is missing or unusable inside the subagent-spawning process, the Pi CLI resolver could fall through to re-selecting Feynman's wrapper without the Pi main-module argument. The resolver now derives the real Pi CLI from the wrapper's own launch arguments, and the wrapper self-heals the environment variable for its children, so the spawn no longer depends on env propagation at all.

### Validation

- Regression tests cover fresh and previously-patched resolver shapes, double-application idempotency, and the wrapper's env self-heal; verified by the multi-OS end-to-end workflow including the Windows subagent smoke.

## v0.3.0 - 2026-06-11

### Pi Runtime 0.79 (breaking: Node floor)

- Upgraded the Pi runtime from 0.74.2 to 0.79.1 across all four packages (`pi-coding-agent`, `pi-agent-core`, `pi-ai`, `pi-tui`). Highlights inherited from Pi 0.75–0.79: project trust prompts for `.pi` resources (headless runs default to untrusted, so nothing blocks), `--session-id` / `--exclude-tools` / `--approve` CLI flags, supply-chain-hardened publishes with shrinkwrapped exact deps, new built-in models (Claude Fable 5 with adaptive thinking, Claude Opus 4.8, MiniMax-M3, NVIDIA NIM providers), and IME cursor fixes.
- **Supported Node is now 22.19.0 through 25.x** (Pi 0.79 requires ≥22.19; Node 20 reached end-of-life in April 2026). The installer-bundled runtime is unaffected; npm installs on Node 20/21 keep working on the 0.2.x line.
- Updated the OAuth login flow for Pi's new device-code and selector callbacks, and rebuilt the editor render patch for pi-tui's Unicode rework — including a guard that leaves the editor untouched on unknown future layouts instead of producing a broken render.
- Model recommendations now surface the newest catalog entries (Claude Opus 4.8 on OpenCode Zen, MiniMax-M3).

### Removed

- Deleted the npm `--legacy-peer-deps` runtime patch — Pi 0.79 ships that behavior upstream.
- Dropped the unused `dotenv` dependency; `undici` and `@earendil-works/pi-agent-core`/`pi-tui` are now declared directly instead of relying on transitive resolution.

### Validation

- 192 tests, typecheck, build, and pack on Node 22/24/25; live smokes on Pi 0.79.1 for alpha search (10 results), parallel `web_search` with `includeContent`, subagent launches, and direct render-harness checks of the patched editor (placeholder, text, narrow, unfocused). The end-to-end install workflow now also covers Node 22.

## v0.2.61 - 2026-06-11

### Windows

- Fixed bundled-package setup failing on every launch (#177, #170). Two root causes found by running the published package on real Windows runners: GNU tar (Git for Windows) treats the workspace archive's absolute `C:\...` path as a remote host spec ("Cannot connect ... resolve failed"), and the npm fallback spawned bare `npm` without a shell, which Windows rejects with EINVAL. The archive now extracts with relative paths, and npm is invoked through `npm-cli.js` with the running Node executable.

### Runtime Reliability

- The bundled workspace's alpha-hub copy now receives the same launch-time patches as the package-local copy, so the #167 search fix applies regardless of which copy resolves.

### Validation

- The multi-OS end-to-end workflow now verifies install, update, patch application, and live model + subagent smokes on Windows, Linux, and macOS at Node 24 and 25.

## v0.2.60 - 2026-06-11

### Node Support

- Feynman now supports Node.js 25 (#177). The full test suite and live CLI flows (launch, update, alpha search, parallel web search) were validated on Node 20, 24, and 25; the supported range is now 20.19.0 through 25.x.

### Runtime Reliability

- Fixed the cryptic `Cannot convert argument to a ByteString because the character at index N has a value of M` crash (#171). It fires when a custom provider in `models.json` has a header value or API key containing characters above U+00FF (e.g. Chinese text) — HTTP headers cannot carry them. Feynman now reports exactly which provider and header is at fault and how to fix it, instead of an unattributed undici error.

### Validation

- Added a multi-OS end-to-end install workflow that exercises the published package on Windows, Linux, and macOS runners (Node 24 and 25): global install, version/update/package flows, launch-time patch assertions for the subagent spawn (#172) and structured search parser (#167) fixes, plus live model and subagent smokes.

## v0.2.59 - 2026-06-11

### Research Tools

- Fixed `alpha_search` returning empty results in every mode (#167). alphaXiv search tools now return structured JSON instead of the old numbered-text format; the result parser understands both, so semantic/keyword/both/agentic/all searches return real papers again.

### Runtime Reliability

- Fixed parallel `web_search` calls hanging the session forever (#169). A parallel call could silently clobber a sibling's pending curator session, leaving its promise unresolved and blocking every toolResult in the batch; the loser is now cancelled cleanly. Each search query is also bounded by a 90s deadline that surfaces as a per-query error instead of an indefinite "Working" state, and a curator page that never connects times out after 2 minutes instead of waiting forever.
- Relaunching `feynman` now continues your most recent session instead of starting from scratch (#168). `--new-session`, one-shot prompts, and RPC/JSON launches still start fresh.

### Windows

- Fixed subagent launches failing with `Cannot find module '...\--mode'` (#172). The runtime patch that points pi-subagents at Feynman's Pi CLI now applies to the package's current `src/` layout.
- Fixed `feynman update` failing with `spawn EINVAL` (#170). Package installs now invoke npm through `npm-cli.js` with the running Node executable instead of spawning `npm.cmd`.

### Updates

- Installing a new Feynman release on an unsupported (too new) Node version no longer aborts the install and silently pins you to the old version (#177). The version gate still refuses to run and explains what to install, but the package itself updates so the fix is in place once you switch Node versions.
- `feynman update` now tells you when a newer Feynman CLI release exists and prints the exact upgrade command for your install type (npm or standalone).

### Validation

- Added regression coverage for the structured alphaXiv search parser, the web_search hang patches, and the self-update notice. Verified live: all five `alpha_search` modes return results, and two parallel `web_search` calls with `includeContent: true` complete with toolResults.

## v0.2.58 - 2026-05-16

### Optional Packages

- Added a `hindsight` optional preset that installs `@luxusai/pi-hindsight`, giving users a first-class path to Hindsight-backed research-continuity memory without adding it to the default install.
- Added `hindsight` and `pi-hindsight` update aliases so `feynman update hindsight` resolves to the same package source.
- Updated the package-stack and setup docs to show Hindsight as an optional memory surface and note that it requires a Hindsight server or Hindsight Cloud account.

### Validation

- Added regression coverage for the new optional preset, research-continuity package copy, removed bulk/UI presets, and update aliases.

## v0.2.57 - 2026-05-15

### Runtime Reliability

- Fixed the interactive prompt input color on macOS/iTerm profiles where typed text inherited a black terminal foreground against Feynman's dark editor background.
- Applied the editor foreground/background patch through the shared Pi patch module so package-local installs and the vendored runtime archive stay in sync.

### Validation

- Added regression coverage for the patched Pi editor/theme source transformations, including idempotency.

## v0.2.56 - 2026-05-13

### Security

- Updated the `protobufjs` dependency override from `7.5.5` to `7.5.8`, which pulls in the patched `@protobufjs/utf8` release and clears the current production audit advisory set.

### Validation

- Re-ran the root production audit after the override refresh and confirmed it reports zero vulnerabilities.

## v0.2.55 - 2026-05-13

### Model Catalog

- Updated Feynman's research model preference order so the newest available non-Pro OpenAI GPT model can be recommended, auto-selected, and surfaced ahead of older OpenAI GPT models.
- Applied the same newest-available non-Pro GPT preference to OpenAI Codex when Pi exposes Codex directly.
- Updated first-run/default setup preferences so OpenAI-only installs choose the newest available non-Pro OpenAI GPT model when available.

### Validation

- Added regression coverage for newest-available non-Pro OpenAI recommendation, model sorting, and default setup seeding.

## v0.2.54 - 2026-05-11

### Runtime Reliability

- Fixed packed npm installs that hoist package dependencies outside Feynman's package root. Feynman now falls back to its vendored `.feynman/npm` runtime workspace when resolving Pi, so `feynman doctor` and prompt launches work from a clean packed install.
- Applied runtime node-module patches to both package-local dependencies and the vendored runtime workspace.

### Validation

- Added regression coverage for packed-install Pi path resolution and vendored runtime patching.
- Added an isolated packed-install E2E that installs the generated tarball into a clean prefix/home and launches Feynman from that install.

## v0.2.53 - 2026-05-11

### Runtime Reliability

- Hardened alphaXiv search fallback again: if both the removed MCP search tools and `discover_papers` are unavailable, `alpha search` now falls back to the public alphaXiv fast REST search endpoint.
- Patched the Pi extension loader to alias both `@mariozechner/*` and `@earendil-works/*` Pi runtime imports to Feynman's already initialized bundled runtime, preventing mixed-namespace TUI/theme crashes when expanding tool output.
- Applied the extension-loader patch to the vendored runtime archive path, not only the local development `node_modules` path.

### Validation

- Added regression coverage for upgrading the old `discover_papers`-only alphaXiv patch and for dual-namespace Pi runtime aliasing.

## v0.2.52 - 2026-05-09

### Runtime Reliability

- Seed bundled runtime packages before package updates so missing undeclared extension dependencies such as `typebox` are repaired before extension load.
- Include Pi's `typebox` runtime package beside installed Pi packages when Feynman has to run npm directly.
- Include the new `@earendil-works/*` Pi runtime package namespace beside the legacy `@mariozechner/*` namespace so updated Pi extensions such as `pi-btw` and `pi-markdown-preview` can load.
- Patched alphaXiv search in the bundled alpha-hub runtime to fall back to the newer `discover_papers` MCP tool when alphaXiv no longer exposes the older search tool names.
- Hardened model tool-call handling for common alias mistakes: `search_web` now maps to `web_search`, and bare `fetch` / `WebFetch` / `read_url_content` map to `fetch_content` with array URLs normalized.
- Fixed the Windows docker probe in the research header so `cmd.exe` no longer emits localized mojibake from Unix-only `/dev/null` redirection.

### Workflow Prompts

- Added a shared tool-discipline block to every workflow prompt so lead agents see canonical tool names before workflow-specific instructions.

### Validation

- Added regression coverage for alphaXiv search fallback, Pi tool alias normalization, bundled runtime dependency installs, and prompt tool discipline.

## v0.2.51 - 2026-05-09

### Package Manager

- Hardened Pi package installs and updates so peer-only Pi runtime packages are materialized into Feynman's npm prefix beside installed Pi packages.
- This prevents optional or legacy Pi packages from failing at extension load time when they import Pi runtime modules that npm did not install because Feynman uses legacy peer dependency mode.

### Validation

- Added package-manager coverage for installing Pi runtime peers beside Pi npm packages.

## v0.2.50 - 2026-05-09

### Skills Installer

- Added an explicit Codex skills target for standalone skill installs: `--codex` on macOS/Linux and `-Scope Codex` on Windows.
- Kept the existing default/user install behavior compatible while documenting the Codex, repo-local Claude/agent, and OpenCode target paths.

### Validation

- Added installer coverage for the Codex target and target-specific docs.

## v0.2.49 - 2026-05-07

### Website

- Updated the website build stack to patched Astro 6/Vite 7.
- Migrated docs content collections to Astro's current content-layer config.

### Validation

- Website build, typecheck, lint, and production audit passed.
- Root build, typecheck, full tests, package dry-run, native bundle build, and production audit passed after the website upgrade.

## v0.2.48 - 2026-05-07

### Fixes

- Restored Node.js 24 support for the Feynman CLI and npm package.
- Slimmed the default Pi package set to the core AI research essentials: alphaXiv access, subagents, document parsing, and web access.
- Moved memory and session search out of the default install path so optional package failures cannot block first launch.
- Kept session search gated to Node.js 22.x because its upstream sqlite dependency still depends on native prebuild coverage.
- Upgraded the TypeScript toolchain to 6.0 and updated the build config for its explicit `rootDir` requirement.

### Documentation

- Updated package-stack, setup, install, and session-search docs to distinguish core researcher packages from optional extras.

### Validation

- Full local tests passed: 157/157.
- Typecheck, root build, website build, native bundle build, production `npm audit --omit=dev`, and package dry-run passed.
- Package dry-run verified the bundled runtime workspace excludes memory and session search by default.

## v0.2.47 - 2026-05-07

### Documentation

- Clarified that Feynman's package, extension, and skill wiring follows Pi's upstream package model.
- Linked the Hugging Face Hub API and environment-variable docs from the README and website docs.
- Clarified that Hugging Face file reads refuse obvious model weights, archives, and dataset shards before download.

### Validation

- Tightened the Hugging Face binary-file refusal regression test.
- Full local tests passed: 157/157.
- Typecheck, root build, website build, and production `npm audit --omit=dev` passed.

## v0.2.46 - 2026-05-07

### Updates

- Added the `/recipe` workflow for ranked ML training recipes backed by papers, datasets, docs, implementation paths, and verification status.
- Added read-only Hugging Face Hub inspection tools for dataset metadata, repo file listing, and small text file reads. These support recipe and replication grounding without requiring Hub write access, and refuse obvious weight/archive/shard reads before download.
- Updated `/replicate` so ML-heavy targets perform a recipe extraction pass before execution planning.

### Documentation

- Added website docs for the `/recipe` workflow and Hugging Face Hub tools.
- Updated README, quickstart, command references, agent docs, replication docs, and package-stack docs for the new workflow and tools.

### Validation

- Added unit coverage for Hugging Face tool registration, endpoint formatting, auth headers, file listing limits, truncation, and binary-file refusal.
- Full local tests passed: 157/157.
- Typecheck, root build, website build, CLI help, and live Hugging Face endpoint smoke checks passed.

## v0.2.45 - 2026-05-07

### Updates

- Updated the bundled Pi runtime packages to `@mariozechner/pi-ai@0.73.0` and `@mariozechner/pi-coding-agent@0.73.0`.
- Updated `@clack/prompts` to `1.3.0` for the setup/onboarding prompt surface.

### Validation

- Full local tests passed: 154/154.
- Typecheck, root build, website build, `feynman doctor`, and production `npm audit --omit=dev` passed.
- JSONL RPC smoke passed with `get_state` and a `bash` command returning `FEYNMAN_RPC_OK`.
- Release CI published npm `0.2.45`, built all native bundles, and created the GitHub release.

## v0.2.44 - 2026-05-06

### Fixes

- Updated transitive dependency override pins to patched versions so production `npm audit` reports zero vulnerabilities.
- This removes advisories in `basic-ftp`, `fast-xml-parser`, `hono`, and `ip-address` while keeping the dependency changes scoped to existing transitive packages.

### Validation

- Production `npm audit --omit=dev` passed with zero vulnerabilities.
- Full local tests passed: 154/154.
- Typecheck, root build, website build, and `feynman doctor` passed.

## v0.2.43 - 2026-05-06

### Fixes

- Restricted `.feynman/web-search.json` permissions to user-only (`0600`) after Feynman writes web-search provider configuration.
- This protects stored web-search API keys such as Exa, Perplexity, and Gemini keys from permissive local umasks.

### Validation

- Added POSIX regression coverage for saved web-search config permissions.
- Full local tests passed: 154/154.
- Typecheck and build passed.

## v0.2.42 - 2026-05-06

### Fixes

- Fixed runtime RPC startup in projects with `.feynman/settings.json` package entries by patching Pi's project npm install path to use peer-dependency-compatible installs.
- This prevents project-scoped package sync from failing on packages such as `@aliou/pi-processes` before the RPC session can start.

### Validation

- Added regression coverage for the embedded Pi package-manager patch.
- Real `v0.2.41` release RPC testing reproduced the missing project-package install failure that this release fixes.

## v0.2.41 - 2026-05-06

### Fixes

- Fixed startup package seeding so copied bundled packages are treated as satisfied instead of falling through to repeated global npm installs.
- Seeded bundled packages before interactive setup reports missing packages, avoiding unnecessary first-run package prompts when the standalone bundle already has the runtime workspace.
- Restricted supported Node.js runtimes to Node 20.19.x through Node 22.x because sqlite-backed Pi packages such as session search are not reliable under Node 24.
- Updated release CI to build, test, publish, and package native bundles with Node 22.

### Documentation

- Added research-only biomedical literature review guidance with PICO/PICOS framing, evidence-type separation, privacy boundaries, and non-clinical-advice wording.
- Updated npm install docs to show the new supported Node engine range.

### Validation

- Full local tests passed: 151/151.
- Typecheck and root build passed.

## v0.2.40 - 2026-04-19

### Fixes

- Fixed local-model web-search failures where a model calls non-existent search aliases such as `google:search`; Feynman now maps those aliases to Pi's real `web_search` tool when it is available.
- Granted the bundled researcher and verifier agents access to Pi web-access tools (`web_search`, `fetch_content`, and `get_search_content`) so their prompts and allowed tools match.
- Made `feynman doctor` and `feynman search status` explicitly show when `web-search.json` has not been created and how to initialize it.
- Stopped treating expired OAuth credentials as authenticated model availability, so `doctor`, `model list`, and onboarding guide users to re-login instead of failing later in chat.
- Added a package-workspace setup lock so concurrent Feynman invocations do not race while restoring `.feynman/npm`.

### Validation

- Full local tests passed: 137/137.
- Typecheck, build, vendored runtime regeneration, runtime archive inspection, sequential CLI smoke, and parallel CLI smoke passed.

## v0.2.39 - 2026-04-19

### Fixes

- Fixed TUI-selected thinking/reasoning effort persistence. Feynman no longer passes an implicit `--thinking medium` on every launch, so thinking levels saved by Pi after `Shift+Tab` survive restarts.
- Explicit `--thinking <level>` and `FEYNMAN_THINKING=<level>` still override the saved default for that launch.

### Validation

- Added regression coverage that Feynman only passes a launch thinking override when it was explicitly configured.
- Full local tests passed: 126/126.
- Typecheck and build passed.

## v0.2.38 - 2026-04-19

### Fixes

- Fixed `feynman update memory` and `feynman update session-search` so friendly core-package aliases resolve to the correct npm package sources and use Feynman's npm install path with peer-dependency compatibility flags.
- Fixed `feynman summarize ... --window-size ...` and related summarize tuning flags when the flags appear after the source positional.
- Fixed `feynman setup preview` so it actually runs the preview dependency check, matching the legacy `--setup-preview` alias.
- Made optional `generative-ui` install/update failures degrade cleanly on macOS toolchains where upstream `glimpseui` cannot compile, without dumping thousands of Swift compiler lines.
- Reduced deepresearch TUI redraw churn by freezing the Feynman header's Last Activity snapshot during live streaming work instead of recomputing it every render.
- Fixed bundled skills that referenced prompt templates through broken installed relative paths.
- Fixed the embedded Pi patcher so repeated runtime preparation does not duplicate the TUI stdin error handler.

### Documentation

- Documented `feynman setup preview`.
- Documented the existing `Shift+Tab` thinking-level hotkey and `/hotkeys` discovery path.

### Validation

- Full local tests passed: 124/124.
- Typecheck, build, and clean website build passed.
- Local CLI matrix passed for help, doctor, status, model list/tier, search status/set, alpha status, setup preview, packages list/install, and package update aliases.
- End-to-end workflow runs completed for chat, summarize, review, compare, audit, draft, lit, deepresearch with confirmation, replicate, watch/jobs, log, and a bounded autoresearch loop.

## v0.2.37 - 2026-04-19

### Fixes

- Hardened `/deepresearch` reviewer/audit fix handling so Feynman may only claim a patch landed after the edit/write tool succeeds and an explicit on-disk check proves the old unsupported content is gone and the corrected content exists.
- Added provenance requirements for failed edit recovery so verification notes cannot mark an issue fixed before the final candidate actually reflects the fix.
- Corrected MiniMax model preference casing to match Pi's exposed model IDs.

### Performance

- Resolved preview/runtime executables in parallel before launching Pi, reducing synchronous startup work while preserving Windows, macOS, and Linux fallback behavior.

### Fork Review

- Scanned all public forks and selectively adopted the low-risk startup/model-test improvements. Rejected product-specific or bloated fork changes such as Claude CLI bypass mode, ValiChord, Overleaf export, and an external `parallel-cli` dependency.

### Validation

- Full local tests passed: 121/121.
- Typecheck, build, local CLI doctor, and real one-shot launch smoke test passed.
- Fork scan compared 676 accessible forks: 666 behind, 2 identical, 8 with unique commits inspected.

## v0.2.36 - 2026-04-18

### Fixes

- Hardened `/review` so it writes a durable plan, evidence notes, and `outputs/<slug>-review.md` instead of stopping after a planning/narration response.
- Added blocked-review fallback behavior for PDFs or external sources that cannot be parsed, so failed extraction still produces an explicit review artifact with `Verification: BLOCKED`.
- Fixed subagent child-process spawning under Feynman's Pi wrapper so writer/reviewer subagents no longer treat `--mode` as a module path.
- Made optional package presets platform-aware so Linux users do not see or attempt to install the macOS-only `generative-ui` package.
- Added the Release Notes entry to the website docs sidebar.

### Documentation

- Updated research review docs to describe the concrete output files and blocked-extraction behavior.
- Updated package docs to clarify that memory and session search are core packages and `generative-ui` is macOS-only upstream.

### Validation

- Added regression coverage for the `/review` durable-artifact contract.
- Added regression coverage for platform-aware optional presets and Feynman-aware subagent spawning.
- Real installed-global review, package-list/install, subagent, and extension-load checks were run before release.

## v0.2.35 - 2026-04-18

### Fixes

- Restored the `/deepresearch` confirmation gate: the workflow now writes `outputs/.plans/<slug>.md`, summarizes the plan, and waits for explicit user approval before searching, drafting, citing, or delivering final artifacts.
- Changed top-level workflow invocation so `feynman deepresearch ...` behaves like the REPL workflow in a real terminal instead of forcing one-shot execution.
- Added a Feynman wrapper around Pi's CLI entrypoint so completed print-mode runs exit cleanly after Pi finishes.
- Tightened direct-mode `/deepresearch` artifact paths so research notes and verification files are written under `outputs/.drafts/`.

### Features

- Added section-focused `alpha_get_paper` extraction with `section` / `sections` filters for abstract, introduction, methodology, experiments, results, discussion, limitations, and conclusion.
- Added configurable `/summarize` context-window controls via flags and `FEYNMAN_SUMMARIZE_*` environment variables.

### Documentation

- Added public `RELEASES.md` and website release notes so each release has visible fix and feature history.
- Updated deep research docs to describe the plan-confirmation workflow and current PDF-safety behavior.

### Validation

- Real installed-global REPL test: typed `/deepresearch what is BM25`, verified that only the plan existed before approval, then replied `yes` and verified final report, provenance, draft, cited draft, research notes, and verification artifacts.
- Full local tests passed: 117/117.
- Typecheck, build, website build, local pack, and local global install checks passed.

## v0.2.34 - 2026-04-18

### Fixes

- Tightened `/deepresearch` so direct-mode research must use at least three distinct search terms or angles before drafting.
- Required direct-mode `/deepresearch` to record the exact search terms in the direct research artifact.
- Added regression coverage for the multi-query deep research contract.

### Validation

- Real RPC smoke test for `/deepresearch what is BM25` completed and wrote the required plan, draft, cited draft, final report, and provenance artifacts.
- Release CI published npm and native bundles for macOS arm64/x64, Linux x64, and Windows x64.

## v0.2.33 - 2026-04-18

### Fixes

- Rewrote `/deepresearch` from a long protocol-style prompt into a shorter execution checklist so local models are less likely to echo instructions instead of doing work.
- Made narrow direct-mode research complete without spawning verifier or reviewer subagents.
- Avoided the crash-prone PDF parser path in `/deepresearch` unless PDF extraction is explicitly requested.

### Validation

- Real RPC `/deepresearch what is BM25` completed with required artifacts and `agent_end`.
- Full local tests, typecheck, build, audits, website build, and pack dry-run passed before release.

## v0.2.32 - 2026-04-18

### Fixes

- Fixed Pi subagent parallel output propagation so top-level task `output` paths are honored.
- Added foreground and async regression coverage for subagent output handoff behavior.
- Hardened deep research prompts around durable artifacts and provenance.

## v0.2.31 - 2026-04-17

### Fixes

- Fixed Feynman runtime auth environment propagation so launched Pi sessions can see the expected model provider credentials.
- Revalidated setup and runtime startup paths after the auth fix.

## v0.2.30 - 2026-04-17

### Fixes

- Fixed Pi subagent task output handling in the runtime patch layer.
- Preserved bundled research-agent file handoffs for multi-agent workflows.

## v0.2.29 - 2026-04-17

### Maintenance

- Updated bundled Pi runtime packages.
- Rebuilt native release artifacts against the refreshed runtime package set.

## v0.2.28 - 2026-04-17

### Maintenance

- Removed runtime hygiene extension bloat and kept the bundled runtime closer to upstream Pi behavior.
- Reduced custom extension surface area to keep the research agent simpler.

## v0.2.27 - 2026-04-17

### Fixes

- Added Pi event guards for workflow state transitions.
- Improved workflow state tracking around long-running research operations.

## v0.2.26 - 2026-04-17

### Fixes

- Switched research context hygiene onto Pi runtime hooks instead of extra custom runtime logic.
- Improved compatibility with upstream Pi runtime behavior.

## v0.2.25 - 2026-04-17

### Fixes

- Fixed workflow continuation and provider setup gaps.
- Improved setup flow behavior for model-provider configuration.

## v0.2.24 - 2026-04-16

### Fixes

- Linked bundled runtime dependencies for core Pi packages.
- Addressed missing dependency errors for installed core packages.

## v0.2.23 - 2026-04-16

### Features

- Added LM Studio setup support for local model workflows.
- Added blocked-research artifact handling so interrupted runs keep useful state.

## v0.2.22 - 2026-04-16

### Features

- Added first-class LM Studio setup.
- Improved local model onboarding defaults.

## v0.2.21 - 2026-04-16

### Fixes

- Fixed extension repair behavior.
- Added the Opus 4.7 model overlay.

## v0.2.20 - 2026-04-16

### Release

- Restored publish workflow behavior after a duplicate npm version blocked release.
- Native bundles remained available through GitHub releases.

## v0.2.19 - 2026-04-16

### Fixes

- Skipped release publication when the npm version already exists.
- Prevented repeat publish attempts from failing the pipeline after npm publication succeeds.

## v0.2.18 - 2026-04-16

### Release

- Prepared the release automation baseline used by the current npm and native-bundle pipeline.
