import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import type { Role } from '@/lib/rbac';
import GuardrailDefaults from '@/components/admin/guardrail-defaults';

export const dynamic = 'force-dynamic';

/** RFP-admin guardrail limits + defaults that bound every customer portal (mig 097/098). */
export default async function GuardrailDefaultsPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  const role = (session.user as { role?: Role }).role;
  if (role !== 'master_admin' && role !== 'rfp_admin') redirect('/admin/dashboard');

  return (
    <div className="max-w-xl">
      <h1 className="text-2xl font-bold mb-1">Guardrail Defaults</h1>
      <p className="text-gray-500 text-sm mb-6">The hard limits + defaults that bound every customer portal at launch. Changes apply to future launches; frozen configs are unaffected.</p>
      <GuardrailDefaults />
    </div>
  );
}
