'use client'

import type { ContentPostStatus, ContentCategory } from '@/types'
import { STATUS_COLORS, CATEGORY_LABELS } from './constants'

export function StatusBadge({ status }: { status: ContentPostStatus }) {
  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${STATUS_COLORS[status]}`}>
      {status.replace('_', ' ')}
    </span>
  )
}

export function CategoryLabel({ category }: { category: ContentCategory }) {
  return <>{CATEGORY_LABELS[category]}</>
}

export function GenerationStatusBadge({ status }: { status: string }) {
  const style =
    status === 'completed' ? 'bg-emerald-100 text-emerald-700' :
    status === 'failed' ? 'bg-red-100 text-red-700' :
    status === 'accepted' ? 'bg-blue-100 text-blue-700' :
    'bg-gray-100 text-gray-600'

  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${style}`}>
      {status}
    </span>
  )
}

export function ReviewActionBadge({ action }: { action: string }) {
  const style =
    action === 'approve' || action === 'publish' ? 'bg-emerald-100 text-emerald-700' :
    action === 'reject' ? 'bg-red-100 text-red-700' :
    'bg-gray-100 text-gray-600'

  return (
    <span className={`shrink-0 mt-0.5 rounded-full px-2 py-0.5 font-bold uppercase ${style}`}>
      {action.replace('_', ' ')}
    </span>
  )
}
