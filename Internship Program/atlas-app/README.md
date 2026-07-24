# Atlas (POC candidate)

_State as of 2026-07-24._ A working slice of Atlas — org-mapping and redesign-scenario tool — built directly from the four skill specs in `../Sachin's files/Updated files/`: ingest & comprehend (C1), org visualisation (C4), scenario modelling (C5), and findings synthesis (C3's narrative layer), plus the shared deterministic diagnostic engine (C3) they both depend on.

**Scope tier:** POC candidate, per the three-tier scope gate in `../development-process-standards.md` — not a one-off demo, not yet a product bet.

## Run it

No external services required — everything runs locally against a bundled SQLite database.

```bash
npm install
npm run dev
```

Open http://localhost:3000, tick "use the synthetic demo export" (a fictional org, Meridian Health Services, at `db/seed-data/sample-establishment.csv`), and ingest it. From there: confirm the ingest, open the establishment map, drag a role to reassign it, model a typed scenario move, and read the findings.

`npm run build` and `npm run typecheck` both run clean. `npm run dev`/`npm run build` apply any pending database migrations automatically first (`predev`/`prebuild` hooks run `drizzle-kit migrate`).

### Verify the pipeline end-to-end

Two scripts exercise the real code paths (not just the UI) against the actual database:

```bash
npx tsx scripts/verify-pipeline.ts       # ingest -> tag -> guardrails -> mutate -> findings
npx tsx scripts/verify-upload-action.ts  # calls the real ingestFileAction server action
```

## AI-assisted vs. deterministic (the visible-fallback pattern)

Two behaviours are AI-shaped: role classification (ingest) and the findings narrative. Both have a deterministic fallback and run on it — visibly, never silently — unless `ANTHROPIC_API_KEY` is set (see `.env.example`). Neither AI path ever produces a number a client sees; classification is advisory framing, and the narrative only frames metrics that were already computed deterministically. Everything else (layout, tagging, protected-role guardrails, cost/span/layer metrics, the scenario move parser) is deterministic by design, per the blueprint skill's mechanism-choice discipline — the model is the reader and the drafter, never the calculator.

## Deliberate v1 scope cuts (named, not buried)

- **Plain-English scenario moves are regex/keyword-parsed**, not a real model call — the scenario-model spec explicitly permits this as a v1 shortcut. Supported phrasings: `flatten <role or department> to N layers`, `merge <department> into <role>`, `remove <role>`, `reassign <role> to <role>`, `add a <title> under <role>`. Anything else returns "couldn't understand this," never a guessed move.
- **The establishment map always shows the org's one active working-copy scenario**, matching the reference build's single-active-scenario contract between C4 and C5. Other named scenarios are created and compared on the Scenarios tab (headcount/cost/layer deltas, safe-staffing flag) but aren't independently visualised on the map in this build.
- **C2 (the dedicated QA/validation loop) wasn't one of the four supplied specs.** Low-confidence inferences and orphan resolutions from ingest are surfaced on the confirm screen for review, but there's no separate correction workflow beyond that.
- **HR export parsing is a generic column-mapper** (auto-detect by header synonym, CSV/XLSX via `xlsx`), not tuned to a specific vendor's export shape.
- **No auth, multi-tenancy, or residency infrastructure** — this is local-only, single-session, synthetic-data-only per the house sandbox rule (never real client data in a POC without the deployment gate in `M4-the-guardrails.md`).
- **SQLite instead of Neon Postgres.** `tractin-starter` access (Next.js + Drizzle + Tailwind + shadcn — the same stack this app already uses) wasn't available yet when this was built. `db/schema.ts` is plain Drizzle, so swapping the driver from `better-sqlite3` to `@neondatabase/serverless`/`pg` is a driver-and-config change, not a schema rewrite.

## When `tractin-starter` access lands

1. Swap the SQLite driver for Neon Postgres in `db/client.ts` and `drizzle.config.ts` (dialect `postgresql`); `db/schema.ts`'s table definitions carry over with minimal edits.
2. Re-platform onto the starter's auth, module-manifest, and de-brand scaffolding per `../Development Skills/spinup/SKILL.md`.
3. Everything else — `lib/`, the route tree under `app/org/[orgId]/`, the component tree — ports as-is; none of it is SQLite- or starter-specific.
