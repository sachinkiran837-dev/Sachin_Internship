# M3 · The Flywheel (playbook)

**Surface:** 1 (how TractIn works), and the engine inside Surface 2
**Owner:** Toni / JC
**State:** drafted v1.1, 28 June 2026. Grounded in three live demos across three practices (LMG, Uniting, Category Strategy Creator). v1.1 adds the frontend design pass (`/impeccable`).
**Last reviewed:** 28 June 2026

**Scope (one line):** the repeatable way a Partner takes a problem to a challengeable, governed, proven asset, fast, without shipping slop.

---

## What this is

This is how we build. A Partner can follow it across practices to get to a demo that wows and survives attack, then to an asset the client runs after we leave. It is drawn from what we actually did on LMG (Applied AI), Uniting (People Transformation) and the Category Strategy Creator (Procurement), not from theory. The same shell ran across all three. That is the proof it travels, and it is the evidence we have. Technology Platforms has not been run through it yet.

One rule sits above the rest: **the demo is the sales asset, not a deck about one.** The thing you build is the thing you sell with. It moves the buyer from "can you?" to "when can you start?"

**Who owns what (you do not need to code).** Tier 0 Partners own the consulting stages: Curiosity, Challenge, and Prove and Hand Over. That is most of what decides whether a build succeeds. Builders own the making: Prototype, Deliver, Embed. If you are non-technical, your stages are the ones that matter most, and you hand the build to a Builder at stage 2. **In a hurry, jump to the Partner's checklist at the end and work back up.**

---

## The spine (true in every build)

1. **One hero, carried the whole way.** One named person or entity, followed front to back. Depth on one spine beats a feature tour. LMG followed one self-employed borrower through both engines.
2. **A real engine, deterministic on rails.** Real logic on staged inputs, computed once at temperature 0 (the setting that makes the model give the same answer every time) and cached, with a live re-run kept as proof. The buyer sees real reasoning. The demo cannot say anything false in the room.
3. **Synthetic data, authored to trigger the wow.** Fully synthetic or sanitised inputs, seeded to real dynamics, planted with defensible tells. The only thing faked is the data, and you say so.
4. **An honesty marker on screen.** "Illustrative data, demo environment." Fact is visibly split from assumption. Showing the seams builds trust. It is a credibility move, not a disclaimer.
5. **Never invent.** Every claim resolves to a source. The machine reasons, it does not fabricate. Savings are assumptions a Partner confirms, never facts the machine calculated.
6. **The human decides, in the UI.** The tool advises, the person chooses. Make it literal on the screen: "Your call."
7. **It attacks its own answer.** A devil's-advocate beat is built in, in plain view. We raise the buyer's hardest objection before they do.
8. **A printable one-pager is the deliverable inside the demo.** The buyer leaves holding the artefact they actually need.
9. **The frontend is part of the proof.** Every UI gets an `/impeccable` pass. A slop, AI-generated-looking interface undercuts everything the engine earned.

---

## The seven stages

Two gates. Anti-slop underneath all of it (design-time, by people, see M4). The front half is where the craft lives, so it is the deepest here. The back half points to the modules that own it.

### 1. Curiosity (find the real problem)

- **Write the one belief the buyer must repeat to their own team.** One sentence. If a feature does not advance it, cut the feature. On LMG that belief was about protection and defensibility, never automation.
- **Frame against the buyer's enemy and their wound, not the generic pitch.** Same capability, the right frame wins the room and the wrong frame loses it. LMG framed AI as protection because the CEO had absorbed real penalty pain and defined himself against an "AI native" competitor.
- **Find the pain already on their desk.** Not a future problem. LMG built its leave-behind to be the exact artefact a regulator was already demanding.
- **Run a grill session to resolve the open design calls before building.** Force the list to resolution. Record the calls. We did this on LMG and on Procurement, both times before a line was built.
- **Pin the language.** One word per thing, in a short glossary, so narration, build and planning never drift.
- **Decide the consumption mode now:** live-narrated by a Partner, or cold-read with nobody talking. It changes everything downstream.

### 2. Prototype, to the SLC bar

Simple, Lovable, Complete. Never complex-but-crappy. The bar is made concrete below. Build on synthetic data, on rails. This is the stage that produces the wow. Two parts decide it: the engine (does it reason right) and the frontend (does it look like something worth buying). Run `/impeccable` on the frontend before you show it. The design pass is not optional. See the frontend bar below.

### 3. Challenge — **Gate 1: is it worth building?**

The demo invites attack rather than defending itself. Devil's advocate, customer lens, `/critique`. If it cannot survive being attacked by us, it is not ready for a client. This gate is cheap and ruthless. Most ideas should die here, on synthetic data, before anyone spends real effort.

### 4. Govern — **Gate 2: is it safe to deploy?**

The demo-to-deploy boundary. Nothing touches real client data or real decisions until the gate is passed. Risk register, permissions, security review, documented human-in-the-loop, and the eight pre-deployment non-negotiables. This gate is owned by M4. Do not improvise it.

### 5. Deliver

The build proper. The Knowledge Layer POC Accelerator (M7) is the productised form. Ontology, golden questions, the layers, the evaluation set.

### 6. Embed

The context-layer leave-behind (M8), the agent scaffold, and adoption. The client's people learn to run it.

### 7. Prove and Hand Over

Did it work, what was it worth, can their team run it without us. Adoption evidence and value captured. The firm's promise is work that is measured and run by the client after we leave, so the loop is not closed until this passes. This is also where the firm earns the second project.

---

## The SLC bar, made concrete

**Simple (narrow on purpose, deep where it counts).**
- Cut scope hard. Few things, fully realised. LMG ingested only the rules its three scenarios touched. Procurement worked five categories to full depth and left the rest as top-line.
- Cut gimmicks, do not polish them. Procurement removed its what-if lab outright because a slider with no downside reads as theatre to a COO.

**Lovable (it feels real, and it feels like theirs).**
- Skin it to the buyer's world so they picture it in their own platform with zero translation. Evoke, do not pixel-clone (the chrome will be wrong and it reads as presumptuous).
- Open on a cockpit splash that says "this is yours": signed in as their name, their role.
- Use motion as narrative, not decoration. Build, hold, reveal. The hold makes the reveal land.

**Complete (a whole arc, not a fragment).**
- Write the storyboard before the build. A cold open, an engineered wow, a trust beat, a money close. LMG ran eight beats with two crescendos: the catch (the wow) and the asset only the client owns (the aha).
- Close on money and the next step. Always land on a commercial action. LMG closed by pricing against one remediation programme, not per user per month.

---

## Make the frontend impeccable (the design pass)

A slop UI kills everything the engine earned. The biggest tell that a demo was vibe-coded is a generic, un-art-directed interface: default component-library cards, flat hierarchy, uniform spacing, no motion, the same look every other AI build ships. A buyer reads that as "a prototype someone threw together," and the determinism and provenance you worked for stop landing.

So the frontend gets a design pass, every time. **Run `/impeccable` on the UI.** It is the frontend arm of the always-on anti-slop layer (M4), so it is mandatory, not a nice-to-have. The pass covers:

- Visual hierarchy: the eye lands on the one thing that matters first.
- Typography, spacing, alignment: a deliberate grid, not the framework default.
- Colour and theming: skinned to the buyer's world (see Lovable), not stock.
- Motion and micro-interactions: build, hold, reveal. The hold makes the reveal land.
- Empty, loading and error states: a demo that breaks ugly breaks the trust.
- Responsive behaviour and UX copy: every label self-explanatory for a cold reader.

The cockpit shell, the dark and light registers, the cinematic chaptering on LMG are the output of this discipline, not decoration. The design is part of the proof. If the interface looks AI-generated, you have a draft, not a demo.

## Synthetic data, on rails (the load-bearing technique)

- **Author the data to trigger the wow,** then plant real, defensible tells. LMG seeded a synthetic payslip whose metadata gave it away (producer field reads Canva, creation date after the pay period, year-to-date that does not reconcile).
- **Compute once at temperature 0, cache it, keep a live re-run as proof.** Cached and live output must be identical. Warn the build agent not to "helpfully" run everything live on load, the caching is a credibility feature, not a shortcut. Keep a silent recorded fallback for when the room wifi or the API dies.
- **Pull facts from a fixed store, never generate them.** The machine retrieves and reasons. It does not write the law or invent the number.
- **Never dramatise data a domain expert knows is wrong.** The exact expert you are pitching will catch it. Keep seeded figures in defensible bands. Never dramatise a category that was genuinely competitively tendered.

---

## The challenge discipline (our signature move)

Most tools hide their weak points. We put ours on the table before the buyer asks. That is the trust differentiator, and it is how we live the devil's-advocate value in front of a client.

- **Ceiling: a live adversarial critic.** A second agent interrogates the first agent's confident answer and can flip the verdict in view. This is LMG's literal wow, and where the proof lives (an adversarial self-critique pattern cut hallucinations from about 11% to about 4%). A critic must be measured (tested against a set of known-wrong answers) and should run on a different model family from the generator (a different underlying model, not Claude checking Claude), or it manufactures false confidence. See M4.
- **Floor: a static pre-empted-objection panel.** "Here is what would make us wrong." Red-teamed copy, the hardest objection raised first. Procurement does this. It honours the principle without a live agent.
- **Always: "your call."** The engine defers to the human, on screen. Carry the trade-off the person should weigh, then hand judgement back.
- **The honest no.** The engine refuses to manufacture an answer that is not there, and documents the path to yes. The refusal is the trust beat, not a failure.

Pick the level the moment warrants. Live critic for a high-stakes, single-buyer, founder-narrated pitch. Static panel for a cold-read self-serve tool. Do not claim the live version when you built the static one.

---

## What stays general, what is the client skin

The flywheel and this discipline are identical internally and in what we install (the bridge, see the map). The client skin is this same method with the internal-only parts removed: our framing of the buyer's wound, our pricing logic, our competitor pivots, our grill-session records.

Strip anything domain-specific when reusing across clients. From LMG that means the mortgage-regulation specifics, the named-competitor pivot, the Best-Interests-Duty frame, and the bespoke cinematic chrome. The pattern generalises. The mortgage details do not.

---

## Cross-practice proof

| Pattern element | Applied AI (LMG) | People Transformation (Uniting) | Procurement (Category Strategy) |
|---|---|---|---|
| One hero carried deep | one borrower, both engines | named homes, one escalating case | three companies, five categories each |
| Real engine, deterministic, cached | temp 0, live re-run, identical | illustrative feeds | pre-built seed, not live-computed |
| Honesty marker on screen | "the only thing we faked is the borrower" | "illustrative data, demo environment" | "all data is illustrative, companies fictional" |
| Fact vs assumption split | retrieved rules vs reasoning | options, assumptions, trade-offs | honesty panel: derived vs assumed |
| Human decides, in the UI | "your call, the engine defers" | recommends an option, shows four | "Judge (human)" plus a working session |
| Challenge built in | live Compliance Critic | risks and trade-offs surfaced | devil's advocate, promoted |
| Six-view cockpit shell | chaptered spine over the same surfaces | the origin of the shell | cloned from Uniting |
| Printable brief as deliverable | regulator data dictionary per loan | decision briefs | board one-pager per category |

Where it does not transfer cleanly: the live adversarial critic is fully built only in LMG (treat it as the ceiling, the static panel as the floor). The what-if lab is core to Uniting and was cut from Procurement (interactivity is only lovable when moving a control shows a real cost or risk on the other side). Live-narrated and cold-read are genuinely different builds of the same engine.

---

## Anti-patterns (warn every Partner)

1. Do not let the build agent optimise away the determinism. Caching is a credibility feature. Drift between cached and live re-run destroys the trust the caching exists to protect.
2. Do not build broad and shallow. A feature tour reads as a brochure, not a wow.
3. Do not polish a gimmick. Cut it. A what-if with no downside is theatre.
4. Do not claim the machine learns or invents. Compounding is a roadmap line, never an in-room claim. It breaks the never-invent trust line.
5. Do not dramatise data a domain expert knows is wrong. Keep it in defensible bands.
6. Do not pixel-clone the buyer's system. Evoke their world, do not fake it badly.
7. Do not frame on the wrong emotion. The right capability with the wrong frame loses the room.
8. Do not hide the weak points. Inviting the attack is the trust.

---

## The Partner's checklist

Before you build:
- [ ] The one belief is written in a single sentence.
- [ ] The frame matches the buyer's wound, and the banned words are listed.
- [ ] The pain is already on their desk.
- [ ] The open design calls are resolved and recorded.
- [ ] The glossary is pinned. The consumption mode is chosen.

While you build:
- [ ] One hero, carried the whole way.
- [ ] Real engine, temperature 0, cached, with a live re-run.
- [ ] Synthetic or sanitised data, authored to trigger the wow, honesty marker on screen.
- [ ] Fact split from assumption. Every claim resolves to a source.
- [ ] "Your call" is literal in the UI.
- [ ] The challenge beat is built (live critic or static panel, named honestly).
- [ ] The storyboard runs cold open, wow, trust beat, money close.
- [ ] The frontend has had an `/impeccable` pass. It does not look AI-generated.
- [ ] A printable one-pager is the deliverable.

Before you show it:
- [ ] Gate 1 passed: we attacked it and it held. `/critique` run.
- [ ] If it will touch real client data next, Gate 2 and the M4 non-negotiables are understood.

After it lands:
- [ ] Stage 7 named: how we will prove it worked and hand it over.

---

## Draft from (provenance)

- `01. Clients/LMG/Demo_Source_Pack/demoplan/` (storyboard.md, V1/Demo_Build_Spec.md, CONTEXT.md, V2 ADRs)
- `02. Marketing and Propositions/Productised solutions/2. Procurement/Sourcing/context/` (demo strategy, the spec, demo-ui-pattern.md, the five-engine room)
- `02. Marketing and Propositions/Productised solutions/1. People Transformation/PT jsx/uniting-pt.html` (the origin cockpit shell)
- F1 materials: `04. HR and Training/03. Training Sessions/1. 26 May - AI builder training by JC/`

## Definition of done

Met for v1: a general playbook, free of LMG-specific detail, that a Partner can follow from curiosity to a proven, embedded asset, with the two gates, the SLC bar, and the measurement-and-handover stage made explicit. Next: pressure-test it by having a Partner who is not Toni run one real deliverable through it, then fold back what breaks.
