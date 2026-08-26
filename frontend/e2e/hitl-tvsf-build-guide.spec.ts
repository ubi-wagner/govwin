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
import { resolveRichestProposal, spreadSections } from './resolve-proposal';
import { test, expect, type Page } from '@playwright/test';
import * as fs from 'fs';

const PW = process.env.FOUNDATION_PW || 'DemoPass123!';
const DIR = '../docs/tvsf-build-guide';
/* Resolved in beforeAll — see e2e/resolve-proposal.ts. The section-id GENERATOR that used to sit
 * here (`c3db6000-…{n}`) produced ids nothing in the repo ever creates, so every editor screenshot
 * navigated to a section that is not there and the guide died on a 60s click timeout. */
let P = '';
let SECTIONS: string[] = [];

test.use({ viewport: { width: 1440, height: 900 } });
test.beforeAll(() => { fs.mkdirSync(DIR, { recursive: true }); });

async function login(page: Page, email: string, pinSlug?: string) {
  await page.context().clearCookies();
  await page.goto('/login');
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PW);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 }),
    page.click('button[type="submit"]'),
  ]);
  await expect(page, `${email} bounced to /login`).not.toHaveURL(/\/login/);
  /* PIN THE TENANT ONTO THE SESSION.
   *
   * Paul is multi-membership with no home tenant, so every /portal/foundation/* URL bounces to
   * /select-company until one is pinned. Without this the whole guide photographed the company
   * chooser instead of the product, and the Preview click at the end waited 60s for a button that
   * was never on screen. The sibling verify spec already did this; this one silently did not. */
  if (pinSlug) {
    await page.goto(`/api/enter?slug=${pinSlug}&next=/portal/${pinSlug}/dashboard`);
    await page.waitForLoadState('domcontentloaded').catch(() => {});
  }
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

test.beforeAll(async () => {
  const r = await resolveRichestProposal('foundation');
  P = r.id;
  SECTIONS = spreadSections(r.sectionIds, 3);
});

test('Paul — the TVSF build guide, start to finish', async ({ page }) => {
  await login(page, 'pjackson@ecinnovates.com', 'foundation');

  // ── Discovery: dashboard → scored buckets → the Opp Card ──
  await shot(page, '01-dashboard', '/portal/foundation/dashboard');
  await shot(page, '02-buckets', '/portal/foundation/buckets');
  await shot(page, '03-opportunity-cards', '/portal/foundation/cards');

  // ── The proposal: list → workspace (sections, gates, compliance matrix, export) ──
  await shot(page, '04-proposals-list', '/portal/foundation/proposals');
  await shot(page, '05-proposal-workspace', `/portal/foundation/proposals/${P}`);

  // ── The canvas section editor — tables + the two figures ──
  // Three sections spread across the document, resolved from what this proposal actually has.
  const [S_A, S_B, S_C] = SECTIONS;
  await shot(page, '06-editor-section-early', `/portal/foundation/proposals/${P}/sections/${S_A}`);
  await shot(page, '07-editor-section-middle', `/portal/foundation/proposals/${P}/sections/${S_B}`);
  await shot(page, '08-editor-section-late', `/portal/foundation/proposals/${P}/sections/${S_C}`);

  // ── "See it as it downloads" — section preview, then full document ──
  await page.goto(`/portal/foundation/proposals/${P}/sections/${SECTIONS[0]}`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Preview/ }).first().click();
  const dialog = page.getByRole('dialog', { name: /document preview/i });
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${DIR}/09-preview-section.png`, fullPage: true });
  await dialog.getByRole('button', { name: 'Full document' }).click();
  const iframe = dialog.locator('iframe[title="document-preview"]');
  // Wait for the assembly to actually render, without naming a section title — those change, and
  // an assertion on one of them is what made the sibling verify spec unrunnable.
  await expect.poll(
    async () => /<h[1-3][^>]*>\s*\d{1,3}\.\s/i.test((await iframe.getAttribute('srcdoc')) ?? ''),
    { timeout: 20_000, message: 'the assembled document never rendered a numbered heading' },
  ).toBe(true);
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${DIR}/10-preview-full-document.png`, fullPage: true });

  // ── Library atoms + the Foundation team ──
  await shot(page, '11-library-atoms', '/portal/foundation/atoms');
  await shot(page, '12-foundation-team', '/portal/foundation/team');
});
