# Railway Environment Variables — canonical per-service reference

**Railway is the source of truth.** This doc lists the variable **names** the deployed code reads,
per service, so future changes reference the exact names Railway provides. Values are secrets and are
NOT recorded here. Deploy flow is **merge → Railway build/deploy → migrations**; nobody edits services
or the DB directly.

Legend: **✅ set in Railway** · **➕ recommended to add** · **○ optional / feature-gated** · **⚙️ Railway auto-injected** · **💤 read by no code (safe to leave/prune)**

Production topology (5 nodes): `govtech-frontend` · `pipeline` · `rfp-crm` services · `Postgres`
(main `govtech_intel`, shared by frontend+pipeline) · `cms-postgres` (rfp-crm's DB) · `rfp-pipeline-bucket`
(Cloudflare R2, shared by all three).

---

## govtech-frontend (Next.js)

| Variable | Purpose | Status |
|---|---|---|
| `DATABASE_URL` | main DB — the **`govtech_app` (NOBYPASSRLS)** role, so RLS is live | ✅ |
| `DATABASE_URL_OWNER` | owner/superuser connection for `sqlBypass` — the legit **admin/CMS cross-tenant reads** (agent-workforce rollup, rfp-curation "Customer Interest"). Unset → those reads run as govtech_app and return **0 rows** under RLS | **➕ ADD** (reference the `Postgres` service's own connection URL) |
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

## rfp-crm (FastAPI — CRM, build-out later)

Not part of the alpha customer path; its variables live on the `rfp-crm` service + `cms-postgres`.
Reconcile against Railway when the CRM is built out — the code-read set (see `docs/SECRETS_INVENTORY.md`):
`CMS_DATABASE_URL` (→ `cms-postgres`), `SHARED_DATABASE_URL` (→ main DB `system_events` bridge),
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
