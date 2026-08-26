# Secrets & Config Inventory

Every environment variable the system reads, swept from the code across all three services
(frontend Next.js · pipeline Python · CMS FastAPI). Names + purpose + where to get each — **no
values** (fill them in Railway service settings, not here). `[R]` = required for that capability to
work, `[opt]` = has a default or enables a deferred feature.

Legend for "have it?": ✅ you already have · ⚙️ auto-injected by Railway · 🔲 you must obtain/set.

---

## A. Core — the app won't run / core value is broken without these

| Var | Service(s) | Powers | Have it? |
|-----|-----------|--------|----------|
| `DATABASE_URL` | frontend, pipeline | the shared Postgres (`govtech_intel`) | ✅ |
| `AUTH_SECRET` (a.k.a. `NEXTAUTH_SECRET`) | frontend | signs session JWTs — `openssl rand -base64 32` | 🔲 confirm set in prod |
| `API_KEY_ENCRYPTION_SECRET` | frontend **+** pipeline (SAME value) | AES-256 encrypts API keys stored in the DB (frontend encrypts, pipeline decrypts) — `openssl rand -base64 32` | 🔲 confirm identical on both |
| `ANTHROPIC_API_KEY` | frontend, pipeline, **CMS** | all AI: drafting, shredding, compliance/color-team review, opportunity analysis, CMS content | ✅ in Railway — 🔲 confirm on **all three** services (or load via admin Sources UI — the encrypted DB copy takes priority) |
| `ANTHROPIC_BASE_URL` | frontend, pipeline, CMS | `[opt]` Anthropic API base-URL override (default `api.anthropic.com`); points at a gateway or the sandbox emulator (`:8787`) | — leave unset in prod |
| `AWS_ACCESS_KEY_ID` · `AWS_SECRET_ACCESS_KEY` · `AWS_DEFAULT_REGION` · `AWS_ENDPOINT_URL` · **`AWS_S3_BUCKET`** (the name Railway's bucket service injects; code also accepts legacy `AWS_S3_BUCKET_NAME`) | frontend, pipeline | Cloudflare R2 object store — uploads, exports, atomize, all files | ⚙️ auto-injected when the R2 bucket service is **linked** to frontend + pipeline (reading only the legacy name was the recurring "`AWS_S3_BUCKET_NAME is required`" prod error — now fixed) |
| `AUTH_URL` / `NEXTAUTH_URL`, `NEXT_PUBLIC_APP_URL` | frontend | auth redirects + public app URL — set to the real Railway domain | 🔲 |
| `PORTAL_BASE_URL` | pipeline | the base URL baked into nudge/notification links | 🔲 |
| `MASTER_ADMIN_EMAIL` · `INITIAL_MASTER_ADMIN_PASSWORD` | pipeline | seeds the first master_admin (mig 124 forces a reset on first login) | 🔲 set once |

---

## B. Discovery — so opportunities actually flow (else `/cards` is empty)

The ingest layer is **multi-source** (`pipeline/src/ingest/dispatcher.py` registry: `dsip`, `sam_gov`,
`sbir_gov`, `grants_gov`) and a source is turned **on by SCHEDULING it on the admin Sources page**
(writes a `pipeline_schedules` cron row) — **not** by an env var. So which key you need depends on
which source you enable:

| Source | Needs a key? | Notes |
|--------|--------------|-------|
| **DSIP** (`DsipIngester`) — DoD SBIR/STTR Innovation Portal | **NO** — public API `dodsbirsttr.mil/topics-app/api/public/topics` (+ HTML fallback) | **This is the recommended source; needs zero secrets.** Enable + schedule it and topics ingest. |
| `sbir.gov`, `grants.gov` | No (public) | Additional keyless sources if you want breadth. |
| `SAM_GOV_API_KEY` (`sam_gov`) | Yes (register at sam.gov) | **Optional / skip** — only if you enable the SAM.gov source. Not being used. |

Plus a **source-agnostic manual path**: an admin can upload a solicitation + topic files
(`/api/admin/upload-topic-files`, `rfp-upload`) → opportunities, with no scraper at all — useful to
seed discovery on day one.

**Net: discovery needs no new secret** — enable DSIP (+ optionally sbir/grants) on the Sources page
and set a daily schedule. `SAM_GOV_API_KEY` is dropped.

---

## C. Email — the sweep + nudge + multi-mailbox system (your ask)

**Good news: this is already built.** `services/cms/src/workers/gmail_client.py` has all three scopes
(`gmail.send` + `gmail.readonly` + `gmail.modify`), impersonates any `@rfppipeline.com` mailbox via
domain-wide delegation (`with_subject`), and there's a running inbox `email_sweep` worker + a
two-voice sender model. It needs **one credential** to switch on.

| Var | Service | Powers | Have it? |
|-----|---------|--------|----------|
| `GOOGLE_SERVICE_ACCOUNT_JSON` (or `GOOGLE_SERVICE_ACCOUNT_PATH`) | CMS | **THE key that unlocks everything**: send-as + inbox sweep across *multiple* mailboxes. A GCP service-account key JSON. | 🔲 |
| `GOOGLE_WORKSPACE_EMAIL` | CMS, frontend | default mailbox to impersonate — `platform@rfppipeline.com` | 🔲 |
| `SENDER_AUTOMATION_EMAIL` / `SENDER_ENGAGEMENT_EMAIL` / `SENDER_CMS_SERVICE_EMAIL` | CMS | the two voices: `automation@` (robot: nudges/alerts/sweeps) vs `eric@` (human: onboarding/campaigns/replies) — see docs/EMAIL_SENDERS.md | 🔲 (defaults exist) |
| `ADMIN_NOTIFICATION_EMAIL` | frontend, CMS | where system/admin alerts land | 🔲 |

**One-time external setup** (manual, no code — see `docs/EMAIL_SENDERS.md`):
1. Create a **GCP service account**, download its key → that JSON is `GOOGLE_SERVICE_ACCOUNT_JSON`.
2. **Domain-wide delegation** in Google Workspace admin → Security → API controls → add the SA's
   client ID with scopes `gmail.send`, `gmail.readonly`, `gmail.modify`. This lets it act as
   `platform@`, `eric@`, `automation@`, etc. — **the mechanism that "sweeps both mailboxes."**
3. **Provision the mailboxes**: `automation@`, `eric@` (have), `platform@` (have), optionally `heather@`.
4. **DNS for rfppipeline.com** (not a secret, but required or mail is spam-filtered): SPF
   `v=spf1 include:_spf.google.com ~all`, DKIM (Workspace-generated), DMARC.

> Alternative single-mailbox send-only path (already used by the frontend welcome email):
> `GOOGLE_CLIENT_ID` · `GOOGLE_CLIENT_SECRET` · `GOOGLE_REFRESH_TOKEN` · `GOOGLE_WORKSPACE_EMAIL`
> (OAuth), or `RESEND_API_KEY` as a fallback provider. These SEND from one box but can't SWEEP or
> impersonate multiple mailboxes — use the service-account path (C) for the full vision.
> Social posting (X/LinkedIn) is future: the CMS `social_scheduler` exists but per-network API
> credentials aren't wired yet.

---

## D. CMS service (only if the CMS/CRM is exposed in prod)

| Var | Purpose |
|-----|---------|
| `CMS_DATABASE_URL` | the `rfp-crm` service's own Postgres (`cms-postgres`) |
| `SHARED_DATABASE_URL` | the shared `system_events` bridge back to the main DB |
| `CMS_API_KEY` | service-to-service auth (frontend → CMS) |
| `CMS_JWT_SECRET`, `CMS_AUTH_MODE`, `CMS_BASIC_USER`, `CMS_BASIC_PASS` | CMS admin auth |
| `REVALIDATE_SECRET` | frontend↔CMS ISR revalidation (same value both sides) |
| `CMS_STORAGE_ROOT` | CMS media volume (default `/data/cms`) |
| `POSTMARK_SERVER_TOKEN` | the transactional transport — **Server** token, not the Account token |
| `POSTMARK_WEBHOOK_SECRET` | shared secret on the delivery webhook (frontend route; Basic auth on the URL) |
| `ALLOWED_ORIGINS`, `CMS_PUBLIC_URL`, `FRONTEND_URL` | CORS + cross-service URLs |

---

## E. Optional / tuning (sensible defaults — set only to override)

`CLAUDE_MODEL` (default claude-sonnet-4) · `SHREDDER_MODEL` · `EMBEDDINGS_PROVIDER` +
`OPENAI_API_KEY` (only if you pick the OpenAI embeddings provider) ·
**image-atom enrichment** (boxed/uploaded images → searchable text): `ATOM_OCR=off` disables the
offline Tesseract OCR (default on; model vendored in `frontend/ocr-data/`, override dir via
`OCR_LANG_PATH`/`OCR_CACHE`) · `ATOM_VISION=off` disables the Claude vision-caption that
complements OCR (default on **when `ANTHROPIC_API_KEY` is present**; picks `VISION_MODEL`, default
`claude-sonnet-4-20250514`) · `IPINFO_TOKEN` (geo
enrichment) · `SOFFICE_PATH` / `SOFFICE_TIMEOUT` (LibreOffice doc conversion) · `LOG_LEVEL` ·
`HEALTH_PORT` · `EVENT_POLL_INTERVAL` / `GENERATION_POLL_INTERVAL` · `USE_STUB_DATA` (dev only) ·
`RAILWAY_*` (auto-injected) · `AGENT_DATABASE_URL` (the NOBYPASSRLS `rfp_agent` agent role — for the
post-launch RLS cutover).

## F. Descoped — do NOT need for launch

`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_SPOTLIGHT_PRICE_ID`,
`STRIPE_PROPOSAL_P1_PRICE_ID`, `STRIPE_PROPOSAL_P2_PRICE_ID`, `STRIPE_CONSULTING_PRICE_ID` —
self-serve Stripe checkout is descoped (comp-code launch). Add when you turn on payments.

---

## What you still need to obtain (the short list)

1. **`GOOGLE_SERVICE_ACCOUNT_JSON` + Workspace domain-wide delegation** → unlocks send-as +
   inbox-sweep of `platform@` and `eric@`, and the whole nudge/template engine (already coded).
   **This is the only real acquisition.**
2. **Generate + set `AUTH_SECRET` and `API_KEY_ENCRYPTION_SECRET`** (the latter identical on
   frontend + pipeline); confirm **`ANTHROPIC_API_KEY` on all three** services and the **R2 bucket
   linked** to frontend + pipeline.
3. **DNS SPF/DKIM/DMARC** for rfppipeline.com (deliverability).
4. **`MASTER_ADMIN_EMAIL` / `INITIAL_MASTER_ADMIN_PASSWORD`** once, to bootstrap the first admin.
5. **Discovery = no secret** — enable + schedule the **DSIP** source on the admin Sources page
   (public API, keyless). `SAM_GOV_API_KEY` is not needed.

Everything else is either already in place, auto-injected by Railway, defaulted, or descoped.
