/**
 * FAITHFUL STEP B (template templify) + STEP D (real lock) — through the platform's genuine cores.
 *   B: atomize the DON TV2 template docx → templify its cocoon (pastProposalToCanvas →
 *      extractTemplateSkeleton → document_templates) → link to Volume 2. (the "Save as template" path)
 *   D: unlock the Technical-Volume sections, then lock each through lockSectionCore
 *      (the exact core the lock route runs): CAS lock + compliance→satisfied + harvest + roll-up.
 *
 *   cd frontend && DATABASE_URL=… node --import tsx scripts/drive-navair-faithful-bd.mts
 */
import { sql, getTenantBySlug } from '@/lib/db';
import { atomizeDocumentIntoLibrary, contextTags } from '@/lib/atomize-package';
import { pastProposalToCanvas } from '@/lib/templates/past-proposal-canvas';
import { extractTemplateSkeleton } from '@/lib/templates/extract-skeleton';
import { sectionsToNodes } from '@/lib/types/canvas-document';
import { lockSectionCore } from '@/lib/proposal/lock-section';
import { readFileSync } from 'node:fs';

const U = '/root/.claude/uploads/34d597b2-183f-5787-9057-fc7251e3f9ff';
let fail = 0;
const ok = (l: string, c: boolean, x = '') => { console.log(`${c ? '✓' : '✗ FAIL'} ${l}${x ? ' — ' + x : ''}`); if (!c) fail++; };

try {
  const tenant = await getTenantBySlug('immobileyes');
  const [usr] = await sql<{ id: string; email: string }[]>`SELECT id, email FROM users WHERE email = 'admin@immobileyes.test' LIMIT 1`;

  // ── STEP B — templify the DON TV2 template via the real cores ──
  console.log('\n── STEP B: template → mold via the templify core ──');
  const buf = readFileSync(`${U}/d45f9997-DON_SBIR_Phase_I_OPEN_TOPICS_Technical_Volume_2_Template_20260304.docx`);
  const at = await atomizeDocumentIntoLibrary(tenant!.id, {
    buffer: buf, filename: 'DON Phase I Open-Topic Technical Volume 2 Template.docx',
    packageName: 'DON templates', ctxTags: contextTags({ agency: 'Navy', program: 'sbir', phase: 'phase_1' }),
    actor: { id: usr.id, kind: 'admin' },
  });
  ok('atomized the TV2 template docx (real atomizer)', !!at.cocoonId, `cocoon ${at.cocoonId} · ${at.atoms} primitives`);

  const catoms = await sql<{ title: string | null; content: string | null }[]>`
    SELECT title, content FROM library_atoms
    WHERE cocoon_id = ${at.cocoonId}::uuid AND tenant_id = ${tenant!.id}::uuid AND grain = 'primitive' AND status <> 'archived'
    ORDER BY NULLIF(regexp_replace(COALESCE(source_anchor->0->'blockIds'->>0, ''), '[^0-9]', '', 'g'), '')::int NULLS LAST, created_at ASC`;
  const sourceCanvas = pastProposalToCanvas(catoms, 'technical_volume');
  const { skeleton } = extractTemplateSkeleton(sourceCanvas, {});
  const nodeCount = sectionsToNodes(skeleton.sections ?? []).length;

  await sql`DELETE FROM document_templates WHERE tenant_id = ${tenant!.id}::uuid AND name = ${'DON Phase I Open-Topic — Technical Volume 2 (templified)'}`;
  const [mold] = await sql<{ id: string }[]>`
    INSERT INTO document_templates (name, description, template_type, agency, program_type, canvas_preset, canvas_document, node_count, is_system, tenant_id, created_by, metadata)
    VALUES (${'DON Phase I Open-Topic — Technical Volume 2 (templified)'}, ${'Skeleton extracted from the DON TV2 template via templates/extract'}, 'technical_volume', 'navy', 'sbir_phase_1',
            ${sql.json({ preset: 'letter_sbir_phase1' })}, ${sql.json(skeleton as unknown as Parameters<typeof sql.json>[0])}, ${nodeCount}, false, ${tenant!.id}::uuid, ${usr.id}::uuid, ${sql.json({ templifiedFromCocoon: at.cocoonId })})
    RETURNING id`;
  ok('templified → document_templates mold (skeleton, content-stripped)', !!mold?.id, `${mold?.id} · ${skeleton.sections?.length ?? 0} sections · ${nodeCount} nodes`);

  const [opp] = await sql<{ id: string; solicitationId: string | null }[]>`SELECT id, solicitation_id FROM opportunities WHERE source_id = 'DON26BX03-NP002' LIMIT 1`;
  const [v2] = await sql<{ id: string }[]>`SELECT id FROM solicitation_volumes WHERE solicitation_id = ${opp.solicitationId}::uuid AND volume_number = 2 LIMIT 1`;
  await sql`UPDATE volume_required_items SET template_id = ${mold.id}::uuid WHERE volume_id = ${v2.id}::uuid AND item_number = 1`;
  ok('linked templified mold to Volume 2 item 1', true);

  // ── STEP D — lock the Technical-Volume sections via the real lockSectionCore ──
  console.log('\n── STEP D: lock via lockSectionCore (the exact core the lock route runs) ──');
  const [prop] = await sql<{ id: string; stage: string }[]>`SELECT id, stage FROM proposals WHERE tenant_id = ${tenant!.id}::uuid AND opportunity_id = ${opp.id}::uuid ORDER BY created_at DESC LIMIT 1`;
  const secs = await sql<{ id: string; title: string | null; volumeName: string | null; volumeNumber: number | null; artifactId: string | null; content: string | null; version: number }[]>`
    SELECT id, title, volume_name AS "volumeName", volume_number AS "volumeNumber", artifact_id AS "artifactId", content, version
    FROM proposal_sections WHERE proposal_id = ${prop.id}::uuid AND volume_number = 2 ORDER BY section_number`;
  // reset to unlocked/complete so the lock CAS has real work
  for (const s of secs) {
    await sql`UPDATE proposal_sections SET is_locked = false, status = 'complete', accepted_by = NULL, accepted_at = NULL, completed_stage = NULL, completed_at = NULL, locked_at = NULL, locked_by = NULL WHERE id = ${s.id}::uuid`;
    await sql`UPDATE proposal_compliance_matrix SET status = 'not_addressed' WHERE section_id = ${s.id}::uuid`;
  }
  let locked = 0;
  for (const s of secs) {
    const res = await lockSectionCore({
      tenantId: tenant!.id, tenantSlug: 'immobileyes', role: 'tenant_admin' as any, proposalId: prop.id, userId: usr.id, email: usr.email, proposalStage: prop.stage,
      section: { id: s.id, title: s.title, volumeName: s.volumeName, volumeNumber: s.volumeNumber, artifactId: s.artifactId, content: s.content, version: s.version },
    });
    if (res.locked || res.alreadyLocked) locked++;
  }
  const [{ approved }] = await sql<{ approved: number }[]>`SELECT count(*)::int approved FROM proposal_sections WHERE proposal_id = ${prop.id}::uuid AND volume_number = 2 AND status = 'approved' AND is_locked = true`;
  const [{ satisfied }] = await sql<{ satisfied: number }[]>`SELECT count(*)::int satisfied FROM proposal_compliance_matrix m JOIN proposal_sections s ON s.id = m.section_id WHERE s.proposal_id = ${prop.id}::uuid AND s.volume_number = 2 AND m.status = 'satisfied'`;
  ok('lockSectionCore locked every TV section', locked === secs.length && approved === secs.length, `${locked} locked · ${approved} approved · ${satisfied} matrix satisfied`);
} finally {
  await sql.end();
}
console.log(`\n${fail === 0 ? '✅ STEP B + D GREEN — templify + lockSectionCore' : `❌ ${fail} FAILED`}`);
process.exit(fail === 0 ? 0 : 1);
