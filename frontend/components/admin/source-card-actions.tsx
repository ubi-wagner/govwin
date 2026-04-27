'use client';

import { useCallback, useRef, useState } from 'react';

// ── Types ────────────────────────────────────────────────────────────

export interface SourceProfile {
  id: string;
  name: string;
  siteType: string;
  baseUrl: string;
  bookmarkUrl: string | null;
  agency: string | null;
  programType: string | null;
  adminNotes: string | null;
  visitInstructions: string | null;
  topicUrlPattern: string | null;
  pdfUrlPattern: string | null;
  isActive: boolean;
  lastVisitedAt: string | null;
  lastVisitedBy: string | null;
  createdAt: string;
  updatedAt: string;
  visitCount: string | number;
  lastActivity: string | null;
}

export interface SourceVisit {
  id: string;
  profileId: string;
  visitedBy: string | null;
  action: string;
  url: string | null;
  notes: string | null;
  filesCount: number;
  topicsCount: number;
  metadata: Record<string, unknown>;
  createdAt: string;
  sourceName: string;
}

// ── Helpers ──────────────────────────────────────────────────────────

const SITE_TYPE_COLORS: Record<string, string> = {
  dsip: 'bg-indigo-100 text-indigo-800',
  afwerx: 'bg-blue-100 text-blue-800',
  xtech: 'bg-green-100 text-green-800',
  nsf: 'bg-amber-100 text-amber-800',
  sam_gov: 'bg-gray-100 text-gray-800',
  sbir_gov: 'bg-purple-100 text-purple-800',
  grants_gov: 'bg-teal-100 text-teal-800',
  custom: 'bg-slate-100 text-slate-800',
};

const ACTION_COLORS: Record<string, string> = {
  visit: 'bg-blue-100 text-blue-700',
  download: 'bg-green-100 text-green-700',
  upload: 'bg-purple-100 text-purple-700',
  paste_topics: 'bg-amber-100 text-amber-700',
  import_topics: 'bg-indigo-100 text-indigo-700',
  shred: 'bg-red-100 text-red-700',
  note: 'bg-gray-100 text-gray-700',
};

function formatDate(iso: string | null): string {
  if (!iso) return 'Never';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatRelative(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return formatDate(iso);
}

// ── Paste Topics Modal ──────────────────────────────────────────────

interface PasteModalProps {
  profileId: string;
  sourceName: string;
  onClose: () => void;
  onImported: () => void;
}

function PasteTopicsModal({ profileId, sourceName, onClose, onImported }: PasteModalProps) {
  const [raw, setRaw] = useState('');
  const [parsed, setParsed] = useState<string[][] | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<string | null>(null);

  const detectAndParse = useCallback(() => {
    setError(null);
    setParsed(null);
    const trimmed = raw.trim();
    if (!trimmed) {
      setError('Please paste some data first.');
      return;
    }

    const lines = trimmed.split('\n').filter((l) => l.trim());
    if (lines.length < 2) {
      setError('Need at least a header row and one data row.');
      return;
    }

    // Detect delimiter: tab > pipe > comma
    let delimiter = '\t';
    const firstLine = lines[0];
    if (firstLine.includes('\t')) {
      delimiter = '\t';
    } else if (firstLine.includes('|')) {
      delimiter = '|';
    } else if (firstLine.includes(',')) {
      delimiter = ',';
    }

    const rows = lines.map((line) =>
      line.split(delimiter).map((cell) => cell.trim()),
    );

    const headerRow = rows[0];
    const dataRows = rows.slice(1);

    setHeaders(headerRow);
    setParsed(dataRows);
  }, [raw]);

  const handleImport = useCallback(async () => {
    if (!parsed || parsed.length === 0) return;
    setImporting(true);
    setError(null);

    try {
      // Log the paste event
      await fetch('/api/admin/sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profileId,
          action: 'paste_topics',
          notes: `Pasted ${parsed.length} rows from ${sourceName}`,
          topicsCount: parsed.length,
        }),
      });

      // Call the extract-topics endpoint with the raw pasted data
      const res = await fetch('/api/admin/extract-topics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rawText: raw,
          source: sourceName,
          sourceProfileId: profileId,
          headers,
          rows: parsed,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Import failed (HTTP ${res.status})`);
      }

      const result = await res.json();
      const count = result.data?.topics?.length ?? parsed.length;
      setImportResult(`Successfully imported ${count} topics from ${sourceName}.`);
      onImported();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  }, [parsed, raw, headers, profileId, sourceName, onImported]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[85vh] flex flex-col mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div>
            <h2 className="text-lg font-semibold">Paste Topics</h2>
            <p className="text-sm text-gray-500">Source: {sourceName}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto px-6 py-4 space-y-4">
          <textarea
            className="w-full h-40 border rounded-lg p-3 font-mono text-sm resize-y focus:outline-none focus:ring-2 focus:ring-indigo-300"
            placeholder="Copy a topic table from DSIP, AFWERX, or any source site and paste here. Accepts tab-separated, pipe-separated, or comma-separated data."
            value={raw}
            onChange={(e) => {
              setRaw(e.target.value);
              setParsed(null);
              setImportResult(null);
            }}
          />

          <div className="flex gap-2">
            <button
              onClick={detectAndParse}
              disabled={!raw.trim()}
              className="px-4 py-2 bg-gray-800 text-white rounded-lg text-sm font-medium hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Parse Preview
            </button>
            {parsed && parsed.length > 0 && (
              <button
                onClick={handleImport}
                disabled={importing}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {importing ? 'Importing...' : `Import ${parsed.length} Topics`}
              </button>
            )}
          </div>

          {error && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-2">{error}</div>
          )}

          {importResult && (
            <div className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-4 py-2">{importResult}</div>
          )}

          {/* Preview table */}
          {parsed && parsed.length > 0 && (
            <div className="border rounded-lg overflow-auto max-h-64">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    {headers.map((h, i) => (
                      <th key={i} className="px-3 py-2 text-left font-medium text-gray-600 whitespace-nowrap">
                        {h || `Col ${i + 1}`}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {parsed.slice(0, 20).map((row, ri) => (
                    <tr key={ri} className={ri % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                      {headers.map((_, ci) => (
                        <td key={ci} className="px-3 py-1.5 text-gray-700 whitespace-nowrap max-w-xs truncate">
                          {row[ci] ?? ''}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {parsed.length > 20 && (
                <div className="px-3 py-2 text-xs text-gray-500 bg-gray-50 border-t">
                  Showing 20 of {parsed.length} rows
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Source Card ──────────────────────────────────────────────────────

interface SourceCardProps {
  source: SourceProfile;
  onRefresh: () => void;
}

function SourceCard({ source, onRefresh }: SourceCardProps) {
  const [showNotes, setShowNotes] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);
  const [showPasteModal, setShowPasteModal] = useState(false);
  const [showNoteInput, setShowNoteInput] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const logVisit = useCallback(
    async (action: string, extra?: { url?: string; notes?: string; filesCount?: number; topicsCount?: number }) => {
      try {
        await fetch(`/api/admin/sources/${source.id}/visit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, ...extra }),
        });
      } catch {
        // Non-critical: best-effort logging
      }
    },
    [source.id],
  );

  const openSite = useCallback(async () => {
    const url = source.bookmarkUrl || source.baseUrl;
    await logVisit('visit', { url });
    window.open(url, '_blank');
    onRefresh();
  }, [source, onRefresh, logVisit]);

  const saveNote = useCallback(async () => {
    if (!noteText.trim()) return;
    setSavingNote(true);
    try {
      const res = await fetch('/api/admin/sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profileId: source.id,
          action: 'note',
          notes: noteText.trim(),
        }),
      });
      if (res.ok) {
        setNoteText('');
        setShowNoteInput(false);
        onRefresh();
      }
    } catch {
      // Fail silently for note save
    } finally {
      setSavingNote(false);
    }
  }, [noteText, source.id, onRefresh]);

  const handleFileUpload = useCallback(
    async (files: FileList | File[]) => {
      if (!files || files.length === 0) return;
      setUploading(true);

      try {
        // Log the upload event
        await fetch('/api/admin/sources', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            profileId: source.id,
            action: 'upload',
            notes: `Uploading ${files.length} file(s)`,
            filesCount: files.length,
          }),
        });

        // Upload via the RFP upload route
        const formData = new FormData();
        formData.append('title', `Upload from ${source.name}`);
        formData.append('agency', source.agency || 'Unknown');
        formData.append('programType', source.programType || 'other');

        for (const file of Array.from(files)) {
          formData.append('files[]', file);
        }

        const res = await fetch('/api/admin/rfp-upload', {
          method: 'POST',
          body: formData,
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `Upload failed (HTTP ${res.status})`);
        }

        onRefresh();
      } catch (err) {
        console.error('[source-card] upload failed:', err);
      } finally {
        setUploading(false);
      }
    },
    [source, onRefresh],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      handleFileUpload(e.dataTransfer.files);
    },
    [handleFileUpload],
  );

  const badgeColor = SITE_TYPE_COLORS[source.siteType] ?? SITE_TYPE_COLORS.custom;

  return (
    <>
      <div className="bg-white rounded-lg border shadow-sm p-5 space-y-3">
        {/* Header row */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold text-gray-900 text-base">{source.name}</h3>
              <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${badgeColor}`}>
                {source.siteType.replace('_', ' ')}
              </span>
            </div>
            {(source.agency || source.programType) && (
              <p className="text-sm text-gray-500 mt-0.5">
                {[source.agency, source.programType?.toUpperCase()].filter(Boolean).join(' · ')}
              </p>
            )}
          </div>
          <div className="text-right text-xs text-gray-400 shrink-0">
            <div>{Number(source.visitCount)} visits</div>
            <div>{formatDate(source.lastActivity)}</div>
          </div>
        </div>

        {/* Base URL */}
        <a
          href={source.baseUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="block text-sm font-mono text-blue-600 hover:text-blue-800 truncate"
        >
          {source.baseUrl}
        </a>

        {/* Expandable: Admin Notes */}
        {source.adminNotes && (
          <div>
            <button
              onClick={() => setShowNotes(!showNotes)}
              className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1"
            >
              <span className={`transform transition-transform ${showNotes ? 'rotate-90' : ''}`}>{'▶'}</span>
              Admin Notes
            </button>
            {showNotes && (
              <div className="mt-1 text-sm text-gray-600 bg-gray-50 rounded p-3 whitespace-pre-wrap">
                {source.adminNotes}
              </div>
            )}
          </div>
        )}

        {/* Expandable: Visit Instructions */}
        {source.visitInstructions && (
          <div>
            <button
              onClick={() => setShowInstructions(!showInstructions)}
              className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1"
            >
              <span className={`transform transition-transform ${showInstructions ? 'rotate-90' : ''}`}>{'▶'}</span>
              Visit Instructions
            </button>
            {showInstructions && (
              <ol className="mt-1 text-sm text-gray-600 bg-gray-50 rounded p-3 pl-6 list-decimal space-y-1">
                {source.visitInstructions.split('\n').map((step, i) => {
                  const cleaned = step.replace(/^\d+\.\s*/, '').trim();
                  return cleaned ? <li key={i}>{cleaned}</li> : null;
                })}
              </ol>
            )}
          </div>
        )}

        {/* Action buttons */}
        <div className="flex flex-wrap gap-2 pt-1">
          <button
            onClick={openSite}
            className="px-3 py-1.5 bg-indigo-600 text-white rounded text-sm font-medium hover:bg-indigo-500"
          >
            Open Site
          </button>
          <button
            onClick={() => setShowPasteModal(true)}
            className="px-3 py-1.5 bg-amber-600 text-white rounded text-sm font-medium hover:bg-amber-500"
          >
            Paste Topics
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="px-3 py-1.5 bg-purple-600 text-white rounded text-sm font-medium hover:bg-purple-500 disabled:opacity-50"
          >
            {uploading ? 'Uploading...' : 'Upload PDFs'}
          </button>
          <button
            onClick={() => setShowNoteInput(!showNoteInput)}
            className="px-3 py-1.5 bg-gray-600 text-white rounded text-sm font-medium hover:bg-gray-500"
          >
            Add Note
          </button>
        </div>

        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.docx,.doc,.xlsx,.xls,.pptx,.ppt,.txt"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) handleFileUpload(e.target.files);
            e.target.value = '';
          }}
        />

        {/* Drag-drop zone (shown when Upload PDFs is intent) */}
        <div
          className={`border-2 border-dashed rounded-lg p-4 text-center text-sm transition-colors ${
            dragOver ? 'border-purple-400 bg-purple-50' : 'border-gray-200 bg-gray-50'
          }`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
        >
          <p className="text-gray-500">
            {uploading
              ? 'Uploading files...'
              : 'Drop PDF files here to upload'}
          </p>
        </div>

        {/* Note input */}
        {showNoteInput && (
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Type a note about this source..."
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveNote();
              }}
              className="flex-1 border rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
            />
            <button
              onClick={saveNote}
              disabled={savingNote || !noteText.trim()}
              className="px-3 py-1.5 bg-gray-800 text-white rounded text-sm font-medium hover:bg-gray-700 disabled:opacity-50"
            >
              {savingNote ? 'Saving...' : 'Save'}
            </button>
          </div>
        )}
      </div>

      {/* Paste Topics Modal */}
      {showPasteModal && (
        <PasteTopicsModal
          profileId={source.id}
          sourceName={source.name}
          onClose={() => setShowPasteModal(false)}
          onImported={() => {
            setShowPasteModal(false);
            onRefresh();
          }}
        />
      )}
    </>
  );
}

// ── Activity Timeline ───────────────────────────────────────────────

interface ActivityTimelineProps {
  visits: SourceVisit[];
}

function ActivityTimeline({ visits }: ActivityTimelineProps) {
  if (visits.length === 0) {
    return (
      <div className="text-sm text-gray-500 py-4 text-center">
        No recent activity recorded.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {visits.map((v) => {
        const actionColor = ACTION_COLORS[v.action] ?? ACTION_COLORS.note;
        return (
          <div key={v.id} className="flex items-start gap-3 py-2 border-b border-gray-100 last:border-0">
            <div className="text-xs text-gray-400 w-24 shrink-0 pt-0.5">
              {formatRelative(v.createdAt)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium text-gray-800">{v.sourceName}</span>
                <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${actionColor}`}>
                  {v.action.replace('_', ' ')}
                </span>
                {v.filesCount > 0 && (
                  <span className="text-xs text-gray-500">{v.filesCount} file(s)</span>
                )}
                {v.topicsCount > 0 && (
                  <span className="text-xs text-gray-500">{v.topicsCount} topic(s)</span>
                )}
              </div>
              {v.notes && <p className="text-sm text-gray-500 mt-0.5 truncate">{v.notes}</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Main Exported Component ─────────────────────────────────────────

interface SourcesHubProps {
  initialProfiles: SourceProfile[];
  initialActivity: SourceVisit[];
}

export default function SourcesHub({ initialProfiles, initialActivity }: SourcesHubProps) {
  const [profiles, setProfiles] = useState<SourceProfile[]>(initialProfiles);
  const [activity, setActivity] = useState<SourceVisit[]>(initialActivity);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch('/api/admin/sources');
      if (res.ok) {
        const json = await res.json();
        setProfiles(json.data.profiles);
        setActivity(json.data.recentActivity);
      }
    } catch {
      // Fail silently — data stays as-is
    } finally {
      setRefreshing(false);
    }
  }, []);

  return (
    <div className="space-y-8">
      {/* Source Cards */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-800">
            Active Sources ({profiles.length})
          </h2>
          <button
            onClick={refresh}
            disabled={refreshing}
            className="text-sm text-indigo-600 hover:text-indigo-800 disabled:opacity-50"
          >
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {profiles.map((source) => (
            <SourceCard key={source.id} source={source} onRefresh={refresh} />
          ))}
        </div>
        {profiles.length === 0 && (
          <div className="text-center text-gray-500 py-8">
            No active source profiles found. Add source profiles to the database to get started.
          </div>
        )}
      </div>

      {/* Recent Activity */}
      <div>
        <h2 className="text-lg font-semibold text-gray-800 mb-3">Recent Activity</h2>
        <div className="bg-white rounded-lg border shadow-sm p-4">
          <ActivityTimeline visits={activity} />
        </div>
      </div>
    </div>
  );
}
