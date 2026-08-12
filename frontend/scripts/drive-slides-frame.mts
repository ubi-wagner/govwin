/**
 * Live drive for SLIDES-clean — the slide-frame control (size · ratio · count + background).
 * Opens the seeded Foundation deck as the tenant_admin and exercises: 16:9 ↔ 4:3 aspect
 * switch (surface reflows), deck background color, and + Slide. Screenshots each step.
 *
 *   cd frontend && DOC_ID=<uuid> node --import tsx scripts/drive-slides-frame.mts
 */
import { chromium, type Page } from 'playwright';
import { mkdirSync } from 'fs';
import { join } from 'path';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const OUT = '/tmp/claude-0/-home-user-govwin/34d597b2-183f-5787-9057-fc7251e3f9ff/scratchpad/slides-shots';
mkdirSync(OUT, { recursive: true });
const EMAIL = 'kate.ulepic@foundation3dp.com';
const PW = 'DemoPass123!';
const DOC = process.env.DOC_ID ?? 'a3bd5561-90a8-4a19-a828-4dfff30fa5f2';

async function shot(page: Page, name: string, full = false) {
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: full });
  console.log(`  📸 ${name}.png`);
}

async function run() {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1680, height: 1000 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.setDefaultTimeout(25000);
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  try {
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
    await page.fill('input[name="email"]', EMAIL);
    await page.fill('input[name="password"]', PW);
    await Promise.all([page.waitForLoadState('networkidle'), page.click('button[type="submit"]')]);
    await page.waitForTimeout(1000);

    await page.goto(`${BASE}/portal/foundation/documents/${DOC}`, { waitUntil: 'networkidle' });
    await page.getByText('Slide frame').waitFor({ timeout: 25000 });
    await page.waitForTimeout(1000);
    await shot(page, 'slides-01-16x9');

    // Aspect → 4:3 (surface reflows narrower)
    await page.getByRole('button', { name: '4:3', exact: true }).click();
    await page.waitForTimeout(900);
    await shot(page, 'slides-02-4x3');

    // Back to 16:9
    await page.getByRole('button', { name: '16:9', exact: true }).click();
    await page.waitForTimeout(700);

    // Deck background → dark navy. A React controlled <input> ignores a plain `.value =`
    // assignment (React overrides the setter + tracks the last value), so use the native
    // value setter, then dispatch input/change — exactly what a real picker selection does.
    const bgSet = await page.evaluate((color) => {
      const el = document.querySelector('input[type=color][title="Deck background color"]') as HTMLInputElement | null;
      if (!el) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(el, color);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return el.value;
    }, '#0f172a');
    console.log(`background input set: ${bgSet}`);
    await page.waitForTimeout(900);
    await shot(page, 'slides-03-background');

    // + Slide (count 3 → 4)
    await page.getByRole('button', { name: '+ Slide' }).click();
    await page.waitForTimeout(900);
    await shot(page, 'slides-04-added');

    console.log(`\nconsole errors: ${errors.length}`);
    errors.slice(0, 6).forEach((e) => console.log(`  ⚠️ ${e}`));
  } catch (e) {
    console.error('DRIVE FAILED:', e);
    await shot(page, 'slides-99-failure', true).catch(() => {});
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}
run();
