/** Live drive: preview-before-atomize on the "Add content" card.
 *  Drop a doc → PREVIEW (no write) → confirm → atoms created.
 *  cd frontend && node --import tsx scripts/drive-preview-atomize.mts */
import { chromium, type Page } from 'playwright';
import { mkdirSync } from 'fs';
import { join } from 'path';
// One base URL, three historic spellings — and this file used the worst of them: a LITERAL, which
// ignores both env names silently. A drive pinned to :3000 runs against whatever build happens to
// be serving there, so it can report a stale product as broken, or a fixed one as still broken.
// (That is exactly how the release-gate change looked like a product failure for two runs.)
const BASE = process.env.GUIDE_BASE || process.env.BASE_URL || 'http://localhost:3000';
const SCR = '/tmp/claude-0/-home-user-govwin/34d597b2-183f-5787-9057-fc7251e3f9ff/scratchpad';
const OUT = join(SCR, 'preview-shots');
const DOC = join(SCR, 'capability-brief.md');
mkdirSync(OUT, { recursive: true });
const shot = async (p: Page, n: string) => { await p.waitForTimeout(400); await p.screenshot({ path: join(OUT, `${n}.png`), fullPage: true }); console.log(`  📸 ${n}`); };

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const p = await (await b.newContext({ viewport: { width: 1440, height: 1200 }, deviceScaleFactor: 1.4 })).newPage();
p.setDefaultTimeout(25000);
const errors: string[] = [];
p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
try {
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await p.fill('input[name="email"]', 'kate.ulepic@foundation3dp.com');
  await p.fill('input[name="password"]', 'DemoPass123!');
  await Promise.all([p.waitForLoadState('networkidle'), p.click('button[type="submit"]')]);
  await p.waitForTimeout(800);

  await p.goto(`${BASE}/portal/foundation/dashboard`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(600);
  // The "Add content" card lives in the right-side "Library & content" drawer — open it.
  await p.locator('button:has-text("Library")').first().click();
  await p.getByRole('heading', { name: 'Library & content' }).waitFor({ timeout: 15000 });
  const card = p.locator('div').filter({ has: p.getByRole('heading', { name: 'Add content' }) }).first();
  await card.getByText(/Drop a document to preview/).waitFor({ timeout: 25000 });
  await shot(p, 'preview-00-card');

  // Drop the doc → dry-run preview (no write yet).
  await card.locator('input[type="file"]').setInputFiles(DOC);
  await p.getByText(/Ready to atomize/).waitFor({ timeout: 25000 });
  await p.waitForTimeout(500);
  const previewText = await p.getByText(/Ready to atomize/).innerText().catch(() => '');
  console.log(`  preview banner: "${previewText}"`);
  await shot(p, 'preview-01-dryrun');

  // Confirm → real write.
  await p.getByRole('button', { name: /Create \d+ atom/ }).click();
  await p.getByText(/Atomized/).waitFor({ timeout: 25000 });
  await p.waitForTimeout(600);
  const doneText = await p.getByText(/Atomized/).innerText().catch(() => '');
  console.log(`  result banner: "${doneText}"`);
  await shot(p, 'preview-02-created');

  console.log(`\nconsole errors: ${errors.length}`);
  errors.slice(0, 5).forEach((e) => console.log(`  ⚠️ ${e}`));
} catch (e) { console.error('FAILED:', e); await shot(p, 'preview-99-fail').catch(() => {}); process.exitCode = 1; }
finally { await b.close(); }
