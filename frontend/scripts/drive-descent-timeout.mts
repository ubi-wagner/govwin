#!/usr/bin/env node --import tsx
/**
 * drive-descent-timeout.mts — does a descent expire when the PERSON stops, or only when the TAB does?
 *
 * ── THE DEFECT THIS PROVES CLOSED ────────────────────────────────────────────────────────────
 * `space_presence` had one liveness column, `last_seen_at`, advanced by two different things: a
 * request a person caused, and `PresenceHeartbeat` — a 2-minute client timer that fires while the
 * tab is merely VISIBLE. Since the heartbeat route also calls `auth()`, an unattended tab on a lit
 * monitor held BOTH open indefinitely:
 *
 *   · the bracket never timed out (`last_seen_at` kept advancing, so the 45-minute sweep never fired)
 *   · the session never expired (every `auth()` re-signs the cookie)
 *
 * So the component built to detect an idle outside actor was the thing preventing their timeout,
 * and a customer's audit trail asserted an RFP administrator was in their account all weekend.
 *
 * Mig 248 splits the two clocks and the portal layout gates on the new one. The property under
 * test is precisely:
 *
 *     THE HEARTBEAT ALONE MUST NOT HOLD A DESCENT OPEN.
 *
 * ── THE PAIRING THAT MAKES IT MEAN SOMETHING ─────────────────────────────────────────────────
 * Phase 3 and phase 4 only mean something together, and a drive with either one alone would pass
 * against broken code:
 *
 *   3 · heartbeat only, past the window  → the descent IS refused   (the fix works)
 *   4 · a real navigation, same window   → the descent is NOT refused (it did not just break descent)
 *
 * Without 4, deleting the descent entirely would pass. Without 3, the original defect passes.
 *
 * Time is compressed by ageing `last_interaction_at` in the database rather than waiting 30 minutes.
 * That is the same value the product writes and the gate reads — no test-only path is involved.
 *
 *   cd frontend && node --import tsx scripts/drive-descent-timeout.mts
 *
 * Exit 0 proven · 1 a check failed · 2 could not run.
 */
import { chromium } from 'playwright';
import postgres from 'postgres';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const EXE = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const DB = process.env.DATABASE_URL_OWNER || 'postgresql://govtech:changeme@localhost:5432/govtech_intel';
const PW = process.env.RFP_ADMIN_PW || process.env.SANDBOX_PASSWORD || 'SandboxDrive2026!';
const sql = postgres(DB, { max: 3, onnotice: () => {} });

let bad = 0;
const ok = (m: string, d = '') => console.log(`  ✓ ${m}${d ? ` — ${d}` : ''}`);
const no = (m: string, d = '') => { console.log(`  ✗ ${m}${d ? ` — ${d}` : ''}`); bad += 1; };
const phase = (t: string) => console.log(`\n══ ${t} ${'═'.repeat(Math.max(0, 72 - t.length))}`);

const cannot = async (why: string) => {
  console.error(`CANNOT RUN\n  ${why}`);
  await sql.end();
  process.exit(2);
};

// The gate needs the column mig 248 adds. Without it this drive would report a working product as
// broken, which is the failure this repo cares most about.
const [col] = await sql<{ n: string }[]>`
  SELECT count(*)::text AS n FROM information_schema.columns
   WHERE table_name = 'space_presence' AND column_name = 'last_interaction_at'`;
if (col?.n !== '1') await cannot('space_presence.last_interaction_at is absent — apply migration 248');

const [admin] = await sql<{ id: string; email: string }[]>`
  SELECT id, email FROM users WHERE role IN ('rfp_admin','master_admin') AND is_active
   ORDER BY (role = 'rfp_admin') DESC, created_at LIMIT 1`;
if (!admin) await cannot('no rfp_admin/master_admin fixture');

/** A tenant the admin is NOT a member of — otherwise they are not shadowing and no bracket opens. */
const [victim] = await sql<{ id: string; slug: string; name: string }[]>`
  SELECT t.id, t.slug, t.name FROM tenants t
   WHERE t.archived_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM user_memberships m
                      WHERE m.tenant_id = t.id AND m.user_id = ${admin!.id}::uuid AND m.status = 'active')
   ORDER BY t.created_at LIMIT 1`;
if (!victim) await cannot('no tenant this admin is a non-member of — nothing to shadow');

const openRows = async () => sql<{ id: string; closeReason: string | null }[]>`
  SELECT id, close_reason AS "closeReason" FROM space_presence
   WHERE user_id = ${admin!.id}::uuid AND tenant_id = ${victim!.id}::uuid AND closed_at IS NULL`;

const latest = async () => {
  const [r] = await sql<{ closeReason: string | null; closedAt: Date | null }[]>`
    SELECT close_reason AS "closeReason", closed_at AS "closedAt" FROM space_presence
     WHERE user_id = ${admin!.id}::uuid AND tenant_id = ${victim!.id}::uuid
     ORDER BY entered_at DESC LIMIT 1`;
  return r ?? null;
};

/** Age BOTH clocks, or only the interaction clock — the difference is the whole point. */
async function age(minutes: number, opts: { seenToo: boolean }) {
  if (opts.seenToo) {
    await sql`UPDATE space_presence
                 SET last_interaction_at = now() - make_interval(mins => ${minutes}),
                     last_seen_at        = now() - make_interval(mins => ${minutes})
               WHERE user_id = ${admin!.id}::uuid AND closed_at IS NULL`;
  } else {
    await sql`UPDATE space_presence
                 SET last_interaction_at = now() - make_interval(mins => ${minutes})
               WHERE user_id = ${admin!.id}::uuid AND closed_at IS NULL`;
  }
}

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
const ctx = await browser.newContext();
const page = await ctx.newPage();

try {
  console.log(`── descent timeout · ${BASE}`);
  console.log(`   admin=${admin!.email}  shadowing=${victim!.slug}\n`);

  // Start clean: a bracket left open by an earlier run would make phase 1 pass for the wrong reason.
  await sql`UPDATE space_presence SET closed_at = now(), close_reason = 'timeout'
             WHERE user_id = ${admin!.id}::uuid AND closed_at IS NULL`;

  phase('1 · the admin descends into a customer workspace');
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#email', { timeout: 30_000 });
  await page.fill('#email', admin!.email);
  await page.fill('#password', PW);
  await page.click('button[type="submit"]');
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(1500);
  if (page.url().includes('/login')) await cannot(`${admin!.email} could not sign in`);

  await page.goto(`${BASE}/portal/${victim!.slug}/dashboard`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(800);
  const landed = page.url();
  if (!landed.includes(`/portal/${victim!.slug}`)) {
    await cannot(`the admin did not land in the workspace — at ${landed}`);
  }
  const open1 = await openRows();
  if (open1.length !== 1) await cannot(`expected exactly one open bracket, found ${open1.length}`);
  ok('a bracket is open and the admin is inside the workspace');

  phase('2 · the heartbeat alone keeps the TAB alive — as it should');
  await age(60, { seenToo: false });                    // interaction stale, tab NOT
  const hb = await ctx.request.post(`${BASE}/api/presence/heartbeat`, { data: {} });
  const touched = (await hb.json().catch(() => null))?.data?.touched;
  ok('the heartbeat still reports the tab', `touched=${touched}`);
  const [after] = await sql<{ gapSec: string }[]>`
    SELECT extract(epoch from (now() - last_interaction_at))::int::text AS "gapSec"
      FROM space_presence WHERE user_id = ${admin!.id}::uuid AND closed_at IS NULL`;
  // THE CORE ASSERTION OF THE SPLIT. If the heartbeat advanced the interaction clock, this gap
  // collapses to ~0 and the gate in phase 3 could never fire.
  if (Number(after?.gapSec ?? 0) > 1800) {
    ok('and it did NOT advance the interaction clock', `still ${Math.round(Number(after.gapSec) / 60)}m idle`);
  } else {
    no('the heartbeat advanced the INTERACTION clock — the split is not in effect',
      `gap collapsed to ${after?.gapSec ?? '?'}s`);
  }

  phase('3 · past the window, the descent is REFUSED');
  await page.goto(`${BASE}/portal/${victim!.slug}/dashboard`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(800);
  const url3 = page.url();
  if (url3.includes(`/portal/${victim!.slug}`)) {
    no('the admin is STILL inside the customer workspace after the idle window', url3);
    console.log('    This is the pre-fix behaviour: nothing refuses a descent, and closing the');
    console.log('    bracket only evicted the RECORD.');
  } else {
    ok('the admin was redirected OUT of the workspace', url3.replace(BASE, ''));
    if (/descent=timeout/.test(url3)) ok('and the reason is carried, so the page can say why');
    else no('but no reason is carried — the person is bounced with no explanation', url3);

    /**
     * AND THE PAGE ACTUALLY SAYS IT. A query parameter nothing renders is the same silence.
     *
     * The first version of this gate redirected to `/admin?descent=timeout`; `/admin` is a bare
     * `redirect('/admin/dashboard')` and a redirect DROPS the query string, so the reason existed
     * and reached nobody. Asserting the URL alone would have passed that.
     */
    const body = await page.evaluate(() => {
      const clone = document.body.cloneNode(true) as HTMLElement;
      clone.querySelectorAll('script, style, template, noscript').forEach((n) => n.remove());
      return (clone.textContent || '').replace(/\s+/g, ' ');
    });
    if (/timed out after 30 minutes|returned to your own console/i.test(body)) {
      ok('and the page TELLS them why they were moved', 'not just a silent redirect');
    } else {
      no('the page does not say why — a silent ejection teaches people to walk back in',
        `${body.slice(0, 70)}…`);
    }
  }
  const l3 = await latest();
  if (l3?.closedAt && l3.closeReason === 'timeout') {
    ok('the bracket closed as `timeout` at the moment access ended', 'not up to an hour later');
  } else {
    no('the bracket was not closed on the way out', l3?.closeReason ?? 'still open');
  }

  phase('4 · a real navigation KEEPS the descent — this did not just break descent');
  // Re-enter, then age nothing. Without this pairing, deleting descent entirely passes phase 3.
  await page.goto(`${BASE}/portal/${victim!.slug}/dashboard`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(800);
  if (page.url().includes(`/portal/${victim!.slug}`)) {
    ok('re-entering works immediately — the gate refuses idleness, not the actor');
  } else {
    no('the admin cannot re-enter at all', page.url());
  }
  await age(20, { seenToo: true });                     // inside the 30m window
  await page.goto(`${BASE}/portal/${victim!.slug}/cards`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(800);
  if (page.url().includes(`/portal/${victim!.slug}`)) {
    ok('20 minutes idle is INSIDE the window and the descent holds', 'the gate is not a hair trigger');
  } else {
    no('a 20-minute gap ejected the admin — the window is wrong', page.url());
  }

  phase('5 · the customer\'s trail reads as a sentence');
  const trail = await sql<{ kind: string; reason: string | null; mins: string }[]>`
    SELECT kind, close_reason AS reason,
           round(extract(epoch from (COALESCE(closed_at, now()) - entered_at)) / 60)::text AS mins
      FROM space_presence
     WHERE user_id = ${admin!.id}::uuid AND tenant_id = ${victim!.id}::uuid
     ORDER BY entered_at DESC LIMIT 3`;
  for (const t of trail) {
    console.log(`  · ${t.kind} · ${t.mins}m · ${t.reason ?? 'still open'}`);
  }
  if (trail.some((t) => t.reason === 'timeout')) ok('a timeout departure is recorded for the customer to see');
  else no('no timeout departure in the trail');
} finally {
  // Leave the box as found: close anything this drive opened.
  await sql`UPDATE space_presence SET closed_at = now(), close_reason = 'timeout'
             WHERE user_id = ${admin!.id}::uuid AND closed_at IS NULL`.catch(() => {});
  await browser.close();
  await sql.end();
}

console.log();
if (bad === 0) console.log('✓ a descent expires when the person stops, not when the tab does.');
else console.log(`✗ ${bad} check(s) failed.`);
process.exit(bad === 0 ? 0 : 1);
