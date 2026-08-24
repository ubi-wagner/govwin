/**
 * Which format controls can a user actually REACH, on each canvas surface?
 *
 * ⚠️ INCOMPLETE — DO NOT TRUST ITS OUTPUT YET, and deliberately NOT registered in the branch suite.
 * It reports zero controls on all three surfaces, which is provably wrong: opening an existing
 * document by hand shows the block toolbar rendering with `title="Bold (block-level)"`, plus the
 * inline run toolbar and the sidebar's Node tab. The drive's own document does not reach that
 * state and I have not yet found why — the save is NOT the cause (verified: a fresh create+save
 * lands node_count=2 and canvas.nodes length 2, so the content persists correctly).
 *
 * Left in place because the instrumentation it depends on is real and the question it asks is the
 * right one. Finishing it means finding why its freshly-authored document renders no nodes for the
 * probe while an existing one renders 21.
 *
 * WHY THIS EXISTS, and it is a confession. This question was answered three times from source code
 * and answered wrong twice. A grep for `style.highlight` reported "highlight is exposed in 0
 * components" — the component destructures to `s`, so `s.highlight` never matched, and a fully
 * built, fully wired control was recommended as missing work. The correction was itself uncertain:
 * `NodeFormatControls` mounts in exactly one place, `canvas-editor` forks by format, and reading
 * that fork tells you which COMPONENT renders, not which CONTROL a person can click.
 *
 * Source can answer "does this code exist". Only the running app answers "can someone use it", and
 * the difference between those two questions is the entire subject here.
 *
 * HOW IT MEASURES. The controls carry `data-control="<name>"`, so this enumerates them from the
 * live DOM rather than pattern-matching markup. That instrumentation is the durable half of the
 * change: a control added later is discoverable the day it ships, and one that quietly stops
 * rendering shows up as a gap instead of an assumption.
 *
 * WHAT IT DRIVES. A real document, deck and spreadsheet, authored through the portal routes as a
 * signed-in tenant_admin, each opened in the editor with a node selected — because most of these
 * controls only render for a selection, and a sweep that never selects anything would report an
 * empty ribbon on every surface and call it a finding.
 *
 *   cd frontend && npx tsx scripts/drive-control-reachability.mts
 * Exit 0 — a SURVEY. It reports the map; deciding a surface should carry a control is a judgement.
 */
import { sql, sqlBypass } from '@/lib/db';
import { BASE, launch, signIn } from './lib/cross-company.mts';
import { snapshotResidue, reclaimResidue, describeResidue, type ResidueSnapshot } from './lib/harness-residue.mts';
import { CANVAS_PRESETS, type CanvasDocument, type CanvasNode } from '@/lib/types/canvas-document';

/**
 * The common ribbon, matched on the handles the DOM ALREADY carries — `title`, `aria-label`, text.
 *
 * NOT on the `data-control` attributes this change also adds. Those are the durable mechanism, but
 * they only exist in a build, and a probe that silently measures a stale bundle is worse than one
 * that measures nothing: the first run of this drive reported ZERO controls on all three surfaces
 * because the served chunk predated the tagging. Verified by reading the live element —
 * `title="Bold (block-level)"` present, `data-control` absent, attributes: type, disabled, class,
 * title. Matching on `title` measures whatever is actually deployed.
 *
 * PRESENT AND ENABLED ARE DIFFERENT FACTS. The block toolbar renders its buttons `disabled` until
 * something is selected, so "is it in the DOM" answers the wrong question — a control a user cannot
 * press is not a capability they have. Both are reported.
 */
const COMMON: ReadonlyArray<{ name: string; match: RegExp }> = [
  { name: 'bold', match: /^Bold/i }, { name: 'italic', match: /^Italic/i },
  { name: 'underline', match: /^Underline/i }, { name: 'strikethrough', match: /^Strikethrough/i },
  { name: 'text colour', match: /^Text colou?r/i }, { name: 'highlight', match: /highlight/i },
  { name: 'font size', match: /^(Larger|Smaller)/i },
  { name: 'superscript', match: /^Superscript/i }, { name: 'subscript', match: /^Subscript/i },
  { name: 'align', match: /^Align|^Justif/i },
  { name: 'fill', match: /^Fill$/i }, { name: 'border', match: /^Border/i },
  { name: 'opacity', match: /^Opacity/i }, { name: 'fill opacity', match: /^Fill opacity/i },
  { name: 'shadow', match: /^Shadow/i }, { name: 'rotation', match: /^Rotation/i },
  { name: 'position x/y/w/h', match: /^[XYWH] \(in\)/i }, { name: 'text wrap', match: /^Wrap/i },
];

let seq = 0;
const node = (type: string, content: unknown, style: unknown = {}): CanvasNode => ({
  id: `r${++seq}`, type, content, style, provenance: { source: 'manual' }, history: [],
  library_eligible: false,
} as unknown as CanvasNode);

/** One document per surface, each carrying a TEXT node and a SHAPE node.
 *  Both, deliberately: the run-styling group renders for text and the box group for a shape, so a
 *  probe with only one of them under-reports the surface by exactly the other group. */
function docFor(preset: 'letter_standard' | 'slide_deck' | 'spreadsheet', title: string): CanvasDocument {
  return {
    version: 1,
    canvas: { ...CANVAS_PRESETS[preset] },
    metadata: { title },
    nodes: [
      node('heading', { level: 1, text: 'Reachability probe' }),
      node('text_block', { text: 'A paragraph the run-styling group applies to.' }),
      node('shape', { shape: 'rectangle', text: 'A shape the box group applies to.' }),
    ],
  } as unknown as CanvasDocument;
}

const SURFACES = [
  { key: 'document', preset: 'letter_standard' as const, uiPreset: 'letter', title: 'Reach probe — document' },
  { key: 'deck', preset: 'slide_deck' as const, uiPreset: 'deck', title: 'Reach probe — deck' },
  { key: 'sheet', preset: 'spreadsheet' as const, uiPreset: 'sheet', title: 'Reach probe — sheet' },
];

async function main() {
  const [target] = await sqlBypass<Array<{ slug: string; tenantId: string }>>`
    SELECT t.slug, t.id AS "tenantId" FROM tenants t
    JOIN user_memberships m ON m.tenant_id = t.id
    JOIN users u ON u.id = m.user_id AND u.is_active AND u.role = 'tenant_admin'
    GROUP BY t.slug, t.id ORDER BY t.created_at LIMIT 1`;
  if (!target) { console.error('CANT-RUN no tenant with an active tenant_admin.'); process.exit(1); }
  const [member] = await sqlBypass<Array<{ email: string }>>`
    SELECT u.email FROM users u JOIN user_memberships m ON m.user_id = u.id
    WHERE m.tenant_id = ${target.tenantId}::uuid AND u.is_active AND u.role = 'tenant_admin'
    ORDER BY u.created_at LIMIT 1`;
  if (!member) { console.error('CANT-RUN tenant has no active tenant_admin.'); process.exit(1); }

  console.log(`\n── format controls reachable on each surface · ${member.email} @ ${target.slug} ──\n`);

  const browser = await launch();
  const ctx = await signIn(browser, member.email, process.env.TENANT_PW || 'DemoPass123!');
  const page = ctx.pages()[0];
  // Wide enough that the properties panel is an inline column, not a narrow-screen drawer.
  await page.setViewportSize({ width: 1600, height: 1000 });
  const created: string[] = [];
  let residueBefore: ResidueSnapshot | null = null;
  const found: Record<string, Set<string>> = {};

  try {
    residueBefore = await snapshotResidue();

    for (const s of SURFACES) {
      found[s.key] = new Set();

      const cr = await page.evaluate(async ([u, p, t]) => {
        const res = await fetch(u as string, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ preset: p, title: t }),
        });
        return { status: res.status, json: await res.json().catch(() => null) };
      }, [`/api/portal/${target.slug}/documents`, s.uiPreset, s.title] as const) as { status: number; json: any };

      const documentId = cr.json?.data?.documentId;
      if (!documentId) { console.log(`  ${s.key.padEnd(9)} CANT-RUN — create returned ${cr.status}`); continue; }
      created.push(documentId);

      await page.evaluate(async ([u, d, t]) => {
        await fetch(u as string, {
          method: 'PUT', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ content: d, title: t }),
        });
      }, [`/api/portal/${target.slug}/documents/${documentId}/save`, docFor(s.preset, s.title), s.title] as const);

      await page.goto(`${BASE}/portal/${target.slug}/documents/${documentId}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(1200);

      // SELECT SOMETHING FIRST. Most of these controls render only for a selection; a sweep that
      // clicks nothing measures an empty ribbon and calls every surface bare.
      for (const sel of ['[data-node-id]', '[data-testid="canvas-node"]', '.canvas-node', 'h1', 'p']) {
        const el = page.locator(sel).first();
        if (await el.count().catch(() => 0)) {
          await el.click({ timeout: 2500 }).catch(() => {});
          await page.waitForTimeout(500);
          break;
        }
      }
      // THEN OPEN THE TAB THE CONTROLS LIVE ON.
      //
      // The properties panel is tabbed and opens on `compliance`; the format groups render under
      // `activeTab === 'node'`. A probe that selects a node and stops reports an empty ribbon on
      // every surface — which is exactly what the first run of this drive did, and it looked like a
      // devastating product finding rather than a missing click.
      //
      // Worth noting as a UX fact while measuring it: the ribbon is two steps from the page —
      // select a node, then switch tab — on a panel that opens somewhere else.
      for (const tab of ['Node', 'Select']) {
        const t = page.getByRole('button', { name: tab, exact: true }).first();
        if (await t.count().catch(() => 0)) { await t.click({ timeout: 2000 }).catch(() => {}); break; }
      }
      await page.waitForTimeout(600);

      // A shape carries the box group; click one too if the surface renders it.
      const shape = page.locator('[data-node-type="shape"]').first();
      if (await shape.count().catch(() => 0)) {
        await shape.click({ timeout: 2500 }).catch(() => {});
        await page.waitForTimeout(500);
      }

      // Every interactive element's handle + whether it is usable right now.
      const handles = await page.evaluate(() =>
        Array.from(document.querySelectorAll('button, input, select, label'))
          .map((e) => ({
            h: (e.getAttribute('title') || e.getAttribute('aria-label')
                || (e.previousElementSibling?.textContent ?? '')
                || (e.textContent ?? '')).trim(),
            off: (e as HTMLButtonElement).disabled === true,
          }))
          .filter((x) => x.h));
      for (const c of COMMON) {
        const hit = handles.find((x) => c.match.test(x.h));
        if (hit) found[s.key].add(hit.off ? `${c.name}:off` : c.name);
      }
    }

    // ── the map ────────────────────────────────────────────────────────────────────────────────
    const cols = SURFACES.map((s) => s.key);
    console.log(`  ${'CONTROL'.padEnd(18)}${cols.map((c) => c.padStart(10)).join('')}`);
    console.log(`  ${'─'.repeat(18 + cols.length * 10)}`);
    for (const c of COMMON) {
      const row = cols.map((k) => {
        const on = found[k]?.has(c.name);
        const off = found[k]?.has(`${c.name}:off`);
        return (on ? '✓' : off ? '◐' : '·').padStart(10);
      }).join('');
      console.log(`  ${c.name.padEnd(18)}${row}`);
    }

    console.log(`\n  ✓ present and usable · ◐ present but DISABLED · · not on that surface\n`);
    for (const k of cols) {
      const usable = COMMON.filter((c) => found[k]?.has(c.name)).map((c) => c.name);
      const off = COMMON.filter((c) => found[k]?.has(`${c.name}:off`)).map((c) => c.name);
      const gone = COMMON.filter((c) => !found[k]?.has(c.name) && !found[k]?.has(`${c.name}:off`)).map((c) => c.name);
      console.log(`  ${k}`);
      console.log(`    usable  (${usable.length}): ${usable.join(', ') || '—'}`);
      if (off.length) console.log(`    disabled(${off.length}): ${off.join(', ')}`);
      if (gone.length) console.log(`    absent  (${gone.length}): ${gone.join(', ')}`);
    }
    console.log();
  } finally {
    if (residueBefore) {
      try { console.log(`  ${describeResidue(await reclaimResidue(residueBefore))}`); }
      catch (e) { console.error('  cleanup failed:', e); }
    }
    await browser.close();
    await sql.end().catch(() => {});
    await sqlBypass.end().catch(() => {});
  }
}

main().catch(async (e) => {
  console.error('DRIVE ERROR', e);
  await sql.end().catch(() => {}); await sqlBypass.end().catch(() => {});
  process.exit(1);
});
