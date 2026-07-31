/**
 * Drive-test P5.3 — offerStarterSet onboarding offer. 3 real-DB scenarios against
 * the immobileyes tenant (eric = tenant_admin):
 *   1) fresh   → creates a tenant_admin acknowledge ToDo (href → /atoms) + emits
 *                library:starter_set.offered exactly once
 *   2) idempotent → re-run returns alreadyOffered, no duplicate task, no 2nd event
 *   3) surfaces → the offer shows up in the tenant_admin's open-task queue
 * NODE_ENV=test so the emit path doesn't fire live automation rules. Self-cleaning.
 */
import { sql } from '@/lib/db';
import { offerStarterSet, STARTER_OFFER_TASK_TYPE } from '@/lib/library/starter-offer';
import { listOpenTasksForActor } from '@/lib/tasks/tasks';

const TENANT = process.env.TEST_TENANT_ID ?? 'dd831b77-2d6b-4b53-bb18-4d48569a2258'; // immobileyes
const ADMIN = process.env.TEST_ACTOR_ID ?? 'c9703126-dbb4-42f6-8e13-88b3333bc35d';   // eric (tenant_admin)
const SLUG = process.env.TEST_TENANT_SLUG ?? 'immobileyes';

const cleanup = async () => {
  await sql`DELETE FROM tasks WHERE tenant_id = ${TENANT}::uuid AND task_type = ${STARTER_OFFER_TASK_TYPE}`;
  await sql`DELETE FROM system_events WHERE namespace = 'library' AND type = 'starter_set.offered' AND tenant_id = ${TENANT}::uuid`;
};
const eventCount = async (): Promise<number> => {
  const [{ n }] = await sql<Array<{ n: number }>>`
    SELECT count(*)::int AS n FROM system_events
    WHERE namespace = 'library' AND type = 'starter_set.offered' AND tenant_id = ${TENANT}::uuid`;
  return n;
};
const taskCount = async (): Promise<number> => {
  const [{ n }] = await sql<Array<{ n: number }>>`
    SELECT count(*)::int AS n FROM tasks WHERE tenant_id = ${TENANT}::uuid AND task_type = ${STARTER_OFFER_TASK_TYPE}`;
  return n;
};

async function main() {
  await cleanup();
  const actor = { id: ADMIN, email: 'eric@immobileyes.com', role: 'rfp_admin' as const, tenantId: null };

  // 1) fresh offer
  const r1 = await offerStarterSet({ tenantId: TENANT, tenantSlug: SLUG, adminUserId: ADMIN, actor });
  const [task] = await sql<Array<{ assigneeRole: string; status: string; params: { kind?: string; href?: string } }>>`
    SELECT assignee_role, status, params FROM tasks WHERE id = ${r1.taskId}::uuid`;
  const s1 = r1.offered && !r1.alreadyOffered && !!task
    && task.assigneeRole === 'tenant_admin' && task.status === 'open'
    && task.params?.kind === 'acknowledge' && task.params?.href === `/portal/${SLUG}/atoms`
    && (await eventCount()) === 1;
  console.log(`1 fresh     : offered=${r1.offered} role=${task?.assigneeRole} kind=${task?.params?.kind} href=${task?.params?.href} events=${await eventCount()}  ${s1 ? '✅' : '❌'}`);

  // 2) idempotent re-run
  const r2 = await offerStarterSet({ tenantId: TENANT, tenantSlug: SLUG, adminUserId: ADMIN, actor });
  const s2 = !r2.offered && r2.alreadyOffered && r2.taskId === r1.taskId && (await taskCount()) === 1 && (await eventCount()) === 1;
  console.log(`2 idempotent: alreadyOffered=${r2.alreadyOffered} sameTask=${r2.taskId === r1.taskId} tasks=${await taskCount()} events=${await eventCount()}  ${s2 ? '✅' : '❌'}`);

  // 3) surfaces to the tenant_admin's queue
  const queue = await listOpenTasksForActor({ id: ADMIN, role: 'tenant_admin', tenantId: TENANT });
  const mine = queue.find((t) => t.id === r1.taskId);
  const s3 = !!mine && mine.taskType === STARTER_OFFER_TASK_TYPE && mine.title.includes('starter set');
  console.log(`3 surfaces  : inQueue=${!!mine} title="${mine?.title ?? ''}"  ${s3 ? '✅' : '❌'}`);

  await cleanup();
  const pass = s1 && s2 && s3;
  console.log(pass ? '✅ STARTER-OFFER PROOF PASS (3/3)' : '❌ FAIL');
  if (!pass) process.exit(1);
}

main().then(() => sql.end()).catch(async (e) => { console.error(e); await sql.end(); process.exit(1); });
