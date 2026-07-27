# Atlas (POC candidate)

_State as of 2026-07-24._ A working slice of Atlas — org-mapping and redesign-scenario tool — built directly from the four skill specs in `../Sachin's files/Updated files/`: ingest & comprehend (C1), org visualisation (C4), scenario modelling (C5), and findings synthesis (C3's narrative layer), plus the shared deterministic diagnostic engine (C3) they both depend on.

**Scope tier:** POC candidate, per the three-tier scope gate in `../development-process-standards.md` — not a one-off demo, not yet a product bet.

## Run it

Needs a Postgres database — create a free project at [neon.tech](https://neon.tech), copy `.env.example` to `.env.local`, and set `DATABASE_URL` to its connection string.

```bash
npm install
npm run dev
```

Open http://localhost:3000, tick "use the synthetic demo export" (a fictional org, Meridian Health Services, ~150 positions at `db/seed-data/meridian-full-establishment.csv` — heavy on frontline nursing/care and contractor roles, with realistic messiness: mixed casing, currency formats, a duplicate ID and an orphan record that the ingest-confirm screen surfaces), and ingest it. From there: confirm the ingest, open the establishment map, drag a role to reassign it, run a redesign play from the Scenarios tab, and read the findings.

### Uploading your own data

Any tabular export is normalised to the same CSV shape before ingest — spreadsheets (`.xlsx`/`.xlsm`/`.xls`/`.ods`), delimited text (`.csv`/`.tsv`/`.txt`/`.psv`, with the delimiter sniffed rather than assumed from the extension), `.json` (bare array or `{data: [...]}` envelope, nested objects flattened to dotted columns), `.xml`, and HTML tables. The confirm screen states which format was read and what was done to it — the conversion is never silent. Column headers are matched case- and separator-insensitively, so a JSON `reportsTo` and a CSV `Manager ID` both land on the same field.

PDF is deliberately not supported: table extraction from PDF is unreliable enough that it would import a plausible-looking but wrong establishment, which is worse than refusing the file.

### Redesign plays (Scenarios tab)

The Scenarios tab offers ten named plays rather than a free-text box. Each one answers a question a client actually asks, finds its own candidates in this org's graph, and prices them deterministically from the org's own data — see `lib/scenario/plays.ts`. Every rate a play can't observe lives in `config/scenario-assumptions.json` and is named in the play's stated method.

Savings are labelled by *nature*, because a client will hold you to the difference:

- **Cost out** — roles leave the establishment (pass-through layers, sub-scale team consolidation, closeable vacancies, shadow deputies, deep-chain links, management-ratio surplus).
- **Cost rebase** — headcount unchanged, the same work bought cheaper (agency premium conversion, in-housing outsourced clusters).
- **Cost avoidance** — nothing is cut; a hire that would otherwise be needed doesn't happen (wide-span redistribution).

Two disciplines are built in rather than left to the reader. Agency conversion banks only the *premium* over the org's own permanent benchmark, never the whole role — counting the full role is the usual way these business cases overstate themselves. And the plays overlap deliberately (the same thin-span manager appears in several), so they are presented as alternative lenses and their savings must not be summed; the UI says so.

Guardrails distinguish *structural* moves (removing or reassigning a role — clinical roles are off limits) from *commercial* ones (changing only what a role costs — a clinical flag is not a reason to block, since the roster is untouched). Protected roles are out of scope for both, and every play still executes through the same mutation entry point, so the guardrail is enforced per operation rather than trusted to the play.

A smaller, clean 45-row fixture (`db/seed-data/sample-establishment.csv`) still exists purely for `scripts/verify-pipeline.ts`'s exact-count assertions — it isn't wired into the UI. Regenerate the full dataset with `npx tsx scripts/generate-meridian-full.ts`.

`npm run build` and `npm run typecheck` both run clean. `npm run dev`/`npm run build` apply any pending database migrations automatically first (`predev`/`prebuild` hooks run `drizzle-kit migrate`).

### Verify the pipeline end-to-end

Two scripts exercise the real code paths (not just the UI) against the actual database. `next dev`/`next build` and `drizzle-kit` load `.env.local` automatically, but these standalone scripts don't go through either, so pass `--env-file` explicitly:

```bash
npx tsx --env-file=.env.local scripts/verify-pipeline.ts       # ingest -> tag -> guardrails -> mutate -> findings
npx tsx --env-file=.env.local scripts/verify-upload-action.ts  # calls the real ingestFileAction server action
npx tsx --env-file=.env.local scripts/verify-plays.ts          # all ten redesign plays, with their maths re-checked
```

`verify-plays.ts` is the one that keeps the numbers honest: for every play it replays the play's own operations against the diagnostic engine and fails if the claimed saving doesn't equal the sum of the roles it named, if the modelled cost didn't actually move, or if the predicted headcount delta doesn't match what happened.

## AI-assisted vs. deterministic (the visible-fallback pattern)

Two behaviours are AI-shaped: role classification (ingest) and the findings narrative. Both have a deterministic fallback and run on it — visibly, never silently — unless `ANTHROPIC_API_KEY` is set (see `.env.example`). Neither AI path ever produces a number a client sees; classification is advisory framing, and the narrative only frames metrics that were already computed deterministically. Everything else (layout, tagging, protected-role guardrails, cost/span/layer metrics, the scenario move parser) is deterministic by design, per the blueprint skill's mechanism-choice discipline — the model is the reader and the drafter, never the calculator.

## Deliberate v1 scope cuts (named, not buried)

- **The named plays are the primary scenario surface**; the free-text move box is kept as a secondary path for changes no play covers. It is regex/keyword-parsed, not a real model call — the scenario-model spec explicitly permits this as a v1 shortcut. Supported phrasings: `flatten <role or department> to N layers`, `merge <department> into <role>`, `remove <role>`, `reassign <role> to <role>`, `add a <title> under <role>`. Anything else returns "couldn't understand this," never a guessed move.
- **Play savings are modelled, not committed.** They price the structure as it stands and assume the released cost is actually removed from budget. Redundancy, notice, transition and change-management costs are out of scope, so these are gross annual figures, not a net first-year business case.
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
