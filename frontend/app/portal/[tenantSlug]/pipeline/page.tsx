import React from 'react';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, type Role } from '@/lib/rbac';
import Link from 'next/link';

interface Props {
  params: Promise<{ tenantSlug: string }>;
}

function daysUntil(dateStr: string | Date | null): number | null {
  if (!dateStr) return null;
  const target = new Date(dateStr);
  const now = new Date();
  return Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

function countdownBadge(days: number | null): React.ReactNode {
  if (days === null) return null;
  if (days < 0) {
    return <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-500">Closed</span>;
  }
  if (days <= 7) {
    return <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-red-100 text-red-700">{days}d left</span>;
  }
  if (days <= 30) {
    return <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-yellow-100 text-yellow-700">{days}d left</span>;
  }
  return <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700">{days}d left</span>;
}

export default async function PipelinePage({ params }: Props) {
  const { tenantSlug } = await params;

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

  const basePath = `/portal/${tenantSlug}`;

  // ── Pinned opportunities with proposal status ─────────────────────
  interface PipelineItem {
    id: string;
    opportunityId: string;
    title: string;
    agency: string | null;
    closeDate: Date | null;
    isPinned: boolean;
    totalScore: number;
    pursuitStatus: string;
    createdAt: Date;
    proposalId: string | null;
    proposalStage: string | null;
  }

  let items: PipelineItem[] = [];
  try {
    items = await sql<PipelineItem[]>`
      SELECT
        tpi.id,
        tpi.opportunity_id,
        o.title,
        o.agency,
        o.close_date,
        tpi.is_pinned,
        tpi.total_score,
        tpi.pursuit_status,
        tpi.created_at,
        p.id AS proposal_id,
        p.stage AS proposal_stage
      FROM tenant_pipeline_items tpi
      JOIN opportunities o ON o.id = tpi.opportunity_id
      LEFT JOIN proposals p ON p.opportunity_id = tpi.opportunity_id AND p.tenant_id = ${tenantId}
      WHERE tpi.tenant_id = ${tenantId}
        AND tpi.is_pinned = true
      ORDER BY o.close_date ASC NULLS LAST
    `;
  } catch (e) {
    console.error('[portal/pipeline] query failed', e);
  }

  const STAGE_LABELS: Record<string, { label: string; color: string }> = {
    draft: { label: 'Drafting', color: 'bg-blue-100 text-blue-700' },
    review: { label: 'Review', color: 'bg-purple-100 text-purple-700' },
    final: { label: 'Final', color: 'bg-green-100 text-green-700' },
    submitted: { label: 'Submitted', color: 'bg-emerald-100 text-emerald-700' },
    archived: { label: 'Archived', color: 'bg-gray-200 text-gray-500' },
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">My Pipeline</h1>
        <p className="text-sm text-gray-500 mt-1">
          {items.length} pinned opportunit{items.length !== 1 ? 'ies' : 'y'}
        </p>
      </div>

      {items.length === 0 ? (
        <div className="text-center py-16 bg-gray-50 rounded-lg border border-dashed border-gray-300">
          <h3 className="text-lg font-medium text-gray-600">No pinned opportunities</h3>
          <p className="text-sm text-gray-500 mt-1">
            Pin opportunities from your Spotlight feed to track them here.
          </p>
          <Link
            href={`${basePath}/spotlights`}
            className="inline-block mt-4 text-sm text-blue-600 hover:underline"
          >
            Browse Spotlight Feed
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => {
            const days = daysUntil(item.closeDate);
            const isClosed = days !== null && days < 0;
            const hasProposal = !!item.proposalId;
            const stageInfo = item.proposalStage ? STAGE_LABELS[item.proposalStage] : null;

            let statusLabel: string;
            let statusColor: string;
            if (hasProposal && stageInfo) {
              statusLabel = stageInfo.label;
              statusColor = stageInfo.color;
            } else if (hasProposal) {
              statusLabel = 'In Progress';
              statusColor = 'bg-blue-100 text-blue-700';
            } else {
              statusLabel = 'Pinned';
              statusColor = 'bg-gray-100 text-gray-600';
            }

            return (
              <div
                key={item.id}
                className={`bg-white border rounded-lg p-5 ${isClosed ? 'border-gray-200 opacity-60' : 'border-gray-200 hover:border-indigo-300 hover:shadow-sm'} transition-all`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <h3 className="font-semibold text-gray-900 truncate">{item.title}</h3>
                    <div className="flex items-center gap-3 mt-2 text-xs text-gray-500">
                      {item.agency && <span>{item.agency}</span>}
                      <span>Score: {item.totalScore}</span>
                      {item.closeDate && (
                        <span>
                          Close: {new Date(item.closeDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    {countdownBadge(days)}
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${statusColor}`}>
                      {statusLabel}
                    </span>
                    {!hasProposal && !isClosed && (
                      <Link
                        href={`${basePath}/spotlights`}
                        className="px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
                      >
                        Build Proposal
                      </Link>
                    )}
                    {hasProposal && item.proposalId && (
                      <Link
                        href={`${basePath}/proposals/${item.proposalId}`}
                        className="px-3 py-1.5 text-xs font-medium text-blue-600 border border-blue-200 rounded-md hover:bg-blue-50 transition-colors"
                      >
                        Open
                      </Link>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
