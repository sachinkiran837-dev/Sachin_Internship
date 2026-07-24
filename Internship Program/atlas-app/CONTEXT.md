# CONTEXT.md

_State as of 2026-07-24._ A glossary and module map for the Atlas POC — read this before the source if you didn't build it.

## What this is

A working slice of Atlas: given an establishment export, ingest it into an org graph, render it as an interactive map, model redesign scenarios against it, and generate a plain-language read. It implements the four skill specs in `../Sachin's files/Updated files/` (`skill-data-ingest-and-comprehend.md`, `skill-org-visualisation.md`, `skill-scenario-model.md`, `skill-findings-synthesis.md`) plus the shared C3 diagnostic engine they both depend on.

## Vocabulary

- **Establishment** — the org being modelled: a set of positions with reporting lines, one per uploaded file (`orgs` table).
- **Position** — one row of the establishment: title, department, manager, cost, status (filled/vacant/contingent), plus derived classification and confidence.
- **Baseline** — the confirmed positions as ingested, immutable once created.
- **Working-copy scenario** — a full copy-on-write snapshot of positions that a redesign mutates. The **active** scenario is the one the establishment map reads and writes; other scenarios are named and compared but not shown on the map in this build (see README's scope cuts).
- **Single mutation entry point** — `lib/scenario/mutate.ts`'s `applyMutation`. Every edit, whether a map drag or a typed move, funnels through it: guardrails first, then the mutation, then a metrics recompute and one audit log entry.
- **Protected role** — a position matching `config/protected-roles.json` (statutory / governance / safety tier). Blocked from removal or reassignment at the mutation entry point, never just in the UI.
- **Flags** — derived per-position tags computed in `lib/graph/tagging.ts`: protected, unit-roster, single-report, span health (thin/healthy/wide), key-person, vacant, contingent.
- **Visible-fallback pattern** — every AI-shaped behaviour (role classification, findings narrative) has a deterministic path and runs on it when `ANTHROPIC_API_KEY` is unset; the UI says which path it took, never silently.

## Module map

| Concern | Path |
|---|---|
| Domain types | `lib/graph/types.ts` |
| Ingest (C1) | `lib/ingest/` — `parseFile.ts`, `columnMapper.ts`, `anonymize.ts`, `classify.ts`, `buildGraph.ts` |
| Layout + tagging (C4) | `lib/graph/layout.ts`, `lib/graph/tagging.ts`, `lib/graph/hitTest.ts`, `lib/graph/descendants.ts` |
| Diagnostic engine (shared C3 infra) | `lib/metrics/diagnostics.ts` |
| Protected-role config | `config/protected-roles.json`, `config/span-thresholds.json`, `lib/protected-roles/match.ts` |
| Scenario mutation + moves (C5) | `lib/scenario/guardrails.ts`, `moves.ts`, `moveParser.ts`, `mutate.ts`, `compare.ts` |
| Findings synthesis (C3 narrative) | `lib/findings/generate.ts` |
| AI wrapper (both AI-shaped behaviours) | `lib/ai/client.ts` |
| Database | `db/schema.ts` (Drizzle), `db/client.ts`, `db/repo.ts` |
| Pages | `app/org/[orgId]/{page,map,scenarios,findings}` |
| Map UI | `components/map/` (`EstablishmentMap.tsx` is the React Flow canvas) |

## Data flow

Upload → `app/actions/ingest.ts` → `lib/ingest/buildGraph.ts` → `db/repo.ts` (`positions`, `ingest_issues`) → baseline is immutable from here.

Map drag or typed move → `lib/scenario/mutate.ts` (`reassignPosition` / `submitScenarioMove`) → guardrails in `lib/scenario/moves.ts` → `scenarios.working_graph_json` updated + one `audit_log` row → `revalidatePath` refreshes the map/scenario/findings pages in the same round trip.

Findings page → `lib/metrics/diagnostics.ts` (`computeMetrics`) on whichever positions are current (active scenario if one exists, else baseline) → `lib/findings/generate.ts`.
