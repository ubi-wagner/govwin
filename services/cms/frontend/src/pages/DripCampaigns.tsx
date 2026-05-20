import { useEffect, useState } from 'react'
import { api } from '../lib/api'

interface DripSequenceStep {
  id: string
  step_number: number
  template_id: string | null
  subject_override: string | null
  body_override: string | null
  delay_hours: number
  delay_from: string
  condition_filter: Record<string, unknown>
  created_at: string
}

interface DripCampaign {
  id: string
  name: string
  description: string | null
  campaign_type: string
  status: string
  trigger_event: string | null
  trigger_delay_hours: number | null
  total_sent: number
  total_opened: number
  created_at: string
}

const statusColors: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600',
  active: 'bg-green-100 text-green-700',
  paused: 'bg-amber-100 text-amber-700',
  completed: 'bg-blue-100 text-blue-700',
  cancelled: 'bg-slate-100 text-slate-600',
}

export default function DripCampaigns() {
  const [campaigns, setCampaigns] = useState<DripCampaign[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [steps, setSteps] = useState<Record<string, DripSequenceStep[]>>({})
  const [stepsLoading, setStepsLoading] = useState<string | null>(null)

  useEffect(() => {
    api.get<DripCampaign[]>('/email/campaigns?campaign_type=drip')
      .then(setCampaigns)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  async function toggleExpand(campaignId: string) {
    if (expanded === campaignId) {
      setExpanded(null)
      return
    }
    setExpanded(campaignId)
    if (!steps[campaignId]) {
      setStepsLoading(campaignId)
      try {
        const data = await api.get<DripSequenceStep[]>(`/drip/campaigns/${campaignId}/sequences`)
        setSteps((prev) => ({ ...prev, [campaignId]: data }))
      } catch {
        setSteps((prev) => ({ ...prev, [campaignId]: [] }))
      } finally {
        setStepsLoading(null)
      }
    }
  }

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
                onClick={() => toggleExpand(c.id)}
                className="w-full p-4 flex items-center justify-between text-left"
              >
                <div>
                  <div className="font-medium text-slate-900">{c.name}</div>
                  <div className="text-sm text-gray-500 mt-1">
                    Trigger: {c.trigger_event ?? 'none'} | Sent: {c.total_sent}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${statusColors[c.status] || 'bg-gray-100 text-gray-600'}`}>
                    {c.status}
                  </span>
                  <span className="text-gray-400 text-xs">{expanded === c.id ? 'Collapse' : 'Expand'}</span>
                </div>
              </button>
              {expanded === c.id && (
                <div className="px-4 pb-4 border-t border-gray-100">
                  {stepsLoading === c.id ? (
                    <div className="mt-3 text-sm text-gray-500">Loading steps...</div>
                  ) : (steps[c.id] ?? []).length === 0 ? (
                    <div className="mt-3 text-sm text-gray-500">No sequence steps defined.</div>
                  ) : (
                    <div className="mt-3 space-y-2">
                      {(steps[c.id] ?? []).map((step) => (
                        <div key={step.id} className="flex items-center gap-3 text-sm">
                          <span className="w-6 h-6 bg-blue-100 text-blue-700 rounded-full flex items-center justify-center text-xs font-medium">
                            {step.step_number}
                          </span>
                          <span className="text-gray-600">
                            {step.delay_hours}h {step.delay_from === 'previous_step' ? 'after prev step' : 'after enrollment'}:
                          </span>
                          <span className="text-slate-900">{step.subject_override ?? `(template ${step.template_id?.slice(0, 8) ?? 'none'})`}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
