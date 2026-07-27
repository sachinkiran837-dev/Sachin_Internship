---
name: scenario-model
description: Model a redesign move (typed or map-built) and compute its headcount, cost and structural impact against baseline. Atlas capability C5.
---

# scenario-model — Model a redesign move and its cost impact

Applies a redesign — typed in plain English or built on the map — to a working copy of the graph and computes the headcount, cost and structural delta against baseline. Shares its working-copy object with `org-visualisation`: a map edit and a scenario move are the same kind of change, under the same guardrail.

## Purpose

Let a Project Partner describe a redesign in plain English or by editing the map, then show the headcount, cost and structural impact of that change against the confirmed baseline — this is where the product pays for itself.

## Inputs

- The baseline graph.
- A scenario: typed free text, or moves built on the map (shares the same working-copy object as `org-visualisation`).
- The recognised move vocabulary — the reference build's actual starting scope for "plain English to structured moves" is three patterns, not an open-ended capability:

  | Move type | Trigger phrasing (regex, illustrative) |
  |---|---|
  | Flatten / collapse to N layers | "flatten," "collapse," "reduce ... layers," "target ... layers" |
  | Merge / consolidate into a shared service | "merge," "consolidat(e/ion)," "shared service" |
  | Reduce management / delayer | "reduce management," "cut management," "de-layer," "fewer managers" |

  Anything outside these three returns "couldn't understand this" rather than a guess. Expanding this vocabulary is real scope, not a tuning tweak.
- The cost-assumption model — two concrete mechanisms, not one abstract input:
  - **Contingent premium rate: 45%** — the markup applied to agency/locum/casual cost versus a permanent equivalent, used when costing a scenario's contingent-reliance impact.
  - **Cost-band-by-level lookup table** — the fallback price (~$120k default band) for a newly added or edited role with no explicit cost, keyed by depth in the hierarchy.
- Span-health thresholds (shared with `org-visualisation`): `healthySpanMin` / `healthySpanMax` = 4 / 9, used when the structural delta recomputes span health after a move.
- The protected-roles set.

## Method

1. **Parse the scenario.** Translate plain English into structured moves — the only model job in this skill. (The reference build currently does this with regex/keyword matching for common phrasings — "flatten X to N layers," "merge X into a shared service" — not a real model call. Decide deliberately whether v1 keeps that deterministic shortcut or spends an actual grounded LLM call.) **Done when** every recognised phrasing maps to exactly one move type, and an unrecognised one returns a clear "couldn't understand this" rather than silence.
2. **Apply moves.** Apply moves to the working copy (remove, add, redesign, consolidate). **Done when** the working copy reflects every applied move and no move is left partially applied.
3. **Guard.** Enforce protected roles inside every move, at the point of mutation. **Done when** no move can remove or reassign a protected role, and every blocked attempt returns a narrative naming which role and why.
4. **Compute impact.** Recompute headcount, cost, spans and layers as a delta against baseline. **Done when** the delta is fully reproducible from the working copy and baseline alone, with no hidden state.
5. **Model transition.** Model transition cost and net position at run-rate, from visible, editable assumptions. **Done when** every assumption used is shown and editable, none buried in code.
6. **Compare.** Compare two or more scenarios side by side. **Done when** any two scenarios sharing a baseline can be compared without recomputation drift.

## Mechanism map

| Behaviour | Mechanism | Note |
|---|---|---|
| Scenario parsing | Model call | The only model job in this skill — language to structured moves |
| Apply moves | Deterministic | remove / add / redesign / consolidate |
| Protect-controls guardrail | Deterministic guardrail | Shared contract with `org-visualisation` |
| Impact delta | Deterministic | Reproducible and auditable |
| Transition modelling | Deterministic | Visible, editable assumptions |
| Scenario comparison | Deterministic | |

## Outputs

- A modelled scenario with headcount, cost and structural deltas.
- A comparison view across scenarios.
- A safe-staffing-breach flag if any protected or clinical role was touched.

## Edge cases / failure modes

- Free text that doesn't match any known move pattern: return a clear "couldn't understand this," never a silent no-op or a hallucinated move.
- A move that would remove a protected role: block and narrate why, don't just skip it silently.
- Transition-cost assumptions are still an open PRD decision (global default vs. per-client vs. per-scenario) — don't hardcode one without flagging it.
- Comparing scenarios built from different baselines (after a client sends a corrected export): needs explicit versioning, never a silent diff across incompatible graphs.
- A scenario move interacts with a map edit on the same working copy: since both funnel through one mutation entry point, the guardrail and recompute must fire identically regardless of which surface triggered the change.

## Composes with

- **`org-visualisation`**: shares the same working-copy graph and the same guardrail check.
- **`data-ingest-and-comprehend`**: baseline traces back to the confirmed graph this skill produces.
- **`findings-synthesis`**: candidate moves may originate from a cited finding; not yet scoped as a formal hand-off.
