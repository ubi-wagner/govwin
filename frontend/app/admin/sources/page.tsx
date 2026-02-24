'use client'

import { useEffect, useState } from 'react'

interface SourceInfo {
  source: string
  status: string
  lastSuccessAt: string | null
  lastErrorAt: string | null
  lastErrorMessage: string | null
  consecutiveFailures: number
  successRate30d: number | null
  avgDurationSeconds: number | null
}

interface ApiKeyInfo {
  source: string
  envVar: string
  keyHint: string | null
  expiresDate: string | null
  isValid: boolean
  daysUntilExpiry: number | null
  expiryStatus: string
  notes: string | null
}

export default function SourcesPage() {
  const [sources, setSources] = useState<SourceInfo[]>([])
  const [apiKeys, setApiKeys] = useState<ApiKeyInfo[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/system')
      .then(r => r.json())
      .then(data => {
        if (data.sourceHealth) {
          setSources(Object.entries(data.sourceHealth).map(([source, status]) => ({
            source,
            status: status as string,
            lastSuccessAt: null,
            lastErrorAt: null,
            lastErrorMessage: null,
            consecutiveFailures: 0,
            successRate30d: null,
            avgDurationSeconds: null,
          })))
        }
        if (data.apiKeys) {
          setApiKeys(Object.entries(data.apiKeys).map(([source, expiryStatus]) => ({
            source,
            envVar: source === 'sam_gov' ? 'SAM_GOV_API_KEY' : 'ANTHROPIC_API_KEY',
            keyHint: null,
            expiresDate: null,
            isValid: expiryStatus !== 'expired',
            daysUntilExpiry: null,
            expiryStatus: expiryStatus as string,
            notes: null,
          })))
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Sources</h1>
        <div className="mt-6 space-y-3">
          {[...Array(4)].map((_, i) => <div key={i} className="card animate-pulse h-16" />)}
        </div>
      </div>
    )
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900">Sources</h1>
      <p className="mt-1 text-sm text-gray-500">Data source health and API key management</p>

      {/* Source Health */}
      <div className="mt-6">
        <h2 className="text-lg font-semibold text-gray-900">Data Sources</h2>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {sources.map(s => (
            <div key={s.source} className="card flex items-start justify-between">
              <div>
                <h3 className="font-medium text-gray-900">{formatSource(s.source)}</h3>
                <p className="mt-1 text-xs text-gray-500">
                  {s.successRate30d != null ? `${s.successRate30d}% success rate (30d)` : 'No history yet'}
                </p>
                {s.avgDurationSeconds && (
                  <p className="text-xs text-gray-400">Avg {Math.round(s.avgDurationSeconds)}s per run</p>
                )}
              </div>
              <HealthBadge status={s.status} />
            </div>
          ))}
        </div>
      </div>

      {/* API Keys */}
      <div className="mt-8">
        <h2 className="text-lg font-semibold text-gray-900">API Keys</h2>
        <div className="mt-4 overflow-hidden rounded-xl border border-gray-200 bg-white">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Source</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Env Variable</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Expires</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {apiKeys.map(k => (
                <tr key={k.source} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm font-medium text-gray-900">{formatSource(k.source)}</td>
                  <td className="px-4 py-3"><code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded">{k.envVar}</code></td>
                  <td className="px-4 py-3"><ExpiryBadge status={k.expiryStatus} /></td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {k.daysUntilExpiry != null ? `${k.daysUntilExpiry} days` : k.expiresDate ?? 'No expiry'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
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

function formatSource(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}
