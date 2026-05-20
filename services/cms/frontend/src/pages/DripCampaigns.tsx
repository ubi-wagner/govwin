import { useEffect, useState } from 'react'
import { api } from '../lib/api'

interface DripStep {
  id: string
  day_offset: number
  subject: string
  template_id: string
}

interface DripCampaign {
  id: string
  name: string
  status: string
  trigger_event: string
  steps: DripStep[]
  created_at: string
}

const statusColors: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600',
  active: 'bg-green-100 text-green-700',
  paused: 'bg-amber-100 text-amber-700',
  archived: 'bg-slate-100 text-slate-600',
}

export default function DripCampaigns() {
  const [campaigns, setCampaigns] = useState<DripCampaign[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => {
    api.get<DripCampaign[]>('/drip/campaigns')
      .then(setCampaigns)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900 mb-6">Drip Campaigns</h1>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">{error}</div>
      )}

      {loading ? (
        <div className="text-gray-500">Loading drip campaigns...</div>
      ) : campaigns.length === 0 ? (
        <div className="text-gray-500 bg-white border border-gray-200 rounded-lg p-8 text-center">
          No drip campaigns configured yet.
        </div>
      ) : (
        <div className="space-y-3">
          {campaigns.map((c) => (
            <div key={c.id} className="bg-white border border-gray-200 rounded-lg">
              <button
                onClick={() => setExpanded(expanded === c.id ? null : c.id)}
                className="w-full p-4 flex items-center justify-between text-left"
              >
                <div>
                  <div className="font-medium text-slate-900">{c.name}</div>
                  <div className="text-sm text-gray-500 mt-1">
                    Trigger: {c.trigger_event} | {c.steps?.length ?? 0} steps
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${statusColors[c.status] || 'bg-gray-100 text-gray-600'}`}>
                    {c.status}
                  </span>
                  <span className="text-gray-400 text-xs">{expanded === c.id ? 'Collapse' : 'Expand'}</span>
                </div>
              </button>
              {expanded === c.id && c.steps && c.steps.length > 0 && (
                <div className="px-4 pb-4 border-t border-gray-100">
                  <div className="mt-3 space-y-2">
                    {c.steps.map((step, i) => (
                      <div key={step.id} className="flex items-center gap-3 text-sm">
                        <span className="w-6 h-6 bg-blue-100 text-blue-700 rounded-full flex items-center justify-center text-xs font-medium">
                          {i + 1}
                        </span>
                        <span className="text-gray-600">Day {step.day_offset}:</span>
                        <span className="text-slate-900">{step.subject}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
