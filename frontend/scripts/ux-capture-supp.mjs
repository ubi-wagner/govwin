/** Supplemental UX capture — tenant surfaces missed/mis-targeted in the first pass. */
import { chromium } from 'playwright';
import fs from 'fs';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = 'http://localhost:3000';
const OUT = '/tmp/claude-0/-home-user-govwin/34d597b2-183f-5787-9057-fc7251e3f9ff/scratchpad/ux';
const S = 'foundation';
const SURF = [
  ['manage', `/portal/${S}/manage`],
  ['todos', `/portal/${S}/todos`],
  ['billing', `/portal/${S}/billing`],
  ['documents', `/portal/${S}/documents`],
  ['processes', `/portal/${S}/processes`],
  ['activity', `/portal/${S}/activity`],
  ['vaults', `/portal/${S}/vaults`],
];
async function login(page, email, pw) {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await page.waitForSelector('#email', { state: 'visible', timeout: 20000 });
  await page.fill('#email', email); await page.fill('#password', pw);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.endsWith('/login'), { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1000);
}
async function main() {
  const b = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const lp = await ctx.newPage();
  await login(lp, 'kate.ulepic@foundation3dp.com', 'DemoPass123!');
  await lp.close();
  const results = [];
  for (const [label, path] of SURF) {
    const page = await ctx.newPage();
    const errs = [];
    page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 120)); });
    page.on('pageerror', (e) => errs.push('PE: ' + String(e).slice(0, 120)));
    let status = 0;
    try { const r = await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle', timeout: 35000 }); status = r ? r.status() : 0; }
    catch (e) { errs.push('NAV ' + String(e).slice(0, 80)); }
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${OUT}/kate-${label}.png`, fullPage: true }).catch(() => {});
    results.push({ label, path, status, errors: errs.slice(0, 4) });
    console.log(`${status === 200 ? '✓' : '⚠'} ${label} ${status} ${errs.length ? '· ' + errs.length + ' err' : ''}`);
    await page.close();
  }
  await ctx.close(); await b.close();
  fs.writeFileSync(`${OUT}/ux-supp.json`, JSON.stringify(results, null, 2));
  console.log('supp done');
}
main().catch((e) => { console.error(String(e).slice(0, 200)); process.exit(1); });
