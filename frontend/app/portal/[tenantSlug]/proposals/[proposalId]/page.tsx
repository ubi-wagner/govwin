'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'

const STAGE_ORDER = ['outline', 'draft', 'pink_team', 'red_team', 'gold_team', 'final', 'submitted', 'archived'] as const
const STAGE_LABELS: Record<string, string> = {
  outline: 'Outline', draft: 'Draft', pink_team: 'Pink Team', red_team: 'Red Team',
  gold_team: 'Gold Team', final: 'Final', submitted: 'Submitted', archived: 'Archived',
}
const STAGE_STYLES: Record<string, string> = {
  outline: 'bg-gray-100 text-gray-700 border-gray-300',
  draft: 'bg-blue-100 text-blue-700 border-blue-300',
  pink_team: 'bg-pink-100 text-pink-700 border-pink-300',
  red_team: 'bg-red-100 text-red-700 border-red-300',
  gold_team: 'bg-amber-100 text-amber-700 border-amber-300',
  final: 'bg-emerald-100 text-emerald-700 border-emerald-300',
  submitted: 'bg-purple-100 text-purple-700 border-purple-300',
  archived: 'bg-slate-100 text-slate-500 border-slate-300',
}
const ROLE_LABELS: Record<string, string> = {
  owner: 'Owner', capture_manager: 'Capture Manager', volume_lead: 'Volume Lead',
  writer: 'Writer', reviewer: 'Reviewer', approver: 'Approver',
  subject_expert: 'Subject Expert', viewer: 'Viewer',
}

type Tab = 'overview' | 'sections' | 'team' | 'files' | 'activity'

export default function ProposalDetailPage() {
  const params = useParams()
  const router = useRouter()
  const slug = params.tenantSlug as string
  const proposalId = params.proposalId as string

  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('overview')
  const [actionMsg, setActionMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    fetch(`/api/portal/${slug}/proposals/${proposalId}`)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then(d => setData(d.data))
      .catch(err => setError(err.message ?? 'Failed to load'))
      .finally(() => setLoading(false))
  }, [slug, proposalId])

  useEffect(() => { load() }, [load])

  async function advanceStage() {
    if (!data) return
    const currentIdx = STAGE_ORDER.indexOf(data.stage)
    if (currentIdx < 0 || currentIdx >= STAGE_ORDER.length - 2) return // can't advance past submitted
    const nextStage = STAGE_ORDER[currentIdx + 1]

    setActionMsg(null)
    try {
      const res = await fetch(`/api/portal/${slug}/proposals/${proposalId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage: nextStage, reason: `Advanced to ${STAGE_LABELS[nextStage]}` }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error ?? `HTTP ${res.status}`)
      }
      setActionMsg({ type: 'success', text: `Stage advanced to ${STAGE_LABELS[nextStage]}` })
      load()
    } catch (err) {
      setActionMsg({ type: 'error', text: err instanceof Error ? err.message : 'Failed to advance stage' })
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="card animate-pulse h-16" />
        <div className="card animate-pulse h-64" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="mt-6 rounded-lg bg-red-50 p-4 text-sm text-red-700">
        {error ?? 'Proposal not found'}
        <button onClick={load} className="ml-3 underline">Retry</button>
        <button onClick={() => router.push(`/portal/${slug}/proposals`)} className="ml-3 underline">Back to list</button>
      </div>
    )
  }

  const currentStageIdx = STAGE_ORDER.indexOf(data.stage)
  const canAdvance = currentStageIdx >= 0 && currentStageIdx < STAGE_ORDER.length - 2 && data.stage !== 'archived'

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <button onClick={() => router.push(`/portal/${slug}/proposals`)} className="text-xs text-gray-400 hover:text-gray-600 mb-2 block">
            &larr; All Proposals
          </button>
          <h1 className="text-2xl font-bold text-gray-900">{data.title}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
            {data.opportunityTitle && <span>{data.opportunityTitle}</span>}
            {data.agency && <><span>&middot;</span><span>{data.agency}</span></>}
            {data.solicitationNumber && <><span>&middot;</span><span className="font-mono">{data.solicitationNumber}</span></>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {canAdvance && (
            <button onClick={advanceStage} className="btn-primary text-sm gap-2">
              Advance to {STAGE_LABELS[STAGE_ORDER[currentStageIdx + 1]]}
              <ArrowRightIcon />
            </button>
          )}
        </div>
      </div>

      {/* Stage pipeline visualization */}
      <div className="mt-6 flex items-center gap-1 overflow-x-auto pb-2">
        {STAGE_ORDER.filter(s => s !== 'archived').map((stage, i) => {
          const isCurrent = stage === data.stage
          const isPast = i < currentStageIdx
          return (
            <div key={stage} className="flex items-center">
              {i > 0 && (
                <div className={`w-6 h-0.5 ${isPast ? 'bg-brand-400' : 'bg-gray-200'}`} />
              )}
              <div className={`rounded-full px-3 py-1 text-[10px] font-bold whitespace-nowrap transition-all ${
                isCurrent ? `${STAGE_STYLES[stage]} ring-2 ring-offset-1 ring-brand-400` :
                isPast ? 'bg-brand-50 text-brand-600' :
                'bg-gray-50 text-gray-400'
              }`}>
                {STAGE_LABELS[stage]}
              </div>
            </div>
          )
        })}
      </div>

      {/* Action message */}
      {actionMsg && (
        <div className={`mt-4 rounded-lg px-4 py-2 text-sm ${
          actionMsg.type === 'success' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
        }`}>
          {actionMsg.text}
          <button onClick={() => setActionMsg(null)} className="ml-3 underline text-xs">Dismiss</button>
        </div>
      )}

      {/* Stats row */}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <StatCard label="Completion" value={`${Math.round(data.completionPct ?? 0)}%`} />
        <StatCard label="Sections" value={`${data.sectionsPopulated ?? 0}/${data.sectionCount ?? 0}`} />
        <StatCard label="Team" value={String(data.collaborators?.length ?? 0)} />
        <StatCard label="Files" value={String(data.files?.length ?? 0)} />
        <StatCard label="Comments" value={String(data.openComments ?? 0)} accent={data.openComments > 0} />
      </div>

      {/* Tabs */}
      <div className="mt-6 flex gap-1 border-b border-gray-200">
        {(['overview', 'sections', 'team', 'files', 'activity'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
              tab === t ? 'border-brand-500 text-brand-700' : 'border-transparent text-gray-400 hover:text-gray-600'
            }`}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="mt-6">
        {tab === 'overview' && <OverviewTab data={data} />}
        {tab === 'sections' && <SectionsTab sections={data.sections ?? []} />}
        {tab === 'team' && <TeamTab collaborators={data.collaborators ?? []} />}
        {tab === 'files' && <FilesTab files={data.files ?? []} />}
        {tab === 'activity' && <ActivityTab activity={data.activity ?? []} stageHistory={data.stageHistory ?? []} />}
      </div>
    </div>
  )
}

function StatCard({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="card !p-3 text-center">
      <p className={`text-lg font-bold ${accent ? 'text-amber-600' : 'text-gray-900'}`}>{value}</p>
      <p className="text-[10px] text-gray-400 uppercase font-bold tracking-wider">{label}</p>
    </div>
  )
}

function OverviewTab({ data }: { data: any }) {
  return (
    <div className="space-y-6">
      {/* Opportunity details */}
      <div className="card">
        <h3 className="text-sm font-bold uppercase tracking-wider text-gray-400">Linked Opportunity</h3>
        <div className="mt-3 grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-xs text-gray-400">Title</span>
            <p className="font-medium text-gray-900">{data.opportunityTitle ?? 'N/A'}</p>
          </div>
          <div>
            <span className="text-xs text-gray-400">Agency</span>
            <p className="font-medium text-gray-900">{data.agency ?? 'N/A'}</p>
          </div>
          {data.closeDate && (
            <div>
              <span className="text-xs text-gray-400">Close Date</span>
              <p className="font-medium text-gray-900">{new Date(data.closeDate).toLocaleDateString()}</p>
            </div>
          )}
          {data.submissionDeadline && (
            <div>
              <span className="text-xs text-gray-400">Submission Deadline</span>
              <p className="font-medium text-gray-900">{new Date(data.submissionDeadline).toLocaleDateString()}</p>
            </div>
          )}
          {data.setAsideType && (
            <div>
              <span className="text-xs text-gray-400">Set-Aside</span>
              <p><span className="badge-blue">{data.setAsideType}</span></p>
            </div>
          )}
          {data.sourceUrl && (
            <div>
              <span className="text-xs text-gray-400">Source</span>
              <p><a href={data.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-brand-600 hover:underline text-xs">View on SAM.gov</a></p>
            </div>
          )}
        </div>
        {data.opportunityDescription && (
          <p className="mt-3 text-xs text-gray-600 line-clamp-3">{data.opportunityDescription}</p>
        )}
      </div>

      {/* Stage history timeline */}
      {data.stageHistory?.length > 0 && (
        <div className="card">
          <h3 className="text-sm font-bold uppercase tracking-wider text-gray-400">Stage History</h3>
          <div className="mt-3 space-y-2">
            {data.stageHistory.slice(0, 5).map((h: any) => (
              <div key={h.id} className="flex items-center gap-3 text-xs">
                <div className={`rounded-full px-2 py-0.5 font-bold ${STAGE_STYLES[h.toStage] ?? 'bg-gray-100 text-gray-600'}`}>
                  {STAGE_LABELS[h.toStage] ?? h.toStage}
                </div>
                {h.fromStage && <span className="text-gray-400">from {STAGE_LABELS[h.fromStage] ?? h.fromStage}</span>}
                <span className="text-gray-400">&middot;</span>
                <span className="text-gray-500">{h.changedByName}</span>
                <span className="text-gray-300 ml-auto">{new Date(h.createdAt).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function SectionsTab({ sections }: { sections: any[] }) {
  if (sections.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-sm text-gray-500">No sections defined yet.</p>
        <p className="text-xs text-gray-400 mt-1">Sections are populated when an RFP template is applied to this proposal.</p>
      </div>
    )
  }

  const STATUS_STYLES: Record<string, string> = {
    draft: 'badge-blue', populated: 'badge-yellow', in_review: 'badge-purple',
    approved: 'badge-green', locked: 'badge-gray',
  }

  return (
    <div className="space-y-2">
      {sections.map((s: any) => (
        <div key={s.id} className="card !p-3 flex items-center gap-3">
          <span className="text-xs font-mono text-gray-400 w-8">{String(s.sortOrder + 1).padStart(2, '0')}</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-900 truncate">{s.title}</p>
            <p className="text-[10px] text-gray-400">{s.sectionKey}</p>
          </div>
          <span className={STATUS_STYLES[s.status] ?? 'badge-gray'}>{s.status}</span>
          {s.pageLimit && (
            <span className="text-[10px] text-gray-400">
              {s.currentPageCount ?? 0}/{s.pageLimit} pg
            </span>
          )}
        </div>
      ))}
    </div>
  )
}

function TeamTab({ collaborators }: { collaborators: any[] }) {
  if (collaborators.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-sm text-gray-500">No team members yet.</p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {collaborators.map((c: any) => (
        <div key={c.id} className="card !p-3 flex items-center gap-3">
          <div className="h-8 w-8 rounded-full bg-brand-100 flex items-center justify-center text-xs font-bold text-brand-700">
            {(c.name ?? '?')[0].toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-900">{c.name}</p>
            <p className="text-xs text-gray-400">{c.email}</p>
          </div>
          <span className="badge-gray text-[10px]">{ROLE_LABELS[c.role] ?? c.role}</span>
        </div>
      ))}
    </div>
  )
}

function FilesTab({ files }: { files: any[] }) {
  if (files.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-sm text-gray-500">No files uploaded yet.</p>
      </div>
    )
  }

  const TYPE_ICONS: Record<string, string> = {
    document: 'DOC', spreadsheet: 'XLS', presentation: 'PPT',
    pdf: 'PDF', image: 'IMG', other: 'FILE',
  }

  return (
    <div className="space-y-2">
      {files.map((f: any) => (
        <div key={f.id} className="card !p-3 flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-gray-100 flex items-center justify-center text-[10px] font-bold text-gray-500">
            {TYPE_ICONS[f.fileType] ?? 'FILE'}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-900 truncate">{f.fileName}</p>
            <div className="flex items-center gap-2 text-[10px] text-gray-400">
              {f.fileSizeBytes && <span>{(f.fileSizeBytes / 1024).toFixed(0)} KB</span>}
              <span>v{f.version}</span>
              {f.uploadedByName && <span>by {f.uploadedByName}</span>}
              <span>{new Date(f.createdAt).toLocaleDateString()}</span>
            </div>
          </div>
          {f.isSubmissionArtifact && <span className="badge-purple text-[10px]">Submission</span>}
          {f.tags?.length > 0 && f.tags.map((t: string) => (
            <span key={t} className="badge-gray text-[10px]">{t}</span>
          ))}
        </div>
      ))}
    </div>
  )
}

function ActivityTab({ activity, stageHistory }: { activity: any[]; stageHistory: any[] }) {
  if (activity.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-sm text-gray-500">No activity recorded yet.</p>
      </div>
    )
  }

  const TYPE_COLORS: Record<string, string> = {
    stage_changed: 'bg-brand-500',
    section_edited: 'bg-blue-500',
    file_uploaded: 'bg-violet-500',
    collaborator_added: 'bg-emerald-500',
    review_requested: 'bg-amber-500',
    review_completed: 'bg-green-500',
    comment_added: 'bg-gray-500',
    ai_populated: 'bg-purple-500',
  }

  return (
    <div className="space-y-1">
      {activity.map((a: any) => (
        <div key={a.id} className="flex items-start gap-3 rounded-xl px-3 py-2.5 hover:bg-gray-50">
          <div className={`mt-1 h-2 w-2 shrink-0 rounded-full ${TYPE_COLORS[a.activityType] ?? 'bg-gray-400'}`} />
          <div className="flex-1 min-w-0">
            <p className="text-sm text-gray-700">{a.summary}</p>
            <div className="flex items-center gap-2 text-[10px] text-gray-400 mt-0.5">
              {a.userName && <span>{a.userName}</span>}
              <span>{new Date(a.createdAt).toLocaleString()}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

function ArrowRightIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
    </svg>
  )
}
