import { sql } from '@/lib/db';
import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

type ProposalRow = {
  id: string;
  title: string;
  stage: string;
  createdAt: Date;
  updatedAt: Date;
  tenantName: string;
  tenantSlug: string;
  opportunityTitle: string | null;
};

const STAGE_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  capture: 'bg-blue-100 text-blue-700',
  outline: 'bg-indigo-100 text-indigo-700',
  writing: 'bg-purple-100 text-purple-700',
  review: 'bg-amber-100 text-amber-700',
  submitted: 'bg-green-100 text-green-700',
  archived: 'bg-slate-100 text-slate-500',
};

export default async function AdminProposalsPage() {
  const session = await auth();
  if (!session?.user) redirect('/admin');

  const role = (session.user as { role?: string }).role;
  if (role !== 'master_admin' && role !== 'rfp_admin') {
    redirect('/admin');
  }

  let proposals: ProposalRow[] = [];
  try {
    proposals = await sql<ProposalRow[]>`
      SELECT p.id, p.title, p.stage, p.created_at, p.updated_at,
             t.name as tenant_name, t.slug as tenant_slug,
             o.title as opportunity_title
      FROM proposals p
      JOIN tenants t ON t.id = p.tenant_id
      LEFT JOIN opportunities o ON o.id = p.opportunity_id
      ORDER BY p.updated_at DESC
      LIMIT 100
    `;
  } catch (e) {
    console.error('[admin/proposals] query failed:', e);
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">All Proposals</h1>
        <p className="text-sm text-gray-500 mt-1">
          Cross-tenant proposal overview (most recently updated first)
        </p>
      </div>

      {proposals.length === 0 ? (
        <p className="text-sm text-gray-400 py-8">No proposals found.</p>
      ) : (
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-xs text-gray-500 uppercase">
                <th className="px-4 py-3 font-medium">Title</th>
                <th className="px-4 py-3 font-medium">Tenant</th>
                <th className="px-4 py-3 font-medium">Opportunity</th>
                <th className="px-4 py-3 font-medium">Stage</th>
                <th className="px-4 py-3 font-medium">Updated</th>
                <th className="px-4 py-3 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {proposals.map((p) => {
                const stageColor = STAGE_COLORS[p.stage] ?? 'bg-gray-100 text-gray-700';
                return (
                  <tr key={p.id} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <Link
                        href={`/portal/${p.tenantSlug}/proposals/${p.id}`}
                        className="text-blue-600 hover:underline font-medium"
                      >
                        {p.title || 'Untitled'}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      <Link href={`/admin/tenants`} className="hover:underline">
                        {p.tenantName}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-gray-500 max-w-xs truncate">
                      {p.opportunityTitle ?? <span className="text-gray-400">-</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${stageColor}`}>
                        {p.stage}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                      {new Date(p.updatedAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                      {new Date(p.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
