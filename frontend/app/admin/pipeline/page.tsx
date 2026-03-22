'use client'

import { useEffect, useState } from 'react'
import type { PipelineJob, PipelineSchedule } from '@/types'

type Tab = 'jobs' | 'schedules' | 'runs'

export default function PipelinePage() {
  const [tab, setTab] = useState<Tab>('jobs')
  const [jobs, setJobs] = useState<PipelineJob[]>([])
  const [schedules, setSchedules] = useState<PipelineSchedule[]>([])
  const [runs, setRuns] = useState<RunRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [triggering, setTriggering] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmTrigger, setConfirmTrigger] = useState<{ source: string; runType: string } | null>(null)

  useEffect(() => { loadData() }, [tab])

  function loadData() {
    setLoading(true)
    setError(null)
    const view = tab === 'jobs' ? 'jobs' : tab === 'schedules' ? 'schedules' : 'runs'
    fetch(`/api/pipeline?view=${view}`)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then(d => {
        if (tab === 'jobs') setJobs(d.data ?? [])
        else if (tab === 'schedules') setSchedules(d.data ?? [])
        else setRuns(d.data ?? [])
      })
      .catch(err => setError(err.message ?? 'Failed to load pipeline data'))
      .finally(() => setLoading(false))
  }

  async function triggerJob(source: string, runType = 'full') {
    setTriggering(true)
    setConfirmTrigger(null)
    try {
      const res = await fetch('/api/pipeline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source, runType }),
      })
      if (!res.ok) {
        setError(`Failed to trigger job: HTTP ${res.status}`)
        return
      }
      setTab('jobs')
      loadData()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Network error triggering job'
      setError(message)
    } finally {
      setTriggering(false)
    }
  }

  async function toggleSchedule(id: string, enabled: boolean) {
    try {
      const res = await fetch('/api/pipeline/schedules', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, enabled }),
      })
      if (!res.ok) {
        setError(`Failed to toggle schedule: HTTP ${res.status}`)
        return
      }
      loadData()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Network error toggling schedule'
      setError(message)
    }
  }

  // Count stats from jobs
  const pendingCount = jobs.filter(j => j.status === 'pending').length
  const runningCount = jobs.filter(j => j.status === 'running').length
  const failedCount = jobs.filter(j => j.status === 'failed').length
  const completedCount = jobs.filter(j => j.status === 'completed').length

  const tabConfig: { key: Tab; label: string; icon: React.ReactNode; count?: number }[] = [
    { key: 'jobs', label: 'Job Queue', icon: <QueueIcon />, count: pendingCount + runningCount },
    { key: 'schedules', label: 'Schedules', icon: <CalendarIcon />, count: schedules.length },
    { key: 'runs', label: 'Run History', icon: <HistoryIcon />, count: runs.length },
  ]

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Pipeline</h1>
          <p className="mt-1 text-sm text-gray-500">Job queue, automated schedules, and run history</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setConfirmTrigger({ source: 'sam_gov', runType: 'full' })}
            disabled={triggering}
            className="btn-primary text-sm gap-2"
          >
            <PlayIcon />
            {triggering ? 'Triggering...' : 'Run SAM.gov'}
          </button>
          <button
            onClick={() => setConfirmTrigger({ source: 'scoring', runType: 'score' })}
            disabled={triggering}
            className="btn-secondary text-sm gap-2"
          >
            <RefreshIcon />
            Re-score All
          </button>
        </div>
      </div>

      {/* Confirm Trigger Modal */}
      {confirmTrigger && (
        <div className="modal-overlay flex items-center justify-center" onClick={() => setConfirmTrigger(null)}>
          <div className="modal-panel w-full max-w-sm mx-4 p-6" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-gray-900">Confirm Pipeline Run</h3>
            <p className="mt-2 text-sm text-gray-500">
              This will trigger a <span className="font-semibold text-gray-700">{confirmTrigger.runType}</span> run
              for <span className="font-semibold text-gray-700">{formatSource(confirmTrigger.source)}</span>.
            </p>
            <div className="mt-5 flex justify-end gap-3">
              <button onClick={() => setConfirmTrigger(null)} className="btn-secondary text-sm">Cancel</button>
              <button
                onClick={() => triggerJob(confirmTrigger.source, confirmTrigger.runType)}
                className="btn-primary text-sm"
              >
                Confirm & Run
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Stats Row */}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <PipelineStat label="Pending" value={pendingCount} color="amber" icon={<ClockIcon />} />
        <PipelineStat label="Running" value={runningCount} color="blue" icon={<SpinnerIcon />} />
        <PipelineStat label="Completed" value={completedCount} color="emerald" icon={<CheckIcon />} />
        <PipelineStat label="Failed" value={failedCount} color="red" icon={<XIcon />} />
      </div>

      {/* Tabs */}
      <div className="mt-8 flex gap-1 rounded-2xl bg-surface-50 p-1.5 border border-gray-200/80">
        {tabConfig.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all duration-200 ${
              tab === t.key
                ? 'bg-white text-gray-900 shadow-card'
                : 'text-gray-500 hover:text-gray-700 hover:bg-white/50'
            }`}
          >
            {t.icon}
            {t.label}
            {(t.count ?? 0) > 0 && (
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                tab === t.key ? 'bg-brand-100 text-brand-700' : 'bg-gray-200 text-gray-600'
              }`}>
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div className="mt-4 card border-red-200 bg-red-50">
          <div className="flex items-center gap-3">
            <svg className="h-5 w-5 text-red-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
            </svg>
            <p className="flex-1 text-sm text-red-700">{error}</p>
            <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="mt-6 space-y-3">
          {[...Array(5)].map((_, i) => <div key={i} className="card animate-pulse h-14" />)}
        </div>
      ) : tab === 'jobs' ? (
        <JobsTable jobs={jobs} />
      ) : tab === 'schedules' ? (
        <SchedulesTable schedules={schedules} onToggle={toggleSchedule} />
      ) : (
        <RunsTable runs={runs} />
      )}
    </div>
  )
}

/* ─── Data types ─────────────────────────────────────────── */

interface RunRecord {
  id: string
  source: string
  runType: string
  status: string
  opportunitiesFetched: number
  opportunitiesNew: number
  tenantsScored: number
  durationSeconds: number | null
  startedAt: string
}

/* ─── Tables ─────────────────────────────────────────────── */

function JobsTable({ jobs }: { jobs: PipelineJob[] }) {
  if (jobs.length === 0) return <EmptyState icon={<QueueIcon />} message="No pipeline jobs in the queue" />

  return (
    <div className="mt-6 overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-card">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-surface-50">
            <tr>
              <th className="px-5 py-3.5 text-left text-xs font-bold uppercase tracking-wider text-gray-500">Source</th>
              <th className="px-5 py-3.5 text-left text-xs font-bold uppercase tracking-wider text-gray-500">Type</th>
              <th className="px-5 py-3.5 text-left text-xs font-bold uppercase tracking-wider text-gray-500">Status</th>
              <th className="px-5 py-3.5 text-left text-xs font-bold uppercase tracking-wider text-gray-500">Triggered</th>
              <th className="px-5 py-3.5 text-left text-xs font-bold uppercase tracking-wider text-gray-500">By</th>
              <th className="px-5 py-3.5 text-center text-xs font-bold uppercase tracking-wider text-gray-500">Attempt</th>
              <th className="px-5 py-3.5 text-left text-xs font-bold uppercase tracking-wider text-gray-500">Error</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {jobs.map(j => (
              <tr key={j.id} className="hover:bg-surface-50 transition-colors">
                <td className="px-5 py-4">
                  <div className="flex items-center gap-2.5">
                    <SourceDot status={j.status} />
                    <span className="text-sm font-semibold text-gray-900">{formatSource(j.source)}</span>
                  </div>
                </td>
                <td className="px-5 py-4"><span className="badge-gray">{j.runType}</span></td>
                <td className="px-5 py-4"><JobStatusBadge status={j.status} /></td>
                <td className="px-5 py-4 text-sm text-gray-500">{formatDate(j.triggeredAt)}</td>
                <td className="px-5 py-4 text-sm text-gray-500">{j.triggeredBy}</td>
                <td className="px-5 py-4 text-center">
                  <span className="text-sm font-medium text-gray-700">{j.attempt}/{j.maxAttempts}</span>
                </td>
                <td className="px-5 py-4">
                  {j.errorMessage ? (
                    <span className="text-xs text-red-600 truncate block max-w-xs" title={j.errorMessage}>
                      {j.errorMessage}
                    </span>
                  ) : (
                    <span className="text-xs text-gray-400">-</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function SchedulesTable({ schedules, onToggle }: { schedules: PipelineSchedule[]; onToggle: (id: string, enabled: boolean) => void }) {
  if (schedules.length === 0) return <EmptyState icon={<CalendarIcon />} message="No schedules configured" />

  return (
    <div className="mt-6 overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-card">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-surface-50">
            <tr>
              <th className="px-5 py-3.5 text-left text-xs font-bold uppercase tracking-wider text-gray-500">Schedule</th>
              <th className="px-5 py-3.5 text-left text-xs font-bold uppercase tracking-wider text-gray-500">Source</th>
              <th className="px-5 py-3.5 text-left text-xs font-bold uppercase tracking-wider text-gray-500">Cron</th>
              <th className="px-5 py-3.5 text-left text-xs font-bold uppercase tracking-wider text-gray-500">Last Run</th>
              <th className="px-5 py-3.5 text-left text-xs font-bold uppercase tracking-wider text-gray-500">Next Run</th>
              <th className="px-5 py-3.5 text-left text-xs font-bold uppercase tracking-wider text-gray-500">Timeout</th>
              <th className="px-5 py-3.5 text-center text-xs font-bold uppercase tracking-wider text-gray-500">Enabled</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {schedules.map(s => (
              <tr key={s.id} className="hover:bg-surface-50 transition-colors">
                <td className="px-5 py-4 text-sm font-semibold text-gray-900">{s.displayName}</td>
                <td className="px-5 py-4 text-sm text-gray-600">{formatSource(s.source)}</td>
                <td className="px-5 py-4">
                  <code className="rounded-lg bg-gray-100 px-2.5 py-1 text-xs font-mono text-gray-700">{s.cronExpression}</code>
                </td>
                <td className="px-5 py-4 text-sm text-gray-500">{s.lastRunAt ? formatDate(s.lastRunAt) : <span className="text-gray-400">Never</span>}</td>
                <td className="px-5 py-4 text-sm text-gray-500">{s.nextRunAt ? formatDate(s.nextRunAt) : '-'}</td>
                <td className="px-5 py-4 text-sm text-gray-500">{s.timeoutMinutes}m</td>
                <td className="px-5 py-4 text-center">
                  <button
                    onClick={() => onToggle(s.id, !s.enabled)}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 ${
                      s.enabled ? 'bg-brand-600' : 'bg-gray-300'
                    }`}
                  >
                    <span className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${
                      s.enabled ? 'translate-x-5.5' : 'translate-x-1'
                    }`} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function RunsTable({ runs }: { runs: RunRecord[] }) {
  if (runs.length === 0) return <EmptyState icon={<HistoryIcon />} message="No pipeline runs recorded yet" />

  return (
    <div className="mt-6 overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-card">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-surface-50">
            <tr>
              <th className="px-5 py-3.5 text-left text-xs font-bold uppercase tracking-wider text-gray-500">Source</th>
              <th className="px-5 py-3.5 text-left text-xs font-bold uppercase tracking-wider text-gray-500">Type</th>
              <th className="px-5 py-3.5 text-left text-xs font-bold uppercase tracking-wider text-gray-500">Status</th>
              <th className="px-5 py-3.5 text-right text-xs font-bold uppercase tracking-wider text-gray-500">Fetched</th>
              <th className="px-5 py-3.5 text-right text-xs font-bold uppercase tracking-wider text-gray-500">New</th>
              <th className="px-5 py-3.5 text-right text-xs font-bold uppercase tracking-wider text-gray-500">Scored</th>
              <th className="px-5 py-3.5 text-right text-xs font-bold uppercase tracking-wider text-gray-500">Duration</th>
              <th className="px-5 py-3.5 text-left text-xs font-bold uppercase tracking-wider text-gray-500">Started</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {runs.map(r => (
              <tr key={r.id} className="hover:bg-surface-50 transition-colors">
                <td className="px-5 py-4">
                  <div className="flex items-center gap-2.5">
                    <SourceDot status={r.status} />
                    <span className="text-sm font-semibold text-gray-900">{formatSource(r.source)}</span>
                  </div>
                </td>
                <td className="px-5 py-4"><span className="badge-gray">{r.runType}</span></td>
                <td className="px-5 py-4"><JobStatusBadge status={r.status} /></td>
                <td className="px-5 py-4 text-right text-sm font-medium text-gray-700">{r.opportunitiesFetched}</td>
                <td className="px-5 py-4 text-right">
                  <span className={`text-sm font-medium ${r.opportunitiesNew > 0 ? 'text-emerald-600' : 'text-gray-500'}`}>
                    {r.opportunitiesNew > 0 ? `+${r.opportunitiesNew}` : '0'}
                  </span>
                </td>
                <td className="px-5 py-4 text-right text-sm text-gray-600">{r.tenantsScored}</td>
                <td className="px-5 py-4 text-right text-sm text-gray-500">
                  {r.durationSeconds ? formatDuration(r.durationSeconds) : '-'}
                </td>
                <td className="px-5 py-4 text-sm text-gray-500">{formatDate(r.startedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/* ─── Sub-components ──────────────────────────────────────── */

function PipelineStat({ label, value, color, icon }: { label: string; value: number; color: string; icon: React.ReactNode }) {
  const colorMap: Record<string, { bg: string; text: string; iconBg: string }> = {
    amber:   { bg: 'bg-amber-50/50',   text: 'text-amber-600',   iconBg: 'bg-amber-100' },
    blue:    { bg: 'bg-blue-50/50',     text: 'text-blue-600',    iconBg: 'bg-blue-100' },
    emerald: { bg: 'bg-emerald-50/50',  text: 'text-emerald-600', iconBg: 'bg-emerald-100' },
    red:     { bg: 'bg-red-50/50',      text: 'text-red-600',     iconBg: 'bg-red-100' },
  }
  const c = colorMap[color] ?? colorMap.blue

  return (
    <div className={`card ${c.bg}`}>
      <div className="flex items-center gap-3">
        <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${c.iconBg} ${c.text}`}>
          {icon}
        </div>
        <div>
          <p className="text-2xl font-black text-gray-900">{value}</p>
          <p className="text-xs font-medium text-gray-500">{label}</p>
        </div>
      </div>
    </div>
  )
}

function JobStatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    pending: 'badge-yellow', running: 'badge-blue', completed: 'badge-green', failed: 'badge-red', cancelled: 'badge-gray',
  }
  return <span className={styles[status] ?? 'badge-gray'}>{status}</span>
}

function SourceDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pending: 'bg-amber-400', running: 'bg-blue-500', completed: 'bg-emerald-500', failed: 'bg-red-500', cancelled: 'bg-gray-400',
  }
  return (
    <span className="relative flex h-2 w-2">
      {status === 'running' && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-50" />}
      <span className={`relative inline-flex h-2 w-2 rounded-full ${colors[status] ?? 'bg-gray-400'}`} />
    </span>
  )
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

/* ─── Helpers ────────────────────────────────────────────── */

function formatSource(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function formatDate(d: string): string {
  return new Date(d).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return `${m}m ${s}s`
}

/* ─── SVG Icons ──────────────────────────────────────────── */

function PlayIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z" />
    </svg>
  )
}

function RefreshIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182" />
    </svg>
  )
}

function QueueIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 0 1 0 3.75H5.625a1.875 1.875 0 0 1 0-3.75Z" />
    </svg>
  )
}

function CalendarIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" />
    </svg>
  )
}

function HistoryIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
    </svg>
  )
}

function ClockIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
    </svg>
  )
}

function SpinnerIcon() {
  return (
    <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
    </svg>
  )
}

function XIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="m9.75 9.75 4.5 4.5m0-4.5-4.5 4.5M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
    </svg>
  )
}
