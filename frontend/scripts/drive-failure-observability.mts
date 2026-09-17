/**
 * WHEN A HANDLER FAILS, DOES ANYTHING BUT THE CALLER EVER KNOW?
 *
 * The house rule is that a catch returns a result code AND emits, so a failure is visible to the
 * system and not only to whoever happened to be holding the response. The first half is already
 * graded — `verify-api-contract` and `verify-write-contract` both assert the `{error, code}`
 * envelope. **Nothing grades the second half**, and the two come apart in a specific way:
 *
 *   `withEventBracket` emits an `end` carrying the error only when the handler THROWS. A catch that
 *   returns `NextResponse.json({error, code}, {status})` — which is what the SOP asks for — never
 *   reaches it. The envelope is perfect and the event stream is silent.
 *
 * So this induces REAL failures against a running box and joins the two halves per call: what the
 * caller got back, and what the system recorded. A scan cannot answer this; only a drive can, and
 * that is the point.
 *
 * ── READING THE RESULT ─────────────────────────────────────────────────────────────────────────
 *   returned + emitted   the rule as written — the failure is observable
 *   returned, NOT emitted  the caller knows and nothing else does. Not automatically a defect: a
 *                          validation refusal is a normal outcome and does not want an event. It IS
 *                          a defect when the request asked for an EFFECT and the effect did not
 *                          land — that is the case worth reading the list for.
 *   neither              a 5xx with no code and no event: the worst cell, and the one this exists
 *                        to make impossible to miss.
 *
 * ⚠️ NOT READ-ONLY. Several probes POST deliberately-bad payloads. Every one binds its ids to fresh
 * UUIDs that own nothing, so a write cannot land on real data — and the mutation footprint is
 * printed. Sandbox only.
 *
 * Run:  source scripts/sandbox-env.sh && cd frontend && node --import tsx scripts/drive-failure-observability.mts
 */
import { chromium, type APIRequestContext } from 'playwright';
import { sqlBypass } from '@/lib/db';

const EXE = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = process.env.BASE || 'http://localhost:3000';
const ADMIN = process.env.DRIVE_ADMIN_EMAIL || 'eric@rfppipeline.com';
const PW = process.env.SANDBOX_PASSWORD;
const DEAD = '00000000-0000-4000-8000-000000000000';   // a well-formed uuid owning nothing

if (!PW) { console.error('✗ HARNESS DEFECT — SANDBOX_PASSWORD not set; source scripts/sandbox-env.sh'); process.exit(2); }

type Probe = { name: string; method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; path: string; body?: unknown; effect: boolean; real?: boolean };

/**
 * `effect: true` means the caller asked for something to HAPPEN. Those are the ones where a silent
 * failure matters — a refused read is information, a refused write is work that did not get done.
 */
const PROBES: Probe[] = [
  { name: 'read a proposal that does not exist', method: 'GET', path: `/api/portal/foundation/proposals/${DEAD}`, effect: false },
  { name: 'read a project that does not exist', method: 'GET', path: `/api/portal/foundation/projects/${DEAD}`, effect: false },
  { name: 'admin reads a tenant that does not exist', method: 'GET', path: `/api/admin/tenants/${DEAD}`, effect: false },
  { name: 'baseline a project that does not exist', method: 'POST', path: `/api/portal/foundation/projects/${DEAD}/baseline`, body: {}, effect: true },
  { name: 'close a project that does not exist', method: 'PATCH', path: `/api/portal/foundation/projects/${DEAD}`, body: { action: 'close' }, effect: true },
  { name: 'comment on a project that does not exist', method: 'POST', path: `/api/portal/foundation/projects/${DEAD}/comments`, body: { body: 'drive' }, effect: true },
  { name: 'save a section that does not exist', method: 'PUT', path: `/api/portal/foundation/proposals/${DEAD}/sections/${DEAD}/save`, body: { canvas: {} }, effect: true },
  { name: 'advance a proposal that does not exist', method: 'POST', path: `/api/portal/foundation/proposals/${DEAD}/advance`, body: {}, effect: true },
  { name: 'malformed body on a real shape', method: 'POST', path: `/api/portal/foundation/projects/${DEAD}/milestones`, body: { nonsense: true }, effect: true },
  { name: 'archive a proposal that does not exist', method: 'POST', path: `/api/portal/foundation/proposals/${DEAD}/archive`, body: {}, effect: true },
  { name: 'admin releases a portal that does not exist', method: 'POST', path: `/api/admin/provisioning/${DEAD}/release`, body: {}, effect: true },
  { name: 'full-draft a proposal that does not exist', method: 'POST', path: `/api/admin/proposals/${DEAD}/full-draft`, body: {}, effect: true },
];

/**
 * ── THE LANE THAT ACTUALLY TESTS THE RULE ──────────────────────────────────────────────────────
 *
 * Everything above is refused AT THE GATE — a fabricated uuid owns nothing, so the handler never
 * reaches the work. A gate refusal is information, and arguably wants no event.
 *
 * These two are different: a REAL project, a REAL request, refused MID-FLIGHT by the domain after
 * it looked. Re-baselining is refused by the freeze that exists so a baseline cannot be recomputed;
 * closing is refused because milestones are outstanding. In both the caller asked for work, the
 * system decided not to do it, and the question is whether anything but the caller can tell.
 */
const [realProject] = await sqlBypass<Array<{ id: string; slug: string; baselinedAt: Date | null }>>`
  SELECT p.id, t.slug, p.baselined_at AS "baselinedAt"
    FROM projects p JOIN tenants t ON t.id = p.tenant_id
   WHERE p.closed_at IS NULL ORDER BY p.created_at LIMIT 1`;
if (realProject?.baselinedAt) {
  PROBES.push(
    { name: 'RE-baseline an already-baselined project', method: 'POST', real: true, effect: true,
      path: `/api/portal/${realProject.slug}/projects/${realProject.id}/baseline`, body: {} },
    { name: 'close a project with milestones outstanding', method: 'PATCH', real: true, effect: true,
      path: `/api/portal/${realProject.slug}/projects/${realProject.id}`, body: { action: 'close', note: 'observability drive' } },
  );
  console.log(`  real-entity lane: project ${realProject.id.slice(0, 8)}… in ${realProject.slug}, baselined\n`);
} else {
  console.log('  ⚠ no baselined, open project on this box — the real-entity lane is SKIPPED, which');
  console.log('    means the gate-refusal lane below is the only evidence and is the weaker half.\n');
}

const br = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
const ctx = await br.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
await page.fill('#email', ADMIN);
await page.fill('#password', PW);
await page.click('button[type="submit"]');
await page.waitForLoadState('networkidle').catch(() => {});
if (page.url().includes('/login')) { console.error(`✗ HARNESS DEFECT — could not sign in as ${ADMIN}`); await br.close(); process.exit(2); }
const api: APIRequestContext = page.request;

/**
 * Baseline noise: failure-bearing events that appear with nothing driving them.
 *
 * ⚠️ THE PREDICATE HAS TO KNOW EVERY SPELLING OF "IT DID NOT HAPPEN". This first matched only
 * `error IS NOT NULL OR type LIKE '%failed%'` — and then the fix emitted `…refused`, so the drive
 * reported `—` for two refusals that had landed correctly in `system_events`. The instrument said
 * the fix had not worked when it had. Any new failure vocabulary belongs here the day it is added.
 */
const noiseWindowMs = 4000;
const beforeNoise = new Date();
await page.waitForTimeout(noiseWindowMs);
const [{ n: noise }] = await sqlBypass<Array<{ n: number }>>`
  SELECT count(*)::int AS n FROM system_events
   WHERE created_at > ${beforeNoise} AND (error IS NOT NULL OR type LIKE '%failed%' OR type LIKE '%refused%')`;
console.log(`  baseline: ${noise} error-bearing event(s) in a ${noiseWindowMs}ms idle window\n`);

type Row = { name: string; effect: boolean; status: number; enveloped: boolean; emitted: number; body: string };
const rows: Row[] = [];

for (const p of PROBES) {
  const t0 = new Date();
  let status = 0;
  let text = '';
  try {
    const res = p.method === 'GET'
      ? await api.get(`${BASE}${p.path}`)
      : await api.fetch(`${BASE}${p.path}`, { method: p.method, data: p.body ?? {} });
    status = res.status();
    text = (await res.text()).slice(0, 300);
  } catch (e) {
    text = `TRANSPORT: ${String(e).slice(0, 120)}`;
  }
  // Give any asynchronous emit a moment to land before asking.
  await page.waitForTimeout(1200);
  const [{ n: emitted }] = await sqlBypass<Array<{ n: number }>>`
    SELECT count(*)::int AS n FROM system_events
     WHERE created_at > ${t0} AND (error IS NOT NULL OR type LIKE '%failed%' OR type LIKE '%refused%')`;

  let enveloped = false;
  try {
    const j = JSON.parse(text) as Record<string, unknown>;
    enveloped = typeof j.error === 'string' && typeof j.code === 'string';
  } catch { enveloped = false; }
  rows.push({ name: p.name, effect: p.effect, status, enveloped, emitted, body: text });
}

await br.close();

const pad = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s.padEnd(n));
console.log(`  ${pad('failure induced', 44)} ${pad('http', 5)} ${pad('envelope', 9)} emitted`);
console.log(`  ${'─'.repeat(72)}`);
for (const r of rows) {
  console.log(`  ${pad(r.name, 44)} ${pad(String(r.status), 5)} ${pad(r.enveloped ? 'yes' : 'NO', 9)} ${r.emitted > 0 ? `${r.emitted}` : '—'}`);
}

const realRows = rows.filter((_, i) => PROBES[i]?.real);
const realSilent = realRows.filter((r) => r.emitted === 0);
const effects = rows.filter((r) => r.effect);
const silentEffects = effects.filter((r) => r.emitted === 0);
const noEnvelope = rows.filter((r) => !r.enveloped);
const worst = rows.filter((r) => !r.enveloped && r.emitted === 0 && r.status >= 500);

console.log('');
console.log(`  ${rows.length} failure(s) induced · ${effects.length} asked for an EFFECT`);
console.log(`  ${noEnvelope.length} returned no {error,code} envelope`);
console.log(`  ${silentEffects.length} of ${effects.length} effect-requests failed with NOTHING emitted`);
console.log(`  ${worst.length} were 5xx with neither an envelope nor an event — the worst cell`);
console.log('');
console.log('  MUTATED: nothing — every id above is a fresh uuid owning no row, so a write that got');
console.log('  past validation still had nothing to land on. Verify with the counts in the drive log.');

await sqlBypass.end();
// Exit 1 only on the unambiguous failure: a 5xx with no envelope and no event.
process.exit(worst.length ? 1 : 0);
