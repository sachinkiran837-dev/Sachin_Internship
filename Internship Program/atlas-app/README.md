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

Everything is normalised to the same CSV shape before ingest, by one of three readers (`lib/ingest/formats.ts` is the registry; `readSource.ts` routes):

| Kind | Formats | How it is read |
| --- | --- | --- |
| **Tables** | `.csv` `.tsv` `.txt` `.psv` `.xlsx` `.xlsm` `.xls` `.ods` `.json` `.xml` `.html` `.htm` | Deterministically. Delimiters are sniffed rather than assumed from the extension; JSON takes a bare array or a `{data: […]}` envelope with nested objects flattened to dotted columns. |
| **Documents** | `.docx` | The largest table in the document. Paragraph prose is ignored on purpose — inferring an establishment from a narrative is guesswork, and a wrong structure that looks right is worse than a refusal. A Word file with no table says so. |
| **PDF** | `.pdf` | Deterministically **wherever the PDF has a text layer** — which is most of them, since a PDF holding establishment data was usually exported from something that already had it as text. `lib/ingest/parsePdf.ts` inflates the content streams, reads each text run with the coordinates it was drawn at (resolving subset fonts through their ToUnicode CMap, without which the text extracts as mojibake), and rebuilds the table by clustering runs into rows by y and columns by x. That is arithmetic, not inference, so it needs no API key and its output is a normal baseline. Only a scan or a drawn chart falls through to the vision reader. |
| **Charts & images** | `.png` `.jpg` `.jpeg` `.webp` `.gif` | Transcribed by a vision model. This is the only path where a model *produces* the data rather than reading someone else's export, so every row it returns is raised as a low-confidence issue on the confirm screen. With no `ANTHROPIC_API_KEY` set the file is refused with a reason — a picture has no honest deterministic fallback. |

What the PDF reader deliberately will **not** do is reconstruct a drawn org chart — boxes joined by connector lines — from its geometry. Deciding who reports to whom by measuring which line touches which box is exactly the plausible-but-wrong import worth refusing, so a PDF with no provable table says which of the two situations it hit ("no text layer, so it is a scan" vs "text, but not laid out as a table"), because those call for completely different things from the person uploading.

The confirm screen states which format was read and what was done to it — the conversion is never silent. Column headers are matched case- and separator-insensitively, so a JSON `reportsTo` and a CSV `Manager ID` both land on the same field.

**One unreadable file never takes the batch down with it.** Upload five files with a PDF Atlas can't parse among them and the other four still ingest; the fifth is reported per-file as "Not used", with the reason, and stays flagged for review. Refusing the whole batch is indistinguishable — to the person uploading — from multi-file upload simply not working.

**Tick the files this run should use.** Every attached file gets a checkbox, and only ticked files are uploaded and ingested. The point is to be able to run the same folder of exports several ways — establishment only, then with payroll joined on, then with last year's vacancy report — without re-attaching anything. The size ceiling applies to what is selected, not to what happens to be attached.

**An upload carries up to 10MB per run, and no single request carries more than 1MB.** This split matters. Next caps a Server Action body at 1MB by default, and a host applies its own limit at its edge — Vercel returns `FUNCTION_PAYLOAD_TOO_LARGE` above ~4.5MB — and *both* reject the request before any application code runs, so neither failure can be seen, logged or explained from inside the app. It just looks like nothing happened. So files no longer travel in the form at all: the browser slices each one into 1MB pieces and posts them to `/api/upload` (`lib/ingest/uploadClient.ts`), which stages them in `upload_chunks`; the Server Action then receives only the ids and reassembles the files. That moves the ceiling from "what one HTTP request can carry" to "what Atlas is willing to accept" — a limit the app can enforce itself, and explain, which is why `MAX_UPLOAD_BYTES` is the number the upload form actually holds you to.

An upload missing a piece is refused rather than reassembled: half a spreadsheet still parses, into a plausible establishment that is quietly missing people. Staged chunks are deleted as soon as the ingest reads them, and anything abandoned is purged after an hour.

**Upload as many files as you have.** Org data rarely arrives as one tidy export: it comes as an establishment list plus a payroll extract plus a vacancy report, each from a different system, each naming the same field differently, and often each covering only part of the organisation. `lib/ingest/bindFiles.ts` works out what each file *is* before deciding what to do with it:

- A **roster** describes positions — it has a title, plus an ID, name or reporting line. Rosters are stacked, so an establishment split by site or division reassembles into one org, and reporting lines resolve across the file boundary.
- An **attribute** file describes facts *about* positions — an ID or name plus columns like cost, FTE or status. These are joined onto the roster rather than appended, so a payroll file can be the only source of salary in the whole upload.
- Anything with no usable key is **unusable** and is reported as such.

Two rules keep this trustworthy. Where an attribute file disagrees with the roster, **the roster wins and the disagreement is counted** — silently overwriting an establishment record with a payroll figure is the kind of invisible edit that destroys trust in every number downstream. And **every file's fate is stated per-file on the confirm screen**, including rows that matched nothing and files that contributed nothing; the failure mode being guarded against is someone uploading five files, seeing a map, and never learning that three were dropped.

Images, and PDFs with nothing but a picture in them, are read by the vision model — and those rows land in the review queue rather than the baseline, because a model reading a picture is the one ingest path that isn't a reading of someone else's export.

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
npx tsx --env-file=.env.local scripts/verify-upload-action.ts  # the real ingestFileAction, single- and multi-file
npx tsx --env-file=.env.local scripts/verify-plays.ts          # all ten redesign plays, with their maths re-checked
npx tsx --env-file=.env.local scripts/verify-binding.ts        # multi-file binding against realistic messy inputs
npx tsx --env-file=.env.local scripts/verify-formats.ts        # Word tables, image routing, and one bad file among good ones
npx tsx --env-file=.env.local scripts/verify-chunked-upload.ts # a 2.8MB file staged in pieces and reassembled
npx tsx scripts/verify-pdf.ts                                  # the deterministic PDF reader (no database needed)
```

Each of these creates real establishments in the real database, so the home page accumulates `verify-run`s. `npx tsx --env-file=.env.local scripts/delete-orgs.ts` lists them without deleting anything; pass ids (short prefixes are fine) or `--all` to clear them.

`verify-binding.ts` builds its fixtures from the demo CSV at run time: an establishment split across two files with different column names, a payroll extract that is the only source of cost anywhere, a status report containing staff who have left, and a file with no key at all. It asserts the halves reassemble without loss or duplication, that cost survives the join into the metrics, that unmatched rows are reported rather than absorbed, that the keyless file is refused loudly, and that reporting lines resolve across the file boundary.

`verify-formats.ts` builds a real `.docx` in memory (there is no zip dependency in this project, so it writes the archive itself, as `parseDocument.ts` reads one) and checks that the establishment table wins over the document's version-history table, that a prose-only Word file is refused with a reason, that images route to the vision reader, and that a batch of four files containing two unreadable ones still produces a working org with its costs intact.

`verify-pdf.ts` writes real PDFs rather than checking fixtures in, so it can't drift from what the reader claims to handle: one in the shape Word and Excel emit (standard font, literal strings) and one with a subset-embedded font (Identity-H hex behind a ToUnicode CMap — the case that extracts as mojibake if the CMap is ignored). It asserts both reconstruct the same six-column table with multi-word names and titles intact, that the headers map to canonical fields like any other source's, that a prose PDF and a text-free scan are each refused with the *right* reason, and that a PDF ends up as a working establishment with correct costs and reporting lines.

`verify-chunked-upload.ts` builds a 2.8MB, 32,000-row establishment, stages it in pieces exactly as the browser does, and checks that it reassembles byte-for-byte, that an upload missing one piece is refused instead of truncated, that the action can ingest from staged ids alone, that every row is either kept or reported as a duplicate, and that the staged bytes are cleared afterwards.

`verify-plays.ts` is the one that keeps the numbers honest: for every play it replays the play's own operations against the diagnostic engine and fails if the claimed saving doesn't equal the sum of the roles it named, if the modelled cost didn't actually move, or if the predicted headcount delta doesn't match what happened.

## AI-assisted vs. deterministic (the visible-fallback pattern)

Three behaviours are AI-shaped: role classification (ingest), the findings narrative, and reading an org chart out of an image or PDF. The first two have a deterministic fallback and run on it — visibly, never silently — unless `ANTHROPIC_API_KEY` is set (see `.env.example`). Neither produces a number a client sees; classification is advisory framing, and the narrative only frames metrics that were already computed deterministically.

Reading a picture is the exception, and is treated as one. There is no honest deterministic fallback for it, so without a key the file is refused with a reason rather than half-read: **on a deployment with no `ANTHROPIC_API_KEY` set, images and text-free PDFs cannot be read** — everything else works, including PDFs that have a text layer, which is most of them. When it is enabled, the model only transcribes what is drawn: it is instructed never to invent a person, a reporting line or a figure, its rows are flagged for review on the confirm screen, and nothing it produces is treated as a confirmed baseline. Everything else (layout, tagging, protected-role guardrails, cost/span/layer metrics, the scenario move parser) is deterministic by design, per the blueprint skill's mechanism-choice discipline — the model is the reader and the drafter, never the calculator.

## Deliberate v1 scope cuts (named, not buried)

- **The named plays are the primary scenario surface**; the free-text move box is kept as a secondary path for changes no play covers. It is regex/keyword-parsed, not a real model call — the scenario-model spec explicitly permits this as a v1 shortcut. Supported phrasings: `flatten <role or department> to N layers`, `merge <department> into <role>`, `remove <role>`, `reassign <role> to <role>`, `add a <title> under <role>`. Anything else returns "couldn't understand this," never a guessed move.
- **Play savings are modelled, not committed.** They price the structure as it stands and assume the released cost is actually removed from budget. Redundancy, notice, transition and change-management costs are out of scope, so these are gross annual figures, not a net first-year business case.
- **The establishment map always shows the org's one active working-copy scenario**, matching the reference build's single-active-scenario contract between C4 and C5. Other named scenarios are created and compared on the Scenarios tab (headcount/cost/layer deltas, safe-staffing flag) but aren't independently visualised on the map in this build.
- **C2 (the dedicated QA/validation loop) wasn't one of the four supplied specs.** Low-confidence inferences and orphan resolutions from ingest are surfaced on the confirm screen for review, but there's no separate correction workflow beyond that.
- **HR export parsing is a generic column-mapper** (auto-detect by header synonym, CSV/XLSX via `xlsx`), not tuned to a specific vendor's export shape.
- **No auth, multi-tenancy, or residency infrastructure** — this is single-session, synthetic-data-only per the house sandbox rule (never real client data in a POC without the deployment gate in `M4-the-guardrails.md`). Fine for a private preview deploy; don't share the URL as-is beyond that.
- **Neon Postgres via the HTTP driver (`drizzle-orm/neon-http`)**, not a persistent connection pool — the simplest fit for Vercel's serverless functions, at the cost of one round trip per query rather than a pooled connection. Writes are therefore batched (`INSERT_BATCH` in `db/repo.ts`): inserting an establishment a row at a time cost one round trip per position, which at a few thousand positions was not slow but a request that never returned. A 9,000-position two-file upload now completes in ~12s end to end, and the ~150-row demo in ~3s. Reads are still one query each; revisit if that ever matters.

## When `tractin-starter` access lands

1. Re-platform onto the starter's auth, module-manifest, and de-brand scaffolding per `../Development Skills/spinup/SKILL.md`. The Neon Postgres swap above already happened, so `db/schema.ts` and `db/client.ts` port over with minimal edits.
2. Everything else — `lib/`, the route tree under `app/org/[orgId]/`, the component tree — ports as-is; none of it is starter-specific.

## Deploying to Vercel

1. Push this repo to GitHub (already done — origin is `sachinkiran837-dev/Sachin_Internship`) and import it in Vercel. Since `atlas-app/` is a subfolder, set the project's **Root Directory** to `Internship Program/atlas-app`.
2. Add environment variables in the Vercel project settings: `DATABASE_URL` (required), `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` (optional — the app runs on its deterministic fallback without them).
3. `predev`/`prebuild` already run `drizzle-kit migrate` against `DATABASE_URL`, so the schema applies automatically on Vercel's build step — no manual migration step needed once the env var is set.
4. Deploy. No further config needed — the app has no other local-filesystem dependencies.
