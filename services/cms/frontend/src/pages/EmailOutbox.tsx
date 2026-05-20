import { useEffect, useState, useCallback } from 'react'
import { api } from '../lib/api'

interface OutboxSend {
  recipient_email: string
  recipient_name: string | null
  subject: string
  body_html: string | null
  body_text: string | null
  template_id: string | null
  campaign_id: string | null
  tenant_id: string | null
  user_id: string | null
  send_status: string
  original_subject: string | null
  was_modified: boolean
  account_id: string | null
}

interface OutboxItem {
  id: string
  send_id: string
  status: string
  claimed_by: string | null
  claimed_by_name: string | null
  priority: number
  category: string | null
  recipient_preview: string | null
  subject_preview: string | null
  send: OutboxSend
  created_at: string
}

export default function EmailOutbox() {
  const [items, setItems] = useState<OutboxItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    api.get<OutboxItem[]>('/email/outbox?status=pending')
      .then(setItems)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  async function handleAction(id: string, action: 'approve' | 'reject') {
    setActionLoading(id)
    try {
      if (action === 'approve') {
        await api.post(`/email/outbox/${id}/approve`, { approved_by: 'cms_admin' })
      } else {
        await api.post(`/email/outbox/${id}/reject`, { rejected_by: 'cms_admin', reason: 'Rejected from outbox UI' })
      }
      setItems((prev) => prev.filter((i) => i.id !== id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed')
    } finally {
      setActionLoading(null)
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Email Outbox (HITL)</h1>
        <button
          onClick={load}
          className="px-3 py-1.5 text-sm bg-white border border-gray-300 rounded hover:bg-gray-50"
        >
          Refresh
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">{error}</div>
      )}

      {loading ? (
        <div className="text-gray-500">Loading pending items...</div>
      ) : items.length === 0 ? (
        <div className="text-gray-500 bg-white border border-gray-200 rounded-lg p-8 text-center">
          No pending items in the outbox.
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <div key={item.id} className="bg-white border border-gray-200 rounded-lg p-4">
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-medium text-slate-900">{item.send?.subject ?? item.subject_preview}</div>
                  <div className="text-sm text-gray-500 mt-1">
                    To: {item.send ? `${item.send.recipient_name ?? ''} <${item.send.recipient_email}>` : item.recipient_preview}
                  </div>
                  {item.category && (
                    <div className="text-xs text-gray-400 mt-1">Category: {item.category}</div>
                  )}
                  {item.claimed_by_name && (
                    <div className="text-xs text-blue-500 mt-1">Claimed by: {item.claimed_by_name}</div>
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleAction(item.id, 'approve')}
                    disabled={actionLoading === item.id}
                    className="px-3 py-1.5 text-sm bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => handleAction(item.id, 'reject')}
                    disabled={actionLoading === item.id}
                    className="px-3 py-1.5 text-sm bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
                  >
                    Reject
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
