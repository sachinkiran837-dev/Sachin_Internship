---
name: org-visualisation
description: Render the org graph as an interactive, editable establishment map, with statutory and safety-critical roles held as protected controls. Atlas capability C4.
---

# org-visualisation — Render and edit the establishment map, protected roles held

Renders the confirmed graph from `data-ingest-and-comprehend` (or the active working copy from `scenario-model`) as a canvas a Project Partner can explore and edit live in front of a client. Every edit lands on the same working-copy object `scenario-model` reads and writes — this is not two separate edit paths, it is one shared contract. Run after ingestion and QA have produced a confirmed graph.

## Purpose

Turn the confirmed (or active working-copy) org graph into a canvas a Project Partner can explore and edit live, while making it structurally impossible to remove or reassign a protected role by accident.

## Inputs

- The confirmed org graph, or the active scenario's working-copy graph if one exists.
- The protected-role taxonomy: `{match keywords, tier, instrument, reason}` rules, tiers being `statutory` / `governance` / `safety`.
- Node-tagging thresholds — confirmed from the reference build's actual config, not placeholders:

  | Constant | Value | What it drives |
  |---|---|---|
  | `healthySpanMin` / `healthySpanMax` | 4 / 9 | Thin-spanned / wide-spanned flag on a node |
  | `unitRosterMin` | 6 | The unit-roster tag (`isUnitManager`) — a clinical manager with at least this many roster reports is treated as leading a roster, not a management chain |
  | `keyPersonTenureYears` | 12 | The key-person-risk flag, when tenure meets or exceeds this and the role is protected or non-clinical |

- Layout and rendering parameters:
  - Fixed node card width/height, and the horizontal/vertical spacing gaps between nodes (layout is fixed-size, not size-to-content).
  - Default expand depth: **2** — the first two hierarchy levels are expanded on load, everything below starts collapsed.
  - Drag hit-test distance threshold (≈90% of one node-width) — how close a dropped node must land to another node's center before a reassignment fires.
- User interaction events: click, drag, filter, search, box-select.

## Method

1. **Compute layout.** Deterministic tree layout from the graph (depth-first; x from children's midpoint, y from depth). No layout library needed. **Done when** every visible node has an x/y position and no two siblings overlap.
2. **Tag nodes.** One pass assigns protected/tier/instrument/reason, unit-roster, single-report, thin/wide span, key-person, vacant, contingent. **Done when** every node carries its full flag set and nothing is recomputed ad hoc at render time.
3. **Render the canvas.** Custom node card, smoothstep edges, `fitView`, minimap, wide zoom range. **Done when** the full tree renders and pans/zooms smoothly at the target org size.
4. **Explore.** Expand the first two levels by default, expand/collapse on click, filter dims non-matches while preserving the ancestor path to any match, search auto-expands and flies to a hit. **Done when** a filtered or searched-for role is always reachable without hand-expanding every ancestor.
5. **Inspect.** Selecting a role opens a detail panel: reporting line, team beneath, cost, protection instrument if flagged. **Done when** every field shown is read from the graph, never re-derived in the panel.
6. **Edit.** Dragging a role near another reassigns the reporting line via nearest-neighbour hit test. **Done when** a drop outside the hit-test threshold leaves the graph unchanged, and a drop inside it always resolves to exactly one new manager.
7. **Mutate through one entry point.** Auto-create a working-copy scenario if none is active, else append to it; recompute the model and the baseline diff. **Done when** no edit path — drag today, any add/remove UI later — can change the graph without passing through this function.
8. **Guard.** Enforce the protect-controls check inside that same mutation entry point, before any remove or reassign. **Done when** every mutation path is provably routed through the guardrail, not just the drag handler.
9. **Audit.** Write an entry (who, what, when) for every accepted edit. **Done when** every accepted edit has a corresponding log entry with no gap between the UI action and the write.

## Mechanism map

| Behaviour | Mechanism | Note |
|---|---|---|
| Layout | Deterministic | No external library dependency |
| Node tagging | Deterministic | One pass, cached on the node |
| Canvas render | Deterministic (React Flow) | Custom node type, smoothstep edges |
| Explore / filter / search | Deterministic | Dim-not-remove, ancestor-preserving |
| Edit / reassign | Deterministic, stateful | Nearest-neighbour hit test |
| Protect-controls guardrail | Deterministic guardrail | Enforced at the single mutation point, not the UI |
| Explain this part of the chart | Model call, or a deliberate deterministic fallback (open decision) | Optional overlay, not required for v1 |

## Outputs

- A rendered, editable establishment map.
- A working-copy graph, shared with `scenario-model`.
- Protected-role badges and block narratives, surfaced in the UI.
- An audit log entry per accepted edit.

## Edge cases / failure modes

- The root node must never be draggable or reassignable.
- Two candidate drop targets equidistant from a dragged node need a deterministic tiebreak.
- A drag onto a dimmed/filtered-out node must not be a valid drop target.
- Reassigning a role to one of its own descendants would create a cycle — must be blocked, same as a protected-role removal.
- A protected role's title changes after a QA correction — its protection tag must be recomputed, never left stale.
- The very first edit on a fresh baseline, with no scenario active yet, must auto-create one, never error or silently drop the edit.
- A very large org (1,000+ positions) at default expand depth — layout and render performance needs checking beyond the reference build's proven scale.

## Composes with

- **`data-ingest-and-comprehend`**: supplies the confirmed graph this skill renders.
- **`scenario-model`**: reads and writes the same working-copy object under the same guardrail — a map edit and a scenario move are the same kind of change.
- **`findings-synthesis`**: a finding's evidence could highlight or focus the map; the hand-off isn't scoped yet.
