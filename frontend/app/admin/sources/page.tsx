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
  lastValidatedAt?: string | null
  lastValidationOk?: boolean | null
  lastValidationMsg?: string | null
}

export default function SourcesPage() {
  const [sources, setSources] = useState<SourceInfo[]>([])
  const [apiKeys, setApiKeys] = useState<ApiKeyInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [rotateSource, setRotateSource] = useState<string | null>(null)
  const [validating, setValidating] = useState<string | null>(null)

  const loadData = () => {
    setLoading(true)
    setError(null)
    fetch('/api/system')
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then(data => {
        if (data.sourceHealth) {
          setSources(Object.entries(data.sourceHealth).map(([source, detail]) => {
            const d = detail as Record<string, any>
            return {
              source,
              status: d.status ?? 'unknown',
              lastSuccessAt: d.lastSuccessAt ?? null,
              lastErrorAt: d.lastErrorAt ?? null,
              lastErrorMessage: d.lastErrorMessage ?? null,
              consecutiveFailures: d.consecutiveFailures ?? 0,
              successRate30d: d.successRate30d ?? null,
              avgDurationSeconds: d.avgDurationSeconds ?? null,
            }
          }))
        }
        if (data.apiKeys) {
          setApiKeys(Object.entries(data.apiKeys).map(([source, detail]) => {
            const d = detail as Record<string, any>
            return {
              source,
              envVar: source === 'sam_gov' ? 'SAM_GOV_API_KEY' : 'ANTHROPIC_API_KEY',
              keyHint: d.keyHint ?? null,
              expiresDate: d.expiresDate ?? null,
              isValid: d.expiryStatus !== 'expired' && d.lastValidationOk !== false,
              daysUntilExpiry: d.daysUntilExpiry ?? null,
              expiryStatus: d.expiryStatus ?? 'no_expiry',
              notes: null,
              hasStoredKey: d.hasStoredKey ?? false,
              rotatedAt: d.rotatedAt ?? null,
              issuedBy: null,
              lastValidatedAt: d.lastValidatedAt ?? null,
              lastValidationOk: d.lastValidationOk ?? null,
              lastValidationMsg: d.lastValidationMsg ?? null,
            }
          }))
        }
      })
      .catch(err => setError(err.message ?? 'Failed to load source data'))
      .finally(() => setLoading(false))
  }

  async function validateKey(source: string) {
    setValidating(source)
    try {
      const res = await fetch(`/api/admin/api-keys/${source}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'validate' }),
      })
      if (!res.ok) {
        setError(`Validation request failed: HTTP ${res.status}`)
        return
      }
      loadData() // Reload to show updated validation status
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Validation failed')
    } finally {
      setValidating(null)
    }
  }

  useEffect(() => { loadData() }, [])

  if (loading) {
    return (
      <div className="animate-pulse">
        <div className="h-8 w-28 rounded-lg bg-gray-200" />
        <div className="mt-2 h-4 w-52 rounded bg-gray-100" />
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {[...Array(4)].map((_, i) => <div key={i} className="card h-32" />)}
        </div>
      </div>
    )
  }

  const healthySources = sources.filter(s => s.status === 'healthy').length
  const validKeys = apiKeys.filter(k => k.isValid).length

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Sources</h1>
          <p className="mt-1 text-sm text-gray-500">Data source health and API key management</p>
        </div>
        <button onClick={loadData} disabled={loading} className="btn-secondary text-sm gap-2">
          <svg className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182" />
          </svg>
          Refresh
        </button>
      </div>

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

      {/* Summary Stats */}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="card bg-emerald-50/50">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-100 text-emerald-600">
              <HeartIcon />
            </div>
            <div>
              <p className="text-xl font-black text-gray-900">{healthySources}/{sources.length}</p>
              <p className="text-xs font-medium text-gray-500">Healthy Sources</p>
            </div>
          </div>
        </div>
        <div className="card bg-brand-50/50">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-100 text-brand-600">
              <KeyIcon />
            </div>
            <div>
              <p className="text-xl font-black text-gray-900">{validKeys}/{apiKeys.length}</p>
              <p className="text-xs font-medium text-gray-500">Valid API Keys</p>
            </div>
          </div>
        </div>
        <div className="card">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gray-100 text-gray-500">
              <DatabaseIcon />
            </div>
            <div>
              <p className="text-xl font-black text-gray-900">{sources.length}</p>
              <p className="text-xs font-medium text-gray-500">Total Sources</p>
            </div>
          </div>
        </div>
        <div className="card">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gray-100 text-gray-500">
              <ShieldIcon />
            </div>
            <div>
              <p className="text-xl font-black text-gray-900">
                {apiKeys.filter(k => k.hasStoredKey).length}
              </p>
              <p className="text-xs font-medium text-gray-500">Encrypted Keys</p>
            </div>
          </div>
        </div>
      </div>

      {/* Source Health Cards */}
      <div className="mt-8">
        <h2 className="text-sm font-bold uppercase tracking-wider text-gray-400">Data Sources</h2>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {sources.map(s => (
            <SourceCard key={s.source} source={s} />
          ))}
          {sources.length === 0 && (
            <div className="col-span-full text-center py-8">
              <p className="text-sm text-gray-400">No sources configured</p>
            </div>
          )}
        </div>
      </div>

      {/* API Keys */}
      <div className="mt-8">
        <h2 className="text-sm font-bold uppercase tracking-wider text-gray-400">API Keys</h2>
        <div className="mt-4 space-y-3">
          {apiKeys.map(k => (
            <ApiKeyCard
              key={k.source}
              apiKey={k}
              onRotate={() => setRotateSource(k.source)}
              onValidate={() => validateKey(k.source)}
              isValidating={validating === k.source}
            />
          ))}
          {apiKeys.length === 0 && (
            <div className="text-center py-8">
              <p className="text-sm text-gray-400">No API keys configured</p>
            </div>
          )}
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

/* ─── Cards ──────────────────────────────────────────────── */

function SourceCard({ source }: { source: SourceInfo }) {
  const statusColors: Record<string, { bg: string; border: string; dot: string }> = {
    healthy:  { bg: 'bg-emerald-50/50', border: 'border-emerald-200', dot: 'bg-emerald-500' },
    degraded: { bg: 'bg-amber-50/50',   border: 'border-amber-200',   dot: 'bg-amber-500' },
    error:    { bg: 'bg-red-50/50',      border: 'border-red-200',     dot: 'bg-red-500' },
    unknown:  { bg: 'bg-gray-50',        border: 'border-gray-200',    dot: 'bg-gray-400' },
  }
  const c = statusColors[source.status] ?? statusColors.unknown

  return (
    <div className={`card ${c.bg} ${c.border}`}>
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <span className="relative flex h-3 w-3">
            {source.status === 'healthy' && (
              <span className={`absolute inline-flex h-full w-full animate-ping rounded-full ${c.dot} opacity-40`} />
            )}
            <span className={`relative inline-flex h-3 w-3 rounded-full ${c.dot}`} />
          </span>
          <div>
            <h3 className="text-sm font-bold text-gray-900">{formatSource(source.source)}</h3>
            <p className="mt-0.5 text-xs text-gray-500">
              {source.successRate30d != null ? `${source.successRate30d}% success rate (30d)` : 'No historical data'}
            </p>
          </div>
        </div>
        <HealthBadge status={source.status} />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-white/60 px-3 py-2">
          <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Avg Duration</p>
          <p className="mt-0.5 text-sm font-semibold text-gray-700">
            {source.avgDurationSeconds ? `${Math.round(source.avgDurationSeconds)}s` : '-'}
          </p>
        </div>
        <div className="rounded-xl bg-white/60 px-3 py-2">
          <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Failures</p>
          <p className={`mt-0.5 text-sm font-semibold ${source.consecutiveFailures > 0 ? 'text-red-600' : 'text-gray-700'}`}>
            {source.consecutiveFailures} consecutive
          </p>
        </div>
      </div>

      {source.lastErrorMessage && (
        <div className="mt-3 rounded-xl bg-red-50 px-3 py-2 border border-red-100">
          <p className="text-[10px] font-bold uppercase tracking-wider text-red-400">Last Error</p>
          <p className="mt-0.5 text-xs text-red-600 truncate" title={source.lastErrorMessage}>
            {source.lastErrorMessage}
          </p>
        </div>
      )}
    </div>
  )
}

function ApiKeyCard({ apiKey, onRotate, onValidate, isValidating }: {
  apiKey: ApiKeyInfo; onRotate: () => void; onValidate: () => void; isValidating: boolean
}) {
  // Determine true validity: not expired AND (never tested OR last test passed)
  const expiryOk = apiKey.expiryStatus !== 'expired'
  const validationFailed = apiKey.lastValidationOk === false
  const neverValidated = apiKey.lastValidationOk == null
  const trueValid = expiryOk && !validationFailed

  const borderColor = !trueValid ? 'border-red-200 bg-red-50/30'
    : validationFailed ? 'border-red-200 bg-red-50/30'
    : apiKey.expiryStatus === 'expiring_soon' ? 'border-amber-200 bg-amber-50/30'
    : neverValidated && apiKey.hasStoredKey ? 'border-amber-200 bg-amber-50/20'
    : 'border-gray-200/80 bg-white'

  return (
    <div className={`card ${borderColor}`}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${
            trueValid ? 'bg-emerald-100 text-emerald-600' : 'bg-red-100 text-red-600'
          }`}>
            <KeyIcon />
          </div>
          <div>
            <h3 className="text-sm font-bold text-gray-900">{formatSource(apiKey.source)}</h3>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              {apiKey.keyHint ? (
                <code className="rounded-lg bg-gray-100 px-2.5 py-1 text-xs font-mono text-gray-600">{apiKey.keyHint}</code>
              ) : (
                <span className="text-xs text-gray-400">env var only</span>
              )}
              <ExpiryBadge status={apiKey.expiryStatus} />
              {apiKey.hasStoredKey && <span className="badge-green">Encrypted</span>}
              {validationFailed && <span className="badge-red">Connectivity failed</span>}
              {neverValidated && apiKey.hasStoredKey && <span className="badge-yellow">Not tested</span>}
              {apiKey.lastValidationOk === true && <span className="badge-green">Verified</span>}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4 sm:gap-6">
          <div className="text-right">
            <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Expires</p>
            <p className="text-sm font-medium text-gray-700">
              {apiKey.daysUntilExpiry != null ? `${apiKey.daysUntilExpiry} days` : apiKey.expiresDate ?? 'No expiry'}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Rotated</p>
            <p className="text-sm font-medium text-gray-700">
              {apiKey.rotatedAt ? new Date(apiKey.rotatedAt).toLocaleDateString() : 'Never'}
            </p>
          </div>
          {apiKey.hasStoredKey && (
            <button onClick={onValidate} disabled={isValidating} className="btn-secondary text-xs">
              {isValidating ? 'Testing...' : 'Test Key'}
            </button>
          )}
          <button onClick={onRotate} className="btn-primary text-xs">
            Rotate Key
          </button>
        </div>
      </div>

      {/* Honest validation status commentary */}
      {validationFailed && apiKey.lastValidationMsg && (
        <div className="mt-3 rounded-xl bg-red-50 px-3 py-2 border border-red-100">
          <p className="text-[10px] font-bold uppercase tracking-wider text-red-400">Last Validation Failed</p>
          <p className="mt-0.5 text-xs text-red-600">{apiKey.lastValidationMsg}</p>
          {apiKey.lastValidatedAt && (
            <p className="mt-0.5 text-[10px] text-red-400">Tested {new Date(apiKey.lastValidatedAt).toLocaleString()}</p>
          )}
        </div>
      )}
      {neverValidated && apiKey.hasStoredKey && (
        <div className="mt-3 rounded-xl bg-amber-50 px-3 py-2 border border-amber-100">
          <p className="text-xs text-amber-700">
            Key stored but never tested against {formatSource(apiKey.source)}. Expiry date does not confirm the key actually works.
          </p>
        </div>
      )}
    </div>
  )
}

/* ─── Rotate Key Modal ───────────────────────────────────── */

function RotateKeyModal({
  source, onClose, onSuccess,
}: {
  source: string; onClose: () => void; onSuccess: () => void
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
    <div className="modal-overlay flex items-center justify-center" onClick={onClose}>
      <div className="modal-panel w-full max-w-md mx-4 p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-100 text-brand-600">
              <ShieldIcon />
            </div>
            <div>
              <h3 className="text-lg font-bold text-gray-900">Rotate API Key</h3>
              <p className="text-xs text-gray-500">{formatSource(source)}</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="mt-3 rounded-xl bg-blue-50 px-4 py-3 border border-blue-100">
          <p className="text-xs text-blue-700">
            The key will be encrypted with AES-256-GCM at rest. It replaces any previously stored key.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <div>
            <label className="label">New API Key</label>
            <input
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder="Paste your new API key"
              className="input font-mono"
            />
          </div>

          <div>
            <label className="label">
              Expiration Date {source === 'sam_gov' && <span className="text-gray-400 font-normal">(90 days default)</span>}
            </label>
            <input
              type="date"
              value={expiresDate}
              onChange={e => setExpiresDate(e.target.value)}
              className="input"
            />
          </div>

          {error && (
            <div className="rounded-xl bg-red-50 p-3 text-sm text-red-700 border border-red-100">{error}</div>
          )}

          <div className="flex justify-end gap-3 pt-3">
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? 'Encrypting...' : 'Save & Rotate'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

/* ─── Sub-components ──────────────────────────────────────── */

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

/* ─── SVG Icons ──────────────────────────────────────────── */

function HeartIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12Z" />
    </svg>
  )
}

function KeyIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1 1 21.75 8.25Z" />
    </svg>
  )
}

function DatabaseIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125" />
    </svg>
  )
}

function ShieldIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
    </svg>
  )
}
