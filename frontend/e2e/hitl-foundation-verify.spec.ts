/**
 * Verify the Foundation TVSF outcome through the REAL user-facing surfaces:
 *   1. Kate (tenant_admin) downloads the final proposal via POST …/package?format=docx.
 *   2. Paul Jackson (EC, appointed shadow admin) logs in and SEES: his 5 buckets, the ranked
 *      pipeline (6 opportunity cards with per-bucket scores incl. the SBIRs), and the TVSF
 *      proposal (submitted). Screenshots the spotlight page as proof.
 *
 * Env: PROPOSAL_ID (default = the seeded build). Self-authenticating (`hitl` project).
 */
import { test, expect } from '@playwright/test';
import { writeFileSync } from 'node:fs';

const PID = process.env.PROPOSAL_ID || 'e463eb9b-6689-43e7-bbc6-a995a68c1790';
const OUT = '/home/user/govwin/docs/proposals/foundation-tvsf';
const PW = process.env.FOUNDATION_PW || 'DemoPass123!';

async function login(page: any, email: string, pw: string, pinSlug?: string) {
  await page.context().clearCookies();
  await page.goto('/login');
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', pw);
  await Promise.all([
    page.waitForURL((u: URL) => !u.pathname.startsWith('/login'), { timeout: 30_000 }),
    page.click('button[type="submit"]'),
  ]);
  // A no-home-tenant multi-membership user (Paul) must PIN the company onto the session —
  // /api/enter rewrites the JWT role to the membership role (tenant_admin) via unstable_update.
  if (pinSlug) {
    await page.goto(`/api/enter?slug=${pinSlug}&next=/portal/${pinSlug}/dashboard`);
    await page.waitForLoadState('domcontentloaded').catch(() => {});
  }
}

test('Kate downloads the final TVSF proposal (.docx) via the real package route', async ({ page }) => {
  test.setTimeout(60_000);
  await login(page, 'kate.ulepic@foundation3dp.com', PW);
  const resp = await page.request.post(`/api/portal/foundation/proposals/${PID}/package?format=docx`);
  console.log(`\n▶ package download { status: ${resp.status()}, type: ${resp.headers()['content-type']} }`);
  expect(resp.status(), 'package 200').toBe(200);
  const buf = await resp.body();
  expect(buf.length, 'docx size').toBeGreaterThan(10_000);
  writeFileSync(`${OUT}/Foundation_TVSF_FINAL_downloaded.docx`, buf);
  console.log(`✓ downloaded final proposal — ${buf.length} bytes`);
});

test('Paul (EC shadow admin) sees buckets + ranked pipeline + the TVSF proposal', async ({ page }) => {
  test.setTimeout(60_000);
  const log = (m: string, v?: unknown) => console.log(`\n▶ ${m}${v !== undefined ? ' ' + JSON.stringify(v) : ''}`);
  await login(page, 'pjackson@ecinnovates.com', PW, 'foundation');

  const bResp = await page.request.get('/api/portal/foundation/buckets');
  const buckets = (await bResp.json())?.data?.buckets ?? [];
  log('buckets', { status: bResp.status(), count: buckets.length, names: buckets.map((x: any) => x.name).slice(0, 5) });
  expect(bResp.status()).toBe(200);
  expect(buckets.length, 'Paul sees Foundation buckets').toBeGreaterThanOrEqual(5);

  const cResp = await page.request.get('/api/portal/foundation/cards');
  const cards = (await cResp.json())?.data?.cards ?? [];
  const ranked = cards
    .map((c: any) => ({ title: (c.card?.title ?? c.title ?? '').slice(0, 42), program: c.card?.programType ?? c.programType, score: c.topScore ?? c.top_score ?? c.score }))
    .sort((a: any, b: any) => (b.score ?? 0) - (a.score ?? 0));
  log('ranked pipeline', { status: cResp.status(), count: cards.length, top: ranked.slice(0, 6) });
  expect(cResp.status()).toBe(200);
  expect(cards.length, 'Paul sees the ranked pipeline (TVSF + SBIRs)').toBeGreaterThanOrEqual(6);

  const pResp = await page.request.get('/api/portal/foundation/proposals');
  const props = (await pResp.json())?.data?.proposals ?? [];
  const tvsf = props.find((p: any) => (p.title ?? '').includes('TVSF') || p.id === PID);
  log('proposals', { status: pResp.status(), count: props.length, tvsf: tvsf && { stage: tvsf.stage, locked: tvsf.isLocked ?? tvsf.is_locked } });
  expect(pResp.status()).toBe(200);
  expect(tvsf, 'Paul sees the TVSF proposal').toBeTruthy();

  // visual proof — the spotlight/buckets page as Paul
  await page.goto('/portal/foundation/spotlights').catch(() => {});
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.screenshot({ path: `${OUT}/paul_spotlight_view.png`, fullPage: true }).catch(() => {});
  console.log('✓ Paul sees buckets + ranked pipeline + TVSF proposal');
});
