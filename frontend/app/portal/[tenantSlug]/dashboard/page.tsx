'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import type { TenantPipelineItem } from '@/types'

interface DashboardMetrics {
  library: {
    totalUnits: number
    approved: number
    draft: number
    embedded: number
    topCategories: { category: string; count: number }[]
    recentUploads: number
  }
  proposals: {
    total: number
    byStage: Record<string, number>
    avgCompletion: number
    deadlineSoon: number
  }
  purchases: {
    activeBuilds: number
    pendingTemplates: number
    completedBuilds: number
    totalPurchases: number
  }
  activity: Array<{
    id: string
    eventType: string
    description: string
    createdAt: string
  }>
}

const PROGRAM_TYPE_BADGES: Record<string, { label: string; color: string }> = {
  sbir_phase_1: { label: 'SBIR I', color: 'bg-blue-100 text-blue-800 border-blue-200' },
  sbir_phase_2: { label: 'SBIR II', color: 'bg-indigo-100 text-indigo-800 border-indigo-200' },
  sttr_phase_1: { label: 'STTR I', color: 'bg-purple-100 text-purple-800 border-purple-200' },
  sttr_phase_2: { label: 'STTR II', color: 'bg-violet-100 text-violet-800 border-violet-200' },
  ota: { label: 'OTA', color: 'bg-amber-100 text-amber-800 border-amber-200' },
  baa: { label: 'BAA', color: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  challenge: { label: 'Challenge', color: 'bg-rose-100 text-rose-800 border-rose-200' },
}

function ProgramTypeBadge({ programType }: { programType: string | null }) {
  if (!programType) return null
  const badge = PROGRAM_TYPE_BADGES[programType]
  if (!badge) return null
  return (
    <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium ${badge.color}`}>
      {badge.label}
    </span>
  )
}

export default function PortalDashboard() {
  const params = useParams()
  const slug = params.tenantSlug as string
  const [topOpps, setTopOpps] = useState<TenantPipelineItem[]>([])
  const [urgentOpps, setUrgentOpps] = useState<TenantPipelineItem[]>([])
  const [stats, setStats] = useState({ total: 0, highPriority: 0, pursuing: 0, closingSoon: 0 })
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([
      fetch(`/api/opportunities?tenantSlug=${slug}&sortBy=score&limit=5`).then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json().catch(() => ({ data: [], total: 0 }))
      }),
      fetch(`/api/opportunities?tenantSlug=${slug}&deadlineStatus=urgent&sortBy=close_date&sortDir=asc&limit=5`).then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json().catch(() => ({ data: [], total: 0 }))
      }),
      // Separate queries for accurate stats (not derived from 5-item subsets)
      fetch(`/api/opportunities?tenantSlug=${slug}&minScore=75&limit=1`).then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json().catch(() => ({ data: [], total: 0 }))
      }),
      fetch(`/api/opportunities?tenantSlug=${slug}&pursuitStatus=pursuing&limit=1`).then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json().catch(() => ({ data: [], total: 0 }))
      }),
      fetch(`/api/portal/${slug}/dashboard`).then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json().catch(() => ({}))
      }),
    ])
      .then(([top, urgent, highPri, pursuing, dashMetrics]) => {
        setTopOpps(top.data ?? [])
        setUrgentOpps(urgent.data ?? [])
        setStats({
          total: top.total ?? 0,
          highPriority: highPri.total ?? 0,
          pursuing: pursuing.total ?? 0,
          closingSoon: urgent.total ?? 0,
        })
        const metricsData = dashMetrics?.data ?? dashMetrics
        if (metricsData && (metricsData.library || metricsData.proposals || metricsData.activity)) {
          setMetrics(metricsData)
        }
      })
      .catch(err => setError(err.message ?? 'Failed to load dashboard data'))
      .finally(() => setLoading(false))
  }, [slug])

  if (loading) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <div className="mt-6 grid grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <div key={i} className="card animate-pulse h-20" />)}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <div className="mt-6 rounded-lg bg-red-50 p-4 text-sm text-red-700">
          Failed to load dashboard: {error}
        </div>
      </div>
    )
  }

  const proposalStages: { key: string; label: string; color: string }[] = [
    { key: 'outline', label: 'Outline', color: 'bg-gray-400' },
    { key: 'draft', label: 'Draft', color: 'bg-blue-500' },
    { key: 'pink_team', label: 'Pink', color: 'bg-pink-500' },
    { key: 'red_team', label: 'Red', color: 'bg-red-500' },
    { key: 'gold_team', label: 'Gold', color: 'bg-amber-500' },
    { key: 'final', label: 'Final', color: 'bg-emerald-500' },
    { key: 'submitted', label: 'Submitted', color: 'bg-purple-500' },
  ]

  const byStage = metrics?.proposals?.byStage ?? {}
  const totalByStage = proposalStages.reduce((sum, s) => sum + (byStage[s.key] ?? 0), 0)

  const activityColors: Record<string, string> = {
    library: 'bg-indigo-100 text-indigo-800',
    proposal: 'bg-purple-100 text-purple-800',
    account: 'bg-blue-100 text-blue-800',
    spotlight: 'bg-amber-100 text-amber-800',
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
      <p className="mt-1 text-sm text-gray-500">Your SBIR/STTR opportunity intelligence at a glance</p>

      {/* Stats */}
      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="SBIR/STTR Topics" value={stats.total} color="blue" />
        <StatCard label="High Match" value={stats.highPriority} color="green" />
        <StatCard label="Pursuing" value={stats.pursuing} color="purple" />
        <StatCard label="Closing Soon" value={stats.closingSoon} color="red" />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Active Proposals" value={metrics?.proposals?.total ?? 0} color="purple" />
        <StatCard label="Library Units" value={metrics?.library?.totalUnits ?? 0} color="indigo" />
        <StatCard label="Avg Completion" value={`${metrics?.proposals?.avgCompletion ?? 0}%`} color="emerald" />
        <StatCard label="Proposal Builds" value={metrics?.purchases?.activeBuilds ?? 0} color="rose" />
      </div>

      {/* Proposal Pipeline */}
      {metrics?.proposals && (
        <div className="mt-8 card">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">Proposal Pipeline</h2>
            <Link href={`/portal/${slug}/proposals`} className="text-sm text-brand-600 hover:text-brand-800">
              View all &rarr;
            </Link>
          </div>
          <div className="mt-4 flex gap-6">
            <div className="flex-1">
              {totalByStage > 0 ? (
                <div className="flex h-8 w-full overflow-hidden rounded-lg">
                  {proposalStages.map(stage => {
                    const count = byStage[stage.key] ?? 0
                    if (count === 0) return null
                    const pct = (count / totalByStage) * 100
                    return (
                      <div
                        key={stage.key}
                        className={`${stage.color} flex items-center justify-center text-xs font-medium text-white`}
                        style={{ width: `${pct}%`, minWidth: '2rem' }}
                        title={`${stage.label}: ${count}`}
                      >
                        {count}
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="flex h-8 w-full items-center justify-center rounded-lg bg-gray-100 text-xs text-gray-500">
                  No proposals yet
                </div>
              )}
              <div className="mt-2 flex flex-wrap gap-3 text-xs text-gray-500">
                {proposalStages.map(stage => (
                  <span key={stage.key} className="flex items-center gap-1">
                    <span className={`inline-block h-2 w-2 rounded-full ${stage.color}`} />
                    {stage.label} ({byStage[stage.key] ?? 0})
                  </span>
                ))}
              </div>
            </div>
            {/* Proposal Builds Summary */}
            {metrics?.purchases && (metrics.purchases.totalPurchases ?? 0) > 0 && (
              <div className="flex-shrink-0 rounded-lg border border-gray-200 bg-gray-50 p-3 text-center min-w-[140px]">
                <p className="text-xs font-semibold text-gray-700 mb-2">Proposal Builds</p>
                <div className="space-y-1 text-xs">
                  <div className="flex justify-between">
                    <span className="text-gray-500">Pending</span>
                    <span className="font-medium text-amber-700">{metrics.purchases.pendingTemplates}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Active</span>
                    <span className="font-medium text-blue-700">{metrics.purchases.activeBuilds}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Completed</span>
                    <span className="font-medium text-green-700">{metrics.purchases.completedBuilds}</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Top SBIR/STTR Matches */}
        <div className="card">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">Top SBIR/STTR Matches</h2>
            <Link href={`/portal/${slug}/pipeline?sortBy=score`} className="text-sm text-brand-600 hover:text-brand-800">
              View all &rarr;
            </Link>
          </div>
          <div className="mt-4 space-y-3">
            {topOpps.length === 0 ? (
              <p className="text-sm text-gray-500">No opportunities scored yet</p>
            ) : (
              topOpps.map(opp => <OppCard key={opp.tenantOppId} opp={opp} slug={slug} />)
            )}
          </div>
        </div>

        {/* Approaching Deadlines */}
        <div className="card">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">Approaching Deadlines</h2>
            <Link href={`/portal/${slug}/pipeline?sortBy=close_date&sortDir=asc`} className="text-sm text-brand-600 hover:text-brand-800">
              View all &rarr;
            </Link>
          </div>
          <div className="mt-4 space-y-3">
            {urgentOpps.length === 0 ? (
              <p className="text-sm text-gray-500">No urgent deadlines</p>
            ) : (
              urgentOpps.map(opp => <OppCard key={opp.tenantOppId} opp={opp} slug={slug} />)
            )}
          </div>
        </div>
      </div>

      {/* Library Health */}
      {metrics?.library && (
        <div className="mt-8 card">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">Library Health</h2>
            <Link href={`/portal/${slug}/library`} className="text-sm text-brand-600 hover:text-brand-800">
              View all &rarr;
            </Link>
          </div>
          <div className="mt-4 space-y-3">
            <div className="flex gap-4 text-sm">
              <span className="text-gray-600">
                <span className="font-semibold text-gray-900">{metrics.library.approved}</span> approved of{' '}
                <span className="font-semibold text-gray-900">{metrics.library.totalUnits}</span> total
              </span>
              <span className="text-gray-600">
                <span className="font-semibold text-gray-900">{metrics.library.embedded}</span> units embedded
                {metrics.library.totalUnits > 0 && (
                  <span className="ml-1 text-xs text-gray-400">
                    ({Math.round((metrics.library.embedded / metrics.library.totalUnits) * 100)}%)
                  </span>
                )}
              </span>
            </div>
            {(metrics.library.topCategories ?? []).length > 0 && (
              <div className="space-y-2">
                {(metrics.library.topCategories ?? []).map(cat => {
                  const maxCount = (metrics.library.topCategories ?? [])[0]?.count ?? 1
                  return (
                    <div key={cat.category} className="flex items-center gap-3">
                      <span className="w-32 truncate text-xs text-gray-600">{cat.category}</span>
                      <div className="flex-1">
                        <div className="h-4 w-full overflow-hidden rounded bg-gray-100">
                          <div
                            className="h-full rounded bg-indigo-400"
                            style={{ width: `${(cat.count / maxCount) * 100}%` }}
                          />
                        </div>
                      </div>
                      <span className="text-xs font-medium text-gray-700">{cat.count}</span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Recent Activity Feed */}
      {(metrics?.activity ?? []).length > 0 && (
        <div className="mt-8 card">
          <h2 className="text-lg font-semibold text-gray-900">Recent Activity</h2>
          <div className="mt-4 space-y-3">
            {(metrics?.activity ?? []).slice(0, 10).map(event => {
              const namespace = event.eventType?.split('.')[0] ?? ''
              const badgeClass = activityColors[namespace] ?? 'bg-gray-100 text-gray-800'
              return (
                <div key={event.id} className="flex items-start gap-3 text-sm">
                  <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${badgeClass}`}>
                    {event.eventType}
                  </span>
                  <span className="flex-1 text-gray-700">{event.description}</span>
                  <span className="shrink-0 text-xs text-gray-400">
                    {relativeTime(event.createdAt)}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function relativeTime(dateStr: string): string {
  try {
    const now = Date.now()
    const then = new Date(dateStr).getTime()
    const diffMs = now - then
    if (Number.isNaN(diffMs)) return ''
    const minutes = Math.floor(diffMs / 60000)
    if (minutes < 1) return 'just now'
    if (minutes < 60) return `${minutes}m ago`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours}h ago`
    const days = Math.floor(hours / 24)
    if (days < 7) return `${days}d ago`
    return `${Math.floor(days / 7)}w ago`
  } catch {
    return ''
  }
}

function OppCard({ opp, slug }: { opp: TenantPipelineItem; slug: string }) {
  return (
    <div className="rounded-lg border border-gray-100 p-3 hover:bg-gray-50 transition-colors">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-gray-900 truncate">{opp.title}</p>
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-gray-500">
            <ProgramTypeBadge programType={opp.programType} />
            {opp.agency ?? 'Unknown agency'} &middot; {opp.opportunityType}
          </p>
        </div>
        <ScoreBadge score={opp.totalScore} tier={opp.priorityTier} />
      </div>
      <div className="mt-2 flex items-center gap-2 text-xs text-gray-400">
        {opp.daysToClose != null && opp.daysToClose >= 0 && (
          <span className={opp.deadlineStatus === 'urgent' ? 'text-red-500 font-medium' : ''}>
            {opp.daysToClose}d left
          </span>
        )}
        {opp.setAsideType && <span className="badge-blue text-[10px]">{opp.setAsideType}</span>}
        <PursuitBadge status={opp.pursuitStatus} />
      </div>
    </div>
  )
}

function ScoreBadge({ score, tier }: { score: number | null; tier: string }) {
  if (score == null) return <span className="badge-gray">-</span>
  const colors: Record<string, string> = {
    high: 'bg-green-100 text-green-800',
    medium: 'bg-yellow-100 text-yellow-800',
    low: 'bg-gray-100 text-gray-700',
  }
  return <span className={`badge ${colors[tier] ?? colors.low}`}>{Math.round(score)}</span>
}

function PursuitBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    pursuing: 'badge-green',
    monitoring: 'badge-blue',
    passed: 'badge-gray',
    unreviewed: 'badge-yellow',
  }
  return <span className={`text-[10px] ${styles[status] ?? 'badge-gray'}`}>{status}</span>
}

function StatCard({ label, value, color }: { label: string; value: number | string; color: string }) {
  const bg: Record<string, string> = {
    blue: 'bg-blue-50',
    green: 'bg-green-50',
    purple: 'bg-purple-50',
    red: 'bg-red-50',
    indigo: 'bg-indigo-50',
    emerald: 'bg-emerald-50',
    rose: 'bg-rose-50',
  }
  return (
    <div className={`rounded-xl p-4 ${bg[color] ?? bg.blue}`}>
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-gray-900">{value}</p>
    </div>
  )
}
