/** Proves FIX-INSERT-1's data path: selectForSection now returns an image atom's canvas_nodes, so a
 *  boxed figure/table can insert into a section (not just its OCR text). Creates a temp APPROVED image
 *  atom, selects it, asserts the image node is present, cleans up. No server.
 *  cd frontend && DATABASE_URL=… node --import tsx scripts/verify-insert-fidelity.mts */
import postgres from 'postgres';
import { createAtom, selectForSection } from '@/lib/atoms';

const sql = postgres(process.env.DATABASE_URL || 'postgresql://govtech:changeme@localhost:5432/govtech_intel', { max: 2 });
let ok = true; const A = (l: string, c: boolean, x = '') => { console.log(`${c ? '✓' : '✗'} ${l}${x ? ` — ${x}` : ''}`); ok = ok && c; };
let atomId = '';
try {
  const [ten] = await sql<Array<{ id: string }>>`SELECT id FROM tenants WHERE slug='foundation'`;
  const [usr] = await sql<Array<{ id: string }>>`SELECT id FROM users WHERE email='kate.ulepic@foundation3dp.com'`;

  const imageNode = { id: 'img_fidelity_test', type: 'image', content: { storage_key: 'customers/foundation/images/_fidelity.png', alt_text: 'boxed cost table', width: 800, height: 600 }, style: {}, provenance: { source: 'imported' }, history: [], library_eligible: true };
  const made = await createAtom(ten.id, {
    grain: 'primitive', title: 'ZZFIDELITY boxed cost table', content: 'Direct Labor 59200 TOTAL 71600', // OCR text
    canvasNodes: [imageNode as never], summary: 'test', source: 'upload', status: 'approved', // approved → selectable
    tags: [{ dimension: 'kind', value: 'figure', source: 'auto', confirmed: true }, { dimension: 'vol', value: 'technical', source: 'auto', confirmed: true }],
  }, { id: usr.id, kind: 'admin' });
  atomId = made.atomId;
  A('created a temp approved image atom', !!atomId);

  const ranked = await selectForSection(ten.id, { kinds: ['figure'], limit: 50 }, { userId: usr.id, isAdmin: true });
  const found = ranked.find((r) => r.id === atomId);
  A('selectForSection returns the image atom', !!found);
  A('…and it carries canvasNodes (the image node travels for insert)', Array.isArray(found?.canvasNodes) && found!.canvasNodes!.length > 0, `nodes=${found?.canvasNodes?.length ?? 0}`);
  const n = found?.canvasNodes?.[0] as { type?: string; content?: { storage_key?: string } } | undefined;
  A('…the node is an image with its storage_key (survives → renders + exports)', n?.type === 'image' && !!n?.content?.storage_key, n?.content?.storage_key || 'none');
} catch (e) { console.error('FAILED:', e); ok = false; }
finally {
  if (atomId) { try { await sql`DELETE FROM atom_tags WHERE atom_id = ${atomId}::uuid`; await sql`DELETE FROM library_atoms WHERE id = ${atomId}::uuid`; console.log('  🧹 cleaned temp atom'); } catch { /* ignore */ } }
  await sql.end({ timeout: 5 });
}
console.log(ok ? '\nPASS — image atoms carry their canvas nodes through selectForSection (insertable, not text-only)' : '\nFAIL');
process.exit(ok ? 0 : 1);
