import { chromium } from 'playwright';
import fs from 'fs'; import path from 'path';
const BASE = 'http://localhost:3000';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const OUT = '/home/user/govwin/docs/manuals/img/crops/tenant';
const SH = '/home/user/govwin/docs/manuals/img/shots/tenant';
fs.mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ executablePath: EXE });
const p = await (await b.newContext({ viewport: { width: 1440, height: 1024 }, deviceScaleFactor: 2 })).newPage();
try {
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await p.fill('input[name="email"]', 'eric@immobileyes.com');
  await p.fill('input[name="password"]', 'Immobileyes2026!');
  await Promise.all([p.waitForLoadState('networkidle'), p.click('button[type="submit"]')]);
  await p.waitForTimeout(2000);
  console.log('login →', p.url());
  await p.goto(`${BASE}/portal/immobileyes/atoms`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(2500); // dev compiles the route
  // click the Capture tab
  const cap = p.getByRole('button', { name: /^Capture$/ });
  console.log('Capture tab present:', await cap.count());
  if (await cap.count()) { await cap.first().click(); await p.waitForTimeout(1200); }
  await p.screenshot({ path: path.join(SH, 'capture.png'), fullPage: true });
  // crop the capture panel (info card + button + tab bar)
  await p.screenshot({ path: path.join(OUT, 'capture-tab.png'), clip: { x: 256, y: 120, width: 1000, height: 340 } });
  console.log('📸 capture tab shots saved');
} catch (e) { console.error('ERR', e); process.exitCode = 1; } finally { await b.close(); }
