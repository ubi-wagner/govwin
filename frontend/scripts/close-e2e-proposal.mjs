/** CLOSE-PROPOSAL — real-actor E2E: tenant_admin (kate) opens the AI-built proposal (sections
 *  drafted by section_drafter), sees the readiness roll-up, and downloads the compiled package
 *  (docx + pdf) — verifying REAL bytes, not a stub.
 *  cd frontend && DATABASE_URL=… node scripts/close-e2e-proposal.mjs */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

// One base URL, three historic spellings — and this file used the worst of them: a LITERAL, which
// ignores both env names silently. A drive pinned to :3000 runs against whatever build happens to
// be serving there, so it can report a stale product as broken, or a fixed one as still broken.
// (That is exactly how the release-gate change looked like a product failure for two runs.)
const BASE = process.env.GUIDE_BASE || process.env.BASE_URL || 'http://localhost:3000';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const OUT = '/home/user/govwin/docs/assets/close-e2e';
fs.mkdirSync(OUT, { recursive: true });
const KATE = { email: 'kate.ulepic@foundation3dp.com', pw: 'DemoPass123!' };
const SLUG = 'foundation';
const PROP = 'bbd6a058-3299-4b98-96e0-1e07e43aa1c4'; // TVSF, stage=final, 18 sections
const shot = async (p, n) => { await p.screenshot({ path: path.join(OUT, n + '.png'), fullPage: true }); console.log('  ✓ shot', n); };
const settle = async (p, ms = 2200) => { await p.waitForLoadState('networkidle').catch(() => {}); await p.waitForTimeout(ms); };
let ok = true; const A = (l, c, x = '') => { console.log(`${c ? '✓' : '✗'} ${l}${x ? ` — ${x}` : ''}`); ok = ok && c; };

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 2000 } });
const p = await ctx.newPage();
try {
  await p.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('#email', { timeout: 20000 });
  await p.fill('#email', KATE.email); await p.fill('#password', KATE.pw);
  await p.click('button[type="submit"]'); await settle(p, 2800);
  console.log('  logged in →', p.url());

  // The AI-built proposal overview (drafted sections + readiness panel).
  await p.goto(`${BASE}/portal/${SLUG}/proposals/${PROP}`); await settle(p, 2600);
  await shot(p, 'prop-01-overview');
  const body = (await p.textContent('body').catch(() => '')) || '';
  A('proposal overview loaded for the real actor', /TVSF|Round 45|Technical|readiness|Readiness|Volume/i.test(body));

  // Download the compiled package as the actor would — verify REAL bytes per format.
  for (const fmt of ['docx', 'pdf']) {
    const r = await p.request.post(`${BASE}/api/portal/${SLUG}/proposals/${PROP}/package?format=${fmt}`);
    const buf = await r.body().catch(() => Buffer.alloc(0));
    const magic = fmt === 'docx' ? (buf[0] === 0x50 && buf[1] === 0x4b) /* PK zip */
                                 : (buf.slice(0, 4).toString() === '%PDF');
    A(`package ${fmt.toUpperCase()} downloads as real bytes`, r.ok() && buf.length > 2000 && magic,
      `${r.status()} · ${buf.length}B · magic=${magic}`);
    if (r.ok() && buf.length > 0) fs.writeFileSync(path.join(OUT, `prop-package.${fmt}`), buf);
  }

  console.log(`\n${ok ? '✅ PROPOSAL E2E PASS — real actor viewed the AI-built proposal + downloaded real package bytes' : '❌ see failures'}\n`);
} catch (e) {
  console.error('PROPOSAL E2E ERROR', e.message);
  await p.screenshot({ path: path.join(OUT, 'prop-error.png') }).catch(() => {});
  ok = false;
} finally {
  await browser.close();
  process.exit(ok ? 0 : 1);
}
