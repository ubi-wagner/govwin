'use client'

import type { ContentPost } from '@/types'
import { CATEGORY_LABELS } from './constants'

interface ReviewQueueProps {
  queue: ContentPost[]
  rejectNotes: string
  showRejectFor: string | null
  actionInProgress: boolean
  onRejectNotesChange: (v: string) => void
  onShowRejectFor: (id: string | null) => void
  onApprove: (postId: string) => void
  onReject: (postId: string, notes: string) => void
  onViewPost: (post: ContentPost) => void
}

export function ReviewQueue({
  queue, rejectNotes, showRejectFor, actionInProgress,
  onRejectNotesChange, onShowRejectFor,
  onApprove, onReject, onViewPost,
}: ReviewQueueProps) {
  return (
    <>
      <h3 className="text-sm font-bold text-gray-900 mb-3">Awaiting Review ({queue.length})</h3>
      {queue.length === 0 ? (
        <p className="text-sm text-gray-400">No posts awaiting review.</p>
      ) : (
        <div className="space-y-3">
          {queue.map(p => (
            <div key={p.id} className="rounded-xl border border-amber-200 bg-amber-50/30 p-4">
              <p className="text-sm font-semibold text-gray-900">{p.title}</p>
              <p className="text-xs text-gray-500 mt-1">{CATEGORY_LABELS[p.category]} · v{p.version}</p>
              {p.excerpt && <p className="text-xs text-gray-600 mt-2">{p.excerpt}</p>}
              <p className="text-xs text-gray-400 mt-2 line-clamp-3">
                {p.body?.slice(0, 300)}{(p.body?.length ?? 0) > 300 ? '...' : ''}
              </p>
              <div className="flex gap-2 mt-3">
                <button onClick={() => onApprove(p.id)} disabled={actionInProgress} className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50">
                  {actionInProgress ? 'Approving...' : 'Approve'}
                </button>
                {showRejectFor === p.id ? (
                  <div className="flex-1 flex gap-2">
                    <input
                      value={rejectNotes}
                      onChange={e => onRejectNotesChange(e.target.value)}
                      placeholder="Rejection reason (required)"
                      className="flex-1 rounded-lg border border-red-200 px-3 py-1.5 text-xs"
                    />
                    <button
                      onClick={() => rejectNotes.trim() && onReject(p.id, rejectNotes)}
                      disabled={!rejectNotes.trim() || actionInProgress}
                      className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-700 disabled:opacity-50"
                    >
                      Reject
                    </button>
                  </div>
                ) : (
                  <button onClick={() => onShowRejectFor(p.id)} className="rounded-lg bg-red-100 px-4 py-2 text-xs font-bold text-red-700 hover:bg-red-200">
                    Reject
                  </button>
                )}
                <button onClick={() => onViewPost(p)} className="rounded-lg bg-gray-100 px-3 py-2 text-xs font-bold text-gray-600 hover:bg-gray-200">
                  View
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
