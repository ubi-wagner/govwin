/**
 * Bring UNCOVERED AI_INVOKE workflows under the contract lens by firing their DOMAIN emitters.
 *
 * `pipeline/scripts/check_ai_invoke_contract.py` compares the payload keys each `AI_INVOKE` step
 * reads against the keys real emitters really wrote. A trigger nobody has ever fired on this box has
 * no evidence, so the lens reports it UNCOVERED — unmeasured, not passing. This script fires them.
 *
 * THE ONE RULE, AND IT IS THE WHOLE POINT. Every trigger here is fired through the emitter the
 * PRODUCT uses — an admin route, a portal route, a domain lib. Never through
 * `POST /api/admin/workflows`, which emits the trigger with the OPERATOR'S OVERLAY as the payload:
 * clearing an UNCOVERED that way would check my own typing against the input_map, a tautology that
 * converts every uncovered workflow into a false pass and destroys the lens's value. The launcher is
 * a fine way to exercise a workflow; it is worthless as evidence about an emitter.
 *
 * Consequence: a trigger with no domain emitter CANNOT be cleared here, and is reported as such
 * rather than quietly filled in. That is a finding about the product, not a gap in this script.
 *
 * WHAT IT LEAVES BEHIND. The emitted `system_events` rows — deliberately: they ARE the evidence the
 * lens reads. Any business row a fired emitter creates is a real product side effect of a real
 * operation; each step below says what it touches. Nothing is faked into `system_events` directly.
 *
 * Run:  DATABASE_URL=… node scripts/fire-uncovered-triggers.mjs        (server on :3001)
 * Then: PYTHONPATH=src DATABASE_URL=… python3 pipeline/scripts/check_ai_invoke_contract.py
 */
import { chromium } from 'playwright';
import postgres from 'postgres';

const BASE = process.env.GUIDE_BASE || 'http://localhost:3001';
const DB = process.env.DATABASE_URL;
if (!DB) { console.error('DATABASE_URL required'); process.exit(2); }

const sql = postgres(DB, { max: 3 });
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const results = [];
const record = (trigger, outcome, detail) => {
  results.push({ trigger, outcome, detail });
  const tag = { fired: 'ok  ', refused: 'REF ', 'not-tried': '?   ', 'no-emitter': 'NONE' }[outcome] ?? '??? ';
  console.log(`  ${tag} ${trigger.padEnd(38)} ${detail}`);
};

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

/** Did the trigger actually land? Read `system_events`, never the response body. */
async function landed(namespace, type, since) {
  const [r] = await sql`
    SELECT count(*)::int AS n FROM system_events
    WHERE namespace = ${namespace} AND type = ${type} AND created_at >= ${since}
  `;
  return r.n;
}

/**
 * Fire one emitter and report by what reached system_events.
 *
 * A 405 or a 400 means the request never reached the emitter — the door was not locked, I knocked
 * on the wrong one. Those are reported NOT-TRIED, never as a refusal and never as a pass. (B83's
 * write-up records three probes that proved nothing until that distinction was made.)
 */
async function fire(label, namespace, type, run) {
  const t0 = new Date();
  let res;
  try {
    res = await run();
  } catch (e) {
    record(label, 'not-tried', `threw before reaching the emitter: ${String(e).slice(0, 90)}`);
    return;
  }
  await new Promise((r) => setTimeout(r, 900)); // the emit is awaited, but give the row a beat
  const n = await landed(namespace, type, t0);
  if (n > 0) { record(label, 'fired', `${n} event(s) · HTTP ${res?.status ?? 'n/a'}`); return; }
  // 404/405/400 all mean the request never reached the emitter — no such route, wrong method, wrong
  // body shape. The door was not locked; I knocked on the wrong one. Reporting any of these as a
  // refusal would be a phantom finding, and reporting them as a pass would be worse.
  if (res && (res.status === 404 || res.status === 405 || res.status === 400)) {
    const why = { 404: 'no such route', 405: 'wrong method', 400: 'wrong body shape' }[res.status];
    record(label, 'not-tried', `HTTP ${res.status} (${why}) — the emitter was never reached`);
    return;
  }
  record(label, 'refused', `HTTP ${res?.status ?? 'n/a'} and no event: ${String(res?.text ?? '').slice(0, 110)}`);
}

async function main() {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    const ctx = await browser.newContext();
    const admin = await login(ctx, 'eric@rfppipeline.com', process.env.SANDBOX_PASSWORD || 'SandboxDrive2026!');
    console.log('signed in as eric@rfppipeline.com (master_admin)\n');

    // A solicitation that has not been through ingest — the phase gate is monotonic, so driving one
    // already past a phase would be refused for a reason that has nothing to do with the contract.
    const [sol] = await sql`
      SELECT id, solicitation_title, ingest_phase FROM curated_solicitations
      WHERE ingest_phase = 'not_started' ORDER BY created_at DESC LIMIT 1
    `;
    if (!sol) { console.error('no not_started solicitation to drive'); process.exit(2); }
    console.log(`solicitation ${sol.id} (${sol.ingest_phase})\n`);

    await fire(
      'finder:ingest.assessment_requested', 'finder', 'ingest.assessment_requested',
      () => api(admin, `/api/admin/rfp-curation/${sol.id}/assess-ingest`, { method: 'POST', body: '{}' }),
    );

    await fire(
      'finder:ingest.phase_requested', 'finder', 'ingest.phase_requested',
      () => api(admin, `/api/admin/rfp-curation/${sol.id}/ingest-phase`, {
        method: 'POST', body: JSON.stringify({ action: 'start' }),
      }),
    );

    await fire(
      'finder:solicitation.review_requested', 'finder', 'solicitation.review_requested',
      () => api(admin, `/api/admin/rfp-curation/${sol.id}/request-review`, {
        method: 'POST', body: JSON.stringify({ note: 'contract-lens coverage run' }),
      }),
    );
  } finally {
    await browser.close();
  }

  console.log('\n── summary ──');
  for (const o of ['fired', 'refused', 'not-tried', 'no-emitter']) {
    const n = results.filter((r) => r.outcome === o).length;
    if (n) console.log(`  ${o}: ${n}`);
  }
  const unfired = results.filter((r) => r.outcome !== 'fired');
  if (unfired.length) {
    console.log('\nNOT brought under the lens by this run — still UNCOVERED, not passing:');
    for (const r of unfired) console.log(`  · ${r.trigger} (${r.outcome})`);
  }
  await sql.end();
  process.exit(0);
}

main().catch(async (e) => { console.error(e); await sql.end(); process.exit(2); });
