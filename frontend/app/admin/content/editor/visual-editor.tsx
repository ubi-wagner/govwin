'use client';

import React, { useState, useCallback, useEffect, useRef } from 'react';
import MetadataEditor from '@/components/admin/metadata-editor';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Block {
  id: string;
  slug: string;
  title: string;
  contentType: string;
  body: string;
  excerpt: string | null;
  author: string | null;
  tags: string[];
  published: boolean;
  status: string;
  publishedAt: string | null;
  featuredImage: string | null;
  externalUrl: string | null;
  displayOrder: number;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

interface VersionSnapshot {
  version: number;
  savedAt: string;
  savedBy: string;
  title: string;
  body: string;
  excerpt: string | null;
  featuredImage: string | null;
  displayOrder: number;
  metadata: Record<string, unknown>;
}

interface VisualEditorProps {
  pages: string[];
}

// Draft tracking: local edits that haven't been saved yet
interface LocalEdit {
  title?: string;
  body?: string;
  excerpt?: string | null;
  featuredImage?: string | null;
  displayOrder?: number;
  metadata?: Record<string, unknown>;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const PAGE_LABELS: Record<string, string> = {
  homepage: 'Homepage',
  about: 'About',
  features: 'Features',
  value: 'Value',
  pricing: 'Pricing',
  'how-it-works': 'How It Works',
  engine: 'Engine',
  'the-expert': 'The Expert',
  security: 'Security',
  infosec: 'InfoSec',
  apply: 'Apply',
  'get-started': 'Get Started',
  resources: 'Resources',
};

const PAGE_TO_PATH: Record<string, string> = {
  homepage: '/',
  about: '/about',
  features: '/features',
  value: '/value',
  pricing: '/pricing',
  'how-it-works': '/how-it-works',
  engine: '/engine',
  'the-expert': '/the-expert',
  security: '/security',
  infosec: '/infosec',
  apply: '/apply',
  'get-started': '/get-started',
  resources: '/resources',
};

const SECTION_LABELS: Record<string, string> = {
  hero: 'Hero Banner',
  stats: 'Statistics',
  stages: 'Process Steps',
  'pricing-hero': 'Pricing Header',
  pricing: 'Pricing Plans',
  'expert-gate': 'Expert Gate',
  quote: 'Pull Quote',
  cta: 'Call to Action',
  pillars: 'Core Pillars',
  founder: 'Founder',
  items: 'Feature Items',
  faqs: 'FAQs',
  spotlight: 'Spotlight',
  portals: 'Portal Links',
  curation: 'Expert Curation',
  flywheel: 'Value Flywheel',
  steps: 'Steps',
  guardrails: 'Guardrails',
  form: 'Form',
};

function getSectionLabel(tag: string): string {
  return SECTION_LABELS[tag] ?? tag.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// ─── Status badge ────────────────────────────────────────────────────────────

function StatusBadge({ status, modified }: { status: string; modified?: boolean }) {
  if (modified) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800">
        Modified
      </span>
    );
  }
  const styles: Record<string, string> = {
    published: 'bg-green-100 text-green-700',
    draft: 'bg-yellow-100 text-yellow-800',
    pending: 'bg-indigo-100 text-indigo-700',
    archived: 'bg-gray-100 text-gray-600',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${styles[status] ?? 'bg-gray-100 text-gray-600'}`}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

// ─── Version history panel ───────────────────────────────────────────────────

function VersionHistoryPanel({
  blockId,
  onRevert,
  onClose,
}: {
  blockId: string;
  onRevert: () => void;
  onClose: () => void;
}) {
  const [versions, setVersions] = useState<VersionSnapshot[]>([]);
  const [currentVersion, setCurrentVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [reverting, setReverting] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/admin/content/versions?id=${blockId}`)
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        if (json.data) {
          setVersions(json.data.versions ?? []);
          setCurrentVersion(json.data.currentVersion ?? 0);
        }
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [blockId]);

  const handleRevert = async (version: number) => {
    setReverting(version);
    try {
      const res = await fetch('/api/admin/content/versions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: blockId, version }),
      });
      if (res.ok) {
        onRevert();
      }
    } catch {
      // error handled silently
    } finally {
      setReverting(null);
    }
  };

  return (
    <div className="border-t border-gray-200 mt-4 pt-4">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-semibold text-gray-700">Version History</h4>
        <button onClick={onClose} className="text-xs text-gray-500 hover:text-gray-700">
          Close
        </button>
      </div>
      {loading ? (
        <p className="text-xs text-gray-400">Loading versions...</p>
      ) : versions.length === 0 ? (
        <p className="text-xs text-gray-400">No version history yet.</p>
      ) : (
        <div className="space-y-2 max-h-60 overflow-y-auto">
          <p className="text-xs text-gray-500 mb-2">Current: v{currentVersion}</p>
          {versions.map((v: VersionSnapshot) => (
            <div
              key={v.version}
              className="flex items-center justify-between p-2 bg-gray-50 rounded border border-gray-100"
            >
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-gray-700 truncate">
                  v{v.version} — {v.title}
                </p>
                <p className="text-xs text-gray-400">
                  {new Date(v.savedAt).toLocaleString()} by {v.savedBy}
                </p>
              </div>
              <button
                onClick={() => handleRevert(v.version)}
                disabled={reverting !== null}
                className="ml-2 px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 rounded disabled:opacity-50 shrink-0"
              >
                {reverting === v.version ? 'Reverting...' : 'Revert'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Block editor (accordion item) ──────────────────────────────────────────

function BlockEditor({
  block,
  localEdit,
  onFieldChange,
  onSaveDraft,
  saving,
  onRefresh,
}: {
  block: Block;
  localEdit: LocalEdit | undefined;
  onFieldChange: (blockId: string, field: string, value: unknown) => void;
  onSaveDraft: (blockId: string) => void;
  saving: boolean;
  onRefresh: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showVersions, setShowVersions] = useState(false);
  const [aiMode, setAiMode] = useState<'idle' | 'generate' | 'revise' | 'from_url'>('idle');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiInstructions, setAiInstructions] = useState('');
  const [aiUrl, setAiUrl] = useState('');

  const isModified = localEdit !== undefined && Object.keys(localEdit).length > 0;

  // Resolved values: local edit overrides block data
  const title = localEdit?.title ?? block.title;
  const body = localEdit?.body ?? block.body;
  const excerpt = localEdit?.excerpt !== undefined ? localEdit.excerpt : block.excerpt;
  const featuredImage = localEdit?.featuredImage !== undefined ? localEdit.featuredImage : block.featuredImage;
  const displayOrder = localEdit?.displayOrder ?? block.displayOrder;
  const metadata = localEdit?.metadata ?? block.metadata;

  // Strip version tracking fields from metadata for the editor
  const { _versions: _v, _currentVersion: _cv, ...editableMetadata } = metadata;
  void _v;
  void _cv;

  const sectionTag = block.tags.find((t) => !Object.keys(PAGE_LABELS).includes(t) && t !== block.tags[0]) ?? block.tags[1] ?? 'unknown';

  const handleAi = async () => {
    setAiLoading(true);
    try {
      const payload: Record<string, string> = {
        page: block.tags[0] ?? 'homepage',
        section: sectionTag,
        instructions: aiInstructions,
      };

      if (aiMode === 'generate') {
        payload.action = 'generate';
        payload.existingTitle = title;
      } else if (aiMode === 'revise') {
        payload.action = 'revise';
        payload.title = title;
        payload.body = body;
        payload.excerpt = excerpt ?? '';
      } else if (aiMode === 'from_url') {
        payload.action = 'from_url';
        payload.url = aiUrl;
      }

      const res = await fetch('/api/admin/content/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error || 'AI request failed');
      }

      const json = await res.json() as { data: { title?: string; body?: string; excerpt?: string; metadata?: Record<string, unknown> } };
      const d = json.data;

      if (d.title) onFieldChange(block.id, 'title', d.title);
      if (d.body) onFieldChange(block.id, 'body', d.body);
      if (d.excerpt) onFieldChange(block.id, 'excerpt', d.excerpt);
      if (d.metadata && Object.keys(d.metadata).length > 0) {
        onFieldChange(block.id, 'metadata', { ...editableMetadata, ...d.metadata });
      }

      setAiMode('idle');
      setAiInstructions('');
      setAiUrl('');
    } catch (err) {
      alert(`AI error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setAiLoading(false);
    }
  };

  return (
    <div className={`border rounded-lg transition-colors ${isModified ? 'border-amber-300 bg-amber-50/30' : 'border-gray-200 bg-white'}`}>
      {/* Header */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50/50 rounded-lg"
      >
        <div className="flex items-center gap-3 min-w-0">
          <svg
            className={`w-4 h-4 text-gray-400 transition-transform shrink-0 ${expanded ? 'rotate-90' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          <div className="min-w-0">
            <p className="text-sm font-medium text-gray-900 truncate">{title}</p>
            <p className="text-xs text-gray-400 truncate">{block.slug}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <StatusBadge status={block.status} modified={isModified} />
        </div>
      </button>

      {/* Expanded editor */}
      {expanded && (
        <div className="px-4 pb-4 space-y-4 border-t border-gray-100">
          {/* Title */}
          <div className="pt-4">
            <label className="block text-xs font-medium text-gray-500 mb-1">Title</label>
            <input
              type="text"
              value={title}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => onFieldChange(block.id, 'title', e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>

          {/* Body */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Body</label>
            <textarea
              value={body}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => onFieldChange(block.id, 'body', e.target.value)}
              rows={4}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 font-mono"
            />
          </div>

          {/* Excerpt */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Excerpt / Subtitle</label>
            <input
              type="text"
              value={excerpt ?? ''}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => onFieldChange(block.id, 'excerpt', e.target.value || null)}
              className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>

          {/* Featured Image + Display Order */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Featured Image URL</label>
              <input
                type="text"
                value={featuredImage ?? ''}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => onFieldChange(block.id, 'featuredImage', e.target.value || null)}
                className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                placeholder="/images/..."
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Display Order</label>
              <input
                type="number"
                value={displayOrder}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => onFieldChange(block.id, 'displayOrder', parseInt(e.target.value, 10) || 0)}
                className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* Metadata editor */}
          <div className="border-t border-gray-100 pt-4">
            <MetadataEditor
              tags={block.tags}
              metadata={editableMetadata}
              onChange={(newMeta: Record<string, unknown>) => onFieldChange(block.id, 'metadata', newMeta)}
            />
          </div>

          {/* AI Tools */}
          <div className="border-t border-gray-100 pt-3">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-medium text-indigo-600">AI Tools:</span>
              <button
                onClick={() => setAiMode(aiMode === 'generate' ? 'idle' : 'generate')}
                className={`px-2 py-1 text-xs rounded-md ${aiMode === 'generate' ? 'bg-indigo-100 text-indigo-700 font-semibold' : 'text-gray-600 hover:bg-gray-100'}`}
              >
                Generate
              </button>
              <button
                onClick={() => setAiMode(aiMode === 'revise' ? 'idle' : 'revise')}
                disabled={!title && !body}
                className={`px-2 py-1 text-xs rounded-md disabled:opacity-40 ${aiMode === 'revise' ? 'bg-indigo-100 text-indigo-700 font-semibold' : 'text-gray-600 hover:bg-gray-100'}`}
              >
                Revise
              </button>
              <button
                onClick={() => setAiMode(aiMode === 'from_url' ? 'idle' : 'from_url')}
                className={`px-2 py-1 text-xs rounded-md ${aiMode === 'from_url' ? 'bg-indigo-100 text-indigo-700 font-semibold' : 'text-gray-600 hover:bg-gray-100'}`}
              >
                From URL
              </button>
            </div>

            {aiMode !== 'idle' && (
              <div className="bg-indigo-50 rounded-lg p-3 space-y-2">
                {aiMode === 'from_url' && (
                  <input
                    type="url"
                    placeholder="https://competitor-site.com/page"
                    value={aiUrl}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAiUrl(e.target.value)}
                    className="w-full rounded-md border border-indigo-200 px-3 py-1.5 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                  />
                )}
                <textarea
                  placeholder={
                    aiMode === 'generate' ? 'Optional: specific instructions for the AI...'
                    : aiMode === 'revise' ? 'How should it be revised? (e.g. "make it shorter", "more technical")'
                    : 'Optional: what to focus on from the source page...'
                  }
                  value={aiInstructions}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setAiInstructions(e.target.value)}
                  rows={2}
                  className="w-full rounded-md border border-indigo-200 px-3 py-1.5 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                />
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleAi}
                    disabled={aiLoading || (aiMode === 'from_url' && !aiUrl)}
                    className="px-3 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-md disabled:opacity-50"
                  >
                    {aiLoading ? 'Generating...' : aiMode === 'generate' ? 'Generate Content' : aiMode === 'revise' ? 'Revise Content' : 'Generate from URL'}
                  </button>
                  <button
                    onClick={() => { setAiMode('idle'); setAiInstructions(''); setAiUrl(''); }}
                    className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700"
                  >
                    Cancel
                  </button>
                  {aiLoading && <span className="text-xs text-indigo-500 animate-pulse">Claude is writing...</span>}
                </div>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between pt-2 border-t border-gray-100">
            <div className="flex items-center gap-2">
              <button
                onClick={() => onSaveDraft(block.id)}
                disabled={!isModified || saving}
                className="px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-md disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving ? 'Saving...' : 'Save Draft'}
              </button>
              <button
                onClick={() => setShowVersions(!showVersions)}
                className="px-3 py-1.5 text-xs font-medium text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-md"
              >
                {showVersions ? 'Hide History' : 'Version History'}
              </button>
            </div>
            <p className="text-xs text-gray-400">
              Section: {getSectionLabel(sectionTag)}
            </p>
          </div>

          {/* Version history */}
          {showVersions && (
            <VersionHistoryPanel
              blockId={block.id}
              onRevert={() => {
                setShowVersions(false);
                onRefresh();
              }}
              onClose={() => setShowVersions(false)}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main visual editor ──────────────────────────────────────────────────────

export default function VisualEditor({ pages }: VisualEditorProps) {
  const [selectedPage, setSelectedPage] = useState(pages[0] ?? 'homepage');
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [loading, setLoading] = useState(false);
  const [localEdits, setLocalEdits] = useState<Record<string, LocalEdit>>({});
  const [savingBlocks, setSavingBlocks] = useState<Set<string>>(new Set());
  const [publishing, setPublishing] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Show toast notification
  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  // Fetch blocks for the selected page
  const fetchBlocks = useCallback(async () => {
    setLoading(true);
    setLocalEdits({});
    try {
      const res = await fetch(`/api/admin/content/page-blocks?page=${selectedPage}`);
      const json = await res.json();
      if (json.data?.blocks) {
        setBlocks(json.data.blocks);
      }
    } catch {
      showToast('Failed to load blocks', 'error');
    } finally {
      setLoading(false);
    }
  }, [selectedPage, showToast]);

  useEffect(() => {
    fetchBlocks();
  }, [fetchBlocks]);

  // Refresh the iframe preview
  const refreshPreview = useCallback(() => {
    if (iframeRef.current) {
      const previewPath = PAGE_TO_PATH[selectedPage] ?? '/';
      iframeRef.current.src = `${previewPath}?_preview=1&_t=${Date.now()}`;
    }
  }, [selectedPage]);

  // Handle field changes (local only)
  const handleFieldChange = useCallback((blockId: string, field: string, value: unknown) => {
    setLocalEdits((prev: Record<string, LocalEdit>) => ({
      ...prev,
      [blockId]: {
        ...(prev[blockId] ?? {}),
        [field]: value,
      },
    }));
  }, []);

  // Save a single block draft
  const handleSaveDraft = useCallback(async (blockId: string) => {
    const edit = localEdits[blockId];
    if (!edit || Object.keys(edit).length === 0) return;

    setSavingBlocks((prev: Set<string>) => new Set([...prev, blockId]));
    try {
      const res = await fetch('/api/admin/content/page-blocks', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          updates: [{ id: blockId, ...edit }],
        }),
      });

      if (res.ok) {
        // Clear the local edit for this block and refresh
        setLocalEdits((prev: Record<string, LocalEdit>) => {
          const next = { ...prev };
          delete next[blockId];
          return next;
        });
        await fetchBlocks();
        refreshPreview();
        showToast('Draft saved');
      } else {
        const json = await res.json();
        showToast(json.error ?? 'Save failed', 'error');
      }
    } catch {
      showToast('Network error', 'error');
    } finally {
      setSavingBlocks((prev: Set<string>) => {
        const next = new Set(prev);
        next.delete(blockId);
        return next;
      });
    }
  }, [localEdits, fetchBlocks, refreshPreview, showToast]);

  // Save all modified blocks at once
  const handleSaveAll = useCallback(async () => {
    const allEntries = Object.entries(localEdits) as [string, LocalEdit][];
    const editEntries = allEntries.filter(([, edit]) => Object.keys(edit).length > 0);
    if (editEntries.length === 0) return;

    const allIds = editEntries.map(([id]) => id);
    setSavingBlocks(new Set(allIds));

    try {
      const res = await fetch('/api/admin/content/page-blocks', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          updates: editEntries.map(([id, edit]) => ({ id, ...edit })),
        }),
      });

      if (res.ok) {
        setLocalEdits({});
        await fetchBlocks();
        refreshPreview();
        const json = await res.json();
        showToast(`${json.data?.saved ?? editEntries.length} draft(s) saved`);
      } else {
        const json = await res.json();
        showToast(json.error ?? 'Save failed', 'error');
      }
    } catch {
      showToast('Network error', 'error');
    } finally {
      setSavingBlocks(new Set());
    }
  }, [localEdits, fetchBlocks, refreshPreview, showToast]);

  // Publish all drafts for this page
  const handlePublish = useCallback(async () => {
    // Save any unsaved local edits first
    const allPubEntries = Object.entries(localEdits) as [string, LocalEdit][];
    const editEntries = allPubEntries.filter(([, edit]) => Object.keys(edit).length > 0);
    if (editEntries.length > 0) {
      const saveRes = await fetch('/api/admin/content/page-blocks', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          updates: editEntries.map(([id, edit]) => ({ id, ...edit })),
        }),
      });
      if (!saveRes.ok) {
        showToast('Failed to save pending edits before publishing', 'error');
        return;
      }
    }

    setPublishing(true);
    try {
      const res = await fetch('/api/admin/content/page-blocks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'publish', page: selectedPage }),
      });

      if (res.ok) {
        const json = await res.json();
        setLocalEdits({});
        await fetchBlocks();
        refreshPreview();
        showToast(`${json.data?.published ?? 0} block(s) published`);
      } else {
        const json = await res.json();
        showToast(json.error ?? 'Publish failed', 'error');
      }
    } catch {
      showToast('Network error', 'error');
    } finally {
      setPublishing(false);
    }
  }, [selectedPage, localEdits, fetchBlocks, refreshPreview, showToast]);

  // Discard all drafts for this page
  const handleDiscard = useCallback(async () => {
    if (!window.confirm('Discard all draft changes for this page? This will revert blocks to their last published version.')) {
      return;
    }

    setDiscarding(true);
    try {
      const res = await fetch('/api/admin/content/page-blocks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'discard', page: selectedPage }),
      });

      if (res.ok) {
        const json = await res.json();
        setLocalEdits({});
        await fetchBlocks();
        refreshPreview();
        showToast(`${json.data?.discarded ?? 0} draft(s) discarded`);
      } else {
        const json = await res.json();
        showToast(json.error ?? 'Discard failed', 'error');
      }
    } catch {
      showToast('Network error', 'error');
    } finally {
      setDiscarding(false);
    }
  }, [selectedPage, fetchBlocks, refreshPreview, showToast]);

  // Submit drafts for review (rfp_admin → master_admin review)
  const [submitting, setSubmitting] = useState(false);
  const handleSubmitForReview = useCallback(async () => {
    const allEntries = Object.entries(localEdits) as [string, LocalEdit][];
    const editEntries = allEntries.filter(([, edit]) => Object.keys(edit).length > 0);
    if (editEntries.length > 0) {
      const saveRes = await fetch('/api/admin/content/page-blocks', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates: editEntries.map(([id, edit]) => ({ id, ...edit })) }),
      });
      if (!saveRes.ok) {
        showToast('Failed to save edits before submitting', 'error');
        return;
      }
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/admin/content/page-blocks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'submit_review', page: selectedPage }),
      });
      if (res.ok) {
        const json = await res.json() as { data?: { submitted?: number } };
        setLocalEdits({});
        await fetchBlocks();
        showToast(`${json.data?.submitted ?? 0} block(s) submitted for review`);
      } else {
        const json = await res.json() as { error?: string };
        showToast(json.error ?? 'Submit failed', 'error');
      }
    } catch {
      showToast('Network error', 'error');
    } finally {
      setSubmitting(false);
    }
  }, [selectedPage, localEdits, fetchBlocks, showToast]);

  // Approve pending blocks (master_admin only)
  const [approving, setApproving] = useState(false);
  const handleApprove = useCallback(async () => {
    setApproving(true);
    try {
      const res = await fetch('/api/admin/content/page-blocks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve', page: selectedPage }),
      });
      if (res.ok) {
        const json = await res.json() as { data?: { approved?: number } };
        await fetchBlocks();
        refreshPreview();
        showToast(`${json.data?.approved ?? 0} block(s) approved and published`);
      } else {
        const json = await res.json() as { error?: string };
        showToast(json.error ?? 'Approve failed', 'error');
      }
    } catch {
      showToast('Network error', 'error');
    } finally {
      setApproving(false);
    }
  }, [selectedPage, fetchBlocks, refreshPreview, showToast]);

  // Reject pending blocks back to draft
  const handleReject = useCallback(async () => {
    const notes = window.prompt('Rejection notes (optional):');
    if (notes === null) return;

    try {
      const res = await fetch('/api/admin/content/page-blocks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reject', page: selectedPage, notes }),
      });
      if (res.ok) {
        const json = await res.json() as { data?: { rejected?: number } };
        await fetchBlocks();
        showToast(`${json.data?.rejected ?? 0} block(s) sent back for revision`);
      }
    } catch {
      showToast('Network error', 'error');
    }
  }, [selectedPage, fetchBlocks, showToast]);

  // Group blocks by section tag
  const groupedBlocks: Record<string, Block[]> = {};
  for (const block of blocks) {
    const pageTag = block.tags.find((t: string) => t === selectedPage);
    const sectionTag = block.tags.find((t: string) => t !== pageTag) ?? 'unknown';
    if (!groupedBlocks[sectionTag]) groupedBlocks[sectionTag] = [];
    groupedBlocks[sectionTag].push(block);
  }

  const editValues: LocalEdit[] = Object.values(localEdits);
  const hasLocalEdits = editValues.some((e: LocalEdit) => Object.keys(e).length > 0);
  const hasDraftBlocks = blocks.some((b: Block) => b.status === 'draft');
  const hasPendingBlocks = blocks.some((b: Block) => b.status === 'pending');
  const draftCount = blocks.filter((b: Block) => b.status === 'draft').length;
  const pendingCount = blocks.filter((b: Block) => b.status === 'pending').length;
  const modifiedCount = editValues.filter((e: LocalEdit) => Object.keys(e).length > 0).length;

  const previewUrl = `${PAGE_TO_PATH[selectedPage] ?? '/'}?_preview=1`;

  return (
    <div className="flex flex-col h-full">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-3 bg-white border-b border-gray-200">
        <div className="flex items-center gap-4">
          <h1 className="text-lg font-bold text-gray-900">Visual Editor</h1>
          <select
            value={selectedPage}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setSelectedPage(e.target.value)}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          >
            {pages.map((p) => (
              <option key={p} value={p}>
                {PAGE_LABELS[p] ?? p}
              </option>
            ))}
          </select>
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <span>{blocks.length} blocks</span>
            {draftCount > 0 && (
              <span className="px-1.5 py-0.5 bg-yellow-100 text-yellow-800 rounded">
                {draftCount} draft
              </span>
            )}
            {pendingCount > 0 && (
              <span className="px-1.5 py-0.5 bg-indigo-100 text-indigo-700 rounded">
                {pendingCount} pending review
              </span>
            )}
            {modifiedCount > 0 && (
              <span className="px-1.5 py-0.5 bg-amber-100 text-amber-800 rounded">
                {modifiedCount} unsaved
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {hasLocalEdits && (
            <button
              onClick={handleSaveAll}
              disabled={savingBlocks.size > 0}
              className="px-3 py-1.5 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-md border border-blue-200"
            >
              Save All Drafts
            </button>
          )}
          {(hasDraftBlocks || hasLocalEdits) && (
            <>
              <button
                onClick={handleDiscard}
                disabled={discarding}
                className="px-3 py-1.5 text-xs font-semibold text-red-700 bg-red-50 hover:bg-red-100 rounded-md border border-red-200 disabled:opacity-50"
              >
                {discarding ? 'Discarding...' : 'Discard Drafts'}
              </button>
              <button
                onClick={handleSubmitForReview}
                disabled={submitting}
                className="px-3 py-1.5 text-xs font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-md border border-indigo-200 disabled:opacity-50"
              >
                {submitting ? 'Submitting...' : 'Submit for Review'}
              </button>
              <button
                onClick={handlePublish}
                disabled={publishing}
                className="px-3 py-1.5 text-xs font-bold text-white bg-green-600 hover:bg-green-700 rounded-md disabled:opacity-50"
              >
                {publishing ? 'Publishing...' : 'Publish All Changes'}
              </button>
            </>
          )}
          {hasPendingBlocks && (
            <>
              <button
                onClick={handleReject}
                className="px-3 py-1.5 text-xs font-semibold text-orange-700 bg-orange-50 hover:bg-orange-100 rounded-md border border-orange-200"
              >
                Reject to Draft
              </button>
              <button
                onClick={handleApprove}
                disabled={approving}
                className="px-3 py-1.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-md disabled:opacity-50"
              >
                {approving ? 'Approving...' : 'Approve & Publish'}
              </button>
            </>
          )}
          <a
            href="/admin/content"
            className="px-3 py-1.5 text-xs font-medium text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-md"
          >
            Back to CMS
          </a>
        </div>
      </div>

      {/* Split pane */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left panel: block editor (40%) */}
        <div className="w-[40%] border-r border-gray-200 overflow-y-auto bg-gray-50">
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <p className="text-sm text-gray-400">Loading blocks...</p>
            </div>
          ) : blocks.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <p className="text-sm text-gray-500">No content blocks found for this page.</p>
                <p className="text-xs text-gray-400 mt-1">Create blocks in the CMS Content editor first.</p>
              </div>
            </div>
          ) : (
            <div className="p-4 space-y-6">
              {Object.entries(groupedBlocks).map(([section, sectionBlocks]) => (
                <div key={section}>
                  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 px-1">
                    {getSectionLabel(section)}
                  </h3>
                  <div className="space-y-2">
                    {sectionBlocks.map((block: Block) => (
                      <BlockEditor
                        key={block.id}
                        block={block}
                        localEdit={localEdits[block.id] as LocalEdit | undefined}
                        onFieldChange={handleFieldChange}
                        onSaveDraft={handleSaveDraft}
                        saving={savingBlocks.has(block.id)}
                        onRefresh={fetchBlocks}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right panel: live preview iframe (60%) */}
        <div className="w-[60%] bg-white flex flex-col">
          <div className="flex items-center justify-between px-3 py-2 bg-gray-100 border-b border-gray-200">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-red-400" />
              <div className="w-3 h-3 rounded-full bg-yellow-400" />
              <div className="w-3 h-3 rounded-full bg-green-400" />
            </div>
            <p className="text-xs text-gray-500 font-mono truncate flex-1 mx-4">
              {previewUrl}
            </p>
            <button
              onClick={refreshPreview}
              className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1 rounded hover:bg-gray-200"
              title="Refresh preview"
            >
              Refresh
            </button>
          </div>
          <iframe
            ref={iframeRef}
            src={previewUrl}
            className="w-full flex-1 border-0"
            title="Page preview"
          />
        </div>
      </div>

      {/* Toast notification */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 px-4 py-3 rounded-lg shadow-lg text-sm font-medium z-50 transition-opacity ${
            toast.type === 'success'
              ? 'bg-green-600 text-white'
              : 'bg-red-600 text-white'
          }`}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}
