/**
 * Does the Voice-of-Proposal a tenant SET actually reach the drafting agent from the Studio?
 *
 * THE DEFECT THIS EXISTS FOR (bug log B84). `OnReviewPhaseRequestedDraft.plan_draft` and
 * `OnReviewPhaseRequestedRefine.restyle` both declare `"voice": "payload.voice"` in their
 * input_map. `requestReviewPhase` — the ONE canonical emitter for `proposal:review_phase.requested`
 * — never wrote that key. So the engine resolved voice to null on every Studio run, the drafting
 * agent fell back to its house register, and nothing anywhere complained: a failed or empty
 * AI_INVOKE input is a SAFE SKIP by design, which is exactly what makes this class invisible.
 *
 * The asymmetry is what makes it a customer-visible defect rather than dead wiring. The same
 * proposal, with the same persisted `proposals.voice`, drafts in the tenant's voice from the
 * full-draft button (that emitter carries `voice`) and in the house voice from the Studio — which
 * is the designated single front door for AI drafting.
 *
 * WHAT THIS ASSERTS, and why each half is needed:
 *   1. The REAL emitter (`requestReviewPhase`, imported — not re-implemented) writes the voice that
 *      is on the proposal row into the event payload.
 *   2. The REAL engine resolver (`workflows.processor.resolve_inputs`, run in Python against the
 *      stored row) turns that payload into a non-null `voice` input for BOTH AI steps.
 *
 * Half 1 alone would pass if the workflows read a different key; half 2 alone would pass against a
 * payload I hand-wrote. Together they cross the service boundary the bug lived in.
 *
 * Run:  DATABASE_URL=… node --import tsx scripts/verify-studio-voice.mts
 * Then: pipeline/scripts/check_ai_invoke_contract.py  (the standing lens that FOUND this)
 */
import postgres from 'postgres';
import { requestReviewPhase } from '@/lib/proposal-studio';

const DB = process.env.DATABASE_URL;
if (!DB) { console.error('DATABASE_URL required'); process.exit(2); }

// Deliberately NOT postgres.toCamel: this client reads raw column names so a snake_case slip in the
// harness shows up as undefined rather than being papered over by the app's transform.
const raw = postgres(DB, { max: 2 });

const VOICE = ['technical', 'research'];
let failures = 0;
const fail = (m: string) => { console.error(`  FAIL  ${m}`); failures++; };
const pass = (m: string) => console.log(`  ok    ${m}`);

async function main() {
  const [p] = await raw<{ id: string; tenant_id: string; opportunity_id: string | null; voice: unknown; studio_phase: string | null; studio_phase_status: string | null; studio_auto: boolean | null }[]>`
    SELECT id, tenant_id, opportunity_id, voice, studio_phase, studio_phase_status, studio_auto
    FROM proposals WHERE archived_at IS NULL ORDER BY created_at DESC LIMIT 1
  `;
  if (!p) { console.error('no proposal to drive — seed one first'); process.exit(2); }
  console.log(`proposal ${p.id} (tenant ${p.tenant_id})`);

  // A REAL user of that tenant. `proposal_activity_log.actor_id` has an FK to users, and the write
  // is wrapped in a non-critical try/catch — so an invented uuid does not fail the run, it just
  // silently stops logging. Driving as a real actor keeps this path exercised rather than skipped.
  const [actor] = await raw<{ id: string; email: string }[]>`
    SELECT u.id, u.email FROM users u
    WHERE u.tenant_id = ${p.tenant_id}::uuid AND u.is_active
    ORDER BY u.created_at LIMIT 1
  `;
  if (!actor) { console.error(`tenant ${p.tenant_id} has no active user to drive as`); process.exit(2); }
  console.log(`driving as ${actor.email}`);

  // Remember everything we are about to change, so the box is left as we found it.
  const before = { voice: p.voice, phase: p.studio_phase, status: p.studio_phase_status, auto: p.studio_auto };

  try {
    await raw`UPDATE proposals SET voice = ${raw.json(VOICE)} WHERE id = ${p.id}`;
    console.log(`set proposals.voice = ${JSON.stringify(VOICE)}`);

    const t0 = new Date();
    // The REAL emitter. Not a re-implementation of its payload.
    await requestReviewPhase({
      proposalId: p.id,
      tenantId: p.tenant_id,
      opportunityId: p.opportunity_id,
      phase: 'draft',
      auto: false,
      guidance: null,
      actorId: actor.id,
      actorEmail: actor.email,
      role: 'tenant_admin',
      source: 'studio_portal',
    });

    const [ev] = await raw<{ id: string; payload: Record<string, unknown> }[]>`
      SELECT id, payload FROM system_events
      WHERE namespace='proposal' AND type='review_phase.requested' AND phase='end'
        AND created_at >= ${t0}
      ORDER BY created_at DESC LIMIT 1
    `;
    if (!ev) { fail('the emitter produced no end event at all'); return; }

    const got = ev.payload?.voice;
    if (JSON.stringify(got) === JSON.stringify(VOICE)) {
      pass(`emitted payload.voice = ${JSON.stringify(got)}`);
    } else {
      fail(`emitted payload.voice = ${JSON.stringify(got)} — expected ${JSON.stringify(VOICE)}`);
    }

    // Hand the event id to the Python half, which resolves it with the engine's own resolver.
    console.log(`\nEVENT_ID=${ev.id}`);
  } finally {
    await raw`
      UPDATE proposals
      SET voice = ${before.voice === null ? null : raw.json(before.voice as object)},
          studio_phase = ${before.phase},
          studio_phase_status = ${before.status},
          studio_auto = ${before.auto}
      WHERE id = ${p.id}
    `;
    console.log('restored proposal state');
    await raw.end();
  }
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(2); });
