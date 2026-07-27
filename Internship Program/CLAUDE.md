# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repository is

This is a **documentation repository**, not a software codebase. It holds Tract In's internal AI Operating System materials and Sachin's internship working files — no application code, no build system, no tests, no package manager. There is nothing to build, lint, or run. Work here means reading and writing Markdown (and occasionally a single-file HTML reference build), not editing source code.

Prefer `git log` / reading the files directly over relying on any prior summary of "what's here" — the process docs explicitly warn that the paper trail lags the actual builds.

## Layout

- **`AI Operating System/`** — The human-facing map of how Tract In uses AI (`TractIn-AI-Operating-System.md` is the entry point; `modules/M1`–`M9` are the detailed, individually-owned modules: stack, academy, flywheel, guardrails, hub, offer, accelerator, leave-behind, risk & assurance). Deliberately kept thin — the map should never grow into a manual.
- **`Development Process/`** — The reference set for how an idea becomes a working POC and then a productised capability. Read `01-the-challenge.md` first (everything else hangs off it), then `02`–`09` for components, process design, architecture, content scope, tooling, open challenges, the engine-room explainer pattern, and productising the Brain. `the-build-machine.html` is a reference implementation of the "inputs → engine room → outputs" explainer pattern — open it in a browser, don't try to read it as text.
- **`development-process-standards.md`** — A dated decision log (grilling-session outcomes) recording standing calls on process/architecture/tooling. Treat entries here as current policy unless a file's own content contradicts a later date.
- **`Development Skills/`** — Two Tract In build skills as `SKILL.md` files: `blueprint` (design a tool's logic/behaviours before building) and `spinup` (scaffold a branded repo from the `tractin-starter` template). These run in sequence: `/blueprint` decides *what a tool thinks*, `/spinup` decides *the infrastructure it runs on*.
- **`writing-great-skills/`** — The house reference for how to write skills well (`SKILL.md` + `GLOSSARY.md`, itself written as a skill with `disable-model-invocation: true`). Read this before authoring or editing any `SKILL.md`-style file in this repo — it defines the vocabulary (behaviour, mechanism, leading word, progressive disclosure, done-when, etc.) that the other skill files assume.
- **`Sachin's files/`** — Sachin's own internship output on the Atlas build. `Updated files/` is the current/canonical version; `skills/` is an earlier pass at the same four skill specs (the two directories have diverged — check `Updated files/` first unless comparing history). `Updated files/00-prd-chunks.md` and `01-c4-slice-plan.md` scope the work; the four `skill-*.md` files are capability specs written in the house `SKILL.md` pattern.
- **`Atlas.html`** — A large (~1MB) single-file reference build of the Atlas org-mapping tool; the source of truth for existing map/layout/guardrail logic that the Atlas skill specs are grounded in. Don't read it in full — grep/search for the specific logic in question.

## Conventions to follow when editing or adding docs

- **Skill files** (`SKILL.md` or `skill-*.md`) follow a consistent house shape: YAML frontmatter (`name`, `description` with explicit trigger phrases, optionally `disable-model-invocation: true`), a short framing paragraph, a **Method** section broken into numbered moves each ending on an explicit **"Done when"** completion criterion, a **Composes with** section cross-referencing related skills, and a final **Desktop users** one-liner for non-Code users. Match this shape rather than inventing a new template — see `writing-great-skills/SKILL.md` for the underlying rationale.
- **Status artefacts** (blueprints, provisioning checklists, debriefs, configs) open with a `state as of [date], commit [short-sha]` line, because the docs are known to lag the actual build state. Carry this forward on any new status doc.
- Tract In-specific terms recur across these docs and should be used consistently, not re-explained: **flywheel** (the 7-stage curiosity → prototype → challenge → govern → deliver → embed → prove-and-handover loop), **SLC** (Simple, Lovable, Complete — the bar for a prototype), **anti-slop** (always-on quality control, not a runtime safeguard), **signature interaction** (the one moment a tool exists for, required in every blueprint), **archetype** (a named reusable build shape, e.g. the Next.js starter or chat-over-vault).
- Dates in this repository run into 2026 (this is forward-dated planning material) — don't "correct" them.
