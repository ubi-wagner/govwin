#!/usr/bin/env bash
set -e
for f in db/migrations/*.sql; do
  echo "Running $f..."
  psql "$DATABASE_URL" -f "$f"
done
echo "All migrations complete"
