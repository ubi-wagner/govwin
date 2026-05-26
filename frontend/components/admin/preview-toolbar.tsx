'use client';

import React, { useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

interface PreviewContent {
  id: string;
  slug: string;
  title: string;
  contentType: string;
  status: string;
}

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-500',
  pending: 'bg-amber-500',
  published: 'bg-green-500',
  private: 'bg-blue-500',
  archived: 'bg-purple-500',
};

function PublishButton({ contentId, slug }: { contentId: string; slug: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const handlePublish = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/content/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: contentId, slug, status: 'published' }),
      });
      if (res.ok) {
        router.refresh();
      }
    } catch {
      // Toolbar action — user can retry
    } finally {
      setLoading(false);
    }
  }, [contentId, slug, router]);

  return (
    <button
      onClick={handlePublish}
      disabled={loading}
      className="text-xs bg-green-600 px-3 py-1 rounded hover:bg-green-700 disabled:opacity-50 text-white font-medium"
    >
      {loading ? 'Publishing...' : 'Publish'}
    </button>
  );
}

function UnpublishButton({ contentId, slug }: { contentId: string; slug: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const handleUnpublish = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/content/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: contentId, slug, status: 'draft' }),
      });
      if (res.ok) {
        router.refresh();
      }
    } catch {
      // Toolbar action — user can retry
    } finally {
      setLoading(false);
    }
  }, [contentId, slug, router]);

  return (
    <button
      onClick={handleUnpublish}
      disabled={loading}
      className="text-xs bg-amber-600 px-3 py-1 rounded hover:bg-amber-700 disabled:opacity-50 text-white font-medium"
    >
      {loading ? 'Unpublishing...' : 'Unpublish'}
    </button>
  );
}

export default function AdminPreviewToolbar({ content }: { content: PreviewContent }) {
  const statusColor = STATUS_COLORS[content.status] ?? STATUS_COLORS.draft;

  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-gray-900 text-white px-4 py-2 flex items-center justify-between shadow-lg">
      <div className="flex items-center gap-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">Preview</span>
        <span className={`text-xs px-2 py-0.5 rounded font-medium ${statusColor} text-white`}>
          {content.status}
        </span>
        <span className="text-sm font-medium truncate max-w-md">{content.title}</span>
        <span className="text-xs text-gray-400">{content.contentType.replace('_', ' ')}</span>
      </div>
      <div className="flex items-center gap-2">
        <Link
          href={`/admin/content/${content.slug}`}
          className="text-xs bg-blue-600 px-3 py-1 rounded hover:bg-blue-700 font-medium"
        >
          Edit
        </Link>
        {content.status !== 'published' && (
          <PublishButton contentId={content.id} slug={content.slug} />
        )}
        {content.status === 'published' && (
          <UnpublishButton contentId={content.id} slug={content.slug} />
        )}
      </div>
    </div>
  );
}
