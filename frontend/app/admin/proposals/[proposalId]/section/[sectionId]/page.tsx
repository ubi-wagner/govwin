import { auth } from '@/auth';
import { redirect, notFound } from 'next/navigation';
import { sql } from '@/lib/db';
import { CanvasEditorPage } from '@/components/canvas/canvas-editor-page';
import type { CanvasDocument } from '@/lib/types/canvas-document';
import { CANVAS_PRESETS, createEmptyCanvas } from '@/lib/types/canvas-document';

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
  const sectionRows = await sql<{
    id: string;
    title: string | null;
    content: unknown;
    status: string;
    proposalId: string;
  }[]>`
    SELECT id, title, content, status, proposal_id
    FROM proposal_sections
    WHERE id = ${sectionId}::uuid
      AND proposal_id = ${proposalId}::uuid
  `;

  if (sectionRows.length === 0) notFound();
  const section = sectionRows[0];

  // If no canvas content yet, create an empty one with default preset
  let canvasDoc: CanvasDocument;
  if (section.content && typeof section.content === 'object' && 'version' in (section.content as object)) {
    canvasDoc = section.content as CanvasDocument;
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
