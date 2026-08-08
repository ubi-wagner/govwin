/**
 * Preview feature — the "see it as it will download" toolbox option.
 * Drives it as Paul (Foundation tenant_admin) on the TVSF proposal:
 *   • opens Preview from the toolbox
 *   • section mode renders the LIVE section content (client-side)
 *   • full-document mode fetches + renders the whole assembled proposal (gated endpoint)
 * Asserts against the iframe's srcdoc so the sandboxed (script-less) iframe stays locked down.
 */
import { test, expect, type Page } from '@playwright/test';

const FOUNDATION_PW = process.env.FOUNDATION_PW || 'DemoPass123!';
const PROPOSAL = 'c3db60b1-2f0e-4bc8-903c-1ec098906c58';
const SECTION = 'e43e02fd-798b-4d46-a95f-1e158ce67704'; // "#2 Overview of the Technology"

async function login(page: Page, email: string, pw: string, pinSlug?: string) {
  await page.context().clearCookies();
  await page.goto('/login');
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', pw);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 }),
    page.click('button[type="submit"]'),
  ]);
  // Multi-membership user with no home tenant (Paul, partner-manager of Foundation) must PIN the
  // company onto the session (/api/enter rewrites the JWT to the membership role); without it a
  // tenant URL bounces to /select-company. Matches hitl-foundation-verify's pinSlug pattern.
  if (pinSlug) {
    await page.goto(`/api/enter?slug=${pinSlug}&next=/portal/${pinSlug}/dashboard`);
    await page.waitForLoadState('domcontentloaded').catch(() => {});
  }
}

test('preview: section (live) + full document', async ({ page }) => {
  await login(page, 'pjackson@ecinnovates.com', FOUNDATION_PW, 'foundation');
  await page.goto(`/portal/foundation/proposals/${PROPOSAL}/sections/${SECTION}`, { waitUntil: 'networkidle' });

  // Open Preview from the toolbox card.
  await page.getByRole('button', { name: /Preview/ }).first().click();
  const dialog = page.getByRole('dialog', { name: /document preview/i });
  await expect(dialog).toBeVisible();

  const iframe = dialog.locator('iframe[title="document-preview"]');

  // Section mode: the live section content is rendered (client-side).
  await expect.poll(async () => (await iframe.getAttribute('srcdoc')) ?? '', { timeout: 10_000 })
    .toContain('Two differentiators define it');
  await page.screenshot({ path: 'e2e/screenshots/21-preview-section.png' });

  // Full document: assembles ALL sections — assert it contains a DIFFERENT section's title.
  await dialog.getByRole('button', { name: 'Full document' }).click();
  await expect.poll(async () => (await iframe.getAttribute('srcdoc')) ?? '', { timeout: 20_000 })
    .toContain('Market Opportunity'); // section #1 — proves full-proposal assembly, not just the open section
  await page.screenshot({ path: 'e2e/screenshots/22-preview-foundation.png' });
});
