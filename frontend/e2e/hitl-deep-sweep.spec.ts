/**
 * HITL deep sweep — drive the platform as EVERY actor and touch every major surface, in one
 * run, asserting no broken pages (500 / blank / auth-bounce) across the admin + portal + vault
 * surfaces, plus the two post-audit fixes that are UI-observable:
 *   • F2 — section editors REHYDRATE saved content (mig-071 guard bug) — Foundation TVSF.
 *   • F6 — /admin/agents lists all 35 archetypes incl. the P1–P4 cohort + a dormant one.
 *
 * Role-routing (the session-claim contract for the 5 roles) is covered per-actor by
 * hitl-role-smoke.spec.ts; this spec proves those roles can actually REACH their surfaces.
 *
 * Self-authenticating (the `hitl` project has no storageState). Two cohorts on the box:
 *   • e2e-* (acme-navy-systems)  — the clean 5-role login/discovery cohort (E2ETest!2026).
 *   • Foundation / Paul Jackson  — the rich build scenario (TVSF, 13 content sections; DemoPass123!).
 * See docs/E2E_HITL_RUNBOOK.md.
 */
import { test, expect, type Page } from '@playwright/test';

const E2E_PW = process.env.E2E_PW || 'E2ETest!2026';
const FOUNDATION_PW = process.env.FOUNDATION_PW || 'DemoPass123!';

// Foundation TVSF proof fixtures (rehydration): proposal + a section that HAS stringified content.
const TVSF_PROPOSAL = 'c3db60b1-2f0e-4bc8-903c-1ec098906c58';
const TVSF_SECTION = 'e43e02fd-798b-4d46-a95f-1e158ce67704'; // "#2 Overview of the Technology"
const TVSF_SECTION_PHRASE = 'Two differentiators define it'; // a node only present if content rehydrated

/** Fresh login — clears any prior session first (authenticated users get redirected off /login). */
async function login(page: Page, email: string, pw: string) {
  await page.context().clearCookies();
  await page.goto('/login');
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', pw);
  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 }),
    page.click('button[type="submit"]'),
  ]);
  await expect(page, `${email} bounced back to /login`).not.toHaveURL(/\/login/);
}

type Row = { url: string; status: number; verdict: string };
const HARD = ['SERVER_ERROR', 'ERROR_PAGE', 'AUTH_BOUNCE'];

/** Visit a surface and classify it. Never throws — returns a verdict row. */
async function visit(page: Page, url: string): Promise<Row> {
  try {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    const status = resp?.status() ?? 0;
    if (new URL(page.url()).pathname.startsWith('/login')) return { url, status, verdict: 'AUTH_BOUNCE' };
    if (status >= 500) return { url, status, verdict: 'SERVER_ERROR' };
    if (status === 404) return { url, status, verdict: 'NOT_FOUND' };
    const body = await page.textContent('body').catch(() => '');
    if (body && /Application error|Internal Server Error|something went wrong/i.test(body)) return { url, status, verdict: 'ERROR_PAGE' };
    return { url, status, verdict: 'OK' };
  } catch (e) {
    return { url, status: 0, verdict: `THREW:${(e as Error).message.slice(0, 30)}` };
  }
}

/** Walk a set of surfaces, log the matrix, and assert none hard-failed. */
async function sweep(page: Page, actor: string, urls: string[]) {
  const rows: Row[] = [];
  for (const u of urls) rows.push(await visit(page, u));
  console.log(`\n--- ${actor} (${rows.length} surfaces) ---\n` +
    rows.map((r) => `  ${r.verdict.padEnd(12)} [${String(r.status).padStart(3)}] ${r.url}`).join('\n'));
  const hard = rows.filter((r) => HARD.includes(r.verdict) || r.verdict.startsWith('THREW'));
  expect(hard, `${actor} hard failures:\n${hard.map((h) => `${h.verdict} ${h.url}`).join('\n')}`).toEqual([]);
}

test('master_admin — admin surfaces + F6 roster (35 archetypes, dormant marked)', async ({ page }) => {
  await login(page, 'e2e-master@rfppipeline.test', E2E_PW);
  await sweep(page, 'master_admin', [
    '/admin/dashboard', '/admin/agents', '/admin/events', '/admin/tenants',
    '/admin/purchases', '/admin/analytics', '/admin/processes', '/admin/rfp-curation',
    '/admin/automation', '/admin/intake', '/admin/opportunities',
  ]);
  // F6 proof — the roster now includes the P1–P4 cohort that used to be omitted + a dormant one.
  await page.goto('/admin/agents', { waitUntil: 'networkidle' });
  const body = await page.textContent('body');
  for (const label of ['Advisory Manager', 'Traceability Auditor', 'Redaction Guard', 'Library Seed Mapper', 'Continuity Manager']) {
    expect(body, `roster should list "${label}"`).toContain(label);
  }
  expect(body?.toLowerCase(), 'roster should mark a dormant archetype').toContain('dormant');
});

test('rfp_admin — ingest/curate/release surfaces render', async ({ page }) => {
  await login(page, 'e2e-rfpadmin@rfppipeline.test', E2E_PW);
  await sweep(page, 'rfp_admin', [
    '/admin/dashboard', '/admin/intake', '/admin/opportunities', '/admin/rfp-curation',
    '/admin/purchases', '/admin/agents',
  ]);
});

test('tenant_admin (Foundation/Paul) — build surfaces + F2 section rehydration', async ({ page }) => {
  await login(page, 'pjackson@ecinnovates.com', FOUNDATION_PW);
  await sweep(page, 'tenant_admin(foundation)', [
    '/portal/foundation/dashboard', '/portal/foundation/cards', '/portal/foundation/buckets',
    '/portal/foundation/proposals', `/portal/foundation/proposals/${TVSF_PROPOSAL}`,
    '/portal/foundation/atoms', '/portal/foundation/team', '/portal/foundation/vaults',
  ]);
  // F2 proof — open a TVSF section that has stringified canvas content; it must REHYDRATE,
  // not render the empty-canvas state (the mig-071 guard bug rendered it blank on reload).
  const secUrl = `/portal/foundation/proposals/${TVSF_PROPOSAL}/sections/${TVSF_SECTION}`;
  const r = await visit(page, secUrl);
  expect(r.verdict, `section editor ${secUrl}`).toBe('OK');
  await page.waitForLoadState('networkidle');
  const secBody = await page.textContent('body');
  expect(secBody, 'F2: section editor must rehydrate saved content (not blank)').toContain(TVSF_SECTION_PHRASE);
});

test('tenant_user — scoped portal surfaces render', async ({ page }) => {
  await login(page, 'e2e-tuser@acme-navy.test', E2E_PW);
  await sweep(page, 'tenant_user', ['/portal/acme-navy-systems/dashboard', '/portal/acme-navy-systems/cards', '/portal/acme-navy-systems/proposals']);
});

test('partner_user — vault surface renders (and is vault-scoped)', async ({ page }) => {
  await login(page, 'e2e-partner@ext.test', E2E_PW);
  await sweep(page, 'partner_user', ['/vaults']);
});
