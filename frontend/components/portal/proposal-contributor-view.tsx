'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { ProposalDropbox } from './proposal-dropbox';

interface SectionItem {
  id: string;
  sectionNumber: string;
  title: string;
  status: string;
  pageAllocation: number | null;
  version: number;
  nodeCount: number;
  permission: 'edit' | 'comment' | 'view' | 'none';
}

interface DropboxFileEntry {
  key: string;
  filename: string;
  size: number;
  lastModified: string | null;
}

interface ProposalContributorViewProps {
  proposalId: string;
  tenantSlug: string;
  sections: SectionItem[];
  currentUserId: string;
  dropboxFiles: DropboxFileEntry[];
  canUpload: boolean;
  isExternal: boolean;
}

const STATUS_CONFIG: Record<string, { label: string; badge: string }> = {
  empty:       { label: 'Empty',       badge: 'bg-gray-100 text-gray-400' },
  ai_drafted:  { label: 'AI Draft',    badge: 'bg-amber-100 text-amber-600' },
  in_progress: { label: 'In Progress', badge: 'bg-blue-100 text-blue-600' },
  complete:    { label: 'Complete',     badge: 'bg-emerald-100 text-emerald-600' },
  approved:    { label: 'Approved',     badge: 'bg-emerald-100 text-emerald-600' },
  review:      { label: 'Review',       badge: 'bg-amber-100 text-amber-600' },
  hidden:      { label: 'Hidden',       badge: 'bg-gray-100 text-gray-300' },
};

export function ProposalContributorView({
  proposalId,
  tenantSlug,
  sections,
  currentUserId,
  dropboxFiles,
  canUpload,
  isExternal,
}: ProposalContributorViewProps) {
  const router = useRouter();

  const handleSectionClick = useCallback(
    (sectionId: string) => {
      router.push(
        `/portal/${tenantSlug}/proposals/${proposalId}/sections/${sectionId}`,
      );
    },
    [router, tenantSlug, proposalId],
  );

  // Partition sections by access level
  const editSections = sections.filter((s) => s.permission === 'edit');
  const commentSections = sections.filter((s) => s.permission === 'comment');
  const viewSections = sections.filter((s) => s.permission === 'view');
  const hiddenSections = sections.filter((s) => s.permission === 'none');

  return (
    <div className="space-y-5">
      {/* My Assignments (editable sections) */}
      {editSections.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-3">
            {isExternal ? 'Shared With Me' : 'My Assignments'}
          </h3>
          {isExternal && (
            <p className="text-xs text-gray-400 mb-3">
              You were invited as an external collaborator.
            </p>
          )}

          {editSections.map((section) => {
            const statusInfo = STATUS_CONFIG[section.status] || STATUS_CONFIG.empty;
            const pagePercent = section.pageAllocation
              ? Math.min(100, Math.round((section.nodeCount / (section.pageAllocation * 3)) * 100))
              : 0;

            return (
              <div
                key={section.id}
                className="border-l-[3px] border-blue-600 pl-3 mb-3"
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-gray-900">{section.title}</span>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${statusInfo.badge}`}>
                      {statusInfo.label}
                    </span>
                  </div>
                  <button
                    onClick={() => handleSectionClick(section.id)}
                    className="px-3 py-1.5 text-xs font-semibold bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
                  >
                    Open Editor →
                  </button>
                </div>
                <div className="flex items-center gap-4 text-xs text-gray-400">
                  {section.pageAllocation && (
                    <>
                      <span>
                        {Math.ceil(section.nodeCount / 3)} of {section.pageAllocation} pages
                      </span>
                      <div className="w-24 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${pagePercent > 90 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                          style={{ width: `${pagePercent}%` }}
                        />
                      </div>
                    </>
                  )}
                  {section.nodeCount > 0 && <span>v{section.version}</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* My Dropbox */}
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-gray-900 mb-3">My Dropbox</h3>
        <ProposalDropbox
          proposalId={proposalId}
          tenantSlug={tenantSlug}
          userId={currentUserId}
          files={dropboxFiles}
          canDelete={true}
          canUpload={canUpload}
        />
      </div>

      {/* Comment-only sections */}
      {commentSections.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-gray-400 mb-3">
            Sections (Comment Only)
          </h3>
          {commentSections.map((section) => (
            <div key={section.id} className="border-l-[3px] border-gray-200 pl-3 mb-3 opacity-70">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-700">{section.title}</span>
                  <span className="text-[10px] text-amber-500">Can comment</span>
                </div>
                <button
                  onClick={() => handleSectionClick(section.id)}
                  className="px-2.5 py-1 text-xs font-medium text-gray-500 border border-gray-200 rounded-md hover:bg-gray-100 transition-colors"
                >
                  View & Comment
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* View-only sections */}
      {(viewSections.length > 0 || hiddenSections.length > 0) && (
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-gray-400 mb-3">
            Other Sections (View Only)
          </h3>
          {viewSections.map((section) => (
            <div key={section.id} className="border-l-[3px] border-gray-200 pl-3 mb-3 opacity-70">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-700">{section.title}</span>
                  <span className="text-[10px] text-gray-400">View only</span>
                </div>
                <button
                  onClick={() => handleSectionClick(section.id)}
                  className="px-2.5 py-1 text-xs font-medium text-gray-500 border border-gray-200 rounded-md hover:bg-gray-100 transition-colors"
                >
                  View
                </button>
              </div>
            </div>
          ))}
          {hiddenSections.length > 0 && (
            <div className="text-xs text-gray-300 pt-1 pl-4">
              {hiddenSections.map((s) => (
                <div key={s.id} className="mb-0.5">
                  {s.title} — <em>No access</em>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
