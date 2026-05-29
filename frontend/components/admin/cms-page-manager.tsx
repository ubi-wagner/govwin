'use client';

import React, { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CmsBlock {
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

interface GroupedPage {
  sections: Record<string, CmsBlock[]>;
}

export interface GroupedData {
  pages: Record<string, GroupedPage>;
  blog: CmsBlock[];
  other: CmsBlock[];
}

// ─── Constants ───────────────────────────────────────────────────────────────

const PAGE_TABS = [
  'homepage', 'about', 'features', 'value', 'pricing',
  'how-it-works', 'engine', 'the-expert', 'security', 'infosec',
  'apply', 'get-started', 'resources', 'blog', 'other',
] as const;

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
  blog: 'Blog',
  other: 'Other',
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

const BLOG_TYPES = ['blog_post', 'resource', 'guide'];

const STATUS_BADGES: Record<string, { bg: string; text: string; label: string }> = {
  draft: { bg: 'bg-gray-100', text: 'text-gray-700', label: 'Draft' },
  pending: { bg: 'bg-yellow-100', text: 'text-yellow-800', label: 'Pending' },
  published: { bg: 'bg-green-100', text: 'text-green-700', label: 'Published' },
  private: { bg: 'bg-blue-100', text: 'text-blue-800', label: 'Private' },
  archived: { bg: 'bg-purple-100', text: 'text-purple-800', label: 'Archived' },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getSectionLabel(tag: string): string {
  if (SECTION_LABELS[tag]) return SECTION_LABELS[tag];
  return tag
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

function getPageCount(grouped: GroupedData, tab: string): number {
  if (tab === 'blog') return grouped.blog.length;
  if (tab === 'other') return grouped.other.length;
  const page = grouped.pages[tab];
  if (!page) return 0;
  return Object.values(page.sections).reduce((sum, blocks) => sum + blocks.length, 0);
}

// ─── Status Badge Component ──────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const badge = STATUS_BADGES[status] ?? STATUS_BADGES.draft;
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${badge.bg} ${badge.text}`}>
      {badge.label}
    </span>
  );
}

// ─── Inline Editor Component ─────────────────────────────────────────────────

interface InlineEditorProps {
  block: CmsBlock;
  onSave: () => void;
  onCancel: () => void;
}

function InlineEditor({ block, onSave, onCancel }: InlineEditorProps) {
  const [title, setTitle] = useState(block.title);
  const [body, setBody] = useState(block.body);
  const [excerpt, setExcerpt] = useState(block.excerpt ?? '');
  const [displayOrder, setDisplayOrder] = useState(block.displayOrder);
  const [metadata, setMetadata] = useState(
    Object.keys(block.metadata).length > 0 ? JSON.stringify(block.metadata, null, 2) : ''
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = useCallback(async () => {
    if (!title.trim() || !body.trim()) {
      setError('Title and body are required.');
      return;
    }

    let parsedMetadata: Record<string, unknown> = {};
    if (metadata.trim()) {
      try {
        parsedMetadata = JSON.parse(metadata);
      } catch {
        setError('Metadata must be valid JSON.');
        return;
      }
    }

    setSaving(true);
    setError('');

    try {
      const res = await fetch('/api/admin/content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug: block.slug,
          title: title.trim(),
          contentType: block.contentType,
          body,
          excerpt: excerpt.trim() || null,
          author: block.author,
          tags: block.tags,
          externalUrl: block.externalUrl,
          featuredImage: block.featuredImage,
          displayOrder,
          status: 'published',
          metadata: parsedMetadata,
        }),
      });

      if (!res.ok) {
        const json = await res.json();
        setError(json.error ?? 'Failed to save');
        return;
      }

      onSave();
    } catch {
      setError('Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  }, [title, body, excerpt, displayOrder, metadata, block, onSave]);

  return (
    <div className="mt-3 space-y-3 border-t border-gray-100 pt-3">
      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 p-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Title</label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Body</label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={4}
          className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm font-mono focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Excerpt</label>
        <input
          type="text"
          value={excerpt}
          onChange={(e) => setExcerpt(e.target.value)}
          className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
        />
      </div>

      <div className="flex gap-4">
        <div className="w-32">
          <label className="block text-xs font-medium text-gray-600 mb-1">Display Order</label>
          <input
            type="number"
            value={displayOrder}
            onChange={(e) => setDisplayOrder(parseInt(e.target.value, 10) || 0)}
            className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            min={0}
          />
        </div>
      </div>

      {(metadata.trim() || Object.keys(block.metadata).length > 0) && (
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Metadata (JSON)</label>
          <textarea
            value={metadata}
            onChange={(e) => setMetadata(e.target.value)}
            rows={3}
            className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm font-mono focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            placeholder="{}"
          />
        </div>
      )}

      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={handleSave}
          disabled={saving}
          className="inline-flex items-center rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
        <button
          onClick={onCancel}
          className="inline-flex items-center rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Cancel
        </button>
        <Link
          href={`/admin/content/${block.slug}`}
          className="ml-auto text-sm text-blue-600 hover:text-blue-800"
        >
          Full Editor
        </Link>
      </div>
    </div>
  );
}

// ─── New Block Form Component ────────────────────────────────────────────────

interface NewBlockFormProps {
  pageTag: string;
  sectionTag: string;
  onSave: () => void;
  onCancel: () => void;
}

function NewBlockForm({ pageTag, sectionTag, onSave, onCancel }: NewBlockFormProps) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [excerpt, setExcerpt] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = useCallback(async () => {
    if (!title.trim() || !body.trim()) {
      setError('Title and body are required.');
      return;
    }

    const slug = slugify(title);
    if (!slug) {
      setError('Title must produce a valid slug.');
      return;
    }

    setSaving(true);
    setError('');

    try {
      const res = await fetch('/api/admin/content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug,
          title: title.trim(),
          contentType: 'page_block',
          body,
          excerpt: excerpt.trim() || null,
          author: null,
          tags: [pageTag, sectionTag],
          externalUrl: null,
          featuredImage: null,
          displayOrder: 0,
          status: 'draft',
          metadata: {},
        }),
      });

      if (!res.ok) {
        const json = await res.json();
        setError(json.error ?? 'Failed to create block');
        return;
      }

      onSave();
    } catch {
      setError('Failed to create block. Please try again.');
    } finally {
      setSaving(false);
    }
  }, [title, body, excerpt, pageTag, sectionTag, onSave]);

  return (
    <div className="mt-3 rounded-lg border border-dashed border-blue-300 bg-blue-50/50 p-4 space-y-3">
      <div className="text-sm font-medium text-blue-800">New Block</div>
      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 p-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Title</label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 bg-white"
          placeholder="Block title"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Body</label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 bg-white"
          placeholder="Block content"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Excerpt</label>
        <input
          type="text"
          value={excerpt}
          onChange={(e) => setExcerpt(e.target.value)}
          className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 bg-white"
          placeholder="Short description (optional)"
        />
      </div>

      <div className="text-xs text-gray-500">
        Tags: <span className="font-mono">{pageTag}, {sectionTag}</span> | Type: page_block | Status: draft
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={handleSave}
          disabled={saving}
          className="inline-flex items-center rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? 'Creating...' : 'Create as Draft'}
        </button>
        <button
          onClick={onCancel}
          className="inline-flex items-center rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ─── Content Block Card Component ────────────────────────────────────────────

interface BlockCardProps {
  block: CmsBlock;
  onRefresh: () => void;
}

function BlockCard({ block, onRefresh }: BlockCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  const handleStatusChange = useCallback(async (newStatus: 'published' | 'archived' | 'draft') => {
    setActionLoading(true);
    try {
      const res = await fetch('/api/admin/content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug: block.slug,
          title: block.title,
          contentType: block.contentType,
          body: block.body,
          excerpt: block.excerpt,
          author: block.author,
          tags: block.tags,
          externalUrl: block.externalUrl,
          featuredImage: block.featuredImage,
          displayOrder: block.displayOrder,
          status: newStatus,
          metadata: block.metadata,
        }),
      });

      if (res.ok) {
        onRefresh();
      }
    } catch {
      // Silently fail — user can retry
    } finally {
      setActionLoading(false);
    }
  }, [block, onRefresh]);

  const handleSaveInline = useCallback(() => {
    setExpanded(false);
    onRefresh();
  }, [onRefresh]);

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      {/* Collapsed header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400 font-mono">#{block.displayOrder}</span>
            <h4 className="text-sm font-medium text-gray-900 truncate">{block.title}</h4>
            <StatusBadge status={block.status} />
          </div>
          {!expanded && block.body && (
            <p className="mt-1 text-sm text-gray-500 line-clamp-2">{block.body}</p>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <Link
            href={`/admin/content/${block.slug}/preview`}
            className="inline-flex items-center rounded px-2 py-1 text-xs font-medium text-purple-600 hover:bg-purple-50"
            title="Preview"
          >
            Preview
          </Link>
          <Link
            href={`/admin/content/${block.slug}`}
            className="inline-flex items-center rounded px-2 py-1 text-xs font-medium text-green-700 hover:bg-green-50"
            title="Full Editor"
          >
            Full Edit
          </Link>
          <button
            onClick={() => setExpanded(!expanded)}
            className="inline-flex items-center rounded px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50"
          >
            {expanded ? 'Collapse' : 'Quick Edit'}
          </button>
          {block.status === 'draft' && (
            <button
              onClick={() => handleStatusChange('published')}
              disabled={actionLoading}
              className="inline-flex items-center rounded px-2 py-1 text-xs font-medium text-green-600 hover:bg-green-50 disabled:opacity-50"
            >
              Publish
            </button>
          )}
          {block.status === 'published' && (
            <button
              onClick={() => handleStatusChange('archived')}
              disabled={actionLoading}
              className="inline-flex items-center rounded px-2 py-1 text-xs font-medium text-purple-600 hover:bg-purple-50 disabled:opacity-50"
            >
              Archive
            </button>
          )}
          {block.status === 'archived' && (
            <button
              onClick={() => handleStatusChange('draft')}
              disabled={actionLoading}
              className="inline-flex items-center rounded px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-50"
            >
              Restore
            </button>
          )}
        </div>
      </div>

      {/* Expanded inline editor */}
      {expanded && (
        <InlineEditor
          block={block}
          onSave={handleSaveInline}
          onCancel={() => setExpanded(false)}
        />
      )}
    </div>
  );
}

// ─── Section Component ───────────────────────────────────────────────────────

interface SectionGroupProps {
  pageTag: string;
  sectionTag: string;
  blocks: CmsBlock[];
  onRefresh: () => void;
}

function SectionGroup({ pageTag, sectionTag, blocks, onRefresh }: SectionGroupProps) {
  const [showNewForm, setShowNewForm] = useState(false);

  return (
    <div className="mb-6">
      <div className="flex items-center gap-2 mb-3 px-3 py-2 bg-gray-50 rounded-lg border border-gray-100">
        <h3 className="text-sm font-semibold text-gray-700">
          {getSectionLabel(sectionTag)}
        </h3>
        <span className="text-xs text-gray-400 font-mono">({sectionTag})</span>
        <span className="text-xs text-gray-400 ml-auto">{blocks.length} block{blocks.length !== 1 ? 's' : ''}</span>
      </div>

      {blocks.length === 0 ? (
        <p className="text-sm text-gray-400 italic px-3 py-2">No blocks in this section</p>
      ) : (
        <div className="space-y-2">
          {blocks.map((block) => (
            <BlockCard key={block.id} block={block} onRefresh={onRefresh} />
          ))}
        </div>
      )}

      {showNewForm ? (
        <NewBlockForm
          pageTag={pageTag}
          sectionTag={sectionTag}
          onSave={() => {
            setShowNewForm(false);
            onRefresh();
          }}
          onCancel={() => setShowNewForm(false)}
        />
      ) : (
        <div className="mt-2 flex items-center gap-2">
          <button
            onClick={() => setShowNewForm(true)}
            className="inline-flex items-center rounded-md border border-dashed border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-500 hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50/50"
          >
            + Quick Add
          </button>
          <Link
            href={`/admin/content/new?page=${encodeURIComponent(pageTag)}&section=${encodeURIComponent(sectionTag)}`}
            className="inline-flex items-center rounded-md border border-dashed border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-500 hover:border-green-400 hover:text-green-600 hover:bg-green-50/50"
          >
            + Add via Full Editor
          </Link>
        </div>
      )}
    </div>
  );
}

// ─── Blog/Other Card Component ───────────────────────────────────────────────

function ArticleCard({ block }: { block: CmsBlock }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
              {block.contentType.replace('_', ' ')}
            </span>
            <StatusBadge status={block.status} />
          </div>
          <h4 className="text-sm font-medium text-gray-900">{block.title}</h4>
          {block.excerpt && (
            <p className="mt-1 text-sm text-gray-500 line-clamp-2">{block.excerpt}</p>
          )}
          <div className="mt-2 flex items-center gap-3 text-xs text-gray-400">
            {block.author && <span>By {block.author}</span>}
            {block.tags.length > 0 && (
              <span className="flex gap-1">
                {block.tags.map((tag) => (
                  <span key={tag} className="rounded bg-gray-100 px-1.5 py-0.5">{tag}</span>
                ))}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Link
            href={`/admin/content/${block.slug}/preview`}
            className="inline-flex items-center rounded px-2 py-1 text-xs font-medium text-purple-600 hover:bg-purple-50"
            title="Preview"
          >
            Preview
          </Link>
          <Link
            href={`/admin/content/${block.slug}`}
            className="inline-flex items-center rounded px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50"
          >
            Edit
          </Link>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

interface CmsPageManagerProps {
  grouped: GroupedData;
  totalBlocks: number;
  publishedCount: number;
  draftCount: number;
  archivedCount: number;
}

export default function CmsPageManager({
  grouped,
  totalBlocks,
  publishedCount,
  draftCount,
  archivedCount,
}: CmsPageManagerProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<string>('homepage');

  const handleRefresh = useCallback(() => {
    router.refresh();
  }, [router]);

  const renderPageContent = (tab: string) => {
    const page = grouped.pages[tab];
    if (!page || Object.keys(page.sections).length === 0) {
      return (
        <div className="text-center py-12 text-gray-400">
          <p className="text-sm">No content blocks for this page yet.</p>
          <p className="text-xs mt-1">Create blocks with the tag &ldquo;{tab}&rdquo; to populate this page.</p>
          <Link
            href={`/admin/content/new?page=${encodeURIComponent(tab)}`}
            className="mt-4 inline-flex items-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Add First Block
          </Link>
        </div>
      );
    }

    const sortedSections = Object.entries(page.sections).sort(([, a], [, b]) => {
      const aOrder = a[0]?.displayOrder ?? 0;
      const bOrder = b[0]?.displayOrder ?? 0;
      return aOrder - bOrder;
    });

    return (
      <div className="space-y-2">
        {sortedSections.map(([sectionTag, blocks]) => (
          <SectionGroup
            key={sectionTag}
            pageTag={tab}
            sectionTag={sectionTag}
            blocks={blocks}
            onRefresh={handleRefresh}
          />
        ))}
      </div>
    );
  };

  const renderBlogContent = () => {
    return (
      <div>
        <div className="mb-4 flex items-center justify-between">
          <p className="text-sm text-gray-500">{grouped.blog.length} article{grouped.blog.length !== 1 ? 's' : ''}</p>
          <Link
            href="/admin/content/new"
            className="inline-flex items-center rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            New Article
          </Link>
        </div>
        {grouped.blog.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <p className="text-sm">No blog posts, resources, or guides yet.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {grouped.blog.map((block) => (
              <ArticleCard key={block.id} block={block} />
            ))}
          </div>
        )}
      </div>
    );
  };

  const renderOtherContent = () => {
    return (
      <div>
        <div className="mb-4 flex items-center justify-between">
          <p className="text-sm text-gray-500">
            {grouped.other.length} item{grouped.other.length !== 1 ? 's' : ''} (testimonials, team members, announcements, etc.)
          </p>
          <Link
            href="/admin/content/new"
            className="inline-flex items-center rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            New Item
          </Link>
        </div>
        {grouped.other.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <p className="text-sm">No other content items.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {grouped.other.map((block) => (
              <ArticleCard key={block.id} block={block} />
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div>
      {/* Summary Bar */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Content Management</h1>
          <p className="text-sm text-gray-500 mt-1">
            {totalBlocks} total &middot;{' '}
            <span className="text-green-600">{publishedCount} published</span> &middot;{' '}
            <span className="text-gray-600">{draftCount} draft</span> &middot;{' '}
            <span className="text-purple-600">{archivedCount} archived</span>
          </p>
        </div>
        <Link
          href="/admin/content/new"
          className="inline-flex items-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          New Content
        </Link>
      </div>

      {/* Tab Bar */}
      <div className="mb-6 border-b border-gray-200 overflow-x-auto">
        <nav className="flex space-x-1 -mb-px" aria-label="Content pages">
          {PAGE_TABS.map((tab) => {
            const count = getPageCount(grouped, tab);
            const isActive = activeTab === tab;
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`whitespace-nowrap px-3 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                  isActive
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                {PAGE_LABELS[tab] ?? tab}
                {count > 0 && (
                  <span className={`ml-1.5 inline-flex items-center justify-center rounded-full px-1.5 py-0.5 text-xs ${
                    isActive ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-500'
                  }`}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Tab Content */}
      <div className="min-h-[400px]">
        {activeTab === 'blog' && renderBlogContent()}
        {activeTab === 'other' && renderOtherContent()}
        {activeTab !== 'blog' && activeTab !== 'other' && renderPageContent(activeTab)}
      </div>
    </div>
  );
}
