# M8 · Context-layer Leave-behind

**Surface:** 2 (what we sell and leave behind), and a bridge module
**Owner:** Toni / Rene
**State:** skill exists and is proven, not packaged for clients
**Last reviewed:** 29 June 2026

**Scope (one line):** the curated knowledge layer we leave inside a client, both as the asset itself and as the substrate the future agentic builds run on.

## What we decided

The capability exists and is proven. The gap is client-facing packaging.

What exists:

- **`/context-layer`** builds and enriches an Obsidian knowledge vault from client documents, with adaptive fidelity and source-cited dossiers. Proven on the oOh!media work.
- **`/improve-brain-architecture`** is the companion that audits an existing brain for thought-flow friction and restructures it before handover.

What the method has matured into (the "compounding substrate" made concrete, proven on oOh! through June 2026, recorded in the skills so every future brain inherits it):

- **A self-maintaining contract.** Each brain ships a `_schema.md` (entity types, frontmatter, naming, signalling, supersession, lint) so the client's own agent maintains it without us, plus a read-only `brain-probe.py` health check.
- **It knows what it can be trusted on.** Five signalling conventions at the point of use, contested, anecdotal, single-source, recency, and (added 29 June) **temporal role**, so an agent can tell a current reading from a 2025 benchmark from an unrealised target, and never quotes a soft number as hard fact. This is the differentiator a buyer feels: the leave-behind does not confidently mis-state stale or aspirational figures.
- **It scales past notes.** High-cardinality operational data lives as queryable structured registers (SQL/DuckDB) routed by a data-spine, so the brain answers "how many / how much / what is at risk" in numbers, not just prose.
- **It does not rot silently.** Supersession is invalidate-not-delete (replaced systems and figures are kept and linked forward), and `owner` / `reviewed` metadata plus a staleness pass surface what is overdue.
- **It has a security gate.** `.claude/standards/BRAIN-SECURITY.md` governs the confidentiality boundary (one brain per client, nothing crosses), where a brain may live, per-person keys, and the handover strip run before a brain leaves. The internal gate we run, portable to the client per [M9](M9-ai-risk-and-assurance.md).

The gap:

- No client-facing way to brief, propose and price a context-layer build as a leave-behind.
- The thesis to make explicit: the context layer is not just a deliverable. It is the substrate the embedded agents read from, so a good one compounds in value after we leave. This is the firm's "assets, not opinions" promise made concrete.

## Draft from

- `.claude/skills/context-layer/`, `.claude/skills/improve-brain-architecture/`
- `.claude/standards/BRAIN-SECURITY.md` (the confidentiality and handover gate)
- The oOh!media vault under `01. Clients/oOh! Media/`

## Definition of done

A brief, a proposal and a pricing wrapper so a context-layer build can be sold and handed over, with the "compounding substrate" thesis stated plainly. Targeted for Sprint 2 (T8).
