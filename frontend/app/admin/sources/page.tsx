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
  hasStoredKey?: boolean
  rotatedAt?: string | null
  issuedBy?: string | null
}

export default function SourcesPage() {
  const [sources, setSources] = useState<SourceInfo[]>([])
  const [apiKeys, setApiKeys] = useState<ApiKeyInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [rotateSource, setRotateSource] = useState<string | null>(null)

  const loadData = () => {
    setLoading(true)
    fetch('/api/system')
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
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
        // Fetch detailed key info for each source
        return Promise.all(
          ['sam_gov', 'anthropic'].map(s =>
            fetch(`/api/admin/api-keys/${s}`)
              .then(r => r.ok ? r.json() : null)
              .catch(() => null)
          )
        )
      })
      .then(keyResults => {
        if (keyResults) {
          setApiKeys(prev => prev.map(k => {
            const detail = keyResults.find(
              (r: { data?: ApiKeyInfo } | null) => r?.data?.source === k.source
            )
            if (detail?.data) {
              return {
                ...k,
                keyHint: detail.data.keyHint ?? k.keyHint,
                expiresDate: detail.data.expiresDate ?? k.expiresDate,
                daysUntilExpiry: detail.data.daysUntilExpiry ?? k.daysUntilExpiry,
                expiryStatus: detail.data.expiryStatus ?? k.expiryStatus,
                isValid: detail.data.isValid ?? k.isValid,
                hasStoredKey: detail.data.hasStoredKey ?? false,
                rotatedAt: detail.data.rotatedAt ?? null,
                issuedBy: detail.data.issuedBy ?? null,
              }
            }
            return k
          }))
        }
      })
      .catch(err => setError(err.message ?? 'Failed to load source data'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadData() }, [])

  if (error) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Sources</h1>
        <div className="mt-6 rounded-lg bg-red-50 p-4 text-sm text-red-700">
          Failed to load source data: {error}
        </div>
      </div>
    )
  }

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
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Key</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Expires</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Last Rotated</th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase text-gray-500">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {apiKeys.map(k => (
                <tr key={k.source} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm font-medium text-gray-900">{formatSource(k.source)}</td>
                  <td className="px-4 py-3">
                    {k.keyHint
                      ? <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded">{k.keyHint}</code>
                      : <span className="text-xs text-gray-400">env var only</span>
                    }
                  </td>
                  <td className="px-4 py-3"><ExpiryBadge status={k.expiryStatus} /></td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {k.daysUntilExpiry != null ? `${k.daysUntilExpiry} days` : k.expiresDate ?? 'No expiry'}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {k.rotatedAt ? new Date(k.rotatedAt).toLocaleDateString() : 'Never'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => setRotateSource(k.source)}
                      className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 transition-colors"
                    >
                      Rotate Key
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Rotate Key Modal */}
      {rotateSource && (
        <RotateKeyModal
          source={rotateSource}
          onClose={() => setRotateSource(null)}
          onSuccess={() => {
            setRotateSource(null)
            loadData()
          }}
        />
      )}
    </div>
  )
}

function RotateKeyModal({
  source,
  onClose,
  onSuccess,
}: {
  source: string
  onClose: () => void
  onSuccess: () => void
}) {
  const [apiKey, setApiKey] = useState('')
  const [expiresDate, setExpiresDate] = useState(() => {
    if (source === 'sam_gov') {
      const d = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000)
      return d.toISOString().split('T')[0]
    }
    return ''
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!apiKey.trim() || apiKey.trim().length < 8) {
      setError('API key must be at least 8 characters')
      return
    }

    setSaving(true)
    setError(null)

    try {
      const res = await fetch(`/api/admin/api-keys/${source}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: apiKey.trim(),
          expiresDate: expiresDate || undefined,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? `HTTP ${res.status}`)
      }

      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to rotate key')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold text-gray-900">
          Rotate {formatSource(source)} API Key
        </h3>
        <p className="mt-1 text-sm text-gray-500">
          The key will be encrypted at rest. It replaces any previously stored key.
        </p>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label htmlFor="apiKey" className="block text-sm font-medium text-gray-700">
              New API Key
            </label>
            <input
              id="apiKey"
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder="Paste your new API key"
              className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div>
            <label htmlFor="expiresDate" className="block text-sm font-medium text-gray-700">
              Expiration Date {source === 'sam_gov' && <span className="text-gray-400">(90 days default)</span>}
            </label>
            <input
              id="expiresDate"
              type="date"
              value={expiresDate}
              onChange={e => setExpiresDate(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>

          {error && (
            <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? 'Encrypting...' : 'Save & Rotate'}
            </button>
          </div>
        </form>
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
