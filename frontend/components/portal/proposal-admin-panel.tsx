'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { TeamManager } from './team-manager';
import { ProposalDropbox } from './proposal-dropbox';
import { ProposalAiActions } from '@/app/portal/[tenantSlug]/proposals/[proposalId]/proposal-ai-actions';

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

interface ComplianceItem {
  id?: string;
  requirement?: string;
  status?: string;
  details?: string | null;
  label?: string;
  met?: boolean;
  value?: string;
}

interface DropboxFileEntry {
  key: string;
  filename: string;
  size: number;
  lastModified: string | null;
}

interface ProposalAdminPanelProps {
  proposalId: string;
  tenantSlug: string;
  sections: SectionItem[];
  collaborators: Collaborator[];
  compliance: { items?: ComplianceItem[]; source?: string } | null;
  currentUserId: string;
  dropboxFiles: DropboxFileEntry[];
  hasEmptySections: boolean;
  isLocked: boolean;
  proposalStage: string;
}

// ─── Status config ────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; badge: string }> = {
  empty:       { label: 'Empty',       badge: 'bg-gray-100 text-gray-400' },
  ai_drafted:  { label: 'AI Draft',    badge: 'bg-amber-100 text-amber-600' },
  in_progress: { label: 'In Progress', badge: 'bg-blue-100 text-blue-600' },
  complete:    { label: 'Complete',     badge: 'bg-emerald-100 text-emerald-600' },
  approved:    { label: 'Approved',     badge: 'bg-emerald-100 text-emerald-600' },
  review:      { label: 'Review',       badge: 'bg-amber-100 text-amber-600' },
  hidden:      { label: 'Hidden',       badge: 'bg-gray-100 text-gray-300' },
};

const FILE_ICONS: Record<string, { label: string; color: string }> = {
  docx: { label: 'DOC', color: 'bg-blue-100 text-blue-600' },
  doc:  { label: 'DOC', color: 'bg-blue-100 text-blue-600' },
  xlsx: { label: 'XLS', color: 'bg-green-100 text-green-600' },
  xls:  { label: 'XLS', color: 'bg-green-100 text-green-600' },
  pptx: { label: 'PPT', color: 'bg-yellow-100 text-yellow-700' },
  pdf:  { label: 'PDF', color: 'bg-red-100 text-red-600' },
  form: { label: 'FORM', color: 'bg-indigo-100 text-indigo-600' },
};

function getSectionIcon(title: string): { label: string; color: string } {
  const lower = title.toLowerCase();
  if (lower.includes('cost') || lower.includes('budget') || lower.includes('spreadsheet')) {
    return FILE_ICONS.xlsx;
  }
  if (lower.includes('certification') || lower.includes('form')) {
    return FILE_ICONS.form;
  }
  if (lower.includes('pdf') || lower.includes('report')) {
    return FILE_ICONS.pdf;
  }
  return FILE_ICONS.docx;
}

const AVATAR_COLORS = ['bg-blue-500', 'bg-emerald-500', 'bg-purple-500', 'bg-amber-500', 'bg-rose-500'];

function getInitials(name: string | null, email: string): string {
  if (name) {
    const parts = name.split(' ').filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return parts[0]?.slice(0, 2).toUpperCase() || email.slice(0, 2).toUpperCase();
  }
  return email.slice(0, 2).toUpperCase();
}

// ─── Component ────────────────────────────────────────────────────────

export function ProposalAdminPanel({
  proposalId,
  tenantSlug,
  sections,
  collaborators,
  compliance,
  currentUserId,
  dropboxFiles,
  hasEmptySections,
  isLocked,
  proposalStage,
}: ProposalAdminPanelProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<'artifacts' | 'team' | 'compliance' | 'ai'>('artifacts');

  const handleSectionClick = useCallback(
    (sectionId: string) => {
      router.push(
        `/portal/${tenantSlug}/proposals/${proposalId}/sections/${sectionId}`,
      );
    },
    [router, tenantSlug, proposalId],
  );

  // Group sections by volume (using section number prefix)
  const volumes = groupSectionsByVolume(sections);

  const complianceItems = compliance?.items || [];

  // Tabs
  const tabs = [
    { key: 'artifacts' as const, label: 'Artifacts' },
    { key: 'team' as const, label: 'Team & Access' },
    { key: 'compliance' as const, label: 'Compliance' },
    { key: 'ai' as const, label: 'AI & Library' },
  ];

  return (
    <div>
      {/* Tab bar */}
      <div className="flex gap-0 border-b border-gray-200 mb-5">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.key
                ? 'text-blue-600 border-blue-600'
                : 'text-gray-500 border-transparent hover:text-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ─── Artifacts Tab ────────────────────────────────────────── */}
      {activeTab === 'artifacts' && (
        <div>
          {volumes.map((volume) => (
            <div key={volume.label} className="mb-5">
              <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border border-gray-200 rounded-t-lg">
                <h3 className="text-sm font-semibold text-gray-700">{volume.label}</h3>
                <span className="text-xs text-gray-500">
                  {volume.sections.filter((s) => s.status === 'complete' || s.status === 'approved').length} of{' '}
                  {volume.sections.length} complete
                  {volume.totalPages > 0 && ` • ${volume.usedPages}/${volume.totalPages} pages`}
                </span>
              </div>
              <div className="border border-gray-200 border-t-0 rounded-b-lg">
                {volume.sections.map((section) => {
                  const icon = getSectionIcon(section.title);
                  const statusInfo = STATUS_CONFIG[section.status] || STATUS_CONFIG.empty;
                  const assignee = collaborators.find((c) => c.userId === section.assignedTo);
                  const assigneeIdx = assignee ? collaborators.indexOf(assignee) : -1;
                  const pagePercent = section.pageAllocation
                    ? Math.min(100, Math.round((section.nodeCount / (section.pageAllocation * 3)) * 100))
                    : 0;
                  const pageColor = pagePercent > 90 ? 'bg-amber-500' : pagePercent > 100 ? 'bg-red-500' : 'bg-emerald-500';

                  return (
                    <div
                      key={section.id}
                      className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 last:border-b-0 hover:bg-gray-50 transition-colors"
                    >
                      <div className={`w-8 h-8 rounded-md flex items-center justify-center text-[10px] font-bold flex-shrink-0 ${icon.color}`}>
                        {icon.label}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-gray-900">{section.title}</div>
                        <div className="text-xs text-gray-400 mt-0.5">
                          {section.pageAllocation ? `${section.pageAllocation} page limit` : 'No page limit'}
                          {section.nodeCount > 0 && ` • v${section.version}`}
                        </div>
                      </div>

                      {/* Assignee */}
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        {assignee ? (
                          <>
                            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-semibold text-white ${AVATAR_COLORS[assigneeIdx % AVATAR_COLORS.length]}`}>
                              {getInitials(assignee.name, assignee.email)}
                            </div>
                            <span className="text-xs text-gray-500">{assignee.name?.split(' ')[0] || assignee.email.split('@')[0]}</span>
                          </>
                        ) : (
                          <span className="text-xs text-gray-300">Unassigned</span>
                        )}
                      </div>

                      {/* Page progress */}
                      {section.pageAllocation ? (
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <div className="w-20 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                            <div className={`h-full rounded-full ${pageColor}`} style={{ width: `${pagePercent}%` }} />
                          </div>
                          <span className="text-xs text-gray-500 w-8">{section.nodeCount > 0 ? `${Math.ceil(section.nodeCount / 3)}/${section.pageAllocation}` : ''}</span>
                        </div>
                      ) : (
                        <div className="w-[100px]" />
                      )}

                      {/* Status */}
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wider flex-shrink-0 ${statusInfo.badge}`}>
                        {statusInfo.label}
                      </span>

                      {/* Action */}
                      <button
                        onClick={() => handleSectionClick(section.id)}
                        className="px-2.5 py-1 text-xs font-medium text-gray-500 border border-gray-200 rounded-md hover:bg-gray-100 flex-shrink-0 transition-colors"
                      >
                        Open
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          {/* Dropboxes */}
          {collaborators.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-xl p-5 mt-2">
              <h3 className="text-sm font-semibold text-gray-900 mb-3">Team Dropboxes</h3>
              <div className="grid grid-cols-3 gap-3">
                {collaborators.map((collab, idx) => (
                  <div key={collab.id} className="border border-gray-200 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-semibold text-white ${AVATAR_COLORS[idx % AVATAR_COLORS.length]}`}>
                        {getInitials(collab.name, collab.email)}
                      </div>
                      <span className="text-xs font-semibold text-gray-700">
                        {collab.name ? `${collab.name.split(' ')[0]}'s Files` : collab.email}
                      </span>
                    </div>
                    <ProposalDropbox
                      proposalId={proposalId}
                      tenantSlug={tenantSlug}
                      userId={collab.userId || collab.id}
                      userName={collab.name || undefined}
                      files={dropboxFiles.filter((f) =>
                        f.key.includes(`/dropbox/${collab.userId || collab.id}/`),
                      )}
                      canDelete={true}
                      canUpload={false}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── Team & Access Tab ────────────────────────────────────── */}
      {activeTab === 'team' && (
        <TeamManager
          proposalId={proposalId}
          tenantSlug={tenantSlug}
          collaborators={collaborators}
          sections={sections.map((s) => ({
            id: s.id,
            title: s.title,
            sectionNumber: s.sectionNumber,
          }))}
          canManage={true}
        />
      )}

      {/* ─── Compliance Tab ───────────────────────────────────────── */}
      {activeTab === 'compliance' && (
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">Compliance Checklist</h3>
          {complianceItems.length > 0 ? (
            <div className="space-y-2">
              {complianceItems.map((item, idx) => {
                const label = item.requirement || item.label || `Item ${idx + 1}`;
                const passed = item.status === 'met' || item.status === 'pass' || item.met === true;
                const failed = item.status === 'failed' || item.status === 'fail' || item.met === false;
                const pending = !passed && !failed;

                return (
                  <div key={item.id || idx} className="flex items-center gap-2.5 py-2 text-sm">
                    <div
                      className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] flex-shrink-0 ${
                        passed
                          ? 'bg-emerald-100 text-emerald-600'
                          : failed
                            ? 'bg-red-100 text-red-600'
                            : 'bg-gray-100 text-gray-400'
                      }`}
                    >
                      {passed ? '✓' : failed ? '✗' : '?'}
                    </div>
                    <span className="flex-1 text-gray-700">{label}</span>
                    {(item.details || item.value) && (
                      <span
                        className={`text-xs ml-auto flex-shrink-0 ${
                          passed ? 'text-emerald-600' : failed ? 'text-red-500' : 'text-gray-400'
                        }`}
                      >
                        {item.details || item.value}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-gray-400">
              No compliance data available. Compliance matrix will be populated when the proposal is provisioned from a solicitation.
            </p>
          )}
        </div>
      )}

      {/* ─── AI & Library Tab ─────────────────────────────────────── */}
      {activeTab === 'ai' && (
        <ProposalAiActions
          tenantSlug={tenantSlug}
          proposalId={proposalId}
          stage={proposalStage}
          userRole="admin"
          isLocked={isLocked}
        />
      )}
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────

interface VolumeGroup {
  label: string;
  sections: (SectionItem & { nodeCount: number })[];
  totalPages: number;
  usedPages: number;
}

function groupSectionsByVolume(sections: SectionItem[]): VolumeGroup[] {
  // Group by section number prefix (e.g., "1.1" and "1.2" go into volume 1)
  const groups = new Map<string, VolumeGroup>();

  for (const section of sections) {
    const prefix = section.sectionNumber.split('.')[0] || '1';
    const key = prefix;

    if (!groups.has(key)) {
      const volumeNames: Record<string, string> = {
        '1': 'Volume 1: Technical Volume',
        '2': 'Volume 2: Cost Volume',
        '3': 'Volume 3: Supporting Documents',
      };
      groups.set(key, {
        label: volumeNames[prefix] || `Volume ${prefix}`,
        sections: [],
        totalPages: 0,
        usedPages: 0,
      });
    }

    const group = groups.get(key)!;
    group.sections.push(section);
    if (section.pageAllocation) {
      group.totalPages += section.pageAllocation;
      group.usedPages += Math.min(
        section.pageAllocation,
        Math.ceil(section.nodeCount / 3),
      );
    }
  }

  // If no volume groups were created (all section numbers are flat),
  // put everything into a single "All Sections" volume
  if (groups.size === 0 && sections.length > 0) {
    return [
      {
        label: 'All Sections',
        sections,
        totalPages: sections.reduce((sum, s) => sum + (s.pageAllocation || 0), 0),
        usedPages: sections.reduce(
          (sum, s) => sum + Math.min(s.pageAllocation || 0, Math.ceil(s.nodeCount / 3)),
          0,
        ),
      },
    ];
  }

  return Array.from(groups.values());
}
