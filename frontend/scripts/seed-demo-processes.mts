/**
 * Seed representative process_instances so the admin workflow-manager surfaces
 * (workflow monitor · cross-tenant ledger · process monitor) populate for #102.
 * Covers BOTH sides of the OPP bridge: admin curation/release + customer build.
 */
import { sql } from '@/lib/db';

const ACME = '2f648f93-8b49-405c-a6c3-8c4ddda517df';
const mins = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

interface P {
  workflow: string; status: string; currentStep: string | null; idx: number;
  steps: Record<string, string>; startedMin: number; completedMin: number | null;
  heartbeatMin: number; tenantId: string | null; source: string; retries: number;
  lastError: string | null; lastErrorStep: string | null; scope: string | null;
}

const PROCS: P[] = [
  // ── Admin side of the bridge: a solicitation activation fanning to tenants ──
  { workflow: 'on_solicitation_pushed', status: 'completed', currentStep: null, idx: 3,
    steps: { validate: 'completed', fan_out: 'completed', score_cards: 'completed' },
    startedMin: 42, completedMin: 41, heartbeatMin: 41, tenantId: null, source: 'pipeline', retries: 0,
    lastError: null, lastErrorStep: null, scope: 'opp' },
  // ── Admin side: a new customer being provisioned after acceptance ──
  { workflow: 'on_application_accepted', status: 'running', currentStep: 'backfill_cards', idx: 1,
    steps: { seed_buckets: 'completed', backfill_cards: 'running' },
    startedMin: 3, completedMin: null, heartbeatMin: 0, tenantId: null, source: 'pipeline', retries: 0,
    lastError: null, lastErrorStep: null, scope: null },
  // ── Customer side of the bridge: a proposal advanced to review, HITL-paused ──
  { workflow: 'on_proposal_advanced', status: 'paused', currentStep: 'wait_for_review', idx: 2,
    steps: { ai_compliance_review: 'completed', notify_reviewers: 'completed', wait_for_review: 'running' },
    startedMin: 18, completedMin: null, heartbeatMin: 6, tenantId: ACME, source: 'pipeline', retries: 0,
    lastError: null, lastErrorStep: null, scope: null },
  // ── Customer side: a draft workflow that failed (exercises the health classifier) ──
  { workflow: 'on_proposal_advanced', status: 'failed', currentStep: 'ai_compliance_review', idx: 0,
    steps: { ai_compliance_review: 'failed' },
    startedMin: 75, completedMin: null, heartbeatMin: 70, tenantId: ACME, source: 'pipeline', retries: 3,
    lastError: 'compliance tool timed out after 3 retries', lastErrorStep: 'ai_compliance_review', scope: null },
];

try {
  const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int n FROM process_instances`;
  if (n >= PROCS.length) {
    console.log(`Already ${n} process_instances — skipping seed.`);
  } else {
    for (const p of PROCS) {
      await sql`
        INSERT INTO process_instances (
          workflow_name, status, current_step, current_step_index, step_status,
          started_at, completed_at, last_heartbeat_at, tenant_id, source, retry_count,
          last_error, last_error_step, scope, payload
        ) VALUES (
          ${p.workflow}, ${p.status}, ${p.currentStep}, ${p.idx}, ${sql.json(p.steps)},
          ${mins(p.startedMin)}::timestamptz, ${p.completedMin != null ? mins(p.completedMin) : null}::timestamptz,
          ${mins(p.heartbeatMin)}::timestamptz, ${p.tenantId}::uuid, ${p.source}, ${p.retries},
          ${p.lastError}, ${p.lastErrorStep}, ${p.scope}, ${sql.json({ demo: true })}
        )`;
      console.log(`✓ ${p.status.padEnd(9)} ${p.workflow}  @ ${p.currentStep ?? '—'}`);
    }
  }
  const [{ total }] = await sql<{ total: number }[]>`SELECT count(*)::int total FROM process_instances`;
  console.log(`\n${total} process_instances now`);
} finally {
  await sql.end();
}
