/**
 * capture-stage-walk — photograph the ingest → ranking → build-out flow, stage by stage.
 *
 * `capture-ui-atlas.mjs` photographs every ROUTE as the actor who owns it. That is the right shape
 * for coverage and the wrong shape for this question, which is *what does this flow look like as it
 * happens* — one pass through seven stages, each shot labelled with the actor who is standing there.
 *
 * Two things it does that a route sweep cannot:
 *
 *  · **It opens things.** The bucket-authoring work is invisible at rest — the prefill has to be
 *    clicked and the composition line only exists once the form has content. A page at rest is not
 *    the UI (docs/UI_STATES.md), and photographing the closed version of the thing that changed
 *    would be a contact sheet that shows nothing.
 *  · **It photographs the stage where the DATA is.** Different tenants carry different halves of the
 *    flow on this box — one has the rich profile, another has the buckets and the builds — so each
 *    shot names its tenant rather than pretending one account sees all seven stages.
 *
 * Every id is resolved from the live database. A hard-coded id rots on reseed and a 404 photographs
 * as a clean page.
 *
 * ⚠️ Read-only apart from the prefill click, which fills a form and never submits it.
 *
 * Usage:  node scripts/capture-stage-walk.mjs [--stage 5]
 * Out:    docs/ui-stages/*.png  +  stage-walk.json (repo root, beside docs/ui-atlas)
 */

import { chromium } from '@playwright/test';
import postgres from 'postgres';
import fs from 'node:fs';
import path from 'node:path';

// One base URL, two historic names: the lenses read GUIDE_BASE, the drives read BASE_URL, and
// a harness that silently ignores the one you passed fails with a connection error that reads
// like the app is down. Accept both everywhere; the family's own name still wins.
const BASE = process.env.BASE_URL ?? process.env.GUIDE_BASE ?? 'http://localhost:3000';
const EXE = process.env.CHROMIUM_EXE ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const OWNER = process.env.DATABASE_URL_OWNER ?? 'postgresql://govtech:changeme@localhost:5432/govtech_intel';
// The repo's docs live at the ROOT, not under frontend/ — this resolved relative to cwd and quietly
// created a second docs tree that nothing else knows about. Anchored to the repo like the atlas is.
const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const OUT = path.join(REPO, 'docs/ui-stages');
const ADMIN_PW = process.env.ADMIN_PW ?? process.env.SANDBOX_PASSWORD ?? 'SandboxDrive2026!';
const TENANT_PW = process.env.TENANT_PW ?? 'DemoPass123!';
const only = process.argv.includes('--stage') ? Number(process.argv[process.argv.indexOf('--stage') + 1]) : null;

const sql = postgres(OWNER, { transform: { column: { from: postgres.toCamel, to: postgres.fromCamel } }, max: 4 });
fs.mkdirSync(OUT, { recursive: true });

const shots = [];
let missed = 0;

/** Sign in, and REFUSE to continue quietly if it failed — a signed-out page photographs as a login form. */
async function signIn(page, email, password, who) {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1600);
  if (page.url().includes('/login')) {
    console.error(`  ✗ could not sign in as ${who} (${email}) — every shot below would be a login page`);
    return false;
  }
  return true;
}

async function shoot(page, { stage, title, route, actor, tenant, note, prepare }) {
  const file = `s${stage}-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}.png`;
  const rec = { stage, title, route, actor, tenant: tenant ?? null, note: note ?? null, file };
  try {
    await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1100);
    if (prepare) await prepare(page);
    // A 200 is not evidence that a page rendered (B78/B79) — an error boundary answers 200 too.
    const body = await page.locator('body').innerText().catch(() => '');
    if (/Something went wrong|This page failed to load|Application error/i.test(body)) {
      rec.broken = 'error boundary';
      missed++;
      console.log(`  ✗ ${route} — ERROR BOUNDARY, photographed anyway so it is visible`);
    }
    await page.screenshot({ path: path.join(OUT, file), fullPage: true });
    const px = fs.statSync(path.join(OUT, file)).size;
    rec.bytes = px;
    console.log(`  ${rec.broken ? '✗' : '✓'} ${String(stage).padStart(1)} · ${title.padEnd(38)} ${route.slice(0, 46)}`);
  } catch (e) {
    rec.error = String(e).slice(0, 120);
    missed++;
    console.log(`  ✗ ${stage} · ${title} — ${rec.error}`);
  }
  shots.push(rec);
}

// ── Bindings, all resolved live ────────────────────────────────────────────────────────────────
const [topic] = await sql`
  SELECT o.id, o.solicitation_id AS sol, o.topic_number FROM opportunities o
  WHERE o.topic_number IS NOT NULL AND o.solicitation_id IS NOT NULL ORDER BY o.created_at LIMIT 1`;
const [portal] = await sql`
  SELECT pp.id, t.slug FROM proposal_portals pp JOIN tenants t ON t.id = pp.tenant_id
  ORDER BY pp.created_at DESC LIMIT 1`;
const [proposal] = await sql`
  SELECT p.id, t.slug FROM proposals p JOIN tenants t ON t.id = p.tenant_id
  WHERE p.archived_at IS NULL AND t.slug = 'foundation' ORDER BY p.created_at DESC LIMIT 1`;
// The tenant whose PROFILE has something to copy — stage 5 is about the prefill, and a prefill
// against an empty profile photographs the refusal, not the feature.
const [rich] = await sql`
  SELECT t.slug FROM tenant_profiles p JOIN tenants t ON t.id = p.tenant_id
  WHERE COALESCE(array_length(p.keywords, 1), 0) > 0 ORDER BY array_length(p.keywords, 1) DESC LIMIT 1`;
// The tenant that HAS ranked buckets — stage 6 is about the ranking.
const [ranked] = await sql`
  SELECT t.slug, count(*)::int AS n FROM tenant_spotlight_buckets b JOIN tenants t ON t.id = b.tenant_id
  WHERE b.is_active GROUP BY t.slug ORDER BY n DESC LIMIT 1`;
const [firstBucket] = await sql`
  SELECT b.id, t.slug, b.name FROM tenant_spotlight_buckets b JOIN tenants t ON t.id = b.tenant_id
  WHERE b.is_active AND t.slug = ${ranked?.slug ?? 'foundation'} ORDER BY b.name LIMIT 1`;
const [admin] = await sql`
  SELECT email FROM users WHERE role IN ('rfp_admin','master_admin') AND is_active
  ORDER BY CASE role WHEN 'rfp_admin' THEN 0 ELSE 1 END, created_at LIMIT 1`;
const tenantUser = async (slug) => (await sql`
  SELECT u.email FROM user_memberships m JOIN users u ON u.id = m.user_id JOIN tenants t ON t.id = m.tenant_id
  WHERE t.slug = ${slug} AND m.role = 'tenant_admin' AND u.is_active AND u.role = 'tenant_admin' LIMIT 1`)[0];

console.log('\ncapture-stage-walk — ingest → ranking → build-out\n');
console.log(`  admin        ${admin?.email ?? '(none)'}`);
console.log(`  profile      ${rich?.slug ?? '(none)'}   ← stage 5, the prefill`);
console.log(`  buckets      ${ranked?.slug ?? '(none)'} (${ranked?.n ?? 0})   ← stage 6, the ranking`);
console.log(`  topic        ${topic?.topicNumber ?? '(none)'}`);
console.log();

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
const want = (s) => only == null || only === s;

try {
  // ══ RFP ADMIN LANE · stages 1–4 and the admin half of 7 ══════════════════════════════════════
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    if (!(await signIn(page, admin.email, ADMIN_PW, 'rfp_admin'))) process.exit(2);
    const A = { actor: 'rfp_admin' };

    if (want(1)) {
      console.log('STAGE 1 · Ingest — the head of the river');
      await shoot(page, { ...A, stage: 1, title: 'Upload a solicitation', route: '/admin/rfp-curation/upload',
        note: 'Where a solicitation enters. Documents shred here; their text is what now reaches ranking.' });
      await shoot(page, { ...A, stage: 1, title: 'Intake queue', route: '/admin/intake',
        note: 'stageIntake is the one entry point — admin uploads and released scout findings both funnel through it.' });
      await shoot(page, { ...A, stage: 1, title: 'Scout findings', route: '/admin/scouts',
        note: 'Crawler leads and HITL scout extractions, classified NEW vs UPDATE, released or dismissed.' });
    }

    if (want(2)) {
      console.log('STAGE 2 · Curation — what the admin supplies');
      await shoot(page, { ...A, stage: 2, title: 'Curation queue', route: '/admin/rfp-curation',
        note: 'Every solicitation awaiting curation, with its ingest phase.' });
      if (topic) {
        await shoot(page, { ...A, stage: 2, title: 'Ingest Studio', route: `/admin/rfp-curation/${topic.sol}`,
          note: 'The solicitation workspace: compliance matrix, volumes, spotlight summary. The release gate reads the summary.' });
        await shoot(page, { ...A, stage: 2, title: 'Topic — technology focus areas', route: `/admin/rfp-curation/${topic.sol}/topic/${topic.id}`,
          note: 'Where techFocusAreas is edited. It crosses the bridge as of mig 238; before that it stopped here.' });
      }
    }

    if (want(3)) {
      console.log('STAGE 3 · Release #1 — the discovery gate');
      await shoot(page, { ...A, stage: 3, title: 'Opportunities — approve and push', route: '/admin/opportunities',
        note: 'The gate: submission_format present and a non-empty spotlight summary. Approval fans every activated opportunity onto the bridge.' });
    }

    if (want(4)) {
      console.log('STAGE 4 · Bridge fan-out — the mirror');
      await shoot(page, { ...A, stage: 4, title: 'Mirror cards, all tenants', route: '/admin/cards',
        note: 'What each tenant received. The card now carries tech focus, phase, topic identity, POC and a document manifest.' });
      await shoot(page, { ...A, stage: 4, title: 'Workflow map', route: '/admin/workflows',
        note: 'The automation behind the fan-out — templates as DAGs plus live per-instance overlays.' });
    }

    if (want(7)) {
      console.log('STAGE 7a · Build-out — the admin side');
      await shoot(page, { ...A, stage: 7, title: 'Provisioning queue', route: '/admin/provisioning',
        note: 'Purchases awaiting release, against the 72-hour SLA.' });
      if (portal) {
        await shoot(page, { ...A, stage: 7, title: 'Provisioning cockpit', route: `/admin/provisioning/${portal.id}`,
          note: 'Buyer, SLA countdown, build-out readiness, and the two-outcome Complete & Release.' });
      }
    }
    await ctx.close();
  }

  // ══ TENANT LANE · stage 5, on the tenant whose profile has content ═══════════════════════════
  if (want(5) && rich) {
    const who = await tenantUser(rich.slug);
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    if (who && await signIn(page, who.email, TENANT_PW, `tenant_admin of ${rich.slug}`)) {
      const T = { actor: 'tenant_admin', tenant: rich.slug };
      console.log(`STAGE 5 · Bucket setup — the tenant side (${rich.slug})`);

      await shoot(page, { ...T, stage: 5, title: 'Buckets — a new customer sees this', route: `/portal/${rich.slug}/buckets`,
        note: 'No lenses yet. It says what a bucket IS and states the fallback, because "no buckets" must not read as "your opportunities are missing".' });

      // OPEN it — the composition line does not exist until the form has content, and the prefill
      // has to be clicked. Photographing the closed form would show none of the new work.
      await shoot(page, { ...T, stage: 5, title: 'Prefilled from the company profile', route: `/portal/${rich.slug}/buckets`,
        note: 'One click copies naics_codes, keywords and agency priorities off tenant_profiles. It FILLS — a field already typed into is left alone.',
        prepare: async (p) => {
          await p.getByRole('button', { name: /start from our company profile/i }).click();
          await p.waitForTimeout(900);
          await p.fill('input[placeholder="Name (e.g. AF Autonomy)"]', 'Counter-UAS & Directed Energy');
          await p.waitForTimeout(500);
        } });

      await shoot(page, { ...T, stage: 5, title: 'The composition line', route: `/portal/${rich.slug}/buckets`,
        note: 'What the lens will actually score on, computed off the SCORER\'s own weight table so the number cannot drift from the score it describes.',
        prepare: async (p) => {
          await p.getByRole('button', { name: /start from our company profile/i }).click();
          await p.waitForTimeout(700);
          await p.fill('input[placeholder="Name (e.g. AF Autonomy)"]', 'Counter-UAS & Directed Energy');
          await p.fill('input[placeholder="program types (SBIR, STTR)"]', 'sbir, sttr');
          await p.waitForTimeout(600);
          const line = p.locator('text=/Scores on \\d+ signal/').first();
          await line.scrollIntoViewIfNeeded().catch(() => {});
          await p.waitForTimeout(300);
        } });
      await ctx.close();
    }
  }

  // ══ TENANT LANE · stages 6 and 7b, on the tenant that has ranked buckets and builds ═══════════
  if ((want(6) || want(7)) && ranked) {
    const who = await tenantUser(ranked.slug);
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    if (who && await signIn(page, who.email, TENANT_PW, `tenant_admin of ${ranked.slug}`)) {
      const T = { actor: 'tenant_admin', tenant: ranked.slug };

      if (want(6)) {
        console.log(`STAGE 6 · Ranking and monitoring (${ranked.slug})`);
        await shoot(page, { ...T, stage: 6, title: 'Buckets — five live lenses', route: `/portal/${ranked.slug}/buckets`,
          note: 'Each bucket scores the WHOLE mirror. A bucket is a sort order over every card, not a filter on some of them.' });
        if (firstBucket) {
          await shoot(page, { ...T, stage: 6, title: 'A bucket ranked', route: `/portal/${ranked.slug}/buckets`,
            note: `"${firstBucket.name}" ranked against the tenant's whole opportunity mirror, with the per-signal factors behind each score.`,
            prepare: async (p) => {
              await p.getByRole('button', { name: /rank/i }).first().click();
              await p.waitForTimeout(4200);
            } });
        }
        await shoot(page, { ...T, stage: 6, title: 'Opportunity cards', route: `/portal/${ranked.slug}/cards`,
          note: 'The mirror itself — searchable and sortable across every card the tenant holds.' });
        await shoot(page, { ...T, stage: 6, title: 'Command Center', route: `/portal/${ranked.slug}/command`,
          note: 'What is new since the customer last looked.' });
      }

      if (want(7)) {
        console.log(`STAGE 7b · Build-out — the customer side (${ranked.slug})`);
        await shoot(page, { ...T, stage: 7, title: 'Proposals', route: `/portal/${ranked.slug}/proposals`,
          note: 'Every build this tenant owns.' });
        if (proposal) {
          await shoot(page, { ...T, stage: 7, title: 'Proposal workspace', route: `/portal/${ranked.slug}/proposals/${proposal.id}`,
            note: 'Volumes, sections, compliance and readiness. source_bucket is frozen here at provisioning — which lens surfaced the opportunity that became this build.' });
        }
      }
      await ctx.close();
    }
  }
} finally {
  await browser.close();
}

fs.writeFileSync(path.join(OUT, 'stage-walk.json'), JSON.stringify({ capturedAt: new Date().toISOString(), shots }, null, 2));
console.log(`\n${shots.length} shot(s) → ${OUT}`);
if (missed) console.log(`⚠️  ${missed} could not be photographed cleanly — listed above, and photographed anyway so the failure is visible.`);
await sql.end();
process.exit(missed ? 1 : 0);
