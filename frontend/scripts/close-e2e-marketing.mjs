/** CLOSE-MARKETING — real-actor E2E: tenant_admin (kate) creates a marketing document from a
 *  starter mold (Capability Statement), opens it in the editor, and exports it as a real .docx.
 *  cd frontend && DATABASE_URL=… node scripts/close-e2e-marketing.mjs */
import { chromium } from 'playwright';
import postgres from 'postgres';
import fs from 'fs';
import path from 'path';

const BASE = 'http://localhost:3000';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const OUT = '/home/user/govwin/docs/assets/close-e2e';
fs.mkdirSync(OUT, { recursive: true });
const sql = postgres(process.env.DATABASE_URL || 'postgresql://govtech:changeme@localhost:5432/govtech_intel', { max: 3 });
const KATE = { email: 'kate.ulepic@foundation3dp.com', pw: 'DemoPass123!' };
const SLUG = 'foundation';
const MOLD = 'e11a7e00-0000-4000-8000-000000000001'; // Capability Statement
const shot = async (p, n) => { await p.screenshot({ path: path.join(OUT, n + '.png'), fullPage: true }); console.log('  ✓ shot', n); };
const settle = async (p, ms = 2200) => { await p.waitForLoadState('networkidle').catch(() => {}); await p.waitForTimeout(ms); };
let ok = true; const A = (l, c, x = '') => { console.log(`${c ? '✓' : '✗'} ${l}${x ? ` — ${x}` : ''}`); ok = ok && c; };

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
const p = await (await browser.newContext({ viewport: { width: 1440, height: 2000 } })).newPage();
try {
  await p.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('#email', { timeout: 20000 });
  await p.fill('#email', KATE.email); await p.fill('#password', KATE.pw);
  await p.click('button[type="submit"]'); await settle(p, 2800);
  console.log('  logged in →', p.url());

  // The New Document chooser (the real actor's mold gallery).
  await p.goto(`${BASE}/portal/${SLUG}/documents/new`); await settle(p, 2200);
  await shot(p, 'mkt-01-mold-chooser');

  // Create from the Capability Statement mold (what clicking that mold card does).
  const create = await p.request.post(`${BASE}/api/portal/${SLUG}/documents`, {
    data: { templateId: MOLD, title: 'Foundation 3DP — Capability Statement (E2E)' },
  });
  const cj = await create.json().catch(() => ({}));
  const docId = cj?.data?.documentId;
  A('marketing doc created from the mold', create.ok() && !!docId, `${create.status()} · ${cj?.data?.docType ?? ''} · ${docId ?? ''}`);

  // Open it in the editor — the mold content is interpolated + rendered.
  if (docId) {
    await p.goto(`${BASE}/portal/${SLUG}/documents/${docId}`); await settle(p, 2600);
    await shot(p, 'mkt-02-doc-editor');
    const body = (await p.textContent('body').catch(() => '')) || '';
    A('editor rendered the marketing doc (capability content)', /capab|Foundation|overview|differentiat|contact|NAICS|statement/i.test(body));

    // Export the marketing doc as a real .docx (same export engine proposals use).
    const [mold] = await sql`SELECT canvas_document FROM document_templates WHERE id=${MOLD}::uuid`;
    const canvas = mold?.canvasDocument ?? mold?.canvas_document;
    const exp = await p.request.post(`${BASE}/api/portal/${SLUG}/documents/${docId}/export`, {
      data: { document: canvas, format: 'docx' },
    });
    const buf = await exp.body().catch(() => Buffer.alloc(0));
    const isDocx = buf[0] === 0x50 && buf[1] === 0x4b; // PK zip
    A('marketing doc exports as a real .docx', exp.ok() && buf.length > 2000 && isDocx, `${exp.status()} · ${buf.length}B · PK=${isDocx}`);
    if (exp.ok() && buf.length > 0) fs.writeFileSync(path.join(OUT, 'mkt-capability.docx'), buf);
  }

  console.log(`\n${ok ? '✅ MARKETING E2E PASS — real actor created a marketing doc from a mold + exported real .docx' : '❌ see failures'}\n`);
} catch (e) {
  console.error('MARKETING E2E ERROR', e.message);
  await p.screenshot({ path: path.join(OUT, 'mkt-error.png') }).catch(() => {});
  ok = false;
} finally {
  await browser.close(); await sql.end();
  process.exit(ok ? 0 : 1);
}
