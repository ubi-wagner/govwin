/**
 * Lightweight migration runner for production startup.
 * Uses the postgres.js driver already bundled in the Next.js standalone image.
 * No psql or shell dependencies required.
 *
 * Runs all 0*.sql files in order, tracks applied migrations in _migration_history,
 * and skips destructive migrations (000_drop_all.sql) unless ALLOW_SCHEMA_RESET=true.
 */
import { readdir, readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import postgres from 'postgres';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONN = process.env.DATABASE_URL;

if (!CONN) {
  console.error('[migrate] FATAL: DATABASE_URL not set — cannot run migrations');
  process.exit(1);
}

const sql = postgres(CONN, { max: 1, idle_timeout: 5 });

async function run() {
  // Ensure tracking table
  await sql`
    CREATE TABLE IF NOT EXISTS _migration_history (
      filename    TEXT PRIMARY KEY,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      checksum    TEXT
    )
  `;

  // List migration files
  const files = (await readdir(__dirname))
    .filter(f => /^0\d+.*\.sql$/.test(f))
    .sort();

  let applied = 0;
  let skipped = 0;

  for (const file of files) {
    // Skip destructive migrations in production
    if (file === '000_drop_all.sql' && process.env.ALLOW_SCHEMA_RESET !== 'true') {
      skipped++;
      continue;
    }

    // Check if already applied
    const [row] = await sql`
      SELECT filename FROM _migration_history WHERE filename = ${file}
    `;
    if (row) {
      skipped++;
      continue;
    }

    // Read and execute
    const filePath = join(__dirname, file);
    const content = await readFile(filePath, 'utf-8');
    const checksum = createHash('sha256').update(content).digest('hex');

    console.log(`[migrate] applying ${file}...`);
    try {
      await sql.begin(async (tx) => {
        await tx.unsafe(content);
        await tx`
          INSERT INTO _migration_history (filename, checksum)
          VALUES (${file}, ${checksum})
          ON CONFLICT (filename) DO UPDATE SET applied_at = NOW(), checksum = ${checksum}
        `;
      });
      applied++;
      console.log(`[migrate] ✓ ${file}`);
    } catch (err) {
      console.error(`[migrate] ✗ ${file} FAILED:`, err.message);
      await sql.end();
      process.exit(1);
    }
  }

  console.log(`[migrate] done — ${applied} applied, ${skipped} skipped`);
  await sql.end();
}

run().catch(async (err) => {
  console.error('[migrate] fatal:', err);
  try { await sql.end(); } catch { /* ignore */ }
  process.exit(1);
});
