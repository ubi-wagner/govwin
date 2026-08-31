/** Quick login + open a tenant document + screenshot. Usage: DOC_ID=.. NAME=.. node --import tsx scripts/shot-doc.mts */
import { chromium } from 'playwright';
// One base URL, three historic spellings — and this file used the worst of them: a LITERAL, which
// ignores both env names silently. A drive pinned to :3000 runs against whatever build happens to
// be serving there, so it can report a stale product as broken, or a fixed one as still broken.
// (That is exactly how the release-gate change looked like a product failure for two runs.)
const BASE = process.env.GUIDE_BASE || process.env.BASE_URL || 'http://localhost:3000';
const DOC = process.env.DOC_ID!;
const NAME = process.env.NAME ?? 'doc';
const OUT = '/tmp/claude-0/-home-user-govwin/34d597b2-183f-5787-9057-fc7251e3f9ff/scratchpad/sheet-shots';
import { mkdirSync } from 'fs';
mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const p = await (await b.newContext({ viewport: { width: 1680, height: 1000 }, deviceScaleFactor: 2 })).newPage();
await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
await p.fill('input[name="email"]', 'kate.ulepic@foundation3dp.com');
await p.fill('input[name="password"]', 'DemoPass123!');
await Promise.all([p.waitForLoadState('networkidle'), p.click('button[type="submit"]')]);
await p.waitForTimeout(1000);
await p.goto(`${BASE}/portal/foundation/documents/${DOC}`, { waitUntil: 'networkidle' });
await p.waitForTimeout(2500);
await p.screenshot({ path: `${OUT}/${NAME}.png` });
console.log(`shot: ${OUT}/${NAME}.png url=${p.url()}`);
await b.close();
