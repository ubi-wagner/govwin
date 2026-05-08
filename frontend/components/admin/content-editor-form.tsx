'use client';

import React, { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';

const CONTENT_TYPES = [
  { value: 'blog_post', label: 'Blog Post' },
  { value: 'resource', label: 'Resource' },
  { value: 'guide', label: 'Guide' },
  { value: 'announcement', label: 'Announcement' },
  { value: 'faq', label: 'FAQ' },
  { value: 'testimonial', label: 'Testimonial' },
  { value: 'team_member', label: 'Team Member' },
  { value: 'page_block', label: 'Page Block' },
] as const;

const STATUSES = [
  { value: 'draft', label: 'Draft', color: 'bg-gray-100 text-gray-700', description: 'Not visible anywhere' },
  { value: 'pending', label: 'Pending Review', color: 'bg-yellow-100 text-yellow-800', description: 'Awaiting approval' },
  { value: 'published', label: 'Published', color: 'bg-green-100 text-green-800', description: 'Visible on public site' },
  { value: 'private', label: 'Private', color: 'bg-blue-100 text-blue-800', description: 'Admin-only, not public' },
  { value: 'archived', label: 'Archived', color: 'bg-purple-100 text-purple-800', description: 'Preserved but hidden' },
] as const;

interface ExistingContent {
  id: string;
  slug: string;
  title: string;
  contentType: string;
  body: string;
  excerpt: string;
  author: string;
  tags: string[];
  published: boolean;
  status?: string;
  featuredImage: string;
  externalUrl: string;
  displayOrder: number;
  metadata: Record<string, unknown>;
}

interface ContentEditorFormProps {
  existing: ExistingContent | null;
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

export default function ContentEditorForm({ existing }: ContentEditorFormProps) {
  const router = useRouter();
  const isNew = !existing;

  const [title, setTitle] = useState(existing?.title ?? '');
  const [slug, setSlug] = useState(existing?.slug ?? '');
  const [slugTouched, setSlugTouched] = useState(false);
  const [contentType, setContentType] = useState(existing?.contentType ?? 'resource');
  const [body, setBody] = useState(existing?.body ?? '');
  const [excerpt, setExcerpt] = useState(existing?.excerpt ?? '');
  const [author, setAuthor] = useState(existing?.author ?? '');
  const [tagsInput, setTagsInput] = useState((existing?.tags ?? []).join(', '));
  const [externalUrl, setExternalUrl] = useState(existing?.externalUrl ?? '');
  const [featuredImage, setFeaturedImage] = useState(existing?.featuredImage ?? '');
  const [displayOrder, setDisplayOrder] = useState(existing?.displayOrder ?? 0);
  const [status, setStatus] = useState(existing?.status ?? (existing?.published ? 'published' : 'draft'));
  const published = status === 'published';
  const [metadata, setMetadata] = useState(JSON.stringify(existing?.metadata ?? {}, null, 2));

  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  const parsedTags = tagsInput
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);

  const handleTitleChange = useCallback(
    (value: string) => {
      setTitle(value);
      if (!slugTouched) {
        setSlug(slugify(value));
      }
    },
    [slugTouched],
  );

  const handleSlugChange = useCallback((value: string) => {
    setSlugTouched(true);
    setSlug(slugify(value));
  }, []);

  // ── Auto-generate from URL ──────────────────────────────────────────
  const handleAutoGenerate = useCallback(async () => {
    if (!externalUrl.trim()) {
      setError('Enter an external URL first to auto-generate content.');
      return;
    }
    setGenerating(true);
    setError('');
    try {
      const res = await fetch('/api/admin/content/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: externalUrl.trim(), contentType }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? 'Failed to auto-generate');
        return;
      }
      const data = json.data;
      if (data.title) {
        setTitle(data.title);
        if (!slugTouched) setSlug(data.suggestedSlug ?? slugify(data.title));
      }
      if (data.excerpt) setExcerpt(data.excerpt);
      if (data.tags?.length) setTagsInput(data.tags.join(', '));
      if (data.imageUrl) setFeaturedImage(data.imageUrl);
      setSuccess('Auto-generated from URL. Review and adjust before saving.');
    } catch {
      setError('Failed to auto-generate content. Check the URL and try again.');
    } finally {
      setGenerating(false);
    }
  }, [externalUrl, contentType, slugTouched]);

  // ── Save ────────────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (!title.trim() || !slug.trim() || !contentType || !body.trim()) {
      setError('Title, slug, content type, and body are required.');
      return;
    }

    let parsedMetadata: Record<string, unknown> = {};
    try {
      parsedMetadata = JSON.parse(metadata);
    } catch {
      setError('Metadata must be valid JSON.');
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
          contentType,
          body,
          excerpt: excerpt.trim() || null,
          author: author.trim() || null,
          tags: parsedTags,
          published,
          status,
          featuredImage: featuredImage.trim() || null,
          externalUrl: externalUrl.trim() || null,
          displayOrder,
          metadata: parsedMetadata,
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? 'Failed to save');
        return;
      }

      setSuccess('Saved successfully.');
      if (isNew) {
        router.push(`/admin/content/${json.data.slug}`);
      }
    } catch {
      setError('Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  }, [title, slug, contentType, body, excerpt, author, parsedTags, published, featuredImage, externalUrl, displayOrder, metadata, isNew, router]);

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

  return (
    <div className="max-w-4xl">
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
        {/* Title */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
          <input
            type="text"
            value={title}
            onChange={(e) => handleTitleChange(e.target.value)}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            placeholder="Article title"
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
            placeholder="article-slug"
          />
          <p className="mt-1 text-xs text-gray-400">
            rfppipeline.com/resources/{slug || 'your-slug'}
          </p>
        </div>

        {/* Content Type + Author row */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Content Type</label>
            <select
              value={contentType}
              onChange={(e) => setContentType(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            >
              {CONTENT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Author</label>
            <input
              type="text"
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              placeholder="Author name"
            />
          </div>
        </div>

        {/* Body */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Body</label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={12}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-mono focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            placeholder="Content body (plain text or markdown)"
          />
        </div>

        {/* Excerpt */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Excerpt</label>
          <textarea
            value={excerpt}
            onChange={(e) => setExcerpt(e.target.value)}
            rows={3}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            placeholder="Short preview text for cards and listings"
          />
        </div>

        {/* Tags */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Tags</label>
          <input
            type="text"
            value={tagsInput}
            onChange={(e) => setTagsInput(e.target.value)}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            placeholder="sbir, proposal-writing, phase-1 (comma-separated)"
          />
          {parsedTags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {parsedTags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-700"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* External URL + Auto-generate */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">External URL</label>
          <div className="flex gap-2">
            <input
              type="url"
              value={externalUrl}
              onChange={(e) => setExternalUrl(e.target.value)}
              className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              placeholder="https://www.sbir.gov/about"
            />
            <button
              onClick={handleAutoGenerate}
              disabled={generating || !externalUrl.trim()}
              className="inline-flex items-center rounded-md bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
            >
              {generating ? 'Generating...' : 'Auto-generate'}
            </button>
          </div>
          <p className="mt-1 text-xs text-gray-400">
            For resources linking to external sites. Use Auto-generate to fill title, excerpt, and tags from the page.
          </p>
        </div>

        {/* Featured Image URL + Display Order row */}
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
          </div>
        </div>

        {/* Metadata (JSON) — for testimonial/team_member */}
        {(contentType === 'testimonial' || contentType === 'team_member' || contentType === 'page_block') && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Metadata (JSON)
              {contentType === 'testimonial' && (
                <span className="ml-2 text-xs text-gray-400 font-normal">
                  e.g. {`{ "company": "Acme Corp", "title": "CEO", "role": "Founder" }`}
                </span>
              )}
              {contentType === 'team_member' && (
                <span className="ml-2 text-xs text-gray-400 font-normal">
                  e.g. {`{ "linkedin_url": "https://...", "email": "name@co.com" }`}
                </span>
              )}
            </label>
            <textarea
              value={metadata}
              onChange={(e) => setMetadata(e.target.value)}
              rows={4}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-mono focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              placeholder="{}"
            />
          </div>
        )}

        {/* Status selector */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Status</label>
          <div className="flex flex-wrap gap-2">
            {STATUSES.map((s) => (
              <button
                key={s.value}
                type="button"
                onClick={() => setStatus(s.value)}
                className={`px-3 py-1.5 rounded-full text-sm font-medium border-2 transition-all ${
                  status === s.value
                    ? `${s.color} border-current ring-2 ring-offset-1`
                    : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-gray-400">
            {STATUSES.find((s) => s.value === status)?.description}
          </p>
        </div>

        {/* Preview toggle */}
        <div>
          <button
            onClick={() => setShowPreview(!showPreview)}
            className="text-sm text-blue-600 hover:text-blue-800 font-medium"
          >
            {showPreview ? 'Hide Preview' : 'Show Card Preview'}
          </button>
          {showPreview && (
            <div className="mt-3 max-w-sm">
              <div className="rounded-lg border border-gray-200 overflow-hidden bg-white shadow-sm">
                {featuredImage && (
                  <div className="h-40 bg-gray-100 overflow-hidden">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={featuredImage}
                      alt={title}
                      className="w-full h-full object-cover"
                    />
                  </div>
                )}
                <div className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-semibold text-blue-600 uppercase tracking-wider">
                      {contentType.replace('_', ' ')}
                    </span>
                    {parsedTags[0] && (
                      <span className="text-xs rounded bg-gray-100 px-1.5 py-0.5 text-gray-500">
                        {parsedTags[0]}
                      </span>
                    )}
                  </div>
                  <h3 className="font-bold text-gray-900">{title || 'Untitled'}</h3>
                  {excerpt && (
                    <p className="mt-1 text-sm text-gray-600 line-clamp-2">{excerpt}</p>
                  )}
                  {author && (
                    <p className="mt-2 text-xs text-gray-400">By {author}</p>
                  )}
                  {externalUrl && (
                    <p className="mt-2 text-xs text-blue-500">Read More &rarr;</p>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3 pt-4 border-t border-gray-200">
          <button
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center rounded-md bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Saving...' : isNew ? 'Create Content' : 'Save Changes'}
          </button>
          <button
            onClick={() => router.push('/admin/content')}
            className="inline-flex items-center rounded-md border border-gray-300 bg-white px-5 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
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
                  Delete
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
