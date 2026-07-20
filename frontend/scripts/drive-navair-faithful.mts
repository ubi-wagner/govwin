/**
 * FAITHFUL end-to-end re-run — every step through the platform's REAL cores (the exact
 * code the UI routes wrap), no direct-SQL short-circuits. Step A: the real atomizer.
 *
 *   cd frontend && DATABASE_URL=… node --import tsx scripts/drive-navair-faithful.mts A
 */
import { sql, getTenantBySlug } from '@/lib/db';
import { atomizeDocumentIntoLibrary, contextTags } from '@/lib/atomize-package';
import { withTenant } from '@/lib/rls';
import { readFileSync } from 'node:fs';

const U = '/root/.claude/uploads/34d597b2-183f-5787-9057-fc7251e3f9ff';
const FILES = [
  ['a41873cf-Navy_SBIR__GHOST__Draft.docx', 'Navy SBIR GHOST Draft.docx'],
  ['5c5b66e4-TACFI_IMM_Vol_2_Technical_Volume_2_Oct_2025.pdf', 'TACFI IMM Vol 2 Technical Volume.pdf'],
  ['9a35c6d0-5_5_AA_BT_Resumes_Merged_P.pdf', 'Immobileyes Key Personnel Resumes.pdf'],
  ['588f787c-TACFI_foreignAffiliations_Immobileyes.pdf', 'TACFI Foreign Affiliations.pdf'],
  ['08936ff0-Vol3_IMM_TACFI_Cost_Proposal_SUBMIT.pdf', 'TACFI Cost Proposal.pdf'],
];

let fail = 0;
const ok = (l: string, c: boolean, x = '') => { console.log(`${c ? '✓' : '✗ FAIL'} ${l}${x ? ' — ' + x : ''}`); if (!c) fail++; };

try {
  const tenant = await getTenantBySlug('immobileyes');
  const [usr] = await sql<{ id: string }[]>`SELECT id FROM users WHERE email = 'admin@immobileyes.test' LIMIT 1`;
  ok('tenant + admin', !!tenant && !!usr, tenant?.id);

  // Clear the prior hand-authored 'upload' atoms so this is a clean, genuine atomize.
  await withTenant(tenant!.id, async (tx: any) => {
    await tx`DELETE FROM library_atoms WHERE tenant_id = ${tenant!.id}::uuid AND source IN ('upload','harvest')`;
  });

  const ctx = { agency: 'Navy', program: 'sbir', phase: 'phase_1', sol: 'DON26BX03', topic: 'DON26BX03-NP002' };
  const ctxTags = contextTags(ctx);
  const actor = { id: usr.id, kind: 'admin' as const };

  let totalAtoms = 0;
  for (const [fn, name] of FILES) {
    try {
      const buffer = readFileSync(`${U}/${fn}`);
      const r = await atomizeDocumentIntoLibrary(tenant!.id, { buffer, filename: name, packageName: 'Immobileyes DON26BX03-NP002 package', ctxTags, actor });
      const n = (r as any)?.atomCount ?? (r as any)?.atoms ?? 0;
      totalAtoms += n;
      console.log(`   • ${name}: ${JSON.stringify(r)}`);
    } catch (e) {
      console.log(`   ✗ ${name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Report what the REAL atomizer produced (grains + cocoons + tag dimensions).
  const grains = await sql<{ grain: string; n: number }[]>`
    SELECT grain, count(*)::int n FROM library_atoms WHERE tenant_id = ${tenant!.id}::uuid GROUP BY grain ORDER BY grain`;
  const [{ cocoons }] = await sql<{ cocoons: number }[]>`SELECT count(*)::int cocoons FROM document_cocoons WHERE tenant_id = ${tenant!.id}::uuid`.catch(() => [{ cocoons: 0 }] as any);
  const dims = await sql<{ dimension: string; n: number }[]>`
    SELECT t.dimension, count(*)::int n FROM atom_tags t JOIN library_atoms a ON a.id = t.atom_id
    WHERE a.tenant_id = ${tenant!.id}::uuid GROUP BY t.dimension ORDER BY n DESC`;
  console.log('\nGRAINS:', grains.map((g) => `${g.grain}=${g.n}`).join(' '));
  console.log('COCOONS:', cocoons);
  console.log('TAG DIMS:', dims.map((d) => `${d.dimension}=${d.n}`).join(' '));
  ok('real atomizer produced reference + primitive atoms', grains.some((g) => g.grain === 'reference') && grains.some((g) => g.grain === 'primitive'));
} finally {
  await sql.end();
}
console.log(`\n${fail === 0 ? '✅ STEP A GREEN — real atomizer' : `❌ ${fail} FAILED`}`);
process.exit(fail === 0 ? 0 : 1);
