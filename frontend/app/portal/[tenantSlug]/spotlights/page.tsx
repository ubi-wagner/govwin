import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, type Role } from '@/lib/rbac';
import SpotlightFeed, { type ScoredTopic } from '@/components/portal/spotlight-feed';

/**
 * Spotlight feed — ranked list of open topics scored against the
 * customer's profile (tech areas, target agencies, target programs).
 *
 * Scoring:
 *   - tech_focus_areas overlap with application.tech_areas  → 15pts each
 *   - agency match (topic agency vs application.target_agencies) → 20pts
 *   - program_type match → 15pts
 *   - Has library content for topic category → 10pt bonus
 *
 * Results capped at 100.
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
    redirect('/login');
  }
  const tenantId = tenant.id as string;

  const hasAccess = await verifyTenantAccess(sessionUser.id, role, tenantId);
  if (!hasAccess) {
    redirect('/login');
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

  // ---------- Active topics ----------
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
        cs.namespace
      FROM opportunities o
      LEFT JOIN curated_solicitations cs ON cs.id = o.solicitation_id
      WHERE o.topic_status = 'open'
        AND o.is_active = true
      ORDER BY o.close_date ASC NULLS LAST
    `;
  } catch (e) {
    console.error('[spotlight] topics query failed', e);
  }

  // ---------- Pinned items lookup ----------
  const pinnedSet = new Set<string>();
  try {
    const pinRows = await sql<{ opportunityId: string }[]>`
      SELECT opportunity_id FROM tenant_pipeline_items
      WHERE tenant_id = ${tenantId} AND is_pinned = true
    `;
    for (const row of pinRows) {
      pinnedSet.add(row.opportunityId);
    }
  } catch (e) {
    console.error('[spotlight] pinned items query failed', e);
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

  const scoredTopics: ScoredTopic[] = topics.map((topic) => {
    let score = 0;
    const matchReasons: string[] = [];

    // Tech focus overlap: 15pts per match
    const topicTechLower = (topic.techFocusAreas ?? []).map((t) => t.toLowerCase());
    for (const tech of topicTechLower) {
      if (profileTechLower.has(tech)) {
        score += 15;
        // Find original-case version for display
        const original =
          profile.techAreas.find((a) => a.toLowerCase() === tech) ?? tech;
        matchReasons.push(original);
      }
    }

    // Agency match: 20pts
    if (topic.agency && profileAgenciesLower.has(topic.agency.toLowerCase())) {
      score += 20;
      matchReasons.push(`Agency: ${topic.agency}`);
    }

    // Program type match: 15pts
    if (topic.programType && profileProgramsLower.has(topic.programType.toLowerCase())) {
      score += 15;
      matchReasons.push(`Program: ${topic.programType}`);
    }

    // Library content bonus: 10pts if category matches any tech focus
    const hasLibrary = topicTechLower.some((t) => libraryCategories.has(t));
    if (hasLibrary) {
      score += 10;
      matchReasons.push('Library content available');
    }

    // Cap at 100
    score = Math.min(100, score);

    return {
      id: topic.id,
      topicNumber: topic.topicNumber,
      title: topic.title,
      agency: topic.agency,
      topicBranch: topic.topicBranch,
      programType: topic.programType,
      closeDate: topic.closeDate,
      postedDate: topic.postedDate,
      matchScore: score,
      matchReasons,
      isPinned: pinnedSet.has(topic.id),
      namespace: topic.namespace,
    };
  });

  // Sort by score DESC
  scoredTopics.sort((a, b) => b.matchScore - a.matchScore);

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
