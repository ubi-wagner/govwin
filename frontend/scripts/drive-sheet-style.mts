/** Live drive: SheetEditor text-color (fg) + thick border + add a shape via the media strip.
 *  Usage: DOC_ID=<uuid> node --import tsx scripts/drive-sheet-style.mts */
import { chromium, type Page } from 'playwright';
import { mkdirSync } from 'fs';
const BASE = 'http://localhost:3000';
const DOC = process.env.DOC_ID!;
const OUT = '/tmp/claude-0/-home-user-govwin/34d597b2-183f-5787-9057-fc7251e3f9ff/scratchpad/sheet-shots';
mkdirSync(OUT, { recursive: true });

async function setColor(p: Page, title: string, color: string) {
  await p.evaluate(({ title, color }) => {
    const el = document.querySelector(`input[type=color][title="${title}"]`) as HTMLInputElement | null;
    if (!el) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(el, color);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }, { title, color });
}

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const p = await (await b.newContext({ viewport: { width: 1680, height: 1000 }, deviceScaleFactor: 2 })).newPage();
p.setDefaultTimeout(25000);
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

  // 1. Text color (fg) on the "Principal Investigator" cell.
  await p.getByText('Principal Investigator', { exact: true }).click();
  await p.waitForTimeout(150);
  await setColor(p, 'Text color', '#b91c1c');
  await p.waitForTimeout(300);

  // 2. Thick border on the TOTAL cell.
  await p.getByText('TOTAL', { exact: true }).click();
  await p.waitForTimeout(150);
  const borderSel = p.locator('select').filter({ has: p.locator('option', { hasText: 'Thick' }) });
  await borderSel.selectOption({ label: 'Thick' });
  await p.waitForTimeout(300);

  // 3. Add a shape via the media strip.
  await p.getByRole('button', { name: '+ Shape' }).click();
  await p.waitForTimeout(600);

  await p.screenshot({ path: `${OUT}/sheet-03-style-media.png` });
  console.log(`console errors: ${errors.length}`);
  errors.slice(0, 5).forEach((e) => console.log(`  ⚠️ ${e}`));
} catch (e) { console.error('FAILED:', e); await p.screenshot({ path: `${OUT}/sheet-99-style-fail.png` }).catch(() => {}); process.exitCode = 1; }
finally { await b.close(); }
