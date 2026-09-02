import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { ActivityStreamClient } from './activity-stream-client';

export const dynamic = 'force-dynamic';

export type ActivityEventRow = {
  id: string;
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
  createdAt: Date;
};

const HOURS_MAP: Record<string, number> = {
  '1': 1,
  '6': 6,
  '24': 24,
  '168': 168,
  '720': 720,
};

export default async function ActivityPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{
    namespace?: string;
    type?: string;
    hours?: string;
  }>;
}) {
  const { tenantSlug } = await params;

  const session = await auth();
  if (!session?.user) {
    redirect('/login');
  }

  const sessionUser = session.user as {
    id?: string;
    role?: unknown;
    tenantId?: string | null;
  };
  const role: Role | null = isRole(sessionUser.role) ? sessionUser.role : null;
  if (!role || !sessionUser.id) {
    redirect('/login?error=session');
  }

  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) {
    redirect('/portal');
  }
  const tenantId = tenant.id as string;

  const hasAccess = await verifyTenantAccess(sessionUser.id, role, tenantId);
  if (!hasAccess) {
    redirect('/portal');
  }

  // Admin-only: the tenant activity firehose (every member's actions, invites, member-adds) is for
  // tenant_admin+ — a tenant_user should not see it. rfp_admin/master_admin pass by rank; a descended
  // partner-manager passes as the pinned tenant_admin. (Command Center Activity tab; COMMAND_CENTER_DESIGN.md §3.3.)
  if (!hasRoleAtLeast(role, 'tenant_admin')) {
    redirect(`/portal/${tenantSlug}/proposals`);
  }

  const sp = await searchParams;
  const nsFilter = sp.namespace || '';
  const typeFilter = sp.type || '';
  const hoursParam = sp.hours || '168';
  const hours = HOURS_MAP[hoursParam] ?? 168;
  const limit = 200;

  const escapedType = typeFilter.replace(/[%_\\]/g, '\\$&');

  let rows: ActivityEventRow[] = [];
  try {
    if (nsFilter && typeFilter) {
      rows = await sql<ActivityEventRow[]>`
        SELECT id, namespace, type, phase, actor_type, actor_id, actor_email,
               parent_event_id, payload, error, duration_ms, created_at
        FROM system_events
        WHERE tenant_id = ${tenantId}
          AND created_at > NOW() - ${hours + ' hours'}::interval
          AND namespace = ${nsFilter}
          AND type ILIKE ${'%' + escapedType + '%'}
        ORDER BY created_at DESC
        LIMIT ${limit}
      `;
    } else if (nsFilter) {
      rows = await sql<ActivityEventRow[]>`
        SELECT id, namespace, type, phase, actor_type, actor_id, actor_email,
               parent_event_id, payload, error, duration_ms, created_at
        FROM system_events
        WHERE tenant_id = ${tenantId}
          AND created_at > NOW() - ${hours + ' hours'}::interval
          AND namespace = ${nsFilter}
        ORDER BY created_at DESC
        LIMIT ${limit}
      `;
    } else if (typeFilter) {
      rows = await sql<ActivityEventRow[]>`
        SELECT id, namespace, type, phase, actor_type, actor_id, actor_email,
               parent_event_id, payload, error, duration_ms, created_at
        FROM system_events
        WHERE tenant_id = ${tenantId}
          AND created_at > NOW() - ${hours + ' hours'}::interval
          AND type ILIKE ${'%' + escapedType + '%'}
        ORDER BY created_at DESC
        LIMIT ${limit}
      `;
    } else {
      rows = await sql<ActivityEventRow[]>`
        SELECT id, namespace, type, phase, actor_type, actor_id, actor_email,
               parent_event_id, payload, error, duration_ms, created_at
        FROM system_events
        WHERE tenant_id = ${tenantId}
          AND created_at > NOW() - ${hours + ' hours'}::interval
        ORDER BY created_at DESC
        LIMIT ${limit}
      `;
    }
  } catch (e) {
    console.error('[portal/activity] events query failed:', e);
  }

  /**
   * Put a NAME on the rows that only carry an id.
   *
   * 69 of 1,320 user events have an `actor_id` and no `actor_email`, and the feed was rendering the
   * raw UUID — while every one of those ids resolves to a real person one join away. Found by
   * `scripts/probe-customer-finish.mts`.
   *
   * ONE lookup after the fact, deliberately, rather than a join added to each of the four query
   * branches above: four copies of a predicate is four chances for them to drift, and this asks a
   * different question from the branches anyway.
   *
   * Scoped through `user_memberships` for THIS tenant — a name is a fact about a person, and the
   * fact that they exist is not this customer's to learn. An actor outside the tenant stays
   * unresolved, and `describeActor` says "Unknown" rather than inventing a person.
   */
  const idsToName = [...new Set(rows
    .filter((r) => !r.actorEmail && r.actorId && /^[0-9a-f-]{36}$/i.test(r.actorId))
    .map((r) => r.actorId as string))];
  const nameById = new Map<string, string>();
  if (idsToName.length) {
    try {
      const people = await sql<{ id: string; name: string | null; email: string }[]>`
        SELECT u.id::text AS id, u.name, u.email
          FROM users u
          JOIN user_memberships m ON m.user_id = u.id
         WHERE m.tenant_id = ${tenantId} AND u.id::text = ANY(${idsToName})`;
      for (const p of people) nameById.set(p.id, p.name || p.email);
    } catch (e) {
      // Said out loud, and NOT fatal: an unresolved name degrades to "Unknown", which is the
      // honest reading. Silently rendering the id again would restore the defect.
      console.error('[portal/activity] actor name lookup failed:', e);
    }
  }

  const serialized = rows.map((r) => ({
    id: r.id,
    namespace: r.namespace,
    type: r.type,
    phase: r.phase,
    actorType: r.actorType,
    actorId: r.actorId,
    actorEmail: r.actorEmail,
    actorName: (r.actorId && nameById.get(r.actorId)) || null,
    parentEventId: r.parentEventId,
    payload: r.payload,
    error: r.error,
    durationMs: r.durationMs,
    createdAt: r.createdAt.toISOString(),
  }));

  const basePath = `/portal/${tenantSlug}`;

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Activity Stream</h1>
          <p className="text-sm text-gray-500 mt-1">
            {serialized.length} events in the last{' '}
            {hours >= 24 ? `${Math.round(hours / 24)}d` : `${hours}h`}
          </p>
        </div>
        <a
          href={`${basePath}/dashboard`}
          className="text-sm text-blue-600 hover:underline"
        >
          Back to Dashboard
        </a>
      </div>
      <ActivityStreamClient
        events={serialized}
        currentNamespace={nsFilter}
        currentType={typeFilter}
        currentHours={hoursParam}
        basePath={basePath}
      />
    </div>
  );
}
