import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import SpotlightFeed, { type ScoredTopic } from '@/components/portal/spotlight-feed';

export const dynamic = 'force-dynamic';

/**
 * Spotlight feed — ranked list of open topics scored against the
 * customer's profile.
 *
 * Scoring uses pre-computed pipeline scores from tenant_pipeline_items
 * when available (authoritative). For opportunities not yet scored by
 * the pipeline, a lightweight estimation is computed from the tenant's
 * application profile data:
 *   - tech_focus_areas overlap with application.tech_areas  → 15pts each
 *   - agency match (topic agency vs application.target_agencies) → 20pts
 *   - program_type match → 15pts
 *   - Has library content for topic category → 10pt bonus
 *   - Capped at 100
 *
 * Pipeline-scored items sort first, then estimated items.
 * tenant_profiles.min_surface_score filters out low-scoring items.
 */
export default async function SpotlightsPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;

  // ---------- Auth + tenant ----------
  const session = await auth();
  if (!session?.user) {
    redirect('/login');
  }

  const sessionUser = session.user as {
    id?: string;
    email?: string | null;
    role?: unknown;
    tenantId?: string | null;
  };
  const role: Role | null = isRole(sessionUser.role) ? sessionUser.role : null;
  if (!role || !sessionUser.id) {
    redirect('/login?error=session');
  }

  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) {
    redirect('/portal');
  }
  const tenantId = tenant.id as string;

  const hasAccess = await verifyTenantAccess(sessionUser.id, role, tenantId);
  if (!hasAccess) {
    redirect('/portal');
  }

  if (!hasRoleAtLeast(role, 'tenant_user')) {
    redirect(`/portal/${tenantSlug}/proposals`);
  }

  // ---------- Tenant profile (min_surface_score threshold) ----------
  let minSurfaceScore = 0;
  try {
    const [tp] = await sql<{ minSurfaceScore: number | null }[]>`
      SELECT min_surface_score FROM tenant_profiles
      WHERE tenant_id = ${tenantId}
      LIMIT 1
    `;
    if (tp?.minSurfaceScore != null) {
      minSurfaceScore = tp.minSurfaceScore;
    }
  } catch (e) {
    console.error('[spotlight] tenant_profiles query failed', e);
  }

  // ---------- Customer profile from application ----------
  interface ApplicationProfile {
    techAreas: string[];
    targetPrograms: string[];
    targetAgencies: string[];
  }

  let profile: ApplicationProfile = {
    techAreas: [],
    targetPrograms: [],
    targetAgencies: [],
  };

  try {
    // Get user email for application lookup
    const [user] = await sql<{ email: string }[]>`
      SELECT email FROM users WHERE id = ${sessionUser.id}
    `;
    if (user?.email) {
      const [app] = await sql<
        { techAreas: string[]; targetPrograms: string[]; targetAgencies: string[] }[]
      >`
        SELECT tech_areas, target_programs, target_agencies
        FROM applications
        WHERE LOWER(contact_email) = ${user.email.toLowerCase()}
        LIMIT 1
      `;
      if (app) {
        profile = {
          techAreas: app.techAreas ?? [],
          targetPrograms: app.targetPrograms ?? [],
          targetAgencies: app.targetAgencies ?? [],
        };
      }
    }
  } catch (e) {
    console.error('[spotlight] application profile query failed', e);
  }

  // ---------- Active topics with pipeline scores ----------
  interface TopicRow {
    id: string;
    topicNumber: string | null;
    title: string;
    agency: string | null;
    topicBranch: string | null;
    programType: string | null;
    closeDate: string | null;
    postedDate: string | null;
    techFocusAreas: string[];
    namespace: string | null;
    pipelineScore: number | null;
    priorityTier: string | null;
    isPinned: boolean | null;
    pursuitStatus: string | null;
  }

  let topics: TopicRow[] = [];
  try {
    topics = await sql<TopicRow[]>`
      SELECT
        o.id,
        o.topic_number,
        o.title,
        o.agency,
        o.topic_branch,
        o.program_type,
        o.close_date,
        o.posted_date,
        o.tech_focus_areas,
        cs.namespace,
        tpi.total_score AS pipeline_score,
        tpi.priority_tier,
        tpi.is_pinned,
        tpi.pursuit_status
      FROM opportunities o
      LEFT JOIN curated_solicitations cs ON cs.id = o.solicitation_id
      LEFT JOIN tenant_pipeline_items tpi
        ON tpi.opportunity_id = o.id AND tpi.tenant_id = ${tenantId}
      WHERE o.topic_status = 'open'
        AND o.is_active = true
        AND o.solicitation_id IN (
          SELECT id FROM curated_solicitations WHERE status = 'pushed_to_pipeline'
        )
      ORDER BY o.close_date ASC NULLS LAST
    `;
  } catch (e) {
    console.error('[spotlight] topics query failed', e);
  }

  // ---------- Library content counts by category ----------
  const libraryCategories = new Set<string>();
  try {
    const catRows = await sql<{ category: string }[]>`
      SELECT DISTINCT category FROM library_units
      WHERE tenant_id = ${tenantId} AND status != 'archived'
    `;
    for (const row of catRows) {
      libraryCategories.add(row.category.toLowerCase());
    }
  } catch (e) {
    console.error('[spotlight] library categories query failed', e);
  }

  // ---------- Score each topic ----------
  const profileTechLower = new Set(profile.techAreas.map((a) => a.toLowerCase()));
  const profileAgenciesLower = new Set(profile.targetAgencies.map((a) => a.toLowerCase()));
  const profileProgramsLower = new Set(profile.targetPrograms.map((p) => p.toLowerCase()));

  const scoredTopics: ScoredTopic[] = [];

  for (const topic of topics) {
    // --- Lightweight estimation (always computed for match reasons) ---
    let estimatedScore = 0;
    const matchReasons: string[] = [];

    // Tech focus overlap: 15pts per match
    const topicTechLower = (topic.techFocusAreas ?? []).map((t) => t.toLowerCase());
    for (const tech of topicTechLower) {
      if (profileTechLower.has(tech)) {
        estimatedScore += 15;
        const original =
          profile.techAreas.find((a) => a.toLowerCase() === tech) ?? tech;
        matchReasons.push(original);
      }
    }

    // Agency match: 20pts
    if (topic.agency && profileAgenciesLower.has(topic.agency.toLowerCase())) {
      estimatedScore += 20;
      matchReasons.push(`Agency: ${topic.agency}`);
    }

    // Program type match: 15pts
    if (topic.programType && profileProgramsLower.has(topic.programType.toLowerCase())) {
      estimatedScore += 15;
      matchReasons.push(`Program: ${topic.programType}`);
    }

    // Library content bonus: 10pts if category matches any tech focus
    const hasLibrary = topicTechLower.some((t) => libraryCategories.has(t));
    if (hasLibrary) {
      estimatedScore += 10;
      matchReasons.push('Library content available');
    }

    // Cap at 100
    estimatedScore = Math.min(100, estimatedScore);

    // --- Determine authoritative score ---
    const pipelineScore = topic.pipelineScore;
    const isEstimated = pipelineScore === null;
    const displayScore = pipelineScore ?? estimatedScore;

    // --- Apply min_surface_score filter ---
    if (minSurfaceScore > 0 && displayScore < minSurfaceScore) {
      continue;
    }

    scoredTopics.push({
      id: topic.id,
      topicNumber: topic.topicNumber,
      title: topic.title,
      agency: topic.agency,
      topicBranch: topic.topicBranch,
      programType: topic.programType,
      closeDate: topic.closeDate,
      postedDate: topic.postedDate,
      matchScore: displayScore,
      matchReasons,
      isPinned: topic.isPinned ?? false,
      namespace: topic.namespace,
      pipelineScore: pipelineScore,
      isEstimated,
      priorityTier: topic.priorityTier ?? null,
    });
  }

  // Sort: pipeline-scored first by score DESC, then estimated by score DESC.
  // Within each group, secondary sort by close_date ASC.
  scoredTopics.sort((a, b) => {
    // Pipeline-scored items come first
    if (!a.isEstimated && b.isEstimated) return -1;
    if (a.isEstimated && !b.isEstimated) return 1;

    // Within same group, sort by score DESC
    if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;

    // Secondary sort: close_date ASC (nulls last)
    if (!a.closeDate) return 1;
    if (!b.closeDate) return -1;
    return new Date(a.closeDate).getTime() - new Date(b.closeDate).getTime();
  });

  // ---------- Derive filter options ----------
  const agencySet = new Set<string>();
  const programSet = new Set<string>();
  for (const t of scoredTopics) {
    if (t.agency) agencySet.add(t.agency);
    if (t.programType) programSet.add(t.programType);
  }
  const agencies = Array.from(agencySet).sort();
  const programTypes = Array.from(programSet).sort();

  // ---------- Render ----------
  return (
    <div>
      <h1 className="text-2xl font-bold">Spotlight Feed</h1>
      <p className="text-gray-500 mt-1 text-sm mb-6">
        Topics ranked by how well they match your company profile.
        {profile.techAreas.length === 0 &&
          profile.targetAgencies.length === 0 &&
          profile.targetPrograms.length === 0 && (
            <span className="block mt-1 text-amber-600">
              No profile data found. Scores are based on available data only.
            </span>
          )}
      </p>

      <SpotlightFeed
        topics={scoredTopics}
        tenantSlug={tenantSlug}
        agencies={agencies}
        programTypes={programTypes}
      />
    </div>
  );
}
