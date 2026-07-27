---
name: data-ingest-and-comprehend
description: Turn a client's raw establishment export into a clean, structured, classified org graph. Atlas capability C1.
---

# data-ingest-and-comprehend — Turn a raw export into the confirmed org graph

The entry point of the pipeline: parses a client's establishment export and produces the single-source-of-truth graph that `org-visualisation`, `scenario-model` and `findings-synthesis` all read from. Run first, before any other Atlas skill.

## Purpose

Take one establishment export and turn it into the graph every later capability reads from.

## Inputs

- One establishment export file (CSV or XLSX).
- The canonical position schema — confirmed from the reference build's actual mapping logic, not an open question:

  | Field | Required? | Fallback if missing |
  |---|---|---|
  | `id` | Required | None — no unique ID, no graph |
  | `managerId` | Required (one root row may be blank) | None — unresolved rows are flagged as orphans |
  | `title` | Strongly required | Role classification and protected-role matching both degrade to guesses without it |
  | `name` | Optional | Anonymised by default regardless |
  | `grade`, `function`, `businessUnit`, `workforceGroup`, `site` | Optional | Labelled "Unassigned" / "Unspecified" |
  | `status` | Optional | Assumed filled if absent |
  | `cost` | Optional | Estimated from a cost-band-by-level lookup on hierarchy depth, and flagged as estimated |
  | `fte` | Optional | Defaults to 1 |
  | `employmentType` | Optional | Defaults to "permanent" |
  | `startDate` | Optional | No tenure computed, so key-person-risk flagging is unavailable for that row |

  Column auto-detection is regex-based against common phrasings (e.g. "Reports To ID," "Supervisor ID," and "Manager ID" all resolve to `managerId`), not exact header names — real-world naming variance is already handled, not a fresh problem.
- A role taxonomy for operating-model classification.

## Method

1. **Parse.** Parse the file into rows, handling common export shapes from major HR systems. **Done when** every row maps to exactly one parsed record, with unparseable rows explicitly flagged, never dropped.
2. **Map columns.** Auto-detect the obvious columns, model-suggest mappings for ambiguous ones, human confirms. **Done when** every column is either mapped to a canonical field or explicitly marked unmapped, none silently ignored.
3. **Build the graph.** Construct positions, reporting lines, hierarchy. **Done when** every position has a resolvable path to the root, or is explicitly flagged as an orphan.
4. **Anonymise.** Strip names on the way in, on by default. **Done when** no name reaches any later stage unless anonymisation was explicitly turned off.
5. **Classify.** Classify roles from an operating-model lens (function, management vs. individual contributor, clinical vs. corporate), grounded in the role taxonomy. **Done when** every position has a classification or an explicit low-confidence flag, never a silent guess.
6. **Score confidence.** Attach an inference-confidence score to every derived field. **Done when** every inferred (not verbatim) field carries a confidence score the QA step can act on.

## Mechanism map

| Behaviour | Mechanism | Note |
|---|---|---|
| Parse file | Deterministic | CSV/XLSX |
| Column mapping | Hybrid | Auto-detect + model suggestion + human confirm |
| Build graph | Deterministic | Single source of truth downstream |
| Anonymise | Deterministic | On by default |
| Classify roles | Model call + retrieval | Grounded on a role taxonomy |
| Confidence scoring | Hybrid | Drives what QA asks the human to confirm |

## Outputs

- A validated org graph.
- A column-mapping record.
- A list of low-confidence inferences, handed to the QA step.

## Edge cases / failure modes

- Orphan records with no resolvable manager: attach to the most likely manager by department, or flag and lift to the top; the Project Partner corrects on the next screen. (Proven pattern in the reference build, which excludes the chief executive from the orphan count.)
- Duplicate position IDs on more than one row: keep the first occurrence, flag the rest.
- A second file offered at ingest (e.g. a cost file): not yet decided whether Atlas accepts this or treats cost as strictly a later step — don't assume either way.
- An export from an unsupported HR system shape: fail clearly, never silently partial-import.
- `id` or `managerId` missing or unusable across most of the file: this isn't a low-confidence case, it's a hard stop — there's no graph to build without them.
- `title` missing or too sparse to trust: role classification and protected-role detection should visibly degrade (flag low confidence), never silently guess a safety-critical tag.

## Composes with

- **`org-visualisation`**, **`scenario-model`**, **`findings-synthesis`**: all read the graph this skill produces.
- Hands its low-confidence list to a QA step (PRD capability C2) — not yet its own skill spec in this set.
