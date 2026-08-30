// Admin cross-tenant console page — reads span tenants, so use the owner (BYPASSRLS) pool. (docs/RLS_CUTOVER.md)
import { sqlBypass as sql } from '@/lib/db';
import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { MasterCards } from '@/components/admin/master-cards';
import IntakeStageStrip from '@/components/admin/intake-stage-strip';
import { loadIntakeStageCounts } from '@/lib/admin/intake-stage-counts';

export const dynamic = 'force-dynamic';

/**
 * Master opportunity cards (RFP admin) — the GLOBAL source-of-truth version of the
 * per-tenant replicant cards customers see (portal /cards). Each row is one
 * opportunity with its curation status, matrix summary (volumes / items / page
 * limits / submission format), the forward-only bridge head version, and how many
 * tenant cards it has fanned out to (replicant + pinned counts). Sortable + auto-
 * refreshing so it doubles as the fan-out cockpit during an end-to-end run.
 */

// DB row (postgres.js camel-transforms snake columns → camelCase; timestamps are Date).
interface CardRow {
  opportunityId: string;
  title: string | null;
  agency: string | null;
  office: string | null;
  programType: string | null;
  solicitationNumber: string | null;
  topicNumber: string | null;
  lifecycleStatus: string | null;
  submissionStage: string | null;
  isActive: boolean;
  orgUnit: string | null;
  closeDate: Date | null;
  postedDate: Date | null;
  preReleaseDate: Date | null;
  openDate: Date | null;
  ingestedAt: Date;
  oppUpdatedAt: Date | null;
  releasedByEmail: string | null;
  releasedAt: Date | null;
  expertNotes: string | null;
  solicitationId: string | null;
  curationStatus: string | null;
  namespace: string | null;
  curationUpdatedAt: Date | null;
  pageLimitTechnical: number | null;
  pageLimitCost: number | null;
  submissionFormat: string | null;
  volumeCount: number;
  itemCount: number;
  bridgeVersion: number | null;
  lastPublishedAt: Date | null;
  bridgeEvent: string | null;
  replicantCount: number;
  pinnedCount: number;
}

const iso = (d: Date | null): string | null => (d ? new Date(d).toISOString() : null);

export default async function AdminMasterCardsPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  const role = (session.user as { role?: string }).role;
  if (role !== 'master_admin' && role !== 'rfp_admin') redirect('/admin');

  let rows: CardRow[] = [];
  try {
    rows = await sql<CardRow[]>`
      SELECT
        o.id AS opportunity_id,
        o.title, o.agency, o.office, o.org_unit, o.program_type,
        o.solicitation_number, o.topic_number,
        o.lifecycle_status, o.submission_stage, o.is_active,
        o.close_date, o.posted_date, o.pre_release_date, o.open_date,
        o.created_at AS ingested_at, o.updated_at AS opp_updated_at,
        o.released_at, o.expert_notes, ur.email AS released_by_email,
        cs.id AS solicitation_id, cs.status AS curation_status, cs.namespace,
        cs.updated_at AS curation_updated_at,
        sc.page_limit_technical, sc.page_limit_cost, sc.submission_format,
        (SELECT count(*)::int FROM solicitation_volumes sv
           WHERE sv.solicitation_id = cs.id AND sv.topic_id IS NULL) AS volume_count,
        (SELECT count(*)::int FROM volume_required_items vri
           JOIN solicitation_volumes sv2 ON sv2.id = vri.volume_id
           WHERE sv2.solicitation_id = cs.id AND sv2.topic_id IS NULL) AS item_count,
        b.version AS bridge_version, b.posted_at AS last_published_at, b.event_type AS bridge_event,
        COALESCE(r.replicant_count, 0)::int AS replicant_count,
        COALESCE(r.pinned_count, 0)::int AS pinned_count
      FROM opportunities o
      LEFT JOIN curated_solicitations cs ON cs.opportunity_id = o.id
      LEFT JOIN solicitation_compliance sc ON sc.solicitation_id = cs.id AND sc.topic_id IS NULL
      LEFT JOIN users ur ON ur.id = o.released_by
      LEFT JOIN LATERAL (
        SELECT version, posted_at, event_type FROM opportunity_bridge ob
        WHERE ob.opportunity_id = o.id ORDER BY version DESC LIMIT 1
      ) b ON true
      LEFT JOIN (
        SELECT opportunity_id,
               count(*) AS replicant_count,
               count(*) FILTER (WHERE docs_copied) AS pinned_count
        FROM tenant_opportunity_cards GROUP BY opportunity_id
      ) r ON r.opportunity_id = o.id
      ORDER BY o.created_at DESC
      LIMIT 500
    `;
  } catch (e) {
    console.error('[admin/cards] master card query failed:', e);
  }

  // Serialize dates to ISO strings for the client component.
  const cards = rows.map((r) => ({
    opportunityId: r.opportunityId,
    title: r.title,
    agency: r.agency,
    office: r.office,
    programType: r.programType,
    solicitationNumber: r.solicitationNumber,
    topicNumber: r.topicNumber,
    lifecycleStatus: r.lifecycleStatus,
    submissionStage: r.submissionStage,
    isActive: r.isActive,
    orgUnit: r.orgUnit,
    closeDate: iso(r.closeDate),
    postedDate: iso(r.postedDate),
    preReleaseDate: iso(r.preReleaseDate),
    openDate: iso(r.openDate),
    ingestedAt: iso(r.ingestedAt) ?? '',
    oppUpdatedAt: iso(r.oppUpdatedAt),
    releasedByEmail: r.releasedByEmail,
    releasedAt: iso(r.releasedAt),
    expertNotes: r.expertNotes,
    solicitationId: r.solicitationId,
    curationStatus: r.curationStatus,
    namespace: r.namespace,
    curationUpdatedAt: iso(r.curationUpdatedAt),
    pageLimitTechnical: r.pageLimitTechnical,
    pageLimitCost: r.pageLimitCost,
    submissionFormat: r.submissionFormat,
    volumeCount: r.volumeCount,
    itemCount: r.itemCount,
    bridgeVersion: r.bridgeVersion,
    lastPublishedAt: iso(r.lastPublishedAt),
    bridgeEvent: r.bridgeEvent,
    replicantCount: r.replicantCount,
    pinnedCount: r.pinnedCount,
  }));

  // The discovery river's backlog, shared by every stage (#176).
  const stageCounts = await loadIntakeStageCounts();

  return (
    <div>
      <IntakeStageStrip current="cards" counts={stageCounts} />
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Opportunity Cards</h1>
        <p className="text-sm text-gray-500 mt-1">
          The master (global) opportunity cards. On push, each fans out to every customer&apos;s
          pipeline as a replicant tenant card — the counts below show that replication live.
        </p>
      </div>
      <MasterCards cards={cards} />
    </div>
  );
}
