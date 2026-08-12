/** Prod-build proof of the enrich step: POST a TEXT crop to the real /atoms/capture route (authenticated)
 *  and confirm the created image atom's content carries the OCR'd text — i.e. tesseract runs inside the
 *  Next standalone server. cd frontend && node --import tsx scripts/drive-enrich-prod.mts */
import { chromium } from 'playwright';
import postgres from 'postgres';

const BASE = process.env.BASE || 'http://localhost:3000';
const DBURL = 'postgresql://govtech:changeme@localhost:5432/govtech_intel';
const sql = postgres(DBURL, { max: 2 });
let ok = true; const A = (l: string, c: boolean, x = '') => { console.log(`${c ? '✓' : '✗'} ${l}${x ? ` — ${x}` : ''}`); ok = ok && c; };
const runStart = new Date();

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
try {
  // Render a text-bearing crop, base64 it for the in-browser POST.
  const g = await (await b.newContext({ viewport: { width: 760, height: 240 } })).newPage();
  await g.setContent(`<body style="margin:0;background:#fff"><div style="font:bold 38px Arial;color:#111;padding:40px;line-height:1.5">Direct Labor 59200 Materials 12400 TOTAL 71600</div></body>`, { waitUntil: 'networkidle' });
  const crop = (await g.screenshot()).toString('base64');
  await g.close();

  const p = await (await b.newContext()).newPage();
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await p.fill('input[name=email]', 'kate.ulepic@foundation3dp.com');
  await p.fill('input[name=password]', 'DemoPass123!');
  await Promise.all([p.waitForLoadState('networkidle'), p.click('button[type=submit]')]);
  await p.waitForTimeout(1000);

  const res = await p.evaluate(async ({ crop }) => {
    const bytes = Uint8Array.from(atob(crop), (c) => c.charCodeAt(0));
    const fd = new FormData();
    fd.append('full', new File([bytes], 'frame.png', { type: 'image/png' }));
    fd.append('region_0', new File([bytes], 'region_0.png', { type: 'image/png' }));
    fd.append('regions', JSON.stringify([{ title: 'Boxed cost table' }]));
    fd.append('note', 'enrich prod proof');
    const r = await fetch('/api/portal/foundation/atoms/capture', { method: 'POST', body: fd });
    return { status: r.status, body: await r.text() };
  }, { crop });
  A('capture 200', res.status === 200, `status=${res.status}`);
  const data = JSON.parse(res.body).data;
  const regionId = data?.regionIds?.[0];
  A('a region atom was created', !!regionId);

  const [atom] = await sql`SELECT content, summary FROM library_atoms WHERE id = ${regionId}::uuid`;
  const content = (atom?.content ?? '') as string;
  console.log(`  content: ${JSON.stringify(content.slice(0, 120))}`);
  A('OCR ran INSIDE the standalone build (content has the crop text)', /59200/.test(content) && /71600/.test(content), content.slice(0, 60));
} catch (e) { console.error('FAILED:', e); ok = false; }
finally {
  try {
    const cocoons = await sql`SELECT c.id FROM document_cocoons c JOIN tenants t ON t.id=c.tenant_id
      WHERE t.slug='foundation' AND c.name LIKE 'Screen capture — %' AND c.created_at >= ${runStart}`;
    const cids = cocoons.map((c: { id: string }) => c.id);
    if (cids.length) {
      const aids = (await sql`SELECT id FROM library_atoms WHERE cocoon_id = ANY(${cids}::uuid[])`).map((r: { id: string }) => r.id);
      if (aids.length) { await sql`DELETE FROM atom_tags WHERE atom_id = ANY(${aids}::uuid[])`; await sql`DELETE FROM library_atoms WHERE id = ANY(${aids}::uuid[])`; }
      await sql`DELETE FROM document_cocoons WHERE id = ANY(${cids}::uuid[])`;
      console.log(`  🧹 cleaned ${aids.length} atom(s) + ${cids.length} cocoon(s)`);
    }
  } catch (e) { console.error('  cleanup warning:', e instanceof Error ? e.message : e); }
  await b.close(); await sql.end({ timeout: 5 });
}
console.log(ok ? '\nPASS — OCR enrichment runs in the production standalone build (boxed text → searchable atom)' : '\nFAIL');
process.exit(ok ? 0 : 1);
