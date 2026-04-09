# Migrations Runbook

Exact commands for applying database migrations across the three environments (throwaway test PG, local docker-compose PG, Railway production PG). No prose — paste-and-run.

See also: [RAILWAY.md](../RAILWAY.md) for the full deployment walkthrough.

---

## Throwaway test PG (for CI + local verification)

Used by vitest integration tests and by developers verifying a new migration before committing.

```bash
# Start a temporary PG16 instance on a unix socket (non-root user required)
mkdir -p /tmp/pgtest && chown -R postgres:postgres /tmp/pgtest
su - postgres -c "/usr/lib/postgresql/16/bin/initdb -D /tmp/pgtest/data --auth=trust --encoding=UTF8 -U postgres"
su - postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D /tmp/pgtest/data -l /tmp/pgtest/pg.log -o '-k /tmp/pgtest -p 55432 -h \"\"' start"

# Apply a single migration
PSQL="psql -h /tmp/pgtest -p 55432 -U postgres -d postgres -v ON_ERROR_STOP=1"
$PSQL -f db/migrations/007_system_events.sql

# Apply the whole sequence
for f in db/migrations/0*.sql; do $PSQL -f "$f"; done

# Verify a table
$PSQL -c "\d system_events"

# Re-run a migration to verify idempotency (must succeed)
$PSQL -f db/migrations/007_system_events.sql

# Shut down + clean up
su - postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D /tmp/pgtest/data stop"
rm -rf /tmp/pgtest
```

---

## Local docker-compose PG

For running the full frontend + pipeline stack locally.

```bash
# Start everything
docker compose up -d

# Verify migrations applied on first boot (via the /docker-entrypoint-initdb.d mount)
docker compose exec db psql -U govtech -d govtech_intel -c "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename;"

# Apply a NEW migration after the stack is already up (init-time mount only runs on first volume init)
docker compose exec -T db psql -U govtech -d govtech_intel < db/migrations/009_new_thing.sql

# Or run the local migrator that calls run.sh against the local DB
DATABASE_URL=postgresql://govtech:changeme@localhost:5432/govtech_intel bash db/migrations/run.sh

# Nuke and re-init (force a fresh schema, triggers re-run of all init-mount migrations)
docker compose down -v
docker compose up -d
```

---

## Railway production PG

The canonical production path is the GitHub Actions `migrate.yml` workflow, which auto-applies migrations on every push to `main` that touches `db/migrations/**`. The workflow uses the `DATABASE_URL` repo secret.

### Automatic (preferred)

1. Commit a new migration file under `db/migrations/`
2. Open a PR, merge to `main`
3. GitHub Actions triggers the `migrate.yml` workflow
4. Watch the Actions tab — it applies the new migration to Railway Postgres

### Manual (fallback, for debugging)

```bash
# Fetch the Railway DATABASE_URL
# Railway Dashboard → Postgres service → Variables → DATABASE_URL (copy the value)
export DATABASE_URL="postgresql://postgres:...@autorack.proxy.rlwy.net:5432/railway"

# Apply a single migration
psql "$DATABASE_URL" -f db/migrations/009_new_thing.sql

# Apply the whole sequence (using the checked-in runner)
bash db/migrations/run.sh

# Verify a query
psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM system_events WHERE created_at > now() - interval '1 hour';"
```

### Destructive migrations (000_drop_all.sql)

The destructive migration `000_drop_all.sql` is gated behind the `ALLOW_SCHEMA_RESET=true` env var in both `db/migrations/run.sh` and `pipeline/src/main.py`. It is SKIPPED by default on every workflow run.

**Running it manually requires intent:**
```bash
ALLOW_SCHEMA_RESET=true DATABASE_URL="..." bash db/migrations/run.sh
```

Use this only during V1 pre-launch clean-build cycles. Once real customer data exists, `ALLOW_SCHEMA_RESET` must stay unset. The production Railway deploys never set it.

---

## Troubleshooting

### "relation already exists" error on migration re-run

Cause: the migration is not idempotent. Fix the migration file to use `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, `DROP TRIGGER IF EXISTS ... CREATE TRIGGER`, `DO $$ BEGIN IF NOT EXISTS ... END $$`, etc.

Every new migration must pass the "apply twice" test:
```bash
$PSQL -f db/migrations/NNN_new.sql  # first run — may create things
$PSQL -f db/migrations/NNN_new.sql  # second run — must succeed with no errors
```

### "duplicate key value violates unique constraint" on seed re-run

Cause: an INSERT in a seed migration (002/003/004) is missing an `ON CONFLICT` clause. Fix by adding the appropriate target:
```sql
INSERT INTO thing (key, value) VALUES ('a', 'b')
ON CONFLICT (key) DO NOTHING;
```

If no unique constraint exists on the natural key, the INSERT creates duplicates on every re-run (see the `pipeline_schedules` bug fixed in migration 005 + 006). The fix is to add the UNIQUE constraint to the baseline and change `ON CONFLICT DO NOTHING` → `ON CONFLICT (col) DO NOTHING`.

### Migration workflow fails with `DATABASE_URL is not set`

Cause: the repo secret is missing. Add it:
1. GitHub → repo → Settings → Secrets and variables → Actions
2. New repository secret
3. Name: `DATABASE_URL`
4. Value: paste from Railway Postgres → Variables → `DATABASE_URL`
5. Save

### Migration applied successfully but table doesn't exist

Cause: you're querying the wrong database. Railway Postgres has a `railway` database; your local dev uses `govtech_intel`. Confirm via:
```bash
psql "$DATABASE_URL" -c "SELECT current_database();"
```

---

## Conventions for new migrations

1. Name: `NNN_snake_case_description.sql` with a new, incremental number (latest: 008 at time of writing)
2. Top of file: comment block explaining what the migration does and why
3. Every `CREATE TABLE`: `IF NOT EXISTS`
4. Every `CREATE INDEX`: `IF NOT EXISTS`
5. Every `CREATE TRIGGER`: `DROP TRIGGER IF EXISTS ... CREATE TRIGGER`
6. Every `CREATE FUNCTION`: `CREATE OR REPLACE FUNCTION`
7. Every `INSERT` in a seed file: `ON CONFLICT (col) DO NOTHING` or `ON CONFLICT DO UPDATE SET ...`
8. Every `ALTER TABLE`: gated by `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint ...) THEN ... END $$`
9. Verify by running twice against a throwaway PG before committing
10. Apply against Railway via the GitHub Actions workflow after merge, NOT manually from a dev machine
