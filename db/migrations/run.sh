#!/bin/bash
# Run all migrations in order
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONN="${DATABASE_URL:-postgresql://govtech:changeme@localhost:5432/govtech_intel}"

echo "🗄️  Running migrations..."
for migration in "$SCRIPT_DIR"/0*.sql; do
    echo "  ▶ $(basename "$migration")"
    psql "$CONN" -f "$migration" --single-transaction -q
    echo "  ✓ Done"
done
echo "✅ All migrations applied"
