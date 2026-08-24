/**
 * RECORD A WIN, AS THE CUSTOMER, AND CHECK WHAT THE WIN PRODUCED.
 *
 * The last surface `verify-surfaces.mjs` could not reach was
 * `/portal/[slug]/contracts/[contractId]` — the `contracts` table was empty. The wrong fix is to
 * INSERT a row: that makes the sweep green while proving nothing about how a contract comes to
 * exist. The right one is to drive the path the product actually uses, which closes the gap AND
 * exercises the awarded → contract → kickoff spine (task #51, mig 148) end to end.
 *
 * Drives `POST /api/portal/[slug]/proposals/[id]/outcome {outcome:'awarded'}` through a real
 * tenant_admin session — the route is `hasRoleAtLeast('tenant_admin')` gated, so a browser session
 * is the honest way in — then reads back what the win was supposed to create:
 *
 *   · a `contracts` row on the SAME opportunity_id (idempotent: ON CONFLICT (proposal_id))
 *   · a `capture:contract.started` event
 *   · the winning proposal's atoms elevated to outcome='awarded', outcome_score=1.0
 *
 * BUILDS ITS OWN WINNER. It used to hunt the `foundation` demo tenant for a proposal that was
 * submitted, carried an opportunity_id, and had no contract yet. When none existed — which is the
 * normal state of a tenant nobody has just submitted from — the drive could not run at all, and for
 * a while it exited 0 while doing so, reporting a clean pass for a run that never recorded a win.
 *
 * Two things fall out of building the company instead of borrowing one.
 *
 * First, it can always run: the precondition is set up rather than waited for. Submitting is
 * SETUP here, not the subject — the subject is what a win produces — so the stage is moved
 * directly and the drive says so rather than pretending to have driven the submit gate.
 *
 * Second, and better: the file used to carry a warning in the header —
 *
 *     ⚠️ RUN THIS BEFORE capture-guides.mjs, NEVER AFTER. Recording a win MUTATES tenant state;
 *     the winning build moves submitted → archived and drops out of the dashboard's build grid.
 *
 * — because it won a real demo company's real build, and the guide screenshots then showed a world
 * that no longer existed. That had invalidated the dashboard shot twice, once in each direction.
 * A win inside a company that is disposed at the end of the run cannot do that, so the ordering
 * constraint is gone, not merely documented.
 *
 *   cd frontend && DATABASE_URL=<owner> node --import tsx scripts/drive-award-to-contract.mts
 */
import { sqlBypass as sql } from '@/lib/db';
import { runScenario } from './lib/scenario.mts';
import { BASE, launch, signIn } from './lib/cross-company.mts';

await runScenario('award-to-contract', async (s) => {
  let ok = true;
  const A = (label: string, cond: boolean, extra = '') => {
    console.log(`${cond ? '✓' : '✗'} ${label}${extra ? ` — ${extra}` : ''}`);
    ok = ok && cond;
  };

  const co = await s.tenant({ label: 'winner' });
  const build = await s.build({ tenant: co, label: 'win' });

  // SETUP, not the subject: put the build in the state a win is recorded from. The submit gate has
  // its own drive (`submit-gate`); pretending to have driven it here would be the kind of borrowed
  // credit that makes a suite look better covered than it is.
  await sql`UPDATE proposals SET stage = 'submitted' WHERE id = ${build.proposalId}::uuid`;
  const [before] = await sql<Array<{ stage: string; opportunityId: string | null }>>`
    SELECT stage, opportunity_id AS "opportunityId" FROM proposals WHERE id = ${build.proposalId}::uuid`;
  A('setup: a submitted build carrying an opportunity, with no contract yet',
    before?.stage === 'submitted' && !!before?.opportunityId, `opp=${before?.opportunityId}`);

  console.log(`\n── recording a WIN in ${co.slug} ──\n`);
  const browser = await launch();
  try {
    const bc = await signIn(browser, co.adminEmail, co.password);
    const page = bc.pages()[0];
    // Through the SESSION, so the role gate and the tenant check are the real ones.
    const res = await page.evaluate(async ([slug, id]) => {
      const r = await fetch(`/api/portal/${slug}/proposals/${id}/outcome`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outcome: 'awarded' }),
      });
      return { status: r.status, body: await r.text() };
    }, [co.slug, build.proposalId]);
    A('POST outcome=awarded accepted', res.status < 400, `${res.status} ${res.body.slice(0, 160)}`);
    await page.waitForTimeout(2500);
    await bc.close();
  } finally {
    await browser.close();
  }

  // What the win was supposed to produce — read back from the database, not from the response body.
  const [contract] = await sql<Array<{ id: string; opportunityId: string | null; title: string }>>`
    SELECT id, opportunity_id AS "opportunityId", title FROM contracts
    WHERE proposal_id = ${build.proposalId}::uuid`;
  A('a contract exists for the winning proposal', !!contract, contract?.id ?? 'none');
  A('the contract sits on the SAME opportunity',
    contract?.opportunityId === before?.opportunityId,
    `${contract?.opportunityId ?? '—'} vs ${before?.opportunityId}`);

  const [{ n: evts } = { n: 0 }] = await sql<Array<{ n: number }>>`
    SELECT count(*)::int AS n FROM system_events
    WHERE namespace = 'capture' AND type = 'contract.started'
      AND payload->>'proposalId' = ${build.proposalId}`;
  A('capture:contract.started was emitted', evts > 0, `${evts} row(s)`);

  const [{ n: atoms } = { n: 0 }] = await sql<Array<{ n: number }>>`
    SELECT count(*)::int AS n FROM library_atoms
    WHERE origin_proposal_id = ${build.proposalId}::uuid AND outcome = 'awarded' AND outcome_score = 1.0`;
  console.log(`· ${atoms} library atom(s) elevated to outcome='awarded' (0 is fine — this proposal`
    + ' may have contributed none back to the library)');

  if (contract) console.log(`\n→ /portal/${co.slug}/contracts/${contract.id}`);
  console.log(ok ? '\n✓ the win produced a contract on the same opportunity.'
    : '\n✗ the awarded path did not complete.');
  return ok;
});
