import { sql } from './db';

export async function requestAgentTask(params: {
  tenantId: string;
  agentRole: string;
  taskType: string;
  input: Record<string, unknown>;
  proposalId?: string;
  sectionId?: string;
}) {
  try {
    // input is a jsonb column — write via sql.json so it lands as a real jsonb OBJECT
    // (not a jsonb string). JSON.stringify(x) double-encodes it as a string, making
    // input->>'key' return null for SQL-side reads/analytics (CLAUDE.md jsonb bug-class).
    // The pipeline reads both forms, so this is a safe correctness fix.
    const [task] = await sql`
      INSERT INTO agent_task_queue (tenant_id, agent_role, task_type, input, proposal_id, section_id)
      VALUES (${params.tenantId}, ${params.agentRole}, ${params.taskType}, ${sql.json(params.input as Parameters<typeof sql.json>[0])}, ${params.proposalId ?? null}, ${params.sectionId ?? null})
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
