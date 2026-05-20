import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { sql } from '@/lib/db';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

const STAGE_STYLES: Record<string, string> = {
  lead: 'bg-yellow-100 text-yellow-700',
  target: 'bg-blue-100 text-blue-700',
  customer: 'bg-green-100 text-green-700',
  at_risk: 'bg-orange-100 text-orange-700',
  churned: 'bg-red-100 text-red-700',
};

const STATUS_STYLES: Record<string, string> = {
  active: 'bg-green-100 text-green-700',
  trial: 'bg-blue-100 text-blue-700',
  suspended: 'bg-red-100 text-red-700',
  pending: 'bg-yellow-100 text-yellow-700',
};

function formatDate(d: Date | null): string {
  if (!d) return '-';
  return new Date(d).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

interface LeadRow {
  id: string;
  name: string;
  lifecycleStage: string | null;
  subscriptionStatus: string | null;
  status: string;
  createdAt: Date;
  contactEmail: string | null;
  contactName: string | null;
  applicationStatus: string | null;
  appliedAt: Date | null;
}

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ stage?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const role = (session.user as { role?: string }).role;
  if (role !== 'master_admin' && role !== 'rfp_admin') redirect('/admin');

  const params = await searchParams;
  const stageFilter = params.stage ?? 'all';
  const validStages = ['all', 'lead', 'target', 'customer', 'at_risk', 'churned'];
  const activeStage = validStages.includes(stageFilter) ? stageFilter : 'all';

  let leads: LeadRow[] = [];
  try {
    if (activeStage === 'all') {
      leads = await sql<LeadRow[]>`
        SELECT t.id, t.name, t.lifecycle_stage, t.subscription_status, t.status, t.created_at,
               u.email AS contact_email, u.name AS contact_name,
               a.status AS application_status, a.created_at AS applied_at
        FROM tenants t
        LEFT JOIN users u ON u.tenant_id = t.id AND u.role = 'tenant_admin'
        LEFT JOIN applications a ON a.company_name = t.name
        ORDER BY t.created_at DESC
        LIMIT 100
      `;
    } else {
      leads = await sql<LeadRow[]>`
        SELECT t.id, t.name, t.lifecycle_stage, t.subscription_status, t.status, t.created_at,
               u.email AS contact_email, u.name AS contact_name,
               a.status AS application_status, a.created_at AS applied_at
        FROM tenants t
        LEFT JOIN users u ON u.tenant_id = t.id AND u.role = 'tenant_admin'
        LEFT JOIN applications a ON a.company_name = t.name
        WHERE t.lifecycle_stage = ${activeStage}
        ORDER BY t.created_at DESC
        LIMIT 100
      `;
    }
  } catch (e) {
    console.error('[admin/crm/leads] query failed:', e);
  }

  const tabs = [
    { label: 'All', value: 'all' },
    { label: 'Leads', value: 'lead' },
    { label: 'Targets', value: 'target' },
    { label: 'Customers', value: 'customer' },
    { label: 'At Risk', value: 'at_risk' },
    { label: 'Churned', value: 'churned' },
  ];

  return (
    <div className="max-w-6xl mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl font-bold">Lead Pipeline</h1>
        <p className="text-sm text-gray-500 mt-1">
          {leads.length} leads found
        </p>
      </header>

      {/* Filter tabs */}
      <div className="flex gap-1 mb-6 border-b border-gray-200">
        {tabs.map((tab) => (
          <Link
            key={tab.value}
            href={`/admin/crm/leads${tab.value === 'all' ? '' : `?stage=${tab.value}`}`}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
              activeStage === tab.value
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </div>

      {leads.length === 0 ? (
        <p className="text-sm text-gray-400 py-4">No leads found for this filter.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Company</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Contact</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Stage</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Status</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Applied</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {leads.map((lead) => (
                <tr key={lead.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/tenants/${lead.id}`}
                      className="font-medium text-blue-600 hover:underline"
                    >
                      {lead.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    <div>{lead.contactName ?? '-'}</div>
                    {lead.contactEmail && (
                      <div className="text-xs text-gray-400">{lead.contactEmail}</div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STAGE_STYLES[lead.lifecycleStage ?? ''] ?? 'bg-gray-100 text-gray-600'}`}>
                      {lead.lifecycleStage?.replace('_', ' ') ?? 'unknown'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[lead.status] ?? 'bg-gray-100 text-gray-600'}`}>
                      {lead.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                    {formatDate(lead.appliedAt)}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                    {formatDate(lead.createdAt)}
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
