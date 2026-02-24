'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { SystemStatus } from '@/types'

export default function AdminDashboard() {
  const [status, setStatus] = useState<SystemStatus | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/system')
      .then(r => r.json())
      .then(setStatus)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <DashboardSkeleton />

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
      <p className="mt-1 text-sm text-gray-500">Platform overview and system status</p>

      {/* Stat Cards */}
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Active Tenants"
          value={status?.tenants?.active ?? 0}
          sub={`${status?.tenants?.total ?? 0} total`}
          color="blue"
        />
        <StatCard
          label="Pending Jobs"
          value={status?.pipelineJobs?.pending ?? 0}
          sub={`${status?.pipelineJobs?.running ?? 0} running`}
          color="yellow"
        />
        <StatCard
          label="Failed (24h)"
          value={status?.pipelineJobs?.failed24h ?? 0}
          sub="pipeline failures"
          color={status?.pipelineJobs?.failed24h ? 'red' : 'green'}
        />
        <StatCard
          label="Trial Tenants"
          value={status?.tenants?.trial ?? 0}
          sub="awaiting conversion"
          color="purple"
        />
      </div>

      {/* Source Health + API Keys */}
      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="card">
          <h2 className="text-lg font-semibold text-gray-900">Source Health</h2>
          <div className="mt-4 space-y-3">
            {status?.sourceHealth ? (
              Object.entries(status.sourceHealth).map(([source, health]) => (
                <div key={source} className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-700">{formatSource(source)}</span>
                  <HealthBadge status={health as string} />
                </div>
              ))
            ) : (
              <p className="text-sm text-gray-500">No source data available</p>
            )}
          </div>
        </div>

        <div className="card">
          <h2 className="text-lg font-semibold text-gray-900">API Keys</h2>
          <div className="mt-4 space-y-3">
            {status?.apiKeys ? (
              Object.entries(status.apiKeys).map(([source, expiry]) => (
                <div key={source} className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-700">{formatSource(source)}</span>
                  <ExpiryBadge status={expiry as string} />
                </div>
              ))
            ) : (
              <p className="text-sm text-gray-500">No API key data</p>
            )}
          </div>
        </div>
      </div>

      {/* Rate Limits */}
      <div className="mt-6 card">
        <h2 className="text-lg font-semibold text-gray-900">Rate Limits</h2>
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {status?.rateLimits ? (
            Object.entries(status.rateLimits).map(([source, info]) => {
              const data = info as { used: number; limit: number | null }
              return (
                <div key={source} className="rounded-lg border border-gray-100 p-3">
                  <p className="text-xs font-medium text-gray-500 uppercase">{formatSource(source)}</p>
                  <p className="mt-1 text-lg font-semibold text-gray-900">
                    {data.used}{data.limit ? `/${data.limit}` : ''}
                  </p>
                  <p className="text-xs text-gray-400">{data.limit ? 'requests today' : 'unlimited'}</p>
                </div>
              )
            })
          ) : (
            <p className="text-sm text-gray-500 col-span-full">No rate limit data</p>
          )}
        </div>
      </div>

      {/* Quick Actions */}
      <div className="mt-6 flex gap-3">
        <Link href="/admin/tenants" className="btn-primary">Manage Tenants</Link>
        <Link href="/admin/pipeline" className="btn-secondary">View Pipeline</Link>
      </div>
    </div>
  )
}

function StatCard({ label, value, sub, color }: { label: string; value: number; sub: string; color: string }) {
  const colors: Record<string, string> = {
    blue: 'bg-blue-50 text-blue-700',
    yellow: 'bg-yellow-50 text-yellow-700',
    red: 'bg-red-50 text-red-700',
    green: 'bg-green-50 text-green-700',
    purple: 'bg-purple-50 text-purple-700',
  }
  return (
    <div className="card">
      <p className="text-sm font-medium text-gray-500">{label}</p>
      <p className="mt-1 text-3xl font-bold text-gray-900">{value}</p>
      <span className={`mt-2 badge ${colors[color] ?? colors.blue}`}>{sub}</span>
    </div>
  )
}

function HealthBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    healthy: 'badge-green',
    degraded: 'badge-yellow',
    error: 'badge-red',
    unknown: 'badge-gray',
  }
  return <span className={styles[status] ?? 'badge-gray'}>{status}</span>
}

function ExpiryBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    ok: 'badge-green',
    expiring_soon: 'badge-yellow',
    expired: 'badge-red',
    no_expiry: 'badge-gray',
  }
  return <span className={styles[status] ?? 'badge-gray'}>{status.replace('_', ' ')}</span>
}

function formatSource(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function DashboardSkeleton() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="card animate-pulse">
            <div className="h-4 w-24 rounded bg-gray-200" />
            <div className="mt-3 h-8 w-16 rounded bg-gray-200" />
          </div>
        ))}
      </div>
    </div>
  )
}
