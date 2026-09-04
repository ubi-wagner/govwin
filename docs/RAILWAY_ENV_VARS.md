# Railway Environment Variables — canonical per-service reference

**Railway is the source of truth.** This doc lists the variable **names** the deployed code reads,
per service, so future changes reference the exact names Railway provides. Values are secrets and are
NOT recorded here. Deploy flow is **merge → Railway build/deploy → migrations**; nobody edits services
or the DB directly.

Legend: **✅ set in Railway** · **⛔ required — the service will not start without it** · **➕ recommended to add** · **○ optional / feature-gated** · **⚙️ Railway auto-injected** · **💤 read by no code (safe to leave/prune)**

Production topology (5 nodes): `govtech-frontend` · `pipeline` · `rfp-crm` services · `Postgres`
(main `govtech_intel`, shared by frontend+pipeline) · `cms-postgres` (rfp-crm's DB) · `rfp-pipeline-bucket`
(Cloudflare R2, shared by all three).

---

## govtech-frontend (Next.js)

| Variable | Purpose | Status |
|---|---|---|
| `DATABASE_URL` | main DB — the **`govtech_app` (NOBYPASSRLS)** role, so RLS is live | ✅ |
| `DATABASE_URL_OWNER` | owner/superuser connection. Two jobs: `entrypoint.sh` **migrates** with it, and `sqlBypass` uses it for the legit **admin/CMS cross-tenant reads** (agent-workforce rollup, rfp-curation "Customer Interest"). Unset → `migrate.mjs` refuses to run as a role that cannot bypass RLS and `set -e` **stops the boot** (see §"Migrations at boot"); if it ever did serve, those reads would return **0 rows** with no error | **⛔ REQUIRED — the container will not start without it** (reference the `Postgres` service's own connection URL) |
| `API_KEY_ENCRYPTION_SECRET` | AES-256 key for DB-stored API keys — **must match the pipeline's value** | ✅ |
| `AUTH_SECRET` | NextAuth session secret | ✅ |
| `AUTH_URL` | canonical app URL; NextAuth + all invite/reset/notification link-builders use it (code falls back to it from `NEXTAUTH_URL`) | ✅ |
| `ANTHROPIC_API_KEY` | frontend product AI — drafting, compliance, source-scout, vision | ✅ |
| `AWS_ACCESS_KEY_ID` · `AWS_SECRET_ACCESS_KEY` · `AWS_ENDPOINT_URL` · `AWS_DEFAULT_REGION` · `AWS_S3_BUCKET_NAME` | R2 (`rfp-pipeline-bucket`) — uploads, image atoms, export assets | ✅ |
| `NEXT_PUBLIC_APP_URL` | public base URL (sitemap, RSS, public links) | ✅ |
| `GOOGLE_CLIENT_ID` · `GOOGLE_CLIENT_SECRET` · `GOOGLE_REFRESH_TOKEN` · `GOOGLE_WORKSPACE_EMAIL` | Gmail send — the **primary** email path | ✅ |
| `AUTH_RESEND_KEY` | Resend key — email **fallback** (code reads `RESEND_API_KEY \|\| AUTH_RESEND_KEY`) | ✅ |
| `IPINFO_TOKEN` | geo enrichment | ✅ |
| `APP_ENV` | environment marker | ✅ |
| `VOYAGE_API_KEY` (+ `EMBED_MODEL`) | **semantic (vector) retrieval** for atom selection during AI drafting. Inert without it (falls back to the tag/context selector — zero regression). `ATOM_EMBED=local` is a keyless local-embedder alternative | ○ |
| `EMAIL_FROM` | present but **read by no code** today | 💤 |
| `CRON_SECRET` · `PIPELINE_INTERNAL_URL` · `CMS_API_KEY` · `REVALIDATE_SECRET` · `CMS_PUBLIC_URL` | cron-endpoint auth · FE→pipeline internal call · FE↔rfp-crm auth/revalidate/CRM iframe | ○ (add when those integrations go live) |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE` | PDF-export Chromium path — **set in the frontend Dockerfile** (`/usr/bin/chromium-browser`), not a Railway var | (Docker) |
| `FOUNDING_COHORT_BYPASS` · `SEED_DEV_ACCOUNTS` · `SEED_PAGE_CONTENT` · `ALLOW_SCHEMA_RESET` | dev/seed toggles — **must stay UNSET (or false) in prod** | — |
| `RAILWAY_PUBLIC_DOMAIN` · `RAILWAY_GIT_COMMIT_SHA` · `RAILWAY_ENVIRONMENT_NAME` · … | health/release id | ⚙️ |

## pipeline (Python worker)

| Variable | Purpose | Status |
|---|---|---|
| `DATABASE_URL` | main DB (Railway internal networking). Trusted cross-tenant engine — connects for the whole fabric | ✅ |
| `ANTHROPIC_API_KEY` | the **agent fabric** — `section_drafter`, full-draft cohort, Studio, etc. Without it, pipeline agents raise/skip | **➕ ADD** (same value as frontend) |
| `API_KEY_ENCRYPTION_SECRET` | must match the frontend's value | ✅ |
| `AWS_ACCESS_KEY_ID` · `AWS_SECRET_ACCESS_KEY` · `AWS_ENDPOINT_URL` · `AWS_DEFAULT_REGION` · `AWS_S3_BUCKET_NAME` | R2 (`rfp-pipeline-bucket`) | ✅ |
| `APP_ENV` | prod marker (with `RAILWAY_*`) | ✅ |
| `USE_STUB_DATA` | **must be `false`** in prod (code forbids stub data in prod) | ✅ (=false) |
| `CLAUDE_MODEL` | agent model id | ○ (defaults to `claude-sonnet-4-20250514`) |
| `AGENT_DATABASE_URL` | routes the agent pool through the **`rfp_agent` (NOBYPASSRLS)** role for agent-side RLS (defense-in-depth). **Unset today** → agents ride the pipeline `DATABASE_URL` connection; isolation is the app-layer `WHERE tenant_id` + fail-closed guards | ○ |
| `SAM_GOV_API_KEY` · `MASTER_ADMIN_EMAIL` · `INITIAL_MASTER_ADMIN_PASSWORD` | SAM.gov ingest · first-admin seed | ○ |
| `CARD_RECONCILE_URL` (+ `CRON_SECRET`) | hourly poke → `POST /api/admin/reconcile-cards`. The ONLY thing that heals a tenant who never opens their feed; without it their weekly digest and the admin rollups are computed off a stale mirror | ○ (**inert when unset**) |
| `AGENT_GATE_SWEEP_URL` (+ `CRON_SECRET`) | 60s poke → `POST /api/admin/agent-gates/sweep`. TW-8 AI-manager auto-advance | ○ (**inert when unset**) |
| `SPACE_PRESENCE_SWEEP_URL` (+ `CRON_SECRET`) | hourly poke → `POST /api/admin/space-presence/sweep`. Closes an abandoned "an RFP administrator opened your workspace" bracket when the admin/partner shut the tab instead of exiting — the one closer that does not need the person to still be there. Unset ⇒ those brackets stay open in the customer's audit trail indefinitely | ○ (**inert when unset**) |
| `TASK_CLAIM_SWEEP_URL` (+ `CRON_SECRET`) | 30-min poke → `POST /api/admin/tasks/sweep-claims`. Returns an abandoned ToDo claim to the queue when the person who started it was signed out mid-task. NOT optional alongside the session bounds — those GUARANTEE people are signed out mid-task, so unset ⇒ the queue fills with claims nobody holds and nobody else will pick up | ○ (**inert when unset**) |

> **These three are read through a helper, not by name.** `pipeline/src/main.py` calls
> `_run_poker('…', 'CARD_RECONCILE_URL', …)` and the helper does `os.environ.get(url_var)`, so no
> `os.environ["CARD_RECONCILE_URL"]` exists anywhere to grep for. `audit-env-inventory.mjs` was
> blind to all three until it learned the call-site idiom — which meant the audit built to catch
> "a capability that silently does nothing in production" could not see its own best examples.
> Each URL is the **full public** endpoint (e.g. `https://<frontend-domain>/api/admin/…`), and each
> path must also be in `CRON_EXACT_PATHS` in `middleware.ts` or the bearer is rejected before the
> handler runs — a 401 whose lowercase `{"error":"unauthenticated"}` body is the middleware's
> wording, not the route's.

## rfp-crm (FastAPI — CRM, build-out later)

Not part of the alpha customer path; its variables live on the `rfp-crm` service + `cms-postgres`.
Reconcile against Railway when the CRM is built out — the code-read set (see `docs/SECRETS_INVENTORY.md`):
`CRM_DATABASE` (→ the CRM's own Postgres — see below), `SHARED_DATABASE_URL` (→ main DB bridge),
`ANTHROPIC_API_KEY`, `CMS_STORAGE_ROOT`/R2, `ALLOWED_ORIGINS`, `CMS_API_KEY`, `CMS_JWT_SECRET`,
`GOOGLE_SERVICE_ACCOUNT_JSON` (the email-unlock key) + `GOOGLE_WORKSPACE_EMAIL`, `LOG_LEVEL`.

---

## Email (Postmark + Gmail) — set on BOTH `govtech-frontend` and `rfp-crm`

The send seam is implemented twice, once per language, and both halves read the same names and write
the same `email_send_ledger` table in the main DB. A variable set on one service and not the other
produces mail that goes out under two different configurations — which is exactly the class of thing
the seam exists to prevent.

| Variable | Purpose | Status |
|---|---|---|
| `EMAIL_DRIVER` | `postmark` \| `gmail`. Selects the transport for **transactional** mail only; `correspondence` is pinned to Gmail whatever this says. Absent ⇒ `gmail`, which is today's behaviour | **➕ ADD** (`postmark`, at cutover) |
| `POSTMARK_SERVER_TOKEN` | **Server API Token, NOT the Account token.** The account token manages domains and cannot send; using it returns a 401 that reads exactly like a wrong key | **➕ ADD** |
| `POSTMARK_MESSAGE_STREAM` | Postmark's transactional stream | ○ (defaults to `outbound`) |
| `POSTMARK_WEBHOOK_SECRET` | shared secret on `POST /api/webhooks/postmark`. Postmark does **not** sign webhooks — the mechanism is HTTP Basic auth on the webhook URL, so configure the URL in Postmark as `https://postmark:<secret>@<host>/api/webhooks/postmark` | **➕ ADD** (frontend only — the route lives there) |
| `POSTMARK_API_BASE` | endpoint override. **Sandbox only** — points the drivers at `scripts/test-harness/emulated-postmark.mjs`, the same way `ANTHROPIC_BASE_URL` points the AI flows at the emulated model. Leave UNSET in production | 💤 (never set in prod) |
| `EMAIL_FROM_ADDRESS` | `notifications@rfppipeline.com`. Must be on the Postmark-verified domain | **➕ ADD** at cutover |
| `EMAIL_FROM_NAME` | `RFP Pipeline` — the fallback display name when no tenant persona resolves | ○ |

**DNS, once:** verify the DOMAIN in Postmark (not individual sender signatures) — DKIM plus a custom
Return-Path. Then update SPF so **both** senders appear in ONE record:

```
v=spf1 include:_spf.google.com include:spf.mtasv.net ~all
```

A domain may have exactly one SPF record. Publishing a second is a `permerror` that fails **both**
senders — the classic way adding an email provider breaks the mail that already worked.

**⚠️ One open item, and it is a real blocker for the CRM half.** Migration 215 gives
`email_send_ledger` no write policy, so the NOBYPASSRLS `govtech_app` role is refused by design. The
frontend writes it through `DATABASE_URL_OWNER`. Nothing in the repo records which role the CRM's
`SHARED_DATABASE_URL` carries — it has only ever written `system_events` and `cms_content`, neither
of which has RLS. **If it is not the owner, every CRM send runs DEGRADED** (mail goes, no idempotency
reservation) and logs a 42501 naming the remedy once per process. Check it before the cutover.

---

## The CRM database

**Renamed: `CMS_DATABASE_URL` → `CRM_DATABASE`.** The service reads it through ONE resolver
(`services/cms/src/models/database.py::crm_database_url()`), which honours
`CRM_DATABASE` → `CRM_DATABASE_URL` → `CMS_DATABASE_URL` in that order and logs a deprecation
warning on the last. That chain exists because **a rename crosses a deploy boundary**: the platform
variable and the code that reads it do not change in the same instant, and `init_db()` raises at
startup — so a single-name reader turns the gap into an outage. Retire the legacy entry once
Railway, the GitHub secrets and staging all carry the new name; the warning is what tells you when
that is true.

**It is INTERNAL to the Railway private network.** No public TCP proxy. Reference it by the private
hostname (`*.railway.internal`) or by a Railway service variable reference, and leave the public
endpoint off. Only `rfp-crm` connects to it — the platform frontend and the pipeline do not, and the
sweep in docs/CRM_ANALYSIS.md confirms that is already true in code: the only platform-side mention
of the CRM is a link-out card.

### Migrations run inside the deployment — decided, and already the mechanism

**Both services already migrate at boot, and both fail closed.** This was the design before the
question was asked; what was missing was one thing that would have broken it.

| service | when | how it fails |
|---|---|---|
| `govtech-frontend` | `entrypoint.sh`, before `node server.js` | `set -e` — the boot stops |
| `rfp-crm` | Dockerfile `CMD`, before `uvicorn` | `exit 1` — *"refusing to boot on an unmigrated schema"* |

That makes the internal-only posture free: nothing outside the deployment needs to reach either
database to migrate it, so the CRM's Postgres can stay on the private network with no public proxy.

**⚠️ The defect this decision surfaced, which was live.** `migrate.mjs` reads `DATABASE_URL`, and on
the frontend service that is `govtech_app` — the NOBYPASSRLS application role. Reproduced against a
live database:

```
psql "$DATABASE_URL" -c "CREATE TABLE probe (id uuid REFERENCES tenants(id))"
ERROR:  permission denied for table tenants
```

Migrations **215, 216 and 217 all carry `REFERENCES tenants(id)`**, so with `set -e` the next deploy
would not have come up — and the error names `tenants`, which sends the hunt to the wrong place.

`entrypoint.sh` now migrates as `DATABASE_URL_OWNER` and serves as `DATABASE_URL`, warning loudly
when the owner variable is absent. **`DATABASE_URL_OWNER` on `govtech-frontend` is therefore a
hard requirement, not an optimisation** — it was already on the outstanding list; this promotes it.

`__tests__/deployment-migrations.test.ts` locks all of it: migrations before the server, failing
closed, the owner connection, the image actually carrying what the entrypoint runs, and psql
present in the CRM image.

`migrate.yml` stays as a **manual break-glass path** and now says in its own header that it cannot
reach a database with no public endpoint. Its CRM step used to `::warning::` and `exit 0` — a silent
skip that left the database un-migrated while the run stayed green, which is B145's shape and
precisely how a rename of the GitHub secret would have gone unnoticed. It fails now.

`tests/test_crm_database_var.py` reconciles the Python resolver, the bash chain in `db/run.sh`
(which cannot import it) and both workflows, and asserts the skip has not come back.

---

## Cross-service invariants
- **`API_KEY_ENCRYPTION_SECRET` must be identical** on frontend + pipeline (it decrypts the same DB-stored keys).
- **`DATABASE_URL` role matters:** frontend = `govtech_app` (RLS on). Owner/superuser access is only via
  `DATABASE_URL_OWNER` (frontend) → `sqlBypass`. The pipeline runs the trusted cross-tenant engine on its own `DATABASE_URL`.
- **R2** (`rfp-pipeline-bucket`): the `AWS_*` five-var set must be present on both frontend and pipeline (link the bucket service to both).
- **PDF export** needs Chromium in the frontend image — installed via `apk` in `frontend/Dockerfile` (not a Railway var).

## Sandbox parity (near-exact replica)
The sandbox matches these names/roles, with two sanctioned dev substitutes: the **DB** (local Postgres) and
the **Anthropic key** (the `:8787` emulator via `ANTHROPIC_BASE_URL` + `EMULATE=1`). Storage (`STORAGE_DRIVER=local`)
and embeddings (`ATOM_EMBED=local`) are additional keyless test substitutes for R2 / Voyage. See `docs/AI_FLOWS_PROOF.md`.
