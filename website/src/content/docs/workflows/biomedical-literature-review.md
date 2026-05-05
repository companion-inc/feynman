---
title: Biomedical Literature Review
description: Use Feynman for research-only biomedical literature reviews with evidence grading and privacy boundaries.
section: Workflows
order: 3
---

Biomedical literature reviews need stricter source handling than general technical surveys. Use this workflow for research synthesis, manuscript preparation, journal club preparation, protocol scoping, or background reading. Do not use it for patient-specific diagnosis, treatment selection, triage, or medical advice.

## Usage

From the REPL:

```
/lit PICO: adults with type 2 diabetes; intervention continuous glucose monitoring; comparator standard self-monitoring; outcomes HbA1c and hypoglycemia
```

From the CLI:

```bash
feynman lit "PICO: adults with type 2 diabetes; intervention continuous glucose monitoring; comparator standard self-monitoring; outcomes HbA1c and hypoglycemia"
```

## Frame the question

Start with a structured research question. For intervention questions, prefer PICO or PICOS:

- **Population** -- patient group, disease definition, setting, age range, severity, and key exclusions
- **Intervention or exposure** -- treatment, diagnostic test, risk factor, care model, or exposure
- **Comparator** -- placebo, usual care, standard test, alternative intervention, or no comparator
- **Outcomes** -- primary and secondary outcomes, safety outcomes, follow-up duration, and clinically meaningful thresholds
- **Study design** -- systematic reviews, randomized trials, cohort studies, case-control studies, diagnostic accuracy studies, qualitative studies, or guidelines

For non-intervention questions, state the study type directly. Examples: prognosis, diagnostic accuracy, adverse event signal, mechanism, epidemiology, implementation, or health economics.

## Source priority

Ask Feynman to separate evidence by study design instead of treating every source as equal. A typical biomedical review should distinguish:

- clinical practice guidelines and consensus statements
- systematic reviews and meta-analyses
- randomized controlled trials
- prospective and retrospective cohort studies
- case-control studies
- diagnostic accuracy studies
- case series and case reports
- preprints, conference abstracts, and non-peer-reviewed material
- mechanistic, animal, or in vitro studies

When evidence conflicts, keep the disagreement visible. Do not collapse guideline statements, trials, observational studies, and mechanistic papers into one undifferentiated conclusion.

## What to ask Feynman to report

For biomedical topics, include these instructions in the prompt when they matter:

- define inclusion and exclusion criteria before searching
- report search terms, time window, and source types
- separate clinical outcomes from surrogate outcomes
- identify effect sizes, confidence intervals, follow-up duration, and absolute risk when sources provide them
- distinguish efficacy, effectiveness, safety, feasibility, and cost
- flag single-study conclusions, small samples, unadjusted analyses, and indirect evidence
- identify whether claims come from peer-reviewed publications, preprints, registry records, guidelines, or secondary summaries
- state limitations and unresolved questions before giving a bottom-line synthesis

## Privacy and safety boundaries

Do not paste protected health information, identifiable patient details, imaging identifiers, hospital records, insurance records, or private clinical notes into a Feynman workflow. Use de-identified, aggregate, or fictionalized research questions instead.

Feynman outputs should be treated as research drafts. A biomedical review can help organize the literature, but it does not replace a systematic review protocol, clinical guideline process, institutional review, statistical analysis plan, or licensed clinical judgment.

Avoid prompts that ask for direct patient advice. If a topic touches diagnosis, treatment, screening, or safety, phrase the task as literature synthesis:

```text
Summarize the research literature on...
Compare the evidence for...
Identify limitations and gaps in studies about...
Draft a background section for a research protocol on...
```

Do not phrase it as:

```text
What should this patient do?
Which treatment should I choose for this case?
Diagnose this patient.
```

## Good output checklist

A useful biomedical literature review should include:

- the framed question and scope
- the search strategy or exact search terms used
- evidence grouped by study design
- key effect estimates only when source-backed
- evidence quality caveats
- safety signals and adverse event reporting when relevant
- conflicts, uncertainty, and generalizability limits
- a clear statement that the output is research synthesis, not medical advice

If Feynman cannot access a full text, trial registry, guideline, supplement, dataset, or source URL, the review should mark that check as blocked instead of inferring missing details.
