/**
 * #18 branch-and-promote — the PROMOTE leg.
 *
 * Full lock for download: mark the document 'final' and promote its WORKING copies to new
 * FOUNDATION atoms (status draft→approved, source manual→download_derivative). The
 * derived_from lineage to the seminal atoms was written when the working copies were made,
 * so the new foundation atoms carry it forward — you can always trace a locked document's
 * atoms back to the seminal proposal. The seminal originals are never touched
 * (non-destructive). Idempotent: re-locking promotes any still-draft working copies.
 */
import { withTenant } from '@/lib/rls';

export async function lockDocumentAndPromote(
  tenantId: string,
  documentId: string,
): Promise<{ locked: boolean; promoted: number }> {
  const [doc] = await withTenant<Array<{ id: string }>>(tenantId, async (tx) =>
    tx`UPDATE tenant_documents SET status = 'final', updated_at = now()
       WHERE id = ${documentId}::uuid AND tenant_id = ${tenantId}::uuid
       RETURNING id`);
  if (!doc) return { locked: false, promoted: 0 };

  const promoted = await withTenant<Array<{ id: string }>>(tenantId, async (tx) =>
    tx`UPDATE library_atoms
       SET status = 'approved', source = 'download_derivative', updated_at = now()
       WHERE tenant_id = ${tenantId}::uuid AND status = 'draft' AND source = 'manual'
         AND cocoon_id IN (
           SELECT id FROM document_cocoons
           WHERE tenant_id = ${tenantId}::uuid AND origin_document_id = ${documentId}::uuid
         )
       RETURNING id`);
  return { locked: true, promoted: promoted.length };
}
