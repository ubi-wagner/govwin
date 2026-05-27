import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { sql } from '@/lib/db';
import Link from 'next/link';
import { ProcessMonitorClient } from './process-monitor-client';

export const dynamic = 'force-dynamic';

export type ActiveProcess = {
  id: string;
  namespace: string;
  type: string;
  actorType: string | null;
  actorEmail: string | null;
  tenantId: string | null;
  payload: Record<string, unknown> | null;
  createdAt: string;
};

export type CompletedProcess = {
  id: string;
  namespace: string;
  type: string;
  phase: string | null;
  actorType: string | null;
  actorEmail: string | null;
  tenantId: string | null;
  payload: Record<string, unknown> | null;
  error: Record<string, unknown> | null;
  durationMs: number | null;
  createdAt: string;
  parentEventId: string | null;
};

export type ErrorEvent = {
  id: string;
  namespace: string;
  type: string;
  actorType: string | null;
  actorEmail: string | null;
  tenantId: string | null;
  payload: Record<string, unknown> | null;
  error: Record<string, unknown> | null;
  createdAt: string;
};

export type NamespaceStat = {
  namespace: string;
  count: number;
};

export type TenantActivity = {
  tenantId: string;
  tenantName: string | null;
  tenantSlug: string | null;
  eventCount: number;
};

type ActiveProcessRow = {
  id: string;
  namespace: string;
  type: string;
  actorType: string | null;
  actorEmail: string | null;
  tenantId: string | null;
  payload: Record<string, unknown> | null;
  createdAt: Date;
};

type CompletedProcessRow = {
  id: string;
  namespace: string;
  type: string;
  phase: string | null;
  actorType: string | null;
  actorEmail: string | null;
  tenantId: string | null;
  payload: Record<string, unknown> | null;
  error: Record<string, unknown> | null;
  durationMs: number | null;
  createdAt: Date;
  parentEventId: string | null;
};

type ErrorEventRow = {
  id: string;
  namespace: string;
  type: string;
  actorType: string | null;
  actorEmail: string | null;
  tenantId: string | null;
  payload: Record<string, unknown> | null;
  error: Record<string, unknown> | null;
  createdAt: Date;
};

type NamespaceStatRow = {
  namespace: string;
  count: number;
};

type TenantActivityRow = {
  tenantId: string;
  tenantName: string | null;
  tenantSlug: string | null;
  eventCount: number;
};

export default async function ProcessMonitorPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const role = (session.user as { role?: string }).role;
  if (role !== 'rfp_admin' && role !== 'master_admin') {
    redirect('/');
  }

  let activeProcesses: ActiveProcess[] = [];
  let completions: CompletedProcess[] = [];
  let errors: ErrorEvent[] = [];
  let stats: NamespaceStat[] = [];
  let tenantActivity: TenantActivity[] = [];

  // (a) Active processes — start events without matching end in last hour
  try {
    const rows = await sql<ActiveProcessRow[]>`
      SELECT se.id, se.namespace, se.type, se.actor_type, se.actor_email,
             se.tenant_id, se.payload, se.created_at
      FROM system_events se
      WHERE se.phase = 'start'
        AND se.created_at > NOW() - INTERVAL '1 hour'
        AND NOT EXISTS (
          SELECT 1 FROM system_events e2
          WHERE e2.parent_event_id = se.id AND e2.phase = 'end'
        )
      ORDER BY se.created_at DESC
      LIMIT 20
    `;
    activeProcesses = rows.map((r) => ({
      id: r.id,
      namespace: r.namespace,
      type: r.type,
      actorType: r.actorType,
      actorEmail: r.actorEmail,
      tenantId: r.tenantId,
      payload: r.payload,
      createdAt: r.createdAt.toISOString(),
    }));
  } catch (e) {
    console.error('[admin/process] active processes query failed:', e);
  }

  // (b) Recent completions — last 30 completed process pairs
  try {
    const rows = await sql<CompletedProcessRow[]>`
      SELECT
        e_end.id,
        e_end.namespace,
        e_end.type,
        e_end.phase,
        e_end.actor_type,
        e_end.actor_email,
        e_end.tenant_id,
        e_end.payload,
        e_end.error,
        e_end.duration_ms,
        e_end.created_at,
        e_end.parent_event_id
      FROM system_events e_end
      WHERE e_end.phase = 'end'
        AND e_end.created_at > NOW() - INTERVAL '24 hours'
      ORDER BY e_end.created_at DESC
      LIMIT 30
    `;
    completions = rows.map((r) => ({
      id: r.id,
      namespace: r.namespace,
      type: r.type,
      phase: r.phase,
      actorType: r.actorType,
      actorEmail: r.actorEmail,
      tenantId: r.tenantId,
      payload: r.payload,
      error: r.error,
      durationMs: r.durationMs,
      createdAt: r.createdAt.toISOString(),
      parentEventId: r.parentEventId,
    }));
  } catch (e) {
    console.error('[admin/process] completions query failed:', e);
  }

  // (c) Error events — last 10 errors
  try {
    const rows = await sql<ErrorEventRow[]>`
      SELECT id, namespace, type, actor_type, actor_email, tenant_id,
             payload, error, created_at
      FROM system_events
      WHERE error IS NOT NULL
        AND created_at > NOW() - INTERVAL '24 hours'
      ORDER BY created_at DESC
      LIMIT 10
    `;
    errors = rows.map((r) => ({
      id: r.id,
      namespace: r.namespace,
      type: r.type,
      actorType: r.actorType,
      actorEmail: r.actorEmail,
      tenantId: r.tenantId,
      payload: r.payload,
      error: r.error,
      createdAt: r.createdAt.toISOString(),
    }));
  } catch (e) {
    console.error('[admin/process] errors query failed:', e);
  }

  // (d) Stats — counts by namespace in last 24h
  try {
    const rows = await sql<NamespaceStatRow[]>`
      SELECT namespace, COUNT(*)::int AS count
      FROM system_events
      WHERE created_at > NOW() - INTERVAL '24 hours'
      GROUP BY namespace
      ORDER BY count DESC
    `;
    stats = rows.map((r) => ({
      namespace: r.namespace,
      count: r.count,
    }));
  } catch (e) {
    console.error('[admin/process] stats query failed:', e);
  }

  // (e) Tenant activity summary
  try {
    const rows = await sql<TenantActivityRow[]>`
      SELECT se.tenant_id, t.name AS tenant_name, t.slug AS tenant_slug,
             COUNT(*)::int AS event_count
      FROM system_events se
      LEFT JOIN tenants t ON t.id = se.tenant_id
      WHERE se.created_at > NOW() - INTERVAL '24 hours'
        AND se.tenant_id IS NOT NULL
      GROUP BY se.tenant_id, t.name, t.slug
      ORDER BY event_count DESC
      LIMIT 10
    `;
    tenantActivity = rows.map((r) => ({
      tenantId: r.tenantId,
      tenantName: r.tenantName,
      tenantSlug: r.tenantSlug,
      eventCount: r.eventCount,
    }));
  } catch (e) {
    console.error('[admin/process] tenant activity query failed:', e);
  }

  return (
    <div className="max-w-7xl mx-auto">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Process Monitor</h1>
          <p className="text-sm text-gray-500 mt-1">
            Real-time view of platform activity across all tenants
          </p>
        </div>
        <Link
          href="/admin/dashboard"
          className="text-sm text-blue-600 hover:underline"
        >
          Back to Dashboard
        </Link>
      </div>
      <ProcessMonitorClient
        activeProcesses={activeProcesses}
        completions={completions}
        errors={errors}
        stats={stats}
        tenantActivity={tenantActivity}
      />
    </div>
  );
}
