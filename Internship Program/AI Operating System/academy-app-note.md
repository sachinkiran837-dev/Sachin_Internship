# Note · The Academy as a mobile study app (parked)

**Status:** suggested implementation step, parked. Do not build until M1 to M9 content is finalised.
**Trigger:** module content signed off (realistically post Sprint 2, after T10 captures the Tier 1/2 materials from real builds).
**Owner when live:** Toni.
**Date:** 8 July 2026.

This is a note, not a module. It records an assessed option for how the Academy's knowledge layer gets delivered and retained, so the thinking is not lost between now and the trigger.

---

## The finding

The Enterprise Fluency study app (Toni's spaced-repetition sell-tool, repo `~/enterprise-fluency`, live at ai-academy-tract-in.vercel.app) was rebuilt on 8 July 2026 as a mobile-native learning app: a visual path through domains, full-screen one-thing-per-screen lessons, a global review queue driven by a Leitner spaced-repetition engine, a review streak, and per-domain mastery. Its casing is fully content-agnostic: a curriculum is 3 data surfaces (unit JSON files, a roadmap list, domain headers). Populating it with a second curriculum is cheap; writing that curriculum well is the actual work.

The assessment: **the OS modules have a large knowledge layer that fits this frame well, and a practice layer that must not go in it.**

### What fits (the knowledge layer, roughly 70%)

- **M3 Flywheel:** 7 stages, 2 gates, the SLC bar, who owns which stage.
- **M4 Guardrails:** two layers, two-speed cyber, the demo-to-deploy line, the eight pre-deployment non-negotiables. (Enterprise Fluency Domain 5 already teaches this material from the sell side, which is proof the casing carries it; the Academy version is the operator's side.)
- **M1 Stack:** tiers, role-to-tier.
- **M5 Hub:** what lives where, which skill for which job.
- **M8 Context-layer method:** curation vs pathing, one brain per client, strip before handover.
- **M9** vocabulary and the assurance claims a Partner must be able to defend.
- The app's sell-it drill generalises to scenario drills: answer a client CISO, a sceptical Partner, a new joiner ("explain why we never demo on production data").

### What does not fit (the practice layer)

Running an ontology canvas, writing a golden-question set that passes Architect review, shipping an SLC tool, shadowing a build, the badge ladder itself. Badges are earned on real work in the existing cadence. The app is the retention engine **between** sessions (Lunch & Learn introduces the flywheel; the app keeps Gate 2 cold three weeks later), never a substitute for the doing.

## Recommended shape when triggered

1. **Second deployment first.** Same codebase as a template, own content folder, own URL and app icon ("Tract In Academy" on each Partner's phone). Zero risk to the existing app, fastest path.
2. **One app, two tracks later,** only if the Academy content proves itself and the team wants a single install. Real product work (track-scoped progress and paths).

## Effort and caveats

- Converting M1 to M9 into courseware: roughly 25 to 40 units (per module: a handful of units, each with plain-language explainers, MCQs with distractors that teach, real-world stakes, a scenario drill). Same known process as the 36 Enterprise Fluency units, including the adversarial QA pass.
- Progress is per-device localStorage. Fine for self-paced study; gives no central view of who has completed what. If the Academy needs completion visibility to enforce "every Partner earns Knowledge Partner", that is a later sync layer, priced separately.
- Some M4/M9 content overlaps Enterprise Fluency Domain 5; reuse with reframing rather than duplicating.

## Why parked

The frame amplifies whatever content it is fed. M1 to M9 are v1 drafts still being proven on real jobs (Sprint 1 test: a Partner who is not Toni ships through the OS). Cards written against draft modules would need rewriting after every correction. Finalise the content, then build once.
