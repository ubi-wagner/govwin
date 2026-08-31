import { chromium } from 'playwright';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
// One base URL, three historic spellings — and this file used the worst of them: a LITERAL, which
// ignores both env names silently. A drive pinned to :3000 runs against whatever build happens to
// be serving there, so it can report a stale product as broken, or a fixed one as still broken.
// (That is exactly how the release-gate change looked like a product failure for two runs.)
const BASE = process.env.GUIDE_BASE || process.env.BASE_URL || 'http://localhost:3000';
async function login(ctx, email, pw) {
  const p = await ctx.newPage();
  await p.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(2000);
  await p.waitForSelector('#email', { timeout: 20000 });
  await p.locator('#email').fill(email); await p.locator('#password').fill(pw);
  await p.click('button[type="submit"]');
  await p.waitForURL((u) => !u.pathname.endsWith('/login'), { timeout: 20000 }).catch(()=>{});
  await p.waitForTimeout(1500); return p;
}
// tokens that indicate DATA present vs an empty/DENY-ALL state
const DATA = ['DON26BX03','Counter Unmanned','NAVAIR','NP002','C-UAS','GHOST','past-performance'];
const EMPTY = ['No proposals','no proposals','Get Started','No workspace','empty','No documents','Nothing here','No atoms','No results'];
async function inspect(page, path) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1000);
  const text = (await page.evaluate(() => document.body.innerText)) || '';
  const data = DATA.filter(t => text.includes(t));
  const empty = EMPTY.filter(t => text.toLowerCase().includes(t.toLowerCase()));
  console.log(`\n### ${path}`);
  console.log(`   DATA markers: [${data.join(', ') || 'NONE'}]`);
  console.log(`   EMPTY markers: [${empty.join(', ') || 'none'}]`);
  console.log(`   first 220 chars: ${text.replace(/\s+/g,' ').slice(0, 220)}`);
}
async function main() {
  const b = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const tctx = await b.newContext(); await login(tctx, 'eric@immobileyes.com', 'Sandbox2026!');
  for (const p of ['/portal/immobileyes/proposals','/portal/immobileyes/dashboard','/portal/immobileyes/atoms','/portal/immobileyes/manage']) {
    const pg = await tctx.newPage(); await inspect(pg, p).catch(e=>console.log('ERR',p,String(e).slice(0,80))); await pg.close();
  }
  await tctx.close();
  const actx = await b.newContext(); await login(actx, 'eric@rfppipeline.com', 'Sandbox2026!');
  for (const p of ['/admin/proposals','/admin/tenants/dd831b77-2d6b-4b53-bb18-4d48569a2258']) {
    const pg = await actx.newPage(); await inspect(pg, p).catch(e=>console.log('ERR',p,String(e).slice(0,80))); await pg.close();
  }
  await actx.close(); await b.close();
}
main().catch(e=>{console.error(String(e).slice(0,200));process.exit(1);});
