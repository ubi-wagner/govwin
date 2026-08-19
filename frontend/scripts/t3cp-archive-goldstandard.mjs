/**
 * Archive the user's own hand-written MIRAGE volume out of the Immobileyes library.
 *
 * It was ingested earlier in this session as a reference/gold standard. Leaving it in the library
 * makes the build circular: the drafter retrieves the answer to this very solicitation and hands it
 * back, which proves nothing about whether the product can compose a proposal. The honest test is
 * MIRAGE built from the company's genuine PRIOR work — the AFX23D-TCSO1, N26BX, N254P and FX235CSO
 * proposals and the HALAR/DEXTER capability material that are also in the library.
 *
 * Archive is the product's own soft, reversible action: the atom drops out of the library and out
 * of draft selection, and nothing is destroyed.
 */
import { chromium } from '@playwright/test';
const TENANT = 'immobileyes';
const IDS = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ baseURL: 'http://localhost:3000' });
await page.goto('/login');
await page.fill('input[type="email"]', 'admin@immobileyes.test');
await page.fill('input[type="password"]', 'DemoPass123!');
await Promise.all([page.waitForURL((u) => !u.pathname.includes('/login')), page.click('button[type="submit"]')]);
for (const id of IDS) {
  const r = await page.request.patch(`/api/portal/${TENANT}/atoms/${id}`, { data: { status: 'archived' } });
  console.log('archive', id, r.status(), JSON.stringify(await r.json()).slice(0, 160));
}
await browser.close();
