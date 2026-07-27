# The Architecture

*Archetypes, the decisions that need a home, house patterns worth standardising, and workspace discipline. As at 12 July 2026.*

---

## 1. The archetype catalogue

Every build in the wild fits one of six shapes. The pipeline currently automates one of them. Naming the shape before scaffolding is the missing front door (stage 2 in `03-process-design.md`).

| Archetype | What it is | Right when | Worked example | Pipeline support |
|---|---|---|---|---|
| **Single-file HTML** | One self-contained file, CDN imports, no build step, no backend | Persuasion, decision-forcing, a leave-behind link; one narrative, no persistence | Category creator v2, Kinyara Phase 0 | None needed; it IS the seed |
| **Vite SPA + thin proxy** | Client-heavy React app, all logic in the browser, a 100-line server whose only job is hiding an API key | One presenter, a deterministic story, AI-optional, runs live on a laptop | P3 | None (bypassed the pipeline) |
| **Next.js full app** | Auth, roles, audit, DB, email, files; the starter's shape | State outlives one browser tab, or two people must see it; the client's team uses it | Kinyara Phase 1 | `tractin-starter` + `/spinup`, proven |
| **Next.js + Python two-service** | The full app plus a FastAPI service for streaming, server PDF, or data processing, signed service-to-service | Long-running or Python-native work Vercel functions cannot host | jdmachine (delivered) | Deferred to starter v2; build on demand |
| **Content-as-JSON PWA** | Static app whose content ships as data files, installable, no DB | Training and reference products; content changes, code does not | Enterprise Fluency app | None; consider only if the shape repeats |
| **Chat-over-vault** | Agents reading a governed markdown vault, plus optional live data feeds | The product is answers over curated knowledge | oOh! Brain (runtime not yet built) | Content pipeline mature; runtime missing |

**The graduation signal** between the light and heavy shapes is precise: the moment state must outlive one browser tab or be seen by two people, the demo has become a product and the archetype must change with it. P3 sits exactly on that line: perfect as built for its job, wrong the moment anyone says "host it."

## 2. The architecture decisions that need a home

`/blueprint` owns logic mechanisms. `/spinup` records infrastructure toggles. Neither deliberates the forks below. Each deserves a short ADR in the repo when it is genuinely open (the trigger: reversing the call later means cross-file rework).

| Fork | The question | Default until argued otherwise |
|---|---|---|
| Server or local-first | Does the data live in a hosted DB or in files the client controls? | Hosted for multi-user tools; file source-of-truth with a derived store for data-analysis work (the S4 rebuild pattern) |
| Data store | Postgres, DuckDB, JSON-as-content, or a markdown vault? | Postgres for apps; DuckDB for analytical pipelines; the vault for curated knowledge |
| Tenancy | One deployment per client, or shared with isolation? | One per client at POC scale; isolation by construction (own Vercel project, own DB instance, own model key). Revisit only at productisation |
| Data residency | Must everything sit in Australia? | Yes for client spend, workforce or health data: Sydney-pinned host and DB. It is cheap and it is a differentiator |
| Model provider and routing | Direct Anthropic, a gateway, or a router? | Anthropic direct with a per-client workspace and spend cap; a gateway only when a build genuinely needs multi-model fallback. Decide once, record it; Kinyara churned mid-build and its config is now stale against its code |
| Sync | Authoring surface vs runtime copy (vaults especially) | Author on OneDrive, run local or deployed, with a defined, lint-checked sync path |
| Offline / degraded modes | What still works with no network, no key, no config? | Every capability self-disables visibly (the starter's convention); AI behaviours carry deterministic fallbacks |

## 3. House patterns worth standardising

Proven in the worked examples; candidates for the starter and the skills.

1. **AI-optional with a visible deterministic fallback.** Every model behaviour has a fallback computed from the same inputs, so a demo never dies mid-pitch. The trap to engineer out: silent degradation. The presenter must be able to see which mode is live (P3's "advisor offline" badge is the minimum).
2. **Ground the model on structured, pre-computed data, never raw rows.** Send the model a metrics JSON with a contract of "reason only over the provided figures, never invent one." This is what lets a numbers-facing tool survive CFO scrutiny, and it doubles as the privacy boundary (raw staff or invoice rows never leave the app).
3. **Curated truth versus live numbers, as an enforced contract.** The vault supplies context; the export or feed supplies any dollar; figures are recomputed, never parroted; every fact carries a confidence grade and provenance; a composite output inherits its weakest fact. Encoded today in the s4-demo grounding rules; belongs in every chat-over-data build.
4. **Real arithmetic, authored judgement (seeds).** The deterministic maths runs live in the demo; the prose and scores are hand-authored. Credible without a model; the transition plan names which authored parts become LLM calls, retrieval, or stay human.
5. **Branding as data.** Tokens, logo, name, vocabulary file: swap values, never structure. The Kinyara gap to close: brand strings hiding outside the declared seams (hoist to one constant).
6. **Scaffold by deletion, with additive plugins for the entangled parts.** Deleting proven modules beats generating fresh code, except where a capability is woven through the core (SMS PIN through auth). Those become plugins behind seams, or the guidance changes to "leave unconfigured, do not delete."
7. **Degrade gracefully when unconfigured.** Any capability without its env vars self-disables instead of crashing. This is what makes "scaffold now, provision later" workable, and what makes the provisioning checklist non-blocking.
8. **Audit authorship where authorship is the product.** In workshop tools, who corrected what is the deliverable; the audit log is not compliance plumbing, it is the value record.
9. **Isolation by construction for client POCs.** Own Vercel project, own database instance, own R2 bucket, own Anthropic workspace and key per client. The confidentiality answer becomes "true by construction," not policy.
10. **Evidence lineage for seed data.** When a seed's embedded dataset moves into a real schema, extract it verbatim to a data file with its origin recorded, so every figure in the tool traces back to the artefact the client already saw.

## 4. Workspace discipline

The standing rule, violated once (P3) and proven right everywhere else:

- **OneDrive / SharePoint** is for authoring and deliverables: documents, seeds, handoffs, vault authoring, this folder.
- **Local paths** (`/Users/toni/...`) are for anything with a toolchain: repos, node_modules, Docker, build caches. Node cannot compile reliably on OneDrive, and OneDrive sync corrupts and duplicates (the oOh! vault harvest had to filter sync-conflict duplicate files; P3 syncs 86 MB of node_modules).
- **Git is the source of truth for code**, GitHub (`Tract-In` org, private repos from the template) is the backup and collaboration surface. "No git" is never a feature. A repo that exists only on one laptop is one hardware failure from gone.
- **Secrets never sit in cloud-synced folders.** A `.env` on OneDrive replicates to every device the moment a key is pasted into it. Local env files only, sourced from the vault (see `06-tooling.md`).
- **Vaults author on OneDrive, run elsewhere.** A deployed brain gets a defined sync path with lint on the way through, not a live mount of the authoring copy.

## 5. Productisation architecture (the direction of travel)

The bespoke-to-productised transition is unencoded today (challenge S6). The architectural groundwork it will need, so bespoke builds do not paint it out:

- **Config over constants.** Everything client-specific that survived the build as a hard-coded value (taxonomies, benchmark bands, brand tokens, vocabulary) must be liftable into per-tenant config. The category creator shows the shape: taxonomies are per-company even in the demo, because a universal one reads as naive to the buyer.
- **The shared shell, versioned.** When sibling tools reuse one UI shell and one input contract, extract the shell before the copies fork (the Sourcing roadmap's own action). Fork-debt compounds fastest in single-file artefacts.
- **Tenancy decided consciously.** Per-client deployments are the POC default and may remain the product answer (strong isolation story, simple ops); shared-with-tenant-column is a cost decision to take at productisation, not before.
- **The library as the product's brain.** A productised capability is mostly its content: lever tables, rubrics, benchmarks, playbooks served from one source of truth to both code and model. The single-file demo pattern (knowledge inlined as constants) is the anti-pattern to migrate away from.
