import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { ExpertTimeWidget } from '@/components/portal/expert-time-widget';

export const dynamic = 'force-dynamic';

/**
 * Tenant Expert-Time booking page (Terms §7). Server-gates to a verified member of
 * this tenant, then hands off to the client widget (which talks to the API). The API
 * re-gates every call, so the widget is safe; this gate just avoids an unauth flash.
 */
export default async function ExpertTimePage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;

  const session = await auth();
  if (!session?.user) redirect('/login');
  const u = session.user as { id?: string; role?: unknown };
  const role: Role | null = isRole(u.role) ? u.role : null;
  if (!role || !u.id) redirect('/login?error=session');
  if (!hasRoleAtLeast(role, 'tenant_user')) redirect('/portal');

  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) redirect('/portal');
  if (!(await verifyTenantAccess(u.id, role, tenant.id as string))) redirect('/portal');

  return (
    <div className="max-w-3xl mx-auto py-8 px-4">
      <ExpertTimeWidget tenantSlug={tenantSlug} />
    </div>
  );
}
