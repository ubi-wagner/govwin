/**
 * Seed the initial master admin user.
 * Usage: npx tsx scripts/seed_admin.ts
 *
 * NOTE: the baseline migration 001_baseline.sql already seeds
 * eric@rfppipeline.com as the initial master_admin, so this script
 * is only used for creating *additional* admins or on environments
 * where the baseline user needs to be replaced. ADMIN_EMAIL is
 * normalized with .toLowerCase().trim() to match what auth.ts does
 * at login time — without this normalization, a row inserted with
 * mixed-case would never match the lowercased query from
 * auth.ts:38 and the user could never log in.
 */
// `../lib/db` — there is no `lib/` at the repo root, and there never has been on this branch. The
// database module lives in the frontend, so from `scripts/` the path is `../frontend/lib/db`, and
// tsc reported `TS2307: Cannot find module '../lib/db'` on the old one. That made the `--seed` arm
// of `db/migrations/run.sh` — a documented bootstrap step — fail before it ran a line.
//
// It survived because nothing imports this file and nothing runs it in the suite: a rot no lens
// could see, because a lens measures what the product DOES and this is a path nobody takes until
// the day they stand up a new environment. Found by the dependency graph, which is the one
// instrument that asks whether an edge lands anywhere at all.
import { sql } from '../frontend/lib/db';
import bcrypt from 'bcryptjs';

async function main() {
  const rawEmail = process.env.ADMIN_EMAIL || 'admin@rfppipeline.com';
  const email = rawEmail.toLowerCase().trim();
  const password = process.env.ADMIN_PASSWORD || 'ChangeMe123!';
  const hash = await bcrypt.hash(password, 12);

  await sql`
    INSERT INTO users (email, name, role, password_hash, is_active)
    VALUES (${email}, 'System Admin', 'master_admin', ${hash}, true)
    ON CONFLICT (email) DO NOTHING
  `;

  console.log(`Admin user seeded: ${email}`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
