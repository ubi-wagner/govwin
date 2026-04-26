import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, type Role } from '@/lib/rbac';

/**
 * Customer dashboard — the first page a newly-accepted customer sees.
 *
 * Shows:
 *   - Welcome message with company name
 *   - Quick stats: library units, active proposals, pinned pipeline items
 *   - Recent system_events for this tenant
 *   - "Get Started" onboarding checklist
 */
export default async function DashboardPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;

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

  const companyName = (tenant.name as string) ?? tenantSlug;
  const basePath = `/portal/${tenantSlug}`;

  // ---------- Quick stats ----------
  let libraryCount = 0;
  let proposalCount = 0;
  let pinnedCount = 0;

  try {
    const [libRow] = await sql<{ count: string }[]>`
      SELECT COUNT(*)::text AS count FROM library_units WHERE tenant_id = ${tenantId}
    `;
    libraryCount = parseInt(libRow?.count ?? '0', 10);
  } catch (e) {
    console.error('[dashboard] library count query failed', e);
  }

  try {
    const [propRow] = await sql<{ count: string }[]>`
      SELECT COUNT(*)::text AS count FROM proposals
      WHERE tenant_id = ${tenantId} AND stage NOT IN ('archived','submitted')
    `;
    proposalCount = parseInt(propRow?.count ?? '0', 10);
  } catch (e) {
    console.error('[dashboard] proposal count query failed', e);
  }

  try {
    const [pinRow] = await sql<{ count: string }[]>`
      SELECT COUNT(*)::text AS count FROM tenant_pipeline_items
      WHERE tenant_id = ${tenantId} AND is_pinned = true
    `;
    pinnedCount = parseInt(pinRow?.count ?? '0', 10);
  } catch (e) {
    console.error('[dashboard] pinned count query failed', e);
  }

  // ---------- Recent activity ----------
  interface EventRow {
    id: string;
    namespace: string;
    type: string;
    phase: string;
    createdAt: string;
    payload: Record<string, unknown>;
  }

  let recentEvents: EventRow[] = [];
  try {
    recentEvents = await sql<EventRow[]>`
      SELECT id, namespace, type, phase, created_at, payload
      FROM system_events
      WHERE tenant_id = ${tenantId}
      ORDER BY created_at DESC
      LIMIT 10
    `;
  } catch (e) {
    console.error('[dashboard] events query failed', e);
  }

  return (
    <div>
      <h1 className="text-2xl font-bold">Welcome, {companyName}</h1>
      <p className="text-gray-500 mt-1 text-sm">
        Your GovWin portal dashboard
      </p>

      {/* Quick stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-6">
        <StatCard label="Library Units" value={libraryCount} />
        <StatCard label="Active Proposals" value={proposalCount} />
        <StatCard label="Pinned Topics" value={pinnedCount} />
      </div>

      {/* Get Started checklist */}
      <div className="mt-8 bg-white border border-gray-200 rounded-lg p-6">
        <h2 className="text-lg font-semibold mb-4">Get Started</h2>
        <ul className="space-y-3 text-sm">
          <li className="flex items-start gap-2">
            <span className="text-gray-400 mt-0.5">&#9744;</span>
            <a
              href={`${basePath}/library/upload`}
              className="text-blue-600 hover:underline"
            >
              Upload company documents
            </a>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-gray-400 mt-0.5">&#9744;</span>
            <a
              href={`${basePath}/spotlights`}
              className="text-blue-600 hover:underline"
            >
              Review your Spotlight feed
            </a>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-gray-400 mt-0.5">&#9744;</span>
            <span className="text-gray-700">
              Purchase your first proposal portal
            </span>
          </li>
        </ul>
      </div>

      {/* Recent activity */}
      <div className="mt-8">
        <h2 className="text-lg font-semibold mb-4">Recent Activity</h2>
        {recentEvents.length === 0 ? (
          <p className="text-gray-400 text-sm">No recent activity yet.</p>
        ) : (
          <ul className="divide-y divide-gray-100 border border-gray-200 rounded-lg">
            {recentEvents.map((evt) => (
              <li key={evt.id} className="px-4 py-3 text-sm flex justify-between">
                <span className="text-gray-700">
                  {evt.namespace}.{evt.type}
                  <span className="ml-2 text-xs text-gray-400">{evt.phase}</span>
                </span>
                <span className="text-gray-400 text-xs">
                  {new Date(evt.createdAt).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <p className="text-sm text-gray-500">{label}</p>
      <p className="text-2xl font-bold mt-1">{value}</p>
    </div>
  );
}
