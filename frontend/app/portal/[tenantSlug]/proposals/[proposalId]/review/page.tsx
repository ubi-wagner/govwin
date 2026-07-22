import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, type Role } from '@/lib/rbac';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ tenantSlug: string; proposalId: string }>;
}

const STATUS_DISPLAY: Record<string, { label: string; color: string }> = {
  satisfied: { label: 'Complete', color: 'bg-green-100 text-green-700' },
  partial: { label: 'Draft', color: 'bg-yellow-100 text-yellow-700' },
  not_addressed: { label: 'Empty', color: 'bg-red-100 text-red-700' },
  not_applicable: { label: 'N/A', color: 'bg-gray-100 text-gray-500' },
};

const SECTION_STATUS: Record<string, { label: string; color: string }> = {
  draft: { label: 'Draft', color: 'bg-yellow-100 text-yellow-700' },
  complete: { label: 'Complete', color: 'bg-green-100 text-green-700' },
  review: { label: 'In Review', color: 'bg-blue-100 text-blue-700' },
  empty: { label: 'Empty', color: 'bg-red-100 text-red-700' },
};

export default async function ReviewPage({ params }: Props) {
  const { tenantSlug, proposalId } = await params;

  const session = await auth();
  if (!session?.user) redirect('/login');

  const sessionUser = session.user as {
    id?: string;
    role?: unknown;
    tenantId?: string | null;
  };
  const role: Role | null = isRole(sessionUser.role) ? sessionUser.role : null;
  if (!role || !sessionUser.id) redirect('/login?error=session');

  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) redirect('/portal');

  const tenantId = tenant.id as string;
  const hasAccess = await verifyTenantAccess(sessionUser.id, role, tenantId);
  if (!hasAccess) redirect('/portal');

  const basePath = `/portal/${tenantSlug}`;

  // ── Load proposal ─────────────────────────────────────────────────
  interface ProposalRow {
    id: string;
    title: string;
    stage: string;
    isLocked: boolean;
  }

  let proposal: ProposalRow | null = null;
  try {
    const [row] = await sql<ProposalRow[]>`
      SELECT id, title, stage, is_locked
      FROM proposals
      WHERE id = ${proposalId} AND tenant_id = ${tenantId}
    `;
    proposal = row ?? null;
  } catch (e) {
    console.error('[portal/review] proposal query failed', e);
  }

  if (!proposal) {
    redirect(`${basePath}/proposals`);
  }

  // The compliance review is a whole-proposal readiness roll-up — the full section
  // list, the entire compliance matrix, and a "Ready for Final" verdict. That is a
  // tenant-staff view. A stage-scoped external partner never gets the aggregate
  // (it would leak sections and requirements beyond their grant); send them back to
  // their own section-scoped workspace. There is no partner-facing link here — this
  // page is reachable only by direct URL — so this creates no dead link.
  if (role === 'partner_user') {
    redirect(`${basePath}/proposals/${proposalId}`);
  }

  // ── Load sections with content stats ──────────────────────────────
  interface SectionRow {
    id: string;
    sectionNumber: string;
    title: string;
    status: string;
    isLocked: boolean;
    pageAllocation: number | null;
    contentLength: number;
  }

  let sections: SectionRow[] = [];
  try {
    sections = await sql<SectionRow[]>`
      SELECT
        id,
        section_number,
        title,
        status,
        is_locked,
        page_allocation,
        COALESCE(length(content), 0) AS content_length
      FROM proposal_sections
      WHERE proposal_id = ${proposalId}
      ORDER BY section_number ASC
    `;
  } catch (e) {
    console.error('[portal/review] sections query failed', e);
  }

  // ── Load compliance matrix ────────────────────────────────────────
  interface ComplianceRow {
    id: string;
    requirementText: string;
    requirementSource: string | null;
    isMandatory: boolean;
    status: string;
    sectionId: string | null;
    notes: string | null;
  }

  let complianceItems: ComplianceRow[] = [];
  try {
    complianceItems = await sql<ComplianceRow[]>`
      SELECT id, requirement_text, requirement_source, is_mandatory, status, section_id, notes
      FROM proposal_compliance_matrix
      WHERE proposal_id = ${proposalId}
      ORDER BY is_mandatory DESC, created_at ASC
    `;
  } catch (e) {
    console.error('[portal/review] compliance query failed', e);
  }

  // ── Compute stats ─────────────────────────────────────────────────
  const totalReqs = complianceItems.length;
  const satisfiedReqs = complianceItems.filter(c => c.status === 'satisfied').length;
  const partialReqs = complianceItems.filter(c => c.status === 'partial').length;
  const notAddressed = complianceItems.filter(c => c.status === 'not_addressed').length;
  const mandatoryNotMet = complianceItems.filter(c => c.isMandatory && c.status !== 'satisfied' && c.status !== 'not_applicable').length;

  // Readiness is driven by lock state (the single source of truth), not `status`
  // — locking sets status='approved', so a status='complete' count would
  // under-report locked sections and invert the "ready" signal.
  const lockedSections = sections.filter(s => s.isLocked).length;
  const totalSections = sections.length;

  // Rough page estimate (~3000 chars per page)
  const totalContentChars = sections.reduce((sum, s) => sum + s.contentLength, 0);
  const estimatedPages = Math.ceil(totalContentChars / 3000);

  const allSectionsLocked = lockedSections === totalSections && totalSections > 0;
  const allReqsSatisfied = mandatoryNotMet === 0;
  const readyForFinal = allSectionsLocked && allReqsSatisfied;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Compliance Review</h1>
          <p className="text-sm text-gray-500 mt-1">{proposal.title}</p>
        </div>
        <Link
          href={`${basePath}/proposals/${proposalId}`}
          className="px-4 py-2 text-sm font-medium text-gray-600 border border-gray-200 rounded-md hover:bg-gray-50 transition-colors"
        >
          Back to Workspace
        </Link>
      </div>

      {/* Ready for Final indicator */}
      <div className={`rounded-lg border p-4 mb-6 ${readyForFinal ? 'border-green-300 bg-green-50' : 'border-amber-300 bg-amber-50'}`}>
        <div className="flex items-center gap-3">
          <span className={`text-lg ${readyForFinal ? 'text-green-600' : 'text-amber-600'}`}>
            {readyForFinal ? '✓' : '⚠'}
          </span>
          <div>
            <p className={`font-semibold text-sm ${readyForFinal ? 'text-green-800' : 'text-amber-800'}`}>
              {readyForFinal ? 'Ready for Final Submission' : 'Not Ready — Items Need Attention'}
            </p>
            <p className="text-xs text-gray-600 mt-0.5">
              {lockedSections}/{totalSections} sections accepted &amp; locked
              {' '}&middot;{' '}
              {satisfiedReqs}/{totalReqs} requirements satisfied
              {mandatoryNotMet > 0 && ` · ${mandatoryNotMet} mandatory items unmet`}
            </p>
          </div>
        </div>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <p className="text-xs text-gray-500 uppercase font-medium">Sections Locked</p>
          <p className="text-2xl font-bold mt-1">{lockedSections}/{totalSections}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <p className="text-xs text-gray-500 uppercase font-medium">Requirements Met</p>
          <p className="text-2xl font-bold mt-1">{satisfiedReqs}/{totalReqs}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <p className="text-xs text-gray-500 uppercase font-medium">Est. Pages</p>
          <p className="text-2xl font-bold mt-1">{estimatedPages}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <p className="text-xs text-gray-500 uppercase font-medium">Stage</p>
          <p className="text-lg font-bold mt-1 capitalize">{proposal.stage}</p>
        </div>
      </div>

      {/* Section status */}
      <section className="mb-10">
        <h2 className="text-lg font-semibold mb-4">Section Status</h2>
        {sections.length === 0 ? (
          <p className="text-sm text-gray-400 italic">No sections defined for this proposal.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">#</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Section</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Status</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-600">Page Limit</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-600">Est. Pages</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {sections.map((s) => {
                  const sectionPages = Math.ceil(s.contentLength / 3000);
                  const overLimit = s.pageAllocation && sectionPages > s.pageAllocation;
                  const statusInfo = SECTION_STATUS[s.status] ?? { label: s.status, color: 'bg-gray-100 text-gray-600' };
                  return (
                    <tr key={s.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-500 font-mono text-xs">{s.sectionNumber}</td>
                      <td className="px-4 py-3 font-medium text-gray-900">{s.title}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${statusInfo.color}`}>
                          {statusInfo.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-gray-500">{s.pageAllocation ?? '-'}</td>
                      <td className={`px-4 py-3 text-right ${overLimit ? 'text-red-600 font-medium' : 'text-gray-500'}`}>
                        {sectionPages}
                        {overLimit && ' (over)'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Compliance checklist */}
      <section>
        <h2 className="text-lg font-semibold mb-4">Compliance Checklist</h2>
        {complianceItems.length === 0 ? (
          <p className="text-sm text-gray-400 italic">No compliance requirements tracked for this proposal.</p>
        ) : (
          <div className="space-y-2">
            {complianceItems.map((c) => {
              const statusInfo = STATUS_DISPLAY[c.status] ?? { label: c.status, color: 'bg-gray-100 text-gray-600' };
              return (
                <div key={c.id} className="bg-white border border-gray-200 rounded-lg p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        {c.isMandatory && (
                          <span className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium bg-red-50 text-red-600">
                            Required
                          </span>
                        )}
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${statusInfo.color}`}>
                          {statusInfo.label}
                        </span>
                      </div>
                      <p className="text-sm text-gray-900 mt-1">{c.requirementText}</p>
                      {c.requirementSource && (
                        <p className="text-xs text-gray-400 mt-1">Source: {c.requirementSource}</p>
                      )}
                      {c.notes && (
                        <p className="text-xs text-gray-500 mt-1 italic">{c.notes}</p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Summary */}
        {complianceItems.length > 0 && (
          <div className="mt-4 p-4 bg-gray-50 rounded-lg text-sm text-gray-600">
            <p>
              <strong>{satisfiedReqs}</strong> satisfied &middot;{' '}
              <strong>{partialReqs}</strong> partial &middot;{' '}
              <strong>{notAddressed}</strong> not addressed
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
