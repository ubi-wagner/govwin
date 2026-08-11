/** Proves the enrich step: a boxed TEXT image → OCR → the image atom's content/summary carry the
 *  extracted text (DB-proven), so it's searchable + machine-legible. No server/build; real OCR +
 *  real DB, fake store (no S3). cd frontend && DATABASE_URL=… node --import tsx scripts/verify-atom-enrich.mts */
import { chromium } from 'playwright';
import postgres from 'postgres';
import { randomUUID } from 'crypto';
import { atomizeCaptureIntoLibrary } from '@/lib/atomize-capture';

const DBURL = process.env.DATABASE_URL || 'postgresql://govtech:changeme@localhost:5432/govtech_intel';
const sql = postgres(DBURL, { max: 2 });
let ok = true; const A = (l: string, c: boolean, x = '') => { console.log(`${c ? '✓' : '✗'} ${l}${x ? ` — ${x}` : ''}`); ok = ok && c; };
const runStart = new Date();

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
try {
  // A text-bearing crop (what a boxed cost table looks like).
  const g = await (await b.newContext({ viewport: { width: 760, height: 260 } })).newPage();
  await g.setContent(`<body style="margin:0;background:#fff"><div style="font:bold 38px Arial;color:#111;padding:40px;line-height:1.5">Cost Volume Summary<br>Direct Labor 59200 Materials 12400 TOTAL 71600</div></body>`, { waitUntil: 'networkidle' });
  const png = await g.screenshot();
  await b.close();

  const [ten] = await sql`SELECT id FROM tenants WHERE slug='foundation'`;
  const [usr] = await sql`SELECT id FROM users WHERE email='kate.ulepic@foundation3dp.com'`;
  A('found foundation tenant + user', !!ten && !!usr);

  const fakeStore = async () => ({ key: `customers/foundation/images/enrich-${randomUUID()}.png` });
  const result = await atomizeCaptureIntoLibrary(
    ten.id, 'foundation',
    { regions: [{ buffer: png, contentType: 'image/png', title: 'Boxed cost table', tags: [] }], ctxTags: [], actor: { id: usr.id, kind: 'admin' } },
    { store: fakeStore }, // real enrich (OCR); fake store (no S3)
  );
  A('1 region atom created', result.atoms === 1, `atoms=${result.atoms}`);

  const [atom] = await sql`SELECT content, summary, word_count FROM library_atoms WHERE id = ${result.regionIds[0]}::uuid`;
  const content = (atom?.content ?? '') as string;
  console.log(`  content: ${JSON.stringify(content.slice(0, 120))}`);
  A('OCR text landed in content (machine-legible)', /59200/.test(content) && /71600/.test(content) && /labor/i.test(content), content.slice(0, 60));
  A('summary carries an OCR snippet (human-searchable)', /Labor|Cost Volume/i.test((atom?.summary ?? '') as string));
  A('word_count reflects the extracted text (was 0 for a bare image)', Number(atom?.word_count) > 3, `words=${atom?.word_count}`); // raw conn = snake_case
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
  await b.close().catch(() => {}); await sql.end({ timeout: 5 });
}
console.log(ok ? '\nPASS — a boxed text image is OCR-enriched: its text lands in the atom (searchable + machine-legible)' : '\nFAIL');
process.exit(ok ? 0 : 1);
