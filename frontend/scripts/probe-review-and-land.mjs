/** Drive the rfp_admin REVIEW-AND-LAND path on a matrix the machine refused to publish.
 *
 * Four solicitations in this sandbox landed on the AUTO path: the provenance audit found nothing
 * disqualifying, so the chain ran extract → matrix → review → land unattended. Two did not. Both
 * CSOs parked at the matrix gate with an audit blocker, and `stage-skeleton.landSkeleton` refused
 * the auto landing with "a person must land this one".
 *
 * That refusal is the product working. But the OTHER half of it — the human actually reviewing the
 * gap and landing anyway — had never been driven, so nothing proved the parked state was
 * RECOVERABLE rather than terminal. This drives it end to end and pins the three rules that make
 * it a gate rather than a speed bump:
 *
 *   1. auto is refused while a blocker stands (409 LAND_BLOCKED, blockers named verbatim)
 *   2. the review gate cannot be "approved" past — its only exits are LAND or REGENERATE
 *   3. a human landing the same draft IS allowed — that is a person taking responsibility for a
 *      known gap, which is a different act from a machine doing it silently
 *
 * and then carries it the rest of the way (molds → complete) so the solicitation reaches a state a
 * buyer can actually be sold.
 */
import { chromium } from 'playwright';
import postgres from 'postgres';

const BASE = 'http://localhost:3000';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const sql = postgres(process.env.DATABASE_URL_OWNER, { max: 3 });
let bad = 0;
const check = (ok, s, extra = '') => { if (!ok) bad++; console.log(`  ${ok ? '✓' : '✗'} ${s}${extra ? `  — ${extra}` : ''}`); };
const post = (page, sol, body) => page.request.post(`${BASE}/api/admin/rfp-curation/${sol}/ingest-phase`, { data: body });

// Pick the parked CSO by state, not by a pinned id — the point is the STATE, and pinning an id
// makes the probe lie the moment the fixture is rebuilt.
const [parked] = await sql`
  SELECT cs.id, cs.ingest_phase AS phase,
         (SELECT d.original_filename FROM solicitation_documents d
           WHERE d.solicitation_id = cs.id ORDER BY d.created_at LIMIT 1) AS doc,
         (SELECT count(*)::int FROM solicitation_compliance_drafts scd,
                 LATERAL jsonb_array_elements(COALESCE(scd.audit->'findings','[]'::jsonb)) f
           WHERE scd.solicitation_id = cs.id AND scd.status = 'staged'
             AND f->>'severity' = 'blocker') AS blockers
  FROM curated_solicitations cs
  WHERE cs.ingest_phase = 'matrix' AND cs.status = 'new'
    AND EXISTS (SELECT 1 FROM solicitation_compliance_drafts d
                 WHERE d.solicitation_id = cs.id AND d.status = 'staged')
  ORDER BY cs.created_at DESC LIMIT 1`;

if (!parked) { console.log('no solicitation is parked at the matrix gate — nothing to drive'); await sql.end(); process.exit(0); }
console.log(`\nparked at the matrix gate: ${parked.doc}`);
console.log(`  solicitation ${parked.id}   blockers: ${parked.blockers}`);

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
const page = await (await browser.newContext()).newPage();
await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
await page.fill('input[name="email"]', 'eric@rfppipeline.com');
await page.fill('input[name="password"]', process.env.RFP_ADMIN_PW || 'RFPAdmin2026!');
await Promise.all([page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 }), page.click('button[type="submit"]')]);

// ── what the admin sees at the gate ─────────────────────────────────────────
console.log('\n1. the gate panel names the gap');
const panel = await (await page.request.get(`${BASE}/api/admin/rfp-curation/${parked.id}/ingest-phase`)).json();
const findings = panel?.data?.draft?.audit?.findings ?? [];
const blockers = findings.filter((f) => f.severity === 'blocker');
check(panel?.data?.phase === 'matrix', 'phase is matrix', panel?.data?.phase);
check(blockers.length > 0, `${blockers.length} blocker(s) surfaced to the reviewer`);
for (const b of blockers) console.log(`     ⚠ ${b.issue}`);

// ── 1. the machine is refused ───────────────────────────────────────────────
console.log('\n2. AUTO is refused while the blocker stands');
// DELTA, not absolute. Re-driving over a solicitation that was landed once before (the phase and
// draft status reset, the compliance rows left in place) would read a pre-existing row as proof
// that auto published one — a probe that passes for the wrong reason on the first run and lies on
// the second. What must be true is that AUTO ADDS NOTHING.
const published = async () => {
  const [r] = await sql`
    SELECT (SELECT count(*)::int FROM solicitation_compliance WHERE solicitation_id = ${parked.id}::uuid) AS compl,
           (SELECT count(*)::int FROM solicitation_volumes    WHERE solicitation_id = ${parked.id}::uuid) AS vols,
           (SELECT count(*)::int FROM solicitation_compliance_drafts
             WHERE solicitation_id = ${parked.id}::uuid AND status = 'landed') AS "landedDrafts"`;
  return r;
};
const beforeAuto = await published();
const auto = await post(page, parked.id, { action: 'auto' });
const afterAuto = await published();
check(afterAuto.landedDrafts === beforeAuto.landedDrafts,
  'auto landed no draft — the matrix is still staged',
  `landed drafts ${beforeAuto.landedDrafts} → ${afterAuto.landedDrafts}`);
check(afterAuto.compl === beforeAuto.compl && afterAuto.vols === beforeAuto.vols,
  'auto published no compliance and no volumes',
  `compliance ${beforeAuto.compl}→${afterAuto.compl}, volumes ${beforeAuto.vols}→${afterAuto.vols}`);
check(auto.ok(), 'the auto request itself is accepted (it stages; the LAND hop is what refuses)', String(auto.status()));

// auto reset the phase to 'extract' to run the full chain. Walk it back to the gate the human is
// actually standing at, the way the panel's own Approve button does.
let ph = (await (await page.request.get(`${BASE}/api/admin/rfp-curation/${parked.id}/ingest-phase`)).json())?.data?.phase;
console.log(`\n3. walk the human gate: ${ph} → review`);
for (let i = 0; i < 4 && ph !== 'review'; i++) {
  const r = await post(page, parked.id, { action: 'approve' });
  const j = await r.json();
  if (!r.ok()) { check(false, `approve from ${ph}`, j?.code ?? String(r.status())); break; }
  ph = j?.data?.phase;
  console.log(`     → ${ph}`);
}
check(ph === 'review', 'reached the adversarial review gate', ph);

// ── 2. the review gate cannot be approved past ──────────────────────────────
console.log('\n4. the review gate has no "approve" exit');
const approvePast = await post(page, parked.id, { action: 'approve' });
const apJson = await approvePast.json();
check(approvePast.status() === 409 && apJson?.code === 'GATE_REQUIRES_LAND',
  'approve at the review gate is refused — it would claim a write that never happened',
  `${approvePast.status()} ${apJson?.code ?? ''}`);

// ── 3. the human lands it ───────────────────────────────────────────────────
console.log('\n5. the reviewer lands it — taking responsibility for the named gap');
const land = await post(page, parked.id, { action: 'land' });
const landJson = await land.json();
check(land.ok(), 'the human land is ALLOWED despite the blocker', land.ok() ? '' : `${land.status()} ${landJson?.code ?? ''} ${landJson?.error ?? ''}`);
if (land.ok()) {
  console.log(`     volumes=${landJson?.data?.volumes ?? '?'}  items=${landJson?.data?.items ?? '?'}  compliance=${landJson?.data?.compliance ?? 'written'}`);
}

const [landed] = await sql`
  SELECT (SELECT count(*)::int FROM solicitation_compliance WHERE solicitation_id = ${parked.id}::uuid) AS compl,
         (SELECT count(*)::int FROM solicitation_volumes    WHERE solicitation_id = ${parked.id}::uuid) AS vols,
         (SELECT count(*)::int FROM volume_required_items vri JOIN solicitation_volumes sv ON sv.id=vri.volume_id
           WHERE sv.solicitation_id = ${parked.id}::uuid) AS items,
         -- Aliases quoted camelCase deliberately: this probe opens its OWN postgres client, which
         -- has none of lib/db's toCamel transform, so a snake_case alias stays snake_case here and
         -- camelCases inside the app. Naming it once, the same both ways, removes the trap.
         (SELECT d.status FROM solicitation_compliance_drafts d
           WHERE d.solicitation_id = ${parked.id}::uuid ORDER BY d.created_at DESC LIMIT 1) AS "draftStatus",
         (SELECT d.landed_by IS NOT NULL FROM solicitation_compliance_drafts d
           WHERE d.solicitation_id = ${parked.id}::uuid ORDER BY d.created_at DESC LIMIT 1) AS "hasLander"`;
check(landed.compl === 1, 'compliance row written', String(landed.compl));
check(landed.vols > 0, `${landed.vols} volume(s) written`);
check(landed.items > 0, `${landed.items} required item(s) written`);
check(landed.draftStatus === 'landed', 'the draft is marked landed', landed.draftStatus);
check(landed.hasLander === true, 'the landing records WHO took responsibility (landed_by)');

// ── the rest of the way: molds, so a buyer gets something to fill ───────────
console.log('\n6. carry it to molds');
const toMolds = await post(page, parked.id, { action: 'approve' });
check(toMolds.ok(), 'landed → molds', toMolds.ok() ? (await toMolds.json())?.data?.phase : String(toMolds.status()));
const proposed = await post(page, parked.id, { action: 'propose_molds' });
const propJson = await proposed.json();
check(proposed.ok(), 'a skeleton is proposed off the LANDED matrix',
  proposed.ok() ? `source=${propJson?.data?.source} sections=${propJson?.data?.volumes?.reduce((a, v) => a + v.sections.length, 0)}` : `${proposed.status()} ${propJson?.code ?? ''}`);
const built = await post(page, parked.id, { action: 'build_molds' });
const builtJson = await built.json();
check(built.ok(), 'molds built',
  built.ok() ? `built=${builtJson?.data?.built} linked=${builtJson?.data?.linked} phase=${builtJson?.data?.phase}` : `${built.status()} ${builtJson?.code ?? ''}`);

// ── 7. and the worker's in-flight hops must not undo any of it ──────────────
//
// The `auto` at step 2 dispatched the chain, whose hops each wait on an agent cohort — so they are
// STILL RUNNING while the human does everything above. Before the monotonic guard in
// `advance_ingest_phase`, they landed one after another and wrote ingest_phase back down:
// extract's hop set 'matrix', matrix's set 'review', and the solicitation that had reached
// 'complete' read as "awaiting review" in the panel. The compliance row, the six volumes, the 22
// items and the 21 molds were all there; only the state lied.
console.log('\n7. the phase holds while the auto chain finishes behind it');
const settle = 30_000, t0 = Date.now();
let phaseNow = null, dipped = null;
while (Date.now() - t0 < settle) {
  const [r] = await sql`SELECT ingest_phase AS "ingestPhase" FROM curated_solicitations WHERE id = ${parked.id}::uuid`;
  phaseNow = r?.ingestPhase;
  if (phaseNow !== 'complete' && dipped === null) dipped = phaseNow;
  await new Promise((r2) => setTimeout(r2, 2000));
}
check(phaseNow === 'complete', `phase settled at complete after ${settle / 1000}s of worker hops`, String(phaseNow));
check(dipped === null, 'no hop rewound it mid-flight', dipped ? `dipped to '${dipped}'` : '');

// ── the shape a buyer would receive ─────────────────────────────────────────
const shape = await sql`
  SELECT sv.volume_number AS num, sv.volume_name AS name,
         count(vri.id)::int AS items,
         count(vri.template_id)::int AS molded
  FROM solicitation_volumes sv LEFT JOIN volume_required_items vri ON vri.volume_id = sv.id
  WHERE sv.solicitation_id = ${parked.id}::uuid
  GROUP BY 1,2 ORDER BY 1`;
console.log('\n   the shape a buyer receives:');
for (const v of shape) console.log(`     V${v.num}  ${String(v.name).slice(0, 46).padEnd(48)} ${v.items} item(s), ${v.molded} molded`);

console.log(bad === 0 ? '\n✓ a parked matrix is recoverable by the reviewer, and only by the reviewer' : `\n✗ ${bad} check(s) failed`);
await browser.close();
await sql.end();
process.exit(bad === 0 ? 0 : 1);
