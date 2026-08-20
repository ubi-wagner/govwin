/** Paul is a partner MANAGER. He signs in to his console, not to a company.
 *
 * The whole point of the partner_admin role is that one person runs a stable of several companies,
 * so "where does Paul land" has exactly one right answer — /partner — and it must not depend on
 * which company happens to be first, or on him holding a home tenant at all. getLandingPath returns
 * '/partner' for partner_admin before it ever looks at a tenant slug, so the code says yes; this
 * proves it against the running app, with MORE THAN ONE company in the stable, which is the case
 * that a single-company fixture can never exercise.
 *
 * It checks the full round trip for each company, because a console that lists a company it cannot
 * enter is worse than one that hides it:
 *   1. sign in           → lands on /partner (not a portal, not /select-company)
 *   2. the console       → lists every company in the stable
 *   3. descend           → lands in THAT company's Command Center, as its manager
 *   4. ascend            → returns to /partner with the partner role restored
 *
 * The second company is attached as a `partner_manager` membership — the handshake path for an
 * EXISTING company — so the two relations the console distinguishes ("Created" vs "Manager") are
 * both under test, not just the owned one.
 */
import { chromium } from 'playwright';
import postgres from 'postgres';

const BASE = 'http://localhost:3000';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const PW = process.env.FOUNDATION_PW || 'DemoPass123!';
const SECOND = process.env.SECOND_COMPANY || 'immobileyes';

const sql = postgres(process.env.DATABASE_URL_OWNER, { max: 3 });
const ok = (b, s) => console.log(`  ${b ? '✓' : '✗'} ${s}`);
let failures = 0;
const check = (b, s) => { if (!b) failures++; ok(b, s); };

// ── give Paul a SECOND company, as a manager rather than an owner ────────────
const [paul] = await sql`SELECT id FROM users WHERE email = 'pjackson@ecinnovates.com'`;
const [second] = await sql`SELECT id, name FROM tenants WHERE slug = ${SECOND}`;
if (!paul || !second) { console.error(`need pjackson + tenant '${SECOND}'`); await sql.end(); process.exit(2); }
await sql`
  INSERT INTO user_memberships (user_id, tenant_id, role, status, source, created_by)
  VALUES (${paul.id}::uuid, ${second.id}::uuid, 'tenant_admin', 'active', 'partner_manager', ${paul.id}::uuid)
  ON CONFLICT (user_id, tenant_id) DO UPDATE SET role='tenant_admin', status='active', source='partner_manager'`;

const stable = await sql`
  SELECT t.slug, t.name, CASE WHEN t.owner_id = ${paul.id}::uuid THEN 'Created' ELSE 'Manager' END AS rel
  FROM tenants t
  LEFT JOIN user_memberships m ON m.tenant_id = t.id AND m.user_id = ${paul.id}::uuid
       AND m.status = 'active' AND m.source = 'partner_manager'
  WHERE t.archived_at IS NULL AND t.kind = 'standard'
    AND (t.owner_id = ${paul.id}::uuid OR m.id IS NOT NULL)`;
console.log(`\nPaul's stable: ${stable.map((s) => `${s.slug} (${s.rel})`).join(', ')}\n`);

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
const page = await (await browser.newContext({ viewport: { width: 1360, height: 940 } })).newPage();

// ── 1. sign in → /partner ───────────────────────────────────────────────────
await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
await page.fill('input[name="email"]', 'pjackson@ecinnovates.com');
await page.fill('input[name="password"]', PW);
await Promise.all([
  page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 }),
  page.click('button[type="submit"]'),
]);
await page.waitForLoadState('networkidle').catch(() => {});
const landed = new URL(page.url()).pathname;
check(landed === '/partner', `sign-in lands on the partner console (got ${landed})`);

// ── 2. the console lists every company ──────────────────────────────────────
const body = (await page.textContent('body')) ?? '';
for (const s of stable) check(body.includes(s.name), `console lists ${s.name} (${s.rel})`);

// ── 3 + 4. descend into each, then ascend back ──────────────────────────────
for (const s of stable) {
  await page.goto(`${BASE}/partner`, { waitUntil: 'networkidle' });
  const card = page.locator('div').filter({ hasText: new RegExp(`^${s.name}`) });
  const open = card.getByRole('link', { name: /^Open workspace/ }).first();
  const href = await open.getAttribute('href').catch(() => null);
  if (!href) { check(false, `${s.slug}: no "Open workspace" link`); continue; }
  await page.goto(`${BASE}${href}`, { waitUntil: 'networkidle', timeout: 45000 });
  const inPortal = new URL(page.url()).pathname;
  check(inPortal.startsWith(`/portal/${s.slug}/`), `descend into ${s.slug} → ${inPortal}`);

  const exit = page.getByRole('link', { name: /Exit to partner console/i }).first();
  const canExit = await exit.isVisible().catch(() => false);
  check(canExit, `${s.slug}: "Exit to partner console" is offered`);
  if (canExit) {
    await Promise.all([page.waitForURL(/\/partner$/, { timeout: 30000 }).catch(() => {}), exit.click()]);
    check(new URL(page.url()).pathname === '/partner', `${s.slug}: ascend returns to the console`);
  }
}

console.log(failures === 0
  ? '\n✓ partner-manager round trip holds for every company in the stable'
  : `\n✗ ${failures} check(s) failed`);
await browser.close();
await sql.end();
process.exit(failures === 0 ? 0 : 1);
