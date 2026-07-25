import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { sql } from '@/lib/db';
import Link from 'next/link';
import { EventStreamClient, type SerializedEvent, type SerializedAgentLog } from './event-stream-client';

export const dynamic = 'force-dynamic';

const HOURS_MAP: Record<string, number> = {
  '1': 1,
  '6': 6,
  '24': 24,
  '168': 168,
  '720': 720,
};

const PAGE_SIZE = 100;

export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<{
    namespace?: string;
    type?: string;
    hours?: string;
    errorsOnly?: string;
    tenantId?: string;
    tab?: string;
    offset?: string;
  }>;
}) {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const role = (session.user as { role?: string }).role;
  if (role !== 'rfp_admin' && role !== 'master_admin') {
    redirect('/');
  }

  const params = await searchParams;
  const nsFilter = params.namespace || '';
  const typeFilter = params.type || '';
  const hoursParam = params.hours || '24';
  const hours = HOURS_MAP[hoursParam] ?? 24;
  const errorsOnly = params.errorsOnly === '1';
  const tenantIdFilter = params.tenantId || '';
  const tab = params.tab || 'events';
  const offset = Math.max(parseInt(params.offset || '0', 10), 0);
  const escapedType = typeFilter.replace(/[%_\\]/g, '\\$&');

  // Fetch tenant list for filter dropdown (master_admin only to avoid info leak)
  let tenants: { id: string; name: string; slug: string }[] = [];
  if (role === 'master_admin') {
    try {
      tenants = await sql<{ id: string; name: string; slug: string }[]>`
        SELECT id, name, slug FROM tenants ORDER BY name LIMIT 200
      `;
    } catch (e) {
      console.error('[admin/events] tenants query failed:', e);
    }
  }

  let events: SerializedEvent[] = [];
  let total = 0;
  let agentLogs: SerializedAgentLog[] = [];
  let agentTotal = 0;

  try {
    if (tab === 'events') {
      const conditions: string[] = [`created_at > NOW() - '${hours} hours'::interval`];
      if (nsFilter) conditions.push(`namespace = '${nsFilter.replace(/'/g, "''")}'`);
      if (typeFilter) conditions.push(`type ILIKE '%${escapedType.replace(/'/g, "''")}%'`);
      if (errorsOnly) conditions.push(`error IS NOT NULL`);
      if (tenantIdFilter) conditions.push(`tenant_id = '${tenantIdFilter.replace(/'/g, "''")}'::uuid`);

      const rows = await sql<{
        id: string;
        namespace: string;
        type: string;
        phase: string | null;
        actorType: string | null;
        actorId: string | null;
        actorEmail: string | null;
        tenantId: string | null;
        parentEventId: string | null;
        payload: Record<string, unknown> | null;
        error: Record<string, unknown> | null;
        durationMs: number | null;
        createdAt: Date;
      }[]>`
        SELECT id, namespace, type, phase, actor_type, actor_id, actor_email,
               tenant_id, parent_event_id, payload, error, duration_ms, created_at
        FROM system_events
        WHERE created_at > NOW() - ${hours + ' hours'}::interval
          ${nsFilter ? sql`AND namespace = ${nsFilter}` : sql``}
          ${typeFilter ? sql`AND type ILIKE ${'%' + escapedType + '%'}` : sql``}
          ${errorsOnly ? sql`AND error IS NOT NULL` : sql``}
          ${tenantIdFilter ? sql`AND tenant_id = ${tenantIdFilter}::uuid` : sql``}
        ORDER BY created_at DESC
        LIMIT ${PAGE_SIZE}
        OFFSET ${offset}
      `;

      const [countRow] = await sql<{ n: string }[]>`
        SELECT count(*)::text AS n
        FROM system_events
        WHERE created_at > NOW() - ${hours + ' hours'}::interval
          ${nsFilter ? sql`AND namespace = ${nsFilter}` : sql``}
          ${typeFilter ? sql`AND type ILIKE ${'%' + escapedType + '%'}` : sql``}
          ${errorsOnly ? sql`AND error IS NOT NULL` : sql``}
          ${tenantIdFilter ? sql`AND tenant_id = ${tenantIdFilter}::uuid` : sql``}
      `;
      total = parseInt(countRow?.n ?? '0', 10);

      events = rows.map((r) => ({
        id: r.id,
        namespace: r.namespace,
        type: r.type,
        phase: r.phase,
        actorType: r.actorType,
        actorId: r.actorId,
        actorEmail: r.actorEmail,
        tenantId: r.tenantId,
        parentEventId: r.parentEventId,
        payload: r.payload,
        error: r.error,
        durationMs: r.durationMs,
        createdAt: r.createdAt.toISOString(),
      }));
    }

    if (tab === 'agents') {
      const agentRoleFilter = params.namespace || ''; // reuse namespace param for role
      const agentStatusFilter = params.type || '';   // reuse type param for status

      const agentRows = await sql<{
        id: string;
        tenantId: string | null;
        agentRole: string;
        taskType: string;
        status: string | null;
        inputTokens: number | null;
        outputTokens: number | null;
        toolCallsCount: number | null;
        durationMs: number | null;
        costUsd: string | null;
        error: string | null;
        startedAt: Date | null;
        completedAt: Date | null;
        createdAt: Date;
      }[]>`
        SELECT atl.id, atl.tenant_id, atl.agent_role, atl.task_type,
               atl.status, atl.input_tokens, atl.output_tokens,
               atl.tool_calls_count, atl.duration_ms, atl.cost_usd,
               atl.error, atl.started_at, atl.completed_at, atl.created_at
        FROM agent_task_log atl
        WHERE atl.created_at > NOW() - ${hours + ' hours'}::interval
          ${agentRoleFilter ? sql`AND atl.agent_role = ${agentRoleFilter}` : sql``}
          ${agentStatusFilter ? sql`AND atl.status = ${agentStatusFilter}` : sql``}
          ${tenantIdFilter ? sql`AND atl.tenant_id = ${tenantIdFilter}::uuid` : sql``}
        ORDER BY atl.created_at DESC
        LIMIT ${PAGE_SIZE}
        OFFSET ${offset}
      `;

      const [agentCount] = await sql<{ n: string }[]>`
        SELECT count(*)::text AS n FROM agent_task_log atl
        WHERE atl.created_at > NOW() - ${hours + ' hours'}::interval
          ${agentRoleFilter ? sql`AND atl.agent_role = ${agentRoleFilter}` : sql``}
          ${agentStatusFilter ? sql`AND atl.status = ${agentStatusFilter}` : sql``}
          ${tenantIdFilter ? sql`AND atl.tenant_id = ${tenantIdFilter}::uuid` : sql``}
      `;
      agentTotal = parseInt(agentCount?.n ?? '0', 10);

      agentLogs = agentRows.map((r) => ({
        id: r.id,
        tenantId: r.tenantId,
        agentRole: r.agentRole,
        taskType: r.taskType,
        status: r.status,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        toolCallsCount: r.toolCallsCount,
        durationMs: r.durationMs,
        costUsd: r.costUsd ? parseFloat(r.costUsd) : null,
        error: r.error,
        startedAt: r.startedAt?.toISOString() ?? null,
        completedAt: r.completedAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
      }));
    }
  } catch (e) {
    console.error('[admin/events] query failed:', e);
  }

  const displayTotal = tab === 'agents' ? agentTotal : total;
  const displayCount = tab === 'agents' ? agentLogs.length : events.length;

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Audit Log</h1>
          <p className="text-sm text-gray-500 mt-1">
            {offset + 1}–{offset + displayCount} of {displayTotal} entries in the last{' '}
            {hours >= 24 ? `${Math.round(hours / 24)}d` : `${hours}h`}
          </p>
        </div>
        <Link href="/admin/dashboard" className="text-sm text-blue-600 hover:underline">
          Back to Dashboard
        </Link>
      </div>
      <EventStreamClient
        events={events}
        agentLogs={agentLogs}
        tenants={tenants}
        currentNamespace={nsFilter}
        currentType={typeFilter}
        currentHours={hoursParam}
        currentErrorsOnly={errorsOnly}
        currentTenantId={tenantIdFilter}
        currentTab={tab}
        currentOffset={offset}
        total={displayTotal}
        pageSize={PAGE_SIZE}
        isMasterAdmin={role === 'master_admin'}
      />
    </div>
  );
}
