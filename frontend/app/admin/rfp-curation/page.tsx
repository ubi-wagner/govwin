import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { sql } from '@/lib/db';
import { TriageQueue } from '@/components/rfp-curation/triage-queue';

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

  const rows = await sql<Row[]>`
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

  return (
    <div>
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
      <TriageQueue initialItems={items} currentUserId={session.user.id ?? ''} />
    </div>
  );
}
