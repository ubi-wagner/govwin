/**
 * ingest.trigger_manual (Phase 1 §E19).
 *
 * Master admin manually triggers an ingest run for one source.
 * High-priority (priority=1) so the dispatcher picks it up before
 * any scheduled cron jobs.
 *
 * Required role: `master_admin` — this can kick off real API calls
 * to SAM.gov / SBIR.gov / Grants.gov, so only the highest privilege
 * level can trigger.
 */

import { z } from 'zod';
import { sql } from '@/lib/db';
import { emitEventSingle } from '@/lib/events';
import { defineTool } from './base';

const InputSchema = z.object({
  source: z.enum(['sam_gov', 'sbir_gov', 'grants_gov']),
  runType: z.enum(['incremental', 'full']).default('incremental'),
});

type Input = z.infer<typeof InputSchema>;

interface Output {
  jobId: string;
  source: string;
  runType: string;
  priority: number;
}

export const ingestTriggerManualTool = defineTool<Input, Output>({
  name: 'ingest.trigger_manual',
  namespace: 'ingest',
  description:
    'Manually trigger an ingest run for one source. Inserts a high-priority pipeline_jobs row the dispatcher will consume on its next tick.',
  inputSchema: InputSchema,
  requiredRole: 'master_admin',
  tenantScoped: false,
  async handler(input, ctx) {
    const { source, runType } = input;
    const actorId = ctx.actor.id;
    const priority = 1; // high

    const rows = await sql<{ id: string }[]>`
      INSERT INTO pipeline_jobs
        (source, kind, status, priority, metadata)
      VALUES
        (${source}, 'ingest', 'pending', ${priority},
         ${JSON.stringify({ run_type: runType, triggered_by: actorId, manual: true })}::jsonb)
      RETURNING id
    `;
    const jobId = rows[0].id;

    await emitEventSingle({
      namespace: 'finder',
      type: 'ingest.manual_triggered',
      actor: { type: 'user', id: actorId, email: ctx.actor.email ?? undefined },
      payload: { jobId, source, runType, priority },
    });

    ctx.log?.info?.({
      msg: 'ingest.trigger_manual succeeded',
      source, runType, jobId, actorId,
    });

    return { jobId, source, runType, priority };
  },
});
