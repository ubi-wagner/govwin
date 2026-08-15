import { auth } from '@/auth';
import { redirect, notFound } from 'next/navigation';
import { sql, getTenantBySlug, verifyProposalAccess, enterTenant } from '@/lib/db';
import { isRole, isTenantWideMember, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { resolveUserAccess } from '@/lib/proposal-access';
import { listSectionAssignees, type SectionAssignee } from '@/lib/proposal/section-todo';
import { resolveCanvasCapabilities, type CanvasPermission, type CanvasArtifactType } from '@/lib/canvas/capabilities';
import { CanvasEditorPage } from '@/components/canvas/canvas-editor-page';
import { SectionAssignBar } from '@/components/proposal/section-assign-bar';
import type { CanvasDocument } from '@/lib/types/canvas-document';
import { CANVAS_PRESETS, createEmptyCanvas } from '@/lib/types/canvas-document';
import { coerceJsonb } from '@/lib/jsonb';

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
  enterTenant(tenantId);

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
    assignedTo: string | null;
  }[] = [];
  try {
    sectionRows = await sql<typeof sectionRows>`
      SELECT id, title, content, status, is_locked, proposal_id, version,
             section_number, volume_name, page_allocation, assigned_to AS "assignedTo"
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

  // ── Section assignment + its ToDo (SPINE-T1) ─────────────────────────
  // The per-section owner strip: who owns this section (+ their edit ToDo). Admins/shadow can
  // (re)assign from the tenant's editors + this proposal's collaborators; managers assign via the API.
  const canAssign = hasRoleAtLeast(role, 'tenant_admin');
  let assigneeName: string | null = null;
  if (section.assignedTo) {
    try {
      const [au] = await sql<Array<{ name: string | null; email: string }>>`
        SELECT name, email FROM users WHERE id = ${section.assignedTo}::uuid LIMIT 1`;
      assigneeName = au ? (au.name || au.email) : null;
    } catch { /* best-effort */ }
  }
  let sectionTodoStatus: 'open' | 'in_progress' | 'completed' | null = null;
  try {
    const [t] = await sql<Array<{ status: string }>>`
      SELECT status FROM tasks
      WHERE tenant_id = ${tenantId}::uuid AND entity_type = 'section' AND entity_id = ${sectionId}::uuid
        AND status IN ('open', 'in_progress', 'completed')
      ORDER BY created_at DESC LIMIT 1`;
    const s = t?.status;
    sectionTodoStatus = s === 'open' || s === 'in_progress' || s === 'completed' ? s : null;
  } catch { /* best-effort */ }
  const sectionAssignees: SectionAssignee[] = canAssign ? await listSectionAssignees(tenantId, proposalId) : [];

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

  // If no canvas content yet, create an empty one with default preset.
  // content is TEXT (mig 071) → postgres.js returns a STRING; coerceJsonb parses it so a
  // reopened section rehydrates its saved canvas instead of rendering blank (the old
  // `typeof content === 'object'` guard was always false for the string ⇒ blank-on-reload).
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
    <>
    <SectionAssignBar
      tenantSlug={tenantSlug}
      proposalId={proposalId}
      sectionId={sectionId}
      currentAssigneeId={section.assignedTo}
      currentAssigneeName={assigneeName}
      canAssign={canAssign}
      assignees={sectionAssignees}
      todoStatus={sectionTodoStatus}
    />
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
    </>
  );
}
