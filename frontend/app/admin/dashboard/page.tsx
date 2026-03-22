'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { SystemStatus } from '@/types'

export default function AdminDashboard() {
  const [status, setStatus] = useState<SystemStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)

  const loadStatus = () => {
    setLoading(true)
    setError(null)
    fetch('/api/system')
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then(data => {
        setStatus(data)
        setLastRefresh(new Date())
      })
      .catch(err => setError(err.message ?? 'Failed to load system status'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadStatus() }, [])

  if (loading && !status) return <DashboardSkeleton />

  if (error && !status) return (
    <div>
      <PageHeader />
      <div className="mt-6 card border-red-200 bg-red-50">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-100">
            <svg className="h-5 w-5 text-red-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-semibold text-red-800">Failed to load system status</p>
            <p className="text-xs text-red-600">{error}</p>
          </div>
          <button onClick={loadStatus} className="ml-auto btn-secondary text-xs">Retry</button>
        </div>
      </div>
    </div>
  )

  const totalOpps = (status?.pipelineJobs?.pending ?? 0) + (status?.pipelineJobs?.running ?? 0)
  const healthySources = status?.sourceHealth
    ? Object.values(status.sourceHealth).filter(s => s === 'healthy').length
    : 0
  const totalSources = status?.sourceHealth ? Object.keys(status.sourceHealth).length : 0

  return (
    <div>
      <div className="flex items-center justify-between">
        <PageHeader />
        <div className="flex items-center gap-3">
          {lastRefresh && (
            <span className="text-xs text-gray-400">
              Updated {lastRefresh.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          <button onClick={loadStatus} disabled={loading} className="btn-secondary text-sm gap-2">
            <svg className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182" />
            </svg>
            Refresh
          </button>
        </div>
      </div>

      {/* Primary KPI Row */}
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Active Tenants"
          value={status?.tenants?.active ?? 0}
          total={status?.tenants?.total ?? 0}
          totalLabel="total"
          icon={<BuildingIcon />}
          color="brand"
          href="/admin/tenants"
        />
        <KpiCard
          label="Pipeline Queue"
          value={totalOpps}
          total={null}
          totalLabel={`${status?.pipelineJobs?.pending ?? 0} pending, ${status?.pipelineJobs?.running ?? 0} running`}
          icon={<WorkflowIcon />}
          color="blue"
          href="/admin/pipeline"
        />
        <KpiCard
          label="Source Health"
          value={healthySources}
          total={totalSources}
          totalLabel="healthy"
          icon={<HeartIcon />}
          color={healthySources === totalSources ? 'green' : 'yellow'}
          href="/admin/sources"
        />
        <KpiCard
          label="Failed Jobs (24h)"
          value={status?.pipelineJobs?.failed24h ?? 0}
          total={null}
          totalLabel="pipeline failures"
          icon={<AlertIcon />}
          color={status?.pipelineJobs?.failed24h ? 'red' : 'green'}
          href="/admin/pipeline"
        />
      </div>

      {/* Secondary Stats */}
      <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <MiniStat label="Trial Tenants" value={status?.tenants?.trial ?? 0} badge="awaiting conversion" badgeColor="purple" />
        <MiniStat
          label="API Keys"
          value={status?.apiKeys ? Object.values(status.apiKeys).filter(v => v === 'ok').length : 0}
          badge={`${status?.apiKeys ? Object.keys(status.apiKeys).length : 0} total`}
          badgeColor="green"
        />
        <MiniStat
          label="Rate Limit Usage"
          value={status?.rateLimits
            ? Object.values(status.rateLimits).reduce((sum, v) => {
                const d = v as { used: number; limit: number | null }
                return sum + d.used
              }, 0)
            : 0
          }
          badge="requests today"
          badgeColor="gray"
        />
        <MiniStat
          label="Checked At"
          value={status?.checkedAt ? new Date(status.checkedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : '-'}
          badge="server time"
          badgeColor="gray"
        />
      </div>

      {/* Main Content Grid */}
      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Source Health Panel */}
        <div className="card lg:col-span-1">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold uppercase tracking-wider text-gray-400">Source Health</h2>
            <Link href="/admin/sources" className="text-xs font-medium text-brand-600 hover:text-brand-700 transition-colors">View all</Link>
          </div>
          <div className="mt-5 space-y-3">
            {status?.sourceHealth ? (
              Object.entries(status.sourceHealth).map(([source, health]) => (
                <div key={source} className="flex items-center gap-3 rounded-xl bg-surface-50 px-4 py-3 transition-colors hover:bg-gray-100">
                  <HealthDot status={health as string} />
                  <span className="flex-1 text-sm font-medium text-gray-700">{formatSource(source)}</span>
                  <HealthBadge status={health as string} />
                </div>
              ))
            ) : (
              <EmptyRow message="No source data available" />
            )}
          </div>
        </div>

        {/* API Keys Panel */}
        <div className="card lg:col-span-1">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold uppercase tracking-wider text-gray-400">API Keys</h2>
            <Link href="/admin/sources" className="text-xs font-medium text-brand-600 hover:text-brand-700 transition-colors">Manage</Link>
          </div>
          <div className="mt-5 space-y-3">
            {status?.apiKeys ? (
              Object.entries(status.apiKeys).map(([source, expiry]) => (
                <div key={source} className="flex items-center gap-3 rounded-xl bg-surface-50 px-4 py-3 transition-colors hover:bg-gray-100">
                  <KeyIcon expiry={expiry as string} />
                  <span className="flex-1 text-sm font-medium text-gray-700">{formatSource(source)}</span>
                  <ExpiryBadge status={expiry as string} />
                </div>
              ))
            ) : (
              <EmptyRow message="No API key data" />
            )}
          </div>
        </div>

        {/* Rate Limits Panel */}
        <div className="card lg:col-span-1">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold uppercase tracking-wider text-gray-400">Rate Limits</h2>
          </div>
          <div className="mt-5 space-y-3">
            {status?.rateLimits ? (
              Object.entries(status.rateLimits).map(([source, info]) => {
                const data = info as { used: number; limit: number | null }
                const pct = data.limit ? Math.min(100, Math.round((data.used / data.limit) * 100)) : 0
                return (
                  <div key={source} className="rounded-xl bg-surface-50 px-4 py-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-gray-700">{formatSource(source)}</span>
                      <span className="text-sm font-bold text-gray-900">
                        {data.used}{data.limit ? ` / ${data.limit}` : ''}
                      </span>
                    </div>
                    {data.limit ? (
                      <div className="mt-2 h-1.5 w-full rounded-full bg-gray-200">
                        <div
                          className={`h-1.5 rounded-full transition-all duration-500 ${
                            pct > 80 ? 'bg-red-500' : pct > 50 ? 'bg-amber-500' : 'bg-emerald-500'
                          }`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    ) : (
                      <p className="mt-1 text-xs text-gray-400">Unlimited</p>
                    )}
                  </div>
                )
              })
            ) : (
              <EmptyRow message="No rate limit data" />
            )}
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="mt-8">
        <h2 className="text-sm font-bold uppercase tracking-wider text-gray-400">Quick Actions</h2>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <ActionCard
            href="/admin/tenants"
            icon={<BuildingIcon />}
            label="Manage Tenants"
            description="Add, edit, or suspend customer accounts"
          />
          <ActionCard
            href="/admin/pipeline"
            icon={<WorkflowIcon />}
            label="View Pipeline"
            description="Monitor job queue and run history"
          />
          <ActionCard
            href="/admin/sources"
            icon={<DatabaseIcon />}
            label="Manage Sources"
            description="Source health and API key rotation"
          />
          <ActionCard
            href="/admin/events"
            icon={<ActivityIcon />}
            label="Event Streams"
            description="User, system, and error event logs"
          />
        </div>
      </div>
    </div>
  )
}

/* ─── Sub-components ──────────────────────────────────────── */

function PageHeader() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
      <p className="mt-1 text-sm text-gray-500">Platform overview and system health</p>
    </div>
  )
}

function KpiCard({
  label, value, total, totalLabel, icon, color, href
}: {
  label: string; value: number; total: number | null; totalLabel: string; icon: React.ReactNode; color: string; href: string
}) {
  const colorMap: Record<string, { bg: string; iconBg: string; text: string }> = {
    brand:  { bg: 'bg-brand-50/50',   iconBg: 'bg-brand-100',  text: 'text-brand-600' },
    blue:   { bg: 'bg-blue-50/50',    iconBg: 'bg-blue-100',   text: 'text-blue-600' },
    green:  { bg: 'bg-emerald-50/50', iconBg: 'bg-emerald-100', text: 'text-emerald-600' },
    yellow: { bg: 'bg-amber-50/50',   iconBg: 'bg-amber-100',  text: 'text-amber-600' },
    red:    { bg: 'bg-red-50/50',     iconBg: 'bg-red-100',    text: 'text-red-600' },
  }
  const c = colorMap[color] ?? colorMap.brand

  return (
    <Link href={href} className={`card-interactive ${c.bg}`}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">{label}</p>
          <p className="mt-2 text-3xl font-black text-gray-900">{value}</p>
          <p className="mt-1 text-xs text-gray-500">
            {total !== null ? `${total} ` : ''}{totalLabel}
          </p>
        </div>
        <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${c.iconBg} ${c.text}`}>
          {icon}
        </div>
      </div>
    </Link>
  )
}

function MiniStat({ label, value, badge, badgeColor }: { label: string; value: number | string; badge: string; badgeColor: string }) {
  const badgeStyles: Record<string, string> = {
    green: 'badge-green', purple: 'badge-purple', gray: 'badge-gray', blue: 'badge-blue',
  }
  return (
    <div className="card">
      <p className="text-xs font-medium text-gray-400">{label}</p>
      <p className="mt-1 text-xl font-bold text-gray-900">{value}</p>
      <span className={`mt-2 ${badgeStyles[badgeColor] ?? 'badge-gray'}`}>{badge}</span>
    </div>
  )
}

function ActionCard({ href, icon, label, description }: { href: string; icon: React.ReactNode; label: string; description: string }) {
  return (
    <Link href={href} className="card-interactive group flex items-start gap-4">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600 transition-colors group-hover:bg-brand-100">
        {icon}
      </div>
      <div>
        <p className="text-sm font-semibold text-gray-900">{label}</p>
        <p className="mt-0.5 text-xs text-gray-500">{description}</p>
      </div>
    </Link>
  )
}

function HealthDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    healthy: 'bg-emerald-500', degraded: 'bg-amber-500', error: 'bg-red-500', unknown: 'bg-gray-400',
  }
  return (
    <span className="relative flex h-2.5 w-2.5">
      {status === 'healthy' && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-50" />}
      <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${colors[status] ?? 'bg-gray-400'}`} />
    </span>
  )
}

function HealthBadge({ status }: { status: string }) {
  const styles: Record<string, string> = { healthy: 'badge-green', degraded: 'badge-yellow', error: 'badge-red', unknown: 'badge-gray' }
  return <span className={styles[status] ?? 'badge-gray'}>{status}</span>
}

function ExpiryBadge({ status }: { status: string }) {
  const styles: Record<string, string> = { ok: 'badge-green', expiring_soon: 'badge-yellow', expired: 'badge-red', no_expiry: 'badge-gray' }
  return <span className={styles[status] ?? 'badge-gray'}>{status.replace(/_/g, ' ')}</span>
}

function KeyIcon({ expiry }: { expiry: string }) {
  const color = expiry === 'ok' ? 'text-emerald-500' : expiry === 'expiring_soon' ? 'text-amber-500' : expiry === 'expired' ? 'text-red-500' : 'text-gray-400'
  return (
    <svg className={`h-4 w-4 ${color}`} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1 1 21.75 8.25Z" />
    </svg>
  )
}

function EmptyRow({ message }: { message: string }) {
  return <p className="rounded-xl bg-surface-50 px-4 py-3 text-sm text-gray-400">{message}</p>
}

function formatSource(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

/* ─── SVG Icons ──────────────────────────────────────────── */

function BuildingIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 21h19.5M3.75 3v18h6V12h4.5v9h6V3H3.75Z" />
    </svg>
  )
}

function WorkflowIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 0 1 0 3.75H5.625a1.875 1.875 0 0 1 0-3.75Z" />
    </svg>
  )
}

function HeartIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12Z" />
    </svg>
  )
}

function AlertIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
    </svg>
  )
}

function DatabaseIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125" />
    </svg>
  )
}

function ActivityIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3v11.25A2.25 2.25 0 0 0 6 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0 1 18 16.5h-2.25m-7.5 0h7.5m-7.5 0-1 3m8.5-3 1 3m0 0 .5 1.5m-.5-1.5h-9.5m0 0-.5 1.5M9 11.25v1.5M12 9v3.75m3-6v6" />
    </svg>
  )
}

/* ─── Skeleton ───────────────────────────────────────────── */

function DashboardSkeleton() {
  return (
    <div className="animate-pulse">
      <div className="h-8 w-32 rounded-lg bg-gray-200" />
      <div className="mt-2 h-4 w-56 rounded bg-gray-100" />
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="card">
            <div className="h-3 w-20 rounded bg-gray-200" />
            <div className="mt-4 h-8 w-14 rounded bg-gray-200" />
            <div className="mt-2 h-3 w-16 rounded bg-gray-100" />
          </div>
        ))}
      </div>
      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-3">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="card">
            <div className="h-3 w-24 rounded bg-gray-200" />
            <div className="mt-5 space-y-3">
              {[...Array(3)].map((_, j) => <div key={j} className="h-12 rounded-xl bg-gray-100" />)}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
