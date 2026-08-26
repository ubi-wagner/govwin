import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { getTenantBySlug, verifyTenantAccess, enterTenant } from '@/lib/db';
import { isRole, type Role } from '@/lib/rbac';
import { listProjectsForActor, deliveryScope, canAssign } from '@/lib/delivery/access';

export const dynamic = 'force-dynamic';

/**
 * Delivery — the contracts this tenant is executing.
 *
 * ── THE LIST IS SCOPED BY ASSIGNMENT, NOT JUST BY TENANT ─────────────────────────────────────
 * `listProjectsForActor` is the whole access boundary: a tenant_admin sees the company's projects,
 * an employee sees exactly the ones they are assigned. RLS cannot express that second half — the
 * per-request context carries a tenant, not a user — so it lives in one predicate with its own
 * boundary test (`__tests__/delivery-assignment-boundary.test.ts`).
 *
 * A `partner_user` never reaches here at all: `deliveryScope` refuses the role, and the nav does not
 * render the link. Delivery v1 has no collaborator surface, which is what removes cross-tenant from
 * this capability entirely.
 */
export default async function DeliveryPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const session = await auth();
  if (!session?.user) redirect('/login');
  const su = session.user as { id?: string; role?: unknown };
  const role: Role | null = isRole(su.role) ? su.role : null;
  if (!role || !su.id) redirect('/login?error=session');
  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) redirect('/portal');
  const tenantId = tenant.id as string;
  if (!(await verifyTenantAccess(su.id, role, tenantId))) redirect('/portal');

  const scope = deliveryScope({ role, userId: su.id });
  if (scope.kind === 'none') redirect(`/portal/${tenantSlug}/dashboard`);

  // RLS choke point: pin tenant context in THIS frame before the read below.
  enterTenant(tenantId);

  const actor = { userId: su.id, role, tenantId };
  const projects = await listProjectsForActor(actor);
  const admin = canAssign(role);

  return (
    <div className="p-6 md:p-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Delivery</h1>
          <p className="mt-1 text-sm text-gray-600">
            {admin
              ? 'Contracts this company is executing — CLINs, schedule and deliverables.'
              : 'The contracts you are assigned to.'}
          </p>
        </div>
      </div>

      {projects.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-8 text-center">
          <p className="text-sm font-medium text-gray-900">
            {admin ? 'No delivery workspaces yet' : 'You are not assigned to a delivery workspace'}
          </p>
          <p className="mx-auto mt-2 max-w-lg text-sm text-gray-600">
            {admin
              ? 'A workspace opens when a proposal is recorded as awarded — you will get a “Set up '
                + 'delivery workspace” task. It starts with two uploads: the executed contract and '
                + 'the proposal as submitted.'
              : 'A tenant admin assigns people to a workspace. Ask them to add you and it will '
                + 'appear here.'}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3 font-medium">Project</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Baseline</th>
                <th className="px-4 py-3 font-medium">Opened</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {projects.map((p) => (
                <tr key={p.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <Link
                      href={`/portal/${tenantSlug}/delivery/${p.id}`}
                      className="font-medium text-blue-700 hover:underline"
                    >
                      {p.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-gray-700">{p.status}</td>
                  <td className="px-4 py-3 text-gray-700">
                    {p.baselinedAt
                      ? new Date(p.baselinedAt).toLocaleDateString()
                      : <span className="text-amber-700">not baselined</span>}
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {new Date(p.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
