'use client';

import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useTool } from '@/lib/hooks/use-tool';
import { PdfViewer, type TextSelection } from './pdf-viewer';
import { TagPopover, type TagAction } from './tag-popover';
import { Autocomplete } from '@/components/ui/autocomplete';

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

interface Topic {
  id: string;
  topicNumber: string | null;
  title: string;
  topicBranch: string | null;
  topicStatus: string | null;
  techFocusAreas: string[];
  closeDate: string | null;
  isActive: boolean;
}

interface SolDocument {
  id: string;
  documentType: string;
  originalFilename: string;
  storageKey: string;
  fileSize: number | null;
  contentType: string | null;
  extractedAt: string | null;
  createdAt: string;
}

interface Props {
  solicitation: Solicitation;
  compliance: Record<string, unknown> | null;
  triageHistory: TriageAction[];
  topics: Topic[];
  documents: SolDocument[];
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

export function CurationWorkspace({ solicitation, compliance, triageHistory, topics, documents, currentUserId }: Props) {
  const { invoke, loading, error } = useTool();
  const router = useRouter();
  const [sol, setSol] = useState(solicitation);
  const [compState, setCompState] = useState(compliance);
  const [editingVar, setEditingVar] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>('');
  const [showAddTopic, setShowAddTopic] = useState(false);
  const [showBulkAddTopics, setShowBulkAddTopics] = useState(false);
  const [topicsList, setTopicsList] = useState(topics);

  // Keep local topicsList in sync with server-provided topics after
  // router.refresh() re-fetches. Without this the optimistic update
  // from AddTopicModal gets overwritten or goes stale.
  useEffect(() => {
    setTopicsList(topics);
  }, [topics]);

  // PDF text-selection → tag-popover state
  const [textSelection, setTextSelection] = useState<TextSelection | null>(null);
  const [variableCatalog, setVariableCatalog] = useState<{ name: string; label: string; category: string }[]>([]);
  const [catalogLoaded, setCatalogLoaded] = useState(false);

  // Load compliance variable catalog once for the tag popover
  useEffect(() => {
    if (catalogLoaded) return;
    (async () => {
      try {
        const result = await invoke<{ variables: { name: string; label: string; category: string }[] }>(
          'compliance.list_variables', {},
        );
        setVariableCatalog(result.variables);
        setCatalogLoaded(true);
      } catch {
        // catalog load failure is non-fatal — popover just shows empty
      }
    })();
  }, [catalogLoaded, invoke]);

  // Handle text selection from PDF viewer
  const handleTextSelect = useCallback((sel: TextSelection) => {
    setTextSelection(sel);
  }, []);

  // Handle tag action from the popover
  const handleTag = useCallback(async (action: TagAction) => {
    try {
      // If this is a new variable, create it first
      if (action.isNew) {
        await invoke('compliance.add_variable', {
          name: action.variableName,
          label: action.variableLabel,
          category: 'other',
          dataType: 'text',
        });
        setVariableCatalog((prev) => [
          ...prev,
          { name: action.variableName, label: action.variableLabel, category: 'other' },
        ]);
      }

      // Fetch memory-based suggestions for this variable + namespace
      let defaultValue = action.sourceExcerpt.length <= 100
        ? action.sourceExcerpt
        : '';
      try {
        const sugResp = await fetch(
          `/api/admin/compliance-suggest?variableName=${encodeURIComponent(action.variableName)}&namespace=${encodeURIComponent(sol.namespace ?? '')}`,
        );
        const sugJson = await sugResp.json();
        const suggestions: string[] = sugJson.data?.suggestions ?? [];
        if (suggestions.length > 0 && !defaultValue) {
          defaultValue = suggestions[0];
        }
        if (suggestions.length > 0) {
          // Show suggestions in the prompt
          const sugText = suggestions.slice(0, 5).map((s, i) => `  ${i + 1}. ${s}`).join('\n');
          const value = prompt(
            `Value for "${action.variableLabel}":\n\nSuggested from prior cycles:\n${sugText}\n\n(Source: "${action.sourceExcerpt.slice(0, 150)}")`,
            defaultValue,
          );
          if (value === null) return;

          await invoke('compliance.save_variable_value', {
            solicitationId: sol.id,
            variableName: action.variableName,
            value: value.trim(),
            sourceExcerpt: action.sourceExcerpt,
          });

          setCompState((prev) => ({
            ...prev,
            customVariables: {
              ...(prev?.customVariables as Record<string, unknown> ?? {}),
              [action.variableName]: {
                value: value.trim(),
                source_excerpt: action.sourceExcerpt,
                verified_by: currentUserId,
              },
            },
          }));

          setTextSelection(null);
          return;
        }
      } catch {
        // suggestion fetch failed — fall through to no-suggestion path
      }

      const value = prompt(
        `Value for "${action.variableLabel}":\n\n(Source: "${action.sourceExcerpt.slice(0, 200)}")`,
        defaultValue,
      );
      if (value === null) return;

      await invoke('compliance.save_variable_value', {
        solicitationId: sol.id,
        variableName: action.variableName,
        value: value.trim(),
        sourceExcerpt: action.sourceExcerpt,
      });

      // Update local compliance state
      setCompState((prev) => ({
        ...prev,
        customVariables: {
          ...(prev?.customVariables as Record<string, unknown> ?? {}),
          [action.variableName]: {
            value: value.trim(),
            source_excerpt: action.sourceExcerpt,
            verified_by: currentUserId,
          },
        },
      }));

      setTextSelection(null);
    } catch {
      // error shown via useTool
    }
  }, [invoke, sol.id, currentUserId]);

  // Find the first source document (PDF) for the viewer
  const sourcePdf = documents.find(
    (d) => d.documentType === 'source' && (d.contentType?.includes('pdf') || d.originalFilename.endsWith('.pdf')),
  );

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
          {/* Source Documents */}
          <div className="border rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold">Source Documents</h2>
              <span className="text-xs text-gray-500">
                {documents.length} file{documents.length !== 1 ? 's' : ''}
              </span>
            </div>
            {documents.length === 0 ? (
              <p className="text-sm text-gray-400">
                No documents uploaded yet. Upload RFP PDFs + attachments via the{' '}
                <a href="/admin/rfp-curation/upload" className="text-blue-600 hover:text-blue-800 underline">
                  upload page
                </a>.
              </p>
            ) : (
              <ul className="space-y-2">
                {documents.map((d) => (
                  <li key={d.id} className="flex items-center justify-between bg-gray-50 rounded px-3 py-2 text-sm">
                    <div className="flex-1 min-w-0">
                      <span className="inline-block w-20 text-xs font-mono text-gray-500">
                        {d.documentType}
                      </span>
                      <span className="text-gray-800 truncate">{d.originalFilename}</span>
                      {d.fileSize && (
                        <span className="ml-2 text-xs text-gray-400">
                          {(d.fileSize / 1024 / 1024).toFixed(2)} MB
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {d.extractedAt ? (
                        <span className="text-xs text-green-600">extracted</span>
                      ) : (
                        <span className="text-xs text-yellow-600">pending</span>
                      )}
                      <button
                        onClick={async () => {
                          try {
                            const resp = await fetch(
                              `/api/admin/rfp-document/${d.id}/signed-url`,
                            );
                            const json = await resp.json();
                            if (json.data?.url) window.open(json.data.url, '_blank');
                          } catch {
                            alert('Failed to generate signed URL');
                          }
                        }}
                        className="text-xs text-blue-600 hover:text-blue-800"
                      >
                        View
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Topics — the pursuable units under this solicitation */}
          <div className="border rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className="text-lg font-semibold">Topics</h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  Discrete pursuit units — what customers pin in Spotlight
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowBulkAddTopics(true)}
                  className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-medium rounded border border-gray-200"
                >
                  Bulk Import
                </button>
                <button
                  onClick={() => setShowAddTopic(true)}
                  className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded"
                >
                  + Add Topic
                </button>
              </div>
            </div>
            {topicsList.length === 0 ? (
              <p className="text-sm text-gray-400">
                No topics yet. Extract them from the source document, then add
                each one so customers can pin individual topics under this
                solicitation.
              </p>
            ) : (
              <ul className="space-y-2">
                {topicsList.map((t) => (
                  <li key={t.id} className="bg-gray-50 rounded px-3 py-2">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          {t.topicNumber && (
                            <span className="font-mono text-xs bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded">
                              {t.topicNumber}
                            </span>
                          )}
                          <span className="font-medium text-sm text-gray-800 truncate">
                            {t.title}
                          </span>
                        </div>
                        {(t.topicBranch || t.techFocusAreas.length > 0) && (
                          <div className="mt-1 flex items-center gap-2 text-xs text-gray-500">
                            {t.topicBranch && <span>{t.topicBranch}</span>}
                            {t.techFocusAreas.length > 0 && (
                              <span>&middot; {t.techFocusAreas.slice(0, 3).join(', ')}</span>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span
                          className={`text-xs px-2 py-0.5 rounded ${
                            t.topicStatus === 'open'
                              ? 'bg-green-100 text-green-700'
                              : t.topicStatus === 'pre_release'
                              ? 'bg-yellow-100 text-yellow-700'
                              : 'bg-gray-200 text-gray-600'
                          }`}
                        >
                          {t.topicStatus ?? '—'}
                        </span>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {showAddTopic && (
            <AddTopicModal
              solicitationId={sol.id}
              onClose={() => setShowAddTopic(false)}
              onCreated={(newTopic) => {
                setTopicsList((prev) => [...prev, newTopic]);
                setShowAddTopic(false);
                router.refresh();
              }}
            />
          )}
          {showBulkAddTopics && (
            <BulkAddTopicsModal
              solicitationId={sol.id}
              onClose={() => setShowBulkAddTopics(false)}
              onComplete={() => {
                setShowBulkAddTopics(false);
                router.refresh();
              }}
            />
          )}

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

          {/* PDF Viewer (side-by-side source) — or text fallback */}
          {sourcePdf ? (
            <div className="border rounded-lg overflow-hidden relative">
              <div className="flex items-center justify-between bg-gray-50 px-4 py-2 border-b">
                <h2 className="text-sm font-semibold text-gray-700">
                  Source Document — {sourcePdf.originalFilename}
                </h2>
                <span className="text-xs text-gray-400">
                  Select text to tag as a compliance variable
                </span>
              </div>
              <PdfViewer
                documentId={sourcePdf.id}
                onTextSelect={handleTextSelect}
                width={650}
              />
              {textSelection && (
                <TagPopover
                  selectedText={textSelection.text}
                  pageNumber={textSelection.pageNumber}
                  position={textSelection.rect}
                  variables={variableCatalog}
                  onTag={handleTag}
                  onClose={() => setTextSelection(null)}
                />
              )}
            </div>
          ) : sol.fullText ? (
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
          ) : (
            <div className="border rounded-lg p-4 text-center py-16 bg-gray-50">
              <p className="text-gray-400">No source document uploaded yet.</p>
              <a
                href="/admin/rfp-curation/upload"
                className="mt-2 text-sm text-blue-600 hover:text-blue-800 underline"
              >
                Upload an RFP
              </a>
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

// ─── AddTopicModal ─────────────────────────────────────────────────

function AddTopicModal({
  solicitationId,
  onClose,
  onCreated,
}: {
  solicitationId: string;
  onClose: () => void;
  onCreated: (t: Topic) => void;
}) {
  const { invoke, loading, error } = useTool();
  const [topicNumber, setTopicNumber] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [topicBranch, setTopicBranch] = useState('');
  const [techFocus, setTechFocus] = useState('');
  const [topicStatus, setTopicStatus] = useState<'open' | 'pre_release' | 'closed'>('open');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    try {
      const result = await invoke<{ topicId: string }>('opportunity.add_topic', {
        solicitationId,
        topicNumber: topicNumber.trim(),
        title: title.trim(),
        description: description.trim() || undefined,
        topicBranch: topicBranch.trim() || undefined,
        techFocusAreas: techFocus
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        topicStatus,
      });
      onCreated({
        id: result.topicId,
        topicNumber: topicNumber.trim(),
        title: title.trim(),
        topicBranch: topicBranch.trim() || null,
        topicStatus,
        techFocusAreas: techFocus
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        closeDate: null,
        isActive: true,
      });
    } catch {
      // error shown via useTool
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form
        onSubmit={submit}
        className="w-full max-w-xl bg-white rounded-lg shadow-xl p-6 space-y-4"
      >
        <div className="flex items-center justify-between">
          <h2 className="font-display text-xl font-bold text-navy-800">Add Topic</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <p className="text-sm text-gray-500">
          Topics are the discrete pursuit units customers pin via Spotlight (SBIR topic,
          BAA task, CSO focus area, OTA work order). Inherits compliance from the parent
          solicitation.
        </p>

        <div className="grid grid-cols-2 gap-3">
          <label className="col-span-1 block">
            <span className="block text-sm font-medium text-gray-700 mb-1">
              Topic Number <span className="text-red-500">*</span>
            </span>
            <input
              required
              value={topicNumber}
              onChange={(e) => setTopicNumber(e.target.value)}
              placeholder="AF261-001"
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 outline-none"
            />
          </label>
          <label className="col-span-1 block">
            <span className="block text-sm font-medium text-gray-700 mb-1">Topic Status</span>
            <select
              value={topicStatus}
              onChange={(e) => setTopicStatus(e.target.value as 'open' | 'pre_release' | 'closed')}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 outline-none"
            >
              <option value="open">Open</option>
              <option value="pre_release">Pre-release</option>
              <option value="closed">Closed</option>
            </select>
          </label>
        </div>

        <label className="block">
          <span className="block text-sm font-medium text-gray-700 mb-1">
            Title <span className="text-red-500">*</span>
          </span>
          <input
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Advanced Thermal Protection for Hypersonic Flight"
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 outline-none"
          />
        </label>

        <label className="block">
          <span className="block text-sm font-medium text-gray-700 mb-1">Description</span>
          <textarea
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Technical challenge the proposer is solving for..."
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 outline-none"
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="block text-sm font-medium text-gray-700 mb-1">
              Branch / Component
            </span>
            <Autocomplete
              value={topicBranch}
              onChange={setTopicBranch}
              suggestions={['Air Force', 'Army', 'Navy', 'Marine Corps', 'SOCOM', 'DARPA', 'DTRA', 'MDA', 'Space Force', 'DHA', 'NSA', 'NGA']}
              placeholder="Air Force, Navy, Army..."
            />
          </label>
          <label className="block">
            <span className="block text-sm font-medium text-gray-700 mb-1">
              Tech Focus Areas
            </span>
            <input
              value={techFocus}
              onChange={(e) => setTechFocus(e.target.value)}
              placeholder="AI/ML, Hypersonics (comma-separated)"
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 outline-none"
            />
          </label>
        </div>

        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="flex items-center justify-end gap-3 pt-2 border-t border-gray-100">
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-gray-600 hover:text-gray-800"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading || !topicNumber.trim() || !title.trim()}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded"
          >
            {loading ? 'Adding...' : 'Add Topic'}
          </button>
        </div>
      </form>
    </div>
  );
}

// ─── BulkAddTopicsModal ────────────────────────────────────────────

interface ParsedTopicLine {
  topicNumber: string;
  title: string;
  topicBranch?: string;
  techFocusAreas?: string[];
}

function parseBulkTopicsText(text: string): {
  topics: ParsedTopicLine[];
  errors: string[];
} {
  const topics: ParsedTopicLine[] = [];
  const errors: string[] = [];
  const lines = text.split('\n');
  lines.forEach((raw, idx) => {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) return;

    // Pipe-delimited: TOPIC_NUMBER | Title | Branch | focus_areas
    const parts = line.split('|').map((s) => s.trim());
    if (parts.length < 2) {
      errors.push(`Line ${idx + 1}: expected at least "TOPIC_NUMBER | Title"`);
      return;
    }
    const [topicNumber, title, branch, focusAreas] = parts;
    if (!topicNumber || !title) {
      errors.push(`Line ${idx + 1}: missing topic number or title`);
      return;
    }
    topics.push({
      topicNumber,
      title,
      topicBranch: branch || undefined,
      techFocusAreas: focusAreas
        ? focusAreas.split(',').map((s) => s.trim()).filter(Boolean)
        : undefined,
    });
  });
  return { topics, errors };
}

function BulkAddTopicsModal({
  solicitationId,
  onClose,
  onComplete,
}: {
  solicitationId: string;
  onClose: () => void;
  onComplete: () => void;
}) {
  const { invoke, loading, error } = useTool();
  const [text, setText] = useState('');
  const [defaultBranch, setDefaultBranch] = useState('');
  const [result, setResult] = useState<{ inserted: number; skipped: string[] } | null>(null);

  const { topics, errors: parseErrors } = parseBulkTopicsText(text);

  async function submit() {
    if (topics.length === 0) return;
    try {
      const res = await invoke<{
        inserted: { id: string; topicNumber: string }[];
        skipped: string[];
      }>('opportunity.bulk_add_topics', {
        solicitationId,
        topics,
        defaultBranch: defaultBranch.trim() || undefined,
        topicStatus: 'open',
      });
      setResult({ inserted: res.inserted.length, skipped: res.skipped });
      // Auto-close + refresh after a short delay so the admin sees the result
      setTimeout(() => {
        onComplete();
      }, 1800);
    } catch {
      // error surfaced via useTool
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-2xl bg-white rounded-lg shadow-xl p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-xl font-bold text-navy-800">Bulk Import Topics</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >✕</button>
        </div>
        <p className="text-sm text-gray-500">
          Paste one topic per line in pipe-delimited format. Only{' '}
          <code className="text-xs bg-gray-100 px-1 rounded">TOPIC_NUMBER | Title</code>{' '}
          is required.
          Lines starting with <code className="text-xs bg-gray-100 px-1 rounded">#</code>{' '}
          are comments.
        </p>

        <label className="block">
          <span className="block text-sm font-medium text-gray-700 mb-1">Default branch (optional — applied to rows that don&apos;t specify one)</span>
          <input
            value={defaultBranch}
            onChange={(e) => setDefaultBranch(e.target.value)}
            placeholder="Air Force, Navy, Army..."
            className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 outline-none"
          />
        </label>

        <label className="block">
          <span className="block text-sm font-medium text-gray-700 mb-1">Topics</span>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={14}
            spellCheck={false}
            placeholder={`# Format: TOPIC_NUMBER | Title | Branch | focus_areas
AF261-001 | Advanced Thermal Protection for Hypersonic Flight | Air Force | hypersonics, materials
AF261-002 | Autonomous Navigation for GPS-Denied Environments | Air Force | autonomy, robotics
N261-T01 | Quantum Sensing for Undersea Detection | Navy | quantum, sensing`}
            className="w-full rounded border border-gray-300 px-3 py-2 text-xs font-mono focus:border-blue-500 outline-none"
          />
        </label>

        {parseErrors.length > 0 && (
          <div className="p-3 bg-yellow-50 border border-yellow-200 rounded text-xs text-yellow-800">
            <p className="font-semibold mb-1">{parseErrors.length} parse warning{parseErrors.length > 1 ? 's' : ''}:</p>
            <ul className="list-disc pl-4 space-y-0.5">
              {parseErrors.slice(0, 5).map((e, i) => <li key={i}>{e}</li>)}
              {parseErrors.length > 5 && <li>...and {parseErrors.length - 5} more</li>}
            </ul>
          </div>
        )}

        <div className="p-3 bg-blue-50 border border-blue-100 rounded text-xs text-blue-800">
          <strong>{topics.length}</strong> topic{topics.length !== 1 ? 's' : ''} parsed and ready to import.
          Duplicates (by topic number) will be skipped.
        </div>

        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
            {error}
          </div>
        )}

        {result && (
          <div className="p-3 bg-green-50 border border-green-200 rounded text-sm text-green-800">
            Imported <strong>{result.inserted}</strong> new topic{result.inserted !== 1 ? 's' : ''}.
            {result.skipped.length > 0 && (
              <span className="block mt-1 text-xs text-green-700">
                Skipped {result.skipped.length} duplicate{result.skipped.length !== 1 ? 's' : ''}:{' '}
                {result.skipped.slice(0, 5).join(', ')}
                {result.skipped.length > 5 && `, +${result.skipped.length - 5} more`}
              </span>
            )}
          </div>
        )}

        <div className="flex items-center justify-end gap-3 pt-2 border-t border-gray-100">
          <button
            onClick={onClose}
            className="text-sm text-gray-600 hover:text-gray-800"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={loading || topics.length === 0 || result !== null}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded"
          >
            {loading ? 'Importing...' : `Import ${topics.length || ''} Topic${topics.length !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}
