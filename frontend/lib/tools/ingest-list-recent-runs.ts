/**
 * ingest.list_recent_runs (Phase 1 §E20).
 *
 * Lists recent pipeline_jobs rows (kind='ingest') with their run
 * statistics from the corresponding `finder.ingest.run.end` event
 * (if one was emitted — failed jobs may not have an end event).
 *
 * Used by the /admin/system dashboard to show "last N ingest runs by
 * source" for each of sam_gov, sbir_gov, grants_gov.
 */

import { z } from 'zod';
import { sql } from '@/lib/db';
import { defineTool } from './base';

const InputSchema = z.object({
  source: z.enum(['sam_gov', 'sbir_gov', 'grants_gov']).optional(),
  limit: z.number().int().min(1).max(100).default(25),
});

type Input = z.infer<typeof InputSchema>;

interface RunRow {
  jobId: string;
  source: string;
  status: string;
  priority: number;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  result: {
    inserted?: number;
    updated?: number;
    skipped?: number;
    failed?: number;
    pages_fetched?: number;
    errors?: string[];
  } | null;
  error: string | null;
}

interface Output {
  runs: RunRow[];
}

export const ingestListRecentRunsTool = defineTool<Input, Output>({
  name: 'ingest.list_recent_runs',
  namespace: 'ingest',
  description:
    'Recent pipeline_jobs (kind=ingest) with run statistics. Used by the admin system dashboard.',
  inputSchema: InputSchema,
  requiredRole: 'master_admin',
  tenantScoped: false,
  async handler(input, ctx) {
    const source = input.source ?? null;
    type Row = {
      jobId: string;
      source: string;
      status: string;
      priority: number;
      createdAt: Date;
      startedAt: Date | null;
      completedAt: Date | null;
      result: Record<string, unknown> | null;
      error: string | null;
    };
    const rows = await sql<Row[]>`
      SELECT id AS job_id, source, status, priority, created_at,
             started_at, completed_at, result, error
      FROM pipeline_jobs
      WHERE kind = 'ingest'
        AND (${source}::text IS NULL OR source = ${source})
      ORDER BY created_at DESC
      LIMIT ${input.limit}
    `;

    const runs: RunRow[] = rows.map((r) => ({
      jobId: r.jobId,
      source: r.source,
      status: r.status,
      priority: r.priority,
      createdAt: r.createdAt.toISOString(),
      startedAt: r.startedAt ? r.startedAt.toISOString() : null,
      completedAt: r.completedAt ? r.completedAt.toISOString() : null,
      durationMs:
        r.startedAt && r.completedAt
          ? r.completedAt.getTime() - r.startedAt.getTime()
          : null,
      result: r.result as RunRow['result'],
      error: r.error,
    }));

    ctx.log?.info?.({
      msg: 'ingest.list_recent_runs returned',
      count: runs.length,
      source,
    });

    return { runs };
  },
});
