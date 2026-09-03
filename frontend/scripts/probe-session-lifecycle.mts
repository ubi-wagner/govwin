#!/usr/bin/env node --import tsx
/**
 * probe-session-lifecycle.mts — WHAT ACTUALLY ENDS A SESSION, measured rather than read.
 *
 * ── THE QUESTION ─────────────────────────────────────────────────────────────────────────────
 * `auth.config.ts` says `session: { strategy: 'jwt', maxAge: 8 * 60 * 60 }`. That single line has
 * two completely different meanings and the difference is the whole security posture:
 *
 *   ABSOLUTE — the session dies 8 hours after SIGN-IN, whatever you do. A shadow admin who drops
 *              into a customer workspace is out by end of day, guaranteed.
 *   SLIDING  — the session dies 8 hours after the LAST REQUEST. An active session renews forever,
 *              and an open tab that pings anything holds it open indefinitely.
 *
 * Reading @auth/core says sliding: the JWT branch of the session action re-signs the token with a
 * fresh expiry on every read, with no `updateAge` throttle on that path (the throttle is on the
 * DATABASE strategy). But "what the library does" and "what this app does" are different claims —
 * `auth()` called inside a route handler that builds its own NextResponse may never emit the
 * refreshed Set-Cookie at all. So this measures the cookie the browser actually holds.
 *
 * That matters most for the case this repo cares about: an rfp_admin or partner-manager INSIDE a
 * customer's workspace. `PresenceHeartbeat` pings `/api/presence/heartbeat` every 2 minutes while
 * the tab is visible, and that route calls `auth()`. If a session read refreshes the cookie, then
 * the component built to detect an idle outside actor is also the thing preventing them from ever
 * timing out — and the presence sweep never fires either, because `last_seen_at` keeps advancing.
 *
 * ── WHAT IT MEASURES ─────────────────────────────────────────────────────────────────────────
 * For each actor it signs in, records the session cookie's expiry, then exercises four request
 * shapes and re-reads the expiry after each:
 *
 *   1. a PAGE render (server component calling auth())
 *   2. an API route that calls auth() and returns its own NextResponse
 *   3. `/api/presence/heartbeat` specifically — the one that runs unattended on a timer
 *   4. `/api/auth/session` — the library's own endpoint, the known-refreshing control
 *
 * (4) is the CONTROL. If the control does not advance the expiry, the probe is measuring nothing
 * and says so rather than reporting "nothing refreshes the session", which is what a broken
 * measurement looks like and is indistinguishable from the safest possible finding.
 *
 * ── WHAT IT DOES NOT CLAIM ───────────────────────────────────────────────────────────────────
 * It cannot wait 8 hours, so it does not observe an actual expiry. It observes whether the DEADLINE
 * MOVES, which is the property that decides absolute vs sliding.
 *
 *   cd frontend && node --import tsx scripts/probe-session-lifecycle.mts
 *
 * Exit 0 measured · 2 could not measure (the control failed, or an actor could not sign in).
 */
import { chromium, type BrowserContext } from 'playwright';
import postgres from 'postgres';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const EXE = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const DB = process.env.DATABASE_URL_OWNER || 'postgresql://govtech:changeme@localhost:5432/govtech_intel';
const sql = postgres(DB, { max: 2, onnotice: () => {} });

const ADMIN_PW = process.env.RFP_ADMIN_PW || process.env.SANDBOX_PASSWORD || 'SandboxDrive2026!';
const TENANT_PW = process.env.TENANT_PW || 'DemoPass123!';

let bad = 0;
const ok = (m: string, d = '') => console.log(`  ✓ ${m}${d ? ` — ${d}` : ''}`);
const no = (m: string, d = '') => { console.log(`  ✗ ${m}${d ? ` — ${d}` : ''}`); bad += 1; };
const note = (m: string) => console.log(`  · ${m}`);
const phase = (t: string) => console.log(`\n══ ${t} ${'═'.repeat(Math.max(0, 76 - t.length))}`);

/** The session cookie's expiry, in ms. `-1` when the cookie is a session cookie or absent. */
async function sessionExpiry(ctx: BrowserContext): Promise<number> {
  const cookies = await ctx.cookies();
  const c = cookies.find((x) => /^(__Secure-)?authjs\.session-token/.test(x.name)
    || /^(__Secure-)?next-auth\.session-token/.test(x.name));
  return c ? Math.round((c.expires ?? -1) * 1000) : -1;
}

async function signIn(ctx: BrowserContext, email: string, password: string): Promise<boolean> {
  const page = await ctx.newPage();
  try {
    await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#email', { timeout: 20_000 });
    await page.fill('#email', email);
    await page.fill('#password', password);
    await page.click('button[type="submit"]');
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(1500);
    return !page.url().includes('/login');
  } catch {
    return false;
  } finally {
    await page.close();
  }
}

/**
 * Did this request move the session deadline?
 *
 * A one-second granularity guard: cookie expiries are whole seconds, so two requests inside the
 * same second legitimately produce an identical deadline. Sleeping past a second boundary first is
 * what makes "did not move" mean something.
 */
async function movesDeadline(ctx: BrowserContext, label: string, act: () => Promise<void>) {
  const before = await sessionExpiry(ctx);
  await new Promise((r) => setTimeout(r, 1100));
  await act();
  await new Promise((r) => setTimeout(r, 300));
  const after = await sessionExpiry(ctx);
  const moved = after > before;
  const delta = before > 0 && after > 0 ? Math.round((after - before) / 1000) : 0;
  return { before, after, moved, delta, label };
}

async function resolveActors() {
  // rfp_admin OR master_admin: both hold the derived shadow membership and both short-circuit
  // `verifyTenantAccess`, so either exercises the descent path. Naming only `rfp_admin` made this
  // report CANNOT RUN on a box whose admins are all master_admin — a fixture predicate narrower
  // than the property it is testing, which reads as an unrunnable probe rather than a mis-aimed one.
  const [admin] = await sql<{ email: string }[]>`
    SELECT email FROM users WHERE role IN ('rfp_admin', 'master_admin') AND is_active
     ORDER BY (role = 'rfp_admin') DESC, created_at LIMIT 1`;
  const [tenant] = await sql<{ email: string; slug: string }[]>`
    SELECT u.email, t.slug FROM users u
      JOIN user_memberships m ON m.user_id = u.id AND m.status = 'active'
      JOIN tenants t ON t.id = m.tenant_id AND t.archived_at IS NULL
     WHERE u.role = 'tenant_admin' AND u.is_active
     ORDER BY u.created_at LIMIT 1`;
  return { admin: admin?.email ?? null, tenant: tenant?.email ?? null, slug: tenant?.slug ?? null };
}

const A = await resolveActors();
if (!A.admin || !A.tenant || !A.slug) {
  console.error('CANNOT RUN');
  console.error(`  no usable fixture — admin=${A.admin} tenant=${A.tenant} slug=${A.slug}`);
  await sql.end();
  process.exit(2);
}

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-setuid-sandbox'] });

try {
  // ── CONTROL FIRST ──────────────────────────────────────────────────────────────────────────
  //
  // The library's own /api/auth/session is documented to re-sign the token. If THAT does not move
  // the deadline, this probe cannot see a refresh at all, and every "does not refresh" below would
  // be a property of the instrument rather than of the app.
  phase('0 · CONTROL — can this probe see a refresh at all?');
  const cctx = await browser.newContext();
  if (!(await signIn(cctx, A.admin, ADMIN_PW))) {
    console.error(`\nCANNOT RUN\n  ${A.admin} could not sign in — check RFP_ADMIN_PW`);
    await browser.close(); await sql.end(); process.exit(2);
  }
  const initial = await sessionExpiry(cctx);
  if (initial <= 0) {
    console.error('\nCANNOT RUN\n  the session cookie carries no expiry — nothing to measure');
    await browser.close(); await sql.end(); process.exit(2);
  }
  note(`signed in as ${A.admin}; session cookie expires ${new Date(initial).toISOString()}`);
  note(`that is ${Math.round((initial - Date.now()) / 60000)} minutes from now`);

  const ctl = await movesDeadline(cctx, '/api/auth/session', async () => {
    const p = await cctx.newPage();
    await p.goto(`${BASE}/api/auth/session`, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await p.close();
  });
  if (!ctl.moved) {
    console.error('\nCANNOT RUN — HARNESS DEFECT');
    console.error('  the library\'s own session endpoint did not move the cookie deadline, so this');
    console.error('  probe cannot detect a refresh. Every "does not refresh" it printed would be');
    console.error('  unearned, and unearned here reads as the SAFEST possible finding.');
    await browser.close(); await sql.end(); process.exit(2);
  }
  ok('the control refreshes the deadline — a refresh is detectable', `+${ctl.delta}s`);

  // ── THE FOUR REQUEST SHAPES ────────────────────────────────────────────────────────────────
  phase('1 · Which ordinary requests move the deadline?');
  const shapes: Array<{ label: string; act: () => Promise<void> }> = [
    {
      label: 'a PAGE render (server component calling auth())',
      act: async () => {
        const p = await cctx.newPage();
        await p.goto(`${BASE}/admin/dashboard`, { waitUntil: 'domcontentloaded' }).catch(() => {});
        await p.waitForLoadState('networkidle').catch(() => {});
        await p.close();
      },
    },
    {
      label: 'an API route calling auth() and returning its own NextResponse',
      act: async () => { await cctx.request.get(`${BASE}/api/notifications`).catch(() => {}); },
    },
    {
      label: 'POST /api/presence/heartbeat — the unattended 2-minute timer',
      act: async () => { await cctx.request.post(`${BASE}/api/presence/heartbeat`, { data: {} }).catch(() => {}); },
    },
  ];

  const results: Array<{ label: string; moved: boolean; delta: number }> = [];
  for (const s of shapes) {
    const r = await movesDeadline(cctx, s.label, s.act);
    results.push({ label: s.label, moved: r.moved, delta: r.delta });
    if (r.moved) note(`SLIDES  ${s.label} (+${r.delta}s)`);
    else note(`inert   ${s.label}`);
  }

  // ── THE VERDICT ────────────────────────────────────────────────────────────────────────────
  phase('2 · Absolute or sliding?');
  const anySlide = results.some((r) => r.moved);
  const heartbeatSlides = results.find((r) => r.label.startsWith('POST /api/presence'))?.moved ?? false;

  if (anySlide) {
    no('the 8-hour session is SLIDING, not absolute',
      'it is measured from the LAST REQUEST, so an active session renews indefinitely');
    note('There is no absolute cap: a session that keeps being used is never signed out.');
  } else {
    ok('no ordinary request moved the deadline — the 8 hours run from sign-in',
      'an absolute cap, which is the safer of the two');
  }

  if (heartbeatSlides) {
    no('PresenceHeartbeat renews the session of the actor it is watching',
      'mounted only for an admin/partner INSIDE a customer workspace, on a 2-minute timer');
    note('So a visible-but-unattended tab holds BOTH the session and the descent open indefinitely,');
    note('and the 45-minute presence sweep never fires because last_seen_at keeps advancing.');
    note('The component built to detect an idle outside actor is what prevents their timeout.');
  } else if (anySlide) {
    ok('the heartbeat itself does NOT renew the session', 'only user-driven requests do');
  }

  // ── WHAT SURVIVES A NEW TAB / RESTORED SESSION ─────────────────────────────────────────────
  //
  // The descent lives in the JWT (`membershipPinned`, `partnerHomeRole`) and the bracket lives in a
  // table. A session that outlives the work is one thing; a DESCENT that outlives the visit is the
  // one the customer sees in their own audit trail.
  phase('3 · Does a descent survive with nobody driving it?');
  const openBrackets = await sql<{ n: string }[]>`
    SELECT count(*)::text AS n FROM space_presence WHERE closed_at IS NULL`;
  note(`${openBrackets[0]?.n ?? '?'} presence bracket(s) currently open on this box`);
  const stale = await sql<{ n: string }[]>`
    SELECT count(*)::text AS n FROM space_presence
     WHERE closed_at IS NULL AND last_seen_at < now() - interval '45 minutes'`;
  const staleN = Number(stale[0]?.n ?? 0);
  if (staleN > 0) {
    note(`${staleN} of them are past the 45-minute idle floor and would be closed by the sweep`);
    note('— IF the sweep runs. It is gated on SPACE_PRESENCE_SWEEP_URL + CRON_SECRET.');
  }

  await cctx.close();
} finally {
  await browser.close();
  await sql.end();
}

console.log();
if (bad === 0) console.log('✓ session lifecycle measured; nothing unbounded found.');
else console.log(`✗ ${bad} unbounded-session propert${bad === 1 ? 'y' : 'ies'} measured — see above.`);
// This probe REPORTS a posture; it does not grade it as a build failure. Exit 0 unless it could not
// measure, which is the only outcome that would make its output meaningless.
process.exit(0);
