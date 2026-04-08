# CHANGELOG

Workspace lab notebook for long-running or resumable research work.

Use this file to track chronology, not release notes. Keep entries short, factual, and operational.

## Entry template

### YYYY-MM-DD HH:MM TZ — [slug or objective]

- Objective: ...
- Changed: ...
- Verified: ...
- Failed / learned: ...
- Blockers: ...
- Next: ...

### 2026-03-25 00:00 local — scaling-laws

- Objective: Set up a deep research workflow for scaling laws.
- Changed: Created plan artifact at `outputs/.plans/scaling-laws.md`; defined 4 disjoint researcher dimensions and acceptance criteria.
- Verified: Read `CHANGELOG.md` and checked prior memory for related plan `scaling-laws-implications`.
- Failed / learned: No prior run-specific changelog entries existed beyond the template.
- Blockers: Waiting for user confirmation before launching researcher round 1.
- Next: On confirmation, spawn 4 parallel researcher subagents and begin evidence collection.

### 2026-03-25 00:30 local — scaling-laws (T4 inference/time-scale pass)

- Objective: Complete T4 on inference/test-time scaling and reasoning-time compute, scoped to 2023–2026.
- Changed: Wrote `notes/scaling-laws-research-inference.md`; updated `outputs/.plans/scaling-laws.md` to mark T4 done and log the inference-scaling verification pass.
- Verified: Cross-read 13 primary/official sources covering Tree-of-Thoughts, PRMs, repeated sampling, compute-optimal test-time scaling, provable laws, o1, DeepSeek-R1, s1, verifier failures, Anthropic extended thinking, and OpenAI reasoning API docs.
- Failed / learned: OpenAI blog fetch for `learning-to-reason-with-llms` returned malformed content, so the note leans on the o1 system card and API docs instead of that blog post.
- Blockers: T2 and T5 remain open before final synthesis; no single unified law for inference-time scaling emerged from public sources.
- Next: Complete T5 implications synthesis, then reconcile T3/T4 with foundational T2 before drafting the cited brief.

### 2026-03-25 11:20 local — scaling-laws (T6 draft synthesis)

- Objective: Synthesize the four research notes into a single user-facing draft brief for the scaling-laws workflow.
- Changed: Wrote `outputs/.drafts/scaling-laws-draft.md` with an executive summary, curated reading list, qualitative meta-analysis, core-paper comparison table, explicit training-vs-inference distinction, and numbered inline citations with direct-URL sources.
- Verified: Cross-checked the draft against `notes/scaling-laws-research-foundations.md`, `notes/scaling-laws-research-revisions.md`, `notes/scaling-laws-research-inference.md`, and `notes/scaling-laws-research-implications.md` to ensure the brief explicitly states the literature is too heterogeneous for a pooled effect-size estimate.
- Failed / learned: The requested temp-run `context.md` and `plan.md` were absent, so the synthesis used `outputs/.plans/scaling-laws.md` plus the four note files as the working context.
- Blockers: Citation/claim verification pass still pending; this draft should be treated as pre-verification.
- Next: Run verifier/reviewer passes, then promote the draft into the final cited brief and provenance sidecar.

### 2026-03-25 11:28 local — scaling-laws (final brief + pdf)

- Objective: Deliver a paper guide and qualitative meta-analysis on AI scaling laws.
- Changed: Finalized `outputs/scaling-laws.md` and sidecar `outputs/scaling-laws.provenance.md`; rendered preview PDF at `outputs/scaling-laws.pdf`; updated plan ledger and verification log in `outputs/.plans/scaling-laws.md`.
- Verified: Ran a reviewer pass recorded in `notes/scaling-laws-verification.md`; spot-checked key primary papers via alpha-backed reads for Kaplan 2020, Chinchilla 2022, and Snell 2024; confirmed PDF render output exists.
- Failed / learned: A pooled statistical meta-analysis would be misleading because the literature mixes heterogeneous outcomes, scaling axes, and evaluation regimes; final deliverable uses a qualitative meta-analysis instead.
- Blockers: None for this brief.
- Next: If needed, extend into a narrower sub-survey (e.g. only pretraining laws, only inference-time scaling, or only post-Chinchilla data-quality revisions).

### 2026-03-25 14:52 local — skills-only-install

- Objective: Let users download the Feynman research skills without installing the full terminal runtime.
- Changed: Added standalone skills-only installers at `scripts/install/install-skills.sh` and `scripts/install/install-skills.ps1`; synced website-public copies; documented user-level and repo-local install flows in `README.md`, `website/src/content/docs/getting-started/installation.md`, and `website/src/pages/index.astro`.
- Verified: Ran `sh -n scripts/install/install-skills.sh`; ran `node scripts/sync-website-installers.mjs`; ran `cd website && npm run build`; executed `sh scripts/install/install-skills.sh --dir <tmp>` and confirmed extracted `SKILL.md` files land in the target directory.
- Failed / learned: PowerShell installer behavior was not executed locally because PowerShell is not installed in this environment.
- Blockers: None for the Unix installer flow; Windows remains syntax-only by inspection.
- Next: If users want this exposed more prominently, add a dedicated docs/reference page and a homepage-specific skills-only CTA instead of a text link.

### 2026-03-26 18:08 PDT — installer-release-unification

- Objective: Remove the moving `edge` installer channel and unify installs on tagged releases only.
- Changed: Updated `scripts/install/install.sh`, `scripts/install/install.ps1`, `scripts/install/install-skills.sh`, and `scripts/install/install-skills.ps1` so the default target is the latest tagged release, latest-version resolution uses public GitHub release pages instead of `api.github.com`, and explicit `edge` requests now fail with a removal message; removed the `release-edge` job from `.github/workflows/publish.yml`; updated `README.md` and `website/src/content/docs/getting-started/installation.md`; re-synced `website/public/install*`.
- Verified: Ran `sh -n` on the Unix installer copies; confirmed `sh scripts/install/install.sh edge` and `sh scripts/install/install-skills.sh edge --dir <tmp>` fail with the intended removal message; executed `sh scripts/install/install.sh` into temp dirs and confirmed the installed binary reports `0.2.14`; executed `sh scripts/install/install-skills.sh --dir <tmp>` and confirmed extracted `SKILL.md` files; ran `cd website && npm run build`.
- Failed / learned: The install failure was caused by unauthenticated GitHub API rate limiting on the `edge` path, so renaming channels without removing the API dependency would not have fixed the root cause.
- Blockers: `npm run build` still emits a pre-existing duplicate-content warning for `getting-started/installation`; the build succeeds.
- Next: If desired, remove the now-unused `stable` alias too and clean up the duplicate docs-content warning separately.

### 2026-03-27 11:58 PDT — release-0.2.15

- Objective: Make the non-Anthropic subagent/auth fixes and contributor-guide updates releasable to tagged-install users instead of leaving them only on `main`.
- Changed: Bumped the package version from `0.2.14` to `0.2.15` in `package.json` and `package-lock.json`; updated pinned installer examples in `README.md` and `website/src/content/docs/getting-started/installation.md`; aligned the local-development docs example to the npm-based root workflow; added `CONTRIBUTING.md` plus the bundled `skills/contributing/SKILL.md`.
- Verified: Confirmed the publish workflow keys off `package.json` versus the currently published npm version; confirmed local `npm test`, `npm run typecheck`, and `npm run build` pass before the release bump.
- Failed / learned: The open subagent issue is fixed on `main` but still user-visible on tagged installs until a fresh release is cut.
- Blockers: Need the GitHub publish workflow to finish successfully before the issue can be honestly closed as released.
- Next: Push `0.2.15`, monitor the publish workflow, then update and close the relevant GitHub issue/PR once the release is live.

### 2026-03-28 15:15 PDT — pi-subagents-agent-dir-compat

- Objective: Debug why tagged installs can still fail subagent/auth flows after `0.2.15` when users are not on Anthropic.
- Changed: Added `scripts/lib/pi-subagents-patch.mjs` plus type declarations and wired `scripts/patch-embedded-pi.mjs` to rewrite vendored `pi-subagents` runtime files so they resolve user-scoped paths from `PI_CODING_AGENT_DIR` instead of hardcoded `~/.pi/agent`; added `tests/pi-subagents-patch.test.ts`.
- Verified: Materialized `.feynman/npm`, inspected the shipped `pi-subagents@0.11.11` sources, confirmed the hardcoded `~/.pi/agent` paths in `index.ts`, `agents.ts`, `artifacts.ts`, `run-history.ts`, `skills.ts`, and `chain-clarify.ts`; ran `node scripts/patch-embedded-pi.mjs`; ran `npm test`, `npm run typecheck`, and `npm run build`.
- Failed / learned: The earlier `0.2.15` fix only proved that Feynman exported `PI_CODING_AGENT_DIR` to the top-level Pi child; it did not cover vendored extension code that still hardcoded `.pi` paths internally.
- Blockers: Users still need a release containing this patch before tagged installs benefit from it.
- Next: Cut the next release and verify a tagged install exercises subagents without reading from `~/.pi/agent`.

### 2026-03-28 21:46 PDT — release-0.2.16

- Objective: Ship the vendored `pi-subagents` agent-dir compatibility fix to tagged installs.
- Changed: Bumped the package version from `0.2.15` to `0.2.16` in `package.json` and `package-lock.json`; updated pinned installer examples in `README.md` and `website/src/content/docs/getting-started/installation.md`.
- Verified: Re-ran `npm test`, `npm run typecheck`, and `npm run build`; ran `cd website && npm run build`; ran `npm pack` and confirmed the `0.2.16` tarball includes the new `scripts/lib/pi-subagents-patch.*` files.
- Failed / learned: An initial local `build:native-bundle` check failed because `npm pack` and `build:native-bundle` were run in parallel, and `prepack` intentionally removes `dist/release`; rerunning `npm run build:native-bundle` sequentially succeeded.
- Blockers: None in the repo; publishing still depends on the GitHub workflow running on the bumped version.
- Next: Push the `0.2.16` release bump and monitor npm/GitHub release publication.

### 2026-03-31 10:45 PDT — pi-maintenance-issues-prs

- Objective: Triage open Pi-related issues/PRs, fix the concrete package update regression, and refresh Pi dependencies against current upstream releases.
- Changed: Pinned direct package-manager operations (`feynman update`, `feynman packages install`) to Feynman's npm prefix by exporting `FEYNMAN_NPM_PREFIX`, `NPM_CONFIG_PREFIX`, and `npm_config_prefix` before invoking Pi's `DefaultPackageManager`; bumped `@mariozechner/pi-ai` and `@mariozechner/pi-coding-agent` from `0.62.0` to `0.64.0`; adapted `src/model/registry.ts` to the new `ModelRegistry.create(...)` factory; integrated PR #15's `/feynman-model` command on top of current `main`.
- Verified: Ran `npm test`, `npm run typecheck`, and `npm run build` successfully after the dependency bump and PR integration; confirmed upstream `pi-coding-agent@0.64.0` still uses `npm install -g` for user-scope package updates, so the Feynman-side prefix fix is still required.
- Failed / learned: PR #14 is a stale branch with no clean merge path against current `main`; the only user-facing delta is the ValiChord prompt/skill addition, and the branch also carries unrelated release churn plus demo-style material, so it was not merged in this pass.
- Blockers: None in the local repo state; remote merge/push still depends on repository credentials and branch policy.
- Next: If remote write access is available, commit and push the validated maintenance changes, then close issue #22 and resolve PR #15 as merged while leaving PR #14 unmerged pending a cleaned-up, non-promotional resubmission.

### 2026-03-31 12:05 PDT — pi-backlog-cleanup-round-2

- Objective: Finish the remaining high-confidence open tracker items after the Pi 0.64.0 upgrade instead of leaving the issue list half-reconciled.
- Changed: Added a Windows extension-loader patch helper so Feynman rewrites Pi extension imports to `file://` URLs on Windows before interactive startup; added `/commands`, `/tools`, and `/capabilities` discovery commands and surfaced `/hotkeys` plus `/service-tier` in help metadata; added explicit service-tier support via `feynman model tier`, `--service-tier`, status/doctor output, and a provider-payload hook that passes `service_tier` only to supported OpenAI/OpenAI Codex/Anthropic models; added Exa provider recognition to Feynman's web-search status layer and vendored `pi-web-access`.
- Verified: Ran `npm test`, `npm run typecheck`, and `npm run build`; smoke-imported the modified vendored `pi-web-access` modules with `node --import tsx`.
- Failed / learned: The remaining ValiChord PR is still stale and mixes a real prompt/skill update with unrelated branch churn; it is a review/triage item, not a clean merge candidate.
- Blockers: No local build blockers remain; issue/PR closure still depends on the final push landing on `main`.
- Next: Push the verified cleanup commit, then close issues fixed by the dependency bump plus the new discoverability/service-tier/Windows patches, and close the stale ValiChord PR explicitly instead of leaving it open indefinitely.

### 2026-04-08 16:11 UTC — pi-web-access-config-path (Issue #32)

- Objective: Fix `pi-web-access` ignoring `~/.feynman/web-search.json` and throwing `modelRegistry.getApiKeyAndHeaders is not a function`.
- Changed: Removed stale `.feynman/vendor-overrides/pi-web-access/*` (imported non-existent `./search-filter.js`); removed dead `syncVendorOverride` in `patch-embedded-pi.mjs`; added `scripts/lib/pi-web-access-patch.mjs` to rewrite hardcoded `~/.pi/web-search.json` paths at runtime using `FEYNMAN_WEB_SEARCH_CONFIG` or `PI_CODING_AGENT_DIR`.
- Verified: Clean npm install + patch; `feynman doctor` shows `config path: ~/.feynman/web-search.json`; `npm test` passes.
- Failed / learned: Vendor overrides were stale copies from an older `pi-web-access` version, not intentional customizations; copying them over npm sources caused the bug.
- Blockers: None.
- Next: Release and verify tagged install reads from correct config path.