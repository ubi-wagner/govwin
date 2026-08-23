/**
 * THE WHOLE THING, ONCE, ON A RUNNING BOX — Phase G.
 *
 * Every earlier harness proves one phase. This drives one proposal from empty to exported and
 * reports what actually happened, with numbers, because the claim the programme makes is a claim
 * about the WHOLE path:
 *
 *     a build drafted without a human writing a sentence, reviewed at several granularities,
 *     resolved partly by the tenant and partly by an external collaborator inside their grant,
 *     with the gate stating what remains — and a package that still comes out compliant.
 *
 * The route, in order:
 *
 *   1 · PROVISION   a scratch build with three empty sections
 *   2 · DRAFT       assemble every section from the tenant's real library (deterministic — ranked
 *                   retrieval and a ruler-measured fit), then restore each proposed version so the
 *                   live content is agent/library-produced. Also FIRES the Mode C full-draft
 *                   doorbell and reports what it did, because "100% agent-drafted" is the claim.
 *   3 · REVIEW      queue scoped colour-team reviews at NODE · SECTION · PAGES · DOCUMENT through
 *                   the real route, and wait for the real pipeline worker to land real findings.
 *   4 · RESOLVE     the author closes some; a scoped collaborator closes theirs and is refused
 *                   outside the grant.
 *   5 · GATE        read the checklist and the submission gate — what is outstanding, and where.
 *   6 · PACKAGE     advance the build (which LOCKS it — the package route refuses an unlocked
 *                   draft), then export json and docx and read the compliance floor off the headers.
 *
 * Every number below is read back from Postgres or from the response, never from a toast. Where
 * something could not run, it says so rather than passing quietly — an unrunnable step is a gap in
 * the proof, not a success.
 *
 *   cd frontend && node scripts/verify-scope-end-to-end.mjs
 */
import { chromium } from 'playwright';
import postgres from 'postgres';
import { randomUUID } from 'node:crypto';

const BASE = process.env.GUIDE_BASE || 'http://localhost:3001';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const DB = process.env.GUIDE_DB || 'postgresql://govtech:changeme@localhost:5432/govtech_intel';
const sql = postgres(DB, { max: 2, transform: { column: { from: (c) => c } } });

const PROBE = 'e2e-scope-probe';
let ok = true;
const narrative = [];
const A = (label, cond, extra = '') => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!cond) ok = false;
};
const NOTE = (line) => { narrative.push(line); console.log(`  · ${line}`); };
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
  const headers = {}; r.headers.forEach((v, k) => { headers[k] = v; });
  const ct = r.headers.get('content-type') ?? '';
  // A binary body must not be stringified — read its LENGTH instead. Reading a docx as text and
  // then measuring the string is how a harness reports a plausible, wrong byte count.
  if (/json|text/.test(ct)) return { status: r.status, headers, text: await r.text(), bytes: null };
  return { status: r.status, headers, text: '', bytes: (await r.arrayBuffer()).byteLength };
}, [url, init ?? null]);
const json = (r) => { try { return JSON.parse(r.text); } catch { return null; } };

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

const FRAME = {
  width: 612, height: 792, margins: { top: 72, right: 72, bottom: 72, left: 72 },
  format: 'letter', header: null, footer: null,
  font_default: { family: 'Times New Roman', size: 11 },
  line_spacing: 1, min_font_size: 10, max_pages: 10, max_slides: null,
};
const emptyCanvas = (title) => JSON.stringify({
  version: 2, document_id: `${PROBE}-${title}`, canvas: FRAME, nodes: [],
  metadata: { title, status: 'empty', version_number: 1 },
});

const SECTIONS = [
  { title: 'Technical Approach', q: 'additive construction printed concrete structural walls validation', budget: 4 },
  { title: 'Work Plan',          q: 'schedule milestones tasks deliverables project management',          budget: 3 },
  { title: 'Key Personnel',      q: 'principal investigator team qualifications experience',               budget: 2 },
];

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
let proposalId = null;

try {
  const [foundation] = await sql`SELECT id, slug FROM tenants WHERE slug = 'foundation'`;
  const [anyOpp] = await sql`SELECT id FROM opportunities LIMIT 1`;
  const [author] = await sql`SELECT id, email, password_hash FROM users WHERE email = 'kate.ulepic@foundation3dp.com'`;
  if (!foundation || !anyOpp || !author) throw new Error('missing foundation tenant, opportunity or author');

  const stale = await sql`SELECT id FROM proposals WHERE title LIKE ${PROBE + '%'}`;
  if (stale.length) { await purgeRows('proposals', 'id', stale.map((r) => r.id)); console.log(`· swept ${stale.length} stale`); }
  await sql`DELETE FROM user_memberships WHERE user_id IN (SELECT id FROM users WHERE email LIKE ${PROBE + '%'})`.catch(() => {});
  await sql`DELETE FROM users WHERE email LIKE ${PROBE + '%'}`.catch(() => {});

  // ── 1 · PROVISION ───────────────────────────────────────────────────────────────────────────
  H('1 · provision a scratch build');
  proposalId = randomUUID();
  const secIds = SECTIONS.map(() => randomUUID());
  await sql`
    INSERT INTO proposals (id, tenant_id, opportunity_id, title, stage, is_locked)
    VALUES (${proposalId}::uuid, ${foundation.id}::uuid, ${anyOpp.id}::uuid, ${PROBE + ' · end to end'}, 'draft', false)`;
  for (let i = 0; i < SECTIONS.length; i++) {
    await sql`
      INSERT INTO proposal_sections
        (id, proposal_id, section_number, title, content, status, sort_index, version, is_locked, page_allocation, volume_name, volume_number)
      VALUES (${secIds[i]}::uuid, ${proposalId}::uuid, ${String(i + 1)}, ${SECTIONS[i].title},
              ${emptyCanvas(SECTIONS[i].title)}, 'empty', ${i + 1}, 1, false, ${SECTIONS[i].budget}, 'Volume I', 1)`;
  }
  A('three empty sections exist', secIds.length === 3);
  NOTE(`build ${proposalId.slice(0, 8)} · ${SECTIONS.length} sections, all empty, no human has written a word`);

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await login(ctx, author.email, 'DemoPass123!');
  const P = `${BASE}/api/portal/${foundation.slug}/proposals/${proposalId}`;

  // ── 2 · DRAFT ───────────────────────────────────────────────────────────────────────────────
  H('2 · draft it without a human writing a sentence');
  let totalAtoms = 0; let totalGroups = 0; let totalPages = 0; let totalSkipped = 0;
  for (let i = 0; i < SECTIONS.length; i++) {
    const asm = json(await api(page, `${P}/sections/${secIds[i]}/assemble`, {
      method: 'POST', body: JSON.stringify({ text: SECTIONS[i].q }),
    }));
    if (!asm?.data?.versionNumber) { A(`${SECTIONS[i].title}: assembled`, false, JSON.stringify(asm)); continue; }
    const d = asm.data;
    totalAtoms += d.atoms.length; totalGroups += d.groups; totalPages += d.pagesUsed;
    totalSkipped += (d.skipped ?? []).length;
    const restore = await api(page, `${P}/sections/${secIds[i]}/versions`, {
      method: 'POST', body: JSON.stringify({ versionNumber: d.versionNumber }),
    });
    A(`${SECTIONS[i].title}: assembled from the library and restored`,
      restore.status === 200 && d.groups > 0,
      `${d.atoms.length} atom(s) · ${d.groups} group(s) · ${d.pagesUsed}/${d.pageBudget} page(s)`
      + `${(d.skipped ?? []).length ? ` · ${d.skipped.length} did not fit` : ''}`);
  }
  NOTE(`drafted: ${totalAtoms} library atoms → ${totalGroups} groups → ${totalPages} pages `
     + `(${totalSkipped} atom(s) dropped for budget)`);

  const drafted = await sql`
    SELECT count(*)::int AS n FROM proposal_sections
    WHERE proposal_id = ${proposalId}::uuid AND content IS NOT NULL
      AND jsonb_array_length(COALESCE(content::jsonb->'sections', '[]'::jsonb)) > 0`;
  A('every section now carries a GROUPED canvas in the database', drafted[0].n === 3,
    `${drafted[0].n} of 3`);

  // The Mode C doorbell — the claim is "100% agent-drafted", so fire the real one and report what
  // it did rather than quietly relying on the deterministic path above.
  const fullDraft = await api(page, `${P}/full-draft`, {
    method: 'POST', body: JSON.stringify({ mode: 'c' }),
  });
  NOTE(`Mode C full-draft doorbell: status ${fullDraft.status} — ${fullDraft.text.slice(0, 160)}`);

  // ── 3 · REVIEW at several granularities ─────────────────────────────────────────────────────
  H('3 · review it at four different granularities');
  const [firstNode] = await sql`
    SELECT (content::jsonb->'sections'->0->'groups'->0->'nodes'->0->>'id') AS node_id
    FROM proposal_sections WHERE id = ${secIds[0]}::uuid`;
  const scopes = [
    ['node',     { nodeId: firstNode.node_id, sectionId: secIds[0] }],
    ['section',  { sectionId: secIds[1] }],
    // Key Personnel is the COLLABORATOR's granted section. Without a review aimed at it their
    // resolution step has nothing to resolve — and the first run of this harness let that pass
    // through an `inSecC.length === 0 ||` escape hatch, which is the vacuity trap the verification
    // rules exist for. A step that cannot fail is not a step.
    ['section',  { sectionId: secIds[2] }],
    ['pages',    { pageRange: { start: 1, end: 2 } }],
    ['document', {}],
  ];
  for (const [label, scope] of scopes) {
    const r = await api(page, `${P}/ai-review`, { method: 'POST', body: JSON.stringify({ scope }) });
    A(`queued a ${label}-scoped review`, r.status === 200,
      `status=${r.status} ${r.text.slice(0, 110)}`);
  }

  let drained = false;
  for (let i = 0; i < 60 && !drained; i++) {
    const [{ pending }] = await sql`
      SELECT count(*)::int AS pending FROM agent_task_queue
      WHERE proposal_id = ${proposalId}::uuid AND status IN ('pending', 'running')`;
    if (pending === 0) drained = true; else await new Promise((r) => setTimeout(r, 1500));
  }
  const queue = await sql`
    SELECT scope_level, status FROM agent_task_queue WHERE proposal_id = ${proposalId}::uuid`;
  A('the pipeline drained the queue', drained,
    drained ? '' : 'the worker did not finish — everything below measures an incomplete run');
  A('every scope level was stored distinctly',
    new Set(queue.map((q) => q.scope_level)).size === 4,
    JSON.stringify(queue.map((q) => `${q.scope_level}:${q.status}`)));

  const landed = await sql`
    SELECT anchor->>'scopeLevel' AS lvl, count(*)::int AS n FROM proposal_comments
    WHERE proposal_id = ${proposalId}::uuid AND recommendation_type = 'ai_review'
    GROUP BY 1 ORDER BY 1`;
  A('real findings landed, pinned to the scope each reviewer read',
    landed.length > 0, JSON.stringify(landed.map((l) => `${l.lvl ?? 'section'}=${l.n}`)));
  const [findingCount] = await sql`
    SELECT count(*)::int AS n FROM proposal_comments
    WHERE proposal_id = ${proposalId}::uuid AND recommendation_type = 'ai_review'`;
  NOTE(`${findingCount.n} finding(s) landed across ${landed.length} distinct scope level(s)`);

  // ── 4 · RESOLVE — author, then a scoped collaborator ─────────────────────────────────────────
  H('4 · resolve some as the author, the rest as a scoped collaborator');
  const all = await sql`
    SELECT id, section_id FROM proposal_comments
    WHERE proposal_id = ${proposalId}::uuid AND recommendation_type = 'ai_review'
    ORDER BY created_at`;
  const inSecC = all.filter((f) => f.section_id === secIds[2]);
  const notSecC = all.filter((f) => f.section_id !== secIds[2]);
  let authorResolved = 0;
  for (const f of notSecC.slice(0, Math.max(1, Math.floor(notSecC.length / 2)))) {
    const r = await api(page, `${P}/comments/${f.id}/resolve`, { method: 'POST', body: '{}' });
    if (r.status === 200) authorResolved++;
  }
  A('the author resolved some findings', authorResolved > 0, `${authorResolved} resolved`);

  const collabEmail = `${PROBE}-collab@example.test`;
  const collabUser = randomUUID();
  const collabId = randomUUID();
  await sql`
    INSERT INTO users (id, email, name, password_hash, role, is_active, tenant_id)
    VALUES (${collabUser}::uuid, ${collabEmail}, 'E2E Collaborator', ${author.password_hash},
            'partner_user', true, ${foundation.id}::uuid)`;
  await sql`
    INSERT INTO user_memberships (user_id, tenant_id, role, status, source)
    VALUES (${collabUser}::uuid, ${foundation.id}::uuid, 'partner_user', 'active', 'collaborator')`;
  await sql`
    INSERT INTO proposal_collaborators (id, proposal_id, user_id, email, name, role, assigned_sections, accepted_at)
    VALUES (${collabId}::uuid, ${proposalId}::uuid, ${collabUser}::uuid, ${collabEmail},
            'E2E Collaborator', 'external', ARRAY[${secIds[2]}]::uuid[], now())`;
  await sql`
    INSERT INTO collaborator_stage_access (collaborator_id, proposal_id, stage, artifact_types, permission)
    VALUES (${collabId}::uuid, ${proposalId}::uuid, 'draft', ARRAY['narrative']::text[], 'comment')`;

  const cpage = await login(await browser.newContext(), collabEmail, 'DemoPass123!');
  const collabSees = json(await api(cpage, `${P}/findings`));
  A('the collaborator sees only their granted section',
    (collabSees?.data?.findings ?? []).every((f) => f.sectionId === secIds[2]),
    `${collabSees?.data?.findings?.length ?? 0} finding(s)`);
  if (notSecC.length) {
    const denied = await api(cpage, `${P}/comments/${notSecC[notSecC.length - 1].id}/resolve`,
      { method: 'POST', body: '{}' });
    A('and is refused outside it', denied.status === 403, `status=${denied.status}`);
  }
  let collabResolved = 0;
  for (const f of inSecC) {
    const r = await api(cpage, `${P}/comments/${f.id}/resolve`, { method: 'POST', body: '{}' });
    if (r.status === 200) collabResolved++;
  }
  A('their granted section actually carries findings — otherwise the next step proves nothing',
    inSecC.length > 0, `${inSecC.length} finding(s) in Key Personnel`);
  A('the collaborator resolved inside their grant', collabResolved > 0,
    `${collabResolved} of ${inSecC.length}`);
  NOTE(`resolution split: ${authorResolved} by the tenant, ${collabResolved} by the external collaborator`);

  // ── 5 · THE GATE ────────────────────────────────────────────────────────────────────────────
  H('5 · what the gate says is outstanding, and where');
  const check = json(await api(page, `${P}/findings`));
  const c = check.data.checklist;
  A('the checklist states the split', c.total > 0 && c.resolved + c.open === c.total,
    `${c.resolved} resolved / ${c.open} open of ${c.total}`);
  A('and it names WHERE the open work is', c.open === 0 || c.byScope.length > 0,
    JSON.stringify(c.byScope.map((g) => `${g.level}:${g.label}:${g.open}/${g.total}`)));
  NOTE(`gate: "${c.headline}"`);

  const readiness = json(await api(page, `${P}/readiness`));
  const findingsOnGate = (readiness?.data?.blockers ?? []).filter((b) => b.category === 'open_finding');
  A('the submission gate carries the open findings',
    c.open === 0 ? findingsOnGate.length === 0 : findingsOnGate.length > 0,
    `${findingsOnGate.length} entr(y/ies)`);
  A('as warnings only — an AI opinion never refuses a submission',
    findingsOnGate.every((b) => b.severity === 'warning'));
  NOTE(`readiness: ${readiness?.data?.blockerCount} blocker(s), ${readiness?.data?.warningCount} warning(s)`
     + ` — ready=${readiness?.data?.ready}`);

  // ── 6 · ADVANCE (which locks), then PACKAGE ─────────────────────────────────────────────────
  H('6 · advance the build — which locks it — then package it');
  // The package route REFUSES an unlocked draft ("Proposal must be locked or in submitted/archived
  // stage"). That is the product's gate, not an obstacle: the deliverable comes out of a locked
  // build. The first run of this harness packaged a draft, got 403 four times, and would have read
  // as an export failure. Assert the contract the system HAS.
  // ONE advance, not a ladder. This proposal's `gate_config` puts `final` directly after `draft`
  // ("Cannot advance from 'draft' to 'review'. Next gate is 'final'."), and reaching it LOCKS and
  // submits in the same move — so a separate lock call afterwards is correctly refused as "already
  // locked". Both of those were wrong guesses in the first version of this block, and both are the
  // same mistake: asserting the flow I imagined instead of the one the product has.
  //
  // `force` skips the lock-state gates and `acknowledgeBlockers` the readiness hard-stop. Both are
  // REAL admin affordances ("Submit anyway"), not test-only doors — and this run deliberately
  // carries open blockers, because a clean build would not exercise the gate at all.
  const adv = await api(page, `${P}/advance`, {
    method: 'POST',
    body: JSON.stringify({ targetStage: 'final', force: true, acknowledgeBlockers: true }),
  });
  A('the build advances', adv.status === 200, `status=${adv.status} ${adv.text.slice(0, 140)}`);
  A('and the advance locked it in the same move', json(adv)?.data?.locked === true,
    JSON.stringify(json(adv)?.data ?? null));
  const [locked] = await sql`SELECT is_locked, stage FROM proposals WHERE id = ${proposalId}::uuid`;
  A('Postgres agrees', locked.is_locked === true,
    `is_locked=${locked.is_locked} stage=${locked.stage}`);
  NOTE(`advanced draft → ${locked.stage}, locked, over ${readiness?.data?.blockerCount} acknowledged blocker(s)`);
  const pkgJson = await api(page, `${P}/package?format=json`);
  A('json package exports', pkgJson.status === 200, `status=${pkgJson.status}`);
  const pj = json(pkgJson);
  A('and carries the drafted content', JSON.stringify(pj?.data ?? {}).length > 500,
    `${JSON.stringify(pj?.data ?? {}).length} chars`);

  const pkgDocx = await api(page, `${P}/package?format=docx`);
  A('docx package exports', pkgDocx.status === 200, `status=${pkgDocx.status}`);
  A('and it is real bytes, not an empty file', (pkgDocx.bytes ?? 0) > 10_000,
    `${pkgDocx.bytes} bytes`);
  const violations = pkgDocx.headers['x-compliance-violations'];
  A('the compliance floor reported a verdict on the export',
    violations !== undefined, `X-Compliance-Violations=${violations}`);
  NOTE(`package: docx ${pkgDocx.bytes} bytes · ${violations ?? '?'} compliance violation(s)`);

  // ── THE NARRATIVE ───────────────────────────────────────────────────────────────────────────
  H('what actually happened');
  narrative.forEach((l) => console.log(`  ${l}`));
} catch (e) {
  ok = false;
  console.error('\nHARNESS ERROR:', e.message);
} finally {
  await browser.close().catch(() => {});
  if (proposalId) await purgeRows('proposals', 'id', [proposalId]).catch((e) => {
    ok = false; console.error('CLEANUP FAILED:', e.message);
  });
  await sql`DELETE FROM user_memberships WHERE user_id IN (SELECT id FROM users WHERE email LIKE ${PROBE + '%'})`.catch(() => {});
  await sql`DELETE FROM users WHERE email LIKE ${PROBE + '%'}`.catch(() => {});
  const [left] = await sql`SELECT count(*)::int AS n FROM proposals WHERE title LIKE ${PROBE + '%'}`;
  const [users] = await sql`SELECT count(*)::int AS n FROM users WHERE email LIKE ${PROBE + '%'}`;
  console.log(`\n· cleanup: ${left.n} probe proposal(s), ${users.n} probe user(s) remaining (want 0/0)`);
  if (left.n !== 0 || users.n !== 0) ok = false;
  await sql.end();
  console.log(ok ? '\n✓ end to end: drafted, reviewed at four granularities, resolved by two parties, gated, packaged'
                 : '\n✗ the end-to-end run has failures above');
  process.exit(ok ? 0 : 1);
}
