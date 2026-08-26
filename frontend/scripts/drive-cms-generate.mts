/**
 * CLOSE-CMS, THE GENERATE HALF — an rfp_admin fills the Generate Content form and a draft appears.
 *
 * `close-e2e-cms.mjs` proves the second half: a queued draft is reviewed, published, goes `active`,
 * and renders on the public site. It STARTS from a draft that already exists. Nothing proved the
 * half before it, and the database said so plainly: `content_generator` had 2 invocations but there
 * were **0 `content.requested` events and 0 `OnCmsContentRequested` instances** — the agent had run,
 * but never once through its own documented vertical.
 *
 * SO THIS DRIVES THE FORM, not the API. The launcher is the product's front door for this flow by
 * design ("Admin-launched via LaunchContentClient; no automatic emitter — that stays post-V1"), so
 * filling it as a real signed-in admin IS the faithful path.
 *
 * ONE THING THIS IS NOT. It is NOT evidence for the AI_INVOKE contract lens, and must never be
 * cited as such. That launcher emits the operator's overlay AS the payload, so the observed keys
 * would be the ones this script typed; checking those against the input_map is a tautology. The
 * lens keeps `OnCmsContentRequested` listed as UNCOVERED on purpose, with that reason printed
 * beside it. Two different questions: "does the flow work for a person?" (this) and "does the
 * emitter write what the workflow reads?" (the lens, which cannot be answered here).
 *
 *   cd frontend && DATABASE_URL=<owner> node --import tsx scripts/drive-cms-generate.mts
 */
import { randomUUID } from 'crypto';
import { sqlBypass as sql } from '@/lib/db';
import { BASE, launch, signIn } from './lib/cross-company.mts';

const TAG = randomUUID().slice(0, 8);
const TITLE = `What a Phase I Cost Volume Must Show (${TAG})`;
const SLUG = `phase-i-cost-volume-${TAG}`;
let ok = true;
const A = (l: string, c: boolean, x = '') => { console.log(`${c ? '✓' : '✗'} ${l}${x ? ` — ${x}` : ''}`); ok = ok && c; };
const note = (s: string) => console.log(`  · ${s}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const t0 = new Date();
const browser = await launch();
try {
  const [admin] = await sql<Array<{ email: string }>>`
    SELECT email FROM users WHERE role IN ('rfp_admin','master_admin') AND is_active
    ORDER BY created_at LIMIT 1`;
  if (!admin) throw new Error('no active platform admin');
  const bc = await signIn(browser, admin.email, process.env.SANDBOX_PASSWORD || 'SandboxDrive2026!');
  const page = bc.pages()[0];

  // ── fill the REAL form ────────────────────────────────────────────────────────────────────────
  await page.goto(`${BASE}/admin/workflows`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  const form = page.locator('form').filter({ hasText: /Generate Content/i }).first();
  const hasForm = await form.count() > 0;
  A('the Generate Content form is on /admin/workflows for an admin', hasForm,
    hasForm ? '' : 'form not found — the launcher may have moved');

  if (hasForm) {
    await form.locator('input').first().fill(TITLE);
    await form.locator('textarea').first().fill(
      'Explain, for a first-time SBIR applicant, what a Phase I cost volume has to show: '
      + 'direct labour with hours and rates, the burden build-up, materials, travel, subcontracts, '
      + 'and why the total must reconcile to the solicitation ceiling.');
    const slugInput = form.locator('input').nth(1);
    if (await slugInput.count() > 0) await slugInput.fill(SLUG).catch(() => {});
    const sel = form.locator('select').first();
    if (await sel.count() > 0) await sel.selectOption('guide').catch(() => {});
    await form.locator('button[type="submit"]').first().click();
    await page.waitForTimeout(3000);
    const launched = await page.locator('text=/OnCmsContentRequested|launched|eventId/i').count() > 0;
    A('the form reported a launch', launched);
  }
  await bc.close();

  // ── the vertical actually ran ─────────────────────────────────────────────────────────────────
  note('waiting for the worker to pick up the trigger…');
  let ev = 0, inst = 0, gen = 0;
  for (let i = 0; i < 24; i++) {
    await sleep(5000);
    [{ n: ev }] = await sql<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM system_events WHERE type='content.requested' AND created_at > ${t0}`;
    [{ n: inst }] = await sql<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM process_instances
      WHERE workflow_name='OnCmsContentRequested' AND created_at > ${t0}`;
    [{ n: gen }] = await sql<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM system_events
      WHERE type='agent.invoked' AND payload::text LIKE '%content_generator%' AND created_at > ${t0}`;
    if (ev > 0 && inst > 0 && gen > 0) break;
    if (i % 3 === 2) note(`  poll ${i + 1}: content.requested=${ev} instance=${inst} generator=${gen}`);
  }
  A('library:content.requested was emitted', ev > 0, `${ev}`);
  A('OnCmsContentRequested instantiated', inst > 0, `${inst}`);
  A('content_generator ran on the emulator', gen > 0, `${gen}`);

  // ── and it produced a reviewable draft, not just an event ─────────────────────────────────────
  const [draft] = await sql<Array<{ pageKey: string; status: string; title: string | null }>>`
    SELECT page_key AS "pageKey", status, title FROM content_pages
    WHERE created_at > ${t0} ORDER BY created_at DESC LIMIT 1`;
  A('a DRAFT content page exists for review', !!draft && draft.status === 'draft',
    draft ? `${draft.pageKey} [${draft.status}]` : 'no page created');
  const [todo] = await sql<Array<{ id: string; title: string; status: string }>>`
    SELECT id, title, status FROM tasks
    WHERE task_type='content_publish' AND created_at > ${t0} ORDER BY created_at DESC LIMIT 1`;
  A('a content_publish ToDo was parked for a human', !!todo && todo.status === 'open',
    todo ? `"${todo.title.slice(0, 54)}"` : 'no ToDo raised');

  // ── clean the BUSINESS rows, keep the AUDIT rows ──────────────────────────────────────────────
  //
  // The draft page and its review ToDo are real work items: left behind, every suite run would add
  // another piece of junk to a human's content-review queue, and a queue full of test artifacts is
  // a queue people stop reading. The events stay — same rule as drive-uncovered-triggers: audit is
  // what audit is for.
  if (todo) await sql`DELETE FROM tasks WHERE id = ${todo.id}::uuid`;
  if (draft) await sql`DELETE FROM content_pages WHERE page_key = ${draft.pageKey}`;
  await sql`DELETE FROM process_instances
            WHERE workflow_name = 'OnCmsContentRequested' AND created_at > ${t0}`;
  note('probe draft, its review ToDo and the instance removed — the audit events are left');

  console.log(`\n${ok ? '✓ generate half: form → trigger → vertical → draft + review ToDo'
    : '✗ see failures above'}\n`);
  console.log('  (the review→publish→live half is close-e2e-cms.mjs; the final hop to the public'
    + ' marketing site is served by Railway and is a deployment concern, not this drive\'s)');
} catch (e) {
  console.error('DRIVE ERROR', e);
  ok = false;
} finally {
  await browser.close();
  await sql.end({ timeout: 5 });
  process.exit(ok ? 0 : 1);
}
