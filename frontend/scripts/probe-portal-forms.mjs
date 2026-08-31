/** A portal form is not a blank page, and completed-elsewhere is not "not required".
 *
 * Two rules, proven against a real master and a real provision:
 *
 *   1. A volume the extraction found NO items under is a portal form by default. It used to become
 *      a blank authorable section named after the volume, which the drafter then filled with prose.
 *      The rfp_admin's NOTE says where the buyer files it; the OVERRIDE handles the volume that
 *      really is written here and simply wasn't itemised.
 *
 *   2. Marking anything completed-elsewhere used to remove it from the buyer's proposal entirely —
 *      no section (right) and no compliance row (wrong). On the DoW 2026 SBIR build the master had
 *      seven volumes and the buyer could see two; the DD Form 2345, the SAM reps & certs, the FWA
 *      certificate and the foreign-affiliations disclosure were all still mandatory and all silently
 *      absent. Every one must now appear as a checklist row carrying the note.
 *
 * Run: node scripts/probe-portal-forms.mjs      (needs the sandbox env + a built, running app)
 */
import { chromium } from 'playwright';
import postgres from 'postgres';

// One base URL, three historic spellings — and this file used the worst of them: a LITERAL, which
// ignores both env names silently. A drive pinned to :3000 runs against whatever build happens to
// be serving there, so it can report a stale product as broken, or a fixed one as still broken.
// (That is exactly how the release-gate change looked like a product failure for two runs.)
const BASE = process.env.GUIDE_BASE || process.env.BASE_URL || 'http://localhost:3000';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const SOL = process.env.SOL_ID || 'bba0bd22-edd6-430c-a95b-7265742bac58';

const sql = postgres(process.env.DATABASE_URL_OWNER, {
  max: 3,
  transform: { column: { from: (s) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase()) } },
});
let bad = 0;
const check = (ok, s, extra = '') => { if (!ok) bad++; console.log(`  ${ok ? '✓' : '✗'} ${s}${extra ? `  — ${extra}` : ''}`); };

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
const page = await (await browser.newContext()).newPage();
await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
await page.fill('input[name="email"]', 'eric@rfppipeline.com');
await page.fill('input[name="password"]', process.env.RFP_ADMIN_PW || 'RFPAdmin2026!');
await Promise.all([
  page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 }),
  page.click('button[type="submit"]'),
]);

// ── the master ───────────────────────────────────────────────────────────────
const vols = await sql`
  SELECT sv.id, sv.volume_number AS "volumeNumber", sv.volume_name AS "volumeName",
         sv.expert_notes AS "expertNotes", sv.metadata,
         (SELECT count(*)::int FROM volume_required_items vri WHERE vri.volume_id = sv.id) AS items
  FROM solicitation_volumes sv WHERE sv.solicitation_id = ${SOL}::uuid ORDER BY sv.volume_number`;
console.log(`\nmaster has ${vols.length} volumes`);
for (const v of vols) {
  console.log(`  V${v.volumeNumber}  ${String(v.items).padStart(2)} items  dsipOnly=${JSON.stringify(v.metadata?.dsipOnly)}  ${v.volumeName.slice(0, 46)}`);
}
const empty = vols.filter((v) => v.items === 0);
check(empty.length > 0, `the master has an item-less volume to test (${empty.length})`);

// ── 1. the note reaches the master through the route ─────────────────────────
console.log('\n1. rfp_admin annotates the item-less volume');
const target = empty[0];
const NOTE = 'Complete this disclosure in the DSIP portal — no document is uploaded here.';
let r = await page.request.patch(`${BASE}/api/admin/rfp-curation/${SOL}/volumes/${target.id}`, {
  data: { disposition: 'external', note: NOTE },
});
check(r.ok(), `PATCH volume ${target.volumeNumber} external + note`, r.ok() ? '' : `${r.status()} ${await r.text()}`);
let [row] = await sql`SELECT expert_notes AS "expertNotes", metadata FROM solicitation_volumes WHERE id=${target.id}::uuid`;
check(row.expertNotes === NOTE, 'the note is on the master record');
check(row.metadata?.dsipOnly === true, 'the volume is marked completed-elsewhere');

// re-PATCH with NO note — a disposition change must not wipe the note
r = await page.request.patch(`${BASE}/api/admin/rfp-curation/${SOL}/volumes/${target.id}`, { data: { disposition: 'external' } });
[row] = await sql`SELECT expert_notes AS "expertNotes" FROM solicitation_volumes WHERE id=${target.id}::uuid`;
check(r.ok() && row.expertNotes === NOTE, 'a later disposition change with no note PRESERVES the note');

// the override, and back again
r = await page.request.patch(`${BASE}/api/admin/rfp-curation/${SOL}/volumes/${target.id}`, { data: { disposition: 'authored' } });
[row] = await sql`SELECT metadata FROM solicitation_volumes WHERE id=${target.id}::uuid`;
check(r.ok() && row.metadata?.dsipOnly === false, 'the override records an explicit "authored here" (false, not absent)');
await page.request.patch(`${BASE}/api/admin/rfp-curation/${SOL}/volumes/${target.id}`, { data: { disposition: 'external', note: NOTE } });

const badNote = await page.request.patch(`${BASE}/api/admin/rfp-curation/${SOL}/volumes/${target.id}`, {
  data: { disposition: 'external', note: { evil: true } },
});
check(badNote.status() === 400, 'a non-string note is refused 400', String(badNote.status()));

// ── 2. readiness surfaces an UNDECIDED item-less volume ──────────────────────
console.log('\n2. readiness counts an item-less volume nobody has ruled on');
const undecided = async () => {
  const [x] = await sql`
    SELECT count(*)::int AS n FROM solicitation_volumes sv
    WHERE sv.solicitation_id = ${SOL}::uuid AND sv.metadata->>'dsipOnly' IS NULL
      AND NOT EXISTS (SELECT 1 FROM volume_required_items vri WHERE vri.volume_id = sv.id)`;
  return x.n;
};
check((await undecided()) === 0, 'every item-less volume on this master is now decided', `undecided=${await undecided()}`);
// strip the decision back off and confirm it reappears
await sql`UPDATE solicitation_volumes SET metadata = metadata - 'dsipOnly' WHERE id=${target.id}::uuid`;
check((await undecided()) === 1, 'stripping the decision makes it read as undecided again');
await sql`UPDATE solicitation_volumes SET metadata = COALESCE(metadata,'{}'::jsonb) || '{"dsipOnly":true}'::jsonb WHERE id=${target.id}::uuid`;

// The provision leg lives in probe-provision-elsewhere.mts, which runs the REAL
// provisionProposalForPortal through tsx and counts what reaches the buyer. Splitting them keeps
// this one to what only a running server can prove: the routes, their authz and their validation.

console.log(bad === 0 ? '\n✓ portal forms are tracked, not invented and not dropped' : `\n✗ ${bad} check(s) failed`);
await browser.close();
await sql.end();
process.exit(bad === 0 ? 0 : 1);
