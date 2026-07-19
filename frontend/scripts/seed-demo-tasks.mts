/** Seed realistic demo ToDos so the unified TaskQueue populates on both landings (#101). */
import { sql } from '@/lib/db';
import { createTask } from '@/lib/tasks/tasks';
try {
  const [admin] = await sql<{ id: string; email: string }[]>`SELECT id, email FROM users WHERE email='eric@rfppipeline.com' LIMIT 1`;
  const [immo] = await sql<{ id: string }[]>`SELECT id FROM tenants WHERE slug='immobileyes' LIMIT 1`;
  const [acme] = await sql<{ id: string }[]>`SELECT id FROM tenants WHERE slug='acme-navy-systems' LIMIT 1`;
  const [acmeAdmin] = await sql<{ id: string; email: string }[]>`SELECT id, email FROM users WHERE email='admin@acme-navy.test' LIMIT 1`;
  const actor = { id: admin.id, email: admin.email, role: 'master_admin' as const, tenantId: null };
  const iso = (d: number) => new Date(Date.now() + d * 86400000).toISOString();
  await sql`DELETE FROM tasks WHERE title LIKE 'Demo · %'`;
  const mk = async (o: Parameters<typeof createTask>[0]) => { const r = await createTask(o); console.log(`${r.ok ? '✓' : '✗ ' + r.error} ${o.title}`); };
  // Admin side — a purchase awaiting curation + release (72h SLA).
  await mk({ actor, tenantId: immo.id, assigneeRole: 'rfp_admin', taskType: 'proposal_setup',
    title: 'Demo · Curate & release DON26BX03-NP002 (CUAS) for Immobileyes',
    description: 'Purchased with comp code — 72h SLA. Run Ingest Assist, review the matrix, then Release to customer.',
    entityType: 'solicitation', dueAt: iso(3), nudgeDays: [1, 2] });
  // Customer side — sections to finish on the active build.
  await mk({ actor, tenantId: acme.id, assigneeUserId: acmeAdmin.id, taskType: 'proposal_build',
    title: 'Demo · Draft all sections — Acme → Navy SBIR Phase I', description: 'Ground each mold on your library, then review.', entityType: 'proposal', dueAt: iso(2), nudgeDays: [1] });
  await mk({ actor, tenantId: acme.id, assigneeUserId: acmeAdmin.id, taskType: 'review_section',
    title: 'Demo · Finish & lock Technical Volume — Statement of Work', description: 'Draft is started; complete and Accept & Lock.', entityType: 'section', dueAt: iso(5), nudgeDays: [2] });
  // The atomic floor — a broadcast note, acknowledged on read (one on each side).
  await mk({ actor, tenantId: acme.id, assigneeRole: 'tenant_admin', taskType: 'broadcast',
    title: 'Demo · DoD SBIR 2026.1 release cycle is now open', description: 'New DSIP topics are landing on your Opportunities. Acknowledge to clear.', params: { kind: 'acknowledge' } });
  await mk({ actor, tenantId: null, assigneeRole: 'rfp_admin', taskType: 'broadcast',
    title: 'Demo · Curation SLA reminder — 72h clock on new purchases', description: 'Keep the queue under SLA. Acknowledge to clear.', params: { kind: 'acknowledge' } });
  const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int n FROM tasks WHERE status='open'`;
  console.log(`\n${n} open tasks now`);
} finally { await sql.end(); }
