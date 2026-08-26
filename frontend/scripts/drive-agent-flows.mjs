#!/usr/bin/env node
/**
 * drive-agent-flows.mjs — the pipeline, the agents and the automation, fired and watched.
 *
 * WHY IT IS SEPARATE FROM THE OTHER DRIVERS. `drive-ui-states.mjs` deliberately refuses to press
 * these buttons: "Generate", "Start", "Run all 3" and their kin open nothing and DO something, so a
 * modal probe pressing them creates rows and learns nothing. But they are the product's most
 * interesting states, and they are the ones no screenshot in this repo has ever shown — because
 * they only exist WHILE WORK IS IN FLIGHT.
 *
 * A full draft is not a page. It is:
 *
 *     at rest → requested → queued → an agent claims it → drafts land in review → applied
 *
 * Six states, five of them transient, none reachable by loading a URL. This drives that arc and
 * photographs each step, then reports what the run actually put in the database — process
 * instances, agent invocations, tasks and events — so the picture and the record are checked
 * against each other.
 *
 * ── HOW THE AI ACTUALLY RUNS HERE ──────────────────────────────────────────────────────────────
 * `ANTHROPIC_BASE_URL` points at the committed emulator on :8787, which answers the Messages API
 * with each archetype's expected shape (docs/AI_FLOWS_PROOF.md). Production uses the identical
 * wiring with a real key. So these flows run END TO END with no live key — the plumbing is proven,
 * the model output is not, and that distinction is stated rather than blurred.
 *
 * ── IT MUTATES, LOUDLY AND ON PURPOSE ──────────────────────────────────────────────────────────
 * Firing a draft is the point. Row counts are snapshotted before and after and printed. Run it on a
 * sandbox with a `pg_dump` taken first, as the other drivers here do.
 *
 * ── AND IT NEEDS AN UNLOCKED BUILD ─────────────────────────────────────────────────────────────
 * Every AI action is gated on an editable proposal, and all four Foundation builds are locked. The
 * isolation fixture's in-flight immobileyes build is the one that qualifies; picking it is not a
 * convenience, it is the only correct choice, and the script says so if it cannot find one.
 *
 *   cd frontend && node scripts/drive-agent-flows.mjs
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';

const BASE = process.env.GUIDE_BASE || 'http://localhost:3000';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const DB = process.env.GUIDE_DB || 'postgresql://govtech:changeme@localhost:5432/govtech_intel';
const REPO = '/home/user/govwin';
const OUT = path.join(REPO, 'docs/ui-agents');
const ADMIN_PW = process.env.SANDBOX_PASSWORD || 'SandboxDrive2026!';
const TENANT_PW = process.env.TENANT_PW || 'DemoPass123!';
const sql = postgres(DB, { max: 2, transform: { column: { from: (c) => c } } });
fs.mkdirSync(OUT, { recursive: true });

const shots = [];
const findings = [];
const timeline = [];
let n = 0;

const slug = (s) => String(s).replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 44) || 'x';

async function shoot(page, flow, label, meta = {}) {
  const file = `${slug(flow)}__${String(++n).padStart(3, '0')}-${slug(label)}.jpg`;
  await page.screenshot({ path: path.join(OUT, file), type: 'jpeg', quality: 82 }).catch(() => {});
  shots.push({ flow, label, file, ...meta });
  console.log(`    · ${label}`);
  return file;
}

/** What the ENGINE holds right now — the record the screenshots are checked against. */
async function engineState(proposalId) {
  const [pi] = await sql`SELECT count(*)::int AS n FROM process_instances WHERE archived_at IS NULL`;
  const [tasks] = await sql`SELECT count(*)::int AS n FROM tasks WHERE status = 'open'`;
  const [ev] = await sql`SELECT count(*)::int AS n FROM system_events`;
  const [inv] = await sql`SELECT count(*)::int AS n FROM tool_invocation_metrics`;
  const [ver] = await sql`
    SELECT count(*)::int AS n FROM canvas_versions v
    JOIN proposal_sections s ON s.id = v.section_id WHERE s.proposal_id = ${proposalId}::uuid`;
  // `content_source` is on proposal_sections, NOT canvas_versions (mig 163) — this query named
  // `v.content_source` and threw on the very first run of this script. The column records how the
  // SECTION's current content got there, so an AI-landed section is the section-level fact.
  const [ai] = await sql`
    SELECT count(*)::int AS n FROM proposal_sections s
    WHERE s.proposal_id = ${proposalId}::uuid AND s.content_source = 'ai_revision'`;
  return { instances: pi.n, openTasks: tasks.n, events: ev.n, invocations: inv.n, versions: ver.n, aiRevisions: ai.n };
}

const delta = (a, b) => Object.fromEntries(
  Object.keys(b).filter((k) => a[k] !== b[k]).map((k) => [k, `${a[k]}→${b[k]}`]),
);

async function login(ctx, email, pw) {
  const p = await ctx.newPage();
  await p.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('#email', { timeout: 20000 });
  await p.fill('#email', email); await p.fill('#password', pw);
  await p.click('button[type="submit"]');
  await p.waitForLoadState('networkidle').catch(() => {});
  await p.waitForTimeout(2200);
  if (p.url().includes('/login')) throw new Error(`login failed for ${email}`);
  return p;
}

/** Click by visible text inside the page, returning whether anything matched. */
async function clickText(page, re) {
  return page.evaluate((src) => {
    const rx = new RegExp(src, 'i');
    const els = [...document.querySelectorAll('button,a[role="button"]')];
    const hit = els.find((b) => !b.disabled && b.offsetParent !== null && rx.test((b.textContent || '').trim()));
    if (!hit) return false;
    hit.scrollIntoView({ block: 'center' });
    hit.click();
    return true;
  }, re.source ?? re);
}

// ── run ──────────────────────────────────────────────────────────────────────
console.log(`· serving ${BASE} · emulated Claude at ${process.env.ANTHROPIC_BASE_URL || '(unset)'}`);

// The build must be EDITABLE — every AI action is gated on it.
const [target] = await sql`
  SELECT p.id, p.title, t.slug, p.is_locked, p.stage
  FROM proposals p JOIN tenants t ON t.id = p.tenant_id
  WHERE p.archived_at IS NULL AND p.is_locked = false
  ORDER BY (SELECT count(*) FROM proposal_sections s WHERE s.proposal_id = p.id) DESC
  LIMIT 1`;

if (!target) {
  console.log('\n· NOT MEASURED — no UNLOCKED proposal exists. Every AI action is gated on an');
  console.log('  editable build, so there is nothing to drive. Run scripts/seed-isolation-fixture.mts,');
  console.log('  which creates an in-flight build for exactly this reason. Uncovered, not a finding.');
  await sql.end();
  process.exit(0);
}
console.log(`· driving "${target.title}" @ ${target.slug} (stage=${target.stage}, unlocked)`);

const before = await engineState(target.id);
const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-setuid-sandbox'] });

try {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const [admin] = await sql`
    SELECT u.email FROM users u JOIN user_memberships m ON m.user_id = u.id
    JOIN tenants t ON t.id = m.tenant_id AND t.slug = ${target.slug}
    WHERE u.is_active AND u.role = 'tenant_admin' LIMIT 1`;
  if (!admin) { findings.push({ flow: 'setup', what: `no tenant_admin for ${target.slug}` }); throw new Error('no actor'); }
  const page = await login(ctx, admin.email, TENANT_PW);

  const url = `${BASE}/portal/${target.slug}/proposals/${target.id}`;
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  // ── FLOW 1 · the Proposal Studio, at rest ──────────────────────────────────
  console.log('\n── flow: proposal studio');
  await shoot(page, 'studio', 'at-rest');
  timeline.push({ at: 'at-rest', ...(await engineState(target.id)) });

  // Fire the Draft loop. This is the real thing: a trigger → a workflow instance → an agent cohort.
  const fired = await clickText(page, /start\s*—?\s*draft|start draft|draft loop/i);
  if (!fired) {
    findings.push({ flow: 'studio', what: 'no Draft-loop control offered on an unlocked build — the Studio card may be gated differently than expected' });
    await shoot(page, 'studio', 'NO-DRAFT-CONTROL');
  } else {
    await page.waitForTimeout(1200);
    await shoot(page, 'studio', 'requested', { note: 'immediately after firing' });
    timeline.push({ at: 'requested', ...(await engineState(target.id)) });

    // WATCH IT WORK. The engine is asynchronous — a worker claims the instance, the fabric invokes
    // the cohort, drafts land as proposed versions. Polling the DB is what distinguishes "the
    // button did something" from "the button changed colour".
    for (const wait of [4000, 6000, 8000, 10000]) {
      await page.waitForTimeout(wait);
      const st = await engineState(target.id);
      timeline.push({ at: `+${wait}ms`, ...st });
      if (st.aiRevisions > before.aiRevisions || st.invocations > before.invocations) break;
    }
    await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForTimeout(2500);
    await shoot(page, 'studio', 'after-polling', { note: 'reloaded once the engine settled' });
  }

  // ── FLOW 2 · the AI actions panel ──────────────────────────────────────────
  console.log('\n── flow: AI actions panel');
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  // The panel lives further down the workspace; bring it into frame before shooting.
  await page.evaluate(() => {
    const el = [...document.querySelectorAll('h2,h3')].find((h) => /ai|assist|draft/i.test(h.textContent || ''));
    (el ?? document.body).scrollIntoView({ block: 'center' });
  });
  await page.waitForTimeout(600);
  await shoot(page, 'ai-actions', 'panel');

  // ── FLOW 3 · automation policy ─────────────────────────────────────────────
  console.log('\n── flow: automation');
  await page.goto(`${BASE}/portal/${target.slug}/automation`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2200);
  await shoot(page, 'automation', 'policy-at-rest');

  // ── FLOW 4 · the admin side: agents roster + the auto-drive doorbell ───────
  console.log('\n── flow: admin agents');
  await ctx.close();
  const actx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const apage = await login(actx, 'eric@rfppipeline.com', ADMIN_PW);
  for (const [label, route] of [['roster', '/admin/agents'], ['workflow-monitor', '/admin/workflows'], ['process-monitor', '/admin/process']]) {
    await apage.goto(BASE + route, { waitUntil: 'domcontentloaded' });
    await apage.waitForTimeout(2200);
    await shoot(apage, 'admin-agents', label, { route });
  }
  await actx.close();
} catch (e) {
  findings.push({ flow: 'run', what: String(e.message).slice(0, 140) });
} finally {
  await browser.close();
}

const after = await engineState(target.id);
await sql.end();

console.log(`\n${shots.length} agent-flow state(s) captured`);
console.log('\nengine timeline (what the pipeline actually did):');
for (const t of timeline) {
  const { at, ...rest } = t;
  console.log(`  ${String(at).padStart(9)}  ${Object.entries(rest).map(([k, v]) => `${k}=${v}`).join(' · ')}`);
}
const d = delta(before, after);
console.log(`\nmutation footprint: ${Object.keys(d).length ? Object.entries(d).map(([k, v]) => `${k} ${v}`).join(' · ') : 'nothing changed'}`);
if (!Object.keys(d).length) {
  findings.push({ flow: 'engine', what: 'firing the draft loop changed NOTHING in the engine — no instance, no invocation, no version. The button is inert or the worker is not consuming.' });
}
if (findings.length) {
  console.log(`\n✗ ${findings.length} finding(s):`);
  for (const f of findings) console.log(`  · [${f.flow}] ${f.what}`);
}
fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify({ target: { id: target.id, slug: target.slug, title: target.title }, shots, timeline, before, after, findings }, null, 1));
console.log(`\nwrote ${shots.length} screenshot(s) + index.json to docs/ui-agents/`);
process.exit(findings.length ? 1 : 0);
