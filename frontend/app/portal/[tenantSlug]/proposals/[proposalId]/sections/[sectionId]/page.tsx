import { auth } from '@/auth';
import { redirect, notFound } from 'next/navigation';
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, type Role } from '@/lib/rbac';
import { CanvasEditorPage } from '@/components/canvas/canvas-editor-page';
import type { CanvasDocument } from '@/lib/types/canvas-document';
import { CANVAS_PRESETS, createEmptyCanvas } from '@/lib/types/canvas-document';

interface Props {
  params: Promise<{ tenantSlug: string; proposalId: string; sectionId: string }>;
}

export default async function PortalSectionEditorPage({ params }: Props) {
  const { tenantSlug, proposalId, sectionId } = await params;

  const session = await auth();
  if (!session?.user) redirect('/login');

  const sessionUser = session.user as {
    id?: string;
    name?: string | null;
    email?: string;
    role?: unknown;
    tenantId?: string | null;
  };

  const role: Role | null = isRole(sessionUser.role) ? sessionUser.role : null;
  if (!role || !sessionUser.id) redirect('/login?error=session');

  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) redirect('/login');

  const tenantId = tenant.id as string;
  const hasAccess = await verifyTenantAccess(sessionUser.id, role, tenantId);
  if (!hasAccess) redirect('/login');

  const userId = sessionUser.id;
  const userName = sessionUser.name ?? sessionUser.email ?? 'Unknown';

  // ── Verify the proposal belongs to this tenant ─────────────────────
  const [proposal] = await sql<{ id: string; solicitationId: string | null }[]>`
    SELECT id, solicitation_id
    FROM proposals
    WHERE id = ${proposalId}
      AND tenant_id = ${tenantId}
    LIMIT 1
  `;

  if (!proposal) notFound();

  // ── Load the section's canvas content ──────────────────────────────
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
        solicitation_id: proposal.solicitationId ?? '',
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
