# The Content Scope

*What the tools' thinking draws on, what exists, what is thin, and the rules that keep it compounding. As at 12 July 2026.*

---

## 1. The thesis

The differentiated layer of any Tract In build is not its auth or its database; the starter ships those and every competitor's AI can generate them. The differentiated layer is the thinking, and the thinking is only as good as the content behind it: the playbooks, benchmarks, rubrics, guardrails and curated client knowledge that ground what the tool computes and what the model says. Code without this layer produces a tool that hallucinates its domain expertise; the demos to date have papered over the gap by hand-authoring the judgement.

## 2. What exists today

| Layer | Where | State |
|---|---|---|
| Cross-client library | `.claude/knowledge/library/` | **Thin.** One playbook (accounts payable / P2P), one guardrail set (consulting tools), empty `agents/` and `definitions/` |
| Procurement practice library | `.claude/skills/procurement-expert/library/` | Machine-readable and real (lever tables, category benchmark ranges, capture skills, scoring rubrics as CSV/JSON), but its README is stale and understates what exists |
| Sourcing context corpus | `02. Marketing and Propositions/Productised solutions/2. Procurement/Sourcing/context/` | **Rich.** Specs, lever library, scoring rubrics, strategy anatomy, worked example, benchmark library, 14 ADRs. Human-readable IP the demo was built from |
| Client brains | `01. Clients/oOh! Media/oOhComOps_Brain_2.0` (420 curated notes) and `oOhWorks_Brain` (~628 notes, handed over) | **Mature method.** Schema contract, typed edges, provenance, MOC entry surfaces, query index, lint tooling, self-audit |
| Agent personas | `oOhWorks_Brain/agent-use-cases/` (11 to 12 personas) | Exist for one client; written so they become system prompts. No cross-client generalisation yet |
| Gold eval sets | `01. Clients/oOh! Media/Brain QA/` (26 gold items, mutation battery, scorecard) | Exist for one client; the authoring method (gold from the client's own signed determinations) is reusable |

## 3. The gap pattern: seeds outrun the library

The recurring failure shape, seen most clearly in the category strategy creator: the demo hard-codes library knowledge as inline constants (lever bands, factor weights, addressability haircuts, play definitions), so the demo *looks* deeply grounded while the reusable library behind it holds a fraction of that knowledge in retrievable form. Three consequences:

1. **Duplication drift.** The same lever band now lives in a 2,269-line HTML file and (partially) in a CSV. Updating one does not update the other.
2. **The product path is blocked.** A capability sold to many clients needs the knowledge served from one source of truth to both the deterministic code and the model. Migrating constants out of a shipped demo is rework that grows with every fork.
3. **`/blueprint` gap lists cannot close.** The blueprint method maps every retrieval and LLM behaviour to named content assets marked exists-or-gap. With a thin library, every blueprint names the same gaps and every build re-authors them.

The rule that follows: **when a seed embeds domain knowledge, the same knowledge lands in the library as part of that build**, not later. The seed is allowed to inline a copy for zero-infrastructure reasons; the library copy is the master.

## 4. Content types and who consumes them

| Asset type | What it grounds | Consumed by | Example |
|---|---|---|---|
| Playbook | How a process or category actually works; the levers and their preconditions | LLM behaviours (retrieval), human facilitation | `playbooks/accounts-payable-p2p.md` |
| Benchmark / range table | Sizing and calibration; what good looks like | Deterministic code AND the model | `category-house-ranges.csv` |
| Scoring rubric | Weighted factors behind a judgement | Deterministic scoring fed by authored or model-proposed inputs | `scoring-rubrics.json` |
| Guardrail set | What generated output must never do | Every client-facing LLM behaviour | `guardrails/consulting-tools.md` |
| Definitions / glossary | The domain's vocabulary, pinned | Everyone; per-repo as `CONTEXT.md` | Kinyara dispositions |
| Agent persona | Who the agent is, what it reads, how it cites | Chat layers; becomes the system prompt | `agent-use-cases/ops-expert.md` |
| Gold eval set | What a correct answer looks like, from signed sources | The certification gate | `Brain QA/eval-set.yaml` |
| Client brain | Everything known about one client's operation, governed | Client-specific agents and tools | `oOhComOps_Brain_2.0` |

## 5. Brains: content as the long pole

For knowledge-heavy builds the content layer is not a library entry but the bulk of the build (see `03-process-design.md`, two-pipelines section). The method is mature and worth restating as scope:

- **A schema contract**, not a pile of notes: required frontmatter, provenance never empty, a closed vocabulary of typed relationships.
- **Entry surfaces designed for agents**: a plain-English on-ramp, tiered maps of content, routing spines, and a query index of the canonical questions with the note where each answer starts.
- **Authority signalling**: signed determinations quarantined and dated, proposals tagged as not-yet-agreed, anecdotal figures explicitly flagged (the standing rule: frame non-canonical client figures around the structural need, never the number).
- **Lint before model**: structural checks that cost zero tokens catch the contradictions cheaply (the ComOps self-audit found the entry surfaces contradicting the notes on the single most-asked question).
- **The governing test**: which questions an agent can answer from notes alone.

## 6. Rules that keep the layer compounding

1. **Every build leaves an asset behind.** A hard exit criterion of stage 12 (harvest): at least one playbook, rubric, benchmark table, guardrail or persona lands in the library from every project. This is the flywheel that turns bespoke work into product margin.
2. **One master, many copies.** Library assets are the master; demos and tools may inline copies with the origin recorded. Never edit the copy.
3. **IP hygiene is a release check, not a hope.** Two live obligations: no named-consultancy IP on anything public-tier (the Sourcing ADR already mandates this, and the scrub must cover identifiers and comments in source, not just the screen; an open flag exists on prior-firm names having leaked into the library), and firm IP physically separated from client-deliverable folders before any handover (the brain handover already practised this).
4. **Confidentiality boundaries hold inside the content layer.** Client brains and client data assets never cross-reference commercially sensitive detail between clients. Cross-client learning flows through the anonymised, generalised library, in method form, not in figures.
5. **Machine-readable beats prose where code consumes it.** Benchmarks and rubrics live as CSV/JSON with a schema; playbooks and personas live as markdown. The stale-README failure (a library README claiming its own files do not exist) is what happens when the index is maintained by hand; prefer generated indexes where cheap.
6. **Gold sets are authored from signed sources only.** The client's own determinations, decision registers and published figures; never from what the model finds plausible. This is what makes certification defensible in front of the client.
