import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { sql } from '@/lib/db';
import Link from 'next/link';
import { EventStreamClient } from './event-stream-client';

export type EventRow = {
  id: string;
  namespace: string;
  type: string;
  phase: string | null;
  actorType: string | null;
  actorId: string | null;
  actorEmail: string | null;
  tenantId: string | null;
  payload: Record<string, unknown> | null;
  createdAt: Date;
};

const HOURS_MAP: Record<string, number> = {
  '1': 1,
  '6': 6,
  '24': 24,
  '168': 168, // 7d
};

export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<{ namespace?: string; type?: string; hours?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const role = (session.user as { role?: string }).role;
  if (role !== 'rfp_admin' && role !== 'master_admin') {
    redirect('/login');
  }

  const params = await searchParams;
  const nsFilter = params.namespace || '';
  const typeFilter = params.type || '';
  const hoursParam = params.hours || '24';
  const hours = HOURS_MAP[hoursParam] ?? 24;

  let rows: EventRow[] = [];
  try {
    if (nsFilter && typeFilter) {
      rows = await sql<EventRow[]>`
        SELECT id, namespace, type, phase, actor_type, actor_id, actor_email,
               tenant_id, payload, created_at
        FROM system_events
        WHERE created_at > NOW() - ${hours + ' hours'}::interval
          AND namespace = ${nsFilter}
          AND type = ${typeFilter}
        ORDER BY created_at DESC
        LIMIT 100
      `;
    } else if (nsFilter) {
      rows = await sql<EventRow[]>`
        SELECT id, namespace, type, phase, actor_type, actor_id, actor_email,
               tenant_id, payload, created_at
        FROM system_events
        WHERE created_at > NOW() - ${hours + ' hours'}::interval
          AND namespace = ${nsFilter}
        ORDER BY created_at DESC
        LIMIT 100
      `;
    } else if (typeFilter) {
      rows = await sql<EventRow[]>`
        SELECT id, namespace, type, phase, actor_type, actor_id, actor_email,
               tenant_id, payload, created_at
        FROM system_events
        WHERE created_at > NOW() - ${hours + ' hours'}::interval
          AND type = ${typeFilter}
        ORDER BY created_at DESC
        LIMIT 100
      `;
    } else {
      rows = await sql<EventRow[]>`
        SELECT id, namespace, type, phase, actor_type, actor_id, actor_email,
               tenant_id, payload, created_at
        FROM system_events
        WHERE created_at > NOW() - ${hours + ' hours'}::interval
        ORDER BY created_at DESC
        LIMIT 100
      `;
    }
  } catch (e) {
    console.error('[admin/events] query failed:', e);
  }

  const serialized = rows.map((r) => ({
    id: r.id,
    namespace: r.namespace,
    type: r.type,
    phase: r.phase,
    actorType: r.actorType,
    actorId: r.actorId,
    actorEmail: r.actorEmail,
    tenantId: r.tenantId,
    payload: r.payload,
    createdAt: r.createdAt.toISOString(),
  }));

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Event Stream</h1>
          <p className="text-sm text-gray-500 mt-1">
            {serialized.length} events in the last {hours}h
          </p>
        </div>
        <Link
          href="/admin/dashboard"
          className="text-sm text-blue-600 hover:underline"
        >
          Back to Dashboard
        </Link>
      </div>
      <EventStreamClient
        events={serialized}
        currentNamespace={nsFilter}
        currentType={typeFilter}
        currentHours={hoursParam}
      />
    </div>
  );
}
