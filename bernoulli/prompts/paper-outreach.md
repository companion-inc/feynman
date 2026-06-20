---
description: Summarize a paper then draft a cold email to the authors grounded in its hinges and Michelin-table questions.
args: <paper> [<target-author>] [--want <what-you-want>]
section: Research Workflows
topLevelCli: true
---
Write a cold email to the authors of this paper: $@

Derive a short slug from the paper filename or URL domain (lowercase, hyphens, no filler words, ≤5 words). Use this slug for all files in this run.

This is an execution request. Carry out the workflow with tools and durable files. Do not describe the protocol or stop after planning.

Required artifacts:
- Summary (reused if exists): `outputs/<slug>-summary.md`
- Final email: `outputs/<slug>-outreach.md`

---

## Step 1 — Resolve sender details

If the user did not provide their name, position, and affiliation inline, insert `[YOUR NAME]`, `[YOUR POSITION]`, `[YOUR AFFILIATION]` as explicit placeholders in the draft. Do not ask before proceeding — mark and continue.

If `--want` was not provided, default to requesting a 20-minute exploratory call.

---

## Step 2 — Get the summary

Check whether `outputs/<slug>-summary.md` already exists.

- **Exists:** Read it directly. Log: `[paper-outreach] reusing existing summary slug=<slug>`
- **Does not exist:** Run `/summarize <paper>` to produce it, then read the result. Log: `[paper-outreach] ran summarize slug=<slug>`

---

## Step 3 — Extract the two anchors

From `outputs/<slug>-summary.md`, extract:

**Hinges** (from Level 1): the top-ranked technical hinge — the single most original contribution that challenges or extends existing literature. Copy the exact phrasing used in the summary; do not paraphrase.

**Michelin question** (from Level 3): select the one question most likely to provoke genuine intellectual excitement in the authors — prefer questions that open a door rather than challenge a claim.

Log both extractions:
```
[paper-outreach] hinge="<hinge text>"
[paper-outreach] question="<michelin question text>"
```

---

## Step 4 — Draft the email

Apply the cold-email four-part structure. Every element must be present.

**Greeting**
Use `Prof.` or `Dr.` Never use first name. If the target author was not specified, address the first/corresponding author by full name using Level 0 of the summary.

**Introduction**
One sentence: `My name is [NAME]. I am a [POSITION] at [AFFILIATION]. I am writing because [one clause connecting your work to theirs].`

**Context/Connection**
Two to three sentences grounded entirely in the hinge extracted in Step 3. Show you read the paper, not just the abstract. Reference the specific mechanism, result, or framing — not a generic claim like "I found your work fascinating." If your own work connects to the hinge, say how in one sentence.

**Call for action**
Reframe the Michelin question as an invitation. Example pattern: `I have been thinking about [question reframed as your curiosity], and I would value your perspective. Would you be open to a 20-minute call at your convenience?` Make the ask bounded and achievable.

Formatting rules:
- Bold the single most important phrase in the body (usually the hinge reference)
- Keep the whole email under 200 words
- Use your full name as the sign-off

---

## Step 5 — Self-review

After the draft, append a short **Review** block inside `outputs/<slug>-outreach.md`:

```
## Review
- Greeting: [correct title used / placeholder]
- Context specificity: [cites specific hinge yes/no]
- Ask: [bounded and actionable yes/no]
- Placeholders remaining: [list or "none"]
- Word count: [N]
- Reading time: [~N seconds — flag if > 90s]
```

---

## Step 6 — Write and verify

Write the complete draft + Review block to `outputs/<slug>-outreach.md`.

Before stopping, verify on disk that `outputs/<slug>-outreach.md` exists.

Never end with planning-only chat. Never claim the email is complete unless `outputs/<slug>-outreach.md` exists on disk.
