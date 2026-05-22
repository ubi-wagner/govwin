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

  const isAdmin =
    user &&
    (user.role === 'master_admin' ||
      user.role === 'rfp_admin' ||
      (user.role === 'tenant_admin' && user.tenantId === tenantId));

  if (isAdmin) {
    // Admin gets full access to all sections
    const sections = await sql<{ id: string }[]>`
      SELECT id FROM proposal_sections
      WHERE proposal_id = ${proposalId}
    `;
    const allIds = sections.map((s) => s.id);

    return {
      role: 'admin',
      editableSections: allIds,
      commentableSections: allIds,
      viewableSections: allIds,
      canUpload: true,
      canAdvance: true,
      canManageTeam: true,
      canExport: proposal.lockCount >= 1 && proposal.isLocked,
      lockCount: proposal.lockCount,
      isLocked: proposal.isLocked,
      unlockDeadline: proposal.unlockDeadline,
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
    LIMIT 1
  `;

  if (!collaborator) {
    return {
      ...NO_ACCESS,
      lockCount: proposal.lockCount,
      isLocked: proposal.isLocked,
      unlockDeadline: proposal.unlockDeadline,
    };
  }

  // Load stage access permissions
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
      AND stage = ${proposal.stage}
  `;

  const editableSections: string[] = [];
  const commentableSections: string[] = [];
  const viewableSections: string[] = [];

  // Assigned sections get the permission from stage_access
  for (const access of stageAccess) {
    const sectionIds = collaborator.assignedSections || [];
    for (const sectionId of sectionIds) {
      if (access.permission === 'edit') {
        editableSections.push(sectionId);
      } else if (access.permission === 'comment') {
        commentableSections.push(sectionId);
      } else if (access.permission === 'view') {
        viewableSections.push(sectionId);
      }
    }
  }

  const userRole = collaborator.role === 'external' ? 'external' : 'contributor';

  return {
    role: userRole as 'contributor' | 'external',
    editableSections,
    commentableSections,
    viewableSections,
    canUpload: collaborator.dropboxEnabled,
    canAdvance: false,
    canManageTeam: false,
    canExport: false,
    lockCount: proposal.lockCount,
    isLocked: proposal.isLocked,
    unlockDeadline: proposal.unlockDeadline,
  };
  } catch (err) {
    console.error('[proposal-access] resolveUserAccess failed:', err);
    return NO_ACCESS;
  }
}
