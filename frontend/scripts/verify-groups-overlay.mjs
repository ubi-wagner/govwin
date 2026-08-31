/**
 * THE GROUP LAYER, ON SCREEN — does a canvas that carries groups actually render, and can a person
 * see them?
 *
 * Two claims, and neither can be checked without a browser.
 *
 *   1. A SECTIONED CANVAS RENDERS AT ALL. `CanvasRenderer` read `doc.nodes` directly. A canvas
 *      carrying the section layer (`sections[].groups[].nodes`) has no top-level `nodes`, so it
 *      rendered a BLANK PAGE — with status 200, no server error, and no client throw. Exactly the
 *      B78/B79 blind spot: a harness gating on `resp.status() < 400` is structurally incapable of
 *      seeing it. The moment the library assembler started writing real groups, that would have
 *      been every assembled section. So this reads the rendered text and counts nodes.
 *
 *   2. THE GROUPS ARE VISIBLE. `data-group-id` on each node, the `Groups` chip offered, and the
 *      overlay class applied when it is toggled. A chip that paints nothing is worse than no chip:
 *      it reads as "this document has no groups" when it means "this shape cannot express them".
 *
 * The sensitivity check that keeps claim 2 honest: the chip must be ABSENT on a flat canvas. If it
 * appeared everywhere, "the chip appears" would prove nothing about the group layer.
 *
 * Route: scratch proposal → assemble from the library (writes groups) → restore that version so the
 * LIVE content carries them → open the section editor as a real signed-in customer.
 *
 *   cd frontend && node scripts/verify-groups-overlay.mjs
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

const PROBE = 'groups-probe';
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

/**
 * The canvas frame, COPIED FROM A STORED ROW rather than typed from memory.
 *
 * The first version of this fixture invented `{width_in, height_in, margins_in, body_font,
 * body_size_pt}` — plausible, readable, and wrong in every field. The real shape is POINTS:
 * `{width, height, margins:{...}, font_default:{family,size}}`. The editor rendered an error
 * boundary for it, and for a while that looked like a product defect in the group work. It was the
 * fixture. Rule 3 of the verification rules, learned again: copy the shape from the source.
 */
const FRAME = {
  width: 612, height: 792,
  margins: { top: 72, right: 72, bottom: 72, left: 72 },
  format: 'letter', header: null, footer: null,
  font_default: { family: 'Times New Roman', size: 11 },
  line_spacing: 1, min_font_size: 10, max_pages: 10, max_slides: null,
};
const node = (id, text) => ({
  id, type: 'text_block', content: { text },
  style: {}, provenance: { source: 'manual' }, history: [], library_eligible: false,
});
const EMPTY_CANVAS = JSON.stringify({
  version: 2, document_id: `${PROBE}-flat`, canvas: FRAME,
  nodes: [node('flat-1', 'A flat canvas with no group layer at all, used as the control.')],
  // Metadata copied from a stored row too: `{title, status, proposal_id, version_number}`.
  // An invented one omitting `status` sent the section workspace to its error boundary.
  metadata: { title: 'Control', status: 'in_progress', version_number: 1 },
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
  const groupedId = randomUUID();
  const flatId = randomUUID();
  await sql`
    INSERT INTO proposals (id, tenant_id, opportunity_id, title, stage, is_locked)
    VALUES (${proposalId}::uuid, ${foundation.id}::uuid, ${anyOpp.id}::uuid, ${PROBE + ' · overlay'}, 'draft', false)`;
  await sql`
    INSERT INTO proposal_sections
      (id, proposal_id, section_number, title, content, status, sort_index, version, is_locked, page_allocation)
    VALUES
      (${groupedId}::uuid, ${proposalId}::uuid, '1', 'Technical Approach', ${EMPTY_CANVAS}, 'empty', 1, 1, false, 4),
      (${flatId}::uuid,    ${proposalId}::uuid, '2', 'Control Section',    ${EMPTY_CANVAS}, 'empty', 2, 1, false, 2)`;

  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await login(ctx, 'kate.ulepic@foundation3dp.com', 'DemoPass123!');
  const P = `${BASE}/api/portal/${foundation.slug}/proposals/${proposalId}`;

  // ── Build a section whose LIVE content carries groups ────────────────────────────────────────
  H('setup · assemble, then restore so the live section carries the group layer');
  const asm = json(await api(page, `${P}/sections/${groupedId}/assemble`, {
    method: 'POST',
    body: JSON.stringify({ text: 'additive construction printed concrete structural validation' }),
  }));
  if (!asm?.data?.versionNumber) throw new Error(`assemble failed: ${JSON.stringify(asm)}`);
  A('assembled a version with groups', (asm.data.groups ?? 0) > 0, `groups=${asm.data.groups}`);

  const restore = await api(page, `${P}/sections/${groupedId}/versions`, {
    method: 'POST', body: JSON.stringify({ versionNumber: asm.data.versionNumber }),
  });
  A('restored it into the live section', restore.status === 200, `status=${restore.status} ${restore.text.slice(0, 120)}`);

  const [live] = await sql`SELECT content FROM proposal_sections WHERE id = ${groupedId}::uuid`;
  const liveDoc = typeof live.content === 'string' ? JSON.parse(live.content) : live.content;
  const liveGroups = liveDoc?.sections?.[0]?.groups ?? [];
  A('the LIVE section content now carries groups', liveGroups.length > 0, `groups=${liveGroups.length}`);

  // ── 1 · a sectioned canvas renders ──────────────────────────────────────────────────────────
  H('1 · a canvas carrying the section layer actually renders');
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  const editorUrl = `${BASE}/portal/${foundation.slug}/proposals/${proposalId}/sections/${groupedId}`;
  const resp = await page.goto(editorUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);
  A('the editor route answers', (resp?.status() ?? 0) < 400, `status=${resp?.status()}`);

  const rendered = await page.evaluate(() => ({
    nodes: document.querySelectorAll('[data-node-id]').length,
    grouped: document.querySelectorAll('[data-group-id]').length,
    starts: document.querySelectorAll('[data-group-pos="start"], [data-group-pos="solo"]').length,
    text: (document.body.innerText || '').length,
    errorSurface: /Application error|Something went wrong|Unhandled Runtime Error/i.test(document.body.innerText || ''),
  }));
  // A 200 IS NOT EVIDENCE A PAGE RENDERED (bug log B78 · B79) — read the content.
  A('no client error surface', !rendered.errorSurface);
  A('no client throw during render', errors.length === 0, errors.slice(0, 2).join(' | '));
  A('it painted real nodes, not a blank page', rendered.nodes > 0, `${rendered.nodes} node(s)`);

  // ── 2 · the groups are addressable and visible ───────────────────────────────────────────────
  H('2 · the group layer reaches the DOM and the chip is offered');
  A('every rendered node carries its group', rendered.grouped > 0 && rendered.grouped === rendered.nodes,
    `${rendered.grouped} of ${rendered.nodes} node(s) grouped`);
  A('each group marks where it starts', rendered.starts >= liveGroups.length,
    `${rendered.starts} start marker(s) for ${liveGroups.length} group(s)`);

  const chip = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent?.trim() === 'Groups');
    return b ? { present: true, pressed: b.getAttribute('aria-pressed') } : { present: false };
  });
  A('the Groups chip is offered', chip.present === true, JSON.stringify(chip));
  A('and starts off — a clean document until summoned', chip.pressed === 'false');

  if (chip.present) {
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent?.trim() === 'Groups');
      b?.click();
    });
    await page.waitForTimeout(600);
    const painted = await page.evaluate(() => {
      const host = document.querySelector('.cv-ov.ov-groups');
      if (!host) return { on: false };
      const first = host.querySelector('[data-group-pos="start"], [data-group-pos="solo"]');
      // The rail is a ::after pseudo-element — read the computed style, because the class alone
      // proves the toggle flipped, not that the stylesheet paints anything.
      const cs = first ? getComputedStyle(first, '::after') : null;
      return { on: true, rail: cs?.borderLeftStyle ?? null, width: cs?.borderLeftWidth ?? null };
    });
    A('toggling it applies the overlay layer', painted.on === true);
    A('and the stylesheet actually paints a rail', painted.rail === 'dashed' || painted.rail === 'solid',
      `border-left-style=${painted.rail} width=${painted.width}`);
  }

  // ── SENSITIVITY · the chip must be ABSENT on a flat canvas ───────────────────────────────────
  H('sensitivity · the chip is absent where there is nothing to show');
  errors.length = 0;
  await page.goto(`${BASE}/portal/${foundation.slug}/proposals/${proposalId}/sections/${flatId}`,
    { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);
  const control = await page.evaluate(() => ({
    nodes: document.querySelectorAll('[data-node-id]').length,
    grouped: document.querySelectorAll('[data-group-id]').length,
    chip: [...document.querySelectorAll('button')].some((x) => x.textContent?.trim() === 'Groups'),
    // Say WHY when it does not render. "0 nodes" alone sends the reader looking in the wrong place.
    surface: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 200),
  }));
  A('the control section still renders', control.nodes > 0,
    control.nodes > 0 ? `${control.nodes} node(s)`
      : `0 nodes · page says "${control.surface}" · ${errors.slice(0, 2).join(' | ') || 'no client error'}`);
  A('no node claims a group', control.grouped === 0, `${control.grouped} grouped`);
  A('and the Groups chip is NOT offered', control.chip === false);
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
  console.log(ok ? '\n✓ the group layer renders and is visible' : '\n✗ the groups overlay has failures above');
  process.exit(ok ? 0 : 1);
}
