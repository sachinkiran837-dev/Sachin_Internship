# The Challenge

*As at 12 July 2026. Sources: the four worked examples, the build skills, and the Kinyara pipeline-test debrief. Companion docs: `02-components.md` through `07-open-challenges.md`.*

---

## 1. The problem in one paragraph

Tract In wins work by solving business problems with working software, fast: a tool the client's own people can touch, correct, and take decisions with, delivered in days or weeks rather than quarters. Some of these builds contain AI API calls (drafting, classification, chat over a knowledge base). Many contain none (deterministic sizing, dashboards, workshop instruments). Every one of them is built with an AI-centric development process: Claude Code working from a seed artefact, house skills, and a starter template. The challenge is getting from idea to POC intelligently, efficiently and effectively, for use cases that differ wildly in shape, and doing it in a way where each bespoke client build makes the next one cheaper, until the good ones become productised capabilities sold to many clients.

## 2. The objective

A development process where:

1. **The commodity layer costs nothing.** Git, hosting, database, auth, email, file storage, API keys: set up once as firm primitives or scaffolded per project in minutes, never re-derived, never blocking.
2. **The thinking layer gets the hours.** Domain model, value logic, the one signature interaction, the content the tool draws on. These are irreducibly per-problem and deserve deliberate human gates.
3. **The hard choices have a home.** Architecture decisions (archetype, data store, tenancy, sync, residency, model routing) are surfaced and recorded, not silently defaulted.
4. **Every build hardens the next.** Stall lists route fixes back to the starter and the skills; every project leaves a content asset behind; the third repetition of a shape triggers productisation.
5. **AI-bearing builds ship behind a gate.** Anything that puts model output in front of a client passes a reproducible eval before it goes live.

## 3. The central tension, and what the evidence says about it

The stated tension: getting the mix right between *"just set up the things we will need anyway"* and *"help me think through the right architecture and the difficult choices for each individual problem."*

The Kinyara run (the only full pipeline test to date) resolves this more precisely than a 50/50 split. Its debrief shows the infrastructure came close to free: auth, three-tier roles, audit trail, database, email degradation all arrived from the starter and mapped cleanly onto intent. What consumed the real hours was never the primitives. It was three things that resist commoditisation:

- **Removing what the template assumed.** The starter's example domain bled into roughly 14 files beyond what its own manifest declared (`Kinyara-Pipeline-Test-Debrief.md`, stall item 1).
- **The domain UI.** The visual swimlane map (495 lines) and the value-effort matrix needed a component vocabulary the starter does not ship.
- **The AI behaviour.** The starter's generic AI stub was deleted wholesale and replaced with a bespoke drafting subsystem (schema contract, prompt, guards, text extraction). For AI behaviours the reusable primitive is close to worthless; the real work is per-tool.

So the true split is: **infrastructure commoditises; domain modelling, domain UI, domain AI, and domain content do not.** The process design consequence: standardise the primitives without apology (see `06-tooling.md`), and give the per-problem thinking explicit, gated stages (see `03-process-design.md`). The current skills get the first half mostly right and leave the second half partially homeless: `/blueprint` owns the logic, but nothing owns architecture (see structural challenge S2 below).

## 4. What each worked example teaches

### 4.1 Kinyara process discovery (the pipeline, proven)

A live workshop instrument for an accounts payable program: the client's own team corrects a process map, tags dispositions, and sizes the prize from visible assumptions. Built via the full chain: seed HTML, `/blueprint`, `/spinup` scaffold from `tractin-starter`, domain-model gate, test-first value model, verified boot.

**What paid off:**
- The blueprint recovering the arithmetic from the seed before any code existed. It caught that the demo's numbers did not reconcile: step waits summed to 15 days against a stated 9-day cycle, and six opportunities summed to $1.24M against a $1.08M pool. Acceptable in a narrated demo; fatal in a live tool a detail-oriented CFO will reconcile on screen. This became ADR 0001 and the test fixtures.
- Both human confirm-gates (blueprint sign-off, entity confirmation) fired exactly where a wrong call would compound: the model shape and the core computation.
- The value model was pinned test-first to the figures the client had already been shown, so the live tool cannot contradict the paper the CFO saw. 19 tests green.

**What stalled (the full nine-item stall list lives in the debrief):** example-domain bleed, an "optional" SMS capability that was not actually removable, wrong migration guidance, no test runner in the starter, brand strings outside the documented seams, a first-run sign-in experience that read as broken. None of these fixes has been applied back to the starter yet; the starter is still a single v0.1.0 commit. The stall list was the point of the test, and its value evaporates unapplied.

**The deeper lesson:** the pipeline reliably produces something that compiles and boots. The difference between "runs" and "lands with a real user" is the first-run experience and the one interaction the tool exists for (live assumption editing, still stubbed as at 12 July). That last mile is never free and never automatic.

### 4.2 P3 workforce cost (the pipeline, bypassed)

A workforce overtime-cost command centre for an aged-care provider: nine screens, a real metrics engine, a real coverage-cascade simulator, an AI advisor with deterministic fallbacks. Generated in a single roughly four-hour sitting on 13 June 2026, from scratch, not from the starter.

**What it proves:** a one-shot AI generation nails the thinking layer (strain index, simulator with interaction effects, structured grounding for the model) and deliberately stubs the plumbing (password hard-coded to "executive", localStorage persistence, no git, no deploy target). For a presenter-driven laptop demo, that trade is right.

**What it costs:** every safety rail the pipeline supplies was forfeited. No version control at all (the README endorses this). Built and run directly on OneDrive with 86 MB of node_modules syncing to the cloud, the exact failure the house rule exists to prevent. A `.env` file sits in a cloud-synced folder waiting for a key to be pasted into it. An unauthenticated model proxy that would burn the API key if ever hosted. Roughly a week of hardening separates it from a hosted, authenticated, multi-user POC, and all of that week is plumbing the pipeline would have provided.

**Two patterns worth lifting into the house standard:** (a) AI-optional design, where every model behaviour has a deterministic fallback computed from the same metrics, so a demo never dies mid-pitch (with the caveat that silent degradation must be visible to the presenter); (b) grounding the model only on pre-computed, structured metrics, never raw rows, which is what lets a numbers-heavy tool survive CFO scrutiny.

**The decision that was never taken:** whether P3 was a laptop demo or a future product. It was scoped as the former by accident of process, not by an explicit call. Which of the two a build is must be decided *before* generation, because it determines whether bypassing the pipeline is a sound shortcut or a debt.

### 4.3 Category strategy creator (the seed pattern, at its ceiling)

A 2,269-line self-contained HTML file: three fictional industry archetypes, a six-view procurement workspace, a Kraljic matrix, 15 hero categories worked to board-brief depth. No build step, no server, no persistence; runs from a double-click. Behind it sits a genuinely rich context corpus (specs, lever libraries, scoring rubrics, 14 ADRs) and a three-tier commercial model in which this file is tier 1, the showroom.

**What the pattern is for:** the seed is a spec that runs. It forced decisions (benefit-type split, influenceable-spend haircut, view order, IP scrubbing) into an artefact a CPO can poke at, resolving arguments a slide deck would have left open. The v1-to-v2 iteration was critique-driven and took two days precisely because there is no schema, no build, no deploy.

**Where the ceiling is:**
- **The intelligence is authored, only the arithmetic is live.** The weighted-scoring engine genuinely computes, but a human chose every input score; the play badge the spec said would be derived is hand-set in the seed data. The demo proves what the output looks like; it proves nothing about whether a model can produce it from messy real data.
- **The two hardest engineering problems are exactly what it stubs:** ingesting a real spend cube (roughly 286k dirty ERP rows per the input-data contract) and live grounded generation.
- **Fork-debt is immediate.** v2 is a whole-file copy of v1 and the two now drift; the roadmap already flags extracting the shared shell before tools 2 and 3 fork it further.
- **The seed outran its knowledge base.** Lever bands, factor weights and benchmarks are hard-coded as inline JS constants, while the reusable library they should come from is thinner than the demo implies. The product path requires one source of truth feeding both the deterministic code and the LLM.

**The transferable move:** honesty as a designed feature. The fact-versus-assumption split and the "machine does this / human does this" engine-room labels are what make a fictional demo showable to a real CFO. Build that into the seed, not into the eventual POC.

### 4.4 oOh! Brain (the content-heavy product, awaiting its runtime)

A governed knowledge vault (420 curated notes, typed edges, provenance rules, entry surfaces for agents) with the ambition of a deployed chat layer whose agents read the vault and live NetSuite data. Today: agent personas exist (in the handed-over vault), a QA harness exists, a demo "Ask the Brain" surface exists with deliberately no live model (keyword match over precomputed, human-verified answers), and NetSuite data flows in as manual Excel exports through a DuckDB warehouse.

**What it teaches:**
- **Content-heavy AI products are two pipelines, not one.** The content build (vault schema, provenance, curation, lint) took as much engineering as any app, and it is the long pole. An app scaffold over an ungoverned vault inherits every contradiction the vault carries.
- **"No live model" is a legitimate, shippable POC stage.** Precomputed, cited, human-verified answers de-risked the client room; the agent specs were written so they become the prompts when the model is switched on. Proving the content and the UX decouples cleanly from turning on the model.
- **The eval gate must be reproducible before it can gate.** Certification was withheld because two runs on the same vault and gold set returned opposite verdicts. An eval that flips is worse than none; it manufactures false confidence.
- **Curated truth and live numbers need an explicit contract.** The grounding rules already encode it: the vault for context, the export for any dollar, recompute rather than parrot, grade every fact's confidence, and a card inherits its weakest fact. Any chat-over-vault product must enforce this boundary or it will present a hedged determination and a stale ERP figure as equally solid.
- **Firm IP and client IP must physically separate before handover**, and the vault-on-OneDrive versus runtime-on-local split needs a designed sync path, not an assumption.

## 5. Structural challenges (beyond any single example)

These are the inferred, recurring problems. Each is expanded with options in `07-open-challenges.md`.

- **S1. No archetype front door.** The wild population spans single-file HTML, Vite SPA with a thin proxy, full Next.js app, Next.js plus Python two-service, content-as-JSON PWA, and chat-over-vault. The pipeline silently assumes one of them (the heavyweight Next.js starter). Nothing asks "what shape is this build?" before scaffolding begins.
- **S2. Architecture decisions are homeless.** `/blueprint` decides logic mechanisms; `/spinup` records infrastructure toggles. Neither deliberates tenancy, data store, sync, local-first versus server, offline, residency, or model routing. The S4 rebuild and Kinyara both hit these questions with no skill to hold them.
- **S3. Demo-integrity debt.** Seeds are persuasion artefacts; their numbers are authored for narrative, not reconciliation. Every seed-to-tool transition needs a mandatory arithmetic-recovery gate (proven at Kinyara) or the fakes ship as truth.
- **S4. The stub ledger.** One-shot builds fake the plumbing, and the fakes are only discoverable by reading the code (P3's login, persistence, deploy). "What did we fake?" must be a written output of every build, not archaeology.
- **S5. The content library lags the demos.** The demos look more grounded than the library behind them is. The differentiated layer, the thinking, is currently the thinnest layer, and `/blueprint` will keep naming gaps that cannot be filled until it grows.
- **S6. Bespoke-to-productised is unencoded.** The end goal of the business model has no artefact: no tenancy pattern, no config-extraction routine, no white-label recipe beyond a token swap, no trigger that says "this shape has repeated, extract it."
- **S7. Workspace discipline.** OneDrive is an authoring and deliverable surface; runtimes and repos live local with git as source of truth. P3 inverted this and got away with it once, which teaches the wrong lesson.
- **S8. The paper trail decays within a day.** Kinyara's config, provisioning doc and debrief already describe a state the code has passed; a day of work sits uncommitted past the tag. POCs that keep moving need a state-as-of convention and a commit discipline.
- **S9. Provisioning conflates two different things.** Firm-level primitives (accounts, verified domains, the org) should be treated as standing facts. Per-project reversible steps (repo creation, env scaffold, secret generation) are safe to automate. Only billed, persistent, secret-bearing steps belong on a human checklist. Today all three are one undifferentiated list.
- **S10. AI releases lack a standing gate.** The eval harness exists and has already caught real failures, but it is not yet reproducible, and nothing makes "pass the eval" a precondition of putting model output in front of a client.

## 6. What is already right (resist relitigating)

- **Checklist over auto-provisioning for anything billed, persistent or secret-bearing.** A leaked key has already happened once in the repo history; nothing irreversible should be executed by a scaffold.
- **Scaffold-by-deletion over code generation** for the app spine. Deleting proven modules keeps builds production-grade; fresh generation reintroduces solved bugs. (Its limit: capabilities entangled with core auth need additive plugin seams instead, see `04-architecture.md`.)
- **The blueprint's confirm-gates.** Cheap thinking in markdown before expensive code, signed off by a human, earned its keep on the first real run.
- **Railway is not redundant with Vercel.** They host different things; the question is narrower (see `06-tooling.md`).
