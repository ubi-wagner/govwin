/** Screenshot the #168 content queue: the content_publish review ToDos + a guide in Content Studio.
 *  DATABASE_URL=… node scripts/shot-content-queue.mjs */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const BASE = 'http://localhost:3000';
const EXE = process.env.PW_EXE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const OUT = '/home/user/govwin/docs/assets/content-queue';
fs.mkdirSync(OUT, { recursive: true });
const ADMIN = { email: 'eric@rfppipeline.com', pw: (process.env.RFP_ADMIN_PW || 'RFPAdmin2026!') };
const shot = async (p, name) => { await p.screenshot({ path: path.join(OUT, name + '.png'), fullPage: true }); console.log('  ✓ shot', name); };
const settle = async (p, ms = 1800) => { await p.waitForLoadState('networkidle').catch(() => {}); await p.waitForTimeout(ms); };

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
const p = await (await browser.newContext({ viewport: { width: 1440, height: 2100 } })).newPage();
try {
  await p.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('#email', { timeout: 20000 });
  await p.fill('#email', ADMIN.email); await p.fill('#password', ADMIN.pw);
  await p.click('button[type="submit"]'); await settle(p, 2800);
  console.log('  logged in →', p.url());

  // 1. The content-review ToDos in the admin triage inbox
  await p.goto(`${BASE}/admin/rfp-curation`); await settle(p, 2200);
  await shot(p, '01-content-review-todos');

  // 2. The content hub — the four guide drafts
  await p.goto(`${BASE}/admin/site`); await settle(p, 2200);
  await shot(p, '02-content-hub');

  // 3. A guide open in the Content Studio (canvas editor)
  await p.goto(`${BASE}/admin/site/docs/guide/what-is-a-baa`); await settle(p, 2600);
  await shot(p, '03-guide-in-studio');

  console.log('DONE');
} catch (e) {
  console.error('SHOT ERROR', e.message);
  await p.screenshot({ path: path.join(OUT, 'error.png') }).catch(() => {});
} finally {
  await browser.close();
}
