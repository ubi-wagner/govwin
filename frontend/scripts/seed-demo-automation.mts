/**
 * Seed a few clean automation firings (#107) so the admin Automation surface shows
 * real recent executions and the created ToDos land in the admin queue. Emits
 * matching single events through the real emitEventSingle path — the automation
 * evaluator fires the rules (create_todo / notify_admin) exactly as in production.
 */
import { emitEventSingle, systemActor } from '@/lib/events';
import { sql } from '@/lib/db';

try {
  const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int n FROM automation_log`;
  if (n > 0) {
    console.log(`automation_log already has ${n} rows — skipping seed.`);
  } else {
    // capture.topic.pinned → notify_admin ; capture.application.submitted → create_todo + notify_admin
    await emitEventSingle({ namespace: 'capture', type: 'topic.pinned', actor: systemActor(), tenantId: null,
      payload: { company_name: 'Immobileyes', topic_code: 'DON26BX03-NP002' } });
    await emitEventSingle({ namespace: 'capture', type: 'application.submitted', actor: systemActor(), tenantId: null,
      payload: { company_name: 'Beacon Labs' } });
    console.log('emitted 2 matching events');
  }
  const [{ fired }] = await sql<{ fired: number }[]>`SELECT count(*)::int fired FROM automation_log`;
  const [{ todos }] = await sql<{ todos: number }[]>`SELECT count(*)::int todos FROM tasks WHERE (params->>'automated')='true' AND status='open'`;
  console.log(`automation_log: ${fired} · automated open ToDos: ${todos}`);
} finally {
  await sql.end();
}
