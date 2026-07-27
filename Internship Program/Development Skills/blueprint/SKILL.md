---
name: blueprint
description: Design the logic of an intelligent tool before building it. Run before /spinup. Triggers: /blueprint, "what does this tool need to think", "LLM or deterministic tool", "map the logic", "what's missing before we build".
---

# /blueprint — Design the logic of an intelligent tool

`/spinup` decides the infrastructure (auth, DB, files, visualisation). `/blueprint` decides the **thinking**: the behaviours a tool performs, how each is implemented, what it draws on, and what is missing. The differentiated half. Run it first; its output drives `/spinup` and the build.

Run blueprint when a tool must do something intelligent with data: read, extract, classify, judge, size, recommend, generate, answer. If the tool only stores and displays, skip to `/spinup`.

This skill is method, not content. It defines how to think about any tool's logic. The domain knowledge a tool draws on lives in the content library (`knowledge/library/`), never here.

---

## Method

Four moves. Each ends on a check that tells you the move is genuinely done, not merely attempted.

### 1. Decompose into behaviours

A **behaviour** is one verb on data with a defined input and output, buildable and testable on its own. Split every "it understands" or "it works out" or "it recommends" until each piece is separately implementable and separately gated. The mega-behaviour is the enemy: it hides its own mechanism choices and cannot be tested.

**Done when** every behaviour is a single verb you could test in isolation, and none still hides two.

### 2. Assign a mechanism

Give each behaviour exactly one **mechanism**. Prefer the cheapest, safest, most auditable option that actually fits. **If you can write the rule, write the rule** — the LLM is the reader and the drafter, never the calculator or the rule engine.

Preference order:

1. **Deterministic tool (code)** — an exact, known rule: calculation, lookup, validation, dedup, threshold, state machine, format. Correct, repeatable, auditable, cheap, testable. (A figure from volumes times a unit rate is arithmetic, never a model.)
2. **Retrieval** — the behaviour needs a fact or asset from a knowledge base. Usually a step inside a larger behaviour, not a behaviour alone.
3. **LLM call** — genuinely linguistic or generative: reading unstructured text, interpreting intent, fuzzy classification, drafting prose. Always with structured output where the result feeds code, always grounded in retrieval, always constrained by deterministic guardrails.
4. **Human-in-the-loop** — high stakes, irreversible, low model confidence, or the value is a person's tacit knowledge. The model proposes, the human disposes.
5. **Hybrid** — most real behaviours: the model proposes, rules constrain and validate, a human confirms the consequential ones, code executes.

The decision questions, in order:

- Is there an exact rule I could write down? → deterministic.
- Does it need a fact or asset from a knowledge base? → add retrieval.
- Is the input unstructured language, or the output interpretive or generative? → LLM, grounded and structured.
- Can being wrong cost money, cause harm, or make a bad client moment? → deterministic guardrails plus a human gate. Never let an ungated LLM do anything consequential.
- Is the point to capture what is in someone's head? → human-in-the-loop is the design, not the fallback.

Anti-patterns to catch, each with its tell:

- An LLM doing arithmetic or applying a known rule. Tell: run it twice on the same input and the answer moves. → push it to code.
- Ungrounded recommendations (invented best practice). Tell: ask for the source and it cannot name one. → ground in a playbook.
- One mega-prompt doing read, extract, classify, size and recommend at once. Tell: you cannot test one part without invoking the whole. → decompose so each is tested and gated.
- No guardrails on client-facing generation. Tell: nothing stops it stating a figure as fact or advising on something regulated. → add the guardrail set.

**Done when** every behaviour has one mechanism and the decision questions are answered for it, not merely asserted.

### 3. Map the content library

For each retrieval or LLM behaviour, name what it draws on and whether it exists. The asset types and where they live are the content library's own reference: `knowledge/library/README.md`. Read it; do not restate it here.

**Done when** every retrieval or LLM behaviour points at named assets, each marked *exists* or *gap*.

### 4. Name the gap

The headline deliverable. List what is missing: behaviours with no mechanism designed, content assets that do not exist, guardrails not yet defined. That list is the build.

**Done when** the gap list is exhaustive against the behaviour table: nothing in the table lacks a mechanism, an asset resolution, and a guardrail decision without also appearing in the gap.

---

## Guardrails and eval

Each LLM behaviour names the guardrails it runs under (`knowledge/library/guardrails/`) and how it is tested. For a client-facing brain, the eval harness is `/qa-brain`.

## Composes with

Blueprint decides the logic; other skills build it. Where present, hand off rather than reinventing a thinner version:

- **`domain-modeling`**: pin the entities and vocabulary a behaviour reads and writes, before any schema exists.
- **`prototype`**: de-risk one uncertain behaviour or state model with a throwaway before committing.
- **`tdd`**: build each behaviour test-first at its seam. A blueprint behaviour is a tdd seam.
- **`/spinup`**: scaffold the infrastructure the behaviours run on.

## Output

Write a Logic Blueprint. Save to `01. Clients/[client]/[project]/` for client work, or `knowledge/` for a reusable tool. Then hand it to `/spinup`: the mechanism choices set the capability toggles, the content map sets what the build wires in.

Name the **signature interaction** explicitly: the one moment the tool exists for. It is the most under-budgeted part of any build and the thing most likely to be left stubbed at handover, so making it a named field means its absence is a visible defect. Open the blueprint (and any status artefact) with a `state as of [date], commit [short-sha]` line so a reader always knows which state the paper describes; the paper trail is known to lag the code.

```markdown
# Logic Blueprint: [tool]

_State as of [date], commit [short-sha]._

**Signature interaction (required):** [the one moment the tool exists for, in one sentence — the single thing a user does that is the whole point (live assumption editing, the swimlane correction, the one question the brain answers). `/spinup`'s handover stub ledger must later declare this built or stubbed, so its absence at handover is a visible defect, not a surprise.]

## Behaviours
| # | Behaviour | Mechanism | Inputs → Outputs | Draws on | Guardrails | Tested by |
|---|---|---|---|---|---|---|

## Content library map
| Asset needed | Type | Exists? | Gap / build |
|---|---|---|---|

## The gap (the headline — what to build)
- Missing logic: [behaviours with no mechanism designed]
- Missing content: [assets that do not exist]
- Missing guardrails: [rules not yet defined]

## Architecture narrative
[One paragraph: the flow from input to output, where the LLM is used and where it is not, where the human gates.]
```

---

## Desktop users

Say: "Blueprint the logic for this tool. Break it into behaviours, decide for each whether it is a deterministic tool, an LLM call, retrieval, or needs a human, map what knowledge each draws on, and tell me what is missing and has to be built."
