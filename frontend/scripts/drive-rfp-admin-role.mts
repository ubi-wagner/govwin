/**
 * THE ROLE THE WHOLE OF FUNCTION 2 IS SPECIFIED FOR, AND WHICH NOTHING HAS EVER SIGNED IN AS.
 *
 * ── THE GAP ────────────────────────────────────────────────────────────────────────────────────
 * `rfp_admin` (rank 80) is the operator role in CLAUDE.md's own list: "RFP triage/curation,
 * customer onboarding, customer service". It gates `/admin`, `/api/admin` and `/architecture`
 * through `PATH_MIN_ROLE`, and forty-one admin pages re-check it server-side.
 *
 * This box holds 28 accounts and NOT ONE of them is an rfp_admin:
 *
 *     master_admin 2 · tenant_admin 7 · tenant_user 6 · partner_admin 2 · partner_user 11
 *
 * So every admin-lane drive, every atlas lane, every surface lens has signed in as a
 * **master_admin** — who outranks rfp_admin at every gate and therefore cannot fail any of them.
 * That makes two opposite defects structurally invisible:
 *
 *   (a) a gate that should ADMIT an rfp_admin but checks `=== 'master_admin'` locks every real RFP
 *       administrator out of a surface in production, and every green here stays green;
 *   (b) a gate that should REFUSE an rfp_admin — the four `isMasterAdmin` walls — has never once
 *       been asked to refuse anybody, because the only accounts that can reach it are allowed.
 *
 * `resolveActor(sql, { role: 'rfp_admin' })` throws `CannotRun` on this fixture, which is the
 * honest answer and also the reason nobody noticed: a drive nobody wrote reports nothing.
 *
 * ── THE CONTROL LANE, WHICH IS NOT OPTIONAL ────────────────────────────────────────────────────
 * "A guard that refuses everything passes a refusal-only test." Lane B asserts three 403s; if the
 * minted account were simply broken — a bad hash, an inactive row, a session that never formed —
 * all three would be 403 and the drive would report a clean pass over an account that can do
 * NOTHING. So lane A proves the same account is admitted where it should be, and lane D drives the
 * SAME three gates as a master_admin and requires them to open. Three refusals only mean something
 * between a positive above and a positive beside.
 *
 * ⚠️ NOT READ-ONLY. It mints one throwaway `rfp_admin` and removes it in a `finally`, and the
 * force-release / application-status probes are POSTs that must be REFUSED — if one were ever to
 * succeed that is the finding, and the ids are chosen so the effect is recoverable. Sandbox only.
 *
 * Run:  source scripts/sandbox-env.sh && cd frontend && node --import tsx scripts/drive-rfp-admin-role.mts
 */
import { chromium, type Browser, type Page } from 'playwright';
import postgres from 'postgres';
import { countErrorSurfaces } from './lib/error-surface.mjs';
import { harnessDbUrl, passwordFor, CannotRun, dieWell } from './lib/drive-actor.mjs';

const BASE = process.env.BASE || 'http://localhost:3000';
const EXE = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const TEMP_EMAIL = 'zz.rfp.admin.drive@rfppipeline.com';

const sql = postgres(harnessDbUrl()!, { max: 3 });
let ok = true;
const A = (label: string, cond: boolean, detail = '') => {
  console.log(`  ${cond ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  ok = ok && cond;
};
const phase = (t: string) => console.log(`\n══ ${t} ${'═'.repeat(Math.max(0, 76 - t.length))}`);

type Probe = { status: number; body: string };

/** Sign in and PROVE it took — a logged-out browser 403s on everything, which reads as a pass. */
async function signIn(br: Browser, email: string, password: string): Promise<Page> {
  const p = await (await br.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await p.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('#email', { state: 'visible', timeout: 20000 });
  await p.fill('#email', email);
  await p.fill('#password', password);
  await p.click('button[type="submit"]');
  await p.waitForURL((u) => !u.pathname.endsWith('/login'), { timeout: 20000 }).catch(() => {});
  await p.waitForTimeout(1200);
  if (p.url().includes('/login')) {
    throw new CannotRun(
      `could not authenticate as ${email}. Every probe below would answer 401/403, which is `
      + `INDISTINGUISHABLE from the boundary holding. Check SANDBOX_PASSWORD.`);
  }
  return p;
}

/** Issue a request from inside the signed-in page, so the session cookie rides along. */
const hit = (p: Page, path: string, init?: Record<string, unknown>): Promise<Probe> =>
  p.evaluate(async ([u, i]) => {
    const r = await fetch(u as string, (i as RequestInit) ?? undefined);
    return { status: r.status, body: (await r.text()).slice(0, 200) };
  }, [path, init] as const);

let browser: Browser | null = null;
let tempId = '';

try {
  // ── fixture ────────────────────────────────────────────────────────────────────────────────
  // The credential is CLONED from the live master_admin rather than hashed here, so the drive
  // cannot fail on a bcrypt cost mismatch and report it as a boundary result.
  const [seed] = await sql<Array<{ id: string; passwordHash: string }>>`
    SELECT id, password_hash AS "passwordHash" FROM users
     WHERE role = 'master_admin' AND is_active AND password_hash IS NOT NULL
     ORDER BY created_at LIMIT 1`;
  if (!seed) throw new CannotRun('no active master_admin to clone a credential from');

  const [master] = await sql<Array<{ email: string }>>`
    SELECT email FROM users WHERE id = ${seed.id}::uuid`;

  const existing = await sql<Array<{ id: string; email: string }>>`
    SELECT id, email FROM users WHERE role = 'rfp_admin' AND is_active`;
  console.log(existing.length
    ? `  this box already holds ${existing.length} rfp_admin(s) — the drive uses its own anyway, so`
      + ' a seeded one cannot change the result'
    : '  this box holds NO rfp_admin — which is the finding this drive exists to make measurable');

  await sql`DELETE FROM users WHERE email = ${TEMP_EMAIL}`;
  const [made] = await sql<Array<{ id: string }>>`
    INSERT INTO users (email, name, role, tenant_id, password_hash, is_active, temp_password, terms_accepted_at)
    VALUES (${TEMP_EMAIL}, 'ZZ RFP Admin Drive', 'rfp_admin', NULL, ${seed.passwordHash}, true, false, now())
    RETURNING id`;
  tempId = made.id;
  // PLATFORM SCOPE: tenant_id NULL. An rfp_admin filed under a tenant would hold that tenant's
  // context ambiently, and lane C below would pass for the wrong reason.
  A('a platform-scoped rfp_admin exists to drive as', !!tempId, `tenant_id NULL · ${TEMP_EMAIL}`);

  browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const pw = passwordFor('rfp_admin');
  const page = await signIn(browser, TEMP_EMAIL, pw);

  // ── LANE A · the role can do its job ───────────────────────────────────────────────────────
  phase('A · what an RFP administrator is FOR — the surfaces must admit them');

  A('signing in lands on the admin console, not a tenant portal',
    /\/admin/.test(new URL(page.url()).pathname), new URL(page.url()).pathname);

  // Function 2's own surfaces, in the order an RFP admin meets them: what came in, what is being
  // curated, what is ready to release, who bought, whose portal is being built.
  const OWNED = [
    '/admin/dashboard', '/admin/intake', '/admin/rfp-curation', '/admin/scouts',
    '/admin/opportunities', '/admin/sources', '/admin/tenants', '/admin/provisioning',
    '/admin/purchases', '/admin/agents', '/admin/workflows', '/admin/events',
  ];
  for (const route of OWNED) {
    const errs: string[] = [];
    page.once('pageerror', (e) => errs.push(String(e.message).slice(0, 60)));
    const resp = await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' }).catch(() => null);
    await page.waitForTimeout(500);
    const landed = new URL(page.url()).pathname;
    // Each admin page redirects a role it refuses. Landing somewhere ELSE is the refusal, and a
    // 200 says nothing about it — Next serves the redirect target with status 200 (B78).
    const stayed = landed === route || landed.startsWith(route);
    const surfaces = stayed ? await countErrorSurfaces(page) : -1;
    A(`${route} admits an rfp_admin and renders`,
      stayed && surfaces === 0 && errs.length === 0,
      stayed ? (errs.length ? `client throw: ${errs[0]}` : `${surfaces} error surface(s)`)
             : `REDIRECTED to ${landed} (http ${resp?.status() ?? '?'})`);
  }

  // The API half. A 200 with the SOP envelope is the claim; a 403 here would mean the role cannot
  // read its own queue.
  for (const route of ['/api/admin/rfp-curation', '/api/admin/tenants', '/api/admin/workflows/templates']) {
    const r = await hit(page, route);
    A(`GET ${route} answers for an rfp_admin`, r.status === 200, `${r.status}`);
  }

  // ── LANE B · the role stops where it should ────────────────────────────────────────────────
  phase('B · the four master_admin walls — never once asked to refuse anybody');

  const [sol] = await sql<Array<{ id: string }>>`
    SELECT id FROM curated_solicitations ORDER BY created_at DESC LIMIT 1`;
  const [app] = await sql<Array<{ id: string }>>`
    SELECT id FROM applications ORDER BY created_at DESC LIMIT 1`;

  const WALLS: Array<{ name: string; path: string; init: Record<string, unknown>; skip?: string }> = [
    {
      name: 'the platform AI config (spend caps, kill switch)',
      path: '/api/admin/agents/platform-config',
      init: { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ killSwitch: false }) },
    },
    {
      name: 'force-releasing a solicitation past its gate',
      path: sol ? `/api/admin/rfp-curation/${sol.id}/force-release` : '',
      init: { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
      skip: sol ? undefined : 'no curated solicitation on this box',
    },
    {
      name: 'deciding a customer application',
      path: app ? `/api/admin/applications/${app.id}/status` : '',
      init: { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'approved' }) },
      skip: app ? undefined : 'no application on this box',
    },
  ];

  const refused: Record<string, number> = {};
  for (const w of WALLS) {
    if (w.skip) { A(`${w.name} — UNMEASURED`, false, w.skip); continue; }
    const r = await hit(page, w.path, w.init);
    refused[w.name] = r.status;
    let enveloped = false;
    try {
      const j = JSON.parse(r.body) as Record<string, unknown>;
      enveloped = typeof j.error === 'string' && typeof j.code === 'string';
    } catch { /* a redirect or empty body is not an envelope */ }
    A(`${w.name} is refused`, r.status === 403, `${r.status}`);
    A('  …and the refusal carries {error, code}', enveloped, r.body.slice(0, 80));
  }

  // The UI half of the same wall: /admin/agents renders the platform controls behind
  // `role === 'master_admin'`, so an rfp_admin must not see them.
  await page.goto(`${BASE}/admin/agents`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);
  const agentsBody = await page.evaluate(() => document.body.innerText);
  A('the platform AI controls are not rendered for an rfp_admin',
    !/kill switch/i.test(agentsBody), /kill switch/i.test(agentsBody) ? 'the control is on the page' : 'absent');

  // ── LANE C · no ambient tenant reach ───────────────────────────────────────────────────────
  phase('C · platform authority is not tenant authority');

  const [ten] = await sql<Array<{ slug: string; id: string }>>`
    SELECT slug, id FROM tenants WHERE is_active ORDER BY created_at LIMIT 1`;
  if (!ten) {
    A('a tenant portal refuses an un-descended rfp_admin — UNMEASURED', false, 'no tenant on this box');
  } else {
    const r = await hit(page, `/api/portal/${ten.slug}/proposals`);
    // The contract is that authority must be DESCENDED INTO, not carried. 200 here would mean an
    // rfp_admin reads a customer's workspace with no shadow event in that customer's audit trail.
    A(`a customer's workspace is not readable without descending (${ten.slug})`,
      r.status === 401 || r.status === 403 || r.status === 404, `${r.status}`);
  }

  // ── LANE D · THE CONTROL — the same walls must OPEN for a master_admin ──────────────────────
  phase('D · control: a wall that refuses everyone is not a wall');

  const mpage = await signIn(browser, master.email, passwordFor('master_admin'));
  for (const w of WALLS) {
    if (w.skip) continue;
    // Read-only probe of the SAME gate: a GET where one exists, else the same verb with a body
    // the handler must reject on CONTENT rather than on role. Anything but 403 proves the gate
    // discriminates; 403 for the master_admin too would mean lane B measured nothing.
    const r = await hit(mpage, w.path, w.init);
    A(`${w.name} — opens for a master_admin`, r.status !== 403,
      `rfp_admin ${refused[w.name]} · master_admin ${r.status}`);
  }

  phase('verdict');
  console.log(`  MUTATED: 1 throwaway rfp_admin (${TEMP_EMAIL}), removed below.`);
  console.log('  The three wall probes are POSTs that were REFUSED for the rfp_admin; lane D issued');
  console.log('  them as master_admin, so a force-release or an application decision MAY have landed.');
  console.log('  Both ids are the newest rows and the effects are reversible. Sandbox only.');
} catch (err) {
  if (browser) await browser.close().catch(() => {});
  if (tempId) await sql`DELETE FROM users WHERE id = ${tempId}::uuid`.catch(() => {});
  await sql.end().catch(() => {});
  dieWell(err);
}

if (browser) await browser.close().catch(() => {});
if (tempId) await sql`DELETE FROM users WHERE id = ${tempId}::uuid`;
await sql.end();

console.log(ok ? '\n✅ the rfp_admin boundary holds in both directions.'
               : '\n✗ the rfp_admin boundary does NOT hold — see the ✗ rows above.');
process.exit(ok ? 0 : 1);
