# Pre-Launch Ops/Config Checklist

The code-side launch blockers are closed (the two-wave adversarial sweep: cross-tenant read/write
leaks + the offboarding bypass are fixed and DB-proven; onboarding / deliverable / library /
identity verified to the ≥3-scenario bar). What remains is **environment/config that can't be
verified from the codebase** — do these against **prod** before flipping the switch.

Set these once in your shell for the commands below:

```bash
export PROD_DATABASE_URL='postgres://…@…/govtech_intel'   # prod frontend+pipeline share this DB
# psql -Atc runs a query and prints just the value; swap in your own client if you prefer.
q() { psql "$PROD_DATABASE_URL" -Atc "$1"; }
```

---

## 1. Migrations applied + `user_memberships` backfilled  ← most load-bearing

The offboarding fix made proposal access **purely membership-based**. If mig 111 isn't applied +
backfilled in prod, non-admin users with no membership row are locked out of their own tenant.

**Verify the schema is current (head is **243** as of 2026-09-01 — this section was
written at 143; the check below is a floor, not a target):**
```bash
q "SELECT count(*) FROM _migration_history WHERE filename IN ('111_user_memberships.sql','143_proposal_sort_index.sql')"
# PASS = 2   (both present → schema is at least through 111 and 143)
q "SELECT filename FROM _migration_history ORDER BY filename DESC LIMIT 1"
# expect the highest to be 143_… (or later)
```

> **Why 143 matters for display:** it adds + backfills `proposal_sections.sort_index`, the integer
> key every section-ordering query now sorts on. Without it applied, the workspace/review/export
> section lists fall back to string-sorting `section_number` ("10" before "2") — the "numbering is
> fucked up" symptom — and any `ORDER BY sort_index` query errors on the missing column.

**Apply migrations if the count above is < 2** (idempotent — already-applied ones are skipped):
```bash
DATABASE_URL="$PROD_DATABASE_URL" node db/migrations/migrate.mjs
# ⚠ do NOT set ALLOW_SCHEMA_RESET — that runs the destructive 000_drop_all.
```

**Verify the backfill — the invariant that must hold (this is the one that bites):**
```bash
q "SELECT count(*) FROM users u
   WHERE u.is_active
     AND u.role NOT IN ('master_admin','rfp_admin')          -- platform admins use god-view, no membership needed
     AND NOT EXISTS (SELECT 1 FROM user_memberships m
                     WHERE m.user_id = u.id AND m.status = 'active')"
# PASS = 0   (every active tenant user has an active membership → nobody is locked out)
```
If this is **> 0**, those users cannot reach their tenant post-fix. Re-run the mig-111 backfill (or
insert the missing `home` memberships) before launch.

---

## 2. Email delivery is wired

**Superseded by the send seam (migration 215).** Every outbound message in both services now goes
through ONE seam — `frontend/lib/email/` and `services/cms/src/mailer` — which validates, resolves
the sender, checks suppression, **reserves a ledger row before dispatch**, sends, and confirms.
There is no "try provider A then provider B" any more: `EMAIL_DRIVER` selects `gmail` | `postmark` |
the committed emulator, and an unset variable defaults to `gmail`. (Resend survives only as an
in-driver fallback inside `gmail.ts`; it is not a provider you configure.)

**Postmark path (the intended production transport):**
```
EMAIL_DRIVER=postmark
POSTMARK_SERVER_TOKEN      # the SERVER token. The ACCOUNT token cannot send and 401s in a way
                           # that reads exactly like a wrong key.
POSTMARK_WEBHOOK_SECRET    # Postmark does not sign webhooks; Basic auth on the URL is the
                           # mechanism. Set the webhook to
                           #   https://postmark:<secret>@<host>/api/webhooks/postmark
```
**Gmail path (correspondence is pinned to this regardless of `EMAIL_DRIVER`):**
```
GOOGLE_CLIENT_ID   GOOGLE_CLIENT_SECRET   GOOGLE_REFRESH_TOKEN   GOOGLE_WORKSPACE_EMAIL
```

**Also required for deliverability:** DKIM and Return-Path DNS for the sending domain. Without
them delivery is a coin flip and `email_suppressions` fills with bounces that were never the
recipient's fault.

**Verify:** open **`/admin/crm`** (Marketing & Sales → Outbound Mail). It states the transport in
force, 30-day sent/failed counts, reserved-never-confirmed rows (a crash mid-send), webhook
callbacks, and the blocked-address list — reading through the seam, never the ledger tables
directly. PASS = a real send lands and the ledger row reads `sent`, not `skipped` or `failed`.

> Onboarding returns the temp password even when mail fails, so a customer is never fully locked
> out — but a silent `skipped` means nobody gets nudged, which defeats the automation. Treat
> `skipped` as a fail.

---

## 3. `ANTHROPIC_API_KEY` set — pipeline **and** frontend

- **Pipeline** (`agents/fabric.py:225`) **hard-raises** `"ANTHROPIC_API_KEY not set"` → every
  woken agent (section_drafter V0, compliance/color-team reviewers, librarian, scoring) fails.
- **Frontend** draft tool silently falls back to a **placeholder** scaffold (`model:'placeholder'`,
  no real draft) when the key is absent.

**Confirm which services reference it (sanity check):**
```bash
grep -rn "ANTHROPIC_API_KEY" pipeline/src frontend/lib frontend/app | grep -v node_modules
```
**Verify** the var is present in **both** the pipeline service and the frontend service env, then
**smoke-test**: release/provision a portal (or hit the draft route) and confirm a section comes back
with a **real model id, not `placeholder`**.
- PASS = key present in both services; a live draft returns a real Anthropic model id.

---

## 4. Opportunities are flowing (discovery isn't an empty shell)

A discovery product with no cards is a blank page. Confirm the ingestion/scout pipeline has put
opportunities on the forward-only bridge and that a real tenant's `/cards` is populated.

```bash
q "SELECT count(*) FROM opportunity_bridge"                          # PASS > 0  (opps fanned onto the bridge)
q "SELECT count(*) FROM tenant_opportunity_cards"                    # PASS > 0  (cards materialized per tenant)
q "SELECT count(DISTINCT tenant_id) FROM tenant_opportunity_cards"   # sanity: >= your launch tenants
# a specific launch tenant should have cards:
q "SELECT toc.tenant_id, count(*) FROM tenant_opportunity_cards toc
   GROUP BY 1 ORDER BY 2 DESC LIMIT 5"
```
**Confirm the pipeline is actually running** (fresh ingest activity, not a stale snapshot):
```bash
q "SELECT max(created_at) FROM system_events WHERE namespace = 'finder'"
# PASS = a recent timestamp (the ingest/scout loop is live), not days old
```
If cards are 0: run/enable the scout+ingest workers and confirm `solicitation.push` fan-out lands
cards (the bridge → tenant_opportunity_cards spine).

---

## Fast-follow (not tonight-blocking, but soon)

**~~`NOBYPASSRLS govtech_app` cutover~~ — DONE, and this entry was wrong for 107 migrations.**
Verified 2026-09-01 against the running box: the app connects as `govtech_app`, `rolbypassrls = f`.
The cutover landed in **migration 136** (19 force-RLS tables, 35 policies, the per-request
`SET app.tenant_id` context), and has since been extended by migs 171 · 173 · 184. Isolation is
**two-layer and enforced**, not single-layer resting on SQL predicates. Do not schedule this work;
it is finished. `node frontend/scripts/check-rls-posture.mjs` proves it on any box — it refuses to
report a verdict at all if the connection can bypass RLS. Mechanics: docs/RLS_CUTOVER.md.

**Foundation TVSF demo content is canonical only after a refresh.** Migration 140
(`gen-foundation-seed-migration.mjs` output) seeds the demo proposal, but that snapshot predates the
canonical 3-volume structure + the Q3/Q6 figures. A **fresh** deploy will seed the older content
(numbering is still correct — mig 143 backfills `sort_index`). To make the first-customer demo match
the delivered PDFs, either (a) `DATABASE_URL=<prod> node scripts/rebuild-tvsf.mjs`, or (b) regenerate
140 from a canonical sandbox (`node scripts/gen-foundation-seed-migration.mjs`; the generator now
auto-includes `sort_index` since the column exists) and land it as a new upsert migration. Not
launch-blocking — the demo is refreshable post-deploy.

---

### One-glance gate
| # | Item | Pass signal |
|---|------|-------------|
| 1 | Migrations + membership backfill | `_migration_history` has 111 & 143; **0** active tenant users without an active membership |
| 2 | Email wired | a real send reports `gmail`/`resend`, not `skipped` |
| 3 | `ANTHROPIC_API_KEY` | set in pipeline **and** frontend; live draft returns a real model, not `placeholder` |
| 4 | Opportunities flowing | bridge & cards **> 0**; `finder` events are fresh |

All four green → the ops side matches the now-green code side. Launch.
