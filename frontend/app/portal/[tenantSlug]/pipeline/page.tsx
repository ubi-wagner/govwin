'use client'

import { Suspense, useEffect, useState, useCallback } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import type { TenantPipelineItem, PursuitStatus } from '@/types'

const PROGRAM_TYPE_BADGES: Record<string, { label: string; color: string }> = {
  sbir_phase_1: { label: 'SBIR I', color: 'bg-blue-100 text-blue-800 border-blue-200' },
  sbir_phase_2: { label: 'SBIR II', color: 'bg-indigo-100 text-indigo-800 border-indigo-200' },
  sttr_phase_1: { label: 'STTR I', color: 'bg-purple-100 text-purple-800 border-purple-200' },
  sttr_phase_2: { label: 'STTR II', color: 'bg-violet-100 text-violet-800 border-violet-200' },
  ota: { label: 'OTA', color: 'bg-amber-100 text-amber-800 border-amber-200' },
  baa: { label: 'BAA', color: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  challenge: { label: 'Challenge', color: 'bg-rose-100 text-rose-800 border-rose-200' },
}

function ProgramTypeBadge({ programType }: { programType: string | null }) {
  if (!programType) return null
  const badge = PROGRAM_TYPE_BADGES[programType]
  if (!badge) return null
  return (
    <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium ${badge.color}`}>
      {badge.label}
    </span>
  )
}

const PROGRAM_TYPE_OPTIONS = [
  { value: '', label: 'All Programs' },
  { value: 'sbir_phase_1', label: 'SBIR Phase I' },
  { value: 'sbir_phase_2', label: 'SBIR Phase II' },
  { value: 'sttr_phase_1', label: 'STTR Phase I' },
  { value: 'sttr_phase_2', label: 'STTR Phase II' },
  { value: 'ota', label: 'OTA' },
  { value: 'baa', label: 'BAA' },
  { value: 'challenge', label: 'Challenge' },
]

export default function PortalPipeline() {
  return (
    <Suspense fallback={<div className="animate-pulse"><div className="h-8 w-48 rounded bg-gray-200" /></div>}>
      <PortalPipelineInner />
    </Suspense>
  )
}

function PortalPipelineInner() {
  const params = useParams()
  const searchParams = useSearchParams()
  const slug = params.tenantSlug as string

  const [opps, setOpps] = useState<TenantPipelineItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const limit = 25

  // Filters
  const [search, setSearch] = useState(searchParams.get('search') ?? '')
  const [sortBy, setSortBy] = useState(searchParams.get('sortBy') ?? 'score')
  const [sortDir, setSortDir] = useState(searchParams.get('sortDir') ?? 'desc')
  const [pursuitFilter, setPursuitFilter] = useState('')
  const [minScore, setMinScore] = useState('')
  const [programTypeFilter, setProgramTypeFilter] = useState('')
  const [spotlightFilter, setSpotlightFilter] = useState(searchParams.get('spotlightId') ?? '')

  // Fetch spotlights for the filter dropdown
  const [spotlights, setSpotlights] = useState<{id: string; name: string}[]>([])
  useEffect(() => {
    fetch(`/api/portal/${slug}/spotlights`)
      .then(r => r.ok ? r.json() : { data: [] })
      .then(d => setSpotlights((d.data ?? []).map((s: any) => ({ id: s.id, name: s.name }))))
      .catch(() => {})
  }, [slug])

  const loadOpps = useCallback(() => {
    setLoading(true)
    setError(null)
    const params = new URLSearchParams({
      tenantSlug: slug,
      sortBy,
      sortDir,
      limit: String(limit),
      offset: String(page * limit),
    })
    if (search) params.set('search', search)
    if (pursuitFilter) params.set('pursuitStatus', pursuitFilter)
    if (minScore) params.set('minScore', minScore)
    if (programTypeFilter) params.set('programType', programTypeFilter)
    if (spotlightFilter) params.set('spotlightId', spotlightFilter)

    fetch(`/api/opportunities?${params}`)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then(d => {
        setOpps(d.data ?? [])
        setTotal(d.total ?? 0)
      })
      .catch(err => setError(err.message ?? 'Failed to load opportunities'))
      .finally(() => setLoading(false))
  }, [slug, sortBy, sortDir, page, search, pursuitFilter, minScore, programTypeFilter, spotlightFilter])

  useEffect(() => { loadOpps() }, [loadOpps])

  async function handleAction(oppId: string, actionType: string, value?: string) {
    try {
      const res = await fetch(`/api/opportunities/${oppId}/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantSlug: slug, actionType, value }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? `Action failed (${res.status})`)
        return
      }
      loadOpps()
    } catch {
      setError('Network error — please try again')
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900">Pipeline</h1>
      <p className="mt-1 text-sm text-gray-500">{total} opportunities scored for your profile</p>

      {/* Filters */}
      <div className="mt-4 flex flex-wrap gap-3">
        <input
          className="input max-w-xs"
          placeholder="Search SBIR/STTR topics, agencies, SOL #..."
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(0) }}
        />
        <select className="input w-auto" value={programTypeFilter} onChange={e => { setProgramTypeFilter(e.target.value); setPage(0) }}>
          {PROGRAM_TYPE_OPTIONS.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        <select className="input w-auto" value={pursuitFilter} onChange={e => { setPursuitFilter(e.target.value); setPage(0) }}>
          <option value="">All statuses</option>
          <option value="unreviewed">Unreviewed</option>
          <option value="pursuing">Pursuing</option>
          <option value="monitoring">Monitoring</option>
          <option value="passed">Passed</option>
        </select>
        <select className="input w-auto" value={minScore} onChange={e => { setMinScore(e.target.value); setPage(0) }}>
          <option value="">Any score</option>
          <option value="75">75+ (High)</option>
          <option value="50">50+ (Medium+)</option>
          <option value="25">25+ (Low+)</option>
        </select>
        {spotlights.length > 0 && (
          <select className="input w-auto" value={spotlightFilter} onChange={e => { setSpotlightFilter(e.target.value); setPage(0) }}>
            <option value="">All SpotLights</option>
            {spotlights.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        )}
        <select className="input w-auto" value={sortBy} onChange={e => setSortBy(e.target.value)}>
          <option value="score">Score</option>
          <option value="close_date">Deadline</option>
          <option value="posted_date">Posted</option>
          <option value="last_action">Activity</option>
        </select>
        <button
          onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')}
          className="btn-secondary text-sm"
        >
          {sortDir === 'asc' ? '\u2191 Asc' : '\u2193 Desc'}
        </button>
      </div>

      {/* Results */}
      {error ? (
        <div className="mt-6 rounded-lg bg-red-50 p-4 text-sm text-red-700">
          Failed to load opportunities: {error}
          <button onClick={loadOpps} className="ml-3 underline">Retry</button>
        </div>
      ) : loading ? (
        <div className="mt-6 space-y-3">
          {[...Array(5)].map((_, i) => <div key={i} className="card animate-pulse h-24" />)}
        </div>
      ) : opps.length === 0 ? (
        <div className="mt-12 text-center">
          <p className="text-gray-500">No opportunities match your filters</p>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {opps.map(opp => (
            <OpportunityRow key={opp.tenantOppId} opp={opp} onAction={handleAction} />
          ))}
        </div>
      )}

      {/* Pagination */}
      {total > limit && (
        <div className="mt-6 flex items-center justify-between">
          <p className="text-sm text-gray-500">
            Showing {page * limit + 1}-{Math.min((page + 1) * limit, total)} of {total}
          </p>
          <div className="flex gap-2">
            <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} className="btn-secondary text-sm">
              Previous
            </button>
            <button onClick={() => setPage(p => p + 1)} disabled={(page + 1) * limit >= total} className="btn-secondary text-sm">
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function OpportunityRow({ opp, onAction }: { opp: TenantPipelineItem; onAction: (id: string, type: string, val?: string) => void }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="card !p-4">
      <div className="flex items-start gap-4">
        {/* Score */}
        <div className="flex-shrink-0 text-center">
          <ScoreBadge score={opp.totalScore} tier={opp.priorityTier} />
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <button onClick={() => setExpanded(!expanded)} className="text-left">
              <p className="text-sm font-semibold text-gray-900 hover:text-brand-700">{opp.title}</p>
            </button>
            <DeadlineBadge status={opp.deadlineStatus} days={opp.daysToClose} />
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
            <ProgramTypeBadge programType={opp.programType} />
            <span>{opp.agency ?? 'Unknown'}</span>
            <span>&middot;</span>
            <span>{opp.opportunityType}</span>
            {opp.solicitationNumber && (
              <>
                <span>&middot;</span>
                <span className="font-mono">{opp.solicitationNumber}</span>
              </>
            )}
            {opp.setAsideType && <span className="badge-blue text-[10px]">{opp.setAsideType}</span>}
            {opp.matchedDomains?.length > 0 && (
              opp.matchedDomains.slice(0, 2).map(d => <span key={d} className="badge-green text-[10px]">{d}</span>)
            )}
            {opp.bestSpotlightName && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-indigo-50 text-indigo-700 border border-indigo-200">
                {opp.bestSpotlightName}
              </span>
            )}
          </div>

          {/* Actions row */}
          <div className="mt-2 flex items-center gap-2">
            <button onClick={() => onAction(opp.opportunityId, 'thumbs_up')} className="text-gray-400 hover:text-green-600 text-sm" title="Thumbs up">
              {'\u{1F44D}'} {opp.thumbsUp > 0 && <span className="text-xs">{opp.thumbsUp}</span>}
            </button>
            <button onClick={() => onAction(opp.opportunityId, 'thumbs_down')} className="text-gray-400 hover:text-red-600 text-sm" title="Thumbs down">
              {'\u{1F44E}'} {opp.thumbsDown > 0 && <span className="text-xs">{opp.thumbsDown}</span>}
            </button>
            <button onClick={() => onAction(opp.opportunityId, 'pin')} className={`text-sm ${opp.isPinned ? 'text-purple-600' : 'text-gray-400 hover:text-purple-600'}`} title="Pin">
              {'\u{1F4CC}'}
            </button>

            <select
              className="ml-2 rounded border border-gray-200 px-2 py-0.5 text-xs"
              value={opp.pursuitStatus}
              onChange={e => onAction(opp.opportunityId, 'status_change', e.target.value)}
            >
              <option value="unreviewed">Unreviewed</option>
              <option value="pursuing">Pursuing</option>
              <option value="monitoring">Monitoring</option>
              <option value="passed">Passed</option>
            </select>

            {opp.commentCount > 0 && (
              <span className="ml-2 text-xs text-gray-400">{opp.commentCount} comments</span>
            )}

            {opp.sourceUrl && (
              <a href={opp.sourceUrl} target="_blank" rel="noopener noreferrer" className="ml-auto text-xs text-brand-600 hover:text-brand-800">
                Source &rarr;
              </a>
            )}
          </div>

          {/* Expanded details */}
          {expanded && (
            <div className="mt-3 rounded-lg bg-gray-50 p-3 text-sm">
              {opp.description && <p className="text-gray-700 line-clamp-3">{opp.description}</p>}

              <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
                {opp.estimatedValueMin && (
                  <div>
                    <span className="font-medium text-gray-500">Value:</span>{' '}
                    ${formatValue(opp.estimatedValueMin)} - ${formatValue(opp.estimatedValueMax)}
                  </div>
                )}
                {opp.postedDate && (
                  <div>
                    <span className="font-medium text-gray-500">Posted:</span>{' '}
                    {new Date(opp.postedDate).toLocaleDateString()}
                  </div>
                )}
                {opp.closeDate && (
                  <div>
                    <span className="font-medium text-gray-500">Closes:</span>{' '}
                    {new Date(opp.closeDate).toLocaleDateString()}
                  </div>
                )}
                {opp.naicsCodes?.length > 0 && (
                  <div>
                    <span className="font-medium text-gray-500">NAICS:</span>{' '}
                    {opp.naicsCodes.join(', ')}
                  </div>
                )}
              </div>

              {opp.keyRequirements?.length > 0 && (
                <div className="mt-3">
                  <p className="font-medium text-gray-500 text-xs">Key Requirements</p>
                  <ul className="mt-1 list-disc list-inside text-xs text-gray-600 space-y-0.5">
                    {opp.keyRequirements.map((r, i) => <li key={i}>{r}</li>)}
                  </ul>
                </div>
              )}

              {opp.competitiveRisks?.length > 0 && (
                <div className="mt-2">
                  <p className="font-medium text-gray-500 text-xs">Competitive Risks</p>
                  <ul className="mt-1 list-disc list-inside text-xs text-red-600 space-y-0.5">
                    {opp.competitiveRisks.map((r, i) => <li key={i}>{r}</li>)}
                  </ul>
                </div>
              )}

              {opp.llmRationale && (
                <div className="mt-2">
                  <p className="font-medium text-gray-500 text-xs">AI Analysis</p>
                  <p className="mt-1 text-xs text-gray-600 italic">{opp.llmRationale}</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function ScoreBadge({ score, tier }: { score: number | null; tier: string }) {
  if (score == null) return <div className="h-10 w-10 rounded-lg bg-gray-100 flex items-center justify-center text-xs text-gray-400">-</div>
  const colors: Record<string, string> = {
    high: 'bg-green-100 text-green-800 border-green-200',
    medium: 'bg-yellow-100 text-yellow-800 border-yellow-200',
    low: 'bg-gray-100 text-gray-600 border-gray-200',
  }
  return (
    <div className={`h-10 w-10 rounded-lg border flex items-center justify-center text-sm font-bold ${colors[tier] ?? colors.low}`}>
      {Math.round(score)}
    </div>
  )
}

function DeadlineBadge({ status, days }: { status: string; days: number | null }) {
  if (days == null || status === 'closed') return <span className="badge-gray text-[10px]">Closed</span>
  const styles: Record<string, string> = { urgent: 'badge-red', soon: 'badge-yellow', ok: 'badge-gray' }
  return <span className={`text-[10px] ${styles[status] ?? 'badge-gray'}`}>{days}d</span>
}

function formatValue(v: number | null): string {
  if (!v) return '?'
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`
  return String(v)
}
