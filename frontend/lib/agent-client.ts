import { sql } from './db';

export async function requestAgentTask(params: {
  tenantId: string;
  agentRole: string;
  taskType: string;
  input: Record<string, unknown>;
  proposalId?: string;
  sectionId?: string;
  /**
   * Which rung of the canvas scope ladder this task addresses (mig 207).
   *
   * OMITTED MEANS WHOLE SECTION, and both columns stay NULL — so a caller that does not scope
   * writes exactly the row it wrote before the columns existed. That is the compatibility
   * guarantee, not a convenience: the section fan-out is a live path and its rows must not shift
   * under it. An explicit 'section' IS recorded, because a deliberate choice is worth keeping.
   */
  scopeLevel?: 'node' | 'group' | 'section' | 'pages' | 'document';
  scopeRef?: object | null;
  /**
   * WHO ASKED (mig 251). Omitted means nothing human did — a schedule, or a workflow step advancing
   * itself — and that is a real answer, deliberately not filled with a service account: automated
   * work must stay distinguishable from a person's.
   *
   * It matters because the reaper (P4) can now say which task was abandoned and for which customer,
   * and without this still cannot say whose action it was — leaving the one person who could decide
   * whether to re-run it unnamed. `sourceTaskId` is the other half: it reconnects an abandoned agent
   * task to the ToDo still sitting in somebody's queue waiting on it.
   */
  requestedBy?: string | null;
  sourceTaskId?: string | null;
}) {
  try {
    // input is a jsonb column — write via sql.json so it lands as a real jsonb OBJECT
    // (not a jsonb string). JSON.stringify(x) double-encodes it as a string, making
    // input->>'key' return null for SQL-side reads/analytics (CLAUDE.md jsonb bug-class).
    // The pipeline reads both forms, so this is a safe correctness fix.
    const [task] = await sql`
      INSERT INTO agent_task_queue (tenant_id, agent_role, task_type, input, proposal_id, section_id, scope_level, scope_ref, requested_by, source_task_id)
      VALUES (${params.tenantId}, ${params.agentRole}, ${params.taskType}, ${sql.json(params.input as Parameters<typeof sql.json>[0])}, ${params.proposalId ?? null}, ${params.sectionId ?? null},
              ${params.scopeLevel ?? null},
              ${params.scopeRef ? sql.json(params.scopeRef as Parameters<typeof sql.json>[0]) : null},
              ${params.requestedBy ?? null}, ${params.sourceTaskId ?? null})
      RETURNING id
    `;
    return task?.id ?? null;
  } catch (e) {
    console.error('[agentClient] Error queuing task:', e);
    return null;
  }
}

export async function getAgentTaskResult(taskId: string) {
  try {
    const [result] = await sql`SELECT * FROM agent_task_results WHERE task_id = ${taskId}`;
    return result ?? null;
  } catch (e) {
    console.error('[agentClient] Error reading result:', e);
    return null;
  }
}
