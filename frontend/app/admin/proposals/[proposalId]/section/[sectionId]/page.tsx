import { auth } from '@/auth';
import { redirect, notFound } from 'next/navigation';
// Admin cross-tenant console page — reads span tenants, so use the owner (BYPASSRLS) pool. (docs/RLS_CUTOVER.md)
import { sqlBypass as sql } from '@/lib/db';
import { CanvasEditorPage } from '@/components/canvas/canvas-editor-page';
import type { CanvasDocument } from '@/lib/types/canvas-document';
import { CANVAS_PRESETS, createEmptyCanvas } from '@/lib/types/canvas-document';
import { coerceJsonb } from '@/lib/jsonb';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ proposalId: string; sectionId: string }>;
}

export default async function Page({ params }: Props) {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const { proposalId, sectionId } = await params;
  const userId = (session.user as { id?: string }).id ?? '';
  const userName = (session.user as { name?: string }).name ?? session.user.email ?? 'Unknown';

  // Load the proposal section's canvas content (if it exists)
  let sectionRows: {
    id: string;
    title: string | null;
    content: unknown;
    status: string;
    proposalId: string;
  }[] = [];
  try {
    sectionRows = await sql<typeof sectionRows>`
      SELECT id, title, content, status, proposal_id
      FROM proposal_sections
      WHERE id = ${sectionId}::uuid
        AND proposal_id = ${proposalId}::uuid
    `;
  } catch (e: unknown) {
    if (e && typeof e === 'object' && 'digest' in e) throw e;
    console.error('[admin/proposals/section] query failed:', e);
    notFound();
  }

  if (sectionRows.length === 0) notFound();
  const section = sectionRows[0];

  // If no canvas content yet, create an empty one with default preset.
  // content is TEXT (mig 071) → postgres.js returns a STRING; coerceJsonb parses it so the admin
  // co-draft editor rehydrates saved content instead of blank (same mig-071 guard bug as the portal).
  let canvasDoc: CanvasDocument;
  const parsedContent = coerceJsonb<CanvasDocument | null>(section.content, null);
  if (parsedContent && typeof parsedContent === 'object' && 'version' in parsedContent) {
    canvasDoc = parsedContent;
  } else {
    canvasDoc = createEmptyCanvas({
      documentId: sectionId,
      canvas: CANVAS_PRESETS.letter_sbir_phase1,
      metadata: {
        title: section.title ?? 'Untitled Section',
        volume_id: '',
        required_item_id: '',
        proposal_id: proposalId,
        solicitation_id: '',
        created_at: new Date().toISOString(),
        last_modified_at: new Date().toISOString(),
        last_modified_by: userId,
        version_number: 1,
        status: 'empty',
      },
    });
  }

  return (
    <CanvasEditorPage
      canvasDocument={canvasDoc}
      sectionId={sectionId}
      proposalId={proposalId}
      actorId={userId}
      actorName={userName}
    />
  );
}
