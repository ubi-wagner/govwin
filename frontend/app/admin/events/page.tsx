'use client'

import { useEffect, useState, useMemo } from 'react'
import type { OpportunityEvent, CustomerEvent } from '@/types'

type StreamTab = 'user' | 'system' | 'alerts'

interface AlertEvent {
  id: string
  level: 'warning' | 'error' | 'info'
  source: string
  message: string
  details: string | null
  createdAt: string
}

export default function EventsPage() {
  const [tab, setTab] = useState<StreamTab>('user')
  const [userEvents, setUserEvents] = useState<CustomerEvent[]>([])
  const [systemEvents, setSystemEvents] = useState<OpportunityEvent[]>([])
  const [alertEvents, setAlertEvents] = useState<AlertEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [autoRefresh, setAutoRefresh] = useState(false)

  const loadEvents = () => {
    setLoading(true)
    setError(null)

    const endpoints: Record<StreamTab, string> = {
      user: '/api/events?stream=user',
      system: '/api/events?stream=system',
      alerts: '/api/events?stream=alerts',
    }

    fetch(endpoints[tab])
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then(d => {
        if (tab === 'user') setUserEvents(d.data ?? [])
        else if (tab === 'system') setSystemEvents(d.data ?? [])
        else setAlertEvents(d.data ?? [])
      })
      .catch(err => setError(err.message ?? 'Failed to load events'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadEvents() }, [tab])

  useEffect(() => {
    if (!autoRefresh) return
    const id = setInterval(loadEvents, 15000)
    return () => clearInterval(id)
  }, [autoRefresh, tab])

  const tabConfig: { key: StreamTab; label: string; icon: React.ReactNode; description: string }[] = [
    { key: 'user', label: 'User Events', icon: <UserIcon />, description: 'Customer actions, pipeline updates, account changes' },
    { key: 'system', label: 'System & Automation', icon: <CpuIcon />, description: 'Ingest, scoring, file processing events' },
    { key: 'alerts', label: 'Warnings & Errors', icon: <AlertTriangleIcon />, description: 'System warnings, errors, and informational notices' },
  ]

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Event Streams</h1>
          <p className="mt-1 text-sm text-gray-500">Real-time monitoring of platform activity</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold transition-all ${
              autoRefresh
                ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
                : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
            }`}
          >
            <span className="relative flex h-2 w-2">
              {autoRefresh && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-50" />}
              <span className={`relative inline-flex h-2 w-2 rounded-full ${autoRefresh ? 'bg-emerald-500' : 'bg-gray-400'}`} />
            </span>
            {autoRefresh ? 'Live' : 'Paused'}
          </button>
          <button onClick={loadEvents} disabled={loading} className="btn-secondary text-sm gap-2">
            <svg className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182" />
            </svg>
            Refresh
          </button>
        </div>
      </div>

      {/* Stream Tabs */}
      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {tabConfig.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`card text-left transition-all ${
              tab === t.key ? 'ring-2 ring-brand-500 border-brand-200' : 'hover:border-gray-300'
            }`}
          >
            <div className="flex items-center gap-3">
              <div className={`flex h-9 w-9 items-center justify-center rounded-xl transition-colors ${
                tab === t.key ? 'bg-brand-100 text-brand-600' : 'bg-gray-100 text-gray-500'
              }`}>
                {t.icon}
              </div>
              <div>
                <p className="text-sm font-bold text-gray-900">{t.label}</p>
                <p className="text-[11px] text-gray-500">{t.description}</p>
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="mt-6 relative">
        <svg className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
        </svg>
        <input
          type="text"
          placeholder="Search events..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="input pl-10"
        />
      </div>

      {/* Error */}
      {error && (
        <div className="mt-4 card border-red-200 bg-red-50">
          <div className="flex items-center gap-3">
            <svg className="h-5 w-5 text-red-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
            </svg>
            <p className="flex-1 text-sm text-red-700">{error}</p>
            <button onClick={loadEvents} className="btn-secondary text-xs">Retry</button>
          </div>
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="mt-6 space-y-3">
          {[...Array(8)].map((_, i) => <div key={i} className="card animate-pulse h-16" />)}
        </div>
      ) : tab === 'user' ? (
        <UserEventStream events={userEvents} search={search} />
      ) : tab === 'system' ? (
        <SystemEventStream events={systemEvents} search={search} />
      ) : (
        <AlertEventStream events={alertEvents} search={search} />
      )}
    </div>
  )
}

/* ─── User Event Stream ──────────────────────────────────── */

function UserEventStream({ events, search }: { events: CustomerEvent[]; search: string }) {
  const filtered = useMemo(() => {
    if (!search.trim()) return events
    const q = search.toLowerCase()
    return events.filter(e =>
      e.eventType.toLowerCase().includes(q) ||
      (e.description?.toLowerCase().includes(q) ?? false) ||
      e.tenantId.toLowerCase().includes(q)
    )
  }, [events, search])

  if (filtered.length === 0) {
    return <EmptyState icon={<UserIcon />} message={search ? 'No user events match your search' : 'No user events recorded yet'} />
  }

  return (
    <div className="mt-6 space-y-2">
      {filtered.map(e => (
        <div key={e.id} className="card hover:shadow-card-hover transition-all group">
          <div className="flex items-start gap-4">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
              <EventTypeIcon type={e.eventType} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="badge-blue">{formatEventNamespace(e.eventType)}</span>
                <span className="text-xs font-medium text-gray-700">{formatEventAction(e.eventType)}</span>
                {e.processed && <span className="badge-green">Processed</span>}
              </div>
              {e.description && (
                <p className="mt-1.5 text-sm text-gray-600 truncate">{e.description}</p>
              )}
              <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-gray-400">
                <span>Tenant: {e.tenantId.slice(0, 8)}</span>
                {e.userId && <span>User: {e.userId.slice(0, 8)}</span>}
                {e.opportunityId && <span>Opp: {e.opportunityId.slice(0, 8)}</span>}
                <span>{formatTimestamp(e.createdAt)}</span>
              </div>
            </div>
            <span className="text-xs text-gray-400 shrink-0">{formatRelative(e.createdAt)}</span>
          </div>
        </div>
      ))}
      <EventCount count={filtered.length} total={events.length} />
    </div>
  )
}

/* ─── System Event Stream ────────────────────────────────── */

function SystemEventStream({ events, search }: { events: OpportunityEvent[]; search: string }) {
  const filtered = useMemo(() => {
    if (!search.trim()) return events
    const q = search.toLowerCase()
    return events.filter(e =>
      e.eventType.toLowerCase().includes(q) ||
      e.source.toLowerCase().includes(q) ||
      e.opportunityId.toLowerCase().includes(q)
    )
  }, [events, search])

  if (filtered.length === 0) {
    return <EmptyState icon={<CpuIcon />} message={search ? 'No system events match your search' : 'No system events recorded yet'} />
  }

  return (
    <div className="mt-6 space-y-2">
      {filtered.map(e => (
        <div key={e.id} className="card hover:shadow-card-hover transition-all group">
          <div className="flex items-start gap-4">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-violet-600">
              <SystemTypeIcon type={e.eventType} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="badge-purple">{formatEventNamespace(e.eventType)}</span>
                <span className="text-xs font-medium text-gray-700">{formatEventAction(e.eventType)}</span>
                <span className="badge-gray">{e.source}</span>
                {e.processed && <span className="badge-green">Processed</span>}
              </div>
              {e.fieldChanged && (
                <div className="mt-1.5 flex items-center gap-2 text-xs">
                  <span className="text-gray-500">Field:</span>
                  <code className="rounded bg-gray-100 px-1.5 py-0.5 text-gray-600">{e.fieldChanged}</code>
                  {e.oldValue && (
                    <>
                      <span className="text-red-400 line-through">{e.oldValue.slice(0, 30)}</span>
                      <span className="text-gray-300">&rarr;</span>
                      <span className="text-emerald-600">{e.newValue?.slice(0, 30)}</span>
                    </>
                  )}
                </div>
              )}
              <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-gray-400">
                <span>Opp: {e.opportunityId.slice(0, 8)}</span>
                {e.processedBy && <span>By: {e.processedBy}</span>}
                <span>{formatTimestamp(e.createdAt)}</span>
              </div>
            </div>
            <span className="text-xs text-gray-400 shrink-0">{formatRelative(e.createdAt)}</span>
          </div>
        </div>
      ))}
      <EventCount count={filtered.length} total={events.length} />
    </div>
  )
}

/* ─── Alert Event Stream ─────────────────────────────────── */

function AlertEventStream({ events, search }: { events: AlertEvent[]; search: string }) {
  const filtered = useMemo(() => {
    if (!search.trim()) return events
    const q = search.toLowerCase()
    return events.filter(e =>
      e.message.toLowerCase().includes(q) ||
      e.source.toLowerCase().includes(q) ||
      e.level.includes(q)
    )
  }, [events, search])

  if (filtered.length === 0) {
    return <EmptyState icon={<AlertTriangleIcon />} message={search ? 'No alerts match your search' : 'No warnings or errors recorded'} />
  }

  const levelConfig: Record<string, { bg: string; border: string; iconBg: string; iconColor: string }> = {
    error:   { bg: 'bg-red-50/50',    border: 'border-red-200',    iconBg: 'bg-red-100',    iconColor: 'text-red-600' },
    warning: { bg: 'bg-amber-50/50',  border: 'border-amber-200',  iconBg: 'bg-amber-100',  iconColor: 'text-amber-600' },
    info:    { bg: 'bg-blue-50/50',   border: 'border-blue-200',   iconBg: 'bg-blue-100',   iconColor: 'text-blue-600' },
  }

  return (
    <div className="mt-6 space-y-2">
      {filtered.map(e => {
        const c = levelConfig[e.level] ?? levelConfig.info
        return (
          <div key={e.id} className={`card ${c.bg} ${c.border} hover:shadow-card-hover transition-all`}>
            <div className="flex items-start gap-4">
              <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${c.iconBg} ${c.iconColor}`}>
                {e.level === 'error' ? <ErrorCircleIcon /> : e.level === 'warning' ? <AlertTriangleIcon /> : <InfoIcon />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <LevelBadge level={e.level} />
                  <span className="badge-gray">{e.source}</span>
                </div>
                <p className="mt-1.5 text-sm font-medium text-gray-800">{e.message}</p>
                {e.details && (
                  <p className="mt-1 text-xs text-gray-500 truncate">{e.details}</p>
                )}
                <p className="mt-2 text-[11px] text-gray-400">{formatTimestamp(e.createdAt)}</p>
              </div>
              <span className="text-xs text-gray-400 shrink-0">{formatRelative(e.createdAt)}</span>
            </div>
          </div>
        )
      })}
      <EventCount count={filtered.length} total={events.length} />
    </div>
  )
}

/* ─── Sub-components ──────────────────────────────────────── */

function LevelBadge({ level }: { level: string }) {
  const styles: Record<string, string> = {
    error: 'badge-red', warning: 'badge-yellow', info: 'badge-blue',
  }
  return <span className={styles[level] ?? 'badge-gray'}>{level}</span>
}

function EmptyState({ icon, message }: { icon: React.ReactNode; message: string }) {
  return (
    <div className="mt-12 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-gray-100 text-gray-400">
        {icon}
      </div>
      <p className="mt-3 text-sm font-medium text-gray-500">{message}</p>
    </div>
  )
}

function EventCount({ count, total }: { count: number; total: number }) {
  return (
    <div className="text-center py-3">
      <p className="text-xs text-gray-400">
        Showing {count}{count < total ? ` of ${total}` : ''} events
      </p>
    </div>
  )
}

function EventTypeIcon({ type }: { type: string }) {
  if (type.startsWith('finder.')) return <SearchIcon />
  if (type.startsWith('reminder.')) return <BellIcon />
  if (type.startsWith('binder.')) return <FolderIcon />
  if (type.startsWith('grinder.')) return <DocumentIcon />
  if (type.startsWith('account.')) return <UserIcon />
  return <ActivityIcon />
}

function SystemTypeIcon({ type }: { type: string }) {
  if (type.startsWith('ingest.')) return <DownloadIcon />
  if (type.startsWith('scoring.')) return <ChartIcon />
  if (type.startsWith('drive.')) return <CloudIcon />
  return <CpuIcon />
}

/* ─── Helpers ────────────────────────────────────────────── */

function formatEventNamespace(type: string): string {
  return type.split('.')[0] ?? type
}

function formatEventAction(type: string): string {
  const action = type.split('.').slice(1).join('.')
  return action.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
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

/* ─── SVG Icons ──────────────────────────────────────────── */

function UserIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
    </svg>
  )
}

function CpuIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 3v1.5M4.5 8.25H3M21 8.25h-1.5M4.5 12H3m18 0h-1.5m-15 3.75H3M21 15.75h-1.5M8.25 19.5V21M12 3v1.5m0 15V21m3.75-18v1.5m0 15V21m-9-1.5h10.5a2.25 2.25 0 0 0 2.25-2.25V6.75a2.25 2.25 0 0 0-2.25-2.25H6.75A2.25 2.25 0 0 0 4.5 6.75v10.5a2.25 2.25 0 0 0 2.25 2.25Zm.75-12h9v9h-9v-9Z" />
    </svg>
  )
}

function AlertTriangleIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
    </svg>
  )
}

function ActivityIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3v11.25A2.25 2.25 0 0 0 6 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0 1 18 16.5h-2.25m-7.5 0h7.5m-7.5 0-1 3m8.5-3 1 3m0 0 .5 1.5m-.5-1.5h-9.5m0 0-.5 1.5M9 11.25v1.5M12 9v3.75m3-6v6" />
    </svg>
  )
}

function SearchIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
    </svg>
  )
}

function BellIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" />
    </svg>
  )
}

function FolderIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z" />
    </svg>
  )
}

function DocumentIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
    </svg>
  )
}

function DownloadIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
    </svg>
  )
}

function ChartIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
    </svg>
  )
}

function CloudIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15a4.5 4.5 0 0 0 4.5 4.5H18a3.75 3.75 0 0 0 1.332-7.257 3 3 0 0 0-3.758-3.848 5.25 5.25 0 0 0-10.233 2.33A4.502 4.502 0 0 0 2.25 15Z" />
    </svg>
  )
}

function ErrorCircleIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="m9.75 9.75 4.5 4.5m0-4.5-4.5 4.5M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
    </svg>
  )
}

function InfoIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z" />
    </svg>
  )
}
