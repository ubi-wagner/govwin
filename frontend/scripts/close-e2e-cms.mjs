/** CLOSE-CMS — real-actor E2E: admin reviews a queued guide draft in Content Studio and PUBLISHES
 *  it; verify it goes live (active) and renders on the public marketing site.
 *  cd frontend && DATABASE_URL=… node scripts/close-e2e-cms.mjs */
import { chromium } from 'playwright';
import postgres from 'postgres';
import fs from 'fs';
import path from 'path';

const BASE = 'http://localhost:3000';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const OUT = '/home/user/govwin/docs/assets/close-e2e';
fs.mkdirSync(OUT, { recursive: true });
const sql = postgres(process.env.DATABASE_URL || 'postgresql://govtech:changeme@localhost:5432/govtech_intel', { max: 3 });
const ADMIN = { email: 'eric@rfppipeline.com', pw: (process.env.RFP_ADMIN_PW || 'RFPAdmin2026!') };
const SLUG = 'what-is-a-baa';
const shot = async (p, n) => { await p.screenshot({ path: path.join(OUT, n + '.png'), fullPage: true }); console.log('  ✓ shot', n); };
const settle = async (p, ms = 2000) => { await p.waitForLoadState('networkidle').catch(() => {}); await p.waitForTimeout(ms); };
let ok = true; const A = (l, c, x = '') => { console.log(`${c ? '✓' : '✗'} ${l}${x ? ` — ${x}` : ''}`); ok = ok && c; };

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
const p = await (await browser.newContext({ viewport: { width: 1440, height: 2000 } })).newPage();
try {
  // Reset the guide to a clean draft — and MAKE the draft if there is not one.
  //
  // The first version of this setup only archived the active row and assumed a draft was sitting
  // there. It was not idempotent: the first run consumed the draft by publishing it, so the second
  // run archived the (newly) active version, found nothing to publish, and reported the product
  // broken — while actually taking a live guide off the public marketing site. A test that
  // destroys its own precondition and then blames the code is worse than no test.
  //
  // So: promote the newest version back to a draft first, THEN archive whatever is live.
  const [newest] = await sql`
    SELECT id, status FROM content_pages
    WHERE page_key=${SLUG} AND content_type='guide'
    ORDER BY version_no DESC LIMIT 1`;
  if (!newest) { A('a BAA guide version exists to publish', false, 'none in content_pages'); throw new Error('no seed content'); }
  await sql`UPDATE content_pages SET status='draft', archived_at=NULL WHERE id=${newest.id}::uuid`;
  await sql`UPDATE content_pages SET status='archived', archived_at=now()
            WHERE page_key=${SLUG} AND content_type='guide' AND status='active'`;
  const before = await sql`SELECT count(*)::int AS n FROM content_pages WHERE page_key=${SLUG} AND content_type='guide' AND status='active'`;
  const draftN = await sql`SELECT count(*)::int AS n FROM content_pages WHERE page_key=${SLUG} AND content_type='guide' AND status='draft'`;
  A('precondition: BAA guide is NOT live (0 active)', before[0].n === 0);
  A('precondition: there IS a draft to publish', draftN[0].n > 0, `drafts=${draftN[0].n}`);

  // Reopen the review ToDo, because that is what the precondition MEANS. Un-publishing the guide
  // puts the review back in front of a human; leaving its ToDo completed would model a state the
  // product never produces, and the assertion at the end would then be checking a row this script
  // had already set. Matched by page_key — a publish rewrites rows, so the id the ToDo holds is
  // routinely stale (the same reason publishDocument matches that way).
  await sql`UPDATE tasks SET status='open', completed_at=NULL
            WHERE task_type='content_publish'
              AND entity_id IN (SELECT id FROM content_pages WHERE page_key=${SLUG} AND content_type='guide')`;
  const todoBefore = await sql`
    SELECT count(*)::int AS n FROM tasks
    WHERE task_type='content_publish' AND status='open'
      AND entity_id IN (SELECT id FROM content_pages WHERE page_key=${SLUG} AND content_type='guide')`;
  A('precondition: the review ToDo is OPEN', todoBefore[0].n > 0, `open=${todoBefore[0].n}`);

  await p.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('#email', { timeout: 20000 });
  await p.fill('#email', ADMIN.email); await p.fill('#password', ADMIN.pw);
  await p.click('button[type="submit"]'); await settle(p, 2800);
  console.log('  logged in →', p.url());

  // Content Studio: the guide draft.
  await p.goto(`${BASE}/admin/site/docs/guide/${SLUG}`); await settle(p, 2500);
  await shot(p, 'cms-01-guide-draft');

  // Real actor PUBLISHES.
  const pubBtn = p.getByRole('button', { name: /^Publish$/ }).first();
  A('Publish control present for the reviewer', await pubBtn.count() > 0);
  if (await pubBtn.count() > 0) {
    await pubBtn.click();
    await settle(p, 2600);
    await shot(p, 'cms-02-after-publish');
  }

  // Verify it went live in the DB.
  const after = await sql`SELECT status, version_no FROM content_pages WHERE page_key=${SLUG} AND content_type='guide' AND status='active'`;
  // snake_case on purpose: this script's postgres() has no toCamel transform, unlike lib/db.
  // Reading `versionNo` here printed "vundefined" — the same class of silent miss the SOP warns
  // about, harmless in a label and not harmless anywhere that branches on the value.
  A('the guide is now LIVE (active version exists)', after.length > 0, after[0] ? `v${after[0].version_no}` : 'none');

  // …and the publish DRAINED the review queue. Publishing IS the work the ToDo asked for, so an
  // item left open is a queue that can only grow, and a review list that only grows is one people
  // stop reading. Nothing closed these until 2026-08: the BAA guide was live on the marketing site
  // with its "Review & publish" ToDo still open, pointing at a version the publish had archived.
  const todoAfter = await sql`
    SELECT status, count(*)::int AS n FROM tasks
    WHERE task_type='content_publish'
      AND entity_id IN (SELECT id FROM content_pages WHERE page_key=${SLUG} AND content_type='guide')
    GROUP BY status`;
  const stillOpen = todoAfter.find((r) => r.status === 'open')?.n ?? 0;
  const closed = todoAfter.find((r) => r.status === 'completed')?.n ?? 0;
  A('publishing CLOSED the review ToDo that asked for it', stillOpen === 0 && closed > 0,
    `open=${stillOpen} completed=${closed}`);

  // Verify it renders on the PUBLIC marketing site (the resources/guides surface projects HTML).
  const pubUrl = `${BASE}/resources/${SLUG}`;
  const res = await p.goto(pubUrl, { waitUntil: 'domcontentloaded' }).catch(() => null);
  await settle(p, 1500);
  const bodyText = await p.textContent('body').catch(() => '');
  const live = (res && res.status() === 200 && /Broad Agency Announcement/i.test(bodyText || ''));
  A('the published guide renders on the public site', !!live, `${pubUrl} → ${res?.status()}`);
  if (live) await shot(p, 'cms-03-public-live');

  console.log(`\n${ok ? '✅ CMS E2E PASS — draft reviewed → published → live on the public site' : '❌ see failures'}\n`);
} catch (e) {
  console.error('CMS E2E ERROR', e.message);
  await p.screenshot({ path: path.join(OUT, 'cms-error.png') }).catch(() => {});
  ok = false;
} finally {
  await browser.close(); await sql.end();
  process.exit(ok ? 0 : 1);
}
