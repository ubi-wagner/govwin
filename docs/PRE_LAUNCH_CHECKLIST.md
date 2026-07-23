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

**Verify the schema is current (through mig 129):**
```bash
q "SELECT count(*) FROM _migration_history WHERE filename IN ('111_user_memberships.sql','129_backfill_automation_policies.sql')"
# PASS = 2   (both present → schema is at least through 111 and 129)
q "SELECT filename FROM _migration_history ORDER BY filename DESC LIMIT 1"
# expect the highest to be 129_… (or later)
```

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

`lib/email.ts` tries **Gmail API first, then Resend, else returns `provider:'skipped'`** (a silent
no-op). Nudges, final-notices, and the welcome-email-with-temp-password all depend on this. Set
**one** provider fully.

**Gmail path — all four required:**
```
GOOGLE_CLIENT_ID   GOOGLE_CLIENT_SECRET   GOOGLE_REFRESH_TOKEN   GOOGLE_WORKSPACE_EMAIL
```
**or Resend path:**
```
RESEND_API_KEY
```

**Verify the vars are set in the FRONTEND service** (that's what sends), then do a **real send** and
confirm the provider is not `skipped`:
- Trigger a known send (accept a throwaway application, or invite yourself as a collaborator).
- PASS = the email arrives AND the API response / logs show `provider: 'gmail'` or `'resend'`
  (NOT `'skipped'`, NOT `emailFailed: true`).

> Note: onboarding now returns the temp password even if email fails (sweep F1 fix), so a customer
> is never fully locked out — but a silent `skipped` means **no one gets nudged**, which defeats the
> whole automation value prop. Treat `skipped` as a fail.

---

## 3. `ANTHROPIC_API_KEY` set — pipeline **and** frontend

- **Pipeline** (`agents/fabric.py:203`) **hard-raises** `"ANTHROPIC_API_KEY not set"` → every
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

**`NOBYPASSRLS govtech_app` cutover.** The app runs as the RLS-bypassing owner, so tenant isolation
currently rests on the SQL `WHERE tenant_id` predicates — which the sweep just audited to be
complete (35 tenant tables, ~72 routes; the only 2 gaps are fixed). That makes single-layer
**defensible** for launch, but the cutover to the `NOBYPASSRLS` role is the belt-and-suspenders
backstop (checklist in `docs/DEPRECATION_CLEANUP_2026-07-22.md`). Schedule it right after go-live.

---

### One-glance gate
| # | Item | Pass signal |
|---|------|-------------|
| 1 | Migrations + membership backfill | `_migration_history` has 111 & 129; **0** active tenant users without an active membership |
| 2 | Email wired | a real send reports `gmail`/`resend`, not `skipped` |
| 3 | `ANTHROPIC_API_KEY` | set in pipeline **and** frontend; live draft returns a real model, not `placeholder` |
| 4 | Opportunities flowing | bridge & cards **> 0**; `finder` events are fresh |

All four green → the ops side matches the now-green code side. Launch.
