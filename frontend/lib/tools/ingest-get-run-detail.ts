/**
 * ingest.get_run_detail (Phase 1 §E21).
 *
 * Detail view of a single ingest run: the pipeline_jobs row + its
 * related system_events (run.start, run.end, per-opportunity events).
 */

import { z } from 'zod';
import { sql } from '@/lib/db';
import { NotFoundError } from '@/lib/errors';
import { defineTool } from './base';

const InputSchema = z.object({
  jobId: z.string().uuid(),
});

type Input = z.infer<typeof InputSchema>;

interface SystemEvent {
  id: string;
  namespace: string;
  type: string;
  phase: string;
  actorType: string;
  actorId: string;
  payload: Record<string, unknown> | null;
  createdAt: string;
}

interface Output {
  job: {
    id: string;
    source: string;
    kind: string;
    status: string;
    priority: number;
    createdAt: string;
    startedAt: string | null;
    completedAt: string | null;
    result: Record<string, unknown> | null;
    error: string | null;
    metadata: Record<string, unknown> | null;
  };
  events: SystemEvent[];
}

export const ingestGetRunDetailTool = defineTool<Input, Output>({
  name: 'ingest.get_run_detail',
  namespace: 'ingest',
  description:
    'Fetch one pipeline_jobs row + its related system_events (run.start, run.end, per-opportunity).',
  inputSchema: InputSchema,
  requiredRole: 'master_admin',
  tenantScoped: false,
  async handler(input, ctx) {
    const { jobId } = input;

    const jobRows = await sql<
      {
        id: string;
        source: string;
        kind: string;
        status: string;
        priority: number;
        createdAt: Date;
        startedAt: Date | null;
        completedAt: Date | null;
        result: Record<string, unknown> | null;
        error: string | null;
        metadata: Record<string, unknown> | null;
      }[]
    >`
      SELECT id, source, kind, status, priority, created_at, started_at,
             completed_at, result, error, metadata
      FROM pipeline_jobs
      WHERE id = ${jobId}::uuid
    `;

    if (jobRows.length === 0) {
      throw new NotFoundError(`pipeline_jobs not found: ${jobId}`);
    }
    const j = jobRows[0];

    // Fetch all system_events related to this job. We tag events via
    // metadata/payload rather than a FK, so filter by payload->job_id
    // or payload->source/created_at proximity. For this tool we pull
    // finder.ingest.* events that started after the job's started_at.
    type EventRow = {
      id: string;
      namespace: string;
      type: string;
      phase: string;
      actorType: string;
      actorId: string;
      payload: Record<string, unknown> | null;
      createdAt: Date;
    };
    const eventRows = await sql<EventRow[]>`
      SELECT id, namespace, type, phase, actor_type, actor_id, payload, created_at
      FROM system_events
      WHERE namespace = 'finder'
        AND type LIKE 'ingest.%'
        AND created_at >= ${j.startedAt ?? j.createdAt}
        AND (${j.completedAt}::timestamptz IS NULL
             OR created_at <= ${j.completedAt}::timestamptz + INTERVAL '5 seconds')
      ORDER BY created_at ASC
      LIMIT 500
    `;

    const events: SystemEvent[] = eventRows.map((e) => ({
      id: e.id,
      namespace: e.namespace,
      type: e.type,
      phase: e.phase,
      actorType: e.actorType,
      actorId: e.actorId,
      payload: e.payload,
      createdAt: e.createdAt.toISOString(),
    }));

    ctx.log?.info?.({
      msg: 'ingest.get_run_detail resolved',
      jobId,
      eventCount: events.length,
    });

    return {
      job: {
        id: j.id,
        source: j.source,
        kind: j.kind,
        status: j.status,
        priority: j.priority,
        createdAt: j.createdAt.toISOString(),
        startedAt: j.startedAt ? j.startedAt.toISOString() : null,
        completedAt: j.completedAt ? j.completedAt.toISOString() : null,
        result: j.result,
        error: j.error,
        metadata: j.metadata,
      },
      events,
    };
  },
});
