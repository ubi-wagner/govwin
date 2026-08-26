import { auth } from '@/auth';
import { redirect } from 'next/navigation';
// Admin cross-tenant console page — reads span tenants, so use the owner (BYPASSRLS) pool. (docs/RLS_CUTOVER.md)
import { sqlBypass as sql } from '@/lib/db';
import { TriageQueue } from '@/components/rfp-curation/triage-queue';
import TriageTodos from './triage-todos';
import IntakeStageStrip from '@/components/admin/intake-stage-strip';
import { loadIntakeStageCounts } from '@/lib/admin/intake-stage-counts';

export const dynamic = 'force-dynamic';

export default async function RFPCurationPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');

  type Row = {
    solicitationId: string;
    opportunityId: string;
    status: string;
    namespace: string | null;
    claimedBy: string | null;
    claimedAt: Date | null;
    curatedBy: string | null;
    approvedBy: string | null;
    createdAt: Date;
    title: string;
    source: string;
    agency: string | null;
    office: string | null;
    programType: string | null;
    closeDate: Date | null;
    postedDate: Date | null;
  };

  let rows: Row[] = [];
  try {
    rows = await sql<Row[]>`
      SELECT
        cs.id AS solicitation_id,
        cs.opportunity_id,
        cs.status,
        cs.namespace,
        cs.claimed_by,
        cs.claimed_at,
        cs.curated_by,
        cs.approved_by,
        cs.created_at,
        o.title,
        o.source,
        o.agency,
        o.office,
        o.program_type,
        o.close_date,
        o.posted_date
      FROM curated_solicitations cs
      JOIN opportunities o ON o.id = cs.opportunity_id
      ORDER BY cs.created_at DESC
      LIMIT 100
    `;
  } catch (e: unknown) {
    if (e && typeof e === 'object' && 'digest' in e) throw e; // re-throw NEXT_REDIRECT
    console.error('[admin/rfp-curation] query failed:', e);
  }

  const items = rows.map((r) => ({
    solicitationId: r.solicitationId,
    opportunityId: r.opportunityId,
    status: r.status,
    namespace: r.namespace,
    claimedBy: r.claimedBy,
    claimedAt: r.claimedAt?.toISOString() ?? null,
    curatedBy: r.curatedBy,
    approvedBy: r.approvedBy,
    createdAt: r.createdAt.toISOString(),
    title: r.title,
    source: r.source,
    agency: r.agency,
    office: r.office,
    programType: r.programType,
    closeDate: r.closeDate?.toISOString() ?? null,
    postedDate: r.postedDate?.toISOString() ?? null,
  }));

  // The discovery river's backlog, shared by every stage (#176).
  const stageCounts = await loadIntakeStageCounts();

  return (
    <div>
      <IntakeStageStrip current="curation" counts={stageCounts} />
      <TriageTodos />
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">RFP Triage Queue</h1>
          <p className="text-sm text-gray-500 mt-1">
            {items.length} solicitations &middot; Claim, review, and curate incoming RFPs
          </p>
        </div>
        <a
          href="/admin/rfp-curation/upload"
          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded"
        >
          + Upload RFP
        </a>
      </div>
      <TriageQueue
        initialItems={items}
        currentUserId={session.user.id ?? ''}
        currentUserRole={(session.user as { role?: string }).role ?? ''}
      />
    </div>
  );
}
