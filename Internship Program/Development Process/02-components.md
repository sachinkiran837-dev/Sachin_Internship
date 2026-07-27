# The Components

*The moving parts of the build capability, what each does, and its state as at 12 July 2026. The process that connects them is `03-process-design.md`.*

---

## Component map

| # | Component | What it does | State | Evidence |
|---|---|---|---|---|
| 1 | Seed (single-file HTML demo) | Wins the room; encodes decisions as a spec that runs | Proven, twice | Category creator v2, Kinyara Phase 0 |
| 2 | `/blueprint` skill | Decomposes a tool's thinking into behaviours, assigns mechanisms, maps content, names the gap | Proven on one run | `.claude/skills/blueprint/SKILL.md` |
| 3 | Architecture decision stage | Deliberates shape: archetype, data store, tenancy, sync, residency | **Missing** | No skill owns it; see S2 |
| 4 | `tractin-starter` template | The production-grade Next.js spine: auth, roles, audit, DB, email, files, degrade-when-unconfigured | Built, unhardened | `github.com/Tract-In/tractin-starter` v0.1.0; nine stall fixes unapplied |
| 5 | `/spinup` skill | Reads a seed, confirms gaps, scaffolds by deletion, brands, generates the domain model, verifies boot | Proven on one run | `.claude/skills/spinup/SKILL.md` |
| 6 | Content library | The knowledge the tools' thinking draws on: playbooks, benchmarks, rubrics, guardrails, personas | **Thin** | `.claude/knowledge/library/` has one playbook, one guardrail |
| 7 | Client brains (context-layer vaults) | Governed knowledge bases that feed agents; built by `/context-layer` | Mature method, two vaults | `oOhComOps_Brain_2.0` (420 notes), `oOhWorks_Brain` |
| 8 | Eval harness (`/qa-brain`) | Certification gate for anything that puts model output in front of a client | Exists, not yet reproducible | `Brain QA/brain-card.md`: certificate withheld |
| 9 | Provisioning kit | `PROVISIONING.md` checklist per build; firm accounts behind it | Works, undifferentiated | See S9; split proposed in `06-tooling.md` |
| 10 | Craft skills | `domain-modeling`, `tdd`, `prototype`, `diagnosing-bugs`, `grill-me` | Present on Toni's machine only | User-level, not in the hub |
| 11 | The feedback loop | Stall lists routed by target (starter / skill / blueprint); improvements ported up | Designed, one cycle pending | Kinyara debrief written, fixes unapplied |

---

## 1. The seed

A self-contained HTML file, no build step, runs from a double-click or a link. Its job is persuasion and decision-forcing: it makes the fuzzy idea concrete enough for a CPO or CFO to poke at, and it embeds the domain's data shapes, vocabulary and brand tokens that the later scaffold lifts out verbatim (Kinyara's seed data was extracted to `db/seed-data.json` for lineage; its brand tokens mapped straight into the app).

Known properties to design for:
- Its numbers are authored for narrative and will not reconcile. Recover and re-derive them before code (the arithmetic-recovery gate).
- Iteration is fast because nothing is factored; the cost is whole-file fork-debt (category creator v1/v2 drift).
- Honesty features (fact-versus-assumption split, machine/human labels) belong in the seed itself, not deferred.
- Keep the real arithmetic live and the judgement authored: credible without a model, buildable in days.

## 2. `/blueprint`

The logic layer. Decompose into single-verb behaviours, assign each one mechanism in preference order (deterministic code, retrieval, LLM call, human-in-the-loop, hybrid; "if you can write the rule, write the rule"), map each behaviour to named content assets marked exists-or-gap, and publish the gap list as the build's headline. Skipped cleanly for tools that only store and display.

Validated moves from the Kinyara run: reverse-engineering the seed's value model (caught two real inconsistencies pre-code) and the human sign-off gate. Known limit: it is deliberately logic-only, which leaves architecture homeless (component 3).

## 3. The architecture decision stage (missing)

The named gap. Questions with no current home: which archetype (see `04-architecture.md`), server or local-first, one database or per-client, tenancy model, sync strategy, offline needs, data residency, model provider and routing. Kinyara churned model providers mid-build; the S4 rebuild spent its hardest thinking exactly here with no skill support. Proposal: a short `/architecture` (or `/shape`) skill producing an ADR per fork, slotted between `/blueprint` and `/spinup`. ADR discipline already exists in the wild (Kinyara ADR 0001, the Sourcing folder's 14 ADRs); this component just gives it a standing slot.

## 4. `tractin-starter`

The superset Next.js 16 template harvested from three delivered production builds: magic-link auth, three-tier roles, audit log, Drizzle plus Postgres, Resend email, R2 files, AI hook, exports, Docker local database, CI. Everything degrades gracefully when unconfigured, so a scaffold runs locally on two env vars.

Its contract is the module manifest: what each optional capability includes and how to remove it. The Kinyara run showed the manifest under-declares coupling (the example domain bled into roughly 14 undeclared files) and that some "optional" capabilities are not deletion-safe (SMS PIN is woven through core auth). The starter is canonical: fixes flow up to it, and every build inherits them. Nine stall fixes are queued and unapplied.

## 5. `/spinup`

Reads the seed and arrives with a filled-in draft (never a blank form), asks only the genuine gaps, resolves to a reproducible `spinup.config.json`, scaffolds by deletion, brands by token swap, generates only the domain model (behind a human confirm-gate), verifies install-typecheck-build-boot, and hands over a runnable repo plus provisioning checklist. One run proven. Known limits: assumes the Next.js archetype (the front-door problem), and its reversible steps (GitHub repo creation, env scaffold, secret generation) are specified but not reliably executed.

## 6. The content library

Where the thinking's raw material lives: `.claude/knowledge/library/` (cross-client playbooks, guardrails, definitions, agent personas) and per-practice libraries such as `procurement-expert/library/` (lever tables, benchmark ranges, scoring rubrics as machine-readable CSVs and JSON). The design intent is one source of truth feeding both deterministic code and LLM grounding.

Current reality: the demos hard-code this knowledge as inline constants while the library holds one playbook and one guardrail. This is the bottleneck on every future `/blueprint` gap list. Full treatment in `05-content-scope.md`.

## 7. Client brains

For knowledge-heavy builds, the content is not a library entry but a governed vault: schema contract, typed edges, provenance on every substantive note, MOC entry surfaces, a query index of the questions agents must answer, and lint tooling that costs no model tokens. Built and maintained by `/context-layer`. The governing test: not how much the vault holds, but which questions an agent can answer from notes alone. A brain is a build input the same way a schema is: the chat layer over it is a thin runtime by comparison (see the oOh! analysis in `01-the-challenge.md` §4.4).

## 8. The eval harness

`/qa-brain`: gold questions authored from the client's own signed determinations, a heterogeneous judge panel, planted-defect checks, test-retest sampling, and a Brain Card verdict with a `certifiable` gate. It has already caught real failures (a hedging fail on the first pilot, a placeholder-glitch citation). Its blocker: run-to-run reproducibility, without which it cannot gate. The standing rule it should enforce once fixed: no model output in front of a client without a passing card.

## 9. The provisioning kit

Per build, a generated `PROVISIONING.md` listing only the steps that project needs, each naming the env var it satisfies and the smoke script that proves it. Behind it, the firm accounts: GitHub org, Vercel, Railway, Neon (proposed), Resend with the verified send domain, Cloudflare R2, Anthropic. The needed split (S9): standing firm primitives documented once; reversible per-project steps automated; only billed, persistent or secret-bearing steps kept on the human checklist. Recommended kit and costs in `06-tooling.md`.

## 10. The craft skills

`domain-modeling` (pin entities and vocabulary before schema), `tdd` (each blueprint behaviour is a test seam), `prototype` (de-risk one uncertain behaviour with a throwaway), `diagnosing-bugs` (the fix loop), `grill-me` (stress-test a plan). These live at user level on one machine, not in the hub repo: a teammate cloning the hub does not get them. Either vendor copies into the hub or record the dependency.

## 11. The feedback loop

The mechanism that makes bespoke work compound: every real build produces a stall list routed by target (S = starter, K = skill, B = blueprint), and the fixes are applied before the next run. One cycle is currently open: the Kinyara list exists and nothing has been applied. The loop only compounds if applying the list is treated as part of the build, not an optional retro.
