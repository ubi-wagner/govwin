'use client';

import { useState, useCallback } from 'react';

const CATEGORIES = [
  'general',
  'technical_approach',
  'past_performance',
  'key_personnel',
  'capability_statement',
  'cost_volume',
  'management_approach',
  'commercialization',
  'abstract',
  'qualifications',
  'schedule',
  'risk_management',
  'quality',
  'facilities',
  'teaming',
  'security',
  'transition_plan',
  'data_rights',
  'executive_summary',
  'company_overview',
  'uploaded',
] as const;

export interface LibraryUnit {
  id: string;
  content: string;
  category: string;
  subcategory: string | null;
  tags: string[];
  confidence: number;
  status: string;
  sourceType: string | null;
  sourceId: string | null;
  usageCount: number;
  outcome: string | null;
  outcomeScore: number | null;
  originalProposalId: string | null;
  originalNodeId: string | null;
  atomHash: string | null;
  proposalTitle: string | null;
  createdAt: string;
  updatedAt: string;
}

interface AtomDetailModalProps {
  unit: LibraryUnit;
  tenantSlug: string;
  proposals: Array<{ id: string; title: string }>;
  onClose: () => void;
  onUpdated: () => void;
}

export default function AtomDetailModal({
  unit,
  tenantSlug,
  proposals,
  onClose,
  onUpdated,
}: AtomDetailModalProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(unit.content);
  const [editCategory, setEditCategory] = useState(unit.category);
  const [editTags, setEditTags] = useState(unit.tags.join(', '));
  const [editStatus, setEditStatus] = useState(unit.status);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const tags = editTags.split(',').map((t) => t.trim()).filter(Boolean);
      const res = await fetch(`/api/portal/${tenantSlug}/library/${unit.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: editContent,
          category: editCategory,
          tags,
          status: editStatus,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Save failed' }));
        setError(data.error ?? 'Save failed');
        return;
      }
      setIsEditing(false);
      onUpdated();
    } catch {
      setError('Network error');
    } finally {
      setSaving(false);
    }
  }, [tenantSlug, unit.id, editContent, editCategory, editTags, editStatus, onUpdated]);

  const handleAssignToProposal = useCallback(
    async (proposalId: string) => {
      // This bookmarks the atom for a specific proposal
      // by adding the proposal ID to the tags as a reference
      try {
        const currentTags = editTags.split(',').map((t) => t.trim()).filter(Boolean);
        const proposalTag = `proposal:${proposalId}`;
        if (!currentTags.includes(proposalTag)) {
          currentTags.push(proposalTag);
        }
        const res = await fetch(`/api/portal/${tenantSlug}/library/${unit.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tags: currentTags }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({ error: 'Assignment failed' }));
          setError(data.error ?? 'Assignment failed');
          return;
        }
        setEditTags(currentTags.join(', '));
        onUpdated();
      } catch {
        setError('Network error');
      }
    },
    [tenantSlug, unit.id, editTags, onUpdated],
  );

  const sourceLabel = getSourceLabel(unit.sourceType);
  const outcomeLabel = getOutcomeLabel(unit.outcome);
  const scoreColor = getScoreColor(unit.outcomeScore);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div className="flex items-center gap-3 min-w-0">
            {unit.outcome === 'awarded' && (
              <span className="text-yellow-500 text-xl flex-shrink-0" title="Award-winning content">
                &#x1f3c6;
              </span>
            )}
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-gray-900 truncate">
                {formatCategory(unit.category)}
              </h2>
              {unit.subcategory && (
                <p className="text-xs text-gray-500">{unit.subcategory}</p>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 p-1"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
          {/* Score bar */}
          {unit.outcomeScore != null && (
            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-500 w-20">Quality Score</span>
              <div className="flex-1 bg-gray-100 rounded-full h-2.5">
                <div
                  className={`h-2.5 rounded-full transition-all ${scoreColor}`}
                  style={{ width: `${Math.round((unit.outcomeScore ?? 0) * 100)}%` }}
                />
              </div>
              <span className="text-sm font-medium text-gray-700 w-12 text-right">
                {Math.round((unit.outcomeScore ?? 0) * 100)}%
              </span>
            </div>
          )}

          {/* Content */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Content</label>
            {isEditing ? (
              <textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                rows={10}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            ) : (
              <div className="bg-gray-50 rounded-lg px-4 py-3 text-sm text-gray-700 whitespace-pre-wrap max-h-64 overflow-y-auto">
                {unit.content}
              </div>
            )}
          </div>

          {/* Metadata grid */}
          <div className="grid grid-cols-2 gap-4">
            {/* Category */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Category</label>
              {isEditing ? (
                <select
                  value={editCategory}
                  onChange={(e) => setEditCategory(e.target.value)}
                  className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
                >
                  {CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>{formatCategory(cat)}</option>
                  ))}
                  {!CATEGORIES.includes(unit.category as typeof CATEGORIES[number]) && (
                    <option value={unit.category}>{formatCategory(unit.category)}</option>
                  )}
                </select>
              ) : (
                <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-700">
                  {formatCategory(unit.category)}
                </span>
              )}
            </div>

            {/* Status */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Status</label>
              {isEditing ? (
                <select
                  value={editStatus}
                  onChange={(e) => setEditStatus(e.target.value)}
                  className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
                >
                  <option value="draft">Draft</option>
                  <option value="approved">Approved</option>
                  <option value="archived">Archived</option>
                </select>
              ) : (
                <StatusBadge status={unit.status} />
              )}
            </div>

            {/* Confidence */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Confidence</label>
              <span className="text-sm text-gray-700">
                {Math.round((unit.confidence ?? 0.5) * 100)}%
              </span>
            </div>

            {/* Outcome */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Outcome</label>
              {outcomeLabel}
            </div>
          </div>

          {/* Tags */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Tags</label>
            {isEditing ? (
              <input
                type="text"
                value={editTags}
                onChange={(e) => setEditTags(e.target.value)}
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
                placeholder="tag1, tag2, tag3"
              />
            ) : (
              <div className="flex flex-wrap gap-1">
                {(unit.tags ?? []).map((tag) => (
                  <span
                    key={tag}
                    className="inline-block px-2 py-0.5 rounded text-xs bg-blue-50 text-blue-600"
                  >
                    {tag}
                  </span>
                ))}
                {(unit.tags ?? []).length === 0 && (
                  <span className="text-xs text-gray-400">No tags</span>
                )}
              </div>
            )}
          </div>

          {/* Provenance */}
          <div className="border-t border-gray-100 pt-4">
            <h3 className="text-xs font-medium text-gray-500 mb-2 uppercase tracking-wide">Provenance</h3>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <span className="text-gray-500 text-xs">Source Type</span>
                <p className="text-gray-700 flex items-center gap-1.5 mt-0.5">
                  <SourceBadge sourceType={unit.sourceType} />
                </p>
              </div>
              <div>
                <span className="text-gray-500 text-xs">Usage Count</span>
                <p className="text-gray-700 mt-0.5">{unit.usageCount} proposal{unit.usageCount !== 1 ? 's' : ''}</p>
              </div>
              {unit.originalProposalId && (
                <div className="col-span-2">
                  <span className="text-gray-500 text-xs">Original Proposal</span>
                  <p className="text-gray-700 mt-0.5">
                    {unit.proposalTitle ?? unit.originalProposalId}
                  </p>
                </div>
              )}
              {unit.originalNodeId && (
                <div>
                  <span className="text-gray-500 text-xs">Original Node ID</span>
                  <p className="text-gray-700 mt-0.5 font-mono text-xs">{unit.originalNodeId}</p>
                </div>
              )}
              {unit.atomHash && (
                <div>
                  <span className="text-gray-500 text-xs">Atom Hash</span>
                  <p className="text-gray-700 mt-0.5 font-mono text-xs truncate" title={unit.atomHash}>
                    {unit.atomHash}
                  </p>
                </div>
              )}
              <div>
                <span className="text-gray-500 text-xs">Created</span>
                <p className="text-gray-700 mt-0.5">{new Date(unit.createdAt).toLocaleDateString()}</p>
              </div>
              <div>
                <span className="text-gray-500 text-xs">Updated</span>
                <p className="text-gray-700 mt-0.5">{new Date(unit.updatedAt).toLocaleDateString()}</p>
              </div>
            </div>
          </div>

          {/* Assign to proposal */}
          {proposals.length > 0 && (
            <div className="border-t border-gray-100 pt-4">
              <h3 className="text-xs font-medium text-gray-500 mb-2 uppercase tracking-wide">
                Assign to Proposal
              </h3>
              <select
                onChange={(e) => {
                  if (e.target.value) handleAssignToProposal(e.target.value);
                  e.target.value = '';
                }}
                defaultValue=""
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
              >
                <option value="">Select a proposal...</option>
                {proposals.map((p) => (
                  <option key={p.id} value={p.id}>{p.title}</option>
                ))}
              </select>
            </div>
          )}

          {/* Error */}
          {error && (
            <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded">{error}</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200 bg-gray-50">
          <div className="text-xs text-gray-400">
            ID: {unit.id}
          </div>
          <div className="flex items-center gap-2">
            {isEditing ? (
              <>
                <button
                  onClick={() => {
                    setIsEditing(false);
                    setEditContent(unit.content);
                    setEditCategory(unit.category);
                    setEditTags(unit.tags.join(', '));
                    setEditStatus(unit.status);
                  }}
                  className="px-3 py-1.5 text-sm font-medium text-gray-600 border border-gray-300 rounded hover:bg-gray-100"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Save Changes'}
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={onClose}
                  className="px-3 py-1.5 text-sm font-medium text-gray-600 border border-gray-300 rounded hover:bg-gray-100"
                >
                  Close
                </button>
                <button
                  onClick={() => setIsEditing(true)}
                  className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded hover:bg-blue-700"
                >
                  Edit
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Helper components ---

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    draft: 'bg-yellow-50 text-yellow-700',
    approved: 'bg-green-50 text-green-700',
    archived: 'bg-gray-100 text-gray-500',
  };
  const cls = colors[status] ?? 'bg-gray-100 text-gray-600';
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${cls}`}>
      {status}
    </span>
  );
}

export function SourceBadge({ sourceType }: { sourceType: string | null }) {
  const config: Record<string, { bg: string; label: string }> = {
    upload: { bg: 'bg-blue-100 text-blue-700', label: 'Upload' },
    harvest: { bg: 'bg-green-100 text-green-700', label: 'Harvested' },
    ai: { bg: 'bg-purple-100 text-purple-700', label: 'AI Generated' },
    manual: { bg: 'bg-gray-100 text-gray-600', label: 'Manual' },
  };
  const c = config[sourceType ?? 'manual'] ?? config.manual;
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${c.bg}`}>
      {c.label}
    </span>
  );
}

function getSourceLabel(sourceType: string | null): string {
  switch (sourceType) {
    case 'upload': return 'Uploaded Document';
    case 'harvest': return 'Harvested from Proposal';
    case 'ai': return 'AI Generated';
    case 'manual': return 'Manual Entry';
    default: return 'Unknown';
  }
}

function getOutcomeLabel(outcome: string | null): React.ReactNode {
  if (!outcome) return <span className="text-xs text-gray-400">None</span>;
  const config: Record<string, { cls: string; label: string }> = {
    awarded: { cls: 'bg-green-100 text-green-700', label: 'Awarded' },
    pending: { cls: 'bg-yellow-100 text-yellow-700', label: 'Pending' },
    rejected: { cls: 'bg-red-100 text-red-700', label: 'Rejected' },
    withdrawn: { cls: 'bg-gray-100 text-gray-500', label: 'Withdrawn' },
  };
  const c = config[outcome] ?? { cls: 'bg-gray-100 text-gray-600', label: outcome };
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${c.cls}`}>
      {c.label}
    </span>
  );
}

function getScoreColor(score: number | null): string {
  if (score == null) return 'bg-gray-300';
  if (score > 0.7) return 'bg-green-500';
  if (score > 0.4) return 'bg-yellow-500';
  return 'bg-red-500';
}

export function formatCategory(cat: string): string {
  return cat
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
