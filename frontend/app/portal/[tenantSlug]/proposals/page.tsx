'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'

interface Proposal {
  id: string
  title: string
  status: string
  stage: string
  stageColor: string
  stageEnteredAt: string
  stageDeadline: string | null
  submissionDeadline: string | null
  workspaceLocked: boolean
  completionPct: number
  sectionCount: number
  sectionsPopulated: number
  sectionsApproved: number
  outcome: string | null
  createdBy: string
  createdAt: string
  updatedAt: string
  opportunityTitle: string | null
  agency: string | null
  solicitationNumber: string | null
  closeDate: string | null
  setAsideType: string | null
  createdByName: string | null
  collaboratorCount: number
  openComments: number
  fileCount: number
}

const STAGE_STYLES: Record<string, string> = {
  outline: 'bg-gray-100 text-gray-700',
  draft: 'bg-blue-100 text-blue-700',
  pink_team: 'bg-pink-100 text-pink-700',
  red_team: 'bg-red-100 text-red-700',
  gold_team: 'bg-amber-100 text-amber-700',
  final: 'bg-emerald-100 text-emerald-700',
  submitted: 'bg-purple-100 text-purple-700',
  archived: 'bg-slate-100 text-slate-500',
}

const STAGE_LABELS: Record<string, string> = {
  outline: 'Outline',
  draft: 'Draft',
  pink_team: 'Pink Team',
  red_team: 'Red Team',
  gold_team: 'Gold Team',
  final: 'Final',
  submitted: 'Submitted',
  archived: 'Archived',
}

export default function ProposalsPage() {
  const params = useParams()
  const router = useRouter()
  const slug = params.tenantSlug as string

  const [proposals, setProposals] = useState<Proposal[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    fetch(`/api/portal/${slug}/proposals`)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then(d => setProposals(d.data ?? []))
      .catch(err => setError(err.message ?? 'Failed to load proposals'))
      .finally(() => setLoading(false))
  }, [slug])

  useEffect(() => { load() }, [load])

  const active = proposals.filter(p => p.status !== 'archived')
  const archived = proposals.filter(p => p.status === 'archived')

  // Stage pipeline summary counts
  const stageCounts: Record<string, number> = {}
  for (const p of active) {
    stageCounts[p.stage] = (stageCounts[p.stage] ?? 0) + 1
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Proposals</h1>
          <p className="mt-1 text-sm text-gray-500">
            {active.length} active proposal{active.length !== 1 ? 's' : ''}
            {archived.length > 0 && ` · ${archived.length} archived`}
          </p>
        </div>
        <button onClick={() => setShowCreate(true)} className="btn-primary text-sm gap-2">
          <PlusIcon />
          New Proposal
        </button>
      </div>

      {/* Stage pipeline overview */}
      {active.length > 0 && (
        <div className="mt-6 flex flex-wrap gap-2">
          {Object.entries(STAGE_LABELS).filter(([k]) => k !== 'archived').map(([stage, label]) => (
            <div key={stage} className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${STAGE_STYLES[stage]}`}>
              {label}
              <span className="font-bold">{stageCounts[stage] ?? 0}</span>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="mt-6 rounded-lg bg-red-50 p-4 text-sm text-red-700">
          {error}
          <button onClick={load} className="ml-3 underline">Retry</button>
        </div>
      )}

      {loading ? (
        <div className="mt-6 space-y-3">
          {[...Array(4)].map((_, i) => <div key={i} className="card animate-pulse h-28" />)}
        </div>
      ) : proposals.length === 0 ? (
        <div className="mt-12 text-center">
          <div className="mx-auto h-16 w-16 rounded-full bg-brand-50 flex items-center justify-center">
            <DocumentIcon />
          </div>
          <h3 className="mt-4 text-sm font-bold text-gray-900">No proposals yet</h3>
          <p className="mt-1 text-sm text-gray-500">Create a proposal from a pursuing opportunity to start the Color Team pipeline.</p>
          <button onClick={() => setShowCreate(true)} className="mt-4 btn-primary text-sm">
            Create First Proposal
          </button>
        </div>
      ) : (
        <>
          {/* Active proposals */}
          <div className="mt-6 space-y-3">
            {active.map(p => (
              <ProposalCard
                key={p.id}
                proposal={p}
                onClick={() => router.push(`/portal/${slug}/proposals/${p.id}`)}
              />
            ))}
          </div>

          {/* Archived */}
          {archived.length > 0 && (
            <div className="mt-8">
              <p className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-3">Archived</p>
              <div className="space-y-2">
                {archived.map(p => (
                  <ProposalCard
                    key={p.id}
                    proposal={p}
                    onClick={() => router.push(`/portal/${slug}/proposals/${p.id}`)}
                  />
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Create modal */}
      {showCreate && (
        <CreateProposalModal
          slug={slug}
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); load() }}
        />
      )}
    </div>
  )
}

function ProposalCard({ proposal: p, onClick }: { proposal: Proposal; onClick: () => void }) {
  const daysToDeadline = p.submissionDeadline
    ? Math.ceil((new Date(p.submissionDeadline).getTime() - Date.now()) / (86400000))
    : null

  return (
    <button onClick={onClick} className="card !p-4 w-full text-left hover:shadow-card-hover transition-all">
      <div className="flex items-start gap-4">
        {/* Stage badge */}
        <div className={`shrink-0 rounded-lg px-2.5 py-1 text-xs font-bold ${STAGE_STYLES[p.stage] ?? STAGE_STYLES.outline}`}>
          {STAGE_LABELS[p.stage] ?? p.stage}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-gray-900 truncate">{p.title}</h3>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
            {p.opportunityTitle && <span className="truncate max-w-[200px]">{p.opportunityTitle}</span>}
            {p.agency && <><span>&middot;</span><span>{p.agency}</span></>}
            {p.solicitationNumber && <><span>&middot;</span><span className="font-mono">{p.solicitationNumber}</span></>}
            {p.setAsideType && <span className="badge-blue text-[10px]">{p.setAsideType}</span>}
          </div>

          {/* Progress + meta */}
          <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-gray-400">
            {p.sectionCount > 0 && (
              <div className="flex items-center gap-1.5">
                <div className="w-16 h-1.5 rounded-full bg-gray-200 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-brand-500 transition-all"
                    style={{ width: `${p.completionPct ?? 0}%` }}
                  />
                </div>
                <span>{Math.round(p.completionPct ?? 0)}%</span>
              </div>
            )}
            <span>{p.collaboratorCount} member{p.collaboratorCount !== 1 ? 's' : ''}</span>
            {p.fileCount > 0 && <span>{p.fileCount} files</span>}
            {p.openComments > 0 && <span className="text-amber-500">{p.openComments} open comments</span>}
            {p.createdByName && <span>by {p.createdByName}</span>}
          </div>
        </div>

        {/* Deadline */}
        <div className="shrink-0 text-right">
          {daysToDeadline != null && (
            <span className={`text-xs font-bold ${
              daysToDeadline <= 3 ? 'text-red-600' :
              daysToDeadline <= 7 ? 'text-amber-600' :
              'text-gray-400'
            }`}>
              {daysToDeadline > 0 ? `${daysToDeadline}d left` : daysToDeadline === 0 ? 'Due today' : 'Overdue'}
            </span>
          )}
          {p.workspaceLocked && (
            <span className="mt-1 block text-[10px] text-red-500 font-medium">Locked</span>
          )}
        </div>
      </div>
    </button>
  )
}

function CreateProposalModal({ slug, onClose, onCreated }: {
  slug: string; onClose: () => void; onCreated: () => void
}) {
  const [title, setTitle] = useState('')
  const [oppId, setOppId] = useState('')
  const [deadline, setDeadline] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Fetch pursuing opportunities to link
  const [opps, setOpps] = useState<{ id: string; title: string; agency: string; closeDate: string }[]>([])
  useEffect(() => {
    fetch(`/api/opportunities?tenantSlug=${slug}&pursuitStatus=pursuing&limit=50&sortBy=score&sortDir=desc`)
      .then(r => r.ok ? r.json() : { data: [] })
      .then(d => setOpps((d.data ?? []).map((o: any) => ({
        id: o.opportunityId,
        title: o.title,
        agency: o.agency ?? 'Unknown',
        closeDate: o.closeDate ?? '',
      }))))
      .catch(() => {})
  }, [slug])

  async function handleCreate() {
    if (!title.trim() || !oppId) {
      setError('Title and opportunity are required')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/portal/${slug}/proposals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          opportunityId: oppId,
          submissionDeadline: deadline || undefined,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      onCreated()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create proposal')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-elevated">
        <h2 className="text-lg font-bold text-gray-900">New Proposal</h2>
        <p className="mt-1 text-sm text-gray-500">Link a pursuing opportunity to start the proposal workspace.</p>

        <div className="mt-4 space-y-4">
          <div>
            <label className="label">Proposal Title</label>
            <input className="input" value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. USAF Cyber Defense - Volume I Technical" />
          </div>

          <div>
            <label className="label">Opportunity</label>
            <select className="input" value={oppId} onChange={e => {
              setOppId(e.target.value)
              // Auto-set title from opportunity
              const opp = opps.find(o => o.id === e.target.value)
              if (opp && !title) setTitle(opp.title + ' - Proposal')
              if (opp?.closeDate && !deadline) setDeadline(opp.closeDate.slice(0, 10))
            }}>
              <option value="">Select an opportunity...</option>
              {opps.map(o => (
                <option key={o.id} value={o.id}>{o.title} ({o.agency})</option>
              ))}
            </select>
            {opps.length === 0 && (
              <p className="mt-1 text-xs text-gray-400">No pursuing opportunities found. Set an opportunity to &quot;Pursuing&quot; in Pipeline first.</p>
            )}
          </div>

          <div>
            <label className="label">Submission Deadline</label>
            <input className="input" type="date" value={deadline} onChange={e => setDeadline(e.target.value)} />
          </div>
        </div>

        {error && (
          <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
        )}

        <div className="mt-6 flex justify-end gap-3">
          <button onClick={onClose} className="btn-secondary text-sm">Cancel</button>
          <button onClick={handleCreate} disabled={saving} className="btn-primary text-sm">
            {saving ? 'Creating...' : 'Create Proposal'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── Icons ─────────────────────────────────────────── */

function PlusIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
    </svg>
  )
}

function DocumentIcon() {
  return (
    <svg className="h-8 w-8 text-brand-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
    </svg>
  )
}
