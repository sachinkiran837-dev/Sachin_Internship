# The Tooling

*The default primitive kit and the platform verdicts. Capability and pricing claims verified against live sources on 12 July 2026; re-verify before committing spend. Proposed changes to the current house standard are marked as decisions, not facts, and appear again in `07-open-challenges.md`.*

---

## 1. The default primitive kit

Costs assume POC scale: a handful of low-traffic, access-gated client demos, five people, one or two deploying seats.

| Service | Role | Scope | Rough $/mo | Standardise or per build? |
|---|---|---|---|---|
| **GitHub (Tract-In org)** | Source of truth, CI, the template repo | Firm | $0 to 4/user | Standardise |
| **Vercel Pro** | Default host: Next.js, Vite SPAs, static HTML, serverless functions, cron | Firm (paid deploying seats only; viewers free) | $20 to 40 | Standardise; pin region syd1 for AU clients |
| **Railway** | Long-running services only: FastAPI/Python, workers, websockets, DuckDB jobs; incumbent Postgres | Per build | $0 to 20 | Per build; see verdict below |
| **Neon Postgres** (proposed default) | POC database: serverless pooling, instant branching, Sydney region | Per project | $0 to 20 (free tier covers most POCs) | Proposed standard; decision open |
| **Better Auth** | Auth (magic links, roles); a library, not a service | Per project | $0 | Standardise (already house pattern) |
| **Resend** | Transactional email; `e.tractin.com` already verified | Firm | $0 to 20 | Standardise |
| **Cloudflare R2** | Files and assets; zero egress fees | Firm account, bucket per client | $0 to 1 | Standardise |
| **Anthropic API** | All model calls | One Workspace + scoped key per client, spend-capped | Usage, billed per client | Standardise the pattern |
| **Vercel AI SDK** | The AI code layer (streaming, tool calls, structured output); a library | Per project | $0 | Standardise |
| **1Password Teams** | Secrets source of truth, people and machine | Firm (flat fee to 10 users) | ~$20 | Standardise; decision open |
| **Sentry** | Error tracking (know the POC broke before the client says so) | Firm, one shared account | $0 free tier | Standardise into the starter |
| **PostHog** | Analytics, session replay, feature flags in one | Per build | $0 free tier | Per build: only POCs that must show usage |

**Indicative firm baseline: roughly $60 to 100 per month**, plus metered model usage billed per client workspace. Everything else rides free tiers at POC scale.

**Skip for now:** uptime monitoring (until something is genuinely always-on), standalone feature-flag services (PostHog covers it), UI generator subscriptions (v0, Lovable, Bolt): the HTML seeds Tract In already produces are the artefact those tools sell, and Claude Code owns everything after the seed.

## 2. Vercel and Railway: defined roles, keep both

- **Vercel** is the default host for every Next.js app, Vite SPA and single-file demo: preview deployments, the framework-native workflow, a Sydney functions region (syd1), and a serverless runtime that has largely eliminated cold starts. Wrong tool for anything that must stay running.
- **Railway** runs long-lived containers: the FastAPI service in the delivered two-service build, background workers, a future NetSuite polling worker, long DuckDB jobs. Wrong tool as a Next.js host (you lose the preview workflow), and its closest region is **Singapore, not Sydney**, which matters for residency-sensitive client data.
- **Verdict:** Vercel by default; Railway added per build only when a persistent process, Python service or websocket server exists. Do not consolidate either way. The friend's pitch of Railway as "deploy without infrastructure setup" is accurate but answers a question the stack has already answered with Vercel; Railway's real role here is narrower and genuine.

## 3. Postgres: the open switch

- **Vercel Postgres no longer exists** as a product; it was discontinued in mid-2025 and existing databases became Neon. "Postgres on Vercel" now means a marketplace integration, primarily Neon.
- **Neon** fits the POC profile: a real free tier, scale-to-zero (a dormant client demo costs nothing but wakes instantly), instant copy-on-write branches (one branch per preview deployment), built-in connection pooling that serverless Next.js needs, and an **AWS Sydney region**.
- **Railway Postgres** (current house standard) is plain, solid Postgres, but has no pooling out of the box (serverless functions exhaust its connections without a bolt-on), no branching, and **no Australian region**.
- **Supabase** brings bundled auth, storage and realtime the house stack already covers elsewhere, and its free tier pauses idle projects, which is exactly wrong for a client clicking a demo link cold.
- **Decision to take (grill it):** move the default POC database from Railway Postgres to Neon. The residency argument alone may settle it for client-data builds. Existing builds stay where they are; this is a default for new spin-ups, and it must be reflected in the starter's provisioning template if adopted.

## 4. Secrets and API keys, sized for five people with no ops function

- **The vault:** one shared secrets tool as source of truth. 1Password Teams Starter (flat fee up to 10 people) is the pragmatic pick if the team already uses it for logins: machine secrets and people secrets in one place, with CLI injection (`op run`) for local dev. Doppler is the developer-purist alternative at a per-seat price. Either beats the status quo of env vars scattered across dashboards and laptops.
- **Platform env vars** (Vercel, Railway) hold what a deployment needs, synced from the vault. They are configuration storage, not a vault: no rotation, no single view across projects.
- **Anthropic hygiene, the part that actually hurts if ignored:** one **Workspace per client** with its own scoped key, rate limits and a hard monthly spend limit. This caps blast radius on a leak, gives per-client cost attribution for billing, and keeps one client's usage from throttling another's demo. Never share one key across clients.
- **Rules:** secrets never live in cloud-synced folders (a OneDrive `.env` replicates the moment a key lands in it); keys rotate on offboarding or suspected leak (calendar rotation is overkill at this size); every provisioning checklist names the env var each secret satisfies and the smoke script that proves it.

## 5. AI plumbing in builds

- **The code layer:** Vercel AI SDK in every AI-bearing build, regardless of host or provider. It standardises streaming, tool calls and structured output so behaviours port between builds.
- **The provider:** Anthropic direct, through the per-client workspace key, as the default. A routing gateway (Vercel AI Gateway, OpenRouter) only when a build genuinely needs multi-model fallback, and then chosen once and recorded as an ADR. The Kinyara build churned provider mid-build (Gateway specified, OpenRouter shipped) and left its config stale against its code; that churn is the cost of not deciding.
- **The pattern floor** for any client-facing AI behaviour: structured output against a schema contract, grounding on pre-computed data or retrieval (never invention), deterministic guards on the output, a visible fallback mode, and the eval gate before a client sees it (`03-process-design.md`, stage 10).

## 6. NetSuite read access (for the chat-over-data ambition)

What a read-only agent layer takes in practice:

- **Auth:** OAuth 2.0 (Oracle's recommended path; no request signing), against an Integration record with REST web services enabled.
- **Reads:** SuiteQL, POSTing SQL SELECTs to the query endpoint, rather than per-record REST calls.
- **The cap that bites:** roughly 10 concurrent requests per account, shared across every integration the client runs. A chatty agent will throttle the client's other integrations; cache aggressively, batch via SuiteQL, and prefer the proven materialisation pattern (periodic export or pull into a DuckDB warehouse, agents read the warehouse).
- **The slow path is people, not code:** the client's NetSuite admin granting a scoped read-only role, enabling the feature, issuing sandbox credentials. Treat it as a scheduling dependency to open in week one, and build against the sandbox first.
- Bridge note: the current export-based ingest (files to DuckDB to JSON, deterministic, as-of-dated) is already the right architecture for the POC stage; a live connector changes the freshness of the warehouse, not the shape of the product.

## 7. Client-facing POC hosting hygiene

The per-client pattern, standardised:

1. **Own Vercel project** per client, custom subdomain (`client.tractin.com`).
2. **Access gate:** Vercel Authentication for the team's previews; the app's own login (Better Auth magic links) for client users. The platform's shared-password add-on is expensive and rarely needed given the app has real auth.
3. **Sydney everywhere** for residency-sensitive data: syd1 functions, Sydney database. Railway-hosted pieces cannot make this promise; factor that into archetype choice for regulated data.
4. **The residency and teardown note**, one page in the client folder, answering in advance what an AU enterprise will ask: where the data lives (Sydney, named services), who can see it (gate plus login, no public URL), whether it trains models (API data is not used for training by default; zero-retention available if pushed), what happens after the POC (delete the database and bucket, revoke the key, confirm in writing).
5. **Isolation by construction:** separate project, database, bucket, workspace and key per client, so the isolation answer is structural, not procedural.
