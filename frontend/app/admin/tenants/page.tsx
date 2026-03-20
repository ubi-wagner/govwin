'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { TenantWithStats } from '@/types'

export default function TenantsPage() {
  const [tenants, setTenants] = useState<TenantWithStats[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [error, setError] = useState<string | null>(null)

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

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Tenants</h1>
          <p className="mt-1 text-sm text-gray-500">{tenants.length} total customers</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="btn-primary">
          + New Tenant
        </button>
      </div>

      {showCreate && (
        <CreateTenantModal
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); loadTenants() }}
        />
      )}

      {error ? (
        <div className="mt-6 rounded-lg bg-red-50 p-4 text-sm text-red-700">
          Failed to load tenants: {error}
          <button onClick={loadTenants} className="ml-3 underline">Retry</button>
        </div>
      ) : loading ? (
        <div className="mt-6 space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="card animate-pulse h-20" />
          ))}
        </div>
      ) : tenants.length === 0 ? (
        <div className="mt-12 text-center">
          <p className="text-gray-500">No tenants yet</p>
          <button onClick={() => setShowCreate(true)} className="btn-primary mt-4">
            Create your first tenant
          </button>
        </div>
      ) : (
        <div className="mt-6 overflow-hidden rounded-xl border border-gray-200 bg-white">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Company</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Plan</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Status</th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase text-gray-500">Users</th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase text-gray-500">Opps</th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase text-gray-500">Pursuing</th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase text-gray-500">Avg Score</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {tenants.map(t => (
                <tr key={t.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3">
                    <Link href={`/admin/tenants/${t.id}`} className="font-medium text-brand-600 hover:text-brand-800">
                      {t.name}
                    </Link>
                    <p className="text-xs text-gray-400">/{t.slug}</p>
                  </td>
                  <td className="px-4 py-3">
                    <span className="badge-blue capitalize">{t.plan}</span>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={t.status} />
                  </td>
                  <td className="px-4 py-3 text-right text-sm text-gray-600">{t.userCount}</td>
                  <td className="px-4 py-3 text-right text-sm text-gray-600">{t.opportunityCount}</td>
                  <td className="px-4 py-3 text-right text-sm text-gray-600">{t.pursuingCount}</td>
                  <td className="px-4 py-3 text-right text-sm font-medium text-gray-900">
                    {t.avgScore ? `${t.avgScore}` : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    active: 'badge-green',
    trial: 'badge-blue',
    suspended: 'badge-yellow',
    churned: 'badge-red',
  }
  return <span className={styles[status] ?? 'badge-gray'}>{status}</span>
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
    } catch (err: any) {
      setError(err.message ?? 'Network error')
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
        <h2 className="text-lg font-semibold text-gray-900">New Tenant</h2>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          {error && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}

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
            <p className="mt-1 text-xs text-gray-400">Portal URL: /portal/{slug || '...'}/dashboard</p>
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

          <div className="flex justify-end gap-3 pt-2">
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
