'use client'

import { useEffect, useState, useCallback } from 'react'

interface ConsentRecord {
  id: string
  userId: string
  userName: string | null
  userEmail: string
  tenantId: string | null
  tenantName: string | null
  documentType: string
  documentVersion: string
  action: string
  summary: string | null
  entityType: string | null
  entityId: string | null
  ipAddress: string | null
  createdAt: string
}

interface LegalDocVersion {
  documentType: string
  version: string
  effectiveDate: string
  summaryOfChanges: string | null
  isCurrent: boolean
}

type Tab = 'consents' | 'approvals' | 'versions'

export default function CompliancePage() {
  const [tab, setTab] = useState<Tab>('consents')
  const [records, setRecords] = useState<ConsentRecord[]>([])
  const [versions, setVersions] = useState<LegalDocVersion[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      if (tab === 'versions') {
        const res = await fetch('/api/admin/compliance/versions')
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const d = await res.json()
        setVersions(d.data ?? [])
      } else {
        const view = tab === 'approvals' ? 'approvals' : 'consents'
        const res = await fetch(`/api/admin/compliance?view=${view}`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const d = await res.json()
        setRecords(d.data ?? [])
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load data')
    } finally {
      setLoading(false)
    }
  }, [tab])

  useEffect(() => { loadData() }, [loadData])

  const tabConfig: { key: Tab; label: string; description: string }[] = [
    { key: 'consents', label: 'Legal Consents', description: 'Terms, privacy, and authority acceptances' },
    { key: 'approvals', label: 'Document Approvals', description: 'Proposal and document sign-offs' },
    { key: 'versions', label: 'Policy Versions', description: 'Legal document version history' },
  ]

  return (
    <div>
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Compliance & Consent Audit</h1>
        <p className="mt-1 text-sm text-gray-500">
          Immutable records of all user consents, legal acceptances, and document approvals.
          Every record includes timestamp, IP address, and document version.
        </p>
      </div>

      {/* Tabs */}
      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {tabConfig.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`card text-left transition-all ${
              tab === t.key ? 'ring-2 ring-brand-500 border-brand-200' : 'hover:border-gray-300'
            }`}
          >
            <p className="text-sm font-bold text-gray-900">{t.label}</p>
            <p className="text-[11px] text-gray-500">{t.description}</p>
          </button>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div className="mt-4 card border-red-200 bg-red-50">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="mt-6 space-y-3">
          {[...Array(6)].map((_, i) => <div key={i} className="card animate-pulse h-14" />)}
        </div>
      ) : tab === 'versions' ? (
        <VersionsTable versions={versions} />
      ) : (
        <ConsentTable records={records} showTenant={tab === 'consents'} />
      )}
    </div>
  )
}

function ConsentTable({ records, showTenant }: { records: ConsentRecord[]; showTenant: boolean }) {
  if (records.length === 0) {
    return (
      <div className="mt-12 text-center">
        <p className="text-sm text-gray-500">No records found</p>
      </div>
    )
  }

  return (
    <div className="mt-6 overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-card">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-surface-50">
            <tr>
              <th className="px-5 py-3.5 text-left text-xs font-bold uppercase tracking-wider text-gray-500">User</th>
              {showTenant && <th className="px-5 py-3.5 text-left text-xs font-bold uppercase tracking-wider text-gray-500">Tenant</th>}
              <th className="px-5 py-3.5 text-left text-xs font-bold uppercase tracking-wider text-gray-500">Document</th>
              <th className="px-5 py-3.5 text-left text-xs font-bold uppercase tracking-wider text-gray-500">Version</th>
              <th className="px-5 py-3.5 text-left text-xs font-bold uppercase tracking-wider text-gray-500">Action</th>
              <th className="px-5 py-3.5 text-left text-xs font-bold uppercase tracking-wider text-gray-500">Summary</th>
              <th className="px-5 py-3.5 text-left text-xs font-bold uppercase tracking-wider text-gray-500">IP</th>
              <th className="px-5 py-3.5 text-left text-xs font-bold uppercase tracking-wider text-gray-500">Timestamp</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {records.map(r => (
              <tr key={r.id} className="hover:bg-surface-50 transition-colors">
                <td className="px-5 py-4">
                  <div className="text-sm font-semibold text-gray-900">{r.userName ?? 'Unknown'}</div>
                  <div className="text-[11px] text-gray-400">{r.userEmail}</div>
                </td>
                {showTenant && (
                  <td className="px-5 py-4 text-sm text-gray-600">{r.tenantName ?? '-'}</td>
                )}
                <td className="px-5 py-4">
                  <DocTypeBadge type={r.documentType} />
                  {r.entityType && (
                    <span className="ml-1.5 text-[10px] text-gray-400">{r.entityType}</span>
                  )}
                </td>
                <td className="px-5 py-4">
                  <code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">{r.documentVersion}</code>
                </td>
                <td className="px-5 py-4">
                  <ActionBadge action={r.action} />
                </td>
                <td className="px-5 py-4 text-xs text-gray-500 max-w-xs truncate" title={r.summary ?? ''}>
                  {r.summary ?? '-'}
                </td>
                <td className="px-5 py-4 text-xs text-gray-400 font-mono">{r.ipAddress ?? '-'}</td>
                <td className="px-5 py-4 text-xs text-gray-500 whitespace-nowrap">
                  {new Date(r.createdAt).toLocaleString(undefined, {
                    month: 'short', day: 'numeric', year: 'numeric',
                    hour: '2-digit', minute: '2-digit', second: '2-digit',
                  })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="border-t border-gray-100 px-5 py-3 text-xs text-gray-400">
        Showing {records.length} records. All consent records are immutable and retained for 7 years.
      </div>
    </div>
  )
}

function VersionsTable({ versions }: { versions: LegalDocVersion[] }) {
  if (versions.length === 0) {
    return (
      <div className="mt-12 text-center">
        <p className="text-sm text-gray-500">No legal document versions configured</p>
      </div>
    )
  }

  return (
    <div className="mt-6 overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-card">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-surface-50">
            <tr>
              <th className="px-5 py-3.5 text-left text-xs font-bold uppercase tracking-wider text-gray-500">Document</th>
              <th className="px-5 py-3.5 text-left text-xs font-bold uppercase tracking-wider text-gray-500">Version</th>
              <th className="px-5 py-3.5 text-left text-xs font-bold uppercase tracking-wider text-gray-500">Effective Date</th>
              <th className="px-5 py-3.5 text-left text-xs font-bold uppercase tracking-wider text-gray-500">Changes</th>
              <th className="px-5 py-3.5 text-center text-xs font-bold uppercase tracking-wider text-gray-500">Current</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {versions.map(v => (
              <tr key={`${v.documentType}-${v.version}`} className="hover:bg-surface-50 transition-colors">
                <td className="px-5 py-4">
                  <DocTypeBadge type={v.documentType} />
                </td>
                <td className="px-5 py-4">
                  <code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">{v.version}</code>
                </td>
                <td className="px-5 py-4 text-sm text-gray-600">{v.effectiveDate}</td>
                <td className="px-5 py-4 text-xs text-gray-500">{v.summaryOfChanges ?? '-'}</td>
                <td className="px-5 py-4 text-center">
                  {v.isCurrent ? (
                    <span className="badge-green">Active</span>
                  ) : (
                    <span className="badge-gray">Superseded</span>
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

function DocTypeBadge({ type }: { type: string }) {
  const styles: Record<string, string> = {
    terms_of_service: 'badge-blue',
    privacy_policy: 'badge-purple',
    acceptable_use: 'badge-yellow',
    ai_disclosure: 'badge-cyan',
    authority_representation: 'badge-red',
    document_approval: 'badge-green',
  }
  const labels: Record<string, string> = {
    terms_of_service: 'Terms',
    privacy_policy: 'Privacy',
    acceptable_use: 'AUP',
    ai_disclosure: 'AI',
    authority_representation: 'Authority',
    document_approval: 'Approval',
  }
  return <span className={styles[type] ?? 'badge-gray'}>{labels[type] ?? type}</span>
}

function ActionBadge({ action }: { action: string }) {
  const styles: Record<string, string> = {
    accept: 'badge-green',
    decline: 'badge-red',
    revoke: 'badge-yellow',
  }
  return <span className={styles[action] ?? 'badge-gray'}>{action}</span>
}
