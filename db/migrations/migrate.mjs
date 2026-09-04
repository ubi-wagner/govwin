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

/**
 * `--accept-drift=221_foo.sql[,…]` — restamp the stored checksum for files NAMED explicitly.
 *
 * The narrow, legitimate case: a file was applied, then edited in ways that changed no DDL —
 * comments, whitespace, a corrected header. The DDL genuinely did run; only the bytes moved.
 *
 * It takes an explicit list and never a wildcard, because the reason to have it at all is that a
 * drift warning nobody can clear is a warning everybody learns to scroll past — and the next one
 * will be real. Clearing it has to be a deliberate, named act, and one that leaves a record.
 *
 * ⚠️ It does NOT inspect the DDL. Only pass a file after checking that what it declares is actually
 * present in the database — the objects, the constraints, the policies, the triggers.
 */
const ACCEPT_DRIFT = new Set(
  (process.argv.find(a => a.startsWith('--accept-drift=')) ?? '')
    .replace('--accept-drift=', '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean),
);

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

/**
 * REFUSE TO MIGRATE AS A ROLE THAT CANNOT SEE THE DATA.
 *
 * The existing 42501 handler below only fires once a migration needs an owner PRIVILEGE. A
 * data-repair migration needs none — and under a NOBYPASSRLS role with no tenant context, its
 * UPDATE matches zero rows on a FORCE-RLS table, raises nothing, and is recorded as ✓ applied.
 * It can then never be re-run, because `_migration_history` says it is done.
 *
 * That is not hypothetical. Migration 245 repaired 48 `library_atoms` titled `bulleted_list` — an
 * internal node type shown to customers on a shelf they browse BY TITLE. It was applied here as
 * `govtech_app`, which sees 0 of 1242 atoms. It updated nothing, reported success, and the 48 rows
 * are still there: the customer-finish probe counted them as 34 live jargon defects a day later.
 *
 * So the check is BEFORE anything runs, and it is about capability rather than error codes: can
 * this role bypass RLS? A superuser can (with `rolbypassrls = f` — the trap `check-rls-posture`
 * documents in the other direction), so both are asked.
 *
 * `MIGRATE_ALLOW_SCOPED_ROLE=1` exists for the one legitimate case — a deployment where the
 * migrating role is neither superuser nor BYPASSRLS but IS the table owner and RLS is not forced.
 * It prints what it is overriding, because an unexplained escape hatch is how this comes back.
 */
async function assertOwnerRole() {
  let row;
  try {
    [row] = await sql`
      SELECT current_user AS role, rolsuper, rolbypassrls
        FROM pg_roles WHERE rolname = current_user`;
  } catch (err) {
    console.error('[migrate] could not read the connected role:', err.message);
    await sql.end();
    process.exit(1);
  }
  if (row?.rolsuper || row?.rolbypassrls) return;

  const who = row?.role ?? '?';
  if (process.env.MIGRATE_ALLOW_SCOPED_ROLE === '1') {
    console.error(`[migrate] ⚠ running as ${who}, which cannot bypass RLS —`
      + ' MIGRATE_ALLOW_SCOPED_ROLE=1 is set, so continuing.');
    console.error('[migrate]   A data-repair migration may silently update ZERO rows and still be'
      + ' recorded as applied.');
    return;
  }
  console.error(`[migrate] ✗ REFUSING TO RUN as ${who} — this role cannot bypass RLS.`);
  console.error('[migrate]');
  console.error('[migrate]   A DDL migration would fail loudly here. A DATA-REPAIR migration would');
  console.error('[migrate]   not: its UPDATE matches zero rows on a FORCE-RLS table, raises no');
  console.error('[migrate]   error, and is recorded as applied — so it can never run again.');
  console.error('[migrate]   Migration 245 was lost exactly this way.');
  console.error('[migrate]');
  console.error('[migrate]   DATABASE_URL="$DATABASE_URL_OWNER" node db/migrations/migrate.mjs');
  await sql.end();
  process.exit(1);
}

async function run() {
  await assertOwnerRole();
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
  // Restamp the ones named on the command line, before reporting — so an accepted file is not
  // also listed as drift in the same run, which would read as though the flag had not worked.
  const accepted = drift.filter(f => ACCEPT_DRIFT.has(f));
  for (const f of accepted) {
    const current = sha256(await readFile(join(__dirname, f), 'utf-8'));
    await sql`UPDATE _migration_history SET checksum = ${current} WHERE filename = ${f}`;
    console.log(`[migrate] drift ACCEPTED for ${f} — checksum restamped. The DDL was verified `
      + 'present by hand; only the file bytes had moved.');
  }
  const unaccepted = drift.filter(f => !ACCEPT_DRIFT.has(f));
  // A name passed to --accept-drift that is NOT in drift is reported rather than ignored: it means
  // the file was already clean, was never applied here, or the name was mistyped — and silently
  // accepting nothing looks identical to accepting something.
  for (const f of ACCEPT_DRIFT) {
    if (!drift.includes(f)) console.error(`[migrate] note: --accept-drift named '${f}', which is not drifting here — nothing done.`);
  }
  if (unaccepted.length) {
    console.error('[migrate] ⚠️  DRIFT: these applied migrations differ from their files on disk.');
    console.error('[migrate]     The edited DDL never ran on THIS database. Fix forward with a NEW migration.');
    console.error('[migrate]     If the edit changed NO DDL (comments, whitespace), verify the objects');
    console.error('[migrate]     exist and then restamp: --accept-drift=<file>');
    for (const f of unaccepted) console.error(`[migrate]     • ${f}`);
  }
  drift.length = 0;
  drift.push(...unaccepted);
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
