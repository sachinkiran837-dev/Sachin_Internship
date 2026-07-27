# Development Process

**Scope:** the reference set for how Tract In gets from an idea to a working POC, and from a bespoke client build to a productised capability.

Compiled 12 July 2026 by the Fable orchestrator from six Opus research passes over the four worked examples (Kinyara process discovery, P3 workforce cost, category strategy creator, oOh! Brain), the existing build skills (`/blueprint`, `/spinup`, `tractin-starter`), and live tooling research verified against July 2026 sources.

## The documents

| # | File | What it covers |
|---|---|---|
| 1 | `01-the-challenge.md` | The problem being solved, the objective, the central tension, and the structural challenges inferred from the worked examples |
| 2 | `02-components.md` | The moving parts of the build capability: seeds, skills, starter, library, brains, eval, provisioning, feedback loop |
| 3 | `03-process-design.md` | The idea-to-POC pipeline stage by stage: what is proven, what is guided, what is manual, what is missing |
| 4 | `04-architecture.md` | Archetypes, the architecture decisions that need a home, house patterns worth standardising, workspace discipline |
| 5 | `05-content-scope.md` | The content layer: what the tools' thinking draws on, what exists, what is thin, and the rules that keep it compounding |
| 6 | `06-tooling.md` | The default primitive kit: platforms, database, email, files, secrets, AI plumbing, NetSuite access, POC hosting hygiene |
| 7 | `07-open-challenges.md` | The open problems, framed as grilling material: process gaps, technical calls, platform decisions, content debt, release gates, commercial questions |
| 8 | `08-engine-room-pattern.md` | The standing inputs / engine room / outputs explainer device: how to make any Tract In capability or process legible as a machine, and how to build one |
| 9 | `09-productising-the-brain.md` | The four threads converging on the Brain as a product (oOh! deployment, internal packaging, commercial vehicle, JMC validation), the one open question they share (post-handover maintenance), and proposed next moves |
| &mdash; | `the-build-machine.html` | The reference implementation of the pattern: the build process itself drawn as Inputs &rarr; six engines &rarr; Outputs. Open in a browser |

## How to use this folder

Read `01-the-challenge.md` first; everything else hangs off it. Take `07-open-challenges.md` into a grilling session (`/grill-me`) or a `/council` run when a decision on the list needs to be made. Facts about the worked examples cite specific files; verify against those files before acting, the builds move faster than their paper trail.

## The worked examples referenced throughout

| Example | What it is | Where |
|---|---|---|
| Kinyara process discovery | The one proven full run of the blueprint-to-spinup pipeline | `01. Clients/Kinyara Health/Demo/` and `/Users/toni/kinyara-process-discovery` (local) |
| P3 workforce cost | A polished one-shot build that bypassed the pipeline | `P3/` at SharePoint root (deliverable archive) and `/Users/toni/p3-workforce` (local, git-tracked working copy from 12 July 2026) |
| Category strategy creator | The single-file HTML seed pattern at its ceiling | `02. Marketing and Propositions/Productised solutions/2. Procurement/Sourcing/build/` |
| oOh! Brain | A knowledge vault awaiting its chat layer, with live ERP data ambitions | `01. Clients/oOh! Media/oOhComOps_Brain_2.0` and `/Users/toni/s4-demo` (local) |
