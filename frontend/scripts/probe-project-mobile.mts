/**
 * The project workspace on a phone — with its dense states OPEN.
 *
 * ── WHY THE RESPONSIVE PASS IS NOT ENOUGH ────────────────────────────────────────────────────
 * `drive-ui-responsive.mjs` photographs each route AT REST and asserts the body never scrolls
 * sideways. Both matter, and neither reaches what this page actually is: a task edit row with four
 * date/select controls, a comment composer, a file input, and a deliverable row carrying a select
 * and three buttons. All of them are behind a click, so at rest they do not exist — and a layout
 * that is fine while collapsed can be unusable the moment somebody opens it.
 *
 * That is the same gap `drive-ui-states.mjs` exists for at desktop width. This is its phone half,
 * narrowed to one page because that page is the densest thing a tenant has.
 *
 * ── WHAT IT MEASURES ─────────────────────────────────────────────────────────────────────────
 *   overflow    any element whose right edge passes the viewport, EXCLUDING legitimate inner
 *               `overflow-x: auto` scrollers — the same rule the responsive pass uses, so the two
 *               cannot disagree about what counts.
 *   tap size    every button, link and input against 44×44 CSS px (the WCAG 2.5.5 / iOS HIG
 *               target). Reported, not failed: a dense table of inline verbs legitimately runs
 *               smaller, and failing it would only teach someone to silence the check.
 *   truncation  text nodes clipped by their box — the phone-only failure that photographs as a
 *               tidy page and reads as a missing word.
 *
 * ⚠️ READ-ONLY. It opens things and photographs them; it posts nothing.
 *
 *   cd frontend && npx tsx scripts/probe-project-mobile.mts [outDir]
 * Exit 0 if nothing overflows; 1 if something does; 2 if it could not earn a verdict.
 */
import { chromium, type Page } from 'playwright';
import postgres from 'postgres';
import { mkdirSync, writeFileSync } from 'node:fs';
// ONE definition of overflow / touch target / unrecoverable clipping, shared with
// `probe-interaction-mobile.mts`. Two probes with two definitions produce two numbers nobody can
// reconcile — the exact defect docs/PIPELINE_COHERENCE_REVIEW.md was written to find.
import { overflowing, smallTargets, clipped, openEverything } from './lib/mobile-measure.mts';

const BASE = process.env.GUIDE_BASE || 'http://localhost:3000';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const TENANT_PW = process.env.TENANT_PW || 'DemoPass123!';
const DB = process.env.DATABASE_URL_OWNER;
const OUT = process.argv[2] || '/home/user/govwin/docs/ui-states';

const WIDTHS = [
  { w: 390, h: 844, name: 'phone' },
  { w: 820, h: 1100, name: 'tablet' },
];

let failed = 0;
const A = (ok: boolean, label: string, extra = '') => {
  if (!ok) failed += 1;
  console.log(`  ${ok ? '✓' : '✗'} ${label}${extra ? ` — ${extra}` : ''}`);
};

async function login(page: Page, email: string) {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#email', { timeout: 20_000 });
  await page.fill('#email', email);
  await page.fill('#password', TENANT_PW);
  await page.click('button[type="submit"]');
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(1800);
  if (page.url().includes('/login')) throw new Error('login failed');
}

async function main() {
  if (!DB) { console.error('HARNESS DEFECT: DATABASE_URL_OWNER required'); process.exit(2); }
  mkdirSync(OUT, { recursive: true });

  const sql = postgres(DB, { max: 2, onnotice: () => {} });
  const [proj] = await sql<{ id: string; slug: string }[]>`
    SELECT p.id, t.slug FROM projects p JOIN tenants t ON t.id = p.tenant_id
     WHERE t.slug = 'foundation' ORDER BY p.created_at LIMIT 1`;
  await sql.end();
  if (!proj) {
    console.error('HARNESS DEFECT: no project to open. Reporting a clean phone layout for a page');
    console.error('that never rendered is exactly how a viewport pass lies.');
    process.exit(2);
  }

  // Its OWN index, not appended to `responsive.json`: that file is rewritten whole by
  // `drive-ui-responsive.mjs`, so anything merged into it disappears on the next run and the images
  // become orphans that write-ui-docs offers to prune.
  const shots: Array<Record<string, unknown>> = [];

  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    for (const vp of WIDTHS) {
      const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h } });
      const page = await ctx.newPage();
      await login(page, 'kate.ulepic@foundation3dp.com');
      await page.setViewportSize({ width: vp.w, height: vp.h });
      await page.goto(`${BASE}/portal/${proj.slug}/projects/${proj.id}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1500);

      console.log(`\n── ${vp.name} · ${vp.w}px ─────────────────────────────────────────────`);

      // OPEN EVERYTHING. The collapsed page is what the responsive pass already covers; what has
      // never been seen at this width is a comment composer and an inline task edit row.
      const { opened, candidates } = await openEverything(page);
      A(opened > 0, 'the probe actually opened something', `${opened} of ${candidates} candidate control(s)`);

      const over = await overflowing(page, vp.w);
      A(over.length === 0, `nothing runs past the ${vp.w}px viewport with every panel open`,
        over.map((o) => `<${o.tag} class="${o.cls}"> ends ${o.right}`).join(' · ').slice(0, 200));

      const small = await smallTargets(page);
      // REPORTED, not failed — a dense row of inline verbs legitimately runs under 44px, and
      // failing it would only teach whoever runs this to stop reading the output.
      console.log(`  · ${small.length} control(s) under the 44px touch target${small.length
        ? `: ${small.slice(0, 6).map((s) => `${s.tag}"${s.label}" ${s.w}×${s.h}`).join(', ')}` : ''}`);

      const cut = await clipped(page);
      A(cut.length === 0, 'no text is clipped with no way to recover it',
        cut.map((c) => `"${c.text}"`).join(' · ').slice(0, 160));

      const name = `probe__project-workspace__vp-${vp.name}-open.jpg`;
      await page.screenshot({ path: `${OUT}/${name}`, type: 'jpeg', quality: 80, fullPage: true });
      shots.push({ lane: 'tenant', route: `/portal/${proj.slug}/projects/[projectId]`, viewport: vp.name, width: vp.w, file: name });
      console.log(`  · ${name}`);
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
  writeFileSync(`${OUT}/project-mobile.json`, JSON.stringify({ shots }, null, 1));
  console.log(failed ? `\n✗ ${failed} finding(s)` : '\n✓ the workspace holds together at phone and tablet width, panels open');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error('probe failed:', e); process.exit(1); });
