import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, type Role } from '@/lib/rbac';
import Link from 'next/link';

interface Props {
  params: Promise<{ tenantSlug: string }>;
}

const STAGE_LABELS: Record<string, { label: string; color: string }> = {
  outline:    { label: 'Outline',    color: 'bg-gray-100 text-gray-700' },
  draft:      { label: 'Drafting',   color: 'bg-blue-100 text-blue-700' },
  pink_team:  { label: 'Pink Team',  color: 'bg-pink-100 text-pink-700' },
  red_team:   { label: 'Red Team',   color: 'bg-red-100 text-red-700' },
  gold_team:  { label: 'Gold Team',  color: 'bg-yellow-100 text-yellow-800' },
  final:      { label: 'Final',      color: 'bg-green-100 text-green-700' },
  submitted:  { label: 'Submitted',  color: 'bg-emerald-100 text-emerald-700' },
  archived:   { label: 'Archived',   color: 'bg-gray-200 text-gray-500' },
};

export default async function ProposalsListPage({ params }: Props) {
  const { tenantSlug } = await params;

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

  // ── Query proposals with section count + opportunity close date ─────
  let proposals: {
    id: string;
    title: string;
    stage: string;
    createdAt: Date;
    closeDate: Date | null;
    agency: string | null;
    topicNumber: string | null;
    sectionCount: number;
  }[] = [];

  try {
    proposals = await sql<typeof proposals>`
      SELECT
        p.id,
        p.title,
        p.stage,
        p.created_at,
        o.close_date,
        o.agency,
        o.topic_number,
        (SELECT COUNT(*)::int FROM proposal_sections ps WHERE ps.proposal_id = p.id) AS section_count
      FROM proposals p
      JOIN opportunities o ON o.id = p.opportunity_id
      WHERE p.tenant_id = ${tenantId}
      ORDER BY p.created_at DESC
    `;
  } catch (e) {
    console.error('[portal/proposals] query error:', e);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Proposals</h1>
          <p className="text-sm text-gray-500 mt-1">
            {proposals.length} proposal{proposals.length !== 1 ? 's' : ''}
          </p>
        </div>
      </div>

      {proposals.length === 0 ? (
        <div className="text-center py-16 bg-gray-50 rounded-lg border border-dashed border-gray-300">
          <h3 className="text-lg font-medium text-gray-600">No proposals yet</h3>
          <p className="text-sm text-gray-500 mt-1">
            Proposals are created when you purchase a topic from the pipeline.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {proposals.map((p) => {
            const stageInfo = STAGE_LABELS[p.stage] ?? { label: p.stage, color: 'bg-gray-100 text-gray-600' };
            const closeDateStr = p.closeDate
              ? new Date(p.closeDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
              : null;
            const createdStr = new Date(p.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            const isOverdue = p.closeDate ? new Date(p.closeDate) < new Date() : false;

            return (
              <Link
                key={p.id}
                href={`/portal/${tenantSlug}/proposals/${p.id}`}
                className="block bg-white border border-gray-200 rounded-lg p-5 hover:border-indigo-300 hover:shadow-sm transition-all"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <h3 className="font-semibold text-gray-900 truncate">{p.title}</h3>
                    <div className="flex items-center gap-3 mt-2 text-xs text-gray-500">
                      {p.agency && <span>{p.agency}</span>}
                      {p.topicNumber && <span>Topic {p.topicNumber}</span>}
                      <span>{p.sectionCount} section{p.sectionCount !== 1 ? 's' : ''}</span>
                      <span>Created {createdStr}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    {closeDateStr && (
                      <span className={`text-xs ${isOverdue ? 'text-red-600 font-medium' : 'text-gray-500'}`}>
                        {isOverdue ? 'Closed' : 'Due'} {closeDateStr}
                      </span>
                    )}
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${stageInfo.color}`}>
                      {stageInfo.label}
                    </span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
