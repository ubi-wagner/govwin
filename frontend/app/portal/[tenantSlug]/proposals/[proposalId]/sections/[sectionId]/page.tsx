import { auth } from '@/auth';
import { redirect, notFound } from 'next/navigation';
import { sql, getTenantBySlug, verifyProposalAccess } from '@/lib/db';
import { isRole, isTenantWideMember, type Role } from '@/lib/rbac';
import { resolveUserAccess } from '@/lib/proposal-access';
import { resolveCanvasCapabilities, type CanvasPermission, type CanvasArtifactType } from '@/lib/canvas/capabilities';
import { CanvasEditorPage } from '@/components/canvas/canvas-editor-page';
import type { CanvasDocument } from '@/lib/types/canvas-document';
import { CANVAS_PRESETS, createEmptyCanvas } from '@/lib/types/canvas-document';

export const dynamic = 'force-dynamic';

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
  if (!tenant) redirect('/portal');

  const tenantId = tenant.id as string;
  // Proposal-scoped gate: tenant member OR accepted collaborator on THIS proposal.
  const hasAccess = await verifyProposalAccess(sessionUser.id, role, sessionUser.tenantId, tenantId, proposalId);
  if (!hasAccess) redirect('/portal');

  const userId = sessionUser.id;
  const userName = sessionUser.name ?? sessionUser.email ?? 'Unknown';

  // ── Verify the proposal belongs to this tenant ─────────────────────
  // Also fetch is_locked — when workspace_locked the editor is readOnly.
  let proposal: { id: string; solicitationId: string | null; isLocked: boolean } | undefined;
  try {
    const [row] = await sql<{ id: string; solicitationId: string | null; isLocked: boolean }[]>`
      SELECT id, solicitation_id, is_locked
      FROM proposals
      WHERE id = ${proposalId}
        AND tenant_id = ${tenantId}
      LIMIT 1
    `;
    proposal = row;
  } catch (e) {
    console.error('[portal/sections] proposal query error:', e);
  }

  if (!proposal) notFound();

  // ── Load the section's canvas content + ribbon metadata ──────────────
  let sectionRows: {
    id: string;
    title: string | null;
    content: unknown;
    status: string;
    isLocked: boolean;
    proposalId: string;
    version: number;
    sectionNumber: string | null;
    volumeName: string | null;
    pageAllocation: number | null;
  }[] = [];
  try {
    sectionRows = await sql<typeof sectionRows>`
      SELECT id, title, content, status, is_locked, proposal_id, version,
             section_number, volume_name, page_allocation
      FROM proposal_sections
      WHERE id = ${sectionId}::uuid
        AND proposal_id = ${proposalId}::uuid
    `;
  } catch (e) {
    console.error('[portal/sections] section query error:', e);
  }

  if (sectionRows.length === 0) notFound();
  const section = sectionRows[0];

  // ── Load compliance items for this section (for the ribbon chip) ──────
  let sectionCompliance: {
    id: string;
    requirement: string;
    status: string;
    notes: string | null;
    sectionId: string | null;
  }[] = [];
  try {
    sectionCompliance = await sql<typeof sectionCompliance>`
      SELECT id, requirement_text AS requirement, status, notes, section_id
      FROM proposal_compliance_matrix
      WHERE proposal_id = ${proposalId}::uuid
        AND section_id  = ${sectionId}::uuid
    `;
  } catch (e) {
    console.error('[portal/sections] compliance query error:', e);
  }

  // ── Collaborator scoping ───────────────────────────────────────────
  // Home tenant staff (tenant_user+) have tenant-wide proposal access by design.
  // Anyone WITHOUT tenant-wide access (a partner_user, OR a cross-company
  // collaborator) is collaborator-scoped: only sections granted on THIS proposal
  // are viewable, and only 'edit'-granted sections are writable.
  // A collaborator's grant on THIS section → a CanvasPermission; tenant-wide
  // members carry no grant (⇒ undefined ⇒ full edit in the capability resolver).
  let permission: CanvasPermission | undefined;
  if (!isTenantWideMember(role, sessionUser.tenantId, tenantId)) {
    const access = await resolveUserAccess(userId, proposalId, tenantId);
    permission = access.editableSections.includes(sectionId)
      ? 'edit'
      : access.commentableSections.includes(sectionId)
        ? 'comment'
        : access.viewableSections.includes(sectionId)
          ? 'view'
          : undefined;
    if (!permission) notFound();
  }

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

  // Resolve the live tool set (role × stage × permission × type) — the one gate
  // the canvas toolbars read. readOnly follows from it (no edit ⇒ read-only).
  const fmt = canvasDoc.canvas?.format ?? 'letter';
  const artifactType: CanvasArtifactType = fmt.startsWith('slide') ? 'slide' : fmt === 'spreadsheet' ? 'spreadsheet' : 'document';
  const locked = proposal.isLocked || section.isLocked;
  const capabilities = resolveCanvasCapabilities({ role, locked, permission, stage: 'draft', artifactType });
  // Toolbox ordering: a locked/completed section → review; a view/comment
  // collaborator (can't edit) → review-first; otherwise the drafting toolbox.
  const stage = locked ? 'locked' : capabilities.canEditContent ? 'draft' : 'review';

  return (
    <CanvasEditorPage
      canvasDocument={canvasDoc}
      sectionId={sectionId}
      proposalId={proposalId}
      actorId={userId}
      actorName={userName}
      initialVersion={section.version}
      readOnly={!capabilities.canEditContent}
      capabilities={capabilities}
      stage={stage}
      tenantSlug={tenantSlug}
      sectionNumber={section.sectionNumber ?? undefined}
      volumeName={section.volumeName ?? undefined}
      pageAllocation={section.pageAllocation ?? null}
      isLocked={proposal.isLocked || section.isLocked}
      complianceItems={sectionCompliance.map((c) => ({
        id: c.id,
        requirement: c.requirement,
        status: c.status,
        details: c.notes,
        sectionId: c.sectionId,
      }))}
    />
  );
}
