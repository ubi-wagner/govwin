'use client'

import { useEffect, useState, useMemo } from 'react'
import Link from 'next/link'
import type { TenantWithStats } from '@/types'

type StatusFilter = 'all' | 'active' | 'trial' | 'suspended' | 'churned'
type SortField = 'name' | 'plan' | 'status' | 'userCount' | 'opportunityCount' | 'pursuingCount' | 'avgScore'

export default function TenantsPage() {
  const [tenants, setTenants] = useState<TenantWithStats[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [sortField, setSortField] = useState<SortField>('name')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  useEffect(() => { loadTenants() }, [])

  function loadTenants() {
    setLoading(true)
    setError(null)
    fetch('/api/tenants')
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then(d => setTenants(d.data ?? []))
      .catch(err => setError(err.message ?? 'Failed to load tenants'))
      .finally(() => setLoading(false))
  }

  const filtered = useMemo(() => {
    let result = tenants

    if (statusFilter !== 'all') {
      result = result.filter(t => t.status === statusFilter)
    }
    if (search.trim()) {
      const q = search.toLowerCase()
      result = result.filter(t =>
        t.name.toLowerCase().includes(q) ||
        t.slug.toLowerCase().includes(q) ||
        (t.primaryEmail?.toLowerCase().includes(q) ?? false)
      )
    }

    result = [...result].sort((a, b) => {
      let cmp = 0
      switch (sortField) {
        case 'name': cmp = a.name.localeCompare(b.name); break
        case 'plan': cmp = a.plan.localeCompare(b.plan); break
        case 'status': cmp = a.status.localeCompare(b.status); break
        case 'userCount': cmp = a.userCount - b.userCount; break
        case 'opportunityCount': cmp = a.opportunityCount - b.opportunityCount; break
        case 'pursuingCount': cmp = a.pursuingCount - b.pursuingCount; break
        case 'avgScore': cmp = (a.avgScore ?? 0) - (b.avgScore ?? 0); break
      }
      return sortDir === 'asc' ? cmp : -cmp
    })

    return result
  }, [tenants, search, statusFilter, sortField, sortDir])

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { all: tenants.length, active: 0, trial: 0, suspended: 0, churned: 0 }
    tenants.forEach(t => { counts[t.status] = (counts[t.status] ?? 0) + 1 })
    return counts
  }, [tenants])

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDir('asc')
    }
  }

  function SortIcon({ field }: { field: SortField }) {
    if (sortField !== field) return <span className="ml-1 text-gray-300">&uarr;</span>
    return <span className="ml-1 text-brand-600">{sortDir === 'asc' ? '\u2191' : '\u2193'}</span>
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Tenants</h1>
          <p className="mt-1 text-sm text-gray-500">{tenants.length} total customers</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="btn-primary gap-2">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          New Tenant
        </button>
      </div>

      {showCreate && (
        <CreateTenantModal
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); loadTenants() }}
        />
      )}

      {/* Summary Cards */}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {(['all', 'active', 'trial', 'suspended', 'churned'] as StatusFilter[]).map(s => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`card text-left transition-all ${statusFilter === s ? 'ring-2 ring-brand-500 border-brand-200' : 'hover:border-gray-300'}`}
          >
            <p className="text-xs font-medium uppercase tracking-wider text-gray-400">{s === 'all' ? 'All' : s}</p>
            <p className="mt-1 text-2xl font-black text-gray-900">{statusCounts[s] ?? 0}</p>
          </button>
        ))}
      </div>

      {/* Search + Filters */}
      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <svg className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
          </svg>
          <input
            type="text"
            placeholder="Search by name, slug, or email..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="input pl-10"
          />
        </div>
        <button onClick={loadTenants} disabled={loading} className="btn-secondary text-sm gap-2">
          <svg className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182" />
          </svg>
          Refresh
        </button>
      </div>

      {/* Content */}
      {error ? (
        <div className="mt-6 card border-red-200 bg-red-50">
          <div className="flex items-center gap-3">
            <svg className="h-5 w-5 text-red-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
            </svg>
            <p className="text-sm text-red-700">Failed to load tenants: {error}</p>
            <button onClick={loadTenants} className="ml-auto btn-secondary text-xs">Retry</button>
          </div>
        </div>
      ) : loading ? (
        <div className="mt-6 space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="card animate-pulse h-16" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="mt-12 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-gray-100">
            <svg className="h-6 w-6 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 21h19.5M3.75 3v18h6V12h4.5v9h6V3H3.75Z" />
            </svg>
          </div>
          <p className="mt-3 text-sm font-medium text-gray-500">
            {search || statusFilter !== 'all' ? 'No tenants match your filters' : 'No tenants yet'}
          </p>
          {!search && statusFilter === 'all' && (
            <button onClick={() => setShowCreate(true)} className="btn-primary mt-4">
              Create your first tenant
            </button>
          )}
        </div>
      ) : (
        <div className="mt-6 overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-card">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-surface-50">
                <tr>
                  <th className="px-5 py-3.5 text-left">
                    <button onClick={() => handleSort('name')} className="flex items-center text-xs font-bold uppercase tracking-wider text-gray-500 hover:text-gray-700">
                      Company<SortIcon field="name" />
                    </button>
                  </th>
                  <th className="px-5 py-3.5 text-left">
                    <button onClick={() => handleSort('plan')} className="flex items-center text-xs font-bold uppercase tracking-wider text-gray-500 hover:text-gray-700">
                      Plan<SortIcon field="plan" />
                    </button>
                  </th>
                  <th className="px-5 py-3.5 text-left">
                    <button onClick={() => handleSort('status')} className="flex items-center text-xs font-bold uppercase tracking-wider text-gray-500 hover:text-gray-700">
                      Status<SortIcon field="status" />
                    </button>
                  </th>
                  <th className="px-5 py-3.5 text-right">
                    <button onClick={() => handleSort('userCount')} className="flex items-center justify-end text-xs font-bold uppercase tracking-wider text-gray-500 hover:text-gray-700">
                      Users<SortIcon field="userCount" />
                    </button>
                  </th>
                  <th className="px-5 py-3.5 text-right">
                    <button onClick={() => handleSort('opportunityCount')} className="flex items-center justify-end text-xs font-bold uppercase tracking-wider text-gray-500 hover:text-gray-700">
                      Opps<SortIcon field="opportunityCount" />
                    </button>
                  </th>
                  <th className="px-5 py-3.5 text-right">
                    <button onClick={() => handleSort('pursuingCount')} className="flex items-center justify-end text-xs font-bold uppercase tracking-wider text-gray-500 hover:text-gray-700">
                      Pursuing<SortIcon field="pursuingCount" />
                    </button>
                  </th>
                  <th className="px-5 py-3.5 text-right">
                    <button onClick={() => handleSort('avgScore')} className="flex items-center justify-end text-xs font-bold uppercase tracking-wider text-gray-500 hover:text-gray-700">
                      Avg Score<SortIcon field="avgScore" />
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map(t => (
                  <tr key={t.id} className="hover:bg-surface-50 transition-colors">
                    <td className="px-5 py-4">
                      <Link href={`/admin/tenants/${t.id}`} className="group">
                        <p className="text-sm font-semibold text-gray-900 group-hover:text-brand-600 transition-colors">{t.name}</p>
                        <p className="text-xs text-gray-400 mt-0.5">/{t.slug}</p>
                      </Link>
                    </td>
                    <td className="px-5 py-4">
                      <PlanBadge plan={t.plan} />
                    </td>
                    <td className="px-5 py-4">
                      <StatusBadge status={t.status} />
                    </td>
                    <td className="px-5 py-4 text-right">
                      <span className="text-sm font-medium text-gray-700">{t.userCount}</span>
                    </td>
                    <td className="px-5 py-4 text-right">
                      <span className="text-sm font-medium text-gray-700">{t.opportunityCount}</span>
                    </td>
                    <td className="px-5 py-4 text-right">
                      <span className="text-sm font-medium text-gray-700">{t.pursuingCount}</span>
                    </td>
                    <td className="px-5 py-4 text-right">
                      {t.avgScore ? (
                        <span className={`text-sm font-bold ${
                          t.avgScore >= 80 ? 'text-emerald-600' : t.avgScore >= 60 ? 'text-amber-600' : 'text-gray-600'
                        }`}>
                          {t.avgScore}
                        </span>
                      ) : (
                        <span className="text-sm text-gray-400">-</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="border-t border-gray-100 bg-surface-50 px-5 py-3">
            <p className="text-xs text-gray-500">
              Showing {filtered.length} of {tenants.length} tenants
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

/* ─── Sub-components ──────────────────────────────────────── */

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    active: 'badge-green', trial: 'badge-blue', suspended: 'badge-yellow', churned: 'badge-red',
  }
  return <span className={styles[status] ?? 'badge-gray'}>{status}</span>
}

function PlanBadge({ plan }: { plan: string }) {
  const styles: Record<string, string> = {
    starter: 'badge-gray', professional: 'badge-blue', enterprise: 'badge-purple',
  }
  return <span className={styles[plan] ?? 'badge-gray'}>{plan}</span>
}

function CreateTenantModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [plan, setPlan] = useState('starter')
  const [email, setEmail] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function generateSlug(value: string) {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')

    try {
      const res = await fetch('/api/tenants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, slug, plan, primaryEmail: email || null }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? 'Failed to create tenant')
        setSaving(false)
        return
      }

      onCreated()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Network error'
      setError(message)
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay flex items-center justify-center" onClick={onClose}>
      <div className="modal-panel w-full max-w-md mx-4 p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900">New Tenant</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          {error && (
            <div className="rounded-xl bg-red-50 p-3 text-sm text-red-700 border border-red-100">{error}</div>
          )}

          <div>
            <label className="label">Company Name</label>
            <input
              className="input"
              value={name}
              onChange={e => { setName(e.target.value); if (!slug) setSlug(generateSlug(e.target.value)) }}
              required
              autoFocus
            />
          </div>

          <div>
            <label className="label">Slug</label>
            <input
              className="input"
              value={slug}
              onChange={e => setSlug(generateSlug(e.target.value))}
              placeholder="company-name"
              required
            />
            <p className="mt-1.5 text-xs text-gray-400">Portal URL: /portal/{slug || '...'}/dashboard</p>
          </div>

          <div>
            <label className="label">Plan</label>
            <select className="input" value={plan} onChange={e => setPlan(e.target.value)}>
              <option value="starter">Starter</option>
              <option value="professional">Professional</option>
              <option value="enterprise">Enterprise</option>
            </select>
          </div>

          <div>
            <label className="label">Primary Email (optional)</label>
            <input className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} />
          </div>

          <div className="flex justify-end gap-3 pt-3">
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? 'Creating...' : 'Create Tenant'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
