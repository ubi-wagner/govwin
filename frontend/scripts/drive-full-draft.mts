// Fires the canonical full-draft path (same helper the admin doorbell + portal call) → the pipeline
// worker's OnFullDraftRequestedModeC runs the whole cohort. Proves the flagship AI orchestration
// worker-to-review. Run with the govtech_app + emulator env; the worker (listening) does the LLM calls.
import { runInTenant } from '@/lib/tenant-context';
import { sqlBypass } from '@/lib/db';
import { requestFullDraft } from '@/lib/proposal-full-draft';

const tenantId = '17780cad-76c0-4cef-95ec-2a536bcf5c8f'; // Foundation
const [u] = await sqlBypass<Array<{ id: string; email: string }>>`
  select id, email from users where email = 'kate.ulepic@foundation3dp.com' limit 1`;
const [p] = await sqlBypass<Array<{ id: string; opportunityId: string | null }>>`
  select id, opportunity_id from proposals where tenant_id = ${tenantId}::uuid limit 1`;
if (!u || !p) { console.error('missing user/proposal', { u, p }); process.exit(1); }

await runInTenant(tenantId, async () => {
  await requestFullDraft({
    proposalId: p.id, tenantId, opportunityId: p.opportunityId ?? null, mode: 'c',
    voice: ['technical'], adversarial: true, adversarialPolicy: 'auto',
    actorId: u.id, actorEmail: u.email, role: 'tenant_admin', source: 'admin_doorbell',
  });
});
// WHAT THIS DRIVE DOES NOT PROVE, said out loud rather than left to the reader.
//
// It asserts the trigger was EMITTED. It does not wait for the pipeline worker, and it does not
// check that the Mode C cohort actually ran, landed staged revisions, or left an audit trail. A
// green line here means "the doorbell rang", not "someone answered". Verifying the answer needs the
// worker in the loop and belongs in the scenario matrix (S05/S06), which is where it is registered.
console.log(`✅ emitted proposal.full_draft_requested mode=c for proposal ${p.id}`);
console.log('   NOTE: EMISSION ONLY — this drive does not verify the cohort ran (see S05/S06).');
process.exit(0);
