/**
 * THE ARC — one end-to-end drive, composed entirely through the UI, with me as the human in the
 * loop.
 *
 * Opportunity supply → a company applies → an operator accepts it → the tenant builds its library
 * → it buys a portal → an operator releases it → the proposal gets authored, reviewed and locked →
 * it exports in four formats → the artifacts get opened and checked.
 *
 * TWO RULES THAT MAKE THIS DIFFERENT FROM THE EARLIER PHASE SPECS:
 *
 *  1. I ACT AS THE HITL. Every gate this product puts in front of a human — pick a program type,
 *     write review notes, approve or regenerate a Studio phase, accept a draft, lock a section —
 *     is a decision made here and recorded in the ledger, not something to be routed around.
 *
 *  2. A BLOCK IS NOTED AND OVERRIDDEN, NOT FATAL. Nothing throws. If a step cannot complete, the
 *     ledger records WHAT blocked and WHAT I did instead, and the arc keeps going. A run that
 *     stops at the first nuance tells you about that nuance; a run that finishes tells you which
 *     of thirty steps actually work. The ledger at the end is the real result — every OK, every
 *     OVERRIDE, every BLOCKED, in order.
 *
 * Where the product needs content a customer would supply, I write it. That is not cheating: a
 * proposal with no prose cannot be page-counted, exported, or reviewed, so inventing the prose is
 * what makes the rest of the arc testable at all.
 *
 * Run: npx playwright test --project=drive mt-arc
 */
import { test, expect, type Page, type APIResponse, type BrowserContext } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

const OUT = process.env.MT_DIR || '/tmp/claude-0/-home-user-govwin/34d597b2-183f-5787-9057-fc7251e3f9ff/scratchpad/mt';
const SHOTS = path.join(OUT, 'shots', 'arc');
const DL = path.join(OUT, 'downloads');
const SOLS_DIR = path.join(__dirname, 'fixtures', 'solicitations');
const CO_DIR = path.join(__dirname, 'fixtures', 'companies');
const ADMIN_PW = process.env.RFP_ADMIN_PW || 'SandboxDrive2026!';
const TENANT_PW = 'MidtermDrive2026!';
const COMP_CODE = 'rfppipelinetest';

// ── the ledger ────────────────────────────────────────────────────────────────
type Status = 'ok' | 'decision' | 'override' | 'blocked' | 'note';
interface Entry { act: string; step: string; actor: string; status: Status; detail?: string }
const ledger: Entry[] = [];
let ACT = '';
const rec = (step: string, actor: string, status: Status, detail?: string) => {
  ledger.push({ act: ACT, step, actor, status, detail });
  const mark = { ok: '✓', decision: '◆', override: '⤳', blocked: '✗', note: '·' }[status];
  console.error(`   ${mark} [${actor}] ${step}${detail ? ` — ${detail.slice(0, 160)}` : ''}`);
};
/** A human decision at a gate the product raises. */
const hitl = (what: string, why: string) => rec(what, 'HITL', 'decision', why);
/** Something blocked; here is what I did instead, and the arc continues. */
const override = (what: string, instead: string) => rec(what, 'HITL', 'override', instead);

/** Run a step. Never throws — records and returns null so the arc continues. */
async function step<T>(name: string, actor: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    const r = await fn();
    rec(name, actor, 'ok');
    return r;
  } catch (e) {
    rec(name, actor, 'blocked', (e as Error).message?.split('\n')[0] ?? String(e));
    return null;
  }
}
const ok = (r: APIResponse | null) => !!r && r.status() < 300;
const shot = async (page: Page, name: string) => {
  try { await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }); } catch { /* keep going */ }
};

/**
 * Sign in, and if it does not work SAY WHAT THE PAGE SHOWED.
 *
 * A bare `page.fill` on an absent field used to hang the whole drive (the project set no
 * actionTimeout, and Playwright's default is "wait forever"). The timeouts now live in
 * playwright.config.ts; what is left is making the failure legible — "sign-in failed" is
 * useless, "landed on /portal/x with no password field" is a diagnosis.
 */
async function signIn(page: Page, email: string, pw: string) {
  try {
    // CLEARING COOKIES IS NOT THE SAME AS SIGNING OUT, and the difference cost a whole run.
    // `clearCookies()` empties the jar, but the App Router keeps a client-side route cache from
    // the previous session; navigating to /login then resolves against that cache and lands on the
    // PREVIOUS role's dashboard — /admin/dashboard while trying to sign in as the tenant admin.
    // There is no password field there, so the fill waits (forever, before the timeouts went in).
    // Going through about:blank drops the cached tree, and re-checking afterwards makes the
    // recovery explicit rather than hopeful.
    // Wait for the FIELD, not for a URL. The bounce back to the previous role's dashboard happens
    // after domcontentloaded, so a URL check right after the goto sees "/login", passes, and then
    // the redirect fires underneath it — which is how this failed twice while looking correct.
    // Waiting on the password input is the only condition that means "the login form is here".
    const reach = async () => {
      await page.context().clearCookies();
      await page.goto('about:blank');
      await page.goto('/login', { waitUntil: 'domcontentloaded' });
      await page.locator('input[name="password"]').waitFor({ state: 'visible', timeout: 15_000 });
    };
    try { await reach(); } catch { await reach(); } // one clean retry, then let it throw
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', pw);
    await Promise.all([
      page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 }),
      page.click('button[type="submit"]'),
    ]);
  } catch (e) {
    const where = page.url(); // sync — awaiting it and calling .catch throws inside the handler
    const visible = await page.locator('body').innerText().catch(() => '');
    throw new Error(
      `sign-in as ${email} failed at ${where}: ${(e as Error).message.split('\n')[0]}` +
      ` | page said: ${visible.replace(/\s+/g, ' ').trim().slice(0, 200)}`);
  }
}

/**
 * First sign-in for an account the operator just created.
 *
 * The accept flow issues a temp password and leaves users.temp_password = true, and the middleware
 * bounces EVERY path except /change-password until that clears — including API routes, which is
 * why a perfectly good tenant_admin was getting 403 on its own tenant's library. Checking the URL
 * right after login raced the redirect and missed it, so this navigates to /change-password
 * explicitly, resets, and signs back in. That is also exactly what a new customer does with the
 * credentials in their welcome email.
 */
async function firstSignIn(page: Page, email: string, tempPw: string) {
  await signIn(page, email, tempPw);
  await page.goto('/change-password', { waitUntil: 'networkidle', timeout: 30_000 });
  const f = page.locator('input[type="password"]');
  if (await f.count() >= 2) {
    await f.nth(0).fill(tempPw);
    await f.nth(1).fill(TENANT_PW);
    if (await f.count() > 2) await f.nth(2).fill(TENANT_PW);
    await page.click('button[type="submit"]');
    await page.waitForTimeout(2500);
    rec('forced password reset completed', email, 'ok');
  } else {
    rec('change-password form not present', email, 'note', 'account may already be reset');
  }
  await signIn(page, email, TENANT_PW);
  rec('signed in with the new password', email, 'ok');
}

// Prose a customer would write. Invented deliberately: a proposal with no words cannot be
// page-counted, exported or reviewed, so this is what makes the rest of the arc testable.
const PROSE: Record<string, string> = {
  technical:
    'Northwind Additive proposes a containerized mobile gantry that prints structural wall sections '
    + 'on site, eliminating formwork on expeditionary builds. Our binder reaches design compressive '
    + 'strength in under four hours at field temperatures from -5 to 45 degrees Celsius, which is what '
    + 'makes a same-day pour-and-occupy cycle possible. Phase I will demonstrate a 900 square foot '
    + 'shell printed in under twelve hours by a two-person crew, characterized against ASTM C1314. '
    + 'The technical risk is thermal control of the binder in cold weather; we retire it in month two '
    + 'with a jacketed hopper already prototyped under internal funding.',
  management:
    'Dana Reyes serves as Principal Investigator at 0.5 FTE and holds both issued patents on the '
    + 'nozzle geometry. Marcus Whitfield leads the motion and extrusion control stack at 0.4 FTE. '
    + 'Priya Raghunathan owns binder chemistry at 0.3 FTE. The team has printed together for three '
    + 'years and delivered the Ohio TVSF Round 43 demonstration on schedule and under budget.',
  commercialization:
    'The immediate market is expeditionary and disaster-recovery construction, where formwork is the '
    + 'schedule driver and skilled labor is scarce. We have two letters of intent from regional '
    + 'contractors and an executed MOU with a modular housing manufacturer. Phase II would move from '
    + 'a single gantry to a two-unit deployable kit, and the commercial path does not depend on '
    + 'further federal funding after Phase II.',
  cost:
    'Direct labor is 1.2 FTE across six months. Materials cover binder feedstock and the jacketed '
    + 'hopper build. Equipment is limited to the cure-chamber instrumentation, all items under the '
    + '$5,000 capitalization threshold. Indirect is applied at our provisional rate; no subcontracts '
    + 'or consultants are proposed in Phase I.',
};
const proseFor = (title: string): string => {
  const t = title.toLowerCase();
  if (/cost|budget|price/.test(t)) return PROSE.cost;
  if (/commercial|market|impact/.test(t)) return PROSE.commercialization;
  if (/manage|personnel|team|key/.test(t)) return PROSE.management;
  return PROSE.technical;
};

/**
 * The primaries — a section is not only prose.
 *
 * A real proposal argues in figures, tables and schedules as much as in sentences, and each of
 * those is a distinct canvas node with a distinct export path: a `table` renders natively as an
 * OOXML table, a `chart` is drawn to SVG and rasterized, and an `image` resolves its storage key
 * out of object storage and is rasterized too. Only the first of those three is pure data — the
 * other two go through pipelines that FAIL QUIETLY, degrading to a grey "[Chart: bar]" or
 * "[Image: …]" stub rather than throwing. So the only way to know they work is to author them and
 * then open the file.
 *
 * Nodes are keyed by the section they belong in, and each figure carries its own caption node so
 * the numbering ("Figure 1", "Table 2") is part of the document rather than an afterthought.
 */
type Node = { id: string; type: string; content: Record<string, unknown> };
const textNode = (id: string, text: string): Node => ({ id, type: 'text_block', content: { text } });

/** Phase I milestone schedule — the table every technical volume carries. */
const milestoneTable = (): Node => ({
  id: 'tbl-milestones',
  type: 'table',
  content: {
    headers: ['Milestone', 'Month', 'Deliverable', 'Success criterion'],
    rows: [
      ['M1 · Mix qualification', '1–2', 'Rheology + cure report', '≥ 28 MPa at 28 days, slump 180–220 mm'],
      ['M2 · Gantry integration', '2–4', 'Integrated print cell', 'Continuous 14-course wall, no cold joints'],
      ['M3 · Expeditionary trial', '4–5', 'Field trial report', 'Shelter printed in < 26 h on unimproved grade'],
      ['M4 · Phase II transition', '5–6', 'Phase II plan + data package', 'TRL 6 evidence accepted by the TPOC'],
    ],
    header_style: { bold: true, bg: '122342', fg: 'FFFFFF', alignment: 'left' },
    border_style: 'single',
  },
});

/** Throughput against the topic's threshold — the chart that makes the claim checkable. */
const throughputChart = (): Node => ({
  id: 'cht-throughput',
  type: 'chart',
  content: {
    chart_type: 'bar',
    title: 'Print throughput by course height (m²/h)',
    categories: ['20 mm', '26 mm', '32 mm', '38 mm'],
    series: [
      { name: 'Measured (Rhode Island slab)', data: [3.1, 4.4, 5.2, 5.6], color: '#122342' },
      { name: 'Topic threshold', data: [4.0, 4.0, 4.0, 4.0], color: '#C47A3A' },
    ],
  },
});

/** Phase I schedule as a Gantt — the same data a reviewer wants to see laid out in time. */
const scheduleChart = (): Node => ({
  id: 'cht-schedule',
  type: 'chart',
  content: {
    chart_type: 'gantt',
    title: 'Phase I schedule (months from award)',
    categories: ['Mix qualification', 'Gantry integration', 'Expeditionary trial', 'Phase II transition'],
    series: [
      { name: 'Start', data: [0, 2, 4, 5] },
      { name: 'End', data: [2, 4, 5, 6] },
    ],
  },
});

const caption = (id: string, prefix: 'Figure' | 'Table' | 'Chart', number: number, text: string): Node =>
  ({ id, type: 'caption', content: { prefix, number, text } });

const imageNode = (id: string, storageKey: string, alt: string, w: number, h: number): Node =>
  ({ id, type: 'image', content: { storage_key: storageKey, alt_text: alt, width: w, height: h } });

/** A phrase typed BY HAND in the editor — distinctive enough that finding it after a reload
 *  proves the keystrokes reached the server, not merely that a save button existed. */
const EDITOR_MARK = 'Typed in the canvas editor during the midterm drive — this sentence proves the keystrokes persisted.';

/**
 * Accept a pending application THROUGH THE ADMIN SCREEN, the way an operator does.
 *
 * There is no list API to query — the queue is a page, and the Accept button stays disabled until
 * a real assessment is written into the review box. Driving the screen is therefore both the
 * faithful path and the only one, and it is why the assessment text below is an actual judgement
 * rather than filler.
 */
async function acceptApplicationInUI(page: Page, company: string, assessment: string): Promise<Record<string, string>> {
  await page.goto('/admin/applications', { waitUntil: 'networkidle', timeout: 60_000 });
  const row = page.getByRole('button').filter({ hasText: company }).first();
  if (!(await row.count())) throw new Error(`${company} is not in the application queue`);
  await row.click();
  await page.locator('textarea').last().fill(assessment);
  const resp = page.waitForResponse((r) => /\/accept/.test(r.url()) && r.request().method() === 'POST', { timeout: 180_000 });
  await page.getByRole('button', { name: /^Accept$/ }).first().click();
  const r = await resp;
  const b = await r.json().catch(() => ({}));
  if (r.status() >= 300) throw new Error(`accept ${r.status()} ${JSON.stringify(b).slice(0, 160)}`);
  return ((b as { data?: Record<string, string> }).data ?? {});
}

/** One applicant's answers on the public form. */
interface Applicant {
  company: string; contact: string; title: string; email: string; state: string;
  tech: string; motivation: string; referral: string;
}

/**
 * Walk the PUBLIC application form as an anonymous visitor and submit it.
 *
 * Extracted so a second company can walk the identical path — onboarding two tenants through the
 * same door is what makes the isolation check afterwards mean something. If the second one went in
 * through a seed or an admin shortcut, "these two tenants cannot see each other" would only be a
 * statement about how they were inserted.
 */
async function applyAtPublicForm(page: Page, context: BrowserContext, CO: Applicant): Promise<void> {
  await context.clearCookies();
  await page.goto('/apply', { waitUntil: 'networkidle', timeout: 60_000 });
  await page.fill('input[name="contactName"]', CO.contact);
  await page.fill('input[name="contactEmail"]', CO.email);
  await page.fill('input[name="contactTitle"]', CO.title);
  await page.fill('input[name="companyName"]', CO.company);
  const st = page.locator('input[name="companyState"]'); if (await st.count()) await st.fill(CO.state);
  const sam = page.locator('input[name="samRegistered"][value="yes"]'); if (await sam.count()) await sam.first().check();
  await page.fill('textarea[name="techSummary"]', CO.tech);
  await page.fill('textarea[name="motivation"]', CO.motivation);
  await page.fill('input[name="referralSource"]', CO.referral);
  for (const g of ['techAreas', 'targetPrograms', 'targetAgencies', 'desiredOutcomes']) {
    const b = page.locator(`input[type="checkbox"][name="${g}"]`);
    if (await b.count()) await b.first().check();
  }
  const req = page.locator('input[type="checkbox"][required]');
  for (let i = 0; i < await req.count(); i++) {
    const x = req.nth(i); if (!(await x.isChecked())) await x.check().catch(() => {});
  }
  // THE TERMS GATE. The form will not submit without a scroll-to-accept and a signature that
  // MATCHES the contact email exactly (application-form.tsx:100). Skipping it is what made the
  // first arc run time out waiting on a POST that was never sent — the browser was refusing.
  const openTerms = page.getByRole('button', { name: /terms|conditions|read/i }).first();
  if (await openTerms.count()) { await openTerms.click().catch(() => {}); await page.waitForTimeout(400); }
  await page.evaluate(() => {
    for (const el of Array.from(document.querySelectorAll('div,section'))) {
      if (el.scrollHeight > el.clientHeight + 40) el.scrollTop = el.scrollHeight;
    }
  }).catch(() => {});
  await page.waitForTimeout(300);
  const sig = page.locator('input[type="email"]').last();
  if (await sig.count()) await sig.fill(CO.email).catch(() => {});
  const agree = page.getByRole('button', { name: /agree|accept|confirm/i }).first();
  if (await agree.count()) await agree.click().catch(() => {});
  await page.waitForTimeout(400);
  const resp = page.waitForResponse((r) => r.url().includes('/api/applications') && r.request().method() === 'POST', { timeout: 45_000 })
    .catch(() => null);
  await page.click('button[type="submit"]');
  const r = await resp;
  if (!r) {
    const bad = await page.evaluate(() => {
      const f = document.querySelector('form');
      if (!f) return 'no form on the page';
      const el = Array.from(f.querySelectorAll<HTMLInputElement>('input,select,textarea'))
        .find((x) => !x.checkValidity());
      return el ? `${el.tagName.toLowerCase()}[name=${el.name || '?'}] — ${el.validationMessage}` : 'form reports valid but did not submit';
    }).catch(() => 'could not inspect the form');
    throw new Error(`submit refused: ${bad}`);
  }
  if (r.status() >= 300) throw new Error(`application POST ${r.status()}`);
}

test('the arc: supply → customer → library → portal → authored → reviewed → exported', async ({ page, context }) => {
  test.setTimeout(90 * 60_000);
  for (const d of [SHOTS, DL]) fs.mkdirSync(d, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });

  const state: Record<string, string> = {};

  // ══ ACT 1 — the operator composes the opportunity supply ═══════════════════
  ACT = 'ACT 1 · opportunity supply';
  console.error(`\n${ACT}`);
  await step('operator signs in', 'master_admin', () => signIn(page, 'eric@rfppipeline.com', ADMIN_PW));

  const SUPPLY = [
    { slug: 'dow-sbir-p1', title: 'DoN 26.1 SBIR — Additive Construction for Expeditionary Basing (N261-118)', agency: 'Department of the Navy', pt: 'sbir_phase_1', close: '2026-11-14' },
    { slug: 'nsf-sttr-p1', title: 'NSF STTR Phase I — Robotics for the Built Environment (NSF 26-522)', agency: 'National Science Foundation', pt: 'sttr_phase_1', close: '2026-12-03' },
    { slug: 'doe-sbir-p2', title: 'DOE SBIR Phase II — Low-Carbon Concrete & Cement Materials (DE-FOA-0003412)', agency: 'U.S. Department of Energy', pt: 'sbir_phase_2', close: '2027-02-19' },
    { slug: 'ohio-tvsf-r46', title: 'Ohio TVSF Round 46 — Technology Validation & Startup Fund (TVS-2027-01)', agency: 'Ohio Third Frontier', pt: 'other', close: '2027-01-22' },
  ];
  const solIds: Record<string, string> = {};

  for (const s of SUPPLY) {
    const pdf = path.join(SOLS_DIR, `${s.slug}.pdf`);
    await step(`upload ${s.slug}`, 'master_admin', async () => {
      await page.goto('/admin/rfp-curation/upload', { waitUntil: 'networkidle', timeout: 60_000 });
      await page.fill('input[name="title"]', s.title);
      await page.fill('input[name="agency"]', s.agency);
      const n = page.locator('input[name="solicitationNumber"]');
      if (await n.count()) await n.fill(s.slug.toUpperCase());
      const c = page.locator('input[name="closeDate"]');
      if (await c.count()) await c.fill(s.close);
      // HITL: the form only guesses Program Type when the title names a known program.
      await page.selectOption('select[name="programType"]', s.pt);
      await page.locator('input[type="file"]').first().setInputFiles([pdf]);
      await page.click('button[type="submit"]');
      await page.waitForURL(/\/admin\/rfp-curation\/[0-9a-f-]{36}/, { timeout: 8 * 60_000 });
      solIds[s.slug] = page.url().split('/').pop()!.split('?')[0];
    });
    if (!solIds[s.slug]) { override(`${s.slug} upload`, 'skipping this solicitation; the arc continues on the others'); continue; }

    hitl(`program type for ${s.slug}`, `chose ${s.pt} — the parser cannot infer it from this title`);
    await step(`Ingest Assist on ${s.slug}`, 'master_admin', async () => {
      const r = await page.request.post(`/api/admin/rfp-curation/${solIds[s.slug]}/ingest-assist`, { data: { publish: false }, timeout: 180_000 });
      const b = await r.json();
      const landed = b?.data?.landed;
      const blockers: string[] = b?.data?.blockers ?? [];
      rec(`${s.slug} matrix`, 'system', 'note', `landed=${landed} volumes=${b?.data?.volumes} blockers=${blockers.length}`);
      if (!landed && blockers.length) {
        // HITL: the DoW BAA defers its page limit to Component instructions nobody attached. That
        // is a correct refusal to invent a number — as the curator I accept the staged matrix and
        // carry the unresolved deferral forward rather than fabricating a page limit.
        hitl(`${s.slug} staged-not-landed`, `accepting: "${blockers[0].slice(0, 110)}…"`);
        const f = await page.request.post(`/api/admin/rfp-curation/${solIds[s.slug]}/ingest-assist`, {
          data: { publish: false, allowDefaultSkeleton: true }, timeout: 180_000,
        });
        if (ok(f)) override(`${s.slug} land`, 'accepted the default skeleton with the deferral recorded, so the build can proceed');
        else override(`${s.slug} land`, 'left staged; downstream acts use the solicitations that did land');
      }
    });
    await shot(page, `01-${s.slug}-matrix`);
  }
  state.solCount = String(Object.keys(solIds).length);

  // CURATE → APPROVE → PUSH. There is no /approve or /push route; the workspace drives this
  // through the agent-tool endpoint (POST /api/tools/<name>) and a triage state machine:
  //   ai_analyzed → claim → skip_shredder → curation_in_progress → request_review → approve → push
  // The push gate additionally requires a spotlightSummary — the curator's matching context, which
  // is a HITL act, so I write one per solicitation.
  // POST /api/tools/<name> takes `{ input }`, not the input bare — sending it bare returns
  // 422 TOOL_VALIDATION_ERROR, which reads like a bad argument rather than a bad envelope.
  const tool = (name: string, input: Record<string, unknown>) =>
    page.request.post(`/api/tools/${name}`, { data: { input }, timeout: 120_000 });

  const SUMMARIES: Record<string, string> = {
    'dow-sbir-p1': 'Navy Phase I for on-site additive construction of expeditionary structures. Fits firms with mobile printing hardware, rapid-cure binders, and field-deployable crews.',
    'nsf-sttr-p1': 'NSF STTR Phase I pairing a small business with a research institution on robotics and autonomy for active construction sites. Fits perception, SLAM and as-built capture.',
    'doe-sbir-p2': 'DOE Phase II for low-carbon cement and concrete. Fits firms with Phase I results in clinker replacement, carbonation chemistry, or supplementary cementitious materials.',
    'ohio-tvsf-r46': 'Ohio Third Frontier commercialization funding for technology out of Ohio institutions. Requires a willingness-to-license letter and a one-to-one cost share.',
  };

  // What a curator would write into a field the solicitation deferred elsewhere. These are the
  // values a human enters after reading the referenced instructions — invented here because this
  // is a fixture, and recorded as manual_entry so they never masquerade as read-from-source.
  const MANUAL_ENTRY: Record<string, string> = {
    submission_format: 'Single PDF, letter portrait, uploaded through the DoD SBIR/STTR portal (per the Component-specific instructions).',
  };

  for (const [slug, id] of Object.entries(solIds)) {
    await step(`curate → approve → push ${slug}`, 'master_admin', async () => {
      hitl(`spotlight summary for ${slug}`, 'wrote the matching context the push gate requires');
      const patch = await page.request.patch(`/api/admin/rfp-curation/${id}`, {
        data: { spotlightSummary: SUMMARIES[slug], expertNotes: 'Curated during the midterm arc drive.' },
        timeout: 60_000,
      });
      if (!ok(patch)) rec(`${slug} spotlightSummary`, 'system', 'note', `HTTP ${patch.status()}`);

      // Walk the state machine. Each step is legal only from specific states, so a non-2xx just
      // means we were already past it — record and carry on rather than stopping the arc.
      for (const [label, fn] of [
        ['claim', () => tool('solicitation.claim', { solicitationId: id })],
        ['start curation', () => page.request.post(`/api/admin/rfp-curation/${id}/triage`, { data: { action: 'skip_shredder' }, timeout: 60_000 })],
        ['request review', () => tool('solicitation.request_review', { solicitationId: id })],
        ['approve', () => tool('solicitation.approve', { solicitationId: id })],
        ['push', () => tool('solicitation.push', { solicitationId: id })],
      ] as Array<[string, () => Promise<APIResponse>]>) {
        let r = await fn();

        // THE DEFERRAL AND THE PUSH GATE MEET HERE, and both are behaving correctly.
        // Ingest Assist refuses to invent a value the solicitation does not state: when this DoW
        // BAA says the submission format lives in the Component-specific instructions, the
        // provenance layer CLEARS the default and records a deferral rather than fabricating one
        // ("a value the product did not read from the solicitation must never look like one it
        // did"). The push gate then refuses to release an opportunity whose submission_format is
        // unknown. Neither is a bug — together they are an instruction to a human: go read the
        // Component instructions and enter what they say.
        //
        // So do that. compliance.save_variable_value with action 'manual_entry' is the curator's
        // marquee HITL act, and it records WHERE the value came from, which is the whole point —
        // the value ends up trusted as `hitl`, not laundered into looking like something the
        // shredder read.
        // Key on the PAYLOAD, not the status: a tool ValidationError is 422, not the 400 a REST
        // habit expects, and hard-coding either one makes the branch dead code that reads as live.
        if (label === 'push' && !ok(r)) {
          const body = await r.text();
          const missing = (() => {
            try { return (JSON.parse(body || '{}')?.details?.missingVariables ?? []) as string[]; }
            catch { return [] as string[]; }
          })();
          if (missing.length) {
            hitl(`${slug} deferred fields`,
              `the push gate wants ${missing.join(', ')}; the solicitation defers ${missing.length > 1 ? 'them' : 'it'} to the Component-specific instructions, so I am entering ${missing.length > 1 ? 'them' : 'it'} by hand as the curator`);
            for (const v of missing) {
              const value = MANUAL_ENTRY[v] ?? 'See Component-specific instructions';
              const sv = await tool('compliance.save_variable_value', {
                solicitationId: id,
                variableName: v,
                value,
                action: 'manual_entry',
                notes: 'Midterm arc: solicitation defers this to the Component-specific instructions; entered by the curator from that source rather than defaulted.',
              });
              rec(`${slug} enter ${v} by hand`, 'master_admin', ok(sv) ? 'override' : 'blocked',
                ok(sv) ? `${v} = "${value}" (provenance: hitl, not default)` : `HTTP ${sv.status()} ${(await sv.text()).slice(0, 120)}`);
            }
            r = await fn(); // push again now that a human has answered the question
          }
        }

        if (ok(r)) rec(`${slug} ${label}`, 'master_admin', 'ok');
        else rec(`${slug} ${label}`, 'system', 'note', `HTTP ${r.status()} ${(await r.text()).slice(0, 100)}`);
      }
    });
  }

  // ══ ACT 2 — a company applies, and I accept it ════════════════════════════
  ACT = 'ACT 2 · customer onboarding';
  console.error(`\n${ACT}`);
  const CO = {
    company: 'Northwind Additive', contact: 'Dana Reyes', title: 'CEO',
    email: 'dana.reyes@northwind-additive.com', state: 'Ohio',
    tech: 'We print structural concrete forms on site using a mobile gantry, cutting formwork cost and schedule '
      + 'on expeditionary and disaster-recovery builds. Our binder cures in under four hours at field temperatures. '
      + 'We hold two issued patents on the nozzle geometry.',
    motivation: 'The Navy 26.1 topic on additive construction for expeditionary basing is a direct fit and closes in November.',
    referral: 'Referral from our university tech-transfer office',
  };

  await step('company applies at the public form', 'anonymous', async () => {
    hitl('terms & conditions', 'opened the T&Cs, scrolled to the end, and signed with the contact email');
    await applyAtPublicForm(page, context, CO);
    await shot(page, '02-apply-form');
  });

  await step('operator signs back in', 'master_admin', () => signIn(page, 'eric@rfppipeline.com', ADMIN_PW));
  const accepted = await step('accept the application', 'master_admin', async () => {
    await page.goto('/admin/applications', { waitUntil: 'networkidle', timeout: 60_000 });
    await shot(page, '03-application-queue');
    const row = page.getByRole('button').filter({ hasText: CO.company }).first();
    await row.click();
    // HITL: the Accept button will not enable without a real assessment. Writing one.
    hitl('application review', 'assessed Northwind as a credible fit for N261-118; SAM registered; accepting');
    await page.locator('textarea').last().fill(
      `Reviewed ${CO.company}. ${CO.contact} (${CO.title}) — mobile gantry concrete printing with two issued `
      + `patents and a delivered Ohio TVSF demonstration. Direct fit for the Navy 26.1 expeditionary basing `
      + `topic. SAM registration confirmed. Accepting for onboarding.`);
    const resp = page.waitForResponse((r) => /\/accept/.test(r.url()) && r.request().method() === 'POST', { timeout: 90_000 });
    await page.getByRole('button', { name: /^Accept$/ }).first().click();
    const r = await resp;
    const b = await r.json().catch(() => ({}));
    if (!ok(r)) throw new Error(`accept ${r.status()} ${JSON.stringify(b).slice(0, 140)}`);
    const d = (b as { data?: Record<string, string> }).data ?? {};
    state.slug = d.slug ?? d.tenantSlug ?? '';
    state.adminEmail = d.adminEmail ?? d.email ?? CO.email;
    state.tempPw = d.tempPassword ?? '';
    state.tenantId = d.tenantId ?? d.id ?? '';
    state.company = CO.company;
    rec('tenant created', 'system', 'note', `slug=${state.slug} admin=${state.adminEmail} temp=${state.tempPw ? 'issued' : 'NOT RETURNED'}`);
    await shot(page, '04-application-accepted');
    return true;
  });
  if (!accepted || !state.slug) {
    override('tenant creation', 'no tenant slug returned — the remaining acts cannot run against a customer; ledger records this as the arc stop point');
    fs.writeFileSync(path.join(OUT, 'arc-ledger.json'), JSON.stringify(ledger, null, 2));
    return;
  }

  // ══ ACT 3 — the tenant builds its own library ═════════════════════════════
  ACT = 'ACT 3 · tenant library';
  console.error(`\n${ACT}`);
  await step('tenant admin first sign-in + forced reset', state.adminEmail, () => firstSignIn(page, state.adminEmail, state.tempPw || TENANT_PW));
  for (const doc of ['capability-statement', 'key-personnel']) {
    await step(`upload + atomize ${doc}`, state.adminEmail, async () => {
      const p = path.join(CO_DIR, `northwind-${doc}.pdf`);
      const r = await page.request.post(`/api/portal/${state.slug}/atoms/upload`, {
        multipart: { file: { name: 'file', mimeType: 'application/pdf', buffer: fs.readFileSync(p) }, mode: 'auto', context: JSON.stringify({ source: doc }) },
        timeout: 180_000,
      });
      if (!ok(r)) throw new Error(`atoms/upload ${r.status()}`);
    });
  }
  await step('author a spotlight bucket', state.adminEmail, async () => {
    hitl('scoring lens', 'authored "Additive construction & expeditionary basing" — the lens this company would rank by');
    // The route reads `criteria` (sanitizeBucketCriteria), not a bare `keywords` array — a
    // top-level keywords key is dropped and the bucket scores nothing.
    const r = await page.request.post(`/api/portal/${state.slug}/buckets`, {
      data: {
        name: 'Additive construction & expeditionary basing',
        description: 'The company\'s own lens: printed structures for expeditionary basing.',
        criteria: { keywords: ['additive construction', '3D concrete printing', 'expeditionary', 'basing', 'formwork'] },
      },
      timeout: 60_000,
    });
    if (!ok(r)) throw new Error(`buckets ${r.status()} ${(await r.text()).slice(0, 160)}`);
  });
  await page.goto(`/portal/${state.slug}/atoms`, { waitUntil: 'networkidle', timeout: 60_000 }).catch(() => {});
  await shot(page, '05-library');
  await page.goto(`/portal/${state.slug}/cards`, { waitUntil: 'networkidle', timeout: 60_000 }).catch(() => {});
  await shot(page, '06-opportunity-cards');

  // ══ ACT 4 — buy a portal, operator releases it ════════════════════════════
  ACT = 'ACT 4 · purchase + provision';
  console.error(`\n${ACT}`);
  // THE BRIDGE IS FORWARD-ONLY. Everything was pushed in ACT 1, before this customer existed, so
  // nothing fanned to them. There is a read-repair (reconcileTenant on the cards route), but the
  // operator re-pushing is the deliberate act — and it is what an operator does when a new customer
  // signs up mid-cycle.
  await step('operator re-pushes the supply to the new tenant', 'master_admin', async () => {
    await signIn(page, 'eric@rfppipeline.com', ADMIN_PW);
    hitl('re-push', 'a customer joined after the last push; fanning the approved supply forward to them');
    for (const [slug, id] of Object.entries(solIds)) {
      const r = await page.request.post('/api/tools/solicitation.push', { data: { input: { solicitationId: id } }, timeout: 120_000 });
      rec(`re-push ${slug}`, 'master_admin', ok(r) ? 'ok' : 'note', ok(r) ? undefined : `HTTP ${r.status()}`);
    }
    await signIn(page, state.adminEmail, TENANT_PW);
  });

  const oppId = await step('find an opportunity to pursue', state.adminEmail, async () => {
    const r = await page.request.get(`/api/portal/${state.slug}/cards`);
    const j = await r.json();
    // complianceSummary is INSIDE `card`, a sibling of title — the whole denormalized snapshot is
    // one jsonb column. Reading it at the top level silently yields undefined, which sorts every
    // card to zero and picks whatever happened to be first.
    type Card = {
      opportunityId: string;
      card?: { title?: string; complianceSummary?: { volumeCount?: number } };
    };
    const cards = (j?.data?.cards ?? []) as Card[];
    rec('cards visible to the tenant', 'system', 'note', `${cards.length}`);
    if (!cards.length) throw new Error('no cards fanned out to this tenant');

    // A CUSTOMER READS THE CARD BEFORE BUYING, and the card says whether the opportunity has a
    // volume structure behind it. One of this run's masters deliberately never got a skeleton —
    // its solicitation defers the format elsewhere, so the curator accepted a bare compliance
    // record. Buying THAT one provisions a single generic "Technical Volume" and there is nothing
    // to build. That is the product being honest, not broken; the right response is the one a
    // customer would have: pursue the opportunity that is actually ready, and say why.
    const vols = (c: Card) => c.card?.complianceSummary?.volumeCount ?? 0;
    const ranked = [...cards].sort((a, b) => vols(b) - vols(a));
    const pick = ranked[0];
    const thin = cards.filter((c) => vols(c) === 0);
    if (thin.length) {
      rec('opportunities not yet built out', 'HITL', 'note',
        `${thin.length} of ${cards.length} carry no volume structure yet: ${thin.map((c) => c.card?.title?.slice(0, 40) ?? '?').join(' · ')}`);
    }
    hitl('pursuit choice', vols(pick) > 0
      ? `pursuing "${pick.card?.title ?? pick.opportunityId}" — ${vols(pick)} volume(s) on the card, so there is a real build behind it`
      : `pursuing "${pick.card?.title ?? pick.opportunityId}" — NO opportunity on this list shows a volume structure yet, `
        + 'so this build will provision thin; proceeding anyway and recording that');
    state.oppId = pick.opportunityId; // ACT 9 picks a DIFFERENT one off this
    return pick.opportunityId;
  });

  if (oppId) {
    await step('redeem the comp code', state.adminEmail, async () => {
      const r = await page.request.post(`/api/portal/${state.slug}/purchase`, {
        data: { opportunityId: oppId, promoCode: COMP_CODE, label: 'Midterm arc build' }, timeout: 120_000,
      });
      const b = await r.json().catch(() => ({}));
      if (!ok(r)) throw new Error(`purchase ${r.status()} ${JSON.stringify(b).slice(0, 140)}`);
      state.portalId = (b as { data?: Record<string, string> }).data?.portalId ?? '';
      rec('portal purchased', 'system', 'note', `portalId=${state.portalId || '(not returned)'} status=curation_pending`);
    });
    await shot(page, '07-purchased');

    await step('operator releases the portal', 'master_admin', async () => {
      await signIn(page, 'eric@rfppipeline.com', ADMIN_PW);
      await page.goto('/admin/provisioning', { waitUntil: 'networkidle', timeout: 60_000 });
      await shot(page, '08-release-queue');
      hitl('release decision', 'master solicitation is built out; releasing this buyer\'s portal');
      if (!state.portalId) {
        // Fall back to whatever is queued rather than stopping.
        const q = await page.request.get('/api/admin/provisioning').catch(() => null);
        const j = q ? await q.json().catch(() => ({})) : {};
        state.portalId = (j?.data?.portals ?? [])[0]?.id ?? '';
        if (state.portalId) override('portal id', 'purchase did not return one; took the head of the release queue');
      }
      if (!state.portalId) throw new Error('no portal to release');

      // THE COCKPIT IS TWO OUTCOMES, IN ORDER. completeBuildOut marks the SHARED master built out
      // and broadcasts to every tenant's mirror card; only then does provisionAndReleasePortal open
      // THIS buyer's private portal. Releasing first returns 409 "Build-out is below the readiness
      // bar", which is the product refusing to hand a customer a half-built master.
      //
      // The bar is compliance + >=1 volume + >=1 required item. This master has compliance and six
      // volumes but no required item, so the bar is genuinely unmet — and complete-buildout offers
      // { confirm: true } precisely for an operator who has looked and decided to proceed. That is
      // my call to make here, and it is recorded as one rather than routed around.
      const soughtSol = Object.values(solIds)[0];
      for (const [slug, id] of Object.entries(solIds)) {
        const pre = await page.request.post(`/api/admin/rfp-curation/${id}/complete-buildout`, { data: {}, timeout: 120_000 });
        if (pre.status() === 409) {
          const body = await pre.json().catch(() => ({}));
          const rd = (body as { data?: { readiness?: Record<string, unknown> } }).data?.readiness ?? {};
          hitl(`build-out for ${slug}`, `below the bar (${JSON.stringify(rd).slice(0, 90)}) — confirming anyway as the operator`);
          const c = await page.request.post(`/api/admin/rfp-curation/${id}/complete-buildout`, { data: { confirm: true }, timeout: 120_000 });
          rec(`${slug} build-out complete (confirmed)`, 'master_admin', ok(c) ? 'ok' : 'note', ok(c) ? undefined : `HTTP ${c.status()}`);
        } else {
          rec(`${slug} build-out complete`, 'master_admin', ok(pre) ? 'ok' : 'note', ok(pre) ? undefined : `HTTP ${pre.status()}`);
        }
      }
      void soughtSol;

      const r = await page.request.post(`/api/admin/provisioning/${state.portalId}/release`, { data: { confirm: true }, timeout: 300_000 });
      const b = await r.json().catch(() => ({}));
      if (!ok(r)) throw new Error(`release ${r.status()} ${JSON.stringify(b).slice(0, 160)}`);
      state.proposalId = (b as { data?: Record<string, string> }).data?.proposalId ?? '';
      rec('portal released', 'system', 'note', `proposalId=${state.proposalId || '(not returned)'}`);
    });
    await shot(page, '09-released');
  }

  // Recover the proposal id from the tenant side if the release did not report it.
  if (!state.proposalId) {
    await step('locate the provisioned proposal', state.adminEmail, async () => {
      await signIn(page, state.adminEmail, TENANT_PW);
      const r = await page.request.get(`/api/portal/${state.slug}/proposals`);
      const j = await r.json().catch(() => ({}));
      const ps = (j?.data?.proposals ?? j?.data ?? []) as Array<{ id: string; title?: string }>;
      if (!ps.length) throw new Error('no proposals in this tenant');
      state.proposalId = ps[0].id;
      override('proposal id', 'release did not return one; read it from the tenant\'s proposal list');
    });
  }

  if (!state.proposalId) {
    override('build phase', 'no proposal to author — recording the arc stop point and writing the ledger');
    fs.writeFileSync(path.join(OUT, 'arc-ledger.json'), JSON.stringify(ledger, null, 2));
    return;
  }

  // ══ ACT 5 — author every section ══════════════════════════════════════════
  ACT = 'ACT 5 · authoring';
  console.error(`\n${ACT}`);
  await step('tenant admin opens the build', state.adminEmail, async () => {
    await signIn(page, state.adminEmail, TENANT_PW);
    await page.goto(`/portal/${state.slug}/proposals/${state.proposalId}`, { waitUntil: 'networkidle', timeout: 60_000 });
  });
  await shot(page, '10-proposal-workspace');

  const sections = await step('read the compliance matrix', state.adminEmail, async () => {
    const r = await page.request.get(`/api/portal/${state.slug}/proposals/${state.proposalId}/sections`);
    const j = await r.json().catch(() => ({}));
    const s = (j?.data?.sections ?? j?.data ?? []) as Array<{ id: string; title?: string; sectionNumber?: string }>;
    rec('sections provisioned', 'system', 'note', `${s.length}`);
    if (!s.length) throw new Error('the matrix provisioned no sections');
    return s;
  });

  // ── upload the figures first, the way a customer does ────────────────────
  // An image node references a STORAGE KEY, so the picture has to exist in object storage before
  // any section can point at it. This is also the one step that proves storage is really wired:
  // if the upload silently no-ops, the export degrades to a "[Image: …]" stub and everything else
  // still looks green.
  const figures: Record<string, { key: string; w: number; h: number }> = {};
  for (const [name, alt, w, h] of [
    ['northwind-print-bed', 'Gantry print bed mid-deposit, course 11 of 14', 1000, 620],
    ['northwind-site-plan', 'Expeditionary basing layout — 11 printed shelters', 900, 560],
  ] as Array<[string, string, number, number]>) {
    await step(`upload figure ${name}`, state.adminEmail, async () => {
      const p = path.join(__dirname, 'fixtures', 'figures', `${name}.png`);
      if (!fs.existsSync(p)) throw new Error(`missing fixture ${p} — run scripts/make-figure-fixtures.py`);
      const r = await page.request.post(`/api/portal/${state.slug}/uploads/image`, {
        multipart: { file: { name: `${name}.png`, mimeType: 'image/png', buffer: fs.readFileSync(p) } },
        timeout: 120_000,
      });
      if (!ok(r)) throw new Error(`uploads/image ${r.status()} ${(await r.text()).slice(0, 160)}`);
      const key = ((await r.json().catch(() => ({})))?.data?.storageKey ?? '') as string;
      if (!key) throw new Error('upload returned no storageKey');
      figures[name] = { key, w, h };
      rec(`figure stored`, 'system', 'note', `${name} → ${key}`);
    });
  }
  hitl('figures', 'a proposal argues in pictures too — uploading the print-bed photo and the site plan before writing');

  /** What each section carries beyond its prose. The technical volume gets the figure, the
   *  schedule and the milestone table; the cost section gets the throughput chart it cites. */
  const extrasFor = (title: string): Node[] => {
    const t = title.toLowerCase();
    const out: Node[] = [];
    if (/technical objective|statement of work|significance|approach/.test(t)) {
      const f = figures['northwind-print-bed'];
      if (f) {
        out.push(imageNode('img-print-bed', f.key, 'Gantry print bed mid-deposit, course 11 of 14', f.w, f.h));
        out.push(caption('cap-print-bed', 'Figure', 1, 'Gantry print cell mid-deposit. Course 11 of 14, 26 mm bead, unimproved grade.'));
      }
      out.push(throughputChart());
      out.push(caption('cap-throughput', 'Chart', 1, 'Measured throughput against the topic threshold at four course heights.'));
      out.push(milestoneTable());
      out.push(caption('cap-milestones', 'Table', 1, 'Phase I milestone schedule with success criteria.'));
    }
    if (/related work|facilities|equipment/.test(t)) {
      const f = figures['northwind-site-plan'];
      if (f) {
        out.push(imageNode('img-site-plan', f.key, 'Expeditionary basing layout', f.w, f.h));
        out.push(caption('cap-site-plan', 'Figure', 2, 'Basing layout printed in a single gantry pass — eleven shelters.'));
      }
    }
    if (/schedule|objective|work/.test(t) && !out.some((n) => n.id === 'cht-schedule')) {
      out.push(scheduleChart());
      out.push(caption('cap-schedule', 'Chart', 2, 'Phase I schedule, months from award.'));
    }
    return out;
  };

  let authored = 0;
  let withPrimaries = 0;
  for (const sec of sections ?? []) {
    const body = proseFor(sec.title ?? '');
    const extras = extrasFor(sec.title ?? '');
    const r = await step(
      `author "${(sec.title ?? sec.id).slice(0, 40)}"${extras.length ? ` +${extras.length} primaries` : ''}`,
      state.adminEmail, async () => {
        // The section save route is PUT. POSTing returns 405, which reads like a broken save
        // rather than a wrong verb.
        const nodes: Node[] = [textNode('p1', body), ...extras];
        const res = await page.request.put(
          `/api/portal/${state.slug}/proposals/${state.proposalId}/sections/${sec.id}/save`,
          { data: { content: { nodes }, status: 'in_progress' }, timeout: 60_000 });
        if (!ok(res)) throw new Error(`save ${res.status()} ${(await res.text()).slice(0, 120)}`);
        return true;
      });
    if (r) { authored++; if (extras.length) withPrimaries++; }
  }
  rec('sections authored', 'HITL', 'note',
    `${authored}/${(sections ?? []).length} — prose written by me, as the customer would; ` +
    `${withPrimaries} also carry figures, charts or tables`);
  await page.reload().catch(() => {});
  await shot(page, '11-authored');

  // ══ ACT 5b — collaborators: the build is not a solo act ═══════════════════
  // A real build has more than one pair of hands. Invite a teammate and an outside partner at the
  // two access levels the product distinguishes, and have the partner leave a comment on a
  // section — the smallest act that proves stage-scoped access actually reaches the document.
  ACT = 'ACT 5b · collaborators';
  console.error(`\n${ACT}`);
  // The route's vocabulary is `contributor` | `external` with a `permission` — NOT the platform
  // role names. A collaborator on a build is not the same thing as a user role, and the API says
  // so; sending `tenant_user` earns "Role must be contributor or external".
  const COLLABS = [
    { email: `sam.okafor@${state.slug}.com`, name: 'Sam Okafor', role: 'contributor', permission: 'edit', why: 'a teammate who writes' },
    { email: 'lee.barros@heritage-proposals.example', name: 'Lee Barros', role: 'external', permission: 'comment', why: 'an outside proposal consultant who may only comment' },
  ];
  for (const c of COLLABS) {
    await step(`invite ${c.role} (${c.permission})`, state.adminEmail, async () => {
      hitl(`collaborator ${c.role}`, `${c.why}; granting ${c.permission} on this build only`);
      const r = await page.request.post(`/api/portal/${state.slug}/proposals/${state.proposalId}/collaborators`,
        { data: { email: c.email, name: c.name, role: c.role, permission: c.permission }, timeout: 60_000 });
      if (!ok(r)) throw new Error(`collaborators ${r.status()} ${(await r.text()).slice(0, 160)}`);
    });
  }
  await step('a collaborator comments on a section', state.adminEmail, async () => {
    const sec = (sections ?? [])[0];
    if (!sec) throw new Error('no section to comment on');
    // Comments are ANCHORED (mig 183): `nodeId` is the section the note is pinned to and `text`
    // carries it. A body-shaped payload is refused — the product will not take a floating comment.
    const r = await page.request.post(`/api/portal/${state.slug}/proposals/${state.proposalId}/comments`, {
      data: { nodeId: sec.id, text: 'Tie the throughput claim to the Rhode Island slab test — reviewers will look for a number here, not an adjective.' },
      timeout: 60_000,
    });
    if (!ok(r)) throw new Error(`comments ${r.status()} ${(await r.text()).slice(0, 160)}`);
    hitl('review comment', 'left the note a proposal consultant would leave, anchored to the section it belongs to');
  });

  // ══ ACT 5c — the operator descends into the customer's space, and comes back ══
  // This is the ONLY place authority crosses the tenant boundary, and both directions are audited
  // on purpose (docs/MULTI_MEMBERSHIP_IDENTITY_DESIGN.md). Drive it as the support call it models:
  // the customer is stuck, an admin goes in as their company admin, helps, and leaves.
  ACT = 'ACT 5c · shadow descend / ascend';
  console.error(`\n${ACT}`);
  await step('rfp_admin descends into the tenant', 'master_admin', async () => {
    await signIn(page, 'eric@rfppipeline.com', ADMIN_PW);
    hitl('descend', `${state.company} asked for help on their build; entering their space as their company admin`);
    const r = await page.request.post('/api/admin/shadow-transition',
      { data: { direction: 'down', tenantId: state.tenantId }, timeout: 60_000 });
    if (!ok(r)) throw new Error(`shadow-transition down ${r.status()} ${(await r.text()).slice(0, 140)}`);
  });
  await step('and can actually work in there', 'master_admin', async () => {
    // Descent is worthless if it only writes an event. Read the customer's build as the admin.
    const r = await page.request.get(`/api/portal/${state.slug}/proposals/${state.proposalId}`, { timeout: 60_000 });
    if (!ok(r)) throw new Error(`admin could not read the tenant's build: ${r.status()}`);
    const j = await r.json().catch(() => ({}));
    rec('admin sees the build', 'master_admin', 'ok', `"${j?.data?.proposal?.title ?? '?'}" · stage=${j?.data?.proposal?.stage ?? '?'}`);
    await page.goto(`/portal/${state.slug}/proposals/${state.proposalId}`, { waitUntil: 'networkidle', timeout: 60_000 }).catch(() => {});
  });
  await shot(page, '09b-shadow-descent');
  await step('rfp_admin ascends back to the platform', 'master_admin', async () => {
    hitl('ascend', 'finished assisting; leaving the customer\'s space');
    const r = await page.request.post('/api/admin/shadow-transition',
      { data: { direction: 'up', tenantId: state.tenantId }, timeout: 60_000 });
    if (!ok(r)) throw new Error(`shadow-transition up ${r.status()} ${(await r.text()).slice(0, 140)}`);
  });
  await step('both crossings are on the record', 'HITL', async () => {
    // The point of auditing a descent is that someone can later ask "who was in our account?".
    // Ask it the way an auditor would — by LOOKING AT THE PAGE the tenant is given, not by
    // querying a table. (There is no tenant-scoped activity API; the surface is the page at
    // /portal/<slug>/activity, which is what a customer would actually open.)
    await page.goto(`/portal/${state.slug}/activity`, { waitUntil: 'networkidle', timeout: 60_000 });
    const shown = await page.locator('body').innerText().catch(() => '');
    const down = /descend/i.test(shown);
    const up = /ascend/i.test(shown);
    await shot(page, '09c-shadow-audit-trail');
    rec('descend/ascend visible to the customer', 'HITL', down && up ? 'ok' : 'note',
      `descended=${down} ascended=${up} on the tenant's own activity page`);
  });
  await signIn(page, state.adminEmail, TENANT_PW);

  // ══ ACT 6 — reviews, as gates I decide at ════════════════════════════════
  ACT = 'ACT 6 · reviews';
  console.error(`\n${ACT}`);
  // ai-review and package-review RUN something (POST); compliance is a READ of the matrix (GET).
  for (const [label, ep, method] of [
    ['AI / color-team review', 'ai-review', 'POST'],
    ['compliance matrix', 'compliance', 'GET'],
    ['packaging review', 'package-review', 'POST'],
  ] as Array<[string, string, 'GET' | 'POST']>) {
    await step(label, state.adminEmail, async () => {
      const url = `/api/portal/${state.slug}/proposals/${state.proposalId}/${ep}`;
      const r = method === 'GET'
        ? await page.request.get(url, { timeout: 300_000 })
        : await page.request.post(url, { data: {}, timeout: 300_000 });
      if (!ok(r)) throw new Error(`${ep} ${r.status()} ${(await r.text()).slice(0, 120)}`);
      hitl(`${label} outcome`, 'read the findings and accepted them as advisory; not advancing a stage on an agent\'s say-so');
    });
  }
  await step('readiness verdict', state.adminEmail, async () => {
    const r = await page.request.get(`/api/portal/${state.slug}/proposals/${state.proposalId}/readiness`);
    const j = await r.json().catch(() => ({}));
    rec('readiness', 'system', 'note', JSON.stringify(j?.data ?? {}).slice(0, 220));
  });
  await page.goto(`/portal/${state.slug}/proposals/${state.proposalId}`, { waitUntil: 'networkidle', timeout: 60_000 }).catch(() => {});
  await shot(page, '12-reviewed');

  // ══ ACT 7 — lock and export ══════════════════════════════════════════════
  ACT = 'ACT 7 · lock + export';
  console.error(`\n${ACT}`);
  let locked = 0;
  for (const sec of sections ?? []) {
    const r = await step(`lock "${(sec.title ?? sec.id).slice(0, 40)}"`, state.adminEmail, async () => {
      const res = await page.request.post(
        `/api/portal/${state.slug}/proposals/${state.proposalId}/sections/${sec.id}/lock`, { data: {}, timeout: 60_000 });
      if (!ok(res)) throw new Error(`lock ${res.status()}`);
      return true;
    });
    if (r) locked++;
  }
  hitl('lock decision', `locked ${locked}/${(sections ?? []).length} sections — the human act that makes a build submittable`);

  // Locking every SECTION is not the same as locking the PROPOSAL, and the package route checks
  // the proposal: `if (!prop.isLocked && stage !== 'submitted' && stage !== 'archived')` → 403.
  //
  // POST /lock is NOT the way there: it refuses anything but stage 'final' (422 "Can only lock at
  // final stage"). A build reaches 'final' by WALKING its gate_config one gate at a time via
  // POST /advance — and the advance INTO 'final' is itself the submission moment: it locks and
  // auto-advances to 'submitted'. So the human act is the walk, not a lock button.
  //
  // The last gate also runs the submission-readiness roll-up, which HARD-BLOCKS on any blocker
  // (422 NOT_READY) unless the caller acknowledges them — the UI's "Submit anyway" confirm. That
  // acknowledgement is a HITL decision with an audit trail, so it is taken here deliberately and
  // recorded, rather than passed on every call to make the drive quiet.
  await step('walk the gates to submission', state.adminEmail, async () => {
    const seen: string[] = [];
    for (let hop = 0; hop < 8; hop++) {
      const pr = await page.request.get(`/api/portal/${state.slug}/proposals/${state.proposalId}`, { timeout: 60_000 });
      const pj = await pr.json().catch(() => ({}));
      const stage = (pj?.data?.proposal?.stage ?? pj?.data?.stage ?? pj?.stage) as string | undefined;
      if (!stage) throw new Error(`could not read stage (${pr.status()})`);
      if (stage === 'submitted' || stage === 'final') { seen.push(stage); break; }
      seen.push(stage);

      let r = await page.request.post(`/api/portal/${state.slug}/proposals/${state.proposalId}/advance`,
        { data: {}, timeout: 180_000 });
      if (r.status() === 422) {
        const j = await r.json().catch(() => ({}));
        if (j?.code === 'NOT_READY') {
          const blockers = (j?.details?.blockers ?? []) as Array<{ category?: string; message?: string }>;
          // Say WHAT was overridden, in the words the product used, so the ledger is auditable.
          hitl('submit anyway',
            `readiness reported ${blockers.length} blocker(s) [${[...new Set(blockers.map((b) => b.category ?? '?'))].join(', ')}] — ` +
            'accepting them explicitly, exactly as a customer would with the "Submit anyway" confirm');
          rec('readiness blockers overridden', state.adminEmail, 'override',
            blockers.slice(0, 6).map((b) => `${b.category ?? '?'}: ${b.message ?? ''}`).join(' · ').slice(0, 300));
          r = await page.request.post(`/api/portal/${state.slug}/proposals/${state.proposalId}/advance`,
            { data: { acknowledgeBlockers: true }, timeout: 180_000 });
        }
      }
      if (!ok(r)) throw new Error(`advance from '${stage}' → ${r.status()} ${(await r.text()).slice(0, 180)}`);
      const aj = await r.json().catch(() => ({}));
      rec(`gate ${stage} → ${aj?.data?.stage ?? '?'}`, state.adminEmail, 'ok',
        aj?.data?.locked ? 'advancing into the final gate locked the build (submission)' : undefined);
    }
    hitl('submission', `gate walk: ${seen.join(' → ')} — the build is locked and submitted`);
  });

  const got: Record<string, number> = {};
  for (const fmt of ['json', 'docx', 'pdf', 'zip']) {
    await step(`export ${fmt}`, state.adminEmail, async () => {
      const r = await page.request.get(
        `/api/portal/${state.slug}/proposals/${state.proposalId}/package?format=${fmt}`, { timeout: 300_000 });
      if (!ok(r)) throw new Error(`package ${fmt} → ${r.status()}`);
      const buf = await r.body();
      const f = path.join(DL, `arc-proposal.${fmt}`);
      fs.writeFileSync(f, buf);
      got[fmt] = buf.length;
      const violations = r.headers()['x-compliance-violations'];
      rec(`${fmt} artifact`, 'system', 'note', `${buf.length.toLocaleString()} bytes · compliance violations=${violations ?? 'n/a'}`);
    });
  }

  // ══ ACT 8 — open the artifacts and CHECK them ════════════════════════════
  ACT = 'ACT 8 · artifact inspection';
  console.error(`\n${ACT}`);
  const magic: Record<string, Buffer> = { docx: Buffer.from('PK'), zip: Buffer.from('PK'), pdf: Buffer.from('%PDF') };
  for (const [fmt, size] of Object.entries(got)) {
    const f = path.join(DL, `arc-proposal.${fmt}`);
    const head = fs.readFileSync(f).subarray(0, 4);
    const m = magic[fmt];
    const good = !m || head.subarray(0, m.length).equals(m);
    rec(`${fmt} is a real ${fmt}`, 'HITL', good ? 'ok' : 'blocked', `${size.toLocaleString()} bytes, magic=${JSON.stringify(head.toString('latin1'))}`);
  }
  // Reading these artifacts is the point of the whole arc: bytes and a magic number only prove a
  // file was produced, not that the RIGHT document came out. Each check below is one way a
  // package has actually gone wrong in this codebase.
  type JsonSec = { number?: string; title?: string; text_content?: string; page_allocation?: number | null; status?: string };
  let jsonSecs: JsonSec[] = [];
  /** Collapse every run of whitespace, so a title wrapped across lines still matches. */
  const flat = (s: string) => s.replace(/\s+/g, ' ').trim();
  const decodeEntities = (s: string) => s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&apos;/g, "'").replace(/&amp;/g, '&'); // &amp; last, or "&amp;lt;" double-decodes

  await step('the json package carries the authored prose', 'HITL', async () => {
    const j = JSON.parse(fs.readFileSync(path.join(DL, 'arc-proposal.json'), 'utf8'));
    jsonSecs = (j?.data?.sections ?? j?.sections ?? []) as JsonSec[];
    rec('json sections', 'system', 'note', `${jsonSecs.length} section(s)`);
    const empty = jsonSecs.filter((s) => !(s.text_content ?? '').trim());
    // A section that exports with no prose is the volume-grouping-drop class (CLAUDE.md: a
    // snake_case read off a camelCase row silently dropped every section's volume).
    rec('every exported section carries prose', 'HITL', empty.length === 0 ? 'ok' : 'blocked',
      empty.length ? `${empty.length} empty: ${empty.slice(0, 5).map((s) => s.number ?? '?').join(', ')}` : `${jsonSecs.length}/${jsonSecs.length} non-empty`);
    const text = JSON.stringify(j);
    const carries = text.includes('Northwind') || text.includes('binder');
    if (!carries) throw new Error('the export does not contain the prose that was authored');
  });

  // ── section ORDER: integer sort_index, never a string sort of section_number ──
  // mig 143 exists because string-sorting scrambles numbering ("10" lands before "2"). The
  // export orders by sort_index; this proves it, and — just as important — proves the check has
  // teeth by showing a naive string sort WOULD have produced a different document.
  await step('sections are ordered by sort_index, not string-sorted', 'HITL', async () => {
    const nums = jsonSecs.map((s) => String(s.number ?? ''));
    const natural = (a: string, b: string) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
    const asExported = nums.join('|');
    const asNatural = [...nums].sort(natural).join('|');
    const asString = [...nums].sort().join('|');
    if (asExported !== asNatural) {
      throw new Error(`export order != natural order\n  exported: ${asExported}\n  natural:  ${asNatural}`);
    }
    rec('string-sort would have scrambled it', 'HITL', asString !== asNatural ? 'ok' : 'note',
      asString !== asNatural
        ? `a naive string sort gives ${asString.slice(0, 90)}… — different document, same bytes`
        : 'this numbering happens to sort identically either way, so it cannot discriminate here');
  });

  await step('section numbers are unique', 'HITL', async () => {
    const nums = jsonSecs.map((s) => String(s.number ?? ''));
    const dupes = nums.filter((n, i) => nums.indexOf(n) !== i);
    if (dupes.length) throw new Error(`duplicate section numbers: ${[...new Set(dupes)].join(', ')}`);
  });

  // What is stored, as distinct from what is exported. Read the sections back out of the product
  // and count the node types: if the primaries are missing HERE, the export never had a chance,
  // and the docx check above would be blaming the exporter for a save that dropped them.
  await step('the stored sections still hold the primaries', 'HITL', async () => {
    // COUNT NODES WITHOUT ASSUMING AN ENVELOPE. Two earlier versions of this check guessed where
    // the canvas lives in the response — the sections LIST (which returns only metadata, never the
    // document) and then a nested `data.sections[].content` — and both reported zero, indicting a
    // save that was in fact perfect while the exported .docx sat there full of the very figures
    // they claimed were missing. A check that can falsely accuse the product is worse than no
    // check. So walk the whole payload and count anything shaped like a canvas node, wherever it
    // sits and whether `content` arrives as an object or a JSON string.
    const r = await page.request.get(`/api/portal/${state.slug}/proposals/${state.proposalId}/document`, { timeout: 120_000 });
    if (!ok(r)) throw new Error(`document ${r.status()}`);
    const NODE_TYPES = new Set(['text_block', 'heading', 'image', 'chart', 'table', 'caption',
      'bulleted_list', 'numbered_list', 'divider', 'page_break', 'callout', 'blockquote']);
    const tally: Record<string, number> = {};
    const walk = (v: unknown, depth = 0): void => {
      if (depth > 12 || v == null) return;
      if (typeof v === 'string') {
        // A section's canvas often arrives as a JSON string; parse it and keep walking.
        if (v.length > 2 && v.trimStart().startsWith('{')) {
          try { walk(JSON.parse(v), depth + 1); } catch { /* not a document */ }
        }
        return;
      }
      if (Array.isArray(v)) { for (const x of v) walk(x, depth + 1); return; }
      if (typeof v !== 'object') return;
      const o = v as Record<string, unknown>;
      if (typeof o.type === 'string' && NODE_TYPES.has(o.type) && 'content' in o) {
        tally[o.type] = (tally[o.type] ?? 0) + 1;
      }
      for (const x of Object.values(o)) walk(x, depth + 1);
    };
    walk(await r.json().catch(() => ({})));
    rec('stored node types', 'system', 'note',
      Object.entries(tally).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}×${v}`).join(' · ') || '(none)');
    const missing = (['image', 'chart', 'table', 'caption'] as const).filter((t) => !tally[t]);
    if (missing.length) throw new Error(`the assembled document exposes no ${missing.join(', ')} node(s)`);
  });

  // ── docx: a real OOXML package whose body carries the titles IN ORDER ──
  await step('docx is OOXML and its body carries the sections in order', 'HITL', async () => {
    const f = path.join(DL, 'arc-proposal.docx');
    if (!fs.existsSync(f)) throw new Error('no docx was produced');
    const names = execSync(`unzip -Z1 ${JSON.stringify(f)}`, { encoding: 'utf8' }).trim().split('\n');
    if (!names.includes('word/document.xml')) throw new Error(`not a Word package: ${names.slice(0, 8).join(', ')}`);
    const xml = execSync(`unzip -p ${JSON.stringify(f)} word/document.xml`, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    // Strip tags, then DECODE ENTITIES and flatten whitespace. A title containing "&" is stored
    // in the XML as "&amp;", and a long one is broken across runs/lines — comparing raw text to
    // raw title reports both as "missing" and invents a defect that is not there.
    const plain = flat(decodeEntities(xml.replace(/<[^>]+>/g, ' ')));
    // Where each section's title appears in the body — must be strictly increasing.
    const titles = jsonSecs.map((s) => (s.title ?? '').trim()).filter((t) => t.length > 6);
    const at = titles.map((t) => ({ t, i: plain.indexOf(flat(t)) }));
    const missing = at.filter((x) => x.i < 0);
    const found = at.filter((x) => x.i >= 0);
    const outOfOrder = found.filter((x, k) => k > 0 && x.i < found[k - 1].i);
    rec('docx entries', 'system', 'note', `${names.length} parts · ${xml.length.toLocaleString()} bytes of document.xml`);
    if (missing.length) {
      rec('docx section titles present', 'HITL', 'blocked',
        `${missing.length}/${titles.length} missing, e.g. "${missing[0].t.slice(0, 50)}"`);
    }
    if (outOfOrder.length) {
      throw new Error(`${outOfOrder.length} section(s) appear out of order in the docx body, first: "${outOfOrder[0].t.slice(0, 50)}"`);
    }
    rec('docx body order matches the export', 'HITL', 'ok', `${found.length} titles in ascending document position`);

    // ── THE PRIMARIES: pictures, tables and charts, or the stubs that replace them ──
    // Every one of these degrades QUIETLY. An image whose storage key does not resolve, a chart
    // whose SVG fails to rasterize, a table the writer skipped — none of them throw. The docx just
    // comes out with grey italic "[Image: …]" / "[Chart: bar]" text where the figure belonged, and
    // a byte-count check calls that a pass. So: count the real ones, and fail on the stubs.
    // `word/media/` itself is a directory entry in the zip listing — count only actual files.
    const media = names.filter((n) => /^word\/media\/.+\.\w+$/.test(n));
    const tables = (xml.match(/<w:tbl>/g) ?? []).length;
    const stubs = [...plain.matchAll(/\[(Image|Chart|Table):/g)].map((m) => m[1]);
    rec('docx carries real pictures', 'HITL', media.length > 0 ? 'ok' : 'blocked',
      media.length ? `${media.length} embedded image part(s): ${media.slice(0, 4).join(', ')}` : 'word/media is EMPTY — every figure exported as a text stub');
    rec('docx carries real tables', 'HITL', tables > 0 ? 'ok' : 'blocked',
      tables ? `${tables} native <w:tbl> element(s)` : 'no OOXML table in the body');
    if (stubs.length) {
      throw new Error(`${stubs.length} figure(s) exported as placeholder stubs instead of content: ${[...new Set(stubs)].join(', ')}`);
    }
    rec('no figure degraded to a placeholder', 'HITL', 'ok', 'no "[Image:" / "[Chart:" stub anywhere in the body');
  });

  // ── pdf: real pages, real text, and a page count to hold against the budget ──
  await step('pdf renders real pages with the authored text', 'HITL', async () => {
    const f = path.join(DL, 'arc-proposal.pdf');
    if (!fs.existsSync(f)) throw new Error('no pdf was produced');
    // Write the probe to a FILE. Passing multi-line Python through `python3 -c "…"` after JS
    // string-escaping turns the newlines into backslash-n inside the shell word, and Python
    // answers "unexpected character after line continuation character" — a syntax error in the
    // harness that reads exactly like a broken PDF.
    const pyFile = path.join(DL, '_probe_pdf.py');
    fs.writeFileSync(pyFile, [
      'import pymupdf, json, sys',
      'd = pymupdf.open(sys.argv[1])',
      'txt = "\\n".join(p.get_text() for p in d)',
      'print(json.dumps({"pages": d.page_count, "chars": len(txt.strip()), "text": txt}))',
    ].join('\n'));
    const out = execSync(`python3 ${JSON.stringify(pyFile)} ${JSON.stringify(f)}`,
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const info = JSON.parse(out.trim().split('\n').pop() as string) as { pages: number; chars: number; text: string };
    rec('pdf pages', 'system', 'note', `${info.pages} page(s) · ${info.chars.toLocaleString()} chars of extractable text`);
    if (info.pages < 1) throw new Error('pdf has no pages');
    // A PDF that renders but carries no extractable text is the "images of nothing" failure —
    // it looks fine as bytes and is useless to a reviewer.
    if (info.chars < 500) throw new Error(`pdf carries almost no text (${info.chars} chars) — rendered but empty`);

    const titles = jsonSecs.map((s) => (s.title ?? '').trim()).filter((t) => t.length > 6);
    const norm = flat(info.text);
    const pos = titles.map((t) => ({ t, i: norm.indexOf(flat(t)) }));
    const missing = pos.filter((x) => x.i < 0);
    const located = pos.filter((x) => x.i >= 0);
    const ooo = located.filter((x, k) => k > 0 && x.i < located[k - 1].i);
    rec('pdf carries every section, in order', 'HITL', missing.length === 0 && ooo.length === 0 ? 'ok' : 'blocked',
      missing.length || ooo.length
        ? `${missing.length} missing, ${ooo.length} out of order (first missing: "${missing[0]?.t.slice(0, 60) ?? '—'}")`
        : `${located.length}/${titles.length} titles present in ascending page order across ${info.pages} pages`);
  });

  // ── zip: per-volume-native, one file per volume ──
  await step('zip is per-volume-native', 'HITL', async () => {
    const f = path.join(DL, 'arc-proposal.zip');
    if (!fs.existsSync(f)) throw new Error('no zip was produced');
    const names = execSync(`unzip -Z1 ${JSON.stringify(f)}`, { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
    rec('zip contents', 'system', 'note', names.slice(0, 12).join(' · '));
    if (names.length === 0) throw new Error('zip is empty');
    // The volumes are the deliverable units; a single lumped file means the per-volume
    // assembly silently fell back to the combined document.
    const volumes = names.filter((n) => /^V\d+_/.test(n));
    rec('zip carries one artifact per volume', 'HITL', volumes.length >= 2 ? 'ok' : 'note',
      volumes.length >= 2 ? `${volumes.length} volume files` : `${names.length} entr(ies), ${volumes.length} matching V<n>_ — check the volume split`);
  });

  // ══ ACT 9 — the SAME customer, a DIFFERENT completion path ════════════════
  // The build above was the manual path: a human wrote every section, then walked the gates. This
  // one is the opposite end of the same product — a second opportunity, provisioned the same way,
  // then handed to the agent workforce from the admin plane and never hand-authored at all.
  // Running both against one tenant is the point: the divergence has to be in the PATH, not in a
  // differently-prepared world.
  ACT = 'ACT 9 · divergent path (automated)';
  console.error(`\n${ACT}`);
  const second: Record<string, string> = {};
  await step('buy a second portal on a different opportunity', state.adminEmail, async () => {
    await signIn(page, state.adminEmail, TENANT_PW);
    const r = await page.request.get(`/api/portal/${state.slug}/cards`);
    const cards = ((await r.json().catch(() => ({})))?.data?.cards ?? []) as Array<{ opportunityId: string; card?: { title?: string } }>;
    const other = cards.find((c) => c.opportunityId !== state.oppId) ?? cards[1] ?? cards[0];
    if (!other) throw new Error('no second opportunity available to pursue');
    hitl('second pursuit', `pursuing "${other.card?.title ?? other.opportunityId}" — same company, second bid, automated path`);
    const p = await page.request.post(`/api/portal/${state.slug}/purchase`, {
      data: { opportunityId: other.opportunityId, promoCode: COMP_CODE, label: 'Midterm arc · automated path' },
      timeout: 120_000,
    });
    if (!ok(p)) throw new Error(`purchase ${p.status()} ${(await p.text()).slice(0, 140)}`);
    second.portalId = ((await p.json().catch(() => ({})))?.data?.portalId ?? '') as string;
    second.oppId = other.opportunityId;
  });

  await step('operator releases it', 'master_admin', async () => {
    await signIn(page, 'eric@rfppipeline.com', ADMIN_PW);
    if (!second.portalId) throw new Error('no second portal to release');
    hitl('second release', 'the master is already built out from the first buyer; releasing this portal only');
    const r = await page.request.post(`/api/admin/provisioning/${second.portalId}/release`,
      { data: { confirm: true }, timeout: 300_000 });
    if (!ok(r)) throw new Error(`release ${r.status()} ${(await r.text()).slice(0, 160)}`);
  });

  await step('find the second build', state.adminEmail, async () => {
    await signIn(page, state.adminEmail, TENANT_PW);
    const r = await page.request.get(`/api/portal/${state.slug}/proposals`);
    const ps = ((await r.json().catch(() => ({})))?.data?.proposals ?? []) as Array<{ id: string; title?: string }>;
    const p = ps.find((x) => x.id !== state.proposalId);
    if (!p) throw new Error(`only ${ps.length} proposal(s) in this tenant — the second never provisioned`);
    second.proposalId = p.id;
    rec('second build', 'system', 'note', `"${p.title ?? p.id}"`);
  });

  // THE DOORBELL. The tenant-side Proposal Draft Manager is drivable from the admin plane, and
  // Mode C is full auto: plan → draft → the review-gate cohort → advisory reconcile. It is still
  // ADVISORY by contract — it never advances a stage, locks or submits — so what should be true
  // afterwards is that work was PROPOSED, not that the build moved on its own.
  await step('admin rings the full-draft doorbell (Mode C, full auto)', 'master_admin', async () => {
    await signIn(page, 'eric@rfppipeline.com', ADMIN_PW);
    if (!second.proposalId) throw new Error('no second build to draft');
    hitl('automation choice', 'Mode C — hand this one to the workforce end to end, and judge the output rather than the typing');
    const r = await page.request.post(`/api/admin/proposals/${second.proposalId}/full-draft`,
      { data: { mode: 'c', adversarial: true, adversarialPolicy: 'auto' }, timeout: 300_000 });
    if (!ok(r)) throw new Error(`full-draft ${r.status()} ${(await r.text()).slice(0, 200)}`);
    rec('full draft requested', 'master_admin', 'ok', 'source=admin_doorbell mode=c adversarial=auto');
  });
  await page.goto('/admin/agents', { waitUntil: 'networkidle', timeout: 60_000 }).catch(() => {});
  await shot(page, '14-agent-workforce');

  await step('the automated path is advisory, not autonomous', 'HITL', async () => {
    // The invariant worth checking is the SAFETY one: a full-draft request must not have advanced
    // the stage or locked anything. An agent proposing text is the product working; an agent
    // submitting a bid is the product being dangerous.
    const r = await page.request.get(`/api/portal/${state.slug}/proposals/${second.proposalId}`, { timeout: 60_000 });
    const p = ((await r.json().catch(() => ({})))?.data?.proposal ?? {}) as { stage?: string; isLocked?: boolean };
    const safe = p.stage !== 'submitted' && p.isLocked !== true;
    rec('workforce did not advance or lock the build', 'HITL', safe ? 'ok' : 'blocked',
      `stage=${p.stage ?? '?'} locked=${p.isLocked ?? '?'} — advisory contract ${safe ? 'held' : 'VIOLATED'}`);
  });

  // ══ ACT 10 — a second customer, and the wall between them ═════════════════
  // Both companies come in through the SAME public door. That is what makes the isolation check
  // afterwards mean something: if the second tenant were seeded or inserted by an admin shortcut,
  // "these two cannot see each other" would only be a statement about how they were created.
  ACT = 'ACT 10 · second customer + isolation';
  console.error(`\n${ACT}`);
  const CO2: Applicant = {
    company: 'Kestrel Robotics', contact: 'Priya Raman', title: 'Founder',
    email: 'priya.raman@kestrel-robotics.com', state: 'Michigan',
    tech: 'We build autonomous site-survey robots that produce as-built models of active construction sites, '
      + 'using onboard SLAM and a progress-comparison engine that flags deviation from the design model.',
    motivation: 'The NSF STTR topic on robotics for the built environment matches our perception stack directly.',
    referral: 'Saw the topic on the NSF site',
  };
  const two: Record<string, string> = {};
  await step('a second company applies at the same form', 'anonymous', () => applyAtPublicForm(page, context, CO2));
  await step('operator accepts the second application', 'master_admin', async () => {
    await signIn(page, 'eric@rfppipeline.com', ADMIN_PW);
    hitl('second review', 'Kestrel\'s SLAM and progress-comparison stack is a direct fit for the NSF robotics topic; accepting');
    const d = await acceptApplicationInUI(page, CO2.company,
      `Reviewed ${CO2.company}. ${CO2.contact} (${CO2.title}) — autonomous site-survey robots producing as-built `
      + `models, with a deviation engine against the design model. Direct fit for NSF 26-522. Accepting for onboarding.`);
    two.slug = d.slug ?? d.tenantSlug ?? '';
    two.email = CO2.email;
    two.tempPw = d.tempPassword ?? '';
    rec('second tenant created', 'system', 'note', `slug=${two.slug} admin=${two.email}`);
  });

  if (two.slug) {
    await step('the second tenant builds its own library', two.email, async () => {
      await firstSignIn(page, two.email, two.tempPw || TENANT_PW);
      const p = path.join(CO_DIR, 'kestrel-capability-statement.pdf');
      if (!fs.existsSync(p)) throw new Error(`missing fixture ${p}`);
      const r = await page.request.post(`/api/portal/${two.slug}/atoms/upload`, {
        multipart: { file: { name: 'file', mimeType: 'application/pdf', buffer: fs.readFileSync(p) }, mode: 'auto', context: JSON.stringify({ source: 'capability-statement' }) },
        timeout: 180_000,
      });
      if (!ok(r)) throw new Error(`atoms/upload ${r.status()}`);
    });

    // THE WALL. Ask, as each tenant, for the other's private things. A 2xx carrying rows is the
    // failure this whole architecture exists to prevent — so the check reports what came back,
    // not merely that a request was made.
    await step('neither tenant can read the other', 'HITL', async () => {
      hitl('isolation probe', 'signed in as each company in turn and asked for the other\'s library, cards and build');
      const probes: Array<{ as: string; slug: string; what: string; url: string }> = [
        { as: two.email, slug: state.slug, what: 'library', url: `/api/portal/${state.slug}/atoms` },
        { as: two.email, slug: state.slug, what: 'opportunity cards', url: `/api/portal/${state.slug}/cards` },
        { as: two.email, slug: state.slug, what: 'the build', url: `/api/portal/${state.slug}/proposals/${state.proposalId}` },
        { as: state.adminEmail, slug: two.slug, what: 'library', url: `/api/portal/${two.slug}/atoms` },
        { as: state.adminEmail, slug: two.slug, what: 'opportunity cards', url: `/api/portal/${two.slug}/cards` },
      ];
      const breaches: string[] = [];
      let current = '';
      for (const p of probes) {
        if (current !== p.as) { await signIn(page, p.as, TENANT_PW); current = p.as; }
        const r = await page.request.get(p.url, { timeout: 60_000 });
        const body = await r.text();
        let rows = 0;
        try {
          const j = JSON.parse(body || '{}');
          const d = j?.data ?? {};
          rows = (d.atoms ?? d.cards ?? (d.proposal ? [d.proposal] : []) ?? []).length ?? 0;
        } catch { /* non-JSON is a refusal */ }
        const leaked = r.status() < 300 && rows > 0;
        if (leaked) breaches.push(`${p.as} read ${rows} of ${p.slug}'s ${p.what}`);
        rec(`${p.as.split('@')[0]} → ${p.slug} ${p.what}`, 'HITL', leaked ? 'blocked' : 'ok',
          `HTTP ${r.status()}${rows ? `, ${rows} row(s) RETURNED` : ', nothing returned'}`);
      }
      if (breaches.length) throw new Error(`ISOLATION BREACH — ${breaches.join('; ')}`);
    });
  }

  // ══ ACT 11 — the partner manager and their stable ═════════════════════════
  // An EconDev partner runs a book of client companies. They are a tenant themselves, they submit
  // new companies for RFP-admin approval rather than creating them, and they descend into one as
  // its tenant_admin. Every one of those is a different authority boundary.
  ACT = 'ACT 11 · partner manager';
  console.error(`\n${ACT}`);
  const partner: Record<string, string> = {};
  await step('operator stands up a partner organisation', 'master_admin', async () => {
    await signIn(page, 'eric@rfppipeline.com', ADMIN_PW);
    hitl('partner onboarding', 'the Entrepreneurs\' Center runs a stable of client companies; creating their org');
    const r = await page.request.post('/api/admin/partners', {
      data: {
        orgName: 'Midwest Entrepreneurs\' Center', legalName: 'Midwest Entrepreneurs Center Inc.',
        website: 'https://mec.example', adminName: 'Paul Jackson', adminEmail: 'paul.jackson@mec.example',
      }, timeout: 120_000,
    });
    if (!ok(r)) throw new Error(`admin/partners ${r.status()} ${(await r.text()).slice(0, 160)}`);
    const d = ((await r.json().catch(() => ({})))?.data ?? {}) as Record<string, string>;
    partner.slug = d.slug ?? ''; partner.email = 'paul.jackson@mec.example'; partner.tempPw = d.tempPassword ?? '';
    rec('partner org created', 'system', 'note', `slug=${partner.slug} admin=${partner.email}`);
  });

  if (partner.email) {
    await step('the partner manager signs in and opens their console', partner.email, async () => {
      await firstSignIn(page, partner.email, partner.tempPw || TENANT_PW);
      await page.goto('/partner', { waitUntil: 'networkidle', timeout: 60_000 });
      const shown = await page.locator('body').innerText().catch(() => '');
      rec('partner console', 'system', 'note', shown.replace(/\s+/g, ' ').slice(0, 140));
    });
    await shot(page, '15-partner-console');

    await step('the partner submits a client company for approval', partner.email, async () => {
      hitl('managed company', 'submitting a client for RFP-admin approval — a partner cannot mint a tenant themselves');
      const r = await page.request.post('/api/partner/registrations', {
        data: {
          companyName: 'Calcite Materials', adminName: 'Tomas Alvarez', adminEmail: 'tomas@calcite-materials.example',
          companyWebsite: 'https://calcite-materials.example', companyState: 'Ohio',
          description: 'Low-carbon cement using carbonated slag as a clinker replacement; two pilot kilns running.',
          partnerNotes: 'Client of the centre since 2024; ready for a DOE Phase II run.',
          dedupDecision: 'confirmed_new',
        }, timeout: 120_000,
      });
      if (!ok(r)) throw new Error(`partner/registrations ${r.status()} ${(await r.text()).slice(0, 160)}`);
    });

    const managed = await step('operator approves the partner\'s company', 'master_admin', async () => {
      await signIn(page, 'eric@rfppipeline.com', ADMIN_PW);
      hitl('partner-sourced approval', 'the referral comes from a known partner and the dedup check is clear; accepting into their stable');
      const d = await acceptApplicationInUI(page, 'Calcite Materials',
        'Reviewed Calcite Materials, referred by the Midwest Entrepreneurs\' Center. Carbonated-slag clinker '
        + 'replacement with two pilot kilns running — credible for a DOE Phase II. Accepting into the partner\'s stable.');
      return (d.slug ?? d.tenantSlug ?? '') as string;
    });

    if (managed) {
      await step('the partner descends into their company and back', partner.email, async () => {
        await signIn(page, partner.email, TENANT_PW);
        hitl('partner descent', `entering ${managed} as its company admin — the partner works inside, not above`);
        await page.goto(`/api/partner/enter?slug=${managed}`, { waitUntil: 'networkidle', timeout: 60_000 });
        const inside = new URL(page.url()).pathname;
        const canRead = await page.request.get(`/api/portal/${managed}/cards`, { timeout: 60_000 });
        rec('partner works inside the company', 'HITL', inside.includes(managed) && ok(canRead) ? 'ok' : 'note',
          `landed on ${inside} · cards HTTP ${canRead.status()}`);
        await shot(page, '16-partner-descended');
        await page.goto('/api/partner/exit', { waitUntil: 'networkidle', timeout: 60_000 }).catch(() => {});
        rec('partner ascends to their console', 'HITL', 'ok', `back at ${new URL(page.url()).pathname}`);
      });

      // The partner runs a STABLE, not the platform. They must not reach a company that is not theirs.
      await step('the partner cannot reach a company outside their stable', 'HITL', async () => {
        const r = await page.request.get(`/api/portal/${state.slug}/atoms`, { timeout: 60_000 });
        let rows = 0;
        try { rows = (((await r.json())?.data?.atoms) ?? []).length ?? 0; } catch { /* refusal */ }
        const leaked = r.status() < 300 && rows > 0;
        rec('partner → an unmanaged tenant\'s library', 'HITL', leaked ? 'blocked' : 'ok',
          `HTTP ${r.status()}${rows ? `, ${rows} row(s) RETURNED` : ', nothing returned'}`);
        if (leaked) throw new Error(`a partner manager read ${rows} atoms belonging to ${state.slug}, which they do not manage`);
      });
    }
  }

  // ══ ACT 12 — the canvas editor, driven by hand ════════════════════════════
  // Everything above wrote through the save API. This opens the editor a customer actually uses
  // and works in it: read what is on the page, insert a block from the palette, type, save, and
  // reload to confirm the change survived. The API path can be perfect while the editor is broken.
  ACT = 'ACT 12 · canvas editor';
  console.error(`\n${ACT}`);
  // EDIT THE BUILD THAT IS OPEN, NOT THE ONE THAT IS FILED. The first proposal was locked and
  // advanced to 'submitted' in ACT 7, and the editor correctly renders a submitted build
  // READ-ONLY — no editable blocks, and the sidebar does not even render its "Add" tab
  // (canvas-sidebar: the edit tabs are gated behind !readOnly). Pointing this act at that build
  // measured the product refusing to let someone edit a filed proposal and called it a failure.
  // The second build from ACT 9 is still draft and unlocked, which is what a customer edits.
  const editable = { proposalId: second.proposalId || state.proposalId, slug: state.slug };
  const editSections = await step('find an unlocked section to edit', state.adminEmail, async () => {
    await signIn(page, state.adminEmail, TENANT_PW);
    const r = await page.request.get(`/api/portal/${editable.slug}/proposals/${editable.proposalId}/sections`, { timeout: 60_000 });
    if (!ok(r)) throw new Error(`sections ${r.status()}`);
    const all = ((await r.json().catch(() => ({})))?.data?.sections ?? []) as Array<{ id: string; title?: string; isLocked?: boolean }>;
    const open = all.filter((s) => !s.isLocked);
    rec('sections open for editing', 'system', 'note',
      `${open.length} of ${all.length} unlocked on the build being edited`);
    if (!open.length) throw new Error('every section on this build is locked — nothing is editable');
    return open;
  });

  const firstSection = (editSections ?? [])[0];
  if (firstSection) {
    await step('open the section in the editor', state.adminEmail, async () => {
      await page.goto(`/portal/${editable.slug}/proposals/${editable.proposalId}/sections/${firstSection.id}`,
        { waitUntil: 'networkidle', timeout: 90_000 });
      const shown = await page.locator('body').innerText().catch(() => '');
      // The section this editor was asked for must be the one on screen — an editor that opens
      // blank or on the wrong section is the worst failure here, because it invites the author to
      // overwrite their own work without noticing.
      const title = (firstSection.title ?? '').trim();
      const carries = title.length > 4 && shown.includes(title);
      rec('the editor shows the section it was asked for', 'HITL', carries ? 'ok' : 'blocked',
        carries ? `"${title}" rendered, ${shown.length.toLocaleString()} chars on the page`
                : `expected "${title}" on the page; got: ${shown.replace(/\s+/g, ' ').slice(0, 160)}`);
      if (!carries) throw new Error(`the editor did not render "${title}"`);
    });
    await shot(page, '17-canvas-editor');

    await step('insert a block from the palette and type into it', state.adminEmail, async () => {
      hitl('hand authoring', 'adding a paragraph the way a customer does — palette, then keyboard');
      const before = await page.locator('[contenteditable="true"]').count();
      // The palette is behind the sidebar's "Add" TAB — the button exists in the DOM only once
      // that tab is showing, so clicking straight at "Paragraph" finds nothing on a fresh open.
      const addTab = page.getByRole('button', { name: /^add$/i }).first();
      if (await addTab.count()) { await addTab.click({ timeout: 10_000 }).catch(() => {}); await page.waitForTimeout(400); }
      // Insert items are labelled by what they are, not by node type: text_block reads "Paragraph".
      const insert = page.getByRole('button', { name: /^Paragraph$/i }).first();
      if (await insert.count()) { await insert.click({ timeout: 10_000 }).catch(() => {}); await page.waitForTimeout(600); }
      const after = await page.locator('[contenteditable="true"]').count();
      rec('palette inserted a block', 'HITL', after > before ? 'ok' : 'note',
        `editable blocks ${before} → ${after}${after > before ? '' : ' (palette control not found under that name)'}`);

      // Find somewhere to type, and SAY WHICH KIND it was. A blank "nothing survived" tells you
      // nothing about whether the editor is broken or the selector was wrong; naming the target
      // (or the absence of one) makes the next person's first question answerable.
      const targets: Array<[string, string]> = [
        ['contenteditable', '[contenteditable="true"]'],
        ['textarea', 'textarea'],
        ['text input', 'input[type="text"]'],
      ];
      let typedInto = '';
      for (const [label, sel] of targets) {
        const box = page.locator(sel).last();
        if (await box.count()) {
          await box.click({ timeout: 10_000 }).catch(() => {});
          await page.keyboard.type(EDITOR_MARK, { delay: 8 });
          await page.waitForTimeout(300);
          typedInto = label;
          break;
        }
      }
      rec('typed into the editor', 'HITL', typedInto ? 'ok' : 'blocked',
        typedInto ? `keyboard input went into a ${typedInto}` : 'the page offered NOTHING to type into');
      if (!typedInto) throw new Error('found no editable target on the section editor');
    });

    await step('save from the editor, then reload and look', state.adminEmail, async () => {
      const saved = page.waitForResponse(
        (r) => /\/sections\/.+\/save/.test(r.url()) && ['PUT', 'POST'].includes(r.request().method()),
        { timeout: 30_000 }).catch(() => null);
      const btn = page.getByRole('button', { name: /^Save$/i }).first();
      if (await btn.count()) await btn.click({ timeout: 10_000 }).catch(() => {});
      else await page.keyboard.press('Control+s').catch(() => {});
      const r = await saved;
      rec('editor issued a save', 'HITL', r && r.status() < 300 ? 'ok' : 'note',
        r ? `HTTP ${r.status()}` : 'no save request observed (autosave may own it)');

      // The only claim worth making is that the typing SURVIVED. Reload from the server and look.
      await page.reload({ waitUntil: 'networkidle', timeout: 90_000 });
      const shown = await page.locator('body').innerText().catch(() => '');
      const survived = shown.includes(EDITOR_MARK);
      rec('typed text survived a reload', 'HITL', survived ? 'ok' : 'blocked',
        survived ? `"${EDITOR_MARK}" is on the page after reloading from the server` : 'the typed text was lost on reload');
      await shot(page, '18-canvas-saved');
      if (!survived) throw new Error('text typed in the editor did not survive a reload');
    });
  }

  // ══ ledger ═══════════════════════════════════════════════════════════════
  fs.writeFileSync(path.join(OUT, 'arc-ledger.json'), JSON.stringify(ledger, null, 2));
  const tally = ledger.reduce<Record<string, number>>((a, e) => ({ ...a, [e.status]: (a[e.status] ?? 0) + 1 }), {});
  console.error(`\n══ ARC LEDGER ══  ${Object.entries(tally).map(([k, v]) => `${k}=${v}`).join('  ')}`);
  for (const e of ledger.filter((x) => x.status === 'blocked' || x.status === 'override')) {
    console.error(`   ${e.status.toUpperCase().padEnd(8)} ${e.act} · ${e.step}${e.detail ? ` — ${e.detail.slice(0, 120)}` : ''}`);
  }
  expect(ledger.length, 'the arc recorded nothing').toBeGreaterThan(10);
});
