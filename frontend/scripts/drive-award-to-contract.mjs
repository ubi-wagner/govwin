/**
 * Record a WIN on a submitted proposal, as the customer, and check what the win produced.
 *
 * The last surface `verify-surfaces.mjs` could not reach was
 * `/portal/[slug]/contracts/[contractId]` — the `contracts` table was empty. The wrong fix is to
 * INSERT a row: that makes the sweep green while proving nothing about how a contract comes to
 * exist. The right one is to drive the path the product actually uses, which closes the gap AND
 * exercises the awarded → contract → kickoff spine (task #51, mig 148) end-to-end.
 *
 * Drives `POST /api/portal/[slug]/proposals/[id]/outcome {outcome:'awarded'}` through a real
 * tenant_admin session — the route is `hasRoleAtLeast('tenant_admin')` gated, so a browser session
 * is the honest way in — then reads back what the win was supposed to create:
 *
 *   · a `contracts` row on the SAME opportunity_id (idempotent: ON CONFLICT (proposal_id))
 *   · a `capture:contract.started` event
 *   · a contract-scope kickoff gate
 *   · the winning proposal's atoms elevated to outcome='awarded', outcome_score=1.0
 *
 * Idempotent by construction — re-running on an already-won proposal re-uses the contract.
 *
 *   cd frontend && node scripts/drive-award-to-contract.mjs [proposalId]
 * Exit 0 if the win produced a contract; 1 otherwise.
 *
 * ⚠️ RUN THIS **BEFORE** `capture-guides.mjs`, NEVER AFTER.
 *
 * Recording a win MUTATES tenant state — the winning build moves `submitted → archived` and drops
 * out of the dashboard's build grid. Capture the guides first and the screenshots show a world that
 * no longer exists; the dashboard shot has now been invalidated twice this way, once in each
 * direction. Any state-mutating drive belongs ahead of the capture, and the capture belongs last.
 */
import { chromium } from 'playwright';
import postgres from 'postgres';
import { clientHeaders } from './lib/client-ip.mjs';

const BASE = process.env.GUIDE_BASE || 'http://localhost:3001';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const DB = process.env.GUIDE_DB || 'postgresql://claude@127.0.0.1:5433/govtech_intel';
const SLUG = 'foundation';
const sql = postgres(DB, { max: 2, transform: { column: { from: (c) => c } } });

let ok = true;
const A = (label, cond, extra = '') => {
  console.log(`${cond ? '✓' : '✗'} ${label}${extra ? ` — ${extra}` : ''}`);
  ok = ok && cond;
};

// A SUBMITTED proposal that carries an opportunity_id and has no contract yet. Looked up, not
// pinned: a hardcoded id is a script that silently drives the wrong row after a reseed.
const [target] = process.argv[2]
  ? await sql`SELECT id, title, opportunity_id FROM proposals WHERE id = ${process.argv[2]}::uuid`
  : await sql`
      SELECT p.id, p.title, p.opportunity_id
      FROM proposals p JOIN tenants t ON t.id = p.tenant_id
      WHERE t.slug = ${SLUG} AND p.archived_at IS NULL AND p.stage = 'submitted'
        AND p.opportunity_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM contracts c WHERE c.proposal_id = p.id)
      ORDER BY p.created_at LIMIT 1`;

if (!target) {
  // EXIT 2, NOT 0 — this measured NOTHING.
  //
  // Exiting 0 here reported a clean pass for a run that never recorded a win, never looked for a
  // contract, and never touched the awarded path at all. In the suite table it was indistinguishable
  // from a real pass, and the whole point of that table's CANT-RUN column is to keep those apart:
  // uncovered is not passing. The suite reads exit 2 as CANNOT-RUN and prints the reason below.
  console.error('CANNOT RUN');
  console.error(`  no eligible proposal at "${SLUG}" — the awarded path needs one that is`);
  console.error('  submitted, carries an opportunity_id, and has no contract yet. Provision and');
  console.error('  submit a build (or pass a proposal id as argv[2]) and re-run.');
  await sql.end();
  process.exit(2);
}
console.log(`\n── recording a WIN on "${target.title.slice(0, 46)}" ──\n`);

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, extraHTTPHeaders: clientHeaders() });
  const p = await ctx.newPage();
  await p.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('#email', { timeout: 20000 });
  await p.fill('#email', 'kate.ulepic@foundation3dp.com');
  await p.fill('#password', 'DemoPass123!');
  await p.click('button[type="submit"]');
  await p.waitForLoadState('networkidle').catch(() => {});
  await p.waitForTimeout(2600);
  A('tenant_admin is signed in', !p.url().includes('/login'), p.url().replace(BASE, ''));

  // Through the session, so the role gate and tenant check are the real ones.
  const res = await p.evaluate(async ([slug, id]) => {
    const r = await fetch(`/api/portal/${slug}/proposals/${id}/outcome`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ outcome: 'awarded' }),
    });
    return { status: r.status, body: await r.text() };
  }, [SLUG, target.id]);
  A('POST outcome=awarded accepted', res.status < 400, `${res.status} ${res.body.slice(0, 160)}`);
  await p.waitForTimeout(2500);
  await ctx.close();
} finally {
  await browser.close();
}

// What the win was supposed to produce — read back from the database, not from the response body.
const [contract] = await sql`
  SELECT id, opportunity_id, title FROM contracts WHERE proposal_id = ${target.id}::uuid`;
A('a contract exists for the winning proposal', !!contract, contract?.id ?? 'none');
A('the contract sits on the SAME opportunity',
  contract?.opportunity_id === target.opportunity_id,
  `${contract?.opportunity_id ?? '—'} vs ${target.opportunity_id}`);

const [{ n: evts } = { n: 0 }] = await sql`
  SELECT count(*)::int AS n FROM system_events
  WHERE namespace = 'capture' AND type = 'contract.started'
    AND payload->>'proposalId' = ${target.id}`;
A('capture:contract.started was emitted', evts > 0, `${evts} row(s)`);

const [{ n: atoms } = { n: 0 }] = await sql`
  SELECT count(*)::int AS n FROM library_atoms
  WHERE origin_proposal_id = ${target.id}::uuid AND outcome = 'awarded' AND outcome_score = 1.0`;
console.log(`· ${atoms} library atom(s) elevated to outcome='awarded' (0 is fine — this proposal`
  + ' may have contributed none back to the library)');

if (contract) console.log(`\n→ /portal/${SLUG}/contracts/${contract.id}`);
await sql.end();
console.log(ok ? '\n✓ the win produced a contract on the same opportunity.' : '\n✗ the awarded path did not complete.');
process.exit(ok ? 0 : 1);
