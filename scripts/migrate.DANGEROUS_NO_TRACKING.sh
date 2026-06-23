#!/usr/bin/env bash
# DANGER: no _migration_history tracking — DO NOT USE. Use db/migrations/migrate.mjs instead.
set -e
for f in db/migrations/*.sql; do
  echo "Running $f..."
  psql "$DATABASE_URL" -f "$f"
done
echo "All migrations complete"
