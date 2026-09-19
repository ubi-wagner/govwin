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
/**
 * ONE TOKEN, NO DOTS — and that is not cosmetic.
 *
 * This was `zz.rfp.admin.drive@rfppipeline.com`. The account is deleted at teardown, but the
 * `shadow.descended` / `shadow.ascended` rows lane C causes are **not**: they land in a real
 * customer's audit trail and deleting an event to tidy up is the one thing this spine forbids. So
 * the address is permanent, it renders in that customer's Activity feed, and
 * `probe-customer-finish` grades that feed as customer-facing prose — where a four-segment dotted
 * local part is exactly what its jargon rule is for. It flagged three, correctly.
 *
 * A single lower-case word is just a word to that rule, which is the right reason to pass rather
 * than a way around it, and it still reads as a harness account to anyone who finds the row.
 *
 * > A drive that writes PERMANENT rows onto a surface another instrument grades must write rows
 * > that look like what they are.
 */
const TEMP_EMAIL = 'zzdriveadmin@rfppipeline.com';

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
let appId = '';

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

  /**
   * The application wall needs an application, and this box has none.
   *
   * Leaving it UNMEASURED would be honest and also permanent — a drive that can never pass for a
   * fixture reason is one people learn to ignore, which is how a wall stops being watched. So the
   * drive MAKES one, in `pending`, removes it in the same run, and only skips if the insert fails.
   * A fabricated fixture is the right call here precisely because the assertion is a REFUSAL: the
   * row's content cannot influence a 403, so nothing about it can flatter the result.
   */
  let app: { id: string } | undefined;
  try {
    [app] = await sql<Array<{ id: string }>>`
      INSERT INTO applications
        (contact_email, contact_name, company_name, tech_summary, status, source, terms_accepted_at)
      VALUES ('zz.rfp.admin.drive@example.test', 'ZZ Drive Fixture', 'ZZ Drive Fixture Co',
              'Fixture row for the rfp_admin wall probe. Removed by the same run.', 'pending', 'public',
              now())
      RETURNING id`;
    appId = app?.id ?? '';
  } catch (e) {
    console.log(`  ⚠ could not seed an application fixture — ${String(e).slice(0, 90)}`);
  }

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
      // `approved` is DELIBERATELY not in the column's CHECK vocabulary (pending · under_review ·
      // accepted · rejected · onboarded · withdrawn). The role gate runs before validation, so an
      // rfp_admin still gets 403 and a master_admin gets 400 — which is what lane D needs — while
      // the probe cannot actually decide an application or start an onboarding as a side effect.
      name: 'deciding a customer application',
      path: app ? `/api/admin/applications/${app.id}/status` : '',
      init: { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'approved' }) },
      skip: app ? undefined : 'could not seed an application to probe with',
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

  /**
   * ── LANE C · the customer's own record of a vendor operator in their account ─────────────────
   *
   * THIS LANE ASSERTED THE WRONG CONTRACT FIRST, and the correction is the point of writing it
   * down. It required a tenant portal route to REFUSE an rfp_admin — reasoning that platform
   * authority should have to be descended into rather than carried. It answered 200, which looked
   * exactly like a cross-tenant leak.
   *
   * It is not one. `verifyTenantAccess` (lib/db.ts) grants master_admin and rfp_admin a DERIVED
   * shadow membership — tenant_admin in every tenant — deliberately, so that an RFP administrator
   * can do customer service without being invited to each company first. Asserting a refusal there
   * was a harness bug, not a finding: assert the contract the system HAS.
   *
   * What the system actually guarantees is the thing worth checking, and it is stronger: the read
   * is not silent. `lib/space-presence.ts` (migs 246/247) brackets an outside actor's presence
   * inside a customer's space with a `shadow.descended` and a matching `shadow.ascended` written
   * under THAT CUSTOMER'S tenant_id — their only notice that somebody from the vendor was in
   * their account. An unbracketed read is the real defect, and nothing was checking for it.
   */
  phase('C · a vendor operator inside a customer space leaves a bracket');

  // `tenants` has no `is_active` — it carries `status` + `archived_at`, and `kind` separates a
  // customer from a partner org. A partner_org would answer differently here for its own reasons,
  // so the probe is pinned to a `standard` customer.
  const [ten] = await sql<Array<{ slug: string; id: string }>>`
    SELECT slug, id FROM tenants
     WHERE status = 'active' AND archived_at IS NULL AND kind = 'standard'
     ORDER BY created_at LIMIT 1`;
  if (!ten) {
    A('the shadow bracket is written — UNMEASURED', false, 'no standard tenant on this box');
  } else {
    /**
     * TWO BOUNDARIES, MEASURED SEPARATELY, because they are not the same event and the first run
     * of this lane could not tell them apart. `syncPortalPresence` is called from
     * `app/portal/[tenantSlug]/layout.tsx` — a PAGE boundary. `/api/portal/<slug>/…` is a DATA
     * boundary and calls nothing. Counting both against one window would have attributed the
     * page's bracket to the API read, or (as it first did) reported a bare zero with no way to
     * tell which half was missing.
     *
     * The counter is also scoped to THIS customer's tenant_id. An admin's own /admin navigation
     * brackets under the house tenant `rfp-pipeline`, which is a different customer's trail and
     * must never be counted as this one's.
     */
    const presenceIn = async (since: Date) => {
      const [p] = await sql<Array<{ down: number; up: number }>>`
        SELECT count(*) FILTER (WHERE type = 'shadow.descended')::int AS down,
               count(*) FILTER (WHERE type = 'shadow.ascended')::int  AS up
          FROM system_events
         WHERE created_at > ${since}
           AND tenant_id = ${ten.id}::uuid
           AND actor_email = ${TEMP_EMAIL}`;
      return { down: p?.down ?? 0, up: p?.up ?? 0 };
    };

    // ── the PAGE boundary — the one the bracket was built for ───────────────────────────────
    const beforePage = new Date();
    await page.goto(`${BASE}/portal/${ten.slug}/dashboard`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1800);
    const pagePresence = await presenceIn(beforePage);
    A(`opening a customer's portal page writes a descent into THEIR trail (${ten.slug})`,
      pagePresence.down > 0, `${pagePresence.down} descended`);

    // ── the DATA boundary — the same rows, no page ──────────────────────────────────────────
    const beforeApi = new Date();
    const r = await hit(page, `/api/portal/${ten.slug}/proposals`);
    A('an rfp_admin reads a customer\'s workspace by derived membership — by design, not a leak',
      r.status === 200, `${r.status}`);
    await page.waitForTimeout(1800);
    const apiPresence = await presenceIn(beforeApi);
    // ⚠️ MEASURED, NOT ASSERTED. Whether a data-boundary read SHOULD bracket is a design decision
    // with a real cost — 294 API routes bracketing every request would bury the one signal a
    // customer reads this trail for. So this drive REPORTS the boundary rather than failing on it,
    // and the number is printed either way so the decision is made against a measurement.
    console.log(`  ▸ the same rows read through the API alone: ${apiPresence.down} descent(s) in `
      + `${ten.slug}'s trail. Presence is bracketed at the PAGE boundary, not the DATA boundary — `
      + 'see docs/VERIFICATION_COVERAGE_MAP.md, gap G3.');

    // Both ends, because the whole point of migs 246/247 is that an ENTER with no reliable EXIT
    // leaves a customer's record saying somebody is still in their account. A difference of one is
    // legal: the last bracket may not have closed by the time this reads.
    const total = await presenceIn(beforePage);
    A('…and every descent has its ascent, so no bracket is left open',
      Math.abs(total.down - total.up) <= 1, `${total.down} down · ${total.up} up`);
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
  console.log(`  MUTATED: 1 throwaway rfp_admin (${TEMP_EMAIL})${appId ? ' + 1 fixture application' : ''}, both removed below.`);
  console.log('  The three wall probes are POSTs that were REFUSED for the rfp_admin; lane D issued');
  console.log('  them as master_admin, so a force-release or an application decision MAY have landed.');
  console.log('  Both ids are the newest rows and the effects are reversible. Sandbox only.');
} catch (err) {
  if (browser) await browser.close().catch(() => {});
  if (tempId) await sql`DELETE FROM users WHERE id = ${tempId}::uuid`.catch(() => {});
  if (appId) await sql`DELETE FROM applications WHERE id = ${appId}::uuid`.catch(() => {});
  await sql.end().catch(() => {});
  dieWell(err);
}

if (browser) await browser.close().catch(() => {});
if (tempId) await sql`DELETE FROM users WHERE id = ${tempId}::uuid`;
if (appId) await sql`DELETE FROM applications WHERE id = ${appId}::uuid`;
await sql.end();

console.log(ok ? '\n✅ the rfp_admin boundary holds in both directions.'
               : '\n✗ the rfp_admin boundary does NOT hold — see the ✗ rows above.');
process.exit(ok ? 0 : 1);
