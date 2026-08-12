/** Live drive: the librarian AI-catalog layer in the Review tab (persisted agent output,
 *  surfaced). cd frontend && node --import tsx scripts/drive-librarian-review.mts */
import { chromium, type Page } from 'playwright';
import { mkdirSync } from 'fs';
import { join } from 'path';
const BASE = 'http://localhost:3000';
const OUT = '/tmp/claude-0/-home-user-govwin/34d597b2-183f-5787-9057-fc7251e3f9ff/scratchpad/librarian-shots';
mkdirSync(OUT, { recursive: true });
const shot = async (p: Page, n: string) => { await p.waitForTimeout(400); await p.screenshot({ path: join(OUT, `${n}.png`), fullPage: true }); console.log(`  📸 ${n}`); };

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const p = await (await b.newContext({ viewport: { width: 1440, height: 1400 }, deviceScaleFactor: 1.4 })).newPage();
p.setDefaultTimeout(25000);
const errors: string[] = [];
p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
try {
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await p.fill('input[name="email"]', 'kate.ulepic@foundation3dp.com');
  await p.fill('input[name="password"]', 'DemoPass123!');
  await Promise.all([p.waitForLoadState('networkidle'), p.click('button[type="submit"]')]);
  await p.waitForTimeout(800);

  await p.goto(`${BASE}/portal/foundation/atoms?tab=review`, { waitUntil: 'networkidle' });
  await p.getByText(/Librarian — AI catalog/).waitFor({ timeout: 25000 });
  await p.waitForTimeout(600);
  const assessed = await p.getByText(/assessed · advisory/).innerText().catch(() => '');
  console.log(`  librarian header: "${assessed}"`);
  for (const badge of ['keep', 'reject', 'retag', 'merge']) {
    const n = await p.locator(`span:has-text("${badge}")`).count();
    console.log(`  badge ${badge}: ${n > 0 ? 'present' : 'absent'}`);
  }
  await shot(p, 'librarian-01-layer');

  // Exercise the one-click "Archive N recommended rejects".
  const rejBtn = p.getByRole('button', { name: /Archive \d+ recommended reject/ });
  if (await rejBtn.count()) {
    const label = await rejBtn.innerText();
    await rejBtn.click();
    await p.waitForTimeout(1800);
    console.log(`  clicked: "${label}"`);
    await shot(p, 'librarian-02-after-reject');
  }

  console.log(`\nconsole errors: ${errors.length}`);
  errors.slice(0, 5).forEach((e) => console.log(`  ⚠️ ${e}`));
} catch (e) { console.error('FAILED:', e); await shot(p, 'librarian-99-fail').catch(() => {}); process.exitCode = 1; }
finally { await b.close(); }
