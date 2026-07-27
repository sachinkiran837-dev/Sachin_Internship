# The Process Design

*The idea-to-POC pipeline stage by stage: what is proven, guided, manual, or missing, as at 12 July 2026. Component detail lives in `02-components.md`; the open decisions in `07-open-challenges.md`.*

---

## The pipeline at a glance

```
IDEA + client context
  |
  |  [0] SEED           build the single-file HTML demo            PROVEN
  |  [1] SCOPE THE BUILD demo-only, or destined for a POC?         MISSING (decide explicitly)
  |  [2] ARCHETYPE      what shape is this build?                  MISSING (front door)
  |  [3] /blueprint     behaviours, mechanisms, content map, gap   PROVEN (skip if no thinking)
  |       - arithmetic-recovery gate on the seed's numbers         PROVEN, make mandatory
  |       - human sign-off gate                                    PROVEN
  |  [4] ARCHITECTURE   ADRs on the hard forks                     MISSING (homeless today)
  |  [5] /spinup        read seed, confirm, scaffold, brand,       PROVEN (Next.js archetype only)
  |       model, verify boot
  |       - domain-model confirm gate (domain-modeling)            PROVEN
  |  [6] BUILD          behaviours test-first (tdd), grounded      PROVEN for deterministic;
  |       in the content library                                   per-tool for AI behaviours
  |  [7] LAST MILE      first-run experience + the signature       UNDER-SERVED, budget it
  |       interaction
  |  [8] PROVISION      firm primitives assumed; reversible        MANUAL, split needed
  |       steps automated; billed/secret steps checklisted
  |  [9] DEPLOY         Vercel project, client subdomain,          MANUAL
  |       access gate, Sydney pinning
  | [10] EVAL GATE      /qa-brain style certification for any      EXISTS, NOT YET RELIABLE
  |       client-facing model output
  | [11] HAND OVER      stub ledger + state-as-of + teardown note  PARTIAL (PROVISIONING.md only)
  | [12] HARVEST        stall list routed S/K/B, fixes applied;    DESIGNED, LOOP OPEN
  |       content asset left behind
  | [13] PRODUCTISE     triggered on the third repetition of       MISSING
        a shape
```

Stages 0 and 3 to 6 are the proven core (the Kinyara run exercised all of them once). Stages 1, 2, 4 and 13 do not exist yet. Stages 7 to 12 exist in pieces and need discipline more than tooling.

---

## Stage notes

### [0] Seed
The demo is a deliverable in its own right (it wins the yes) and the spec for what follows. Design it knowing what the scaffold will lift from it: embedded data becomes the seed dataset, brand tokens become the theme, form fields and tables become schema candidates. Put the honesty features in now.

Integrity rules for any client-facing demo, whether or not a build ever follows (settled 12 July 2026): client-specific figures must derive from named, visible assumptions, because the audience will reconcile them against their own reality; fictional-archetype data needs internal consistency and honest labelling, not derivation. Both get an arithmetic-reconciliation pass at authoring time: sums add, derived figures actually derive.

### [1] Scope the build (new, cheap, high value)
One explicit question before anything is generated: **is this a laptop demo or a POC candidate?** P3 shows what happens when the question is skipped: a build scoped as a demo by default, later wanted as more, with a week of forfeited plumbing to recover. A demo may bypass the pipeline deliberately; a POC candidate may not. Record the answer in the build's README.

### [2] Archetype (new front door)
Name the shape before scaffolding: single-file HTML, Vite SPA with a thin API proxy, full Next.js app, Next.js plus Python two-service, content-as-JSON PWA, or chat-over-vault. The catalogue with selection signals is in `04-architecture.md`. Until more archetypes are built, the honest behaviour is to name the shape, record it in `spinup.config.json`, and refuse gracefully when the Next.js starter is the wrong base, rather than forcing everything through it.

### [3] /blueprint
Run when the tool must think (ingest, classify, judge, size, recommend, generate, answer); skip when it only stores and displays. Two moves are now standing policy:
- **Recover the arithmetic from the seed.** Re-derive every headline figure from named assumptions; the discrepancies you find are ADR material, and the derivation becomes the test fixtures.
- **Human sign-off before code.** The blueprint is the cheapest medium in which to be wrong.

### [4] Architecture ADRs (new)
For the forks the blueprint does not own: data store, tenancy, sync, local-first versus server, offline, residency, model provider and routing. One short ADR per fork, in the repo's `docs/adr/`. The trigger for writing one: any question where reversing the call later means rework across files. Kinyara's provider churn (Gateway to OpenRouter mid-build, config now stale against code) is what an unrecorded fork looks like.

### [5] /spinup
As designed in the skill: read, confirm only the gaps, resolve to config, scaffold by deletion, brand as data, generate the domain model behind the confirm gate, verify install-typecheck-build-boot on the local Docker database. A spin-up that does not boot is not handed over. Known frictions queued as stall fixes: the example-domain bleed, the SMS PIN non-seam, the migration guidance for full domain swaps (wipe and regenerate headless works), the missing test runner, brand strings outside the seams.

### [6] Build the behaviours
Test-first at the blueprint's seams; each behaviour is a tdd seam. Deterministic behaviours are fast and should be built first (they also pin the numbers the client has seen). AI behaviours are per-tool work: expect to write the schema contract, prompt, guards and extraction plumbing fresh, grounded in the content library, and expect the starter's generic AI stub to be replaced rather than adapted.

### [7] The last mile (budget it explicitly)
Two things decide whether the tool lands, and the scaffold covers neither:
- **First-run experience.** A magic link that prints to a server console reads as "sign-in is broken" to a real user. Every capability that degrades gracefully needs its degraded state to advertise itself.
- **The signature interaction.** The one moment the tool exists for (Kinyara: watching the sizing move as the room edits an assumption). It is always domain work, never scaffolded, and naming it is now a required blueprint field (settled 12 July 2026); the handover stub ledger must declare it built or stubbed.

The lands-with-a-real-user checklist, run before handover: sign-in works without explanation; the signature interaction works; empty states look intentional; degraded modes are labelled; one non-builder has clicked through it.

### [8] Provision
Three tiers, treated differently:
- **Firm primitives** (accounts, org, verified send domain): standing facts, documented once, never a per-project step.
- **Reversible, non-secret steps** (GitHub repo from template, git init, `.env.local` from the example, `AUTH_SECRET` generation, a super-admin PIN for first sign-in): automate inside `/spinup`.
- **Billed, persistent, secret-bearing steps** (database instance, storage bucket and CORS, API keys, host env vars): human checklist, one smoke script each. Never auto-executed. This is deliberate and stays.

### [9] Deploy
Per-client pattern: own Vercel project, `client.tractin.com` subdomain, deployment gated (platform authentication for the team, app-level login for client users), everything pinned to Sydney for AU-sensitive data. Details and the client-questions crib in `06-tooling.md`.

### [10] Eval gate (AI-bearing builds only)
Nothing that puts model output in front of a client ships without a passing certification run: gold set from the client's own signed determinations, judge panel, planted defects, and a reproducible verdict. The harness exists; its reproducibility blocker must clear before it can hold this line. Until then, the honest fallback is the oOh! pattern: precomputed, human-verified answers with the live model off.

### [11] Hand over
Three artefacts beyond the repo:
- **The stub ledger:** what was faked or stubbed, in one list (auth, persistence, exports, logos, the blueprint's remaining gaps). PROVISIONING.md covers the infrastructure half today; the ledger covers all of it.
- **State-as-of:** every status document carries the date and the commit it describes. A tag that no longer matches the tree is worse than no tag.
- **The teardown note** for client-facing POCs: where the data lives, who can see it, and what gets deleted when, confirmed in writing.

### [12] Harvest
The stall list, routed by target (starter, skill, blueprint), plus one content asset left behind in the library. Applying the fixes is part of the build. The measure of the whole process is whether run N+1 is measurably cheaper than run N; an unapplied stall list is the loop broken at its last link.

Enforcement (settled 12 July 2026): fix work spawns as a parallel-chat handoff during the debrief itself, while context is hot; unapplied items land in the starter's `STALL-LEDGER.md`, and `/spinup` warns loudly before scaffolding from a starter with open ledger items. The debrief template requires the line "Asset left behind: path, or an explicit none-because"; a debrief without it is incomplete. Every generated status artefact opens with "state as of date, commit sha"; commits happen at every green gate; no session ends with an uncommitted tree.

### [13] Productise (trigger, not stage)
When a shape repeats a third time: extract the shared shell, move hard-coded knowledge into the library, make the client-specifics config, decide tenancy. The category-creator roadmap already schedules exactly this (extract the shell before tools 2 and 3 fork it). Until the trigger fires, resist productising speculatively.

---

## Special case: content-heavy builds run two pipelines

A chat-over-knowledge product is a content pipeline and an app pipeline, and the content one is the long pole:

```
CONTENT: documents -> /context-layer vault (schema, provenance, typed edges)
         -> lint (brain-probe) -> /qa-brain certification -> the Brain
APP:     seed -> blueprint -> architecture -> spinup -> chat runtime
         (retrieval binding, citation enforcement, personas as prompts)
```

The two meet at the eval gate: the app does not go live over an uncertified vault. The staged de-risking pattern is proven: ship the UX over precomputed, cited, human-verified answers first; switch the model on only when the specs (already written as prompts) and the certification allow it.

---

## Gate summary

Human gates sit exactly where a wrong call compounds, and nowhere else:

| Gate | Question it answers | Cost of a wrong call |
|---|---|---|
| Scope (stage 1) | Demo or POC candidate? | A week of forfeited plumbing, or wasted rails |
| Blueprint sign-off (stage 3) | Is the logic right? | Building the wrong behaviours |
| Arithmetic recovery (stage 3) | Do the seed's numbers survive derivation? | A CFO reconciling fakes on screen |
| Architecture ADRs (stage 4) | Which way on the irreversible forks? | Cross-file rework, stale configs |
| Domain model confirm (stage 5) | Are the entities and fields right? | The most expensive thing to unwind |
| Eval certification (stage 10) | Can this model output face a client? | A hallucinated determination in the client's hands |
