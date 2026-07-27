# Productising the Brain: pulling the threads together

**Date:** 16 July 2026
**Author:** Toni (with Claude), triggered by the JMC Technologies call (Toni, Rene, Joe, 16 Jul)
**Reads with:** `wiki/decisions/jmc-partnership.md`, `wiki/decisions/development-process-standards.md`, `08. Leadership Office/AI Operating System/modules/M7` and `M8`

---

## The point

Four separate threads in the firm are all circling the same product. The JMC call did not open a new one; it validated the direction from outside and named the hard problem more sharply than we had. The gap is not vision or proof. It is that nobody owns the product: there is no single spec, no pricing wrapper, and the maintenance model that makes it recurring revenue is designed on paper but unproven with a paying client.

## The four threads

**1. The oOh! deployment (the proof).** The Brain is live at one ASX client: the oOh!Works and ComOps vaults, the golden pack narrative ("Answers are now cheap. Truth is not."), the Production 1 plan (12 weeks, ~2.1 FTE, adopt/park gate ~week 8), and the 8-week paid pilot in scoping. The golden pack already argues the pattern is productisable because the underlying problem (cross-functional metrics with no owner of the whole) exists at most companies. This thread also holds the live, unresolved version of the maintenance problem: Production 1 requires a named Brain owner and a governance and curation framework so oOh! keeps the context layer updated after we leave.

**2. The internal packaging thread (the method).** The AI Operating System already productised the method once: M7, the Knowledge Layer POC Accelerator, is a built six-week product with a playbook and toolkit. M8 names the remaining gap exactly: the Brain is "proven, not packaged for clients", with no client-facing brief, proposal, or pricing wrapper (Sprint 2 target). The Development Process standards add the machinery: productise on third repetition, chat-over-vault to be built once against the oOh! Brain then extracted as the second supported archetype (demand gate ~28 Aug 2026), the Brain Card eval gate binding any unattended client access, and Decision 19's two-tier freshness offer: self-maintained (schema contract, lint tooling, training, priced into handover) versus maintained (monthly retainer with ingest, lint, and periodic re-certification).

**3. The commercial vehicle (the wrapper).** Go-to-market names "run/maintenance (recurring, not yet designed)" as an open revenue stream. The execution-engine thread (Stevens/Haag) supplies the two-lane economics: outcome lane at ~40-50% net, productised recurring lane at ~10-15%, with the doctrine "productise the commodity, bank margin to fund IP". The TractIn AI entity is where the IP would sit. The Brain as a product is the most concrete candidate this machinery has.

**4. JMC (the outside validation and the technical ceiling).** Joe, unprompted, arrived at the same commercial model we had already decided internally: treat the current vault as proof of concept, build a generic product (data input and management interface plus an LLM-and-dashboard analysis interface for C-suite users, hostable on the client's network or ours), and earn revenue through a sizeable onboarding service plus recurring maintenance and improvement contracts. That convergence is the strongest external signal yet that Decision 19 and the go-to-market recurring-revenue hypothesis are right. He added three things we did not have:

- **A pitch frame:** "a digital twin focused on knowledge, not assets."
- **A technical ceiling:** Obsidian links are untyped. A knowledge graph's typed triplets (Neo4j) make querying reliable and shrink the wayfinder layer. The markdown vault stops scaling at roughly one business unit or ~10,000 files. His LLM-graph pipeline (chunk, extract relationships, hierarchically cluster, summarise per level, traverse with retrieval tools) gives full explainability. For current clients we are under the ceiling; a product ambition beyond one business unit needs the typed-graph architecture on the roadmap.
- **A sharper statement of the hard problem:** long-term maintenance. Auto-updating vaults create noise faster than signal; the canonical vault needs a human gatekeeper pruning on a cadence. His view is also our defensibility thesis: curation requires human judgment, which is precisely why the retainer tier is defensible revenue rather than a feature an LLM erases.

## Where the threads agree

- The vault as delivered today is the proof of concept. The product is the vault plus an input/management surface, an analysis surface, and a certification and freshness regime.
- Recurring revenue comes from maintenance and re-certification, not from the build. Decision 19, go-to-market, the execution-engine economics, and Joe all land on this independently.
- Quality gates are part of the product: the Brain Card (reproducibility ≥ 0.90) is the assurance artefact that lets a client trust an unattended Brain, and its validity expiring with staleness is what makes the retainer honest rather than rent-seeking.

## The one question every thread leaves open

**The post-handover maintenance and curation model.** It is the productisation prize (the recurring stream), the live risk at oOh! (named Brain owner still unassigned), the gap in go-to-market ("not yet designed"), and in Joe's words the unsolved problem of the whole category. Decision 19 gives the commercial shape; nothing yet proves a client will pay for the retainer tier or that a self-maintained client keeps the vault canonical. The oOh! Production 1 gate (~28 Aug 2026) is the first place this gets tested with real money.

## What this implies (proposed, not decided)

1. **Make the oOh! pilot the product test, not just a client deliverable.** Instrument it to answer the retainer question: does a named client owner actually maintain the vault, and what does re-certification cost us monthly?
2. **Bring M8 forward as the packaging vehicle.** The brief, proposal and pricing wrapper M8 already targets should encode the two-tier freshness offer and the "knowledge digital twin" pitch frame in one place, so the next prospect conversation sells from a document rather than a retelling.
3. **Put the typed-graph ceiling on the product roadmap, not the current build.** Note the ~10k-file limit in the product architecture; revisit Neo4j when a client's scope crosses one business unit or when the chat-over-vault archetype is extracted (post 28 Aug gate). Joe is the natural design reviewer for that step.
4. **Keep JMC defence-first.** The partnership's near-term value is the ASA demo, the USN door, and Joe as a technical sounding board on the product architecture. Commercial terms (referral, day rate, joint IP) only need answering if his involvement goes beyond that. Tracked in `wiki/decisions/jmc-partnership.md`.
5. **Name a product owner.** Every thread has an owner for its piece; none owns the Brain as a product. Until someone does, convergence stays accidental.

## Full source map

| Thread | Key documents |
|---|---|
| JMC / Joe | `wiki/decisions/jmc-partnership.md`, `wiki/stakeholders/joe-jmc.md`, `Inbox/granola/jmc-technologies-2026-07-16.md` |
| Internal packaging | `08. Leadership Office/AI Operating System/modules/M7-knowledge-layer-poc-accelerator.md`, `M8-context-layer-leave-behind.md`, `M6-applied-ai-offer.md`, `M3-the-flywheel.md`, `wiki/decisions/development-process-standards.md` (decisions 8, 19, eval gate), `02. Marketing and Propositions/Development Process/` (01, 05, 08), `02. Marketing and Propositions/Productised solutions/` |
| Commercial vehicle | `wiki/decisions/go-to-market.md`, `wiki/decisions/execution-engine.md`, `wiki/decisions/tractin-ai-entity.md`, `wiki/decisions/ai-operating-system-scope.md` |
| oOh! deployment | `01. Clients/oOh! Media/Phase 4_The Brain/the-brain-golden-pack.md`, `Phase 3/04 - Stream 4 .../S4 oOhWorks - TractIn Effort to Production 1 ... v0.2 - 2026-07-07.md`, `Inbox/handoffs/ooh-brain-pilot-and-artefacts-2026-07-13.md`, `Inbox/handoffs/oohworks-comops-brain-2-0-2026-07-08.md` |
