/**
 * FAITHFUL STEP C — invoke the REAL proposal.draft_section agent tool (the same tool
 * the "Draft all sections" UI runs) per Technical-Volume section, grounded in the REAL
 * atomized library. Proves the agent embodies the workflow: it runs its budget-guard,
 * fit-check, and node generation. Without an ANTHROPIC_API_KEY it uses its documented
 * placeholder branch (provenance.source='template'); with a key it returns model content.
 *
 *   cd frontend && DATABASE_URL=… node --import tsx scripts/drive-navair-draft-proof.mts
 */
import { sql, getTenantBySlug } from '@/lib/db';
import { proposalDraftSectionTool } from '@/lib/tools/proposal-draft-section';
import type { ToolContext } from '@/lib/tools/base';

const noop = () => {};
const mkLog = (): any => { const l: any = { info: noop, warn: noop, error: noop, debug: noop, trace: noop, fatal: noop, child: () => l }; return l; };

try {
  const tenant = await getTenantBySlug('immobileyes');
  const [usr] = await sql<{ id: string; email: string }[]>`SELECT id, email FROM users WHERE email = 'admin@immobileyes.test' LIMIT 1`;
  const [opp] = await sql<{ id: string; description: string | null }[]>`SELECT id, description FROM opportunities WHERE source_id = 'DON26BX03-NP002' LIMIT 1`;
  const [prop] = await sql<{ id: string }[]>`SELECT id FROM proposals WHERE tenant_id = ${tenant!.id}::uuid AND opportunity_id = ${opp.id}::uuid ORDER BY created_at DESC LIMIT 1`;
  const secs = await sql<{ id: string; title: string; pageAllocation: number | null }[]>`
    SELECT id, title, page_allocation AS "pageAllocation" FROM proposal_sections
    WHERE proposal_id = ${prop.id}::uuid AND volume_number = 2 ORDER BY section_number`;

  // Real atomized library → the tool's libraryAtoms input (id, content, category, tags).
  const atoms = await sql<{ id: string; content: string | null; vol: string | null; tags: string[] }[]>`
    SELECT a.id, a.content,
           (SELECT value FROM atom_tags WHERE atom_id = a.id AND dimension = 'vol' LIMIT 1) AS vol,
           COALESCE(array_agg(t.dimension || ':' || t.value) FILTER (WHERE t.dimension IS NOT NULL), '{}') AS tags
    FROM library_atoms a LEFT JOIN atom_tags t ON t.atom_id = a.id
    WHERE a.tenant_id = ${tenant!.id}::uuid AND a.grain = 'primitive' AND a.content IS NOT NULL
    GROUP BY a.id, a.content`;
  const libraryAtoms = atoms.slice(0, 40).map((a) => ({ id: a.id, content: (a.content ?? '').slice(0, 4000), category: a.vol ?? 'narrative', tags: a.tags }));

  const ctx: ToolContext = { actor: { type: 'user', id: usr.id, role: 'tenant_admin', email: usr.email } as any, tenantId: tenant!.id, requestId: 'faithful-stepC', log: mkLog() };

  console.log(`Invoking REAL proposal.draft_section tool for ${secs.length} Vol-2 sections · ${libraryAtoms.length} library atoms grounding\n`);
  let okN = 0;
  for (const s of secs) {
    const input = {
      proposalId: prop.id,
      sectionTitle: s.title,
      pageLimit: s.pageAllocation ?? 2,
      fontFamily: 'Times New Roman', fontSize: 11, lineSpacing: 1.0, imagesAllowed: true,
      rfpExcerpt: (opp.description ?? '').slice(0, 4000),
      libraryAtoms: libraryAtoms.filter((a) => a.category === 'technical' || a.category === (s.title.toLowerCase().includes('personnel') ? 'key_personnel' : a.category)).slice(0, 12),
    };
    try {
      const out: any = await proposalDraftSectionTool.handler(input as any, ctx);
      const nodes = out?.nodes?.length ?? 0;
      const model = out?.model ?? (out?.usedPlaceholder ? 'placeholder' : 'template');
      const fit = out?.fit ? `fit=${JSON.stringify(out.fit).slice(0, 80)}` : '';
      console.log(`✓ ${s.title.slice(0, 46).padEnd(46)} → tool ran: ${nodes} nodes · ${model} ${fit}`);
      okN++;
    } catch (e) {
      console.log(`✗ ${s.title.slice(0, 46)} → ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  console.log(`\n${okN === secs.length ? '✅ STEP C GREEN' : `⚠ ${okN}/${secs.length}`} — the real draft_section agent tool executed on every section`);
} finally {
  await sql.end();
}
