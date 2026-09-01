# Alpha HITL Runbook — first human test (Monday)

**Purpose.** A step-by-step script for a full human-in-the-loop test of the founding-cohort
core value loop: **ingest an opp → skeleton it (matrix + volumes + templates/molds) → push →
customer signs up & sees mirrored cards → customer library (upload→atomize→buckets→pin) →
provision → release → build (draft→lock) → download** — plus the admin scout/source surface and
the event/automation audit. Every step lists the **action**, the **expected result**, and a
**PASS/FAIL** box. "⚠ known-issue" marks a step that will visibly not work yet (descoped for Alpha,
tracked in `docs/archive/ALPHA_TODO_BACKLOG.md`) so it doesn't read as a regression.

Driven-verified in the sandbox before writing this: onboarding (accept→temp-password→cards mirror),
provision→release, skeleton-template→mold interpolation, docx download, per-card-per-bucket scoring,
pin→S3 copy, and the compliance matrix. Bug classes squashed pre-test: the jsonb string-scalar class
(56 writes), the `'t':'f'}::bool` edit no-op (3 tools), a phantom `tenant_memberships` query.

---

## §0. Scope

**In-scope for Alpha (test these):** account approval → login; admin source management; opp
create/curate/skeleton/push; signup card-mirror; customer library (upload/atomize/buckets/pin);
admin-provision → release → customer build → lock → download; event audit + workflow instances.

**Descoped for Alpha (do NOT test — tracked as ToDos):** self-serve **live Stripe checkout** (the
founding cohort buys via the **comp-code purchase → curation → release** loop — see T5 and
`HITL_IMMOBILEYES_CLICKPLAN.md`); **web-search new-source discovery**; the **daily scout
scheduler** + **email digests** (require prod cron + a verified email provider); automated **amendment /
post-push-topic re-propagation** (admin updates propagate; the *automated ingester* path does not yet);
atoms→bucket **context**; pinned-opp **push nudges**; PDF export. See §4 watchlist.

---

## §1. Environment setup

The three services (frontend Next.js, Python pipeline worker, CMS FastAPI) share one Postgres.
For the Alpha test, run **frontend + pipeline + Postgres** (CMS only needed for outbound email, which
is descoped). Two ways to run:

### Option A — sandbox/local (what was used to verify)
```
# 1. Postgres (pgvector image) up; create a fresh DB
createdb govtech_alpha   # or reuse the scratch DB

# 2. Apply ALL migrations (000 → 108) — order matters
node db/migrations/migrate.mjs         # reads DATABASE_URL; tracked in _migration_history

# 3. Seed dev accounts + fixtures
node scripts/seed_dev_accounts.mjs     # 2 tenants + admins (idempotent)
psql "$DATABASE_URL" -f scripts/e2e_fixtures.sql   # optional demo opps/atoms

# 4. Frontend
cd frontend && npm ci && npx next build && npx next start -p 3000
#   env: DATABASE_URL, AUTH_SECRET, NEXTAUTH_SECRET, AUTH_URL, NEXTAUTH_URL (=AUTH_URL),
#        ANTHROPIC_API_KEY, AWS_S3_BUCKET_NAME (+AWS keys/region/endpoint)

# 5. Pipeline worker (for AI draft + workflow instances + task queue)
cd pipeline && python src/main.py
#   env: DATABASE_URL, ANTHROPIC_API_KEY, API_KEY_ENCRYPTION_SECRET (=frontend's)
```

### Option B — Railway (prod-like)
Follow the corrected env list in the **launch config checklist** (`docs/archive/LAUNCH_READINESS_AND_10DAY_PLAN_2026-07-04.md` §5).
**Pre-flight:** target Postgres has **pgvector** + the role can `CREATE EXTENSION`; set `NEXTAUTH_URL`
(else post-login/Stripe/invite links go to localhost); set the frontend `ANTHROPIC_API_KEY` and
`AWS_S3_BUCKET_NAME` (its absence 500s any storage route at import); set the Stripe price IDs under the
**code's** names (`STRIPE_SPOTLIGHT_PRICE_ID`, `STRIPE_PROPOSAL_P1_PRICE_ID`, …) not the `.env.example` names.

**Health check before starting:** `GET /api/health` (frontend) returns 200 and its body shows DB + S3
reachable; pipeline `GET :8080/health` returns ok; `SELECT max(filename) FROM _migration_history` = `104_…`.

---

## §2. Personas

| Role | Login | Use for |
|---|---|---|
| `master_admin` / `rfp_admin` | seeded admin (e.g. `eric@rfppipeline.com`) | ingest, curate, skeleton, push, approve accounts, provision, release |
| `tenant_admin` (customer) | created by the approval step (T1), temp password | library, buckets, pin, build, lock, download |
| `partner_user` (collaborator / EconDev) | invited from a proposal | stage-scoped review |

---

## §3. The end-to-end script

### T1 — Public → apply → approve → login  *(role: prospect → rfp_admin → new customer)*
1. **(anon)** Load `/`, `/pricing`, `/how-it-works`, `/apply`. → **Expect:** all render. `[PASS/FAIL]`
2. **(anon)** Submit `/apply` (fill company/contact/tech-summary ≥20 chars, accept T&C with a matching
   email). → **Expect:** success panel; an `applications` row `status='pending'`. `[PASS/FAIL]`
3. **(rfp_admin)** `/admin/applications` → open the app → **Accept** (notes ≥10 chars). → **Expect:** a
   green panel showing the **temp password** (visible even if email is off), a new tenant + `tenant_admin`
   user, and (immediately) **the opportunity river mirrored onto the new tenant** — `cardsBackfilled` > 0
   in the response. `[PASS/FAIL]`
4. **(new customer)** `/login` with the contact email + temp password → forced to `/change-password` →
   set a new password → lands on `/portal/<slug>/dashboard`. → **Expect:** no bounce; cannot reach another
   tenant's portal. `[PASS/FAIL]`

### T2 — Admin source management  *(role: rfp_admin)*
5. `/admin/sources` → **Expect:** seeded baseline sources (DSIP, SBIR.gov, SAM.gov) list. `[PASS/FAIL]`
6. Open a source → add a **region annotation** (point-and-mark) → **Scout now**. → **Expect:** a
   `pipeline_jobs kind='scout_source'` enqueued; the worker runs it; a `source_snapshots` baseline row.
   `[PASS/FAIL]`  ⚠ *The daily auto-scout + email digest are descoped (manual scout works).*

### T3 — Opp river: create → skeleton → push → mirror  *(role: rfp_admin → new customer)*
7. **Ingest / create an opp:** `/admin/rfp-curation/upload` (upload an RFP PDF) **or** the intake form. → **Expect:**
   an `opportunities` row + a `curated_solicitations` (`status='new'`) row; RFP doc stored. `[PASS/FAIL]`
   ⚠ *A duplicate-title upload with empty description currently 500s (B1) — use distinct titles.*
8. **Curate the skeleton** in `/admin/rfp-curation/<solId>`:
   a. Add a **volume** (e.g. "Technical") + a **required item** ("Technical Approach", `word_doc`, page
      limit 15). → **Expect:** persisted. `[PASS/FAIL]`
   b. Set **compliance variables** (e.g. font 11pt, margins) in the right sidebar. → **Expect:** saved
      (these edits now persist — the silent-edit no-op was fixed). `[PASS/FAIL]`
   c. **(Optional, the differentiator)** author a **document template** and **link it** to the required
      item, set an **expert note**. *Alpha note:* the in-app template **picker** is not in the curation
      modal yet (ToDo); to exercise the wiring, link via the tool (`volume.update_required_item` with
      `templateId`+`expertNotes`) or verify at provision that the mold pre-fills. → **Expect at T5:** the
      section comes up `ai_drafted` with the template interpolated (`{company_name}`→tenant) + the expert
      note in `section.meta`. `[PASS/FAIL]`
9. **Approve + push:** approve curation → `solicitation.push`. → **Expect:** the topic set fans out — a
   `tenant_opportunity_cards` row per active tenant (auto-scored). `/admin/cards` shows bridge version +
   replicant count. `[PASS/FAIL]`
10. **Mirror on signup (already done in T1):** the customer's `/portal/<slug>/cards` shows the non-archived
    opp river as thin cards. → **Expect:** non-empty. `[PASS/FAIL]`
11. **Update propagation:** as admin, `/admin/cards` → change an opp's **close date** or **stage**, or
    **archive** it. → **Expect:** the customer card updates (new bridge version); an archived opp disappears
    from `/cards` (still visible with `?includeClosed=true`); a pinned card flips "Update available".
    `[PASS/FAIL]`  ⚠ *Automated-ingester amendments / post-push topic additions do NOT auto-propagate yet
    (B3/B4) — admin edits here do.*

### T4 — Customer library: upload → atomize → buckets → ranks → pin  *(role: tenant_admin)*
12. `/portal/<slug>/atoms` → **Atomize** tab → upload a `.docx` → select blocks → tag a `vol` → **Create**.
    → **Expect:** `library_atoms` rows (a `reference` + your primitives), scoped to the tenant. `[PASS/FAIL]`
13. `/portal/<slug>/buckets` → create 1–5 **Spotlight buckets** (agency/programType/keywords). → **Expect:**
    each opp card carries a **rank per bucket** (one card, up-to-5 bucket scores — not 5 cards). `[PASS/FAIL]`
    ⚠ *The `/cards` page does not yet render the numeric rank inline (data is there; ToDo); check per-bucket
    ranks on the Buckets page. Attaching library atoms as bucket "context" is a ToDo.*
14. On a card, **Pin (copy docs)**. → **Expect:** the solicitation docs are copied into the tenant's S3
    space (`customers/<slug>/pinned/<oppId>/…`) + a `copied_docs` manifest. `[PASS/FAIL]`
    ⚠ *Pinned-opp push **nudges** to the user are a ToDo (the amber "Update available" badge works).*

### T5 — Provision → release → build → lock → download  *(role: rfp_admin → tenant_admin)*
> **Purchase model (updated this cycle).** The founding cohort now buys via the **comp-code purchase →
> `curation_pending` (72h SLA) → shadow release** loop — not silent admin-provision. The authoritative
> end-to-end sequence (customer pin → purchase `rfppipelinetest` → wait UI → admin ToDo → release →
> V0→V1) is `docs/HITL_IMMOBILEYES_CLICKPLAN.md`, designed in `docs/MASTER_MIRROR_OPP_DESIGN.md`. Live
> Stripe checkout is still descoped; the comp code stands in. Steps 15–20 below are what happens
> **after** release (provision→build→lock→download); the purchase + wait + ToDo that precede them are
> in the click-plan.
15. **(rfp_admin)** Provision a proposal for the customer against the curated opp — via the portal-launch
    accept flow (`/portal/<slug>/portals/<id>?action=accept`) **or** `POST /api/portal/<slug>/proposals/create`.
    → **Expect:** a `proposals` row, `proposal_artifacts` per volume, `proposal_sections` per required item, a
    **compliance matrix** (rows `not_addressed`), templates interpolated into molds (from T8c). `[PASS/FAIL]`
16. **Release to the customer** (if the provision path created it locked): as rfp_admin, DELETE the proposal
    lock (the initial "release" — now permitted at `lock_count=0`) → the customer gets an editable workspace
    (+ a "ready" email if email is configured). → **Expect:** `is_locked=false`, customer can edit. `[PASS/FAIL]`
    *(The greenfield portal-launch path provisions already-editable; the release step applies to the
    admin-create path.)*
17. **(optional) EconDev/manager review:** invite a `partner_user` reviewer on the proposal with stage-scoped
    access. → **Expect:** the reviewer sees only their stage. `[PASS/FAIL]`  ⚠ *A dedicated "manager gate"
    role is a ToDo; the partner_user reviewer is the Alpha stand-in.*
18. **(customer)** Build: open a section → run **AI draft** (needs `ANTHROPIC_API_KEY`) → nodes fill; run
    **compliance check** → inline score. Save (optimistic-lock). → **Expect:** content + `section.saved`.
    `[PASS/FAIL]`
19. **(customer)** **Accept & Lock All** sections → advance **draft → final** (auto-locks → `submitted`,
    downloads enabled). → **Expect:** sections `approved`, matrix → `satisfied`, library harvest fires.
    `[PASS/FAIL]`
20. **(customer)** **Download Proposal (.docx)** → **Expect:** a real Word document (not a `.json`); opens in
    Word with headings/tables/TOC. `[PASS/FAIL]`  ⚠ *PDF export is a ToDo (docx only).*

### T6 — Event + automation audit  *(role: master_admin)*
21. `/admin/events` (or query `system_events`) → **Expect:** events posting across the run with real
    payloads (objects, not string scalars — the jsonb class was squashed): `capture:application.accepted`,
    `capture:tenant.cards_backfilled`, `finder:*` (source/opp/topic), `proposal:proposal.created/locked`,
    `tool:invoke.*`. `[PASS/FAIL]`
22. `/admin/workflows` (or `process_instances`) → **Expect:** the workflow engine created instances carrying
    `opportunity_id` (e.g. `OnProposalCreated` → `draft_v0`, `ProjectCollaboration`). `[PASS/FAIL]`

---

## §4. Known-issue watchlist (expected "not working" — not regressions)
- Self-serve **live** Stripe checkout (founding cohort uses the comp-code purchase→curation→release loop — see `MASTER_MIRROR_OPP_DESIGN.md`).
- Daily scout scheduler + email digests + web-search new-source discovery.
- Automated-ingester amendment / post-push-topic re-propagation (admin edits DO propagate).
- `/cards` inline numeric rank; atoms→bucket context; pinned-opp push nudges.
- In-app template picker in the curation modal (wiring works via tool/provision).
- PDF export; dedicated EconDev "manager" role.
- Duplicate-title RFP upload with empty description → 500 (use distinct titles).

## §5. Reset between runs
```
# fresh DB from scratch (safest):
dropdb govtech_alpha && createdb govtech_alpha && node db/migrations/migrate.mjs \
  && node scripts/seed_dev_accounts.mjs && psql "$DATABASE_URL" -f scripts/e2e_fixtures.sql
# or targeted: delete the test tenant's proposals/portals/cards (see scripts/e2e_fixtures.sql for ids).
```

*Every PASS/FAIL that FAILS: capture the URL, the network response (status + body `error`/`code`), and the
server log line — file it against `docs/archive/ALPHA_TODO_BACKLOG.md`.*
