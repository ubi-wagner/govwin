/**
 * Convergence regression (design A): the legacy customer opportunity surfaces
 * land on the canonical Greenfield Opportunities (/cards). Next serves the
 * server redirect() as an RSC payload (HTTP 200), so this asserts via browser
 * navigation — each in its own isolated page, so there's no redirect-to-current
 * URL quirk.
 */
import { test, expect } from '@playwright/test';

const SLUG = process.env.FIX_TENANT_SLUG || 'lighthouse';

for (const legacy of ['spotlights', 'pipeline']) {
  test(`legacy /${legacy} lands on /cards`, async ({ page }) => {
    await page.goto(`/portal/${SLUG}/${legacy}`);
    await expect(page).toHaveURL(new RegExp(`/portal/${SLUG}/cards`));
  });
}
