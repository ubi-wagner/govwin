'use client'

import type { ContentPost, ContentPostStatus } from '@/types'
import { STATUS_COLORS, CATEGORIES, CATEGORY_LABELS } from './constants'
import { StatusBadge } from './status-badge'

interface PostListProps {
  posts: ContentPost[]
  loading: boolean
  error: string | null
  selectedPostId?: string
  filterStatus: string
  filterCategory: string
  onFilterStatusChange: (v: string) => void
  onFilterCategoryChange: (v: string) => void
  onSelectPost: (post: ContentPost) => void
}

export function PostList({
  posts, loading, error, selectedPostId,
  filterStatus, filterCategory,
  onFilterStatusChange, onFilterCategoryChange,
  onSelectPost,
}: PostListProps) {
  return (
    <>
      {/* Filters */}
      <div className="flex gap-2 mb-4">
        <select value={filterStatus} onChange={e => onFilterStatusChange(e.target.value)} className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs">
          <option value="">All Statuses</option>
          {(Object.keys(STATUS_COLORS) as ContentPostStatus[]).map(s => (
            <option key={s} value={s}>{s.replace('_', ' ')}</option>
          ))}
        </select>
        <select value={filterCategory} onChange={e => onFilterCategoryChange(e.target.value)} className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs">
          <option value="">All Categories</option>
          {CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
        </select>
      </div>

      {loading ? (
        <p className="text-sm text-gray-400">Loading...</p>
      ) : error ? (
        <p className="text-sm text-red-500">{error}</p>
      ) : posts.length === 0 ? (
        <p className="text-sm text-gray-400">No posts yet. Create one or generate with AI.</p>
      ) : (
        <div className="space-y-2">
          {posts.map(p => (
            <button
              key={p.id}
              onClick={() => onSelectPost(p)}
              className={`w-full text-left rounded-xl border p-4 transition-all hover:shadow-sm ${
                selectedPostId === p.id ? 'border-brand-300 bg-brand-50/30' : 'border-gray-200 bg-white hover:border-gray-300'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-900 truncate">{p.title || 'Untitled'}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {CATEGORY_LABELS[p.category]} · v{p.version} · {new Date(p.updatedAt).toLocaleDateString()}
                  </p>
                </div>
                <StatusBadge status={p.status} />
              </div>
              {p.excerpt && <p className="text-xs text-gray-500 mt-2 line-clamp-2">{p.excerpt}</p>}
            </button>
          ))}
        </div>
      )}
    </>
  )
}
