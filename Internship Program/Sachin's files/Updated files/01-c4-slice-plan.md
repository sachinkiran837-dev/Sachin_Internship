# Atlas — C4 Interactive Establishment Map: End-to-End Slice Plan

*As at 23 July 2026. Source: `Atlas: Product Requirements and Agent Capability Blueprint` v0.1 (C4, Section 6), and a reverse-read of the existing reference build `Internship Program/Atlas.html`. Companion docs: `00-prd-chunks.md`, `skills/skill-org-visualisation.md`.*

---

## 1. Why this slice

C4 is the "Understand" stage of the pipeline (PRD Section 5) and the surface a Project Partner spends the most time in front of a client on. It also sits at the join between the confirmed data (C1/C2) and redesign (C5): the PRD leaves open whether map edits and scenario moves share one working copy, and the existing reference build already answers that question in production code — reusing that answer is the highest-leverage part of owning this slice.

## 2. Inputs

- The confirmed org graph from C2 (positions, reporting lines, hierarchy, cost, per-node derived flags).
- The protected-roles taxonomy: a rule table of `{match keywords, tier: statutory | governance | safety, instrument, reason}`.
- Span-health thresholds (healthy min/max span) — currently a hardcoded assumption in the reference build; the PRD leaves configurability per client/sector open.
- User interaction events: click, drag, filter input, free-text search, box-select.

## 3. Steps

1. **Compute layout.** Deterministic tree layout from the graph: depth-first, x = midpoint of children's x (or a running cursor for leaves), y = depth × row height. No external layout library required — the reference build's own ~15-line recursive function does this and is reusable near as-is.
2. **Tag every node** in one pass with derived flags: protected (tier/instrument/reason), unit-roster, single-report, thin/wide span, key-person, vacant, contingent.
3. **Render the canvas.** React Flow, a custom node card, smoothstep edges, `fitView`, minimap, a wide zoom range (the reference build uses 0.05–1.6), attribution hidden.
4. **Explore.** Expand the first two levels by default; click to expand/collapse; a filter panel (division, flag, span-health, free text) dims non-matches while keeping any ancestor of a match fully visible; search auto-expands ancestors of a hit and flies the view to it.
5. **Select a role** to open a detail panel: reporting line, team beneath, cost, and the protection instrument if flagged.
6. **Edit: reassign a reporting line** by dragging a role near another role; a nearest-neighbour hit test (closest node center within a distance threshold) reassigns it. No manual edge-drawing.
7. **Route every edit through one mutation entry point.** Auto-create a working-copy scenario if none is active yet, or append to the active one; recompute the model and the diff against baseline on every change. This is the single object C5 also reads and writes — proven in the reference build, worth locking in as the C4↔C5 contract.
8. **Enforce the protect-controls guardrail inside that same mutation entry point**, not in the UI layer alone: check the protected-lookup before any remove or reassign, block with a narrative ("Kept [role] in place: a protected clinical or governance control") if blocked. Because the check sits at the single point of mutation, it can't be bypassed by drag, by a future add/remove UI, or by a chat-parsed scenario move.
9. **(New work, not proven in the reference build) Write an audit entry per accepted edit** — who, what, when — to satisfy the PRD's cross-cutting reproducibility/audit requirement (Section 8). The reference build holds everything in an in-memory store with no audit trail.
10. **(Should, not must for v1) Explain a part of the chart on request.** Decide whether to keep the reference build's deterministic/canned-narrative shortcut or spend a real grounded model call — see open decisions below.

## 4. Outputs

- A rendered, editable interactive establishment map.
- A working-copy graph (the active scenario) that feeds C5 directly.
- Protected-role badges on the map and block narratives when a guardrail fires.
- An audit log entry per accepted edit (new work beyond the reference build).

## 5. What the reference build already proves (reuse, don't rebuild)

- The layout algorithm.
- The tagging pass and its flag set.
- The single-mutation-point guardrail pattern.
- The auto-create-or-append working-copy contract between map edits and scenarios.

## 6. Open decisions to close before/while building

1. Real LLM call vs. the reference build's deterministic/canned-text shortcut for "explain this part of the chart" — and if canned, document it explicitly as a deliberate AI-optional fallback rather than an accidental one.
2. Keep drag-to-nearest-neighbour reassignment, or move to a click-to-reassign picker for clarity on a first build.
3. Where the protected-role taxonomy is authored and stored — hardcoded per client (as today) or a config/retrieval asset.
4. Span-health thresholds: fixed defaults, or configurable per client/sector (PRD open question, Section 6 C3).

## 7. Definition of done for a first build

- A real client export, once through C1/C2, renders as a correctly laid-out, expandable, filterable map.
- Dragging a role to reparent it updates the working-copy graph, and that same graph is what a subsequent C5 scenario operates on.
- Attempting to remove or reassign a protected role is blocked with a visible reason, every time, regardless of which UI action triggered it.
- Every accepted edit has a traceable audit entry.
