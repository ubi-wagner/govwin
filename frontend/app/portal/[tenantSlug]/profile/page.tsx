import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, type Role } from '@/lib/rbac';
import { ProfileEditor } from '@/components/portal/profile-editor';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ tenantSlug: string }>;
}

export default async function ProfilePage({ params }: Props) {
  const { tenantSlug } = await params;

  const session = await auth();
  if (!session?.user) redirect('/login');

  const sessionUser = session.user as {
    id?: string;
    email?: string;
    name?: string | null;
    role?: unknown;
    tenantId?: string | null;
  };
  const role: Role | null = isRole(sessionUser.role) ? sessionUser.role : null;
  if (!role || !sessionUser.id) redirect('/login?error=session');

  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) redirect('/login');

  const tenantId = tenant.id as string;
  const hasAccess = await verifyTenantAccess(sessionUser.id, role, tenantId);
  if (!hasAccess) redirect('/login');

  // ── Load full tenant info ─────────────────────────────────────────
  interface TenantInfo {
    id: string;
    name: string;
    legalName: string | null;
    website: string | null;
    billingEmail: string | null;
    status: string;
    productTier: string;
    subscriptionStatus: string;
    createdAt: Date;
  }

  let tenantInfo: TenantInfo | null = null;
  try {
    const [row] = await sql<TenantInfo[]>`
      SELECT id, name, legal_name, website, billing_email, status, product_tier,
             subscription_status, created_at
      FROM tenants
      WHERE id = ${tenantId}
    `;
    tenantInfo = row ?? null;
  } catch (e) {
    console.error('[portal/profile] tenant query failed', e);
  }

  // ── Load tenant profile (NAICS, keywords, etc.) ───────────────────
  interface TenantProfile {
    naicsCodes: string[];
    keywords: string[];
    agencyPriorities: string[];
    setAsideTypes: string[];
    technologyFocus: string | null;
    companySummary: string | null;
    researchAreas: string[];
    targetAgencies: string[];
  }

  let profile: TenantProfile | null = null;
  try {
    const [row] = await sql<TenantProfile[]>`
      SELECT naics_codes, keywords, agency_priorities, set_aside_types,
             technology_focus, company_summary, research_areas, target_agencies
      FROM tenant_profiles
      WHERE tenant_id = ${tenantId}
    `;
    profile = row ?? null;
  } catch (e) {
    console.error('[portal/profile] profile query failed', e);
  }

  // ── Load user info ────────────────────────────────────────────────
  interface UserInfo {
    id: string;
    name: string | null;
    email: string;
    role: string;
    lastLoginAt: Date | null;
  }

  let userInfo: UserInfo | null = null;
  try {
    const [row] = await sql<UserInfo[]>`
      SELECT id, name, email, role, last_login_at
      FROM users
      WHERE id = ${sessionUser.id}
    `;
    userInfo = row ?? null;
  } catch (e) {
    console.error('[portal/profile] user query failed', e);
  }

  const canEdit = role === 'tenant_admin' || role === 'master_admin' || role === 'rfp_admin';

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-sm text-gray-500 mt-1">
          Manage your company profile and account settings
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left column: User info */}
        <div>
          <div className="bg-white border border-gray-200 rounded-lg p-6">
            <h2 className="text-lg font-semibold mb-4">Your Account</h2>
            {userInfo ? (
              <dl className="space-y-3 text-sm">
                <div>
                  <dt className="text-gray-500">Name</dt>
                  <dd className="font-medium text-gray-900 mt-0.5">
                    {userInfo.name ?? <span className="text-gray-400 italic">Not set</span>}
                  </dd>
                </div>
                <div>
                  <dt className="text-gray-500">Email</dt>
                  <dd className="font-medium text-gray-900 mt-0.5">{userInfo.email}</dd>
                </div>
                <div>
                  <dt className="text-gray-500">Role</dt>
                  <dd className="mt-0.5">
                    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-700">
                      {userInfo.role.replace('_', ' ')}
                    </span>
                  </dd>
                </div>
                <div>
                  <dt className="text-gray-500">Last Login</dt>
                  <dd className="font-medium text-gray-900 mt-0.5 text-xs">
                    {userInfo.lastLoginAt
                      ? new Date(userInfo.lastLoginAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
                      : 'Never'}
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="text-sm text-gray-400 italic">Could not load user info.</p>
            )}
          </div>

          {/* Subscription info */}
          {tenantInfo && (
            <div className="bg-white border border-gray-200 rounded-lg p-6 mt-4">
              <h2 className="text-lg font-semibold mb-4">Subscription</h2>
              <dl className="space-y-3 text-sm">
                <div>
                  <dt className="text-gray-500">Plan</dt>
                  <dd className="font-medium text-gray-900 mt-0.5 capitalize">{tenantInfo.productTier}</dd>
                </div>
                <div>
                  <dt className="text-gray-500">Status</dt>
                  <dd className="mt-0.5">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                      tenantInfo.subscriptionStatus === 'active'
                        ? 'bg-green-100 text-green-700'
                        : tenantInfo.subscriptionStatus === 'past_due'
                          ? 'bg-red-100 text-red-700'
                          : 'bg-gray-100 text-gray-600'
                    }`}>
                      {tenantInfo.subscriptionStatus}
                    </span>
                  </dd>
                </div>
                <div>
                  <dt className="text-gray-500">Member Since</dt>
                  <dd className="font-medium text-gray-900 mt-0.5 text-xs">
                    {new Date(tenantInfo.createdAt).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                  </dd>
                </div>
              </dl>
            </div>
          )}
        </div>

        {/* Right column: Company profile */}
        <div className="lg:col-span-2">
          <ProfileEditor
            tenantSlug={tenantSlug}
            canEdit={canEdit}
            tenantInfo={tenantInfo ? {
              name: tenantInfo.name,
              legalName: tenantInfo.legalName,
              website: tenantInfo.website,
              billingEmail: tenantInfo.billingEmail,
            } : null}
            profile={profile ? {
              naicsCodes: profile.naicsCodes ?? [],
              keywords: profile.keywords ?? [],
              technologyFocus: profile.technologyFocus,
              companySummary: profile.companySummary,
              researchAreas: profile.researchAreas ?? [],
              targetAgencies: profile.targetAgencies ?? [],
              setAsideTypes: profile.setAsideTypes ?? [],
              agencyPriorities: profile.agencyPriorities ?? [],
            } : null}
          />
        </div>
      </div>
    </div>
  );
}
