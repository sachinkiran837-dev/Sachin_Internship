# M4 · The Guardrails

**Surface:** 1 (how TractIn works), and the basis of M9 on the client side
**Owner:** Kim + Toni
**State:** drafted v1, critiqued (28 June 2026)
**Last reviewed:** 28 June 2026

**Scope (one line):** the two guardrail layers, and exactly when each check is mandatory and who signs it off.

## Who this is for

Two readers, two layers.

If you are a Project Partner writing or reviewing anything a client will see, **Layer 1 is yours.** It runs every day, on every deliverable, and you do not need to write a line of code to use it.

If you build or ship an agent, **both layers are yours.** Layer 2 keeps a live agent from touching client data it should not, and it is mandatory before anything goes near production. The technical detail below is for whoever builds.

## Two layers, two rules

Never muddle them.

- **Layer 1, anti-slop: always on.** Every step, every deliverable, even a throwaway demo. It protects the quality of the work. Presenting slop is never acceptable, whatever the blast radius.
- **Layer 2, cyber risk: two-speed.** The weight scales with the blast radius. A demo and a live deployment do not carry the same load. It protects the client and the firm.

## When is each check mandatory

| Check | When it is mandatory | Who signs off | Layer |
|---|---|---|---|
| Human read-through (TRUE, SOUND, TAILORED, OURS) | Anything AI-touched, before it leaves your hands | The Partner who sends it | 1 |
| Devil's advocate + customer lens | Every deliverable, at design time | The Partner who owns it | 1 |
| `/critique` (AI tells, logic, executive reader test) | Every external deliverable, before it is filed or sent | The Partner who owns it | 1 |
| `/impeccable` | Any frontend, before it is shown | The builder | 1 |
| `/council` | Before a high-stakes bet: pricing, scope, a service-line call, build-vs-buy, a major pitch | The decision owner | 1 |
| Sandbox data rule (synthetic or sanitised only, labelled "demo, not deployment") | Every demo and internal experiment | The builder | 2 |
| The eight non-negotiables (below) | Before any agent touches real client production data | An Architect-tier Partner (Kim or the technical core) | 2 |

## Layer 1: Anti-slop, always on

The standard is the F2 quality discipline: **TRUE, SOUND, TAILORED, OURS.** Treat every AI draft like a brilliant junior's first cut. You would never send a junior's first draft to a client unread, so the same rule holds for anything AI-touched.

- **TRUE.** Every fact, number, date and source checked against something real. Nothing ships unverified.
- **SOUND.** The logic holds. Hypothesis-led, sharp on the "so what", not fluent generic reasoning.
- **TAILORED.** Specific to this client, sector and data. Right in general but wrong for their world is a fail.
- **OURS.** Reads in our voice, carries a point of view, no machine tells.

The tools that enforce it, each in one line:

- **Devil's advocate and customer lens** on every deliverable. Argue the other side, then read it as the client.
- **`/critique`** for AI tells, logic gaps, context amnesia and the executive reader test.
- **`/council`** to pressure-test a decision or bet before you make it. Five advisors, a Devil's Advocate, one verdict.
- **`/impeccable`** for any frontend.

This is the firm's "excellence" value made enforceable, and the defence against sycophancy, the model telling you what you want to hear.

One honest caveat, for builders. This is design-time quality control by people. It protects the deliverable. It is not a runtime safeguard on a live agent. A deployed agent's own adversarial critic (an automated second model that checks the first) is a separate, runtime mechanism, and it has to be measured or it manufactures false confidence. Measure it two ways: keep a held-out error set (known failures the critic must catch), and run the critic on a different model family from the generator (for example a non-Claude model checking Claude), so the system is not marking its own homework. On the LMG build, an adversarial critic cut hallucinations from about 11% to about 4%. That is the bar.

## Layer 2: Cyber risk, two-speed

The weight scales with the blast radius.

- **Sandbox (demos, internal experiments): one rule.** Synthetic or sanitised data only, never production client data, always labelled "demo, not deployment." A demo never waits on a risk register.
- **Deployment gate (real client data or real decisions): the full discipline.** The eight non-negotiables below, plus a documented human-in-the-loop checkpoint and the design-time anti-slop sign-off.

The dividing line is the demo-to-deploy boundary, which is Gate 2 of the flywheel (M3). Crossing it is a decision, not a default.

### The eight pre-deployment non-negotiables

Before any agent touches a client's real production data, all eight exist. No exceptions. Plain-English gloss in brackets; this part is for whoever builds.

1. Versioned prompts and configs with one-command rollback. (You can revert to the last known-good version instantly.)
2. An automated regression set with a baseline locked at handover. (A fixed set of test questions with known-good answers, so you can prove the agent still works after any change.)
3. Structured logging with PII-aware redaction and a stated retention policy. (Every action recorded, personal data stripped, with a rule for how long logs are kept. PII is personally identifiable information.)
4. A per-client spend cap with alerts.
5. Egress and tool allow-listing, treating any retrieved content as untrusted. (The agent can only reach approved tools and destinations, and anything it reads from the web or a document is treated as possibly hostile. This is the floor against prompt injection, hidden instructions smuggled into content the agent reads.)
6. Vetted zero-retention model endpoints for production. (The model provider stores none of the client's data.) OpenRouter "cheapest model" routing is sandbox and synthetic only.
7. A named human escalation path and a kill switch. (A person who owns problems, and a way to stop the agent instantly.)
8. A scheduled re-eval after handover. (A booked re-test to catch the agent drifting or a model being retired.)

Your stated values are the sign-off conditions, not aspirations. Force human-in-the-loop. Always run a devil's advocate or customer lens. Check logical consistency, context degradation and AI tells. Document the risks and mitigations before deployment.

## What is not here

This is the lightweight gate, on purpose. The full AI Governance and Cyber POV is T7, in Sprint 2, and it absorbs the production-operations and data-security detail. This one-pager does not wait on it. The eight non-negotiables are the gate until T7 replaces the placeholder.

## Draft from

- `.claude/skills/council/`, `.claude/skills/critique/`, `.claude/skills/impeccable/`
- F2 quality discipline (TRUE, SOUND, TAILORED, OURS): `04. HR and Training/03. Training Sessions/2. 16 Jun - AI quality assurance/`

## Definition of done

Met: a one-pager stating when each check is mandatory and who signs it off, with the demo-to-deploy boundary defined. The full AI Governance and Cyber POV (T7) replaces the Layer 2 placeholder in Sprint 2.
