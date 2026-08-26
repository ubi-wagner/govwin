/**
 * Lightweight migration runner for production startup.
 * Uses the postgres.js driver already bundled in the Next.js standalone image.
 * No psql or shell dependencies required.
 *
 * Runs all 0*.sql files in order, tracks applied migrations in _migration_history,
 * and skips destructive migrations (000_drop_all.sql) unless ALLOW_SCHEMA_RESET=true.
 *
 * DRIFT DETECTION: each applied migration's sha256 is stored in _migration_history.
 * The runner skips already-applied files by FILENAME, so a migration edited AFTER a
 * database applied it silently never re-runs — the edited DDL never reaches that DB
 * (this is exactly how idx_process_instances_dedup went missing in prod; see mig 154).
 * On every run we now compare each applied file's current checksum against the stored
 * one and report any mismatch. `--check` runs this audit ALONE (applies nothing) and
 * exits non-zero on drift, so it can be pointed at any database — e.g.
 *   DATABASE_URL=<prod> node db/migrations/migrate.mjs --check
 * to list exactly which migrations have drifted there. A normal run WARNS loudly on
 * drift but still applies pending migrations (drift is fixed forward with a NEW
 * migration file, never by editing the old one). Set MIGRATE_STRICT=true to make a
 * normal run abort on drift instead of warning.
 */
import { readdir, readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import postgres from 'postgres';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONN = process.env.DATABASE_URL;
const CHECK_ONLY = process.argv.includes('--check');
const STRICT = process.env.MIGRATE_STRICT === 'true';

if (!CONN) {
  console.error('[migrate] FATAL: DATABASE_URL not set — cannot run migrations');
  process.exit(1);
}

// Render server notices as one legible line instead of postgres.js's default, which dumps the
// whole notice object — `severity_local`, `file: 'pl_exec.c'`, `routine: 'exec_stmt_raise'` and all
// — to stderr. A migration that ends in `RAISE NOTICE` then looks like it threw, in the deploy log
// of the very run that succeeded. Silencing them (as lib/db.ts does for the app) would be the other
// wrong answer: a migration raises a notice precisely so the deploy log records what it did.
// WARNING and above stay visually distinct, because those are meant to be noticed.
const sql = postgres(CONN, {
  max: 1,
  idle_timeout: 5,
  onnotice: (n) => {
    const sev = n?.severity ?? 'NOTICE';
    const msg = [n?.message, n?.detail, n?.hint].filter(Boolean).join(' — ');
    console.log(`[pg ${sev}] ${msg}`);
  },
});

const sha256 = (s) => createHash('sha256').update(s).digest('hex');

async function run() {
  // Ensure tracking table
  await sql`
    CREATE TABLE IF NOT EXISTS _migration_history (
      filename    TEXT PRIMARY KEY,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      checksum    TEXT
    )
  `;

  // List migration files. Match any 3-digit-prefixed .sql (000..NNN, incl. letter
  // suffixes like 030a). NOTE: the prior /^0\d+/ only matched the 0xx range, so
  // migration 100+ would have been silently skipped — keep this digit-count based.
  const files = (await readdir(__dirname))
    .filter(f => /^\d{3}.*\.sql$/.test(f))
    .sort();

  // ── Drift audit: compare each applied file's current checksum vs the stored one ──
  const history = new Map(
    (await sql`SELECT filename, checksum FROM _migration_history`).map(r => [r.filename, r.checksum]),
  );
  const drift = [];
  const unverifiable = []; // applied before checksums were tracked (stored NULL)
  for (const file of files) {
    if (!history.has(file)) continue; // not applied here — a pending migration
    const stored = history.get(file);
    const current = sha256(await readFile(join(__dirname, file), 'utf-8'));
    if (!stored) unverifiable.push(file);
    else if (stored !== current) drift.push(file);
  }
  if (drift.length) {
    console.error('[migrate] ⚠️  DRIFT: these applied migrations differ from their files on disk.');
    console.error('[migrate]     The edited DDL never ran on THIS database. Fix forward with a NEW migration.');
    for (const f of drift) console.error(`[migrate]     • ${f}`);
  }
  if (unverifiable.length && CHECK_ONLY) {
    console.error(`[migrate] note: ${unverifiable.length} applied migration(s) have no stored checksum (pre-dating checksum tracking) — cannot verify.`);
  }

  if (CHECK_ONLY) {
    const pending = files.filter(f => !history.has(f) && f !== '000_drop_all.sql');
    if (pending.length) {
      console.log(`[migrate] pending (not yet applied here): ${pending.length}`);
      for (const f of pending) console.log(`[migrate]     + ${f}`);
    }
    console.log(`[migrate] check done — ${drift.length} drifted, ${pending.length} pending, ${unverifiable.length} unverifiable`);
    await sql.end();
    process.exit(drift.length ? 1 : 0);
  }

  if (drift.length && STRICT) {
    console.error('[migrate] FATAL: drift detected and MIGRATE_STRICT=true — aborting before applying.');
    await sql.end();
    process.exit(1);
  }

  let applied = 0;
  let skipped = 0;

  for (const file of files) {
    const isReset = file === '000_drop_all.sql';

    // The destructive reset runs ONLY behind the flag — skipped on normal deploys.
    if (isReset && process.env.ALLOW_SCHEMA_RESET !== 'true') {
      skipped++;
      continue;
    }

    // Normal migrations are applied once (tracked). The reset is NOT subject to the
    // already-applied check: when the flag is set it must run EVERY time (it IS the
    // wipe, and it recreates _migration_history empty), or a second reset would be a
    // no-op because 000 is recorded from the first one.
    if (!isReset) {
      const [row] = await sql`
        SELECT filename FROM _migration_history WHERE filename = ${file}
      `;
      if (row) {
        skipped++;
        continue;
      }
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
      // 42501 here almost always means the runner is connected as the APPLICATION role, not the
      // owner. It is the easiest mistake to make in the sandbox: `scripts/sandbox-env.sh` sets
      // DATABASE_URL to `govtech_app` (correct — that is what the app runs as, and what any test of
      // RLS must use) and the owner to DATABASE_URL_OWNER, while this runner reads DATABASE_URL.
      // Most migrations then apply fine, because they only touch tables the app role can write, and
      // the first one that needs an owner privilege fails with a message about the wrong table.
      if (err.code === '42501') {
        console.error('[migrate]');
        console.error('[migrate] That is a PRIVILEGE error, and the usual cause is the connection:');
        console.error(`[migrate]   connected as: ${(CONN.match(/\/\/([^:]+)/) || [, '?'])[1]}`);
        console.error('[migrate] Migrations run as the OWNER. In the sandbox:');
        console.error('[migrate]   DATABASE_URL="$DATABASE_URL_OWNER" node db/migrations/migrate.mjs');
      }
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
