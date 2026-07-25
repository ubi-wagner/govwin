import { auth } from '@/auth';
import { redirect } from 'next/navigation';
// Admin cross-tenant console page — reads span tenants, so use the owner (BYPASSRLS) pool. (docs/RLS_CUTOVER.md)
import { sqlBypass as sql } from '@/lib/db';
import Link from 'next/link';
import { SystemStateClient } from './system-state-client';

export const dynamic = 'force-dynamic';

// ─── Exported types (shared with client) ──────────────────────────────

export type HealthSummary = {
  activeWorkflows: number;
  pendingJobs: number;
  eventsLastHour: number;
  eventsLast24h: number;
  activeAutomationRules: number;
  errorsLastHour: number;
};

export type ActiveWorkflow = {
  id: string;
  workflowName: string;
  status: string;
  currentStep: string | null;
  currentStepIndex: number;
  stepStatus: Record<string, string>;
  stepResults: Record<string, unknown>;
  startedAt: string | null;
  completedAt: string | null;
  tenantId: string | null;
  triggerEventId: string | null;
  source: string;
  retryCount: number;
  lastError: string | null;
  payload: Record<string, unknown> | null;
  createdAt: string;
};

export type PipelineState = {
  lastRunBySource: { source: string; lastRun: string; count: number }[];
  curationCounts: { status: string; count: number }[];
  proposalCounts: { stage: string; count: number }[];
};

export type EventTreeNode = {
  id: string;
  namespace: string;
  type: string;
  phase: string;
  tenantId: string | null;
  actorType: string | null;
  actorEmail: string | null;
  payload: Record<string, unknown> | null;
  error: Record<string, unknown> | null;
  durationMs: number | null;
  createdAt: string;
  children: EventTreeNode[];
};

export type ErrorEvent = {
  id: string;
  namespace: string;
  type: string;
  error: Record<string, unknown> | null;
  tenantId: string | null;
  actorEmail: string | null;
  createdAt: string;
};

export type EventVolumeRow = {
  hour: string;
  namespace: string;
  count: number;
};

export type ContentPipelineData = {
  blocksByStatus: { status: string; count: number }[];
  pendingByPage: { page: string; pendingCount: number }[];
  recentEvents: {
    id: string;
    type: string;
    phase: string;
    payload: Record<string, unknown> | null;
    createdAt: string;
    page: string | null;
    blocksPublished: string | null;
    publishedBy: string | null;
    submittedBy: string | null;
  }[];
};

export type AutomationLogEntry = {
  id: string;
  ruleId: string;
  actionType: string;
  status: string;
  result: unknown;
  errorMessage: string | null;
  executedAt: string;
  ruleName: string;
  triggerNamespace: string;
  triggerType: string;
};

export type EmailAutomationData = {
  automationLogs: AutomationLogEntry[];
  emailEvents: {
    id: string;
    type: string;
    phase: string;
    payload: Record<string, unknown> | null;
    createdAt: string;
  }[];
};

// ─── Row types for SQL queries ────────────────────────────────────────

type HealthRow = {
  activeWorkflows: number;
  pendingJobs: number;
  eventsLastHour: number;
  eventsLast24h: number;
  activeRules: number;
  errorsLastHour: number;
};

type WorkflowRow = {
  id: string;
  workflowName: string;
  status: string;
  currentStep: string | null;
  currentStepIndex: number;
  stepStatus: Record<string, string> | null;
  stepResults: Record<string, unknown> | null;
  startedAt: Date | null;
  completedAt: Date | null;
  tenantId: string | null;
  triggerEventId: string | null;
  source: string;
  retryCount: number;
  lastError: string | null;
  payload: Record<string, unknown> | null;
  createdAt: Date;
};

type SourceRow = { source: string; lastRun: Date; count: number };
type CountByStatus = { status: string; count: number };
type CountByStage = { stage: string; count: number };

type EventRow = {
  id: string;
  namespace: string;
  type: string;
  phase: string;
  tenantId: string | null;
  actorType: string | null;
  actorEmail: string | null;
  payload: Record<string, unknown> | null;
  error: Record<string, unknown> | null;
  durationMs: number | null;
  createdAt: Date;
};

type EventChildRow = EventRow & { parentEventId: string };

type ErrorRow = {
  id: string;
  namespace: string;
  type: string;
  error: Record<string, unknown> | null;
  tenantId: string | null;
  actorEmail: string | null;
  createdAt: Date;
};

type VolumeRow = { hour: Date; namespace: string; count: number };

type ContentEventRow = {
  id: string;
  type: string;
  phase: string;
  payload: Record<string, unknown> | null;
  createdAt: Date;
  page: string | null;
  blocksPublished: string | null;
  publishedBy: string | null;
  submittedBy: string | null;
};

type BlockStatusRow = { status: string; count: number };
type PendingPageRow = { page: string; pendingCount: number };

type AutomationLogRow = {
  id: string;
  ruleId: string;
  actionType: string;
  status: string;
  result: unknown;
  errorMessage: string | null;
  executedAt: Date;
  ruleName: string;
  triggerNamespace: string;
  triggerType: string;
};

type EmailEventRow = {
  id: string;
  type: string;
  phase: string;
  payload: Record<string, unknown> | null;
  createdAt: Date;
};

// ─── Helpers ──────────────────────────────────────────────────────────

function mapWorkflowRow(r: WorkflowRow): ActiveWorkflow {
  return {
    id: r.id,
    workflowName: r.workflowName,
    status: r.status,
    currentStep: r.currentStep,
    currentStepIndex: r.currentStepIndex ?? 0,
    stepStatus: r.stepStatus ?? {},
    stepResults: r.stepResults ?? {},
    startedAt: r.startedAt ? r.startedAt.toISOString() : null,
    completedAt: r.completedAt ? r.completedAt.toISOString() : null,
    tenantId: r.tenantId,
    triggerEventId: r.triggerEventId,
    source: r.source ?? 'pipeline',
    retryCount: r.retryCount ?? 0,
    lastError: r.lastError,
    payload: r.payload,
    createdAt: r.createdAt.toISOString(),
  };
}

function serializeTreeNode(row: EventRow, children: EventTreeNode[]): EventTreeNode {
  return {
    id: row.id,
    namespace: row.namespace,
    type: row.type,
    phase: row.phase,
    tenantId: row.tenantId,
    actorType: row.actorType,
    actorEmail: row.actorEmail,
    payload: row.payload,
    error: row.error,
    durationMs: row.durationMs ? Number(row.durationMs) : null,
    createdAt: row.createdAt.toISOString(),
    children,
  };
}

// ─── Data fetching ────────────────────────────────────────────────────

async function fetchHealthSummary(): Promise<HealthSummary> {
  const defaults: HealthSummary = {
    activeWorkflows: 0,
    pendingJobs: 0,
    eventsLastHour: 0,
    eventsLast24h: 0,
    activeAutomationRules: 0,
    errorsLastHour: 0,
  };

  try {
    const rows = await sql<HealthRow[]>`
      SELECT
        (SELECT COUNT(*) FROM process_instances WHERE status IN ('running', 'pending', 'retrying')) AS active_workflows,
        (SELECT COUNT(*) FROM pipeline_jobs WHERE status IN ('pending', 'running')) AS pending_jobs,
        (SELECT COUNT(*) FROM system_events WHERE created_at > NOW() - INTERVAL '1 hour') AS events_last_hour,
        (SELECT COUNT(*) FROM system_events WHERE created_at > NOW() - INTERVAL '24 hours') AS events_last_24h,
        (SELECT COUNT(*) FROM automation_rules WHERE is_active = true) AS active_rules,
        (SELECT COUNT(*) FROM system_events WHERE error IS NOT NULL AND created_at > NOW() - INTERVAL '1 hour') AS errors_last_hour
    `;
    const row = rows[0];
    if (row) {
      return {
        activeWorkflows: Number(row.activeWorkflows) || 0,
        pendingJobs: Number(row.pendingJobs) || 0,
        eventsLastHour: Number(row.eventsLastHour) || 0,
        eventsLast24h: Number(row.eventsLast24h) || 0,
        activeAutomationRules: Number(row.activeRules) || 0,
        errorsLastHour: Number(row.errorsLastHour) || 0,
      };
    }
  } catch (e) {
    console.error('[admin/system-state] health summary query failed:', e);
  }
  return defaults;
}

async function fetchActiveWorkflows(): Promise<ActiveWorkflow[]> {
  try {
    const rows = await sql<WorkflowRow[]>`
      SELECT id, workflow_name, status, current_step, current_step_index,
             step_status, step_results, started_at, completed_at,
             tenant_id, trigger_event_id, source, retry_count, last_error,
             payload, created_at
      FROM process_instances
      WHERE status NOT IN ('completed', 'cancelled', 'failed')
      ORDER BY created_at DESC
      LIMIT 50
    `;
    return rows.map(mapWorkflowRow);
  } catch (e) {
    console.error('[admin/system-state] active workflows query failed:', e);
    return [];
  }
}

async function fetchPipelineState(): Promise<PipelineState> {
  const state: PipelineState = {
    lastRunBySource: [],
    curationCounts: [],
    proposalCounts: [],
  };

  try {
    const sourceRows = await sql<SourceRow[]>`
      SELECT source, MAX(completed_at) AS last_run, COUNT(*) AS count
      FROM pipeline_jobs
      WHERE status = 'completed'
      GROUP BY source
      ORDER BY last_run DESC NULLS LAST
    `;
    state.lastRunBySource = sourceRows.map((r: SourceRow) => ({
      source: r.source,
      lastRun: r.lastRun ? r.lastRun.toISOString() : '',
      count: Number(r.count) || 0,
    }));
  } catch (e) {
    console.error('[admin/system-state] pipeline source query failed:', e);
  }

  try {
    const curationRows = await sql<CountByStatus[]>`
      SELECT status, COUNT(*) AS count
      FROM curated_solicitations
      GROUP BY status
      ORDER BY count DESC
    `;
    state.curationCounts = curationRows.map((r: CountByStatus) => ({
      status: r.status,
      count: Number(r.count) || 0,
    }));
  } catch (e) {
    console.error('[admin/system-state] curation counts query failed:', e);
  }

  try {
    const proposalRows = await sql<CountByStage[]>`
      SELECT stage, COUNT(*) AS count
      FROM proposals
      GROUP BY stage
      ORDER BY count DESC
    `;
    state.proposalCounts = proposalRows.map((r: CountByStage) => ({
      stage: r.stage,
      count: Number(r.count) || 0,
    }));
  } catch (e) {
    console.error('[admin/system-state] proposal counts query failed:', e);
  }

  return state;
}

async function fetchEventTrees(): Promise<EventTreeNode[]> {
  try {
    // Fetch top-level start events (no parent)
    const topLevel = await sql<EventRow[]>`
      SELECT id, namespace, type, phase, tenant_id, actor_type, actor_email,
             payload, error, duration_ms, created_at
      FROM system_events
      WHERE phase = 'start' AND parent_event_id IS NULL
        AND created_at > NOW() - INTERVAL '24 hours'
      ORDER BY created_at DESC
      LIMIT 50
    `;

    if (topLevel.length === 0) return [];

    // Collect all top-level IDs
    const topIds = topLevel.map((r: EventRow) => r.id);

    // Fetch all children of these top-level events (one level deep)
    const children = await sql<EventChildRow[]>`
      SELECT id, namespace, type, phase, tenant_id, actor_type, actor_email,
             payload, error, duration_ms, parent_event_id, created_at
      FROM system_events
      WHERE parent_event_id = ANY(${topIds})
      ORDER BY created_at ASC
    `;

    // Group children by parent
    const childrenByParent = new Map<string, EventChildRow[]>();
    for (const c of children) {
      const parentId = c.parentEventId;
      if (!childrenByParent.has(parentId)) {
        childrenByParent.set(parentId, []);
      }
      childrenByParent.get(parentId)!.push(c);
    }

    // Also fetch grandchildren (second level deep)
    const childIds = children.map((c: EventChildRow) => c.id);
    let grandchildren: EventChildRow[] = [];
    if (childIds.length > 0) {
      try {
        grandchildren = await sql<EventChildRow[]>`
          SELECT id, namespace, type, phase, tenant_id, actor_type, actor_email,
                 payload, error, duration_ms, parent_event_id, created_at
          FROM system_events
          WHERE parent_event_id = ANY(${childIds})
          ORDER BY created_at ASC
        `;
      } catch (e) {
        console.error('[admin/system-state] grandchildren query failed:', e);
      }
    }

    const grandchildrenByParent = new Map<string, EventChildRow[]>();
    for (const gc of grandchildren) {
      const parentId = gc.parentEventId;
      if (!grandchildrenByParent.has(parentId)) {
        grandchildrenByParent.set(parentId, []);
      }
      grandchildrenByParent.get(parentId)!.push(gc);
    }

    // Build trees
    return topLevel.map((t: EventRow) => {
      const nodeChildren = (childrenByParent.get(t.id) || []).map((c: EventChildRow) => {
        const gcNodes = (grandchildrenByParent.get(c.id) || []).map((gc: EventChildRow) =>
          serializeTreeNode(gc, []),
        );
        return serializeTreeNode(c, gcNodes);
      });
      return serializeTreeNode(t, nodeChildren);
    });
  } catch (e) {
    console.error('[admin/system-state] event trees query failed:', e);
    return [];
  }
}

async function fetchRecentErrors(): Promise<ErrorEvent[]> {
  try {
    const rows = await sql<ErrorRow[]>`
      SELECT id, namespace, type, error, tenant_id, actor_email, created_at
      FROM system_events
      WHERE error IS NOT NULL
      ORDER BY created_at DESC
      LIMIT 20
    `;
    return rows.map((r: ErrorRow) => ({
      id: r.id,
      namespace: r.namespace,
      type: r.type,
      error: r.error,
      tenantId: r.tenantId,
      actorEmail: r.actorEmail,
      createdAt: r.createdAt.toISOString(),
    }));
  } catch (e) {
    console.error('[admin/system-state] recent errors query failed:', e);
    return [];
  }
}

async function fetchEventVolume(): Promise<EventVolumeRow[]> {
  try {
    const rows = await sql<VolumeRow[]>`
      SELECT date_trunc('hour', created_at) AS hour, namespace, COUNT(*) AS count
      FROM system_events
      WHERE created_at > NOW() - INTERVAL '24 hours'
      GROUP BY 1, 2
      ORDER BY 1
    `;
    return rows.map((r: VolumeRow) => ({
      hour: r.hour.toISOString(),
      namespace: r.namespace,
      count: Number(r.count) || 0,
    }));
  } catch (e) {
    console.error('[admin/system-state] event volume query failed:', e);
    return [];
  }
}

// ─── Content Pipeline data fetching ──────────────────────────────────

async function fetchContentPipeline(): Promise<ContentPipelineData> {
  const data: ContentPipelineData = {
    blocksByStatus: [],
    pendingByPage: [],
    recentEvents: [],
  };

  try {
    const statusRows = await sql<BlockStatusRow[]>`
      SELECT status, COUNT(*)::int AS count
      FROM cms_content
      WHERE content_type = 'page_block'
      GROUP BY status
    `;
    data.blocksByStatus = statusRows.map((r: BlockStatusRow) => ({
      status: r.status,
      count: Number(r.count) || 0,
    }));
  } catch (e) {
    console.error('[admin/system-state] content blocks by status query failed:', e);
  }

  try {
    const pendingRows = await sql<PendingPageRow[]>`
      SELECT tags[1] AS page, COUNT(*)::int AS pending_count
      FROM cms_content
      WHERE content_type = 'page_block' AND status = 'pending'
      GROUP BY tags[1]
    `;
    data.pendingByPage = pendingRows.map((r: PendingPageRow) => ({
      page: r.page ?? 'unknown',
      pendingCount: Number(r.pendingCount) || 0,
    }));
  } catch (e) {
    console.error('[admin/system-state] content pending by page query failed:', e);
  }

  try {
    const eventRows = await sql<ContentEventRow[]>`
      SELECT id, type, phase, payload, created_at,
             payload->>'page' AS page,
             COALESCE(payload->>'blocksPublished', payload->>'publishedCount') AS blocks_published,
             COALESCE(payload->>'publishedBy', payload->>'draftedBy') AS published_by,
             COALESCE(payload->>'submittedBy', payload->>'submittedCount') AS submitted_by
      FROM system_events
      WHERE namespace = 'system'
        AND type IN (
              -- legacy Next.js editor (removed; historical events retained)
              'content.submitted_for_review', 'content.approved', 'content.rejected',
              'content.page_published', 'content.drafts_saved',
              -- new CMS SPA editor (/pages → FastAPI page_blocks)
              'content.page_blocks_submitted', 'content.page_blocks_approved',
              'content.page_blocks_rejected', 'content.page_blocks_published',
              'content.page_blocks_updated', 'content.page_block_created',
              'content.page_block_deleted', 'content.page_blocks_reordered',
              -- AI (shared)
              'content.ai_generation_completed', 'content.ai_revision_completed')
        AND created_at > now() - interval '7 days'
      ORDER BY created_at DESC
      LIMIT 50
    `;
    data.recentEvents = eventRows.map((r: ContentEventRow) => ({
      id: r.id,
      type: r.type,
      phase: r.phase,
      payload: r.payload,
      createdAt: r.createdAt.toISOString(),
      page: r.page,
      blocksPublished: r.blocksPublished,
      publishedBy: r.publishedBy,
      submittedBy: r.submittedBy,
    }));
  } catch (e) {
    console.error('[admin/system-state] content events query failed:', e);
  }

  return data;
}

// ─── Email Automation data fetching ─────────────────────────────────

async function fetchEmailAutomation(): Promise<EmailAutomationData> {
  const data: EmailAutomationData = {
    automationLogs: [],
    emailEvents: [],
  };

  try {
    const logRows = await sql<AutomationLogRow[]>`
      SELECT al.id, al.rule_id, al.action_type, al.status, al.result, al.error_message, al.executed_at,
             ar.name AS rule_name, ar.trigger_namespace, ar.trigger_type
      FROM automation_log al
      JOIN automation_rules ar ON ar.id = al.rule_id
      ORDER BY al.executed_at DESC
      LIMIT 50
    `;
    data.automationLogs = logRows.map((r: AutomationLogRow) => ({
      id: r.id,
      ruleId: r.ruleId,
      actionType: r.actionType,
      status: r.status,
      result: r.result,
      errorMessage: r.errorMessage,
      executedAt: r.executedAt.toISOString(),
      ruleName: r.ruleName,
      triggerNamespace: r.triggerNamespace,
      triggerType: r.triggerType,
    }));
  } catch (e) {
    console.error('[admin/system-state] automation log query failed:', e);
  }

  try {
    const eventRows = await sql<EmailEventRow[]>`
      SELECT id, type, phase, payload, created_at
      FROM system_events
      WHERE namespace = 'system'
        AND type IN ('email.sent', 'email.approved', 'email.rejected', 'email.claimed',
                     'action.send_email', 'action.notify_admin', 'action.enroll_drip')
        AND created_at > now() - interval '7 days'
      ORDER BY created_at DESC
      LIMIT 50
    `;
    data.emailEvents = eventRows.map((r: EmailEventRow) => ({
      id: r.id,
      type: r.type,
      phase: r.phase,
      payload: r.payload,
      createdAt: r.createdAt.toISOString(),
    }));
  } catch (e) {
    console.error('[admin/system-state] email events query failed:', e);
  }

  return data;
}

// ─── Page component ───────────────────────────────────────────────────

export default async function SystemStatePage() {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const role = (session.user as { role?: string }).role;
  if (role !== 'rfp_admin' && role !== 'master_admin') {
    redirect('/');
  }

  // Fetch all data in parallel
  const [health, activeWorkflows, pipelineState, eventTrees, recentErrors, eventVolume, contentPipeline, emailAutomation] =
    await Promise.all([
      fetchHealthSummary(),
      fetchActiveWorkflows(),
      fetchPipelineState(),
      fetchEventTrees(),
      fetchRecentErrors(),
      fetchEventVolume(),
      fetchContentPipeline(),
      fetchEmailAutomation(),
    ]);

  return (
    <div className="max-w-7xl mx-auto">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">System State</h1>
          <p className="text-sm text-gray-500 mt-1">
            Real-time view of all active workflows, processes, and events
          </p>
        </div>
        <div className="flex items-center gap-4">
          <Link href="/admin/workflows" className="text-sm text-blue-600 hover:underline">
            Workflow Monitor
          </Link>
          <Link href="/admin/events" className="text-sm text-blue-600 hover:underline">
            Event Stream
          </Link>
          <Link href="/admin/dashboard" className="text-sm text-blue-600 hover:underline">
            Dashboard
          </Link>
        </div>
      </div>
      <SystemStateClient
        health={health}
        activeWorkflows={activeWorkflows}
        pipelineState={pipelineState}
        eventTrees={eventTrees}
        recentErrors={recentErrors}
        eventVolume={eventVolume}
        contentPipeline={contentPipeline}
        emailAutomation={emailAutomation}
      />
    </div>
  );
}
