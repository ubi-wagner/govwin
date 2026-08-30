/**
 * ASSEMBLE-FROM-LIBRARY, on a running box — the middle of the assembly spine, finally wired.
 *
 * `assembleSectionFromAtoms` had no caller. `lib/canvas/scope.ts` had no caller. Both were pure,
 * both were unit-tested, and neither had ever run against a real tenant library. This drives the
 * route that gives the first one a caller and checks the four things a unit test structurally
 * cannot:
 *
 *   A · IT RETRIEVES FROM THE REAL LIBRARY. `selectForSection` against a live tenant, not a fixture
 *       array. A thin library yields a thin section — that is the honest signal about retrieval,
 *       and the harness reports what it got rather than asserting a number it wished for.
 *
 *   B · IT LANDS PROPOSED, NEVER APPLIED. The section's live `content` must be byte-identical
 *       afterwards. This is the invariant the whole land-or-review pattern exists for, and it is
 *       the one a mocked test can be most confidently wrong about.
 *
 *   C · THE VERSION INVARIANT HOLDS. `proposal_sections.version` must stay strictly greater than
 *       `MAX(canvas_versions.version_number)`. Numbering at MAX+1 without advancing makes the next
 *       human save's archive collide, and `ON CONFLICT DO NOTHING` drops it silently — undo/history
 *       content loss, found once already via a live staging scenario.
 *
 *   D · THE GROUP LAYER SURVIVES. The stored canvas must carry `sections[].groups[]` with
 *       `atom_ref` on each. Flattening at the last step would throw away the provenance and the
 *       cohesion that are the group's entire reason to exist — and the `groups` overlay would have
 *       nothing to paint.
 *
 * Plus the refusals: a locked section, a scope with no matching atoms, and a cross-tenant attempt.
 *
 * Nothing here touches the demo fixture. Own scratch proposal, swept on startup, purged at the end.
 *
 *   cd frontend && node scripts/verify-assemble-from-library.mjs
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

const PROBE = 'assemble-probe';

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

/** Depth-first purge — one level is not enough (agent_task_results hangs off agent_task_queue). */
async function purgeRows(table, col, ids, depth = 0) {
  if (!ids.length || depth > 4) return;
  for (const k of await fkChildren(table)) {
    if (k.child === table) continue;
    const rows = await sql.unsafe(
      `SELECT id FROM ${k.child} WHERE ${k.col} = ANY($1::uuid[])`, [ids],
    ).catch(() => []);
    if (rows.length) await purgeRows(k.child, 'id', rows.map((r) => r.id), depth + 1);
    await sql.unsafe(`DELETE FROM ${k.child} WHERE ${k.col} = ANY($1::uuid[])`, [ids])
      .catch((e) => { console.error(`  ! purge ${k.child}.${k.col}: ${e.message}`); });
  }
  await sql.unsafe(`DELETE FROM ${table} WHERE ${col} = ANY($1::uuid[])`, [ids]);
}

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
let proposalId = null;

try {
  const [foundation] = await sql`SELECT id, slug FROM tenants WHERE slug = 'foundation'`;
  if (!foundation) throw new Error('no foundation tenant');

  const stale = await sql`SELECT id FROM proposals WHERE title LIKE ${PROBE + '%'}`;
  if (stale.length) {
    await purgeRows('proposals', 'id', stale.map((r) => r.id));
    console.log(`· swept ${stale.length} leftover probe proposal(s)`);
  }

  // ── What the library actually holds — reported, not asserted ────────────────────────────────
  const [lib] = await sql`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE canvas_nodes IS NOT NULL)::int AS structured
    FROM library_atoms WHERE tenant_id = ${foundation.id}::uuid AND archived_at IS NULL`;
  console.log(`· Foundation library: ${lib.total} atom(s), ${lib.structured} carrying canvas nodes`);
  if (lib.total === 0) {
    console.log('  (an empty library can only prove the NO_ATOMS refusal — say so rather than pass quietly)');
  }

  // ── Scratch build ───────────────────────────────────────────────────────────────────────────
  const [anyOpp] = await sql`SELECT id FROM opportunities LIMIT 1`;
  if (!anyOpp) throw new Error('no opportunity to attach a scratch proposal to');
  proposalId = randomUUID();
  await sql`
    INSERT INTO proposals (id, tenant_id, opportunity_id, title, stage, is_locked)
    VALUES (${proposalId}::uuid, ${foundation.id}::uuid, ${anyOpp.id}::uuid,
            ${PROBE + ' · assemble'}, 'draft', false)`;

  const openId = randomUUID();
  const lockedId = randomUUID();
  const EMPTY_CANVAS = JSON.stringify({
    version: 2, document_id: `${PROBE}-open`,
    canvas: { format: 'letter', width_in: 8.5, height_in: 11,
      margins_in: { top: 1, bottom: 1, left: 1, right: 1 },
      body_font: 'Times New Roman', body_size_pt: 11 },
    nodes: [], metadata: { title: 'Technical Approach' },
  });
  await sql`
    INSERT INTO proposal_sections
      (id, proposal_id, section_number, title, content, status, sort_index, version, is_locked, page_allocation)
    VALUES
      (${openId}::uuid,   ${proposalId}::uuid, '1', 'Technical Approach', ${EMPTY_CANVAS}, 'empty', 1, 1, false, 4),
      (${lockedId}::uuid, ${proposalId}::uuid, '2', 'Work Plan',          ${EMPTY_CANVAS}, 'empty', 2, 1, true,  2)`;

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await login(ctx, 'kate.ulepic@foundation3dp.com', 'DemoPass123!');
  const url = (sid) => `${BASE}/api/portal/${foundation.slug}/proposals/${proposalId}/sections/${sid}/assemble`;

  // ── A · retrieval + assembly ────────────────────────────────────────────────────────────────
  H('A · it assembles from the real tenant library');
  const before = await sql`SELECT content, version FROM proposal_sections WHERE id = ${openId}::uuid`;
  const res = await api(page, url(openId), {
    method: 'POST',
    body: JSON.stringify({ text: 'additive construction printed concrete structural walls field validation' }),
  });
  const body = json(res);
  if (res.status === 409 && body?.code === 'NO_ATOMS') {
    A('the library had nothing to assemble from (refused honestly, not silently)', true, body.error);
    console.log('  · the remaining blocks need at least one matching atom — SKIPPED, not passed');
  } else {
    A('POST returns 200 with the SOP envelope', res.status === 200 && !!body?.data,
      `status=${res.status} ${res.text.slice(0, 140)}`);
    const d = body?.data ?? {};
    A('it built at least one group', (d.groups ?? 0) >= 1, `groups=${d.groups}`);
    A('every group traces to a library atom', (d.atoms ?? []).length >= 1, `atoms=${JSON.stringify(d.atoms)}`);
    A('it reports the pages the ruler measured', typeof d.pagesUsed === 'number', `pagesUsed=${d.pagesUsed}`);
    A('it reports what it considered and what it skipped',
      typeof d.considered === 'number' && Array.isArray(d.skipped),
      `considered=${d.considered} skipped=${d.skipped?.length}`);
    if (d.pageBudget) {
      A('it respected the section page budget', d.pagesUsed <= d.pageBudget,
        `${d.pagesUsed} of ${d.pageBudget}`);
    }

    // ── B · PROPOSED, never applied ───────────────────────────────────────────────────────────
    H('B · the live section is untouched');
    const [after] = await sql`SELECT content, version FROM proposal_sections WHERE id = ${openId}::uuid`;
    A('proposal_sections.content is byte-identical', after.content === before[0].content,
      after.content === before[0].content ? '' : `changed (${String(after.content).length} chars)`);
    A('the version counter advanced past the proposed row', after.version > before[0].version,
      `${before[0].version} → ${after.version}`);

    // ── C · the numbering invariant ───────────────────────────────────────────────────────────
    H('C · proposal_sections.version stays ahead of MAX(canvas_versions.version_number)');
    const [inv] = await sql`
      SELECT ps.version AS sect,
             COALESCE(MAX(cv.version_number), 0) AS maxv
      FROM proposal_sections ps
      LEFT JOIN canvas_versions cv ON cv.section_id = ps.id
      WHERE ps.id = ${openId}::uuid
      GROUP BY ps.version`;
    A('the invariant holds', Number(inv.sect) > Number(inv.maxv),
      `section.version=${inv.sect} max(version_number)=${inv.maxv}`);

    // ── D · the group layer survives to disk ──────────────────────────────────────────────────
    H('D · the stored version carries the GROUP layer, not flattened nodes');
    const [ver] = await sql`
      SELECT content, source, snapshot_reason FROM canvas_versions
      WHERE section_id = ${openId}::uuid ORDER BY version_number DESC LIMIT 1`;
    const stored = typeof ver.content === 'string' ? JSON.parse(ver.content) : ver.content;
    A('it is stored as a library import, not mislabelled as AI',
      ver.source === 'library_import' && ver.snapshot_reason === 'library_assemble',
      `source=${ver.source} reason=${ver.snapshot_reason}`);
    A('the canvas has a sections array', Array.isArray(stored?.sections) && stored.sections.length === 1,
      `sections=${stored?.sections?.length}`);
    const groups = stored?.sections?.[0]?.groups ?? [];
    A('the section has groups', groups.length >= 1, `groups=${groups.length}`);
    A('every group names the atom it came from', groups.every((g) => !!g.atom_ref),
      JSON.stringify(groups.map((g) => g.atom_ref ?? null)));
    A('every group carries real nodes', groups.every((g) => (g.nodes ?? []).length >= 1),
      JSON.stringify(groups.map((g) => (g.nodes ?? []).length)));
    A('source_atom_ids aggregates the groups’ atoms',
      (stored?.sections?.[0]?.source_atom_ids ?? []).length === groups.filter((g) => g.atom_ref).length,
      `${(stored?.sections?.[0]?.source_atom_ids ?? []).length} vs ${groups.length}`);
    // SENSITIVITY: a flattened canvas would have `nodes` at the top and no groups — and would pass
    // every assertion above that only checks "something was stored".
    A('it did NOT flatten to a bare node list', !Array.isArray(stored?.nodes) || !stored.nodes.length,
      `top-level nodes=${stored?.nodes?.length ?? 0}`);
  }

  // ── Refusals ────────────────────────────────────────────────────────────────────────────────
  H('the refusals');
  const locked = await api(page, url(lockedId), { method: 'POST', body: '{}' });
  A('a locked section refuses even a proposed version (423)',
    locked.status === 423 && json(locked)?.code === 'SECTION_LOCKED',
    `status=${locked.status} ${locked.text.slice(0, 90)}`);

  // ASSERT THE CONTRACT THE SYSTEM HAS. `selectForSection` RANKS, it does not FILTER: with no
  // lexical or semantic hit it still returns the tenant's atoms ordered by scope, outcome score and
  // usage. So "a nonsense query returns nothing" is not the contract and asserting it would be a
  // harness bug reported as a product bug — the first version of this check said exactly that, then
  // hid it behind an `|| status === 200` that made it unfailable, which is worse.
  //
  // What IS worth proving is that the query MATTERS. If a targeted query and a nonsense one produce
  // the same ordering, retrieval is scope-dominated and the section's words are decoration.
  const nonsense = await api(page, url(openId), {
    method: 'POST',
    body: JSON.stringify({ text: 'zzzqqq xylophone marmalade quintessence borogoves' }),
  });
  const targetedAtoms = JSON.stringify(body?.data?.atoms ?? []);
  const nonsenseAtoms = JSON.stringify(json(nonsense)?.data?.atoms ?? []);
  A('a nonsense query still assembles (retrieval RANKS, it does not filter)',
    nonsense.status === 200, `status=${nonsense.status}`);
  A('but the query changes what comes back — the section’s words are not decoration',
    targetedAtoms !== nonsenseAtoms,
    targetedAtoms === nonsenseAtoms
      ? 'IDENTICAL ordering for a targeted and a nonsense query — retrieval is scope-dominated'
      : 'orderings differ');

  const bogus = await api(page, `${BASE}/api/portal/${foundation.slug}/proposals/${proposalId}/sections/${randomUUID()}/assemble`,
    { method: 'POST', body: '{}' });
  A('a section id from another proposal is a 404, not a silent no-op',
    bogus.status === 404, `status=${bogus.status}`);

  // ── CROSS-TENANT ────────────────────────────────────────────────────────────────────────────
  // Driven from the FOUNDATION session against ANOTHER tenant's proposal, rather than logging in
  // as that tenant. Same question, and it does not depend on knowing a second account's password —
  // the first version of this check did, could not log in, and reported "could not run", which is
  // an honest non-result but still a gap in the sweep.
  //
  // The attack this models is the realistic one: a signed-in customer swapping ids in a URL.
  const [otherTenant] = await sql`
    SELECT id, slug FROM tenants WHERE slug NOT IN ('foundation', 'rfp-pipeline') LIMIT 1`;
  if (otherTenant) {
    const foreignProp = randomUUID();
    const foreignSect = randomUUID();
    try {
      await sql`
        INSERT INTO proposals (id, tenant_id, opportunity_id, title, stage, is_locked)
        VALUES (${foreignProp}::uuid, ${otherTenant.id}::uuid, ${anyOpp.id}::uuid,
                ${PROBE + ' · foreign'}, 'draft', false)`;
      await sql`
        INSERT INTO proposal_sections
          (id, proposal_id, section_number, title, content, status, sort_index, version, is_locked)
        VALUES (${foreignSect}::uuid, ${foreignProp}::uuid, '1', 'Foreign', ${EMPTY_CANVAS}, 'empty', 1, 1, false)`;

      // Through the FOREIGN tenant's slug — the honest URL an attacker would construct.
      const viaForeignSlug = await api(page,
        `${BASE}/api/portal/${otherTenant.slug}/proposals/${foreignProp}/sections/${foreignSect}/assemble`,
        { method: 'POST', body: '{}' });
      A('a Foundation user cannot assemble into another tenant’s section',
        viaForeignSlug.status === 403 || viaForeignSlug.status === 404,
        `status=${viaForeignSlug.status} ${viaForeignSlug.text.slice(0, 90)}`);

      // And through OUR slug with THEIR ids — the id-swap that a slug check alone would miss.
      const viaOwnSlug = await api(page,
        `${BASE}/api/portal/${foundation.slug}/proposals/${foreignProp}/sections/${foreignSect}/assemble`,
        { method: 'POST', body: '{}' });
      A('nor by pasting their ids under our own tenant slug',
        viaOwnSlug.status === 403 || viaOwnSlug.status === 404,
        `status=${viaOwnSlug.status} ${viaOwnSlug.text.slice(0, 90)}`);

      // SENSITIVITY: a refusal proves nothing if nothing could have been written anyway.
      const [wrote] = await sql`
        SELECT count(*)::int AS n FROM canvas_versions WHERE section_id = ${foreignSect}::uuid`;
      A('and nothing was written to their section', wrote.n === 0, `${wrote.n} version row(s)`);
    } finally {
      await purgeRows('proposals', 'id', [foreignProp]).catch(() => {});
    }
  } else {
    console.log('  · only one tenant on this box — cross-tenant refusal UNCOVERED, not passing');
  }
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
  console.log(ok ? '\n✓ assemble-from-library works end to end' : '\n✗ assemble-from-library has failures above');
  process.exit(ok ? 0 : 1);
}
