#!/usr/bin/env npx tsx
/**
 * drive-guide-note.mts — press the button in the guide, and prove a row lands on the board.
 *
 * ── WHY THIS EXISTS SEPARATELY FROM THE INVARIANTS TEST ──────────────────────────────────────
 * `__tests__/admin-guides-invariants.test.ts` reads the SOURCE: that every guide is mounted, points
 * at its canonical doc, and does not send a client-supplied author. All of that can be true while
 * the note goes nowhere — the route could reject the body, the disposition could be dropped, the
 * anchor could arrive as `general`, the board could not render it. None of those is visible from
 * the source, and every one of them makes the affordance useless in exactly the week it matters.
 *
 * So this drives it as a person: sign in, open the guide, pick a disposition, type, save — then
 * read the row back out of `working_notes` and check the six properties that make a note worth
 * having a week later.
 *
 * ── THE PROPERTY THAT MATTERS MOST ───────────────────────────────────────────────────────────
 * Attribution is asserted to be the SIGNED-IN user, not anything the client sent. A shared board is
 * only worth reading if you can trust who said what, and the note box deliberately sends no author
 * for that reason — this is the check that the route keeps honouring it.
 *
 * ⚠️ NOT read-only: it writes one note and removes it. Sandbox only.
 *
 *   source scripts/sandbox-env.sh
 *   cd frontend && npx tsx scripts/drive-guide-note.mts
 *
 * Exit 0 the note lands and reads back correctly · 1 it does not · 2 could not run.
 */
import { chromium } from 'playwright';
import postgres from 'postgres';

const BASE = process.env.GUIDE_BASE || process.env.BASE_URL || 'http://localhost:3000';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const DB = process.env.DATABASE_URL_OWNER;
const ADMIN = 'eric@rfppipeline.com';
const ADMIN_PW = process.env.SANDBOX_PASSWORD || 'SandboxDrive2026!';
const ROUTE = '/admin/scouts';
const STEP_ANCHOR = `${ROUTE}#read`;

if (!DB) { console.error('DATABASE_URL_OWNER required — source scripts/sandbox-env.sh'); process.exit(2); }
// Quoted camelCase aliases: a bare postgres() client has no `toCamel`, and a snake_case read off a
// camelCase-typed row is silently `undefined`.
const sql = postgres(DB, { max: 2, onnotice: () => {} });

let bad = 0;
const A = (cond: unknown, m: string) => {
  console.log(`  ${cond ? '✓' : '✗'} ${m}`);
  if (!cond) bad += 1;
};

const MARK = `guide-note-drive-${process.pid}`;
const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-setuid-sandbox'] });

try {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#email', { timeout: 20_000 });
  await page.fill('#email', ADMIN);
  await page.fill('#password', ADMIN_PW);
  await page.click('button[type="submit"]');
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(1800);
  if (page.url().includes('/login')) { console.error(`could not sign in as ${ADMIN}`); process.exit(2); }

  await page.goto(BASE + ROUTE, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(700);

  const guide = page.locator('details[data-guide] summary').first();
  if (!(await guide.count())) { console.error(`no guide mounted on ${ROUTE}`); process.exit(2); }
  await guide.click();
  await page.waitForTimeout(300);

  await page.locator('button:has-text("Something wrong here? Note it")').first().click();
  await page.waitForTimeout(300);
  await page.locator('button:has-text("Product is wrong")').first().click();
  await page.locator('textarea').first().fill(`${MARK} the unknown band needs a worked example`);
  await page.locator('button:has-text("Save note")').first().click();
  await page.waitForTimeout(2500);

  A(await page.locator('text=Saved to the board.').count(), 'the box says it saved');

  const [row] = await sql<Array<{
    note: string; anchor: string | null; anchorKind: string; author: string;
    authorEmail: string | null; state: string; metadata: { disposition?: string } | null;
  }>>`
    SELECT note, anchor, anchor_kind AS "anchorKind", author, author_email AS "authorEmail",
           state, metadata
      FROM working_notes WHERE note LIKE ${`%${MARK}%`} ORDER BY created_at DESC LIMIT 1`;

  if (!row) {
    A(false, 'a row landed on the board');
  } else {
    A(row.anchor === STEP_ANCHOR, `anchored to the route AND the step — ${row.anchor}`);
    A(row.anchorKind === 'route', `anchor_kind is route — ${row.anchorKind}`);
    // The one that makes the board trustworthy: the server decided who this is.
    A(row.author === 'human' && row.authorEmail === ADMIN, `attributed server-side — ${row.authorEmail}`);
    A(row.metadata?.disposition === 'defect', `the disposition survived — ${JSON.stringify(row.metadata)}`);
    A(row.state === 'watching', `starts at the first state — ${row.state}`);
    // Context the person did not type. Without it a note is a diary entry a week later.
    A(/seen at:.*admin\/scouts/s.test(row.note), 'carries the page context nobody typed');
  }

  await page.goto(`${BASE}/admin/notes`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(800);
  A((await page.locator('body').innerText()).includes(MARK), 'the board renders it');
} finally {
  const gone = await sql`DELETE FROM working_notes WHERE note LIKE ${`%${MARK}%`} RETURNING id`;
  console.log(`\n  MUTATED ${gone.length} working_notes row — fixture-only, now removed.`);
  await sql.end();
  await browser.close();
}

console.log();
if (bad === 0) console.log('✓ A note written from a guide step lands on the board, attributed and anchored.');
else console.error(`✗ ${bad} property/properties of the note are wrong.`);
process.exit(bad === 0 ? 0 : 1);
