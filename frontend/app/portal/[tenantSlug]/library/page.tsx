import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, type Role } from '@/lib/rbac';
import LibraryDashboard from '@/components/portal/library-dashboard';
import type { LibraryUnit } from '@/components/portal/atom-detail-modal';

/**
 * Library page — rich card-catalog with provenance tracking, outcome badges,
 * bulk upload, and proposal linkage.
 *
 * Server component: loads all data, then renders the LibraryDashboard client component.
 */

export default async function LibraryPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;

  // ---------- Auth ----------
  const session = await auth();
  if (!session?.user) {
    redirect('/login');
  }

  const sessionUser = session.user as {
    id?: string;
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

  // ---------- Fetch library units with provenance ----------
  let units: LibraryUnit[] = [];
  let total = 0;
  try {
    const [countRow] = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count
      FROM library_units
      WHERE tenant_id = ${tenantId}::uuid
    `;
    total = parseInt(countRow.count, 10);

    units = await sql<LibraryUnit[]>`
      SELECT
        lu.id,
        lu.content,
        lu.category,
        lu.subcategory,
        lu.tags,
        lu.confidence,
        lu.status,
        lu.source_type,
        lu.source_id,
        lu.usage_count,
        lu.outcome,
        lu.outcome_score,
        lu.original_proposal_id,
        lu.original_node_id,
        lu.atom_hash,
        lu.created_at,
        lu.updated_at,
        p.title AS proposal_title
      FROM library_units lu
      LEFT JOIN proposals p ON lu.original_proposal_id = p.id
      WHERE lu.tenant_id = ${tenantId}::uuid
      ORDER BY lu.outcome_score DESC NULLS LAST, lu.usage_count DESC, lu.created_at DESC
      LIMIT 200
    `;
  } catch (e) {
    console.error('[library] query failed', e);
  }

  // ---------- Category counts ----------
  let byCategory: Array<{ category: string; count: number }> = [];
  try {
    byCategory = await sql<{ category: string; count: number }[]>`
      SELECT category, count(*)::int AS count
      FROM library_units
      WHERE tenant_id = ${tenantId}::uuid
      GROUP BY category
      ORDER BY count DESC
    `;
  } catch (e) {
    console.error('[library] category counts query failed', e);
  }

  // ---------- Source type counts ----------
  let bySourceType: Array<{ sourceType: string; count: number }> = [];
  try {
    bySourceType = await sql<{ sourceType: string; count: number }[]>`
      SELECT source_type, count(*)::int AS count
      FROM library_units
      WHERE tenant_id = ${tenantId}::uuid AND source_type IS NOT NULL
      GROUP BY source_type
      ORDER BY count DESC
    `;
  } catch (e) {
    console.error('[library] source type counts query failed', e);
  }

  // ---------- Winning atoms count ----------
  let winningCount = 0;
  try {
    const [row] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM library_units
      WHERE tenant_id = ${tenantId}::uuid AND outcome = 'awarded'
    `;
    winningCount = row.count;
  } catch (e) {
    console.error('[library] winning count query failed', e);
  }

  // ---------- Total usage ----------
  let totalUsage = 0;
  try {
    const [row] = await sql<{ total: number }[]>`
      SELECT coalesce(sum(usage_count), 0)::int AS total
      FROM library_units
      WHERE tenant_id = ${tenantId}::uuid
    `;
    totalUsage = row.total;
  } catch (e) {
    console.error('[library] total usage query failed', e);
  }

  // ---------- Active proposals (for "Assign to Proposal" feature) ----------
  let proposals: Array<{ id: string; title: string }> = [];
  try {
    proposals = await sql<{ id: string; title: string }[]>`
      SELECT id, title
      FROM proposals
      WHERE tenant_id = ${tenantId}::uuid
        AND stage NOT IN ('submitted', 'archived')
      ORDER BY updated_at DESC
      LIMIT 50
    `;
  } catch (e) {
    console.error('[library] proposals query failed', e);
  }

  const stats = {
    total,
    byCategory,
    bySourceType,
    winningCount,
    totalUsage,
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Content Library</h1>
        <p className="text-gray-500 mt-1 text-sm">
          Manage your reusable content atoms for proposal generation
        </p>
      </div>

      <LibraryDashboard
        tenantSlug={tenantSlug}
        initialUnits={units}
        initialTotal={total}
        stats={stats}
        proposals={proposals}
      />
    </div>
  );
}
