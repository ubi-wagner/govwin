/**
 * The collaborator's own screens, captured as the collaborator.
 *
 * ── WHAT WAS THERE BEFORE ────────────────────────────────────────────────────────────────────
 * Three files — collab-landing.png, collab-dashboard.png, collab-activity.png — with one identical
 * md5 between them, showing an EMPTY collaborator: "0 active proposals · No proposals yet". One
 * picture of somebody with nothing, captioned three different ways. And no script wrote them, so
 * there was nothing to re-run: the guide's illustrations had never come from a capture at all.
 *
 * This is that capture. It signs in as the staged contributor (stage-collaborator-fixture.mts) and
 * photographs what a person with real assigned work actually sees.
 *
 * ── IT REFUSES TO PHOTOGRAPH AN EMPTY COLLABORATOR ───────────────────────────────────────────
 * Every landing shot is checked for the empty-state text before it is written. A capture that
 * silently produces the old picture again is the failure mode this file exists to end, so it
 * reports and exits non-zero instead — the fixture is the thing to fix, not the shot.
 *
 *   BASE_URL=http://localhost:3109 node frontend/scripts/capture-collab.mjs
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import postgres from 'postgres';
import { createRequire } from 'node:module';

const BASE = process.env.GUIDE_BASE || process.env.BASE_URL || 'http://localhost:3000';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const ROOT = '/home/user/govwin';
const OUT = path.join(ROOT, 'docs/manuals/img/collab');
const DB = process.env.DATABASE_URL_OWNER || 'postgresql://govtech:changeme@localhost:5432/govtech_intel';
const EMAIL = process.env.COLLAB_EMAIL || 'dana.reyes@partner-optics.example';
const PW = process.env.COLLAB_PW || 'DemoPass123!';
fs.mkdirSync(OUT, { recursive: true });

/** The exact words the old, wrong picture showed. If a shot contains them, the fixture is absent. */
const EMPTY = /No proposals yet|You haven.t been added to any proposals/i;

function recordCapture(slug, shots) {
  try {
    const { execSync } = createRequire(import.meta.url)('node:child_process');
    const commit = execSync(`git -C ${ROOT} rev-parse --short HEAD`, { encoding: 'utf8' }).trim();
    const p = path.join(ROOT, 'docs/manuals/guides/_revisions.json');
    const data = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : { guides: {} };
    data.guides = data.guides || {};
    data.guides[slug] = data.guides[slug] || {};
    data.guides[slug].capture = {
      runId: `${slug}-${Date.now().toString(36)}`,
      at: new Date().toISOString(), base: BASE, commit, shots, crops: 0,
    };
    fs.writeFileSync(p, `${JSON.stringify(data, null, 2)}\n`);
    console.log(`\n  provenance recorded — ${slug} · ${commit} · ${shots} shot(s)`);
  } catch (e) {
    console.log(`\n  ⚠ provenance NOT recorded (${String(e.message).slice(0, 60)}) — the shots are fine, the record is not`);
  }
}

const sql = postgres(DB, { max: 2, onnotice: () => {} });
const b = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
let made = 0;
let empties = 0;
const redirects = [];
try {
  const [row] = await sql`
    SELECT count(*)::int AS n FROM proposal_collaborators pc JOIN users u ON u.id = pc.user_id
    WHERE u.email = ${EMAIL} AND pc.revoked_at IS NULL
      AND COALESCE(array_length(pc.assigned_sections, 1), 0) > 0`;
  if (!row || row.n === 0) {
    console.error(`\nCANNOT RUN: ${EMAIL} has no accepted, section-scoped collaboration.`);
    console.error('Run: node --import tsx scripts/stage-collaborator-fixture.mts\n');
    process.exitCode = 2;
  } else {
    const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
    await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
    await page.fill('input[name="email"], input[type="email"]', EMAIL);
    await page.fill('input[name="password"], input[type="password"]', PW);
    await page.click('button[type="submit"]');
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(1800);
    if (page.url().includes('/login')) {
      console.error(`\nCANNOT RUN: sign-in failed for ${EMAIL}\n`);
      process.exitCode = 2;
    } else {
      const landed = page.url();
      console.log(`\n  signed in as ${EMAIL} → ${landed.replace(BASE, '')}\n`);

      const shot = async (name, url, opts = {}) => {
        try {
          if (url) { await page.goto(BASE + url, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(2200); }
          /*
           * A REDIRECT IS A FINDING, NOT A SHOT.
           *
           * /activity and /vaults both bounce a scoped collaborator to /proposals — correct product
           * behaviour, and a picture of /proposals filed as "Activity" is a caption that lies. The
           * first run wrote both. It now refuses, and the guide is left with a gap that has to be
           * answered in words rather than papered over with the nearest available screen.
           */
          const landedHere = page.url().replace(BASE, '').split('?')[0];
          // `/portal` resolving to `/portal/<slug>/…` is the tenant hop, not a refusal — a
          // collaborator belongs to one company and the product picks it. Only a redirect AWAY
          // from a tenant-qualified route means the actor cannot reach what was asked for.
          const tenantQualified = /^\/portal\/[^/]+\//.test(url ?? '');
          if (url && tenantQualified && landedHere !== url.split('?')[0]) {
            console.log(`  ✗ ${name} — redirected to ${landedHere}; not written (a scoped collaborator cannot reach ${url})`);
            redirects.push(`${url} → ${landedHere}`);
            return;
          }
          const body = await page.locator('body').innerText().catch(() => '');
          if (opts.mustNotBeEmpty && EMPTY.test(body)) {
            console.log(`  ✗ ${name} — the EMPTY collaborator state; not written (this is the old picture)`);
            empties += 1;
            return;
          }
          await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: !!opts.full });
          console.log(`  ✓ ${name}.png  ${page.url().replace(BASE, '')}  ${body.length} chars`);
          made += 1;
        } catch (e) { console.log(`  ⚠ ${name} — ${String(e.message).slice(0, 60)}`); }
      };

      // The landing is the one that was wrong; it is checked hardest.
      await shot('collab-landing', '/portal', { mustNotBeEmpty: true });
      await shot('collab-dashboard', landed.replace(BASE, ''), { mustNotBeEmpty: true, full: true });
      // The assigned proposal, opened as the contributor — their scoped view of a real build.
      const [p] = await sql`
        SELECT p.id::text AS id, t.slug FROM proposal_collaborators pc
        JOIN proposals p ON p.id = pc.proposal_id JOIN tenants t ON t.id = p.tenant_id
        JOIN users u ON u.id = pc.user_id
        WHERE u.email = ${EMAIL} AND pc.revoked_at IS NULL LIMIT 1`;
      if (p) {
        await shot('collab-proposal', `/portal/${p.slug}/proposals/${p.id}`, { full: true });
        /*
         * /activity and /vaults are probed but never illustrated: both bounce a scoped collaborator
         * back to their proposals, and the guide answers that in words. Kept in the run because a
         * redirect that STOPS happening is a scope change worth noticing.
         */
        await shot('collab-activity', `/portal/${p.slug}/activity`, { full: true });
        await shot('collab-vaults', `/portal/${p.slug}/vaults`);
        await shot('collab-todos', `/portal/${p.slug}/todos`);
      }
      recordCapture('collaborator', made);
    }
    await page.close();
  }
} catch (e) {
  console.error('FATAL', e);
  process.exitCode = 1;
} finally {
  await b.close();
  await sql.end();
}
console.log(`\n  ${made} shot(s) written${empties ? ` · ${empties} refused as EMPTY` : ''}`
  + `${redirects.length ? ` · ${redirects.length} refused as REDIRECT` : ''}`);
if (redirects.length) {
  console.log('  routes a scoped collaborator cannot reach (say so in the guide, do not illustrate them):');
  for (const r of redirects) console.log(`    · ${r}`);
}
console.log('');
if (empties > 0) process.exitCode = 1;
