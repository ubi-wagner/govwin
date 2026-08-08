import { auth } from '@/auth';
import { redirect } from 'next/navigation';
// Admin cross-tenant console page — reads span tenants, so use the owner (BYPASSRLS) pool. (docs/RLS_CUTOVER.md)
import { sqlBypass as sql } from '@/lib/db';
import Link from 'next/link';
import { EventStreamClient } from './event-stream-client';

export const dynamic = 'force-dynamic';

export type EventRow = {
  id: string;
  namespace: string;
  type: string;
  phase: string | null;
  actorType: string | null;
  actorId: string | null;
  actorEmail: string | null;
  tenantId: string | null;
  tenantName: string | null;
  durationMs: number | null;
  payload: Record<string, unknown> | null;
  createdAt: Date;
};

const HOURS_MAP: Record<string, number> = { '1': 1, '6': 6, '24': 24, '168': 168, '720': 720 };
const ROW_LIMIT = 500;

export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<{ namespace?: string; type?: string; hours?: string; phase?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const role = (session.user as { role?: string }).role;
  if (role !== 'rfp_admin' && role !== 'master_admin') {
    redirect('/');
  }

  const params = await searchParams;
  const nsFilter = params.namespace && params.namespace !== 'all' ? params.namespace : '';
  const typeFilter = (params.type || '').trim();
  const phaseFilter = params.phase && params.phase !== 'all' ? params.phase : '';
  const hoursParam = params.hours || '24';
  const hours = HOURS_MAP[hoursParam] ?? 24;
  // Escape ILIKE metacharacters (CLAUDE.md SOP) — the type box is a substring search.
  const typePattern = '%' + typeFilter.replace(/[%_\\]/g, '\\$&') + '%';

  let rows: EventRow[] = [];
  let totalInWindow = 0;
  try {
    // One filterable query — every filter is optional (empty string disables it), so the four-way
    // branch is gone. LEFT JOIN tenants so the river shows the company NAME, not a raw UUID.
    rows = await sql<EventRow[]>`
      SELECT e.id, e.namespace, e.type, e.phase, e.actor_type, e.actor_id, e.actor_email,
             e.tenant_id, t.name AS tenant_name, e.duration_ms, e.payload, e.created_at
      FROM system_events e
      LEFT JOIN tenants t ON t.id = e.tenant_id
      WHERE e.created_at > NOW() - ${hours + ' hours'}::interval
        AND (${nsFilter} = '' OR e.namespace = ${nsFilter})
        AND (${typeFilter} = '' OR e.type ILIKE ${typePattern})
        AND (${phaseFilter} = '' OR e.phase = ${phaseFilter})
      ORDER BY e.created_at DESC
      LIMIT ${ROW_LIMIT}
    `;
    const [{ n } = { n: 0 }] = await sql<{ n: number }[]>`
      SELECT COUNT(*)::int AS n FROM system_events e
      WHERE e.created_at > NOW() - ${hours + ' hours'}::interval
        AND (${nsFilter} = '' OR e.namespace = ${nsFilter})
        AND (${typeFilter} = '' OR e.type ILIKE ${typePattern})
        AND (${phaseFilter} = '' OR e.phase = ${phaseFilter})
    `;
    totalInWindow = n;
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
    tenantName: r.tenantName,
    durationMs: r.durationMs,
    payload: r.payload,
    createdAt: r.createdAt.toISOString(),
  }));

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Event Stream</h1>
          <p className="text-sm text-gray-500 mt-1">
            Showing {serialized.length.toLocaleString()} of {totalInWindow.toLocaleString()} events in the last {hours}h
            {totalInWindow > ROW_LIMIT && ` — narrow the filters or time window to see the rest`}
          </p>
        </div>
        <Link href="/admin/dashboard" className="text-sm text-blue-600 hover:underline">
          Back to Dashboard
        </Link>
      </div>
      <EventStreamClient
        events={serialized}
        currentNamespace={nsFilter}
        currentType={typeFilter}
        currentPhase={phaseFilter}
        currentHours={hoursParam}
      />
    </div>
  );
}
