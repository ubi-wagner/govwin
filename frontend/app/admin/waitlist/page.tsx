'use client'

import { useState, useEffect, useMemo } from 'react'

interface WaitlistEntry {
  id: number
  email: string
  fullName: string | null
  phone: string | null
  company: string | null
  companySize: string | null
  technology: string | null
  notes: string | null
  plan: string | null
  billingPeriod: string | null
  ipAddress: string | null
  userAgent: string | null
  referer: string | null
  country: string | null
  region: string | null
  city: string | null
  createdAt: string
}

export default function WaitlistPage() {
  const [entries, setEntries] = useState<WaitlistEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [expandedId, setExpandedId] = useState<number | null>(null)

  useEffect(() => {
    fetchWaitlist()
  }, [])

  async function fetchWaitlist() {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/waitlist')
      if (!res.ok) throw new Error('Failed to fetch')
      const json = await res.json()
      setEntries(json.data ?? [])
    } catch {
      setError('Failed to load waitlist data.')
    } finally {
      setLoading(false)
    }
  }

  const filtered = useMemo(() => {
    if (!search.trim()) return entries
    const q = search.toLowerCase()
    return entries.filter(e =>
      e.email.toLowerCase().includes(q) ||
      e.fullName?.toLowerCase().includes(q) ||
      e.company?.toLowerCase().includes(q) ||
      e.technology?.toLowerCase().includes(q)
    )
  }, [entries, search])

  function formatDate(iso: string) {
    const d = new Date(iso)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
      ' ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  }

  function formatLocation(e: WaitlistEntry) {
    const parts = [e.city, e.region, e.country].filter(Boolean)
    return parts.length > 0 ? parts.join(', ') : null
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-300 border-t-brand-600" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="mx-auto max-w-2xl py-16 text-center">
        <p className="text-sm text-red-600 font-medium">{error}</p>
        <button onClick={fetchWaitlist} className="btn-primary mt-4 px-6 py-2 text-sm">
          Retry
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Waitlist</h1>
          <p className="mt-1 text-sm text-gray-500">
            {entries.length} signup{entries.length !== 1 ? 's' : ''} total
          </p>
        </div>
        <button onClick={fetchWaitlist} className="btn-secondary px-4 py-2 text-sm">
          Refresh
        </button>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="card p-4">
          <p className="text-xs font-bold uppercase tracking-wider text-gray-400">Total</p>
          <p className="mt-1 text-2xl font-extrabold text-gray-900">{entries.length}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs font-bold uppercase tracking-wider text-gray-400">With Company</p>
          <p className="mt-1 text-2xl font-extrabold text-gray-900">{entries.filter(e => e.company).length}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs font-bold uppercase tracking-wider text-gray-400">With Phone</p>
          <p className="mt-1 text-2xl font-extrabold text-gray-900">{entries.filter(e => e.phone).length}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs font-bold uppercase tracking-wider text-gray-400">Today</p>
          <p className="mt-1 text-2xl font-extrabold text-gray-900">
            {entries.filter(e => new Date(e.createdAt).toDateString() === new Date().toDateString()).length}
          </p>
        </div>
      </div>

      {/* Search */}
      <div>
        <input
          type="text"
          className="input max-w-sm"
          placeholder="Search by name, email, company, or technology..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="card p-12 text-center">
          <p className="text-sm text-gray-500">
            {search ? 'No signups match your search.' : 'No waitlist signups yet.'}
          </p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/50">
                  <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-gray-500">Date/Time</th>
                  <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-gray-500">Name</th>
                  <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-gray-500">Email</th>
                  <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-gray-500">Company</th>
                  <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-gray-500">Size</th>
                  <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-gray-500">Technology</th>
                  <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-gray-500">Location</th>
                  <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-gray-500 w-8"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map(entry => {
                  const expanded = expandedId === entry.id
                  const location = formatLocation(entry)
                  return (
                    <WaitlistRow
                      key={entry.id}
                      entry={entry}
                      expanded={expanded}
                      location={location}
                      formatDate={formatDate}
                      onToggle={() => setExpandedId(expanded ? null : entry.id)}
                    />
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function WaitlistRow({ entry, expanded, location, formatDate, onToggle }: {
  entry: WaitlistEntry
  expanded: boolean
  location: string | null
  formatDate: (iso: string) => string
  onToggle: () => void
}) {
  return (
    <>
      <tr
        className="hover:bg-gray-50/50 cursor-pointer transition-colors"
        onClick={onToggle}
      >
        <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">{formatDate(entry.createdAt)}</td>
        <td className="px-4 py-3 font-medium text-gray-900">{entry.fullName ?? '—'}</td>
        <td className="px-4 py-3 text-gray-600">
          <a href={`mailto:${entry.email}`} className="hover:text-brand-600 hover:underline" onClick={e => e.stopPropagation()}>
            {entry.email}
          </a>
        </td>
        <td className="px-4 py-3 text-gray-600">{entry.company ?? '—'}</td>
        <td className="px-4 py-3 text-gray-500">{entry.companySize ?? '—'}</td>
        <td className="px-4 py-3 text-gray-500 max-w-[200px] truncate">{entry.technology ?? '—'}</td>
        <td className="px-4 py-3 text-gray-500 text-xs">{location ?? '—'}</td>
        <td className="px-4 py-3">
          <svg className={`h-4 w-4 text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
          </svg>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={8} className="bg-gray-50/80 px-4 py-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 text-xs">
              <DetailField label="Phone" value={entry.phone} />
              <DetailField label="Plan Selected" value={entry.plan} />
              <DetailField label="Billing Period" value={entry.billingPeriod} />
              <DetailField label="IP Address" value={entry.ipAddress} />
              <DetailField label="Location" value={location} />
              <DetailField label="Referer" value={entry.referer} />
              {entry.notes && (
                <div className="sm:col-span-2 lg:col-span-3">
                  <DetailField label="Notes for Team" value={entry.notes} />
                </div>
              )}
              {entry.userAgent && (
                <div className="sm:col-span-2 lg:col-span-3">
                  <DetailField label="User Agent" value={entry.userAgent} />
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

function DetailField({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <p className="font-bold uppercase tracking-wider text-gray-400 text-[10px]">{label}</p>
      <p className="mt-0.5 text-gray-700 break-all">{value ?? '—'}</p>
    </div>
  )
}
