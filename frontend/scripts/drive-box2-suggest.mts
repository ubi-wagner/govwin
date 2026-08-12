/** Live drive (BOX-2): the machine draws the boxes. Load a frame → "✨ Suggest regions" pre-populates
 *  proposed boxes → the human confirms → Atomize → DB-proven draft image atoms (local R2 emulation).
 *  cd frontend && node --import tsx scripts/drive-box2-suggest.mts */
import { chromium, type Page } from 'playwright';
import postgres from 'postgres';
import { mkdirSync } from 'fs';
import { join } from 'path';
import zlib from 'zlib';

const BASE = process.env.BASE || 'http://localhost:3000';
const DBURL = 'postgresql://govtech:changeme@localhost:5432/govtech_intel';
const OUT = '/tmp/claude-0/-home-user-govwin/34d597b2-183f-5787-9057-fc7251e3f9ff/scratchpad/box-shots';
mkdirSync(OUT, { recursive: true });
const runStart = new Date();
const shot = async (p: Page, n: string) => { await p.waitForTimeout(300); await p.screenshot({ path: join(OUT, `${n}.png`), fullPage: true }); console.log(`  📸 ${n}`); };
let ok = true; const A = (l: string, c: boolean, x = '') => { console.log(`${c ? '✓' : '✗'} ${l}${x ? ` — ${x}` : ''}`); ok = ok && c; };

// minimal solid PNG (no deps)
function crc32(b: Buffer){let c=~0;for(let i=0;i<b.length;i++){c^=b[i];for(let k=0;k<8;k++)c=(c>>>1)^(0xedb88320&-(c&1));}return(~c)>>>0;}
function chunk(t:string,d:Buffer){const l=Buffer.alloc(4);l.writeUInt32BE(d.length,0);const td=Buffer.concat([Buffer.from(t,'ascii'),d]);const cr=Buffer.alloc(4);cr.writeUInt32BE(crc32(td),0);return Buffer.concat([l,td,cr]);}
function solidPng(w:number,h:number,rgb:number[]){const sig=Buffer.from([137,80,78,71,13,10,26,10]);const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(w,0);ihdr.writeUInt32BE(h,4);ihdr[8]=8;ihdr[9]=2;const px=Buffer.from(rgb);const row=Buffer.concat([Buffer.from([0]),...Array(w).fill(px)]);const idat=zlib.deflateSync(Buffer.concat(Array(h).fill(row)));return Buffer.concat([sig,chunk('IHDR',ihdr),chunk('IDAT',idat),chunk('IEND',Buffer.alloc(0))]);}
const PNG = solidPng(900, 700, [30, 90, 160]);

const sql = postgres(DBURL, { max: 2 });
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
try {
  const p = await (await b.newContext({ viewport: { width: 1440, height: 1200 }, deviceScaleFactor: 1.2 })).newPage();
  p.setDefaultTimeout(25000);
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await p.fill('input[name="email"]', 'kate.ulepic@foundation3dp.com');
  await p.fill('input[name="password"]', 'DemoPass123!');
  await Promise.all([p.waitForLoadState('networkidle'), p.click('button[type="submit"]')]);
  await p.waitForTimeout(1200);
  await p.goto(`${BASE}/portal/foundation/atoms?tab=capture`, { waitUntil: 'networkidle' });
  await p.getByText(/Box an uploaded image/).first().waitFor({ timeout: 25000 });

  // Load an image as the frame, then let the machine propose regions.
  await p.locator('input[type="file"][accept="image/*"]').setInputFiles({ name: 'diagram.png', mimeType: 'image/png', buffer: PNG });
  await p.locator('div.cursor-crosshair').waitFor({ timeout: 25000 });
  await p.waitForTimeout(400);
  await shot(p, 'box2-00-frame');

  await p.getByRole('button', { name: /Suggest regions/ }).click();
  await p.getByText(/Suggested 2 region\(s\)/).waitFor({ timeout: 25000 });
  await shot(p, 'box2-01-suggested');
  A('machine proposed 2 regions', await p.getByText(/2 region\(s\)/).first().count() > 0);
  A('a "Suggested figure" box is pre-populated', await p.locator('input[value="Suggested figure"]').count() > 0);
  A('a "Suggested table" box is pre-populated', await p.locator('input[value="Suggested table"]').count() > 0);

  // Human confirms → Atomize.
  await p.getByRole('button', { name: /Atomize 2 region\(s\)/ }).click();
  await p.getByText(/Atomized 2 region\(s\)/).waitFor({ timeout: 25000 });
  await shot(p, 'box2-02-atomized');

  // DB-prove: 2 draft primitive image atoms, from this run's capture cocoon, kind-tagged.
  const rows = await sql`
    SELECT a.id, a.grain, a.status, a.title,
           (SELECT array_agg(t.dimension||':'||t.value) FROM atom_tags t WHERE t.atom_id=a.id) AS tags
    FROM library_atoms a JOIN tenants t ON t.id=a.tenant_id
    WHERE t.slug='foundation' AND a.grain='primitive' AND a.created_at >= ${runStart}
      AND a.title IN ('Suggested figure','Suggested table') ORDER BY a.title`;
  A('exactly 2 image atoms landed', rows.length === 2, `found ${rows.length}`);
  A('both are draft primitives', rows.every((r) => r.grain === 'primitive' && r.status === 'draft'));
  A('kind tags carried through (figure + table)', rows.some((r) => (r.tags || []).includes('kind:figure')) && rows.some((r) => (r.tags || []).includes('kind:table')));
} catch (e) { console.error('FAILED:', e); ok = false; }
finally {
  try {
    const cocoons = await sql`SELECT c.id FROM document_cocoons c JOIN tenants t ON t.id=c.tenant_id
      WHERE t.slug='foundation' AND c.name LIKE 'Screen capture — %' AND c.created_at >= ${runStart}`;
    const cids = cocoons.map((c: { id: string }) => c.id);
    if (cids.length) {
      const aids = (await sql`SELECT id FROM library_atoms WHERE cocoon_id = ANY(${cids}::uuid[])`).map((r: { id: string }) => r.id);
      if (aids.length) {
        await sql`DELETE FROM atom_members WHERE group_atom_id = ANY(${aids}::uuid[]) OR member_atom_id = ANY(${aids}::uuid[])`;
        await sql`DELETE FROM atom_tags WHERE atom_id = ANY(${aids}::uuid[])`;
        await sql`DELETE FROM library_atoms WHERE id = ANY(${aids}::uuid[])`;
      }
      await sql`DELETE FROM document_cocoons WHERE id = ANY(${cids}::uuid[])`;
      console.log(`  🧹 cleaned ${aids.length} atom(s) + ${cids.length} cocoon(s)`);
    }
  } catch (e) { console.error('  cleanup warning:', e instanceof Error ? e.message : e); }
  await b.close(); await sql.end({ timeout: 5 });
}
console.log(ok ? '\nPASS — the machine proposes regions, the human confirms, and they become draft image atoms' : '\nFAIL');
process.exit(ok ? 0 : 1);
