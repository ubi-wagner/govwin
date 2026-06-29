import { redirect } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { AgentUsagePanel } from '@/components/portal/agent-usage-panel';
import { TaskQueue } from '@/components/tasks/task-queue';
import { describeEvent } from '@/lib/event-labels';

export const dynamic = 'force-dynamic';

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

  const companyName = (tenant.name as string) ?? tenantSlug;
  const basePath = `/portal/${tenantSlug}`;

  // ── Trial expiration check ──
  let trialEndsAt: Date | null = null;
  try {
    const [tenantRow] = await sql<{ trialEndsAt: Date | null }[]>`
      SELECT trial_ends_at FROM tenants WHERE id = ${tenantId}
    `;
    trialEndsAt = tenantRow?.trialEndsAt ?? null;
  } catch (e) {
    console.error('[dashboard] trial check failed', e);
  }

  const trialDaysRemaining = trialEndsAt
    ? Math.ceil((new Date(trialEndsAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : null;
  const showTrialBanner = trialDaysRemaining !== null && trialDaysRemaining > 0;

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

  // ── Onboarding checklist data ──
  let hasProfile = false;
  let spotlightCount = 0;
  try {
    const [profileRow] = await sql<{ count: string }[]>`
      SELECT COUNT(*)::text AS count FROM tenant_profiles WHERE tenant_id = ${tenantId}
    `;
    hasProfile = parseInt(profileRow?.count ?? '0', 10) > 0;
  } catch (e) {
    console.error('[dashboard] profile check failed', e);
  }
  try {
    const [spotRow] = await sql<{ count: string }[]>`
      SELECT COUNT(*)::text AS count FROM tenant_pipeline_items WHERE tenant_id = ${tenantId}
    `;
    spotlightCount = parseInt(spotRow?.count ?? '0', 10);
  } catch (e) {
    console.error('[dashboard] spotlight check failed', e);
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

  const docsChecked = libraryCount > 0;
  const profileChecked = hasProfile;
  const spotlightChecked = spotlightCount > 0;

  return (
    <div>
      {/* Trial expiration banner */}
      {showTrialBanner && (
        <div className={`mb-6 rounded-lg px-4 py-3 text-sm font-medium ${
          trialDaysRemaining! <= 7
            ? 'bg-red-50 text-red-700 border border-red-200'
            : 'bg-yellow-50 text-yellow-700 border border-yellow-200'
        }`}>
          Your trial expires in {trialDaysRemaining} day{trialDaysRemaining !== 1 ? 's' : ''}.
          <a href={`${basePath}/billing`} className="ml-2 underline font-semibold">
            Subscribe to keep your data.
          </a>
        </div>
      )}

      <h1 className="text-2xl font-bold">Welcome, {companyName}</h1>
      <p className="text-gray-500 mt-1 text-sm">
        Your GovWin portal dashboard
      </p>

      {/* Quick stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-6">
        <Link href={`/portal/${tenantSlug}/library`}><StatCard label="Library Units" value={libraryCount} /></Link>
        <Link href={`/portal/${tenantSlug}/proposals`}><StatCard label="Active Proposals" value={proposalCount} /></Link>
        <Link href={`/portal/${tenantSlug}/pipeline`}><StatCard label="Pinned Topics" value={pinnedCount} /></Link>
      </div>

      {/* To-Do queue + in-app deadline nudges (reads the unified tasks ledger) */}
      <div className="mt-6">
        <TaskQueue apiBase={`/api/portal/${tenantSlug}/tasks`} tenantSlug={tenantSlug} />
      </div>

      {/* Get Started checklist */}
      <div className="mt-8 bg-white border border-gray-200 rounded-lg p-6">
        <h2 className="text-lg font-semibold mb-4">Get Started</h2>
        <ul className="space-y-3 text-sm">
          <li className="flex items-start gap-2">
            <span className={`mt-0.5 ${docsChecked ? 'text-emerald-500' : 'text-gray-400'}`}>
              {docsChecked ? '☑' : '☐'}
            </span>
            <a
              href={`${basePath}/library/upload`}
              className={docsChecked ? 'text-gray-500 line-through' : 'text-blue-600 hover:underline'}
            >
              Upload company documents
            </a>
          </li>
          <li className="flex items-start gap-2">
            <span className={`mt-0.5 ${profileChecked ? 'text-emerald-500' : 'text-gray-400'}`}>
              {profileChecked ? '☑' : '☐'}
            </span>
            <a
              href={`${basePath}/profile`}
              className={profileChecked ? 'text-gray-500 line-through' : 'text-blue-600 hover:underline'}
            >
              Set up your company profile
            </a>
          </li>
          <li className="flex items-start gap-2">
            <span className={`mt-0.5 ${spotlightChecked ? 'text-emerald-500' : 'text-gray-400'}`}>
              {spotlightChecked ? '☑' : '☐'}
            </span>
            <a
              href={`${basePath}/spotlights`}
              className={spotlightChecked ? 'text-gray-500 line-through' : 'text-blue-600 hover:underline'}
            >
              Create your first Spotlight
            </a>
          </li>
          <li className="flex items-start gap-2">
            <span className={`mt-0.5 ${proposalCount > 0 ? 'text-emerald-500' : 'text-gray-400'}`}>
              {proposalCount > 0 ? '☑' : '☐'}
            </span>
            <a
              href={`${basePath}/proposals`}
              className={proposalCount > 0 ? 'text-gray-500 line-through' : 'text-blue-600 hover:underline'}
            >
              Purchase your first proposal portal
            </a>
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
                  {describeEvent({ namespace: evt.namespace, type: evt.type, phase: evt.phase, payload: evt.payload })}
                </span>
                <span className="text-gray-400 text-xs">
                  {new Date(evt.createdAt).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {/* Agent Usage (admin only) */}
      {(role === 'tenant_admin' || role === 'master_admin' || role === 'rfp_admin') && (
        <div className="mt-8">
          <AgentUsagePanel tenantSlug={tenantSlug} />
        </div>
      )}
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
