/**
 * Proposal workspace access resolver.
 *
 * Determines a user's role and per-section permissions within a proposal.
 * Admin (tenant_admin) gets full access implicitly. Contributors and
 * external users get access based on proposal_collaborators +
 * collaborator_stage_access rows.
 */

import { sql } from '@/lib/db';

export interface UserAccess {
  role: 'admin' | 'contributor' | 'external';
  editableSections: string[];
  commentableSections: string[];
  viewableSections: string[];
  canUpload: boolean;
  canAdvance: boolean;
  canManageTeam: boolean;
  canExport: boolean;
  lockCount: number;
  isLocked: boolean;
  unlockDeadline: string | null;
  currentStage: string;
  accessibleStages: string[];
}

const NO_ACCESS: UserAccess = {
  role: 'external',
  editableSections: [],
  commentableSections: [],
  viewableSections: [],
  canUpload: false,
  canAdvance: false,
  canManageTeam: false,
  canExport: false,
  lockCount: 0,
  isLocked: false,
  unlockDeadline: null,
  currentStage: '',
  accessibleStages: [],
};

export async function resolveUserAccess(
  userId: string,
  proposalId: string,
  tenantId: string,
): Promise<UserAccess> {
  try {
  // Load proposal lock state
  const [proposal] = await sql<{
    lockCount: number;
    isLocked: boolean;
    unlockDeadline: string | null;
    tenantId: string;
    stage: string;
  }[]>`
    SELECT
      lock_count,
      is_locked,
      unlock_deadline,
      tenant_id,
      stage
    FROM proposals
    WHERE id = ${proposalId}
      AND tenant_id = ${tenantId}
    LIMIT 1
  `;

  if (!proposal) {
    return NO_ACCESS;
  }

  // Check if user is tenant_admin for this tenant
  const [user] = await sql<{ role: string; tenantId: string | null }[]>`
    SELECT role, tenant_id FROM users
    WHERE id = ${userId}
    LIMIT 1
  `;

  // Tenant-wide access via the canonical membership ledger (NOT the retired
  // users.tenant_id column). Home staff — tenant_admin AND tenant_user — get
  // full proposal access (edit current-stage sections, comment/view all,
  // upload, export). Team management + stage advance stay admin-only so the UI
  // never offers a tenant_user an action the API will 403.
  const [membership] = await sql<{ role: string }[]>`
    SELECT role FROM user_memberships
    WHERE user_id = ${userId}::uuid AND tenant_id = ${tenantId}::uuid
      AND status = 'active' AND role IN ('tenant_admin', 'tenant_user')
    LIMIT 1
  `;
  const isPlatformAdmin = user?.role === 'master_admin' || user?.role === 'rfp_admin';
  const isTenantAdmin =
    isPlatformAdmin ||
    membership?.role === 'tenant_admin' ||
    (user?.role === 'tenant_admin' && user?.tenantId === tenantId);
  const isTenantWide = isTenantAdmin || membership?.role === 'tenant_user';

  if (isTenantWide) {
    // Full access to all sections; edit is restricted to current-stage sections.
    const sections = await sql<{ id: string; completedStage: string | null }[]>`
      SELECT id, completed_stage FROM proposal_sections
      WHERE proposal_id = ${proposalId}
    `;
    const allIds = sections.map((s) => s.id);

    // Admins can edit sections in the current stage; completed-stage sections are read-only
    const editableIds = sections
      .filter((s) => s.completedStage === null || s.completedStage === proposal.stage)
      .map((s) => s.id);

    // Load gate_config for accessible stages
    let gateConfig: string[] = [];
    try {
      const [proposalGates] = await sql<{ gateConfig: string[] }[]>`
        SELECT gate_config FROM proposals WHERE id = ${proposalId} LIMIT 1
      `;
      gateConfig = (proposalGates?.gateConfig || ['draft', 'final']) as string[];
    } catch {
      gateConfig = ['draft', 'final'];
    }

    return {
      role: isTenantAdmin ? 'admin' : 'contributor',
      editableSections: proposal.isLocked ? [] : editableIds,
      commentableSections: allIds,
      viewableSections: allIds,
      canUpload: !proposal.isLocked,
      canAdvance: isTenantAdmin,
      canManageTeam: isTenantAdmin,
      canExport: proposal.lockCount >= 1,
      lockCount: proposal.lockCount,
      isLocked: proposal.isLocked,
      unlockDeadline: proposal.unlockDeadline,
      currentStage: proposal.stage,
      accessibleStages: gateConfig,
    };
  }

  // Look up collaborator record
  const [collaborator] = await sql<{
    id: string;
    role: string;
    assignedSections: string[];
    dropboxEnabled: boolean;
  }[]>`
    SELECT id, role, assigned_sections, dropbox_enabled
    FROM proposal_collaborators
    WHERE proposal_id = ${proposalId}
      AND user_id = ${userId}
      AND accepted_at IS NOT NULL
      AND revoked_at IS NULL
    LIMIT 1
  `;

  if (!collaborator) {
    return {
      ...NO_ACCESS,
      lockCount: proposal.lockCount,
      isLocked: proposal.isLocked,
      unlockDeadline: proposal.unlockDeadline,
      currentStage: proposal.stage,
    };
  }

  // Load stage access permissions — include ALL granted stages, not just current
  const stageAccess = await sql<{
    permission: string;
    artifactTypes: string[];
    stage: string;
  }[]>`
    SELECT permission, artifact_types, stage
    FROM collaborator_stage_access
    WHERE collaborator_id = ${collaborator.id}
      AND proposal_id = ${proposalId}
      AND access_revoked_at IS NULL
  `;

  // Build a set of stages this collaborator can access
  const accessibleStages = [...new Set(stageAccess.map((a) => a.stage))];
  const hasCurrentStageAccess = stageAccess.some((a) => a.stage === proposal.stage);

  // Load sections with completion info to determine editability
  const sectionRows = await sql<{ id: string; completedStage: string | null }[]>`
    SELECT id, completed_stage FROM proposal_sections
    WHERE proposal_id = ${proposalId}
  `;
  const sectionCompletionMap = new Map(sectionRows.map((s) => [s.id, s.completedStage]));

  const editableSections: string[] = [];
  const commentableSections: string[] = [];
  const viewableSections: string[] = [];

  // Current stage permissions — can edit/comment on assigned sections
  const currentStageAccess = stageAccess.filter((a) => a.stage === proposal.stage);
  for (const access of currentStageAccess) {
    const sectionIds = collaborator.assignedSections || [];
    for (const sectionId of sectionIds) {
      const completedStage = sectionCompletionMap.get(sectionId);
      // Only allow edits if section is not locked from a previous stage
      const sectionIsEditable = completedStage === null || completedStage === proposal.stage;
      if (access.permission === 'edit' && sectionIsEditable && !proposal.isLocked) {
        editableSections.push(sectionId);
      } else if (access.permission === 'comment' || (access.permission === 'edit' && !sectionIsEditable)) {
        commentableSections.push(sectionId);
      } else if (access.permission === 'view') {
        viewableSections.push(sectionId);
      }
    }
  }

  // Previous completed stages — if user has access to current stage, they can
  // VIEW content from previous stages (read-only)
  if (hasCurrentStageAccess) {
    const previousStageAccess = stageAccess.filter((a) => a.stage !== proposal.stage);
    for (const access of previousStageAccess) {
      const sectionIds = collaborator.assignedSections || [];
      for (const sectionId of sectionIds) {
        if (!viewableSections.includes(sectionId) &&
            !commentableSections.includes(sectionId) &&
            !editableSections.includes(sectionId)) {
          viewableSections.push(sectionId);
        }
      }
    }
  }

  const userRole = collaborator.role === 'external' ? 'external' : 'contributor';

  return {
    role: userRole as 'contributor' | 'external',
    editableSections,
    commentableSections,
    viewableSections,
    canUpload: collaborator.dropboxEnabled && !proposal.isLocked,
    canAdvance: false,
    canManageTeam: false,
    canExport: false,
    lockCount: proposal.lockCount,
    isLocked: proposal.isLocked,
    unlockDeadline: proposal.unlockDeadline,
    currentStage: proposal.stage,
    accessibleStages,
  };
  } catch (err) {
    console.error('[proposal-access] resolveUserAccess failed:', err);
    return NO_ACCESS;
  }
}
