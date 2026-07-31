/**
 * "Eat our own cooking" — in the RIGHT native format. Each house artifact is
 * produced as a real CanvasDocument in its natural type (see artifact-canvas.ts for
 * the pure builders) and landed in the library as a canvas-backed atom; renderCanvas
 * then exports its real file (.docx / .xlsx / .pptx / .pdf).
 */
import type { CanvasDocument } from '@/lib/types/canvas-document';
import type { ExportFormat } from '@/lib/export/artifact-export';
import {
  ARTIFACT_FORMAT, sectionsToCanvasDoc, tableToCanvasSheet, flattenNodes, type Section,
} from '@/lib/library/artifact-canvas';
import { decomposeAndIngest } from '@/lib/library/foundation';

export { ARTIFACT_FORMAT, sectionsToCanvasDoc, tableToCanvasSheet, flattenNodes };
export type { Section };

/** Land a native-format CanvasDocument as a FOUNDATION ARTIFACT that decomposes into
 *  section/group/atom real atoms (docs/LIBRARY_AND_VAULTS_DESIGN.md §1). Returns the
 *  foundation atom id + the grain counts. */
export async function ingestHouseArtifact(
  tenantId: string,
  meta: { title: string; slug: string; form: 'doc' | 'ppt' | 'pdf' | 'sheet'; kind?: 'template' | 'document'; context?: string },
  doc: CanvasDocument,
  actor: { id: string },
): Promise<{ atomId: string; format: ExportFormat; sections: number; groups: number; atoms: number }> {
  const format = ARTIFACT_FORMAT[meta.form];
  const d = await decomposeAndIngest(tenantId, doc, meta, actor);
  return {
    atomId: d.foundationId, format,
    sections: d.sectionIds.length, groups: d.groupIds.length, atoms: d.atomIds.length,
  };
}
