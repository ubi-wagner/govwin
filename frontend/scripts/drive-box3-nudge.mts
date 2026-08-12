/** Live drive (BOX-3): drop a scanned / image-only PDF on the "Add content" card and confirm the
 *  preview surfaces the un-extractable nudge + a deep-link into the box tool — instead of silently
 *  yielding nothing. cd frontend && node --import tsx scripts/drive-box3-nudge.mts */
import { chromium, type Page } from 'playwright';
import { mkdirSync } from 'fs';
import { join } from 'path';

const BASE = process.env.BASE || 'http://localhost:3000';
const OUT = '/tmp/claude-0/-home-user-govwin/34d597b2-183f-5787-9057-fc7251e3f9ff/scratchpad/box-shots';
mkdirSync(OUT, { recursive: true });
const shot = async (p: Page, n: string) => { await p.waitForTimeout(300); await p.screenshot({ path: join(OUT, `${n}.png`), fullPage: true }); console.log(`  📸 ${n}`); };
let ok = true; const A = (l: string, c: boolean, x = '') => { console.log(`${c ? '✓' : '✗'} ${l}${x ? ` — ${x}` : ''}`); ok = ok && c; };

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
try {
  // A scanned/image-only PDF (2 colored pages, NO text).
  const g = await (await b.newContext()).newPage();
  await g.setContent(`<!doctype html><body style="margin:0"><div style="height:100vh;background:linear-gradient(135deg,#1c64c8,#dc3c3c)"></div><div style="height:100vh;background:#222"></div></body>`, { waitUntil: 'networkidle' });
  const scanned = await g.pdf({ format: 'Letter', printBackground: true });
  await g.close();

  const p = await (await b.newContext({ viewport: { width: 1440, height: 1200 }, deviceScaleFactor: 1.2 })).newPage();
  p.setDefaultTimeout(25000);
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await p.fill('input[name="email"]', 'kate.ulepic@foundation3dp.com');
  await p.fill('input[name="password"]', 'DemoPass123!');
  await Promise.all([p.waitForLoadState('networkidle'), p.click('button[type="submit"]')]);
  await p.waitForTimeout(1200);
  await p.goto(`${BASE}/portal/foundation/dashboard`, { waitUntil: 'networkidle' });
  // The Add-content card lives in the right-side "Library & content" drawer — open it from the rail.
  await p.getByRole('button', { name: /Library/ }).first().click();
  await p.getByText('Add content').first().waitFor({ timeout: 25000 });
  await shot(p, 'box3-00-library-drawer');

  // Capture the preview API response for diagnosis.
  p.on('response', async (r) => {
    if (r.url().includes('atomize-package')) { try { console.log('  preview API', r.status(), (await r.text()).slice(0, 400)); } catch { /* ignore */ } }
  });
  const nInputs = await p.locator('input[type="file"][accept*=".pptx"]').count();
  console.log(`  file inputs in drawer: ${nInputs}`);
  // Upload the scanned PDF into the Add-content card (its input accepts .pptx; capture inputs don't).
  await p.locator('input[type="file"][accept*=".pptx"]').first().setInputFiles({ name: 'scanned-solicitation.pdf', mimeType: 'application/pdf', buffer: scanned });
  await p.waitForTimeout(4000);
  await shot(p, 'box3-01-after-upload');
  await p.getByText(/not text-readable|no selectable text/).first().waitFor({ timeout: 20000 });
  await shot(p, 'box3-02-nudge');

  const nudge = await p.getByText(/hold no selectable text/).first().innerText().catch(() => '');
  A('preview shows the un-extractable nudge', /hold no selectable text/.test(nudge), nudge.slice(0, 90));
  A('nudge points at the box tool ("Box a PDF page")', /Box a PDF page/.test(nudge));
  const link = p.getByRole('link', { name: /Open the box tool/ });
  A('a deep-link into the box tool is offered', await link.count() > 0);
  const href = await link.first().getAttribute('href').catch(() => null);
  A('link targets the Capture tab', href === '/portal/foundation/atoms?tab=capture', href || 'none');
  A('header flags it (⚠ not text-readable)', await p.getByText(/not text-readable/).count() > 0);
} catch (e) { console.error('FAILED:', e); ok = false; }
finally { await b.close(); }
console.log(ok ? '\nPASS — a scanned PDF no longer vanishes: the parser flags it + routes the user to the box tool' : '\nFAIL');
process.exit(ok ? 0 : 1);
