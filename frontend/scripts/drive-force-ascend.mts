#!/usr/bin/env node --import tsx
/**
 * drive-force-ascend.mts — can an operator actually get somebody OUT of a customer's workspace?
 *
 * ── THE GAP ──────────────────────────────────────────────────────────────────────────────────
 * `/admin/workspace-access` answers "is anyone inside a customer's account right now, and for how
 * long" — and could do nothing about it. Every closer `space_presence` had was the actor themselves
 * or the clock: explicit · left_space · moved · signed_out · timeout. There was no way for a second
 * person to end a presence, which is the one thing an operator staring at that page wants.
 *
 * ── THE TRAP THIS DRIVE EXISTS TO CATCH ──────────────────────────────────────────────────────
 * Closing the bracket is NOT eviction. `isShadowAdmin` is recomputed on every portal render as
 * "is an admin AND is not a member here", so the target's very next page load calls
 * `syncPortalPresence` and opens a fresh bracket. A button that only closed the row would look like
 * it worked, change nothing, and quietly teach an operator that the control is real.
 *
 * So check 3 is the one that matters: after the force-ascend, the target must be REFUSED when they
 * try to walk back in. Checks 1 and 2 would both pass against the broken version.
 *
 *   1 the target is inside the workspace
 *   2 the operator ends it — the bracket closes as `forced`, distinct from `timeout`
 *   3 THE TARGET IS ACTUALLY REFUSED on their next navigation, and told who ended it
 *   4 ending your OWN presence is refused — that is what the exit control is for
 *   5 the act is audited against the OPERATOR, not the person ejected
 *
 *   cd frontend && node --import tsx scripts/drive-force-ascend.mts
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
const phase = (t: string) => console.log(`\n══ ${t} ${'═'.repeat(Math.max(0, 66 - t.length))}`);
const cannot = async (why: string) => {
  console.error(`CANNOT RUN\n  ${why}`); await sql.end(); process.exit(2);
};

const [col] = await sql<{ n: string }[]>`
  SELECT count(*)::text AS n FROM pg_constraint
   WHERE conname = 'space_presence_close_reason_check'
     AND pg_get_constraintdef(oid) LIKE '%forced%'`;
if (col?.n !== '1') await cannot("the close_reason CHECK has no 'forced' — apply migration 250");

/** TWO admins: one to be ejected, one to do the ejecting. Check 4 needs them distinct. */
const admins = await sql<{ id: string; email: string }[]>`
  SELECT id, email FROM users WHERE role IN ('rfp_admin','master_admin') AND is_active
   ORDER BY created_at LIMIT 2`;
if (admins.length < 2) await cannot('need two admin accounts — one to eject, one to eject them');
const [target, operator] = admins;

const [victim] = await sql<{ id: string; slug: string; name: string }[]>`
  SELECT t.id, t.slug, t.name FROM tenants t
   WHERE t.archived_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM user_memberships m
                      WHERE m.tenant_id = t.id AND m.user_id = ${target!.id}::uuid AND m.status = 'active')
   ORDER BY t.created_at LIMIT 1`;
if (!victim) await cannot('no tenant the target is a non-member of — nothing to shadow');

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-setuid-sandbox'] });

async function signIn(email: string) {
  const c = await browser.newContext();
  const p = await c.newPage();
  await p.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('#email', { timeout: 30_000 });
  await p.fill('#email', email);
  await p.fill('#password', PW);
  await p.click('button[type="submit"]');
  await p.waitForLoadState('networkidle').catch(() => {});
  await p.waitForTimeout(1500);
  return { ctx: c, page: p, ok: !p.url().includes('/login') };
}

const T = await signIn(target!.email);
const O = await signIn(operator!.email);

try {
  console.log(`── force ascend · ${BASE}`);
  console.log(`   target=${target!.email}  operator=${operator!.email}  company=${victim!.slug}\n`);
  if (!T.ok) await cannot(`${target!.email} could not sign in`);
  if (!O.ok) await cannot(`${operator!.email} could not sign in`);

  // Start clean, and clear any cooldown a previous run left behind.
  await sql`UPDATE space_presence SET closed_at = now(), close_reason = 'timeout'
             WHERE user_id = ${target!.id}::uuid AND closed_at IS NULL`;
  await sql`DELETE FROM space_presence
             WHERE user_id = ${target!.id}::uuid AND tenant_id = ${victim!.id}::uuid
               AND close_reason = 'forced'`;

  phase('1 · the target is inside the customer workspace');
  await T.page.goto(`${BASE}/portal/${victim!.slug}/dashboard`, { waitUntil: 'domcontentloaded' });
  await T.page.waitForLoadState('networkidle').catch(() => {});
  await T.page.waitForTimeout(800);
  if (!T.page.url().includes(`/portal/${victim!.slug}`)) {
    await cannot(`the target did not land in the workspace — at ${T.page.url()}`);
  }
  const [open1] = await sql<{ n: string }[]>`
    SELECT count(*)::text AS n FROM space_presence
     WHERE user_id = ${target!.id}::uuid AND tenant_id = ${victim!.id}::uuid AND closed_at IS NULL`;
  if (open1?.n === '1') ok('a bracket is open and they are inside');
  else no('no open bracket', `count=${open1?.n}`);

  phase('2 · the operator ends it');
  const r = await O.ctx.request.post(`${BASE}/api/admin/workspace-access/force-ascend`, {
    data: { userId: target!.id, tenantId: victim!.id }, failOnStatusCode: false,
  });
  const body = await r.json().catch(() => null);
  if (r.status() === 200 && (body?.data?.closed ?? 0) > 0) {
    ok('the route ends the presence', `closed=${body.data.closed}, cooldown=${body.data.cooldownMinutes}m`);
  } else {
    no('the route did not end it', `${r.status()} ${JSON.stringify(body).slice(0, 80)}`);
  }
  const [latest] = await sql<{ reason: string | null }[]>`
    SELECT close_reason AS reason FROM space_presence
     WHERE user_id = ${target!.id}::uuid AND tenant_id = ${victim!.id}::uuid
     ORDER BY entered_at DESC LIMIT 1`;
  if (latest?.reason === 'forced') {
    ok('the trail records `forced`, not `timeout`', 'a named person ended it, not the clock');
  } else {
    no('the close reason is wrong', latest?.reason ?? 'still open');
  }

  phase('3 · and the target is ACTUALLY refused — the check that matters');
  // Closing the row is not eviction: isShadowAdmin is recomputed per render, so a button that only
  // closed the bracket would pass phases 1 and 2 and change nothing at all.
  await T.page.goto(`${BASE}/portal/${victim!.slug}/dashboard`, { waitUntil: 'domcontentloaded' });
  await T.page.waitForLoadState('networkidle').catch(() => {});
  await T.page.waitForTimeout(800);
  const url3 = T.page.url();
  if (url3.includes(`/portal/${victim!.slug}`)) {
    no('the target walked straight back in', url3);
    console.log('    The bracket closed and the actor did not. This is the trap: an operator');
    console.log('    presses the button, the row changes, and nobody is actually removed.');
  } else {
    ok('the target is refused and returned to their console', url3.replace(BASE, ''));
    const text = await T.page.evaluate(() => {
      const c = document.body.cloneNode(true) as HTMLElement;
      c.querySelectorAll('script, style, template, noscript').forEach((n) => n.remove());
      return (c.textContent || '').replace(/\s+/g, ' ');
    });
    if (/ended by another administrator/i.test(text)) {
      ok('and the page says an administrator ended it', 'not "you went idle"');
    } else {
      no('the page does not distinguish this from an idle timeout', `${text.slice(0, 70)}…`);
    }
  }

  phase('4 · ending your OWN presence is refused');
  const self = await O.ctx.request.post(`${BASE}/api/admin/workspace-access/force-ascend`, {
    data: { userId: operator!.id }, failOnStatusCode: false,
  });
  const sBody = await self.json().catch(() => null);
  if (self.status() === 400 && sBody?.code === 'SELF_TARGET') {
    ok('refused with SELF_TARGET', 'the exit control is for leaving yourself');
  } else {
    no('an operator can force-ascend themselves', `HTTP ${self.status()}`);
    console.log('    That would write `forced` into a customer\'s trail for something the actor did');
    console.log('    themselves — a false fact in the record that most needs to be true.');
  }

  phase('5 · the act is audited against the OPERATOR');
  const [ev] = await sql<{ actorId: string | null }[]>`
    SELECT actor_id AS "actorId" FROM system_events
     WHERE namespace = 'identity' AND type = 'presence.force_ended'
       AND payload->>'targetUserId' = ${target!.id}
     ORDER BY created_at DESC LIMIT 1`;
  if (!ev) no('no presence.force_ended event — the ejection is invisible');
  else if (ev.actorId === operator!.id) ok('the event names the operator who did it');
  else no('the event names the wrong actor', `${ev.actorId} (expected the operator)`);
} finally {
  await sql`DELETE FROM system_events WHERE payload->>'targetUserId' = ${target!.id}`.catch(() => {});
  await sql`DELETE FROM space_presence
             WHERE user_id = ${target!.id}::uuid AND tenant_id = ${victim!.id}::uuid
               AND close_reason = 'forced'`.catch(() => {});
  await sql`UPDATE space_presence SET closed_at = now(), close_reason = 'timeout'
             WHERE user_id = ${target!.id}::uuid AND closed_at IS NULL`.catch(() => {});
  console.log('\n  MUTATED, then removed: presence rows + events for this run');
  await browser.close();
  await sql.end();
}

console.log();
if (bad === 0) console.log('✓ an operator can end somebody\'s access, and it actually removes them.');
else console.log(`✗ ${bad} check(s) failed.`);
process.exit(bad === 0 ? 0 : 1);
