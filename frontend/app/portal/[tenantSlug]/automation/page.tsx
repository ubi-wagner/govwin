import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { AutomationPreferencesCard } from '@/components/portal/automation-preferences-card';

export const dynamic = 'force-dynamic';

/**
 * Portal "Automation" — the customer admin's automation setup (configured at
 * portal purchase, editable later). tenant_admin+ only; the layout already
 * verified tenant access.
 */
export default async function PortalAutomationPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;

  const session = await auth();
  if (!session?.user) redirect('/login');

  const sessionUser = session.user as { id?: string; role?: unknown };
  const role: Role | null = isRole(sessionUser.role) ? sessionUser.role : null;
  if (!role || !sessionUser.id) redirect('/login?error=session');
  if (!hasRoleAtLeast(role, 'tenant_admin')) {
    redirect(`/portal/${tenantSlug}/dashboard`);
  }

  return (
    <div className="max-w-3xl mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl font-bold">Automation</h1>
        <p className="text-sm text-gray-500 mt-1">
          Choose what runs automatically as your proposals move through the pipeline.
          You can change these anytime.
        </p>
      </header>
      <AutomationPreferencesCard tenantSlug={tenantSlug} />
    </div>
  );
}
