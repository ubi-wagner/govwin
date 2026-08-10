'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { DraftAllSections } from '@/components/canvas/draft-all-sections';

// The fluid whole-proposal "Document" view pulls in the full canvas renderer — load it
// only when the reader opens the tab (no ref is forwarded, so ssr:false is safe here).
const FluidDocumentTab = dynamic(
  () => import('./fluid-document-tab').then((m) => m.FluidDocumentTab),
  { ssr: false, loading: () => <div className="py-20 text-center text-sm text-gray-400">Loading document view…</div> },
);
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
  completedStage?: string | null;
  completedAt?: string | null;
  acceptedByName?: string | null;
  isEditable?: boolean;
  isLocked?: boolean;
  volumeName?: string | null;
  volumeNumber?: number | null;
  expertNotes?: string | null;
}

interface StageHistoryEntry {
  stage: string;
  completedByName: string | null;
  completedAt: string;
  totalSections: number;
  sectionsComplete: number;
  sectionsApproved: number;
  notes: string | null;
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
  revokedAt: string | null;
  active: boolean;
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
  // Opportunity context slugs (agency/program) that boost atom ranking in the drafter.
  contextSlugs?: string[];
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
  stageCompletionHistory?: StageHistoryEntry[];
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
  contextSlugs,
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
  stageCompletionHistory,
  proposalEvents,
}: ProposalWorkspaceProps) {
  const router = useRouter();
  const [sections, setSections] = useState(initialSections);
  const [showDrafter, setShowDrafter] = useState(hasEmptySections && userRole === 'admin');
  const [workspaceTab, setWorkspaceTab] = useState<'workspace' | 'my-sections' | 'document' | 'timeline'>(
    userRole !== 'admin' ? 'my-sections' : 'workspace',
  );

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
        userRole={userRole}
        closeDate={closeDate}
      />

      {/* Workspace-level tab bar */}
      <div className="flex gap-0 border-b border-gray-200">
        {([
          { key: 'workspace' as const, label: userRole === 'admin' ? 'All Sections' : 'All' },
          { key: 'my-sections' as const, label: 'My Sections' },
          // Whole-proposal fluid document view — the reader surface (tenant members).
          ...(userRole === 'admin' ? [{ key: 'document' as const, label: 'Document' }] : []),
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
        <div className="space-y-6">
          {/* Stage Completion History */}
          {stageCompletionHistory && stageCompletionHistory.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-xl p-5">
              <h3 className="text-sm font-semibold text-gray-900 mb-4">Stage Completion History</h3>
              <div className="space-y-3">
                {stageCompletionHistory.map((h, idx) => (
                  <div key={idx} className="flex items-start gap-3 border-l-2 border-emerald-300 pl-4 py-2">
                    <div className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center text-xs font-bold flex-shrink-0">
                      {idx + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 capitalize">
                        {h.stage} completed
                        {h.completedByName && (
                          <span className="text-gray-500 font-normal"> by {h.completedByName}</span>
                        )}
                      </p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {new Date(h.completedAt).toLocaleDateString('en-US', {
                          month: 'long',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                        {' -- '}
                        {h.totalSections} sections, {h.sectionsComplete} complete, {h.sectionsApproved} approved
                      </p>
                      {h.notes && (
                        <p className="text-xs text-gray-400 italic mt-0.5">{h.notes}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-gray-900 mb-4">Proposal Activity Timeline</h3>
            <ProposalTimeline events={proposalEvents} />
          </div>
        </div>
      )}

      {/* ─── My Sections Tab ─────────────────────────────────────────── */}
      {workspaceTab === 'my-sections' && (() => {
        const mySections = sections.filter(
          (s) => s.assignedTo === currentUserId || s.permission === 'edit' || s.permission === 'comment',
        );
        return (
          <div className="space-y-3">
            {mySections.length === 0 ? (
              <div className="bg-gray-50 border border-gray-200 rounded-xl p-8 text-center text-sm text-gray-500">
                No sections are assigned to you yet.
                {userRole === 'admin' && ' Use the All Sections tab to assign sections to team members.'}
              </div>
            ) : (
              mySections.map((section) => {
                const config = STATUS_CONFIG[section.status] ?? STATUS_CONFIG['empty'];
                return (
                  <a
                    key={section.id}
                    href={`/portal/${tenantSlug}/proposals/${proposalId}/sections/${section.id}`}
                    className="block bg-white border border-gray-200 rounded-xl p-4 hover:border-blue-300 hover:shadow-sm transition-all"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${config.dotColor}`} />
                        <div>
                          <p className="text-sm font-medium text-gray-900">
                            {section.sectionNumber}. {section.title}
                          </p>
                          {section.pageAllocation && (
                            <p className="text-xs text-gray-400 mt-0.5">{section.pageAllocation} pages</p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`text-xs font-medium ${config.color}`}>{config.label}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          section.permission === 'edit' ? 'bg-blue-100 text-blue-700' :
                          section.permission === 'comment' ? 'bg-amber-100 text-amber-700' :
                          'bg-gray-100 text-gray-600'
                        }`}>
                          {section.permission}
                        </span>
                      </div>
                    </div>
                  </a>
                );
              })
            )}
          </div>
        );
      })()}

      {/* ─── Document Tab (fluid whole-proposal view) ────────────────── */}
      {workspaceTab === 'document' && (
        <FluidDocumentTab tenantSlug={tenantSlug} proposalId={proposalId} />
      )}

      {/* ─── Workspace Tab ───────────────────────────────────────────── */}
      {workspaceTab === 'workspace' && <>

      {/* Draft All Sections (admin only) */}
      {userRole === 'admin' && showDrafter && emptySectionCount > 0 && !isLocked && (
        <DraftAllSections
          proposalId={proposalId}
          tenantSlug={tenantSlug}
          context={contextSlugs}
          sections={sections.map((s) => ({
            id: s.id,
            title: s.title,
            status: s.status,
            nodeCount: s.nodeCount,
            pageLimit: s.pageAllocation ?? undefined,
            expertNotes: s.expertNotes ?? undefined,
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
          proposalStage={proposalStage}
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
          {lockCount === 0
            ? 'This proposal is under admin review. Our team is reviewing the section skeleton and compliance matrix to ensure quality. You will be notified when it is ready for your input.'
            : 'This proposal is locked. Contact your admin to unlock it for editing.'}
        </div>
      )}

      <div className="text-xs text-gray-400 mt-4">
        Current stage: {proposalStage.replace(/_/g, ' ')} &middot; Role: {userRole}
      </div>

      </>}
    </div>
  );
}
