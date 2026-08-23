/**
 * THE GATE AS A LIVE CHECKLIST, AND WHO CAN WORK IT DOWN — Phases E and F, proven together.
 *
 * E · A gate could only ever say passed / not passed. It could not say "four findings are resolved
 *     and two are not, and the open ones are about Figure 2 and pages 3–5". Now it can, because a
 *     colour-team finding is a `proposal_comments` row carrying `resolved` and — since mig 207 —
 *     the scope the reviewer was aimed at.
 *
 * F · A `partner_user` collaborates inside a GRANT: specific sections, at a specific stage, with a
 *     specific permission. Assumption (a) of the programme is that the grant does not change — a
 *     collaborator resolves scoped findings inside what they can already reach. The claim is only
 *     worth anything if the refusal outside that grant is PROVEN, so this drives it as a real
 *     signed-in collaborator rather than reasoning about the code.
 *
 * Blocks:
 *   A · the checklist counts, and it distinguishes THREE states — no findings yet, some open, all
 *       resolved. "0 open" on an unreviewed proposal reads as a clean bill of health and is not one.
 *   B · resolving moves the number. Read from Postgres, not from the response.
 *   C · the scope filter narrows. A section query must not return another section's findings, and a
 *       page query must not return a range it does not overlap.
 *   D · the submission gate SHOWS the open findings — as a WARNING, never a blocker. An AI's
 *       recommendation must not be able to refuse a customer's submission.
 *   F · the collaborator belt: a scoped partner sees only their granted section's findings at the
 *       DOCUMENT scope, and is refused when resolving one outside the grant.
 *
 * Own scratch build. Fixture untouched.
 *
 *   cd frontend && node scripts/verify-scoped-gates.mjs
 */
import { chromium } from 'playwright';
import postgres from 'postgres';
import { randomUUID } from 'node:crypto';

const BASE = process.env.GUIDE_BASE || 'http://localhost:3001';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const DB = process.env.GUIDE_DB || 'postgresql://govtech:changeme@localhost:5432/govtech_intel';
const sql = postgres(DB, { max: 2, transform: { column: { from: (c) => c } } });

const PROBE = 'gates-probe';
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
const PROSE = 'Foundation 3DCP prints structural concrete walls at forty millimetres per second and '
  + 'formwork automation cut on-site labour by sixty percent across the validated build. ';
const canvasOf = (title, reps) => JSON.stringify({
  version: 2, document_id: `${PROBE}-${title}`, canvas: FRAME,
  nodes: [{ id: `n-${title.replace(/\W+/g, '')}`, type: 'text_block',
    content: { text: PROSE.repeat(reps) },
    style: {}, provenance: { source: 'manual' }, history: [], library_eligible: false }],
  metadata: { title, status: 'in_progress', version_number: 1 },
});

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
let proposalId = null;

try {
  const [foundation] = await sql`SELECT id, slug FROM tenants WHERE slug = 'foundation'`;
  const [anyOpp] = await sql`SELECT id FROM opportunities LIMIT 1`;
  const [author] = await sql`SELECT id, email FROM users WHERE email = 'kate.ulepic@foundation3dp.com'`;
  if (!foundation || !anyOpp || !author) throw new Error('missing foundation tenant, opportunity or author');

  const stale = await sql`SELECT id FROM proposals WHERE title LIKE ${PROBE + '%'}`;
  if (stale.length) { await purgeRows('proposals', 'id', stale.map((r) => r.id)); console.log(`· swept ${stale.length} stale`); }

  proposalId = randomUUID();
  const secA = randomUUID();
  const secB = randomUUID();
  await sql`
    INSERT INTO proposals (id, tenant_id, opportunity_id, title, stage, is_locked)
    VALUES (${proposalId}::uuid, ${foundation.id}::uuid, ${anyOpp.id}::uuid, ${PROBE + ' · gates'}, 'draft', false)`;
  await sql`
    INSERT INTO proposal_sections
      (id, proposal_id, section_number, title, content, status, sort_index, version, is_locked)
    VALUES
      (${secA}::uuid, ${proposalId}::uuid, '1', 'Technical Approach', ${canvasOf('Technical Approach', 4)}, 'in_progress', 1, 1, false),
      (${secB}::uuid, ${proposalId}::uuid, '2', 'Work Plan',          ${canvasOf('Work Plan', 3)},          'in_progress', 2, 1, false)`;

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await login(ctx, author.email, 'DemoPass123!');
  const P = `${BASE}/api/portal/${foundation.slug}/proposals/${proposalId}`;

  // ── A · the checklist, before any review ────────────────────────────────────────────────────
  H('A · the checklist distinguishes "not reviewed" from "nothing outstanding"');
  let res = json(await api(page, `${P}/findings`));
  A('GET honours the SOP envelope', !!res?.data, JSON.stringify(res)?.slice(0, 120));
  A('an unreviewed proposal says so, rather than reporting a clean bill of health',
    res.data.checklist.headline === 'No review findings on this scope yet.',
    res.data.checklist.headline);
  A('and it is advisory by construction', res.data.checklist.severity === 'warning');

  // Seed findings directly — the point here is the CHECKLIST, and going through the queue would
  // make this a test of the pipeline's timing instead.
  const mk = (sectionId, anchor, resolved) => sql`
    INSERT INTO proposal_comments (proposal_id, section_id, user_id, content, recommendation_type, resolved, anchor)
    VALUES (${proposalId}::uuid, ${sectionId}::uuid, ${author.id}::uuid,
            ${'Finding: the work plan does not name a principal investigator.'},
            'ai_review', ${resolved}, ${anchor ? sql.json(anchor) : null})
    RETURNING id`;
  const [fSecA] = await mk(secA, { scopeLevel: 'section', scopeLabel: 'Technical Approach' }, false);
  const [fNodeA] = await mk(secA, { scopeLevel: 'node', nodeId: `${secA}__n-TechnicalApproach`, scopeLabel: 'Figure 2' }, false);
  const [fDone] = await mk(secA, { scopeLevel: 'node', nodeId: `${secA}__n-TechnicalApproach`, scopeLabel: 'Figure 2' }, true);
  const [fSecB] = await mk(secB, { scopeLevel: 'section', scopeLabel: 'Work Plan' }, false);
  const [fPages] = await mk(secB, { scopeLevel: 'pages', pages: { start: 2, end: 4 }, scopeLabel: 'Pages 2–4' }, false);

  res = json(await api(page, `${P}/findings`));
  const c = res.data.checklist;
  A('the document checklist counts every finding', c.total === 5, `total=${c.total}`);
  A('and separates resolved from open', c.resolved === 1 && c.open === 4, `${c.resolved} resolved / ${c.open} open`);
  A('the headline states what is outstanding', c.headline === '4 of 5 findings still open.', c.headline);
  A('open work is grouped by what it is about — one group per distinct scope',
    c.byScope.length === 4, `${c.byScope.length} group(s): ${JSON.stringify(c.byScope.map((g) => g.label))}`);
  A('and only groups with something OPEN are listed',
    c.byScope.every((g) => g.open > 0), JSON.stringify(c.byScope));
  A('ordered worst-first — a gate that lists alphabetically buries the thing to fix',
    c.byScope.every((g, i) => i === 0 || c.byScope[i - 1].open >= g.open),
    JSON.stringify(c.byScope.map((g) => g.open)));
  A('every group names its level and label',
    c.byScope.every((g) => typeof g.level === 'string' && typeof g.label === 'string'),
    JSON.stringify(c.byScope.map((g) => `${g.level}:${g.label}:${g.open}/${g.total}`)));

  // ── B · resolving moves the number ──────────────────────────────────────────────────────────
  H('B · resolving a finding moves the count — read from Postgres');
  const r = await api(page, `${P}/comments/${fSecA.id}/resolve`, { method: 'POST', body: '{}' });
  A('the resolve route accepts it', r.status === 200, `status=${r.status} ${r.text.slice(0, 90)}`);
  const [row] = await sql`SELECT resolved FROM proposal_comments WHERE id = ${fSecA.id}::uuid`;
  A('the row is actually resolved in the database', row.resolved === true, String(row.resolved));
  res = json(await api(page, `${P}/findings`));
  A('and the checklist follows', res.data.checklist.open === 3 && res.data.checklist.resolved === 2,
    `${res.data.checklist.resolved} resolved / ${res.data.checklist.open} open`);

  // ── C · the scope filter narrows ────────────────────────────────────────────────────────────
  H('C · a scoped query returns that scope, not the proposal');
  const secAQ = json(await api(page, `${P}/findings?level=section&sectionId=${secA}`));
  const secBQ = json(await api(page, `${P}/findings?level=section&sectionId=${secB}`));
  A('section A returns only section A’s findings',
    secAQ.data.findings.length === 3 && secAQ.data.findings.every((f) => f.sectionId === secA),
    `${secAQ.data.findings.length} finding(s)`);
  A('section B returns only section B’s', secBQ.data.findings.length === 2,
    `${secBQ.data.findings.length} finding(s)`);
  // SENSITIVITY: without the two below, "the filter returns something" would pass on no filter.
  A('the two sections do not overlap',
    !secAQ.data.findings.some((f) => secBQ.data.findings.some((g) => g.id === f.id)));
  const nodeQ = json(await api(page, `${P}/findings?level=node&nodeId=${secA}__n-TechnicalApproach`));
  A('a node query returns only what is anchored at that node',
    nodeQ.data.findings.length === 2 && nodeQ.data.findings.every((f) => f.scopeLevel === 'node'),
    `${nodeQ.data.findings.length} finding(s)`);
  const overlap = json(await api(page, `${P}/findings?level=pages&pages=3-5`));
  const miss = json(await api(page, `${P}/findings?level=pages&pages=40-50`));
  A('a page range returns the finding it overlaps', overlap.data.findings.some((f) => f.id === fPages.id));
  A('and a range that overlaps nothing returns nothing', miss.data.findings.length === 0,
    `${miss.data.findings.length} finding(s)`);
  const bad = await api(page, `${P}/findings?level=pages&pages=not-a-range`);
  A('a malformed range is refused', bad.status === 400, `status=${bad.status}`);

  // ── D · the submission gate shows them, as warnings ─────────────────────────────────────────
  H('D · the readiness gate states the open findings, and never blocks on them');
  const readiness = json(await api(page, `${P}/readiness`));
  const blockers = readiness?.data?.blockers ?? [];
  const openFindings = blockers.filter((b) => b.category === 'open_finding');
  A('readiness answers', !!readiness?.data, JSON.stringify(readiness)?.slice(0, 120));
  A('the open findings appear on the gate', openFindings.length > 0, `${openFindings.length} entr(y/ies)`);
  A('EVERY one is a warning, never a blocker — an AI opinion cannot refuse a submission',
    openFindings.every((b) => b.severity === 'warning'),
    JSON.stringify(openFindings.map((b) => b.severity)));
  A('and each names what it is about', openFindings.every((b) => /unresolved review finding/i.test(b.message)),
    openFindings[0]?.message ?? '');

  // ── F · the collaborator belt ───────────────────────────────────────────────────────────────
  H('F · a scoped collaborator sees and resolves only inside their grant');
  const collabEmail = `${PROBE}-collab@example.test`;
  const collabId = randomUUID();
  const collabUser = randomUUID();
  // Borrow the author's bcrypt hash so the probe collaborator can sign in with the same demo
  // password. Local sandbox only; the row is deleted in `finally`.
  //
  // NOTE the snake_case read. This harness's postgres client sets `transform.column.from` to the
  // IDENTITY, unlike `lib/db.ts` which applies `postgres.toCamel` — so `password_hash` comes back as
  // `password_hash` here and as `passwordHash` in the app. Reading it camelCase gave `undefined` and
  // postgres.js refused the insert. The product's own #1 documented crash class, in the harness.
  const [seedHash] = await sql`SELECT password_hash FROM users WHERE email = ${author.email}`;
  if (!seedHash?.password_hash) throw new Error('could not borrow a password hash for the probe collaborator');
  await sql`
    INSERT INTO users (id, email, name, password_hash, role, is_active, tenant_id)
    VALUES (${collabUser}::uuid, ${collabEmail}, 'Probe Collaborator', ${seedHash.password_hash},
            'partner_user', true, ${foundation.id}::uuid)`;
  // Access is PURELY membership-based (identity P4 — the legacy `users.tenant_id` read-through is
  // retired), so `verifyTenantAccess` denies a user who has only the column. `source='collaborator'`
  // is the shape a cross-company collaborator actually carries; without it the first version of this
  // block got "Tenant access denied" and looked like the findings route refusing a valid grant.
  await sql`
    INSERT INTO user_memberships (user_id, tenant_id, role, status, source)
    VALUES (${collabUser}::uuid, ${foundation.id}::uuid, 'partner_user', 'active', 'collaborator')`;
  const [collab] = await sql`
    INSERT INTO proposal_collaborators (id, proposal_id, user_id, email, name, role, assigned_sections, accepted_at)
    VALUES (${collabId}::uuid, ${proposalId}::uuid, ${collabUser}::uuid, ${collabEmail},
            'Probe Collaborator', 'external', ARRAY[${secB}]::uuid[], now())
    RETURNING id`;
  await sql`
    INSERT INTO collaborator_stage_access (collaborator_id, proposal_id, stage, artifact_types, permission)
    VALUES (${collab.id}::uuid, ${proposalId}::uuid, 'draft', ARRAY['narrative']::text[], 'comment')`;

  const cctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const cpage = await login(cctx, collabEmail, 'DemoPass123!');

  const collabView = json(await api(cpage, `${P}/findings`));
  A('the collaborator can read the findings route', !!collabView?.data,
    JSON.stringify(collabView)?.slice(0, 140));
  const seen = collabView?.data?.findings ?? [];
  A('at the DOCUMENT scope they see only their granted section',
    seen.length === 2 && seen.every((f) => f.sectionId === secB),
    `${seen.length} finding(s): ${JSON.stringify([...new Set(seen.map((f) => f.sectionTitle))])}`);
  // SENSITIVITY: the author sees 5 at the same scope. Without this the belt could be a no-op that
  // happens to look right because the fixture is small.
  A('while the author sees all five at the same scope',
    json(await api(page, `${P}/findings`)).data.findings.length === 5);

  const denied = await api(cpage, `${P}/comments/${fNodeA.id}/resolve`, { method: 'POST', body: '{}' });
  A('resolving a finding OUTSIDE the grant is refused', denied.status === 403,
    `status=${denied.status} ${denied.text.slice(0, 90)}`);
  const [stillOpen] = await sql`SELECT resolved FROM proposal_comments WHERE id = ${fNodeA.id}::uuid`;
  A('and nothing was written', stillOpen.resolved === false, String(stillOpen.resolved));

  const allowed = await api(cpage, `${P}/comments/${fSecB.id}/resolve`, { method: 'POST', body: '{}' });
  A('resolving INSIDE the grant is allowed', allowed.status === 200,
    `status=${allowed.status} ${allowed.text.slice(0, 90)}`);
  const [nowResolved] = await sql`SELECT resolved FROM proposal_comments WHERE id = ${fSecB.id}::uuid`;
  A('and it landed', nowResolved.resolved === true, String(nowResolved.resolved));

  console.log(`  · (${fDone.id.slice(0, 8)} was pre-resolved; ${fPages.id.slice(0, 8)} is the page-scoped one)`);
} catch (e) {
  ok = false;
  console.error('\nHARNESS ERROR:', e.message);
} finally {
  await browser.close().catch(() => {});
  // ORDER MATTERS: `proposal_collaborators.user_id` and `user_memberships.user_id` reference the
  // probe user, so the proposal has to go first. Deleting the user up front left it behind on the
  // first run — which the cleanup assertion caught, as it is there to.
  if (proposalId) await purgeRows('proposals', 'id', [proposalId]).catch((e) => {
    ok = false; console.error('CLEANUP FAILED:', e.message);
  });
  await sql`DELETE FROM user_memberships WHERE user_id IN (SELECT id FROM users WHERE email LIKE ${PROBE + '%'})`.catch(() => {});
  await sql`DELETE FROM users WHERE email LIKE ${PROBE + '%'}`.catch((e) => {
    ok = false; console.error('CLEANUP FAILED (users):', e.message);
  });
  const [left] = await sql`SELECT count(*)::int AS n FROM proposals WHERE title LIKE ${PROBE + '%'}`;
  const [users] = await sql`SELECT count(*)::int AS n FROM users WHERE email LIKE ${PROBE + '%'}`;
  console.log(`\n· cleanup: ${left.n} probe proposal(s), ${users.n} probe user(s) remaining (want 0/0)`);
  if (left.n !== 0 || users.n !== 0) ok = false;
  await sql.end();
  console.log(ok ? '\n✓ the gate is a checklist, and the grant holds' : '\n✗ scoped gates have failures above');
  process.exit(ok ? 0 : 1);
}
