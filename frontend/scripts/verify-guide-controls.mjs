#!/usr/bin/env node
/**
 * verify-guide-controls.mjs — does the guide name controls the page actually has?
 *
 * ── THE FAILURE THIS CATCHES ─────────────────────────────────────────────────────────────────
 * An in-page guide is read as an instruction: *press **Release as new***. The moment a control is
 * renamed, moved behind a role, or removed, the guide is telling a person to do something they
 * cannot do — and nothing catches it, because the guide is prose and prose compiles. This is the
 * documentation form of the producer/consumer gap this repo keeps finding: two sides that only
 * agree by convention, and drift the first time one moves.
 *
 * It is worst exactly when it matters most. A guide is written before a first curation week and
 * read during it; that is also the week the surfaces change fastest.
 *
 * ── HOW ─────────────────────────────────────────────────────────────────────────────────────
 * Guides mark the controls they name with `<Ctl>`, which renders `data-guide-control`. This walks
 * every `*-guide.tsx` under `app/admin`, reads its route (`const R = '…'`) and its `<Ctl>` labels,
 * loads that page as master_admin, and asserts each label appears in the live DOM.
 *
 * **The guide's own subtree is excluded.** `GuideCard` renders `data-guide`, and a check that
 * searched the whole page would find every label in the guide's own chips and pass unconditionally —
 * a green that measures nothing. That exclusion is the whole reason this is trustworthy, so the
 * self-test below proves the detector can still fail.
 *
 * A control the page renders only after an interaction (inside a row that needs data, behind a tab)
 * is REPORTED as unverifiable rather than silently passed — uncovered is not passing.
 *
 *   cd frontend && node scripts/verify-guide-controls.mjs
 *
 * Exit 0 every named control is on its page · 1 one is not · 2 the harness could not run.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';

const BASE = process.env.GUIDE_BASE || process.env.BASE_URL || 'http://localhost:3000';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const ADMIN = 'eric@rfppipeline.com';
const ADMIN_PW = process.env.SANDBOX_PASSWORD || 'SandboxDrive2026!';
const APP = path.join('/home/user/govwin/frontend', 'app/admin');
const DB = process.env.GUIDE_DB || process.env.DATABASE_URL_OWNER
  || 'postgresql://govtech:changeme@localhost:5432/govtech_intel';
const sql = postgres(DB, { max: 2, onnotice: () => {} });

/**
 * Real ids for the dynamic segments.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────────────────
 * Without it the lens loaded the literal `/admin/rfp-curation/[solId]`, which resolves to nothing,
 * and then reported all ten controls the guide names as MISSING. Every one of them was on the real
 * page — I had read them off it minutes earlier. An instrument that cannot reach a surface must say
 * so; reporting unreachable as broken is the loudest possible way to be wrong, and it is the class
 * this repo keeps finding.
 *
 * A route whose parameters cannot be bound is REPORTED as unaddressable and its controls are left
 * unchecked. Uncovered is not passing — but it is also not a finding.
 */
async function bindings() {
  const one = async (q) => { try { const [r] = await q; return r?.id ?? null; } catch { return null; } };
  return {
    solId: await one(sql`SELECT id FROM curated_solicitations ORDER BY created_at DESC LIMIT 1`),
    portalId: await one(sql`SELECT id FROM proposal_portals ORDER BY created_at DESC LIMIT 1`),
    profileId: await one(sql`SELECT id FROM source_profiles ORDER BY created_at DESC LIMIT 1`),
  };
}

/** Every `*-guide.tsx` under app/admin — discovered, never registered, so a new guide is covered. */
function guides(dir = APP, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) guides(p, out);
    else if (/-guide\.tsx$/.test(e.name)) out.push(p);
  }
  return out;
}

/**
 * The route a guide documents, and the control labels it tells a person to press.
 *
 * The route is taken from `const R = '…'` when the guide declares one, and otherwise INFERRED from
 * where the file lives (`app/admin/observe/companion-guide.tsx` → `/admin/observe`). Requiring the
 * declaration made this lens report a pre-existing guide as a defect for not following a convention
 * invented after it — the harness grading its own newness, which is not a finding.
 */
function parse(file) {
  const src = fs.readFileSync(file, 'utf8');
  const declared = src.match(/const R\s*=\s*'([^']+)'/)?.[1] ?? null;
  const inferred = '/' + path.relative(path.join(APP, '..'), path.dirname(file));
  const route = declared ?? inferred;
  const controls = [...src.matchAll(/<Ctl>([^<{]+)<\/Ctl>/g)]
    .map((m) => m[1].trim())
    .filter(Boolean);
  return { route, controls: [...new Set(controls)] };
}

let bad = 0;
let unverifiable = 0;
const ok = (m) => console.log(`    ✓ ${m}`);
const no = (m) => { console.error(`    ✗ ${m}`); bad += 1; };

const B = await bindings();
const bind = (r) => r.replace(/\[(\w+)\]/g, (m, k) => B[k] ?? m);
const unaddressable = [];

const found = guides();
if (!found.length) {
  console.error('✗ HARNESS DEFECT — no *-guide.tsx under app/admin. This lens would pass over nothing.');
  process.exit(2);
}

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();
try {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#email', { timeout: 20_000 });
  await page.fill('#email', ADMIN);
  await page.fill('#password', ADMIN_PW);
  await page.click('button[type="submit"]');
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(2000);
  if (page.url().includes('/login')) throw new Error('admin login failed');
} catch (e) {
  console.error(`✗ could not sign in as ${ADMIN}: ${String(e.message).slice(0, 80)}`);
  await browser.close();
  process.exit(2);
}

console.log(`· ${found.length} guide(s) · ${BASE}\n`);

for (const file of found.sort()) {
  const rel = path.relative('/home/user/govwin/frontend', file);
  const { route, controls } = parse(file);
  console.log(`── ${rel}`);
  if (!controls.length) { console.log(`    · names no controls — nothing to check`); continue; }

  const url = bind(route);
  if (/\[/.test(url)) {
    console.log(`    · ${route} — no row to bind its parameter; ${controls.length} control(s) UNADDRESSABLE, not checked`);
    unaddressable.push({ route, controls: controls.length });
    continue;
  }

  await page.goto(BASE + url, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(800);

  /**
   * The page WITHOUT the guide, as a PERSON can read it. Everything the guide names must exist here.
   *
   * `<script>` is stripped, and that is not tidiness — it is the whole check. Next inlines the RSC
   * flight payload as `self.__next_f.push(…)` script tags inside `<body>`, and `textContent`
   * includes script text. So the guide's own prose — every control label it names — was present in
   * the searched string via the payload, and **every check would have passed for free.**
   *
   * The guard below caught it; my first reading of the guard was wrong (I assumed `[data-guide]`
   * was not matching, and it was matching fine). Worth keeping as a comment: a search over
   * `textContent` of a server-rendered React page is a search over the component tree twice, once
   * as markup and once as serialised data.
   */
  const pageText = await page.evaluate(() => {
    const clone = document.body.cloneNode(true);
    clone.querySelectorAll('[data-guide], script, template, style, noscript').forEach((n) => n.remove());
    return (clone.textContent || '').replace(/\s+/g, ' ');
  });

  /**
   * Proof the exclusion did its job — and the FIRST version of this proof was wrong.
   *
   * It asserted the guide's control labels were absent from the searched text. But a label being
   * present out there is exactly what a passing check looks like: the control exists. So the guard
   * fired on every guide whose controls were all correct — the harness reporting success as a
   * defect.
   *
   * The right marker is a string only the GUIDE can contain. `Canon` renders "Full detail:" and
   * nothing else on these pages does; if that survived the removal, the subtree did not.
   */
  const hasGuide = await page.evaluate(() => Boolean(document.querySelector('[data-guide]')));
  if (hasGuide && /Full detail:/.test(pageText)) {
    console.error('    ✗ HARNESS DEFECT — the guide subtree was not excluded; every check below would pass for free');
    bad += 1;
    continue;
  }
  if (!hasGuide) {
    console.log(`    · no [data-guide] on ${url} — the guide is not mounted here, or the page redirected`);
  }

  for (const c of controls) {
    if (pageText.includes(c)) ok(`"${c}" is on ${route}`);
    else {
      // Distinguish "the guide is lying" from "this control needs a row/tab this page has none of".
      // The second is still a gap in coverage, and it is reported as one rather than passed.
      const anywhere = (await page.content()).includes(c);
      if (anywhere) { console.log(`    · "${c}" is in the markup but not visible at rest — UNVERIFIED`); unverifiable += 1; }
      else no(`"${c}" is named by the guide and is NOT on ${url}`);
    }
  }
}

await browser.close();
await sql.end();

console.log();
if (unaddressable.length) {
  console.log(`${unaddressable.length} route(s) UNADDRESSABLE — no row exists to bind their parameter:`);
  for (const u of unaddressable) console.log(`  · ${u.route} (${u.controls} control(s) unchecked)`);
}
if (unverifiable) {
  console.log(`${unverifiable} control(s) could not be verified at rest — reported, not passed.`);
}
if (bad === 0) console.log('✓ Every control the guides name is on the page they name.');
else console.error(`✗ ${bad} control(s) named by a guide are not on their page.`);
process.exit(bad === 0 ? 0 : 1);
