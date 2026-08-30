/**
 * THE SCOPE BAR, DRIVEN — does choosing a rung actually change what gets reviewed?
 *
 * The unit tests prove `resolveScope` computes the right ladder. The API harness proves a scoped
 * request queues the right row. Neither touches the thing in between: a person clicking a rung in
 * the right-hand bar and getting a review of THAT rung.
 *
 * Four blocks:
 *
 *   A · THE LADDER RENDERS, AND IT NAMES REAL RUNGS. On the fluid proposal surface — the one where
 *       every rung is meaningful — the bar must show `Document` at minimum, and `Section` once a
 *       node is clicked. The section rung is the one the compliance matrix and the mold address;
 *       the assembled document is FLAT, so it exists only because assembly's `sectionOf` map is
 *       threaded through. If that thread breaks, the ladder silently loses its most important rung
 *       and everything still "works".
 *
 *   B · FOCUS FOLLOWS THE CANVAS. Clicking a node in the document moves the scope to that node. A
 *       panel with its own private notion of what is selected is how one click ends up meaning two
 *       different things in two places.
 *
 *   C · THE ACTIONS ARE FILTERED BY LEVEL, NOT DISABLED. "Re-assemble from the library" appears at
 *       section and nowhere else, because the assembler builds sections — there is no smaller thing
 *       it produces. A greyed-out control would invite a person to wonder what they did wrong.
 *
 *   D · CLICKING REVIEW QUEUES THAT SCOPE. The end-to-end claim: the row that lands in
 *       `agent_task_queue` carries the level the bar was showing. Read from Postgres, not from a
 *       toast — a toast proves the fetch resolved, not that anything was stored.
 *
 * Own scratch build, swept on startup, purged at the end. The fixture is never touched.
 *
 *   cd frontend && node scripts/verify-scope-bar.mjs
 */
import { chromium } from 'playwright';
import postgres from 'postgres';
import { randomUUID } from 'node:crypto';

// One base URL, two historic names: the lenses read GUIDE_BASE, the drives read BASE_URL, and
// a harness that silently ignores the one you passed fails with a connection error that reads
// like the app is down. Accept both everywhere; the family's own name still wins.
const BASE = process.env.GUIDE_BASE || process.env.BASE_URL || 'http://localhost:3001';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const DB = process.env.GUIDE_DB || 'postgresql://govtech:changeme@localhost:5432/govtech_intel';
const sql = postgres(DB, { max: 2, transform: { column: { from: (c) => c } } });

const PROBE = 'scopebar-probe';
let ok = true;
const A = (label, cond, extra = '') => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!cond) ok = false;
};
const H = (t) => console.log(`\n${t}\n${'─'.repeat(t.length)}`);

async function login(ctx, email, pw) {
  const p = await ctx.newPage();
  await p.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('#email', { timeout: 20000 });
  await p.fill('#email', email); await p.fill('#password', pw);
  await p.click('button[type="submit"]');
  await p.waitForLoadState('networkidle').catch(() => {});
  await p.waitForTimeout(2500);
  if (p.url().includes('/login')) throw new Error(`login failed for ${email}`);
  return p;
}

const fkChildren = (ref) => sql`
  SELECT c.conrelid::regclass::text AS child, a.attname AS col
  FROM pg_constraint c
  JOIN unnest(c.conkey) AS k(attnum) ON true
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
  WHERE c.contype = 'f' AND c.confrelid = ${ref}::regclass
    AND array_length(c.conkey, 1) = 1`;

async function purgeRows(table, col, ids, depth = 0) {
  if (!ids.length || depth > 4) return;
  for (const k of await fkChildren(table)) {
    if (k.child === table) continue;
    const rows = await sql.unsafe(`SELECT id FROM ${k.child} WHERE ${k.col} = ANY($1::uuid[])`, [ids]).catch(() => []);
    if (rows.length) await purgeRows(k.child, 'id', rows.map((r) => r.id), depth + 1);
    await sql.unsafe(`DELETE FROM ${k.child} WHERE ${k.col} = ANY($1::uuid[])`, [ids]).catch(() => {});
  }
  await sql.unsafe(`DELETE FROM ${table} WHERE ${col} = ANY($1::uuid[])`, [ids]);
}

/** Frame + node shapes COPIED from stored rows — an invented one renders an error boundary. */
const FRAME = {
  width: 612, height: 792,
  margins: { top: 72, right: 72, bottom: 72, left: 72 },
  format: 'letter', header: null, footer: null,
  font_default: { family: 'Times New Roman', size: 11 },
  line_spacing: 1, min_font_size: 10, max_pages: 10, max_slides: null,
};
const PROSE = 'Foundation 3DCP prints structural concrete walls at forty millimetres per second, and '
  + 'the formwork automation cut on-site labour by sixty percent across every validated build. ';
const node = (id, reps) => ({
  id, type: 'text_block', content: { text: PROSE.repeat(reps) },
  style: {}, provenance: { source: 'manual' }, history: [], library_eligible: false,
});
const canvasOf = (title, nodes) => JSON.stringify({
  version: 2, document_id: `${PROBE}-${title}`, canvas: FRAME, nodes,
  metadata: { title, status: 'in_progress', version_number: 1 },
});

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
let proposalId = null;

try {
  const [foundation] = await sql`SELECT id, slug FROM tenants WHERE slug = 'foundation'`;
  const [anyOpp] = await sql`SELECT id FROM opportunities LIMIT 1`;
  if (!foundation || !anyOpp) throw new Error('missing foundation tenant or opportunity');

  const stale = await sql`SELECT id FROM proposals WHERE title LIKE ${PROBE + '%'}`;
  if (stale.length) { await purgeRows('proposals', 'id', stale.map((r) => r.id)); console.log(`· swept ${stale.length} stale`); }

  proposalId = randomUUID();
  const secA = randomUUID();
  const secB = randomUUID();
  await sql`
    INSERT INTO proposals (id, tenant_id, opportunity_id, title, stage, is_locked)
    VALUES (${proposalId}::uuid, ${foundation.id}::uuid, ${anyOpp.id}::uuid, ${PROBE + ' · bar'}, 'draft', false)`;
  await sql`
    INSERT INTO proposal_sections
      (id, proposal_id, section_number, title, content, status, sort_index, version, is_locked, volume_name, volume_number)
    VALUES
      (${secA}::uuid, ${proposalId}::uuid, '1', 'Technical Approach',
       ${canvasOf('Technical Approach', [node('a1', 5), node('a2', 4)])}, 'in_progress', 1, 1, false, 'Volume I', 1),
      (${secB}::uuid, ${proposalId}::uuid, '2', 'Work Plan',
       ${canvasOf('Work Plan', [node('b1', 14)])}, 'in_progress', 2, 1, false, 'Volume I', 1)`;

  const ctx = await browser.newContext({ viewport: { width: 1600, height: 950 } });
  const page = await login(ctx, 'kate.ulepic@foundation3dp.com', 'DemoPass123!');
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));

  // The fluid document surface — the one where every rung is meaningful. It is a TAB on the
  // proposal workspace, not a route: `/…/document` is not addressable, and navigating there gets a
  // page that renders fine and contains none of this. (First version of this harness did exactly
  // that and reported "no bar found", which reads like a product failure and was a navigation bug.)
  await page.goto(`${BASE}/portal/${foundation.slug}/proposals/${proposalId}`,
    { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  const onTab = await page.evaluate(() => {
    const t = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Document');
    if (!t) return false;
    t.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return true;
  });
  if (!onTab) throw new Error('the Document tab is not offered to this actor — nothing further is measurable');
  await page.waitForTimeout(5000);

  const readBar = () => page.evaluate(() => {
    const bar = [...document.querySelectorAll('div')].find(
      (d) => d.querySelector('span')?.textContent?.trim() === 'Scope');
    if (!bar) return null;
    const chips = [...bar.querySelectorAll('button')]
      .filter((b) => b.querySelector('span.rounded-full, span.h-1\\.5'))
      .map((b) => ({ label: b.textContent?.trim() ?? '', focused: b.getAttribute('aria-current') === 'true' }));
    const actions = [...bar.querySelectorAll('button')]
      .map((b) => b.textContent?.trim() ?? '')
      .filter((t) => /review|assemble/i.test(t));
    const stats = [...bar.querySelectorAll('dd')].map((d) => d.textContent?.trim());
    return { chips, actions, stats };
  });

  // ── A · the ladder renders and names real rungs ─────────────────────────────────────────────
  H('A · the ladder renders on the fluid surface');
  const errorSurface = await page.evaluate(() =>
    /Something went wrong|Application error/i.test(document.body.innerText || ''));
  A('the document surface rendered', !errorSurface, errorSurface ? 'error boundary' : '');
  A('no client throw', errors.length === 0, errors.slice(0, 2).join(' | '));

  let bar = await readBar();
  A('the Scope bar is mounted', !!bar, bar ? '' : 'no bar found');
  if (!bar) throw new Error('scope bar absent — nothing further is measurable');
  A('it opens focused on the whole document',
    bar.chips.some((c) => c.focused && /document/i.test(c.label)),
    JSON.stringify(bar.chips));
  A('it states blocks · pages · characters', bar.stats.length === 3, JSON.stringify(bar.stats));

  // ── B · focus follows the canvas ────────────────────────────────────────────────────────────
  H('B · clicking a node in the document moves the scope');
  const clicked = await page.evaluate(() => {
    const n = document.querySelector('[data-node-id]:not([data-node-id^="sec:"])');
    if (!n) return null;
    n.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return n.getAttribute('data-node-id');
  });
  await page.waitForTimeout(900);
  bar = await readBar();
  A('a node was clickable', !!clicked, clicked ?? 'none found');
  A('the focused rung is now the element', bar.chips.some((c) => c.focused && /text_block|heading|element/i.test(c.label)),
    JSON.stringify(bar.chips.map((c) => `${c.focused ? '*' : ''}${c.label}`)));
  // THE THREAD THAT COULD SILENTLY BREAK: the assembled doc is flat, so the section rung exists
  // only because `sectionOf` is passed through. Without it the ladder still renders — just wrong.
  A('the SECTION rung appears — sectionOf is threaded through',
    bar.chips.some((c) => /technical approach|work plan/i.test(c.label)),
    JSON.stringify(bar.chips.map((c) => c.label)));

  // ── C · actions filtered by level ───────────────────────────────────────────────────────────
  H('C · the actions offered depend on the rung');
  const atNode = bar.actions.slice();
  A('review is offered at element level', atNode.some((a) => /review/i.test(a)), JSON.stringify(atNode));
  A('re-assemble is NOT offered at element level — the assembler builds sections',
    !atNode.some((a) => /assemble/i.test(a)), JSON.stringify(atNode));

  // Widen to the section by clicking its chip.
  const widened = await page.evaluate(() => {
    const bar = [...document.querySelectorAll('div')].find(
      (d) => d.querySelector('span')?.textContent?.trim() === 'Scope');
    const chip = [...(bar?.querySelectorAll('button') ?? [])]
      .find((b) => /technical approach|work plan/i.test(b.textContent ?? ''));
    if (!chip) return false;
    chip.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return true;
  });
  await page.waitForTimeout(900);
  bar = await readBar();
  A('clicking the section chip widens the focus', widened && bar.chips.some((c) => c.focused && /technical approach|work plan/i.test(c.label)),
    JSON.stringify(bar.chips.map((c) => `${c.focused ? '*' : ''}${c.label}`)));
  A('re-assemble APPEARS at section level', bar.actions.some((a) => /assemble/i.test(a)),
    JSON.stringify(bar.actions));

  // ── D · clicking review queues THAT scope ───────────────────────────────────────────────────
  H('D · the queued row carries the level the bar was showing');
  const before = await sql`
    SELECT count(*)::int AS n FROM agent_task_queue
    WHERE proposal_id = ${proposalId}::uuid AND agent_role = 'color_team_reviewer'`;
  await page.evaluate(() => {
    const bar = [...document.querySelectorAll('div')].find(
      (d) => d.querySelector('span')?.textContent?.trim() === 'Scope');
    const btn = [...(bar?.querySelectorAll('button') ?? [])].find((b) => /adversarial review/i.test(b.textContent ?? ''));
    btn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await page.waitForTimeout(3500);

  const rows = await sql`
    SELECT scope_level, scope_ref, section_id FROM agent_task_queue
    WHERE proposal_id = ${proposalId}::uuid AND agent_role = 'color_team_reviewer'
    ORDER BY created_at DESC`;
  A('exactly one review was queued', rows.length === before[0].n + 1,
    `${rows.length} row(s), was ${before[0].n}`);
  A('and it is SECTION-scoped — what the bar was showing',
    rows[0]?.scopeLevel === 'section' || rows[0]?.scope_level === 'section',
    JSON.stringify(rows[0] ?? null));
  A('filed against a real section of this proposal',
    [secA, secB].includes(rows[0]?.sectionId ?? rows[0]?.section_id),
    String(rows[0]?.sectionId ?? rows[0]?.section_id));

  await page.screenshot({
    path: '/tmp/claude-0/-home-user-govwin/34d597b2-183f-5787-9057-fc7251e3f9ff/scratchpad/scope-bar.png',
    fullPage: false,
  }).catch(() => {});
} catch (e) {
  ok = false;
  console.error('\nHARNESS ERROR:', e.message);
} finally {
  await browser.close().catch(() => {});
  if (proposalId) await purgeRows('proposals', 'id', [proposalId]).catch((e) => {
    ok = false; console.error('CLEANUP FAILED:', e.message);
  });
  const [left] = await sql`SELECT count(*)::int AS n FROM proposals WHERE title LIKE ${PROBE + '%'}`;
  console.log(`\n· cleanup: ${left.n} probe proposal(s) remaining (want 0)`);
  if (left.n !== 0) ok = false;
  await sql.end();
  console.log(ok ? '\n✓ the scope bar drives the review it names' : '\n✗ the scope bar has failures above');
  process.exit(ok ? 0 : 1);
}
