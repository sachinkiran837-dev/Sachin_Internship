# Atlas — PRD Chunks

*As at 23 July 2026. Source: `Atlas: Product Requirements and Agent Capability Blueprint`, draft v0.1, 21 July 2026 (Owner: Toni Auburger). Companion docs: the owned-slice plan and the skill specs in this folder.*

---

## 1. What are the main workstreams / chunks?

The PRD frames the five Must-have capabilities as **one pipeline**, not five separate features — the org graph built at ingest is the single shared object every later stage reads or mutates (PRD Section 5, "Design principle"). Splitting them into disconnected workstreams risks the numbers drifting once the client starts checking them.

**The spine (Must, ship in v1):**

| # | Chunk | What it delivers | Pipeline stage |
|---|---|---|---|
| C1 | Ingest and comprehend | Parse the establishment export, build the org graph, classify roles from an operating-model lens | Upload |
| C2 | Interrogate and QA the data | Consultant and Atlas jointly test, correct and trust the dataset | Validate |
| C3 | Operating-model analysis engine | Spans, layers, cost, structural metrics, plain-language read | Diagnostic |
| C4 | Interactive establishment map | Visualise, explore and edit the org chart; protected roles held | Establishment map |
| C5 | Scenario and cost modelling | Model a redesign move, see headcount/cost/structural impact | Redesign |

**The ceiling (Should / Could, layered on top once the spine holds):**

| # | Chunk | What it delivers | Priority |
|---|---|---|---|
| N1 | Insight and recommendation engine | Atlas proposes where the opportunity sits; powers Ask Atlas | Should |
| N2 | Board pack and export | One-click branded client output | Should |
| N3 | Benchmarking store | Compare a client against a peer band | Could |

**Cross-cutting (built in from day one per PRD Section 8, not bolted on later):** data residency (AWS Sydney), anonymise-on-ingest, tenant isolation, reproducibility and audit, protected controls, visible assumptions, human-in-the-loop, model and prompt versioning.

**The governing rule that shapes every chunk:** the model reads, classifies and explains; deterministic code counts, costs and compares. The model never produces a number that ends up in front of a client.

## 2. What should we build vs. not build (yet), based on repeatability and time?

**Build now** — repeatable, deterministic, provable against a real dataset fast:

- **Phase 0, walking skeleton.** Upload a real export, build the graph, render a static org chart. Proves the spine connects (C1 to C4). Fastest thing to demo, and every later phase depends on it existing.
- **Phase 1, diagnostic.** Deterministic spans, layers and cost on the real graph (C3). High repeatability — same input always gives the same output — and this is the number set a client will scrutinise first, so it earns reproducibility work early.

These two together are the highest-leverage, lowest-ambiguity slice: mostly deterministic code, no open model-boundary questions, and directly reusable across any client export.

**Build soon**, once the spine is solid:

- **Phase 2, QA loop.** C2 — validation, low-confidence confirmation, corrections. Needed before any output is trustworthy enough to show a client, but depends on C1 existing first.
- **Phase 3, redesign.** C5 — scenario moves, cost and structural delta. "Where the product pays for itself," but it is stateful (working-copy graph) and carries real open questions (full set of move types, transition-cost assumption ownership) that need a decision before it is worth building deeply.

**Don't build yet** — explicitly parked or lower priority:

- **N1, insight and recommendation engine.** Should, not Must. The PRD is explicit that building recommendations before the floor (C1 to C5) is solid risks "the model proposing moves the numbers cannot back." Low repeatability right now because it depends on C3 and C5 being trustworthy first.
- **N2, board pack and export.** Should. Blocked on brand system and export format being agreed; templating work is easy but should not be built against a moving target.
- **N3, benchmarking store.** Could. C3 works without it, and it only grows in value as more client datasets accumulate, so it is a poor use of time this week.
- **Out of scope entirely** (PRD Section 11, parking lot): client-facing self-service portal, live HR-system integration, implementation tracking post-redesign, anything that writes back into a client's systems.

**Time-boxed judgment for this week:** favour chunks that are mostly deterministic (cheapest to build correctly, hardest to get wrong in front of a client) and reusable across any client export rather than Kinyara-specific. That points at C1 and C3 as the best use of limited time before review, with C4 as a strong second choice since a working demo needs something visible.

## 3. Open questions still blocking full scoping

From PRD Section 10, the decision list the team should close or assign owners to:

1. Rebuild or evolve the existing single-file Atlas build — what is the production shape (front end, backend, data store, model gateway)?
2. The canonical position record and its mandatory fields; which source systems are supported first?
3. Where fully-loaded cost figures come from, and who owns the default assumptions.
4. Confirm the LLM boundary rule: the model never produces a client-facing number.
5. How much QA is automated versus left to the Project Partner; hard-block or warn on critical data issues?
6. Confirm AWS Sydney and the tenant-isolation approach.
7. Auth and roles — consultant-only for now, or any client-facing view?
8. Seed the benchmark store, or accumulate it from live projects?
9. Board pack format and brand system.
