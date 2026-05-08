#!/bin/sh
set -e

# Run pending database migrations before starting the app.
# Uses the lightweight Node.js migration runner (no psql dependency).
if [ -f /app/db/migrations/migrate.mjs ]; then
  echo "[entrypoint] Running database migrations..."
  node /app/db/migrations/migrate.mjs
  echo "[entrypoint] Migrations complete."
fi

# Start Next.js
exec node server.js
