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

type Tab = 'overview' | 'sections' | 'team' | 'partners' | 'files' | 'activity'

interface PurchaseInfo {
  id: string
  purchaseType: 'phase_1' | 'phase_2'
  priceCents: number
  status: string
  purchasedAt: string
  cancellationDeadline: string
  templateDeliveredAt: string | null
  cancelledAt: string | null
  refundReason: string | null
  proposalTitle?: string
  templateName?: string
}

interface PartnerGrant {
  id: string
  userId: string
  status: string
  permissions: any
  accessScope: string
  expiresAt: string | null
  acceptedAt: string | null
  approvedAt: string | null
  revokedAt: string | null
  createdAt: string
  userName?: string
  userEmail?: string
}

export default function ProposalDetailPage() {
  const params = useParams()
  const router = useRouter()
  const slug = params.tenantSlug as string
  const proposalId = params.proposalId as string

  const [data, setData] = useState<any>(null)
  const [purchase, setPurchase] = useState<PurchaseInfo | null>(null)
  const [partners, setPartners] = useState<PartnerGrant[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('overview')
  const [actionMsg, setActionMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [showInvitePartner, setShowInvitePartner] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    Promise.all([
      fetch(`/api/portal/${slug}/proposals/${proposalId}`)
        .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json().catch(() => ({})) })
        .then(d => setData(d.data ?? null)),
      fetch(`/api/portal/${slug}/purchases`)
        .then(r => r.ok ? r.json() : { data: [] })
        .then(d => {
          const purchases = d.data ?? []
          const match = purchases.find((p: any) => p.proposalId === proposalId)
          setPurchase(match ?? null)
        })
        .catch(() => setPurchase(null)),
      fetch(`/api/portal/${slug}/proposals/${proposalId}/partners`)
        .then(r => r.ok ? r.json() : { data: [] })
        .then(d => setPartners(d.data ?? []))
        .catch(() => setPartners([])),
    ])
      .catch(err => setError(err instanceof Error ? err.message : 'Failed to load'))
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

      {/* Purchase info card */}
      {purchase && (
        <PurchaseCard
          purchase={purchase}
          slug={slug}
          proposalId={proposalId}
          onCancelled={load}
          setActionMsg={setActionMsg}
        />
      )}

      {/* Tabs */}
      <div className="mt-6 flex gap-1 border-b border-gray-200">
        {(['overview', 'sections', 'team', 'partners', 'files', 'activity'] as Tab[]).map(t => (
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
        {tab === 'partners' && (
          <PartnersTab
            partners={partners}
            slug={slug}
            proposalId={proposalId}
            onInvite={() => setShowInvitePartner(true)}
            onRevoke={load}
            setActionMsg={setActionMsg}
          />
        )}
        {tab === 'files' && <FilesTab files={data.files ?? []} />}
        {tab === 'activity' && <ActivityTab activity={data.activity ?? []} stageHistory={data.stageHistory ?? []} />}
      </div>

      {/* Invite Partner Modal */}
      {showInvitePartner && (
        <InvitePartnerModal
          slug={slug}
          proposalId={proposalId}
          onClose={() => setShowInvitePartner(false)}
          onInvited={() => { setShowInvitePartner(false); load() }}
        />
      )}
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

/* ── Purchase Card ─────────────────────────────────── */

const PURCHASE_STATUS_LABELS: Record<string, { bg: string; label: string }> = {
  pending: { bg: 'bg-amber-100 text-amber-700', label: 'Awaiting Template' },
  template_delivered: { bg: 'bg-emerald-100 text-emerald-700', label: 'Template Ready' },
  active: { bg: 'bg-blue-100 text-blue-700', label: 'In Progress' },
  completed: { bg: 'bg-green-100 text-green-700', label: 'Completed' },
  cancelled: { bg: 'bg-gray-100 text-gray-500', label: 'Cancelled' },
  refunded: { bg: 'bg-gray-100 text-gray-500', label: 'Refunded' },
}

function PurchaseCard({ purchase, slug, proposalId, onCancelled, setActionMsg }: {
  purchase: PurchaseInfo
  slug: string
  proposalId: string
  onCancelled: () => void
  setActionMsg: (msg: { type: 'success' | 'error'; text: string } | null) => void
}) {
  const [cancelling, setCancelling] = useState(false)

  const statusStyle = PURCHASE_STATUS_LABELS[purchase.status] ?? PURCHASE_STATUS_LABELS.pending
  const canCancel = purchase.status === 'pending'
    && !purchase.templateDeliveredAt
    && new Date(purchase.cancellationDeadline) > new Date()

  const hoursRemaining = canCancel
    ? Math.max(0, Math.ceil((new Date(purchase.cancellationDeadline).getTime() - Date.now()) / 3600000))
    : 0

  async function handleCancel() {
    if (!confirm('Are you sure you want to cancel this purchase?')) return
    setCancelling(true)
    try {
      const res = await fetch(`/api/portal/${slug}/purchases/${purchase.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel', reason: 'User cancelled' }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      setActionMsg({ type: 'success', text: 'Purchase cancelled successfully' })
      onCancelled()
    } catch (err) {
      setActionMsg({ type: 'error', text: err instanceof Error ? err.message : 'Failed to cancel' })
    } finally {
      setCancelling(false)
    }
  }

  return (
    <div className="mt-6 card border-l-4 border-l-brand-500">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-sm font-bold uppercase tracking-wider text-gray-400">Purchase</h3>
          <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
            <div>
              <span className="text-xs text-gray-400">Type</span>
              <p className="font-medium text-gray-900">{purchase.purchaseType === 'phase_1' ? 'Phase I' : 'Phase II'}</p>
            </div>
            <div>
              <span className="text-xs text-gray-400">Price</span>
              <p className="font-medium text-gray-900">${(purchase.priceCents / 100).toFixed(0)}</p>
            </div>
            <div>
              <span className="text-xs text-gray-400">Purchased</span>
              <p className="font-medium text-gray-900">{new Date(purchase.purchasedAt).toLocaleDateString()}</p>
            </div>
            <div>
              <span className="text-xs text-gray-400">Template</span>
              <p className="font-medium text-gray-900">
                {purchase.templateDeliveredAt
                  ? `Delivered ${new Date(purchase.templateDeliveredAt).toLocaleDateString()}`
                  : 'Not yet delivered'}
              </p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${statusStyle.bg}`}>
            {statusStyle.label}
          </span>
          {canCancel && (
            <button
              onClick={handleCancel}
              disabled={cancelling}
              className="text-xs text-red-600 hover:text-red-800 font-medium"
            >
              {cancelling ? 'Cancelling...' : `Cancel (${hoursRemaining}h left)`}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

/* ── Partners Tab ─────────────────────────────────── */

const PARTNER_STATUS_STYLES: Record<string, string> = {
  active: 'bg-emerald-100 text-emerald-700',
  pending_acceptance: 'bg-amber-100 text-amber-700',
  pending_approval: 'bg-blue-100 text-blue-700',
  revoked: 'bg-gray-100 text-gray-400',
  expired: 'bg-gray-100 text-gray-400',
  rejected: 'bg-red-100 text-red-600',
}

const PARTNER_STATUS_LABELS: Record<string, string> = {
  active: 'Active',
  pending_acceptance: 'Pending Acceptance',
  pending_approval: 'Pending Approval',
  revoked: 'Revoked',
  expired: 'Expired',
  rejected: 'Rejected',
}

function PartnersTab({ partners, slug, proposalId, onInvite, onRevoke, setActionMsg }: {
  partners: PartnerGrant[]
  slug: string
  proposalId: string
  onInvite: () => void
  onRevoke: () => void
  setActionMsg: (msg: { type: 'success' | 'error'; text: string } | null) => void
}) {
  const [revoking, setRevoking] = useState<string | null>(null)

  const active = partners.filter(p => p.status === 'active')
  const pending = partners.filter(p => p.status === 'pending_acceptance' || p.status === 'pending_approval')
  const revoked = partners.filter(p => p.status === 'revoked' || p.status === 'expired' || p.status === 'rejected')

  async function handleRevoke(grantId: string) {
    if (!confirm('Are you sure you want to revoke this partner\'s access?')) return
    setRevoking(grantId)
    try {
      const res = await fetch(`/api/portal/${slug}/proposals/${proposalId}/partners?grantId=${grantId}`, {
        method: 'DELETE',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      setActionMsg({ type: 'success', text: 'Partner access revoked' })
      onRevoke()
    } catch (err) {
      setActionMsg({ type: 'error', text: err instanceof Error ? err.message : 'Failed to revoke' })
    } finally {
      setRevoking(null)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header with invite button */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">
          {active.length} active partner{active.length !== 1 ? 's' : ''}
          {pending.length > 0 && ` \u00b7 ${pending.length} pending`}
        </p>
        <button onClick={onInvite} className="btn-primary text-sm gap-2">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M18 7.5v3m0 0v3m0-3h3m-3 0h-3m-2.25-4.125a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0ZM3 19.235v-.11a6.375 6.375 0 0 1 12.75 0v.109A12.318 12.318 0 0 1 9.374 21c-2.331 0-4.512-.645-6.374-1.766Z" />
          </svg>
          Invite Partner
        </button>
      </div>

      {partners.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-sm text-gray-500">No partners added yet.</p>
          <p className="text-xs text-gray-400 mt-1">Invite external collaborators to work on specific sections of this proposal.</p>
        </div>
      ) : (
        <>
          {/* Active partners */}
          {active.length > 0 && (
            <div className="space-y-2">
              {active.map(p => (
                <PartnerRow
                  key={p.id}
                  partner={p}
                  onRevoke={() => handleRevoke(p.id)}
                  revoking={revoking === p.id}
                />
              ))}
            </div>
          )}

          {/* Pending invitations */}
          {pending.length > 0 && (
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-2">Pending</p>
              <div className="space-y-2">
                {pending.map(p => (
                  <PartnerRow
                    key={p.id}
                    partner={p}
                    onRevoke={() => handleRevoke(p.id)}
                    revoking={revoking === p.id}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Revoked / expired */}
          {revoked.length > 0 && (
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-2">Revoked / Expired</p>
              <div className="space-y-2 opacity-60">
                {revoked.map(p => (
                  <PartnerRow key={p.id} partner={p} />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function PartnerRow({ partner: p, onRevoke, revoking }: {
  partner: PartnerGrant
  onRevoke?: () => void
  revoking?: boolean
}) {
  const permDefault = p.permissions?.default ?? 'view'
  const sectionCount = Object.keys(p.permissions?.sections ?? {}).length
  const permSummary = sectionCount > 0
    ? `${permDefault} + ${sectionCount} section override${sectionCount !== 1 ? 's' : ''}`
    : permDefault

  return (
    <div className="card !p-3 flex items-center gap-3">
      <div className="h-8 w-8 rounded-full bg-violet-100 flex items-center justify-center text-xs font-bold text-violet-700">
        {(p.userName ?? p.userEmail ?? '?')[0].toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900">{p.userName ?? 'Unnamed'}</p>
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <span>{p.userEmail}</span>
          <span>&middot;</span>
          <span>{permSummary}</span>
          <span>&middot;</span>
          <span>{new Date(p.createdAt).toLocaleDateString()}</span>
        </div>
      </div>
      <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${PARTNER_STATUS_STYLES[p.status] ?? 'bg-gray-100 text-gray-500'}`}>
        {PARTNER_STATUS_LABELS[p.status] ?? p.status}
      </span>
      {p.revokedAt && (
        <span className="text-[10px] text-gray-400">
          Revoked {new Date(p.revokedAt).toLocaleDateString()}
        </span>
      )}
      {onRevoke && p.status !== 'revoked' && p.status !== 'rejected' && p.status !== 'expired' && (
        <button
          onClick={onRevoke}
          disabled={revoking}
          className="text-xs text-red-600 hover:text-red-800 font-medium"
        >
          {revoking ? 'Revoking...' : 'Revoke'}
        </button>
      )}
    </div>
  )
}

/* ── Invite Partner Modal ─────────────────────────── */

function InvitePartnerModal({ slug, proposalId, onClose, onInvited }: {
  slug: string; proposalId: string; onClose: () => void; onInvited: () => void
}) {
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [defaultPerm, setDefaultPerm] = useState<'view' | 'review' | 'edit'>('view')
  const [canUpload, setCanUpload] = useState(false)
  const [canViewMetadata, setCanViewMetadata] = useState(true)
  const [accessScope, setAccessScope] = useState<'proposal_only' | 'proposal_and_files'>('proposal_only')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleInvite() {
    if (!email.trim() || !name.trim()) {
      setError('Email and name are required')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const permissions = {
        default: defaultPerm,
        sections: {},
        uploads: {
          can_upload: canUpload,
          can_delete_own: canUpload,
          can_view_all: false,
          can_view_shared: true,
        },
        library: { can_access: false },
        proposal: {
          can_view_metadata: canViewMetadata,
          can_advance_stage: false,
          can_export: false,
        },
      }

      const res = await fetch(`/api/portal/${slug}/proposals/${proposalId}/partners`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          name: name.trim(),
          permissions,
          accessScope,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      onInvited()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to invite partner')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-elevated">
        <h2 className="text-lg font-bold text-gray-900">Invite Partner</h2>
        <p className="mt-1 text-sm text-gray-500">Add an external collaborator to this proposal.</p>

        <div className="mt-4 space-y-4">
          <div>
            <label className="label">Name</label>
            <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="Jane Smith" />
          </div>

          <div>
            <label className="label">Email</label>
            <input className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="jane@partner.com" />
          </div>

          <div>
            <label className="label">Default Permission</label>
            <select className="input" value={defaultPerm} onChange={e => setDefaultPerm(e.target.value as any)}>
              <option value="view">View only</option>
              <option value="review">Review (view + comment)</option>
              <option value="edit">Edit (full section editing)</option>
            </select>
          </div>

          <div>
            <label className="label">Access Scope</label>
            <select className="input" value={accessScope} onChange={e => setAccessScope(e.target.value as any)}>
              <option value="proposal_only">Proposal only</option>
              <option value="proposal_and_files">Proposal + files</option>
            </select>
          </div>

          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={canUpload} onChange={e => setCanUpload(e.target.checked)} className="rounded" />
              Can upload files
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={canViewMetadata} onChange={e => setCanViewMetadata(e.target.checked)} className="rounded" />
              Can view proposal metadata
            </label>
          </div>
        </div>

        {error && (
          <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
        )}

        <div className="mt-6 flex justify-end gap-3">
          <button onClick={onClose} className="btn-secondary text-sm">Cancel</button>
          <button onClick={handleInvite} disabled={saving} className="btn-primary text-sm">
            {saving ? 'Inviting...' : 'Send Invitation'}
          </button>
        </div>
      </div>
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
