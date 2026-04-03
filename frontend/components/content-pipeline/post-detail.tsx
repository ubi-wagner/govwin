'use client'

import type { ContentPost, ContentReview, ContentCategory } from '@/types'
import { CATEGORIES, CATEGORY_LABELS } from './constants'
import { StatusBadge, ReviewActionBadge } from './status-badge'
import type { EditForm } from './use-content-pipeline'

interface PostDetailProps {
  post: ContentPost
  reviews: ContentReview[]
  editMode: boolean
  editForm: EditForm
  saving: boolean
  onClose: () => void
  onStartEdit: (post: ContentPost) => void
  onCancelEdit: () => void
  onEditFormChange: (updater: (prev: EditForm) => EditForm) => void
  onSave: () => void
  onAction: (action: string, postId: string, extra?: Record<string, unknown>) => void
}

export function PostDetail({
  post, reviews, editMode, editForm, saving,
  onClose, onStartEdit, onCancelEdit, onEditFormChange, onSave, onAction,
}: PostDetailProps) {
  return (
    <div className="lg:col-span-2 space-y-4">
      <div className="rounded-xl border border-gray-200 bg-white p-6">
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div>
            <StatusBadge status={post.status} />
            <h2 className="text-lg font-bold text-gray-900 mt-2">{post.title || 'Untitled'}</h2>
            <p className="text-xs text-gray-400 mt-1">/{post.slug} · v{post.version} · {CATEGORY_LABELS[post.category]}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Actions bar */}
        <ActionBar
          post={post}
          editMode={editMode}
          onStartEdit={() => onStartEdit(post)}
          onAction={onAction}
        />

        {editMode ? (
          <PostEditor
            form={editForm}
            saving={saving}
            onChange={onEditFormChange}
            onSave={onSave}
            onCancel={onCancelEdit}
          />
        ) : (
          <PostReadView post={post} />
        )}
      </div>

      {/* Review History */}
      {reviews.length > 0 && <ReviewHistory reviews={reviews} />}
    </div>
  )
}

function ActionBar({
  post, editMode, onStartEdit, onAction,
}: {
  post: ContentPost
  editMode: boolean
  onStartEdit: () => void
  onAction: (action: string, postId: string, extra?: Record<string, unknown>) => void
}) {
  return (
    <div className="flex flex-wrap gap-2 mb-4 pb-4 border-b border-gray-100">
      {!editMode && (
        <button onClick={onStartEdit} className="rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-bold text-gray-700 hover:bg-gray-200">
          Edit
        </button>
      )}
      {post.status === 'draft' && (
        <button onClick={() => onAction('submit_review', post.id)} className="rounded-lg bg-amber-100 px-3 py-1.5 text-xs font-bold text-amber-700 hover:bg-amber-200">
          Submit for Review
        </button>
      )}
      {post.status === 'in_review' && (
        <>
          <button onClick={() => onAction('approve', post.id)} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700">
            Approve
          </button>
          <button onClick={() => onAction('reject', post.id, { notes: 'Rejected from detail view' })} className="rounded-lg bg-red-100 px-3 py-1.5 text-xs font-bold text-red-700 hover:bg-red-200">
            Reject
          </button>
        </>
      )}
      {post.status === 'approved' && (
        <button onClick={() => onAction('publish', post.id)} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-blue-700">
          Publish
        </button>
      )}
      {post.status === 'published' && (
        <button onClick={() => onAction('unpublish', post.id)} className="rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-bold text-gray-700 hover:bg-gray-200">
          Unpublish
        </button>
      )}
      {post.version > 1 && (
        <button onClick={() => onAction('revert', post.id)} className="rounded-lg bg-orange-100 px-3 py-1.5 text-xs font-bold text-orange-700 hover:bg-orange-200">
          Revert
        </button>
      )}
      {!['published', 'archived'].includes(post.status) && (
        <button onClick={() => onAction('archive', post.id)} className="rounded-lg bg-gray-50 px-3 py-1.5 text-xs font-bold text-gray-500 hover:bg-gray-100">
          Archive
        </button>
      )}
    </div>
  )
}

function PostEditor({
  form, saving, onChange, onSave, onCancel,
}: {
  form: EditForm
  saving: boolean
  onChange: (updater: (prev: EditForm) => EditForm) => void
  onSave: () => void
  onCancel: () => void
}) {
  return (
    <div className="space-y-3">
      <div>
        <label className="text-xs font-bold text-gray-500 uppercase">Title</label>
        <input value={form.title} onChange={e => onChange(f => ({ ...f, title: e.target.value }))} className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-bold text-gray-500 uppercase">Category</label>
          <select value={form.category} onChange={e => onChange(f => ({ ...f, category: e.target.value as ContentCategory }))} className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm">
            {CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-bold text-gray-500 uppercase">Tags (comma-separated)</label>
          <input value={form.tags} onChange={e => onChange(f => ({ ...f, tags: e.target.value }))} className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" />
        </div>
      </div>
      <div>
        <label className="text-xs font-bold text-gray-500 uppercase">Excerpt</label>
        <textarea value={form.excerpt} onChange={e => onChange(f => ({ ...f, excerpt: e.target.value }))} className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm h-16 resize-none" />
      </div>
      <div>
        <label className="text-xs font-bold text-gray-500 uppercase">Body</label>
        <textarea value={form.body} onChange={e => onChange(f => ({ ...f, body: e.target.value }))} className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-mono h-64 resize-y" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-bold text-gray-500 uppercase">Meta Title</label>
          <input value={form.metaTitle} onChange={e => onChange(f => ({ ...f, metaTitle: e.target.value }))} className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="text-xs font-bold text-gray-500 uppercase">Meta Description</label>
          <input value={form.metaDescription} onChange={e => onChange(f => ({ ...f, metaDescription: e.target.value }))} className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" />
        </div>
      </div>
      <div className="flex gap-2 pt-2">
        <button onClick={onSave} disabled={saving} className="btn-primary text-sm px-4 py-2 disabled:opacity-50">
          {saving ? 'Saving...' : 'Save Draft'}
        </button>
        <button onClick={onCancel} className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-200">
          Cancel
        </button>
      </div>
    </div>
  )
}

function PostReadView({ post }: { post: ContentPost }) {
  return (
    <div>
      {post.excerpt && <p className="text-sm text-gray-600 italic mb-4">{post.excerpt}</p>}
      <div className="prose prose-sm max-w-none text-gray-700 whitespace-pre-wrap">
        {post.body || <span className="text-gray-400 italic">No content yet</span>}
      </div>
      {post.generationPrompt && (
        <div className="mt-4 rounded-lg bg-violet-50 px-4 py-3">
          <p className="text-[10px] font-bold uppercase text-violet-500">AI Generation Prompt</p>
          <p className="text-xs text-violet-700 mt-1">{post.generationPrompt}</p>
          {post.generatedByModel && <p className="text-[10px] text-violet-400 mt-1">Model: {post.generatedByModel}</p>}
        </div>
      )}
    </div>
  )
}

function ReviewHistory({ reviews }: { reviews: ContentReview[] }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <h3 className="text-sm font-bold text-gray-900 mb-3">Review History</h3>
      <div className="space-y-3">
        {reviews.map(r => (
          <div key={r.id} className="flex items-start gap-3 text-xs">
            <ReviewActionBadge action={r.action} />
            <div>
              <p className="text-gray-600">v{r.versionAtReview} · {new Date(r.createdAt).toLocaleString()}</p>
              {r.notes && <p className="text-gray-500 mt-0.5">{r.notes}</p>}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
