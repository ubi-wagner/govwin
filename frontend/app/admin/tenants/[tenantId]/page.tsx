import { auth } from '@/auth';
import { redirect } from 'next/navigation';
// Admin cross-tenant console page — reads span tenants, so use the owner (BYPASSRLS) pool. (docs/RLS_CUTOVER.md)
import { sqlBypass as sql } from '@/lib/db';
import Link from 'next/link';
import { TenantAiConfigCard } from '@/components/admin/tenant-ai-config-card';
import { StatCard, type StatPreview } from '@/components/admin/stat-card';
import { TenantArchiveControl } from '@/components/admin/tenant-archive-control';
import { TenantDetailsEditor } from '@/components/admin/tenant-details-editor';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ tenantId: string }>;
}

function statusBadge(status: string) {
  const styles: Record<string, string> = {
    active: 'bg-green-100 text-green-700',
    suspended: 'bg-yellow-100 text-yellow-700',
    churned: 'bg-red-100 text-red-700',
    trial: 'bg-blue-100 text-blue-700',
    none: 'bg-gray-100 text-gray-500',
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${styles[status] ?? 'bg-gray-100 text-gray-600'}`}>
      {status}
    </span>
  );
}

export default async function TenantDetailPage({ params }: Props) {
  const { tenantId } = await params;

  const session = await auth();
  if (!session?.user) redirect('/login');

  const role = (session.user as { role?: string }).role;
  if (role !== 'master_admin' && role !== 'rfp_admin') redirect('/admin');

  // ── Load tenant ───────────────────────────────────────────────────
  interface TenantRow {
    id: string;
    name: string;
    slug: string;
    legalName: string | null;
    website: string | null;
    status: string;
    productTier: string;
    lifecycleStage: string | null;
    subscriptionStatus: string;
    billingEmail: string | null;
    stripeCustomerId: string | null;
    trialEndsAt: Date | null;
    createdAt: Date;
    archivedAt: Date | null;
  }

  let tenant: TenantRow | null = null;
  try {
    const [row] = await sql<TenantRow[]>`
      SELECT id, name, slug, legal_name, website, status, product_tier,
             lifecycle_stage,
             subscription_status, billing_email, stripe_customer_id,
             trial_ends_at, created_at, archived_at
      FROM tenants
      WHERE id = ${tenantId}
    `;
    tenant = row ?? null;
  } catch (e) {
    console.error('[admin/tenants/detail] tenant query failed', e);
  }

  if (!tenant) {
    return (
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold mb-4">Tenant Not Found</h1>
        <Link href="/admin/tenants" className="text-sm text-blue-600 hover:underline">Back to tenants</Link>
      </div>
    );
  }

  // ── Load users ────────────────────────────────────────────────────
  interface UserRow {
    id: string;
    name: string | null;
    email: string;
    role: string;
    isActive: boolean;
    lastLoginAt: Date | null;
    createdAt: Date;
  }

  let users: UserRow[] = [];
  try {
    users = await sql<UserRow[]>`
      SELECT id, name, email, role, is_active, last_login_at, created_at
      FROM users
      WHERE tenant_id = ${tenantId}
      ORDER BY created_at ASC
    `;
  } catch (e) {
    console.error('[admin/tenants/detail] users query failed', e);
  }

  // ── Counts ────────────────────────────────────────────────────────
  let proposalCount = 0;
  let libraryCount = 0;
  let purchaseTotal = 0;

  try {
    const [row] = await sql<{ count: string }[]>`
      SELECT COUNT(*)::text AS count FROM proposals WHERE tenant_id = ${tenantId}
    `;
    proposalCount = parseInt(row?.count ?? '0', 10);
  } catch (e) {
    console.error('[admin/tenants/detail] proposals count failed', e);
  }

  try {
    const [row] = await sql<{ count: string }[]>`
      SELECT COUNT(*)::text AS count FROM library_atoms WHERE tenant_id = ${tenantId}
    `;
    libraryCount = parseInt(row?.count ?? '0', 10);
  } catch (e) {
    console.error('[admin/tenants/detail] library count failed', e);
  }

  try {
    const [row] = await sql<{ total: string }[]>`
      SELECT COALESCE(SUM(amount_cents), 0)::text AS total FROM purchases WHERE tenant_id = ${tenantId} AND status = 'completed'
    `;
    purchaseTotal = parseInt(row?.total ?? '0', 10);
  } catch (e) {
    console.error('[admin/tenants/detail] purchase total failed', e);
  }

  // ── AI budget + limits (per-tenant override vs platform default) ──
  let aiBudget: number | null = null;
  let aiRate: number | null = null;
  let aiCeiling: number | null = null;
  let defaultBudget = 50;
  let defaultRate = 50;
  let defaultCeiling = 0.5;
  try {
    const [cfg] = await sql<{ monthlyBudget: string | null; rateLimitPerHour: number | null; perCallCeiling: string | null }[]>`
      SELECT monthly_budget, rate_limit_per_hour, per_call_ceiling
      FROM tenant_agent_config
      WHERE tenant_id = ${tenantId}
    `;
    aiBudget = cfg?.monthlyBudget != null ? parseFloat(cfg.monthlyBudget) : null;
    aiRate = cfg?.rateLimitPerHour ?? null;
    aiCeiling = cfg?.perCallCeiling != null ? parseFloat(cfg.perCallCeiling) : null;
    const [platform] = await sql<{ defaultMonthlyBudget: string | null; defaultRateLimitPerHour: number | null; defaultPerCallCeiling: string | null }[]>`
      SELECT default_monthly_budget, default_rate_limit_per_hour, default_per_call_ceiling
      FROM platform_agent_config
      WHERE id = TRUE
    `;
    if (platform?.defaultMonthlyBudget != null) defaultBudget = parseFloat(platform.defaultMonthlyBudget);
    if (platform?.defaultRateLimitPerHour != null) defaultRate = platform.defaultRateLimitPerHour;
    if (platform?.defaultPerCallCeiling != null) defaultCeiling = parseFloat(platform.defaultPerCallCeiling);
  } catch (e) {
    console.error('[admin/tenants/detail] agent config query failed', e);
  }

  // ── Recent events ─────────────────────────────────────────────────
  interface EventRow {
    id: string;
    namespace: string;
    type: string;
    phase: string;
    actorEmail: string | null;
    createdAt: Date;
  }

  let events: EventRow[] = [];
  try {
    events = await sql<EventRow[]>`
      SELECT id, namespace, type, phase, actor_email, created_at
      FROM system_events
      WHERE tenant_id = ${tenantId}
      ORDER BY created_at DESC
      LIMIT 20
    `;
  } catch (e) {
    console.error('[admin/tenants/detail] events query failed', e);
  }

  const usersPreview: StatPreview = {
    title: 'Users',
    items: users.slice(0, 6).map((u) => ({
      left: u.name ?? u.email,
      sub: u.name ? u.email : undefined,
      right: u.role,
    })),
    emptyText: 'No users',
  };

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <Link href="/admin/tenants" className="text-xs text-blue-600 hover:underline mb-2 inline-block">
            &larr; All Tenants
          </Link>
          <h1 className="text-2xl font-bold">{tenant.name}</h1>
          <p className="text-sm text-gray-500 mt-1 font-mono">{tenant.slug}</p>
        </div>
        <div className="flex items-center gap-3">
          {tenant.archivedAt && (
            <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-gray-200 text-gray-600">
              archived
            </span>
          )}
          {statusBadge(tenant.status)}
          {statusBadge(tenant.subscriptionStatus)}
          <TenantArchiveControl tenantId={tenant.id} archived={tenant.archivedAt != null} />
        </div>
      </div>

      {/* Info cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <StatCard label="Users" value={users.length} preview={usersPreview} />
        <StatCard label="Proposals" value={proposalCount} href="/admin/proposals" />
        <StatCard label="Library Atoms" value={libraryCount} href="/admin/analytics" />
        <StatCard label="Revenue" value={`$${(purchaseTotal / 100).toFixed(2)}`} href="/admin/billing" />
      </div>

      {/* Company details */}
      <div className="bg-white border border-gray-200 rounded-lg p-6 mb-8">
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 className="text-lg font-semibold">Company Details</h2>
          {/* The PATCH route has always accepted these fields; until now nothing called it, so an
              admin could see a customer's legal name was wrong and had no way to fix it. */}
          <TenantDetailsEditor
            tenantId={tenant.id}
            initial={{
              name: tenant.name,
              legalName: tenant.legalName,
              website: tenant.website,
              billingEmail: tenant.billingEmail,
              productTier: tenant.productTier,
              subscriptionStatus: tenant.subscriptionStatus,
              lifecycleStage: tenant.lifecycleStage,
              status: tenant.status,
            }}
          />
        </div>
        <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3 text-sm">
          <div>
            <dt className="text-gray-500">Legal Name</dt>
            <dd className="font-medium text-gray-900 mt-0.5">{tenant.legalName ?? '-'}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Website</dt>
            <dd className="font-medium text-gray-900 mt-0.5">
              {tenant.website ? (
                <a href={tenant.website} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                  {tenant.website}
                </a>
              ) : '-'}
            </dd>
          </div>
          <div>
            <dt className="text-gray-500">Billing Email</dt>
            <dd className="font-medium text-gray-900 mt-0.5">{tenant.billingEmail ?? '-'}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Product Tier</dt>
            <dd className="font-medium text-gray-900 mt-0.5 capitalize">{tenant.productTier}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Stripe Customer</dt>
            <dd className="font-mono text-xs text-gray-600 mt-0.5">{tenant.stripeCustomerId ?? '-'}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Trial Ends</dt>
            <dd className="font-medium text-gray-900 mt-0.5">
              {tenant.trialEndsAt ? new Date(tenant.trialEndsAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '-'}
            </dd>
          </div>
          <div>
            <dt className="text-gray-500">Created</dt>
            <dd className="font-medium text-gray-900 mt-0.5">
              {new Date(tenant.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </dd>
          </div>
          <div>
            <dt className="text-gray-500">Portal Link</dt>
            <dd className="mt-0.5">
              <Link href={`/portal/${tenant.slug}/dashboard`} className="text-blue-600 hover:underline text-xs">
                /portal/{tenant.slug}/dashboard
              </Link>
            </dd>
          </div>
        </dl>
      </div>

      {/* AI Budget & Limits */}
      <TenantAiConfigCard
        tenantId={tenant.id}
        initialMonthlyBudget={aiBudget}
        initialRateLimitPerHour={aiRate}
        initialPerCallCeiling={aiCeiling}
        defaultMonthlyBudget={defaultBudget}
        defaultRateLimitPerHour={defaultRate}
        defaultPerCallCeiling={defaultCeiling}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Users */}
        <div>
          <h2 className="text-lg font-semibold mb-4">Users ({users.length})</h2>
          {users.length === 0 ? (
            <p className="text-sm text-gray-400 italic">No users.</p>
          ) : (
            // `overflow-x-auto`: a clipped table has no scrollbar, so its right columns cannot be read.
            <div className="border border-gray-200 rounded-lg overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-gray-600">Name</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600">Role</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {users.map((u) => (
                    <tr key={u.id} className="hover:bg-gray-50">
                      <td className="px-3 py-2">
                        <div className="font-medium text-gray-900">{u.name ?? u.email}</div>
                        <div className="text-xs text-gray-400">{u.email}</div>
                      </td>
                      <td className="px-3 py-2">
                        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-700">
                          {u.role}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                          u.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                        }`}>
                          {u.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Recent events */}
        <div>
          <h2 className="text-lg font-semibold mb-4">Recent Activity</h2>
          {events.length === 0 ? (
            <p className="text-sm text-gray-400 italic">No events recorded.</p>
          ) : (
            <div className="border border-gray-200 rounded-lg overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-gray-600">Event</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600">Actor</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600">Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {events.map((ev) => (
                    <tr key={ev.id} className="hover:bg-gray-50">
                      <td className="px-3 py-2">
                        <span className="text-xs font-medium text-indigo-600">
                          {ev.namespace}.{ev.type}
                        </span>
                        <span className="ml-1 text-xs text-gray-400">{ev.phase}</span>
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-600">{ev.actorEmail ?? '-'}</td>
                      <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap">
                        {new Date(ev.createdAt).toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'short' })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
