# Contributing to Feynman

Feynman is a research-first CLI built on Pi and alphaXiv. This guide is for humans and agents contributing code, prompts, skills, docs, installers, or workflow behavior to the repository.

## Quick Links

- GitHub: https://github.com/advaitpaliwal/feynman
- Docs: https://feynman.is/docs
- Repo agent contract: [AGENTS.md](AGENTS.md)
- Issues: https://github.com/advaitpaliwal/feynman/issues

## What Goes Where

- CLI/runtime code: `src/`
- Bundled prompt templates: `prompts/`
- Bundled Pi skills: `skills/`
- Bundled Pi subagent prompts: `.feynman/agents/`
- Docs site: `website/`
- Build/release scripts: `scripts/`
- Generated research artifacts: `outputs/`, `papers/`, `notes/`

If you need to change how bundled subagents behave, edit `.feynman/agents/*.md`. Do not duplicate that behavior in `AGENTS.md`.

## Before You Open a PR

1. Start from the latest `main`.
2. Use Node.js `24.x` for local development. The supported runtime range is Node.js `22.22.0` through `25.x`; `.nvmrc` pins the preferred local version while `package.json`, `website/package.json`, and the runtime version guard define the broader supported range. The optional session-search package remains limited to Node.js `22.x` because its sqlite dependency does not reliably install on newer Node majors.
3. Install dependencies from the repo root:

```bash
nvm use || nvm install
npm install
```

4. Run the required checks before asking for review:

```bash
npm test
npm run typecheck
npm run build
```

5. If you changed the docs site, also validate the website:

```bash
cd website
npm install
npm run build
```

6. Keep the PR focused. Do not mix unrelated cleanup with the real change.
7. Add or update tests when behavior changes.
8. Update docs, prompts, or skills when the user-facing workflow changes.

## Contribution Rules

- Bugs, docs fixes, installer fixes, and focused workflow improvements are good PRs.
- Large feature changes should start with an issue or a concrete implementation discussion before code lands.
- Avoid refactor-only PRs unless they are necessary to unblock a real fix or requested by a maintainer.
- Do not silently change release behavior, installer behavior, or runtime defaults without documenting the reason in the PR.
- Use American English in docs, comments, prompts, UI copy, and examples.
- Do not add bundled prompts, skills, or docs whose primary purpose is to market, endorse, or funnel users toward a third-party product or service. Product integrations must be justified by user-facing utility and written in neutral language.

## Repo-Specific Checks

### Prompt and skill changes

- New workflows usually live in `prompts/*.md`.
- New reusable capabilities usually live in `skills/<name>/SKILL.md`.
- Keep skill files concise. Put detailed operational rules in the prompt or in focused reference files only when needed.
- If a new workflow should be invokable from the CLI, make sure its prompt frontmatter includes the correct metadata and that the command works through the normal prompt discovery path.

### Agent and artifact conventions

- `AGENTS.md` is the repo-level contract for workspace conventions, handoffs, provenance, and output naming.
- Long-running research flows should write plan artifacts to `outputs/.plans/` and use `CHANGELOG.md` as a lab notebook when the work is substantial.
- Do not update `CHANGELOG.md` for trivial one-shot changes.

### Release and versioning discipline

- The curl installer and release docs point users at tagged releases, not arbitrary commits on `main`.
- If you ship user-visible fixes after a tag, do not leave the repo in a state where `main` and the latest release advertise the same version string while containing different behavior.
- When changing release-sensitive behavior, check the version story across:
  - `.nvmrc`
  - `package.json`
  - `website/package.json`
  - `scripts/check-node-version.mjs`
  - install docs in `README.md` and `website/src/content/docs/getting-started/installation.md`

### Website deployment

The existing static `website/` build serves research docs and installers. Cloudflare
Pages project `feynman` (`feynman-bpr.pages.dev`) uses
`website/wrangler.jsonc` and uploads `website/dist`; building also synchronizes the
canonical installer scripts into the site.

`.github/workflows/deploy-website.yml` deploys only after a successful **Publish and
Release** run triggered by a `main` push in `advaitpaliwal/feynman`, or a manual
**Deploy website** dispatch on `main`. Forks, pull requests, unsuccessful releases,
and non-main manual runs are excluded. Both automatic and manual runs validate
their initiating SHA, then **reconcile current `main`**, not that initiating SHA.
Before checkout, the GitHub API must prove a completed, successful, same-repository
`main` push run of the existing `.github/workflows/publish.yml` at exactly current
main's SHA. The workflow has `contents: read` and `actions: read`; the automatic
`GITHUB_TOKEN` is exposed as `GH_TOKEN` only to this pre-checkout lookup.
API errors fail closed; an unqualified main skips every remaining step. Manual
dispatch does not bypass publisher success.

The qualified SHA is checked out exactly, its root manifest's
`@advaitpaliwal/feynman` version must exist on the public npm registry, and website
`npm ci`, lint, typecheck, and build must pass. Production runs remain serialized
without interrupting active uploads. GitHub can replace a pending run with a
delayed older event; that surviving run now reconciles qualified current main,
so it can deploy the newer release whose pending invocation was canceled. A final
live-main check still skips the upload if main changed after source selection.
There is no fallback to an older release when current main is unqualified; wait
for its successful publisher event or dispatch again after that proof exists.

Hosting and canonical secrets remain in the existing **Companion** organization:
Infisical project **feynman**, environment **prod**, mirrored to GitHub repository
secrets. GitHub and npm use the personal `advaitpaliwal` account. The existing
`CLOUDFLARE_API_TOKEN` secret is passed only to the upload step, after Wrangler
`4.107.0` is installed; no new credential is required. Cloudflare account ID
`2164ee7d134223511b4621d9b163a5ac` is a nonsecret workflow constant.

This configuration does not publish npm, change DNS, or establish a `feynman.is`
domain cutover. Maintainers handle release completion and domain routing separately.

## AI-Assisted Contributions

AI-assisted PRs are fine. The contributor is still responsible for the diff.

- Understand the code you are submitting.
- Run the local checks yourself instead of assuming generated code is correct.
- Include enough context in the PR description for a reviewer to understand the change quickly.
- If an agent updated prompts or skills, verify the instructions match the actual repo behavior.

## Review Expectations

- Explain what changed and why.
- Call out tradeoffs, follow-up work, and anything intentionally not handled.
- Include screenshots for UI changes.
- Resolve review comments you addressed before requesting review again.

## Good First Areas

Useful contributions usually land in one of these areas:

- installation and upgrade reliability
- research workflow quality
- model/provider setup ergonomics
- docs clarity
- preview and export stability
- packaging and release hygiene
