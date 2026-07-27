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
| **Tables** | `.csv` `.tsv` `.txt` `.psv` `.xlsx` `.xlsm` `.xls` `.ods` `.json` `.xml` `.html` `.htm` | Deterministically. Delimiters are sniffed rather than assumed from the extension; JSON takes a bare array or a `{data: […]}` envelope with nested objects flattened to dotted columns. **Every sheet of a workbook is read**, and the header row is found rather than assumed — see below. |
| **Documents** | `.docx` | The largest table in the document. Paragraph prose is ignored on purpose — inferring an establishment from a narrative is guesswork, and a wrong structure that looks right is worse than a refusal. A Word file with no table says so. |
| **PDF** | `.pdf` | Deterministically **wherever the PDF has a text layer** — which is most of them, since a PDF holding establishment data was usually exported from something that already had it as text. `lib/ingest/parsePdf.ts` inflates the content streams, reads each text run with the coordinates it was drawn at (resolving subset fonts through their ToUnicode CMap, without which the text extracts as mojibake), and rebuilds the table by clustering runs into rows by y and columns by x. That is arithmetic, not inference, so it needs no API key and its output is a normal baseline. Only a scan or a drawn chart falls through to the vision reader. |
| **Charts & images** | `.png` `.jpg` `.jpeg` `.webp` `.gif` | Transcribed by a vision model. This is the only path where a model *produces* the data rather than reading someone else's export, so every row it returns is raised as a low-confidence issue on the confirm screen. With no `ANTHROPIC_API_KEY` set the file is refused with a reason — a picture has no honest deterministic fallback. |

**An org chart usually arrives as a slide deck**, not a single drawing: a cover, then one sub-chart per page, each headed by someone who also appeared on an earlier page. Atlas records which page every box, line and word came from, resolves each page's hierarchy on its own, and then joins the pages the way the deck itself does — by the repeated person at the top of each one. Linking it as a single drawing instead parents a box on page 4 to whatever happens to sit above it on page 3, which is an artefact of two slides sharing a coordinate space rather than a reporting line. Page furniture — page numbers, the cover, a values statement, a section heading — is dropped before anything is linked, or the cover becomes the chief executive and everyone reports to a page number.

Box labels are read from **both ends**. Charts lead with the name about as often as they lead with the title, titles wrap onto two or three lines before the name appears, and a box for a team lists one title over half a dozen people. So the names are taken as the trailing run of name-like lines and whatever sits above them is the job — which reads "Community Engagement / Manager / Zoe Cukier" without mistaking the department for a person, and reads a team box as the several positions it is. Assuming the first line was the name cost *every* name on a real client chart, leaving the reporting lines correct and nobody to attach them to.

**A PDF that is a drawn chart rather than a table is read too** (`lib/ingest/parsePdfChart.ts`). The same pass that extracts text also extracts the page's rectangles and line segments, so the boxes are found by which text sits inside which rectangle, and the reporting lines by following the elbow connectors: segments sharing endpoints form one connector network, and a network leaving one box from underneath and arriving at others from on top states a reporting relationship. Charts drawn with no followable connectors fall back to layout — rows of boxes down the page, each reporting to the box above it that spans it — and the report says which of the two was used, because they are not equally strong.

This is inference, not arithmetic, and is labelled as such: rows from a drawn chart are flagged for review exactly like rows transcribed by a model. It also refuses to produce a *partial* structure — if the geometry resolves into several disconnected trees rather than one hierarchy, it says so and names the orphaned boxes rather than importing whichever half it managed, because several disconnected trees usually means the connectors weren't understood, not that the organisation has several heads.

A drawn chart lays its boxes out in a grid, so its text lines up in rows and columns exactly as a table's does, and the column detector will happily read a structure chart as a three-row table. Evidence from the drawing — connectors that resolve, or boxes each holding several lines of text — therefore outranks that coincidence of alignment; a table cell holds one value, a chart box holds a name over a title.

Where neither reading holds, the refusal says which situation it hit ("no text layer, so it is a scan" vs "text, but neither a table nor a chart"), because those call for completely different things from the person uploading.

The confirm screen states which format was read and what was done to it — the conversion is never silent. Column headers are matched case- and separator-insensitively, so a JSON `reportsTo` and a CSV `Manager ID` both land on the same field.

### What a real export looks like, and what Atlas does about it

Four things about real client files break a reader that assumes a tidy CSV. Each is handled deterministically, stated on the confirm screen, and pinned by `scripts/verify-messy-sources.ts` — which rebuilds every case as a fixture, because the client's own files can't be committed.

- **A workbook is one sheet per brand, per site, per month.** Reading only the first is how an establishment quietly loses two thirds of its people. Sheets that share a header shape are stacked into one table, with a `Source sheet` column added when they are — often the only record of which brand a row belongs to. Sheets with a *different* shape are a different table, and are named as left out rather than forced together.
- **The header row is not row 1.** Exports open with a title, a "single source of truth" note and a blank line as often as not, and taking row 1 as the header turns every column into `__EMPTY_7`. Atlas finds the row that names the columns — wide, distinct words rather than figures, with data underneath it — and reports how many rows it skipped. Ties go to the earliest row, so a file whose header genuinely is row 1 behaves exactly as before.
- **The columns an org map needs may not exist in the file.** A name split across `FirstName` and `Surname` is joined into one column, or every position carries only a first name and nothing can be matched to it. Composed columns are *added*, never substituted: the originals stay visible on the confirm screen. Where the file has the pieces but not the meaning — an hourly rate with no statement of how many hours it is paid for — nothing is composed. Atlas leaves the cost empty and asks, because a plausible figure nobody can trace is worse to a client than a visible gap.
- **"Cost" means opposite things in different systems.** Atlas prices a position as cost × FTE, which assumes the cost column holds a full-time rate. Plenty of exports instead hold what someone is actually paid, already reduced for their hours — and multiplying *that* by their FTE prices a 0.26 FTE nurse on $26,629 at $6,924. The two are told apart by evidence in the file: if the column is a full-time rate, part-timers and full-timers carry similar headline figures; if it is already pro-rated, the part-timers' are lower by roughly their FTE. Comparing both medians against the median part-time FTE says which the file supports, and where it supports neither clearly, nothing is changed.

**One unreadable file never takes the batch down with it.** Upload five files with a PDF Atlas can't parse among them and the other four still ingest; the fifth is reported per-file as "Not used", with the reason, and stays flagged for review. Refusing the whole batch is indistinguishable — to the person uploading — from multi-file upload simply not working.

**Tick the files this run should use.** Every attached file gets a checkbox, and only ticked files are uploaded and ingested. The point is to be able to run the same folder of exports several ways — establishment only, then with payroll joined on, then with last year's vacancy report — without re-attaching anything. The size ceiling applies to what is selected, not to what happens to be attached.

**An upload carries up to 10MB per run, and no single request carries more than 1MB.** This split matters. Next caps a Server Action body at 1MB by default, and a host applies its own limit at its edge — Vercel returns `FUNCTION_PAYLOAD_TOO_LARGE` above ~4.5MB — and *both* reject the request before any application code runs, so neither failure can be seen, logged or explained from inside the app. It just looks like nothing happened. So files no longer travel in the form at all: the browser slices each one into 1MB pieces and posts them to `/api/upload` (`lib/ingest/uploadClient.ts`), which stages them in `upload_chunks`; the Server Action then receives only the ids and reassembles the files. That moves the ceiling from "what one HTTP request can carry" to "what Atlas is willing to accept" — a limit the app can enforce itself, and explain, which is why `MAX_UPLOAD_BYTES` is the number the upload form actually holds you to.

An upload missing a piece is refused rather than reassembled: half a spreadsheet still parses, into a plausible establishment that is quietly missing people. Staged chunks are deleted as soon as the ingest reads them, and anything abandoned is purged after an hour.

**Upload as many files as you have.** Org data rarely arrives as one tidy export: it comes as an establishment list plus a payroll extract plus a vacancy report, each from a different system, each naming the same field differently, and often each covering only part of the organisation. `lib/ingest/bindFiles.ts` works out what each file *is* before deciding what to do with it:

- A **roster** describes positions — it has a title, plus an ID, name or reporting line. Rosters are stacked, so an establishment split by site or division reassembles into one org, and reporting lines resolve across the file boundary.
- An **attribute** file describes facts *about* positions — an ID or name plus columns like cost, FTE or status. These are joined onto the roster rather than appended, so a payroll file can be the only source of salary in the whole upload.
- Anything with no usable key is **unusable** and is reported as such.

**The confirm screen carries a per-file report of everything uploaded.** "What was in the files you uploaded" lists every file — expandable, collapsed by default — with the format it was recognised as, its row and column counts, how it was read, what Atlas did with it, and every column it contained alongside what that column was read as (or that it wasn't recognised and was kept as an extra). Joined files also show how many rows matched, how many matched nothing, how many values disagreed with the position list, and which key the join used. The merged establishment can't answer any of that, and the questions people actually ask on this screen are always about one file: did our payroll extract land, where did the cost centre column go, why is this one greyed out. Files that contributed nothing are listed with the rest, since they are the main reason to look.

Beneath it, "How complete this establishment is" gives the aggregate: what proportion of positions have a cost, a reporting line, a named department and a real employment status. A headcount says how many rows arrived; this says how much of each row is usable, which is what decides whether the savings modelled later mean anything — positions with no cost model as $0 and quietly understate every play.

Two rules keep this trustworthy. Where an attribute file disagrees with the roster, **the roster wins and the disagreement is counted** — silently overwriting an establishment record with a payroll figure is the kind of invisible edit that destroys trust in every number downstream. And **every file's fate is stated per-file on the confirm screen**, including rows that matched nothing and files that contributed nothing; the failure mode being guarded against is someone uploading five files, seeing a map, and never learning that three were dropped.

Images, and PDFs with nothing but a picture in them, are read by the vision model — and those rows land in the review queue rather than the baseline, because a model reading a picture is the one ingest path that isn't a reading of someone else's export.

**A chart beside a spreadsheet is taken as the shape, not a second headcount.** An org chart out of a board pack shows twenty boxes and the lines between them; the payroll extract beside it lists five hundred people and what they cost. Stacking them duplicates the twenty and throws away the one thing the chart is better at, so a file read from a picture becomes a **structure** file: each of its roles is matched to the establishment by ID, name or unique title, and its reporting lines *replace* the ones the position list carried. Roles on the chart that aren't in the position list are added, so the shape stays whole.

The part that would otherwise fail silently is the translation. A chart says "box-3 reports to box-2"; box-2 is Ravi Anand; Ravi is `E2` in the establishment — so the line written is `E2`. Without rewriting the reference into the establishment's own terms it would point at a row that doesn't exist and orphan everyone beneath it. And a structure file matching *nobody* is refused rather than appended, because laying it over the establishment would build a second, parallel organisation instead of reshaping this one.

### Telling Atlas about the files (the context box)

Client data is messy in ways no column list can express: three brands in one export, the structure living in a PDF while the money lives in a spreadsheet, last year's leavers still in the roster, a column called "Entity" that is really the operating company. So the upload screen has a free-text box — *"These cover our three trading brands, consolidate at brand level. The org structure is the PDF; the spreadsheet is payroll only."*

That sentence goes to Claude (`lib/ingest/plan.ts`) along with the real filenames, the real column names and a few sample rows, and comes back as an `IngestPlan`: what each file is for, what any ambiguous column means, which column to consolidate on, and which rows are out of scope. **The model returns only that plan — it never touches a row.** Everything that then happens to the data (filtering, stacking, joining, overlaying, grouping, costing) is the same deterministic code that runs without instructions. That is what makes it safe to point a model at a client's folder of exports: the worst a bad plan can do is put a file in the wrong role, which is stated on the confirm screen in the plan's own words. It cannot invent a person, a cost or a reporting line, because it is never asked for one.

Everything the plan asks for is validated against what actually arrived before any of it is used — a filename that isn't in the upload, a column that isn't in that file, a field Atlas doesn't hold, two columns claiming one field. Each is dropped and reported as *"Asked for, but not done"* rather than silently ignored or silently applied.

**Consolidation deserves its own note**, because it changes the shape and must not change the numbers. Several brands in one upload arrive as several unconnected hierarchies, and without grouping they are forced into one — whichever chief executive appears first becomes the root and the other brands' leadership is hung underneath, inventing a reporting line and a management layer that exist nowhere in the client's organisation. Grouping gives each brand a labelled heading node and puts the headings under one top node. Those headings are **synthetic**: they are drawn on the map with a dashed border reading *"Grouping — not a position, not counted"*, they are excluded from headcount, cost, spans and layers, and every redesign move against one is refused. Consolidating an eight-person, two-brand upload gives the same eight positions and the same $1,692,000 as not consolidating; only the shape differs.

Without an `ANTHROPIC_API_KEY` the box still accepts instructions, and the confirm screen says plainly that they were **stored and not applied** — the visible-fallback pattern applied to a behaviour whose fallback is doing nothing. Nothing is guessed at from the text.

### Zero FTE is agency staffing

An FTE column is read as it stands, zero included. Zero is not a missing value in a workforce export — it is a statement that someone holds no contracted establishment, which is how these systems record agency labour. Atlas used to round it up to 1, which turned 563 of one client's agency workers into full-time employees and claimed 1,004 FTE where the files said 406.

So a position at zero FTE is marked contingent, drawn on the map as **agency**, filterable on its own, and counted in a **contracted FTE** figure shown beside headcount — the gap between the two is the agency population, and it is the gap a redesign argues over. That reading is a reading, not something the column says, so it is in the register as an assumption with its count and its consequences, and the client can overrule it.

It follows that agency staff contribute headcount but no establishment FTE, and therefore no cost in a cost × FTE model. The agency-premium play says so plainly rather than reporting "no premium found", because those are different findings.

### What Atlas assumed, and what it refused to assume

Atlas holds no defaults about a client. There is no file of standard hours, no house view of what a brand code means, no fallback salary — because every one of those is Atlas's arithmetic wearing the client's data, and a figure nobody can trace is worse to them than a visible gap. So each read produces a **register** (`lib/ingest/notes.ts`), shown on the confirm screen between the ingest and the map, holding two kinds of entry:

- an **assumption** is a reading Atlas made *from evidence in the file* and applied. "Part-timers here earn 66% of what full-timers do against a median part-time FTE of 0.80, so this salary column is already pro-rated." It changed the numbers, so it is stated with the evidence and the effect of being wrong.
- a **question** is a reading Atlas refused to make. An hourly rate is not a cost until someone says how many hours it is paid for, and no export in that shape carries the number. Those people are counted and left at $0, and the register says how many, what they are worth per hour, and what the total on the next screen therefore excludes.

Questions are answerable in place. Supply the paid hours, or pair *"365C"* with *"365 Care"*, and Atlas **re-reads the original files** — the bytes are kept in `source_blobs` for exactly this — into the same establishment, with the same id, and the question comes back as an assumption naming the client as its source. Answers accumulate in `orgs.answers_json`, so a later correction never silently drops an earlier one.

Nothing is patched into the saved positions. A paid-hours figure changes what every hourly row costs, which changes the coverage figures, which changes which questions are still worth asking — a re-read is the only version of "apply my correction" that leaves the map, the per-file report and the register describing the same thing.

**A correction can also just be written out.** The reply box on the confirm screen goes to the planner along with the whole previous read — the role each file was given, every column recognised, every question left open, every value found in the consolidation column — so a remark like *"the payroll is FY27 but the chart is a year old, trust the payroll"* is answered by a reader that can see what it is correcting. The plan it returns can carry facts only the client knows (`a full-time week is 38 hours`, `AUH is AgeUp`) as well as file roles and column meanings; because those change what a file *means*, the files are read a second time with them in hand. Everything returned is checked against values that actually appear in the files, and anything applied is stated back on the register — answering a question must not make it vanish.

Two guards fall out of that. A plan override can never take the cost or name field from a column Atlas composed: `Rate` is what someone earns in an hour, and mapping it to cost prices a care worker's year at $36. And a plan cut off at its token ceiling reports itself as too long rather than as an unreadable shape, because those call for opposite responses.

**Where two files disagree, Atlas says so rather than resolving it.** One export calls the brand `BRAND` and another `Source Brand`; the plan names both and they are coalesced into one column, so consolidating doesn't leave half the organisation ungrouped. But one file's values are `365 Care, Accept Care, Homewell` and the other's are `365C, ACG, HWL`, and nothing in the data says those are the same brands — only the client knows. So the model drafts the pairing, every value it returns is checked back against the lists it was given, and the whole thing is offered as an editable proposal that changes nothing until it is confirmed. Clearing a box keeps two values apart, which matters as much as merging them.

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
npx tsx --env-file=.env.local scripts/verify-plan.ts           # upload instructions: plan validation, overlay, consolidation
npx tsx --env-file=.env.local scripts/verify-messy-sources.ts  # real-export shapes: multi-sheet, title bands, split names, rates
npx tsx --env-file=.env.local scripts/verify-corrections.ts    # the register: refuse to guess, be answered, re-read, close
npx tsx scripts/verify-pdf.ts                                  # the deterministic PDF reader (no database needed)
```

To work with a client's real files without committing them, `scripts/ingest-folder.ts` points the *same* `runIngest` path at any folder — `npx tsx --env-file=.env.local scripts/ingest-folder.ts <folder> "<instructions>" [--only a.xlsx,b.pdf]` — and prints the establishment, the per-file report and the full register. Add `--answers '{"hoursPerWeek":38}'` to read it as though the questions had already been answered.

Each of these creates real establishments in the real database, so the home page accumulates `verify-run`s. `npx tsx --env-file=.env.local scripts/delete-orgs.ts` lists them without deleting anything; pass ids (short prefixes are fine) or `--all` to clear them.

`verify-binding.ts` builds its fixtures from the demo CSV at run time: an establishment split across two files with different column names, a payroll extract that is the only source of cost anywhere, a status report containing staff who have left, and a file with no key at all. It asserts the halves reassemble without loss or duplication, that cost survives the join into the metrics, that unmatched rows are reported rather than absorbed, that the keyless file is refused loudly, and that reporting lines resolve across the file boundary.

`verify-formats.ts` builds a real `.docx` in memory (there is no zip dependency in this project, so it writes the archive itself, as `parseDocument.ts` reads one) and checks that the establishment table wins over the document's version-history table, that a prose-only Word file is refused with a reason, that images route to the vision reader, and that a batch of four files containing two unreadable ones still produces a working org with its costs intact.

`verify-pdf.ts` writes real PDFs rather than checking fixtures in, so it can't drift from what the reader claims to handle: one in the shape Word and Excel emit (standard font, literal strings), one with a subset-embedded font (Identity-H hex behind a ToUnicode CMap — the case that extracts as mojibake if the CMap is ignored), and a genuine seven-box structure chart drawn as rectangles joined by elbow connectors, tested both with its connectors and with them removed so only layout remains. It asserts the tabular ones reconstruct the same six-column table with multi-word names and titles intact and map to canonical fields like any other source; that the chart resolves all seven reporting lines correctly by either route and is flagged for review; that a prose PDF and a text-free scan are each refused with the *right* reason; and that both a tabular PDF and a drawn chart end up as working establishments with correct costs, layers and spans.

`verify-chunked-upload.ts` builds a 2.8MB, 32,000-row establishment, stages it in pieces exactly as the browser does, and checks that it reassembles byte-for-byte, that an upload missing one piece is refused instead of truncated, that the action can ingest from staged ids alone, that every row is either kept or reported as a duplicate, and that the staged bytes are cleared afterwards.

`verify-plan.ts` covers the context box, and is built around the split the feature rests on: the model produces a plan, and everything that acts on a plan is arithmetic. So it runs against hand-written plans with no key and no network. It asserts the validator keeps only what it can check (dropping an invented filename, a column the file doesn't have, a field Atlas doesn't hold, an unknown role and a grouping column nobody has — five refusals, each reported); that a column override beats the synonym matcher; that scope filtering happens before anything is bound; that an ignored file is excluded and says why; that a chart laid over a spreadsheet produces eight positions rather than thirteen with its reporting lines translated into the establishment's own IDs; that a chart matching nobody is refused; that a picture beside a spreadsheet defaults to being the shape, and that an instruction still overrides that; that consolidating two brands yields the same eight positions and the same $1,692,000 as not consolidating while removing the invented layer between the two brand leads; that heading nodes can't be removed or reassigned; and that with the box left empty nothing about ingest changes at all.

`verify-messy-sources.ts` builds a real `.xlsx` in memory (a five-sheet workbook, and a payroll listing under a title band) and asserts the things a real client export gets wrong: that all four brand sheets stack while the rate card is reported as left out, that split names are composed and the composed column wins the name field, that hourly rates are *not* turned into costs while the hours behind them are unknown but are raised as an answerable question carrying the evidence — and are priced correctly once answered, that the header row is found beneath the preamble, that a pro-rated salary column is detected and cost × FTE returns the file's own total to the dollar, that a file already stating full-time rates is left untouched, that an establishment two-thirds unpriced says so before the map, and that `Source Brand` and `BRAND` coalesce into one dimension while keeping a record of which file each value came from.

`verify-corrections.ts` is the round trip the register depends on. It ingests two files that between them hold every refusal Atlas can make — hourly rates with no hours, one brand vocabulary in codes and another in full names — checks that nobody is priced and both questions are raised with a proposal attached, then answers them exactly as the confirm screen does: accepting Atlas's pairing for one value and correcting by hand the one it declined to pair. It asserts the re-read keeps the establishment's id, prices every position at the client's stated hours, merges the reconciled codes so no group survives twice, flips the answered question into an assumption naming the client, drops the reconciled one entirely, and stores the answers for the next re-read.

`verify-plays.ts` is the one that keeps the numbers honest: for every play it replays the play's own operations against the diagnostic engine and fails if the claimed saving doesn't equal the sum of the roles it named, if the modelled cost didn't actually move, or if the predicted headcount delta doesn't match what happened.

## AI-assisted vs. deterministic (the visible-fallback pattern)

Four behaviours are AI-shaped: role classification (ingest), the findings narrative, reading the upload instructions into an ingest plan, and reading an org chart out of an image or PDF.

Role classification is done **once per distinct role, in batches** — never per position. An establishment holds far fewer job titles than people, so a 32,000-row ingest costs a handful of requests rather than 32,000; per-position calls were invisible while no key was configured and would have made ingest impossible the moment one was. Past 400 distinct titles the keyword classifier takes the remainder, because classification is advisory framing and an ingest that completes on keywords beats one that exceeds the host's function timeout and returns nothing.
 The first three have a deterministic fallback and run on it — visibly, never silently — unless `ANTHROPIC_API_KEY` is set (see `.env.example`). None of them produces a number a client sees: classification is advisory framing, the narrative only frames metrics that were already computed deterministically, and the ingest plan says what each file is *for* without ever touching a row.

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
