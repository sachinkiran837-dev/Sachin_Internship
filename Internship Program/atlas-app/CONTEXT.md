# CONTEXT.md

_State as of 2026-08-03 (Phase 7 — final)._ A glossary and module map for the Atlas POC — read this before the source if you didn't build it.

## What this is

A working slice of Atlas: given an establishment export, ingest it into an org graph, render it as an interactive map, model redesign scenarios against it, and generate a plain-language read.

This was originally built against four skill specs labelled C1/C3/C4/C5 (still visible in some code comments and script names as historical labels). Those have since been superseded by a richer 27-skill, 9-module spec (A–I) in `../Sachin's files/NEW ATLAS SKILLS/`. The module map below uses the **new** codes. Rough correspondence to the old ones: C1 (ingest & comprehend) → A1/A2; C4 (org visualisation) → A2 + the map UI; C3 (diagnostic engine + findings narrative) → B1–B5 + the findings synthesis skills (G1); C5 (scenario modelling) → H1/H2.

**Coverage as of this pass (Phase 7 — Narrative and outputs, the final phase):** every module of the 27-skill spec (A1–A3, B1–B5, C1–C4, D1–D3, E1–E3, F1, G1–G2, H1–H3, I1–I3) is built out — see the module map below. "Built out" does not mean every worked example in every skill doc is implemented to the letter; see the closing "What this build genuinely is, and isn't" section for the honest scope cuts, which apply across every module, not just this last pass.

## Vocabulary

- **Establishment** — the org being modelled: a set of positions with reporting lines, one per uploaded file (`orgs` table).
- **Position** — one row of the establishment: title, department, manager, cost, status (filled/vacant/contingent), plus derived classification and confidence.
- **Baseline** — the confirmed positions as ingested, immutable once created.
- **Working-copy scenario** — a full copy-on-write snapshot of positions that a redesign mutates. The **active** scenario is the one the establishment map reads and writes; other scenarios are named and compared but not shown on the map in this build (see README's scope cuts).
- **Single mutation entry point** — `lib/scenario/mutate.ts`'s `applyMutation`. Every edit, whether a map drag or a typed move, funnels through it: guardrails first, then the mutation, then a metrics recompute and one audit log entry.
- **Protected role** — a position matching `config/protected-roles.json` (statutory / governance / safety tier). Blocked from removal or reassignment at the mutation entry point, never just in the UI.
- **Flags** — derived per-position tags computed in `lib/graph/tagging.ts`: protected, unit-roster, single-report, span health (thin/healthy/wide), span archetype, key-person, vacant, contingent.
- **Unit roster (A2)** — a manager whose reports are predominantly clinical/frontline and whose span is at least `unitRosterMin` (6) is staffing a roster, not running a management span, and is exempt from span-health flagging entirely — a Nurse Unit Manager with 30 reports reads `spanHealth: "healthy"`, not "wide".
- **Span archetype (B1)** — which calibration band (executive / complex-specialist / transactional / the flat default) a manager's span is benchmarked against, from `lib/graph/spanArchetype.ts` + `config/span-archetypes.json`.
- **Site (C1)** — the physical site/location a position sits at, read from an optional `site` column at ingest (kept apart from `department`). Null on any establishment whose file carries no such column; C1's footprint and C2's duplication detection both degrade to a single "no site data" instance rather than guessing one.
- **Work archetype (C1)** — the function-group-level classification (transactional / advisory / site-operational) `config/function-archetypes.json` assigns each of the seven function-group buckets, driving both the operating-model pattern recommendation and which functions C2 scans for duplication.
- **External reference band (C3)** — the one place Atlas reads a function against a sector-adjusted external constant rather than the organisation's own median, per `config/back-office-bands.json`; kept in its own module (`lib/analysis/backOfficeBenchmarks.ts`) so it's never mistaken for the self-relative comparison engine's findings.
- **Grade / start date / vacant-since (D3/D2/E2)** — three more optional ingest columns, alongside `site`: `grade` (classification/pay-band, kept apart from the ingest role classifier's own "classification"), `startDate` (tenure), `vacantSince` (vacancy aging). All null on any establishment whose file carries none of them; D1–D3 and E2 degrade to "not computable" rather than guessing.
- **Absolute hold vs. caution flag (E1 vs. E2)** — never conflated. An E1-protected role can never be removed or reassigned by any scenario, full stop; a key-person flag (E2) is visible and can be knowingly overridden. A role carrying both (a sole-incumbent Nurse Unit Manager, say) triages "protect" — the E1 hold already answers "can this move", so the E2 flag's only remaining job is naming what else to do about it (build a bench, redesign carefully).
- **Roster auto-hold (E1)** — a manager tagged `unitRoster` (A2) is automatically protected (`ruleId: "auto-hold-roster-lead"`) regardless of whether their title matches a register rule — enforced at the actual mutation guardrail (`lib/scenario/guardrails.ts`/`moves.ts`), not only in the map's display flags.
- **Control gap (E1)** — a rule in `config/protected-roles.json`'s register with zero matching positions anywhere in the graph. A finding in its own right (`DiagnosticMetrics.controlGaps`), not a null result.
- **Peer cohort (F1)** — the industry/size bucket a peer-band verdict is read against, from `lib/analysis/peerBenchmark.ts`. Atlas has exactly one calibrated cohort (mid-size, 100-2,000 headcount, commercial or public-health); an establishment outside that range still gets a read against the same band, but marked `provisional` rather than presented as calibrated for its size.
- **Denominator-consistency caveat (F1, echoing B4)** — a share metric (management overhead, corporate cost share) is read against non-clinical cost rather than total cost for a public-health organisation, the same base convention `classifyShape`'s own `managerCostShare` uses internally. This isn't cosmetic: it can flip the verdict, not just the wording around it.
- **Archetype (G1)** — one of the 12 named recurring finding-patterns the skill spec lists (excess management depth, key-person exposure, control gap, and so on). Tagged onto every hypothesis in a single enrichment pass (`lib/hypothesis/archetypes.ts`) rather than by each of the ~18 generator functions in `build.ts` individually. A finding matching none of the 12 reads `archetypes: []` — held separately, never forced into the nearest one.
- **No narrative-generation AI surface (G1)** — the skill spec labels causal story / provoking questions / falsifier / data ask as model calls. This build keeps them deterministic and templated per archetype instead, the same choice already made for every other narrative sentence in `build.ts`. Atlas does use a model at several points now (see `lib/ai/client.ts`'s `AiTier` doc comment for the full inventory), but every one of them is a bounded *read* — picking among a small fixed set of already-existing engine calls — never open narrative generation; a template keyed to the archetype and parameterised with the hypothesis's own evidence is grounded by construction, since it never sees a fact outside that evidence to begin with.
- **Reconciliation, no-double-count (G2)** — `lib/scenario/reconcile.ts` prices every scenario play, finds roles two or more plays both claim, and awards each contested role to whichever prices it highest — a stated default tie-break the tool surfaces, not a silent resolution. The losing play's saving *and* that role's transition cost both drop out of its total; leaving the transition cost in after the saving is reassigned elsewhere was a real bug caught while building this (`deep-chain-compression` briefly showed a negative net on a role it no longer owned).
- **Estimate class vs. value type (G2)** — every priced opportunity carries both a `computed` / `estimated` / `requires-data` tag and a `cashable` / `cost-avoidance` / `capacity-release` tag. `capacity-release` reads honestly empty in this build — no play currently produces a genuine freed-capacity figure, and forcing one into that bucket would be exactly the "let the numbers get ahead of the evidence" failure this skill exists to prevent.
- **Named pattern (H1)** — one of the seven fixed redesign-move types (collapse-layer, remove-single-report-chain, widen-span, consolidate-to-shared-service, agency-to-permanent conversion, rebalance-mix, redistribute centre-site). Every typed instruction or applied play is tagged with one where it clearly matches; two — rebalance-mix and redistribute-centre-site — are named by the spec but have no play or move implementing them yet, shown honestly rather than force-mapped onto something close.
- **Management-chain pattern (H1)** — the subset of the seven (collapse-layer, remove-single-report-chain, consolidate-to-shared-service) H1's roster exemption actually applies to. Widen-span is deliberately not one: rebalancing reports between two roster leads is a legitimate roster operation, not a management chain reaching into one. Scoping this correctly was a real bug caught while building it — an unscoped roster exemption blocked `wide-span-redistribution`'s own candidates.
- **Change-set primitive (H1/H2)** — the three-primitive vocabulary (`remove-role`, `move-node`, `collapse-layer`) every named pattern lowers to, from `lib/scenario/patterns.ts`. Atlas's real mutation engine also has two operation kinds the spec doesn't name — `rebase-cost` (agency conversion, in-housing) and `add-role` — kept as their own kind rather than mislabelled into one of the three.
- **Branch, never mutate (H2)** — already structural in this codebase, not a discipline enforced by convention: a scenario's positions live in their own `scenarios.working_graph_json` row, and nothing in `lib/scenario/mutate.ts` ever writes to the baseline `positions` table. Verified directly in `verify-scenario-impact.ts` (the baseline array is byte-identical, by JSON comparison, after every mutation primitive is called against it).
- **Protected roles held (H2)** — checked against the *full* register (`metrics.protectedCount`), never just the roles a scenario happened to touch. "Held" tolerates a protected role's manager changing only when that shift is a side-effect of *its own* manager being delayered — `checkProtected` never blocks that, because it only ever checks the position being removed or reassigned, not its descendants, and treating that shift as "not held" was a real bug caught while building this check.
- **Funded-vacant quick win (H3)** — a vacancy with no incumbent to make redundant, which is why it always leads the phase sequence — not because it's the largest number, but because it's genuinely the lowest-disruption move available. Sourced directly from the `vacancy-rationalisation` play's own candidates, never re-derived from a raw position diff.
- **Headline formula (I1)** — one reconciled number, one judgment sentence, always together. `lib/report/boardPack.ts`'s headline is `reconcileValue`'s own `netStack`, verbatim — the pack never re-rounds or restates it, verified by direct equality against `verify-value-sizing.ts`'s own figure on the same fixture.
- **Thread (I2)** — one hypothesis, ranked and packaged for the consultant briefing: its G1 evidence and questions carried verbatim, a per-archetype anticipated pushback (`lib/hypothesis/pushback.ts`), its data ask reframed as an unlock. Ranked by a fixed rule — `sizing × confidence weight` (high=1, medium=0.6, low=0.3) — never by dollar value alone, so a large low-confidence thread doesn't bury a small high-confidence one.
- **Bounded query (I3)** — Ask Atlas resolves to exactly one of 7 named engine tools or one of H1's 7 named redesign patterns, or says so honestly with the nearest one offered. An instruction is checked before a query, deliberately: an instruction's grammar is more specific, and a query keyword appearing inside an instruction (e.g. "layers" inside "flatten Operations to 4 layers") must not steal the match — a real bug, caught live, fixed by reordering rather than tightening the keyword list.
- **Visible-fallback pattern** — every AI-shaped behaviour (role classification, findings narrative) has a deterministic path and runs on it when `ANTHROPIC_API_KEY` is unset; the UI says which path it took, never silently.

## Module map

| Concern | Path |
|---|---|
| Domain types | `lib/graph/types.ts` |
| Ingest (A1) | `lib/ingest/` — `parseFile.ts`, `columnMapper.ts`, `anonymize.ts`, `classify.ts`, `buildGraph.ts` |
| Layout + tagging, roster/span separation (A2) | `lib/graph/layout.ts`, `lib/graph/tagging.ts`, `lib/graph/spanArchetype.ts`, `lib/graph/hitTest.ts`, `lib/graph/descendants.ts` |
| Cost foundations — on-costs, classification-median estimate (A3) | `lib/cost/onCosts.ts`, `lib/cost/estimate.ts`, `lib/analysis/titleKey.ts`, `config/on-costs.json` |
| Diagnostic engine (shared infra for B1–B5) | `lib/metrics/diagnostics.ts` |
| Spans of control, archetype bands (B1) | `config/span-archetypes.json`, `config/span-thresholds.json` |
| Layers and delayering, peer band (B2) | `config/layer-bands.json` |
| Single-report concentration + exceptions (B3) | `config/succession-titles.json` |
| Organisational shape (B4) | `lib/analysis/shape.ts` |
| Reporting-line hygiene (B5) | `lib/analysis/hygiene.ts`, `config/hygiene-titles.json` |
| Function footprint, operating-model verdict (C1) | `lib/analysis/footprint.ts`, `config/function-archetypes.json` |
| Duplication detection, capture-band pricing (C2) | `lib/analysis/duplication.ts`, `config/consolidation-band.json` |
| Back-office efficiency benchmarks (C3) | `lib/analysis/backOfficeBenchmarks.ts`, `config/back-office-bands.json` |
| Productivity ratios (C4) | `lib/analysis/productivity.ts`, `config/sector-archetypes.json` |
| Vacancy establishment hygiene (D2) | `lib/analysis/vacancyHygiene.ts`, `config/vacancy-hygiene.json` |
| Agency/contingent reliance, peer bands (D1) | `lib/analysis/contingentReliance.ts`, `config/contingent-reliance-bands.json` |
| Workforce mix, classification drift (D3) | `lib/analysis/workforceMix.ts`, `config/seniority-keywords.json`, `config/workforce-mix.json` |
| Protected-role register, roster auto-hold, control gaps (E1) | `config/protected-roles.json`, `lib/protected-roles/match.ts` |
| Key-person risk, triage (E2) | `lib/analysis/keyPersonRisk.ts`, `config/key-person-risk.json` |
| IR/EBA overlay — NES transition cost, consultation, churn budget (E3) | `lib/analysis/irEbaOverlay.ts`, `config/nes-transition-cost.json`, `config/award-coverage.json`, `config/churn-budget.json` |
| Peer benchmarking — layers/spans/overhead/contingent/corporate cost share, in bands (F1) | `lib/analysis/peerBenchmark.ts`, `config/peer-bands.json` (reuses `config/layer-bands.json`, `config/contingent-reliance-bands.json`) |
| Hypothesis enrichment — archetype tagging, confidence grade, questions, falsifier, data ask (G1) | `lib/hypothesis/archetypes.ts`, applied once inside `lib/hypothesis/build.ts`'s `buildHypotheses` |
| Value-sizing reconciliation — no-double-count stack, estimate class, value type, net-at-run-rate (G2) | `lib/scenario/reconcile.ts` (reuses `lib/scenario/plays.ts`'s own candidate lists and `lib/analysis/irEbaOverlay.ts`'s transition cost) |
| Scenario mutation + moves | `lib/scenario/guardrails.ts`, `moves.ts`, `moveParser.ts`, `mutate.ts`, `compare.ts`, `plays.ts` |
| Redesign pattern library — the 7 named patterns, guardrail checklist, primitive lowering (H1) | `lib/scenario/patterns.ts` |
| Scenario impact modeling — structural/financial/governance recompute, phased curve, break-even (H2) | `lib/scenario/impact.ts` |
| Implementation phasing — the fixed default sequence, sign-off gate, sequence-level churn check (H3) | `lib/scenario/phasing.ts` |
| Hypothesis generation + value sizing (G1/G2) | `lib/hypothesis/build.ts`, `lib/hypothesis/archetypes.ts`, `lib/scenario/reconcile.ts`, `lib/analysis/functions.ts` |
| Board pack synthesis — headline, value tiles, protection story, next-steps ladder (I1) | `lib/report/boardPack.ts`, page at `app/org/[orgId]/board-pack` |
| Consultant briefing — ranked threads, pushback per archetype, consultation opener (I2) | `lib/hypothesis/briefing.ts`, `lib/hypothesis/pushback.ts`, page at `app/org/[orgId]/consultant-briefing` |
| Ask Atlas — 7 named query tools + H1's instruction compiler, honest nearest-pattern fallback (I3) | `lib/ask/interpret.ts`, `app/actions/ask.ts`, page at `app/org/[orgId]/ask` |
| Findings synthesis narrative | `lib/findings/generate.ts` |
| AI wrapper (both AI-shaped behaviours) | `lib/ai/client.ts` |
| Database | `db/schema.ts` (Drizzle), `db/client.ts`, `db/repo.ts` |
| Pages | `app/org/[orgId]/{page,map,scenarios,findings,board-pack,consultant-briefing,ask}` |
| Map UI | `components/map/` (`EstablishmentMap.tsx` is the React Flow canvas) |

## Data flow

Upload → `app/actions/ingest.ts` → `lib/ingest/buildGraph.ts` → `db/repo.ts` (`positions`, `ingest_issues`) → baseline is immutable from here.

Map drag or typed move → `lib/scenario/mutate.ts` (`reassignPosition` / `submitScenarioMove`) → guardrails in `lib/scenario/moves.ts` (protected-role check includes the E1 roster auto-hold; `reassign` now also checks H1's post-change span ceiling, reusing `tagNodes`'s own spanHealth/roster-exemption read rather than a second, parallel calculation) → `scenarios.working_graph_json` updated + one `audit_log` row → `revalidatePath` refreshes the map/scenario/findings pages in the same round trip.

Scenario comparison → `lib/scenario/compare.ts`'s `compareScenarios`/`computeDelta` attaches E2's `keyPersonTouched` count by default alongside the existing safe-staffing breach flag. `lib/scenario/impact.ts`'s `computeScenarioImpact` reads the same baseline/scenario pair for H2's fuller structural/financial/governance recompute (phased curve, break-even, protected-roles-held-vs-full-register) — deliberately *not* importing from `compare.ts`, since that module pulls in `db/repo.ts` at module scope and would break every DB-free verify script and analysis module that depends on this one.

`lib/scenario/patterns.ts` (H1) tags whichever play or parsed instruction produced a change with one of the seven named patterns and runs the full guardrail checklist for provenance; `lib/scenario/phasing.ts` (H3) sources its four fixed phases directly from the plays that already implement each step and pulls each phase's incremental contribution from `impact.ts`, never recomputing it.

Findings page → `lib/hypothesis/build.ts` (`buildHypotheses`, which calls `computeMetrics` and passes ingest issues through for B5's orphan count) on whichever positions are current (active scenario if one exists, else baseline) → `lib/findings/generate.ts` for the structural narrative.

F1's own dedicated output — the "How you compare" section — still surfaces as ordinary Findings-page hypotheses (lens `"External reference"`) the same way D1–D3/E1–E3 do, *and* now has a proper home: the board pack's own "How you compare" section reads F1's band verdicts directly, filtered to the ones with a real verdict.

Every hypothesis leaving `buildHypotheses` has already passed through G1's enrichment pass — archetype tags, confidence grade, three questions, a falsifier, a data ask — regardless of which generator produced it.

`lib/scenario/reconcile.ts`'s `reconcileValue` reads `analyseAllPlays`'s own output — same as the Scenarios tab does for its per-play cards — and produces the reconciled, no-double-count headline stack across every priced play at once. Still not surfaced on the Scenarios tab itself; its natural home turned out to be the board pack, which is where it's actually shown.

Board pack (I1, `app/org/[orgId]/board-pack`) → `lib/report/boardPack.ts`'s `buildBoardPack` assembles G2's reconciled stack, G1's top graded hypotheses, F1's band verdicts, E1's protection-story counts and H3's phase ladder into one page — nothing recomputed there that isn't already owned by the skill that produced it.

Consultant briefing (I2, `app/org/[orgId]/consultant-briefing`) → `lib/hypothesis/briefing.ts`'s `buildBriefing` ranks every hypothesis by `sizing × confidence weight`, pairs each with a per-archetype pushback from `lib/hypothesis/pushback.ts`, and carries G1's questions/falsifier/data-ask through verbatim.

Ask Atlas (I3, `app/org/[orgId]/ask`) → `app/actions/ask.ts` loads the current establishment (active scenario if one exists, else baseline) and hands the query to `lib/ask/interpret.ts`'s `interpret`, which checks the instruction grammar first, then the 7 named query tools, then falls back to H1's own `rejectWithNearestPattern` — never a model call, and every figure in the response traces to one named engine function, shown in the response's own tool trace.

## What this build genuinely is, and isn't

All nine modules of the 27-skill spec are implemented — every diagnostic reads real establishment data, every guardrail is enforced at the actual mutation path (not just the UI), and every verify script runs against hand-traced or real-fixture data rather than mocked expectations. That is a real, working slice of Atlas, not a demo shell. It is also, deliberately, not a finished product. The scope cuts below are consistent across every phase, not an afterthought bolted onto this last one:

- **AI is a bounded read, never open narrative generation, by design** — a model is used at several points now (`lib/ai/client.ts`'s `AiTier` doc comment carries the full inventory: ingest-time classification, Ask Atlas's tool selection, an unparsed scenario move's reading, findings narrative), and every one of them either reads free text into a small fixed set of engine calls or writes a narrative tightly grounded in figures already computed. G1's causal stories/questions/falsifiers, I1's judgment sentence, and I2's anticipated pushback stay deterministic templates on top — no model is ever asked to generate that prose. This is a considered architectural line, not a shortcut: a template that only sees the evidence block cannot state a fact the evidence doesn't carry, and a model asked only to *pick* rather than *write* carries the same guarantee.
- **No live cross-client peer-benchmark library** (F1) — the contribution-record function returns exactly what would be transmitted, de-identified by construction, but nothing is actually sent anywhere; Atlas has one calibrated peer cohort, not a compounding library.
- **No board-pack PDF/export** (I1) — the board pack and consultant briefing are real, live pages; turning them into a client-shareable document is a presentation-layer gap, not a computation one.
- **H3's client sign-off is a boolean flag**, not a real approval workflow with a named person and a date — the phase ladder respects it correctly (nothing beyond validation schedules without it), but there's no UI to actually capture a real sign-off yet.
- **Two of H1's seven named patterns have no implementing play** (rebalance-mix, redistribute-centre-site) — named honestly in the pattern library with an empty `sourcePlays` list, rather than force-mapped onto something close.
- **G2's `capacity-release` value type reads empty** — no play in this library currently produces a genuine freed-capacity figure (as opposed to a dollar saving), so the bucket stays honestly at zero rather than forcing a mapping.
- **I3 is deliberately bounded**, not a general chatbot — 7 named query tools plus H1's 7 named instruction patterns, nothing else. A paraphrase the keyword matcher doesn't recognise is a genuine parsing miss, correctly reported as "can't compile," per the skill spec's own instruction.
- **No side-by-side scenario-comparison UI page** (H2) — the comparison data (`highlightBestPerRow`) is real and computed; only the table itself isn't rendered anywhere yet.
