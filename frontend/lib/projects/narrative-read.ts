/**
 * Reading back a drafted status narrative — ONE implementation.
 *
 * Both the API route and the server-rendered workspace need this, and both need the fidelity check
 * that goes with it. A copy on the page would eventually disagree with the copy in the route about
 * which figures are permitted, and the disagreement would surface as a draft the page offered and
 * the route refused.
 */
import { sql } from '@/lib/db';
import { coerceJsonb } from '@/lib/jsonb';
import { statusReportInput } from './status-report-data';
import { checkNarrativeFidelity, allowedFigures } from './narrative-fidelity';

export interface DraftedNarrative {
  status: 'ready' | 'rejected' | 'none' | 'empty';
  paragraphs?: string[];
  invented?: string[];
  note?: string;
  figuresChecked?: number;
  draftedAt?: string;
}

export async function readDraftedNarrative(
  tenantId: string,
  projectId: string,
): Promise<DraftedNarrative> {
  try {
    // The workflow's own step result — NOT `agent.invoked`, which is a telemetry record carrying
    // neither the output nor a projectId.
    const [row] = await sql<{ steps: unknown; createdAt: string }[]>`
      SELECT step_results AS steps, created_at FROM process_instances
       WHERE workflow_name = 'OnStatusNarrativeRequested'
         AND payload->>'projectId' = ${projectId}
         AND tenant_id = ${tenantId}::uuid
       ORDER BY created_at DESC LIMIT 1`;
    if (!row) return { status: 'none' };

    const steps = coerceJsonb<Record<string, unknown>>(row.steps, {});
    const step = coerceJsonb<Record<string, unknown>>(steps.ai_status_narrator, {});
    const inner = coerceJsonb<Record<string, unknown>>(
      coerceJsonb<Record<string, unknown>>(step.result, {}).result, {},
    );
    const calls = Array.isArray(inner.tool_results) ? inner.tool_results : [];
    const emitted = calls.find(
      (c) => (c as Record<string, unknown>)?.tool === 'emit_narrative',
    ) as Record<string, unknown> | undefined;
    const narrative = coerceJsonb<{ paragraphs?: string[] }>(
      (emitted?.output as Record<string, unknown> | undefined)?.narrative, {},
    );
    const paragraphs = Array.isArray(narrative.paragraphs) ? narrative.paragraphs.map(String) : [];
    if (paragraphs.length === 0) return { status: 'empty' };

    // THE GATE. Recomputed from the same source the deterministic report is built from.
    const facts = await statusReportInput(tenantId, projectId, {
      title: '', projectName: '', periodStart: null, periodEnd: null,
      asAt: new Date().toISOString().slice(0, 10),
    });
    const allowed = allowedFigures(facts.rollup, facts.billing, facts.risks, facts.upcoming, {
      done: facts.tasksDone, open: facts.tasksOpen, blocked: facts.tasksBlocked,
    });
    const check = checkNarrativeFidelity(paragraphs.join('\n\n'), allowed);

    if (!check.ok) {
      return {
        status: 'rejected',
        invented: check.invented,
        note: `The draft was not offered: it states ${check.invented.join(', ')}, which the system `
          + 'did not compute. Ask again, or write the paragraph yourself.',
      };
    }
    return {
      status: 'ready', paragraphs, figuresChecked: check.checked, draftedAt: row.createdAt,
    };
  } catch (err) {
    console.error('[projects/narrative-read] failed:', err);
    // 'none', not a throw: a page that 500s because a draft could not be read is worse than one
    // that says there is no draft.
    return { status: 'none' };
  }
}
