# Dev Seed & Baseline Reset (runbook)

How to seed test accounts and (optionally) wipe `govtech_intel` to a clean, slop-free
baseline. **Validated** on a fresh local Postgres: clean DB → migrate → seed → all three
logins verified via the app's `bcryptjs.compare`.

> **Two databases, one reset.** `govtech_intel` (frontend + pipeline business data) is the
> only DB this touches. **`govtech_cms`** — the public marketing site / page-block content —
> is a **separate database and is NOT touched.** "Kill all but the public-facing pages" = reset
> `govtech_intel`; leave `govtech_cms` alone. (There are no public-page tables in
> `govtech_intel`; if you ever add public content there, tell me and we'll preserve it.)

## Accounts the seed creates

| Email | Role | Tenant | Password (DEV) |
|---|---|---|---|
| `eric@rfppipeline.com` | `master_admin` | — | `RFPAdmin` ⚠️ |
| `eric@lighthouse.com` | `tenant_admin` | Lighthouse (`grinder` tier, active) | `LighthouseAdmin` |
| `eric@ubihere.com` | `tenant_admin` | Ubihere (`grinder` tier, active) | `UbihereAdmin` |

Preserved (not seeded by this script, kept across a reset): `eric.c.wagner@gmail.com`
(`master_admin`, password `TestAdmin2026!` from migration 041).

- ⚠️ **`RFPAdmin` is 8 chars.** Login does **not** enforce length, so it works — but the
  *change-password* form requires **≥12 chars**, so you can't later re-set it to `RFPAdmin`.
  Override at seed time if you prefer: `RFP_ADMIN_PW='RFPAdmin2026!' …` (also `LIGHTHOUSE_PW`,
  `UBIHERE_PW`). `LighthouseAdmin` (15) and `UbihereAdmin` (12) already meet the minimum.
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

## Full baseline reset (DESTRUCTIVE — wipes all `govtech_intel` business data)

Stop the pipeline processor / any writers first, then:

```bash
# 0) BACKUP — the next step is an irreversible DROP SCHEMA
pg_dump "$INTEL_URL" > intel_backup_$(date +%F).sql

# 1) Drop + rebuild govtech_intel from migrations (000_drop_all runs ONLY with this flag).
#    Re-creates the schema + the baseline admin + structural seeds (automation rules,
#    process templates, compliance presets, …).
ALLOW_SCHEMA_RESET=true DATABASE_URL="$INTEL_URL" node db/migrations/migrate.mjs

# 2) Seed the real test accounts AND purge the leftover demo users
#    (apexdefense.test / techalliance.test). Keeps eric.c.wagner@gmail.com.
PURGE_DEMO=1 DATABASE_URL="$INTEL_URL" node scripts/seed_dev_accounts.mjs
```

After this, `govtech_intel` contains: a clean schema, the structural seeds, and exactly four
users (the two `master_admin`s + the two tenant admins) with two active tenants — **no test
opportunities, proposals, applications, events, or process instances.** `govtech_cms` is untouched.

### Note on the "slop"
A plain re-migrate re-seeds a little demo data via migrations `041/048/051`: migration **051**
already removes the demo *tenant* at launch, leaving only a few orphaned demo *users* —
which `PURGE_DEMO=1` clears. If you'd rather the demo never seed at all on a clean build, the
cleaner long-term fix is to gate migration 041 behind an env flag; say the word and I'll wire it.
