/**
 * OPERATOR TOOL, SANDBOX ONLY — set known passwords on the seeded accounts.
 *
 * This is not a product path and must never become one. It is the local stand-in for what a real
 * operator does after a deploy: reset an admin's password out-of-band, because migration 198
 * deliberately leaves every seeded admin on a random hash nobody holds.
 *
 * WHY IT EXISTS. Rebuilding from migration 001 produces a database where the only accounts with a
 * knowable password are the tenant users. Migration 124 rotated one master_admin off its committed
 * credential; 198 rotated the other. That is correct — and it means a fresh sandbox has no way into
 * /admin until someone sets one. On a real deployment that "someone" is a human with DB access; here
 * it is this script, run explicitly.
 *
 * It writes bcrypt cost 12 (matching the frontend's bcryptjs config) and clears `temp_password`, so
 * the account is immediately usable for driving. Real deployments should NOT clear that flag —
 * forcing the change is the point — which is why this lives in scripts/ and not in a migration.
 *
 *   source scripts/sandbox-env.sh && node scripts/sandbox-reset-passwords.mjs
 */
import postgres from 'postgres';
import bcrypt from 'bcryptjs';

const DB = process.env.DATABASE_URL_OWNER;
if (!DB) { console.error('DATABASE_URL_OWNER not set — source scripts/sandbox-env.sh'); process.exit(2); }
if (!/localhost|127\.0\.0\.1/.test(DB)) {
  // A guard, not a formality: this script's whole purpose is to make accounts trivially usable.
  console.error('REFUSING — DATABASE_URL_OWNER is not local. This tool is sandbox-only.');
  process.exit(2);
}

const sql = postgres(DB, { max: 2 });
const PW = process.env.SANDBOX_PASSWORD || 'SandboxDrive2026!';

/** Only accounts the run needs to drive. Tenant users already have a known seeded password. */
const TARGETS = [
  'eric@rfppipeline.com',        // master_admin — rotated by 198
  'eric.c.wagner@gmail.com',     // master_admin — rotated by 124
  'pjackson@ecinnovates.com',    // partner_admin (Entrepreneurs' Center)
  'sgaffney@ybi.org',            // partner_admin (Youngstown Business Incubator)
  // A SECOND tenant_admin, in a different tenant from Foundation. Every isolation drive needs one:
  // proving "tenant B cannot see tenant A's rows" requires B to have a real login, or the check
  // degrades into asserting that an anonymous request is refused — which proves nothing about
  // tenant scoping. drive-atomization.mjs used to name a `lighthouse` tenant that does not exist
  // here and bailed before its first assertion.
  'admin@immobileyes.test',      // tenant_admin (Immobileyes Inc.)
];

const hash = await bcrypt.hash(PW, 12);
let n = 0;
for (const email of TARGETS) {
  const rows = await sql`
    UPDATE users SET password_hash = ${hash}, temp_password = false, updated_at = now()
    WHERE email = ${email} RETURNING email, role`;
  if (rows.length) { console.log(`  ✓ ${rows[0].email.padEnd(28)} [${rows[0].role}]`); n += 1; }
  else console.log(`  – ${email.padEnd(28)} (no such account)`);
}
console.log(`\n${n} account(s) reset to the sandbox password. This is a local box only.`);
await sql.end();
