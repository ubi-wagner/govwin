'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';

// ─── Types ──────────────────────────────────────────────────────────

interface Topic {
  id: string;
  topicNumber: string | null;
  title: string;
  topicBranch: string | null;
  topicStatus: string | null;
  techFocusAreas: string[];
  closeDate: string | null;
  isActive: boolean;
  phaseType?: string | null;
}

interface CompliancePreset {
  id: string;
  name: string;
  phaseType: string;
  agency: string | null;
  programType: string | null;
  complianceData: Record<string, unknown>;
  volumesData: unknown[];
  isSystem: boolean;
}

interface TopicComplianceData {
  compliance: Record<string, unknown>;
  source: 'topic' | 'solicitation' | 'none';
  solicitationCompliance: Record<string, unknown> | null;
  volumes: Array<{
    id: string;
    volumeNumber: number;
    volumeName: string;
    items: Array<{ id: string; itemNumber: number; itemName: string; itemType: string }>;
  }>;
}

interface Props {
  solicitationId: string;
  topics: Topic[];
  onClose: () => void;
}

// ─── Constants ──────────────────────────────────────────────────────

const COMPLIANCE_FIELDS = [
  { key: 'pageLimitTechnical', label: 'Page Limit (Technical)', type: 'int' },
  { key: 'pageLimitCost', label: 'Page Limit (Cost)', type: 'int' },
  { key: 'fontFamily', label: 'Font Family', type: 'text' },
  { key: 'fontSize', label: 'Font Size', type: 'text' },
  { key: 'margins', label: 'Margins', type: 'text' },
  { key: 'lineSpacing', label: 'Line Spacing', type: 'text' },
  { key: 'headerRequired', label: 'Header Required', type: 'bool' },
  { key: 'headerFormat', label: 'Header Format', type: 'text' },
  { key: 'footerRequired', label: 'Footer Required', type: 'bool' },
  { key: 'footerFormat', label: 'Footer Format', type: 'text' },
  { key: 'submissionFormat', label: 'Submission Format', type: 'text' },
  { key: 'slidesAllowed', label: 'Slides Allowed', type: 'bool' },
  { key: 'slideLimit', label: 'Slide Limit', type: 'int' },
  { key: 'tabaAllowed', label: 'TABA Allowed', type: 'bool' },
  { key: 'piMustBeEmployee', label: 'PI Must Be Employee', type: 'bool' },
  { key: 'partnerMaxPct', label: 'Partner Max %', type: 'numeric' },
  { key: 'clearanceRequired', label: 'Clearance Required', type: 'text' },
  { key: 'itarRequired', label: 'ITAR Required', type: 'bool' },
] as const;

type PhaseGroup = {
  key: string;
  label: string;
  color: string;
  badgeClass: string;
};

const PHASE_GROUPS: PhaseGroup[] = [
  { key: 'phase_1', label: 'Phase I Topics', color: 'blue', badgeClass: 'bg-blue-100 text-blue-700' },
  { key: 'phase_2', label: 'Phase II Topics', color: 'green', badgeClass: 'bg-green-100 text-green-700' },
  { key: 'direct_to_phase_2', label: 'Direct to Phase II', color: 'purple', badgeClass: 'bg-purple-100 text-purple-700' },
  { key: 'cso', label: 'CSO', color: 'orange', badgeClass: 'bg-orange-100 text-orange-700' },
  { key: 'other', label: 'Other Topics', color: 'gray', badgeClass: 'bg-gray-100 text-gray-700' },
];

function inferPhaseType(topic: Topic): string {
  if (topic.phaseType) return topic.phaseType;
  // Infer from topic status or branch if available
  const combined = `${topic.topicNumber ?? ''} ${topic.topicBranch ?? ''} ${topic.title}`.toLowerCase();
  if (combined.includes('dp2') || combined.includes('direct to phase ii') || combined.includes('d2p2')) return 'direct_to_phase_2';
  if (combined.includes('cso')) return 'cso';
  if (combined.includes('phase ii') || combined.includes('phase 2')) return 'phase_2';
  return 'phase_1'; // default
}

function getPhaseBadge(phaseType: string): { label: string; className: string } {
  const group = PHASE_GROUPS.find((g) => g.key === phaseType);
  if (!group) return { label: phaseType, className: 'bg-gray-100 text-gray-700' };
  return { label: group.label.replace(' Topics', ''), className: group.badgeClass };
}

// ─── Component ──────────────────────────────────────────────────────

export function TopicComplianceManager({ solicitationId, topics, onClose }: Props) {
  const router = useRouter();

  // State
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [expandedTopic, setExpandedTopic] = useState<string | null>(null);
  const [presets, setPresets] = useState<CompliancePreset[]>([]);
  const [presetsLoaded, setPresetsLoaded] = useState(false);
  const [topicCompliance, setTopicCompliance] = useState<Record<string, TopicComplianceData>>({});
  const [editValues, setEditValues] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [showPresetDropdown, setShowPresetDropdown] = useState(false);
  const [showCopyFrom, setShowCopyFrom] = useState(false);
  const [topicComplianceStatus, setTopicComplianceStatus] = useState<Record<string, 'custom' | 'baseline' | 'none'>>({});
  const [savingTopic, setSavingTopic] = useState<string | null>(null);

  // Group topics by phase type
  const grouped = groupTopicsByPhase(topics);

  // Load presets on mount
  useEffect(() => {
    if (presetsLoaded) return;
    (async () => {
      try {
        const resp = await fetch('/api/admin/compliance-presets');
        if (resp.ok) {
          const json = await resp.json();
          setPresets(json.data?.presets ?? []);
        }
      } catch {
        // Non-fatal
      }
      setPresetsLoaded(true);
    })();
  }, [presetsLoaded]);

  // Load compliance status for all topics on mount
  useEffect(() => {
    (async () => {
      try {
        // Batch check: look for topic-level compliance rows
        const resp = await fetch(`/api/admin/rfp-curation/${solicitationId}/compliance`);
        if (!resp.ok) return;
        const json = await resp.json();
        const baselineExists = !!json.data?.compliance;

        // For each topic, check if it has a custom override
        const statusMap: Record<string, 'custom' | 'baseline' | 'none'> = {};
        for (const topic of topics) {
          try {
            const tResp = await fetch(
              `/api/admin/rfp-curation/${solicitationId}/topics/${topic.id}/compliance`,
            );
            if (tResp.ok) {
              const tJson = await tResp.json();
              const source = tJson.data?.source as string;
              if (source === 'topic') statusMap[topic.id] = 'custom';
              else if (source === 'solicitation') statusMap[topic.id] = 'baseline';
              else statusMap[topic.id] = 'none';
            } else {
              statusMap[topic.id] = baselineExists ? 'baseline' : 'none';
            }
          } catch {
            statusMap[topic.id] = baselineExists ? 'baseline' : 'none';
          }
        }
        setTopicComplianceStatus(statusMap);
      } catch {
        // Non-fatal
      }
    })();
  }, [solicitationId, topics]);

  // ── Selection handlers ──────────────────────────────────────────

  const toggleSelect = useCallback((topicId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(topicId)) next.delete(topicId);
      else next.add(topicId);
      return next;
    });
  }, []);

  const toggleGroupSelect = useCallback((phaseKey: string) => {
    const groupTopics = topics.filter((t) => inferPhaseType(t) === phaseKey);
    const groupIds = groupTopics.map((t) => t.id);
    setSelected((prev) => {
      const allSelected = groupIds.every((id) => prev.has(id));
      const next = new Set(prev);
      if (allSelected) {
        for (const id of groupIds) next.delete(id);
      } else {
        for (const id of groupIds) next.add(id);
      }
      return next;
    });
  }, [topics]);

  const toggleCollapse = useCallback((phaseKey: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(phaseKey)) next.delete(phaseKey);
      else next.add(phaseKey);
      return next;
    });
  }, []);

  // ── Expand topic detail ─────────────────────────────────────────

  const expandTopic = useCallback(async (topicId: string) => {
    if (expandedTopic === topicId) {
      setExpandedTopic(null);
      return;
    }
    setExpandedTopic(topicId);

    // Load compliance if not cached
    if (!topicCompliance[topicId]) {
      try {
        const resp = await fetch(
          `/api/admin/rfp-curation/${solicitationId}/topics/${topicId}/compliance`,
        );
        if (resp.ok) {
          const json = await resp.json();
          setTopicCompliance((prev) => ({ ...prev, [topicId]: json.data }));
          setEditValues(json.data.compliance ?? {});
        }
      } catch {
        // Non-fatal
      }
    } else {
      setEditValues(topicCompliance[topicId].compliance ?? {});
    }
  }, [expandedTopic, topicCompliance, solicitationId]);

  // ── Apply preset to selected ────────────────────────────────────

  const applyPreset = useCallback(async (presetId: string) => {
    if (selected.size === 0) return;
    setLoading(true);
    setError(null);
    setSuccessMsg(null);
    setShowPresetDropdown(false);

    try {
      const resp = await fetch(`/api/admin/rfp-curation/${solicitationId}/apply-preset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topicIds: Array.from(selected), presetId }),
      });

      if (!resp.ok) {
        const json = await resp.json();
        setError(json.error ?? 'Failed to apply preset');
        return;
      }

      const json = await resp.json();
      setSuccessMsg(`Preset applied to ${json.data.applied} topic(s)`);

      // Update statuses
      setTopicComplianceStatus((prev) => {
        const next = { ...prev };
        for (const tid of selected) next[tid] = 'custom';
        return next;
      });

      // Clear cached compliance for affected topics so it reloads
      setTopicCompliance((prev) => {
        const next = { ...prev };
        for (const tid of selected) delete next[tid];
        return next;
      });

      setSelected(new Set());
      router.refresh();
    } catch {
      setError('Failed to apply preset');
    } finally {
      setLoading(false);
    }
  }, [selected, solicitationId, router]);

  // ── Copy from another topic ─────────────────────────────────────

  const copyFromTopic = useCallback(async (sourceTopicId: string) => {
    if (selected.size === 0) return;
    setLoading(true);
    setError(null);
    setSuccessMsg(null);
    setShowCopyFrom(false);

    try {
      // Load the source topic's compliance
      const srcResp = await fetch(
        `/api/admin/rfp-curation/${solicitationId}/topics/${sourceTopicId}/compliance`,
      );
      if (!srcResp.ok) {
        setError('Failed to load source topic compliance');
        return;
      }
      const srcJson = await srcResp.json();
      const srcCompliance = srcJson.data?.compliance ?? {};

      // Apply to all selected topics
      const resp = await fetch(`/api/admin/rfp-curation/${solicitationId}/apply-preset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topicIds: Array.from(selected),
          compliance: srcCompliance,
          volumes: [],
        }),
      });

      if (!resp.ok) {
        const json = await resp.json();
        setError(json.error ?? 'Failed to copy compliance');
        return;
      }

      const json = await resp.json();
      setSuccessMsg(`Compliance copied to ${json.data.applied} topic(s)`);

      setTopicComplianceStatus((prev) => {
        const next = { ...prev };
        for (const tid of selected) next[tid] = 'custom';
        return next;
      });
      setTopicCompliance((prev) => {
        const next = { ...prev };
        for (const tid of selected) delete next[tid];
        return next;
      });

      setSelected(new Set());
      router.refresh();
    } catch {
      setError('Failed to copy compliance');
    } finally {
      setLoading(false);
    }
  }, [selected, solicitationId, router]);

  // ── Clear overrides ─────────────────────────────────────────────

  const clearOverrides = useCallback(async () => {
    if (selected.size === 0) return;
    if (!confirm(`Clear compliance overrides for ${selected.size} topic(s)? They will revert to solicitation baseline.`)) return;

    setLoading(true);
    setError(null);
    setSuccessMsg(null);

    try {
      let cleared = 0;
      for (const topicId of selected) {
        const resp = await fetch(
          `/api/admin/rfp-curation/${solicitationId}/topics/${topicId}/compliance`,
          { method: 'DELETE' },
        );
        if (resp.ok) cleared++;
      }

      setSuccessMsg(`Cleared overrides for ${cleared} topic(s)`);

      setTopicComplianceStatus((prev) => {
        const next = { ...prev };
        for (const tid of selected) next[tid] = 'baseline';
        return next;
      });
      setTopicCompliance((prev) => {
        const next = { ...prev };
        for (const tid of selected) delete next[tid];
        return next;
      });

      setSelected(new Set());
      router.refresh();
    } catch {
      setError('Failed to clear overrides');
    } finally {
      setLoading(false);
    }
  }, [selected, solicitationId, router]);

  // ── Save individual topic overrides ─────────────────────────────

  const saveTopicOverrides = useCallback(async (topicId: string) => {
    setSavingTopic(topicId);
    setError(null);

    try {
      const resp = await fetch(
        `/api/admin/rfp-curation/${solicitationId}/topics/${topicId}/compliance`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ compliance: editValues }),
        },
      );

      if (!resp.ok) {
        const json = await resp.json();
        setError(json.error ?? 'Failed to save overrides');
        return;
      }

      setTopicComplianceStatus((prev) => ({ ...prev, [topicId]: 'custom' }));
      setTopicCompliance((prev) => {
        const next = { ...prev };
        if (next[topicId]) {
          next[topicId] = { ...next[topicId], compliance: { ...editValues }, source: 'topic' };
        }
        return next;
      });

      setSuccessMsg('Topic compliance saved');
      router.refresh();
    } catch {
      setError('Failed to save overrides');
    } finally {
      setSavingTopic(null);
    }
  }, [solicitationId, editValues, router]);

  // ── Render ──────────────────────────────────────────────────────

  return (
    <div className="border rounded-lg bg-white">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-gray-50 rounded-t-lg">
        <div>
          <h2 className="text-lg font-semibold">Topic Compliance Manager</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Configure compliance requirements per topic or in bulk
          </p>
        </div>
        <div className="flex items-center gap-2">
          {selected.size > 0 && (
            <span className="text-sm font-medium text-indigo-600">
              {selected.size} selected
            </span>
          )}
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs text-gray-600 hover:text-gray-900 border rounded"
          >
            Close
          </button>
        </div>
      </div>

      {/* Messages */}
      {error && (
        <div className="mx-4 mt-3 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
          {error}
        </div>
      )}
      {successMsg && (
        <div className="mx-4 mt-3 p-2 bg-green-50 border border-green-200 rounded text-xs text-green-700">
          {successMsg}
          <button
            onClick={() => setSuccessMsg(null)}
            className="ml-2 text-green-500 hover:text-green-700"
          >
            dismiss
          </button>
        </div>
      )}

      {/* Bulk Actions Bar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-2 px-4 py-2 bg-indigo-50 border-b">
          <span className="text-xs font-medium text-indigo-700">
            Actions for {selected.size} topic{selected.size !== 1 ? 's' : ''}:
          </span>

          {/* Apply Preset */}
          <div className="relative">
            <button
              onClick={() => { setShowPresetDropdown(!showPresetDropdown); setShowCopyFrom(false); }}
              disabled={loading}
              className="px-3 py-1 text-xs font-medium bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50"
            >
              Apply Preset
            </button>
            {showPresetDropdown && (
              <div className="absolute top-full left-0 mt-1 bg-white border rounded-lg shadow-lg z-20 min-w-[250px]">
                <div className="p-2 border-b">
                  <span className="text-xs font-medium text-gray-500">Choose a preset</span>
                </div>
                {presets.length === 0 ? (
                  <div className="p-3 text-xs text-gray-400">No presets available</div>
                ) : (
                  <div className="max-h-60 overflow-y-auto">
                    {presets.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => applyPreset(p.id)}
                        className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50 border-b last:border-b-0"
                      >
                        <div className="font-medium text-gray-800">{p.name}</div>
                        <div className="text-gray-500 mt-0.5">
                          {p.isSystem ? 'System' : 'Custom'} &middot; {p.phaseType.replace(/_/g, ' ')}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                <button
                  onClick={() => setShowPresetDropdown(false)}
                  className="w-full text-center px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-50 border-t"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>

          {/* Copy From */}
          <div className="relative">
            <button
              onClick={() => { setShowCopyFrom(!showCopyFrom); setShowPresetDropdown(false); }}
              disabled={loading}
              className="px-3 py-1 text-xs font-medium bg-white text-gray-700 border rounded hover:bg-gray-50 disabled:opacity-50"
            >
              Copy From...
            </button>
            {showCopyFrom && (
              <div className="absolute top-full left-0 mt-1 bg-white border rounded-lg shadow-lg z-20 min-w-[280px]">
                <div className="p-2 border-b">
                  <span className="text-xs font-medium text-gray-500">Copy compliance from topic</span>
                </div>
                <div className="max-h-60 overflow-y-auto">
                  {topics
                    .filter((t) => !selected.has(t.id) && topicComplianceStatus[t.id] === 'custom')
                    .map((t) => (
                      <button
                        key={t.id}
                        onClick={() => copyFromTopic(t.id)}
                        className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50 border-b last:border-b-0"
                      >
                        <span className="font-mono text-indigo-600">{t.topicNumber ?? '--'}</span>
                        <span className="ml-2 text-gray-800">{t.title}</span>
                      </button>
                    ))}
                  {topics.filter((t) => !selected.has(t.id) && topicComplianceStatus[t.id] === 'custom').length === 0 && (
                    <div className="p-3 text-xs text-gray-400">No topics with custom compliance to copy from</div>
                  )}
                </div>
                <button
                  onClick={() => setShowCopyFrom(false)}
                  className="w-full text-center px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-50 border-t"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>

          {/* Clear Overrides */}
          <button
            onClick={clearOverrides}
            disabled={loading}
            className="px-3 py-1 text-xs font-medium bg-white text-red-600 border border-red-200 rounded hover:bg-red-50 disabled:opacity-50"
          >
            Clear Overrides
          </button>

          {loading && (
            <span className="text-xs text-gray-400 ml-2">Processing...</span>
          )}
        </div>
      )}

      {/* Phase Groups */}
      <div className="divide-y">
        {grouped.map(({ phase, topicsInGroup }) => {
          if (topicsInGroup.length === 0) return null;
          const isCollapsed = collapsed.has(phase.key);
          const groupIds = topicsInGroup.map((t) => t.id);
          const allGroupSelected = groupIds.every((id) => selected.has(id));
          const someGroupSelected = groupIds.some((id) => selected.has(id));

          return (
            <div key={phase.key}>
              {/* Group header */}
              <div className="flex items-center gap-3 px-4 py-2.5 bg-gray-50 hover:bg-gray-100">
                <input
                  type="checkbox"
                  checked={allGroupSelected}
                  ref={(el) => { if (el) el.indeterminate = someGroupSelected && !allGroupSelected; }}
                  onChange={() => toggleGroupSelect(phase.key)}
                  className="h-3.5 w-3.5 rounded border-gray-300 text-indigo-600"
                />
                <button
                  onClick={() => toggleCollapse(phase.key)}
                  className="flex items-center gap-2 flex-1 text-left"
                >
                  <span className="text-xs text-gray-400">{isCollapsed ? '▶' : '▼'}</span>
                  <span className={`text-xs px-2 py-0.5 rounded font-medium ${phase.badgeClass}`}>
                    {phase.label}
                  </span>
                  <span className="text-xs text-gray-500">
                    ({topicsInGroup.length})
                  </span>
                </button>
              </div>

              {/* Topics in group */}
              {!isCollapsed && (
                <div className="divide-y divide-gray-100">
                  {topicsInGroup.map((topic) => {
                    const status = topicComplianceStatus[topic.id] ?? 'none';
                    const isExpanded = expandedTopic === topic.id;
                    const phaseBadge = getPhaseBadge(inferPhaseType(topic));

                    return (
                      <div key={topic.id}>
                        {/* Topic row */}
                        <div className="flex items-center gap-3 px-4 py-2 hover:bg-gray-50">
                          <input
                            type="checkbox"
                            checked={selected.has(topic.id)}
                            onChange={() => toggleSelect(topic.id)}
                            className="h-3.5 w-3.5 rounded border-gray-300 text-indigo-600"
                          />
                          <button
                            onClick={() => expandTopic(topic.id)}
                            className="flex items-center gap-3 flex-1 text-left min-w-0"
                          >
                            {topic.topicNumber && (
                              <span className="font-mono text-xs bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded shrink-0">
                                {topic.topicNumber}
                              </span>
                            )}
                            <span className="text-sm text-gray-800 truncate flex-1">
                              {topic.title}
                            </span>
                            <span className={`text-xs px-1.5 py-0.5 rounded shrink-0 ${phaseBadge.className}`}>
                              {phaseBadge.label}
                            </span>
                            <ComplianceStatusBadge status={status} />
                            <span className="text-xs text-gray-400 shrink-0">
                              {isExpanded ? '▼' : '▶'}
                            </span>
                          </button>
                        </div>

                        {/* Expanded topic detail */}
                        {isExpanded && (
                          <TopicComplianceDetail
                            topicId={topic.id}
                            topicNumber={topic.topicNumber}
                            data={topicCompliance[topic.id] ?? null}
                            editValues={editValues}
                            onEditChange={(key, value) => {
                              setEditValues((prev) => ({ ...prev, [key]: value }));
                            }}
                            saving={savingTopic === topic.id}
                            onSave={() => saveTopicOverrides(topic.id)}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {topics.length === 0 && (
        <div className="px-4 py-8 text-center text-sm text-gray-400">
          No topics to manage. Add topics first.
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────

function ComplianceStatusBadge({ status }: { status: 'custom' | 'baseline' | 'none' }) {
  switch (status) {
    case 'custom':
      return (
        <span className="text-xs px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 shrink-0">
          Custom
        </span>
      );
    case 'baseline':
      return (
        <span className="text-xs px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 shrink-0">
          Baseline
        </span>
      );
    default:
      return (
        <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 shrink-0">
          None
        </span>
      );
  }
}

function TopicComplianceDetail({
  topicId,
  topicNumber,
  data,
  editValues,
  onEditChange,
  saving,
  onSave,
}: {
  topicId: string;
  topicNumber: string | null;
  data: TopicComplianceData | null;
  editValues: Record<string, unknown>;
  onEditChange: (key: string, value: unknown) => void;
  saving: boolean;
  onSave: () => void;
}) {
  if (!data) {
    return (
      <div className="px-8 py-4 bg-gray-50 border-t">
        <span className="text-xs text-gray-400">Loading compliance data...</span>
      </div>
    );
  }

  return (
    <div className="px-8 py-4 bg-gray-50 border-t space-y-4">
      {/* Compliance fields */}
      <div>
        <h4 className="text-xs font-semibold text-gray-600 mb-2 uppercase tracking-wide">
          Compliance Fields
        </h4>
        <div className="grid grid-cols-2 gap-x-6 gap-y-2">
          {COMPLIANCE_FIELDS.map((field) => {
            const value = editValues[field.key];
            const solValue = data.solicitationCompliance?.[field.key];
            const source = data.source === 'topic'
              ? (value !== undefined && value !== null ? 'custom override' : 'from solicitation')
              : data.source === 'solicitation'
                ? 'from solicitation'
                : 'not set';

            return (
              <div key={field.key} className="flex items-center gap-2">
                <label className="text-xs text-gray-600 w-40 shrink-0">
                  {field.label}
                </label>
                {field.type === 'bool' ? (
                  <select
                    value={value === true ? 'true' : value === false ? 'false' : ''}
                    onChange={(e) => {
                      const v = e.target.value;
                      onEditChange(field.key, v === 'true' ? true : v === 'false' ? false : null);
                    }}
                    className="text-xs border rounded px-2 py-1 w-24"
                  >
                    <option value="">--</option>
                    <option value="true">Yes</option>
                    <option value="false">No</option>
                  </select>
                ) : field.type === 'int' || field.type === 'numeric' ? (
                  <input
                    type="number"
                    value={value != null ? String(value) : ''}
                    onChange={(e) => {
                      const v = e.target.value;
                      onEditChange(field.key, v ? Number(v) : null);
                    }}
                    className="text-xs border rounded px-2 py-1 w-24"
                    placeholder={solValue != null ? `(${solValue})` : ''}
                  />
                ) : (
                  <input
                    type="text"
                    value={value != null ? String(value) : ''}
                    onChange={(e) => onEditChange(field.key, e.target.value || null)}
                    className="text-xs border rounded px-2 py-1 flex-1"
                    placeholder={solValue != null ? `(${solValue})` : ''}
                  />
                )}
                <span className="text-[10px] text-gray-400 shrink-0 w-28 truncate" title={source}>
                  {source}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Volumes */}
      {data.volumes && data.volumes.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-gray-600 mb-2 uppercase tracking-wide">
            Volumes
          </h4>
          <div className="space-y-1">
            {data.volumes.map((vol) => (
              <div key={vol.id} className="flex items-center gap-2 text-xs">
                <span className="font-mono bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded">
                  Vol {vol.volumeNumber}
                </span>
                <span className="text-gray-700">{vol.volumeName}</span>
                <span className="text-gray-400">
                  ({vol.items.length} item{vol.items.length !== 1 ? 's' : ''})
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Save button */}
      <div className="flex items-center gap-2 pt-2 border-t border-gray-200">
        <button
          onClick={onSave}
          disabled={saving}
          className="px-4 py-1.5 text-xs font-medium bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save Overrides'}
        </button>
        <span className="text-[10px] text-gray-400">
          Saves custom compliance for {topicNumber ?? topicId.slice(0, 8)}
        </span>
      </div>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────

function groupTopicsByPhase(topics: Topic[]): Array<{ phase: PhaseGroup; topicsInGroup: Topic[] }> {
  const map: Record<string, Topic[]> = {};
  for (const t of topics) {
    const key = inferPhaseType(t);
    if (!map[key]) map[key] = [];
    map[key].push(t);
  }

  return PHASE_GROUPS
    .map((phase) => ({
      phase,
      topicsInGroup: map[phase.key] ?? [],
    }))
    .filter(({ topicsInGroup }) => topicsInGroup.length > 0);
}
