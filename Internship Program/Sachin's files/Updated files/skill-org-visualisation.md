---
name: org-visualisation
description: Render the org graph as an interactive, editable establishment map, with statutory and safety-critical roles held as protected controls. Covers PRD capability C4.
---

# Skill: Org Visualisation

*As at 23 July 2026. Grounded in PRD C4 (Section 6) and a reverse-read of `Internship Program/Atlas.html`. Companion: `../01-c4-slice-plan.md`.*

## Purpose

Turn the confirmed (or active working-copy) org graph into a canvas a Project Partner can explore and edit live in front of a client, while making it structurally impossible to remove or reassign a protected role by accident.

## Inputs

- The confirmed org graph, or the active scenario's working-copy graph if one exists.
- The protected-role taxonomy (`{match, tier, instrument, reason}` rules).
- Span-health thresholds.
- User interaction events: click, drag, filter, search, box-select.

## Steps

1. Compute a deterministic tree layout from the graph (depth-first; x from children's midpoint, y from depth). No layout library needed.
2. Tag every node once with derived flags: protected/tier/instrument/reason, unit-roster, single-report, thin/wide span, key-person, vacant, contingent.
3. Render the canvas: custom node card, smoothstep edges, `fitView`, minimap, wide zoom range.
4. Explore: expand the first two levels by default, expand/collapse on click, filter dims non-matches while preserving the ancestor path to any match, search auto-expands and flies to a hit.
5. On selecting a role, open a detail panel: reporting line, team beneath, cost, protection instrument if flagged.
6. On drag, reassign the reporting line via nearest-neighbour hit test against other visible node centers.
7. Route every edit through a single mutation entry point: auto-create a working-copy scenario if none is active, else append to it; recompute the model and the baseline diff.
8. Enforce the protect-controls guardrail inside that same mutation entry point — check the protected-lookup before any remove/reassign, block with a narrative if protected. Never rely on the UI alone to prevent this.
9. Write an audit entry (who, what, when) for every accepted edit.

## Outputs

- A rendered, editable establishment map.
- A working-copy graph that C5 (scenario modelling) reads and writes directly.
- Protected-role badges and block narratives surfaced in the UI.
- An audit log entry per accepted edit.

## Edge cases / failure modes

- The root node must never be draggable or reassignable.
- Two candidate drop targets equidistant from a dragged node — needs a deterministic tiebreak.
- A drag onto a dimmed/filtered-out node must not be a valid drop target.
- Reassigning a role to one of its own descendants would create a cycle — must be blocked, same as a protected-role removal.
- A protected role's title changes after a C2 correction — its protection tag must be recomputed, never left stale.
- The very first edit on a fresh baseline, with no scenario active yet — must auto-create one, never error or silently drop the edit.
- A very large org (1,000+ positions) at default expand depth — layout and render performance needs checking beyond the reference build's proven scale.
