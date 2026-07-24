import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { AtomsWorkbench } from '@/components/portal/atoms-workbench';
import { TemplifyPastProposals } from '@/components/portal/templify-past-proposals';
import { CreateCanvasButton } from '@/components/portal/create-canvas-button';

export const dynamic = 'force-dynamic';

/** Library atoms — hand-shred docs into tagged, sized atoms; browse/compose the library (mig 101/102). */
export default async function AtomsPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
  const { tenantSlug } = await params;
  const session = await auth();
  if (!session?.user) redirect('/login');
  const su = session.user as { id?: string; role?: unknown };
  const role: Role | null = isRole(su.role) ? su.role : null;
  if (!role || !su.id) redirect('/login?error=session');
  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) redirect('/portal');
  if (!(await verifyTenantAccess(su.id, role, tenant.id as string))) redirect('/portal');
  if (!hasRoleAtLeast(role, 'tenant_user')) redirect(`/portal/${tenantSlug}/proposals`);

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Library Atoms</h1>
          <p className="text-gray-500 mt-1 text-sm">
            Shred your own documents by hand — deconstruct into objects, keep only the content you like, tag it
            against the one taxonomy, and it&apos;s sized to drop into section molds. Primitives (a bio, a figure)
            combine into groups (a Team) with lineage back to their source. Or <strong>create a canvas</strong> from
            scratch — a foundation artifact that decomposes into those same atoms.
          </p>
        </div>
        <div className="shrink-0 pt-1">
          <CreateCanvasButton tenantSlug={tenantSlug} />
        </div>
      </div>
      <div className="mb-6">
        <TemplifyPastProposals tenantSlug={tenantSlug} />
      </div>
      <AtomsWorkbench tenantSlug={tenantSlug} />
    </div>
  );
}
