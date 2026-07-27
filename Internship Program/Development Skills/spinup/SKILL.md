---
name: spinup
description: Scaffold a runnable, branded demo or tool from the tractin-starter template. Takes an optional /blueprint. Triggers: /spinup, /spinup [seed], "spin up a demo", "scaffold this into a real app", "build me a starting repo".
---

# /spinup — Scaffold a demo or tool from the starter

Turns a seed that implies functionality into a runnable, branded repo on `tractin-starter`, by reading what the seed already implies, asking only the gaps, and scaffolding from proven production patterns. Full design in `knowledge/spinup-plan.md`; patterns in `knowledge/build-patterns.md`; the template is `github.com/Tract-In/tractin-starter`.

**Run `/blueprint` first** if the tool has to think (ingest, classify, judge, recommend). Blueprint decides the logic and names what must be built; spinup scaffolds the infrastructure and stubs the behaviours. Spinup alone is for tools that mostly store and display.

**Default output** (settled): a runnable local repo plus a `PROVISIONING.md` checklist. The boundary is fixed and not to be softened: **reversible, unbilled, non-secret steps are executed now** (git init + first commit, repo create on the user's yes, `.env.local` scaffold, `AUTH_SECRET` generation, a local super-admin PIN); **billed, persistent or secret-bearing steps stay on the checklist** (Neon database, R2 bucket, Resend key, Vercel project, the client's Anthropic key). A leaked key has happened once in this repo's history, so nothing irreversible is executed by a scaffold. Neon and Anthropic-direct defaults per `wiki/decisions/development-process-standards.md`. v1 is the Next.js app archetype; the Python two-service archetype is v2.

---

## The run, end to end

```
seed (HTML / design export / idea)  [+ optional /blueprint]
  → [0] READ    infer implied capabilities, draft a config
  → [1] CONFIRM ask only the gaps (questionnaire, pre-ticked from the read)
  → [2] RESOLVE answers → spinup.config.json
  → [3] SCAFFOLD from the template; keep the modules asked for, remove the rest
  → [4] BRAND   swap tokens, logos, name from the answers
  → [5] MODEL   generate the domain schema, seed, screens
  → [6] VERIFY  install, typecheck, build, boot locally
  → [7] HAND OVER  runnable repo + PROVISIONING.md + what it cannot do yet
```

### [0] Read the seed

Never present a blank form. Read the seed first and arrive with a filled-in draft. Inference signals (full table in `spinup-plan.md` §3):

- `<form>` + email / "sign in" → auth. Two user types / "approve" → three-tier roles.
- `<table>`, repeated cards, CRUD verbs → DB + entities (columns and form fields become schema fields).
- `<canvas>` / `<svg>` / "chart / dashboard / trend" → visualisation.
- file input / "upload" → R2 storage. "send / email / notify / invite" → email + notifications.
- chat UI / "ask / generate / AI / agent" → LLM. textarea + "summarise / extract / classify" → structured LLM.
- install banner / mobile chrome → PWA. Inline colours / a logo → brand pre-fill.

If a `/blueprint` was run, take the mechanism choices from it: they set the capability toggles directly (files + AI for ingest and extract, deterministic sizing needs no AI, a human-in-the-loop step needs editing UI and the audit trail).

Also read the starter's `STALL-LEDGER.md` before scaffolding. If it lists open (unapplied) stall items, warn loudly in the read summary that the base carries known frictions and name them, so the build starts with eyes open. Never refuse to proceed; the warning only sets expectations.

Present the read back in one short summary, then ask only the genuinely open questions.

### [1] Confirm and fill the gaps

Ask as a branching questionnaire (use the questions tool; one screen per group). Never ask about detail for a capability that is off. Groups: confirm the read → core capabilities (auth, DB, files, AI, viz, email, export, PWA) pre-ticked → per-capability detail → branding (colours, logo, font, name) → domain model confirm (entities and fields proposed from the seed, editable) → deploy target and docs → review the resolved config.

### [2] Resolve to config

Write `spinup.config.json` into the new repo so the spin-up is reproducible and re-runnable. Schema in `spinup-plan.md` §5: project, seed, archetype, and a block per capability (auth, db, files, ai, viz, email, pwa, export, brand, deploy). Record the starter version it came from. Open every generated status artefact (this config's annotations, `PROVISIONING.md`, any debrief) with a `state as of [date], commit [short-sha]` line, so a reader always knows which state the paper describes; the paper trail is known to lag the code.

### [3] Scaffold by deletion, not codegen

Create from the template, then remove what was not asked for. Deleting proven modules keeps the spin-up production-grade; generating fresh code reintroduces solved bugs.

- Create the repo to a **local** path (never OneDrive — Node cannot compile there). Offer `gh repo create Tract-In/[slug] --template Tract-In/tractin-starter --private --clone` and, once the user says yes, run it; for a throwaway, clone the template instead. Either way **always** re-init git and make the first commit — a spin-up is never left without version control (the P3 lesson).
- Bootstrap the local environment now (reversible, executed — not deferred to the checklist): copy `.env.example` to `.env.local`; generate `AUTH_SECRET` with `openssl rand -base64 32` and write it in; put the founder's email in `SUPER_ADMIN_EMAILS`. Then make first sign-in work without a Resend key: run `scripts/set-pin.ts` to set a static PIN for the super admin, or print a banner explaining that without `RESEND_API_KEY` the magic link prints to the server console (it is not broken — stall item 8). Secrets live only in the local `.env.local`, never in a cloud-synced folder.
- Remove unused optional modules using the starter's `docs/module-manifest.md`: for each capability turned off, delete its files, drop its deps from `package.json`, remove its env block from `.env.example`, drop its schema tables, then regenerate migrations (see [5]). Cull imports of deleted files. Leave the woven-in capabilities the manifest flags "leave unconfigured, do not delete" (SMS PIN): unset their env, do not delete them.
- The example ideas domain is always replaced (see [5]).

### [4] Brand

Brand is data. From the config: rewrite the `@theme` block values in `app/globals.css` (keep the token names), swap `public/logo-mark.*`, set the name and metadata in `app/layout.tsx` and `app/manifest.ts`, set access env (`ALLOWED_EMAIL_DOMAINS`, `SUPER_ADMIN_EMAILS`, `TRUSTED_ORIGINS`), and rewrite the vocabulary file (`lib/categories.ts` style) for the domain enums. This is the de-brand recipe in `STARTER.md`.

### [5] Generate the domain model

The one place code is generated, not copied. First pin the model: where the seed embeds its own data (tables, a `DATA` array, form fields), lift the entities and vocabulary from there rather than re-deriving, and sharpen them with `domain-modeling` if present. **No domain-model code is generated until the entities and fields are confirmed with the user** — a wrong model is the most expensive thing to unwind later.

**Extract the seed's data with lineage (named move).** Where the seed embeds a data literal (a `DATA` / `SEED` array, an inline `<script>` object), evaluate it out to `db/seed-data.json` with a short ten-line script, and record its origin — the seed file name and a note that it was lifted verbatim — at the top of `db/seed.ts`. The seeded rows then trace back to the exact artefact the client saw, so a live tool cannot silently contradict the demo (proven on Kinyara, stall item 5).

Then, from `config.db.entities`: rewrite `db/schema.ts` domain tables (keep users, auth, notifications, app_settings, invites, rate_limits, audit_log), then regenerate the migration. **For a full domain swap, wipe `drizzle/` and run `npm run db:generate` to emit a fresh `0000` from the new schema — that runs headless. Hand-author a migration only for an incremental generate against an existing schema, which prompts on renames and needs a TTY the harness lacks** (proven on Kinyara, stall item 3). Rewrite `db/seed.ts` to read `db/seed-data.json`, and generate list and detail screens by copy-adapting the starter's existing ones, not writing from scratch. Write a `CONTEXT.md` glossary for the tool (the `domain-modeling` convention) so the repo stays navigable. If a `/blueprint` exists, stub each behaviour it named (a typed function with a TODO and the mechanism noted) so the build has a spine.

### [6] Verify

`npm install`, `npm run typecheck`, `npm run build`, `npm test`, and boot locally against the Docker Postgres (`npm run setup && npm run dev`). A spin-up that does not build and boot is not handed over. Fix (use `diagnosing-bugs` for stubborn failures), do not hand over broken. **Commit at every green gate:** once typecheck, build, test and boot pass, commit. No session ends with the working tree uncommitted; the paper trail decays within a day of active building otherwise.

### [7] Hand over

Generate `PROVISIONING.md` listing only the billed, persistent or secret-bearing steps this project needs — **Neon Postgres (Sydney / ap-southeast-2; use Railway Postgres only when the app itself is hosted on Railway)**, R2 bucket + CORS, Resend key, Vercel project + env, and **the client's Anthropic API key (from a spend-capped Anthropic Workspace; a router key such as AI Gateway or OpenRouter is a recorded /shape exception)** — each naming the exact env var it satisfies and the smoke script that proves it. The reversible local steps from [3] are already done, so they are not on this list. Open `PROVISIONING.md` (and any debrief) with a `state as of [date], commit [short-sha]` line. State plainly what the spin-up cannot do yet in a stub ledger: placeholder logo, stubbed behaviours, the blueprint's gap list, and, explicitly, whether the blueprint's **signature interaction** is built or stubbed (its absence must be a declared defect, never a silent one). Commit the finished scaffold and tag it.

---

## After the run

Feed anything the module manifest or seed inference missed back into `tractin-starter` — the starter is the canonical home for the shared patterns, so improvements flow up to it.

## Composes with

- **`/blueprint`**: run first when the tool must think; its mechanism choices set the capability toggles.
- **`domain-modeling`**: pin the schema and glossary at step [5].
- **`tdd`**: build the stubbed behaviours test-first, one seam at a time, after the scaffold.
- **`diagnosing-bugs`**: the fix loop when verify fails.

`domain-modeling`, `tdd` and `diagnosing-bugs` are user-level skills. Use them where present, and note the dependency if a teammate will run this without them.

## Desktop users

Say: "Spin up a demo from this mockup. Tell me what it implies, ask me only the gaps, then scaffold a branded repo on the tractin-starter template and give me a provisioning checklist." Then follow the same seven steps by hand.
