/**
 * The Studio ROUTE end of B84 — driven as a real signed-in tenant admin against a running box.
 *
 * `verify-studio-voice.mts` proves the emitter function and the engine resolver agree. It calls
 * `requestReviewPhase` directly, so it says nothing about the path a customer actually takes: auth,
 * tenant binding, body validation, and the route's own call into that function. This closes it.
 *
 * A real browser session, a real POST to `/api/portal/[slug]/proposals/[id]/studio`, and the payload
 * read back out of `system_events` — the customer's own path, end to end.
 *
 * WHAT IT RESTORES. The proposal's voice, studio_phase, studio_phase_status and studio_auto are all
 * put back exactly as found, because the fixture is shared with every other lens. The emitted events
 * are left in place deliberately: they are the evidence, and `check_ai_invoke_contract.py` reads
 * exactly this history.
 *
 * Run:  DATABASE_URL=… node scripts/verify-studio-voice-route.mjs      (server on :3001)
 */
import { chromium } from 'playwright';
import postgres from 'postgres';

// One base URL, two historic names: the lenses read GUIDE_BASE, the drives read BASE_URL, and
// a harness that silently ignores the one you passed fails with a connection error that reads
// like the app is down. Accept both everywhere; the family's own name still wins.
const BASE = process.env.GUIDE_BASE || process.env.BASE_URL || 'http://localhost:3001';
const DB = process.env.DATABASE_URL;
if (!DB) { console.error('DATABASE_URL required'); process.exit(2); }

// Raw column names on purpose — a snake_case slip here should surface as undefined, not be papered
// over by the app's postgres.toCamel transform.
const sql = postgres(DB, { max: 2 });

const VOICE = ['technical', 'commercial'];

/**
 * SELF-TEST: `FORCE_MISMATCH=1` expects the wrong voice, so a correct product makes this script FAIL.
 *
 * Its purpose is to answer "can this assertion fail at all?" without a rebuild. The other two B84
 * proofs were shown red against the unfixed code directly; this one runs against a BUILT server, so
 * showing it red the same way would cost a full rebuild each way. This switch buys the same
 * information — a check that has never failed is not evidence — at the price of one extra run.
 *
 *   FORCE_MISMATCH=1 node scripts/verify-studio-voice-route.mjs   -> exit 1
 *   node scripts/verify-studio-voice-route.mjs                    -> exit 0
 *
 * It is a vacuity check, NOT a way to make a red run look green: it can only ever turn a pass into a
 * failure.
 */
const EXPECT = process.env.FORCE_MISMATCH ? ['deliberately-wrong'] : VOICE;
let failures = 0;
const fail = (m) => { console.error(`  FAIL  ${m}`); failures++; };
const pass = (m) => console.log(`  ok    ${m}`);

async function login(ctx, email, pw) {
  const p = await ctx.newPage();
  await p.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('#email', { timeout: 20000 });
  await p.fill('#email', email);
  await p.fill('#password', pw);
  await p.click('button[type="submit"]');
  await p.waitForLoadState('networkidle').catch(() => {});
  await p.waitForTimeout(2500);
  if (p.url().includes('/login')) throw new Error(`login failed for ${email}`);
  return p;
}

const api = (page, url, init) => page.evaluate(async ([u, i]) => {
  const r = await fetch(u, { ...(i ?? {}), headers: { 'Content-Type': 'application/json', ...(i?.headers ?? {}) } });
  return { status: r.status, text: await r.text() };
}, [url, init ?? null]);

let before = null;
let proposal = null;
let browser = null;

async function main() {
  // LOCK IS NOT A FILTER HERE, and the first version of this script wrongly assumed it was.
  //
  // I wrote `WHERE is_locked = false` on the belief that the Studio refuses a locked build. It does
  // not — `studio/route.ts` has no lock gate, which is correct: the Studio is ADVISORY. It stages
  // review canvas_versions and never advances a stage, locks a section, or submits, so there is
  // nothing for a lock to protect against. Every proposal on this box is locked, so that invented
  // filter made the script exit "cannot be driven" against a route that drives fine.
  //
  // Assert the contract the system HAS, not the one that sounds prudent — a harness precondition is
  // an assertion too, and a wrong one reports a phantom gap instead of a real result.
  const [p] = await sql`
    SELECT pr.id, pr.tenant_id, pr.voice, pr.studio_phase, pr.studio_phase_status, pr.studio_auto,
           t.slug AS tenant_slug
    FROM proposals pr JOIN tenants t ON t.id = pr.tenant_id
    WHERE pr.archived_at IS NULL
    ORDER BY pr.created_at DESC LIMIT 1
  `;
  if (!p) {
    console.error('no proposal on this box — the Studio cannot be driven; NOT a pass');
    process.exit(2);
  }
  proposal = p;
  before = { voice: p.voice, phase: p.studio_phase, status: p.studio_phase_status, auto: p.studio_auto };
  console.log(`proposal ${p.id} · tenant ${p.tenant_slug}`);

  await sql`UPDATE proposals SET voice = ${sql.json(VOICE)} WHERE id = ${p.id}`;
  console.log(`set proposals.voice = ${JSON.stringify(VOICE)}`);

  // Explicit path, as the sibling lenses do: the pinned @playwright/test version disagrees with the
  // pre-installed browser revision, so the default resolver tells you to run `playwright install`.
  browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const ctx = await browser.newContext();
  const page = await login(ctx, 'kate.ulepic@foundation3dp.com', 'DemoPass123!');
  console.log('signed in as kate.ulepic@foundation3dp.com (tenant_admin)');

  const t0 = new Date();
  const res = await api(page, `/api/portal/${p.tenant_slug}/proposals/${p.id}/studio`, {
    method: 'POST',
    body: JSON.stringify({ action: 'start', auto: false }),
  });

  if (res.status !== 200) {
    fail(`studio POST returned ${res.status} — ${res.text.slice(0, 300)}`);
    return;
  }
  pass(`studio POST 200 as the tenant admin`);

  const [ev] = await sql`
    SELECT id, payload FROM system_events
    WHERE namespace='proposal' AND type='review_phase.requested' AND phase='end'
      AND created_at >= ${t0}
    ORDER BY created_at DESC LIMIT 1
  `;
  if (!ev) { fail('the route produced no review_phase.requested end event'); return; }

  const got = ev.payload?.voice;
  if (JSON.stringify(got) === JSON.stringify(EXPECT)) {
    pass(`the route's emitted payload.voice = ${JSON.stringify(got)}`);
  } else {
    fail(`the route's emitted payload.voice = ${JSON.stringify(got)} — expected ${JSON.stringify(EXPECT)}`);
  }
  console.log(`\nEVENT_ID=${ev.id}`);
}

main()
  .catch((e) => { console.error(e); failures++; })
  .finally(async () => {
    try {
      if (browser) await browser.close();
      if (proposal && before) {
        await sql`
          UPDATE proposals
          SET voice = ${before.voice === null ? null : sql.json(before.voice)},
              studio_phase = ${before.phase},
              studio_phase_status = ${before.status},
              studio_auto = ${before.auto}
          WHERE id = ${proposal.id}
        `;
        console.log('restored proposal state');
      }
    } finally {
      await sql.end();
      process.exit(failures === 0 ? 0 : 1);
    }
  });
