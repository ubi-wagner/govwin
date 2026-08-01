/**
 * Guidebook screenshots — the UPLOAD / build-your-library step that precedes drafting.
 * Shows a customer (Kate, Foundation admin) landing in the Library and deconstructing a
 * source document into selectable atoms via the Atomize workbench (paste path — storage-free).
 * Screenshots → docs/proposals/foundation-tvsf/ui-walkthrough/.
 */
import { test, expect } from '@playwright/test';

test.describe.configure({ mode: 'serial' });
const SHOTS = '/home/user/govwin/docs/proposals/foundation-tvsf/ui-walkthrough';
const PW = process.env.FOUNDATION_PW || 'DemoPass123!';

async function login(page: any, email: string, pw: string) {
  await page.context().clearCookies();
  await page.goto('/login');
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', pw);
  await Promise.all([
    page.waitForURL((u: URL) => !u.pathname.startsWith('/login'), { timeout: 30_000 }),
    page.click('button[type="submit"]'),
  ]);
}
const shot = async (page: any, name: string) => {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
  console.log(`  📸 ${name}`);
};

const SOURCE = `Foundation 3D-prints the formwork for residential concrete foundations. A build plan is downloaded to the printer, concrete is pumped into the machine, and the nozzle lays concrete one layer at a time; the trolley moves laterally and vertically on runway rails. It uses common, locally sourced concrete instead of proprietary mortar, and an external gate controls flow at the nozzle. This eliminates the build-strip-repair-clean cycle, saving ~311 labor hours per home and cutting formwork cost ~47-50%. Two issued U.S. patents (11,273,574 and 10,307,959 B2) protect the scalable printer and the concrete-delivery system.`;

test('guide 1 — the Library (your reusable content)', async ({ page }) => {
  test.setTimeout(60_000);
  await login(page, 'kate.ulepic@foundation3dp.com', PW);
  await page.goto('/portal/foundation/library');
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.getByRole('button', { name: /^All$/ }).first().click().catch(() => {}); // show all grains (10 seeded atoms)
  await shot(page, '00a_library');
});

test('guide 2 — Atomize: deconstruct a source document', async ({ page }) => {
  test.setTimeout(60_000);
  await login(page, 'kate.ulepic@foundation3dp.com', PW);
  await page.goto('/portal/foundation/library');
  await page.getByRole('button', { name: /^Atomize$/ }).first().click().catch(() => {});
  await page.getByText(/Upload a document, or paste content/i).first().waitFor({ timeout: 10_000 }).catch(() => {});
  await shot(page, '00b_atomize_empty');
  await page.getByPlaceholder(/Paste a bio/i).fill(SOURCE);
  await page.getByRole('button', { name: /^Deconstruct$/ }).click();
  await page.getByText(/objects — select what to atomize/i).waitFor({ timeout: 15_000 }).catch(() => {});
  await shot(page, '00c_atomize_deconstructed');
  expect(await page.content()).toMatch(/select what to atomize|objects/i);
});

test('guide 3 — Upload package (bulk file → library)', async ({ page }) => {
  test.setTimeout(60_000);
  await login(page, 'kate.ulepic@foundation3dp.com', PW);
  await page.goto('/portal/foundation/library');
  await page.getByRole('button', { name: /Upload package/i }).first().click().catch(() => {});
  await shot(page, '00d_upload_package');
});
