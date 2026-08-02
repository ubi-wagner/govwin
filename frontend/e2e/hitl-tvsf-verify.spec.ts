/** Verify the rebuilt canonical TVSF: full-document preview (clean numbering, tables, letters). */
import { test, expect, type Page } from '@playwright/test';
const PW = process.env.FOUNDATION_PW || 'DemoPass123!';
const P = 'c3db60b1-2f0e-4bc8-903c-1ec098906c58';
const S = 'c3db6000-0000-4000-8000-000000000002'; // Q2 Overview (stable id)

async function login(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto('/login');
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PW);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 }), page.click('button[type="submit"]')]);
}

test('rebuilt TVSF — full-document preview', async ({ page }) => {
  await login(page, 'pjackson@ecinnovates.com');
  await page.goto(`/portal/foundation/proposals/${P}/sections/${S}`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Preview/ }).first().click();
  const dialog = page.getByRole('dialog', { name: /document preview/i });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Full document' }).click();
  const iframe = dialog.locator('iframe[title="document-preview"]');
  // correct order + clean numbering: "1. Market Opportunity" appears before "10. ESP Engagement"
  await expect.poll(async () => (await iframe.getAttribute('srcdoc')) ?? '', { timeout: 20000 }).toContain('1. Market Opportunity');
  const doc = (await iframe.getAttribute('srcdoc')) ?? '';
  const idx = (s: string) => doc.indexOf(s);
  expect(idx('1. Market Opportunity'), 'Q1 present').toBeGreaterThan(-1);
  expect(idx('2. Overview'), 'Q2 present').toBeGreaterThan(idx('1. Market Opportunity'));
  expect(idx('9. Management Team'), 'Q9 before Q10 (numeric order)').toBeGreaterThan(idx('2. Overview'));
  expect(idx('10. ESP Engagement'), 'Q10 after Q9 (no string-sort)').toBeGreaterThan(idx('9. Management Team'));
  expect(idx('14. Major Risks'), 'Q14 present').toBeGreaterThan(idx('10. ESP Engagement'));
  expect(doc, 'no double-number like "2. #1"').not.toContain('. #');
  await page.screenshot({ path: 'e2e/screenshots/23-tvsf-fulldoc.png' });
});
