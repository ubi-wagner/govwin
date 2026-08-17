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
  autoCrawlEnabled: boolean;
  crawlCron: string | null;
  lastCrawlAt: string | null;
}

export interface SourceDiff {
  id: string;
  profileId: string;
  summary: string | null;
  severity: string;
  isMeaningful: boolean;
  createdAt: string;
  sourceName: string;
  regionName: string | null;
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

function formatCron(cron: string | null): string {
  if (!cron) return 'daily';
  // Simple cron-to-human for the common patterns we use
  const parts = cron.split(' ');
  if (parts.length < 5) return cron;
  const [min, hour, , , dow] = parts;
  const timeStr = `${hour.padStart(2, '0')}:${min.padStart(2, '0')} UTC`;
  if (dow === '*') return `daily at ${timeStr}`;
  const dayNames: Record<string, string> = { '0': 'Sun', '1': 'Mon', '2': 'Tue', '3': 'Wed', '4': 'Thu', '5': 'Fri', '6': 'Sat' };
  return `${dayNames[dow] ?? dow} at ${timeStr}`;
}

const SEVERITY_COLORS: Record<string, string> = {
  info: 'bg-gray-100 text-gray-700',
  low: 'bg-blue-100 text-blue-700',
  medium: 'bg-yellow-100 text-yellow-800',
  high: 'bg-orange-100 text-orange-700',
  critical: 'bg-red-100 text-red-700',
};

// ── Source Card ──────────────────────────────────────────────────────

interface SourceCardProps {
  source: SourceProfile;
  onRefresh: () => void;
}

function SourceCard({ source, onRefresh }: SourceCardProps) {
  const [showNotes, setShowNotes] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);
  const [showNoteInput, setShowNoteInput] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [scouting, setScouting] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleScoutNow = useCallback(async () => {
    setScouting(true);
    try {
      const res = await fetch(`/api/admin/sources/${source.id}/scout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        console.error('[source-card] scout failed:', body.error);
      }
      onRefresh();
    } catch (err) {
      console.error('[source-card] scout failed:', err);
    } finally {
      setScouting(false);
    }
  }, [source.id, onRefresh]);

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
      await logVisit('note', { notes: noteText.trim() });
      setNoteText('');
      setShowNoteInput(false);
      onRefresh();
    } catch {
      // Fail silently for note save
    } finally {
      setSavingNote(false);
    }
  }, [noteText, logVisit, onRefresh]);

  const handleFileUpload = useCallback(
    async (files: FileList | File[]) => {
      if (!files || files.length === 0) return;
      setUploading(true);

      try {
        // Log the upload event
        await logVisit('upload', {
          notes: `Uploading ${files.length} file(s)`,
          filesCount: files.length,
        });

        // Upload via the RFP upload route
        const formData = new FormData();
        formData.append('title', `Upload from ${source.name}`);
        formData.append('agency', source.agency || 'Unknown');
        formData.append('programType', source.programType || 'other');

        // Route collects files via formData.getAll('files') — the key MUST be
        // 'files' (not 'files[]'), or getAll returns [] and the upload 422s.
        for (const file of Array.from(files)) {
          formData.append('files', file);
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
    [source, onRefresh, logVisit],
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

        {/* Crawl status indicator */}
        <div className="flex items-center gap-3 text-xs">
          {source.autoCrawlEnabled ? (
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-2 h-2 rounded-full bg-green-500" />
              <span className="text-gray-600">Auto-crawl: {formatCron(source.crawlCron)}</span>
            </span>
          ) : (
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-2 h-2 rounded-full bg-gray-400" />
              <span className="text-gray-500">Manual only</span>
            </span>
          )}
          <span className="text-gray-400">
            Last crawl: {source.lastCrawlAt ? formatRelative(source.lastCrawlAt) : 'never'}
          </span>
        </div>

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
          {/* "Paste Topics" retired: pasted rows have no solicitation to attach to (topics
              belong to an ingested solicitation), so the flow could never succeed. Use
              "Upload PDFs" → the solicitation ingest, or +Add Topic on a solicitation. */}
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
          <button
            onClick={handleScoutNow}
            disabled={scouting}
            className="px-3 py-1.5 bg-teal-600 text-white rounded text-sm font-medium hover:bg-teal-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {scouting ? 'Scouting...' : 'Scout Now'}
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

// ── Recent Changes Feed ─────────────────────────────────────────────

interface RecentChangesFeedProps {
  diffs: SourceDiff[];
}

function RecentChangesFeed({ diffs }: RecentChangesFeedProps) {
  if (diffs.length === 0) {
    return (
      <div className="text-sm text-gray-500 py-4 text-center">
        No meaningful changes detected yet.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {diffs.map((d) => {
        const severityColor = SEVERITY_COLORS[d.severity] ?? SEVERITY_COLORS.info;
        return (
          <div key={d.id} className="flex items-start gap-3 py-2 border-b border-gray-100 last:border-0">
            <div className="text-xs text-gray-400 w-24 shrink-0 pt-0.5">
              {formatRelative(d.createdAt)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <a
                  href={`/admin/sources/${d.profileId}`}
                  className="text-sm font-medium text-gray-800 hover:text-indigo-600"
                >
                  {d.sourceName}
                </a>
                {d.regionName && (
                  <span className="text-xs text-gray-500">{d.regionName}</span>
                )}
                <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${severityColor}`}>
                  {d.severity}
                </span>
              </div>
              {d.summary && <p className="text-sm text-gray-500 mt-0.5 truncate">{d.summary}</p>}
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
  initialDiffs?: SourceDiff[];
}

export default function SourcesHub({ initialProfiles, initialActivity, initialDiffs }: SourcesHubProps) {
  const [profiles, setProfiles] = useState<SourceProfile[]>(initialProfiles);
  const [activity, setActivity] = useState<SourceVisit[]>(initialActivity);
  const [diffs, setDiffs] = useState<SourceDiff[]>(initialDiffs ?? []);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch('/api/admin/sources');
      if (res.ok) {
        const json = await res.json();
        setProfiles(json.data.sources);
        setActivity(json.data.recentActivity);
        if (json.data.recentDiffs) {
          setDiffs(json.data.recentDiffs);
        }
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

      {/* Recent Changes */}
      <div>
        <h2 className="text-lg font-semibold text-gray-800 mb-3">Recent Changes</h2>
        <div className="bg-white rounded-lg border shadow-sm p-4">
          <RecentChangesFeed diffs={diffs} />
        </div>
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
