# The Engine-Room Pattern

*A standing Tract In explanatory device. Every capability we sell and every process we run should be legible as a machine: what goes in, the engines it runs through, what comes out. Written 13 July 2026, after the Development Process was documented as prose and a linear stage list but never as a machine. That was the missed beat.*

---

## The idea in one line

Anything Tract In does that takes something in and returns something better should be explainable as **Inputs &rarr; Engine room &rarr; Outputs**, with each engine labelled by how much is a machine and how much is a Project Partner's judgement.

The frame first appeared inside `category-strategy-creator-v2.html` (the "How this works" panel: spend goes in, five engines run, a strategy comes out). It works there because it kills the black-box objection before it is raised. It should not have stayed a one-off. The same device explains the build process to ourselves, a productised tool to a buyer, a brain to a sceptic, an operating-model scan to an executive.

## Why it earns its place

It forces three questions that vague capability descriptions dodge:

1. **What are the inputs, and how load-bearing is each?** Required, recommended, optional, or a standing fact we already hold. A client reads their own obligations off this.
2. **What are the engines, and who does each?** The honesty move. Every engine carries a tag: `Auto`, `Auto + human`, `AI + human`, `Human`, or `Red-team`. You cannot hand-wave "AI does it" and you cannot hide the human. Where the machine genuinely wins (data work, scaffolding) you say so; where a person earns their keep (judgement, red-team) you say that louder.
3. **What comes out, and which output is the differentiator?** One output is the punchline: the thing competitors' tools do not produce. For the category creator it is the Devil's advocate. For the build machine it is *a cheaper next build*. Name it and make it stand out.

If a capability cannot be drawn this way, that is a finding: the thinking is not yet decomposed.

## When to build one

- Any productised capability, before it goes in front of a buyer (kills the black-box objection).
- Any internal process we want the team to run the same way twice (the build machine is the first).
- Any client deliverable that is itself a machine (a brain, a scan, a scorecard), where the client's trust depends on seeing the works.

Not for: a one-off document, a pitch narrative, or anything that is a message rather than a machine.

## Anatomy

**Inputs** (aim for 3 to 4). Each has a name, a load-bearing tag (`Required` / `Recommended` / `Optional` / `Standing`), and one line on what it is and why it matters.

**Engines** (aim for 3 to 6, never more). Compress the real stages: the build process has fourteen stages behind six engines. Each engine carries:
- a number and a short verb-ish name (`Scope`, `Blueprint`, `Prove`),
- an honesty tag (see below),
- three to five "lenses": the concrete moves inside it,
- a `Feeds &rarr;` line naming what it hands to the next engine or output,
- on inspect: a one-line `basis` (who does it, on what authority) and a short paragraph of `detail`.

**Outputs** (aim for 3). What the machine returns. Mark exactly one as the differentiator.

**The honesty tags**, and how they read visually in the reference build:
- `Auto + human` (blue tint) &mdash; machine-led, one human gate. The machine does the heavy lifting.
- `AI + human` (white) &mdash; AI assists, a person leads.
- `Human` / `Red-team` (ink) &mdash; pure judgement, or the adversarial pass.

A legible machine often has a shape to its tags. The category creator runs monotonic: fully automated at the front, pure judgement and red-team at the back. The build machine inverts it: judgement heaviest at the ends (the scope call, the certify-and-prove gate), the machine's share largest in the middle (scaffold, build). Either is fine. The point is that the shape is honest.

## How to build one (it is data, not code)

The reference implementation is `the-build-machine.html` in this folder. The visual system, animation, click-to-inspect and responsive behaviour are all done. To make a new one you change three data arrays near the bottom of the file and nothing else:

- `INPUTS` &mdash; `{ name, tag, cls, spec }`
- `ENGINES` &mdash; `{ n, key, name, tag, cls, lenses[], feeds, feedsPlain, basis, detail }`
- `OUTPUTS` &mdash; `{ name, note, star? }` (set `star:true` on the differentiator)

`cls` maps a tag to its colour: `t-auto` (blue tint), `t-hybrid` (white), `t-human` (ink); inputs use `t-req` / `t-rec` / `t-opt`. Update the `<h1>`, the lede, the two notes and the masthead subtitle, and it is a new explainer.

For a slide version, the same three columns port straight onto a `/masterdeck` slide.

## The rules that keep it honest

- **Compress to engines, do not list stages.** Six engines, not fourteen boxes. If it will not compress, the process is not understood yet.
- **Every engine gets a tag.** No untagged engines, ever. The tag is the product.
- **Never hide the human, never inflate the AI.** Where a person makes the call, the engine is ink. Buyers trust the ones that admit this.
- **Name the differentiator output.** One output is the reason to choose Tract In. Make it visually distinct.
- **House style applies.** "Tract In" (two words), no em dashes, no banned words, Australian English, "Project Partner" not "consultant". The reference `category-strategy-creator-v2.html` predates the naming rule and reads "TractIn"; do not copy that string.

## Reference implementations

| Machine | File | Reads to |
|---|---|---|
| Category Strategy Creator (product) | `02. Marketing and Propositions/Productised solutions/2. Procurement/Sourcing/build/category-strategy-creator-v2.html` | A procurement buyer |
| The build machine (process) | `the-build-machine.html` (this folder) | Ourselves, and clients asking how we build |
| The brain machine (product) | `01. Clients/oOh! Media/Phase 4_The Brain/the-brain-machine.html` | A sceptical client executive asking what a brain is |

Related: `03-process-design.md` (the fourteen stages behind the six engines), `wiki/decisions/development-process-standards.md` (the standing decision that makes this the default).
