'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'

/* ── Types ────────────────────────────────────────── */

interface LibraryUnit {
  id: string
  content: string
  contentType: string
  category: string
  subcategory: string | null
  tags: string[]
  confidenceScore: number | null
  status: string
  sourceUploadId: string | null
  originType: string
  hasEmbedding: boolean
  createdAt: string
  updatedAt: string
  sourceFilename: string | null
}

/* ── Constants ────────────────────────────────────── */

const CATEGORIES = [
  'bio', 'facility', 'tech_approach', 'past_performance', 'management',
  'commercialization', 'budget', 'timeline', 'innovation', 'team',
  'references', 'appendix', 'cover_letter', 'executive_summary', 'other',
] as const

const CATEGORY_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  bio:                 { bg: 'bg-blue-100',    text: 'text-blue-700',    label: 'Bio' },
  facility:            { bg: 'bg-slate-100',   text: 'text-slate-700',   label: 'Facility' },
  tech_approach:       { bg: 'bg-purple-100',  text: 'text-purple-700',  label: 'Tech Approach' },
  past_performance:    { bg: 'bg-green-100',   text: 'text-green-700',   label: 'Past Performance' },
  management:          { bg: 'bg-orange-100',  text: 'text-orange-700',  label: 'Management' },
  commercialization:   { bg: 'bg-cyan-100',    text: 'text-cyan-700',    label: 'Commercialization' },
  budget:              { bg: 'bg-amber-100',   text: 'text-amber-700',   label: 'Budget' },
  timeline:            { bg: 'bg-rose-100',    text: 'text-rose-700',    label: 'Timeline' },
  innovation:          { bg: 'bg-indigo-100',  text: 'text-indigo-700',  label: 'Innovation' },
  team:                { bg: 'bg-teal-100',    text: 'text-teal-700',    label: 'Team' },
  references:          { bg: 'bg-gray-100',    text: 'text-gray-700',    label: 'References' },
  appendix:            { bg: 'bg-stone-100',   text: 'text-stone-700',   label: 'Appendix' },
  cover_letter:        { bg: 'bg-sky-100',     text: 'text-sky-700',     label: 'Cover Letter' },
  executive_summary:   { bg: 'bg-violet-100',  text: 'text-violet-700',  label: 'Executive Summary' },
  other:               { bg: 'bg-neutral-100', text: 'text-neutral-700', label: 'Other' },
}

const FILTER_TABS = [
  { value: '', label: 'All' },
  { value: 'bio', label: 'Bio' },
  { value: 'tech_approach', label: 'Tech Approach' },
  { value: 'past_performance', label: 'Past Performance' },
  { value: 'management', label: 'Management' },
  { value: 'innovation', label: 'Innovation' },
  { value: 'other', label: 'Other' },
]

const STATUS_TABS = [
  { value: '', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'approved', label: 'Approved' },
  { value: 'archived', label: 'Archived' },
]

const STATUS_STYLES: Record<string, string> = {
  draft:    'bg-gray-100 text-gray-600',
  approved: 'bg-green-100 text-green-700',
  archived: 'bg-slate-100 text-slate-500',
}

const ORIGIN_LABELS: Record<string, string> = {
  upload:  'Uploaded',
  manual:  'Manual',
  harvest: 'Harvested',
  ai:      'AI Generated',
}

const PAGE_SIZE = 20

/* ── Main Page Component ──────────────────────────── */

export default function LibraryPage() {
  const params = useParams()
  const tenantSlug = params.tenantSlug as string

  const [units, setUnits] = useState<LibraryUnit[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Filters
  const [categoryFilter, setCategoryFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [page, setPage] = useState(1)

  // Modal
  const [showCreate, setShowCreate] = useState(false)

  // Action feedback
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(timer)
  }, [search])

  // Reset page when filters change
  useEffect(() => {
    setPage(1)
  }, [categoryFilter, statusFilter, debouncedSearch])

  const loadUnits = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const queryParams = new URLSearchParams({
        page: String(page),
        limit: String(PAGE_SIZE),
      })
      if (categoryFilter) queryParams.set('category', categoryFilter)
      if (statusFilter) queryParams.set('status', statusFilter)
      if (debouncedSearch.trim()) queryParams.set('search', debouncedSearch.trim())

      const res = await fetch(`/api/portal/${tenantSlug}/library?${queryParams}`)
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Failed to load library')
      }
      const json = await res.json().catch(() => ({}))
      setUnits(json.data ?? [])
      setTotal(json.total ?? 0)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load library')
    } finally {
      setLoading(false)
    }
  }, [tenantSlug, page, categoryFilter, statusFilter, debouncedSearch])

  useEffect(() => { loadUnits() }, [loadUnits])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  // Status counts for the stats bar
  const draftCount = units.filter(u => u.status === 'draft').length
  const approvedCount = units.filter(u => u.status === 'approved').length
  const archivedCount = units.filter(u => u.status === 'archived').length

  // Top category counts from current page
  const categoryCounts: Record<string, number> = {}
  for (const u of units) {
    categoryCounts[u.category] = (categoryCounts[u.category] ?? 0) + 1
  }
  const topCategories = Object.entries(categoryCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)

  async function handleAction(unitId: string, action: 'approved' | 'rejected' | 'archived') {
    setActionLoading(unitId)
    try {
      const res = await fetch(`/api/portal/${tenantSlug}/library/${unitId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: action }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `Failed to ${action} unit`)
      }
      await loadUnits()
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to ${action} unit`)
    } finally {
      setActionLoading(null)
    }
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Library</h1>
          <p className="mt-1 text-sm text-gray-500">
            {total} unit{total !== 1 ? 's' : ''} total
          </p>
        </div>
        <button onClick={() => setShowCreate(true)} className="btn-primary text-sm gap-2">
          <PlusIcon />
          Add Unit
        </button>
      </div>

      {/* Stats bar */}
      <div className="mt-6 flex flex-wrap gap-3">
        <StatBadge label="Total" value={total} className="bg-gray-100 text-gray-700" />
        <StatBadge label="Draft" value={draftCount} className="bg-gray-100 text-gray-600" />
        <StatBadge label="Approved" value={approvedCount} className="bg-green-100 text-green-700" />
        <StatBadge label="Archived" value={archivedCount} className="bg-slate-100 text-slate-500" />
        {topCategories.map(([cat, count]) => {
          const style = CATEGORY_STYLES[cat] ?? CATEGORY_STYLES.other
          return (
            <StatBadge
              key={cat}
              label={style.label}
              value={count}
              className={`${style.bg} ${style.text}`}
            />
          )
        })}
      </div>

      {/* Category filter tabs */}
      <div className="mt-6 flex flex-wrap gap-1">
        {FILTER_TABS.map(tab => (
          <button
            key={tab.value}
            onClick={() => setCategoryFilter(tab.value)}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
              categoryFilter === tab.value
                ? 'bg-brand-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Status filter + search */}
      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex gap-1">
          {STATUS_TABS.map(tab => (
            <button
              key={tab.value}
              onClick={() => setStatusFilter(tab.value)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                statusFilter === tab.value
                  ? 'bg-gray-900 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="relative flex-1">
          <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search library content..."
            className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm text-gray-900 placeholder-gray-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mt-6 rounded-lg bg-red-50 p-4 text-sm text-red-700">
          {error}
          <button onClick={loadUnits} className="ml-3 underline">Retry</button>
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="card animate-pulse h-56" />
          ))}
        </div>
      ) : units.length === 0 ? (
        <div className="mt-12 text-center">
          <div className="mx-auto h-16 w-16 rounded-full bg-brand-50 flex items-center justify-center">
            <LibraryIcon />
          </div>
          <h3 className="mt-4 text-sm font-bold text-gray-900">No library units found</h3>
          <p className="mt-1 text-sm text-gray-500">
            {categoryFilter || statusFilter || debouncedSearch
              ? 'Try adjusting your filters or search terms.'
              : 'Add your first reusable content unit to build your proposal library.'}
          </p>
          {!categoryFilter && !statusFilter && !debouncedSearch && (
            <button onClick={() => setShowCreate(true)} className="mt-4 btn-primary text-sm">
              Add First Unit
            </button>
          )}
        </div>
      ) : (
        <>
          {/* Unit cards grid */}
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {units.map(unit => (
              <UnitCard
                key={unit.id}
                unit={unit}
                actionLoading={actionLoading === unit.id}
                onApprove={() => handleAction(unit.id, 'approved')}
                onReject={() => handleAction(unit.id, 'rejected')}
                onArchive={() => handleAction(unit.id, 'archived')}
              />
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="mt-8 flex items-center justify-between">
              <p className="text-sm text-gray-500">
                Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Previous
                </button>
                <span className="flex items-center px-2 text-sm text-gray-500">
                  Page {page} of {totalPages}
                </span>
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Create modal */}
      {showCreate && (
        <CreateUnitModal
          slug={tenantSlug}
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); loadUnits() }}
        />
      )}
    </div>
  )
}

/* ── Unit Card ────────────────────────────────────── */

function UnitCard({
  unit,
  actionLoading,
  onApprove,
  onReject,
  onArchive,
}: {
  unit: LibraryUnit
  actionLoading: boolean
  onApprove: () => void
  onReject: () => void
  onArchive: () => void
}) {
  const catStyle = CATEGORY_STYLES[unit.category] ?? CATEGORY_STYLES.other
  const statusStyle = STATUS_STYLES[unit.status] ?? STATUS_STYLES.draft
  const preview = unit.content.length > 200
    ? unit.content.slice(0, 200) + '...'
    : unit.content
  const score = unit.confidenceScore

  return (
    <div className="card !p-4 flex flex-col gap-3">
      {/* Top row: category badge + status */}
      <div className="flex items-start justify-between gap-2">
        <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${catStyle.bg} ${catStyle.text}`}>
          {catStyle.label}
        </span>
        <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${statusStyle}`}>
          {unit.status}
        </span>
      </div>

      {/* Content preview */}
      <p className="text-sm text-gray-700 leading-relaxed line-clamp-4 flex-1">
        {preview}
      </p>

      {/* Subcategory */}
      {unit.subcategory && (
        <p className="text-xs text-gray-500">
          <span className="font-medium text-gray-600">{unit.subcategory}</span>
        </p>
      )}

      {/* Tags */}
      {unit.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {unit.tags.slice(0, 5).map(tag => (
            <span key={tag} className="inline-flex rounded-md bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600">
              {tag}
            </span>
          ))}
          {unit.tags.length > 5 && (
            <span className="text-[10px] text-gray-400">+{unit.tags.length - 5} more</span>
          )}
        </div>
      )}

      {/* Confidence score bar */}
      {score != null && (
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-medium text-gray-500">Confidence</span>
          <div className="flex-1 h-1.5 rounded-full bg-gray-200 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                score > 0.8 ? 'bg-green-500' :
                score > 0.5 ? 'bg-yellow-500' :
                'bg-red-500'
              }`}
              style={{ width: `${Math.round(score * 100)}%` }}
            />
          </div>
          <span className="text-[10px] font-mono text-gray-500">{Math.round(score * 100)}%</span>
        </div>
      )}

      {/* Meta row: origin + date */}
      <div className="flex items-center justify-between text-[10px] text-gray-400 border-t border-gray-100 pt-2">
        <div className="flex items-center gap-1.5">
          <OriginIcon type={unit.originType} />
          <span>{ORIGIN_LABELS[unit.originType] ?? unit.originType}</span>
        </div>
        <span>{new Date(unit.createdAt).toLocaleDateString()}</span>
      </div>

      {/* Action buttons */}
      {unit.status === 'draft' && (
        <div className="flex gap-2">
          <button
            onClick={onApprove}
            disabled={actionLoading}
            className="flex-1 rounded-lg bg-green-50 px-2 py-1.5 text-xs font-medium text-green-700 hover:bg-green-100 transition-colors disabled:opacity-40"
          >
            {actionLoading ? '...' : 'Approve'}
          </button>
          <button
            onClick={onReject}
            disabled={actionLoading}
            className="flex-1 rounded-lg bg-red-50 px-2 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100 transition-colors disabled:opacity-40"
          >
            {actionLoading ? '...' : 'Reject'}
          </button>
          <button
            onClick={onArchive}
            disabled={actionLoading}
            className="flex-1 rounded-lg bg-gray-50 px-2 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 transition-colors disabled:opacity-40"
          >
            {actionLoading ? '...' : 'Archive'}
          </button>
        </div>
      )}
      {unit.status === 'approved' && (
        <div className="flex gap-2">
          <button
            onClick={onArchive}
            disabled={actionLoading}
            className="flex-1 rounded-lg bg-gray-50 px-2 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 transition-colors disabled:opacity-40"
          >
            {actionLoading ? '...' : 'Archive'}
          </button>
        </div>
      )}
    </div>
  )
}

/* ── Stats Badge ──────────────────────────────────── */

function StatBadge({ label, value, className }: { label: string; value: number; className: string }) {
  return (
    <div className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${className}`}>
      {label}
      <span className="font-bold">{value}</span>
    </div>
  )
}

/* ── Create Unit Modal ────────────────────────────── */

function CreateUnitModal({ slug, onClose, onCreated }: {
  slug: string; onClose: () => void; onCreated: () => void
}) {
  const [content, setContent] = useState('')
  const [category, setCategory] = useState<string>('other')
  const [subcategory, setSubcategory] = useState('')
  const [tagsInput, setTagsInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleCreate() {
    if (!content.trim()) {
      setError('Content is required')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const tags = tagsInput
        .split(',')
        .map(t => t.trim())
        .filter(t => t.length > 0)

      const res = await fetch(`/api/portal/${slug}/library`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: content.trim(),
          category,
          subcategory: subcategory.trim() || null,
          tags,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      onCreated()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create unit')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-elevated max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-bold text-gray-900">Add Library Unit</h2>
        <p className="mt-1 text-sm text-gray-500">Create a reusable content block for your proposal library.</p>

        <div className="mt-4 space-y-4">
          <div>
            <label className="label">Content</label>
            <textarea
              className="input min-h-[120px] resize-y"
              value={content}
              onChange={e => setContent(e.target.value)}
              placeholder="Paste or type the reusable content..."
              rows={5}
            />
          </div>

          <div>
            <label className="label">Category</label>
            <select
              className="input"
              value={category}
              onChange={e => setCategory(e.target.value)}
            >
              {CATEGORIES.map(cat => (
                <option key={cat} value={cat}>
                  {CATEGORY_STYLES[cat]?.label ?? cat}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="label">Subcategory</label>
            <input
              className="input"
              value={subcategory}
              onChange={e => setSubcategory(e.target.value)}
              placeholder="e.g. Project Manager, Cloud Infrastructure"
            />
          </div>

          <div>
            <label className="label">Tags</label>
            <input
              className="input"
              value={tagsInput}
              onChange={e => setTagsInput(e.target.value)}
              placeholder="Comma-separated: DoD, cybersecurity, FedRAMP"
            />
            <p className="mt-1 text-xs text-gray-400">Separate multiple tags with commas</p>
          </div>
        </div>

        {error && (
          <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
        )}

        <div className="mt-6 flex justify-end gap-3">
          <button onClick={onClose} className="btn-secondary text-sm">Cancel</button>
          <button onClick={handleCreate} disabled={saving} className="btn-primary text-sm">
            {saving ? 'Adding...' : 'Add Unit'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── Icons ────────────────────────────────────────── */

function PlusIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
    </svg>
  )
}

function LibraryIcon() {
  return (
    <svg className="h-8 w-8 text-brand-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" />
    </svg>
  )
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
    </svg>
  )
}

function OriginIcon({ type }: { type: string }) {
  switch (type) {
    case 'upload':
      return (
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
        </svg>
      )
    case 'manual':
      return (
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125" />
        </svg>
      )
    case 'harvest':
      return (
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m.75 12 3 3m0 0 3-3m-3 3v-6m-1.5-9H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
        </svg>
      )
    case 'ai':
      return (
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z" />
        </svg>
      )
    default:
      return (
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
        </svg>
      )
  }
}
