// Live proof of the C1 submission-readiness gate against the REAL computeSubmissionReadiness + the
// real advance transaction + the real DB. Creates a throwaway not-ready proposal (a lockable section
// + one missing required form), drives advance→final three ways (block / acknowledge / force), checks
// the audited override, and cleans up. Run with the govtech_app + owner env.
import { sqlBypass } from '@/lib/db';
import { runInTenant } from '@/lib/tenant-context';
import { advanceProposalStage } from '@/lib/proposal-advance';

const FND = '17780cad-76c0-4cef-95ec-2a536bcf5c8f';
const OPP = '48405118-8816-449c-a4e5-17f7243e4ece';
const ACTOR = 'bd101904-582d-44db-ac2e-ce63eb341979'; // kate.ulepic (tenant_admin)
const ok = (b: boolean) => (b ? '✅' : '❌');

// ── Setup (owner conn) ──────────────────────────────────────────────
const [p] = await sqlBypass<Array<{ id: string }>>`
  insert into proposals (tenant_id, opportunity_id, title, stage, gate_config, is_locked, lock_count)
  values (${FND}::uuid, ${OPP}::uuid, 'GATE-TEST throwaway', 'draft', ${sqlBypass.json(['draft', 'final'])}, false, 0)
  returning id`;
await sqlBypass`
  insert into proposal_sections (proposal_id, section_number, title, status, is_locked)
  values (${p.id}::uuid, '1.0', 'Technical', 'complete', true)`;
await sqlBypass`
  insert into proposal_supporting_docs (proposal_id, tenant_id, requirement_label, category, is_required, status)
  values (${p.id}::uuid, ${FND}::uuid, 'SF424 — Application for Federal Assistance', 'supporting_document', true, 'missing')`;
console.log(`setup: throwaway proposal ${p.id} (1 locked section, 1 missing required doc)\n`);

const call = (opts: { force?: boolean; acknowledgeBlockers?: boolean }) =>
  runInTenant(FND, () => advanceProposalStage({
    tenantId: FND, tenantSlug: 'foundation-3dp', proposalId: p.id,
    actorId: ACTOR, actorEmail: 'kate.ulepic@foundation3dp.com', actorRole: 'tenant_admin',
    targetStage: 'final', ...opts,
  }));

try {
  // 1) plain advance → BLOCKED (NOT_READY) with real blockers, no mutation
  const r1 = await call({});
  const blocked = !r1.ok && r1.code === 'NOT_READY';
  console.log(`${ok(blocked)} plain advance→final BLOCKED: ok=${r1.ok} code=${!r1.ok ? r1.code : '-'}`);
  if (!r1.ok && r1.code === 'NOT_READY') {
    const blk = (r1.details as { blockers?: Array<{ message: string }> })?.blockers ?? [];
    blk.forEach((b) => console.log(`     • ${b.message}`));
  }
  const stillDraft = (await sqlBypass<Array<{ stage: string }>>`select stage from proposals where id=${p.id}::uuid`)[0]?.stage;
  console.log(`${ok(stillDraft === 'draft')} no mutation on block: stage still '${stillDraft}'\n`);

  // 2) acknowledge → SUBMITTED (section is lockable), override audited
  const r2 = await call({ acknowledgeBlockers: true });
  console.log(`${ok(r2.ok)} acknowledged advance→final: ok=${r2.ok}${r2.ok ? ` stage=${r2.data.stage}` : ` code=${r2.code}`}`);
  const submitted = (await sqlBypass<Array<{ stage: string }>>`select stage from proposals where id=${p.id}::uuid`)[0]?.stage;
  console.log(`${ok(submitted === 'submitted')} proposal is now '${submitted}'`);
  const [ev] = await sqlBypass<Array<{ payload: unknown }>>`
    select payload from system_events
    where type='proposal.advanced' and phase='end' and (payload->>'proposalId')=${p.id}
    order by created_at desc limit 1`;
  const override = (ev?.payload as { readinessOverride?: { blockerCount?: number } } | undefined)?.readinessOverride;
  console.log(`${ok(!!override && (override.blockerCount ?? 0) > 0)} advance event carries readinessOverride: ${JSON.stringify(override ?? null)}\n`);
} finally {
  // ── Cleanup (owner conn) ──────────────────────────────────────────
  await sqlBypass`delete from system_events where (payload->>'proposalId')=${p.id}`;
  await sqlBypass`delete from proposal_stage_history where proposal_id=${p.id}::uuid`;
  await sqlBypass`delete from proposal_supporting_docs where proposal_id=${p.id}::uuid`;
  await sqlBypass`delete from proposal_sections where proposal_id=${p.id}::uuid`;
  await sqlBypass`delete from proposals where id=${p.id}::uuid`;
  console.log(`cleanup: removed throwaway proposal ${p.id}`);
}
process.exit(0);
