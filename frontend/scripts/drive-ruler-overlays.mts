/**
 * The ruler system, driven in a real browser on the case that motivates it.
 *
 * Authors a document shaped exactly like the failure an author feels — a sentence of prose above a
 * table too tall to fit — turns the Grid overlay on, and checks that what appears on the page is
 * what the paginator says. The unit tests prove the geometry; this proves the geometry reaches the
 * screen, which is the step B78/B79 exist to remind everyone is not implied by the first.
 *
 *   cd frontend && node --import tsx scripts/drive-ruler-overlays.mts
 */
import fs from 'fs';
import path from 'path';
import { sqlBypass as sql } from '@/lib/db';
import { CANVAS_PRESETS, paginate, type CanvasDocument, type CanvasNode } from '@/lib/types/canvas-document';
import { BASE, launch, signIn } from './lib/cross-company.mts';

const OUT = '/home/user/govwin/docs/assets/ruler';
fs.mkdirSync(OUT, { recursive: true });
let ok = true;
const A = (l: string, c: boolean, x = '') => { console.log(`${c ? '✓' : '✗'} ${l}${x ? ` — ${x}` : ''}`); ok = ok && c; };
const note = (s: string) => console.log(`  · ${s}`);

const N = (type: string, content: unknown): CanvasNode => ({
  id: crypto.randomUUID(), type, content, style: {},
  provenance: { source: 'manual' }, history: [], library_eligible: false,
} as unknown as CanvasNode);

const browser = await launch();
try {
  const [target] = await sql<Array<{ slug: string; tenantId: string }>>`
    SELECT t.slug, t.id AS "tenantId" FROM tenants t
    JOIN user_memberships m ON m.tenant_id = t.id
    JOIN users u ON u.id = m.user_id AND u.is_active AND u.role = 'tenant_admin'
    GROUP BY t.slug, t.id ORDER BY t.created_at LIMIT 1`;
  const [member] = await sql<Array<{ email: string }>>`
    SELECT u.email FROM users u JOIN user_memberships m ON m.user_id = u.id
    WHERE m.tenant_id = ${target.tenantId}::uuid AND u.is_active AND u.role = 'tenant_admin' LIMIT 1`;

  // THE CASE: one sentence, then a table too tall to fit behind it.
  const nodes = [
    N('heading', { level: 1, text: 'Relocation probe' }),
    N('text_block', { text: 'One sentence of prose, above a table that will not fit behind it.' }),
    N('table', { headers: ['Row', 'Value'], rows: Array.from({ length: 40 }, (_, i) => [`r${i + 1}`, 'x']) }),
    N('text_block', { text: 'Trailing prose, after the table.' }),
  ];
  const doc = {
    version: 2, document_id: crypto.randomUUID(), canvas: { ...CANVAS_PRESETS.letter_standard }, nodes: [],
    sections: [{ id: crypto.randomUUID(), title: 'Relocation probe', layout: { mode: 'flow' }, groups: [{ id: crypto.randomUUID(), nodes }] }],
    metadata: { title: 'Relocation probe', volume_id: '', required_item_id: '', proposal_id: '', solicitation_id: '', created_at: '', last_modified_at: '', last_modified_by: '', version_number: 1, status: 'in_progress' },
  } as unknown as CanvasDocument;

  const layout = paginate(doc);
  const tableInfo = layout.perNode.find((n) => n.id === nodes[2].id)!;
  note(`the paginator says: ${layout.totalPages} pages · the table starts on page ${tableInfo.startPage}`);
  A('the fixture really does relocate (the table does not start on page 1)', tableInfo.startPage > 1);

  const ctx = await signIn(browser, member.email, process.env.TENANT_PW || 'DemoPass123!');
  const page = ctx.pages()[0];

  const create = await page.evaluate(async ([slug]) => {
    const r = await fetch(`/api/portal/${slug}/documents`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ preset: 'letter', title: 'Relocation probe' }),
    });
    return { status: r.status, json: await r.json().catch(() => null) };
  }, [target.slug] as const) as { status: number; json: any };
  const documentId = create.json?.data?.documentId;
  A('created a document to draw on', !!documentId, `HTTP ${create.status}`);
  if (!documentId) throw new Error('no document');

  const saved = await page.evaluate(async ([slug, id, d]) => {
    const r = await fetch(`/api/portal/${slug}/documents/${id}/save`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: d, baseVersion: 1 }),
    });
    return r.status;
  }, [target.slug, documentId, doc] as const) as number;
  A('saved the relocating document', saved === 200, `HTTP ${saved}`);

  await page.setViewportSize({ width: 1600, height: 1400 });
  await page.goto(`${BASE}/portal/${target.slug}/documents/${documentId}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  // Turn the Grid overlay on the way a person does.
  const gridBtn = page.getByRole('button', { name: /^Grid$/ }).first();
  const hasBtn = await gridBtn.count() > 0;
  A('the Grid toggle is on the overlay bar', hasBtn);
  if (hasBtn) { await gridBtn.click(); await page.waitForTimeout(1800); }

  // NO NAMED HELPERS INSIDE page.evaluate. tsx compiles this file with esbuild's `keepNames`, which
  // wraps a `const f = () => …` in a `__name(...)` call — a helper that exists in Node and not in
  // the browser context the function is serialised into. It fails as `__name is not defined`, which
  // looks nothing like its cause. Everything below is inline.
  const seen = await page.evaluate(() => {
    const divs = Array.from(document.querySelectorAll('div'));
    const text = document.body.innerText;
    return {
      gridPresent: !!document.querySelector('[data-testid="measure-grid"]'),
      dashed: divs.filter((e) => String((e as HTMLElement).style.borderTop).includes('dashed')).length,
      hatched: divs.filter((e) => String((e as HTMLElement).style.background).includes('repeating-linear-gradient')).length,
      pageLabels: (text.match(/page \d/g) || []).length,
      pushed: text.includes('pushed'),
    };
  }) as { gridPresent: boolean; dashed: number; hatched: number; pageLabels: number; pushed: boolean };

  A('the grid layer rendered', seen.gridPresent);
  A('a page boundary is drawn', seen.dashed > 0, `${seen.dashed} dashed rule(s)`);
  A('the relocation gap is shaded', seen.hatched > 0, `${seen.hatched} hatched band(s)`);
  A('a boundary is labelled "pushed" — the cause is legible', seen.pushed);

  await page.screenshot({ path: path.join(OUT, 'ruler-relocation.png'), fullPage: true });
  note('shot docs/assets/ruler/ruler-relocation.png');

  // clean up: the probe document is ours, not fixture
  await sql`DELETE FROM tenant_documents WHERE id = ${documentId}::uuid`;
  note('probe document removed');
  await ctx.close();

  console.log(`\n${ok ? '✓ the ruler system reaches the screen on the case that motivates it' : '✗ see failures'}\n`);
} catch (e) {
  console.error('DRIVE ERROR', e);
  ok = false;
} finally {
  await browser.close();
  await sql.end({ timeout: 5 });
  process.exit(ok ? 0 : 1);
}
