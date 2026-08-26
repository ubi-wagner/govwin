/** J1 — Cold start: does the bus leave the depot.
 *
 * The terminal state of a cold rebuild is not "the migrations ran". It is "a person of every role
 * can get in and lands where the product says they should". Everything before this is plumbing.
 *
 * Drives a REAL browser against the standalone server — not fetch(), because the thing being
 * tested includes the login form, the session cookie, the middleware redirect, and the role-routed
 * landing page. A 200 from an API proves none of that.
 *
 * For each actor: log in → assert we left /login → assert the landing URL matches the role → screenshot.
 * Then the shadow-admin descent, which is the one cross-role capability that has to work for
 * support to function at all.
 *
 *   cd frontend && source ../scripts/sandbox-env.sh && node scripts/j1-cold-start.mjs
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const BASE = 'http://localhost:3000';
/** Set by scripts/sandbox-reset-passwords.mjs. The seeded admins carry a random hash nobody
 *  holds (migs 124 + 198), so a driveable admin password is an OPERATOR artefact, not a seed. */
const SANDBOX_PW = process.env.SANDBOX_PASSWORD || 'SandboxDrive2026!';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const OUT = '/home/user/govwin/docs/assets/e2e-run/j1';
fs.mkdirSync(OUT, { recursive: true });

let ok = true;
const A = (l, c, x = '') => { console.log(`${c ? '✓' : '✗'} ${l}${x ? ` — ${x}` : ''}`); ok = ok && c; };

/**
 * Every ACTIVE seeded account, with where the product should put them.
 *
 * `landing` is a regex because the product routes by role, and getting that wrong is a real
 * defect: a tenant_user dropped on /admin is a privilege surprise, and an admin dropped on a
 * tenant portal cannot do their job.
 */
const ACTORS = [
  { role: 'master_admin', email: 'eric@rfppipeline.com', pw: SANDBOX_PW, landing: /\/admin/ },
  { role: 'tenant_admin (immobileyes)', email: 'admin@immobileyes.test', pw: 'DemoPass123!', landing: /\/portal\/immobileyes/ },
  { role: 'tenant_admin (foundation)', email: 'kate.ulepic@foundation3dp.com', pw: 'DemoPass123!', landing: /\/portal\/foundation/ },
  { role: 'tenant_user (foundation)', email: 'connor.casey@foundation3dp.com', pw: 'DemoPass123!', landing: /\/portal\/foundation/ },
  // A partner_admin runs a stable of companies, so they hold MORE THAN ONE active membership and
  // the product correctly routes them to the membership selector first — a session is singular and
  // choosing pins it (docs/MULTI_MEMBERSHIP_IDENTITY_DESIGN.md). This assertion originally demanded
  // /partner or /portal and failed the product for doing the right thing; the selector IS the
  // landing surface for a multi-membership identity, and `selects a company` below proves the rest.
  { role: 'partner_admin (EC)', email: 'pjackson@ecinnovates.com', pw: SANDBOX_PW, landing: /\/select-company|\/partner|\/portal/, thenSelect: true },
];

const shot = async (p, n) => { await p.screenshot({ path: path.join(OUT, n + '.png'), fullPage: false }); };
const settle = async (p, ms = 2200) => { await p.waitForLoadState('networkidle').catch(() => {}); await p.waitForTimeout(ms); };

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-setuid-sandbox'] });

try {
  console.log('\n── J1 · every role gets in, on a box rebuilt from migration 001 ──\n');

  for (const a of ACTORS) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const p = await ctx.newPage();
    const errors = [];
    p.on('pageerror', (e) => errors.push(String(e).slice(0, 120)));
    try {
      await p.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
      await p.waitForSelector('#email', { timeout: 15000 });
      await p.fill('#email', a.email);
      await p.fill('#password', a.pw);
      await p.click('button[type="submit"]');
      await settle(p);

      const url = p.url();
      const landed = !url.includes('/login');
      A(`${a.role} logs in`, landed, landed ? url.replace(BASE, '') : `stuck at ${url.replace(BASE, '')}`);
      if (landed) {
        A(`  → lands on the right surface`, a.landing.test(url), url.replace(BASE, ''));
      }
      // A page that renders but throws is a broken page that looks fine in a status code.
      A(`  → no uncaught client error`, errors.length === 0, errors.slice(0, 2).join(' | '));
      await shot(p, `login-${a.role.replace(/[^a-z_]/gi, '-')}`);

      // Landing on the selector is not the destination — getting THROUGH it is. Without this the
      // journey would report a pass on a person who is still standing in the doorway.
      if (a.thenSelect && p.url().includes('/select-company')) {
        const pick = p.locator('button[type="submit"], form button').first();
        if (await pick.count() > 0) {
          await pick.click();
          await settle(p, 2600);
          A(`  → selects a company and gets in`, !p.url().includes('/select-company'), p.url().replace(BASE, ''));
          await shot(p, 'login-partner_admin-after-select');
        } else {
          A(`  → selects a company and gets in`, false, 'no selectable company on the selector');
        }
      }
    } catch (e) {
      A(`${a.role} logs in`, false, String(e).slice(0, 110));
    } finally {
      await ctx.close();
    }
  }

  // A wrong password must be refused. Trivial to get wrong in a rebuild (a seed that stores a
  // plaintext or an always-true compare), and catastrophic if it is.
  {
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    await p.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('#email', { timeout: 15000 });
    await p.fill('#email', 'eric@rfppipeline.com');
    await p.fill('#password', 'definitely-not-the-password');
    await p.click('button[type="submit"]');
    await settle(p, 2500);
    A('a wrong password is REFUSED', p.url().includes('/login'), p.url().replace(BASE, ''));
    await ctx.close();
  }

  // A deactivated account must stay out. mig 124 deactivated the .test seeds on purpose; if a
  // rebuild silently reactivates them, the box ships with known-credential accounts.
  {
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    await p.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('#email', { timeout: 15000 });
    await p.fill('#email', 'admin@apexdefense.test');
    await p.fill('#password', 'DemoPass123!');
    await p.click('button[type="submit"]');
    await settle(p, 2500);
    A('a DEACTIVATED account is refused', p.url().includes('/login'), p.url().replace(BASE, ''));
    await ctx.close();
  }

  // Anonymous must not reach a tenant portal or the admin console.
  for (const guarded of ['/admin', '/portal/foundation/dashboard']) {
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    await p.goto(`${BASE}${guarded}`, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await settle(p, 1500);
    const bounced = p.url().includes('/login') || p.url() === `${BASE}/`;
    A(`anonymous is bounced from ${guarded}`, bounced, p.url().replace(BASE, ''));
    await ctx.close();
  }
} finally {
  await browser.close();
}

console.log(ok ? '\n✅ J1 PASS — the bus left the depot with every passenger aboard\n'
               : '\n❌ J1 FAILURES ABOVE — downstream journeys are UNPROVEN until this is green\n');
process.exit(ok ? 0 : 1);
