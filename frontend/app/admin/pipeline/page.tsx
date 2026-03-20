'use client'

import { useEffect, useState } from 'react'
import type { PipelineJob, PipelineSchedule } from '@/types'

type Tab = 'jobs' | 'schedules' | 'runs'

export default function PipelinePage() {
  const [tab, setTab] = useState<Tab>('jobs')
  const [jobs, setJobs] = useState<PipelineJob[]>([])
  const [schedules, setSchedules] = useState<PipelineSchedule[]>([])
  const [runs, setRuns] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [triggering, setTriggering] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
    await fetch('/api/pipeline', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source, runType }),
    })
    setTriggering(false)
    loadData()
  }

  async function toggleSchedule(id: string, enabled: boolean) {
    await fetch('/api/pipeline/schedules', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, enabled }),
    })
    loadData()
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Pipeline</h1>
          <p className="mt-1 text-sm text-gray-500">Job queue, schedules, and run history</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => triggerJob('sam_gov')} disabled={triggering} className="btn-primary text-sm">
            {triggering ? 'Triggering...' : 'Run SAM.gov'}
          </button>
          <button onClick={() => triggerJob('scoring', 'score')} disabled={triggering} className="btn-secondary text-sm">
            Re-score All
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="mt-6 flex gap-1 rounded-lg bg-gray-100 p-1">
        {(['jobs', 'schedules', 'runs'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              tab === t ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t === 'jobs' ? 'Job Queue' : t === 'schedules' ? 'Schedules' : 'Run History'}
          </button>
        ))}
      </div>

      {error ? (
        <div className="mt-6 rounded-lg bg-red-50 p-4 text-sm text-red-700">
          Failed to load: {error}
          <button onClick={loadData} className="ml-3 underline">Retry</button>
        </div>
      ) : loading ? (
        <div className="mt-6 space-y-3">
          {[...Array(5)].map((_, i) => <div key={i} className="card animate-pulse h-12" />)}
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

function JobsTable({ jobs }: { jobs: PipelineJob[] }) {
  if (jobs.length === 0) return <EmptyState message="No pipeline jobs yet" />

  return (
    <div className="mt-4 overflow-hidden rounded-xl border border-gray-200 bg-white">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Source</th>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Type</th>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Status</th>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Triggered</th>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">By</th>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Attempt</th>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Error</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {jobs.map(j => (
            <tr key={j.id} className="hover:bg-gray-50">
              <td className="px-4 py-3 text-sm font-medium text-gray-900">{formatSource(j.source)}</td>
              <td className="px-4 py-3"><span className="badge-gray">{j.runType}</span></td>
              <td className="px-4 py-3"><JobStatusBadge status={j.status} /></td>
              <td className="px-4 py-3 text-sm text-gray-500">{formatDate(j.triggeredAt)}</td>
              <td className="px-4 py-3 text-sm text-gray-500">{j.triggeredBy}</td>
              <td className="px-4 py-3 text-sm text-gray-500">{j.attempt}</td>
              <td className="px-4 py-3 text-sm text-red-500 truncate max-w-xs">{j.errorMessage ?? '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function SchedulesTable({ schedules, onToggle }: { schedules: PipelineSchedule[]; onToggle: (id: string, enabled: boolean) => void }) {
  if (schedules.length === 0) return <EmptyState message="No schedules configured" />

  return (
    <div className="mt-4 overflow-hidden rounded-xl border border-gray-200 bg-white">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Schedule</th>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Source</th>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Cron</th>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Last Run</th>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Next Run</th>
            <th className="px-4 py-3 text-center text-xs font-medium uppercase text-gray-500">Enabled</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {schedules.map(s => (
            <tr key={s.id} className="hover:bg-gray-50">
              <td className="px-4 py-3 text-sm font-medium text-gray-900">{s.displayName}</td>
              <td className="px-4 py-3 text-sm text-gray-500">{s.source}</td>
              <td className="px-4 py-3"><code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded">{s.cronExpression}</code></td>
              <td className="px-4 py-3 text-sm text-gray-500">{s.lastRunAt ? formatDate(s.lastRunAt) : 'Never'}</td>
              <td className="px-4 py-3 text-sm text-gray-500">{s.nextRunAt ? formatDate(s.nextRunAt) : '-'}</td>
              <td className="px-4 py-3 text-center">
                <button
                  onClick={() => onToggle(s.id, !s.enabled)}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                    s.enabled ? 'bg-brand-600' : 'bg-gray-300'
                  }`}
                >
                  <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                    s.enabled ? 'translate-x-4.5' : 'translate-x-0.5'
                  }`} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function RunsTable({ runs }: { runs: any[] }) {
  if (runs.length === 0) return <EmptyState message="No pipeline runs yet" />

  return (
    <div className="mt-4 overflow-hidden rounded-xl border border-gray-200 bg-white">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Source</th>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Type</th>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Status</th>
            <th className="px-4 py-3 text-right text-xs font-medium uppercase text-gray-500">Fetched</th>
            <th className="px-4 py-3 text-right text-xs font-medium uppercase text-gray-500">New</th>
            <th className="px-4 py-3 text-right text-xs font-medium uppercase text-gray-500">Scored</th>
            <th className="px-4 py-3 text-right text-xs font-medium uppercase text-gray-500">Duration</th>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Started</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {runs.map((r: any) => (
            <tr key={r.id} className="hover:bg-gray-50">
              <td className="px-4 py-3 text-sm font-medium text-gray-900">{formatSource(r.source)}</td>
              <td className="px-4 py-3"><span className="badge-gray">{r.runType}</span></td>
              <td className="px-4 py-3"><JobStatusBadge status={r.status} /></td>
              <td className="px-4 py-3 text-right text-sm text-gray-600">{r.opportunitiesFetched}</td>
              <td className="px-4 py-3 text-right text-sm text-gray-600">{r.opportunitiesNew}</td>
              <td className="px-4 py-3 text-right text-sm text-gray-600">{r.tenantsScored}</td>
              <td className="px-4 py-3 text-right text-sm text-gray-500">
                {r.durationSeconds ? `${Math.round(r.durationSeconds)}s` : '-'}
              </td>
              <td className="px-4 py-3 text-sm text-gray-500">{formatDate(r.startedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function JobStatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    pending: 'badge-yellow',
    running: 'badge-blue',
    completed: 'badge-green',
    failed: 'badge-red',
    cancelled: 'badge-gray',
  }
  return <span className={styles[status] ?? 'badge-gray'}>{status}</span>
}

function EmptyState({ message }: { message: string }) {
  return <div className="mt-12 text-center text-sm text-gray-500">{message}</div>
}

function formatSource(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function formatDate(d: string): string {
  return new Date(d).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}
