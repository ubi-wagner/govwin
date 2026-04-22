'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTool } from '@/lib/hooks/use-tool';

interface Solicitation {
  id: string;
  opportunityId: string;
  status: string;
  namespace: string | null;
  claimedBy: string | null;
  curatedBy: string | null;
  approvedBy: string | null;
  aiExtracted: unknown;
  fullText: string | null;
  title: string;
  source: string;
  agency: string | null;
  office: string | null;
  programType: string | null;
  solicitationNumber: string | null;
  description: string | null;
  closeDate: string | null;
  postedDate: string | null;
  createdAt: string;
}

interface TriageAction {
  id: string;
  action: string;
  actorId: string;
  notes: string | null;
  createdAt: string;
}

interface Props {
  solicitation: Solicitation;
  compliance: Record<string, unknown> | null;
  triageHistory: TriageAction[];
  currentUserId: string;
}

const STATUS_FLOW: Record<string, string[]> = {
  new: ['claim'],
  claimed: ['release', 'dismiss'],
  released_for_analysis: [],
  ai_analyzed: ['start_curation'],
  shredder_failed: ['dismiss'],
  curation_in_progress: ['request_review', 'dismiss'],
  review_requested: ['approve', 'reject_review'],
  approved: ['push'],
  pushed_to_pipeline: [],
  dismissed: [],
};

const COMPLIANCE_FIELDS = [
  { key: 'pageLimitTechnical', label: 'Page Limit (Technical)', type: 'int' },
  { key: 'pageLimitCost', label: 'Page Limit (Cost)', type: 'int' },
  { key: 'fontFamily', label: 'Font Family', type: 'text' },
  { key: 'fontSize', label: 'Font Size', type: 'text' },
  { key: 'margins', label: 'Margins', type: 'text' },
  { key: 'submissionFormat', label: 'Submission Format', type: 'text' },
  { key: 'slidesAllowed', label: 'Slides Allowed', type: 'bool' },
  { key: 'slideLimit', label: 'Slide Limit', type: 'int' },
  { key: 'tabaAllowed', label: 'TABA Allowed', type: 'bool' },
  { key: 'piMustBeEmployee', label: 'PI Must Be Employee', type: 'bool' },
  { key: 'partnerMaxPct', label: 'Partner Max %', type: 'numeric' },
  { key: 'clearanceRequired', label: 'Clearance Required', type: 'text' },
  { key: 'itarRequired', label: 'ITAR Required', type: 'bool' },
] as const;

function snakeCase(s: string): string {
  return s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

export function CurationWorkspace({ solicitation, compliance, triageHistory, currentUserId }: Props) {
  const { invoke, loading, error } = useTool();
  const router = useRouter();
  const [sol, setSol] = useState(solicitation);
  const [compState, setCompState] = useState(compliance);
  const [editingVar, setEditingVar] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>('');

  const actions = STATUS_FLOW[sol.status] ?? [];
  const isMyClaimOrUnclaimed =
    !sol.claimedBy || sol.claimedBy === currentUserId;
  const iAmTheCurator = sol.curatedBy === currentUserId;

  const handleAction = async (action: string) => {
    try {
      switch (action) {
        case 'claim':
          await invoke('solicitation.claim', { solicitationId: sol.id });
          setSol((s) => ({ ...s, status: 'claimed', claimedBy: currentUserId }));
          break;
        case 'release':
          await invoke('solicitation.release', { solicitationId: sol.id });
          setSol((s) => ({ ...s, status: 'released_for_analysis' }));
          break;
        case 'dismiss': {
          const notes = prompt('Reason for dismissal:');
          await invoke('solicitation.dismiss', { solicitationId: sol.id, notes: notes || undefined });
          setSol((s) => ({ ...s, status: 'dismissed' }));
          break;
        }
        case 'start_curation':
          setSol((s) => ({ ...s, status: 'curation_in_progress' }));
          break;
        case 'request_review':
          await invoke('solicitation.request_review', { solicitationId: sol.id });
          setSol((s) => ({ ...s, status: 'review_requested', curatedBy: currentUserId }));
          break;
        case 'approve':
          await invoke('solicitation.approve', { solicitationId: sol.id });
          setSol((s) => ({ ...s, status: 'approved', approvedBy: currentUserId }));
          break;
        case 'reject_review': {
          const notes = prompt('Reason for rejection (required):');
          if (!notes) return;
          await invoke('solicitation.reject_review', { solicitationId: sol.id, notes });
          setSol((s) => ({ ...s, status: 'curation_in_progress' }));
          break;
        }
        case 'push':
          await invoke('solicitation.push', { solicitationId: sol.id });
          setSol((s) => ({ ...s, status: 'pushed_to_pipeline' }));
          break;
      }
      router.refresh();
    } catch {
      // error shown via useTool
    }
  };

  const handleSaveVariable = async (varName: string) => {
    const snakeName = snakeCase(varName);
    const value = editValue.trim();
    if (!value) return;

    // Coerce booleans and ints client-side for better UX
    let parsed: unknown = value;
    const field = COMPLIANCE_FIELDS.find((f) => f.key === varName);
    if (field?.type === 'bool') {
      parsed = ['true', 'yes', '1'].includes(value.toLowerCase());
    } else if (field?.type === 'int') {
      parsed = parseInt(value, 10);
      if (Number.isNaN(parsed)) { alert('Please enter a valid integer'); return; }
    } else if (field?.type === 'numeric') {
      parsed = parseFloat(value);
      if (Number.isNaN(parsed)) { alert('Please enter a valid number'); return; }
    }

    try {
      await invoke('compliance.save_variable_value', {
        solicitationId: sol.id,
        variableName: snakeName,
        value: parsed,
      });
      setCompState((prev) => ({
        ...prev,
        customVariables: {
          ...(prev?.customVariables as Record<string, unknown> ?? {}),
          [snakeName]: { value: parsed, verified_by: currentUserId },
        },
      }));
      setEditingVar(null);
      setEditValue('');
    } catch {
      // error via useTool
    }
  };

  // Merge AI-suggested (named columns) with human-verified (custom_variables)
  function getComplianceValue(camelKey: string): { value: unknown; source: 'ai' | 'verified' | null } {
    const snakeKey = snakeCase(camelKey);
    const custom = (compState?.customVariables as Record<string, { value: unknown }> | null);
    if (custom?.[snakeKey]) {
      return { value: custom[snakeKey].value, source: 'verified' };
    }
    const aiVal = compState?.[camelKey as keyof typeof compState];
    if (aiVal !== null && aiVal !== undefined) {
      return { value: aiVal, source: 'ai' };
    }
    return { value: null, source: null };
  }

  // AI-extracted sections from the shredder
  const aiData = sol.aiExtracted as {
    sections?: Array<{ key: string; title: string; summary: string }>;
    compliance_matches?: Array<{ variable_name: string; value: unknown; confidence: number }>;
  } | null;

  return (
    <div className="max-w-6xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <button
            onClick={() => router.push('/admin/rfp-curation')}
            className="text-sm text-blue-600 hover:text-blue-800 mb-2 block"
          >
            &larr; Back to Triage Queue
          </button>
          <h1 className="text-2xl font-bold">{sol.title}</h1>
          <p className="text-sm text-gray-500 mt-1">
            {sol.source} &middot; {sol.agency ?? 'Unknown Agency'} &middot;{' '}
            {sol.programType?.replace(/_/g, ' ') ?? 'Unknown Type'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`px-3 py-1 text-sm font-medium rounded-full ${
            sol.status === 'pushed_to_pipeline' ? 'bg-emerald-100 text-emerald-800' :
            sol.status === 'dismissed' ? 'bg-gray-200 text-gray-600' :
            sol.status === 'approved' ? 'bg-green-100 text-green-800' :
            'bg-blue-100 text-blue-800'
          }`}>
            {sol.status.replace(/_/g, ' ')}
          </span>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Action buttons */}
      {actions.length > 0 && isMyClaimOrUnclaimed && (
        <div className="flex gap-2 mb-6 p-4 bg-gray-50 rounded-lg border">
          {actions.map((action) => (
            <button
              key={action}
              onClick={() => handleAction(action)}
              disabled={loading}
              className={`px-4 py-2 text-sm font-medium rounded ${
                action === 'push' ? 'bg-emerald-600 text-white hover:bg-emerald-700' :
                action === 'approve' ? 'bg-green-600 text-white hover:bg-green-700' :
                action === 'dismiss' ? 'bg-gray-300 text-gray-700 hover:bg-gray-400' :
                action === 'reject_review' ? 'bg-red-100 text-red-700 hover:bg-red-200' :
                'bg-blue-600 text-white hover:bg-blue-700'
              } disabled:opacity-50`}
            >
              {action.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Solicitation text + AI sections */}
        <div className="lg:col-span-2 space-y-6">
          {/* AI-Extracted Sections */}
          {aiData?.sections && aiData.sections.length > 0 && (
            <div className="border rounded-lg p-4">
              <h2 className="text-lg font-semibold mb-3">AI-Extracted Sections</h2>
              <div className="space-y-3">
                {aiData.sections.map((sec) => (
                  <div key={sec.key} className="p-3 bg-indigo-50 rounded border border-indigo-100">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-mono bg-indigo-100 px-1.5 py-0.5 rounded">
                        {sec.key}
                      </span>
                      <span className="font-medium text-sm">{sec.title}</span>
                    </div>
                    <p className="text-sm text-gray-600">{sec.summary}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Full Text Preview */}
          {sol.fullText && (
            <div className="border rounded-lg p-4">
              <h2 className="text-lg font-semibold mb-3">Source Text</h2>
              <div className="max-h-96 overflow-y-auto text-sm text-gray-700 whitespace-pre-wrap font-mono bg-gray-50 p-4 rounded">
                {sol.fullText.slice(0, 10000)}
                {sol.fullText.length > 10000 && (
                  <div className="mt-2 text-gray-400 italic">
                    ... truncated ({(sol.fullText.length / 1000).toFixed(0)}K chars total)
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Description */}
          {sol.description && (
            <div className="border rounded-lg p-4">
              <h2 className="text-lg font-semibold mb-3">Opportunity Description</h2>
              <p className="text-sm text-gray-700">{sol.description}</p>
            </div>
          )}
        </div>

        {/* Right sidebar: Compliance Matrix + Metadata + History */}
        <div className="space-y-6">
          {/* Compliance Matrix */}
          <div className="border rounded-lg p-4">
            <h2 className="text-lg font-semibold mb-3">Compliance Matrix</h2>
            <div className="space-y-2">
              {COMPLIANCE_FIELDS.map((field) => {
                const { value, source } = getComplianceValue(field.key);
                return (
                  <div key={field.key} className="flex items-center justify-between py-1 border-b border-gray-100 last:border-0">
                    <div className="flex-1">
                      <span className="text-sm text-gray-700">{field.label}</span>
                      {source && (
                        <span className={`ml-2 text-xs px-1.5 py-0.5 rounded ${
                          source === 'verified' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
                        }`}>
                          {source === 'verified' ? 'Verified' : 'AI'}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {editingVar === field.key ? (
                        <>
                          <input
                            type="text"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleSaveVariable(field.key);
                              if (e.key === 'Escape') { setEditingVar(null); setEditValue(''); }
                            }}
                            className="w-32 text-sm border rounded px-2 py-1"
                            autoFocus
                          />
                          <button
                            onClick={() => handleSaveVariable(field.key)}
                            disabled={loading}
                            className="text-xs text-green-600 hover:text-green-800 font-medium"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => { setEditingVar(null); setEditValue(''); }}
                            className="text-xs text-gray-400 hover:text-gray-600"
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <span className={`text-sm font-medium ${value !== null ? 'text-gray-900' : 'text-gray-300'}`}>
                            {value !== null ? String(value) : '—'}
                          </span>
                          {['curation_in_progress', 'ai_analyzed', 'claimed'].includes(sol.status) && (
                            <button
                              onClick={() => {
                                setEditingVar(field.key);
                                setEditValue(value !== null ? String(value) : '');
                              }}
                              className="text-xs text-blue-500 hover:text-blue-700"
                            >
                              Edit
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Metadata */}
          <div className="border rounded-lg p-4">
            <h2 className="text-lg font-semibold mb-3">Metadata</h2>
            <dl className="text-sm space-y-2">
              <div>
                <dt className="text-gray-500">Namespace</dt>
                <dd className="font-mono text-xs">{sol.namespace ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-gray-500">Solicitation #</dt>
                <dd>{sol.solicitationNumber ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-gray-500">Close Date</dt>
                <dd>{sol.closeDate ? new Date(sol.closeDate).toLocaleDateString() : '—'}</dd>
              </div>
              <div>
                <dt className="text-gray-500">Posted Date</dt>
                <dd>{sol.postedDate ? new Date(sol.postedDate).toLocaleDateString() : '—'}</dd>
              </div>
              <div>
                <dt className="text-gray-500">Claimed By</dt>
                <dd>{sol.claimedBy ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-gray-500">Curated By</dt>
                <dd>{sol.curatedBy ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-gray-500">Approved By</dt>
                <dd>{sol.approvedBy ?? '—'}</dd>
              </div>
            </dl>
          </div>

          {/* Triage History */}
          <div className="border rounded-lg p-4">
            <h2 className="text-lg font-semibold mb-3">History</h2>
            {triageHistory.length === 0 ? (
              <p className="text-sm text-gray-400">No actions yet.</p>
            ) : (
              <div className="space-y-2">
                {triageHistory.map((t) => (
                  <div key={t.id} className="text-sm border-l-2 border-blue-200 pl-3 py-1">
                    <div className="font-medium text-gray-700">
                      {t.action.replace(/_/g, ' ')}
                    </div>
                    {t.notes && (
                      <div className="text-gray-500 text-xs mt-0.5">{t.notes}</div>
                    )}
                    <div className="text-gray-400 text-xs">
                      {new Date(t.createdAt).toLocaleString()} &middot; {t.actorId.slice(0, 8)}...
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
