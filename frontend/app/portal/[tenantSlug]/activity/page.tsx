import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, type Role } from '@/lib/rbac';
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
    redirect('/login');
  }
  const tenantId = tenant.id as string;

  const hasAccess = await verifyTenantAccess(sessionUser.id, role, tenantId);
  if (!hasAccess) {
    redirect('/login');
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

  const serialized = rows.map((r) => ({
    id: r.id,
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
