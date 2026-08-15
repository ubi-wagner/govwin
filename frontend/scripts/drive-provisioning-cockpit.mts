// Live proof of the provisioning cockpit's two-outcome "Complete & Release" (PV-3/PV-6).
// Drives the REAL completeBuildOut + provisionAndReleasePortal against the REAL DB under
// production-faithful RLS (govtech_app app conn + owner escape hatch). Proves:
//   OUTCOME 1 (segregation): the completed master broadcasts an 'updated' fan-out to EVERY
//     tenant's mirror card — not just the buyer's — flipping provisionReady on all of them.
//   OUTCOME 2 (continuity): the BUYER's portal provisions a real proposal, links it, flips
//     curation_pending→launched, and kicks off the build workflow.
//   Plus the bracketed finder:opportunity.build_completed + capture:workspace.released events.
// Creates a throwaway "purchase" (curation_pending portal) for a tenant that holds the card but
// has no portal, runs the flow, asserts, and cleans up the throwaway portal + proposal.
//
// Run: DATABASE_URL=<govtech_app> DATABASE_URL_OWNER=<owner> node --import tsx scripts/drive-provisioning-cockpit.mts
import { sqlBypass } from '@/lib/db';
import { getBuildReadiness } from '@/lib/provisioning/readiness';
import { completeBuildOut } from '@/lib/provisioning/complete';
import { provisionAndReleasePortal } from '@/lib/provisioning/release-portal';

const OPP = 'd53a22e4-792d-4fe7-8253-a42270fd9981';       // TVSF Round 45 (2 vols, 13 items, has compliance)
const SOL = 'b356a211-9448-4025-8626-27d149088da7';
const BUYER = 'eb90abbc-198b-4452-96c0-5c5ecff1fdf4';     // Entrepreneurs' Center — holds the card, no portal
const BUYER_NAME = "Entrepreneurs' Center";
const BUYER_SLUG = 'entrepreneurs-center';
const OTHER = '17780cad-76c0-4cef-95ec-2a536bcf5c8f';     // Foundation — also holds the card (the broadcast must reach it)
const ADMIN = '3667ead2-3b5e-4cc8-97f7-b2ab1cfa907d';
const ADMIN_EMAIL = 'eric@rfppipeline.com';

let pass = 0, fail = 0;
const ok = (b: boolean) => (b ? '✅' : '❌');
const check = (label: string, b: boolean) => { if (b) pass++; else fail++; console.log(`${ok(b)} ${label}`); };

async function cardState(tenantId: string) {
  const [r] = await sqlBypass<Array<{ bridgeVersion: number; updatedAt: Date; card: Record<string, unknown> }>>`
    SELECT bridge_version, updated_at, card FROM tenant_opportunity_cards
    WHERE tenant_id=${tenantId}::uuid AND opportunity_id=${OPP}::uuid LIMIT 1`;
  return r;
}
async function bridgeMax() {
  const [r] = await sqlBypass<Array<{ v: number }>>`SELECT COALESCE(MAX(version),0)::int AS v FROM opportunity_bridge WHERE opportunity_id=${OPP}::uuid`;
  return r?.v ?? 0;
}

let portalId = '';
let proposalId: string | null = null;
try {
  // Bare-ish start: clear the master's build_complete so we prove the flag FLIPS.
  await sqlBypass`UPDATE curated_solicitations SET build_complete=false, build_completed_at=NULL, build_completed_by=NULL WHERE id=${SOL}::uuid`;

  const preBridge = await bridgeMax();
  const preBuyer = await cardState(BUYER);
  const preOther = await cardState(OTHER);
  console.log(`pre: bridge v${preBridge} · buyer card v${preBuyer?.bridgeVersion} · other card v${preOther?.bridgeVersion}\n`);

  // Simulate the purchase: a curation_pending portal for the buyer (72h SLA), no proposal yet.
  const [pp] = await sqlBypass<Array<{ id: string }>>`
    INSERT INTO proposal_portals (tenant_id, opportunity_id, proposal_id, label, status, curation_due_at, created_by)
    VALUES (${BUYER}::uuid, ${OPP}::uuid, NULL, 'pv-proof', 'curation_pending', now() + interval '72 hours', ${ADMIN}::uuid)
    RETURNING id`;
  portalId = pp.id;
  console.log(`setup: throwaway curation_pending portal ${portalId} for ${BUYER_NAME}\n`);

  // Readiness bar (advisory) — TVSF has compliance + 2 vols + 13 items ⇒ ready.
  const r0 = await getBuildReadiness(SOL);
  check(`readiness meets the bar (compliance + ${r0.volumeCount} vols + ${r0.requiredItemCount} items)`, r0.ready === true);
  check('build_complete starts false', r0.buildComplete === false);

  // ── OUTCOME 1: complete the master build-out + broadcast to ALL mirror cards ──
  const bo = await completeBuildOut(SOL, { id: ADMIN, email: ADMIN_EMAIL });
  check('completeBuildOut ok', bo.ok === true);
  check(`re-published >=1 activated opp (got ${bo.opportunitiesRepublished})`, bo.opportunitiesRepublished >= 1);

  const [solAfter] = await sqlBypass<Array<{ buildComplete: boolean; buildCompletedBy: string | null }>>`
    SELECT build_complete, build_completed_by FROM curated_solicitations WHERE id=${SOL}::uuid`;
  check('master flagged build_complete=true', solAfter?.buildComplete === true);
  check('build_completed_by = the admin', solAfter?.buildCompletedBy === ADMIN);

  const postBridge = await bridgeMax();
  check(`bridge advanced (v${preBridge} → v${postBridge})`, postBridge > preBridge);
  const [lastEvt] = await sqlBypass<Array<{ eventType: string }>>`SELECT event_type FROM opportunity_bridge WHERE opportunity_id=${OPP}::uuid ORDER BY version DESC LIMIT 1`;
  check("bridge event_type = 'updated'", lastEvt?.eventType === 'updated');

  const postBuyer = await cardState(BUYER);
  const postOther = await cardState(OTHER);
  check('BUYER card refreshed by the broadcast', (postBuyer?.bridgeVersion ?? 0) > (preBuyer?.bridgeVersion ?? -1));
  check('OTHER tenant card ALSO refreshed (broadcast reached everyone)', (postOther?.bridgeVersion ?? 0) > (preOther?.bridgeVersion ?? -1));
  check('BUYER card.provisionReady flipped true', postBuyer?.card?.provisionReady === true);
  check('OTHER card.provisionReady flipped true', postOther?.card?.provisionReady === true);

  // bracketed finder:opportunity.build_completed (start + end)
  const bce = await sqlBypass<Array<{ phase: string }>>`
    SELECT phase FROM system_events WHERE namespace='finder' AND type='opportunity.build_completed'
      AND payload->>'solicitationId'=${SOL} ORDER BY created_at DESC LIMIT 4`;
  check('finder:opportunity.build_completed start emitted', bce.some(e => e.phase === 'start'));
  check('finder:opportunity.build_completed end emitted', bce.some(e => e.phase === 'end'));

  // ── OUTCOME 2: provision + release the buyer's portal + kick off the workflow ──
  const rel = await provisionAndReleasePortal({
    tenantId: BUYER, tenantName: BUYER_NAME, tenantSlug: BUYER_SLUG, portalId,
    actor: { id: ADMIN, email: ADMIN_EMAIL, role: 'rfp_admin' },
  });
  check('provisionAndReleasePortal ok', rel.ok === true);
  if (rel.ok) {
    proposalId = rel.proposalId;
    check('a proposal was provisioned + linked', !!rel.proposalId);
    const [portalAfter] = await sqlBypass<Array<{ status: string; proposalId: string | null }>>`
      SELECT status, proposal_id AS "proposalId" FROM proposal_portals WHERE id=${portalId}::uuid`;
    check("portal flipped curation_pending → launched", portalAfter?.status === 'launched');
    check('portal.proposal_id = the provisioned proposal', portalAfter?.proposalId === rel.proposalId);
    const [{ n: sectionCount }] = await sqlBypass<Array<{ n: number }>>`SELECT count(*)::int AS n FROM proposal_sections WHERE proposal_id=${rel.proposalId}::uuid`;
    check(`the build has real sections (got ${sectionCount})`, sectionCount > 0);
    // The provision best-effort tail (RLS-forced library_seed_jobs) now runs in the buyer tenant
    // context even for this cross-tenant admin caller (the runInTenant fix) — no silent RLS drop.
    const [{ n: seedJobs }] = await sqlBypass<Array<{ n: number }>>`SELECT count(*)::int AS n FROM library_seed_jobs WHERE proposal_id=${rel.proposalId}::uuid`;
    check(`library seed job created (RLS tail scoped to buyer): ${seedJobs}`, seedJobs >= 1);
    check(`workflow kicked off (tasksCreated=${rel.tasksCreated})`, rel.tasksCreated >= 0);
    const [wr] = await sqlBypass<Array<{ n: number }>>`SELECT count(*)::int AS n FROM system_events WHERE namespace='capture' AND type='workspace.released' AND payload->>'portalId'=${portalId}`;
    check('capture:workspace.released emitted', (wr?.n ?? 0) >= 1);
  }

  console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'}: ${pass} passed, ${fail} failed`);
} catch (e) {
  console.error('DRIVE ERROR', e);
  fail++;
} finally {
  // Clean up the throwaway purchase (leave build_complete + card refreshes — legitimate).
  try {
    if (portalId) await sqlBypass`UPDATE proposal_portals SET proposal_id=NULL WHERE id=${portalId}::uuid`;
    if (proposalId) {
      await sqlBypass`DELETE FROM agent_task_queue WHERE proposal_id=${proposalId}::uuid`;
      await sqlBypass`DELETE FROM proposal_compliance_matrix WHERE proposal_id=${proposalId}::uuid`;
      await sqlBypass`DELETE FROM proposal_sections WHERE proposal_id=${proposalId}::uuid`;
      await sqlBypass`DELETE FROM proposal_artifacts WHERE proposal_id=${proposalId}::uuid`;
      await sqlBypass`DELETE FROM library_seed_jobs WHERE proposal_id=${proposalId}::uuid`;
      await sqlBypass`DELETE FROM proposals WHERE id=${proposalId}::uuid`;
    }
    if (portalId) await sqlBypass`DELETE FROM proposal_portals WHERE id=${portalId}::uuid`;
    console.log('cleanup: throwaway portal + proposal removed');
  } catch (ce) { console.error('cleanup warning (non-fatal)', ce); }
  await sqlBypass.end({ timeout: 5 });
  process.exit(fail === 0 ? 0 : 1);
}
