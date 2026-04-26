'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { DraftAllSections } from '@/components/canvas/draft-all-sections';
import type { CanvasNode } from '@/lib/types/canvas-document';

interface SectionItem {
  id: string;
  sectionNumber: string;
  title: string;
  status: string;
  pageAllocation: number | null;
  version: number;
  nodeCount: number;
}

interface ProposalWorkspaceProps {
  proposalId: string;
  tenantSlug: string;
  sections: SectionItem[];
  hasEmptySections: boolean;
  proposalStage: string;
  isLocked: boolean;
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
}: ProposalWorkspaceProps) {
  const router = useRouter();
  const [sections, setSections] = useState(initialSections);
  const [showDrafter, setShowDrafter] = useState(hasEmptySections);

  const handleSectionClick = useCallback(
    (sectionId: string) => {
      router.push(
        `/portal/${tenantSlug}/proposals/${proposalId}/sections/${sectionId}`,
      );
    },
    [router, tenantSlug, proposalId],
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
      {/* Draft All Sections */}
      {showDrafter && emptySectionCount > 0 && !isLocked && (
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

      {/* Actions Bar */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">
          Sections ({sections.length})
        </h2>
        <div className="flex items-center gap-2">
          {!showDrafter && emptySectionCount > 0 && !isLocked && (
            <button
              onClick={() => setShowDrafter(true)}
              className="px-3 py-1.5 text-xs font-medium text-indigo-600 border border-indigo-200 rounded-lg hover:bg-indigo-50 transition-colors"
            >
              Show AI Drafter
            </button>
          )}
          <button
            disabled
            className="px-3 py-1.5 text-xs font-medium text-gray-400 border border-gray-200 rounded-lg cursor-not-allowed"
            title="Export coming soon"
          >
            Export All as .docx
          </button>
        </div>
      </div>

      {/* Section List */}
      <div className="space-y-2">
        {sections.map((section) => {
          const statusInfo = STATUS_CONFIG[section.status] ?? {
            label: section.status,
            color: 'text-gray-500',
            dotColor: 'bg-gray-300',
          };

          return (
            <button
              key={section.id}
              onClick={() => handleSectionClick(section.id)}
              className="w-full text-left bg-white border border-gray-200 rounded-lg p-4 hover:border-indigo-300 hover:shadow-sm transition-all group"
            >
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-xs text-gray-400 font-mono w-6 text-right flex-shrink-0">
                    {section.sectionNumber}
                  </span>
                  <div className="min-w-0">
                    <h3 className="font-medium text-gray-900 truncate group-hover:text-indigo-600 transition-colors">
                      {section.title}
                    </h3>
                    <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                      {section.pageAllocation != null && (
                        <span>{section.pageAllocation} page limit</span>
                      )}
                      {section.nodeCount > 0 && (
                        <span>{section.nodeCount} node{section.nodeCount !== 1 ? 's' : ''}</span>
                      )}
                      <span>v{section.version}</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className={`w-2 h-2 rounded-full ${statusInfo.dotColor}`} />
                  <span className={`text-xs font-medium ${statusInfo.color}`}>
                    {statusInfo.label}
                  </span>
                  <svg
                    className="w-4 h-4 text-gray-300 group-hover:text-indigo-400 transition-colors"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 5l7 7-7 7"
                    />
                  </svg>
                </div>
              </div>
            </button>
          );
        })}
        {sections.length === 0 && (
          <div className="text-center py-12 text-gray-400">
            <p className="text-lg">No sections yet.</p>
            <p className="text-sm mt-2">
              Sections will be created when a proposal is provisioned from a topic with required items.
            </p>
          </div>
        )}
      </div>

      {/* Locked notice */}
      {isLocked && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-sm text-yellow-800">
          This proposal is locked. Contact your admin to unlock it for editing.
        </div>
      )}

      <div className="text-xs text-gray-400 mt-4">
        Current stage: {proposalStage.replace(/_/g, ' ')}
      </div>
    </div>
  );
}
