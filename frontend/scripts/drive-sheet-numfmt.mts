/** Live drive for SHEETS-clean number formatting. Opens the cost sheet, applies Currency
 *  to the Direct Cost column + Percent to Fringe, screenshots before/after.
 *  Usage: DOC_ID=<uuid> node --import tsx scripts/drive-sheet-numfmt.mts */
import { chromium, type Page } from 'playwright';
import { mkdirSync } from 'fs';
// One base URL, three historic spellings — and this file used the worst of them: a LITERAL, which
// ignores both env names silently. A drive pinned to :3000 runs against whatever build happens to
// be serving there, so it can report a stale product as broken, or a fixed one as still broken.
// (That is exactly how the release-gate change looked like a product failure for two runs.)
const BASE = process.env.GUIDE_BASE || process.env.BASE_URL || 'http://localhost:3000';
const DOC = process.env.DOC_ID!;
const OUT = '/tmp/claude-0/-home-user-govwin/34d597b2-183f-5787-9057-fc7251e3f9ff/scratchpad/sheet-shots';
mkdirSync(OUT, { recursive: true });

async function fmtCell(page: Page, text: string, label: string) {
  await page.getByText(text, { exact: true }).first().click();
  await page.waitForTimeout(150);
  const sel = page.locator('select').filter({ has: page.locator('option', { hasText: 'Currency $' }) });
  await sel.selectOption({ label });
  await page.waitForTimeout(200);
}

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const p = await (await b.newContext({ viewport: { width: 1680, height: 1000 }, deviceScaleFactor: 2 })).newPage();
const errors: string[] = [];
p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
try {
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await p.fill('input[name="email"]', 'kate.ulepic@foundation3dp.com');
  await p.fill('input[name="password"]', 'DemoPass123!');
  await Promise.all([p.waitForLoadState('networkidle'), p.click('button[type="submit"]')]);
  await p.waitForTimeout(1000);
  await p.goto(`${BASE}/portal/foundation/documents/${DOC}`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(2000);
  await p.screenshot({ path: `${OUT}/sheet-01-raw.png` });

  await fmtCell(p, '59200', 'Currency $0');
  await fmtCell(p, '57600', 'Currency $0');
  await fmtCell(p, '42000', 'Currency $0');
  await fmtCell(p, '0.32', 'Percent %');   // first Fringe cell
  await fmtCell(p, '0.32', 'Percent %');   // second (first is now 32%, so this is unique)
  await p.waitForTimeout(300);
  await p.screenshot({ path: `${OUT}/sheet-02-formatted.png` });
  console.log(`console errors: ${errors.length}`);
} catch (e) {
  console.error('FAILED:', e);
  await p.screenshot({ path: `${OUT}/sheet-99-fail.png` }).catch(() => {});
  process.exitCode = 1;
} finally {
  await b.close();
}
