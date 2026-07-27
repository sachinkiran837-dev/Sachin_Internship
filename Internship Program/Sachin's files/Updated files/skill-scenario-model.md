---
name: scenario-model
description: Model a redesign move (typed or map-built) and compute its headcount, cost and structural impact against baseline. Covers PRD capability C5.
---

# Skill: Scenario Model

*As at 23 July 2026. Grounded in PRD C5 (Section 6) and a reverse-read of `Internship Program/Atlas.html`'s scenario engine. Companion: `../01-c4-slice-plan.md` (shares one working-copy contract with C4).*

## Purpose

Let a Project Partner describe a redesign in plain English or by editing the map, then show the headcount, cost and structural impact of that change against the confirmed baseline — this is where the product pays for itself.

## Inputs

- The baseline graph.
- A scenario: typed free text, or moves built on the map (shares the same working-copy object as C4).
- The cost-assumption model.
- The protected-roles set.

## Steps

1. Translate a plain-English scenario into structured moves — the only place a model is used in this skill. (The reference build currently does this with regex/keyword matching for common phrasings — "flatten X to N layers", "merge X into a shared service" — not a real model call. Decide deliberately whether v1 keeps that deterministic shortcut or spends an actual grounded LLM call.)
2. Apply moves to a working copy of the graph — remove, add, redesign, consolidate a function. Deterministic.
3. Enforce protected roles inside every move, at the point of mutation — a scenario can never delete a statutory or safety role. A blocked move returns a narrative, never a silent no-op.
4. Recompute headcount, cost, spans and layers as a delta against baseline — the deterministic impact engine.
5. Model transition cost and net position at run-rate from visible, editable assumptions.
6. Compare two or more scenarios side by side.

## Outputs

- A modelled scenario with headcount, cost and structural deltas.
- A comparison view across scenarios.
- A safe-staffing-breach flag if any protected or clinical role was touched.

## Edge cases / failure modes

- Free text that doesn't match any known move pattern: return a clear "couldn't understand this," never a silent no-op or a hallucinated move.
- A move that would remove a protected role: block and narrate why, don't just skip it silently.
- Transition-cost assumptions are still an open PRD decision (global default vs. per-client vs. per-scenario) — don't hardcode one without flagging it.
- Comparing scenarios built from different baselines (after a client sends a corrected export): needs explicit versioning, never a silent diff across incompatible graphs.
- A scenario move interacts with a C4 map edit on the same working copy: since both funnel through one mutation entry point, the guardrail and recompute must fire identically regardless of which surface triggered the change.
