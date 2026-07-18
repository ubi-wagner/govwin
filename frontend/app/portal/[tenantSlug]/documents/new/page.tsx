import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { NewDocumentChooser } from '@/components/portal/new-document-chooser';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ tenantSlug: string }>;
}

/**
 * "New document" quick-create + template browser (Tier 2, #3/#4). Start a
 * standalone document from a blank preset or from one of the tenant's own /
 * system `document_templates`, then open it in the canvas editor.
 */
export default async function NewDocumentPage({ params }: Props) {
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

  return <NewDocumentChooser tenantSlug={tenantSlug} />;
}
