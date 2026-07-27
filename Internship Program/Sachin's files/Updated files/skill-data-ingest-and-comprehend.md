---
name: data-ingest-and-comprehend
description: Turn a client's raw establishment export into a clean, structured, classified org graph. Covers PRD capability C1.
---

# Skill: Data Ingest and Comprehend

*As at 23 July 2026. Grounded in PRD C1 (Section 6) and a reverse-read of `Internship Program/Atlas.html`'s ingest handling. Companion: `../00-prd-chunks.md`.*

## Purpose

Take one establishment export and turn it into the single-source-of-truth org graph every later capability reads from.

## Inputs

- One establishment export file (CSV or XLSX).
- The canonical position schema (mandatory vs. optional fields — still an open PRD decision).
- A role taxonomy for operating-model classification.

## Steps

1. Parse the file into rows, handling common export shapes from major HR systems.
2. Map columns to the canonical schema: auto-detect the obvious ones, model-suggest mappings for ambiguous ones, human confirms.
3. Build the org graph (positions, reporting lines, hierarchy) — becomes the single source of truth for every later stage.
4. Anonymise names on the way in, on by default.
5. Classify roles from an operating-model lens (function, management vs. individual contributor, clinical vs. corporate) — a model call grounded in the role taxonomy.
6. Attach an inference-confidence score to every derived field, to drive what C2 asks the Project Partner to confirm.

## Outputs

- A validated org graph.
- A column-mapping record.
- A list of low-confidence inferences, handed to C2.

## Edge cases / failure modes

- Orphan records with no resolvable manager: attach to the most likely manager by department, or flag and lift to the top; the Project Partner corrects on the next screen. (Proven pattern in the reference build — it excludes the chief executive from the orphan count.)
- Duplicate position IDs on more than one row: keep the first occurrence, flag the rest.
- A second file offered at ingest (e.g. a cost file) — not yet decided whether Atlas accepts this or treats cost as strictly a later step; don't assume either way.
- An export from an unsupported HR system shape: fail clearly, never silently partial-import.
- Mandatory fields aren't yet defined for the canonical schema (open PRD decision) — until they are, treat every field as needing explicit human confirmation rather than assuming a default.
