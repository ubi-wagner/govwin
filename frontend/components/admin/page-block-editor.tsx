'use client';

import React, { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import MetadataEditor from './metadata-editor';

// ─── Types ───────────────────────────────────────────────────────────────────

interface BlockData {
  id: string;
  slug: string;
  title: string;
  contentType: string;
  body: string;
  excerpt: string | null;
  tags: string[];
  status: string;
  featuredImage: string | null;
  displayOrder: number;
  metadata: Record<string, unknown>;
}

interface PageBlockEditorProps {
  existing: BlockData | null;
  defaultPage?: string;
  defaultSection?: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const PAGE_OPTIONS = [
  'homepage', 'about', 'features', 'value', 'pricing',
  'how-it-works', 'engine', 'the-expert', 'security', 'infosec',
  'apply', 'get-started', 'resources',
];

const SECTION_OPTIONS = [
  'hero', 'stats', 'stages', 'steps', 'pricing-hero', 'pricing',
  'expert-gate', 'quote', 'cta', 'pillars', 'founder', 'items',
  'faqs', 'spotlight', 'portals', 'curation', 'flywheel',
  'guardrails', 'form', 'features',
];

const STATUSES = [
  { value: 'draft', label: 'Draft', color: 'bg-gray-100 text-gray-700' },
  { value: 'published', label: 'Published', color: 'bg-green-100 text-green-800' },
  { value: 'archived', label: 'Archived', color: 'bg-purple-100 text-purple-800' },
];

// ─── Helper ──────────────────────────────────────────────────────────────────

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

// ─── Page path mapping ───────────────────────────────────────────────────────

const PAGE_PATHS: Record<string, string> = {
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

// ─── Component ───────────────────────────────────────────────────────────────

export default function PageBlockEditor({ existing, defaultPage, defaultSection }: PageBlockEditorProps) {
  const router = useRouter();
  const isNew = !existing;

  // Parse existing tags into page + section
  const existingPageTag = existing?.tags?.find((t) => PAGE_OPTIONS.includes(t)) ?? defaultPage ?? '';
  const existingSectionTag = existing?.tags?.find((t) => t !== existingPageTag) ?? defaultSection ?? '';

  const [title, setTitle] = useState(existing?.title ?? '');
  const [slug, setSlug] = useState(existing?.slug ?? '');
  const [slugTouched, setSlugTouched] = useState(!isNew);
  const [body, setBody] = useState(existing?.body ?? '');
  const [excerpt, setExcerpt] = useState(existing?.excerpt ?? '');
  const [pageTag, setPageTag] = useState(existingPageTag);
  const [sectionTag, setSectionTag] = useState(existingSectionTag);
  const [customSectionTag, setCustomSectionTag] = useState(
    SECTION_OPTIONS.includes(existingSectionTag) ? '' : existingSectionTag,
  );
  const [status, setStatus] = useState(existing?.status ?? 'draft');
  const [featuredImage, setFeaturedImage] = useState(existing?.featuredImage ?? '');
  const [displayOrder, setDisplayOrder] = useState(existing?.displayOrder ?? 0);
  const [metadata, setMetadata] = useState<Record<string, unknown>>(existing?.metadata ?? {});

  const [saving, setSaving] = useState(false);
  const [revalidating, setRevalidating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);

  const effectiveSectionTag = SECTION_OPTIONS.includes(sectionTag) ? sectionTag : customSectionTag;
  const tags = [pageTag, effectiveSectionTag].filter(Boolean);

  const handleTitleChange = useCallback(
    (value: string) => {
      setTitle(value);
      if (!slugTouched && pageTag) {
        setSlug(`${pageTag}-${slugify(value)}`);
      }
    },
    [slugTouched, pageTag],
  );

  const handleSlugChange = useCallback((value: string) => {
    setSlugTouched(true);
    setSlug(slugify(value));
  }, []);

  // ── Save ────────────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (!title.trim()) {
      setError('Title is required.');
      return;
    }
    if (!slug.trim()) {
      setError('Slug is required.');
      return;
    }
    if (!pageTag) {
      setError('Page tag is required.');
      return;
    }

    setSaving(true);
    setError('');
    setSuccess('');

    try {
      const res = await fetch('/api/admin/content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug: slug.trim(),
          title: title.trim(),
          contentType: 'page_block',
          body: body || ' ',
          excerpt: excerpt.trim() || null,
          author: null,
          tags,
          published: status === 'published',
          status,
          featuredImage: featuredImage.trim() || null,
          externalUrl: null,
          displayOrder,
          metadata,
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? 'Failed to save');
        return;
      }

      setSuccess('Saved successfully.');
      setLastSavedAt(new Date().toLocaleTimeString());

      if (isNew && json.data?.slug) {
        router.push(`/admin/content/${json.data.slug}`);
      }
    } catch {
      setError('Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  }, [title, slug, pageTag, body, excerpt, tags, status, featuredImage, displayOrder, metadata, isNew, router]);

  // ── Revalidate ──────────────────────────────────────────────────────
  const handleRevalidate = useCallback(async () => {
    setRevalidating(true);
    try {
      const pagePath = PAGE_PATHS[pageTag] ?? '/';
      const res = await fetch('/api/admin/content/revalidate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: pagePath }),
      });
      if (res.ok) {
        setSuccess(`Page cache cleared for ${pagePath}. Changes are now live.`);
      } else {
        const json = await res.json();
        setError(json.error ?? 'Failed to revalidate');
      }
    } catch {
      setError('Failed to revalidate page cache.');
    } finally {
      setRevalidating(false);
    }
  }, [pageTag]);

  // ── Delete ──────────────────────────────────────────────────────────
  const handleDelete = useCallback(async () => {
    if (!existing) return;
    setDeleting(true);
    setError('');
    try {
      const res = await fetch(`/api/admin/content?slug=${encodeURIComponent(existing.slug)}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const json = await res.json();
        setError(json.error ?? 'Failed to delete');
        return;
      }
      router.push('/admin/content');
    } catch {
      setError('Failed to delete. Please try again.');
    } finally {
      setDeleting(false);
    }
  }, [existing, router]);

  const previewPagePath = PAGE_PATHS[pageTag];

  return (
    <div className="max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {isNew ? 'New Page Block' : 'Edit Page Block'}
          </h1>
          {!isNew && (
            <p className="text-sm text-gray-500 mt-1 font-mono">{existing?.slug}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!isNew && (
            <Link
              href={`/admin/content/${existing?.slug}/preview`}
              className="inline-flex items-center rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Preview Block
            </Link>
          )}
          {previewPagePath && (
            <a
              href={previewPagePath}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center rounded-md border border-purple-300 bg-purple-50 px-3 py-2 text-sm font-medium text-purple-700 hover:bg-purple-100"
            >
              View on Site
            </a>
          )}
        </div>
      </div>

      {/* Status messages */}
      {error && (
        <div className="mb-4 rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">
          {error}
        </div>
      )}
      {success && (
        <div className="mb-4 rounded-md bg-green-50 border border-green-200 p-3 text-sm text-green-700">
          {success}
        </div>
      )}

      <div className="space-y-6">
        {/* Page + Section tags */}
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 space-y-3">
          <p className="text-sm font-medium text-blue-800">Block Location</p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-blue-700 mb-1 font-medium">Page</label>
              <select
                value={pageTag}
                onChange={(e) => setPageTag(e.target.value)}
                className="w-full rounded-md border border-blue-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              >
                <option value="">Select page...</option>
                {PAGE_OPTIONS.map((p) => (
                  <option key={p} value={p}>
                    {p.charAt(0).toUpperCase() + p.slice(1).replace(/-/g, ' ')}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-blue-700 mb-1 font-medium">Section</label>
              <select
                value={SECTION_OPTIONS.includes(sectionTag) ? sectionTag : '__custom__'}
                onChange={(e) => {
                  if (e.target.value === '__custom__') {
                    setSectionTag('');
                  } else {
                    setSectionTag(e.target.value);
                    setCustomSectionTag('');
                  }
                }}
                className="w-full rounded-md border border-blue-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              >
                <option value="">Select section...</option>
                {SECTION_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s.charAt(0).toUpperCase() + s.slice(1).replace(/-/g, ' ')}
                  </option>
                ))}
                <option value="__custom__">Custom...</option>
              </select>
              {(!SECTION_OPTIONS.includes(sectionTag) || sectionTag === '') && customSectionTag !== '' && (
                <input
                  type="text"
                  value={customSectionTag}
                  onChange={(e) => setCustomSectionTag(e.target.value.toLowerCase().replace(/\s+/g, '-'))}
                  className="mt-2 w-full rounded-md border border-blue-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  placeholder="custom-section-name"
                />
              )}
              {!SECTION_OPTIONS.includes(sectionTag) && customSectionTag === '' && sectionTag !== '' && (
                <input
                  type="text"
                  value={sectionTag}
                  onChange={(e) => {
                    const val = e.target.value.toLowerCase().replace(/\s+/g, '-');
                    setSectionTag(val);
                    setCustomSectionTag(val);
                  }}
                  className="mt-2 w-full rounded-md border border-blue-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  placeholder="custom-section-name"
                />
              )}
            </div>
          </div>
          {tags.length > 0 && (
            <div className="flex gap-2">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex rounded-full bg-blue-200 px-2.5 py-0.5 text-xs font-medium text-blue-800"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Title */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Title (Heading)</label>
          <input
            type="text"
            value={title}
            onChange={(e) => handleTitleChange(e.target.value)}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            placeholder="Block heading text"
          />
        </div>

        {/* Slug */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Slug</label>
          <input
            type="text"
            value={slug}
            onChange={(e) => handleSlugChange(e.target.value)}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-mono focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            placeholder="homepage-hero"
          />
          <p className="mt-1 text-xs text-gray-400">
            Unique identifier for this block. Used for upsert on save.
          </p>
        </div>

        {/* Excerpt (subtitle/eyebrow) */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Excerpt (Subtitle / Eyebrow Text)</label>
          <textarea
            value={excerpt}
            onChange={(e) => setExcerpt(e.target.value)}
            rows={2}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            placeholder="Subtitle or eyebrow text displayed above or below the heading"
          />
        </div>

        {/* Body (description / paragraph) */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Body (Description / Content)</label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={6}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            placeholder="Main body text, HTML or plain text"
          />
          <p className="mt-1 text-xs text-gray-400">
            Supports plain text or HTML. Used as the main paragraph/description text for this block.
          </p>
        </div>

        {/* Featured Image + Display Order */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Featured Image URL</label>
            <input
              type="url"
              value={featuredImage}
              onChange={(e) => setFeaturedImage(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              placeholder="https://example.com/image.jpg"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Display Order</label>
            <input
              type="number"
              value={displayOrder}
              onChange={(e) => setDisplayOrder(parseInt(e.target.value, 10) || 0)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              min={0}
            />
            <p className="mt-1 text-xs text-gray-400">
              Lower numbers appear first within the section.
            </p>
          </div>
        </div>

        {/* Inline Metadata Editor */}
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
          <MetadataEditor tags={tags} metadata={metadata} onChange={setMetadata} />
        </div>

        {/* Status */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Status</label>
          <div className="flex flex-wrap gap-2">
            {STATUSES.map((s) => (
              <button
                key={s.value}
                type="button"
                onClick={() => setStatus(s.value)}
                className={`px-4 py-2 rounded-full text-sm font-medium border-2 transition-all ${
                  status === s.value
                    ? `${s.color} border-current ring-2 ring-offset-1`
                    : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3 pt-4 border-t border-gray-200">
          <button
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center rounded-md bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Saving...' : isNew ? 'Create Block' : 'Save Changes'}
          </button>

          {!isNew && (
            <button
              onClick={handleRevalidate}
              disabled={revalidating}
              className="inline-flex items-center rounded-md bg-green-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
            >
              {revalidating ? 'Revalidating...' : 'Revalidate Now'}
            </button>
          )}

          <button
            onClick={() => router.push('/admin/content')}
            className="inline-flex items-center rounded-md border border-gray-300 bg-white px-5 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Back to List
          </button>

          {lastSavedAt && (
            <span className="text-xs text-gray-400">Last saved at {lastSavedAt}</span>
          )}

          {!isNew && (
            <>
              {showDeleteConfirm ? (
                <div className="ml-auto flex items-center gap-2">
                  <span className="text-sm text-red-600">Delete permanently?</span>
                  <button
                    onClick={handleDelete}
                    disabled={deleting}
                    className="inline-flex items-center rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                  >
                    {deleting ? 'Deleting...' : 'Yes, Delete'}
                  </button>
                  <button
                    onClick={() => setShowDeleteConfirm(false)}
                    className="inline-flex items-center rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  className="ml-auto inline-flex items-center text-sm text-red-500 hover:text-red-700"
                >
                  Delete Block
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
