import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { isValidUUID } from '@/lib/validation';
import { ProposalActivityClient } from './proposal-activity-client';

export const dynamic = 'force-dynamic';

export type ProposalActivityEvent = {
  id: string;
  source: 'event' | 'log';
  namespace: string;
  type: string;
  phase: string | null;
  actorType: string | null;
  actorId: string | null;
  actorEmail: string | null;
  parentEventId: string | null;
  payload: Record<string, unknown> | null;
  error: Record<string, unknown> | null;
  durationMs: number | null;
  createdAt: string;
};

const HOURS_MAP: Record<string, number> = { '24': 24, '168': 168, '720': 720 };

export default async function ProposalActivityPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string; proposalId: string }>;
  searchParams: Promise<{ hours?: string; ns?: string }>;
}) {
  const { tenantSlug, proposalId } = await params;

  const session = await auth();
  if (!session?.user) redirect('/login');

  const sessionUser = session.user as { id?: string; role?: unknown; tenantId?: string | null };
  const role: Role | null = isRole(sessionUser.role) ? sessionUser.role : null;
  if (!role || !sessionUser.id) redirect('/login?error=session');
  if (!hasRoleAtLeast(role, 'tenant_user')) redirect(`/portal/${tenantSlug}`);
  if (!isValidUUID(proposalId)) redirect(`/portal/${tenantSlug}/proposals`);

  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) redirect('/portal');
  const tenantId = tenant.id as string;

  const hasAccess = await verifyTenantAccess(sessionUser.id, role, tenantId);
  if (!hasAccess) redirect('/portal');

  const sp = await searchParams;
  const hoursParam = sp.hours || '168';
  const hours = HOURS_MAP[hoursParam] ?? 168;
  const nsFilter = sp.ns || '';

  let proposal: { id: string; title: string } | undefined;
  let sysEvents: ProposalActivityEvent[] = [];
  let activityLog: ProposalActivityEvent[] = [];

  try {
    [proposal] = await sql<{ id: string; title: string }[]>`
      SELECT id, title FROM proposals
      WHERE id = ${proposalId}::uuid AND tenant_id = ${tenantId}::uuid LIMIT 1
    `;
    if (!proposal) redirect(`/portal/${tenantSlug}/proposals`);

    // Check proposal-level access for non-admin users
    if (!hasRoleAtLeast(role, 'tenant_admin')) {
      const [collab] = await sql<{ userId: string }[]>`
        SELECT user_id FROM proposal_collaborators
        WHERE proposal_id = ${proposalId}::uuid AND user_id = ${sessionUser.id}::uuid
          AND revoked_at IS NULL LIMIT 1
      `;
      if (!collab) redirect(`/portal/${tenantSlug}/proposals`);
    }

    // system_events for this proposal
    sysEvents = await sql<{
      id: string; namespace: string; type: string; phase: string | null;
      actorType: string | null; actorId: string | null; actorEmail: string | null;
      parentEventId: string | null; payload: Record<string, unknown> | null;
      error: Record<string, unknown> | null; durationMs: number | null; createdAt: Date;
    }[]>`
      SELECT id, namespace, type, phase, actor_type, actor_id, actor_email,
             parent_event_id, payload, error, duration_ms, created_at
      FROM system_events
      WHERE tenant_id = ${tenantId}::uuid
        AND (
          payload->>'proposalId' = ${proposalId}
          OR payload->>'proposal_id' = ${proposalId}
        )
        AND created_at > NOW() - ${hours + ' hours'}::interval
        ${nsFilter ? sql`AND namespace = ${nsFilter}` : sql``}
      ORDER BY created_at DESC
      LIMIT 200
    `.then((rows) => rows.map((r) => ({
      id: r.id,
      source: 'event' as const,
      namespace: r.namespace,
      type: r.type,
      phase: r.phase,
      actorType: r.actorType,
      actorId: r.actorId,
      actorEmail: r.actorEmail,
      parentEventId: r.parentEventId,
      payload: r.payload,
      error: r.error,
      durationMs: r.durationMs,
      createdAt: r.createdAt.toISOString(),
    })));

    // proposal_activity_log for this proposal
    activityLog = await sql<{
      id: string; actorId: string | null; actorEmail: string | null; actorRole: string | null;
      activityType: string; sectionId: string | null; sectionTitle: string | null;
      details: Record<string, unknown>; createdAt: Date;
    }[]>`
      SELECT id, actor_id, actor_email, actor_role, activity_type, section_id,
             section_title, details, created_at
      FROM proposal_activity_log
      WHERE proposal_id = ${proposalId}::uuid
        AND tenant_id = ${tenantId}::uuid
        AND created_at > NOW() - ${hours + ' hours'}::interval
      ORDER BY created_at DESC
      LIMIT 200
    `.then((rows) => rows.map((r) => ({
      id: r.id,
      source: 'log' as const,
      namespace: 'proposal',
      type: r.activityType,
      phase: null,
      actorType: r.actorRole === 'agent' ? 'agent' : 'user',
      actorId: r.actorId,
      actorEmail: r.actorEmail,
      parentEventId: null,
      payload: { ...r.details, sectionId: r.sectionId, sectionTitle: r.sectionTitle },
      error: null,
      durationMs: null,
      createdAt: r.createdAt.toISOString(),
    })));
  } catch (e) {
    console.error('[portal/proposals/activity] query failed:', e);
  }

  // Merge and sort chronologically
  const merged = [...sysEvents, ...activityLog].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  const basePath = `/portal/${tenantSlug}/proposals/${proposalId}`;

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Proposal Activity</h1>
          <p className="text-sm text-gray-500 mt-1">
            {proposal?.title ? `"${proposal.title}" · ` : ''}{merged.length} entries in the last{' '}
            {hours >= 24 ? `${Math.round(hours / 24)}d` : `${hours}h`}
          </p>
        </div>
        <a href={`${basePath}`} className="text-sm text-blue-600 hover:underline">
          Back to Proposal
        </a>
      </div>
      <ProposalActivityClient
        events={merged}
        currentHours={hoursParam}
        currentNs={nsFilter}
        basePath={basePath}
        tenantSlug={tenantSlug}
      />
    </div>
  );
}
