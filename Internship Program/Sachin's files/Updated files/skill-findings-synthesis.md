---
name: findings-synthesis
description: Turn computed operating-model metrics into a plain-language read a Project Partner can walk a client through. Closest to PRD capability C3's narrative layer, adjacent to N1.
---

# Skill: Findings Synthesis

*As at 23 July 2026. Grounded in PRD C3 (Section 6) and a reverse-read of `Internship Program/Atlas.html`'s findings generator. Companion: `../00-prd-chunks.md`.*

## Purpose

Turn the already-computed operating-model metrics (spans, layers, cost, protected controls) into a short narrative and a ranked findings list a Project Partner can present to a client without re-deriving anything.

## Inputs

- The metric set from the diagnostic engine (C3): spans, layers, cost, flagged inefficiency patterns.
- The protected-controls count and tiers.

## Steps

1. Run the plain-language narrative generator over the already-computed numbers — a model call that only frames, never recomputes them.
2. Surface a small, capped number of headline findings (the reference build caps this at 5), each with a "so what," its supporting evidence IDs, and suggested follow-up questions.
3. Cite the source metric for every claim in the narrative, so nothing in the summary is unsourced.
4. Surface the protected/governance zone as its own explicit finding — it's the one thing a redesign must never quietly touch, so it earns a dedicated card rather than being folded into a general summary.

## Outputs

- A short narrative summary.
- A ranked findings list with evidence links.
- Follow-up prompts, feeding Ask Atlas (N1).

## Edge cases / failure modes

- The narrative drifts from the underlying numbers (states a percentage or figure the metrics don't actually support) — this is exactly the arithmetic-integrity failure the PRD's governing rule exists to prevent, so it needs a grounding check or validation pass, not blind trust in the model's phrasing.
- Too few or zero findings clear the threshold: the UI needs a defined "nothing notable to report" state, not an empty screen.
- A finding's underlying metric changes after a C2 correction: the narrative must regenerate, never go stale silently.
