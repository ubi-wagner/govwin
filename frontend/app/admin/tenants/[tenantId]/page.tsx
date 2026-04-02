'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import type { Tenant, TenantProfile, AppUser, TenantStatus, TenantPlan } from '@/types'

interface TenantDetail {
  tenant: Tenant
  profile: TenantProfile | null
  users: AppUser[]
  recentActions: Array<{
    actionType: string
    createdAt: string
    userName: string
    oppTitle: string
  }>
}

export default function TenantDetailPage() {
  const params = useParams()
  const router = useRouter()
  const tenantId = params.tenantId as string
  const [data, setData] = useState<TenantDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showAddUser, setShowAddUser] = useState(false)
  const [editing, setEditing] = useState(false)

  const loadTenant = useCallback(() => {
    setLoading(true)
    setError(null)
    fetch(`/api/tenants/${tenantId}`)
      .then(r => {
        if (r.status === 404) { router.push('/admin/tenants'); return null }
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then(d => { if (d) setData(d) })
      .catch(err => setError(err.message ?? 'Failed to load tenant'))
      .finally(() => setLoading(false))
  }, [tenantId, router])

  useEffect(() => { loadTenant() }, [loadTenant])

  if (loading) return <div className="animate-pulse"><div className="h-8 w-48 rounded bg-gray-200" /></div>
  if (error) return (
    <div>
      <div className="rounded-lg bg-red-50 p-4 text-sm text-red-700">
        Failed to load tenant: {error}
        <button onClick={loadTenant} className="ml-3 underline">Retry</button>
      </div>
    </div>
  )
  if (!data) return null

  const { tenant, profile, users, recentActions } = data

  return (
    <div>
      <div className="flex items-center gap-3">
        <Link href="/admin/tenants" className="text-sm text-gray-500 hover:text-gray-700">&larr; Tenants</Link>
        <span className="text-gray-300">/</span>
        <h1 className="text-2xl font-bold text-gray-900">{tenant.name}</h1>
        <StatusBadge status={tenant.status} />
      </div>
      <p className="mt-1 text-sm text-gray-500">/{tenant.slug} &middot; {tenant.plan} plan</p>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Company Info */}
        <div className="card lg:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">Company Info</h2>
            <button onClick={() => setEditing(!editing)} className="text-sm text-brand-600 hover:text-brand-800">
              {editing ? 'Cancel' : 'Edit'}
            </button>
          </div>
          {editing ? (
            <EditTenantForm tenant={tenant} onSaved={() => { setEditing(false); loadTenant() }} />
          ) : (
            <dl className="mt-4 grid grid-cols-2 gap-4">
              <Field label="Legal Name" value={tenant.legalName} />
              <Field label="Email" value={tenant.primaryEmail} />
              <Field label="Phone" value={tenant.primaryPhone} />
              <Field label="Website" value={tenant.website} />
              <Field label="UEI Number" value={tenant.ueiNumber} />
              <Field label="CAGE Code" value={tenant.cageCode} />
              <Field label="SAM Registered" value={tenant.samRegistered ? 'Yes' : 'No'} />
              <Field label="Onboarded" value={tenant.onboardedAt ? new Date(tenant.onboardedAt).toLocaleDateString() : 'Not yet'} />
            </dl>
          )}
          {tenant.internalNotes && (
            <div className="mt-4 rounded-lg bg-yellow-50 p-3">
              <p className="text-xs font-medium text-yellow-700">Internal Notes</p>
              <p className="mt-1 text-sm text-yellow-800">{tenant.internalNotes}</p>
            </div>
          )}
        </div>

        {/* Scoring Profile */}
        <div className="card">
          <h2 className="text-lg font-semibold text-gray-900">Scoring Profile</h2>
          {profile ? (
            <dl className="mt-4 space-y-3">
              <ProfileField label="Primary NAICS" value={profile.primaryNaics?.join(', ') || 'Not set'} />
              <ProfileField label="Secondary NAICS" value={profile.secondaryNaics?.join(', ') || 'Not set'} />
              <ProfileField label="Min Score" value={String(profile.minSurfaceScore)} />
              <ProfileField label="High Priority" value={`>= ${profile.highPriorityScore}`} />
              <div className="flex flex-wrap gap-1.5 pt-2">
                {profile.isSmallBusiness && <span className="badge-blue">Small Business</span>}
                {profile.isSdvosb && <span className="badge-blue">SDVOSB</span>}
                {profile.isWosb && <span className="badge-blue">WOSB</span>}
                {profile.isHubzone && <span className="badge-blue">HUBZone</span>}
                {profile.is8a && <span className="badge-blue">8(a)</span>}
              </div>
            </dl>
          ) : (
            <p className="mt-4 text-sm text-gray-500">No profile configured yet</p>
          )}
        </div>
      </div>

      {/* Users */}
      <div className="mt-6 card">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Users ({users.length})</h2>
          <button onClick={() => setShowAddUser(true)} className="btn-primary text-sm">+ Add User</button>
        </div>

        {showAddUser && (
          <AddUserModal
            tenantId={tenantId}
            onClose={() => setShowAddUser(false)}
            onCreated={() => { setShowAddUser(false); loadTenant() }}
          />
        )}

        {users.length > 0 ? (
          <table className="mt-4 min-w-full divide-y divide-gray-100">
            <thead>
              <tr>
                <th className="py-2 text-left text-xs font-medium uppercase text-gray-500">Name</th>
                <th className="py-2 text-left text-xs font-medium uppercase text-gray-500">Email</th>
                <th className="py-2 text-left text-xs font-medium uppercase text-gray-500">Role</th>
                <th className="py-2 text-left text-xs font-medium uppercase text-gray-500">Last Login</th>
                <th className="py-2 text-left text-xs font-medium uppercase text-gray-500">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {users.map((u: any) => (
                <tr key={u.id}>
                  <td className="py-2 text-sm font-medium text-gray-900">{u.name}</td>
                  <td className="py-2 text-sm text-gray-600">{u.email}</td>
                  <td className="py-2"><span className="badge-gray">{u.role}</span></td>
                  <td className="py-2 text-sm text-gray-500">
                    {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString() : 'Never'}
                  </td>
                  <td className="py-2">
                    <span className={u.isActive ? 'badge-green' : 'badge-red'}>
                      {u.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="mt-4 text-sm text-gray-500">No users yet</p>
        )}
      </div>

      {/* Recent Activity */}
      <div className="mt-6 card">
        <h2 className="text-lg font-semibold text-gray-900">Recent Activity</h2>
        {recentActions.length > 0 ? (
          <div className="mt-4 space-y-2">
            {recentActions.map((a, i) => (
              <div key={i} className="flex items-center gap-3 text-sm">
                <ActionIcon type={a.actionType} />
                <span className="font-medium text-gray-700">{a.userName}</span>
                <span className="text-gray-500">{a.actionType.replace('_', ' ')}</span>
                <span className="truncate text-gray-400">{a.oppTitle}</span>
                <span className="ml-auto text-xs text-gray-400">
                  {new Date(a.createdAt).toLocaleDateString()}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-4 text-sm text-gray-500">No activity yet</p>
        )}
      </div>

      {/* Portal Link */}
      <div className="mt-6">
        <Link href={`/portal/${tenant.slug}/dashboard`} className="btn-secondary">
          View as Tenant &rarr;
        </Link>
      </div>
    </div>
  )
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-xs font-medium text-gray-500">{label}</dt>
      <dd className="mt-0.5 text-sm text-gray-900">{value || <span className="text-gray-300">-</span>}</dd>
    </div>
  )
}

function ProfileField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium text-gray-500">{label}</dt>
      <dd className="text-sm text-gray-900">{value}</dd>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = { active: 'badge-green', trial: 'badge-blue', suspended: 'badge-yellow', churned: 'badge-red' }
  return <span className={styles[status] ?? 'badge-gray'}>{status}</span>
}

function ActionIcon({ type }: { type: string }) {
  const icons: Record<string, string> = {
    thumbs_up: 'text-green-500',
    thumbs_down: 'text-red-500',
    comment: 'text-blue-500',
    status_change: 'text-yellow-500',
    pin: 'text-purple-500',
  }
  return <span className={`text-base ${icons[type] ?? 'text-gray-400'}`}>
    {type === 'thumbs_up' ? '\u{1F44D}' : type === 'thumbs_down' ? '\u{1F44E}' : type === 'comment' ? '\u{1F4AC}' : type === 'pin' ? '\u{1F4CC}' : '\u{2022}'}
  </span>
}

function EditTenantForm({ tenant, onSaved }: { tenant: Tenant; onSaved: () => void }) {
  const [form, setForm] = useState({
    name: tenant.name,
    status: tenant.status,
    plan: tenant.plan,
    primary_email: tenant.primaryEmail ?? '',
    primary_phone: tenant.primaryPhone ?? '',
    website: tenant.website ?? '',
    uei_number: tenant.ueiNumber ?? '',
    cage_code: tenant.cageCode ?? '',
    sam_registered: tenant.samRegistered ?? false,
    billing_email: tenant.billingEmail ?? '',
    internal_notes: tenant.internalNotes ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setSaveError('')
    try {
      const res = await fetch(`/api/tenants/${tenant.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setSaveError(data.error ?? 'Failed to save')
        setSaving(false)
        return
      }
      onSaved()
    } catch {
      setSaveError('Network error')
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSave} className="mt-4 grid grid-cols-2 gap-4">
      {saveError && <div className="col-span-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">{saveError}</div>}
      <div>
        <label className="label">Name</label>
        <input className="input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
      </div>
      <div>
        <label className="label">Status</label>
        <select className="input" value={form.status} onChange={e => setForm({ ...form, status: e.target.value as TenantStatus })}>
          <option value="active">Active</option>
          <option value="trial">Trial</option>
          <option value="suspended">Suspended</option>
          <option value="churned">Churned</option>
        </select>
      </div>
      <div>
        <label className="label">Plan</label>
        <select className="input" value={form.plan} onChange={e => setForm({ ...form, plan: e.target.value as TenantPlan })}>
          <option value="starter">Starter</option>
          <option value="professional">Professional</option>
          <option value="enterprise">Enterprise</option>
        </select>
      </div>
      <div>
        <label className="label">Email</label>
        <input className="input" type="email" value={form.primary_email} onChange={e => setForm({ ...form, primary_email: e.target.value })} />
      </div>
      <div>
        <label className="label">Phone</label>
        <input className="input" value={form.primary_phone} onChange={e => setForm({ ...form, primary_phone: e.target.value })} />
      </div>
      <div>
        <label className="label">Website</label>
        <input className="input" value={form.website} onChange={e => setForm({ ...form, website: e.target.value })} />
      </div>
      <div>
        <label className="label">UEI Number</label>
        <input className="input" value={form.uei_number} onChange={e => setForm({ ...form, uei_number: e.target.value })} />
      </div>
      <div>
        <label className="label">CAGE Code</label>
        <input className="input" value={form.cage_code} onChange={e => setForm({ ...form, cage_code: e.target.value })} />
      </div>
      <div>
        <label className="label">SAM Registered</label>
        <select className="input" value={form.sam_registered ? 'true' : 'false'} onChange={e => setForm({ ...form, sam_registered: e.target.value === 'true' })}>
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
      </div>
      <div>
        <label className="label">Billing Email</label>
        <input className="input" type="email" value={form.billing_email} onChange={e => setForm({ ...form, billing_email: e.target.value })} />
      </div>
      <div className="col-span-2">
        <label className="label">Internal Notes</label>
        <textarea className="input" rows={2} value={form.internal_notes} onChange={e => setForm({ ...form, internal_notes: e.target.value })} />
      </div>
      <div className="col-span-2 flex justify-end">
        <button type="submit" disabled={saving} className="btn-primary">
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>
    </form>
  )
}

function AddUserModal({ tenantId, onClose, onCreated }: { tenantId: string; onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('tenant_user')
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<{ tempPassword: string } | null>(null)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')

    try {
      const res = await fetch(`/api/tenants/${tenantId}/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, role }),
      })

      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? 'Failed to create user')
        setSaving(false)
        return
      }

      setResult({ tempPassword: data._tempPassword })
    } catch (err: any) {
      setError(err.message ?? 'Network error')
      setSaving(false)
    }
  }

  if (result) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
        <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
          <h2 className="text-lg font-semibold text-green-700">User Created</h2>
          <div className="mt-4 rounded-lg bg-yellow-50 p-4">
            <p className="text-sm font-medium text-yellow-800">Temporary Password</p>
            <code className="mt-1 block text-lg font-mono font-bold text-yellow-900">{result.tempPassword}</code>
            <p className="mt-2 text-xs text-yellow-600">Share this securely with the user. They&apos;ll be prompted to change it on first login.</p>
          </div>
          <button onClick={onCreated} className="btn-primary mt-4 w-full">Done</button>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
        <h2 className="text-lg font-semibold text-gray-900">Add User</h2>
        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          {error && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}
          <div>
            <label className="label">Full Name</label>
            <input className="input" value={name} onChange={e => setName(e.target.value)} required autoFocus />
          </div>
          <div>
            <label className="label">Email</label>
            <input className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} required />
          </div>
          <div>
            <label className="label">Role</label>
            <select className="input" value={role} onChange={e => setRole(e.target.value)}>
              <option value="tenant_user">User</option>
              <option value="tenant_admin">Tenant Admin</option>
            </select>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? 'Creating...' : 'Create User'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
