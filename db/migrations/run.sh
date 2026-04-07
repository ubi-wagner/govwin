#!/usr/bin/env bash
set -e
DB_URL="${DATABASE_URL:-postgresql://govtech:changeme@localhost:5432/govtech_intel}"
for f in $(ls db/migrations/*.sql | sort); do
  echo "Running $f..."
  psql "$DB_URL" -f "$f"
done
echo "All migrations complete."
