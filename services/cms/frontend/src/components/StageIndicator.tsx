import { Fragment } from 'react'

interface StageIndicatorProps {
  status: string
  postId: string
  onAction: (action: string) => void
  loading?: boolean
}

const STAGE_ORDER = ['draft', 'in_review', 'approved', 'published']

const STAGE_LABELS: Record<string, string> = {
  draft: 'Draft',
  in_review: 'In Review',
  approved: 'Approved',
  published: 'Published',
}

const ACTION_MAP: Record<string, Array<{ action: string; label: string; variant: 'primary' | 'danger' | 'secondary' }>> = {
  draft: [{ action: 'submit_review', label: 'Submit for Review', variant: 'primary' }],
  in_review: [
    { action: 'approve', label: 'Approve', variant: 'primary' },
    { action: 'reject', label: 'Reject', variant: 'danger' },
  ],
  approved: [{ action: 'publish', label: 'Publish', variant: 'primary' }],
  published: [{ action: 'unpublish', label: 'Unpublish', variant: 'secondary' }],
  rejected: [{ action: 'revert', label: 'Revert to Draft', variant: 'secondary' }],
  reverted: [{ action: 'submit_review', label: 'Submit for Review', variant: 'primary' }],
}

export default function StageIndicator({ status, onAction, loading }: StageIndicatorProps) {
  const currentIndex = STAGE_ORDER.indexOf(status)

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      {/* Dot pipeline */}
      <div className="flex items-center justify-center gap-0">
        {STAGE_ORDER.map((stage, i) => {
          const stageIndex = i
          const isCompleted = currentIndex > stageIndex
          const isCurrent = status === stage

          return (
            <Fragment key={stage}>
              {i > 0 && (
                <div className={`h-0.5 w-8 ${isCompleted ? 'bg-blue-600' : 'bg-gray-300'}`} />
              )}
              <div className="flex flex-col items-center">
                <div
                  className={`w-3 h-3 rounded-full border-2 ${
                    isCompleted
                      ? 'bg-blue-600 border-blue-600'
                      : isCurrent
                        ? 'bg-blue-600 border-blue-600 ring-4 ring-blue-100'
                        : 'bg-white border-gray-300'
                  }`}
                />
                <span
                  className={`text-xs mt-1 whitespace-nowrap ${
                    isCurrent ? 'font-semibold text-blue-600' : 'text-gray-500'
                  }`}
                >
                  {STAGE_LABELS[stage]}
                </span>
              </div>
            </Fragment>
          )
        })}
      </div>

      {/* Off-track status badge */}
      {!STAGE_ORDER.includes(status) && (
        <div className="flex justify-center mt-2">
          <span
            className={`text-xs px-2 py-0.5 rounded-full ${
              status === 'rejected'
                ? 'bg-red-100 text-red-700'
                : status === 'archived'
                  ? 'bg-gray-100 text-gray-600'
                  : 'bg-amber-100 text-amber-700'
            }`}
          >
            {status.replace('_', ' ')}
          </span>
        </div>
      )}

      {/* Action buttons */}
      {(ACTION_MAP[status] || []).length > 0 && (
        <div className="flex justify-center gap-2 mt-3">
          {(ACTION_MAP[status] || []).map((btn) => (
            <button
              key={btn.action}
              onClick={() => onAction(btn.action)}
              disabled={loading}
              className={`px-4 py-1.5 text-sm rounded font-medium ${
                btn.variant === 'primary'
                  ? 'bg-blue-600 text-white hover:bg-blue-700'
                  : btn.variant === 'danger'
                    ? 'bg-red-600 text-white hover:bg-red-700'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200 border border-gray-300'
              } disabled:opacity-50`}
            >
              {btn.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
