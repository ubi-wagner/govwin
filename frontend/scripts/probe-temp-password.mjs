/** Focused probe: does a temp-password account actually get forced to change it?
 *
 * J1b saw the brand-new tenant_admin land on `/portal` rather than `/change-password`, and the
 * chain that is supposed to force it looks correct end to end: `authorize()` returns
 * `tempPassword`, the `jwt` callback copies it onto the token, the `session` callback exposes it on
 * `session.user`, and middleware redirects when it is true. Every link reads right, which is
 * exactly when it is worth watching the actual navigation instead of the source.
 *
 * So this follows the redirects one at a time and prints where the browser was told to go, then
 * checks whether a temp-password user can reach a protected page WITHOUT changing it — which is
 * the question that actually matters.
 */
import { chromium } from 'playwright';
import postgres from 'postgres';

const BASE = 'http://localhost:3000';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const sql = postgres(process.env.DATABASE_URL_OWNER, {
  max: 2, transform: { column: { from: postgres.toCamel, to: postgres.fromCamel } },
});

const [u] = await sql`
  SELECT u.email, u.temp_password AS "tempPassword", t.slug
  FROM users u LEFT JOIN tenants t ON t.id = u.tenant_id
  WHERE u.role = 'tenant_admin' AND u.temp_password = true
  ORDER BY u.created_at DESC LIMIT 1`;
if (!u) { console.log('no temp-password tenant_admin to probe'); await sql.end(); process.exit(0); }
console.log(`\nprobing ${u.email}  (temp_password=${u.tempPassword}, tenant=${u.slug})\n`);

// The password J1b's admin was shown. Re-set it here so the probe is self-contained: the point is
// the REDIRECT behaviour, not password recovery.
const bcrypt = (await import('bcryptjs')).default;
const PW = 'ProbeTemp2026!';
await sql`UPDATE users SET password_hash = ${await bcrypt.hash(PW, 12)}, temp_password = true
          WHERE email = ${u.email}`;

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
const ctx = await browser.newContext();
const p = await ctx.newPage();

const hops = [];
p.on('framenavigated', (f) => { if (f === p.mainFrame()) hops.push(f.url().replace(BASE, '')); });

await p.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
await p.waitForSelector('#email', { timeout: 15000 });
await p.fill('#email', u.email);
await p.fill('#password', PW);
await p.click('button[type="submit"]');
await p.waitForLoadState('networkidle').catch(() => {});
await p.waitForTimeout(6000);      // generous: let every redirect in the chain settle

console.log('navigation hops after sign-in:');
for (const h of hops) console.log(`   → ${h}`);
console.log(`\nsettled at: ${p.url().replace(BASE, '')}`);

// The question that matters: can a temp-password user reach a protected page without changing it?
await p.goto(`${BASE}/portal/${u.slug}/dashboard`, { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(3000);
const landed = p.url().replace(BASE, '');
console.log(`asked for the dashboard directly → ${landed}`);
console.log(landed.includes('change-password')
  ? '\n✓ FORCED — a temp password cannot be used to work in the product'
  : '\n✗ NOT FORCED — a temp password reaches a protected page unchanged');

await browser.close();
await sql.end();
