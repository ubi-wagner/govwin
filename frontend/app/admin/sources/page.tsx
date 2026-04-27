import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { sql } from '@/lib/db';
import SourcesHub, {
  type SourceProfile,
  type SourceVisit,
} from '@/components/admin/source-card-actions';

// ── Types for raw DB rows ───────────────────────────────────────────

type SourceProfileRow = {
  id: string;
  name: string;
  siteType: string;
  baseUrl: string;
  bookmarkUrl: string | null;
  agency: string | null;
  programType: string | null;
  adminNotes: string | null;
  visitInstructions: string | null;
  topicUrlPattern: string | null;
  pdfUrlPattern: string | null;
  isActive: boolean;
  lastVisitedAt: Date | null;
  lastVisitedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  visitCount: string;
  lastActivity: Date | null;
};

type SourceVisitRow = {
  id: string;
  profileId: string;
  visitedBy: string | null;
  action: string;
  url: string | null;
  notes: string | null;
  filesCount: number;
  topicsCount: number;
  metadata: Record<string, unknown>;
  createdAt: Date;
  sourceName: string;
};

// ── Page ─────────────────────────────────────────────────────────────

export default async function SourcesPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const role = (session.user as { role?: string }).role;
  if (role !== 'rfp_admin' && role !== 'master_admin') {
    redirect('/login');
  }

  let profileRows: SourceProfileRow[] = [];
  let visitRows: SourceVisitRow[] = [];

  try {
    profileRows = await sql<SourceProfileRow[]>`
      SELECT sp.*,
        (SELECT COUNT(*) FROM source_visits sv WHERE sv.profile_id = sp.id) AS visit_count,
        (SELECT MAX(sv.created_at) FROM source_visits sv WHERE sv.profile_id = sp.id) AS last_activity
      FROM source_profiles sp
      WHERE sp.is_active = true
      ORDER BY sp.name
    `;
  } catch (e) {
    console.error('[admin/sources] profiles query failed:', e);
  }

  try {
    visitRows = await sql<SourceVisitRow[]>`
      SELECT sv.*, sp.name AS source_name
      FROM source_visits sv
      JOIN source_profiles sp ON sp.id = sv.profile_id
      ORDER BY sv.created_at DESC
      LIMIT 20
    `;
  } catch (e) {
    console.error('[admin/sources] activity query failed:', e);
  }

  // Serialize Date objects to ISO strings for the client component
  const profiles: SourceProfile[] = profileRows.map((r) => ({
    id: r.id,
    name: r.name,
    siteType: r.siteType,
    baseUrl: r.baseUrl,
    bookmarkUrl: r.bookmarkUrl,
    agency: r.agency,
    programType: r.programType,
    adminNotes: r.adminNotes,
    visitInstructions: r.visitInstructions,
    topicUrlPattern: r.topicUrlPattern,
    pdfUrlPattern: r.pdfUrlPattern,
    isActive: r.isActive,
    lastVisitedAt: r.lastVisitedAt?.toISOString() ?? null,
    lastVisitedBy: r.lastVisitedBy,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    visitCount: r.visitCount,
    lastActivity: r.lastActivity?.toISOString() ?? null,
  }));

  const activity: SourceVisit[] = visitRows.map((v) => ({
    id: v.id,
    profileId: v.profileId,
    visitedBy: v.visitedBy,
    action: v.action,
    url: v.url,
    notes: v.notes,
    filesCount: v.filesCount,
    topicsCount: v.topicsCount,
    metadata: v.metadata,
    createdAt: v.createdAt.toISOString(),
    sourceName: v.sourceName,
  }));

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Opportunity Sources</h1>
          <p className="text-sm text-gray-500 mt-1">
            Bookmarked sites for monitoring federal R&amp;D funding opportunities
          </p>
        </div>
        <a
          href="/admin/rfp-curation/upload"
          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded"
        >
          + New Solicitation
        </a>
      </div>
      <SourcesHub initialProfiles={profiles} initialActivity={activity} />
    </div>
  );
}
