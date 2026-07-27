# Decision: Development process standards (idea to POC)

**Decision:** Eight standing calls on the idea-to-POC development process, resolved in a grilling session over the decision queue in `02. Marketing and Propositions/Development Process/07-open-challenges.md`.
**Prepared by:** Toni Auburger, Tract In
**Date:** 12 July 2026
**Decider:** Toni Auburger. Each call below was taken against a stated recommendation with alternatives on the table.

---

## 1. Scope gate (A3): CLAUDE.md rule, three tiers

Every build request, in any chat, gets scoped at birth: **demo / POC candidate / product bet**, recorded in the artefact's header or README. Enforced as a behavioural rule in the hub CLAUDE.md build workflow, not inside `/spinup` (ad hoc demos were the failure mode; P3 cost a week of forfeited plumbing because the question was never asked). Three tiers because productisation ambition changes architecture earlier than POC-candidacy does.

## 2. Shape stage (A1 + A2): one /shape skill

A single new lightweight skill between `/blueprint` and `/spinup` owns both archetype selection and the previously homeless architecture forks (tenancy, data store, sync, residency, model routing). It names the archetype, records it in `spinup.config.json`, walks only the genuinely open forks, and records each as a short ADR. Scoped demos exit in one question. `/spinup` refuses gracefully when the archetype is not the Next.js starter.

## 3. Second archetype: chat-over-vault, extracted from the oOh! build

The chat-over-vault runtime is built once for real against the oOh! Brain (starter shell for hosting and auth, retrieval binding, citation enforcement, personas as prompts), then extracted as the second supported archetype. The Vite SPA pitch-tool shape gets a documented recipe only (one-shot generation already serves it; it needs patterns, not a starter). The Python two-service archetype stays demand-pull.

## 4. Default POC database (C1): Neon, with one exception rule

Neon is the default Postgres for new spin-ups (Sydney region, branch-per-preview, serverless pooling, scale-to-zero). The single exception: Railway Postgres when the app itself lives on Railway (co-located Python two-service). Existing delivered builds stay where they are. The two-database standard is policy by archetype, not drift. Starter provisioning template and env notes to be updated accordingly.

## 5. Model provider default (C3): Anthropic direct, per client

Client-facing builds call Anthropic directly through one spend-capped Workspace and scoped key per client, always behind the AI SDK abstraction so a later switch is config, not code. Routers (OpenRouter, AI Gateway) only when a build genuinely needs multi-model routing, decided as a /shape ADR. The QA harness keeps its heterogeneous multi-model judge panel (internal tooling, different rules). The Kinyara build reconciles to this standard at production provisioning. The client data-flow answer stays one sentence: prompts go to Anthropic.

## 6. Secrets vault (C4): 1Password Teams

1Password Teams Starter becomes the firm source of truth for people and machine secrets: shared vaults per concern, CLI injection for local dev, platform env vars demoted to synced copies. Toni owns rotation on offboarding or suspected leak. No calendar rotation at this size. Standing rule unchanged: no secret ever lives in a cloud-synced folder.

## 7. Eval gate (E1 + E2): binding for unattended client access

Any client user touching live model output without a founder present requires a passing Brain Card at reproducibility 0.90 or better (modal verdict across five samples). Founder-driven live demos are exempt but must run the visible-fallback pattern so degradation is never silent. Until the harness reproduces, the no-live-model pattern (precomputed, human-verified, cited answers) is mandatory in client rooms. The rule binds procedurally: written into the process doc, `/qa-brain`, and the chat-over-vault archetype. Selling certification as client-facing assurance waits until the harness gives the same verdict twice.

## 8. Productisation trigger (F1 + F2): third repetition, with a planned-siblings exception

Default trigger stays "third repetition of a shape", counted at the harvest stage against a shape register. Named exception, firing now: when a roadmap already commits to sibling tools, extract the shared shell before building the second sibling. The category-strategy-creator shell extraction (before Sourcing tools 2 and 3) is therefore the pilot of the productisation routine, starting from the best bespoke instance (v2), not the Next.js starter. The pilot's write-up becomes the generic routine: extract shell, lift inlined knowledge to the library, client-specifics to config, tenancy decision recorded.

---

## Round two, same day: the remaining open challenges

A second grilling session (12 July 2026, evening) resolved the fourteen remaining challenges. Two calls deliberately departed from the tabled recommendation; they are marked.

**9. Feedback-loop forcing function (A4).** Fix work spawns as a parallel-chat handoff during the harvest debrief; `/spinup` gains a backstop that reads a `STALL-LEDGER.md` in the starter and warns loudly (never refuses) when scaffolding from a starter with unapplied fixes.

**10. Last mile (A5).** Three moves: `/blueprint` gains a required "signature interaction" field whose built-or-stubbed status must appear in the handover stub ledger; the starter makes every degraded capability advertise its state (the magic-link trap generalised); stage 7 gets a five-line lands-with-a-real-user checklist including one non-builder click-through.

**11. Paper trail (A6).** Convention, no tooling: every generated status artefact opens with "state as of date, commit sha", written automatically; commits happen at every green gate; no session ends with an uncommitted tree. Drift tooling only if the convention fails twice.

**12. Entanglement (B2).** No plugin rework. The module manifest adopts a two-tier capability rule: deletable module (coupling declared, deletion tested) or core-woven (leave unconfigured, never delete). The example-domain bleed surfaces get genericised incrementally as scheduled stall work, because that hour repeats on every scaffold.

**13. Starter AI module (B1).** A harness plus one worked example: provider resolution (Anthropic direct default), structured-output helper, document text extraction, visible-fallback wiring, and one copy-adaptable draft-from-material behaviour with declared, deletion-tested coupling. Follow-on starter work, not in the no-regret queue.

**14. UI vocabulary (B3).** shadcn/ui base primitives baked into the starter (vendored source, ~10 workhorses); a copy-in dataviz pack grows by harvest only, starting with Kinyara's swimlane map and value-effort matrix. No speculative component building.

**15. AU compute for persistent services (C2).** The Sydney promise keeps a named escape route: residency-sensitive builds needing a long-running service use an AU-region container host chosen from a pre-named shortlist (Fly.io Sydney, Google Cloud Run australia-southeast1) via that build's /shape ADR when the case first arrives. Railway keeps non-residency persistent work. Nothing set up speculatively.

**16. Residency note (F4).** The one-page residency and teardown template is written now as standard collateral, fully honest on model-call data flows: data at rest and app compute in Sydney; inference at Anthropic in the US, not used for training by default, zero-data-retention available; Claude via Bedrock ap-southeast-2 as the named onshore escape, per-build by /shape ADR. Template at `templates/residency-note.md`.

**17. Library enforcement (D1).** A gate, not a workstream: the harvest debrief template requires "Asset left behind: path, or an explicit none-because". Extraction-first stays policy. One booked exception: lift the category creator's inlined knowledge (lever bands, factor weights, addressability haircuts, play definitions) into `procurement-expert/library/` as the master, as a prerequisite of the shell-extraction pilot.

**18. Prior-firm IP hygiene (D2).** The style-gate hook gains a banned-names check scoped to the content library, productised-solutions build folders and Marketing and Propositions outputs (wiki and internal client folders exempt). A one-off remediation sweep (source identifiers and comments included) runs now via the no-regret chat, closing the flag open since 1 July.

**19. Brain freshness after handover (D3).** A two-tier commercial offer: self-maintained (schema contract, lint tooling, training, priced into handover) or maintained (monthly retainer: ingest, lint, periodic re-certification). Source age is always visible in any runtime surface regardless of tier; volatile note types get a declared shelf life in the schema.

**20. Grounding contract portability (E3). Departed from recommendation.** The curated-truth-versus-live-numbers rules stay a pattern in the s4-demo manifest for now; no pre-committed extraction to the library, no eval class scheduled. Rationale: the harvest gate on the oOh! chat-layer build will force the extraction at the natural moment; pre-scheduling buys nothing.

**21. Demo integrity for demos that stay demos (F3).** Two rules keyed to the data's nature: client-specific figures must derive from named, visible assumptions even in throwaway demos; fictional-archetype data needs internal consistency and honest labelling, not derivation. Every client-facing demo gets a cheap arithmetic-reconciliation pass at authoring time.

**22. Second builder (F5). Departed from recommendation.** Solo for the next three builds; transfer to a second builder (and any vendoring of the machine-local craft skills into the hub) waits until the pipeline stabilises. Rationale: harden at full speed through the period the skills are changing fastest. Accepted risk, named: the build capability stays one person deep for that period. Revisit trigger: after three more builds, or earlier if a build must ship without Toni.

---

## Later addition (13 July 2026): the engine-room explainer as a standing device

**23. Every Tract In capability and process is explained as a machine: inputs, engine room, outputs.** The device that killed the black-box objection inside the category-strategy-creator ("How this works": what goes in, the engines it runs through, what comes out, each engine labelled by how much is machine versus Project Partner judgement) is now the default explanatory frame, not a one-off. It forces three questions vague capability descriptions dodge: how load-bearing is each input, who does each engine (an honesty tag on every one, no hiding the human and no inflating the AI), and which single output is the differentiator. Rules: compress to three-to-six engines rather than listing every stage; tag every engine; name the differentiator output; apply house style (the reference `category-strategy-creator-v2.html` predates the naming rule and reads "TractIn", do not copy that string). Reference implementations: the category creator (product, for a buyer) and `the-build-machine.html` (the build process itself, for us and for clients). The pattern, the anatomy and the build recipe live in `02. Marketing and Propositions/Development Process/08-engine-room-pattern.md`; a new explainer is three data arrays swapped in the reference file, or a `/masterdeck` slide.

---

## Consequences and owners

| Action | Where it lands | Trigger |
|---|---|---|
| Scope-gate rule + three tiers | Hub CLAUDE.md build workflow | Next hub edit session |
| Build /shape skill | `.claude/skills/shape/` | Before the next POC-candidate build |
| Chat-over-vault runtime | oOh! Stream 4 / Brain work | oOh! demand, gate ~28 Aug 2026 |
| Neon default in starter provisioning | `tractin-starter` + `/spinup` | No-regret actions chat (confirmed) |
| Provider default in skill guidance | `/spinup` SKILL.md, provisioning template | No-regret actions chat (confirmed) |
| 1Password Teams rollout | Firm admin | Toni to set up; founders onboard |
| Eval-gate rule text | `03-process-design.md` stage 10, `/qa-brain` | With the reproducibility fix |
| Shell extraction pilot | Sourcing build folder | Before Sourcing tool 2 starts |
| STALL-LEDGER + /spinup warn + blueprint signature field + state-as-of stamping + two-tier manifest rule + IP sweep and style-gate names | No-regret actions chat (handoff addendum 2) | Queued 12 Jul |
| Process-doc edits (stages 0, 7, 12) + residency template | Done 12 Jul in this session | Done |
| AI harness + worked example; shadcn base | `tractin-starter`, scheduled starter work | Next starter pass, not the no-regret queue |
| Procurement knowledge lift to library | Booked one-off | Before the shell-extraction pilot |
| Brain freshness two-tier offer | Proposal language for Brain work | Next Brain proposal |
| Second-builder transfer | Deferred by decision 22 | After three more builds |
| Engine-room pattern + reference build | `08-engine-room-pattern.md` + `the-build-machine.html` (this folder) | Done 13 Jul; apply to each new capability at pitch time |

Full reasoning, alternatives and evidence: `02. Marketing and Propositions/Development Process/07-open-challenges.md` and the companion documents in that folder.
