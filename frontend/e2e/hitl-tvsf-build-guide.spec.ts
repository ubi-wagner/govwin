/**
 * TVSF Proposal Pipeline Build Guide — the screenshot manual for Paul Jackson
 * (Foundation's external shadow-admin). Drives the whole build the way Paul would:
 * dashboard → scored buckets → the TVSF Opp Card → the proposal workspace →
 * the canvas section editor (tables + figures) → the "see it as it downloads"
 * preview → library atoms → the Foundation team → export (docx / pdf / zip).
 *
 * Writes committed PNGs into docs/tvsf-build-guide/ (referenced by
 * docs/TVSF_PROPOSAL_BUILD_GUIDE.md). Every shot is asserted to have rendered
 * (no 500 / auth-bounce / error page) so the guide can't silently break.
 *
 * Requires the freshly-built standalone server on :3000 and the rebuilt TVSF
 * proposal (scripts/rebuild-tvsf.mjs — stable section ids). Password DemoPass123!.
 */
import { test, expect, type Page } from '@playwright/test';
import * as fs from 'fs';

const PW = process.env.FOUNDATION_PW || 'DemoPass123!';
const DIR = '../docs/tvsf-build-guide';
const P = 'c3db60b1-2f0e-4bc8-903c-1ec098906c58';
// Stable, deterministic section ids (scripts/rebuild-tvsf.mjs: sid(sort)).
const Q = (n: number) => `c3db6000-0000-4000-8000-${String(n).padStart(12, '0')}`;

test.use({ viewport: { width: 1440, height: 900 } });
test.beforeAll(() => { fs.mkdirSync(DIR, { recursive: true }); });

async function login(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto('/login');
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PW);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 }),
    page.click('button[type="submit"]'),
  ]);
  await expect(page, `${email} bounced to /login`).not.toHaveURL(/\/login/);
}

/** Navigate, assert rendered (not login/500/error), screenshot full-page. */
async function shot(page: Page, name: string, url: string) {
  const resp = await page.goto(url, { waitUntil: 'networkidle', timeout: 45_000 });
  const status = resp?.status() ?? 0;
  expect(new URL(page.url()).pathname, `${name} bounced to /login`).not.toMatch(/^\/login/);
  expect(status, `${name} bad status`).toBeLessThan(500);
  const body = await page.textContent('body').catch(() => '');
  expect(/Application error|Internal Server Error/i.test(body ?? ''), `${name} error page`).toBeFalsy();
  await page.screenshot({ path: `${DIR}/${name}.png`, fullPage: true });
}

test('Paul — the TVSF build guide, start to finish', async ({ page }) => {
  await login(page, 'pjackson@ecinnovates.com');

  // ── Discovery: dashboard → scored buckets → the Opp Card ──
  await shot(page, '01-dashboard', '/portal/foundation/dashboard');
  await shot(page, '02-buckets', '/portal/foundation/buckets');
  await shot(page, '03-opportunity-cards', '/portal/foundation/cards');

  // ── The proposal: list → workspace (sections, gates, compliance matrix, export) ──
  await shot(page, '04-proposals-list', '/portal/foundation/proposals');
  await shot(page, '05-proposal-workspace', `/portal/foundation/proposals/${P}`);

  // ── The canvas section editor — tables + the two figures ──
  await shot(page, '06-editor-q2-competitor-table', `/portal/foundation/proposals/${P}/sections/${Q(2)}`);
  await shot(page, '07-editor-q3-milestone-figure', `/portal/foundation/proposals/${P}/sections/${Q(3)}`);
  await shot(page, '08-editor-q6-proforma-and-chart', `/portal/foundation/proposals/${P}/sections/${Q(6)}`);

  // ── "See it as it downloads" — section preview, then full document ──
  await page.goto(`/portal/foundation/proposals/${P}/sections/${Q(2)}`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Preview/ }).first().click();
  const dialog = page.getByRole('dialog', { name: /document preview/i });
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${DIR}/09-preview-section.png`, fullPage: true });
  await dialog.getByRole('button', { name: 'Full document' }).click();
  const iframe = dialog.locator('iframe[title="document-preview"]');
  await expect.poll(async () => (await iframe.getAttribute('srcdoc')) ?? '', { timeout: 20_000 })
    .toContain('1. Market Opportunity');
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${DIR}/10-preview-full-document.png`, fullPage: true });

  // ── Library atoms + the Foundation team ──
  await shot(page, '11-library-atoms', '/portal/foundation/atoms');
  await shot(page, '12-foundation-team', '/portal/foundation/team');
});
