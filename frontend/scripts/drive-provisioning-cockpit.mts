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

/**
 * THE CAST IS RESOLVED, NOT PINNED.
 *
 * This drive used to hold `BUYER` and `ADMIN` as literal UUIDs. Both stopped existing when the box
 * was rehydrated — the tenant and the admin were RECREATED under new ids — and the drive then died
 * on a foreign-key violation ("Key (tenant_id)=(eb90abbc…) is not present in table \"tenants\""),
 * which reads like a broken product and is actually a broken fixture. It had been failing that way
 * for long enough to be treated as a known-bad drive.
 *
 * A pinned id asserts something the drive does not actually care about. What it needs is a tenant
 * with a PROPERTY: one that holds this opportunity's card and has no portal for it yet, so there
 * is a purchase to release. Asking for the property finds it on any seed; asking for the id finds
 * it only on the seed it was written against.
 *
 * The original cast is still PREFERRED (the `ORDER BY … DESC` puts it first when present) so the
 * narrative in the log stays the one this drive was written to tell — but preference is not
 * requirement, and a reseed changes the names in the output rather than the result.
 */
const [buyerRow] = await sqlBypass<Array<{ id: string; name: string; slug: string }>>`
  SELECT t.id, t.name, t.slug
  FROM tenant_opportunity_cards c
  JOIN tenants t ON t.id = c.tenant_id
  WHERE c.opportunity_id = ${OPP}::uuid
    AND NOT EXISTS (
      SELECT 1 FROM proposal_portals p
      WHERE p.tenant_id = t.id AND p.opportunity_id = ${OPP}::uuid
    )
  ORDER BY (t.slug = 'entrepreneurs-center') DESC, t.slug
  LIMIT 1`;
if (!buyerRow) {
  console.error('CANT-RUN no tenant holds this opportunity card without already having a portal for '
    + 'it — there is no purchase to release. That is a missing fixture, not a product failure.');
  process.exit(1);
}

// The broadcast half of the proof needs a SECOND card-holder, so "reached everyone" is a claim with
// more than one witness in it.
const [otherRow] = await sqlBypass<Array<{ id: string; slug: string }>>`
  SELECT t.id, t.slug
  FROM tenant_opportunity_cards c
  JOIN tenants t ON t.id = c.tenant_id
  WHERE c.opportunity_id = ${OPP}::uuid AND t.id <> ${buyerRow.id}::uuid
  ORDER BY (t.slug = 'foundation') DESC, t.slug
  LIMIT 1`;
if (!otherRow) {
  console.error('CANT-RUN only one tenant holds this card, so a fan-out to "everyone" cannot be '
    + 'distinguished from a fan-out to the buyer. Seed a second card-holder.');
  process.exit(1);
}

const [adminRow] = await sqlBypass<Array<{ id: string; email: string }>>`
  SELECT id, email FROM users
  WHERE role IN ('rfp_admin', 'master_admin') AND is_active
  ORDER BY (email = 'eric@rfppipeline.com') DESC, created_at
  LIMIT 1`;
if (!adminRow) { console.error('CANT-RUN no active rfp_admin to act as.'); process.exit(1); }

const BUYER = buyerRow.id;
const BUYER_NAME = buyerRow.name;
const BUYER_SLUG = buyerRow.slug;
const OTHER = otherRow.id;
const ADMIN = adminRow.id;
const ADMIN_EMAIL = adminRow.email;
console.log(`cast: buyer=${BUYER_SLUG} · other=${otherRow.slug} · admin=${ADMIN_EMAIL}`);

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

// A LABEL UNIQUE TO THIS RUN. `proposal_portals` has a unique key on
// (tenant_id, opportunity_id, label), and this drive used the fixed label 'pv-proof' — so a single
// run that died before its cleanup left a row that made EVERY later run fail at line 56 with a
// duplicate-key error, on a fixture the drive itself had created. One crash poisoned the drive
// permanently. A per-run tag makes a leftover row inert instead of fatal.
const RUN = crypto.randomUUID().slice(0, 8);
const LABEL = `pv-proof-${RUN}`;

let portalId = '';
let proposalId: string | null = null;
/** Every required item's metadata as this drive FOUND it, so the finally block restores exactly. */
let originalItemMeta: Array<{ id: string; metadata: Record<string, unknown> }> = [];
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
    VALUES (${BUYER}::uuid, ${OPP}::uuid, NULL, ${LABEL}, 'curation_pending', now() + interval '72 hours', ${ADMIN}::uuid)
    RETURNING id`;
  portalId = pp.id;
  console.log(`setup: throwaway curation_pending portal ${portalId} (${LABEL}) for ${BUYER_NAME}\n`);
  // Sweep any portal a PREVIOUS run left behind — same tenant + opportunity, a pv-proof label, and
  // not this run's. Cheap, and it means one crashed run cannot accumulate clutter forever.
  await sqlBypass`
    DELETE FROM proposal_portals
    WHERE tenant_id = ${BUYER}::uuid AND opportunity_id = ${OPP}::uuid
      AND label LIKE 'pv-proof%' AND label <> ${LABEL} AND proposal_id IS NULL`;

  // ── the readiness bar, BOTH WAYS ──────────────────────────────────────────────────────────────
  //
  // This used to be one line asserting `ready === true`, labelled "compliance + N vols + N items".
  // The bar has FIVE terms, not three: it also requires that no required item and no volume is
  // still waiting on a person (`itemsUndecided`/`volumesUndecided` — an item is decided when it has
  // a mold, or is explicitly marked completed-elsewhere). Those two terms were added after this
  // master was authored, so all 13 of its items were undecided and the check failed — correctly,
  // as it turns out, but under a label that named none of the reasons and read as a cockpit fault.
  //
  // So it now proves the bar in BOTH directions, on state it sets itself and puts back: not ready
  // while items are undecided, ready once they are decided, with the deciding done through the same
  // field the product reads.
  //
  // And it ESTABLISHES both sides rather than trusting what it finds — which matters, because
  // reading the "not ready" side off ambient state is exactly how the first version of this became
  // untestable within an hour: a run crashed after marking the items decided and before its
  // restore, the master stayed permanently ready, the refusal could never be observed again, and
  // the check then reported a failure caused by its own earlier crash. The prior metadata is
  // captured per item so the restore puts back what was actually there.
  const items = await sqlBypass<Array<{ id: string; metadata: Record<string, unknown> | null }>>`
    SELECT vri.id, vri.metadata FROM volume_required_items vri
    JOIN solicitation_volumes sv ON sv.id = vri.volume_id
    WHERE sv.solicitation_id = ${SOL}::uuid`;
  originalItemMeta = items.map((i) => ({ id: i.id, metadata: i.metadata ?? {} }));
  const itemIds = items.map((i) => i.id);

  const readinessLine = (r: Awaited<ReturnType<typeof getBuildReadiness>>) =>
    `compliance=${r.hasCompliance} vols=${r.volumeCount} items=${r.requiredItemCount} `
    + `itemsUndecided=${r.itemsUndecided} volsUndecided=${r.volumesUndecided}`;

  // (a) UNDECIDED — strip the key (absent means "nobody ruled"; false is a different, explicit state)
  await sqlBypass`UPDATE volume_required_items SET metadata = COALESCE(metadata, '{}'::jsonb) - 'dsipOnly'
                  WHERE id = ANY(${itemIds}::uuid[])`;
  const r0 = await getBuildReadiness(SOL);
  check(`the bar REFUSES a master with undecided items — ${readinessLine(r0)}`,
    r0.ready === false && r0.itemsUndecided > 0);

  // (b) DECIDED — through the same field the product reads
  await sqlBypass`UPDATE volume_required_items
                  SET metadata = COALESCE(metadata, '{}'::jsonb) || ${sqlBypass.json({ dsipOnly: true })}
                  WHERE id = ANY(${itemIds}::uuid[])`;
  const r1 = await getBuildReadiness(SOL);
  check(`the bar PASSES once every item is decided — ${readinessLine(r1)}`, r1.ready === true);
  check('build_complete starts false', r0.buildComplete === false);

  // ── OUTCOME 1: complete the master build-out + broadcast to ALL mirror cards ──
  const bo = await completeBuildOut(SOL, { id: ADMIN, email: ADMIN_EMAIL });
  check('completeBuildOut ok', bo.ok === true);
  check(`re-published >=1 activated opp (got ${bo.opportunitiesRepublished})`, bo.opportunitiesRepublished >= 1);
  // The TRUE broadcast reach: the fan-out touched BOTH tenant cards (buyer + Foundation).
  check(`cardsRefreshed counts every holder (got ${bo.cardsRefreshed}, expect >=2)`, bo.cardsRefreshed >= 2);

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
    // TW-3: release marks the workflow setup pending (recommend-but-require) + raises the required ToDo.
    const [pg] = await sqlBypass<Array<{ guardrailConfig: { _setup?: { status?: string } } | null }>>`SELECT guardrail_config AS "guardrailConfig" FROM proposal_portals WHERE id=${portalId}::uuid`;
    check('release stamped _setup=pending (required tenant acceptance)', pg?.guardrailConfig?._setup?.status === 'pending');
    const [{ n: setupTodos }] = await sqlBypass<Array<{ n: number }>>`SELECT count(*)::int AS n FROM tasks WHERE tenant_id=${BUYER}::uuid AND entity_type='portal' AND entity_id=${portalId}::uuid AND params->>'setup'='true' AND status='open'`;
    check('release raised the required "set up your workflow" ToDo', setupTodos >= 1);
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
    if (portalId) await sqlBypass`DELETE FROM tasks WHERE entity_type='portal' AND entity_id=${portalId}::uuid`;
    if (portalId) await sqlBypass`DELETE FROM proposal_portals WHERE id=${portalId}::uuid`;
    // Undecide exactly the items this run decided — the master is shared, and leaving it "built out"
    // would quietly make the next run's first assertion untestable (a bar that cannot refuse cannot
    // be shown to refuse). Removing the KEY, not setting it false: false is the admin's explicit
    // "authored here" override and would be a different state than the one we found.
    for (const it of originalItemMeta) {
      await sqlBypass`UPDATE volume_required_items SET metadata = ${sqlBypass.json(it.metadata)}
                      WHERE id = ${it.id}::uuid`;
    }
    console.log('cleanup: throwaway portal + proposal + tasks removed'
      + (originalItemMeta.length ? `; ${originalItemMeta.length} required item(s) restored to their prior metadata` : ''));
  } catch (ce) { console.error('cleanup warning (non-fatal)', ce); }
  await sqlBypass.end({ timeout: 5 });
  process.exit(fail === 0 ? 0 : 1);
}
