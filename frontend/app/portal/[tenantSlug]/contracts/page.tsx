import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { getTenantBySlug, verifyTenantAccess, enterTenant, sql } from '@/lib/db';
import { isRole, type Role } from '@/lib/rbac';

export const dynamic = 'force-dynamic';

/**
 * Contracts index — the awards this tenant has won (bug log B50).
 *
 * The contract entity and its kickoff workflow shipped in V1-10; the navigation did not. The only
 * way in was `lib/tasks/completers.ts` deep-linking the `contract_kickoff` ToDo straight at
 * `contracts/[contractId]`, so a customer who dismissed that ToDo — or simply wanted to look at
 * their award again a month later — had nowhere to go, and `/contracts` was a bare Next 404.
 *
 * That is the wrong thing to lose. A contract is the record of the single best outcome the product
 * has: the bid was won. It should be reachable the way every other entity is, from the rail.
 *
 * Read-only, like the detail page — nothing in V1 mutates a contract from the portal.
 */
export default async function ContractsPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const session = await auth();
  if (!session?.user) redirect('/login');
  const su = session.user as { id?: string; role?: unknown };
  const role: Role | null = isRole(su.role) ? su.role : null;
  if (!role || !su.id) redirect('/login?error=session');
  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) redirect('/portal');
  const tenantId = tenant.id as string;
  if (!(await verifyTenantAccess(su.id, role, tenantId))) redirect('/portal');
  // RLS choke point: pin tenant context in THIS frame before the read below.
  enterTenant(tenantId);

  // Declare the row type camelCase — postgres.toCamel renames on the way OUT, and a snake_case
  // assertion compiles fine while reading `undefined` at runtime (CLAUDE.md, the #1 crash class).
  let contracts: {
    id: string;
    title: string;
    status: string;
    awardDate: Date | null;
    awardAmountCents: string | number | null;
    popStart: Date | null;
    popEnd: Date | null;
    archivedAt: Date | null;
    proposalId: string | null;
    proposalTitle: string | null;
  }[] = [];
  let loadError = false;
  try {
    contracts = await sql<typeof contracts>`
      SELECT c.id, c.title, c.status, c.award_date, c.award_amount_cents,
             c.pop_start, c.pop_end, c.archived_at,
             c.proposal_id, p.title AS proposal_title
      FROM contracts c
      LEFT JOIN proposals p ON p.id = c.proposal_id AND p.tenant_id = c.tenant_id
      WHERE c.tenant_id = ${tenantId}::uuid
      ORDER BY c.archived_at IS NOT NULL, c.award_date DESC NULLS LAST, c.created_at DESC
    `;
  } catch (e) {
    console.error('[portal/contracts] list failed:', e);
    loadError = true;
  }

  // The column stores CENTS (bigint, so postgres.js hands it over as a string) — divide before
  // formatting, exactly as the detail page does. Forgetting the /100 renders a $274,500 award as
  // $27,450,000, which is the kind of wrong that looks plausible.
  const money = (cents: string | number | null) => {
    if (cents === null || cents === undefined) return '—';
    const n = Number(cents);
    if (!Number.isFinite(n)) return '—';
    return (n / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  };
  const day = (d: Date | null) => (d ? new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '—');

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Contracts</h1>
        <p className="text-gray-500 mt-1 text-sm">
          Awards won from your proposals. Each one is created when a build is recorded as awarded.
        </p>
      </div>

      {loadError && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          Your contracts could not be loaded. Reload the page, or contact support if this continues.
        </div>
      )}

      {!loadError && contracts.length === 0 && (
        <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
          <p className="font-medium text-gray-900">No contracts yet</p>
          <p className="mt-1 text-sm text-gray-500">
            When you record a build as awarded, the contract and its kickoff appear here.
          </p>
          <Link
            href={`/portal/${tenantSlug}/proposals`}
            className="mt-4 inline-block text-sm font-medium text-blue-700 hover:underline"
          >
            Go to proposals →
          </Link>
        </div>
      )}

      {!loadError && contracts.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3 font-medium">Contract</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Awarded</th>
                <th className="px-4 py-3 font-medium text-right tabular-nums">Value</th>
                <th className="px-4 py-3 font-medium">Period</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {contracts.map((c) => (
                <tr key={c.id} className={c.archivedAt ? 'opacity-60' : undefined}>
                  <td className="px-4 py-3">
                    <Link
                      href={`/portal/${tenantSlug}/contracts/${c.id}`}
                      className="font-medium text-blue-700 hover:underline"
                    >
                      {c.title}
                    </Link>
                    {c.proposalTitle && (
                      <div className="mt-0.5 text-xs text-gray-500">from “{c.proposalTitle}”</div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
                      {c.archivedAt ? 'archived' : c.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-gray-700">{day(c.awardDate)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-gray-900">{money(c.awardAmountCents)}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-gray-700">
                    {c.popStart || c.popEnd ? `${day(c.popStart)} – ${day(c.popEnd)}` : '—'}
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
