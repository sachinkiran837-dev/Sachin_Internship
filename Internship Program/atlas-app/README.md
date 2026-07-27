# Atlas (POC candidate)

_State as of 2026-07-24._ A working slice of Atlas — org-mapping and redesign-scenario tool — built directly from the four skill specs in `../Sachin's files/Updated files/`: ingest & comprehend (C1), org visualisation (C4), scenario modelling (C5), and findings synthesis (C3's narrative layer), plus the shared deterministic diagnostic engine (C3) they both depend on.

**Scope tier:** POC candidate, per the three-tier scope gate in `../development-process-standards.md` — not a one-off demo, not yet a product bet.

## Run it

Needs a Postgres database — create a free project at [neon.tech](https://neon.tech), copy `.env.example` to `.env.local`, and set `DATABASE_URL` to its connection string.

```bash
npm install
npm run dev
```

Open http://localhost:3000, tick "use the synthetic demo export" (a fictional org, Meridian Health Services, ~150 positions at `db/seed-data/meridian-full-establishment.csv` — heavy on frontline nursing/care and contractor roles, with realistic messiness: mixed casing, currency formats, a duplicate ID and an orphan record that the ingest-confirm screen surfaces), and ingest it. From there: confirm the ingest, open the establishment map, drag a role to reassign it, model a typed scenario move, and read the findings.

A smaller, clean 45-row fixture (`db/seed-data/sample-establishment.csv`) still exists purely for `scripts/verify-pipeline.ts`'s exact-count assertions — it isn't wired into the UI. Regenerate the full dataset with `npx tsx scripts/generate-meridian-full.ts`.

`npm run build` and `npm run typecheck` both run clean. `npm run dev`/`npm run build` apply any pending database migrations automatically first (`predev`/`prebuild` hooks run `drizzle-kit migrate`).

### Verify the pipeline end-to-end

Two scripts exercise the real code paths (not just the UI) against the actual database. `next dev`/`next build` and `drizzle-kit` load `.env.local` automatically, but these standalone scripts don't go through either, so pass `--env-file` explicitly:

```bash
npx tsx --env-file=.env.local scripts/verify-pipeline.ts       # ingest -> tag -> guardrails -> mutate -> findings
npx tsx --env-file=.env.local scripts/verify-upload-action.ts  # calls the real ingestFileAction server action
```

## AI-assisted vs. deterministic (the visible-fallback pattern)

Two behaviours are AI-shaped: role classification (ingest) and the findings narrative. Both have a deterministic fallback and run on it — visibly, never silently — unless `ANTHROPIC_API_KEY` is set (see `.env.example`). Neither AI path ever produces a number a client sees; classification is advisory framing, and the narrative only frames metrics that were already computed deterministically. Everything else (layout, tagging, protected-role guardrails, cost/span/layer metrics, the scenario move parser) is deterministic by design, per the blueprint skill's mechanism-choice discipline — the model is the reader and the drafter, never the calculator.

## Deliberate v1 scope cuts (named, not buried)

- **Plain-English scenario moves are regex/keyword-parsed**, not a real model call — the scenario-model spec explicitly permits this as a v1 shortcut. Supported phrasings: `flatten <role or department> to N layers`, `merge <department> into <role>`, `remove <role>`, `reassign <role> to <role>`, `add a <title> under <role>`. Anything else returns "couldn't understand this," never a guessed move.
- **The establishment map always shows the org's one active working-copy scenario**, matching the reference build's single-active-scenario contract between C4 and C5. Other named scenarios are created and compared on the Scenarios tab (headcount/cost/layer deltas, safe-staffing flag) but aren't independently visualised on the map in this build.
- **C2 (the dedicated QA/validation loop) wasn't one of the four supplied specs.** Low-confidence inferences and orphan resolutions from ingest are surfaced on the confirm screen for review, but there's no separate correction workflow beyond that.
- **HR export parsing is a generic column-mapper** (auto-detect by header synonym, CSV/XLSX via `xlsx`), not tuned to a specific vendor's export shape.
- **No auth, multi-tenancy, or residency infrastructure** — this is single-session, synthetic-data-only per the house sandbox rule (never real client data in a POC without the deployment gate in `M4-the-guardrails.md`). Fine for a private preview deploy; don't share the URL as-is beyond that.
- **Neon Postgres via the HTTP driver (`drizzle-orm/neon-http`)**, not a persistent connection pool — the simplest fit for Vercel's serverless functions, at the cost of one round trip per query rather than a pooled connection. Revisit if query volume ever makes that matter.

## When `tractin-starter` access lands

1. Re-platform onto the starter's auth, module-manifest, and de-brand scaffolding per `../Development Skills/spinup/SKILL.md`. The Neon Postgres swap above already happened, so `db/schema.ts` and `db/client.ts` port over with minimal edits.
2. Everything else — `lib/`, the route tree under `app/org/[orgId]/`, the component tree — ports as-is; none of it is starter-specific.

## Deploying to Vercel

1. Push this repo to GitHub (already done — origin is `sachinkiran837-dev/Sachin_Internship`) and import it in Vercel. Since `atlas-app/` is a subfolder, set the project's **Root Directory** to `Internship Program/atlas-app`.
2. Add environment variables in the Vercel project settings: `DATABASE_URL` (required), `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` (optional — the app runs on its deterministic fallback without them).
3. `predev`/`prebuild` already run `drizzle-kit migrate` against `DATABASE_URL`, so the schema applies automatically on Vercel's build step — no manual migration step needed once the env var is set.
4. Deploy. No further config needed — the app has no other local-filesystem dependencies.
