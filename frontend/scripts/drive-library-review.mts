/** Live drive: the Library Review tab — duplicates + quality flags + one-click archive.
 *  Then the Library tab's editable detail drawer. cd frontend && node --import tsx scripts/drive-library-review.mts */
import { chromium, type Page } from 'playwright';
import { mkdirSync } from 'fs';
import { join } from 'path';
// One base URL, three historic spellings — and this file used the worst of them: a LITERAL, which
// ignores both env names silently. A drive pinned to :3000 runs against whatever build happens to
// be serving there, so it can report a stale product as broken, or a fixed one as still broken.
// (That is exactly how the release-gate change looked like a product failure for two runs.)
const BASE = process.env.GUIDE_BASE || process.env.BASE_URL || 'http://localhost:3000';
const OUT = '/tmp/claude-0/-home-user-govwin/34d597b2-183f-5787-9057-fc7251e3f9ff/scratchpad/review-shots';
mkdirSync(OUT, { recursive: true });
const shot = async (p: Page, n: string) => { await p.waitForTimeout(500); await p.screenshot({ path: join(OUT, `${n}.png`) }); console.log(`  📸 ${n}`); };

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const p = await (await b.newContext({ viewport: { width: 1680, height: 1050 }, deviceScaleFactor: 1.6 })).newPage();
p.setDefaultTimeout(25000);
const errors: string[] = [];
p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
try {
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await p.fill('input[name="email"]', 'kate.ulepic@foundation3dp.com');
  await p.fill('input[name="password"]', 'DemoPass123!');
  await Promise.all([p.waitForLoadState('networkidle'), p.click('button[type="submit"]')]);
  await p.waitForTimeout(1000);

  // ── Review tab ──
  await p.goto(`${BASE}/portal/foundation/atoms?tab=review`, { waitUntil: 'networkidle' });
  await p.getByText('Duplicate copies').first().waitFor({ timeout: 25000 });
  await p.waitForTimeout(800);
  await shot(p, 'review-01-findings');

  // one-click cleanup: archive the duplicate extras
  const before = await p.getByText(/Archive all extras/).innerText().catch(() => '');
  await p.getByRole('button', { name: /Archive all extras/ }).click();
  await p.waitForTimeout(1800);
  await shot(p, 'review-02-after-dedup');
  console.log(`dedup button was: "${before}"`);

  // ── Library tab: editable detail drawer (confirm/add tags) ──
  await p.goto(`${BASE}/portal/foundation/atoms?tab=library`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1000);
  // open the first atom's detail drawer
  const firstTitle = p.locator('button.text-gray-800').first();
  await firstTitle.click().catch(() => {});
  await p.waitForTimeout(900);
  await shot(p, 'review-03-editable-drawer');

  console.log(`\nconsole errors: ${errors.length}`);
  errors.slice(0, 5).forEach((e) => console.log(`  ⚠️ ${e}`));
} catch (e) { console.error('FAILED:', e); await shot(p, 'review-99-fail').catch(() => {}); process.exitCode = 1; }
finally { await b.close(); }
