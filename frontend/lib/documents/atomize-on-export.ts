/**
 * Atomize-on-download for standalone tenant documents (template bridge Phase 2,
 * docs/TEMPLATE_BRIDGE_DESIGN.md).
 *
 * "On download is a good trigger, just like the proposal artifacts": the FIRST
 * time a tenant exports a standalone document, its filled canvas is decomposed
 * into the tenant library (foundation → sections → groups → primitives), so the
 * content it just produced becomes reusable — the same value the proposal package
 * export already delivers.
 *
 * Once-only + idempotent: a compare-and-swap on tenant_documents.atomized_at
 * (mig 178) claims the slot, so re-exporting the same document never duplicates
 * its atoms, and two concurrent exports can't both atomize. Best-effort — a
 * failure never blocks the download (the caller ignores a thrown error).
 */
import { sql } from '@/lib/db';
import { decomposeAndIngest } from '@/lib/library/foundation';
import { toSections, type CanvasDocument, type CanvasFormat } from '@/lib/types/canvas-document';
import type { ArtifactForm } from '@/lib/library/artifact-canvas';
import { emitEventSingle, userActor, systemActor } from '@/lib/events';

/** Canvas format → the library's coarse artifact form (pdf is an export target, never a canvas format). */
function formToArtifact(format: CanvasFormat | undefined): ArtifactForm {
  switch (format) {
    case 'slide_16_9':
    case 'slide_4_3': return 'ppt';
    case 'spreadsheet': return 'sheet';
    default: return 'doc'; // letter | custom | undefined
  }
}

export interface AtomizeOnExportResult {
  atomized: boolean;             // false when the doc was already atomized (or the CAS lost)
  foundationId?: string;
  sections?: number;
  atoms?: number;
}

/**
 * Decompose a standalone document into the tenant library on its first export.
 * Returns { atomized: false } when the doc was already atomized (idempotent no-op).
 */
export async function atomizeDocumentOnExport(
  tenantId: string,
  documentId: string,
  doc: CanvasDocument,
  actor: { id: string; email?: string | null },
): Promise<AtomizeOnExportResult> {
  // CAS-claim the once-only slot: only the first export past this point atomizes.
  const claimed = await sql<Array<{ id: string; title: string }>>`
    UPDATE tenant_documents
       SET atomized_at = now()
     WHERE id = ${documentId}::uuid AND tenant_id = ${tenantId}::uuid AND atomized_at IS NULL
    RETURNING id, title
  `;
  if (claimed.length === 0) return { atomized: false };
  const title = doc.metadata?.title || claimed[0].title || 'Document';

  try {
    const form = formToArtifact(doc.canvas?.format);
    const sectioned: CanvasDocument = { ...doc, sections: toSections(doc) };
    const decomposed = await decomposeAndIngest(
      tenantId,
      sectioned,
      { title, slug: documentId, form, kind: 'document', context: 'general' },
      { id: actor.id },
    );

    // Link the doc to its minted foundation (a future re-export can redecompose in place).
    try {
      await sql`UPDATE tenant_documents SET library_foundation_id = ${decomposed.foundationId}::uuid
                WHERE id = ${documentId}::uuid AND tenant_id = ${tenantId}::uuid`;
    } catch (e) { console.error('[atomize-on-export] foundation link failed (non-fatal)', e); }

    try {
      await emitEventSingle({
        namespace: 'library',
        type: 'document.atomized',
        actor: actor.id ? userActor(actor.id, actor.email ?? undefined) : systemActor('atomize-on-export'),
        tenantId,
        payload: { documentId, foundationId: decomposed.foundationId, sections: decomposed.sectionIds.length, atoms: decomposed.atomIds.length, trigger: 'export' },
      });
    } catch (e) { console.error('[atomize-on-export] event emit failed (non-fatal)', e); }

    return { atomized: true, foundationId: decomposed.foundationId, sections: decomposed.sectionIds.length, atoms: decomposed.atomIds.length };
  } catch (e) {
    // The slot is already claimed (atomized_at set) so we don't loop; surface the failure loudly.
    console.error('[atomize-on-export] decompose failed after claim', documentId, e);
    return { atomized: false };
  }
}
