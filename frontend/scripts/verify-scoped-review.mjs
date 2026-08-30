/**
 * SCOPED COLOUR-TEAM REVIEW, on a running box — does aiming a reviewer at one thing actually work?
 *
 * The unit tests prove the planner picks the right nodes and the anchor helper builds the right
 * jsonb. Neither can prove the thing that matters: that a request made through the real HTTP route,
 * by a real signed-in customer, lands a real row in `agent_task_queue` with the right scope on it,
 * that the pipeline reads that row and pins its finding to the same thing, and that the rollup then
 * shows every scoped review instead of hiding all but one.
 *
 * Six blocks:
 *
 *   A · THE UNSCOPED PATH IS UNTOUCHED. The compatibility guarantee, measured rather than asserted:
 *       a request with no scope must write `scope_level` and `scope_ref` NULL — byte-identical to
 *       the row it wrote before mig 207 existed. This is the block that would fail if the new code
 *       had leaked into the old path.
 *
 *   B · EACH RUNG QUEUES ITSELF. node · group · section · pages · document, each producing one task
 *       whose stored scope round-trips, and whose section_id is a real section (the write-back
 *       returns early without one, so a task with no section produces no comment AND no error).
 *
 *   C · THE PAYLOAD IS THE SCOPE'S OWN TEXT. A node-scoped review handed the whole section reviews
 *       the section and the anchor lies about it. Measured by comparing the queued `section_text`
 *       against the section's full text.
 *
 *   D · THE FINDING IS PINNED. Once the worker completes the task, the `proposal_comments` row it
 *       writes carries an anchor naming the same scope.
 *
 *   E · THE ROLLUP SHOWS THEM ALL. Several scoped reviews in one section must be several rows.
 *       `DISTINCT ON (section_id)` would show one — this is the regression that fix exists for.
 *
 *   F · BAD INPUT IS REFUSED. A malformed page range is a 400, not a silent whole-proposal review
 *       that spends the tenant's hourly agent budget.
 *
 * Nothing here touches the demo fixture. The harness builds its own scratch proposal, and sweeps
 * its own namespace on startup so a crashed run cannot poison the next one.
 *
 *   cd frontend && node scripts/verify-scoped-review.mjs
 * Exit 0 if every block passes; 1 otherwise.
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

/** Everything this harness creates carries this prefix — also how it finds its own wreckage. */
const PROBE = 'scope-probe';

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

const api = (page, url, init) => page.evaluate(async ([u, i]) => {
  const r = await fetch(u, { ...(i ?? {}), headers: { 'Content-Type': 'application/json', ...(i?.headers ?? {}) } });
  return { status: r.status, text: await r.text() };
}, [url, init ?? null]);

const json = (r) => { try { return JSON.parse(r.text); } catch { return null; } };

/** FK children from the catalog — a hand-written teardown list is correct until the next migration. */
const fkChildren = (ref) => sql`
  SELECT c.conrelid::regclass::text AS child, a.attname AS col
  FROM pg_constraint c
  JOIN unnest(c.conkey) AS k(attnum) ON true
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
  WHERE c.contype = 'f' AND c.confrelid = ${ref}::regclass
    AND array_length(c.conkey, 1) = 1`;

/**
 * Delete rows and everything that references them, depth-first.
 *
 * ONE LEVEL IS NOT ENOUGH, and this harness is what proved it. The sibling CRUD lens purges direct
 * FK children of `proposals` and `proposal_sections`, which is sufficient there because it never
 * queues an agent task. This one does — and `agent_task_results.task_id` references
 * `agent_task_queue.id`, a GRANDCHILD. The single-level purge deleted nothing, `DELETE FROM
 * proposals` failed on `agent_task_queue_proposal_id_fkey`, and the run left its scratch build
 * behind for the next one to measure.
 *
 * Depth-bounded because the FK graph has cycles (self-referencing parent columns); 4 covers every
 * chain this touches and refuses to recurse forever if the schema grows one.
 */
async function purgeRows(table, col, ids, depth = 0) {
  if (!ids.length || depth > 4) return;
  const kids = await fkChildren(table);
  for (const k of kids) {
    if (k.child === table) continue; // self-reference: the row's own delete handles it
    const rows = await sql.unsafe(
      `SELECT id FROM ${k.child} WHERE ${k.col} = ANY($1::uuid[])`, [ids],
    ).catch(() => []);
    if (rows.length) await purgeRows(k.child, 'id', rows.map((r) => r.id), depth + 1);
    await sql.unsafe(`DELETE FROM ${k.child} WHERE ${k.col} = ANY($1::uuid[])`, [ids])
      .catch((e) => { console.error(`  ! purge ${k.child}.${k.col}: ${e.message}`); });
  }
  await sql.unsafe(`DELETE FROM ${table} WHERE ${col} = ANY($1::uuid[])`, [ids]);
}

const purgeProposals = (ids) => purgeRows('proposals', 'id', ids);

const PROSE = 'Foundation 3DCP prints structural concrete walls at forty millimetres per second, and '
  + 'the formwork automation cut on-site labour by sixty percent across every validated build. ';

/** A section canvas with a GROUP layer, so group scoping has something real to resolve against. */
const canvasFor = (tag, opts = {}) => JSON.stringify({
  version: 2,
  document_id: `${PROBE}-${tag}`,
  // COPIED from a stored row, not typed from memory: the real frame is in POINTS
  // (`width`/`margins`/`font_default`), and an invented `width_in`/`body_font` shape renders an
  // error boundary in the editor while still answering every API call correctly — which is exactly
  // how a fixture bug survives an API-only harness.
  canvas: {
    width: 612, height: 792,
    margins: { top: 72, right: 72, bottom: 72, left: 72 },
    format: 'letter', header: null, footer: null,
    font_default: { family: 'Times New Roman', size: 11 },
    line_spacing: 1, min_font_size: 10, max_pages: 10, max_slides: null,
  },
  ...(opts.flat
    ? { nodes: opts.nodes }
    : { sections: [{ id: `s-${tag}`, title: tag, layout: { mode: 'flow' }, source_atom_ids: [],
        groups: opts.groups }] }),
  metadata: { title: tag, status: 'in_progress', version_number: 1 },
});

const textNode = (id, reps) => ({
  id, type: 'text_block', content: { text: PROSE.repeat(reps) },
  style: {}, provenance: { source: 'manual' }, history: [], library_eligible: false,
});

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
let proposalId = null;

try {
  const [foundation] = await sql`SELECT id, slug FROM tenants WHERE slug = 'foundation'`;
  if (!foundation) throw new Error('no foundation tenant to test against');

  // ── SELF-HEAL ───────────────────────────────────────────────────────────
  const stale = await sql`SELECT id FROM proposals WHERE title LIKE ${PROBE + '%'}`;
  if (stale.length) {
    await purgeProposals(stale.map((r) => r.id));
    console.log(`· swept ${stale.length} leftover probe proposal(s) from a previous run`);
  }

  // ── SCRATCH BUILD ───────────────────────────────────────────────────────
  // Three sections of real, varied content. Section 1 carries two GROUPS so a group scope resolves;
  // section 2 is long enough to spill past page 1 so a page range covers more than one section.
  // `proposals.opportunity_id` is NOT NULL with an FK — a proposal exists BECAUSE an opportunity
  // does, and the schema says so. Borrow any real one rather than inventing an id: an FK-before-
  // audit ordering bug is a documented class here (CLAUDE.md), and a scratch row that violates the
  // model is not a scratch row, it is a different product.
  const [anyOpp] = await sql`SELECT id FROM opportunities LIMIT 1`;
  if (!anyOpp) throw new Error('no opportunity to attach a scratch proposal to');
  proposalId = randomUUID();
  await sql`
    INSERT INTO proposals (id, tenant_id, opportunity_id, title, stage, is_locked)
    VALUES (${proposalId}::uuid, ${foundation.id}::uuid, ${anyOpp.id}::uuid,
            ${PROBE + ' · scoped review'}, 'draft', false)`;

  const secIds = { a: randomUUID(), b: randomUUID(), c: randomUUID() };
  await sql`
    INSERT INTO proposal_sections (id, proposal_id, section_number, title, content, status, sort_index, volume_name, volume_number)
    VALUES
      (${secIds.a}::uuid, ${proposalId}::uuid, '1', 'Technical Approach',
       ${canvasFor('Technical Approach', { groups: [
         { id: 'g-intro', label: 'Introduction', atom_ref: 'atom-1', keep_together: false,
           nodes: [textNode('n-intro', 3)] },
         { id: 'g-method', label: 'Method', atom_ref: 'atom-2', keep_together: false,
           nodes: [textNode('n-method', 2)] },
       ] })}, 'in_progress', 1, 'Volume I', 1),
      (${secIds.b}::uuid, ${proposalId}::uuid, '2', 'Work Plan',
       ${canvasFor('Work Plan', { groups: [
         { id: 'g-plan', label: 'Plan', atom_ref: 'atom-3', keep_together: false,
           nodes: [textNode('n-plan', 16)] },
       ] })}, 'in_progress', 2, 'Volume I', 1),
      (${secIds.c}::uuid, ${proposalId}::uuid, '3', 'Key Personnel',
       ${canvasFor('Key Personnel', { flat: true, nodes: [textNode('n-people', 2)] })}, 'in_progress', 3, 'Volume I', 1)`;

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await login(ctx, 'kate.ulepic@foundation3dp.com', 'DemoPass123!');
  const url = `${BASE}/api/portal/${foundation.slug}/proposals/${proposalId}/ai-review`;
  const post = (body) => api(page, url, { method: 'POST', body: JSON.stringify(body) });

  const tasks = () => sql`
    SELECT id, section_id, scope_level, scope_ref, input, created_at
    FROM agent_task_queue
    WHERE proposal_id = ${proposalId}::uuid AND agent_role = 'color_team_reviewer'
    ORDER BY created_at`;

  // ══ A · THE UNSCOPED PATH IS UNTOUCHED ══════════════════════════════════
  H('A · the unscoped fan-out writes the row it always wrote');
  const unscoped = json(await post({}));
  A('POST {} enqueues one task per section with content', unscoped?.data?.enqueued === 3,
    `enqueued=${unscoped?.data?.enqueued}`);
  let rows = await tasks();
  A('every unscoped row leaves scope_level NULL',
    rows.length > 0 && rows.every((r) => r.scope_level === null),
    `levels=${JSON.stringify(rows.map((r) => r.scope_level))}`);
  A('every unscoped row leaves scope_ref NULL', rows.every((r) => r.scope_ref === null));
  A('every unscoped row still carries its section', rows.every((r) => r.section_id));
  const unscopedCount = rows.length;

  // ══ B · EACH RUNG QUEUES ITSELF ═════════════════════════════════════════
  H('B · every rung of the ladder queues a task that names itself');
  const cases = [
    ['node',     { nodeId: 'n-intro', sectionId: secIds.a },        secIds.a, (r) => r.scope_ref?.nodeId === `${secIds.a}__n-intro`],
    // The stored ref is the SCOPED id (`<sectionId>__<localId>`), not the raw one the editor sent.
    // That is the contract, not a leak: ids must be unique across the whole proposal or two
    // sections that both name a group `g-method` would collide, and the second be unreachable.
    // Asserting the raw id here would have been a harness bug reported as a product bug.
    ['group',    { groupId: 'g-method', sectionId: secIds.a },      secIds.a, (r) => r.scope_ref?.groupId === `${secIds.a}__g-method`],
    ['section',  { sectionId: secIds.c },                           secIds.c, (r) => r.scope_ref === null],
    ['pages',    { pageRange: { start: 1, end: 2 } },               null,     (r) => r.scope_ref?.pages?.start === 1 && r.scope_ref?.pages?.end === 2],
    ['document', {},                                                null,     (r) => r.scope_ref === null],
  ];
  const queued = {};
  for (const [level, scope, expectSection, refOk] of cases) {
    const before = (await tasks()).length;
    const res = json(await post({ scope }));
    const after = await tasks();
    const fresh = after.slice(before);
    A(`${level}: one task queued`, fresh.length === 1, `got ${fresh.length}, api=${res?.data?.enqueued ?? res?.code}`);
    if (fresh.length !== 1) continue;
    const t = fresh[0];
    queued[level] = t;
    A(`${level}: scope_level stored`, t.scope_level === level, `stored '${t.scope_level}'`);
    A(`${level}: scope_ref round-trips`, refOk(t), JSON.stringify(t.scope_ref));
    A(`${level}: files against a real section`, !!t.section_id
      && (expectSection ? t.section_id === expectSection : true),
      `section_id=${t.section_id}`);
    A(`${level}: the API reports what it aimed at`, res?.data?.scope?.level === level,
      JSON.stringify(res?.data?.scope ?? null));
  }

  // The group scope resolves only because the section canvas HAS groups. A flat one has none —
  // asserting that keeps the group case honest rather than accidentally passing on a section scope.
  A('group scope really resolved a group (not silently a section or the document)',
    queued.group?.scope_level === 'group' && !!queued.group?.scope_ref?.groupId,
    `level=${queued.group?.scope_level} ref=${JSON.stringify(queued.group?.scope_ref)}`);
  // SENSITIVITY: the group's text must be its own, narrower than the section that contains it.
  // Without this, a "group" scope that quietly resolved to the whole section would still pass above.
  A('a group-scoped task carries less text than its section',
    String(queued.group?.input?.section_text ?? '').length > 0
    && String(queued.group?.input?.section_text ?? '').length
       < String(queued.document?.input?.section_text ?? '').length,
    `group=${String(queued.group?.input?.section_text ?? '').length}`);

  // ══ C · THE PAYLOAD IS THE SCOPE'S OWN TEXT ═════════════════════════════
  H('C · the reviewer is handed the scope, not the section');
  const [secA] = await sql`SELECT content FROM proposal_sections WHERE id = ${secIds.a}::uuid`;
  const fullA = JSON.parse(secA.content).sections[0].groups.flatMap((g) => g.nodes)
    .map((n) => n.content.text).join('\n\n').trim();
  const nodeText = String(queued.node?.input?.section_text ?? '');
  const secText = String(queued.section?.input?.section_text ?? '');
  A('a node-scoped task carries less text than its whole section',
    nodeText.length > 0 && nodeText.length < fullA.length,
    `node=${nodeText.length} section=${fullA.length}`);
  A('a node-scoped task carries the node’s own words', nodeText.includes('forty millimetres'));
  A('a document-scoped task carries more than any one section',
    String(queued.document?.input?.section_text ?? '').length > secText.length,
    `doc=${String(queued.document?.input?.section_text ?? '').length} section=${secText.length}`);
  A('the reviewer is told WHAT it is looking at',
    String(queued.node?.input?.section_title ?? '').length > 0
    && queued.document?.input?.section_title === 'Whole document',
    `node='${queued.node?.input?.section_title}' doc='${queued.document?.input?.section_title}'`);

  // ══ D · THE FINDING IS PINNED ═══════════════════════════════════════════
  H('D · the pipeline pins its finding to the same scope');
  // Wait for the worker to drain what we queued. Bounded — a hung worker must report as a hung
  // worker, not as a passing test.
  let drained = false;
  for (let i = 0; i < 40 && !drained; i++) {
    const [{ pending }] = await sql`
      SELECT count(*)::int AS pending FROM agent_task_queue
      WHERE proposal_id = ${proposalId}::uuid AND status IN ('pending', 'running')`;
    if (pending === 0) drained = true; else await new Promise((r) => setTimeout(r, 1500));
  }
  const done = await sql`
    SELECT status, count(*)::int AS n FROM agent_task_queue
    WHERE proposal_id = ${proposalId}::uuid GROUP BY 1`;
  console.log(`  · queue drained=${drained} · ${done.map((d) => `${d.status}=${d.n}`).join(' ')}`);

  const comments = await sql`
    SELECT section_id, anchor FROM proposal_comments
    WHERE proposal_id = ${proposalId}::uuid AND recommendation_type = 'ai_review'`;
  const anchored = comments.filter((c) => c.anchor && c.anchor.scopeLevel);
  if (comments.length === 0) {
    A('the worker produced findings to inspect', false,
      'no ai_review comments — is the pipeline worker running against THIS database?');
  } else {
    A('some findings landed', comments.length > 0, `${comments.length} ai_review comment(s)`);
    A('scoped findings carry a scope anchor', anchored.length > 0,
      `${anchored.length} of ${comments.length} anchored`);
    const nodeAnchored = anchored.find((c) => c.anchor.scopeLevel === 'node');
    A('a node finding names the node it reviewed',
      !!nodeAnchored && nodeAnchored.anchor.nodeId === `${secIds.a}__n-intro`,
      JSON.stringify(nodeAnchored?.anchor ?? null));
    const pageAnchored = anchored.find((c) => c.anchor.scopeLevel === 'pages');
    A('a page-range finding names the range',
      !!pageAnchored && pageAnchored.anchor.pages?.start === 1,
      JSON.stringify(pageAnchored?.anchor ?? null));
    A('unscoped findings carry NO anchor — the old shape is unchanged',
      comments.some((c) => !c.anchor),
      `${comments.filter((c) => !c.anchor).length} unanchored`);
  }

  // ══ E · THE ROLLUP SHOWS THEM ALL ═══════════════════════════════════════
  H('E · the rollup shows every scope, not the newest per section');
  const status = json(await api(page, url));
  const list = status?.data?.sections ?? [];
  A('GET honours the SOP envelope', !!status?.data, `status=${status ? 'ok' : 'unparseable'}`);
  A('the rollup lists more rows than there are sections', list.length > 3,
    `${list.length} rows vs 3 sections`);
  const inA = list.filter((s) => s.sectionId === secIds.a);
  A('section A shows its section review AND its node AND its group review', inA.length >= 3,
    `${inA.length} rows in section A: ${JSON.stringify(inA.map((s) => s.scopeLevel))}`);
  A('every row says which scope it was', list.every((s) => typeof s.scopeLevel === 'string'));
  A('the headline stops calling them all sections', !/\bsections?\b/.test(String(status?.data?.headline ?? '')),
    String(status?.data?.headline ?? '').slice(0, 120));

  // ══ F · BAD INPUT IS REFUSED ════════════════════════════════════════════
  H('F · a malformed scope is refused, not silently widened');
  const beforeBad = (await tasks()).length;
  const bad = [
    ['page range as a string', { scope: { pageRange: 'pages 1 to 3' } }],
    ['reversed page range', { scope: { pageRange: { start: 9, end: 2 } } }],
    ['page zero', { scope: { pageRange: { start: 0, end: 3 } } }],
    ['absurd page range', { scope: { pageRange: { start: 1, end: 99999999 } } }],
    ['scope as a string', { scope: 'the whole thing' }],
  ];
  for (const [label, body] of bad) {
    const r = await post(body);
    A(`${label} → 400`, r.status === 400, `status=${r.status} ${r.text.slice(0, 80)}`);
  }
  A('none of them queued anything', (await tasks()).length === beforeBad,
    `${(await tasks()).length - beforeBad} stray task(s)`);

  const unknownNode = await post({ scope: { nodeId: 'no-such-node', sectionId: secIds.a } });
  A('a scope naming nothing is a 409, not a whole-proposal review',
    unknownNode.status === 409 && json(unknownNode)?.code === 'EMPTY_SCOPE',
    `status=${unknownNode.status} ${unknownNode.text.slice(0, 80)}`);

  console.log(`\n· ${unscopedCount} unscoped + ${Object.keys(queued).length} scoped task(s) queued in total`);
} catch (e) {
  ok = false;
  console.error('\nHARNESS ERROR:', e.message);
} finally {
  await browser.close().catch(() => {});
  if (proposalId) await purgeProposals([proposalId]).catch((e) => {
    ok = false;
    console.error('CLEANUP FAILED — the fixture may be dirty:', e.message);
  });
  const left = await sql`SELECT count(*)::int AS n FROM proposals WHERE title LIKE ${PROBE + '%'}`;
  console.log(`\n· cleanup: ${left[0].n} probe proposal(s) remaining (want 0)`);
  if (left[0].n !== 0) ok = false;
  await sql.end();
  console.log(ok ? '\n✓ scoped review works end to end' : '\n✗ scoped review has failures above');
  process.exit(ok ? 0 : 1);
}
