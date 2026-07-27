# Atlas

**Scope:** Sachin's working output on the Atlas build — chunking the PRD, the owned end-to-end slice, and the first agentic skill specs, produced for the review of `20260721_Atlas_PRD-Capability-Blueprint_v0.1.docx` (Toni Auburger, draft v0.1, 21 July 2026).

## The documents

| # | File | What it covers |
|---|---|---|
| 0 | `00-prd-chunks.md` | The PRD broken into its main workstreams/chunks, and a build-now vs. build-later call based on repeatability and time |
| 1 | `01-c4-slice-plan.md` | The owned end-to-end slice: C4, Interactive establishment map — inputs, steps, outputs, and what the existing reference build already proves |
| &mdash; | `../skills/skill-org-visualisation.md` | Skill spec for C4, the deepest of the four — grounded in a reverse-read of `Atlas.html`'s actual map, layout and guardrail logic |
| &mdash; | `../skills/skill-data-ingest-and-comprehend.md` | Skill spec for C1 |
| &mdash; | `../skills/skill-scenario-model.md` | Skill spec for C5 |
| &mdash; | `../skills/skill-findings-synthesis.md` | Skill spec closest to C3's narrative layer, adjacent to N1 |

## How to use this folder

Read `00-prd-chunks.md` first; it frames which capability each later document belongs to. Then `01-c4-slice-plan.md` for the owned slice, and the sibling `../skills/` folder for the individual capability specs — `skill-org-visualisation.md` is the most detailed since it's grounded in the reference build, the other three are scoped from the PRD alone and are lighter. Each skill file now follows the house `SKILL.md` pattern (verb-phrase title, Method moves with Done-when criteria, a mechanism table, Composes-with cross-references) rather than a flat template. Source PRD lives at `Internship Program/Atlas.html` (the current single-file reference build) and the PRD docx itself.
