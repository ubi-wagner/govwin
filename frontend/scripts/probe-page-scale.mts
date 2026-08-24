/**
 * Does the editor page render at the size it computes for itself?
 *
 * The page container sets `width: canvas.width * scale` AND `transform: scale(scale)`. If both
 * apply, the page is drawn at scale² — correct at full width, where scale clamps to 1, and
 * progressively too small as the viewport narrows. That is invisible by eye (everything inside
 * shrinks together, so it looks right, just small) and trivial to prove:
 *
 *   offsetWidth              → LAYOUT width, before any transform
 *   getBoundingClientRect()  → VISUAL width, after it
 *
 * Equal means one scaling. Different means two.
 */
import { sqlBypass as sql } from '@/lib/db';
import { BASE, launch, signIn } from './lib/cross-company.mts';

let ok = true;
const A = (l: string, c: boolean, x = '') => { console.log(`${c ? '✓' : '✗'} ${l}${x ? ` — ${x}` : ''}`); ok = ok && c; };

const browser = await launch();
try {
  const [doc] = await sql<Array<{ id: string; slug: string; title: string }>>`
    SELECT d.id, t.slug, d.title FROM tenant_documents d
    JOIN tenants t ON t.id = d.tenant_id
    ORDER BY d.created_at DESC LIMIT 1`;
  if (!doc) throw new Error('no tenant_documents to open — run drive-canvas-authoring first');
  const [member] = await sql<Array<{ email: string }>>`
    SELECT u.email FROM users u JOIN user_memberships m ON m.user_id = u.id
    JOIN tenants t ON t.id = m.tenant_id AND t.slug = ${doc.slug}
    WHERE u.is_active AND u.role = 'tenant_admin' ORDER BY u.created_at LIMIT 1`;

  const ctx = await signIn(browser, member.email, process.env.TENANT_PW || 'DemoPass123!');
  const page = ctx.pages()[0];
  console.log(`  · "${doc.title}" @ ${doc.slug}\n`);

  for (const width of [1600, 1100, 800, 600]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${BASE}/portal/${doc.slug}/documents/${doc.id}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);

    const m = await page.evaluate(() => {
      const el = document.querySelector<HTMLElement>('.bg-white.shadow-lg.relative');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { layout: el.offsetWidth, visual: Math.round(r.width) };
    });
    if (!m) { A(`viewport ${width}px`, false, 'page element not found'); continue; }

    const ratio = m.layout > 0 ? m.visual / m.layout : 0;
    A(`viewport ${String(width).padEnd(5)} layout ${String(m.layout).padEnd(4)}px · visual ${String(m.visual).padEnd(4)}px`,
      Math.abs(m.visual - m.layout) <= 1,
      Math.abs(m.visual - m.layout) <= 1 ? 'one scaling' : `visual/layout = ${ratio.toFixed(3)} — scaled TWICE`);
  }
  await ctx.close();
  console.log(`\n${ok ? '✓ the page renders at the size it computes' : '✗ the page is scaled twice — it renders smaller than it computes'}\n`);
} catch (e) {
  console.error('PROBE ERROR', e);
  ok = false;
} finally {
  await browser.close();
  await sql.end({ timeout: 5 });
  process.exit(ok ? 0 : 1);
}
