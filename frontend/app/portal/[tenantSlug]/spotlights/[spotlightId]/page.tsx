import { redirect, notFound } from 'next/navigation';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, type Role } from '@/lib/rbac';
import Link from 'next/link';
import SpotlightDetailActions from '@/components/portal/spotlight-detail-actions';

interface Props {
  params: Promise<{ tenantSlug: string; spotlightId: string }>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function daysRemaining(closeDate: string | null): number | null {
  if (!closeDate) return null;
  const diff = new Date(closeDate).getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

function formatDate(iso: string | null): string {
  if (!iso) return '--';
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatCurrency(amount: number | null): string {
  if (amount == null) return '--';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(amount);
}

const COMPLIANCE_CATEGORIES: Record<string, string[]> = {
  format: ['format', 'page', 'font', 'margin', 'spacing', 'file'],
  content: ['content', 'section', 'volume', 'technical', 'abstract', 'narrative'],
  eligibility: ['eligibility', 'eligible', 'size', 'naics', 'cage', 'duns', 'sam'],
  submission: ['submission', 'submit', 'deadline', 'email', 'portal', 'upload'],
};

function categorizeVariable(name: string): string {
  const lower = name.toLowerCase();
  for (const [category, keywords] of Object.entries(COMPLIANCE_CATEGORIES)) {
    if (keywords.some((kw) => lower.includes(kw))) return category;
  }
  return 'other';
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function SpotlightDetailPage({ params }: Props) {
  const { tenantSlug, spotlightId } = await params;

  // ---------- Auth + tenant ----------
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
  if (!tenant) redirect('/login');

  const tenantId = tenant.id as string;
  const hasAccess = await verifyTenantAccess(sessionUser.id, role, tenantId);
  if (!hasAccess) redirect('/login');

  // ---------- Load opportunity ----------
  interface OpportunityRow {
    id: string;
    title: string;
    description: string | null;
    agency: string | null;
    topicBranch: string | null;
    programType: string | null;
    phase: string | null;
    closeDate: string | null;
    postedDate: string | null;
    solicitationNumber: string | null;
    topicNumber: string | null;
    topicStatus: string | null;
    techFocusAreas: string[];
    fundingAmount: number | null;
    pocName: string | null;
    pocEmail: string | null;
    solicitationType: string | null;
    curationStatus: string | null;
    namespace: string | null;
  }

  let opportunity: OpportunityRow | null = null;

  try {
    const rows = await sql<OpportunityRow[]>`
      SELECT
        o.*,
        cs.status AS curation_status,
        cs.namespace
      FROM opportunities o
      LEFT JOIN curated_solicitations cs ON cs.opportunity_id = o.id
      WHERE o.id = ${spotlightId}::uuid
      LIMIT 1
    `;
    opportunity = rows[0] ?? null;
  } catch (e) {
    console.error('[spotlight-detail] opportunity query failed', e);
  }

  if (!opportunity) notFound();

  // ---------- Check pinned status ----------
  let pipelineItemId: string | null = null;
  let isPinned = false;

  try {
    const rows = await sql<{ id: string; isPinned: boolean }[]>`
      SELECT id, is_pinned FROM tenant_pipeline_items
      WHERE tenant_id = ${tenantId} AND opportunity_id = ${spotlightId}::uuid
      LIMIT 1
    `;
    if (rows[0]) {
      pipelineItemId = rows[0].id;
      isPinned = rows[0].isPinned;
    }
  } catch (e) {
    console.error('[spotlight-detail] pipeline item query failed', e);
  }

  // ---------- Check existing proposal ----------
  let existingProposalId: string | null = null;
  let existingProposalStage: string | null = null;

  try {
    const rows = await sql<{ id: string; stage: string }[]>`
      SELECT id, stage FROM proposals
      WHERE tenant_id = ${tenantId} AND opportunity_id = ${spotlightId}::uuid
      LIMIT 1
    `;
    if (rows[0]) {
      existingProposalId = rows[0].id;
      existingProposalStage = rows[0].stage;
    }
  } catch (e) {
    console.error('[spotlight-detail] proposal lookup failed', e);
  }

  // ---------- Compliance variables ----------
  interface ComplianceRow {
    variableName: string;
    value: string | null;
    sourcePage: number | null;
    sourceExcerpt: string | null;
  }

  let complianceVars: ComplianceRow[] = [];

  try {
    complianceVars = await sql<ComplianceRow[]>`
      SELECT variable_name, value, source_page, source_excerpt
      FROM solicitation_compliance sc
      JOIN curated_solicitations cs ON cs.id = sc.solicitation_id
      WHERE cs.opportunity_id = ${spotlightId}::uuid
      ORDER BY variable_name
      LIMIT 50
    `;
  } catch (e) {
    console.error('[spotlight-detail] compliance query failed', e);
  }

  // ---------- Derived values ----------
  const days = daysRemaining(opportunity.closeDate);
  const isClosingSoon = days !== null && days < 14;

  // Group compliance by category
  const complianceByCategory: Record<string, ComplianceRow[]> = {};
  for (const cv of complianceVars) {
    const cat = categorizeVariable(cv.variableName);
    if (!complianceByCategory[cat]) complianceByCategory[cat] = [];
    complianceByCategory[cat].push(cv);
  }

  const categoryOrder = ['format', 'content', 'eligibility', 'submission', 'other'];
  const categoryLabels: Record<string, string> = {
    format: 'Format Requirements',
    content: 'Content Requirements',
    eligibility: 'Eligibility',
    submission: 'Submission',
    other: 'Other',
  };

  // ---------- Render ----------
  return (
    <div>
      {/* Back link */}
      <Link
        href={`/portal/${tenantSlug}/spotlights`}
        className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700 mb-6"
      >
        <svg
          className="w-4 h-4 mr-1"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 19l-7-7 7-7"
          />
        </svg>
        Back to Spotlights
      </Link>

      {/* ── Header Section ──────────────────────────────────────────── */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">{opportunity.title}</h1>

        {/* Badges */}
        <div className="flex flex-wrap items-center gap-2 mt-3">
          {opportunity.agency && (
            <span className="inline-flex items-center px-2.5 py-0.5 text-xs font-medium rounded bg-blue-50 text-blue-700">
              {opportunity.agency}
            </span>
          )}
          {opportunity.programType && (
            <span className="inline-flex items-center px-2.5 py-0.5 text-xs font-medium rounded bg-green-50 text-green-700">
              {opportunity.programType}
            </span>
          )}
          {opportunity.phase && (
            <span className="inline-flex items-center px-2.5 py-0.5 text-xs font-medium rounded bg-purple-50 text-purple-700">
              Phase {opportunity.phase}
            </span>
          )}
          {opportunity.namespace && (
            <span className="inline-flex items-center px-2.5 py-0.5 text-xs font-medium rounded bg-gray-100 text-gray-600">
              {opportunity.namespace}
            </span>
          )}
          {opportunity.curationStatus && (
            <span className="inline-flex items-center px-2.5 py-0.5 text-xs font-medium rounded bg-amber-50 text-amber-700">
              {opportunity.curationStatus}
            </span>
          )}
        </div>

        {/* Close date */}
        <div className="flex items-center gap-4 mt-3 text-sm">
          <span className="text-gray-500">
            Close: {formatDate(opportunity.closeDate)}
          </span>
          {days !== null && (
            <span
              className={`font-medium ${
                days === 0
                  ? 'text-red-600'
                  : isClosingSoon
                    ? 'text-red-600'
                    : days <= 30
                      ? 'text-yellow-600'
                      : 'text-gray-600'
              }`}
            >
              {days === 0
                ? 'Closes today'
                : `${days} day${days !== 1 ? 's' : ''} remaining`}
            </span>
          )}
        </div>

        {/* Solicitation number */}
        {opportunity.solicitationNumber && (
          <p className="text-sm text-gray-500 mt-1">
            Solicitation: {opportunity.solicitationNumber}
          </p>
        )}
      </div>

      {/* ── Action Buttons ──────────────────────────────────────────── */}
      <div className="mb-8">
        <SpotlightDetailActions
          tenantSlug={tenantSlug}
          opportunityId={spotlightId}
          isPinned={isPinned}
          proposalId={existingProposalId}
          proposalStage={existingProposalStage}
        />
      </div>

      {/* ── Topic Details ───────────────────────────────────────────── */}
      <div className="bg-white border border-gray-200 rounded-lg p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          Topic Details
        </h2>

        {/* Description */}
        {opportunity.description && (
          <div className="mb-6">
            <h3 className="text-sm font-medium text-gray-500 mb-2">
              Description
            </h3>
            <div className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
              {opportunity.description}
            </div>
          </div>
        )}

        {/* Tech focus areas */}
        {opportunity.techFocusAreas && opportunity.techFocusAreas.length > 0 && (
          <div className="mb-6">
            <h3 className="text-sm font-medium text-gray-500 mb-2">
              Technology Focus Areas
            </h3>
            <div className="flex flex-wrap gap-2">
              {opportunity.techFocusAreas.map((area) => (
                <span
                  key={area}
                  className="inline-flex items-center px-3 py-1 text-xs font-medium rounded-full bg-indigo-50 text-indigo-700"
                >
                  {area}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Funding + POC grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          {/* Funding */}
          <div>
            <h3 className="text-sm font-medium text-gray-500 mb-1">
              Funding Amount
            </h3>
            <p className="text-sm text-gray-900">
              {formatCurrency(opportunity.fundingAmount)}
            </p>
          </div>

          {/* POC */}
          {(opportunity.pocName || opportunity.pocEmail) && (
            <div>
              <h3 className="text-sm font-medium text-gray-500 mb-1">
                Point of Contact
              </h3>
              {opportunity.pocName && (
                <p className="text-sm text-gray-900">{opportunity.pocName}</p>
              )}
              {opportunity.pocEmail && (
                <a
                  href={`mailto:${opportunity.pocEmail}`}
                  className="text-sm text-indigo-600 hover:text-indigo-800"
                >
                  {opportunity.pocEmail}
                </a>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Compliance Preview ──────────────────────────────────────── */}
      {complianceVars.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Compliance Preview
          </h2>

          {categoryOrder.map((cat) => {
            const items = complianceByCategory[cat];
            if (!items || items.length === 0) return null;

            return (
              <div key={cat} className="mb-6 last:mb-0">
                <h3 className="text-sm font-medium text-gray-700 mb-2 capitalize">
                  {categoryLabels[cat] ?? cat}
                </h3>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200">
                        <th className="text-left py-2 pr-4 font-medium text-gray-500 w-1/3">
                          Variable
                        </th>
                        <th className="text-left py-2 pr-4 font-medium text-gray-500 w-1/3">
                          Value
                        </th>
                        <th className="text-left py-2 font-medium text-gray-500 w-1/6">
                          Source Page
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((cv, idx) => (
                        <tr
                          key={`${cv.variableName}-${idx}`}
                          className="border-b border-gray-100 last:border-0"
                        >
                          <td className="py-2 pr-4 text-gray-900 font-medium">
                            {cv.variableName}
                          </td>
                          <td className="py-2 pr-4 text-gray-700">
                            {cv.value ?? '--'}
                          </td>
                          <td className="py-2 text-gray-500">
                            {cv.sourcePage != null ? `p. ${cv.sourcePage}` : '--'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}

          <p className="text-xs text-gray-400 mt-4 italic">
            Full compliance matrix available after proposal portal purchase.
          </p>
        </div>
      )}

      {/* ── Related Info ────────────────────────────────────────────── */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          Related Information
        </h2>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
          {opportunity.topicNumber && (
            <>
              <dt className="text-gray-500 font-medium">Topic Number</dt>
              <dd className="text-gray-900">{opportunity.topicNumber}</dd>
            </>
          )}
          {opportunity.topicBranch && (
            <>
              <dt className="text-gray-500 font-medium">Branch</dt>
              <dd className="text-gray-900">{opportunity.topicBranch}</dd>
            </>
          )}
          {opportunity.solicitationType && (
            <>
              <dt className="text-gray-500 font-medium">Solicitation Type</dt>
              <dd className="text-gray-900">{opportunity.solicitationType}</dd>
            </>
          )}
          {opportunity.topicStatus && (
            <>
              <dt className="text-gray-500 font-medium">Status</dt>
              <dd className="text-gray-900 capitalize">{opportunity.topicStatus}</dd>
            </>
          )}
          {opportunity.postedDate && (
            <>
              <dt className="text-gray-500 font-medium">Posted</dt>
              <dd className="text-gray-900">{formatDate(opportunity.postedDate)}</dd>
            </>
          )}
        </dl>
      </div>
    </div>
  );
}
