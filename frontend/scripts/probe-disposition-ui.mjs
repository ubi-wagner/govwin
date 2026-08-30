/** Drive the build-or-mark control as a real rfp_admin, in a real browser.
 *
 * The route and the provisioning rule are proven elsewhere (probe-portal-forms.mjs,
 * probe-provision-elsewhere.mts). This proves the part only a browser can: that an rfp_admin can
 * SEE which volumes and items are still undecided, and DECIDE them — with a note — without leaving
 * the workspace. An API-only override is not a capability an admin has.
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
const SHOT = process.env.SHOT_DIR || '/tmp/claude-0/-home-user-govwin/34d597b2-183f-5787-9057-fc7251e3f9ff/scratchpad';

const sql = postgres(process.env.DATABASE_URL_OWNER, {
  max: 3,
  transform: { column: { from: (s) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase()) } },
});
let bad = 0;
const check = (ok, s, extra = '') => { if (!ok) bad++; console.log(`  ${ok ? '✓' : '✗'} ${s}${extra ? `  — ${extra}` : ''}`); };

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();
await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
await page.fill('input[name="email"]', 'eric@rfppipeline.com');
await page.fill('input[name="password"]', process.env.RFP_ADMIN_PW || 'RFPAdmin2026!');
await Promise.all([
  page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 }),
  page.click('button[type="submit"]'),
]);

// Start from a known state: clear every disposition on this master so the UI has to show the
// undecided case, which is the one the control exists for.
await sql`UPDATE solicitation_volumes SET metadata = metadata - 'dsipOnly'
          WHERE solicitation_id = ${SOL}::uuid AND volume_number = 7`;

console.log('\n1. the workspace shows what is still undecided');
await page.goto(`${BASE}/admin/rfp-curation/${SOL}`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);

// The Response Volumes panel renders inline on this page — do NOT go hunting for a "volume" tab:
// getByRole(/volume/i) also matches "+ Add Volume", which opens a modal whose backdrop then
// swallows every subsequent click.
await page.getByText('Response Volumes').first().scrollIntoViewIfNeeded().catch(() => {});
await page.waitForTimeout(400);

const assumed = page.getByRole('button', { name: /Assumed: portal form/i });
check((await assumed.count()) > 0, 'an item-less volume reads "Assumed: portal form", not silently blank',
  `found ${await assumed.count()}`);
const authoredChips = page.getByRole('button', { name: /^Authored here/i });
check((await authoredChips.count()) > 0, 'items carry a disposition chip too', `found ${await authoredChips.count()}`);
await page.screenshot({ path: `${SHOT}/disposition-1-workspace.png`, fullPage: false });

console.log('\n2. the admin decides it, with a note');
await assumed.first().click();
await page.waitForTimeout(400);
const NOTE = 'Complete this disclosure in DSIP — nothing is uploaded to the workspace.';
const ta = page.locator('textarea[placeholder*="Filed in SAM"]').first();
check(await ta.count() > 0, 'the note field is offered alongside the decision');
await ta.fill(NOTE);
await page.screenshot({ path: `${SHOT}/disposition-2-popover.png`, fullPage: false });
await page.getByRole('button', { name: /^Completed elsewhere$/ }).first().click();
await page.waitForTimeout(1500);

const [row] = await sql`
  SELECT expert_notes AS "expertNotes", metadata FROM solicitation_volumes
  WHERE solicitation_id = ${SOL}::uuid AND volume_number = 7`;
check(row.metadata?.dsipOnly === true, 'the click marked it completed-elsewhere');
check(row.expertNotes === NOTE, 'the typed note reached the master record');

// The chip must update in place — a stale "Assumed" after a successful save is a lie.
await page.waitForTimeout(500);
const nowMarked = page.getByRole('button', { name: /Completed elsewhere ✎/ });
check((await nowMarked.count()) > 0, 'the chip updates in place to "Completed elsewhere ✎"');
await page.screenshot({ path: `${SHOT}/disposition-3-marked.png`, fullPage: false });

console.log('\n3. the readiness bar says WHY it is short');
const [portal] = await sql`
  SELECT p.id FROM proposal_portals p
  JOIN opportunities o ON o.id = p.opportunity_id
  WHERE o.solicitation_id = ${SOL}::uuid LIMIT 1`;
if (!portal) {
  console.log('  – no provisioning portal for this master; skipping the cockpit leg');
} else {
  // Make one item undecided so the bar has something to report.
  const [it] = await sql`
    SELECT vri.id FROM volume_required_items vri
    JOIN solicitation_volumes sv ON sv.id = vri.volume_id
    WHERE sv.solicitation_id = ${SOL}::uuid AND vri.template_id IS NULL LIMIT 1`;
  if (it) await sql`UPDATE volume_required_items SET metadata = metadata - 'dsipOnly' WHERE id = ${it.id}::uuid`;

  await page.goto(`${BASE}/admin/provisioning/${portal.id}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  const body = await page.textContent('body');
  check(/still need a mold or a mark|Every item is built or marked/.test(body ?? ''),
    'the bar reports the undecided-items leg');
  check(/await confirmation|has a decision on record/.test(body ?? ''),
    'the bar reports the item-less-volume leg');
  await page.screenshot({ path: `${SHOT}/disposition-4-readiness.png`, fullPage: false });
  if (it) await sql`UPDATE volume_required_items SET metadata = COALESCE(metadata,'{}'::jsonb) || '{"dsipOnly":true}'::jsonb WHERE id = ${it.id}::uuid`;
}

console.log(`\n  screenshots → ${SHOT}/disposition-*.png`);
console.log(bad === 0 ? '\n✓ an rfp_admin can see and decide every outstanding item without leaving the workspace' : `\n✗ ${bad} check(s) failed`);
await browser.close();
await sql.end();
process.exit(bad === 0 ? 0 : 1);
