/**
 * User-guide screenshot harness. Logs in through the real login form as a given
 * role and captures a scripted walk of the product to PNGs under
 * docs/user-guides/img/. Re-runnable; overwrites in place.
 *
 *   cd frontend && node --import tsx scripts/capture-shots.mts <journey>
 *
 * Env: BASE_URL (default http://localhost:3000). Uses the pre-installed Chromium
 * (PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers).
 */
import { chromium, type Page } from 'playwright';
import { mkdirSync } from 'fs';
import { join } from 'path';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const OUT = '/home/user/govwin/docs/user-guides/img';
mkdirSync(OUT, { recursive: true });

const PW = 'DemoPass123!';
const journey = process.argv[2] ?? 'documents';

async function login(page: Page, email: string) {
  await page.context().clearCookies(); // fresh session so role-switching works
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PW);
  await Promise.all([
    page.waitForLoadState('networkidle'),
    page.click('button[type="submit"]'),
  ]);
  // give the post-login redirect a beat to settle
  await page.waitForTimeout(1200);
}

async function shot(page: Page, name: string, opts: { full?: boolean } = {}) {
  await page.waitForTimeout(700);
  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: opts.full ?? false });
  console.log(`  📸 ${name}.png  (${page.url()})`);
}

async function run() {
  // The project's Playwright pins a browser build newer than the pre-installed
  // one, so point at the real Chromium binary instead of letting it re-download.
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox'],
  });
  const ctx = await browser.newContext({ viewport: { width: 1680, height: 1000 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.setDefaultTimeout(20000);

  try {
    if (journey === 'documents') {
      const slug = 'acme-navy-systems';
      // 1. Login page (unauthenticated)
      await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
      await shot(page, 'login');

      // 2. Authenticate as the tenant admin
      await login(page, 'admin@acme-navy.test');

      // 3. Documents hub (Your Documents + New Document)
      await page.goto(`${BASE}/portal/${slug}/documents`, { waitUntil: 'networkidle' });
      await shot(page, 'documents-hub', { full: true });

      // 4. New Document chooser (blank presets + template browser)
      await page.goto(`${BASE}/portal/${slug}/documents/new`, { waitUntil: 'networkidle' });
      await shot(page, 'documents-new', { full: true });

      // 5. Create from a blank preset → canvas editor
      await page.fill('input[placeholder^="e.g."]', 'Acme Capability Statement');
      await Promise.all([
        page.waitForURL(new RegExp(`/portal/${slug}/documents/[0-9a-f-]{36}$`), { timeout: 20000 }),
        page.getByRole('button', { name: /One-page flier/i }).click(),
      ]);
      await page.waitForLoadState('networkidle');
      await shot(page, 'documents-editor');

      // 6. Back to the chooser, show the template grid explicitly
      await page.goto(`${BASE}/portal/${slug}/documents/new`, { waitUntil: 'networkidle' });
      await page.getByText('Start from a template').scrollIntoViewIfNeeded();
      await shot(page, 'documents-templates', { full: true });
    }

    if (journey === 'portal-tour') {
      const slug = 'acme-navy-systems';
      await login(page, 'admin@acme-navy.test');
      const stops: Array<[string, string, boolean?]> = [
        ['dashboard', 'portal-dashboard', true],
        ['cards', 'portal-cards', true],
        ['proposals', 'portal-proposals', true],
        ['documents', 'portal-documents', true],
        ['library', 'portal-library', true],
        ['atoms', 'portal-atoms', true],
        ['buckets', 'portal-buckets', true],
        ['team', 'portal-team', true],
        ['profile', 'portal-profile', true],
      ];
      for (const [path, name, full] of stops) {
        try {
          await page.goto(`${BASE}/portal/${slug}/${path}`, { waitUntil: 'networkidle' });
          await shot(page, name, { full });
        } catch (e) { console.error(`  ⚠ ${name}: ${e instanceof Error ? e.message : e}`); }
      }
    }

    if (journey === 'proposal') {
      const slug = 'acme-navy-systems';
      await login(page, 'admin@acme-navy.test');
      // proposal workspace
      await page.goto(`${BASE}/portal/${slug}/proposals`, { waitUntil: 'networkidle' });
      await shot(page, 'proposal-list', { full: true });
      // open the first proposal
      const firstProposal = page.locator('a[href*="/proposals/"]').first();
      if (await firstProposal.count()) {
        await firstProposal.click();
        await page.waitForLoadState('networkidle');
        await shot(page, 'proposal-workspace', { full: true });
        // open the first section → canvas editor (the "Open" button on a section row)
        const open = page.getByRole('link', { name: /^Open$/ }).first();
        const openBtn = (await open.count()) ? open : page.getByRole('button', { name: /^Open$/ }).first();
        if (await openBtn.count()) {
          await openBtn.click();
          await page.waitForURL(/\/sections\//, { timeout: 20000 }).catch(() => {});
          await page.waitForLoadState('networkidle');
          await page.waitForTimeout(1800);
          await shot(page, 'proposal-canvas-editor');
        }
      }
    }

    if (journey === 'admin2') {
      const slug = 'acme-navy-systems';
      await login(page, 'eric@rfppipeline.com');
      for (const [path, name] of [['purchases', 'admin-purchases'], ['tenants', 'admin-tenants']] as Array<[string, string]>) {
        try { await page.goto(`${BASE}/admin/${path}`, { waitUntil: 'networkidle' }); await shot(page, name, { full: true }); }
        catch (e) { console.error(`  ⚠ ${name}:`, e instanceof Error ? e.message : e); }
      }
      await login(page, 'admin@acme-navy.test');
      for (const [path, name] of [['buckets', 'portal-buckets'], ['cards', 'portal-cards']] as Array<[string, string]>) {
        try { await page.goto(`${BASE}/portal/${slug}/${path}`, { waitUntil: 'networkidle' }); await shot(page, name, { full: true }); }
        catch (e) { console.error(`  ⚠ ${name}:`, e instanceof Error ? e.message : e); }
      }
    }

    if (journey === 'todos') {
      const slug = 'acme-navy-systems';
      await login(page, 'admin@acme-navy.test');
      await page.goto(`${BASE}/portal/${slug}/dashboard`, { waitUntil: 'networkidle' });
      await shot(page, 'portal-dashboard-todos', { full: true });
      await login(page, 'eric@rfppipeline.com');
      await page.goto(`${BASE}/admin/dashboard`, { waitUntil: 'networkidle' });
      await shot(page, 'admin-dashboard-todos', { full: true });
    }

    if (journey === 'scouts') {
      await login(page, 'eric@rfppipeline.com'); // master_admin
      await page.goto(`${BASE}/admin/scouts`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2200);
      await shot(page, 'admin-scout-monitor', { full: true });
    }

    if (journey === 'sysadmin') {
      // RFP-admin observability: System Health + System State.
      await login(page, 'eric@rfppipeline.com');
      for (const [path, name] of [['system', 'admin-system-health'], ['system-state', 'admin-system-state']] as Array<[string, string]>) {
        try {
          await page.goto(`${BASE}/admin/${path}`, { waitUntil: 'domcontentloaded' });
          await page.waitForTimeout(2200);
          await shot(page, name, { full: true });
        } catch (e) { console.error(`  ⚠ ${name}: ${e instanceof Error ? e.message : e}`); }
      }
      // Customer-admin settings (account · subscription · company profile).
      await login(page, 'admin@acme-navy.test');
      await page.goto(`${BASE}/portal/acme-navy-systems/profile`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2000);
      await shot(page, 'portal-settings', { full: true });
    }

    if (journey === 'automation') {
      await login(page, 'eric@rfppipeline.com'); // master_admin
      await page.goto(`${BASE}/admin/automation`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2200);
      await shot(page, 'admin-automation', { full: true });
    }

    if (journey === 'workflows') {
      await login(page, 'eric@rfppipeline.com'); // master_admin
      const stops: Array<[string, string]> = [
        ['workflows', 'admin-workflow-monitor'],
        ['processes', 'admin-process-ledger'],
        ['process', 'admin-process-monitor'],
      ];
      for (const [path, name] of stops) {
        try {
          await page.goto(`${BASE}/admin/${path}`, { waitUntil: 'domcontentloaded' });
          await page.waitForTimeout(2200);
          await shot(page, name, { full: true });
        } catch (e) { console.error(`  ⚠ ${name}: ${e instanceof Error ? e.message : e}`); }
      }
    }

    if (journey === 'library') {
      const slug = 'acme-navy-systems';
      await login(page, 'admin@acme-navy.test');
      await page.goto(`${BASE}/portal/${slug}/atoms`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2200);
      await shot(page, 'portal-library-atoms', { full: true });
      // Select all → the bulk curation bar (approve / archive / tag / group).
      try {
        await page.getByRole('button', { name: /^Select all$/ }).click();
        await page.waitForTimeout(700);
        await shot(page, 'portal-library-bulk', { full: true });
        // Drive-test: bulk-approve the whole selection, then show the result.
        await page.getByRole('button', { name: /^Approve all$/ }).click();
        await page.waitForTimeout(1800);
        await shot(page, 'portal-library-approved', { full: true });
      } catch (e) { console.error('  ⚠ library bulk:', e instanceof Error ? e.message : e); }
    }

    if (journey === 'collab') {
      const slug = 'acme-navy-systems';
      const proposalId = '3b0e7f8b-7ca2-4570-91d9-48326add00ff';
      // 1. Admin side — the Team & Access tab (invite + section-scoped grants + access matrix).
      await login(page, 'admin@acme-navy.test');
      await page.goto(`${BASE}/portal/${slug}/proposals/${proposalId}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2500);
      try {
        await page.getByRole('button', { name: /Team & Access/i }).click();
        await page.waitForTimeout(900);
        await shot(page, 'collab-team-access', { full: true });
        // open the invite form so the scoping controls are visible
        await page.getByRole('button', { name: /^\+ Invite$/ }).click().catch(() => {});
        await page.waitForTimeout(600);
        await shot(page, 'collab-invite', { full: true });
      } catch (e) { console.error('  ⚠ team tab:', e instanceof Error ? e.message : e); }
      // 2. Collaborator side — a contributor's scoped landing (only assigned sections).
      await login(page, 'teammate@acme-navy.test');
      await page.goto(`${BASE}/portal/${slug}/proposals/${proposalId}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2500);
      await shot(page, 'collab-contributor-view', { full: true });
    }

    if (journey === 'audit') {
      const slug = 'acme-navy-systems';
      // 0. Customer drives an auditable action end-to-end: pin a topic. This emits
      //    capture:topic.pinned, which lands on the immutable queue AND fires the
      //    "Topic pinned by customer" automation → an admin ToDo.
      await login(page, 'admin@acme-navy.test');
      page.on('dialog', (d) => { d.accept().catch(() => {}); });
      await page.goto(`${BASE}/portal/${slug}/cards`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1800);
      try {
        await page.getByRole('button', { name: /Pin \(copy docs\)/i }).first().click();
        await page.waitForTimeout(2500);
      } catch (e) { console.error('  ⚠ pin:', e instanceof Error ? e.message : e); }
      // 1. Customer side — the tenant activity feed shows their action on the queue.
      await page.goto(`${BASE}/portal/${slug}/activity`, { waitUntil: 'networkidle' });
      await shot(page, 'portal-activity', { full: true });
      // 2. Admin side — the SAME action on the immutable event stream (audit).
      await login(page, 'eric@rfppipeline.com');
      await page.goto(`${BASE}/admin/events?namespace=proposal`, { waitUntil: 'networkidle' });
      await shot(page, 'admin-event-stream', { full: true });
      await page.goto(`${BASE}/admin/dashboard`, { waitUntil: 'networkidle' });
      await shot(page, 'admin-dashboard', { full: true });
    }

    if (journey === 'ingest') {
      await login(page, 'eric@rfppipeline.com'); // rfp_admin
      page.on('dialog', (d) => { d.accept().catch(() => {}); }); // auto-accept confirm + alert
      const bareSol = 'f7cf49d3-f3dc-433b-a5e0-c8fc0e6439c1'; // Engineering Sleep — 0 volumes
      // Before — the workspace with the ✨ Ingest Assist button, no skeleton yet.
      await page.goto(`${BASE}/admin/rfp-curation/${bareSol}`, { waitUntil: 'networkidle' });
      await shot(page, 'ingest-workspace-before', { full: true });
      // Click Ingest Assist → parse (default) → build the matrix → publish → refresh.
      try {
        await page.getByRole('button', { name: /Ingest Assist/i }).click();
        await page.waitForTimeout(5000);
        await page.waitForLoadState('networkidle');
        await shot(page, 'ingest-workspace-after', { full: true });
      } catch (e) { console.error('  ⚠ ingest click:', e instanceof Error ? e.message : e); }
      // The upload form with the new "Run Ingest Assist after upload" checkbox.
      await page.goto(`${BASE}/admin/rfp-curation/upload`, { waitUntil: 'networkidle' });
      await shot(page, 'ingest-upload-checkbox', { full: true });
    }

    if (journey === 'admin') {
      await login(page, 'eric@rfppipeline.com');
      const stops: Array<[string, string]> = [
        ['', 'admin-dashboard'],
        ['rfp-curation', 'admin-rfp-curation'],
        ['templates', 'admin-templates'],
        ['tenants', 'admin-tenants'],
        ['proposals', 'admin-proposals'],
        ['intake', 'admin-intake'],
        ['opportunities', 'admin-opportunities'],
      ];
      for (const [path, name] of stops) {
        try {
          await page.goto(`${BASE}/admin/${path}`, { waitUntil: 'networkidle' });
          await shot(page, name, { full: true });
        } catch (e) { console.error(`  ⚠ ${name}: ${e instanceof Error ? e.message : e}`); }
      }
    }
  } catch (err) {
    console.error('capture failed:', err instanceof Error ? err.message : err);
    await page.screenshot({ path: join(OUT, `_error_${journey}.png`) }).catch(() => {});
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

run();
