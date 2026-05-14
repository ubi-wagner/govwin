'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { DraftAllSections } from '@/components/canvas/draft-all-sections';
import { ProposalAdminPanel } from './proposal-admin-panel';
import { ProposalContributorView } from './proposal-contributor-view';
import { ProposalTimeline } from './proposal-timeline';
import { StageControl } from './stage-control';
import type { CanvasNode } from '@/lib/types/canvas-document';

// ─── Types ────────────────────────────────────────────────────────────

interface SectionItem {
  id: string;
  sectionNumber: string;
  title: string;
  status: string;
  pageAllocation: number | null;
  version: number;
  nodeCount: number;
  permission: 'edit' | 'comment' | 'view' | 'none';
  assignedTo?: string | null;
}

interface Collaborator {
  id: string;
  userId: string | null;
  email: string;
  name: string | null;
  role: string;
  assignedSections: string[];
  dropboxEnabled: boolean;
  invitedAt: string;
  acceptedAt: string | null;
  stageAccess: {
    collaboratorId: string;
    stage: string;
    permission: string;
    artifactTypes: string[];
  }[];
}

interface ComplianceData {
  items?: Array<{
    id?: string;
    requirement?: string;
    status?: string;
    details?: string | null;
    label?: string;
    met?: boolean;
    value?: string;
  }>;
  source?: string;
}

interface DropboxFileEntry {
  key: string;
  filename: string;
  size: number;
  lastModified: string | null;
}

interface ProposalWorkspaceProps {
  proposalId: string;
  tenantSlug: string;
  sections: SectionItem[];
  hasEmptySections: boolean;
  proposalStage: string;
  isLocked: boolean;
  // New props from portal page enhancements
  userRole: 'admin' | 'contributor' | 'external';
  currentUserId: string;
  collaborators: Collaborator[];
  compliance: ComplianceData | null;
  dropboxFiles: DropboxFileEntry[];
  gateConfig: string[];
  lockCount: number;
  downloadCount: number;
  unlockDeadline: string | null;
  canAdvance: boolean;
  canUpload: boolean;
  canExport: boolean;
  canManageTeam: boolean;
  closeDate?: string | null;
  proposalEvents: Array<{
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
  }>;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; dotColor: string }> = {
  empty:       { label: 'Empty',       color: 'text-gray-400',   dotColor: 'bg-gray-300' },
  ai_drafted:  { label: 'AI Draft',    color: 'text-yellow-600', dotColor: 'bg-yellow-400' },
  in_progress: { label: 'In Progress', color: 'text-blue-600',   dotColor: 'bg-blue-400' },
  complete:    { label: 'Complete',     color: 'text-green-600',  dotColor: 'bg-green-500' },
  approved:    { label: 'Approved',     color: 'text-emerald-600', dotColor: 'bg-emerald-500' },
};

export function ProposalWorkspace({
  proposalId,
  tenantSlug,
  sections: initialSections,
  hasEmptySections,
  proposalStage,
  isLocked,
  userRole,
  currentUserId,
  collaborators,
  compliance,
  dropboxFiles,
  gateConfig,
  lockCount,
  downloadCount,
  unlockDeadline,
  canAdvance,
  canUpload,
  canExport,
  canManageTeam,
  closeDate,
  proposalEvents,
}: ProposalWorkspaceProps) {
  const router = useRouter();
  const [sections, setSections] = useState(initialSections);
  const [showDrafter, setShowDrafter] = useState(hasEmptySections && userRole === 'admin');
  const [workspaceTab, setWorkspaceTab] = useState<'workspace' | 'timeline'>('workspace');

  const handleSectionDrafted = useCallback(
    (sectionId: string, nodes: CanvasNode[]) => {
      setSections((prev) =>
        prev.map((s) =>
          s.id === sectionId
            ? { ...s, status: 'ai_drafted', nodeCount: nodes.length }
            : s,
        ),
      );
    },
    [],
  );

  const handleDraftComplete = useCallback(() => {
    router.refresh();
  }, [router]);

  const emptySectionCount = sections.filter(
    (s) => s.status === 'empty' || s.nodeCount === 0,
  ).length;

  return (
    <div className="space-y-6">
      {/* Stage control bar */}
      <StageControl
        proposalId={proposalId}
        tenantSlug={tenantSlug}
        currentStage={proposalStage}
        gateConfig={gateConfig}
        isLocked={isLocked}
        lockCount={lockCount}
        downloadCount={downloadCount}
        unlockDeadline={unlockDeadline}
        canAdvance={canAdvance}
        canExport={canExport}
        closeDate={closeDate}
      />

      {/* Workspace-level tab bar */}
      <div className="flex gap-0 border-b border-gray-200">
        {([
          { key: 'workspace' as const, label: 'Workspace' },
          { key: 'timeline' as const, label: 'Timeline' },
        ]).map((tab) => (
          <button
            key={tab.key}
            onClick={() => setWorkspaceTab(tab.key)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              workspaceTab === tab.key
                ? 'text-blue-600 border-blue-600'
                : 'text-gray-500 border-transparent hover:text-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ─── Timeline Tab ────────────────────────────────────────────── */}
      {workspaceTab === 'timeline' && (
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">Proposal Activity Timeline</h3>
          <ProposalTimeline events={proposalEvents} />
        </div>
      )}

      {/* ─── Workspace Tab ───────────────────────────────────────────── */}
      {workspaceTab === 'workspace' && <>

      {/* Draft All Sections (admin only) */}
      {userRole === 'admin' && showDrafter && emptySectionCount > 0 && !isLocked && (
        <DraftAllSections
          proposalId={proposalId}
          sections={sections.map((s) => ({
            id: s.id,
            title: s.title,
            status: s.status,
            nodeCount: s.nodeCount,
            pageLimit: s.pageAllocation ?? undefined,
          }))}
          onSectionDrafted={handleSectionDrafted}
          onComplete={handleDraftComplete}
        />
      )}

      {/* Show AI Drafter toggle (admin only) */}
      {userRole === 'admin' && !showDrafter && emptySectionCount > 0 && !isLocked && (
        <div className="flex justify-end">
          <button
            onClick={() => setShowDrafter(true)}
            className="px-3 py-1.5 text-xs font-medium text-indigo-600 border border-indigo-200 rounded-lg hover:bg-indigo-50 transition-colors"
          >
            Show AI Drafter
          </button>
        </div>
      )}

      {/* Role-aware content */}
      {userRole === 'admin' ? (
        <ProposalAdminPanel
          proposalId={proposalId}
          tenantSlug={tenantSlug}
          sections={sections}
          collaborators={collaborators}
          compliance={compliance}
          currentUserId={currentUserId}
          dropboxFiles={dropboxFiles}
          hasEmptySections={hasEmptySections}
          isLocked={isLocked}
        />
      ) : (
        <ProposalContributorView
          proposalId={proposalId}
          tenantSlug={tenantSlug}
          sections={sections}
          currentUserId={currentUserId}
          dropboxFiles={dropboxFiles}
          canUpload={canUpload}
          isExternal={userRole === 'external'}
        />
      )}

      {/* Locked notice */}
      {isLocked && userRole !== 'admin' && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-sm text-yellow-800">
          This proposal is locked. Contact your admin to unlock it for editing.
        </div>
      )}

      <div className="text-xs text-gray-400 mt-4">
        Current stage: {proposalStage.replace(/_/g, ' ')} &middot; Role: {userRole}
      </div>

      </>}
    </div>
  );
}
