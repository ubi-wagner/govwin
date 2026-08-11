/** Live drive: box a PDF PAGE → image atom (BOX-1b, the scanned-table / figure-heavy case).
 *  Generates a real 2-page PDF (Chromium page.pdf), uploads it into the Capture tab, and
 *  HARD-asserts the new code: pdfjs renders the selected page into the frame (verified by
 *  reading the canvas pixels — page 1 blue, page 2 red), page-nav re-renders, then boxes a
 *  region → Atomize → and DB-proves a draft image atom landed (storage via local R2 emulation).
 *  Cleans up its own test rows. cd frontend && node --import tsx scripts/drive-box-pdf.mts */
import { chromium, type Page } from 'playwright';
import postgres from 'postgres';
import { mkdirSync } from 'fs';
import { join } from 'path';

const DBURL = 'postgresql://govtech:changeme@localhost:5432/govtech_intel';
const OUT = '/tmp/claude-0/-home-user-govwin/34d597b2-183f-5787-9057-fc7251e3f9ff/scratchpad/box-shots';
mkdirSync(OUT, { recursive: true });
const TOKEN = `ZZBOX1B-${Date.now()}`;                 // unique title marker for DB proof + scoped cleanup
const BASE = process.env.BASE || 'http://localhost:3000';
const runStart = new Date();
const shot = async (p: Page, n: string) => { await p.waitForTimeout(350); await p.screenshot({ path: join(OUT, `${n}.png`), fullPage: true }); console.log(`  📸 ${n}`); };

let ok = true;
const A = (label: string, cond: boolean, extra = '') => { console.log(`${cond ? '✓' : '✗'} ${label}${extra ? ` — ${extra}` : ''}`); ok = ok && cond; };

const sql = postgres(DBURL, { max: 2 });
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });

// Read the mean R/B + non-white fraction of the visible frame canvas (proves pdfjs painted it).
const canvasStats = (p: Page) => p.evaluate(() => {
  const c = document.querySelector('div.cursor-crosshair canvas') as HTMLCanvasElement | null;
  if (!c || !c.width) return null;
  const d = c.getContext('2d')!.getImageData(0, 0, Math.min(c.width, 300), Math.min(c.height, 300)).data;
  let r = 0, bl = 0, nonWhite = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) { r += d[i]; bl += d[i + 2]; if (!(d[i] > 245 && d[i + 1] > 245 && d[i + 2] > 245)) nonWhite++; n++; }
  return { w: c.width, h: c.height, avgR: r / n, avgB: bl / n, nonWhitePct: nonWhite / n };
});

try {
  // ── 1) Make a real 2-page PDF: page 1 solid blue, page 2 solid red (distinct, checkable) ──
  const gen = await (await b.newContext()).newPage();
  await gen.setContent(`<!doctype html><html><body style="margin:0">
    <div style="height:100vh;background:#1c64c8;color:#fff;font:700 46px sans-serif;padding:48px;box-sizing:border-box;page-break-after:always">PAGE ONE — cost table</div>
    <div style="height:100vh;background:#dc3c3c;color:#fff;font:700 46px sans-serif;padding:48px;box-sizing:border-box">PAGE TWO — figure</div>
  </body></html>`, { waitUntil: 'networkidle' });
  const pdfBuf = await gen.pdf({ format: 'Letter', printBackground: true });
  await gen.close();
  A('generated a 2-page test PDF', pdfBuf.length > 800, `${pdfBuf.length} bytes`);

  // ── 2) Login + open the Capture tab ──
  const p = await (await b.newContext({ viewport: { width: 1440, height: 1200 }, deviceScaleFactor: 1.2 })).newPage();
  p.setDefaultTimeout(25000);
  const errors: string[] = [];
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  p.on('response', (r) => { if (r.status() === 404) errors.push(`404: ${r.url()}`); });

  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await p.fill('input[name="email"]', 'kate.ulepic@foundation3dp.com');
  await p.fill('input[name="password"]', 'DemoPass123!');
  await Promise.all([p.waitForLoadState('networkidle'), p.click('button[type="submit"]')]);
  await p.waitForTimeout(1200);
  await p.goto(`${BASE}/portal/foundation/atoms?tab=capture`, { waitUntil: 'networkidle' });
  await p.getByText(/Box a PDF page/).first().waitFor({ timeout: 25000 });
  await shot(p, 'pdf-00-capture-tab');

  // ── 3) Upload the PDF → pdfjs renders page 1 into the frame ──
  await p.locator('input[type="file"][accept="application/pdf,.pdf"]').setInputFiles({ name: 'solicitation.pdf', mimeType: 'application/pdf', buffer: pdfBuf });
  const overlay = p.locator('div.cursor-crosshair');
  const outcome = await Promise.race([
    overlay.waitFor({ timeout: 25000 }).then(() => 'frame').catch(() => 'to'),
    p.locator('.bg-rose-50').first().waitFor({ timeout: 25000 }).then(() => 'error').catch(() => 'to'),
  ]);
  if (outcome !== 'frame') {
    const banner = await p.locator('.bg-rose-50').first().innerText().catch(() => '(no banner)');
    console.log(`  ⚠️ frame did not render (outcome=${outcome}); banner="${banner}"`);
    console.log(`  console/page errors so far: ${errors.length}`); errors.slice(0, 8).forEach((e) => console.log(`   ⚠️ ${e}`));
    await shot(p, 'pdf-98-noframe');
    throw new Error('PDF frame did not render');
  }
  await p.waitForTimeout(800);
  await shot(p, 'pdf-01-page1-rendered');
  const s1 = await canvasStats(p);
  A('page 1 rendered non-blank pixels', !!s1 && s1.nonWhitePct > 0.5, s1 ? `nonWhite=${(s1.nonWhitePct * 100) | 0}% ${s1.w}x${s1.h}` : 'no canvas');
  A('page 1 reads BLUE (avgB > avgR)', !!s1 && s1.avgB > s1.avgR + 20, s1 ? `avgR=${s1.avgR | 0} avgB=${s1.avgB | 0}` : '');

  // ── 4) Page nav → page 2 (red), then back to page 1 ──
  A('page indicator shows 1 / 2', await p.getByText(/page 1 \/ 2/).count() > 0);
  await p.getByRole('button', { name: '›' }).click();
  await p.getByText(/page 2 \/ 2/).waitFor({ timeout: 10000 });
  await p.waitForTimeout(600);
  await shot(p, 'pdf-02-page2-rendered');
  const s2 = await canvasStats(p);
  A('page 2 reads RED (avgR > avgB)', !!s2 && s2.avgR > s2.avgB + 20, s2 ? `avgR=${s2.avgR | 0} avgB=${s2.avgB | 0}` : '');
  await p.getByRole('button', { name: '‹' }).click();                 // back to page 1 to box it
  await p.getByText(/page 1 \/ 2/).waitFor({ timeout: 10000 });
  await p.waitForTimeout(500);

  // ── 5) Box a region on page 1, title it, Atomize ──
  const bb = await overlay.boundingBox();
  if (!bb) throw new Error('no overlay box');
  await p.mouse.move(bb.x + bb.width * 0.22, bb.y + bb.height * 0.28);
  await p.mouse.down();
  await p.waitForTimeout(220);                                        // let setDrag re-render land
  await p.mouse.move(bb.x + bb.width * 0.5, bb.y + bb.height * 0.55, { steps: 8 });
  await p.waitForTimeout(120);
  await p.mouse.move(bb.x + bb.width * 0.72, bb.y + bb.height * 0.78, { steps: 8 });
  await p.waitForTimeout(120);
  await p.mouse.up();
  await p.getByText(/1 region\(s\)/).first().waitFor({ timeout: 10000 });
  await p.locator('input[placeholder="Region 1 title"]').fill(`${TOKEN} cost table`);
  await shot(p, 'pdf-03-region-boxed');

  await p.getByRole('button', { name: /Atomize 1 region\(s\)/ }).click();
  await p.getByText(/Atomized 1 region\(s\)/).waitFor({ timeout: 25000 });
  const msg = await p.getByText(/Atomized 1 region\(s\)/).innerText();
  A('UI reports "Atomized 1 region(s)"', /Atomized 1 region/.test(msg), msg);
  await shot(p, 'pdf-04-atomized');
  console.log(`  console errors: ${errors.length}`); errors.slice(0, 4).forEach((e) => console.log(`   ⚠️ ${e}`));

  // ── 6) DB-prove the atom landed (draft primitive image atom, my token, + a stored image node) ──
  const rows = await sql`
    SELECT a.id, a.grain, a.status, a.canvas_nodes
    FROM library_atoms a JOIN tenants t ON t.id = a.tenant_id
    WHERE t.slug = 'foundation' AND a.title = ${`${TOKEN} cost table`}`;
  A('exactly 1 atom row for the boxed region', rows.length === 1, `found ${rows.length}`);
  const atom = rows[0];
  A('atom is a draft primitive', atom?.grain === 'primitive' && atom?.status === 'draft', `${atom?.grain}/${atom?.status}`);
  const nodes = atom?.canvasNodes ?? atom?.canvas_nodes;              // toCamel: postgres.js may camel it
  const key = Array.isArray(nodes) && nodes[0]?.content?.storage_key;
  A('atom carries an image node with a storage_key', !!key, key || 'none');
} catch (e) { console.error('FAILED:', e); ok = false; } // step screenshots (incl. pdf-98-noframe) already captured on the real page
finally {
  // Scoped cleanup: delete the atoms + cocoon this run created (FK-safe order), leave the demo pristine.
  try {
    const cocoons = await sql`SELECT c.id FROM document_cocoons c JOIN tenants t ON t.id = c.tenant_id
      WHERE t.slug='foundation' AND c.name LIKE 'Screen capture — %' AND c.created_at >= ${runStart}`;
    const cids = cocoons.map((c: { id: string }) => c.id);
    const atomRows = cids.length
      ? await sql`SELECT id FROM library_atoms WHERE cocoon_id = ANY(${cids}::uuid[])`
      : await sql`SELECT a.id FROM library_atoms a JOIN tenants t ON t.id=a.tenant_id WHERE t.slug='foundation' AND a.title LIKE ${TOKEN + '%'}`;
    const aids = atomRows.map((r: { id: string }) => r.id);
    if (aids.length) {
      await sql`DELETE FROM atom_members WHERE group_atom_id = ANY(${aids}::uuid[]) OR member_atom_id = ANY(${aids}::uuid[])`;
      await sql`DELETE FROM atom_tags WHERE atom_id = ANY(${aids}::uuid[])`;
      await sql`DELETE FROM library_atoms WHERE id = ANY(${aids}::uuid[])`;
    }
    if (cids.length) await sql`DELETE FROM document_cocoons WHERE id = ANY(${cids}::uuid[])`;
    console.log(`  🧹 cleaned ${aids.length} atom(s) + ${cids.length} cocoon(s)`);
  } catch (e) { console.error('  cleanup warning:', e instanceof Error ? e.message : e); }
  await b.close(); await sql.end({ timeout: 5 });
}
console.log(ok ? '\nPASS — a PDF page renders into the box tool and a boxed region becomes a draft image atom (local R2)' : '\nFAIL');
process.exit(ok ? 0 : 1);
