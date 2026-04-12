---
description: Summarize any URL, local file, or PDF using the RLM pattern — source stored on disk, never injected raw into context.
args: <source>
section: Research Workflows
topLevelCli: true
---
Summarize the following source: $@

Derive a short slug from the source filename or URL domain (lowercase, hyphens, no filler words, ≤5 words — e.g. `attention-is-all-you-need`). Use this slug for all files in this run.

## Why this uses the RLM pattern

Standard summarization injects the full document into context. Above ~15k tokens, early content degrades as the window fills (context rot). This workflow keeps the document on disk as an external variable and reads only bounded windows — so context pressure is proportional to the window size, not the document size.

Tier 1 (< 8k chars) is a deliberate exception: direct injection is safe at ~2k tokens and windowed reading would add unnecessary friction.

---

## Step 1 — Fetch, validate, measure

Run all guards before any tier logic. A failure here is cheap; a failure mid-Tier-3 is not.

- **GitHub repo URL** (`https://github.com/owner/repo` — exactly 4 slashes): fetch the raw README instead. Try `https://raw.githubusercontent.com/{owner}/{repo}/main/README.md`, then `/master/README.md`. A repo HTML page is not the document the user wants to summarize.
- **Remote URL**: fetch to disk with `curl -sL -o outputs/.notes/<slug>-raw.txt <url>`. Do NOT use fetch_content — its return value enters context directly, bypassing the RLM external-variable principle.
- **Local file or PDF**: copy or extract to `outputs/.notes/<slug>-raw.txt`. For PDFs, extract text via `pdftotext` or equivalent before measuring.
- **Empty or failed fetch**: if the file is < 50 bytes after fetching, stop and surface the error to the user — do not proceed to tier selection.
- **Binary content**: if the file is > 1 KB but contains < 100 readable text characters, stop and tell the user the content appears binary or unextracted.
- **Existing output**: if `outputs/<slug>-summary.md` already exists, ask the user whether to overwrite or use a different slug. Do not proceed until confirmed.

Measure decoded text characters (not bytes — UTF-8 multi-byte chars would overcount). Log: `[summarize] source=<source> slug=<slug> chars=<count>`

---

## Step 2 — Choose tier

| Chars | Tier | Strategy |
|---|---|---|
| < 8 000 | 1 | Direct read — full content enters context (safe at ~2k tokens) |
| 8 000 – 60 000 | 2 | RLM-lite — windowed bash extraction, progressive notes to disk |
| > 60 000 | 3 | Full RLM — bash chunking + parallel researcher subagents |

Log: `[summarize] tier=<N> chars=<count>`

---

## Tier 1 — Direct read

Read `outputs/.notes/<slug>-raw.txt` in full. Summarize directly using the output format. Write to `outputs/<slug>-summary.md`.

---

## Tier 2 — RLM-lite windowed read

The document stays on disk. Extract 6 000-char windows via bash:

```python
# WHY f.seek/f.read: the read tool uses line offsets, not char offsets.
# For exact char-boundary windowing across arbitrary text, bash is required.
with open("outputs/.notes/<slug>-raw.txt", encoding="utf-8") as f:
    f.seek(n * 6000)
    window = f.read(6000)
```

For each window:
1. Extract key claims and evidence.
2. Append to `outputs/.notes/<slug>-notes.md` **before reading the next window** — this is the checkpoint: if the session is interrupted, processed windows survive.
3. Log: `[summarize] window <N>/<total> done`

Synthesize `outputs/.notes/<slug>-notes.md` → `outputs/<slug>-summary.md`.

---

## Tier 3 — Full RLM parallel chunks

Each chunk gets a fresh researcher subagent context window — context rot is impossible because no subagent sees more than 6 000 chars.

**WHY 500-char overlap:** academic papers contain multi-sentence arguments that span chunk boundaries. 500 chars (~80 words) ensures a cross-boundary claim appears fully in at least one adjacent chunk.

### 3a. Chunk the document

```python
import os
os.makedirs("outputs/.notes", exist_ok=True)

with open("outputs/.notes/<slug>-raw.txt", encoding="utf-8") as f:
    text = f.read()

chunk_size, overlap = 6000, 500
chunks, i = [], 0
while i < len(text):
    chunks.append(text[i : i + chunk_size])
    i += chunk_size - overlap

for n, chunk in enumerate(chunks):
    # Zero-pad index so files sort correctly (chunk-002 before chunk-010)
    with open(f"outputs/.notes/<slug>-chunk-{n:03d}.txt", "w", encoding="utf-8") as f:
        f.write(chunk)

print(f"[summarize] chunks={len(chunks)} chunk_size={chunk_size} overlap={overlap}")
```

### 3b. Confirm before spawning

Tell the user: "Source is ~<chars> chars → <N> chunks → <N> researcher subagents. This may take several minutes. Proceed?" Wait for confirmation — Tier 3 is the only path where compute is non-trivial and invisible without this gate.

### 3c. Dispatch researcher subagents

```json
{
  "tasks": [{
    "agent": "researcher",
    "task": "Read ONLY `outputs/.notes/<slug>-chunk-NNN.txt`. Extract: (1) key claims, (2) methodology or technical approach, (3) cited evidence. Do NOT use web_search or fetch external URLs — this is single-source summarization. If a claim appears to start or end mid-sentence at the file boundary, mark it BOUNDARY PARTIAL. Write to `outputs/.notes/<slug>-summary-chunk-NNN.md`.",
    "output": "outputs/.notes/<slug>-summary-chunk-NNN.md"
  }],
  "concurrency": 4,
  "failFast": false
}
```

### 3d. Aggregate

After all subagents return, verify every expected `outputs/.notes/<slug>-summary-chunk-NNN.md` exists. Note any missing chunk indices — they will appear in the Coverage gaps section of the output. Do not abort on partial coverage; a partial summary with gaps noted is more useful than no summary.

When synthesizing:
- **Deduplicate**: a claim in multiple chunks is one claim — keep the most complete formulation.
- **Resolve boundary conflicts**: for adjacent-chunk contradictions, prefer the version with more supporting context.
- **Remove BOUNDARY PARTIAL markers** where a complete version exists in a neighbouring chunk.

Write → `outputs/<slug>-summary.md`.

---

## Output format

All tiers produce the same artifact at `outputs/<slug>-summary.md`:

```markdown
# Summary: [document title or source filename]

**Source:** [URL or file path]
**Date:** [YYYY-MM-DD]
**Tier:** [1 / 2 (N windows) / 3 (N chunks)]

## Key Claims
[3–7 most important assertions, each as a bullet]

## Methodology
[Approach, dataset, evaluation, baselines — omit for non-research documents]

## Limitations
[What the source explicitly flags as weak, incomplete, or out of scope]

## Verdict
[One paragraph: what this document establishes, its credibility, who should read it]

## Sources
1. [Title or filename] — [URL or file path]

## Coverage gaps *(Tier 3 only — omit if all chunks succeeded)*
[Missing chunk indices and their approximate byte ranges]
```

Sources contains only the single source confirmed reachable in Step 1. No verifier subagent needed — there are no URLs constructed from memory to verify.
