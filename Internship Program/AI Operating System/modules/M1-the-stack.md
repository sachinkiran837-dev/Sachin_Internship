# M1 · The Stack

**Surface:** 1 (how TractIn works)
**Owner:** Toni + Kim
**State:** drafted v1, critiqued (28 June 2026)
**Last reviewed:** 28 June 2026

**Scope (one line):** the tools every Project Partner uses, in tiers, with a setup checklist, so anyone can get working at the level their role needs in under an hour.

## Which tier does my role enter at

Three tiers. Start where your role sits, climb when the work asks for it.

| Your role | You enter at | Why |
|---|---|---|
| Senior strategy Partner, non-technical | Floor | Run council, critique and a context-layer interview without ever opening VS Code |
| Partner who wants to build | Build | The standard build environment. Required, not optional, the moment work touches real client data or ships |
| The technical core (one or two to start) | Architect | Cloud reference architectures and the permissions trust boundary, learned on real builds |

You are never stuck at a tier. The stack tiers are the academy tiers (M2): you climb as you learn.

## What the stack is

Claude is the spine. Everyone works on Claude first. The build layer is multi-model: builders route through OpenRouter to the cheapest model that passes the evaluation set, so cost falls without the quality dropping.

Two rules that do not bend, both council-tested:

- **Method versus substrate.** The stack is the substrate, and it is swappable. The method ports across models, the performance does not. We standardise internally on Claude and stay portable for a client who mandates another platform, but a weaker or client-mandated model is re-tuned and re-proven against the evaluation set before anything ships. Portable means we do not start over. It does not mean the same result on every model.
- **The OpenRouter restriction.** Cheapest-model routing is for sandbox and synthetic data only. Production work on real client data runs on vetted, zero-retention endpoints (the provider stores none of the client's data). This is the same line drawn in M4.

## Setup checklist by tier

### Floor (Tier 0, everyone): about 15 minutes

For every Partner, technical or not.

1. Install the Claude desktop app, or sign in at claude.ai.
2. Get hub access: the shared `.claude` skills (the founder voices, `/council`, `/critique`, the templates). Ask Toni for the repo or SharePoint link.
3. Read the F2 quality discipline in M4 (TRUE, SOUND, TAILORED, OURS). It is the floor for everything you send.

Check it works: run `/critique` on a paragraph, and `/council` on a real question. If both return a verdict, you are set up.

### Build (Tier 1, when you climb, required when you touch real client data): under an hour

Install in this order:

1. **Git** (version control, your undo button and your backup).
2. **Node.js** (the runtime most builds need).
3. **VS Code** (or Cursor, a VS Code fork built for AI work).
4. **Claude Code** (the standard build environment, run inside VS Code).

Request these accounts:

- **GitHub** (where code lives; ask for the org account).
- **Anthropic API key** (request the organisation credential, do not buy your own).
- **OpenRouter**, with at least $5 of credit (multi-model routing).
- **Vercel** (where builds are deployed, linked to GitHub).

Configure the keys safely:

- Put every API key in a local `.env` file (a plain file that holds your secret keys).
- Add `.env` to `.gitignore` (the list of files Git must never upload). Keys never go to GitHub. This one is not optional.

Add the three MCP plugins (MCP is the standard that lets Claude Code reach outside tools):

- **Context7** (pulls live, current API docs so the model is not guessing from memory).
- **Playwright** (drives a real browser to test the build on mobile and desktop).
- **Superpowers** (enforces the build sequence: brainstorm, clarify, test cases, then code).

Check it works: ship a hello-world build through the four-phase flow, chat to scope it, design, code, then deploy to Vercel. If the deployed link loads, you are set up.

Stuck on a step? The click-by-click install is in the F1 Playbook (linked under *Draft from* below). This page is the map, not the manual.

### Architect (Tier 2, the technical core): by apprenticeship, not in an hour

Everything in Build, plus the three things that decide whether an enterprise rollout survives:

- **Cloud reference architectures** for the platforms clients actually run: AWS, Microsoft 365, Google.
- **The permissions trust boundary** (the line that controls exactly what data and systems an agent is allowed to touch). This is the part that kills enterprise rollouts when it is wrong.
- **Architecture-tier and pattern selection.** Choose and defend where a build sits across the three architecture tiers (Foundation: memory and knowledge; Workflow: planner and orchestrator; Autonomous: agents, tools and APIs) and which structural pattern it follows (single, vertical, horizontal, or self-organising), under a control band (human-in-the-loop, guardrails, evaluation, observability) that applies to every pattern and tightens as autonomy rises. The right pattern is the one the client can govern, not the most advanced one. These tier and pattern names are a field reference model we cite, not TractIn's coinage; what is ours is the method on top, model-agnostic with evaluation and observability built in. Today we deliver Foundation-tier work; Workflow and Autonomous are the stated frontier (M2). Full detail and the one-pager: the Academy curriculum and `02. Marketing and Propositions/Frameworks/agentic-patterns.html`.

Do not confuse these architecture tiers (what you build) with the stack tiers above (who builds, and at what level of tooling). Both come in threes; they are different axes.

This tier is earned on real builds with someone who has done it, not from a checklist.

## Getting set up versus getting good

This page gets your tools working, in under an hour at Floor or Build. It does not make you fluent. Fluency is the Academy (M2), measured in days and real builds, not minutes. Do not confuse the two: a working stack is the start line.

## Draft from

- F1 materials: `04. HR and Training/03. Training Sessions/1. 26 May - AI builder training by JC/`
- The tier ladder in `04. HR and Training/03. Training Sessions/AI-Academy-Knowledge-Builder-Curriculum.md`

## Definition of done

Met: a one-pager a new Partner can follow to get set up at their tier in under an hour, with a one-line guide to which tier each role enters at.
