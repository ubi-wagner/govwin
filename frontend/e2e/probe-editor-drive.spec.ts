/**
 * A throwaway PROBE, not a test: open the section editor and report what it actually offers.
 *
 * Four times now I have asserted where an affordance "should" be and been wrong — the docx entity
 * comparison, two response-envelope guesses, and then the editor's insert control. The cheap fix
 * is to stop guessing: open the page, list the controls, click one, and print what changed.
 *
 *   npx playwright test --project=drive probe-editor
 */
import { test } from '@playwright/test';

const SLUG = process.env.PROBE_SLUG || 'northwind-additive';
const EMAIL = process.env.PROBE_EMAIL || 'dana.reyes@northwind-additive.com';
const PW = process.env.MT_TENANT_PW || 'MidtermDrive2026!';

test('what does the section editor actually offer', async ({ page }) => {
  test.setTimeout(5 * 60_000);
  await page.context().clearCookies();
  await page.goto('about:blank');
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.locator('input[name="password"]').waitFor({ state: 'visible', timeout: 15_000 });
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PW);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 }),
    page.click('button[type="submit"]'),
  ]);

  // Find the DRAFT build and an unlocked section in it.
  const pj = await (await page.request.get(`/api/portal/${SLUG}/proposals`)).json();
  const props = (pj?.data?.proposals ?? []) as Array<{ id: string; title?: string; stage?: string }>;
  const draft = props.find((p) => p.stage !== 'submitted') ?? props[0];
  console.error(`proposals: ${props.map((p) => `${p.stage}`).join(', ')} → using ${draft?.stage}`);
  const sj = await (await page.request.get(`/api/portal/${SLUG}/proposals/${draft.id}/sections`)).json();
  const secs = (sj?.data?.sections ?? []) as Array<{ id: string; title?: string; isLocked?: boolean }>;
  const sec = secs.find((s) => !s.isLocked) ?? secs[0];
  console.error(`section: "${sec?.title}" locked=${sec?.isLocked}`);

  await page.goto(`/portal/${SLUG}/proposals/${draft.id}/sections/${sec.id}`, { waitUntil: 'networkidle', timeout: 90_000 });
  await page.waitForTimeout(1500);

  const names = async () => (await page.getByRole('button').allInnerTexts())
    .map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean);

  console.error('\n── buttons on the page ──');
  console.error(JSON.stringify(await names(), null, 0));

  const counts = async (label: string) => {
    const ce = await page.locator('[contenteditable="true"]').count();
    const ta = await page.locator('textarea').count();
    const ti = await page.locator('input[type="text"]').count();
    console.error(`${label}: contenteditable=${ce} textarea=${ta} text-input=${ti}`);
    return ce + ta + ti;
  };
  await counts('at rest');

  // Does clicking an existing paragraph make it editable?
  const para = page.locator('p, div').filter({ hasText: /binder|gantry|technical risk/i }).last();
  if (await para.count()) {
    await para.click({ timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(600);
    await counts('after clicking a paragraph');
    await para.dblclick({ timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(600);
    await counts('after double-clicking it');
  }

  // Does the INSERT ribbon's Text control add an editable block?
  for (const label of ['Text', 'Paragraph']) {
    const b = page.getByRole('button', { name: new RegExp(`^\\W*${label}$`, 'i') }).first();
    if (await b.count()) {
      console.error(`\nclicking INSERT "${label}"…`);
      await b.click({ timeout: 10_000 }).catch(() => {});
      await page.waitForTimeout(800);
      await counts(`after INSERT ${label}`);
      break;
    }
  }
  await page.screenshot({ path: '/tmp/claude-0/-home-user-govwin/34d597b2-183f-5787-9057-fc7251e3f9ff/scratchpad/probe-editor.png', fullPage: false });
});
