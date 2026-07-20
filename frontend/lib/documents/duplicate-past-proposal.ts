/**
 * #18 branch-and-promote — the DUPLICATE leg.
 *
 * When a customer REGENs a fresh draft from a template that was templified from a past
 * proposal, we branch: the seminal atoms are COPIED into WORKING draft atoms bound to the
 * new document (a working document_cocoon, origin_document_id=<doc>), each with
 * derived_from lineage back to its seminal atom. These working copies are what the team
 * mutates and collaborates on. The seminal originals are untouched (non-destructive).
 * On FULL LOCK for download, the working copies are promoted to new FOUNDATION atoms
 * (see lockDocumentAndPromote). Best-effort — never fail document creation on a copy error.
 */
import { withTenant } from '@/lib/rls';
import { createAtom, type AtomTagInput } from '@/lib/atoms';
import type { CanvasNode } from '@/lib/types/canvas-document';

interface SeminalAtom { id: string; title: string | null; content: string | null; canvasNodes: CanvasNode[] | null }

export async function duplicatePastProposalAtoms(
  tenantId: string,
  documentId: string,
  templateId: string,
  actor: { id: string; kind: 'admin' | 'collaborator' | 'ai' },
): Promise<{ workingCocoonId: string; copied: number; seminalCocoonId: string } | null> {
  // Only branch when the template descends from a past proposal.
  const [tpl] = await withTenant<Array<{ name: string | null; cocoon: string | null }>>(tenantId, async (tx) =>
    tx`SELECT name, metadata->>'templifiedFromCocoon' AS cocoon
       FROM document_templates WHERE id = ${templateId}::uuid AND tenant_id = ${tenantId}::uuid LIMIT 1`);
  const seminalCocoonId = tpl?.cocoon ?? null;
  if (!seminalCocoonId) return null;

  const seminal = await withTenant<SeminalAtom[]>(tenantId, async (tx) =>
    tx`SELECT id, title, content, canvas_nodes AS "canvasNodes"
       FROM library_atoms
       WHERE cocoon_id = ${seminalCocoonId}::uuid AND tenant_id = ${tenantId}::uuid
         AND grain = 'primitive' AND status <> 'archived'
       ORDER BY NULLIF(regexp_replace(COALESCE(source_anchor->0->'blockIds'->>0, ''), '[^0-9]', '', 'g'), '')::int NULLS LAST,
                created_at ASC`);
  if (seminal.length === 0) return null;

  // A working document universe bound to the new document (source 'download' per the
  // cocoon CHECK; the branch is identified by origin_document_id + its draft atoms).
  const [wc] = await withTenant<Array<{ id: string }>>(tenantId, async (tx) =>
    tx`INSERT INTO document_cocoons (tenant_id, name, scope, source, origin_document_id)
       VALUES (${tenantId}::uuid, ${`${tpl?.name ?? 'Draft'} — working draft`}, 'document', 'download', ${documentId}::uuid)
       RETURNING id`);
  const workingCocoonId = wc.id;

  let copied = 0;
  for (const a of seminal) {
    try {
      const tags: AtomTagInput[] = [{ dimension: 'kind', value: 'narrative', source: 'auto', confirmed: true }];
      await createAtom(
        tenantId,
        {
          grain: 'primitive',
          title: a.title,
          content: a.content,
          canvasNodes: a.canvasNodes ?? null,
          summary: 'Working copy — regenerated from a past proposal',
          source: 'manual',        // a mutable working draft (not yet a foundation atom)
          status: 'draft',
          cocoonId: workingCocoonId,
          parentAtomIds: [a.id],   // derived_from lineage → the seminal atom
          tags,
        },
        { id: actor.id, kind: actor.kind },
      );
      copied++;
    } catch (e) {
      console.error('[duplicate-past-proposal] working-copy create failed:', e);
    }
  }
  return { workingCocoonId, copied, seminalCocoonId };
}
