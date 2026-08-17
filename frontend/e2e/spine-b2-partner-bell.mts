/**
 * SPINE-B2 — the partner_user notification bell (H1), proven SCOPED (no tenant-wide leak). With an active
 * collaboration, grace's /notifications feed returns ONLY events on her granted proposal; with NO active
 * collaboration it returns an EMPTY feed (never the tenant-wide firehose a tenant_user sees).
 *   node e2e/spine-b2-partner-bell.mts
 */
import { chromium } from 'playwright';
import postgres from 'postgres';

const BASE = 'http://localhost:3000';
const EXEC = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const FND = '17780cad-76c0-4cef-95ec-2a536bcf5c8f';
const PROP = 'bbd6a058-3299-4b98-96e0-1e07e43aa1c4';
const GRACE = 'a25786e6-fa8c-43e4-93f6-315b403fd1be';
const KATE = 'bd101904-582d-44db-ac2e-ce63eb341979';
const sql = postgres('postgresql://govtech:changeme@localhost:5432/govtech_intel', { onnotice: () => {} });

let pass = 0, fail = 0;
const check = (label: string, b: boolean) => { if (b) pass++; else fail++; console.log(`${b ? '✅' : '❌'} ${label}`); };
async function login(page: any, email: string) {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.fill('input[type="email"]', email); await page.fill('input[type="password"]', 'DemoPass123!');
  await Promise.all([page.waitForLoadState('networkidle'), page.click('button[type="submit"]')]).catch(() => {});
  await page.waitForTimeout(1200);
}
const feed = (page: any) => page.evaluate(async (base: string) => {
  const r = await fetch(`${base}/api/portal/foundation/notifications?limit=50`);
  const j = await r.json().catch(() => ({}));
  return { status: r.status, items: (j?.data?.notifications ?? []) as Array<{ payload?: { proposalId?: string } }> };
}, BASE);

let collabId: string | null = null;
const browser = await chromium.launch({ executablePath: EXEC, args: ['--no-sandbox'] });
try {
  // Seed at least one recent event on the proposal so a scoped feed is non-empty.
  await sql`INSERT INTO system_events (namespace, type, phase, actor_type, actor_id, tenant_id, payload, created_at)
    VALUES ('proposal', 'section.saved', 'single', 'user', ${KATE}, ${FND}::uuid,
            ${sql.json({ proposalId: PROP, title: 'B2 feed probe' })}, now())`;

  const ctx = await browser.newContext();
  const p = await ctx.newPage();

  // ── With NO active collaboration → empty feed (not the tenant firehose) ──
  await sql`DELETE FROM proposal_collaborators WHERE proposal_id=${PROP}::uuid AND user_id=${GRACE}::uuid`;
  await login(p, 'grace.partner@skyline-e2e.test');
  const before = await feed(p);
  check(`no collaboration → 200 + EMPTY feed (${before.status}, ${before.items.length} items)`, before.status === 200 && before.items.length === 0);

  // ── With an active collaboration → scoped to HER proposal only ──
  const [c] = await sql<Array<{ id: string }>>`
    INSERT INTO proposal_collaborators (proposal_id, user_id, email, name, role, invited_by, invited_at, accepted_at, assigned_sections)
    VALUES (${PROP}::uuid, ${GRACE}::uuid, 'grace.partner@skyline-e2e.test', 'Grace Partner', 'partner_user', ${KATE}::uuid, NOW(), NOW(), ARRAY[]::uuid[])
    RETURNING id`;
  collabId = c.id;
  await p.reload({ waitUntil: 'networkidle' }).catch(() => {});
  const after = await feed(p);
  check(`active collaboration → 200 + non-empty scoped feed (${after.status}, ${after.items.length} items)`, after.status === 200 && after.items.length >= 1);
  check('every feed item is scoped to HER proposal (no tenant-wide leak)',
    after.items.length > 0 && after.items.every((i) => i.payload?.proposalId === PROP));
  await ctx.close();

  console.log(`\n${fail === 0 ? '✅ ALL PASS' : `❌ ${fail} FAIL`} — SPINE-B2 partner bell scoped feed (${pass} checks)`);
} finally {
  if (collabId) await sql`DELETE FROM proposal_collaborators WHERE id=${collabId}::uuid`.catch(() => {});
  await sql`DELETE FROM system_events WHERE type='section.saved' AND payload->>'title'='B2 feed probe'`.catch(() => {});
  await sql.end();
  await browser.close();
}
process.exit(fail === 0 ? 0 : 1);
