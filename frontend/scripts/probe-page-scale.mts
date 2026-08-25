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

// Declared out here so `finally` can clean it up — inside the try it is out of scope there, and
// the probe then measured correctly and died on the way out with `scratchId is not defined`.
let scratchId: string | null = null;

const browser = await launch();
try {
  /**
   * Pick a document THIS PROBE CAN ACTUALLY OPEN — one whose tenant has a signed-in-able admin.
   *
   * The previous version took the newest `tenant_documents` row and then looked for a tenant_admin
   * in its tenant. On a fresh box the only document is the house tenant's platform overview, and
   * `rfp-pipeline` has ZERO tenant_admin memberships **by design** — it is the platform's own
   * copy-forward shelf, not a customer. So `member` was undefined and the probe died with
   * `TypeError: Cannot read properties of undefined (reading 'email')`, which reads like a broken
   * product and is a missing guard: the `!doc` case was handled, the `!member` case was not.
   *
   * Choosing the document and the actor in ONE query makes the pair impossible to split, and the
   * house tenant simply never matches. If nothing matches, the probe REPORTS that it measured
   * nothing rather than crashing or, worse, passing — a probe that cannot run is uncovered, not
   * green.
   */
  const [doc] = await sql<Array<{ id: string; slug: string; title: string; email: string }>>`
    SELECT d.id, t.slug, d.title, u.email
    FROM tenant_documents d
    JOIN tenants t ON t.id = d.tenant_id
    JOIN user_memberships m ON m.tenant_id = t.id
    JOIN users u ON u.id = m.user_id AND u.is_active AND u.role = 'tenant_admin'
    ORDER BY d.created_at DESC LIMIT 1`;
  /**
   * If there is nothing to open, AUTHOR ONE — do not depend on another drive's leftovers.
   *
   * `drive-canvas-authoring` runs immediately before this probe in `run-branch-drives.sh` and ends
   * with `cleanup: 5 tenant_documents` — correctly, because a scenario that builds its own world
   * should take it away again. The consequence was that this probe could NEVER run inside the
   * suite: the drive before it deletes exactly the row it needs. That is B103's shape (a
   * self-disposing scenario erasing what another instrument depends on), and the cure is the same
   * pattern rather than a complaint about it — build the scenario, measure, take it away.
   *
   * Authored through the product's own POST, as the real actor, so this exercises the same creation
   * path a customer uses instead of an INSERT that could drift from it.
   */
  let target = doc;
  if (!target) {
    const [host] = await sql<Array<{ slug: string; email: string }>>`
      SELECT t.slug, u.email FROM tenants t
      JOIN user_memberships m ON m.tenant_id = t.id
      JOIN users u ON u.id = m.user_id AND u.is_active AND u.role = 'tenant_admin'
      WHERE t.status = 'active' ORDER BY t.slug LIMIT 1`;
    if (!host) {
      console.log('· NOT MEASURED — no active tenant has a tenant_admin membership to drive as.');
      console.log('  Uncovered, not a finding.');
      process.exit(0);
    }
    const ctx0 = await signIn(browser, host.email, process.env.TENANT_PW || 'DemoPass123!');
    const res = await ctx0.request.post(`${BASE}/api/portal/${host.slug}/documents`, {
      data: { preset: 'letter', title: 'ZZ page-scale probe (scratch)' },
    });
    const body = await res.json().catch(() => ({}));
    await ctx0.close();
    const id = body?.data?.documentId;
    if (!res.ok() || !id) {
      console.log(`· NOT MEASURED — could not author a scratch document (HTTP ${res.status()}). Uncovered, not a finding.`);
      process.exit(0);
    }
    scratchId = id;
    target = { id, slug: host.slug, title: 'ZZ page-scale probe (scratch)', email: host.email };
    console.log(`  · authored a scratch document (this probe's own, removed at the end)`);
  }

  const ctx = await signIn(browser, target.email, process.env.TENANT_PW || 'DemoPass123!');
  const page = ctx.pages()[0];
  console.log(`  · "${target.title}" @ ${target.slug}\n`);
  const doc2 = target;

  for (const width of [1600, 1100, 800, 600]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${BASE}/portal/${doc2.slug}/documents/${doc2.id}`, { waitUntil: 'domcontentloaded' });
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
  // Take away exactly what this probe built, and nothing else — the row is keyed by the id the
  // POST returned, so a pre-existing document is never touched.
  if (scratchId) {
    await sql`DELETE FROM tenant_documents WHERE id = ${scratchId}::uuid`.catch(() => {});
    console.log('  · scratch document removed');
  }
  await browser.close();
  await sql.end({ timeout: 5 });
  process.exit(ok ? 0 : 1);
}
