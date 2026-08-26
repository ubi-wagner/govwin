import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { getTenantBySlug, verifyTenantAccess, enterTenant, sql } from '@/lib/db';
import { isRole, type Role } from '@/lib/rbac';

export const dynamic = 'force-dynamic';

/**
 * Contract detail — the landing page for the `contract_kickoff` ToDo.
 *
 * The awarded arc creates a real `contracts` row and a kickoff gate
 * (`proposals/[p]/outcome` → launchProjectCollaboration with entityType:'contract'), and
 * `taskHref` routes that ToDo's "Open" button here. This page did not exist, so recording a WIN
 * — the single best moment in the product — produced a To-do whose only action 404s.
 *
 * Read-only by design: a contract is a RECORD of an award, and nothing in V1 mutates one from the
 * portal. The kickoff gate itself is completed from the To-dos queue, not from here.
 */
export default async function ContractPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; contractId: string }>;
}) {
  const { tenantSlug, contractId } = await params;
  const session = await auth();
  if (!session?.user) redirect('/login');
  const su = session.user as { id?: string; role?: unknown };
  const role: Role | null = isRole(su.role) ? su.role : null;
  if (!role || !su.id) redirect('/login?error=session');
  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) redirect('/portal');
  const tenantId = tenant.id as string;
  if (!(await verifyTenantAccess(su.id, role, tenantId))) redirect('/portal');
  // RLS choke point: pin tenant context in THIS frame before the reads below.
  enterTenant(tenantId);

  // Bind on tenant_id as well as id — never query a tenant-scoped row by id alone (CLAUDE.md).
  let contract: {
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
    opportunityId: string | null;
  } | null = null;
  try {
    const [row] = await sql<
      {
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
        opportunityId: string | null;
      }[]
    >`
      SELECT c.id, c.title, c.status, c.award_date, c.award_amount_cents,
             c.pop_start, c.pop_end, c.archived_at,
             c.proposal_id, p.title AS proposal_title, c.opportunity_id
      FROM contracts c
      LEFT JOIN proposals p ON p.id = c.proposal_id AND p.tenant_id = c.tenant_id
      WHERE c.id = ${contractId}::uuid AND c.tenant_id = ${tenantId}::uuid
      LIMIT 1
    `;
    contract = row ?? null;
  } catch (e) {
    console.error('[portal/contracts] load failed:', e);
    throw e;
  }

  if (!contract) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-12">
        <h1 className="text-2xl font-semibold text-slate-900">Contract not found</h1>
        <p className="mt-2 text-slate-600">
          This contract either does not exist or does not belong to {tenant.name as string}.
        </p>
        <Link href={`/portal/${tenantSlug}/todos`} className="mt-6 inline-block text-emerald-700 underline">
          ← Back to your To-dos
        </Link>
      </div>
    );
  }

  const money =
    contract.awardAmountCents == null
      ? null
      : (Number(contract.awardAmountCents) / 100).toLocaleString('en-US', {
          style: 'currency',
          currency: 'USD',
          maximumFractionDigits: 0,
        });
  const day = (d: Date | null) => (d ? new Date(d).toLocaleDateString('en-US', { dateStyle: 'medium' }) : '—');

  const statusTone: Record<string, string> = {
    active: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
    closed: 'bg-slate-100 text-slate-700 ring-slate-300',
    terminated: 'bg-rose-50 text-rose-800 ring-rose-200',
  };

  return (
    <div className="max-w-4xl mx-auto px-6 py-10">
      <nav className="text-sm text-slate-500">
        <Link href={`/portal/${tenantSlug}/todos`} className="hover:text-slate-800 hover:underline">
          To-dos
        </Link>
        <span className="mx-2">/</span>
        <span className="text-slate-700">Contract</span>
      </nav>

      <header className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">{contract.title}</h1>
          <p className="mt-1 text-sm text-slate-500">Awarded {day(contract.awardDate)}</p>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ${
            statusTone[contract.status] ?? 'bg-slate-100 text-slate-700 ring-slate-300'
          }`}
        >
          {contract.status}
          {contract.archivedAt ? ' · archived' : ''}
        </span>
      </header>

      <dl className="mt-8 grid grid-cols-1 gap-px overflow-hidden rounded-lg bg-slate-200 ring-1 ring-slate-200 sm:grid-cols-3">
        {[
          ['Award amount', money ?? 'Not recorded'],
          ['Period of performance', `${day(contract.popStart)} → ${day(contract.popEnd)}`],
          ['Status', contract.status],
        ].map(([k, v]) => (
          <div key={k} className="bg-white px-5 py-4">
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{k}</dt>
            <dd className="mt-1 text-sm font-medium text-slate-900">{v}</dd>
          </div>
        ))}
      </dl>

      <section className="mt-8 rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-slate-900">Where this came from</h2>
        <p className="mt-1 text-sm text-slate-600">
          This contract was created when the winning proposal&rsquo;s outcome was recorded.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          {contract.proposalId ? (
            <Link
              href={`/portal/${tenantSlug}/proposals/${contract.proposalId}`}
              className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700"
            >
              Open the winning proposal
              {contract.proposalTitle ? ` · ${contract.proposalTitle}` : ''}
            </Link>
          ) : null}
          <Link
            href={`/portal/${tenantSlug}/todos`}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Back to To-dos
          </Link>
        </div>
      </section>
    </div>
  );
}
