import { redirect, notFound } from 'next/navigation';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyProposalAccess, enterTenant } from '@/lib/db';
import { isRole, isTenantWideMember, type Role } from '@/lib/rbac';
import { resolveUserAccess } from '@/lib/proposal-access';
import { ProposalWorkspace } from '@/components/portal/proposal-workspace';
import ProposalStudio from '@/components/portal/proposal-studio';
import { AmendmentBanner } from '@/components/portal/amendment-banner';
import { ArchivePortalButton } from '@/components/portal/archive-portal-button';
import { getProposalCard } from '@/lib/cards/card';
import { OpportunityCard, type OpportunityCardView } from '@/components/cards/opportunity-card';
import { AssignTaskForm } from '@/components/tasks/assign-task-form';
import { opportunityContextSlugs } from '@/lib/opportunity-context';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ tenantSlug: string; proposalId: string }>;
}

export default async function ProposalWorkspacePage({ params }: Props) {
  const { tenantSlug, proposalId } = await params;

  const session = await auth();
  if (!session?.user) redirect('/login');

  const sessionUser = session.user as {
    id?: string;
    role?: unknown;
    tenantId?: string | null;
  };

  const role: Role | null = isRole(sessionUser.role) ? sessionUser.role : null;
  if (!role || !sessionUser.id) redirect('/login?error=session');

  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) redirect('/portal');

  const tenantId = tenant.id as string;
  // Proposal-scoped gate: a tenant member OR an accepted collaborator on THIS
  // proposal (cross-company collaborators pass here). resolveUserAccess below
  // scopes what they can actually see/edit.
  const hasAccess = await verifyProposalAccess(sessionUser.id, role, sessionUser.tenantId, tenantId, proposalId);
  if (!hasAccess) redirect('/portal');
  enterTenant(tenantId);

  // ── Load proposal with opportunity + solicitation context ───────────
  interface ProposalRow {
    id: string;
    title: string;
    stage: string;
    isLocked: boolean;
    lockCount: number;
    downloadCount: number;
    unlockDeadline: string | null;
    gateConfig: string[];
    createdAt: Date;
    opportunityId: string;
    solicitationId: string | null;
    agency: string | null;
    topicNumber: string | null;
    closeDate: Date | null;
    solicitationTitle: string | null;
    programType: string | null;
  }

  let proposal: ProposalRow | null = null;

  try {
    const rows = await sql<ProposalRow[]>`
      SELECT
        p.id,
        p.title,
        p.stage,
        p.is_locked,
        p.lock_count,
        p.download_count,
        p.unlock_deadline,
        p.gate_config,
        p.created_at,
        p.opportunity_id,
        p.solicitation_id,
        o.agency,
        o.topic_number,
        o.close_date,
        o.program_type,
        cs.solicitation_title
      FROM proposals p
      JOIN opportunities o ON o.id = p.opportunity_id
      LEFT JOIN curated_solicitations cs ON cs.id = p.solicitation_id
      WHERE p.id = ${proposalId}
        AND p.tenant_id = ${tenantId}
      LIMIT 1
    `;
    proposal = rows[0] ?? null;
  } catch (e) {
    console.error('[portal/proposals/workspace] proposal query error:', e);
  }

  if (!proposal) notFound();

  // ── Opportunity card (the spine carrier): frozen origin + live compliance ──
  // Reuses the canonical read-model (lib/cards/card.ts). Non-fatal — a card
  // failure must never block the workspace.
  let cardView: OpportunityCardView | null = null;
  try {
    const card = await getProposalCard(proposalId, tenantId);
    if (card) {
      cardView = {
        proposalId: card.proposalId,
        opportunityId: card.opportunityId,
        title: card.title,
        stage: card.stage,
        isLocked: card.isLocked,
        lockCount: card.lockCount,
        unlockDeadline: card.unlockDeadline ? new Date(card.unlockDeadline).toISOString() : null,
        updatedAt: card.updatedAt ? new Date(card.updatedAt).toISOString() : null,
        sourceBucket: card.sourceBucket,
        origin: card.origin,
        compliance: card.compliance,
      };
    }
  } catch (e) {
    console.error('[portal/proposals/workspace] card read-model error:', e);
  }

  // ── Resolve user access ───────────────────────────────────────────
  let access;
  try {
    access = await resolveUserAccess(sessionUser.id, proposalId, tenantId);
  } catch (e) {
    console.error('[portal/proposals/workspace] access resolver error:', e);
    access = {
      role: 'external' as const,
      editableSections: [] as string[],
      commentableSections: [] as string[],
      viewableSections: [] as string[],
      canUpload: false,
      canAdvance: false,
      canManageTeam: false,
      canExport: false,
      lockCount: proposal.lockCount || 0,
      isLocked: proposal.isLocked,
      unlockDeadline: proposal.unlockDeadline,
      currentStage: proposal.stage || '',
      accessibleStages: [] as string[],
    };
  }

  // Scoped-collaborator guard: a user WITHOUT tenant-wide access (a partner_user,
  // OR a cross-company collaborator) who has no section grant on THIS proposal must
  // not see the workspace shell (title, collaborator roster + emails, compliance,
  // stage history). Home tenant staff (tenant_user+) retain tenant-wide access.
  if (
    !isTenantWideMember(role, sessionUser.tenantId, tenantId) &&
    access.editableSections.length === 0 &&
    access.commentableSections.length === 0 &&
    access.viewableSections.length === 0
  ) {
    notFound();
  }

  // ── Load sections (with completion markers) ────────────────────────
  let sections: {
    id: string;
    sectionNumber: string;
    title: string;
    status: string;
    pageAllocation: number | null;
    version: number;
    nodeCount: number;
    assignedTo: string | null;
    completedStage: string | null;
    completedAt: Date | null;
    acceptedBy: string | null;
    acceptedByName: string | null;
    isLocked: boolean;
    volumeName: string | null;
    volumeNumber: number | null;
    artifactId: string | null;
    expertNotes: string | null;
  }[] = [];

  try {
    sections = await sql<typeof sections>`
      SELECT
        ps.id,
        ps.section_number,
        ps.title,
        ps.status,
        ps.page_allocation,
        ps.version,
        ps.assigned_to,
        ps.completed_stage,
        ps.completed_at,
        ps.accepted_by,
        ps.is_locked,
        ps.volume_name,
        ps.volume_number,
        ps.artifact_id,
        ps.meta->>'expertNotes' AS expert_notes,
        u.name AS accepted_by_name,
        CASE
          WHEN ps.content IS NOT NULL AND ps.content::text != 'null' AND ps.content::text != ''
          THEN (
            SELECT COUNT(*)::int
            FROM jsonb_array_elements(
              CASE
                WHEN jsonb_typeof((ps.content::jsonb)->'nodes') = 'array'
                THEN (ps.content::jsonb)->'nodes'
                ELSE '[]'::jsonb
              END
            )
          )
          ELSE 0
        END AS node_count
      FROM proposal_sections ps
      LEFT JOIN users u ON u.id = ps.accepted_by
      WHERE ps.proposal_id = ${proposalId}
      ORDER BY ps.volume_number ASC NULLS LAST, ps.sort_index ASC NULLS LAST, ps.section_number ASC
    `;
  } catch (e) {
    console.error('[portal/proposals/workspace] sections query error:', e);
  }

  // ── Load stage completion history ──────────────────────────────────
  let stageCompletionHistory: {
    stage: string;
    completedBy: string | null;
    completedByName: string | null;
    completedAt: Date;
    totalSections: number;
    sectionsComplete: number;
    sectionsApproved: number;
    notes: string | null;
  }[] = [];
  try {
    stageCompletionHistory = await sql<typeof stageCompletionHistory>`
      SELECT scs.stage, scs.completed_by, u.name AS completed_by_name,
             scs.completed_at, scs.total_sections, scs.sections_complete,
             scs.sections_approved, scs.notes
      FROM stage_completion_snapshots scs
      LEFT JOIN users u ON u.id = scs.completed_by
      WHERE scs.proposal_id = ${proposalId}
      ORDER BY scs.completed_at ASC
    `;
  } catch (e) {
    console.error('[portal/proposals/workspace] stage history query error:', e);
  }

  // ── Load collaborators ─────────────────────────────────────────────
  let collaborators: {
    id: string;
    userId: string | null;
    email: string;
    name: string | null;
    role: string;
    assignedSections: string[];
    dropboxEnabled: boolean;
    invitedAt: string;
    acceptedAt: string | null;
    revokedAt: string | null;
  }[] = [];

  try {
    collaborators = await sql<typeof collaborators>`
      SELECT
        id, user_id, email, name, role,
        assigned_sections, dropbox_enabled,
        invited_at, accepted_at, revoked_at
      FROM proposal_collaborators
      WHERE proposal_id = ${proposalId}
      ORDER BY invited_at ASC
    `;
  } catch (e) {
    console.error('[portal/proposals/workspace] collaborators query error:', e);
  }

  // Load stage access for collaborators
  let stageAccessRows: {
    collaboratorId: string;
    stage: string;
    permission: string;
    artifactTypes: string[];
  }[] = [];

  try {
    stageAccessRows = await sql<typeof stageAccessRows>`
      SELECT collaborator_id, stage, permission, artifact_types
      FROM collaborator_stage_access
      WHERE proposal_id = ${proposalId}
        AND access_revoked_at IS NULL
    `;
  } catch (e) {
    console.error('[portal/proposals/workspace] stage access query error:', e);
  }

  const stageAccessByCollab = new Map<string, typeof stageAccessRows>();
  for (const row of stageAccessRows) {
    const existing = stageAccessByCollab.get(row.collaboratorId) || [];
    existing.push(row);
    stageAccessByCollab.set(row.collaboratorId, existing);
  }

  const collaboratorsWithAccess = collaborators.map((c) => ({
    ...c,
    active: c.revokedAt == null,
    stageAccess: stageAccessByCollab.get(c.id) || [],
  }));

  // ── Load compliance ────────────────────────────────────────────────
  let compliance: {
    items?: Array<{
      id?: string;
      requirement?: string;
      status?: string;
      details?: string | null;
      label?: string;
      met?: boolean;
      value?: string;
      sectionId?: string | null;
    }>;
    source?: string;
  } | null = null;
  try {
    const matrix = await sql<{
      id: string;
      requirementText: string;
      status: string;
      notes: string | null;
      sectionId: string | null;
    }[]>`
      SELECT id, requirement_text, status, notes, section_id
      FROM proposal_compliance_matrix
      WHERE proposal_id = ${proposalId}
      ORDER BY requirement_text ASC
    `;
    if (matrix.length > 0) {
      compliance = {
        items: matrix.map((row) => ({
          id: row.id,
          requirement: row.requirementText,
          label: row.requirementText,
          status: row.status,
          details: row.notes,
          sectionId: row.sectionId,
        })),
        source: 'database',
      };
    }
  } catch (e) {
    console.error('[portal/proposals/workspace] compliance query error:', e);
  }

  // ── Load proposal events (timeline) ────────────────────────────────
  let proposalEvents: {
    id: string;
    namespace: string;
    type: string;
    phase: string;
    actorType: string | null;
    actorEmail: string | null;
    payload: Record<string, unknown> | null;
    error: Record<string, unknown> | null;
    durationMs: number | null;
    createdAt: string;
  }[] = [];

  try {
    const eventRows = await sql<{
      id: string;
      namespace: string;
      type: string;
      phase: string;
      actorType: string | null;
      actorEmail: string | null;
      payload: Record<string, unknown> | null;
      error: Record<string, unknown> | null;
      durationMs: number | null;
      createdAt: Date;
    }[]>`
      SELECT id, namespace, type, phase, actor_type, actor_email,
             payload, error, duration_ms, created_at
      FROM system_events
      WHERE tenant_id = ${tenantId}
        AND (
          (payload->>'proposal_id' = ${proposalId})
          OR (payload->>'proposalId' = ${proposalId})
        )
      ORDER BY created_at DESC
      LIMIT 50
    `;
    proposalEvents = eventRows.map(r => ({
      id: r.id,
      namespace: r.namespace,
      type: r.type,
      phase: r.phase,
      actorType: r.actorType,
      actorEmail: r.actorEmail,
      payload: r.payload,
      error: r.error,
      durationMs: r.durationMs,
      createdAt: r.createdAt.toISOString(),
    }));
  } catch (e) {
    console.error('[portal/proposals/workspace] events query error:', e);
  }

  // ── Compute derived data ──────────────────────────────────────────
  const gateConfig = (proposal.gateConfig || ['draft', 'final']) as string[];

  const hasEmptySections = sections.some(
    (s) => s.status === 'empty' || s.nodeCount === 0,
  );

  const closeDateStr = proposal.closeDate
    ? new Date(proposal.closeDate).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : null;

  // Map sections with per-user permission
  const sectionsWithPermission = sections.map((s) => {
    let permission: 'edit' | 'comment' | 'view' | 'none' = 'none';
    if (access.role === 'admin') {
      permission = 'edit';
    } else if (access.editableSections.includes(s.id)) {
      permission = 'edit';
    } else if (access.commentableSections.includes(s.id)) {
      permission = 'comment';
    } else if (access.viewableSections.includes(s.id)) {
      permission = 'view';
    }
    return {
      id: s.id,
      sectionNumber: s.sectionNumber,
      title: s.title,
      status: s.status,
      pageAllocation: s.pageAllocation,
      version: s.version,
      nodeCount: s.nodeCount,
      permission,
      assignedTo: s.assignedTo,
      completedStage: s.completedStage ?? null,
      completedAt: s.completedAt ? new Date(s.completedAt).toISOString() : null,
      acceptedByName: s.acceptedByName ?? null,
      isLocked: s.isLocked,
      volumeName: s.volumeName ?? null,
      volumeNumber: s.volumeNumber ?? null,
      artifactId: s.artifactId ?? null,
      expertNotes: s.expertNotes ?? null,
      isEditable: !s.isLocked && (s.completedStage === null || s.completedStage === proposal.stage),
    };
  });

  // Defense in depth: a SCOPED collaborator (NOT a tenant-wide member) must never
  // even RECEIVE metadata for sections they weren't granted — withhold unassigned
  // sections here so nothing leaks client-side (e.g. a pricing section's title in
  // the "All" tab). A collaborator sees ONLY what the company admin assigned. Home
  // staff / admins (tenant-wide) keep the full section set. (Identity: collaborators
  // work across companies; scope is enforced off the grant, never assumed.)
  const tenantWide = isTenantWideMember(role, sessionUser.tenantId, tenantId);
  const visibleSections = tenantWide
    ? sectionsWithPermission
    : sectionsWithPermission.filter((s) => s.permission !== 'none');

  return (
    <div>
      {/* ── Proposal Header ───────────────────────────────────────────── */}
      <div className="mb-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-gray-900 truncate">
              {proposal.title}
            </h1>
            <div className="flex items-center gap-3 mt-2 text-sm text-gray-500">
              {proposal.topicNumber && <span>Topic {proposal.topicNumber}</span>}
              {proposal.agency && <span>{proposal.agency}</span>}
              {proposal.programType && (
                <span className="uppercase text-xs font-medium text-indigo-600">
                  {proposal.programType}
                </span>
              )}
              {closeDateStr && (
                <span
                  className={
                    proposal.closeDate && new Date(proposal.closeDate) < new Date()
                      ? 'text-red-600 font-medium'
                      : ''
                  }
                >
                  {proposal.closeDate && new Date(proposal.closeDate) < new Date()
                    ? 'Closed'
                    : 'Due'}{' '}
                  {closeDateStr}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Opportunity card (frozen origin + live compliance) ────────── */}
      {cardView && (
        <details className="mb-6 group">
          <summary className="cursor-pointer text-sm font-medium text-gray-600 hover:text-gray-900 select-none">
            Opportunity origin &amp; compliance
          </summary>
          <div className="mt-3 max-w-2xl">
            <OpportunityCard card={cardView} />
          </div>
        </details>
      )}

      {/* ── Delegate a task (managers) ────────────────────────────────── */}
      {access.canManageTeam && (
        <details className="mb-6 group">
          <summary className="cursor-pointer text-sm font-medium text-gray-600 hover:text-gray-900 select-none">
            Assign a task
          </summary>
          <div className="mt-3 max-w-2xl border border-gray-200 rounded-lg p-4 bg-white">
            <AssignTaskForm
              tenantSlug={tenantSlug}
              entityType="proposal"
              entityId={proposalId}
              assignees={collaboratorsWithAccess.map((c) => ({ userId: c.userId, name: c.name, email: c.email }))}
            />
          </div>
        </details>
      )}

      {/* Amendment fan-out banner — self-hides when there are no unacknowledged flags. */}
      <AmendmentBanner tenantSlug={tenantSlug} proposalId={proposalId} canAcknowledge={access.role === 'admin'} />

      {/* Archive the whole portal (admins) — cascades its workflows; reversible, nothing deleted. */}
      {access.role === 'admin' && proposal.stage !== 'archived' && (
        <div className="flex justify-end mb-4">
          <ArchivePortalButton tenantSlug={tenantSlug} proposalId={proposalId} />
        </div>
      )}

      {/* ── Proposal Studio — 3-phase gated draft→refine→compliance (admins) ── */}
      {access.role === 'admin' && (
        <div className="mb-6">
          <ProposalStudio tenantSlug={tenantSlug} proposalId={proposalId} />
        </div>
      )}

      {/* ── Workspace Client Component ────────────────────────────────── */}
      <ProposalWorkspace
        proposalId={proposalId}
        tenantSlug={tenantSlug}
        contextSlugs={opportunityContextSlugs({ agency: proposal.agency, program: proposal.programType })}
        sections={visibleSections}
        hasEmptySections={hasEmptySections}
        proposalStage={proposal.stage}
        isLocked={proposal.isLocked}
        userRole={access.role}
        currentUserId={sessionUser.id}
        collaborators={collaboratorsWithAccess}
        compliance={compliance}
        dropboxFiles={[]}
        gateConfig={gateConfig}
        lockCount={proposal.lockCount || 0}
        downloadCount={proposal.downloadCount || 0}
        unlockDeadline={proposal.unlockDeadline}
        canAdvance={access.canAdvance}
        canUpload={access.canUpload}
        canExport={access.canExport}
        canManageTeam={access.canManageTeam}
        closeDate={proposal.closeDate?.toISOString() ?? null}
        proposalEvents={proposalEvents}
        stageCompletionHistory={stageCompletionHistory.map((h) => ({
          stage: h.stage,
          completedByName: h.completedByName,
          completedAt: h.completedAt.toISOString(),
          totalSections: h.totalSections,
          sectionsComplete: h.sectionsComplete,
          sectionsApproved: h.sectionsApproved,
          notes: h.notes,
        }))}
      />
    </div>
  );
}
