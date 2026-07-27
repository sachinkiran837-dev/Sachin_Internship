# TractIn AI Operating System

**Owner:** Toni Auburger (AI Strategy Lead)
**Status:** v0.1 skeleton, 28 June 2026
**Machine twin:** `.claude/CLAUDE.md`

This is the map. It is deliberately thin. The detail lives in the module files, each owned and dated. If this document ever grows into a manual, it has failed. Read this to see the machine. Open a module to use it.

---

## What this is

How TractIn works with AI, expressed once and shown two ways. The way we work internally is the product we install in clients and leave behind. Build the thing once, show two faces.

This is the system the AI Strategy Lead owns. It is not the firm's whole strategy (that is the founding team's). It is the AI layer that does two jobs: it makes Project Partners great at using AI, and it powers the Applied AI practice we sell.

Scope, stated plainly: today this is built Applied-AI-first, and the modules describe the Applied AI practice. The ambition is the AI layer under all four practices, brought in as real builds give us the evidence to do it well. We do not claim whole-firm coverage we have not earned yet.

Council-tested 28 June 2026. The verdict and the four corrections it forced are recorded in `wiki/decisions/ai-operating-system-scope.md`.

---

## The six principles

1. **One system, two skins.** Internal way of working and client offer are the same machine. Every improvement compounds into both.
2. **A thin map over modular parts.** This page is the spine. The modules are the muscle. Monoliths rot; modules stay alive because each has an owner and a date.
3. **Stack tiers are academy tiers.** Claude desktop is the floor for everyone. Claude Code in VS Code is encouraged as people climb. Claude is the spine; the build layer is multi-model.
4. **The flywheel is the engine, not the offer.** It powers an Applied AI build and any Partner spinning up an asset.
5. **Separate the method from the substrate.** The flywheel, the guardrails, the context-layer method, and the evaluation discipline are portable. The model and platform are a swappable substrate. We never sell Claude, we sell the method. Be precise about what ports: the method carries across models, the performance does not. A weaker, client-mandated model is re-tuned and re-proven against the evaluation set before anything ships. Portability means we do not start over, it does not mean the result is guaranteed. The evaluation set is what makes a model swap safe.
6. **Two guardrail layers, two rules.** Anti-slop is always on. Cyber risk is risk-tiered and two-speed.

---

## The two surfaces

### Surface 1: How TractIn works (every Project Partner, all four practices)

| Module | State today | Owner |
|---|---|---|
| [M1 · The Stack](modules/M1-the-stack.md) | drafted v1, critiqued (28 Jun) | Toni + Kim |
| [M2 · The Academy](modules/M2-the-academy.md) | drafted v1, critiqued (28 Jun) | Toni + founder leads |
| [M3 · The Flywheel](modules/M3-the-flywheel.md) | drafted v1, critiqued (28 Jun) | Toni / JC |
| [M4 · The Guardrails](modules/M4-the-guardrails.md) | drafted v1, critiqued (28 Jun) | Kim + Toni |
| [M5 · The Hub](modules/M5-the-hub.md) | built, index it | Toni |

### Surface 2: What we sell and leave behind (Applied AI practice plus assets)

| Module | State today | Owner |
|---|---|---|
| [M6 · Applied AI offer](modules/M6-applied-ai-offer.md) | exists in the value prop | Rob (P&L) / Toni (method) |
| [M7 · Knowledge Layer POC Accelerator](modules/M7-knowledge-layer-poc-accelerator.md) | built (playbook + toolkit) | Toni / Caitlin |
| [M8 · Context-layer leave-behind](modules/M8-context-layer-leave-behind.md) | skill exists, not packaged | Toni / Rene |
| [M9 · AI Risk & Assurance](modules/M9-ai-risk-and-assurance.md) | follows from M4 | Kim |

### The bridge

M3 (Flywheel), M4 (Guardrails) and M8 (Context-layer method) are identical in both surfaces. That sameness is the proof that this is one system, not two. The client view is this same map with the internal-only parts filtered out (our margin logic, pricing, council prompts, partner commercials).

---

## The flywheel (the engine, summarised)

How a problem becomes a governed, embedded, proven asset. Full method in [M3](modules/M3-the-flywheel.md).

```text
 1 Curiosity  2 Prototype  3 Challenge   4 Govern      5 Deliver  6 Embed    7 Prove &
 understand   fast SLC     attack it,  [Gate 2: safe   the build  leave-     Hand Over
 the real     wow build,   not defend   to deploy?]    + eval     behind +   did it work,
 problem      sanitised    [Gate 1:     risk, perms,              agentic    what was it
              data only     worth        security,                harness +  worth, can
                            building?]   HITL                      adoption   their team
                                                                             run it alone
 ----------------------------------------------------------------------------------------
 Anti-slop runs underneath every stage. It is design-time quality control by people,
 not a runtime safeguard on a live agent. No step ships slop.
```

Gate 1 (worth building?) uses council and critique. Gate 2 (safe to deploy?) is the cyber gate plus the pre-deployment non-negotiables in [M4](modules/M4-the-guardrails.md). The bar at stage 2 is SLC: Simple, Lovable, Complete, never complex-but-crappy. Stage 7 exists because the firm's promise is work that is measured and run by the client after we leave. A loop that ends at Embed cannot prove that, so it does not end at Embed.

---

## The two guardrail layers (summarised)

Full rules in [M4](modules/M4-the-guardrails.md).

- **Anti-slop, always on.** Devil's advocate, council, critique, customer lens, impeccable (frontend). Mandatory at every step, even a throwaway demo. De-sloppifying is a constant, not a gate. This protects excellence and kills sycophancy-driven output.
- **Cyber risk, risk-tiered, two-speed.** Sandbox (demos, internal experiments): one rule, sanitised or synthetic data only, never production client data, always labelled "demo, not deployment." Deployment gate (real client data or real decisions): risk register, permissions trust boundary, security review, documented human-in-the-loop checkpoints. The dividing line is the demo to deploy boundary.

---

## How it stays alive

Every module has an owner and a last-reviewed date. Reviews ride the cadence the team already runs (see `08. Leadership Office/Team Rhythm/`). No new meeting.

- Fortnightly Lunch & Learn surfaces Academy and Flywheel changes.
- Monthly Commercial Review surfaces Surface 2.
- Quarterly Offsite re-checks the whole map.

If a module's last-reviewed date is older than a quarter, it is presumed stale until someone confirms it.

---

## The build plan (council-revised, 28 June 2026)

The council backed the skeleton and forced four cheap corrections, a module freeze, and a hard rule on what must exist before any agent touches client production data. Full reasoning in `wiki/decisions/ai-operating-system-scope.md`.

### The four corrections (inside Sprint 1, a sentence each)

1. Close the loop. The flywheel gains stage 7, Prove and Hand Over. Done above and in M3.
2. Tell the truth about portability. Principle 5 softened. Done above and in M1.
3. Name the scope. This is the Applied AI operating system, built Applied-AI-first. Stated up top.
4. Do not show it to buyers. Lead with the number and a reference, keep the diagram in the back room.

Plus one firm-level fix: reconcile the practice taxonomy (the value prop says four practices, the capabilities doc says five). Owner: Toni + Rob.

### Sprint 1, to 12 July 2026 (the SLC core of Surface 1)

Done means: one real client deliverable is produced by a Partner who is not Toni, following the OS.

- [x] T1 · Map skeleton — Toni
- [x] T3 · The Flywheel playbook, drafted v1 from three real demos across three practices, critiqued and fixed. Proof still pending: a Partner who is not Toni runs it on a real job. — Toni / JC
- [x] T4 · The Guardrails one-pager: two layers, a decision table for when each check is mandatory and who signs off, the eight pre-deployment non-negotiables. Drafted and critiqued 28 June 2026. Owners: Kim, Toni.
- [x] T2 · The Stack one-pager: setup checklist per tier, plus the role-to-tier guide. Drafted and critiqued 28 June 2026. Owners: Toni, Kim.
- [x] T5 · The Onboarding induction (M2): Day 1 / Week 1 / Month 1 path into the badge ladder. Drafted and critiqued 28 June 2026. Owners: Toni, founder leads.
- [ ] T6 · Finalise the map — Toni

Module freeze: no new modules during Sprint 1. No M10, no evaluation-suite doc, no operations module yet.

Dog-food rule: run `/critique` on every artefact before filing, and `/council` on the real bets. We build the operating system using the operating system.

### The hard gate (lives in M4, non-negotiable before any agent touches client production data)

Versioned prompts with rollback. An automated regression set with a locked baseline. Structured logging with PII redaction. A per-client spend cap. Egress and tool allow-listing against prompt injection. Vetted zero-retention model endpoints for production (OpenRouter "cheapest model" is sandbox and synthetic data only). A named human escalation path and kill switch. A scheduled re-eval after handover.

### Wave 2, the back-half pillars (the immediate next priority once Sprint 1 is solid)

Not deferred to someday. These start the moment the front-half is robust, drafted against the evidence from the real builds running in parallel, not invented from one build.

- [ ] W1 · Evaluation discipline: regression set, drift and deprecation detection, a pass-bar tied to Gate 2, re-eval on every model swap. Also what makes Principle 5 honest. — Kim + JC
- [ ] W2 · Production operations: observability, incident response, SLA, the hard gate above made real. Required before selling a Managed Agentic Service. — Kim
- [ ] W3 · Reusable asset library: every build deposits its reusable parts (the critic pattern, extraction prompts, ontology templates, eval sets) so cost-to-deliver falls build over build. — JC / Toni
- [ ] W4 · Unit economics: cost-to-build, cost-to-run per month, the gross-margin floor on a managed service. You cannot sell a managed service you cannot cost. — Toni + Rob
- [ ] W5 · Data and security posture: prompt injection, egress control, PII and retention, model-provider data terms. Feeds M9. — Kim

Trigger for Wave 2: Sprint 1 core shipped and proven on one real job, and at least one more real build underway. Do not wait for build three, but ground every pillar in real build evidence.

### Sprint 2, to 31 July 2026 (reordered behind Wave 2 where they overlap)

- [ ] T7 · AI Governance & Cyber POV (absorbs W2 and W5) — Kim + Toni
- [ ] T8 · Surface 2 assembly, only once the proof points are real — Rob + Toni
- [ ] T9 · Portability appendix with a worked example (the same agent passing eval on Claude and on one other model), not an afterthought — Kim + Toni
- [ ] T10 · Tier 1/2 academy materials, captured from real builds — JC / Kim

### Do this first

Answer the council's test in writing this week: name the next two or three real deliverables (oOh!, LMG, Laing O'Rourke) and route one through the OS, produced by a Partner who is not Toni. If the OS survives one real job in someone else's hands, it is real.
