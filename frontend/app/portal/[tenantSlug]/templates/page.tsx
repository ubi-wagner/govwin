import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { TemplateStableGallery } from '@/components/portal/template-stable-gallery';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ tenantSlug: string }>;
}

/**
 * Templates — the tenant's OWNED pristine-template shelf (template bridge Phase 2,
 * docs/TEMPLATE_BRIDGE_DESIGN.md). Cards mirror the opportunity-card gallery; each
 * is a skeleton the tenant owns (copied on creation via the bridge, mig 177).
 */
export default async function TemplatesPage({ params }: Props) {
  const { tenantSlug } = await params;

  const session = await auth();
  if (!session?.user) redirect('/login');
  const su = session.user as { id?: string; role?: unknown };
  const role: Role | null = isRole(su.role) ? su.role : null;
  if (!role || !su.id) redirect('/login?error=session');

  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) redirect('/portal');
  const tenantId = tenant.id as string;

  if (!hasRoleAtLeast(role, 'tenant_user')) redirect(`/portal/${tenantSlug}/proposals`);
  if (!(await verifyTenantAccess(su.id, role, tenantId))) redirect('/portal');

  return <TemplateStableGallery tenantSlug={tenantSlug} />;
}
