'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'

type ViewTab = 'rules' | 'log'

interface AutomationRule {
  id: string
  name: string
  description: string | null
  triggerBus: string
  triggerEvents: string[]
  conditions: Record<string, unknown>
  actionType: string
  actionConfig: Record<string, unknown>
  enabled: boolean
  priority: number
  cooldownSeconds: number
  maxFiresPerHour: number
  createdAt: string
  updatedAt: string
  totalFires: number
  totalSkips: number
  lastFiredAt: string | null
}

interface AutomationLogEntry {
  id: string
  ruleId: string | null
  ruleName: string
  triggerEventId: string | null
  triggerEventType: string
  triggerBus: string
  fired: boolean
  skipReason: string | null
  actionType: string | null
  actionResult: Record<string, unknown> | null
  eventMetadata: Record<string, unknown> | null
  correlationId: string | null
  createdAt: string
}

export default function AutomationPage() {
  const [tab, setTab] = useState<ViewTab>('rules')
  const [rules, setRules] = useState<AutomationRule[]>([])
  const [logEntries, setLogEntries] = useState<AutomationLogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [firedFilter, setFiredFilter] = useState<string>('')
  const [toggling, setToggling] = useState<string | null>(null)

  const loadData = useCallback(() => {
    setLoading(true)
    setError(null)

    let url = `/api/automation?view=${tab}`
    if (tab === 'log' && firedFilter) url += `&fired=${firedFilter}`

    fetch(url)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then(d => {
        if (tab === 'rules') setRules(d.data ?? [])
        else setLogEntries(d.data ?? [])
      })
      .catch(err => setError(err instanceof Error ? err.message : 'Failed to load'))
      .finally(() => setLoading(false))
  }, [tab, firedFilter])

  useEffect(() => { loadData() }, [loadData])

  const toggleRule = async (ruleId: string, enabled: boolean) => {
    setToggling(ruleId)
    try {
      const r = await fetch('/api/automation', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ruleId, enabled }),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      setRules(prev => prev.map(rule =>
        rule.id === ruleId ? { ...rule, enabled } : rule
      ))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to toggle')
    } finally {
      setToggling(null)
    }
  }

  const filteredRules = useMemo(() => {
    if (!search.trim()) return rules
    const q = search.toLowerCase()
    return rules.filter(r =>
      r.name.toLowerCase().includes(q) ||
      (r.description?.toLowerCase().includes(q) ?? false) ||
      r.actionType.toLowerCase().includes(q) ||
      r.triggerEvents.some(e => e.toLowerCase().includes(q))
    )
  }, [rules, search])

  const filteredLog = useMemo(() => {
    if (!search.trim()) return logEntries
    const q = search.toLowerCase()
    return logEntries.filter(e =>
      e.ruleName.toLowerCase().includes(q) ||
      e.triggerEventType.toLowerCase().includes(q) ||
      (e.skipReason?.toLowerCase().includes(q) ?? false)
    )
  }, [logEntries, search])

  const actionTypeColors: Record<string, string> = {
    emit_event: 'badge-purple',
    queue_notification: 'badge-blue',
    queue_job: 'badge-yellow',
    log_only: 'badge-gray',
  }

  const busColors: Record<string, string> = {
    customer_events: 'text-blue-600',
    opportunity_events: 'text-violet-600',
    content_events: 'text-teal-600',
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Automation</h1>
          <p className="mt-1 text-sm text-gray-500">Event-driven rules engine — triggers, conditions, and actions</p>
        </div>
        <button onClick={loadData} disabled={loading} className="btn-secondary text-sm gap-2">
          <svg className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182" />
          </svg>
          Refresh
        </button>
      </div>

      {/* Tabs */}
      <div className="mt-6 grid grid-cols-2 gap-3">
        <button
          onClick={() => setTab('rules')}
          className={`card text-left transition-all ${tab === 'rules' ? 'ring-2 ring-brand-500 border-brand-200' : 'hover:border-gray-300'}`}
        >
          <div className="flex items-center gap-3">
            <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${tab === 'rules' ? 'bg-brand-100 text-brand-600' : 'bg-gray-100 text-gray-500'}`}>
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="m3.75 13.5 10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75Z" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-bold text-gray-900">Rules ({rules.length})</p>
              <p className="text-[11px] text-gray-500">Active automation rules and their configs</p>
            </div>
          </div>
        </button>
        <button
          onClick={() => setTab('log')}
          className={`card text-left transition-all ${tab === 'log' ? 'ring-2 ring-brand-500 border-brand-200' : 'hover:border-gray-300'}`}
        >
          <div className="flex items-center gap-3">
            <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${tab === 'log' ? 'bg-brand-100 text-brand-600' : 'bg-gray-100 text-gray-500'}`}>
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-bold text-gray-900">Execution Log</p>
              <p className="text-[11px] text-gray-500">Rule evaluation history — fires and skips</p>
            </div>
          </div>
        </button>
      </div>

      {/* Filters */}
      <div className="mt-6 flex gap-3">
        <div className="relative flex-1">
          <svg className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
          </svg>
          <input type="text" placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} className="input pl-10" />
        </div>
        {tab === 'log' && (
          <select value={firedFilter} onChange={e => setFiredFilter(e.target.value)} className="input w-auto min-w-[140px]">
            <option value="">All outcomes</option>
            <option value="true">Fired only</option>
            <option value="false">Skipped only</option>
          </select>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="mt-4 card border-red-200 bg-red-50">
          <div className="flex items-center gap-3">
            <p className="flex-1 text-sm text-red-700">{error}</p>
            <button onClick={loadData} className="btn-secondary text-xs">Retry</button>
          </div>
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="mt-6 space-y-3">
          {[...Array(6)].map((_, i) => <div key={i} className="card animate-pulse h-20" />)}
        </div>
      ) : tab === 'rules' ? (
        <div className="mt-6 space-y-3">
          {filteredRules.length === 0 ? (
            <div className="mt-12 text-center">
              <p className="text-sm text-gray-500">No automation rules found</p>
            </div>
          ) : filteredRules.map(rule => (
            <div key={rule.id} className={`card transition-all ${!rule.enabled ? 'opacity-60' : ''}`}>
              <div className="flex items-start gap-4">
                {/* Toggle */}
                <button
                  onClick={() => toggleRule(rule.id, !rule.enabled)}
                  disabled={toggling === rule.id}
                  className={`mt-1 relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors ${
                    rule.enabled ? 'bg-emerald-500' : 'bg-gray-300'
                  }`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform mt-0.5 ${
                    rule.enabled ? 'translate-x-4 ml-0.5' : 'translate-x-0.5'
                  }`} />
                </button>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-bold text-gray-900">{rule.name}</span>
                    <span className={actionTypeColors[rule.actionType] ?? 'badge-gray'}>{rule.actionType.replace('_', ' ')}</span>
                    <span className={`text-[10px] font-medium ${busColors[rule.triggerBus] ?? 'text-gray-400'}`}>
                      {rule.triggerBus.replace('_events', '')}
                    </span>
                    <span className="text-[10px] text-gray-400">P{rule.priority}</span>
                  </div>
                  {rule.description && (
                    <p className="mt-1 text-xs text-gray-500">{rule.description}</p>
                  )}
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {(rule.triggerEvents ?? []).map((e: string) => (
                      <code key={e} className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600">{e}</code>
                    ))}
                  </div>
                  <div className="mt-2 flex gap-4 text-[11px] text-gray-400">
                    <span className="text-emerald-600 font-medium">{rule.totalFires ?? 0} fires</span>
                    <span>{rule.totalSkips ?? 0} skips</span>
                    {rule.lastFiredAt && <span>Last: {formatRelative(rule.lastFiredAt)}</span>}
                    {rule.cooldownSeconds > 0 && <span>Cooldown: {rule.cooldownSeconds}s</span>}
                    {rule.maxFiresPerHour > 0 && <span>Max: {rule.maxFiresPerHour}/hr</span>}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-6 space-y-2">
          {filteredLog.length === 0 ? (
            <div className="mt-12 text-center">
              <p className="text-sm text-gray-500">No automation log entries found</p>
            </div>
          ) : filteredLog.map(entry => (
            <LogEntry key={entry.id} entry={entry} />
          ))}
          <div className="text-center py-3">
            <p className="text-xs text-gray-400">Showing {filteredLog.length} entries</p>
          </div>
        </div>
      )}
    </div>
  )
}

function LogEntry({ entry }: { entry: AutomationLogEntry }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className={`card transition-all ${entry.fired ? 'border-l-2 border-l-emerald-400' : 'border-l-2 border-l-gray-200'}`}>
      <div className="flex items-start gap-4">
        <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
          entry.fired ? 'bg-emerald-50 text-emerald-600' : 'bg-gray-50 text-gray-400'
        }`}>
          {entry.fired ? (
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m3.75 13.5 10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75Z" />
            </svg>
          ) : (
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 0 0 5.636 5.636m12.728 12.728A9 9 0 0 1 5.636 5.636m12.728 12.728L5.636 5.636" />
            </svg>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-bold text-gray-900">{entry.ruleName}</span>
            {entry.fired ? (
              <span className="badge-green">fired</span>
            ) : (
              <span className="badge-gray">skipped</span>
            )}
            <code className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600">{entry.triggerEventType}</code>
            {entry.actionType && <span className="text-[10px] text-violet-500">{entry.actionType}</span>}
          </div>
          {entry.skipReason && (
            <p className="mt-1 text-[11px] text-amber-600">{entry.skipReason}</p>
          )}
          <div className="mt-1 flex gap-3 text-[11px] text-gray-400">
            <span>{formatTimestamp(entry.createdAt)}</span>
            {entry.correlationId && <span>chain: {entry.correlationId.slice(0, 8)}</span>}
          </div>

          {/* Expandable detail */}
          {(entry.actionResult || entry.eventMetadata) && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="mt-1.5 flex items-center gap-1 text-[11px] text-gray-400 hover:text-gray-600"
            >
              <svg className={`h-3 w-3 transition-transform ${expanded ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
              </svg>
              {expanded ? 'Hide' : 'Details'}
            </button>
          )}
          {expanded && (
            <div className="mt-2 space-y-2">
              {entry.actionResult && (
                <div>
                  <span className="text-[10px] font-medium text-gray-500">Action Result:</span>
                  <pre className="mt-1 rounded bg-gray-50 border p-2 text-[11px] text-gray-700 overflow-x-auto">
                    {JSON.stringify(entry.actionResult, null, 2)}
                  </pre>
                </div>
              )}
              {entry.eventMetadata && (
                <div>
                  <span className="text-[10px] font-medium text-gray-500">Event Metadata:</span>
                  <pre className="mt-1 rounded bg-gray-50 border p-2 text-[11px] text-gray-700 overflow-x-auto">
                    {JSON.stringify(entry.eventMetadata, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
        <span className="text-xs text-gray-400 shrink-0">{formatRelative(entry.createdAt)}</span>
      </div>
    </div>
  )
}

function formatTimestamp(d: string): string {
  return new Date(d).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

function formatRelative(d: string): string {
  const diff = Date.now() - new Date(d).getTime()
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}
