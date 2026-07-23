/**
 * "Eat our own cooking" — in the RIGHT native format. Each house artifact is
 * produced as a real CanvasDocument in its natural type (see artifact-canvas.ts for
 * the pure builders) and landed in the library as a canvas-backed atom; renderCanvas
 * then exports its real file (.docx / .xlsx / .pptx / .pdf).
 */
import { createAtom } from '@/lib/atoms';
import type { CanvasDocument } from '@/lib/types/canvas-document';
import type { ExportFormat } from '@/lib/export/artifact-export';
import { HOUSE_COLLECTION } from '@/lib/library/house-docs';
import {
  ARTIFACT_FORMAT, sectionsToCanvasDoc, tableToCanvasSheet, flattenNodes, type Section,
} from '@/lib/library/artifact-canvas';

export { ARTIFACT_FORMAT, sectionsToCanvasDoc, tableToCanvasSheet, flattenNodes };
export type { Section };

/** Land a native-format CanvasDocument in a tenant's library as a canvas atom,
 *  tagged (collection=house_library, kind=<kind>, format=<docx|xlsx|pptx|pdf>). */
export async function ingestHouseArtifact(
  tenantId: string,
  meta: { title: string; slug: string; kind: 'doc' | 'sheet' | 'deck' | 'pdf' },
  doc: CanvasDocument,
  actor: { id: string },
): Promise<{ atomId: string; format: ExportFormat }> {
  const format = ARTIFACT_FORMAT[meta.kind];
  const { atomId } = await createAtom(tenantId, {
    grain: 'group',
    title: meta.title,
    content: null,
    canvasNodes: flattenNodes(doc),
    summary: `House ${meta.kind} → ${format}`,
    source: 'manual',
    creatorKind: 'admin',
    visibility: 'tenant',
    status: 'approved',
    tags: [
      { dimension: 'collection', value: HOUSE_COLLECTION, source: 'admin', confirmed: true },
      { dimension: 'doc', value: meta.slug, source: 'admin', confirmed: true },
      { dimension: 'kind', value: meta.kind, source: 'admin', confirmed: true },
      { dimension: 'format', value: format, source: 'admin', confirmed: true },
    ],
  }, { id: actor.id, kind: 'admin' });
  return { atomId, format };
}
