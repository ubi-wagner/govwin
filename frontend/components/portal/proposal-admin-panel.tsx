'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { TeamManager } from './team-manager';
import { ProposalDropbox } from './proposal-dropbox';
import { VolumeLayoutGauge } from './volume-layout-gauge';
import { SaveAsTemplate } from './save-as-template';
import { SectionComplianceChip } from './section-compliance-chip';
import { LibrarySeedPanel } from './library-seed-panel';
import { ProposalAiActions } from '@/app/portal/[tenantSlug]/proposals/[proposalId]/proposal-ai-actions';
import { SubmissionReadinessCard } from '@/components/portal/submission-readiness-card';

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
  artifactId?: string | null;
  itemType?: string | null;
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

interface ComplianceItem {
  id?: string;
  requirement?: string;
  status?: string;
  details?: string | null;
  label?: string;
  met?: boolean;
  value?: string;
  sectionId?: string | null;
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

// The AUTHORED item type (persisted at provision from the solicitation's volume spec) is the
// source of truth for the glyph. The title heuristic below only runs as a fallback for legacy
// sections with no itemType — it mis-fires on prose whose TITLE happens to contain a keyword
// ("Budget *Narrative*" → XLS, "Pro-*forma*" → FORM) even though the section is a word doc.
const ITEM_TYPE_ICON: Record<string, { label: string; color: string }> = {
  word_doc: FILE_ICONS.docx,
  text: FILE_ICONS.docx,
  slide_deck: FILE_ICONS.pptx,
  spreadsheet: FILE_ICONS.xlsx,
  pdf: FILE_ICONS.pdf,
  form_sf424: FILE_ICONS.form,
  form_sbir_certs: FILE_ICONS.form,
  form_other: FILE_ICONS.form,
  other: FILE_ICONS.docx,
};

function getSectionIcon(title: string, itemType?: string | null): { label: string; color: string } {
  if (itemType && ITEM_TYPE_ICON[itemType]) return ITEM_TYPE_ICON[itemType];
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
  const [activeTab, setActiveTab] = useState<'artifacts' | 'team' | 'compliance' | 'ai' | 'seed'>('artifacts');
  const [advancing, setAdvancing] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [exportMessage, setExportMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [complianceLoading, setComplianceLoading] = useState(false);
  const [packageLoading, setPackageLoading] = useState(false);
  const [packageMsg, setPackageMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [complianceResults, setComplianceResults] = useState<{
    totalVariables: number;
    passed: number;
    failed: number;
    partial: number;
    checks: Array<{
      variableId: string;
      variableName: string;
      status: string;
      excerpt: string | null;
      suggestion: string | null;
    }>;
  } | null>(null);
  const [complianceError, setComplianceError] = useState<string | null>(null);
  const [gateRequirements, setGateRequirements] = useState<Array<{
    id: string;
    stage: string;
    requirementType: string;
    label: string;
    description: string | null;
    isMet: boolean;
    metBy: string | null;
    metAt: string | null;
  }>>([]);
  const [gatesLoading, setGatesLoading] = useState(false);
  const [gatesLoaded, setGatesLoaded] = useState(false);
  const [lockOverrides, setLockOverrides] = useState<Record<string, boolean>>({});
  const [lockPending, setLockPending] = useState<string | null>(null);
  const [lockingAll, setLockingAll] = useState(false);
  const [gateError, setGateError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [newGateLabel, setNewGateLabel] = useState('');
  const [newGateStage, setNewGateStage] = useState('');
  const [addingGate, setAddingGate] = useState(false);

  const handleSectionClick = useCallback(
    (sectionId: string) => {
      router.push(
        `/portal/${tenantSlug}/proposals/${proposalId}/sections/${sectionId}`,
      );
    },
    [router, tenantSlug, proposalId],
  );

  // ── Export Package handler ───────────────────────────────────
  // format=docx → one assembled Word doc; format=pdf → one print-fidelity PDF
  // (Chromium render: tables + inline figures + repeating header/footer + page
  // numbers); format=zip → each volume in its NATIVE format (docx/pptx/xlsx/pdf)
  // bundled into a .zip (lossless for mixed proposals).
  const handleExport = useCallback(async (fmt: 'docx' | 'pdf' | 'zip' = 'docx') => {
    setExportLoading(true);
    setExportMessage(null);
    try {
      const res = await fetch(
        `/api/portal/${tenantSlug}/proposals/${proposalId}/package?format=${fmt}`,
        { method: 'POST' },
      );
      if (!res.ok) {
        const json = await res.json().catch(() => ({ error: 'Export failed' }));
        setExportMessage({ type: 'error', text: json.error || 'Export failed' });
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `proposal-${proposalId.slice(0, 8)}.${fmt}`;
      a.click();
      URL.revokeObjectURL(url);
      setExportMessage({ type: 'success', text: `Proposal exported (.${fmt})` });
    } catch {
      setExportMessage({ type: 'error', text: 'Network error' });
    } finally {
      setExportLoading(false);
    }
  }, [tenantSlug, proposalId]);

  // ── Compliance Check handler ──────────────────────────────
  // Submission package — enqueue the packaging_specialist (manifest: volume completeness, required
  // forms, page/format compliance). Advisory; the agent never marks the proposal submitted.
  const handlePackageReview = useCallback(async () => {
    setPackageLoading(true);
    setPackageMsg(null);
    try {
      const res = await fetch(`/api/portal/${tenantSlug}/proposals/${proposalId}/package-review`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPackageMsg({ type: 'error', text: j.error || 'Package review failed' });
      } else {
        setPackageMsg({ type: 'success', text: 'Package review queued — the packaging specialist will compile the manifest (volumes, forms, format).' });
      }
    } catch {
      setPackageMsg({ type: 'error', text: 'Network error' });
    } finally {
      setPackageLoading(false);
    }
  }, [tenantSlug, proposalId]);

  const handleComplianceCheck = useCallback(async () => {
    setComplianceLoading(true);
    setComplianceError(null);
    setComplianceResults(null);
    try {
      const res = await fetch(
        `/api/portal/${tenantSlug}/proposals/${proposalId}/ai/compliance`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        },
      );
      if (!res.ok) {
        const json = await res.json().catch(() => ({ error: 'Check failed' }));
        setComplianceError(json.error || 'Compliance check failed');
        return;
      }
      const json = await res.json();
      setComplianceResults(json.data);
    } catch {
      setComplianceError('Network error');
    } finally {
      setComplianceLoading(false);
    }
  }, [tenantSlug, proposalId]);

  // ── Gate Requirements handlers ────────────────────────────
  const fetchGates = useCallback(async () => {
    setGatesLoading(true);
    setGateError(null);
    try {
      const res = await fetch(
        `/api/portal/${tenantSlug}/proposals/${proposalId}/gates`,
      );
      if (!res.ok) {
        const json = await res.json().catch(() => ({ error: 'Failed to load' }));
        setGateError(json.error || 'Failed to load gates');
        return;
      }
      const json = await res.json();
      setGateRequirements(json.data?.requirements ?? []);
      setGatesLoaded(true);
    } catch {
      setGateError('Network error');
    } finally {
      setGatesLoading(false);
    }
  }, [tenantSlug, proposalId]);

  const handleToggleGate = useCallback(async (reqId: string, isMet: boolean) => {
    try {
      const res = await fetch(
        `/api/portal/${tenantSlug}/proposals/${proposalId}/gates`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ requirementId: reqId, isMet }),
        },
      );
      if (res.ok) {
        setGateRequirements((prev) =>
          prev.map((g) => (g.id === reqId ? { ...g, isMet } : g)),
        );
      } else {
        const json = await res.json().catch(() => ({ error: 'Failed to update gate' }));
        setGateError(json.error || 'Failed to update gate');
      }
    } catch {
      setGateError('Network error toggling gate');
    }
  }, [tenantSlug, proposalId]);

  const handleAddGate = useCallback(async () => {
    if (!newGateLabel.trim() || !newGateStage.trim()) return;
    setAddingGate(true);
    setGateError(null);
    try {
      const res = await fetch(
        `/api/portal/${tenantSlug}/proposals/${proposalId}/gates`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            stage: newGateStage,
            requirementType: 'custom',
            label: newGateLabel.trim(),
          }),
        },
      );
      if (res.ok) {
        const json = await res.json();
        setGateRequirements((prev) => [...prev, json.data]);
        setNewGateLabel('');
        setNewGateStage('');
      } else {
        const json = await res.json().catch(() => ({ error: 'Failed to add gate' }));
        setGateError(json.error || 'Failed to add gate');
      }
    } catch {
      setGateError('Network error adding gate');
    } finally {
      setAddingGate(false);
    }
  }, [tenantSlug, proposalId, newGateLabel, newGateStage]);

  // Accept + lock / unlock a section (admin action; server-enforced + audited).
  const handleToggleLock = useCallback(async (sectionId: string, currentlyLocked: boolean) => {
    setLockPending(sectionId);
    setActionError(null);
    try {
      const res = await fetch(
        `/api/portal/${tenantSlug}/proposals/${proposalId}/sections/${sectionId}/lock`,
        { method: currentlyLocked ? 'DELETE' : 'POST' },
      );
      if (res.ok) {
        setLockOverrides((prev) => ({ ...prev, [sectionId]: !currentlyLocked }));
        // If this lock completed the document and the tenant opted into
        // auto-advance, the proposal moved a stage — refresh so the stage badge
        // and gate controls reflect the new state.
        try {
          const json = await res.json();
          if (json?.data?.autoAdvancedTo) router.refresh();
        } catch {
          /* no/again non-JSON body — nothing to react to */
        }
      } else {
        const j = await res.json().catch(() => ({}));
        setActionError(j.error || `Could not ${currentlyLocked ? 'unlock' : 'accept & lock'} the section.`);
      }
    } catch {
      setActionError('Network error — please try again.');
    } finally {
      setLockPending(null);
    }
  }, [tenantSlug, proposalId, router]);

  // Hierarchical push — lock every lockable canvas in a scope (volume / artifact /
  // whole proposal) via the lock-scope route. Each canvas STILL locks + audits per
  // the per-section stricture (server loops lockSectionCore); the artifact/volume/
  // proposal roll-ups fire as the last canvas in each scope locks.
  const [scopeBusy, setScopeBusy] = useState<string | null>(null);
  const lockScope = useCallback(
    async (scope: 'volume' | 'artifact' | 'proposal', key?: number | string) => {
      if (scopeBusy) return;
      setScopeBusy(`${scope}:${key ?? 'all'}`);
      setActionError(null);
      try {
        const body: Record<string, unknown> = { scope };
        if (scope === 'volume') body.volumeNumber = key;
        if (scope === 'artifact') body.artifactId = key;
        const res = await fetch(`/api/portal/${tenantSlug}/proposals/${proposalId}/lock-scope`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (res.ok) {
          router.refresh();
        } else {
          const j = await res.json().catch(() => ({}));
          setActionError(j.error || 'Could not lock this scope — some sections may not be ready.');
        }
      } catch {
        setActionError('Network error — please try again.');
      } finally {
        setScopeBusy(null);
      }
    },
    [scopeBusy, tenantSlug, proposalId, router],
  );

  // Bulk "Accept & Lock All" — locks every unlocked, draftable section so the
  // whole document can advance in one click. Reuses the per-section lock route,
  // so each lock emits section.locked + harvests + (on the last) document.locked
  // and proposal.advance_ready. The advance gate then passes.
  const handleLockAll = useCallback(async () => {
    if (lockingAll) return;
    const targets = sections.filter(
      (s) => !(lockOverrides[s.id] ?? !!s.isLocked) && s.status !== 'empty' && s.nodeCount > 0,
    );
    if (targets.length === 0) return;
    setLockingAll(true);
    setActionError(null);
    let failed = 0;
    try {
      for (const s of targets) {
        try {
          const res = await fetch(
            `/api/portal/${tenantSlug}/proposals/${proposalId}/sections/${s.id}/lock`,
            { method: 'POST' },
          );
          if (res.ok) setLockOverrides((prev) => ({ ...prev, [s.id]: true }));
          else failed += 1;
        } catch {
          failed += 1;
        }
      }
      if (failed > 0) {
        setActionError(`${failed} of ${targets.length} section${targets.length > 1 ? 's' : ''} could not be locked — try again or lock them individually.`);
      }
      router.refresh();
    } finally {
      setLockingAll(false);
    }
  }, [sections, lockOverrides, lockingAll, tenantSlug, proposalId, router]);

  // Force-advance V0.5 → complete V1 without locking every section (Eric's "lock all
  // OR force advance"). Hits the advance core with force=true (records the still-open
  // sections as the audit trail); advancing to 'final' auto-locks → 'submitted'.
  const handleForceAdvance = useCallback(async () => {
    if (advancing) return;
    if (!window.confirm('Force-advance this proposal to V1 (complete)? Sections that are not locked will be advanced as-is and recorded.')) return;
    setAdvancing(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/portal/${tenantSlug}/proposals/${proposalId}/advance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetStage: 'final', force: true }),
      });
      if (res.ok) {
        router.refresh();
      } else {
        const j = await res.json().catch(() => ({}));
        setActionError(j.error || 'Could not force-advance the proposal.');
      }
    } catch {
      setActionError('Network error — please try again.');
    } finally {
      setAdvancing(false);
    }
  }, [advancing, tenantSlug, proposalId, router]);

  const isSectionLocked = (s: SectionItem) => lockOverrides[s.id] ?? !!s.isLocked;

  // Group sections by document/volume (real matrix identity, prefix fallback).
  const volumes = groupSectionsByVolume(sections);
  const unlockedLockable = sections.filter(
    (s) => !isSectionLocked(s) && s.status !== 'empty' && s.nodeCount > 0,
  );

  const complianceItems = compliance?.items || [];

  // Tabs
  const tabs = [
    { key: 'artifacts' as const, label: 'Artifacts' },
    { key: 'team' as const, label: 'Team & Access' },
    { key: 'compliance' as const, label: 'Compliance' },
    { key: 'ai' as const, label: 'AI & Library' },
    { key: 'seed' as const, label: 'Library Seed' },
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
          {actionError && (
            <p className="text-xs text-red-500 mb-3 px-4 py-2 bg-red-50 border border-red-200 rounded-md" role="alert">{actionError}</p>
          )}
          {unlockedLockable.length > 0 && (
            <div className="flex items-center justify-between mb-4 px-4 py-3 bg-indigo-50 border border-indigo-200 rounded-lg">
              <p className="text-xs text-indigo-800">
                {unlockedLockable.length} section{unlockedLockable.length > 1 ? 's' : ''} drafted and ready to accept &amp; lock for this stage.
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleLockAll}
                  disabled={lockingAll || advancing}
                  className="px-3 py-1.5 text-xs font-semibold bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                >
                  {lockingAll ? 'Locking…' : `Accept & Lock All (${unlockedLockable.length})`}
                </button>
                <button
                  onClick={handleForceAdvance}
                  disabled={advancing || lockingAll}
                  title="Skip locking and advance straight to complete V1"
                  className="px-3 py-1.5 text-xs font-semibold text-indigo-700 border border-indigo-300 rounded-md hover:bg-indigo-100 disabled:opacity-50 transition-colors"
                >
                  {advancing ? 'Advancing…' : 'Force advance to V1 →'}
                </button>
              </div>
            </div>
          )}
          {volumes.map((volume) => (
            <div key={volume.label} className="mb-5">
              <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border border-gray-200 rounded-t-lg">
                <h3 className="text-sm font-semibold text-gray-700">{volume.label}</h3>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-gray-500">
                    {volume.sections.filter((s) => isSectionLocked(s)).length} of{' '}
                    {volume.sections.length} locked
                  </span>
                  {(() => {
                    const gaugeArtifactId = volume.sections.find((s) => s.artifactId)?.artifactId;
                    return gaugeArtifactId ? (
                      <>
                        <VolumeLayoutGauge tenantSlug={tenantSlug} proposalId={proposalId} artifactId={gaugeArtifactId} />
                        <SaveAsTemplate tenantSlug={tenantSlug} proposalId={proposalId} artifactId={gaugeArtifactId} volumeName={volume.label} />
                      </>
                    ) : null;
                  })()}
                  {(() => {
                    const vnum = volume.sections[0]?.volumeNumber ?? null;
                    const allLocked = volume.sections.length > 0 && volume.sections.every((s) => isSectionLocked(s));
                    if (allLocked) {
                      // Locked → offer download in the artifact's native format (auto)
                      // + PDF. The export route resolves narrative→docx, slides→pptx,
                      // cost→xlsx; PDF needs Chromium.
                      const artifactId = volume.sections.find((s) => s.artifactId)?.artifactId;
                      const base = artifactId
                        ? `/api/portal/${tenantSlug}/proposals/${proposalId}/artifacts/${artifactId}/export`
                        : null;
                      return (
                        <span className="flex items-center gap-2 text-xs">
                          <span className="font-semibold text-green-700">✓ Volume locked</span>
                          {base && (
                            <span className="flex items-center gap-1.5 text-gray-400">
                              <span>·</span>
                              <a href={`${base}?format=auto`} className="font-medium text-blue-600 hover:underline" title="Download this volume in its native format">Download</a>
                              <a href={`${base}?format=pdf`} className="text-blue-600 hover:underline" title="Download as PDF (requires Chromium)">PDF</a>
                            </span>
                          )}
                        </span>
                      );
                    }
                    const lockableCount = volume.sections.filter(
                      (s) => !isSectionLocked(s) && s.status !== 'empty' && s.nodeCount > 0,
                    ).length;
                    if (lockableCount === 0 || vnum == null) return null;
                    return (
                      <button
                        onClick={() => lockScope('volume', vnum)}
                        disabled={scopeBusy != null || lockingAll || advancing}
                        title="Lock every drafted canvas in this volume — each still locks + audits per canvas, then rolls up to the volume"
                        className="px-2.5 py-1 text-xs font-semibold bg-gray-700 text-white rounded hover:bg-gray-800 disabled:opacity-50 transition-colors"
                      >
                        {scopeBusy === `volume:${vnum}` ? 'Locking…' : `Lock Volume (${lockableCount})`}
                      </button>
                    );
                  })()}
                </div>
              </div>
              <div className="border border-gray-200 border-t-0 rounded-b-lg divide-y divide-gray-100">
                {volume.sections.map((section) => {
                  const icon        = getSectionIcon(section.title, section.itemType);
                  const statusInfo  = STATUS_CONFIG[section.status] || STATUS_CONFIG.empty;
                  const assignee    = collaborators.find((c) => c.userId === section.assignedTo);
                  const assigneeIdx = assignee ? collaborators.indexOf(assignee) : -1;
                  const pageEst     = section.nodeCount > 0 ? Math.ceil(section.nodeCount / 3) : 0;
                  const pagePercent = section.pageAllocation
                    ? Math.round((section.nodeCount / (section.pageAllocation * 3)) * 100)
                    : 0;
                  const pageBarColor = pagePercent > 100 ? 'bg-red-500' : pagePercent > 90 ? 'bg-amber-500' : 'bg-emerald-500';
                  const pageTextColor= pagePercent > 100 ? 'text-red-600' : pagePercent > 90 ? 'text-amber-600' : 'text-gray-500';
                  const locked      = isSectionLocked(section);
                  const lockBusy    = lockPending === section.id;
                  const lockable    = section.status !== 'empty' && section.nodeCount > 0;

                  // Status dot color (left border accent)
                  const statusDot =
                    locked                            ? 'bg-amber-400'   :
                    section.status === 'complete'     ? 'bg-emerald-500' :
                    section.status === 'approved'     ? 'bg-emerald-600' :
                    section.status === 'in_progress'  ? 'bg-blue-400'    :
                    section.status === 'ai_drafted'   ? 'bg-indigo-400'  :
                    'bg-gray-300';

                  // Compliance items for this section
                  const sectionCompliance = (compliance?.items ?? []).filter(
                    (i) => i.sectionId === section.id,
                  );

                  return (
                    <div key={section.id} className="group hover:bg-gray-50/60 transition-colors">

                      {/* ── Row 1: identity + metadata ─────────────────────── */}
                      <div className="flex items-start gap-3 px-4 pt-3 pb-1">
                        {/* Status accent dot */}
                        <div className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${statusDot}`} />

                        {/* File-type icon */}
                        <div className={`w-8 h-8 rounded-md flex items-center justify-center text-[10px] font-bold flex-shrink-0 ${icon.color}`}>
                          {icon.label}
                        </div>

                        {/* Title + sub-row */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-semibold text-gray-900 leading-tight">
                              {section.sectionNumber ? `${section.sectionNumber}. ` : ''}{section.title}
                            </span>
                            {locked && (
                              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 uppercase tracking-wide">
                                🔒 Locked
                              </span>
                            )}
                            {section.completedStage && (
                              <span
                                className="text-[10px] text-gray-400"
                                title={`Accepted in ${section.completedStage}${section.acceptedByName ? ` by ${section.acceptedByName}` : ''}${section.completedAt ? ` on ${new Date(section.completedAt).toLocaleDateString()}` : ''}`}
                              >
                                ✓ {section.completedStage}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-3 mt-1 flex-wrap">
                            {/* Assignee */}
                            {assignee ? (
                              <span className="flex items-center gap-1 text-xs text-gray-500">
                                <span className={`w-5 h-5 rounded-full inline-flex items-center justify-center text-[8px] font-bold text-white ${AVATAR_COLORS[assigneeIdx % AVATAR_COLORS.length]}`}>
                                  {getInitials(assignee.name, assignee.email)}
                                </span>
                                {assignee.name?.split(' ')[0] || assignee.email.split('@')[0]}
                              </span>
                            ) : (
                              <span className="text-xs text-gray-300 italic">Unassigned</span>
                            )}

                            {/* Page budget */}
                            {section.pageAllocation ? (
                              <span className="flex items-center gap-1.5 text-xs">
                                <span className="w-16 h-1.5 bg-gray-200 rounded-full overflow-hidden inline-block align-middle">
                                  <span
                                    className={`block h-full rounded-full ${pageBarColor}`}
                                    style={{ width: `${Math.min(pagePercent, 100)}%` }}
                                  />
                                </span>
                                <span className={`tabular-nums ${pageTextColor}`}>
                                  {pageEst}/{section.pageAllocation}p
                                </span>
                              </span>
                            ) : (
                              <span className="text-xs text-gray-300">No page limit</span>
                            )}

                            {/* Version */}
                            {section.nodeCount > 0 && (
                              <span className="text-[10px] text-gray-400 font-mono bg-gray-100 px-1 rounded">v{section.version}</span>
                            )}

                            {/* Node count */}
                            {section.nodeCount > 0 && (
                              <span className="text-xs text-gray-400">{section.nodeCount} block{section.nodeCount !== 1 ? 's' : ''}</span>
                            )}
                          </div>
                        </div>

                        {/* Right-side chips */}
                        <div className="flex items-center gap-2 shrink-0 mt-0.5">
                          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wide ${statusInfo.badge}`}>
                            {statusInfo.label}
                          </span>
                          {sectionCompliance.length > 0 && (
                            <SectionComplianceChip items={sectionCompliance} compact />
                          )}
                        </div>
                      </div>

                      {/* ── Row 2: action tray ─────────────────────────────── */}
                      <div className="flex items-center gap-2 px-4 pb-3 pt-1.5 pl-[52px]">

                        {/* Accept & Lock / Unlock */}
                        {locked ? (
                          <button
                            onClick={() => handleToggleLock(section.id, true)}
                            disabled={lockBusy}
                            title="Accepted & locked. Click to unlock for editing."
                            className="px-2.5 py-1 text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-md hover:bg-amber-100 disabled:opacity-50 transition-colors"
                          >
                            {lockBusy ? '…' : '🔓 Unlock'}
                          </button>
                        ) : (
                          <button
                            onClick={() => handleToggleLock(section.id, false)}
                            disabled={lockBusy || !lockable}
                            title={lockable ? 'Accept and lock this section for the current stage' : 'Add content before accepting'}
                            className="px-2.5 py-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md hover:bg-emerald-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                          >
                            {lockBusy ? '…' : '✓ Accept & Lock'}
                          </button>
                        )}

                        {/* AI Re-draft */}
                        {!locked && (
                          <button
                            onClick={() => handleSectionClick(section.id)}
                            title="Open canvas to re-draft with AI"
                            className="px-2.5 py-1 text-[11px] font-medium text-indigo-600 border border-indigo-200 rounded-md hover:bg-indigo-50 transition-colors"
                          >
                            ↺ Re-draft
                          </button>
                        )}

                        {/* Atomize */}
                        {section.nodeCount > 0 && (
                          <button
                            onClick={() => handleSectionClick(section.id)}
                            title="Open canvas to atomize content into the library"
                            className="px-2.5 py-1 text-[11px] font-medium text-gray-500 border border-gray-200 rounded-md hover:bg-gray-100 transition-colors"
                          >
                            ⬡ Atomize
                          </button>
                        )}

                        {/* Expert notes indicator */}
                        {(section as { expertNotes?: string | null }).expertNotes && (
                          <span
                            className="text-[10px] text-purple-600 bg-purple-50 border border-purple-100 px-2 py-0.5 rounded-md"
                            title={`Expert notes: ${(section as { expertNotes?: string | null }).expertNotes}`}
                          >
                            ★ Notes
                          </span>
                        )}

                        <span className="flex-1" />

                        {/* Open */}
                        <button
                          onClick={() => handleSectionClick(section.id)}
                          className="px-3 py-1 text-[11px] font-semibold text-blue-600 bg-blue-50 border border-blue-200 rounded-md hover:bg-blue-100 transition-colors"
                        >
                          Open →
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          {/* Export Package */}
          <div className="mt-4 flex items-center gap-3">
            <button
              onClick={() => handleExport('docx')}
              disabled={exportLoading || (!isLocked && proposalStage !== 'submitted' && proposalStage !== 'archived')}
              className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {exportLoading ? 'Exporting...' : 'Download Proposal (.docx)'}
            </button>
            <button
              onClick={() => handleExport('pdf')}
              disabled={exportLoading || (!isLocked && proposalStage !== 'submitted' && proposalStage !== 'archived')}
              className="px-4 py-2 text-sm font-medium text-white bg-rose-600 rounded-md hover:bg-rose-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              title="One print-fidelity PDF of the whole proposal — tables, figures, header/footer, and page numbers"
            >
              Download Proposal (.pdf)
            </button>
            <button
              onClick={() => handleExport('zip')}
              disabled={exportLoading || (!isLocked && proposalStage !== 'submitted' && proposalStage !== 'archived')}
              className="px-4 py-2 text-sm font-medium text-indigo-700 bg-white border border-indigo-300 rounded-md hover:bg-indigo-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              title="Every volume in its native format (docx/pptx/xlsx/pdf), bundled as a .zip"
            >
              Download all (.zip)
            </button>
            {(!isLocked && proposalStage !== 'submitted' && proposalStage !== 'archived') && (
              <span className="text-xs text-gray-400">Lock the proposal or advance to submitted stage to export</span>
            )}
            {exportMessage && (
              <span className={`text-xs ${exportMessage.type === 'success' ? 'text-green-600' : 'text-red-500'}`}>
                {exportMessage.text}
              </span>
            )}
          </div>

          {/* Dropboxes */}
          {collaborators.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-xl p-5 mt-2">
              <h3 className="text-sm font-semibold text-gray-900 mb-3">Team Dropboxes</h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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
        <div className="space-y-5">
          {/* AI Compliance Check */}
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-gray-900">AI Compliance Check</h3>
              <button
                onClick={handleComplianceCheck}
                disabled={complianceLoading}
                className="px-3 py-1.5 text-xs font-medium text-white bg-purple-600 rounded-md hover:bg-purple-700 disabled:opacity-50 transition-colors"
              >
                {complianceLoading ? 'Checking...' : 'Run Compliance Check'}
              </button>
            </div>

            {complianceError && (
              <p className="text-xs text-red-500 mb-3">{complianceError}</p>
            )}

            {complianceResults && (
              <div>
                <div className="flex gap-4 mb-4 text-xs">
                  <span className="text-emerald-600 font-medium">{complianceResults.passed} passed</span>
                  <span className="text-red-600 font-medium">{complianceResults.failed} failed</span>
                  <span className="text-yellow-600 font-medium">{complianceResults.partial} partial</span>
                  <span className="text-gray-400">{complianceResults.totalVariables} total</span>
                </div>
                <div className="space-y-2">
                  {complianceResults.checks.map((check, idx) => {
                    const statusColors: Record<string, string> = {
                      pass: 'bg-emerald-100 text-emerald-600',
                      fail: 'bg-red-100 text-red-600',
                      partial: 'bg-yellow-100 text-yellow-600',
                      not_applicable: 'bg-gray-100 text-gray-400',
                    };
                    return (
                      <div key={idx} className="border border-gray-100 rounded-lg p-3">
                        <div className="flex items-center gap-2">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium uppercase ${statusColors[check.status] ?? 'bg-gray-100 text-gray-500'}`}>
                            {check.status}
                          </span>
                          <span className="text-sm font-medium text-gray-700">{check.variableName}</span>
                        </div>
                        {check.excerpt && (
                          <p className="text-xs text-gray-500 mt-1 italic">&quot;{check.excerpt}&quot;</p>
                        )}
                        {check.suggestion && (
                          <p className="text-xs text-amber-600 mt-1">{check.suggestion}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {!complianceResults && !complianceLoading && !complianceError && (
              <p className="text-xs text-gray-400">
                Run an AI compliance check to verify your proposal against solicitation requirements.
              </p>
            )}
          </div>

          {/* Submission Package — deterministic readiness + AI packaging review */}
          {/* Submission-readiness verdict — the single go / not-ready roll-up (deep-links to fix). */}
          <SubmissionReadinessCard tenantSlug={tenantSlug} proposalId={proposalId} refreshKey={Object.values(lockOverrides).filter(Boolean).length} />

          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-900">Submission Package</h3>
              <button
                onClick={handlePackageReview}
                disabled={packageLoading}
                title="Run the packaging specialist — compiles the manifest: volume completeness, required forms, page/format compliance"
                className="px-3 py-1.5 text-xs font-medium text-white bg-purple-600 rounded-md hover:bg-purple-700 disabled:opacity-50 transition-colors"
              >
                {packageLoading ? 'Queuing…' : 'AI package review'}
              </button>
            </div>
            {(() => {
              const total = sections.length;
              const locked = sections.filter((s) => isSectionLocked(s)).length;
              const empty = sections.filter((s) => (s.nodeCount ?? 0) === 0).length;
              const incomplete = total - locked;
              return (
                <div className="flex flex-wrap gap-4 text-xs mb-2">
                  <span className="text-emerald-600 font-medium">{locked} locked</span>
                  <span className="text-amber-600 font-medium">{incomplete} incomplete</span>
                  <span className="text-red-600 font-medium">{empty} empty</span>
                  <span className="text-gray-400">{total} sections</span>
                </div>
              );
            })()}
            {packageMsg && (
              <p className={`text-xs ${packageMsg.type === 'success' ? 'text-green-600' : 'text-red-500'} mb-1`}>{packageMsg.text}</p>
            )}
            <p className="text-[11px] text-gray-400">
              Deterministic readiness from your sections. Run “AI package review” for the agency-specific
              manifest — missing volumes/forms, page counts, and format compliance — before you lock &amp; download.
            </p>
          </div>

          {/* Compliance Checklist */}
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-gray-900 mb-4">Compliance Checklist</h3>
            {complianceItems.length > 0 ? (
              <div className="space-y-2">
                {complianceItems.map((item, idx) => {
                  const label = item.requirement || item.label || `Item ${idx + 1}`;
                  const passed = item.status === 'met' || item.status === 'pass' || item.met === true;
                  const failed = item.status === 'failed' || item.status === 'fail' || item.met === false;

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

          {/* Stage Gate Requirements */}
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-gray-900">Stage Gate Requirements</h3>
              {!gatesLoaded && (
                <button
                  onClick={fetchGates}
                  disabled={gatesLoading}
                  className="px-3 py-1.5 text-xs font-medium text-blue-600 border border-blue-200 rounded-md hover:bg-blue-50 disabled:opacity-50 transition-colors"
                >
                  {gatesLoading ? 'Loading...' : 'Load Gates'}
                </button>
              )}
            </div>

            {gateError && <p className="text-xs text-red-500 mb-3">{gateError}</p>}

            {gatesLoaded && gateRequirements.length === 0 && (
              <p className="text-xs text-gray-400 mb-4">No gate requirements defined yet.</p>
            )}

            {gateRequirements.length > 0 && (
              <div className="space-y-2 mb-4">
                {gateRequirements.map((gate) => (
                  <div key={gate.id} className="flex items-center gap-3 py-2 border-b border-gray-50 last:border-0">
                    <button
                      onClick={() => handleToggleGate(gate.id, !gate.isMet)}
                      className={`w-5 h-5 rounded border flex items-center justify-center text-[10px] flex-shrink-0 transition-colors ${
                        gate.isMet
                          ? 'bg-emerald-100 border-emerald-300 text-emerald-600'
                          : 'bg-white border-gray-300 text-gray-300 hover:border-gray-400'
                      }`}
                    >
                      {gate.isMet ? '✓' : ''}
                    </button>
                    <div className="flex-1 min-w-0">
                      <span className="text-sm text-gray-700">{gate.label}</span>
                      {gate.description && (
                        <p className="text-[10px] text-gray-400">{gate.description}</p>
                      )}
                    </div>
                    <span className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded capitalize flex-shrink-0">
                      {gate.stage}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Add new gate */}
            {gatesLoaded && (
              <div className="flex gap-2 mt-3 pt-3 border-t border-gray-100">
                <select
                  value={newGateStage}
                  onChange={(e) => setNewGateStage(e.target.value)}
                  className="px-2 py-1.5 text-xs border border-gray-200 rounded-md"
                >
                  <option value="">Stage...</option>
                  <option value="draft">Draft</option>
                  <option value="review">Review</option>
                  <option value="final">Final</option>
                </select>
                <input
                  type="text"
                  value={newGateLabel}
                  onChange={(e) => setNewGateLabel(e.target.value)}
                  placeholder="Requirement label..."
                  className="flex-1 px-2 py-1.5 text-xs border border-gray-200 rounded-md"
                />
                <button
                  onClick={handleAddGate}
                  disabled={addingGate || !newGateLabel.trim() || !newGateStage}
                  className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                  {addingGate ? '...' : 'Add'}
                </button>
              </div>
            )}
          </div>
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

      {activeTab === 'seed' && (
        <LibrarySeedPanel
          tenantSlug={tenantSlug}
          proposalId={proposalId}
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
  // Prefer the real document/volume identity carried from the compliance matrix
  // (proposal_sections.volume_name/number, set at create time). Fall back to the
  // section-number prefix for legacy proposals created before migration 074.
  const groups = new Map<string, VolumeGroup>();

  for (const section of sections) {
    const hasVolume = section.volumeNumber != null || !!section.volumeName;
    const prefix = section.sectionNumber.split('.')[0] || '1';
    const key = hasVolume ? `v${section.volumeNumber ?? section.volumeName}` : prefix;

    if (!groups.has(key)) {
      const volumeNames: Record<string, string> = {
        '1': 'Volume 1: Technical Volume',
        '2': 'Volume 2: Cost Volume',
        '3': 'Volume 3: Supporting Documents',
      };
      const label = hasVolume
        ? (section.volumeNumber != null
            ? `Volume ${section.volumeNumber}: ${section.volumeName ?? 'Document'}`
            : (section.volumeName as string))
        : (volumeNames[prefix] || `Volume ${prefix}`);
      groups.set(key, {
        label,
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
