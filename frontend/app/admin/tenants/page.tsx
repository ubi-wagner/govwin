import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { sql } from '@/lib/db';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

type TenantRow = {
  id: string;
  name: string;
  slug: string;
  status: string;
  createdAt: Date;
  userCount: number;
  libraryCount: number;
  proposalCount: number;
};

function statusBadge(status: string) {
  const styles: Record<string, string> = {
    active: 'bg-green-100 text-green-700',
    suspended: 'bg-yellow-100 text-yellow-700',
    inactive: 'bg-gray-100 text-gray-500',
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${styles[status] ?? 'bg-gray-100 text-gray-600'}`}
    >
      {status}
    </span>
  );
}

export default async function TenantsPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const role = (session.user as { role?: string }).role;
  if (role !== 'master_admin' && role !== 'rfp_admin') {
    redirect('/admin');
  }

  let tenants: TenantRow[] = [];
  let queryError: string | null = null;

  try {
    tenants = await sql<TenantRow[]>`
      SELECT t.id, t.name, t.slug, t.status, t.created_at,
             (SELECT COUNT(*) FROM users u WHERE u.tenant_id = t.id) as user_count,
             (SELECT COUNT(*) FROM library_units lu WHERE lu.tenant_id = t.id AND lu.status = 'approved') as library_count,
             (SELECT COUNT(*) FROM proposals p WHERE p.tenant_id = t.id) as proposal_count
      FROM tenants t
      ORDER BY t.created_at DESC
      LIMIT 50
    `;
  } catch (e) {
    console.error('[admin/tenants] query failed:', e);
    queryError = 'Could not load tenants. One or more tables may not exist yet.';
  }

  return (
    <div className="max-w-6xl mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl font-bold">Tenant Management</h1>
        <p className="text-sm text-gray-500 mt-1">
          {queryError
            ? 'Unable to load tenant data'
            : `${tenants.length} tenant${tenants.length !== 1 ? 's' : ''} registered`}
        </p>
      </header>

      {queryError ? (
        <p className="text-sm text-amber-600 italic">{queryError}</p>
      ) : tenants.length === 0 ? (
        <p className="text-sm text-gray-500 italic">No tenants found.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Company Name</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Slug</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Status</th>
                <th className="px-4 py-3 text-right font-medium text-gray-600">Users</th>
                <th className="px-4 py-3 text-right font-medium text-gray-600">Library Atoms</th>
                <th className="px-4 py-3 text-right font-medium text-gray-600">Proposals</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {tenants.map((t) => (
                <tr key={t.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/tenants/${t.id}`}
                      className="font-medium text-blue-600 hover:underline"
                    >
                      {t.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/portal/${t.slug}/dashboard`}
                      className="font-mono text-xs text-blue-600 hover:underline"
                    >
                      {t.slug}
                    </Link>
                  </td>
                  <td className="px-4 py-3">{statusBadge(t.status)}</td>
                  <td className="px-4 py-3 text-right text-gray-600">{Number(t.userCount)}</td>
                  <td className="px-4 py-3 text-right text-gray-600">{Number(t.libraryCount)}</td>
                  <td className="px-4 py-3 text-right text-gray-600">{Number(t.proposalCount)}</td>
                  <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                    {t.createdAt
                      ? new Date(t.createdAt).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })
                      : '—'}
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
