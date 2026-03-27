'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import type { TenantPipelineItem } from '@/types'

export default function PortalDashboard() {
  const params = useParams()
  const slug = params.tenantSlug as string
  const [topOpps, setTopOpps] = useState<TenantPipelineItem[]>([])
  const [urgentOpps, setUrgentOpps] = useState<TenantPipelineItem[]>([])
  const [stats, setStats] = useState({ total: 0, highPriority: 0, pursuing: 0, closingSoon: 0 })
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
    ])
      .then(([top, urgent, highPri, pursuing]) => {
        setTopOpps(top.data ?? [])
        setUrgentOpps(urgent.data ?? [])
        setStats({
          total: top.total ?? 0,
          highPriority: highPri.total ?? 0,
          pursuing: pursuing.total ?? 0,
          closingSoon: urgent.total ?? 0,
        })
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

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
      <p className="mt-1 text-sm text-gray-500">Your opportunity intelligence at a glance</p>

      {/* Stats */}
      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="In Pipeline" value={stats.total} color="blue" />
        <StatCard label="High Priority" value={stats.highPriority} color="green" />
        <StatCard label="Pursuing" value={stats.pursuing} color="purple" />
        <StatCard label="Closing Soon" value={stats.closingSoon} color="red" />
      </div>

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Top Scored */}
        <div className="card">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">Top Scored</h2>
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

        {/* Closing Soon */}
        <div className="card">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">Closing Soon</h2>
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
    </div>
  )
}

function OppCard({ opp, slug }: { opp: TenantPipelineItem; slug: string }) {
  return (
    <div className="rounded-lg border border-gray-100 p-3 hover:bg-gray-50 transition-colors">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-gray-900 truncate">{opp.title}</p>
          <p className="mt-0.5 text-xs text-gray-500">
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

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  const bg: Record<string, string> = {
    blue: 'bg-blue-50',
    green: 'bg-green-50',
    purple: 'bg-purple-50',
    red: 'bg-red-50',
  }
  return (
    <div className={`rounded-xl p-4 ${bg[color] ?? bg.blue}`}>
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-gray-900">{value}</p>
    </div>
  )
}
