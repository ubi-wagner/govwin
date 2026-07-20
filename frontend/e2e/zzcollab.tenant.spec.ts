/**
 * Screenshot capture — COLLABORATOR persona (partner_user). Runs under the `tenant` project
 * but OVERRIDES storageState to the collaborator session, so it captures the SCOPED views a
 * partner_user sees (their assignments, no library/buckets/billing) → docs/manuals/img/collab/.
 *   npx playwright test e2e/zzcollab.tenant.spec.ts --project=tenant --no-deps
 */
import { test } from '@playwright/test';
import path from 'path';

test.use({ storageState: 'e2e/.auth/collaborator.json' });

const OUT = path.join(__dirname, '..', '..', 'docs', 'manuals', 'img', 'collab');
const T = '/portal/lighthouse';

const ROUTES: Array<[string, string]> = [
  ['collab-landing', `${T}/proposals`],     // collaborator lands on their assigned proposals
  ['collab-dashboard', `${T}/dashboard`],    // scoped ToDos / assignments
  ['collab-activity', `${T}/activity`],      // what they can see of the audit trail
];

for (const [name, route] of ROUTES) {
  test(`capture ${name}`, async ({ page }) => {
    const res = await page.goto(route, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
    // eslint-disable-next-line no-console
    console.log(`  captured ${name} (HTTP ${res?.status()}, url=${page.url()})`);
  });
}
