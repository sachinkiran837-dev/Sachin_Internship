# Open Challenges (Grilling Material)

*The problems that need decisions or work, each framed to be attacked in a grilling session (`/grill-me`) or a `/council` run. Numbered for reference. As at 12 July 2026.*

> **Status update, 12 July 2026 (evening):** the decision queue was grilled and resolved the same day; a second session then resolved every remaining challenge. All 22 settled calls are recorded in `wiki/decisions/development-process-standards.md`, including two deliberate departures from the tabled recommendations (E3: the grounding contract stays a pattern in the s4-demo for now; F5: solo for three more builds before any second-builder transfer). This file is retained as the reasoning record behind those calls; nothing in it is open as at 12 July 2026.

---

## A. Process gaps

**A1. The archetype front door does not exist.**
Six build shapes in the wild, one supported by the pipeline, nothing that asks "what shape is this?" before scaffolding.
*Grill:* Is a front door a new micro-skill, a first question inside `/spinup`, or just a table in the architecture doc that a human consults? What is the honest behaviour when the answer is an archetype the pipeline cannot build yet: refuse, hand-craft, or force the starter anyway? Which second archetype earns building first, given P3-shaped pitch tools recur (Vite SPA) and the chat-over-vault runtime is a named ambition?

**A2. Architecture decisions have no home.**
`/blueprint` is logic-only; `/spinup` records toggles without deliberating them. Tenancy, sync, residency, data store and model routing get decided implicitly, mid-build, or not at all.
*Grill:* Is the fix a new `/architecture` skill (one more pipeline stage, more ceremony) or a mandatory ADR checklist inside the existing gates (lighter, easier to skip)? Which forks are mandatory ADRs versus noted defaults? Who signs an ADR when Toni is both builder and reviewer?

**A3. The scope question (demo or POC candidate) is never asked.**
P3 was scoped as a laptop demo by default, not by decision, and the week of forfeited plumbing was discovered later.
*Grill:* Where does the question live so it cannot be skipped: the seed stage, `/kickoff`, or the first `/spinup` prompt? Is a two-tier answer enough (demo / POC candidate), or does productisation ambition belong in the same question?

**A4. The feedback loop is open at its last link.**
The Kinyara stall list exists, is routed by target, and none of its nine fixes has been applied. The starter is still one commit old.
*Grill:* Why did the loop stall: time, or no forcing function? Should "stall fixes applied" be an entry condition for the *next* spin-up (hard, self-enforcing) or a scheduled task (soft, skippable)? What is the actual cost of running the next build on an unhardened starter: repeat all nine frictions?

**A5. The last mile is systematically under-budgeted.**
The pipeline reliably reaches "compiles and boots"; the first-run experience and the signature interaction (the moment the tool exists for) remain stubs at handover.
*Grill:* Should the blueprint be required to name the signature interaction so its absence at handover is a visible defect? Does first-run polish belong in the starter (generic) or the last mile of every build (bespoke)? What is the minimum "lands with a real user" checklist?

**A6. The paper trail decays within a day of active building.**
Kinyara's config, provisioning doc and tag describe a state its working tree has passed; a day of work sits uncommitted.
*Grill:* Is the fix convention (state-as-of headers, commit cadence) or tooling (a script that flags drift between docs and tree)? What is the commit discipline for solo AI-assisted building, where a "session" can produce a week's worth of change?

## B. Technical calls

**B1. What should the starter's AI module actually be?**
The generic AI stub was deleted wholesale on the first real build; the real work (schema contract, prompt, guards, extraction) was per-tool.
*Grill:* Should the starter ship an opinionated AI *harness* (provider resolution, structured-output plumbing, visible fallback mode, guard scaffolding) rather than a stub behaviour? Or is AI genuinely per-tool and the starter should ship nothing and claim nothing?

**B2. Entangled capabilities versus scaffold-by-deletion.**
SMS PIN proved some "optional" capabilities cost more to remove than to leave; the manifest under-declares coupling by roughly 14 files.
*Grill:* Rework the starter toward additive plugin seams (large effort, cleaner forever) or re-document honestly ("leave unconfigured, do not delete") and accept the bleed (cheap, permanent friction)? Which capabilities justify the plugin surgery?

**B3. The starter ships no UI vocabulary for data-facing tools.**
Every visual tool (swimlane maps, matrices, dashboards) pulled in its own component primitives post-scaffold.
*Grill:* Bake a component layer into the starter (heavier template, faster builds) or keep the starter lean and accept the per-build tax? Is there a middle path: a documented, copy-in component pack?

**B4. Test harness and migration guidance are known-wrong and unfixed.**
No test runner in the starter despite tdd being the build method; migration guidance says hand-author where wipe-and-regenerate works headless.
*Grill:* Nothing to debate on substance; the grilling question is only why known one-line fixes queue behind new builds, which is A4 restated.

## C. Platform decisions

**C1. Neon versus Railway Postgres as the default POC database.**
Research says Neon (Sydney region, branching, serverless pooling, scale-to-zero); the house standard and every delivered build say Railway (no AU region, no pooling built in).
*Grill:* Does anything argue for Railway Postgres on new builds beyond incumbency? Is a two-database standard (Neon for POCs, Railway where the app already lives on Railway) a defensible policy or drift? Who migrates the starter's provisioning template and when?

**C2. Railway's place overall.**
Kept for long-running and Python services; not the app host; no Sydney region.
*Grill:* For residency-sensitive clients needing a persistent service, Railway-Singapore is a real conflict with the Sydney-everywhere pitch. What is the answer when that combination arrives: a different host for that build, or does the residency promise carry an exception?

**C3. Model provider default and the churn problem.**
Three candidate paths exist in the codebase population (AI Gateway, OpenRouter, Anthropic direct); one build used all three inside a week. Proposed default: Anthropic direct, per-client workspace, spend-capped.
*Grill:* Does anything justify a router at POC scale (fallback resilience mid-demo is the honest argument for it)? Is per-client workspace overhead acceptable at five clients? Fifty? Where does the OpenRouter default in the Kinyara build get reconciled with the proposed standard?

**C4. The secrets vault is a proposal, not a practice.**
Keys currently live in local env files and platform dashboards; one key has already leaked into a repo README historically; a OneDrive `.env` exists waiting for a paste.
*Grill:* 1Password Teams versus Doppler versus doing nothing but rules. What makes the vault stick as a habit for five non-ops people? Who owns rotation on offboarding?

## D. Content debt

**D1. The library is the differentiator and the thinnest layer.**
One playbook, one guardrail set, empty personas and definitions, while the demos hand-author judgement that looks library-grounded.
*Grill:* Is "every build leaves an asset behind" enforceable without a gate, and which stage is the gate? Is authoring library content its own workstream with hours booked, or forever a by-product? What is the minimum library for the procurement product to stop hard-coding its knowledge?

**D2. Prior-firm IP hygiene has a known open flag.**
Named-consultancy material must not surface on public-tier outputs, and prior-firm names have leaked into a library at least once. The scrub must cover source identifiers and comments, not just the rendered screen.
*Grill:* Is a mechanical check feasible (a banned-names lint over library and build folders) and who runs it? What is the remediation for the known leak, and by when?

**D3. Brains age after handover.**
The client-facing value proposition includes the vault staying current, but currency depends on a human running ingests; nothing enforces content freshness.
*Grill:* Is post-handover freshness a paid maintenance line (a product decision, not a technical one)? What does the client see when a note is stale: a date, a warning, or nothing?

## E. AI release gates

**E1. The eval harness cannot yet gate.**
Certification was withheld because two identical runs returned opposite verdicts; an eval that flips manufactures false confidence.
*Grill:* What is the reproducibility target (modal verdict over N samples, and which N) and what does it cost per run? Until it clears, is the no-live-model pattern (precomputed, human-verified answers) the *mandatory* stage for client rooms, not just a prudent option?

**E2. "Pass the eval" is not yet a rule anywhere.**
Nothing in the process makes certification a precondition for putting model output in front of a client.
*Grill:* Where does the rule live so it binds: the process doc (advisory), the skills (procedural), or the client contract (commercial)? Does it apply to founder-driven live demos, or only to anything a client touches unattended?

**E3. The curated-truth versus live-number contract has one implementation.**
The grounding rules exist in one demo's manifest; the pattern is named but not portable.
*Grill:* What does the portable version look like: a guardrail file in the library that every chat-over-data blueprint must cite? Who verifies a build actually enforces it (it is testable: plant a stale figure and ask)?

## F. Commercial and structural

**F1. Bespoke-to-productised has no trigger and no routine.**
The business model's second half is unencoded: no shared-shell extraction pattern, no tenancy decision point, no config-extraction routine.
*Grill:* Is "third repetition of a shape" the right trigger, and who counts? Does productisation start from the best bespoke instance or from the starter? The category creator's shell extraction is already scheduled by its roadmap: is that the pilot for the routine, and what would make it generalisable?

**F2. Fork-debt on single-file artefacts.**
v2 of the category creator is a whole-file copy of v1 and they drift; tools 2 and 3 will fork it again unless the shell is extracted first.
*Grill:* Extract now (pay the factoring cost before tool 2) or after tool 2 proves the reuse (risk a third fork)? What is the single-file pattern's official ceiling: one tool, one client, one quarter?

**F3. Demo-integrity debt is a client-risk decision, not just a process step.**
Seeds are persuasion artefacts whose numbers do not reconcile; the arithmetic-recovery gate catches it, but only for builds that enter the pipeline. Demos that stay demos (P3, category creator) carry unreconciled figures indefinitely in front of executives.
*Grill:* Does every client-facing demo need its numbers derived from named assumptions even when no build follows (cost: authoring time; benefit: no CFO ever catches a fake)? Where is the line between "illustrative, labelled as such" and "wrong"?

**F4. The Sydney-everywhere residency promise needs to be real before it is pitched.**
It is a genuine differentiator and cheap, but only if the whole chain holds (host region, database region, model data handling, and the Railway-Singapore exception in C2).
*Grill:* Write the one-page residency note now, as standard collateral? What is the honest answer on model-call data flows when a client's security team asks where inference happens?

**F5. Who else can run this process?**
The craft skills live on one laptop; the pipeline has run once, driven by its author. The firm's build capability is currently one person deep.
*Grill:* What is the minimum for a second person to run a spin-up unaided: vendored skills in the hub, a recorded walkthrough, or a paired run on the next client build? Is that redundancy worth buying before or after the next three builds?

---

## The decision queue (resolved 12 July 2026)

Grilled and settled the same day; full record in `wiki/decisions/development-process-standards.md`.

| # | Decision | Outcome |
|---|---|---|
| A3 | Scope gate | CLAUDE.md rule, three tiers: demo / POC candidate / product bet, recorded at birth |
| A1/A2 | Front door + architecture home | One `/shape` skill between `/blueprint` and `/spinup`: archetype + open forks, each an ADR |
| (A1) | Second archetype | Chat-over-vault, built for real on the oOh! Brain then extracted; Vite SPA gets a recipe doc; Python stays demand-pull |
| C1 | Default POC database | Neon (Sydney), exception: Railway Postgres only when the app lives on Railway; existing builds untouched |
| C3 | Model provider default | Anthropic direct, one spend-capped Workspace per client, AI SDK abstraction; routers only by `/shape` ADR; QA harness exempt |
| C4 | Secrets vault | 1Password Teams; platform env vars become synced copies; Toni owns rotation events |
| E1/E2 | Eval as a binding gate | Binds unattended client access (Brain Card, reproducibility 0.90 over 5 samples); founder-driven demos exempt with visible fallback; no-live-model mandatory in client rooms until the harness reproduces |
| F1/F2 | Productisation trigger | Third repetition, counted at harvest; planned-siblings exception fires now: extract the Sourcing shell before tool 2, as the pilot of the routine |
| A4/B4 | Apply the stall list | Not a decision; scheduled via the no-regret handoff (`Inbox/handoffs/development-process-no-regret-actions-2026-07-12.md`) |
