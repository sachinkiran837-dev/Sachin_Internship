---
name: findings-synthesis
description: Turn computed operating-model metrics into a plain-language read a Project Partner can walk a client through. Closest to Atlas capability C3's narrative layer, adjacent to N1.
---

# findings-synthesis — Turn computed metrics into a plain-language read

Runs over metrics already computed elsewhere (spans, layers, cost, protected controls) and produces a short, cited narrative a Project Partner can present without re-deriving anything. Never computes a number itself.

## Purpose

Turn the already-computed operating-model metrics into a short narrative and a ranked findings list a Project Partner can present to a client.

## Inputs

- The metric set from the diagnostic engine (C3), specifically:
  - Span metrics: average/max span, and counts of thin/wide/healthy spans (using the `healthySpanMin`/`healthySpanMax` = 4/9 thresholds shared with `org-visualisation` and `scenario-model`).
  - Layer metrics: depth from CEO to frontline, layers by directorate, deepest directorate (max depth).
  - Cost metrics: clinical cost share (% of cost that is clinical vs. corporate), agency/contingent reliance share.
  - Flagged inefficiency patterns: single-report managers, corporate duplication, thin/wide-span directorates.
- The protected-controls count and tiers (statutory / governance / safety).
- The findings cap: **5** — the maximum number of headline findings surfaced per run. This is a tunable parameter, not just an implementation detail of the ranking step.

## Method

1. **Generate narrative.** Run the plain-language generator over already-computed numbers. **Done when** every sentence in the narrative can be traced to a specific input metric, none invented.
2. **Rank findings.** Surface a capped number of headline findings, each with a "so what," evidence IDs, and follow-up questions. **Done when** every finding shown has at least one evidence ID and the list never exceeds the cap.
3. **Cite sources.** Cite the source metric for every claim. **Done when** no claim in the narrative lacks a citable evidence ID.
4. **Surface the protected zone.** Give the protected/governance zone its own explicit finding. **Done when** a protected zone with at least one held role always produces exactly one dedicated finding, never folded into another.

## Mechanism map

| Behaviour | Mechanism | Note |
|---|---|---|
| Narrative generation | Model call | Runs over computed numbers, never recomputes them |
| Findings ranking | Deterministic candidate generation + model call to frame | Candidates are computed, framing/ranking is the model's job |
| Citation | Deterministic | Evidence IDs attached mechanically |
| Protected-zone finding | Deterministic | Always generated when protected roles exist |

## Outputs

- A short narrative summary.
- A ranked findings list with evidence links.
- Follow-up prompts, feeding Ask Atlas (N1).

## Edge cases / failure modes

- The narrative drifts from the underlying numbers (states a percentage or figure the metrics don't actually support) — exactly the arithmetic-integrity failure the PRD's governing rule exists to prevent, so it needs a grounding check or validation pass, not blind trust in the model's phrasing.
- Too few or zero findings clear the threshold: the UI needs a defined "nothing notable to report" state, not an empty screen.
- A finding's underlying metric changes after a QA correction: the narrative must regenerate, never go stale silently.

## Composes with

- **`data-ingest-and-comprehend`** and its downstream diagnostic engine: source of the metrics this skill narrates.
- **`org-visualisation`**: a finding's evidence IDs could highlight roles on the map; the hand-off isn't scoped yet.
- **`scenario-model`**: candidate opportunities surfaced here can seed a scenario.
