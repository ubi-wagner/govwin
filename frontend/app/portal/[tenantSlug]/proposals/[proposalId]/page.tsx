import { redirect, notFound } from 'next/navigation';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, type Role } from '@/lib/rbac';
import { ProposalWorkspace } from '@/components/portal/proposal-workspace';

interface Props {
  params: Promise<{ tenantSlug: string; proposalId: string }>;
}

const STAGE_ORDER = [
  'outline',
  'draft',
  'pink_team',
  'red_team',
  'gold_team',
  'final',
  'submitted',
  'archived',
] as const;

export default async function ProposalWorkspacePage({ params }: Props) {
  const { tenantSlug, proposalId } = await params;

  const session = await auth();
  if (!session?.user) redirect('/login');

  const sessionUser = session.user as {
    id?: string;
    role?: unknown;
    tenantId?: string | null;
  };

  const role: Role | null = isRole(sessionUser.role) ? sessionUser.role : null;
  if (!role || !sessionUser.id) redirect('/login?error=session');

  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) redirect('/login');

  const tenantId = tenant.id as string;
  const hasAccess = await verifyTenantAccess(sessionUser.id, role, tenantId);
  if (!hasAccess) redirect('/login');

  // ── Load proposal with opportunity + solicitation context ───────────
  interface ProposalRow {
    id: string;
    title: string;
    stage: string;
    isLocked: boolean;
    createdAt: Date;
    opportunityId: string;
    solicitationId: string | null;
    agency: string | null;
    topicNumber: string | null;
    closeDate: Date | null;
    solicitationTitle: string | null;
    programType: string | null;
  }

  let proposal: ProposalRow | null = null;

  try {
    const rows = await sql<ProposalRow[]>`
      SELECT
        p.id,
        p.title,
        p.stage,
        p.is_locked,
        p.created_at,
        p.opportunity_id,
        p.solicitation_id,
        o.agency,
        o.topic_number,
        o.close_date,
        o.program_type,
        cs.solicitation_title
      FROM proposals p
      JOIN opportunities o ON o.id = p.opportunity_id
      LEFT JOIN curated_solicitations cs ON cs.id = p.solicitation_id
      WHERE p.id = ${proposalId}
        AND p.tenant_id = ${tenantId}
      LIMIT 1
    `;
    proposal = rows[0] ?? null;
  } catch (e) {
    console.error('[portal/proposals/workspace] proposal query error:', e);
  }

  if (!proposal) notFound();

  // ── Load sections ──────────────────────────────────────────────────
  let sections: {
    id: string;
    sectionNumber: string;
    title: string;
    status: string;
    pageAllocation: number | null;
    version: number;
    nodeCount: number;
  }[] = [];

  try {
    sections = await sql<typeof sections>`
      SELECT
        ps.id,
        ps.section_number,
        ps.title,
        ps.status,
        ps.page_allocation,
        ps.version,
        CASE
          WHEN ps.content IS NOT NULL AND ps.content::text != 'null' AND ps.content::text != ''
          THEN (
            SELECT COUNT(*)::int
            FROM jsonb_array_elements(
              CASE
                WHEN jsonb_typeof((ps.content::jsonb)->'nodes') = 'array'
                THEN (ps.content::jsonb)->'nodes'
                ELSE '[]'::jsonb
              END
            )
          )
          ELSE 0
        END AS node_count
      FROM proposal_sections ps
      WHERE ps.proposal_id = ${proposalId}
      ORDER BY ps.section_number ASC
    `;
  } catch (e) {
    console.error('[portal/proposals/workspace] sections query error:', e);
  }

  // ── Compute stage index for the progress indicator ─────────────────
  const currentStageIndex = STAGE_ORDER.indexOf(
    proposal.stage as (typeof STAGE_ORDER)[number],
  );

  const hasEmptySections = sections.some(
    (s) => s.status === 'empty' || s.nodeCount === 0,
  );

  const closeDateStr = proposal.closeDate
    ? new Date(proposal.closeDate).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : null;

  return (
    <div>
      {/* ── Proposal Header ───────────────────────────────────────────── */}
      <div className="mb-8">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-gray-900 truncate">
              {proposal.title}
            </h1>
            <div className="flex items-center gap-3 mt-2 text-sm text-gray-500">
              {proposal.topicNumber && <span>Topic {proposal.topicNumber}</span>}
              {proposal.agency && <span>{proposal.agency}</span>}
              {proposal.programType && (
                <span className="uppercase text-xs font-medium text-indigo-600">
                  {proposal.programType}
                </span>
              )}
              {closeDateStr && (
                <span
                  className={
                    proposal.closeDate && new Date(proposal.closeDate) < new Date()
                      ? 'text-red-600 font-medium'
                      : ''
                  }
                >
                  {proposal.closeDate && new Date(proposal.closeDate) < new Date()
                    ? 'Closed'
                    : 'Due'}{' '}
                  {closeDateStr}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* ── Stage Progress ──────────────────────────────────────────── */}
        <div className="mt-6">
          <div className="flex items-center gap-1">
            {STAGE_ORDER.filter((s) => s !== 'archived').map((stage, idx) => {
              const isActive = idx === currentStageIndex;
              const isComplete = idx < currentStageIndex;
              const label = stage
                .replace(/_/g, ' ')
                .replace(/\b\w/g, (c) => c.toUpperCase());

              return (
                <div key={stage} className="flex items-center gap-1">
                  <div
                    className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                      isActive
                        ? 'bg-indigo-600 text-white'
                        : isComplete
                          ? 'bg-indigo-100 text-indigo-700'
                          : 'bg-gray-100 text-gray-400'
                    }`}
                  >
                    {label}
                  </div>
                  {idx < STAGE_ORDER.length - 2 && (
                    <div
                      className={`w-4 h-0.5 ${
                        isComplete ? 'bg-indigo-300' : 'bg-gray-200'
                      }`}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Workspace Client Component ────────────────────────────────── */}
      <ProposalWorkspace
        proposalId={proposalId}
        tenantSlug={tenantSlug}
        sections={sections.map((s) => ({
          id: s.id,
          sectionNumber: s.sectionNumber,
          title: s.title,
          status: s.status,
          pageAllocation: s.pageAllocation,
          version: s.version,
          nodeCount: s.nodeCount,
        }))}
        hasEmptySections={hasEmptySections}
        proposalStage={proposal.stage}
        isLocked={proposal.isLocked}
      />
    </div>
  );
}
