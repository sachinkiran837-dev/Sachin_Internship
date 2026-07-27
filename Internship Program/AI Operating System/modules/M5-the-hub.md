# M5 · The Hub

**Surface:** 1 (how TractIn works)
**Owner:** Toni
**State:** built, index it
**Last reviewed:** 28 June 2026

**Scope (one line):** the shared AI workspace itself, so a human knows what is in it and when to reach for each part.

## What we decided

The hub is built. This module does not create anything new. It makes the machine-facing layer legible to a person.

What exists:

- **CLAUDE.md** routing and behavioural rules (the machine twin of this operating system).
- **27 skills** including the engagement pipeline (kickoff, discover, brief, pack), the five founder voices, the intelligence and review skills (wiki, critique, council, brainstorm), and the context-layer tooling.
- **Five founder voices:** Toni, Rob, Kim, Rene, Caitlin.
- **The wiki:** clients, stakeholders, decisions, log, schema.
- **Context-layer tooling:** `/context-layer` (build and enrich) and `/improve-brain-architecture` (audit and restructure).
- **Templates:** proposal, client-update, meeting-brief, capability-statement, decision-brief.

## Draft from

- `.claude/CLAUDE.md`, `.claude/skills/`, `.claude/context/`, `.claude/knowledge/`
- `wiki/`

## Definition of done

A one-page "what is in the hub and when to use it" written for a person, not the agent, that points back to CLAUDE.md for the machine detail.
