/**
 * scripts/seed_admin.ts
 * Run once after migrations to create your master admin account
 * and update the seeded tenant with your real company details.
 *
 * Usage:
 *   DATABASE_URL=postgresql://... npx tsx scripts/seed_admin.ts
 *
 * Or via Makefile:
 *   make seed
 */
import postgres from 'postgres'
import bcrypt from 'bcryptjs'
import * as readline from 'readline'

const sql = postgres(process.env.DATABASE_URL!, { max: 1 })

async function prompt(question: string, hidden = false): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise(resolve => {
    if (hidden) {
      // Don't echo password
      process.stdout.write(question)
      process.stdin.setRawMode?.(true)
      let input = ''
      process.stdin.on('data', (char) => {
        const c = char.toString()
        if (c === '\n' || c === '\r') {
          process.stdin.setRawMode?.(false)
          process.stdout.write('\n')
          rl.close()
          resolve(input)
        } else if (c === '\u0003') {
          process.exit()
        } else {
          input += c
          process.stdout.write('*')
        }
      })
      process.stdin.resume()
    } else {
      rl.question(question, (answer) => { rl.close(); resolve(answer) })
    }
  })
}

async function main() {
  console.log('\n🎯 GovTech Intel v3 — Admin Seed\n')

  // ── Collect inputs ────────────────────────────────────────
  const adminName    = await prompt('Your full name: ')
  const adminEmail   = await prompt('Your email (admin login): ')
  const adminPass    = await prompt('Choose a password: ', true)
  const companyName  = await prompt('Your company name: ')
  const companySlug  = await prompt('Company slug (e.g. my-company, lowercase-hyphens): ')

  console.log('\nCreating...')

  // ── Update seeded tenant ──────────────────────────────────
  const [tenant] = await sql`
    UPDATE tenants
    SET name = ${companyName}, slug = ${companySlug}, updated_at = NOW()
    WHERE slug = 'my-company'
    RETURNING id, slug, name
  `

  if (!tenant) {
    // Tenant was already updated or doesn't exist — create fresh
    const [newTenant] = await sql`
      INSERT INTO tenants (name, slug, plan, status, internal_notes)
      VALUES (${companyName}, ${companySlug}, 'enterprise', 'active', 'Owner company')
      ON CONFLICT (slug) DO UPDATE SET name = ${companyName}
      RETURNING id, slug, name
    `
    console.log(`✓ Tenant: ${newTenant.name} (${newTenant.slug})`)
  } else {
    console.log(`✓ Tenant: ${tenant.name} (${tenant.slug})`)
  }

  const tenantId = tenant?.id ?? (await sql`SELECT id FROM tenants WHERE slug = ${companySlug}`)[0].id

  // ── Create master admin user ──────────────────────────────
  const passwordHash = await bcrypt.hash(adminPass, 12)

  const [user] = await sql`
    INSERT INTO users (name, email, password_hash, role, tenant_id, email_verified)
    VALUES (
      ${adminName},
      ${adminEmail},
      ${passwordHash},
      'master_admin',
      ${tenantId},
      NOW()
    )
    ON CONFLICT (email) DO UPDATE
      SET name = ${adminName}, password_hash = ${passwordHash},
          role = 'master_admin', tenant_id = ${tenantId},
          email_verified = NOW(), updated_at = NOW()
    RETURNING id, email, role
  `

  console.log(`✓ Admin user: ${user.email} (${user.role})`)

  // ── Create tenant profile (empty, ready for your NAICS) ──
  await sql`
    INSERT INTO tenant_profiles (tenant_id)
    VALUES (${tenantId})
    ON CONFLICT (tenant_id) DO NOTHING
  `
  console.log(`✓ Tenant profile created (add your NAICS codes in admin panel)`)

  console.log(`
✅ Done!

Next steps:
  1. Start the dev server: cd frontend && npm run dev
  2. Go to http://localhost:3000/login
  3. Log in with: ${adminEmail}
  4. You'll land at /admin/dashboard
  5. Create your first tenant from the Tenants page

For Railway:
  - Push this repo to GitHub
  - Connect in Railway dashboard
  - Add a Postgres plugin (pgvector)
  - Set env vars (see .env.example)
  - Deploy!
`)

  await sql.end()
}

main().catch(err => {
  console.error('Seed failed:', err)
  process.exit(1)
})
