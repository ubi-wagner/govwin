/**
 * TW-11 browser touch-test — the NEW Tenant Workflow Setup surfaces render + fire, as real actors.
 * App must be serving on :3000 (node .next/standalone/server.js). Fixture staged by
 * scripts/setup-tw11-browser-portal.mts; pass its portalId as PORTAL_ID.
 *   PORTAL_ID=<id> node e2e/tw11-workflow-setup-shots.mts
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = 'http://localhost:3000';
const OUT = '/tmp/claude-0/-home-user-govwin/34d597b2-183f-5787-9057-fc7251e3f9ff/scratchpad/shots-tw11';
const EXEC = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const PORTAL = process.env.PORTAL_ID ?? '';
mkdirSync(OUT, { recursive: true });

let pass = 0, fail = 0;
const check = (label: string, b: boolean) => { if (b) pass++; else fail++; console.log(`${b ? '✅' : '❌'} ${label}`); };

async function login(page: any, email: string, password: string) {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.fill('input[type="email"], input[name="email"]', email);
  await page.fill('input[type="password"], input[name="password"]', password);
  await Promise.all([page.waitForLoadState('networkidle'), page.click('button[type="submit"]')]).catch(() => {});
  await page.waitForTimeout(1500);
}

const browser = await chromium.launch({ executablePath: EXEC, args: ['--no-sandbox'] });
try {
  // ── Tenant admin (Kate): the Workflow Setup page with a LIVE AI-gate + live to-dos ──
  const ctxT = await browser.newContext({ viewport: { width: 1280, height: 1700 } });
  const t = await ctxT.newPage();
  await login(t, 'kate.ulepic@foundation3dp.com', 'DemoPass123!');
  await t.goto(`${BASE}/portal/foundation/portals/${PORTAL}`, { waitUntil: 'networkidle' });
  await t.waitForTimeout(1800);
  await t.screenshot({ path: `${OUT}/01-setup-tenant-admin.png`, fullPage: true });
  const body1 = (await t.textContent('body')) ?? '';
  check('setup page renders (Workflow setup)', body1.includes('Workflow setup'));
  check('AI-gate panel shows the landed review (AI review complete)', body1.includes('AI review complete'));
  check('assisted Advance button present (Advance stage)', body1.includes('Advance stage'));
  check('Live to-dos management section present', body1.includes('Live to-dos'));
  check('the live AI-gate stage is badged LIVE', body1.includes('LIVE'));
  check('per-stage auto-advance toggle copy present', /Auto-advance when the review lands/i.test(body1));
  check('no error boundary', !/Application error|Unhandled Runtime|something went wrong/i.test(body1));

  // Click "Advance stage →" and confirm the gate closes (stage moves off color_team).
  const advBtn = t.locator('button', { hasText: 'Advance stage' }).first();
  if (await advBtn.count()) {
    await advBtn.click().catch(() => {});
    await t.waitForTimeout(2500);
    await t.screenshot({ path: `${OUT}/02-after-advance.png`, fullPage: true });
    const body2 = (await t.textContent('body')) ?? '';
    // Advance succeeded when the success toast fired AND the gate button is gone (the AI stage is behind us).
    check('after Advance: the "Stage advanced" toast fired', body2.includes('Stage advanced'));
    check('after Advance: the gate Advance button is gone', (await t.locator('button', { hasText: 'Advance stage' }).count()) === 0);
    // The LIVE badge moved to the next (human) Final stage, and its ToDo ("Confirm final package") was
    // created on advance — proving createStageTodos ran under the tenant RLS context (the runInTenant fix).
    check('after Advance: a stage still carries the LIVE badge (moved to Final)', body2.includes('LIVE'));
    check('after Advance: the next stage’s ToDo was created (Confirm final package)', body2.includes('Confirm final package'));
  } else {
    check('Advance button clickable', false);
  }
  await ctxT.close();

  // ── rfp_admin (Eric): the admin in-flight build-workflows index (TW-10) ──
  const ctxA = await browser.newContext({ viewport: { width: 1400, height: 1700 } });
  const a = await ctxA.newPage();
  await login(a, 'eric@rfppipeline.com', 'RFPAdmin2026!');
  await a.goto(`${BASE}/admin/workflows`, { waitUntil: 'networkidle' });
  await a.waitForTimeout(1800);
  await a.screenshot({ path: `${OUT}/03-admin-build-index.png`, fullPage: true });
  const body3 = (await a.textContent('body')) ?? '';
  check('admin sees the build-workflows index (Proposal build workflows)', body3.includes('Proposal build workflows'));
  check('the index deep-links to management (Manage)', body3.includes('Manage'));
  check('admin index shows a gate column value (Human or AI:)', /Human|AI:/.test(body3));
  check('admin page has no error boundary', !/Application error|Unhandled Runtime|something went wrong/i.test(body3));
  await ctxA.close();

  console.log(`\n${fail === 0 ? '✅ ALL PASS' : `❌ ${fail} FAIL`} — TW-11 browser touch-test (${pass} checks) · shots in ${OUT}`);
} finally {
  await browser.close();
}
process.exit(fail === 0 ? 0 : 1);
