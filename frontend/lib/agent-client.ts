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
    const [task] = await sql`
      INSERT INTO agent_task_queue (tenant_id, agent_role, task_type, input, proposal_id, section_id)
      VALUES (${params.tenantId}, ${params.agentRole}, ${params.taskType}, ${JSON.stringify(params.input)}, ${params.proposalId ?? null}, ${params.sectionId ?? null})
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
