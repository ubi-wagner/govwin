# Dev Seed & Baseline Reset (runbook)

How to seed test accounts and (optionally) wipe `govtech_intel` to a clean, slop-free
baseline. **Validated** on a fresh local Postgres: clean DB → migrate → seed → all three
logins verified via the app's `bcryptjs.compare`.

> **The public site lives in `govtech_intel` — same DB as the slop.** The front-facing
> marketing/site pages are served by the **Next.js frontend** from `govtech_intel` tables
> **`content_pages`** + **`cms_content`** (via `lib/cms.ts` / `app/(marketing)`), edited live in
> **`/admin/site`**, and **migration-seeded** as the launch baseline by `032`/`059`/`064`
> (`064 = republish_launch_baseline`). A clean re-migrate currently holds **54 `content_pages`**
> (14 active pages, 9 resources, 4 guides, 3 blog posts, 1 team member) + **130 `cms_content`** rows.
>
> **`govtech_cms`** (the FastAPI CMS/CRM DB) is **NOT the public site** — it's the parked
> post-alpha CRM, out of the alpha path. So "kill all but the public-facing pages" means: keep
> `content_pages`/`cms_content` in `govtech_intel`, kill the business/transactional rows around them.
> There are **two ways** to do that — pick by whether you've made runtime `/admin/site` edits that
> must survive (see "Two reset options" below).

## Accounts the seed creates

| Email | Role | Tenant | Password (DEV) |
|---|---|---|---|
| `eric@rfppipeline.com` | `master_admin` | — | `RFPAdmin2026!` |
| `eric@lighthouse.com` | `tenant_admin` | Lighthouse (`grinder` tier, active) | `LighthouseAdmin` |
| `eric@ubihere.com` | `tenant_admin` | Ubihere (`grinder` tier, active) | `UbihereAdmin` |

Preserved (not seeded by this script, kept across a reset): `eric.c.wagner@gmail.com`
(`master_admin`, password `TestAdmin2026!` from migration 041).

- `RFPAdmin2026!` (13 chars) satisfies both login and the ≥12-char change-password form.
  `LighthouseAdmin` (15) and `UbihereAdmin` (12) also meet the minimum. Override any at seed time:
  `RFP_ADMIN_PW=… LIGHTHOUSE_PW=… UBIHERE_PW=… node scripts/seed_dev_accounts.mjs`.
- All three are seeded with `temp_password=false`, so there's **no forced password-change wall** —
  they log in straight to the portal/admin.
- `@lighthouse.com` / `@ubihere.com` are **fake inboxes** (no mail delivered). `@rfppipeline.com`
  is **real** — seeding sends nothing, but once active it receives live nudge/system emails.

## Seed only (additive, idempotent — safe to re-run)

```bash
DATABASE_URL="$INTEL_URL" node scripts/seed_dev_accounts.mjs
```

`ON CONFLICT` upserts: re-running rotates the passwords and re-asserts role/tenant. Passwords
are hashed in Postgres via pgcrypto `crypt()/gen_salt('bf',12)` → `$2a$` bcrypt, verified by the
app's `bcryptjs`.

## Two reset options (pick by whether runtime `/admin/site` edits must survive)

Because the public site lives in `govtech_intel`, the choice is: rebuild it to the migration
baseline, or preserve its current rows. Stop the pipeline processor / any writers first.

### Option A — Full schema reset (cleanest; public site → launch baseline)

Rebuilds EVERYTHING from migrations, including the public site (re-published from `064`). Wipes
ALL business slop **and** any runtime `/admin/site` content edits made since the last baseline
migration. Use when the migration launch-baseline IS your desired public content.

```bash
# 0) BACKUP — the next step is an irreversible DROP SCHEMA
pg_dump "$INTEL_URL" > intel_backup_$(date +%F).sql
# 1) Drop + rebuild govtech_intel (000_drop_all runs ONLY with this flag). Re-seeds the schema,
#    the baseline admin, the structural seeds, AND the public content_pages/cms_content baseline.
ALLOW_SCHEMA_RESET=true DATABASE_URL="$INTEL_URL" node db/migrations/migrate.mjs
# 2) Seed the real test accounts + purge the leftover demo users (keeps eric.c.wagner@gmail.com).
PURGE_DEMO=1 DATABASE_URL="$INTEL_URL" node scripts/seed_dev_accounts.mjs
```

End state: clean schema + structural seeds + the **public site at its launch baseline** + exactly
four users (two `master_admin` + two `tenant_admin`) and two active tenants — **no test
opportunities, proposals, applications, events, or process instances.**

### Option B — Targeted business-data wipe (preserves the public site AS-IS)

Keeps `content_pages`, `cms_content`, `page_views`, `content_events`, the structural seeds, and
the admin users **exactly as they are**, and `TRUNCATE … CASCADE`s only the business/transactional
tables (tenants, proposals + sections/artifacts/comments/collaborators, opportunities + curated
solicitations/documents, tenant_pipeline_items, applications, tasks, process_instances + transitions,
system_events, library_units, contracts, agent_task_*). Use when you've published `/admin/site`
edits you want to keep. **Not scripted yet** — I'll generate the exact, FK-ordered truncate list
(validated against the schema) once we confirm this is the path.

### Note on the demo "slop"
A plain re-migrate re-seeds a little demo data via migrations `041/048/051`: migration **051**
already removes the demo *tenant* at launch, leaving only a few orphaned demo *users* — which
`PURGE_DEMO=1` clears. To stop the demo seeding at all on a clean build, the cleaner long-term fix
is to gate migration 041 behind an env flag; say the word and I'll wire it.
