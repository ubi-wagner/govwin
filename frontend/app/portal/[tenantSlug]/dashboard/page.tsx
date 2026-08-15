import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess, enterTenant } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { describeEvent } from '@/lib/event-labels';
import { Cockpit } from '@/components/portal/cockpit';
import { listOpenTasksForActor } from '@/lib/tasks/tasks';

export const dynamic = 'force-dynamic';

/**
 * Customer landing — the permission-adaptive cockpit.
 *
 * Center = the company's active proposals (→ canvas), or the Get Started
 * checklist when there are none. Right = an IndicatorRail whose tiles adapt to
 * the user's grants (ToDos/Library always; Opportunities/Buckets only with the
 * BD grant — which a descended shadow admin also carries).
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

  const sessionUser = session.user as { id?: string; name?: string | null; role?: unknown; tenantId?: string | null };
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
  enterTenant(tenantId);
  if (!hasRoleAtLeast(role, 'tenant_user')) {
    redirect(`/portal/${tenantSlug}/proposals`);
  }

  const companyName = (tenant.name as string) ?? tenantSlug;
  const basePath = `/portal/${tenantSlug}`;

  // ── Trial expiration ──
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

  // ── Counts + onboarding signals ──
  const count = async (label: string, q: Promise<{ count: string }[]>): Promise<number> => {
    try { const [r] = await q; return parseInt(r?.count ?? '0', 10); }
    catch (e) { console.error(`[dashboard] ${label} count failed`, e); return 0; }
  };
  const libraryCount = await count('library', sql`SELECT COUNT(*)::text AS count FROM library_atoms WHERE tenant_id = ${tenantId} AND archived_at IS NULL`);
  const proposalCount = await count('proposal', sql`SELECT COUNT(*)::text AS count FROM proposals WHERE tenant_id = ${tenantId} AND stage NOT IN ('archived','submitted')`);
  const oppsCount = await count('opps', sql`SELECT COUNT(*)::text AS count FROM tenant_opportunity_cards WHERE tenant_id = ${tenantId} AND lifecycle_status <> 'archived' AND archived_at IS NULL`);
  // Count what the actor can actually SEE in the drawer (same query the ToDo queue uses), so the
  // badge never disagrees with the drawer — for a tenant_user (hierarchical) or a descended
  // shadow-admin (admin + this tenant's ToDos) alike. (HITL G2.)
  const todosCount = await (async () => {
    try { return (await listOpenTasksForActor({ id: sessionUser.id!, role, tenantId })).length; }
    catch (e) { console.error('[dashboard] todos count failed', e); return 0; }
  })();
  const bucketsCount = await count('buckets', sql`SELECT COUNT(*)::text AS count FROM tenant_spotlight_buckets WHERE tenant_id = ${tenantId} AND is_active`);
  const hasProfile = (await count('profile', sql`SELECT COUNT(*)::text AS count FROM tenant_profiles WHERE tenant_id = ${tenantId}`)) > 0;

  // ── Accessible active proposals (the cockpit center) ──
  let proposals: { id: string; title: string; stage: string; isLocked: boolean }[] = [];
  try {
    proposals = await sql<{ id: string; title: string; stage: string; isLocked: boolean }[]>`
      SELECT id, title, stage, is_locked FROM proposals
      WHERE tenant_id = ${tenantId} AND stage <> 'archived'
      ORDER BY updated_at DESC LIMIT 6
    `;
  } catch (e) {
    console.error('[dashboard] proposals query failed', e);
  }

  // ── In-flight purchases (curation/guardrails pending, no proposal yet) — the dashboard used to
  //    go blank on these, so a returning customer had no sign their purchase worked. Surface them. ──
  let pendingBuilds: { id: string; label: string; opportunityId: string; status: string; curationDueAt: string | null }[] = [];
  try {
    pendingBuilds = await sql<{ id: string; label: string; opportunityId: string; status: string; curationDueAt: string | null }[]>`
      SELECT id, label, opportunity_id, status, curation_due_at::text AS curation_due_at
      FROM proposal_portals
      WHERE tenant_id = ${tenantId} AND proposal_id IS NULL
        AND status IN ('curation_pending', 'guardrails_pending')
      ORDER BY created_at DESC LIMIT 4
    `;
  } catch (e) {
    console.error('[dashboard] pending portals query failed', e);
  }

  // ── Recent activity ──
  interface EventRow { id: string; namespace: string; type: string; phase: string; createdAt: string; payload: Record<string, unknown> }
  let recentEvents: EventRow[] = [];
  try {
    recentEvents = await sql<EventRow[]>`
      SELECT id, namespace, type, phase, created_at, payload
      FROM system_events WHERE tenant_id = ${tenantId}
      ORDER BY created_at DESC LIMIT 10
    `;
  } catch (e) {
    console.error('[dashboard] events query failed', e);
  }
  const activity = recentEvents.map((evt) => ({
    id: evt.id,
    label: describeEvent({ namespace: evt.namespace, type: evt.type, phase: evt.phase, payload: evt.payload }),
    at: new Date(evt.createdAt).toLocaleString(),
  }));

  // OPP visibility + BD actions (pin/purchase) are delegated authority. Proxy on
  // tenant_admin for now; per-user grant is the intended seam. A descended shadow
  // admin is tenant_admin-in-session, so it inherits the OPP indicators.
  const canSeeOpps = hasRoleAtLeast(role, 'tenant_admin');
  const grants = { canSeeOpps, canManageBuckets: canSeeOpps };

  const docsChecked = libraryCount > 0;
  // The "get rolling" checklist points at admin surfaces (/cards redirects a base user,
  // profile is read-only, only an admin starts a build). Show it only to those who can act
  // on it; a base team member with nothing assigned gets an honest "waiting for access"
  // card instead of a redirect-trap that never says "ask your admin".
  const canAct = hasRoleAtLeast(role, 'tenant_admin');
  // Step 4 is adaptive: a build STARTS at /cards (pin → purchase), NOT /proposals — which is empty
  // until you've purchased, so the old link dead-ended at "go buy." A pending purchase is its own
  // in-progress state (track it on the Builds tab); a live build means the step is done.
  const step4 = proposalCount > 0
    ? { icon: '☑', tone: 'done' as const, href: `${basePath}/proposals`, label: 'Continue your proposal build' }
    : pendingBuilds.length > 0
      ? { icon: '◐', tone: 'pending' as const, href: `${basePath}/portals`, label: 'Your build is being prepared — track it' }
      : { icon: '☐', tone: 'todo' as const, href: `${basePath}/cards`, label: 'Find an opportunity and start a build' };
  const step4IconCls = step4.tone === 'done' ? 'text-emerald-500' : step4.tone === 'pending' ? 'text-amber-500' : 'text-gray-400';
  const step4LinkCls = step4.tone === 'done' ? 'text-gray-500 line-through' : step4.tone === 'pending' ? 'text-amber-700 hover:underline font-medium' : 'text-blue-600 hover:underline';
  const getStarted = canAct ? (
    <div className="bg-white border border-gray-200 rounded-lg p-6 max-w-xl">
      {/* First-run orientation: the buy → curate → build → submit model, so the checklist has context. */}
      <div className="mb-4 rounded-lg bg-indigo-50 border border-indigo-100 p-3">
        <p className="text-xs font-semibold text-indigo-900 mb-1">How it works</p>
        <ol className="text-xs text-indigo-800/90 space-y-0.5 list-decimal list-inside">
          <li>Find a matching opportunity in your feed</li>
          <li>Purchase a build for it</li>
          <li>Our RFP expert prepares your compliance shell (~72h)</li>
          <li>You draft with your library + AI, then submit</li>
        </ol>
      </div>
      <h2 className="text-lg font-semibold mb-1">Get started</h2>
      <p className="text-sm text-gray-500 mb-4">You don&apos;t have an active build yet. A few steps to get rolling:</p>
      <ul className="space-y-3 text-sm">
        <li className="flex items-start gap-2">
          <span className={`mt-0.5 ${docsChecked ? 'text-emerald-500' : 'text-gray-400'}`}>{docsChecked ? '☑' : '☐'}</span>
          <a href={`${basePath}/atoms`} className={docsChecked ? 'text-gray-500 line-through' : 'text-blue-600 hover:underline'}>Upload company documents</a>
        </li>
        <li className="flex items-start gap-2">
          <span className={`mt-0.5 ${hasProfile ? 'text-emerald-500' : 'text-gray-400'}`}>{hasProfile ? '☑' : '☐'}</span>
          <a href={`${basePath}/profile`} className={hasProfile ? 'text-gray-500 line-through' : 'text-blue-600 hover:underline'}>Set up your company profile</a>
        </li>
        <li className="flex items-start gap-2">
          <span className={`mt-0.5 ${oppsCount > 0 ? 'text-emerald-500' : 'text-gray-400'}`}>{oppsCount > 0 ? '☑' : '☐'}</span>
          <a href={`${basePath}/cards`} className={oppsCount > 0 ? 'text-gray-500 line-through' : 'text-blue-600 hover:underline'}>Review your matched opportunities</a>
        </li>
        <li className="flex items-start gap-2">
          <span className={`mt-0.5 ${step4IconCls}`}>{step4.icon}</span>
          <a href={step4.href} className={step4LinkCls}>{step4.label}</a>
        </li>
      </ul>
    </div>
  ) : (
    <div className="bg-white border border-gray-200 rounded-lg p-6 max-w-xl">
      <h2 className="text-lg font-semibold mb-1">You&apos;re on the team</h2>
      <p className="text-sm text-gray-500 mb-3">
        Nothing is assigned to you yet. Your company admin grants access to specific proposals —
        as soon as they add you to a build, it shows up right here.
      </p>
      <p className="text-sm text-gray-500">
        In the meantime, check your <a href={`${basePath}/processes`} className="text-blue-600 hover:underline">to-dos</a>.
        If you were expecting access to a proposal, ask your admin to add you.
      </p>
    </div>
  );

  return (
    <>
      {showTrialBanner && (
        <div className={`mb-6 rounded-lg px-4 py-3 text-sm font-medium ${
          trialDaysRemaining! <= 7
            ? 'bg-red-50 text-red-700 border border-red-200'
            : 'bg-yellow-50 text-yellow-700 border border-yellow-200'
        }`}>
          Your trial expires in {trialDaysRemaining} day{trialDaysRemaining !== 1 ? 's' : ''}.
          <a href={`${basePath}/billing`} className="ml-2 underline font-semibold">Subscribe to keep your data.</a>
        </div>
      )}
      <Cockpit
        tenantSlug={tenantSlug}
        companyName={companyName}
        userName={sessionUser.name ?? undefined}
        basePath={basePath}
        role={role}
        grants={grants}
        proposals={proposals}
        pendingBuilds={pendingBuilds}
        counts={{ opps: oppsCount, todos: todosCount, buckets: bucketsCount, library: libraryCount }}
        activity={activity}
        getStarted={getStarted}
      />
    </>
  );
}
