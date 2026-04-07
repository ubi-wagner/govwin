/**
 * Seed the initial master admin user.
 * Usage: npx tsx scripts/seed_admin.ts
 */
import { sql } from '../lib/db';
import bcrypt from 'bcryptjs';

async function main() {
  const email = process.env.ADMIN_EMAIL || 'admin@rfppipeline.com';
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
