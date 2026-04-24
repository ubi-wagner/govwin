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
  actorName: string | null;
  actorEmail: string | null;
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

interface RequiredItem {
  id: string;
  itemNumber: number;
  itemName: string;
  itemType: string;
  required: boolean;
  pageLimit: number | null;
  slideLimit: number | null;
  fontFamily: string | null;
  fontSize: string | null;
  margins: string | null;
  lineSpacing: string | null;
  headerFormat: string | null;
  footerFormat: string | null;
  appliesToPhase: string[] | null;
  verifiedBy: string | null;
}

interface Volume {
  id: string;
  volumeNumber: number;
  volumeName: string;
  volumeFormat: string | null;
  description: string | null;
  specialRequirements: string[];
  appliesToPhase: string[] | null;
  items: RequiredItem[];
}

interface ActivityEvent {
  id: string;
  type: string;
  phase: string;
  actorId: string;
  actorName: string | null;
  actorEmail: string | null;
  payload: Record<string, unknown> | null;
  createdAt: string;
}

interface InitialAnnotation {
  id: string;
  pageNumber: number;
  sourceExcerpt: string;
  complianceVariableName: string | null;
}

interface Props {
  solicitation: Solicitation;
  compliance: Record<string, unknown> | null;
  triageHistory: TriageAction[];
  activityEvents: ActivityEvent[];
  topics: Topic[];
  documents: SolDocument[];
  volumes: Volume[];
  initialAnnotations: InitialAnnotation[];
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

export function CurationWorkspace({
  solicitation, compliance, triageHistory, activityEvents,
  topics, documents, volumes, initialAnnotations, currentUserId,
}: Props) {
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

  // Persistent annotations loaded from the DB — render as highlight
  // overlays on the PDF. Initially fetched via /api/admin/rfp-document
  // when the viewer mounts (future enhancement); for now they get added
  // in memory as the admin tags things and survive within-session.
  const [annotations, setAnnotations] = useState<Array<{
    id: string;
    pageNumber: number;
    sourceExcerpt: string;
    complianceVariableName: string | null;
  }>>(initialAnnotations);

  // Save a highlight annotation after tagging — persists to
  // solicitation_annotations so re-opening the workspace shows
  // the colored overlays on the PDF.
  const saveAnnotation = useCallback(async (args: {
    pageNumber: number;
    sourceExcerpt: string;
    complianceVariableName?: string;
  }) => {
    try {
      const result = await invoke<{ id: string; kind: string }>(
        'solicitation.save_annotation',
        {
          solicitationId: sol.id,
          kind: 'compliance_tag',
          sourceLocation: {
            page: args.pageNumber,
            offset: 0,
            length: args.sourceExcerpt.length,
          },
          payload: {
            excerpt: args.sourceExcerpt,
            variable_name: args.complianceVariableName ?? null,
          },
          complianceVariableName: args.complianceVariableName,
        },
      );
      setAnnotations((prev) => [
        ...prev,
        {
          id: result.id,
          pageNumber: args.pageNumber,
          sourceExcerpt: args.sourceExcerpt,
          complianceVariableName: args.complianceVariableName ?? null,
        },
      ]);
    } catch {
      // annotation-save failure is non-fatal; the compliance value still saved
    }
  }, [invoke, sol.id]);

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

          await saveAnnotation({
            pageNumber: action.pageNumber,
            sourceExcerpt: action.sourceExcerpt,
            complianceVariableName: action.variableName,
          });

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

      await saveAnnotation({
        pageNumber: action.pageNumber,
        sourceExcerpt: action.sourceExcerpt,
        complianceVariableName: action.variableName,
      });

      setTextSelection(null);
    } catch {
      // error shown via useTool
    }
  }, [invoke, sol.id, currentUserId, saveAnnotation]);

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
                  <li
                    key={t.id}
                    className="bg-gray-50 rounded px-3 py-2 cursor-pointer hover:bg-gray-100"
                    onClick={() => router.push(`/admin/rfp-curation/${sol.id}/topic/${t.id}`)}
                  >
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

          {/* Volumes (proposal response structure) */}
          <VolumesPanel
            solicitationId={sol.id}
            volumes={volumes}
          />

          {/* AI Compliance Suggestions — accept/reject one at a time */}
          {aiData?.compliance_matches && aiData.compliance_matches.length > 0 && (
            <AISuggestionsPanel
              solicitationId={sol.id}
              matches={aiData.compliance_matches}
              verifiedVariables={
                Object.keys(
                  (compState?.customVariables as Record<string, unknown>) ?? {},
                )
              }
              onAccepted={() => router.refresh()}
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
                  {annotations.length > 0 && (
                    <span className="ml-2 text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded">
                      {annotations.length} tag{annotations.length !== 1 ? 's' : ''}
                    </span>
                  )}
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

          {/* Activity Feed (combines state-machine actions + tool events) */}
          <div className="border rounded-lg p-4">
            <h2 className="text-lg font-semibold mb-3">Activity</h2>
            {triageHistory.length === 0 && activityEvents.length === 0 ? (
              <p className="text-sm text-gray-400">No activity yet.</p>
            ) : (
              <div className="space-y-3 max-h-96 overflow-y-auto">
                {renderCombinedActivity(triageHistory, activityEvents)}
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

// ─── Activity feed helpers ─────────────────────────────────────────

function humanAction(action: string): string {
  const map: Record<string, string> = {
    claim: 'claimed this solicitation',
    release: 'released for AI analysis',
    dismiss: 'dismissed this solicitation',
    request_review: 'requested review',
    approve: 'approved the curation',
    reject_review: 'rejected the review',
    push: 'pushed to the pipeline',
  };
  return map[action] ?? action.replace(/_/g, ' ');
}

function humanEvent(
  type: string,
  payload: Record<string, unknown> | null,
): string {
  const v = (k: string) => (payload && payload[k] != null ? String(payload[k]) : null);

  switch (type) {
    case 'topic.added':
      return `added topic ${v('topicNumber') ?? ''}`;
    case 'topic.bulk_added':
      return `bulk-added ${v('insertedCount') ?? '?'} topics (${v('skippedCount') ?? '0'} skipped)`;
    case 'volume.added':
      return `added Volume ${v('volumeNumber') ?? ''} — ${v('volumeName') ?? ''}`;
    case 'volume.deleted':
      return `deleted Volume ${v('volumeNumber') ?? ''}`;
    case 'required_item.added':
      return `added required item "${v('itemName') ?? ''}"`;
    case 'required_item.updated':
      return `updated a required item`;
    case 'required_item.deleted':
      return `deleted a required item`;
    case 'rfp.annotation_saved':
      return `tagged source text as ${v('complianceVariableName') ?? 'annotation'}`;
    case 'rfp.shredding.start':
      return `started AI analysis`;
    case 'rfp.shredding.end':
      return `completed AI analysis (${v('sections_extracted') ?? '?'} sections, ${v('compliance_variables_extracted') ?? '?'} compliance matches)`;
    default:
      return type.replace(/\./g, ' ').replace(/_/g, ' ');
  }
}

interface UnifiedActivity {
  id: string;
  actorName: string | null;
  actorEmail: string | null;
  actorId: string;
  description: string;
  notes: string | null;
  createdAt: string;
  source: 'triage' | 'event';
}

function renderCombinedActivity(
  triage: TriageAction[],
  events: ActivityEvent[],
): React.ReactNode {
  const unified: UnifiedActivity[] = [
    ...triage.map<UnifiedActivity>((t) => ({
      id: `t-${t.id}`,
      actorName: t.actorName,
      actorEmail: t.actorEmail,
      actorId: t.actorId,
      description: humanAction(t.action),
      notes: t.notes,
      createdAt: t.createdAt,
      source: 'triage' as const,
    })),
    ...events
      // Skip phase='start'/'end' pairs from tools to reduce noise — keep
      // the end (which has final status) and drop the start.
      .filter((e) => e.phase !== 'start')
      .map<UnifiedActivity>((e) => ({
        id: `e-${e.id}`,
        actorName: e.actorName,
        actorEmail: e.actorEmail,
        actorId: e.actorId,
        description: humanEvent(e.type, e.payload),
        notes: null,
        createdAt: e.createdAt,
        source: 'event' as const,
      })),
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return unified.map((u) => {
    const name = u.actorName ?? u.actorEmail ?? 'System';
    const when = new Date(u.createdAt);
    return (
      <div
        key={u.id}
        className={`text-sm border-l-2 pl-3 py-1 ${
          u.source === 'triage' ? 'border-blue-300' : 'border-indigo-200'
        }`}
      >
        <div className="text-gray-700">
          <span className="font-medium text-navy-800">{name}</span>{' '}
          {u.description}
        </div>
        {u.notes && (
          <div className="text-gray-500 text-xs mt-0.5 italic">&ldquo;{u.notes}&rdquo;</div>
        )}
        <div className="text-gray-400 text-xs mt-0.5">
          {when.toLocaleString()}
        </div>
      </div>
    );
  });
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

// ─── VolumesPanel ──────────────────────────────────────────────────

function VolumesPanel({
  solicitationId,
  volumes: initialVolumes,
}: {
  solicitationId: string;
  volumes: Volume[];
}) {
  const router = useRouter();
  const { invoke, loading, error } = useTool();
  const [volumes, setVolumes] = useState(initialVolumes);
  const [showAddVolume, setShowAddVolume] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [addItemToVolume, setAddItemToVolume] = useState<string | null>(null);
  const [editItem, setEditItem] = useState<RequiredItem | null>(null);

  useEffect(() => setVolumes(initialVolumes), [initialVolumes]);

  const toggle = (volumeId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(volumeId)) next.delete(volumeId);
      else next.add(volumeId);
      return next;
    });
  };

  async function deleteVolume(volumeId: string) {
    if (!confirm('Delete this volume and all its required items?')) return;
    try {
      await invoke('volume.delete', { volumeId });
      setVolumes((prev) => prev.filter((v) => v.id !== volumeId));
      router.refresh();
    } catch {
      /* surfaced via useTool error */
    }
  }

  async function deleteItem(itemId: string) {
    if (!confirm('Delete this required item?')) return;
    try {
      await invoke('volume.delete_required_item', { itemId });
      router.refresh();
    } catch {
      /* surfaced via useTool error */
    }
  }

  return (
    <div className="border rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-lg font-semibold">Response Volumes</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            The proposal structure — what the proposer must produce for each volume
          </p>
        </div>
        <button
          onClick={() => setShowAddVolume(true)}
          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded"
        >
          + Add Volume
        </button>
      </div>

      {error && (
        <div className="mb-2 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
          {error}
        </div>
      )}

      {volumes.length === 0 ? (
        <p className="text-sm text-gray-400">
          No volumes defined yet. Add volumes to describe the response structure
          (Cover Sheet, Technical Volume, Cost Volume, etc.).
        </p>
      ) : (
        <div className="space-y-2">
          {volumes.map((vol) => {
            const isOpen = expanded.has(vol.id);
            return (
              <div key={vol.id} className="bg-gray-50 rounded border border-gray-200">
                <div
                  className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-gray-100"
                  onClick={() => toggle(vol.id)}
                >
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <span className="font-mono text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">
                      Vol {vol.volumeNumber}
                    </span>
                    <span className="font-medium text-sm text-gray-800 truncate">
                      {vol.volumeName}
                    </span>
                    <span className="text-xs text-gray-500">
                      {vol.items.length} item{vol.items.length !== 1 ? 's' : ''}
                    </span>
                    {vol.appliesToPhase && vol.appliesToPhase.length > 0 && (
                      <span className="text-xs bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded">
                        {vol.appliesToPhase.join(', ')}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteVolume(vol.id);
                      }}
                      disabled={loading}
                      className="text-xs text-red-600 hover:text-red-800"
                    >
                      Delete
                    </button>
                    <span className="text-gray-400 text-xs">{isOpen ? '▼' : '▶'}</span>
                  </div>
                </div>
                {isOpen && (
                  <div className="px-3 pb-3 space-y-2">
                    {vol.description && (
                      <p className="text-xs text-gray-500 italic">{vol.description}</p>
                    )}
                    {vol.specialRequirements.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {vol.specialRequirements.map((r) => (
                          <span key={r} className="text-xs bg-yellow-100 text-yellow-800 px-1.5 py-0.5 rounded">
                            {r}
                          </span>
                        ))}
                      </div>
                    )}

                    {vol.items.length === 0 ? (
                      <p className="text-xs text-gray-400 italic">No required items. Add the artifacts this volume requires.</p>
                    ) : (
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-gray-500 text-left border-b border-gray-200">
                            <th className="py-1 pr-2 font-medium">Item</th>
                            <th className="py-1 pr-2 font-medium">Type</th>
                            <th className="py-1 pr-2 font-medium">Limit</th>
                            <th className="py-1 pr-2 font-medium">Format</th>
                            <th className="py-1 pr-2 font-medium">Phase</th>
                            <th className="py-1 font-medium"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {vol.items.map((item) => (
                            <tr key={item.id} className="border-b border-gray-100 last:border-0">
                              <td className="py-1.5 pr-2">
                                <div className="font-medium text-gray-800">{item.itemName}</div>
                                {item.required && <span className="text-xs text-red-600">required</span>}
                              </td>
                              <td className="py-1.5 pr-2 text-gray-600">
                                <code className="text-xs bg-gray-200 px-1 rounded">{item.itemType}</code>
                              </td>
                              <td className="py-1.5 pr-2 text-gray-700">
                                {item.pageLimit != null ? `${item.pageLimit} pp` : ''}
                                {item.slideLimit != null ? `${item.slideLimit} slides` : ''}
                              </td>
                              <td className="py-1.5 pr-2 text-gray-700">
                                {[item.fontFamily, item.fontSize, item.margins].filter(Boolean).join(' / ') || '—'}
                              </td>
                              <td className="py-1.5 pr-2 text-gray-500">
                                {item.appliesToPhase && item.appliesToPhase.length > 0
                                  ? item.appliesToPhase.join(',')
                                  : 'all'}
                              </td>
                              <td className="py-1.5 text-right">
                                <button
                                  onClick={() => setEditItem(item)}
                                  className="text-xs text-blue-600 hover:text-blue-800 mr-2"
                                >
                                  Edit
                                </button>
                                <button
                                  onClick={() => deleteItem(item.id)}
                                  disabled={loading}
                                  className="text-xs text-red-600 hover:text-red-800"
                                >
                                  Del
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}

                    <button
                      onClick={() => setAddItemToVolume(vol.id)}
                      className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                    >
                      + Add required item
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {showAddVolume && (
        <AddVolumeModal
          solicitationId={solicitationId}
          nextNumber={Math.max(0, ...volumes.map((v) => v.volumeNumber)) + 1}
          onClose={() => setShowAddVolume(false)}
          onCreated={() => {
            setShowAddVolume(false);
            router.refresh();
          }}
        />
      )}

      {addItemToVolume && (
        <AddEditItemModal
          mode="add"
          volumeId={addItemToVolume}
          nextNumber={
            Math.max(
              0,
              ...(volumes.find((v) => v.id === addItemToVolume)?.items.map((i) => i.itemNumber) ??
                [0]),
            ) + 1
          }
          onClose={() => setAddItemToVolume(null)}
          onSaved={() => {
            setAddItemToVolume(null);
            router.refresh();
          }}
        />
      )}

      {editItem && (
        <AddEditItemModal
          mode="edit"
          item={editItem}
          volumeId={
            volumes.find((v) => v.items.some((i) => i.id === editItem.id))?.id ?? ''
          }
          nextNumber={editItem.itemNumber}
          onClose={() => setEditItem(null)}
          onSaved={() => {
            setEditItem(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function AddVolumeModal({
  solicitationId,
  nextNumber,
  onClose,
  onCreated,
}: {
  solicitationId: string;
  nextNumber: number;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { invoke, loading, error } = useTool();
  const [volumeNumber, setVolumeNumber] = useState(nextNumber);
  const [volumeName, setVolumeName] = useState('');
  const [volumeFormat, setVolumeFormat] = useState<'dsip_standard' | 'l_and_m' | 'custom'>('dsip_standard');
  const [description, setDescription] = useState('');
  const [specialRequirementsText, setSpecialRequirementsText] = useState('');
  const [appliesToPhaseText, setAppliesToPhaseText] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await invoke('volume.add', {
        solicitationId,
        volumeNumber,
        volumeName: volumeName.trim(),
        volumeFormat,
        description: description.trim() || undefined,
        specialRequirements: specialRequirementsText
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        appliesToPhase: appliesToPhaseText
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean).length
          ? appliesToPhaseText.split(',').map((s) => s.trim()).filter(Boolean)
          : undefined,
      });
      onCreated();
    } catch {
      /* surfaced via useTool */
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <form onSubmit={submit} className="w-full max-w-lg bg-white rounded-lg shadow-xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-xl font-bold text-navy-800">Add Volume</h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600">
            ✕
          </button>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <label className="block col-span-1">
            <span className="block text-sm font-medium text-gray-700 mb-1">
              # <span className="text-red-500">*</span>
            </span>
            <input
              type="number"
              min={1}
              value={volumeNumber}
              onChange={(e) => setVolumeNumber(parseInt(e.target.value, 10))}
              required
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 outline-none"
            />
          </label>
          <label className="block col-span-2">
            <span className="block text-sm font-medium text-gray-700 mb-1">
              Format
            </span>
            <select
              value={volumeFormat}
              onChange={(e) => setVolumeFormat(e.target.value as 'dsip_standard' | 'l_and_m' | 'custom')}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 outline-none"
            >
              <option value="dsip_standard">DSIP Standard</option>
              <option value="l_and_m">L&amp;M (RFP Style)</option>
              <option value="custom">Custom</option>
            </select>
          </label>
        </div>
        <label className="block">
          <span className="block text-sm font-medium text-gray-700 mb-1">
            Volume Name <span className="text-red-500">*</span>
          </span>
          <Autocomplete
            value={volumeName}
            onChange={setVolumeName}
            suggestions={[
              'Cover Sheet',
              'Technical Volume',
              'Cost Volume',
              'Commercialization Plan',
              'Supporting Documents',
              'Executive Summary',
              'Past Performance',
            ]}
            placeholder="Technical Volume"
            required
          />
        </label>
        <label className="block">
          <span className="block text-sm font-medium text-gray-700 mb-1">Description</span>
          <textarea
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 outline-none"
          />
        </label>
        <label className="block">
          <span className="block text-sm font-medium text-gray-700 mb-1">
            Special Requirements (comma-separated)
          </span>
          <input
            value={specialRequirementsText}
            onChange={(e) => setSpecialRequirementsText(e.target.value)}
            placeholder="foreign_ownership_disclosure, itar_cert, focus_area_alignment"
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 outline-none"
          />
        </label>
        <label className="block">
          <span className="block text-sm font-medium text-gray-700 mb-1">
            Applies to Phase (comma-separated; blank = all phases)
          </span>
          <input
            value={appliesToPhaseText}
            onChange={(e) => setAppliesToPhaseText(e.target.value)}
            placeholder="sbir_phase_1, sbir_phase_2"
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 outline-none"
          />
        </label>
        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">{error}</div>
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
            disabled={loading || !volumeName.trim()}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded"
          >
            {loading ? 'Adding...' : 'Add Volume'}
          </button>
        </div>
      </form>
    </div>
  );
}

function AddEditItemModal({
  mode,
  volumeId,
  item,
  nextNumber,
  onClose,
  onSaved,
}: {
  mode: 'add' | 'edit';
  volumeId: string;
  item?: RequiredItem;
  nextNumber: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { invoke, loading, error } = useTool();
  const [itemNumber, setItemNumber] = useState(item?.itemNumber ?? nextNumber);
  const [itemName, setItemName] = useState(item?.itemName ?? '');
  const [itemType, setItemType] = useState<string>(item?.itemType ?? 'word_doc');
  const [required, setRequired] = useState(item?.required ?? true);
  const [pageLimit, setPageLimit] = useState<string>(item?.pageLimit?.toString() ?? '');
  const [slideLimit, setSlideLimit] = useState<string>(item?.slideLimit?.toString() ?? '');
  const [fontFamily, setFontFamily] = useState(item?.fontFamily ?? '');
  const [fontSize, setFontSize] = useState(item?.fontSize ?? '');
  const [margins, setMargins] = useState(item?.margins ?? '');
  const [lineSpacing, setLineSpacing] = useState(item?.lineSpacing ?? '');
  const [headerFormat, setHeaderFormat] = useState(item?.headerFormat ?? '');
  const [footerFormat, setFooterFormat] = useState(item?.footerFormat ?? '');
  const [appliesToPhaseText, setAppliesToPhaseText] = useState(item?.appliesToPhase?.join(', ') ?? '');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const toNumber = (s: string) => (s.trim() ? parseInt(s, 10) : undefined);
    const phases = appliesToPhaseText.split(',').map((s) => s.trim()).filter(Boolean);
    try {
      if (mode === 'add') {
        await invoke('volume.add_required_item', {
          volumeId,
          itemNumber,
          itemName: itemName.trim(),
          itemType,
          required,
          pageLimit: toNumber(pageLimit),
          slideLimit: toNumber(slideLimit),
          fontFamily: fontFamily.trim() || undefined,
          fontSize: fontSize.trim() || undefined,
          margins: margins.trim() || undefined,
          lineSpacing: lineSpacing.trim() || undefined,
          headerFormat: headerFormat.trim() || undefined,
          footerFormat: footerFormat.trim() || undefined,
          appliesToPhase: phases.length ? phases : undefined,
        });
      } else if (item) {
        await invoke('volume.update_required_item', {
          itemId: item.id,
          itemName: itemName.trim(),
          required,
          pageLimit: toNumber(pageLimit) ?? null,
          slideLimit: toNumber(slideLimit) ?? null,
          fontFamily: fontFamily.trim() || null,
          fontSize: fontSize.trim() || null,
          margins: margins.trim() || null,
          lineSpacing: lineSpacing.trim() || null,
          headerFormat: headerFormat.trim() || null,
          footerFormat: footerFormat.trim() || null,
          appliesToPhase: phases.length ? phases : null,
        });
      }
      onSaved();
    } catch {
      /* surfaced via useTool */
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <form onSubmit={submit} className="w-full max-w-2xl bg-white rounded-lg shadow-xl p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-xl font-bold text-navy-800">
            {mode === 'add' ? 'Add Required Item' : 'Edit Required Item'}
          </h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600">
            ✕
          </button>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <label className="block col-span-1">
            <span className="block text-xs font-medium text-gray-700 mb-1">
              # <span className="text-red-500">*</span>
            </span>
            <input
              type="number"
              min={1}
              value={itemNumber}
              onChange={(e) => setItemNumber(parseInt(e.target.value, 10))}
              required
              className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 outline-none"
            />
          </label>
          <label className="block col-span-2">
            <span className="block text-xs font-medium text-gray-700 mb-1">Type</span>
            <select
              value={itemType}
              onChange={(e) => setItemType(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 outline-none"
            >
              <option value="word_doc">Word Doc</option>
              <option value="slide_deck">Slide Deck</option>
              <option value="spreadsheet">Spreadsheet</option>
              <option value="pdf">PDF</option>
              <option value="text">Plain Text</option>
              <option value="form_sf424">Form SF-424</option>
              <option value="form_sbir_certs">Form SBIR Certs</option>
              <option value="form_other">Form Other</option>
              <option value="other">Other</option>
            </select>
          </label>
        </div>

        <label className="block">
          <span className="block text-xs font-medium text-gray-700 mb-1">
            Item Name <span className="text-red-500">*</span>
          </span>
          <Autocomplete
            value={itemName}
            onChange={setItemName}
            suggestions={[
              'Technical Approach', 'Cost Volume', 'Commercialization Plan',
              'Executive Summary', 'Past Performance', 'Cover Sheet',
              'Abstract', 'Budget Justification', 'Biographical Sketch',
              'Letter of Intent', 'SF-424 Application',
            ]}
            placeholder="Technical Approach Narrative"
            required
          />
        </label>

        <label className="flex items-center gap-2 text-xs text-gray-700">
          <input
            type="checkbox"
            checked={required}
            onChange={(e) => setRequired(e.target.checked)}
          />
          Required (unchecked = optional)
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="block text-xs font-medium text-gray-700 mb-1">Page Limit</span>
            <input
              type="number"
              min={0}
              value={pageLimit}
              onChange={(e) => setPageLimit(e.target.value)}
              placeholder="15"
              className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 outline-none"
            />
          </label>
          <label className="block">
            <span className="block text-xs font-medium text-gray-700 mb-1">Slide Limit</span>
            <input
              type="number"
              min={0}
              value={slideLimit}
              onChange={(e) => setSlideLimit(e.target.value)}
              placeholder="25"
              className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 outline-none"
            />
          </label>
          <label className="block">
            <span className="block text-xs font-medium text-gray-700 mb-1">Font Family</span>
            <Autocomplete
              value={fontFamily}
              onChange={setFontFamily}
              suggestions={['Times New Roman', 'Arial', 'Calibri', 'Cambria', 'Helvetica']}
              placeholder="Times New Roman"
            />
          </label>
          <label className="block">
            <span className="block text-xs font-medium text-gray-700 mb-1">Font Size</span>
            <Autocomplete
              value={fontSize}
              onChange={setFontSize}
              suggestions={['10', '10.5', '11', '12']}
              placeholder="10"
            />
          </label>
          <label className="block">
            <span className="block text-xs font-medium text-gray-700 mb-1">Margins</span>
            <Autocomplete
              value={margins}
              onChange={setMargins}
              suggestions={['1 inch', '1 inch all sides', '0.75 inch', '0.5 inch']}
              placeholder="1 inch all sides"
            />
          </label>
          <label className="block">
            <span className="block text-xs font-medium text-gray-700 mb-1">Line Spacing</span>
            <Autocomplete
              value={lineSpacing}
              onChange={setLineSpacing}
              suggestions={['single', '1.15', '1.5', 'double']}
              placeholder="single"
            />
          </label>
          <label className="block col-span-2">
            <span className="block text-xs font-medium text-gray-700 mb-1">Header Format</span>
            <input
              value={headerFormat}
              onChange={(e) => setHeaderFormat(e.target.value)}
              placeholder="{topic_number} - {company_name}"
              className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 outline-none"
            />
          </label>
          <label className="block col-span-2">
            <span className="block text-xs font-medium text-gray-700 mb-1">Footer Format</span>
            <input
              value={footerFormat}
              onChange={(e) => setFooterFormat(e.target.value)}
              placeholder="{company_name} | Page {n} of {total}"
              className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 outline-none"
            />
          </label>
          <label className="block col-span-2">
            <span className="block text-xs font-medium text-gray-700 mb-1">
              Applies to Phase (comma-separated; blank = all phases)
            </span>
            <input
              value={appliesToPhaseText}
              onChange={(e) => setAppliesToPhaseText(e.target.value)}
              placeholder="sbir_phase_1"
              className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 outline-none"
            />
          </label>
        </div>

        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">{error}</div>
        )}

        <div className="flex items-center justify-end gap-3 pt-2 border-t border-gray-100">
          <button type="button" onClick={onClose} className="text-sm text-gray-600 hover:text-gray-800">
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading || !itemName.trim()}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded"
          >
            {loading ? 'Saving...' : mode === 'add' ? 'Add Item' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  );
}

// ─── AISuggestionsPanel ────────────────────────────────────────────

interface AIMatch {
  variable_name: string;
  value: unknown;
  source_excerpt?: string;
  page?: number | null;
  confidence?: number;
  _section?: string;
}

function AISuggestionsPanel({
  solicitationId,
  matches,
  verifiedVariables,
  onAccepted,
}: {
  solicitationId: string;
  matches: AIMatch[];
  verifiedVariables: string[];
  onAccepted: () => void;
}) {
  const { invoke, loading, error } = useTool();
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [accepted, setAccepted] = useState<Set<string>>(new Set(verifiedVariables));

  // Dedupe by variable_name — show best confidence per var.
  const pending = new Map<string, AIMatch>();
  for (const m of matches) {
    const name = m.variable_name;
    if (!name || accepted.has(name) || dismissed.has(name)) continue;
    const existing = pending.get(name);
    if (!existing || (m.confidence ?? 0) > (existing.confidence ?? 0)) {
      pending.set(name, m);
    }
  }
  const pendingList = Array.from(pending.values());

  async function accept(match: AIMatch) {
    try {
      await invoke('compliance.save_variable_value', {
        solicitationId,
        variableName: match.variable_name,
        value: match.value,
        sourceExcerpt: match.source_excerpt,
      });
      setAccepted((prev) => new Set(prev).add(match.variable_name));
      onAccepted();
    } catch {
      /* surfaced via useTool */
    }
  }

  function reject(name: string) {
    setDismissed((prev) => new Set(prev).add(name));
  }

  if (pendingList.length === 0) return null;

  return (
    <div className="border border-yellow-200 bg-yellow-50 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-lg font-semibold text-yellow-900">
            AI Compliance Suggestions
          </h2>
          <p className="text-xs text-yellow-800 mt-0.5">
            {pendingList.length} value{pendingList.length !== 1 ? 's' : ''} proposed by the AI &mdash; review and accept
          </p>
        </div>
      </div>
      {error && (
        <div className="mb-2 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
          {error}
        </div>
      )}
      <div className="space-y-2">
        {pendingList.map((m) => (
          <div key={m.variable_name} className="bg-white rounded border border-yellow-200 p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-gray-600">{m.variable_name}</span>
                  {typeof m.confidence === 'number' && (
                    <span
                      className={`text-xs px-1.5 py-0.5 rounded ${
                        m.confidence >= 0.9
                          ? 'bg-green-100 text-green-800'
                          : m.confidence >= 0.7
                          ? 'bg-yellow-100 text-yellow-800'
                          : 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {Math.round(m.confidence * 100)}% conf
                    </span>
                  )}
                </div>
                <div className="mt-1 text-sm font-semibold text-gray-900">
                  {String(m.value)}
                </div>
                {m.source_excerpt && (
                  <div className="mt-1 text-xs text-gray-500 italic">
                    &ldquo;{m.source_excerpt.slice(0, 200)}&rdquo;
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => accept(m)}
                  disabled={loading}
                  className="px-2.5 py-1 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-xs font-medium rounded"
                >
                  Accept
                </button>
                <button
                  onClick={() => reject(m.variable_name)}
                  className="px-2.5 py-1 bg-gray-200 hover:bg-gray-300 text-gray-700 text-xs rounded"
                >
                  Skip
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
