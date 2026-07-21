/**
 * Drive-test the capture → annotate → atomize core against a real tenant.
 *   DATABASE_URL=... npx tsx scripts/drive-capture.mts
 * Loads a fake "screenshot" frame + 2 boxed region crops, runs the core, and asserts
 * draft image atoms + a section group landed in library_atoms.
 */
import fs from 'fs';
import { atomizeCaptureIntoLibrary } from '@/lib/atomize-capture';
import { contextTags } from '@/lib/atomize-package';
import { getTenantBySlug, sql } from '@/lib/db';

const DIR = `${process.cwd()}/../scratchpad/capture`;
const img = (n: string) => ({ buffer: fs.readFileSync(`${DIR}/${n}`), contentType: 'image/png' });

const tenant = await getTenantBySlug('immobileyes');
if (!tenant) { console.error('no immobileyes tenant'); process.exit(1); }
const tenantId = tenant.id as string;
console.log('tenant', tenantId);

const before = await sql`SELECT count(*)::int n FROM library_atoms WHERE tenant_id=${tenantId}`;

// Object storage (R2) is unreachable from this sandbox; stub the blob write to a local
// file so the ATOM logic (the part we authored) is exercised end-to-end. In prod the
// default store (putObject → R2) runs unchanged.
let stored = 0;
const stubStore = async (_slug: string, img: { buffer: Buffer; contentType: string }) => {
  const key = `customers/immobileyes/images/capture-stub-${stored++}.png`;
  fs.mkdirSync('/tmp/capture-blobs', { recursive: true });
  fs.writeFileSync(`/tmp/capture-blobs/${key.split('/').pop()}`, img.buffer);
  return { key };
};

const res = await atomizeCaptureIntoLibrary(tenantId, 'immobileyes', {
  full: img('frame.png'),
  regions: [
    { ...img('region0.png'), title: 'GHOST past-performance blurb', tags: [{ dimension: 'vol', value: 'past_performance', source: 'admin', confirmed: true }] },
    { ...img('region1.png'), title: 'Team bio — Dr. Taheri', tags: [{ dimension: 'kind', value: 'bio', source: 'admin', confirmed: true }] },
  ],
  sourceUrl: 'https://docs.google.com/document/d/EXAMPLE/edit',
  note: 'Captured from a Google Doc for the C-UAS proposal',
  groupName: 'GHOST capture — team & past performance',
  ctxTags: contextTags({ agency: 'Navy', program: 'SBIR', phase: '1' }),
  actor: { id: 'ae7a66e5-89dd-48a5-8af8-f10da3d76cd2', kind: 'admin' },
}, { store: stubStore });

console.log('result:', JSON.stringify(res, null, 2));

// Assertions
const [ref] = await sql`SELECT grain, status, title, source, canvas_nodes FROM library_atoms WHERE id=${res.referenceId}`;
const regions = await sql`SELECT id, grain, status, title, summary FROM library_atoms WHERE id = ANY(${res.regionIds})`;
const [grp] = res.groupId ? await sql`SELECT grain, status, title FROM library_atoms WHERE id=${res.groupId}` : [null];
const after = await sql`SELECT count(*)::int n FROM library_atoms WHERE tenant_id=${tenantId}`;

const node = (ref?.canvasNodes ?? ref?.canvas_nodes ?? [])[0]; // @/lib/db camelCases columns
console.log('\n── ASSERTIONS ──');
console.log('reference:', ref?.grain, ref?.status, '| image storage_key:', node?.content?.storage_key?.slice(0, 40));
regions.forEach((r: any) => console.log('region:', r.grain, r.status, '|', r.title, '| prov:', (r.summary || '').slice(0, 50)));
console.log('group:', grp?.grain, grp?.status, '|', grp?.title);
console.log('atoms delta:', after[0].n - before[0].n, '(expect 4: 1 ref + 2 regions + 1 group)');

const ok = ref?.grain === 'reference' && ref?.status === 'draft' && regions.length === 2 &&
  regions.every((r: any) => r.grain === 'primitive' && r.status === 'draft') &&
  grp?.grain === 'group' && node?.content?.storage_key;
console.log(ok ? '\n✅ CAPTURE CORE OK' : '\n❌ CAPTURE CORE FAILED');
await sql.end();
process.exit(ok ? 0 : 1);
