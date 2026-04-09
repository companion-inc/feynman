# Agents

`AGENTS.md` is the repo-level contract for agents working in this repository.

Pi subagent behavior does **not** live here. The source of truth for bundled Pi subagents is `.feynman/agents/*.md`, which the runtime syncs into the Pi agent directory. If you need to change how `researcher`, `reviewer`, `writer`, or `verifier` behave, edit the corresponding file in `.feynman/agents/` instead of duplicating those prompts here.

## Pi subagents

Feynman ships four bundled research subagents:

- `researcher`
- `reviewer`
- `writer`
- `verifier`

They are defined in `.feynman/agents/` and invoked via the Pi `subagent` tool.

## What belongs here

Keep this file focused on cross-agent repo conventions:

- output locations and file naming expectations
- workspace-level continuity expectations for long-running work
- provenance and verification requirements
- handoff rules between the lead agent and subagents

Do **not** restate per-agent prompt text here unless there is a repo-wide constraint that applies to all agents.

## Output conventions

- Research outputs go in `outputs/`.
- Paper-style drafts go in `papers/`.
- Session logs go in `notes/`.
- The workspace-level lab notebook lives at `CHANGELOG.md`.
- Plan artifacts for long-running workflows go in `outputs/.plans/`.
- Intermediate research artifacts are written to disk by subagents and read by the lead agent. They are not returned inline unless the user explicitly asks for them.
- Long-running workflows should treat the plan artifact as an externalized working memory, not a static outline. Keep task status and verification state there as the run evolves.
- Long-running or resumable workflows should also treat `CHANGELOG.md` as the chronological lab notebook: what changed, what failed, what was verified, and what should happen next.
- Do not create or update `CHANGELOG.md` for trivial one-shot tasks.

## File naming

Every workflow that produces artifacts must derive a short **slug** from the topic (lowercase, hyphens, no filler words, ≤5 words — e.g. `cloud-sandbox-pricing`). All files in a single run use that slug as a prefix:

- Plan: `outputs/.plans/<slug>.md`
- Intermediate research: `<slug>-research-web.md`, `<slug>-research-papers.md`, etc.
- Draft: `outputs/.drafts/<slug>-draft.md`
- Cited brief: `<slug>-brief.md`
- Verification: `<slug>-verification.md`
- Final output: `outputs/<slug>.md` or `papers/<slug>.md`
- Provenance: `<slug>.provenance.md` (next to the final output)

Never use generic names like `research.md`, `draft.md`, `brief.md`, or `summary.md`. Concurrent runs must not collide.

## Workspace changelog

- `CHANGELOG.md` is a lab notebook, not release notes.
- Read `CHANGELOG.md` before resuming substantial work when it exists.
- Append concise entries after meaningful progress, failed approaches, major verification results, or new blockers.
- Each entry should identify the active slug or objective and end with the next recommended step.
- Mark verification state honestly with labels such as `verified`, `unverified`, `blocked`, or `inferred` only when they match the underlying evidence.

## Provenance and verification

- Every output from `/deepresearch` and `/lit` must include a `.provenance.md` sidecar.
- Provenance sidecars should record source accounting and verification status.
- Source verification and citation cleanup belong in the `verifier` stage, not in ad hoc edits after delivery.
- Verification passes should happen before delivery when the workflow calls for them.
- If a workflow uses the words `verified`, `confirmed`, or `checked`, the underlying artifact should record what was actually checked and how.
- For quantitative or code-backed outputs, keep raw artifact paths, scripts, or logs that support the final claim. Do not rely on polished summaries alone.
- Never smooth over missing checks. Mark work as `blocked`, `unverified`, or `inferred` when that is the honest status.

## Experimental code integrity

These rules apply to all agents that produce or consume experiment code.

- Experiment code is a first-class deliverable, not scaffolding. It must be auditable independently of the prose report.
- The `verifier` or `reviewer` subagent must audit experiment source code before the lead agent delivers results. The audit checks for: circular logic (hardcoding the expected answer), rigged baselines, assumptions that guarantee the conclusion, and mislabeling of simulated data as empirical.
- Qualitative framework comparisons with manually assigned scores are not experiments. They must be labeled as "qualitative architectural assessment" in both code and prose. They may not appear under headings like "Experiment N" or "Results".
- Simulated results must carry the label "simulated" wherever they appear in final outputs. A reader must never mistake a synthetic run for a real-world benchmark.
- When an experiment compares system A against baselines, the baselines must be the strongest feasible alternatives, not strawmen. Using pure random selection as the primary baseline when deterministic heuristics exist is not acceptable without explicit justification.
- If an experiment's design makes it impossible for the hypothesis to fail (e.g., passing the correct answer as input and then measuring accuracy), the experiment is invalid and must not be delivered.

## Delegation rules

- The lead agent plans, delegates, synthesizes, and delivers.
- Use subagents when the work is meaningfully decomposable; do not spawn them for trivial work.
- Prefer file-based handoffs over dumping large intermediate results back into parent context.
- The lead agent is responsible for reconciling task completion. Subagents may not silently skip assigned tasks; skipped or merged tasks must be recorded in the plan artifact.
- For critical claims, require at least one adversarial verification pass after synthesis. Fix fatal issues before delivery or surface them explicitly.
