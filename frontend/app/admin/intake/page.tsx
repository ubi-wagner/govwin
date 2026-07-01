import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import type { Role } from '@/lib/rbac';
import IntakeForm from '@/components/admin/intake-form';

export const dynamic = 'force-dynamic';

/** Admin intake — stage a found/uploaded opportunity notice into the review queue (mig 099). */
export default async function IntakePage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  const role = (session.user as { role?: Role }).role;
  if (role !== 'master_admin' && role !== 'rfp_admin') redirect('/admin/dashboard');

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold mb-1">Stage Opportunity Intake</h1>
      <p className="text-gray-500 text-sm mb-6">
        Stage a found/uploaded notice into the review queue (status <code>new</code>, not yet live). Scout will call this
        same entry later; for now, capture what you have. Then curate it in{' '}
        <a href="/admin/rfp-curation" className="text-blue-600 hover:underline">RFP Curation</a> and release.
      </p>
      <IntakeForm />
    </div>
  );
}
