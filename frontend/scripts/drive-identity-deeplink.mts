/**
 * Drive-test: "identity is 100% even with deep-linked emails."
 *
 * Nudge/notification emails (platform@rfppipeline.com) deep-link recipients to /go?task=…
 * or /go?tenant=… (and /api/enter). Whatever their session state, they must ALWAYS end up
 * acting in the RIGHT company, auditably, under the singular-session rule. This proves it
 * end-to-end against the real JWT-derived session (GET /api/auth/session).
 *
 * Fixtures:
 *   expert@beacon-labs.test — MULTI: tenant_admin @ beacon-labs (home) + partner_user @ acme.
 *   teammate@acme-navy.test — SINGLE: tenant_user @ acme (non-member of beacon).
 *
 * CASE 1  switch round-trip: pinned to Acme, deep-link → Beacon → switch gate (no silent
 *         switch) → sign out → re-login → lands PINNED to Beacon as tenant_admin.
 * CASE 2  unauthed multi-membership deep-link to ACME (non-home): login preserves the target
 *         (middleware query fix) → lands PINNED to Acme as partner_user, NOT their beacon home.
 * CASE 3  non-member denial: teammate (acme-only) deep-link → beacon → dispatcher, stays acme.
 * CASE 4  dead link: completed task → "already complete" ack (no broken destination).
 * CASE 5  /api/enter direct-hit while pinned-different → hands off to the switch gate, never
 *         silently re-pins.
 */
import { chromium, type Page } from 'playwright';
import postgres from 'postgres';

const BASE = 'http://localhost:3000';
const PW = 'DemoPass123!';
const EXPERT = 'expert@beacon-labs.test';
const TEAMMATE = 'teammate@acme-navy.test';
const sql = postgres(process.env.DATABASE_URL!, { max: 2 });
let exitCode = 0;
const ok = (c: boolean, l: string) => { console.log(`${c ? '✅' : '❌ FAIL'}  ${l}`); if (!c) exitCode = 1; };

async function sess(page: Page): Promise<Record<string, unknown>> {
  const r = await page.request.get(`${BASE}/api/auth/session`);
  const j = await r.json().catch(() => ({}));
  return (j?.user ?? {}) as Record<string, unknown>;
}
async function clean(page: Page) {
  await page.context().clearCookies();
}
async function login(page: Page, email: string) {
  await clean(page);
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PW);
  await Promise.all([page.waitForLoadState('networkidle'), page.click('button[type="submit"]')]);
  await page.waitForTimeout(1200);
}

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();

// ── Seed a COMPLETED task at beacon-labs, owned by expert, so /go?task can prove the
//    "already complete" dead-link path. Cleaned up in finally.
let completedTaskId = '';
try {
  const [expertRow] = await sql<{ id: string }[]>`SELECT id FROM users WHERE email=${EXPERT}`;
  const [beacon] = await sql<{ id: string }[]>`SELECT id FROM tenants WHERE slug='beacon-labs'`;
  const [t] = await sql<{ id: string }[]>`
    INSERT INTO tasks (tenant_id, assignee_user_id, assignee_role, task_type, title, status, completed_at)
    VALUES (${beacon.id}::uuid, ${expertRow.id}::uuid, 'tenant_admin', 'review',
            'Deep-link dead-link fixture', 'completed', now())
    RETURNING id`;
  completedTaskId = t.id;

  // ══ CASE 1 — switch round-trip, lands PINNED to the target ══
  console.log('\n== CASE 1: switch round-trip (Acme → Beacon deep link) ==');
  await login(page, EXPERT);
  ok(page.url().includes('/select-company'), `multi-membership → /select-company (${page.url()})`);
  await page.locator('form:has-text("Acme") button[type="submit"]').first().click();
  await page.waitForLoadState('networkidle'); await page.waitForTimeout(1200);
  let s = await sess(page);
  ok(s.membershipPinned === true && s.tenantSlug === 'acme-navy-systems' && s.role === 'partner_user',
    `pinned to Acme as partner_user (role=${s.role} tenant=${s.tenantSlug} pinned=${s.membershipPinned})`);

  // Deep link to the OTHER company.
  await page.goto(`${BASE}/go?tenant=beacon-labs`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  const switchGate = await page.locator('text=Switching companies').count();
  ok(switchGate > 0, 'deep link to other company → SWITCH gate (no silent switch)');
  s = await sess(page);
  ok(s.tenantSlug === 'acme-navy-systems', `still pinned to Acme while on the gate (${s.tenantSlug})`);

  // Take the switch: sign out → re-login into Beacon.
  await page.locator('button:has-text("Sign in to Beacon Labs")').click();
  await page.waitForLoadState('networkidle'); await page.waitForTimeout(1200);
  ok(page.url().includes('/login'), `switch signs out → /login (${page.url()})`);
  ok(await page.locator('text=/signed out/i').count() > 0, 'login shows the "signed out of X into Y" notice');
  // Re-login (no cookie clear — we are genuinely signed out).
  await page.fill('input[name="email"]', EXPERT);
  await page.fill('input[name="password"]', PW);
  await Promise.all([page.waitForLoadState('networkidle'), page.click('button[type="submit"]')]);
  await page.waitForTimeout(1500);
  s = await sess(page);
  ok(s.membershipPinned === true, `re-login lands PINNED (pinned=${s.membershipPinned})`);
  ok(s.tenantSlug === 'beacon-labs', `re-login PINNED to Beacon target (${s.tenantSlug})`);
  ok(s.role === 'tenant_admin', `active role is Beacon's tenant_admin (${s.role})`);
  ok(page.url().includes('/portal/beacon-labs'), `landed in Beacon portal (${page.url()})`);

  // ══ CASE 2 — unauthed multi-membership deep link keeps its target through login ══
  console.log('\n== CASE 2: unauthed deep link to ACME (non-home) survives login ==');
  await clean(page);
  await page.goto(`${BASE}/go?tenant=acme-navy-systems`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  ok(page.url().includes('/login'), `unauthed deep link → /login (${page.url()})`);
  // Do NOT clear cookies — sign in on this very page so the preserved `from` is honoured.
  await page.fill('input[name="email"]', EXPERT);
  await page.fill('input[name="password"]', PW);
  await Promise.all([page.waitForLoadState('networkidle'), page.click('button[type="submit"]')]);
  await page.waitForTimeout(1500);
  s = await sess(page);
  ok(s.tenantSlug === 'acme-navy-systems', `landed at the DEEP-LINK target Acme, not beacon home (${s.tenantSlug})`);
  ok(s.role === 'partner_user' && s.membershipPinned === true,
    `pinned as Acme partner_user (role=${s.role} pinned=${s.membershipPinned})`);
  ok(page.url().includes('/portal/acme-navy-systems'), `landed in Acme portal (${page.url()})`);

  // ══ CASE 3 — non-member deep link is denied (dispatcher, no access leak) ══
  console.log('\n== CASE 3: non-member deep link denied ==');
  await login(page, TEAMMATE);
  await page.goto(`${BASE}/go?tenant=beacon-labs`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  ok(!page.url().includes('/portal/beacon-labs'), `non-member NOT let into Beacon (${page.url()})`);
  s = await sess(page);
  ok(s.tenantSlug !== 'beacon-labs', `session never re-scoped to Beacon (${s.tenantSlug})`);

  // ══ CASE 4 — dead link (completed task) → "already complete" ack ══
  console.log('\n== CASE 4: completed-task deep link → already-complete ack ==');
  await login(page, EXPERT);
  // Pin Beacon first (multi-membership) so the here-ack path (not the picker) runs.
  await page.goto(`${BASE}/api/enter?slug=beacon-labs`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  await page.goto(`${BASE}/go?task=${completedTaskId}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  ok(await page.locator('text=/already complete/i').count() > 0, 'dead link shows "already complete" (no broken destination)');
  ok(await page.locator('text=/working in Beacon Labs/i').count() > 0, 'ack names the right company (Beacon Labs)');

  // ══ CASE 5 — /api/enter direct-hit while pinned-different → switch gate, no silent re-pin ══
  console.log('\n== CASE 5: /api/enter no-silent-switch guard ==');
  await login(page, EXPERT);
  await page.locator('form:has-text("Acme") button[type="submit"]').first().click();
  await page.waitForLoadState('networkidle'); await page.waitForTimeout(1000);
  await page.goto(`${BASE}/api/enter?slug=beacon-labs`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  ok(await page.locator('text=Switching companies').count() > 0, '/api/enter pinned-different → hands off to switch gate');
  s = await sess(page);
  ok(s.tenantSlug === 'acme-navy-systems' && s.membershipPinned === true,
    `session STILL pinned to Acme (no silent re-pin) (${s.tenantSlug})`);

  console.log('\nIdentity × deep-link drive-test complete.');
} catch (e) {
  console.error('DRIVE-TEST ERROR', e);
  exitCode = 1;
} finally {
  if (completedTaskId) { try { await sql`DELETE FROM tasks WHERE id=${completedTaskId}::uuid`; } catch { /* ignore */ } }
  await browser.close();
  await sql.end();
  process.exitCode = exitCode;
}
