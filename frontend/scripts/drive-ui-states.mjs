#!/usr/bin/env node
/**
 * drive-ui-states.mjs — OPEN every modal, drawer, popover and confirm; walk each through its
 * states; photograph all of them.
 *
 * WHY. `capture-ui-atlas.mjs` photographs a page at rest. Almost nothing a customer does happens at
 * rest: they press "New bucket" and a form appears, they submit it empty and it complains, they
 * press Delete and a confirm blocks them, an action fires and a toast reports it. None of that is
 * on a page-load screenshot, and none of it is reachable by any lens in this repo — the write lens
 * calls routes over HTTP without a browser, and the surface lens loads a URL and looks once.
 *
 * The interaction surface is not small: 1,479 handlers over 184 components, 687 buttons, 458
 * inputs, 24 forms, 16 overlay implementations, 26 files using native `confirm()`, and one toast
 * bus that 29 files publish to. This drives it.
 *
 * ── WHAT IT CAPTURES, per trigger ──────────────────────────────────────────────────────────────
 *   open        the overlay as it first appears
 *   validation  its primary submit pressed with the form EMPTY — the client-side complaint
 *   filled      every field populated with a safe value
 *   confirm     a native confirm() intercepted (recorded, then DISMISSED)
 *   toast       whatever the toast bus published
 *   stuck       an overlay that would NOT close — a defect, and the reason for the close step
 *
 * ── WHAT IT WILL NOT DO ────────────────────────────────────────────────────────────────────────
 * It never submits a FILLED form and never accepts a confirm. Pressing submit on an empty form is
 * client-side validation and writes nothing; pressing it on a filled one is a create. Native
 * confirms guard deletes and archives, so the handler always dismisses. Row counts across every
 * table are snapshotted before and after and printed, the same way `verify-write-contract` does —
 * a harness that mutates the corpus other instruments measure is B119, and the only defence is to
 * measure your own footprint and say it out loud.
 *
 *   cd frontend && node scripts/drive-ui-states.mjs
 *   node scripts/drive-ui-states.mjs --lane admin --limit 6
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';

const BASE = process.env.GUIDE_BASE || 'http://localhost:3000';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const DB = process.env.GUIDE_DB || 'postgresql://govtech:changeme@localhost:5432/govtech_intel';
const REPO = '/home/user/govwin';
const OUT = path.join(REPO, 'docs/ui-states');
const ADMIN_PW = process.env.SANDBOX_PASSWORD || 'SandboxDrive2026!';
const TENANT_PW = process.env.TENANT_PW || 'DemoPass123!';
const sql = postgres(DB, { max: 2, transform: { column: { from: (c) => c } } });
fs.mkdirSync(OUT, { recursive: true });

const LIMIT = process.argv.includes('--limit') ? Number(process.argv[process.argv.indexOf('--limit') + 1]) : 10;
const ONLY = process.argv.includes('--lane') ? process.argv[process.argv.indexOf('--lane') + 1] : null;

/**
 * Anything that visually sits above the page. Deliberately broad: only ONE file in this tree
 * imports the shared `Modal`, so the other fifteen overlays are hand-rolled
 * `fixed inset-0 …` cards and a selector that only knew `[role=dialog]` would find almost none.
 */
const OVERLAY_SEL = '[role="dialog"],[aria-modal="true"],div.fixed.inset-0';
const TOAST_SEL = '[role="status"][aria-live="polite"]';

/**
 * Triggers worth pressing, and the ones that must never be pressed. Two groups, and the second was
 * learned by measuring the damage.
 *
 * SESSION/DESTRUCTIVE — sign-out ends the lane for every remaining route; the destructive verbs are
 * guarded by a native confirm this script dismisses, so pressing them is safe but yields a confirm
 * screenshot identical to the one Delete already gives.
 *
 * IMMEDIATE ACTIONS — these open nothing. They DO the thing on click, and the trial run proved it:
 * one pass over the admin lane created a content page, minted a promo code, queued a pipeline job
 * and wrote a tenant agent config. That is B119 — a harness littering the corpus other instruments
 * measure — committed by the harness written to avoid it. A modal probe has no business pressing
 * "Generate Content"; nothing is learned and a row is created.
 *
 * Bare "Create"/"Save" are here for the same reason: inside a modal they are the submit this script
 * presses deliberately (empty, for validation), but at PAGE level they are the commit of an
 * always-visible form. The openers that matter — "+ New Company", "Invite", "Edit", "Upload" —
 * are unaffected.
 */
const SKIP_TEXT = new RegExp([
  'sign out|log out|logout',
  'delete|remove|archive|revoke|discard|reset|clear all',
  'exit to|switch|download|export|print',
  'generate|sync|rebuild|backfill|reconcile|seed|provision|release|publish|approve|submit for',
  'run now|start|launch|send|mint|issue|complete',
  '^create$|^save$|^apply$|^add$',
].join('|'), 'i');
const PROBABLE_OPENER = /new|add|create|invite|edit|upload|configure|manage|assign|settings|options|filter|choose|select|browse|open|view|preview|rank|details|expand|more|\+/i;

const shots = [];
const findings = [];
let shotN = 0;

const slug = (s) => String(s).replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'x';

async function shoot(page, lane, route, label, meta = {}) {
  const file = `${lane}__${slug(route)}__${String(++shotN).padStart(3, '0')}-${slug(label)}.jpg`;
  try {
    await page.screenshot({ path: path.join(OUT, file), fullPage: false, type: 'jpeg', quality: 80 });
    shots.push({ lane, route, label, file, ...meta });
    return file;
  } catch { return null; }
}

/**
 * How many overlays are on screen — by ELEMENT IDENTITY, not by what they contain.
 *
 * The first version keyed each overlay on `text|WxH`. Every page carries one persistent overlay-ish
 * element at rest (the nav rail is a `Drawer`, and it was `role="dialog"` — B133), so ANY change to
 * page content changed that key and read as "a new overlay appeared". It produced sixteen
 * "overlay would not close" findings on one lane, including a time-range filter and a `<summary>`
 * disclosure. None was real.
 *
 * `markExisting` stamps everything currently matching, and `countUnmarked` then answers the only
 * question that matters — did something arrive that was not here before — with no dependence on
 * text, size, or how the page happened to re-render.
 */
async function markExisting(page) {
  await page.evaluate((sel) => {
    for (const el of document.querySelectorAll(sel)) el.setAttribute('data-uistate-pre', '1');
  }, OVERLAY_SEL);
}
async function countUnmarked(page) {
  return page.evaluate((sel) => {
    let n = 0;
    for (const el of document.querySelectorAll(sel)) {
      if (el.hasAttribute('data-uistate-pre')) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 120 || r.height < 80) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') continue;
      n++;
    }
    return n;
  }, OVERLAY_SEL);
}
/** Overlays visible right now, marked or not — used to confirm a close actually closed. */
async function overlaySet(page) {
  return page.evaluate((sel) => {
    const out = [];
    for (const el of document.querySelectorAll(sel)) {
      if (el.hasAttribute('data-uistate-pre')) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 120 || r.height < 80) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') continue;
      out.push(Math.round(r.width) + 'x' + Math.round(r.height));
    }
    return out;
  }, OVERLAY_SEL);
}

/**
 * A signature of the page's MAIN content — the half of the interaction surface the first version
 * threw away.
 *
 * A trigger that opens no overlay and raises no toast was skipped outright, and that is most of the
 * product: a tab switches the panel, a filter re-queries the list, an expander reveals a row's
 * detail, a card selects and swaps the pane beside it. None of those are overlays and all of them
 * are states a customer sees. Thirty-nine modals and twenty-three toasts were captured while every
 * tab in the application went unphotographed.
 *
 * Compared as TEXT rather than pixels because a tab switch replaces content wholesale — a cheap,
 * stable signal that ignores carets, hovers and relative timestamps. `<main>` when the page has one,
 * body otherwise; the nav rail and chrome sit outside it either way.
 */
async function contentSignature(page) {
  return page.evaluate(() => {
    const root = document.querySelector('main') ?? document.body;
    const t = (root.innerText || '').replace(/\s+/g, ' ').trim();
    return { len: t.length, head: t.slice(0, 400), tail: t.slice(-200) };
  });
}

/**
 * Did the panel materially change? A re-render that re-stamps the same text is not a state. A
 * different opening 400 characters, or 4% of length, is the floor — set so a relative timestamp
 * ticking over ("2 minutes ago" → "3 minutes ago") does not register as a tab switch.
 */
function panelChanged(a, b) {
  if (!a || !b) return false;
  if (a.head !== b.head) return true;
  const d = Math.abs(a.len - b.len);
  return a.len > 0 && d / a.len > 0.04;
}

/** Fields inside the newest overlay, filled with values that are valid but obviously synthetic. */
async function fillOverlay(page) {
  return page.evaluate((sel) => {
    const overlays = [...document.querySelectorAll(sel)]
      .filter((e) => !e.hasAttribute('data-uistate-pre') && e.getBoundingClientRect().width > 120);
    const root = overlays[overlays.length - 1] || document.body;
    let n = 0;
    const set = (el, v) => {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      setter?.call(el, v);                                  // React tracks value; a raw assign is ignored
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      n++;
    };
    for (const el of root.querySelectorAll('input,textarea,select')) {
      if (el.disabled || el.readOnly || el.type === 'hidden' || el.type === 'file') continue;
      if (el.tagName === 'SELECT') {
        const opt = [...el.options].find((o) => o.value && !o.disabled);
        if (opt) { el.value = opt.value; el.dispatchEvent(new Event('change', { bubbles: true })); n++; }
        continue;
      }
      if (el.type === 'checkbox' || el.type === 'radio') { if (!el.checked) { el.click(); n++; } continue; }
      const t = el.type;
      set(el, t === 'email' ? 'zz.probe@example.test'
        : t === 'number' ? '1'
          : t === 'date' ? '2026-12-31'
            : t === 'url' ? 'https://example.test'
              : t === 'password' ? 'ZzProbePass123!'
                : 'ZZ probe value');
    }
    return n;
  }, OVERLAY_SEL);
}

/** The primary submit inside the newest overlay. */
async function overlaySubmit(page) {
  return page.evaluateHandle((sel) => {
    const overlays = [...document.querySelectorAll(sel)]
      .filter((e) => !e.hasAttribute('data-uistate-pre') && e.getBoundingClientRect().width > 120);
    const root = overlays[overlays.length - 1];
    if (!root) return null;
    const btns = [...root.querySelectorAll('button,input[type=submit]')]
      .filter((b) => !b.disabled && b.offsetParent !== null);
    return btns.find((b) => /save|create|submit|add|send|invite|apply|confirm|continue|next|generate|upload/i.test(b.textContent || b.value || '')) ?? null;
  }, OVERLAY_SEL);
}

async function closeOverlay(page) {
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(350);
  if ((await overlaySet(page)).length === 0) return true;
  const closed = await page.evaluate((sel) => {
    const overlays = [...document.querySelectorAll(sel)]
      .filter((e) => !e.hasAttribute('data-uistate-pre') && e.getBoundingClientRect().width > 120);
    const root = overlays[overlays.length - 1];
    if (!root) return true;
    const b = [...root.querySelectorAll('button')].find((x) => /cancel|close|dismiss|not now|back|×|✕/i.test(x.textContent || '') || x.getAttribute('aria-label')?.match(/close/i));
    if (b) { b.click(); return true; }
    return false;
  }, OVERLAY_SEL);
  await page.waitForTimeout(400);
  return closed && (await overlaySet(page)).length === 0;
}

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

async function tableCounts() {
  const rows = await sql`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name`;
  const out = {};
  for (const { table_name } of rows) {
    try { const [{ n }] = await sql`SELECT count(*)::int AS n FROM ${sql(table_name)}`; out[table_name] = n; } catch { /* unreadable */ }
  }
  return out;
}

// ── drive one route ──────────────────────────────────────────────────────────
async function driveRoute(page, lane, route, url) {
  const confirms = [];
  const onDialog = async (d) => { confirms.push({ type: d.type(), message: d.message().slice(0, 160) }); await d.dismiss().catch(() => {}); };
  page.on('dialog', onDialog);
  let opened = 0;
  let panels = 0;
  let navFailed = false;

  try {
    /**
     * NAVIGATE DEFENSIVELY — one aborted goto used to take the rest of the lane with it.
     *
     * Clicking arbitrary buttons puts the tab into states a plain `goto` cannot recover from: a
     * click starts a navigation that is still in flight, or begins a download, and the next
     * `goto` returns `net::ERR_ABORTED`. In the first full run that happened once in the admin
     * lane and then EVERY remaining route reported the same error — 25 findings, none of them the
     * product, and the second half of the lane simply unmeasured.
     *
     * So: settle first, retry once, and if the tab is still unusable, replace it. Reported as a
     * finding only when a fresh tab also fails, which is the point at which it stops being the
     * harness's problem.
     */
    let navigated = false;
    for (let attempt = 0; attempt < 2 && !navigated; attempt++) {
      try {
        await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
        await page.goto(BASE + url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        navigated = true;
      } catch (e) {
        if (attempt === 0) { await page.waitForTimeout(1200); continue; }
        throw e;
      }
    }
    await page.waitForTimeout(1800);

    // Candidate triggers, chosen in the page so text and visibility are read together.
    const triggers = await page.evaluate(({ skip, probable }) => {
      const skipRe = new RegExp(skip, 'i'); const probRe = new RegExp(probable, 'i');
      const out = [];
      const els = [...document.querySelectorAll('button,[role="button"],summary,[aria-haspopup]')];
      els.forEach((el, i) => {
        const r = el.getBoundingClientRect();
        if (r.width < 8 || r.height < 8) return;
        if (el.disabled) return;
        if (el.closest('nav,[role="navigation"]')) return;      // nav navigates away, not opens
        const text = (el.textContent || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
        if (!text || skipRe.test(text)) return;
        if (!probRe.test(text) && text.length > 28) return;      // long prose buttons are rarely openers
        el.setAttribute('data-uistate-probe', String(i));
        out.push({ idx: i, text: text.slice(0, 44) });
      });
      return out;
    }, { skip: SKIP_TEXT.source, probable: PROBABLE_OPENER.source });

    for (const t of triggers.slice(0, LIMIT)) {
      await markExisting(page);
      const sigBefore = await contentSignature(page);
      const beforeConfirms = confirms.length;
      const el = await page.$(`[data-uistate-probe="${t.idx}"]`);
      if (!el) continue;
      try { await el.click({ timeout: 2500 }); } catch { continue; }
      await page.waitForTimeout(750);

      // A native confirm was raised (and dismissed by the handler above).
      if (confirms.length > beforeConfirms) {
        const c = confirms[confirms.length - 1];
        await shoot(page, lane, route, `confirm-${t.text}`, { trigger: t.text, kind: 'confirm', message: c.message });
        continue;
      }

      const isNew = (await countUnmarked(page)) > 0;
      const toast = await page.$(TOAST_SEL);

      if (!isNew) {
        if (toast) { await shoot(page, lane, route, `toast-${t.text}`, { trigger: t.text, kind: 'toast' }); continue; }
        // No overlay, no toast — but did the PANEL change? Tabs, filters, expanders and card
        // selections all land here, and all of them are states worth a picture.
        const sigAfter = await contentSignature(page);
        if (panelChanged(sigBefore, sigAfter)) {
          panels++;
          await shoot(page, lane, route, `panel-${t.text}`, {
            trigger: t.text, kind: 'panel',
            chars: `${sigBefore.len}→${sigAfter.len}`,
          });
        }
        continue;
      }

      opened++;
      await shoot(page, lane, route, `open-${t.text}`, { trigger: t.text, kind: 'open' });

      // STATE 2 — the empty complaint. Client-side validation writes nothing.
      const submit = await overlaySubmit(page);
      if (submit && submit.asElement()) {
        try {
          await submit.asElement().click({ timeout: 2000 });
          await page.waitForTimeout(700);
          await shoot(page, lane, route, `validation-${t.text}`, { trigger: t.text, kind: 'validation' });
        } catch { /* not clickable → nothing to record */ }
      }

      // STATE 3 — filled. Never submitted: that would be a create.
      const filled = await fillOverlay(page).catch(() => 0);
      if (filled > 0) {
        await page.waitForTimeout(400);
        await shoot(page, lane, route, `filled-${t.text}`, { trigger: t.text, kind: 'filled', fields: filled });
      }

      // STATE 4 — does it close? An overlay that traps the user is a defect, not a state.
      const closed = await closeOverlay(page);
      if (!closed) {
        await shoot(page, lane, route, `STUCK-${t.text}`, { trigger: t.text, kind: 'stuck' });
        findings.push({ lane, route, trigger: t.text, what: 'overlay would not close via Esc or a cancel/close control' });
        await page.goto(BASE + url, { waitUntil: 'domcontentloaded' }).catch(() => {});
        await page.waitForTimeout(1200);
      }
    }
  } catch (e) {
    const msg = String(e.message).split('\n')[0].slice(0, 110);
    navFailed = /ERR_ABORTED|Target closed|Navigation failed|context was destroyed/i.test(msg);
    findings.push({ lane, route, what: `drive error: ${msg}`, harness: true });
  } finally {
    page.off('dialog', onDialog);
  }
  return { opened, panels, confirms: confirms.length, navFailed };
}

// ── run ──────────────────────────────────────────────────────────────────────
const atlas = JSON.parse(fs.readFileSync(path.join(REPO, 'docs/ui-atlas/index.json'), 'utf8'));
const LANES = {
  anon: { label: 'public · no session', email: null },
  tenant: { label: 'tenant_admin @ foundation', email: 'kate.ulepic@foundation3dp.com', pw: TENANT_PW },
  tenant2: { label: 'tenant_admin @ immobileyes', email: 'admin@immobileyes.test', pw: TENANT_PW },
  admin: { label: 'master_admin', email: 'eric@rfppipeline.com', pw: ADMIN_PW },
  partner: { label: 'partner_admin', email: 'pjackson@ecinnovates.com', pw: ADMIN_PW },
  collab: { label: 'partner_user', email: 'collab@lighthouse.com', pw: process.env.COLLAB_PW || 'CollabPass1' },
};

console.log(`· serving ${BASE} · driving overlays on ${atlas.shots.length} captured route(s), ≤${LIMIT} triggers each`);
const before = await tableCounts();
const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
let totalOpened = 0, totalConfirms = 0, totalPanels = 0, routesDriven = 0;

try {
  for (const [laneId, lane] of Object.entries(LANES)) {
    if (ONLY && ONLY !== laneId) continue;
    const mine = atlas.shots.filter((s) => s.lane === laneId && !s.redirected);
    if (!mine.length) continue;
    console.log(`\n── ${laneId} · ${lane.label} · ${mine.length} route(s) ──`);
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    let page;
    try { page = lane.email ? await login(ctx, lane.email, lane.pw) : await ctx.newPage(); }
    catch (e) { console.log(`  ✗ lane unavailable — ${String(e.message).slice(0, 60)}`); await ctx.close(); continue; }

    for (const s of mine) {
      let r = await driveRoute(page, laneId, s.route, s.url);
      // A tab that cannot navigate is spent — give the lane a fresh one and re-drive this route
      // once, so a single bad click costs one route rather than every route after it.
      if (r.navFailed) {
        try {
          await page.close().catch(() => {});
          page = await ctx.newPage();
          r = await driveRoute(page, laneId, s.route, s.url);
        } catch { /* the lane is genuinely broken; the finding already records it */ }
      }
      routesDriven++; totalOpened += r.opened; totalConfirms += r.confirms; totalPanels += r.panels ?? 0;
      if (r.opened || r.confirms || r.panels) console.log(`  ${s.route.padEnd(52)} ${r.opened} overlay(s) · ${r.panels} panel(s) · ${r.confirms} confirm(s)`);
    }
    await ctx.close();
  }
} finally {
  await browser.close();
}

const after = await tableCounts();
const drift = Object.keys(after).filter((t) => before[t] !== undefined && before[t] !== after[t]).map((t) => `${t}: ${before[t]} → ${after[t]}`);
await sql.end();

const byKind = {};
for (const s of shots) byKind[s.kind] = (byKind[s.kind] ?? 0) + 1;

console.log(`\n${shots.length} state screenshot(s) across ${routesDriven} route(s)`);
for (const [k, v] of Object.entries(byKind).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(5)}  ${k}`);
console.log(`\n  ${totalOpened} overlay(s) opened · ${totalPanels} panel state(s) · ${totalConfirms} native confirm(s) intercepted and dismissed`);
console.log(`\nmutation footprint: ${drift.length ? drift.length + ' table(s) changed' : 'nothing changed'}`);
for (const d of drift) console.log(`  · ${d}`);

if (findings.length) {
  console.log(`\n✗ ${findings.length} finding(s):`);
  for (const f of findings) console.log(`  · [${f.lane}] ${f.route}${f.trigger ? ` — "${f.trigger}"` : ''}: ${f.what}`);
}
fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify({ base: BASE, routesDriven, shots, findings, drift }, null, 1));
console.log(`\nwrote ${shots.length} screenshot(s) + index.json to docs/ui-states/`);
process.exit(findings.length ? 1 : 0);
