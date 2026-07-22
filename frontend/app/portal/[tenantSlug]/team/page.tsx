import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import Link from 'next/link';
import { TeamInviteForm } from '@/components/portal/team-invite-form';
import { TeamMemberActions } from '@/components/portal/team-member-actions';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ tenantSlug: string }>;
}

const ROLE_BADGES: Record<string, { label: string; color: string }> = {
  tenant_admin: { label: 'Admin', color: 'bg-indigo-100 text-indigo-700' },
  tenant_user: { label: 'Contributor', color: 'bg-blue-100 text-blue-700' },
  partner_user: { label: 'External', color: 'bg-amber-100 text-amber-700' },
  master_admin: { label: 'System Admin', color: 'bg-red-100 text-red-700' },
  rfp_admin: { label: 'RFP Admin', color: 'bg-purple-100 text-purple-700' },
};

export default async function TeamPage({ params }: Props) {
  const { tenantSlug } = await params;

  const session = await auth();
  if (!session?.user) redirect('/login');

  const sessionUser = session.user as {
    id?: string;
    role?: unknown;
    tenantId?: string | null;
  };
  const role: Role | null = isRole(sessionUser.role) ? sessionUser.role : null;
  if (!role || !sessionUser.id) redirect('/login?error=session');

  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) redirect('/portal');

  const tenantId = tenant.id as string;
  const hasAccess = await verifyTenantAccess(sessionUser.id, role, tenantId);
  if (!hasAccess) redirect('/portal');

  if (!hasRoleAtLeast(role, 'tenant_user')) {
    redirect(`/portal/${tenantSlug}/proposals`);
  }

  // ── Team members ──────────────────────────────────────────────────
  interface TeamMember {
    id: string;
    name: string | null;
    email: string;
    role: string;
    isActive: boolean;
    lastLoginAt: Date | null;
    createdAt: Date;
  }

  let members: TeamMember[] = [];
  try {
    // Team members are the tenant's home/manual memberships (employees). isActive comes
    // from the MEMBERSHIP status now, so a deactivated member still shows (badged), and
    // their access follows the membership (verifyTenantAccess is membership-based).
    members = await sql<TeamMember[]>`
      SELECT u.id, u.name, u.email, m.role, (m.status = 'active') AS is_active,
             u.last_login_at, u.created_at
      FROM user_memberships m
      JOIN users u ON u.id = m.user_id
      WHERE m.tenant_id = ${tenantId} AND m.source IN ('home', 'manual')
      ORDER BY
        CASE m.role WHEN 'tenant_admin' THEN 0 WHEN 'tenant_user' THEN 1 ELSE 2 END,
        u.created_at ASC
    `;
  } catch (e) {
    console.error('[portal/team] members query failed', e);
  }

  // ── Collaborators on active proposals ─────────────────────────────
  interface CollaboratorRow {
    id: string;
    email: string;
    name: string | null;
    collabRole: string;
    proposalTitle: string;
    proposalId: string;
    acceptedAt: Date | null;
  }

  let collaborators: CollaboratorRow[] = [];
  try {
    collaborators = await sql<CollaboratorRow[]>`
      SELECT
        pc.id,
        pc.email,
        pc.name,
        pc.role AS collab_role,
        p.title AS proposal_title,
        p.id AS proposal_id,
        pc.accepted_at
      FROM proposal_collaborators pc
      JOIN proposals p ON p.id = pc.proposal_id
      WHERE p.tenant_id = ${tenantId}
        AND p.stage NOT IN ('archived', 'submitted')
      ORDER BY pc.invited_at DESC
    `;
  } catch (e) {
    console.error('[portal/team] collaborators query failed', e);
  }

  const basePath = `/portal/${tenantSlug}`;
  const isAdmin = role === 'tenant_admin' || role === 'master_admin' || role === 'rfp_admin';
  // Guards the role control: the last active admin can't be demoted.
  const activeAdmins = members.filter((m) => m.isActive && m.role === 'tenant_admin').length;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Team</h1>
          <p className="text-sm text-gray-500 mt-1">
            {members.length} member{members.length !== 1 ? 's' : ''}
          </p>
        </div>
      </div>

      {/* Invite form (admin only) */}
      {isAdmin && (
        <div className="mb-8">
          <TeamInviteForm tenantSlug={tenantSlug} />
        </div>
      )}

      {/* Team Members */}
      <section className="mb-10">
        <h2 className="text-lg font-semibold mb-4">Team Members</h2>
        {members.length === 0 ? (
          <p className="text-sm text-gray-400 italic">No team members found.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Name</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Email</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Role</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Status</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Last Login</th>
                  {isAdmin && <th className="px-4 py-3 text-right font-medium text-gray-600">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {members.map((m) => {
                  const badge = ROLE_BADGES[m.role] ?? { label: m.role, color: 'bg-gray-100 text-gray-600' };
                  return (
                    <tr key={m.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-900">
                        {m.name ?? <span className="text-gray-400 italic">No name</span>}
                      </td>
                      <td className="px-4 py-3 text-gray-600">{m.email}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${badge.color}`}>
                          {badge.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                          m.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                        }`}>
                          {m.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs">
                        {m.lastLoginAt
                          ? new Date(m.lastLoginAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                          : 'Never'}
                      </td>
                      {isAdmin && (
                        <td className="px-4 py-3 text-right">
                          {m.id !== sessionUser.id && (
                            <TeamMemberActions
                              tenantSlug={tenantSlug}
                              userId={m.id}
                              active={m.isActive}
                              role={m.role}
                              isLastAdmin={m.role === 'tenant_admin' && activeAdmins <= 1}
                            />
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Proposal Collaborators */}
      <section>
        <h2 className="text-lg font-semibold mb-4">Proposal Collaborators</h2>
        {collaborators.length === 0 ? (
          <p className="text-sm text-gray-400 italic">No external collaborators on active proposals.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Name</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Email</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Role</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Proposal</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {collaborators.map((c) => (
                  <tr key={c.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">
                      {c.name ?? <span className="text-gray-400 italic">No name</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{c.email}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-amber-100 text-amber-700">
                        {c.collabRole}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`${basePath}/proposals/${c.proposalId}`}
                        className="text-blue-600 hover:underline text-xs"
                      >
                        {c.proposalTitle}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                        c.acceptedAt ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
                      }`}>
                        {c.acceptedAt ? 'Accepted' : 'Pending'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
