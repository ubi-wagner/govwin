#!/usr/bin/env node --import tsx
/**
 * prove-session-cap.mts — does the absolute cap actually END a session that is IN USE?
 *
 * ── WHY A SEPARATE SCRIPT FROM THE PROBE ─────────────────────────────────────────────────────
 * `probe-session-lifecycle.mts` measures the POSTURE — does a request move the deadline. This
 * proves the MECHANISM: that `sessionEndReason` returning a reason from the `jwt` callback actually
 * signs a person out of this app. Those are different claims and the second one is the one that
 * could be wired up wrong while every unit test passes.
 *
 * The unit tests in `__tests__/session-policy.test.ts` prove the arithmetic. They cannot prove that
 * returning `null` from the callback reaches `@auth/core`'s `sessionStore.clean()` branch, that the
 * cookie is really removed, or that a page then refuses the actor. Only a running server can.
 *
 * ── HOW IT AVOIDS WAITING TWELVE HOURS ───────────────────────────────────────────────────────
 * `SESSION_CAP_MS_OVERRIDE` shortens the absolute cap. It is read ONLY by this proof's dev server,
 * never in production — see `lib/session-policy.ts`, where the override is refused unless
 * `NODE_ENV !== 'production'`. A cap that could be widened by an environment variable in production
 * would be a hole exactly where this file is trying to close one.
 *
 * ── THE PROPERTY UNDER TEST, STATED PRECISELY ────────────────────────────────────────────────
 * Not "an idle session ends" — that one already half-worked, because the cookie's own sliding
 * `maxAge` would eventually lapse. The property is:
 *
 *     A session that is CONTINUOUSLY IN USE still ends at the cap.
 *
 * That is the one that did not exist. Before this change an active session was immortal, so the
 * proof keeps making requests the whole time and asserts the session dies anyway.
 *
 *   BASE_URL=http://localhost:3001 node --import tsx scripts/prove-session-cap.mts
 *
 * Exit 0 proven · 1 the cap did not fire · 2 could not run.
 */
import { chromium } from 'playwright';
import postgres from 'postgres';

const BASE = process.env.BASE_URL || 'http://localhost:3001';
const EXE = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const DB = process.env.DATABASE_URL_OWNER || 'postgresql://govtech:changeme@localhost:5432/govtech_intel';
const PW = process.env.RFP_ADMIN_PW || process.env.SANDBOX_PASSWORD || 'SandboxDrive2026!';
/** Must match what the server under test was started with. */
const CAP_MS = Number(process.env.SESSION_CAP_MS_OVERRIDE || 25_000);

const sql = postgres(DB, { max: 2, onnotice: () => {} });
let bad = 0;
const ok = (m: string, d = '') => console.log(`  ✓ ${m}${d ? ` — ${d}` : ''}`);
const no = (m: string, d = '') => { console.log(`  ✗ ${m}${d ? ` — ${d}` : ''}`); bad += 1; };

const [admin] = await sql<{ email: string }[]>`
  SELECT email FROM users WHERE role IN ('rfp_admin','master_admin') AND is_active
   ORDER BY (role = 'rfp_admin') DESC, created_at LIMIT 1`;
if (!admin) { console.error('CANNOT RUN\n  no admin fixture'); await sql.end(); process.exit(2); }

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
const ctx = await browser.newContext();
const page = await ctx.newPage();

/** Is this context still authenticated? Asked of a REAL gated surface, not of the cookie jar. */
async function stillSignedIn(): Promise<boolean> {
  const r = await ctx.request.get(`${BASE}/api/admin/notes`, { failOnStatusCode: false });
  return r.status() !== 401 && r.status() !== 403;
}

try {
  console.log(`── absolute cap proof · ${BASE} · expecting cap=${CAP_MS}ms\n`);

  /**
   * ASK THE SERVER WHAT BOUND IT IS ACTUALLY ENFORCING, BEFORE MEASURING ANYTHING.
   *
   * This proof ran twice without this check and reported "the session survived past the cap WHILE
   * IN USE" both times — once as the intended red, once as a green that should have passed. Both
   * were measuring a server whose cap was the 12-hour default: the launch carrying
   * SESSION_CAP_MS_OVERRIDE failed to bind because the port was already held, died silently, and
   * the previous server kept answering. The env var never reached a process.
   *
   * So the failure was in the instrument and it printed as a failure in the product — the exact
   * inversion this repo keeps finding. A proof that cannot confirm the parameter it is testing
   * against must refuse, not measure.
   */
  const health = await ctx.request.get(`${BASE}/api/health`, { failOnStatusCode: false });
  const hb = await health.json().catch(() => null);
  const serverCap = hb?.session?.absoluteMaxMs;
  if (typeof serverCap !== 'number') {
    console.error('CANNOT RUN');
    console.error('  /api/health does not report session.absoluteMaxMs — this build predates the');
    console.error('  bound, so there is nothing to prove and nothing to prove it against.');
    await browser.close(); await sql.end(); process.exit(2);
  }
  if (serverCap !== CAP_MS) {
    console.error('CANNOT RUN');
    console.error(`  the server is enforcing a ${Math.round(serverCap / 1000)}s cap; this proof expects ${Math.round(CAP_MS / 1000)}s.`);
    console.error('  SESSION_CAP_MS_OVERRIDE did not reach the server process. The usual cause is a');
    console.error('  launch that failed to bind because an older server still holds the port —');
    console.error('  check with: ss -ltnp | grep :3001, and read /proc/<pid>/environ.');
    console.error('  Refusing to measure: every verdict would be about this harness.');
    await browser.close(); await sql.end(); process.exit(2);
  }
  ok(`the server confirms it is enforcing a ${Math.round(serverCap / 1000)}s cap`);

  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#email', { timeout: 30_000 });
  await page.fill('#email', admin.email);
  await page.fill('#password', PW);
  await page.click('button[type="submit"]');
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(2000);
  if (page.url().includes('/login')) {
    console.error(`CANNOT RUN\n  ${admin.email} could not sign in`);
    await browser.close(); await sql.end(); process.exit(2);
  }
  const signedInAt = Date.now();
  ok(`signed in as ${admin.email}`);

  if (!(await stillSignedIn())) {
    console.error('CANNOT RUN\n  the gated surface refused immediately — the detector is wrong, not the cap');
    await browser.close(); await sql.end(); process.exit(2);
  }
  ok('a gated surface accepts the session — the detector can tell signed-in from signed-out');

  // ── KEEP IT BUSY. This is the part that matters: under the previous behaviour every one of
  //    these requests re-signed the cookie with a fresh deadline, so the session never ended.
  let requests = 0;
  let diedAfterMs: number | null = null;
  const deadline = signedInAt + CAP_MS + 20_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000));
    requests += 1;
    if (!(await stillSignedIn())) { diedAfterMs = Date.now() - signedInAt; break; }
  }

  if (diedAfterMs === null) {
    no('the session survived past the cap WHILE IN USE',
      `${requests} request(s) over ${Math.round((Date.now() - signedInAt) / 1000)}s and still signed in`);
    console.log('    This is the pre-fix behaviour: every request re-signs the cookie, so an active');
    console.log('    session is immortal. The cap is not reaching the jwt callback.');
  } else {
    const s = Math.round(diedAfterMs / 1000);
    ok(`the session ENDED while continuously in use`, `after ${s}s and ${requests} request(s)`);
    // Not "close to the cap" — AT OR AFTER it. Ending early would be its own defect: a person
    // signed out before the stated bound is a different broken promise.
    if (diedAfterMs + 3000 < CAP_MS) {
      no('but it ended EARLY, before the cap', `${s}s < ${Math.round(CAP_MS / 1000)}s`);
    } else {
      ok('and it ended at or after the cap, not before', `cap=${Math.round(CAP_MS / 1000)}s`);
    }
  }

  // ── AND THE COOKIE IS ACTUALLY GONE, not merely rejected ──────────────────────────────────
  // A server that refuses a cookie it still hands back leaves the browser retrying a dead token
  // forever, and the person sees a login loop rather than a login page.
  const cookies = await ctx.cookies();
  const stillHeld = cookies.some((c) => /session-token/.test(c.name) && (c.value ?? '').length > 0);
  if (diedAfterMs !== null) {
    if (stillHeld) no('the session cookie is still in the jar after the cap fired', 'expect it cleaned');
    else ok('the session cookie was cleaned, not just refused');
  }

  // ── A FRESH SIGN-IN STILL WORKS ───────────────────────────────────────────────────────────
  // The cap must end a session, not the account. Without this the proof is compatible with having
  // simply broken login.
  //
  // ONLY when the cap actually fired. On the red run the session never ended, so /login redirects
  // an already-authenticated actor away and `#email` never appears — the harness then died on a
  // selector timeout AFTER having correctly reported the red finding, which reads as a broken
  // instrument rather than a proven absence.
  if (diedAfterMs === null) {
    console.log('    (skipping the re-sign-in phase: the session never ended, so there is nothing');
    console.log('     to sign back INTO — a login form is not shown to a live session.)');
  } else {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#email', { timeout: 30_000 });
  await page.fill('#email', admin.email);
  await page.fill('#password', PW);
  await page.click('button[type="submit"]');
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(2000);
  if (await stillSignedIn()) ok('signing in again works — the cap ended the session, not the account');
  else no('could not sign in again after the cap fired');
  }
} finally {
  await browser.close();
  await sql.end();
}

console.log();
if (bad === 0) console.log('✓ the absolute cap ends a session that is in continuous use.');
else console.log(`✗ ${bad} check(s) failed.`);
process.exit(bad === 0 ? 0 : 1);
