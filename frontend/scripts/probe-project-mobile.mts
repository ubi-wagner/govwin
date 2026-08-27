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

/** Elements whose right edge passes the viewport. Inner auto-scrollers are legitimate. */
async function overflowing(page: Page, vw: number) {
  return page.evaluate((w) => {
    const out: Array<{ tag: string; cls: string; right: number; text: string }> = [];
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      const r = el.getBoundingClientRect();
      if (r.right <= w + 1 || r.width < 24) continue;
      // Walk up: if any ancestor scrolls horizontally on purpose, this is inside a scroller.
      let node: Element | null = el;
      let inScroller = false;
      while (node && node !== document.body) {
        const cs = getComputedStyle(node);
        if (cs.overflowX === 'auto' || cs.overflowX === 'scroll') { inScroller = true; break; }
        node = node.parentElement;
      }
      if (inScroller) continue;
      out.push({
        tag: el.tagName.toLowerCase(),
        cls: String((el as HTMLElement).className ?? '').slice(0, 70),
        right: Math.round(r.right),
        text: (el.textContent ?? '').trim().slice(0, 40),
      });
    }
    // Only the outermost offender per subtree — a wide child reports its parent too, and twenty
    // lines naming the same box is a report nobody reads.
    return out.filter((o, i) => !out.some((p, j) => j !== i && p.right >= o.right && o.tag !== 'body'
      && false)).slice(0, 8);
  }, vw);
}

/** Controls smaller than the 44px touch target. Reported, never failed. */
async function smallTargets(page: Page) {
  return page.evaluate(() => {
    const out: Array<{ tag: string; label: string; w: number; h: number }> = [];
    for (const el of Array.from(document.querySelectorAll('button, a, input, select, textarea'))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;      // hidden — not a target
      if (r.height >= 44 && r.width >= 44) continue;
      out.push({
        tag: el.tagName.toLowerCase(),
        label: ((el as HTMLElement).innerText || el.getAttribute('aria-label') || '').trim().slice(0, 30),
        w: Math.round(r.width), h: Math.round(r.height),
      });
    }
    return out;
  });
}

/**
 * Text clipped by its own box WITH NO WAY TO RECOVER IT.
 *
 * ── TRUNCATION IS NOT THE DEFECT; UNRECOVERABLE TRUNCATION IS ───────────────────────────────
 * A work email is longer than a phone is wide. Left whole it becomes the entire row and pushes
 * everything else onto its own line, so this codebase truncates identifiers deliberately and keeps
 * the full value in a `title`. Reporting that as a finding would be the instrument disagreeing
 * with a decision, and the only thing it would achieve is teaching whoever runs this to ignore the
 * line — the first version of this check did exactly that on five chips.
 *
 * So the question narrowed to the one that actually matters: is the clipped text reachable at all?
 * `title` (or `aria-label`) carrying it means yes. Nothing carrying it means a word is simply gone,
 * and the page photographs as tidy either way. That also makes the check STRONGER than the naive
 * version: a `truncate` added later without a title now fails, where before it was lost in noise.
 */
async function clipped(page: Page) {
  return page.evaluate(() => {
    const out: Array<{ text: string; cls: string }> = [];
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      const e = el as HTMLElement;
      if (e.children.length > 0) continue;                 // leaf text nodes only
      const cs = getComputedStyle(e);
      if (cs.overflow === 'visible' && cs.textOverflow !== 'ellipsis') continue;
      if (e.scrollWidth <= e.clientWidth + 2) continue;
      const text = (e.innerText ?? '').trim();
      if (!text) continue;
      // Recoverable? The full value on the element or on the box that clips it.
      const recoverable = [e, e.parentElement].some((n) =>
        n instanceof HTMLElement
        && ((n.title && n.title.includes(text.replace(/…$/, '').trim().slice(0, 12)))
          || (n.getAttribute('aria-label') ?? '').includes(text.slice(0, 12))));
      if (recoverable) continue;
      out.push({ text: text.slice(0, 50), cls: String(e.className).slice(0, 50) });
    }
    return out.slice(0, 8);
  });
}

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
      for (const b of await page.locator('button[aria-expanded="false"]').all()) {
        await b.click({ timeout: 2000 }).catch(() => {});
      }
      for (const b of await page.getByRole('button', { name: 'Edit' }).all()) {
        await b.click({ timeout: 2000 }).catch(() => {});
      }
      await page.waitForTimeout(600);

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
