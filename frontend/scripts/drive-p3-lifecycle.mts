/**
 * Drive-test #113: collaborator membership LIFECYCLE.
 *   invite → active · remove(last) → revoked · re-invite → reactivated ·
 *   remove-when-still-collaborating-elsewhere → stays active (guard).
 * Self-contained: playwright for the API + postgres.js for asserts.
 */
import { chromium } from 'playwright';
import postgres from 'postgres';

const BASE = 'http://localhost:3000', PW = 'DemoPass123!';
const PROP_A = '3b0e7f8b-7ca2-4570-91d9-48326add00ff';
const EMAIL = 'p3lifecycle@beacon-labs.test';
const sql = postgres(process.env.DATABASE_URL!, { max: 2 });
let exitCode = 0;
const ok = (c: boolean, l: string) => { console.log(`${c ? '✅' : '❌ FAIL'}  ${l}`); if (!c) exitCode = 1; };

async function memStatus(): Promise<string | null> {
  const rows = await sql`SELECT m.status FROM user_memberships m JOIN users u ON u.id=m.user_id
    JOIN tenants t ON t.id=m.tenant_id WHERE u.email=${EMAIL} AND t.slug='acme-navy-systems' AND m.source='collaborator'`;
  return rows[0]?.status ?? null;
}
async function collabId(proposalId: string): Promise<string | null> {
  const rows = await sql`SELECT id FROM proposal_collaborators WHERE proposal_id=${proposalId}::uuid AND email=${EMAIL}`;
  return rows[0]?.id ?? null;
}
// Row state: 'absent' | 'active' | 'revoked' — proves the row is NEVER deleted.
async function collabState(proposalId: string): Promise<string> {
  const rows = await sql<{ revoked: boolean }[]>`SELECT (revoked_at IS NOT NULL) AS revoked
    FROM proposal_collaborators WHERE proposal_id=${proposalId}::uuid AND email=${EMAIL}`;
  if (rows.length === 0) return 'absent';
  return rows[0].revoked ? 'revoked' : 'active';
}
async function listShowsRevoked(): Promise<boolean> {
  const r = await page.request.get(`${BASE}/api/portal/acme-navy-systems/proposals/${PROP_A}/collaborators`);
  const j = await r.json();
  const row = (j?.data ?? []).find((c: { email: string }) => c.email === EMAIL);
  return !!row && row.active === false; // still listed, badged inactive
}

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await (await browser.newContext()).newPage();
async function invite(proposalId: string) {
  const r = await page.request.post(`${BASE}/api/portal/acme-navy-systems/proposals/${proposalId}/collaborators`,
    { data: { email: EMAIL, name: 'P3 Lifecycle', role: 'external', permission: 'view', assignedSections: [] } });
  return r.status();
}
async function remove(proposalId: string, cid: string) {
  const r = await page.request.delete(`${BASE}/api/portal/acme-navy-systems/proposals/${proposalId}/collaborators/${cid}`);
  return r.status();
}

try {
  // Prep: clean + seed cross-company user (home=beacon), + a 2nd acme proposal for the guard.
  await sql`DELETE FROM collaborator_stage_access WHERE collaborator_id IN (SELECT id FROM proposal_collaborators WHERE email=${EMAIL})`;
  await sql`DELETE FROM proposal_collaborators WHERE email=${EMAIL}`;
  await sql`DELETE FROM user_memberships WHERE user_id IN (SELECT id FROM users WHERE email=${EMAIL})`;
  await sql`DELETE FROM users WHERE email=${EMAIL}`;
  await sql`INSERT INTO users (email, name, role, tenant_id, password_hash, temp_password, is_active)
    SELECT ${EMAIL}, 'P3 Lifecycle', 'tenant_admin', (SELECT id FROM tenants WHERE slug='beacon-labs'),
    (SELECT password_hash FROM users WHERE email='admin@acme-navy.test'), false, true`;
  const [propB] = await sql<{ id: string }[]>`INSERT INTO proposals (tenant_id, opportunity_id, title)
    SELECT p.tenant_id, p.opportunity_id, 'P3 Guard Proposal B' FROM proposals p WHERE p.id=${PROP_A}::uuid RETURNING id`;

  await page.context().clearCookies();
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.fill('input[name="email"]', 'admin@acme-navy.test'); await page.fill('input[name="password"]', PW);
  await Promise.all([page.waitForLoadState('networkidle'), page.click('button[type="submit"]')]); await page.waitForTimeout(1000);

  ok(await invite(PROP_A) < 300, 'invite → 2xx');
  ok(await memStatus() === 'active', `membership active after invite (${await memStatus()})`);
  ok(await collabState(PROP_A) === 'active', `collaborator row active (${await collabState(PROP_A)})`);

  ok(await remove(PROP_A, (await collabId(PROP_A))!) < 300, 'remove (last collaboration) → 2xx');
  ok(await collabState(PROP_A) === 'revoked', `collaborator row PERSISTS as revoked — never deleted (${await collabState(PROP_A)})`);
  ok(await memStatus() === 'revoked', `membership REVOKED after last removal (${await memStatus()})`);
  ok(await listShowsRevoked(), 'removed collaborator STILL shows in the list (history), badged inactive');

  ok(await invite(PROP_A) < 300, 're-invite → 2xx');
  ok(await collabState(PROP_A) === 'active', `same row REACTIVATED (${await collabState(PROP_A)})`);
  ok(await memStatus() === 'active', `membership REACTIVATED on re-invite (${await memStatus()})`);

  // Guard: also collaborating on proposal B → removing from A must NOT revoke.
  ok(await invite(propB.id) < 300, 'invite to 2nd proposal → 2xx');
  ok(await remove(PROP_A, (await collabId(PROP_A))!) < 300, 'remove from proposal A → 2xx');
  ok(await memStatus() === 'active', `membership STAYS active (still on proposal B) (${await memStatus()})`);

  // Cleanup
  await sql`DELETE FROM collaborator_stage_access WHERE collaborator_id IN (SELECT id FROM proposal_collaborators WHERE email=${EMAIL})`;
  await sql`DELETE FROM proposal_collaborators WHERE email=${EMAIL}`;
  await sql`DELETE FROM user_memberships WHERE user_id IN (SELECT id FROM users WHERE email=${EMAIL})`;
  await sql`DELETE FROM users WHERE email=${EMAIL}`;
  await sql`DELETE FROM proposals WHERE id=${propB.id}::uuid`;
} catch (e) { console.error('ERR', e); exitCode = 1; }
finally { await browser.close(); await sql.end(); process.exitCode = exitCode; }
